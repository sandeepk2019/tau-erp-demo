// ============================================================================
// Tau ERP — /api/delivery — packing list (DN) creation with serial reservation.
// GET  : delivery notes (+ SO/customer stitched — plain FKs), SOs eligible for
//        packing (CONFIRMED|READY) and IN_STOCK finished serials in WH-FG.
// POST : create DRAFT DN from picked serials → DeliveryLine per serial,
//        serials marked HELD (reserved). Double-packing is blocked server-side:
//        a serial already on an open DN (DRAFT|PICKED) raises ApiError.
// PATCH: cancel an open DN → reserved serials released back to IN_STOCK.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, handle, getSessionUser, logAudit, nextNumber, ok, requirePerm } from "@/lib/erp/server";

/** GET /api/delivery — DNs + packing meta (eligible SOs, available FG serials). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requirePerm(await getSessionUser(req), "sales.view");
    const [dns, eligibleSOs, serials, customers, allSo] = await Promise.all([
      db.deliveryNote.findMany({
        orderBy: { dnNumber: "desc" }, // DeliveryNote has no createdAt in the frozen schema
        include: { lines: { include: { item: { select: { id: true, partNumber: true, name: true } } } } },
      }),
      db.salesOrder.findMany({
        where: { status: { in: ["CONFIRMED", "READY"] } },
        orderBy: { orderDate: "desc" },
        include: { lines: { include: { item: { select: { id: true, partNumber: true, name: true, uom: true, trackingType: true } } } } },
      }),
      db.stockLot.findMany({
        where: { status: "IN_STOCK", warehouseCode: "WH-FG", trackingType: "SERIAL", item: { itemType: "FINISHED" } },
        orderBy: { lotNumber: "asc" },
        include: {
          item: { select: { id: true, partNumber: true, name: true } },
          containerMembers: { include: { container: { select: { containerNumber: true, status: true } } } },
        },
      }),
      db.customer.findMany({ select: { id: true, name: true, code: true } }),
      db.salesOrder.findMany({ select: { id: true, soNumber: true, customerId: true } }),
    ]);
    const custMap = new Map(customers.map((c) => [c.id, c]));
    const soMap = new Map(allSo.map((s) => [s.id, s]));

    return ok({
      deliveryNotes: dns.map((d) => {
        const so = soMap.get(d.soId);
        return {
          id: d.id,
          dnNumber: d.dnNumber,
          soId: d.soId,
          soNumber: so?.soNumber ?? "",
          customerName: so ? (custMap.get(so.customerId)?.name ?? "") : "",
          status: d.status,
          vehicleNo: d.vehicleNo,
          ewayBillNo: d.ewayBillNo,
          dispatchedAt: d.dispatchedAt,
          lines: d.lines.map((l) => ({ id: l.id, itemId: l.itemId, lotNumber: l.lotNumber, qty: l.qty, item: l.item })),
        };
      }),
      eligibleSOs: eligibleSOs.map((so) => ({
        id: so.id,
        soNumber: so.soNumber,
        customerName: custMap.get(so.customerId)?.name ?? "",
        programme: so.programme,
        status: so.status,
        lines: so.lines.map((l) => ({ id: l.id, itemId: l.itemId, qty: l.qty, deliveredQty: l.deliveredQty, item: l.item })),
      })),
      availableSerials: serials.map((s) => ({
        id: s.id,
        lotNumber: s.lotNumber,
        itemId: s.itemId,
        item: s.item,
        containerNumber: s.containerMembers[0]?.container.containerNumber ?? null,
        containerStatus: s.containerMembers[0]?.container.status ?? null,
      })),
    });
  });
}

type DnPostBody = { soId?: string; lines?: { itemId?: string; lotIds?: string[] }[] };

/** POST /api/delivery — create DRAFT DN; reserve the picked serials (HELD). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "sales.dispatch");
    const b = await body<DnPostBody>(req);
    const soId = String(b.soId ?? "");
    const so = await db.salesOrder.findUnique({ where: { id: soId }, include: { lines: { include: { item: true } } } });
    if (!so) throw new ApiError("Sales order not found", 404);
    const customer = await db.customer.findUnique({ where: { id: so.customerId } });
    if (!["CONFIRMED", "READY"].includes(so.status)) {
      throw new ApiError(`Packing allowed only for CONFIRMED or READY sales orders — ${so.soNumber} is ${so.status}`, 409);
    }

    const reqLines = (b.lines ?? []).filter((l) => l.itemId && (l.lotIds ?? []).length > 0);
    if (reqLines.length === 0) throw new ApiError("Pick at least one serial to pack", 422);

    // resolve all picked serials up-front (strict validation)
    const allLotIds = reqLines.flatMap((l) => (l.lotIds ?? []).map(String));
    const lots = await db.stockLot.findMany({ where: { id: { in: allLotIds } }, include: { item: true } });
    const lotMap = new Map(lots.map((l) => [l.id, l]));

    const soLineByItem = new Map(so.lines.map((l) => [l.itemId, l]));
    const pickedCountByItem = new Map<string, number>();
    const flat: { itemId: string; lotNumber: string; lotId: string }[] = [];

    for (const line of reqLines) {
      const soLine = soLineByItem.get(String(line.itemId));
      if (!soLine) throw new ApiError(`Item on packing list does not belong to ${so.soNumber}`, 422);
      for (const lotId of line.lotIds ?? []) {
        const lot = lotMap.get(String(lotId));
        if (!lot) throw new ApiError(`Serial not found (${lotId})`, 404);
        if (lot.itemId !== line.itemId) throw new ApiError(`Serial ${lot.lotNumber} is not ${soLine.item.partNumber}`, 422);
        if (lot.status !== "IN_STOCK" || lot.warehouseCode !== "WH-FG") {
          throw new ApiError(`Serial ${lot.lotNumber} is not available (status ${lot.status} @ ${lot.warehouseCode})`, 409);
        }
        if (lot.trackingType !== "SERIAL") throw new ApiError(`Lot ${lot.lotNumber} is not a serial-tracked lot`, 422);
        pickedCountByItem.set(String(line.itemId), (pickedCountByItem.get(String(line.itemId)) ?? 0) + 1);
        flat.push({ itemId: String(line.itemId), lotNumber: lot.lotNumber, lotId: lot.id });
      }
    }

    // remaining-qty guard per SO line
    for (const [itemId, picked] of pickedCountByItem) {
      const soLine = soLineByItem.get(itemId);
      if (!soLine) continue;
      const remaining = soLine.qty - soLine.deliveredQty;
      if (picked > remaining) {
        throw new ApiError(`Picked ${picked} serial(s) of ${soLine.item.partNumber} but only ${remaining} remaining on ${so.soNumber}`, 422);
      }
    }

    // DOUBLE-PACKING GUARD — a serial already on an open DN cannot be reserved again
    const lotNumbers = flat.map((f) => f.lotNumber);
    const clash = await db.deliveryLine.findMany({
      where: { lotNumber: { in: lotNumbers }, dn: { status: { in: ["DRAFT", "PICKED"] } } },
      include: { dn: { select: { dnNumber: true, status: true } } },
    });
    if (clash.length > 0) {
      const c = clash[0];
      throw new ApiError(`Serial ${c.lotNumber} is already reserved on open delivery note ${c.dn.dnNumber} (${c.dn.status}) — double-packing prevented`, 409);
    }
    // HELD serials are reserved too (e.g. legacy data) — treat as unavailable
    const held = lots.filter((l) => l.status === "HELD");
    if (held.length > 0) throw new ApiError(`Serial ${held[0].lotNumber} is HELD for another process`, 409);

    const dnNumber = await nextNumber("DN", "deliveryNote");
    const dnId = await db.$transaction(async (tx) => {
      const created = await tx.deliveryNote.create({ data: { dnNumber, soId: so.id, status: "DRAFT" } });
      await tx.deliveryLine.createMany({
        data: flat.map((f) => ({ dnId: created.id, itemId: f.itemId, lotNumber: f.lotNumber, qty: 1 })),
      });
      await tx.stockLot.updateMany({ where: { id: { in: flat.map((f) => f.lotId) } }, data: { status: "HELD" } });
      return created.id;
    });
    await logAudit(user, "CREATE", "DeliveryNote", dnNumber, `${flat.length} serial(s) reserved (HELD) for ${so.soNumber} — ${customer?.code ?? so.customerId}`);
    const deliveryNote = await db.deliveryNote.findUnique({ where: { id: dnId }, include: { lines: { include: { item: true } } } });
    return ok({ deliveryNote }, 201);
  });
}

/** PATCH /api/delivery — cancel an open DN and release reserved serials. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "sales.dispatch");
    const b = await body<{ id?: string; action?: string }>(req);
    if (String(b.action ?? "") !== "cancel") throw new ApiError("Unknown action (cancel)", 422);
    const dn = await db.deliveryNote.findUnique({ where: { id: String(b.id ?? "") }, include: { lines: true } });
    if (!dn) throw new ApiError("Delivery note not found", 404);
    if (!["DRAFT", "PICKED"].includes(dn.status)) {
      throw new ApiError(`Only DRAFT or PICKED delivery notes can be cancelled — ${dn.dnNumber} is ${dn.status}`, 409);
    }
    await db.$transaction(async (tx) => {
      await tx.deliveryNote.update({ where: { id: dn.id }, data: { status: "CANCELLED" } });
      for (const line of dn.lines) {
        await tx.stockLot.updateMany({ where: { lotNumber: line.lotNumber, status: "HELD" }, data: { status: "IN_STOCK" } });
      }
    });
    await logAudit(user, "CANCEL", "DeliveryNote", dn.dnNumber, `CANCELLED — ${dn.lines.length} reserved serial(s) released back to IN_STOCK @ WH-FG`);
    return ok({ dnNumber: dn.dnNumber, status: "CANCELLED" });
  });
}
