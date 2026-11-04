import type { Business, Branch, BusinessSettings, Category, Product } from '@/types/domain'

export const BENCHMARK_BUSINESS: Business = {
  id: 'biz_samosa_corner_01',
  name: 'Samosa Corner',
  slug: 'samosa-corner',
  tagline: 'Authentic Crispy Samosas, Khasta Kachoris & Kulhad Chai since 1998',
  phone: '+91 83209 17837',
  address: 'Maharajganj Main Rd, near by Sharamahala, Located in: Kali Mandir maharajganj',
  city: 'Jamui, Bihar 811307',
  isActive: true,
  currency: 'INR',
  createdAt: '2026-01-15T08:00:00Z',
}

export const BENCHMARK_BRANCH: Branch = {
  id: 'br_main_01',
  businessId: 'biz_samosa_corner_01',
  name: 'Jamui Flagship',
  code: 'MAIN',
  address: 'Maharajganj Main Rd, near by Sharamahala, Located in: Kali Mandir maharajganj, Jamui, Bihar 811307',
  phone: '+91 83209 17837',
  isPrimary: true,
  isActive: true,
}

export const BENCHMARK_SETTINGS: BusinessSettings = {
  businessId: 'biz_samosa_corner_01',
  allowCash: true,
  allowOnline: true,
  autoAcceptOrders: false,
  taxGstPercentage: 5,
  serviceChargePercentage: 0,
  orderPrefix: 'A',
  estimatedPrepMinutes: 10,
}

export const BENCHMARK_CATEGORIES: Category[] = [
  {
    id: 'cat_samosas',
    businessId: 'biz_samosa_corner_01',
    name: 'Hot Samosas',
    slug: 'hot-samosas',
    displayOrder: 1,
    isActive: true,
  },
  {
    id: 'cat_kachoris',
    businessId: 'biz_samosa_corner_01',
    name: 'Khasta Kachoris',
    slug: 'kachoris',
    displayOrder: 2,
    isActive: true,
  },
  {
    id: 'cat_chai',
    businessId: 'biz_samosa_corner_01',
    name: 'Kulhad Chai & Beverages',
    slug: 'chai-beverages',
    displayOrder: 3,
    isActive: true,
  },
  {
    id: 'cat_extras',
    businessId: 'biz_samosa_corner_01',
    name: 'Chutneys & Add-ons',
    slug: 'chutneys-extras',
    displayOrder: 4,
    isActive: true,
  },
]

export const BENCHMARK_PRODUCTS: Product[] = [
  {
    id: 'prod_aloo_samosa',
    businessId: 'biz_samosa_corner_01',
    categoryId: 'cat_samosas',
    name: 'Punjabi Aloo Samosa',
    description: 'Golden, crispy hand-rolled pastry stuffed with spiced potato, green peas, roasted cashews, and aromatic whole spices.',
    basePricePaisa: 2000, // ₹20
    isVeg: true,
    isAvailable: true,
    variants: [
      { id: 'var_samosa_single', productId: 'prod_aloo_samosa', name: 'Single (1 pc)', priceOverridePaisa: 2000, isDefault: true },
      { id: 'var_samosa_plate', productId: 'prod_aloo_samosa', name: 'Plate of 2 pcs', priceOverridePaisa: 3800, isDefault: false },
    ],
    addons: [
      { id: 'add_extra_saunth', productId: 'prod_aloo_samosa', name: 'Extra Saunth Sweet Chutney', pricePaisa: 500, maxQuantity: 3 },
      { id: 'add_extra_mint', productId: 'prod_aloo_samosa', name: 'Extra Spicy Mint Chutney', pricePaisa: 500, maxQuantity: 3 },
      { id: 'add_chole_dahi', productId: 'prod_aloo_samosa', name: 'Top with Chole Gravy & Curd', pricePaisa: 2500, maxQuantity: 1 },
    ],
  },
  {
    id: 'prod_paneer_samosa',
    businessId: 'biz_samosa_corner_01',
    categoryId: 'cat_samosas',
    name: 'Paneer Tikka Samosa',
    description: 'Stuffed with tender tandoori marinated paneer cubes, capsicum, and dry-roasted spices.',
    basePricePaisa: 3500, // ₹35
    isVeg: true,
    isAvailable: true,
    variants: [
      { id: 'var_paneer_single', productId: 'prod_paneer_samosa', name: 'Single (1 pc)', priceOverridePaisa: 3500, isDefault: true },
      { id: 'var_paneer_double', productId: 'prod_paneer_samosa', name: 'Plate of 2 pcs', priceOverridePaisa: 6500, isDefault: false },
    ],
    addons: [
      { id: 'add_extra_saunth_p', productId: 'prod_paneer_samosa', name: 'Extra Saunth Sweet Chutney', pricePaisa: 500, maxQuantity: 3 },
      { id: 'add_extra_mint_p', productId: 'prod_paneer_samosa', name: 'Extra Spicy Mint Chutney', pricePaisa: 500, maxQuantity: 3 },
    ],
  },
  {
    id: 'prod_moong_kachori',
    businessId: 'biz_samosa_corner_01',
    categoryId: 'cat_kachoris',
    name: 'Moong Dal Khasta Kachori',
    description: 'Flaky, puffed round pastry loaded with spiced yellow moong dal filling and served with signature hing-aloo gravy.',
    basePricePaisa: 2500, // ₹25
    isVeg: true,
    isAvailable: true,
    variants: [
      { id: 'var_kachori_single', productId: 'prod_moong_kachori', name: 'Single with Gravy', priceOverridePaisa: 2500, isDefault: true },
      { id: 'var_kachori_dahi', productId: 'prod_moong_kachori', name: 'Crushed Chaat (with Dahi & Sev)', priceOverridePaisa: 5000, isDefault: false },
    ],
    addons: [
      { id: 'add_extra_gravy', productId: 'prod_moong_kachori', name: 'Extra Aloo Gravy Bowl', pricePaisa: 1500, maxQuantity: 2 },
    ],
  },
  {
    id: 'prod_pyaaz_kachori',
    businessId: 'biz_samosa_corner_01',
    categoryId: 'cat_kachoris',
    name: 'Jodhpuri Pyaaz Kachori',
    description: 'Authentic Rajasthani large kachori stuffed with caramelised onions, fennel seeds, and secret Garam Masala.',
    basePricePaisa: 3000, // ₹30
    isVeg: true,
    isAvailable: true,
    variants: [],
    addons: [
      { id: 'add_pyaaz_saunth', productId: 'prod_pyaaz_kachori', name: 'Extra Saunth Chutney', pricePaisa: 500, maxQuantity: 2 },
    ],
  },
  {
    id: 'prod_kulhad_chai',
    businessId: 'biz_samosa_corner_01',
    categoryId: 'cat_chai',
    name: 'Kulhad Masala Chai',
    description: 'Freshly brewed full-cream milk tea boiled with crushed ginger, green cardamom, cloves, and premium Assam tea leaves.',
    basePricePaisa: 2000, // ₹20
    isVeg: true,
    isAvailable: true,
    variants: [
      { id: 'var_chai_regular', productId: 'prod_kulhad_chai', name: 'Regular Masala', priceOverridePaisa: 2000, isDefault: true },
      { id: 'var_chai_special', productId: 'prod_kulhad_chai', name: 'Extra Adrak & Elaichi', priceOverridePaisa: 2500, isDefault: false },
    ],
    addons: [],
  },
  {
    id: 'prod_sweet_lassi',
    businessId: 'biz_samosa_corner_01',
    categoryId: 'cat_chai',
    name: 'Amritsari Sweet Lassi',
    description: 'Thick, creamy churned yogurt topped with a dollop of fresh malai and crushed pistachios.',
    basePricePaisa: 4000, // ₹40
    isVeg: true,
    isAvailable: true,
    variants: [],
    addons: [],
  },
]

