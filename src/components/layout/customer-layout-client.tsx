"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "@/i18n/navigation";
import { MobileNav } from "./mobile-nav";

interface CustomerLayoutClientProps {
  sessionId: string;
}

export function CustomerLayoutClient({ sessionId }: CustomerLayoutClientProps) {
  const [cartItemCount, setCartItemCount] = useState(0);
  const pathname = usePathname();

  // The checkout page runs its own 10s order-status poll; skip the cart-count
  // polling interval there to avoid two concurrent polls on the same screen.
  // The mount fetch + cart-updated listener still keep the badge accurate.
  const isCheckout = pathname === "/checkout";

  const fetchCartCount = useCallback(() => {
    if (!sessionId) return;
    fetch(`/api/sessions/${sessionId}/cart/count`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.count === "number") {
          setCartItemCount(data.count);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  // Fetch on mount + listen for instant cart-updated events + poll every 10s for
  // cross-device sync (polling paused on the checkout page).
  useEffect(() => {
    fetchCartCount();
    window.addEventListener("cart-updated", fetchCartCount);
    const interval = isCheckout
      ? null
      : setInterval(fetchCartCount, 10_000);
    return () => {
      window.removeEventListener("cart-updated", fetchCartCount);
      if (interval) clearInterval(interval);
    };
  }, [fetchCartCount, isCheckout]);

  return <MobileNav cartItemCount={cartItemCount} />;
}
