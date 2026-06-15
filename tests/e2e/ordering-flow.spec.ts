import { test, expect } from "@playwright/test";
import {
  loginAsAdmin,
  createTableViaAPI,
  createCategoryViaAPI,
  createMenuItemViaAPI,
} from "./helpers";

test.describe("Full Ordering Flow", () => {
  let tableToken: string;
  let tableNumber: number;

  test.beforeAll(async ({ browser }) => {
    // Use an admin browser context to set up test data
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    // Login as admin
    await loginAsAdmin(adminPage);

    // Create a table via API
    const table = await createTableViaAPI(adminPage, Math.floor(Math.random() * 9000) + 1000);
    tableToken = table.token;
    tableNumber = table.number;

    // Create a category
    const category = await createCategoryViaAPI(adminPage, {
      th: "อาหารจานเดียว",
      en: "Single Dishes",
    });

    // Create a menu item
    await createMenuItemViaAPI(adminPage, {
      categoryId: category.id,
      price: 120,
      translations: {
        th: { name: "ผัดไทย", description: "ผัดไทยกุ้งสด" },
        en: { name: "Pad Thai", description: "Classic Pad Thai with shrimp" },
      },
    });

    await adminContext.close();
  });

  test("should land on table page and navigate to menu", async ({ page }) => {
    // Navigate to the table landing page using the token
    await page.goto(`/th/table/${tableToken}`);

    // Verify we see the table number and browse menu button
    await expect(page.locator(`text=Table ${tableNumber}`)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=Browse Menu")).toBeVisible();

    // Click "Browse Menu" to navigate to the menu page
    await page.click("text=Browse Menu");

    // Wait for menu page to load
    await page.waitForURL("**/th/menu", { timeout: 10000 });
    await expect(page).toHaveURL(/\/th\/menu/);
  });

  test("should display menu items on the menu page", async ({ page }) => {
    // First, create a session by visiting the table landing page
    await page.goto(`/th/table/${tableToken}`);
    await expect(page.locator("text=Browse Menu")).toBeVisible({
      timeout: 10000,
    });

    // Navigate to menu
    await page.click("text=Browse Menu");
    await page.waitForURL("**/th/menu", { timeout: 10000 });

    // Verify the category heading appears
    await expect(page.locator("text=อาหารจานเดียว")).toBeVisible({
      timeout: 10000,
    });

    // Verify our test menu item is displayed (Thai locale shows Thai name)
    await expect(page.locator("text=ผัดไทย")).toBeVisible();

    // Verify the price is shown
    await expect(page.locator("text=฿120.00")).toBeVisible();

    // Verify "Add to cart" button is present
    await expect(page.locator("text=Add to cart").first()).toBeVisible();
  });

  test("should add item to cart via UI and see cart badge", async ({
    page,
  }) => {
    // Visit table landing to get session
    await page.goto(`/th/table/${tableToken}`);
    await expect(page.locator("text=Browse Menu")).toBeVisible({
      timeout: 10000,
    });
    await page.click("text=Browse Menu");
    await page.waitForURL("**/th/menu", { timeout: 10000 });

    // Wait for menu items to load
    await expect(page.locator("text=ผัดไทย")).toBeVisible({ timeout: 10000 });

    // Click "Add to cart" button
    await page.click("text=Add to cart");

    // Verify toast notification appears
    await expect(page.locator("text=added to cart")).toBeVisible({
      timeout: 5000,
    });

    // Verify cart badge appears with count
    await expect(page.locator("text=1").last()).toBeVisible({ timeout: 5000 });
  });

  test("should navigate to cart and see items", async ({ page }) => {
    // Visit table landing to get session
    await page.goto(`/th/table/${tableToken}`);
    await expect(page.locator("text=Browse Menu")).toBeVisible({
      timeout: 10000,
    });
    await page.click("text=Browse Menu");
    await page.waitForURL("**/th/menu", { timeout: 10000 });

    // Add item to cart
    await expect(page.locator("text=ผัดไทย")).toBeVisible({ timeout: 10000 });
    await page.click("text=Add to cart");

    // Wait for toast to confirm add
    await expect(page.locator("text=added to cart")).toBeVisible({
      timeout: 5000,
    });

    // Navigate to cart page
    await page.goto("/th/cart");

    // Verify cart page loaded
    await expect(page.locator("text=Your Cart")).toBeVisible({
      timeout: 10000,
    });

    // Verify Place Order button is present
    await expect(page.locator("text=Place Order")).toBeVisible();

    // Verify total is shown
    await expect(page.locator("text=Total")).toBeVisible();
  });

  test("should place an order and see success state", async ({ page }) => {
    // Visit table landing to get session
    await page.goto(`/th/table/${tableToken}`);
    await expect(page.locator("text=Browse Menu")).toBeVisible({
      timeout: 10000,
    });
    await page.click("text=Browse Menu");
    await page.waitForURL("**/th/menu", { timeout: 10000 });

    // Add item to cart
    await expect(page.locator("text=ผัดไทย")).toBeVisible({ timeout: 10000 });
    await page.click("text=Add to cart");
    await expect(page.locator("text=added to cart")).toBeVisible({
      timeout: 5000,
    });

    // Navigate to cart
    await page.goto("/th/cart");
    await expect(page.locator("text=Your Cart")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=Place Order")).toBeVisible();

    // Place the order
    await page.click("text=Place Order");

    // Wait for order success state
    await expect(page.locator("text=Order placed!")).toBeVisible({
      timeout: 15000,
    });

    // Verify "Menu" link is shown to go back
    const menuLinks = page.locator("a", { hasText: /Menu|เมนู/ });
    await expect(menuLinks.first()).toBeVisible();
  });

  test("should navigate to checkout and see order summary", async ({
    page,
  }) => {
    // Set up a complete order via API for reliability
    // First visit table landing to get session cookie
    await page.goto(`/th/table/${tableToken}`);
    await expect(page.locator("text=Browse Menu")).toBeVisible({
      timeout: 10000,
    });

    // Create session via API (cookie is set by visiting table page)
    // The table page already creates a session, so we need to get the session ID
    // Navigate to menu then use API to add to cart and place order
    await page.click("text=Browse Menu");
    await page.waitForURL("**/th/menu", { timeout: 10000 });

    // Add item via UI
    await expect(page.locator("text=ผัดไทย")).toBeVisible({ timeout: 10000 });
    await page.click("text=Add to cart");
    await expect(page.locator("text=added to cart")).toBeVisible({
      timeout: 5000,
    });

    // Go to cart and place order
    await page.goto("/th/cart");
    await expect(page.locator("text=Place Order")).toBeVisible({
      timeout: 10000,
    });
    await page.click("text=Place Order");
    await expect(page.locator("text=Order placed!")).toBeVisible({
      timeout: 15000,
    });

    // Navigate to checkout page
    await page.goto("/th/checkout");

    // Verify checkout page shows order summary
    await expect(
      page.locator("text=เช็คเอาท์").or(page.locator("text=Checkout"))
    ).toBeVisible({ timeout: 10000 });

    // Verify the table number is shown
    await expect(page.locator(`text=Table ${tableNumber}`)).toBeVisible();
  });
});

test.describe("Locale Switching", () => {
  let tableToken: string;

  test.beforeAll(async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);

    const table = await createTableViaAPI(
      adminPage,
      Math.floor(Math.random() * 9000) + 1000
    );
    tableToken = table.token;

    // Ensure there is at least one category and item
    const category = await createCategoryViaAPI(adminPage, {
      th: "เครื่องดื่ม",
      en: "Beverages",
    });

    await createMenuItemViaAPI(adminPage, {
      categoryId: category.id,
      price: 60,
      translations: {
        th: { name: "ชาไทย" },
        en: { name: "Thai Tea" },
      },
    });

    await adminContext.close();
  });

  test("should switch locale from Thai to English on menu page", async ({
    page,
  }) => {
    // Navigate to table landing (Thai locale by default)
    await page.goto(`/th/table/${tableToken}`);
    await expect(page.locator("text=Browse Menu")).toBeVisible({
      timeout: 10000,
    });

    await page.click("text=Browse Menu");
    await page.waitForURL("**/th/menu", { timeout: 10000 });

    // Verify we are on Thai locale
    await expect(page).toHaveURL(/\/th\/menu/);

    // The locale switcher is a <select> with aria-label="Select language"
    const localeSwitcher = page.locator('select[aria-label="Select language"]');
    await expect(localeSwitcher).toBeVisible();

    // Switch to English
    await localeSwitcher.selectOption("en");

    // Wait for page to reload with English locale
    await page.waitForURL("**/en/menu", { timeout: 10000 });
    await expect(page).toHaveURL(/\/en\/menu/);

    // Verify the nav heading changed to English
    await expect(page.locator("h1:has-text('Menu')")).toBeVisible();

    // Verify menu items now show English names
    await expect(page.locator("text=Beverages")).toBeVisible({
      timeout: 10000,
    });
  });

  test("should switch locale on admin login page", async ({ page }) => {
    // Navigate to the Thai login page
    await page.goto("/th/login");
    await expect(page.locator(`text=${process.env.NEXT_PUBLIC_APP_NAME || "APP NAME"}`)).toBeVisible();

    // The login page currently uses hardcoded English text ("Username", "Password", "Sign in")
    // Verify these are present
    await expect(page.locator("label:has-text('Username')")).toBeVisible();
    await expect(page.locator("label:has-text('Password')")).toBeVisible();

    // Navigate to English locale login
    await page.goto("/en/login");

    // The same labels should be visible (login form uses English labels regardless)
    await expect(page.locator("label:has-text('Username')")).toBeVisible();
    await expect(page.locator("label:has-text('Password')")).toBeVisible();
  });
});

test.describe("Ordering Flow via API Setup", () => {
  // This test uses API calls for setup to test the full flow more reliably

  test("should complete full order cycle with API-seeded data", async ({
    browser,
  }) => {
    // Step 1: Admin sets up the restaurant data
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);

    // Create table
    const table = await createTableViaAPI(
      adminPage,
      Math.floor(Math.random() * 9000) + 1000
    );

    // Create category and menu item
    const category = await createCategoryViaAPI(adminPage, {
      th: "ยำ",
      en: "Salads",
    });

    await createMenuItemViaAPI(adminPage, {
      categoryId: category.id,
      price: 180,
      translations: {
        th: { name: "ยำวุ้นเส้น", description: "ยำวุ้นเส้นทะเล" },
        en: {
          name: "Glass Noodle Salad",
          description: "Spicy glass noodle salad with seafood",
        },
      },
    });

    await adminContext.close();

    // Step 2: Customer flow in a new browser context
    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();

    // Visit table landing
    await customerPage.goto(`/th/table/${table.token}`);
    await expect(customerPage.locator(`text=Table ${table.number}`)).toBeVisible({
      timeout: 10000,
    });
    await expect(customerPage.locator("text=Browse Menu")).toBeVisible();

    // Go to menu
    await customerPage.click("text=Browse Menu");
    await customerPage.waitForURL("**/th/menu", { timeout: 10000 });

    // Verify the menu item is displayed
    await expect(customerPage.locator("text=ยำวุ้นเส้น")).toBeVisible({
      timeout: 10000,
    });
    await expect(customerPage.locator("text=฿180.00")).toBeVisible();

    // Add to cart
    await customerPage.click("text=Add to cart");
    await expect(customerPage.locator("text=added to cart")).toBeVisible({
      timeout: 5000,
    });

    // Go to cart
    await customerPage.goto("/th/cart");
    await expect(customerPage.locator("text=Your Cart")).toBeVisible({
      timeout: 10000,
    });
    await expect(customerPage.locator("text=Place Order")).toBeVisible();

    // Place order
    await customerPage.click("text=Place Order");
    await expect(customerPage.locator("text=Order placed!")).toBeVisible({
      timeout: 15000,
    });

    // Navigate to checkout
    await customerPage.goto("/th/checkout");
    await expect(
      customerPage
        .locator("text=เช็คเอาท์")
        .or(customerPage.locator("text=Checkout"))
    ).toBeVisible({ timeout: 10000 });

    await customerContext.close();
  });
});
