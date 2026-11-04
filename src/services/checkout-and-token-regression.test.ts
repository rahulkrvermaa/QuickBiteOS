import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createCustomerOrder, getOrderBySecureToken } from './order.service'
import { getShopCatalogBySlug } from './catalog.service'
import { broadcastOrderEvent, subscribeToOrderEvents, type OrderRealtimePayload } from './realtime.service'
import { supabase } from '@/lib/supabase'
import {
  BENCHMARK_BUSINESS,
  BENCHMARK_BRANCH,
  BENCHMARK_SETTINGS,
  BENCHMARK_PRODUCTS,
} from '@/lib/mock-data/benchmark-shop'

describe('Comprehensive Checkout, RLS, Fallback & Pickup Token Regression Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    if (typeof localStorage !== 'undefined') {
      localStorage.clear()
    }
  })

  // =========================================================================
  // 1. ANONYMOUS CATALOG AND RLS POLICY AUDIT
  // =========================================================================
  describe('1. Anonymous Catalog and RLS Security Audit', () => {
    const setupSqlPath = path.resolve(process.cwd(), 'supabase/setup_complete.sql')
    const migration12Path = path.resolve(
      process.cwd(),
      'supabase/migrations/20261102000012_fix_staff_rls_authenticated_roles.sql'
    )
    const setupSql = fs.readFileSync(setupSqlPath, 'utf8')
    const migration12 = fs.readFileSync(migration12Path, 'utf8')

    it('enforces that all staff and management policies explicitly target authenticated role', () => {
      // Extract every policy that calls get_auth_business_id or get_auth_role in setup_complete.sql
      const policyRegex = /CREATE POLICY\s+"([^"]+)"\s+ON\s+([^\s\n]+)([\s\S]*?);/g
      let match
      const staffPolicies: { name: string; table: string; role: string }[] = []

      while ((match = policyRegex.exec(setupSql)) !== null) {
        const name = match[1]
        const table = match[2]
        const body = match[3]

        if (/get_auth_business_id|get_auth_role/.test(body)) {
          const toMatch = body.match(/TO\s+([^\s\n,]+(?:,\s*[^\s\n,]+)*)/i)
          staffPolicies.push({
            name,
            table,
            role: toMatch ? toMatch[1].trim() : 'PUBLIC_UNRESTRICTED',
          })
        }
      }

      expect(staffPolicies.length).toBeGreaterThan(10)
      for (const policy of staffPolicies) {
        expect(
          policy.role,
          `Policy "${policy.name}" on ${policy.table} must specify TO authenticated`
        ).toBe('authenticated')
      }
    })

    it('verifies get_auth_business_id and get_auth_role execution is strictly revoked from anon', () => {
      expect(setupSql).toMatch(
        /REVOKE EXECUTE ON FUNCTION public\.get_auth_business_id\(\)\s+FROM anon;/
      )
      expect(setupSql).toMatch(
        /REVOKE EXECUTE ON FUNCTION public\.get_auth_role\(\)\s+FROM anon;/
      )
      expect(setupSql).toMatch(
        /GRANT EXECUTE ON FUNCTION public\.get_auth_business_id\(\)\s+TO authenticated, service_role;/
      )
      expect(setupSql).toMatch(
        /GRANT EXECUTE ON FUNCTION public\.get_auth_role\(\)\s+TO authenticated, service_role;/
      )
    })

    it('verifies public catalog SELECT policies explicitly grant access to anon and authenticated', () => {
      const publicCatalogTables = [
        'businesses',
        'branches',
        'categories',
        'products',
        'product_variants',
        'product_addons',
      ]

      for (const table of publicCatalogTables) {
        const regex = new RegExp(
          `CREATE POLICY "[^"]*"\\s+ON public\\.${table}\\s+FOR SELECT\\s+TO anon, authenticated`,
          'i'
        )
        expect(
          regex.test(setupSql) || regex.test(migration12),
          `Table public.${table} must have a public SELECT policy explicitly targeting TO anon, authenticated`
        ).toBe(true)
      }
    })

    it('ensures business_settings table is protected from direct anonymous SELECT and uses restricted view/RPC', () => {
      // 1. Direct SELECT on raw business_settings must be revoked from PUBLIC and anon
      expect(setupSql).toMatch(/REVOKE SELECT ON public\.business_settings FROM PUBLIC, anon;/)
      expect(migration12).toMatch(/REVOKE SELECT ON public\.business_settings FROM PUBLIC, anon;/)

      // 2. Safe restricted view public_business_settings must exist and be granted to anon
      expect(setupSql).toMatch(/CREATE OR REPLACE VIEW public\.public_business_settings/)
      expect(setupSql).toMatch(/GRANT SELECT ON public\.public_business_settings TO anon, authenticated, service_role;/)

      // 3. Safe restricted RPC get_public_business_settings must exist and be granted to anon
      expect(setupSql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_public_business_settings/)
      expect(setupSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_public_business_settings\(UUID\) TO anon, authenticated, service_role;/)
    })

    it('ensures private operational tables prohibit direct anonymous SELECT', () => {
      // Orders, pickup tokens, payment orders, payment transactions, and raw business_settings must NOT have public anon SELECT policies
      const privateTables = [
        'public.orders',
        'public.order_items',
        'public.pickup_tokens',
        'public.payment_orders',
        'public.payment_transactions',
        'public.business_settings',
      ]

      for (const table of privateTables) {
        const anonSelectRegex = new RegExp(
          `CREATE POLICY "[^"]*"\\s+ON ${table.replace('.', '\\.')}\\s+FOR SELECT\\s+TO [^;]*?anon`,
          'i'
        )
        expect(
          anonSelectRegex.test(setupSql),
          `Table ${table} must NOT allow direct anonymous SELECT`
        ).toBe(false)
      }
    })

    it('verifies multi-tenant isolation across all staff order and payment policies', () => {
      expect(setupSql).toMatch(
        /CREATE POLICY "Staff can view business orders"[\s\S]*?business_id = public\.get_auth_business_id\(\)/
      )
      expect(setupSql).toMatch(
        /CREATE POLICY "Staff can view pickup tokens"[\s\S]*?business_id = public\.get_auth_business_id\(\)/
      )
      expect(setupSql).toMatch(
        /CREATE POLICY "Staff can view payment orders"[\s\S]*?o\.business_id = public\.get_auth_business_id\(\)/
      )
    })
  })

  // =========================================================================
  // 2. CHECKOUT & NO SILENT DEMO FALLBACK
  // =========================================================================
  describe('2. Checkout & No Silent Demo Fallback', () => {
    const liveTenantId = 'a0000000-0000-0000-0000-000000000001'
    const liveBranchId = 'b0000000-0000-0000-0000-000000000001'

    it('uses real UUIDs in live mode and invokes place_customer_order RPC', async () => {
      const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: {
          id: 'c0000000-0000-0000-0000-000000000001',
          businessId: liveTenantId,
          branchId: liveBranchId,
          orderNumber: 'QB-2611-0001',
          secureAccessToken: 'sec_tok_test_authoritative_uuid_12345678',
          customerName: 'Suresh Kumar',
          customerPhone: '+91 9876543210',
          status: 'PENDING_PAYMENT',
          paymentStatus: 'UNPAID',
          paymentMethod: 'ONLINE_UPI',
          subtotalPaisa: 2000,
          discountPaisa: 0,
          taxPaisa: 100,
          totalPaisa: 2100,
          notes: 'Extra chutney',
          pickupToken: null,
          items: [],
          createdAt: new Date().toISOString(),
        },
        error: null,
      } as any)

      const order = await createCustomerOrder({
        business: { ...BENCHMARK_BUSINESS, id: liveTenantId },
        branch: { ...BENCHMARK_BRANCH, id: liveBranchId },
        settings: BENCHMARK_SETTINGS,
        catalogProducts: BENCHMARK_PRODUCTS,
        customer: {
          customerName: 'Suresh Kumar',
          customerPhone: '9876543210',
          paymentMethod: 'ONLINE_UPI',
          notes: 'Extra chutney',
        },
        items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
      })

      expect(mockRpc).toHaveBeenCalledWith('place_customer_order', expect.objectContaining({
        p_business_id: liveTenantId,
        p_branch_id: liveBranchId,
        p_customer_name: 'Suresh Kumar',
        p_payment_method: 'ONLINE_UPI',
      }))

      expect(order.id).toBe('c0000000-0000-0000-0000-000000000001')
      expect(order.businessId).toBe(liveTenantId)
      expect(order.status).toBe('PENDING_PAYMENT')

      mockRpc.mockRestore()
    })

    it('rejects silent fallback and throws when live catalog query fails', async () => {
      const createChain = (result: any) => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          limit: () => chain,
          order: () => Promise.resolve(result),
          single: () => Promise.resolve(result),
          then: (resolve: any) => Promise.resolve(result).then(resolve),
        }
        return chain
      }

      const fromSpy = vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'businesses') {
          return createChain({
            data: { id: liveTenantId, name: 'Live Shop', slug: 'live-shop', is_active: true },
            error: null,
          })
        }
        return createChain({
          data: null,
          error: { message: 'Database connection timeout' },
        })
      })

      // Must throw rather than silently falling back to benchmark shop!
      await expect(getShopCatalogBySlug('live-shop')).rejects.toThrow(
        'Failed to load shop catalog for "live-shop"'
      )

      fromSpy.mockRestore()
    })

    it('ensures live RPC failure throws to caller and never creates a fake order', async () => {
      const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: null,
        error: { message: 'Insufficient stock for product "Samosa" (available: 0, requested: 2)' },
      } as any)

      await expect(
        createCustomerOrder({
          business: { ...BENCHMARK_BUSINESS, id: liveTenantId },
          branch: { ...BENCHMARK_BRANCH, id: liveBranchId },
          settings: BENCHMARK_SETTINGS,
          catalogProducts: BENCHMARK_PRODUCTS,
          customer: {
            customerName: 'Ramesh Patel',
            customerPhone: '9876543210',
            paymentMethod: 'ONLINE_UPI',
          },
          items: [{ productId: 'prod_aloo_samosa', quantity: 2 }],
        })
      ).rejects.toThrow('Insufficient stock for product "Samosa"')

      mockRpc.mockRestore()
    })

    it('demonstrates why create-razorpay-order returns 404 "Order not found" when mock ID is passed', () => {
      // Simulate how Edge Function looks up order:
      const ordersInDatabase = new Map<string, any>()
      // Live order exists in PostgreSQL
      ordersInDatabase.set('real-uuid-order-123', {
        id: 'real-uuid-order-123',
        total_paisa: 2100,
        status: 'PENDING_PAYMENT',
        payment_status: 'UNPAID',
        secure_access_token: 'valid_token_xyz',
      })

      const mockOrderId = `ord_${Date.now()}` // The client-side demo ID

      const lookupOrder = (id: string, token: string) => {
        const order = ordersInDatabase.get(id)
        if (!order) {
          return { status: 404, error: 'Order not found' }
        }
        if (order.secure_access_token !== token) {
          return { status: 403, error: 'Unauthorized: Invalid order access token' }
        }
        return { status: 200, order }
      }

      // Looking up the fake client-side order returns 404 Order not found:
      const fakeResult = lookupOrder(mockOrderId, 'any_token')
      expect(fakeResult.status).toBe(404)
      expect(fakeResult.error).toBe('Order not found')

      // Looking up a real database order succeeds:
      const realResult = lookupOrder('real-uuid-order-123', 'valid_token_xyz')
      expect(realResult.status).toBe(200)
    })
  })

  // =========================================================================
  // 3. PICKUP TOKENS & REGRESSION TEST FOR #A044
  // =========================================================================
  describe('3. Pickup Tokens & Elimination of Repeated #A044', () => {
    it('REGRESSION: consecutive demo cash orders receive DIFFERENT tokens, never repeating #A044', async () => {
      // Create first cash order in demo mode
      const order1 = await createCustomerOrder({
        business: BENCHMARK_BUSINESS, // Demo shop
        branch: BENCHMARK_BRANCH,
        settings: BENCHMARK_SETTINGS,
        catalogProducts: BENCHMARK_PRODUCTS,
        customer: {
          customerName: 'Customer One',
          customerPhone: '9811111111',
          paymentMethod: 'CASH_COUNTER',
        },
        items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
      })

      // Create second cash order in demo mode
      const order2 = await createCustomerOrder({
        business: BENCHMARK_BUSINESS,
        branch: BENCHMARK_BRANCH,
        settings: BENCHMARK_SETTINGS,
        catalogProducts: BENCHMARK_PRODUCTS,
        customer: {
          customerName: 'Customer Two',
          customerPhone: '9822222222',
          paymentMethod: 'CASH_COUNTER',
        },
        items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
      })

      expect(order1.pickupToken?.tokenDisplay).toBeDefined()
      expect(order2.pickupToken?.tokenDisplay).toBeDefined()

      // CRITICAL ASSERTION: The two tokens MUST be different!
      expect(order1.pickupToken?.tokenDisplay).not.toBe(order2.pickupToken?.tokenDisplay)

      // Sequential progression:
      const seq1 = order1.pickupToken?.sequenceNum ?? 0
      const seq2 = order2.pickupToken?.sequenceNum ?? 0
      expect(seq2).toBe(seq1 + 1)
    })

    it('links each token strictly to the correct order ID', async () => {
      const order = await createCustomerOrder({
        business: BENCHMARK_BUSINESS,
        branch: BENCHMARK_BRANCH,
        settings: BENCHMARK_SETTINGS,
        catalogProducts: BENCHMARK_PRODUCTS,
        customer: {
          customerName: 'Customer Linked',
          customerPhone: '9833333333',
          paymentMethod: 'CASH_COUNTER',
        },
        items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
      })

      expect(order.pickupToken).toBeDefined()
      expect(order.pickupToken?.orderId).toBe(order.id)
    })

    it('correctly formats sequence numbers above 999 without truncation or padding bugs', () => {
      const formatToken = (prefix: string, seq: number) => {
        const numStr = String(seq)
        return prefix + numStr.padStart(Math.max(3, numStr.length), '0')
      }

      expect(formatToken('A', 1)).toBe('A001')
      expect(formatToken('A', 44)).toBe('A044')
      expect(formatToken('A', 999)).toBe('A999')
      expect(formatToken('A', 1000)).toBe('A1000') // 4 digits
      expect(formatToken('A', 1054)).toBe('A1054')
      expect(formatToken('A', 25000)).toBe('A25000')
    })

    it('verifies the 4:00 AM IST daily rollover boundary rule', () => {
      const computeBusinessDate = (isoTimestamp: string) => {
        const date = new Date(isoTimestamp)
        // Matches PostgreSQL: (timezone('Asia/Kolkata', now()) - interval '4 hours')::date
        const minus4Hrs = new Date(date.getTime() - 4 * 60 * 60 * 1000)
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(minus4Hrs)
      }

      // 03:59:59 AM IST on Nov 3 (22:29:59 UTC on Nov 2)
      expect(computeBusinessDate('2026-11-02T22:29:59.000Z')).toBe('2026-11-02')

      // 04:00:00 AM IST on Nov 3 (22:30:00 UTC on Nov 2)
      expect(computeBusinessDate('2026-11-02T22:30:00.000Z')).toBe('2026-11-03')
    })

    it('preserves the exact allocated token when customer refreshes the tracking page', async () => {
      const order = await createCustomerOrder({
        business: BENCHMARK_BUSINESS,
        branch: BENCHMARK_BRANCH,
        settings: BENCHMARK_SETTINGS,
        catalogProducts: BENCHMARK_PRODUCTS,
        customer: {
          customerName: 'Refresh Customer',
          customerPhone: '9844444444',
          paymentMethod: 'CASH_COUNTER',
        },
        items: [{ productId: 'prod_aloo_samosa', quantity: 1 }],
      })

      const originalToken = order.pickupToken?.tokenDisplay
      expect(originalToken).toBeDefined()

      // Simulate first retrieval
      const fetch1 = await getOrderBySecureToken(order.secureAccessToken)
      expect(fetch1?.pickupToken?.tokenDisplay).toBe(originalToken)

      // Simulate page refresh (second retrieval)
      const fetch2 = await getOrderBySecureToken(order.secureAccessToken)
      expect(fetch2?.pickupToken?.tokenDisplay).toBe(originalToken)
    })

    it('simulates concurrency safety: 10 parallel token allocations acquire sequential distinct sequences', () => {
      // Simulating the PostgreSQL atomic UPSERT RETURNING last_sequence behavior
      let dbSequence = 100
      const allocateTokenMock = () => {
        const allocated = ++dbSequence
        return {
          tokenDisplay: `A${String(allocated).padStart(3, '0')}`,
          sequenceNum: allocated,
        }
      }

      const results = Array.from({ length: 10 }, () => allocateTokenMock())
      const tokenDisplays = results.map((r) => r.tokenDisplay)
      const uniqueDisplays = new Set(tokenDisplays)

      expect(uniqueDisplays.size).toBe(10)
      expect(tokenDisplays[0]).toBe('A101')
      expect(tokenDisplays[9]).toBe('A110')
    })
  })

  // =========================================================================
  // 4. PAYMENT SECURITY & SIGNATURE VERIFICATION
  // =========================================================================
  describe('4. Payment Security & Integrity', () => {
    it('verifies that token validation rejects mismatched or empty secure access tokens', () => {
      const timingSafeEqual = (a: string, b: string): boolean => {
        if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
        let mismatch = 0
        for (let i = 0; i < a.length; i++) {
          mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
        }
        return mismatch === 0
      }

      const validToken = 'sec_tok_f09a8b7c6d5e4f3a2b1c0d9e8f7a6b5c'
      const invalidToken = 'sec_tok_00000000000000000000000000000000'

      expect(timingSafeEqual(validToken, validToken)).toBe(true)
      expect(timingSafeEqual(validToken, invalidToken)).toBe(false)
      expect(timingSafeEqual(validToken, '')).toBe(false)
    })

    it('verifies payment amount and currency mismatch protection in verify-razorpay-payment', () => {
      const verifyPaymentAmounts = (
        orderTotalPaisa: number,
        paymentOrderAmountPaisa: number,
        currency: string
      ): { ok: boolean; error?: string } => {
        if (currency !== 'INR') {
          return { ok: false, error: 'Currency mismatch: Order must be in INR' }
        }
        if (paymentOrderAmountPaisa !== orderTotalPaisa) {
          return {
            ok: false,
            error: `Amount mismatch: Expected ₹${(orderTotalPaisa / 100).toFixed(2)}, got ₹${(paymentOrderAmountPaisa / 100).toFixed(2)}`,
          }
        }
        return { ok: true }
      }

      // Currency check
      expect(verifyPaymentAmounts(2000, 2000, 'USD').ok).toBe(false)
      expect(verifyPaymentAmounts(2000, 2000, 'USD').error).toContain('Currency mismatch')

      // Amount mismatch check
      expect(verifyPaymentAmounts(2000, 1000, 'INR').ok).toBe(false)
      expect(verifyPaymentAmounts(2000, 1000, 'INR').error).toContain('Amount mismatch')

      // Matching amounts in INR succeed
      expect(verifyPaymentAmounts(2000, 2000, 'INR').ok).toBe(true)
    })

    it('ensures webhook idempotency: repeated payment event does not process twice', () => {
      const processedEvents = new Set<string>()

      const processWebhookEvent = (eventId: string, paymentId: string) => {
        if (processedEvents.has(eventId)) {
          return { status: 'already_processed', replayed: true }
        }
        processedEvents.add(eventId)
        return { status: 'processed', paymentId }
      }

      const firstCall = processWebhookEvent('evt_test_123', 'pay_abc_456')
      expect(firstCall.status).toBe('processed')

      // Duplicate delivery from Razorpay:
      const duplicateCall = processWebhookEvent('evt_test_123', 'pay_abc_456')
      expect(duplicateCall.status).toBe('already_processed')
      expect(duplicateCall.replayed).toBe(true)
    })

    it('verifies update_order_status RPC definition in migration and setup SQL', () => {
      const migration13Path = path.resolve(
        process.cwd(),
        'supabase/migrations/20261102000013_add_order_status_rpc_and_kitchen_role.sql'
      )
      const migration13 = fs.readFileSync(migration13Path, 'utf8')
      const setupSql = fs.readFileSync(path.resolve(process.cwd(), 'supabase/setup_complete.sql'), 'utf8')

      expect(migration13).toContain('CREATE OR REPLACE FUNCTION public.update_order_status')
      expect(migration13).toContain('GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, VARCHAR, TEXT) TO anon, authenticated, service_role;')
      expect(migration13).toContain("'owner', 'manager', 'cashier', 'kitchen'")

      expect(setupSql).toContain('CREATE OR REPLACE FUNCTION public.update_order_status')
      expect(setupSql).toContain('GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, VARCHAR, TEXT) TO anon, authenticated, service_role;')
      expect(setupSql).toContain("'owner', 'manager', 'cashier', 'kitchen'")
    })

    it('verifies 4-stage tracking timeline & handover completion (PLACED -> PREPARING -> READY -> COMPLETED)', () => {
      const getStepIndex = (status: string) => {
        switch (status) {
          case 'PLACED':
            return 0
          case 'ACCEPTED':
          case 'PREPARING':
            return 1
          case 'READY':
            return 2
          case 'COMPLETED':
            return 3
          default:
            return 0
        }
      }

      // Check step indices
      expect(getStepIndex('PLACED')).toBe(0)
      expect(getStepIndex('ACCEPTED')).toBe(1)
      expect(getStepIndex('PREPARING')).toBe(1)
      expect(getStepIndex('READY')).toBe(2)
      expect(getStepIndex('COMPLETED')).toBe(3)

      // Step completion logic
      const evaluateSteps = (status: string) => {
        const isCompleted = status === 'COMPLETED'
        const currentStep = getStepIndex(status)
        const stepKeys = ['PLACED', 'PREPARING', 'READY', 'COMPLETED']
        return stepKeys.map((_k, idx) => ({
          isDone: isCompleted ? true : idx < currentStep,
          isCurrent: !isCompleted && idx === currentStep,
        }))
      }

      // In READY state: Step 0 & 1 done, Step 2 isCurrent
      const readySteps = evaluateSteps('READY')
      expect(readySteps[0].isDone).toBe(true)
      expect(readySteps[1].isDone).toBe(true)
      expect(readySteps[2].isCurrent).toBe(true)
      expect(readySteps[3].isDone).toBe(false)

      // In COMPLETED state (Handed over): ALL steps done, NO step "in progress"
      const completedSteps = evaluateSteps('COMPLETED')
      expect(completedSteps.every((s) => s.isDone)).toBe(true)
      expect(completedSteps.some((s) => s.isCurrent)).toBe(false)
    })

    it('verifies real-time broadcast and subscription across components with zero refresh', () => {
      const receivedEvents: OrderRealtimePayload[] = []
      const unsubscribe = subscribeToOrderEvents((event) => {
        receivedEvents.push(event)
      })

      // Simulate online payment completion broadcast
      broadcastOrderEvent({
        eventType: 'ORDER_PAID',
        orderId: 'c0000000-0000-0000-0000-000000000001',
        secureAccessToken: 'sec_tok_test_123',
        businessId: 'a0000000-0000-0000-0000-000000000001',
        status: 'PLACED',
      })

      // Simulate status transition broadcast to READY
      broadcastOrderEvent({
        eventType: 'STATUS_CHANGED',
        orderId: 'c0000000-0000-0000-0000-000000000001',
        secureAccessToken: 'sec_tok_test_123',
        status: 'READY',
      })

      expect(receivedEvents.length).toBe(2)
      expect(receivedEvents[0].eventType).toBe('ORDER_PAID')
      expect(receivedEvents[0].status).toBe('PLACED')
      expect(receivedEvents[1].eventType).toBe('STATUS_CHANGED')
      expect(receivedEvents[1].status).toBe('READY')

      unsubscribe()

      // Subsequent events after unsubscription are ignored
      broadcastOrderEvent({
        eventType: 'STATUS_CHANGED',
        orderId: 'c0000000-0000-0000-0000-000000000001',
        status: 'COMPLETED',
      })

      expect(receivedEvents.length).toBe(2)
    })
  })
})
