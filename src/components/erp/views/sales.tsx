"use client";
// ============================================================================
// Tau ERP — Sales & Compliance (Task 3-f)
// Quotations → Sales Orders → Delivery & Packing → GST Invoices (synthetic
// e-Invoice/IRN with idempotency) → Notifications.
// All fiscal screens carry the SYNTHETIC — NOT FOR STATUTORY USE banner and
// the .watermark overlay (spec environment rule).
// ============================================================================
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { COMPANY, SYNTHETIC_NOTICE, hasPerm } from "@/lib/erp/constants";
import {
  DataTable, DateCell, EmptyState, KeyValue, Money, Mono, PermDenied, Progress,
  SectionHeader, StatCard, StatusBadge, SubTabs, SyntheticBadge,
} from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle, BadgeCheck, Boxes, Check, ClipboardList, FileText, FileWarning,
  Landmark, PackageCheck, Plus, Printer, RefreshCcw, Send, Settings2, ShoppingCart, Trash2, Truck, X,
} from "lucide-react";
import NotificationPrefsDialog from "../notification-prefs-dialog";

// ---------------------------------------------------------------------------
// Types (API shapes)
// ---------------------------------------------------------------------------
type Customer = { id: string; code: string; name: string; gstin: string; city: string; programme: string };
type ItemM = { id: string; partNumber: string; name: string; uom: string; unitCost: number; gstRate: number; itemType: string; trackingType?: string };

type QuoteLineT = { id: string; itemId: string; qty: number; unitPrice: number; item: ItemM };
type QuotationT = {
  id: string; quoteNumber: string; customerId: string; customer: Customer | null; status: string;
  validUntil: string | null; totalAmount: number; notes: string; createdAt: string; lines: QuoteLineT[];
};
type QuotesData = { quotations: QuotationT[]; customers: Customer[]; items: ItemM[] };

type SoLineT = { id: string; itemId: string; qty: number; unitPrice: number; gstRate: number; deliveredQty: number; item: ItemM };
type SalesOrderT = {
  id: string; soNumber: string; customer: Customer | null; status: string; orderDate: string;
  totalAmount: number; programme: string; lines: SoLineT[]; woLinks: { woNumber: string; status: string }[];
};
type SosData = { salesOrders: SalesOrderT[]; fgCounts: Record<string, number> };

type DnLineT = { id: string; itemId: string; lotNumber: string; qty: number; item: { id: string; partNumber: string; name: string } };
type DeliveryNoteT = {
  id: string; dnNumber: string; soId: string; soNumber: string; customerName: string; status: string;
  vehicleNo: string; ewayBillNo: string; dispatchedAt: string | null; lines: DnLineT[];
};
type EligibleSoT = {
  id: string; soNumber: string; customerName: string; programme: string; status: string;
  lines: { id: string; itemId: string; qty: number; deliveredQty: number; item: { id: string; partNumber: string; name: string; uom: string; trackingType: string } }[];
};
type SerialT = { id: string; lotNumber: string; itemId: string; item: { id: string; partNumber: string; name: string }; containerNumber: string | null; containerStatus: string | null };
type DeliveryData = { deliveryNotes: DeliveryNoteT[]; eligibleSOs: EligibleSoT[]; availableSerials: SerialT[] };

type InvLineT = { itemId: string; lotNumber: string; qty: number; unitPrice: number; taxable: number; gstRate: number; hsnCode: string; partNumber: string; name: string; uom: string };
type EInvLogT = { id: string; correlationId: string; mode: string; status: string; attempts: number; errorMessage: string; createdAt: string };
type InvoiceT = {
  id: string; invoiceNumber: string; dnNumber: string; soNumber: string;
  customer: { id: string; name: string; code: string; gstin: string; city: string; state: string };
  taxableValue: number; cgst: number; sgst: number; igst: number; total: number; placeOfSupply: string;
  status: string; irn: string; irnAt: string | null; qr: Record<string, unknown>; synthetic: boolean;
  createdAt: string; lines: InvLineT[]; logs: EInvLogT[];
};
type EligibleDnT = { id: string; dnNumber: string; soNumber: string; customerName: string; customerGstin: string; serialCount: number; dispatchedAt: string | null };
type InvoicesData = { invoices: InvoiceT[]; eligibleDNs: EligibleDnT[] };

type NotificationT = {
  id: string; userId: string | null; role: string; kind: string; severity: string; title: string;
  message: string; refType: string; refId: string; readAt: string | null; createdAt: string; muted?: boolean;
};
type NotifPrefsT = { mutedKinds: string[]; minSeverity: "ALL" | "WARNING" | "CRITICAL"; digest: boolean };
type NotificationsData = { notifications: NotificationT[]; unread: number; hiddenCount: number; totalStored: number; prefs: NotifPrefsT };

const round2 = (n: number) => Math.round(n * 100) / 100;
const dt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const SEV_TONE: Record<string, "default" | "good" | "warn" | "bad"> = { CRITICAL: "bad", WARNING: "warn", INFO: "default" };

function SyntheticBanner() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] font-medium text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {SYNTHETIC_NOTICE}
    </div>
  );
}

// ===========================================================================
// TAB 1 — QUOTATIONS
// ===========================================================================
function QuotationsTab({ canCreate }: { canCreate: boolean }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const { data, isLoading } = useQuery<QuotesData>({ queryKey: ["quotations"], queryFn: () => api<QuotesData>("/api/quotations") });
  const [selId, setSelId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [nqCustomer, setNqCustomer] = useState("");
  const [nqValidUntil, setNqValidUntil] = useState("");
  const [nqNotes, setNqNotes] = useState("");
  type NqLine = { itemId: string; qty: string; price: string };
  const [nqLines, setNqLines] = useState<NqLine[]>([{ itemId: "", qty: "1", price: "" }]);

  const sel = (data?.quotations ?? []).find((q) => q.id === selId) ?? null;
  const items = data?.items ?? [];
  const priceOf = (itemId: string) => round2((items.find((i) => i.id === itemId)?.unitCost ?? 0) * 1.15);
  const nqTotal = nqLines.reduce((s, l) => s + Number(l.qty || 0) * (l.price !== "" ? Number(l.price) : priceOf(l.itemId)), 0);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["quotations"] });
    void qc.invalidateQueries({ queryKey: ["sales-orders"] });
  };
  const createQuote = useMutation({
    mutationFn: () =>
      api("/api/quotations", {
        method: "POST",
        body: {
          customerId: nqCustomer,
          validUntil: nqValidUntil || null,
          notes: nqNotes,
          lines: nqLines
            .filter((l) => l.itemId && Number(l.qty) > 0)
            .map((l) => ({ itemId: l.itemId, qty: Number(l.qty), ...(l.price !== "" ? { unitPrice: Number(l.price) } : {}) })),
        },
      }),
    onSuccess: () => {
      toast("Quotation created (DRAFT)");
      setNewOpen(false);
      setNqCustomer(""); setNqValidUntil(""); setNqNotes(""); setNqLines([{ itemId: "", qty: "1", price: "" }]);
      invalidate();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const quoteAction = useMutation({
    mutationFn: (v: { id: string; action: string }) => api<{ quotation?: QuotationT; salesOrder?: { soNumber: string; status: string } }>("/api/quotations", { method: "PATCH", body: v }),
    onSuccess: (res, v) => {
      if (v.action === "convert" && res.salesOrder) toast(`Converted → ${res.salesOrder.soNumber} (CONFIRMED)`);
      else toast(`Quotation ${v.action === "send" ? "sent" : v.action === "accept" ? "accepted" : "rejected"}`);
      invalidate();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const quotes = data?.quotations ?? [];
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canCreate && (
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> New quotation
          </Button>
        )}
      </div>
      <DataTable<QuotationT>
        rows={quotes}
        loading={isLoading}
        emptyMessage="No quotations yet — create one to start the order-to-cash flow"
        onRowClick={(q) => setSelId(q.id)}
        columns={[
          { key: "quoteNumber", header: "Quote #", render: (q) => <Mono className="text-primary">{q.quoteNumber}</Mono> },
          { key: "customer", header: "Customer", render: (q) => <span>{q.customer?.name ?? "—"} <span className="text-muted-foreground text-[11px]">{q.customer?.code}</span></span> },
          { key: "status", header: "Status", render: (q) => <StatusBadge status={q.status} /> },
          { key: "totalAmount", header: "Total", className: "text-right", render: (q) => <Money value={q.totalAmount} /> },
          { key: "validUntil", header: "Valid until", render: (q) => <DateCell value={q.validUntil} /> },
          { key: "created", header: "Created", render: (q) => <DateCell value={q.createdAt} /> },
          { key: "lines", header: "Lines", render: (q) => <span className="tabular text-[12px]">{q.lines.length}</span> },
        ]}
      />

      {/* Detail dialog */}
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSelId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto erp-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mono className="text-primary">{sel?.quoteNumber}</Mono> <StatusBadge status={sel?.status ?? ""} />
              <SyntheticBadge className="ml-auto" />
            </DialogTitle>
            <DialogDescription>Quotation detail — prices default to unit cost × 1.15 (synthetic)</DialogDescription>
          </DialogHeader>
          {sel && (
            <div className="space-y-4">
              <KeyValue
                items={[
                  { k: "Customer", v: sel.customer ? `${sel.customer.name} (${sel.customer.code})` : "—" },
                  { k: "GSTIN (synthetic)", v: <Mono>{sel.customer?.gstin || "—"}</Mono> },
                  { k: "Programme", v: sel.customer?.programme || "—" },
                  { k: "Valid until", v: <DateCell value={sel.validUntil} /> },
                  { k: "Created", v: dt(sel.createdAt) },
                  { k: "Total", v: <Money value={sel.totalAmount} className="font-semibold" /> },
                ]}
              />
              {sel.notes && <p className="text-[12px] text-muted-foreground border-l-2 border-border pl-2">{sel.notes}</p>}
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-zinc-900/80 text-muted-foreground text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-1.5">Item</th>
                      <th className="text-right px-3 py-1.5">Qty</th>
                      <th className="text-right px-3 py-1.5">Unit price</th>
                      <th className="text-right px-3 py-1.5">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sel.lines.map((l) => (
                      <tr key={l.id} className="border-t border-border/50">
                        <td className="px-3 py-1.5"><Mono className="text-primary">{l.item.partNumber}</Mono> <span className="text-muted-foreground">{l.item.name}</span></td>
                        <td className="px-3 py-1.5 text-right tabular">{l.qty} {l.item.uom}</td>
                        <td className="px-3 py-1.5 text-right"><Money value={l.unitPrice} /></td>
                        <td className="px-3 py-1.5 text-right"><Money value={l.qty * l.unitPrice} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canCreate && (
                <div className="flex flex-wrap gap-2 justify-end border-t border-border/40 pt-3">
                  {sel.status === "DRAFT" && (
                    <Button size="sm" variant="outline" disabled={quoteAction.isPending} onClick={() => quoteAction.mutate({ id: sel.id, action: "send" })}>
                      <Send className="h-3.5 w-3.5" /> Mark as SENT
                    </Button>
                  )}
                  {sel.status === "SENT" && (
                    <>
                      <Button size="sm" variant="outline" disabled={quoteAction.isPending} onClick={() => quoteAction.mutate({ id: sel.id, action: "reject" })}>
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <Button size="sm" disabled={quoteAction.isPending} onClick={() => quoteAction.mutate({ id: sel.id, action: "accept" })}>
                        <Check className="h-3.5 w-3.5" /> Mark ACCEPTED
                      </Button>
                    </>
                  )}
                  {sel.status === "ACCEPTED" && (
                    <Button size="sm" disabled={quoteAction.isPending} onClick={() => quoteAction.mutate({ id: sel.id, action: "convert" })}>
                      <ShoppingCart className="h-3.5 w-3.5" /> Convert to Sales Order
                    </Button>
                  )}
                  {sel.status === "CONVERTED" && <p className="text-[12px] text-emerald-300 self-center">Converted to a CONFIRMED sales order.</p>}
                  {sel.status === "REJECTED" && <p className="text-[12px] text-red-300 self-center">Rejected by customer.</p>}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* New quotation dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto erp-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">New quotation <SyntheticBadge className="ml-auto" /></DialogTitle>
            <DialogDescription>Unit price defaults to item unit cost × 1.15 — override if needed (synthetic pricing).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={nqCustomer} onValueChange={setNqCustomer}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>
                    {(data?.customers ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} · {c.code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Valid until</Label>
                <Input type="date" value={nqValidUntil} onChange={(e) => setNqValidUntil(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Lines</Label>
                <Button size="sm" variant="outline" onClick={() => setNqLines((ls) => [...ls, { itemId: "", qty: "1", price: "" }])}>
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              </div>
              {nqLines.map((l, idx) => {
                const item = items.find((i) => i.id === l.itemId);
                const eff = l.price !== "" ? Number(l.price) : priceOf(l.itemId);
                return (
                  <div key={idx} className="grid grid-cols-[1fr_72px_104px_96px_32px] gap-2 items-center rounded-md border border-border/50 p-2">
                    <Select value={l.itemId} onValueChange={(v) => setNqLines((ls) => ls.map((x, i) => (i === idx ? { ...x, itemId: v, price: "" } : x)))}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.itemType === "FINISHED" ? "★ " : ""}{i.partNumber} — {i.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input inputMode="numeric" placeholder="qty" value={l.qty} onChange={(e) => setNqLines((ls) => ls.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} />
                    <Input inputMode="decimal" placeholder={item ? String(priceOf(l.itemId)) : "price"} value={l.price} onChange={(e) => setNqLines((ls) => ls.map((x, i) => (i === idx ? { ...x, price: e.target.value } : x)))} />
                    <span className="text-right text-[12px]"><Money value={Number(l.qty || 0) * eff} /></span>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setNqLines((ls) => ls.filter((_, i) => i !== idx))} aria-label="Remove line">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={nqNotes} onChange={(e) => setNqNotes(e.target.value)} placeholder="Programme / commercial notes" />
            </div>
            <div className="flex items-center justify-between border-t border-border/40 pt-3">
              <span className="text-[13px] text-muted-foreground">Quote total</span>
              <Money value={round2(nqTotal)} className="text-lg font-semibold" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button disabled={!nqCustomer || createQuote.isPending || nqTotal <= 0} onClick={() => createQuote.mutate()}>
              {createQuote.isPending ? "Creating…" : "Create quotation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================================================================
// TAB 2 — SALES ORDERS
// ===========================================================================
function SalesOrdersTab({ canCreate }: { canCreate: boolean }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const { data, isLoading } = useQuery<SosData>({ queryKey: ["sales-orders"], queryFn: () => api<SosData>("/api/sales-orders") });
  const [selId, setSelId] = useState<string | null>(null);
  const sel = (data?.salesOrders ?? []).find((s) => s.id === selId) ?? null;

  const soAction = useMutation({
    mutationFn: (v: { id: string; action: string }) => api<{ soNumber: string; status: string }>("/api/sales-orders", { method: "PATCH", body: v }),
    onSuccess: (res) => {
      toast(`${res.soNumber} → ${res.status.replace(/_/g, " ")}`);
      void qc.invalidateQueries({ queryKey: ["sales-orders"] });
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const sos = data?.salesOrders ?? [];
  return (
    <div className="space-y-3">
      <DataTable<SalesOrderT>
        rows={sos}
        loading={isLoading}
        emptyMessage="No sales orders — convert an accepted quotation"
        onRowClick={(s) => setSelId(s.id)}
        columns={[
          { key: "soNumber", header: "SO #", render: (s) => <Mono className="text-primary">{s.soNumber}</Mono> },
          { key: "customer", header: "Customer", render: (s) => <span>{s.customer?.name ?? "—"} <span className="text-muted-foreground text-[11px]">{s.customer?.code}</span></span> },
          { key: "status", header: "Status", render: (s) => <StatusBadge status={s.status} /> },
          { key: "totalAmount", header: "Total", className: "text-right", render: (s) => <Money value={s.totalAmount} /> },
          { key: "programme", header: "Programme", render: (s) => <Mono>{s.programme || "—"}</Mono> },
          { key: "lines", header: "Lines", render: (s) => <span className="tabular text-[12px]">{s.lines.length}</span> },
          {
            key: "delivery", header: "Delivered",
            render: (s) => {
              const qty = s.lines.reduce((a, l) => a + l.qty, 0);
              const del = s.lines.reduce((a, l) => a + l.deliveredQty, 0);
              return qty > 0 ? (
                <div className="flex items-center gap-2 w-28">
                  <Progress value={(del / qty) * 100} tone={del >= qty ? "good" : "primary"} />
                  <span className="tabular text-[11px] text-muted-foreground whitespace-nowrap">{del}/{qty}</span>
                </div>
              ) : "—";
            },
          },
          { key: "wo", header: "Linked WOs", render: (s) => s.woLinks.length ? <Mono className="text-[11px]">{s.woLinks.map((w) => w.woNumber).join(", ")}</Mono> : <span className="text-muted-foreground text-[12px]">—</span> },
        ]}
      />

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSelId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto erp-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mono className="text-primary">{sel?.soNumber}</Mono> <StatusBadge status={sel?.status ?? ""} /></DialogTitle>
            <DialogDescription>Sales order — line delivery progress &amp; lifecycle actions</DialogDescription>
          </DialogHeader>
          {sel && (
            <div className="space-y-4">
              <KeyValue
                items={[
                  { k: "Customer", v: sel.customer ? `${sel.customer.name} (${sel.customer.code})` : "—" },
                  { k: "Order date", v: <DateCell value={sel.orderDate} /> },
                  { k: "Programme", v: sel.programme || "—" },
                  { k: "Total", v: <Money value={sel.totalAmount} className="font-semibold" /> },
                  { k: "Linked WOs", v: sel.woLinks.length ? <span>{sel.woLinks.map((w) => <Mono key={w.woNumber} className="mr-1 text-primary">{w.woNumber}</Mono>)}</span> : "—" },
                  { k: "Status", v: <StatusBadge status={sel.status} /> },
                ]}
              />
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-zinc-900/80 text-muted-foreground text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-1.5">Item</th>
                      <th className="text-right px-3 py-1.5">Qty</th>
                      <th className="text-right px-3 py-1.5">Delivered</th>
                      <th className="text-right px-3 py-1.5">Unit price</th>
                      <th className="text-right px-3 py-1.5">GST %</th>
                      <th className="text-right px-3 py-1.5">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sel.lines.map((l) => (
                      <tr key={l.id} className="border-t border-border/50">
                        <td className="px-3 py-1.5"><Mono className="text-primary">{l.item.partNumber}</Mono> <span className="text-muted-foreground">{l.item.name}</span></td>
                        <td className="px-3 py-1.5 text-right tabular">{l.qty}</td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16"><Progress value={(l.deliveredQty / Math.max(1, l.qty)) * 100} tone={l.deliveredQty >= l.qty ? "good" : "primary"} /></div>
                            <span className="tabular text-[11px]">{l.deliveredQty}/{l.qty}</span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right"><Money value={l.unitPrice} /></td>
                        <td className="px-3 py-1.5 text-right tabular">{l.gstRate}%</td>
                        <td className="px-3 py-1.5 text-right"><Money value={l.qty * l.unitPrice} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canCreate && (
                <div className="flex flex-wrap gap-2 justify-end border-t border-border/40 pt-3">
                  {sel.status === "CONFIRMED" && (
                    <Button size="sm" variant="outline" disabled={soAction.isPending} onClick={() => soAction.mutate({ id: sel.id, action: "in_production" })}>
                      <ClipboardList className="h-3.5 w-3.5" /> Move to IN_PRODUCTION
                    </Button>
                  )}
                  {sel.status === "IN_PRODUCTION" && (
                    <Button size="sm" disabled={soAction.isPending} onClick={() => soAction.mutate({ id: sel.id, action: "ready" })}>
                      <PackageCheck className="h-3.5 w-3.5" /> Mark READY (checks FG serials in WH-FG)
                    </Button>
                  )}
                  {["DISPATCHED", "CLOSED", "CANCELLED"].includes(sel.status) && (
                    <p className="text-[12px] text-muted-foreground">Terminal/completed status — no further transitions from here.</p>
                  )}
                  {sel.status === "READY" && <p className="text-[12px] text-emerald-300 self-center">READY — create a delivery note in the Delivery &amp; Packing tab.</p>}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================================================================
// TAB 3 — DELIVERY & PACKING
// ===========================================================================
function DeliveryTab({ canDispatch }: { canDispatch: boolean }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const { data, isLoading } = useQuery<DeliveryData>({ queryKey: ["delivery"], queryFn: () => api<DeliveryData>("/api/delivery") });
  const [selId, setSelId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dnSoId, setDnSoId] = useState("");
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [veh, setVeh] = useState("");
  const [eway, setEway] = useState("");

  const dns = data?.deliveryNotes ?? [];
  const sel = dns.find((d) => d.id === selId) ?? null;
  const eligibleSo = (data?.eligibleSOs ?? []).find((s) => s.id === dnSoId) ?? null;
  const serialsFor = (itemId: string) => (data?.availableSerials ?? []).filter((s) => s.itemId === itemId);
  const pickedCount = Object.values(picked).reduce((a, v) => a + v.length, 0);

  // pick a SO → reset ticks and auto-pick up to the remaining qty per line
  const chooseSo = (soId: string) => {
    setDnSoId(soId);
    setPicked({});
    const so = (data?.eligibleSOs ?? []).find((s) => s.id === soId);
    if (so) {
      const auto: Record<string, string[]> = {};
      for (const line of so.lines) {
        auto[line.itemId] = (data?.availableSerials ?? [])
          .filter((s) => s.itemId === line.itemId)
          .slice(0, Math.max(0, line.qty - line.deliveredQty))
          .map((s) => s.id);
      }
      setPicked(auto);
    }
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["delivery"] });
    void qc.invalidateQueries({ queryKey: ["sales-orders"] });
    void qc.invalidateQueries({ queryKey: ["invoices"] });
  };
  const createDn = useMutation({
    mutationFn: () =>
      api("/api/delivery", {
        method: "POST",
        body: {
          soId: dnSoId,
          lines: Object.entries(picked)
            .filter(([, ids]) => ids.length > 0)
            .map(([itemId, ids]) => ({ itemId, lotIds: ids })),
        },
      }),
    onSuccess: () => {
      toast("Delivery note created — serials reserved (HELD)");
      setCreateOpen(false); setDnSoId(""); setPicked({});
      invalidate();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const dispatch = useMutation({
    mutationFn: (v: { dnId: string; vehicleNo?: string; ewayBillNo?: string }) => api("/api/delivery/dispatch", { method: "POST", body: v }),
    onSuccess: () => {
      toast("Dispatched — serials SHIPPED, SO updated, sales & finance notified");
      setSelId(null); setVeh(""); setEway("");
      invalidate();
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const cancelDn = useMutation({
    mutationFn: (id: string) => api("/api/delivery", { method: "PATCH", body: { id, action: "cancel" } }),
    onSuccess: () => {
      toast("DN cancelled — reserved serials released");
      setSelId(null);
      invalidate();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canDispatch && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create DN (pick serials)
          </Button>
        )}
      </div>
      <DataTable<DeliveryNoteT>
        rows={dns}
        loading={isLoading}
        emptyMessage="No delivery notes — pack a READY or CONFIRMED sales order"
        onRowClick={(d) => setSelId(d.id)}
        columns={[
          { key: "dnNumber", header: "DN #", render: (d) => <Mono className="text-primary">{d.dnNumber}</Mono> },
          { key: "soNumber", header: "SO", render: (d) => <Mono>{d.soNumber || "—"}</Mono> },
          { key: "customerName", header: "Customer", render: (d) => d.customerName || "—" },
          { key: "status", header: "Status", render: (d) => <StatusBadge status={d.status} /> },
          { key: "vehicleNo", header: "Vehicle", render: (d) => <Mono>{d.vehicleNo || "—"}</Mono> },
          { key: "ewayBillNo", header: "E-way bill", render: (d) => <Mono>{d.ewayBillNo || "—"}</Mono> },
          { key: "dispatchedAt", header: "Dispatched", render: (d) => <DateCell value={d.dispatchedAt} /> },
          { key: "serials", header: "Serials", render: (d) => <span className="tabular text-[12px]">{d.lines.length}</span> },
        ]}
      />

      {/* DN detail */}
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSelId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto erp-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mono className="text-primary">{sel?.dnNumber}</Mono> <StatusBadge status={sel?.status ?? ""} /></DialogTitle>
            <DialogDescription>Packing list — serial-tracked delivery lines</DialogDescription>
          </DialogHeader>
          {sel && (
            <div className="space-y-4">
              <KeyValue
                items={[
                  { k: "Sales order", v: <Mono className="text-primary">{sel.soNumber || "—"}</Mono> },
                  { k: "Customer", v: sel.customerName || "—" },
                  { k: "Vehicle", v: <Mono>{sel.vehicleNo || "—"}</Mono> },
                  { k: "E-way bill (synthetic)", v: <Mono>{sel.ewayBillNo || "—"}</Mono> },
                  { k: "Dispatched at", v: sel.dispatchedAt ? dt(sel.dispatchedAt) : "—" },
                  { k: "Status", v: <StatusBadge status={sel.status} /> },
                ]}
              />
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-zinc-900/80 text-muted-foreground text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-1.5">Serial (lot)</th>
                      <th className="text-left px-3 py-1.5">Item</th>
                      <th className="text-right px-3 py-1.5">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sel.lines.map((l) => (
                      <tr key={l.id} className="border-t border-border/50">
                        <td className="px-3 py-1.5"><Mono className="text-primary">{l.lotNumber}</Mono></td>
                        <td className="px-3 py-1.5">{l.item.partNumber} <span className="text-muted-foreground">{l.item.name}</span></td>
                        <td className="px-3 py-1.5 text-right tabular">{l.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canDispatch && !["DISPATCHED", "CANCELLED"].includes(sel.status) && (
                <div className="space-y-3 border-t border-border/40 pt-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Vehicle no.</Label>
                      <Input value={veh} onChange={(e) => setVeh(e.target.value)} placeholder="MH12AB1234" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>E-way bill no. (SYNTHETIC only)</Label>
                      <Input value={eway} onChange={(e) => setEway(e.target.value)} placeholder="EWB-SYNTH-…" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button size="sm" variant="outline" disabled={cancelDn.isPending} onClick={() => cancelDn.mutate(sel.id)}>
                      <X className="h-3.5 w-3.5" /> Cancel DN (release serials)
                    </Button>
                    <Button size="sm" disabled={dispatch.isPending} onClick={() => dispatch.mutate({ dnId: sel.id, vehicleNo: veh || undefined, ewayBillNo: eway || undefined })}>
                      <Truck className="h-3.5 w-3.5" /> {dispatch.isPending ? "Dispatching…" : "Dispatch"}
                    </Button>
                  </div>
                </div>
              )}
              {sel.status === "DISPATCHED" && <p className="text-[12px] text-emerald-300">Dispatched {dt(sel.dispatchedAt)} — raise the GST invoice from the GST Invoices tab.</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create DN */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto erp-scroll">
          <DialogHeader>
            <DialogTitle>Create delivery note</DialogTitle>
            <DialogDescription>Pick a CONFIRMED/READY sales order, then tick serials in WH-FG. Picked serials are reserved (HELD) — double-packing is blocked server-side.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Sales order</Label>
              <Select value={dnSoId} onValueChange={chooseSo}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select sales order" /></SelectTrigger>
                <SelectContent>
                  {(data?.eligibleSOs ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.soNumber} · {s.customerName} · {s.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(data?.eligibleSOs ?? []).length === 0 && (
                <p className="text-[12px] text-muted-foreground">No CONFIRMED/READY sales orders available for packing.</p>
              )}
            </div>
            {eligibleSo && (
              <div className="space-y-3">
                {eligibleSo.lines.map((line) => {
                  const serials = serialsFor(line.itemId);
                  const chosen = picked[line.itemId] ?? [];
                  const remaining = line.qty - line.deliveredQty;
                  return (
                    <div key={line.id} className="rounded-md border border-border/50 p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[13px]">
                          <Mono className="text-primary">{line.item.partNumber}</Mono> <span className="text-muted-foreground">{line.item.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground tabular">remaining {remaining} · available {serials.length}</span>
                          <Button
                            size="sm" variant="outline" className="h-7 text-[11px]"
                            disabled={serials.length === 0 || chosen.length >= remaining}
                            onClick={() => setPicked((p) => ({ ...p, [line.itemId]: serials.slice(0, remaining).map((s) => s.id) }))}
                          >
                            Auto-pick
                          </Button>
                        </div>
                      </div>
                      {serials.length === 0 ? (
                        <p className="text-[11px] text-amber-300/90 flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3" /> No IN_STOCK serials in WH-FG for this item — complete production WOs first.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                          {serials.map((s) => {
                            const checked = chosen.includes(s.id);
                            return (
                              <label key={s.id} className="flex items-center gap-2 rounded border border-border/40 px-2 py-1 text-[12px] cursor-pointer hover:bg-accent/40">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(v) => {
                                    setPicked((p) => {
                                      const cur = p[line.itemId] ?? [];
                                      if (v && cur.length >= remaining) {
                                        toast(`Only ${remaining} serial(s) remaining on ${eligibleSo.soNumber} for this line`, "err");
                                        return p;
                                      }
                                      return { ...p, [line.itemId]: v ? [...cur, s.id] : cur.filter((x) => x !== s.id) };
                                    });
                                  }}
                                />
                                <Mono>{s.lotNumber}</Mono>
                                {s.containerNumber && <span className="ml-auto text-[10px] text-muted-foreground"><Mono>{s.containerNumber}</Mono></span>}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center justify-between border-t border-border/40 pt-3">
                  <span className="text-[12px] text-muted-foreground">{pickedCount} serial(s) selected</span>
                  <Button disabled={pickedCount === 0 || createDn.isPending} onClick={() => createDn.mutate()}>
                    {createDn.isPending ? "Creating…" : "Create DN & reserve serials"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================================================================
// TAB 4 — GST INVOICES (synthetic e-Invoice / IRN)
// ===========================================================================
function InvoicesTab({ canInvoice }: { canInvoice: boolean }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const { data, isLoading } = useQuery<InvoicesData>({ queryKey: ["invoices"], queryFn: () => api<InvoicesData>("/api/invoices") });
  const [selId, setSelId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [invDnId, setInvDnId] = useState("");

  const invoices = data?.invoices ?? [];
  const sel = invoices.find((i) => i.id === selId) ?? null;
  const eligDn = (data?.eligibleDNs ?? []).find((d) => d.id === invDnId) ?? null;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const createInvoice = useMutation({
    mutationFn: () => api("/api/invoices", { method: "POST", body: { dnId: invDnId } }),
    onSuccess: () => {
      toast("GST invoice issued (ISSUED) — generate the e-Invoice next");
      setCreateOpen(false); setInvDnId("");
      invalidate();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const einv = useMutation({
    mutationFn: (v: { invoiceNumber: string; simulate?: string }) =>
      api<{ status: string; cached: boolean; irn?: string; attempts: number; message: string }>("/api/invoices/einvoice", { method: "POST", body: v }),
    onSuccess: (res) => {
      if (res.status === "TIMEOUT") toast(res.message, "err");
      else toast(res.message || (res.cached ? "Duplicate prevented — cached IRN returned" : "IRN generated (SANDBOX_MOCK)"));
      invalidate();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const dupDemo = async (invoiceNumber: string) => {
    // demo duplicate button calls twice — 2nd call must be served from the idempotency cache
    try {
      const r1 = await api<{ status: string; cached: boolean; irn?: string; message: string }>("/api/invoices/einvoice", { method: "POST", body: { invoiceNumber } });
      const r2 = await api<{ status: string; cached: boolean; irn?: string; message: string }>("/api/invoices/einvoice", { method: "POST", body: { invoiceNumber } });
      toast(
        `Call 1: ${r1.cached ? "cached IRN" : "new IRN"} · Call 2: ${r2.cached ? "cached IRN (duplicate prevented by idempotency key)" : "new IRN"}`
      );
      invalidate();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canInvoice && (
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={(data?.eligibleDNs ?? []).length === 0}>
            <Plus className="h-4 w-4" /> Create invoice from DN
          </Button>
        )}
      </div>
      <DataTable<InvoiceT>
        rows={invoices}
        loading={isLoading}
        emptyMessage="No invoices — dispatch a delivery note first"
        onRowClick={(i) => setSelId(i.id)}
        columns={[
          { key: "invoiceNumber", header: "Invoice #", render: (i) => <Mono className="text-primary">{i.invoiceNumber}</Mono> },
          { key: "customer", header: "Customer", render: (i) => <span>{i.customer.name || "—"} <span className="text-muted-foreground text-[11px]">{i.customer.code}</span></span> },
          { key: "taxableValue", header: "Taxable", className: "text-right", render: (i) => <Money value={i.taxableValue} /> },
          { key: "cgst", header: "CGST", className: "text-right", render: (i) => <Money value={i.cgst} /> },
          { key: "sgst", header: "SGST", className: "text-right", render: (i) => <Money value={i.sgst} /> },
          { key: "igst", header: "IGST", className: "text-right", render: (i) => <Money value={i.igst} /> },
          { key: "total", header: "Total", className: "text-right", render: (i) => <Money value={i.total} className="font-semibold" /> },
          { key: "status", header: "Status", render: (i) => <StatusBadge status={i.status} /> },
          { key: "irn", header: "IRN", render: (i) => (i.irn ? <Mono className="text-[11px]">{i.irn.slice(0, 10)}…</Mono> : <span className="text-muted-foreground text-[12px]">—</span>) },
        ]}
      />

      {/* Create invoice from DN */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create GST invoice from delivery note</DialogTitle>
            <DialogDescription>Only DISPATCHED delivery notes without an existing invoice are listed. Taxes: buyer GSTIN prefix 27 (MH, same as seller) → CGST+SGST; otherwise IGST (synthetic rates).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Dispatched delivery note</Label>
              <Select value={invDnId} onValueChange={setInvDnId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select DN" /></SelectTrigger>
                <SelectContent>
                  {(data?.eligibleDNs ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.dnNumber} · {d.soNumber} · {d.customerName} ({d.serialCount} serials)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {eligDn && (
                <p className="text-[12px] text-muted-foreground">
                  Buyer GSTIN <Mono>{eligDn.customerGstin || "—"}</Mono> → place of supply <Mono>{eligDn.customerGstin.slice(0, 2) || "??"}</Mono>
                  {eligDn.customerGstin.slice(0, 2) === COMPANY.state ? " (intra-state: CGST+SGST)" : " (inter-state: IGST)"}
                </p>
              )}
              <SyntheticBanner />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={!invDnId || createInvoice.isPending} onClick={() => createInvoice.mutate()}>
              {createInvoice.isPending ? "Issuing…" : "Issue invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice detail — statutory-style layout with watermark */}
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSelId(null)}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto erp-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Tax Invoice <Mono className="text-primary">{sel?.invoiceNumber}</Mono>
              <StatusBadge status={sel?.status ?? ""} />
              <SyntheticBadge className="ml-auto" />
            </DialogTitle>
            <DialogDescription>Synthetic GST invoice — full layout incl. HSN, tax split, IRN &amp; QR payload</DialogDescription>
          </DialogHeader>
          {sel && (
            <div className="space-y-4">
              <div className="relative overflow-hidden rounded-md border">
                <div className="watermark pointer-events-none absolute inset-0 z-0" />
                <div className="relative z-10 space-y-4 p-4">
                  <SyntheticBanner />
                  {/* seller / buyer */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                    <div className="rounded-md border border-border/50 p-3 space-y-1">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Seller</p>
                      <p className="font-medium">{COMPANY.name}</p>
                      <p className="text-muted-foreground">{COMPANY.address}</p>
                      <p className="text-muted-foreground">Plant {COMPANY.plant} · State {COMPANY.state}</p>
                      <p>GSTIN: <Mono>{COMPANY.gstin}</Mono> <span className="text-amber-300 text-[10px]">(synthetic)</span></p>
                    </div>
                    <div className="rounded-md border border-border/50 p-3 space-y-1">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Buyer (Bill to)</p>
                      <p className="font-medium">{sel.customer.name || "—"} <span className="text-muted-foreground">({sel.customer.code})</span></p>
                      <p className="text-muted-foreground">{sel.customer.city || "—"}</p>
                      <p>GSTIN: <Mono>{sel.customer.gstin || "—"}</Mono></p>
                      <p>Place of supply: <Mono>{sel.placeOfSupply}</Mono></p>
                    </div>
                  </div>
                  {/* doc meta */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                    <div><p className="text-[10px] uppercase text-muted-foreground">Invoice #</p><Mono>{sel.invoiceNumber}</Mono></div>
                    <div><p className="text-[10px] uppercase text-muted-foreground">Date</p><DateCell value={sel.createdAt} /></div>
                    <div><p className="text-[10px] uppercase text-muted-foreground">Delivery note</p><Mono>{sel.dnNumber || "—"}</Mono></div>
                    <div><p className="text-[10px] uppercase text-muted-foreground">Sales order</p><Mono>{sel.soNumber || "—"}</Mono></div>
                  </div>
                  {/* lines */}
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-[12px]">
                      <thead className="bg-zinc-900/80 text-muted-foreground text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="text-left px-2.5 py-1.5">#</th>
                          <th className="text-left px-2.5 py-1.5">Item</th>
                          <th className="text-left px-2.5 py-1.5">HSN</th>
                          <th className="text-left px-2.5 py-1.5">Serial</th>
                          <th className="text-right px-2.5 py-1.5">Qty</th>
                          <th className="text-right px-2.5 py-1.5">Rate</th>
                          <th className="text-right px-2.5 py-1.5">Taxable</th>
                          <th className="text-right px-2.5 py-1.5">GST%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sel.lines.map((l, idx) => (
                          <tr key={`${l.itemId}-${l.lotNumber}-${idx}`} className="border-t border-border/50">
                            <td className="px-2.5 py-1.5 tabular">{idx + 1}</td>
                            <td className="px-2.5 py-1.5"><Mono className="text-primary">{l.partNumber}</Mono> <span className="text-muted-foreground">{l.name}</span></td>
                            <td className="px-2.5 py-1.5"><Mono>{l.hsnCode}</Mono></td>
                            <td className="px-2.5 py-1.5"><Mono>{l.lotNumber}</Mono></td>
                            <td className="px-2.5 py-1.5 text-right tabular">{l.qty}</td>
                            <td className="px-2.5 py-1.5 text-right"><Money value={l.unitPrice} /></td>
                            <td className="px-2.5 py-1.5 text-right"><Money value={l.taxable} /></td>
                            <td className="px-2.5 py-1.5 text-right tabular">{l.gstRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* tax summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[12px]">
                    {[
                      { k: "Taxable value", v: sel.taxableValue },
                      { k: "CGST", v: sel.cgst },
                      { k: "SGST", v: sel.sgst },
                      { k: "IGST", v: sel.igst },
                    ].map((t) => (
                      <div key={t.k} className="rounded-md border border-border/50 p-2">
                        <p className="text-[10px] uppercase text-muted-foreground">{t.k}</p>
                        <Money value={t.v} />
                      </div>
                    ))}
                    <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
                      <p className="text-[10px] uppercase text-muted-foreground">Invoice total</p>
                      <Money value={sel.total} className="font-semibold text-primary" />
                    </div>
                  </div>
                  {/* IRN + QR */}
                  {sel.irn ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-md border border-border/50 p-3 space-y-1 text-[12px]">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">IRN (SANDBOX_MOCK)</p>
                        <Mono className="break-all text-[11px]">{sel.irn}</Mono>
                        <p className="text-muted-foreground">Generated {dt(sel.irnAt)}</p>
                      </div>
                      <div className="rounded-md border border-border/50 p-3 space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Signed QR payload</p>
                        <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-emerald-300">{JSON.stringify(sel.qr, null, 2)}</pre>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">e-Invoice not generated yet — status {sel.status}.</p>
                  )}
                </div>
              </div>

              {/* e-invoice log */}
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">e-Invoice log (idempotency: IDM-{sel.invoiceNumber}-irn-request)</p>
                {sel.logs.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No IRN requests yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {sel.logs.map((l) => (
                      <div key={l.id} className="flex flex-wrap items-center gap-2 rounded border border-border/50 px-2.5 py-1.5 text-[12px]">
                        <StatusBadge status={l.status} />
                        <span className="text-muted-foreground">attempt <span className="tabular">{l.attempts}</span></span>
                        <Mono className="text-[11px]">{l.correlationId || "—"}</Mono>
                        <span className="text-muted-foreground ml-auto">{dt(l.createdAt)}</span>
                        {l.errorMessage && <span className="text-red-300 text-[11px] w-full">{l.errorMessage}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* actions */}
              <div className="flex flex-wrap gap-2 justify-end border-t border-border/40 pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.dispatchEvent(new CustomEvent("tau-erp-print", { detail: { kind: "invoice", invoice: {
                    invoiceNumber: sel.invoiceNumber, status: sel.status, irn: sel.irn, taxableValue: sel.taxableValue,
                    cgst: sel.cgst, sgst: sel.sgst, igst: sel.igst, total: sel.total, placeOfSupply: sel.placeOfSupply,
                    irnAt: sel.irnAt, customerName: sel.customer?.name ?? "—",
                    customerGstin: sel.customer?.gstin ?? "", invoiceDate: sel.createdAt,
                    dnNumber: sel.dnNumber, soNumber: sel.soNumber,
                    qr: sel.qr, lines: sel.lines,
                  } } }))}
                >
                  <Printer className="h-3.5 w-3.5" /> Print invoice (controlled)
                </Button>
                {canInvoice && (
                  <>
                    {(sel.status === "ISSUED" || sel.status === "EINVOICE_PENDING") && (
                      <>
                        <Button size="sm" variant="outline" disabled={einv.isPending} onClick={() => einv.mutate({ invoiceNumber: sel.invoiceNumber, simulate: "timeout" })}>
                          <FileWarning className="h-3.5 w-3.5" /> Simulate provider timeout
                        </Button>
                        <Button size="sm" disabled={einv.isPending} onClick={() => einv.mutate({ invoiceNumber: sel.invoiceNumber })}>
                          <RefreshCcw className="h-3.5 w-3.5" /> Generate e-Invoice (SANDBOX_MOCK)
                        </Button>
                      </>
                    )}
                    {sel.status === "EINVOICED" && (
                      <Button size="sm" variant="outline" disabled={einv.isPending} onClick={() => void dupDemo(sel.invoiceNumber)}>
                        <RefreshCcw className="h-3.5 w-3.5" /> Duplicate request demo (calls twice)
                      </Button>
                    )}
                    {["CANCELLED"].includes(sel.status) && <p className="text-[12px] text-muted-foreground self-center">Invoice cancelled.</p>}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================================================================
// TAB 5 — NOTIFICATIONS
// ===========================================================================
function NotificationsTab() {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const sessionRole = useErpStore((s) => s.sessionUser?.role);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  // Management view — the FULL stored feed (muted events tagged, not filtered)
  // so users can see exactly what their preferences hide.
  const { data, isLoading } = useQuery<NotificationsData>({ queryKey: ["notifications-full"], queryFn: () => api<NotificationsData>("/api/notifications?includeMuted=1") });
  const markRead = useMutation({
    mutationFn: (id: string) => api("/api/notifications", { method: "PATCH", body: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications-full"] }),
    onError: (e: Error) => toast(e.message, "err"),
  });
  const rows = (data?.notifications ?? []).filter((n) => (onlyUnread ? !n.readAt : true));
  const prefs = data?.prefs;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">
          Filtered server-side by your session role <Mono>{sessionRole ?? "—"}</Mono> and direct user mentions.
          {prefs && (prefs.mutedKinds.length > 0 || prefs.minSeverity !== "ALL") && (
            <> Preferences hide <b className="text-amber-300">{data?.hiddenCount ?? 0}</b> stored event(s) from the bell — muted rows are tagged below.</>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setPrefsOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" /> Preferences
          </Button>
          <Button size="sm" variant={onlyUnread ? "default" : "outline"} onClick={() => setOnlyUnread((v) => !v)}>
            {onlyUnread ? "Showing unread" : "All"}{data ? ` · ${onlyUnread ? data.unread : data.notifications.length}` : ""}
          </Button>
        </div>
      </div>
      {prefs && (prefs.digest || prefs.minSeverity !== "ALL" || prefs.mutedKinds.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium">active preferences:</span>
          <span className="rounded-full border border-border/60 bg-background/40 px-2 py-0.5">severity floor: <b className="text-foreground/80">{prefs.minSeverity}</b></span>
          <span className="rounded-full border border-border/60 bg-background/40 px-2 py-0.5">muted kinds: <b className={prefs.mutedKinds.length ? "text-red-300" : "text-foreground/80"}>{prefs.mutedKinds.length ? prefs.mutedKinds.join(", ") : "none"}</b></span>
          <span className="rounded-full border border-border/60 bg-background/40 px-2 py-0.5">digest: <b className="text-foreground/80">{prefs.digest ? "on" : "off"}</b></span>
        </div>
      )}
      <div className="rounded-lg border bg-card overflow-hidden max-h-[62vh] overflow-y-auto erp-scroll">
        {isLoading && <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>}
        {!isLoading && rows.length === 0 && <EmptyState message={onlyUnread ? "No unread notifications" : "No notifications for your role yet"} />}
        {!isLoading &&
          rows.map((n) => (
            <div key={n.id} className={"flex items-start gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0" + (n.muted ? " bg-red-500/[0.03]" : "")}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent border border-muted-foreground/40" : "bg-primary"}`} title={n.readAt ? "read" : "unread"} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-[13px] ${n.readAt ? "text-muted-foreground" : "font-medium"}`}>{n.title}</p>
                  <StatusBadge status={n.severity} />
                  <span className="text-[10px] text-muted-foreground uppercase">{n.kind}</span>
                  {n.muted && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[9.5px] uppercase tracking-wide text-red-300">
                      <AlertTriangle className="h-2.5 w-2.5" /> muted by your preferences
                    </span>
                  )}
                  {(n.refType || n.refId) && (
                    <span className="text-[11px] text-muted-foreground"><Mono>{n.refType} {n.refId}</Mono></span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">{dt(n.createdAt)}</span>
                </div>
                <p className="text-[12px] text-muted-foreground mt-0.5">{n.message}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {n.userId ? "direct mention" : n.role ? `role broadcast: ${n.role}` : "global broadcast"}
                </p>
              </div>
              {!n.readAt && (
                <Button size="sm" variant="ghost" className="h-7 shrink-0 text-[11px]" disabled={markRead.isPending} onClick={() => markRead.mutate(n.id)}>
                  <Check className="h-3.5 w-3.5" /> Mark read
                </Button>
              )}
            </div>
          ))}
      </div>
      <NotificationPrefsDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}

// ===========================================================================
// MAIN VIEW
// ===========================================================================
export default function SalesView() {
  const route = useErpStore((s) => s.route);
  const sessionUser = useErpStore((s) => s.sessionUser);
  const [tab, setTab] = useState(route.tab || "quotes");
  // sync tab when the shell navigates to #/sales/<tab> (dashboard links) —
  // derived-state-during-render pattern (no setState-in-effect)
  const [lastRouteTab, setLastRouteTab] = useState(route.tab);
  if (route.view === "sales" && route.tab !== lastRouteTab) {
    setLastRouteTab(route.tab);
    if (route.tab) setTab(route.tab);
  }

  const qQuotes = useQuery<QuotesData>({ queryKey: ["quotations"], queryFn: () => api<QuotesData>("/api/quotations") });
  const qSos = useQuery<SosData>({ queryKey: ["sales-orders"], queryFn: () => api<SosData>("/api/sales-orders") });
  const qDn = useQuery<DeliveryData>({ queryKey: ["delivery"], queryFn: () => api<DeliveryData>("/api/delivery") });
  const qInv = useQuery<InvoicesData>({ queryKey: ["invoices"], queryFn: () => api<InvoicesData>("/api/invoices") });
  const qNotif = useQuery<NotificationsData>({ queryKey: ["notifications"], queryFn: () => api<NotificationsData>("/api/notifications") });

  if (sessionUser && !hasPerm(sessionUser.role, "sales.view")) {
    return (
      <div className="space-y-5">
        <SectionHeader icon={Truck} title="Sales & Dispatch" desc="Order-to-cash with synthetic GST compliance" />
        <PermDenied perm="sales.view" />
      </div>
    );
  }

  const openQuotes = (qQuotes.data?.quotations ?? []).filter((q) => ["DRAFT", "SENT", "ACCEPTED"].includes(q.status)).length;
  const openSos = (qSos.data?.salesOrders ?? []).filter((s) => ["CONFIRMED", "IN_PRODUCTION", "READY", "PARTIAL"].includes(s.status)).length;
  const dnsTransit = (qDn.data?.deliveryNotes ?? []).filter((d) => ["DRAFT", "PICKED"].includes(d.status)).length;
  const einvoiced = (qInv.data?.invoices ?? []).filter((i) => i.status === "EINVOICED").length;
  const now = new Date();
  const taxThisMonth = (qInv.data?.invoices ?? [])
    .filter((i) => {
      const d = new Date(i.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, i) => s + i.cgst + i.sgst + i.igst, 0);

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Truck}
        title="Sales & Dispatch"
        desc="Order-to-cash: quotations → SOs → packing/dispatch → GST invoices (synthetic e-Invoice/IRN)"
        actions={<SyntheticBadge />}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard label="Open quotations" value={openQuotes} sub="DRAFT + SENT + ACCEPTED" icon={FileText} />
        <StatCard label="Open sales orders" value={openSos} sub="not yet fully dispatched" icon={ShoppingCart} />
        <StatCard label="DNs in transit" value={dnsTransit} sub="DRAFT + PICKED" icon={Truck} tone={dnsTransit > 0 ? "warn" : "default"} />
        <StatCard label="Invoices EINVOICED" value={einvoiced} sub="IRN generated (SANDBOX_MOCK)" icon={BadgeCheck} tone="good" />
        <StatCard label="Tax collected this month" value={<Money value={round2(taxThisMonth)} />} sub="CGST + SGST + IGST" icon={Landmark} />
      </div>

      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "quotes", label: "Quotations", count: qQuotes.data?.quotations.length ?? 0 },
          { key: "orders", label: "Sales Orders", count: qSos.data?.salesOrders.length ?? 0 },
          { key: "delivery", label: "Delivery & Packing", count: qDn.data?.deliveryNotes.length ?? 0 },
          { key: "invoices", label: "GST Invoices", count: qInv.data?.invoices.length ?? 0 },
          { key: "notifications", label: "Notifications", count: qNotif.data?.unread ?? 0 },
        ]}
      />

      {tab === "quotes" && <QuotationsTab canCreate={hasPerm(sessionUser?.role, "sales.create")} />}
      {tab === "orders" && <SalesOrdersTab canCreate={hasPerm(sessionUser?.role, "sales.create")} />}
      {tab === "delivery" && <DeliveryTab canDispatch={hasPerm(sessionUser?.role, "sales.dispatch")} />}
      {tab === "invoices" && <InvoicesTab canInvoice={hasPerm(sessionUser?.role, "sales.invoice")} />}
      {tab === "notifications" && <NotificationsTab />}
      {!["quotes", "orders", "delivery", "invoices", "notifications"].includes(tab) && (
        <Card><CardContent className="p-6"><EmptyState message="Unknown sub-view" icon={Boxes} /></CardContent></Card>
      )}
    </div>
  );
}
