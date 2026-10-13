"use client";
// ============================================================================
// Tau ERP — application shell: sidebar navigation, topbar, view router, footer
// SPA at "/" with hash routing (#/view/tab/param) since "/" is the only route.
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useErpStore, useHashRouting } from "@/store/erp-store";
import { api } from "@/lib/erp/api-client";
import { COMPANY, SYNTHETIC_NOTICE } from "@/lib/erp/constants";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, BadgeCheck, BookOpen, Boxes, ChevronDown, Cog, Compass, Factory, FlaskConical,
  GraduationCap, HardHat, LayoutDashboard, Menu, PackageCheck, ScrollText, Search,
  ShieldCheck, ShoppingCart, TrendingUp, Truck,
} from "lucide-react";

import DashboardView from "./views/dashboard";
import EngineeringView from "./views/engineering";
import ProcurementView from "./views/procurement";
import InventoryView from "./views/inventory";
import PlanningAdminView from "./views/planning-admin";
import ProductionView from "./views/production";
import QualityView from "./views/quality";
import SalesView from "./views/sales";
import DocsView from "./views/docs";
import CommandPalette from "./command-palette";
import NotificationBell from "./notification-bell";
import PrintCenter from "./print-center";
import ShortcutHelp from "./shortcut-help";
import ProductTour from "./product-tour";
import { useTourStore, readSeen } from "@/store/tour-store";
import { TOURS, tourForView } from "@/lib/erp/tours";

const NAV: { view: string; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "KPIs & alerts" },
  { view: "engineering", label: "Engineering", icon: FlaskConical, hint: "BOM · Routes · APQP" },
  { view: "procurement", label: "Procurement", icon: ShoppingCart, hint: "Suppliers · PO · IQC" },
  { view: "inventory", label: "Inventory & Trace", icon: Boxes, hint: "Stock · Genealogy" },
  { view: "planning", label: "Planning / MRP", icon: TrendingUp, hint: "Forecast · MRP" },
  { view: "production", label: "Production", icon: Factory, hint: "WO · Job Cards" },
  { view: "quality", label: "Quality & Tests", icon: BadgeCheck, hint: "NCR · Calibration · EOL" },
  { view: "sales", label: "Sales & Dispatch", icon: Truck, hint: "SO · DN · GST" },
  { view: "admin", label: "Administration", icon: Cog, hint: "RBAC · Audit · DR" },
  { view: "docs", label: "Manuals & Help", icon: BookOpen, hint: "User guides · Docs" },
];

type ToastEvt = { title: string; kind: "ok" | "err" };

export default function ErpApp() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
        },
      })
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ErpShell />
    </QueryClientProvider>
  );
}

function ErpShell() {
  useHashRouting();
  const route = useErpStore((s) => s.route);
  const navigate = useErpStore((s) => s.navigate);
  const sessionUser = useErpStore((s) => s.sessionUser);
  const users = useErpStore((s) => s.users);
  const setSessionUser = useErpStore((s) => s.setSessionUser);
  const loadUsers = useErpStore((s) => s.loadUsers);
  const sidebarOpen = useErpStore((s) => s.sidebarOpen);
  const setSidebarOpen = useErpStore((s) => s.setSidebarOpen);
  const setPaletteOpen = useErpStore((s) => s.setPaletteOpen);
  const toast = useErpStore((s) => s.toast);
  const { toast: shadToast } = useToast();
  const qc = useQueryClient();
  const [booted, setBooted] = useState(false);
  const startTour = useTourStore((s) => s.start);
  const seenTours = useTourStore((s) => s.seen);
  const moduleTour = tourForView(route.view);

  // boot: load users + seed-on-first-run
  useEffect(() => {
    (async () => {
      // tour seen-state hydration + one-time welcome nudge (Interactive Product Tours)
      useTourStore.setState({ seen: readSeen() });
      try {
        if (!window.localStorage.getItem("tau-erp-welcome-v1")) {
          window.localStorage.setItem("tau-erp-welcome-v1", "1");
          window.setTimeout(() => toast("Welcome to Tau ERP — open the graduation-cap menu (top right) for a 2-minute guided tour"), 1600);
        }
      } catch { /* private mode */ }
      try {
        const res = await fetch("/api/session", { cache: "no-store" });
        const json = await res.json();
        if (json.ok && json.data.seeded === false) {
          // auto-seed SYNTHETIC dataset on first run
          await fetch("/api/seed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
          await qc.invalidateQueries();
        }
      } catch { /* ignore */ }
      await loadUsers();
      setBooted(true);
    })();
  }, []);

  // toast event bridge
  useEffect(() => {
    const onToast = (e: Event) => {
      const { title, kind } = (e as CustomEvent<ToastEvt>).detail;
      shadToast({ description: title, variant: kind === "err" ? "destructive" : "default" });
    };
    window.addEventListener("tau-erp-toast", onToast);
    return () => window.removeEventListener("tau-erp-toast", onToast);
  }, [shadToast]);

  const View = useMemo(() => {
    switch (route.view) {
      case "dashboard": return DashboardView;
      case "engineering": return EngineeringView;
      case "procurement": return ProcurementView;
      case "inventory": return InventoryView;
      case "planning": return PlanningAdminView;
      case "production": return ProductionView;
      case "quality": return QualityView;
      case "sales": return SalesView;
      case "admin": return PlanningAdminView; // admin + planning share the module file (two exported entries)
      case "docs": return DocsView;
      default: return DashboardView;
    }
  }, [route.view]);

  const navLabel = NAV.find((n) => n.view === route.view || (n.view === "planning" && route.view === "admin"))?.label ?? route.view;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* TOPBAR */}
      <header className="sticky top-0 z-40 border-b bg-zinc-900/80 backdrop-blur supports-[backdrop-filter]:bg-zinc-900/70">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          {/* mobile nav */}
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 bg-sidebar border-sidebar-border">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent compact />
            </SheetContent>
          </Sheet>

          <button onClick={() => navigate("dashboard")} className="flex items-center gap-2.5 group" aria-label="Tau ERP home" data-tour="tour-logo">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center shadow-[0_0_18px_rgba(147,203,115,0.35)]">
              <Activity className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-[15px] font-bold leading-none tracking-tight">
                TAU <span className="text-primary">ERP</span>
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">{COMPANY.name}</div>
            </div>
          </button>

          <button
            onClick={() => setPaletteOpen(true)}
            className="flex-1 max-w-md ml-2 hidden md:flex h-9 items-center gap-2 rounded-md border border-border/60 bg-input/60 px-3 text-left text-[13px] text-muted-foreground hover:border-primary/40 hover:bg-input transition-colors"
            aria-label="Open global search (Ctrl+K)"
            data-tour="tour-search"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">Search serials, WOs, NCRs, invoices…</span>
            <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Ctrl K</kbd>
          </button>
          {/* mobile search trigger */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="md:hidden ml-1 h-9 w-9 flex items-center justify-center rounded-md border border-border/60 bg-input/60"
            aria-label="Open global search"
          >
            <Search className="h-4 w-4" />
          </button>

          <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="opacity-50">Tau ERP</span>
            <span className="opacity-40">/</span>
            <span className="text-foreground/80 font-medium">{navLabel}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="hidden lg:inline-flex border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px]">
              SYNTHETIC DATA
            </Badge>

            {/* Interactive product tours */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-primary" aria-label="Product tours and help" data-tour="tour-help">
                  <GraduationCap className="h-4.5 w-4.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 max-h-[70vh] erp-scroll overflow-auto">
                <DropdownMenuLabel className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Compass className="h-3.5 w-3.5 text-primary" /> Interactive product tours
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {TOURS.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => startTour(t.id)} className="gap-2.5 items-start py-2.5">
                    <Compass className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium flex items-center gap-1.5">
                        {t.title}
                        {seenTours.includes(t.id) && <BadgeCheck className="h-3 w-3 text-emerald-400" aria-label="completed" />}
                      </div>
                      <div className="text-[10.5px] text-muted-foreground leading-snug">{t.minutes} min · {t.roles}</div>
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => startTour("getting-started")} className="text-[12px] text-muted-foreground">
                  <GraduationCap className="h-4 w-4 mr-1.5 text-primary" /> {moduleTour ? `Replay “${moduleTour.title}”` : "Replay getting started"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <span data-tour="tour-bell" className="inline-flex">
              <NotificationBell />
            </span>

            {/* user switcher = demo RBAC */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2 border-border/70 bg-input/50" data-tour="tour-user">
                  <div className="h-6 w-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-[10px] font-bold text-primary">
                    {(sessionUser?.name ?? "·").split(" ").map((p) => p[0]).slice(0, 2).join("")}
                  </div>
                  <div className="hidden sm:block text-left leading-tight">
                    <div className="text-[12px] font-medium">{sessionUser?.name ?? "Loading…"}</div>
                    <div className="text-[10px] text-muted-foreground">{sessionUser?.role?.replace(/_/g, " ") ?? ""}</div>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 max-h-[70vh] erp-scroll overflow-auto">
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                  Switch session user — demonstrates the server-enforced RBAC matrix (spec §RBAC)
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {users.map((u) => (
                  <DropdownMenuItem
                    key={u.username}
                    onClick={() => { setSessionUser(u.username); qc.invalidateQueries(); toast(`Session switched to ${u.name} (${u.role})`); }}
                    className={cn("gap-2", sessionUser?.username === u.username && "bg-accent")}
                  >
                    <div className="h-6 w-6 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                      {u.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium truncate">{u.name}</div>
                      <div className="text-[10px] text-muted-foreground">{u.role.replace(/_/g, " ")} · {u.plant}</div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* DESKTOP SIDEBAR */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r bg-sidebar">
          <SidebarContent />
        </aside>

        {/* MAIN */}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 p-3 sm:p-5 erp-grid-bg">
            <div className="mx-auto max-w-[1400px]">
              {booted ? (
                <motion.div
                  key={route.view}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  data-tour={`tour-${route.view}`}
                >
                  <View key={route.view} />
                </motion.div>
              ) : <BootSkeleton />}
            </div>
          </div>

          {/* STICKY FOOTER (mt-auto keeps it pinned when content is short) */}
          <footer className="mt-auto border-t bg-zinc-900/70 backdrop-blur" data-tour="tour-footer">
            <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium text-foreground/80">Tau ERP v1.0</span>
                <span className="hidden sm:inline">· {COMPANY.plant} · {COMPANY.gstin}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-amber-400/90 font-medium">{SYNTHETIC_NOTICE}</span>
                <span className="hidden md:inline">Audit trail: every transition logged · Four-eyes enforced</span>
              </div>
            </div>
          </footer>
        </main>
      </div>

      <CommandPalette />
      <PrintCenter />
      <ShortcutHelp />
      <ProductTour />
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-64 rounded bg-muted" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 rounded-lg bg-card" />)}
      </div>
      <div className="h-72 rounded-lg bg-card" />
    </div>
  );
}

function SidebarContent({ compact = false }: { compact?: boolean }) {
  const route = useErpStore((s) => s.route);
  const navigate = useErpStore((s) => s.navigate);
  const setSidebarOpen = useErpStore((s) => s.setSidebarOpen);
  return (
    <nav className="flex flex-col h-full py-3" aria-label="ERP modules" data-tour="tour-nav">
      <div className="px-4 pb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Modules</div>
      <div className="flex-1 space-y-0.5 px-2 erp-scroll overflow-y-auto">
        {NAV.map((n) => {
          const active = route.view === n.view || (n.view === "planning" && route.view === "admin");
          return (
            <button
              key={n.view}
              onClick={() => { navigate(n.view); setSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                active ? "bg-primary/12 text-primary border border-primary/25" : "text-foreground/80 hover:bg-sidebar-accent border border-transparent"
              )}
              aria-current={active ? "page" : undefined}
            >
              <n.icon className={cn("h-4.5 w-4.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-tight">{n.label}</span>
                {!compact && <span className="block text-[10px] text-muted-foreground leading-tight">{n.hint}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {!compact && (
        <div className="px-4 pt-2 border-t border-sidebar-border/60 space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <HardHat className="h-3.5 w-3.5" /> Shop-floor ready · barcode-first
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <ScrollText className="h-3.5 w-3.5" /> 13-phase spec implemented
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <PackageCheck className="h-3.5 w-3.5" /> Traceability-first release gate
          </div>
        </div>
      )}
    </nav>
  );
}
