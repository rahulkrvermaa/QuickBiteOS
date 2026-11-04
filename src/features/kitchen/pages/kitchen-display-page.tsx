import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  CheckCircle2,
  Volume2,
  VolumeX,
  ArrowRight,
  LayoutDashboard,
  RefreshCw,
  Printer,
  MessageCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatTimeIST, getElapsedMinutes } from '@/lib/utils'
import { BENCHMARK_ORDERS } from '@/lib/mock-data/benchmark-orders'
import { getMerchantOrders, updateOrderStatus } from '@/services/order.service'
import { getActiveBusiness } from '@/services/catalog.service'
import { isSupabaseConfigured } from '@/lib/supabase'
import { playKitchenAlertChime } from '@/lib/sound'
import { subscribeToOrderEvents } from '@/services/realtime.service'
import { printKOT } from '@/services/print.service'
import { sendWhatsAppNotification } from '@/services/notification.service'
import type { Order, OrderStatus } from '@/types/order'

export const KitchenDisplayPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>(isSupabaseConfigured ? [] : BENCHMARK_ORDERS)
  const [shopName, setShopName] = useState<string>('Kitchen KDS')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const previousOrderCountRef = useRef(orders.length)

  const loadOrders = useCallback(async (isPushAlert = false) => {
    try {
      const fetched = await getMerchantOrders()
      if (fetched) {
        setOrders(fetched)
        if (isPushAlert && fetched.length > previousOrderCountRef.current && soundEnabled) {
          playKitchenAlertChime()
        }
        previousOrderCountRef.current = fetched.length
      }
    } catch (err) {
      console.warn('Error loading KDS orders:', err)
    }
  }, [soundEnabled])

  useEffect(() => {
    // 1. Initial orders load
    loadOrders(false)

    // 2. Load dynamic shop name
    getActiveBusiness().then((b) => {
      if (b?.name) setShopName(b.name)
    })

    // 3. Instant Realtime Subscription (WebSockets across devices + local broadcast & storage sync)
    const unsubscribe = subscribeToOrderEvents((event) => {
      loadOrders(true)
      if (event.eventType === 'ORDER_PLACED' || event.eventType === 'ORDER_PAID') {
        if (soundEnabled) {
          playKitchenAlertChime()
        }
      }
    })

    // 4. Polling fallback: automatically check queue every 3.5 seconds so tickets appear even if network hiccups
    const pollTimer = setInterval(() => {
      loadOrders(false)
    }, 3500)

    return () => {
      unsubscribe()
      clearInterval(pollTimer)
    }
  }, [loadOrders, soundEnabled])

  const handleStatusTransition = async (orderId: string, nextStatus: OrderStatus) => {
    // Optimistic UI update
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus, updatedAt: new Date().toISOString() } : o))
    )

    try {
      await updateOrderStatus(orderId, nextStatus)
    } catch (err) {
      console.warn('Failed to update status on server:', err)
    }
  }

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    await loadOrders(false)
    setIsRefreshing(false)
  }

  const placedOrders = orders.filter((o) => o.status === 'PLACED')
  const preparingOrders = orders.filter((o) => o.status === 'PREPARING' || o.status === 'ACCEPTED')
  const readyOrders = orders.filter((o) => o.status === 'READY')
  const activeTicketsCount = placedOrders.length + preparingOrders.length + readyOrders.length

  return (
    <div className="min-h-screen bg-[#20201E] text-white flex flex-col">
      {/* Top KDS Header */}
      <header className="bg-[#2A2926] border-b border-[#3E3C38] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#D95732] flex items-center justify-center font-bold text-white text-base">
            🥟
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              <span>{shopName}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#3E3C38] text-[#E6E2D8] font-mono">
                Kitchen KDS
              </span>
            </h1>
            <p className="text-[11px] text-[#8C8A84]">
              {activeTicketsCount} active tickets in queue • Station: Main Fryer & Counter
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleManualRefresh}
            className="p-2 rounded-lg bg-[#3E3C38] hover:bg-[#4E4B46] text-[#E6E2D8] transition-colors"
            title="Refresh active tickets"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => {
              setSoundEnabled(!soundEnabled)
              if (!soundEnabled) playKitchenAlertChime()
            }}
            className="p-2 rounded-lg bg-[#3E3C38] hover:bg-[#4E4B46] text-[#E6E2D8] transition-colors"
            title={soundEnabled ? 'Mute audio alerts' : 'Enable audio alerts'}
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-[#247A52]" />
            ) : (
              <VolumeX className="w-4 h-4 text-[#8C8A84]" />
            )}
          </button>

          <Link
            to="/dashboard"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3E3C38] hover:bg-[#4E4B46] text-xs font-semibold text-white transition-colors"
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-[#D95732]" />
            <span>Merchant Portal</span>
          </Link>
        </div>
      </header>

      {/* 3-Column Kanban Board */}
      <main className="flex-1 p-4 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-x-auto">
        {/* Column 1: New / Placed */}
        <div className="bg-[#2A2926] rounded-xl border border-[#3E3C38] flex flex-col h-full">
          <div className="p-3 border-b border-[#3E3C38] flex items-center justify-between bg-[#33312E] rounded-t-xl">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#B8741A]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#E6E2D8]">
                New Orders
              </h2>
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-[#3E3C38] text-white">
              {placedOrders.length}
            </span>
          </div>

          <div className="p-3 space-y-3 flex-1 overflow-y-auto">
            {placedOrders.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-[#8C8A84]">
                No new tickets
              </div>
            ) : (
              placedOrders.map((order) => {
                const elapsed = getElapsedMinutes(order.createdAt)
                return (
                  <div
                    key={order.id}
                    className="bg-[#20201E] rounded-xl border-2 border-[#B8741A] p-4 space-y-3 shadow-md"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-3xl font-extrabold text-[#B8741A] font-mono tabular-nums tracking-tight">
                          #{order.pickupToken?.tokenDisplay}
                        </span>
                        <p className="text-[11px] text-[#8C8A84] mt-0.5">
                          {order.customerName} • {order.paymentMethod === 'CASH_COUNTER' ? '💵 Cash Pending' : '✅ Online Paid'}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-xs font-mono text-[#E6E2D8] flex items-center gap-1 justify-end">
                          <Clock className="w-3 h-3 text-[#B8741A]" />
                          {elapsed}m ago
                        </span>
                        <span className="text-[10px] text-[#8C8A84] font-mono">
                          {formatTimeIST(order.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* Order Items */}
                    <div className="border-t border-[#3E3C38] pt-2 space-y-2">
                      {order.items.map((item) => (
                        <div key={item.id} className="text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-[#D95732] font-mono text-base">
                              {item.quantity}x
                            </span>
                            <span className="font-bold text-white">{item.itemNameSnapshot}</span>
                          </div>
                          {item.variantNameSnapshot && (
                            <p className="text-xs text-[#E6E2D8] ml-6">{item.variantNameSnapshot}</p>
                          )}
                          {item.addonsSnapshot.length > 0 && (
                            <p className="text-xs text-[#B8741A] ml-6 font-medium">
                              ★ {item.addonsSnapshot.map((a) => a.name).join(', ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => handleStatusTransition(order.id, 'PREPARING')}
                        className="flex-1 bg-[#B8741A] hover:bg-[#A36414] text-white font-bold text-sm py-2"
                      >
                        <span>Start Preparing</span>
                        <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                      <button
                        type="button"
                        onClick={() => printKOT(order, { shopName })}
                        className="p-2 rounded-lg bg-[#33312E] hover:bg-[#45423E] text-[#E6E2D8] border border-[#3E3C38] transition-colors"
                        title="Print KOT Thermal Ticket"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Column 2: Preparing */}
        <div className="bg-[#2A2926] rounded-xl border border-[#3E3C38] flex flex-col h-full">
          <div className="p-3 border-b border-[#3E3C38] flex items-center justify-between bg-[#33312E] rounded-t-xl">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#D95732]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#E6E2D8]">
                In Preparation
              </h2>
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-[#3E3C38] text-white">
              {preparingOrders.length}
            </span>
          </div>

          <div className="p-3 space-y-3 flex-1 overflow-y-auto">
            {preparingOrders.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-[#8C8A84]">
                No orders currently cooking
              </div>
            ) : (
              preparingOrders.map((order) => {
                const elapsed = getElapsedMinutes(order.createdAt)
                const isOverdue = elapsed > 10

                return (
                  <div
                    key={order.id}
                    className={`bg-[#20201E] rounded-xl border-2 p-4 space-y-3 shadow-md ${
                      isOverdue ? 'border-[#C0352A]' : 'border-[#D95732]'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-3xl font-extrabold text-[#D95732] font-mono tabular-nums tracking-tight">
                          #{order.pickupToken?.tokenDisplay}
                        </span>
                        <p className="text-[11px] text-[#8C8A84] mt-0.5">
                          {order.customerName}
                        </p>
                      </div>

                      <div className="text-right">
                        <span
                          className={`text-xs font-mono font-bold flex items-center gap-1 justify-end ${
                            isOverdue ? 'text-[#C0352A]' : 'text-[#D95732]'
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          {elapsed}m cooking
                        </span>
                        {isOverdue && (
                          <span className="text-[10px] text-[#C0352A] font-bold uppercase tracking-wider block">
                            Rush Priority
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Order Items */}
                    <div className="border-t border-[#3E3C38] pt-2 space-y-2">
                      {order.items.map((item) => (
                        <div key={item.id} className="text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-[#D95732] font-mono text-base">
                              {item.quantity}x
                            </span>
                            <span className="font-bold text-white">{item.itemNameSnapshot}</span>
                          </div>
                          {item.variantNameSnapshot && (
                            <p className="text-xs text-[#E6E2D8] ml-6">{item.variantNameSnapshot}</p>
                          )}
                          {item.addonsSnapshot.length > 0 && (
                            <p className="text-xs text-[#D95732] ml-6 font-semibold">
                              ★ {item.addonsSnapshot.map((a) => a.name).join(', ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => handleStatusTransition(order.id, 'READY')}
                        className="flex-1 bg-[#247A52] hover:bg-[#1D6343] text-white font-bold text-xs py-2.5 flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Mark Ready</span>
                      </Button>
                      <button
                        type="button"
                        onClick={() => sendWhatsAppNotification(order, { shopName })}
                        className="p-2.5 rounded-lg bg-[#25D366]/20 hover:bg-[#25D366]/30 text-[#25D366] border border-[#25D366]/40 transition-colors"
                        title="Send WhatsApp Notification"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => printKOT(order, { shopName })}
                        className="p-2.5 rounded-lg bg-[#33312E] hover:bg-[#45423E] text-[#E6E2D8] border border-[#3E3C38] transition-colors"
                        title="Print Ticket"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Column 3: Ready for Pickup */}
        <div className="bg-[#2A2926] rounded-xl border border-[#3E3C38] flex flex-col h-full">
          <div className="p-3 border-b border-[#3E3C38] flex items-center justify-between bg-[#33312E] rounded-t-xl">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#247A52]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#E6E2D8]">
                Ready at Counter
              </h2>
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-[#3E3C38] text-white">
              {readyOrders.length}
            </span>
          </div>

          <div className="p-3 space-y-3 flex-1 overflow-y-auto">
            {readyOrders.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-[#8C8A84]">
                No orders waiting for pickup
              </div>
            ) : (
              readyOrders.map((order) => {
                const elapsed = getElapsedMinutes(order.createdAt)
                return (
                  <div
                    key={order.id}
                    className="bg-[#20201E] rounded-xl border-2 border-[#247A52] p-4 space-y-3 shadow-md"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-3xl font-extrabold text-[#247A52] font-mono tabular-nums tracking-tight">
                          #{order.pickupToken?.tokenDisplay}
                        </span>
                        <p className="text-[11px] text-[#8C8A84] mt-0.5">
                          {order.customerName}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-xs font-mono text-[#247A52] font-bold block">
                          Ready on Tray
                        </span>
                        <span className="text-[10px] text-[#8C8A84] font-mono">
                          Total {elapsed}m
                        </span>
                      </div>
                    </div>

                    <div className="border-t border-[#3E3C38] pt-2 space-y-1 text-xs text-[#E6E2D8]">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex justify-between">
                          <span>
                            {item.quantity}x {item.itemNameSnapshot}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => handleStatusTransition(order.id, 'COMPLETED')}
                        className="flex-1 bg-[#247A52] hover:bg-[#1D6343] text-white font-bold text-xs py-2.5 flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Hand Over & Clear</span>
                      </Button>
                      <button
                        type="button"
                        onClick={() => sendWhatsAppNotification(order, { shopName })}
                        className="p-2.5 rounded-lg bg-[#25D366]/20 hover:bg-[#25D366]/30 text-[#25D366] border border-[#25D366]/40 transition-colors"
                        title="Resend WhatsApp Pickup Ping"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => printKOT(order, { shopName })}
                        className="p-2.5 rounded-lg bg-[#33312E] hover:bg-[#45423E] text-[#E6E2D8] border border-[#3E3C38] transition-colors"
                        title="Print Ticket"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
