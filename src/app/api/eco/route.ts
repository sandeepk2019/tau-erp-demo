// ============================================================================
// Tau ERP — /api/eco : Engineering changes ECR/ECO (Engineering module)
// GET  → change list with parsed impactJson (read: engineering.view)
// POST → { action: "create" }    (engineering.edit)  — raise ECR/ECO
//        { action: "approve" }   (engineering.approve + fourEyes: requester
//                                 cannot approve own change — spec rule 12)
//        { action: "implement" } (engineering.approve, APPROVED → IMPLEMENTED)
//        { action: "close" }     (engineering.approve, IMPLEMENTED → CLOSED)
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, fourEyes, getSessionUser, handle, logAudit, nextNumber, ok, parseJsonField, requirePerm } from "@/lib/erp/server";

const KINDS = ["ECR", "ECO"];
const EFFECTIVITIES = ["NEXT_WO", "DATE", "SERIAL_BREAK"];
const APPROVABLE_FROM = ["DRAFT", "TRIAGE", "IMPACT_REVIEW"];

/** GET /api/eco — engineering changes. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    requirePerm(user, "engineering.view");

    const changes = await db.engineeringChange.findMany({ orderBy: { createdAt: "desc" } });
    return ok({
      changes: changes.map((c) => ({
        id: c.id, number: c.number, kind: c.kind, title: c.title, reason: c.reason,
        status: c.status, effectivity: c.effectivity, effectivityDate: c.effectivityDate,
        requestedBy: c.requestedBy, approvedBy: c.approvedBy, createdAt: c.createdAt,
        impact: parseJsonField<Record<string, unknown>>(c.impactJson, {}),
      })),
    });
  });
}

/** POST /api/eco — action dispatch: create | approve | implement | close. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    const b = await body<Record<string, unknown>>(req);
    const action = typeof b.action === "string" ? b.action : "";
    const id = typeof b.id === "string" ? b.id : "";

    if (action === "create") {
      const editor = requirePerm(user, "engineering.edit");
      const kind = typeof b.kind === "string" && b.kind ? b.kind : "ECR";
      if (!KINDS.includes(kind)) throw new ApiError(`Invalid kind '${kind}' — expected ECR | ECO`, 422);
      const title = typeof b.title === "string" ? b.title.trim() : "";
      if (!title) throw new ApiError("Title is required", 422);
      if (title.length > 160) throw new ApiError("Title exceeds 160 characters", 422);
      const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 500) : "";
      const effectivity = typeof b.effectivity === "string" && b.effectivity ? b.effectivity : "NEXT_WO";
      if (!EFFECTIVITIES.includes(effectivity)) throw new ApiError(`Invalid effectivity '${effectivity}'`, 422);
      let effectivityDate: Date | null = null;
      if (effectivity === "DATE") {
        if (!b.effectivityDate) throw new ApiError("effectivity DATE requires an effectivityDate", 422);
        effectivityDate = new Date(String(b.effectivityDate));
        if (isNaN(effectivityDate.getTime())) throw new ApiError("effectivityDate must be a valid date", 422);
      }
      const number = await nextNumber(kind, "engineeringChange");
      const change = await db.engineeringChange.create({
        data: { number, kind, title, reason, effectivity, effectivityDate, requestedBy: editor.username, status: "DRAFT" },
      });
      await logAudit(user, "CREATE", "ENGINEERING_CHANGE", change.id, `${number} (${kind}) raised by ${editor.username}: ${title}`);
      return ok({ change: { id: change.id, number: change.number, status: change.status } }, 201);
    }

    if (!id) throw new ApiError("id is required", 422);
    const change = await db.engineeringChange.findUnique({ where: { id } });
    if (!change) throw new ApiError("Engineering change not found", 404);

    if (action === "approve") {
      const approver = requirePerm(user, "engineering.approve");
      if (change.status === "APPROVED") throw new ApiError(`${change.number} is already APPROVED`, 422);
      if (!APPROVABLE_FROM.includes(change.status)) {
        throw new ApiError(`Cannot approve from status ${change.status} — expected DRAFT/TRIAGE/IMPACT_REVIEW`, 422);
      }
      fourEyes(change.requestedBy, approver.username, `${change.number} approval`);
      const updated = await db.engineeringChange.update({
        where: { id: change.id },
        data: { status: "APPROVED", approvedBy: approver.username },
      });
      await logAudit(user, "APPROVE", "ENGINEERING_CHANGE", change.id, `${change.number} approved by ${approver.username} (four-eyes vs requester ${change.requestedBy})`);
      return ok({ change: { id: updated.id, status: updated.status, approvedBy: updated.approvedBy } });
    }

    if (action === "implement") {
      requirePerm(user, "engineering.approve");
      if (change.status !== "APPROVED") {
        throw new ApiError(`Only APPROVED changes can be implemented (current: ${change.status})`, 422);
      }
      const updated = await db.engineeringChange.update({ where: { id: change.id }, data: { status: "IMPLEMENTED" } });
      await logAudit(user, "IMPLEMENT", "ENGINEERING_CHANGE", change.id, `${change.number} implemented — effectivity ${change.effectivity}`);
      return ok({ change: { id: updated.id, status: updated.status } });
    }

    if (action === "close") {
      requirePerm(user, "engineering.approve");
      if (change.status !== "IMPLEMENTED") {
        throw new ApiError(`Only IMPLEMENTED changes can be closed (current: ${change.status})`, 422);
      }
      const updated = await db.engineeringChange.update({ where: { id: change.id }, data: { status: "CLOSED" } });
      await logAudit(user, "CLOSE", "ENGINEERING_CHANGE", change.id, `${change.number} closed`);
      return ok({ change: { id: updated.id, status: updated.status } });
    }

    throw new ApiError(`Unknown action '${action}' — expected create | approve | implement | close`, 400);
  });
}
