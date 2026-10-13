"use client";
// ============================================================================
// Tau ERP — client store: hash router, session user switcher, sidebar, search
// ============================================================================
import { create } from "zustand";
import { useEffect } from "react";

export type Route = { view: string; tab: string; param: string };

function parseHash(): Route {
  if (typeof window === "undefined") return { view: "dashboard", tab: "", param: "" };
  const h = window.location.hash.replace(/^#\/?/, "");
  const [view = "dashboard", tab = "", param = ""] = h.split("/");
  return { view, tab, param };
}

function routeToHash(r: Route): string {
  return `#/${r.view}${r.tab ? `/${r.tab}` : ""}${r.param ? `/${r.param}` : ""}`;
}

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  role: string;
  plant: string;
};

type ErpState = {
  route: Route;
  navigate: (view: string, tab?: string, param?: string) => void;
  sessionUser: SessionUser | null;
  users: SessionUser[];
  setSessionUser: (username: string) => void;
  loadUsers: () => Promise<void>;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  search: string;
  setSearch: (v: string) => void;
  toast: (title: string, kind?: "ok" | "err") => void;
};

export const useErpStore = create<ErpState>((set, get) => ({
  route: { view: "dashboard", tab: "", param: "" },
  navigate: (view, tab = "", param = "") => {
    const r = { view, tab, param };
    window.location.hash = routeToHash(r);
    set({ route: r, sidebarOpen: false });
  },
  sessionUser: null,
  users: [],
  setSessionUser: (username: string) => {
    const u = get().users.find((x) => x.username === username);
    if (u) {
      localStorage.setItem("tau-erp-user", username);
      set({ sessionUser: u });
    }
  },
  loadUsers: async () => {
    try {
      const res = await fetch("/api/session");
      const json = await res.json();
      if (json.ok) {
        const users = json.data.users as SessionUser[];
        set({ users });
        const saved = localStorage.getItem("tau-erp-user");
        const found = users.find((u) => u.username === (saved || "admin")) ?? users[0];
        set({ sessionUser: found });
      }
    } catch {
      // offline-safe
    }
  },
  sidebarOpen: false,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  paletteOpen: false,
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  search: "",
  setSearch: (v) => set({ search: v }),
  toast: (title: string, kind: "ok" | "err" = "ok") => {
    const evt = new CustomEvent("tau-erp-toast", { detail: { title, kind } });
    window.dispatchEvent(evt);
  },
}));

/** Hash-change listener — mount once in the app shell. */
const applyHashRoute = (r: Route) => useErpStore.setState({ route: r });

export function useHashRouting() {
  useEffect(() => {
    const onHash = () => applyHashRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    applyHashRoute(parseHash());
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
}
