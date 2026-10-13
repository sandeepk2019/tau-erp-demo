// ============================================================================
// Tau ERP — /api/sales-orders — SO list + lifecycle transitions.
// GET  : sales orders w/ customer (stitched — plain FK), lines (deliveredQty
//        progress), linked WOs and per-item FG serial availability in WH-FG.
// PATCH: CONFIRMED→IN_PRODUCTION (manual action) and
//        IN_PRODUCTION→READY (server-verified: enough IN_STOCK FG serials).
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, handle, getSessionUser, logAudit, ok, requirePerm } from "@/lib/erp/server";

/** GET /api/sales-orders */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requirePerm(await getSessionUser(req), "sales.view");
    const [salesOrders, wos, fgGroups, customers] = await Promise.all([
      db.salesOrder.findMany({
        orderBy: { orderDate: "desc" },
        include: { lines: { include: { item: { select: { id: true, partNumber: true, name: true, uom: true, gstRate: true, trackingType: true, itemType: true } } } } },
      }),
      db.workOrder.findMany({ select: { soNumber: true, woNumber: true, status: true }, orderBy: { woNumber: "asc" } }),
      db.stockLot.groupBy({ by: ["itemId"], _count: { _all: true }, where: { status: "IN_STOCK", warehouseCode: "WH-FG", trackingType: "SERIAL" } }),
      db.customer.findMany(),
    ]);
    const woBySo = new Map<string, { woNumber: string; status: string }[]>();
    for (const w of wos) {
      if (!w.soNumber) continue;
      const list = woBySo.get(w.soNumber) ?? [];
      list.push({ woNumber: w.woNumber, status: w.status });
      woBySo.set(w.soNumber, list);
    }
    const custMap = new Map(customers.map((c) => [c.id, c]));
    const fgCounts: Record<string, number> = {};
    for (const g of fgGroups) fgCounts[g.itemId] = g._count._all;
    return ok({
      salesOrders: salesOrders.map((so) => ({ ...so, customer: custMap.get(so.customerId) ?? null, woLinks: woBySo.get(so.soNumber) ?? [] })),
      fgCounts,
    });
  });
}

/** PATCH /api/sales-orders — strict status transitions. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "sales.create");
    const b = await body<{ id?: string; action?: string }>(req);
    const so = await db.salesOrder.findUnique({
      where: { id: String(b.id ?? "") },
      include: { lines: { include: { item: { select: { partNumber: true } } } } },
    });
    if (!so) throw new ApiError("Sales order not found", 404);
    const customer = await db.customer.findUnique({ where: { id: so.customerId } });

    switch (String(b.action ?? "")) {
      case "in_production": {
        if (so.status !== "CONFIRMED") throw new ApiError(`Invalid transition: IN_PRODUCTION requires CONFIRMED but SO is ${so.status}`, 409);
        const wos = await db.workOrder.count({ where: { soNumber: so.soNumber } });
        await db.salesOrder.update({ where: { id: so.id }, data: { status: "IN_PRODUCTION" } });
        await logAudit(user, "UPDATE", "SalesOrder", so.soNumber, `CONFIRMED → IN_PRODUCTION${wos > 0 ? ` (${wos} linked WO(s))` : " (no linked WO — manual advance)"}`);
        return ok({ soNumber: so.soNumber, status: "IN_PRODUCTION" });
      }
      case "ready": {
        if (so.status !== "IN_PRODUCTION") throw new ApiError(`Invalid transition: READY requires IN_PRODUCTION but SO is ${so.status}`, 409);
        // READY gate: every open line must be covered by IN_STOCK finished serials in WH-FG
        const shortfalls: string[] = [];
        for (const line of so.lines) {
          const need = line.qty - line.deliveredQty;
          if (need <= 0) continue;
          const avail = await db.stockLot.count({
            where: { itemId: line.itemId, status: "IN_STOCK", warehouseCode: "WH-FG", trackingType: "SERIAL" },
          });
          if (avail < need) shortfalls.push(`${line.item.partNumber}: need ${need}, IN_STOCK serials in WH-FG: ${avail}`);
        }
        if (shortfalls.length > 0) {
          throw new ApiError(`Cannot mark READY — insufficient finished-goods stock (${shortfalls.join("; ")})`, 422);
        }
        await db.salesOrder.update({ where: { id: so.id }, data: { status: "READY" } });
        await logAudit(user, "UPDATE", "SalesOrder", so.soNumber, `IN_PRODUCTION → READY for ${customer?.code ?? so.customerId} (FG serial availability verified in WH-FG)`);
        return ok({ soNumber: so.soNumber, status: "READY" });
      }
      default:
        throw new ApiError("Unknown action (in_production|ready)", 422);
    }
  });
}
