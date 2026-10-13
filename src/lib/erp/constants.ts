// ============================================================================
// Tau ERP — Domain constants: statuses, families, RBAC matrix (from spec §RBAC)
// ============================================================================

export const FAMILIES = [
  { code: "NOX", name: "NOx Sensor", color: "#f59e0b" },
  { code: "LAMBDA", name: "Lambda (O2) Sensor", color: "#34d399" },
  { code: "DELTAP", name: "Delta-P Pressure Sensor", color: "#a78bfa" },
  { code: "EGT", name: "EGT Thermocouple Sensor", color: "#fb7185" },
  { code: "UQS", name: "Urea Quality Sensor", color: "#22d3ee" },
] as const;

export type FamilyCode = (typeof FAMILIES)[number]["code"];

/** Shop-floor shifts (IST) — used by the shift-handover log. */
export const SHIFTS = [
  { code: "A", name: "Shift A · Morning", window: "06:00–14:00" },
  { code: "B", name: "Shift B · Afternoon", window: "14:00–22:00" },
  { code: "C", name: "Shift C · Night", window: "22:00–06:00" },
] as const;

/**
 * Operator skill matrix codes (DR-006 — route qualifications).
 * Route steps declare `skillRequired`; job-card start is server-blocked unless the
 * acting user holds the skill in `User.skillCodesJson`. Maintained under admin.manage.
 */
export const SKILLS = [
  { code: "SMT-OP", label: "SMT line operation" },
  { code: "WIND-OP", label: "Coil winding & sub-assembly" },
  { code: "SEAL-POT", label: "Sealing & potting" },
  { code: "CAL-OP", label: "Calibration bench" },
  { code: "EOL-TEST", label: "EOL test bench" },
  { code: "VIS-IPC", label: "Visual inspection (IPC-A-610)" },
  { code: "PACK-OP", label: "Packing & labelling" },
] as const;

export type SkillCode = (typeof SKILLS)[number]["code"];
export const SKILL_CODES: string[] = SKILLS.map((s) => s.code);
export function skillLabel(code: string): string {
  return SKILLS.find((s) => s.code === code)?.label ?? code;
}

// ---------------------------------------------------------------------------
// Roles (spec §RBAC and user design)
// ---------------------------------------------------------------------------
export const ROLES = [
  { code: "SYSTEM_ADMIN", name: "System Administrator", desc: "Platform administration. Cannot approve business transactions." },
  { code: "APP_MANAGER", name: "ERP Application Manager", desc: "Configuration & master governance." },
  { code: "EXEC_VIEWER", name: "Executive Viewer", desc: "Dashboards & approved reports. No create/submit/cancel." },
  { code: "SALES_MGR", name: "Sales Manager", desc: "CRM through sales order; approvals." },
  { code: "PLANNER", name: "Production Planner", desc: "Plan, MRP, work orders, scheduling." },
  { code: "PROD_SUP", name: "Production Supervisor", desc: "Release shop work, assign jobs, report output." },
  { code: "OPERATOR", name: "Operator", desc: "Assigned job cards, scans, operation data entry." },
  { code: "STORE_MGR", name: "Store Manager", desc: "Receipt, put-away, issue, transfer, picking." },
  { code: "PURCHASE_MGR", name: "Purchase Manager", desc: "RFQ, PO, supplier coordination." },
  { code: "QUALITY_MGR", name: "Quality Manager", desc: "MRB, CAPA, product release." },
  { code: "QUALITY_INSPECTOR", name: "Quality Inspector", desc: "Inspection and NCR creation." },
  { code: "CALIB_ENG", name: "Calibration Engineer", desc: "Test recipes & records per workflow." },
  { code: "FINANCE_MGR", name: "Finance Manager", desc: "Invoices, payments, reconciliation, tax." },
  { code: "AUDITOR", name: "Internal Auditor", desc: "Read-only access to approved scope & audit logs." },
] as const;

export type RoleCode = (typeof ROLES)[number]["code"];

// ---------------------------------------------------------------------------
// Permission keys enforced SERVER-SIDE in API routes via getSessionUser()
// ---------------------------------------------------------------------------
export type PermKey =
  | "dashboard.view"
  | "engineering.view" | "engineering.edit" | "engineering.approve"
  | "procurement.view" | "procurement.create" | "procurement.approve"
  | "inventory.view" | "inventory.move" | "inventory.adjust"
  | "planning.view" | "planning.run"
  | "production.view" | "production.release" | "production.execute"
  | "quality.view" | "quality.inspect" | "quality.approve" | "quality.ncr"
  | "sales.view" | "sales.create" | "sales.dispatch" | "sales.invoice"
  | "admin.view" | "admin.manage"
  | "audit.view"
  | "decisions.view" | "decisions.manage";

const ALL: PermKey[] = [
  "dashboard.view", "engineering.view", "engineering.edit", "engineering.approve",
  "procurement.view", "procurement.create", "procurement.approve",
  "inventory.view", "inventory.move", "inventory.adjust",
  "planning.view", "planning.run",
  "production.view", "production.release", "production.execute",
  "quality.view", "quality.inspect", "quality.approve", "quality.ncr",
  "sales.view", "sales.create", "sales.dispatch", "sales.invoice",
  "admin.view", "admin.manage", "audit.view", "decisions.view", "decisions.manage",
];

const VIEW_ONLY: PermKey[] = ["dashboard.view", "engineering.view", "procurement.view", "inventory.view", "planning.view", "production.view", "quality.view", "sales.view", "audit.view", "decisions.view", "admin.view"];

export const RBAC: Record<string, PermKey[]> = {
  SYSTEM_ADMIN: [...ALL],
  APP_MANAGER: [...ALL],
  EXEC_VIEWER: [...VIEW_ONLY],
  SALES_MGR: ["dashboard.view", "engineering.view", "inventory.view", "planning.view", "production.view", "quality.view", "sales.view", "sales.create", "sales.dispatch", "sales.invoice", "audit.view", "decisions.view", "admin.view"],
  PLANNER: ["dashboard.view", "engineering.view", "inventory.view", "planning.view", "planning.run", "production.view", "production.release", "quality.view", "sales.view", "audit.view", "decisions.view", "admin.view"],
  PROD_SUP: ["dashboard.view", "engineering.view", "inventory.view", "planning.view", "production.view", "production.release", "production.execute", "quality.view", "quality.ncr", "audit.view", "decisions.view", "admin.view"],
  OPERATOR: ["dashboard.view", "production.view", "production.execute", "inventory.view", "quality.view", "admin.view"],
  STORE_MGR: ["dashboard.view", "inventory.view", "inventory.move", "inventory.adjust", "procurement.view", "production.view", "quality.view", "sales.view", "sales.dispatch", "audit.view", "decisions.view", "admin.view"],
  PURCHASE_MGR: ["dashboard.view", "engineering.view", "procurement.view", "procurement.create", "procurement.approve", "inventory.view", "audit.view", "decisions.view", "admin.view"],
  QUALITY_MGR: ["dashboard.view", "engineering.view", "engineering.approve", "inventory.view", "production.view", "quality.view", "quality.inspect", "quality.approve", "quality.ncr", "planning.view", "audit.view", "decisions.view", "decisions.manage", "admin.view"],
  QUALITY_INSPECTOR: ["dashboard.view", "inventory.view", "production.view", "quality.view", "quality.inspect", "quality.ncr", "admin.view"],
  CALIB_ENG: ["dashboard.view", "engineering.view", "engineering.edit", "production.view", "quality.view", "quality.inspect", "admin.view"],
  FINANCE_MGR: ["dashboard.view", "procurement.view", "inventory.view", "sales.view", "sales.invoice", "audit.view", "decisions.view", "admin.view"],
  AUDITOR: ["dashboard.view", "engineering.view", "procurement.view", "inventory.view", "planning.view", "production.view", "quality.view", "sales.view", "audit.view", "decisions.view", "admin.view"],
};

export function hasPerm(role: string | undefined, perm: PermKey): boolean {
  if (!role) return false;
  return (RBAC[role] ?? []).includes(perm);
}

// Four-eyes pairs (spec rule 12): approver must differ from requester
export const FOUR_EYES = {
  MRB: { approverRole: "QUALITY_MGR" },
  PO_APPROVAL: { approverRole: "PURCHASE_MGR" },
  PRODUCT_RELEASE: { approverRole: "QUALITY_MGR" },
  ECO_APPROVAL: { approverRole: "QUALITY_MGR" },
  SCAR_CLOSURE: { approverRole: "QUALITY_MGR" },
};

// ---------------------------------------------------------------------------
// Status vocabularies (String enums for SQLite) + badge colors
// ---------------------------------------------------------------------------
export const STATUS_COLORS: Record<string, string> = {
  DRAFT: "zinc", PENDING: "zinc", OPEN: "amber", IN_PROGRESS: "amber", IN_REVIEW: "amber",
  APPROVED: "emerald", RELEASED: "emerald", PASSED: "emerald", ACTIVE: "emerald", OK: "emerald",
  REJECTED: "red", FAILED: "red", CANCELLED: "zinc", CLOSED: "zinc", OBSOLETE: "zinc",
  HOLD: "orange", HELD: "orange", BLOCKED: "red", EXPIRED: "red", CRITICAL: "red",
  COMPLETED: "emerald", DONE: "emerald", SHIPPED: "emerald", DISPATCHED: "emerald", EINVOICED: "emerald",
  READY: "teal", SUBMITTED: "amber", PENDING_APPROVAL: "amber", PARTIAL: "amber",
  IN_STOCK: "emerald", CONSUMED: "zinc", WIP: "amber",
  QUARANTINE: "orange", PENDING_IQC: "orange", ACCEPTED: "emerald", DUE_SOON: "orange",
  MINOR: "amber", MAJOR: "orange", CONTAINMENT: "orange", DISPOSITIONED: "teal", MRB: "orange",
  UNDER_REVIEW: "amber", VERIFICATION: "teal",
  USE_AS_IS: "emerald", RETURN_TO_VENDOR: "orange", REWORK: "orange", SCRAPPED: "red",
};

export const COMPANY = {
  name: "Tau Power Electronics Pvt. Ltd.",
  plant: "PLANT-PUNE",
  address: "Plot 42, MIDC Bhosari, Pune 411026, MH, India",
  gstin: "27SYNTH0000TAU1Z9", // SYNTHETIC — real GSTIN requires Finance/CA approval
  state: "MH",
};

export const SYNTHETIC_NOTICE = "SYNTHETIC DATA — NOT FOR STATUTORY USE";
