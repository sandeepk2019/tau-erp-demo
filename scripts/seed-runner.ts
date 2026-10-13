// Standalone seed runner — runs seedAll() outside the Next.js process so the
// OOM-prone dev server is never killed by the (memory-heavy) force reseed.
// Usage: bun scripts/seed-runner.ts [--force]
import { seedAll } from "../src/lib/erp/seed";

const force = process.argv.includes("--force");
seedAll(force)
  .then((r) => {
    console.log("SEED_OK", JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error("SEED_FAIL", e);
    process.exit(1);
  });
