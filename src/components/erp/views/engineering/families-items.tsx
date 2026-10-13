"use client";
// ============================================================================
// Tau ERP — Engineering ▸ Tab 1: Product Families & Item master
// Family cards (evidence classes + baseline route chips) + items table with
// family/type filters and an add-item dialog (engineering.edit enforced
// server-side; viewers get PermDenied).
// ============================================================================
import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { FAMILIES } from "@/lib/erp/constants";
import { DataTable, KeyValue, Money, Mono, PermDenied, SectionHeader, StatusBadge } from "../../shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label as UiLabel } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ItemDto, ItemsPayload } from "./types";
import { PackageSearch, Plus, Timer } from "lucide-react";

const FAMILY_COLOR: Record<string, string> = Object.fromEntries(FAMILIES.map((f) => [f.code, f.color]));
const ITEM_TYPES = ["RAW", "SUBASSEMBLY", "FINISHED", "CONSUMABLE", "PACKAGING"];

type Props = { data?: ItemsPayload; loading: boolean; canEdit: boolean };

export default function FamiliesItemsTab({ data, loading, canEdit }: Props) {
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const items = data?.items ?? [];
  const families = data?.families ?? [];

  const [famFilter, setFamFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ partNumber: "", name: "", familyCode: "NONE", itemType: "RAW", trackingType: "BATCH", criticality: "STANDARD", uom: "Nos", unitCost: "0", procLeadTimeDays: "" });
  const [leadDraft, setLeadDraft] = useState<string>("");
  const [leadEditing, setLeadEditing] = useState(false);

  const filtered = useMemo(() => items.filter((i) =>
    (famFilter === "ALL" || i.familyCode === famFilter) &&
    (typeFilter === "ALL" || i.itemType === typeFilter) &&
    (!search || `${i.partNumber} ${i.name}`.toLowerCase().includes(search.toLowerCase()))
  ), [items, famFilter, typeFilter, search]);

  const createItem = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api("/api/items", { method: "POST", body: payload }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["items"] });
      toast(`Item ${String(v.partNumber)} created`);
      setAddOpen(false);
      setForm({ partNumber: "", name: "", familyCode: "NONE", itemType: "RAW", trackingType: "BATCH", criticality: "STANDARD", uom: "Nos", unitCost: "0", procLeadTimeDays: "" });
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const saveLead = useMutation({
    mutationFn: (p: { id: string; procLeadTimeDays: number | null }) => api("/api/items", { method: "PATCH", body: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      toast("Procurement lead time saved (audited) — feeds MRP PO ETA");
      setLeadEditing(false);
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const submitItem = () => {
    if (!form.partNumber.trim() || !form.name.trim()) {
      toast("Part number and name are required", "err");
      return;
    }
    if (form.procLeadTimeDays && (!/^[0-9]+$/.test(form.procLeadTimeDays) || Number(form.procLeadTimeDays) < 1 || Number(form.procLeadTimeDays) > 365)) {
      toast("Procurement lead time must be 1–365 whole days", "err");
      return;
    }
    createItem.mutate({
      partNumber: form.partNumber.trim().toUpperCase(),
      name: form.name.trim(),
      familyCode: form.familyCode === "NONE" ? "" : form.familyCode,
      itemType: form.itemType,
      trackingType: form.trackingType,
      criticality: form.criticality,
      uom: form.uom,
      unitCost: Number(form.unitCost) || 0,
      ...(form.procLeadTimeDays ? { procLeadTimeDays: Number(form.procLeadTimeDays) } : {}),
    });
  };

  const openDetail = (r: ItemDto) => {
    setSelectedId(r.id);
    setLeadEditing(false);
    setLeadDraft(r.procLeadTimeDays != null ? String(r.procLeadTimeDays) : "");
  };

  // derived from the live query — dialog refreshes after proc-lead saves invalidate "items"
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const leadValid = leadDraft === "" || (/^[0-9]+$/.test(leadDraft) && Number(leadDraft) >= 1 && Number(leadDraft) <= 365);

  return (
    <div className="space-y-4">
      {/* ---------------- FAMILY CARDS ---------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {loading && Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-44 rounded-lg border bg-card animate-pulse" />)}
        {!loading && families.map((f) => (
          <Card key={f.id} className="bg-card/80 border-border/70">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: FAMILY_COLOR[f.code] ?? "#a1a1aa" }} />
                <p className="font-semibold text-[13px] leading-tight">{f.name}</p>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug min-h-[3em]">{f.description}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">Evidence classes</p>
              <div className="flex flex-wrap gap-1">
                {f.evidenceClasses.map((e) => (
                  <span key={e} className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">{e}</span>
                ))}
              </div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">Baseline route</p>
              <div className="flex flex-wrap gap-1">
                {f.routeBaseline.map((step, idx) => (
                  <span key={`${f.code}-step-${idx}`} className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-mono">
                    {idx + 1}·{step}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ---------------- ITEMS TABLE ---------------- */}
      <SectionHeader
        icon={PackageSearch}
        title="Item master"
        desc={`${filtered.length} of ${items.length} items — raw, subassemblies, finished sensors, packaging`}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add item
            </Button>
          ) : undefined
        }
      />
      {!canEdit && (
        <PermDenied perm="engineering.edit" />
      )}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Input placeholder="Search part number / name…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-56 text-[12px]" />
        <Select value={famFilter} onValueChange={setFamFilter}>
          <SelectTrigger className="h-8 w-40 text-[12px]"><SelectValue placeholder="Family" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All families</SelectItem>
            {families.map((f) => <SelectItem key={f.code} value={f.code}>{f.code}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-40 text-[12px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <DataTable<ItemDto>
        columns={[
          { key: "partNumber", header: "Part number", render: (r) => <Mono className="text-primary font-medium">{r.partNumber}</Mono> },
          { key: "name", header: "Name", render: (r) => <span className="text-[12px]">{r.name}</span> },
          { key: "familyCode", header: "Family", render: (r) => r.familyCode ? <span className="text-[12px]">{r.familyCode}</span> : <span className="text-muted-foreground text-[11px]">—</span> },
          { key: "itemType", header: "Type", render: (r) => <span className="text-[11px] rounded bg-muted px-1.5 py-0.5">{r.itemType}</span> },
          { key: "trackingType", header: "Tracking", render: (r) => <Mono className="text-muted-foreground">{r.trackingType}</Mono> },
          { key: "criticality", header: "Criticality", render: (r) => <StatusBadge status={r.criticality} /> },
          { key: "unitCost", header: "Unit cost", className: "text-right", render: (r) => <Money value={r.unitCost} className="text-[12px]" /> },
          {
            key: "procLead", header: "Proc lead",
            render: (r) =>
              r.procLeadTimeDays != null ? (
                <span
                  className="inline-flex items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10.5px] text-teal-300"
                  title="Per-item procurement lead time — data-driven source for MRP purchase-order ETA"
                >
                  <Timer className="h-3 w-3" /> {r.procLeadTimeDays}d
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground" title="No item-master lead — MRP ETA falls back to quotation lead or the 7/14-day default">—</span>
              ),
          },
          { key: "revision", header: "Rev", render: (r) => <Mono>{r.revision}</Mono> },
          { key: "lifecycle", header: "Lifecycle", render: (r) => <StatusBadge status={r.lifecycle} /> },
        ]}
        rows={filtered}
        loading={loading}
        rowKey={(r) => r.id}
        onRowClick={(r) => openDetail(r)}
        emptyMessage="No items match the filters"
      />

      {/* ---------------- ITEM DETAIL DIALOG ---------------- */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mono className="text-primary">{selected?.partNumber}</Mono> — {selected?.name}
            </DialogTitle>
            <DialogDescription>
              Item master record — specifications, planning parameters and lifecycle state.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <KeyValue items={[
                { k: "Family", v: selected.familyCode || "—" },
                { k: "Type", v: selected.itemType },
                { k: "Tracking", v: <Mono>{selected.trackingType}</Mono> },
                { k: "Criticality", v: <StatusBadge status={selected.criticality} /> },
                { k: "UoM", v: selected.uom },
                { k: "Unit cost", v: <Money value={selected.unitCost} /> },
                { k: "Proc lead", v: leadEditing ? (
                  <span className="flex items-center gap-1.5">
                    <Input
                      className="h-7 w-20 tabular text-[12px]" type="number" min={1} max={365}
                      value={leadDraft} autoFocus
                      onChange={(e) => setLeadDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && leadValid && canEdit) saveLead.mutate({ id: selected.id, procLeadTimeDays: leadDraft === "" ? null : Number(leadDraft) });
                        if (e.key === "Escape") setLeadEditing(false);
                      }}
                    />
                    <span className="text-[11px] text-muted-foreground">days (1–365, blank = clear)</span>
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={!leadValid || saveLead.isPending}
                      onClick={() => saveLead.mutate({ id: selected.id, procLeadTimeDays: leadDraft === "" ? null : Number(leadDraft) })}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setLeadEditing(false)}>Cancel</Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    {selected.procLeadTimeDays != null ? (
                      <span className="inline-flex items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[11px] text-teal-300">
                        <Timer className="h-3 w-3" /> {selected.procLeadTimeDays} days
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">not set — MRP ETA uses quotation lead or 7/14-day default</span>
                    )}
                    {canEdit && (
                      <button className="text-[11px] text-primary hover:underline" onClick={() => { setLeadEditing(true); setLeadDraft(selected.procLeadTimeDays != null ? String(selected.procLeadTimeDays) : ""); }}>
                        edit
                      </button>
                    )}
                  </span>
                ) },
                { k: "Revision", v: <Mono>{selected.revision}</Mono> },
                { k: "Lifecycle", v: <StatusBadge status={selected.lifecycle} /> },
                { k: "HSN (synthetic)", v: <Mono>{selected.hsnCode}</Mono> },
                { k: "GST rate (synthetic)", v: `${selected.gstRate}%` },
              ]} />
              <p className="text-[11px] text-muted-foreground">HSN/GST values are synthetic placeholders — pending Finance/CA approval (Decision Register DR-001). Proc-lead edits are audited and feed MRP create-pos: quotation lead → item master → 7/14-day default.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------------- ADD ITEM DIALOG ---------------- */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New item master record</DialogTitle>
            <DialogDescription>
              Create a part with its planning parameters. Items start as NEW until engineering activates them.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">Part number *</UiLabel>
              <Input className="h-8 font-mono text-[12px]" placeholder="RM-XXXX-01" value={form.partNumber}
                onChange={(e) => setForm({ ...form, partNumber: e.target.value.toUpperCase() })} />
            </div>
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">Name *</UiLabel>
              <Input className="h-8 text-[12px]" placeholder="Ceramic element v2" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">Family</UiLabel>
              <Select value={form.familyCode} onValueChange={(v) => setForm({ ...form, familyCode: v })}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— none (raw/packaging) —</SelectItem>
                  {families.map((f) => <SelectItem key={f.code} value={f.code}>{f.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">Item type</UiLabel>
              <Select value={form.itemType} onValueChange={(v) => setForm({ ...form, itemType: v })}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>{ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">Tracking</UiLabel>
              <Select value={form.trackingType} onValueChange={(v) => setForm({ ...form, trackingType: v })}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>{["SERIAL", "BATCH", "NONE"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">Criticality</UiLabel>
              <Select value={form.criticality} onValueChange={(v) => setForm({ ...form, criticality: v })}>
                <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>{["CRITICAL", "STANDARD"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">UoM</UiLabel>
              <Input className="h-8 text-[12px]" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">Unit cost (₹)</UiLabel>
              <Input className="h-8 text-[12px] tabular" type="number" min="0" step="0.01" value={form.unitCost}
                onChange={(e) => setForm({ ...form, unitCost: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <UiLabel className="text-[11px]">Proc lead (days)</UiLabel>
              <Input className="h-8 text-[12px] tabular" type="number" min="1" max="365" placeholder="e.g. 21" value={form.procLeadTimeDays}
                onChange={(e) => setForm({ ...form, procLeadTimeDays: e.target.value })} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Proc lead = per-item procurement lead time used for purchase-order ETA in MRP shortage conversion (1–365 days, optional).</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={submitItem} disabled={createItem.isPending}>
              {createItem.isPending ? "Creating…" : "Create item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
