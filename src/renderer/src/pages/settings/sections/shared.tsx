/**
 * 设置分区共享的小部件：卡片、字段行、开关。
 * 保持与全局 UI 风格一致的极简实现，不引入额外组件库。
 */
import type { ReactNode } from "react";
import { cn } from "../../../lib/cn.ts";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-4", className)}>{children}</div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2", className)}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-text">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-text-faint">{hint}</p>}
      </div>
      {children && <div className="shrink-0 pt-0.5">{children}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-accent/60 bg-accent" : "border-border bg-surface-3",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow transition-all",
          checked ? "left-[18px]" : "left-[2px]",
        )}
      />
    </button>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        "h-8 max-w-56 rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-text",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
