"use client";
// ============================================================================
// Tau ERP — Executive Dashboard (KPIs, family mix, quality trend, alerts)
// ============================================================================
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { DataTable, SectionHeader, StatCard, StatusBadge, SyntheticBadge, Mono, Progress, inrCompact } from "../shared";
import {
  Activity, AlertTriangle, ArrowRightLeft, BadgeCheck, Boxes, Factory, Gauge, Layers, ShieldAlert,
  TrendingUp, Truck, IndianRupee, ClipboardX, Timer, HardHat, Radar, Zap, FileWarning, CalendarClock,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FAMILIES } from "@/lib/erp/constants";

type Dash = {
  kpis: {
    openWOs: number; wipUnits: number; fgReady: number; shippedThisMonth: number;
    iqcPassRate: number; fpy: number; openNcrs: number; openCapas: number;
    stockValue: number; openSo: number; pendingApprovals: number; overdueActions: number;
  };
  familyMix: { family: string; released: number }[];
  productionTrend: { day: string; completed: number; scrapped: number }[];
  alerts: { id: string; severity: string; title: string; message: string; kind: string }[];
  recentAudit: { id: string; userName: string; action: string; entityType: string; entityId: string; createdAt: string }[];
  demandCoverage?: {
    openQty: number; coveredQty: number; coveragePct: number; linesTotal: number;
    uncovered: { soNumber: string; partNumber: string; itemName: string; open: number; covered: number; pct: number }[];
  };
  radar?: {
    scarsActive: number; scarsCritical: number; scarsOverdueResponses: number;
    expediteCount: number;
    expeditePos: { poNumber: string; supplierCode: string; status: string; expectedDate: string; daysLeft: number }[];
    etaBreachCount: number;
    etaBreaches: { poNumber: string; supplierCode: string; status: string; expectedDate: string; daysLate: number }[];
    overdueCapas: number;
  };
};

type Handover = {
  id: string; shiftDate: string; shift: string; area: string; woNumber: string;
  authorName: string; headcount: number; summary: string;
  issues: { issue: string; severity: string }[]; carryOver: string[];
  status: string; acknowledgedBy: string;
};

const FAMILY_COLORS: Record<string, string> = Object.fromEntries(FAMILIES.map((f) => [f.code, f.color]));

/** Exception-radar tile (round 10): severity rail + big count + clickable deep-link. */
function RadarTile({
  icon: Icon, label, count, critical, children, onClick, pulse,
}: {
  icon: React.ElementType; label: string; count: number; critical?: boolean;
  children?: React.ReactNode; onClick?: () => void; pulse?: boolean;
}) {
  const tone = count > 0 ? (critical ? "red" : "amber") : "emerald";
  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden rounded-lg border bg-background/40 p-3 text-left transition-all duration-200 hover:-translate-y-px ${
        tone === "red" ? "border-red-500/40 hover:border-red-500/70"
        : tone === "amber" ? "border-amber-500/40 hover:border-amber-500/70"
        : "border-emerald-500/25 hover:border-emerald-500/50"
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${tone === "red" ? "bg-red-500/80" : tone === "amber" ? "bg-amber-500/80" : "bg-emerald-500/50"}`} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Icon className={`h-3.5 w-3.5 ${tone === "red" ? "text-red-400" : tone === "amber" ? "text-amber-400" : "text-emerald-400"}`} />
          {label}
        </span>
        <span className="flex items-center gap-1.5">
          {pulse && count > 0 && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
          )}
          <span className={`tabular text-xl font-bold leading-none ${tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : "text-emerald-300"}`}>{count}</span>
        </span>
      </div>
      <div className="mt-1.5 min-h-[16px]">{children}</div>
    </button>
  );
}

export default function DashboardView() {
  const navigate = useErpStore((s) => s.navigate);
  const { data, isLoading } = useQuery<Dash>({
    queryKey: ["dashboard"],
    queryFn: () => api<Dash>("/api/dashboard"),
    refetchInterval: 60_000,
  });
  const handoversQ = useQuery<{ shifts: Handover[] }>({
    queryKey: ["shifts"],
    queryFn: () => api<{ shifts: Handover[] }>("/api/shifts"),
    staleTime: 30_000,
  });
  const handovers = handoversQ.data?.shifts ?? [];
  const openHandovers = handovers.filter((h) => h.status === "OPEN").length;
  const dc = data?.demandCoverage;
  const radar = data?.radar;
  const radarClear = radar && radar.scarsActive === 0 && radar.expediteCount === 0 && radar.etaBreachCount === 0 && radar.overdueCapas === 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Activity}
        title="Executive Dashboard"
        desc="Plant PLANT-PUNE · live KPIs across the 13-phase Tau ERP scope"
        actions={<SyntheticBadge />}
      />

      {/* KPI ROW 1 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-tour="tour-kpis">
        <StatCard label="Open Work Orders" value={data?.kpis.openWOs ?? "—"} sub="released + in progress" icon={Factory} onClick={() => navigate("production")} />
        <StatCard label="WIP Units" value={data?.kpis.wipUnits ?? "—"} sub="on shop floor" icon={Boxes} tone="warn" onClick={() => navigate("production")} />
        <StatCard label="FG Ready to Ship" value={data?.kpis.fgReady ?? "—"} sub="released serials in WH-FG" icon={BadgeCheck} tone="good" onClick={() => navigate("inventory", "lots")} />
        <StatCard label="Shipped (30d)" value={data?.kpis.shippedThisMonth ?? "—"} sub="dispatched serials" icon={Truck} onClick={() => navigate("sales")} />
        <StatCard label="IQC Pass Rate" value={data ? `${data.kpis.iqcPassRate}%` : "—"} sub="last 20 incoming lots" icon={Gauge} tone={data && data.kpis.iqcPassRate >= 90 ? "good" : "warn"} onClick={() => navigate("quality", "inspections")} />
        <StatCard label="First Pass Yield" value={data ? `${data.kpis.fpy}%` : "—"} sub="EOL attempt-1 pass" icon={TrendingUp} tone={data && data.kpis.fpy >= 90 ? "good" : "warn"} onClick={() => navigate("quality", "inspections")} />
      </div>

      {/* KPI ROW 2 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Open NCRs" value={data?.kpis.openNcrs ?? "—"} icon={ClipboardX} tone={data && data.kpis.openNcrs > 0 ? "bad" : "good"} onClick={() => navigate("quality", "ncr")} />
        <StatCard label="Open CAPAs" value={data?.kpis.openCapas ?? "—"} icon={Timer} tone={data && data.kpis.openCapas > 0 ? "warn" : "good"} onClick={() => navigate("quality", "capa")} />
        <StatCard label="Open Sales Orders" value={data?.kpis.openSo ?? "—"} icon={Truck} onClick={() => navigate("sales", "orders")} />
        <StatCard label="Stock Value" value={data ? inrCompact(data.kpis.stockValue) : "—"} sub={data ? `₹${data.kpis.stockValue.toLocaleString("en-IN")}` : "Indian short scale"} icon={IndianRupee} onClick={() => navigate("inventory")} />
        <StatCard label="Pending Approvals" value={data?.kpis.pendingApprovals ?? "—"} sub="four-eyes queue" icon={ShieldAlert} tone={data && data.kpis.pendingApprovals > 0 ? "warn" : "good"} onClick={() => navigate("admin", "decisions")} />
        <StatCard label="Overdue Actions" value={data?.kpis.overdueActions ?? "—"} sub="CAPA/gates past due" icon={AlertTriangle} tone={data && data.kpis.overdueActions > 0 ? "bad" : "good"} onClick={() => navigate("quality", "capa")} />
      </div>

      {/* EXCEPTION RADAR — expedite & escalation strip (round 10) */}
      <Card className={radarClear ? "border-emerald-500/25" : "border-red-500/25"} data-tour="tour-radar">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Radar className="h-4 w-4 text-primary" /> Exception radar — expedite &amp; escalation strip
            </span>
            <span className="text-[11px] font-normal text-muted-foreground">click a tile to act · refreshes every 60s</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[74px] rounded-lg bg-muted animate-pulse" />)}</div>}
          {radar && (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <RadarTile
                icon={FileWarning}
                label="Supplier SCARs"
                count={radar.scarsActive}
                critical={radar.scarsCritical > 0}
                pulse={radar.scarsCritical > 0}
                onClick={() => navigate("procurement", "scars")}
              >
                <p className="text-[10.5px] leading-tight text-muted-foreground">
                  {radar.scarsCritical > 0 && <span className="text-red-300">{radar.scarsCritical} critical · </span>}
                  {radar.scarsOverdueResponses > 0 ? <span className="text-red-300">{radar.scarsOverdueResponses} response{radar.scarsOverdueResponses > 1 ? "s" : ""} overdue</span> : "responses on track"}
                </p>
              </RadarTile>
              <RadarTile
                icon={Zap}
                label="Expedite POs"
                count={radar.expediteCount}
                onClick={() => navigate("procurement", "pos")}
              >
                {radar.expeditePos.length > 0 ? (
                  <p className="truncate text-[10.5px] text-amber-300/90">
                    <Mono>{radar.expeditePos[0].poNumber}</Mono> · {radar.expeditePos[0].supplierCode} · ETA {radar.expeditePos[0].daysLeft}d{radar.expediteCount > radar.expeditePos.length ? ` +${radar.expediteCount - radar.expeditePos.length} more` : ""}
                  </p>
                ) : (
                  <p className="text-[10.5px] text-muted-foreground">no SO-driven expedites</p>
                )}
              </RadarTile>
              <RadarTile
                icon={CalendarClock}
                label="PO ETA breaches"
                count={radar.etaBreachCount}
                critical={radar.etaBreachCount > 0}
                onClick={() => navigate("procurement", "pos")}
              >
                {radar.etaBreaches.length > 0 ? (
                  <p className="truncate text-[10.5px] text-red-300/90">
                    <Mono>{radar.etaBreaches[0].poNumber}</Mono> · {radar.etaBreaches[0].supplierCode} · {radar.etaBreaches[0].daysLate}d late{radar.etaBreachCount > radar.etaBreaches.length ? ` +${radar.etaBreachCount - radar.etaBreaches.length} more` : ""}
                  </p>
                ) : (
                  <p className="text-[10.5px] text-muted-foreground">all active POs within ETA</p>
                )}
              </RadarTile>
              <RadarTile
                icon={Timer}
                label="Overdue CAPAs"
                count={radar.overdueCapas}
                onClick={() => navigate("quality", "capa")}
              >
                <p className="text-[10.5px] text-muted-foreground">{radar.overdueCapas > 0 ? "corrective actions past due date" : "corrective actions on schedule"}</p>
              </RadarTile>
            </div>
          )}
          {radarClear && (
            <p className="mt-2.5 text-[11.5px] text-emerald-300">Radar clear — no quality raises, expedites, late POs or overdue CAPAs right now.</p>
          )}
        </CardContent>
      </Card>

      {/* CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-tour="tour-charts">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Production trend — completions vs scrap (14d)</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.productionTrend ?? []} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.008 260 / 0.5)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "oklch(0.67 0.008 260)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "oklch(0.67 0.008 260)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "oklch(0.21 0.006 260)", border: "1px solid oklch(0.29 0.008 260)", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "oklch(0.93 0.003 260)" }}
                />
                <Bar dataKey="completed" name="Completed" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="scrapped" name="Scrapped" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Released serials by family</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data?.familyMix ?? []} dataKey="released" nameKey="family" innerRadius={45} outerRadius={70} paddingAngle={3}>
                  {(data?.familyMix ?? []).map((e) => (
                    <Cell key={e.family} fill={FAMILY_COLORS[e.family] ?? "#a1a1aa"} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "oklch(0.21 0.006 260)", border: "1px solid oklch(0.29 0.008 260)", borderRadius: 8, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 -mt-2">
              {FAMILIES.map((f) => (
                <span key={f.code} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: f.color }} /> {f.code}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* DEMAND COVERAGE — SO → WO */}
      <Card className={dc && dc.coveragePct < 100 ? "border-amber-500/30" : "border-emerald-500/20"}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-primary" /> Demand coverage — SO → WO linkage
              {dc && (
                <Badge variant="outline" className={dc.coveragePct >= 100 ? "ml-1 text-[10px] border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "ml-1 text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-300"}>
                  {dc.coveragePct}% covered
                </Badge>
              )}
            </span>
            <button className="text-[11px] text-primary hover:underline" onClick={() => navigate("sales", "orders")}>Open sales orders →</button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {isLoading && <div className="h-16 rounded bg-muted animate-pulse" />}
          {dc && (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-[220px] flex-1">
                  <Progress value={dc.coveragePct} tone={dc.coveragePct >= 100 ? "good" : "primary"} />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {dc.coveredQty} of {dc.openQty} open SO units covered by linked work orders · {dc.linesTotal} open line{dc.linesTotal === 1 ? "" : "s"}
                  </p>
                </div>
                {dc.coveragePct < 100 && (
                  <span className="text-[11px] text-amber-300">Plan the gap — run MRP from the Planning workbench.</span>
                )}
              </div>
              {dc.uncovered.length > 0 && (
                <div className="space-y-1.5">
                  {dc.uncovered.map((l) => (
                    <div
                      key={`${l.soNumber}:${l.partNumber}`}
                      className="flex items-center gap-2.5 rounded-md border border-border/60 bg-background/40 p-2.5 cursor-pointer hover:border-primary/30 transition-colors"
                      onClick={() => navigate("sales", "orders")}
                    >
                      <Mono className="text-primary shrink-0">{l.soNumber}</Mono>
                      <div className="min-w-0 flex-1">
                        <span className="text-[12px] font-medium">{l.partNumber}</span>
                        <span className="text-[11px] text-muted-foreground ml-1.5 truncate hidden sm:inline">{l.itemName}</span>
                      </div>
                      <span className="tabular text-[11.5px] shrink-0">
                        <span className="text-emerald-300">{l.covered}</span> / {l.open} units
                      </span>
                      <Badge variant="outline" className={l.pct === 0 ? "shrink-0 text-[9.5px] border-red-500/40 bg-red-500/10 text-red-300" : "shrink-0 text-[9.5px] border-amber-500/40 bg-amber-500/10 text-amber-300"}>
                        {l.pct}%
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
              {dc.coveragePct >= 100 && (
                <p className="text-[12px] text-emerald-300">Every open SO line has linked work-order capacity — no planning gap.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* SHOP-FLOOR PULSE — shift handovers */}
      <Card className={openHandovers > 0 ? "border-amber-500/30" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-1.5">
              <ArrowRightLeft className="h-4 w-4 text-primary" /> Shop-floor pulse — shift handovers
              {handoversQ.isSuccess && (
                <Badge variant="outline" className={openHandovers > 0 ? "ml-1 text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-300" : "ml-1 text-[10px] border-emerald-500/40 bg-emerald-500/10 text-emerald-300"}>
                  {openHandovers > 0 ? `${openHandovers} awaiting acknowledgment` : "all acknowledged"}
                </Badge>
              )}
            </span>
            <button className="text-[11px] text-primary hover:underline" onClick={() => navigate("production", "shifts")}>Open handover log →</button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {handoversQ.isLoading && <div className="h-16 rounded bg-muted animate-pulse" />}
          {handoversQ.isSuccess && handovers.length === 0 && (
            <p className="text-[13px] text-muted-foreground py-3 text-center">No handovers logged yet — shift supervisors record one before handover.</p>
          )}
          {handovers.slice(0, 2).map((h) => (
            <div
              key={h.id}
              className="flex items-start gap-3 rounded-md border border-border/60 bg-background/40 p-3 cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => navigate("production", "shifts")}
            >
              <div className="rounded-md bg-primary/10 p-2 shrink-0">
                <HardHat className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap text-[12px]">
                  <span className="font-medium">Shift {h.shift}</span>
                  <span className="text-muted-foreground">{new Date(h.shiftDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                  {h.area && <Mono className="text-muted-foreground">{h.area}</Mono>}
                  {h.woNumber && <Mono className="text-teal-300">{h.woNumber}</Mono>}
                  <span className="text-muted-foreground">· by <span className="font-mono">{h.authorName}</span></span>
                  {h.issues.length > 0 && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-red-500/40 bg-red-500/10 text-red-300">
                      {h.issues.length} issue{h.issues.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{h.summary}</p>
                {h.carryOver.length > 0 && (
                  <p className="text-[11px] text-teal-300/90 mt-0.5 truncate">Carry-over: {h.carryOver[0]}{h.carryOver.length > 1 ? ` +${h.carryOver.length - 1} more` : ""}</p>
                )}
              </div>
              <StatusBadge status={h.status} className="shrink-0" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ALERTS + AUDIT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              Actionable alerts
              <button className="text-[11px] text-primary hover:underline" onClick={() => navigate("sales", "notifications")}>View all</button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-64 overflow-y-auto erp-scroll">
            {isLoading && <div className="h-20 rounded bg-muted animate-pulse" />}
            {!isLoading && (data?.alerts.length ?? 0) === 0 && <p className="text-[13px] text-muted-foreground py-4 text-center">No alerts — all clear.</p>}
            {(data?.alerts ?? []).map((a) => (
              <div key={a.id} className="flex items-start gap-2.5 rounded-md border border-border/60 bg-background/40 p-2.5">
                <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${a.severity === "CRITICAL" ? "text-red-400" : "text-amber-400"}`} />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{a.title}</p>
                  <p className="text-[12px] text-muted-foreground">{a.message}</p>
                </div>
                <StatusBadge status={a.severity} className="ml-auto shrink-0" />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              Recent audit trail
              <button className="text-[11px] text-primary hover:underline" onClick={() => navigate("admin", "audit")}>Open audit log</button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              maxHeight="max-h-64"
              columns={[
                { key: "action", header: "Action", render: (r) => <StatusBadge status={r.action} /> },
                { key: "entity", header: "Entity", render: (r) => <span className="text-[12px]">{r.entityType} <Mono className="text-primary">{r.entityId}</Mono></span> },
                { key: "user", header: "User", render: (r) => <Mono>{r.userName}</Mono> },
              ]}
              rows={(data?.recentAudit ?? []) as { id: string; userName: string; action: string; entityType: string; entityId: string; createdAt: string }[]}
              rowKey={(r) => r.id}
              emptyMessage="No audit entries"
            />
          </CardContent>
        </Card>
      </div>

      {/* SPEC FOOTNOTE */}
      <Card className="border-primary/20">
        <CardContent className="p-4 text-[12px] text-muted-foreground space-y-1.5">
          <p className="font-medium text-foreground/90">Scope coverage (spec §Product objective)</p>
          <p>
            CRM→SO · APQP/PPAP/ECO · P2P with IQC · barcode serial/batch genealogy · MPS/MRP · five sensor-family routes · calibration/EOL evidence ·
            QMS (NCR/MRB/CAPA/8D) · release gate · order-to-cash with GST sandbox workflow · RBAC with four-eyes &amp; audit trail · notifications.
            Statutory values are owner-approved for the synthetic dataset (India GST/tax model) — see <span className="text-emerald-300">APPROVED</span> decisions DR-001/DR-004/DR-005 in the Decision Register.
          </p>
          <Progress value={94} />
        </CardContent>
      </Card>
    </div>
  );
}
