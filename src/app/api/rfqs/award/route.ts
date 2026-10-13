import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, ok, requirePerm } from "@/lib/erp/server";

/**
 * POST /api/rfqs/award — award an RFQ to a supplier quotation.
 * RBAC: procurement.approve. Only OPEN/QUOTED RFQs can be awarded; the winning
 * quotation is marked SELECTED, all others REJECTED, RFQ → AWARDED. Audited.
 * Body: { quotationId }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "procurement.approve");
    const b = await body<{ quotationId?: string }>(req);
    const quotationId = String(b.quotationId ?? "");
    if (!quotationId) throw new ApiError("quotationId is required", 400);

    const q = await db.supplierQuotation.findUnique({
      where: { id: quotationId },
      include: { rfq: { include: { item: { select: { partNumber: true } } } }, supplier: true },
    });
    if (!q) throw new ApiError("Quotation not found", 404);
    if (!["OPEN", "QUOTED"].includes(q.rfq.status)) {
      throw new ApiError(`RFQ ${q.rfq.number} is ${q.rfq.status} — only OPEN or QUOTED RFQs can be awarded`, 422);
    }
    if (q.supplier.category === "CRITICAL" && !q.supplier.approved) {
      throw new ApiError(`Supplier ${q.supplier.code} is unapproved — cannot award controlled items`, 422);
    }

    await db.$transaction([
      db.supplierQuotation.updateMany({ where: { rfqId: q.rfqId }, data: { selected: false, status: "REJECTED" } }),
      db.supplierQuotation.update({ where: { id: q.id }, data: { selected: true, status: "SELECTED" } }),
      db.rfq.update({ where: { id: q.rfqId }, data: { status: "AWARDED" } }),
    ]);

    await logAudit(
      user,
      "AWARD",
      "RFQ",
      q.rfq.number,
      `Awarded to ${q.supplier.code} (${q.supplier.name}) @ ₹${q.unitPrice}, lead ${q.leadTimeDays}d, MOQ ${q.moq} — ${q.rfq.item.partNumber}`,
    );
    return ok({ rfqNumber: q.rfq.number, awardedSupplier: q.supplier.code });
  });
}
