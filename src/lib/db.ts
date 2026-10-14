import { PrismaClient } from '@prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'
import { getCloudflareContext } from '@opennextjs/cloudflare'

// Shape of the D1 binding declared in wrangler.toml (`binding = "DB"`).
type D1Binding = ConstructorParameters<typeof PrismaD1>[0]

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Database client resolution:
 * - Cloudflare Workers (cf:deploy): uses the D1 binding via the Prisma
 *   driver adapter — D1 is SQLite-compatible, provisioned in wrangler.toml.
 * - Node.js (local dev / VPS standalone build): classic Prisma over the
 *   DATABASE_URL SQLite file. getCloudflareContext() throws outside the
 *   Workers runtime, which is caught here and falls through to the local
 *   client — so local behaviour is completely unchanged.
 */
function createClient(): PrismaClient {
  try {
    const { env } = getCloudflareContext()
    const d1 = (env as { DB?: D1Binding }).DB
    if (d1) {
      return new PrismaClient({
        adapter: new PrismaD1(d1),
      })
    }
  } catch {
    /* not running on Cloudflare — use the local SQLite client */
  }
  return new PrismaClient({
    log: ['query'],
  })
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
