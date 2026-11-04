import type { Business, Branch, BusinessSettings, Category, Product } from '@/types/domain'
import {
  BENCHMARK_BUSINESS,
  BENCHMARK_BRANCH,
  BENCHMARK_SETTINGS,
  BENCHMARK_CATEGORIES,
  BENCHMARK_PRODUCTS,
} from '@/lib/mock-data/benchmark-shop'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { broadcastCatalogEvent } from './realtime.service'

export interface ShopCatalogData {
  business: Business
  branch: Branch
  settings: BusinessSettings
  categories: Category[]
  products: Product[]
}

const CATALOG_OVERRIDES_STORAGE_KEY = 'quickbite_catalog_overrides'

export interface CatalogOverrides {
  availability: Record<string, boolean>
  prices: Record<string, number>
  deletedProductIds: string[]
  customProducts: Product[]
}

let inMemoryCatalogOverrides: CatalogOverrides = {
  availability: {},
  prices: {},
  deletedProductIds: [],
  customProducts: [],
}

function isUuid(val?: string | null): boolean {
  if (!val) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
}

export function getLocalCatalogOverrides(): CatalogOverrides {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(CATALOG_OVERRIDES_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        inMemoryCatalogOverrides = {
          availability: parsed.availability || {},
          prices: parsed.prices || {},
          deletedProductIds: Array.isArray(parsed.deletedProductIds) ? parsed.deletedProductIds : [],
          customProducts: Array.isArray(parsed.customProducts) ? parsed.customProducts : [],
        }
      }
    } catch {
      // Ignore
    }
  }
  return inMemoryCatalogOverrides
}

export function saveLocalCatalogOverrides(overrides: CatalogOverrides): void {
  inMemoryCatalogOverrides = overrides
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(CATALOG_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides))
    } catch {
      // Ignore
    }
  }
}

/**
 * Toggle product availability with instant local persistence, real-time broadcast,
 * and database synchronization.
 */
export async function toggleProductAvailability(productId: string, isAvailable: boolean): Promise<boolean> {
  const overrides = getLocalCatalogOverrides()
  overrides.availability[productId] = isAvailable
  // If it's a custom product, update it inline
  overrides.customProducts = overrides.customProducts.map((p) =>
    p.id === productId ? { ...p, isAvailable } : p
  )
  saveLocalCatalogOverrides(overrides)

  // Instant real-time broadcast
  broadcastCatalogEvent({
    eventType: 'PRODUCT_TOGGLED',
    productId,
    isAvailable,
  })

  // Synchronize to Supabase database if configured
  if (isSupabaseConfigured && isUuid(productId)) {
    try {
      const { error: rpcErr } = await supabase.rpc('admin_toggle_product_availability', {
        p_product_id: productId,
        p_is_available: isAvailable,
      })

      if (rpcErr) {
        await supabase
          .from('products')
          .update({ is_available: isAvailable, updated_at: new Date().toISOString() })
          .eq('id', productId)
      }
    } catch (err) {
      console.warn('Failed to persist product availability in Supabase:', err)
    }
  }

  return true
}

/**
 * Update product base price with instant local persistence, real-time broadcast,
 * and database synchronization.
 */
export async function updateProductPrice(productId: string, basePricePaisa: number): Promise<boolean> {
  const overrides = getLocalCatalogOverrides()
  overrides.prices[productId] = basePricePaisa
  overrides.customProducts = overrides.customProducts.map((p) =>
    p.id === productId ? { ...p, basePricePaisa } : p
  )
  saveLocalCatalogOverrides(overrides)

  broadcastCatalogEvent({
    eventType: 'PRODUCT_PRICE_UPDATED',
    productId,
    basePricePaisa,
  })

  if (isSupabaseConfigured && isUuid(productId)) {
    try {
      const { error: rpcErr } = await supabase.rpc('admin_update_product_price', {
        p_product_id: productId,
        p_base_price_paisa: basePricePaisa,
      })

      if (rpcErr) {
        await supabase
          .from('products')
          .update({ base_price_paisa: basePricePaisa, updated_at: new Date().toISOString() })
          .eq('id', productId)
      }
    } catch (err) {
      console.warn('Failed to persist product price in Supabase:', err)
    }
  }

  return true
}

/**
 * Create a new catalog product with instant local persistence, real-time broadcast,
 * and database synchronization.
 */
export async function createCatalogProduct(data: {
  businessId?: string
  categoryId?: string
  name: string
  description?: string
  basePricePaisa: number
  isVeg: boolean
}): Promise<Product> {
  let createdId = `prod_custom_${Date.now()}`
  let resolvedBusinessId = data.businessId && isUuid(data.businessId) ? data.businessId : undefined
  let resolvedCategoryId = data.categoryId && isUuid(data.categoryId) ? data.categoryId : undefined

  if (isSupabaseConfigured) {
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_create_product', {
        p_business_id: resolvedBusinessId || null,
        p_category_id: resolvedCategoryId || null,
        p_name: data.name,
        p_description: data.description || 'Freshly prepared item',
        p_base_price_paisa: data.basePricePaisa,
        p_is_veg: data.isVeg,
        p_is_available: true,
      })

      if (!rpcErr && rpcData?.id) {
        createdId = rpcData.id
        resolvedBusinessId = rpcData.business_id
        resolvedCategoryId = rpcData.category_id
      }
    } catch (err) {
      console.warn('Supabase product creation error:', err)
    }
  }

  const newProduct: Product = {
    id: createdId,
    businessId: resolvedBusinessId || 'biz_samosa_corner_01',
    categoryId: resolvedCategoryId || data.categoryId || 'cat_01',
    name: data.name,
    description: data.description || 'Freshly prepared item',
    basePricePaisa: data.basePricePaisa,
    isVeg: data.isVeg,
    isAvailable: true,
    variants: [],
    addons: [],
  }

  const overrides = getLocalCatalogOverrides()
  overrides.customProducts = [newProduct, ...overrides.customProducts.filter((p) => p.id !== createdId)]
  saveLocalCatalogOverrides(overrides)

  broadcastCatalogEvent({
    eventType: 'PRODUCT_CREATED',
    product: newProduct,
  })

  return newProduct
}

/**
 * Delete a product with instant local removal, real-time broadcast,
 * and database synchronization.
 */
export async function deleteCatalogProduct(productId: string): Promise<boolean> {
  const overrides = getLocalCatalogOverrides()
  if (!overrides.deletedProductIds.includes(productId)) {
    overrides.deletedProductIds.push(productId)
  }
  overrides.customProducts = overrides.customProducts.filter((p) => p.id !== productId)
  delete overrides.availability[productId]
  delete overrides.prices[productId]
  saveLocalCatalogOverrides(overrides)

  broadcastCatalogEvent({
    eventType: 'PRODUCT_DELETED',
    productId,
  })

  if (isSupabaseConfigured && isUuid(productId)) {
    try {
      const { error: rpcErr } = await supabase.rpc('admin_delete_product', {
        p_product_id: productId,
      })

      if (rpcErr) {
        await supabase.from('products').delete().eq('id', productId)
      }
    } catch (err) {
      console.warn('Failed to delete product in Supabase:', err)
    }
  }

  return true
}

/**
 * Catalog Service:
 * Retrieves business, branch, settings, active categories, and active products.
 * If Supabase credentials are configured, reads directly from PostgreSQL (via RLS).
 * Merges local catalog overrides for immediate real-time synchronization.
 * Never silently replaces a failed live catalog request with demo data.
 * Offline demo fallback is permitted ONLY when Supabase is not configured or demo mode is explicitly enabled.
 */
export async function getShopCatalogBySlug(
  slug: string,
  options?: { includeUnavailable?: boolean }
): Promise<ShopCatalogData | null> {
  const isExplicitDemo = import.meta.env.VITE_ENABLE_DEMO_MODE === 'true'
  const overrides = getLocalCatalogOverrides()

  if (isSupabaseConfigured && !isExplicitDemo) {
    try {
      const { data: business, error: bizError } = await supabase
        .from('businesses')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single()

      if (bizError) {
        if (bizError.code === 'PGRST116') {
          return null
        }
        throw new Error(`Failed to query shop "${slug}": ${bizError.message}`)
      }

      if (!business) {
        return null
      }

      const fetchPublicSettings = async () => {
        const { data: viewData, error: viewError } = await supabase
          .from('public_business_settings')
          .select('*')
          .eq('business_id', business.id)
          .single()

        if (!viewError && viewData) {
          return { data: viewData, error: null }
        }

        const { data: rpcData, error: rpcError } = await supabase.rpc('get_public_business_settings', {
          p_business_id: business.id,
        })

        if (!rpcError && rpcData) {
          return { data: rpcData, error: null }
        }

        return { data: null, error: viewError || rpcError }
      }

      let prodQuery = supabase
        .from('products')
        .select('*, product_variants(*), product_addons(*)')
        .eq('business_id', business.id)

      if (!options?.includeUnavailable) {
        prodQuery = prodQuery.eq('is_available', true)
      }

      const [branchRes, settingsRes, catRes, prodRes] = await Promise.all([
        supabase.from('branches').select('*').eq('business_id', business.id).limit(1).single(),
        fetchPublicSettings(),
        supabase.from('categories').select('*').eq('business_id', business.id).eq('is_active', true).order('display_order'),
        prodQuery,
      ])

      const errors: string[] = []
      if (branchRes.error) errors.push(`Branch: ${branchRes.error.message}`)
      if (settingsRes.error) errors.push(`Settings: ${settingsRes.error.message}`)
      if (catRes.error) errors.push(`Categories: ${catRes.error.message}`)
      if (prodRes.error) errors.push(`Products: ${prodRes.error.message}`)

      if (errors.length > 0) {
        throw new Error(`Failed to load shop catalog for "${slug}": ${errors.join('; ')}`)
      }

      const dbProducts = (prodRes.data || [])
        .filter((p: any) => !overrides.deletedProductIds.includes(p.id))
        .map((p: any) => {
          const isAvail = overrides.availability[p.id] !== undefined
            ? overrides.availability[p.id]
            : Boolean(p.is_available)
          const price = overrides.prices[p.id] !== undefined
            ? overrides.prices[p.id]
            : Number(p.base_price_paisa)

          return {
            id: p.id,
            businessId: p.business_id,
            categoryId: p.category_id,
            name: p.name,
            description: p.description || '',
            imageUrl: p.image_url || undefined,
            basePricePaisa: price,
            isVeg: Boolean(p.is_veg),
            isAvailable: isAvail,
            variants: (p.product_variants || []).map((v: any) => ({
              id: v.id,
              productId: v.product_id,
              name: v.name,
              priceOverridePaisa: Number(v.price_override_paisa),
              isDefault: Boolean(v.is_default),
            })),
            addons: (p.product_addons || []).map((a: any) => ({
              id: a.id,
              productId: a.product_id,
              name: a.name,
              pricePaisa: Number(a.price_paisa),
              maxQuantity: Number(a.max_quantity ?? 5),
            })),
          }
        })

      // Merge local custom products not present in database
      const liveProductIds = new Set((prodRes.data || []).map((p: any) => p.id))
      const extraCustom = overrides.customProducts
        .filter((cp) => !overrides.deletedProductIds.includes(cp.id) && !liveProductIds.has(cp.id))
        .map((cp) => ({
          ...cp,
          isAvailable: overrides.availability[cp.id] !== undefined ? overrides.availability[cp.id] : cp.isAvailable,
          basePricePaisa: overrides.prices[cp.id] !== undefined ? overrides.prices[cp.id] : cp.basePricePaisa,
        }))

      let allProducts = [...dbProducts, ...extraCustom]
      if (!options?.includeUnavailable) {
        allProducts = allProducts.filter((p) => p.isAvailable)
      }

      return {
        business: {
          id: business.id,
          name: business.name,
          slug: business.slug,
          tagline: business.tagline,
          phone: business.phone,
          address: business.address,
          city: business.city,
          isActive: business.is_active,
          currency: business.currency,
          createdAt: business.created_at,
        },
        branch: {
          id: branchRes.data.id,
          businessId: branchRes.data.business_id,
          name: branchRes.data.name,
          code: branchRes.data.code,
          address: branchRes.data.address || '',
          phone: branchRes.data.phone || '',
          isPrimary: Boolean(branchRes.data.is_primary),
          isActive: Boolean(branchRes.data.is_active),
        },
        settings: {
          businessId: settingsRes.data.business_id,
          allowCash: Boolean(settingsRes.data.allow_cash),
          allowOnline: Boolean(settingsRes.data.allow_online),
          autoAcceptOrders: Boolean(settingsRes.data.auto_accept_orders),
          taxGstPercentage: Number(settingsRes.data.tax_gst_percentage ?? 5),
          serviceChargePercentage: Number(settingsRes.data.service_charge_percentage ?? 0),
          orderPrefix: settingsRes.data.order_prefix || 'A',
          estimatedPrepMinutes: Number(settingsRes.data.estimated_prep_minutes ?? 10),
        },
        categories: (catRes.data || []).map((c: any) => ({
          id: c.id,
          businessId: c.business_id,
          name: c.name,
          slug: c.slug,
          displayOrder: Number(c.display_order ?? 0),
          isActive: Boolean(c.is_active),
        })),
        products: allProducts,
      }
    } catch (err: any) {
      console.error('Failed to query Supabase catalog:', err?.message || err)
      throw err
    }
  }

  // Offline / explicit demo mode fallback ONLY
  if (slug === 'samosa-corner' || slug === BENCHMARK_BUSINESS.slug) {
    const demoProducts = BENCHMARK_PRODUCTS
      .filter((p) => !overrides.deletedProductIds.includes(p.id))
      .map((p) => {
        const isAvail = overrides.availability[p.id] !== undefined
          ? overrides.availability[p.id]
          : p.isAvailable
        const price = overrides.prices[p.id] !== undefined
          ? overrides.prices[p.id]
          : p.basePricePaisa
        return {
          ...p,
          isAvailable: isAvail,
          basePricePaisa: price,
        }
      })

    const extraCustom = overrides.customProducts
      .filter((cp) => !overrides.deletedProductIds.includes(cp.id) && !BENCHMARK_PRODUCTS.some((bp) => bp.id === cp.id))
      .map((cp) => ({
        ...cp,
        isAvailable: overrides.availability[cp.id] !== undefined ? overrides.availability[cp.id] : cp.isAvailable,
        basePricePaisa: overrides.prices[cp.id] !== undefined ? overrides.prices[cp.id] : cp.basePricePaisa,
      }))

    let allProducts = [...demoProducts, ...extraCustom]
    if (!options?.includeUnavailable) {
      allProducts = allProducts.filter((p) => p.isAvailable)
    }

    return {
      business: BENCHMARK_BUSINESS,
      branch: BENCHMARK_BRANCH,
      settings: BENCHMARK_SETTINGS,
      categories: BENCHMARK_CATEGORIES,
      products: allProducts,
    }
  }

  return null
}

/**
 * Retrieves the currently active business profile from Supabase.
 * Returns null if no active business exists or Supabase is not configured.
 */
export async function getActiveBusiness(): Promise<Business | null> {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!error && data) {
        return {
          id: data.id,
          name: data.name,
          slug: data.slug,
          tagline: data.tagline,
          phone: data.phone,
          address: data.address,
          city: data.city,
          isActive: data.is_active,
          currency: data.currency,
          createdAt: data.created_at,
        }
      }
    } catch (err) {
      console.warn('Could not fetch active business:', err)
    }
    return null
  }

  // Pure demo / offline mode fallback only
  return BENCHMARK_BUSINESS
}

