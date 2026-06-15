import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers";

test.describe("Menu Management", () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin before each test
    await loginAsAdmin(page);
  });

  test("should navigate to menu management page", async ({ page }) => {
    await page.goto("/th/menu-management");

    // Verify page loads correctly
    await expect(page.locator("text=Menu Management")).toBeVisible();
    await expect(page.locator("text=Categories")).toBeVisible();
  });

  test("should create a new category with Thai name", async ({ page }) => {
    await page.goto("/th/menu-management");
    await expect(page.locator("text=Menu Management")).toBeVisible();

    // Click "Add" button next to Categories header
    await page.click("button:has-text('+ Add')");

    // Wait for the category form modal to appear
    await expect(page.locator("text=Add Category")).toBeVisible();

    // The Thai locale tab should be active by default
    // Fill in the Thai name
    const thaiInput = page.locator(
      'input[placeholder="Category name in Thai"]'
    );
    await thaiInput.fill("อาหารไทย");

    // Optionally add an English translation
    // Click the "en" tab
    await page.click('button:has-text("en")');
    const enInput = page.locator(
      'input[placeholder="Category name in English"]'
    );
    await enInput.fill("Thai Food");

    // Submit the form
    await page.click('button:has-text("Save")');

    // Wait for the modal to close
    await expect(page.locator("text=Add Category")).not.toBeVisible({
      timeout: 10000,
    });

    // Verify the category appears in the sidebar
    // The category name should show (English or Thai based on getCategoryName logic - prefers EN)
    await expect(page.locator("text=Thai Food")).toBeVisible();
  });

  test("should create a menu item under a category", async ({ page }) => {
    await page.goto("/th/menu-management");
    await expect(page.locator("text=Menu Management")).toBeVisible();

    // First, create a category if none exists
    // Click "Add" button to create a category
    await page.click("button:has-text('+ Add')");
    await expect(page.locator("text=Add Category")).toBeVisible();

    // Fill Thai name
    await page
      .locator('input[placeholder="Category name in Thai"]')
      .fill("ของหวาน");

    // Add English name
    await page.click('button:has-text("en")');
    await page
      .locator('input[placeholder="Category name in English"]')
      .fill("Desserts");

    await page.click('button:has-text("Save")');
    await expect(page.locator("text=Add Category")).not.toBeVisible({
      timeout: 10000,
    });

    // Verify the category was created
    await expect(page.locator("text=Desserts")).toBeVisible();

    // Now click "+ Add Item" to create a menu item
    await page.click('button:has-text("+ Add Item")');

    // Wait for the menu item form modal
    await expect(page.locator("text=Add Menu Item")).toBeVisible();

    // Fill in the price
    await page.fill('input#price', "150");

    // Fill in the Thai name (default active locale is "th")
    await page
      .locator('input[placeholder="Item name in Thai"]')
      .fill("ข้าวเหนียวมะม่วง");

    // Add English translation
    await page.click('button:has-text("en")');
    await page
      .locator('input[placeholder="Item name in English"]')
      .fill("Mango Sticky Rice");
    await page
      .locator('textarea[placeholder="Description in English"]')
      .fill("Sweet sticky rice with fresh mango");

    // Submit
    await page.click('button:has-text("Save")');

    // Wait for modal to close
    await expect(page.locator("text=Add Menu Item")).not.toBeVisible({
      timeout: 10000,
    });

    // Verify the item appears in the list
    await expect(page.locator("text=Mango Sticky Rice")).toBeVisible();
    await expect(page.locator("text=150.00 THB")).toBeVisible();
  });

  test("should toggle menu item availability", async ({ page }) => {
    await page.goto("/th/menu-management");
    await expect(page.locator("text=Menu Management")).toBeVisible();

    // Create a category and menu item first via API for speed
    const catResponse = await page.request.post("/api/categories", {
      data: {
        sortOrder: 99,
        translations: { th: "ทดสอบ", en: "Test Category" },
      },
    });
    const category = await catResponse.json();

    await page.request.post("/api/menu", {
      data: {
        categoryId: category.id,
        price: 100,
        translations: {
          th: { name: "ทดสอบไอเทม" },
          en: { name: "Test Toggle Item" },
        },
      },
    });

    // Reload the page to see the new items
    await page.reload();
    await expect(page.locator("text=Menu Management")).toBeVisible();

    // Find and click on the Test Category in the sidebar
    await page.click("text=Test Category");

    // The item should show as "Available"
    await expect(page.locator("text=Test Toggle Item")).toBeVisible();
    await expect(page.locator("text=Available").first()).toBeVisible();

    // Click "Set Unavailable" to toggle availability
    await page.click('button:has-text("Set Unavailable")');

    // Verify it now shows "Unavailable"
    await expect(page.locator("text=Unavailable").first()).toBeVisible({
      timeout: 5000,
    });
  });
});
