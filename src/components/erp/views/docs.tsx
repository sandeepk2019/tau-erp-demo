"use client";
// ============================================================================
// Tau ERP — Documentation Center: real-world style User Manuals (#/docs)
// Per-role manuals, step-by-step procedures, annotated screenshots, callouts,
// doc-control header (TAU-ERP-UM-001) and a per-chapter controlled print.
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BookOpen, ChevronRight, Lightbulb, Info,
  Printer, Users, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COMPANY } from "@/lib/erp/constants";
import { useErpStore } from "@/store/erp-store";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Content model
// ---------------------------------------------------------------------------
type Block =
  | { t: "p"; text: string }
  | { t: "h3"; text: string }
  | { t: "steps"; items: string[] }
  | { t: "list"; items: string[] }
  | { t: "note" | "warn" | "tip"; text: string }
  | { t: "img"; src: string; caption: string }
  | { t: "table"; head: string[]; rows: string[][] };

type Chapter = {
  id: string;
  title: string;
  audience: string;
  minutes: number;
  summary: string;
  blocks: Block[];
};

const DOC = {
  number: "TAU-ERP-UM-001",
  rev: "A",
  issued: "13 Oct 2026",
  owner: "Process Excellence (kmehta)",
  classification: "Internal — synthetic demo dataset",
};

// ---------------------------------------------------------------------------
// Manual content
// ---------------------------------------------------------------------------
const CHAPTERS: Chapter[] = [
  {
    id: "getting-started",
    title: "1 · Getting started",
    audience: "All users",
    minutes: 5,
    summary: "Sign in, learn the layout, take the guided tour and find anything with global search.",
    blocks: [
      { t: "h3", text: "1.1 About Tau ERP" },
      { t: "p", text: "Tau ERP is the plant operating system for Tau Power Electronics Pvt. Ltd. (PLANT-PUNE). It covers the full manufacturing value chain — Engineering (BOM/Routes/APQP/ECO), Procurement (RFQ → PO → GRN → IQC), Inventory & traceability (lot/serial genealogy), Planning (forecast & MRP), Production (work orders & barcode job cards), Quality (NCR/MRB/CAPA/calibration/EOL), and Sales & Dispatch (SO → DN → GST invoice) — with RBAC, four-eyes approval and an immutable audit trail throughout." },
      { t: "note", text: "This instance runs on 100% synthetic demo data. GSTINs, IRNs, e-way bills and statutory values are fabricated placeholders. The system is labelled SYNTHETIC — NOT FOR STATUTORY USE everywhere statutory data can appear." },
      { t: "h3", text: "1.2 Signing in & switching roles" },
      { t: "p", text: "Tau ERP ships with 15 demo personas covering every role in the RBAC matrix (System Admin, Purchase Manager, Planner, Store Keeper, Operator, QA Inspector, Sales Executive…). The avatar menu in the top-right switches the session user instantly — menus, buttons and permitted API calls change with the role. This is the fastest way to experience the permission model." },
      { t: "steps", items: [
        "Click the avatar chip in the top-right corner (shows your initials, name and role).",
        "Pick any user from the list — the session switches and all data refetches.",
        "Watch the sidebar, action buttons and footer: every control re-evaluates against the new role's permissions.",
      ] },
      { t: "h3", text: "1.3 Knowing the layout" },
      { t: "img", src: "/manual/01-dashboard.png", caption: "Fig 1-1 · Executive Dashboard: topbar (1), module rail (2), KPI cards (3), exception radar (4), audit footer (5)." },
      { t: "list", items: [
        "Topbar — brand, global search (Ctrl+K), product tours (graduation cap), notifications (bell), session user.",
        "Module rail — nine modules from Dashboard to Administration; the active module is highlighted in Tau green.",
        "Content area — tabbed workbenches per module; every list is server-paginated and permission-filtered.",
        "Footer — pinned compliance strip: version, plant, GSTIN, SYNTHETIC notice and audit reminder.",
      ] },
      { t: "h3", text: "1.4 Interactive product tours" },
      { t: "p", text: "Guided tours teach each module in context: a spotlight highlights the actual UI element while a card explains what it does. Tours are 1–3 minutes, can be replayed any time, and completed tours are remembered on your device." },
      { t: "img", src: "/manual/02-product-tour.png", caption: "Fig 1-2 · The Getting Started tour spotlighting the brand header — Back / Next / Skip controls and progress dots." },
      { t: "steps", items: [
        "Click the graduation-cap icon in the topbar.",
        "Choose a tour — the first entry is the recommended Getting Started lap.",
        "Use Next / Back to move, Esc or Skip to exit. Tours that target another module navigate there automatically.",
        "Finished tours get a green tick in the menu; replay them whenever you like.",
      ] },
      { t: "h3", text: "1.5 Finding records — global search" },
      { t: "p", text: "Press Ctrl+K (or click the search box) to open the command palette. It indexes serials, work orders, NCRs, lots, POs and invoices, and deep-links straight into the record. Type at least two characters; results are grouped by entity and honour your role's visibility." },
      { t: "tip", text: "Keyboard first: Ctrl+K search, ? for shortcuts, Esc closes any dialog. Everything reachable by mouse is reachable by keyboard." },
    ],
  },
  {
    id: "dashboard",
    title: "2 · Executive dashboard",
    audience: "Management · all users",
    minutes: 3,
    summary: "Read the plant at a glance: KPIs, the exception radar and trend charts.",
    blocks: [
      { t: "h3", text: "2.1 KPI cards" },
      { t: "p", text: "Two rows of server-computed KPIs refresh with the page: Open Work Orders, WIP Units, FG Ready to Ship, Shipped (30d), IQC Pass Rate, First Pass Yield, Open NCRs, Open CAPAs, Open Sales Orders, Stock Value, Pending Approvals and Overdue Actions. Colour encodes health — green is healthy, amber watch, red act-now." },
      { t: "tip", text: "Every KPI card is clickable and drills through to the filtered list behind the number (e.g. Pending Approvals → four-eyes queue)." },
      { t: "h3", text: "2.2 Exception radar" },
      { t: "p", text: "The radar strip answers \"what can hurt today?\": critical SCARs (with a pulsing marker), expedite POs, POs past their ETA, and overdue CAPAs. Each tile shows the count plus the worst offender; clicking a tile jumps to the underlying list. A green \"radar clear\" note appears when all four counters are zero." },
      { t: "h3", text: "2.3 Trends" },
      { t: "p", text: "Production trend (14-day completions vs scrap), released serials by family and stock by warehouse charts share the same audited API as every table — there is no parallel reporting truth. Figures below show the dashboard with data loaded." },
      { t: "img", src: "/manual/01-dashboard.png", caption: "Fig 2-1 · Dashboard with live KPIs from the synthetic dataset." },
    ],
  },
  {
    id: "engineering",
    title: "3 · Engineering — BOM, routes, APQP & ECO",
    audience: "Engineering · NPI · Quality",
    minutes: 6,
    summary: "Maintain items and BOMs, run routes through operations, drive APQP/PPAP and control changes with ECOs.",
    blocks: [
      { t: "h3", text: "3.1 What lives here" },
      { t: "list", items: [
        "Items & BOM — part master (HSN/GST per DR-001), multi-level BOM with effectivity.",
        "Routes — five sensor-family operation sequences with control limits per operation.",
        "APQP / PPAP — 18-element deliverable tracker per part programme.",
        "ECO — engineering change orders with approve/implement flow (audited).",
      ] },
      { t: "img", src: "/manual/03-engineering.png", caption: "Fig 3-1 · Engineering workbench — item list with family, tracking type and criticality." },
      { t: "h3", text: "3.2 Procedure — raising an ECO" },
      { t: "steps", items: [
        "Open Engineering → ECO and click New ECO.",
        "Describe the change, link affected items/BOM lines and set the review date.",
        "An approver (engineering.approve) reviews and approves — the ECO becomes APPROVED (four-eyes, audited).",
        "Implement: create the new BOM/route revision from the ECO; old revisions stay immutable for traceability.",
      ] },
      { t: "warn", text: "Released BOM and route revisions can never be edited in place (spec rule 13). Always change through a new revision backed by an approved ECO — the audit trail links them." },
      { t: "note", text: "Item HSN codes and GST rates ship as the approved synthetic set (Decision Register DR-001: HSN 9026 90 00 for finished sensors @ 18% GST). They are valid for the demo only." },
    ],
  },
  {
    id: "procurement",
    title: "4 · Procurement — suppliers, POs & SCAR",
    audience: "Purchase · SQE · Finance",
    minutes: 6,
    summary: "From RFQ to released PO under four-eyes, supplier scorecards and the 8D SCAR loop.",
    blocks: [
      { t: "h3", text: "4.1 The procure-to-pay flow" },
      { t: "p", text: "Demand → RFQ & quotation comparison → Purchase Order (DRAFT) → four-eyes approval → release → GRN with barcode → IQC routing. Suppliers carry scorecards (PPM, OTD, SCAR history) that feed the RFQ comparison." },
      { t: "img", src: "/manual/04-procurement.png", caption: "Fig 4-1 · Procurement overview — KPI strip and tab bar (Suppliers, RFQ, POs, GRN, SCAR)." },
      { t: "h3", text: "4.2 Procedure — approving a purchase order" },
      { t: "steps", items: [
        "Open Procurement → Purchase Orders; DRAFT rows await approval (Planners create them from MRP shortages).",
        "Click a PO to review lines, ETA basis per line (quotation lead / item-master lead / default) and the red EXPEDITE markers on SO-driven lines.",
        "As Purchase Manager, click Approve — the PO becomes APPROVED (first pair of eyes).",
        "A second authorised user releases it (four-eyes) — status RELEASED and the supplier sees the order in the mock portal.",
      ] },
      { t: "img", src: "/manual/05-procurement-pos.png", caption: "Fig 4-2 · Purchase Orders list — status, totals and the EXPEDITE chip on PO-2025-0002." },
      { t: "warn", text: "Four-eyes is enforced server-side: the same user cannot approve and release the same PO. Attempting it returns 403 and writes an audit row." },
      { t: "h3", text: "4.3 Supplier quality — SCAR & 8D" },
      { t: "p", text: "Raise a SCAR from an NCR or IQC rejection, set the response due date, and track the supplier's 8D through the mock supplier portal. Evidence (photos, test reports) can be attached as metadata; closing requires a recorded effectiveness check." },
    ],
  },
  {
    id: "planning",
    title: "5 · Planning — forecast & MRP",
    audience: "Planning · Purchase",
    minutes: 7,
    summary: "Approve demand, run MRP, override with judgment, convert shortages into draft POs.",
    blocks: [
      { t: "h3", text: "5.1 Approved forecast register" },
      { t: "p", text: "The forecast tab holds APPROVED_FORECAST lines per item and period — the only demand MRP consumes. Baskets show family totals for the current and next period." },
      { t: "h3", text: "5.2 Procedure — running MRP" },
      { t: "steps", items: [
        "Open Planning / MRP → MRP Workbench.",
        "Set horizon (weeks) and frozen weeks, then click Run MRP. The engine explodes the approved forecast through BOMs, nets WH-ACC/WIP stock, checks capacity and writes an audited run.",
        "Review suggestions per item; where judgment beats the engine, click Override and record the reason (audited, shown with an OVERRIDE chip).",
        "Check exceptions: SHORTAGE rows can be converted, CAPACITY rows need schedule changes, MAKE items go to work orders.",
      ] },
      { t: "img", src: "/manual/07-planning-mrp.png", caption: "Fig 5-1 · MRP Workbench — per-item suggestions with override controls." },
      { t: "h3", text: "5.3 From run to purchase orders" },
      { t: "p", text: "Open a historical run (MRP History → Detail) to see planned-vs-actual conversion, the per-item summary and the Purchase Coverage panel. Clicking \"Create draft POs from shortages\" nets open PO lines and creates DRAFT POs — supplier from the last PO (fallback: best RFQ), ETA per line from the quotation lead time, item-master procurement lead, or a 7/14-day default; firm SO demand compresses the ETA to the 7-day expedite floor and marks the line EXPEDITE." },
      { t: "img", src: "/manual/08-mrp-run-detail.png", caption: "Fig 5-2 · Run detail — KPIs, purchase coverage explainer and planned-vs-actual with WO links." },
      { t: "note", text: "POs always land as DRAFT: four-eyes approval by the Purchase Manager is still required (segregation of duties). Converting twice is safe — already-covered shortages are skipped (idempotent netting)." },
    ],
  },
  {
    id: "inventory",
    title: "6 · Inventory & traceability",
    audience: "Stores · Production · QA",
    minutes: 5,
    summary: "Receive, hold, issue and trace every lot and serial — barcode first.",
    blocks: [
      { t: "h3", text: "6.1 Lots, holds and warehouses" },
      { t: "p", text: "Every receipt creates a lot (SERIAL or BATCH tracking by item type). Lots carry status (OK, NCR-blocked, QUARANTINE), warehouse, supplier batch link and FEFO expiry where applicable. MRP supply automatically excludes NCR-blocked and quarantined stock." },
      { t: "img", src: "/manual/06-inventory.png", caption: "Fig 6-1 · Stock & lots — status chips, warehouse split and movement history." },
      { t: "h3", text: "6.2 Procedure — receiving a GRN" },
      { t: "steps", items: [
        "Open Procurement → Goods Receipts and pick the released PO (or scan its barcode).",
        "Enter received quantities per line; the GRN prints barcoded labels for each lot.",
        "Lots land in WH-IQC and are routed to IQC — pass moves them to WH-ACC, fail raises an NCR.",
        "Verify the movement trail on the lot detail dialog (every move is audited).",
      ] },
      { t: "h3", text: "6.3 Genealogy" },
      { t: "p", text: "Pick any finished serial and walk both directions: which supplier lots and work orders built it, and which customer shipment it left on. The dossier view prints as a conformance certificate with QR code." },
      { t: "tip", text: "Barcode-first: on the shop floor, scans drive everything — issues, returns, job-card clocks. The UI mirrors the same transitions so the office always sees live shop-floor state." },
    ],
  },
  {
    id: "production",
    title: "7 · Production — work orders & job cards",
    audience: "Production · Supervisors",
    minutes: 5,
    summary: "Release work orders, clock operations with scans, hand over between shifts.",
    blocks: [
      { t: "h3", text: "7.1 Work orders" },
      { t: "p", text: "WOs are created from MRP suggestions or SO demand and follow the family route operation by operation. Each WO tracks planned/completed/scrap quantities and links its traveller (the serial/batch record) for full traceability." },
      { t: "img", src: "/manual/09-production.png", caption: "Fig 7-1 · Production board — work orders with progress bars and job-card state." },
      { t: "h3", text: "7.2 Procedure — reporting production from a job card" },
      { t: "steps", items: [
        "Open Production → Job Cards and select your WO (or scan the traveller barcode).",
        "The card shows the current operation, control limits and required skill codes.",
        "Clock Start, enter qty completed / scrapped per pass; the card validates against the route and your skill matrix.",
        "Finish the last operation to make the serial eligible for EOL testing and the release gate.",
      ] },
      { t: "warn", text: "Operators without the route's required skill code cannot clock the operation — the server rejects the attempt and the supervisor sees the reason on the card." },
      { t: "h3", text: "7.3 Shift handovers" },
      { t: "p", text: "Suppliers of context between shifts: the outgoing shift logs issues, carry-overs and safety notes; the incoming shift acknowledges (four-eyes style). Unacknowledged handovers surface on the dashboard." },
    ],
  },
  {
    id: "quality",
    title: "8 · Quality — NCR, CAPA, calibration & EOL",
    audience: "QA · NPI · Maintenance",
    minutes: 6,
    summary: "The closed-loop QMS: nonconformance → disposition → corrective action → effectiveness.",
    blocks: [
      { t: "h3", text: "8.1 NCR & MRB" },
      { t: "p", text: "Raise NCRs from IQC failures, EOL failures or shop-floor findings. MRB dispositions (rework, use-as-is, scrap, return) are recorded with approvals; rework generates RW orders with instructions and outcome." },
      { t: "img", src: "/manual/10-quality.png", caption: "Fig 8-1 · Quality workbench — NCR list with severity and MRB state." },
      { t: "h3", text: "8.2 Procedure — closing the loop with CAPA" },
      { t: "steps", items: [
        "Open Quality → CAPA and link the NCR (or raise CAPA standalone for systemic issues).",
        "Record root cause, corrective and preventive actions with owners and due dates.",
        "When actions complete, run the effectiveness check (re-inspection evidence attaches automatically).",
        "Close the CAPA — effectiveness VERIFIED is required; the 8D report can be printed for the customer.",
      ] },
      { t: "h3", text: "8.3 Calibration & EOL evidence" },
      { t: "p", text: "The calibration calendar lists equipment due dates (overdue equipment blocks job-card clocks on affected stations). EOL tests store per-parameter results with limits and attempts; attempt-1 passes feed the First Pass Yield KPI." },
      { t: "note", text: "Serials cannot pass the release gate without passing EOL evidence and in-calibration equipment — the gate checklist is enforced, not advisory." },
    ],
  },
  {
    id: "sales",
    title: "9 · Sales & dispatch — SO to GST invoice",
    audience: "Sales · Dispatch · Finance",
    minutes: 6,
    summary: "Book orders, pass the release gate, dispatch with e-DNs and raise GST invoices.",
    blocks: [
      { t: "h3", text: "9.1 Sales orders & delivery notes" },
      { t: "p", text: "SOs carry customer, programme and line-level committed dates. Picking against a SO creates a Delivery Note; the release gate checks traceability, calibration and EOL evidence per serial before a DN can be dispatched." },
      { t: "h3", text: "9.2 Procedure — dispatch and invoice" },
      { t: "steps", items: [
        "Open Sales & Dispatch → Sales Orders and pick the SO to fulfil.",
        "Create the DN; complete the release gate checklist (each check is evidence-linked).",
        "Dispatch the DN — serials' status flips to SHIPPED and genealogy records the shipment.",
        "Raise the invoice from the DN: GST splits by place of supply (CGST+SGST intra-state, IGST inter-state, exports zero-rated under LUT) using the DR-001 approved model.",
        "Generate IRN in the sandbox (IRN = SANDBOX_MOCK, idempotency-key enforced) and print the tax invoice.",
      ] },
      { t: "img", src: "/manual/11-sales-invoices.png", caption: "Fig 9-1 · Invoices — GST breakdown, IRN status and the e-invoice log." },
      { t: "warn", text: "Invoices and IRNs are synthetic. The e-invoice workflow is a sandbox simulator with local credentials only (Decision Register DR-004) — never connect live statutory credentials in this environment." },
    ],
  },
  {
    id: "admin",
    title: "10 · Administration — RBAC, audit & decisions",
    audience: "System Admin · Auditors",
    minutes: 5,
    summary: "Govern the system: users and permissions, the immutable audit trail, the decision register and the ops runbook.",
    blocks: [
      { t: "h3", text: "10.1 Users & RBAC matrix" },
      { t: "p", text: "The matrix maps every role to permission groups (engineering.*, procurement.*, quality.*, decisions.manage…). The UI hides what a role lacks, and every API call re-checks permissions server-side — hiding a button is convenience, not security." },
      { t: "img", src: "/manual/12-admin-rbac.png", caption: "Fig 10-1 · Users & RBAC — 15 personas and the permission matrix." },
      { t: "h3", text: "10.2 Audit trail" },
      { t: "p", text: "Every controlled transition (approvals, overrides, status changes, seed operations) appends an immutable row: who, what, when, and the human-readable detail. Filter by action/entity and export for auditors." },
      { t: "img", src: "/manual/14-audit-trail.png", caption: "Fig 10-2 · Audit trail — filterable, exportable, immutable." },
      { t: "h3", text: "10.3 Decision register" },
      { t: "p", text: "The register records owner decisions with full text and audit links. The statutory unknowns are APPROVED for the synthetic dataset — DR-001 (India GST/HSN model), DR-004 (e-invoice sandbox with local credentials) and DR-005 (opening balances template). Approved items carry the green APPROVED — SYNTHETIC DATA badge; open items stay visible until an owner decides." },
      { t: "img", src: "/manual/13-decision-register.png", caption: "Fig 10-3 · Decision register — DR-001 approved with the India GST model text." },
      { t: "h3", text: "10.4 System & environment" },
      { t: "p", text: "The System tab declares the environment (DEV/UAT), pins the stack versions, and carries the ops runbook: nightly backup, quarterly restore drill, migration test, audit export, seed-wipe guard and RBAC review. Go-live additionally requires a fully decided register and real master-data cutover." },
    ],
  },
  {
    id: "reference",
    title: "11 · Reference — roles, shortcuts, glossary",
    audience: "All users",
    minutes: 4,
    summary: "One-page references: who can do what, keyboard shortcuts and the terms that matter.",
    blocks: [
      { t: "h3", text: "11.1 Role quick reference" },
      { t: "table", head: ["Role (demo persona)", "Home module", "Key permissions"], rows: [
        ["System Admin — Arvind Iyer", "Administration", "All groups · users · seed guard"],
        ["Purchase Mgr — T. Bose", "Procurement", "PO approve/release · RFQ award · SCAR raise"],
        ["Planner — A. Khan", "Planning / MRP", "MRP run · overrides · draft POs"],
        ["Store Keeper — J. Yadav", "Inventory", "GRN · issues · transfers"],
        ["Operator — R. Pawar", "Production", "Job-card clocks · handover acknowledge"],
        ["QA Inspector — L. Krishnan", "Quality", "IQC/EOL submit · NCR raise · CAPA"],
        ["Sales Exec — S. Menon", "Sales & Dispatch", "SO · DN · release gate · invoice"],
        ["Finance/CA — F. Gupta", "Sales · Admin", "Invoices · e-invoice · decisions.view"],
      ] },
      { t: "h3", text: "11.2 Keyboard shortcuts" },
      { t: "table", head: ["Keys", "Action"], rows: [
        ["Ctrl + K", "Global search / command palette"],
        ["?", "Keyboard shortcut help"],
        ["Esc", "Close dialog · exit tour"],
        ["← / →", "Tour previous / next step"],
        ["Enter", "Tour next step"],
      ] },
      { t: "h3", text: "11.3 Glossary" },
      { t: "table", head: ["Term", "Meaning"], rows: [
        ["APQP / PPAP", "Advanced Product Quality Planning / Production Part Approval Process"],
        ["BOM", "Bill of Materials — multi-level component structure of an item"],
        ["DN", "Delivery Note — picking document preceding dispatch"],
        ["ECO", "Engineering Change Order — the only path to a new BOM/route revision"],
        ["FEFO", "First Expired, First Out — picking order for expiry-tracked lots"],
        ["Four-eyes", "Two different authorised users required for sensitive transitions"],
        ["GRN", "Goods Receipt Note — creates lots on receipt against a PO"],
        ["IQC / EOL", "Incoming Quality Control / End-of-Line test"],
        ["MRB", "Material Review Board — disposition authority for nonconforming stock"],
        ["MRP", "Material Requirements Planning — demand explosion & netting engine"],
        ["NCR", "Nonconformance Report"],
        ["SCAR", "Supplier Corrective Action Request (8D)"],
        ["SoD", "Segregation of Duties — no single role controls a full sensitive flow"],
      ] },
      { t: "h3", text: "11.4 FAQ" },
      { t: "list", items: [
        "Why do buttons disappear when I switch users? — RBAC. The server hides nothing: it enforces. The UI simply mirrors what the session role may do.",
        "Can I fix a wrong MRP suggestion? — Yes, override it with a reason; the override is audited and visible on the run detail.",
        "Why is a PO stuck in DRAFT? — Four-eyes: a different Purchase Manager must approve, and another authorised user releases.",
        "Are GST numbers real? — No. Everything statutory is synthetic and labelled NOT FOR STATUTORY USE (approved demo model per DR-001/DR-004/DR-005).",
        "How do I retake a product tour? — Graduation-cap menu in the topbar; completed tours are ticked but always replayable.",
      ] },
    ],
  },
];

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export default function DocsView() {
  const toast = useErpStore((s) => s.toast);
  const [active, setActive] = useState(CHAPTERS[0].id);
  const [printing, setPrinting] = useState<Chapter | null>(null);

  const chapter = useMemo(() => CHAPTERS.find((c) => c.id === active) ?? CHAPTERS[0], [active]);

  // controlled print: render #tau-print-root, print, unmount
  useEffect(() => {
    if (!printing) return;
    const t = window.setTimeout(() => {
      window.print();
    }, 120);
    const after = () => setPrinting(null);
    window.addEventListener("afterprint", after);
    return () => { window.clearTimeout(t); window.removeEventListener("afterprint", after); };
  }, [printing]);

  return (
    <div className="space-y-4">
      {/* Document control header */}
      <div className="rounded-lg border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="h-11 w-11 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <BookOpen className="h-5.5 w-5.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">Tau ERP — User Manuals</h1>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              Role-based documentation for the {COMPANY.name} plant operating system. Written for real daily use — every procedure is verified against this synthetic instance.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              <Badge variant="outline" className="text-[10px] border-primary/40 bg-primary/10 text-primary">DOC {DOC.number} · REV {DOC.rev}</Badge>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">Issued {DOC.issued}</Badge>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">Owner: {DOC.owner}</Badge>
              <Badge variant="outline" className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-300">{DOC.classification}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Chapter rail */}
        <aside className="lg:w-72 shrink-0" aria-label="Manual chapters">
          <div className="lg:sticky lg:top-[72px] rounded-lg border border-border/70 bg-card overflow-hidden">
            <div className="max-h-[420px] lg:max-h-[calc(100vh-190px)] overflow-y-auto erp-scroll px-2 pb-2 space-y-0.5">
              {CHAPTERS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className={cn(
                    "w-full text-left rounded-md px-2.5 py-2 transition-colors",
                    c.id === active ? "bg-primary/12 border border-primary/25" : "border border-transparent hover:bg-sidebar-accent"
                  )}
                  aria-current={c.id === active ? "page" : undefined}
                >
                  <span className={cn("block text-[12.5px] font-medium leading-snug", c.id === active ? "text-primary" : "text-foreground/85")}>{c.title}</span>
                  <span className="block text-[10px] text-muted-foreground leading-snug mt-0.5">{c.audience} · {c.minutes} min</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Chapter body */}
        <article className="min-w-0 flex-1 rounded-lg border border-border/70 bg-card p-4 sm:p-6" aria-label={chapter.title}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3.5 mb-4">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold tracking-tight">{chapter.title}</h2>
              <p className="text-[12px] text-muted-foreground mt-1">{chapter.summary}</p>
              <p className="text-[10.5px] text-muted-foreground mt-1 flex items-center gap-1.5">
                <Users className="h-3 w-3" /> Audience: {chapter.audience} · reading time ≈ {chapter.minutes} min
              </p>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPrinting(chapter); toast(`Preparing controlled print of “${chapter.title}”…`); }}>
              <Printer className="h-3.5 w-3.5" /> Print chapter
            </Button>
          </div>

          <div className="space-y-3.5 max-w-[860px]">
            {chapter.blocks.map((b, i) => <BlockView key={i} b={b} />)}
          </div>

          <p className="mt-6 pt-3 border-t border-border/60 text-[10.5px] text-muted-foreground">
            {DOC.number} · Rev {DOC.rev} · {chapter.title} · Printed copies are uncontrolled unless stamped. Synthetic dataset — figures are demo values.
          </p>
        </article>
      </div>

      {/* Controlled print overlay */}
      {printing && (
        <div className="fixed inset-0 z-[80] bg-black/60 overflow-auto p-6 no-print" onClick={() => setPrinting(null)}>
          <div className="mx-auto max-w-[860px]">
            <div className="flex items-center justify-between mb-2 text-[12px] text-white/80">
              <span>Print preview — {printing.title}</span>
              <button className="rounded p-1 hover:bg-white/10" aria-label="Cancel print"><X className="h-4 w-4" /></button>
            </div>
            <PrintedChapter chapter={printing} />
          </div>
        </div>
      )}
      {/* print-only mirror (picked up by the print stylesheet) */}
      {printing && (
        <div className="hidden">
          <PrintedChapter chapter={printing} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocks renderer
// ---------------------------------------------------------------------------
function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "h3":
      return <h3 className="text-[14px] font-semibold tracking-tight pt-1.5 text-foreground/95">{b.text}</h3>;
    case "p":
      return <p className="text-[13px] leading-relaxed text-foreground/85">{b.text}</p>;
    case "list":
      return (
        <ul className="space-y-1.5">
          {b.items.map((it, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/85">
              <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="space-y-2">
          {b.items.map((it, i) => (
            <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-foreground/85">
              <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-primary/15 border border-primary/35 text-primary text-[10.5px] font-bold flex items-center justify-center tabular">{i + 1}</span>
              <span>{it}</span>
            </li>
          ))}
        </ol>
      );
    case "note":
      return (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/8 p-3 flex gap-2.5">
          <Info className="h-4 w-4 mt-0.5 text-sky-300 shrink-0" />
          <p className="text-[12px] leading-relaxed text-sky-100/90">{b.text}</p>
        </div>
      );
    case "warn":
      return (
        <div className="rounded-md border border-red-500/30 bg-red-500/8 p-3 flex gap-2.5">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-red-300 shrink-0" />
          <p className="text-[12px] leading-relaxed text-red-100/90">{b.text}</p>
        </div>
      );
    case "tip":
      return (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/8 p-3 flex gap-2.5">
          <Lightbulb className="h-4 w-4 mt-0.5 text-emerald-300 shrink-0" />
          <p className="text-[12px] leading-relaxed text-emerald-100/90">{b.text}</p>
        </div>
      );
    case "img":
      return (
        <figure className="rounded-lg border border-border/70 overflow-hidden bg-background/60">
          <img src={b.src} alt={b.caption} className="w-full h-auto block" loading="lazy" />
          <figcaption className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border/60">{b.caption}</figcaption>
        </figure>
      );
    case "table":
      return (
        <div className="rounded-lg border border-border/70 overflow-hidden">
          <div className="overflow-x-auto erp-scroll">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-background/70 text-muted-foreground">
                  {b.head.map((h) => <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap border-b border-border/60">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    {r.map((cell, j) => <td key={j} className={cn("px-3 py-1.5 align-top", j === 0 && "font-medium text-foreground/90")}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    default:
      return null;
  }
}

/** white-paper styled print mirror of a chapter (picked up by #tau-print-root print CSS) */
function PrintedChapter({ chapter }: { chapter: Chapter }) {
  return (
    <div id="tau-print-root" className="rounded-lg bg-white text-zinc-900 p-6 text-[12px] leading-relaxed" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between border-b-2 border-zinc-800 pb-2 mb-3">
        <div>
          <p className="text-[15px] font-bold">Tau ERP — User Manual · {chapter.title}</p>
          <p className="text-[11px] text-zinc-600">{COMPANY.name} · {COMPANY.plant} · Audience: {chapter.audience}</p>
        </div>
        <div className="text-right text-[10.5px] text-zinc-600">
          <p>{DOC.number} · Rev {DOC.rev}</p>
          <p>Issued {DOC.issued}</p>
          <p>SYNTHETIC DEMO DATA</p>
        </div>
      </div>
      <p className="text-[11px] text-zinc-600 mb-3">{chapter.summary}</p>
      <PrintedBlocks blocks={chapter.blocks} />
      <p className="mt-4 pt-2 border-t border-zinc-300 text-[10px] text-zinc-500">
        {DOC.number} Rev {DOC.rev} · Owner {DOC.owner} · {DOC.classification} · Printed copies are uncontrolled unless stamped.
      </p>
    </div>
  );
}

function PrintedBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h3": return <h3 key={i} className="text-[13px] font-bold mt-3">{b.text}</h3>;
          case "p": return <p key={i}>{b.text}</p>;
          case "list": return <ul key={i} className="list-disc pl-5 space-y-1">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>;
          case "steps": return (
            <ol key={i} className="list-decimal pl-5 space-y-1">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ol>
          );
          case "note": return <p key={i} className="rounded border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-[11.5px]"><strong>NOTE — </strong>{b.text}</p>;
          case "warn": return <p key={i} className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11.5px]"><strong>WARNING — </strong>{b.text}</p>;
          case "tip": return <p key={i} className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11.5px]"><strong>TIP — </strong>{b.text}</p>;
          case "img": return (
            <figure key={i} className="my-2">
                  <img src={b.src} alt={b.caption} className="w-full rounded border border-zinc-300" />
              <figcaption className="text-[10.5px] text-zinc-600 mt-1">{b.caption}</figcaption>
            </figure>
          );
          case "table": return (
            <table key={i} className="w-full border-collapse text-[11px] my-1">
              <thead><tr>{b.head.map((h) => <th key={h} className="border border-zinc-300 bg-zinc-100 px-2 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-zinc-300 px-2 py-1 align-top">{c}</td>)}</tr>
              ))}</tbody>
            </table>
          );
          default: return null;
        }
      })}
    </div>
  );
}
