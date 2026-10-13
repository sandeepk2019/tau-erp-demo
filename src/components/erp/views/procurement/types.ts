// ============================================================================
// Tau ERP — Procurement module (Task 3-b): shared row types for API payloads.
// Dates arrive as ISO strings over JSON; numeric Prisma fields as numbers.
// ============================================================================

export type ScarStats = { total: number; active: number; overdue: number; closed: number; byMonth: number[] };

export type SupplierRow = {
  id: string; code: string; name: string; gstin: string; city: string;
  category: string; // CRITICAL | STANDARD
  approved: boolean; approvedDate: string | null;
  rating: number; ppm: number; onTimePct: number; notes: string; poCount: number;
  scarStats: ScarStats;
};

export type ItemMaster = {
  id: string; partNumber: string; name: string; uom: string;
  trackingType: string; // SERIAL | BATCH | NONE
  criticality: string; // CRITICAL | STANDARD
  unitCost: number; gstRate: number; itemType: string; familyCode: string;
  lifecycle?: string;
};

export type QuotationRow = {
  id: string; rfqId: string; supplierId: string;
  unitPrice: number; leadTimeDays: number; moq: number;
  selected: boolean; status: string; // RECEIVED | SELECTED | REJECTED
  supplier: { code: string; name: string; approved: boolean; rating: number };
};

export type RfqRow = {
  id: string; number: string; itemId: string; qty: number; dueDate: string | null;
  status: string; // OPEN | QUOTED | AWARDED | CLOSED
  item: { partNumber: string; name: string; uom: string; criticality: string; itemType: string };
  quotations: QuotationRow[];
};

export type PoLineRow = {
  id: string; itemId: string; qty: number; receivedQty: number; unitPrice: number; gstRate: number;
  item: { partNumber: string; name: string; uom: string; trackingType: string; criticality: string; gstRate: number };
};

export type PoRow = {
  id: string; poNumber: string; status: string; // DRAFT | PENDING_APPROVAL | APPROVED | PARTIAL | RECEIVED | CLOSED | CANCELLED
  orderDate: string; expectedDate: string | null; totalAmount: number; currency: string;
  approvedBy: string;
  supplier: { code: string; name: string; approved: boolean; city: string };
  lines: PoLineRow[];
  receipts: { id: string; grnNumber: string; status: string; receivedAt: string }[];
};

export type InspRow = {
  id: string; inspNumber: string; status: string; // PENDING | PASSED | FAILED | HOLD
  templateCode: string; overallResult: string; equipmentCode: string;
  resultsJson: string; submittedAt: string | null; immutable: boolean;
};

export type GrnLineRow = {
  id: string; poLineId: string | null; itemId: string; qty: number;
  supplierBatch: string; manufacturerRef: string; disposition: string; // PENDING_IQC | ACCEPTED | REJECTED | HOLD
  item: { partNumber: string; name: string; uom: string; trackingType: string; criticality: string };
  inspections: InspRow[];
};

export type GrnRow = {
  id: string; grnNumber: string; receivedBy: string; receivedAt: string; status: string; remarks: string;
  po: { poNumber: string } | null;
  supplier: { code: string; name: string };
  lines: GrnLineRow[];
};

export type InspTemplateParam = { name: string; unit?: string; lower?: number; upper?: number };

export type InspTemplate = {
  id: string; code: string; name: string; kind: string; params: InspTemplateParam[];
};

export type ReceiptsPayload = { receipts: GrnRow[]; templates: InspTemplate[] };

export const openQty = (l: { qty: number; receivedQty: number }) => Math.max(0, l.qty - l.receivedQty);
