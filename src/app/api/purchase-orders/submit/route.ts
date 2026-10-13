import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, ok, requirePerm } from "@/lib/erp/server";

/**
 * POST /api/purchase-orders/submit — submit a DRAFT PO for approval (DRAFT → PENDING_APPROVAL).
 * RBAC: procurement.create. Audited. Transition guard: only DRAFT may be submitted.
 * Body: { poId }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "procurement.create");
    const b = await body<{ poId?: string }>(req);
    const poId = String(b.poId ?? "");
    if (!poId) throw new ApiError("poId is required", 400);

    const po = await db.purchaseOrder.findUnique({ where: { id: poId }, include: { supplier: { select: { code: true } } } });
    if (!po) throw new ApiError("Purchase order not found", 404);
    if (po.status !== "DRAFT") {
      throw new ApiError(`Only DRAFT POs can be submitted for approval (${po.poNumber} current status: ${po.status})`, 422);
    }

    const updated = await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "PENDING_APPROVAL" } });
    await logAudit(user, "SUBMIT", "PURCHASE_ORDER", po.poNumber, `Submitted for approval by ${user.username} (${po.supplier.code})`);
    return ok({ po: updated });
  });
}
