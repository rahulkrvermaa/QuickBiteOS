import React, { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  UtensilsCrossed,
  ChefHat,
  ShoppingBag,
  ExternalLink,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  UserCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getActiveBusiness } from '@/services/catalog.service'
import { useAuth } from '@/features/auth/auth-context'
import type { Business } from '@/types/domain'

export interface MerchantLayoutProps {
  children: React.ReactNode
}

export const MerchantLayout: React.FC<MerchantLayoutProps> = ({ children }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, userRole, signOut } = useAuth()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [activeBiz, setActiveBiz] = useState<Business | null>(null)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    getActiveBusiness().then((b) => {
      if (b) setActiveBiz(b)
    })
  }, [])

  const navItems = [
    { label: 'Overview', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Live Orders', path: '/dashboard/orders', icon: ShoppingBag },
    { label: 'Menu & Prices', path: '/dashboard/menu', icon: UtensilsCrossed },
    { label: 'Kitchen KDS', path: '/kitchen', icon: ChefHat, badge: 'Live' },
    { label: 'Platform Admin', path: '/platform-admin', icon: ShieldCheck },
  ]

  return (
    <div className="min-h-screen bg-[#F8F6F1] flex flex-col md:flex-row">
      {/* Mobile Top Header */}
      <header className="md:hidden bg-white border-b border-[#E6E2D8] px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#D95732] text-white flex items-center justify-center font-bold text-sm">
            🥟
          </span>
          <span className="font-bold text-sm text-[#20201E]">QuickBite OS</span>
        </div>

        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-1.5 rounded-lg text-[#575653] hover:bg-[#F2EFE9]"
        >
          {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {/* Mobile Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 md:hidden transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar for Desktop & Mobile Overlay */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#E6E2D8] flex flex-col transition-transform md:translate-x-0 md:static',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand Banner */}
        <div className="p-5 border-b border-[#F2EFE9] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#D95732] text-white flex items-center justify-center font-extrabold text-base shadow-xs">
              🥟
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-[#20201E] tracking-tight">QuickBite OS</h2>
              <p className="text-[11px] text-[#8C8A84] font-medium">SaaS Shop Manager</p>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden text-[#8C8A84] hover:text-[#20201E]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Active Shop Pill */}
        <div className="p-3 mx-4 my-3 rounded-xl bg-[#F8F6F1] border border-[#E6E2D8]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-[#20201E]">{activeBiz?.name || 'Samosa Corner'}</p>
              <p className="text-[10px] text-[#575653]">
                {activeBiz?.address ? `${activeBiz.address}, ${activeBiz.city}` : 'Live Merchant Store'}
              </p>
            </div>
            <span className="w-2 h-2 rounded-full bg-[#247A52]" title="Store Active" />
          </div>
          <div className="mt-2 pt-2 border-t border-[#E6E2D8]/60 flex items-center justify-between text-[11px]">
            <Link
              to={`/shop/${activeBiz?.slug || 'samosa-corner'}`}
              target="_blank"
              className="text-[#D95732] hover:underline flex items-center gap-1 font-semibold"
            >
              <span>View Customer App</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="p-3 space-y-1 flex-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            const Icon = item.icon
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={cn(
                  'flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors',
                  isActive
                    ? 'bg-[#FDF1ED] text-[#D95732]'
                    : 'text-[#575653] hover:text-[#20201E] hover:bg-[#F8F6F1]'
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={cn('w-4 h-4', isActive ? 'text-[#D95732]' : 'text-[#8C8A84]')} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[#247A52] text-white">
                    {item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Staff User Profile & Sign Out */}
        <div className="p-3 mx-4 mb-2 rounded-xl bg-neutral-50 border border-neutral-200/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-[#D95732]/10 text-[#D95732] flex items-center justify-center shrink-0">
                <UserCheck className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#20201E] truncate">
                  {user?.email?.split('@')[0] || 'Staff Member'}
                </p>
                <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
                  {userRole || 'Authenticated'}
                </p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign Out"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Store Live Operations Footer */}
        <div className="p-4 border-t border-[#F2EFE9] text-[11px] text-[#8C8A84] space-y-1">
          <div className="flex items-center justify-between">
            <span>Store Status</span>
            <span className="font-semibold text-[#247A52] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#247A52]" />
              Live & Open
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>QuickBite Engine</span>
            <span className="font-semibold text-[#20201E]">Production</span>
          </div>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">{children}</main>
    </div>
  )
}
