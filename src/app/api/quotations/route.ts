// ============================================================================
// Tau ERP — /api/quotations — CRM quotations → SalesOrder conversion.
// GET  : list quotations (+ customers/items masters for the create dialog)
// POST : create quotation (DRAFT) — price defaults to item.unitCost * 1.15
// PATCH: status transitions DRAFT→SENT→ACCEPTED/REJECTED, ACCEPTED→CONVERTED
//        (convert creates a CONFIRMED SalesOrder with SoLines copied)
// NOTE: Quotation.customerId is a plain FK (no Prisma relation) — customers are
//       stitched in code.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, handle, getSessionUser, logAudit, nextNumber, ok, requirePerm } from "@/lib/erp/server";

const round2 = (n: number) => Math.round(n * 100) / 100;
type CustomerLike = { id: string; code: string; name: string; gstin: string; city: string; programme: string } | null;

async function customerOf(customerId: string): Promise<CustomerLike> {
  return db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, code: true, name: true, gstin: true, city: true, programme: true },
  });
}

/** GET /api/quotations — quotations + masters for the "New quotation" dialog. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requirePerm(await getSessionUser(req), "sales.view");
    const [quotations, customers, items] = await Promise.all([
      db.quotation.findMany({
        orderBy: { createdAt: "desc" },
        include: { lines: { include: { item: { select: { id: true, partNumber: true, name: true, uom: true, unitCost: true, gstRate: true, itemType: true } } } } },
      }),
      db.customer.findMany({ orderBy: { code: "asc" } }),
      db.item.findMany({
        where: { lifecycle: "ACTIVE" },
        orderBy: { partNumber: "asc" },
        select: { id: true, partNumber: true, name: true, uom: true, unitCost: true, gstRate: true, itemType: true, trackingType: true },
      }),
    ]);
    // FG items first — quotations are normally for finished sensors
    items.sort((a, b) => (a.itemType === "FINISHED" ? 0 : 1) - (b.itemType === "FINISHED" ? 0 : 1));
    const custMap = new Map(customers.map((c) => [c.id, c]));
    return ok({
      quotations: quotations.map((q) => ({ ...q, customer: custMap.get(q.customerId) ?? null })),
      customers,
      items,
    });
  });
}

/** POST /api/quotations — create a DRAFT quotation with lines. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "sales.create");
    const b = await body<{ customerId?: string; validUntil?: string | null; notes?: string; lines?: { itemId?: string; qty?: number; unitPrice?: number }[] }>(req);

    const customerId = String(b.customerId ?? "");
    if (!customerId) throw new ApiError("Customer is required", 422);
    const customer = await customerOf(customerId);
    if (!customer) throw new ApiError("Customer not found", 404);

    const rawLines = (b.lines ?? []).filter((l) => l.itemId && Number(l.qty) > 0);
    if (rawLines.length === 0) throw new ApiError("At least one quote line with qty > 0 is required", 422);

    const items = await db.item.findMany({ where: { id: { in: rawLines.map((l) => String(l.itemId)) } } });
    const itemMap = new Map(items.map((i) => [i.id, i]));

    let total = 0;
    const lineData = rawLines.map((l) => {
      const item = itemMap.get(String(l.itemId));
      if (!item) throw new ApiError(`Item not found: ${l.itemId}`, 404);
      const qty = Number(l.qty);
      // spec: price defaults to item.unitCost * 1.15 unless explicitly provided
      const unitPrice = l.unitPrice != null && Number(l.unitPrice) >= 0 ? round2(Number(l.unitPrice)) : round2(item.unitCost * 1.15);
      total += qty * unitPrice;
      return { itemId: item.id, qty, unitPrice };
    });

    const quoteNumber = await nextNumber("QUO", "quotation");
    const created = await db.quotation.create({
      data: {
        quoteNumber,
        customerId,
        status: "DRAFT",
        validUntil: b.validUntil ? new Date(String(b.validUntil)) : null,
        totalAmount: round2(total),
        notes: String(b.notes ?? ""),
        lines: { create: lineData },
      },
      include: { lines: { include: { item: true } } },
    });
    await logAudit(user, "CREATE", "Quotation", quoteNumber, `${lineData.length} line(s) for ${customer.code} — total ₹${round2(total)}`);
    return ok({ quotation: { ...created, customer } }, 201);
  });
}

/** PATCH /api/quotations — controlled status transitions incl. convert-to-SO. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "sales.create");
    const b = await body<{ id?: string; action?: string }>(req);
    const id = String(b.id ?? "");
    const action = String(b.action ?? "");
    const transitions: Record<string, { from: string[]; to: string }> = {
      send: { from: ["DRAFT"], to: "SENT" },
      accept: { from: ["SENT"], to: "ACCEPTED" },
      reject: { from: ["SENT"], to: "REJECTED" },
      convert: { from: ["ACCEPTED"], to: "CONVERTED" },
    };
    const t = transitions[action];
    if (!t) throw new ApiError(`Unknown action '${action}' (send|accept|reject|convert)`, 422);

    const quotation = await db.quotation.findUnique({ where: { id }, include: { lines: { include: { item: true } } } });
    if (!quotation) throw new ApiError("Quotation not found", 404);
    const customer = await customerOf(quotation.customerId);
    if (!t.from.includes(quotation.status)) {
      throw new ApiError(`Invalid transition: ${action} requires status ${t.from.join("|")} but quotation is ${quotation.status}`, 409);
    }

    if (action !== "convert") {
      const updated = await db.quotation.update({ where: { id: quotation.id }, data: { status: t.to }, include: { lines: { include: { item: true } } } });
      await logAudit(user, "UPDATE", "Quotation", quotation.quoteNumber, `${quotation.status} → ${t.to}`);
      return ok({ quotation: { ...updated, customer } });
    }

    // CONVERT: create CONFIRMED SalesOrder with SoLines copied from QuoteLines
    const soNumber = await nextNumber("SO", "salesOrder");
    const soId = await db.$transaction(async (tx) => {
      const created = await tx.salesOrder.create({
        data: {
          soNumber,
          customerId: quotation.customerId,
          status: "CONFIRMED",
          orderDate: new Date(),
          totalAmount: quotation.totalAmount,
          programme: customer?.programme ?? "",
        },
      });
      await tx.soLine.createMany({
        data: quotation.lines.map((l) => ({ soId: created.id, itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, gstRate: l.item.gstRate, deliveredQty: 0 })),
      });
      await tx.quotation.update({ where: { id: quotation.id }, data: { status: "CONVERTED" } });
      return created.id;
    });
    await logAudit(user, "CONVERT", "Quotation", quotation.quoteNumber, `ACCEPTED → CONVERTED; SalesOrder ${soNumber} created (CONFIRMED)`);
    await logAudit(user, "CREATE", "SalesOrder", soNumber, `from ${quotation.quoteNumber} for ${customer?.code ?? quotation.customerId} — ${quotation.lines.length} line(s), total ₹${quotation.totalAmount}`);
    const [updatedQuote, salesOrder] = await Promise.all([
      db.quotation.findUnique({ where: { id: quotation.id }, include: { lines: { include: { item: true } } } }),
      db.salesOrder.findUnique({ where: { id: soId }, include: { lines: { include: { item: true } } } }),
    ]);
    return ok({
      quotation: updatedQuote ? { ...updatedQuote, customer } : null,
      salesOrder: salesOrder ? { ...salesOrder, customer } : null,
    });
  });
}
