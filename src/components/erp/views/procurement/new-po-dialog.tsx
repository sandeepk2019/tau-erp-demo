"use client";
// ============================================================================
// Tau ERP — Procurement (Task 3-b): "New Purchase Order" dialog.
// Supplier select + editable line items. Server enforces the spec acceptance
// rule: CRITICAL items cannot be purchased from an unapproved supplier (422).
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money, Mono } from "../../shared";
import type { ItemMaster, SupplierRow } from "./types";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";

type LineDraft = { itemId: string; qty: string; unitPrice: string };

const blankLine = (): LineDraft => ({ itemId: "", qty: "", unitPrice: "" });

export default function NewPoDialog({
  open, onOpenChange, suppliers, items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suppliers: SupplierRow[];
  items: ItemMaster[];
}) {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [submit, setSubmit] = useState(true);
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [err, setErr] = useState("");

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const supplier = suppliers.find((s) => s.id === supplierId) ?? null;
  const unapprovedCritical = !!supplier && !supplier.approved && lines.some((l) => itemsById.get(l.itemId)?.criticality === "CRITICAL");

  const totals = useMemo(() => {
    let exGst = 0, gst = 0;
    for (const l of lines) {
      const qty = parseFloat(l.qty), price = parseFloat(l.unitPrice);
      if (Number.isFinite(qty) && Number.isFinite(price)) {
        exGst += qty * price;
        gst += qty * price * ((itemsById.get(l.itemId)?.gstRate ?? 18) / 100);
      }
    }
    return { exGst, gst, grand: exGst + gst };
  }, [lines, itemsById]);

  const mut = useMutation({
    mutationFn: () =>
      api("/api/purchase-orders", {
        method: "POST",
        body: {
          supplierId,
          expectedDate: expectedDate || undefined,
          submit,
          lines: lines.map((l) => ({
            itemId: l.itemId,
            qty: Number(l.qty),
            unitPrice: Number(l.unitPrice || itemsById.get(l.itemId)?.unitCost || 0),
          })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      useErpStore.getState().toast("Purchase order created");
      onOpenChange(false);
    },
    onError: (e: Error) => {
      setErr(e.message);
      useErpStore.getState().toast(e.message, "err");
    },
  });

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const valid =
    !!supplierId &&
    lines.length > 0 &&
    lines.every((l) => l.itemId && Number(l.qty) > 0 && Number(l.unitPrice || itemsById.get(l.itemId)?.unitCost || 0) >= 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-zinc-950 border-border/80 max-h-[88vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle>New Purchase Order</DialogTitle>
          <DialogDescription>
            Lines priced ex-GST; item GST rate is applied per line. Submitting routes the PO into the four-eyes approval queue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Supplier</Label>
              <Select value={supplierId || undefined} onValueChange={(v) => setSupplierId(v)}>
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
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Expected delivery</Label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
          </div>

          {supplier && !supplier.approved && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[12px] text-amber-300">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                <Mono>{supplier.code}</Mono> is <b>not approved</b>. CRITICAL (controlled) items will be rejected by the
                server — &quot;Controlled item cannot be purchased from unapproved supplier (spec acceptance test)&quot;.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Lines</Label>
            {lines.map((l, i) => {
              const item = itemsById.get(l.itemId);
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-center rounded-md border border-border/50 p-2">
                  <div className="col-span-12 sm:col-span-5">
                    <Select
                      value={l.itemId || undefined}
                      onValueChange={(v) => {
                        const it = itemsById.get(v);
                        setLine(i, { itemId: v, unitPrice: l.unitPrice || (it ? String(it.unitCost) : "") });
                      }}
                    >
                      <SelectTrigger className="w-full h-8 text-[12px]">
                        <SelectValue placeholder="Select item…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {items.map((it) => (
                          <SelectItem key={it.id} value={it.id}>
                            <span className="flex items-center gap-2">
                              <Mono>{it.partNumber}</Mono>
                              <span className="text-muted-foreground truncate max-w-52">{it.name}</span>
                              {it.criticality === "CRITICAL" && <span className="text-[10px] text-red-400">CTL</span>}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-4 sm:col-span-2 flex items-center gap-1">
                    <Input
                      type="number" min="0" step="any" placeholder="Qty"
                      className="h-8 text-[12px]" value={l.qty}
                      onChange={(e) => setLine(i, { qty: e.target.value })}
                    />
                    <span className="text-[10px] text-muted-foreground w-8">{item?.uom ?? ""}</span>
                  </div>
                  <div className="col-span-5 sm:col-span-3">
                    <Input
                      type="number" min="0" step="any" placeholder="Unit price ₹"
                      className="h-8 text-[12px]" value={l.unitPrice}
                      onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2 flex items-center justify-between gap-1">
                    <span className="text-[11px] text-muted-foreground tabular">
                      {item && Number(l.qty) > 0 ? <Money value={Number(l.qty || 0) * Number(l.unitPrice || item.unitCost)} /> : "—"}
                    </span>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300"
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => setLines((ls) => [...ls, blankLine()])}>
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border/50 bg-background/40 p-3">
            <div className="flex items-center gap-2">
              <Checkbox id="po-submit" checked={submit} onCheckedChange={(v) => setSubmit(v === true)} />
              <Label htmlFor="po-submit" className="text-[12px] cursor-pointer">
                Submit for approval <span className="text-muted-foreground">(unchecked → save as DRAFT)</span>
              </Label>
            </div>
            <div className="text-right text-[12px] space-y-0.5">
              <p className="text-muted-foreground">ex-GST <Money value={totals.exGst} /></p>
              <p className="text-muted-foreground">GST <Money value={totals.gst} /></p>
              <p className="font-medium">Total <Money value={totals.grand} /></p>
            </div>
          </div>

          {err && <p className="text-[12px] text-red-400 border border-red-500/30 bg-red-500/5 rounded-md p-2">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Saving…" : submit ? "Create & submit" : "Create DRAFT PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
