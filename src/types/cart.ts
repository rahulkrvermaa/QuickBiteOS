import type { Product, ProductVariant, ProductAddon } from './domain'

export interface SelectedAddonItem {
  addon: ProductAddon
  quantity: number
}

export interface CartItem {
  id: string // composite key e.g. `${productId}-${variantId}-${addonsKey}`
  product: Product
  selectedVariant?: ProductVariant
  selectedAddons: SelectedAddonItem[]
  quantity: number
  unitPricePaisa: number
  totalPaisa: number
}

