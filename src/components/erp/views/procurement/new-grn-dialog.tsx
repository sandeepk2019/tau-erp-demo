"use client";
// ============================================================================
// Tau ERP — Procurement (Task 3-b): "New Goods Receipt (GRN)" dialog.
// Pick an APPROVED/PARTIAL PO → lines default to open qty (ordered − received).
// BATCH items require a supplier batch; the server creates lots in WH-IQC,
// RECEIPT movements, PENDING IQC inspections and rolls the PO to PARTIAL/RECEIVED.
// ============================================================================
import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, Mono, StatusBadge } from "../../shared";
import { openQty, type PoRow } from "./types";
import type { Column } from "../../shared";

type LineState = { poLineId: string; qty: string; supplierBatch: string; manufacturerRef: string };

export default function NewGrnDialog({
  open, onOpenChange, pos,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pos: PoRow[];
}) {
  const qc = useQueryClient();
  const [poId, setPoId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<LineState[]>([]);
  const [err, setErr] = useState("");

  const receivable = useMemo(
    () => pos.filter((p) => ["APPROVED", "PARTIAL"].includes(p.status) && p.lines.some((l) => openQty(l) > 0)),
    [pos],
  );
  const po = receivable.find((p) => p.id === poId) ?? null;

  const pickPo = (id: string) => {
    const p = receivable.find((x) => x.id === id);
    setPoId(id);
    setErr("");
    setLines(
      (p?.lines ?? [])
        .filter((l) => openQty(l) > 0)
        .map((l) => ({ poLineId: l.id, qty: String(openQty(l)), supplierBatch: "", manufacturerRef: "" })),
    );
  };

  const setLine = (i: number, patch: Partial<LineState>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const mut = useMutation({
    mutationFn: () =>
      api("/api/receipts", {
        method: "POST",
        body: {
          poId,
          remarks: remarks || undefined,
          lines: lines.map((l) => ({
            poLineId: l.poLineId, qty: Number(l.qty),
            supplierBatch: l.supplierBatch, manufacturerRef: l.manufacturerRef || undefined,
          })),
        },
      }),
    onSuccess: (d) => {
      const r = d as { grnNumber?: string; poStatus?: string };
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      useErpStore.getState().toast(`GRN ${r.grnNumber ?? ""} posted — IQC pending, PO → ${r.poStatus ?? ""}`);
      onOpenChange(false);
    },
    onError: (e: Error) => {
      setErr(e.message);
      useErpStore.getState().toast(e.message, "err");
    },
  });

  const lineCols: Column<{ id: string; line: LineState; itemLabel: string; uom: string; trackingType: string; open: number }>[] = [
    { key: "item", header: "Item", render: (r) => <Mono className="text-primary">{r.itemLabel}</Mono> },
    { key: "open", header: "Open qty", render: (r) => <span className="tabular text-[12px] text-muted-foreground">{r.open} {r.uom}</span> },
    {
      key: "qty", header: "Receive qty",
      render: (r) => (
        <Input
          type="number" min="0" step="any" className="h-8 text-[12px]" value={r.line.qty}
          onChange={(e) => setLine(lines.findIndex((l) => l.poLineId === r.line.poLineId), { qty: e.target.value })}
        />
      ),
    },
    {
      key: "batch", header: "Supplier batch",
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <Input
            className="h-8 text-[12px] w-36" placeholder={r.trackingType === "BATCH" ? "Required" : r.trackingType === "SERIAL" ? "Optional" : "—"}
            value={r.line.supplierBatch}
            onChange={(e) => setLine(lines.findIndex((l) => l.poLineId === r.line.poLineId), { supplierBatch: e.target.value })}
          />
          {r.trackingType === "BATCH" && !r.line.supplierBatch.trim() && <span className="text-red-400 text-[11px]">*</span>}
          {r.trackingType === "SERIAL" && <span className="text-[10px] text-amber-300">SERIAL</span>}
        </div>
      ),
    },
    {
      key: "ref", header: "Mfr ref",
      render: (r) => (
        <Input
          className="h-8 text-[12px] w-32" placeholder="Optional"
          value={r.line.manufacturerRef}
          onChange={(e) => setLine(lines.findIndex((l) => l.poLineId === r.line.poLineId), { manufacturerRef: e.target.value })}
        />
      ),
    },
  ];

  const valid = !!poId && lines.length > 0 && lines.every((l) => Number(l.qty) > 0);

  const batchMissing = lines.some((l) => {
    const pl = po?.lines.find((p) => p.id === l.poLineId);
    return pl?.item.trackingType === "BATCH" && !l.supplierBatch.trim();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-zinc-950 border-border/80 max-h-[88vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle>New Goods Receipt (GRN)</DialogTitle>
          <DialogDescription>
            Receipts land in <Mono>WH-IQC</Mono> with disposition <StatusBadge status="PENDING_IQC" />; lots, movements and
            IQC inspections are created in one atomic transaction (PO ↔ lots ↔ movements consistent).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Purchase order (APPROVED / PARTIAL)</Label>
              <Select value={poId || undefined} onValueChange={pickPo}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select PO…" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {receivable.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <Mono className="text-primary">{p.poNumber}</Mono>
                        <span className="text-muted-foreground truncate max-w-44">{p.supplier.name}</span>
                        <StatusBadge status={p.status} />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Remarks</Label>
              <Input
                placeholder="e.g. supplier test certs attached (SYNTHETIC)"
                value={remarks} onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          {po ? (
            <DataTable
              dense
              maxHeight="max-h-[38vh]"
              columns={lineCols}
              rows={lines.map((l) => {
                const pl = po.lines.find((p) => p.id === l.poLineId)!;
                return {
                  id: l.poLineId,
                  line: l,
                  itemLabel: `${pl.item.partNumber} · ${pl.item.name}`,
                  uom: pl.item.uom, trackingType: pl.item.trackingType, open: openQty(pl),
                };
              })}
              rowKey={(r) => r.line.poLineId}
              emptyMessage="No open lines on this PO"
            />
          ) : (
            <p className="text-[12px] text-muted-foreground border border-dashed border-border/60 rounded-md p-4 text-center">
              {receivable.length === 0 ? "No POs with open quantities (need APPROVED or PARTIAL status)." : "Select a PO to load its open lines."}
            </p>
          )}

          {err && <p className="text-[12px] text-red-400 border border-red-500/30 bg-red-500/5 rounded-md p-2">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm" disabled={!valid || batchMissing || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Posting…" : "Post GRN → IQC"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
