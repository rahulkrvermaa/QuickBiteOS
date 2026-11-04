import { describe, it, expect, beforeEach } from 'vitest'
import {
  getShopCatalogBySlug,
  toggleProductAvailability,
  updateProductPrice,
  createCatalogProduct,
  deleteCatalogProduct,
  getLocalCatalogOverrides,
  saveLocalCatalogOverrides,
} from './catalog.service'
import {
  subscribeToCatalogEvents,
  broadcastTenantEvent,
  subscribeToTenantEvents,
} from './realtime.service'

describe('Catalog & Platform Admin Real-time Functionality', () => {
  beforeEach(() => {
    saveLocalCatalogOverrides({
      availability: {},
      prices: {},
      deletedProductIds: [],
      customProducts: [],
    })
  })

  it('updates product availability in real-time and reflects on catalog query', async () => {
    const initialCatalog = await getShopCatalogBySlug('samosa-corner', { includeUnavailable: true })
    const targetProd = initialCatalog?.products[0]
    expect(targetProd).toBeDefined()
    const targetId = targetProd!.id

    let broadcastReceived = false
    const unsubscribe = subscribeToCatalogEvents((payload) => {
      if (payload.eventType === 'PRODUCT_TOGGLED' && payload.productId === targetId) {
        broadcastReceived = true
        expect(payload.isAvailable).toBe(false)
      }
    })

    await toggleProductAvailability(targetId, false)
    expect(broadcastReceived).toBe(true)

    const overrides = getLocalCatalogOverrides()
    expect(overrides.availability[targetId]).toBe(false)

    // Load catalog and check that product is marked unavailable when including unavailables
    const catalog = await getShopCatalogBySlug('samosa-corner', { includeUnavailable: true })
    const prod = catalog?.products.find((p) => p.id === targetId)
    expect(prod?.isAvailable).toBe(false)

    unsubscribe()
  })

  it('updates product price in real-time and reflects on catalog query', async () => {
    const initialCatalog = await getShopCatalogBySlug('samosa-corner', { includeUnavailable: true })
    const targetProd = initialCatalog?.products[0]
    expect(targetProd).toBeDefined()
    const targetId = targetProd!.id
    const originalPrice = targetProd!.basePricePaisa

    let broadcastReceived = false
    const unsubscribe = subscribeToCatalogEvents((payload) => {
      if (
        payload.eventType === 'PRODUCT_PRICE_UPDATED' &&
        payload.productId === targetId &&
        payload.basePricePaisa === 4500
      ) {
        broadcastReceived = true
      }
    })

    await updateProductPrice(targetId, 4500)
    expect(broadcastReceived).toBe(true)

    const catalog = await getShopCatalogBySlug('samosa-corner', { includeUnavailable: true })
    const prod = catalog?.products.find((p) => p.id === targetId)
    expect(prod?.basePricePaisa).toBe(4500)

    // Restore original price so database catalog stays pristine
    await updateProductPrice(targetId, originalPrice)

    unsubscribe()
  })

  it('creates new product in real-time and adds to catalog', async () => {
    const initialCatalog = await getShopCatalogBySlug('samosa-corner', { includeUnavailable: true })
    const bizId = initialCatalog?.business.id
    const catId = initialCatalog?.categories[0]?.id || 'cat_01'

    let createdPayload: any = null
    const unsubscribe = subscribeToCatalogEvents((payload) => {
      if (payload.eventType === 'PRODUCT_CREATED') {
        createdPayload = payload.product
      }
    })

    const newProd = await createCatalogProduct({
      businessId: bizId,
      categoryId: catId,
      name: 'Paneer Bread Pakoda Special',
      description: 'Stuffed fresh paneer pakoda',
      basePricePaisa: 3000,
      isVeg: true,
    })

    expect(createdPayload).not.toBeNull()
    expect(createdPayload.name).toBe('Paneer Bread Pakoda Special')
    expect(newProd.name).toBe('Paneer Bread Pakoda Special')

    const catalog = await getShopCatalogBySlug('samosa-corner', { includeUnavailable: true })
    const found = catalog?.products.find((p) => p.id === newProd.id)
    expect(found).toBeDefined()
    expect(found?.basePricePaisa).toBe(3000)

    // Clean up created test product
    await deleteCatalogProduct(newProd.id)

    unsubscribe()
  })

  it('deletes product in real-time and removes from catalog query', async () => {
    // Create a temporary product to safely verify deletion without affecting authentic menu
    const tempProd = await createCatalogProduct({
      name: 'Temporary Deletion Test Item',
      description: 'Will be deleted in this test',
      basePricePaisa: 1500,
      isVeg: true,
    })
    const targetId = tempProd.id

    let deletedId: string | null = null
    const unsubscribe = subscribeToCatalogEvents((payload) => {
      if (payload.eventType === 'PRODUCT_DELETED' && payload.productId === targetId) {
        deletedId = payload.productId
      }
    })

    await deleteCatalogProduct(targetId)
    expect(deletedId).toBe(targetId)

    const catalog = await getShopCatalogBySlug('samosa-corner', { includeUnavailable: true })
    const found = catalog?.products.find((p) => p.id === targetId)
    expect(found).toBeUndefined()

    unsubscribe()
  })

  it('broadcasts tenant fleet updates in real-time', () => {
    let receivedTenantEvent: any = null
    const unsubscribe = subscribeToTenantEvents((payload) => {
      receivedTenantEvent = payload
    })

    broadcastTenantEvent({
      eventType: 'TENANT_STATUS_TOGGLED',
      tenantId: 'biz_samosa_corner_01',
      isActive: false,
    })

    expect(receivedTenantEvent).not.toBeNull()
    expect(receivedTenantEvent.eventType).toBe('TENANT_STATUS_TOGGLED')
    expect(receivedTenantEvent.tenantId).toBe('biz_samosa_corner_01')
    expect(receivedTenantEvent.isActive).toBe(false)

    unsubscribe()
  })
})
