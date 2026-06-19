# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-06-19

### Changed

- New staff (Admin) accounts now start with the "Orders" permission pre-selected,
  so the most common front-of-house role is one click to create.
- In the menu and category editors, the restaurant's main language tab now
  appears first in the row of language tabs, instead of in a fixed order — so the
  language you mostly type in is where you'd expect it.

### Fixed

- The admin login screen now shows the restaurant name in the language you're
  viewing it in (e.g. the English name on the English login page), instead of
  always showing the main-language name regardless of the chosen language.
- On the Settings page, the pinned "Save changes" bar no longer shows the fields
  beneath it bleeding through as you scroll — the bar is now solid, and there's
  room to scroll the last setting fully clear of it.

## [1.0.1] - 2026-06-17

### Added

- Adding an item to the cart now shows a brief on-screen confirmation (and
  announces it to screen readers), so it's clear the item went in.
- The "order placed" screen now recaps the order — item count and amount — so
  the customer can confirm what they just submitted.
- The daily cleanup now removes orphaned menu images from storage (images left
  behind when an item or its photo is replaced/deleted), so storage doesn't grow
  unbounded over time.

### Changed

- After finishing the first-run setup wizard, the new administrator is now signed
  in automatically and taken straight to the dashboard, instead of being sent to
  the login page to sign in by hand. (If a CAPTCHA is enabled, the one-time
  challenge is consumed by setup, so that case still finishes at the login page.)
- In the setup wizard, the restaurant name for each enabled additional language is
  now required (you must fill it in before finishing), rather than optional.
- The cart's "Place Order" button now stays pinned to the bottom of the screen,
  so it's reachable without scrolling past a long order.
- Admin menu view/sort and the Reports date range, tab, and status filter are now
  remembered as you move between admin pages, instead of resetting each visit.

### Fixed

- A deployment configured for a non-English main language now starts up — and
  opens the first-run setup wizard — in that language, instead of always
  defaulting to English. The setup wizard pre-selects the configured main
  language and region set.
- The kitchen dashboard's "tap to enable order sound" no longer reverts every
  time you navigate away and back — once enabled, it stays enabled for the
  session.
- Lowering a cart item's quantity to its minimum no longer silently deletes the
  line; use the remove button to take it out.
- A menu image that fails to load no longer leaves a large empty gap — the card
  falls back to its compact, image-less layout.
- AI menu import no longer discards the Simplified Chinese name when importing
  from an English-language menu photo — the extracted Chinese name is kept.

## [1.0.0] - 2026-06-15

First public release. As an initial release, everything is **Added** — there is no
prior version to change, remove, or fix against.

### Added

**Customer ordering**
- QR-scoped table sessions with HMAC-signed table tokens to prevent spoofing.
- Per-device, database-backed cart (each device on a table keeps its own cart;
  orders are shared across the table). The same item with different options is
  held as separate cart lines.
- Menu browsing with categories, images, multi-language names, a "Recommended"
  section for featured items, and automatic "From <price>" labels on items with
  paid options.
- Combo meals (bundled choices via option groups; fixed combo price or base +
  adjustments) and per-item option groups (size, spice, extras) with single- and
  multi-choice selection and optional price adjustments.
- Order placement with a payment-QR checkout summary and real-time order-status
  tracking via short polling.
- Per-market animated food background on the landing and admin shells, chosen by
  the configured currency.

**Admin & kitchen**
- Real-time order dashboard (Kanban, grouped by table) with browser
  notifications and a per-device new-order **sound alert** (three CC0 chimes,
  volume control, and an "alert even when muted" option that rings a silenced
  kitchen tablet). The page plays the sound itself, so it reaches phones and
  tablets where OS notifications can't.
- Order detail modal with inline quantity edits, per-order confirm/decline,
  confirm-all, and checkout settlement.
- **Staff-assisted ordering** — a second ordering path: staff key in a table
  number and build an order on a customer's behalf from the same menu, options,
  and pricing. The resulting order is indistinguishable from a self-placed one
  on the kitchen board, at checkout, and in reports; a table session is created
  automatically if none is open.
- **Checkout scanner** — scan a customer's QR to view and manage their orders
  (edit quantities, confirm/decline, settle the bill), plus a **Close Table**
  action that force-closes an unsettleable session (walkout or all-declined),
  cancelling any unpaid orders and freeing the table.
- **AI Menu Import** (optional) — upload photos of a printed menu; vision AI
  extracts items, prices, categories, and option groups, anchored on the
  deployment's source language (not English-only), with duplicate detection
  across all locales, a built-in glossary for well-known SEA dishes, and
  translation of all names — including option groups and choices — to every
  enabled locale.
- Menu & category management with image uploads, translations, grid/list views,
  sorting, multi-select bulk actions, and delete guards against active carts and
  pending orders. Collapsible option-group editor per item.
- Table management with batch creation (single number or range) and secure QR
  generation.
- User management with role-based access (Superadmin / Admin) and granular
  permissions (menu, tables, reports, orders), including Superadmin password
  reset for other accounts (forces the target to re-login).
- **Maintenance mode** — a Superadmin toggle (password-confirmed) that takes the
  customer-facing app offline behind a full-screen notice while admins keep
  working; an amber banner shows while it's active.

**Reporting**
- Analytics dashboard (on-screen) with period-over-period deltas, top items and
  a Pareto headline, "frequently ordered together" attach-rate insights, slow/
  dead-item detection, a category-revenue breakdown, and an orders-by-time-of-day
  clock profile with peak detection. Time-range selector with presets or a
  custom from–to range (90-day cap).
- **Order-history export** (Excel / CSV) — the single download for records
  backup and accountant hand-off: a raw, one-row-per-sale transaction trail,
  oldest-first, with a sortable `YYYY-MM-DD` date column, selected options, and
  session IDs. Truncation is flagged loudly; export content is translated to the
  active locale and uses the deployment's currency. A standing notice reminds the
  owner to download monthly and keep the files for the yearly audit.

**Configuration & setup**
- First-run setup wizard creates the first admin and sets app name, currency,
  languages, theme, and logo. All config is stored as runtime database settings
  and editable live — no env-var juggling, no rebuild.
- Per-locale app name (bilingual brand with a main-language fallback), live theme
  preview (green / terracotta / indigo / amber presets or a custom color), and a
  logo upload.
- Six routable locales (English source of truth, plus Thai, Vietnamese,
  Simplified Chinese, Traditional Chinese, and Bahasa Melayu); the active default
  and enabled subset are admin settings.
- Currency and primary language lock after setup to protect stored money
  precision and order-name snapshots.

**Menu backup & restore** (Superadmin)
- Download the full menu (categories, items, option groups, choices, and all
  translations) as a versioned JSON file, and restore it via a validated,
  atomic full-replace. Restore validates price precision against the current
  currency and reconciles the file's locales against the deployment's current
  configuration. Scope is menu data only — orders, sessions, and settings are
  never touched.

**Reliability & correctness**
- Duplicate orders from a double-tapped "Place Order" are prevented by a
  database-level cart-claim, so exactly one order wins under concurrent submits.
- A price change mid-checkout never silently charges the customer — the cart
  re-confirms against the live total instead of placing a stale-priced order.
- Cart lines that reference a deleted option group/choice are rejected rather
  than silently dropped, so the kitchen never misses a choice.
- Timestamps follow a UTC-storage invariant, so dates and report buckets stay
  correct regardless of deployment timezone.
- Item and option names resolve to each viewer's own language across orders,
  reports, and exports, with a localized fallback for deleted items.
- Menu extraction and translation anchor on the printed source language (not
  English-only), so Malay / Vietnamese / Chinese names aren't dropped.
- Responsive layout verified across 320px–1440px (touch targets, iOS input zoom,
  safe-area insets, sticky elements).

[1.0.2]: https://github.com/metakore-my/qr-food-ordering/releases/tag/v1.0.2
[1.0.1]: https://github.com/metakore-my/qr-food-ordering/releases/tag/v1.0.1
[1.0.0]: https://github.com/metakore-my/qr-food-ordering/releases/tag/v1.0.0
