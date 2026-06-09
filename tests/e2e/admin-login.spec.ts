import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers";

test.describe("Admin Login", () => {
  test("should login with valid credentials and redirect to dashboard", async ({
    page,
  }) => {
    await page.goto("/th/login");

    // Verify login page elements are present
    await expect(page.locator(`text=${process.env.NEXT_PUBLIC_APP_NAME || "APP NAME"}`)).toBeVisible();
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Fill in valid credentials
    await page.fill('input[name="username"]', "superadminxyz");
    await page.fill('input[name="password"]', process.env.SEED_SUPERADMIN_PASSWORD!);

    // Submit the form
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL("**/th/dashboard", { timeout: 15000 });

    // Verify we are on the dashboard
    await expect(page).toHaveURL(/\/th\/dashboard/);
    await expect(page.locator("text=Order Dashboard")).toBeVisible();
  });

  test("should show error message with invalid credentials", async ({
    page,
  }) => {
    await page.goto("/th/login");

    // Fill in invalid credentials
    await page.fill('input[name="username"]', "wronguser");
    await page.fill('input[name="password"]', "WrongPass123");

    // Submit the form
    await page.click('button[type="submit"]');

    // Wait for and verify the error message
    await expect(
      page.locator("text=Invalid username or password")
    ).toBeVisible({ timeout: 10000 });

    // Verify we are still on the login page
    await expect(page).toHaveURL(/\/th\/login/);
  });

  test("should show validation error for empty fields", async ({ page }) => {
    await page.goto("/th/login");

    // Try to submit the form without filling in fields
    // The browser's built-in validation should prevent submission (required fields)
    // But we can clear a pre-filled field and trigger form-level validation
    const usernameInput = page.locator('input[name="username"]');
    await usernameInput.click();
    await usernameInput.fill("");

    const passwordInput = page.locator('input[name="password"]');
    await passwordInput.click();
    await passwordInput.fill("");

    // Click submit - HTML5 required attribute should prevent submission
    await page.click('button[type="submit"]');

    // Should still be on login page
    await expect(page).toHaveURL(/\/th\/login/);
  });

  test("should persist session across admin pages after login", async ({
    page,
  }) => {
    // Login using the helper
    await loginAsAdmin(page);

    // Verify we are on the dashboard
    await expect(page.locator("text=Order Dashboard")).toBeVisible();

    // Navigate to menu management
    await page.goto("/th/menu-management");

    // Verify we can access the protected page (not redirected to login)
    await expect(page).toHaveURL(/\/th\/menu-management/);
    await expect(page.locator("text=Menu Management")).toBeVisible();

    // Navigate to tables page
    await page.goto("/th/tables");

    // Verify we can access another protected page
    await expect(page).toHaveURL(/\/th\/tables/);
  });

  test("should work with alternative admin credentials", async ({ page }) => {
    await loginAsAdmin(page, {
      username: "devxyz",
      password: process.env.SEED_DEV_PASSWORD!,
    });

    // Verify we landed on the dashboard
    await expect(page).toHaveURL(/\/th\/dashboard/);
    await expect(page.locator("text=Order Dashboard")).toBeVisible();
  });
});
