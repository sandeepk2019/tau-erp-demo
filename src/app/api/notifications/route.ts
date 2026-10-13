// ============================================================================
// Tau ERP — /api/notifications — role/user-scoped notification feed + per-user
// delivery preferences (round-8: digest/preference per user).
// GET   : visible = userId == me OR (userId == null AND (role == "" OR role == myRole)),
//         then filtered server-side by the session user's saved preferences
//         (muted kinds + minimum severity). ?includeMuted=1 returns the full
//         stored feed with muted flags for the notifications management tab.
// PATCH : mark a visible notification read (sets readAt).
// POST  : mark ALL visible notifications read (bulk).
// PUT   : save per-user notification preferences {mutedKinds, minSeverity, digest}
//         (validated + audited — NOTIFICATION_PREFS).
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, handle, getSessionUser, logAudit, ok, parseJsonField } from "@/lib/erp/server";

export const NOTIF_KINDS = ["QUALITY", "INFO", "INTEGRATION", "SKILL_MATRIX", "CALIB"] as const;
export const NOTIF_SEV_FLOORS = ["ALL", "WARNING", "CRITICAL"] as const;

export type NotifPrefs = {
  mutedKinds: string[];
  minSeverity: (typeof NOTIF_SEV_FLOORS)[number];
  digest: boolean;
};

const SEV_RANK: Record<string, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

/** Parse + sanitize the stored prefs JSON (tolerates legacy/empty values). */
export function parseNotifPrefs(raw: string | null | undefined): NotifPrefs {
  const p = parseJsonField<Partial<NotifPrefs>>(raw, {});
  const mutedKinds = Array.isArray(p.mutedKinds) ? p.mutedKinds.filter((k): k is string => typeof k === "string" && (NOTIF_KINDS as readonly string[]).includes(k)) : [];
  const minSeverity = (NOTIF_SEV_FLOORS as readonly string[]).includes(String(p.minSeverity)) ? (p.minSeverity as NotifPrefs["minSeverity"]) : "ALL";
  const digest = p.digest === true;
  return { mutedKinds, minSeverity, digest };
}

function visibilityClause(userId: string, role: string) {
  return {
    OR: [{ userId }, { userId: null, OR: [{ role: "" }, { role }] }],
  };
}

/** A notification passes the user's preferences? */
function passesPrefs(n: { kind: string; severity: string }, prefs: NotifPrefs) {
  if (prefs.mutedKinds.includes(n.kind)) return false;
  const floor = prefs.minSeverity === "ALL" ? 0 : SEV_RANK[prefs.minSeverity] ?? 0;
  return (SEV_RANK[n.severity] ?? 0) >= floor;
}

/** GET /api/notifications — preference-filtered feed (or full feed with ?includeMuted=1). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session — please select a user in the topbar", 401);
    const includeMuted = req.nextUrl.searchParams.get("includeMuted") === "1";
    const prefs = parseNotifPrefs(user.notifPrefsJson);

    const all = await db.notification.findMany({
      where: visibilityClause(user.id, user.role),
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });
    const visible = includeMuted ? all : all.filter((n) => passesPrefs(n, prefs));
    const unread = visible.filter((n) => !n.readAt).length;
    const hiddenCount = all.filter((n) => !passesPrefs(n, prefs)).length;
    // muted flag is only meaningful in the includeMuted management view; the
    // bell/prefiltered feed always sees muted=false rows.
    const notifications = visible.map((n) => ({ ...n, muted: !passesPrefs(n, prefs) }));
    return ok({ notifications, unread, hiddenCount, totalStored: all.length, prefs });
  });
}

/** PATCH /api/notifications — mark one notification as read. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session — please select a user in the topbar", 401);
    const b = await body<{ id?: string }>(req);
    const id = String(b.id ?? "");
    const visible = await db.notification.findFirst({ where: { id, ...visibilityClause(user.id, user.role) } });
    if (!visible) throw new ApiError("Notification not found for this session user", 404);
    if (!visible.readAt) await db.notification.update({ where: { id: visible.id }, data: { readAt: new Date() } });
    const notification = await db.notification.findUnique({ where: { id: visible.id } });
    return ok({ notification });
  });
}

/** POST /api/notifications — mark ALL visible notifications read (bulk). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session — please select a user in the topbar", 401);
    const prefs = parseNotifPrefs(user.notifPrefsJson);
    const all = await db.notification.findMany({
      where: { ...visibilityClause(user.id, user.role), readAt: null },
      select: { id: true, kind: true, severity: true },
    });
    const ids = all.filter((n) => passesPrefs(n, prefs)).map((n) => n.id);
    if (ids.length) await db.notification.updateMany({ where: { id: { in: ids } }, data: { readAt: new Date() } });
    return ok({ updated: ids.length, skippedMuted: all.length - ids.length });
  });
}

/** PUT /api/notifications — save this user's notification preferences (audited). */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session — please select a user in the topbar", 401);
    const b = await body<{ mutedKinds?: unknown; minSeverity?: unknown; digest?: unknown }>(req);

    const mutedKinds = Array.isArray(b.mutedKinds)
      ? [...new Set(b.mutedKinds.filter((k): k is string => typeof k === "string" && (NOTIF_KINDS as readonly string[]).includes(k)))]
      : [];
    if (Array.isArray(b.mutedKinds) && b.mutedKinds.length !== mutedKinds.length) {
      throw new ApiError(`Unknown notification kind — allowed: ${NOTIF_KINDS.join(", ")}`, 422);
    }
    const minSeverity = (NOTIF_SEV_FLOORS as readonly string[]).includes(String(b.minSeverity))
      ? (String(b.minSeverity) as NotifPrefs["minSeverity"])
      : undefined;
    if (b.minSeverity !== undefined && !minSeverity) throw new ApiError("minSeverity must be ALL | WARNING | CRITICAL", 422);
    if (b.digest !== undefined && typeof b.digest !== "boolean") throw new ApiError("digest must be boolean", 422);

    const prev = parseNotifPrefs(user.notifPrefsJson);
    const prefs: NotifPrefs = {
      mutedKinds,
      minSeverity: minSeverity ?? prev.minSeverity,
      digest: b.digest === undefined ? prev.digest : b.digest,
    };
    await db.user.update({ where: { id: user.id }, data: { notifPrefsJson: JSON.stringify(prefs) } });
    await logAudit(
      { id: user.id, username: user.username }, "UPDATE", "NOTIFICATION_PREFS", user.username,
      `muted=[${prefs.mutedKinds.join("|")}] minSeverity=${prefs.minSeverity} digest=${prefs.digest}`,
    );
    return ok({ prefs });
  });
}
