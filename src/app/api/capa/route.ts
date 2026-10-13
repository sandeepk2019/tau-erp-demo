import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, nextNumber, ok, parseJsonField, requirePerm } from "@/lib/erp/server";

// ============================================================================
// Tau ERP — CAPA (corrective / preventive actions) with effectiveness-verification
// closure gate. Spec §QMS step 9 + gate criterion: "CAPA cannot close without
// effectiveness review".
// ============================================================================

type CapaAction = { action: string; owner?: string; dueDate?: string; done?: boolean };

/** GET /api/capa — all CAPAs with their NCR reference. */
export async function GET() {
  return handle(async () => {
    const capas = await db.capa.findMany({
      orderBy: { createdAt: "desc" },
      include: { ncr: { select: { ncrNumber: true } } },
    });
    return ok({
      capas: capas.map((c) => ({ ...c, ncrNumber: c.ncr?.ncrNumber ?? "" })),
    });
  });
}

/**
 * POST /api/capa
 *  action=create  { kind, problem, rootCause?, owner, dueDate?, ncrId?, actions?[] } (quality.approve)
 *  action=toggle  { id, index }  toggle action-checklist item                    (quality.inspect)
 *  action=verify  { id }         OPEN/ACTIONS_PENDING → VERIFICATION             (quality.approve)
 *  action=close   { id, effectiveness }  VERIFICATION → CLOSED (text mandatory)  (quality.approve)
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = await getSessionUser(req);
    const b = await body<{
      action: string;
      id?: string;
      kind?: string;
      problem?: string;
      rootCause?: string;
      owner?: string;
      dueDate?: string;
      ncrId?: string;
      actions?: CapaAction[];
      index?: number;
      effectiveness?: string;
    }>(req);

    // ------------------------------------------------------------------ CREATE
    if (b.action === "create") {
      const user = requirePerm(session, "quality.approve");
      const problem = (b.problem ?? "").trim();
      if (!problem) throw new ApiError("CAPA problem statement is required", 400);
      const kind = b.kind === "PREVENTIVE" ? "PREVENTIVE" : "CORRECTIVE";
      const actions = Array.isArray(b.actions)
        ? b.actions
            .filter((a) => a && typeof a.action === "string" && a.action.trim())
            .map((a) => ({ action: a.action.trim(), owner: (a.owner ?? "").trim(), dueDate: (a.dueDate ?? "").trim(), done: false }))
        : [];
      const capa = await db.capa.create({
        data: {
          capaNumber: await nextNumber("CAPA", "capa"),
          ncrId: b.ncrId || null,
          kind,
          problem,
          rootCause: (b.rootCause ?? "").trim(),
          actionsJson: JSON.stringify(actions),
          owner: (b.owner ?? "").trim(),
          dueDate: b.dueDate ? new Date(b.dueDate) : null,
          status: "OPEN",
        },
      });
      await logAudit(user, "CREATE", "CAPA", capa.capaNumber, `${kind} · ${problem.slice(0, 140)}`);
      await db.notification.create({
        data: {
          role: "QUALITY_MGR", kind: "QUALITY", severity: "INFO",
          title: "CAPA opened",
          message: `${capa.capaNumber} (${kind}) opened — owner ${capa.owner || "unassigned"}.`,
          refType: "CAPA", refId: capa.capaNumber,
        },
      });
      return ok({ capa }, 201);
    }

    if (!b.id) throw new ApiError("Missing CAPA id", 400);
    const capa = await db.capa.findUnique({ where: { id: b.id } });
    if (!capa) throw new ApiError("CAPA not found", 404);

    // ------------------------------------------------------------------ TOGGLE
    if (b.action === "toggle") {
      const user = requirePerm(session, "quality.inspect");
      if (capa.status === "CLOSED") throw new ApiError("CAPA is closed — evidence is immutable (spec rule 9)", 422);
      const actions = parseJsonField<CapaAction[]>(capa.actionsJson, []);
      if (typeof b.index !== "number" || b.index < 0 || b.index >= actions.length) {
        throw new ApiError("Invalid action index", 400);
      }
      actions[b.index] = { ...actions[b.index], done: !actions[b.index].done };
      const updated = await db.capa.update({ where: { id: capa.id }, data: { actionsJson: JSON.stringify(actions) } });
      await logAudit(user, "UPDATE", "CAPA", capa.capaNumber, `action #${b.index + 1} ${actions[b.index].done ? "done" : "reopened"}`);
      return ok({ capa: updated });
    }

    // ------------------------------------------------------------------ VERIFY
    if (b.action === "verify") {
      const user = requirePerm(session, "quality.approve");
      if (capa.status === "CLOSED") throw new ApiError("CAPA already closed", 422);
      if (capa.status === "VERIFICATION") throw new ApiError("CAPA is already in effectiveness verification", 422);
      const updated = await db.capa.update({ where: { id: capa.id }, data: { status: "VERIFICATION" } });
      await logAudit(user, "VERIFY", "CAPA", capa.capaNumber, "Moved to effectiveness verification");
      return ok({ capa: updated });
    }

    // ------------------------------------------------------------------- CLOSE
    if (b.action === "close") {
      const user = requirePerm(session, "quality.approve");
      if (capa.status !== "VERIFICATION") {
        throw new ApiError("Only CAPAs in effectiveness verification can be closed — run 'Verify effectiveness' first", 422);
      }
      const effectiveness = (b.effectiveness ?? capa.effectiveness ?? "").trim();
      // Spec gate criterion — closure blocked without a recorded effectiveness review.
      if (!effectiveness) throw new ApiError("CAPA cannot close without effectiveness review (spec)", 422);
      const updated = await db.capa.update({
        where: { id: capa.id },
        data: { effectiveness, status: "CLOSED", closedAt: new Date() },
      });
      await logAudit(user, "CLOSE", "CAPA", capa.capaNumber, `effectiveness: ${effectiveness.slice(0, 140)}`);
      return ok({ capa: updated });
    }

    throw new ApiError(`Unknown action '${b.action}'`, 400);
  });
}
