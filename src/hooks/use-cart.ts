"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

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

export function useCart(sessionId: string) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch cart items
  const fetchCart = useCallback(async () => {
    if (!sessionId) return;

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch cart");
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

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, idempotencyKey }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
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
  }, [sessionId]);

  // Computed values (memoized to avoid recomputation on unrelated re-renders)
  const total = useMemo(
    () =>
      items.reduce((sum, item) => {
        // Calculate option price adjustments for this cart item
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
        const basePrice = (item.menuItem.isCombo && item.menuItem.comboBasePrice != null)
          ? item.menuItem.comboBasePrice
          : item.menuItem.price;
        return sum + Math.round((basePrice + optionAdj) * 100) * item.quantity;
      }, 0) / 100,
    [items]
  );

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
