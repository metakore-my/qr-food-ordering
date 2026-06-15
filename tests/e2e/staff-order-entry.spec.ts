import { test, expect } from "@playwright/test";
import {
  loginAsAdmin,
  createTableViaAPI,
  createCategoryViaAPI,
  createMenuItemViaAPI,
} from "./helpers";

// Staff-assisted order entry: an admin keys in a table number, builds an order
// from the live menu, and places it via POST /api/admin/orders/place. On an
// empty table the route auto-creates a session; the placed order then behaves
// like any customer order and surfaces on the dashboard order board.
//
// URLs (verified against the running app): the admin pages live under the
// `/admin/` path segment — order entry is `/<locale>/admin/order-entry`, the
// kitchen dashboard is `/<locale>/admin/dashboard`. (The `(admin)` route group
// in the filesystem does NOT appear in the URL.)
//
// Numbers are kept high/distinct to reduce collision with other specs that
// share the single test DB (workers: 1, fullyParallel: false).
test.describe("staff-assisted order entry", () => {
  test("places an order on an empty table (auto-creates session) and it reaches the dashboard board", async ({
    page,
  }) => {
    await loginAsAdmin(page, { locale: "en" });

    const table = await createTableViaAPI(page, 91);
    const category = await createCategoryViaAPI(page, {
      en: "E2E Drinks",
      th: "E2E",
    });
    await createMenuItemViaAPI(page, {
      categoryId: category.id,
      price: 50,
      translations: {
        en: { name: "E2E Iced Tea" },
        th: { name: "E2E Iced Tea" },
      },
    });

    await page.goto("/en/admin/order-entry");

    // Key in the table number; the inline hint confirms it resolved to an
    // active table before we try to place.
    await page.getByPlaceholder("e.g. 5").fill(String(table.number));
    await expect(
      page.getByText(`Table ${table.number} · active`)
    ).toBeVisible();

    // The item has no option groups, so its add control renders as "+".
    await page.getByRole("button", { name: "+", exact: true }).first().click();

    // Place the order.
    await page.getByRole("button", { name: "Place Order" }).click();

    // Confirmation heading shows.
    await expect(page.getByText("Order placed")).toBeVisible({
      timeout: 15000,
    });

    // The order shows on the dashboard board under the table number
    // ("Table 91" — substring match against the number is sufficient).
    await page.goto("/en/admin/dashboard");
    await expect(page.getByText(String(table.number))).toBeVisible({
      timeout: 15000,
    });
  });

  test("disables Place and shows an invalid hint for an unknown table number", async ({
    page,
  }) => {
    await loginAsAdmin(page, { locale: "en" });

    const category = await createCategoryViaAPI(page, {
      en: "E2E Soup Cat",
      th: "E2E",
    });
    await createMenuItemViaAPI(page, {
      categoryId: category.id,
      price: 30,
      translations: { en: { name: "E2E Soup" }, th: { name: "E2E Soup" } },
    });

    await page.goto("/en/admin/order-entry");

    // Add an item so the only thing gating "Place Order" is the table validity.
    await page.getByRole("button", { name: "+", exact: true }).first().click();

    // A table number with no matching active table surfaces the invalid hint
    // and keeps the place button disabled.
    await page.getByPlaceholder("e.g. 5").fill("99999");
    await expect(
      page.getByText("No active table with that number")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Place Order" })
    ).toBeDisabled();
  });
});
