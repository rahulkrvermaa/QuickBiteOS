import { describe, it, expect, beforeEach } from 'vitest'
import {
  createCustomerOrder,
  getOrderBySecureToken,
  getMerchantOrders,
  updateOrderStatus,
  collectCashForOrder,
  CustomerCheckoutSchema,
} from './order.service'
import {
  BENCHMARK_BUSINESS,
  BENCHMARK_BRANCH,
  BENCHMARK_SETTINGS,
  BENCHMARK_PRODUCTS,
} from '@/lib/mock-data/benchmark-shop'

describe('order.service: Validation & Order Creation', () => {
  beforeEach(() => {
    // Clear storage before each test
    if (typeof localStorage !== 'undefined') {
      localStorage.clear()
    }
  })

  it('validates customer input using Zod correctly', () => {
    // Valid input
    const valid = CustomerCheckoutSchema.safeParse({
      customerName: 'Aman Sharma',
      customerPhone: '9876543210',
      paymentMethod: 'CASH_COUNTER',
    })
    expect(valid.success).toBe(true)

    // Invalid mobile (less than 10 digits or invalid starting digit)
    const invalidPhone = CustomerCheckoutSchema.safeParse({
      customerName: 'Aman Sharma',
      customerPhone: '12345',
      paymentMethod: 'CASH_COUNTER',
    })
    expect(invalidPhone.success).toBe(false)

    // Name too short
    const shortName = CustomerCheckoutSchema.safeParse({
      customerName: 'A',
      customerPhone: '9876543210',
      paymentMethod: 'CASH_COUNTER',
    })
    expect(shortName.success).toBe(false)
  })

  it('creates a cash order with immediate pickup token and PLACED status', async () => {
    const order = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Vikram Singh',
        customerPhone: '9812345678',
        paymentMethod: 'CASH_COUNTER',
      },
      items: [
        {
          productId: 'prod_aloo_samosa',
          quantity: 2,
        },
      ],
    })

    expect(order.status).toBe('PLACED')
    expect(order.paymentStatus).toBe('UNPAID')
    expect(order.paymentMethod).toBe('CASH_COUNTER')
    expect(order.pickupToken).toBeDefined()
    expect(order.pickupToken?.tokenDisplay).toMatch(/^A\d{3,}$/)
    expect(order.subtotalPaisa).toBe(4000) // 2 * 2000
    expect(order.taxPaisa).toBe(200) // 5% GST = 200 paisa
    expect(order.totalPaisa).toBe(4200)

    // Order retrieval by secure token
    const fetched = await getOrderBySecureToken(order.secureAccessToken)
    expect(fetched).not.toBeNull()
    expect(fetched?.id).toBe(order.id)
    expect(fetched?.customerName).toBe('Vikram Singh')
  })

  it('creates an online order with PENDING_PAYMENT and NO pickup token until payment verification', async () => {
    const order = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Neha Gupta',
        customerPhone: '9988776655',
        paymentMethod: 'ONLINE_UPI',
      },
      items: [
        {
          productId: 'prod_kulhad_chai',
          quantity: 1,
        },
      ],
    })

    expect(order.status).toBe('PENDING_PAYMENT')
    expect(order.paymentStatus).toBe('UNPAID')
    expect(order.paymentMethod).toBe('ONLINE_UPI')
    // No token until payment is confirmed!
    expect(order.pickupToken).toBeUndefined()
  })

  it('allows merchant to retrieve orders and transition statuses', async () => {
    // Create an order
    const order = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Pooja Verma',
        customerPhone: '9822334455',
        paymentMethod: 'CASH_COUNTER',
      },
      items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
    })

    // Retrieve merchant orders
    const merchantOrders = await getMerchantOrders()
    expect(merchantOrders.length).toBeGreaterThan(0)
    const found = merchantOrders.find((o) => o.id === order.id)
    expect(found).toBeDefined()
    expect(found?.customerName).toBe('Pooja Verma')

    // Cash collection at counter advances status to PREPARING and paymentStatus to PAID
    const collected = await collectCashForOrder(order.id)
    expect(collected).not.toBeNull()
    expect(collected?.paymentStatus).toBe('PAID')
    expect(collected?.status).toBe('PREPARING')

    // Kitchen updates status to READY
    const ready = await updateOrderStatus(order.id, 'READY')
    expect(ready?.status).toBe('READY')

    // Handover to COMPLETED
    const completed = await updateOrderStatus(order.id, 'COMPLETED')
    expect(completed?.status).toBe('COMPLETED')
  })
})

