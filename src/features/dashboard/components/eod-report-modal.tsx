import React from 'react'
import { FileSpreadsheet, Printer, X, Banknote, QrCode, TrendingUp, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatPaisaToINR } from '@/lib/currency'
import { generateEodReport, exportEodReportToCsv, printZReport, type EodReport } from '@/services/report.service'
import type { Order } from '@/types/order'

export interface EodReportModalProps {
  isOpen: boolean
  onClose: () => void
  orders: Order[]
  shopName?: string
}

export const EodReportModal: React.FC<EodReportModalProps> = ({
  isOpen,
  onClose,
  orders,
  shopName = 'Samosa Corner',
}) => {
  if (!isOpen) return null

  const report: EodReport = generateEodReport(orders)

  const handleDownloadCsv = () => {
    exportEodReportToCsv(report, shopName)
  }

  const handlePrintZReport = () => {
    printZReport(report, shopName)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-[#E6E2D8] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#E6E2D8] flex items-center justify-between bg-[#F8F6F1]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#D95732] text-white flex items-center justify-center font-bold text-base shadow-xs">
              📊
            </div>
            <div>
              <h3 className="text-base font-bold text-[#20201E] tracking-tight">
                End-of-Day (EOD) Z-Report
              </h3>
              <p className="text-xs text-[#575653] flex items-center gap-1.5 mt-0.5">
                <Calendar className="w-3.5 h-3.5 text-[#D95732]" />
                <span>Shift Date: <strong>{report.businessDate}</strong> (4:00 AM IST Rollover)</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#8C8A84] hover:text-[#20201E] rounded-lg hover:bg-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs text-[#575653]">
          {/* Shift Banner */}
          <div className="p-3 rounded-xl bg-[#F8F6F1] border border-[#E6E2D8] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-[#20201E]">{shopName}</span>
              <p className="text-[11px] text-[#8C8A84]">
                Operating Window: {report.periodStartIST} – {report.periodEndIST}
              </p>
            </div>
            <div className="text-right sm:self-center">
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#EAF4EE] text-[#247A52] font-semibold">
                Daily Z-Audit
              </span>
            </div>
          </div>

          {/* Key Metric Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-white border border-[#E6E2D8] shadow-2xs">
              <span className="text-[11px] font-medium text-[#8C8A84] block">Gross Total Sales</span>
              <span className="text-lg font-mono font-extrabold text-[#20201E] tabular-nums mt-0.5 block">
                {formatPaisaToINR(report.grossSalesPaisa)}
              </span>
              <span className="text-[10px] text-[#247A52] font-medium mt-0.5 block">
                Net: {formatPaisaToINR(report.netSalesPaisa)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-white border border-[#E6E2D8] shadow-2xs">
              <span className="text-[11px] font-medium text-[#8C8A84] block">GST Collected (5%)</span>
              <span className="text-lg font-mono font-extrabold text-[#20201E] tabular-nums mt-0.5 block">
                {formatPaisaToINR(report.totalGstPaisa)}
              </span>
              <span className="text-[10px] text-[#8C8A84] font-medium mt-0.5 block">
                Avg Order: {formatPaisaToINR(report.averageOrderValuePaisa)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E6E2D8] shadow-2xs">
              <span className="text-[11px] font-medium text-[#575653] flex items-center gap-1">
                <Banknote className="w-3.5 h-3.5 text-[#247A52]" />
                <span>Cash in Till</span>
              </span>
              <span className="text-lg font-mono font-extrabold text-[#247A52] tabular-nums mt-0.5 block">
                {formatPaisaToINR(report.cashSalesPaisa)}
              </span>
              <span className="text-[10px] text-[#575653] mt-0.5 block">
                {report.cashOrdersCount} cash orders
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF9F6] border border-[#E6E2D8] shadow-2xs">
              <span className="text-[11px] font-medium text-[#575653] flex items-center gap-1">
                <QrCode className="w-3.5 h-3.5 text-[#2B6CB0]" />
                <span>Online UPI</span>
              </span>
              <span className="text-lg font-mono font-extrabold text-[#2B6CB0] tabular-nums mt-0.5 block">
                {formatPaisaToINR(report.onlineSalesPaisa)}
              </span>
              <span className="text-[10px] text-[#575653] mt-0.5 block">
                {report.onlineOrdersCount} UPI settlements
              </span>
            </div>
          </div>

          {/* Ticket Volume Breakdown */}
          <div className="p-3.5 rounded-xl bg-white border border-[#E6E2D8] flex items-center justify-between text-xs">
            <span className="font-semibold text-[#20201E]">Tickets Breakdown:</span>
            <div className="flex gap-4 font-mono font-medium">
              <span>Total: <strong className="text-[#20201E]">{report.totalOrdersCount}</strong></span>
              <span className="text-[#247A52]">Completed: <strong>{report.completedOrdersCount}</strong></span>
              <span className="text-[#B8741A]">In Queue: <strong>{report.activeOrdersCount}</strong></span>
              {report.cancelledOrdersCount > 0 && (
                <span className="text-[#C0352A]">Cancelled: <strong>{report.cancelledOrdersCount}</strong></span>
              )}
            </div>
          </div>

          {/* Item-wise Sales Breakdown */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-[#20201E] uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-[#D95732]" />
              <span>Item-Wise Sales & Volume</span>
            </h4>

            <div className="border border-[#E6E2D8] rounded-xl overflow-hidden bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8F6F1] text-[#575653] font-semibold border-b border-[#E6E2D8]">
                  <tr>
                    <th className="p-2.5 pl-3">Item Name</th>
                    <th className="p-2.5 text-center">Qty Sold</th>
                    <th className="p-2.5 text-right">Revenue</th>
                    <th className="p-2.5 pr-3 text-right">Sales Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2EFE9]">
                  {report.itemBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-[#8C8A84]">
                        No items sold during this operational window.
                      </td>
                    </tr>
                  ) : (
                    report.itemBreakdown.map((item) => {
                      const share =
                        report.grossSalesPaisa > 0
                          ? `${((item.totalRevenuePaisa / report.grossSalesPaisa) * 100).toFixed(1)}%`
                          : '0%'

                      return (
                        <tr key={item.productId} className="hover:bg-[#F8F6F1]/50">
                          <td className="p-2.5 pl-3 font-semibold text-[#20201E]">{item.itemName}</td>
                          <td className="p-2.5 text-center font-mono font-bold text-[#D95732]">
                            {item.quantitySold}
                          </td>
                          <td className="p-2.5 text-right font-mono font-semibold text-[#20201E]">
                            {formatPaisaToINR(item.totalRevenuePaisa)}
                          </td>
                          <td className="p-2.5 pr-3 text-right font-mono text-[#575653]">{share}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-4 border-t border-[#E6E2D8] bg-[#F8F6F1] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[11px] text-[#8C8A84]">
            Data auto-reconciled against PostgreSQL ledger & 4 AM IST daily cutoff.
          </p>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrintZReport}
              className="gap-1.5 text-xs font-semibold flex-1 sm:flex-none"
            >
              <Printer className="w-4 h-4 text-[#575653]" />
              <span>Print Z-Report</span>
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={handleDownloadCsv}
              className="gap-1.5 text-xs font-bold bg-[#247A52] hover:bg-[#1D6343] text-white flex-1 sm:flex-none shadow-sm"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export CSV (Excel)</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
