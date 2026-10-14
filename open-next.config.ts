import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext → Cloudflare Workers adapter config.
 * Default config: no R2/KV incremental cache needed — this app is a
 * single SPA shell (hash routing) + API routes, so no ISR/ISR cache.
 */
export default defineCloudflareConfig({});
