import type { Order } from '@/types/order'

export interface NotificationResult {
  url: string
  success: boolean
  message: string
}

/**
 * Extracts a normalized 10-digit Indian phone number or 12-digit number with country code.
 */
export function normalizeIndianPhoneNumber(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '')
  if (digits.length === 10) {
    return `91${digits}`
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits
  }
  return digits
}

/**
 * Builds the official WhatsApp pickup notification message text.
 */
export function formatPickupMessage(order: Order, shopName = 'Samosa Corner'): string {
  const token = order.pickupToken?.tokenDisplay || '---'
  const itemsSummary = order.items
    .map((item) => `• ${item.quantity}x ${item.itemNameSnapshot}`)
    .join('\n')

  return `🥟 *${shopName}*

Hi *${order.customerName}*!
Your food is fresh & *READY FOR PICKUP* at the counter! 🔔

🎟️ *Pickup Token: #${token}*
🧾 Ref: ${order.orderNumber}

*Items:*
${itemsSummary}

Please show this token at the counter to collect your order. Enjoy your meal! ✨`
}

/**
 * Generates the universal WhatsApp direct message URL (works on Android, iOS, and WhatsApp Web).
 */
export function getWhatsAppPickupLink(order: Order, shopName = 'Samosa Corner'): string {
  const phone = normalizeIndianPhoneNumber(order.customerPhone)
  const message = formatPickupMessage(order, shopName)
  const encodedText = encodeURIComponent(message)

  if (!phone || phone.length < 10) {
    // Fallback to text without specific number if phone was empty
    return `https://wa.me/?text=${encodedText}`
  }

  return `https://wa.me/${phone}?text=${encodedText}`
}

/**
 * Triggers a WhatsApp pickup notification.
 * Opens WhatsApp Web on desktop or the WhatsApp App on mobile in a new tab/window.
 */
export function sendWhatsAppNotification(
  order: Order,
  options: { shopName?: string; autoOpen?: boolean } = {}
): NotificationResult {
  const shopName = options.shopName || 'Samosa Corner'
  const url = getWhatsAppPickupLink(order, shopName)
  const message = formatPickupMessage(order, shopName)

  if (options.autoOpen !== false && typeof window !== 'undefined') {
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
      return { url, success: true, message }
    } catch (e) {
      console.warn('Could not open WhatsApp window:', e)
      return { url, success: false, message }
    }
  }

  return { url, success: true, message }
}

