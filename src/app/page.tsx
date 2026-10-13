"use client";

import dynamic from "next/dynamic";

// Tau ERP is a single-page application mounted at the only visible route "/"
// ssr:false avoids hydration mismatch with the hash-router store.
const ErpApp = dynamic(() => import("@/components/erp/erp-app"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground text-sm">Loading Tau ERP…</div>
    </div>
  ),
});

export default function Page() {
  return <ErpApp />;
}
