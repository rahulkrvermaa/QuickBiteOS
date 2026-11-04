import { describe, it, expect } from 'vitest'
import { calculateOrderPricing, PricingValidationError } from './pricing.service'
import {
  BENCHMARK_PRODUCTS,
  BENCHMARK_SETTINGS,
} from '@/lib/mock-data/benchmark-shop'

describe('pricing.service: calculateOrderPricing', () => {
  it('correctly calculates order total in integer paisa for samosa and chai', () => {
    // 2x Punjabi Aloo Samosa (Plate of 2 = 3800 paisa) + 1x Extra Saunth (500 paisa)
    // 1x Kulhad Chai (Regular = 2000 paisa)
    const submissions = [
      {
        productId: 'prod_aloo_samosa',
        variantId: 'var_samosa_plate',
        addons: [{ addonId: 'add_extra_saunth', quantity: 1 }],
        quantity: 2,
      },
      {
        productId: 'prod_kulhad_chai',
        variantId: 'var_chai_regular',
        quantity: 1,
      },
    ]

    const result = calculateOrderPricing(submissions, BENCHMARK_PRODUCTS, BENCHMARK_SETTINGS)

    // Item 1: (3800 + 500) * 2 = 8600 paisa (₹86.00)
    // Item 2: 2000 * 1 = 2000 paisa (₹20.00)
    // Subtotal: 10600 paisa (₹106.00)
    // Tax (5% GST): Math.round(10600 * 0.05) = 530 paisa (₹5.30)
    // Total: 10600 + 530 = 11130 paisa (₹111.30)
    expect(result.subtotalPaisa).toBe(10600)
    expect(result.taxPaisa).toBe(530)
    expect(result.totalPaisa).toBe(11130)
    expect(result.items).toHaveLength(2)
    expect(result.items[0].itemNameSnapshot).toBe('Punjabi Aloo Samosa')
    expect(result.items[0].variantNameSnapshot).toBe('Plate of 2 pcs')
  })

  it('rejects empty order submission', () => {
    expect(() => calculateOrderPricing([], BENCHMARK_PRODUCTS, BENCHMARK_SETTINGS)).toThrowError(
      PricingValidationError
    )
  })

  it('rejects product marked unavailable/sold-out', () => {
    const productsWithUnavailable = BENCHMARK_PRODUCTS.map((p) =>
      p.id === 'prod_aloo_samosa' ? { ...p, isAvailable: false } : p
    )

    const submissions = [
      {
        productId: 'prod_aloo_samosa',
        quantity: 1,
      },
    ]

    expect(() =>
      calculateOrderPricing(submissions, productsWithUnavailable, BENCHMARK_SETTINGS)
    ).toThrowError(/sold out/)
  })

  it('rejects non-existent product ID', () => {
    const submissions = [
      {
        productId: 'non_existent_burger_id',
        quantity: 1,
      },
    ]

    expect(() =>
      calculateOrderPricing(submissions, BENCHMARK_PRODUCTS, BENCHMARK_SETTINGS)
    ).toThrowError(/does not exist/)
  })

  it('rejects addon quantity exceeding maximum allowed', () => {
    // maxQuantity for Extra Saunth is 3
    const submissions = [
      {
        productId: 'prod_aloo_samosa',
        addons: [{ addonId: 'add_extra_saunth', quantity: 5 }],
        quantity: 1,
      },
    ]

    expect(() =>
      calculateOrderPricing(submissions, BENCHMARK_PRODUCTS, BENCHMARK_SETTINGS)
    ).toThrowError(/Maximum limit for add-on/)
  })

  it('rejects zero or negative quantities', () => {
    const submissions = [
      {
        productId: 'prod_aloo_samosa',
        quantity: 0,
      },
    ]

    expect(() =>
      calculateOrderPricing(submissions, BENCHMARK_PRODUCTS, BENCHMARK_SETTINGS)
    ).toThrowError(/Invalid quantity/)
  })
})

