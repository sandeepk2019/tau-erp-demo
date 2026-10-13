// ============================================================================
// Tau ERP — SYNTHETIC seed (spec: fixtures idempotent, labelled, DEV-only)
// Builds a coherent business story:
//   masters → POs/GRNs/IQC → WO-0001 full lifecycle (genealogy→CAL→EOL→release
//   →container→DN→GST invoice w/ synthetic IRN) → NCR/MRB/CAPA story → planning
// ============================================================================
import { db } from "@/lib/db";
import { SKILL_CODES } from "./constants";

const d = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400_000);
const J = (x: unknown) => JSON.stringify(x);

export async function isSeeded() {
  return (await db.user.count()) > 0;
}

async function wipe() {
  const tables = [
    "eInvoiceLog", "salesInvoice", "deliveryLine", "deliveryNote", "soLine", "salesOrder",
    "quoteLine", "quotation", "productRelease", "reworkOrder", "capa", "mrbDecision", "ncr",
    "inspection", "inspectionTemplate", "travellerEvent", "scanSession", "jobCard",
    "workOrder", "mrpRun", "forecast", "containerMember", "container", "genealogyLink",
    "scar", // supplier corrective actions — force reseed must not leave stale SCARs
    "shiftHandover", // cleared with everything else — force reseed must not leave stale ad-hoc handovers
    "stockMovement", "stockLot", "grnLine", "goodsReceipt", "poLine", "purchaseOrder",
    "supplierQuotation", "rfq", "ppapSubmission", "apqpGate", "apqpProject",
    "engineeringChange", "routeStep", "routeRevision", "bomLine", "bom", "equipment",
    "customer", "supplier", "operation", "workstation", "warehouse", "item",
    "productFamily", "decisionRegister", "auditLog", "notification", "user",
  ];
  for (const t of tables) {
    await (db as unknown as Record<string, { deleteMany: () => Promise<unknown> }>)[t].deleteMany();
  }
}

export async function seedAll(force = false) {
  if (await isSeeded()) {
    if (!force) return { seeded: true, skipped: true };
    await wipe();
  } else {
    await wipe(); // ensure clean slate even if partial data existed
  }

  // ---------------------------------------------------------------- USERS
  const users = [
    { username: "admin", name: "Arvind Iyer", role: "SYSTEM_ADMIN", email: "arvind.iyer@tau-erp.example" },
    { username: "kmehta", name: "Kiran Mehta", role: "APP_MANAGER", email: "kiran.mehta@tau-erp.example" },
    { username: "vrao", name: "Vandana Rao", role: "EXEC_VIEWER", email: "vandana.rao@tau-erp.example" },
    { username: "snair", name: "Sunil Nair", role: "SALES_MGR", email: "sunil.nair@tau-erp.example" },
    { username: "akhan", name: "Ayesha Khan", role: "PLANNER", email: "ayesha.khan@tau-erp.example" },
    { username: "rpawar", name: "Rahul Pawar", role: "PROD_SUP", email: "rahul.pawar@tau-erp.example", skillCodes: SKILL_CODES },
    { username: "jyadav", name: "Jitin Yadav", role: "OPERATOR", email: "jitin.yadav@tau-erp.example", skillCodes: ["SMT-OP", "EOL-TEST", "PACK-OP", "VIS-IPC"] },
    { username: "pkulk", name: "Prasad Kulkarni", role: "OPERATOR", email: "prasad.kulkarni@tau-erp.example", skillCodes: ["WIND-OP", "SEAL-POT", "CAL-OP"] },
    { username: "mdesh", name: "Meera Deshpande", role: "STORE_MGR", email: "meera.deshpande@tau-erp.example" },
    { username: "tbose", name: "Tanmoy Bose", role: "PURCHASE_MGR", email: "tanmoy.bose@tau-erp.example" },
    { username: "lkrish", name: "Lata Krishnan", role: "QUALITY_MGR", email: "lata.krishnan@tau-erp.example" },
    { username: "lsethi", name: "Lalit Sethi", role: "QUALITY_INSPECTOR", email: "lalit.sethi@tau-erp.example" },
    { username: "ciyer", name: "Charu Iyer", role: "CALIB_ENG", email: "charu.iyer@tau-erp.example" },
    { username: "fgupta", name: "Farid Gupta", role: "FINANCE_MGR", email: "farid.gupta@tau-erp.example" },
    { username: "nkulk", name: "Nandini Kulkarni", role: "AUDITOR", email: "nandini.kulkarni@tau-erp.example" },
  ];
  for (const { skillCodes, ...u } of users) await db.user.create({ data: { ...u, plant: "PLANT-PUNE", skillCodesJson: JSON.stringify(skillCodes ?? []) } });
  const U = (username: string) => users.find((u) => u.username === username)!;

  // ---------------------------------------------------------- FAMILIES (spec §Product-family model)
  const famData = [
    { code: "NOX", name: "NOx Sensor", description: "Nitrogen-oxide sensor for BS-VI aftertreatment.",
      evidenceClasses: ["Component lot/serial genealogy", "Process parameters", "Leak/electrical checks", "Software/calibration version", "EOL result"],
      route: ["Receiving/IQC", "Ceramic/sensing subassembly", "Electronics/controller assembly", "Housing/process joining", "Sealing/curing", "Programming", "Calibration", "EOL", "Final inspection", "Pack/Release"] },
    { code: "LAMBDA", name: "Lambda (O2) Sensor", description: "Wideband oxygen sensor for engine control.",
      evidenceClasses: ["Critical material lots", "Joining parameters", "Heater/electrical results", "Calibration curve/version", "EOL result"],
      route: ["Receiving/IQC", "Sensing element/heater subassembly", "Housing joining", "Sealing", "Conditioning/activation", "Calibration", "EOL", "Final inspection", "Pack/Release"] },
    { code: "DELTAP", name: "Delta-P Pressure Sensor", description: "DPF differential pressure sensor.",
      evidenceClasses: ["Pressure references", "Leak result", "Zero/span data", "Test-equipment ID/calibration state", "Firmware/version"],
      route: ["Receiving/IQC", "Pressure-port/body preparation", "Sensing element/PCB assembly", "Joining/sealing", "Leak/pressure proof", "Zero/span calibration", "EOL", "Final inspection", "Pack/Release"] },
    { code: "EGT", name: "EGT Thermocouple Sensor", description: "Exhaust gas temperature sensor.",
      evidenceClasses: ["Material heat/lot", "Joining evidence", "Insulation/continuity", "Temperature reference", "Response/EOL result"],
      route: ["Receiving/IQC", "Sensing element preparation", "Sheath/housing assembly", "Cable/connector assembly", "Insulation/continuity test", "Temperature calibration/verification", "EOL", "Final inspection", "Pack/Release"] },
    { code: "UQS", name: "Urea Quality Sensor", description: "AdBlue/urea quality & level sensor for SCR systems.",
      evidenceClasses: ["Transducer/electronics genealogy", "Firmware/calibration version", "Medium/fixture trace", "Level/quality/temperature outputs", "Leak/EOL results"],
      route: ["Receiving/IQC", "Electronics assembly", "Tank/interface assembly", "Sealing/potting", "Programming", "Functional calibration (approved medium/fixture)", "Leak check", "EOL", "Final inspection", "Pack/Release"] },
  ];
  for (const f of famData) {
    await db.productFamily.create({
      data: { code: f.code, name: f.name, description: f.description,
        evidenceClassesJson: J(f.evidenceClasses), routeBaselineJson: J(f.route) },
    });
  }

  // ---------------------------------------------------------------- WAREHOUSES
  const wh: [string, string, string][] = [
    ["WH-RAW", "Raw Material Store", "RAW"], ["WH-IQC", "IQC Inspection", "IQC"],
    ["WH-QUAR", "Quarantine", "QUARANTINE"], ["WH-ACC", "Accepted Stock", "ACCEPTED"],
    ["WH-REJ", "Rejected / MRB", "REJECTED"], ["WH-WIP", "Work In Process", "WIP"],
    ["WH-FG", "Finished Goods", "FG"], ["WH-SCRAP", "Scrap", "SCRAP"],
    ["WH-SUBCON", "Subcontractor", "SUBCONTRACT"], ["WH-REWORK", "Rework", "REWORK"],
  ];
  for (const [code, name, type] of wh) await db.warehouse.create({ data: { code, name, type } });

  // ---------------------------------------------------------------- OPERATIONS
  const ops: [string, string, string][] = [
    ["OP-IQC", "Incoming Inspection", "IQC"], ["OP-SUBASSY", "Sensing Subassembly", "ASSEMBLY"],
    ["OP-ELEC-ASSY", "Electronics Assembly", "ASSEMBLY"], ["OP-JOIN", "Housing Joining", "ASSEMBLY"],
    ["OP-SEAL", "Sealing / Curing", "ASSEMBLY"], ["OP-PROG", "Firmware Programming", "TEST"],
    ["OP-CALIB", "Calibration", "CALIBRATION"], ["OP-EOL", "End-of-Line Test", "EOL"],
    ["OP-FININSP", "Final Inspection", "TEST"], ["OP-PACK", "Pack / Release", "PACKING"],
    ["OP-CONDITION", "Conditioning / Activation", "TEST"], ["OP-BODYPREP", "Pressure Port Prep", "ASSEMBLY"],
    ["OP-LEAK", "Leak / Pressure Proof", "TEST"], ["OP-ELEMPREP", "Element Preparation", "ASSEMBLY"],
    ["OP-SHEATH", "Sheath Assembly", "ASSEMBLY"], ["OP-CONN", "Cable / Connector", "ASSEMBLY"],
    ["OP-CONTTEST", "Insulation / Continuity", "TEST"], ["OP-TANK", "Tank / Interface Assembly", "ASSEMBLY"],
    ["OP-POT", "Potting", "ASSEMBLY"], ["OP-FUNCCAL", "Functional Calibration", "CALIBRATION"],
  ];
  for (const [code, name, ev] of ops) await db.operation.create({ data: { code, name, evidenceClass: ev } });

  // ---------------------------------------------------------------- WORKSTATIONS
  const ws: [string, string, string, string[]][] = [
    ["WS-IQC-01", "IQC Bench 1", "IQC", []], ["WS-ASSY-01", "Assembly Cell 1", "ASSEMBLY", ["NOX", "LAMBDA", "UQS"]],
    ["WS-ASSY-02", "Assembly Cell 2", "ASSEMBLY", ["DELTAP", "EGT"]], ["WS-TEST-01", "Electrical Test Bench", "TEST", ["NOX", "LAMBDA", "DELTAP", "EGT", "UQS"]],
    ["WS-CAL-01", "Calibration Rig 1", "CALIBRATION", ["NOX", "LAMBDA"]], ["WS-CAL-02", "Calibration Rig 2", "CALIBRATION", ["DELTAP", "EGT", "UQS"]],
    ["WS-EOL-01", "EOL Test Bench", "EOL", ["NOX", "LAMBDA", "DELTAP", "EGT", "UQS"]], ["WS-PACK-01", "Packing Station", "PACKING", ["NOX", "LAMBDA", "DELTAP", "EGT", "UQS"]],
  ];
  for (const [code, name, kind, qf] of ws) await db.workstation.create({ data: { code, name, kind, qualifiedForJson: J(qf) } });

  // ---------------------------------------------------------------- ITEMS
  const items: [string, string, string, string, string, string, number][] = [
    // part, name, family, type, tracking, critical, cost
    ["RM-CERAM-ELEM", "Ceramic Sensing Element", "NOX", "RAW", "BATCH", "CRITICAL", 210],
    ["RM-HEATER-ELEM", "Heater Element", "NOX", "RAW", "BATCH", "CRITICAL", 145],
    ["RM-ELECTRODE-SET", "Electrode Set", "NOX", "RAW", "BATCH", "STANDARD", 80],
    ["RM-HOUSING-SS", "SS304 Housing Body", "", "RAW", "BATCH", "STANDARD", 165],
    ["RM-PCB-DRV", "Driver PCB", "", "RAW", "BATCH", "CRITICAL", 340],
    ["RM-CONN-AMP", "Automotive Connector", "", "RAW", "BATCH", "STANDARD", 62],
    ["RM-CABLE-PTFE", "PTFE Cable Pigtail", "", "RAW", "BATCH", "STANDARD", 55],
    ["RM-POTTING", "Potting Compound 2K", "", "RAW", "BATCH", "CRITICAL", 95],
    ["RM-SS-SHEATH", "SS Sheath Tube 6mm", "EGT", "RAW", "BATCH", "CRITICAL", 120],
    ["RM-TC-WIRE", "Thermocouple Wire K-Type", "EGT", "RAW", "BATCH", "CRITICAL", 180],
    ["RM-PRESS-DIE", "Piezoresistive Pressure Die", "DELTAP", "RAW", "BATCH", "CRITICAL", 480],
    ["RM-DIAPH-316L", "316L Diaphragm", "DELTAP", "RAW", "BATCH", "CRITICAL", 150],
    ["RM-ULTRA-TX", "Ultrasonic Transducer", "UQS", "RAW", "BATCH", "CRITICAL", 520],
    ["SBA-NOX-ELEM", "NOx Sensing Subassembly", "NOX", "SUBASSEMBLY", "SERIAL", "CRITICAL", 830],
    ["SBA-LAM-ELEM", "Lambda Element Subassembly", "LAMBDA", "SUBASSEMBLY", "SERIAL", "CRITICAL", 640],
    ["SBA-PCB-ASSY", "Controller Electronics Assembly", "", "SUBASSEMBLY", "SERIAL", "CRITICAL", 900],
    ["SBA-DP-PORT", "Pressure Port Assembly", "DELTAP", "SUBASSEMBLY", "SERIAL", "CRITICAL", 780],
    ["SBA-EGT-PROBE", "EGT Probe Assembly", "EGT", "SUBASSEMBLY", "SERIAL", "CRITICAL", 700],
    ["SBA-UQS-HEAD", "UQS Transducer Head", "UQS", "SUBASSEMBLY", "SERIAL", "CRITICAL", 1100],
    ["TAU-NOX-100", "NOx Sensor TAU-NOX-100", "NOX", "FINISHED", "SERIAL", "CRITICAL", 8500],
    ["TAU-LAM-200", "Lambda Sensor TAU-LAM-200", "LAMBDA", "FINISHED", "SERIAL", "CRITICAL", 6800],
    ["TAU-DP-300", "Delta-P Sensor TAU-DP-300", "DELTAP", "FINISHED", "SERIAL", "CRITICAL", 5900],
    ["TAU-EGT-400", "EGT Sensor TAU-EGT-400", "EGT", "FINISHED", "SERIAL", "CRITICAL", 4700],
    ["TAU-UQS-500", "Urea Quality Sensor TAU-UQS-500", "UQS", "FINISHED", "SERIAL", "CRITICAL", 9400],
    ["PK-BOX-IND", "Individual Sensor Box", "", "PACKAGING", "NONE", "STANDARD", 12],
    ["PK-PALLET", "Export Euro Pallet", "", "PACKAGING", "NONE", "STANDARD", 480],
  ];
  const itemMap: Record<string, string> = {};
  // Per-item procurement lead times (round 10) — data-driven PO ETA in MRP create-pos.
  // Purchased items get realistic supplier lead days; make items (FINISHED/SUBASSEMBLY) stay null.
  const PROC_LEAD: Record<string, number> = {
    "RM-HOUSING-SS": 21, "RM-PCB-DRV": 18, "RM-CONN-AMP": 12, "RM-CABLE-PTFE": 10,
    "RM-POTTING": 16, "RM-SS-SHEATH": 14, "RM-TC-WIRE": 24, "RM-PRESS-DIE": 35,
    "RM-DIAPH-316L": 20, "RM-ULTRA-TX": 28, "PK-BOX-IND": 5, "PK-PALLET": 7,
  };
  for (const [pn, name, fam, type, track, crit, cost] of items) {
    const it = await db.item.create({
      data: {
        partNumber: pn, name, familyCode: fam, itemType: type,
        uom: type === "PACKAGING" ? "Nos" : track === "BATCH" && type === "RAW" ? (pn === "RM-POTTING" ? "Kg" : "Nos") : "Nos",
        trackingType: track, criticality: crit, unitCost: cost,
        procLeadTimeDays: PROC_LEAD[pn] ?? null,
        hsnCode: type === "FINISHED" ? "90269000" : "85329000", // synthetic — approved per Decision Register DR-001
        gstRate: 18, // synthetic — approved per Decision Register DR-001 (India GST 18% demo model)
      },
    });
    itemMap[pn] = it.id;
  }

  // ---------------------------------------------------------------- SUPPLIERS / CUSTOMERS
  const supBHC = await db.supplier.create({ data: { code: "SUP-BHC", name: "Bharat Hi-Tech Ceramics", gstin: "27SYNTHBHC0001Z5", city: "Pune", category: "CRITICAL", approved: true, approvedDate: d(-300), rating: 4.6, ppm: 120, onTimePct: 97 } });
  const supPPM = await db.supplier.create({ data: { code: "SUP-PPM", name: "Pune Precision Metals", gstin: "27SYNTHPPM0001Z3", city: "Pune", category: "STANDARD", approved: true, approvedDate: d(-260), rating: 4.2, ppm: 210, onTimePct: 95 } });
  const supACS = await db.supplier.create({ data: { code: "SUP-ACS", name: "AquaChem Supplies", gstin: "29SYNTHACS0001Z1", city: "Bengaluru", category: "CRITICAL", approved: true, approvedDate: d(-200), rating: 3.4, ppm: 640, onTimePct: 88, notes: "Lot ACS-1120 under NCR-2025-0002 — approved status under review" } });
  const supELX = await db.supplier.create({ data: { code: "SUP-ELX", name: "ElX Circuits", gstin: "24SYNTHELX0001Z7", city: "Gandhinagar", category: "CRITICAL", approved: true, approvedDate: d(-400), rating: 4.8, ppm: 60, onTimePct: 99 } });
  await db.supplier.create({ data: { code: "SUP-FST", name: "FastCable Industries", gstin: "33SYNTHFST0001Z9", city: "Chennai", category: "STANDARD", approved: false, rating: 0, notes: "Onboarding pending quality audit — blocked for controlled items" } });

  const cusVel = await db.customer.create({ data: { code: "CUS-VELOCE", name: "Veloce Mobility Ltd.", gstin: "27SYNTHVEL0001Z2", city: "Pune", segment: "OEM", programme: "PM-BS6-P2" } });
  const cusTorq = await db.customer.create({ data: { code: "CUS-TORQ", name: "TorqLok Drivetrain", gstin: "27SYNTHTOR0001Z4", city: "Nashik", segment: "OEM", programme: "PM-DP-17" } });
  await db.customer.create({ data: { code: "CUS-APX", name: "Apex Emissions GmbH", gstin: "DESYNTHAPX0001Z6", city: "Stuttgart", segment: "TIER1", programme: "EXPORT-EU" } });
  await db.customer.create({ data: { code: "CUS-SUND", name: "Sundaram Auto Components", gstin: "33SYNTHSUN0001Z8", city: "Chennai", segment: "TIER1", programme: "PM-UQS-9" } });

  // ---------------------------------------------------------------- EQUIPMENT
  await db.equipment.create({ data: { code: "EOL-BENCH-01", name: "EOL Test Bench (NOx/Lambda)", kind: "TEST_BENCH", stationCode: "WS-EOL-01", calibrationDue: d(45), status: "OK" } });
  await db.equipment.create({ data: { code: "EOL-BENCH-02", name: "EOL Test Bench (DP/EGT/UQS)", kind: "TEST_BENCH", stationCode: "WS-EOL-01", calibrationDue: d(12), status: "OK" } });
  await db.equipment.create({ data: { code: "CAL-RIG-01", name: "NOx Gas Calibration Rig", kind: "CAL_RIG", stationCode: "WS-CAL-01", calibrationDue: d(70), status: "OK" } });
  await db.equipment.create({ data: { code: "CAL-RIG-02", name: "Pressure Zero/Span Rig", kind: "CAL_RIG", stationCode: "WS-CAL-02", calibrationDue: d(6), status: "DUE_SOON" } });
  await db.equipment.create({ data: { code: "GAUGE-DMM-01", name: "6.5-digit DMM", kind: "GAUGE", stationCode: "WS-TEST-01", calibrationDue: d(120), status: "OK" } });
  await db.equipment.create({ data: { code: "GAUGE-LEAK-01", name: "Leak Test Gauge", kind: "GAUGE", stationCode: "WS-EOL-01", calibrationDue: d(-9), status: "EXPIRED" } });
  await db.equipment.create({ data: { code: "GAUGE-CONT-01", name: "Continuity / IR Tester", kind: "GAUGE", stationCode: "WS-TEST-01", calibrationDue: d(88), status: "OK" } });

  // ---------------------------------------------------------------- BOMs (Released rev A for all five FG)
  const bomDefs: Record<string, Array<[string, number]>> = {
    "TAU-NOX-100": [["SBA-NOX-ELEM", 1], ["SBA-PCB-ASSY", 1], ["RM-HOUSING-SS", 1], ["RM-CONN-AMP", 1], ["RM-CABLE-PTFE", 1], ["RM-POTTING", 0.02], ["PK-BOX-IND", 1]],
    "TAU-LAM-200": [["SBA-LAM-ELEM", 1], ["SBA-PCB-ASSY", 1], ["RM-HOUSING-SS", 1], ["RM-CONN-AMP", 1], ["RM-CABLE-PTFE", 1], ["PK-BOX-IND", 1]],
    "TAU-DP-300": [["SBA-DP-PORT", 1], ["SBA-PCB-ASSY", 1], ["RM-CONN-AMP", 1], ["RM-CABLE-PTFE", 1], ["PK-BOX-IND", 1]],
    "TAU-EGT-400": [["SBA-EGT-PROBE", 1], ["SBA-PCB-ASSY", 1], ["RM-CONN-AMP", 1], ["RM-CABLE-PTFE", 1], ["PK-BOX-IND", 1]],
    "TAU-UQS-500": [["SBA-UQS-HEAD", 1], ["SBA-PCB-ASSY", 1], ["RM-CONN-AMP", 1], ["RM-CABLE-PTFE", 1], ["RM-POTTING", 0.05], ["PK-BOX-IND", 1]],
  };
  const bomMap: Record<string, string> = {};
  for (const [fg, lines] of Object.entries(bomDefs)) {
    const b = await db.bom.create({
      data: { itemId: itemMap[fg], revision: "A", status: "RELEASED", effectiveFrom: d(-90), releasedBy: "kmehta", releasedAt: d(-90), notes: "Pilot baseline — TBD: signed process validation before series activation" },
    });
    for (const [pn, qty] of lines) {
      await db.bomLine.create({ data: { bomId: b.id, componentItemId: itemMap[pn], qty, position: pn } });
    }
    bomMap[fg] = b.id;
  }
  // Draft rev B for ECO demo (potting vendor change)
  const bomB = await db.bom.create({
    data: { itemId: itemMap["TAU-NOX-100"], revision: "B", status: "DRAFT", notes: "ECO-2025-0001: alternate potting vendor — DRAFT, not usable in production" },
  });
  await db.bomLine.create({ data: { bomId: bomB.id, componentItemId: itemMap["RM-POTTING"], qty: 0.02 } });

  // ---------------------------------------------------------------- ROUTES (from spec baseline; versioned)
  const routeDefs: Record<string, Array<[string, string, string, boolean]>> = {
    NOX: [["OP-IQC", "IQC", "IQC-ELEMENT", false], ["OP-SUBASSY", "ASSEMBLY", "", true], ["OP-ELEC-ASSY", "ASSEMBLY", "", true], ["OP-JOIN", "ASSEMBLY", "", true], ["OP-SEAL", "ASSEMBLY", "", true], ["OP-PROG", "TEST", "", true], ["OP-CALIB", "CALIBRATION", "CAL-NOX", true], ["OP-EOL", "EOL", "EOL-NOX", true], ["OP-FININSP", "TEST", "FINAL-GENERIC", true], ["OP-PACK", "PACKING", "", true]],
    LAMBDA: [["OP-IQC", "IQC", "IQC-ELEMENT", false], ["OP-SUBASSY", "ASSEMBLY", "", true], ["OP-JOIN", "ASSEMBLY", "", true], ["OP-SEAL", "ASSEMBLY", "", true], ["OP-CONDITION", "TEST", "", true], ["OP-CALIB", "CALIBRATION", "CAL-LAMBDA", true], ["OP-EOL", "EOL", "EOL-LAMBDA", true], ["OP-FININSP", "TEST", "FINAL-GENERIC", true], ["OP-PACK", "PACKING", "", true]],
    DELTAP: [["OP-IQC", "IQC", "IQC-GENERIC", false], ["OP-BODYPREP", "ASSEMBLY", "", true], ["OP-ELEC-ASSY", "ASSEMBLY", "", true], ["OP-JOIN", "ASSEMBLY", "", true], ["OP-LEAK", "TEST", "", true], ["OP-CALIB", "CALIBRATION", "CAL-DELTAP", true], ["OP-EOL", "EOL", "EOL-DELTAP", true], ["OP-FININSP", "TEST", "FINAL-GENERIC", true], ["OP-PACK", "PACKING", "", true]],
    EGT: [["OP-IQC", "IQC", "IQC-GENERIC", false], ["OP-ELEMPREP", "ASSEMBLY", "", true], ["OP-SHEATH", "ASSEMBLY", "", true], ["OP-CONN", "ASSEMBLY", "", true], ["OP-CONTTEST", "TEST", "", true], ["OP-CALIB", "CALIBRATION", "CAL-EGT", true], ["OP-EOL", "EOL", "EOL-EGT", true], ["OP-FININSP", "TEST", "FINAL-GENERIC", true], ["OP-PACK", "PACKING", "", true]],
    UQS: [["OP-IQC", "IQC", "IQC-GENERIC", false], ["OP-ELEC-ASSY", "ASSEMBLY", "", true], ["OP-TANK", "ASSEMBLY", "", true], ["OP-POT", "ASSEMBLY", "", true], ["OP-PROG", "TEST", "", true], ["OP-FUNCCAL", "CALIBRATION", "CAL-UQS", true], ["OP-LEAK", "TEST", "", true], ["OP-EOL", "EOL", "EOL-UQS", true], ["OP-FININSP", "TEST", "FINAL-GENERIC", true], ["OP-PACK", "PACKING", "", true]],
  };
  const routeMap: Record<string, { id: string; steps: { id: string; seq: number; op: string; kind: string; tmpl: string }[] }> = {};
  for (const [fam, steps] of Object.entries(routeDefs)) {
    const r = await db.routeRevision.create({
      data: { familyCode: fam, name: `${fam} Baseline Route`, revision: "A", status: "RELEASED", effectiveFrom: d(-85), releasedBy: "kmehta", releasedAt: d(-85),
        notes: "Configurable baseline — pending signed route-validation workshop (DR-002)" },
    });
    let i = 1;
    const st: { id: string; seq: number; op: string; kind: string; tmpl: string }[] = [];
    // DR-006: skill codes required per operation (route qualification gate on job-card start)
    const skillByOp: Record<string, string> = {
      "OP-SUBASSY": "WIND-OP", "OP-SEAL": "SEAL-POT", "OP-POT": "SEAL-POT",
      "OP-CALIB": "CAL-OP", "OP-FUNCCAL": "CAL-OP", "OP-EOL": "EOL-TEST",
      "OP-FININSP": "VIS-IPC", "OP-PACK": "PACK-OP",
    };
    for (const [op, kind, tmpl] of steps) {
      const skill = skillByOp[op] ?? "";
      const s = await db.routeStep.create({
        data: { routeId: r.id, seq: i, operationCode: op, workstationKind: kind, mandatory: true,
          evidenceClass: kind, inspectionTemplateCode: tmpl, skillRequired: skill,
          description: `${op.replace("OP-", "").replace(/-/g, " ")} (${fam})${skill ? ` — skill ${skill} required` : ""}` },
      });
      st.push({ id: s.id, seq: i, op, kind, tmpl });
      i++;
    }
    routeMap[fam] = { id: r.id, steps: st };
  }

  // ---------------------------------------------------------------- INSPECTION TEMPLATES
  const t = (code: string, name: string, fam: string, kind: string, params: object[]) =>
    db.inspectionTemplate.create({ data: { code, name, familyCode: fam, kind, paramsJson: J(params) } });
  await t("IQC-ELEMENT", "IQC — Ceramic Element", "NOX", "IQC", [
    { name: "DC resistance", unit: "mΩ", lower: 1.8, upper: 3.2 }, { name: "Visual defect class", unit: "AQL", kind: "TEXT" },
  ]);
  await t("IQC-GENERIC", "IQC — Generic Dimensions", "", "IQC", [
    { name: "Dimension A", unit: "mm", lower: 9.9, upper: 10.1 }, { name: "Visual", unit: "-", kind: "TEXT" },
  ]);
  await t("CAL-NOX", "Calibration — NOx span/zero", "NOX", "CALIBRATION", [
    { name: "Zero point", unit: "ppm", lower: -12, upper: 12 }, { name: "Span 500ppm", unit: "ppm", lower: 485, upper: 515 }, { name: "Linearity", unit: "%", lower: 0, upper: 2.5 },
  ]);
  await t("CAL-LAMBDA", "Calibration — Lambda curve", "LAMBDA", "CALIBRATION", [
    { name: "Lambda 1.00 error", unit: "%", lower: -1.5, upper: 1.5 }, { name: "IPSI current", unit: "mA", lower: 8, upper: 12 },
  ]);
  await t("CAL-DELTAP", "Calibration — DP zero/span", "DELTAP", "CALIBRATION", [
    { name: "Zero (0 kPa)", unit: "kPa", lower: -0.15, upper: 0.15 }, { name: "Span (100 kPa)", unit: "kPa", lower: 98.5, upper: 101.5 },
  ]);
  await t("CAL-EGT", "Calibration — EGT reference", "EGT", "CALIBRATION", [
    { name: "Error @300°C", unit: "°C", lower: -4, upper: 4 }, { name: "Error @800°C", unit: "°C", lower: -6, upper: 6 },
  ]);
  await t("CAL-UQS", "Calibration — UQS medium check", "UQS", "CALIBRATION", [
    { name: "Urea 32.5% reading", unit: "%", lower: 31.5, upper: 33.5 }, { name: "Level linearity", unit: "%", lower: 0, upper: 2 },
  ]);
  const eolParams = (resp: number) => [
    { name: "Response time", unit: "s", lower: 0, upper: resp }, { name: "Leak rate", unit: "sccm", lower: 0, upper: 1.0 },
    { name: "Output range check", unit: "-", kind: "TEXT" }, { name: "Firmware version", unit: "-", kind: "TEXT" },
  ];
  await t("EOL-NOX", "EOL — NOx", "NOX", "EOL", eolParams(7.5));
  await t("EOL-LAMBDA", "EOL — Lambda", "LAMBDA", "EOL", eolParams(6.0));
  await t("EOL-DELTAP", "EOL — Delta-P", "DELTAP", "EOL", eolParams(3.0));
  await t("EOL-EGT", "EOL — EGT", "EGT", "EOL", eolParams(4.0));
  await t("EOL-UQS", "EOL — UQS", "UQS", "EOL", eolParams(5.0));
  await t("FINAL-GENERIC", "Final Inspection & Label", "", "FINAL", [
    { name: "Label / laser mark", unit: "-", kind: "TEXT" }, { name: "Packaging check", unit: "-", kind: "TEXT" },
  ]);

  // ---------------------------------------------------------------- RFQ + QUOTATIONS + POs
  const rfq1 = await db.rfq.create({ data: { number: "RFQ-2025-0001", itemId: itemMap["RM-CERAM-ELEM"], qty: 500, dueDate: d(30), status: "AWARDED" } });
  await db.supplierQuotation.create({ data: { rfqId: rfq1.id, supplierId: supBHC.id, unitPrice: 208, leadTimeDays: 21, moq: 250, selected: true, status: "SELECTED" } });
  await db.supplierQuotation.create({ data: { rfqId: rfq1.id, supplierId: supPPM.id, unitPrice: 226, leadTimeDays: 30, moq: 100, status: "REJECTED" } });

  const po1 = await db.purchaseOrder.create({
    data: { poNumber: "PO-2025-0001", supplierId: supBHC.id, status: "RECEIVED", orderDate: d(-40), expectedDate: d(-15), totalAmount: 104000, approvedBy: "kmehta" },
  });
  await db.poLine.create({ data: { poId: po1.id, itemId: itemMap["RM-CERAM-ELEM"], qty: 500, receivedQty: 500, unitPrice: 208, gstRate: 18 } });
  const po2 = await db.purchaseOrder.create({
    data: { poNumber: "PO-2025-0002", supplierId: supPPM.id, status: "PARTIAL", orderDate: d(-25), expectedDate: d(5), totalAmount: 132000, approvedBy: "tbose" },
  });
  await db.poLine.create({ data: { poId: po2.id, itemId: itemMap["RM-HOUSING-SS"], qty: 800, receivedQty: 400, unitPrice: 165, gstRate: 18 } });
  const po3 = await db.purchaseOrder.create({
    data: { poNumber: "PO-2025-0003", supplierId: supACS.id, status: "RECEIVED", orderDate: d(-30), expectedDate: d(-8), totalAmount: 19000, approvedBy: "tbose" },
  });
  await db.poLine.create({ data: { poId: po3.id, itemId: itemMap["RM-POTTING"], qty: 200, receivedQty: 200, unitPrice: 95, gstRate: 18 } });
  const po4 = await db.purchaseOrder.create({
    data: { poNumber: "PO-2025-0004", supplierId: supELX.id, status: "PENDING_APPROVAL", orderDate: d(-2), expectedDate: d(20), totalAmount: 51000 },
  });
  await db.poLine.create({ data: { poId: po4.id, itemId: itemMap["RM-PCB-DRV"], qty: 150, unitPrice: 340, gstRate: 18 } });

  // ---------------------------------------------------------------- GRNs + LOTS + IQC
  // GRN-0001: ceramics — IQC PASS
  const grn1 = await db.goodsReceipt.create({ data: { grnNumber: "GRN-2025-0001", poId: po1.id, supplierId: supBHC.id, receivedBy: "mdesh", status: "IQC_DONE", receivedAt: d(-18), remarks: "Supplier lot BC-2411-A — certs attached (SYNTHETIC)" } });
  const gl1 = await db.grnLine.create({ data: { grnId: grn1.id, poLineId: null, itemId: itemMap["RM-CERAM-ELEM"], qty: 500, supplierBatch: "BC-2411-A", manufacturerRef: "BHC-L24-1188", disposition: "ACCEPTED" } });
  const lotCeram = await db.stockLot.create({ data: { lotNumber: "B-BC2411A", itemId: itemMap["RM-CERAM-ELEM"], trackingType: "BATCH", status: "IN_STOCK", warehouseCode: "WH-ACC", qty: 500, supplierBatch: "BC-2411-A", grnLineId: gl1.id } });
  await db.inspection.create({
    data: { inspNumber: "INSP-2025-0001", kind: "IQC", templateCode: "IQC-ELEMENT", refType: "GRN_LINE", refId: gl1.id, lotNumber: "B-BC2411A",
      equipmentCode: "GAUGE-DMM-01", status: "PASSED", overallResult: "PASS", immutable: true, submittedAt: d(-17), approvedBy: "lkrish", grnLineId: gl1.id,
      resultsJson: J([
        { parameter: "DC resistance", unit: "mΩ", value: 2.4, lower: 1.8, upper: 3.2, pass: true },
        { parameter: "Visual defect class", unit: "AQL", value: "OK", pass: true },
      ]) },
  });
  await db.stockMovement.create({ data: { lotId: lotCeram.id, type: "RECEIPT", qty: 500, toWh: "WH-IQC", refType: "GRN", refId: "GRN-2025-0001", userId: "mdesh" } });
  await db.stockMovement.create({ data: { lotId: lotCeram.id, type: "IQC_ACCEPT", qty: 500, fromWh: "WH-IQC", toWh: "WH-ACC", refType: "INSP", refId: "INSP-2025-0001", userId: "lsethi" } });

  // GRN-0002: housings — IQC PASS (partial receipt of PO-0002)
  const grn2 = await db.goodsReceipt.create({ data: { grnNumber: "GRN-2025-0002", poId: po2.id, supplierId: supPPM.id, receivedBy: "mdesh", status: "IQC_DONE", receivedAt: d(-10) } });
  const gl2 = await db.grnLine.create({ data: { grnId: grn2.id, itemId: itemMap["RM-HOUSING-SS"], qty: 400, supplierBatch: "PP-8812", disposition: "ACCEPTED" } });
  const lotHousing = await db.stockLot.create({ data: { lotNumber: "B-PP8812", itemId: itemMap["RM-HOUSING-SS"], trackingType: "BATCH", status: "IN_STOCK", warehouseCode: "WH-ACC", qty: 400, supplierBatch: "PP-8812", grnLineId: gl2.id } });
  await db.inspection.create({
    data: { inspNumber: "INSP-2025-0002", kind: "IQC", templateCode: "IQC-GENERIC", refType: "GRN_LINE", refId: gl2.id, lotNumber: "B-PP8812",
      status: "PASSED", overallResult: "PASS", immutable: true, submittedAt: d(-9), grnLineId: gl2.id,
      resultsJson: J([{ parameter: "Dimension A", unit: "mm", value: 10.02, lower: 9.9, upper: 10.1, pass: true }, { parameter: "Visual", unit: "-", value: "OK", pass: true }]) },
  });
  await db.stockMovement.create({ data: { lotId: lotHousing.id, type: "IQC_ACCEPT", qty: 400, fromWh: "WH-IQC", toWh: "WH-ACC", refType: "INSP", refId: "INSP-2025-0002", userId: "lsethi" } });

  // GRN-0003: potting — IQC FAIL → NCR story
  const grn3 = await db.goodsReceipt.create({ data: { grnNumber: "GRN-2025-0003", poId: po3.id, supplierId: supACS.id, receivedBy: "mdesh", status: "IQC_DONE", receivedAt: d(-6), remarks: "Batch ACS-1120 — viscosity out of specification" } });
  const gl3 = await db.grnLine.create({ data: { grnId: grn3.id, itemId: itemMap["RM-POTTING"], qty: 200, supplierBatch: "ACS-1120", disposition: "REJECTED" } });
  const lotPot = await db.stockLot.create({ data: { lotNumber: "B-ACS1120", itemId: itemMap["RM-POTTING"], trackingType: "BATCH", status: "REJECTED", warehouseCode: "WH-REJ", qty: 200, supplierBatch: "ACS-1120", grnLineId: gl3.id, expiryDate: d(240) } });
  const inspFail = await db.inspection.create({
    data: { inspNumber: "INSP-2025-0003", kind: "IQC", templateCode: "IQC-GENERIC", refType: "GRN_LINE", refId: gl3.id, lotNumber: "B-ACS1120",
      status: "FAILED", overallResult: "FAIL", immutable: true, submittedAt: d(-5), grnLineId: gl3.id,
      resultsJson: J([{ parameter: "Viscosity", unit: "Pa·s", value: 6.8, lower: 4.0, upper: 5.5, pass: false }, { parameter: "Visual", unit: "-", value: "Gel particles observed", pass: false }]) },
  });
  await db.stockMovement.create({ data: { lotId: lotPot.id, type: "IQC_REJECT", qty: 200, fromWh: "WH-IQC", toWh: "WH-REJ", refType: "INSP", refId: "INSP-2025-0003", userId: "lsethi" } });

  // SCARs — supplier corrective loop on the rejected potting batch + a closed history case
  await db.scar.create({
    data: {
      scarNumber: "SCAR-2025-0001", supplierId: supACS.id, grnNumber: grn3.grnNumber, inspectionRef: "INSP-2025-0003",
      lotNumbersJson: J(["B-ACS1120"]), partSummary: "RM-POTTING × 200",
      defectDescription: "Viscosity 6.8 Pa·s above the 4.0–5.5 Pa·s specification with gel particles observed on visual check (IQC INSP-2025-0003). Batch ACS-1120 rejected and quarantined in WH-REJ.",
      severity: "CRITICAL",
      containment: "Lot B-ACS1120 (200 Kg) held in WH-REJ — no issue to production. BOM usage of RM-POTTING flagged; alternate approved batch sourced for WO demand.",
      responseDue: d(-2), // overdue → demonstrates the response-overdue escalation badge
      status: "OPEN", raisedBy: "lkrish", createdAt: d(-5),
    },
  });
  await db.scar.create({
    data: {
      scarNumber: "SCAR-2024-0004", supplierId: supPPM.id, grnNumber: "GRN-2024-0011", inspectionRef: "INSP-2024-0107",
      lotNumbersJson: J(["B-SSR4921"]), partSummary: "RM-HOUSING-SS × 120",
      defectDescription: "Dimensional drift on housing bore (10.14 mm vs 9.9–10.1 mm limit) across 3 consecutive lots — corrective action on CNC fixture alignment.",
      severity: "MAJOR",
      containment: "Affected lots re-sorted 100% at goods-in; conforming stock released, drift lots returned.",
      responseDue: d(-90),
      supplierResponse: "Root cause: fixture clamp wear on CNC-04. Corrective action: fixture rebuilt with hardened clamps, first-article checks added per shift. Prevention: fixture preventive-maintenance interval reduced from 6 to 3 months (PPAP-level revalidated).",
      respondedAt: d(-75), status: "CLOSED", raisedBy: "lkrish", closedBy: "tbose", closedAt: d(-60), createdAt: d(-95),
      evidenceJson: J([
        { name: "fixture-rebuild-photos.zip", size: 1_842_000, kind: "PHOTO", uploadedBy: "tbose", uploadedAt: d(-64).toISOString() },
        { name: "CNC-04-first-article-CMM-report.pdf", size: 428_000, kind: "TEST_REPORT", uploadedBy: "tbose", uploadedAt: d(-63).toISOString() },
      ]),
    },
  });

  // Subassembly serials pre-built in WH-WIP
  const sbaLots: Record<string, string[]> = { "SBA-NOX-ELEM": [], "SBA-LAM-ELEM": [], "SBA-PCB-ASSY": [], "SBA-DP-PORT": [], "SBA-EGT-PROBE": [], "SBA-UQS-HEAD": [] };
  const sbaCounts: Record<string, number> = { "SBA-NOX-ELEM": 10, "SBA-LAM-ELEM": 6, "SBA-PCB-ASSY": 14, "SBA-DP-PORT": 4, "SBA-EGT-PROBE": 4, "SBA-UQS-HEAD": 3 };
  const sbaPrefix: Record<string, string> = { "SBA-NOX-ELEM": "NXE", "SBA-LAM-ELEM": "LME", "SBA-PCB-ASSY": "PCB", "SBA-DP-PORT": "DPP", "SBA-EGT-PROBE": "EGP", "SBA-UQS-HEAD": "UQH" };
  for (const [pn, n] of Object.entries(sbaCounts)) {
    for (let i = 1; i <= n; i++) {
      const sn = `SN-${sbaPrefix[pn]}-25-${String(i).padStart(4, "0")}`;
      const lot = await db.stockLot.create({ data: { lotNumber: sn, itemId: itemMap[pn], trackingType: "SERIAL", status: "IN_STOCK", warehouseCode: "WH-WIP", qty: 1, woNumber: "PILOT" } });
      sbaLots[pn].push(lot.id);
    }
  }

  // ---------------------------------------------------------------- WO-0001 — NOx full lifecycle (qty 6)
  const r = routeMap.NOX;
  const wo1 = await db.workOrder.create({
    data: { woNumber: "WO-2025-0001", itemId: itemMap["TAU-NOX-100"], familyCode: "NOX", bomId: bomMap["TAU-NOX-100"], routeId: r.id,
      bomRevision: "A", routeRevision: "A", qtyPlanned: 6, qtyCompleted: 6, status: "COMPLETED", priority: "HIGH", soNumber: "SO-2025-0001",
      dueDate: d(2), plannedStart: d(-12), releasedBy: "akhan", releasedAt: d(-12), closedAt: d(-2) },
  });
  await db.travellerEvent.create({ data: { woId: wo1.id, kind: "RELEASED", message: "Work order released against SO-2025-0001 (BOM A / Route A)", userName: "akhan" } });
  // job cards all completed
  for (const s of r.steps) {
    await db.jobCard.create({
      data: { woId: wo1.id, stepId: s.id, operationCode: s.op, workstationCode: s.kind === "IQC" ? "WS-IQC-01" : s.kind === "ASSEMBLY" ? "WS-ASSY-01" : s.kind === "CALIBRATION" ? "WS-CAL-01" : s.kind === "EOL" ? "WS-EOL-01" : s.kind === "PACKING" ? "WS-PACK-01" : "WS-TEST-01",
        status: "COMPLETED", operatorId: null, qtyGood: 6, qtyScrap: 0, startedAt: d(-11), completedAt: d(-3), sequence: s.seq,
        evidence: s.tmpl ? `INSP attached (${s.tmpl})` : "Operator confirmation + traveller event" },
    });
  }
  // FG serials + genealogy + CAL/EOL/FINAL inspections + releases
  const fgSerials: { lotId: string; lotNumber: string }[] = [];
  for (let i = 1; i <= 6; i++) {
    const sn = `SN-NOX-25-${String(i).padStart(4, "0")}`;
    const lot = await db.stockLot.create({ data: { lotNumber: sn, itemId: itemMap["TAU-NOX-100"], trackingType: "SERIAL", status: "IN_STOCK", warehouseCode: "WH-FG", qty: 1, woNumber: "WO-2025-0001" } });
    fgSerials.push({ lotId: lot.id, lotNumber: sn });
    // genealogy binds
    await db.genealogyLink.create({ data: { parentLotId: lot.id, childLotId: sbaLots["SBA-NOX-ELEM"][i - 1], woNumber: "WO-2025-0001", operationCode: "OP-SUBASSY", quantity: 1 } });
    await db.genealogyLink.create({ data: { parentLotId: lot.id, childLotId: sbaLots["SBA-PCB-ASSY"][i - 1], woNumber: "WO-2025-0001", operationCode: "OP-ELEC-ASSY", quantity: 1 } });
    await db.genealogyLink.create({ data: { parentLotId: lot.id, childLotId: lotCeram.id, woNumber: "WO-2025-0001", operationCode: "OP-SUBASSY", quantity: 0.02 } });
    await db.genealogyLink.create({ data: { parentLotId: lot.id, childLotId: lotHousing.id, woNumber: "WO-2025-0001", operationCode: "OP-JOIN", quantity: 1 } });
    // CAL
    const calOk = true;
    await db.inspection.create({
      data: { inspNumber: `INSP-2025-${String(10 + i).padStart(4, "0")}`, kind: "CALIBRATION", templateCode: "CAL-NOX", refType: "LOT", refId: lot.id, lotNumber: sn, woNumber: "WO-2025-0001",
        equipmentCode: "CAL-RIG-01", status: "PASSED", overallResult: "PASS", immutable: true, submittedAt: d(-5),
        resultsJson: J([{ parameter: "Zero point", unit: "ppm", value: (Math.random() * 8 - 4).toFixed(1), lower: -12, upper: 12, pass: true },
          { parameter: "Span 500ppm", unit: "ppm", value: (495 + Math.random() * 8).toFixed(1), lower: 485, upper: 515, pass: true },
          { parameter: "Linearity", unit: "%", value: (Math.random() * 1.6).toFixed(2), lower: 0, upper: 2.5, pass: true }]) },
    });
    // EOL — serial 3 fails attempt 1 → retest attempt 2 passes (failure preserved!)
    if (i === 3) {
      await db.inspection.create({
        data: { inspNumber: `INSP-2025-${String(20 + i).padStart(4, "0")}`, kind: "EOL", templateCode: "EOL-NOX", refType: "LOT", refId: lot.id, lotNumber: sn, woNumber: "WO-2025-0001",
          equipmentCode: "EOL-BENCH-01", attempt: 1, status: "FAILED", overallResult: "FAIL", immutable: true, submittedAt: d(-4),
          resultsJson: J([{ parameter: "Response time", unit: "s", value: 8.2, lower: 0, upper: 7.5, pass: false },
            { parameter: "Leak rate", unit: "sccm", value: 0.3, lower: 0, upper: 1.0, pass: true },
            { parameter: "Firmware version", unit: "-", value: "FW-NOX-1.4.2", pass: true }]) },
      });
      await db.inspection.create({
        data: { inspNumber: `INSP-2025-${String(30 + i).padStart(4, "0")}`, kind: "EOL", templateCode: "EOL-NOX", refType: "LOT", refId: lot.id, lotNumber: sn, woNumber: "WO-2025-0001",
          equipmentCode: "EOL-BENCH-01", attempt: 2, retestReason: "Authorized retest after NCR-2025-0001 rework (connector reseated, heater contact restored)",
          status: "PASSED", overallResult: "PASS", immutable: true, submittedAt: d(-3), approvedBy: "lkrish",
          resultsJson: J([{ parameter: "Response time", unit: "s", value: 6.4, lower: 0, upper: 7.5, pass: true },
            { parameter: "Leak rate", unit: "sccm", value: 0.2, lower: 0, upper: 1.0, pass: true },
            { parameter: "Firmware version", unit: "-", value: "FW-NOX-1.4.2", pass: true }]) },
      });
    } else {
      await db.inspection.create({
        data: { inspNumber: `INSP-2025-${String(20 + i).padStart(4, "0")}`, kind: "EOL", templateCode: "EOL-NOX", refType: "LOT", refId: lot.id, lotNumber: sn, woNumber: "WO-2025-0001",
          equipmentCode: "EOL-BENCH-01", status: "PASSED", overallResult: "PASS", immutable: true, submittedAt: d(-4),
          resultsJson: J([{ parameter: "Response time", unit: "s", value: (5 + Math.random() * 1.8).toFixed(1), lower: 0, upper: 7.5, pass: true },
            { parameter: "Leak rate", unit: "sccm", value: (Math.random() * 0.5).toFixed(2), lower: 0, upper: 1.0, pass: true },
            { parameter: "Firmware version", unit: "-", value: "FW-NOX-1.4.2", pass: true }]) },
      });
    }
    // FINAL
    await db.inspection.create({
      data: { inspNumber: `INSP-2025-${String(40 + i).padStart(4, "0")}`, kind: "FINAL", templateCode: "FINAL-GENERIC", refType: "LOT", refId: lot.id, lotNumber: sn, woNumber: "WO-2025-0001",
        status: "PASSED", overallResult: "PASS", immutable: true, submittedAt: d(-3),
        resultsJson: J([{ parameter: "Label / laser mark", unit: "-", value: "OK", pass: true }, { parameter: "Packaging check", unit: "-", value: "OK", pass: true }]) },
    });
    // RELEASE
    await db.productRelease.create({
      data: { releaseNumber: `REL-2025-${String(i).padStart(4, "0")}`, lotNumber: sn, woNumber: "WO-2025-0001",
        checksJson: J({ genealogyComplete: true, inspectionsPassed: true, calibrationOk: true, eolOk: true, finalOk: true }),
        status: "RELEASED", releasedBy: "lkrish", approvedBy: "nkulk", releasedAt: d(-3), blockersJson: J([]) },
    });
    void calOk;
  }
  await db.travellerEvent.create({ data: { woId: wo1.id, kind: "FG_RECEIPT", message: "6 finished serials received into WH-FG", userName: "mdesh" } });

  // NCR-0001 story for SN-NOX-25-0003 EOL failure
  const ncr1 = await db.ncr.create({
    data: { ncrNumber: "NCR-2025-0001", inspectionId: null, sourceRef: "EOL INSP-2025-0023 (attempt 1) — response time 8.2s > 7.5s", lotNumber: "SN-NOX-25-0003", woNumber: "WO-2025-0001",
      severity: "MAJOR", description: "EOL response time out of limit on initial test. Suspected heater contact intermittent at connector.",
      containmentJson: J(["SN-NOX-25-0003 held at EOL bench", "Connector lot B-AMP-2241 flagged for watch", "No shipments affected"]),
      status: "CLOSED", raisedBy: "lsethi", closedAt: d(-3) },
  });
  await db.mrbDecision.create({
    data: { ncrId: ncr1.id, disposition: "REWORK", justification: "Unit recoverable — reseat connector, verify heater contact, repeat EOL as authorized retest.",
      decidedBy: "lsethi", approvedBy: "lkrish", stockAction: "Lot moved WH-WIP → WH-REWORK → back to EOL queue" },
  });
  await db.reworkOrder.create({
    data: { rwNumber: "RW-2025-0001", ncrId: ncr1.id, woNumber: "WO-2025-0001", targetLotNumber: "SN-NOX-25-0003",
      instructions: "1) Reseat connector per WI-114. 2) Verify heater contact <3.2 mΩ. 3) Re-run EOL-NOX as attempt 2. 4) Quality re-verification.",
      authorizedBy: "lkrish", status: "DONE", outcome: "Retest attempt 2 PASSED (INSP-2025-0033). Unit returned to flow and released." },
  });
  await db.capa.create({
    data: { capaNumber: "CAPA-2025-0001", ncrId: ncr1.id, kind: "CORRECTIVE", problem: "Intermittent heater contact at connector mating during EOL.",
      rootCause: "Connector crimp height drift on lot B-AMP-2241 (under verification)",
      actionsJson: J([{ action: "Crimp height cross-check on remaining connector stock", owner: "rpawar", dueDate: d(7).toISOString().slice(0, 10), done: true },
        { action: "Supplier corrective action request to connector vendor", owner: "tbose", dueDate: d(14).toISOString().slice(0, 10), done: false },
        { action: "Add mating-force check at OP-ELEC-ASSY (poka-yoke study)", owner: "ciyer", dueDate: d(21).toISOString().slice(0, 10), done: false }]),
      owner: "lkrish", dueDate: d(21), status: "VERIFICATION" },
  });

  // Container + DN + Invoice for WO-0001
  const ctn = await db.container.create({ data: { containerNumber: "CTN-2025-0001", kind: "BOX", status: "DISPATCHED", dnNumber: "DN-2025-0001" } });
  for (const s of fgSerials) {
    await db.containerMember.create({ data: { containerId: ctn.id, lotId: s.lotId } });
  }

  const so1 = await db.salesOrder.create({
    data: { soNumber: "SO-2025-0001", customerId: cusVel.id, status: "DISPATCHED", orderDate: d(-14), totalAmount: 60180, programme: "PM-BS6-P2" },
  });
  await db.soLine.create({ data: { soId: so1.id, itemId: itemMap["TAU-NOX-100"], qty: 6, unitPrice: 8500, gstRate: 18, deliveredQty: 6 } });
  const q1 = await db.quotation.create({
    data: { quoteNumber: "QUO-2025-0001", customerId: cusVel.id, status: "CONVERTED", validUntil: d(30), totalAmount: 60180, notes: "BS-VI P2 programme — NOx sensors" },
  });
  await db.quoteLine.create({ data: { quotationId: q1.id, itemId: itemMap["TAU-NOX-100"], qty: 6, unitPrice: 8500 } });

  const dn1 = await db.deliveryNote.create({
    data: { dnNumber: "DN-2025-0001", soId: so1.id, status: "DISPATCHED", vehicleNo: "MH12SYN4455", ewayBillNo: "EWB-SYNTH-881234567890", dispatchedAt: d(-2) },
  });
  for (const s of fgSerials) {
    await db.deliveryLine.create({ data: { dnId: dn1.id, itemId: itemMap["TAU-NOX-100"], lotNumber: s.lotNumber, qty: 1 } });
    await db.stockMovement.create({ data: { lotId: s.lotId, type: "SHIP", qty: 1, fromWh: "WH-FG", toWh: "CUSTOMER", refType: "DN", refId: "DN-2025-0001", userId: "snair" } });
  }
  // mark serials shipped? Keep IN_STOCK at WH-FG? Spec-wise shipped serials become SHIPPED.
  for (const s of fgSerials) {
    await db.stockLot.update({ where: { id: s.lotId }, data: { status: "SHIPPED", warehouseCode: "WH-FG" } });
  }

  const inv1 = await db.salesInvoice.create({
    data: { invoiceNumber: "INV-2025-0001", dnId: dn1.id, soId: so1.id, customerId: cusVel.id, taxableValue: 51000, cgst: 4590, sgst: 4590, igst: 0,
      total: 60180, placeOfSupply: "MH", status: "EINVOICED", irn: "a3f8c2e91b6d4f0785e2c1d9b0a7f342e6d5c8b9a1f0e3d2c4b6a8f0e1d2c3b4", irnAt: d(-1),
      qrPayloadJson: J({ SellerGSTIN: "27SYNTH0000TAU1Z9", BuyerGSTIN: "27SYNTHVEL0001Z2", DocNo: "INV-2025-0001", TotAmt: 60180, IRN: "a3f8…c3b4 (SYNTHETIC)" }), synthetic: true },
  });
  await db.eInvoiceLog.create({
    data: { invoiceNumber: "INV-2025-0001", idempotencyKey: "IDM-INV-2025-0001-irn-request", correlationId: "corr-9f2a71", mode: "SANDBOX_MOCK",
      requestJson: J({ action: "GENERATE_IRN", docNo: "INV-2025-0001", seller: "27SYNTH0000TAU1Z9", buyer: "27SYNTHVEL0001Z2", value: 60180 }),
      responseJson: J({ irn: "a3f8c2e9…c3b4", ackNo: "SYNTH-112233", ackDate: d(-1).toISOString(), note: "MOCK — not a statutory document" }),
      status: "SUCCESS", attempts: 1 },
  });
  // duplicate submission prevented — second attempt returns cached IRN (idempotency demo)
  await db.eInvoiceLog.create({
    data: { invoiceNumber: "INV-2025-0001", idempotencyKey: "IDM-INV-2025-0001-irn-request-retry-demo", correlationId: "corr-9f2a72", mode: "SANDBOX_MOCK",
      requestJson: J({ action: "GENERATE_IRN", docNo: "INV-2025-0001", note: "duplicate request — served from idempotency cache" }),
      responseJson: J({ irn: "a3f8c2e9…c3b4", deduplicated: true }), status: "SUCCESS", attempts: 1 },
  });

  // ---------------------------------------------------------------- WO-0002 LAMBDA — IN PROGRESS
  const r2 = routeMap.LAMBDA;
  const wo2 = await db.workOrder.create({
    data: { woNumber: "WO-2025-0002", itemId: itemMap["TAU-LAM-200"], familyCode: "LAMBDA", bomId: bomMap["TAU-LAM-200"], routeId: r2.id,
      bomRevision: "A", routeRevision: "A", qtyPlanned: 4, qtyCompleted: 0, status: "IN_PROGRESS", priority: "NORMAL", soNumber: "SO-2025-0002",
      dueDate: d(6), plannedStart: d(-4), releasedBy: "akhan", releasedAt: d(-4) },
  });
  let seq = 0;
  for (const s of r2.steps) {
    seq++;
    const st = s.op === "OP-IQC" ? "COMPLETED" : s.op === "OP-SUBASSY" ? "IN_PROGRESS" : "PENDING";
    await db.jobCard.create({
      data: { woId: wo2.id, stepId: s.id, operationCode: s.op, workstationCode: s.kind === "ASSEMBLY" ? "WS-ASSY-01" : s.kind === "CALIBRATION" ? "WS-CAL-01" : s.kind === "EOL" ? "WS-EOL-01" : s.kind === "PACKING" ? "WS-PACK-01" : s.kind === "IQC" ? "WS-IQC-01" : "WS-TEST-01",
        status: st, qtyGood: st === "COMPLETED" ? 4 : 0, startedAt: st !== "PENDING" ? d(-3) : null, sequence: s.seq },
    });
  }
  await db.travellerEvent.create({ data: { woId: wo2.id, kind: "RELEASED", message: "Released for SO-2025-0002", userName: "akhan" } });
  await db.travellerEvent.create({ data: { woId: wo2.id, kind: "ISSUE", message: "Components staged: SBA-LAM-ELEM ×4, SBA-PCB-ASSY ×5", userName: "mdesh" } });

  // ---------------------------------------------------------------- WO-0003 DELTAP (CREATED), WO-0004 EGT (RELEASED), WO-0005 UQS (CREATED)
  const wo3 = await db.workOrder.create({
    data: { woNumber: "WO-2025-0003", itemId: itemMap["TAU-DP-300"], familyCode: "DELTAP", bomId: bomMap["TAU-DP-300"], routeId: routeMap.DELTAP.id,
      bomRevision: "A", routeRevision: "A", qtyPlanned: 4, status: "CREATED", priority: "NORMAL", soNumber: "", dueDate: d(12) },
  });
  await db.travellerEvent.create({ data: { woId: wo3.id, kind: "CREATED", message: "Suggested by MRP run MRP-2025-0001 — net requirement 4", userName: "akhan" } });
  const wo4 = await db.workOrder.create({
    data: { woNumber: "WO-2025-0004", itemId: itemMap["TAU-EGT-400"], familyCode: "EGT", bomId: bomMap["TAU-EGT-400"], routeId: routeMap.EGT.id,
      bomRevision: "A", routeRevision: "A", qtyPlanned: 4, status: "RELEASED", priority: "HIGH", dueDate: d(9), releasedBy: "akhan", releasedAt: d(-1) },
  });
  await db.travellerEvent.create({ data: { woId: wo4.id, kind: "CREATED", message: "Suggested by MRP run MRP-2025-0001 — net requirement 4 (planner confirmed against W-51 capacity note)", userName: "akhan" } });
  for (const s of routeMap.EGT.steps) {
    await db.jobCard.create({
      data: { woId: wo4.id, stepId: s.id, operationCode: s.op, workstationCode: s.kind === "ASSEMBLY" ? "WS-ASSY-02" : s.kind === "CALIBRATION" ? "WS-CAL-02" : s.kind === "EOL" ? "WS-EOL-01" : s.kind === "PACKING" ? "WS-PACK-01" : s.kind === "IQC" ? "WS-IQC-01" : "WS-TEST-01",
        status: "READY", sequence: s.seq },
    });
  }
  await db.workOrder.create({
    data: { woNumber: "WO-2025-0005", itemId: itemMap["TAU-UQS-500"], familyCode: "UQS", bomId: bomMap["TAU-UQS-500"], routeId: routeMap.UQS.id,
      bomRevision: "A", routeRevision: "A", qtyPlanned: 3, status: "CREATED", priority: "LOW", dueDate: d(20) },
  }).then((wo5) =>
    db.travellerEvent.create({ data: { woId: wo5.id, kind: "CREATED", message: "Suggested by MRP run MRP-2025-0001 — net requirement 3", userName: "akhan" } }),
  );

  // SO-0002 for WO-0002
  const so2 = await db.salesOrder.create({
    data: { soNumber: "SO-2025-0002", customerId: cusTorq.id, status: "IN_PRODUCTION", orderDate: d(-5), totalAmount: 80240, programme: "PM-DP-17" },
  });
  await db.soLine.create({ data: { soId: so2.id, itemId: itemMap["TAU-LAM-200"], qty: 10, unitPrice: 6800, gstRate: 18, deliveredQty: 0 } });

  // ---------------------------------------------------------------- NCR-0002 (potting batch — MRB pending, four-eyes open)
  const ncr2 = await db.ncr.create({
    data: { ncrNumber: "NCR-2025-0002", inspectionId: null, sourceRef: "IQC INSP-2025-0003 — viscosity 6.8 Pa·s > 5.5 upper limit", lotNumber: "B-ACS1120", woNumber: "WO-2025-0002",
      severity: "MAJOR", description: "Potting compound batch ACS-1120 out of viscosity specification with gel particles.",
      containmentJson: J(["B-ACS1120 (200 Kg) quarantined in WH-REJ", "BOM lines using RM-POTTING flagged — no issue to WO", "Supplier ACS notified (SCAR pending)"]),
      status: "MRB", raisedBy: "lsethi" },
  });
  // MRB decision awaits FOUR-EYES: decidedBy lsethi, approvedBy pending lkrish (demo of pending approval)

  // ---------------------------------------------------------------- APQP / PPAP
  const apqp1 = await db.apqpProject.create({
    data: { number: "APQP-2025-0001", itemId: itemMap["TAU-UQS-500"], customerId: cusTorq.id, title: "UQS-500 launch for PM-UQS-9", status: "IN_PROGRESS", startDate: d(-60), targetDate: d(45) },
  });
  const gateNames = ["Gate 1 — Plan & Define", "Gate 2 — Product Design", "Gate 3 — Process Design", "Gate 4 — Product & Process Validation", "Gate 5 — Launch Feedback"];
  for (let i = 0; i < 5; i++) {
    await db.apqpGate.create({
      data: { projectId: apqp1.id, seq: i + 1, name: gateNames[i], status: i === 0 ? "APPROVED" : i === 1 ? "IN_PROGRESS" : "PENDING",
        plannedDate: d(-30 + i * 18), actualDate: i === 0 ? d(-31) : null, deliverables: "Team feasibility, DFMEA/PFMEA links, control plan draft, MSA plan, PPAP evidence per level 3" },
    });
  }
  await db.ppapSubmission.create({
    data: { number: "PPAP-2025-0001", projectId: apqp1.id, level: 3, status: "PREPARING",
      evidenceJson: J(["Design records", "PFMEA", "Process flow", "Control plan (draft)", "MSA plan", "Dimensional results (TBD)", "Material certs (TBD)", "PSW (TBD)"]) },
  });
  const apqp2 = await db.apqpProject.create({
    data: { number: "APQP-2025-0002", itemId: itemMap["TAU-DP-300"], customerId: cusVel.id, title: "Delta-P 300 programme PM-BS6-P2", status: "APPROVED", startDate: d(-160), targetDate: d(-20) },
  });
  for (let i = 0; i < 5; i++) {
    await db.apqpGate.create({ data: { projectId: apqp2.id, seq: i + 1, name: gateNames[i], status: "APPROVED", plannedDate: d(-140 + i * 24), actualDate: d(-140 + i * 24) } });
  }
  await db.ppapSubmission.create({
    data: { number: "PPAP-2025-0002", projectId: apqp2.id, level: 3, status: "APPROVED", pswNumber: "PSW-SYNTH-0044", submittedAt: d(-30), disposition: "APPROVED — full approval" },
  });

  // ---------------------------------------------------------------- ECO / ECR
  await db.engineeringChange.create({
    data: { number: "ECO-2025-0001", kind: "ECO", title: "Alternate potting compound vendor (post ACS-1120 NCR)", reason: "Quality risk with ACS batch; dual-source potting.",
      status: "IMPACT_REVIEW", impactJson: J({ openPO: 1, affectedBOMs: ["TAU-NOX-100 rev A→B", "TAU-UQS-500 rev A"], wip: 0, customers: [], notes: "BOM rev B in DRAFT — cannot be used until released" }),
      effectivity: "NEXT_WO", effectivityDate: d(14), requestedBy: "ciyer", approvedBy: "" },
  });
  await db.engineeringChange.create({
    data: { number: "ECR-2025-0002", kind: "ECR", title: "Extended temperature rating study for EGT-400", reason: "Customer request — 1050°C continuous rating.",
      status: "TRIAGE", impactJson: J({ notes: "Feasibility TBD — OWNER APPROVAL REQUIRED" }), requestedBy: "snair" },
  });

  // ---------------------------------------------------------------- FORECAST + MRP
  for (const fg of ["TAU-NOX-100", "TAU-LAM-200", "TAU-DP-300", "TAU-EGT-400", "TAU-UQS-500"]) {
    const fam = fg.split("-")[1];
    const code = { NOX: "NOX", LAM: "LAMBDA", DP: "DELTAP", EGT: "EGT", UQS: "UQS" }[fam] ?? fam;
    await db.forecast.create({ data: { familyCode: code, itemId: itemMap[fg], period: "2025-12", qty: fg === "TAU-NOX-100" ? 60 : 40, source: "APPROVED_FORECAST" } });
    await db.forecast.create({ data: { familyCode: code, itemId: itemMap[fg], period: "2026-01", qty: fg === "TAU-NOX-100" ? 75 : 50, source: "APPROVED_FORECAST" } });
  }
  await db.mrpRun.create({
    data: { number: "MRP-2025-0001", ranAt: d(-1), ranBy: "akhan", paramsJson: J({ horizonWeeks: 8, frozenWeeks: 2, respectRejectedStock: true }),
      summaryJson: J({
        plannedWOs: 5, shortages: 2, suggestions: 27,
        perItem: [
          { item: "TAU-DP-300", family: "DELTAP", gross: 4, supply: 0, net: 4, hasBom: true, hasRoute: true },
          { item: "TAU-EGT-400", family: "EGT", gross: 4, supply: 0, net: 4, hasBom: true, hasRoute: true },
          { item: "TAU-UQS-500", family: "UQS", gross: 3, supply: 0, net: 3, hasBom: true, hasRoute: true },
          { item: "TAU-LAM-200", family: "LAMBDA", gross: 12, supply: 2, net: 10, override: true, hasBom: true, hasRoute: true },
          { item: "TAU-NOX-100", family: "NOX", gross: 8, supply: 2, net: 6, hasBom: true, hasRoute: true },
        ],
      }),
      exceptionsJson: J([
        { type: "SHORTAGE", item: "SBA-LAM-ELEM", need: 10, have: 6, action: "Schedule subassembly WO" },
        { type: "SHORTAGE", item: "RM-POTTING", need: "0.42 Kg", have: "0 (lot rejected)", action: "Expedite alternate vendor — linked ECO-2025-0001" },
        { type: "CAPACITY", station: "WS-EOL-01", load: "112%", week: "W-51" },
        { type: "OVERRIDE", item: "TAU-LAM-200", from: 12, to: 10, reason: "SO-2025-0002 confirms 10 pcs open after stock check", by: "akhan", at: new Date().toISOString() },
      ]), suggestionCount: 5 },
  });

  // ---------------------------------------------------------------- DECISION REGISTER (demo stance: statutory unknowns APPROVED for the synthetic dataset — India GST/tax model, local credentials only, never for live statutory use)
  const drs = [
    ["DR-001", "GST rates & HSN for UQS-500", "Confirm HSN 9026/8537 split and place-of-supply treatment for UQS exports.", "Finance/CA (fgupta)", 21, "DECIDED", "APPROVED (synthetic dataset): UQS-500 finished sensor → HSN 9026 90 00 @ GST 18% (CGST 9% + SGST 9% intra-state; IGST 18% inter-state; exports zero-rated under LUT). Passive subassemblies → HSN 8532/8533 per item master. Valid for the demo dataset only.", "India GST model applied to the synthetic data: CGST/SGST 9%+9% intra-state, IGST 18% inter-state, exports under LUT. Place of supply = PLANT-PUNE (MH-27). Demo only — NOT for statutory use."],
    ["DR-002", "Route validation workshop sign-off (5 families)", "Signed operation sequences & control limits per family before series production.", "Quality (lkrish)", 14, "OPEN", "", "Baseline routes seeded as configurable v1 — not final."],
    ["DR-003", "EOL control limits baseline v1", "Approve EOL parameter limits used by pilot builds.", "Engineering (kmehta)", -5, "DECIDED", "Baseline v1 approved for PILOT builds only; re-approve before series.", ""],
    ["DR-004", "e-Invoice provider sandbox selection", "Select GSP sandbox for mock IRN workflow.", "IT/Compliance (kmehta)", 10, "DECIDED", "APPROVED (demo): e-Invoice workflow runs on the built-in sandbox simulator (IRN = SANDBOX_MOCK, idempotency-key enforced) with local demo credentials only — no external GSP contract and no live credentials. Moving to a real GSP requires a new decision item.", "Local credentials only (demo). IRN/QR payloads are synthetic; every IRN request is written to the audited e-invoice log."],
    ["DR-005", "Opening balances & stock count template", "Approve cutover stock-count and GL opening balance templates.", "Finance (fgupta)", 30, "DECIDED", "APPROVED (demo): cutover stock-count template TPL-SC-01 and synthetic GL opening balances (moving-average valuation) approved for go-live rehearsal. Balances refresh on force-reseed.", "Synthetic opening balances — values are seed-labelled; the stock-count sheet is part of the ops runbook."],
    ["DR-006", "Operator skill matrix (route qualifications)", "Define skill codes required per operation for shop-floor enforcement.", "Production (rpawar)", 7, "OPEN", "", ""],
  ] as const;
  for (const [ref, title, question, owner, due, status, decision, notes] of drs) {
    await db.decisionRegister.create({ data: { ref, title, question, owner, dueDate: due ? d(due) : null, status, decision, notes } });
  }

  // ---------------------------------------------------------------- SHIFT HANDOVERS (spec §Communication — SYNTHETIC demo story)
  // One OPEN awaiting acknowledgement (four-eyes demo), one acknowledged pair.
  await db.shiftHandover.createMany({
    data: [
      {
        shiftDate: d(-1), shift: "A", area: "LINE-LAMBDA", woNumber: "WO-2025-0002", authorName: "rpawar", headcount: 6,
        summary: "OP-SUBASSY running at 4/4 staged. IQC closed OK for SBA-LAM-ELEM ×5. One winding jig (JIG-L2) showing wear — swapped with spare, maintenance informed.",
        issuesJson: J([{ issue: "JIG-L2 jig wear — out on loan to maintenance", severity: "MEDIUM" }]),
        carryOverJson: J(["Finish OP-SUBASSY ×4 then start OP-ELEC-ASSY", "Confirm replacement jig availability before B-shift"]),
        safetyNote: "", status: "OPEN", acknowledgedBy: "",
      },
      {
        shiftDate: d(-2), shift: "C", area: "LINE-EGT", woNumber: "WO-2025-0004", authorName: "jyadav", headcount: 4,
        summary: "Night shift: workstation deep-clean + poke-yoke verification on WS-EOL-01 ahead of EGT release. No production run — WO-2025-0004 released next morning.",
        issuesJson: J([]),
        carryOverJson: J(["Verify EOL fixture calibration stickers before first EGT unit"]),
        safetyNote: "Night cleaning solvent spill near WS-EOL-01 cleaned; absorbent pads replenished.",
        status: "ACKNOWLEDGED", acknowledgedBy: "rpawar", acknowledgedAt: d(-1),
      },
      {
        shiftDate: d(-3), shift: "B", area: "LINE-NOX", woNumber: "WO-2025-0001", authorName: "rpawar", headcount: 8,
        summary: "WO-2025-0001 final packing completed — 6/6 NOX units packed & staged for dispatch. Scrap: 0. Line cleared for LAMBDA changeover next morning.",
        issuesJson: J([{ issue: "Label printer LP-1 low ribbon — replaced end of shift", severity: "LOW" }]),
        carryOverJson: J(["LAMBDA changeover: verify kit staging against SO-2025-0002"]),
        safetyNote: "", status: "ACKNOWLEDGED", acknowledgedBy: "akhan", acknowledgedAt: d(-2),
      },
    ],
  });

  // ---------------------------------------------------------------- NOTIFICATIONS
  await db.notification.createMany({
    data: [
      { role: "QUALITY_MGR", kind: "QUALITY", severity: "CRITICAL", title: "MRB approval pending", message: "NCR-2025-0002 (potting lot B-ACS1120) awaits four-eyes MRB approval.", refType: "NCR", refId: "NCR-2025-0002" },
      { role: "CALIB_ENG", kind: "CALIB", severity: "WARNING", title: "Equipment calibration due", message: "CAL-RIG-02 due in 6 days; GAUGE-LEAK-01 EXPIRED — tests blocked on that gauge.", refType: "EQUIPMENT", refId: "GAUGE-LEAK-01" },
      { role: "PLANNER", kind: "STOCK", severity: "WARNING", title: "MRP shortages", message: "2 shortages: SBA-LAM-ELEM, RM-POTTING (see MRP-2025-0001).", refType: "MRP", refId: "MRP-2025-0001" },
      { role: "PURCHASE_MGR", kind: "APPROVAL", severity: "INFO", title: "PO approval pending", message: "PO-2025-0004 (ElX Circuits, ₹51,000) awaits approval.", refType: "PO", refId: "PO-2025-0004" },
      { role: "FINANCE_MGR", kind: "INTEGRATION", severity: "INFO", title: "e-Invoice issued (sandbox mock)", message: "INV-2025-0001 IRN generated in SANDBOX_MOCK mode. Duplicate requests deduplicated.", refType: "INVOICE", refId: "INV-2025-0001" },
    ],
  });

  // ---------------------------------------------------------------- AUDIT TRAIL (samples)
  await db.auditLog.createMany({
    data: [
      { userName: "system", action: "SEED", entityType: "SITE", entityId: "tau-erp", detail: "SYNTHETIC dataset seeded (dev/UAT only)" },
      { userName: "akhan", action: "RELEASE", entityType: "WORK_ORDER", entityId: "WO-2025-0001", detail: "Released BOM A / Route A" },
      { userName: "lkrish", action: "APPROVE", entityType: "MRB", entityId: "NCR-2025-0001", detail: "Four-eyes rework approval (decider: lsethi)" },
      { userName: "fgupta", action: "EINVOICE", entityType: "INVOICE", entityId: "INV-2025-0001", detail: "IRN generated (SANDBOX_MOCK, idempotent)" },
    ],
  });

  return { seeded: true, skipped: false, users: users.length, families: famData.length };
}
