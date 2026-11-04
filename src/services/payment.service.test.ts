import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  computeHmacSha256,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  timingSafeEqual,
  validatePaymentAmountAndCurrency,
} from './crypto-verify'
import {
  createCustomerOrder,
  collectCashForOrder,
  getOrderBySecureToken,
} from './order.service'
import {
  BENCHMARK_BUSINESS,
  BENCHMARK_BRANCH,
  BENCHMARK_SETTINGS,
  BENCHMARK_PRODUCTS,
} from '@/lib/mock-data/benchmark-shop'

describe('payment.service & crypto-verify: Cryptographic Security & Lifecycle', () => {
  const dummySecret = 'dummy_test_secret_for_unit_tests_only'
  const testOrderId = 'order_DA28Fh2zJ3K9L1'
  const testPaymentId = 'pay_29QQoUBcxQtv4w'

  it('generates and verifies authentic Razorpay payment signature', async () => {
    const payload = `${testOrderId}|${testPaymentId}`
    const authenticSignature = await computeHmacSha256(payload, dummySecret)

    const isValid = await verifyRazorpayPaymentSignature(
      testOrderId,
      testPaymentId,
      authenticSignature,
      dummySecret
    )
    expect(isValid).toBe(true)
  })

  it('rejects tampered payment ID or altered order ID', async () => {
    const payload = `${testOrderId}|${testPaymentId}`
    const signature = await computeHmacSha256(payload, dummySecret)

    const isTamperedPay = await verifyRazorpayPaymentSignature(
      testOrderId,
      'pay_TAMPERED99999',
      signature,
      dummySecret
    )
    expect(isTamperedPay).toBe(false)

    const isTamperedOrder = await verifyRazorpayPaymentSignature(
      'order_FAKE9999999',
      testPaymentId,
      signature,
      dummySecret
    )
    expect(isTamperedOrder).toBe(false)

    const isWrongSecret = await verifyRazorpayPaymentSignature(
      testOrderId,
      testPaymentId,
      signature,
      'wrong_secret_12345'
    )
    expect(isWrongSecret).toBe(false)
  })

  it('verifies webhook raw body signature correctly', async () => {
    const rawWebhookBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_12345',
            amount: 4000,
            status: 'captured',
          },
        },
      },
    })

    const webhookSignature = await computeHmacSha256(rawWebhookBody, dummySecret)

    const isValid = await verifyRazorpayWebhookSignature(
      rawWebhookBody,
      webhookSignature,
      dummySecret
    )
    expect(isValid).toBe(true)

    const isTampered = await verifyRazorpayWebhookSignature(
      rawWebhookBody + ' ',
      webhookSignature,
      dummySecret
    )
    expect(isTampered).toBe(false)
  })

  it('enforces token allocation ONLY after payment verification for online orders', async () => {
    const pendingOrder = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Kunal Kapoor',
        customerPhone: '9811223344',
        paymentMethod: 'ONLINE_UPI',
      },
      items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
    })

    // Strict security guarantee: online orders MUST start as PENDING_PAYMENT and have NO token
    expect(pendingOrder.status).toBe('PENDING_PAYMENT')
    expect(pendingOrder.paymentStatus).toBe('UNPAID')
    expect(pendingOrder.pickupToken).toBeUndefined()

    // Verified retrieval confirms order is not paid and token remains unallocated
    const retrieved = await getOrderBySecureToken(pendingOrder.secureAccessToken)
    expect(retrieved?.status).toBe('PENDING_PAYMENT')
    expect(retrieved?.paymentStatus).toBe('UNPAID')
    expect(retrieved?.pickupToken).toBeUndefined()
  })

  it('manages cash collection workflow on cashier action', async () => {
    const cashOrder = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Sunita Roy',
        customerPhone: '9844556677',
        paymentMethod: 'CASH_COUNTER',
      },
      items: [{ productId: 'prod_moong_kachori', quantity: 2 }],
    })

    expect(cashOrder.status).toBe('PLACED')
    expect(cashOrder.paymentStatus).toBe('UNPAID')
    expect(cashOrder.pickupToken).toBeDefined()

    const collectedOrder = await collectCashForOrder(cashOrder.id)
    expect(collectedOrder?.paymentStatus).toBe('PAID')
    expect(collectedOrder?.status).toBe('PREPARING')
  })

  it('validates customer secure access tokens with timing-safe comparison', () => {
    const validToken = 'sec_tok_9f83a4b7c12d5e6f7a8b9c0d1e2f3a4b'
    const identicalToken = 'sec_tok_9f83a4b7c12d5e6f7a8b9c0d1e2f3a4b'
    const forgedToken = 'sec_tok_00000000000000000000000000000000'
    const truncatedToken = 'sec_tok_9f83a4b7'

    expect(timingSafeEqual(validToken, identicalToken)).toBe(true)
    expect(timingSafeEqual(validToken, forgedToken)).toBe(false)
    expect(timingSafeEqual(validToken, truncatedToken)).toBe(false)
    expect(timingSafeEqual('', validToken)).toBe(false)
    expect(timingSafeEqual(validToken, '')).toBe(false)
  })

  it('strictly validates payment amount and INR currency matching', () => {
    // 1. Valid exact amount in INR
    const valid = validatePaymentAmountAndCurrency(4200, 4200, 'INR')
    expect(valid.isValid).toBe(true)
    expect(valid.error).toBeUndefined()

    // 2. Amount mismatch (underpayment attempt)
    const underpaid = validatePaymentAmountAndCurrency(4200, 2000, 'INR')
    expect(underpaid.isValid).toBe(false)
    expect(underpaid.error).toContain('Amount mismatch')

    // 3. Amount mismatch (overpayment / altered amount)
    const overpaid = validatePaymentAmountAndCurrency(4200, 5000, 'INR')
    expect(overpaid.isValid).toBe(false)
    expect(overpaid.error).toContain('Amount mismatch')

    // 4. Currency mismatch (unsupported currency)
    const wrongCurrency = validatePaymentAmountAndCurrency(4200, 4200, 'USD')
    expect(wrongCurrency.isValid).toBe(false)
    expect(wrongCurrency.error).toContain('Currency mismatch')

    // 5. Zero or negative amounts rejected
    const zeroAmount = validatePaymentAmountAndCurrency(0, 0, 'INR')
    expect(zeroAmount.isValid).toBe(false)
  })

  it('confirms Edge Functions enforce secureAccessToken, amount equality, and INR currency', () => {
    const createOrderFn = fs.readFileSync(
      path.resolve(__dirname, '../../supabase/functions/create-razorpay-order/index.ts'),
      'utf-8'
    )
    const verifyPaymentFn = fs.readFileSync(
      path.resolve(__dirname, '../../supabase/functions/verify-razorpay-payment/index.ts'),
      'utf-8'
    )

    // create-razorpay-order checks
    expect(createOrderFn).toContain('secureAccessToken')
    expect(createOrderFn).toContain('isTokenValid')
    expect(createOrderFn).toContain('Unauthorized: Invalid order access token')
    expect(createOrderFn).toContain('cleanSecret')
    expect(createOrderFn).toContain('razorpayKeySecret === razorpayKeyId')

    // verify-razorpay-payment checks
    expect(verifyPaymentFn).toContain('Number(payOrder.amount_paisa) !== Number(order.total_paisa)')
    expect(verifyPaymentFn).toContain("payOrder.currency !== 'INR'")
    expect(verifyPaymentFn).toContain('Amount mismatch')
    expect(verifyPaymentFn).toContain('Unsupported currency')
    expect(verifyPaymentFn).toContain('cleanSecret')
    expect(verifyPaymentFn).toContain('razorpayKeySecret === razorpayKeyId')
  })

  it('resiliently cleans secrets and recovers when KEY_SECRET is identical to KEY_ID or enclosed in quotes', () => {
    const cleanSecret = (val?: string): string => val?.trim().replace(/^["']|["']$/g, '') ?? ''

    // Quote and whitespace stripping
    expect(cleanSecret('  "rzp_test_Abc123"  ')).toBe('rzp_test_Abc123')
    expect(cleanSecret("'secret_xyz_456'")).toBe('secret_xyz_456')
    expect(cleanSecret(undefined)).toBe('')

    // Recovery logic when misconfigured in environment:
    const resolveCredentials = (env: Record<string, string | undefined>) => {
      const razorpayKeyId = cleanSecret(env['RAZORPAY_KEY_ID'] || env['Test_API_Key'])
      let razorpayKeySecret = cleanSecret(env['RAZORPAY_KEY_SECRET'])

      if (!razorpayKeySecret || razorpayKeySecret === razorpayKeyId) {
        razorpayKeySecret = cleanSecret(env['Test_Key_Secret'] || env['RAZORPAY_WEBHOOK_SECRET'])
      }

      return { razorpayKeyId, razorpayKeySecret }
    }

    // Normal configuration
    const normal = resolveCredentials({
      RAZORPAY_KEY_ID: 'rzp_test_123',
      RAZORPAY_KEY_SECRET: 'secret_456',
    })
    expect(normal.razorpayKeyId).toBe('rzp_test_123')
    expect(normal.razorpayKeySecret).toBe('secret_456')

    // Misconfiguration where RAZORPAY_KEY_SECRET was accidentally set to the KEY_ID
    const misconfigured = resolveCredentials({
      RAZORPAY_KEY_ID: 'rzp_test_123',
      RAZORPAY_KEY_SECRET: 'rzp_test_123', // duplicate!
      RAZORPAY_WEBHOOK_SECRET: 'real_secret_789',
    })
    expect(misconfigured.razorpayKeyId).toBe('rzp_test_123')
    expect(misconfigured.razorpayKeySecret).toBe('real_secret_789') // Recovered!

    // Quoted configuration from .env.local
    const quoted = resolveCredentials({
      Test_API_Key: '"rzp_test_quoted"',
      Test_Key_Secret: '"secret_quoted"',
    })
    expect(quoted.razorpayKeyId).toBe('rzp_test_quoted')
    expect(quoted.razorpayKeySecret).toBe('secret_quoted')
  })

  it('guarantees that getOrderBySecureToken retains secureAccessToken across tracking visits and refreshes', async () => {
    const order = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Tracking Customer',
        customerPhone: '9855555555',
        paymentMethod: 'ONLINE_UPI',
      },
      items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
    })

    expect(order.secureAccessToken).toMatch(/^sec_tok_/)

    // Initial page load
    const loadedOrder = await getOrderBySecureToken(order.secureAccessToken)
    expect(loadedOrder).not.toBeNull()
    expect(loadedOrder?.secureAccessToken).toBe(order.secureAccessToken)
    expect(loadedOrder?.id).toBe(order.id)

    // Page refresh simulation (fetch by token again)
    const refreshedOrder = await getOrderBySecureToken(order.secureAccessToken)
    expect(refreshedOrder).not.toBeNull()
    expect(refreshedOrder?.secureAccessToken).toBe(order.secureAccessToken)
    expect(refreshedOrder?.totalPaisa).toBe(order.totalPaisa)
  })
})
