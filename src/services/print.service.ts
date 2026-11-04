import type { Order } from '@/types/order'
import type { Business } from '@/types/domain'
import { formatPaisaToINR } from '@/lib/currency'
import { formatTimeIST } from '@/lib/utils'

export type PrintPaperWidth = '58mm' | '80mm'

export interface PrintOptions {
  paperWidth?: PrintPaperWidth
  shopName?: string
  address?: string
  phone?: string
  gstin?: string
}

/**
 * Creates a sandboxed hidden iframe to print thermal receipts or KOTs
 * without modifying or flashing the current page DOM.
 */
function printHtmlContent(htmlContent: string): void {
  if (typeof window === 'undefined') return

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'

  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) {
    document.body.removeChild(iframe)
    return
  }

  doc.open()
  doc.write(htmlContent)
  doc.close()

  iframe.contentWindow?.focus()
  setTimeout(() => {
    try {
      iframe.contentWindow?.print()
    } catch (e) {
      console.warn('Thermal print failed:', e)
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe)
        }
      }, 1000)
    }
  }, 250)
}

/**
 * Generates thermal CSS optimized for 58mm / 80mm thermal receipt rolls.
 */
function getThermalStyles(paperWidth: PrintPaperWidth = '58mm'): string {
  const widthPx = paperWidth === '80mm' ? '72mm' : '48mm'

  return `
    @page {
      margin: 0;
      size: auto;
    }
    body {
      font-family: 'Courier New', Courier, monospace, monospace;
      color: #000;
      background: #fff;
      margin: 0;
      padding: 4mm 2mm;
      width: ${widthPx};
      font-size: 11px;
      line-height: 1.25;
      text-transform: uppercase;
      font-weight: 600;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .bold { font-weight: 900; }
    .title { font-size: 15px; font-weight: 900; margin-bottom: 2px; }
    .token-box {
      border: 2px dashed #000;
      padding: 4px;
      margin: 6px 0;
      text-align: center;
    }
    .token-num {
      font-size: 26px;
      font-weight: 900;
      line-height: 1.1;
      letter-spacing: 1px;
    }
    .dashed-line {
      border-top: 1px dashed #000;
      margin: 4px 0;
    }
    .double-line {
      border-top: 2px solid #000;
      margin: 5px 0;
    }
    .flex-between {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .item-row {
      margin: 3px 0;
    }
    .item-qty {
      font-size: 13px;
      font-weight: 900;
      margin-right: 4px;
    }
    .item-addon {
      font-size: 10px;
      padding-left: 14px;
    }
    .notes-box {
      border: 1px solid #000;
      padding: 3px;
      margin-top: 4px;
      font-size: 10px;
    }
    .footer {
      font-size: 9px;
      margin-top: 8px;
      text-align: center;
    }
  `
}

/**
 * Print Kitchen Order Ticket (KOT) for chefs and fryers.
 * Highlights token number, item quantities, and special cooking instructions.
 */
export function printKOT(order: Order, options: PrintOptions = {}): void {
  const paperWidth = options.paperWidth || '58mm'
  const shopName = options.shopName || 'QUICKBITE KITCHEN'
  const tokenDisplay = order.pickupToken?.tokenDisplay || '---'
  const timeStr = formatTimeIST(order.createdAt)

  const itemsHtml = order.items
    .map((item) => {
      const addons =
        item.addonsSnapshot && item.addonsSnapshot.length > 0
          ? item.addonsSnapshot.map((a) => `<div class="item-addon">+ ${a.name} (x${a.quantity})</div>`).join('')
          : ''
      const variant = item.variantNameSnapshot ? `<div class="item-addon">[${item.variantNameSnapshot}]</div>` : ''

      return `
        <div class="item-row">
          <div class="flex-between">
            <div>
              <span class="item-qty">${item.quantity}x</span>
              <span class="bold">${item.itemNameSnapshot}</span>
            </div>
          </div>
          ${variant}
          ${addons}
        </div>
      `
    })
    .join('')

  const notesHtml = order.notes
    ? `
      <div class="notes-box">
        <div class="bold">INSTRUCTIONS:</div>
        <div>${order.notes}</div>
      </div>
    `
    : ''

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>KOT #${tokenDisplay}</title>
        <style>${getThermalStyles(paperWidth)}</style>
      </head>
      <body>
        <div class="text-center title">${shopName}</div>
        <div class="text-center bold">*** KITCHEN ORDER TICKET (KOT) ***</div>
        <div class="dashed-line"></div>

        <div class="token-box">
          <div>PICKUP TOKEN</div>
          <div class="token-num">#${tokenDisplay}</div>
        </div>

        <div class="flex-between">
          <span>REF: ${order.orderNumber}</span>
          <span>${timeStr}</span>
        </div>
        <div class="flex-between">
          <span>CUSTOMER: ${order.customerName}</span>
          <span>${order.paymentMethod === 'CASH_COUNTER' ? '[CASH PENDING]' : '[ONLINE PAID]'}</span>
        </div>

        <div class="double-line"></div>
        <div class="bold text-center">ORDER ITEMS</div>
        <div class="dashed-line"></div>

        ${itemsHtml}

        ${notesHtml}

        <div class="double-line"></div>
        <div class="footer">
          TOTAL ITEMS: ${order.items.reduce((s, i) => s + i.quantity, 0)} • SERVE FRESH & HOT
        </div>
      </body>
    </html>
  `

  printHtmlContent(html)
}

/**
 * Print standard customer receipt for 58mm / 80mm POS thermal printer.
 * Contains shop details, tax invoice breakdown, token number, and thank you note.
 */
export function printCustomerReceipt(order: Order, options: PrintOptions & { business?: Business } = {}): void {
  const paperWidth = options.paperWidth || '58mm'
  const biz = options.business
  const shopName = options.shopName || biz?.name || 'SAMOSA CORNER'
  const address =
    options.address ||
    (biz?.address
      ? `${biz.address}, ${biz.city}`
      : 'Maharajganj Main Rd, near by Sharamahala, Located in: Kali Mandir maharajganj, Jamui, Bihar 811307')
  const phone = options.phone || biz?.phone || '+91 83209 17837'
  const tokenDisplay = order.pickupToken?.tokenDisplay || '---'
  const timeStr = formatTimeIST(order.createdAt)

  const itemsHtml = order.items
    .map((item) => {
      const addons =
        item.addonsSnapshot && item.addonsSnapshot.length > 0
          ? item.addonsSnapshot.map((a) => `<div class="item-addon">+ ${a.name} (x${a.quantity})</div>`).join('')
          : ''
      const variant = item.variantNameSnapshot ? `<div class="item-addon">[${item.variantNameSnapshot}]</div>` : ''

      return `
        <div class="item-row">
          <div class="flex-between">
            <span class="bold">${item.quantity}x ${item.itemNameSnapshot}</span>
            <span>${formatPaisaToINR(item.lineTotalPaisa)}</span>
          </div>
          ${variant}
          ${addons}
        </div>
      `
    })
    .join('')

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Receipt #${order.orderNumber}</title>
        <style>${getThermalStyles(paperWidth)}</style>
      </head>
      <body>
        <div class="text-center title">${shopName}</div>
        <div class="text-center">${address}</div>
        <div class="text-center">PH: ${phone}</div>
        <div class="dashed-line"></div>
        <div class="text-center bold">TAX INVOICE / BILL</div>

        <div class="token-box">
          <div>YOUR PICKUP TOKEN</div>
          <div class="token-num">#${tokenDisplay}</div>
        </div>

        <div class="flex-between">
          <span>BILL: ${order.orderNumber}</span>
          <span>${timeStr}</span>
        </div>
        <div class="flex-between">
          <span>CUST: ${order.customerName}</span>
          <span>${order.customerPhone}</span>
        </div>

        <div class="double-line"></div>
        <div class="flex-between bold">
          <span>ITEM</span>
          <span>AMT</span>
        </div>
        <div class="dashed-line"></div>

        ${itemsHtml}

        <div class="dashed-line"></div>
        <div class="flex-between">
          <span>SUBTOTAL:</span>
          <span>${formatPaisaToINR(order.subtotalPaisa)}</span>
        </div>
        <div class="flex-between">
          <span>GST (5%):</span>
          <span>${formatPaisaToINR(order.taxPaisa)}</span>
        </div>
        ${
          order.discountPaisa > 0
            ? `<div class="flex-between"><span>DISCOUNT:</span><span>-${formatPaisaToINR(order.discountPaisa)}</span></div>`
            : ''
        }
        <div class="double-line"></div>
        <div class="flex-between bold" style="font-size: 13px;">
          <span>TOTAL:</span>
          <span>${formatPaisaToINR(order.totalPaisa)}</span>
        </div>
        <div class="dashed-line"></div>

        <div class="flex-between">
          <span>PAYMENT:</span>
          <span class="bold">${order.paymentMethod === 'CASH_COUNTER' ? 'CASH' : 'ONLINE UPI'} (${order.paymentStatus})</span>
        </div>

        <div class="footer">
          *** THANK YOU! VISIT AGAIN ***<br>
          POWERED BY QUICKBITE OS
        </div>
      </body>
    </html>
  `

  printHtmlContent(html)
}

