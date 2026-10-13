"use client";
// ============================================================================
// Tau ERP — Keyboard shortcut help overlay (press "?" outside form fields).
// Lists the app's real keybindings so power users can discover them.
// ============================================================================
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

const SHORTCUTS: { keys: string[]; action: string; scope: string }[] = [
  { keys: ["Ctrl", "K"], action: "Open the command palette — global entity search (lots, WOs, NCRs, invoices…) + module navigation", scope: "anywhere" },
  { keys: ["⌘", "K"], action: "Same as Ctrl+K on macOS", scope: "anywhere" },
  { keys: ["/"], action: "Jump straight into palette search", scope: "anywhere" },
  { keys: ["?"], action: "Open this keyboard shortcut help", scope: "anywhere outside form fields" },
  { keys: ["Esc"], action: "Close palette, dialogs and overlays", scope: "anywhere" },
  { keys: ["Tab"], action: "Move through tables, filters and dialogs (full keyboard navigation)", scope: "anywhere" },
];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground shadow-[0_1px_0_rgb(255_255_255/0.06)_inset]">
      {children}
    </kbd>
  );
}

export default function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg bg-zinc-950 border-border/80">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Keyboard className="h-4 w-4 text-primary" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>Fast paths for dense ERP work — all actions are also reachable by mouse.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {SHORTCUTS.map((s) => (
            <div key={s.action} className="flex items-start gap-3 rounded-md px-2 py-1.5 odd:bg-white/[0.02]">
              <div className="flex shrink-0 gap-1 pt-0.5">
                {s.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
              </div>
              <div className="min-w-0">
                <p className="text-[12.5px] leading-snug">{s.action}</p>
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{s.scope}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
          Tip: every deep view is hash-addressable (e.g. <span className="font-mono text-primary">#/quality/ncr</span>) so screens can be bookmarked and linked from the palette.
        </p>
      </DialogContent>
    </Dialog>
  );
}
