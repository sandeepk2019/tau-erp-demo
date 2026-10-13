import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, ok, requirePerm } from "@/lib/erp/server";

/**
 * POST /api/rfqs/quote — record a supplier quotation against an OPEN/QUOTED RFQ.
 * RBAC: procurement.create. Audited. (Needed to complete the RFQ→SQ→award demo flow
 * since the seeded RFQ is already awarded.)
 * Body: { rfqId, supplierId, unitPrice, leadTimeDays, moq? }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "procurement.create");
    const b = await body<{ rfqId?: string; supplierId?: string; unitPrice?: number; leadTimeDays?: number; moq?: number }>(req);

    const rfqId = String(b.rfqId ?? "");
    const supplierId = String(b.supplierId ?? "");
    const unitPrice = Number(b.unitPrice);
    const leadTimeDays = Number(b.leadTimeDays);
    const moq = Number(b.moq ?? 0);
    if (!rfqId) throw new ApiError("rfqId is required", 400);
    if (!supplierId) throw new ApiError("supplierId is required", 400);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ApiError("unitPrice must be a non-negative number", 400);
    if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0) throw new ApiError("leadTimeDays must be a non-negative integer", 400);
    if (!Number.isFinite(moq) || moq < 0) throw new ApiError("moq must be a non-negative number", 400);

    const rfq = await db.rfq.findUnique({ where: { id: rfqId }, include: { item: { select: { partNumber: true } } } });
    if (!rfq) throw new ApiError("RFQ not found", 404);
    if (!["OPEN", "QUOTED"].includes(rfq.status)) {
      throw new ApiError(`RFQ ${rfq.number} is ${rfq.status} — quotations can only be recorded while OPEN/QUOTED`, 422);
    }
    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new ApiError("Supplier not found", 404);

    const dup = await db.supplierQuotation.findFirst({ where: { rfqId, supplierId } });
    if (dup) throw new ApiError(`A quotation from ${supplier.code} already exists on ${rfq.number} — update it instead`, 422);

    const quotation = await db.supplierQuotation.create({
      data: { rfqId, supplierId, unitPrice, leadTimeDays, moq, status: "RECEIVED" },
    });
    if (rfq.status === "OPEN") {
      await db.rfq.update({ where: { id: rfqId }, data: { status: "QUOTED" } });
    }

    await logAudit(user, "CREATE", "RFQ_QUOTATION", quotation.id, `${rfq.number} ← ${supplier.code} @ ₹${unitPrice}, lead ${leadTimeDays}d, MOQ ${moq}`);
    return ok({ quotation }, 201);
  });
}
