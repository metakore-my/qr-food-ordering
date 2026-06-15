"use client";

import { useEffect, useState, useMemo } from "react";
import { useConfig } from "@/components/providers/config-provider";
import { backgroundsForCurrency } from "@/lib/backgrounds";

function shuffleIndices(length: number, avoidFirst?: number) {
  const next = Array.from({ length }, (_, index) => index);
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  if (length > 1 && avoidFirst !== undefined && next[0] === avoidFirst) {
    [next[0], next[1]] = [next[1], next[0]];
  }
  return next;
}

interface SlideState {
  order: number[];
  active: number;
  next: number;
  transitioning: boolean;
}

export function AdminBackground() {
  const { currency } = useConfig();
  // All cuisine sets are length 5 (enforced by backgrounds.test.ts). The effects
  // below key on `images.length`, so a live currency switch is a pure re-render
  // (the JSX maps over the new paths; slide indices 0..4 stay valid) — no reset
  // needed. If a future set ever had a different length, revisit that assumption.
  const images = useMemo(() => backgroundsForCurrency(currency), [currency]);

  // Start with deterministic (sequential) order to avoid hydration mismatch.
  // Math.random() can only run client-side, so we shuffle in a mount effect.
  const [slide, setSlide] = useState<SlideState>({
    order: Array.from({ length: images.length }, (_, i) => i),
    active: 0,
    next: images.length > 1 ? 1 : 0,
    transitioning: false,
  });

  // Shuffle on mount (client-only randomization).
  useEffect(() => {
    const shuffled = shuffleIndices(images.length);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: client-only Math.random() cannot run during SSR
    setSlide({
      order: shuffled,
      active: shuffled[0],
      next: shuffled.length > 1 ? shuffled[1] : shuffled[0] ?? 0,
      transitioning: false,
    });
  }, [images.length]);

  useEffect(() => {
    if (images.length <= 1) return;
    const fadeMs = 1200;
    const intervalMs = 6000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pos = 0;

    const intervalId = setInterval(() => {
      setSlide((prev) => {
        const currentOrder = prev.order;
        if (currentOrder.length === 0) return prev;
        const nextPos = (pos + 1) % currentOrder.length;
        const nextImg = currentOrder[nextPos];

        if (timeoutId) clearTimeout(timeoutId);

        timeoutId = setTimeout(() => {
          setSlide((inner) => {
            if (nextPos === 0 && currentOrder.length > 1) {
              const reshuffled = shuffleIndices(
                images.length,
                currentOrder[currentOrder.length - 1]
              );
              pos = 0;
              return {
                order: reshuffled,
                active: reshuffled[0],
                next: reshuffled.length > 1 ? reshuffled[1] : reshuffled[0] ?? 0,
                transitioning: false,
              };
            }
            pos = nextPos;
            return { ...inner, active: nextImg, transitioning: false };
          });
        }, fadeMs);

        return { ...prev, next: nextImg, transitioning: true };
      });
    }, intervalMs);

    return () => {
      clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [images.length]);

  return (
    <div
      aria-hidden="true"
      className="admin-portal-bg"
    >
      {images.map((src, index) => {
        const isActive = index === slide.active;
        const isNext = slide.transitioning && index === slide.next;
        const stateClass = isActive
          ? "is-active"
          : isNext
          ? "is-next"
          : "";
        return (
          <div
            key={src}
            className={`admin-portal-bg__slide ${stateClass}`.trim()}
            style={{
              backgroundImage: `url(${src})`,
            }}
          />
        );
      })}
      <div className="admin-portal-bg__veil" />
    </div>
  );
}
