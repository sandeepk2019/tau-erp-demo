"use client";
// ============================================================================
// Tau ERP — Procurement (Task 3-b): IQC result submission dialog.
// Pre-fills parameter rows from the IQC template (spec limits shown); numeric
// values are auto-evaluated against lower/upper. On submit the inspection
// becomes immutable, the GRN line is dispositioned and lots are moved
// WH-IQC → WH-ACC (PASS) / WH-REJ (FAIL) server-side.
// ============================================================================
import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, KeyValue, Mono, StatusBadge } from "../../shared";
import type { Column } from "../../shared";
import type { GrnLineRow, InspRow, InspTemplate } from "./types";

type RowState = { parameter: string; unit: string; lower?: number; upper?: number; value: string; pass: boolean };

function evalPass(row: RowState, value: string): boolean {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return row.pass;
  if (typeof row.lower === "number" && typeof row.upper === "number") return n >= row.lower && n <= row.upper;
  return row.pass;
}

export default function IqcDialog({
  open, onOpenChange, line, inspection, template,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  line: GrnLineRow | null;
  inspection: InspRow | null;
  template: InspTemplate | null;
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<RowState[]>(() => {
    const params = template?.params?.length ? template.params : [{ name: "Visual / dimension check", unit: "" }];
    return params.map((p) => ({ parameter: p.name, unit: p.unit ?? "", lower: p.lower, upper: p.upper, value: "", pass: true }));
  });
  const [equipmentCode, setEquipmentCode] = useState(inspection?.equipmentCode ?? "");
  const [err, setErr] = useState("");

  const overall = useMemo(() => (rows.length > 0 && rows.every((r) => r.pass) ? "PASS" : "FAIL"), [rows]);
  const allFilled = rows.length > 0 && rows.every((r) => r.value.trim().length > 0);

  const mut = useMutation({
    mutationFn: () =>
      api("/api/receipts/iqc", {
        method: "POST",
        body: {
          inspectionId: inspection?.id,
          results: rows.map((r) => ({ parameter: r.parameter, value: r.value.trim(), pass: r.pass })),
          overallResult: overall,
          equipmentCode: equipmentCode || undefined,
        },
      }),
    onSuccess: (d) => {
      const r = d as { inspNumber?: string; overallResult?: string; disposition?: string; lotsMoved?: number; scarNumber?: string | null };
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["scars"] });
      useErpStore.getState().toast(
        `IQC ${r.inspNumber ?? ""}: ${r.overallResult} → ${r.disposition} · ${r.lotsMoved ?? 0} lot(s) moved` +
        (r.scarNumber ? ` · SCAR ${r.scarNumber} auto-raised` : ""),
      );
      if (r.scarNumber) useErpStore.getState().toast(`SCAR ${r.scarNumber} auto-raised — purchase manager notified (Supplier Quality tab)`);
      onOpenChange(false);
    },
    onError: (e: Error) => {
      setErr(e.message);
      useErpStore.getState().toast(e.message, "err");
    },
  });

  const cols: Column<{ id: string; row: RowState; idx: number }>[] = [
    {
      key: "parameter", header: "Parameter",
      render: (r) => (
        <div>
          <p className="text-[12px] font-medium">{r.row.parameter}</p>
          {(typeof r.row.lower === "number" && typeof r.row.upper === "number") && (
            <p className="text-[10px] text-muted-foreground tabular">spec {r.row.lower} – {r.row.upper} {r.row.unit}</p>
          )}
        </div>
      ),
    },
    {
      key: "value", header: "Observed value",
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <Input
            className="h-8 text-[12px] w-28" value={r.row.value}
            onChange={(e) =>
              setRows((rs) => rs.map((x, i) => (i === r.idx ? { ...x, value: e.target.value, pass: evalPass(x, e.target.value) } : x)))
            }
          />
          <span className="text-[10px] text-muted-foreground w-8">{r.row.unit}</span>
        </div>
      ),
    },
    {
      key: "pass", header: "Pass",
      render: (r) => (
        <Checkbox
          checked={r.row.pass}
          onCheckedChange={(v) => setRows((rs) => rs.map((x, i) => (i === r.idx ? { ...x, pass: v === true } : x)))}
        />
      ),
    },
    {
      key: "verdict", header: "Auto verdict",
      render: (r) =>
        r.row.value.trim() ? (
          <StatusBadge status={r.row.pass ? "PASSED" : "FAILED"} />
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        ),
    },
  ];

  if (!inspection) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-zinc-950 border-border/80 max-h-[88vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            IQC result — <Mono className="text-primary">{inspection.inspNumber}</Mono>
            <StatusBadge status={inspection.status} />
          </DialogTitle>
          <DialogDescription>
            Template <Mono>{inspection.templateCode || "—"}</Mono>. Submission is <b>immutable</b> and dispositions the GRN
            line; lots move WH-IQC → WH-ACC / WH-REJ automatically.
          </DialogDescription>
        </DialogHeader>

        {line && (
          <KeyValue
            items={[
              { k: "Item", v: <span><Mono className="text-primary">{line.item.partNumber}</Mono> · {line.item.name}</span> },
              { k: "Received qty", v: <span className="tabular">{line.qty} {line.item.uom}</span> },
              { k: "Supplier batch", v: <Mono>{line.supplierBatch || "—"}</Mono> },
              { k: "Mfr ref", v: <Mono>{line.manufacturerRef || "—"}</Mono> },
            ]}
          />
        )}

        <DataTable dense maxHeight="max-h-[34vh]" columns={cols} rows={rows.map((row, idx) => ({ id: `r${idx}`, row, idx }))} rowKey={(r) => r.id} emptyMessage="No template parameters" />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1.5 min-w-56">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Equipment / gauge code</Label>
            <Input className="h-8 text-[12px] w-56" placeholder="e.g. GAUGE-DMM-01" value={equipmentCode} onChange={(e) => setEquipmentCode(e.target.value)} />
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Overall result</p>
            <div className="mt-1"><StatusBadge status={overall === "PASS" ? "PASSED" : "FAILED"} /></div>
          </div>
        </div>

        {err && <p className="text-[12px] text-red-400 border border-red-500/30 bg-red-500/5 rounded-md p-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!allFilled || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Submitting…" : `Submit IQC — ${overall}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
