import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ApiError, body, getSessionUser, handle, logAudit, nextNumber, ok, parseJsonField, requirePerm, type SessionUser,
} from "@/lib/erp/server";
import { hasPerm, type PermKey } from "@/lib/erp/constants";

// ============================================================================
// Tau ERP — Supplier Corrective Action Requests (SCAR).
// Auto-raised by /api/receipts/iqc on IQC FAIL; also raised manually here.
// Lifecycle: OPEN → UNDER_REVIEW (supplier response recorded) → VERIFICATION
// (buyer accepted the action plan) → CLOSED (four-eyes: closer ≠ raiser).
// CANCELLED allowed from OPEN/UNDER_REVIEW with reason. Every transition audited.
// Spec: supplier quality loop for rejected incoming material (§Procurement/QMS).
// ============================================================================

const SEVERITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;

type ScarRow = {
  id: string; scarNumber: string; supplierId: string; grnNumber: string; inspectionRef: string;
  lotNumbers: string[]; partSummary: string; defectDescription: string; severity: string;
  containment: string; responseDue: string | null; supplierResponse: string; respondedAt: string | null;
  status: string; raisedBy: string; closedBy: string; closedAt: string | null; createdAt: string;
  supplier: { code: string; name: string; category: string; approved: boolean; rating: number } | null;
};

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** SCAR visibility: any procurement or quality viewer (read). */
function requireScarView(user: SessionUser | null): SessionUser {
  if (!user) throw new ApiError("No session — please select a user in the topbar", 401);
  const perms: PermKey[] = ["procurement.view", "quality.view"];
  if (!perms.some((p) => hasPerm(user.role, p))) {
    throw new ApiError(`Permission denied: role ${user.role} lacks both 'procurement.view' and 'quality.view' (server-side RBAC enforced)`, 403);
  }
  return user;
}

/** GET /api/scars — register + stats + rejected-GRN chip map + supplier/line pickers. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = requireScarView(await getSessionUser(req));
    const [scars, suppliers, items, rejectedLines, closedCount] = await Promise.all([
      db.scar.findMany({ orderBy: { createdAt: "desc" } }),
      db.supplier.findMany({ select: { id: true, code: true, name: true, category: true, approved: true, rating: true }, orderBy: { code: "asc" } }),
      db.item.findMany({ select: { id: true, partNumber: true, name: true, uom: true }, orderBy: { partNumber: "asc" } }),
      db.grnLine.findMany({
        where: { disposition: "REJECTED" },
        include: { grn: { select: { grnNumber: true, supplierId: true } } },
        orderBy: { id: "desc" },
        take: 12,
      }),
      db.scar.count({ where: { status: "CLOSED" } }),
    ]);

    const supplierById = new Map(suppliers.map((s) => [s.id, s]));
    const rows: ScarRow[] = scars.map((s) => {
      const sup = supplierById.get(s.supplierId);
      return {
        id: s.id, scarNumber: s.scarNumber, supplierId: s.supplierId, grnNumber: s.grnNumber,
        inspectionRef: s.inspectionRef, lotNumbers: parseJsonField<string[]>(s.lotNumbersJson, []),
        partSummary: s.partSummary, defectDescription: s.defectDescription, severity: s.severity,
        containment: s.containment, responseDue: iso(s.responseDue), supplierResponse: s.supplierResponse,
        respondedAt: iso(s.respondedAt), status: s.status, raisedBy: s.raisedBy, closedBy: s.closedBy,
        closedAt: iso(s.closedAt), createdAt: s.createdAt.toISOString(),
        evidence: parseJsonField<{ name: string; size: number; kind: string; uploadedBy: string; uploadedAt: string }[]>(s.evidenceJson, []),
        supplier: sup ? { code: sup.code, name: sup.name, category: sup.category, approved: sup.approved, rating: sup.rating } : null,
      };
    });

    const now = Date.now();
    const open = rows.filter((r) => r.status === "OPEN" || r.status === "UNDER_REVIEW" || r.status === "VERIFICATION");
    const stats = {
      total: rows.length,
      open: open.length,
      criticalOpen: open.filter((r) => r.severity === "CRITICAL").length,
      overdueResponse: open.filter((r) => (r.status === "OPEN" || r.status === "UNDER_REVIEW") && r.responseDue && new Date(r.responseDue).getTime() < now).length,
      closed: closedCount,
    };

    // chip map for the receipts tab: grnNumber → active SCAR summary
    const scarByGrn: Record<string, { scarNumber: string; status: string; severity: string }> = {};
    for (const r of rows) {
      if (r.grnNumber && (r.status === "OPEN" || r.status === "UNDER_REVIEW" || r.status === "VERIFICATION")) {
        if (!scarByGrn[r.grnNumber]) scarByGrn[r.grnNumber] = { scarNumber: r.scarNumber, status: r.status, severity: r.severity };
      }
    }

    return ok({
      scars: rows,
      stats,
      scarByGrn,
      suppliers,
      items,
      rejectedLines: rejectedLines.map((l) => ({
        grnLineId: l.id,
        grnNumber: l.grn?.grnNumber ?? "",
        supplierId: l.grn?.supplierId ?? "",
        itemId: l.itemId,
        qty: l.qty,
        supplierBatch: l.supplierBatch,
      })),
      canManage: hasPerm(user.role, "quality.inspect"),
      canClose: hasPerm(user.role, "quality.approve"),
      me: user.username,
    });
  });
}

/**
 * POST /api/scars
 *  action=create  { supplierId, grnNumber?, inspectionRef?, lotNumbers?, partSummary?, defectDescription, severity, containment?, responseDue? }
 *  action=respond { id, supplierResponse }            OPEN → UNDER_REVIEW
 *  action=verify  { id }                              UNDER_REVIEW → VERIFICATION
 *  action=close   { id }                              VERIFICATION → CLOSED (four-eyes: ≠ raiser)
 *  action=cancel  { id, reason }                      OPEN|UNDER_REVIEW → CANCELLED
 *  action=attach-evidence { id, name, size, kind }    metadata-only D7 effectiveness evidence (round 10)
 *  action=remove-evidence { id, index }               remove an evidence entry (audited)
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session — please select a user in the topbar", 401);
    const b = await body<{
      action?: string; id?: string; supplierId?: string; grnNumber?: string; inspectionRef?: string;
      lotNumbers?: string[]; partSummary?: string; defectDescription?: string; severity?: string;
      containment?: string; responseDue?: string; supplierResponse?: string; reason?: string;
      name?: string; size?: number; kind?: string; index?: number;
      portal8d?: {
        containment?: string; rootCauseCategory?: string; rootCause?: string;
        corrective?: string; preventive?: string; effectiveness?: string; submittedBy?: string;
      };
    }>(req);
    const action = b.action ?? "";

    // ------------------------------------------------------------------ CREATE
    if (action === "create") {
      requirePerm(user, "quality.inspect");
      const supplier = b.supplierId ? await db.supplier.findUnique({ where: { id: b.supplierId } }) : null;
      if (!supplier) throw new ApiError("Select a valid supplier for the SCAR", 400);
      const defect = (b.defectDescription ?? "").trim();
      if (defect.length < 10) throw new ApiError("Defect description is mandatory (min 10 chars) — the supplier must understand the nonconformity", 422);
      const severity = (b.severity ?? "MAJOR").toUpperCase();
      if (!(SEVERITIES as readonly string[]).includes(severity)) {
        throw new ApiError(`severity must be one of ${SEVERITIES.join(" | ")}`, 422);
      }
      const lots = (Array.isArray(b.lotNumbers) ? b.lotNumbers : []).map((l) => String(l).trim()).filter(Boolean).slice(0, 25);
      const responseDue = b.responseDue ? new Date(b.responseDue) : new Date(Date.now() + 14 * 86400_000);
      if (Number.isNaN(responseDue.getTime())) throw new ApiError("responseDue is not a valid date", 422);

      const scarNumber = await nextNumber("SCAR", "scar");
      const scar = await db.scar.create({
        data: {
          scarNumber, supplierId: supplier.id,
          grnNumber: (b.grnNumber ?? "").trim().slice(0, 40),
          inspectionRef: (b.inspectionRef ?? "").trim().slice(0, 40),
          lotNumbersJson: JSON.stringify(lots),
          partSummary: (b.partSummary ?? "").trim().slice(0, 120),
          defectDescription: defect.slice(0, 2000),
          severity, containment: (b.containment ?? "").trim().slice(0, 2000),
          responseDue, status: "OPEN", raisedBy: user.username,
        },
      });
      await logAudit(user, "CREATE", "SCAR", scarNumber, `${severity} · supplier ${supplier.code} · ${b.grnNumber ? `GRN ${b.grnNumber}` : "manually raised"} · response due ${responseDue.toISOString().slice(0, 10)}`);
      await db.notification.create({
        data: {
          role: "PURCHASE_MGR", kind: "QUALITY", severity: severity === "MINOR" ? "INFO" : "WARNING",
          title: `SCAR raised — ${supplier.code}`,
          message: `${scarNumber} (${severity}) raised against ${b.grnNumber || "manual entry"} — supplier response due ${responseDue.toISOString().slice(0, 10)}.`,
          refType: "SCAR", refId: scarNumber,
        },
      });
      return ok({ scar }, 201);
    }

    // ------------------------------------------------------- LIFECYCLE ACTIONS
    if (!b.id) throw new ApiError("Missing SCAR id", 400);
    const scar = await db.scar.findUnique({ where: { id: b.id } });
    if (!scar) throw new ApiError("SCAR not found", 404);

    // ---------------------------------------------- EVIDENCE (D7 effectiveness, round 10)
    // Metadata-only placeholder by design (synthetic demo): file contents are never
    // stored — just an audited descriptor (name/size/kind/uploader) per entry.
    const EVIDENCE_KINDS = ["PHOTO", "TEST_REPORT", "COC", "CORRESPONDENCE", "OTHER"] as const;
    type EvidenceEntry = { name: string; size: number; kind: string; uploadedBy: string; uploadedAt: string };
    const evidenceOf = () => parseJsonField<EvidenceEntry[]>(scar.evidenceJson, []);

    if (action === "attach-evidence") {
      requirePerm(user, "quality.inspect");
      if (scar.status === "CLOSED" || scar.status === "CANCELLED") {
        throw new ApiError(`SCAR ${scar.scarNumber} is ${scar.status} — evidence can only be attached while the SCAR is active`, 422);
      }
      const name = (b.name ?? "").trim();
      if (!name || name.length > 120) throw new ApiError("Evidence file name is mandatory (max 120 chars)", 422);
      const size = Number(b.size ?? 0);
      if (!Number.isFinite(size) || size < 0 || size > 10_485_760) throw new ApiError("Evidence size must be 0–10 MB (metadata-only demo — larger files are rejected)", 422);
      const kind = (b.kind ?? "OTHER").toUpperCase();
      if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) throw new ApiError(`evidence kind must be one of ${EVIDENCE_KINDS.join(" | ")}`, 422);
      const entries = evidenceOf();
      if (entries.length >= 12) throw new ApiError("Evidence limit reached (12 entries per SCAR)", 422);
      entries.push({ name: name.slice(0, 120), size: Math.round(size), kind, uploadedBy: user.username, uploadedAt: new Date().toISOString() });
      const updated = await db.scar.update({ where: { id: scar.id }, data: { evidenceJson: JSON.stringify(entries) } });
      await logAudit(user, "SCAR_EVIDENCE_ADD", "SCAR", scar.scarNumber, `${kind} · ${name} (${Math.round(size / 1024)} KB) — D7 effectiveness evidence, metadata-only (demo)`);
      return ok({ scar: { ...updated, evidence: entries } });
    }

    if (action === "remove-evidence") {
      requirePerm(user, "quality.inspect");
      const idx = Number(b.index);
      const entries = evidenceOf();
      if (!Number.isInteger(idx) || idx < 0 || idx >= entries.length) throw new ApiError("Evidence index out of range", 422);
      const [removed] = entries.splice(idx, 1);
      const updated = await db.scar.update({ where: { id: scar.id }, data: { evidenceJson: JSON.stringify(entries) } });
      await logAudit(user, "SCAR_EVIDENCE_REMOVE", "SCAR", scar.scarNumber, `removed ${removed.kind} · ${removed.name} (audited)`);
      return ok({ scar: { ...updated, evidence: entries } });
    }

    if (action === "respond") {
      requirePerm(user, "quality.inspect");
      if (scar.status !== "OPEN") throw new ApiError(`SCAR ${scar.scarNumber} is ${scar.status} — supplier response is recorded only while OPEN`, 422);

      // Structured 8D response from the supplier-portal mock (preferred) or free text.
      const p8d = b.portal8d;
      let resp = (b.supplierResponse ?? "").trim();
      let auditNote = `supplier response recorded (${resp.length} chars)`;
      if (p8d) {
        const d3 = (p8d.containment ?? "").trim();
        const d4 = (p8d.rootCause ?? "").trim();
        const d5 = (p8d.corrective ?? "").trim();
        const d6 = (p8d.preventive ?? "").trim();
        const d7 = (p8d.effectiveness ?? "").trim();
        const by = (p8d.submittedBy ?? "").trim().slice(0, 120);
        for (const [k, v] of [["D3 containment", d3], ["D4 root cause", d4], ["D5 corrective action", d5]] as const) {
          if (v.length < 10) throw new ApiError(`${k} is mandatory in the 8D response (min 10 chars)`, 422);
        }
        const category = (p8d.rootCauseCategory ?? "").trim().slice(0, 40);
        resp = [
          `[8D RESPONSE — supplier portal (mock)${by ? ` · submitted by ${by}` : ""}]`,
          `D3 Containment: ${d3}`,
          `D4 Root cause${category ? ` (${category})` : ""}: ${d4}`,
          `D5 Corrective action: ${d5}`,
          d6 ? `D6 Preventive action: ${d6}` : "",
          d7 ? `D7 Effectiveness check: ${d7}` : "",
        ].filter(Boolean).join("\n").slice(0, 4000);
        auditNote = `8D response via supplier portal (mock) · root cause category ${category || "unspecified"} · ${resp.length} chars`;
      }
      if (resp.length < 10) throw new ApiError("Supplier response is mandatory (min 10 chars): root cause, corrective action and prevention", 422);

      const updated = await db.scar.update({
        where: { id: scar.id },
        data: { status: "UNDER_REVIEW", supplierResponse: resp.slice(0, 4000), respondedAt: new Date() },
      });
      await logAudit(user, "SCAR_RESPONSE", "SCAR", scar.scarNumber, `${auditNote} — under buyer review`);
      await db.notification.create({
        data: {
          role: "QUALITY_MGR", kind: "QUALITY", severity: "INFO",
          title: `SCAR response received — ${scar.scarNumber}`,
          message: `Supplier response recorded; review the action plan and move to verification when accepted.`,
          refType: "SCAR", refId: scar.scarNumber,
        },
      });
      return ok({ scar: updated });
    }

    if (action === "verify") {
      requirePerm(user, "quality.inspect");
      if (scar.status !== "UNDER_REVIEW") throw new ApiError(`SCAR ${scar.scarNumber} is ${scar.status} — only UNDER_REVIEW can move to verification`, 422);
      const updated = await db.scar.update({ where: { id: scar.id }, data: { status: "VERIFICATION" } });
      await logAudit(user, "SCAR_VERIFY", "SCAR", scar.scarNumber, "action plan accepted — effectiveness verification in progress");
      return ok({ scar: updated });
    }

    if (action === "close") {
      requirePerm(user, "quality.approve");
      if (scar.status !== "VERIFICATION") throw new ApiError(`SCAR ${scar.scarNumber} is ${scar.status} — close is allowed only from VERIFICATION (evidence must be verified first)`, 422);
      // Four-eyes (spec rule 12): the closer must differ from the raiser.
      if (scar.raisedBy === user.username) {
        throw new ApiError(`Four-eyes control violated: SCAR closure requires a user different from the raiser (${scar.raisedBy}) — FOUR_EYES.SCAR_CLOSURE (spec rule 12)`, 422);
      }
      const updated = await db.scar.update({
        where: { id: scar.id },
        data: { status: "CLOSED", closedBy: user.username, closedAt: new Date() },
      });
      await logAudit(user, "SCAR_CLOSE", "SCAR", scar.scarNumber, `closed by ${user.username} (four-eyes vs raiser ${scar.raisedBy})`);
      await db.notification.create({
        data: {
          role: "PURCHASE_MGR", kind: "QUALITY", severity: "INFO",
          title: `SCAR closed — ${scar.scarNumber}`,
          message: `Corrective action verified and closed by ${user.name}.`,
          refType: "SCAR", refId: scar.scarNumber,
        },
      });
      return ok({ scar: updated });
    }

    if (action === "cancel") {
      requirePerm(user, "quality.approve");
      if (scar.status !== "OPEN" && scar.status !== "UNDER_REVIEW") {
        throw new ApiError(`SCAR ${scar.scarNumber} is ${scar.status} — only OPEN or UNDER_REVIEW SCARs can be cancelled`, 422);
      }
      const reason = (b.reason ?? "").trim();
      if (reason.length < 5) throw new ApiError("A cancellation reason is mandatory (audited)", 422);
      const updated = await db.scar.update({
        where: { id: scar.id },
        data: { status: "CANCELLED", closedBy: user.username, closedAt: new Date() },
      });
      await logAudit(user, "SCAR_CANCEL", "SCAR", scar.scarNumber, `reason: ${reason}`);
      return ok({ scar: updated });
    }

    throw new ApiError(`Unknown action '${action}' — expected create | respond | verify | close | cancel`, 400);
  });
}
