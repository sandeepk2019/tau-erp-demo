// ============================================================================
// Tau ERP — /api/print/doc — assembles CONTROLLED PRINT DOCUMENTS (spec §Printing).
// Kinds: coc (Certificate of Conformance) | calibration (Calibration Certificate)
//        | 8d (8D Problem-Solving Report, ?ncr=NCR-…)
//        | scar (Supplier SCAR response sheet, ?scar=SCAR-…) — round-8
// Every controlled print identifies: company, doc number, revision/status,
// print timestamp, printed-by user — rendered by the client PrintCenter.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handle, getSessionUser, ok, parseJsonField } from "@/lib/erp/server";
import { hasPerm, COMPANY } from "@/lib/erp/constants";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session", 401);
    const kind = req.nextUrl.searchParams.get("kind") ?? "coc";

    // -------- 8D Problem-Solving Report (composed from NCR/CAPA/MRB evidence) --------
    if (kind === "8d") {
      const ncrNumber = (req.nextUrl.searchParams.get("ncr") ?? "").trim();
      if (!ncrNumber) throw new ApiError("ncr query parameter is required for 8D report", 400);
      if (!hasPerm(user.role, "quality.view")) throw new ApiError("Permission denied: quality.view required for 8D report", 403);
      const ncr = await db.ncr.findFirst({
        where: { ncrNumber },
        include: { mrb: { orderBy: { createdAt: "desc" } }, capas: { orderBy: { createdAt: "asc" } } },
      });
      if (!ncr) throw new ApiError(`Unknown NCR ${ncrNumber}`, 404);

      const reworkOrders = await db.reworkOrder.findMany({ where: { ncrId: ncr.id }, orderBy: { createdAt: "asc" } });
      const linkedInspections = ncr.inspectionId
        ? await db.inspection.findMany({ where: { OR: [{ id: ncr.inspectionId }, { lotNumber: ncr.lotNumber }] }, orderBy: { inspNumber: "asc" } })
        : ncr.lotNumber
          ? await db.inspection.findMany({ where: { lotNumber: ncr.lotNumber }, orderBy: { inspNumber: "asc" } })
          : [];

      const corrective = ncr.capas.filter((c) => c.kind === "CORRECTIVE");
      const preventive = ncr.capas.filter((c) => c.kind === "PREVENTIVE");
      // containmentJson has two historical shapes: seeded string[] entries and
      // API-computed {type, ref, note}[] entries — normalize to the object form.
      const containment = parseJsonField<unknown[]>(ncr.containmentJson, []).map((e) => {
        if (typeof e === "string") return { type: "NOTE", ref: "", note: e };
        const o = (e ?? {}) as { type?: string; ref?: string; note?: string };
        return { type: o.type ?? "NOTE", ref: o.ref ?? "", note: o.note ?? "" };
      });
      const teamMembers = [...new Set([
        ncr.raisedBy,
        ...ncr.mrb.flatMap((m) => [m.decidedBy, m.approvedBy].filter(Boolean)),
        ...ncr.capas.map((c) => c.owner).filter(Boolean),
      ])];

      return ok({
        doc: {
          kind: "8d",
          printedBy: user.name,
          printedByRole: user.role,
          printedAt: new Date().toISOString(),
          company: COMPANY,
          synthetic: true,
        },
        ncr: {
          ncrNumber: ncr.ncrNumber,
          severity: ncr.severity,
          status: ncr.status,
          sourceRef: ncr.sourceRef,
          lotNumber: ncr.lotNumber,
          woNumber: ncr.woNumber,
          description: ncr.description,
          raisedBy: ncr.raisedBy,
          createdAt: ncr.createdAt.toISOString(),
          closedAt: ncr.closedAt?.toISOString() ?? null,
        },
        d0: {
          symptom: ncr.sourceRef || "Detected at in-process/IQC inspection",
          detectedBy: linkedInspections[0]?.inspNumber ?? "manual observation",
          quantityAffected: containment.filter((c) => c.type === "LOT").length,
        },
        d1: { team: teamMembers, champion: ncr.raisedBy || "—" },
        d2: { description: ncr.description, lot: ncr.lotNumber, wo: ncr.woNumber, is: ncr.description, isNot: "— (record in CAPA problem statement)" },
        d3: {
          containment,
          verified: ncr.status !== "OPEN",
          note: containment.length ? "Containment scope computed from containers, DNs and genealogy links at the time of recording." : "Not recorded — OPEN NCR.",
        },
        d4: { rootCauses: corrective.map((c) => ({ capa: c.capaNumber, cause: c.rootCause || "under investigation", status: c.status })), mrbJustification: ncr.mrb[0]?.justification ?? "" },
        d5: {
          actions: ncr.capas.flatMap((c) =>
            parseJsonField<{ action: string; owner: string; dueDate?: string; done?: boolean }[]>(c.actionsJson, []).map((a) => ({
              capa: c.capaNumber, kind: c.kind, action: a.action, owner: a.owner || c.owner, dueDate: a.dueDate ?? null, done: !!a.done,
            }))
          ),
          reworkOrders: reworkOrders.map((r) => ({ rwNumber: r.rwNumber, status: r.status, instructions: r.instructions, outcome: r.outcome })),
        },
        d6: {
          effectiveness: corrective.map((c) => ({ capa: c.capaNumber, effectiveness: c.effectiveness, status: c.status })),
          reinspections: linkedInspections.filter((i) => i.attempt > 1).map((i) => ({ inspNumber: i.inspNumber, attempt: i.attempt, status: i.status })),
        },
        d7: {
          preventive: preventive.map((c) => ({ capa: c.capaNumber, problem: c.problem, rootCause: c.rootCause, status: c.status, effectiveness: c.effectiveness })),
          standardsUpdated: corrective.some((c) => c.status === "CLOSED"),
        },
        d8: { status: ncr.status, closedAt: ncr.closedAt?.toISOString() ?? null, mrb: ncr.mrb.map((m) => ({ disposition: m.disposition, decidedBy: m.decidedBy, approvedBy: m.approvedBy })) },
        inspectionEvidence: linkedInspections.slice(0, 8).map((i) => ({
          inspNumber: i.inspNumber, kind: i.kind, attempt: i.attempt, status: i.status, equipmentCode: i.equipmentCode,
          submittedAt: i.submittedAt?.toISOString() ?? null,
        })),
      });
    }

    // -------- Supplier SCAR response sheet (buyer-issued 8D-style form) --------
    if (kind === "scar") {
      const scarNumber = (req.nextUrl.searchParams.get("scar") ?? "").trim();
      if (!scarNumber) throw new ApiError("scar query parameter is required for the SCAR response sheet", 400);
      if (!hasPerm(user.role, "procurement.view")) throw new ApiError("Permission denied: procurement.view required for SCAR response sheet", 403);
      const scar = await db.scar.findFirst({ where: { scarNumber } });
      if (!scar) throw new ApiError(`Unknown SCAR ${scarNumber}`, 404);
      const supplier = await db.supplier.findUnique({
        where: { id: scar.supplierId },
        select: { code: true, name: true, city: true, category: true, approved: true, rating: true, gstin: true },
      });
      // affected lots + the originating GRN's REJECTED line evidence (disposition lives on the line)
      const lotNumbers = parseJsonField<string[]>(scar.lotNumbersJson, []);
      let grnEvidence: { grnNumber: string; partNumber: string; name: string; qty: number; uom: string; supplierBatch: string }[] = [];
      if (scar.grnNumber) {
        const grn = await db.goodsReceipt.findFirst({ where: { grnNumber: scar.grnNumber }, include: { lines: true } });
        const rejected = (grn?.lines ?? []).filter((l) => l.disposition === "REJECTED");
        if (rejected.length) {
          const items = await db.item.findMany({ where: { id: { in: rejected.map((l) => l.itemId) } }, select: { id: true, partNumber: true, name: true, uom: true } });
          const itemById = new Map(items.map((it) => [it.id, it]));
          grnEvidence = rejected.map((l) => {
            const it = itemById.get(l.itemId);
            return { grnNumber: grn?.grnNumber ?? scar.grnNumber, partNumber: it?.partNumber ?? l.itemId, name: it?.name ?? "", qty: l.qty, uom: it?.uom ?? "", supplierBatch: l.supplierBatch };
          });
        }
      }
      return ok({
        doc: { kind: "scar", printedBy: user.name, printedByRole: user.role, printedAt: new Date().toISOString(), company: COMPANY, synthetic: true },
        scar: {
          scarNumber: scar.scarNumber, severity: scar.severity, status: scar.status,
          grnNumber: scar.grnNumber, inspectionRef: scar.inspectionRef,
          partSummary: scar.partSummary, defectDescription: scar.defectDescription,
          containment: scar.containment, responseDue: scar.responseDue?.toISOString() ?? null,
          respondedAt: scar.respondedAt?.toISOString() ?? null,
          raisedBy: scar.raisedBy, raisedAt: scar.createdAt.toISOString(),
        },
        supplier: supplier
          ? { code: supplier.code, name: supplier.name, city: supplier.city, category: supplier.category, gstin: supplier.gstin }
          : null,
        lotNumbers,
        grnEvidence,
      });
    }

    const lot = (req.nextUrl.searchParams.get("lot") ?? "").trim();
    if (!lot) throw new ApiError("lot query parameter is required", 400);

    const stockLot = await db.stockLot.findUnique({
      where: { lotNumber: lot },
      include: { item: true },
    });
    if (!stockLot) throw new ApiError(`Unknown lot ${lot}`, 404);

    if (kind === "calibration" && !hasPerm(user.role, "quality.view")) {
      throw new ApiError("Permission denied: quality.view required for calibration certificate", 403);
    }
    if (kind === "coc" && !hasPerm(user.role, "sales.view") && !hasPerm(user.role, "quality.view")) {
      throw new ApiError("Permission denied: sales.view or quality.view required for CoC", 403);
    }

    // release record
    const release = await db.productRelease.findFirst({
      where: { lotNumber: lot },
      orderBy: { createdAt: "desc" },
    });

    // inspections for the lot (submitted, immutable evidence)
    const inspections = await db.inspection.findMany({
      where: { lotNumber: lot, status: { in: ["PASSED", "FAILED"] } },
      orderBy: { inspNumber: "asc" },
    });

    // genealogy summary
    const childLinks = await db.genealogyLink.count({ where: { parentLotId: stockLot.id } });
    const parentLinks = await db.genealogyLink.count({ where: { childLotId: stockLot.id } });

    // shipment chain (if shipped): DeliveryLine → DN → SO → customer name
    let shipment: { dnNumber: string; soNumber: string; customer: string; dispatchedAt: string | null } | null = null;
    const dnLine = await db.deliveryLine.findFirst({
      where: { lotNumber: lot },
      include: { dn: true },
    });
    if (dnLine) {
      const so = await db.salesOrder.findUnique({ where: { id: dnLine.dn.soId } });
      let customerName = "—";
      if (so) {
        const cust = await db.customer.findUnique({ where: { id: so.customerId } });
        customerName = cust?.name ?? so.customerId;
      }
      shipment = {
        dnNumber: dnLine.dn.dnNumber,
        soNumber: so?.soNumber ?? "—",
        customer: customerName,
        dispatchedAt: dnLine.dn.dispatchedAt?.toISOString() ?? null,
      };
    }

    // calibration certificate detail: only CALIBRATION-kind inspections with equipment
    const calib = inspections.filter((i) => i.kind === "CALIBRATION");
    const equipmentCodes = [...new Set(inspections.map((i) => i.equipmentCode).filter(Boolean))];
    const equipment = equipmentCodes.length
      ? await db.equipment.findMany({ where: { code: { in: equipmentCodes } } })
      : [];

    return ok({
      doc: {
        kind,
        printedBy: user.name,
        printedByRole: user.role,
        printedAt: new Date().toISOString(),
        company: COMPANY,
        synthetic: true,
      },
      lot: {
        lotNumber: stockLot.lotNumber,
        itemPartNumber: stockLot.item.partNumber,
        itemName: stockLot.item.name,
        familyCode: stockLot.item.familyCode,
        trackingType: stockLot.trackingType,
        status: stockLot.status,
        woNumber: stockLot.woNumber,
        hsnCode: stockLot.item.hsnCode,
        revision: stockLot.item.revision,
      },
      release: release
        ? {
            releaseNumber: release.releaseNumber,
            status: release.status,
            releasedBy: release.releasedBy,
            approvedBy: release.approvedBy,
            releasedAt: release.releasedAt?.toISOString() ?? null,
            checks: parseJsonField<Record<string, boolean>>(release.checksJson, {}),
          }
        : null,
      inspections: inspections.map((i) => ({
        inspNumber: i.inspNumber,
        kind: i.kind,
        templateCode: i.templateCode,
        status: i.status,
        attempt: i.attempt,
        equipmentCode: i.equipmentCode,
        submittedAt: i.submittedAt?.toISOString() ?? null,
        results: parseJsonField<{ parameter: string; unit: string; value: number | string; lower?: number; upper?: number; pass: boolean }[]>(i.resultsJson, []),
      })),
      calibration: {
        records: calib.map((c) => ({
          inspNumber: c.inspNumber,
          status: c.status,
          equipmentCode: c.equipmentCode,
          submittedAt: c.submittedAt?.toISOString() ?? null,
          results: parseJsonField<{ parameter: string; unit: string; value: number | string; lower?: number; upper?: number; pass: boolean }[]>(c.resultsJson, []),
        })),
        equipment: equipment.map((e) => ({ code: e.code, name: e.name, calibrationDue: e.calibrationDue?.toISOString() ?? null, status: e.status })),
      },
      genealogy: { components: childLinks, usedInParents: parentLinks },
      shipment,
    });
  });
}
