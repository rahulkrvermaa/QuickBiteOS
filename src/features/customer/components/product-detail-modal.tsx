import React, { useState } from 'react'
import { Plus, Minus } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPaisaToINR } from '@/lib/currency'
import type { Product, ProductVariant } from '@/types/domain'
import type { SelectedAddonItem } from '@/types/cart'

export interface ProductDetailModalProps {
  product: Product | null
  isOpen: boolean
  onClose: () => void
  onAddToCart: (product: Product, variant?: ProductVariant, addons?: SelectedAddonItem[]) => void
}

interface CustomizerInnerProps {
  product: Product
  onClose: () => void
  onAddToCart: (product: Product, variant?: ProductVariant, addons?: SelectedAddonItem[]) => void
}

const CustomizerInner: React.FC<CustomizerInnerProps> = ({ product, onClose, onAddToCart }) => {
  const initialVariant = product.variants.find((v) => v.isDefault) || product.variants[0]
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | undefined>(initialVariant)
  const [addonQuantities, setAddonQuantities] = useState<Record<string, number>>({})

  const basePricePaisa = selectedVariant ? selectedVariant.priceOverridePaisa : product.basePricePaisa
  const addonsTotalPaisa = product.addons.reduce((sum, addon) => {
    const qty = addonQuantities[addon.id] || 0
    return sum + addon.pricePaisa * qty
  }, 0)
  const currentTotalPaisa = basePricePaisa + addonsTotalPaisa

  const handleAddonDelta = (addonId: string, maxQty: number, delta: number) => {
    setAddonQuantities((prev) => {
      const current = prev[addonId] || 0
      const next = Math.max(0, Math.min(maxQty, current + delta))
      return { ...prev, [addonId]: next }
    })
  }

  const handleConfirm = () => {
    const selectedAddons: SelectedAddonItem[] = product.addons
      .filter((a) => (addonQuantities[a.id] || 0) > 0)
      .map((a) => ({ addon: a, quantity: addonQuantities[a.id] }))

    onAddToCart(product, selectedVariant, selectedAddons)
    onClose()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant={product.isVeg ? 'veg' : 'non-veg'} />
        <span className="text-xs text-[#575653]">
          {product.isVeg ? 'Pure Vegetarian' : 'Non-Vegetarian'}
        </span>
      </div>

      {product.description && (
        <p className="text-xs text-[#575653] leading-relaxed">{product.description}</p>
      )}

      {/* Variants selection */}
      {product.variants.length > 0 && (
        <div className="pt-2 border-t border-[#F2EFE9]">
          <h4 className="text-xs font-bold text-[#20201E] uppercase tracking-wider mb-2">
            Select Portion / Variant
          </h4>
          <div className="space-y-2">
            {product.variants.map((v) => (
              <label
                key={v.id}
                onClick={() => setSelectedVariant(v)}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedVariant?.id === v.id
                    ? 'border-[#D95732] bg-[#FDF1ED]/40'
                    : 'border-[#E6E2D8] hover:border-[#D95732]/30'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="variant"
                    checked={selectedVariant?.id === v.id}
                    onChange={() => setSelectedVariant(v)}
                    className="accent-[#D95732] w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm font-medium text-[#20201E]">{v.name}</span>
                </div>
                <span className="text-sm font-bold text-[#20201E] tabular-nums">
                  {formatPaisaToINR(v.priceOverridePaisa)}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Add-ons selection */}
      {product.addons.length > 0 && (
        <div className="pt-2 border-t border-[#F2EFE9]">
          <h4 className="text-xs font-bold text-[#20201E] uppercase tracking-wider mb-2">
            Optional Add-ons & Chutneys
          </h4>
          <div className="space-y-2">
            {product.addons.map((addon) => {
              const count = addonQuantities[addon.id] || 0
              return (
                <div
                  key={addon.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-[#E6E2D8] bg-white"
                >
                  <div>
                    <p className="text-sm font-medium text-[#20201E]">{addon.name}</p>
                    <p className="text-xs text-[#575653] font-mono tabular-nums">
                      +{formatPaisaToINR(addon.pricePaisa)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAddonDelta(addon.id, addon.maxQuantity, -1)}
                      disabled={count === 0}
                      className="w-7 h-7 rounded-md border border-[#E6E2D8] flex items-center justify-center text-[#575653] hover:bg-[#F2EFE9] disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-5 text-center text-sm font-bold text-[#20201E] font-mono tabular-nums">
                      {count}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAddonDelta(addon.id, addon.maxQuantity, 1)}
                      disabled={count >= addon.maxQuantity}
                      className="w-7 h-7 rounded-md border border-[#D95732] text-[#D95732] bg-[#FDF1ED] flex items-center justify-center hover:bg-[#D95732] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Footer with Price and Add to Cart */}
      <div className="pt-3 border-t border-[#E6E2D8] flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] text-[#575653]">Total Item Price</p>
          <p className="text-lg font-bold text-[#20201E] tabular-nums">
            {formatPaisaToINR(currentTotalPaisa)}
          </p>
        </div>

        <Button
          onClick={handleConfirm}
          disabled={!product.isAvailable}
          size="md"
          className="flex-1 font-bold"
        >
          {product.isAvailable ? 'Add to Order' : 'Item Sold Out'}
        </Button>
      </div>
    </div>
  )
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  isOpen,
  onClose,
  onAddToCart,
}) => {
  if (!product) return null

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={product.name}>
      <CustomizerInner
        key={product.id}
        product={product}
        onClose={onClose}
        onAddToCart={onAddToCart}
      />
    </Dialog>
  )
}
