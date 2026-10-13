"use client";
// ============================================================================
// Tau ERP — Inventory & Traceability (Task 3-c) — InventoryView
// Tabs: Stock Overview · Lots (Serial/Batch) · Containers · Traceability
// Dossier · Scan Console (shop-floor keyboard-wedge simulator).
// APIs: /api/stock · /api/lots · /api/containers · /api/trace · /api/scan
// ============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { hasPerm } from "@/lib/erp/constants";
import {
  DataTable, DateCell, EmptyState, KeyValue, Money, Mono, PermDenied, SectionHeader,
  StatCard, StatusBadge, SubTabs, SyntheticBadge,
} from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle, ArrowRightLeft, Barcode, Boxes, CheckCircle2, ClipboardList, Container as ContainerIcon,
  FileDown, History, IndianRupee, Layers, Package, Printer, ScanBarcode, ScanLine, Search, Ship, Truck, Warehouse, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Types (mirror API responses)
// ============================================================================
type LotItem = { partNumber: string; name: string; itemType: string; trackingType: string; uom: string; unitCost: number; familyCode: string };
type Movement = { id: string; type: string; qty: number; fromWh: string; toWh: string; refType: string; refId: string; userId: string; note: string; createdAt: string };
type LotRow = {
  id: string; lotNumber: string; item: LotItem; trackingType: string; status: string; warehouseCode: string;
  qty: number; supplierBatch: string; grnLineId: string; grnNumber: string; woNumber: string;
  expiryDate: string | null; createdAt: string;
  genealogy: { parents: number; children: number }; containerCount: number; movements: Movement[];
};
type LotsResp = { lots: LotRow[]; total: number };

type WhSummary = {
  code: string; name: string; type: string; lotCount: number; qty: number;
  inStockCount: number; value: number; rejected: number; held: number;
};
type StockResp = {
  warehouses: WhSummary[];
  kpis: { totalLots: number; rejectedLots: number; heldLots: number; fgSerialsInWhFg: number; stockValue: number; shippedSerials: number; lastMovementAt: string | null };
  statusMix: Record<string, number>;
  totalLots: number;
};

type ContainerRow = {
  id: string; containerNumber: string; kind: string; status: string; dnNumber: string;
  soNumber: string; customerName: string; memberCount: number;
  members: { id: string; lotNumber: string; itemPartNumber: string; itemName: string; lotStatus: string }[];
  dnLines: string[];
};
type ContainersResp = { containers: ContainerRow[]; total: number };

type TraceNode = {
  lotId: string; lotNumber: string; status: string; warehouseCode: string; qty: number;
  nodeKind: "FG_SERIAL" | "SUBASSEMBLY" | "RAW_BATCH" | "LOT";
  item: { partNumber: string; name: string; itemType: string; trackingType: string };
  supplierBatch: string; grnLineId: string | null; grnNumber: string; woNumber: string; operationCode: string;
  linkQty: number;
  shipping: { containerNumber: string; dnNumber: string; soNumber: string; customerName: string }[];
  children: TraceNode[];
};
type TraceResp = {
  query: string;
  root: { lotId: string; lotNumber: string; status: string; warehouseCode: string; trackingType: string };
  backward: TraceNode; forward: TraceNode;
  impact: {
    shippedCount: number; serials: { lotNumber: string; itemPartNumber: string; dnNumber: string; soNumber: string; customerName: string }[];
    customers: string[]; dns: string[]; recallRequired: boolean;
  };
  quality: {
    inspections: { inspNumber: string; kind: string; status: string; attempt: number; overallResult: string; equipmentCode: string; submittedAt: string | null; retestReason: string }[];
    ncrs: { ncrNumber: string; severity: string; status: string; description: string; sourceRef: string; createdAt: string }[];
  };
  generatedAt: string;
};

type ScanResp = {
  scan: string; okScan: boolean; reason?: string;
  lot?: { lotNumber: string; status: string; warehouseCode: string; qty: number; item?: { partNumber: string; name: string }; trackingType?: string; supplierBatch?: string; woNumber?: string; expiryDate?: string | null };
  checks?: { check: string; pass: boolean; detail: string }[];
  fromWh?: string; toWh?: string; movementId?: string;
  genealogy?: { consumed: number; usedIn: number };
  recentMovements?: { id: string; type: string; fromWh: string; toWh: string; refType: string; refId: string; createdAt: string }[];
};
type ScanLogEntry = { id: string; at: Date; type: string; code: string; ok: boolean; msg: string };
type ImpactSerial = { id?: string; lotNumber: string; itemPartNumber: string; dnNumber: string; soNumber: string; customerName: string };
type InspRow = { id?: string; inspNumber: string; kind: string; status: string; attempt: number; overallResult: string; equipmentCode: string; submittedAt: string | null; retestReason: string };

const WAREHOUSE_CODES = ["WH-RAW", "WH-IQC", "WH-QUAR", "WH-ACC", "WH-REJ", "WH-WIP", "WH-FG", "WH-SCRAP", "WH-SUBCON", "WH-REWORK"];
const LOT_STATUSES = ["IN_STOCK", "WIP", "HELD", "REJECTED", "CONSUMED", "SHIPPED", "SCRAPPED"];
const TRACE_EXAMPLES = [
  { code: "SN-NOX-25-0003", hint: "FG serial — failed EOL attempt 1 (NCR story)" },
  { code: "B-ACS1120", hint: "rejected potting batch in WH-REJ" },
  { code: "B-BC2411A", hint: "ceramic batch consumed in 6 builds → shipped" },
];

function fmtDT(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Movement-type chip (semantic color, exact ERP movement verb). */
function MovementChip({ type }: { type: string }) {
  const tone =
    type === "SHIP" || type === "FG_RECEIPT" || type === "IQC_ACCEPT" || type === "PUTAWAY" || type === "RETURN"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : type === "IQC_REJECT" || type === "SCRAP"
        ? "border-red-500/30 bg-red-500/10 text-red-300"
        : type === "RECEIPT"
          ? "border-teal-500/30 bg-teal-500/10 text-teal-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return <Badge variant="outline" className={cn("font-mono text-[10px]", tone)}>{type}</Badge>;
}

// ============================================================================
// Recursive genealogy tree node (indented, connector lines, node-kind icons)
// ============================================================================
const NODE_KIND_META: Record<TraceNode["nodeKind"], { icon: React.ElementType; color: string; label: string }> = {
  FG_SERIAL: { icon: Package, color: "text-amber-400 border-amber-500/40 bg-amber-500/5", label: "FG serial" },
  SUBASSEMBLY: { icon: Boxes, color: "text-teal-300 border-teal-500/30 bg-teal-500/5", label: "Subassembly" },
  RAW_BATCH: { icon: Layers, color: "text-zinc-300 border-zinc-500/30 bg-zinc-500/5", label: "Raw batch" },
  LOT: { icon: Barcode, color: "text-zinc-300 border-zinc-500/30 bg-zinc-500/5", label: "Lot" },
};

function TraceTreeNode({ node, depth = 0 }: { node: TraceNode; depth?: number }) {
  const meta = NODE_KIND_META[node.nodeKind] ?? NODE_KIND_META.LOT;
  const Icon = meta.icon;
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1.5 text-[12px]",
          meta.color,
          depth === 0 && "ring-1 ring-primary/30",
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <Mono className="font-semibold text-foreground">{node.lotNumber}</Mono>
        <span className="text-muted-foreground">{node.item.partNumber}</span>
        <Badge variant="outline" className="h-4 px-1.5 py-0 text-[9px] uppercase tracking-wide text-muted-foreground">
          {meta.label}
        </Badge>
        {node.nodeKind === "RAW_BATCH" && node.supplierBatch && (
          <span className="text-[10px] text-muted-foreground">
            supplier batch <Mono>{node.supplierBatch}</Mono>
          </span>
        )}
        {node.nodeKind === "RAW_BATCH" && node.grnNumber && (
          <span className="text-[10px] text-muted-foreground">
            via <Mono className="text-primary">{node.grnNumber}</Mono>
          </span>
        )}
        {node.operationCode && (
          <Badge variant="outline" className="h-4 px-1.5 py-0 font-mono text-[9px] text-muted-foreground">{node.operationCode}</Badge>
        )}
        {node.woNumber && <span className="text-[10px] text-muted-foreground"><Mono>{node.woNumber}</Mono></span>}
        {node.linkQty > 0 && <span className="text-[10px] tabular text-muted-foreground">×{node.linkQty}</span>}
        <StatusBadge status={node.status} className="ml-auto h-4 px-1.5 py-0 text-[9px]" />
        {node.shipping.map((s) => (
          <span key={`${node.lotId}-${s.containerNumber}-${s.dnNumber}`} className="flex items-center gap-1 text-[10px] text-emerald-300/90">
            <Truck className="h-3 w-3" />
            <Mono>{[s.containerNumber, s.dnNumber, s.soNumber].filter(Boolean).join(" → ")}</Mono>
            {s.customerName && <span className="text-muted-foreground">· {s.customerName}</span>}
          </span>
        ))}
      </div>
      {node.children.length > 0 && (
        <div className="ml-3 mt-1 space-y-1 border-l border-border/70 pl-3">
          {node.children.map((c) => <TraceTreeNode key={`${c.lotId}-${c.operationCode}`} node={c} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main view
// ============================================================================
export default function InventoryView() {
  const navigate = useErpStore((s) => s.navigate);
  const routeTab = useErpStore((s) => s.route.tab);
  const sessionUser = useErpStore((s) => s.sessionUser);
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const canMove = hasPerm(sessionUser?.role, "inventory.move");

  // Sub-tab is fully hash-driven (#/inventory/<tab>) — deep links from the
  // dashboard (e.g. navigate("inventory", "lots")) select the tab directly.
  const TAB_KEYS = ["stock", "lots", "containers", "trace", "scan"];
  const tab = TAB_KEYS.includes(routeTab) ? routeTab : "stock";
  const setTab = (k: string) => navigate("inventory", k);

  // ------------------------------------------------------------------ data
  const stock = useQuery<StockResp>({ queryKey: ["stock"], queryFn: () => api<StockResp>("/api/stock") });
  const containers = useQuery<ContainersResp>({ queryKey: ["containers"], queryFn: () => api<ContainersResp>("/api/containers") });

  // lots filters (debounced search)
  const [lotSearch, setLotSearch] = useState("");
  const [lotQ, setLotQ] = useState("");
  const [lotStatus, setLotStatus] = useState("all");
  const [lotWh, setLotWh] = useState("all");
  useEffect(() => {
    const t = setTimeout(() => setLotQ(lotSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [lotSearch]);
  const lots = useQuery<LotsResp>({
    queryKey: ["lots", lotQ, lotStatus, lotWh],
    queryFn: () => {
      const p = new URLSearchParams();
      if (lotQ) p.set("q", lotQ);
      if (lotStatus !== "all") p.set("status", lotStatus);
      if (lotWh !== "all") p.set("wh", lotWh);
      return api<LotsResp>(`/api/lots?${p.toString()}`);
    },
  });

  // trace
  const [traceInput, setTraceInput] = useState("");
  const [traceLot, setTraceLot] = useState("");
  const trace = useQuery<TraceResp>({
    queryKey: ["trace", traceLot],
    queryFn: () => api<TraceResp>(`/api/trace?lot=${encodeURIComponent(traceLot)}`),
    enabled: traceLot.trim().length > 0,
    retry: false,
  });

  // scan console
  const [scanType, setScanType] = useState("LOT_INFO");
  const [scanCode, setScanCode] = useState("");
  const [scanToWh, setScanToWh] = useState("WH-WIP");
  const [scanWo, setScanWo] = useState("");
  const [scanResult, setScanResult] = useState<{ ok: boolean; data?: ScanResp; error?: string } | null>(null);
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([]);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const scanMutation = useMutation({
    mutationFn: (payload: { type: string; lot: string; toWh?: string; woNumber?: string }) => api<ScanResp>("/api/scan", { method: "POST", body: payload }),
    onSuccess: (data) => {
      setScanResult({ ok: true, data });
      setScanLog((l) => [{ id: `${Date.now()}`, at: new Date(), type: data.scan, code: data.lot?.lotNumber ?? scanCode, ok: true, msg: data.reason ?? "Scan OK" }, ...l].slice(0, 25));
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["lots"] });
      qc.invalidateQueries({ queryKey: ["trace"] });
      toast(`Scan ${data.scan} OK — ${data.lot?.lotNumber ?? ""}`, "ok");
    },
    onError: (e: Error) => {
      setScanResult({ ok: false, error: e.message });
      setScanLog((l) => [{ id: `${Date.now()}`, at: new Date(), type: scanType, code: scanCode, ok: false, msg: e.message }, ...l].slice(0, 25));
      toast(e.message, "err");
    },
  });

  const createContainerMutation = useMutation({
    mutationFn: (payload: { kind: string; lots: string[] }) => api<{ container: { containerNumber: string; packed: number } }>("/api/containers", { method: "POST", body: payload }),
    onSuccess: (d) => {
      toast(`${d.container.containerNumber} created — ${d.container.packed} serial(s) packed`, "ok");
      setCreateOpen(false);
      setCreateLots("");
      qc.invalidateQueries({ queryKey: ["containers"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["lots"] });
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  // dialogs
  const [selectedLot, setSelectedLot] = useState<LotRow | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<ContainerRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState("BOX");
  const [createLots, setCreateLots] = useState("");

  // stock tab filters
  const [stockWh, setStockWh] = useState("all");
  const [stockItem, setStockItem] = useState("all");
  const [stockStatus, setStockStatus] = useState("all");

  const whOptions = stock.data?.warehouses.map((w) => w.code) ?? WAREHOUSE_CODES;

  // ------------------------------------------------------------------ derived
  const stockRows = useMemo(() => {
    const rows = lots.data?.lots ?? [];
    return rows.filter(
      (r) =>
        (stockWh === "all" || r.warehouseCode === stockWh) &&
        (stockItem === "all" || r.item.partNumber === stockItem) &&
        (stockStatus === "all" || r.status === stockStatus),
    );
  }, [lots.data, stockWh, stockItem, stockStatus]);

  const itemOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of lots.data?.lots ?? []) set.set(r.item.partNumber, r.item.name);
    return [...set.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [lots.data]);

  function runScan() {
    const code = scanCode.trim();
    if (!code) {
      setScanResult({ ok: false, error: "Malformed scan: empty barcode — scan or type a serial/batch number" });
      return;
    }
    if (scanType === "MOVE" && !canMove) {
      setScanResult({ ok: false, error: `Permission denied: role ${sessionUser?.role ?? "?"} lacks 'inventory.move' (server-side RBAC enforced)` });
      return;
    }
    scanMutation.mutate({ type: scanType, lot: code, toWh: scanType === "MOVE" ? scanToWh : undefined, woNumber: scanType === "VALIDATE_ISSUE" ? scanWo.trim() : undefined });
    setScanCode("");
    scanInputRef.current?.focus();
  }

  function exportDossier() {
    const t = trace.data;
    if (!t) return;
    const blob = new Blob([JSON.stringify(t, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trace-dossier-${t.query}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Traceability dossier exported (JSON)", "ok");
  }

  const packList = createLots.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

  const TABS = [
    { key: "stock", label: "Stock Overview", count: stock.data?.totalLots },
    { key: "lots", label: "Lots (Serial/Batch)", count: lots.data?.total ?? stock.data?.totalLots },
    { key: "containers", label: "Containers", count: containers.data?.total },
    { key: "trace", label: "Traceability Dossier" },
    { key: "scan", label: "Scan Console" },
  ];

  // ============================================================================
  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Boxes}
        title="Inventory & Traceability"
        desc="Serial/batch genealogy · warehouse stock · containers · shop-floor scans — plant PLANT-PUNE"
        actions={<SyntheticBadge />}
      />

      <SubTabs tabs={TABS} value={tab} onChange={setTab} />

      {/* ================================================================ STOCK OVERVIEW */}
      {tab === "stock" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            <StatCard label="Total Lots" value={stock.data?.kpis.totalLots ?? "—"} sub="serials + batches tracked" icon={Barcode} onClick={() => setTab("lots")} />
            <StatCard
              label="Rejected Lots" value={stock.data?.kpis.rejectedLots ?? "—"} sub="awaiting MRB disposition" icon={AlertTriangle}
              tone={stock.data && stock.data.kpis.rejectedLots > 0 ? "bad" : "good"} onClick={() => { setLotStatus("REJECTED"); setTab("lots"); }}
            />
            <StatCard label="FG Serials in WH-FG" value={stock.data?.kpis.fgSerialsInWhFg ?? "—"} sub="released units ready to ship" icon={Package} tone="good" onClick={() => { setLotWh("WH-FG"); setTab("lots"); }} />
            <StatCard label="Stock Value" value={stock.data ? <Money value={stock.data.kpis.stockValue} /> : "—"} sub="IN_STOCK at unit cost" icon={IndianRupee} />
          </div>

          {/* status mix strip */}
          <Card>
            <CardContent className="p-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1">Status mix</span>
              {Object.entries(stock.data?.statusMix ?? {}).map(([st, n]) => (
                <button key={st} onClick={() => { setLotStatus(st); setTab("lots"); }} className="focus:outline-none">
                  <StatusBadge status={st} className="cursor-pointer hover:opacity-80" />
                  <span className="ml-1 text-[11px] tabular text-muted-foreground">{n}</span>
                </button>
              ))}
              <span className="ml-auto text-[11px] text-muted-foreground">
                last movement: {fmtDT(stock.data?.kpis.lastMovementAt)} · shipped serials: {stock.data?.kpis.shippedSerials ?? 0}
              </span>
            </CardContent>
          </Card>

          {/* warehouse cards */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Warehouse className="h-4 w-4 text-primary" /> Warehouses</h3>
              <span className="text-[11px] text-muted-foreground">click a card to filter the stock table</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {(stock.data?.warehouses ?? []).map((w) => (
                <Card
                  key={w.code}
                  className={cn("bg-card/80 border-border/70 cursor-pointer transition-colors hover:border-primary/40", stockWh === w.code && "border-primary/60 ring-1 ring-primary/30")}
                  onClick={() => { setStockWh(stockWh === w.code ? "all" : w.code); setLotWh(stockWh === w.code ? "all" : w.code); }}
                >
                  <CardContent className="p-3.5">
                    <div className="flex items-center justify-between">
                      <Mono className="font-semibold text-primary">{w.code}</Mono>
                      {(w.rejected > 0 || w.held > 0) && (
                        <span className="flex gap-1">
                          {w.rejected > 0 && <StatusBadge status="REJECTED" className="h-4 px-1 py-0 text-[9px]" />}
                          {w.held > 0 && <StatusBadge status="HELD" className="h-4 px-1 py-0 text-[9px]" />}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{w.name}</p>
                    <div className="mt-2 flex items-baseline gap-3">
                      <span className="text-lg font-semibold tabular">{w.lotCount}</span>
                      <span className="text-[10px] uppercase text-muted-foreground">lots</span>
                      <span className="text-sm tabular ml-auto">{w.qty.toLocaleString("en-IN")}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">value</span>
                      <Money value={w.value} className="text-[12px]" />
                    </div>
                  </CardContent>
                </Card>
              ))}
              {stock.isLoading && Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />)}
            </div>
          </div>

          {/* stock table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex flex-wrap items-center gap-2">
                Stock by lot
                <Select value={stockWh} onValueChange={setStockWh}>
                  <SelectTrigger className="h-7 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{["all", ...whOptions].map((c) => <SelectItem key={c} value={c}>{c === "all" ? "All warehouses" : c}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={stockItem} onValueChange={setStockItem}>
                  <SelectTrigger className="h-7 w-[190px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All items</SelectItem>
                    {itemOptions.map(([pn, name]) => <SelectItem key={pn} value={pn}>{pn} — {name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={stockStatus} onValueChange={setStockStatus}>
                  <SelectTrigger className="h-7 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{["all", ...LOT_STATUSES].map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>)}</SelectContent>
                </Select>
                <span className="ml-auto text-[11px] font-normal text-muted-foreground">{stockRows.length} lot(s) · click a row for full history</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable<LotRow>
                dense
                rows={stockRows}
                loading={lots.isLoading}
                emptyMessage="No lots match the current filters"
                onRowClick={(r) => setSelectedLot(r)}
                columns={[
                  { key: "wh", header: "WH", render: (r) => <Mono className="text-primary">{r.warehouseCode}</Mono> },
                  { key: "lot", header: "Lot / Serial", render: (r) => <Mono className="font-semibold">{r.lotNumber}</Mono> },
                  { key: "item", header: "Item", render: (r) => (
                    <div className="min-w-0"><div className="truncate text-[12px]">{r.item.partNumber}</div><div className="truncate text-[11px] text-muted-foreground">{r.item.name}</div></div>
                  ) },
                  { key: "tracking", header: "Track", render: (r) => <Badge variant="outline" className="text-[10px]">{r.trackingType}</Badge> },
                  { key: "qty", header: "Qty", className: "text-right", render: (r) => <span className="tabular">{r.qty.toLocaleString("en-IN")}</span> },
                  { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
                  { key: "value", header: "Value", className: "text-right", render: (r) => r.status === "IN_STOCK" ? <Money value={r.qty * r.item.unitCost} /> : <span className="text-muted-foreground">—</span> },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================================================================ LOTS */}
      {tab === "lots" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={lotSearch} onChange={(e) => setLotSearch(e.target.value)} placeholder="Search lot/serial, item, supplier batch, WO…" className="pl-8 h-9 bg-input/60" />
              </div>
              <Select value={lotStatus} onValueChange={setLotStatus}>
                <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>{["all", ...LOT_STATUSES].map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={lotWh} onValueChange={setLotWh}>
                <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>{["all", ...whOptions].map((c) => <SelectItem key={c} value={c}>{c === "all" ? "All warehouses" : c}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-[11px] text-muted-foreground">{lots.data?.total ?? 0} lot(s)</span>
            </CardContent>
          </Card>

          <DataTable<LotRow>
            rows={lots.data?.lots ?? []}
            loading={lots.isLoading}
            emptyMessage="No lots found — adjust filters"
            onRowClick={(r) => setSelectedLot(r)}
            columns={[
              { key: "lot", header: "Lot / Serial", render: (r) => <Mono className="font-semibold text-primary">{r.lotNumber}</Mono> },
              { key: "item", header: "Item", render: (r) => (
                <div className="min-w-0"><div className="truncate text-[12px]">{r.item.partNumber}</div><div className="truncate text-[11px] text-muted-foreground">{r.item.name}</div></div>
              ) },
              { key: "tracking", header: "Type", render: (r) => <Badge variant="outline" className="text-[10px]">{r.trackingType}</Badge> },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "wh", header: "Warehouse", render: (r) => <Mono>{r.warehouseCode}</Mono> },
              { key: "qty", header: "Qty", className: "text-right", render: (r) => <span className="tabular">{r.qty.toLocaleString("en-IN")}</span> },
              { key: "supBatch", header: "Supplier batch", render: (r) => r.supplierBatch ? <Mono>{r.supplierBatch}</Mono> : <span className="text-muted-foreground">—</span> },
              { key: "wo", header: "WO", render: (r) => r.woNumber ? <Mono>{r.woNumber}</Mono> : <span className="text-muted-foreground">—</span> },
              { key: "expiry", header: "Expiry", render: (r) => <DateCell value={r.expiryDate} /> },
              { key: "gene", header: "Genealogy", render: (r) => (
                <span className="text-[11px] text-muted-foreground tabular" title="consumed components / used-in parents">
                  ↓{r.genealogy.children} · ↑{r.genealogy.parents}
                </span>
              ) },
            ]}
          />

          {/* Lot detail dialog */}
          <Dialog open={!!selectedLot} onOpenChange={(o) => !o && setSelectedLot(null)}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto erp-scroll">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Barcode className="h-4 w-4 text-primary" />
                  Lot <Mono className="text-primary">{selectedLot?.lotNumber}</Mono>
                  {selectedLot && <StatusBadge status={selectedLot.status} />}
                </DialogTitle>
                <DialogDescription>Serial/batch master + immutable movement history + genealogy</DialogDescription>
              </DialogHeader>
              {selectedLot && (
                <div className="space-y-4">
                  <KeyValue items={[
                    { k: "Item", v: <span>{selectedLot.item.partNumber} — {selectedLot.item.name}</span> },
                    { k: "Tracking", v: <Badge variant="outline" className="text-[10px]">{selectedLot.trackingType}</Badge> },
                    { k: "Warehouse", v: <Mono>{selectedLot.warehouseCode}</Mono> },
                    { k: "Qty", v: <span className="tabular">{selectedLot.qty.toLocaleString("en-IN")} {selectedLot.item.uom}</span> },
                    { k: "Supplier batch", v: selectedLot.supplierBatch ? <Mono>{selectedLot.supplierBatch}</Mono> : "—" },
                    { k: "GRN", v: selectedLot.grnNumber ? <Mono className="text-primary">{selectedLot.grnNumber}</Mono> : "—" },
                    { k: "Produced by WO", v: selectedLot.woNumber ? <Mono>{selectedLot.woNumber}</Mono> : "—" },
                    { k: "Expiry", v: <DateCell value={selectedLot.expiryDate} /> },
                    { k: "Created", v: fmtDT(selectedLot.createdAt) },
                    { k: "Unit cost", v: <Money value={selectedLot.item.unitCost} /> },
                  ]} />

                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <Badge variant="outline" className="gap-1"><Layers className="h-3 w-3" /> consumed components: {selectedLot.genealogy.children}</Badge>
                    <Badge variant="outline" className="gap-1"><Boxes className="h-3 w-3" /> used-in parents: {selectedLot.genealogy.parents}</Badge>
                    <Badge variant="outline" className="gap-1"><ContainerIcon className="h-3 w-3" /> containers: {selectedLot.containerCount}</Badge>
                    <Button variant="outline" size="sm" className="ml-auto h-7 text-[12px]" onClick={() => { setTraceInput(selectedLot.lotNumber); setTraceLot(selectedLot.lotNumber); setTab("trace"); }}>
                      Open trace dossier
                    </Button>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                      <History className="h-3.5 w-3.5" /> Movement history ({selectedLot.movements.length})
                    </h4>
                    {selectedLot.movements.length === 0 ? (
                      <EmptyState message="No stock movements recorded" icon={History} />
                    ) : (
                      <div className="relative ml-3 border-l border-border/70 pl-4 space-y-3">
                        {selectedLot.movements.map((m) => (
                          <div key={m.id} className="relative">
                            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                            <div className="flex flex-wrap items-center gap-2 text-[12px]">
                              <MovementChip type={m.type} />
                              <span className="text-muted-foreground">
                                {m.fromWh || "∅"} <ArrowRightLeft className="inline h-3 w-3 mx-1" /> {m.toWh || "∅"}
                              </span>
                              {m.refType && <Badge variant="outline" className="text-[10px] font-mono">{m.refType} {m.refId}</Badge>}
                              <span className="text-[11px] text-muted-foreground">qty {m.qty}</span>
                              <span className="ml-auto text-[11px] text-muted-foreground">{fmtDT(m.createdAt)} · <Mono>{m.userId || "system"}</Mono></span>
                            </div>
                            {m.note && <p className="text-[11px] text-muted-foreground mt-0.5">{m.note}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ================================================================ CONTAINERS */}
      {tab === "containers" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-muted-foreground">
              Packing units (BOX/PALLET) — a serial can live in exactly one container; duplicates are rejected server-side.
            </p>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <ContainerIcon className="h-4 w-4" /> New container + pack serials
            </Button>
          </div>

          <DataTable<ContainerRow>
            rows={containers.data?.containers ?? []}
            loading={containers.isLoading}
            emptyMessage="No containers yet — create one and pack released serials"
            onRowClick={(r) => setSelectedContainer(r)}
            columns={[
              { key: "ctn", header: "Container", render: (r) => <Mono className="font-semibold text-primary">{r.containerNumber}</Mono> },
              { key: "kind", header: "Kind", render: (r) => <Badge variant="outline" className="text-[10px]">{r.kind}</Badge> },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "dn", header: "DN", render: (r) => r.dnNumber ? <Mono>{r.dnNumber}</Mono> : <span className="text-muted-foreground">—</span> },
              { key: "so", header: "SO / Customer", render: (r) => r.soNumber ? (
                <span className="text-[12px]"><Mono>{r.soNumber}</Mono> <span className="text-muted-foreground">· {r.customerName}</span></span>
              ) : <span className="text-muted-foreground">—</span> },
              { key: "members", header: "Serials", className: "text-right", render: (r) => <span className="tabular">{r.memberCount}</span> },
            ]}
          />

          {/* container detail dialog */}
          <Dialog open={!!selectedContainer} onOpenChange={(o) => !o && setSelectedContainer(null)}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto erp-scroll">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ContainerIcon className="h-4 w-4 text-primary" />
                  <Mono className="text-primary">{selectedContainer?.containerNumber}</Mono>
                  {selectedContainer && <StatusBadge status={selectedContainer.status} />}
                </DialogTitle>
                <DialogDescription>
                  {selectedContainer?.kind} · {selectedContainer?.memberCount} packed serial(s)
                  {selectedContainer?.dnNumber ? ` · shipped on ${selectedContainer.dnNumber}` : " · not yet dispatched"}
                </DialogDescription>
              </DialogHeader>
              {selectedContainer && (
                <div className="space-y-3">
                  <DataTable
                    dense
                    maxHeight="max-h-[40vh]"
                    rows={selectedContainer.members}
                    rowKey={(m) => m.id}
                    emptyMessage="Container is empty"
                    columns={[
                      { key: "lot", header: "Serial / Lot", render: (m) => <Mono className="font-semibold">{m.lotNumber}</Mono> },
                      { key: "item", header: "Item", render: (m) => <span className="text-[12px]">{m.itemPartNumber} <span className="text-muted-foreground">· {m.itemName}</span></span> },
                      { key: "status", header: "Lot status", render: (m) => <StatusBadge status={m.lotStatus} /> },
                    ]}
                  />
                  {selectedContainer.dnLines.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      DN lines: <Mono>{selectedContainer.dnLines.join(", ")}</Mono>
                      {selectedContainer.soNumber && <> · SO <Mono>{selectedContainer.soNumber}</Mono> · {selectedContainer.customerName}</>}
                    </p>
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* create container dialog */}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><ContainerIcon className="h-4 w-4 text-primary" /> New container + pack serials</DialogTitle>
                <DialogDescription>
                  Number is auto-assigned as <Mono className="text-primary">CTN-{new Date().getFullYear()}-NNNN</Mono>. One serial per line; a serial already packed in another container is rejected.
                </DialogDescription>
              </DialogHeader>
              {canMove ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[12px]">Container kind</Label>
                      <Select value={createKind} onValueChange={setCreateKind}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="BOX">BOX</SelectItem>
                          <SelectItem value="PALLET">PALLET</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12px]">Container number</Label>
                      <Input readOnly value={`auto · CTN-${new Date().getFullYear()}-NNNN`} className="bg-muted/40 font-mono text-[12px]" />
                      <p className="text-[10px] text-muted-foreground">assigned by the server at creation</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[12px]">Serial / batch numbers (one per line or comma-separated)</Label>
                    <Textarea
                      value={createLots}
                      onChange={(e) => setCreateLots(e.target.value)}
                      rows={5}
                      placeholder={"SN-NOX-25-0001\nSN-NOX-25-0002"}
                      className="font-mono text-[12px] bg-input/60"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Try serials not yet packed (e.g. subassembly serials SN-NXE-25-0001) — the 6 shipped NOx serials are already in CTN-2025-0001 and will fail with a clear error.
                    </p>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
                    <Button
                      size="sm"
                      disabled={packList.length === 0 || createContainerMutation.isPending}
                      onClick={() => createContainerMutation.mutate({ kind: createKind, lots: packList })}
                    >
                      {createContainerMutation.isPending ? "Creating…" : `Create + pack ${packList.length || ""}`}
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <PermDenied perm="inventory.move" />
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ================================================================ TRACEABILITY DOSSIER */}
      {tab === "trace" && (
        <div className="space-y-4">
          <Card className="border-primary/25">
            <CardContent className="p-4 space-y-3">
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => { e.preventDefault(); setTraceLot(traceInput.trim()); }}
              >
                <div className="relative flex-1 min-w-[260px]">
                  <ScanBarcode className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                  <Input
                    value={traceInput}
                    onChange={(e) => setTraceInput(e.target.value)}
                    placeholder="Enter serial or batch number — e.g. SN-NOX-25-0003"
                    className="pl-8 h-10 font-mono bg-input/60"
                    aria-label="Trace serial or batch"
                  />
                </div>
                <Button type="submit" size="lg" className="gap-1.5" disabled={!traceInput.trim()}>
                  <Search className="h-4 w-4" /> Build dossier
                </Button>
                {trace.data && (
                  <Button type="button" variant="outline" size="lg" className="gap-1.5" onClick={exportDossier}>
                    <FileDown className="h-4 w-4" /> Export dossier
                  </Button>
                )}
                {trace.data && (
                  <Button type="button" variant="outline" size="lg" className="gap-1.5" onClick={() => window.dispatchEvent(new CustomEvent("tau-erp-print", { detail: { kind: "dossier", lot: traceInput.trim() } }))}>
                    <Printer className="h-4 w-4" /> Print dossier
                  </Button>
                )}
              </form>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">try:</span>
                {TRACE_EXAMPLES.map((ex) => (
                  <button
                    key={ex.code}
                    onClick={() => { setTraceInput(ex.code); setTraceLot(ex.code); }}
                    className="group flex items-center gap-1.5 rounded-full border border-border/70 bg-background/50 px-2.5 py-1 text-[11px] hover:border-primary/50 transition-colors"
                    title={ex.hint}
                  >
                    <Mono className="text-primary group-hover:text-primary">{ex.code}</Mono>
                    <span className="text-muted-foreground">{ex.hint}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {trace.isError && (
            <Card className="border-red-500/40 bg-red-500/5">
              <CardContent className="p-4 flex items-center gap-3">
                <XCircle className="h-5 w-5 text-red-400" />
                <div>
                  <p className="font-medium text-red-300">Trace lookup failed</p>
                  <p className="text-[12px] text-muted-foreground">{(trace.error as Error).message}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {trace.data && (
            <div className="space-y-4">
              {/* recall impact */}
              <Card className={cn(trace.data.impact.recallRequired ? "border-red-500/40 bg-red-500/5" : "border-emerald-500/30 bg-emerald-500/5")}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Ship className={cn("h-4 w-4", trace.data.impact.recallRequired ? "text-red-400" : "text-emerald-400")} />
                    Recall impact — {trace.data.query}
                    {trace.data.impact.recallRequired && <Badge className="bg-red-500/15 text-red-300 border-red-500/30 text-[10px]">RECALL REQUIRED</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard label="Shipped serials affected" value={trace.data.impact.shippedCount} tone={trace.data.impact.recallRequired ? "bad" : "good"} sub="reachable via forward genealogy" />
                    <StatCard label="Customers to notify" value={trace.data.impact.customers.length} sub={trace.data.impact.customers.join(", ") || "none"} />
                    <StatCard label="Delivery notes" value={trace.data.impact.dns.length} sub={trace.data.impact.dns.join(", ") || "none"} />
                    <StatCard label="Quality events" value={trace.data.quality.inspections.length + trace.data.quality.ncrs.length} sub={`${trace.data.quality.ncrs.length} NCR · ${trace.data.quality.inspections.length} inspections`} />
                  </div>
                  {trace.data.impact.serials.length > 0 && (
                    <DataTable<ImpactSerial>
                      dense
                      maxHeight="max-h-44"
                      rows={trace.data.impact.serials}
                      rowKey={(s) => `${s.lotNumber}-${s.dnNumber}`}
                      columns={[
                        { key: "lot", header: "Serial", render: (s) => <Mono className="font-semibold">{s.lotNumber}</Mono> },
                        { key: "item", header: "Item", render: (s) => <Mono>{s.itemPartNumber}</Mono> },
                        { key: "dn", header: "DN", render: (s) => <Mono>{s.dnNumber || "—"}</Mono> },
                        { key: "so", header: "SO", render: (s) => <Mono>{s.soNumber || "—"}</Mono> },
                        { key: "cust", header: "Customer", render: (s) => s.customerName || "—" },
                      ]}
                    />
                  )}
                  {trace.data.quality.ncrs.length > 0 && (
                    <div className="space-y-1.5">
                      {trace.data.quality.ncrs.map((n) => (
                        <div key={n.ncrNumber} className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background/40 p-2 text-[12px]">
                          <ClipboardList className="h-3.5 w-3.5 text-orange-400" />
                          <Mono className="text-orange-300">{n.ncrNumber}</Mono>
                          <StatusBadge status={n.status} />
                          <StatusBadge status={n.severity} />
                          <span className="text-muted-foreground truncate">{n.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* trees */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" /> Backward genealogy — built from (parent → children)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {trace.data.backward.children.length === 0 ? (
                      <EmptyState message="No consumed components — raw/purchased lot or a unit without BOM binds" icon={Layers} />
                    ) : (
                      <TraceTreeNode node={trace.data.backward} />
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Boxes className="h-4 w-4 text-primary" /> Forward genealogy — used in (child → parents → shipping)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {trace.data.forward.children.length === 0 && trace.data.forward.shipping.length === 0 ? (
                      <EmptyState message="Not consumed by any build and not shipped" icon={Boxes} />
                    ) : (
                      <TraceTreeNode node={trace.data.forward} />
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* inspections bound to the lot */}
              {trace.data.quality.inspections.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Inspection evidence for {trace.data.query}</CardTitle></CardHeader>
                  <CardContent>
                    <DataTable<InspRow>
                      dense
                      maxHeight="max-h-56"
                      rows={trace.data.quality.inspections}
                      rowKey={(i) => i.inspNumber}
                      columns={[
                        { key: "num", header: "Insp #", render: (i) => <Mono className="text-primary">{i.inspNumber}</Mono> },
                        { key: "kind", header: "Kind", render: (i) => <Badge variant="outline" className="text-[10px]">{i.kind}{i.attempt > 1 ? ` · attempt ${i.attempt}` : ""}</Badge> },
                        { key: "status", header: "Result", render: (i) => <StatusBadge status={i.status} /> },
                        { key: "eq", header: "Equipment", render: (i) => <Mono>{i.equipmentCode || "—"}</Mono> },
                        { key: "at", header: "Submitted", render: (i) => <span className="text-[12px]">{fmtDT(i.submittedAt)}</span> },
                        { key: "note", header: "Note", render: (i) => <span className="text-[11px] text-muted-foreground truncate max-w-[320px] block">{i.retestReason || "—"}</span> },
                      ]}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ SCAN CONSOLE */}
      {tab === "scan" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-primary" /> Shop-floor scan console
                <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">keyboard-wedge simulator</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                onSubmit={(e) => { e.preventDefault(); runScan(); }}
                className="space-y-3"
              >
                <Input
                  ref={scanInputRef}
                  autoFocus
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  placeholder="▮ scan barcode / type serial-batch number…"
                  className="h-14 font-mono text-xl tracking-widest bg-input/60 border-primary/30 focus-visible:ring-primary/40"
                  aria-label="Barcode input"
                />
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5 w-[190px]">
                    <Label className="text-[11px]">Scan type</Label>
                    <Select value={scanType} onValueChange={setScanType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOT_INFO">LOT_INFO — identify</SelectItem>
                        <SelectItem value="VALIDATE_ISSUE">VALIDATE_ISSUE — pre-check</SelectItem>
                        <SelectItem value="MOVE">MOVE — transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {scanType === "VALIDATE_ISSUE" && (
                    <div className="space-y-1.5 w-[190px]">
                      <Label className="text-[11px]">Work order (optional)</Label>
                      <Input value={scanWo} onChange={(e) => setScanWo(e.target.value)} placeholder="WO-2025-0002" className="font-mono h-9" />
                    </div>
                  )}
                  {scanType === "MOVE" && (
                    <div className="space-y-1.5 w-[190px]">
                      <Label className="text-[11px]">To warehouse {canMove ? "" : "(needs inventory.move)"}</Label>
                      <Select value={scanToWh} onValueChange={setScanToWh}>
                        <SelectTrigger className={!canMove ? "opacity-60" : ""}><SelectValue /></SelectTrigger>
                        <SelectContent>{whOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  {scanType === "MOVE" && (
                    <p className="text-[11px] text-muted-foreground max-w-[200px]">Source warehouse is derived from the lot's current location; REJECTED / SHIPPED / SCRAPPED lots are blocked.</p>
                  )}
                  <Button type="submit" size="lg" className="ml-auto gap-1.5 min-w-[130px]" disabled={scanMutation.isPending}>
                    <ScanBarcode className="h-4 w-4" /> {scanMutation.isPending ? "Scanning…" : "Scan"}
                  </Button>
                </div>
              </form>

              {/* result banner */}
              {scanResult && (
                <div
                  className={cn(
                    "rounded-lg border p-3 space-y-2",
                    scanResult.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5",
                  )}
                  role="status"
                >
                  <div className="flex items-start gap-2.5">
                    {scanResult.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5" /> : <XCircle className="h-5 w-5 text-red-400 mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <p className={cn("font-medium text-[13px]", scanResult.ok ? "text-emerald-300" : "text-red-300")}>
                        {scanResult.ok ? `Scan ${scanResult.data?.scan} — SUCCESS` : "Scan FAILED"}
                      </p>
                      <p className="text-[12px] text-muted-foreground">{scanResult.ok ? scanResult.data?.reason : scanResult.error}</p>
                    </div>
                    {scanResult.ok && scanResult.data?.lot && (
                      <div className="text-right shrink-0">
                        <Mono className="font-semibold">{scanResult.data.lot.lotNumber}</Mono>
                        <p className="text-[11px] text-muted-foreground">
                          <StatusBadge status={scanResult.data.lot.status} className="h-4 px-1.5 py-0 text-[9px]" /> {scanResult.data.lot.warehouseCode}
                        </p>
                      </div>
                    )}
                  </div>
                  {scanResult.ok && scanResult.data?.checks && (
                    <div className="grid gap-1 pl-8">
                      {scanResult.data.checks.map((c) => (
                        <div key={c.check} className="flex items-center gap-2 text-[12px]">
                          {c.pass ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 text-red-400" />}
                          <span className={c.pass ? "text-foreground/90" : "text-red-300"}>{c.check}</span>
                          <span className="text-muted-foreground">{c.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {scanResult.ok && scanResult.data?.scan === "MOVE" && (
                    <p className="pl-8 text-[12px] text-muted-foreground">
                      Movement {scanResult.data.movementId?.slice(0, 10)}… · {scanResult.data.fromWh} <ArrowRightLeft className="inline h-3 w-3 mx-1" /> {scanResult.data.toWh}
                    </p>
                  )}
                  {scanResult.ok && scanResult.data?.genealogy && (
                    <p className="pl-8 text-[12px] text-muted-foreground">
                      genealogy: ↓{scanResult.data.genealogy.consumed} components · ↑{scanResult.data.genealogy.usedIn} parents
                    </p>
                  )}
                </div>
              )}

              {!canMove && scanType === "MOVE" && (
                <p className="text-[11px] text-amber-300">
                  Current role <Mono>{sessionUser?.role ?? "—"}</Mono> lacks <Mono>inventory.move</Mono> — MOVE scans will be rejected by the server. Switch to STORE_MGR in the topbar.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Recent scans (session)</CardTitle></CardHeader>
            <CardContent>
              {scanLog.length === 0 ? (
                <EmptyState message="No scans yet — try LOT_INFO with SN-NOX-25-0003" icon={ScanBarcode} />
              ) : (
                <div className="space-y-1.5 max-h-[52vh] overflow-y-auto erp-scroll pr-1">
                  {scanLog.map((l) => (
                    <div key={l.id} className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 p-2 text-[12px]">
                      {l.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[9px] font-mono">{l.type}</Badge>
                          <Mono className="font-semibold">{l.code}</Mono>
                        </div>
                        <p className={cn("text-[11px] truncate", l.ok ? "text-muted-foreground" : "text-red-300")} title={l.msg}>{l.msg}</p>
                      </div>
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{fmtDT(l.at)}</span>
                    </div>
                  ))}
                </div>
              )}
              <Separator className="my-3" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Scan semantics — <Mono>LOT_INFO</Mono>: identify any lot. <Mono>VALIDATE_ISSUE</Mono>: lot must be IN_STOCK in WH-ACC/WH-WIP (optionally matched against the typed WO's BOM). <Mono>MOVE</Mono>: creates an audited TRANSFER movement and updates the lot's warehouse; duplicate, malformed, unknown and wrong-status scans fail clearly with the reason.
              </p>
              <Button variant="ghost" size="sm" className="mt-2 h-7 text-[11px]" onClick={() => navigate("inventory", "lots")}>
                Open lot register
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
}
