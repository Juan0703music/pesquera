import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { Prisma } from "../generated/prisma/client.js";
import { env } from "./env.js";
import { pgPoolConfig } from "./pg-options.js";

// Conexión cifrada a Supabase en producción y sin cifrar a la base local (ver pg-options.ts).
// La sesión debe estar en UTC: el adaptador envía las fechas en UTC sin zona.
const adapter = new PrismaPg(
  pgPoolConfig({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL, caCert: env.DATABASE_CA_CERT, max: env.DATABASE_POOL_MAX }),
);

export const prisma = new PrismaClient({ adapter });

/** Cliente normal o dentro de una transacción (`prisma.$transaction(async (tx) => …)`). */
export type DbClient = typeof prisma | Prisma.TransactionClient;
