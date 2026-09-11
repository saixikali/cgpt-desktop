import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "border-border bg-surface-2 text-text-muted",
  accent: "border-accent/30 bg-accent-soft text-[#8cb6ff]",
  success: "border-success/30 bg-success/10 text-[#6fd4a0]",
  warning: "border-warning/30 bg-warning/10 text-[#e6bd6a]",
  danger: "border-danger/30 bg-danger/10 text-[#ef8a94]",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
