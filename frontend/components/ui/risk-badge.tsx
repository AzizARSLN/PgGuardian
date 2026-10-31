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
      "bg-success/15 text-success border-success/30 hover:bg-success/25",
  },
  INFO: {
    label: "Bilgi",
    icon: Info,
    className:
      "bg-info/15 text-info border-info/30 hover:bg-info/25",
  },
  WARNING: {
    label: "Uyarı",
    icon: AlertTriangle,
    className:
      "bg-warning/15 text-warning border-warning/30 hover:bg-warning/25",
  },
  MAINTENANCE: {
    label: "Bakım",
    icon: Wrench,
    className:
      "bg-warning/15 text-warning border-warning/30 hover:bg-warning/25",
  },
  DANGEROUS: {
    label: "Tehlikeli",
    icon: Skull,
    className:
      "bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25",
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
