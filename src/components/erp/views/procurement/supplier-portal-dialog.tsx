"use client";
// ============================================================================
// Tau ERP — Supplier Portal (MOCK VIEW) for the SCAR 8D response.
// Simulates the supplier-facing form the SCAR response sheet is issued for:
// the buyer opens it here to capture the supplier's structured 8D reply
// (containment → root cause → corrective → preventive → effectiveness).
// Submitted data is stored server-side as the SCAR supplierResponse
// (action=respond, portal8d) with full audit. Sandbox demo only — the real
// portal would authenticate the supplier externally.
// API: POST /api/scars { action: "respond", id, portal8d }
// ============================================================================
import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { Mono } from "../../shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Building2, ClipboardCheck, ExternalLink, Factory, Send, ShieldCheck } from "lucide-react";
import type { ScarRow } from "./scar-tab";

const ROOT_CAUSE_CATEGORIES = ["Method / process", "Machine / equipment", "Material / input", "Man / operator", "Measurement / test", "Environment", "Design"] as const;

/** One 8D discipline section: step chip + title + body. */
function Step({
  step, title, icon, required, tone = "default", children,
}: {
  step: string; title: string; icon: React.ReactNode; required?: boolean; tone?: "default" | "buyer"; children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border/60 bg-background/40">
      <header className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <span
          className={`inline-flex h-5 items-center rounded px-1.5 font-mono text-[10px] font-bold tracking-wider ${
            tone === "buyer" ? "bg-zinc-500/15 text-zinc-300" : "bg-primary/15 text-primary"
          }`}
        >
          {step}
        </span>
        <p className="flex items-center gap-1.5 text-[12px] font-medium">
          {icon}
          {title}
          {required ? <span className="text-orange-400" title="required">*</span> : <span className="text-[10px] font-normal text-muted-foreground">(optional)</span>}
        </p>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export default function SupplierPortalDialog({ scar, onClose }: { scar: ScarRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const [containment, setContainment] = useState("");
  const [rootCauseCategory, setRootCauseCategory] = useState<string>("");
  const [rootCause, setRootCause] = useState("");
  const [corrective, setCorrective] = useState("");
  const [preventive, setPreventive] = useState("");
  const [effectiveness, setEffectiveness] = useState("");
  const [submittedBy, setSubmittedBy] = useState(`quality@${(scar.supplier?.code ?? "supplier").toLowerCase().replace(/^sup-/, "")}.example.in`);
  const [err, setErr] = useState("");

  const overdue = scar.responseDue && new Date(scar.responseDue).getTime() < Date.now();

  const mut = useMutation({
    mutationFn: () =>
      api("/api/scars", {
        method: "POST",
        body: {
          action: "respond",
          id: scar.id,
          portal8d: { containment, rootCauseCategory, rootCause, corrective, preventive, effectiveness, submittedBy },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scars"] });
      qc.invalidateQueries({ queryKey: ["receipts"] });
      toast("8D response submitted via supplier portal (mock) — SCAR is under review");
      onClose();
    },
    onError: (e: Error) => {
      setErr(e.message);
      toast(e.message, "err");
    },
  });

  const ready = useMemo(
    () => containment.trim().length >= 10 && rootCause.trim().length >= 10 && corrective.trim().length >= 10 && rootCauseCategory !== "",
    [containment, rootCause, corrective, rootCauseCategory],
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto erp-scroll bg-zinc-950 border-amber-500/25">
        {/* supplier-portal chrome — visually distinct from the buyer app */}
        <div className="-mx-6 -mt-6 mb-4 border-b border-amber-500/25 bg-amber-500/5 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Factory className="h-4 w-4 text-primary" />
            <p className="text-[13px] font-semibold tracking-wide">SUPPLIER PORTAL</p>
            <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-widest text-amber-300">mock view</span>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {scar.supplier ? <span><Mono className="text-amber-200">{scar.supplier.code}</Mono> · {scar.supplier.name}</span> : "unknown supplier"}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Sandbox simulation of the external supplier form — submits are recorded by the buyer org and audited. Never real statutory data.
          </p>
        </div>

        <DialogHeader className="space-y-1">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            Corrective action request — <Mono className="text-primary">{scar.scarNumber}</Mono>
            {scar.severity === "CRITICAL" && (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">CRITICAL</span>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span>
              Response due{" "}
              <span className={overdue ? "font-medium text-red-300" : "text-foreground"}>
                {scar.responseDue ? new Date(scar.responseDue).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
              </span>
              {overdue && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-red-500/50 bg-red-500/10 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-red-300">
                  <AlertTriangle className="h-2.5 w-2.5" /> overdue
                </span>
              )}
            </span>
            {scar.partSummary && <span className="tabular text-muted-foreground">{scar.partSummary}</span>}
          </DialogDescription>
        </DialogHeader>

        {/* D2 — problem recap (issued by the buyer, read-only) */}
        <Step step="D2" title="Problem description — issued by buyer" icon={<AlertTriangle className="h-3 w-3 text-zinc-400" />} tone="buyer">
          <div className="space-y-2 text-[12.5px] leading-relaxed">
            <p>{scar.defectDescription}</p>
            {scar.containment && (
              <p className="rounded border border-border/50 bg-background/60 p-2 text-[12px] text-muted-foreground">
                <span className="font-medium text-zinc-300">Buyer containment already applied: </span>
                {scar.containment}
              </p>
            )}
            {scar.lotNumbers.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Affected lots: {scar.lotNumbers.map((l) => <Mono key={l} className="mr-1 rounded border border-border/60 bg-background/40 px-1 py-px">{l}</Mono>)}
              </p>
            )}
          </div>
        </Step>

        {/* supplier fields */}
        <div className="space-y-2.5">
          <Step step="D3" title="Containment actions at your site" icon={<ShieldCheck className="h-3 w-3 text-primary" />} required>
            <Textarea
              value={containment}
              onChange={(e) => setContainment(e.target.value)}
              rows={2}
              className="text-[12.5px]"
              placeholder="e.g. All stock of the affected batch quarantined; shipment on hold; customer stock checked…"
            />
            <p className="mt-1 text-[10.5px] text-muted-foreground">Immediate actions taken to isolate suspect stock (min 10 chars).</p>
          </Step>

          <Step step="D4" title="Root cause analysis" icon={<AlertTriangle className="h-3 w-3 text-primary" />} required>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Cause category</Label>
                <Select value={rootCauseCategory} onValueChange={setRootCauseCategory}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue placeholder="Select the 6M category…" /></SelectTrigger>
                  <SelectContent>
                    {ROOT_CAUSE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="text-[12.5px]">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                rows={2}
                className="text-[12.5px]"
                placeholder="e.g. Potting compound stored beyond its 6-month shelf life; FIFO control at stores did not flag it…"
              />
            </div>
          </Step>

          <Step step="D5" title="Corrective actions implemented" icon={<ClipboardCheck className="h-3 w-3 text-primary" />} required>
            <Textarea
              value={corrective}
              onChange={(e) => setCorrective(e.target.value)}
              rows={2}
              className="text-[12.5px]"
              placeholder="e.g. Batch replaced free of charge; revised cure-window check added before dispatch…"
            />
          </Step>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Step step="D6" title="Preventive actions" icon={<ShieldCheck className="h-3 w-3 text-primary" />}>
              <Textarea
                value={preventive}
                onChange={(e) => setPreventive(e.target.value)}
                rows={2}
                className="text-[12.5px]"
                placeholder="e.g. FIFO enforced via barcode scan at issue…"
              />
            </Step>
            <Step step="D7" title="Effectiveness verification" icon={<ClipboardCheck className="h-3 w-3 text-primary" />}>
              <Textarea
                value={effectiveness}
                onChange={(e) => setEffectiveness(e.target.value)}
                rows={2}
                className="text-[12.5px]"
                placeholder="e.g. 3 follow-up lots audited — zero escapes over 90 days…"
              />
            </Step>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Submitted by (mock supplier identity)</Label>
            <Input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} className="h-8 text-[12.5px]" placeholder="name@supplier.example.in" />
          </div>
        </div>

        {err && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{err}</p>}

        <DialogFooter className="items-center">
          <p className="mr-auto flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <ExternalLink className="h-3 w-3" />
            recorded as <Mono>{scar.scarNumber}</Mono> supplier response · audited SCAR_RESPONSE
          </p>
          <Button size="sm" variant="ghost" className="h-8 text-[12px]" onClick={onClose} disabled={mut.isPending}>
            Discard
          </Button>
          <Button
            size="sm"
            className="h-8 text-[12px]"
            disabled={mut.isPending || !ready}
            title={ready ? "Submit the structured 8D response (D3 + D4 + D5 mandatory)" : "D3 containment, D4 root cause (+category) and D5 corrective action are required (min 10 chars each)"}
            onClick={() => { setErr(""); mut.mutate(); }}
          >
            <Send className="h-3.5 w-3.5" /> Submit 8D response
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
