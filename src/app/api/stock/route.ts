// ============================================================================
// Tau ERP — Inventory & Traceability (Task 3-c)
// GET /api/stock — warehouse summary cards + inventory KPIs (session required).
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, handle, ok, ApiError } from "@/lib/erp/server";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session — please select a user in the topbar", 401);

    const [warehouses, lots, lastMovement] = await Promise.all([
      db.warehouse.findMany({ orderBy: { code: "asc" } }),
      db.stockLot.findMany({
        include: {
          item: { select: { partNumber: true, name: true, itemType: true, unitCost: true, familyCode: true } },
          _count: { select: { movements: true, genealogyParent: true, genealogyChild: true, containerMembers: true } },
        },
        orderBy: { lotNumber: "asc" },
      }),
      db.stockMovement.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);

    // Per-warehouse aggregation: lot count, total qty, stock value (IN_STOCK only for value)
    const perWh = warehouses.map((w) => {
      const whLots = lots.filter((l) => l.warehouseCode === w.code);
      const inStock = whLots.filter((l) => l.status === "IN_STOCK");
      return {
        code: w.code,
        name: w.name,
        type: w.type,
        lotCount: whLots.length,
        qty: whLots.reduce((s, l) => s + l.qty, 0),
        inStockCount: inStock.length,
        value: inStock.reduce((s, l) => s + l.qty * (l.item?.unitCost ?? 0), 0),
        rejected: whLots.filter((l) => l.status === "REJECTED").length,
        held: whLots.filter((l) => l.status === "HELD").length,
      };
    });

    const totalValue = lots
      .filter((l) => l.status === "IN_STOCK")
      .reduce((s, l) => s + l.qty * (l.item?.unitCost ?? 0), 0);

    const kpis = {
      totalLots: lots.length,
      rejectedLots: lots.filter((l) => l.status === "REJECTED").length,
      heldLots: lots.filter((l) => l.status === "HELD").length,
      fgSerialsInWhFg: lots.filter((l) => l.status === "IN_STOCK" && l.warehouseCode === "WH-FG" && l.trackingType === "SERIAL").length,
      stockValue: totalValue,
      shippedSerials: lots.filter((l) => l.status === "SHIPPED").length,
      lastMovementAt: lastMovement?.createdAt ?? null,
    };

    // status mix for a compact distribution strip
    const statusMix: Record<string, number> = {};
    for (const l of lots) statusMix[l.status] = (statusMix[l.status] ?? 0) + 1;

    return ok({ warehouses: perWh, kpis, statusMix, totalLots: lots.length });
  });
}
