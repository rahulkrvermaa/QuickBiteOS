import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { CartItem, SelectedAddonItem } from '@/types/cart'
import type { Product, ProductVariant } from '@/types/domain'

interface CartStore {
  items: CartItem[]
  addItem: (product: Product, variant?: ProductVariant, addons?: SelectedAddonItem[]) => void
  removeItem: (itemId: string) => void
  updateQuantity: (itemId: string, delta: number) => void
  clearCart: () => void
  getSubtotalPaisa: () => number
  getTaxPaisa: (gstPercentage?: number) => number
  getTotalPaisa: (gstPercentage?: number) => number
  getTotalCount: () => number
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (product, variant, addons = []) => {
        const addonsKey = addons
          .filter((a) => a.quantity > 0)
          .map((a) => `${a.addon.id}:${a.quantity}`)
          .sort()
          .join('|')
        const compositeId = `${product.id}-${variant?.id ?? 'default'}-${addonsKey}`

        const baseUnitPaisa = variant ? variant.priceOverridePaisa : product.basePricePaisa
        const addonsUnitPaisa = addons.reduce((sum, a) => sum + a.addon.pricePaisa * a.quantity, 0)
        const unitPricePaisa = baseUnitPaisa + addonsUnitPaisa

        set((state) => {
          const existing = state.items.find((i) => i.id === compositeId)
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.id === compositeId
                  ? { ...i, quantity: i.quantity + 1, totalPaisa: (i.quantity + 1) * unitPricePaisa }
                  : i
              ),
            }
          }
          return {
            items: [
              ...state.items,
              {
                id: compositeId,
                product,
                selectedVariant: variant,
                selectedAddons: addons.filter((a) => a.quantity > 0),
                quantity: 1,
                unitPricePaisa,
                totalPaisa: unitPricePaisa,
              },
            ],
          }
        })
      },

      removeItem: (itemId) => {
        set((state) => ({
          items: state.items.filter((i) => i.id !== itemId),
        }))
      },

      updateQuantity: (itemId, delta) => {
        set((state) => ({
          items: state.items
            .map((item) => {
              if (item.id === itemId) {
                const newQty = item.quantity + delta
                if (newQty <= 0) return null
                return {
                  ...item,
                  quantity: newQty,
                  totalPaisa: newQty * item.unitPricePaisa,
                }
              }
              return item
            })
            .filter((item): item is CartItem => item !== null),
        }))
      },

      clearCart: () => set({ items: [] }),

      getSubtotalPaisa: () => {
        return get().items.reduce((sum, item) => sum + item.totalPaisa, 0)
      },

      getTaxPaisa: (gstPercentage = 5) => {
        const subtotal = get().getSubtotalPaisa()
        return Math.round((subtotal * gstPercentage) / 100)
      },

      getTotalPaisa: (gstPercentage = 5) => {
        const subtotal = get().getSubtotalPaisa()
        const tax = get().getTaxPaisa(gstPercentage)
        return subtotal + tax
      },

      getTotalCount: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0)
      },
    }),
    {
      name: 'quickbite_customer_cart',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
