import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldAlert,
  ArrowLeft,
  Plus,
  X,
  Building2,
  Trash2,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { broadcastTenantEvent, subscribeToTenantEvents } from '@/services/realtime.service'

function isUuid(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
}

interface TenantRecord {
  id: string
  name: string
  slug: string
  ownerEmail: string
  city: string
  branchesCount: number
  planTier: 'Starter' | 'Growth' | 'Pro'
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL'
  registeredAt: string
}

interface LocalTenantsStore {
  customTenants: TenantRecord[]
  statusOverrides: Record<string, 'ACTIVE' | 'SUSPENDED' | 'TRIAL'>
  tierOverrides: Record<string, 'Starter' | 'Growth' | 'Pro'>
  deletedTenantIds: string[]
}

const TENANTS_STORAGE_KEY = 'quickbite_tenants_store'

function getLocalTenantsStore(): LocalTenantsStore {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { customTenants: [], statusOverrides: {}, tierOverrides: {}, deletedTenantIds: [] }
  }
  try {
    const raw = window.localStorage.getItem(TENANTS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        customTenants: Array.isArray(parsed.customTenants) ? parsed.customTenants : [],
        statusOverrides: parsed.statusOverrides || {},
        tierOverrides: parsed.tierOverrides || {},
        deletedTenantIds: Array.isArray(parsed.deletedTenantIds) ? parsed.deletedTenantIds : [],
      }
    }
  } catch {
    // Ignore
  }
  return { customTenants: [], statusOverrides: {}, tierOverrides: {}, deletedTenantIds: [] }
}

function saveLocalTenantsStore(store: LocalTenantsStore): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(TENANTS_STORAGE_KEY, JSON.stringify(store))
    } catch {
      // Ignore
    }
  }
}

const SAMPLE_TENANTS: TenantRecord[] = [
  {
    id: 'biz_samosa_corner_01',
    name: 'Samosa Corner',
    slug: 'samosa-corner',
    ownerEmail: 'owner@samosacorner.in',
    city: 'Jamui, Bihar',
    branchesCount: 1,
    planTier: 'Starter',
    status: 'ACTIVE',
    registeredAt: '2026-01-15',
  },
  {
    id: 'biz_kolkata_chai_02',
    name: 'Kolkata Chai Junction',
    slug: 'kolkata-chai',
    ownerEmail: 'ops@kolkatachai.com',
    city: 'Kolkata, WB',
    branchesCount: 4,
    planTier: 'Growth',
    status: 'ACTIVE',
    registeredAt: '2026-02-01',
  },
  {
    id: 'biz_bikaneri_sweets_03',
    name: 'Bikaneri Mithai & Chaat',
    slug: 'bikaneri-chaat',
    ownerEmail: 'finance@bikanerichaat.org',
    city: 'Jaipur, RJ',
    branchesCount: 8,
    planTier: 'Pro',
    status: 'TRIAL',
    registeredAt: '2026-02-18',
  },
]

export const AdminTenantsPage: React.FC = () => {
  const [tenants, setTenants] = useState<TenantRecord[]>(SAMPLE_TENANTS)
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newTier, setNewTier] = useState<'Starter' | 'Growth' | 'Pro'>('Starter')

  const loadTenants = useCallback(async () => {
    const store = getLocalTenantsStore()

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('id, name, slug, phone, city, is_active, tier, created_at, branches(count)')
          .order('created_at', { ascending: false })

        if (!error && Array.isArray(data)) {
          const dbTenants: TenantRecord[] = data
            .filter((b: any) => !store.deletedTenantIds.includes(b.id))
            .map((b: any) => {
              const status: 'ACTIVE' | 'SUSPENDED' = store.statusOverrides[b.id]
                ? (store.statusOverrides[b.id] as any)
                : b.is_active
                ? 'ACTIVE'
                : 'SUSPENDED'
              const tier: 'Starter' | 'Growth' | 'Pro' = store.tierOverrides[b.id] || (b.tier as any) || 'Starter'

              return {
                id: b.id,
                name: b.name,
                slug: b.slug,
                ownerEmail: b.phone || 'merchant@quickbite.in',
                city: b.city || 'India',
                branchesCount: b.branches?.[0]?.count ?? 1,
                planTier: tier,
                status,
                registeredAt: b.created_at?.slice(0, 10) || '2026-01-01',
              }
            })

          const dbIds = new Set(dbTenants.map((t) => t.id))
          const localExtras = store.customTenants
            .filter((t) => !store.deletedTenantIds.includes(t.id) && !dbIds.has(t.id))
            .map((t) => ({
              ...t,
              status: store.statusOverrides[t.id] || t.status,
              planTier: store.tierOverrides[t.id] || t.planTier,
            }))

          setTenants([...dbTenants, ...localExtras])
          return
        }
      } catch (err) {
        console.warn('Could not fetch businesses from Supabase:', err)
      }
    }

    // Demo / offline mode
    const baseTenants = SAMPLE_TENANTS
      .filter((t) => !store.deletedTenantIds.includes(t.id))
      .map((t) => ({
        ...t,
        status: store.statusOverrides[t.id] || t.status,
        planTier: store.tierOverrides[t.id] || t.planTier,
      }))

    const localExtras = store.customTenants
      .filter((t) => !store.deletedTenantIds.includes(t.id) && !SAMPLE_TENANTS.some((st) => st.id === t.id))
      .map((t) => ({
        ...t,
        status: store.statusOverrides[t.id] || t.status,
        planTier: store.tierOverrides[t.id] || t.planTier,
      }))

    setTenants([...baseTenants, ...localExtras])
  }, [])

  useEffect(() => {
    loadTenants()

    // 1. Instant cross-tab and cross-device broadcast listener
    const unsubscribeTenant = subscribeToTenantEvents(() => {
      loadTenants()
    })

    // 2. Multi-terminal background sync interval
    const pollInterval = setInterval(() => {
      loadTenants()
    }, 2500)

    // 3. Supabase Postgres changes listener
    let channel: any = null
    if (isSupabaseConfigured) {
      channel = supabase
        .channel('admin-tenants-feed')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'businesses' },
          () => {
            loadTenants()
          }
        )
        .subscribe()
    }

    return () => {
      unsubscribeTenant()
      clearInterval(pollInterval)
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [loadTenants])

  const handleToggleStatus = async (id: string) => {
    const target = tenants.find((t) => t.id === id)
    if (!target) return

    const nextStatus = target.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
    const nextIsActive = nextStatus === 'ACTIVE'

    // 0ms Optimistic UI update
    setTenants((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: nextStatus } : t))
    )

    // Persist in local store
    const store = getLocalTenantsStore()
    store.statusOverrides[id] = nextStatus
    store.customTenants = store.customTenants.map((t) =>
      t.id === id ? { ...t, status: nextStatus } : t
    )
    saveLocalTenantsStore(store)

    // Instant real-time broadcast
    broadcastTenantEvent({
      eventType: 'TENANT_STATUS_TOGGLED',
      tenantId: id,
      isActive: nextIsActive,
    })

    // Database synchronization
    if (isSupabaseConfigured && isUuid(id)) {
      try {
        const { error: rpcErr } = await supabase.rpc('admin_toggle_business_status', {
          p_business_id: id,
          p_is_active: nextIsActive,
        })

        if (rpcErr) {
          const nowIso = new Date().toISOString()
          await supabase
            .from('businesses')
            .update({ is_active: nextIsActive, updated_at: nowIso })
            .eq('id', id)
        }
      } catch (err) {
        console.warn('Failed to update business status on Supabase:', err)
      }
    }
  }

  const handleTierChange = async (id: string, newTierVal: 'Starter' | 'Growth' | 'Pro') => {
    // 0ms Optimistic UI update
    setTenants((prev) =>
      prev.map((t) => (t.id === id ? { ...t, planTier: newTierVal } : t))
    )

    const store = getLocalTenantsStore()
    store.tierOverrides[id] = newTierVal
    store.customTenants = store.customTenants.map((t) =>
      t.id === id ? { ...t, planTier: newTierVal } : t
    )
    saveLocalTenantsStore(store)

    broadcastTenantEvent({
      eventType: 'TENANT_UPDATED',
      tenantId: id,
      tier: newTierVal,
    })

    if (isSupabaseConfigured && isUuid(id)) {
      try {
        const { error: rpcErr } = await supabase.rpc('admin_update_business_tier', {
          p_business_id: id,
          p_tier: newTierVal,
        })

        if (rpcErr) {
          const nowIso = new Date().toISOString()
          await supabase
            .from('businesses')
            .update({ tier: newTierVal, updated_at: nowIso })
            .eq('id', id)
        }
      } catch (err) {
        console.warn('Failed to update business tier on Supabase:', err)
      }
    }
  }

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim() || !newSlug.trim()) return

    const nowIso = new Date().toISOString()
    let createdId = `biz_${newSlug.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}`

    if (isSupabaseConfigured) {
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_create_business', {
          p_name: newName.trim(),
          p_slug: newSlug.trim().toLowerCase(),
          p_phone: newEmail.trim() || '+91 9876543210',
          p_city: newCity.trim() || 'India',
          p_tier: newTier,
        })

        if (!rpcErr && rpcData?.id) {
          createdId = rpcData.id
        }
      } catch (err) {
        console.warn('Supabase business creation error:', err)
      }
    }

    const newTenant: TenantRecord = {
      id: createdId,
      name: newName.trim(),
      slug: newSlug.trim().toLowerCase(),
      ownerEmail: newEmail.trim() || 'contact@quickbite.in',
      city: newCity.trim() || 'Mumbai, MH',
      branchesCount: 1,
      planTier: newTier,
      status: 'ACTIVE',
      registeredAt: nowIso.slice(0, 10),
    }

    const store = getLocalTenantsStore()
    store.customTenants = [newTenant, ...store.customTenants.filter((t) => t.id !== createdId)]
    saveLocalTenantsStore(store)

    broadcastTenantEvent({
      eventType: 'TENANT_CREATED',
      tenant: newTenant,
    })

    setTenants((prev) => [newTenant, ...prev.filter((t) => t.id !== createdId)])
    setNewName('')
    setNewSlug('')
    setNewEmail('')
    setNewCity('')
    setIsModalOpen(false)
  }

  const handleDeleteTenant = async (id: string) => {
    const target = tenants.find((t) => t.id === id)
    if (!target) return

    const confirmed = window.confirm(`Are you sure you want to delete food business "${target.name}"?`)
    if (!confirmed) return

    // 0ms Optimistic removal
    setTenants((prev) => prev.filter((t) => t.id !== id))

    const store = getLocalTenantsStore()
    if (!store.deletedTenantIds.includes(id)) {
      store.deletedTenantIds.push(id)
    }
    store.customTenants = store.customTenants.filter((t) => t.id !== id)
    delete store.statusOverrides[id]
    delete store.tierOverrides[id]
    saveLocalTenantsStore(store)

    broadcastTenantEvent({
      eventType: 'TENANT_DELETED',
      tenantId: id,
    })

    if (isSupabaseConfigured && isUuid(id)) {
      try {
        const { error: rpcErr } = await supabase.rpc('admin_delete_business', {
          p_business_id: id,
        })

        if (rpcErr) {
          await supabase.from('businesses').delete().eq('id', id)
        }
      } catch (err) {
        console.warn('Failed to delete business from Supabase:', err)
      }
    }
  }

  const filteredTenants = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.city.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-[#F8F6F1] py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E6E2D8]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#575653] hover:text-[#20201E]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Merchant Dashboard</span>
              </Link>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#20201E] tracking-tight flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-[#D95732]" />
              <span>QuickBite OS — Platform Super Admin</span>
            </h1>
            <p className="text-xs sm:text-sm text-[#575653] mt-0.5">
              Multi-tenant fleet management, tier quotas, and cross-business isolation monitoring
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setIsModalOpen(true)}
              className="gap-1.5 text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Onboard Food Business</span>
            </Button>
          </div>
        </div>

        {/* Platform Architecture & Decoupled Billing Notice */}
        <div className="p-4 rounded-xl bg-white border border-[#E6E2D8] flex items-start gap-3 text-xs text-[#575653] shadow-sm">
          <Building2 className="w-5 h-5 text-[#247A52] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-[#20201E]">Decoupled Platform Subscription Architecture</p>
            <p className="leading-relaxed">
              QuickBite OS billing is completely isolated from shop customer payments. Food stalls collect their own customer UPI/cash payments directly to their merchant account. Platform tier billing operates via a separate corporate mandate, ensuring uninterrupted service and zero merchant-escrow liabilities.
            </p>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex items-center justify-between gap-4">
          <div className="w-full sm:w-72">
            <Input
              placeholder="Search business name, slug, city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs"
            />
          </div>
          <span className="text-xs text-[#8C8A84] font-medium whitespace-nowrap">
            {filteredTenants.length} of {tenants.length} businesses
          </span>
        </div>

        {/* Add Tenant Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b pb-3 border-[#E6E2D8]">
                <h3 className="text-base font-bold text-[#20201E]">Onboard New Food Business</h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-[#8C8A84] hover:text-[#20201E]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateTenant} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-[#575653] mb-1">Business Name</label>
                  <Input
                    placeholder="e.g. Amritsari Kulcha Hub"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value)
                      if (!newSlug) {
                        setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'))
                      }
                    }}
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#575653] mb-1">URL Slug</label>
                  <div className="flex items-center">
                    <span className="px-2.5 py-2 bg-[#F2EFE9] border border-r-0 border-[#E6E2D8] rounded-l-md text-gray-500 font-mono text-xs">
                      /shop/
                    </span>
                    <Input
                      placeholder="kulcha-hub"
                      value={newSlug}
                      onChange={(e) => setNewSlug(e.target.value)}
                      className="rounded-l-none font-mono"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#575653] mb-1">Owner Contact / Phone</label>
                  <Input
                    placeholder="+91 98765 43210"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#575653] mb-1">City / Region</label>
                  <Input
                    placeholder="e.g. Amritsar, PB"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#575653] mb-1">Platform Plan Tier</label>
                  <select
                    value={newTier}
                    onChange={(e) => setNewTier(e.target.value as any)}
                    className="w-full h-9 rounded-md border border-[#E6E2D8] bg-white px-3 text-xs text-[#20201E] focus:outline-none focus:ring-1 focus:ring-[#D95732]"
                  >
                    <option value="Starter">Starter (Single outlet, basic KDS)</option>
                    <option value="Growth">Growth (Up to 5 outlets, multi-station KDS)</option>
                    <option value="Pro">Pro (Unlimited outlets, enterprise SLA)</option>
                  </select>
                </div>

                <div className="pt-3 flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsModalOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Onboard Tenant</Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tenants Table */}
        <Card>
          <CardHeader className="pb-3 border-b border-[#E6E2D8]">
            <CardTitle className="text-sm font-bold text-[#20201E]">
              Registered Food Businesses & Isolation Status
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#F8F6F1]/60 text-[#575653] font-semibold border-b border-[#E6E2D8]">
                  <tr>
                    <th className="p-3.5 pl-5">Business Name & Slug</th>
                    <th className="p-3.5">Owner Contact</th>
                    <th className="p-3.5">Location</th>
                    <th className="p-3.5">Outlets</th>
                    <th className="p-3.5">Subscription Tier</th>
                    <th className="p-3.5">Tenant Status</th>
                    <th className="p-3.5 pr-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2EFE9]">
                  {filteredTenants.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-[#8C8A84]">
                        No registered businesses found. Click &quot;Onboard Food Business&quot; to register a shop.
                      </td>
                    </tr>
                  ) : (
                    filteredTenants.map((tenant) => (
                      <tr key={tenant.id} className="hover:bg-[#F8F6F1]/50 transition-colors">
                        <td className="p-3.5 pl-5">
                          <p className="font-bold text-[#20201E] text-sm">{tenant.name}</p>
                          <p className="font-mono text-[11px] text-[#D95732]">/{tenant.slug}</p>
                        </td>
                        <td className="p-3.5 text-[#575653]">{tenant.ownerEmail}</td>
                        <td className="p-3.5 text-[#575653]">{tenant.city}</td>
                        <td className="p-3.5 font-mono font-semibold text-[#20201E]">
                          {tenant.branchesCount} {tenant.branchesCount === 1 ? 'branch' : 'branches'}
                        </td>
                        <td className="p-3.5">
                          <select
                            value={tenant.planTier}
                            onChange={(e) => handleTierChange(tenant.id, e.target.value as any)}
                            className="font-semibold text-xs text-[#20201E] bg-[#F2EFE9] px-2 py-1 rounded-md border border-[#E6E2D8] focus:outline-none cursor-pointer"
                          >
                            <option value="Starter">Starter (₹999/mo)</option>
                            <option value="Growth">Growth (₹2,499/mo)</option>
                            <option value="Pro">Pro (₹4,999/mo)</option>
                          </select>
                        </td>
                        <td className="p-3.5">
                          <Badge
                            variant={
                              tenant.status === 'ACTIVE'
                                ? 'success'
                                : tenant.status === 'TRIAL'
                                ? 'info'
                                : 'danger'
                            }
                            size="sm"
                          >
                            {tenant.status}
                          </Badge>
                        </td>
                        <td className="p-3.5 pr-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant={tenant.status === 'ACTIVE' ? 'outline' : 'secondary'}
                              onClick={() => handleToggleStatus(tenant.id)}
                              className="text-[11px] h-7 px-2.5"
                            >
                              {tenant.status === 'ACTIVE' ? 'Suspend Tenant' : 'Activate Tenant'}
                            </Button>
                            <button
                              onClick={() => handleDeleteTenant(tenant.id)}
                              className="p-1.5 text-[#8C8A84] hover:text-[#C0352A] hover:bg-[#FDEEED] rounded transition-colors cursor-pointer"
                              title="Delete Tenant"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
