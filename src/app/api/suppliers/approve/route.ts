import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, ok, requirePerm } from "@/lib/erp/server";

/**
 * POST /api/suppliers/approve — toggle supplier approval (approved + approvedDate).
 * Server-enforced RBAC: procurement.approve. Audited (spec: approved supplier list is controlled).
 * Body: { supplierId, approve: boolean }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "procurement.approve");
    const b = await body<{ supplierId?: string; approve?: boolean }>(req);
    const supplierId = String(b.supplierId ?? "");
    if (!supplierId) throw new ApiError("supplierId is required", 400);

    const sup = await db.supplier.findUnique({ where: { id: supplierId } });
    if (!sup) throw new ApiError("Supplier not found", 404);

    const approve = Boolean(b.approve);
    if (sup.approved === approve) {
      throw new ApiError(`Supplier ${sup.code} is already ${approve ? "approved" : "unapproved"}`, 422);
    }

    const updated = await db.supplier.update({
      where: { id: sup.id },
      data: { approved: approve, approvedDate: approve ? new Date() : null },
    });

    await logAudit(
      user,
      approve ? "APPROVE" : "REVOKE",
      "SUPPLIER",
      sup.code,
      `${approve ? "Approved" : "Approval revoked for"} ${sup.name} (${sup.category}) by ${user.username}`,
    );
    return ok({ supplier: updated });
  });
}
