"use client";

import { useAuthStore, type UserRole } from "@/store/useAuthStore";

export function useRole() {
  const { user } = useAuthStore();
  const role: UserRole = user?.role ?? "Viewer";

  return {
    role,
    isAdmin: user?.role === "Admin",
    isDBA: user?.role === "DBA" || user?.role === "Admin",
    isViewer: !!user,
    hasRole: (roles: UserRole[]) => {
      if (!user?.role) return false;
      return roles.includes(user.role);
    },
  };
}
