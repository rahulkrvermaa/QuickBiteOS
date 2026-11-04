import React, { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  ChefHat,
  Bell,
  ArrowLeft,
  Store,
  AlertCircle,
  CreditCard,
  QrCode,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPaisaToINR } from '@/lib/currency'
import { getOrderBySecureToken } from '@/services/order.service'
import {
  startRazorpayCheckout,
  loadRazorpayScript,
  prefetchRazorpayOrder,
} from '@/services/payment.service'
import { playPickupReadyChime } from '@/lib/sound'
import { subscribeToOrderEvents } from '@/services/realtime.service'

export const OrderTrackingPage: React.FC = () => {
  const { secureAccessToken } = useParams<{ secureAccessToken: string }>()
  const queryClient = useQueryClient()
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [isPaying, setIsPaying] = useState(false)

  const { data: order, isLoading, isError } = useQuery({
    queryKey: ['customer-order', secureAccessToken],
    queryFn: () => getOrderBySecureToken(secureAccessToken || ''),
    enabled: Boolean(secureAccessToken),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  })

  // Persist current active order token for menu screen tracking banner
  React.useEffect(() => {
    if (secureAccessToken && typeof window !== 'undefined') {
      localStorage.setItem('quickbite_active_order_token', secureAccessToken)
    }
  }, [secureAccessToken])

  // Audio chime when order transitions to READY
  const prevStatusRef = React.useRef<string | undefined>(order?.status)
  React.useEffect(() => {
    if (order?.status && prevStatusRef.current && prevStatusRef.current !== 'READY' && order.status === 'READY') {
      playPickupReadyChime()
    }
    prevStatusRef.current = order?.status
  }, [order?.status])

  // Auto-reset isPaying if order status leaves PENDING_PAYMENT
  React.useEffect(() => {
    if (order?.status && order.status !== 'PENDING_PAYMENT') {
      setIsPaying(false)
    }
  }, [order?.status])

  // Pre-load Razorpay SDK script and prefetch the trusted order in background for 0ms checkout response
  React.useEffect(() => {
    if (order && order.status === 'PENDING_PAYMENT' && order.paymentStatus === 'UNPAID') {
      loadRazorpayScript()
      prefetchRazorpayOrder(order.id, order.secureAccessToken).catch(() => {
        // Non-blocking background prefetch; will retry synchronously when user clicks Pay
      })
    }
  }, [order])

  // Real-time instant push subscription across WebSockets, storage, and custom events
  React.useEffect(() => {
    if (!secureAccessToken) return

    const unsubscribe = subscribeToOrderEvents((event) => {
      if (
        !event.orderId ||
        event.orderId === order?.id ||
        event.secureAccessToken === secureAccessToken ||
        event.eventType === 'FORCE_REFRESH'
      ) {
        // 0ms Synchronous optimistic cache update
        queryClient.setQueryData(['customer-order', secureAccessToken], (old: any) => {
          if (!old) return old
          const nextStatus = event.status || old.status
          const nextPaymentStatus =
            event.eventType === 'ORDER_PAID' || event.eventType === 'CASH_COLLECTED'
              ? 'PAID'
              : (event.paymentStatus || old.paymentStatus)

          return {
            ...old,
            status: nextStatus,
            paymentStatus: nextPaymentStatus,
            pickupToken: event.tokenDisplay
              ? {
                  ...(old.pickupToken || {}),
                  tokenDisplay: event.tokenDisplay,
                }
              : old.pickupToken,
            updatedAt: new Date().toISOString(),
          }
        })

        if (event.eventType === 'ORDER_PAID') {
          setIsPaying(false)
          setPaymentError(null)
        }

        queryClient.invalidateQueries({ queryKey: ['customer-order', secureAccessToken] })
        queryClient.refetchQueries({ queryKey: ['customer-order', secureAccessToken] })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [order?.id, secureAccessToken, queryClient])

  const handlePayNow = async () => {
    if (!order) return
    setIsPaying(true)
    setPaymentError(null)

    await startRazorpayCheckout({
      order,
      shopName: 'Samosa Corner',
      onSuccess: (updatedOrder) => {
        setIsPaying(false)
        queryClient.setQueryData(['customer-order', secureAccessToken], updatedOrder)
      },
      onError: (errMsg) => {
        setIsPaying(false)
        setPaymentError(errMsg)
      },
      onDismiss: () => {
        setIsPaying(false)
      },
    })
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8F6F1] py-8 px-4 sm:px-6">
        <div className="max-w-xl mx-auto space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  if (isError || !order) {
    return (
      <div className="min-h-screen bg-[#F8F6F1] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-[#E6E2D8] p-8 max-w-md text-center space-y-4 shadow-sm">
          <div className="w-16 h-16 rounded-full bg-[#FDEEED] text-[#C0352A] flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-[#20201E]">Order Not Found</h2>
          <p className="text-xs text-[#575653]">
            This order link may have expired or is invalid. Only valid order tokens can access live tracking.
          </p>
          <Link to="/shop/samosa-corner">
            <Button className="w-full">Return to Menu</Button>
          </Link>
        </div>
      </div>
    )
  }

  const steps = [
    { key: 'PLACED', label: 'Order Received', desc: 'Sent to kitchen queue' },
    { key: 'PREPARING', label: 'Preparing', desc: 'Frying fresh & assembling' },
    { key: 'READY', label: 'Ready for Pickup', desc: 'Call at pickup counter' },
    { key: 'COMPLETED', label: 'Handed Over', desc: 'Food collected • Enjoy your meal!' },
  ]

  const getStepIndex = (status: string) => {
    switch (status) {
      case 'PLACED':
        return 0
      case 'ACCEPTED':
      case 'PREPARING':
        return 1
      case 'READY':
        return 2
      case 'COMPLETED':
        return 3
      default:
        return 0
    }
  }

  const currentStep = getStepIndex(order.status)
  const isOnlinePending = order.status === 'PENDING_PAYMENT' && order.paymentStatus === 'UNPAID'
  const isReady = order.status === 'READY'
  const isCompleted = order.status === 'COMPLETED'

  return (
    <div className="min-h-screen bg-[#F8F6F1] py-6 px-4 sm:px-6">
      <div className="max-w-xl mx-auto space-y-5">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between">
          <Link
            to="/shop/samosa-corner"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#575653] hover:text-[#20201E]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Menu</span>
          </Link>

          <span className="text-xs text-[#8C8A84] font-mono tabular-nums">
            Ref: {order.orderNumber}
          </span>
        </div>

        {paymentError && (
          <div className="p-3 rounded-xl bg-[#FDEEED] border border-[#F5C5C1] text-xs text-[#C0352A] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{paymentError}</span>
          </div>
        )}

        {/* Token or Pending Payment Banner */}
        {isOnlinePending ? (
          <Card className="border-2 border-[#B8741A]/30 overflow-hidden text-center shadow-md bg-white">
            <div className="bg-[#B8741A] py-2 px-4 text-white text-xs font-bold tracking-wide uppercase flex items-center justify-center gap-1.5">
              <CreditCard className="w-4 h-4" />
              <span>Payment Required to Reserve Token</span>
            </div>

            <CardContent className="pt-6 pb-6 space-y-4">
              <div className="w-14 h-14 rounded-full bg-[#FDF7EC] text-[#B8741A] flex items-center justify-center mx-auto text-2xl font-mono">
                ⏳
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#20201E]">Complete Online Payment</h3>
                <p className="text-xs text-[#575653] max-w-sm mx-auto mt-1">
                  Your pickup token will be generated atomically the instant payment is confirmed via Razorpay.
                </p>
              </div>

              <div className="inline-block p-2 px-4 rounded-xl bg-[#F8F6F1] border border-[#E6E2D8] text-sm font-mono font-bold text-[#20201E]">
                Amount Due: <span className="text-[#D95732]">{formatPaisaToINR(order.totalPaisa)}</span>
              </div>

              <div className="pt-2">
                <Button
                  size="lg"
                  onClick={handlePayNow}
                  isLoading={isPaying}
                  className="w-full text-base font-bold shadow-md bg-[#D95732] hover:bg-[#C24B29] gap-2 transition-all cursor-pointer"
                >
                  <QrCode className="w-5 h-5" />
                  <span>
                    {isPaying
                      ? 'Opening Secure Gateway...'
                      : `Pay with UPI / Cards (${formatPaisaToINR(order.totalPaisa)})`}
                  </span>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : isCompleted ? (
          <Card className="border-2 border-[#247A52] bg-white overflow-hidden text-center shadow-md">
            <div className="bg-[#247A52] py-2.5 px-4 text-white text-xs font-extrabold tracking-wide uppercase flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Order Handed Over • Completed</span>
            </div>

            <CardContent className="pt-6 pb-6 space-y-3">
              <div className="w-16 h-16 rounded-full bg-[#EAF4EE] text-[#247A52] flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-9 h-9" />
              </div>

              <div>
                <div className="text-5xl sm:text-6xl font-extrabold text-[#20201E] tracking-tight font-mono tabular-nums">
                  #{order.pickupToken?.tokenDisplay ?? '---'}
                </div>
                <p className="text-sm font-bold text-[#247A52] mt-1.5 flex items-center justify-center gap-1.5">
                  <span>Food Handed Over at Counter</span>
                  <span>✨</span>
                </p>
                <p className="text-xs text-[#575653] mt-0.5">
                  Thank you! We hope you enjoy your meal.
                </p>
              </div>

              <div className="flex items-center justify-center gap-2 pt-1">
                <Badge variant="success" className="bg-[#247A52] text-white font-semibold">
                  ✅ Handed Over
                </Badge>
                <Badge variant="default">
                  {order.paymentStatus === 'PAID'
                    ? order.paymentMethod === 'CASH_COUNTER'
                      ? 'Paid Cash at Counter'
                      : 'Paid Online'
                    : 'Paid Cash'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ) : isReady ? (
          <Card className="border-2 border-[#247A52] bg-[#F2F9F5] overflow-hidden text-center shadow-xl ring-4 ring-[#247A52]/25 animate-pulse transition-all">
            <div className="bg-[#247A52] py-2.5 px-4 text-white text-xs font-extrabold tracking-wider uppercase flex items-center justify-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
              <Bell className="w-4 h-4 animate-bounce" />
              <span>Ready for Pickup at Counter!</span>
            </div>

            <CardContent className="pt-6 pb-6 space-y-2">
              <div className="text-6xl sm:text-7xl font-extrabold text-[#247A52] tracking-tighter font-mono tabular-nums drop-shadow-sm">
                #{order.pickupToken?.tokenDisplay ?? '---'}
              </div>

              <p className="text-base font-extrabold text-[#247A52]">
                Your food is ready! Please collect it at the counter.
              </p>

              <div className="flex items-center justify-center gap-2 pt-2">
                <Badge variant="success" className="bg-[#247A52] text-white font-bold px-3 py-1 text-xs">
                  🟢 Ready for Collection
                </Badge>
                <Badge variant="default">
                  {order.paymentStatus === 'PAID'
                    ? order.paymentMethod === 'CASH_COUNTER'
                      ? 'Paid Cash at Counter'
                      : 'Paid Online'
                    : 'Pay Cash at Counter'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-2 border-[#D95732]/20 overflow-hidden text-center shadow-md bg-white">
            <div className="bg-[#D95732] py-2 px-4 text-white text-xs font-bold tracking-wide uppercase">
              Your Pickup Token
            </div>

            <CardContent className="pt-6 pb-6 space-y-2">
              <div className="text-6xl sm:text-7xl font-extrabold text-[#D95732] tracking-tighter font-mono tabular-nums">
                #{order.pickupToken?.tokenDisplay ?? '---'}
              </div>

              <p className="text-sm font-semibold text-[#20201E]">
                Show this token at the counter when called
              </p>

              <div className="flex items-center justify-center gap-2 pt-2">
                <Badge
                  variant={order.status === 'PREPARING' ? 'warning' : 'info'}
                >
                  {order.status === 'PREPARING' ? '🟡 Kitchen Preparing' : '🔵 Order Received'}
                </Badge>
                <Badge variant="default">
                  {order.paymentStatus === 'PAID'
                    ? order.paymentMethod === 'CASH_COUNTER'
                      ? 'Paid Cash at Counter'
                      : 'Paid Online'
                    : 'Pay Cash at Counter'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live Preparation Stage Timeline (Active when order is placed/preparing/ready) */}
        {!isOnlinePending && (
          <Card>
            <CardContent className="pt-6 pb-6">
              <div className="relative">
                <div className="space-y-6">
                  {steps.map((step, idx) => {
                    const isDone = isCompleted ? true : idx < currentStep
                    const isCurrent = !isCompleted && idx === currentStep

                    return (
                      <div key={step.key} className="flex items-start gap-4 relative">
                        {/* Step Circle */}
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all ${
                            isDone
                              ? 'bg-[#247A52] text-white shadow-sm'
                              : isCurrent
                              ? isReady
                                ? 'bg-[#247A52] text-white ring-4 ring-[#247A52]/20 animate-pulse'
                                : 'bg-[#D95732] text-white ring-4 ring-[#FDF1ED]'
                              : 'bg-[#F2EFE9] text-[#8C8A84] border border-[#E6E2D8]'
                          }`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : isCurrent ? (
                            isReady ? (
                              <Bell className="w-5 h-5 animate-bounce" />
                            ) : (
                              <ChefHat className="w-5 h-5 animate-bounce" />
                            )
                          ) : (
                            <span>{idx + 1}</span>
                          )}
                        </div>

                        {/* Step Label */}
                        <div className="flex-1 pt-1">
                          <div className="flex items-center justify-between">
                            <h4
                              className={`text-sm font-bold ${
                                isDone
                                  ? 'text-[#247A52]'
                                  : isCurrent
                                  ? isReady
                                    ? 'text-[#247A52]'
                                    : 'text-[#D95732]'
                                  : 'text-[#8C8A84]'
                              }`}
                            >
                              {step.label}
                            </h4>
                            {isCurrent && (
                              <span
                                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                                  isReady
                                    ? 'text-[#247A52] bg-[#EAF4EE] border-[#247A52]/30 animate-pulse font-bold'
                                    : 'text-[#D95732] bg-[#FDF1ED] border-[#F3DEB8]'
                                }`}
                              >
                                {isReady ? 'Ready Now!' : 'In Progress'}
                              </span>
                            )}
                            {isCompleted && idx === 3 && (
                              <span className="text-[11px] font-bold text-[#247A52] bg-[#EAF4EE] px-2 py-0.5 rounded-md border border-[#247A52]/30">
                                Completed 🎉
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#575653] mt-0.5">{step.desc}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Order Details Summary */}
        <Card>
          <CardContent className="pt-5 pb-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#F2EFE9]">
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-[#D95732]" />
                <span className="text-xs font-bold text-[#20201E]">Samosa Corner Flagship</span>
              </div>
              <span className="text-xs text-[#575653]">Order Summary</span>
            </div>

            <div className="space-y-3">
              {order.items.map((item) => (
                <div key={item.id} className="flex justify-between items-start text-xs">
                  <div>
                    <span className="font-bold text-[#20201E] font-mono tabular-nums mr-1.5">
                      {item.quantity}x
                    </span>
                    <span className="font-medium text-[#20201E]">{item.itemNameSnapshot}</span>
                    {item.variantNameSnapshot && (
                      <span className="text-[#575653] block text-[11px] ml-5">
                        {item.variantNameSnapshot}
                      </span>
                    )}
                    {item.addonsSnapshot.length > 0 && (
                      <span className="text-[#8C8A84] block text-[10px] ml-5">
                        + {item.addonsSnapshot.map((a) => a.name).join(', ')}
                      </span>
                    )}
                  </div>
                  <span className="font-semibold text-[#20201E] font-mono tabular-nums">
                    {formatPaisaToINR(item.lineTotalPaisa)}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-[#F2EFE9] space-y-1.5 text-xs text-[#575653]">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">{formatPaisaToINR(order.subtotalPaisa)}</span>
              </div>
              <div className="flex justify-between">
                <span>GST (5%)</span>
                <span className="font-mono tabular-nums">{formatPaisaToINR(order.taxPaisa)}</span>
              </div>
              <div className="flex justify-between font-bold text-sm text-[#20201E] pt-1 border-t border-[#E6E2D8]">
                <span>Total Amount</span>
                <span className="font-mono tabular-nums text-[#D95732]">
                  {formatPaisaToINR(order.totalPaisa)}
                </span>
              </div>
            </div>

            {order.notes && (
              <div className="p-2.5 rounded-lg bg-[#F8F6F1] border border-[#E6E2D8] text-xs text-[#575653]">
                <strong className="text-[#20201E]">Instructions:</strong> {order.notes}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live Audio / Callout notice */}
        {isCompleted ? (
          <div className="p-4 rounded-xl bg-[#EAF4EE] border border-[#247A52]/30 flex items-center gap-3 text-xs text-[#1D6343] shadow-sm">
            <CheckCircle2 className="w-5 h-5 text-[#247A52] shrink-0" />
            <span>
              Your order has been handed over at the counter. Thank you for dining with <strong>Samosa Corner</strong>! Enjoy your meal.
            </span>
          </div>
        ) : isReady ? (
          <div className="p-4 rounded-xl bg-[#EAF4EE] border border-[#247A52]/40 flex items-center gap-3 text-xs text-[#1D6343] font-medium shadow-md animate-pulse">
            <Bell className="w-5 h-5 text-[#247A52] shrink-0 animate-bounce" />
            <span>
              Token <strong>#{order.pickupToken?.tokenDisplay ?? order.orderNumber}</strong> is flashing green! Please collect your fresh food at the counter now.
            </span>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-white border border-[#E6E2D8] flex items-center gap-3 text-xs text-[#575653]">
            <Bell className="w-5 h-5 text-[#B8741A] shrink-0" />
            <span>
              Bookmark or keep this screen open. When token <strong>#{order.pickupToken?.tokenDisplay ?? order.orderNumber}</strong> flashes green, your food is ready at the counter!
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
