import { describe, it, expect, vi } from "vitest";
import { placeOrder, PriceChangedError, type ResolvedOrderLine } from "@/lib/place-order";
import type { ResolvedSettings } from "@/lib/settings";

// Minimal settings stub — only the fields placeOrder reads.
const baseSettings = (over: Partial<ResolvedSettings> = {}): ResolvedSettings =>
  ({
    appName: "Test",
    currency: "THB",
    decimals: 2,
    timezone: "Asia/Bangkok",
    defaultLocale: "en",
    canonicalLocale: "en",
    enabledLocales: ["en"],
    brandTheme: "green",
    brandColor: null,
    logoUrl: null,
    ...over,
  }) as ResolvedSettings;

// A menu item shaped like the Prisma include both callers produce.
function makeItem(over: Partial<ResolvedOrderLine["menuItem"]> = {}): ResolvedOrderLine["menuItem"] {
  return {
    id: 1,
    isCombo: false,
    comboBasePrice: null,
    price: 50 as unknown as never, // Prisma Decimal; placeOrder wraps in Number()
    isAvailable: true,
    names: [{ locale: "en", name: "Pad Thai", description: null }],
    optionGroups: [],
    ...over,
  } as ResolvedOrderLine["menuItem"];
}

// A fake transaction client capturing the order.create input.
function fakeTx(capturedRef: { value: unknown }) {
  return {
    order: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        capturedRef.value = data;
        return { id: 999, sessionId: "sess_1", status: "PENDING", totalAmount: (data as { totalAmount: number }).totalAmount, createdAt: new Date(0), items: [] };
      }),
    },
    session: { update: vi.fn(async () => ({})) },
  } as unknown as Parameters<typeof placeOrder>[0];
}

describe("placeOrder", () => {
  it("computes a base-only unit price and total (no options)", async () => {
    const captured = { value: null as unknown };
    const tx = fakeTx(captured);
    await placeOrder(tx, {
      session: { id: "sess_1" },
      lines: [{ menuItem: makeItem(), quantity: 2, selectedOptions: "[]" }],
      settings: baseSettings(),
    });
    const data = captured.value as { totalAmount: number; items: { create: Array<{ menuItemId: number; unitPrice: number; quantity: number; itemName: string }> } };
    expect(data.items.create[0].unitPrice).toBe(50);
    expect(data.items.create[0].quantity).toBe(2);
    expect(data.items.create[0].itemName).toBe("Pad Thai");
    expect(data.items.create[0].menuItemId).toBe(1);
    expect(data.totalAmount).toBe(100);
  });

  it("adds option price adjustments into the unit price and snapshots option names", async () => {
    const captured = { value: null as unknown };
    const tx = fakeTx(captured);
    const item = makeItem({
      optionGroups: [
        {
          id: 10,
          names: [{ locale: "en", name: "Size" }],
          choices: [{ id: 100, priceAdjustment: 10 as unknown as never, names: [{ locale: "en", name: "Large" }] }],
        },
      ] as unknown as never,
    });
    await placeOrder(tx, {
      session: { id: "sess_1" },
      lines: [{ menuItem: item, quantity: 1, selectedOptions: JSON.stringify([{ groupId: 10, choiceIds: [100] }]) }],
      settings: baseSettings(),
    });
    const data = captured.value as { items: { create: Array<{ unitPrice: number; selectedOptions: string }> } };
    expect(data.items.create[0].unitPrice).toBe(60); // 50 + 10
    const snap = JSON.parse(data.items.create[0].selectedOptions);
    expect(snap[0].priceAdjustment).toBe(10);
    expect(snap[0].groupName.en).toBe("Size");
    expect(snap[0].choiceName.en).toBe("Large");
  });

  it("throws PriceChangedError when expectedTotal differs from the recomputed total", async () => {
    const captured = { value: null as unknown };
    const tx = fakeTx(captured);
    await expect(
      placeOrder(tx, {
        session: { id: "sess_1" },
        lines: [{ menuItem: makeItem(), quantity: 1, selectedOptions: "[]" }],
        expectedTotal: 999,
        settings: baseSettings(),
      })
    ).rejects.toBeInstanceOf(PriceChangedError);
  });

  it("passes when expectedTotal matches", async () => {
    const captured = { value: null as unknown };
    const tx = fakeTx(captured);
    await expect(
      placeOrder(tx, {
        session: { id: "sess_1" },
        lines: [{ menuItem: makeItem(), quantity: 1, selectedOptions: "[]" }],
        expectedTotal: 50,
        settings: baseSettings(),
      })
    ).resolves.toBeTruthy();
  });

  it("throws on a dead option reference (selected group not on the item)", async () => {
    const captured = { value: null as unknown };
    const tx = fakeTx(captured);
    await expect(
      placeOrder(tx, {
        session: { id: "sess_1" },
        lines: [{ menuItem: makeItem(), quantity: 1, selectedOptions: JSON.stringify([{ groupId: 77, choiceIds: [1] }]) }],
        settings: baseSettings(),
      })
    ).rejects.toThrow("Some options are no longer available");
  });

  it("rounds to 0 decimals for VND", async () => {
    const captured = { value: null as unknown };
    const tx = fakeTx(captured);
    await placeOrder(tx, {
      session: { id: "sess_1" },
      lines: [{ menuItem: makeItem({ price: 50000 as unknown as never }), quantity: 3, selectedOptions: "[]" }],
      settings: baseSettings({ currency: "VND", decimals: 0 }),
    });
    const data = captured.value as { totalAmount: number };
    expect(data.totalAmount).toBe(150000);
  });
});
