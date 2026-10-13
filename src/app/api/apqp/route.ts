// ============================================================================
// Tau ERP — /api/apqp : APQP projects, gates, PPAP submissions (Engineering)
// GET  → projects with gate timeline + PPAP register (read: engineering.view)
// POST → { action: "advance-gate", gateId } (engineering.approve)
//         → gate APPROVED + actualDate; sequential gates enforced;
//         → when the last gate closes, project moves to PPAP_PENDING.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, ok, parseJsonField, requirePerm } from "@/lib/erp/server";

/** GET /api/apqp — APQP/PPAP payload. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    requirePerm(user, "engineering.view");

    // NOTE: ApqpProject stores itemId/customerId as plain String FKs (no Prisma
    // relation in the frozen schema) — stitch item/customer in application code.
    const [projects, gates, ppaps, items, customers] = await Promise.all([
      db.apqpProject.findMany({ orderBy: { number: "asc" } }),
      db.apqpGate.findMany({ orderBy: { seq: "asc" } }),
      db.ppapSubmission.findMany({ orderBy: { number: "asc" } }),
      db.item.findMany({ select: { id: true, partNumber: true, name: true } }),
      db.customer.findMany({ select: { id: true, code: true, name: true, programme: true } }),
    ]);

    const itemById = new Map(items.map((i) => [i.id, i]));
    const customerById = new Map(customers.map((c) => [c.id, c]));

    return ok({
      projects: projects.map((p) => {
        const item = itemById.get(p.itemId);
        const customer = customerById.get(p.customerId);
        return {
          id: p.id, number: p.number, title: p.title, status: p.status,
          itemId: p.itemId, partNumber: item?.partNumber ?? "", itemName: item?.name ?? "",
          customerCode: customer?.code ?? "", customerName: customer?.name ?? "",
          programme: customer?.programme ?? "",
          startDate: p.startDate, targetDate: p.targetDate,
          gates: gates.filter((g) => g.projectId === p.id).map((g) => ({
            id: g.id, seq: g.seq, name: g.name, deliverables: g.deliverables, status: g.status,
            plannedDate: g.plannedDate, actualDate: g.actualDate, evidence: g.evidence,
          })),
          ppap: ppaps.filter((s) => s.projectId === p.id).map((s) => ({
            id: s.id, number: s.number, level: s.level, status: s.status, pswNumber: s.pswNumber,
            submittedAt: s.submittedAt, disposition: s.disposition,
            evidence: parseJsonField<string[]>(s.evidenceJson, []),
          })),
        };
      }),
    });
  });
}

/** POST /api/apqp — advance-gate: approve the next APQP gate. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    const b = await body<Record<string, unknown>>(req);
    const action = typeof b.action === "string" ? b.action : "";
    if (action !== "advance-gate") throw new ApiError(`Unknown action '${action}' — expected advance-gate`, 400);
    const gateId = typeof b.gateId === "string" ? b.gateId : "";
    if (!gateId) throw new ApiError("gateId is required", 422);

    const approver = requirePerm(user, "engineering.approve");

    const gate = await db.apqpGate.findUnique({ where: { id: gateId }, include: { project: true } });
    if (!gate) throw new ApiError("APQP gate not found", 404);
    if (gate.status === "APPROVED") throw new ApiError(`${gate.name} is already APPROVED`, 422);
    if (gate.status === "BLOCKED") {
      throw new ApiError(`${gate.name} is BLOCKED — resolve blockers before advancing`, 422);
    }

    const siblings = await db.apqpGate.findMany({ where: { projectId: gate.projectId }, orderBy: { seq: "asc" } });
    const pendingBefore = siblings.find((g) => g.seq < gate.seq && g.status !== "APPROVED");
    if (pendingBefore) {
      throw new ApiError(`Gates must be approved in sequence — ${pendingBefore.name} is still ${pendingBefore.status}`, 422);
    }

    const now = new Date();
    const updated = await db.apqpGate.update({
      where: { id: gate.id },
      data: { status: "APPROVED", actualDate: now },
    });

    // All gates closed → the programme owes a PPAP submission before approval.
    let projectStatus = gate.project.status;
    const allApproved = siblings.every((g) => g.id === gate.id || g.status === "APPROVED");
    if (allApproved && ["PLANNING", "IN_PROGRESS"].includes(projectStatus)) {
      const proj = await db.apqpProject.update({ where: { id: gate.projectId }, data: { status: "PPAP_PENDING" } });
      projectStatus = proj.status;
    }

    await logAudit(user, "APPROVE", "APQP_GATE", gate.id, `${gate.project.number} ${gate.name} approved by ${approver.username}${projectStatus === "PPAP_PENDING" ? " — project now PPAP_PENDING" : ""}`);
    return ok({ gate: { id: updated.id, status: updated.status, actualDate: updated.actualDate }, projectStatus });
  });
}
