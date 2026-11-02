import { ShieldCheck } from "lucide-react";

export function BrandMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-guardian-lime text-guardian-indigo">
        <ShieldCheck className="h-[18px] w-[18px]" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">PgGuardian</span>
    </span>
  );
}
