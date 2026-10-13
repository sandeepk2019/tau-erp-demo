// ============================================================================
// Tau ERP — /api/delivery/dispatch — gate-out of a packed delivery note.
// POST { dnId, vehicleNo?, ewayBillNo? }:
//   1. DN must be DRAFT|PICKED; every line serial must be HELD (reserved).
//   2. Serials → SHIPPED; StockMovement SHIP from WH-FG → CUSTOMER (ref DN).
//   3. Containers holding shipped serials → DISPATCHED (dnNumber stamped).
//   4. DN → DISPATCHED + dispatchedAt (+ optional SYNTHETIC ewayBillNo).
//   5. SO line deliveredQty += qty; SO → DISPATCHED if fully delivered, PARTIAL otherwise.
//   6. Audit + notifications to SALES_MGR & FINANCE_MGR roles.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, handle, getSessionUser, logAudit, ok, requirePerm } from "@/lib/erp/server";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "sales.dispatch");
    const b = await body<{ dnId?: string; vehicleNo?: string; ewayBillNo?: string }>(req);
    const dn = await db.deliveryNote.findUnique({
      where: { id: String(b.dnId ?? "") },
      include: { lines: { include: { item: true } } },
    });
    if (!dn) throw new ApiError("Delivery note not found", 404);
    if (!["DRAFT", "PICKED"].includes(dn.status)) {
      throw new ApiError(`Only DRAFT or PICKED delivery notes can be dispatched — ${dn.dnNumber} is ${dn.status}`, 409);
    }
    if (dn.lines.length === 0) throw new ApiError("Delivery note has no lines — nothing to dispatch", 422);

    const so = await db.salesOrder.findUnique({ where: { id: dn.soId }, include: { lines: true } });
    if (!so) throw new ApiError("Sales order for this delivery note not found", 404);
    const customer = await db.customer.findUnique({ where: { id: so.customerId } });

    const lotNumbers = dn.lines.map((l) => l.lotNumber);
    const lots = await db.stockLot.findMany({ where: { lotNumber: { in: lotNumbers } } });
    const notHeld = lots.filter((l) => l.status !== "HELD");
    if (notHeld.length > 0) {
      throw new ApiError(`Serial ${notHeld[0].lotNumber} is ${notHeld[0].status} — all packed serials must be HELD before dispatch`, 409);
    }

    const now = new Date();
    const vehicleNo = String(b.vehicleNo ?? dn.vehicleNo ?? "").trim();
    const ewayBillNo = String(b.ewayBillNo ?? "").trim(); // SYNTHETIC only — never a real e-way bill

    const soStatus = await db.$transaction(async (tx) => {
      // 1. serials out of the plant
      for (const lot of lots) {
        await tx.stockLot.update({ where: { id: lot.id }, data: { status: "SHIPPED" } });
        await tx.stockMovement.create({
          data: { lotId: lot.id, type: "SHIP", qty: 1, fromWh: "WH-FG", toWh: "CUSTOMER", refType: "DN", refId: dn.dnNumber, userId: user.id, note: vehicleNo ? `Vehicle ${vehicleNo}` : "" },
        });
      }
      // 2. containers carrying shipped serials leave too
      const members = await tx.containerMember.findMany({ where: { lotId: { in: lots.map((l) => l.id) } }, select: { containerId: true } });
      const containerIds = [...new Set(members.map((m) => m.containerId))];
      if (containerIds.length > 0) {
        await tx.container.updateMany({ where: { id: { in: containerIds }, status: { in: ["OPEN", "SEALED"] } }, data: { status: "DISPATCHED", dnNumber: dn.dnNumber } });
      }
      // 3. delivery note → DISPATCHED
      await tx.deliveryNote.update({
        where: { id: dn.id },
        data: { status: "DISPATCHED", dispatchedAt: now, ...(vehicleNo ? { vehicleNo } : {}), ...(ewayBillNo ? { ewayBillNo } : {}) },
      });
      // 4. roll up delivered quantities on SO lines
      const byItem = new Map<string, number>();
      for (const line of dn.lines) byItem.set(line.itemId, (byItem.get(line.itemId) ?? 0) + line.qty);
      for (const [itemId, qty] of byItem) {
        const soLine = so.lines.find((sl) => sl.itemId === itemId && sl.deliveredQty < sl.qty) ?? so.lines.find((sl) => sl.itemId === itemId);
        if (soLine) await tx.soLine.update({ where: { id: soLine.id }, data: { deliveredQty: { increment: qty } } });
      }
      // 5. SO status: DISPATCHED when fully delivered, PARTIAL otherwise
      const updatedLines = await tx.soLine.findMany({ where: { soId: so.id } });
      const fully = updatedLines.every((l) => l.deliveredQty + 1e-9 >= l.qty);
      const next = fully ? "DISPATCHED" : "PARTIAL";
      if (["CONFIRMED", "IN_PRODUCTION", "READY", "PARTIAL"].includes(so.status)) {
        await tx.salesOrder.update({ where: { id: so.id }, data: { status: next } });
        return next;
      }
      return so.status;
    });

    await logAudit(
      user,
      "DISPATCH",
      "DeliveryNote",
      dn.dnNumber,
      `${dn.lines.length} serial(s) shipped against ${so.soNumber} (${customer?.code ?? so.customerId})${vehicleNo ? ` — vehicle ${vehicleNo}` : ""}${ewayBillNo ? ` — eway ${ewayBillNo} (SYNTHETIC)` : ""}; SO → ${soStatus}`
    );
    await db.notification.createMany({
      data: [
        {
          role: "SALES_MGR",
          kind: "INFO",
          severity: "INFO",
          title: `DN ${dn.dnNumber} dispatched`,
          message: `${dn.lines.length} serial(s) shipped against ${so.soNumber} for ${customer?.name ?? "customer"}. GST invoice can now be raised.`,
          refType: "DN",
          refId: dn.dnNumber,
        },
        {
          role: "FINANCE_MGR",
          kind: "INFO",
          severity: "INFO",
          title: `Delivery ready for billing — ${so.soNumber}`,
          message: `DN ${dn.dnNumber} dispatched (${dn.lines.length} serials, SO ${so.soNumber}). Raise the GST invoice from the GST Invoices tab.`,
          refType: "DN",
          refId: dn.dnNumber,
        },
      ],
    });

    const deliveryNote = await db.deliveryNote.findUnique({ where: { id: dn.id }, include: { lines: { include: { item: true } } } });
    return ok({ deliveryNote, soStatus });
  });
}
