// ============================================================================
// Tau ERP — Interactive Product Tour store (zustand)
// Drives guided product tours: spotlight + tooltip steps, per-module tours,
// first-run welcome offer. Seen-state persists in localStorage.
// ============================================================================
import { create } from "zustand";

const SEEN_KEY = "tau-erp-tours-seen-v1";

function loadSeen(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function persistSeen(seen: string[]) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* private mode — ignore */
  }
}

type TourState = {
  activeTourId: string | null;
  stepIndex: number;
  seen: string[];
  /** pending start used to defer a tour until a route navigation renders */
  pendingTourId: string | null;
  start: (tourId: string) => void;
  /** called by the engine when the route for a deferred tour has rendered */
  activatePending: (tourId: string) => void;
  stop: (markSeen?: boolean) => void;
  next: (total: number) => void;
  back: () => void;
  resetSeen: () => void;
};

export const useTourStore = create<TourState>((set, get) => ({
  activeTourId: null,
  stepIndex: 0,
  seen: [],
  pendingTourId: null,
  start: (tourId) => {
    const alreadyActive = get().activeTourId === tourId;
    if (alreadyActive) return;
    set({ pendingTourId: tourId, activeTourId: null, stepIndex: 0 });
  },
  activatePending: (tourId) => {
    if (get().pendingTourId !== tourId) return;
    set({ activeTourId: tourId, stepIndex: 0, pendingTourId: null });
  },
  stop: (markSeen = true) => {
    const id = get().activeTourId;
    if (id && markSeen) {
      const seen = Array.from(new Set([...get().seen, id]));
      persistSeen(seen);
      set({ seen, activeTourId: null, stepIndex: 0 });
    } else {
      set({ activeTourId: null, stepIndex: 0 });
    }
  },
  next: (total) => {
    const i = get().stepIndex;
    if (i + 1 >= total) {
      get().stop(true);
    } else {
      set({ stepIndex: i + 1 });
    }
  },
  back: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  resetSeen: () => {
    persistSeen([]);
    set({ seen: [] });
  },
}));

/** seen list on first client render (safe in effects/hydration callbacks) */
export function readSeen(): string[] {
  return loadSeen();
}
