"use client";
// ============================================================================
// Tau ERP — PrintCenter: controlled print documents (spec §Printing).
// Any view can trigger: window.dispatchEvent(new CustomEvent("tau-erp-print",
//   { detail: { kind: "coc"|"calibration"|"dossier"|"8d"|"invoice", lot?, ncr?, invoice? } }))
// Renders a formal document overlay (A4-like) and prints it via a print-only
// stylesheet. Controlled prints identify: company, doc number, revision/status,
// print timestamp, printed-by user + SYNTHETIC watermark (never statutory).
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/erp/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useErpStore } from "@/store/erp-store";
import { COMPANY } from "@/lib/erp/constants";
import { Download, Printer, X } from "lucide-react";

type PrintDoc = {
  doc: {
    kind: string; printedBy: string; printedByRole: string; printedAt: string;
    company: { name: string; address: string; gstin: string; plant: string };
    synthetic: boolean;
  };
  lot: { lotNumber: string; itemPartNumber: string; itemName: string; familyCode: string; trackingType: string; status: string; woNumber: string; hsnCode: string; revision: string };
  release: { releaseNumber: string; status: string; releasedBy: string; approvedBy: string; releasedAt: string | null; checks: Record<string, boolean> } | null;
  inspections: { inspNumber: string; kind: string; templateCode: string; status: string; attempt: number; equipmentCode: string; submittedAt: string | null; results: { parameter: string; unit: string; value: number | string; lower?: number; upper?: number; pass: boolean }[] }[];
  calibration: { records: { inspNumber: string; status: string; equipmentCode: string; submittedAt: string | null; results: { parameter: string; unit: string; value: number | string; lower?: number; upper?: number; pass: boolean }[] }[]; equipment: { code: string; name: string; calibrationDue: string | null; status: string }[] };
  genealogy: { components: number; usedInParents: number };
  shipment: { dnNumber: string; soNumber: string; customer: string; dispatchedAt: string | null } | null;
};

type InvPrintLine = { itemId: string; lotNumber: string; qty: number; unitPrice: number; taxable: number; gstRate: number; hsnCode: string; partNumber: string; name: string; uom: string };

type InvoiceDoc = {
  invoiceNumber: string; status: string; irn: string; taxableValue: number; cgst: number; sgst: number; igst: number; total: number; placeOfSupply: string; irnAt: string | null;
  customerName?: string;
  customerGstin?: string;
  invoiceDate?: string;
  dnNumber?: string;
  soNumber?: string;
  qr?: Record<string, unknown>;
  lines?: InvPrintLine[];
};

type Report8D = {
  doc: { kind: string; printedBy: string; printedByRole: string; printedAt: string; company: { name: string; address: string; gstin: string; plant: string }; synthetic: boolean };
  ncr: { ncrNumber: string; severity: string; status: string; sourceRef: string; lotNumber: string; woNumber: string; description: string; raisedBy: string; createdAt: string; closedAt: string | null };
  d0: { symptom: string; detectedBy: string; quantityAffected: number };
  d1: { team: string[]; champion: string };
  d2: { description: string; lot: string; wo: string; is: string; isNot: string };
  d3: { containment: { type: string; ref: string; note?: string }[]; verified: boolean; note: string };
  d4: { rootCauses: { capa: string; cause: string; status: string }[]; mrbJustification: string };
  d5: { actions: { capa: string; kind: string; action: string; owner: string; dueDate: string | null; done: boolean }[]; reworkOrders: { rwNumber: string; status: string; instructions: string; outcome: string }[] };
  d6: { effectiveness: { capa: string; effectiveness: string; status: string }[]; reinspections: { inspNumber: string; attempt: number; status: string }[] };
  d7: { preventive: { capa: string; problem: string; rootCause: string; status: string; effectiveness: string }[]; standardsUpdated: boolean };
  d8: { status: string; closedAt: string | null; mrb: { disposition: string; decidedBy: string; approvedBy: string }[] };
  inspectionEvidence: { inspNumber: string; kind: string; attempt: number; status: string; equipmentCode: string; submittedAt: string | null }[];
};

/** Supplier SCAR response sheet — buyer-issued 8D-style form the supplier fills,
 *  signs and returns (round-8). Reference data from the SCAR record + GRN evidence;
 *  response sections are deliberately blank ruled fields. */
type ScarSheetDoc = {
  doc: { kind: string; printedBy: string; printedByRole: string; printedAt: string; company: { name: string; address: string; gstin: string; plant: string }; synthetic: boolean };
  scar: {
    scarNumber: string; severity: string; status: string; grnNumber: string; inspectionRef: string;
    partSummary: string; defectDescription: string; containment: string;
    responseDue: string | null; respondedAt: string | null; raisedBy: string; raisedAt: string;
  };
  supplier: { code: string; name: string; city: string; category: string; gstin: string } | null;
  lotNumbers: string[];
  grnEvidence: { grnNumber: string; partNumber: string; name: string; qty: number; uom: string; supplierBatch: string }[];
};

type PrintState =
  | { mode: "none" }
  | { mode: "loading"; title: string }
  | { mode: "doc"; title: string; data: PrintDoc }
  | { mode: "8d"; title: string; data: Report8D }
  | { mode: "scar"; title: string; data: ScarSheetDoc }
  | { mode: "invoice"; title: string; data: InvoiceDoc };

export const PRINT_EVENT = "tau-erp-print";

export default function PrintCenter() {
  const [state, setState] = useState<PrintState>({ mode: "none" });
  const sessionUser = useErpStore((s) => s.sessionUser);

  const openPrint = useCallback(async (detail: { kind: string; lot?: string; ncr?: string; scar?: string; invoice?: InvoiceDoc }) => {
    if (detail.kind === "invoice" && detail.invoice) {
      setState({ mode: "invoice", title: `Tax Invoice ${detail.invoice.invoiceNumber}`, data: detail.invoice });
      return;
    }
    if (detail.kind === "scar") {
      if (!detail.scar) return;
      setState({ mode: "loading", title: "SCAR Response Sheet" });
      try {
        const data = await api<ScarSheetDoc>(`/api/print/doc?kind=scar&scar=${encodeURIComponent(detail.scar)}`);
        setState({ mode: "scar", title: `SCAR Response Sheet — ${detail.scar}`, data });
      } catch (e) {
        useErpStore.getState().toast(e instanceof Error ? e.message : "Print failed", "err");
        setState({ mode: "none" });
      }
      return;
    }
    if (detail.kind === "8d") {
      if (!detail.ncr) return;
      setState({ mode: "loading", title: "8D Problem-Solving Report" });
      try {
        const data = await api<Report8D>(`/api/print/doc?kind=8d&ncr=${encodeURIComponent(detail.ncr)}`);
        setState({ mode: "8d", title: `8D Report — ${detail.ncr}`, data });
      } catch (e) {
        useErpStore.getState().toast(e instanceof Error ? e.message : "Print failed", "err");
        setState({ mode: "none" });
      }
      return;
    }
    if (!detail.lot) return;
    if (detail.kind === "dossier") {
      setState({ mode: "loading", title: "Genealogy Dossier" });
      try {
        const data = await api<PrintDoc>("/api/print/doc?kind=coc&lot=" + encodeURIComponent(detail.lot));
        setState({ mode: "doc", title: `Genealogy & Conformance Dossier — ${detail.lot}`, data: { ...data, doc: { ...data.doc, kind: "dossier" } } });
      } catch (e) {
        useErpStore.getState().toast(e instanceof Error ? e.message : "Print failed", "err");
        setState({ mode: "none" });
      }
      return;
    }
    setState({ mode: "loading", title: detail.kind === "calibration" ? "Calibration Certificate" : "Certificate of Conformance" });
    try {
      const data = await api<PrintDoc>(`/api/print/doc?kind=${detail.kind}&lot=${encodeURIComponent(detail.lot)}`);
      setState({ mode: "doc", title: `${detail.kind === "calibration" ? "Calibration Certificate" : "Certificate of Conformance"} — ${detail.lot}`, data });
    } catch (e) {
      useErpStore.getState().toast(e instanceof Error ? e.message : "Print failed", "err");
      setState({ mode: "none" });
    }
  }, []);

  useEffect(() => {
    const onPrint = (e: Event) => {
      const detail = (e as CustomEvent<{ kind: string; lot?: string; ncr?: string; scar?: string; invoice?: InvoiceDoc }>).detail;
      void openPrint(detail);
    };
    window.addEventListener(PRINT_EVENT, onPrint);
    return () => window.removeEventListener(PRINT_EVENT, onPrint);
  }, [openPrint]);

  const doPrint = () => window.print();

  /** Download-as-PDF via the browser print pipeline: the print dialog's
   *  "Save as PDF" destination uses document.title as the default file name,
   *  so we temporarily swap in the controlled document title, then restore it
   *  on `afterprint` (fires once the dialog closes, cancel or save). */
  const doDownloadPdf = () => {
    const original = document.title;
    const fileBase = state.mode !== "none" && state.title
      ? state.title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").toLowerCase()
      : original;
    document.title = fileBase;
    const restore = () => {
      document.title = original;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    // Fallback: some browsers never fire `afterprint` (e.g. print cancelled in
    // headless/embedded contexts) — restore the title after a generous delay.
    window.setTimeout(restore, 60_000);
    useErpStore.getState().toast('Select "Save as PDF" as the destination to download the controlled document');
    setTimeout(() => window.print(), 250);
  };

  return (
    <>
      <Dialog open={state.mode !== "none"} onOpenChange={(o) => { if (!o) setState({ mode: "none" }); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto erp-scroll">
          <DialogHeader className="no-print">
            <DialogTitle className="text-base flex items-center gap-2">
              {state.mode === "loading" ? "Preparing document…" : state.mode !== "none" ? state.title : ""}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Controlled document preview — print or save as PDF. Synthetic data, not for statutory use.
            </DialogDescription>
          </DialogHeader>

          {state.mode === "loading" && <div className="h-64 rounded bg-muted animate-pulse" />}

          {(state.mode === "doc" || state.mode === "invoice" || state.mode === "8d" || state.mode === "scar") && (
            <div className="no-print flex justify-end gap-2 mb-2">
              <Button variant="outline" size="sm" onClick={() => setState({ mode: "none" })}><X className="h-3.5 w-3.5 mr-1" />Close</Button>
              <Button variant="outline" size="sm" onClick={doDownloadPdf} title="Download via the print dialog (Save as PDF destination) — the file name follows the document number">
                <Download className="h-3.5 w-3.5 mr-1" />PDF
              </Button>
              <Button size="sm" onClick={doPrint}><Printer className="h-3.5 w-3.5 mr-1" />Print</Button>
            </div>
          )}

          {/* ---------------- formal document ---------------- */}
          {state.mode === "doc" && (
            <div id="tau-print-root" className="rounded-lg border bg-white text-zinc-900 p-6 text-[12px] leading-relaxed">
              <DocHeader
                company={state.data.doc.company}
                docTitle={state.data.doc.kind === "calibration" ? "CALIBRATION CERTIFICATE" : state.data.doc.kind === "dossier" ? "GENEALOGY & CONFORMANCE DOSSIER" : "CERTIFICATE OF CONFORMANCE"}
                docNumber={state.data.release?.releaseNumber ?? state.data.lot.lotNumber}
                revision={`Rev ${state.data.lot.revision}`}
                status={state.data.release?.status ?? state.data.lot.status}
                printedBy={state.data.doc.printedBy}
                printedAt={state.data.doc.printedAt}
              />
              <Watermark />
              <Section title="1 · Product identification">
                <Row k="Finished serial / lot" v={<b className="font-mono">{state.data.lot.lotNumber}</b>} />
                <Row k="Part number" v={`${state.data.lot.itemPartNumber} — ${state.data.lot.itemName}`} />
                <Row k="Product family" v={state.data.lot.familyCode || "—"} />
                <Row k="Work order" v={state.data.lot.woNumber || "—"} />
                <Row k="HSN (synthetic)" v={state.data.lot.hsnCode} />
                <Row k="Traceability" v={`${state.data.genealogy.components} component lot(s) · used in ${state.data.genealogy.usedInParents} parent lot(s)`} />
              </Section>

              {state.data.release && (
                <Section title="2 · Product release">
                  <Row k="Release number" v={state.data.release.releaseNumber} />
                  <Row k="Status" v={state.data.release.status} />
                  <Row k="Released by / approved by" v={`${state.data.release.releasedBy || "—"} / ${state.data.release.approvedBy || "—"}`} />
                  <Row k="Released at" v={fmt(state.data.release.releasedAt)} />
                  <Row k="Evidence checks" v={Object.entries(state.data.release.checks).map(([k, v]) => `${k}: ${v ? "OK" : "MISSING"}`).join(" · ")} />
                </Section>
              )}

              <Section title={`${state.data.release ? 3 : 2} · Inspection & test evidence`}>
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-zinc-100">
                      <th className="border border-zinc-300 px-2 py-1 text-left">Doc</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Kind</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Template</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Equipment</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.inspections.map((i) => (
                      <tr key={i.inspNumber}>
                        <td className="border border-zinc-300 px-2 py-1 font-mono">{i.inspNumber}</td>
                        <td className="border border-zinc-300 px-2 py-1">{i.kind}{i.attempt > 1 ? ` (retest #${i.attempt})` : ""}</td>
                        <td className="border border-zinc-300 px-2 py-1">{i.templateCode || "—"}</td>
                        <td className="border border-zinc-300 px-2 py-1">{i.equipmentCode || "—"}</td>
                        <td className={"border border-zinc-300 px-2 py-1 font-semibold " + (i.status === "PASSED" ? "text-emerald-700" : "text-red-700")}>{i.status}</td>
                      </tr>
                    ))}
                    {state.data.inspections.length === 0 && (
                      <tr><td colSpan={5} className="border border-zinc-300 px-2 py-2 text-zinc-500">No submitted evidence on record — release gate would block dispatch.</td></tr>
                    )}
                  </tbody>
                </table>
              </Section>

              {state.data.doc.kind === "calibration" && (
                <Section title={`${state.data.release ? 4 : 3} · Calibration results & equipment state`}>
                  {state.data.calibration.records.map((r) => (
                    <div key={r.inspNumber} className="mb-3">
                      <p className="font-mono mb-1">{r.inspNumber} · {fmt(r.submittedAt)} · {r.equipmentCode || "—"}</p>
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-zinc-100">
                            <th className="border border-zinc-300 px-2 py-1 text-left">Parameter</th>
                            <th className="border border-zinc-300 px-2 py-1 text-left">Measured</th>
                            <th className="border border-zinc-300 px-2 py-1 text-left">Limits</th>
                            <th className="border border-zinc-300 px-2 py-1 text-left">Verdict</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.results.map((res, idx) => (
                            <tr key={idx}>
                              <td className="border border-zinc-300 px-2 py-1">{res.parameter}</td>
                              <td className="border border-zinc-300 px-2 py-1 tabular">{res.value} {res.unit}</td>
                              <td className="border border-zinc-300 px-2 py-1 tabular">{res.lower ?? "—"} … {res.upper ?? "—"} {res.unit}</td>
                              <td className={"border border-zinc-300 px-2 py-1 font-semibold " + (res.pass ? "text-emerald-700" : "text-red-700")}>{res.pass ? "PASS" : "FAIL"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  <p className="mt-1">Equipment calibration state at print: {state.data.calibration.equipment.map((e) => `${e.code} (${e.status}, due ${fmt(e.calibrationDue)})`).join(" · ") || "—"}</p>
                </Section>
              )}

              {state.data.shipment && (
                <Section title={`${state.data.doc.kind === "calibration" ? 5 : state.data.release ? 4 : 3} · Shipment trace`}>
                  <Row k="Delivery note" v={state.data.shipment.dnNumber} />
                  <Row k="Sales order" v={state.data.shipment.soNumber} />
                  <Row k="Customer" v={state.data.shipment.customer} />
                  <Row k="Dispatched at" v={fmt(state.data.shipment.dispatchedAt)} />
                </Section>
              )}

              <DocFooter company={state.data.doc.company} printedAt={state.data.doc.printedAt} printedBy={`${state.data.doc.printedBy} (${state.data.doc.printedByRole})`} />
            </div>
          )}

          {/* ---------------- invoice print ---------------- */}
          {state.mode === "invoice" && (
            <div id="tau-print-root" className="rounded-lg border bg-white text-zinc-900 p-6 text-[12px] leading-relaxed">
              <DocHeader
                company={COMPANY}
                docTitle="TAX INVOICE"
                docNumber={state.data.invoiceNumber}
                revision={`PoS: ${state.data.placeOfSupply}`}
                status={state.data.status}
                printedBy={sessionUser?.name ?? "—"}
                printedAt={new Date().toISOString()}
                irn={state.data.irn}
              />
              <Watermark />
              <Section title="Fiscal summary (SYNTHETIC)">
                <Row k="Buyer" v={<span>{state.data.customerName ?? "—"}{state.data.customerGstin ? <span className="font-mono text-[10px] text-zinc-500"> · GSTIN {state.data.customerGstin}</span> : null}</span>} />
                <Row k="Invoice date" v={fmt(state.data.invoiceDate ?? null)} />
                <Row k="Ref" v={[state.data.soNumber, state.data.dnNumber].filter(Boolean).join(" · ") || "—"} />
                <Row k="Taxable value" v={inr(state.data.taxableValue)} />
                <Row k="CGST" v={inr(state.data.cgst)} />
                <Row k="SGST" v={inr(state.data.sgst)} />
                <Row k="IGST" v={inr(state.data.igst)} />
                <Row k="Total" v={<b>{inr(state.data.total)}</b>} />
                <Row k="IRN" v={state.data.irn ? <span className="font-mono text-[10px] break-all">{state.data.irn}</span> : "not generated"} />
                <Row k="IRN generated at" v={fmt(state.data.irnAt)} />
              </Section>

              {state.data.lines && state.data.lines.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-700 mb-1">Line items (serial / batch traceable)</p>
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-zinc-100">
                        <th className="border border-zinc-300 px-2 py-1 text-left">#</th>
                        <th className="border border-zinc-300 px-2 py-1 text-left">Part</th>
                        <th className="border border-zinc-300 px-2 py-1 text-left">HSN</th>
                        <th className="border border-zinc-300 px-2 py-1 text-left">Lot / serial</th>
                        <th className="border border-zinc-300 px-2 py-1 text-right">Qty</th>
                        <th className="border border-zinc-300 px-2 py-1 text-right">Rate</th>
                        <th className="border border-zinc-300 px-2 py-1 text-right">Taxable</th>
                        <th className="border border-zinc-300 px-2 py-1 text-right">GST%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.lines.map((l, i) => (
                        <tr key={`${l.itemId}-${l.lotNumber}-${i}`}>
                          <td className="border border-zinc-300 px-2 py-1 text-zinc-500">{i + 1}</td>
                          <td className="border border-zinc-300 px-2 py-1">
                            <span className="font-mono">{l.partNumber}</span>
                            <span className="text-zinc-500"> — {l.name}</span>
                          </td>
                          <td className="border border-zinc-300 px-2 py-1 font-mono">{l.hsnCode || "—"}</td>
                          <td className="border border-zinc-300 px-2 py-1 font-mono">{l.lotNumber || "—"}</td>
                          <td className="border border-zinc-300 px-2 py-1 text-right tabular">{l.qty} {l.uom}</td>
                          <td className="border border-zinc-300 px-2 py-1 text-right tabular">{inr(l.unitPrice)}</td>
                          <td className="border border-zinc-300 px-2 py-1 text-right tabular">{inr(l.taxable)}</td>
                          <td className="border border-zinc-300 px-2 py-1 text-right tabular">{l.gstRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* e-Invoice signed QR (NIC-38 format payload — SYNTHETIC) */}
              <div className="mt-3 flex items-start gap-4 border-t pt-3">
                {state.data.irn ? (
                  <InvoiceQr payload={state.data.qr} />
                ) : (
                  <div className="h-[112px] w-[112px] shrink-0 border border-dashed border-zinc-300 rounded flex items-center justify-center text-center text-[9px] text-zinc-400 px-2">
                    e-Invoice QR appears after IRN generation
                  </div>
                )}
                <div className="text-[10px] text-zinc-600 leading-snug">
                  <p className="font-semibold text-zinc-700">Signed e-Invoice QR (NIC-38 fields)</p>
                  {state.data.qr && Object.keys(state.data.qr).length > 0 ? (
                    <ul className="mt-1 space-y-0.5 font-mono">
                      {Object.entries(state.data.qr).map(([k, v]) => (
                        <li key={k} className="break-all"><span className="text-zinc-400">{k}:</span> {String(v)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1">QR payload not generated yet — run “Generate e-Invoice (SANDBOX_MOCK)”.</p>
                  )}
                </div>
              </div>

              <div className="mt-3 border-t pt-2 text-[10px] text-zinc-600">
                Declaration: This document was generated in a development/UAT environment with SYNTHETIC statutory data. It is not a valid tax document and must never be presented to tax authorities (spec: environment safety rule).
              </div>
              <DocFooter company={COMPANY} printedAt={new Date().toISOString()} printedBy={sessionUser?.name ?? "—"} />
            </div>
          )}

          {/* ---------------- 8D problem-solving report ---------------- */}
          {state.mode === "8d" && (
            <div id="tau-print-root" className="rounded-lg border bg-white text-zinc-900 p-6 text-[12px] leading-relaxed">
              <DocHeader
                company={state.data.doc.company}
                docTitle="8D PROBLEM-SOLVING REPORT"
                docNumber={state.data.ncr.ncrNumber}
                revision={`Severity: ${state.data.ncr.severity}`}
                status={state.data.ncr.status}
                printedBy={state.data.doc.printedBy}
                printedAt={state.data.doc.printedAt}
              />
              <Watermark />
              <DStrip8D data={state.data} />
              <Section title="D0 · Symptom & detection">
                <Row k="Symptom / trigger" v={state.data.d0.symptom || "—"} />
                <Row k="First detected via" v={state.data.d0.detectedBy} />
                <Row k="Raised by" v={<Mono8D>{state.data.ncr.raisedBy || "—"}</Mono8D>} />
                <Row k="Raised at" v={fmt(state.data.ncr.createdAt)} />
              </Section>
              <Section title="D1 · Team">
                <Row k="Champion" v={state.data.d1.champion} />
                <Row k="Cross-functional team" v={state.data.d1.team.length ? state.data.d1.team.map((t) => <Mono8D key={t} className="mr-2">{t}</Mono8D>) : "—"} />
              </Section>
              <Section title="D2 · Problem description (IS / IS-NOT)">
                <p className="whitespace-pre-wrap border-l-2 border-zinc-300 pl-2 py-0.5">{state.data.d2.description}</p>
                <Row k="Affected lot" v={state.data.d2.lot ? <b className="font-mono">{state.data.d2.lot}</b> : "—"} />
                <Row k="Work order" v={state.data.d2.wo || "—"} />
              </Section>
              <Section title="D3 · Containment actions">
                {state.data.d3.containment.length ? (
                  <table className="w-full border-collapse text-[11px]">
                    <thead><tr className="bg-zinc-100">
                      <th className="border border-zinc-300 px-2 py-1 text-left">Scope type</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Ref</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Note</th>
                    </tr></thead>
                    <tbody>
                      {state.data.d3.containment.map((c, i) => (
                        <tr key={`${c.ref}-${i}`}>
                          <td className="border border-zinc-300 px-2 py-1">{snakeSafe(c.type)}</td>
                          <td className="border border-zinc-300 px-2 py-1 font-mono">{c.ref}</td>
                          <td className="border border-zinc-300 px-2 py-1">{c.note || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p>{state.data.d3.note}</p>}
              </Section>
              <Section title="D4 · Root cause">
                {state.data.d4.rootCauses.length ? state.data.d4.rootCauses.map((r) => (
                  <Row key={r.capa} k={r.capa} v={<span>{r.cause} <em className="text-zinc-500">({snakeSafe(r.status)})</em></span>} />
                )) : <p>No CAPA linked yet — root-cause analysis in progress.</p>}
                {state.data.d4.mrbJustification && <Row k="MRB justification" v={state.data.d4.mrbJustification} />}
              </Section>
              <Section title="D5 · Corrective & preventive actions">
                {state.data.d5.actions.length ? (
                  <table className="w-full border-collapse text-[11px]">
                    <thead><tr className="bg-zinc-100">
                      <th className="border border-zinc-300 px-2 py-1 text-left">CAPA</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Kind</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Action</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Owner</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Due</th>
                      <th className="border border-zinc-300 px-2 py-1 text-left">Done</th>
                    </tr></thead>
                    <tbody>
                      {state.data.d5.actions.map((a, i) => (
                        <tr key={i}>
                          <td className="border border-zinc-300 px-2 py-1 font-mono">{a.capa}</td>
                          <td className="border border-zinc-300 px-2 py-1">{a.kind}</td>
                          <td className="border border-zinc-300 px-2 py-1">{a.action}</td>
                          <td className="border border-zinc-300 px-2 py-1 font-mono">{a.owner || "—"}</td>
                          <td className="border border-zinc-300 px-2 py-1">{a.dueDate ? new Date(a.dueDate).toLocaleDateString("en-IN") : "—"}</td>
                          <td className={"border border-zinc-300 px-2 py-1 font-semibold " + (a.done ? "text-emerald-700" : "text-amber-700")}>{a.done ? "YES" : "NO"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p>No discrete actions recorded yet.</p>}
                {state.data.d5.reworkOrders.map((r) => (
                  <Row key={r.rwNumber} k={`Rework ${r.rwNumber}`} v={<span>{snakeSafe(r.status)}{r.outcome ? ` · outcome: ${r.outcome}` : ""}</span>} />
                ))}
              </Section>
              <Section title="D6 · Validation of corrective actions">
                {state.data.d6.effectiveness.map((e) => (
                  <Row key={e.capa} k={e.capa} v={<span>{e.effectiveness || "verification pending"} <em className="text-zinc-500">({snakeSafe(e.status)})</em></span>} />
                ))}
                {state.data.d6.reinspections.length ? (
                  <Row k="Re-inspection evidence" v={state.data.d6.reinspections.map((r) => <span key={r.inspNumber} className="mr-2 font-mono">{r.inspNumber} ×{r.attempt} {r.status}</span>)} />
                ) : <Row k="Re-inspection evidence" v="none recorded" />}
              </Section>
              <Section title="D7 · Preventive actions / standards update">
                {state.data.d7.preventive.length ? state.data.d7.preventive.map((p) => (
                  <Row key={p.capa} k={p.capa} v={<span>{p.problem} <em className="text-zinc-500">({snakeSafe(p.status)}{p.effectiveness ? ` · ${p.effectiveness}` : ""})</em></span>} />
                )) : <p>No preventive CAPAs linked to this NCR yet.</p>}
                <Row k="Standards / PFMEA updated" v={state.data.d7.standardsUpdated ? "YES — corrective CAPA closed" : "PENDING"} />
              </Section>
              <Section title="D8 · Closure & team recognition">
                <Row k="NCR status" v={<b>{snakeSafe(state.data.d8.status)}</b>} />
                <Row k="Closed at" v={fmt(state.data.d8.closedAt)} />
                {state.data.d8.mrb.map((m, i) => (
                  <Row key={i} k={`MRB disposition ${i + 1}`} v={`${snakeSafe(m.disposition)} — decided ${m.decidedBy || "—"} / approved ${m.approvedBy || "pending"}`} />
                ))}
              </Section>
              <Section title="Inspection & test evidence (reference)">
                <table className="w-full border-collapse text-[11px]">
                  <thead><tr className="bg-zinc-100">
                    <th className="border border-zinc-300 px-2 py-1 text-left">Doc</th>
                    <th className="border border-zinc-300 px-2 py-1 text-left">Kind</th>
                    <th className="border border-zinc-300 px-2 py-1 text-left">Attempt</th>
                    <th className="border border-zinc-300 px-2 py-1 text-left">Equipment</th>
                    <th className="border border-zinc-300 px-2 py-1 text-left">Result</th>
                  </tr></thead>
                  <tbody>
                    {state.data.inspectionEvidence.map((i) => (
                      <tr key={i.inspNumber}>
                        <td className="border border-zinc-300 px-2 py-1 font-mono">{i.inspNumber}</td>
                        <td className="border border-zinc-300 px-2 py-1">{i.kind}</td>
                        <td className="border border-zinc-300 px-2 py-1">#{i.attempt}</td>
                        <td className="border border-zinc-300 px-2 py-1">{i.equipmentCode || "—"}</td>
                        <td className={"border border-zinc-300 px-2 py-1 font-semibold " + (i.status === "PASSED" ? "text-emerald-700" : "text-red-700")}>{i.status}</td>
                      </tr>
                    ))}
                    {state.data.inspectionEvidence.length === 0 && <tr><td colSpan={5} className="border border-zinc-300 px-2 py-2 text-zinc-500">No inspection evidence linked.</td></tr>}
                  </tbody>
                </table>
              </Section>
              <DocFooter company={state.data.doc.company} printedAt={state.data.doc.printedAt} printedBy={`${state.data.doc.printedBy} (${state.data.doc.printedByRole})`} />
            </div>
          )}

          {/* ---------------- supplier SCAR response sheet ---------------- */}
          {state.mode === "scar" && (
            <div id="tau-print-root" className="rounded-lg border bg-white text-zinc-900 p-6 text-[12px] leading-relaxed">
              <DocHeader
                company={state.data.doc.company}
                docTitle="SUPPLIER SCAR — RESPONSE SHEET (8D STYLE)"
                docNumber={state.data.scar.scarNumber}
                revision={`Severity: ${state.data.scar.severity}`}
                status={state.data.scar.status}
                printedBy={state.data.doc.printedBy}
                printedAt={state.data.doc.printedAt}
              />
              <Watermark />
              <DStrip8DResponse due={state.data.scar.responseDue} responded={state.data.scar.respondedAt} />

              <Section title="1 · Nonconformance reference (buyer-issued)">
                <Row k="SCAR number" v={<b className="font-mono">{state.data.scar.scarNumber}</b>} />
                <Row k="Supplier" v={state.data.supplier ? <span><b className="font-mono">{state.data.supplier.code}</b> — {state.data.supplier.name}, {state.data.supplier.city} · category {state.data.supplier.category}{state.data.supplier.gstin ? <> · GSTIN {state.data.supplier.gstin}</> : null}</span> : "—"} />
                <Row k="Part / qty" v={state.data.scar.partSummary || "—"} />
                <Row k="Origin" v={<span>{state.data.scar.grnNumber ? <>GRN <b className="font-mono">{state.data.scar.grnNumber}</b></> : "manual raise"}{state.data.scar.inspectionRef ? <> · IQC <b className="font-mono">{state.data.scar.inspectionRef}</b></> : null}</span>} />
                <Row k="Affected lots" v={state.data.lotNumbers.length ? <span className="font-mono">{state.data.lotNumbers.join(" · ")}</span> : "—"} />
                <Row k="Raised by / at" v={<span>{state.data.scar.raisedBy} · {fmt(state.data.scar.raisedAt)}</span>} />
                <Row k="Response due" v={<b className={state.data.scar.responseDue && !state.data.scar.respondedAt ? "text-red-700" : ""}>{fmt(state.data.scar.responseDue)}</b>} />
                {state.data.scar.respondedAt && <Row k="Response recorded" v={fmt(state.data.scar.respondedAt)} />}
              </Section>

              <Section title="2 · Defect description (as reported by buyer)">
                <p className="whitespace-pre-wrap border-l-2 border-zinc-300 pl-2 py-0.5">{state.data.scar.defectDescription}</p>
                {state.data.scar.containment && (
                  <Row k="Buyer containment already applied" v={state.data.scar.containment} />
                )}
              </Section>

              {state.data.grnEvidence.length > 0 && (
                <Section title="3 · Receiving evidence (rejected GRN lines)">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-zinc-100">
                        <th className="border border-zinc-300 px-2 py-1 text-left">GRN</th>
                        <th className="border border-zinc-300 px-2 py-1 text-left">Part</th>
                        <th className="border border-zinc-300 px-2 py-1 text-left">Description</th>
                        <th className="border border-zinc-300 px-2 py-1 text-right">Qty rejected</th>
                        <th className="border border-zinc-300 px-2 py-1 text-left">Supplier batch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.grnEvidence.map((g, i) => (
                        <tr key={i}>
                          <td className="border border-zinc-300 px-2 py-1 font-mono">{g.grnNumber}</td>
                          <td className="border border-zinc-300 px-2 py-1 font-mono">{g.partNumber}</td>
                          <td className="border border-zinc-300 px-2 py-1">{g.name}</td>
                          <td className="border border-zinc-300 px-2 py-1 text-right tabular">{g.qty} {g.uom}</td>
                          <td className="border border-zinc-300 px-2 py-1 font-mono">{g.supplierBatch || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              )}

              <Section title="4 · Supplier response — to be completed by the supplier">
                <p className="text-zinc-600">Complete every section, attach objective evidence (photos, certificates, test data) and return to Tau Power Electronics Quality within the response due date. Handwritten entries are acceptable on a printed copy.</p>
                <ResponseField n="4.1" title="Immediate containment at your end (interim actions, quantity verification, batch segregation)">
                  <BlankLines lines={3} />
                </ResponseField>
                <ResponseTable
                  n="4.2" title="Root cause analysis (5-Why / Ishikawa — attach worksheets)"
                  headers={["#", "Root cause (occurrence / escape / detection)", "Evidence / method"]}
                  rows={3}
                />
                <ResponseTable
                  n="4.3" title="Corrective actions implemented"
                  headers={["#", "Action", "Owner", "Completed on"]}
                  rows={3}
                />
                <ResponseTable
                  n="4.4" title="Systemic preventive actions (FMEA / control plan / standard updates)"
                  headers={["#", "Preventive action", "Document affected", "Effective from"]}
                  rows={2}
                />
                <ResponseField n="4.5" title="Effectiveness verification (re-inspection results, PPM after action)">
                  <BlankLines lines={2} />
                </ResponseField>
                <ResponseField n="4.6" title="Disposition of suspect stock held at your facility">
                  <BlankLines lines={2} />
                </ResponseField>
              </Section>

              <Section title="5 · Sign-off">
                <table className="w-full border-collapse text-[11px]">
                  <tbody>
                    <tr>
                      <td className="border border-zinc-300 px-2 py-2 w-1/2">
                        <p className="font-semibold">Prepared by (supplier)</p>
                        <p className="text-zinc-500">Name / designation:</p>
                        <div className="h-6 border-b border-zinc-400" />
                        <p className="text-zinc-500 mt-1">Date:</p>
                        <div className="h-6 border-b border-zinc-400" />
                      </td>
                      <td className="border border-zinc-300 px-2 py-2 w-1/2">
                        <p className="font-semibold">Approved by (supplier quality head)</p>
                        <p className="text-zinc-500">Name / designation:</p>
                        <div className="h-6 border-b border-zinc-400" />
                        <p className="text-zinc-500 mt-1">Signature &amp; company stamp:</p>
                        <div className="h-6 border-b border-zinc-400" />
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-[10px] text-zinc-600">
                  Buyer acceptance: this response will be reviewed by Tau Power Electronics Quality (UNDER_REVIEW → VERIFICATION → CLOSED). Closure requires verified effectiveness evidence; the SCAR is closed by a different approver than the raiser (four-eyes).
                </p>
              </Section>

              <div className="mt-3 border-t pt-2 text-[10px] text-zinc-600">
                SYNTHETIC demo document — supplier, SCAR and evidence data are fabricated for the UAT environment and are not a real supplier corrective action.
              </div>
              <DocFooter company={state.data.doc.company} printedAt={state.data.doc.printedAt} printedBy={`${state.data.doc.printedBy} (${state.data.doc.printedByRole})`} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------

function inr(v: number) {
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) + " IST";
}
/** Null-safe snake_case → prose for optional document fields (print must never crash). */
function snakeSafe(v: string | null | undefined) {
  return (v ?? "—").replace(/_/g, " ");
}

/** SYNTHETIC e-Invoice QR — renders the invoice's stored NIC-38-style QR payload
 *  (SellerGSTIN · BuyerGSTIN · DocNo · TotAmt · IRN) as a scannable QR image.
 *  Payload content is entirely synthetic; label makes the demo status explicit. */
function InvoiceQr({ payload }: { payload?: Record<string, unknown> }) {
  const hasPayload = !!payload && Object.keys(payload).length > 0;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!hasPayload || !payload) return;
    let alive = true;
    QRCode.toDataURL(JSON.stringify(payload), { errorCorrectionLevel: "M", margin: 1, width: 224, color: { dark: "#18181b", light: "#ffffff" } })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [payload, hasPayload]);
  if (!hasPayload || !src) {
    return (
      <div className="h-[112px] w-[112px] shrink-0 border border-dashed border-zinc-300 rounded flex items-center justify-center text-center text-[9px] text-zinc-400 px-2">
        QR payload unavailable
      </div>
    );
  }
  return (
    <div className="shrink-0 text-center">
      <img src={src} alt="SYNTHETIC e-Invoice signed QR" className="h-[112px] w-[112px] rounded border border-zinc-300" />
      <p className="text-[8.5px] text-zinc-500 mt-0.5">SYNTHETIC · not statutory</p>
    </div>
  );
}

function DocHeader({ company, docTitle, docNumber, revision, status, printedBy, printedAt, irn }: {
  company: { name: string; address: string; gstin: string; plant: string };
  docTitle: string; docNumber: string; revision: string; status: string; printedBy: string; printedAt: string; irn?: string;
}) {
  return (
    <div className="border-b-2 border-zinc-800 pb-3 mb-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-amber-500 flex items-center justify-center text-white font-black text-[13px]">τ</div>
            <div>
              <div className="text-[15px] font-black tracking-tight">{company.name}</div>
              <div className="text-[10px] text-zinc-600">{company.address} · Plant {company.plant}</div>
              <div className="text-[10px] text-zinc-600">GSTIN: {company.gstin} (SYNTHETIC)</div>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[13px] font-black tracking-wider">{docTitle}</div>
          <div className="text-[11px] font-mono mt-0.5">{docNumber}</div>
          <div className="text-[10px] text-zinc-600">{revision} · Status: {status}</div>
          {irn && <div className="text-[9px] text-zinc-500 font-mono">IRN: {irn.slice(0, 16)}…</div>}
        </div>
      </div>
    </div>
  );
}

function Watermark() {
  return (
    <div className="print-watermark my-2 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-center text-[11px] font-bold tracking-widest text-amber-700">
      SYNTHETIC DATA — NOT FOR STATUTORY USE
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 border-b border-zinc-300 mb-2 pb-0.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-zinc-200 pb-0.5">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

function DocFooter({ company, printedAt, printedBy }: { company: { name: string; plant: string }; printedAt: string; printedBy: string }) {
  return (
    <div className="mt-4 border-t pt-2 flex items-center justify-between text-[9px] text-zinc-500">
      <span>{company.name} · {company.plant} · Controlled print — uncontrolled when detached from system record</span>
      <span>Printed {fmt(printedAt)} by {printedBy} · Page 1 of 1</span>
    </div>
  );
}

function Mono8D({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={"font-mono text-[11px] " + className}>{children}</span>;
}

/** D0–D8 progress strip for the 8D report (print-friendly, no colors dependency). */
function DStrip8D({ data }: { data: Report8D }) {
  const steps = [
    { d: "D0", label: "Symptom", done: true },
    { d: "D1", label: "Team", done: data.d1.team.length > 0 },
    { d: "D2", label: "Problem", done: true },
    { d: "D3", label: "Containment", done: data.d3.verified },
    { d: "D4", label: "Root cause", done: data.d4.rootCauses.some((r) => r.cause && r.cause !== "under investigation") },
    { d: "D5", label: "Actions", done: data.d5.actions.some((a) => a.done) },
    { d: "D6", label: "Validate", done: data.d6.effectiveness.some((e) => e.effectiveness) || data.d6.reinspections.length > 0 },
    { d: "D7", label: "Prevent", done: data.d7.preventive.length > 0 || data.d7.standardsUpdated },
    { d: "D8", label: "Close", done: data.d8.status === "CLOSED" },
  ];
  return (
    <div className="flex items-stretch gap-1 mb-3">
      {steps.map((s) => (
        <div key={s.d} className={"flex-1 rounded border px-1 py-1 text-center " + (s.done ? "border-emerald-600 bg-emerald-50" : "border-zinc-300 bg-zinc-50")}>
          <div className={"text-[10px] font-black " + (s.done ? "text-emerald-700" : "text-zinc-500")}>{s.d}</div>
          <div className={"text-[8px] uppercase tracking-wide " + (s.done ? "text-emerald-700/80" : "text-zinc-400")}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Response strip for the supplier SCAR sheet — D-steps the SUPPLIER must return. */
function DStrip8DResponse({ due, responded }: { due: string | null; responded: string | null }) {
  const steps = [
    { d: "D2", label: "Contain" },
    { d: "D4", label: "Root cause" },
    { d: "D5", label: "Correct" },
    { d: "D6", label: "Verify" },
    { d: "D7", label: "Prevent" },
    { d: "D8", label: "Sign-off" },
  ];
  return (
    <div className="mb-3">
      <div className="flex items-stretch gap-1">
        {steps.map((s) => (
          <div key={s.d} className="flex-1 rounded border border-zinc-300 bg-zinc-50 px-1 py-1 text-center">
            <div className="text-[10px] font-black text-zinc-600">{s.d}</div>
            <div className="text-[8px] uppercase tracking-wide text-zinc-400">{s.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[9.5px] text-zinc-600">
        Supplier response required by <b className={due && !responded ? "text-red-700" : ""}>{fmt(due)}</b>
        {responded ? <> · response recorded {fmt(responded)} (reference copy)</> : " — return this completed form with objective evidence"}
      </p>
    </div>
  );
}

/** Ruled blank lines the supplier fills in by hand (print artifacts). */
function BlankLines({ lines }: { lines: number }) {
  return (
    <div className="space-y-3 mt-1">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="border-b border-zinc-300" />
      ))}
    </div>
  );
}

function ResponseField({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 rounded border border-zinc-300 p-2">
      <p className="text-[11px] font-bold text-zinc-700">{n} · {title}</p>
      {children}
    </div>
  );
}

/** Empty ruled table the supplier fills in (print artifacts). */
function ResponseTable({ n, title, headers, rows }: { n: string; title: string; headers: string[]; rows: number }) {
  return (
    <div className="mt-2">
      <p className="text-[11px] font-bold text-zinc-700">{n} · {title}</p>
      <table className="w-full border-collapse text-[10.5px] mt-1">
        <thead>
          <tr className="bg-zinc-100">
            {headers.map((h) => (
              <th key={h} className="border border-zinc-300 px-2 py-1 text-left text-zinc-600">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              {headers.map((h, j) => (
                <td key={j} className="border border-zinc-300 px-2 py-2.5">{j === 0 ? <span className="text-zinc-400">{i + 1}</span> : ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
