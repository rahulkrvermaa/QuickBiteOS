/**
 * Cryptographic Signature Verification for Razorpay Payments
 * Uses standard Web Crypto API (HMAC-SHA256) compatible with modern browsers, Node.js, and Supabase Edge Functions.
 */

/**
 * Converts ArrayBuffer to lowercase hex string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer)
  return Array.from(byteArray)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Computes HMAC-SHA256 of `payload` with `secret` using standard Web Crypto API.
 */
export async function computeHmacSha256(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(payload)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
  return bufferToHex(signatureBuffer)
}

/**
 * Verifies Razorpay payment signature according to official specification:
 * HMAC_SHA256(order_id + "|" + payment_id, key_secret) === signature
 */
export async function verifyRazorpayPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  keySecret: string
): Promise<boolean> {
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !keySecret) {
    return false
  }

  const payload = `${razorpayOrderId}|${razorpayPaymentId}`
  const expectedSignature = await computeHmacSha256(payload, keySecret)

  // Timing-safe comparison to prevent side-channel timing attacks
  if (expectedSignature.length !== razorpaySignature.length) {
    return false
  }

  let mismatch = 0
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ razorpaySignature.charCodeAt(i)
  }

  return mismatch === 0
}

/**
 * Verifies Razorpay Webhook signature:
 * HMAC_SHA256(webhook_body, webhook_secret) === x-razorpay-signature
 */
export async function verifyRazorpayWebhookSignature(
  rawBody: string,
  webhookSignature: string,
  webhookSecret: string
): Promise<boolean> {
  if (!rawBody || !webhookSignature || !webhookSecret) {
    return false
  }

  const expectedSignature = await computeHmacSha256(rawBody, webhookSecret)

  if (expectedSignature.length !== webhookSignature.length) {
    return false
  }

  let mismatch = 0
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ webhookSignature.charCodeAt(i)
  }

  return mismatch === 0
}

/**
 * Timing-safe string equality check to prevent side-channel timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false
  }
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Validates that payment order amount and currency strictly match the authoritative order.
 */
export function validatePaymentAmountAndCurrency(
  orderAmountPaisa: number,
  paymentAmountPaisa: number,
  currency: string
): { isValid: boolean; error?: string } {
  if (orderAmountPaisa <= 0 || paymentAmountPaisa <= 0) {
    return { isValid: false, error: 'Invalid order amount' }
  }
  if (orderAmountPaisa !== paymentAmountPaisa) {
    return {
      isValid: false,
      error: `Amount mismatch: expected ${orderAmountPaisa} paisa, received ${paymentAmountPaisa} paisa`,
    }
  }
  if (currency !== 'INR') {
    return { isValid: false, error: `Currency mismatch: expected INR, received ${currency}` }
  }
  return { isValid: true }
}

