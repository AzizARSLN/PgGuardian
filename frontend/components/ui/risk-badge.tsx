"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, Skull, Wrench, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeProps } from "@/components/ui/badge";

export type RiskLevel = "OK" | "WARNING" | "MAINTENANCE" | "DANGEROUS" | "INFO";

export interface RiskBadgeProps extends Omit<BadgeProps, "variant" | "size"> {
  riskLevel: RiskLevel;
  showIcon?: boolean;
  size?: "sm" | "md" | "lg";
}

const riskConfig: Record<
  RiskLevel,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    className: string;
  }
> = {
  OK: {
    label: "OK",
    icon: CheckCircle2,
    className:
      "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25",
  },
  INFO: {
    label: "Bilgi",
    icon: Info,
    className:
      "bg-sky-500/15 text-sky-400 border-sky-500/30 hover:bg-sky-500/25",
  },
  WARNING: {
    label: "Uyarı",
    icon: AlertTriangle,
    className:
      "bg-orange-500/15 text-orange-400 border-orange-500/30 hover:bg-orange-500/25",
  },
  MAINTENANCE: {
    label: "Bakım",
    icon: Wrench,
    className:
      "bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25",
  },
  DANGEROUS: {
    label: "Tehlikeli",
    icon: Skull,
    className:
      "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25",
  },
};

const sizeConfig = {
  sm: "text-[10px] px-2 py-0.5 gap-1",
  md: "text-xs px-4 py-1.5 gap-2",
  lg: "text-sm px-5 py-2 gap-2",
} as const;

export function RiskBadge({
  riskLevel,
  showIcon = true,
  size = "md",
  className,
  children,
  ...props
}: RiskBadgeProps) {
  const config = riskConfig[riskLevel];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-semibold transition-colors",
        config.className,
        sizeConfig[size],
        className
      )}
      {...props}
    >
      {showIcon && <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />}
      {children ?? config.label}
    </Badge>
  );
}

export default RiskBadge;
