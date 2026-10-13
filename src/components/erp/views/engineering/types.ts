// ============================================================================
// Tau ERP — Engineering module shared DTOs (mirror of API payloads)
// ============================================================================
export type Family = {
  id: string; code: string; name: string; description: string;
  evidenceClasses: string[]; routeBaseline: string[];
};

export type ItemDto = {
  id: string; partNumber: string; name: string; familyCode: string;
  itemType: string; uom: string; trackingType: string; criticality: string;
  unitCost: number; revision: string; lifecycle: string; hsnCode: string; gstRate: number;
  procLeadTimeDays?: number | null;
};

export type ItemsPayload = { items: ItemDto[]; families: Family[] };

export type BomLineDto = {
  id: string; componentItemId: string; qty: number; scrapPct: number; position: string;
  partNumber: string; componentName: string; uom: string; lifecycle: string;
};

export type BomDto = {
  id: string; itemId: string; revision: string; status: string;
  partNumber: string; itemName: string; familyCode: string;
  effectiveFrom: string | null; releasedBy: string; releasedAt: string | null;
  notes: string; lineCount: number; lines: BomLineDto[];
};

export type BomsPayload = { boms: BomDto[] };

export type RouteStepDto = {
  id: string; seq: number; operationCode: string; workstationKind: string;
  inspectionTemplateCode: string; mandatory: boolean; evidenceClass: string;
  description: string; skillRequired: string;
};

export type RouteDto = {
  id: string; familyCode: string; name: string; revision: string; status: string;
  effectiveFrom: string | null; releasedBy: string; releasedAt: string | null;
  notes: string; steps: RouteStepDto[];
};

export type RoutesPayload = { routes: RouteDto[] };

export type GateDto = {
  id: string; seq: number; name: string; deliverables: string; status: string;
  plannedDate: string | null; actualDate: string | null; evidence: string;
};

export type PpapDto = {
  id: string; number: string; level: number; status: string; pswNumber: string;
  submittedAt: string | null; disposition: string; evidence: string[];
};

export type ApqpProjectDto = {
  id: string; number: string; title: string; status: string;
  itemId: string; partNumber: string; itemName: string;
  customerCode: string; customerName: string; programme: string;
  startDate: string | null; targetDate: string | null;
  gates: GateDto[]; ppap: PpapDto[];
};

export type ApqpPayload = { projects: ApqpProjectDto[] };

export type EcoDto = {
  id: string; number: string; kind: string; title: string; reason: string;
  status: string; effectivity: string; effectivityDate: string | null;
  requestedBy: string; approvedBy: string; createdAt: string;
  impact: Record<string, unknown>;
};

export type EcoPayload = { changes: EcoDto[] };
