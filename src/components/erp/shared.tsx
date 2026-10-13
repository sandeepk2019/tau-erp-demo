"use client";
// ============================================================================
// Tau ERP — shared UI primitives used by ALL module views.
// DataTable, StatCard, StatusBadge, SectionHeader, EmptyState, Money, etc.
// ============================================================================
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_COLORS } from "@/lib/erp/constants";
import { cn } from "@/lib/utils";
import { LucideIcon, Inbox, ShieldAlert } from "lucide-react";

// ---------------------------------------------------------------------------
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const color = STATUS_COLORS[status] ?? "zinc";
  const map: Record<string, string> = {
    zinc: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    red: "bg-red-500/15 text-red-300 border-red-500/30",
    orange: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    teal: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  };
  return (
    <Badge variant="outline" className={cn("font-medium text-[11px] px-2 py-0 whitespace-nowrap", map[color], className)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px] tracking-tight", className)}>{children}</span>;
}

export function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("tabular", className)}>
      ₹{value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
    </span>
  );
}

/**
 * Compact INR using the INDIAN short scale (k → Lakh → Crore), not the western
 * k/M/B convention. e.g. 205000 → "₹2.05L", 12345678 → "₹1.23Cr", 950 → "₹950".
 * Used for KPI cards where full en-IN grouping would overflow.
 */
export function inrCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const q = (v: number, digits: number) => {
    const s = v.toFixed(digits);
    return s.endsWith(".00") ? s.slice(0, -3) : s.replace(/0$/, "");
  };
  if (abs >= 1e7) return `${sign}₹${q(abs / 1e7, 2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${q(abs / 1e5, 2)}L`;
  if (abs >= 1e3) return `${sign}₹${q(abs / 1e3, 1)}k`;
  return `${sign}₹${q(abs, 0)}`;
}

export function DateCell({ value }: { value: string | Date | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular text-[12px]">{d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</span>;
}

// ---------------------------------------------------------------------------
export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
};

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  loading,
  emptyMessage = "No records",
  onRowClick,
  rowKey,
  maxHeight = "max-h-[62vh]",
  dense = false,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  rowKey?: (row: T, i: number) => string;
  maxHeight?: string;
  dense?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border bg-card overflow-hidden", maxHeight)}>
      <div className="erp-scroll overflow-auto" style={{ maxHeight: "inherit", height: "100%" }}>
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur border-b">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "text-left font-medium text-muted-foreground text-[11px] uppercase tracking-wider px-3 py-2 whitespace-nowrap",
                    c.className
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border/50">
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-2.5">
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row, i) : row.id ?? i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-border/40 transition-colors relative",
                    // zebra striping — subtle tint on odd rows for dense scanning
                    i % 2 === 1 && "bg-white/[0.015]",
                    onRowClick && "cursor-pointer hover:bg-accent/50",
                    onRowClick && "[&:hover>td:first-child]:shadow-[inset_2px_0_0_0_var(--primary)]"
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-3 align-middle", dense ? "py-1.5" : "py-2.5", c.className)}>
                      {c.render ? c.render(row) : (row as Record<string, unknown>)[c.key] as React.ReactNode}
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState message={emptyMessage} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Smoothly counts a numeric StatCard value up/down when the target changes.
 *  Honors `prefers-reduced-motion` — jumps straight to the target. */
function useCountUp(target: number, duration = 550): number {
  const [display, setDisplay] = React.useState(target);
  const prevRef = React.useRef(target);
  React.useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      setDisplay(Number.isInteger(target) ? Math.round(v) : Math.round(v * 10) / 10);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
}

function AnimatedValue({ value }: { value: React.ReactNode }) {
  const numeric = typeof value === "number" ? value : null;
  const animated = useCountUp(numeric ?? 0);
  return <>{numeric === null ? value : animated}</>;
}

// ---------------------------------------------------------------------------
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "good" | "warn" | "bad";
  onClick?: () => void;
}) {
  const tones = {
    default: "text-foreground",
    good: "text-emerald-400",
    warn: "text-amber-400",
    bad: "text-red-400",
  };
  return (
    <Card
      className={cn(
        "group bg-card/80 border-border/70 transition-all duration-200 relative overflow-hidden",
        onClick && "cursor-pointer hover:border-primary/40 hover:bg-card hover:-translate-y-0.5 hover:shadow-[0_6px_24px_rgba(0,0,0,0.35)]"
      )}
      onClick={onClick}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={cn("text-2xl font-semibold mt-1 tabular", tones[tone])}>
              <AnimatedValue value={value} />
            </p>
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
          </div>
          {Icon && (
            <div className="rounded-md bg-primary/10 p-2 shrink-0 transition-all duration-200 group-hover:bg-primary/20 group-hover:shadow-[0_0_14px_rgba(245,158,11,0.25)]">
              <Icon className="h-4 w-4 text-primary" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
export function SectionHeader({
  title,
  desc,
  actions,
  icon: Icon,
}: {
  title: string;
  desc?: string;
  actions?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="rounded-md bg-primary/10 p-2">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          {desc && <p className="text-[12px] text-muted-foreground">{desc}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function EmptyState({ message, icon: Icon = Inbox }: { message?: string; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2.5">
      <span className="relative flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-border/70 bg-background/40">
        <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/5 blur-md" aria-hidden />
        <Icon className="relative h-6 w-6 opacity-50" />
      </span>
      <p className="text-[13px]">{message ?? "Nothing here yet"}</p>
    </div>
  );
}

/** SYNTHETIC data banner — required on fiscal/statutory screens (spec environment rule). */
export function SyntheticBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] gap-1", className)}>
      <ShieldAlert className="h-3 w-3" />
      SYNTHETIC — NOT FOR STATUTORY USE
    </Badge>
  );
}

export function KbdHint({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

export function Progress({ value, tone = "primary" }: { value: number; tone?: "primary" | "good" | "bad" }) {
  const pct = Math.max(0, Math.min(100, value));
  const bg = tone === "good" ? "bg-emerald-500" : tone === "bad" ? "bg-red-500" : "bg-primary";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", bg)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SubTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto erp-scroll border-b border-border/70 mb-4" data-tour="tour-tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "px-3 py-2 text-[13px] whitespace-nowrap border-b-2 -mb-px transition-colors",
            value === t.key
              ? "border-primary text-primary font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
          {typeof t.count === "number" && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ items }: { items: { k: string; v: React.ReactNode }[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
      {items.map((it) => (
        <div key={it.k} className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{it.k}</span>
          <span className="text-[13px] text-right">{it.v}</span>
        </div>
      ))}
    </div>
  );
}

export function PermDenied({ perm }: { perm: string }) {
  return (
    <Card className="border-red-500/30 bg-red-500/5">
      <CardContent className="p-6 flex items-center gap-3">
        <ShieldAlert className="h-5 w-5 text-red-400 shrink-0" />
        <div>
          <p className="font-medium text-red-300">Permission denied (server-enforced RBAC)</p>
          <p className="text-[12px] text-muted-foreground">
            Your current role does not include <Mono>{perm}</Mono>. Switch user in the topbar to try the RBAC matrix.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
