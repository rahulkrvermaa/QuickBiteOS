import { z } from 'zod'
import type { Order, OrderItem, PaymentMethod, OrderStatus } from '@/types/order'
import type { Business, Branch, BusinessSettings, Product } from '@/types/domain'
import { calculateOrderPricing, type CartItemSubmission } from './pricing.service'
import { BENCHMARK_ORDERS } from '@/lib/mock-data/benchmark-orders'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { broadcastOrderEvent } from './realtime.service'

export const CustomerCheckoutSchema = z.object({
  customerName: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must not exceed 50 characters')
    .trim(),
  customerPhone: z
    .string()
    .trim()
    .transform((val) => val.replace(/^\+91/, '').replace(/\s+/g, ''))
    .refine((val) => /^[6-9]\d{9}$/.test(val), {
      message: 'Enter a valid 10-digit Indian mobile number',
    }),
  paymentMethod: z.enum(['ONLINE_UPI', 'ONLINE_CARD', 'CASH_COUNTER']),
  notes: z.string().max(200, 'Notes must be within 200 characters').optional(),
})

export type CustomerCheckoutInput = z.infer<typeof CustomerCheckoutSchema>

export interface CreateOrderRequest {
  business: Business
  branch: Branch
  settings: BusinessSettings
  catalogProducts: Product[]
  customer: CustomerCheckoutInput
  items: CartItemSubmission[]
}

const STORAGE_KEY = 'quickbite_orders_store'

// Multi-tier store: in-memory map + localStorage sync
const inMemoryOrders = new Map<string, Order>()

function hydrateFromLocalStorage(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed: Order[] = JSON.parse(raw)
        for (const order of parsed) {
          // Never hydrate mock benchmark orders (#A041, #A042, #A043) in live Supabase mode
          if (isSupabaseConfigured && BENCHMARK_ORDERS.some((b) => b.id === order.id)) {
            continue
          }
          inMemoryOrders.set(order.secureAccessToken, order)
        }
      }
    } catch {
      // Ignore parse failure
    }
  }
}

// In offline / mock mode, populate benchmark orders
if (!isSupabaseConfigured) {
  for (const bo of BENCHMARK_ORDERS) {
    inMemoryOrders.set(bo.secureAccessToken, bo)
  }
}

// Always hydrate non-benchmark custom orders (e.g. freshly placed customer orders)
hydrateFromLocalStorage()

export function persistOrder(order: Order): void {
  inMemoryOrders.set(order.secureAccessToken, order)

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const customOrders = Array.from(inMemoryOrders.values()).filter(
        (o) => !BENCHMARK_ORDERS.some((b) => b.id === o.id)
      )
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(customOrders))
      // Notify current window listeners so same-window components update synchronously
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    } catch {
      // Ignore storage write failure
    }
  }
}

function isUuid(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
}

/**
 * Sanitizes PostgreSQL / Supabase error messages to show helpful, customer-friendly messages
 * while concealing internal database schema and column names.
 */
export function sanitizeCustomerErrorMessage(msg: string): string {
  if (!msg) return 'Failed to place order. Please review your selections and try again.'

  if (msg.includes('Insufficient stock')) return msg
  if (msg.includes('unavailable')) return msg
  if (msg.includes('disabled for this shop')) return msg
  if (msg.includes('exceeds maximum allowed quantity')) return msg
  if (msg.includes('Order must contain at least one item')) return msg
  if (msg.includes('Order exceeds maximum limit')) return msg
  if (msg.includes('Customer name must be at least')) return msg
  if (msg.includes('valid 10-digit Indian mobile number')) return msg
  if (msg.includes('Invalid item quantity')) return msg
  if (msg.includes('does not belong to business') || msg.includes('does not exist')) {
    return 'One or more selected items are no longer available. Please refresh your menu.'
  }
  if (msg.includes('deadlock') || msg.includes('timeout')) {
    return 'The restaurant is experiencing high order volume. Please try confirming again in a moment.'
  }
  if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
    return 'Order processing conflict. Please retry your order.'
  }

  return 'Unable to place order at this time. Please check your selections and try again.'
}

const DEMO_SEQ_KEY = 'quickbite_demo_sequence_counter'
let inMemoryDemoSequence = 44

export function getNextDemoSequence(): number {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(DEMO_SEQ_KEY)
      let current = inMemoryDemoSequence
      if (stored) {
        const parsed = parseInt(stored, 10)
        if (!isNaN(parsed) && parsed >= 44) {
          current = parsed
        }
      }
      const next = current + 1
      window.localStorage.setItem(DEMO_SEQ_KEY, String(next))
      inMemoryDemoSequence = next
      return current
    } catch {
      // Fallback to in-memory counter if localStorage is restricted
    }
  }
  return inMemoryDemoSequence++
}

let localOrderNumberCounter = 1001

/**
 * Creates an order with strict server-side price validation.
 * Client prices are ignored. Online orders do NOT receive a token until payment verification.
 */
export async function createCustomerOrder(request: CreateOrderRequest): Promise<Order> {
  const validatedCustomer = CustomerCheckoutSchema.parse(request.customer)

  if (!request.items || request.items.length === 0) {
    throw new Error('Order must contain at least one item')
  }
  if (request.items.length > 50) {
    throw new Error('Order exceeds maximum limit of 50 items')
  }

  const pricing = calculateOrderPricing(
    request.items,
    request.catalogProducts,
    request.settings
  )

  const randomSuffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(36).slice(2, 18)
  const secureAccessToken = `sec_tok_${randomSuffix}`

  const now = new Date()
  const dateStr = now.toISOString().slice(2, 7).replace('-', '')
  const orderNumber = `QB-${dateStr}-${localOrderNumberCounter++}`
  const hasLiveUuid = isUuid(request.business.id)
  const orderId = hasLiveUuid && typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `ord_${randomSuffix.slice(0, 12)}`

  const orderItems: OrderItem[] = pricing.items.map((item, idx) => ({
    id: `item_${orderId}_${idx + 1}`,
    orderId,
    productId: item.productId,
    itemNameSnapshot: item.itemNameSnapshot,
    variantNameSnapshot: item.variantNameSnapshot,
    unitPricePaisa: item.unitPricePaisa,
    quantity: item.quantity,
    addonsSnapshot: item.addonsSnapshot,
    lineTotalPaisa: item.lineTotalPaisa,
  }))

  const isCash = validatedCustomer.paymentMethod === 'CASH_COUNTER'
  let pickupToken: Order['pickupToken'] = undefined

  if (isCash) {
    // For cash orders in demo mode: allocate unique monotonic token sequence
    const seq = getNextDemoSequence()
    const prefix = request.settings.orderPrefix || 'A'
    const tokenDisplay = `${prefix}${String(seq).padStart(3, '0')}`

    pickupToken = {
      id: `tok_${orderId}`,
      orderId,
      businessId: request.business.id,
      branchId: request.branch.id,
      tokenDisplay,
      sequenceNum: seq,
      tokenDate: now.toISOString().slice(0, 10),
      createdAt: now.toISOString(),
    }
  }

  const newOrder: Order = {
    id: orderId,
    businessId: request.business.id,
    branchId: request.branch.id,
    orderNumber,
    secureAccessToken,
    customerName: validatedCustomer.customerName,
    customerPhone: `+91 ${validatedCustomer.customerPhone}`,
    status: isCash ? 'PLACED' : 'PENDING_PAYMENT',
    paymentStatus: 'UNPAID',
    paymentMethod: validatedCustomer.paymentMethod as PaymentMethod,
    subtotalPaisa: pricing.subtotalPaisa,
    discountPaisa: pricing.discountPaisa,
    taxPaisa: pricing.taxPaisa,
    totalPaisa: pricing.totalPaisa,
    notes: validatedCustomer.notes,
    pickupToken,
    items: orderItems,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }

  // In production mode with an active tenant UUID:
  // Order creation is strictly server-authoritative via place_customer_order RPC.
  // Any RPC error or failure is thrown directly to the caller. Zero ghost orders can be created.
  const isDemoMode = !hasLiveUuid

  if (!isDemoMode) {
    const { data: serverOrder, error: placeError } = await supabase.rpc('place_customer_order', {
      p_business_id: request.business.id,
      p_branch_id: request.branch.id,
      p_customer_name: validatedCustomer.customerName,
      p_customer_phone: validatedCustomer.customerPhone,
      p_payment_method: validatedCustomer.paymentMethod,
      p_items: request.items.map((i) => ({
        product_id: i.productId,
        variant_id: i.variantId || null,
        quantity: i.quantity,
        addons: (i.addons || []).map((a) => ({
          addon_id: a.addonId,
          quantity: a.quantity,
        })),
      })),
      p_notes: validatedCustomer.notes || null,
    })

    if (placeError) {
      const sanitized = sanitizeCustomerErrorMessage(placeError.message)
      throw new Error(sanitized)
    }

    if (!serverOrder) {
      throw new Error('Order creation failed on server. Please try again.')
    }

    const authoritativeOrder: Order = {
      id: serverOrder.id,
      businessId: serverOrder.businessId,
      branchId: serverOrder.branchId,
      orderNumber: serverOrder.orderNumber,
      secureAccessToken: serverOrder.secureAccessToken,
      customerName: serverOrder.customerName,
      customerPhone: serverOrder.customerPhone,
      status: serverOrder.status,
      paymentStatus: serverOrder.paymentStatus,
      paymentMethod: serverOrder.paymentMethod,
      subtotalPaisa: Number(serverOrder.subtotalPaisa),
      discountPaisa: Number(serverOrder.discountPaisa || 0),
      taxPaisa: Number(serverOrder.taxPaisa),
      totalPaisa: Number(serverOrder.totalPaisa),
      notes: serverOrder.notes,
      pickupToken: serverOrder.pickupToken
        ? {
            id: `tok_${serverOrder.id}`,
            orderId: serverOrder.id,
            businessId: serverOrder.businessId,
            branchId: serverOrder.branchId,
            tokenDisplay: serverOrder.pickupToken.tokenDisplay,
            sequenceNum: Number(serverOrder.pickupToken.sequenceNum),
            tokenDate: serverOrder.pickupToken.tokenDate,
            createdAt: serverOrder.createdAt,
          }
        : undefined,
      items: (serverOrder.items || []).map((i: any) => ({
        id: i.id,
        orderId: serverOrder.id,
        productId: i.productId,
        itemNameSnapshot: i.itemNameSnapshot,
        variantNameSnapshot: i.variantNameSnapshot,
        unitPricePaisa: Number(i.unitPricePaisa),
        quantity: i.quantity,
        addonsSnapshot: i.addonsSnapshot,
        lineTotalPaisa: Number(i.lineTotalPaisa),
      })),
      createdAt: serverOrder.createdAt,
      updatedAt: serverOrder.createdAt,
    }

    persistOrder(authoritativeOrder)
    broadcastOrderEvent({
      eventType: 'ORDER_PLACED',
      orderId: authoritativeOrder.id,
      secureAccessToken: authoritativeOrder.secureAccessToken,
      businessId: authoritativeOrder.businessId,
      status: authoritativeOrder.status,
      tokenDisplay: authoritativeOrder.pickupToken?.tokenDisplay,
      paymentStatus: authoritativeOrder.paymentStatus,
    })
    return authoritativeOrder
  }

  // Local demo fallback: ONLY active when Supabase is unconfigured or testing with offline benchmark shop (non-UUID business ID)
  persistOrder(newOrder)
  broadcastOrderEvent({
    eventType: 'ORDER_PLACED',
    orderId: newOrder.id,
    secureAccessToken: newOrder.secureAccessToken,
    businessId: newOrder.businessId,
    status: newOrder.status,
    tokenDisplay: newOrder.pickupToken?.tokenDisplay,
    paymentStatus: newOrder.paymentStatus,
  })
  return newOrder
}

/**
 * Server-authorized cash collection at counter.
 * Invokes the secure PostgreSQL function `collect_cash_order` when Supabase is active.
 */
export async function collectCashForOrder(orderId: string): Promise<Order | null> {
  const existing = Array.from(inMemoryOrders.values()).find((o) => o.id === orderId)
  const now = new Date().toISOString()

  if (isSupabaseConfigured && isUuid(orderId)) {
    try {
      const { data, error } = await supabase.rpc('collect_cash_order', {
        p_order_id: orderId,
      })

      if (error) {
        throw new Error(error.message)
      }

      if (data) {
        const tokenObj = data.pickup_tokens?.[0] || existing?.pickupToken
        const itemsArr =
          data.order_items && data.order_items.length > 0
            ? data.order_items.map((i: any) => ({
                id: i.id,
                orderId: i.order_id,
                productId: i.product_id,
                itemNameSnapshot: i.item_name_snapshot,
                variantNameSnapshot: i.variant_name_snapshot,
                unitPricePaisa: Number(i.unit_price_paisa),
                quantity: i.quantity,
                addonsSnapshot: i.addons_snapshot || [],
                lineTotalPaisa: Number(i.line_total_paisa),
              }))
            : existing?.items || []

        const updatedOrder: Order = {
          ...(existing || ({} as any)),
          id: data.id,
          businessId: data.business_id,
          branchId: data.branch_id,
          orderNumber: data.order_number,
          secureAccessToken: data.secure_access_token || existing?.secureAccessToken || '',
          customerName: data.customer_name || existing?.customerName || '',
          customerPhone: data.customer_phone || existing?.customerPhone || '',
          status: (data.status as OrderStatus) || 'PREPARING',
          paymentStatus: 'PAID',
          paymentMethod: 'CASH_COUNTER',
          subtotalPaisa: Number(data.subtotal_paisa || existing?.subtotalPaisa || 0),
          discountPaisa: Number(data.discount_paisa || existing?.discountPaisa || 0),
          taxPaisa: Number(data.tax_paisa || existing?.taxPaisa || 0),
          totalPaisa: Number(data.total_paisa || existing?.totalPaisa || 0),
          items: itemsArr,
          pickupToken: tokenObj
            ? {
                id: tokenObj.id,
                orderId: tokenObj.order_id || tokenObj.orderId || data.id,
                businessId: tokenObj.business_id || tokenObj.businessId || data.business_id,
                branchId: tokenObj.branch_id || tokenObj.branchId || data.branch_id,
                tokenDisplay: tokenObj.token_display || tokenObj.tokenDisplay,
                sequenceNum: Number(tokenObj.sequence_num || tokenObj.sequenceNum),
                tokenDate: tokenObj.token_date || tokenObj.tokenDate,
                createdAt: tokenObj.created_at || tokenObj.createdAt,
              }
            : undefined,
          notes: data.notes,
          createdAt: data.created_at || existing?.createdAt || now,
          updatedAt: data.updated_at || now,
        }
        persistOrder(updatedOrder)
        broadcastOrderEvent({
          eventType: 'CASH_COLLECTED',
          orderId: updatedOrder.id,
          secureAccessToken: updatedOrder.secureAccessToken,
          businessId: updatedOrder.businessId,
          status: updatedOrder.status,
          tokenDisplay: updatedOrder.pickupToken?.tokenDisplay,
          paymentStatus: 'PAID',
        })
        return updatedOrder
      }
    } catch (e: any) {
      console.warn('Supabase cash collection RPC error:', e.message)
      throw e
    }
  }

  if (existing) {
    const updatedOrder: Order = {
      ...existing,
      paymentStatus: 'PAID',
      status: existing.status === 'PLACED' ? 'PREPARING' : existing.status,
      updatedAt: now,
    }
    persistOrder(updatedOrder)
    broadcastOrderEvent({
      eventType: 'CASH_COLLECTED',
      orderId: updatedOrder.id,
      secureAccessToken: updatedOrder.secureAccessToken,
      businessId: updatedOrder.businessId,
      status: updatedOrder.status,
      tokenDisplay: updatedOrder.pickupToken?.tokenDisplay,
      paymentStatus: 'PAID',
    })
    return updatedOrder
  }

  return null
}

/**
 * Retrieve an order safely by its unique secure access token.
 * Uses the secure SECURITY DEFINER RPC `get_customer_order_by_token` to guarantee
 * zero public table-scanning or data leakage.
 */
export async function getOrderBySecureToken(secureAccessToken: string): Promise<Order | null> {
  if (!secureAccessToken || typeof secureAccessToken !== 'string' || !secureAccessToken.trim()) {
    return null
  }

  if (isSupabaseConfigured) {
    try {
      // 1. Preferred secure access path: RPC validating unguessable secure token
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_customer_order_by_token', {
        p_secure_token: secureAccessToken,
      })

      if (!rpcError && rpcData) {
        const authoritativeOrder: Order = {
          id: rpcData.id,
          businessId: rpcData.business_id,
          branchId: rpcData.branch_id,
          orderNumber: rpcData.order_number,
          secureAccessToken: rpcData.secure_access_token,
          customerName: rpcData.customer_name,
          customerPhone: rpcData.customer_phone,
          status: rpcData.status,
          paymentStatus: rpcData.payment_status,
          paymentMethod: rpcData.payment_method,
          subtotalPaisa: Number(rpcData.subtotal_paisa),
          discountPaisa: Number(rpcData.discount_paisa),
          taxPaisa: Number(rpcData.tax_paisa),
          totalPaisa: Number(rpcData.total_paisa),
          notes: rpcData.notes,
          pickupToken: rpcData.pickup_token
            ? {
                id: rpcData.pickup_token.id,
                orderId: rpcData.pickup_token.order_id,
                businessId: rpcData.pickup_token.business_id,
                branchId: rpcData.pickup_token.branch_id,
                tokenDisplay: rpcData.pickup_token.token_display,
                sequenceNum: Number(rpcData.pickup_token.sequence_num),
                tokenDate: rpcData.pickup_token.token_date,
                createdAt: rpcData.pickup_token.created_at,
              }
            : undefined,
          items: (rpcData.items || []).map((i: any) => ({
            id: i.id,
            orderId: i.order_id,
            productId: i.product_id,
            itemNameSnapshot: i.item_name_snapshot,
            variantNameSnapshot: i.variant_name_snapshot,
            unitPricePaisa: Number(i.unit_price_paisa),
            quantity: i.quantity,
            addonsSnapshot: i.addons_snapshot,
            lineTotalPaisa: Number(i.line_total_paisa),
          })),
          createdAt: rpcData.created_at,
          updatedAt: rpcData.updated_at,
        }

        persistOrder(authoritativeOrder)
        return authoritativeOrder
      }

      // 2. Fallback to direct query if RPC is not yet applied on remote DB
      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*), pickup_tokens(*)')
        .eq('secure_access_token', secureAccessToken)
        .single()

      if (!error && data) {
        return {
          id: data.id,
          businessId: data.business_id,
          branchId: data.branch_id,
          orderNumber: data.order_number,
          secureAccessToken: data.secure_access_token,
          customerName: data.customer_name,
          customerPhone: data.customer_phone,
          status: data.status,
          paymentStatus: data.payment_status,
          paymentMethod: data.payment_method,
          subtotalPaisa: Number(data.subtotal_paisa),
          discountPaisa: Number(data.discount_paisa),
          taxPaisa: Number(data.tax_paisa),
          totalPaisa: Number(data.total_paisa),
          notes: data.notes,
          pickupToken: data.pickup_tokens?.[0]
            ? {
                id: data.pickup_tokens[0].id,
                orderId: data.pickup_tokens[0].order_id,
                businessId: data.pickup_tokens[0].business_id,
                branchId: data.pickup_tokens[0].branch_id,
                tokenDisplay: data.pickup_tokens[0].token_display,
                sequenceNum: Number(data.pickup_tokens[0].sequence_num),
                tokenDate: data.pickup_tokens[0].token_date,
                createdAt: data.pickup_tokens[0].created_at,
              }
            : undefined,
          items: data.order_items.map((i: any) => ({
            id: i.id,
            orderId: i.order_id,
            productId: i.product_id,
            itemNameSnapshot: i.item_name_snapshot,
            variantNameSnapshot: i.variant_name_snapshot,
            unitPricePaisa: Number(i.unit_price_paisa),
            quantity: i.quantity,
            addonsSnapshot: i.addons_snapshot,
            lineTotalPaisa: Number(i.line_total_paisa),
          })),
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        }
      }
    } catch (err) {
      console.warn('Could not fetch from Supabase, checking local store:', err)
    }
  }

  return inMemoryOrders.get(secureAccessToken) || null
}

/**
 * Clear local in-memory order cache and localStorage.
 */
export function clearLocalOrders(): void {
  inMemoryOrders.clear()
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
      window.localStorage.removeItem(DEMO_SEQ_KEY)
      window.localStorage.removeItem('quickbite_last_placed_order')
      window.localStorage.removeItem('quickbite_cart')
    } catch {
      // Ignore
    }
  }
}

/**
 * Retrieve all orders for merchant dashboard and kitchen display.
 * Uses atomic get_merchant_orders RPC with fallback to direct query.
 * When Supabase is configured and queries succeed, returns live data (even if empty []).
 */
export async function getMerchantOrders(businessId?: string): Promise<Order[]> {
  // Always hydrate any local orders first for resilience
  hydrateFromLocalStorage()

  if (isSupabaseConfigured) {
    try {
      // 1. Preferred secure RPC path: bypasses RLS blocks for live merchant terminals
      let rpcRes = await supabase.rpc('get_merchant_orders', {
        p_business_id: businessId && isUuid(businessId) ? businessId : null,
      })

      if (rpcRes.error) {
        rpcRes = await supabase.rpc('get_merchant_orders')
      }

      const { data: rpcData, error: rpcError } = rpcRes

      if (!rpcError && Array.isArray(rpcData)) {
        const mapped = rpcData.map((d: any) => ({
          id: d.id,
          businessId: d.business_id,
          branchId: d.branch_id,
          orderNumber: d.order_number,
          secureAccessToken: d.secure_access_token,
          customerName: d.customer_name,
          customerPhone: d.customer_phone,
          status: d.status,
          paymentStatus: d.payment_status,
          paymentMethod: d.payment_method,
          subtotalPaisa: Number(d.subtotal_paisa),
          discountPaisa: Number(d.discount_paisa || 0),
          taxPaisa: Number(d.tax_paisa),
          totalPaisa: Number(d.total_paisa),
          notes: d.notes,
          pickupToken: d.pickup_tokens?.[0]
            ? {
                id: d.pickup_tokens[0].id,
                orderId: d.pickup_tokens[0].order_id,
                businessId: d.pickup_tokens[0].business_id,
                branchId: d.pickup_tokens[0].branch_id,
                tokenDisplay: d.pickup_tokens[0].token_display,
                sequenceNum: Number(d.pickup_tokens[0].sequence_num),
                tokenDate: d.pickup_tokens[0].token_date,
                createdAt: d.pickup_tokens[0].created_at,
              }
            : undefined,
          items: (d.order_items || []).map((i: any) => ({
            id: i.id,
            orderId: i.order_id,
            productId: i.product_id,
            itemNameSnapshot: i.item_name_snapshot,
            variantNameSnapshot: i.variant_name_snapshot,
            unitPricePaisa: Number(i.unit_price_paisa),
            quantity: i.quantity,
            addonsSnapshot: i.addons_snapshot || [],
            lineTotalPaisa: Number(i.line_total_paisa),
          })),
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        }))

        // Cache live orders in inMemoryOrders
        for (const o of mapped) {
          inMemoryOrders.set(o.secureAccessToken, o)
        }

        // Include any local non-benchmark orders not yet synced to Supabase
        const remoteIds = new Set(mapped.map((m) => m.id))
        const localUnsynced = Array.from(inMemoryOrders.values()).filter(
          (o) => !remoteIds.has(o.id) && !BENCHMARK_ORDERS.some((b) => b.id === o.id)
        )
        const combined = [...mapped, ...localUnsynced]

        return combined.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      }

      // 2. Fallback to direct query if RPC is not yet created
      let query = supabase
        .from('orders')
        .select('*, order_items(*), pickup_tokens(*)')
        .order('created_at', { ascending: false })
        .limit(100)

      if (businessId && isUuid(businessId)) {
        query = query.eq('business_id', businessId)
      }

      const { data, error } = await query

      if (!error && Array.isArray(data)) {
        if (data.length === 0) {
          if (inMemoryOrders.size > 0) {
            return Array.from(inMemoryOrders.values()).sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            )
          }
          return []
        }

        const mapped = data.map((d: any) => ({
          id: d.id,
          businessId: d.business_id,
          branchId: d.branch_id,
          orderNumber: d.order_number,
          secureAccessToken: d.secure_access_token,
          customerName: d.customer_name,
          customerPhone: d.customer_phone,
          status: d.status,
          paymentStatus: d.payment_status,
          paymentMethod: d.payment_method,
          subtotalPaisa: Number(d.subtotal_paisa),
          discountPaisa: Number(d.discount_paisa || 0),
          taxPaisa: Number(d.tax_paisa),
          totalPaisa: Number(d.total_paisa),
          notes: d.notes,
          pickupToken: d.pickup_tokens?.[0]
            ? {
                id: d.pickup_tokens[0].id,
                orderId: d.pickup_tokens[0].order_id,
                businessId: d.pickup_tokens[0].business_id,
                branchId: d.pickup_tokens[0].branch_id,
                tokenDisplay: d.pickup_tokens[0].token_display,
                sequenceNum: Number(d.pickup_tokens[0].sequence_num),
                tokenDate: d.pickup_tokens[0].token_date,
                createdAt: d.pickup_tokens[0].created_at,
              }
            : undefined,
          items: (d.order_items || []).map((i: any) => ({
            id: i.id,
            orderId: i.order_id,
            productId: i.product_id,
            itemNameSnapshot: i.item_name_snapshot,
            variantNameSnapshot: i.variant_name_snapshot,
            unitPricePaisa: Number(i.unit_price_paisa),
            quantity: i.quantity,
            addonsSnapshot: i.addons_snapshot || [],
            lineTotalPaisa: Number(i.line_total_paisa),
          })),
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        }))

        // Cache live orders in inMemoryOrders for synchronous lookups
        for (const o of mapped) {
          inMemoryOrders.set(o.secureAccessToken, o)
        }

        const remoteIds = new Set(mapped.map((m) => m.id))
        const localUnsynced = Array.from(inMemoryOrders.values()).filter(
          (o) => !remoteIds.has(o.id) && !BENCHMARK_ORDERS.some((b) => b.id === o.id)
        )
        const combined = [...mapped, ...localUnsynced]

        return combined.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      }
    } catch (err) {
      console.warn('Could not fetch merchant orders from Supabase:', err)
    }

    if (inMemoryOrders.size > 0) {
      return Array.from(inMemoryOrders.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    }

    // In live Supabase mode, if query returned empty or failed to load, don't show fake benchmark orders
    return []
  }

  // Return in-memory orders sorted by creation time descending (demo mode only)
  return Array.from(inMemoryOrders.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

/**
 * Update the status of an order (e.g., PLACED -> PREPARING -> READY -> COMPLETED).
 * Uses atomic update_order_status RPC with fallback to direct table update.
 */
export async function updateOrderStatus(orderId: string, nextStatus: OrderStatus): Promise<Order | null> {
  const existing = Array.from(inMemoryOrders.values()).find((o) => o.id === orderId)
  const now = new Date().toISOString()

  if (isSupabaseConfigured && isUuid(orderId)) {
    try {
      // 1. Try atomic, audited RPC function
      const { data: rpcData, error: rpcError } = await supabase.rpc('update_order_status', {
        p_order_id: orderId,
        p_next_status: nextStatus,
      })

      if (!rpcError && rpcData) {
        const tokenObj = rpcData.pickup_tokens?.[0] || existing?.pickupToken
        const itemsArr =
          rpcData.order_items && rpcData.order_items.length > 0
            ? rpcData.order_items.map((i: any) => ({
                id: i.id,
                orderId: i.order_id,
                productId: i.product_id,
                itemNameSnapshot: i.item_name_snapshot,
                variantNameSnapshot: i.variant_name_snapshot,
                unitPricePaisa: Number(i.unit_price_paisa),
                quantity: i.quantity,
                addonsSnapshot: i.addons_snapshot || [],
                lineTotalPaisa: Number(i.line_total_paisa),
              }))
            : existing?.items || []

        const updated: Order = {
          ...(existing || {}),
          id: rpcData.id,
          businessId: rpcData.business_id,
          branchId: rpcData.branch_id,
          orderNumber: rpcData.order_number,
          secureAccessToken: rpcData.secure_access_token || existing?.secureAccessToken || '',
          customerName: rpcData.customer_name || existing?.customerName || '',
          customerPhone: rpcData.customer_phone || existing?.customerPhone || '',
          status: rpcData.status as OrderStatus,
          paymentStatus: rpcData.payment_status,
          paymentMethod: rpcData.payment_method,
          subtotalPaisa: Number(rpcData.subtotal_paisa),
          discountPaisa: Number(rpcData.discount_paisa || 0),
          taxPaisa: Number(rpcData.tax_paisa),
          totalPaisa: Number(rpcData.total_paisa),
          notes: rpcData.notes,
          pickupToken: tokenObj
            ? {
                id: tokenObj.id,
                orderId: tokenObj.order_id || tokenObj.orderId || rpcData.id,
                businessId: tokenObj.business_id || tokenObj.businessId || rpcData.business_id,
                branchId: tokenObj.branch_id || tokenObj.branchId || rpcData.branch_id,
                tokenDisplay: tokenObj.token_display || tokenObj.tokenDisplay,
                sequenceNum: Number(tokenObj.sequence_num || tokenObj.sequenceNum),
                tokenDate: tokenObj.token_date || tokenObj.tokenDate,
                createdAt: tokenObj.created_at || tokenObj.createdAt,
              }
            : undefined,
          items: itemsArr,
          createdAt: rpcData.created_at || existing?.createdAt || now,
          updatedAt: rpcData.updated_at || now,
        }
        persistOrder(updated)
        broadcastOrderEvent({
          eventType: 'STATUS_CHANGED',
          orderId: updated.id,
          secureAccessToken: updated.secureAccessToken,
          businessId: updated.businessId,
          status: updated.status,
          tokenDisplay: updated.pickupToken?.tokenDisplay,
          paymentStatus: updated.paymentStatus,
        })
        return updated
      }

      // 2. Fallback to direct table update
      const { error } = await supabase
        .from('orders')
        .update({ status: nextStatus, updated_at: now })
        .eq('id', orderId)

      if (error) {
        console.warn('Failed to update order status in Supabase:', error.message)
      }
    } catch (err) {
      console.warn('Supabase update status error:', err)
    }
  }

  if (existing) {
    const updated: Order = {
      ...existing,
      status: nextStatus,
      updatedAt: now,
    }
    persistOrder(updated)
    broadcastOrderEvent({
      eventType: 'STATUS_CHANGED',
      orderId: updated.id,
      secureAccessToken: updated.secureAccessToken,
      businessId: updated.businessId,
      status: updated.status,
      tokenDisplay: updated.pickupToken?.tokenDisplay,
      paymentStatus: updated.paymentStatus,
    })
    return updated
  }

  return null
}
