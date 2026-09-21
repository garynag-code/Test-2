import { PrismaClient } from '@prisma/client';

/**
 * A single Prisma client per process. Next.js hot-reloads modules in
 * development, so the client is stashed on `globalThis` to avoid exhausting the
 * connection pool with one client per reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * The shape shared by the Prisma client and a transaction client. Repositories
 * accept this so a service can compose several of them inside one transaction
 * (docs/05, "Anatomy of a feature module").
 */
export type Db = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
