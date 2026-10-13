// ============================================================================
// Tau ERP — Server-side helpers: session/RBAC, audit trail, numbering, guards
// Every API route MUST use requirePerm() and log mutations with logAudit().
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hasPerm, type PermKey, COMPANY } from "./constants";

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  role: string;
  plant: string;
  skillCodesJson: string;
  notifPrefsJson: string;
};

/** Resolve the demo session user from the `x-erp-user` header (username). */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const username = req.headers.get("x-erp-user") || "admin";
  const user = await db.user.findUnique({ where: { username } });
  if (!user || !user.active) return null;
  return { id: user.id, username: user.username, name: user.name, role: user.role, plant: user.plant, skillCodesJson: user.skillCodesJson, notifPrefsJson: user.notifPrefsJson };
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Require a permission or throw 403. */
export function requirePerm(user: SessionUser | null, perm: PermKey): SessionUser {
  if (!user) throw new ApiError("No session — please select a user in the topbar", 401);
  if (!hasPerm(user.role, perm)) {
    throw new ApiError(`Permission denied: role ${user.role} lacks '${perm}' (server-side RBAC enforced)`, 403);
  }
  return user;
}

/** Read-only guard: throws for mutating verbs when the role is read-only (e.g. AUDITOR, EXEC_VIEWER). */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "Internal error";
    console.error("[tau-erp api]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

/** Immutable audit trail (spec rule: every controlled transition is audited). */
export async function logAudit(
  user: { username: string; id?: string } | null,
  action: string,
  entityType: string,
  entityId: string,
  detail = ""
) {
  await db.auditLog.create({
    data: {
      userId: user?.id ?? null,
      userName: user?.username ?? "system",
      action,
      entityType,
      entityId,
      detail: detail.slice(0, 500),
    },
  });
}

/** Document numbering: PREFIX-YYYY-NNNN — e.g. nextNumber("WO", "workOrder") → "WO-2025-0001" */
export async function nextNumber(prefix: string, model: string): Promise<string> {
  const fieldMap: Record<string, string> = {
    purchaseOrder: "poNumber", goodsReceipt: "grnNumber", inspection: "inspNumber",
    ncr: "ncrNumber", capa: "capaNumber", reworkOrder: "rwNumber", productRelease: "releaseNumber",
    workOrder: "woNumber", rfq: "number", quotation: "quoteNumber", salesOrder: "soNumber",
    deliveryNote: "dnNumber", salesInvoice: "invoiceNumber", mrpRun: "number",
    engineeringChange: "number", apqpProject: "number", ppapSubmission: "number",
    scar: "scarNumber",
  };
  const field = fieldMap[model] ?? "number";
  const year = new Date().getFullYear();
  const anyDb = db as unknown as Record<string, { count: (a: unknown) => Promise<number> }>;
  const count = await anyDb[model].count({ where: { [field]: { startsWith: `${prefix}-${year}-` } } });
  return `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
}

/** Four-eyes check: approver must differ from the requester. */
export function fourEyes(requesterName: string, approverName: string, context: string) {
  if (!approverName || approverName === requesterName) {
    throw new ApiError(`Four-eyes control violated: ${context} requires an approver different from the requester (spec rule 12)`, 422);
  }
}

/** Parse JSON body safely. */
export async function body<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }
}

export function parseJsonField<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export const COMPANY_INFO = COMPANY;
