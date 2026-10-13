// ============================================================================
// Tau ERP — /api/routes : Route revisions & steps (Engineering module)
// GET  → all route revisions with ordered steps (read: engineering.view)
// POST → { action: "release", routeId } (engineering.approve, DRAFT → RELEASED)
// Routes are family-owned baselines; editing happens via new revisions
// (schema-frozen module — no step editing endpoint by design).
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, ok, requirePerm } from "@/lib/erp/server";

/** GET /api/routes — route revisions + steps per family. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    requirePerm(user, "engineering.view");

    const routes = await db.routeRevision.findMany({
      include: { steps: { orderBy: { seq: "asc" } } },
      orderBy: [{ familyCode: "asc" }, { revision: "asc" }],
    });

    return ok({
      routes: routes.map((r) => ({
        id: r.id, familyCode: r.familyCode, name: r.name, revision: r.revision,
        status: r.status, effectiveFrom: r.effectiveFrom, releasedBy: r.releasedBy,
        releasedAt: r.releasedAt, notes: r.notes,
        steps: r.steps.map((s) => ({
          id: s.id, seq: s.seq, operationCode: s.operationCode, workstationKind: s.workstationKind,
          inspectionTemplateCode: s.inspectionTemplateCode, mandatory: s.mandatory,
          evidenceClass: s.evidenceClass, description: s.description, skillRequired: s.skillRequired,
        })),
      })),
    });
  });
}

/** POST /api/routes — release a DRAFT route revision. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    const b = await body<Record<string, unknown>>(req);
    const action = typeof b.action === "string" ? b.action : "";
    const routeId = typeof b.routeId === "string" ? b.routeId : "";
    if (action !== "release") throw new ApiError(`Unknown action '${action}' — expected release`, 400);
    if (!routeId) throw new ApiError("routeId is required", 422);

    const approver = requirePerm(user, "engineering.approve");

    const route = await db.routeRevision.findUnique({
      where: { id: routeId },
      include: { steps: true },
    });
    if (!route) throw new ApiError("Route revision not found", 404);
    if (route.status === "RELEASED") {
      throw new ApiError("Released revision is immutable — issue a new revision (spec rule 13)", 422);
    }
    if (route.status !== "DRAFT") throw new ApiError(`Only DRAFT revisions can be released (current: ${route.status})`, 422);
    if (route.steps.length === 0) throw new ApiError("Cannot release a route with zero steps", 422);

    const eff = b.effectiveFrom ? new Date(String(b.effectiveFrom)) : new Date();
    if (isNaN(eff.getTime())) throw new ApiError("effectiveFrom must be a valid date", 422);

    const updated = await db.routeRevision.update({
      where: { id: route.id },
      data: { status: "RELEASED", releasedBy: approver.username, releasedAt: new Date(), effectiveFrom: eff },
    });
    await logAudit(user, "RELEASE", "ROUTE", route.id, `${route.familyCode} ${route.name} rev ${route.revision} released (${route.steps.length} steps)`);
    return ok({ route: { id: updated.id, status: updated.status, releasedBy: updated.releasedBy, releasedAt: updated.releasedAt, effectiveFrom: updated.effectiveFrom } });
  });
}
