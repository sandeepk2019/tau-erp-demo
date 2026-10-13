// ============================================================================
// Tau ERP — Inventory & Traceability (Task 3-c)
// GET /api/lots — serial/batch lot register with filters + full movement history
// and genealogy counts for the lot detail dialog. Session required.
// Query: ?q=<lotNumber|item partNumber|item name>&status=<status>&wh=<warehouseCode>
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, handle, ok, ApiError } from "@/lib/erp/server";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session — please select a user in the topbar", 401);

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const status = (searchParams.get("status") ?? "").trim();
    const wh = (searchParams.get("wh") ?? "").trim();

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (wh) where.warehouseCode = wh;
    if (q) {
      where.OR = [
        { lotNumber: { contains: q } },
        { supplierBatch: { contains: q } },
        { woNumber: { contains: q } },
        { item: { is: { OR: [{ partNumber: { contains: q } }, { name: { contains: q } }] } } },
      ];
    }

    const lots = await db.stockLot.findMany({
      where,
      include: {
        item: { select: { partNumber: true, name: true, itemType: true, trackingType: true, uom: true, unitCost: true, familyCode: true } },
        movements: { orderBy: { createdAt: "desc" } },
        _count: { select: { genealogyParent: true, genealogyChild: true, containerMembers: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // GRN references for lots with a grnLineId (trace: purchase document)
    const grnLineIds = lots.map((l) => l.grnLineId).filter((v): v is string => Boolean(v));
    const grnLines = grnLineIds.length
      ? await db.grnLine.findMany({ where: { id: { in: grnLineIds } }, include: { grn: { select: { grnNumber: true } } } })
      : [];
    const grnByLine = new Map(grnLines.map((g) => [g.id, g.grn.grnNumber]));

    return ok({
      lots: lots.map((l) => ({
        id: l.id,
        lotNumber: l.lotNumber,
        item: l.item,
        trackingType: l.trackingType,
        status: l.status,
        warehouseCode: l.warehouseCode,
        qty: l.qty,
        supplierBatch: l.supplierBatch,
        grnLineId: l.grnLineId,
        grnNumber: l.grnLineId ? grnByLine.get(l.grnLineId) ?? "" : "",
        woNumber: l.woNumber,
        expiryDate: l.expiryDate,
        createdAt: l.createdAt,
        genealogy: { parents: l._count.genealogyParent, children: l._count.genealogyChild },
        containerCount: l._count.containerMembers,
        movements: l.movements.map((m) => ({
          id: m.id, type: m.type, qty: m.qty, fromWh: m.fromWh, toWh: m.toWh,
          refType: m.refType, refId: m.refId, userId: m.userId, note: m.note, createdAt: m.createdAt,
        })),
      })),
      total: lots.length,
    });
  });
}
