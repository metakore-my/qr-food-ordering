import { describe, it, expect } from "vitest";
// Import the SAME helpers the report routes use — no duplicated logic that can drift.
import {
  lineRevenue,
  clockHourProfile,
  dayOfWeekProfile,
  topItemPairs,
  channelBreakdown,
  withUtf8Bom,
  toCsv,
} from "@/lib/report-utils";

const TZ = "Asia/Bangkok"; // +07:00, DST-free — exact hour boundaries

/** Build a selectedOptions JSON snapshot from a list of price adjustments. */
function opts(...adjustments: number[]): string {
  return JSON.stringify(
    adjustments.map((priceAdjustment, i) => ({
      groupName: `G${i}`,
      choiceName: `C${i}`,
      priceAdjustment,
    }))
  );
}

describe("lineRevenue — stored option-inclusive unitPrice × quantity", () => {
  // CRITICAL: OrderItem.unitPrice is a snapshot ALREADY INCLUDING option
  // adjustments — placement stores computeUnitPrice = roundMoney(base + optionPriceTotal)
  // (order-utils.ts) verbatim (place-order.ts). So lineRevenue MUST be unitPrice × qty
  // and must NOT re-add the selectedOptions adjustments (which would double-count and make
  // per-item revenue exceed the order total). This previously double-counted; see audit.

  it("is unitPrice × quantity with no options", () => {
    expect(lineRevenue({ unitPrice: 50, quantity: 2, selectedOptions: "[]" })).toBe(100);
  });

  it("does NOT re-add option adjustments (unitPrice already includes them)", () => {
    // Real placement of base 50 + a +10 option stores unitPrice = 60 (already inclusive).
    // Revenue for qty 3 must be 60 × 3 = 180 — NOT (60 + 10) × 3 = 210.
    expect(
      lineRevenue({ unitPrice: 60, quantity: 3, selectedOptions: opts(10) })
    ).toBe(180);
  });

  it("ignores multiple option adjustments in the snapshot", () => {
    // base 80 + 10 + 5 → stored unitPrice 95; revenue qty 2 = 190, not (95+15)×2 = 220.
    expect(
      lineRevenue({ unitPrice: 95, quantity: 2, selectedOptions: opts(10, 5) })
    ).toBe(190);
  });

  it("ignores a negative (discount) adjustment in the snapshot", () => {
    // base 100 − 20 → stored unitPrice 80; revenue qty 1 = 80, not 80 − 20 = 60.
    expect(
      lineRevenue({ unitPrice: 80, quantity: 1, selectedOptions: opts(-20) })
    ).toBe(80);
  });

  it("accepts a Prisma Decimal-like unitPrice (has toString)", () => {
    const decimalLike = { toString: () => "12.5" };
    expect(
      lineRevenue({ unitPrice: decimalLike, quantity: 4, selectedOptions: opts(99) })
    ).toBe(50); // 12.5 × 4 — the option in the snapshot is ignored
  });

  it("never throws on a malformed snapshot (snapshot is not read for revenue)", () => {
    expect(
      lineRevenue({ unitPrice: 40, quantity: 1, selectedOptions: "{not json" })
    ).toBe(40);
  });

  it("per-item revenue sums to the order total (no contradiction)", () => {
    // The bug made Σ per-item lineRevenue EXCEED the order total. With the fix,
    // summing lineRevenue over an order's lines equals Σ unitPrice × qty = the total.
    const lines = [
      { unitPrice: 150, quantity: 2, selectedOptions: opts(30) }, // big upsell line
      { unitPrice: 80, quantity: 1, selectedOptions: "[]" },
    ];
    const orderTotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0); // 380
    const perItemSum = lines.reduce((s, l) => s + lineRevenue(l), 0);
    expect(perItemSum).toBe(orderTotal);
    expect(perItemSum).toBe(380);
  });
});

describe("toCsv — RFC-4180 CSV serialization (replaces exceljs for the CSV export path)", () => {
  it("joins rows with CRLF and cells with commas", () => {
    const out = toCsv([
      ["Order ID", "Total"],
      [1, 150],
      [2, 80],
    ]);
    expect(out).toBe("Order ID,Total\r\n1,150\r\n2,80");
  });

  it("quotes a field containing a comma (e.g. an option string)", () => {
    const out = toCsv([["Items"], ["Tom Yum (Size: Large, Spice: Hot) x2"]]);
    expect(out).toBe('Items\r\n"Tom Yum (Size: Large, Spice: Hot) x2"');
  });

  it("escapes embedded double-quotes by doubling them, inside quotes", () => {
    const out = toCsv([["Note"], ['He said "extra spicy"']]);
    expect(out).toBe('Note\r\n"He said ""extra spicy"""');
  });

  it("quotes a field containing a newline", () => {
    const out = toCsv([["Note"], ["line1\nline2"]]);
    expect(out).toBe('Note\r\n"line1\nline2"');
  });

  it("leaves plain fields (no comma/quote/newline) unquoted, incl. Thai/CJK", () => {
    const out = toCsv([["Dish"], ["ต้มยำกุ้ง"], ["海南鸡饭"]]);
    expect(out).toBe("Dish\r\nต้มยำกุ้ง\r\n海南鸡饭");
  });

  it("renders null/undefined as an empty field", () => {
    const out = toCsv([["a", "b", "c"], [1, null, undefined]]);
    expect(out).toBe("a,b,c\r\n1,,");
  });

  it("renders numbers without quoting", () => {
    expect(toCsv([[12.5, 0, 160000]])).toBe("12.5,0,160000");
  });
});

describe("withUtf8Bom — prepend a UTF-8 BOM so Excel-for-Windows opens CSV correctly", () => {
  const BOM = [0xef, 0xbb, 0xbf];

  it("prepends the EF BB BF byte sequence to a buffer", () => {
    const body = Buffer.from("order,total\nต้มยำกุ้ง,150", "utf-8");
    const out = Buffer.from(withUtf8Bom(body));
    expect([out[0], out[1], out[2]]).toEqual(BOM);
    // the original content is preserved after the BOM
    expect(out.subarray(3).equals(body)).toBe(true);
  });

  it("does not double-add a BOM if the buffer already starts with one", () => {
    const withBom = Buffer.concat([Buffer.from(BOM), Buffer.from("a,b", "utf-8")]);
    const out = Buffer.from(withUtf8Bom(withBom));
    // still exactly one BOM at the front (no second one inserted)
    expect([out[0], out[1], out[2]]).toEqual(BOM);
    expect([out[3], out[4], out[5]]).not.toEqual(BOM);
    expect(out.length).toBe(withBom.length);
  });

  it("accepts a Uint8Array and returns a Uint8Array", () => {
    const out = withUtf8Bom(new Uint8Array([0x61])); // "a"
    expect(out).toBeInstanceOf(Uint8Array);
    expect([out[0], out[1], out[2], out[3]]).toEqual([...BOM, 0x61]);
  });
});

describe("clockHourProfile — collapse a window into a 24h clock + peak window", () => {
  // Helper: N orders at a given UTC instant.
  function ordersAt(isoUtc: string, n: number): { createdAt: Date }[] {
    return Array.from({ length: n }, () => ({ createdAt: new Date(isoUtc) }));
  }

  it("returns 24 buckets, hour 0..23 ascending, even with no orders", () => {
    const p = clockHourProfile([], TZ);
    expect(p.buckets).toHaveLength(24);
    expect(p.buckets.map((b) => b.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(p.totalOrders).toBe(0);
    expect(p.peak).toBeNull();
  });

  it("buckets in the DEPLOYMENT timezone, not UTC", () => {
    // 12:00 UTC is 19:00 in Bangkok (+7).
    const p = clockHourProfile(ordersAt("2025-06-15T12:00:00Z", 1), TZ);
    expect(p.buckets[19].count).toBe(1);
    expect(p.buckets[12].count).toBe(0);
  });

  it("sums the SAME clock-hour across different days (the multi-day collapse)", () => {
    // Both are 19:00 Bangkok, on two different dates → one bucket, count 2.
    const p = clockHourProfile(
      [
        ...ordersAt("2025-06-15T12:00:00Z", 1),
        ...ordersAt("2025-06-18T12:00:00Z", 1),
      ],
      TZ
    );
    expect(p.buckets[19].count).toBe(2);
    expect(p.totalOrders).toBe(2);
  });

  it("computes per-bucket percentage of the total", () => {
    const p = clockHourProfile(
      [
        ...ordersAt("2025-06-15T05:00:00Z", 3), // 12:00 Bangkok
        ...ordersAt("2025-06-15T06:00:00Z", 1), // 13:00 Bangkok
      ],
      TZ
    );
    expect(p.buckets[12].percentage).toBe(75);
    expect(p.buckets[13].percentage).toBe(25);
  });

  it("identifies a single busy hour as a one-hour peak window", () => {
    const p = clockHourProfile(ordersAt("2025-06-15T12:00:00Z", 5), TZ); // 19:00 BKK
    expect(p.peak).toEqual({
      startHour: 19,
      endHour: 20, // exclusive: a one-hour window 19:00–20:00
      count: 5,
      percentage: 100,
    });
  });

  it("grows a contiguous rush (6–8 PM) into one window", () => {
    // 18:00 → 10 orders, 19:00 → 8, 20:00 → 7 (all ≥ 60% of the 10-peak),
    // 17:00 → 2 (< 60%, excluded). UTC = BKK-7: 11:00, 12:00, 13:00, 10:00.
    const p = clockHourProfile(
      [
        ...ordersAt("2025-06-15T10:00:00Z", 2), // 17:00 BKK
        ...ordersAt("2025-06-15T11:00:00Z", 10), // 18:00 BKK (peak)
        ...ordersAt("2025-06-15T12:00:00Z", 8), // 19:00 BKK
        ...ordersAt("2025-06-15T13:00:00Z", 7), // 20:00 BKK
      ],
      TZ
    );
    expect(p.peak?.startHour).toBe(18);
    expect(p.peak?.endHour).toBe(21); // 18:00–21:00 → includes 18,19,20
    expect(p.peak?.count).toBe(25); // 10+8+7
    expect(p.totalOrders).toBe(27);
  });

  it("does not merge a quiet gap into the peak window", () => {
    // Lunch rush 12:00 (10) and a separate dinner blip 19:00 (3), nothing between.
    // UTC: 05:00 and 12:00 Bangkok-time.
    const p = clockHourProfile(
      [
        ...ordersAt("2025-06-15T05:00:00Z", 10), // 12:00 BKK (peak)
        ...ordersAt("2025-06-15T12:00:00Z", 3), // 19:00 BKK
      ],
      TZ
    );
    // Peak stays the lunch hour alone — 13:00 has 0 orders, below threshold.
    expect(p.peak?.startHour).toBe(12);
    expect(p.peak?.endHour).toBe(13);
    expect(p.peak?.count).toBe(10);
  });
});

describe("clockHourProfile — bimodal, flat, and quietest", () => {
  function ordersAt(isoUtc: string, n: number): { createdAt: Date }[] {
    return Array.from({ length: n }, () => ({ createdAt: new Date(isoUtc) }));
  }

  it("detects a SECOND peak for a lunch+dinner business", () => {
    // Lunch ~12:00 BKK (8 orders) and dinner ~19:00 BKK (10 orders), dead 15:00.
    // The single greedy window would report only dinner; secondPeak must surface
    // lunch. UTC = BKK-7: 12:00→05:00, 19:00→12:00.
    const p = clockHourProfile(
      [
        ...ordersAt("2025-06-15T05:00:00Z", 8), // 12:00 BKK lunch
        ...ordersAt("2025-06-15T12:00:00Z", 10), // 19:00 BKK dinner (global peak)
      ],
      TZ
    );
    expect(p.steady).toBe(false);
    expect(p.peak?.startHour).toBe(19); // dinner is the primary
    // Lunch (8) is ≥70% of dinner's peak hour (10) → a real second rush.
    expect(p.secondPeak).not.toBeNull();
    expect(p.secondPeak?.startHour).toBe(12);
    expect(p.secondPeak?.count).toBe(8);
  });

  it("does NOT invent a second peak when the off-peak is minor", () => {
    // Dinner 19:00 (10) dominates; a tiny 12:00 blip (2) is < 70% → no 2nd peak.
    const p = clockHourProfile(
      [
        ...ordersAt("2025-06-15T05:00:00Z", 2), // 12:00 BKK
        ...ordersAt("2025-06-15T12:00:00Z", 10), // 19:00 BKK
      ],
      TZ
    );
    expect(p.secondPeak).toBeNull();
  });

  it("flags a FLAT all-day profile as steady (no manufactured peak)", () => {
    // Six active hours, all roughly equal (5–6 orders). No hour beats the active
    // mean by 1.5×, so steady = true and we don't claim a rush.
    const p = clockHourProfile(
      [
        ...ordersAt("2025-06-15T01:00:00Z", 5), // 08:00 BKK
        ...ordersAt("2025-06-15T02:00:00Z", 6), // 09:00
        ...ordersAt("2025-06-15T03:00:00Z", 5), // 10:00
        ...ordersAt("2025-06-15T04:00:00Z", 6), // 11:00
        ...ordersAt("2025-06-15T05:00:00Z", 5), // 12:00
        ...ordersAt("2025-06-15T06:00:00Z", 6), // 13:00
      ],
      TZ
    );
    expect(p.steady).toBe(true);
    expect(p.secondPeak).toBeNull(); // suppressed when steady
  });

  it("reports the quietest ACTIVE window (for promos), ignoring closed hours", () => {
    // Busy 19:00 (10), quiet 14:00 (1). Overnight zero hours must NOT be the
    // "quietest" — quietest means quietest while OPEN. UTC: 12:00 and 07:00 BKK.
    const p = clockHourProfile(
      [
        ...ordersAt("2025-06-15T12:00:00Z", 10), // 19:00 BKK
        ...ordersAt("2025-06-15T07:00:00Z", 1), // 14:00 BKK (quietest active)
      ],
      TZ
    );
    expect(p.quietest?.startHour).toBe(14);
    expect(p.quietest?.count).toBe(1);
  });
});

describe("dayOfWeekProfile — which DAYS make money", () => {
  // Build an order with N item-lines (qty 1 each, given base prices) at an instant.
  function orderAt(isoUtc: string, ...prices: number[]) {
    return {
      createdAt: new Date(isoUtc),
      items: prices.map((p) => ({ unitPrice: p, quantity: 1, selectedOptions: "[]" })),
    };
  }

  it("returns 7 buckets Monday(1)…Sunday(7), even with no orders", () => {
    const p = dayOfWeekProfile([], TZ);
    expect(p.buckets).toHaveLength(7);
    expect(p.buckets.map((b) => b.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(p.totalOrders).toBe(0);
    expect(p.busiestWeekday).toBeNull();
    expect(p.quietestWeekday).toBeNull();
  });

  it("buckets by the DEPLOYMENT-zone calendar day, not UTC", () => {
    // 2025-06-15 is a Sunday. 2025-06-15T18:00Z is 01:00 MONDAY (16th) in Bangkok
    // (+7), so it must count as Monday (weekday 1), not Sunday.
    const p = dayOfWeekProfile([orderAt("2025-06-15T18:00:00Z", 10)], TZ);
    expect(p.buckets.find((b) => b.weekday === 1)?.orders).toBe(1); // Monday
    expect(p.buckets.find((b) => b.weekday === 7)?.orders).toBe(0); // Sunday
  });

  it("sums orders, items, and revenue per weekday", () => {
    // 2025-06-16 is a Monday (00:00Z = 07:00 Mon Bangkok). Two orders that day:
    // one with 2 item-lines (10+5), one with 1 line (20). Monday: 2 orders, 3
    // items, revenue 35.
    const p = dayOfWeekProfile(
      [
        orderAt("2025-06-16T00:00:00Z", 10, 5),
        orderAt("2025-06-16T02:00:00Z", 20),
      ],
      TZ
    );
    const mon = p.buckets.find((b) => b.weekday === 1)!;
    expect(mon.orders).toBe(2);
    expect(mon.items).toBe(3);
    expect(mon.revenue).toBe(35);
  });

  it("identifies the busiest and quietest ACTIVE weekday", () => {
    // Monday 3 orders, Wednesday 1 order, nothing else. Busiest = Mon(1),
    // quietest among ACTIVE days = Wed(3) — NOT Sun/Tue which are zero (closed).
    const p = dayOfWeekProfile(
      [
        orderAt("2025-06-16T00:00:00Z", 10), // Mon
        orderAt("2025-06-16T01:00:00Z", 10), // Mon
        orderAt("2025-06-16T02:00:00Z", 10), // Mon
        orderAt("2025-06-18T01:00:00Z", 10), // Wed
      ],
      TZ
    );
    expect(p.busiestWeekday).toBe(1); // Monday
    expect(p.quietestWeekday).toBe(3); // Wednesday (the only other ACTIVE day)
    expect(p.buckets.find((b) => b.weekday === 1)?.percentage).toBe(75);
  });
});

describe("topItemPairs — attach-rate + lift (decision-grade pairs)", () => {
  type Line = { id: string; name: string };
  function order(...lines: [string, string][]): { items: Line[] } {
    return { items: lines.map(([id, name]) => ({ id, name })) };
  }
  const keyOf = (l: Line) => l.id;
  const nameOf = (l: Line) => l.name;

  // Build N copies of an order template.
  function rep(n: number, ...lines: [string, string][]): { items: Line[] }[] {
    return Array.from({ length: n }, () => order(...lines));
  }

  it("returns [] when there are no orders", () => {
    expect(topItemPairs([], keyOf, nameOf)).toEqual([]);
  });

  it("returns [] when no order has two or more distinct items", () => {
    const orders = [order(["1", "Pad Thai"]), order(["2", "Tom Yum"])];
    expect(topItemPairs(orders, keyOf, nameOf)).toEqual([]);
  });

  it("surfaces a genuine combo as a directional attach-rate sentence", () => {
    // 6 orders, all Pad Thai+Thai Tea, nothing else. anchor support = 6 (≥5),
    // attach = 100%, lift = (6·6)/(6·6) = 1.0 ... but lift 1.0 < 1.3 would drop it.
    // So add background orders of OTHER items to push P(A)·P(B) down → lift up.
    // 6 orders Pad Thai(1)+Thai Tea(2); 6 orders of unrelated Soup(3) alone.
    // N=12, count_A=6, count_B=6, both=6 → lift = 6·12/(6·6) = 2.0 ≥ 1.3. ✓
    const orders = [
      ...rep(6, ["1", "Pad Thai"], ["2", "Thai Tea"]),
      ...rep(6, ["3", "Soup"]),
    ];
    const pairs = topItemPairs(orders, keyOf, nameOf);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      anchor: "Pad Thai",
      withItem: "Thai Tea",
      bothCount: 6,
      anchorCount: 6,
      attachRate: 100,
    });
    expect(pairs[0].lift).toBeCloseTo(2.0, 5);
  });

  it("DROPS the popular-drink-pairs-everything noise (lift ≈ 1)", () => {
    // Thai Tea(99) is in nearly every order; it pairs with each food but those
    // pairings are NOT special (lift ≈ 1). A real combo of two mid-popularity
    // foods should rank ABOVE / instead of the drink pairings.
    // 10 orders: Tea + FoodX (X varies), so Tea co-occurs with everything once.
    const drinkOrders = [
      order(["99", "Thai Tea"], ["10", "F0"]),
      order(["99", "Thai Tea"], ["11", "F1"]),
      order(["99", "Thai Tea"], ["12", "F2"]),
      order(["99", "Thai Tea"], ["13", "F3"]),
      order(["99", "Thai Tea"], ["14", "F4"]),
    ];
    // Plus a real sticky combo: Chicken Rice(1) + Soup(2), 5 times, no drink.
    const comboOrders = rep(5, ["1", "Chicken Rice"], ["2", "Soup"]);
    const pairs = topItemPairs([...drinkOrders, ...comboOrders], keyOf, nameOf);
    // The Tea→Food pairs each have anchorCount(food)=1 < 5 support floor, and
    // Tea anchor attach is 20% each with lift ≈ 1 — all dropped. The combo
    // (anchor support 5, lift high) is the one that survives.
    expect(pairs.map((p) => [p.anchor, p.withItem])).toContainEqual([
      "Chicken Rice",
      "Soup",
    ]);
    expect(pairs.every((p) => p.anchor !== "Thai Tea" || p.anchorCount >= 5)).toBe(true);
  });

  it("enforces the support floor — a 100%-attach pair seen <5 times is dropped", () => {
    // A(1)+B(2) appear together in only 3 orders (anchor support 3 < 5). Even at
    // 100% attach + high lift, it must be suppressed as noise.
    const orders = [
      ...rep(3, ["1", "A"], ["2", "B"]),
      ...rep(10, ["3", "C"]), // background to keep lift high
    ];
    expect(topItemPairs(orders, keyOf, nameOf)).toEqual([]);
  });

  it("de-dupes a repeated item within ONE order (no self-pair)", () => {
    // 5 orders each with TWO Pad Thai lines + one Thai Tea. Pad Thai counts once
    // per order (anchorCount 5, not 10), and never pairs with itself.
    const orders = rep(5, ["1", "Pad Thai"], ["1", "Pad Thai"], ["2", "Thai Tea"]);
    const pairs = topItemPairs([...orders, ...rep(5, ["3", "X"])], keyOf, nameOf);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].bothCount).toBe(5);
    expect(pairs[0].anchorCount).toBe(5);
  });

  it("honours the limit, ranking by lift", () => {
    // Two independent strong combos; limit=1 keeps only the higher-lift one.
    const orders = [
      ...rep(6, ["1", "A"], ["2", "B"]), // tight A+B
      ...rep(5, ["3", "C"], ["4", "D"]), // tight C+D
      ...rep(20, ["9", "Z"]), // background
    ];
    const top1 = topItemPairs(orders, keyOf, nameOf, 1);
    expect(top1).toHaveLength(1);
  });

  it("pairs by identity, not display name — a rename does not split a pair", () => {
    // Same id "1", different display names across orders (locale/snapshot drift).
    // Must still be ONE pair with anchorCount = 6.
    const orders = [
      ...Array.from({ length: 3 }, () => ({
        items: [{ id: "1", name: "Pad Thai" }, { id: "2", name: "Tea" }],
      })),
      ...Array.from({ length: 3 }, () => ({
        items: [{ id: "1", name: "ผัดไทย" }, { id: "2", name: "Tea" }],
      })),
      ...rep(6, ["3", "Soup"]),
    ];
    const pairs = topItemPairs(orders, keyOf, nameOf);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].bothCount).toBe(6);
    expect(pairs[0].anchorCount).toBe(6);
  });

  it("anchors on the higher-attach direction (the actionable sentence)", () => {
    // Pad Thai(1) appears in 10 orders, Thai Tea(2) in 8, co-occurring in all 8.
    //   Pad Thai → Tea = 8/10 = 80%      Tea → Pad Thai = 8/8 = 100%
    // The owner should read the STRONGER cue: "100% of Thai Tea orders also got
    // Pad Thai", so the helper anchors on Thai Tea.
    const orders = [
      ...rep(8, ["1", "Pad Thai"], ["2", "Thai Tea"]),
      ...rep(2, ["1", "Pad Thai"], ["4", "Egg"]),
      ...rep(10, ["3", "Soup"]), // background → pushes lift above 1.3
    ];
    const pairs = topItemPairs(orders, keyOf, nameOf);
    const pt = pairs.find(
      (p) => p.anchor === "Thai Tea" && p.withItem === "Pad Thai"
    );
    expect(pt?.attachRate).toBe(100); // 8 of 8 Thai Tea orders
    expect(pt?.anchorCount).toBe(8);
    expect(pt?.bothCount).toBe(8);
  });
});

describe("channelBreakdown — dine-in vs takeaway split (orders, revenue, shares)", () => {
  // Build an order of a given channel with item lines (unitPrice × qty each).
  function order(
    orderType: "DINE_IN" | "TAKEAWAY",
    ...lines: [number, number][] // [unitPrice, quantity]
  ) {
    return {
      orderType,
      items: lines.map(([unitPrice, quantity]) => ({ unitPrice, quantity })),
    };
  }

  it("returns all-zero stats and 0 shares (never NaN) for empty input", () => {
    const b = channelBreakdown([]);
    expect(b.dineIn).toEqual({ orders: 0, revenue: 0, orderShare: 0, revenueShare: 0 });
    expect(b.takeaway).toEqual({ orders: 0, revenue: 0, orderShare: 0, revenueShare: 0 });
    expect(b.totalOrders).toBe(0);
    expect(b.totalRevenue).toBe(0);
    // Guard against divide-by-zero leaking through.
    expect(Number.isNaN(b.dineIn.orderShare)).toBe(false);
    expect(Number.isNaN(b.takeaway.revenueShare)).toBe(false);
  });

  it("a single dine-in order owns 100% of both shares; takeaway stays 0", () => {
    // One dine-in order of 2 lines: 50×2 + 30×1 = 130.
    const b = channelBreakdown([order("DINE_IN", [50, 2], [30, 1])]);
    expect(b.dineIn.orders).toBe(1);
    expect(b.dineIn.revenue).toBe(130);
    expect(b.dineIn.orderShare).toBe(100);
    expect(b.dineIn.revenueShare).toBe(100);
    expect(b.takeaway).toEqual({ orders: 0, revenue: 0, orderShare: 0, revenueShare: 0 });
    expect(b.totalOrders).toBe(1);
    expect(b.totalRevenue).toBe(130);
  });

  it("splits a 3 dine-in + 1 takeaway mix with exact shares", () => {
    // 3 dine-in @ 100 each (qty 1) = 300 revenue; 1 takeaway @ 100 = 100 revenue.
    // orderShare: 3/4 = 75 / 1/4 = 25. revenueShare: 300/400 = 75 / 100/400 = 25.
    const b = channelBreakdown([
      order("DINE_IN", [100, 1]),
      order("DINE_IN", [100, 1]),
      order("DINE_IN", [100, 1]),
      order("TAKEAWAY", [100, 1]),
    ]);
    expect(b.dineIn.orders).toBe(3);
    expect(b.dineIn.revenue).toBe(300);
    expect(b.dineIn.orderShare).toBe(75);
    expect(b.dineIn.revenueShare).toBe(75);
    expect(b.takeaway.orders).toBe(1);
    expect(b.takeaway.revenue).toBe(100);
    expect(b.takeaway.orderShare).toBe(25);
    expect(b.takeaway.revenueShare).toBe(25);
    expect(b.totalOrders).toBe(4);
    expect(b.totalRevenue).toBe(400);
  });

  it("uses unitPrice × quantity (option-inclusive snapshot), e.g. 30 × 2 = 60", () => {
    // unitPrice already bakes in any option adjustment (it's the stored snapshot),
    // so a 30×2 line contributes exactly 60 — lineRevenue does not re-add options.
    const b = channelBreakdown([order("TAKEAWAY", [30, 2])]);
    expect(b.takeaway.revenue).toBe(60);
    expect(b.totalRevenue).toBe(60);
  });

  it("rounds shares to 1 dp and revenue to 2 dp", () => {
    // 1 dine-in of 3 orders → 1/3 = 33.333% → 33.3 (1 dp). Revenue 10.005 → 10.01? we
    // assert 1-dp shares and 2-dp revenue cleanly: 3 orders, one per channel split.
    const b = channelBreakdown([
      order("DINE_IN", [10, 1]),
      order("TAKEAWAY", [10, 1]),
      order("TAKEAWAY", [10, 1]),
    ]);
    // 1 of 3 = 33.3%, 2 of 3 = 66.7%.
    expect(b.dineIn.orderShare).toBe(33.3);
    expect(b.takeaway.orderShare).toBe(66.7);
    // Revenue 2-dp: a fractional line 3.335 × 1 rounds to 3.34 (2 dp) when isolated.
    const r = channelBreakdown([order("DINE_IN", [3.335, 1])]);
    expect(r.dineIn.revenue).toBe(3.34);
    expect(r.totalRevenue).toBe(3.34);
  });

  it("accepts a Prisma Decimal-like unitPrice (has toString)", () => {
    const b = channelBreakdown([
      { orderType: "DINE_IN", items: [{ unitPrice: { toString: () => "12.5" }, quantity: 4 }] },
    ]);
    expect(b.dineIn.revenue).toBe(50); // 12.5 × 4
  });
});
