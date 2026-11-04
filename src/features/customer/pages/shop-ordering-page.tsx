import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShoppingBag, ArrowRight, Search, AlertCircle, Bell } from 'lucide-react'
import { ShopHeader } from '../components/shop-header'
import { CategoryNav } from '../components/category-nav'
import { ProductCard } from '../components/product-card'
import { ProductDetailModal } from '../components/product-detail-modal'
import { CartDrawer } from '../components/cart-drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCartStore } from '../hooks/use-cart-store'
import { formatPaisaToINR } from '@/lib/currency'
import { getShopCatalogBySlug } from '@/services/catalog.service'
import { getOrderBySecureToken } from '@/services/order.service'
import { subscribeToCatalogEvents, subscribeToOrderEvents } from '@/services/realtime.service'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Product, ProductVariant } from '@/types/domain'
import type { SelectedAddonItem } from '@/types/cart'
import type { Order } from '@/types/order'

export const ShopOrderingPage: React.FC = () => {
  const { slug = 'samosa-corner' } = useParams<{ slug: string }>()
  const navigate = useNavigate()

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [vegOnlyFilter, setVegOnlyFilter] = useState(false)
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)

  const { items, addItem, getTotalCount, getSubtotalPaisa } = useCartStore()
  const queryClient = useQueryClient()

  // Query catalog data via Catalog Service (includes unavailable items so they display with out-of-stock badges)
  const { data: catalogData, isLoading, isError, error } = useQuery({
    queryKey: ['shop-catalog', slug],
    queryFn: () => getShopCatalogBySlug(slug, { includeUnavailable: true }),
    refetchInterval: 2500,
  })

  // Check for any live active customer order stored in localStorage
  useEffect(() => {
    const checkActiveOrder = async () => {
      const activeToken = typeof window !== 'undefined' ? localStorage.getItem('quickbite_active_order_token') : null
      if (activeToken) {
        try {
          const ord = await getOrderBySecureToken(activeToken)
          if (ord && ord.status !== 'COMPLETED' && ord.status !== 'CANCELLED') {
            setActiveOrder(ord)
          } else {
            setActiveOrder(null)
          }
        } catch {
          // Ignore
        }
      }
    }
    checkActiveOrder()
  }, [])

  // Real-time catalog feed: instant updates for product prices, availability, deletions and additions
  useEffect(() => {
    // 1. Subscribe to instant cross-client catalog broadcast
    const unsubscribeCatalog = subscribeToCatalogEvents(() => {
      queryClient.invalidateQueries({ queryKey: ['shop-catalog', slug] })
      queryClient.refetchQueries({ queryKey: ['shop-catalog', slug] })
    })

    // 2. Subscribe to order lifecycle events to update active order pill in real-time
    const unsubscribeOrder = subscribeToOrderEvents((event) => {
      const activeToken = typeof window !== 'undefined' ? localStorage.getItem('quickbite_active_order_token') : null
      if (activeToken && (event.secureAccessToken === activeToken || event.orderId === activeOrder?.id)) {
        if (event.status) {
          setActiveOrder((prev) =>
            prev ? { ...prev, status: event.status! } : prev
          )
        }
        getOrderBySecureToken(activeToken).then((ord) => {
          if (ord) setActiveOrder(ord)
        })
      }
    })

    // 3. Supabase Postgres changes fallback
    let channel: any = null
    if (isSupabaseConfigured) {
      channel = supabase
        .channel(`shop-catalog-feed-${slug}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'products' },
          () => {
            queryClient.invalidateQueries({ queryKey: ['shop-catalog', slug] })
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'categories' },
          () => {
            queryClient.invalidateQueries({ queryKey: ['shop-catalog', slug] })
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'business_settings' },
          () => {
            queryClient.invalidateQueries({ queryKey: ['shop-catalog', slug] })
          }
        )
        .subscribe()
    }

    return () => {
      unsubscribeCatalog()
      unsubscribeOrder()
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [slug, queryClient, activeOrder?.id])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8F6F1] p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-full" />
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  if (isError || !catalogData) {
    return (
      <div className="min-h-screen bg-[#F8F6F1] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-[#E6E2D8] p-8 max-w-md text-center space-y-4 shadow-sm">
          <div className="w-16 h-16 rounded-full bg-[#FDEEED] text-[#C0352A] flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-[#20201E]">
            {error ? 'Unable to Load Menu' : 'Shop Not Found'}
          </h2>
          <p className="text-xs text-[#575653]">
            {error instanceof Error
              ? error.message
              : `The food stall or shop with address /${slug} is not available or has not been activated.`}
          </p>
          <Button onClick={() => navigate('/shop/samosa-corner')} className="w-full">
            Retry / Return to Samosa Corner
          </Button>
        </div>
      </div>
    )
  }

  const { business, branch, settings, categories, products } = catalogData

  // Derive active category from user selection or default to first category
  const activeCategoryId = selectedCategoryId || (categories[0]?.id ?? '')

  const handleProductClick = (product: Product) => {
    if (!product.isAvailable) return
    setSelectedProduct(product)
    setIsModalOpen(true)
  }

  const handleAddToCart = (
    product: Product,
    variant?: ProductVariant,
    addons?: SelectedAddonItem[]
  ) => {
    addItem(product, variant, addons)
  }

  const handleCheckoutSuccess = (secureToken: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('quickbite_active_order_token', secureToken)
    }
    navigate(`/order/${secureToken}`)
  }

  const totalCartCount = getTotalCount()
  const subtotalPaisa = getSubtotalPaisa()

  // Filter products by search and veg preference
  const filteredProducts = products.filter((p) => {
    if (vegOnlyFilter && !p.isVeg) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="min-h-screen bg-[#F8F6F1] pb-28">
      {/* Shop Information Header */}
      <ShopHeader business={business} />

      {/* Search and Veg-Only Filter Bar */}
      <div className="bg-white border-b border-[#E6E2D8] py-3 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#8C8A84] absolute left-3 top-3" />
            <Input
              placeholder="Search crispy samosas, kachoris, chai..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-[#F8F6F1] border-[#E6E2D8] text-xs h-9 rounded-full"
            />
          </div>

          <button
            onClick={() => setVegOnlyFilter(!vegOnlyFilter)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer shrink-0 ${
              vegOnlyFilter
                ? 'bg-[#EAF4EE] text-[#247A52] border-[#247A52]'
                : 'bg-white text-[#575653] border-[#E6E2D8] hover:border-[#247A52]'
            }`}
          >
            <span className="w-3.5 h-3.5 rounded-[3px] border border-[#247A52] flex items-center justify-center p-[2px]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#247A52]" />
            </span>
            <span>Veg Only</span>
          </button>
        </div>
      </div>

      {/* Category Navigation Pills */}
      <CategoryNav
        categories={categories}
        activeCategoryId={activeCategoryId}
        onSelectCategory={(id) => {
          setSelectedCategoryId(id)
          const section = document.getElementById(id)
          if (section) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        }}
      />

      {/* Menu Sections grouped by Category */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {categories.map((category) => {
          const categoryProducts = filteredProducts.filter((p) => p.categoryId === category.id)

          if (categoryProducts.length === 0) return null

          return (
            <div key={category.id} id={category.id} className="scroll-mt-16 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-bold text-[#20201E] tracking-tight">
                  {category.name}
                </h2>
                <span className="text-xs text-[#8C8A84] font-medium">
                  {categoryProducts.length} items
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {categoryProducts.map((product) => {
                  const cartCount = items
                    .filter((i) => i.product.id === product.id)
                    .reduce((sum, i) => sum + i.quantity, 0)

                  return (
                    <ProductCard
                      key={product.id}
                      product={product}
                      cartCount={cartCount}
                      onAddClick={handleProductClick}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}

        {filteredProducts.length === 0 && (
          <div className="py-16 text-center text-xs text-[#8C8A84] bg-white rounded-2xl border border-dashed border-[#E6E2D8]">
            <p className="font-semibold text-sm text-[#20201E]">No items match your search</p>
            <p className="mt-1">Try clearing filters or search terms.</p>
          </div>
        )}
      </div>

      {/* Product Detail Customizer Modal */}
      <ProductDetailModal
        product={selectedProduct}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAddToCart={handleAddToCart}
      />

      {/* Floating Active Order Tracker Pill (Visible when an active customer order exists) */}
      {activeOrder && (
        <div
          className={`fixed inset-x-0 z-40 px-4 flex justify-center animate-in slide-in-from-bottom-3 duration-200 ${
            totalCartCount > 0 ? 'bottom-20' : 'bottom-4'
          }`}
        >
          <Link
            to={`/order/${activeOrder.secureAccessToken}`}
            className="w-full max-w-md bg-[#247A52] hover:bg-[#1E6B47] text-white p-3 px-4 rounded-2xl shadow-xl flex items-center justify-between cursor-pointer transition-all border border-emerald-400/40"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                <Bell className="w-3.5 h-3.5 text-white animate-bounce" />
              </div>
              <div className="text-left">
                <p className="text-[11px] text-white/80 font-medium">
                  Token #{activeOrder.pickupToken?.tokenDisplay || '---'} • {activeOrder.customerName}
                </p>
                <p className="text-xs font-extrabold tracking-wide">
                  {activeOrder.status === 'READY'
                    ? '🟢 READY FOR PICKUP AT COUNTER!'
                    : activeOrder.status === 'PREPARING'
                    ? '🟡 Kitchen is Preparing...'
                    : '🔵 Order Received & Queued'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 font-bold text-xs underline pr-1">
              <span>Track Live</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </Link>
        </div>
      )}

      {/* Sticky Bottom Floating Cart Pill */}
      {totalCartCount > 0 && (
        <div className="fixed bottom-4 inset-x-0 z-40 px-4 flex justify-center animate-in slide-in-from-bottom-5 duration-200">
          <button
            onClick={() => setIsCartOpen(true)}
            className="w-full max-w-md bg-[#D95732] hover:bg-[#C24B29] active:bg-[#B33F1F] text-white p-3.5 rounded-2xl shadow-xl flex items-center justify-between cursor-pointer transition-all transform hover:-translate-y-0.5"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center font-bold text-sm">
                <ShoppingBag className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <p className="text-xs text-white/80 font-medium">
                  {totalCartCount} {totalCartCount === 1 ? 'item' : 'items'} in cart
                </p>
                <p className="text-base font-bold tabular-nums">
                  {formatPaisaToINR(subtotalPaisa)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 font-bold text-sm pr-1">
              <span>View Cart</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      )}

      {/* Cart Checkout Drawer with Server Price Validation */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        onCheckoutSuccess={handleCheckoutSuccess}
        business={business}
        branch={branch}
        settings={settings}
        catalogProducts={products}
      />
    </div>
  )
}

