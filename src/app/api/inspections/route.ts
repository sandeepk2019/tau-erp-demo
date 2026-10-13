import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ApiError, body, getSessionUser, handle, logAudit, nextNumber, ok, parseJsonField, requirePerm,
} from "@/lib/erp/server";

// ============================================================================
// Tau ERP — Quality inspections (IQC | INPROCESS | CALIBRATION | EOL | FINAL)
// Spec §Calibration/EOL/test records: submitted evidence is IMMUTABLE (rule 9),
// equipment validity gate, template-limit evaluation, governed retests.
// ============================================================================

type TemplateParam = { name: string; unit?: string; lower?: number; upper?: number; kind?: string };
type SubmittedResult = { parameter: string; value: unknown };
type ResultRow = { parameter: string; unit: string; value: unknown; lower: number | null; upper: number | null; pass: boolean };

/** nextNumber() counts records, but seeded inspection numbers are sparse
 *  (INSP-2025-0011..0046 with gaps) — probe forward until the number is free. */
async function freeInspectionNumber(): Promise<string> {
  let n = await nextNumber("INSP", "inspection");
  while (await db.inspection.findUnique({ where: { inspNumber: n } })) {
    const m = n.match(/^(.*-)(\d+)$/);
    if (!m) throw new ApiError("Inspection numbering failed", 500);
    n = `${m[1]}${String(Number(m[2]) + 1).padStart(4, "0")}`;
  }
  return n;
}

/** Evaluate submitted measurements against InspectionTemplate limits.
 *  Text parameters (kind TEXT) pass when non-empty; numerics must lie in [lower, upper].
 *  Missing measurements FAIL — evidence cannot be assumed. */
function evaluate(params: TemplateParam[], provided: SubmittedResult[]): ResultRow[] {
  const byName = new Map<string, unknown>();
  for (const r of provided) if (r && typeof r.parameter === "string") byName.set(r.parameter.trim(), r.value);
  return params.map((p) => {
    const has = byName.has(p.name);
    const raw = byName.get(p.name);
    if (p.kind === "TEXT") {
      const v = has ? String(raw ?? "").trim() : "";
      return { parameter: p.name, unit: p.unit ?? "-", value: v || "(not recorded)", lower: null, upper: null, pass: v.length > 0 };
    }
    const num = Number(raw);
    const numeric = has && raw !== "" && raw !== null && raw !== undefined && Number.isFinite(num);
    const pass = numeric && (p.lower === undefined || num >= p.lower) && (p.upper === undefined || num <= p.upper);
    return {
      parameter: p.name, unit: p.unit ?? "-",
      value: numeric ? num : has ? String(raw) : "(not recorded)",
      lower: p.lower ?? null, upper: p.upper ?? null, pass,
    };
  });
}

/** GET /api/inspections — all inspections + reference data (templates, equipment, WO families). */
export async function GET() {
  return handle(async () => {
    const [inspections, templates, equipment, wos, users] = await Promise.all([
      db.inspection.findMany(),
      db.inspectionTemplate.findMany({ orderBy: { code: "asc" } }),
      db.equipment.findMany({ orderBy: { code: "asc" } }),
      db.workOrder.findMany({ select: { woNumber: true, familyCode: true } }),
      db.user.findMany({ select: { id: true, username: true, name: true } }),
    ]);
    inspections.sort((a, b) => b.inspNumber.localeCompare(a.inspNumber));
    return ok({
      inspections,
      templates,
      equipment,
      woFamily: Object.fromEntries(wos.map((w) => [w.woNumber, w.familyCode])),
      users: Object.fromEntries(users.map((u) => [u.id, u.name])),
    });
  });
}

/**
 * POST /api/inspections
 *  action=create  { templateCode, lotNumber?, woNumber?, equipmentCode? } → new PENDING inspection
 *  action=submit  { id, results:[{parameter,value}], equipmentCode? }     → evaluate + IMMUTABLE
 *  action=retest  { id, retestReason }                                    → new attempt+1 PENDING
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "quality.inspect");
    const b = await body<{
      action?: string;
      id?: string;
      templateCode?: string;
      lotNumber?: string;
      woNumber?: string;
      equipmentCode?: string;
      results?: SubmittedResult[];
      retestReason?: string;
    }>(req);
    const action = b.action ?? "submit";

    // ------------------------------------------------------------------ CREATE
    if (action === "create") {
      const template = b.templateCode
        ? await db.inspectionTemplate.findUnique({ where: { code: b.templateCode } })
        : null;
      if (!template) throw new ApiError("Unknown inspection template — select a valid test specification", 400);
      if (!b.lotNumber?.trim() && !b.woNumber?.trim()) {
        throw new ApiError("Provide a lot number or work order for the inspection", 400);
      }
      const equipmentCode = b.equipmentCode?.trim() ?? "";
      if (equipmentCode) {
        const eq = await db.equipment.findUnique({ where: { code: equipmentCode } });
        if (!eq) throw new ApiError(`Unknown equipment '${equipmentCode}'`, 400);
      }
      const insp = await db.inspection.create({
        data: {
          inspNumber: await freeInspectionNumber(),
          kind: template.kind,
          templateCode: template.code,
          refType: b.lotNumber?.trim() ? "LOT" : "MANUAL",
          refId: "",
          lotNumber: b.lotNumber?.trim() ?? "",
          woNumber: b.woNumber?.trim() ?? "",
          equipmentCode,
          attempt: 1,
          status: "PENDING",
          resultsJson: "[]",
          inspectorId: user.id,
        },
      });
      await logAudit(user, "CREATE", "INSPECTION", insp.inspNumber, `PENDING ${template.kind} via ${template.code}`);
      return ok({ inspection: insp }, 201);
    }

    // ------------------------------------------------------------------ RETEST
    if (action === "retest") {
      if (!b.id) throw new ApiError("Missing inspection id", 400);
      const original = await db.inspection.findUnique({ where: { id: b.id } });
      if (!original) throw new ApiError("Inspection not found", 404);
      if (!original.immutable) {
        throw new ApiError("Cannot retest an unsubmitted inspection — submit its results first", 422);
      }
      const reason = (b.retestReason ?? "").trim();
      if (!reason) throw new ApiError("Retest reason is mandatory for a new attempt (spec: authorized retest governance)", 422);
      const peers = await db.inspection.findMany({
        where: { lotNumber: original.lotNumber, kind: original.kind },
        select: { attempt: true },
      });
      const attempt = peers.reduce((m, p) => Math.max(m, p.attempt), 0) + 1;
      const insp = await db.inspection.create({
        data: {
          inspNumber: await freeInspectionNumber(),
          kind: original.kind,
          templateCode: original.templateCode,
          refType: original.refType,
          refId: original.refId,
          lotNumber: original.lotNumber,
          woNumber: original.woNumber,
          equipmentCode: original.equipmentCode,
          attempt,
          retestReason: reason,
          status: "PENDING",
          resultsJson: "[]",
          inspectorId: user.id,
          grnLineId: original.grnLineId,
        },
      });
      await logAudit(user, "RETEST", "INSPECTION", insp.inspNumber,
        `attempt ${attempt} of ${original.inspNumber} — reason: ${reason}`);
      return ok({ inspection: insp }, 201);
    }

    // ------------------------------------------------------------------ SUBMIT
    if (action !== "submit") throw new ApiError(`Unknown action '${action}'`, 400);
    if (!b.id) throw new ApiError("Missing inspection id", 400);
    const insp = await db.inspection.findUnique({ where: { id: b.id } });
    if (!insp) throw new ApiError("Inspection not found", 404);
    if (insp.status !== "PENDING" || insp.immutable) {
      // Spec rule 9 — submitted evidence is immutable; corrections only via authorized retest.
      throw new ApiError("Submitted evidence is immutable (spec rule 9)", 422);
    }
    if (!Array.isArray(b.results) || b.results.length === 0) {
      throw new ApiError("No results submitted — record at least one measurement", 400);
    }

    // Equipment validity gate (spec Phase-10 gate criterion: expired gauge blocks the test).
    const equipmentCode = (b.equipmentCode ?? insp.equipmentCode).trim();
    if (equipmentCode) {
      const eq = await db.equipment.findUnique({ where: { code: equipmentCode } });
      if (!eq) throw new ApiError(`Unknown equipment '${equipmentCode}'`, 400);
      if (eq.calibrationDue && new Date(eq.calibrationDue).getTime() < Date.now()) {
        throw new ApiError("Equipment calibration expired — test blocked (GAUGE-LEAK-01)", 422);
      }
    }

    const template = insp.templateCode
      ? await db.inspectionTemplate.findUnique({ where: { code: insp.templateCode } })
      : null;
    if (!template) throw new ApiError("Inspection has no test template — cannot evaluate results", 422);
    const params = parseJsonField<TemplateParam[]>(template.paramsJson, []);
    const rows = evaluate(params, b.results);
    const overall = rows.every((r) => r.pass) ? "PASS" : "FAIL";

    const updated = await db.inspection.update({
      where: { id: insp.id },
      data: {
        resultsJson: JSON.stringify(rows),
        overallResult: overall,
        status: overall === "PASS" ? "PASSED" : "FAILED",
        immutable: true,
        submittedAt: new Date(),
        inspectorId: user.id,
        approvedBy: user.username,
        equipmentCode,
      },
    });
    await logAudit(user, "SUBMIT", "INSPECTION", insp.inspNumber,
      `${insp.kind} lot ${insp.lotNumber || "—"} → ${overall} (evidence immutable)${equipmentCode ? ` on ${equipmentCode}` : ""}`);
    if (overall === "FAIL") {
      await db.notification.create({
        data: {
          role: "QUALITY_MGR", kind: "QUALITY", severity: "WARNING",
          title: "Inspection failed",
          message: `${insp.inspNumber} (${insp.kind}, lot ${insp.lotNumber || "—"}) FAILED — raise NCR and containment.`,
          refType: "INSPECTION", refId: insp.inspNumber,
        },
      });
    }
    return ok({ inspection: updated });
  });
}
