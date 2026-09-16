"use client";

import type { ReactNode } from "react";
import { useRole } from "@/lib/hooks/use-role";
import type { UserRole } from "@/store/useAuthStore";

interface RoleGuardProps {
  allowed: UserRole[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGuard({ allowed, children, fallback = null }: RoleGuardProps) {
  const { hasRole } = useRole();
  return hasRole(allowed) ? <>{children}</> : <>{fallback}</>;
}

export function IfAdmin({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <RoleGuard allowed={["Admin"]} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

export function IfWriter({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <RoleGuard allowed={["Admin", "DBA"]} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

export function IfViewer({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <RoleGuard allowed={["Admin", "DBA", "Viewer"]} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

export default RoleGuard;
