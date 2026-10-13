import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, fourEyes, getSessionUser, handle, logAudit, ok, requirePerm } from "@/lib/erp/server";

/**
 * POST /api/purchase-orders/approve — approve a PENDING_APPROVAL PO (→ APPROVED).
 * RBAC: procurement.approve + FOUR-EYES (spec rule 12): the approver must differ from
 * the user who created/submitted the PO. The requester is identified from the immutable
 * audit trail (latest CREATE/SUBMIT entry for this PO). Server sets approvedBy = session user.
 * Body: { poId }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "procurement.approve");
    const b = await body<{ poId?: string }>(req);
    const poId = String(b.poId ?? "");
    if (!poId) throw new ApiError("poId is required", 400);

    const po = await db.purchaseOrder.findUnique({ where: { id: poId }, include: { supplier: { select: { code: true } } } });
    if (!po) throw new ApiError("Purchase order not found", 404);
    if (po.status !== "PENDING_APPROVAL") {
      throw new ApiError(`Only PENDING_APPROVAL POs can be approved (${po.poNumber} current status: ${po.status})`, 422);
    }
    if (po.approvedBy) {
      throw new ApiError(`${po.poNumber} is already approved by ${po.approvedBy}`, 422);
    }

    // Four-eyes: resolve the requester (creator/submitter) from the immutable audit trail.
    const requester = await db.auditLog.findFirst({
      where: { entityType: "PURCHASE_ORDER", entityId: po.poNumber, action: { in: ["CREATE", "SUBMIT"] } },
      orderBy: { createdAt: "desc" },
    });
    if (requester) fourEyes(requester.userName, user.username, "PO approval");

    const updated = await db.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "APPROVED", approvedBy: user.username },
    });

    await logAudit(
      user, "APPROVE", "PURCHASE_ORDER", po.poNumber,
      `Approved by ${user.username} · ${po.supplier.code} · ₹${po.totalAmount} ex-GST · four-eyes: ${requester ? `requester ${requester.userName} ≠ approver ok` : "no recorded requester (seeded PO)"}`,
    );
    return ok({ po: updated });
  });
}
