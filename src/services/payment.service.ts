import type { Order } from '@/types/order'
import { persistOrder } from './order.service'
import { broadcastOrderEvent } from './realtime.service'

declare global {
  interface Window {
    Razorpay: any
  }
}

let razorpayScriptPromise: Promise<boolean> | null = null

/**
 * Dynamically loads the official Razorpay Checkout SDK script with caching and deduplication.
 */
export function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return Promise.resolve(false)
  }

  if (window.Razorpay) {
    return Promise.resolve(true)
  }

  if (razorpayScriptPromise) {
    return razorpayScriptPromise
  }

  razorpayScriptPromise = new Promise((resolve) => {
    // Check if script is already present in document (e.g. from prefetch in index.html)
    const existing = document.querySelector('script[src*="checkout.razorpay.com"]')
    if (existing) {
      if (window.Razorpay) {
        resolve(true)
        return
      }
      existing.addEventListener('load', () => resolve(true), { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      // Fallback check after 300ms in case it finished before event listener attached
      setTimeout(() => {
        if (window.Razorpay) resolve(true)
      }, 300)
      return
    }

    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => {
      console.warn('Could not load Razorpay SDK from checkout.razorpay.com')
      resolve(false)
    }
    document.head.appendChild(script)
  })

  return razorpayScriptPromise
}

export interface RazorpayOrderPrefetchResult {
  razorpayOrderId: string
  amountPaisa: number
  keyId: string
}

const razorpayOrderCache = new Map<string, Promise<RazorpayOrderPrefetchResult>>()

/**
 * Prefetches and caches trusted Razorpay Order from server Edge Function in the background
 * to eliminate payment button latency and provide 0ms modal opening.
 */
export function prefetchRazorpayOrder(
  orderId: string,
  secureAccessToken: string
): Promise<RazorpayOrderPrefetchResult> {
  const cacheKey = `${orderId}:${secureAccessToken}`
  const cached = razorpayOrderCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return Promise.reject(new Error('Payment gateway backend is not configured.'))
  }

  const fetchPromise = (async () => {
    const res = await fetch(`${supabaseUrl}/functions/v1/create-razorpay-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        orderId,
        secureAccessToken,
      }),
    })

    const data = await res.json()

    if (!res.ok || !data.razorpayOrderId) {
      razorpayOrderCache.delete(cacheKey) // Don't cache errors
      throw new Error(data.error || 'Failed to initialize payment order on server.')
    }

    return {
      razorpayOrderId: data.razorpayOrderId,
      amountPaisa: Number(data.amountPaisa),
      keyId: data.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID,
    }
  })()

  razorpayOrderCache.set(cacheKey, fetchPromise)
  return fetchPromise
}

export interface PaymentHandlerOptions {
  order: Order
  shopName: string
  onSuccess: (updatedOrder: Order) => void
  onError: (errorMessage: string) => void
  onDismiss?: () => void
}

/**
 * Initiates Razorpay Payment for a pending order.
 * Strictly uses Supabase Edge Functions for order creation and verification.
 * No browser-side mock verification or client-side token allocation exists.
 */
export async function startRazorpayCheckout({
  order,
  shopName,
  onSuccess,
  onError,
  onDismiss,
}: PaymentHandlerOptions): Promise<void> {
  // 1. Ensure Razorpay SDK is loaded
  const isLoaded = await loadRazorpayScript()
  if (!isLoaded || !window.Razorpay) {
    onError('Unable to load payment gateway. Please disable ad-blockers and try again.')
    return
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    onError('Payment gateway backend is not configured.')
    return
  }

  let razorpayOrderId: string
  let keyId: string
  let serverAmountPaisa = order.totalPaisa

  // 2. Retrieve trusted Razorpay Order (fast path from prefetch cache or server)
  try {
    const orderData = await prefetchRazorpayOrder(order.id, order.secureAccessToken)
    razorpayOrderId = orderData.razorpayOrderId
    serverAmountPaisa = orderData.amountPaisa
    keyId = orderData.keyId
  } catch (err: any) {
    onError(err.message || 'Server connection error while initializing payment.')
    return
  }

  const cleanPhone = order.customerPhone.replace(/[^0-9]/g, '').slice(-10)

  // 3. Open official Razorpay modal using server-authoritative amount
  // Clean, high-performance configuration: avoids sluggish custom instrument block parsing
  const options = {
    key: keyId,
    amount: serverAmountPaisa, // In Integer Paisa from PostgreSQL authoritative order
    currency: 'INR',
    name: shopName,
    description: `Token Pickup Order ${order.orderNumber}`,
    order_id: razorpayOrderId,
    prefill: {
      name: order.customerName,
      contact: cleanPhone,
    },
    notes: {
      order_id: order.id,
      secure_token: order.secureAccessToken,
    },
    theme: {
      color: '#D95732',
      backdrop_color: 'rgba(0,0,0,0.65)',
    },
    retry: {
      enabled: true,
      max_count: 3,
    },
    modal: {
      confirm_close: true,
      backdropclose: false,
      ondismiss: () => {
        if (onDismiss) onDismiss()
      },
    },
    handler: async (response: {
      razorpay_payment_id: string
      razorpay_order_id: string
      razorpay_signature: string
    }) => {
      // 4. Verify payment EXCLUSIVELY through secure server Edge Function
      try {
        const verifyRes = await fetch(`${supabaseUrl}/functions/v1/verify-razorpay-payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            orderId: order.id,
            secureAccessToken: order.secureAccessToken,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          }),
        })

        const verifyData = await verifyRes.json()

        if (!verifyRes.ok || !verifyData.verified) {
          onError(verifyData.error || 'Payment signature verification failed on server.')
          return
        }

        // 5. Construct verified order state returned by server
        const confirmedOrder: Order = {
          ...order,
          status: 'PLACED',
          paymentStatus: 'PAID',
          pickupToken: {
            id: `tok_${order.id}`,
            orderId: order.id,
            businessId: order.businessId,
            branchId: order.branchId,
            tokenDisplay: verifyData.tokenDisplay,
            sequenceNum: verifyData.sequenceNum,
            tokenDate: new Date().toISOString().slice(0, 10),
            createdAt: new Date().toISOString(),
          },
        }

        // Persist verified order immediately in local cache & storage
        persistOrder(confirmedOrder)

        // Broadcast to KDS, customer screen, and merchant console over WebSocket & storage
        broadcastOrderEvent({
          eventType: 'ORDER_PAID',
          orderId: confirmedOrder.id,
          secureAccessToken: confirmedOrder.secureAccessToken,
          businessId: confirmedOrder.businessId,
          status: 'PLACED',
          tokenDisplay: verifyData.tokenDisplay,
          paymentStatus: 'PAID',
        })

        onSuccess(confirmedOrder)
      } catch (err: any) {
        onError(err.message || 'Network error verifying payment with server.')
      }
    },
  }

  try {
    const rzp = new window.Razorpay(options)
    rzp.on('payment.failed', (resp: any) => {
      onError(resp.error?.description || 'Payment failed. Please retry.')
    })
    rzp.open()
  } catch (err: any) {
    onError(err.message || 'Failed to open Razorpay modal.')
  }
}
