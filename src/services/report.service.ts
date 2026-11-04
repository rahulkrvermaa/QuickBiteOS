import type { Order } from '@/types/order'
import { formatPaisaToINR } from '@/lib/currency'
import { escapeHtml } from '@/lib/utils'

export interface ItemSalesSummary {
  productId: string
  itemName: string
  quantitySold: number
  totalRevenuePaisa: number
}

export interface EodReport {
  businessDate: string
  periodStartIST: string
  periodEndIST: string
  totalOrdersCount: number
  completedOrdersCount: number
  activeOrdersCount: number
  cancelledOrdersCount: number
  grossSalesPaisa: number
  netSalesPaisa: number
  totalGstPaisa: number
  totalDiscountPaisa: number
  cashSalesPaisa: number
  cashOrdersCount: number
  onlineSalesPaisa: number
  onlineOrdersCount: number
  averageOrderValuePaisa: number
  itemBreakdown: ItemSalesSummary[]
}

/**
 * Calculates current business date string (YYYY-MM-DD) based on 4:00 AM IST cutoff.
 */
export function getBusinessDateString(date: Date = new Date()): string {
  // Convert UTC to IST (+5:30)
  const istOffsetMs = 5.5 * 60 * 60 * 1000
  const istTime = new Date(date.getTime() + istOffsetMs)

  // Shift back by 4 hours for the 4:00 AM cutoff boundary
  const shifted = new Date(istTime.getTime() - 4 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

/**
 * Calculates a comprehensive End-of-Day (EOD) Z-Report for a specific business date
 * respecting the 4:00 AM IST daily operational cycle.
 */
export function generateEodReport(orders: Order[], targetBusinessDate?: string): EodReport {
  const businessDate = targetBusinessDate || getBusinessDateString()

  // Filter orders belonging to this business date
  const dayOrders = orders.filter((o) => {
    // If order has a pickupToken with tokenDate, use that; otherwise calculate from createdAt
    if (o.pickupToken?.tokenDate) {
      return o.pickupToken.tokenDate === businessDate
    }
    const orderDate = new Date(o.createdAt)
    return getBusinessDateString(orderDate) === businessDate
  })

  let grossSalesPaisa = 0
  let netSalesPaisa = 0
  let totalGstPaisa = 0
  let totalDiscountPaisa = 0
  let cashSalesPaisa = 0
  let cashOrdersCount = 0
  let onlineSalesPaisa = 0
  let onlineOrdersCount = 0
  let completedCount = 0
  let activeCount = 0
  let cancelledCount = 0

  const itemsMap = new Map<string, { name: string; qty: number; revPaisa: number }>()

  for (const order of dayOrders) {
    if (order.status === 'CANCELLED') {
      cancelledCount++
      continue
    }

    if (order.status === 'COMPLETED') {
      completedCount++
    } else {
      activeCount++
    }

    // Only count financial volume for orders that are PAID or active CASH
    const isPaidOrCashActive = order.paymentStatus === 'PAID' || order.paymentMethod === 'CASH_COUNTER'

    if (isPaidOrCashActive) {
      grossSalesPaisa += order.totalPaisa
      netSalesPaisa += order.subtotalPaisa
      totalGstPaisa += order.taxPaisa
      totalDiscountPaisa += order.discountPaisa || 0

      if (order.paymentMethod === 'CASH_COUNTER') {
        cashSalesPaisa += order.totalPaisa
        cashOrdersCount++
      } else {
        onlineSalesPaisa += order.totalPaisa
        onlineOrdersCount++
      }

      // Aggregate item-level statistics
      for (const item of order.items) {
        const existing = itemsMap.get(item.productId) || {
          name: item.itemNameSnapshot,
          qty: 0,
          revPaisa: 0,
        }
        existing.qty += item.quantity
        existing.revPaisa += item.lineTotalPaisa
        itemsMap.set(item.productId, existing)
      }
    }
  }

  const validOrdersCount = cashOrdersCount + onlineOrdersCount
  const averageOrderValuePaisa = validOrdersCount > 0 ? Math.round(grossSalesPaisa / validOrdersCount) : 0

  const itemBreakdown: ItemSalesSummary[] = Array.from(itemsMap.entries())
    .map(([productId, data]) => ({
      productId,
      itemName: data.name,
      quantitySold: data.qty,
      totalRevenuePaisa: data.revPaisa,
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold)

  return {
    businessDate,
    periodStartIST: `${businessDate} 04:00 AM IST`,
    periodEndIST: `${businessDate} (Next Day) 04:00 AM IST`,
    totalOrdersCount: dayOrders.length,
    completedOrdersCount: completedCount,
    activeOrdersCount: activeCount,
    cancelledOrdersCount: cancelledCount,
    grossSalesPaisa,
    netSalesPaisa,
    totalGstPaisa,
    totalDiscountPaisa,
    cashSalesPaisa,
    cashOrdersCount,
    onlineSalesPaisa,
    onlineOrdersCount,
    averageOrderValuePaisa,
    itemBreakdown,
  }
}

/**
 * Exports the EOD Z-Report to CSV formatted with UTF-8 BOM for Indian Excel & spreadsheet applications.
 */
export function exportEodReportToCsv(report: EodReport, shopName = 'Samosa Corner'): void {
  if (typeof window === 'undefined') return

  const rows: string[][] = [
    ['QUICKBITE OS — END-OF-DAY (EOD) Z-REPORT'],
    ['Store / Stall Name', shopName],
    ['Business Date', report.businessDate],
    ['Operational Window', `${report.periodStartIST} to ${report.periodEndIST}`],
    ['Generated At', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    [],
    ['KEY FINANCIAL SUMMARY', 'AMOUNT (INR)', 'PAISA UNITS'],
    ['Gross Total Sales', (report.grossSalesPaisa / 100).toFixed(2), String(report.grossSalesPaisa)],
    ['Net Sales (Excl. Taxes)', (report.netSalesPaisa / 100).toFixed(2), String(report.netSalesPaisa)],
    ['Total GST Collected (5%)', (report.totalGstPaisa / 100).toFixed(2), String(report.totalGstPaisa)],
    ['Discounts Given', (report.totalDiscountPaisa / 100).toFixed(2), String(report.totalDiscountPaisa)],
    ['Average Order Value (AOV)', (report.averageOrderValuePaisa / 100).toFixed(2), String(report.averageOrderValuePaisa)],
    [],
    ['TILL & SETTLEMENT RECONCILIATION', 'AMOUNT (INR)', 'ORDERS COUNT'],
    ['Cash Collected in Till', (report.cashSalesPaisa / 100).toFixed(2), String(report.cashOrdersCount)],
    ['Online UPI Captured (Razorpay)', (report.onlineSalesPaisa / 100).toFixed(2), String(report.onlineOrdersCount)],
    [],
    ['ORDER VOLUME BREAKDOWN', 'COUNT'],
    ['Total Orders', String(report.totalOrdersCount)],
    ['Completed / Handed Over', String(report.completedOrdersCount)],
    ['Active in Kitchen / Counter', String(report.activeOrdersCount)],
    ['Cancelled Orders', String(report.cancelledOrdersCount)],
    [],
    ['TOP-SELLING ITEMS BREAKDOWN', 'QTY SOLD', 'REVENUE (INR)', '% SHARE OF SALES'],
  ]

  for (const item of report.itemBreakdown) {
    const revINR = (item.totalRevenuePaisa / 100).toFixed(2)
    const share =
      report.grossSalesPaisa > 0
        ? `${((item.totalRevenuePaisa / report.grossSalesPaisa) * 100).toFixed(1)}%`
        : '0.0%'
    rows.push([item.itemName, String(item.quantitySold), revINR, share])
  }

  // Convert to CSV string with proper quoting
  const csvContent =
    '\uFEFF' + // UTF-8 BOM
    rows
      .map((r) =>
        r
          .map((cell) => {
            const str = String(cell ?? '')
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str
          })
          .join(',')
      )
      .join('\r\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `QuickBite_EOD_Report_${report.businessDate}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Prints a clean thermal / A4 End-Of-Day Z-Report.
 */
export function printZReport(report: EodReport, shopName = 'Samosa Corner'): void {
  if (typeof window === 'undefined') return

  const cleanShopName = escapeHtml(shopName)
  const cleanBusinessDate = escapeHtml(report.businessDate)

  const itemRows = report.itemBreakdown
    .map(
      (item) => `
      <div style="display:flex; justify-content:space-between; margin:2px 0;">
        <span>${escapeHtml(String(item.quantitySold))}x ${escapeHtml(item.itemName)}</span>
        <span>${formatPaisaToINR(item.totalRevenuePaisa)}</span>
      </div>
    `
    )
    .join('')

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>EOD Z-Report ${cleanBusinessDate}</title>
        <style>
          @page { margin: 0; size: auto; }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: 72mm;
            padding: 4mm 2mm;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.25;
            text-transform: uppercase;
          }
          .center { text-align: center; }
          .bold { font-weight: 900; }
          .divider { border-top: 1px dashed #000; margin: 4px 0; }
          .double-divider { border-top: 2px solid #000; margin: 5px 0; }
          .flex { display: flex; justify-content: space-between; margin: 2px 0; }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size: 15px;">${cleanShopName}</div>
        <div class="center bold">*** END-OF-DAY (EOD) Z-REPORT ***</div>
        <div class="divider"></div>
        <div>BUSINESS DATE: ${cleanBusinessDate}</div>
        <div>SHIFT: 4:00 AM IST RESET</div>
        <div class="double-divider"></div>

        <div class="bold center">FINANCIAL RECONCILIATION</div>
        <div class="divider"></div>
        <div class="flex"><span>GROSS SALES:</span><span class="bold">${formatPaisaToINR(report.grossSalesPaisa)}</span></div>
        <div class="flex"><span>NET SALES:</span><span>${formatPaisaToINR(report.netSalesPaisa)}</span></div>
        <div class="flex"><span>GST (5%):</span><span>${formatPaisaToINR(report.totalGstPaisa)}</span></div>
        <div class="flex"><span>AVG ORDER VALUE:</span><span>${formatPaisaToINR(report.averageOrderValuePaisa)}</span></div>

        <div class="double-divider"></div>
        <div class="bold center">SETTLEMENTS & CASH IN TILL</div>
        <div class="divider"></div>
        <div class="flex"><span>💵 CASH IN TILL:</span><span class="bold">${formatPaisaToINR(report.cashSalesPaisa)} (${report.cashOrdersCount})</span></div>
        <div class="flex"><span>📱 ONLINE UPI:</span><span class="bold">${formatPaisaToINR(report.onlineSalesPaisa)} (${report.onlineOrdersCount})</span></div>

        <div class="double-divider"></div>
        <div class="bold center">ITEM SALES PERFORMANCE</div>
        <div class="divider"></div>
        ${itemRows || '<div class="center">No items sold</div>'}

        <div class="double-divider"></div>
        <div class="center" style="font-size: 9px;">
          TOTAL TICKETS: ${report.totalOrdersCount} (${report.completedOrdersCount} COMPLETED)<br>
          QUICKBITE OS AUDIT STAMP
        </div>
      </body>
    </html>
  `

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) return
  doc.open()
  doc.write(html)
  doc.close()

  iframe.contentWindow?.focus()
  setTimeout(() => {
    try {
      iframe.contentWindow?.print()
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe)
      }, 1000)
    }
  }, 250)
}

