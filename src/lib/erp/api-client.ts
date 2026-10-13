"use client";
// ============================================================================
// Tau ERP — client API helper. Always attaches x-erp-user session header.
// ============================================================================
import { useErpStore } from "@/store/erp-store";

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const user = useErpStore.getState().sessionUser;
  const res = await fetch(path, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-erp-user": user.username } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({ ok: false, error: "Invalid server response" }));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json.data as T;
}
