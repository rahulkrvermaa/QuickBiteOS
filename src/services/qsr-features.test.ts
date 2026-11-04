import { describe, it, expect } from 'vitest'
import {
  normalizeIndianPhoneNumber,
  formatPickupMessage,
  getWhatsAppPickupLink,
  sendWhatsAppNotification,
} from './notification.service'
import {
  getBusinessDateString,
  generateEodReport,
  exportEodReportToCsv,
} from './report.service'
import { printKOT, printCustomerReceipt } from './print.service'
import { BENCHMARK_ORDERS } from '@/lib/mock-data/benchmark-orders'
import { BENCHMARK_BUSINESS } from '@/lib/mock-data/benchmark-shop'
import type { Order } from '@/types/order'

describe('QSR Production Features: Thermal Print, WhatsApp & EOD Z-Report', () => {
  const sampleOrder: Order = {
    ...BENCHMARK_ORDERS[0],
    id: 'ord_test_001',
    customerName: 'Rahul Verma',
    customerPhone: '8320917837',
    orderNumber: 'QB-2611-001',
    pickupToken: {
      id: 'tok_001',
      orderId: 'ord_test_001',
      businessId: 'biz_001',
      branchId: 'branch_001',
      tokenDisplay: 'A001',
      sequenceNum: 1,
      tokenDate: '2026-11-04',
      createdAt: '2026-11-04T12:00:00.000Z',
    },
    subtotalPaisa: 5500,
    taxPaisa: 275,
    totalPaisa: 5775,
  }

  describe('1. WhatsApp / SMS Pickup Notification Service', () => {
    it('normalizes various Indian phone formats to 91XXXXXXXXXX', () => {
      expect(normalizeIndianPhoneNumber('9876543210')).toBe('919876543210')
      expect(normalizeIndianPhoneNumber('+91 98765 43210')).toBe('919876543210')
      expect(normalizeIndianPhoneNumber('91-9876543210')).toBe('919876543210')
      expect(normalizeIndianPhoneNumber('+919876543210')).toBe('919876543210')
    })

    it('formats an authentic, friendly WhatsApp pickup notification message', () => {
      const msg = formatPickupMessage(sampleOrder, 'Samosa Corner Flagship')
      expect(msg).toContain('Samosa Corner Flagship')
      expect(msg).toContain('Rahul Verma')
      expect(msg).toContain('Pickup Token: #A001')
      expect(msg).toContain('READY FOR PICKUP')
    })

    it('generates a compliant WhatsApp Web/Mobile deep-link with pre-filled encoded text', () => {
      const url = getWhatsAppPickupLink(sampleOrder, 'Samosa Corner')
      expect(url).toMatch(/^https:\/\/wa\.me\/918320917837\?text=/)
      expect(decodeURIComponent(url)).toContain('#A001')
      expect(decodeURIComponent(url)).toContain('Rahul Verma')
    })

    it('handles sendWhatsAppNotification with autoOpen: false safely without window', () => {
      const res = sendWhatsAppNotification(sampleOrder, { autoOpen: false })
      expect(res.success).toBe(true)
      expect(res.url).toContain('wa.me/918320917837')
    })
  })

  describe('2. End-of-Day (EOD) Z-Report & Sales Reconciliation', () => {
    it('computes business date string adhering to the 4:00 AM IST cutoff rule', () => {
      // 03:30 AM IST on Nov 4 falls on Nov 3 business day
      const lateNight = new Date('2026-11-03T22:00:00.000Z') // 03:30 AM IST
      expect(getBusinessDateString(lateNight)).toBe('2026-11-03')

      // 04:30 AM IST on Nov 4 falls on Nov 4 business day
      const nextMorning = new Date('2026-11-03T23:00:00.000Z') // 04:30 AM IST
      expect(getBusinessDateString(nextMorning)).toBe('2026-11-04')
    })

    it('accurately aggregates gross sales, cash in till, online UPI, and item breakdowns', () => {
      const cashOrder: Order = {
        ...sampleOrder,
        id: 'ord_cash_1',
        paymentMethod: 'CASH_COUNTER',
        paymentStatus: 'PAID',
        totalPaisa: 4000,
        subtotalPaisa: 3800,
        taxPaisa: 200,
        pickupToken: { ...sampleOrder.pickupToken!, tokenDate: '2026-11-04' },
        items: [
          {
            id: 'item_1',
            orderId: 'ord_cash_1',
            productId: 'p_samosa',
            itemNameSnapshot: 'Punjabi Aloo Samosa',
            unitPricePaisa: 2000,
            quantity: 2,
            addonsSnapshot: [],
            lineTotalPaisa: 4000,
          },
        ],
      }

      const onlineOrder: Order = {
        ...sampleOrder,
        id: 'ord_online_1',
        paymentMethod: 'ONLINE_UPI',
        paymentStatus: 'PAID',
        totalPaisa: 6000,
        subtotalPaisa: 5700,
        taxPaisa: 300,
        pickupToken: { ...sampleOrder.pickupToken!, tokenDate: '2026-11-04' },
        items: [
          {
            id: 'item_2',
            orderId: 'ord_online_1',
            productId: 'p_samosa',
            itemNameSnapshot: 'Punjabi Aloo Samosa',
            unitPricePaisa: 2000,
            quantity: 1,
            addonsSnapshot: [],
            lineTotalPaisa: 2000,
          },
          {
            id: 'item_3',
            orderId: 'ord_online_1',
            productId: 'p_lassi',
            itemNameSnapshot: 'Amritsari Sweet Lassi',
            unitPricePaisa: 4000,
            quantity: 1,
            addonsSnapshot: [],
            lineTotalPaisa: 4000,
          },
        ],
      }

      const report = generateEodReport([cashOrder, onlineOrder], '2026-11-04')

      expect(report.totalOrdersCount).toBe(2)
      expect(report.grossSalesPaisa).toBe(10000) // ₹100.00
      expect(report.netSalesPaisa).toBe(9500)
      expect(report.totalGstPaisa).toBe(500)
      expect(report.cashSalesPaisa).toBe(4000) // ₹40.00 cash
      expect(report.onlineSalesPaisa).toBe(6000) // ₹60.00 online UPI
      expect(report.cashOrdersCount).toBe(1)
      expect(report.onlineOrdersCount).toBe(1)
      expect(report.averageOrderValuePaisa).toBe(5000) // ₹50.00 AOV

      // Items breakdown check: Samosa (3 sold), Lassi (1 sold)
      expect(report.itemBreakdown.length).toBe(2)
      const samosaStat = report.itemBreakdown.find((i) => i.productId === 'p_samosa')
      expect(samosaStat?.quantitySold).toBe(3)
      expect(samosaStat?.totalRevenuePaisa).toBe(6000)
    })

    it('exports CSV with correct structure without throwing', () => {
      const report = generateEodReport([sampleOrder], '2026-11-04')
      expect(() => exportEodReportToCsv(report, 'Samosa Corner')).not.toThrow()
    })
  })

  describe('3. Thermal Print Service (KOT & Receipts)', () => {
    it('executes printKOT and printCustomerReceipt safely without errors', () => {
      expect(() => printKOT(sampleOrder, { paperWidth: '58mm' })).not.toThrow()
      expect(() => printCustomerReceipt(sampleOrder, { business: BENCHMARK_BUSINESS, paperWidth: '80mm' })).not.toThrow()
    })
  })
})
