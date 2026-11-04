import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { OrderStatus } from '@/types/order'

export type OrderEventType =
  | 'ORDER_PLACED'
  | 'ORDER_PAID'
  | 'STATUS_CHANGED'
  | 'CASH_COLLECTED'
  | 'FORCE_REFRESH'

export interface OrderRealtimePayload {
  eventType: OrderEventType
  orderId: string
  secureAccessToken?: string
  businessId?: string
  status?: OrderStatus
  tokenDisplay?: string
  paymentStatus?: string
  timestamp: number
}

export type CatalogEventType =
  | 'CATALOG_UPDATED'
  | 'PRODUCT_TOGGLED'
  | 'PRODUCT_PRICE_UPDATED'
  | 'PRODUCT_CREATED'
  | 'PRODUCT_DELETED'

export interface CatalogRealtimePayload {
  eventType: CatalogEventType
  productId?: string
  isAvailable?: boolean
  basePricePaisa?: number
  product?: any
  timestamp: number
}

export type TenantEventType =
  | 'TENANT_CREATED'
  | 'TENANT_UPDATED'
  | 'TENANT_STATUS_TOGGLED'
  | 'TENANT_DELETED'

export interface TenantRealtimePayload {
  eventType: TenantEventType
  tenantId?: string
  isActive?: boolean
  tier?: string
  tenant?: any
  timestamp: number
}

const REALTIME_CHANNEL_NAME = 'quickbite-live-sync'
const CLIENT_INSTANCE_ID = `inst_${Math.random().toString(36).slice(2, 9)}`
let sharedChannel: ReturnType<typeof supabase.channel> | null = null

const orderListeners = new Set<(payload: OrderRealtimePayload) => void>()
const catalogListeners = new Set<(payload: CatalogRealtimePayload) => void>()
const tenantListeners = new Set<(payload: TenantRealtimePayload) => void>()

function ensureSharedChannel() {
  if (!sharedChannel && isSupabaseConfigured) {
    try {
      sharedChannel = supabase.channel(REALTIME_CHANNEL_NAME, {
        config: {
          broadcast: { ack: false, self: true },
        },
      })

      sharedChannel
        .on('broadcast', { event: 'order-event' }, (msg) => {
          if (msg && msg.payload) {
            const payload = msg.payload as OrderRealtimePayload & { originId?: string }
            if (payload.originId !== CLIENT_INSTANCE_ID) {
              notifyOrderListeners(payload)
            }
          }
        })
        .on('broadcast', { event: 'catalog-event' }, (msg) => {
          if (msg && msg.payload) {
            const payload = msg.payload as CatalogRealtimePayload & { originId?: string }
            if (payload.originId !== CLIENT_INSTANCE_ID) {
              notifyCatalogListeners(payload)
            }
          }
        })
        .on('broadcast', { event: 'tenant-event' }, (msg) => {
          if (msg && msg.payload) {
            const payload = msg.payload as TenantRealtimePayload & { originId?: string }
            if (payload.originId !== CLIENT_INSTANCE_ID) {
              notifyTenantListeners(payload)
            }
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload: any) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) || payload.old || payload.new || {}
          notifyOrderListeners({
            eventType: payload.eventType === 'INSERT' ? 'ORDER_PLACED' : 'STATUS_CHANGED',
            orderId: row.id,
            secureAccessToken: row.secure_access_token,
            businessId: row.business_id,
            status: row.status,
            paymentStatus: row.payment_status,
            timestamp: Date.now(),
          })
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload: any) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) || payload.old || payload.new || {}
          notifyCatalogListeners({
            eventType:
              payload.eventType === 'INSERT'
                ? 'PRODUCT_CREATED'
                : payload.eventType === 'DELETE'
                ? 'PRODUCT_DELETED'
                : 'CATALOG_UPDATED',
            productId: row.id,
            isAvailable: row.is_available,
            basePricePaisa: row.base_price_paisa ? Number(row.base_price_paisa) : undefined,
            product: row,
            timestamp: Date.now(),
          })
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
          notifyCatalogListeners({
            eventType: 'CATALOG_UPDATED',
            timestamp: Date.now(),
          })
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'businesses' }, (payload: any) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) || payload.old || payload.new || {}
          notifyTenantListeners({
            eventType: 'TENANT_UPDATED',
            tenantId: row.id,
            isActive: row.is_active,
            tier: row.tier,
            tenant: row,
            timestamp: Date.now(),
          })
        })
        .subscribe((status, err) => {
          if (err) {
            console.warn('Supabase Realtime subscription status:', status, err)
          }
        })
    } catch (err) {
      console.warn('Failed to initialize Supabase Realtime channel:', err)
    }
  }
  return sharedChannel
}

function notifyOrderListeners(payload: OrderRealtimePayload): void {
  for (const cb of Array.from(orderListeners)) {
    try {
      cb(payload)
    } catch (e) {
      console.warn('Error in order event listener:', e)
    }
  }
}

function notifyCatalogListeners(payload: CatalogRealtimePayload): void {
  for (const cb of Array.from(catalogListeners)) {
    try {
      cb(payload)
    } catch (e) {
      console.warn('Error in catalog event listener:', e)
    }
  }
}

function notifyTenantListeners(payload: TenantRealtimePayload): void {
  for (const cb of Array.from(tenantListeners)) {
    try {
      cb(payload)
    } catch (e) {
      console.warn('Error in tenant event listener:', e)
    }
  }
}

/**
 * Broadcast an order event across all connected clients (KDS, Customer Tracking, Merchant Portals)
 * through Supabase Realtime WebSockets, local window CustomEvents, and cross-tab storage events.
 */
export function broadcastOrderEvent(payload: Omit<OrderRealtimePayload, 'timestamp'>): void {
  const fullPayload: OrderRealtimePayload = {
    ...payload,
    timestamp: Date.now(),
  }

  // 1. Immediately notify local in-memory listeners (0ms instant response)
  notifyOrderListeners(fullPayload)

  // 2. Supabase Realtime WebSocket broadcast (cross-device & cross-client)
  if (isSupabaseConfigured) {
    try {
      const ch = ensureSharedChannel()
      if (ch) {
        ch.send({
          type: 'broadcast',
          event: 'order-event',
          payload: { ...fullPayload, originId: CLIENT_INSTANCE_ID },
        }).catch((err) => {
          console.warn('Realtime broadcast error:', err)
        })
      }
    } catch (err) {
      console.warn('Could not send realtime broadcast:', err)
    }
  }

  // 3. Local window custom event dispatch (same document components)
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('quickbite:order-event', { detail: fullPayload }))
    } catch {
      // Ignore
    }

    // 4. Local storage event (same browser, other tabs)
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: 'quickbite_orders_store' }))
    } catch {
      // Ignore
    }
  }
}

/**
 * Subscribe to real-time order lifecycle events.
 * Listens to Supabase WebSockets, local custom events, and cross-tab storage events.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToOrderEvents(callback: (payload: OrderRealtimePayload) => void): () => void {
  orderListeners.add(callback)
  ensureSharedChannel()

  const handleCustomEvent = (e: Event) => {
    const custom = e as CustomEvent<OrderRealtimePayload>
    if (custom.detail) {
      callback(custom.detail)
    }
  }

  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === 'quickbite_orders_store') {
      callback({
        eventType: 'FORCE_REFRESH',
        orderId: '',
        timestamp: Date.now(),
      })
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('quickbite:order-event', handleCustomEvent)
    window.addEventListener('storage', handleStorageEvent)
  }

  return () => {
    orderListeners.delete(callback)
    if (typeof window !== 'undefined') {
      window.removeEventListener('quickbite:order-event', handleCustomEvent)
      window.removeEventListener('storage', handleStorageEvent)
    }
  }
}

/**
 * Broadcast a menu catalog update event (price change, availability toggle, item add, item delete)
 */
export function broadcastCatalogEvent(payload: Omit<CatalogRealtimePayload, 'timestamp'>): void {
  const fullPayload: CatalogRealtimePayload = {
    ...payload,
    timestamp: Date.now(),
  }

  notifyCatalogListeners(fullPayload)

  if (isSupabaseConfigured) {
    try {
      const ch = ensureSharedChannel()
      if (ch) {
        ch.send({
          type: 'broadcast',
          event: 'catalog-event',
          payload: { ...fullPayload, originId: CLIENT_INSTANCE_ID },
        }).catch((err) => {
          console.warn('Realtime catalog broadcast error:', err)
        })
      }
    } catch (err) {
      console.warn('Could not send realtime catalog broadcast:', err)
    }
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('quickbite:catalog-event', { detail: fullPayload }))
    } catch {
      // Ignore
    }
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: 'quickbite_catalog_overrides' }))
    } catch {
      // Ignore
    }
  }
}

/**
 * Subscribe to real-time catalog changes across merchant and customer ordering screens.
 */
export function subscribeToCatalogEvents(callback: (payload: CatalogRealtimePayload) => void): () => void {
  catalogListeners.add(callback)
  ensureSharedChannel()

  const handleCustomEvent = (e: Event) => {
    const custom = e as CustomEvent<CatalogRealtimePayload>
    if (custom.detail) {
      callback(custom.detail)
    }
  }

  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === 'quickbite_catalog_overrides') {
      callback({
        eventType: 'CATALOG_UPDATED',
        timestamp: Date.now(),
      })
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('quickbite:catalog-event', handleCustomEvent)
    window.addEventListener('storage', handleStorageEvent)
  }

  return () => {
    catalogListeners.delete(callback)
    if (typeof window !== 'undefined') {
      window.removeEventListener('quickbite:catalog-event', handleCustomEvent)
      window.removeEventListener('storage', handleStorageEvent)
    }
  }
}

/**
 * Broadcast tenant/business lifecycle updates to platform super admin console.
 */
export function broadcastTenantEvent(payload: Omit<TenantRealtimePayload, 'timestamp'>): void {
  const fullPayload: TenantRealtimePayload = {
    ...payload,
    timestamp: Date.now(),
  }

  notifyTenantListeners(fullPayload)

  if (isSupabaseConfigured) {
    try {
      const ch = ensureSharedChannel()
      if (ch) {
        ch.send({
          type: 'broadcast',
          event: 'tenant-event',
          payload: { ...fullPayload, originId: CLIENT_INSTANCE_ID },
        }).catch((err) => {
          console.warn('Realtime tenant broadcast error:', err)
        })
      }
    } catch (err) {
      console.warn('Could not send realtime tenant broadcast:', err)
    }
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('quickbite:tenant-event', { detail: fullPayload }))
    } catch {
      // Ignore
    }
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: 'quickbite_tenants_store' }))
    } catch {
      // Ignore
    }
  }
}

/**
 * Subscribe to tenant fleet updates.
 */
export function subscribeToTenantEvents(callback: (payload: TenantRealtimePayload) => void): () => void {
  tenantListeners.add(callback)
  ensureSharedChannel()

  const handleCustomEvent = (e: Event) => {
    const custom = e as CustomEvent<TenantRealtimePayload>
    if (custom.detail) {
      callback(custom.detail)
    }
  }

  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === 'quickbite_tenants_store') {
      callback({
        eventType: 'TENANT_UPDATED',
        timestamp: Date.now(),
      })
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('quickbite:tenant-event', handleCustomEvent)
    window.addEventListener('storage', handleStorageEvent)
  }

  return () => {
    tenantListeners.delete(callback)
    if (typeof window !== 'undefined') {
      window.removeEventListener('quickbite:tenant-event', handleCustomEvent)
      window.removeEventListener('storage', handleStorageEvent)
    }
  }
}

