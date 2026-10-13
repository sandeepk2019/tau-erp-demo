"use client";
// ============================================================================
// Tau ERP — Engineering ▸ Tab 2: BOMs (revisions, lines, release workflow)
// DRAFT revisions are editable (add-line, engineering.edit); release requires
// engineering.approve and sets RELEASED + releasedBy/releasedAt/effectiveFrom.
// RELEASED revisions are immutable (spec rule 13) and are the only revisions
// production WOs may consume.
// ============================================================================
import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import {
  DataTable, DateCell, KeyValue, Mono, Money, StatusBadge,
} from "../../shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label as UiLabel } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { BomDto, BomLineDto, BomsPayload, ItemDto } from "./types";
import { CircleAlert, Layers, Lock, Plus, ShieldCheck, TriangleAlert } from "lucide-react";

type Props = { data?: BomsPayload; items: ItemDto[]; loading: boolean; canEdit: boolean; canApprove: boolean };

export default function BomsTab({ data, items, loading, canEdit, canApprove }: Props) {
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const boms = data?.boms ?? [];

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [effFrom, setEffFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [line, setLine] = useState({ componentItemId: "", qty: "1", scrapPct: "0" });

  const selected = useMemo(() => boms.find((b) => b.id === selectedId) ?? null, [boms, selectedId]);
  const filtered = useMemo(() => boms.filter((b) => statusFilter === "ALL" || b.status === statusFilter), [boms, statusFilter]);
  const drafts = boms.filter((b) => b.status === "DRAFT");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["boms"] });

  const release = useMutation({
    mutationFn: (v: { bomId: string; effectiveFrom: string }) =>
      api("/api/boms", { method: "POST", body: { action: "release", ...v } }),
    onSuccess: () => { invalidate(); toast("BOM revision RELEASED — now usable by production work orders"); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const addLine = useMutation({
    mutationFn: (v: { bomId: string; componentItemId: string; qty: number; scrapPct: number }) =>
      api("/api/boms", { method: "POST", body: { action: "add-line", ...v } }),
    onSuccess: () => {
      invalidate();
      setLine({ componentItemId: "", qty: "1", scrapPct: "0" });
      toast("Component line added to DRAFT revision");
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const submitLine = () => {
    if (!selected) return;
    const qty = Number(line.qty);
    if (!line.componentItemId) { toast("Pick a component item", "err"); return; }
    if (!Number.isFinite(qty) || qty <= 0) { toast("Quantity must be > 0", "err"); return; }
    addLine.mutate({ bomId: selected.id, componentItemId: line.componentItemId, qty, scrapPct: Number(line.scrapPct) || 0 });
  };

  const lineComponentIds = new Set(selected?.lines.map((l) => l.componentItemId) ?? []);
  const componentOptions = items.filter((i) => i.id !== selected?.itemId && !lineComponentIds.has(i.id) && i.lifecycle !== "OBSOLETE");

  return (
    <div className="space-y-3">
      {/* Rule banner */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-3 flex items-start gap-2.5">
          <TriangleAlert className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[12px] text-amber-200/90">
            <span className="font-medium">Production rule:</span> work orders may only be issued against{" "}
            <StatusBadge status="RELEASED" /> BOM revisions. <StatusBadge status="DRAFT" /> revisions are engineering
            working copies — the WO API rejects them at release time (spec rule 13: released revisions are immutable;
            changes require a new revision + ECO).
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-44 text-[12px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {["DRAFT", "RELEASED"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {drafts.length > 0 && (
          <span className="text-[11px] text-amber-300 flex items-center gap-1">
            <CircleAlert className="h-3.5 w-3.5" /> {drafts.length} DRAFT revision(s) pending release
          </span>
        )}
      </div>

      <DataTable<BomDto>
        columns={[
          { key: "partNumber", header: "Parent item", render: (r) => <Mono className="text-primary font-medium">{r.partNumber}</Mono> },
          { key: "itemName", header: "Description", render: (r) => <span className="text-[12px]">{r.itemName}</span> },
          { key: "familyCode", header: "Family", render: (r) => r.familyCode ? <span className="text-[12px]">{r.familyCode}</span> : <span className="text-muted-foreground text-[11px]">—</span> },
          { key: "revision", header: "Rev", render: (r) => <Mono>{r.revision}</Mono> },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "lineCount", header: "Lines", className: "text-right", render: (r) => <span className="tabular text-[12px]">{r.lineCount}</span> },
          { key: "effectiveFrom", header: "Effective from", render: (r) => <DateCell value={r.effectiveFrom} /> },
          { key: "releasedBy", header: "Released by", render: (r) => r.releasedBy ? <Mono>{r.releasedBy}</Mono> : <span className="text-muted-foreground">—</span> },
          { key: "releasedAt", header: "Released at", render: (r) => <DateCell value={r.releasedAt} /> },
        ]}
        rows={filtered}
        loading={loading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setSelectedId(r.id)}
        emptyMessage="No BOM revisions"
      />

      {/* ---------------- BOM DETAIL DIALOG ---------------- */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <Mono className="text-primary">{selected?.partNumber}</Mono>
              <span className="text-[13px] font-normal text-muted-foreground">rev {selected?.revision}</span>
              {selected && <StatusBadge status={selected.status} />}
            </DialogTitle>
            <DialogDescription>
              Full bill-of-materials breakdown with routing operations and cost roll-up.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <KeyValue items={[
                { k: "Status", v: <StatusBadge status={selected.status} /> },
                { k: "Effective from", v: <DateCell value={selected.effectiveFrom} /> },
                { k: "Released by", v: selected.releasedBy ? <Mono>{selected.releasedBy}</Mono> : "—" },
                { k: "Released at", v: <DateCell value={selected.releasedAt} /> },
                { k: "Notes", v: <span className="text-[12px]">{selected.notes || "—"}</span> },
              ]} />

              <DataTable<BomLineDto>
                maxHeight="max-h-64"
                dense
                columns={[
                  { key: "position", header: "Pos", render: (l) => <Mono className="text-muted-foreground">{l.position || "—"}</Mono> },
                  { key: "partNumber", header: "Component", render: (l) => <Mono className="text-primary">{l.partNumber}</Mono> },
                  { key: "componentName", header: "Description", render: (l) => <span className="text-[12px]">{l.componentName}</span> },
                  { key: "qty", header: "Qty", className: "text-right", render: (l) => <span className="tabular text-[12px]">{l.qty} {l.uom}</span> },
                  { key: "scrapPct", header: "Scrap %", className: "text-right", render: (l) => <span className="tabular text-[12px] text-muted-foreground">{l.scrapPct}%</span> },
                  { key: "lifecycle", header: "Lifecycle", render: (l) => l.lifecycle ? <StatusBadge status={l.lifecycle} /> : "—" },
                ]}
                rows={selected.lines}
                rowKey={(l) => l.id}
                emptyMessage="No lines — add components before releasing"
              />

              {/* Add line (DRAFT only, engineering.edit) */}
              {canEdit && selected.status === "DRAFT" && (
                <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add component line (draft maintenance)
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <UiLabel className="text-[10px]">Component</UiLabel>
                      <Select value={line.componentItemId || undefined} onValueChange={(v) => setLine({ ...line, componentItemId: v })}>
                        <SelectTrigger className="h-8 w-64 text-[12px]"><SelectValue placeholder="Pick item…" /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          {componentOptions.map((i) => (
                            <SelectItem key={i.id} value={i.id}><Mono>{i.partNumber}</Mono> — {i.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <UiLabel className="text-[10px]">Qty</UiLabel>
                      <Input className="h-8 w-20 text-[12px] tabular" type="number" min="0" step="0.001" value={line.qty}
                        onChange={(e) => setLine({ ...line, qty: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <UiLabel className="text-[10px]">Scrap %</UiLabel>
                      <Input className="h-8 w-20 text-[12px] tabular" type="number" min="0" max="100" step="0.1" value={line.scrapPct}
                        onChange={(e) => setLine({ ...line, scrapPct: e.target.value })} />
                    </div>
                    <Button size="sm" variant="outline" onClick={submitLine} disabled={addLine.isPending}>
                      {addLine.isPending ? "Adding…" : "Add line"}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  {selected.status === "RELEASED"
                    ? <><Lock className="h-3.5 w-3.5" /> Released revision is immutable — issue a new revision to change it (spec rule 13).</>
                    : <>Material cost of this revision: <Money value={selected.lines.reduce((s, l) => {
                        const it = items.find((i) => i.id === l.componentItemId);
                        return s + (it ? it.unitCost * l.qty * (1 + l.scrapPct / 100) : 0);
                      }, 0)} /> (indicative)</>}
                </p>
                {canApprove && selected.status === "DRAFT" && (
                  <div className="flex items-end gap-2">
                    <div className="space-y-1">
                      <UiLabel className="text-[10px]">Effective from</UiLabel>
                      <Input type="date" className="h-8 text-[12px]" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} />
                    </div>
                    <Button size="sm" onClick={() => release.mutate({ bomId: selected.id, effectiveFrom: effFrom })}
                      disabled={release.isPending}>
                      <ShieldCheck className="h-4 w-4" /> {release.isPending ? "Releasing…" : "Release revision"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
