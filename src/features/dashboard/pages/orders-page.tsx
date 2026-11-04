import React, { useState, useEffect, useCallback } from 'react'
import { CheckCircle2, Banknote, RefreshCw, Printer, Receipt, MessageCircle, FileSpreadsheet } from 'lucide-react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs } from '@/components/ui/tabs'
import { formatPaisaToINR } from '@/lib/currency'
import { getElapsedMinutes } from '@/lib/utils'
import { BENCHMARK_ORDERS } from '@/lib/mock-data/benchmark-orders'
import { collectCashForOrder, getMerchantOrders, updateOrderStatus } from '@/services/order.service'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { subscribeToOrderEvents } from '@/services/realtime.service'
import { printKOT, printCustomerReceipt } from '@/services/print.service'
import { sendWhatsAppNotification } from '@/services/notification.service'
import { EodReportModal } from '../components/eod-report-modal'
import type { Order, OrderStatus } from '@/types/order'

export const OrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>(isSupabaseConfigured ? [] : BENCHMARK_ORDERS)
  const [activeTab, setActiveTab] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isEodModalOpen, setIsEodModalOpen] = useState(false)

  const loadOrders = useCallback(async () => {
    try {
      const fetched = await getMerchantOrders()
      if (fetched) {
        setOrders(fetched)
      }
    } catch (err) {
      console.warn('Error loading merchant orders:', err)
    }
  }, [])

  useEffect(() => {
    loadOrders()

    const unsubscribe = subscribeToOrderEvents(() => {
      loadOrders()
    })

    const pollTimer = setInterval(() => {
      loadOrders()
    }, 2500)

    let pgChannel: any = null
    if (isSupabaseConfigured) {
      pgChannel = supabase
        .channel('merchant-orders-feed')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
          loadOrders()
        })
        .subscribe()
    }

    return () => {
      unsubscribe()
      clearInterval(pollTimer)
      if (pgChannel) {
        supabase.removeChannel(pgChannel)
      }
    }
  }, [loadOrders])

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    await loadOrders()
    setIsRefreshing(false)
  }

  const handleMarkCashCollected = async (orderId: string) => {
    setActionLoading(orderId)
    // 0ms instant optimistic update
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? { ...o, paymentStatus: 'PAID', status: 'PREPARING', updatedAt: new Date().toISOString() }
          : o
      )
    )
    try {
      const updated = await collectCashForOrder(orderId)
      if (updated) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)))
      }
    } catch (err) {
      console.warn('Error collecting cash:', err)
      await loadOrders()
    } finally {
      setActionLoading(null)
    }
  }

  const handleUpdateStatus = async (orderId: string, nextStatus: OrderStatus) => {
    setActionLoading(orderId)
    // 0ms instant optimistic update
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, status: nextStatus, updatedAt: new Date().toISOString() } : o
      )
    )
    try {
      const updated = await updateOrderStatus(orderId, nextStatus)
      if (updated) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)))
      }
    } catch (err) {
      console.warn('Error updating status:', err)
      await loadOrders()
    } finally {
      setActionLoading(null)
    }
  }

  const filterTabs = [
    { id: 'ALL', label: 'All Orders', count: orders.length },
    { id: 'PLACED', label: 'New', count: orders.filter((o) => o.status === 'PLACED').length },
    {
      id: 'PREPARING',
      label: 'Preparing',
      count: orders.filter((o) => o.status === 'PREPARING').length,
    },
    { id: 'READY', label: 'Ready for Pickup', count: orders.filter((o) => o.status === 'READY').length },
    { id: 'COMPLETED', label: 'Handed Over', count: orders.filter((o) => o.status === 'COMPLETED').length },
  ]

  const filteredOrders = orders.filter((order) => {
    if (activeTab !== 'ALL' && order.status !== activeTab) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return (
        order.orderNumber.toLowerCase().includes(q) ||
        order.customerName.toLowerCase().includes(q) ||
        (order.pickupToken?.tokenDisplay.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#20201E] tracking-tight">
            Order Management Console
          </h1>
          <p className="text-xs sm:text-sm text-[#575653] mt-0.5">
            Process live counter orders, verify cash payments, and track tokens
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            size="sm"
            onClick={() => setIsEodModalOpen(true)}
            className="gap-1.5 text-xs font-bold bg-[#247A52] hover:bg-[#1D6343] text-white shadow-xs"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>EOD Z-Report</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            isLoading={isRefreshing}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Feed</span>
          </Button>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Tabs tabs={filterTabs} activeTab={activeTab} onChange={setActiveTab} />

        <div className="w-full sm:w-64">
          <Input
            placeholder="Search token, name, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Orders Grid / Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredOrders.length === 0 ? (
          <div className="col-span-full py-12 text-center text-xs text-[#8C8A84] border border-dashed border-[#E6E2D8] rounded-xl bg-white">
            No orders found matching the filter criteria.
          </div>
        ) : (
          filteredOrders.map((order) => {
            const elapsed = getElapsedMinutes(order.createdAt)
            const isCashPending = order.paymentStatus === 'UNPAID' && order.paymentMethod === 'CASH_COUNTER'

            return (
              <Card key={order.id} className="border border-[#E6E2D8] hover:border-[#D95732]/30 transition-all flex flex-col justify-between">
                <CardHeader className="p-4 pb-2 border-b border-[#F2EFE9]">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-2xl font-mono font-extrabold text-[#D95732]">
                        #{order.pickupToken?.tokenDisplay ?? '---'}
                      </span>
                      <p className="text-[11px] text-[#575653] font-mono mt-0.5">
                        {order.orderNumber}
                      </p>
                    </div>

                    <div className="text-right">
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
                      <span className="text-[10px] text-[#8C8A84] block mt-1 font-mono">
                        {elapsed}m ago
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 text-xs">
                    <p className="font-semibold text-[#20201E]">{order.customerName}</p>
                    <p className="text-[#8C8A84] text-[11px]">{order.customerPhone}</p>
                  </div>
                </CardHeader>

                <CardContent className="p-4 py-3 flex-1 space-y-2">
                  <div className="space-y-1.5">
                    {order.items.map((item) => (
                      <div key={item.id} className="text-xs flex justify-between">
                        <span className="text-[#20201E]">
                          <strong className="font-mono text-[#D95732]">{item.quantity}x</strong>{' '}
                          {item.itemNameSnapshot}
                          {item.variantNameSnapshot && (
                            <span className="text-[11px] text-[#8C8A84] block ml-4">
                              {item.variantNameSnapshot}
                            </span>
                          )}
                        </span>
                        <span className="font-mono font-semibold text-[#20201E] tabular-nums">
                          {formatPaisaToINR(item.lineTotalPaisa)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-[#F2EFE9] flex items-center justify-between text-xs">
                    <span className="text-[#575653]">Payment:</span>
                    <Badge
                      variant={order.paymentStatus === 'PAID' ? 'success' : 'warning'}
                      size="sm"
                    >
                      {order.paymentStatus === 'PAID'
                        ? 'Paid Online'
                        : `Collect ${formatPaisaToINR(order.totalPaisa)} Cash`}
                    </Badge>
                  </div>
                </CardContent>

                {/* Card Actions */}
                <div className="p-4 pt-2 border-t border-[#F2EFE9] space-y-2">
                  {isCashPending && (
                    <Button
                      size="sm"
                      onClick={() => handleMarkCashCollected(order.id)}
                      isLoading={actionLoading === order.id}
                      className="w-full bg-[#247A52] hover:bg-[#1D6343] text-white text-xs font-bold gap-1.5"
                    >
                      <Banknote className="w-3.5 h-3.5" />
                      <span>Collect Cash & Send to Kitchen</span>
                    </Button>
                  )}

                  {order.status === 'PREPARING' && (
                    <Button
                      size="sm"
                      onClick={() => handleUpdateStatus(order.id, 'READY')}
                      className="w-full bg-[#D95732] hover:bg-[#C24B29] text-white text-xs font-bold gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Mark Ready for Pickup</span>
                    </Button>
                  )}

                  {order.status === 'READY' && (
                    <Button
                      size="sm"
                      onClick={() => handleUpdateStatus(order.id, 'COMPLETED')}
                      isLoading={actionLoading === order.id}
                      className="w-full bg-[#247A52] hover:bg-[#1D6343] text-white text-xs font-bold gap-1.5 shadow-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Complete & Handover</span>
                    </Button>
                  )}

                  {order.status === 'COMPLETED' && (
                    <div className="py-1.5 px-3 rounded-lg bg-[#EAF4EE] text-center text-xs font-bold text-[#247A52] flex items-center justify-center gap-1.5 border border-[#247A52]/20">
                      <CheckCircle2 className="w-4 h-4 text-[#247A52]" />
                      <span>Order Handed Over</span>
                    </div>
                  )}

                  {/* Print & Notification Quick Actions */}
                  <div className="pt-2 border-t border-[#F2EFE9] flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => printCustomerReceipt(order)}
                      className="flex-1 py-1 px-2 rounded-md bg-[#F8F6F1] hover:bg-[#EAE6DE] text-[#20201E] font-medium border border-[#E6E2D8] flex items-center justify-center gap-1 transition-colors"
                      title="Print Customer Bill Receipt (58mm / 80mm)"
                    >
                      <Receipt className="w-3.5 h-3.5 text-[#D95732]" />
                      <span>Bill</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => printKOT(order)}
                      className="flex-1 py-1 px-2 rounded-md bg-[#F8F6F1] hover:bg-[#EAE6DE] text-[#20201E] font-medium border border-[#E6E2D8] flex items-center justify-center gap-1 transition-colors"
                      title="Print Kitchen Order Ticket (KOT)"
                    >
                      <Printer className="w-3.5 h-3.5 text-[#575653]" />
                      <span>KOT</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => sendWhatsAppNotification(order)}
                      className="py-1 px-2.5 rounded-md bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#128C7E] font-medium border border-[#25D366]/30 flex items-center justify-center gap-1 transition-colors"
                      title="Send WhatsApp Pickup Alert"
                    >
                      <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />
                      <span>WhatsApp</span>
                    </button>
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>

      {/* EOD Z-Report Modal */}
      <EodReportModal
        isOpen={isEodModalOpen}
        onClose={() => setIsEodModalOpen(false)}
        orders={orders}
      />
    </div>
  )
}
