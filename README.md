# Food Ordering Template

A **free, open-source**, self-host QR-based food ordering system for **any
restaurant**. Customers scan a table QR code to browse the menu, add items to a
cart, and place orders — all from their phone. Kitchen staff see orders in real
time on a Kanban-style dashboard.

The **entire codebase is free** — clone it, self-host it, and run it yourself at
no cost. If you'd rather not manage servers, databases, and deployments, we offer
optional managed hosting (see **[Managed Hosting & Support](#managed-hosting--support)** below).

**One deploy = one restaurant.** After deploying, you configure everything — app
name, currency, languages, theme, and logo — from the admin console at runtime.
No rebuilds, no code changes, no env-var juggling. See
[Getting Started](#getting-started) and [Deployment](#deployment) below.

Built for the **MY / SG / TH / VN** markets out of the box (Ringgit, Singapore
dollar, Baht, and zero-decimal Dong all supported), defaulting to English + MYR.

## Who this is for

Small, single-location F&B — hawker stalls, kopitiams, cafés, and casual eateries
across MY/SG/TH/VN — that are typically **below service-tax registration
thresholds**. The system deliberately does **not** compute service tax
(SST/GST/VAT) or service charge on the bill. Instead, **Reports give you and your
accountant clean, exportable transaction records** — you keep the record, you (or
your accountant) file the tax. The system gives you the *input* to compliance
without taking on the *act* of compliance.

If you're a tax-registered, sit-down restaurant that needs on-bill tax
computation and e-invoicing, this template isn't aimed at you.

## Features

**Customer**
- **Home page** with step-by-step "How to Order" guide and built-in QR scanner (camera-based, via `html5-qrcode`)
- Scan QR code to start a session at a table
- Browse menu with categories, images, and multi-language support; consistent card layout with or without images; **"Recommended" section** highlights featured items at the top of the menu
- **Combo meals** — bundled items with option groups for choices (e.g., "Choose drink"); fixed combo price or base price + adjustments; displayed as single line items in cart and kitchen
- **Menu item options** — customize orders with option groups (spice level, noodle type, size, extras); bottom sheet modal for selection; single-choice (radio) and multi-choice (checkbox) with optional price adjustments; required options enforced before adding to cart
- Add items to a per-device database-backed cart (each device on the same table has its own cart; orders are shared); same item with different options stored as separate cart rows; selected options displayed in cart with price adjustments
- Cart warns when items become unavailable (red badge, dimmed row, Place Order disabled until removed)
- Place orders with idempotency protection
- Track order status in real time via short polling
- View checkout summary with payment QR
- **Per-market animated food background** — the landing page and admin shell show a slideshow of the deployment's own cuisine, chosen by the configured currency (THB→Thai, MYR→Malaysian, SGD→Singaporean, VND→Vietnamese; unknown→Malaysian). Images are optimized WebP (~150–300 KB each); only the active market's set loads
- Floating back-to-top button appears after scrolling, for long menus

**Admin / Kitchen**
- Real-time order dashboard (Kanban: Pending → Confirmed), orders grouped by table, with browser notifications for new orders (click notification to open order detail modal)
- **New-order sound alert** — an audible chime when a new order arrives, configured per-device in Settings → Notifications (each kitchen tablet/phone/computer has its own setting, stored in the browser). Choose from three sounds (service bell, marimba, doorbell), set volume, and "alert even when the device is muted" (so a silenced kitchen tablet still rings). Works on phones and tablets where OS notifications can't — the page itself plays the sound, so it reaches Android Chrome / iPad Safari while the dashboard is open. Per browser autoplay rules, staff tap once to enable sound after loading the dashboard. Sounds are royalty-free (CC0) and bundled in `public/sounds/`
- **Order detail modal** — click any table group to view full order details, edit item quantities inline, confirm or decline individual orders, confirm all pending orders (auto-closes on last confirm/decline), checkout via separate action
- **Staff-assisted ordering** — a second way to place an order, for customers who'd rather not scan. A staff member opens **Place Order** in the admin console, keys in the table number, builds the order from the same menu (with the same options, combos, and pricing customers see), and confirms it on the customer's behalf — the customer only has to say which table they're at. The order then behaves exactly like a self-placed one: it appears on the kitchen dashboard, settles at checkout, and shows in reports identically. If the table has no open session yet, one is created automatically. Uses the **orders** permission (the same staff who run the kitchen board), so no extra setup. There are thus two ordering paths: (1) customer scans the QR and self-orders, or (2) staff key in the table and order for them
- Place orders with idempotency protection (both ordering paths)
- **AI Menu Import** (optional, needs `OPENROUTER_API_KEY`) — upload photos of a physical menu, vision AI (Qwen3.5 Flash) extracts items with names, prices, categories, and option groups (spice level, noodle type, etc.); prefers assigning to existing categories over creating new ones; detects "Market Price" items (blue indicator, admin sets price before saving); auto-detects duplicate items against existing menu by matching on the printed source-language name across all locales (source-anchored, not English-only; orange highlight, auto-deselected); translates all names including option groups/choices to all enabled locales via DeepSeek V4 Flash with xhigh-effort reasoning (fallback: GPT-4o-mini), anchored on the deployment's source language so a Thai/Malay/Vietnamese/Chinese-first menu translates from that language rather than English; well-known SEA dishes get consistent canonical names via a built-in glossary; proper noun preservation for dish names (Pad Thai, Tom Yum stay transliterated, not literally translated); batch saves with full option group support
- Menu & category management with image uploads and translations, grid/list view toggle, field sorting (name, price, availability, date), and multi-select with bulk delete/availability toggle; delete operations guarded against active carts and pending orders (409 with clear message); option group changes auto-clear stale cart entries; quick-toggle featured status from the menu list; combo meal configuration with base price
- **Option group editor** — admin menu item form includes collapsible option groups section; per-group: multi-locale name translations, single/multiple selection type, required/optional toggle; per-choice: multi-locale names + price adjustment; delete-and-recreate strategy on update for simplicity
- Table management with batch creation (single number or range, e.g. `1-10`) and secure QR code generation
- User management with role-based access (Superadmin / Admin) and granular permissions (menu, tables, reports, orders)
- Reporting dashboard with tabbed interface: **Analytics** tab with at-a-glance answers — completed-orders / revenue / items-per-order cards each with a ▲/▼ change vs the previous equal period; highlight cards for top item, busiest hours (with a second "also busy" window for lunch+dinner businesses, or "steady all day" when flat), and top category; a **Top Items** ranking with revenue-share % and a Pareto headline ("top N items = X% of sales"); **Frequently Ordered Together** stated as an attach-rate sentence ("80% of X orders also get Y", lift-filtered so a ubiquitous drink doesn't dominate); a **Slow / Dead Items** list (zero-sellers flagged) for the cut decision; a category-revenue **horizontal bar** breakdown; and an **Orders by Time of Day** chart that collapses multi-day ranges onto a 24-hour clock profile (toggle between orders / items / revenue per hour) with the peak window highlighted; **Order History** tab with orders visually grouped by session (shared card with table number, order count, session total), status filter pills, expandable item lists with option details, the database Order ID shown alongside the per-session number (so the screen cross-references the export), and client-side pagination on session groups; both tabs share a time-range selector (presets or a custom from–to range, 90-day cap); analytics revenue is calculated from completed orders only. The **Analytics tab is on-screen only** — its numbers are for running the business, not filing tax. **Order-history Excel/CSV export** (on the Order History tab) is the single download for records backup and accountant hand-off: the raw, one-row-per-sale transaction trail an auditor reconciles from, with a sortable `YYYY-MM-DD` date column (alongside the human timestamp) for month pivots/filters, plus selected options and session IDs; truncation is flagged loudly and rows are oldest-first. All export content (sheet names, headers, labels) is translated to the active locale; currency renders via the deployment's configured currency (values show the symbol, labels show the ISO code). A standing notice on the Reports page reminds the owner that records older than 90 days are pruned and to download the export at the end of every month, keeping the files for the yearly audit/tax filing. The system records sales but does **not** compute service tax or service charge (see [Who this is for](#who-this-is-for))
- **Checkout Scanner** — scan customer QR code via camera to view order details with full management (inline quantity editing, confirm/decline individual orders, confirm all, checkout) — shows selected options with price adjustments, same capabilities as the dashboard order modal; a **Close Table** action force-closes a session that can't be settled (walkout, or every order declined) — it cancels (declines) any unpaid orders in the same transaction and frees the table, with a confirm dialog stating how many orders will be cancelled; scanner access requires the `orders` permission
- Centralized money formatting (`Intl.NumberFormat`) — correct symbol, grouping, and currency-aware decimal count (2 for THB/MYR/SGD, **0 for VND**) across all customer and admin screens
- Session checkout and auto-expiry cleanup
- Cloudflare Turnstile (managed CAPTCHA) on admin login when configured — locale-aware; when unconfigured, login still works and admins see a banner noting bot protection is off
- Password visibility toggle on all password fields
- Self-service password change with 3-second logout countdown and same-password prevention
- Superadmin password reset for other admin accounts (forces immediate re-login via tokenVersion)
- Deactivated account detection with specific error message
- Collapsible sidebar with content area that follows collapse state; displays logged-in username
- Immutable usernames — cannot be changed after account creation (enforced at API and UI levels)
- Self-edit protection: no action buttons on own user record; superadmins cannot modify themselves
- Reusable paginated listings for tables, users, and menu items
- Responsive layout across mobile (320px+), tablet, and desktop (portrait + landscape) — icons-only bottom nav on mobile with overflow "More" menu for 5+ items, expandable category dropdown on mobile menu management, auto-collapsing sidebar on tablet when modals open, card-based layouts replacing horizontal scroll tables (including AI menu import review); responsive padding/spacing, font scaling, and flex-wrap on all headers, toolbars, and card layouts
- WCAG-compliant touch targets (44px+ minimum on all interactive elements), focus-visible keyboard states, and WCAG AA color contrast across all admin and customer screens; modals use safe max-height with overflow scrolling for small viewports
- Accessible modals with `role="dialog"`, `aria-modal`, `aria-labelledby`, and Escape key dismiss
- **Maintenance Mode** — Superadmin toggle on dashboard with password confirmation; blocks all customer pages (full-screen maintenance screen) and customer APIs (503); amber banner visible to all admins when active
- **First-run setup wizard** — a fresh deploy bootstraps the first SUPERADMIN and core config (restaurant name, currency, main language, enabled languages, theme) through an in-app wizard at `/admin/setup` — no default credentials in production. The wizard confirms before finishing that **currency and main language are permanent** (they anchor stored sales records and can't be changed afterward)
- **Per-language restaurant name** — give your restaurant a name in each enabled language (e.g. "Sunrise Cafe" / "日出咖啡"); customers see it in their own language, falling back to your main-language name. Set at setup and editable anytime in settings
- **Runtime branding & config** — restaurant name (per-language), enabled languages, display language, theme (3 presets + custom color), and logo are all edited live at `/admin/settings` (SUPERADMIN-only). **Currency and main language are set once at setup and locked** (they determine money precision and the language your sales records are stored in)
- **Menu backup & restore** — Superadmins can download the entire menu (categories, items, options, and all translations) as a JSON file from Settings, and restore it later to roll back a bad edit. Restore is a full replace and affects the menu only — past orders and reports are never touched
- Obscured admin URL (`/admin/`)

**Internationalization**
- 6 locales: English, Thai, Vietnamese, Chinese Simplified, Chinese Traditional, Malay — covering the MY / SG / TH / VN markets
- Default display language, enabled-language subset, and currency are all set in the admin console (runtime); the URL-root locale is the one edge knob (`NEXT_PUBLIC_DEFAULT_LOCALE`, default `en`)
- Locale preference persisted via cookie (1-year expiry); unprefixed URLs redirect to saved locale
- Locale-aware navigation across login, logout, and checkout flows
- Flag-free locale switcher modal (avoids political sensitivity); shows only the enabled subset
- Database-backed translations for menu items and categories
- Locale-aware item names across all admin views (orders, reports, exports)
- UI translations via JSON message files — no hardcoded English strings in user-facing components
- Locale-aware page titles via `generateMetadata()` with `next-intl/server`

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, standalone output) |
| Language | TypeScript (strict) |
| Database | MySQL 8 via Prisma 7 + MariaDB adapter |
| Auth | Auth.js v5 (credentials, JWT, bcrypt) + optional Cloudflare Turnstile |
| i18n | next-intl v4 |
| Real-time | Short polling (10-15s intervals) |
| Images | Cloudflare R2 (presigned URL uploads, optional) |
| Styling | Tailwind CSS v4, runtime-themeable primary color |
| QR Codes | qrcode (generation) + html5-qrcode (scanning) + HMAC-SHA256 signed tokens |
| AI | OpenRouter (optional — Qwen3.5 Flash vision; DeepSeek V4 Flash translation with xhigh reasoning → GPT-4o-mini fallback) |
| Testing | Vitest (unit), Playwright (E2E) |
| Deploy | Docker (standalone) + optional Cloudflare R2 |

## Getting Started

### Prerequisites

- Node.js 20+
- MySQL 8 database
- (Optional) Cloudflare R2 bucket for menu images, Cloudflare Turnstile keys, OpenRouter API key

### Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, AUTH_TRUST_HOST, QR_SECRET,
# CRON_SECRET. Integration keys (R2, Turnstile, OpenRouter) are optional — leave
# them empty to disable those features.

# Run database migrations
npx prisma migrate deploy

# (Local dev only) seed two dev SUPERADMIN accounts — see "First admin" below
npx prisma db seed

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

### First admin

There are **two paths** to the first admin account:

**Production — first-run setup wizard (recommended):**
Deploy with the `SEED_*` passwords **unset**. Visit `/admin`; with no admin
present you are redirected to `/admin/setup`, where you self-register the first
SUPERADMIN and pick the app name, currency, languages, and theme. After that,
`/admin/setup` locks (redirects to login; the setup API returns 403). No default
credentials ship in production.

**Local development — dev seed:**
Set either (or both) seed password var in `.env`, then run `npx prisma db seed`.
Each var that has a value seeds its own SUPERADMIN for instant local login:

| Username | Password env var | Seeded when |
|---|---|---|
| `superadminxyz` | `SEED_SUPERADMIN_PASSWORD` | `SEED_SUPERADMIN_PASSWORD` has a value |
| `devxyz` | `SEED_DEV_PASSWORD` | `SEED_DEV_PASSWORD` has a value |

Each `SEED_*` password must meet the same policy as the setup wizard and the
user-management form — **8–16 characters with at least one uppercase letter, one
lowercase letter, and one digit**. A value that breaks this aborts the seed (it
exits with an error and writes nothing) rather than creating a weaker-than-policy
admin.

The two are independent. Leave **both** unset (the production default) and no admin
is seeded, so the first visitor to `/admin` registers the first admin through the
setup wizard.

Seeded accounts are marked as **seed accounts** and do **not** count toward the
first-run gate — so you can seed a developer/support login (e.g. `devxyz`) and the
customer still sees the `/admin/setup` wizard to create their **own** first admin.
The seed login keeps working alongside the customer's admin; it stops counting only
for the purpose of deciding whether the wizard is still open.

### Managing staff (user management)

After the first SUPERADMIN logs in, manage staff accounts at **`/admin/users`**
(SUPERADMIN-only): create, edit, and deactivate ADMIN users and assign granular
permissions (`menu`, `tables`, `reports`, `orders`). SUPERADMIN bypasses all
permission checks; the Users page and its API are both gated to SUPERADMIN.

## Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
npm run test         # Unit tests (Vitest)
npm run test:watch   # Unit tests in watch mode
npm run test:e2e     # E2E tests (Playwright, requires running DB)
npm run test:e2e:ui  # E2E tests with UI
```

## Configuration model

This template moves all per-restaurant config out of build-time env vars and into
**runtime database settings** that you edit in the admin console — so you can
rebrand, change currency, or add a language without a redeploy.

### Configure in the admin console

| Setting | Where | Notes |
|---|---|---|
| App name | `/admin/setup` (first run), `/admin/settings` | Shown in sidebar, login, page titles, exports |
| Currency | `/admin/settings` | MYR / SGD / THB / VND (any ISO 4217). Drives money display + decimal count + timezone |
| Default + enabled languages | `/admin/settings` | Subset of the 6 locales; default display language and which appear in the switcher |
| Theme | `/admin/settings` | Green / terracotta / indigo / amber presets, or a custom primary color |
| Logo | `/admin/settings` | Uploaded via R2 (if configured) |

Currency drives the display timezone automatically — **THB** → Asia/Bangkok
(UTC+7), **MYR** → Asia/Kuala_Lumpur (UTC+8), **SGD** → Asia/Singapore (UTC+8),
**VND** → Asia/Ho_Chi_Minh (UTC+7), any other code → Asia/Bangkok. There is no
separate timezone setting. VND is zero-decimal: prices render without `.00`
(e.g. `₫50,000`).

Price **values** render with the currency symbol via `Intl.NumberFormat`
(e.g. `RM12.00`); report/column **labels** (table headers, field labels, Excel
export headers) render the ISO code (e.g. `MYR`).

### Environment Variables

Only secrets and one edge knob are env-driven. See [`.env.example`](.env.example)
for the full template.

| Variable | Description |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `NEXTAUTH_SECRET` | Auth.js JWT signing secret |
| `NEXTAUTH_URL` | App public URL |
| `AUTH_TRUST_HOST` | `true` behind a reverse proxy |
| `QR_SECRET` | HMAC secret for QR token signing |
| `CRON_SECRET` | Bearer token for cron cleanup endpoint (shared with cron service) |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | URL-root locale at the edge (default `en`). **All other config is in the admin console**, not env |

**Optional integrations** (leave empty to disable — the feature's UI hides and its
server checks are skipped; flags in `src/lib/integrations.ts`):

| Variable | Feature |
|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Menu image uploads (Cloudflare R2) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Login CAPTCHA (Cloudflare Turnstile) |
| `OPENROUTER_API_KEY` | AI menu import + auto-translation (OpenRouter) |

#### Local development only

These gate the dev-admin seed and must be **unset in production** (production uses
the setup wizard instead):

| Variable | Description |
|---|---|
| `SEED_SUPERADMIN_PASSWORD` | When set, `npx prisma db seed` seeds the `superadminxyz` SUPERADMIN. Both seed vars unset (the prod default) → no admin seeded, so the setup wizard handles the first admin |
| `SEED_DEV_PASSWORD` | When set, `npx prisma db seed` seeds the `devxyz` SUPERADMIN (independent of `SEED_SUPERADMIN_PASSWORD`) |

### Onboarding a new restaurant (Day 1 runbook)

After the deploy is live and you've completed the [first-run setup
wizard](#first-admin), the restaurant's own data — tables,
menu, staff — is created **through the admin UI**, not seeded. There is no fake
demo data by design. All admin screens live under **`/admin/`**.

1. **Log in** at `/admin/login` (the SUPERADMIN you created in the wizard).
2. **Create staff accounts** — `/admin/users`. Add an ADMIN per staff member and
   assign only the permissions they need (`menu`, `tables`, `reports`, `orders`;
   SUPERADMIN bypasses all checks). Kitchen staff typically need `orders` only.
3. **Create the menu** — `/admin/menu-management`:
   - Add **categories** first (e.g. Starters, Mains, Drinks), then **menu items** under each.
   - Author each name/description in the **default locale**; the other enabled locales are filled by the translation pass (or the AI import below). Set `price` in the deployment currency.
   - Use **option groups** for choices (spice level, add-ons) and mark combos with a `comboBasePrice`. Toggle **Featured** to surface an item in the customer "Recommended" row.
   - **AI menu import** (when `OPENROUTER_API_KEY` is set) can extract items from a photo of an existing menu and auto-translate them.
4. **Create tables** — `/admin/tables`. Add one entry per physical table (by
   number). Each table gets a **signed QR token**; generate and **print the QR
   sticker** and place it on the table. (QR tokens are HMAC-signed with
   `QR_SECRET` — never hand-edit them.)
5. **Smoke test the customer flow** — scan a printed table QR on a phone → browse
   menu → add to cart → place an order → confirm it appears on the kitchen
   **Dashboard** (`/admin/dashboard`, polls every 10s).
6. **Settle a test bill** — open the customer **checkout** page, then scan its QR
   from `/admin/checkout-scanner` to verify settlement marks orders COMPLETED and
   the session CHECKED_OUT.
7. **Confirm reporting** — `/admin/reports` should show the test order; verify
   timestamps are in the restaurant's local timezone (derived from currency) and
   amounts in the deployment currency.

Day-to-day: staff watch the Dashboard for incoming orders, confirm/decline them,
and scan the table's checkout QR to settle. The cron job auto-expires stale
sessions (4h) and prunes old orders — **completed (settled) orders are kept 90
days** for record-keeping, everything else 30 days — see [Deployment](#deployment) below.

## Project Structure

```
src/
├── app/
│   ├── [locale]/
│   │   ├── (customer)/       # Customer routes: table, menu, cart, checkout
│   │   ├── admin/setup/      # First-run setup wizard (no auth)
│   │   └── admin/(admin)/    # Admin routes: login, dashboard, menu-management,
│   │                         #   tables, users, reports, checkout-scanner, settings
│   └── api/                  # REST API routes
├── components/
│   ├── admin/                # Dashboard, forms, order board, scanner, setup wizard, settings form
│   ├── cart/                 # Cart sheet, badge, items
│   ├── checkout/             # QR display, order summary
│   ├── layout/               # Sidebar, mobile nav, locale switcher, background slideshows
│   ├── menu/                 # Category tabs, menu grid/cards
│   ├── providers/            # ConfigProvider (runtime display config to client)
│   └── ui/                   # Image upload, pagination
├── hooks/                    # useCart
├── i18n/                     # next-intl config + message files (6 locales)
└── lib/                      # auth, prisma, r2, qr, session, turnstile, integrations,
                              #   settings, app-name, themes, money, money-client, date,
                              #   place-order, order-utils, menu-backup, menu-extraction,
                              #   openrouter, dish-glossary, report-utils, order-alert-prefs,
                              #   permissions, validations, first-admin, rate-limit, …
public/
└── images/backgrounds/       # Background slideshow images
prisma/
├── schema.prisma             # Database schema
├── seed.ts                   # Seed: per-var dev admins (superadminxyz/devxyz) if SEED_* set, else wizard; always settings defaults
└── migrations/               # SQL migrations
tests/
├── unit/                     # Vitest: password validation, QR tokens, order transitions/money, settings, themes
└── e2e/                      # Playwright: login, menu management, ordering
```

## Deployment

This is a **self-host** template: build the `Dockerfile` and run it on any host
that can reach a MySQL 8 database. A deploy is three pieces — the **app**
container, a **MySQL 8** database, and a small **cron** container
(`Dockerfile.cron`) that hits the cleanup endpoint on a schedule. Key facts:

- Database **migrations run automatically on boot** (`prisma migrate deploy`) —
  no manual migration step in production.
- The first admin is created via the **`/admin/setup` wizard**, not a seed (see
  [First admin](#first-admin)). No default credentials ship in production.
- Set the required env vars on the **app** service (see
  [Environment Variables](#environment-variables)); leave optional integration
  keys empty to disable those features.
- The **cron** container needs its own two env vars set **on the cron service**:
  `APP_URL` (the app URL it calls — use the **`https://`** scheme; an `http://`
  URL that redirects will be silently skipped) and `CRON_SECRET` (Bearer token —
  must exactly match the app service's `CRON_SECRET`). It `POST`s
  `/api/cron/cleanup` daily to expire stale sessions (4h) and prune old orders
  (completed/settled orders kept 90 days, all other statuses 30 days). Any
  scheduler works:

  ```bash
  curl -X POST https://your-app.example.com/api/cron/cleanup \
    -H "Authorization: Bearer $CRON_SECRET"
  ```

- Run the app **process in UTC** (timestamps are stored in UTC; display timezone
  is derived from the configured currency). Don't set a non-UTC `TZ` on the
  container.
- **Run a single app instance** (one replica). The template is built for the
  "one deploy = one restaurant" model and keeps its login/order rate limits, the
  order idempotency guard, and the JWT-validation cache in **per-process memory**
  (no Redis dependency — deliberately, so the instance can idle cheaply). The
  no-double-order guarantee is enforced at the **database** level (the order
  transaction atomically claims the cart), so it holds regardless. But behind a
  load balancer across **N** app replicas those per-process limits become
  effectively N× looser (e.g. 5 → 5×N login attempts/window) and the idempotency
  cache no longer shared. If you genuinely need to scale out, move the rate-limit
  / idempotency / JWT-cache stores to a shared backend (e.g. Redis) first; for a
  single restaurant, one instance is the intended — and sufficient — setup.

### Local Docker

```bash
docker build -t food-ordering .
docker run -p 3000:3000 --env-file .env food-ordering
```

## Architecture

- **Per-device database-backed cart** — each device gets its own cart (scoped by `device_id` cookie), while orders are shared across all devices on the same table
- **Runtime DB-backed config** — app name, currency, languages, theme, and logo live in the `SystemSetting` table, resolved per request (`getSettings()`, 10s cache) and delivered to client components via a React `ConfigProvider`; no rebuild needed to change them
- **Short polling** (10-15s intervals) for real-time kitchen and customer updates — no persistent connections, lets the host idle between requests
- **HMAC-signed QR tokens** to prevent table spoofing
- **Atomic cart-claim** on order placement to prevent duplicate orders under concurrency (a double-tapped "Place Order" creates exactly one order); in-memory idempotency keys are a secondary guard for retries
- **Race-safe first-admin setup** — `POST /api/admin/setup` counts users inside a transaction and proceeds only when zero exist, so two concurrent wizard submits can't both create a "first admin"; once any admin exists the endpoint returns 403
- **Capability-gated integrations** — R2 image upload, Turnstile CAPTCHA, and OpenRouter AI import are each enabled only when their env vars are present; when absent, their UI is hidden and server checks are skipped (`src/lib/integrations.ts`)
- **Translation tables** (not JSON columns) for categories and menu items
- **Price & name snapshots** at order time — price changes don't affect past orders, and each order line stores the dish name (`OrderItem.itemName`, canonical locale) so receipts and reports survive a later menu delete; display prefers the live locale-matched name (each viewer sees their own language) with the snapshot as the delete/missing-translation fallback
- **Currency-aware money** — decimal count derived from the currency (2 for THB/MYR/SGD, 0 for VND), so zero-decimal currencies never render `.00` or round to fractional units
- **Session auto-expiry** after 4 hours of inactivity — a true inactivity timer: add-to-cart and order placement bump the session's `updatedAt`, so an actively-ordering party isn't locked out mid-meal. Enforced inline via `isSessionExpired()` on every customer page load and API call (immediate), with daily cron as DB cleanup; the cron also declines any still-open orders on sessions it expires (an unsettled session's orders can never complete), and staff can still settle an idle-but-ACTIVE table via the checkout scanner before the sweep — the inactivity timer guards customer endpoints, not admin settlement
- **Concurrency-safe order placement & checkout** — order placement atomically *claims* the cart (`deleteMany` by id, proceed only if `count > 0`) so a double-tapped "Place Order" creates exactly one order; placement and checkout both lock the session row `FOR UPDATE` so a last-second order can't strand on a just-checked-out session; admin item-edits lock the order row and recompute the total from a fresh in-transaction read
- **Menu item options** — `OptionGroup` / `OptionChoice` models with translation tables; single/multiple selection types; optional price adjustments per choice; options snapshotted as JSON in `OrderItem.selectedOptions` at order time as a **per-locale name map** across the enabled locales, so each viewer reads the option notes in their own language (old single-string snapshots still render verbatim — no migration); displayed across cart, checkout, kitchen dashboard, order history, and Excel exports (exports follow the requested `?locale`)
- **Combos & featured items** — menu items flagged as `isCombo` use option groups for bundled choices with optional `comboBasePrice` for fixed pricing; `isFeatured` items appear in a "Recommended" section at the top of the customer menu and in their normal category; menu cards show "From <price>" (in the deployment's currency) when option groups have price adjustments > 0
- **AI-powered menu import** (optional) — Vision model (Qwen3.5 Flash) extracts items with names, prices, categories, and option groups from menu photos; text model (DeepSeek V4 Flash with xhigh reasoning, fallback: GPT-4o-mini) translates item names, category names, and option group/choice names to all enabled locales with proper-noun preservation, anchored on the deployment's source language (a Thai/Malay/Vietnamese/Chinese-first menu translates from that language, not English) and using a built-in glossary so well-known SEA dishes get consistent canonical names; prefers existing categories; detects duplicates against current menu (source-language-anchored — merges duplicates across all locale names, flags price conflicts); handles "Market Price" items; currency-aware price parsing (incl. zero-decimal VND); an anti-repetition prompt plus a dedup/cap backstop guard against runaway extraction. The text translation chain pins each model's provider with `allow_fallbacks: false`
- **Polling-based real-time** — admin order board polls every 10s, customer order status polls every 10s; cart badge updates instantly via `cart-updated` DOM events + polls every 10s for cross-device sync (paused on `/checkout`, where the order-status poll already runs); eliminates persistent connections so the host can idle between requests
- **Checkout guard** — checkout only allowed when all non-declined orders are confirmed and at least one confirmed order exists; grand total computed from all non-declined orders (includes pending, confirmed, and completed); prevents accidentally completing pending orders or checking out with a zero total
- **Granular permissions** — Superadmin assigns menu/tables/reports/orders access per admin user; enforced at page, sidebar, and API levels
- **Token versioning** — password changes increment a `tokenVersion` counter; JWT callback checks it on every request, forcing re-login when mismatched
- **Maintenance mode** — `SystemSetting` key-value table stores maintenance state; customer layout and API routes check via `isMaintenanceMode()` helper; Superadmin toggles with password confirmation
- **Active cart protection** — admin menu/category deletion blocked with 409 when items are in active carts or pending orders; option group modifications auto-clear stale cart items; cart UI shows "Unavailable" badge and disables ordering when items become unavailable; `OrderItem.menuItemId` is nullable with `ON DELETE SET NULL` so completed/declined orders don't block menu cleanup

## Performance

- **Locale-filtered translations** — customer menu page and order paths fetch only the locales actually rendered, never all 6 (~75% fewer translation rows): the menu page and customer-facing order reads (checkout page, order-status poll) use the requested locale + canonical-locale fallback, while order placement scopes to the canonical-locale snapshot only (canonical locale is an admin setting); resolves locale fallback in-memory (eliminates N+1 queries). Avoids hydrating a large translation object graph into the heap on every order — previously the main driver of RSS growth on order placement
- **Parallel translation upserts** — menu and category updates run all locale upserts concurrently via `Promise.all` instead of sequential loops
- **Parallel database queries** — reports fetch current and previous period data concurrently via `Promise.all`
- **Composite database indexes** — `Order(status, createdAt)`, `Session(status, updatedAt)`, `Category(isActive)`, and `MenuItem(isAvailable)` indexes optimize dashboard, report, menu, and cron queries
- **Bounded query results** — admin orders (200) and dashboard (500) capped to prevent unbounded memory usage; reports and exports are naturally bounded by the order retention policy (completed orders 90 days, other statuses 30 days) and a row cap (order-history export 15,000 rows; analytics dashboard 10,000)
- **Parallel bulk operations** — "Confirm All", bulk delete, and bulk availability toggle use `Promise.allSettled` for concurrent execution
- **Dynamic imports** — `qrcode` and `exceljs` libraries loaded on-demand to reduce initial bundle/cold-start size
- **Memoized computations** — cart totals, order board groupings, and menu sort keys wrapped in `useMemo`; `MenuCard` wrapped in `React.memo`
- **Lightweight polling** — short-lived HTTP requests (10s intervals) for cross-user updates (orders); same-tab updates (cart badge) use DOM events for instant feedback; no persistent connections or heartbeats needed
- **Memory-safe stores** — rate limiter (10K cap) and idempotency store (1K cap with LRU eviction) include safety valves against unbounded growth; all module-level in-memory stores are `globalThis`-guarded so dev HMR reloads don't orphan the previous module's Map
- **Batched table creation** — uses `$transaction` for atomic multi-table inserts instead of sequential creates
- **In-memory menu cache** — menu page category data cached server-side with 60s TTL (keyed by locale); automatically invalidated on admin menu/category/settings edits
- **API caching** — menu and categories endpoints return `Cache-Control` headers for CDN edge caching
- **Cached maintenance mode + settings** — in-memory caches with 10s TTL avoid a DB query on every customer request
- **Cached JWT validation** — auth callback caches `isActive`/`tokenVersion` checks for 30s to reduce per-request DB hits
- **Optimized checkout transaction** — minimal `select` during validation; full relation fetch only after commit for response serialization
- **Prioritized image loading** — first 4 menu items use `priority` for faster LCP; remaining items lazy-load on scroll
- **Streamed Excel export** — report exports stream via PassThrough instead of buffering entire file in RAM
- **Optimistic cart updates** — cart POST merges returned item into local state instead of refetching entire cart
- **Unoptimized images** — server-side image optimization disabled (`images.unoptimized: true`); images served directly from Cloudflare R2 to eliminate Next.js in-memory image cache (saves 100-300MB+ RAM)
- **Lazy page module loading** — `preloadEntriesOnStart: false` defers page JS loading until first request, reducing cold-start memory footprint
- **No production source maps** — `productionBrowserSourceMaps: false` and `serverSourceMaps: false` reduce memory by skipping source map generation
- **Lean DB connection pool** — `connectionLimit: 5`, `minimumIdle: 0`, `idleTimeout: 60s` ensures idle connections close quickly, enabling serverless sleep on hosts that support it
- **Serverless sleep–friendly** — short-lived requests and quickly-closing idle connections let serverless hosts sleep when there's no traffic (zero compute cost while idle); `NEXT_TELEMETRY_DISABLED=1` (set in the Dockerfile) prevents telemetry from blocking sleep
- **Lazy background slideshow** — only active and next slides rendered in DOM instead of all images

## Security

- **Timing-safe token verification** — QR token signatures compared with `crypto.timingSafeEqual` to prevent timing attacks
- **No hardcoded secrets or branding** — `QR_SECRET` is required; the app name is a runtime DB setting (no hardcoded restaurant name in source)
- **Race-safe first-admin creation** — the setup endpoint serializes concurrent submits in a transaction; once any admin exists it 403s
- **Login rate limiting** — IP-based rate limiter (5 attempts per 15 minutes) on the login pre-check endpoint
- **No account enumeration** — deactivated accounts return the same error as invalid credentials
- **Secure session cookies** — `secure` flag enabled in production to enforce HTTPS-only transmission
- **CSRF protection** — Origin/Referer header verification on all mutating requests via the proxy (`src/proxy.ts`)
- **Security headers** — X-Content-Type-Options, X-Frame-Options (DENY), HSTS, Referrer-Policy, Permissions-Policy (camera allowed same-origin for QR scanners; microphone and geolocation denied), and Content-Security-Policy applied to all responses
- **Content-Security-Policy** — restricts scripts, styles, images, frames, and connections to trusted origins (self, Cloudflare Turnstile, R2 storage)
- **XSS-safe runtime theming** — the injected theme `<style>` only ever contains values that pass a strict 6-digit-hex check, so a setting value can never close the tag or inject markup
- **Cart quantity limits** — maximum 999 per item enforced on both add-to-cart and quantity update endpoints
- **Explicit role verification** — admin checkout endpoint validates SUPERADMIN/ADMIN role before allowing session lookups; user management and settings are SUPERADMIN-only at both page and API levels

## Managed Hosting & Support

The full source code in this repository is **free and open-source** — you're
welcome to self-host it, customize it, and run it on your own infrastructure at no
cost forever. No strings attached.

If you'd prefer a **done-for-you, fully managed deployment** — so you can skip
servers, databases, migrations, backups, and updates — we offer optional hosting
plans. Each plan is a complete managed instance for **one restaurant**: deployment,
hosting, automatic updates, and support included.

| Plan | Price | Best for |
|---|---|---|
| **3 months** | **RM 180** (RM 60 / month) | Trying it out for a season |
| **6 months** | **RM 340** (RM ~57 / month) | A full half-year, lower monthly rate |
| **12 months** | **RM 660** (RM 55 / month) | Best value — lowest monthly rate |

Hosting is **opt-in** — only for restaurants that want us to run it for them. The
code itself stays free for everyone.

**Interested?** Message us on WhatsApp and we'll get you set up:

➡️ **[Chat with us on WhatsApp](https://api.whatsapp.com/send/?phone=60166206903&text=Hi%2C%20I%27m%20interested%20in%20your%20managed%20hosting%20plans%20for%20the%20QR%20food%20ordering%20system.%20Could%20you%20share%20more%20details%3F)**

> Or send a message directly to **+60 16-620 6903** on WhatsApp.

## License

[MIT](LICENSE) — Zhen Kai, 2026
