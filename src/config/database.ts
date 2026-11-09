import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { Prisma } from "../generated/prisma/client.js";
import { env } from "./env.js";

// El adaptador envía las fechas en UTC sin zona: la sesión de PostgreSQL debe estar en UTC
// para guardarlas como el instante correcto (la base local puede venir en hora de Colombia).
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, options: "-c TimeZone=UTC" });

export const prisma = new PrismaClient({ adapter });

/** Cliente normal o dentro de una transacción (`prisma.$transaction(async (tx) => …)`). */
export type DbClient = typeof prisma | Prisma.TransactionClient;
