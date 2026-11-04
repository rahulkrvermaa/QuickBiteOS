import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Edit2, Check, X, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatPaisaToINR } from '@/lib/currency'
import { BENCHMARK_CATEGORIES, BENCHMARK_PRODUCTS } from '@/lib/mock-data/benchmark-shop'
import {
  getShopCatalogBySlug,
  toggleProductAvailability,
  updateProductPrice,
  createCatalogProduct,
  deleteCatalogProduct,
} from '@/services/catalog.service'
import { subscribeToCatalogEvents } from '@/services/realtime.service'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Product, Category } from '@/types/domain'

export const MenuPage: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>(isSupabaseConfigured ? [] : BENCHMARK_CATEGORIES)
  const [products, setProducts] = useState<Product[]>(isSupabaseConfigured ? [] : BENCHMARK_PRODUCTS)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [priceInput, setPriceInput] = useState<string>('')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newProdName, setNewProdName] = useState('')
  const [newProdCategory, setNewProdCategory] = useState(isSupabaseConfigured ? '' : (BENCHMARK_CATEGORIES[0]?.id || ''))
  const [newProdPriceINR, setNewProdPriceINR] = useState('')
  const [newProdIsVeg, setNewProdIsVeg] = useState(true)

  const loadMenu = useCallback(async () => {
    try {
      const data = await getShopCatalogBySlug('samosa-corner', { includeUnavailable: true })
      if (data) {
        setCategories(data.categories || [])
        setProducts(data.products || [])
        if (data.categories && data.categories.length > 0 && !newProdCategory) {
          setNewProdCategory(data.categories[0].id)
        }
      }
    } catch (err) {
      console.warn('Error loading catalog data:', err)
    }
  }, [newProdCategory])

  useEffect(() => {
    loadMenu()

    // 1. Real-time broadcast subscription across devices & tabs
    const unsubscribeCatalog = subscribeToCatalogEvents(() => {
      loadMenu()
    })

    // 2. Background polling fallback for distributed multi-terminal sync
    const pollTimer = setInterval(() => {
      loadMenu()
    }, 2500)

    // 3. Supabase Postgres changes subscription
    let channel: any = null
    if (isSupabaseConfigured) {
      channel = supabase
        .channel('menu-realtime-feed')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'products' },
          () => {
            loadMenu()
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'categories' },
          () => {
            loadMenu()
          }
        )
        .subscribe()
    }

    return () => {
      unsubscribeCatalog()
      clearInterval(pollTimer)
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [loadMenu])

  const handleToggleAvailability = async (productId: string) => {
    const target = products.find((p) => p.id === productId)
    if (!target) return

    const nextVal = !target.isAvailable

    // 0ms Optimistic UI update
    setProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, isAvailable: nextVal } : p))
    )

    await toggleProductAvailability(productId, nextVal)
  }

  const handleStartPriceEdit = (product: Product) => {
    setEditingPriceId(product.id)
    setPriceInput(String(Math.round(product.basePricePaisa / 100)))
  }

  const handleSavePrice = async (productId: string) => {
    const num = parseFloat(priceInput)
    if (isNaN(num) || num < 0) {
      setEditingPriceId(null)
      return
    }

    const newPaisa = Math.round(num * 100)

    // 0ms Optimistic UI update
    setProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, basePricePaisa: newPaisa } : p))
    )
    setEditingPriceId(null)

    await updateProductPrice(productId, newPaisa)
  }

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProdName.trim() || !newProdPriceINR.trim()) return

    const pricePaisa = Math.round(parseFloat(newProdPriceINR) * 100)
    const targetCatId = newProdCategory || categories[0]?.id
    const targetBizId = categories[0]?.businessId

    const created = await createCatalogProduct({
      businessId: targetBizId,
      categoryId: targetCatId,
      name: newProdName.trim(),
      description: 'Freshly prepared item',
      basePricePaisa: pricePaisa,
      isVeg: newProdIsVeg,
    })

    setProducts((prev) => [created, ...prev])
    setNewProdName('')
    setNewProdPriceINR('')
    setIsAddModalOpen(false)
  }

  const handleDeleteProduct = async (productId: string) => {
    const target = products.find((p) => p.id === productId)
    if (!target) return

    const confirmed = window.confirm(`Are you sure you want to delete "${target.name}" from the menu?`)
    if (!confirmed) return

    // 0ms Optimistic removal
    setProducts((prev) => prev.filter((p) => p.id !== productId))
    await deleteCatalogProduct(productId)
  }

  const filteredProducts = products.filter((p) => {
    if (searchQuery.trim()) {
      return (
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }
    return true
  })

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#E6E2D8]">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#20201E] tracking-tight">
            Menu Catalog & Pricing
          </h1>
          <p className="text-xs sm:text-sm text-[#575653] mt-0.5">
            Manage product availability, portion variants, and real-time pricing
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            className="gap-1.5 text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add New Product</span>
          </Button>
        </div>
      </div>

      {/* Search and Category Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs font-semibold text-[#575653]">Categories:</span>
          {categories.map((cat) => (
            <span
              key={cat.id}
              className="px-2.5 py-1 rounded-md bg-white border border-[#E6E2D8] text-xs font-medium text-[#20201E] whitespace-nowrap"
            >
              {cat.name} ({products.filter((p) => p.categoryId === cat.id).length})
            </span>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <Input
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Add Product Modal Overlay */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3 border-[#E6E2D8]">
              <h3 className="text-base font-bold text-[#20201E]">Add Menu Item</h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-[#8C8A84] hover:text-[#20201E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-[#575653] mb-1">Item Name</label>
                <Input
                  placeholder="e.g. Special Paneer Bread Pakoda"
                  value={newProdName}
                  onChange={(e) => setNewProdName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-[#575653] mb-1">Category</label>
                <select
                  value={newProdCategory}
                  onChange={(e) => setNewProdCategory(e.target.value)}
                  className="w-full h-9 rounded-md border border-[#E6E2D8] bg-white px-3 text-xs text-[#20201E] focus:outline-none focus:ring-1 focus:ring-[#D95732]"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#575653] mb-1">Price (₹ INR)</label>
                <Input
                  type="number"
                  placeholder="e.g. 35"
                  value={newProdPriceINR}
                  onChange={(e) => setNewProdPriceINR(e.target.value)}
                  required
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="vegCheck"
                  checked={newProdIsVeg}
                  onChange={(e) => setNewProdIsVeg(e.target.checked)}
                  className="accent-[#247A52]"
                />
                <label htmlFor="vegCheck" className="font-semibold text-[#20201E]">
                  Vegetarian Item (Green Label)
                </label>
              </div>

              <div className="pt-3 flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Create Item</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Products Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F8F6F1]/60 text-[#575653] font-semibold border-b border-[#E6E2D8]">
                <tr>
                  <th className="p-3.5 pl-5">Product Name</th>
                  <th className="p-3.5">Category</th>
                  <th className="p-3.5">Base Price</th>
                  <th className="p-3.5">Variants</th>
                  <th className="p-3.5">Add-ons</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2EFE9]">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-[#8C8A84]">
                      No products found. Click &quot;Add Product&quot; to create items for your live menu.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((product) => {
                    const category = categories.find((c) => c.id === product.categoryId)
                    const isEditingThisPrice = editingPriceId === product.id

                    return (
                      <tr key={product.id} className="hover:bg-[#F8F6F1]/50 transition-colors">
                        <td className="p-3.5 pl-5 font-semibold text-[#20201E]">
                          <div className="flex items-center gap-2">
                            <Badge variant={product.isVeg ? 'veg' : 'non-veg'} />
                            <span>{product.name}</span>
                          </div>
                        </td>
                        <td className="p-3.5 text-[#575653]">{category?.name ?? 'General'}</td>
                        <td className="p-3.5 font-mono font-bold text-[#20201E] tabular-nums">
                          {isEditingThisPrice ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs">₹</span>
                              <input
                                type="number"
                                value={priceInput}
                                onChange={(e) => setPriceInput(e.target.value)}
                                className="w-16 h-7 px-1.5 text-xs font-mono font-bold border rounded border-[#D95732]"
                                autoFocus
                              />
                              <button
                                onClick={() => handleSavePrice(product.id)}
                                className="p-1 text-[#247A52] hover:bg-[#EAF4EE] rounded"
                                title="Save Price"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingPriceId(null)}
                                className="p-1 text-[#8C8A84] hover:bg-gray-100 rounded"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 group">
                              <span>{formatPaisaToINR(product.basePricePaisa)}</span>
                              <button
                                onClick={() => handleStartPriceEdit(product)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 text-[#8C8A84] hover:text-[#20201E] transition-opacity cursor-pointer"
                                title="Quick edit price"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="p-3.5 text-[#575653]">
                          {product.variants.length > 0 ? (
                            <span className="font-mono">{product.variants.length} sizes</span>
                          ) : (
                            <span className="text-[#8C8A84]">—</span>
                          )}
                        </td>
                        <td className="p-3.5 text-[#575653]">
                          {product.addons.length > 0 ? (
                            <span className="font-mono">{product.addons.length} extras</span>
                          ) : (
                            <span className="text-[#8C8A84]">—</span>
                          )}
                        </td>
                        <td className="p-3.5">
                          <Badge variant={product.isAvailable ? 'success' : 'danger'} size="sm">
                            {product.isAvailable ? 'In Stock' : 'Sold Out'}
                          </Badge>
                        </td>
                        <td className="p-3.5 pr-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant={product.isAvailable ? 'outline' : 'secondary'}
                              onClick={() => handleToggleAvailability(product.id)}
                              className="text-[11px] h-7 px-2.5"
                            >
                              {product.isAvailable ? 'Mark Sold Out' : 'Restore Stock'}
                            </Button>
                            <button
                              onClick={() => handleDeleteProduct(product.id)}
                              className="p-1.5 text-[#8C8A84] hover:text-[#C0352A] hover:bg-[#FDEEED] rounded transition-colors"
                              title="Delete Item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
