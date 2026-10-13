// ============================================================================
// Tau ERP — Production: Job Cards (shop-floor execution)
// GET  /api/job-cards?wo=WO-…   → cards of one work order (sequence order)
// GET  /api/job-cards           → cards of all IN_PROGRESS work orders
// POST /api/job-cards           → { jobCardId, action: start|pause|resume|complete, qtyGood?, qtyScrap? }
// Enforcement: operation sequence (previous mandatory card must be COMPLETED),
// READY-only start, IN_PROGRESS-only completion, remaining-qty cap,
// OPERATOR role restricted to cards with an assigned workstation,
// server-generated timestamps only (backdated posting impossible — audit note).
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, ok, parseJsonField, requirePerm } from "@/lib/erp/server";

type JobCardWithRel = Awaited<ReturnType<typeof loadCard>>;

async function loadCard(id: string) {
  return db.jobCard.findUnique({ where: { id }, include: { wo: true, step: true } });
}

function serializeCard(c: NonNullable<JobCardWithRel>, operatorMap: Map<string, string>) {
  return {
    id: c.id,
    woNumber: c.wo.woNumber,
    woStatus: c.wo.status,
    sequence: c.sequence,
    operationCode: c.operationCode,
    workstationCode: c.workstationCode,
    status: c.status,
    qtyGood: c.qtyGood,
    qtyScrap: c.qtyScrap,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    operator: c.operatorId ? operatorMap.get(c.operatorId) ?? c.operatorId : "",
    mandatory: c.step.mandatory,
    evidenceClass: c.step.evidenceClass,
    inspectionTemplateCode: c.step.inspectionTemplateCode,
    skillRequired: c.step.skillRequired,
  };
}

async function operatorMapFor(operatorIds: Array<string | null | undefined>) {
  const ids = [...new Set(operatorIds.filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return new Map(users.map((u) => [u.id, u.name]));
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  return handle(async () => {
    const woNumber = req.nextUrl.searchParams.get("wo")?.trim();

    if (woNumber) {
      const wo = await db.workOrder.findUnique({ where: { woNumber: woNumber } });
      if (!wo) throw new ApiError(`Work order not found: ${woNumber}`, 404);
      const cards = await db.jobCard.findMany({ where: { woId: wo.id }, include: { step: true, wo: true }, orderBy: { sequence: "asc" } });
      const opMap = await operatorMapFor(cards.map((c) => c.operatorId));
      return ok({
        wo: { woNumber: wo.woNumber, status: wo.status, qtyPlanned: wo.qtyPlanned, qtyCompleted: wo.qtyCompleted, qtyScrapped: wo.qtyScrapped },
        cards: cards.map((c) => serializeCard(c as NonNullable<JobCardWithRel>, opMap)),
      });
    }

    // no WO chosen → all cards of IN_PROGRESS work orders
    const wos = await db.workOrder.findMany({ where: { status: "IN_PROGRESS" }, orderBy: { woNumber: "asc" } });
    const cards = await db.jobCard.findMany({
      where: { woId: { in: wos.map((w) => w.id) } },
      include: { step: true, wo: true },
      orderBy: [{ woId: "asc" }, { sequence: "asc" }],
    });
    const opMap = await operatorMapFor(cards.map((c) => c.operatorId));
    return ok({ cards: cards.map((c) => serializeCard(c as NonNullable<JobCardWithRel>, opMap)) });
  });
}

// ---------------------------------------------------------------------------
// POST — action
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    const b = await body<{ jobCardId?: string; action?: string; qtyGood?: number; qtyScrap?: number }>(req);
    if (!b.jobCardId || !b.action) throw new ApiError("jobCardId and action are required");

    const card = await loadCard(b.jobCardId);
    if (!card) throw new ApiError("Job card not found", 404);

    // Server rule: OPERATOR role may only act on cards bound to a real workstation.
    if (user?.role === "OPERATOR" && !card.workstationCode) {
      throw new ApiError("Operators can only execute job cards assigned to a workstation — this card has no workstation assigned", 403);
    }

    switch (b.action) {
      case "start":
        return start(user, card);
      case "pause":
        return pause(user, card);
      case "resume":
        return resume(user, card);
      case "complete":
        return complete(user, card, Number(b.qtyGood ?? 0), Number(b.qtyScrap ?? 0));
      default:
        throw new ApiError(`Unknown action: ${b.action}`, 400);
    }
  });
}

// ---------------------------------------------------------------------------
async function start(user: Awaited<ReturnType<typeof getSessionUser>>, card: NonNullable<JobCardWithRel>) {
  requirePerm(user, "production.execute");
  // Sequence enforcement first (spec message), then READY gate.
  const blockers = await db.jobCard.findMany({
    where: { woId: card.woId, sequence: { lt: card.sequence }, status: { not: "COMPLETED" }, step: { mandatory: true } },
    include: { step: true },
    orderBy: { sequence: "asc" },
  });
  if (blockers.length) {
    const fb = blockers[0];
    throw new ApiError(`Operation sequence enforced: complete step ${fb.sequence} (${fb.operationCode}) first`);
  }
  if (card.status !== "READY") {
    throw new ApiError(`Operation must be READY to start (current: ${card.status})`);
  }
  // DR-006 route qualification gate: the acting user must hold the skill the step requires.
  const skill = card.step.skillRequired;
  if (skill) {
    const held = parseJsonField<string[]>(user!.skillCodesJson, []);
    if (!held.includes(skill)) {
      await logAudit(user, "BLOCK", "JOB_CARD", `${card.wo.woNumber}/${card.operationCode}`, `Route qualification gate (DR-006): requires ${skill}; ${user!.username} holds [${held.join(", ") || "none"}]`);
      throw new ApiError(
        `Route qualification enforced (DR-006): ${card.operationCode} requires skill ${skill} — you hold [${held.join(", ") || "none"}]. Ask a supervisor/admin to update the skill matrix.`,
        403,
      );
    }
  }

  const now = new Date(); // server clock — clients cannot backdate postings
  await db.jobCard.update({ where: { id: card.id }, data: { status: "IN_PROGRESS", startedAt: now, operatorId: user!.id } });
  if (card.wo.status === "RELEASED") {
    await db.workOrder.update({ where: { id: card.woId }, data: { status: "IN_PROGRESS" } });
  }
  await db.travellerEvent.create({
    data: {
      woId: card.woId,
      kind: "OP_START",
      message: `${card.operationCode} started at ${card.workstationCode || "unassigned station"} by ${user!.name}${skill ? ` (skill ${skill} verified)` : ""} (server timestamp ${now.toISOString()})`,
      userName: user!.username,
      payloadJson: JSON.stringify({ jobCardId: card.id, operationCode: card.operationCode, sequence: card.sequence, skillVerified: skill || null }),
    },
  });
  await logAudit(user, "START", "JOB_CARD", `${card.wo.woNumber}/${card.operationCode}`, `startedAt=${now.toISOString()} (server clock — backdating impossible)${skill ? ` · skill ${skill} verified` : ""}`);
  return ok({ jobCardId: card.id, status: "IN_PROGRESS", startedAt: now.toISOString() });
}

async function pause(user: Awaited<ReturnType<typeof getSessionUser>>, card: NonNullable<JobCardWithRel>) {
  requirePerm(user, "production.execute");
  if (card.status !== "IN_PROGRESS") throw new ApiError(`Only IN_PROGRESS operations can be paused (current: ${card.status})`);
  await db.jobCard.update({ where: { id: card.id }, data: { status: "PAUSED" } });
  await db.travellerEvent.create({
    data: {
      woId: card.woId, kind: "OP_PAUSE",
      message: `${card.operationCode} paused by ${user!.name} at ${card.workstationCode}`,
      userName: user!.username,
    },
  });
  await logAudit(user, "PAUSE", "JOB_CARD", `${card.wo.woNumber}/${card.operationCode}`, `paused (server timestamp)`);
  return ok({ jobCardId: card.id, status: "PAUSED" });
}

async function resume(user: Awaited<ReturnType<typeof getSessionUser>>, card: NonNullable<JobCardWithRel>) {
  requirePerm(user, "production.execute");
  if (card.status !== "PAUSED") throw new ApiError(`Only PAUSED operations can be resumed (current: ${card.status})`);
  // DR-006: whoever continues the operation must hold the step's skill too.
  const skill = card.step.skillRequired;
  if (skill) {
    const held = parseJsonField<string[]>(user!.skillCodesJson, []);
    if (!held.includes(skill)) {
      await logAudit(user, "BLOCK", "JOB_CARD", `${card.wo.woNumber}/${card.operationCode}`, `Route qualification gate (DR-006, resume): requires ${skill}; ${user!.username} holds [${held.join(", ") || "none"}]`);
      throw new ApiError(
        `Route qualification enforced (DR-006): resuming ${card.operationCode} requires skill ${skill} — you hold [${held.join(", ") || "none"}].`,
        403,
      );
    }
  }
  await db.jobCard.update({ where: { id: card.id }, data: { status: "IN_PROGRESS" } });
  await db.travellerEvent.create({
    data: {
      woId: card.woId, kind: "OP_RESUME",
      message: `${card.operationCode} resumed by ${user!.name} at ${card.workstationCode}${skill ? ` (skill ${skill} verified)` : ""}`,
      userName: user!.username,
    },
  });
  await logAudit(user, "RESUME", "JOB_CARD", `${card.wo.woNumber}/${card.operationCode}`, `resumed (server timestamp)${skill ? ` · skill ${skill} verified` : ""}`);
  return ok({ jobCardId: card.id, status: "IN_PROGRESS" });
}

async function complete(
  user: Awaited<ReturnType<typeof getSessionUser>>,
  card: NonNullable<JobCardWithRel>,
  qtyGood: number,
  qtyScrap: number,
) {
  requirePerm(user, "production.execute");
  if (card.status !== "IN_PROGRESS") {
    throw new ApiError(`Only IN_PROGRESS job cards can be completed (current: ${card.status})`);
  }
  if (!Number.isFinite(qtyGood) || !Number.isFinite(qtyScrap) || qtyGood < 0 || qtyScrap < 0) {
    throw new ApiError("qtyGood and qtyScrap must be non-negative numbers");
  }
  if (qtyGood + qtyScrap <= 0) throw new ApiError("Report at least one good or scrapped unit");

  const woFresh = await db.workOrder.findUnique({ where: { id: card.woId } });
  const remaining = (woFresh?.qtyPlanned ?? 0) - (woFresh?.qtyCompleted ?? 0) - (woFresh?.qtyScrapped ?? 0);
  if (qtyGood + qtyScrap > remaining) {
    throw new ApiError(`Reported qty (${qtyGood + qtyScrap}) exceeds remaining WO quantity (${remaining})`);
  }

  const now = new Date(); // server clock only
  await db.jobCard.update({
    where: { id: card.id },
    data: { status: "COMPLETED", completedAt: now, qtyGood, qtyScrap },
  });
  await db.workOrder.update({ where: { id: card.woId }, data: { qtyScrapped: { increment: qtyScrap } } });

  // release the next card in sequence
  const next = await db.jobCard.findFirst({
    where: { woId: card.woId, sequence: { gt: card.sequence }, status: "PENDING" },
    orderBy: { sequence: "asc" },
  });
  if (next) await db.jobCard.update({ where: { id: next.id }, data: { status: "READY" } });

  await db.travellerEvent.create({
    data: {
      woId: card.woId, kind: "OP_COMPLETE",
      message: `${card.operationCode} completed — good ${qtyGood}, scrap ${qtyScrap} (by ${user!.name}; server timestamp)`,
      userName: user!.username,
      payloadJson: JSON.stringify({ jobCardId: card.id, qtyGood, qtyScrap, nextCardId: next?.id ?? null }),
    },
  });
  await logAudit(user, "COMPLETE", "JOB_CARD", `${card.wo.woNumber}/${card.operationCode}`, `qtyGood=${qtyGood} qtyScrap=${qtyScrap} completedAt=${now.toISOString()} (server clock — backdating impossible)`);
  return ok({ jobCardId: card.id, status: "COMPLETED", qtyGood, qtyScrap, nextCardId: next?.id ?? null });
}
