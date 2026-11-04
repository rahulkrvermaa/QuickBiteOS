# QuickBite OS 🥟
> **Premium,Multi-Tenant Food Ordering, Payment, Pickup-Token & QSR Operations SaaS**

QuickBite OS is an all-in-one digital ordering and restaurant management platform engineered for food enterprises across India — ranging from single-stall street food vendors (samosa, kachori, and chai stalls) to multi-outlet quick service restaurants (QSRs), bakeries, and cafes.

---

## 🌟 Key Features

### 1. Frictionless Customer Experience (Zero-Install Web App)
- **Instant QR Code Ordering:** Customers scan a counter or table QR code to open the digital menu (`/shop/:slug`) with sub-1.5s load times on 4G networks.
- **No App Download or Account Required:** Customers add items to cart, enter their name and mobile number, and checkout immediately.
- **Cryptographic Order Tracking:** Live tracking page (`/order/:secureAccessToken`) featuring real-time status progression, estimated preparation countdown, and atomic pickup tokens (e.g. `#A001`, `#A002`).

### 2. Live Kitchen Display System (KDS)
- **High-Contrast Dark Kanban (`/kitchen`):** 3-stage kitchen board (**New / Placed**, **Preparing**, **Ready for Pickup**).
- **Web Audio Alert Chimes:** Synthesized audio chimes automatically sound whenever a new order is received or payment confirms.
- **Order Aging Indicators:** Visual time tags showing exact elapsed time per ticket to keep prep times fast.

### 3. Merchant & Cashier Operations Console
- **Cash Collection & Send to Kitchen:** 1-click cash counter verification that transitions cash orders to `PAID` and routes tickets directly to kitchen screens in real time.
- **Thermal KOT & Receipt Printing:** One-click ESC/POS printing for 58mm & 80mm Bluetooth/USB thermal printers, formatted with token headers, line items, and store address.
- **WhatsApp Pickup Ping:** One-click customer pickup notification deep-link via WhatsApp Web / App API when an order is marked `READY`.
- **End-of-Day (EOD) Z-Report:** Financial settlement calculation respecting the Indian QSR **4:00 AM IST cutoff rule**, summarizing cash vs. online UPI totals, GST collected, and top-selling items with CSV export.

### 4. Menu Catalog & Dynamic Pricing
- **Real-Time Sync:** Menu items marked out of stock or price-updated reflect across all customer devices and cashier consoles in real time without refreshing.
- **Item Management:** Add, edit, or delete catalog items with category navigation and vegetarian indicators.

### 5. Multi-Tenant Security & Integer Paisa Precision
- **PostgreSQL Row Level Security (RLS):** True multi-tenancy from Day 1. Every tenant's data is strictly isolated by `business_id` at the database level.
- **Server-Authoritative Integer Paisa:** Zero floating-point monetary bugs. All monetary amounts, taxes, and prices are strictly calculated in **integer paisa** ($1\text{ INR} = 100\text{ paisa}$).
- **Staff Authentication:** Email & password authentication powered by Supabase Auth protecting all administrative and kitchen routes with automatic route guards (`ProtectedRoute`).

---

## 🚀 Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, React Router 7 |
| **State Management** | Zustand (persistent cart), TanStack React Query |
| **Icons & UI** | Lucide React, JetBrains Mono & Plus Jakarta Sans typography |
| **Database & Auth** | Supabase PostgreSQL 17, Row Level Security (RLS), Realtime Broadcast |
| **Payment Gateway** | Razorpay (UPI, Credit/Debit Cards, NetBanking) with HMAC-SHA256 verification |
| **Testing & Quality** | Vitest (93 automated unit & regression tests), Oxlint |

---

## 🗺️ Application Routes

| Route | Access Level | Description |
| :--- | :---: | :--- |
| `/shop/:slug` | **Public** | Customer digital ordering menu (e.g. `/shop/samosa-corner`) |
| `/order/:secureAccessToken` | **Public** | Cryptographic customer order tracking & live pickup token |
| `/login` | **Public** | Staff and merchant authentication portal |
| `/dashboard` | **Protected** | Merchant analytics overview & performance stats |
| `/dashboard/orders` | **Protected** | Live Order Management Console & Cashier POS terminal |
| `/dashboard/menu` | **Protected** | Menu Catalog, Price Overrides & Stock Management |
| `/kitchen` | **Protected** | Dedicated Kitchen Display System (KDS) for kitchen tablets |
| `/platform-admin` | **Protected** | Fleet Management for multi-outlet platform administration |
| `/*` | **Public** | Custom "Lost in the Sauce" 404 Error Experience |

---

## 📦 Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later)
- npm (v9 or later)

### 2. Clone and Install
```bash
git clone https://github.com/rahulkrvermaa/QuickBiteOS.git
cd QuickBiteOS
npm install
```

### 3. Environment Variables
Copy the example environment configuration to `.env.local`:
```bash
cp .env.example .env.local
```

Configure your variables in `.env.local`:
```env
VITE_APP_NAME="QuickBite OS"
VITE_APP_URL="http://localhost:5173"

# Supabase Credentials (from your Supabase Project Settings -> API)
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-public-key"

# Razorpay Client ID
VITE_RAZORPAY_KEY_ID="rzp_test_..."
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧪 Testing & Code Quality

QuickBite OS includes a comprehensive automated test suite with **93 test cases** verifying pricing accuracy, cryptographic token isolation, sequence generation, RLS policies, and QSR operational tools:

```bash
# Run all automated tests
npm test

# Run code linter
npm run lint

# Build for production
npm run build
```

---

## 🗄️ Database Setup & Migrations

All sequential PostgreSQL migrations are located in [`supabase/migrations/`](./supabase/migrations):

1. **20261102000001_initial_schema.sql** — Core tables: businesses, branches, categories, products, orders, order items.
2. **20261102000002_row_level_security.sql** — PostgreSQL Row Level Security (RLS) policies.
3. **20261102000003_token_generation.sql** — Dynamic pickup token sequence (`#A001`, `#A002`, ...).
4. **20261102000004_seed_samosa_shop.sql** — Initial authentic catalog seed.
5. **20261102000005 - 20261102000011** — Payment hardening, token security, and cryptographic audits.
6. **20261102000012 - 20261102000017** — Realtime publications, admin RPCs, and multi-tenant policies.
7. **20261102000018_staff_auth_and_auto_confirm.sql** — Staff auth triggers, profile generation, and auto-confirmation.

> **One-Click Setup:** A consolidated master SQL script is also available at [`supabase/setup_complete.sql`](./supabase/setup_complete.sql).

---

## 🌐 Production Deployment

QuickBite OS is optimized for deployment on **Vercel**, **Netlify**, or **Cloudflare Pages**:

1. **Framework Preset:** Vite
2. **Build Command:** `npm run build`
3. **Output Directory:** `dist`
4. **Install Command:** `npm install`
5. **Environment Variables:** Set `VITE_APP_NAME`, `VITE_APP_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_RAZORPAY_KEY_ID` in your hosting dashboard.

---

## 🔒 Security Standards

- **Zero Secret Leakage:** `RAZORPAY_KEY_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are never exposed in frontend code.
- **Server Authoritative Pricing:** Product pricing is calculated server-side from database records before order creation; client price manipulation attempts are rejected.
- **Cryptographic Token Isolation:** Customer order data is strictly retrievable only via an unguessable 128-bit secure access token.
- **Idempotent Webhooks & Signatures:** Razorpay payment callbacks verify HMAC-SHA256 signatures before transitioning orders to `PAID` or releasing pickup tokens.

---

## 📄 License
This project is proprietary software developed for QuickBite OS commercial operations. All rights reserved.
