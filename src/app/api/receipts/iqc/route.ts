import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, nextNumber, ok, requirePerm } from "@/lib/erp/server";

/**
 * POST /api/receipts/iqc — submit an incoming-quality (IQC) inspection result.
 * RBAC: quality.inspect. The inspection becomes immutable once submitted.
 * PASS → GrnLine disposition ACCEPTED + lot(s) moved WH-IQC → WH-ACC (IQC_ACCEPT);
 * FAIL → REJECTED + WH-IQC → WH-REJ (IQC_REJECT). Movements are written in the same
 * transaction as the inspection update (no orphan stock). Audited.
 * Body: { inspectionId, results: [{ parameter, value, pass }], overallResult: "PASS"|"FAIL", equipmentCode? }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "quality.inspect");
    const b = await body<{
      inspectionId?: string;
      results?: { parameter?: string; value?: unknown; pass?: boolean }[];
      overallResult?: string;
      equipmentCode?: string;
    }>(req);

    const inspectionId = String(b.inspectionId ?? "");
    if (!inspectionId) throw new ApiError("inspectionId is required", 400);
    const rawResults = Array.isArray(b.results) ? b.results : [];
    if (rawResults.length === 0) throw new ApiError("At least one inspection result is required", 400);
    const results = rawResults.map((r) => ({
      parameter: String(r.parameter ?? "").trim(),
      value: r.value ?? "",
      pass: Boolean(r.pass),
    }));
    if (results.some((r) => !r.parameter)) throw new ApiError("Every result row needs a parameter name", 400);

    const overall = String(b.overallResult ?? "").toUpperCase();
    if (overall !== "PASS" && overall !== "FAIL") throw new ApiError("overallResult must be PASS or FAIL", 400);
    const equipmentCode = String(b.equipmentCode ?? "").trim().slice(0, 60);

    const inspection = await db.inspection.findUnique({
      where: { id: inspectionId },
      include: { grnLine: true },
    });
    if (!inspection) throw new ApiError("Inspection not found", 404);
    if (inspection.kind !== "IQC") throw new ApiError(`Inspection ${inspection.inspNumber} is ${inspection.kind} — this endpoint handles IQC only`, 422);
    if (inspection.immutable || inspection.status !== "PENDING") {
      throw new ApiError(`Inspection ${inspection.inspNumber} is already submitted (${inspection.status}) — records are immutable`, 422);
    }
    const line = inspection.grnLine;
    if (!line) throw new ApiError("Inspection is not linked to a GRN line", 422);
    const grn = await db.goodsReceipt.findUnique({ where: { id: line.grnId } });
    if (!grn) throw new ApiError("Originating GRN not found for this inspection", 422);
    const item = await db.item.findUnique({ where: { id: line.itemId }, select: { partNumber: true, name: true } });

    const passed = overall === "PASS";
    const disposition = passed ? "ACCEPTED" : "REJECTED";
    const inspStatus = passed ? "PASSED" : "FAILED";
    const toWh = passed ? "WH-ACC" : "WH-REJ";
    const movementType = passed ? "IQC_ACCEPT" : "IQC_REJECT";
    const lotStatus = passed ? "IN_STOCK" : "REJECTED";

    const moved = await db.$transaction(async (tx) => {
      await tx.inspection.update({
        where: { id: inspection.id },
        data: {
          status: inspStatus, overallResult: overall, resultsJson: JSON.stringify(results),
          equipmentCode, submittedAt: new Date(), immutable: true, inspectorId: user.id,
        },
      });
      await tx.grnLine.update({ where: { id: line.id }, data: { disposition } });

      const lots = await tx.stockLot.findMany({ where: { grnLineId: line.id, warehouseCode: "WH-IQC", status: "IN_STOCK" } });
      for (const lot of lots) {
        await tx.stockLot.update({ where: { id: lot.id }, data: { warehouseCode: toWh, status: lotStatus } });
        await tx.stockMovement.create({
          data: { lotId: lot.id, type: movementType, qty: lot.qty, fromWh: "WH-IQC", toWh, refType: "INSP", refId: inspection.inspNumber, userId: user.username },
        });
      }

      const pendingLeft = await tx.grnLine.count({ where: { grnId: line.grnId, disposition: "PENDING_IQC" } });
      if (pendingLeft === 0) {
        await tx.goodsReceipt.update({ where: { id: line.grnId }, data: { status: "IQC_DONE" } });
      }
      return { lotNumbers: lots.map((l) => l.lotNumber) };
    });

    await logAudit(
      user, "SUBMIT", "INSPECTION", inspection.inspNumber,
      `IQC ${overall} · ${item?.partNumber ?? line.itemId} · disposition ${disposition} · lots [${moved.lotNumbers.join(", ") || "n/a"}] → ${toWh} · by ${user.username}${equipmentCode ? ` · ${equipmentCode}` : ""}`,
    );

    // ---- Auto-raise a SCAR when IQC FAILs (supplier corrective loop, spec §Supplier quality) ----
    let scarNumber: string | null = null;
    if (!passed) {
      const supplier = await db.supplier.findUnique({ where: { id: grn.supplierId } });
      const failedParams = results.filter((r) => !r.pass).map((r) => r.parameter);
      const severity = supplier?.category === "CRITICAL" ? "CRITICAL" : "MAJOR";
      scarNumber = await nextNumber("SCAR", "scar");
      const responseDue = new Date(Date.now() + 14 * 86400_000);
      await db.scar.create({
        data: {
          scarNumber,
          supplierId: grn.supplierId,
          grnNumber: grn.grnNumber,
          inspectionRef: inspection.inspNumber,
          lotNumbersJson: JSON.stringify(moved.lotNumbers),
          partSummary: `${item?.partNumber ?? line.itemId} × ${line.qty}`,
          defectDescription: `IQC FAILED on ${inspection.inspNumber} — failed parameter(s): ${failedParams.join(", ") || "see inspection record"}. Lot(s) rejected and quarantined in WH-REJ.`,
          severity,
          containment: `Rejected lot(s) [${moved.lotNumbers.join(", ")}] held in WH-REJ — no issue to production (auto-raised on IQC FAIL).`,
          responseDue,
          status: "OPEN",
          raisedBy: user.username,
        },
      });
      await logAudit(user, "CREATE", "SCAR", scarNumber, `auto-raised on IQC FAIL ${inspection.inspNumber} · supplier ${supplier?.code ?? grn.supplierId} · severity ${severity} · response due ${responseDue.toISOString().slice(0, 10)}`);
      await db.notification.create({
        data: {
          role: "PURCHASE_MGR", kind: "QUALITY", severity: "WARNING",
          title: `SCAR auto-raised — ${supplier?.code ?? "supplier"}`,
          message: `${scarNumber} (${severity}) opened against ${grn.grnNumber} after IQC FAIL ${inspection.inspNumber} — supplier response due ${responseDue.toISOString().slice(0, 10)}.`,
          refType: "SCAR", refId: scarNumber,
        },
      });
    }

    return ok({
      inspNumber: inspection.inspNumber, status: inspStatus, overallResult: overall,
      disposition, lotsMoved: moved.lotNumbers.length,
      scarNumber,
    });
  });
}
