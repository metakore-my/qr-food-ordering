"use client";

import { createContext, useContext, useState } from "react";

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function AdminContent({ children, id }: { children: React.ReactNode; id?: string }) {
  const { collapsed } = useSidebar();

  return (
    <div
      id={id}
      className={`relative z-10 pb-20 md:pb-0 transition-all duration-200 ${
        collapsed ? "md:pl-16" : "md:pl-56"
      }`}
    >
      {children}
    </div>
  );
}
