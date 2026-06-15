import "next-auth";
import "next-auth/jwt";
import type { Permission } from "@/lib/permissions";

declare module "next-auth" {
  interface User {
    role: string;
    permissions: Permission[];
    tokenVersion: number;
  }

  interface Session {
    user: User & {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: string;
    permissions: Permission[];
    tokenVersion: number;
  }
}
