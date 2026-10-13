// ============================================================================
// Tau ERP — /api/invoices — GST tax invoices raised from DISPATCHED DNs.
// GET  : invoices w/ computed lines (from DN + SO pricing), customer, e-invoice
//        logs, plus eligible DNs (DISPATCHED, not yet invoiced). DN/SO/customer
//        are stitched in code (plain FKs in the frozen schema).
// POST : create invoice from a DN — taxableValue = Σ qty × unitPrice (SO price);
//        place-of-supply from buyer GSTIN prefix: "27" (MH, intra-state) →
//        CGST+SGST at gstRate/2 each, otherwise IGST at full gstRate.
//        Invoice dedup per DN is enforced (one invoice per delivery note).
//        NEVER allowed for a non-DISPATCHED DN.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, handle, getSessionUser, logAudit, nextNumber, ok, parseJsonField, requirePerm } from "@/lib/erp/server";
import { COMPANY } from "@/lib/erp/constants";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** GET /api/invoices — invoices + eligible (DISPATCHED, un-invoiced) DNs. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requirePerm(await getSessionUser(req), "sales.view");
    const [invoices, logs, dispatchedDns, invoicedDnIds] = await Promise.all([
      db.salesInvoice.findMany({ orderBy: { createdAt: "desc" } }),
      db.eInvoiceLog.findMany({ orderBy: { createdAt: "asc" } }),
      db.deliveryNote.findMany({ where: { status: "DISPATCHED" }, select: { id: true } }),
      db.salesInvoice.findMany({ select: { dnId: true } }),
    ]);
    const invoicedSet = new Set(invoicedDnIds.map((i) => i.dnId));
    const dnIds = [...new Set([...invoices.map((i) => i.dnId), ...dispatchedDns.filter((d) => !invoicedSet.has(d.id)).map((d) => d.id)])];
    const dns = await db.deliveryNote.findMany({ where: { id: { in: dnIds } }, include: { lines: { include: { item: true } } } });
    const soIds = [...new Set([...invoices.map((i) => i.soId), ...dns.map((d) => d.soId)])];
    const sos = await db.salesOrder.findMany({ where: { id: { in: soIds } }, include: { lines: true } });
    const customers = await db.customer.findMany({ where: { id: { in: [...new Set(sos.map((s) => s.customerId))] } } });

    const dnMap = new Map(dns.map((d) => [d.id, d]));
    const soMap = new Map(sos.map((s) => [s.id, s]));
    const custMap = new Map(customers.map((c) => [c.id, c]));
    const logMap = new Map<string, typeof logs>();
    for (const l of logs) {
      const list = logMap.get(l.invoiceNumber) ?? [];
      list.push(l);
      logMap.set(l.invoiceNumber, list);
    }

    // eligible DNs: DISPATCHED without an existing invoice
    const eligibleDNs = dns
      .filter((d) => d.status === "DISPATCHED" && !invoicedSet.has(d.id))
      .map((d) => {
        const so = soMap.get(d.soId);
        const cust = so ? custMap.get(so.customerId) : null;
        return {
          id: d.id,
          dnNumber: d.dnNumber,
          soNumber: so?.soNumber ?? "",
          customerName: cust?.name ?? "",
          customerGstin: cust?.gstin ?? "",
          serialCount: d.lines.length,
          dispatchedAt: d.dispatchedAt,
        };
      });

    return ok({
      invoices: invoices.map((inv) => {
        const dn = dnMap.get(inv.dnId);
        const so = dn ? soMap.get(dn.soId) : null;
        const cust = so ? custMap.get(so.customerId) : null;
        const lines = (dn?.lines ?? []).map((l) => {
          const soLine = so?.lines.find((sl) => sl.itemId === l.itemId);
          const unitPrice = soLine?.unitPrice ?? round2(l.item.unitCost * 1.15);
          return {
            itemId: l.itemId,
            lotNumber: l.lotNumber,
            qty: l.qty,
            unitPrice,
            taxable: round2(l.qty * unitPrice),
            gstRate: l.item.gstRate,
            hsnCode: l.item.hsnCode,
            partNumber: l.item.partNumber,
            name: l.item.name,
            uom: l.item.uom,
          };
        });
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          dnId: inv.dnId,
          dnNumber: dn?.dnNumber ?? "",
          soId: inv.soId,
          soNumber: so?.soNumber ?? "",
          customer: {
            id: inv.customerId,
            name: cust?.name ?? "",
            code: cust?.code ?? "",
            gstin: cust?.gstin ?? "",
            city: cust?.city ?? "",
            state: (cust?.gstin ?? "").slice(0, 2),
          },
          taxableValue: inv.taxableValue,
          cgst: inv.cgst,
          sgst: inv.sgst,
          igst: inv.igst,
          total: inv.total,
          placeOfSupply: inv.placeOfSupply,
          status: inv.status,
          irn: inv.irn,
          irnAt: inv.irnAt,
          qr: parseJsonField<Record<string, unknown>>(inv.qrPayloadJson, {}),
          synthetic: inv.synthetic,
          createdAt: inv.createdAt,
          lines,
          logs: (logMap.get(inv.invoiceNumber) ?? []).map((l) => ({ id: l.id, correlationId: l.correlationId, mode: l.mode, status: l.status, attempts: l.attempts, errorMessage: l.errorMessage, createdAt: l.createdAt })),
        };
      }),
      eligibleDNs,
    });
  });
}

/** POST /api/invoices — raise a GST invoice from a DISPATCHED DN. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "sales.invoice");
    const b = await body<{ dnId?: string }>(req);
    const dn = await db.deliveryNote.findUnique({ where: { id: String(b.dnId ?? "") }, include: { lines: { include: { item: true } } } });
    if (!dn) throw new ApiError("Delivery note not found", 404);
    const so = await db.salesOrder.findUnique({ where: { id: dn.soId }, include: { lines: true } });
    if (!so) throw new ApiError("Sales order for this delivery note not found", 404);
    const customer = await db.customer.findUnique({ where: { id: so.customerId } });
    if (!customer) throw new ApiError("Customer for this sales order not found", 404);

    if (dn.status !== "DISPATCHED") {
      throw new ApiError(`Invoice can only be created for a DISPATCHED delivery note — ${dn.dnNumber} is ${dn.status}`, 409);
    }
    const existing = await db.salesInvoice.findFirst({ where: { dnId: dn.id } });
    if (existing) {
      throw new ApiError(`Invoice ${existing.invoiceNumber} already exists for ${dn.dnNumber} — one invoice per delivery note`, 409);
    }
    if (dn.lines.length === 0) throw new ApiError("Delivery note has no lines to bill", 422);

    // GST split: buyer state from GSTIN prefix; "27" = MH (same as seller) → intra-state
    const buyerState = (customer.gstin || "").slice(0, 2).toUpperCase();
    const intraState = buyerState === COMPANY.state; // seller is 27 / MH
    let taxableValue = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const line of dn.lines) {
      const soLine = so.lines.find((sl) => sl.itemId === line.itemId);
      const unitPrice = soLine?.unitPrice ?? round2(line.item.unitCost * 1.15);
      const taxable = round2(line.qty * unitPrice);
      const rate = line.item.gstRate; // synthetic — approved per Decision Register DR-001 (India GST 18% demo model)
      taxableValue += taxable;
      if (intraState) {
        cgst += round2((taxable * rate) / 200);
        sgst += round2((taxable * rate) / 200);
      } else {
        igst += round2((taxable * rate) / 100);
      }
    }
    taxableValue = round2(taxableValue);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    const total = round2(taxableValue + cgst + sgst + igst);

    const invoiceNumber = await nextNumber("INV", "salesInvoice");
    const invoice = await db.salesInvoice.create({
      data: {
        invoiceNumber,
        dnId: dn.id,
        soId: so.id,
        customerId: customer.id,
        taxableValue,
        cgst,
        sgst,
        igst,
        total,
        placeOfSupply: buyerState || COMPANY.state,
        status: "ISSUED",
        synthetic: true,
      },
    });
    await logAudit(
      user,
      "CREATE",
      "SalesInvoice",
      invoiceNumber,
      `from ${dn.dnNumber} / ${so.soNumber} — taxable ₹${taxableValue}, CGST ₹${cgst}, SGST ₹${sgst}, IGST ₹${igst}, total ₹${total} (place of supply ${buyerState || COMPANY.state}, ${intraState ? "intra-state" : "inter-state"})`
    );
    await db.notification.createMany({
      data: [
        {
          role: "FINANCE_MGR",
          kind: "INFO",
          severity: "INFO",
          title: `Invoice ${invoiceNumber} issued`,
          message: `GST invoice for ${dn.dnNumber} (${so.soNumber}) — total ₹${total.toLocaleString("en-IN")}. Generate the e-Invoice (SANDBOX_MOCK) from the GST Invoices tab.`,
          refType: "INVOICE",
          refId: invoiceNumber,
        },
        {
          role: "SALES_MGR",
          kind: "INFO",
          severity: "INFO",
          title: `Invoice ${invoiceNumber} issued`,
          message: `GST invoice raised against ${so.soNumber} — total ₹${total.toLocaleString("en-IN")}.`,
          refType: "INVOICE",
          refId: invoiceNumber,
        },
      ],
    });
    return ok({ invoice }, 201);
  });
}
