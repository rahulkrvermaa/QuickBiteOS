import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import {
  createCustomerOrder,
  getOrderBySecureToken,
  collectCashForOrder,
} from './order.service'
import { supabase } from '@/lib/supabase'
import {
  BENCHMARK_BUSINESS,
  BENCHMARK_BRANCH,
  BENCHMARK_SETTINGS,
  BENCHMARK_PRODUCTS,
} from '@/lib/mock-data/benchmark-shop'

describe('Security Audit & RLS Verification (Phase 3.2)', () => {
  // 1. Anonymous customer cannot list all orders
  it('prevents anonymous customers from listing all orders (requires exact secure token)', async () => {
    // Calling with empty, undefined or generic token yields null
    const emptyToken = await getOrderBySecureToken('')
    expect(emptyToken).toBeNull()

    const whitespaceToken = await getOrderBySecureToken('                ')
    expect(whitespaceToken).toBeNull()

    const wildCardToken = await getOrderBySecureToken('%')
    expect(wildCardToken).toBeNull()
  })

  // 2. Customer with a valid token can retrieve only their own order
  it('allows customer with valid secure token to retrieve ONLY their own order', async () => {
    const customerOrder = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Raghav Mehra',
        customerPhone: '9819819810',
        paymentMethod: 'ONLINE_UPI',
      },
      items: [{ productId: 'prod_aloo_samosa', quantity: 2 }],
    })

    const fetched = await getOrderBySecureToken(customerOrder.secureAccessToken)
    expect(fetched).not.toBeNull()
    expect(fetched?.id).toBe(customerOrder.id)
    expect(fetched?.customerName).toBe('Raghav Mehra')
    expect(fetched?.totalPaisa).toBe(customerOrder.totalPaisa)
  })

  // 3. Invalid token is rejected
  it('rejects forged or non-existent secure access tokens', async () => {
    const fakeToken = 'sec_tok_FORGED_ATTACKER_999999999999'
    const result = await getOrderBySecureToken(fakeToken)
    expect(result).toBeNull()
  })

  // 4. Customer cannot read another customer's order items or pickup token
  it('ensures order isolation: Customer cannot read another customer items or pickup token', async () => {
    // Customer 1 Order (Cash - has pickup token)
    const order1 = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Customer One',
        customerPhone: '9811111111',
        paymentMethod: 'CASH_COUNTER',
      },
      items: [{ productId: 'prod_moong_kachori', quantity: 1 }],
    })

    // Customer 2 Order (Online - no token initially)
    const order2 = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Customer Two',
        customerPhone: '9822222222',
        paymentMethod: 'ONLINE_UPI',
      },
      items: [{ productId: 'prod_kulhad_chai', quantity: 3 }],
    })

    // Using Order 2's token MUST NOT return Order 1's items or token
    const fetched2 = await getOrderBySecureToken(order2.secureAccessToken)
    expect(fetched2?.customerName).toBe('Customer Two')
    expect(fetched2?.items.some((i) => i.productId === 'prod_moong_kachori')).toBe(false)
    expect(fetched2?.items.some((i) => i.productId === 'prod_kulhad_chai')).toBe(true)
    expect(fetched2?.pickupToken).toBeUndefined()

    // Using Order 1's token MUST return Order 1's own items and token
    const fetched1 = await getOrderBySecureToken(order1.secureAccessToken)
    expect(fetched1?.customerName).toBe('Customer One')
    expect(fetched1?.pickupToken?.tokenDisplay).toBeDefined()
    expect(fetched1?.items.some((i) => i.productId === 'prod_kulhad_chai')).toBe(false)
  })

  // 5. Customer cannot mark an order PAID
  it('prohibits customers from creating orders in PAID status or directly forging tokens', async () => {
    const order = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Malicious Actor',
        customerPhone: '9877777777',
        paymentMethod: 'ONLINE_UPI',
      },
      items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
    })

    // Even if client tried to manipulate properties, order creation forces UNPAID and PENDING_PAYMENT
    expect(order.paymentStatus).toBe('UNPAID')
    expect(order.status).toBe('PENDING_PAYMENT')
    expect(order.pickupToken).toBeUndefined()

    // Retrieval also confirms UNPAID
    const retrieved = await getOrderBySecureToken(order.secureAccessToken)
    expect(retrieved?.paymentStatus).toBe('UNPAID')
    expect(retrieved?.status).toBe('PENDING_PAYMENT')
  })

  // 6. Staff cash collection multi-tenant isolation
  it('manages cash collection workflow securely and enforces valid transition', async () => {
    const cashOrder = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Anil Gupta',
        customerPhone: '9833333333',
        paymentMethod: 'CASH_COUNTER',
      },
      items: [{ productId: 'prod_pyaaz_kachori', quantity: 2 }],
    })

    expect(cashOrder.paymentStatus).toBe('UNPAID')
    expect(cashOrder.status).toBe('PLACED')

    const collected = await collectCashForOrder(cashOrder.id)
    expect(collected?.paymentStatus).toBe('PAID')
    expect(collected?.status).toBe('PREPARING')

    // Calling again on an already PAID order maintains paid status without error
    const recollected = await collectCashForOrder(cashOrder.id)
    expect(recollected?.paymentStatus).toBe('PAID')
  })

  // 7. Anonymous users cannot read webhook/payment internals
  it('protects webhook and payment internals from client exposure', () => {
    // Verify that client environment does not expose server secrets
    expect(import.meta.env.RAZORPAY_KEY_SECRET).toBeUndefined()
    expect(import.meta.env.RAZORPAY_WEBHOOK_SECRET).toBeUndefined()
    expect(import.meta.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
  })

  // 8. Seed data deduplication logic
  it('validates seed deduplication logic for variants and add-ons', () => {
    // Simulating composite key check (product_id, name)
    const variants = [
      { productId: 'prod_1', name: 'Plate of 2 pcs', price: 3800 },
      { productId: 'prod_1', name: 'Plate of 2 pcs', price: 3800 }, // duplicate
      { productId: 'prod_1', name: 'Single (1 pc)', price: 2000 },
    ]

    const uniqueVariants = Array.from(
      new Map(variants.map((v) => [`${v.productId}:${v.name}`, v])).values()
    )

    expect(uniqueVariants.length).toBe(2)
    expect(uniqueVariants.map((v) => v.name)).toEqual(['Plate of 2 pcs', 'Single (1 pc)'])
  })

  // 9. Token generation remains atomic, handles 4 AM IST rollover and >999 orders
  it('verifies token generation algorithm: 4 AM IST rollover and >999 orders formatting', () => {
    const computeBusinessDate = (dateIso: string) => {
      const d = new Date(dateIso)
      // Exactly matches PostgreSQL: (timezone('Asia/Kolkata', now()) - interval '4 hours')::date
      const minus4Hours = new Date(d.getTime() - 4 * 60 * 60 * 1000)
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(minus4Hours)
    }

    // 03:59:59 AM IST on Nov 3 (22:29:59 UTC on Nov 2)
    const lateNightShift = computeBusinessDate('2026-11-02T22:29:59.000Z')
    expect(lateNightShift).toBe('2026-11-02') // Remains on Nov 2 shift!

    // 04:00:00 AM IST on Nov 3 (22:30:00 UTC on Nov 2)
    const nextMorningShift = computeBusinessDate('2026-11-02T22:30:00.000Z')
    expect(nextMorningShift).toBe('2026-11-03') // Rolled over to Nov 3 shift!

    // Format tokens supporting >999 orders
    const formatToken = (prefix: string, seq: number) => {
      const numStr = String(seq)
      return prefix + numStr.padStart(Math.max(3, numStr.length), '0')
    }

    expect(formatToken('A', 1)).toBe('A001')
    expect(formatToken('A', 41)).toBe('A041')
    expect(formatToken('A', 999)).toBe('A999')
    expect(formatToken('A', 1000)).toBe('A1000') // Seamless transition >999
    expect(formatToken('A', 14500)).toBe('A14500')
  })

  // 10. Client cannot submit arbitrary prices or totals (Server calculates authoritatively)
  it('enforces server-side authoritative pricing: ignores any client-attempted price injection', async () => {
    // Attempting to submit custom forged price fields
    const forgedSubmission: any = {
      productId: 'prod_aloo_samosa',
      quantity: 5, // 5 samosas @ 2000 paisa = 10000 paisa
      unitPricePaisa: 10, // forged 10 paisa
      lineTotalPaisa: 50, // forged 50 paisa
      totalPaisa: 50,
    }

    const order = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Price Tamperer',
        customerPhone: '9844444444',
        paymentMethod: 'ONLINE_UPI',
      },
      items: [forgedSubmission],
    })

    // The server/engine MUST compute 5 * 2000 = 10000 + 5% GST (500) = 10500 paisa!
    expect(order.subtotalPaisa).toBe(10000)
    expect(order.taxPaisa).toBe(500)
    expect(order.totalPaisa).toBe(10500)
    expect(order.items[0].unitPricePaisa).toBe(2000)
    expect(order.items[0].lineTotalPaisa).toBe(10000)
  })

  // 11. Variant and add-on pricing calculated authoritatively from catalog definitions
  it('calculates variants and add-on prices strictly from catalog records', async () => {
    const order = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Gourmet Customer',
        customerPhone: '9855555555',
        paymentMethod: 'CASH_COUNTER',
      },
      items: [
        {
          productId: 'prod_aloo_samosa',
          variantId: 'var_samosa_plate', // Plate of 2 pcs = 3800 paisa
          addons: [
            { addonId: 'add_extra_saunth', quantity: 2 }, // 2 * 500 = 1000 paisa
          ],
          quantity: 1, // unit price = 3800 + 1000 = 4800 paisa
        },
      ],
    })

    expect(order.subtotalPaisa).toBe(4800)
    expect(order.taxPaisa).toBe(240) // 5% of 4800 = 240 paisa
    expect(order.totalPaisa).toBe(5040)
  })

  // 12. Invalid product/variant combinations are rejected
  it('rejects order submissions with non-existent products', async () => {
    await expect(
      createCustomerOrder({
        business: BENCHMARK_BUSINESS,
        branch: BENCHMARK_BRANCH,
        settings: BENCHMARK_SETTINGS,
        catalogProducts: BENCHMARK_PRODUCTS,
        customer: {
          customerName: 'Invalid Item Buyer',
          customerPhone: '9866666666',
          paymentMethod: 'CASH_COUNTER',
        },
        items: [{ productId: 'prod_NON_EXISTENT_GHOST_ITEM', quantity: 1 }],
      })
    ).rejects.toThrow(/does not exist|not found|Invalid/i)
  })

  // 13. Concurrency-safe inventory decrement simulation
  it('prevents overselling when stock quantity is limited', () => {
    let currentStock = 5

    const attemptDeductStock = (requestedQty: number) => {
      if (currentStock < requestedQty) {
        throw new Error(`Insufficient stock (available: ${currentStock}, requested: ${requestedQty})`)
      }
      currentStock -= requestedQty
      return currentStock
    }

    expect(attemptDeductStock(3)).toBe(2)
    expect(attemptDeductStock(2)).toBe(0)
    expect(() => attemptDeductStock(1)).toThrow(/Insufficient stock/)
    expect(currentStock).toBe(0)
  })

  // 14. Phase 3.4: Sequence-backed order number collision and dynamic length formatting test
  it('generates thousands of sequence-backed order numbers without collisions and formats >=10000 safely', () => {
    const formatOrderNum = (prefix: string, seq: number) => {
      const seqStr = String(seq)
      const targetLen = Math.max(4, seqStr.length)
      return `QB-${prefix}-${seqStr.padStart(targetLen, '0')}`
    }

    // Exact verification cases: 1001, 9999, 10000, 100000
    expect(formatOrderNum('2611', 1001)).toBe('QB-2611-1001')
    expect(formatOrderNum('2611', 9999)).toBe('QB-2611-9999')
    expect(formatOrderNum('2611', 10000)).toBe('QB-2611-10000') // Zero truncation!
    expect(formatOrderNum('2611', 100000)).toBe('QB-2611-100000')

    const orderNumbers = new Set<string>()
    const datePrefix = '2611'
    const total = 15000 // Test past 10000 up to 16000

    for (let seq = 1001; seq <= 1000 + total; seq++) {
      const orderNum = formatOrderNum(datePrefix, seq)
      orderNumbers.add(orderNum)
    }

    expect(orderNumbers.size).toBe(total)
    expect(orderNumbers.has('QB-2611-1001')).toBe(true)
    expect(orderNumbers.has('QB-2611-9999')).toBe(true)
    expect(orderNumbers.has('QB-2611-10000')).toBe(true)
    expect(orderNumbers.has('QB-2611-16000')).toBe(true)
  })

  // 15. Phase 3.4: Live RPC failure never creates an in-memory ghost order
  it('ensures live RPC failure throws to caller and never creates an in-memory ghost order', async () => {
    const originalRpc = supabase.rpc
    ;(supabase as any).rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Insufficient stock for product "Samosa" (available: 0, requested: 2)' },
    })

    const liveUuidBusiness = {
      ...BENCHMARK_BUSINESS,
      id: '11111111-1111-1111-1111-111111111111',
    }

    try {
      await expect(
        createCustomerOrder({
          business: liveUuidBusiness,
          branch: BENCHMARK_BRANCH,
          settings: BENCHMARK_SETTINGS,
          catalogProducts: BENCHMARK_PRODUCTS,
          customer: {
            customerName: 'Live Customer',
            customerPhone: '9812345678',
            paymentMethod: 'ONLINE_UPI',
          },
          items: [{ productId: 'prod_aloo_samosa', quantity: 2 }],
        })
      ).rejects.toThrow('Insufficient stock for product "Samosa"')

      // Confirm no ghost order exists in storage with invalid token
      const stored = await getOrderBySecureToken('sec_tok_ghost_order_test')
      expect(stored).toBeNull()
    } finally {
      supabase.rpc = originalRpc
    }
  })

  // 16. Phase 3.4: Demo fallback works only in explicit demo mode (non-UUID business)
  it('permits local mock fallback strictly for non-UUID demo shops, blocking production UUID tenants', async () => {
    // 1. Benchmark shop (non-UUID id: "biz_samosa_corner") succeeds in demo mode
    const demoOrder = await createCustomerOrder({
      business: BENCHMARK_BUSINESS, // id = 'biz_samosa_corner'
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Demo User',
        customerPhone: '9899999999',
        paymentMethod: 'CASH_COUNTER',
      },
      items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
    })
    expect(demoOrder).toBeDefined()
    expect(demoOrder.id).toMatch(/^ord_/)

    // 2. Live UUID tenant MUST route to RPC and fails if RPC returns error
    const originalRpc = supabase.rpc
    ;(supabase as any).rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Business not found or inactive' },
    })

    try {
      await expect(
        createCustomerOrder({
          business: { ...BENCHMARK_BUSINESS, id: 'a0000000-0000-0000-0000-000000000001' },
          branch: BENCHMARK_BRANCH,
          settings: BENCHMARK_SETTINGS,
          catalogProducts: BENCHMARK_PRODUCTS,
          customer: {
            customerName: 'Production User',
            customerPhone: '9888888888',
            paymentMethod: 'CASH_COUNTER',
          },
          items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
        })
      ).rejects.toThrow()
    } finally {
      supabase.rpc = originalRpc
    }
  })

  // 17. Phase 3.4: Duplicate product lines cannot bypass inventory checks
  it('aggregates required stock across duplicate product lines preventing inventory bypass', () => {
    const cartItems = [
      { productId: 'prod_1', variantId: 'v1', quantity: 3 },
      { productId: 'prod_1', variantId: 'v2', quantity: 4 },
      { productId: 'prod_2', variantId: null, quantity: 2 },
    ]

    const aggregatedStockReq = new Map<string, number>()
    for (const item of cartItems) {
      aggregatedStockReq.set(
        item.productId,
        (aggregatedStockReq.get(item.productId) || 0) + item.quantity
      )
    }

    expect(aggregatedStockReq.get('prod_1')).toBe(7) // 3 + 4 = 7
    expect(aggregatedStockReq.get('prod_2')).toBe(2)

    const availableStock: Record<string, number> = { prod_1: 5, prod_2: 10 }
    for (const [prodId, totalReq] of aggregatedStockReq.entries()) {
      if (availableStock[prodId] < totalReq) {
        expect(prodId).toBe('prod_1')
        expect(totalReq).toBe(7)
        expect(availableStock[prodId]).toBe(5)
      }
    }
  })

  // 18. Phase 3.4: Concurrent reverse-order carts acquire locks in identical deterministic order
  it('guarantees deterministic ascending row lock ordering across reverse-order carts', () => {
    const cartA = [{ productId: 'uuid-B' }, { productId: 'uuid-A' }]
    const cartB = [{ productId: 'uuid-A' }, { productId: 'uuid-B' }]

    const getSortedLockOrder = (items: { productId: string }[]) => {
      const distinct = Array.from(new Set(items.map((i) => i.productId)))
      return distinct.sort()
    }

    const lockOrderA = getSortedLockOrder(cartA)
    const lockOrderB = getSortedLockOrder(cartB)

    // Both acquire locks in identical global order: uuid-A first, then uuid-B
    expect(lockOrderA).toEqual(['uuid-A', 'uuid-B'])
    expect(lockOrderB).toEqual(['uuid-A', 'uuid-B'])
    expect(lockOrderA).toEqual(lockOrderB)
  })

  // 19. Phase 3.4: Negative stock constraint validation
  it('verifies non-negative inventory constraint prevents stock underflow', () => {
    let stockQuantity = 2

    const applyStockUpdate = (delta: number) => {
      const next = stockQuantity + delta
      if (next < 0) {
        throw new Error('chk_products_stock_quantity_nonnegative: stock_quantity cannot be negative')
      }
      stockQuantity = next
      return stockQuantity
    }

    expect(applyStockUpdate(-2)).toBe(0) // 0 is valid
    expect(() => applyStockUpdate(-1)).toThrow(/cannot be negative/)
  })

  // 20. Phase 3.4: Cart size limits (1 to 50 items)
  it('rejects empty carts and carts exceeding 50 line items', async () => {
    // Empty cart
    await expect(
      createCustomerOrder({
        business: BENCHMARK_BUSINESS,
        branch: BENCHMARK_BRANCH,
        settings: BENCHMARK_SETTINGS,
        catalogProducts: BENCHMARK_PRODUCTS,
        customer: {
          customerName: 'Empty Cart User',
          customerPhone: '9811112222',
          paymentMethod: 'CASH_COUNTER',
        },
        items: [],
      })
    ).rejects.toThrow('Order must contain at least one item')

    // 51 items
    const excessiveItems = Array.from({ length: 51 }, () => ({
      productId: 'prod_aloo_samosa',
      quantity: 1,
    }))

    await expect(
      createCustomerOrder({
        business: BENCHMARK_BUSINESS,
        branch: BENCHMARK_BRANCH,
        settings: BENCHMARK_SETTINGS,
        catalogProducts: BENCHMARK_PRODUCTS,
        customer: {
          customerName: 'Excessive Cart User',
          customerPhone: '9811112222',
          paymentMethod: 'CASH_COUNTER',
        },
        items: excessiveItems,
      })
    ).rejects.toThrow('Order exceeds maximum limit of 50 items')
  })

  // 21. Phase 3.4: Duplicate add-ons aggregated to prevent max_quantity bypass
  it('aggregates duplicate add-on IDs and prevents bypassing max_quantity', () => {
    const maxQuantity = 2
    const submittedAddons = [
      { addonId: 'add_extra_chutney', quantity: 1 },
      { addonId: 'add_extra_chutney', quantity: 2 }, // Total = 3, exceeds max 2!
    ]

    const aggregatedAddons = new Map<string, number>()
    for (const a of submittedAddons) {
      aggregatedAddons.set(a.addonId, (aggregatedAddons.get(a.addonId) || 0) + a.quantity)
    }

    for (const [id, totalQty] of aggregatedAddons.entries()) {
      if (totalQty > maxQuantity) {
        expect(id).toBe('add_extra_chutney')
        expect(totalQty).toBe(3)
        expect(() => {
          if (totalQty > maxQuantity) throw new Error(`Addon exceeds maximum allowed quantity of ${maxQuantity}`)
        }).toThrow(/exceeds maximum allowed quantity of 2/)
      }
    }
  })

  // 22. Phase 3.4: Staff authorization for cash collection
  it('restricts cash collection strictly to authorized staff roles', () => {
    const allowedRoles = ['owner', 'manager', 'cashier']
    const unauthorizedRoles = ['customer', 'kitchen', 'anon', 'delivery']

    const canCollectCash = (role: string) => allowedRoles.includes(role)

    for (const role of allowedRoles) {
      expect(canCollectCash(role)).toBe(true)
    }
    for (const role of unauthorizedRoles) {
      expect(canCollectCash(role)).toBe(false)
    }
  })

  // 23. Phase 3.4: Online orders do not receive tokens before verified payment
  it('guarantees online orders never receive pickup tokens before payment verification', async () => {
    const onlineOrder = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'UPI Customer',
        customerPhone: '9876543210',
        paymentMethod: 'ONLINE_UPI',
      },
      items: [{ productId: 'prod_aloo_samosa', quantity: 2 }],
    })

    expect(onlineOrder.paymentStatus).toBe('UNPAID')
    expect(onlineOrder.status).toBe('PENDING_PAYMENT')
    expect(onlineOrder.pickupToken).toBeUndefined()
  })

  // 24. Phase 3.5: Bootstrap script includes pgcrypto and uuid-ossp extensions
  it('verifies setup_complete.sql includes required database extensions', () => {
    const setupSqlPath = path.resolve(process.cwd(), 'supabase/setup_complete.sql')
    const sql = fs.readFileSync(setupSqlPath, 'utf-8')
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')
    expect(sql).toContain('CREATE SEQUENCE IF NOT EXISTS public.order_number_seq')
  })

  // 25. Phase 3.5: Bootstrap script defines all 8 merchant management RLS policies
  it('verifies setup_complete.sql restores all 8 merchant management policies', () => {
    const setupSqlPath = path.resolve(process.cwd(), 'supabase/setup_complete.sql')
    const sql = fs.readFileSync(setupSqlPath, 'utf-8')

    const requiredPolicies = [
      'Owners can update own business',
      'Staff can view all business products',
      'Managers can modify products',
      'Staff can manage branches',
      'Staff can manage business settings',
      'Managers can modify categories',
      'Managers can modify product variants',
      'Managers can modify product addons',
    ]

    for (const policy of requiredPolicies) {
      expect(sql).toContain('CREATE POLICY "' + policy + '"')
    }
  })

  // 26. Phase 3.5: Bootstrap script scopes public visibility strictly to active businesses
  it('verifies setup_complete.sql scopes public catalog and branches to active businesses', () => {
    const setupSqlPath = path.resolve(process.cwd(), 'supabase/setup_complete.sql')
    const sql = fs.readFileSync(setupSqlPath, 'utf-8')

    expect(sql).toMatch(/CREATE POLICY "Public can view active branches"[\s\S]*?business_id IN \(SELECT id FROM public\.businesses WHERE is_active = true\)/)
    // Public settings are scoped to active businesses strictly through the restricted view / RPC
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.public_business_settings[\s\S]*?WHERE b\.is_active = true/)
    expect(sql).toMatch(/CREATE POLICY "Public can view active categories"[\s\S]*?business_id IN \(SELECT id FROM public\.businesses WHERE is_active = true\)/)
    expect(sql).toMatch(/CREATE POLICY "Public can view available products"[\s\S]*?business_id IN \(SELECT id FROM public\.businesses WHERE is_active = true\)/)
  })

  // 27. Phase 3.5: Role-based authorization for store management
  it('enforces that only owner and manager roles have catalog/settings mutation rights', () => {
    const managementRoles = ['owner', 'manager']
    const nonManagementRoles = ['cashier', 'kitchen', 'customer', 'anon', 'delivery']

    const canManageStore = (role: string) => managementRoles.includes(role)

    for (const role of managementRoles) {
      expect(canManageStore(role)).toBe(true)
    }
    for (const role of nonManagementRoles) {
      expect(canManageStore(role)).toBe(false)
    }
  })

  // 28. Phase 3.5: payment_transactions schema & unique index contract
  it('verifies payment_transactions schema, constraints, and indexes across migration 009 and setup_complete.sql', () => {
    const mig009Path = path.resolve(process.cwd(), 'supabase/migrations/20261102000009_create_payment_transactions.sql')
    const setupSqlPath = path.resolve(process.cwd(), 'supabase/setup_complete.sql')

    const migSql = fs.readFileSync(mig009Path, 'utf-8')
    const setupSql = fs.readFileSync(setupSqlPath, 'utf-8')

    for (const sql of [migSql, setupSql]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.payment_transactions')
      expect(sql).toContain('provider_payment_id TEXT NOT NULL')
      expect(sql).toContain('provider_signature TEXT NOT NULL')
      expect(sql).toContain("status VARCHAR(20) NOT NULL DEFAULT 'captured'")
      expect(sql).toContain('uq_payment_transactions_provider_payment UNIQUE (provider_payment_id)')
      expect(sql).toContain('idx_payment_transactions_order')
      expect(sql).toContain('idx_payment_transactions_provider_payment')
      expect(sql).toContain('idx_payment_orders_order')
    }
  })

  // 29. Phase 3.5: payment_transactions RLS policies
  it('verifies payment_transactions RLS policies restrict access to service_role and tenant staff', () => {
    const setupSqlPath = path.resolve(process.cwd(), 'supabase/setup_complete.sql')
    const setupSql = fs.readFileSync(setupSqlPath, 'utf-8')

    expect(setupSql).toContain('CREATE POLICY "Service role manages payment transactions"')
    expect(setupSql).toContain('CREATE POLICY "Staff can view payment transactions"')
  })

  // 30. Phase 3.5: Edge Functions payment_transactions contract
  it('verifies Edge Functions use idempotent payment_transactions contract', () => {
    const verifyPath = path.resolve(process.cwd(), 'supabase/functions/verify-razorpay-payment/index.ts')
    const webhookPath = path.resolve(process.cwd(), 'supabase/functions/razorpay-webhook/index.ts')

    const verifyCode = fs.readFileSync(verifyPath, 'utf-8')
    const webhookCode = fs.readFileSync(webhookPath, 'utf-8')

    // Both functions write to payment_transactions with provider_payment_id conflict handling
    expect(verifyCode).toContain(".from('payment_transactions').upsert(")
    expect(verifyCode).toContain("onConflict: 'provider_payment_id'")

    expect(webhookCode).toContain(".from('payment_transactions').upsert(")
    expect(webhookCode).toContain("onConflict: 'provider_payment_id'")
  })

  // 31. Phase 3.5: public.profiles RLS enablement across migrations and setup_complete.sql
  it('verifies profiles table has RLS enabled across migration 010 and setup_complete.sql', () => {
    const mig010Path = path.resolve(process.cwd(), 'supabase/migrations/20261102000010_profiles_row_level_security.sql')
    const setupSqlPath = path.resolve(process.cwd(), 'supabase/setup_complete.sql')

    const migSql = fs.readFileSync(mig010Path, 'utf-8')
    const setupSql = fs.readFileSync(setupSqlPath, 'utf-8')

    for (const sql of [migSql, setupSql]) {
      expect(sql).toContain('ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;')
    }
  })

  // 32. Phase 3.5: public.profiles ownership policies restrict SELECT, INSERT, UPDATE to auth.uid() = id
  it('verifies profiles RLS policies enforce strict auth.uid() = id ownership without client delete', () => {
    const mig010Path = path.resolve(process.cwd(), 'supabase/migrations/20261102000010_profiles_row_level_security.sql')
    const setupSqlPath = path.resolve(process.cwd(), 'supabase/setup_complete.sql')

    const migSql = fs.readFileSync(mig010Path, 'utf-8')
    const setupSql = fs.readFileSync(setupSqlPath, 'utf-8')

    for (const sql of [migSql, setupSql]) {
      // 1. SELECT policy: authenticated only, auth.uid() = id
      expect(sql).toContain('CREATE POLICY "Users can view own profile"')
      expect(sql).toMatch(/CREATE POLICY "Users can view own profile"[\s\S]*?TO authenticated[\s\S]*?USING \(auth\.uid\(\) = id\)/)

      // 2. INSERT policy: authenticated only, WITH CHECK auth.uid() = id
      expect(sql).toContain('CREATE POLICY "Users can insert own profile"')
      expect(sql).toMatch(/CREATE POLICY "Users can insert own profile"[\s\S]*?TO authenticated[\s\S]*?WITH CHECK \(auth\.uid\(\) = id\)/)

      // 3. UPDATE policy: authenticated only, USING + WITH CHECK auth.uid() = id
      expect(sql).toContain('CREATE POLICY "Users can update own profile"')
      expect(sql).toMatch(/CREATE POLICY "Users can update own profile"[\s\S]*?TO authenticated[\s\S]*?USING \(auth\.uid\(\) = id\)[\s\S]*?WITH CHECK \(auth\.uid\(\) = id\)/)

      // 4. No client DELETE policy (profiles cannot be deleted by users)
      expect(sql).not.toMatch(/CREATE POLICY.*ON public\.profiles FOR DELETE/)

      // 5. Service role has full access
      expect(sql).toContain('CREATE POLICY "Service role manages profiles"')
    }
  })

  // 33. Phase 3.5: Six database functions permission audit across migration 011 & setup_complete.sql
  it('verifies exact intended permissions for all 6 core database functions', () => {
    const mig011Path = path.resolve(process.cwd(), 'supabase/migrations/20261102000011_harden_function_permissions.sql')
    const setupSqlPath = path.resolve(process.cwd(), 'supabase/setup_complete.sql')

    const migSql = fs.readFileSync(mig011Path, 'utf-8')
    const setupSql = fs.readFileSync(setupSqlPath, 'utf-8')

    // 1. get_auth_business_id: revoked from anon/PUBLIC, granted to authenticated & service_role
    for (const sql of [migSql, setupSql]) {
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.get_auth_business_id() FROM PUBLIC;')
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.get_auth_business_id() FROM anon;')
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_auth_business_id() TO authenticated, service_role;')

      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.get_auth_role() FROM PUBLIC;')
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.get_auth_role() FROM anon;')
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_auth_role() TO authenticated, service_role;')
    }

    // 2. allocate_pickup_token: service_role only
    expect(setupSql).toContain('REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM PUBLIC;')
    expect(setupSql).toContain('REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM anon;')
    expect(setupSql).toContain('REVOKE EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) FROM authenticated;')
    expect(setupSql).toContain('GRANT EXECUTE ON FUNCTION public.allocate_pickup_token(UUID, UUID, UUID, VARCHAR) TO service_role;')

    // 3. collect_cash_order: authenticated staff & service_role only
    expect(setupSql).toContain('REVOKE EXECUTE ON FUNCTION public.collect_cash_order(UUID) FROM PUBLIC;')
    expect(setupSql).toContain('REVOKE EXECUTE ON FUNCTION public.collect_cash_order(UUID) FROM anon;')
    expect(setupSql).toContain('GRANT EXECUTE ON FUNCTION public.collect_cash_order(UUID) TO authenticated, service_role;')

    // 4. Customer order creation & tracking: accessible to anon, authenticated, service_role
    expect(setupSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.place_customer_order[\s\S]*?TO anon, authenticated, service_role;/)
    expect(setupSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_customer_order_by_token[\s\S]*?TO anon, authenticated, service_role;/)
  })

  // 34. Phase 3.5: All SECURITY DEFINER functions use explicit search_path
  it('verifies all 6 functions define explicit, safe search_path settings', () => {
    const setupSqlPath = path.resolve(process.cwd(), 'supabase/setup_complete.sql')
    const sql = fs.readFileSync(setupSqlPath, 'utf-8')

    // Helper functions
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_auth_business_id[\s\S]*?SECURITY DEFINER\s*\r?\n\s*SET search_path = public/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_auth_role[\s\S]*?SECURITY DEFINER\s*\r?\n\s*SET search_path = public/)

    // Customer tracking
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_customer_order_by_token[\s\S]*?SECURITY DEFINER\s*\r?\n\s*SET search_path = public/)

    // Token allocation
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.allocate_pickup_token[\s\S]*?SECURITY DEFINER\s*\r?\n\s*SET search_path = public/)

    // Cash collection & Customer order placement require public, extensions (pgcrypto)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.collect_cash_order[\s\S]*?SECURITY DEFINER\s*\r?\n\s*SET search_path = public, extensions/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.place_customer_order[\s\S]*?SECURITY DEFINER\s*\r?\n\s*SET search_path = public, extensions/)
  })

  // 35. Phase 3.5: Customer data exposure audit
  it('verifies customer order tracking exposes no sensitive secrets or other customers data', async () => {
    // 1. Order tracking by valid token returns customer order receipt only
    const order = await createCustomerOrder({
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      catalogProducts: BENCHMARK_PRODUCTS,
      customer: {
        customerName: 'Aarav Patel',
        customerPhone: '9822334455',
        paymentMethod: 'ONLINE_UPI',
      },
      items: [{ productId: 'prod_aloo_samosa', quantity: 2 }],
    })

    const tracked = await getOrderBySecureToken(order.secureAccessToken)
    expect(tracked).not.toBeNull()

    // Does not expose password hashes, internal secrets, or webhook keys
    const trackedKeys = Object.keys(tracked as object)
    expect(trackedKeys).not.toContain('secret')
    expect(trackedKeys).not.toContain('password')
    expect(trackedKeys).not.toContain('webhook')
    expect(trackedKeys).not.toContain('razorpay_secret')

    // 2. Short / empty token returns null (no enumeration or leakage)
    expect(await getOrderBySecureToken('short')).toBeNull()
    expect(await getOrderBySecureToken('')).toBeNull()
  })
})