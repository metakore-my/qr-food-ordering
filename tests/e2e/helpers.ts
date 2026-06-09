import { type Page, expect } from "@playwright/test";

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
  await page.goto(`/${locale}/login`);

  // Wait for the login form to be visible
  await page.waitForSelector('input[name="username"]');

  // Fill in credentials
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);

  // Submit the form
  await page.click('button[type="submit"]');

  // Wait for navigation to dashboard (the login form pushes to /dashboard)
  await page.waitForURL(`**/${locale}/dashboard`, { timeout: 15000 });

  // Verify we landed on the dashboard
  await expect(page).toHaveURL(new RegExp(`/${locale}/dashboard`));
}

/**
 * Creates a table via the API using an authenticated request context.
 * Returns the created table object with id, number, and token.
 */
export async function createTableViaAPI(
  page: Page,
  tableNumber: number
): Promise<{ id: number; number: number; token: string }> {
  const response = await page.request.post("/api/tables", {
    data: { number: tableNumber },
  });

  expect(response.ok()).toBeTruthy();
  const table = await response.json();
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
  }: {
    categoryId: number;
    price: number;
    translations: Record<string, { name: string; description?: string }>;
  }
): Promise<{ id: number; categoryId: number; price: number }> {
  const response = await page.request.post("/api/menu", {
    data: { categoryId, price, translations },
  });

  expect(response.ok()).toBeTruthy();
  const menuItem = await response.json();
  expect(menuItem).toHaveProperty("id");
  return menuItem;
}
