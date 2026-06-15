"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { computeUnitPrice, computeOrderTotal } from "@/lib/order-utils";
import { useConfig } from "@/components/providers/config-provider";

interface CartItemName {
  locale: string;
  name: string;
  description: string | null;
}

interface CartOptionChoice {
  id: number;
  priceAdjustment: number;
  sortOrder: number;
  names: Array<{ locale: string; name: string }>;
}

interface CartOptionGroup {
  id: number;
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  sortOrder: number;
  names: Array<{ locale: string; name: string }>;
  choices: CartOptionChoice[];
}

interface CartMenuItem {
  id: number;
  price: number;
  isCombo: boolean;
  comboBasePrice: number | null;
  imageUrl: string | null;
  isAvailable: boolean;
  names: CartItemName[];
  optionGroups?: CartOptionGroup[];
}

export interface SelectedOption {
  groupId: number;
  choiceIds: number[];
}

export interface CartItem {
  id: number;
  menuItemId: number;
  quantity: number;
  selectedOptions: SelectedOption[];
  menuItem: CartMenuItem;
}

interface PlacedOrder {
  id: number;
  sessionId: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  items: Array<{
    id: number;
    menuItemId: number;
    quantity: number;
    unitPrice: number;
    menuItem: {
      id: number;
      imageUrl: string | null;
      names: CartItemName[];
    };
  }>;
}

/**
 * Compute the cart grand total in major units from a set of items, matching the
 * server's order math EXACTLY: per-unit `computeUnitPrice` rounded at the
 * deployment's `decimals`, then `computeOrderTotal` (both from `order-utils`,
 * the single source of truth the order route also uses). Shared by the `total`
 * memo and `placeOrder` so the amount sent as `expectedTotal` is exactly the
 * amount the customer saw AND exactly what the server recomputes — any other
 * rounding (e.g. fixed cents) drifts for 0-decimal currencies and would make
 * the PRICE_CHANGED guard reject every placement.
 */
function computeCartTotal(items: CartItem[], decimals: number): number {
  return computeOrderTotal(
    items.map((item) => {
      let optionAdj = 0;
      if (item.selectedOptions && item.menuItem.optionGroups) {
        for (const sel of item.selectedOptions) {
          const group = item.menuItem.optionGroups.find(
            (g) => g.id === sel.groupId
          );
          if (group) {
            for (const cid of sel.choiceIds) {
              const choice = group.choices.find((c) => c.id === cid);
              if (choice) optionAdj += choice.priceAdjustment;
            }
          }
        }
      }
      return {
        unitPrice: computeUnitPrice(item.menuItem, optionAdj, decimals),
        quantity: item.quantity,
      };
    }),
    decimals
  );
}

export function useCart(sessionId: string) {
  // decimals drives the per-unit rounding in computeCartTotal — it MUST match
  // the server's s.decimals or expectedTotal permanently mismatches the
  // recomputed total (an unrecoverable PRICE_CHANGED loop).
  const { decimals } = useConfig();
  const router = useRouter();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch cart items. Returns the fetched items (or null on failure) so callers
  // that need to compare against the previous state (placeOrder's 409 recovery)
  // don't have to wait for the async setState to land.
  const fetchCart = useCallback(async (): Promise<CartItem[] | null> => {
    if (!sessionId) return null;

    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/sessions/${sessionId}/cart`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch cart");
      }
      const data = await res.json();
      setItems(data.items);
      return data.items;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch cart");
      return null;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchCart();
  }, [fetchCart]);

  // Add item to cart
  const addItem = useCallback(
    async (
      menuItemId: number,
      quantity: number,
      selectedOptions?: SelectedOption[]
    ) => {
      try {
        setError(null);
        const res = await fetch(`/api/sessions/${sessionId}/cart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            menuItemId,
            quantity,
            ...(selectedOptions && selectedOptions.length > 0
              ? { selectedOptions }
              : {}),
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to add item");
        }

        // Merge POST response into local state instead of refetching
        const cartItem: CartItem = await res.json();
        setItems((prev) => {
          const existingIndex = prev.findIndex((item) => item.id === cartItem.id);
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = cartItem;
            return updated;
          }
          return [...prev, cartItem];
        });
        window.dispatchEvent(new Event("cart-updated"));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to add item";
        setError(message);
        throw err;
      }
    },
    [sessionId]
  );

  // Update item quantity
  const updateQuantity = useCallback(
    async (cartItemId: number, quantity: number) => {
      try {
        setError(null);

        if (quantity <= 0) {
          // Optimistically remove from state
          setItems((prev) => prev.filter((item) => item.id !== cartItemId));
        } else {
          // Optimistically update quantity
          setItems((prev) =>
            prev.map((item) =>
              item.id === cartItemId ? { ...item, quantity } : item
            )
          );
        }

        const res = await fetch(
          `/api/sessions/${sessionId}/cart/${cartItemId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quantity }),
          }
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to update item");
        }

        // If quantity was <= 0, no need to update state since we already removed it
        if (quantity > 0) {
          const data = await res.json();
          setItems((prev) =>
            prev.map((item) =>
              item.id === cartItemId
                ? { ...item, quantity: data.quantity }
                : item
            )
          );
        }
        window.dispatchEvent(new Event("cart-updated"));
      } catch (err) {
        // Revert optimistic update on error
        await fetchCart();
        const message =
          err instanceof Error ? err.message : "Failed to update item";
        setError(message);
        throw err;
      }
    },
    [sessionId, fetchCart]
  );

  // Remove item from cart
  const removeItem = useCallback(
    async (cartItemId: number) => {
      try {
        setError(null);

        // Optimistically remove from state
        setItems((prev) => prev.filter((item) => item.id !== cartItemId));

        const res = await fetch(
          `/api/sessions/${sessionId}/cart/${cartItemId}`,
          {
            method: "DELETE",
          }
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to remove item");
        }
        window.dispatchEvent(new Event("cart-updated"));
      } catch (err) {
        // Revert optimistic update on error
        await fetchCart();
        const message =
          err instanceof Error ? err.message : "Failed to remove item";
        setError(message);
        throw err;
      }
    },
    [sessionId, fetchCart]
  );

  // Place order
  const placeOrder = useCallback(async (): Promise<PlacedOrder> => {
    try {
      setError(null);

      // Generate idempotency key
      const idempotencyKey = `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Send the total the customer currently sees so the server can reject the
      // order (409 PRICE_CHANGED) if an admin changed a price since they last
      // saw the cart — they re-confirm the new amount rather than being silently
      // charged a price the cart never showed.
      const expectedTotal = computeCartTotal(items, decimals);

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, idempotencyKey, expectedTotal }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));

        // Price changed under the customer: refetch so the cart repaints with
        // the new prices, then surface PRICE_CHANGED (carrying the new total) so
        // the UI can prompt "prices updated — review and confirm".
        if (res.status === 409 && data.code === "PRICE_CHANGED") {
          const fresh = await fetchCart();
          // The 409 also fires when the total moved because cart LINES vanished
          // (menu item deleted → CartItem cascade, or another tab on this device
          // edited the cart) — "prices were updated" would misdescribe that. If
          // any line we just submitted is gone from the refetched cart, surface
          // CART_CHANGED instead so the UI says items were removed.
          const removed =
            fresh != null && items.some((i) => !fresh.some((f) => f.id === i.id));
          // The mismatch can also stem from stale CONFIG (admin switched
          // currency mid-session → our captured `decimals` no longer matches the
          // server's rounding, which would otherwise 409 forever). Re-render the
          // RSC tree so ConfigProvider delivers fresh currency/decimals before
          // the customer's re-confirm tap.
          router.refresh();
          const err = new Error("Price changed") as Error & {
            code?: string;
            newTotal?: number;
          };
          err.code = removed ? "CART_CHANGED" : "PRICE_CHANGED";
          err.newTotal = data.newTotal;
          throw err;
        }

        // A cart line referenced an option group/choice that no longer exists
        // (admin deleted it while the item sat in the cart). The server pruned
        // the dead references and rejected the order — refetch so the cart
        // repaints without the vanished option before the customer re-confirms.
        if (res.status === 400 && data.code === "OPTION_UNAVAILABLE") {
          await fetchCart();
        }

        // Attach the stable machine code so the UI can show a localized message
        // instead of the raw English server string.
        const err = new Error(data.error || "Failed to place order") as Error & { code?: string };
        err.code = data.code;
        throw err;
      }

      const data = await res.json();

      // Clear cart state since the server cleared the cart
      setItems([]);
      window.dispatchEvent(new Event("cart-updated"));

      return data.order;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to place order";
      setError(message);
      throw err;
    }
  }, [sessionId, items, fetchCart, decimals, router]);

  // Computed values (memoized to avoid recomputation on unrelated re-renders).
  // Shares `computeCartTotal` with `placeOrder` so the displayed total and the
  // `expectedTotal` sent to the server are computed identically.
  const total = useMemo(() => computeCartTotal(items, decimals), [items, decimals]);

  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );

  const hasUnavailable = useMemo(
    () => items.some((item) => !item.menuItem.isAvailable),
    [items]
  );

  return {
    items,
    total,
    itemCount,
    hasUnavailable,
    loading,
    error,
    addItem,
    updateQuantity,
    removeItem,
    placeOrder,
    refetch: fetchCart,
  };
}
