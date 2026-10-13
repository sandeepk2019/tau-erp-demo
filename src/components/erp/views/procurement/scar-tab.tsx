"use client";
// ============================================================================
// Tau ERP — Supplier Quality (SCAR) tab for the Procurement module.
// Supplier Corrective Action Requests: auto-raised on IQC FAIL (rejected GRN)
// or raised manually. Lifecycle OPEN → UNDER_REVIEW → VERIFICATION → CLOSED
// (four-eyes closure) with CANCELLED escape hatch. Audited server-side.
// API: /api/scars
// ============================================================================
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import {
  DataTable, DateCell, KeyValue, Mono, StatusBadge, StatCard,
  type Column,
} from "../../shared";
import { hasPerm } from "@/lib/erp/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle, BadgeAlert, Building2, Camera, CheckCheck, CircleSlash, FileCheck2, FileWarning, FlaskConical,
  Handshake, Mail, MessageSquareWarning, Paperclip, Plus, Printer, Search, ShieldCheck, Upload, X,
} from "lucide-react";
import SupplierPortalDialog from "./supplier-portal-dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScarRow = {
  id: string; scarNumber: string; supplierId: string; grnNumber: string; inspectionRef: string;
  lotNumbers: string[]; partSummary: string; defectDescription: string; severity: string;
  containment: string; responseDue: string | null; supplierResponse: string; respondedAt: string | null;
  status: string; raisedBy: string; closedBy: string; closedAt: string | null; createdAt: string;
  evidence: { name: string; size: number; kind: string; uploadedBy: string; uploadedAt: string }[];
  supplier: { code: string; name: string; category: string; approved: boolean; rating: number } | null;
};

export type ScarsPayload = {
  scars: ScarRow[];
  stats: { total: number; open: number; criticalOpen: number; overdueResponse: number; closed: number };
  scarByGrn: Record<string, { scarNumber: string; status: string; severity: string }>;
  suppliers: { id: string; code: string; name: string; category: string; approved: boolean; rating: number }[];
  items: { id: string; partNumber: string; name: string; uom: string }[];
  rejectedLines: { grnLineId: string; grnNumber: string; supplierId: string; itemId: string; qty: number; supplierBatch: string }[];
  canManage: boolean;
  canClose: boolean;
  me: string;
};

const LIFECYCLE = [
  { key: "OPEN", hint: "Raised — supplier response awaited" },
  { key: "UNDER_REVIEW", hint: "Supplier response received — buyer evaluating the action plan" },
  { key: "VERIFICATION", hint: "Action plan accepted — effectiveness evidence being verified" },
  { key: "CLOSED", hint: "Corrective action verified (four-eyes closure)" },
] as const;

function statusIndex(s: string) {
  return LIFECYCLE.findIndex((l) => l.key === s);
}

/** Flow strip: OPEN → UNDER_REVIEW → VERIFICATION → CLOSED (CANCELLED shown separately). */
function LifecycleStrip({ status }: { status: string }) {
  if (status === "CANCELLED") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-[12px] text-muted-foreground">
        <CircleSlash className="h-3.5 w-3.5 text-zinc-500" /> Cancelled — no further lifecycle actions.
      </div>
    );
  }
  const idx = statusIndex(status);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {LIFECYCLE.map((l, i) => (
        <React.Fragment key={l.key}>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
              i < idx ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : i === idx ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border/60 text-muted-foreground"
            }`}
            title={l.hint}
          >
            {l.key.replace(/_/g, " ")}
          </span>
          {i < LIFECYCLE.length - 1 && <span className={`text-[10px] ${i < idx ? "text-emerald-400" : "text-zinc-600"}`}>→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence (D7 effectiveness) — metadata-only mock upload (round 10)
// ---------------------------------------------------------------------------

const EVIDENCE_KINDS = ["PHOTO", "TEST_REPORT", "COC", "CORRESPONDENCE", "OTHER"] as const;
const EVIDENCE_ICON: Record<string, React.ElementType> = {
  PHOTO: Camera,
  TEST_REPORT: FlaskConical,
  COC: FileCheck2,
  CORRESPONDENCE: Mail,
  OTHER: Paperclip,
};

function fmtSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function EvidenceSection({ scar, canManage }: { scar: ScarRow; canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const [kind, setKind] = useState<string>("TEST_REPORT");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const active = scar.status !== "CLOSED" && scar.status !== "CANCELLED";

  const act = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api("/api/scars", { method: "POST", body: payload }),
    onSuccess: (_d, payload) => {
      qc.invalidateQueries({ queryKey: ["scars"] });
      toast(String(payload.action) === "attach-evidence" ? "Evidence attached (audited, metadata-only)" : "Evidence entry removed (audited)");
      setErr("");
    },
    onError: (e: Error) => {
      setErr(e.message);
      toast(e.message, "err");
    },
  });

  const onFile = async (f: File | null) => {
    if (!f) return;
    setBusy(true);
    try {
      await act.mutateAsync({ action: "attach-evidence", id: scar.id, name: f.name, size: f.size, kind });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <FileCheck2 className="h-3.5 w-3.5" /> Effectiveness evidence (D7)
          <span className="rounded-full border border-border/60 px-1.5 py-px text-[9.5px] font-normal normal-case tracking-normal tabular">{scar.evidence.length}/12</span>
          {scar.status === "VERIFICATION" && scar.evidence.length === 0 && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[9.5px] font-normal normal-case tracking-normal text-amber-300">no evidence yet — attach before closure</span>
          )}
        </p>
        {canManage && active && (
          <span className="flex items-center gap-1.5">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-7 w-[130px] text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVIDENCE_KINDS.map((k) => <SelectItem key={k} value={k}>{k.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <label
              className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 text-[11px] text-primary transition-colors hover:bg-primary/20"
              title="Attach effectiveness evidence — metadata-only placeholder (synthetic demo, documents are not stored)"
            >
              <Upload className="h-3 w-3" /> {busy ? "Attaching…" : "Attach file"}
              <input type="file" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; void onFile(f); }} />
            </label>
          </span>
        )}
      </div>
      {scar.evidence.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 p-2.5 text-[12px] text-muted-foreground">
          No evidence attached yet — D7 verification typically needs photos, re-inspection reports or CoCs demonstrating the corrective action held.
        </p>
      ) : (
        <div className="space-y-1.5">
          {scar.evidence.map((ev, i) => {
            const Icon = EVIDENCE_ICON[ev.kind] ?? Paperclip;
            return (
              <div key={`${ev.name}-${i}`} className="flex items-center gap-2.5 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 transition-colors hover:border-primary/30">
                <span className="rounded-md bg-primary/10 p-1.5 shrink-0"><Icon className="h-3.5 w-3.5 text-primary" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">{ev.name}</p>
                  <p className="text-[10.5px] text-muted-foreground">
                    <span className="rounded bg-muted px-1 py-px font-mono text-[9.5px] uppercase">{ev.kind}</span>{" "}
                    {fmtSize(ev.size)} · <span className="font-mono">{ev.uploadedBy}</span> · {new Date(ev.uploadedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                  </p>
                </div>
                {canManage && active && (
                  <button
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                    title="Remove evidence entry (audited)"
                    onClick={() => act.mutate({ action: "remove-evidence", id: scar.id, index: i })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-1.5 text-[10px] text-muted-foreground">Metadata-only placeholder (synthetic demo) — descriptors are audited; document contents are never stored.</p>
      {err && <p className="mt-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-red-300">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail dialog (lifecycle actions)
// ---------------------------------------------------------------------------

function ScarDetailDialog({ scar, onClose }: { scar: ScarRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const sessionUser = useErpStore((s) => s.sessionUser);
  const me = sessionUser?.username ?? "";
  const canManage = hasPerm(sessionUser?.role, "quality.inspect");
  const canClose = hasPerm(sessionUser?.role, "quality.approve");
  const [response, setResponse] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"view" | "respond" | "cancel">("view");
  const [portalOpen, setPortalOpen] = useState(false);

  const act = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api("/api/scars", { method: "POST", body: payload }),
    onSuccess: (_d, payload) => {
      qc.invalidateQueries({ queryKey: ["scars"] });
      qc.invalidateQueries({ queryKey: ["receipts"] });
      const verb = String(payload.action ?? "");
      toast(
        verb === "respond" ? "Supplier response recorded — SCAR is under review"
          : verb === "verify" ? "Action plan accepted — verification in progress"
          : verb === "close" ? "SCAR closed (four-eyes verified)"
          : "SCAR cancelled",
      );
      setMode("view");
      setResponse("");
      setCancelReason("");
      setErr("");
    },
    onError: (e: Error) => {
      setErr(e.message);
      toast(e.message, "err");
    },
  });

  const overdue = scar.responseDue && (scar.status === "OPEN" || scar.status === "UNDER_REVIEW") && new Date(scar.responseDue).getTime() < Date.now();
  const isClosed = scar.status === "CLOSED" || scar.status === "CANCELLED";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto erp-scroll bg-zinc-950 border-border/80">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <FileWarning className="h-4 w-4 text-orange-400" />
            <Mono className="text-primary">{scar.scarNumber}</Mono>
            <StatusBadge status={scar.status} />
            <StatusBadge status={scar.severity} />
            {overdue && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
                <AlertTriangle className="h-3 w-3" /> response overdue
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Supplier corrective action request — the supplier must respond with root cause, corrective action and prevention (8D style).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <LifecycleStrip status={scar.status} />

          <KeyValue
            items={[
              { k: "Supplier", v: scar.supplier ? <span><Mono className="text-primary">{scar.supplier.code}</Mono> · {scar.supplier.name} <span className="text-[11px] text-muted-foreground">({scar.supplier.category.toLowerCase()})</span></span> : "—" },
              { k: "Origin", v: <span>{scar.grnNumber ? <Mono>{scar.grnNumber}</Mono> : "manual"}{scar.inspectionRef ? <> · IQC <Mono>{scar.inspectionRef}</Mono></> : null}{!scar.grnNumber && !scar.inspectionRef ? "—" : null}</span> },
              { k: "Affected lots", v: scar.lotNumbers.length ? <span className="flex flex-wrap gap-1">{scar.lotNumbers.map((l) => <Mono key={l} className="rounded border border-border/60 bg-background/40 px-1.5 py-0.5">{l}</Mono>)}</span> : <span className="text-muted-foreground">—</span> },
              { k: "Part / qty", v: scar.partSummary ? <span className="tabular">{scar.partSummary}</span> : "—" },
              { k: "Raised by", v: <Mono>{scar.raisedBy}</Mono> },
              { k: "Raised at", v: <DateCell value={scar.createdAt} /> },
              { k: "Response due", v: <span className={overdue ? "text-red-400" : ""}><DateCell value={scar.responseDue} /></span> },
              { k: "Responded at", v: <DateCell value={scar.respondedAt} /> },
              ...(scar.closedAt ? [{ k: scar.status === "CANCELLED" ? "Cancelled by / at" : "Closed by / at", v: <span><Mono>{scar.closedBy || "—"}</Mono> · <DateCell value={scar.closedAt} /></span> }] : []),
            ]}
          />

          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><BadgeAlert className="h-3.5 w-3.5" /> Defect description</p>
            <p className="rounded-md border border-border/60 bg-background/40 p-2.5 text-[12.5px] leading-relaxed">{scar.defectDescription}</p>
          </div>

          {scar.containment && (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Buyer containment</p>
              <p className="rounded-md border border-border/60 bg-background/40 p-2.5 text-[12.5px] leading-relaxed">{scar.containment}</p>
            </div>
          )}

          {scar.supplierResponse ? (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Handshake className="h-3.5 w-3.5" /> Supplier response (root cause · corrective action · prevention)</p>
              <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[12.5px] leading-relaxed">{scar.supplierResponse}</p>
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border/60 p-2.5 text-[12px] text-muted-foreground">
              No supplier response recorded yet — record it once the supplier's 8D reply arrives.
            </p>
          )}

          <EvidenceSection scar={scar} canManage={canManage} />

          {mode === "respond" && (
            <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
              <Label className="text-[12px]">Supplier response (root cause / corrective action / prevention — min 10 chars)</Label>
              <Textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={4} placeholder="e.g. Root cause: potting batch cured beyond shelf life… Corrective action: … Prevention: …" />
            </div>
          )}
          {mode === "cancel" && (
            <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/5 p-3">
              <Label className="text-[12px] text-red-300">Cancellation reason (audited — min 5 chars)</Label>
              <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} placeholder="e.g. Disposition overturned by MRB — supplier not at fault" />
            </div>
          )}

          {err && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{err}</p>}

          {/* controlled print — supplier response sheet (round-8) */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <Button
              size="sm" variant="outline" className="h-8 gap-1.5 text-[12px]"
              title="Controlled print: the 8D-style response form issued to the supplier (blank ruled sections + sign-off)"
              onClick={() => window.dispatchEvent(new CustomEvent("tau-erp-print", { detail: { kind: "scar", scar: scar.scarNumber } }))}
            >
              <Printer className="h-3.5 w-3.5" /> Response sheet
            </Button>
            {scar.status === "OPEN" && canManage && (
              <Button
                size="sm" variant="outline" className="h-8 gap-1.5 border-amber-500/40 text-[12px] text-amber-200 hover:bg-amber-500/10"
                title="Open the supplier-portal mock view and capture the supplier's structured 8D response in-browser"
                onClick={() => setPortalOpen(true)}
              >
                <Building2 className="h-3.5 w-3.5" /> Supplier portal (mock)…
              </Button>
            )}
            <span className="text-[10.5px] text-muted-foreground">controlled print — supplier fills the blank 8D sections, signs and returns</span>
          </div>

          {!isClosed && canManage && mode === "view" && (
            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
              {scar.status === "OPEN" && (
                <Button size="sm" className="h-8 text-[12px]" onClick={() => { setMode("respond"); setErr(""); }}>
                  <MessageSquareWarning className="h-3.5 w-3.5" /> Record supplier response
                </Button>
              )}
              {scar.status === "UNDER_REVIEW" && (
                <Button size="sm" className="h-8 text-[12px]" onClick={() => act.mutate({ action: "verify", id: scar.id })} disabled={act.isPending}>
                  <CheckCheck className="h-3.5 w-3.5" /> Accept plan → verification
                </Button>
              )}
              {scar.status === "VERIFICATION" && (
                <Button
                  size="sm" className={`h-8 text-[12px] ${scar.evidence.length === 0 ? "border border-amber-500/40" : ""}`}
                  disabled={act.isPending || scar.raisedBy === me}
                  title={
                    scar.raisedBy === me
                      ? `Four-eyes: you (${me}) raised this SCAR — closure requires a different approver (FOUR_EYES.SCAR_CLOSURE)`
                      : scar.evidence.length === 0
                        ? "No D7 effectiveness evidence attached yet — attach evidence before closing (recommended)"
                        : `Close after verifying ${scar.evidence.length} evidence entr${scar.evidence.length === 1 ? "y" : "ies"}`
                  }
                  onClick={() => act.mutate({ action: "close", id: scar.id })}
                >
                  <ShieldCheck className="h-3.5 w-3.5" /> Close SCAR
                  {scar.evidence.length === 0 && <span className="ml-1 text-[10px] text-amber-300">(no evidence)</span>}
                  {scar.raisedBy === me && <span className="ml-1 text-[10px] opacity-70">(four-eyes: not you)</span>}
                </Button>
              )}
              {(scar.status === "OPEN" || scar.status === "UNDER_REVIEW") && canClose && (
                <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => { setMode("cancel"); setErr(""); }}>
                  <CircleSlash className="h-3.5 w-3.5" /> Cancel…
                </Button>
              )}
            </div>
          )}
          {!canManage && !isClosed && (
            <p className="border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
              Read-only — your role lacks <Mono>quality.inspect</Mono> / <Mono>quality.approve</Mono>; lifecycle transitions are enforced server-side.
            </p>
          )}
          {(mode === "respond" || mode === "cancel") && canManage && (
            <DialogFooter>
              <Button size="sm" variant="ghost" className="h-8 text-[12px]" onClick={() => { setMode("view"); setErr(""); }}>Keep as is</Button>
              <Button
                size="sm" className="h-8 text-[12px]"
                disabled={act.isPending || (mode === "respond" ? response.trim().length < 10 : cancelReason.trim().length < 5)}
                onClick={() =>
                  act.mutate(
                    mode === "respond"
                      ? { action: "respond", id: scar.id, supplierResponse: response.trim() }
                      : { action: "cancel", id: scar.id, reason: cancelReason.trim() },
                  )
                }
              >
                {mode === "respond" ? "Save response" : "Confirm cancellation"}
              </Button>
            </DialogFooter>
          )}
        </div>
      </DialogContent>
      {portalOpen && (
        <SupplierPortalDialog
          scar={scar}
          onClose={() => {
            setPortalOpen(false);
            onClose(); // response recorded → SCAR is UNDER_REVIEW; refresh the row behind
          }}
        />
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Raise SCAR dialog (manual, with rejected-GRN prefill)
// ---------------------------------------------------------------------------

function RaiseScarDialog({ data, onClose }: { data: ScarsPayload; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const [grnLineId, setGrnLineId] = useState("none");
  const [supplierId, setSupplierId] = useState("");
  const [itemId, setItemId] = useState("none");
  const [severity, setSeverity] = useState("MAJOR");
  const [defect, setDefect] = useState("");
  const [containment, setContainment] = useState("");
  const [responseDue, setResponseDue] = useState(() => new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10));
  const [err, setErr] = useState("");

  const pickLine = (id: string) => {
    setGrnLineId(id);
    setErr("");
    if (id === "none") return;
    const line = data.rejectedLines.find((l) => l.grnLineId === id);
    if (line) {
      setSupplierId(line.supplierId);
      const item = data.items.find((i) => i.id === line.itemId);
      if (item) setItemId(item.id);
    }
  };

  const mut = useMutation({
    mutationFn: () => {
      const line = grnLineId === "none" ? null : data.rejectedLines.find((l) => l.grnLineId === grnLineId) ?? null;
      const item = data.items.find((i) => i.id === (line?.itemId ?? (itemId === "none" ? "" : itemId)));
      return api("/api/scars", {
        method: "POST",
        body: {
          action: "create",
          supplierId,
          grnNumber: line?.grnNumber ?? "",
          lotNumbers: line?.supplierBatch ? [line.supplierBatch.startsWith("B-") ? line.supplierBatch : `B-${line.supplierBatch}`] : [],
          partSummary: item ? `${item.partNumber} × ${line?.qty ?? ""}` : "",
          defectDescription: defect.trim(),
          severity,
          containment: containment.trim(),
          responseDue: responseDue ? new Date(responseDue + "T09:00:00").toISOString() : undefined,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scars"] });
      qc.invalidateQueries({ queryKey: ["receipts"] });
      toast("SCAR raised — purchase manager notified, supplier response clock started");
      onClose();
    },
    onError: (e: Error) => {
      setErr(e.message);
      toast(e.message, "err");
    },
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl bg-zinc-950 border-border/80">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><FileWarning className="h-4 w-4 text-orange-400" /> Raise supplier SCAR</DialogTitle>
          <DialogDescription>Opens the corrective loop with a supplier. Prefer linking a rejected GRN line so evidence is attached.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[12px]">Link rejected GRN line (optional)</Label>
            <Select value={grnLineId} onValueChange={pickLine}>
              <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-56">
                <SelectItem value="none">— manual raise (no GRN link) —</SelectItem>
                {data.rejectedLines.map((l) => (
                  <SelectItem key={l.grnLineId} value={l.grnLineId}>
                    {l.grnNumber} · batch {l.supplierBatch || "—"} · qty {l.qty}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Supplier *</Label>
              <Select value={supplierId} onValueChange={(v) => { setSupplierId(v); setErr(""); }}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent className="max-h-56">
                  {data.suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.code} · {s.name}{s.category === "CRITICAL" ? " (critical)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Item (for part summary)</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent className="max-h-56">
                  <SelectItem value="none">— none —</SelectItem>
                  {data.items.map((i) => <SelectItem key={i.id} value={i.id}>{i.partNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="MINOR">MINOR</SelectItem><SelectItem value="MAJOR">MAJOR</SelectItem><SelectItem value="CRITICAL">CRITICAL</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Supplier response due</Label>
              <Input type="date" value={responseDue} onChange={(e) => setResponseDue(e.target.value)} className="h-8 text-[12px]" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Defect description * (min 10 chars)</Label>
            <Textarea value={defect} onChange={(e) => { setDefect(e.target.value); setErr(""); }} rows={3} placeholder="What failed, on which evidence (inspection / lot), and the specification breach." />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Buyer containment (optional)</Label>
            <Textarea value={containment} onChange={(e) => setContainment(e.target.value)} rows={2} placeholder="e.g. Lot quarantined in WH-REJ — no issue to production." />
          </div>
          {err && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{err}</p>}
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="h-8 text-[12px]" disabled={!supplierId || defect.trim().length < 10 || mut.isPending} onClick={() => mut.mutate()}>
              <Plus className="h-3.5 w-3.5" /> Raise SCAR
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tab root
// ---------------------------------------------------------------------------

const STATUS_FILTERS = ["ALL", "OPEN", "UNDER_REVIEW", "VERIFICATION", "CLOSED", "CANCELLED"] as const;

export default function ScarTab() {
  const q = useQuery<ScarsPayload>({ queryKey: ["scars"], queryFn: () => api<ScarsPayload>("/api/scars") });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [status, setStatus] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const d = q.data;
  const scars = d?.scars ?? [];
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return scars.filter((s) => {
      if (status !== "ALL" && s.status !== status) return false;
      if (!term) return true;
      return [s.scarNumber, s.supplier?.code ?? "", s.supplier?.name ?? "", s.defectDescription, s.grnNumber, ...s.lotNumbers]
        .join(" ").toLowerCase().includes(term);
    });
  }, [scars, status, search]);

  const detail = scars.find((s) => s.id === detailId) ?? null;

  const cols: Column<ScarRow>[] = [
    { key: "scarNumber", header: "SCAR", render: (s) => <Mono className="font-medium text-primary">{s.scarNumber}</Mono> },
    {
      key: "supplier", header: "Supplier",
      render: (s) => (
        <div>
          <p>{s.supplier?.name ?? "—"}</p>
          <p className="text-[11px] text-muted-foreground"><Mono>{s.supplier?.code ?? "—"}</Mono>{s.supplier?.category === "CRITICAL" && <span className="ml-1 text-red-400">critical</span>}</p>
        </div>
      ),
    },
    { key: "severity", header: "Severity", render: (s) => <StatusBadge status={s.severity} /> },
    { key: "status", header: "Status", render: (s) => <StatusBadge status={s.status} /> },
    {
      key: "defect", header: "Defect",
      render: (s) => <span className="block max-w-64 truncate text-[12px] text-muted-foreground" title={s.defectDescription}>{s.defectDescription}</span>,
    },
    { key: "origin", header: "Origin", render: (s) => s.grnNumber ? <Mono className="text-[12px]">{s.grnNumber}</Mono> : <span className="text-[11px] text-muted-foreground">manual</span> },
    {
      key: "responseDue", header: "Response due",
      render: (s) => {
        const overdue = s.responseDue && (s.status === "OPEN" || s.status === "UNDER_REVIEW") && new Date(s.responseDue).getTime() < Date.now();
        return <span className={overdue ? "inline-flex items-center gap-1 text-red-400" : ""}><DateCell value={s.responseDue} />{overdue && <AlertTriangle className="h-3 w-3" />}</span>;
      },
    },
    { key: "raisedBy", header: "Raised by", render: (s) => <Mono>{s.raisedBy}</Mono> },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open SCARs" value={d?.stats.open ?? "—"} icon={FileWarning} tone={(d?.stats.open ?? 0) > 0 ? "warn" : "good"} sub="awaiting closure" />
        <StatCard label="Response overdue" value={d?.stats.overdueResponse ?? "—"} icon={AlertTriangle} tone={(d?.stats.overdueResponse ?? 0) > 0 ? "bad" : "good"} sub="past supplier due date" />
        <StatCard label="Critical severity" value={d?.stats.criticalOpen ?? "—"} icon={FlaskConical} tone={(d?.stats.criticalOpen ?? 0) > 0 ? "bad" : "default"} sub="open critical SCARs" />
        <StatCard label="Closed" value={d?.stats.closed ?? "—"} icon={ShieldCheck} tone="good" sub="corrective actions verified" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SCAR / supplier / GRN / lot / defect…" className="h-8 pl-8 text-[12px]" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-44 text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => <SelectItem key={s} value={s}>{s === "ALL" ? "All statuses" : s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        {d?.canManage && (
          <Button size="sm" className="h-8 text-[12px]" onClick={() => setRaiseOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Raise SCAR
          </Button>
        )}
      </div>

      <DataTable
        columns={cols}
        rows={rows}
        loading={q.isLoading}
        onRowClick={(s) => setDetailId(s.id)}
        emptyMessage={search || status !== "ALL" ? "No SCARs match the current filters" : "No supplier corrective actions — SCARs are raised automatically when IQC rejects a lot"}
      />

      {rows.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Lifecycle: OPEN → UNDER_REVIEW → VERIFICATION → CLOSED (closure is four-eyes — a user other than the raiser). Auto-raised on every IQC FAIL; audited end-to-end.
        </p>
      )}

      {detail && <ScarDetailDialog scar={detail} onClose={() => setDetailId(null)} />}
      {raiseOpen && d && <RaiseScarDialog data={d} onClose={() => setRaiseOpen(false)} />}
    </div>
  );
}
