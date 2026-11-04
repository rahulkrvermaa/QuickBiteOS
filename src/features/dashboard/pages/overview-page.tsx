import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp,
  ShoppingBag,
  Clock,
  ArrowRight,
  ExternalLink,
  ChefHat,
  Banknote,
  FileSpreadsheet,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPaisaToINR } from '@/lib/currency'
import { formatTimeIST } from '@/lib/utils'
import { BENCHMARK_ORDERS } from '@/lib/mock-data/benchmark-orders'
import { BENCHMARK_BUSINESS } from '@/lib/mock-data/benchmark-shop'
import { getMerchantOrders } from '@/services/order.service'
import { getActiveBusiness } from '@/services/catalog.service'
import { isSupabaseConfigured } from '@/lib/supabase'
import { subscribeToOrderEvents } from '@/services/realtime.service'
import { EodReportModal } from '../components/eod-report-modal'
import type { Order } from '@/types/order'
import type { Business } from '@/types/domain'

export const OverviewPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>(isSupabaseConfigured ? [] : BENCHMARK_ORDERS)
  const [business, setBusiness] = useState<Business | null>(null)
  const [isEodModalOpen, setIsEodModalOpen] = useState(false)

  const loadOrders = useCallback(async () => {
    try {
      const fetched = await getMerchantOrders()
      if (fetched) {
        setOrders(fetched)
      }
    } catch (err) {
      console.warn('Error loading overview orders:', err)
    }
  }, [])

  useEffect(() => {
    loadOrders()

    // Fetch live business metadata
    getActiveBusiness().then((b) => {
      if (b) setBusiness(b)
    })

    const unsubscribe = subscribeToOrderEvents(() => {
      loadOrders()
    })

    const pollTimer = setInterval(() => {
      loadOrders()
    }, 5000)

    return () => {
      unsubscribe()
      clearInterval(pollTimer)
    }
  }, [loadOrders])

  // Aggregate stats from current orders set
  const paidOrders = orders.filter((o) => o.paymentStatus === 'PAID')
  const totalSalesPaisa = paidOrders.reduce((sum, o) => sum + o.totalPaisa, 0)
  const totalTaxPaisa = paidOrders.reduce((sum, o) => sum + o.taxPaisa, 0)
  const totalOrdersCount = orders.length
  const activeQueueCount = orders.filter(
    (o) => o.status === 'PLACED' || o.status === 'PREPARING'
  ).length
  const averageOrderValuePaisa =
    paidOrders.length > 0 ? Math.round(totalSalesPaisa / paidOrders.length) : 0

  const onlinePaidCount = paidOrders.filter((o) => o.paymentMethod !== 'CASH_COUNTER').length
  const cashPaidCount = paidOrders.filter((o) => o.paymentMethod === 'CASH_COUNTER').length

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#E6E2D8]">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#20201E] tracking-tight">
            Shop Operations Overview
          </h1>
          <p className="text-xs sm:text-sm text-[#575653] mt-0.5">
            Real-time queue and performance for <strong>{business?.name || (isSupabaseConfigured ? 'Your Store' : BENCHMARK_BUSINESS.name)}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setIsEodModalOpen(true)}
            className="gap-1.5 text-xs font-bold bg-[#247A52] hover:bg-[#1D6343] text-white shadow-xs"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>EOD Z-Report</span>
          </Button>

          <Link to="/kitchen">
            <Button size="sm" variant="secondary" className="gap-1.5 text-xs font-semibold">
              <ChefHat className="w-3.5 h-3.5 text-[#D95732]" />
              <span>Open Kitchen KDS</span>
            </Button>
          </Link>
          <Link to={`/shop/${business?.slug || 'samosa-corner'}`} target="_blank">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs font-semibold">
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Customer QR Link</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <Card className="border border-[#E6E2D8]">
          <CardHeader className="p-4 pb-1">
            <p className="text-xs font-semibold text-[#575653] uppercase tracking-wider flex items-center justify-between">
              <span>Today's Sales</span>
              <TrendingUp className="w-4 h-4 text-[#247A52]" />
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-extrabold text-[#20201E] tabular-nums font-mono">
              {formatPaisaToINR(totalSalesPaisa)}
            </div>
            <p className="text-[11px] text-[#247A52] font-medium mt-1">
              {onlinePaidCount} online • {cashPaidCount} cash paid
            </p>
          </CardContent>
        </Card>

        {/* Metric 2 */}
        <Card className="border border-[#E6E2D8]">
          <CardHeader className="p-4 pb-1">
            <p className="text-xs font-semibold text-[#575653] uppercase tracking-wider flex items-center justify-between">
              <span>Total Orders</span>
              <ShoppingBag className="w-4 h-4 text-[#D95732]" />
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-extrabold text-[#20201E] tabular-nums font-mono">
              {totalOrdersCount}
            </div>
            <p className="text-[11px] text-[#575653] font-medium mt-1">Today's volume</p>
          </CardContent>
        </Card>

        {/* Metric 3 */}
        <Card className="border border-[#E6E2D8]">
          <CardHeader className="p-4 pb-1">
            <p className="text-xs font-semibold text-[#575653] uppercase tracking-wider flex items-center justify-between">
              <span>Active Queue</span>
              <Clock className="w-4 h-4 text-[#B8741A]" />
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-extrabold text-[#B8741A] tabular-nums font-mono">
              {activeQueueCount}
            </div>
            <p className="text-[11px] text-[#8C8A84] font-medium mt-1">Cooking or awaiting pickup</p>
          </CardContent>
        </Card>

        {/* Metric 4 */}
        <Card className="border border-[#E6E2D8]">
          <CardHeader className="p-4 pb-1">
            <p className="text-xs font-semibold text-[#575653] uppercase tracking-wider flex items-center justify-between">
              <span>Avg Order Value</span>
              <Banknote className="w-4 h-4 text-[#2B6CB0]" />
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-extrabold text-[#20201E] tabular-nums font-mono">
              {formatPaisaToINR(averageOrderValuePaisa)}
            </div>
            <p className="text-[11px] text-[#575653] font-medium mt-1">
              GST: {formatPaisaToINR(totalTaxPaisa)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Live Order Queue Preview Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-[#F2EFE9]">
          <div>
            <CardTitle>Live Order Queue</CardTitle>
            <p className="text-xs text-[#575653] mt-0.5">
              Active tokens currently circulating in kitchen and counter
            </p>
          </div>

          <Link to="/dashboard/orders">
            <Button variant="ghost" size="sm" className="text-xs font-semibold gap-1">
              <span>View All Orders</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F8F6F1]/60 text-[#575653] font-semibold border-b border-[#E6E2D8]">
                <tr>
                  <th className="p-3.5 pl-5">Token</th>
                  <th className="p-3.5">Order ID</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5">Items Snapshot</th>
                  <th className="p-3.5">Payment</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Time</th>
                  <th className="p-3.5 pr-5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2EFE9]">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-[#8C8A84]">
                      No active orders in the queue. New tickets will appear here in real-time.
                    </td>
                  </tr>
                ) : (
                  orders.slice(0, 10).map((order) => (
                    <tr key={order.id} className="hover:bg-[#F8F6F1]/50 transition-colors">
                      <td className="p-3.5 pl-5 font-mono font-bold text-sm text-[#D95732]">
                        #{order.pickupToken?.tokenDisplay}
                      </td>
                      <td className="p-3.5 font-mono text-[#575653]">{order.orderNumber}</td>
                      <td className="p-3.5 font-medium text-[#20201E]">{order.customerName}</td>
                      <td className="p-3.5 max-w-xs truncate text-[#575653]">
                        {order.items.map((i) => `${i.quantity}x ${i.itemNameSnapshot}`).join(', ')}
                      </td>
                      <td className="p-3.5">
                        <Badge
                          variant={order.paymentStatus === 'PAID' ? 'success' : 'warning'}
                          size="sm"
                        >
                          {order.paymentStatus === 'PAID' ? 'Paid Online' : 'Cash Pending'}
                        </Badge>
                      </td>
                      <td className="p-3.5">
                        <Badge
                          variant={
                            order.status === 'READY' || order.status === 'COMPLETED'
                              ? 'success'
                              : order.status === 'PREPARING'
                              ? 'warning'
                              : 'info'
                          }
                          size="sm"
                        >
                          {order.status === 'COMPLETED' ? 'HANDED OVER' : order.status}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-[#8C8A84] font-mono">
                        {formatTimeIST(order.createdAt)}
                      </td>
                      <td className="p-3.5 pr-5 text-right font-mono font-bold text-[#20201E]">
                        {formatPaisaToINR(order.totalPaisa)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* EOD Z-Report Modal */}
      <EodReportModal
        isOpen={isEodModalOpen}
        onClose={() => setIsEodModalOpen(false)}
        orders={orders}
        shopName={business?.name}
      />
    </div>
  )
}
