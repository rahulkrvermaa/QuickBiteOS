import React, { useState } from 'react'
import { Plus, Minus, Trash2, ArrowRight, ShieldCheck, Banknote, QrCode, AlertCircle } from 'lucide-react'
import { Drawer } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatPaisaToINR } from '@/lib/currency'
import { useCartStore } from '../hooks/use-cart-store'
import { createCustomerOrder, CustomerCheckoutSchema } from '@/services/order.service'
import { loadRazorpayScript } from '@/services/payment.service'
import type { PaymentMethod } from '@/types/order'
import type { Business, Branch, BusinessSettings, Product } from '@/types/domain'

export interface CartDrawerProps {
  isOpen: boolean
  onClose: () => void
  onCheckoutSuccess: (secureToken: string) => void
  business: Business
  branch: Branch
  settings: BusinessSettings
  catalogProducts: Product[]
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  onCheckoutSuccess,
  business,
  branch,
  settings,
  catalogProducts,
}) => {
  const { items, updateQuantity, removeItem, clearCart, getSubtotalPaisa, getTaxPaisa, getTotalPaisa } =
    useCartStore()

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ONLINE_UPI')
  const [errors, setErrors] = useState<{ name?: string; phone?: string; general?: string }>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Asynchronously warm-up Razorpay SDK script while customer fills the cart form
  React.useEffect(() => {
    if (isOpen && settings.allowOnline) {
      loadRazorpayScript()
    }
  }, [isOpen, settings.allowOnline])

  const subtotalPaisa = getSubtotalPaisa()
  const taxPaisa = getTaxPaisa(settings.taxGstPercentage ?? 5)
  const totalPaisa = getTotalPaisa(settings.taxGstPercentage ?? 5)

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    // Validate Customer Input with Zod Schema
    const result = CustomerCheckoutSchema.safeParse({
      customerName,
      customerPhone,
      paymentMethod,
      notes: notes.trim() || undefined,
    })

    if (!result.success) {
      const fieldErrors: { name?: string; phone?: string } = {}
      for (const issue of result.error.issues) {
        if (issue.path[0] === 'customerName') fieldErrors.name = issue.message
        if (issue.path[0] === 'customerPhone') fieldErrors.phone = issue.message
      }
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setIsSubmitting(true)

    try {
      // Map cart items into pure submissions (discard client pricing)
      const itemSubmissions = items.map((i) => ({
        productId: i.product.id,
        variantId: i.selectedVariant?.id,
        addons: i.selectedAddons.map((a) => ({
          addonId: a.addon.id,
          quantity: a.quantity,
        })),
        quantity: i.quantity,
      }))

      // Invoke server-authoritative order creation
      const createdOrder = await createCustomerOrder({
        business,
        branch,
        settings,
        catalogProducts,
        customer: result.data,
        items: itemSubmissions,
      })

      clearCart()
      onClose()
      onCheckoutSuccess(createdOrder.secureAccessToken)
    } catch (err: any) {
      setErrors({
        general: err?.message || 'Failed to place order. Please check availability and retry.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Your Order Cart" position="bottom">
      {items.length === 0 ? (
        <div className="py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-[#FDF1ED] text-3xl flex items-center justify-center mx-auto mb-3">
            🛒
          </div>
          <h3 className="text-base font-bold text-[#20201E]">Your cart is empty</h3>
          <p className="text-xs text-[#575653] mt-1">Explore our hot samosas and add items to begin.</p>
          <Button variant="outline" size="sm" onClick={onClose} className="mt-4">
            Browse Menu
          </Button>
        </div>
      ) : (
        <form onSubmit={handleCheckout} className="space-y-5 pb-6">
          {errors.general && (
            <div className="p-3 rounded-lg bg-[#FDEEED] border border-[#F5C5C1] text-xs text-[#C0352A] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errors.general}</span>
            </div>
          )}

          {/* Order Items List */}
          <div className="divide-y divide-[#F2EFE9] max-h-56 overflow-y-auto pr-1">
            {items.map((item) => (
              <div key={item.id} className="py-3 flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-[#20201E]">{item.product.name}</h4>
                  {item.selectedVariant && (
                    <p className="text-xs text-[#575653]">{item.selectedVariant.name}</p>
                  )}
                  {item.selectedAddons.length > 0 && (
                    <p className="text-[11px] text-[#8C8A84] mt-0.5">
                      + {item.selectedAddons.map((a) => `${a.addon.name} (x${a.quantity})`).join(', ')}
                    </p>
                  )}
                  <p className="text-xs font-bold text-[#20201E] tabular-nums mt-1">
                    {formatPaisaToINR(item.totalPaisa)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center border border-[#E6E2D8] rounded-lg bg-[#F8F6F1]">
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.id, -1)}
                      className="p-1 hover:text-[#D95732]"
                      disabled={isSubmitting}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-6 text-center text-xs font-bold font-mono tabular-nums">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.id, 1)}
                      className="p-1 hover:text-[#D95732]"
                      disabled={isSubmitting}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="p-1 text-[#8C8A84] hover:text-[#C0352A]"
                    title="Remove item"
                    disabled={isSubmitting}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Customer Details Form */}
          <div className="pt-3 border-t border-[#E6E2D8] space-y-3">
            <h4 className="text-xs font-bold text-[#20201E] uppercase tracking-wider">
              Customer Details (No account required)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#575653] mb-1">Your Name</label>
                <Input
                  placeholder="e.g. Rahul Sharma"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  error={errors.name}
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#575653] mb-1">Mobile Number (10 Digits)</label>
                <Input
                  type="tel"
                  placeholder="e.g. 8320917837"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  error={errors.phone}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#575653] mb-1">Cooking Notes / Instructions (Optional)</label>
              <Input
                placeholder="e.g. Extra spicy chutney, pack separately"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="pt-3 border-t border-[#E6E2D8] space-y-2">
            <h4 className="text-xs font-bold text-[#20201E] uppercase tracking-wider">
              Payment Choice
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <label
                onClick={() => !isSubmitting && setPaymentMethod('ONLINE_UPI')}
                className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                  paymentMethod === 'ONLINE_UPI'
                    ? 'border-[#D95732] bg-[#FDF1ED]/40 text-[#20201E]'
                    : 'border-[#E6E2D8] text-[#575653] hover:border-[#D95732]/30'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'ONLINE_UPI'}
                  onChange={() => setPaymentMethod('ONLINE_UPI')}
                  className="accent-[#D95732]"
                  disabled={isSubmitting}
                />
                <QrCode className="w-4 h-4 text-[#D95732]" />
                <span className="text-xs font-bold">UPI / Cards</span>
              </label>

              <label
                onClick={() => !isSubmitting && setPaymentMethod('CASH_COUNTER')}
                className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                  paymentMethod === 'CASH_COUNTER'
                    ? 'border-[#D95732] bg-[#FDF1ED]/40 text-[#20201E]'
                    : 'border-[#E6E2D8] text-[#575653] hover:border-[#D95732]/30'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'CASH_COUNTER'}
                  onChange={() => setPaymentMethod('CASH_COUNTER')}
                  className="accent-[#D95732]"
                  disabled={isSubmitting}
                />
                <Banknote className="w-4 h-4 text-[#247A52]" />
                <span className="text-xs font-bold">Cash at Counter</span>
              </label>
            </div>
          </div>

          {/* Bill Breakdown in Integer Paisa */}
          <div className="p-4 rounded-xl bg-[#F8F6F1] border border-[#E6E2D8] space-y-2 text-xs text-[#575653]">
            <div className="flex justify-between">
              <span>Item Subtotal</span>
              <span className="font-semibold text-[#20201E] tabular-nums font-mono">
                {formatPaisaToINR(subtotalPaisa)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Taxes & GST ({settings.taxGstPercentage ?? 5}%)</span>
              <span className="font-semibold text-[#20201E] tabular-nums font-mono">
                {formatPaisaToINR(taxPaisa)}
              </span>
            </div>
            <div className="pt-2 border-t border-[#E6E2D8] flex justify-between text-sm font-bold text-[#20201E]">
              <span>To Pay</span>
              <span className="tabular-nums font-mono text-[#D95732] text-base">
                {formatPaisaToINR(totalPaisa)}
              </span>
            </div>
          </div>

          {/* Security Notice & Submit Button */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-[11px] text-[#575653]">
              <ShieldCheck className="w-4 h-4 text-[#247A52]" />
              <span>Prices recalculated & verified on server. Zero duplicate token collisions.</span>
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full text-base font-bold shadow-md flex items-center justify-center gap-2"
              isLoading={isSubmitting}
            >
              <span>Confirm Order • {formatPaisaToINR(totalPaisa)}</span>
              <ArrowRight className="w-5 h-5" />
            </Button>
          </div>
        </form>
      )}
    </Drawer>
  )
}
