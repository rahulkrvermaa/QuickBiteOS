import type { Product, BusinessSettings } from '@/types/domain'

export interface CartItemSubmission {
  productId: string
  variantId?: string
  addons?: {
    addonId: string
    quantity: number
  }[]
  quantity: number
}

export interface CalculatedOrderItem {
  productId: string
  itemNameSnapshot: string
  variantNameSnapshot?: string
  unitPricePaisa: number
  quantity: number
  addonsSnapshot: {
    addonId: string
    name: string
    pricePaisa: number
    quantity: number
  }[]
  lineTotalPaisa: number
}

export interface PricingCalculationResult {
  items: CalculatedOrderItem[]
  subtotalPaisa: number
  taxPaisa: number
  discountPaisa: number
  totalPaisa: number
}

export class PricingValidationError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'PricingValidationError'
  }
}

/**
 * Server-authoritative price calculation.
 * Client-submitted prices and totals are completely discarded.
 * Validates product availability, valid variants, addon boundaries, and computes tax strictly in integer paisa.
 */
export function calculateOrderPricing(
  submissions: CartItemSubmission[],
  catalogProducts: Product[],
  settings: BusinessSettings
): PricingCalculationResult {
  if (!submissions || submissions.length === 0) {
    throw new PricingValidationError('Order must contain at least one item.', 'EMPTY_ORDER')
  }

  const productMap = new Map<string, Product>(catalogProducts.map((p) => [p.id, p]))
  const calculatedItems: CalculatedOrderItem[] = []
  let subtotalPaisa = 0

  for (const item of submissions) {
    // 1. Validate Item Quantity
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new PricingValidationError(
        `Invalid quantity for item: must be at least 1.`,
        'INVALID_QUANTITY'
      )
    }
    if (item.quantity > 50) {
      throw new PricingValidationError(
        `Quantity limit exceeded (maximum 50 items per line).`,
        'QUANTITY_LIMIT_EXCEEDED'
      )
    }

    // 2. Validate Product Existence & Availability
    const product = productMap.get(item.productId)
    if (!product) {
      throw new PricingValidationError(
        `Product with ID ${item.productId} does not exist in the catalog.`,
        'PRODUCT_NOT_FOUND'
      )
    }

    if (!product.isAvailable) {
      throw new PricingValidationError(
        `Product "${product.name}" is currently sold out and cannot be ordered.`,
        'PRODUCT_UNAVAILABLE'
      )
    }

    // 3. Determine Base Unit Price (from Variant if selected, else basePricePaisa)
    let unitBasePaisa = product.basePricePaisa
    let variantNameSnapshot: string | undefined = undefined

    if (item.variantId) {
      const variant = product.variants.find((v) => v.id === item.variantId)
      if (!variant) {
        throw new PricingValidationError(
          `Invalid variant selected for product "${product.name}".`,
          'INVALID_VARIANT'
        )
      }
      unitBasePaisa = variant.priceOverridePaisa
      variantNameSnapshot = variant.name
    }

    // 4. Validate & Calculate Add-ons
    let addonsTotalPaisa = 0
    const addonsSnapshot: CalculatedOrderItem['addonsSnapshot'] = []

    if (item.addons && item.addons.length > 0) {
      for (const addonSub of item.addons) {
        if (addonSub.quantity <= 0) continue

        const addonDef = product.addons.find((a) => a.id === addonSub.addonId)
        if (!addonDef) {
          throw new PricingValidationError(
            `Add-on with ID ${addonSub.addonId} does not belong to "${product.name}".`,
            'INVALID_ADDON'
          )
        }

        if (addonSub.quantity > addonDef.maxQuantity) {
          throw new PricingValidationError(
            `Maximum limit for add-on "${addonDef.name}" is ${addonDef.maxQuantity}.`,
            'ADDON_LIMIT_EXCEEDED'
          )
        }

        addonsTotalPaisa += addonDef.pricePaisa * addonSub.quantity
        addonsSnapshot.push({
          addonId: addonDef.id,
          name: addonDef.name,
          pricePaisa: addonDef.pricePaisa,
          quantity: addonSub.quantity,
        })
      }
    }

    // 5. Compute Line Total
    const finalUnitPricePaisa = unitBasePaisa + addonsTotalPaisa
    const lineTotalPaisa = finalUnitPricePaisa * item.quantity

    subtotalPaisa += lineTotalPaisa

    calculatedItems.push({
      productId: product.id,
      itemNameSnapshot: product.name,
      variantNameSnapshot,
      unitPricePaisa: finalUnitPricePaisa,
      quantity: item.quantity,
      addonsSnapshot,
      lineTotalPaisa,
    })
  }

  // 6. Tax and Total Calculations
  const taxGstPercentage = settings.taxGstPercentage ?? 5
  const taxPaisa = Math.round((subtotalPaisa * taxGstPercentage) / 100)
  const discountPaisa = 0 // Future coupon module will calculate discount here
  const totalPaisa = subtotalPaisa - discountPaisa + taxPaisa

  return {
    items: calculatedItems,
    subtotalPaisa,
    taxPaisa,
    discountPaisa,
    totalPaisa,
  }
}

