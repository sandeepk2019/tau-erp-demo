"use client";
// ============================================================================
// Tau ERP — Engineering module (Task 3-a)
// Tabs: Families & Items · BOMs · Routes · APQP/PPAP · Engineering Changes
// RBAC: engineering.view (read) · engineering.edit (masters, ECR, DRAFT BOM
// maintenance) · engineering.approve (releases, gates, ECO lifecycle).
// All mutations go through /api/items|boms|routes|apqp|eco with server-side
// validation + audit trail.
// ============================================================================
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { hasPerm } from "@/lib/erp/constants";
import { PermDenied, SectionHeader, StatCard, SubTabs, SyntheticBadge } from "../shared";
import {
  Boxes, DraftingCompass, GitPullRequestArrow, Route as RouteIcon, ShieldCheck,
} from "lucide-react";
import FamiliesItemsTab from "./engineering/families-items";
import BomsTab from "./engineering/boms-tab";
import RoutesTab from "./engineering/routes-tab";
import ApqpTab from "./engineering/apqp-tab";
import EcoTab from "./engineering/eco-tab";
import { ApqpPayload, BomsPayload, EcoPayload, ItemsPayload, RoutesPayload } from "./engineering/types";

export default function EngineeringView() {
  const sessionUser = useErpStore((s) => s.sessionUser);
  const toast = useErpStore((s) => s.toast);
  const routeTab = useErpStore((s) => s.route.tab);
  const navigate = useErpStore((s) => s.navigate);
  const [tab, setTabState] = React.useState("items");
  // hash → tab sync: deep links (#/engineering/<tab>) and back/forward must work
  React.useEffect(() => {
    if (routeTab && ["items", "boms", "routes", "apqp", "eco"].includes(routeTab)) setTabState(routeTab);
  }, [routeTab]);
  const setTab = (k: string) => { setTabState(k); navigate("engineering", k); };

  const canEdit = hasPerm(sessionUser?.role, "engineering.edit");
  const canApprove = hasPerm(sessionUser?.role, "engineering.approve");

  const itemsQ = useQuery<ItemsPayload>({
    queryKey: ["items"],
    queryFn: () => api<ItemsPayload>("/api/items"),
  });
  const bomsQ = useQuery<BomsPayload>({ queryKey: ["boms"], queryFn: () => api<BomsPayload>("/api/boms") });
  const routesQ = useQuery<RoutesPayload>({ queryKey: ["routes"], queryFn: () => api<RoutesPayload>("/api/routes") });
  const apqpQ = useQuery<ApqpPayload>({ queryKey: ["apqp"], queryFn: () => api<ApqpPayload>("/api/apqp") });
  const ecoQ = useQuery<EcoPayload>({ queryKey: ["eco"], queryFn: () => api<EcoPayload>("/api/eco") });

  // Surface load errors once (e.g. role without engineering.view).
  const loadError = itemsQ.error ?? bomsQ.error ?? routesQ.error ?? apqpQ.error ?? ecoQ.error;
  React.useEffect(() => {
    if (loadError instanceof Error) toast(loadError.message, "err");
  }, [loadError, toast]);

  const items = itemsQ.data?.items ?? [];
  const boms = bomsQ.data?.boms ?? [];
  const routes = routesQ.data?.routes ?? [];
  const projects = apqpQ.data?.projects ?? [];
  const changes = ecoQ.data?.changes ?? [];

  const releasedBoms = boms.filter((b) => b.status === "RELEASED").length;
  const releasedRoutes = routes.filter((r) => r.status === "RELEASED").length;
  const openChanges = changes.filter((c) => !["CLOSED", "REJECTED"].includes(c.status)).length;
  const draftBoms = boms.filter((b) => b.status === "DRAFT").length;

  const denied = loadError instanceof Error && /permission denied/i.test(loadError.message);

  const tabs = [
    { key: "items", label: "Families & Items", count: items.length },
    { key: "boms", label: "BOMs", count: boms.length },
    { key: "routes", label: "Routes", count: routes.length },
    { key: "apqp", label: "APQP / PPAP", count: projects.length },
    { key: "eco", label: "Engineering Changes", count: changes.length },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={DraftingCompass}
        title="Engineering"
        desc="Item master · BOMs & routes (revision-controlled) · APQP/PPAP programmes · ECR/ECO workflow"
        actions={<SyntheticBadge />}
      />

      {/* KPI ROW */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Items" value={itemsQ.isLoading ? "—" : items.length}
          sub={`${items.filter((i) => i.itemType === "FINISHED").length} finished · ${items.filter((i) => i.criticality === "CRITICAL").length} critical`}
          icon={Boxes} onClick={() => setTab("items")} />
        <StatCard label="Released BOMs" value={bomsQ.isLoading ? "—" : releasedBoms}
          sub={draftBoms > 0 ? `${draftBoms} DRAFT — not usable in production` : "all revisions released"}
          icon={ShieldCheck} tone={draftBoms > 0 ? "warn" : "good"} onClick={() => setTab("boms")} />
        <StatCard label="Released Routes" value={routesQ.isLoading ? "—" : releasedRoutes}
          sub={`${routes.length} revisions across 5 families`} icon={RouteIcon}
          tone={releasedRoutes === routes.length ? "good" : "warn"} onClick={() => setTab("routes")} />
        <StatCard label="Open ECOs / ECRs" value={ecoQ.isLoading ? "—" : openChanges}
          sub={openChanges > 0 ? "pending approval / implementation" : "none open"} icon={GitPullRequestArrow}
          tone={openChanges > 0 ? "warn" : "good"} onClick={() => setTab("eco")} />
      </div>

      {denied ? (
        <PermDenied perm="engineering.view" />
      ) : (
        <>
          <SubTabs tabs={tabs} value={tab} onChange={setTab} />
          <div className="min-h-[40vh]">
            {tab === "items" && (
              <FamiliesItemsTab data={itemsQ.data} loading={itemsQ.isLoading} canEdit={canEdit} />
            )}
            {tab === "boms" && (
              <BomsTab data={bomsQ.data} items={items} loading={bomsQ.isLoading} canEdit={canEdit} canApprove={canApprove} />
            )}
            {tab === "routes" && (
              <RoutesTab data={routesQ.data} loading={routesQ.isLoading} canApprove={canApprove} />
            )}
            {tab === "apqp" && (
              <ApqpTab data={apqpQ.data} loading={apqpQ.isLoading} canApprove={canApprove} />
            )}
            {tab === "eco" && (
              <EcoTab data={ecoQ.data} loading={ecoQ.isLoading} canEdit={canEdit} canApprove={canApprove} />
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Baseline routes are seeded from the spec (configurable v1 — pending signed route-validation workshop,
            Decision Register DR-002). Released BOM/route revisions are immutable; changes require a new revision backed
            by an approved ECO (spec rule 13). Item HSN/GST values are synthetic — approved for the demo dataset per Decision Register DR-001 (India GST 18% model; not for statutory use).
          </p>
        </>
      )}
    </div>
  );
}
