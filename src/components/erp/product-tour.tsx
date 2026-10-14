"use client";
// ============================================================================
// Tau ERP — Interactive Product Tour engine
// Spotlight overlay + anchored tooltip card. Waits (briefly) for each step's
// target to appear, scroll-centres it, clamps the tooltip to the viewport,
// repositions on scroll/resize, supports keyboard (Esc / ← / → / Enter).
// ============================================================================
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Compass, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useErpStore } from "@/store/erp-store";
import { useTourStore } from "@/store/tour-store";
import { TOUR_BY_ID, type TourStep } from "@/lib/erp/tours";

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;           // spotlight breathing room around the target
const GAP = 14;          // tooltip distance from spotlight
const TOOLTIP_W = 340;

function readRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** wait up to `ms` for a selector to exist AND have a non-zero box */
function waitForSelector(selector: string, ms: number): Promise<Element | null> {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const probe = () => {
      const el = document.querySelector(selector);
      if (el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0) return resolve(el);
      if (Date.now() > deadline) return resolve(null);
      window.setTimeout(probe, 120);
    };
    probe();
  });
}

export default function ProductTour() {
  const route = useErpStore((s) => s.route);
  const navigate = useErpStore((s) => s.navigate);
  const activeTourId = useTourStore((s) => s.activeTourId);
  const pendingTourId = useTourStore((s) => s.pendingTourId);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const activatePending = useTourStore((s) => s.activatePending);
  const stop = useTourStore((s) => s.stop);
  const next = useTourStore((s) => s.next);
  const back = useTourStore((s) => s.back);

  const tour = activeTourId ? TOUR_BY_ID[activeTourId] : undefined;
  const steps = tour?.steps ?? [];
  const step: TourStep | undefined = steps[stepIndex];

  const [rect, setRect] = useState<Rect | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const rafRef = useRef(0);

  // ---- deferred start: a tour with a route first navigates, then activates ----
  useEffect(() => {
    if (!pendingTourId) return;
    const def = TOUR_BY_ID[pendingTourId];
    if (!def) {
      useTourStore.setState({ pendingTourId: null });
      return;
    }
    const targetView = def.route?.replace(/^#\//, "").split("/")[0];
    if (targetView && route.view !== targetView) {
      navigate(targetView);
      const t = window.setTimeout(() => activatePending(pendingTourId), 900);
      return () => window.clearTimeout(t);
    }
    activatePending(pendingTourId);
  }, [pendingTourId, route.view, navigate, activatePending]);

  // ---- viewport tracking ----
  useEffect(() => {
    const upd = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  // ---- resolve the current step target: wait for it, scroll to it, measure ----
  useEffect(() => {
    // defer state resets to a macrotask (react-hooks/set-state-in-effect)
    const resetT = window.setTimeout(() => {
      if (tour && step) {
        setRect(null);
        setWaiting(true);
        waitForSelector(step.selector, 3500).then((el) => {
          if (cancelled) return;
          setWaiting(false);
          if (!el) { setRect(null); return; }
          try {
            el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          } catch { /* older engines */ }
          // let smooth scrolling settle before measuring
          window.setTimeout(() => {
            if (!cancelled) setRect(readRect(el));
          }, 320);
        });
      } else {
        setRect(null);
        setWaiting(false);
      }
    }, 0);
    let cancelled = false;
    return () => { cancelled = true; window.clearTimeout(resetT); };
  }, [tour, step, stepIndex, route.view]);

  // ---- live reposition on scroll/resize (rAF-throttled) ----
  const reposition = useCallback(() => {
    if (!step) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = document.querySelector(step.selector);
      if (el) setRect(readRect(el));
    });
  }, [step]);
  useEffect(() => {
    if (!tour) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      cancelAnimationFrame(rafRef.current);
    };
  }, [tour, reposition]);

  // ---- keyboard controls ----
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); stop(true); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(steps.length); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour, steps.length, next, back, stop]);

  // ---- tooltip placement (clamped) ----
  const tip = useMemo(() => {
    const w = Math.min(TOOLTIP_W, Math.max(280, vw - 24));
    if (!rect || vw === 0) {
      return { width: w, left: Math.max(12, (vw - w) / 2), top: Math.max(12, (vh || 600) / 2 - 120), arrow: null as null | string };
    }
    const placement = step?.placement ?? "bottom";
    let left = 0, top = 0, arrow: string | null = null;
    if (placement === "bottom") { left = rect.left + rect.width / 2 - w / 2; top = rect.top + rect.height + PAD + GAP; arrow = "top"; }
    else if (placement === "top") { left = rect.left + rect.width / 2 - w / 2; top = rect.top - GAP - 190; arrow = "bottom"; }
    else if (placement === "left") { left = rect.left - w - GAP; top = rect.top + rect.height / 2 - 90; arrow = "right"; }
    else { left = rect.left + rect.width + GAP; top = rect.top + rect.height / 2 - 90; arrow = "left"; }
    left = Math.min(Math.max(12, left), Math.max(12, vw - w - 12));
    top = Math.min(Math.max(12, top), Math.max(12, (vh || 600) - 240));
    return { width: w, left, top, arrow };
  }, [rect, vw, vh, step?.placement]);

  if (!tour) return null;

  const last = stepIndex >= steps.length - 1;
  const targetMissing = !waiting && !rect;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`Product tour: ${tour.title}`} data-tour-overlay>
      {/* dark veil (below spotlight cut-out) */}
      <div className="absolute inset-0 bg-black/60" onClick={() => stop(true)} />

      {/* spotlight cut-out */}
      {rect && (
        <div
          className="absolute rounded-lg border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] transition-all duration-200 ease-out pointer-events-none"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(10,12,14,0.66)",
          }}
        />
      )}

      {/* tooltip card */}
      <div
        className="fixed rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl transition-all duration-200 ease-out"
        style={{ top: tip.top, left: tip.left, width: tip.width }}
        data-tour-tooltip
      >
        <div className="flex items-start gap-2.5 p-4 pb-2.5">
          <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Compass className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold leading-snug pr-5">{step?.title ?? tour.title}</p>
            <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground mt-0.5">
              {tour.title} · step {Math.min(stepIndex + 1, steps.length)} of {steps.length}
            </p>
          </div>
          <button
            onClick={() => stop(true)}
            className="absolute top-3 right-3 rounded-sm opacity-60 hover:opacity-100 transition-opacity"
            aria-label="End tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 pb-3">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{step?.body}</p>
          {targetMissing && (
            <p className="mt-2 text-[11px] text-amber-300/90">
              This element is not on screen in the current tab — press Next to continue the tour.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border/60 px-4 py-2.5">
          <div className="flex items-center gap-1.5" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === stepIndex ? "w-4 bg-primary" : i < stepIndex ? "w-1.5 bg-primary/50" : "w-1.5 bg-muted-foreground/30"}`}
              />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => stop(true)}>Skip</Button>
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" disabled={stepIndex === 0} onClick={() => back()}>
              <ArrowLeft className="h-3 w-3" /> Back
            </Button>
            <Button size="sm" className="h-7 px-3 text-[11px]" onClick={() => next(steps.length)} autoFocus>
              {last ? (<><CheckCircle2 className="h-3.5 w-3.5" /> Finish</>) : (<>Next <ArrowRight className="h-3 w-3" /></>)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
