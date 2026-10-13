// ============================================================================
// Tau ERP — Inventory & Traceability (Task 3-c)
// /api/containers
//   GET  — containers with packed serials (+ DN/SO/customer context). Session.
//   POST — create container + pack serials. Perm: inventory.move. Audited.
//          Container number auto CTN-YYYY-NNNN (direct count on Container —
//          nextNumber() fieldMap has no 'container' key, so we count here).
// Body: { kind: "BOX"|"PALLET", lots: string[] /* lotNumbers */ }
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, requirePerm, handle, ok, body, logAudit, ApiError } from "@/lib/erp/server";

type CtnBody = { kind?: string; lots?: unknown };

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session — please select a user in the topbar", 401);

    const containers = await db.container.findMany({
      include: {
        members: {
          include: {
            lot: { include: { item: { select: { partNumber: true, name: true, itemType: true } } } },
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: { containerNumber: "desc" },
    });

    // Resolve DN → SO → customer names for shipping context (no Prisma relation on SalesOrder.customerId)
    const dnNumbers = containers.map((c) => c.dnNumber).filter(Boolean);
    const dns = dnNumbers.length
      ? await db.deliveryNote.findMany({ where: { dnNumber: { in: dnNumbers } }, include: { lines: { select: { lotNumber: true } } } })
      : [];
    const soIds = [...new Set(dns.map((d) => d.soId))];
    const sos = soIds.length ? await db.salesOrder.findMany({ where: { id: { in: soIds } } }) : [];
    const customerIds = [...new Set(sos.map((s) => s.customerId))];
    const customers = customerIds.length ? await db.customer.findMany({ where: { id: { in: customerIds } } }) : [];

    const dnByNumber = new Map(dns.map((d) => [d.dnNumber, d]));
    const soById = new Map(sos.map((s) => [s.id, s]));
    const custById = new Map(customers.map((c) => [c.id, c]));

    return ok({
      containers: containers.map((c) => {
        const dn = c.dnNumber ? dnByNumber.get(c.dnNumber) : undefined;
        const so = dn ? soById.get(dn.soId) : undefined;
        const cust = so ? custById.get(so.customerId) : undefined;
        return {
          id: c.id,
          containerNumber: c.containerNumber,
          kind: c.kind,
          status: c.status,
          dnNumber: c.dnNumber,
          soNumber: so?.soNumber ?? "",
          customerName: cust?.name ?? "",
          memberCount: c.members.length,
          members: c.members.map((m) => ({
            id: m.id,
            lotNumber: m.lot.lotNumber,
            itemPartNumber: m.lot.item.partNumber,
            itemName: m.lot.item.name,
            lotStatus: m.lot.status,
          })),
          dnLines: dn ? dn.lines.map((l) => l.lotNumber) : [],
        };
      }),
      total: containers.length,
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requirePerm(await getSessionUser(req), "inventory.move");
    const b = await body<CtnBody>(req);

    const kind = (b.kind ?? "BOX").toUpperCase();
    if (!["BOX", "PALLET"].includes(kind)) throw new ApiError("Container kind must be BOX or PALLET", 422);

    const lotNumbers = Array.isArray(b.lots)
      ? [...new Set((b.lots as unknown[]).map((v) => String(v).trim()).filter(Boolean))]
      : [];
    if (lotNumbers.length === 0) throw new ApiError("Provide at least one serial/batch to pack (lots[])", 422);

    // Lot existence check — fail clearly with the offending code
    const lots = await db.stockLot.findMany({ where: { lotNumber: { in: lotNumbers } } });
    const found = new Set(lots.map((l) => l.lotNumber));
    const missing = lotNumbers.filter((n) => !found.has(n));
    if (missing.length) throw new ApiError(`Unknown serial/batch: ${missing.join(", ")}`, 404);

    // A serial may live in only ONE container — reject with the blocking container id
    const existingMembers = await db.containerMember.findMany({
      where: { lotId: { in: lots.map((l) => l.id) } },
      include: { container: { select: { containerNumber: true } } },
    });
    if (existingMembers.length) {
      const dup = existingMembers[0];
      throw new ApiError(
        `Serial already packed in ${dup.container.containerNumber}: ${lots.find((l) => l.id === dup.lotId)?.lotNumber ?? dup.lotId} (a serial can exist in only one container)`,
        409,
      );
    }

    // CTN numbering: nextNumber() has no 'container' fieldMap entry → direct count query
    const year = new Date().getFullYear();
    const count = await db.container.count({ where: { containerNumber: { startsWith: `CTN-${year}-` } } });
    const containerNumber = `CTN-${year}-${String(count + 1).padStart(4, "0")}`;

    const created = await db.$transaction(async (tx) => {
      const ctn = await tx.container.create({ data: { containerNumber, kind, status: "OPEN", dnNumber: "" } });
      await tx.containerMember.createMany({
        data: lots.map((l) => ({ containerId: ctn.id, lotId: l.id })),
      });
      return ctn;
    });

    await logAudit(
      user,
      "CREATE",
      "Container",
      created.containerNumber,
      `${kind} created and packed ${lotNumbers.length} lot(s): ${lotNumbers.join(", ").slice(0, 380)}`,
    );

    return ok({ container: { id: created.id, containerNumber: created.containerNumber, kind, status: created.status, packed: lotNumbers.length } }, 201);
  });
}
