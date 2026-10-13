import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, nextNumber, ok, parseJsonField, requirePerm } from "@/lib/erp/server";

/** Generic class tokens stripped when deriving a serial prefix from a part number. */
const GENERIC_PREFIXES = ["RM", "SBA", "TAU", "PK"];

function serialPrefix(partNumber: string): string {
  const parts = partNumber.split("-").filter(Boolean);
  if (parts.length <= 1) return (parts[0] ?? "ITM").toUpperCase();
  const first = parts[0].toUpperCase();
  return (GENERIC_PREFIXES.includes(first) ? parts[1] : first).toUpperCase();
}

/**
 * GET /api/receipts — GRN register (lines + dispositions + linked IQC inspections)
 * plus the IQC inspection templates so the client can render result sheets.
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    const [receipts, templates] = await Promise.all([
      db.goodsReceipt.findMany({
        orderBy: { receivedAt: "desc" },
        include: {
          po: { select: { poNumber: true } },
          lines: {
            orderBy: { id: "asc" },
            include: {
              inspections: {
                orderBy: { inspNumber: "asc" },
                select: { id: true, inspNumber: true, status: true, templateCode: true, overallResult: true, equipmentCode: true, resultsJson: true, submittedAt: true, immutable: true },
              },
            },
          },
        },
      }),
      db.inspectionTemplate.findMany({ where: { kind: "IQC" } }),
    ]);
    // GrnLine/GoodsReceipt have no Prisma item/supplier relations — join masters manually.
    const itemIds = [...new Set(receipts.flatMap((r) => r.lines.map((l) => l.itemId)))];
    const itemRows = await db.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, partNumber: true, name: true, uom: true, trackingType: true, criticality: true },
    });
    const itemMap = new Map(itemRows.map((i) => [i.id, i]));
    const supplierIds = [...new Set(receipts.map((r) => r.supplierId))];
    const supplierRows = await db.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, code: true, name: true },
    });
    const supplierMap = new Map(supplierRows.map((s) => [s.id, s]));
    const shaped = receipts.map((r) => ({
      ...r,
      supplier: supplierMap.get(r.supplierId) ?? { id: r.supplierId, code: "—", name: "Unknown supplier" },
      lines: r.lines.map((l) => ({
        ...l,
        item: itemMap.get(l.itemId) ?? { id: l.itemId, partNumber: "—", name: "Unknown item", uom: "", trackingType: "NONE", criticality: "STANDARD" },
      })),
    }));
    return ok({
      receipts: shaped,
      templates: templates.map((t) => ({
        id: t.id, code: t.code, name: t.name, kind: t.kind,
        params: parseJsonField<{ name: string; unit?: string; lower?: number; upper?: number }[]>(t.paramsJson, []),
      })),
    });
  });
}

/**
 * POST /api/receipts — goods receipt (GRN) against an APPROVED/PARTIAL PO.
 * RBAC: procurement.create. One transaction keeps PO lines ↔ lots ↔ movements consistent
 * (no orphan lots): GrnLine (PENDING_IQC) → PoLine.receivedQty++ → PO PARTIAL/RECEIVED →
 * StockLot in WH-IQC (BATCH: `B-<supplierBatch>`; SERIAL: `SN-<prefix>-<seq>` per unit) →
 * StockMovement RECEIPT → auto PENDING IQC Inspection (IQC-ELEMENT for ceramic/element
 * items, else IQC-GENERIC) linked to the GRN line. Audited.
 * Body: { poId, remarks?, lines: [{ poLineId, qty, supplierBatch, manufacturerRef? }] }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "procurement.create");
    const b = await body<{
      poId?: string; remarks?: string;
      lines?: { poLineId?: string; itemId?: string; qty?: number; supplierBatch?: string; manufacturerRef?: string }[];
    }>(req);

    const poId = String(b.poId ?? "");
    if (!poId) throw new ApiError("poId is required — a GRN must reference an approved purchase order", 400);
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (lines.length === 0) throw new ApiError("At least one receipt line is required", 400);

    const po = await db.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lines: { include: { item: true } } },
    });
    if (!po) throw new ApiError("Purchase order not found", 404);
    if (!["APPROVED", "PARTIAL"].includes(po.status)) {
      throw new ApiError(`PO ${po.poNumber} is ${po.status} — only APPROVED or PARTIAL POs can be received`, 422);
    }

    const itemsById = new Map(po.lines.map((l) => [l.itemId, l.item]));
    const poLineById = new Map(po.lines.map((l) => [l.id, l]));
    const seenPoLines = new Set<string>();

    type Draft = {
      poLineId: string | null; itemId: string; qty: number;
      supplierBatch: string; manufacturerRef: string;
      trackingType: string; partNumber: string; uom: string; itemName: string;
    };
    const drafts: Draft[] = [];

    for (const l of lines) {
      const qty = Number(l.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw new ApiError("Each receipt line needs a positive quantity", 400);

      let poLine = null as (typeof po.lines)[number] | null;
      if (l.poLineId) {
        poLine = poLineById.get(String(l.poLineId)) ?? null;
        if (!poLine) throw new ApiError("A receipt line references a PO line that does not belong to the selected PO", 422);
        if (seenPoLines.has(poLine.id)) throw new ApiError("Duplicate PO line in the receipt — merge the quantities", 422);
        seenPoLines.add(poLine.id);
      }
      const itemId = String(l.itemId ?? poLine?.itemId ?? "");
      if (!itemId) throw new ApiError("Every receipt line needs an item", 400);

      let item = itemsById.get(itemId) ?? null;
      if (!item) {
        item = await db.item.findUnique({ where: { id: itemId } });
        if (!item) throw new ApiError("Item not found", 404);
        itemsById.set(itemId, item);
      }
      if (poLine && poLine.itemId !== itemId) throw new ApiError("Receipt line item does not match the PO line item", 422);
      if (poLine && poLine.receivedQty + qty > poLine.qty + 1e-9) {
        throw new ApiError(`Receipt qty ${qty} exceeds the open quantity (${poLine.qty - poLine.receivedQty} ${item.uom}) for ${item.partNumber}`, 422);
      }
      if (item.trackingType === "SERIAL" && !Number.isInteger(qty)) {
        throw new ApiError(`Serial-tracked item ${item.partNumber} must be received in whole units`, 422);
      }
      const supplierBatch = String(l.supplierBatch ?? "").trim();
      if (item.trackingType === "BATCH" && !supplierBatch) {
        throw new ApiError(`Supplier batch number is required for batch-tracked item ${item.partNumber}`, 422);
      }
      drafts.push({
        poLineId: poLine?.id ?? null, itemId, qty, supplierBatch,
        manufacturerRef: String(l.manufacturerRef ?? "").trim().slice(0, 80),
        trackingType: item.trackingType, partNumber: item.partNumber, uom: item.uom, itemName: item.name,
      });
    }

    const grnNumber = await nextNumber("GRN", "goodsReceipt");
    // Pre-assign inspection numbers (nextNumber counts committed rows only — cannot run inside the tx loop).
    const inspBase = await nextNumber("INSP", "inspection");
    const inspMatch = inspBase.match(/^(.*-)(\d+)$/);
    let inspSeq = inspMatch ? parseInt(inspMatch[2], 10) : 1;
    const inspPrefix = inspMatch ? inspMatch[1] : "INSP-2025-";
    const inspNumbers = drafts.map(() => `${inspPrefix}${String(inspSeq++).padStart(4, "0")}`);

    const result = await db.$transaction(async (tx) => {
      const grn = await tx.goodsReceipt.create({
        data: {
          grnNumber, poId: po.id, supplierId: po.supplierId,
          receivedBy: user.username, status: "IQC_PENDING",
          remarks: String(b.remarks ?? "").trim().slice(0, 500),
        },
      });

      let lotCount = 0;
      const notes: string[] = [];

      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        const gl = await tx.grnLine.create({
          data: {
            grnId: grn.id, poLineId: d.poLineId, itemId: d.itemId, qty: d.qty,
            supplierBatch: d.supplierBatch, manufacturerRef: d.manufacturerRef, disposition: "PENDING_IQC",
          },
        });
        if (d.poLineId) {
          await tx.poLine.update({ where: { id: d.poLineId }, data: { receivedQty: { increment: d.qty } } });
        }

        // ---- Stock lots + RECEIPT movements (three-way consistency inside the same tx) ----
        let firstLotNumber = "";
        if (d.trackingType === "BATCH") {
          const base = `B-${(d.supplierBatch.replace(/[^A-Za-z0-9]/g, "").toUpperCase()) || grnNumber.replace(/-/g, "")}`;
          const taken = new Set(
            (await tx.stockLot.findMany({ where: { lotNumber: { startsWith: base } }, select: { lotNumber: true } })).map((x) => x.lotNumber),
          );
          let lotNumber = base;
          if (taken.has(base)) {
            let n = 2;
            while (taken.has(`${base}-${n}`)) n++;
            lotNumber = `${base}-${n}`;
          }
          const lot = await tx.stockLot.create({
            data: {
              lotNumber, itemId: d.itemId, trackingType: "BATCH", status: "IN_STOCK",
              warehouseCode: "WH-IQC", qty: d.qty, supplierBatch: d.supplierBatch, grnLineId: gl.id,
            },
          });
          await tx.stockMovement.create({
            data: { lotId: lot.id, type: "RECEIPT", qty: d.qty, toWh: "WH-IQC", refType: "GRN", refId: grnNumber, userId: user.username },
          });
          firstLotNumber = lotNumber;
          lotCount++;
          notes.push(`${d.partNumber} → lot ${lotNumber} (${d.qty} ${d.uom}) WH-IQC`);
        } else if (d.trackingType === "SERIAL") {
          const prefix = serialPrefix(d.partNumber);
          const existing = await tx.stockLot.findMany({ where: { lotNumber: { startsWith: `SN-${prefix}-` } }, select: { lotNumber: true } });
          let seq = 1;
          for (const e of existing) {
            const n = parseInt(e.lotNumber.split("-").pop() ?? "0", 10);
            if (Number.isFinite(n) && n >= seq) seq = n + 1;
          }
          for (let u = 0; u < d.qty; u++) {
            const lotNumber = `SN-${prefix}-${String(seq).padStart(4, "0")}`;
            seq++;
            const lot = await tx.stockLot.create({
              data: {
                lotNumber, itemId: d.itemId, trackingType: "SERIAL", status: "IN_STOCK",
                warehouseCode: "WH-IQC", qty: 1, supplierBatch: d.supplierBatch, grnLineId: gl.id,
              },
            });
            await tx.stockMovement.create({
              data: { lotId: lot.id, type: "RECEIPT", qty: 1, toWh: "WH-IQC", refType: "GRN", refId: grnNumber, userId: user.username },
            });
            if (!firstLotNumber) firstLotNumber = lotNumber;
            lotCount++;
          }
          notes.push(`${d.partNumber} → ${d.qty} serial(s) SN-${prefix}-* WH-IQC`);
        }

        // ---- Auto IQC inspection (PENDING) linked to the GRN line ----
        const templateCode = /ceramic|element/i.test(d.itemName) ? "IQC-ELEMENT" : "IQC-GENERIC";
        await tx.inspection.create({
          data: {
            inspNumber: inspNumbers[i], kind: "IQC", templateCode,
            refType: "GRN_LINE", refId: gl.id, lotNumber: firstLotNumber,
            status: "PENDING", grnLineId: gl.id,
          },
        });
      }

      // ---- PO status roll-up: PARTIAL / RECEIVED ----
      let poStatus = po.status;
      const freshLines = await tx.poLine.findMany({ where: { poId: po.id } });
      const anyReceived = freshLines.some((l) => l.receivedQty > 0);
      const fullyReceived = freshLines.length > 0 && freshLines.every((l) => l.receivedQty >= l.qty - 1e-9);
      if (fullyReceived) poStatus = "RECEIVED";
      else if (anyReceived) poStatus = "PARTIAL";
      if (poStatus !== po.status) {
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: poStatus } });
      }

      return { grnId: grn.id, lotCount, poStatus, notes };
    });

    const poSupplier = await db.supplier.findUnique({ where: { id: po.supplierId }, select: { code: true } });
    await logAudit(
      user, "RECEIPT", "GOODS_RECEIPT", grnNumber,
      `PO ${po.poNumber} · ${poSupplier?.code ?? "—"} · ${drafts.length} line(s) · ${result.lotCount} lot(s) in WH-IQC · PO→${result.poStatus} · IQC PENDING`,
    );
    return ok({ grnNumber, poStatus: result.poStatus, lotCount: result.lotCount }, 201);
  });
}
