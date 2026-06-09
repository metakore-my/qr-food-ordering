"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { Capabilities } from "@/lib/integrations";

export interface PublicConfig {
  appName: string;
  currency: string;
  decimals: number;
  defaultLocale: string;
  enabledLocales: string[];
  logoUrl: string | null;
  capabilities: Capabilities;
}

const ConfigContext = createContext<PublicConfig | null>(null);

export function ConfigProvider({ value, children }: { value: PublicConfig; children: ReactNode }) {
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): PublicConfig {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
