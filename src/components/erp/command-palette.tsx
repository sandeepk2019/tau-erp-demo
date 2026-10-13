"use client";
// ============================================================================
// Tau ERP — Command Palette (⌘K / Ctrl+K or "/") — global entity search.
// Searches lots, WOs, NCRs, releases, inspections, invoices, SOs, POs,
// suppliers, items, ECOs (role-scoped server-side) and navigates via hash
// router. Keeps a per-browser recent-entities list.
// ============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useErpStore } from "@/store/erp-store";
import { api } from "@/lib/erp/api-client";
import {
  Activity, BadgeCheck, Boxes, Factory, FileText, FlaskConical, IndianRupee,
  Package, Search, ShoppingCart, TrendingUp, Truck, UserCog,
} from "lucide-react";

type Hit = { kind: string; id: string; title: string; sub: string; view: string; tab: string; param: string };

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  LOT: Boxes, WO: Factory, NCR: BadgeCheck, RELEASE: BadgeCheck, INSP: Activity,
  INVOICE: IndianRupee, SO: Truck, PO: ShoppingCart, SUPPLIER: Package, ITEM: FlaskConical, ECO: FlaskConical,
};

const MODULE_CMDS: { view: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { view: "dashboard", label: "Executive Dashboard", icon: Activity },
  { view: "engineering", label: "Engineering — BOMs, Routes, APQP, ECO", icon: FlaskConical },
  { view: "procurement", label: "Procurement — Suppliers, POs, GRN/IQC", icon: ShoppingCart },
  { view: "inventory", label: "Inventory & Traceability", icon: Boxes },
  { view: "planning", label: "Planning / MRP Workbench", icon: TrendingUp },
  { view: "production", label: "Production — Work Orders, Job Cards", icon: Factory },
  { view: "quality", label: "Quality — NCR, Calibration, EOL, Release", icon: BadgeCheck },
  { view: "sales", label: "Sales & Dispatch — GST Invoices", icon: Truck },
  { view: "admin", label: "Administration — RBAC, Audit, Decisions", icon: UserCog },
];

const RECENTS_KEY = "tau-erp-recents";

export default function CommandPalette() {
  const route = useErpStore((s) => s.route);
  const navigate = useErpStore((s) => s.navigate);
  const open = useErpStore((s) => s.paletteOpen);
  const setOpen = useErpStore((s) => s.setPaletteOpen);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<Hit[]>([]);
  const seq = useRef(0);

  // load recents
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (raw) setRecents(JSON.parse(raw) as Hit[]);
    } catch { /* ignore */ }
  }, []);

  // keybindings: ⌘K / Ctrl+K, and "/" when not typing in an input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // debounced search
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const mySeq = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const data = await api<{ hits: Hit[] }>(`/api/search?q=${encodeURIComponent(query)}`);
        if (seq.current === mySeq) setHits(data.hits);
      } catch {
        if (seq.current === mySeq) setHits([]);
      } finally {
        if (seq.current === mySeq) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q, open]);

  const remember = (h: Hit) => {
    const next = [h, ...recents.filter((r) => !(r.kind === h.kind && r.id === h.id))].slice(0, 5);
    setRecents(next);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const go = (view: string, tab: string, param: string) => {
    setOpen(false);
    navigate(view, tab, param);
  };

  const grouped = useMemo(() => {
    const g: Record<string, Hit[]> = {};
    for (const h of hits) (g[h.kind] ??= []).push(h);
    return g;
  }, [hits]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="max-w-xl">
      <div className="flex items-center gap-2 border-b px-3 pt-3 pb-2 text-[11px] text-muted-foreground">
        <Search className="h-3.5 w-3.5" />
        Global search — role-scoped server-side. <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
      </div>
      <CommandInput
        placeholder="Search serials, WOs, NCRs, invoices, POs, items…"
        value={q}
        onValueChange={setQ}
      />
      <CommandList className="min-h-[220px]">
        {q.trim().length < 2 && (
          <>
            {recents.length > 0 && (
              <CommandGroup heading="Recent">
                {recents.map((h) => {
                  const Icon = KIND_ICON[h.kind] ?? Search;
                  return (
                    <CommandItem key={`r-${h.kind}-${h.id}`} value={`recent ${h.kind} ${h.title}`} onSelect={() => { remember(h); go(h.view, h.tab, h.param); }}>
                      <Icon className="mr-2 h-4 w-4 text-primary" />
                      <span className="font-mono text-[12px]">{h.title}</span>
                      <span className="ml-2 text-[11px] text-muted-foreground truncate">{h.sub}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup heading="Modules">
              {MODULE_CMDS.map((m) => (
                <CommandItem key={m.view} value={`module ${m.label}`} onSelect={() => go(m.view, "", "")}>
                  <m.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  {m.label}
                  {route.view === m.view && <span className="ml-auto text-[10px] text-primary">current</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {q.trim().length >= 2 && loading && (
          <div className="py-8 text-center text-[12px] text-muted-foreground">Searching…</div>
        )}
        {q.trim().length >= 2 && !loading && hits.length === 0 && (
          <CommandEmpty>No matches — try a serial (SN-NOX-25-0003), WO (WO-2025-0001), NCR or invoice number.</CommandEmpty>
        )}
        {q.trim().length >= 2 && !loading && Object.entries(grouped).map(([kind, list]) => {
          const Icon = KIND_ICON[kind] ?? Search;
          return (
            <CommandGroup key={kind} heading={`${kind} (${list.length})`}>
              {list.map((h) => (
                <CommandItem key={`${h.kind}-${h.id}`} value={`${h.kind} ${h.title} ${h.sub}`} onSelect={() => { remember(h); go(h.view, h.tab, h.param); }}>
                  <Icon className="mr-2 h-4 w-4 text-primary" />
                  <span className="font-mono text-[12px]">{h.title}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground truncate">{h.sub}</span>
                  <FileText className="ml-auto h-3 w-3 opacity-0 group-data-[selected=true]:opacity-60" />
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
