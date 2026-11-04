import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ShopOrderingPage } from '@/features/customer/pages/shop-ordering-page'
import { OrderTrackingPage } from '@/features/customer/pages/order-tracking-page'
import { KitchenDisplayPage } from '@/features/kitchen/pages/kitchen-display-page'
import { OverviewPage } from '@/features/dashboard/pages/overview-page'
import { OrdersPage } from '@/features/dashboard/pages/orders-page'
import { MenuPage } from '@/features/dashboard/pages/menu-page'
import { AdminTenantsPage } from '@/features/admin/pages/admin-tenants-page'
import { LoginPage } from '@/features/auth/pages/login-page'
import { NotFoundPage } from '@/features/common/pages/not-found-page'
import { ProtectedRoute } from '@/components/layout/protected-route'
import { MerchantLayout } from '@/components/layout/merchant-layout'

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Default route redirects to benchmark shop ordering page */}
      <Route path="/" element={<Navigate to="/shop/samosa-corner" replace />} />

      {/* Staff & Merchant Login Route */}
      <Route path="/login" element={<LoginPage />} />

      {/* Customer Experience Routes (Completely Public for QR Code Scans) */}
      <Route path="/shop/:slug" element={<ShopOrderingPage />} />
      <Route path="/order/:secureAccessToken" element={<OrderTrackingPage />} />

      {/* Merchant Operations Dashboard Routes (Protected by Email & Password) */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <MerchantLayout>
              <OverviewPage />
            </MerchantLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/orders"
        element={
          <ProtectedRoute>
            <MerchantLayout>
              <OrdersPage />
            </MerchantLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/menu"
        element={
          <ProtectedRoute>
            <MerchantLayout>
              <MenuPage />
            </MerchantLayout>
          </ProtectedRoute>
        }
      />

      {/* Dedicated Kitchen Display System Route (Protected) */}
      <Route
        path="/kitchen"
        element={
          <ProtectedRoute>
            <KitchenDisplayPage />
          </ProtectedRoute>
        }
      />

      {/* Platform Administration Route (Protected) */}
      <Route
        path="/platform-admin"
        element={
          <ProtectedRoute>
            <AdminTenantsPage />
          </ProtectedRoute>
        }
      />

      {/* 404 Lost in the Sauce Fallback */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
