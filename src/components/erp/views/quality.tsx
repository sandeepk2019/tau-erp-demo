"use client";
// ============================================================================
// Tau ERP — Quality & Tests module (Task 3-e)
// Inspections (immutable evidence, spec rule 9) · NCR → Containment → MRB
// (four-eyes, rule 12) → CAPA · Calibration/EOL analytics · Product release
// evidence gate · Equipment calibration register (GAUGE-LEAK-01 gate).
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { hasPerm } from "@/lib/erp/constants";
import { cn } from "@/lib/utils";
import { DataTable, DateCell, KeyValue, Mono, SectionHeader, StatCard, StatusBadge, SubTabs, SyntheticBadge, type Column } from "../shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle, BadgeCheck, CalendarClock, Check, ClipboardList, ClipboardX, FileCheck2,
  FlaskConical, Gauge, History, Lock, Plus, Printer, RotateCcw, ShieldAlert, TrendingUp, Wrench, X, FileText,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ScarTab, { type ScarsPayload } from "./procurement/scar-tab";
import { PRINT_EVENT } from "../print-center";
import CalibrationCalendar from "./calibration-calendar";

/** Fire a controlled 8D print (assembled server-side from NCR/CAPA/MRB evidence). */
export function print8D(ncrNumber: string) {
  window.dispatchEvent(new CustomEvent(PRINT_EVENT, { detail: { kind: "8d", ncr: ncrNumber } }));
}

// ============================================================================
// Types (server payloads, JSON-serialized)
// ============================================================================
type TParam = { name: string; unit?: string; lower?: number; upper?: number; kind?: string };
type Insp = {
  id: string; inspNumber: string; kind: string; templateCode: string; refType: string; refId: string;
  lotNumber: string; woNumber: string; equipmentCode: string; attempt: number; retestReason: string;
  status: string; resultsJson: string; overallResult: string; inspectorId: string | null;
  approvedBy: string; submittedAt: string | null; grnLineId: string | null; immutable: boolean;
};
type Template = { id: string; code: string; name: string; familyCode: string; kind: string; paramsJson: string };
type Equipment = { id: string; code: string; name: string; kind: string; stationCode: string; calibrationDue: string | null; status: string };
type InspPayload = {
  inspections: Insp[]; templates: Template[]; equipment: Equipment[];
  woFamily: Record<string, string>; users: Record<string, string>;
};

type MrbT = { id: string; ncrId: string; disposition: string; justification: string; decidedBy: string; approvedBy: string; stockAction: string; createdAt: string };
type CapaChip = { id: string; capaNumber: string; kind: string; status: string; owner: string; dueDate: string | null };
type NcrT = {
  id: string; ncrNumber: string; inspectionId: string | null; sourceRef: string; lotNumber: string; woNumber: string;
  severity: string; description: string; containmentJson: string; status: string; raisedBy: string;
  createdAt: string; closedAt: string | null; mrb: MrbT[]; capas: CapaChip[];
};
type ReworkT = { id: string; rwNumber: string; ncrId: string | null; woNumber: string; targetLotNumber: string; instructions: string; authorizedBy: string; status: string; outcome: string; createdAt: string };
type NcrPayload = { ncrs: NcrT[]; reworkOrders: ReworkT[]; lots: Record<string, { status: string; warehouseCode: string; trackingType: string }> };

type CapaActionT = { action: string; owner?: string; dueDate?: string; done?: boolean };
type CapaT = { id: string; capaNumber: string; ncrId: string | null; ncrNumber?: string; kind: string; problem: string; rootCause: string; actionsJson: string; owner: string; dueDate: string | null; status: string; effectiveness: string; createdAt: string; closedAt: string | null };
type CapaPayload = { capas: CapaT[] };

type ReleaseT = { id: string; releaseNumber: string; lotNumber: string; woNumber: string; checksJson: string; status: string; blockersJson: string; releasedBy: string; approvedBy: string; releasedAt: string | null; createdAt: string };
type EligibleLot = { lotNumber: string; woNumber: string; partNumber: string; family: string; hasOpenCheck: boolean; lotStatus: string };
type RelPayload = { releases: ReleaseT[]; eligibleLots: EligibleLot[] };

type ScopeEntry = { type: string; ref: string; note: string }; // shape of API-computed containment entries
type ResultRow = { parameter: string; unit?: string; value: unknown; lower?: number | null; upper?: number | null; pass?: boolean };
type Checks = { genealogyComplete: boolean; inspectionsPassed: boolean; calOk: boolean; eolOk: boolean; finalOk: boolean };

// ============================================================================
// Helpers
// ============================================================================
function jparse<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}
const fmtDT = (s?: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

type CalState = "OK" | "DUE_SOON" | "EXPIRED" | "NONE";
function calState(due?: string | null): CalState {
  if (!due) return "NONE";
  const days = (new Date(due).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "EXPIRED";
  if (days <= 14) return "DUE_SOON";
  return "OK";
}
const CAL_DOT: Record<CalState, string> = { OK: "bg-emerald-400", DUE_SOON: "bg-amber-400", EXPIRED: "bg-red-500", NONE: "bg-zinc-600" };
const CAL_LABEL: Record<CalState, string> = { OK: "calibrated", DUE_SOON: "cal due ≤14d", EXPIRED: "cal EXPIRED — tests blocked", NONE: "no calibration date" };

const KIND_STYLES: Record<string, string> = {
  IQC: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  INPROCESS: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  CALIBRATION: "border-teal-500/40 bg-teal-500/10 text-teal-300",
  EOL: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  FINAL: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};
const KINDS = ["IQC", "INPROCESS", "CALIBRATION", "EOL", "FINAL"];
const FAMILIES = ["NOX", "LAMBDA", "DELTAP", "EGT", "UQS"];
const CHART_TOOLTIP = {
  contentStyle: { background: "oklch(0.21 0.006 260)", border: "1px solid oklch(0.29 0.008 260)", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "oklch(0.93 0.003 260)" },
} as const;

function KindBadge({ kind }: { kind: string }) {
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 whitespace-nowrap", KIND_STYLES[kind] ?? "border-zinc-500/40 bg-zinc-500/10 text-zinc-300")}>
      {kind}
    </Badge>
  );
}
function CalDot({ state, className }: { state: CalState; className?: string }) {
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", CAL_DOT[state], className)} title={CAL_LABEL[state]} />;
}
function CheckX({ okv }: { okv: boolean }) {
  return okv ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <X className="h-3.5 w-3.5 text-red-400" />;
}
function PermHint({ show, children }: { show: boolean; children?: React.ReactNode }) {
  if (!show) return null;
  return <p className="text-[11px] text-amber-400/90">{children ?? "Your role lacks the required permission — switch user in the topbar to demo server-enforced RBAC."}</p>;
}

// ============================================================================
// Root view
// ============================================================================
export default function QualityView() {
  const route = useErpStore((s) => s.route);
  const sessionUser = useErpStore((s) => s.sessionUser);
  const [tab, setTab] = useState<string>(route.tab === "capa" ? "ncr" : route.tab || "inspections");
  useEffect(() => {
    if (route.tab) setTab(route.tab === "capa" ? "ncr" : route.tab);
  }, [route.tab]);

  const inspQ = useQuery<InspPayload>({ queryKey: ["inspections"], queryFn: () => api<InspPayload>("/api/inspections") });
  const ncrQ = useQuery<NcrPayload>({ queryKey: ["ncr"], queryFn: () => api<NcrPayload>("/api/ncr") });
  const capaQ = useQuery<CapaPayload>({ queryKey: ["capa"], queryFn: () => api<CapaPayload>("/api/capa") });
  const eqQ = useQuery<{ equipment: Equipment[] }>({ queryKey: ["equipment"], queryFn: () => api("/api/equipment") });
  const relQ = useQuery<RelPayload>({ queryKey: ["releases"], queryFn: () => api<RelPayload>("/api/releases") });
  const scarsQ = useQuery<ScarsPayload>({ queryKey: ["scars"], queryFn: () => api<ScarsPayload>("/api/scars") });

  const canInspect = hasPerm(sessionUser?.role, "quality.inspect");
  const canApprove = hasPerm(sessionUser?.role, "quality.approve");
  const canNcr = hasPerm(sessionUser?.role, "quality.ncr");

  // ---- StatCard data -------------------------------------------------------
  const inspections = inspQ.data?.inspections ?? [];
  const pendingInsps = inspections.filter((i) => i.status === "PENDING").length;
  const failed24h = inspections.filter((i) => i.status === "FAILED" && i.submittedAt && Date.now() - new Date(i.submittedAt).getTime() < 86_400_000).length;
  const ncrs = ncrQ.data?.ncrs ?? [];
  const openNcrs = ncrs.filter((n) => n.status !== "CLOSED").length;
  const equipment = eqQ.data?.equipment ?? [];
  const expiredEq = equipment.filter((e) => calState(e.calibrationDue) === "EXPIRED").length;
  const releases = relQ.data?.releases ?? [];
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const releasesToday = releases.filter((r) => r.releasedAt && new Date(r.releasedAt).getTime() >= startOfDay.getTime()).length;
  const eolAll = inspections.filter((i) => i.kind === "EOL");
  const eolFirst = eolAll.filter((i) => i.attempt === 1);
  const fpy = eolFirst.length ? Math.round((eolFirst.filter((i) => i.status === "PASSED").length / eolFirst.length) * 100) : 100;

  // ---- dialog selection state ----------------------------------------------
  const [selInspId, setSelInspId] = useState<string | null>(null);
  const [newInspOpen, setNewInspOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [selNcrId, setSelNcrId] = useState<string | null>(null);
  const [raiseNcrOpen, setRaiseNcrOpen] = useState(false);
  const [selCapaId, setSelCapaId] = useState<string | null>(null);
  const [createCapaOpen, setCreateCapaOpen] = useState(false);
  const [runRelOpen, setRunRelOpen] = useState(false);
  const [selRelId, setSelRelId] = useState<string | null>(null);

  const pendingMrb = ncrs.filter((n) => n.status === "MRB" && (n.mrb.length === 0 || n.mrb.some((d) => !d.approvedBy)));
  const pendingRelApproval = releases.filter((r) => r.status === "PENDING");

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={BadgeCheck}
        title="Quality & Tests"
        desc="Inspection evidence · NCR/MRB/CAPA · calibration & EOL · product release gate · plant PLANT-PUNE"
        actions={<SyntheticBadge />}
      />

      {/* KPI ROW */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Pending Inspections" value={inspQ.isLoading ? "—" : pendingInsps} sub="awaiting results" icon={ClipboardList} tone={pendingInsps > 0 ? "warn" : "default"} onClick={() => setTab("inspections")} />
        <StatCard label="Failed (24h)" value={inspQ.isLoading ? "—" : failed24h} sub="immutable failures" icon={ClipboardX} tone={failed24h > 0 ? "bad" : "good"} onClick={() => setTab("inspections")} />
        <StatCard label="Open NCRs" value={ncrQ.isLoading ? "—" : openNcrs} sub={pendingMrb.length > 0 ? `${pendingMrb.length} at MRB stage` : "incl. MRB queue"} icon={ShieldAlert} tone={openNcrs > 0 ? "bad" : "good"} onClick={() => setTab("ncr")} />
        <StatCard label="Equipment Expired" value={eqQ.isLoading ? "—" : expiredEq} sub="calibration gate active" icon={Wrench} tone={expiredEq > 0 ? "bad" : "good"} onClick={() => setTab("equipment")} />
        <StatCard label="Releases Today" value={relQ.isLoading ? "—" : releasesToday} sub="approved (four-eyes)" icon={FileCheck2} tone="good" onClick={() => setTab("releases")} />
        <StatCard label="FPY" value={inspQ.isLoading ? "—" : `${fpy}%`} sub="EOL first-pass yield" icon={TrendingUp} tone={fpy >= 90 ? "good" : "warn"} onClick={() => setTab("calibration")} />
      </div>

      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "inspections", label: "Inspections", count: pendingInsps },
          { key: "ncr", label: "NCR / MRB / CAPA", count: openNcrs },
          { key: "calibration", label: "Calibration / EOL", count: inspections.filter((i) => i.kind === "CALIBRATION" && i.status === "PENDING").length + inspections.filter((i) => i.kind === "EOL" && i.status === "PENDING").length },
          { key: "releases", label: "Product Release", count: pendingRelApproval.length },
          { key: "equipment", label: "Equipment", count: expiredEq + equipment.filter((e) => calState(e.calibrationDue) === "DUE_SOON").length },
          { key: "scar", label: "Supplier SCARs", count: scarsQ.data?.stats.open ?? 0 },
        ]}
      />

      {tab === "inspections" && (
        <InspectionsTab
          data={inspQ.data}
          loading={inspQ.isLoading}
          canInspect={canInspect}
          onOpen={setSelInspId}
          onNew={() => setNewInspOpen(true)}
        />
      )}

      {tab === "ncr" && (
        <NcrTab
          ncrData={ncrQ.data}
          capaQ={capaQ}
          loadingNcr={ncrQ.isLoading}
          loadingCapa={capaQ.isLoading}
          pendingMrb={pendingMrb}
          canNcr={canNcr}
          canInspect={canInspect}
          canApprove={canApprove}
          onOpenNcr={setSelNcrId}
          onRaise={() => setRaiseNcrOpen(true)}
          onOpenCapa={setSelCapaId}
          onNewCapa={() => setCreateCapaOpen(true)}
        />
      )}

      {tab === "calibration" && (
        <CalibrationTab
          data={inspQ.data}
          loading={inspQ.isLoading}
          onOpen={setSelInspId}
          onRecord={() => setRecordOpen(true)}
        />
      )}

      {tab === "releases" && (
        <ReleasesTab
          data={relQ.data}
          loading={relQ.isLoading}
          canApprove={canApprove}
          sessionUser={sessionUser?.username ?? ""}
          onOpen={setSelRelId}
          onRun={() => setRunRelOpen(true)}
        />
      )}

      {tab === "equipment" && (
        <EquipmentTab equipment={equipment} loading={eqQ.isLoading} canInspect={canInspect} />
      )}

      {tab === "scar" && <ScarTab />}

      {/* Spec gates footnote */}
      <Card className="border-primary/20">
        <CardContent className="p-4 text-[12px] text-muted-foreground space-y-1.5">
          <p className="font-medium text-foreground/90">Quality gates enforced server-side (spec Phase-10 + rules 9/12)</p>
          <p>
            Submitted test evidence is <span className="text-amber-300">immutable</span> — corrections only via authorized retest (attempt+1, mandatory reason) ·
            expired equipment blocks tests (<Mono>GAUGE-LEAK-01</Mono>) · MRB decision + product release require a <span className="text-amber-300">four-eyes</span> approval by a different user ·
            CAPA cannot close without an effectiveness review · release gate verifies genealogy + CAL/EOL/FINAL evidence.
          </p>
        </CardContent>
      </Card>

      {/* ---------------- Dialogs ---------------- */}
      {selInspId && <InspDialog inspId={selInspId} onClose={() => setSelInspId(null)} />}
      {newInspOpen && <NewInspectionDialog onClose={() => setNewInspOpen(false)} />}
      {recordOpen && <RecordResultDialog onClose={() => setRecordOpen(false)} />}
      {selNcrId && <NcrDialog ncrId={selNcrId} canNcr={canNcr} canInspect={canInspect} canApprove={canApprove} sessionUser={sessionUser?.username ?? ""} onClose={() => setSelNcrId(null)} />}
      {raiseNcrOpen && <RaiseNcrDialog canNcr={canNcr} onClose={() => setRaiseNcrOpen(false)} />}
      {selCapaId && <CapaDialog capaId={selCapaId} canInspect={canInspect} canApprove={canApprove} onClose={() => setSelCapaId(null)} />}
      {createCapaOpen && <CreateCapaDialog canApprove={canApprove} onClose={() => setCreateCapaOpen(false)} />}
      {runRelOpen && <RunReleaseDialog onClose={() => setRunRelOpen(false)} />}
      {selRelId && <ReleaseDialog relId={selRelId} canApprove={canApprove} sessionUser={sessionUser?.username ?? ""} onClose={() => setSelRelId(null)} />}
    </div>
  );
}

// ============================================================================
// TAB — Inspections
// ============================================================================
function InspectionsTab({ data, loading, canInspect, onOpen, onNew }: {
  data?: InspPayload; loading: boolean; canInspect: boolean;
  onOpen: (id: string) => void; onNew: () => void;
}) {
  const [kindFilter, setKindFilter] = useState("ALL");
  const rows = useMemo(() => {
    const all = data?.inspections ?? [];
    return kindFilter === "ALL" ? all : all.filter((i) => i.kind === kindFilter);
  }, [data, kindFilter]);
  const eqMap = useMemo(() => new Map((data?.equipment ?? []).map((e) => [e.code, e])), [data]);

  const columns: Column<Insp>[] = [
    { key: "inspNumber", header: "Inspection", render: (r) => <Mono className="text-primary">{r.inspNumber}</Mono> },
    { key: "kind", header: "Kind", render: (r) => <KindBadge kind={r.kind} /> },
    { key: "lotNumber", header: "Lot / Serial", render: (r) => <Mono>{r.lotNumber || "—"}</Mono> },
    { key: "woNumber", header: "Work Order", render: (r) => <Mono>{r.woNumber || "—"}</Mono> },
    {
      key: "equipmentCode", header: "Equipment",
      render: (r) => {
        if (!r.equipmentCode) return <span className="text-muted-foreground">—</span>;
        const st = calState(eqMap.get(r.equipmentCode)?.calibrationDue);
        return (
          <span className="inline-flex items-center gap-1.5" title={CAL_LABEL[st]}>
            <CalDot state={st} />
            <Mono className={st === "EXPIRED" ? "text-red-400" : undefined}>{r.equipmentCode}</Mono>
          </span>
        );
      },
    },
    { key: "attempt", header: "Attempt", render: (r) => <span className="tabular">{r.attempt}{r.retestReason ? <span className="inline-block ml-1 align-middle" title="retest"><RotateCcw className="h-3 w-3 text-amber-400" /></span> : null}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "overall", header: "Result", render: (r) => r.overallResult ? <StatusBadge status={r.overallResult === "PASS" ? "PASSED" : "FAILED"} /> : <span className="text-muted-foreground">—</span> },
    { key: "submittedAt", header: "Submitted", render: (r) => <DateCell value={r.submittedAt} /> },
  ];

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={ClipboardList}
        title="Inspection records"
        desc="IQC · in-process · calibration · EOL · final — submitted evidence is immutable (spec rule 9)"
        actions={
          <>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="h-8 w-[150px] bg-input/50 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All kinds</SelectItem>
                {KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 gap-1.5" onClick={onNew} disabled={!canInspect} title={canInspect ? "Open a new PENDING inspection" : "Requires quality.inspect"}>
              <Plus className="h-3.5 w-3.5" /> New inspection
            </Button>
          </>
        }
      />
      <PermHint show={!canInspect} />
      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        onRowClick={(r) => onOpen(r.id)}
        emptyMessage="No inspections — open one with 'New inspection'"
        rowKey={(r) => r.id}
      />
    </div>
  );
}

// ============================================================================
// Dialog — Inspection detail / submit / retest
// ============================================================================
function InspDialog({ inspId, onClose }: { inspId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const sessionUser = useErpStore((s) => s.sessionUser);
  const canInspect = hasPerm(sessionUser?.role, "quality.inspect");
  const { data } = useQuery<InspPayload>({ queryKey: ["inspections"], queryFn: () => api<InspPayload>("/api/inspections") });
  const insp = data?.inspections.find((i) => i.id === inspId);
  const template = insp ? data?.templates.find((t) => t.code === insp.templateCode) : undefined;
  const params = template ? jparse<TParam[]>(template.paramsJson, []) : [];
  const results = insp ? jparse<ResultRow[]>(insp.resultsJson, []) : [];
  const equipment = data?.equipment ?? [];
  const eqMap = useMemo(() => new Map(equipment.map((e) => [e.code, e])), [equipment]);
  const inspectorName = insp?.inspectorId ? (data?.users[insp.inspectorId] ?? insp.inspectorId) : "";

  const [draft, setDraft] = useState<Record<string, string>>({});
  // Derived preselection: null = follow the inspection's own equipment until the user overrides.
  const [equipOverride, setEquipOverride] = useState<string | null>(null);
  const equipVal = equipOverride ?? (insp?.equipmentCode || "none");
  const [retestReason, setRetestReason] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      api("/api/inspections", {
        body: {
          action: "submit", id: insp!.id, equipmentCode: equipVal === "none" ? "" : equipVal,
          results: params.map((p) => ({ parameter: p.name, value: draft[p.name] ?? "" })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inspections"] });
      toast(`${insp!.inspNumber} submitted — evidence is now immutable`);
    },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const retest = useMutation({
    mutationFn: () => api<{ inspection: Insp }>("/api/inspections", { body: { action: "retest", id: insp!.id, retestReason } }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["inspections"] });
      setRetestReason("");
      toast(`Authorized retest opened: ${d.inspection.inspNumber} (attempt ${d.inspection.attempt})`);
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const attempts = insp && insp.lotNumber
    ? (data?.inspections ?? []).filter((i) => i.lotNumber === insp.lotNumber && i.kind === insp.kind).sort((a, b) => a.attempt - b.attempt)
    : [];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mono className="text-primary">{insp?.inspNumber ?? "…"}</Mono>
            {insp && <KindBadge kind={insp.kind} />}
            {insp && <StatusBadge status={insp.status} />}
            {insp && insp.attempt > 1 && <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">attempt {insp.attempt} · retest</Badge>}
          </DialogTitle>
          <DialogDescription>
            {template ? `${template.name} (${template.code})` : "Test record"} — measurements are evaluated against template limits; submission locks the record.
          </DialogDescription>
        </DialogHeader>

        {insp && insp.status === "FAILED" && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2.5 flex items-start gap-2.5">
            <Lock className="h-4 w-4 mt-0.5 text-red-400 shrink-0" />
            <div className="text-[12px]">
              <p className="font-semibold text-red-300">Original failure is immutable (spec)</p>
              <p className="text-red-200/70">This record cannot be edited or converted to pass. Use “Request retest” below to open attempt {insp.attempt + 1} with a mandatory reason.</p>
            </div>
          </div>
        )}

        {insp && (
          <div className="space-y-4">
            <KeyValue
              items={[
                { k: "Lot / Serial", v: <Mono>{insp.lotNumber || "—"}</Mono> },
                { k: "Work Order", v: <Mono>{insp.woNumber || "—"}</Mono> },
                {
                  k: "Equipment", v: insp.equipmentCode ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CalDot state={calState(eqMap.get(insp.equipmentCode)?.calibrationDue)} />
                      <Mono>{insp.equipmentCode}</Mono>
                    </span>
                  ) : "—",
                },
                { k: "Attempt", v: <span className="tabular">{insp.attempt}</span> },
                { k: "Submitted", v: fmtDT(insp.submittedAt) },
                { k: "Recorded by", v: inspectorName || <span className="text-muted-foreground">—</span> },
                ...(insp.retestReason ? [{ k: "Retest reason", v: <span className="text-[12px]">{insp.retestReason}</span> }] : []),
                ...(insp.approvedBy ? [{ k: "Approved by", v: <Mono>{insp.approvedBy}</Mono> }] : []),
              ]}
            />

            {/* Attempt history (retest governance) */}
            {attempts.length > 1 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5"><History className="h-3 w-3" /> Attempt history — failures preserved</p>
                <div className="rounded-md border border-border/60 divide-y divide-border/40">
                  {attempts.map((a) => (
                    <div key={a.id} className={cn("flex items-center gap-2 px-2.5 py-1.5 text-[12px]", a.id === insp.id && "bg-accent/40")}>
                      <span className="tabular w-14">#{a.attempt}</span>
                      <Mono className="text-primary w-32">{a.inspNumber}</Mono>
                      <StatusBadge status={a.status} />
                      <span className="text-muted-foreground truncate">{fmtDT(a.submittedAt)}</span>
                      {a.retestReason && <span className="text-[10px] text-amber-400/80 truncate ml-auto max-w-[220px]" title={a.retestReason}>{a.retestReason}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Results vs limits (immutable evidence) */}
            {insp.immutable && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Recorded results vs limits — overall <StatusBadge status={insp.overallResult === "PASS" ? "PASSED" : "FAILED"} /></p>
                <div className="rounded-md border border-border/60 divide-y divide-border/40">
                  {results.map((r, idx) => (
                    <div key={`${r.parameter}-${idx}`} className="grid grid-cols-[1fr_90px_140px_70px] items-center gap-2 px-2.5 py-1.5 text-[12px]">
                      <span className="truncate">{r.parameter}</span>
                      <span className="tabular text-right font-medium">{String(r.value)}</span>
                      <span className="text-muted-foreground tabular text-[11px] text-center">
                        {r.lower !== null && r.lower !== undefined || r.upper !== null && r.upper !== undefined
                          ? `[${r.lower ?? "−∞"}, ${r.upper ?? "+∞"}] ${r.unit && r.unit !== "-" ? r.unit : ""}`
                          : "text check"}
                      </span>
                      <span className={cn("text-right font-medium", r.pass ? "text-emerald-400" : "text-red-400")}>{r.pass ? "PASS" : "FAIL"}</span>
                    </div>
                  ))}
                  {results.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muted-foreground">No measurements recorded.</p>}
                </div>
              </div>
            )}

            {/* Submit form (PENDING only — server re-verifies) */}
            {insp.status === "PENDING" && !insp.immutable && (
              <div className="rounded-md border border-border/60 p-3 space-y-3">
                <p className="text-[12px] font-medium flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5 text-primary" /> Record test results <span className="text-muted-foreground font-normal">— submitting sets the record immutable (spec rule 9)</span></p>
                {params.map((p) => (
                  <div key={p.name} className="grid grid-cols-[1fr_120px] items-center gap-2">
                    <div className="min-w-0">
                      <Label className="text-[12px]">{p.name} <span className="text-muted-foreground">({p.unit ?? "-"})</span></Label>
                      <p className="text-[10px] text-muted-foreground">{p.kind === "TEXT" ? "text result" : `limits [${p.lower ?? "−∞"}, ${p.upper ?? "+∞"}]`}</p>
                    </div>
                    <Input
                      className="h-8 bg-input/60"
                      value={draft[p.name] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [p.name]: e.target.value }))}
                      placeholder={p.kind === "TEXT" ? "e.g. OK" : "value"}
                    />
                  </div>
                ))}
                <div className="grid grid-cols-[1fr_120px] items-center gap-2">
                  <div>
                    <Label className="text-[12px]">Equipment / gauge</Label>
                    <p className="text-[10px] text-muted-foreground">expired calibration blocks the test server-side</p>
                  </div>
                  <Select value={equipVal} onValueChange={setEquipOverride}>
                    <SelectTrigger className="h-8 bg-input/60 text-[12px]"><SelectValue placeholder="optional" /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      <SelectItem value="none">— none —</SelectItem>
                      {equipment.map((e) => {
                        const st = calState(e.calibrationDue);
                        return (
                          <SelectItem key={e.id} value={e.code}>
                            <span className="inline-flex items-center gap-1.5 text-[12px]">
                              <CalDot state={st} /> {e.code} · {st === "NONE" ? e.kind : CAL_LABEL[st]}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <PermHint show={!canInspect} />
                  <Button size="sm" className="h-8 gap-1.5 ml-auto" disabled={!canInspect || submit.isPending} onClick={() => submit.mutate()}>
                    <Check className="h-3.5 w-3.5" /> {submit.isPending ? "Submitting…" : "Submit results"}
                  </Button>
                </div>
              </div>
            )}

            {/* Retest (submitted records only) */}
            {insp.immutable && (
              <div className="rounded-md border border-border/60 p-3 space-y-2">
                <p className="text-[12px] font-medium flex items-center gap-1.5"><RotateCcw className="h-3.5 w-3.5 text-amber-400" /> Authorized retest — opens a NEW inspection (attempt {insp.attempt + 1}); the original is preserved.</p>
                <Textarea
                  className="min-h-[60px] bg-input/60 text-[12px]"
                  placeholder="Retest reason (mandatory) — e.g. authorized after NCR-2025-0001 rework, connector reseated…"
                  value={retestReason}
                  onChange={(e) => setRetestReason(e.target.value)}
                />
                <div className="flex items-center justify-between gap-2">
                  <PermHint show={!canInspect} />
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 ml-auto" disabled={!canInspect || retest.isPending || !retestReason.trim()} onClick={() => retest.mutate()}>
                    <RotateCcw className="h-3.5 w-3.5" /> Request retest
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Dialog — New PENDING inspection
// ============================================================================
function NewInspectionDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const { data } = useQuery<InspPayload>({ queryKey: ["inspections"], queryFn: () => api<InspPayload>("/api/inspections") });
  const [templateCode, setTemplateCode] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [woNumber, setWoNumber] = useState("");
  const [equipVal, setEquipVal] = useState("none");

  const create = useMutation({
    mutationFn: () => api<{ inspection: Insp }>("/api/inspections", {
      body: {
        action: "create", templateCode,
        lotNumber: lotNumber.trim() || undefined, woNumber: woNumber.trim() || undefined,
        equipmentCode: equipVal === "none" ? "" : equipVal,
      },
    }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["inspections"] });
      toast(`${d.inspection.inspNumber} opened (${d.inspection.kind}, PENDING)`);
      onClose();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">New inspection</DialogTitle>
          <DialogDescription>Pick a test specification (template) and the object under test. The kind follows the template.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[12px]">Test specification</Label>
            <Select value={templateCode} onValueChange={setTemplateCode}>
              <SelectTrigger className="h-9 bg-input/60 text-[12px]"><SelectValue placeholder="Select template…" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {(data?.templates ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.code}>
                    <span className="text-[12px]">{t.code} · {t.kind}{t.familyCode ? ` · ${t.familyCode}` : ""}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Lot / serial</Label>
              <Input className="h-9 bg-input/60" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="SN-NOX-25-0006" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Work order</Label>
              <Input className="h-9 bg-input/60" value={woNumber} onChange={(e) => setWoNumber(e.target.value)} placeholder="WO-2025-0002" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Equipment / gauge (optional)</Label>
            <Select value={equipVal} onValueChange={setEquipVal}>
              <SelectTrigger className="h-9 bg-input/60 text-[12px]"><SelectValue placeholder="optional" /></SelectTrigger>
              <SelectContent className="max-h-56">
                <SelectItem value="none">— none —</SelectItem>
                {(data?.equipment ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.code}>
                    <span className="inline-flex items-center gap-1.5 text-[12px]"><CalDot state={calState(e.calibrationDue)} /> {e.code}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-8" disabled={!templateCode || (!lotNumber.trim() && !woNumber.trim()) || create.isPending} onClick={() => create.mutate()}>
            Open inspection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Dialog — Record test result (quick form, Calibration/EOL tab)
// ============================================================================
function RecordResultDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const sessionUser = useErpStore((s) => s.sessionUser);
  const canInspect = hasPerm(sessionUser?.role, "quality.inspect");
  const { data } = useQuery<InspPayload>({ queryKey: ["inspections"], queryFn: () => api<InspPayload>("/api/inspections") });
  const pending = (data?.inspections ?? []).filter((i) => i.status === "PENDING" && !i.immutable && (i.kind === "CALIBRATION" || i.kind === "EOL"));
  const [selId, setSelId] = useState("");
  const sel = pending.find((i) => i.id === selId);
  const template = sel ? data?.templates.find((t) => t.code === sel.templateCode) : undefined;
  const params = template ? jparse<TParam[]>(template.paramsJson, []) : [];
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [equipVal, setEquipVal] = useState("none");

  const submit = useMutation({
    mutationFn: () => api("/api/inspections", {
      body: {
        action: "submit", id: sel!.id, equipmentCode: equipVal === "none" ? (sel!.equipmentCode || "") : equipVal,
        results: params.map((p) => ({ parameter: p.name, value: draft[p.name] ?? "" })),
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inspections"] });
      toast(`${sel!.inspNumber} submitted — evidence immutable`);
      onClose();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="text-base">Record test result</DialogTitle>
          <DialogDescription>Pending CALIBRATION / EOL inspections — same immutable submit API as the inspection register.</DialogDescription>
        </DialogHeader>
        {pending.length === 0 ? (
          <div className="py-2 text-[13px] text-muted-foreground">
            No pending CALIBRATION / EOL inspections. Open one from the <span className="text-primary">Inspections</span> tab (“New inspection”), then record results here.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Pending inspection</Label>
              <Select value={selId} onValueChange={(v) => { setSelId(v); setDraft({}); setEquipVal("none"); }}>
                <SelectTrigger className="h-9 bg-input/60 text-[12px]"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent className="max-h-56">
                  {pending.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      <span className="text-[12px]"><Mono>{i.inspNumber}</Mono> · {i.kind} · {i.lotNumber || i.woNumber || "—"}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sel && params.map((p) => (
              <div key={p.name} className="grid grid-cols-[1fr_120px] items-center gap-2">
                <div>
                  <Label className="text-[12px]">{p.name} <span className="text-muted-foreground">({p.unit ?? "-"})</span></Label>
                  <p className="text-[10px] text-muted-foreground">{p.kind === "TEXT" ? "text result" : `limits [${p.lower ?? "−∞"}, ${p.upper ?? "+∞"}]`}</p>
                </div>
                <Input className="h-8 bg-input/60" value={draft[p.name] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [p.name]: e.target.value }))} />
              </div>
            ))}
            {sel && (
              <div className="grid grid-cols-[1fr_120px] items-center gap-2">
                <div>
                  <Label className="text-[12px]">Equipment</Label>
                  <p className="text-[10px] text-muted-foreground">expired calibration blocks submission</p>
                </div>
                <Select value={equipVal} onValueChange={setEquipVal}>
                  <SelectTrigger className="h-8 bg-input/60 text-[12px]"><SelectValue placeholder={sel.equipmentCode || "none"} /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    <SelectItem value="none">{sel.equipmentCode || "— none —"}</SelectItem>
                    {(data?.equipment ?? []).map((e) => (
                      <SelectItem key={e.id} value={e.code}>
                        <span className="inline-flex items-center gap-1.5 text-[12px]"><CalDot state={calState(e.calibrationDue)} /> {e.code}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <PermHint show={!canInspect} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Close</Button>
          <Button size="sm" className="h-8" disabled={!sel || !canInspect || submit.isPending} onClick={() => submit.mutate()}>
            Submit results
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB — NCR / MRB / CAPA
// ============================================================================
function NcrTab({ ncrData, capaQ, loadingNcr, loadingCapa, pendingMrb, canNcr, canInspect, canApprove, onOpenNcr, onRaise, onOpenCapa, onNewCapa }: {
  ncrData?: NcrPayload; capaQ: { data?: CapaPayload; isLoading: boolean }; loadingNcr: boolean; loadingCapa: boolean;
  pendingMrb: NcrT[]; canNcr: boolean; canInspect: boolean; canApprove: boolean;
  onOpenNcr: (id: string) => void; onRaise: () => void; onOpenCapa: (id: string) => void; onNewCapa: () => void;
}) {
  const now = Date.now();
  const capas = capaQ.data?.capas ?? [];
  const openCapas = capas.filter((c) => c.status !== "CLOSED").length;

  return (
    <div className="space-y-6">
      {/* FOUR-EYES / MRB STAGE BANNER */}
      {pendingMrb.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-3.5 flex items-start gap-3">
            <AlertTriangle className="h-4.5 w-4.5 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1 min-w-0">
              <p className="text-[13px] font-medium text-amber-200">MRB stage — four-eyes open</p>
              {pendingMrb.map((n) => {
                const d = n.mrb.find((x) => !x.approvedBy);
                return (
                  <p key={n.id} className="text-[12px] text-amber-100/80">
                    {d
                      ? <><Mono className="text-amber-300">{n.ncrNumber}</Mono> — MRB decision ({d.disposition}) recorded by <Mono>{d.decidedBy}</Mono>; awaits approval by a <b>different</b> user with <Mono>quality.approve</Mono>.</>
                      : <><Mono className="text-amber-300">{n.ncrNumber}</Mono> (lot <Mono>{n.lotNumber || "—"}</Mono>) sits at MRB stage awaiting decision — record the disposition, then approve under four-eyes (spec rule 12).</>}
                    <button className="ml-2 text-primary hover:underline" onClick={() => onOpenNcr(n.id)}>Open NCR →</button>
                  </p>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* NCR section */}
      <div className="space-y-3">
        <SectionHeader
          icon={ShieldAlert}
          title="Non-conformance reports"
          desc="Raise → containment (auto scope) → MRB decision → four-eyes approval → stock action"
          actions={<Button size="sm" className="h-8 gap-1.5" onClick={onRaise} disabled={!canNcr} title={canNcr ? "Raise NCR" : "Requires quality.ncr"}><Plus className="h-3.5 w-3.5" /> Raise NCR</Button>}
        />
        <DataTable
          columns={[
            { key: "ncrNumber", header: "NCR", render: (r: NcrT) => <Mono className="text-primary">{r.ncrNumber}</Mono> },
            { key: "severity", header: "Severity", render: (r: NcrT) => <StatusBadge status={r.severity} /> },
            { key: "lotNumber", header: "Lot", render: (r: NcrT) => <Mono>{r.lotNumber || "—"}</Mono> },
            { key: "status", header: "Status", render: (r: NcrT) => <StatusBadge status={r.status} /> },
            { key: "raisedBy", header: "Raised by", render: (r: NcrT) => <Mono>{r.raisedBy}</Mono> },
            { key: "createdAt", header: "Created", render: (r: NcrT) => <DateCell value={r.createdAt} /> },
            { key: "capas", header: "CAPAs", render: (r: NcrT) => r.capas.length ? <span className="tabular">{r.capas.length}</span> : <span className="text-muted-foreground">—</span> },
            {
              key: "report8d", header: "8D",
              render: (r: NcrT) => (
                <Button
                  size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]"
                  onClick={(e) => { e.stopPropagation(); print8D(r.ncrNumber); }}
                  title="Compose the controlled 8D problem-solving report from NCR/CAPA/MRB evidence"
                >
                  <FileText className="h-3 w-3" /> 8D
                </Button>
              ),
            },
          ] satisfies Column<NcrT>[]}
          rows={ncrData?.ncrs ?? []}
          loading={loadingNcr}
          onRowClick={(r) => onOpenNcr(r.id)}
          emptyMessage="No NCRs — quality is holding"
          rowKey={(r) => r.id}
        />
      </div>

      {/* CAPA section */}
      <div className="space-y-3">
        <SectionHeader
          icon={ClipboardList}
          title="CAPA — corrective & preventive actions"
          desc={`${openCapas} open · closure requires effectiveness verification (spec gate)`}
          actions={<Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onNewCapa} disabled={!canApprove} title={canApprove ? "New CAPA" : "Requires quality.approve"}><Plus className="h-3.5 w-3.5" /> New CAPA</Button>}
        />
        <CapaDueHeatmap capas={capas} now={now} onOpenCapa={onOpenCapa} />
        <DataTable
          columns={[
            { key: "capaNumber", header: "CAPA", render: (r: CapaT) => <Mono className="text-primary">{r.capaNumber}</Mono> },
            { key: "kind", header: "Kind", render: (r: CapaT) => <Badge variant="outline" className="text-[10px] border-teal-500/40 bg-teal-500/10 text-teal-300">{r.kind}</Badge> },
            { key: "problem", header: "Problem", render: (r: CapaT) => <span className="text-[12px] truncate block max-w-[380px]">{r.problem}</span> },
            { key: "owner", header: "Owner", render: (r: CapaT) => <Mono>{r.owner || "—"}</Mono> },
            {
              key: "dueDate", header: "Due",
              render: (r: CapaT) => {
                const overdue = r.dueDate && new Date(r.dueDate).getTime() < now && r.status !== "CLOSED";
                return <span className={cn("tabular text-[12px]", overdue && "text-red-400 font-medium")}>{r.dueDate ? new Date(r.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}{overdue ? " · overdue" : ""}</span>;
              },
            },
            { key: "ncrNumber", header: "NCR", render: (r: CapaT) => r.ncrNumber ? <Mono>{r.ncrNumber}</Mono> : <span className="text-muted-foreground">—</span> },
            { key: "status", header: "Status", render: (r: CapaT) => <StatusBadge status={r.status} /> },
          ] satisfies Column<CapaT>[]}
          rows={capas}
          loading={loadingCapa}
          onRowClick={(r) => onOpenCapa(r.id)}
          emptyMessage="No CAPAs"
          rowKey={(r) => r.id}
        />
      </div>
      <PermHint show={!canNcr && !canInspect && !canApprove} />
    </div>
  );
}

// ============================================================================
// CAPA due-date heatmap — 12-week window (W-2 → W+9): weekly due-load heat
// strip + per-CAPA timeline bars (overdue red / open amber / verified
// emerald). Client-side over the CAPA payload · click a row → CAPA dialog.
// ============================================================================
function CapaDueHeatmap({ capas, now, onOpenCapa }: { capas: CapaT[]; now: number; onOpenCapa: (id: string) => void }) {
  const WEEK = 7 * 86_400_000;
  const BACK = 2;
  const FWD = 9;
  const COLS = BACK + FWD + 1;
  const colPct = 100 / COLS;

  const mondayOf = (ts: number) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  };
  const w0 = mondayOf(now);
  const weeks = useMemo(() => Array.from({ length: COLS }, (_, i) => w0 + (i - BACK) * WEEK), [w0]);
  const weekIdx = (ts: number) => Math.round((mondayOf(ts) - w0) / WEEK);
  const wkLabel = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  const open = useMemo(
    () => capas.filter((c) => c.status !== "CLOSED")
      .sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)),
    [capas],
  );
  const closed = capas.length - open.length;
  const shown = open.slice(0, 8);
  const load = weeks.map((w) => open.filter((c) => c.dueDate && weekIdx(new Date(c.dueDate).getTime()) === weekIdx(w)).length);
  const maxLoad = Math.max(1, ...load);
  const overdue = open.filter((c) => c.dueDate && new Date(c.dueDate).getTime() < now).length;

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-start justify-between space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-sm">CAPA due-date heatmap</CardTitle>
          <p className="text-[11px] text-muted-foreground font-normal mt-0.5">
            12-week window · weekly due-load · {overdue > 0 ? <span className="text-red-400 font-medium">{overdue} overdue</span> : <span className="text-emerald-300">no overdue CAPAs</span>}
            {closed > 0 ? ` · ${closed} closed (off the board)` : ""} · click a row to open
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-400" /> overdue</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-400" /> open</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-400" /> verified</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[720px] space-y-1.5">
            {/* week header */}
            <div className="flex items-end">
              <div className="w-40 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">Due load / week</div>
              <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0,1fr))` }}>
                {weeks.map((w, i) => (
                  <div key={i} className={cn("text-center text-[9px] leading-4", i === BACK ? "text-primary font-semibold" : i < BACK ? "text-red-400/70" : "text-muted-foreground")}>
                    {i === BACK ? "now" : wkLabel(w)}
                  </div>
                ))}
              </div>
            </div>
            {/* due-load heat strip */}
            <div className="flex items-center">
              <div className="w-40 shrink-0 text-[11px] text-muted-foreground">open CAPAs due</div>
              <div className="flex-1 grid gap-px" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0,1fr))` }}>
                {load.map((n, i) => (
                  <div key={i}
                    title={n ? `${n} CAPA(s) due w/c ${wkLabel(weeks[i])}` : "No CAPA due this week"}
                    className={cn(
                      "h-7 rounded-sm flex items-center justify-center text-[10px] tabular border",
                      n === 0 && "bg-muted/40 border-border/40 text-muted-foreground/50",
                      n > 0 && i < BACK && "bg-red-500/25 border-red-500/40 text-red-200 font-medium",
                      n > 0 && i >= BACK && "border-amber-500/40 text-amber-100",
                    )}
                    style={n > 0 && i >= BACK ? { backgroundColor: `oklch(0.78 0.15 75 / ${0.18 + 0.5 * (n / maxLoad)})` } : undefined}
                  >
                    {n || ""}
                  </div>
                ))}
              </div>
            </div>
            {/* per-CAPA timeline bars */}
            {shown.map((c) => {
              const due = c.dueDate ? new Date(c.dueDate).getTime() : null;
              // weekIdx returns the raw week offset (−BACK…+FWD) — convert to a 0…COLS-1 column index by adding BACK
              const start = Math.max(0, Math.min(COLS - 1, weekIdx(new Date(c.createdAt).getTime()) + BACK));
              const end = due !== null ? Math.max(start, Math.min(COLS - 1, weekIdx(due) + BACK)) : COLS - 1;
              const verified = c.effectiveness === "VERIFIED";
              const isOverdue = due !== null && due < now;
              return (
                <button key={c.id} onClick={() => onOpenCapa(c.id)} title={`Open ${c.capaNumber}`}
                  className="flex items-center w-full text-left rounded-md hover:bg-background/60 focus-visible:outline focus-visible:outline-primary/50 transition-colors py-0.5">
                  <div className="w-40 shrink-0 min-w-0 pr-2">
                    <Mono className="text-[11px] text-primary">{c.capaNumber}</Mono>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {c.owner || "—"}{due !== null ? ` · due ${wkLabel(due)}` : " · no due date"}
                    </p>
                  </div>
                  <div className="flex-1 relative h-6">
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0,1fr))` }}>
                      {weeks.map((_, i) => <div key={i} className={cn("border-l border-border/30", i === BACK && "border-l-primary/60")} />)}
                    </div>
                    <div className="absolute top-1/2 -translate-y-1/2 h-3.5 rounded-full"
                      style={{
                        left: `${start * colPct}%`,
                        width: `${Math.max(colPct, (end - start + 1) * colPct - 1.5)}%`,
                        background: isOverdue ? "oklch(0.7 0.19 25 / 0.85)" : verified ? "oklch(0.72 0.17 162 / 0.85)" : "oklch(0.78 0.15 75 / 0.65)",
                      }} />
                    {due !== null && (
                      <span className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rotate-45 rounded-[2px] border border-background shadow"
                        style={{ left: `calc(${end * colPct + colPct / 2}% - 5px)`, background: isOverdue ? "#f87171" : verified ? "#34d399" : "#fbbf24" }} />
                    )}
                  </div>
                </button>
              );
            })}
            {open.length > shown.length && (
              <p className="text-[10px] text-muted-foreground pl-40 pt-0.5">+{open.length - shown.length} more open CAPA(s) beyond the nearest 8 — see register below</p>
            )}
            {open.length === 0 && <p className="text-[12px] text-muted-foreground py-3 text-center">No open CAPAs — board is clear.</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Dialog — Raise NCR
// ============================================================================
function RaiseNcrDialog({ canNcr, onClose }: { canNcr: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const inspQ = useQuery<InspPayload>({ queryKey: ["inspections"], queryFn: () => api<InspPayload>("/api/inspections") });
  const ncrQ = useQuery<NcrPayload>({ queryKey: ["ncr"], queryFn: () => api<NcrPayload>("/api/ncr") });
  const [source, setSource] = useState("manual");
  const [severity, setSeverity] = useState("MAJOR");
  const [description, setDescription] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [woNumber, setWoNumber] = useState("");
  const sel = source !== "manual" ? (inspQ.data?.inspections ?? []).find((i) => i.id === source) : undefined;

  const raise = useMutation({
    mutationFn: () => api<{ ncr: NcrT }>("/api/ncr", {
      body: {
        action: "raise",
        sourceInspectionId: source === "manual" ? undefined : source,
        severity, description,
        ...(source === "manual" ? { lotNumber: lotNumber.trim() || undefined, woNumber: woNumber.trim() || undefined } : {}),
      },
    }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["ncr"] });
      toast(`${d.ncr.ncrNumber} raised (${d.ncr.severity}) — containment next`);
      onClose();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Raise NCR</DialogTitle>
          <DialogDescription>From a source inspection (lot/WO copied) or an authorized manual observation. Server numbers it NCR-YYYY-NNNN and notifies QUALITY_MGR.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[12px]">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="h-9 bg-input/60 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-56">
                <SelectItem value="manual">Manual observation (authorized)</SelectItem>
                {(inspQ.data?.inspections ?? []).slice(0, 40).map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    <span className="text-[12px]"><Mono>{i.inspNumber}</Mono> · {i.kind} · {i.lotNumber || "—"} · {i.status}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sel && <p className="text-[11px] text-muted-foreground">Lot/WO will be copied from {sel.inspNumber} ({sel.lotNumber || "no lot"}/{sel.woNumber || "no WO"}).</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="h-9 bg-input/60 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["MINOR", "MAJOR", "CRITICAL"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {source === "manual" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[12px]">Lot / serial</Label>
                <Input className="h-9 bg-input/60" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="B-ACS1120" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">Work order</Label>
                <Input className="h-9 bg-input/60" value={woNumber} onChange={(e) => setWoNumber(e.target.value)} placeholder="WO-2025-0002" />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-[12px]">Description</Label>
            <Textarea className="min-h-[70px] bg-input/60 text-[12px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is non-conforming, where found, immediate observation…" />
          </div>
          {(ncrQ.data?.ncrs.length ?? 0) > 0 && <p className="text-[11px] text-muted-foreground">{ncrQ.data?.ncrs.length} NCRs on file · next number NCR-2025-{String((ncrQ.data?.ncrs.length ?? 0) + 1).padStart(4, "0")}</p>}
          <PermHint show={!canNcr} />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-8" disabled={!canNcr || !description.trim() || raise.isPending} onClick={() => raise.mutate()}>Raise NCR</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Dialog — NCR detail: containment, MRB decide/approve, links
// ============================================================================
function NcrDialog({ ncrId, canNcr, canInspect, canApprove, sessionUser, onClose }: {
  ncrId: string; canNcr: boolean; canInspect: boolean; canApprove: boolean; sessionUser: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const { data } = useQuery<NcrPayload>({ queryKey: ["ncr"], queryFn: () => api<NcrPayload>("/api/ncr") });
  const ncr = data?.ncrs.find((n) => n.id === ncrId);
  const reworkOrders = (data?.reworkOrders ?? []).filter((r) => r.ncrId === ncrId);
  // containmentJson has two shapes: seeded string[] and API-computed {type,ref,note}[] — normalize.
  const scope = ncr
    ? (jparse<unknown[]>(ncr.containmentJson, [])).map((e) => {
        if (typeof e === "string") return { type: "NOTE", ref: "", note: e };
        const o = (e ?? {}) as { type?: string; ref?: string; note?: string };
        return { type: o.type ?? "NOTE", ref: o.ref ?? "", note: o.note ?? "" };
      })
    : [];
  const lotInfo = ncr?.lotNumber ? data?.lots[ncr.lotNumber] : undefined;

  const [disposition, setDisposition] = useState("");
  const [justification, setJustification] = useState("");
  const [instructions, setInstructions] = useState("");
  const needsInstructions = disposition === "REWORK" || disposition === "REPAIR";

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ncr"] });

  const contain = useMutation({
    mutationFn: () => api("/api/ncr", { body: { action: "containment", id: ncr!.id } }),
    onSuccess: () => { invalidate(); toast("Containment recorded — affected scope computed"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const decide = useMutation({
    mutationFn: () => api("/api/ncr", { body: { action: "mrb", id: ncr!.id, disposition, justification, instructions } }),
    onSuccess: () => {
      invalidate(); setDisposition(""); setJustification(""); setInstructions("");
      toast("MRB decision recorded — now awaiting four-eyes approval");
    },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const approve = useMutation({
    mutationFn: () => api<{ stockAction: string }>("/api/ncr", { body: { action: "approve-mrb", id: ncr!.id } }),
    onSuccess: (d) => { invalidate(); toast(`Four-eyes approval OK — ${d.stockAction}`); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const closeNcr = useMutation({
    mutationFn: () => api("/api/ncr", { body: { action: "close", id: ncr!.id } }),
    onSuccess: () => { invalidate(); toast("NCR closed"); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const pendingDecision = ncr?.mrb.find((d) => !d.approvedBy);
  const canDecide = !!ncr && (ncr.status === "CONTAINMENT" || ncr.status === "MRB") && !pendingDecision;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mono className="text-primary">{ncr?.ncrNumber ?? "…"}</Mono>
            {ncr && <StatusBadge status={ncr.severity} />}
            {ncr && <StatusBadge status={ncr.status} />}
            {ncr && (
              <Button
                size="sm" variant="outline" className="ml-auto h-7 gap-1.5 text-[11px]"
                onClick={() => print8D(ncr.ncrNumber)}
                title="Compose the controlled 8D problem-solving report"
              >
                <FileText className="h-3 w-3" /> 8D report
              </Button>
            )}
          </DialogTitle>
          <DialogDescription>{ncr?.sourceRef}</DialogDescription>
        </DialogHeader>

        {ncr && (
          <div className="space-y-4">
            <KeyValue
              items={[
                { k: "Lot", v: <span className="inline-flex items-center gap-2"><Mono>{ncr.lotNumber || "—"}</Mono>{lotInfo && <StatusBadge status={lotInfo.status} />}{lotInfo && <Mono className="text-muted-foreground">{lotInfo.warehouseCode}</Mono>}</span> },
                { k: "Work order", v: <Mono>{ncr.woNumber || "—"}</Mono> },
                { k: "Raised by", v: <Mono>{ncr.raisedBy}</Mono> },
                { k: "Created", v: fmtDT(ncr.createdAt) },
                ...(ncr.closedAt ? [{ k: "Closed", v: fmtDT(ncr.closedAt) }] : []),
              ]}
            />
            <div className="rounded-md border border-border/60 bg-background/40 p-3 text-[12px]">{ncr.description}</div>

            {/* Containment */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Containment — affected scope</p>
                {ncr.status === "OPEN" && (
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" disabled={!canNcr || contain.isPending} onClick={() => contain.mutate()}>
                    <ShieldAlert className="h-3 w-3" /> Record containment (auto-scope)
                  </Button>
                )}
              </div>
              {scope.length === 0 ? (
                <p className="text-[12px] text-muted-foreground border border-dashed border-border/60 rounded-md p-2.5">
                  Not recorded — “Record containment” computes the lot&apos;s containers, delivery notes and genealogy-affected serials automatically.
                </p>
              ) : (
                <div className="rounded-md border border-border/60 divide-y divide-border/40">
                  {scope.map((s, i) => (
                    <div key={`${s.ref || s.note}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-zinc-500/40 text-zinc-300 w-[110px] justify-center shrink-0">{s.type.replace(/_/g, " ")}</Badge>
                      {s.ref && <Mono className="text-primary shrink-0">{s.ref}</Mono>}
                      <span className="text-muted-foreground truncate">{s.note}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* MRB */}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">MRB — Material Review Board</p>
              {ncr.mrb.length > 0 && (
                <div className="space-y-2 mb-3">
                  {ncr.mrb.map((d) => (
                    <div key={d.id} className="rounded-md border border-border/60 p-2.5 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={d.disposition} />
                        {d.approvedBy
                          ? <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">approved by {d.approvedBy}</Badge>
                          : <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">awaiting four-eyes approval</Badge>}
                        <span className="text-[11px] text-muted-foreground">decided by <Mono>{d.decidedBy}</Mono> · {fmtDT(d.createdAt)}</span>
                      </div>
                      <p className="text-[12px]">{d.justification}</p>
                      {d.stockAction && <p className="text-[11px] text-teal-300">Stock action: {d.stockAction}</p>}
                    </div>
                  ))}
                </div>
              )}

              {pendingDecision && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                  <p className="text-[12px] text-amber-200 flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Four-eyes control — approval must come from a user different from <Mono>{pendingDecision.decidedBy}</Mono> (spec rule 12).</p>
                  <div className="flex items-center justify-between gap-2">
                    <PermHint show={!canApprove} />
                    <Button size="sm" className="h-8 gap-1.5 ml-auto" disabled={!canApprove || approve.isPending || sessionUser === pendingDecision.decidedBy}
                      title={sessionUser === pendingDecision.decidedBy ? "Four-eyes: you recorded this decision — switch user to approve" : "Approve disposition and apply stock action"}
                      onClick={() => approve.mutate()}>
                      <Check className="h-3.5 w-3.5" /> Approve disposition
                    </Button>
                  </div>
                  {sessionUser === pendingDecision.decidedBy && (
                    <p className="text-[11px] text-amber-400/90">You are the decider — switch to e.g. <Mono>lkrish</Mono> (Quality Manager) in the topbar to approve.</p>
                  )}
                </div>
              )}

              {canDecide && (
                <div className="rounded-md border border-border/60 p-3 space-y-2.5">
                  <p className="text-[12px] font-medium">Record MRB decision <span className="text-muted-foreground font-normal">— you become the decider; a different user must approve</span></p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[12px]">Disposition</Label>
                      <Select value={disposition} onValueChange={setDisposition}>
                        <SelectTrigger className="h-8 bg-input/60 text-[12px]"><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          {["USE_AS_IS", "REWORK", "REPAIR", "RETURN_TO_VENDOR", "SCRAP"].map((d) => <SelectItem key={d} value={d}>{d.replace(/_/g, " ")}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12px]">Justification</Label>
                      <Input className="h-8 bg-input/60" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Why this disposition is safe / required" />
                    </div>
                  </div>
                  {needsInstructions && (
                    <div className="space-y-1.5">
                      <Label className="text-[12px]">{disposition === "REPAIR" ? "Repair" : "Rework"} instructions <span className="text-red-400">*</span></Label>
                      <Textarea className="min-h-[56px] bg-input/60 text-[12px]" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Numbered work instructions — carried onto the Rework Order" />
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">On approval: SCRAP → WH-SCRAP · RETURN_TO_VENDOR → WH-REJ · REWORK/REPAIR → ReworkOrder + WH-REWORK · USE_AS_IS → WH-ACC.</p>
                  <div className="flex items-center justify-end">
                    <Button size="sm" className="h-8" disabled={!canInspect || decide.isPending || !disposition || !justification.trim() || (needsInstructions && !instructions.trim())} onClick={() => decide.mutate()}>
                      Record decision
                    </Button>
                  </div>
                  <PermHint show={!canInspect} />
                </div>
              )}
            </div>

            {/* Links */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-md border border-border/60 p-2.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Linked CAPAs</p>
                {ncr.capas.length === 0 ? <p className="text-[12px] text-muted-foreground">None</p> : ncr.capas.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-[12px] py-0.5"><Mono className="text-primary">{c.capaNumber}</Mono><StatusBadge status={c.status} /></div>
                ))}
              </div>
              <div className="rounded-md border border-border/60 p-2.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Rework orders</p>
                {reworkOrders.length === 0 ? <p className="text-[12px] text-muted-foreground">None</p> : reworkOrders.map((r) => (
                  <div key={r.id} className="py-1 space-y-0.5">
                    <div className="flex items-center gap-2 text-[12px]"><Mono className="text-primary">{r.rwNumber}</Mono><StatusBadge status={r.status} /><span className="text-muted-foreground">auth. {r.authorizedBy}</span></div>
                    <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{r.instructions}</p>
                    {r.outcome && <p className="text-[11px] text-emerald-300/80">Outcome: {r.outcome}</p>}
                  </div>
                ))}
              </div>
            </div>

            {ncr.status === "DISPOSITIONED" && (
              <div className="flex items-center justify-end">
                <Button size="sm" variant="outline" className="h-8" disabled={!canApprove || closeNcr.isPending} onClick={() => closeNcr.mutate()}>Close NCR (evidence verified)</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Dialog — CAPA detail (checklist, verify, close)
// ============================================================================
function CapaDialog({ capaId, canInspect, canApprove, onClose }: { capaId: string; canInspect: boolean; canApprove: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const { data } = useQuery<CapaPayload>({ queryKey: ["capa"], queryFn: () => api<CapaPayload>("/api/capa") });
  const capa = data?.capas.find((c) => c.id === capaId);
  const actions = capa ? jparse<CapaActionT[]>(capa.actionsJson, []) : [];
  const [effectiveness, setEffectiveness] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["capa"] });
  const toggle = useMutation({
    mutationFn: (index: number) => api("/api/capa", { body: { action: "toggle", id: capa!.id, index } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast(e.message, "err"),
  });
  const verify = useMutation({
    mutationFn: () => api("/api/capa", { body: { action: "verify", id: capa!.id } }),
    onSuccess: () => { invalidate(); toast(`${capa!.capaNumber} in effectiveness verification`); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const close = useMutation({
    mutationFn: () => api("/api/capa", { body: { action: "close", id: capa!.id, effectiveness } }),
    onSuccess: () => { invalidate(); toast(`${capa!.capaNumber} closed`); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const overdue = capa?.dueDate && new Date(capa.dueDate).getTime() < Date.now() && capa.status !== "CLOSED";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mono className="text-primary">{capa?.capaNumber ?? "…"}</Mono>
            {capa && <Badge variant="outline" className="text-[10px] border-teal-500/40 bg-teal-500/10 text-teal-300">{capa.kind}</Badge>}
            {capa && <StatusBadge status={capa.status} />}
            {overdue && <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-300">overdue</Badge>}
          </DialogTitle>
          <DialogDescription>{capa?.ncrNumber ? `Linked to ${capa.ncrNumber}` : "Standalone CAPA"}</DialogDescription>
        </DialogHeader>
        {capa && (
          <div className="space-y-4">
            <KeyValue
              items={[
                { k: "Owner", v: <Mono>{capa.owner || "—"}</Mono> },
                { k: "Due", v: <span className={cn("tabular text-[12px]", overdue && "text-red-400 font-medium")}>{capa.dueDate ? new Date(capa.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}</span> },
                { k: "Created", v: fmtDT(capa.createdAt) },
                { k: "Closed", v: capa.closedAt ? fmtDT(capa.closedAt) : "—" },
              ]}
            />
            <div className="rounded-md border border-border/60 bg-background/40 p-3 text-[12px] space-y-1.5">
              <p><span className="text-muted-foreground">Problem: </span>{capa.problem}</p>
              {capa.rootCause && <p><span className="text-muted-foreground">Root cause: </span>{capa.rootCause}</p>}
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Action checklist — {actions.filter((a) => a.done).length}/{actions.length} done</p>
              <div className="rounded-md border border-border/60 divide-y divide-border/40">
                {actions.map((a, idx) => (
                  <label key={idx} className="flex items-start gap-2.5 px-2.5 py-2 text-[12px] cursor-pointer hover:bg-accent/40">
                    <Checkbox className="mt-0.5" checked={!!a.done} disabled={!canInspect || capa.status === "CLOSED" || toggle.isPending} onCheckedChange={() => toggle.mutate(idx)} />
                    <span className={cn("min-w-0 flex-1", a.done && "line-through text-muted-foreground")}>
                      {a.action}
                      <span className="text-[10px] text-muted-foreground ml-2">{a.owner}{a.dueDate ? ` · due ${a.dueDate}` : ""}</span>
                    </span>
                  </label>
                ))}
                {actions.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muted-foreground">No actions recorded.</p>}
              </div>
            </div>

            {(capa.effectiveness || capa.status === "VERIFICATION") && (
              <div className="rounded-md border border-border/60 p-3 space-y-2">
                <p className="text-[12px] font-medium flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5 text-primary" /> Effectiveness review {capa.status === "VERIFICATION" && <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">verification in progress</Badge>}</p>
                {capa.effectiveness ? (
                  <p className="text-[12px] text-emerald-300/90">{capa.effectiveness}</p>
                ) : (
                  <>
                    <Textarea className="min-h-[60px] bg-input/60 text-[12px]" value={effectiveness} onChange={(e) => setEffectiveness(e.target.value)} placeholder="Verified result — metrics observed after implementation (mandatory to close)" />
                    <p className="text-[11px] text-muted-foreground">Closing without this text is blocked server-side: <Mono>“CAPA cannot close without effectiveness review (spec)”</Mono>.</p>
                  </>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              {capa.status !== "CLOSED" && capa.status !== "VERIFICATION" && (
                <Button size="sm" variant="outline" className="h-8" disabled={!canApprove || verify.isPending} onClick={() => verify.mutate()}>
                  Verify effectiveness
                </Button>
              )}
              {capa.status === "VERIFICATION" && !capa.effectiveness && (
                <Button size="sm" className="h-8" disabled={!canApprove || close.isPending || !effectiveness.trim()} onClick={() => close.mutate()}>
                  Close CAPA
                </Button>
              )}
              <PermHint show={!canApprove && capa.status !== "CLOSED"} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Dialog — Create CAPA
// ============================================================================
function CreateCapaDialog({ canApprove, onClose }: { canApprove: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const ncrQ = useQuery<NcrPayload>({ queryKey: ["ncr"], queryFn: () => api<NcrPayload>("/api/ncr") });
  const openNcrs = (ncrQ.data?.ncrs ?? []).filter((n) => n.status !== "CLOSED");
  const [kind, setKind] = useState("CORRECTIVE");
  const [problem, setProblem] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [owner, setOwner] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ncrId, setNcrId] = useState("none");
  const [actionsText, setActionsText] = useState("");

  const create = useMutation({
    mutationFn: () => api<{ capa: CapaT }>("/api/capa", {
      body: {
        action: "create", kind, problem, rootCause, owner,
        dueDate: dueDate || undefined,
        ncrId: ncrId === "none" ? undefined : ncrId,
        actions: actionsText.split("\n").filter((l) => l.trim()).map((l) => {
          const [action, aOwner, aDue] = l.split("|").map((p) => p.trim());
          return { action, owner: aOwner ?? "", dueDate: aDue ?? "" };
        }),
      },
    }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["capa"] });
      toast(`${d.capa.capaNumber} opened (${d.capa.kind})`);
      onClose();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="text-base">New CAPA</DialogTitle>
          <DialogDescription>Corrective/preventive action — optionally linked to an NCR. Numbered CAPA-YYYY-NNNN by the server.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-9 bg-input/60 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>{["CORRECTIVE", "PREVENTIVE"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Linked NCR (optional)</Label>
              <Select value={ncrId} onValueChange={setNcrId}>
                <SelectTrigger className="h-9 bg-input/60 text-[12px]"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— standalone —</SelectItem>
                  {openNcrs.map((n) => <SelectItem key={n.id} value={n.id}><span className="text-[12px]"><Mono>{n.ncrNumber}</Mono> · {n.status}</span></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Problem statement <span className="text-red-400">*</span></Label>
            <Textarea className="min-h-[56px] bg-input/60 text-[12px]" value={problem} onChange={(e) => setProblem(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Root cause (initial)</Label>
            <Input className="h-9 bg-input/60" value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Owner</Label>
              <Input className="h-9 bg-input/60" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="lkrish" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Due date</Label>
              <Input type="date" className="h-9 bg-input/60" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Actions (one per line — <Mono>action | owner | due</Mono>)</Label>
            <Textarea className="min-h-[64px] bg-input/60 text-[12px]" value={actionsText} onChange={(e) => setActionsText(e.target.value)} placeholder={"Supplier SCAR issued | tbose | 2025-12-20\nCrimp height cross-check | rpawar | 2025-12-14"} />
          </div>
          <PermHint show={!canApprove} />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-8" disabled={!canApprove || !problem.trim() || create.isPending} onClick={() => create.mutate()}>Open CAPA</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB — Calibration / EOL (charts + filtered views + quick record)
// ============================================================================
function CalibrationTab({ data, loading, onOpen, onRecord }: {
  data?: InspPayload; loading: boolean; onOpen: (id: string) => void; onRecord: () => void;
}) {
  const inspections = data?.inspections ?? [];
  const woFamily = data?.woFamily ?? {};

  const famStats = useMemo(() => FAMILIES.map((fam) => {
    const eol = inspections.filter((i) => i.kind === "EOL" && (woFamily[i.woNumber] ?? "") === fam);
    const first = eol.filter((i) => i.attempt === 1);
    const fpy = first.length ? Math.round((first.filter((i) => i.status === "PASSED").length / first.length) * 100) : 0;
    const retestRate = eol.length ? Math.round((eol.filter((i) => i.attempt > 1).length / eol.length) * 100) : 0;
    return { family: fam, FPY: fpy, Retest: retestRate, samples: eol.length };
  }), [inspections, woFamily]);

  const calRows = inspections.filter((i) => i.kind === "CALIBRATION");
  const eolRows = inspections.filter((i) => i.kind === "EOL");
  const pendingCalEol = inspections.filter((i) => i.status === "PENDING" && (i.kind === "CALIBRATION" || i.kind === "EOL")).length;

  const cols: Column<Insp>[] = [
    { key: "inspNumber", header: "Inspection", render: (r) => <Mono className="text-primary">{r.inspNumber}</Mono> },
    { key: "lotNumber", header: "Lot / Serial", render: (r) => <Mono>{r.lotNumber || "—"}</Mono> },
    { key: "attempt", header: "Att.", render: (r) => <span className="tabular">{r.attempt}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "submittedAt", header: "Submitted", render: (r) => <DateCell value={r.submittedAt} /> },
  ];

  const miniCols: Column<Insp>[] = cols.slice(0, 5);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Gauge}
        title="Calibration & EOL test records"
        desc="Electronic test evidence per spec §Calibration/EOL — FPY, retest governance, equipment-bound results"
        actions={
          <Button size="sm" className="h-8 gap-1.5" onClick={onRecord} title="Submit results for a PENDING calibration/EOL inspection">
            <FlaskConical className="h-3.5 w-3.5" /> Record test result{pendingCalEol > 0 ? ` (${pendingCalEol})` : ""}
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">EOL first-pass yield vs retest rate by family (%)</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={famStats} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.008 260 / 0.5)" vertical={false} />
                <XAxis dataKey="family" tick={{ fontSize: 10, fill: "oklch(0.67 0.008 260)" }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "oklch(0.67 0.008 260)" }} tickLine={false} axisLine={false} />
                <Tooltip {...CHART_TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="FPY" name="FPY %" fill="#34d399" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Retest" name="Retest rate %" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Retest governance</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-[12px]">
            <div className="flex items-center justify-between border-b border-border/40 pb-1.5"><span className="text-muted-foreground">EOL records</span><span className="tabular">{eolRows.length}</span></div>
            <div className="flex items-center justify-between border-b border-border/40 pb-1.5"><span className="text-muted-foreground">Retests (attempt &gt; 1)</span><span className="tabular text-amber-400">{eolRows.filter((i) => i.attempt > 1).length}</span></div>
            <div className="flex items-center justify-between border-b border-border/40 pb-1.5"><span className="text-muted-foreground">Failures preserved</span><span className="tabular text-red-400">{inspections.filter((i) => i.status === "FAILED").length}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Pending CAL/EOL</span><span className="tabular">{pendingCalEol}</span></div>
            <p className="text-[11px] text-muted-foreground pt-1">Every FAILED attempt stays immutable; a retest opens attempt+1 with a mandatory reason and keeps the original for audit.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-[12px] font-medium flex items-center gap-2"><KindBadge kind="CALIBRATION" /> <span className="text-muted-foreground">Calibration records ({calRows.length})</span></p>
          <DataTable columns={miniCols} rows={calRows} loading={loading} onRowClick={(r) => onOpen(r.id)} emptyMessage="No calibration records" maxHeight="max-h-[42vh]" dense rowKey={(r) => r.id} />
        </div>
        <div className="space-y-2">
          <p className="text-[12px] font-medium flex items-center gap-2"><KindBadge kind="EOL" /> <span className="text-muted-foreground">End-of-line test records ({eolRows.length})</span></p>
          <DataTable columns={cols} rows={eolRows} loading={loading} onRowClick={(r) => onOpen(r.id)} emptyMessage="No EOL records" maxHeight="max-h-[42vh]" dense rowKey={(r) => r.id} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TAB — Product Release (evidence gate + four-eyes)
// ============================================================================
function ReleasesTab({ data, loading, canApprove, sessionUser, onOpen, onRun }: {
  data?: RelPayload; loading: boolean; canApprove: boolean; sessionUser: string;
  onOpen: (id: string) => void; onRun: () => void;
}) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const approve = useMutation({
    mutationFn: (id: string) => api("/api/releases", { body: { action: "approve", id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      toast("Serial RELEASED — evidence gate satisfied (four-eyes)");
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const releases = data?.releases ?? [];
  const pending = releases.filter((r) => r.status === "PENDING");

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={FileCheck2}
        title="Product release gate"
        desc="Run check → PENDING (evidence verified) → four-eyes approval → RELEASED · blockers shown in red"
        actions={
          <>
            <SyntheticBadge />
            <Button size="sm" className="h-8 gap-1.5" onClick={onRun} disabled={!canApprove} title={canApprove ? "Run release evidence check" : "Requires quality.approve"}>
              <Gauge className="h-3.5 w-3.5" /> Run release check
            </Button>
          </>
        }
      />
      {pending.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-3 flex items-start gap-2.5">
            <Lock className="h-4 w-4 mt-0.5 text-amber-400 shrink-0" />
            <p className="text-[12px] text-amber-100/85">
              {pending.length} release check{pending.length > 1 ? "s" : ""} passed and awaiting approval — the approver must be a <b>different user</b> than the checker
              {pending[0].releasedBy ? <> (checked by <Mono>{pending[0].releasedBy}</Mono>)</> : null}. Switch user in the topbar to demo four-eyes.
            </p>
          </CardContent>
        </Card>
      )}
      <DataTable
        columns={[
          { key: "releaseNumber", header: "Release", render: (r: ReleaseT) => <Mono className="text-primary">{r.releaseNumber}</Mono> },
          { key: "lotNumber", header: "Serial", render: (r: ReleaseT) => <Mono>{r.lotNumber}</Mono> },
          { key: "woNumber", header: "WO", render: (r: ReleaseT) => <Mono>{r.woNumber || "—"}</Mono> },
          { key: "status", header: "Status", render: (r: ReleaseT) => <StatusBadge status={r.status} /> },
          {
            key: "checks", header: "Evidence checks",
            render: (r: ReleaseT) => {
              const c = jparse<Partial<Checks>>(r.checksJson, {});
              return (
                <span className="inline-flex items-center gap-1.5" title={`genealogy ${c.genealogyComplete ? "✓" : "✗"} · inspections ${c.inspectionsPassed ? "✓" : "✗"} · cal ${c.calOk ? "✓" : "✗"} · eol ${c.eolOk ? "✓" : "✗"} · final ${c.finalOk ? "✓" : "✗"}`}>
                  <CheckX okv={!!c.genealogyComplete} /><CheckX okv={!!c.inspectionsPassed} /><CheckX okv={!!c.calOk} /><CheckX okv={!!c.eolOk} /><CheckX okv={!!c.finalOk} />
                </span>
              );
            },
          },
          { key: "releasedBy", header: "Checked by", render: (r: ReleaseT) => <Mono>{r.releasedBy || "—"}</Mono> },
          { key: "approvedBy", header: "Approved by", render: (r: ReleaseT) => r.approvedBy ? <Mono className="text-emerald-300">{r.approvedBy}</Mono> : <span className="text-muted-foreground">—</span> },
          { key: "releasedAt", header: "Released", render: (r: ReleaseT) => <DateCell value={r.releasedAt} /> },
          {
            key: "actions", header: "",
            render: (r: ReleaseT) => (
              <div className="flex items-center gap-1.5">
                {r.status === "PENDING" && (
                  <Button
                    size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                    disabled={!canApprove || approve.isPending || sessionUser === r.releasedBy}
                    title={sessionUser === r.releasedBy ? "Four-eyes: you ran this check — switch user to approve" : "Approve release (four-eyes)"}
                    onClick={(e) => { e.stopPropagation(); approve.mutate(r.id); }}
                  >
                    <Check className="h-3 w-3" /> Approve
                  </Button>
                )}
                {r.status === "BLOCKED" && <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-300">evidence missing</Badge>}
                {r.status === "RELEASED" && (
                  <>
                    <Button
                      size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                      title="Print Certificate of Conformance (controlled document)"
                      onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("tau-erp-print", { detail: { kind: "coc", lot: r.lotNumber } })); }}
                    >
                      <Printer className="h-3 w-3" /> CoC
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                      title="Print Calibration Certificate (controlled document)"
                      onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("tau-erp-print", { detail: { kind: "calibration", lot: r.lotNumber } })); }}
                    >
                      <Gauge className="h-3 w-3" /> Cal Cert
                    </Button>
                  </>
                )}
              </div>
            ),
          },
        ] satisfies Column<ReleaseT>[]}
        rows={releases}
        loading={loading}
        onRowClick={(r) => onOpen(r.id)}
        emptyMessage="No release checks yet — run one on a finished serial"
        rowKey={(r) => r.id}
      />
    </div>
  );
}

// ============================================================================
// Dialog — Run release check
// ============================================================================
function RunReleaseDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const { data } = useQuery<RelPayload>({ queryKey: ["releases"], queryFn: () => api<RelPayload>("/api/releases") });
  const [lotNumber, setLotNumber] = useState("");

  const run = useMutation({
    mutationFn: () => api<{ release: ReleaseT; blockers: string[] }>("/api/releases/execute", { body: { lotNumber } }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      if (d.blockers.length > 0) {
        toast(`${d.release.releaseNumber}: BLOCKED — ${d.blockers[0]}${d.blockers.length > 1 ? ` (+${d.blockers.length - 1} more)` : ""}`, "err");
      } else {
        toast(`${d.release.releaseNumber}: PENDING — all evidence checks passed, awaiting four-eyes approval`);
      }
      onClose();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const lots = data?.eligibleLots ?? [];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Run release evidence check</DialogTitle>
          <DialogDescription>
            Verifies genealogy completeness and CALIBRATION + EOL + FINAL evidence (no FAILED attempt without a later passing retest). A passed check creates a PENDING record for four-eyes approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-[12px]">Finished serial</Label>
          <Select value={lotNumber} onValueChange={setLotNumber}>
            <SelectTrigger className="h-9 bg-input/60 text-[12px]"><SelectValue placeholder="Select serial…" /></SelectTrigger>
            <SelectContent className="max-h-64">
              {lots.map((l) => (
                <SelectItem key={l.lotNumber} value={l.lotNumber}>
                  <span className="text-[12px]"><Mono>{l.lotNumber}</Mono> · {l.partNumber} ({l.family}) · {l.woNumber || "no WO"}{l.hasOpenCheck ? " · check open" : ""}</span>
                </SelectItem>
              ))}
              {lots.length === 0 && <SelectItem value="__none" disabled>No eligible finished serials</SelectItem>}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">Already-released serials are excluded — released evidence is immutable (spec rule 9).</p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-8" disabled={!lotNumber || run.isPending} onClick={() => run.mutate()}>Run check</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Dialog — Release record detail
// ============================================================================
function ReleaseDialog({ relId, canApprove, sessionUser, onClose }: { relId: string; canApprove: boolean; sessionUser: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const { data } = useQuery<RelPayload>({ queryKey: ["releases"], queryFn: () => api<RelPayload>("/api/releases") });
  const rel = data?.releases.find((r) => r.id === relId);
  const checks = rel ? jparse<Partial<Checks>>(rel.checksJson, {}) : {};
  const blockers = rel ? jparse<string[]>(rel.blockersJson, []) : [];

  const approve = useMutation({
    mutationFn: () => api("/api/releases", { body: { action: "approve", id: rel!.id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["releases"] }); toast(`${rel!.releaseNumber} RELEASED`); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const checkItems: { k: keyof Checks; label: string }[] = [
    { k: "genealogyComplete", label: "Genealogy complete (≥1 component link)" },
    { k: "inspectionsPassed", label: "Inspections passed (no failure without later retest)" },
    { k: "calOk", label: "Calibration PASSED" },
    { k: "eolOk", label: "EOL PASSED" },
    { k: "finalOk", label: "Final inspection PASSED" },
  ];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mono className="text-primary">{rel?.releaseNumber ?? "…"}</Mono>
            {rel && <StatusBadge status={rel.status} />}
          </DialogTitle>
          <DialogDescription>Product release evidence gate — synthetic demo data, not a statutory CoC.</DialogDescription>
        </DialogHeader>
        {rel && (
          <div className="space-y-4">
            <KeyValue
              items={[
                { k: "Serial", v: <Mono>{rel.lotNumber}</Mono> },
                { k: "Work order", v: <Mono>{rel.woNumber || "—"}</Mono> },
                { k: "Checked by", v: <Mono>{rel.releasedBy || "—"}</Mono> },
                { k: "Approved by", v: rel.approvedBy ? <Mono className="text-emerald-300">{rel.approvedBy}</Mono> : <span className="text-muted-foreground">awaiting four-eyes</span> },
                { k: "Released at", v: fmtDT(rel.releasedAt) },
                { k: "Created", v: fmtDT(rel.createdAt) },
              ]}
            />
            <div className="rounded-md border border-border/60 divide-y divide-border/40">
              {checkItems.map((c) => (
                <div key={c.k} className="flex items-center gap-2.5 px-2.5 py-2 text-[12px]">
                  <CheckX okv={!!checks[c.k]} />
                  <span>{c.label}</span>
                  <span className={cn("ml-auto text-[10px] uppercase", checks[c.k] ? "text-emerald-400" : "text-red-400")}>{checks[c.k] ? "pass" : "fail"}</span>
                </div>
              ))}
            </div>
            {rel.status === "BLOCKED" && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3">
                <p className="text-[12px] font-semibold text-red-300 mb-1.5 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Release blockers</p>
                <ul className="space-y-1">
                  {blockers.map((b, i) => <li key={i} className="text-[12px] text-red-200/85">• {b}</li>)}
                </ul>
              </div>
            )}
            {rel.status === "PENDING" && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">Approver must differ from <Mono>{rel.releasedBy}</Mono> (spec rule 12).</p>
                <Button size="sm" className="h-8 gap-1.5" disabled={!canApprove || approve.isPending || sessionUser === rel.releasedBy}
                  title={sessionUser === rel.releasedBy ? "Four-eyes: switch user to approve" : "Approve → RELEASED"}
                  onClick={() => approve.mutate()}>
                  <Check className="h-3.5 w-3.5" /> Approve release
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB — Equipment & calibration register
// ============================================================================
function EquipmentTab({ equipment, loading, canInspect }: { equipment: Equipment[]; loading: boolean; canInspect: boolean }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const schedule = useMutation({
    mutationFn: (id: string) => api("/api/equipment", { body: { action: "schedule", id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment"] });
      qc.invalidateQueries({ queryKey: ["inspections"] });
      toast("Calibration scheduled (+90 days) — audit logged");
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const days = (due?: string | null) => (due ? Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000) : null);

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={Wrench}
        title="Equipment & gauge calibration register"
        desc="Expired calibration blocks test submission server-side (spec Phase-10 gate: GAUGE-LEAK-01)"
        actions={<Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px]"><CalendarClock className="h-3 w-3 mr-1" /> schedule = due +90d</Badge>}
      />
      <CalibrationCalendar equipment={equipment} canSchedule={canInspect} loading={loading} />
      <DataTable
        columns={[
          { key: "code", header: "Code", render: (r: Equipment) => <Mono className="text-primary">{r.code}</Mono> },
          { key: "name", header: "Name", render: (r: Equipment) => <span className="text-[12px]">{r.name}</span> },
          { key: "kind", header: "Kind", render: (r: Equipment) => <Badge variant="outline" className="text-[10px] border-zinc-500/40 text-zinc-300">{r.kind.replace(/_/g, " ")}</Badge> },
          { key: "stationCode", header: "Station", render: (r: Equipment) => <Mono>{r.stationCode || "—"}</Mono> },
          {
            key: "calibrationDue", header: "Calibration due",
            render: (r: Equipment) => {
              const st = calState(r.calibrationDue);
              const d = days(r.calibrationDue);
              return (
                <span className="inline-flex items-center gap-1.5">
                  <CalDot state={st} />
                  <span className={cn("tabular text-[12px]", st === "EXPIRED" && "text-red-400 font-medium", st === "DUE_SOON" && "text-amber-400 font-medium")}>
                    {r.calibrationDue ? new Date(r.calibrationDue).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                    {d !== null && <span className="text-muted-foreground ml-1">({d < 0 ? `${-d}d overdue` : `in ${d}d`})</span>}
                  </span>
                </span>
              );
            },
          },
          { key: "state", header: "State", render: (r: Equipment) => <StatusBadge status={calState(r.calibrationDue) === "NONE" ? r.status : calState(r.calibrationDue)} /> },
          {
            key: "actions", header: "",
            render: (r: Equipment) => (
              <Button
                size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                disabled={!canInspect || schedule.isPending}
                title={canInspect ? "Schedule calibration now (+90d), status OK" : "Requires quality.inspect"}
                onClick={() => schedule.mutate(r.id)}
              >
                <CalendarClock className="h-3 w-3" /> Schedule
              </Button>
            ),
          },
        ] satisfies Column<Equipment>[]}
        rows={equipment}
        loading={loading}
        emptyMessage="No equipment registered"
        rowKey={(r) => r.id}
      />
      <PermHint show={!canInspect} />
    </div>
  );
}
