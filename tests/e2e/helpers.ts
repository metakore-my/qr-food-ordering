import { type Page, expect } from "@playwright/test";

// Mutating API routes are protected by the proxy's CSRF guard, which requires
// the Origin (or Referer) host to match the request host. Playwright's
// `request.post` sends no Origin by default, so every helper POST must set one
// matching the config `baseURL`.
export const API_HEADERS = { Origin: "http://localhost:3000" };

/**
 * Logs in as an admin user via the UI.
 * Navigates to the login page, fills credentials, submits,
 * and waits for redirect to the dashboard.
 */
export async function loginAsAdmin(
  page: Page,
  {
    username = "superadminxyz",
    password = process.env.SEED_SUPERADMIN_PASSWORD!,
    locale = "th",
  }: {
    username?: string;
    password?: string;
    locale?: string;
  } = {}
) {
  // Admin routes live under the obscured `/admin/` segment.
  await page.goto(`/${locale}/admin/login`);

  // Wait for the login form to be visible
  await page.waitForSelector('input[name="username"]');

  // Fill in credentials
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);

  // Submit the form
  await page.click('button[type="submit"]');

  // Wait for navigation to the dashboard (the login form pushes to
  // /admin/dashboard).
  await page.waitForURL(`**/${locale}/admin/dashboard`, { timeout: 15000 });

  // Verify we landed on the dashboard
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin/dashboard`));
}

/**
 * Creates a table via the API using an authenticated request context.
 * The route accepts a single number or a range ("1-10") under `input` and
 * returns `{ created, skipped }`; this helper requests one table and unwraps
 * the created (or pre-existing) row, returning `{ id, number, token }`.
 */
export async function createTableViaAPI(
  page: Page,
  tableNumber: number
): Promise<{ id: number; number: number; token: string }> {
  const response = await page.request.post("/api/tables", {
    data: { input: String(tableNumber) },
    headers: API_HEADERS,
  });

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  // New row created this call → first element of `created`. If the table
  // already exists (shared DB across specs), fetch it so callers still get a
  // usable row.
  let table = Array.isArray(body.created) ? body.created[0] : undefined;
  if (!table) {
    const list = await page.request.get("/api/tables");
    expect(list.ok()).toBeTruthy();
    const tables = await list.json();
    table = (Array.isArray(tables) ? tables : tables.tables ?? []).find(
      (t: { number: number }) => t.number === tableNumber
    );
  }
  expect(table).toBeTruthy();
  expect(table).toHaveProperty("id");
  expect(table).toHaveProperty("token");
  return table;
}

/**
 * Creates a category via the API using an authenticated request context.
 * Returns the created category object.
 */
export async function createCategoryViaAPI(
  page: Page,
  translations: Record<string, string>,
  sortOrder = 0
): Promise<{ id: number; names: Array<{ locale: string; name: string }> }> {
  const response = await page.request.post("/api/categories", {
    data: { sortOrder, translations },
    headers: API_HEADERS,
  });

  expect(response.ok()).toBeTruthy();
  const category = await response.json();
  expect(category).toHaveProperty("id");
  return category;
}

/**
 * Creates a menu item via the API using an authenticated request context.
 * Returns the created menu item object.
 */
export async function createMenuItemViaAPI(
  page: Page,
  {
    categoryId,
    price,
    translations,
    isFeatured,
  }: {
    categoryId: number;
    price: number;
    translations: Record<string, { name: string; description?: string }>;
    isFeatured?: boolean;
  }
): Promise<{ id: number; categoryId: number; price: number }> {
  const response = await page.request.post("/api/menu", {
    data: { categoryId, price, translations, ...(isFeatured ? { isFeatured: true } : {}) },
    headers: API_HEADERS,
  });

  expect(response.ok()).toBeTruthy();
  const menuItem = await response.json();
  expect(menuItem).toHaveProperty("id");
  return menuItem;
}
