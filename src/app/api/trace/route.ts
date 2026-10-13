// ============================================================================
// Tau ERP — Inventory & Traceability (Task 3-c) — THE FLAGSHIP ENDPOINT
// GET /api/trace?lot=SN-NOX-25-0003
//   backward tree : GenealogyLink parent→children (FG serial → subassemblies →
//                   raw batches, with supplierBatch + GRN ref via grnLineId)
//   forward tree  : GenealogyLink child→parents (raw batch → FG serials) plus
//                   shipping chain: Container → DeliveryLine dnNumber → soNumber
//   recall impact : reachable shipped serials + affected customers + DN refs
//   quality events: inspections + NCRs bound to the root lotNumber
// Recursion is done level-by-level with `in` queries (no N+1; demo-scale safe).
// NO deletion endpoints exist for genealogy links (spec release blocker).
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, handle, ok, ApiError } from "@/lib/erp/server";

const MAX_DEPTH = 12; // safety guard — demo data is ≤3 levels

type LotRow = {
  id: string; lotNumber: string; status: string; warehouseCode: string; qty: number;
  trackingType: string; supplierBatch: string; grnLineId: string | null; woNumber: string;
  item: { partNumber: string; name: string; itemType: string; trackingType: string };
};

type TraceNode = {
  lotId: string; lotNumber: string; status: string; warehouseCode: string; qty: number;
  nodeKind: "FG_SERIAL" | "SUBASSEMBLY" | "RAW_BATCH" | "LOT";
  item: { partNumber: string; name: string; itemType: string; trackingType: string };
  supplierBatch: string; grnLineId: string | null; grnNumber: string; woNumber: string; operationCode: string;
  linkQty: number;
  shipping: { containerNumber: string; dnNumber: string; soNumber: string; customerName: string }[];
  children: TraceNode[];
};

function nodeKindOf(l: LotRow): TraceNode["nodeKind"] {
  if (l.item.itemType === "FINISHED") return "FG_SERIAL";
  if (l.item.itemType === "RAW" || l.item.itemType === "CONSUMABLE") return "RAW_BATCH";
  if (l.item.itemType === "SUBASSEMBLY") return "SUBASSEMBLY";
  return "LOT";
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session — please select a user in the topbar", 401);

    const { searchParams } = new URL(req.url);
    const code = (searchParams.get("lot") ?? "").trim();
    if (!code) throw new ApiError("Provide ?lot=<serial or batch number>", 422);

    const root = await db.stockLot.findFirst({
      where: { lotNumber: { equals: code } },
      include: { item: { select: { partNumber: true, name: true, itemType: true, trackingType: true } } },
    });
    if (!root) throw new ApiError(`Unknown serial/batch: ${code} — scan a valid lot number (e.g. SN-NOX-25-0001)`, 404);

    const rootRow: LotRow = {
      id: root.id, lotNumber: root.lotNumber, status: root.status, warehouseCode: root.warehouseCode,
      qty: root.qty, trackingType: root.trackingType, supplierBatch: root.supplierBatch,
      grnLineId: root.grnLineId, woNumber: root.woNumber, item: root.item,
    };

    const toRow = (l: {
      id: string; lotNumber: string; status: string; warehouseCode: string; qty: number; trackingType: string;
      supplierBatch: string; grnLineId: string | null; woNumber: string;
      item: { partNumber: string; name: string; itemType: string; trackingType: string };
    }): LotRow => ({
      id: l.id, lotNumber: l.lotNumber, status: l.status, warehouseCode: l.warehouseCode, qty: l.qty,
      trackingType: l.trackingType, supplierBatch: l.supplierBatch, grnLineId: l.grnLineId,
      woNumber: l.woNumber, item: l.item,
    });

    const makeNode = (row: LotRow, link: { operationCode: string; woNumber: string; quantity: number }): TraceNode => ({
      lotId: row.id, lotNumber: row.lotNumber, status: row.status, warehouseCode: row.warehouseCode,
      qty: row.qty, nodeKind: nodeKindOf(row), item: row.item, supplierBatch: row.supplierBatch,
      grnLineId: row.grnLineId, grnNumber: "", // patched once after traversal (single GRN query)
      woNumber: link.woNumber || row.woNumber, operationCode: link.operationCode, linkQty: link.quantity,
      shipping: [], children: [],
    });

    const emptyLink = { operationCode: "", woNumber: "", quantity: 0 };

    /** Patch grnNumber on every node after traversal — one batched GRN query, no N+1. */
    async function patchGrnNumbers(n: TraceNode): Promise<void> {
      const ids = new Set<string>();
      const walk = (x: TraceNode) => { if (x.grnLineId) ids.add(x.grnLineId); for (const c of x.children) walk(c); };
      walk(n);
      if (!ids.size) return;
      const lines = await db.grnLine.findMany({ where: { id: { in: [...ids] } }, include: { grn: { select: { grnNumber: true } } } });
      const map = new Map(lines.map((g) => [g.id, g.grn.grnNumber]));
      const apply = (x: TraceNode) => {
        if (x.grnLineId) x.grnNumber = map.get(x.grnLineId) ?? "";
        for (const c of x.children) apply(c);
      };
      apply(n);
    }

    // ---------------------------------------------------------------- BACKWARD (parent→children)
    async function buildBackward(): Promise<TraceNode> {
      const rootNode = makeNode(rootRow, emptyLink);
      const visited = new Set<string>([rootRow.id]);

      type Pending = { node: TraceNode; lotId: string; depth: number };
      let frontier: Pending[] = [{ node: rootNode, lotId: rootRow.id, depth: 0 }];

      while (frontier.length) {
        const depth = frontier[0].depth;
        if (depth >= MAX_DEPTH) break;
        const ids = frontier.map((f) => f.lotId);
        const links = await db.genealogyLink.findMany({ where: { parentLotId: { in: ids } } });
        if (!links.length) break;

        const childIds = [...new Set(links.map((l) => l.childLotId).filter((id) => !visited.has(id)))];
        if (!childIds.length) break;
        const childLots = await db.stockLot.findMany({
          where: { id: { in: childIds } },
          include: { item: { select: { partNumber: true, name: true, itemType: true, trackingType: true } } },
        });
        const lotById = new Map(childLots.map((l) => [l.id, l]));
        const nodesById = new Map<string, TraceNode>();
        for (const id of childIds) {
          const row = lotById.get(id);
          if (row) {
            visited.add(id);
            nodesById.set(id, makeNode(toRow(row), emptyLink));
          }
        }
        const next: Pending[] = [];
        for (const f of frontier) {
          for (const link of links.filter((l) => l.parentLotId === f.lotId)) {
            const childNode = nodesById.get(link.childLotId);
            if (!childNode) continue;
            childNode.operationCode = link.operationCode;
            childNode.woNumber = link.woNumber || childNode.woNumber;
            childNode.linkQty = link.quantity;
            f.node.children.push(childNode);
            next.push({ node: childNode, lotId: link.childLotId, depth: depth + 1 });
          }
        }
        frontier = next;
      }
      return rootNode;
    }

    // ---------------------------------------------------------------- FORWARD (child→parents) + shipping chain
    const shippingByLot = new Map<string, TraceNode["shipping"]>();
    const shippedSerials: { lotNumber: string; itemPartNumber: string; dnNumber: string; soNumber: string; customerName: string }[] = [];
    const customerNames = new Set<string>();
    const dnNumbersHit = new Set<string>();

    async function buildForward(): Promise<TraceNode> {
      // Shipping chain for root + every reachable lot: container → DN → SO → customer
      const allReachable = new Set<string>([rootRow.id]);

      const rootNode = makeNode(rootRow, emptyLink);
      const visited = new Set<string>([rootRow.id]);
      type Pending = { node: TraceNode; lotId: string; depth: number };
      let frontier: Pending[] = [{ node: rootNode, lotId: rootRow.id, depth: 0 }];

      while (frontier.length) {
        const depth = frontier[0].depth;
        if (depth >= MAX_DEPTH) break;
        const ids = frontier.map((f) => f.lotId);
        const links = await db.genealogyLink.findMany({ where: { childLotId: { in: ids } } });
        if (!links.length) break;
        const parentIds = [...new Set(links.map((l) => l.parentLotId).filter((id) => !visited.has(id)))];
        if (!parentIds.length) break;
        const parentLots = await db.stockLot.findMany({
          where: { id: { in: parentIds } },
          include: { item: { select: { partNumber: true, name: true, itemType: true, trackingType: true } } },
        });
        const lotById = new Map(parentLots.map((l) => [l.id, l]));
        const nodesById = new Map<string, TraceNode>();
        for (const id of parentIds) {
          const row = lotById.get(id);
          if (row) {
            visited.add(id);
            allReachable.add(id);
            nodesById.set(id, makeNode(toRow(row), emptyLink));
          }
        }
        const next: Pending[] = [];
        for (const f of frontier) {
          for (const link of links.filter((l) => l.childLotId === f.lotId)) {
            const pNode = nodesById.get(link.parentLotId);
            if (!pNode) continue;
            pNode.operationCode = link.operationCode;
            pNode.woNumber = link.woNumber || pNode.woNumber;
            pNode.linkQty = link.quantity;
            f.node.children.push(pNode);
            next.push({ node: pNode, lotId: link.parentLotId, depth: depth + 1 });
          }
        }
        frontier = next;
      }

      // Containers + DN + SO + customer for ALL reachable lots (one query each)
      const members = await db.containerMember.findMany({
        where: { lotId: { in: [...allReachable] } },
        include: { container: { select: { containerNumber: true, dnNumber: true, status: true } } },
      });
      const dnNumbers = [...new Set(members.map((m) => m.container.dnNumber).filter(Boolean))];

      const dns = dnNumbers.length
        ? await db.deliveryNote.findMany({
            where: { dnNumber: { in: dnNumbers } },
            include: { lines: { select: { lotNumber: true } } },
          })
        : [];
      const dnByNumber = new Map(dns.map((d) => [d.dnNumber, d]));
      const soIds = [...new Set(dns.map((d) => d.soId))];
      const sos = soIds.length ? await db.salesOrder.findMany({ where: { id: { in: soIds } } }) : [];
      const soById = new Map(sos.map((s) => [s.id, s]));
      const customerIds = [...new Set(sos.map((s) => s.customerId))];
      const customers = customerIds.length ? await db.customer.findMany({ where: { id: { in: customerIds } } }) : [];
      const custById = new Map(customers.map((c) => [c.id, c]));

      // map lotId → lotNumber for DN-line matching (DeliveryLine stores lotNumber, not lotId)
      const lotRows = allReachable.size
        ? await db.stockLot.findMany({
            where: { id: { in: [...allReachable] } },
            select: { id: true, lotNumber: true, status: true, item: { select: { partNumber: true } } },
          })
        : [];
      const lotNumberById = new Map(lotRows.map((r) => [r.id, r.lotNumber]));
      const partByLotNumber = new Map(lotRows.map((r) => [r.lotNumber, r.item.partNumber]));

      for (const m of members) {
        const lotNumber = lotNumberById.get(m.lotId) ?? "";
        const dn = m.container.dnNumber ? dnByNumber.get(m.container.dnNumber) : undefined;
        const so = dn ? soById.get(dn.soId) : undefined;
        const cust = so ? custById.get(so.customerId) : undefined;
        const entry = {
          containerNumber: m.container.containerNumber,
          dnNumber: dn?.dnNumber ?? "",
          soNumber: so?.soNumber ?? "",
          customerName: cust?.name ?? "",
        };
        if (!shippingByLot.has(m.lotId)) shippingByLot.set(m.lotId, []);
        shippingByLot.get(m.lotId)!.push(entry);
        if (dn) dnNumbersHit.add(dn.dnNumber);
        if (cust) customerNames.add(cust.name);
      }
      // DNs can also reference the lot directly via DeliveryLine.lotNumber (even without container)
      const dnLineHits = dns.filter((d) => d.lines.some((l) => l.lotNumber === rootRow.lotNumber));
      for (const d of dnLineHits) {
        dnNumbersHit.add(d.dnNumber);
        const so = soById.get(d.soId);
        const cust = so ? custById.get(so.customerId) : undefined;
        if (cust) customerNames.add(cust.name);
      }

      // attach shipping to every node in the forward tree + root
      const attach = (n: TraceNode) => {
        n.shipping = shippingByLot.get(n.lotId) ?? [];
        for (const c of n.children) attach(c);
      };
      attach(rootNode);

      // recall impact — reachable lots that are shipped serials
      const pushed = new Set<string>();
      const pushShipped = (lotNumber: string, dnNumber: string, soNumber: string, customerName: string) => {
        const key = `${lotNumber}|${dnNumber}`;
        if (pushed.has(key)) return;
        pushed.add(key);
        shippedSerials.push({ lotNumber, itemPartNumber: partByLotNumber.get(lotNumber) ?? "", dnNumber, soNumber, customerName });
      };
      for (const r of lotRows) {
        if (r.status !== "SHIPPED") continue;
        const ship = shippingByLot.get(r.id);
        if (ship && ship.length) {
          for (const s of ship) pushShipped(r.lotNumber, s.dnNumber, s.soNumber, s.customerName);
        } else {
          // shipped without container membership — fall back to DN lines
          for (const d of dnLineHits.filter((d) => d.lines.some((l) => l.lotNumber === r.lotNumber))) {
            const so = soById.get(d.soId);
            const cust = so ? custById.get(so.customerId) : undefined;
            pushShipped(r.lotNumber, d.dnNumber, so?.soNumber ?? "", cust?.name ?? "");
            dnNumbersHit.add(d.dnNumber);
            if (cust) customerNames.add(cust.name);
          }
        }
      }
      return rootNode;
    }

    // sequential — both traversals share the grnLineIds collector, then one GRN patch each
    const backward = await buildBackward();
    const forward = await buildForward();
    await Promise.all([patchGrnNumbers(backward), patchGrnNumbers(forward)]);

    // ---------------------------------------------------------------- quality events bound to root lot
    const [inspections, ncrs] = await Promise.all([
      db.inspection.findMany({
        where: { lotNumber: rootRow.lotNumber },
        select: { inspNumber: true, kind: true, status: true, attempt: true, overallResult: true, equipmentCode: true, submittedAt: true, retestReason: true },
        orderBy: { submittedAt: "desc" },
      }),
      db.ncr.findMany({
        where: { lotNumber: rootRow.lotNumber },
        select: { ncrNumber: true, severity: true, status: true, description: true, sourceRef: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const customersList = [...customerNames];
    return ok({
      query: code,
      root: { lotId: rootRow.id, lotNumber: rootRow.lotNumber, status: rootRow.status, warehouseCode: rootRow.warehouseCode, trackingType: rootRow.trackingType },
      backward,
      forward,
      impact: {
        shippedCount: shippedSerials.length,
        serials: shippedSerials,
        customers: customersList,
        dns: [...dnNumbersHit],
        recallRequired: shippedSerials.length > 0,
      },
      quality: { inspections, ncrs },
      generatedAt: new Date().toISOString(),
    });
  });
}
