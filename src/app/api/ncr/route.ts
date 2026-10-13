import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ApiError, body, fourEyes, getSessionUser, handle, logAudit, nextNumber, ok, requirePerm,
} from "@/lib/erp/server";

// ============================================================================
// Tau ERP — QMS: NCR → containment → MRB decision → four-eyes approval → CAPA link
// Spec §QMS process steps 5-7 + spec rule 12 (four-eyes) + rule 9 (immutable evidence).
// ============================================================================

type ScopeEntry = { type: string; ref: string; note: string };

const DISPOSITIONS = ["USE_AS_IS", "REWORK", "REPAIR", "RETURN_TO_VENDOR", "SCRAP"] as const;
const SEVERITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;

/** Auto-compute affected containment scope (spec QMS step 6).
 *  Finished serial → its containers + DeliveryLine DNs.
 *  Batch → genealogy children (finished serials that consumed it). */
async function computeContainment(ncrNumber: string, lotNumber: string, sourceRef: string): Promise<ScopeEntry[]> {
  const entries: ScopeEntry[] = [];
  const lot = lotNumber ? await db.stockLot.findUnique({ where: { lotNumber } }) : null;
  if (lot) {
    entries.push({ type: "LOT", ref: lot.lotNumber, note: `${lot.status} @ ${lot.warehouseCode} · ${lot.trackingType}-tracked · qty ${lot.qty}` });
  }
  if (lot && lot.trackingType === "SERIAL") {
    const memberships = await db.containerMember.findMany({ where: { lotId: lot.id }, include: { container: true } });
    for (const m of memberships) {
      entries.push({
        type: "CONTAINER", ref: m.container.containerNumber,
        note: `${m.container.status}${m.container.dnNumber ? ` · ${m.container.dnNumber}` : ""}`,
      });
    }
    const dnLines = await db.deliveryLine.findMany({ where: { lotNumber: lot.lotNumber }, include: { dn: true } });
    const seenDn = new Set<string>();
    for (const l of dnLines) {
      if (seenDn.has(l.dn.dnNumber)) continue;
      seenDn.add(l.dn.dnNumber);
      entries.push({
        type: "DELIVERY", ref: l.dn.dnNumber,
        note: `${l.dn.status}${l.dn.dispatchedAt ? ` · dispatched ${new Date(l.dn.dispatchedAt).toISOString().slice(0, 10)}` : ""} — customer-impact check`,
      });
    }
  }
  if (lot && lot.trackingType === "BATCH") {
    const links = await db.genealogyLink.findMany({ where: { childLotId: lot.id }, include: { parentLot: true } });
    for (const l of links) {
      entries.push({
        type: "AFFECTED_SERIAL", ref: l.parentLot.lotNumber,
        note: `finished serial consuming this batch${l.woNumber ? ` · ${l.woNumber}` : ""} (${l.parentLot.status} @ ${l.parentLot.warehouseCode})`,
      });
    }
  }
  if (entries.length === 0) {
    entries.push(lotNumber
      ? { type: "LOT", ref: lotNumber, note: "no container/genealogy links found — lot itself quarantined" }
      : { type: "OBSERVATION", ref: ncrNumber, note: sourceRef || "manual observation — no lot linked" });
  }
  return entries;
}

/** GET /api/ncr — NCRs (+MRB decisions, linked CAPAs), rework orders, lot states. */
export async function GET() {
  return handle(async () => {
    const [ncrs, reworkOrders] = await Promise.all([
      db.ncr.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          mrb: true,
          capas: { select: { id: true, capaNumber: true, kind: true, status: true, owner: true, dueDate: true } },
        },
      }),
      db.reworkOrder.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
    const lotNumbers = [...new Set(ncrs.map((n) => n.lotNumber).filter(Boolean))];
    const lots = await db.stockLot.findMany({
      where: { lotNumber: { in: lotNumbers } },
      select: { lotNumber: true, status: true, warehouseCode: true, trackingType: true },
    });
    return ok({
      ncrs,
      reworkOrders,
      lots: Object.fromEntries(lots.map((l) => [l.lotNumber, { status: l.status, warehouseCode: l.warehouseCode, trackingType: l.trackingType }])),
    });
  });
}

/**
 * POST /api/ncr
 *  action=raise        { sourceInspectionId?, severity, description, lotNumber?, woNumber? }  (quality.ncr)
 *  action=containment  { id }           OPEN → CONTAINMENT, auto scope into containmentJson
 *  action=mrb          { id, disposition, justification, instructions? }  decide (quality.inspect)
 *  action=approve-mrb  { id }           four-eyes approve + stock action      (quality.approve)
 *  action=close        { id }           DISPOSITIONED → CLOSED                (quality.approve)
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = await getSessionUser(req);
    const b = await body<{
      action: string;
      id?: string;
      sourceInspectionId?: string;
      severity?: string;
      description?: string;
      lotNumber?: string;
      woNumber?: string;
      disposition?: string;
      justification?: string;
      instructions?: string;
    }>(req);

    // ------------------------------------------------------------------ RAISE
    if (b.action === "raise") {
      const user = requirePerm(session, "quality.ncr");
      const description = (b.description ?? "").trim();
      if (!description) throw new ApiError("NCR description is required", 400);
      const severity = SEVERITIES.includes((b.severity ?? "") as (typeof SEVERITIES)[number]) ? b.severity! : "MAJOR";

      let inspectionId: string | null = null;
      let lotNumber = (b.lotNumber ?? "").trim();
      let woNumber = (b.woNumber ?? "").trim();
      let sourceRef = "Manual observation (authorized)";

      if (b.sourceInspectionId) {
        const insp = await db.inspection.findUnique({ where: { id: b.sourceInspectionId } });
        if (!insp) throw new ApiError("Source inspection not found", 404);
        inspectionId = insp.id;
        // Copy traceability from the inspection's lot (spec: NCR links source evidence).
        if (insp.lotNumber) lotNumber = insp.lotNumber;
        if (insp.woNumber) woNumber = insp.woNumber;
        sourceRef = `Inspection ${insp.inspNumber} (${insp.kind}, attempt ${insp.attempt})${insp.overallResult ? ` — overall ${insp.overallResult}` : " — PENDING"}${insp.retestReason ? ` · retest: ${insp.retestReason}` : ""}`;
      }
      if (!lotNumber && !woNumber) {
        throw new ApiError("Provide a lot number or work order (or pick a source inspection)", 400);
      }

      const ncr = await db.ncr.create({
        data: {
          ncrNumber: await nextNumber("NCR", "ncr"),
          inspectionId,
          sourceRef,
          lotNumber,
          woNumber,
          severity,
          description,
          containmentJson: "[]",
          status: "OPEN",
          raisedBy: user.username,
        },
      });
      await logAudit(user, "CREATE", "NCR", ncr.ncrNumber, `${severity} · lot ${lotNumber || "—"} · ${description.slice(0, 120)}`);
      await db.notification.create({
        data: {
          role: "QUALITY_MGR", kind: "QUALITY",
          severity: severity === "CRITICAL" ? "CRITICAL" : "WARNING",
          title: "NCR raised",
          message: `${ncr.ncrNumber} (${severity}) raised on lot ${lotNumber || "—"} — containment required.`,
          refType: "NCR", refId: ncr.ncrNumber,
        },
      });
      return ok({ ncr }, 201);
    }

    if (!b.id) throw new ApiError("Missing NCR id", 400);
    const ncr = await db.ncr.findUnique({ where: { id: b.id }, include: { mrb: true } });
    if (!ncr) throw new ApiError("NCR not found", 404);

    // ------------------------------------------------------------ CONTAINMENT
    if (b.action === "containment") {
      const user = requirePerm(session, "quality.ncr");
      if (ncr.status !== "OPEN") throw new ApiError(`Containment applies to OPEN NCRs — ${ncr.ncrNumber} is ${ncr.status}`, 422);
      const scope = await computeContainment(ncr.ncrNumber, ncr.lotNumber, ncr.sourceRef);
      const updated = await db.ncr.update({
        where: { id: ncr.id },
        data: { status: "CONTAINMENT", containmentJson: JSON.stringify(scope) },
      });
      await logAudit(user, "CONTAIN", "NCR", ncr.ncrNumber,
        `scope: ${scope.map((s) => `${s.type}:${s.ref}`).join(", ").slice(0, 300)}`);
      return ok({ ncr: updated });
    }

    // ------------------------------------------------------------ MRB DECISION
    if (b.action === "mrb") {
      // Decider needs quality.inspect (spec: decidedBy = session user with quality.inspect perm).
      const user = requirePerm(session, "quality.inspect");
      if (ncr.status !== "CONTAINMENT" && ncr.status !== "MRB") {
        throw new ApiError(`MRB decision requires containment first — ${ncr.ncrNumber} is ${ncr.status}`, 422);
      }
      if (ncr.mrb.some((d) => !d.approvedBy)) {
        throw new ApiError("An MRB decision is already recorded and awaits four-eyes approval (spec rule 12)", 422);
      }
      const disposition = (b.disposition ?? "") as (typeof DISPOSITIONS)[number];
      if (!DISPOSITIONS.includes(disposition)) {
        throw new ApiError(`Invalid disposition — one of ${DISPOSITIONS.join(", ")}`, 400);
      }
      const justification = (b.justification ?? "").trim();
      if (!justification) throw new ApiError("MRB justification is required for the decision record", 400);
      if ((disposition === "REWORK" || disposition === "REPAIR") && !(b.instructions ?? "").trim()) {
        throw new ApiError("Rework/repair instructions are required for this disposition", 400);
      }
      const decision = await db.mrbDecision.create({
        data: {
          ncrId: ncr.id,
          disposition,
          justification,
          decidedBy: user.username,
          approvedBy: "", // pending four-eyes
        },
      });
      await db.ncr.update({ where: { id: ncr.id }, data: { status: "MRB" } });
      await logAudit(user, "DECIDE", "MRB", ncr.ncrNumber, `${disposition} by ${user.username} — awaiting four-eyes approval`);
      return ok({ decision }, 201);
    }

    // -------------------------------------------------- MRB FOUR-EYES APPROVAL
    if (b.action === "approve-mrb") {
      const user = requirePerm(session, "quality.approve");
      const decision = [...ncr.mrb].sort((a, c) => c.createdAt.getTime() - a.createdAt.getTime()).find((d) => !d.approvedBy);
      if (!decision) throw new ApiError(`No pending MRB decision on ${ncr.ncrNumber}`, 422);
      // Spec rule 12 — approver must differ from the decider.
      fourEyes(decision.decidedBy, user.username, "MRB decision");

      let stockAction = "No lot linked — no stock transaction";
      const lot = ncr.lotNumber ? await db.stockLot.findUnique({ where: { lotNumber: ncr.lotNumber } }) : null;
      if (lot) {
        const fromWh = lot.warehouseCode;
        const move = async (type: string, toWh: string, note: string) => {
          await db.stockMovement.create({
            data: { lotId: lot.id, type, qty: lot.qty, fromWh, toWh, refType: "NCR", refId: ncr.ncrNumber, userId: user.username, note },
          });
        };
        if (decision.disposition === "SCRAP") {
          await db.stockLot.update({ where: { id: lot.id }, data: { status: "SCRAPPED", warehouseCode: "WH-SCRAP" } });
          await move("SCRAP", "WH-SCRAP", `MRB ${ncr.ncrNumber} scrap disposition`);
          stockAction = `Lot ${lot.lotNumber} SCRAPPED → WH-SCRAP (movement recorded)`;
        } else if (decision.disposition === "RETURN_TO_VENDOR") {
          await db.stockLot.update({ where: { id: lot.id }, data: { status: "REJECTED", warehouseCode: "WH-REJ" } });
          await move("RETURN", "WH-REJ", `MRB ${ncr.ncrNumber} return-to-vendor`);
          stockAction = `Lot ${lot.lotNumber} → WH-REJ pending vendor return`;
        } else if (decision.disposition === "USE_AS_IS") {
          await db.stockLot.update({ where: { id: lot.id }, data: { status: "IN_STOCK", warehouseCode: "WH-ACC" } });
          await move("TRANSFER", "WH-ACC", `MRB ${ncr.ncrNumber} use-as-is concession`);
          stockAction = `Lot ${lot.lotNumber} → WH-ACC as IN_STOCK (concession)`;
        } else {
          // REWORK / REPAIR — controlled rework order + lot to WH-REWORK
          const rw = await db.reworkOrder.create({
            data: {
              rwNumber: await nextNumber("RW", "reworkOrder"),
              ncrId: ncr.id,
              woNumber: ncr.woNumber,
              targetLotNumber: lot.lotNumber,
              instructions: (b.instructions ?? decision.justification).trim(),
              authorizedBy: user.username,
              status: "OPEN",
            },
          });
          await db.stockLot.update({ where: { id: lot.id }, data: { status: "WIP", warehouseCode: "WH-REWORK" } });
          await move("TRANSFER", "WH-REWORK", `MRB ${ncr.ncrNumber} ${decision.disposition.toLowerCase()} via ${rw.rwNumber}`);
          stockAction = `${decision.disposition} authorized — ${rw.rwNumber} opened, lot ${lot.lotNumber} → WH-REWORK`;
        }
      }

      const [updatedDecision, updatedNcr] = await Promise.all([
        db.mrbDecision.update({ where: { id: decision.id }, data: { approvedBy: user.username, stockAction } }),
        db.ncr.update({ where: { id: ncr.id }, data: { status: "DISPOSITIONED" } }),
      ]);
      await logAudit(user, "APPROVE", "MRB", ncr.ncrNumber,
        `Four-eyes: ${decision.disposition} (decider ${decision.decidedBy}, approver ${user.username}) — ${stockAction}`);
      await db.notification.create({
        data: {
          role: "QUALITY_MGR", kind: "QUALITY", severity: "INFO",
          title: "MRB disposition applied",
          message: `${ncr.ncrNumber}: ${decision.disposition} approved by ${user.username}. ${stockAction}`,
          refType: "NCR", refId: ncr.ncrNumber,
        },
      });
      return ok({ decision: updatedDecision, ncr: updatedNcr, stockAction });
    }

    // ------------------------------------------------------------------- CLOSE
    if (b.action === "close") {
      const user = requirePerm(session, "quality.approve");
      if (ncr.status !== "DISPOSITIONED") {
        throw new ApiError(`Only DISPOSITIONED NCRs can be closed — ${ncr.ncrNumber} is ${ncr.status}`, 422);
      }
      const updated = await db.ncr.update({ where: { id: ncr.id }, data: { status: "CLOSED", closedAt: new Date() } });
      await logAudit(user, "CLOSE", "NCR", ncr.ncrNumber, "Disposition verified, NCR closed");
      return ok({ ncr: updated });
    }

    throw new ApiError(`Unknown action '${b.action}'`, 400);
  });
}
