"use client";
// ============================================================================
// Tau ERP — Engineering ▸ Tab 3: Routes (family baseline route revisions)
// Read-only steps tables per family + release action (engineering.approve).
// Baseline routes are seeded from the spec; edits happen via new revisions.
// ============================================================================
import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { FAMILIES } from "@/lib/erp/constants";
import {
  DataTable, DateCell, KeyValue, Mono, StatusBadge, EmptyState,
} from "../../shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label as UiLabel } from "@/components/ui/label";
import { RouteDto, RouteStepDto, RoutesPayload } from "./types";
import { CheckCircle2, CircleDashed, Route as RouteIcon, ShieldCheck } from "lucide-react";

const FAMILY_COLOR: Record<string, string> = Object.fromEntries(FAMILIES.map((f) => [f.code, f.color]));

type Props = { data?: RoutesPayload; loading: boolean; canApprove: boolean };

export default function RoutesTab({ data, loading, canApprove }: Props) {
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const routes = data?.routes ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [effFrom, setEffFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const selected = useMemo(
    () => routes.find((r) => r.id === selectedId) ?? routes[0] ?? null,
    [routes, selectedId]
  );

  const release = useMutation({
    mutationFn: (v: { routeId: string; effectiveFrom: string }) =>
      api("/api/routes", { method: "POST", body: { action: "release", ...v } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routes"] });
      toast("Route revision RELEASED");
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  if (loading) {
    return <div className="h-72 rounded-lg border bg-card animate-pulse" />;
  }
  if (routes.length === 0) {
    return <EmptyState icon={RouteIcon} message="No route revisions defined" />;
  }

  return (
    <div className="space-y-3">
      {/* family revision chips */}
      <div className="flex flex-wrap gap-2">
        {routes.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedId(r.id)}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors ${
              selected?.id === r.id ? "border-primary/60 bg-primary/10" : "border-border/60 bg-card hover:border-primary/30"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: FAMILY_COLOR[r.familyCode] ?? "#a1a1aa" }} />
            <span className="font-medium">{r.familyCode}</span>
            <Mono className="text-muted-foreground">rev {r.revision}</Mono>
            <StatusBadge status={r.status} />
          </button>
        ))}
      </div>

      {selected && (
        <Card className="bg-card/80 border-border/70">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-primary/10 p-2"><RouteIcon className="h-5 w-5 text-primary" /></div>
                <div>
                  <p className="font-semibold text-[14px]">
                    {selected.name} <Mono className="text-muted-foreground">rev {selected.revision}</Mono>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {selected.steps.length} steps · family {selected.familyCode}
                  </p>
                </div>
                <StatusBadge status={selected.status} />
              </div>
              {canApprove && selected.status === "DRAFT" && (
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <UiLabel className="text-[10px]">Effective from</UiLabel>
                    <Input type="date" className="h-8 text-[12px]" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} />
                  </div>
                  <Button size="sm" onClick={() => release.mutate({ routeId: selected.id, effectiveFrom: effFrom })}
                    disabled={release.isPending}>
                    <ShieldCheck className="h-4 w-4" /> {release.isPending ? "Releasing…" : "Release route"}
                  </Button>
                </div>
              )}
            </div>

            <KeyValue items={[
              { k: "Effective from", v: <DateCell value={selected.effectiveFrom} /> },
              { k: "Released by", v: selected.releasedBy ? <Mono>{selected.releasedBy}</Mono> : "—" },
              { k: "Released at", v: <DateCell value={selected.releasedAt} /> },
              { k: "Notes", v: <span className="text-[12px]">{selected.notes || "—"}</span> },
            ]} />

            <DataTable<RouteStepDto>
              maxHeight="max-h-[46vh]"
              dense
              columns={[
                { key: "seq", header: "#", className: "w-10", render: (s) => <span className="tabular text-muted-foreground">{s.seq}</span> },
                { key: "operationCode", header: "Operation", render: (s) => (
                  <div className="leading-tight">
                    <Mono className="text-primary">{s.operationCode}</Mono>
                    <p className="text-[11px] text-muted-foreground">{s.description}</p>
                  </div>
                ) },
                { key: "workstationKind", header: "Workstation kind", render: (s) => <span className="text-[12px]">{s.workstationKind}</span> },
                { key: "inspectionTemplateCode", header: "Inspection template", render: (s) => s.inspectionTemplateCode ? <Mono>{s.inspectionTemplateCode}</Mono> : <span className="text-muted-foreground">—</span> },
                { key: "evidenceClass", header: "Evidence class", render: (s) => s.evidenceClass ? <span className="text-[11px] rounded bg-muted px-1.5 py-0.5">{s.evidenceClass}</span> : <span className="text-muted-foreground">—</span> },
                { key: "mandatory", header: "Mandatory", render: (s) => s.mandatory
                  ? <span className="flex items-center gap-1 text-[11px] text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> yes</span>
                  : <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><CircleDashed className="h-3.5 w-3.5" /> optional</span> },
              ]}
              rows={selected.steps}
              rowKey={(s) => s.id}
              emptyMessage="Route has no steps"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
