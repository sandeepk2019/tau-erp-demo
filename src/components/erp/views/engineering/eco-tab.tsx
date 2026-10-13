"use client";
// ============================================================================
// Tau ERP — Engineering ▸ Tab 5: Engineering changes (ECR / ECO)
// Lifecycle: DRAFT/TRIAGE/IMPACT_REVIEW → APPROVED → IMPLEMENTED → CLOSED.
// Approval is four-eyes enforced server-side (requester ≠ approver).
// impactJson renders as key-value chips; effectivity + audit fields exposed.
// ============================================================================
import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import {
  DataTable, DateCell, KeyValue, Mono, StatusBadge,
} from "../../shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label as UiLabel } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EcoDto, EcoPayload } from "./types";
import { CheckCircle2, GitCommitHorizontal, Plus, Wrench, XCircle } from "lucide-react";

type Props = { data?: EcoPayload; loading: boolean; canEdit: boolean; canApprove: boolean };

function ImpactChips({ impact }: { impact: Record<string, unknown> }) {
  const entries = Object.entries(impact ?? {});
  if (entries.length === 0) return <p className="text-[12px] text-muted-foreground">No impact analysis recorded.</p>;
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-start gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground min-w-28 pt-1">{k}</span>
          {Array.isArray(v) ? (
            <div className="flex flex-wrap gap-1">
              {v.length === 0
                ? <span className="text-[11px] rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-muted-foreground">none</span>
                : v.map((item, i) => (
                  <span key={`${k}-${i}`} className="text-[11px] rounded border border-border/60 bg-muted/40 px-1.5 py-0.5">
                    {typeof item === "object" ? JSON.stringify(item) : String(item)}
                  </span>
                ))}
            </div>
          ) : (
            <span className="text-[11px] rounded border border-border/60 bg-muted/40 px-1.5 py-0.5">
              {v === null || v === undefined ? "—" : String(v)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function EcoTab({ data, loading, canEdit, canApprove }: Props) {
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const changes = data?.changes ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ kind: "ECR", title: "", reason: "", effectivity: "NEXT_WO", effectivityDate: "" });

  const selected = useMemo(() => changes.find((c) => c.id === selectedId) ?? null, [changes, selectedId]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["eco"] });

  const act = useMutation({
    mutationFn: (v: { action: string; id: string }) => api("/api/eco", { method: "POST", body: v }),
    onSuccess: (_d, v) => {
      invalidate();
      const msg: Record<string, string> = {
        approve: "Change APPROVED (four-eyes checked)",
        implement: "Change IMPLEMENTED — apply effectivity on next WO",
        close: "Change CLOSED",
      };
      toast(msg[v.action] ?? "Updated");
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api("/api/eco", { method: "POST", body: { action: "create", ...payload } }),
    onSuccess: () => {
      invalidate();
      toast("Engineering change raised");
      setCreateOpen(false);
      setForm({ kind: "ECR", title: "", reason: "", effectivity: "NEXT_WO", effectivityDate: "" });
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const submitCreate = () => {
    if (!form.title.trim()) { toast("Title is required", "err"); return; }
    if (form.effectivity === "DATE" && !form.effectivityDate) { toast("Effectivity DATE requires a date", "err"); return; }
    create.mutate({
      kind: form.kind, title: form.title.trim(), reason: form.reason.trim(),
      effectivity: form.effectivity,
      effectivityDate: form.effectivity === "DATE" ? form.effectivityDate : undefined,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          Flow: <StatusBadge status="DRAFT" /> → <StatusBadge status="APPROVED" /> → <StatusBadge status="IMPLEMENTED" /> → <StatusBadge status="CLOSED" />
          <span className="ml-2">(four-eyes: requester cannot approve own change — spec rule 12)</span>
        </span>
        {canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Raise ECR
          </Button>
        )}
      </div>

      <DataTable<EcoDto>
        columns={[
          { key: "number", header: "Number", render: (c) => <Mono className="text-primary font-medium">{c.number}</Mono> },
          { key: "kind", header: "Kind", render: (c) => <span className="text-[11px] rounded bg-muted px-1.5 py-0.5">{c.kind}</span> },
          { key: "title", header: "Title", render: (c) => <span className="text-[12px]">{c.title}</span> },
          { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
          { key: "effectivity", header: "Effectivity", render: (c) => (
            <span className="text-[12px]">{c.effectivity}{c.effectivityDate && <> · <DateCell value={c.effectivityDate} /></>}</span>
          ) },
          { key: "requestedBy", header: "Requested by", render: (c) => <Mono>{c.requestedBy || "—"}</Mono> },
          { key: "approvedBy", header: "Approved by", render: (c) => c.approvedBy ? <Mono>{c.approvedBy}</Mono> : <span className="text-muted-foreground">—</span> },
          { key: "createdAt", header: "Raised", render: (c) => <DateCell value={c.createdAt} /> },
        ]}
        rows={changes}
        loading={loading}
        rowKey={(c) => c.id}
        onRowClick={(c) => setSelectedId(c.id)}
        emptyMessage="No engineering changes"
      />

      {/* ---------------- DETAIL DIALOG ---------------- */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <GitCommitHorizontal className="h-4 w-4 text-primary" />
              <Mono className="text-primary">{selected?.number}</Mono>
              {selected && <StatusBadge status={selected.status} />}
            </DialogTitle>
            <DialogDescription>
              Engineering change record — review scope, affected parts and approval trail before disposition.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <p className="text-[13px]">{selected.title}</p>
              <KeyValue items={[
                { k: "Kind", v: selected.kind },
                { k: "Reason", v: <span className="text-[12px]">{selected.reason || "—"}</span> },
                { k: "Effectivity", v: <span className="text-[12px]">{selected.effectivity}{selected.effectivityDate ? " · " : ""}<DateCell value={selected.effectivityDate} /></span> },
                { k: "Requested by", v: <Mono>{selected.requestedBy || "—"}</Mono> },
                { k: "Approved by", v: selected.approvedBy ? <Mono>{selected.approvedBy}</Mono> : "—" },
                { k: "Raised on", v: <DateCell value={selected.createdAt} /> },
              ]} />
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Impact analysis (impactJson)</p>
                <ImpactChips impact={selected.impact} />
              </div>
              {canApprove && (
                <DialogFooter className="gap-2">
                  {["DRAFT", "TRIAGE", "IMPACT_REVIEW"].includes(selected.status) && (
                    <Button size="sm" disabled={act.isPending}
                      onClick={() => act.mutate({ action: "approve", id: selected.id })}>
                      <CheckCircle2 className="h-4 w-4" /> Approve
                    </Button>
                  )}
                  {selected.status === "APPROVED" && (
                    <Button size="sm" disabled={act.isPending}
                      onClick={() => act.mutate({ action: "implement", id: selected.id })}>
                      <Wrench className="h-4 w-4" /> Implement
                    </Button>
                  )}
                  {selected.status === "IMPLEMENTED" && (
                    <Button size="sm" variant="outline" disabled={act.isPending}
                      onClick={() => act.mutate({ action: "close", id: selected.id })}>
                      <XCircle className="h-4 w-4" /> Close
                    </Button>
                  )}
                </DialogFooter>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------------- RAISE ECR DIALOG ---------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Raise engineering change</DialogTitle>
            <DialogDescription>
              Log a new ECO against a part. It enters review and requires approval before release.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">Kind</UiLabel>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ECR">ECR — request</SelectItem>
                  <SelectItem value="ECO">ECO — order</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">Effectivity</UiLabel>
              <Select value={form.effectivity} onValueChange={(v) => setForm({ ...form, effectivity: v })}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NEXT_WO">NEXT_WO</SelectItem>
                  <SelectItem value="DATE">DATE</SelectItem>
                  <SelectItem value="SERIAL_BREAK">SERIAL_BREAK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <UiLabel className="text-[11px]">Title *</UiLabel>
              <Input className="h-8 text-[12px]" placeholder="Alternate potting compound vendor"
                value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <UiLabel className="text-[11px]">Reason / justification</UiLabel>
              <Input className="h-8 text-[12px]" placeholder="Quality risk with current supplier batch…"
                value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            {form.effectivity === "DATE" && (
              <div className="space-y-1.5 col-span-2">
                <UiLabel className="text-[11px]">Effective date</UiLabel>
                <Input type="date" className="h-8 text-[12px]" value={form.effectivityDate}
                  onChange={(e) => setForm({ ...form, effectivityDate: e.target.value })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={submitCreate} disabled={create.isPending}>
              {create.isPending ? "Raising…" : "Raise change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
