// ============================================================================
// Tau ERP — Decision Register API (spec: unknowns are TBD, never invented)
// GET  /api/decisions                          → all register items (decisions.view)
// POST {action:"create"}  {title,question,owner,dueDate?,notes?} → new OPEN item (decisions.manage)
// POST {action:"decide"}  {id, decision}  → status DECIDED (decisions.manage, audit)
// POST {action:"close"}   {id}            → status CLOSED (decisions.manage, audit; must be DECIDED)
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, handle, ok, requirePerm, body, logAudit, ApiError } from "@/lib/erp/server";

// ---------------------------------------------------------------------------
// GET /api/decisions
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  return handle(async () => {
    requirePerm(await getSessionUser(req), "decisions.view");
    const rows = await db.decisionRegister.findMany({ orderBy: { ref: "asc" } });
    const now = new Date();
    return ok({
      rows,
      stats: {
        total: rows.length,
        open: rows.filter((r) => r.status === "OPEN").length,
        decided: rows.filter((r) => r.status === "DECIDED").length,
        closed: rows.filter((r) => r.status === "CLOSED").length,
        overdue: rows.filter((r) => r.status === "OPEN" && r.dueDate && r.dueDate < now).length,
        tbdOwnerApproval: rows.filter((r) => r.notes.toUpperCase().includes("TBD—OWNER APPROVAL REQUIRED")).length,
        // approved = decision recorded (DECIDED/CLOSED) — synthetic-data approvals DR-001/DR-004/DR-005 count here
        approved: rows.filter((r) => r.status !== "OPEN" && r.decision.trim().length > 0).length,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// POST /api/decisions
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await body<{ action?: string; id?: string; title?: string; question?: string; owner?: string; dueDate?: string | null; notes?: string; decision?: string }>(req);

    if (b.action === "create") {
      const user = requirePerm(await getSessionUser(req), "decisions.manage");
      const title = (b.title ?? "").trim();
      const question = (b.question ?? "").trim();
      const owner = (b.owner ?? "").trim();
      if (!title || !question || !owner) {
        throw new ApiError("Decision item requires title, question and owner", 422);
      }
      const existing = await db.decisionRegister.findMany({ select: { ref: true } });
      const maxRef = existing.reduce((m, r) => {
        const n = Number(r.ref.replace(/^DR-/, ""));
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      const ref = `DR-${String(maxRef + 1).padStart(3, "0")}`;
      const due = b.dueDate ? new Date(b.dueDate) : null;
      const created = await db.decisionRegister.create({
        data: {
          ref, title, question, owner,
          dueDate: due && !isNaN(due.getTime()) ? due : null,
          status: "OPEN",
          notes: (b.notes ?? "").trim(),
        },
      });
      await logAudit(user, "CREATE", "DECISION", ref, `Registered: ${title.slice(0, 120)}`);
      return ok({ row: created });
    }

    if (b.action === "decide") {
      const user = requirePerm(await getSessionUser(req), "decisions.manage");
      const decisionText = (b.decision ?? "").trim();
      if (!b.id) throw new ApiError("decide requires item id", 422);
      if (!decisionText) throw new ApiError("A decision requires decision text (what was decided, by whom, scope)", 422);
      const row = await db.decisionRegister.findUnique({ where: { id: b.id } });
      if (!row) throw new ApiError("Decision item not found", 404);
      if (row.status === "CLOSED") throw new ApiError("Item is CLOSED — reopen is not permitted; register a new item instead", 422);
      const updated = await db.decisionRegister.update({
        where: { id: row.id },
        data: { status: "DECIDED", decision: decisionText.slice(0, 2000) },
      });
      await logAudit(user, "APPROVE", "DECISION", row.ref, `DECIDED: ${decisionText.slice(0, 160)}`);
      return ok({ row: updated });
    }

    if (b.action === "close") {
      const user = requirePerm(await getSessionUser(req), "decisions.manage");
      if (!b.id) throw new ApiError("close requires item id", 422);
      const row = await db.decisionRegister.findUnique({ where: { id: b.id } });
      if (!row) throw new ApiError("Decision item not found", 404);
      if (row.status === "CLOSED") throw new ApiError("Item is already CLOSED", 422);
      if (row.status !== "DECIDED" || !row.decision.trim()) {
        throw new ApiError("Only DECIDED items can be closed — record the decision first", 422);
      }
      const updated = await db.decisionRegister.update({
        where: { id: row.id },
        data: { status: "CLOSED" },
      });
      await logAudit(user, "UPDATE", "DECISION", row.ref, "CLOSED after decision recorded");
      return ok({ row: updated });
    }

    throw new ApiError(`Unknown action '${b.action ?? ""}' — expected create | decide | close`, 400);
  });
}
