import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getShopCatalogBySlug } from './catalog.service'
import { supabase } from '@/lib/supabase'

describe('catalog.service: Shop Catalog & Domain Mapping', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects silent fallback and throws an error when live Supabase queries fail', async () => {
    // Mock Supabase to simulate a query error
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
          data: {
            id: 'a0000000-0000-0000-0000-000000000001',
            name: 'Samosa Corner',
            slug: 'samosa-corner',
            is_active: true,
            currency: 'INR',
            created_at: new Date().toISOString(),
          },
          error: null,
        })
      }

      // Simulate RLS permission failure on branches / products
      return createChain({
        data: null,
        error: { message: 'permission denied for function get_auth_business_id' },
      })
    })

    // Must NOT silently fallback to benchmark store! Must throw the real error!
    await expect(getShopCatalogBySlug('samosa-corner')).rejects.toThrow(
      'Failed to load shop catalog for "samosa-corner"'
    )

    fromSpy.mockRestore()
  })

  it('retrieves and properly maps live shop catalog when queries succeed', async () => {
    const mockBiz = {
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Live Samosa Corner',
      slug: 'samosa-corner',
      tagline: 'Fresh & Hot',
      phone: '+91 8320917837',
      address: 'Maharajganj Main Rd, near by Sharamahala, Located in: Kali Mandir maharajganj',
      city: 'Jamui, Bihar 811307',
      is_active: true,
      currency: 'INR',
      created_at: '2026-01-01T00:00:00Z',
    }

    const mockBranch = {
      id: 'b0000000-0000-0000-0000-000000000001',
      business_id: mockBiz.id,
      name: 'Main Branch',
      code: 'MAIN',
      address: 'Maharajganj Main Rd, near by Sharamahala, Located in: Kali Mandir maharajganj, Jamui, Bihar 811307',
      phone: '+91 8320917837',
      is_primary: true,
      is_active: true,
    }

    const mockSettings = {
      business_id: mockBiz.id,
      allow_cash: true,
      allow_online: true,
      auto_accept_orders: false,
      tax_gst_percentage: 5.0,
      service_charge_percentage: 0.0,
      order_prefix: 'A',
      estimatedPrepMinutes: 15,
    }

    const mockCategory = {
      id: 'c0000000-0000-0000-0000-000000000001',
      business_id: mockBiz.id,
      name: 'Samosas',
      slug: 'samosas',
      display_order: 1,
      is_active: true,
    }

    const mockProduct = {
      id: 'p0000000-0000-0000-0000-000000000001',
      business_id: mockBiz.id,
      category_id: mockCategory.id,
      name: 'Aloo Samosa',
      description: 'Crispy potato samosa',
      image_url: null,
      base_price_paisa: 2000,
      is_veg: true,
      is_available: true,
      product_variants: [],
      product_addons: [],
    }

    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'businesses') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: vi.fn().mockResolvedValue({ data: mockBiz, error: null }),
              }),
            }),
          }),
        } as any
      }
      if (table === 'branches') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                single: vi.fn().mockResolvedValue({ data: mockBranch, error: null }),
              }),
            }),
          }),
        } as any
      }
      if (table === 'public_business_settings' || table === 'business_settings') {
        return {
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({ data: mockSettings, error: null }),
            }),
          }),
        } as any
      }
      if (table === 'categories') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: vi.fn().mockResolvedValue({ data: [mockCategory], error: null }),
              }),
            }),
          }),
        } as any
      }
      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              eq: vi.fn().mockResolvedValue({ data: [mockProduct], error: null }),
            }),
          }),
        } as any
      }
      return {} as any
    })

    const catalog = await getShopCatalogBySlug('samosa-corner')
    expect(catalog).not.toBeNull()
    if (!catalog) return

    expect(catalog.business.id).toBe(mockBiz.id)
    expect(catalog.business.name).toBe('Live Samosa Corner')
    expect(catalog.branch.id).toBe(mockBranch.id)
    expect(catalog.settings.taxGstPercentage).toBe(5)
    expect(catalog.categories.length).toBe(1)
    expect(catalog.products.length).toBe(1)
    expect(catalog.products[0].name).toBe('Aloo Samosa')

    fromSpy.mockRestore()
  })

  it('returns null for an invalid non-existent shop slug', async () => {
    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'businesses') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116', message: 'Row not found' },
                }),
              }),
            }),
          }),
        } as any
      }
      return {} as any
    })

    const catalog = await getShopCatalogBySlug('non-existent-shop-slug-9999')
    expect(catalog).toBeNull()

    fromSpy.mockRestore()
  })
})
