import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, nextNumber, ok, requirePerm } from "@/lib/erp/server";

/**
 * GET /api/purchase-orders — PO register with supplier + lines (item included).
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    const purchaseOrders = await db.purchaseOrder.findMany({
      orderBy: { poNumber: "desc" },
      include: {
        supplier: { select: { code: true, name: true, approved: true, city: true } },
        lines: {
          orderBy: { id: "asc" },
          include: { item: { select: { partNumber: true, name: true, uom: true, trackingType: true, criticality: true, gstRate: true } } },
        },
        receipts: { select: { id: true, grnNumber: true, status: true, receivedAt: true }, orderBy: { receivedAt: "desc" } },
      },
    });
    return ok({ purchaseOrders });
  });
}

/**
 * POST /api/purchase-orders — create a PO (DRAFT, or PENDING_APPROVAL when submit=true).
 * RBAC: procurement.create. Spec acceptance rule enforced server-side:
 * a CRITICAL (controlled) item can never be purchased from an unapproved supplier.
 * Body: { supplierId, expectedDate?, submit?, lines: [{ itemId, qty, unitPrice }] }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "procurement.create");
    const b = await body<{
      supplierId?: string; expectedDate?: string; submit?: boolean;
      lines?: { itemId?: string; qty?: number; unitPrice?: number }[];
    }>(req);

    const supplierId = String(b.supplierId ?? "");
    if (!supplierId) throw new ApiError("supplierId is required", 400);
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (lines.length === 0) throw new ApiError("At least one PO line is required", 400);

    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new ApiError("Supplier not found", 404);

    let totalAmount = 0;
    const lineData: { itemId: string; qty: number; unitPrice: number; gstRate: number }[] = [];
    const seenItems = new Set<string>();
    for (const l of lines) {
      const itemId = String(l.itemId ?? "");
      const qty = Number(l.qty);
      const unitPrice = Number(l.unitPrice);
      if (!itemId) throw new ApiError("Every PO line needs an item", 400);
      if (!Number.isFinite(qty) || qty <= 0) throw new ApiError("PO line quantities must be positive numbers", 400);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ApiError("PO line unit prices must be non-negative numbers", 400);
      if (seenItems.has(itemId)) throw new ApiError("Duplicate item on PO — merge the quantities into one line", 422);
      seenItems.add(itemId);

      const item = await db.item.findUnique({ where: { id: itemId } });
      if (!item) throw new ApiError("Item not found", 404);
      if (item.lifecycle === "OBSOLETE") throw new ApiError(`Item ${item.partNumber} is OBSOLETE — cannot be procured`, 422);
      if (item.criticality === "CRITICAL" && !supplier.approved) {
        throw new ApiError("Controlled item cannot be purchased from unapproved supplier (spec acceptance test)", 422);
      }
      totalAmount += qty * unitPrice;
      lineData.push({ itemId, qty, unitPrice, gstRate: item.gstRate });
    }

    let expectedDate: Date | null = null;
    if (b.expectedDate) {
      expectedDate = new Date(b.expectedDate);
      if (isNaN(expectedDate.getTime())) throw new ApiError("Invalid expectedDate", 400);
    }

    const status = b.submit ? "PENDING_APPROVAL" : "DRAFT";
    const poNumber = await nextNumber("PO", "purchaseOrder");
    const po = await db.purchaseOrder.create({
      data: {
        poNumber, supplierId, status, expectedDate, totalAmount,
        lines: { create: lineData },
      },
      include: { lines: true },
    });

    await logAudit(
      user, "CREATE", "PURCHASE_ORDER", poNumber,
      `${supplier.code} (${supplier.name}) · ${lineData.length} line(s) · ₹${totalAmount} ex-GST · status ${status}`,
    );
    return ok({ po }, 201);
  });
}
