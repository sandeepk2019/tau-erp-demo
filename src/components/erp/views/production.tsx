"use client";
// ============================================================================
// Tau ERP — Production Execution (Task 3-d)
// Work Orders (create / release / cancel / issue / receive / complete),
// Job Cards (start / pause / resume / complete, sequence-enforced),
// Electronic Traveller timeline + genealogy binds. Matches dashboard UI style.
// ============================================================================
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { FAMILIES, hasPerm, skillLabel } from "@/lib/erp/constants";
import {
  Column, DataTable, DateCell, EmptyState, KeyValue, Mono, Progress, SectionHeader,
  StatCard, StatusBadge, SubTabs, SyntheticBadge,
} from "../shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BadgeCheck, Ban, Boxes, CheckCircle2, Circle, Factory, FilePlus2, Link2, Lock, LucideIcon,
  PackageCheck, PackageMinus, Pause, Play, Plus, RotateCcw, ScanLine, Send, ShieldCheck,
  ScrollText, Wrench, ArrowRightLeft, Users,
} from "lucide-react";
import ShiftHandoverTab from "./production/shift-handover";
import SkillMatrixTab from "./production/skill-matrix";
import ScheduleBoard from "./production/schedule-board";

// ---------------------------------------------------------------------------
// Types (API payloads)
// ---------------------------------------------------------------------------
type WoRow = {
  id: string; woNumber: string; status: string; priority: string;
  qtyPlanned: number; qtyCompleted: number; qtyScrapped: number;
  dueDate: string | null; soNumber: string; familyCode: string;
  bomRevision: string; routeRevision: string; releasedBy: string; releasedAt: string | null;
  plannedStart: string | null;
  item: { partNumber: string; name: string; familyCode: string };
  jcTotal: number; jcDone: number;
};
type Stats = { openWOs: number; wipQty: number; completedThisMonth: number; blockedJobCards: number };
type FinishedItem = { id: string; partNumber: string; name: string; familyCode: string };
type WoListPayload = { wos: WoRow[]; stats: Stats; finishedItems: FinishedItem[] };

type JobCardT = {
  id: string; woNumber: string; woStatus: string; sequence: number;
  operationCode: string; workstationCode: string; status: string;
  qtyGood: number; qtyScrap: number; startedAt: string | null; completedAt: string | null;
  operator: string; mandatory: boolean; evidenceClass: string; inspectionTemplateCode: string;
  skillRequired: string;
};
type TravellerEventT = { id: string; kind: string; message: string; userName: string; createdAt: string };
type BomLineT = { id: string; qty: number; componentItem: { partNumber: string; name: string; trackingType: string; itemType: string } };
type RouteStepT = { id: string; seq: number; operationCode: string; workstationKind: string; mandatory: boolean; evidenceClass: string; skillRequired?: string };
type WoDetail = WoRow & {
  item: { partNumber: string; name: string; familyCode: string; trackingType: string; itemType: string; uom: string };
  bom: { revision: string; status: string; notes: string; lines: BomLineT[] } | null;
  route: { revision: string; status: string; name: string; steps: RouteStepT[] } | null;
  jobCards: (JobCardT & { operatorName: string })[];
  travellerEvents: TravellerEventT[];
  closedAt: string | null;
};
type GenealogyT = {
  id: string; operationCode: string; quantity: number; createdAt: string;
  parentLot: { lotNumber: string; status: string; warehouseCode: string; item: { partNumber: string } };
  childLot: { lotNumber: string; status: string; warehouseCode: string; item: { partNumber: string } };
};
type WoDetailPayload = { wo: WoDetail; genealogy: GenealogyT[] };
type JcPayload = {
  wo?: { woNumber: string; status: string; qtyPlanned: number; qtyCompleted: number; qtyScrapped: number };
  cards: JobCardT[];
};
export type SkillsPayload = {
  skills: { code: string; label: string }[];
  me: { username: string; name: string; role: string; skills: string[] } | null;
  matrix: { username: string; name: string; role: string; skills: string[] }[];
  stepDemands: { skill: string; operations: string[]; families: string[]; steps: number }[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fq = (n: number | null | undefined) => (n == null ? "0" : Number.isInteger(n) ? String(n) : n.toFixed(2));

function fmtDateTime(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function FamilyChip({ code }: { code: string }) {
  const f = FAMILIES.find((x) => x.code === code);
  if (!f) return <Badge variant="outline" className="text-[11px] text-muted-foreground">{code || "—"}</Badge>;
  return (
    <Badge
      variant="outline"
      className="text-[11px] font-medium"
      style={{ borderColor: `${f.color}55`, backgroundColor: `${f.color}1a`, color: f.color }}
    >
      {f.code}
    </Badge>
  );
}

function PriorityMark({ priority }: { priority: string }) {
  const cls = priority === "CRITICAL" ? "text-red-400" : priority === "HIGH" ? "text-amber-400" : "text-muted-foreground";
  return <span className={cn("text-[11px] font-medium tracking-wide", cls)}>{priority}</span>;
}

// ---------------------------------------------------------------------------
// Electronic Traveller — vertical event timeline (icon per event kind)
// ---------------------------------------------------------------------------
const EVENT_META: Record<string, { icon: LucideIcon; color: string }> = {
  CREATED: { icon: FilePlus2, color: "text-zinc-300" },
  RELEASED: { icon: Send, color: "text-emerald-400" },
  ISSUE: { icon: PackageMinus, color: "text-amber-400" },
  SCAN: { icon: ScanLine, color: "text-amber-300" },
  OP_START: { icon: Play, color: "text-amber-400" },
  OP_PAUSE: { icon: Pause, color: "text-orange-400" },
  OP_RESUME: { icon: RotateCcw, color: "text-teal-300" },
  OP_COMPLETE: { icon: CheckCircle2, color: "text-emerald-400" },
  BIND: { icon: Link2, color: "text-teal-300" },
  FG_RECEIPT: { icon: PackageCheck, color: "text-emerald-400" },
  QUALITY: { icon: BadgeCheck, color: "text-teal-300" },
  RELEASE: { icon: ShieldCheck, color: "text-emerald-400" },
  BLOCK: { icon: Ban, color: "text-red-400" },
};

function TravellerTimeline({ events }: { events: TravellerEventT[] }) {
  if (!events.length) return <EmptyState message="No traveller events yet" icon={ScrollText} />;
  return (
    <div className="relative pl-7 space-y-3.5 max-h-[42vh] overflow-y-auto erp-scroll pr-1">
      <div className="absolute left-[10px] top-1.5 bottom-1.5 w-px bg-border/70" aria-hidden />
      {events.map((e) => {
        const meta = EVENT_META[e.kind] ?? { icon: Circle, color: "text-muted-foreground" };
        const Icon = meta.icon;
        return (
          <div key={e.id} className="relative">
            <div className="absolute -left-7 top-0 rounded-full bg-zinc-900 border border-border/80 p-[3px]">
              <Icon className={cn("h-3 w-3", meta.color)} aria-hidden />
            </div>
            <p className="text-[12.5px] leading-snug">{e.message}</p>
            <p className="text-[10.5px] text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground/70">{e.kind.replace(/_/g, " ")}</span>
              {" · "}{e.userName || "system"}{" · "}{fmtDateTime(e.createdAt)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create WO dialog
// ---------------------------------------------------------------------------
function CreateWoDialog({
  onClose, items, onCreate, pending,
}: {
  onClose: () => void; items: FinishedItem[];
  onCreate: (payload: Record<string, unknown>) => void; pending: boolean;
}) {
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [so, setSo] = useState("");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Work Order</DialogTitle>
          <DialogDescription>
            Server resolves the latest <span className="text-foreground">RELEASED</span> BOM + route for the item family —
            draft/obsolete engineering blocks creation (spec release blocker). Status starts at CREATED.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-[12px]">Finished item (FINISHED only)</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select finished item…" /></SelectTrigger>
              <SelectContent className="max-h-72 erp-scroll">
                {items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    <span className="font-mono text-[12px]">{it.partNumber}</span>
                    <span className="text-muted-foreground text-[12px]"> — {it.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Quantity planned</Label>
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["LOW", "NORMAL", "HIGH", "CRITICAL"].map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Sales order (optional)</Label>
              <Input value={so} onChange={(e) => setSo(e.target.value)} placeholder="SO-2025-…" className="h-9 font-mono text-[12px]" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!itemId || pending}
            onClick={() => onCreate({
              itemId,
              qtyPlanned: Math.max(1, Math.floor(Number(qty) || 0)),
              dueDate: dueDate || undefined,
              priority,
              soNumber: so.trim() || undefined,
            })}
          >
            Create WO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Complete job-card dialog (qtyGood / qtyScrap)
// ---------------------------------------------------------------------------
function CompleteCardDialog({
  card, remaining, onClose, onSubmit, pending,
}: {
  card: JobCardT; remaining: number; onClose: () => void;
  onSubmit: (qtyGood: number, qtyScrap: number) => void; pending: boolean;
}) {
  const [good, setGood] = useState(String(Math.max(0, remaining)));
  const [scrap, setScrap] = useState("0");
  const g = Math.max(0, Number(good) || 0);
  const s = Math.max(0, Number(scrap) || 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Complete operation</DialogTitle>
          <DialogDescription>
            <Mono>{card.woNumber}</Mono> · step {card.sequence} · <Mono>{card.operationCode}</Mono> at {card.workstationCode || "unassigned"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[12px]">Qty good</Label>
            <Input type="number" min={0} value={good} onChange={(e) => setGood(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Qty scrap</Label>
            <Input type="number" min={0} value={scrap} onChange={(e) => setScrap(e.target.value)} className="h-9" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Remaining unaccounted WO qty: <span className="tabular text-foreground">{fq(remaining)}</span> · good + scrap must not exceed it.
          Completion timestamp is server-generated (backdating impossible).
        </p>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={pending || g + s <= 0 || g + s > remaining} onClick={() => onSubmit(g, s)}>
            Complete step {card.sequence}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// WO detail dialog — key values, BOM/route revisions, actions, traveller, genealogy
// ---------------------------------------------------------------------------
function WoDetailDialog({
  woNumber, onClose, onAction, pending, canRelease, canExecute, canMove,
}: {
  woNumber: string; onClose: () => void;
  onAction: (action: string, extra?: Record<string, unknown>) => void; pending: boolean;
  canRelease: boolean; canExecute: boolean; canMove: boolean;
}) {
  const q = useQuery<WoDetailPayload>({
    queryKey: ["wo", woNumber],
    queryFn: () => api<WoDetailPayload>(`/api/work-orders?wo=${encodeURIComponent(woNumber)}`),
    enabled: !!woNumber,
  });
  const [issueLot, setIssueLot] = useState("");
  const [recvQty, setRecvQty] = useState("1");
  const wo = q.data?.wo;
  const genealogy = q.data?.genealogy ?? [];
  const active = !!wo && ["RELEASED", "IN_PROGRESS"].includes(wo.status);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Mono className="text-primary text-[15px]">{woNumber}</Mono>
            {wo && <StatusBadge status={wo.status} />}
            {wo && <PriorityMark priority={wo.priority} />}
            {wo && <FamilyChip code={wo.familyCode} />}
          </DialogTitle>
          <DialogDescription>
            {wo ? `${fq(wo.qtyPlanned)} × ${wo.item.partNumber} — ${wo.item.name}` : "Loading work order…"}
          </DialogDescription>
        </DialogHeader>

        {!wo && <div className="h-32 rounded bg-muted animate-pulse" />}

        {wo && (
          <div className="space-y-4">
            {/* KEY VALUES */}
            <KeyValue
              items={[
                { k: "Quantity (planned / done / scrap)", v: <span className="tabular">{fq(wo.qtyPlanned)} / <span className="text-emerald-400">{fq(wo.qtyCompleted)}</span> / <span className={wo.qtyScrapped ? "text-red-400" : ""}>{fq(wo.qtyScrapped)}</span></span> },
                { k: "Sales order", v: wo.soNumber ? <Mono>{wo.soNumber}</Mono> : <span className="text-muted-foreground">—</span> },
                { k: "Due date", v: <DateCell value={wo.dueDate} /> },
                { k: "BOM revision", v: wo.bom ? <span className="flex items-center gap-1.5"><Mono>rev {wo.bom.revision}</Mono><StatusBadge status={wo.bom.status} /></span> : "—" },
                { k: "Route revision", v: wo.route ? <span className="flex items-center gap-1.5"><Mono>rev {wo.route.revision}</Mono><StatusBadge status={wo.route.status} /></span> : "—" },
                { k: "Released by", v: wo.releasedBy ? <span>{wo.releasedBy} · {fmtDateTime(wo.releasedAt)}</span> : <span className="text-muted-foreground">not released</span> },
                { k: "Planned start", v: wo.plannedStart ? fmtDateTime(wo.plannedStart) : <span className="text-muted-foreground">—</span> },
                { k: "Closed", v: wo.closedAt ? fmtDateTime(wo.closedAt) : <span className="text-muted-foreground">—</span> },
              ]}
            />

            {/* PROGRESS */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Completion</span>
                <span className="tabular">{wo.qtyPlanned ? Math.round((wo.qtyCompleted / wo.qtyPlanned) * 100) : 0}%</span>
              </div>
              <Progress value={wo.qtyPlanned ? (wo.qtyCompleted / wo.qtyPlanned) * 100 : 0} tone={wo.qtyCompleted >= wo.qtyPlanned && wo.qtyPlanned > 0 ? "good" : "primary"} />
            </div>

            {/* BOM + ROUTE */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Card>
                <CardHeader className="pb-1.5 pt-3 px-3">
                  <CardTitle className="text-[12px] flex items-center justify-between">
                    BOM lines {wo.bom && <StatusBadge status={wo.bom.status} />}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 pt-0 max-h-40 overflow-y-auto erp-scroll">
                  {wo.bom ? (
                    <ul className="space-y-1">
                      {wo.bom.lines.map((l) => (
                        <li key={l.id} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                          <Mono className="text-foreground/90">{l.componentItem.partNumber}</Mono>
                          <span className="text-muted-foreground tabular">× {fq(l.qty)} · {l.componentItem.trackingType}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">No BOM linked</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1.5 pt-3 px-3">
                  <CardTitle className="text-[12px] flex items-center justify-between">
                    Route steps {wo.route && <StatusBadge status={wo.route.status} />}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 pt-0 max-h-40 overflow-y-auto erp-scroll">
                  {wo.route ? (
                    <ul className="space-y-1">
                      {wo.route.steps.map((s) => (
                        <li key={s.id} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                          <span className="tabular text-muted-foreground">#{s.seq}</span>
                          <Mono className="text-foreground/90 flex-1 ml-2">{s.operationCode}</Mono>
                          {s.skillRequired ? (
                            <span className="rounded-full border border-border/70 bg-background/60 px-1.5 py-px text-[9.5px] text-muted-foreground" title={`DR-006 skill required: ${skillLabel(s.skillRequired)}`}>
                              {s.skillRequired}
                            </span>
                          ) : null}
                          <span className="text-[10px] text-muted-foreground">{s.workstationKind}{s.mandatory ? " · mandatory" : ""}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">No route linked</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ACTIONS */}
            {wo.status !== "COMPLETED" && wo.status !== "CANCELLED" && (
              <div className="rounded-lg border bg-background/40 p-3 space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Shop-floor actions — server-enforced RBAC &amp; transitions</p>
                <div className="flex flex-wrap items-center gap-2">
                  {wo.status === "CREATED" && canRelease && (
                    <Button size="sm" disabled={pending} onClick={() => onAction("release")}>
                      <Send className="h-3.5 w-3.5" /> Release WO
                    </Button>
                  )}
                  {(wo.status === "CREATED" || wo.status === "RELEASED") && canRelease && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction("cancel")}>Cancel WO</Button>
                  )}
                  {active && (canMove || canRelease) && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={issueLot}
                        onChange={(e) => setIssueLot(e.target.value)}
                        placeholder="Component lot e.g. B-PP8812"
                        className="h-8 w-52 font-mono text-[12px]"
                      />
                      <Button size="sm" variant="outline" disabled={pending || !issueLot.trim()} onClick={() => { onAction("issue-material", { lotNumber: issueLot.trim() }); setIssueLot(""); }}>
                        Issue material
                      </Button>
                    </div>
                  )}
                  {active && (canExecute || canMove) && (
                    <div className="flex items-center gap-1.5">
                      <Input type="number" min={1} value={recvQty} onChange={(e) => setRecvQty(e.target.value)} className="h-8 w-16" aria-label="FG qty" />
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction("receive-fg", { qty: Math.max(1, Math.floor(Number(recvQty) || 0)) })}>
                        Receive FG
                      </Button>
                    </div>
                  )}
                  {active && canRelease && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => onAction("complete-wo")}>Complete WO</Button>
                  )}
                </div>
                <p className="text-[10.5px] text-muted-foreground">
                  Issue demo: <Mono>B-PP8812</Mono> (housing — in BOM) is accepted; <Mono>B-BC2411A</Mono> (ceramic element — not in this BOM) is rejected with
                  “Component not in BOM for this WO”. Receive FG is blocked until every mandatory operation is complete (spec release blocker).
                </p>
              </div>
            )}

            {/* JOB CARDS STRIP */}
            {wo.jobCards.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Job cards — {wo.jobCards.filter((c) => c.status === "COMPLETED").length}/{wo.jobCards.length} completed
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {wo.jobCards.map((c) => (
                    <div key={c.id} className="rounded border border-border/60 bg-background/40 px-2 py-1 flex items-center gap-1.5 text-[11px]">
                      <span className="text-muted-foreground tabular">#{c.sequence}</span>
                      <Mono>{c.operationCode}</Mono>
                      <StatusBadge status={c.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ELECTRONIC TRAVELLER */}
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Electronic Traveller — event timeline</p>
              <TravellerTimeline events={wo.travellerEvents} />
            </div>

            {/* GENEALOGY BINDS */}
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-teal-300" /> Genealogy binds for this WO
              </p>
              <DataTable<GenealogyT>
                maxHeight="max-h-56"
                columns={[
                  { key: "fg", header: "FG / parent serial", render: (r) => <Mono className="text-primary">{r.parentLot.lotNumber}</Mono> },
                  { key: "child", header: "Component lot", render: (r) => (<span><Mono>{r.childLot.lotNumber}</Mono> <span className="text-[10.5px] text-muted-foreground ml-1">{r.childLot.item.partNumber}</span></span>) },
                  { key: "op", header: "Operation", render: (r) => r.operationCode ? <Mono>{r.operationCode}</Mono> : <span className="text-muted-foreground text-[11px]">—</span> },
                  { key: "qty", header: "Qty", render: (r) => <span className="tabular text-[12px]">{fq(r.quantity)}</span> },
                  { key: "status", header: "Lot status", render: (r) => <StatusBadge status={r.childLot.status} /> },
                ]}
                rows={genealogy}
                rowKey={(r) => r.id}
                emptyMessage="No genealogy binds yet — receive finished goods to bind serial subassemblies"
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export default function ProductionView() {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const sessionUser = useErpStore((s) => s.sessionUser);
  const route = useErpStore((s) => s.route);

  const [tab, setTab] = useState(["shifts", "skills", "schedule"].includes(route.tab ?? "") ? route.tab : "wos");
  React.useEffect(() => {
    if (route.tab) setTab(route.tab);
  }, [route.tab]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [detailWo, setDetailWo] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [jcWo, setJcWo] = useState("active");
  const [completeCard, setCompleteCard] = useState<JobCardT | null>(null);

  const canRelease = hasPerm(sessionUser?.role, "production.release");
  const canExecute = hasPerm(sessionUser?.role, "production.execute");
  const canMove = hasPerm(sessionUser?.role, "inventory.move");
  const canCreate = canRelease || hasPerm(sessionUser?.role, "planning.run");

  // Queries — ["work-orders"], ["wo", woNumber], ["job-cards", woNumber]
  const listQ = useQuery<WoListPayload>({
    queryKey: ["work-orders", statusFilter],
    queryFn: () => api<WoListPayload>(`/api/work-orders?status=${statusFilter}`),
  });
  const jcQ = useQuery<JcPayload>({
    queryKey: ["job-cards", jcWo],
    queryFn: () => api<JcPayload>(jcWo === "active" ? "/api/job-cards" : `/api/job-cards?wo=${encodeURIComponent(jcWo)}`),
  });
  const shiftsQ = useQuery<{ shifts: { id: string; status: string }[] }>({
    queryKey: ["shifts"],
    queryFn: () => api<{ shifts: { id: string; status: string }[] }>("/api/shifts"),
    staleTime: 30_000,
  });
  const skillsQ = useQuery<SkillsPayload>({
    queryKey: ["skills"],
    queryFn: () => api<SkillsPayload>("/api/skills"),
    staleTime: 15_000,
  });
  const shiftsCount = (shiftsQ.data?.shifts ?? []).length;
  const openHandovers = (shiftsQ.data?.shifts ?? []).filter((s) => s.status === "OPEN").length;

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["work-orders"] });
    if (detailWo) void qc.invalidateQueries({ queryKey: ["wo", detailWo] });
    void qc.invalidateQueries({ queryKey: ["job-cards"] });
  };

  // Mutations
  const createWo = useMutation<unknown, Error, Record<string, unknown>>({
    mutationFn: (p) => api("/api/work-orders", { body: p }),
    onSuccess: () => { toast("Work order created — status CREATED"); setCreateOpen(false); void qc.invalidateQueries({ queryKey: ["work-orders"] }); },
    onError: (e) => toast(e.message, "err"),
  });
  const woAction = useMutation<unknown, Error, { woNumber: string; action: string; lotNumber?: string; qty?: number }>({
    mutationFn: (p) => api("/api/work-orders/action", { body: p }),
    onSuccess: (data, vars) => {
      const d = data as { serials?: string[]; jobCardsCreated?: number };
      if (vars.action === "receive-fg" && d.serials?.length) toast(`FG received into WH-FG: ${d.serials.join(", ")}`);
      else if (vars.action === "release") toast(`WO released — ${d.jobCardsCreated ?? 0} job cards generated`);
      else if (vars.action === "issue-material") toast("Component lot issued to WH-WIP (ISSUE_TO_WO recorded)");
      else toast(`${vars.action.replace(/-/g, " ")} → ${vars.woNumber} recorded`);
      invalidateAll();
    },
    onError: (e) => toast(e.message, "err"),
  });
  const jcAction = useMutation<unknown, Error, { jobCardId: string; action: string; qtyGood?: number; qtyScrap?: number }>({
    mutationFn: (p) => api("/api/job-cards", { body: p }),
    onSuccess: (_d, vars) => {
      toast(`Operation ${vars.action} recorded (server timestamp)`);
      setCompleteCard(null);
      invalidateAll();
    },
    onError: (e) => toast(e.message, "err"),
  });

  const wos = listQ.data?.wos ?? [];
  const cards = jcQ.data?.cards ?? [];
  const stats = listQ.data?.stats;
  const mySkills = skillsQ.data?.me?.skills ?? [];
  const qualifiedFor = (skill: string) => !skill || mySkills.includes(skill);

  const openWoOptions = useMemo(
    () => wos.filter((w) => ["RELEASED", "IN_PROGRESS"].includes(w.status)),
    [wos],
  );

  const completeRemaining = useMemo(() => {
    if (!completeCard) return 0;
    const wo = wos.find((w) => w.woNumber === completeCard.woNumber);
    return wo ? wo.qtyPlanned - wo.qtyCompleted - wo.qtyScrapped : 0;
  }, [completeCard, wos]);

  // Work Orders table
  const woColumns: Column<WoRow>[] = [
    { key: "woNumber", header: "Work Order", render: (r) => <Mono className="text-primary font-semibold">{r.woNumber}</Mono> },
    {
      key: "item", header: "Item",
      render: (r) => (
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium">{r.item.partNumber}</div>
          <div className="text-[11px] text-muted-foreground truncate max-w-[190px]">{r.item.name}</div>
        </div>
      ),
    },
    { key: "family", header: "Family", render: (r) => <FamilyChip code={r.familyCode} /> },
    {
      key: "qty", header: "Qty P / C / S",
      render: (r) => (
        <div className="min-w-[110px]">
          <div className="tabular text-[12px]">
            {fq(r.qtyPlanned)} / <span className="text-emerald-400">{fq(r.qtyCompleted)}</span>{" / "}
            <span className={r.qtyScrapped > 0 ? "text-red-400" : "text-muted-foreground"}>{fq(r.qtyScrapped)}</span>
          </div>
          <div className="mt-1">
            <Progress
              value={r.qtyPlanned ? (r.qtyCompleted / r.qtyPlanned) * 100 : 0}
              tone={r.qtyPlanned > 0 && r.qtyCompleted >= r.qtyPlanned ? "good" : "primary"}
            />
          </div>
        </div>
      ),
    },
    { key: "ops", header: "Ops", render: (r) => <span className="tabular text-[11px] text-muted-foreground">{r.jcDone}/{r.jcTotal}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "priority", header: "Priority", render: (r) => <PriorityMark priority={r.priority} /> },
    {
      key: "due", header: "Due",
      render: (r) => {
        const overdue = r.dueDate && new Date(r.dueDate) < new Date() && !["COMPLETED", "CANCELLED", "CLOSED"].includes(r.status);
        return <span className={cn(overdue && "text-red-400")}><DateCell value={r.dueDate} /></span>;
      },
    },
    { key: "so", header: "SO", render: (r) => (r.soNumber ? <Mono>{r.soNumber}</Mono> : <span className="text-muted-foreground">—</span>) },
  ];

  // Job cards table
  const jcColumns: Column<JobCardT>[] = [
    { key: "wo", header: "WO", render: (c) => <Mono className="text-primary">{c.woNumber}</Mono> },
    { key: "seq", header: "Seq", render: (c) => <span className="tabular text-[12px]">{c.sequence}</span> },
    {
      key: "op", header: "Operation",
      render: (c) => (
        <span>
          <Mono>{c.operationCode}</Mono>{" "}
          <span className={cn("text-[9px] tracking-wide", c.mandatory ? "text-amber-400" : "text-muted-foreground")}>
            {c.mandatory ? "MANDATORY" : "optional"}
          </span>
        </span>
      ),
    },
    {
      key: "ws", header: "Workstation",
      render: (c) => (c.workstationCode ? <Mono>{c.workstationCode}</Mono> : <span className="text-[11px] text-muted-foreground">unassigned</span>),
    },
    {
      key: "skill", header: "Skill (DR-006)",
      render: (c) =>
        c.skillRequired ? (
          <span
            title={`${skillLabel(c.skillRequired)} — start/resume blocked unless you hold this skill`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide",
              qualifiedFor(c.skillRequired)
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/40 bg-red-500/10 text-red-300",
            )}
          >
            {qualifiedFor(c.skillRequired) ? <BadgeCheck className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {c.skillRequired}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        ),
    },
    { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
    {
      key: "qty", header: "Good / Scrap",
      render: (c) => (
        <span className="tabular text-[12px]">
          {fq(c.qtyGood)} / <span className={c.qtyScrap > 0 ? "text-red-400" : "text-muted-foreground"}>{fq(c.qtyScrap)}</span>
        </span>
      ),
    },
    { key: "operator", header: "Operator", render: (c) => (c.operator ? <span className="text-[12px]">{c.operator}</span> : <span className="text-[11px] text-muted-foreground">—</span>) },
    { key: "started", header: "Started", render: (c) => <span className="text-[11px] tabular">{c.startedAt ? fmtDateTime(c.startedAt) : "—"}</span> },
    { key: "completed", header: "Completed", render: (c) => <span className="text-[11px] tabular">{c.completedAt ? fmtDateTime(c.completedAt) : "—"}</span> },
    {
      key: "actions", header: "Actions",
      render: (c) =>
        canExecute ? (
          <div className="flex gap-1">
            {c.status === "READY" && (
              qualifiedFor(c.skillRequired) ? (
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={jcAction.isPending} onClick={() => jcAction.mutate({ jobCardId: c.id, action: "start" })}>
                  Start
                </Button>
              ) : (
                <Button
                  size="sm" variant="outline" disabled
                  className="h-7 px-2 text-[11px] opacity-60 cursor-not-allowed"
                  title={`DR-006: requires skill ${c.skillRequired} (${skillLabel(c.skillRequired)}) — you hold [${mySkills.join(", ") || "none"}]. Update the skill matrix (Production → Skill Matrix).`}
                  onClick={() => toast(`Route qualification (DR-006): ${c.operationCode} needs skill ${c.skillRequired} — update the skill matrix first.`, "err")}
                >
                  <Lock className="h-3 w-3" /> Start
                </Button>
              )
            )}
            {c.status === "IN_PROGRESS" && (
              <>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={jcAction.isPending} onClick={() => jcAction.mutate({ jobCardId: c.id, action: "pause" })}>
                  Pause
                </Button>
                <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => setCompleteCard(c)}>
                  Complete
                </Button>
              </>
            )}
            {c.status === "PAUSED" && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={jcAction.isPending} onClick={() => jcAction.mutate({ jobCardId: c.id, action: "resume" })}>
                Resume
              </Button>
            )}
            {c.status === "COMPLETED" && <span className="text-[10px] text-muted-foreground self-center">done</span>}
            {c.status === "PENDING" && <span className="text-[10px] text-muted-foreground self-center">waiting</span>}
            {c.status === "BLOCKED" && <span className="text-[10px] text-red-400 self-center">blocked</span>}
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground">needs production.execute</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Factory}
        title="Production Execution"
        desc="Work orders · job cards · electronic traveller — spec §Production execution"
        actions={
          <>
            <SyntheticBadge />
            {canCreate && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Create WO
              </Button>
            )}
          </>
        }
      />

      {/* STAT CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Open Work Orders" value={stats?.openWOs ?? "—"} sub="created + released + in progress" icon={Factory} />
        <StatCard label="WIP Quantity" value={stats ? fq(stats.wipQty) : "—"} sub="planned − completed on IN_PROGRESS WOs" icon={Boxes} tone="warn" />
        <StatCard label="Completed (month)" value={stats ? fq(stats.completedThisMonth) : "—"} sub="units on WOs closed this month" icon={CheckCircle2} tone="good" />
        <StatCard
          label="Blocked Job Cards"
          value={stats?.blockedJobCards ?? "—"}
          sub={stats && stats.blockedJobCards > 0 ? "need supervisor attention" : "none blocked"}
          icon={Ban}
          tone={stats && stats.blockedJobCards > 0 ? "bad" : "default"}
        />
        <StatCard
          label="Open Handovers"
          value={shiftsQ.isLoading ? "—" : openHandovers}
          sub={openHandovers > 0 ? "awaiting incoming-shift ack" : "all shifts acknowledged"}
          icon={ArrowRightLeft}
          tone={openHandovers > 0 ? "warn" : "good"}
          onClick={() => setTab("shifts")}
        />
      </div>

      <SubTabs
        tabs={[
          { key: "wos", label: "Work Orders", count: wos.length },
          { key: "jc", label: "Job Cards", count: cards.length },
          { key: "schedule", label: "Schedule", count: openWoOptions.length },
          { key: "shifts", label: "Shift Handover", count: shiftsCount },
          { key: "skills", label: "Skill Matrix", count: skillsQ.data?.matrix.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "shifts" && <ShiftHandoverTab sessionUser={sessionUser} />}

      {tab === "skills" && <SkillMatrixTab sessionUser={sessionUser} skillsQ={skillsQ} />}

      {tab === "schedule" && (
        <ScheduleBoard
          wos={wos}
          loading={listQ.isLoading}
          onOpenWo={(n) => setDetailWo(n)}
        />
      )}

      {tab === "wos" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {["CREATED", "RELEASED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((s) => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Click a work order for BOM/route revisions, shop-floor actions, traveller timeline &amp; genealogy.
            </p>
          </div>
          <DataTable<WoRow>
            columns={woColumns}
            rows={wos}
            loading={listQ.isLoading}
            onRowClick={(r) => setDetailWo(r.woNumber)}
            rowKey={(r) => r.id}
            emptyMessage="No work orders match this filter"
          />
        </div>
      )}

      {tab === "jc" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={jcWo} onValueChange={setJcWo}>
              <SelectTrigger className="h-8 w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">All active WOs (IN_PROGRESS)</SelectItem>
                {openWoOptions.map((w) => (
                  <SelectItem key={w.id} value={w.woNumber}>
                    <span className="font-mono text-[12px]">{w.woNumber}</span>
                    <span className="text-muted-foreground text-[12px]"> — {w.item.partNumber} ({w.status})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {jcQ.data?.wo && (
              <p className="text-[11px] text-muted-foreground">
                <Mono className="text-primary">{jcQ.data.wo.woNumber}</Mono>
                {" "}· planned {fq(jcQ.data.wo.qtyPlanned)} · completed {fq(jcQ.data.wo.qtyCompleted)} · scrapped {fq(jcQ.data.wo.qtyScrapped)}
              </p>
            )}
          </div>
          <DataTable<JobCardT>
            columns={jcColumns}
            rows={cards}
            loading={jcQ.isLoading}
            rowKey={(c) => c.id}
            emptyMessage={WrenchEmpty}
          />
          <p className="text-[10.5px] text-muted-foreground">
            Sequence rule: a step can start only when every previous mandatory step is COMPLETED (server-enforced —
            “Operation sequence enforced: complete step N first”). Operators can only act on workstation-assigned cards.
            Route qualification (DR-006): start/resume of a skill-tagged operation is server-blocked unless your user holds
            that skill. All timestamps are server-generated; backdated posting is impossible (audit note).
          </p>
        </div>
      )}

      {/* DIALOGS */}
      {detailWo && (
        <WoDetailDialog
          woNumber={detailWo}
          onClose={() => setDetailWo(null)}
          onAction={(action, extra) => woAction.mutate({ woNumber: detailWo, action, ...extra })}
          pending={woAction.isPending}
          canRelease={canRelease}
          canExecute={canExecute}
          canMove={canMove}
        />
      )}
      {createOpen && (
        <CreateWoDialog
          onClose={() => setCreateOpen(false)}
          items={listQ.data?.finishedItems ?? []}
          onCreate={(p) => createWo.mutate(p)}
          pending={createWo.isPending}
        />
      )}
      {completeCard && (
        <CompleteCardDialog
          key={completeCard.id}
          card={completeCard}
          remaining={completeRemaining}
          onClose={() => setCompleteCard(null)}
          onSubmit={(g, s) => jcAction.mutate({ jobCardId: completeCard.id, action: "complete", qtyGood: g, qtyScrap: s })}
          pending={jcAction.isPending}
        />
      )}
    </div>
  );
}

const WrenchEmpty = "No job cards — release a work order to generate cards from its route steps";
