import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, nextNumber, ok, requirePerm } from "@/lib/erp/server";

/**
 * GET /api/rfqs — RFQ register with quotations (supplier included).
 * Optional ?master=items → also returns the item master so the Procurement module
 * can build RFQ/PO dialogs without depending on the (separately built) /api/items route.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const wantsItems = req.nextUrl.searchParams.get("master") === "items";
    const rfqs = await db.rfq.findMany({
      orderBy: { number: "desc" },
      include: {
        item: { select: { partNumber: true, name: true, uom: true, criticality: true, itemType: true } },
        quotations: {
          orderBy: { unitPrice: "asc" },
          include: { supplier: { select: { code: true, name: true, approved: true, rating: true } } },
        },
      },
    });
    const payload: Record<string, unknown> = { rfqs };
    if (wantsItems) {
      payload.items = await db.item.findMany({
        orderBy: { partNumber: "asc" },
        select: {
          id: true, partNumber: true, name: true, uom: true, trackingType: true,
          criticality: true, unitCost: true, gstRate: true, itemType: true, familyCode: true, lifecycle: true,
        },
      });
    }
    return ok(payload);
  });
}

/**
 * POST /api/rfqs — raise a new Request for Quotation (status OPEN).
 * RBAC: procurement.create. Audited.
 * Body: { itemId, qty, dueDate? }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "procurement.create");
    const b = await body<{ itemId?: string; qty?: number; dueDate?: string }>(req);

    const itemId = String(b.itemId ?? "");
    const qty = Number(b.qty);
    if (!itemId) throw new ApiError("itemId is required", 400);
    if (!Number.isFinite(qty) || qty <= 0) throw new ApiError("Quantity must be a positive number", 400);

    const item = await db.item.findUnique({ where: { id: itemId } });
    if (!item) throw new ApiError("Item not found", 404);
    if (item.lifecycle === "OBSOLETE") throw new ApiError(`Item ${item.partNumber} is OBSOLETE — cannot be procured`, 422);

    let dueDate: Date | null = null;
    if (b.dueDate) {
      dueDate = new Date(b.dueDate);
      if (isNaN(dueDate.getTime())) throw new ApiError("Invalid dueDate", 400);
    }

    const number = await nextNumber("RFQ", "rfq");
    const rfq = await db.rfq.create({ data: { number, itemId, qty, dueDate, status: "OPEN" } });
    await logAudit(user, "CREATE", "RFQ", number, `${item.partNumber} (${item.name}) · qty ${qty} ${item.uom}`);
    return ok({ rfq }, 201);
  });
}
