"use client";
// ============================================================================
// Tau ERP — Planning / MRP + Administration module (Task 3-g)
// Serves TWO sidebar entries: #/planning (Forecast · MRP Workbench · History)
// and #/admin (Users & RBAC · Audit Trail · Decision Register · System).
// All mutations go through /api/plan · /api/admin · /api/audit · /api/decisions
// with server-side requirePerm + logAudit (client perms are UX only).
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { FAMILIES, ROLES, RBAC, hasPerm, type PermKey } from "@/lib/erp/constants";
import {
  DataTable, DateCell, EmptyState, Mono, PermDenied, Progress, SectionHeader,
  StatCard, StatusBadge, SubTabs, SyntheticBadge,
} from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, BadgeCheck, CalendarClock, CheckCircle2, ClipboardList, Cog, Database,
  Factory, FileWarning, Gauge, Gavel, History, PenLine, Play, Plus, ScrollText,
  ShieldCheck, ShoppingCart, TrendingUp, Wrench, X, Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirror API payloads)
// ---------------------------------------------------------------------------
type PerItemRow = {
  item: string; name: string; family: string; uom: string;
  forecastQty: number; soQty: number; gross: number;
  stockQty: number; openWoQty: number; supply: number;
  net: number; override?: boolean; hasBom: boolean; hasRoute: boolean;
};
type MrpException = {
  type: "SHORTAGE" | "CAPACITY" | "DATA" | "OVERRIDE";
  item?: string; station?: string; need?: number | string; have?: number | string;
  action?: string; reason?: string; by?: string; at?: string; from?: number; to?: number; week?: string;
};
type CapacityRow = { kind: string; pending: number; capacityPerWeek: number; loadPct: number; weeksToClear: number };
type RunDto = {
  id: string; number: string; ranAt: string; ranBy: string; suggestionCount: number;
  params: Record<string, unknown>;
  summary: { perItem?: PerItemRow[]; byFamily?: { family: string; gross: number; net: number }[]; capacity?: CapacityRow[]; plannedWOs?: number; shortages?: number; capacityOverloads?: number; suggestions?: number };
  exceptions: MrpException[];
};
type ComparisonRow = {
  item: string; family: string; override: boolean;
  planned: number; actualQty: number; doneQty: number; gap: number;
  status: "EXACT" | "OVER" | "UNDER" | "NONE";
  wos: { woNumber: string; qtyPlanned: number; qtyCompleted: number; qtyScrapped: number; status: string; priority: string; dueDate: string | null }[];
};
type ComparisonPayload = {
  run: { id: string; number: string; ranAt: string; ranBy: string; suggestionCount: number };
  rows: ComparisonRow[];
  totals: { plannedTotal: number; actualTotal: number; itemsTotal: number; itemsConverted: number; coveragePct: number };
};
type PlanResp = {
  periods: { current: string; next: string };
  periodMode?: "LIVE" | "STALE_FALLBACK";
  stats: { forecastLines: number; forecastQty: number; plannedWOs: number; shortages: number; capacityOverloads: number; lastRunNumber: string | null; lastRunAt: string | null };
  forecast: { id: string; partNumber: string; itemName: string; familyCode: string; period: string; qty: number; source: string }[];
  familyNext: { family: string; qty: number }[];
  preview: { perItem: PerItemRow[]; byFamily: { family: string; gross: number; net: number; items: number }[]; exceptions: MrpException[]; capacity: CapacityRow[]; plannedWOs: number; suggestions: number };
  lastRun: RunDto | null;
  runs: RunDto[];
};
type AdminUser = { id: string; username: string; name: string; role: string; plant: string; active: boolean; createdAt: string };
type AdminResp = {
  users: AdminUser[];
  stats: { usersTotal: number; usersActive: number; auditTotal: number; decisionsOpen: number; decisionsOverdue: number; mrpRuns: number };
};
type AuditRow = { id: string; createdAt: string; userName: string; action: string; entityType: string; entityId: string; detail: string };
type AuditResp = { rows: AuditRow[]; total: number; page: number; pageSize: number; pages: number; actions: string[] };
type DecisionRow = { id: string; ref: string; title: string; question: string; owner: string; dueDate: string | null; status: string; decision: string; notes: string; createdAt: string; updatedAt: string };
type DecisionsResp = { rows: DecisionRow[]; stats: { total: number; open: number; decided: number; closed: number; overdue: number; tbdOwnerApproval: number; approved: number } };

const FAMILY_COLORS: Record<string, string> = Object.fromEntries(FAMILIES.map((f) => [f.code, f.color]));
const TBD_MARKER = "TBD—OWNER APPROVAL REQUIRED"; // legacy marker — no longer used by seed; badge below detects it defensively
/** a register item counts as approved once a decision was recorded (DECIDED or CLOSED) — synthetic-data stance per DR-001/DR-004/DR-005 */
const isApprovedDecision = (r: DecisionRow) => (r.decision ?? "").trim().length > 0 && r.status !== "OPEN";
const PERM_GROUPS = ["dashboard", "engineering", "procurement", "inventory", "planning", "production", "quality", "sales", "admin", "audit", "decisions"] as const;
/** distinct permission keys per group across the whole matrix — for full-vs-partial cell rendering */
const GROUP_TOTAL: Record<string, number> = Object.fromEntries(
  PERM_GROUPS.map((g) => [g, new Set((Object.values(RBAC).flat() as PermKey[]).filter((p) => p.startsWith(`${g}.`))).size]),
);

const CHART_TOOLTIP = {
  contentStyle: { background: "oklch(0.21 0.006 260)", border: "1px solid oklch(0.29 0.008 260)", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "oklch(0.93 0.003 260)" },
} as const;

function famBadge(code: string) {
  const f = FAMILIES.find((x) => x.code === code);
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap">
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: f?.color ?? "#a1a1aa" }} />
      {code || "—"}
    </span>
  );
}
function num(n: number | string | undefined): string {
  if (n === undefined || n === null) return "—";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

// ===========================================================================
// MODULE ROUTER — one file, two sidebar entries
// ===========================================================================
export default function PlanningAdminView() {
  const view = useErpStore((s) => s.route.view);
  return view === "admin" ? <AdminApp /> : <PlanningApp />;
}

// ===========================================================================
// PLANNING SUB-APP (#/planning)
// ===========================================================================
function PlanningApp() {
  const sessionUser = useErpStore((s) => s.sessionUser);
  const route = useErpStore((s) => s.route);
  const [tab, setTab] = useState(route.tab || "forecast");
  const [lastRouteTab, setLastRouteTab] = useState(route.tab);
  // sync deep-link (#/planning/<tab>) at render time — avoids setState-in-effect
  if (route.tab !== lastRouteTab) {
    setLastRouteTab(route.tab);
    if (route.tab) setTab(route.tab);
  }

  const canView = hasPerm(sessionUser?.role, "planning.view");
  const canRun = hasPerm(sessionUser?.role, "planning.run");
  const { data, isLoading } = useQuery<PlanResp>({
    queryKey: ["plan"],
    queryFn: () => api<PlanResp>("/api/plan"),
    refetchInterval: 60_000,
  });

  if (!canView) return <PermDenied perm="planning.view" />;

  const shortages = data?.preview.exceptions.filter((e) => e.type === "SHORTAGE").length ?? 0;
  const overloads = data?.preview.capacity.filter((c) => c.pending > c.capacityPerWeek).length ?? 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={TrendingUp}
        title="Planning / MRP"
        desc={`Plant PLANT-PUNE · planning window ${data?.periods.current ?? "…"} → ${data?.periods.next ?? "…"} · server-side deterministic MRP`}
        actions={
          <>
            {data?.periodMode === "STALE_FALLBACK" && (
              <Badge variant="outline" className="border-orange-500/40 bg-orange-500/10 text-orange-300 text-[10px]" title="Approved forecast horizon is behind the system clock — MRP plans against the two latest periods that carry forecast rows">
                STALE FORECAST → fallback window
              </Badge>
            )}
            <SyntheticBadge />
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Forecast lines" value={data?.stats.forecastLines ?? "—"}
          sub={`${num(data?.stats.forecastQty ?? 0)} units demand (all periods)`} icon={CalendarClock}
        />
        <StatCard
          label="Planned WOs (last run)" value={data?.stats.plannedWOs ?? "—"}
          sub={data?.stats.lastRunNumber ? `from ${data.stats.lastRunNumber}` : "no run yet"} icon={Factory}
        />
        <StatCard
          label="Shortages (live)" value={data ? shortages : "—"} sub="BOM explosion vs WH-ACC/WIP stock"
          icon={AlertTriangle} tone={shortages > 0 ? "bad" : "good"}
        />
        <StatCard
          label="Capacity overloads" value={data ? overloads : "—"} sub="pending job cards > 3/kind/week"
          icon={Gauge} tone={overloads > 0 ? "warn" : "good"}
        />
      </div>

      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "forecast", label: "Forecast", count: data?.forecast.length },
          { key: "workbench", label: "MRP Workbench", count: data?.preview.perItem.length },
          { key: "history", label: "MRP History", count: data?.runs.length },
        ]}
      />

      {tab === "forecast" && <ForecastTab data={data} isLoading={isLoading} />}
      {tab === "workbench" && <WorkbenchTab data={data} isLoading={isLoading} canRun={canRun} />}
      {tab === "history" && <HistoryTab data={data} isLoading={isLoading} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Forecast
// ---------------------------------------------------------------------------
function ForecastTab({ data, isLoading }: { data?: PlanResp; isLoading: boolean }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Approved forecast by family — next period {data?.periods.next ?? "…"}
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">current period {data?.periods.current ?? "…"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.familyNext ?? []} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.008 260 / 0.5)" vertical={false} />
              <XAxis dataKey="family" tick={{ fontSize: 10, fill: "oklch(0.67 0.008 260)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.67 0.008 260)" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...CHART_TOOLTIP} cursor={{ fill: "oklch(0.3 0.008 260 / 0.25)" }} />
              <Bar dataKey="qty" name="Forecast qty" radius={[3, 3, 0, 0]}>
                {(data?.familyNext ?? []).map((e) => (
                  <Cell key={e.family} fill={FAMILY_COLORS[e.family] ?? "#a1a1aa"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <SectionHeader title="Forecast register" desc="APPROVED_FORECAST lines — MRP gross demand source (current + next period)" />
      <DataTable
        loading={isLoading}
        rows={(data?.forecast ?? []) as never[]}
        rowKey={(r) => (r as { id: string }).id}
        emptyMessage="No forecast rows — seed the SYNTHETIC dataset first"
        columns={[
          { key: "partNumber", header: "Item", render: (r) => (
            <div className="min-w-0"><Mono className="text-primary">{(r as PlanResp["forecast"][number]).partNumber}</Mono>
              <p className="text-[11px] text-muted-foreground truncate">{(r as PlanResp["forecast"][number]).itemName}</p></div>
          ) },
          { key: "familyCode", header: "Family", render: (r) => famBadge((r as PlanResp["forecast"][number]).familyCode) },
          { key: "period", header: "Period", render: (r) => <Mono>{(r as PlanResp["forecast"][number]).period}</Mono> },
          { key: "qty", header: "Qty", className: "text-right", render: (r) => <span className="tabular font-medium">{num((r as PlanResp["forecast"][number]).qty)}</span> },
          { key: "source", header: "Source", render: (r) => <Badge variant="outline" className="text-[10px] text-muted-foreground">{(r as PlanResp["forecast"][number]).source.replace(/_/g, " ")}</Badge> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: MRP Workbench
// ---------------------------------------------------------------------------
function WorkbenchTab({ data, isLoading, canRun }: { data?: PlanResp; isLoading: boolean; canRun: boolean }) {
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const [overrideRow, setOverrideRow] = useState<PerItemRow | null>(null);
  const [exFilter, setExFilter] = useState<string | null>(null); // drill-down: item/station picked from the exception chart

  const runMrp = useMutation({
    mutationFn: () => api("/api/plan", { method: "POST", body: { action: "run-mrp", horizonWeeks: 8, frozenWeeks: 2 } }),
    onSuccess: (res) => {
      const run = (res as { run: RunDto }).run;
      toast(`MRP run ${run.number} saved — ${run.suggestionCount} planned WO(s)`);
      qc.invalidateQueries({ queryKey: ["plan"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const createWos = useMutation({
    mutationFn: () => api<{ createdWOs: string[]; skipped: { item?: string }[]; runNumber: string }>("/api/plan", { method: "POST", body: { action: "create-wos" } }),
    onSuccess: (res) => {
      toast(`${res.runNumber}: created ${res.createdWOs.length} WO(s) ${res.createdWOs.join(", ") || "—"}${res.skipped.length ? ` · ${res.skipped.length} skipped (no released BOM/route)` : ""}`, res.createdWOs.length ? "ok" : "err");
      qc.invalidateQueries({ queryKey: ["plan"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const perItem = data?.preview.perItem ?? [];
  const planned = data?.preview.plannedWOs ?? 0;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Wrench}
        title="MRP workbench"
        desc="Gross = approved forecast (current+next period) + open SO · Supply = FG IN_STOCK serials + open WO balance · Net exploded over released BOMs"
        actions={
          <>
            <Button size="sm" onClick={() => runMrp.mutate()} disabled={!canRun || runMrp.isPending} title={canRun ? "Compute + persist a new MRP run" : "Requires planning.run (server-enforced)"}>
              <Play className="h-3.5 w-3.5 mr-1.5" /> Run MRP
            </Button>
            <Button size="sm" variant="outline" onClick={() => createWos.mutate()} disabled={!canRun || createWos.isPending || planned === 0} title="Create CREATED work orders for net FG requirements">
              <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Create suggested WOs ({planned})
            </Button>
          </>
        }
      />

      {/* per-family requirements */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Per-family requirements (live preview)</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              dense maxHeight="max-h-56"
              loading={isLoading}
              rows={(data?.preview.byFamily ?? []).map((f, i) => ({ id: f.family, ...f })) as never[]}
              rowKey={(r) => (r as { id: string }).id}
              emptyMessage="No demand"
              columns={[
                { key: "family", header: "Family", render: (r) => famBadge((r as { family: string }).family) },
                { key: "items", header: "Items", className: "text-right", render: (r) => <span className="tabular">{(r as { items: number }).items}</span> },
                { key: "gross", header: "Gross", className: "text-right", render: (r) => <span className="tabular">{num((r as { gross: number }).gross)}</span> },
                { key: "net", header: "Net", className: "text-right", render: (r) => (
                  <span className={`tabular font-medium ${(r as { net: number }).net > 0 ? "text-amber-300" : "text-emerald-300"}`}>{num((r as { net: number }).net)}</span>
                ) },
              ]}
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Capacity check — open job cards per workstation kind</CardTitle>
            <p className="text-[11px] text-muted-foreground font-normal">Limit: 3 PENDING/READY jobs per kind per week · overload flags an MRP exception</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && <div className="h-16 rounded bg-muted animate-pulse" />}
            {!isLoading && (data?.preview.capacity.length ?? 0) === 0 && (
              <EmptyState icon={BadgeCheck} message="No open job cards — capacity clear." />
            )}
            {(data?.preview.capacity ?? []).map((c) => (
              <div key={c.kind} className="space-y-1">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium">{c.kind.replace(/_/g, " ")}</span>
                  <span className={c.pending > c.capacityPerWeek ? "text-red-300 tabular" : "text-muted-foreground tabular"}>
                    {c.pending} queued · {c.capacityPerWeek}/week · {c.loadPct}% load · clears in {c.weeksToClear}w
                  </span>
                </div>
                <Progress value={c.loadPct} tone={c.loadPct > 100 ? "bad" : c.loadPct >= 80 ? "primary" : "good"} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* per-item net requirements (planner-editable) */}
      <SectionHeader title="Net requirements by finished item" desc="Edit net requirement per row = planner override (mandatory reason, audited, stored in the MRP run)" />
      <DataTable
        loading={isLoading}
        rows={perItem as never[]}
        rowKey={(r) => (r as PerItemRow).item}
        emptyMessage="No finished items"
        columns={[
          { key: "item", header: "Finished item", render: (r) => {
            const row = r as PerItemRow;
            return (
              <div className="min-w-0">
                <Mono className="text-primary">{row.item}</Mono>
                <p className="text-[11px] text-muted-foreground truncate max-w-56">{row.name}</p>
              </div>
            );
          } },
          { key: "family", header: "Family", render: (r) => famBadge((r as PerItemRow).family) },
          { key: "gross", header: "Gross req", className: "text-right", render: (r) => {
            const row = r as PerItemRow;
            return (
              <div className="text-right">
                <span className="tabular font-medium">{num(row.gross)}</span>
                <p className="text-[10px] text-muted-foreground tabular">FC {num(row.forecastQty)} · SO {num(row.soQty)}</p>
              </div>
            );
          } },
          { key: "supply", header: "Supply", className: "text-right", render: (r) => {
            const row = r as PerItemRow;
            return (
              <div className="text-right">
                <span className="tabular font-medium">{num(row.supply)}</span>
                <p className="text-[10px] text-muted-foreground tabular">stock {num(row.stockQty)} · WO {num(row.openWoQty)}</p>
              </div>
            );
          } },
          { key: "net", header: "Net req", className: "text-right", render: (r) => {
            const row = r as PerItemRow;
            return (
              <span className={`inline-flex items-center gap-1 tabular font-semibold ${row.net > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                {num(row.net)}
                {row.override && <PenLine className="h-3 w-3 text-teal-300" aria-label="planner override" />}
              </span>
            );
          } },
          { key: "md", header: "BOM / Route", render: (r) => {
            const row = r as PerItemRow;
            return (
              <span className="inline-flex gap-1">
                <Badge variant="outline" className={`text-[10px] ${row.hasBom ? "border-emerald-500/40 text-emerald-300" : "border-red-500/40 text-red-300"}`}>BOM {row.hasBom ? "✓" : "—"}</Badge>
                <Badge variant="outline" className={`text-[10px] ${row.hasRoute ? "border-emerald-500/40 text-emerald-300" : "border-red-500/40 text-red-300"}`}>RTE {row.hasRoute ? "✓" : "—"}</Badge>
              </span>
            );
          } },
          { key: "act", header: "", className: "text-right", render: (r) => {
            const row = r as PerItemRow;
            return (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={!canRun} onClick={() => setOverrideRow(row)} title={canRun ? "Override net requirement (reason mandatory)" : "Requires planning.run"}>
                <PenLine className="h-3 w-3 mr-1" /> Override
              </Button>
            );
          } },
        ]}
      />

      {/* exceptions — drill-down chart (click-to-filter) + log */}
      <SectionHeader title="MRP exceptions" desc="SHORTAGE · CAPACITY · DATA — every run stores its exceptions immutably · click a chart bar to drill into one subject" />
      <ExceptionDrilldown exceptions={data?.preview.exceptions ?? []} loading={isLoading} filter={exFilter} onFilter={setExFilter} />

      <OverrideDialog row={overrideRow} onClose={() => setOverrideRow(null)} />
    </div>
  );
}

function ExceptionList({ exceptions, loading }: { exceptions: MrpException[]; loading?: boolean }) {
  if (loading) return <Card><CardContent className="p-4 h-24 rounded bg-muted animate-pulse" /></Card>;
  if (!exceptions.length) {
    return (
      <Card><CardContent className="p-2">
        <EmptyState icon={BadgeCheck} message="No exceptions — demand fully covered by stock and open work orders." />
      </CardContent></Card>
    );
  }
  const meta: Record<string, { icon: React.ComponentType<{ className?: string }>; cls: string; label: string }> = {
    SHORTAGE: { icon: AlertTriangle, cls: "text-red-400", label: "SHORTAGE" },
    CAPACITY: { icon: Gauge, cls: "text-amber-400", label: "CAPACITY" },
    DATA: { icon: FileWarning, cls: "text-orange-400", label: "MASTER DATA" },
    OVERRIDE: { icon: PenLine, cls: "text-teal-300", label: "PLANNER OVERRIDE" },
  };
  return (
    <div className="space-y-2">
      {exceptions.map((e, i) => {
        const m = meta[e.type] ?? meta.DATA;
        const Icon = m.icon;
        const subject = e.type === "CAPACITY" ? `Station ${e.station}` : e.item;
        const compare = e.type === "OVERRIDE"
          ? `net ${num(e.from)} → ${num(e.to)} · by ${e.by}${e.at ? ` · ${new Date(e.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}`
          : `need ${typeof e.need === "number" ? num(e.need) : e.need ?? "—"} · have ${typeof e.have === "number" ? num(e.have) : e.have ?? "—"}`;
        return (
          <div key={`${e.type}-${e.item ?? e.station}-${i}`} className="flex items-start gap-2.5 rounded-md border border-border/60 bg-background/40 p-2.5">
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${m.cls}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={m.label} />
                <Mono className="text-[12px] font-medium">{subject}</Mono>
                <span className="text-[11px] text-muted-foreground tabular">{compare}</span>
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {e.type === "OVERRIDE" ? `Reason: ${e.reason}` : e.action}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OverrideDialog({ row, onClose }: { row: PerItemRow | null; onClose: () => void }) {
  return <OverrideForm key={row?.item ?? "none"} row={row} onClose={onClose} />;
}

// ---------------------------------------------------------------------------
// MRP exception drill-down — aggregated bar chart (gap = need − have per
// item/station) + click-to-filter exception log. Pure client-side over the
// preview exceptions; CAPACITY uses station, others use item.
// ---------------------------------------------------------------------------
const EXC_COLORS: Record<string, string> = {
  SHORTAGE: "#f87171", // red-400
  CAPACITY: "#fbbf24", // amber-400
  DATA: "#fb923c", // orange-400
  OVERRIDE: "#2dd4bf", // teal-400
};
const excSubject = (e: MrpException) => (e.type === "CAPACITY" ? e.station : e.item) || "—";
/** need/have may be numeric OR a display string like "490 Nos" / "0 (lot rejected)" / "0.42 Kg" — extract the leading number. */
function parseQty(v: number | string | undefined): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = /-?\d+(\.\d+)?/.exec(v);
  return m ? parseFloat(m[0]) : null;
}
const LOG_MIN = 0.1; // log-scale floor so zero-gap subjects still render a sliver

function ExceptionDrilldown({ exceptions, loading, filter, onFilter }: {
  exceptions: MrpException[]; loading?: boolean; filter: string | null; onFilter: (f: string | null) => void;
}) {
  const rows = useMemo(() => {
    const map = new Map<string, { key: string; type: MrpException["type"]; gap: number; count: number }>();
    for (const e of exceptions) {
      const key = excSubject(e);
      const need = parseQty(e.need);
      const have = parseQty(e.have);
      const gap = need !== null && have !== null ? Math.max(0, need - have) : 0;
      const prev = map.get(key);
      map.set(key, {
        key,
        type: prev?.type === "SHORTAGE" || e.type === "SHORTAGE" ? "SHORTAGE" : e.type,
        gap: prev ? prev.gap + gap : gap,
        count: prev ? prev.count + 1 : 1,
      });
    }
    return [...map.values()].sort((a, b) => b.gap - a.gap || b.count - a.count).slice(0, 10);
  }, [exceptions]);

  const list = useMemo(
    () => (filter ? exceptions.filter((e) => excSubject(e) === filter) : exceptions),
    [exceptions, filter],
  );

  if (loading) return <Card><CardContent className="h-56 rounded bg-muted animate-pulse" /></Card>;
  if (!rows.length) return <ExceptionList exceptions={[]} />; // keeps the "no exceptions" empty state

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
      <Card className="xl:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Exception drill-down — gap by subject</CardTitle>
          <p className="text-[11px] text-muted-foreground font-normal">
            Bar = gap (need − have, units vary: Nos/Kg/jobs) on a log scale so 490-piece shortages and 2-job overloads share one axis · click a bar to filter the log
          </p>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 28, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.29 0.008 260)" horizontal={false} />
              <XAxis type="number" scale="log" domain={[LOG_MIN, "dataMax"]} allowDataOverflow ticks={[0.1, 1, 10, 100, 1000]}
                tick={{ fill: "oklch(0.65 0.01 260)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="key" width={122} tick={{ fill: "oklch(0.87 0.005 260)", fontSize: 11, fontFamily: "var(--font-mono), monospace" }} axisLine={false} tickLine={false} />
              <Tooltip {...CHART_TOOLTIP} cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                formatter={(v, _n, item) => {
                  const p = (item as { payload?: { gap: number; count: number } } | undefined)?.payload;
                  return [`${num(p?.gap ?? Number(v))} · ${p?.count ?? 1} exception(s)`, "Gap (log scale)"];
                }} />
              <Bar dataKey="gap" radius={[0, 4, 4, 0]} barSize={18} cursor="pointer" onClick={(d: { key?: string }) => onFilter(filter === d.key ? null : d.key ?? null)}>
                {rows.map((r) => (
                  <Cell key={r.key} fill={EXC_COLORS[r.type] ?? "#a1a1aa"} fillOpacity={filter && filter !== r.key ? 0.3 : 0.9} stroke={filter === r.key ? "oklch(0.93 0.003 260)" : "none"} strokeWidth={filter === r.key ? 1.5 : 0} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            {(["SHORTAGE", "CAPACITY", "DATA", "OVERRIDE"] as const).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="h-2 w-2 rounded-sm" style={{ background: EXC_COLORS[t] }} /> {t}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2 min-w-0">
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">
            Exception log <span className="font-normal text-muted-foreground">· {list.length} record{list.length === 1 ? "" : "s"}</span>
          </CardTitle>
          {filter && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onFilter(null)}>
              <X className="h-3 w-3 mr-1" /> Clear filter
            </Button>
          )}
        </CardHeader>
        <CardContent className="min-w-0">
          {filter && (
            <p className="text-[11px] text-muted-foreground mb-2">
              Drilled into <Mono className="text-primary">{filter}</Mono> — {list.length} related exception{list.length === 1 ? "" : "s"}
            </p>
          )}
          <div className="max-h-64 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {list.length === 0 ? (
              <p className="text-[12px] text-muted-foreground py-8 text-center">No exceptions match this drill-down.</p>
            ) : (
              <ExceptionList exceptions={list} />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OverrideForm({ row, onClose }: { row: PerItemRow | null; onClose: () => void }) {
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const [net, setNet] = useState(row ? String(row.net) : "");
  const [reason, setReason] = useState("");

  const m = useMutation({
    mutationFn: () => api("/api/plan", { method: "POST", body: { action: "override", item: row?.item, net: Number(net), reason } }),
    onSuccess: () => {
      toast(`Override saved for ${row?.item} — recorded in MRP run (audited)`);
      qc.invalidateQueries({ queryKey: ["plan"] });
      onClose();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const netNum = Number(net);
  const valid = row !== null && Number.isFinite(netNum) && netNum >= 0 && reason.trim().length >= 4;

  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><PenLine className="h-4 w-4 text-primary" /> Planner override — {row?.item}</DialogTitle>
          <DialogDescription>
            MRP computed net <Mono>{num(row?.net ?? 0)}</Mono> for {row?.name}. Overrides replace the net requirement used by &quot;Create suggested WOs&quot; and are stored in the run with your name (audit UPDATE).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">New net requirement ({row?.uom ?? "Nos"})</label>
            <Input type="number" min={0} step="1" value={net} onChange={(e) => setNet(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Reason (mandatory — audit evidence)</label>
            <Textarea placeholder="e.g. Customer VeLoce pulled forward 20 units to W+2 — confirmed on call 12-05" value={reason} onChange={(e) => setReason(e.target.value)} />
            {!reason.trim() && <p className="text-[11px] text-red-400">A reason is required before the override can be saved.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!valid || m.isPending} onClick={() => m.mutate()}>Save override</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tab: MRP History
// ---------------------------------------------------------------------------
function HistoryTab({ data, isLoading }: { data?: PlanResp; isLoading: boolean }) {
  const [detail, setDetail] = useState<RunDto | null>(null);
  return (
    <div className="space-y-3">
      <SectionHeader title="MRP run history" desc="Every run persists params, per-item summary and exceptions — immutable planning record" />
      <DataTable
        loading={isLoading}
        rows={(data?.runs ?? []) as never[]}
        rowKey={(r) => (r as RunDto).id}
        onRowClick={(r) => setDetail(r as RunDto)}
        emptyMessage="No MRP runs yet — run MRP in the workbench"
        columns={[
          { key: "number", header: "Run", render: (r) => <Mono className="text-primary">{(r as RunDto).number}</Mono> },
          { key: "ranAt", header: "Ran at", render: (r) => {
            const d = new Date((r as RunDto).ranAt);
            return (
              <span className="inline-flex items-center gap-2">
                <DateCell value={d} />
                <span className="text-[11px] text-muted-foreground tabular">{d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
              </span>
            );
          } },
          { key: "ranBy", header: "Ran by", render: (r) => <Mono>{(r as RunDto).ranBy || "system"}</Mono> },
          { key: "horizon", header: "Params", render: (r) => {
            const p = (r as RunDto).params;
            return <span className="text-[11px] text-muted-foreground">H {String(p.horizonWeeks ?? "—")}w · F {String(p.frozenWeeks ?? "—")}w</span>;
          } },
          { key: "suggestionCount", header: "Planned WOs", className: "text-right", render: (r) => <span className="tabular font-medium">{(r as RunDto).suggestionCount}</span> },
          { key: "exceptions", header: "Exceptions", className: "text-right", render: (r) => {
            const ex = (r as RunDto).exceptions;
            const bad = ex.filter((e) => e.type === "SHORTAGE").length;
            return <span className={`tabular ${bad > 0 ? "text-red-300 font-medium" : "text-muted-foreground"}`}>{ex.length}</span>;
          } },
          { key: "act", header: "", className: "text-right", render: (r) => <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]">Detail</Button> },
        ]}
      />
      <RunDetailDialog run={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function RunDetailDialog({ run, onClose }: { run: RunDto | null; onClose: () => void }) {
  // Planned-vs-actual comparison (fetched for the open run only)
  const cmpQ = useQuery<ComparisonPayload>({
    queryKey: ["plan-comparison", run?.id],
    queryFn: () => api<ComparisonPayload>(`/api/plan/comparison?runId=${encodeURIComponent(run!.id)}`),
    enabled: !!run,
  });
  // MRP shortage → draft PO conversion (plan-to-procure loop); keyed remount resets per run
  const sessionUser = useErpStore((s) => s.sessionUser);
  const canConvert = !!sessionUser && hasPerm(sessionUser.role, "planning.run");
  const shortageCount = run?.exceptions.filter((e) => e.type === "SHORTAGE").length ?? 0;
  return (
    <Dialog open={run !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl xl:max-w-5xl max-h-[88vh] overflow-y-auto overflow-x-hidden erp-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" /> {run?.number}</DialogTitle>
          <DialogDescription>
            Ran by <Mono>{run?.ranBy}</Mono> · <DateCell value={run?.ranAt} /> · {run?.suggestionCount} planned WO(s) · {run?.exceptions.length} exception(s)
          </DialogDescription>
        </DialogHeader>
        {run && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <KV k="Horizon" v={`${String(run.params.horizonWeeks ?? "—")} weeks`} />
              <KV k="Frozen weeks" v={String(run.params.frozenWeeks ?? "—")} />
              <KV k="Planned WOs" v={String(run.summary.plannedWOs ?? run.suggestionCount)} />
              <KV k="Shortages" v={String(run.summary.shortages ?? shortageCount)} />
            </div>
            <PurchaseCoverage
              key={run.id}
              run={run} shortageCount={shortageCount} canConvert={canConvert}
            />
            <PlannedVsActual cmp={cmpQ.data} isLoading={cmpQ.isLoading} />
            {run.summary.perItem && run.summary.perItem.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Stored per-item summary</p>
                <DataTable
                  dense maxHeight="max-h-52"
                  rows={run.summary.perItem as never[]}
                  rowKey={(r) => (r as PerItemRow).item}
                  columns={[
                    { key: "item", header: "Item", render: (r) => <Mono>{(r as PerItemRow).item}</Mono> },
                    { key: "family", header: "Family", render: (r) => famBadge((r as PerItemRow).family) },
                    { key: "gross", header: "Gross", className: "text-right", render: (r) => <span className="tabular">{num((r as PerItemRow).gross)}</span> },
                    { key: "supply", header: "Supply", className: "text-right", render: (r) => <span className="tabular">{num((r as PerItemRow).supply)}</span> },
                    { key: "net", header: "Net", className: "text-right", render: (r) => (
                      <span className={`tabular ${(r as PerItemRow).net > 0 ? "text-amber-300" : "text-emerald-300"}`}>{num((r as PerItemRow).net)}</span>
                    ) },
                  ]}
                />
              </div>
            )}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Stored exceptions</p>
              <ExceptionList exceptions={run.exceptions} />
            </div>
            <RawJson title="paramsJson" json={run.params} />
            <RawJson title="summaryJson" json={run.summary} />
            <RawJson title="exceptionsJson" json={run.exceptions} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
      <p className="text-[13px] font-medium tabular mt-0.5">{v}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MRP shortage → draft PO conversion (plan-to-procure loop)
// ---------------------------------------------------------------------------
type ConvertPosResult = {
  createdPos: {
    poNumber: string; supplier: string; lines: number; amount: number; etaDays?: number; urgent?: boolean;
    etaLines?: { partNumber: string; qty: number; etaDays: number; etaSource: string; soDriven: boolean }[];
  }[];
  skipped: { item: string; reason: string }[];
  runNumber: string;
};

function PurchaseCoverage({
  run, shortageCount, canConvert,
}: {
  run: RunDto; shortageCount: number; canConvert: boolean;
}) {
  const qc = useQueryClient();
  const [convResult, setConvResult] = useState<ConvertPosResult | null>(null);
  const conv = useMutation({
    mutationFn: () =>
      api<ConvertPosResult>("/api/plan", { body: { action: "create-pos", runId: run.id } }),
    onSuccess: (d) => {
      setConvResult(d);
      qc.invalidateQueries({ queryKey: ["plan"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Purchase coverage</p>
        <Badge variant="outline" className={`text-[10px] ${shortageCount ? "border-amber-500/40 text-amber-300" : "border-emerald-500/40 text-emerald-300"}`}>
          {shortageCount} shortage exception{shortageCount === 1 ? "" : "s"}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          {convResult && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setConvResult(null)}>Clear</Button>
          )}
          {canConvert ? (
            <Button
              size="sm"
              className="h-7 px-3 text-[11px] gap-1.5"
              disabled={conv.isPending || shortageCount === 0}
              onClick={() => conv.mutate()}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              {conv.isPending ? "Converting…" : "Create draft POs from shortages"}
            </Button>
          ) : (
            <span className="text-[11px] text-muted-foreground" title="server-enforced RBAC">
              Planner role (planning.run) required to convert
            </span>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Converts SHORTAGE exceptions into DRAFT purchase orders — supplier sourced from the last PO (fallback: best RFQ
        quotation), quantities netted against open PO lines. <span className="text-amber-300/90">POs stay DRAFT: four-eyes
        approval by the Purchase Manager is still required (SoD).</span> Make items are skipped — convert them to work
        orders instead. <span className="text-red-300/90">Urgency: shortages driven by open SO demand get an EXPEDITE
        ETA of +7 days (forecast-only +14 days).</span> <span className="text-teal-300/90">ETA basis per line: quotation
        lead → item-master proc lead → default; firm SO demand compresses the ETA to the 7-day expedite floor.</span>
      </p>
      {conv.isError && (
        <p className="text-[12px] text-red-400 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5">
          Conversion failed — {conv.error.message}
        </p>
      )}
      {convResult && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> {convResult.createdPos.length} draft PO(s) created
            </span>
            {convResult.createdPos.map((p) => (
              <span key={p.poNumber} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px]">
                <Mono className="text-emerald-200">{p.poNumber}</Mono>
                <span className="text-muted-foreground">{p.supplier}</span>
                <span className="tabular text-muted-foreground">· {p.lines} line(s) · ₹{p.amount.toLocaleString("en-IN")}</span>
                {typeof p.etaDays === "number" && (
                  <span className="tabular text-muted-foreground">· ETA +{p.etaDays}d</span>
                )}
                {p.urgent && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-red-500/50 bg-red-500/10 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wider text-red-300" title="SO-driven shortage — firm customer demand">
                    <Zap className="h-2.5 w-2.5" /> expedite
                  </span>
                )}
              </span>
            ))}
          </div>
          {convResult.createdPos.length > 0 && (
            <div className="rounded border border-border/50">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2.5 pt-1.5">Created POs — per-line ETA basis (quotation / item master / default)</p>
              <div className="overflow-x-auto erp-scroll">
              <table className="w-full min-w-[520px] text-[11.5px]">
                <tbody>
                  {convResult.createdPos.map((p) => (
                    <React.Fragment key={p.poNumber}>
                      {(p.etaLines ?? []).map((l, i) => (
                        <tr key={`${p.poNumber}-${l.partNumber}`} className="border-t border-border/40">
                          <td className="px-2.5 py-1"><Mono className="text-emerald-300">{i === 0 ? p.poNumber : ""}</Mono></td>
                          <td className="px-2.5 py-1"><Mono>{l.partNumber}</Mono></td>
                          <td className="px-2.5 py-1 tabular text-muted-foreground">×{l.qty}</td>
                          <td className="px-2.5 py-1 tabular">ETA +{l.etaDays}d</td>
                          <td className="px-2.5 py-1">
                            <span className="rounded bg-teal-500/10 border border-teal-500/30 px-1.5 py-0.5 text-[10px] text-teal-300" title="ETA source: supplier quotation lead → item-master proc lead → default">{l.etaSource}</span>
                            {l.soDriven && (
                              <span className="ml-1 inline-flex items-center gap-0.5 rounded-full border border-red-500/50 bg-red-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-red-300" title="Firm SO demand — ETA compressed to the 7-day expedite floor">
                                <Zap className="h-2.5 w-2.5" /> so-driven
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!(p.etaLines ?? []).length && (
                        <tr className="border-t border-border/40">
                          <td className="px-2.5 py-1"><Mono className="text-emerald-300">{p.poNumber}</Mono></td>
                          <td className="px-2.5 py-1 text-muted-foreground" colSpan={4}>{p.lines} line(s) · ₹{p.amount.toLocaleString("en-IN")}{typeof p.etaDays === "number" ? ` · ETA +${p.etaDays}d` : ""}</td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
          {convResult.skipped.length > 0 && (
            <div className="rounded border border-border/50">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2.5 pt-1.5">Skipped items ({convResult.skipped.length})</p>
              <div className="overflow-x-auto erp-scroll">
              <table className="w-full min-w-[420px] text-[11.5px]">
                <tbody>
                  {convResult.skipped.map((s, i) => (
                    <tr key={`${s.item}-${i}`} className="border-t border-border/40">
                      <td className="px-2.5 py-1"><Mono>{s.item}</Mono></td>
                      <td className="px-2.5 py-1 text-muted-foreground">{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
          <p className="text-[10.5px] text-muted-foreground">
            Review the draft PO(s) in Procurement → Purchase Orders, then submit for approval.
          </p>
        </div>
      )}
    </div>
  );
}

const CMP_TONE: Record<ComparisonRow["status"], string> = {
  EXACT: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  OVER: "border-teal-500/40 bg-teal-500/10 text-teal-300",
  UNDER: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  NONE: "border-red-500/40 bg-red-500/10 text-red-300",
};

/** Planned-vs-actual conversion view for one MRP run (work orders actually created FROM the run). */
function PlannedVsActual({ cmp, isLoading }: { cmp?: ComparisonPayload; isLoading: boolean }) {
  if (isLoading) return <p className="text-[11.5px] text-muted-foreground">Loading planned-vs-actual…</p>;
  if (!cmp || cmp.rows.length === 0) {
    return (
      <div>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Planned vs actual</p>
        <p className="text-[12px] text-muted-foreground">This run stored no per-item suggestions — create a new MRP run to track conversions.</p>
      </div>
    );
  }
  const t = cmp.totals;
  const maxQty = Math.max(1, ...cmp.rows.map((r) => Math.max(r.planned, r.actualQty)));
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Planned vs actual — WOs created from {cmp.run.number}</p>
        <span className="text-[10.5px] text-muted-foreground">only WOs whose traveller references this run are counted (SO-driven WOs excluded)</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <KV k="Planned qty" v={String(t.plannedTotal)} />
        <KV k="Actual (WO qty)" v={String(t.actualTotal)} />
        <KV k="Coverage" v={`${t.coveragePct}%`} />
        <KV k="Items converted" v={`${t.itemsConverted} / ${t.itemsTotal}`} />
      </div>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="overflow-x-auto erp-scroll">
        <table className="w-full min-w-[560px] text-[11.5px]">
          <thead>
            <tr className="bg-background/60 text-muted-foreground">
              <th className="text-left px-2.5 py-1.5 font-medium">Item</th>
              <th className="text-right px-2 py-1.5 font-medium">Planned</th>
              <th className="text-right px-2 py-1.5 font-medium">Actual</th>
              <th className="text-right px-2 py-1.5 font-medium">Gap</th>
              <th className="text-left px-2 py-1.5 font-medium w-[34%]">Planned ▮ vs actual ▮</th>
              <th className="text-left px-2 py-1.5 font-medium">WOs</th>
            </tr>
          </thead>
          <tbody>
            {cmp.rows.map((r) => (
              <tr key={r.item} className="border-t border-border/40">
                <td className="px-2.5 py-1.5">
                  <Mono className="text-foreground/90">{r.item}</Mono>
                  {r.override && <span className="ml-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[9px] text-amber-300">OVERRIDE</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular text-amber-300 font-medium">{r.planned}</td>
                <td className="px-2 py-1.5 text-right tabular text-emerald-300 font-medium">{r.actualQty}</td>
                <td className={cnGap(r.gap)}>{r.gap > 0 ? `+${r.gap}` : r.gap}</td>
                <td className="px-2 py-1.5">
                  <div className="space-y-0.5">
                    <div className="h-1.5 rounded-full bg-amber-400/25 overflow-hidden">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${(r.planned / maxQty) * 100}%` }} />
                    </div>
                    <div className="h-1.5 rounded-full bg-emerald-400/20 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(r.actualQty / maxQty) * 100}%` }} />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  {r.wos.length === 0 ? (
                    <span className={cnInline(CMP_TONE.NONE)}>not converted</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {r.wos.map((w) => (
                        <span key={w.woNumber} className="rounded border border-border/60 bg-background/60 px-1.5 py-px font-mono text-[10px]" title={`${w.status} · completed ${w.qtyCompleted}/${w.qtyPlanned}`}>
                          {w.woNumber}
                          <span className="text-muted-foreground"> {w.qtyCompleted}/{w.qtyPlanned}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        {(["EXACT", "OVER", "UNDER", "NONE"] as const).map((s) => (
          <span key={s} className={cnInline(CMP_TONE[s])}>{s}</span>
        ))}
      </div>
    </div>
  );
}

function cnGap(gap: number) {
  return `px-2 py-1.5 text-right tabular font-medium ${gap === 0 ? "text-emerald-300" : gap > 0 ? "text-teal-300" : "text-amber-300"}`;
}
function cnInline(tone: string) {
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-[9.5px] font-medium tracking-wide ${tone}`;
}
function RawJson({ title, json }: { title: string; json: unknown }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{title}</p>
      <pre className="rounded-md border border-border/60 bg-zinc-950/80 p-2.5 text-[11px] leading-relaxed overflow-auto max-h-40 erp-scroll font-mono text-zinc-300">
        {JSON.stringify(json, null, 2)}
      </pre>
    </div>
  );
}

// ===========================================================================
// ADMIN SUB-APP (#/admin)
// ===========================================================================
function AdminApp() {
  const sessionUser = useErpStore((s) => s.sessionUser);
  const route = useErpStore((s) => s.route);
  const [tab, setTab] = useState(route.tab || "users");
  const [lastRouteTab, setLastRouteTab] = useState(route.tab);
  // sync deep-link (#/admin/<tab>) at render time — avoids setState-in-effect
  if (route.tab !== lastRouteTab) {
    setLastRouteTab(route.tab);
    if (route.tab) setTab(route.tab);
  }

  const canView = hasPerm(sessionUser?.role, "admin.view");
  const canManage = hasPerm(sessionUser?.role, "admin.manage");
  const { data, isLoading } = useQuery<AdminResp>({
    queryKey: ["admin"],
    queryFn: () => api<AdminResp>("/api/admin"),
  });

  if (!canView) return <PermDenied perm="admin.view" />;

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Cog}
        title="Administration"
        desc="RBAC matrix · SoD · immutable audit trail · decision register · environment governance"
        actions={<SyntheticBadge />}
      />

      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "users", label: "Users & RBAC", count: data?.stats.usersTotal },
          { key: "audit", label: "Audit Trail", count: data?.stats.auditTotal },
          { key: "decisions", label: "Decision Register", count: data?.stats.decisionsOpen },
          { key: "system", label: "System" },
        ]}
      />

      {tab === "users" && <UsersRbacTab data={data} isLoading={isLoading} canManage={canManage} me={sessionUser} />}
      {tab === "audit" && <AuditTab />}
      {tab === "decisions" && <DecisionsTab />}
      {tab === "system" && <SystemTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Users & RBAC
// ---------------------------------------------------------------------------
function UsersRbacTab({ data, isLoading, canManage, me }: { data?: AdminResp; isLoading: boolean; canManage: boolean; me: { username: string; role: string } | null }) {
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const [matrixRole, setMatrixRole] = useState<string | null>(me?.role ?? null);

  const toggle = useMutation({
    mutationFn: (u: AdminUser) => api("/api/admin", { method: "POST", body: { action: "toggle-user-active", userId: u.id } }),
    onSuccess: (res) => {
      const u = (res as { user: AdminUser }).user;
      toast(`${u.username} ${u.active ? "activated" : "deactivated"} (audited)`);
      qc.invalidateQueries({ queryKey: ["admin"] });
      useErpStore.getState().loadUsers(); // refresh topbar switcher
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const protectedRole = (role: string) => role === "SYSTEM_ADMIN" || role === "APP_MANAGER";

  return (
    <div className="space-y-4">
      <SectionHeader title="Users" desc={`Active accounts control the session switcher · deactivate requires admin.manage (server-enforced) · admin-class accounts protected`} />
      <DataTable
        loading={isLoading}
        rows={(data?.users ?? []) as never[]}
        rowKey={(r) => (r as AdminUser).id}
        emptyMessage="No users"
        columns={[
          { key: "name", header: "Name", render: (r) => {
            const u = r as AdminUser;
            return (
              <div className="min-w-0">
                <span className="text-[13px] font-medium">{u.name}</span>
                {me?.username === u.username && <Badge variant="outline" className="ml-2 text-[9px] border-primary/40 text-primary">YOU</Badge>}
              </div>
            );
          } },
          { key: "username", header: "Username", render: (r) => <Mono className="text-primary">{(r as AdminUser).username}</Mono> },
          { key: "role", header: "Role", render: (r) => {
            const u = r as AdminUser;
            return (
              <button className="text-left" onClick={() => setMatrixRole(u.role)} title="Highlight in RBAC matrix below">
                <Badge variant="outline" className="text-[10px] hover:border-primary/50">{u.role.replace(/_/g, " ")}</Badge>
              </button>
            );
          } },
          { key: "plant", header: "Plant", render: (r) => <Mono>{(r as AdminUser).plant}</Mono> },
          { key: "createdAt", header: "Created", render: (r) => <DateCell value={(r as AdminUser).createdAt} /> },
          { key: "active", header: "Active", className: "text-right", render: (r) => {
            const u = r as AdminUser;
            const blocked = protectedRole(u.role) || me?.username === u.username;
            return (
              <div className="flex items-center justify-end gap-2">
                <StatusBadge status={u.active ? "ACTIVE" : "CLOSED"} />
                <Switch
                  checked={u.active}
                  disabled={!canManage || blocked || toggle.isPending}
                  onCheckedChange={() => toggle.mutate(u)}
                  title={blocked ? "Admin-class accounts & own session cannot be toggled (SoD, server-enforced)" : canManage ? "Toggle active" : "Requires admin.manage"}
                  aria-label={`Toggle ${u.username}`}
                />
              </div>
            );
          } },
        ]}
      />

      <SectionHeader title="RBAC matrix" desc="Roles × permission groups — rendered from the frozen constants matrix; every cell is enforced again server-side via requirePerm()" />
      <Card>
        <CardContent className="p-0">
          <div className="erp-scroll overflow-auto max-h-[52vh]">
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur">
                <tr>
                  <th className="text-left font-medium text-muted-foreground text-[10px] uppercase tracking-wider px-3 py-2 sticky left-0 bg-zinc-900/95 min-w-44 z-20">Role</th>
                  {PERM_GROUPS.map((g) => (
                    <th key={g} className="px-1.5 py-2 font-medium text-muted-foreground text-[10px] uppercase tracking-wider text-center whitespace-nowrap" title={`${g}.*`}>{g.slice(0, 4)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROLES.map((role) => {
                  const perms = RBAC[role.code] ?? [];
                  const highlighted = matrixRole === role.code;
                  return (
                    <tr
                      key={role.code}
                      onClick={() => setMatrixRole(highlighted ? null : role.code)}
                      className={`border-b border-border/40 cursor-pointer transition-colors ${highlighted ? "bg-primary/10" : "hover:bg-accent/40"}`}
                      title={role.desc}
                    >
                      <td className={`px-3 py-1.5 sticky left-0 z-10 min-w-44 ${highlighted ? "bg-zinc-900" : "bg-card"}`}>
                        <span className="font-medium text-[12px] whitespace-nowrap">{role.name}</span>
                        <p className="text-[10px] text-muted-foreground whitespace-nowrap">{role.code}</p>
                      </td>
                      {PERM_GROUPS.map((g) => {
                        const gp = perms.filter((p) => p.startsWith(`${g}.`));
                        const full = gp.length === GROUP_TOTAL[g];
                        return (
                          <td key={g} className="px-1.5 py-1.5 text-center" title={`${g}.* → ${gp.length ? gp.join(", ") : "no access"}`}>
                            {gp.length > 0 ? (
                              <span className={`inline-flex items-center ${full ? "text-emerald-400" : "text-amber-400"}`} title={full ? "full group access" : "partial (view-level) access"}>
                                {full ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="text-[11px] font-semibold">◐</span>}
                              </span>
                            ) : (
                              <X className="h-3 w-3 text-zinc-600 inline" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> full group access</span>
            <span className="inline-flex items-center gap-1"><span className="text-amber-400 font-semibold">◐</span> partial (view-level) access</span>
            <span className="inline-flex items-center gap-1"><X className="h-3 w-3 text-zinc-600" /> no access</span>
            <span>· click a row to pin/highlight · hover a cell for exact permission keys</span>
          </div>
        </CardContent>
      </Card>

      <SectionHeader title="Segregation of duties (SoD)" desc="Static controls from the spec — every rule is re-checked on the server on each request" />
      <Card>
        <CardContent className="p-4 space-y-2">
          {SOD_RULES.map((r) => (
            <div key={r.rule} className="flex flex-wrap items-center gap-2.5 rounded-md border border-border/60 bg-background/40 p-2.5">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{r.rule}</p>
                <p className="text-[11px] text-muted-foreground">{r.detail}</p>
              </div>
              <Mono className="text-[10px] text-muted-foreground hidden sm:inline">{r.mechanism}</Mono>
              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[10px] whitespace-nowrap">enforced server-side</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

const SOD_RULES: { rule: string; detail: string; mechanism: string }[] = [
  { rule: "MRB disposition — maker ≠ approver", detail: "The inspector who raised the NCR can never approve the MRB decision; Quality Manager approves with four-eyes.", mechanism: "fourEyes()" },
  { rule: "Purchase order — requester ≠ approver", detail: "Purchase Manager approves POs; the requesting user cannot approve their own order.", mechanism: "fourEyes()" },
  { rule: "Product release gate — four-eyes", detail: "Release of serialized FG requires evidence + approver different from the releaser.", mechanism: "fourEyes()" },
  { rule: "ECO approval — four-eyes", detail: "Engineering change approval requires a different approver than the requester.", mechanism: "fourEyes()" },
  { rule: "Operator cannot edit BOM / route / limits", detail: "OPERATOR role holds production.execute only — no engineering.edit, no quality.approve, no admin.manage.", mechanism: "requirePerm()" },
  { rule: "Auditor is read-only", detail: "AUDITOR role carries only *.view + audit.view keys — no create/submit/cancel/approve perms exist in the matrix.", mechanism: "requirePerm()" },
  { rule: "Admin-class accounts cannot be deactivated", detail: "SYSTEM_ADMIN / APP_MANAGER users cannot be toggled inactive and a user cannot deactivate their own session.", mechanism: "ApiError 403/422" },
];

// ---------------------------------------------------------------------------
// Tab: Audit Trail (server-paginated)
// ---------------------------------------------------------------------------
function AuditTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("all");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");

  const { data, isLoading, isFetching } = useQuery<AuditResp>({
    queryKey: ["audit", page, action, q],
    queryFn: () => api<AuditResp>(`/api/audit?page=${page}&action=${action === "all" ? "" : encodeURIComponent(action)}&q=${encodeURIComponent(q)}`),
    placeholderData: (prev) => prev,
  });

  // page resets happen in the change handlers (no setState-in-effect)
  const changeAction = (v: string) => { setAction(v); setPage(1); };
  const runSearch = () => { setQ(qInput); setPage(1); };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={ScrollText}
        title="Audit trail"
        desc="Immutable log of every controlled transition · 25 per page · server-side filter (audit.view required)"
        actions={isFetching ? <Badge variant="outline" className="text-[10px] text-muted-foreground">refreshing…</Badge> : undefined}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56">
          <ScrollText className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setQ(qInput); }}
            placeholder="Search user, entity, id, detail… (Enter)"
            className="pl-8 h-9 bg-input/60 border-border/60"
          />
        </div>
        <Button size="sm" variant="outline" onClick={runSearch}>Search</Button>
        <Select value={action} onValueChange={changeAction}>
          <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All actions" /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">All actions</SelectItem>
            {(data?.actions ?? []).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        loading={isLoading && !data}
        rows={(data?.rows ?? []) as never[]}
        rowKey={(r) => (r as AuditRow).id}
        maxHeight="max-h-[58vh]"
        dense
        emptyMessage="No audit entries match the filter"
        columns={[
          { key: "createdAt", header: "Time", render: (r) => {
            const row = r as AuditRow;
            const d = new Date(row.createdAt);
            return (
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                <DateCell value={d} />
                <span className="text-[10px] text-muted-foreground tabular">{d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</span>
              </span>
            );
          } },
          { key: "userName", header: "User", render: (r) => <Mono>{(r as AuditRow).userName}</Mono> },
          { key: "action", header: "Action", render: (r) => <StatusBadge status={(r as AuditRow).action} /> },
          { key: "entityType", header: "Entity", render: (r) => <span className="text-[12px]">{(r as AuditRow).entityType}</span> },
          { key: "entityId", header: "Ref", render: (r) => <Mono className="text-primary">{(r as AuditRow).entityId}</Mono> },
          { key: "detail", header: "Detail", render: (r) => <span className="text-[12px] text-muted-foreground line-clamp-2 max-w-md block" title={(r as AuditRow).detail}>{(r as AuditRow).detail}</span> },
        ]}
      />

      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span>
          Page <span className="tabular text-foreground">{data?.page ?? page}</span> of <span className="tabular">{data?.pages ?? 1}</span>
          {" · "}<span className="tabular">{data?.total ?? 0}</span> entries
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={(data?.page ?? 1) <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
          <Button size="sm" variant="outline" disabled={(data?.page ?? 1) >= (data?.pages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Decision Register
// ---------------------------------------------------------------------------
function DecisionsTab() {
  const sessionUser = useErpStore((s) => s.sessionUser);
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const canManage = hasPerm(sessionUser?.role, "decisions.manage");
  const [detail, setDetail] = useState<DecisionRow | null>(null);
  const [creating, setCreating] = useState(false);
  const now = Date.now();

  const { data, isLoading } = useQuery<DecisionsResp>({
    queryKey: ["decisions"],
    queryFn: () => api<DecisionsResp>("/api/decisions"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["decisions"] });
    qc.invalidateQueries({ queryKey: ["admin"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Gavel}
        title="Decision register"
        desc="Owner decisions recorded and audited — statutory values for the synthetic dataset (India GST/tax model, local credentials) are approved per DR-001/DR-004/DR-005. Mutations require decisions.manage."
        actions={
          <Button size="sm" disabled={!canManage} onClick={() => setCreating(true)} title={canManage ? "Register a new decision item" : "Requires decisions.manage"}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New item
          </Button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Open" value={data?.stats.open ?? "—"} icon={ClipboardList} tone={(data?.stats.open ?? 0) > 0 ? "warn" : "good"} />
        <StatCard label="Overdue" value={data?.stats.overdue ?? "—"} icon={AlertTriangle} tone={(data?.stats.overdue ?? 0) > 0 ? "bad" : "good"} />
        <StatCard label="Decided" value={data?.stats.decided ?? "—"} icon={BadgeCheck} tone="good" />
        <StatCard label="Approved (synthetic)" value={data?.stats.approved ?? "—"} sub="demo dataset — India GST/tax approved" icon={BadgeCheck} tone="good" />
      </div>

      <DataTable
        loading={isLoading}
        rows={(data?.rows ?? []) as never[]}
        rowKey={(r) => (r as DecisionRow).id}
        onRowClick={(r) => setDetail(r as DecisionRow)}
        emptyMessage="Register empty"
        columns={[
          { key: "ref", header: "Ref", render: (r) => <Mono className="text-primary">{(r as DecisionRow).ref}</Mono> },
          { key: "title", header: "Title", render: (r) => (
            <div className="min-w-0 max-w-72">
              <span className="text-[13px] font-medium line-clamp-1">{(r as DecisionRow).title}</span>
              {((r as DecisionRow).notes ?? "").toUpperCase().includes(TBD_MARKER) && (
                <Badge variant="outline" className="ml-0 mt-1 border-amber-500/40 bg-amber-500/10 text-amber-300 text-[9px]">TBD—OWNER APPROVAL REQUIRED</Badge>
              )}
              {isApprovedDecision(r as DecisionRow) && !((r as DecisionRow).notes ?? "").toUpperCase().includes(TBD_MARKER) && (
                <Badge variant="outline" className="ml-0 mt-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[9px]">APPROVED — SYNTHETIC DATA</Badge>
              )}
            </div>
          ) },
          { key: "owner", header: "Owner", render: (r) => <span className="text-[12px]">{(r as DecisionRow).owner}</span> },
          { key: "dueDate", header: "Due", render: (r) => {
            const row = r as DecisionRow;
            const overdue = row.status === "OPEN" && row.dueDate && new Date(row.dueDate).getTime() < now;
            return (
              <span className={`inline-flex items-center gap-1.5 ${overdue ? "text-red-400 font-medium" : ""}`}>
                <DateCell value={row.dueDate} />
                {overdue && <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-300 text-[9px]">OVERDUE</Badge>}
              </span>
            );
          } },
          { key: "decision", header: "Decision", render: (r) => (
            <span className="text-[12px] text-muted-foreground line-clamp-1 max-w-56 block">{(r as DecisionRow).decision || "—"}</span>
          ) },
          { key: "status", header: "Status", className: "text-right", render: (r) => <StatusBadge status={(r as DecisionRow).status} /> },
        ]}
      />

      <DecisionDetailDialog row={detail} onClose={() => setDetail(null)} canManage={canManage} onMutated={invalidate} />
      <NewDecisionDialog open={creating} onClose={() => setCreating(false)} onMutated={invalidate} onError={(m) => toast(m, "err")} />
    </div>
  );
}

function DecisionDetailDialog({ row, onClose, canManage, onMutated }: { row: DecisionRow | null; onClose: () => void; canManage: boolean; onMutated: () => void }) {
  const toast = useErpStore((s) => s.toast);
  const [decisionText, setDecisionText] = useState("");
  useEffect(() => { setDecisionText(row?.decision ?? ""); }, [row]);

  const decide = useMutation({
    mutationFn: () => api("/api/decisions", { method: "POST", body: { action: "decide", id: row?.id, decision: decisionText } }),
    onSuccess: () => { toast(`${row?.ref} marked DECIDED (audited)`); onMutated(); onClose(); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const close = useMutation({
    mutationFn: () => api("/api/decisions", { method: "POST", body: { action: "close", id: row?.id } }),
    onSuccess: () => { toast(`${row?.ref} CLOSED`); onMutated(); onClose(); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const dirty = row !== null && decisionText.trim() !== (row.decision ?? "").trim();

  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Gavel className="h-4 w-4 text-primary" /> {row?.ref} — {row?.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <StatusBadge status={row?.status ?? "OPEN"} />
            <span>Owner: {row?.owner}</span>
            {row?.dueDate && <>· Due <DateCell value={row.dueDate} /></>}
            {row && row.status === "OPEN" && row.dueDate && new Date(row.dueDate).getTime() < Date.now() && (
              <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-300 text-[9px]">OVERDUE</Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Question</p>
              <p className="text-[13px] rounded-md border border-border/60 bg-background/40 p-2.5">{row.question}</p>
            </div>
            {row.notes && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
                <p className="text-[12px] text-muted-foreground rounded-md border border-border/60 bg-background/40 p-2.5 whitespace-pre-wrap">
                  {row.notes.toUpperCase().includes(TBD_MARKER) && (
                    <Badge variant="outline" className="mr-2 mb-1 border-amber-500/40 bg-amber-500/10 text-amber-300 text-[9px] align-middle">TBD—OWNER APPROVAL REQUIRED</Badge>
                  )}
                  {isApprovedDecision(row) && !row.notes.toUpperCase().includes(TBD_MARKER) && (
                    <Badge variant="outline" className="mr-2 mb-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[9px] align-middle">APPROVED — SYNTHETIC DATA</Badge>
                  )}
                  {row.notes}
                </p>
              </div>
            )}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Decision {row.status !== "OPEN" && "(recorded)"}</p>
              <Textarea
                value={decisionText}
                onChange={(e) => setDecisionText(e.target.value)}
                disabled={!canManage || row.status !== "OPEN"}
                placeholder={canManage && row.status === "OPEN" ? "What was decided, scope, and any conditions…" : "Requires decisions.manage"}
                className={row.status !== "OPEN" ? "opacity-90" : ""}
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Dismiss</Button>
          {row?.status === "OPEN" && (
            <Button size="sm" disabled={!canManage || !decisionText.trim() || decide.isPending} onClick={() => decide.mutate()} title="Record decision → status DECIDED (audited)">
              <Gavel className="h-3.5 w-3.5 mr-1.5" /> Decide
            </Button>
          )}
          {row?.status === "DECIDED" && (
            <Button size="sm" variant="outline" disabled={!canManage || close.isPending} onClick={() => close.mutate()} title="Close the item (audited)">
              <BadgeCheck className="h-3.5 w-3.5 mr-1.5" /> Close item
            </Button>
          )}
          {dirty && row?.status === "OPEN" && <span className="text-[10px] text-amber-300 self-center">unsaved decision text</span>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewDecisionDialog({ open, onClose, onMutated, onError }: { open: boolean; onClose: () => void; onMutated: () => void; onError: (m: string) => void }) {
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [owner, setOwner] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: () => api("/api/decisions", {
      method: "POST",
      body: { action: "create", title, question, owner, dueDate: dueDate || null, notes },
    }),
    onSuccess: () => {
      onMutated(); onClose();
      setTitle(""); setQuestion(""); setOwner(""); setDueDate(""); setNotes("");
    },
    onError: (e: Error) => onError(e.message),
  });

  const valid = title.trim() && question.trim() && owner.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4 text-primary" /> Register decision item</DialogTitle>
          <DialogDescription>Open items stay OPEN until an owner decides — the register is the single source of truth for spec questions. Approved items carry synthetic India GST/tax values (demo only).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Warranty policy for export shipments" /></Field>
          <Field label="Question"><Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What exactly must be decided?" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner"><Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. Finance/CA (fgupta)" /></Field>
            <Field label="Due date"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          </div>
          <Field label="Notes (cite the synthetic-data / India GST basis where relevant)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, links, impact…" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!valid || create.isPending} onClick={() => create.mutate()}>Register item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: System
// ---------------------------------------------------------------------------
const RUNBOOK = [
  { id: "backup", label: "Nightly backup", detail: "SQLite file backup (sqlite3 .backup) + offsite copy. RPO target ≤ 24 h. Verify backup size ≠ 0 every morning." },
  { id: "restore", label: "Restore drill (quarterly)", detail: "Restore latest backup to a staging site, run /api/session smoke + spot-check lots/WOs. RPO ≤ 24 h · RTO ≤ 4 h — record sign-off in the decision register." },
  { id: "migration", label: "Fresh-site migration test", detail: "prisma migrate deploy on a clean site before every release; confirm schema hash matches VERSIONS.md." },
  { id: "audit-export", label: "Audit log export & retention", detail: "Monthly CSV export of AuditLog; retain ≥ 7 years per QMS record policy." },
  { id: "seed-guard", label: "Seed wipe guard", detail: "Force re-seed requires explicit confirmation and is audited (action SEED) — never run against a site with real data." },
  { id: "user-review", label: "Quarterly RBAC review", detail: "Review users & roles against the SoD matrix; deactivate leavers the same day (audited)." },
];

const VERSION_PINS = [
  ["Next.js", "16 (App Router, SPA at '/')"], ["React", "19"], ["TypeScript", "5 (strict)"],
  ["Prisma", "6 (client + SQLite)"], ["Database", "SQLite (file, single-writer)"],
  ["Tailwind CSS", "4 (dark industrial theme)"], ["shadcn/ui", "New York"],
  ["TanStack Query", "v5"], ["Zustand", "v5"],
];

function SystemTab() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-4">
      <SectionHeader icon={Database} title="System & environment" desc="Environment classification, ops runbook and pinned versions (spec §VERSIONS.md rule)" />

      <Card className="border-amber-500/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SyntheticBadge />
            <Badge variant="outline" className="border-orange-500/40 bg-orange-500/10 text-orange-300 text-[10px]">ENV: DEV/UAT ONLY</Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">PLANT-PUNE</Badge>
          </div>
          <p className="text-[13px]">
            This instance runs on <span className="font-medium">100% SYNTHETIC demo data</span>. GSTIN, IRN, e-way bill and statutory values are fabricated
            placeholders — <span className="text-amber-300 font-medium">NOT FOR STATUTORY USE</span>. Statutory unknowns are owner-approved for the demo
            dataset (Decision Register DR-001/DR-004/DR-005 — India GST/tax model, local credentials only). Production go-live additionally requires:
            a fully decided register (zero open items), a completed restore drill, and real master data cutover.
          </p>
          <p className="text-[12px] text-muted-foreground">
            Integrations run in sandbox/mock mode (e-Invoice IRN = SANDBOX_MOCK, idempotency log enforced). Every controlled transition is written to the
            immutable audit trail; RBAC and four-eyes are enforced server-side on every request.
          </p>
        </CardContent>
      </Card>

      <SectionHeader title="Backup / restore runbook" desc="Static placeholder checklist from the spec — tick off during drills (client-side state only)" />
      <Card>
        <CardContent className="p-4 space-y-2">
          {RUNBOOK.map((r) => (
            <label
              key={r.id}
              className={`flex items-start gap-3 rounded-md border border-border/60 p-3 cursor-pointer transition-colors ${done[r.id] ? "bg-emerald-500/5 border-emerald-500/30" : "bg-background/40 hover:bg-accent/30"}`}
            >
              <Checkbox
                checked={!!done[r.id]}
                onCheckedChange={(v) => setDone((s) => ({ ...s, [r.id]: v === true }))}
                className="mt-0.5"
                aria-label={r.label}
              />
              <div className="min-w-0">
                <p className={`text-[13px] font-medium ${done[r.id] ? "text-emerald-300 line-through decoration-emerald-500/40" : ""}`}>{r.label}</p>
                <p className="text-[12px] text-muted-foreground">{r.detail}</p>
              </div>
              {done[r.id] && <BadgeCheck className="h-4 w-4 text-emerald-400 ml-auto shrink-0" />}
            </label>
          ))}
        </CardContent>
      </Card>

      <SectionHeader title="Version pins" desc="Pinned per spec VERSIONS.md rule — upgrades require a change request + regression drill" />
      <Card>
        <CardContent className="p-2">
          <table className="w-full text-[13px]">
            <tbody>
              {VERSION_PINS.map(([k, v]) => (
                <tr key={k} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 font-medium w-48">{k}</td>
                  <td className="px-3 py-2 text-muted-foreground">{v}</td>
                  <td className="px-3 py-2 text-right">
                    <Badge variant="outline" className="border-teal-500/40 bg-teal-500/10 text-teal-300 text-[9px]">PINNED</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
