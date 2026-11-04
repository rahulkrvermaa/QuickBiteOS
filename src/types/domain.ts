export interface Business {
  id: string
  name: string
  slug: string
  logoUrl?: string
  tagline?: string
  phone: string
  address: string
  city: string
  isActive: boolean
  currency: 'INR'
  createdAt: string
}

export interface Branch {
  id: string
  businessId: string
  name: string
  code: string // e.g. MAIN, B01
  address: string
  phone: string
  isPrimary: boolean
  isActive: boolean
}

export interface BusinessSettings {
  businessId: string
  allowCash: boolean
  allowOnline: boolean
  autoAcceptOrders: boolean
  taxGstPercentage: number // e.g. 5 for 5%
  serviceChargePercentage: number
  orderPrefix: string // e.g. 'S' or 'A'
  estimatedPrepMinutes: number
}

export interface Category {
  id: string
  businessId: string
  name: string
  slug: string
  displayOrder: number
  isActive: boolean
}

export interface ProductVariant {
  id: string
  productId: string
  name: string // e.g., "Single (1 pc)", "Plate (2 pcs)"
  priceOverridePaisa: number // Integer paisa
  isDefault: boolean
}

export interface ProductAddon {
  id: string
  productId: string
  name: string // e.g., "Extra Sweet Chutney", "Extra Spicy Mint", "Dahi & Sev"
  pricePaisa: number // Integer paisa
  maxQuantity: number
}

export interface Product {
  id: string
  businessId: string
  categoryId: string
  name: string
  description: string
  imageUrl?: string
  basePricePaisa: number // Integer paisa (e.g. 2000 for ₹20)
  isVeg: boolean
  isAvailable: boolean
  variants: ProductVariant[]
  addons: ProductAddon[]
}

