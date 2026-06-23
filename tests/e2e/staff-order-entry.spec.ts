import { test, expect } from "@playwright/test";
import {
  loginAsAdmin,
  createTableViaAPI,
  createCategoryViaAPI,
  createMenuItemViaAPI,
  API_HEADERS,
} from "./helpers";

// Shape of an order as returned by GET /api/admin/orders (only the fields the
// takeaway tests read). Avoids `any` while staying tolerant of extra fields.
type BoardOrder = {
  id: number;
  orderType?: "DINE_IN" | "TAKEAWAY";
  customerName?: string | null;
  status?: string;
  sessionId?: string;
  session?: {
    id?: string;
    status?: string;
    table?: { number: number } | null;
  } | null;
};

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

  test("category chips filter the picker; Featured collects across categories; search overrides the active chip", async ({
    page,
  }, testInfo) => {
    await loginAsAdmin(page, { locale: "en" });

    // The e2e DB is shared and never reset between runs, so fixed category/item
    // names accumulate duplicates and break strict-mode role locators ("resolved
    // to 2 elements"). Tag every name with a per-run-unique token so each run's
    // chips and items are addressable on their own, and use exact-match locators.
    const tag = `T${testInfo.workerIndex}-${testInfo.retry}-${process.hrtime.bigint().toString(36)}`;
    const drinkCat = `${tag} Drinks`;
    const mainCat = `${tag} Mains`;
    const drinkItem = `${tag} Teh Tarik`;
    const mainItem = `${tag} Nasi Lemak`;

    // Two categories; one featured item lives in the SECOND category.
    const drinks = await createCategoryViaAPI(page, { en: drinkCat });
    const mains = await createCategoryViaAPI(page, { en: mainCat });
    await createMenuItemViaAPI(page, {
      categoryId: drinks.id,
      price: 5,
      translations: { en: { name: drinkItem } },
    });
    await createMenuItemViaAPI(page, {
      categoryId: mains.id,
      price: 12,
      translations: { en: { name: mainItem } },
      isFeatured: true,
    });

    await page.goto("/en/admin/order-entry");

    // Tap this run's Drinks category chip → only its item shows.
    await page.getByRole("tab", { name: drinkCat, exact: true }).click();
    await expect(page.getByText(drinkItem, { exact: true })).toBeVisible();
    await expect(page.getByText(mainItem, { exact: true })).toBeHidden();

    // Featured chip → the featured main shows; the non-featured drink does not.
    await page.getByRole("tab", { name: /Featured/ }).click();
    await expect(page.getByText(mainItem, { exact: true })).toBeVisible();
    await expect(page.getByText(drinkItem, { exact: true })).toBeHidden();

    // Search overrides the active chip: while on Featured, search a non-featured
    // item in the OTHER category → it appears.
    await page.getByPlaceholder("Search menu…").fill(drinkItem);
    await expect(page.getByText(drinkItem, { exact: true })).toBeVisible();
  });
});

// Staff TAKEAWAY entry: counter takeaway (table-less session) and seated-party
// takeaway (an extra order on a table's session). Both go through the same
// POST /api/admin/orders/place + shared `placeOrder` core, so a takeaway order
// is indistinguishable downstream — it surfaces on the board, confirms, and
// settles exactly like a dine-in order. Counter takeaway settles via the
// table-less `collect` endpoint; a seated-party takeaway settles with its table
// via the session checkout (alongside the dine-in orders on that table).
//
// The lifecycle assertions are API-level (robust on the shared single-DB test
// run); one UI assertion covers the order-type toggle gating on the takeaway
// setting. Table numbers are kept high/distinct (93, 94) to avoid colliding
// with the dine-in specs above (which use 91).
test.describe("staff takeaway", () => {
  test("counter takeaway full lifecycle: place → board → confirm → collect → settled", async ({
    page,
  }) => {
    await loginAsAdmin(page, { locale: "en" });

    // Enable takeaway (the setting gates the whole feature; default false).
    const enable = await page.request.patch("/api/admin/settings", {
      data: { takeaway_enabled: "true" },
      headers: API_HEADERS,
    });
    expect(enable.ok()).toBeTruthy();

    const category = await createCategoryViaAPI(page, {
      en: "E2E Takeaway Cat",
      th: "E2E",
    });
    const item = await createMenuItemViaAPI(page, {
      categoryId: category.id,
      price: 40,
      translations: {
        en: { name: "E2E Counter Nasi" },
        th: { name: "E2E Counter Nasi" },
      },
    });

    // Place a counter takeaway: TAKEAWAY with NO tableNumber → table-less
    // session.
    const placeRes = await page.request.post("/api/admin/orders/place", {
      data: {
        orderType: "TAKEAWAY",
        customerName: "E2E Ali",
        idempotencyKey: crypto.randomUUID(),
        lines: [{ menuItemId: item.id, quantity: 1 }],
      },
      headers: API_HEADERS,
    });
    expect(placeRes.status()).toBe(201);
    const placeBody = await placeRes.json();
    expect(typeof placeBody.orderId).toBe("number");
    const orderId: number = placeBody.orderId;

    // The order surfaces on the board as a table-less takeaway with the name.
    const boardRes = await page.request.get("/api/admin/orders");
    expect(boardRes.ok()).toBeTruthy();
    const board = await boardRes.json();
    const orders: Array<Record<string, unknown>> = Array.isArray(board)
      ? board
      : (board.orders ?? []);
    const placed = orders.find(
      (o) => o.id === orderId
    ) as BoardOrder | undefined;
    expect(placed).toBeTruthy();
    expect(placed!.orderType).toBe("TAKEAWAY");
    expect(placed!.customerName).toBe("E2E Ali");
    // Table-less: the session has no table.
    expect(placed!.session?.table ?? null).toBeNull();

    // Confirm it.
    const confirmRes = await page.request.patch(
      `/api/admin/orders/${orderId}`,
      {
        data: { status: "CONFIRMED" },
        headers: API_HEADERS,
      }
    );
    expect(confirmRes.ok()).toBeTruthy();

    // Collect (settle) the table-less takeaway.
    const collectRes = await page.request.post(
      `/api/admin/orders/${orderId}/collect`,
      { headers: API_HEADERS }
    );
    expect(collectRes.ok()).toBeTruthy();
    const collectBody = await collectRes.json();
    expect(collectBody.ok).toBe(true);

    // It's now COMPLETED (settled) and off the live kitchen board, which fetches
    // only PENDING+CONFIRMED. (The bare GET /api/admin/orders returns ALL
    // statuses, so assert the COMPLETED state directly + absence from the board
    // query — the two together prove settlement.)
    const afterAll = await (await page.request.get("/api/admin/orders")).json();
    const afterAllOrders: BoardOrder[] = Array.isArray(afterAll)
      ? afterAll
      : (afterAll.orders ?? []);
    const settled = afterAllOrders.find((o) => o.id === orderId);
    expect(settled?.status).toBe("COMPLETED");
    expect(settled?.session?.status).toBe("CHECKED_OUT");

    const boardRes2 = await page.request.get(
      "/api/admin/orders?status=PENDING,CONFIRMED"
    );
    const boardOrders: BoardOrder[] = await boardRes2.json();
    expect(
      (Array.isArray(boardOrders) ? boardOrders : []).find(
        (o) => o.id === orderId
      )
    ).toBeUndefined();
  });

  test("seated-party takeaway settles with the table alongside the dine-in order", async ({
    page,
  }) => {
    await loginAsAdmin(page, { locale: "en" });

    // Idempotent re-enable (tests share a DB; order is not guaranteed).
    const enable = await page.request.patch("/api/admin/settings", {
      data: { takeaway_enabled: "true" },
      headers: API_HEADERS,
    });
    expect(enable.ok()).toBeTruthy();

    await createTableViaAPI(page, 94);
    const category = await createCategoryViaAPI(page, {
      en: "E2E Seated Cat",
      th: "E2E",
    });
    const item = await createMenuItemViaAPI(page, {
      categoryId: category.id,
      price: 25,
      translations: {
        en: { name: "E2E Seated Roti" },
        th: { name: "E2E Seated Roti" },
      },
    });

    // Place a DINE_IN order on table 94.
    const dineRes = await page.request.post("/api/admin/orders/place", {
      data: {
        orderType: "DINE_IN",
        tableNumber: 94,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ menuItemId: item.id, quantity: 1 }],
      },
      headers: API_HEADERS,
    });
    expect(dineRes.status()).toBe(201);
    const dineId: number = (await dineRes.json()).orderId;

    // Place a TAKEAWAY order on the SAME table 94 (seated party takes part of
    // their order to go).
    const takeRes = await page.request.post("/api/admin/orders/place", {
      data: {
        orderType: "TAKEAWAY",
        tableNumber: 94,
        customerName: "E2E Siti",
        idempotencyKey: crypto.randomUUID(),
        lines: [{ menuItemId: item.id, quantity: 1 }],
      },
      headers: API_HEADERS,
    });
    expect(takeRes.status()).toBe(201);
    const takeId: number = (await takeRes.json()).orderId;

    // Both orders are on the board, share one session bound to table 94, and
    // carry the right order types.
    const boardRes = await page.request.get("/api/admin/orders");
    expect(boardRes.ok()).toBeTruthy();
    const board = await boardRes.json();
    const orders: BoardOrder[] = Array.isArray(board)
      ? board
      : (board.orders ?? []);
    const dine = orders.find((o) => o.id === dineId);
    const take = orders.find((o) => o.id === takeId);
    expect(dine).toBeTruthy();
    expect(take).toBeTruthy();
    expect(dine!.orderType).toBe("DINE_IN");
    expect(take!.orderType).toBe("TAKEAWAY");
    expect(take!.customerName).toBe("E2E Siti");
    // Same session, bound to table 94.
    const sessionId = dine!.sessionId ?? dine!.session?.id;
    expect(sessionId).toBeTruthy();
    expect(take!.sessionId ?? take!.session?.id).toBe(sessionId);
    expect(dine!.session?.table?.number).toBe(94);

    // Confirm both.
    for (const id of [dineId, takeId]) {
      const res = await page.request.patch(`/api/admin/orders/${id}`, {
        data: { status: "CONFIRMED" },
        headers: API_HEADERS,
      });
      expect(res.ok()).toBeTruthy();
    }

    // Settle the whole table in one checkout.
    const checkoutRes = await page.request.post(
      `/api/sessions/${sessionId}/checkout`,
      { headers: API_HEADERS }
    );
    expect(checkoutRes.ok()).toBeTruthy();

    // Both orders settled together in one checkout → both COMPLETED, and gone
    // from the live board (PENDING+CONFIRMED query). The bare GET returns all
    // statuses, so assert COMPLETED there + absence from the board query.
    const afterAll = await (await page.request.get("/api/admin/orders")).json();
    const afterAllOrders: BoardOrder[] = Array.isArray(afterAll)
      ? afterAll
      : (afterAll.orders ?? []);
    expect(afterAllOrders.find((o) => o.id === dineId)?.status).toBe(
      "COMPLETED"
    );
    expect(afterAllOrders.find((o) => o.id === takeId)?.status).toBe(
      "COMPLETED"
    );

    const board2 = await (
      await page.request.get("/api/admin/orders?status=PENDING,CONFIRMED")
    ).json();
    const boardOrders: BoardOrder[] = Array.isArray(board2)
      ? board2
      : [];
    expect(boardOrders.find((o) => o.id === dineId)).toBeUndefined();
    expect(boardOrders.find((o) => o.id === takeId)).toBeUndefined();
  });

  test("order-type toggle is gated by the takeaway setting", async ({
    page,
  }) => {
    await loginAsAdmin(page, { locale: "en" });

    // DISABLE takeaway: the order-type toggle should not render.
    const disable = await page.request.patch("/api/admin/settings", {
      data: { takeaway_enabled: "false" },
      headers: API_HEADERS,
    });
    expect(disable.ok()).toBeTruthy();

    await page.goto("/en/admin/order-entry");
    await expect(
      page.getByRole("radio", { name: "Takeaway" })
    ).toHaveCount(0);

    // ENABLE takeaway: the toggle should render (the important direction).
    const enable = await page.request.patch("/api/admin/settings", {
      data: { takeaway_enabled: "true" },
      headers: API_HEADERS,
    });
    expect(enable.ok()).toBeTruthy();

    await page.goto("/en/admin/order-entry");
    await expect(
      page.getByRole("radio", { name: "Takeaway" })
    ).toBeVisible({ timeout: 15000 });
  });
});
