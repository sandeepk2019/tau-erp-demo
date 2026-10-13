"use client";
// ============================================================================
// Tau ERP — Procurement module (Task 3-b): Procure-to-Pay.
// Suppliers (approval + scorecard) · RFQ & quotation comparison (award) ·
// Purchase Orders (four-eyes approval, controlled-item rule) · Goods Receipts
// (GRN → IQC routing: accept → WH-ACC, reject → WH-REJ).
// API: /api/suppliers · /api/rfqs · /api/purchase-orders · /api/receipts
// ============================================================================
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import {
  DataTable, SectionHeader, StatCard, StatusBadge, SubTabs, KeyValue, Progress,
  SyntheticBadge, Money, DateCell, Mono, EmptyState, PermDenied,
  type Column,
} from "../shared";
import { hasPerm } from "@/lib/erp/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Award, Building2, ClipboardList, FileSignature, FileWarning, PackageSearch, Plus,
  ShieldAlert, ShoppingCart, TrendingUp, Zap,
} from "lucide-react";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import NewPoDialog from "./procurement/new-po-dialog";
import NewGrnDialog from "./procurement/new-grn-dialog";
import IqcDialog from "./procurement/iqc-dialog";
import ScarTab, { type ScarsPayload } from "./procurement/scar-tab";
import {
  openQty, type GrnRow, type InspTemplate, type ItemMaster, type PoRow,
  type ReceiptsPayload, type RfqRow, type SupplierRow,
} from "./procurement/types";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Stars({ value }: { value: number }) {
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="whitespace-nowrap text-[12px]" title={`Scorecard ${value.toFixed(1)} / 5`}>
      <span className="text-amber-400">{"★".repeat(full)}</span>
      <span className="text-zinc-600">{"★".repeat(5 - full)}</span>{" "}
      <span className="tabular text-muted-foreground">{value.toFixed(1)}</span>
    </span>
  );
}

function PpmCell({ ppm }: { ppm: number }) {
  const tone = ppm <= 250 ? "text-emerald-400" : ppm <= 600 ? "text-amber-400" : "text-red-400";
  return <span className={`tabular text-[12px] ${tone}`}>{ppm.toLocaleString("en-IN")}</span>;
}

/** SCAR trend cell — 12-month mini bar strip + lifecycle chips (round-8).
 *  Zero-history suppliers show a quiet emerald dash. */
function ScarTrendCell({ stats }: { stats: SupplierRow["scarStats"] }) {
  const max = Math.max(1, ...stats.byMonth);
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="flex h-6 items-end gap-px" aria-hidden>
        {stats.byMonth.map((n, i) => (
          <span
            key={i}
            className={cnSc("w-1 rounded-sm transition-colors", n ? "bg-red-400/80" : "bg-zinc-700/60")}
            style={{ height: n ? `${Math.max(3, Math.round((n / max) * 22))}px` : "2px" }}
          />
        ))}
      </span>
      <span className="flex items-center gap-1">
        <span className="rounded-full border border-border/60 bg-background/40 px-1.5 py-px text-[9.5px] tabular text-muted-foreground" title={`${stats.total} SCAR(s) all-time · ${stats.closed} closed`}>
          {stats.total}
        </span>
        {stats.active > 0 && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[9.5px] font-medium tabular text-amber-300" title="active (open / under review / verification)">
            {stats.active} act.
          </span>
        )}
        {stats.overdue > 0 && (
          <span className="rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[9.5px] font-semibold tabular text-red-300" title="response overdue">
            {stats.overdue} ovd
          </span>
        )}
      </span>
    </div>
  );
}

/** Tiny class joiner for conditional scorecard chip styling. */
function cnSc(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Supplier scorecard trend — 12-month reconstruction from GRN × IQC × PO data
// ---------------------------------------------------------------------------

type ScorecardScars = {
  totals: { total: number; active: number; criticalOpen: number; overdue: number; closed: number };
  trend?: number[]; // 12-month raise counts (round-9)
  rows: { scarNumber: string; status: string; severity: string; defectDescription: string; partSummary: string; grnNumber: string; responseDue: string | null; createdAt: string; closedAt: string | null }[];
};

type ScorecardPayload = {
  supplier: { code: string; name: string; city: string; category: string; approved: boolean; rating: number; ppm: number; onTimePct: number; notes: string };
  window: { from: string; to: string };
  totals: { receipts: number; qtyReceived: number; qtyRejected: number; ppm: number | null; linesAccepted: number; linesRejected: number; linesPendingIqc: number; onTimePct: number | null; openPos: number; spend: number };
  months: { month: string; label: string; receipts: number; accepted: number; rejected: number; pendingIqc: number; qtyReceived: number; qtyRejected: number; ppm: number | null; onTimePct: number | null; lateReceipts: number }[];
  recentPos: { poNumber: string; status: string; orderDate: string; expectedDate: string | null; totalAmount: number }[];
  scars: ScorecardScars;
};

function ScorecardDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const q = useQuery<ScorecardPayload>({
    queryKey: ["supplier-scorecard", code],
    queryFn: () => api<ScorecardPayload>(`/api/suppliers/scorecard?code=${encodeURIComponent(code)}`),
  });
  const d = q.data;
  const chartData = (d?.months ?? []).map((m) => ({ ...m, ppm: m.ppm ?? undefined, onTimePct: m.onTimePct ?? undefined }));

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-primary" />
            Scorecard trend — <Mono className="text-primary">{code}</Mono>
          </DialogTitle>
          <DialogDescription>
            12-month performance reconstructed from GRN × IQC × PO history (synthetic evidence — master-data scorecard shown for comparison).
          </DialogDescription>
        </DialogHeader>

        {q.isLoading && <div className="h-72 rounded bg-muted animate-pulse" />}
        {q.isError && <p className="text-[13px] text-red-400">Failed to load scorecard — {(q.error as Error).message}</p>}

        {d && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receipts (12m)</p>
                <p className="text-xl font-semibold tabular mt-0.5">{d.totals.receipts}</p>
                <p className="text-[11px] text-muted-foreground">{d.totals.qtyReceived.toLocaleString("en-IN")} units received</p>
              </div>
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Defect PPM (evidence)</p>
                <p className={`text-xl font-semibold tabular mt-0.5 ${(d.totals.ppm ?? 0) > 600 ? "text-red-400" : (d.totals.ppm ?? 0) > 250 ? "text-amber-400" : "text-emerald-400"}`}>
                  {d.totals.ppm === null ? "—" : d.totals.ppm.toLocaleString("en-IN")}
                </p>
                <p className="text-[11px] text-muted-foreground">master card: <PpmCell ppm={d.supplier.ppm} /></p>
              </div>
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">On-time (evidence)</p>
                <p className={`text-xl font-semibold tabular mt-0.5 ${(d.totals.onTimePct ?? 100) >= 95 ? "text-emerald-400" : (d.totals.onTimePct ?? 100) >= 90 ? "text-amber-400" : "text-red-400"}`}>
                  {d.totals.onTimePct === null ? "—" : `${d.totals.onTimePct}%`}
                </p>
                <p className="text-[11px] text-muted-foreground">vs PO expected date (+1d grace)</p>
              </div>
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">IQC lines</p>
                <p className="text-xl font-semibold tabular mt-0.5">
                  <span className="text-emerald-400">{d.totals.linesAccepted}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-red-400">{d.totals.linesRejected}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-amber-300">{d.totals.linesPendingIqc}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">acc / rej / pending IQC</p>
              </div>
            </div>

            <div className="rounded-md border border-border/60 bg-background/40 p-3">
              <p className="text-[12px] font-medium mb-1">Monthly receipts, defect PPM &amp; on-time %</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.008 260 / 0.5)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "oklch(0.67 0.008 260)" }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="vol" tick={{ fontSize: 10, fill: "oklch(0.67 0.008 260)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "oklch(0.67 0.008 260)" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: "oklch(0.21 0.006 260)", border: "1px solid oklch(0.29 0.008 260)", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "oklch(0.93 0.003 260)" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="vol" dataKey="receipts" name="GRNs" fill="#f59e0b" radius={[3, 3, 0, 0]} barSize={14} />
                    <Line yAxisId="pct" dataKey="onTimePct" name="On-time %" stroke="#34d399" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                    <Line yAxisId="vol" dataKey="ppm" name="Defect PPM" stroke="#ef4444" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {d.scars && d.scars.rows.length > 0 && (
              <div className="rounded-md border border-border/60">
                <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5 pb-1.5">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Corrective actions (SCAR) — full history</p>
                  <span className="ml-auto flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="rounded-full border border-border/70 px-2 py-0.5 tabular" title="total SCARs raised">{d.scars.totals.total} total</span>
                    <span className={cnSc("rounded-full border px-2 py-0.5 tabular", d.scars.totals.active ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300")}>{d.scars.totals.active} active</span>
                    {d.scars.totals.criticalOpen > 0 && <span className="rounded-full border border-red-500/40 bg-red-500/10 text-red-300 px-2 py-0.5 tabular">{d.scars.totals.criticalOpen} critical</span>}
                    {d.scars.totals.overdue > 0 && <span className="rounded-full border border-red-500/40 bg-red-500/10 text-red-300 px-2 py-0.5 tabular" title="response past due">{d.scars.totals.overdue} overdue</span>}
                    <span className="rounded-full border border-border/70 px-2 py-0.5 tabular text-muted-foreground">{d.scars.totals.closed} closed</span>
                  </span>
                </div>
                {Array.isArray(d.scars.trend) && d.scars.trend.length === 12 && d.scars.trend.some((n) => n > 0) && (
                  <div className="flex items-end gap-2 px-3 pb-2.5" title="SCARs raised per month (last 12 months)">
                    <span className="flex h-8 flex-1 items-end gap-1" aria-hidden>
                      {d.scars.trend.map((n, i) => {
                        const max = Math.max(...(d.scars.trend ?? [1]));
                        return (
                          <span
                            key={i}
                            className={cnSc("flex-1 rounded-sm transition-colors", n ? "bg-red-400/80" : "bg-zinc-700/50")}
                            style={{ height: n ? `${Math.max(3, Math.round((n / max) * 28))}px` : "2px" }}
                            title={`${d.months[i]?.month ?? ""}: ${n} SCAR(s) raised`}
                          />
                        );
                      })}
                    </span>
                    <span className="pb-0.5 text-[9.5px] uppercase tracking-wider text-muted-foreground">raises / 12 mo</span>
                  </div>
                )}
                <table className="w-full text-[12px]">
                  <tbody>
                    {d.scars.rows.map((s) => {
                      const active = !["CLOSED", "CANCELLED"].includes(s.status);
                      const overdue = active && s.responseDue && new Date(s.responseDue).getTime() < Date.now();
                      return (
                        <tr key={s.scarNumber} className="border-t border-border/40">
                          <td className="px-3 py-1.5"><Mono className="text-primary">{s.scarNumber}</Mono></td>
                          <td className="px-3 py-1.5"><StatusBadge status={s.status} /></td>
                          <td className="px-3 py-1.5">
                            <span className={cnSc("rounded px-1.5 py-0.5 text-[10px] font-semibold", s.severity === "CRITICAL" ? "bg-red-500/15 text-red-300" : s.severity === "MAJOR" ? "bg-amber-500/15 text-amber-300" : "bg-zinc-500/15 text-zinc-300")}>
                              {s.severity}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground max-w-[280px]">
                            <span className="block truncate" title={s.defectDescription}>{s.partSummary || s.defectDescription}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular whitespace-nowrap">
                            {s.grnNumber && <Mono className="text-[10px] text-muted-foreground mr-2">{s.grnNumber}</Mono>}
                            <span className={cnSc(overdue ? "text-red-300" : "text-muted-foreground")} title={s.responseDue ? `response due ${new Date(s.responseDue).toLocaleDateString("en-IN")}` : "no due date"}>
                              {overdue ? "⚠ " : ""}{s.responseDue ? `due ${new Date(s.responseDue).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : s.closedAt ? `closed ${new Date(s.closedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {d.recentPos.length > 0 && (
              <div className="rounded-md border border-border/60">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-3 pt-2.5">Recent purchase orders</p>
                <table className="w-full text-[12px]">
                  <tbody>
                    {d.recentPos.map((p) => (
                      <tr key={p.poNumber} className="border-t border-border/40">
                        <td className="px-3 py-1.5"><Mono className="text-primary">{p.poNumber}</Mono></td>
                        <td className="px-3 py-1.5"><StatusBadge status={p.status} /></td>
                        <td className="px-3 py-1.5 tabular text-muted-foreground">expected {p.expectedDate ? new Date(p.expectedDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular">₹{p.totalAmount.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Evidence window {d.window.from} → {d.window.to} · {d.totals.openPos} open PO(s) · ₹{d.totals.spend.toLocaleString("en-IN")} ordered in window.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Item master shared by New-RFQ / New-PO dialogs. Prefers the engineering
 *  /api/items route; degrades to this module's /api/rfqs?master=items. */
function useItemsMaster() {
  return useQuery<ItemMaster[]>({
    queryKey: ["items", "procurement"],
    queryFn: async () => {
      const normalize = (raw: unknown[]): ItemMaster[] =>
        raw
          .map((r) => {
            const o = (r ?? {}) as Record<string, unknown>;
            return {
              id: String(o.id ?? ""),
              partNumber: String(o.partNumber ?? o.part_number ?? ""),
              name: String(o.name ?? ""),
              uom: String(o.uom ?? "Nos"),
              trackingType: String(o.trackingType ?? "NONE"),
              criticality: String(o.criticality ?? "STANDARD"),
              unitCost: Number(o.unitCost ?? 0),
              gstRate: Number(o.gstRate ?? 18),
              itemType: String(o.itemType ?? ""),
              familyCode: String(o.familyCode ?? ""),
            };
          })
          .filter((i) => i.id && i.partNumber);
      try {
        const d = await api<unknown>("/api/items");
        const arr = Array.isArray(d) ? d : ((d as { items?: unknown[] })?.items ?? []);
        const norm = normalize(arr);
        if (norm.length > 0) return norm;
        throw new Error("empty item master");
      } catch {
        const d = await api<{ items?: unknown[] }>("/api/rfqs?master=items");
        return normalize(d.items ?? []);
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Tab: Suppliers
// ---------------------------------------------------------------------------

function SuppliersTab({ suppliers, loading, canApprove }: { suppliers: SupplierRow[]; loading: boolean; canApprove: boolean }) {
  const qc = useQueryClient();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [scorecardCode, setScorecardCode] = useState<string | null>(null);
  const detail = suppliers.find((s) => s.id === detailId) ?? null;
  const unapproved = suppliers.filter((s) => !s.approved);

  const mut = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) =>
      api("/api/suppliers/approve", { method: "POST", body: { supplierId: v.id, approve: v.approve } }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      useErpStore.getState().toast(v.approve ? "Supplier approved — approvedDate set, audited" : "Supplier approval revoked (audited)");
    },
    onError: (e: Error) => useErpStore.getState().toast(e.message, "err"),
  });

  const cols: Column<SupplierRow>[] = [
    { key: "code", header: "Code", render: (s) => <Mono className="font-medium text-primary">{s.code}</Mono> },
    { key: "name", header: "Supplier" },
    { key: "gstin", header: "GSTIN", render: (s) => <Mono className="text-[11px] text-muted-foreground">{s.gstin || "—"}</Mono> },
    { key: "city", header: "City", render: (s) => <span className="text-[12px]">{s.city || "—"}</span> },
    { key: "category", header: "Category", render: (s) => <StatusBadge status={s.category} /> },
    { key: "approved", header: "Approval", render: (s) => <StatusBadge status={s.approved ? "APPROVED" : "BLOCKED"} /> },
    { key: "rating", header: "Rating", render: (s) => <Stars value={s.rating} /> },
    { key: "ppm", header: "Defect PPM", render: (s) => <PpmCell ppm={s.ppm} /> },
    {
      key: "scarStats", header: "SCARs (12 mo)",
      render: (s) => <ScarTrendCell stats={s.scarStats} />,
    },
    {
      key: "onTimePct", header: "On-time",
      render: (s) => (
        <div className="w-20 space-y-1">
          <span className={`tabular text-[12px] ${s.onTimePct >= 95 ? "text-emerald-400" : s.onTimePct >= 90 ? "text-amber-400" : "text-red-400"}`}>
            {s.onTimePct}%
          </span>
          <Progress value={s.onTimePct} tone={s.onTimePct >= 95 ? "good" : "primary"} />
        </div>
      ),
    },
    ...(canApprove
      ? [{
          key: "actions", header: "Action",
          render: (s: SupplierRow) => (
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm" className="h-7 gap-1 text-[11px]"
                onClick={(e) => { e.stopPropagation(); setScorecardCode(s.code); }}
                title="12-month scorecard trend from GRN × IQC × PO evidence"
              >
                <TrendingUp className="h-3 w-3" /> Trend
              </Button>
              <Button
                variant={s.approved ? "outline" : "default"}
                size="sm" className="h-7 text-[11px]"
                disabled={mut.isPending}
                onClick={(e) => { e.stopPropagation(); mut.mutate({ id: s.id, approve: !s.approved }); }}
              >
                {s.approved ? "Revoke" : "Approve"}
              </Button>
            </div>
          ),
        } satisfies Column<SupplierRow>]
      : [{
          key: "actions", header: "Action",
          render: (s: SupplierRow) => (
            <Button
              variant="outline"
              size="sm" className="h-7 gap-1 text-[11px]"
              onClick={(e) => { e.stopPropagation(); setScorecardCode(s.code); }}
              title="12-month scorecard trend from GRN × IQC × PO evidence"
            >
              <TrendingUp className="h-3 w-3" /> Trend
            </Button>
          ),
        } satisfies Column<SupplierRow>]),
  ];

  return (
    <div className="space-y-3">
      {unapproved.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-300">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            Unapproved suppliers are <b>blocked for controlled items</b> (spec acceptance test):{" "}
            {unapproved.map((s) => (
              <Mono key={s.id} className="mr-2 text-amber-200">{s.code} {s.name}</Mono>
            ))}
          </span>
        </div>
      )}

      <DataTable
        columns={cols}
        rows={suppliers}
        loading={loading}
        onRowClick={(s) => setDetailId(s.id)}
        emptyMessage="No suppliers on file"
      />

      {scorecardCode && <ScorecardDialog code={scorecardCode} onClose={() => setScorecardCode(null)} />}

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="max-w-xl bg-zinc-950 border-border/80">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mono className="text-primary">{detail?.code}</Mono> {detail?.name}
              {detail && <StatusBadge status={detail.approved ? "APPROVED" : "BLOCKED"} />}
            </DialogTitle>
            <DialogDescription>Supplier master &amp; scorecard (synthetic vendor data)</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <KeyValue
                items={[
                  { k: "GSTIN", v: <span className="flex items-center gap-1.5"><Mono>{detail.gstin || "—"}</Mono><SyntheticBadge /></span> },
                  { k: "City", v: detail.city || "—" },
                  { k: "Category", v: <StatusBadge status={detail.category} /> },
                  { k: "Approved", v: detail.approved ? <span className="flex items-center gap-1.5"><StatusBadge status="APPROVED" /><DateCell value={detail.approvedDate} /></span> : <StatusBadge status="BLOCKED" /> },
                  { k: "Rating", v: <Stars value={detail.rating} /> },
                  { k: "Defect PPM", v: <PpmCell ppm={detail.ppm} /> },
                  { k: "On-time delivery", v: <span className="tabular">{detail.onTimePct}%</span> },
                  { k: "Purchase orders", v: <span className="tabular">{detail.poCount}</span> },
                ]}
              />
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => setScorecardCode(detail.code)}>
                <TrendingUp className="h-3.5 w-3.5" /> View 12-month scorecard trend
              </Button>
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
                <p className="text-[13px]">{detail.notes || <span className="text-muted-foreground">No notes recorded.</span>}</p>
                {!detail.approved && (
                  <p className="mt-2 text-[12px] text-amber-300">
                    ⚠ Unapproved — {detail.code} cannot receive awards or PO lines for CRITICAL (controlled) items.
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: RFQ & Quotations
// ---------------------------------------------------------------------------

function NewRfqDialog({ open, onOpenChange, items }: { open: boolean; onOpenChange: (v: boolean) => void; items: ItemMaster[] }) {
  const qc = useQueryClient();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [err, setErr] = useState("");

  const mut = useMutation({
    mutationFn: () => api("/api/rfqs", { method: "POST", body: { itemId, qty: Number(qty), dueDate: dueDate || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfqs"] });
      useErpStore.getState().toast("RFQ raised — status OPEN, quotations can be recorded");
      onOpenChange(false);
    },
    onError: (e: Error) => { setErr(e.message); useErpStore.getState().toast(e.message, "err"); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-zinc-950 border-border/80">
        <DialogHeader>
          <DialogTitle>New Request for Quotation</DialogTitle>
          <DialogDescription>Open RFQ — record supplier quotations, then award (procurement.approve).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Item</Label>
            <Select value={itemId || undefined} onValueChange={setItemId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select item…" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    <span className="flex items-center gap-2">
                      <Mono>{i.partNumber}</Mono>
                      <span className="text-muted-foreground truncate max-w-48">{i.name}</span>
                      {i.criticality === "CRITICAL" && <span className="text-[10px] text-red-400">CTL</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Quantity</Label>
              <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 500" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Quote due</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          {err && <p className="text-[12px] text-red-400 border border-red-500/30 bg-red-500/5 rounded-md p-2">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!itemId || !(Number(qty) > 0) || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Raising…" : "Raise RFQ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordQuoteDialog({ open, onOpenChange, rfq, suppliers }: { open: boolean; onOpenChange: (v: boolean) => void; rfq: RfqRow | null; suppliers: SupplierRow[] }) {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [moq, setMoq] = useState("");
  const [err, setErr] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api("/api/rfqs/quote", {
        method: "POST",
        body: { rfqId: rfq?.id, supplierId, unitPrice: Number(unitPrice), leadTimeDays: Number(leadTimeDays), moq: Number(moq || 0) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfqs"] });
      useErpStore.getState().toast("Quotation recorded against RFQ");
      onOpenChange(false);
    },
    onError: (e: Error) => { setErr(e.message); useErpStore.getState().toast(e.message, "err"); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-zinc-950 border-border/80">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Record quotation — <Mono className="text-primary">{rfq?.number}</Mono></DialogTitle>
          <DialogDescription>{rfq ? `${rfq.item.partNumber} · ${rfq.qty} ${rfq.item.uom}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Supplier</Label>
            <Select value={supplierId || undefined} onValueChange={setSupplierId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select supplier…" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      <Mono className="text-primary">{s.code}</Mono> {s.name}
                      {!s.approved && <span className="text-[10px] text-red-400">UNAPPROVED</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Unit price ₹</Label>
              <Input type="number" min="0" step="any" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Lead (days)</Label>
              <Input type="number" min="0" step="1" value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">MOQ</Label>
              <Input type="number" min="0" step="any" value={moq} onChange={(e) => setMoq(e.target.value)} placeholder="0" />
            </div>
          </div>
          {err && <p className="text-[12px] text-red-400 border border-red-500/30 bg-red-500/5 rounded-md p-2">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm" disabled={!supplierId || !(Number(unitPrice) >= 0) || !/^\d+$/.test(leadTimeDays) || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Saving…" : "Record quotation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RfqTab({
  rfqs, suppliers, items, loading, canCreate, canApprove,
}: {
  rfqs: RfqRow[]; suppliers: SupplierRow[]; items: ItemMaster[]; loading: boolean; canCreate: boolean; canApprove: boolean;
}) {
  const qc = useQueryClient();
  const [selId, setSelId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const sel = selId ? (rfqs.find((r) => r.id === selId) ?? null) : (rfqs[0] ?? null);
  const awardable = !!sel && ["OPEN", "QUOTED"].includes(sel.status);
  const awarded = sel?.quotations.find((q) => q.selected);

  const awardMut = useMutation({
    mutationFn: (quotationId: string) => api("/api/rfqs/award", { method: "POST", body: { quotationId } }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["rfqs"] });
      const r = d as { awardedSupplier?: string };
      useErpStore.getState().toast(`RFQ awarded to ${r.awardedSupplier ?? "supplier"} — audited`);
    },
    onError: (e: Error) => useErpStore.getState().toast(e.message, "err"),
  });

  const rfqCols: Column<RfqRow>[] = [
    { key: "number", header: "RFQ", render: (r) => <Mono className="font-medium text-primary">{r.number}</Mono> },
    {
      key: "item", header: "Item",
      render: (r) => (
        <div className="min-w-0">
          <Mono className="text-[11px]">{r.item.partNumber}</Mono>
          <p className="text-[11px] text-muted-foreground truncate">{r.item.name}</p>
        </div>
      ),
    },
    { key: "qty", header: "Qty", render: (r) => <span className="tabular">{r.qty} {r.item.uom}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "quotes", header: "Quotes", render: (r) => <span className="tabular text-[12px]">{r.quotations.length}</span> },
  ];

  const cmpCols: Column<RfqRow["quotations"][number]>[] = [
    {
      key: "supplier", header: "Supplier",
      render: (q) => (
        <div>
          <span className="flex items-center gap-1.5">
            <Mono className="text-primary">{q.supplier.code}</Mono>
            {!q.supplier.approved && <span className="text-[10px] text-red-400">UNAPPROVED</span>}
          </span>
          <p className="text-[11px] text-muted-foreground">{q.supplier.name}</p>
        </div>
      ),
    },
    { key: "unitPrice", header: "Unit price", render: (q) => <Money value={q.unitPrice} /> },
    { key: "leadTimeDays", header: "Lead", render: (q) => <span className="tabular text-[12px]">{q.leadTimeDays} d</span> },
    { key: "moq", header: "MOQ", render: (q) => <span className="tabular text-[12px]">{q.moq || "—"}</span> },
    { key: "status", header: "Status", render: (q) => <StatusBadge status={q.selected ? "SELECTED" : q.status} /> },
    ...(canApprove
      ? [{
          key: "award", header: "Action",
          render: (q: RfqRow["quotations"][number]) =>
            q.selected ? (
              <span className="text-[11px] font-medium text-emerald-400">Awarded</span>
            ) : awardable ? (
              <Button size="sm" className="h-7 text-[11px]" disabled={awardMut.isPending} onClick={() => awardMut.mutate(q.id)}>
                <Award className="h-3.5 w-3.5" /> Award
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground">—</span>
            ),
        } satisfies Column<RfqRow["quotations"][number]>]
      : []),
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">
          Quotation comparison → <b>Award</b> marks the quotation <Mono>SELECTED</Mono> and sets the RFQ <Mono>AWARDED</Mono> (audited).
        </p>
        {canCreate && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8 text-[12px]" disabled={!sel || !awardable} onClick={() => setQuoteOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Record quotation
            </Button>
            <Button size="sm" className="h-8 text-[12px]" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New RFQ
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <DataTable
            columns={rfqCols}
            rows={rfqs}
            loading={loading}
            onRowClick={(r) => setSelId(r.id)}
            rowKey={(r) => r.id}
            emptyMessage="No RFQs raised"
          />
        </div>
        <div className="rounded-lg border bg-card lg:col-span-3 overflow-hidden">
          {!sel ? (
            <EmptyState message="Select an RFQ to compare supplier quotations" icon={ClipboardList} />
          ) : (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-zinc-900/60 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13px] font-medium">
                    <Mono className="text-primary">{sel.number}</Mono>
                    <StatusBadge status={sel.status} />
                    <StatusBadge status={sel.item.criticality} />
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {sel.item.partNumber} · {sel.item.name} · {sel.qty} {sel.item.uom} · quotes due <DateCell value={sel.dueDate} />
                  </p>
                </div>
              </div>
              {sel.status === "AWARDED" && awarded && (
                <p className="border-b border-border/60 bg-emerald-500/5 px-3 py-2 text-[12px] text-emerald-300">
                  Awarded to <Mono>{awarded.supplier.code}</Mono> ({awarded.supplier.name}) @ <Money value={awarded.unitPrice} />, lead {awarded.leadTimeDays} d.
                </p>
              )}
              <DataTable
                columns={cmpCols}
                rows={sel.quotations}
                rowKey={(q) => q.id}
                emptyMessage="No quotations recorded yet — record one to compare"
              />
            </div>
          )}
        </div>
      </div>

      {newOpen && <NewRfqDialog open onOpenChange={setNewOpen} items={items} />}
      {quoteOpen && sel && <RecordQuoteDialog open onOpenChange={setQuoteOpen} rfq={sel} suppliers={suppliers} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Purchase Orders
// ---------------------------------------------------------------------------

/** Expedite rule (round-9): an active PO whose ETA falls within 7 days is
 *  flagged EXPEDITE — created that way by MRP create-pos for SO-driven
 *  shortages (+7d vs +14d), shown as a chip in the register + detail. */
const ACTIVE_PO_STATUS = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIAL"];
function poExpedite(p: { status: string; expectedDate: string | null }): boolean {
  return !!p.expectedDate && ACTIVE_PO_STATUS.includes(p.status) && new Date(p.expectedDate).getTime() - Date.now() <= 7 * 86400_000;
}

function ExpediteChip({ days }: { days: number }) {
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-red-500/50 bg-red-500/10 px-1.5 py-px align-middle text-[9.5px] font-bold uppercase tracking-wider text-red-300"
      title={`ETA within ${days} day(s) — MRP firm SO demand, expedite delivery`}
    >
      <Zap className="h-2.5 w-2.5" /> expedite
    </span>
  );
}

function PoTab({
  pos, suppliers, items, loading, canCreate, canApprove, focusPo,
}: {
  pos: PoRow[]; suppliers: SupplierRow[]; items: ItemMaster[]; loading: boolean; canCreate: boolean; canApprove: boolean; focusPo?: string;
}) {
  const qc = useQueryClient();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const detail = pos.find((p) => p.id === detailId) ?? null;
  // deep-link focus (#/procurement/pos/PO-YYYY-NNNN): auto-open the referenced PO once rows load
  React.useEffect(() => {
    if (!focusPo || loading) return;
    const hit = pos.find((p) => p.poNumber === focusPo);
    if (hit) setDetailId(hit.id);
  }, [focusPo, loading, pos]);

  const submitMut = useMutation({
    mutationFn: (poId: string) => api("/api/purchase-orders/submit", { method: "POST", body: { poId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      useErpStore.getState().toast("PO submitted for approval (DRAFT → PENDING_APPROVAL)");
    },
    onError: (e: Error) => useErpStore.getState().toast(e.message, "err"),
  });
  const approveMut = useMutation({
    mutationFn: (poId: string) => api("/api/purchase-orders/approve", { method: "POST", body: { poId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      useErpStore.getState().toast("PO approved — four-eyes verified, audit entry written");
    },
    onError: (e: Error) => useErpStore.getState().toast(e.message, "err"),
  });

  const cols: Column<PoRow>[] = [
    { key: "poNumber", header: "PO", render: (p) => <Mono className="font-medium text-primary">{p.poNumber}</Mono> },
    {
      key: "supplier", header: "Supplier",
      render: (p) => (
        <div>
          <p>{p.supplier.name}</p>
          <p className="text-[11px] text-muted-foreground"><Mono>{p.supplier.code}</Mono>{!p.supplier.approved ? " · UNAPPROVED" : ""}</p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
    { key: "totalAmount", header: "Total (ex-GST)", render: (p) => <Money value={p.totalAmount} /> },
    {
      key: "progress", header: "Received",
      render: (p) => {
        const totalQty = p.lines.reduce((s, l) => s + l.qty, 0);
        const recv = p.lines.reduce((s, l) => s + l.receivedQty, 0);
        const pct = totalQty > 0 ? (recv / totalQty) * 100 : 0;
        return (
          <div className="w-24 space-y-1">
            <span className="tabular text-[12px] text-muted-foreground">{recv}/{totalQty}</span>
            <Progress value={pct} tone={pct >= 100 ? "good" : "primary"} />
          </div>
        );
      },
    },
    { key: "approvedBy", header: "Approved by", render: (p) => (p.approvedBy ? <Mono>{p.approvedBy}</Mono> : <span className="text-muted-foreground">—</span>) },
    { key: "orderDate", header: "Ordered", render: (p) => <DateCell value={p.orderDate} /> },
    { key: "expectedDate", header: "Expected", render: (p) => <span className="whitespace-nowrap"><DateCell value={p.expectedDate} />{poExpedite(p) && <ExpediteChip days={Math.max(0, Math.ceil(((p.expectedDate ? new Date(p.expectedDate).getTime() : Date.now()) - Date.now()) / 86400_000))} />}</span> },
  ];

  return (
    <div className="space-y-3">
      {canCreate && (
        <div className="flex justify-end">
          <Button size="sm" className="h-8 text-[12px]" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New PO
          </Button>
        </div>
      )}
      <DataTable columns={cols} rows={pos} loading={loading} onRowClick={(p) => setDetailId(p.id)} emptyMessage="No purchase orders" />

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto erp-scroll bg-zinc-950 border-border/80">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mono className="text-primary">{detail?.poNumber}</Mono>
              {detail && <StatusBadge status={detail.status} />}
            </DialogTitle>
            <DialogDescription>Purchase order detail — lines, receipts and approval state</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              {poExpedite(detail) && (
                <div className="flex items-start gap-2.5 rounded-md border border-red-500/40 bg-gradient-to-r from-red-500/15 via-red-500/5 to-transparent p-3">
                  <Zap className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
                  <div className="min-w-0 text-[12px]">
                    <p className="font-semibold text-red-300">EXPEDITE — escalated to the Purchase Manager</p>
                    <p className="text-muted-foreground">
                      Firm SO demand via MRP shortage conversion — a WARNING notification was raised to PURCHASE_MGR when this PO was created. Approve &amp; release without delay; the supplier is to be informed via the portal (mock).
                    </p>
                  </div>
                </div>
              )}
              <KeyValue
                items={[
                  { k: "Supplier", v: <span><Mono className="text-primary">{detail.supplier.code}</Mono> · {detail.supplier.name}{!detail.supplier.approved ? " (UNAPPROVED)" : ""}</span> },
                  { k: "Status", v: <StatusBadge status={detail.status} /> },
                  { k: "Approved by", v: detail.approvedBy ? <Mono>{detail.approvedBy}</Mono> : <span className="text-muted-foreground">pending</span> },
                  { k: "Ordered", v: <DateCell value={detail.orderDate} /> },
                  { k: "Expected", v: <span className="whitespace-nowrap"><DateCell value={detail.expectedDate} />{poExpedite(detail) && <ExpediteChip days={Math.max(0, Math.ceil(((detail.expectedDate ? new Date(detail.expectedDate).getTime() : Date.now()) - Date.now()) / 86400_000))} />}<span className="ml-2 hidden text-[10.5px] text-muted-foreground xl:inline">ETA basis: quotation lead → item-master proc lead → default; SO demand compresses to +7d</span></span> },
                  { k: "Total (ex-GST)", v: <Money value={detail.totalAmount} /> },
                ]}
              />

              <DataTable
                dense
                maxHeight="max-h-[30vh]"
                columns={[
                  { key: "item", header: "Item", render: (l) => <span><Mono className="text-primary">{l.item.partNumber}</Mono> <span className="text-[11px] text-muted-foreground">{l.item.name}</span></span> },
                  { key: "qty", header: "Qty", render: (l) => <span className="tabular">{l.qty} {l.item.uom}</span> },
                  { key: "receivedQty", header: "Received", render: (l) => <span className={`tabular ${l.receivedQty >= l.qty ? "text-emerald-400" : "text-amber-400"}`}>{l.receivedQty}</span> },
                  { key: "unitPrice", header: "Unit price", render: (l) => <Money value={l.unitPrice} /> },
                  { key: "gstRate", header: "GST", render: (l) => <span className="tabular text-[12px]">{l.gstRate}%</span> },
                  { key: "lineTotal", header: "Line total (incl GST)", render: (l) => <Money value={l.qty * l.unitPrice * (1 + l.gstRate / 100)} /> },
                ]}
                rows={detail.lines}
                rowKey={(l) => l.id}
                emptyMessage="No lines"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">Receipts:</span>
                  {detail.receipts.length === 0 && <span className="text-[12px] text-muted-foreground">none yet</span>}
                  {detail.receipts.map((r) => (
                    <span key={r.id} className="flex items-center gap-1.5 rounded border border-border/60 bg-background/40 px-2 py-0.5">
                      <Mono className="text-[11px] text-primary">{r.grnNumber}</Mono>
                      <StatusBadge status={r.status} />
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {detail.status === "DRAFT" && canCreate && (
                    <Button size="sm" className="h-8 text-[12px]" disabled={submitMut.isPending} onClick={() => submitMut.mutate(detail.id)}>
                      <FileSignature className="h-3.5 w-3.5" /> Submit for approval
                    </Button>
                  )}
                  {detail.status === "PENDING_APPROVAL" && canApprove && (
                    <Button size="sm" className="h-8 text-[12px]" disabled={approveMut.isPending} onClick={() => approveMut.mutate(detail.id)}>
                      <ShieldAlert className="h-3.5 w-3.5" /> Approve (four-eyes)
                    </Button>
                  )}
                  {detail.status === "PENDING_APPROVAL" && (
                    <p className="max-w-64 text-[11px] text-muted-foreground">
                      Four-eyes (spec rule 12): approver must differ from the PO creator/submitter — enforced server-side.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {newOpen && <NewPoDialog open onOpenChange={setNewOpen} suppliers={suppliers} items={items} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Goods Receipts (GRN / IQC)
// ---------------------------------------------------------------------------

function ReceiptsTab({
  receipts, templates, pos, loading, canCreate, canInspect, scarByGrn = {},
}: {
  receipts: GrnRow[]; templates: InspTemplate[]; pos: PoRow[]; loading: boolean; canCreate: boolean; canInspect: boolean;
  scarByGrn?: Record<string, { scarNumber: string; status: string; severity: string }>;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [iqcTarget, setIqcTarget] = useState<{ lineId: string; inspId: string } | null>(null);
  const detail = receipts.find((r) => r.id === detailId) ?? null;
  const iqcLine = detail?.lines.find((l) => l.id === iqcTarget?.lineId) ?? null;
  const iqcInsp = iqcLine?.inspections.find((i) => i.id === iqcTarget?.inspId) ?? null;
  const iqcTemplate = templates.find((t) => t.code === iqcInsp?.templateCode) ?? null;

  const cols: Column<GrnRow>[] = [
    { key: "grnNumber", header: "GRN", render: (g) => <Mono className="font-medium text-primary">{g.grnNumber}</Mono> },
    {
      key: "supplier", header: "Supplier",
      render: (g) => (
        <div>
          <p>{g.supplier.name}</p>
          <p className="text-[11px] text-muted-foreground"><Mono>{g.supplier.code}</Mono></p>
        </div>
      ),
    },
    { key: "po", header: "PO", render: (g) => (g.po ? <Mono className="text-[12px]">{g.po.poNumber}</Mono> : <span className="text-muted-foreground">—</span>) },
    { key: "receivedBy", header: "Received by", render: (g) => <Mono>{g.receivedBy}</Mono> },
    { key: "receivedAt", header: "Received at", render: (g) => <DateCell value={g.receivedAt} /> },
    { key: "status", header: "Status", render: (g) => <StatusBadge status={g.status} /> },
    {
      key: "scar", header: "SCAR",
      render: (g) => {
        const scar = scarByGrn[g.grnNumber];
        if (!scar) return <span className="text-muted-foreground text-[11px]">—</span>;
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap" title={`Supplier corrective action ${scar.scarNumber} (${scar.status})`}>
            <FileWarning className="h-3 w-3 text-orange-400" />
            <Mono className="text-[11px] text-orange-300">{scar.scarNumber}</Mono>
          </span>
        );
      },
    },
    {
      key: "lines", header: "Lines / dispositions",
      render: (g) => {
        const pending = g.lines.filter((l) => l.disposition === "PENDING_IQC").length;
        const ok = g.lines.filter((l) => l.disposition === "ACCEPTED").length;
        const rej = g.lines.filter((l) => l.disposition === "REJECTED").length;
        return (
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
            {g.lines.length} line{g.lines.length === 1 ? "" : "s"} ·{" "}
            {pending > 0 && <span className="text-orange-300">{pending} pending IQC </span>}
            {ok > 0 && <span className="text-emerald-400">{ok} accepted </span>}
            {rej > 0 && <span className="text-red-400">{rej} rejected</span>}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      {canCreate && (
        <div className="flex justify-end">
          <Button size="sm" className="h-8 text-[12px]" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Create GRN
          </Button>
        </div>
      )}
      <DataTable columns={cols} rows={receipts} loading={loading} onRowClick={(g) => setDetailId(g.id)} emptyMessage="No goods receipts yet" />

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto erp-scroll bg-zinc-950 border-border/80">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mono className="text-primary">{detail?.grnNumber}</Mono>
              {detail && <StatusBadge status={detail.status} />}
            </DialogTitle>
            <DialogDescription>
              Goods receipt — lines are dispositioned by IQC; accepted stock lands in <Mono>WH-ACC</Mono>, rejects in <Mono>WH-REJ</Mono>.
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <KeyValue
                items={[
                  { k: "Supplier", v: <span><Mono className="text-primary">{detail.supplier.code}</Mono> · {detail.supplier.name}</span> },
                  { k: "Purchase order", v: detail.po ? <Mono>{detail.po.poNumber}</Mono> : "—" },
                  { k: "Received by", v: <Mono>{detail.receivedBy}</Mono> },
                  { k: "Received at", v: <DateCell value={detail.receivedAt} /> },
                  { k: "Status", v: <StatusBadge status={detail.status} /> },
                ]}
              />
              {detail.remarks && (
                <p className="rounded-md border border-border/60 bg-background/40 p-2.5 text-[12px] text-muted-foreground">{detail.remarks}</p>
              )}

              <DataTable
                dense
                maxHeight="max-h-[36vh]"
                columns={[
                  { key: "item", header: "Item", render: (l) => <span><Mono className="text-primary">{l.item.partNumber}</Mono> <span className="text-[11px] text-muted-foreground">{l.item.name}</span></span> },
                  { key: "qty", header: "Qty", render: (l) => <span className="tabular">{l.qty} {l.item.uom}</span> },
                  { key: "batch", header: "Supplier batch", render: (l) => <Mono className="text-[11px]">{l.supplierBatch || "—"}</Mono> },
                  { key: "ref", header: "Mfr ref", render: (l) => <Mono className="text-[11px] text-muted-foreground">{l.manufacturerRef || "—"}</Mono> },
                  { key: "disposition", header: "Disposition", render: (l) => <StatusBadge status={l.disposition} /> },
                  {
                    key: "iqc", header: "IQC",
                    render: (l) => {
                      const insp = l.inspections[0];
                      if (!insp) return <span className="text-[11px] text-muted-foreground">—</span>;
                      return (
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <Mono className="text-[11px] text-primary">{insp.inspNumber}</Mono>
                          <StatusBadge status={insp.status} />
                          {insp.status === "PENDING" && canInspect && (
                            <Button
                              size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                              onClick={() => setIqcTarget({ lineId: l.id, inspId: insp.id })}
                            >
                              Submit IQC
                            </Button>
                          )}
                        </span>
                      );
                    },
                  },
                ]}
                rows={detail.lines}
                rowKey={(l) => l.id}
                emptyMessage="No lines"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {newOpen && <NewGrnDialog open onOpenChange={setNewOpen} pos={pos} />}
      {iqcTarget && (
        <IqcDialog open onOpenChange={(v) => !v && setIqcTarget(null)} line={iqcLine} inspection={iqcInsp} template={iqcTemplate} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View root
// ---------------------------------------------------------------------------

const TAB_KEYS = ["suppliers", "rfqs", "pos", "receipts", "scars"];

export default function ProcurementView() {
  const sessionUser = useErpStore((s) => s.sessionUser);
  const route = useErpStore((s) => s.route);
  const navigate = useErpStore((s) => s.navigate);
  const canView = hasPerm(sessionUser?.role, "procurement.view");
  const canCreate = hasPerm(sessionUser?.role, "procurement.create");
  const canApprove = hasPerm(sessionUser?.role, "procurement.approve");
  const canInspect = hasPerm(sessionUser?.role, "quality.inspect");
  const [tab, setTabState] = useState(() => (TAB_KEYS.includes(route.tab) ? route.tab : "suppliers"));
  // hash → tab sync: deep links (#/procurement/<tab>) and back/forward must work
  React.useEffect(() => {
    if (route.tab && TAB_KEYS.includes(route.tab)) setTabState(route.tab);
  }, [route.tab]);
  const setTab = (k: string) => { setTabState(k); navigate("procurement", k); };

  const suppliersQ = useQuery<{ suppliers: SupplierRow[] }>({
    queryKey: ["suppliers"],
    queryFn: () => api<{ suppliers: SupplierRow[] }>("/api/suppliers"),
  });
  const rfqsQ = useQuery<{ rfqs: RfqRow[] }>({
    queryKey: ["rfqs"],
    queryFn: () => api<{ rfqs: RfqRow[] }>("/api/rfqs?master=items"),
  });
  const posQ = useQuery<{ purchaseOrders: PoRow[] }>({
    queryKey: ["purchase-orders"],
    queryFn: () => api<{ purchaseOrders: PoRow[] }>("/api/purchase-orders"),
  });
  const receiptsQ = useQuery<ReceiptsPayload>({
    queryKey: ["receipts"],
    queryFn: () => api<ReceiptsPayload>("/api/receipts"),
  });
  const scarsQ = useQuery<ScarsPayload>({
    queryKey: ["scars"],
    queryFn: () => api<ScarsPayload>("/api/scars"),
  });
  const itemsQ = useItemsMaster();

  const suppliers = useMemo(() => suppliersQ.data?.suppliers ?? [], [suppliersQ.data]);
  const rfqs = useMemo(() => rfqsQ.data?.rfqs ?? [], [rfqsQ.data]);
  const pos = useMemo(() => posQ.data?.purchaseOrders ?? [], [posQ.data]);
  const receipts = useMemo(() => receiptsQ.data?.receipts ?? [], [receiptsQ.data]);
  const items = itemsQ.data ?? [];

  if (!canView) {
    return (
      <div className="space-y-5">
        <SectionHeader icon={ShoppingCart} title="Procurement" desc="Suppliers · RFQ & quotations · Purchase orders · GRN/IQC" actions={<SyntheticBadge />} />
        <PermDenied perm="procurement.view" />
      </div>
    );
  }

  const approvedSuppliers = suppliers.filter((s) => s.approved).length;
  const openRfqs = rfqs.filter((r) => ["OPEN", "QUOTED"].includes(r.status)).length;
  const posPending = pos.filter((p) => p.status === "PENDING_APPROVAL").length;
  const grnsPendingIqc = receipts.filter((g) => g.status === "IQC_PENDING").length;
  const scarsOpen = scarsQ.data?.stats.open ?? 0;
  const scarsOverdue = scarsQ.data?.stats.overdueResponse ?? 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={ShoppingCart}
        title="Procurement — Procure-to-Pay"
        desc="Demand → RFQ → quotation comparison → PO (four-eyes approval) → GRN / barcode → IQC routing"
        actions={<SyntheticBadge />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Suppliers" value={suppliers.length} icon={Building2}
          sub={`${approvedSuppliers}/${suppliers.length} approved`}
          tone={suppliers.length > 0 && approvedSuppliers < suppliers.length ? "warn" : "good"}
        />
        <StatCard label="Open RFQs" value={openRfqs} icon={ClipboardList} tone={openRfqs > 0 ? "warn" : "default"} sub="awaiting quotation / award" />
        <StatCard label="POs pending approval" value={posPending} icon={FileSignature} tone={posPending > 0 ? "warn" : "good"} sub="four-eyes queue" />
        <StatCard label="GRNs pending IQC" value={grnsPendingIqc} icon={PackageSearch} tone={grnsPendingIqc > 0 ? "warn" : "good"} sub="lots held in WH-IQC" />
        <StatCard
          label="Open SCARs" value={scarsOpen} icon={FileWarning}
          tone={scarsOverdue > 0 ? "bad" : scarsOpen > 0 ? "warn" : "good"}
          sub={scarsOverdue > 0 ? `${scarsOverdue} response(s) overdue` : "supplier corrective loop"}
          onClick={() => setTab("scars")}
        />
      </div>

      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "suppliers", label: "Suppliers", count: suppliers.length },
          { key: "rfqs", label: "RFQ & Quotations", count: rfqs.length },
          { key: "pos", label: "Purchase Orders", count: pos.length },
          { key: "receipts", label: "Goods Receipts (GRN / IQC)", count: receipts.length },
          { key: "scars", label: "Supplier Quality (SCAR)", count: scarsQ.data?.scars.length ?? 0 },
        ]}
      />

      {tab === "suppliers" && <SuppliersTab suppliers={suppliers} loading={suppliersQ.isLoading} canApprove={canApprove} />}
      {tab === "rfqs" && <RfqTab rfqs={rfqs} suppliers={suppliers} items={items} loading={rfqsQ.isLoading} canCreate={canCreate} canApprove={canApprove} />}
      {tab === "pos" && <PoTab pos={pos} suppliers={suppliers} items={items} loading={posQ.isLoading} canCreate={canCreate} canApprove={canApprove} focusPo={route.tab === "pos" ? route.param : ""} />}
      {tab === "receipts" && <ReceiptsTab receipts={receipts} templates={receiptsQ.data?.templates ?? []} pos={pos} loading={receiptsQ.isLoading} canCreate={canCreate} canInspect={canInspect} scarByGrn={scarsQ.data?.scarByGrn ?? {}} />}
      {tab === "scars" && <ScarTab />}
    </div>
  );
}
