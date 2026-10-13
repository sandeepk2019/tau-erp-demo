// ============================================================================
// Tau ERP — Tour catalogue (Interactive Product Tours)
// Every step targets a [data-tour="…"] attribute for stable anchoring.
// Tours with a `route` navigate there first (engine waits for the view to mount).
// ============================================================================

export type TourStep = {
  selector: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
};

export type TourDef = {
  id: string;
  title: string;
  description: string;
  /** hash-route the engine navigates to before starting (module tours) */
  route?: string;
  /** minutes label for the catalogue */
  minutes: number;
  roles: string;
  steps: TourStep[];
};

export const TOURS: TourDef[] = [
  {
    id: "getting-started",
    title: "Getting started",
    description: "The 60-second lap: brand bar, global search, alerts, RBAC session switcher, module rail and the audit footer.",
    minutes: 1,
    roles: "All users",
    steps: [
      { selector: '[data-tour="tour-logo"]', title: "Tau ERP — plant operating system", body: "You are in the Tau Power Electronics ERP demo: five sensor families (NOX, LAMBDA, DELTAP, EGT, UQS) from CRM to cash, on 100% synthetic data. Click the logo any time to return to the Dashboard.", placement: "bottom" },
      { selector: '[data-tour="tour-search"]', title: "Global search — Ctrl+K", body: "One box for everything: serials, work orders, NCRs, lots, POs, invoices. Results deep-link straight into the record — try it after the tour.", placement: "bottom" },
      { selector: '[data-tour="tour-bell"]', title: "Alerts that find you", body: "Role-targeted notifications: expedites, approvals waiting for you, overdue quality responses. Click an item to jump to the record it references.", placement: "bottom" },
      { selector: '[data-tour="tour-user"]', title: "Session user = RBAC demo", body: "Switch between 15 seeded personas (System Admin, Purchase Manager, Operator, QA Inspector…). Menus and actions change per role — the server enforces it on every request.", placement: "bottom" },
      { selector: '[data-tour="tour-nav"]', title: "Nine modules, one flow", body: "Engineering → Procurement → Inventory → Planning → Production → Quality → Sales, with Dashboard and Administration wrapping the value chain. This rail is the whole ERP.", placement: "right" },
      { selector: '[data-tour="tour-footer"]', title: "Compliance footer, always on", body: "Every controlled transition is written to an immutable audit trail; four-eyes approval is enforced where the policy demands it. The SYNTHETIC DATA tag reminds you nothing here is statutory.", placement: "top" },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard & exception radar",
    description: "KPIs, the expedite/escalation radar strip and the charts that matter at 08:00 stand-up.",
    route: "#/dashboard",
    minutes: 2,
    roles: "All users",
    steps: [
      { selector: '[data-tour="tour-kpis"]', title: "Plant KPIs at a glance", body: "Open sales orders, WOs in flight, stock value, overdue POs and quality holds — all server-computed, refreshed live. Click any card to drill into its module.", placement: "bottom" },
      { selector: '[data-tour="tour-radar"]', title: "Exception radar", body: "One strip for what can hurt today: critical SCARs, expedite POs, ETA breaches, overdue CAPAs. Tiles are clickable and deep-link to the filtered list.", placement: "top" },
      { selector: '[data-tour="tour-charts"]', title: "Trends & mix", body: "Family mix, dispatch trend and stock by warehouse. Everything on this page renders from the same audited API as the tables — no parallel truth.", placement: "top" },
    ],
  },
  {
    id: "engineering",
    title: "Engineering — BOM, routes, APQP & ECO",
    description: "Item master, BOM/route revisions, APQP deliverables and the ECO change loop.",
    route: "#/engineering",
    minutes: 3,
    roles: "Engineering · NPI · Quality",
    steps: [
      { selector: '[data-tour="tour-tabs"]', title: "Engineering workbench tabs", body: "Items & BOM, Routes, APQP/PPAP and ECO. Tabs carry live counts; everything below is server-filtered per tab.", placement: "bottom" },
      { selector: '[data-tour="tour-engineering"]', title: "Revisions are immutable", body: "Released BOM/route revisions never mutate — changes go through an approved ECO and a new revision (spec rule 13). HSN/GST values are the approved synthetic set (DR-001).", placement: "top" },
      { selector: '[data-tour="tour-search"]', title: "Deep-link anything", body: "Ctrl+K searches part numbers, BOM lines and ECO refs — the fastest way back into engineering data.", placement: "bottom" },
    ],
  },
  {
    id: "procurement",
    title: "Procurement — suppliers, POs & SCAR",
    description: "Supplier scorecards, draft-PO four-eyes flow, RFQs and the 8D supplier portal.",
    route: "#/procurement",
    minutes: 3,
    roles: "Purchase · SQE · Finance",
    steps: [
      { selector: '[data-tour="tour-tabs"]', title: "Procurement tabs", body: "Suppliers, Purchase Orders, RFQ & quotations, SCAR. Counters show open work per list.", placement: "bottom" },
      { selector: '[data-tour="tour-procurement"]', title: "Four-eyes on every PO", body: "Planners convert MRP shortages into DRAFT POs; only the Purchase Manager approves and releases. SO-driven lines carry a red EXPEDITE ETA of +7 days.", placement: "top" },
      { selector: '[data-tour="tour-bell"]', title: "Escalation alerts", body: "Expedite POs raise a WARNING to the Purchase Manager — the bell deep-links straight to the PO with the expedite banner open.", placement: "bottom" },
    ],
  },
  {
    id: "inventory",
    title: "Inventory & traceability",
    description: "Lot/serial genealogy, GRN, warehouses and the barcode-first movements.",
    route: "#/inventory",
    minutes: 2,
    roles: "Stores · Production · QA",
    steps: [
      { selector: '[data-tour="tour-tabs"]', title: "Inventory tabs", body: "Stock & lots, Movements, Genealogy. FIFO/FEFO status and NCR blocks are visible per lot.", placement: "bottom" },
      { selector: '[data-tour="tour-inventory"]', title: "Full genealogy, both directions", body: "Pick any serial or batch and walk supplier-lot → WO → serial → dispatch. Barcode-first: every move is a scan away on the shop floor.", placement: "top" },
    ],
  },
  {
    id: "planning",
    title: "Planning — forecast & MRP",
    description: "Approved forecast register, MRP workbench overrides and the run-to-PO loop.",
    route: "#/planning",
    minutes: 3,
    roles: "Planning · Purchase",
    steps: [
      { selector: '[data-tour="tour-tabs"]', title: "Planning tabs", body: "Forecast (approved demand), MRP Workbench (run + override), MRP History (audited runs).", placement: "bottom" },
      { selector: '[data-tour="tour-planning"]', title: "MRP: run, override, convert", body: "Run MRP over the approved forecast, override suggested quantities (audited), then convert shortages into draft POs — supplier sourced from last PO or best RFQ, ETA per line from quotation/item-master leads.", placement: "top" },
      { selector: '[data-tour="tour-footer"]', title: "Everything is audited", body: "Runs, overrides, conversions — each writes an audit row you can filter in Administration → Audit Trail.", placement: "top" },
    ],
  },
  {
    id: "production",
    title: "Production — WOs & job cards",
    description: "Work orders, travellers, barcode job cards and shop-floor reporting.",
    route: "#/production",
    minutes: 2,
    roles: "Production · Supervisors",
    steps: [
      { selector: '[data-tour="tour-tabs"]', title: "Production tabs", body: "Work orders, Job cards, Shift handovers. WOs are created from MRP or SO demand and follow the seeded five-family routes.", placement: "bottom" },
      { selector: '[data-tour="tour-production"]', title: "Barcode-first reporting", body: "Operators clock operations with scans — qty completed/scrapped per operation, skill-code checks and four-eyes where the route demands it.", placement: "top" },
    ],
  },
  {
    id: "quality",
    title: "Quality — NCR, CAPA, calibration & EOL",
    description: "Nonconformance loop, CAPA effectiveness, calibration due board and EOL test evidence.",
    route: "#/quality",
    minutes: 3,
    roles: "QA · NPI · Maintenance",
    steps: [
      { selector: '[data-tour="tour-tabs"]', title: "Quality tabs", body: "NCR & MRB, CAPA, Calibration calendar, EOL tests, Inspections (IQC/FI).", placement: "bottom" },
      { selector: '[data-tour="tour-quality"]', title: "Closed-loop QMS", body: "NCR → MRB disposition → CAPA with effectiveness check. NCR-blocked lots are excluded from MRP supply automatically.", placement: "top" },
      { selector: '[data-tour="tour-search"]', title: "Find any NCR or serial", body: "Ctrl+K jumps to NCRs, serials and lots — ideal when the customer calls about a specific unit.", placement: "bottom" },
    ],
  },
  {
    id: "sales",
    title: "Sales & dispatch — SO to GST invoice",
    description: "Sales orders, delivery notes, the release gate and the sandbox e-invoice flow.",
    route: "#/sales",
    minutes: 3,
    roles: "Sales · Dispatch · Finance",
    steps: [
      { selector: '[data-tour="tour-tabs"]', title: "Sales tabs", body: "Sales orders, Deliveries (DN), Invoices & e-Invoice log.", placement: "bottom" },
      { selector: '[data-tour="tour-sales"]', title: "Release gate before dispatch", body: "A DN cannot ship until traceability, calibration and EOL evidence pass the gate — the release checklist is enforced, not advisory.", placement: "top" },
      { selector: '[data-tour="tour-footer"]', title: "GST sandbox, honestly labelled", body: "Invoices compute CGST/SGST/IGST per the approved synthetic model (DR-001); IRNs are SANDBOX_MOCK with an idempotency log — NOT FOR STATUTORY USE.", placement: "top" },
    ],
  },
  {
    id: "admin",
    title: "Administration — RBAC, audit & decisions",
    description: "The RBAC matrix, immutable audit trail, the approved decision register and ops runbook.",
    route: "#/admin",
    minutes: 2,
    roles: "System Admin · Auditors",
    steps: [
      { selector: '[data-tour="tour-tabs"]', title: "Admin tabs", body: "Users & RBAC, Audit Trail, Decision Register, System.", placement: "bottom" },
      { selector: '[data-tour="tour-admin"]', title: "RBAC you can read", body: "The matrix shows exactly which role gets which permission group — mirrored server-side on every API request, with four-eyes on sensitive transitions.", placement: "top" },
      { selector: '[data-tour="tour-footer"]', title: "Environment honesty", body: "ENV: DEV/UAT, seed-guard, version pins and the restore drill runbook — the governance page your auditor asks for.", placement: "top" },
    ],
  },
];

export const TOUR_BY_ID = Object.fromEntries(TOURS.map((t) => [t.id, t]));

export function tourForView(view: string): TourDef | undefined {
  return TOURS.find((t) => t.route === `#/${view}`);
}
