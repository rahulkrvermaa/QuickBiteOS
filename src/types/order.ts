export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'

export type PaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED'

export type PaymentMethod = 'ONLINE_UPI' | 'ONLINE_CARD' | 'CASH_COUNTER'

export interface SelectedAddonSnapshot {
  addonId: string
  name: string
  pricePaisa: number
  quantity: number
}

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  itemNameSnapshot: string
  variantNameSnapshot?: string
  unitPricePaisa: number
  quantity: number
  addonsSnapshot: SelectedAddonSnapshot[]
  lineTotalPaisa: number
}

export interface PickupToken {
  id: string
  orderId: string
  businessId: string
  branchId: string
  tokenDisplay: string // e.g. "A042" or "A1054"
  sequenceNum: number
  tokenDate: string // YYYY-MM-DD
  createdAt: string
}

export interface Order {
  id: string
  businessId: string
  branchId: string
  orderNumber: string // e.g., "QB-2611-0042"
  secureAccessToken: string // high entropy string for public customer tracking
  customerName: string
  customerPhone: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  subtotalPaisa: number
  discountPaisa: number
  taxPaisa: number
  totalPaisa: number
  notes?: string
  pickupToken?: PickupToken
  items: OrderItem[]
  createdAt: string
  updatedAt: string
}

