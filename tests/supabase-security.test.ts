import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { effectiveSsl, pgPoolConfig } from "../src/config/pg-options.js";
import { settings, staff } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings();
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_publica_prueba') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM api_publica_prueba; DROP ROLE api_publica_prueba; END IF; END $$;`);
});

describe("Supabase: la API de datos no puede leer nada", () => {
  it("todas las tablas tienen la seguridad por filas activada (también las futuras)", async () => {
    const tables = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`;
    expect(tables.length).toBeGreaterThan(10);
    // Si una migración nueva crea una tabla sin «ENABLE ROW LEVEL SECURITY», esta prueba la nombra.
    expect(tables.filter((table) => !table.relrowsecurity).map((table) => table.relname)).toEqual([]);
  });

  it("un rol de la API con permiso de lectura no ve ninguna fila; el dueño de las tablas sí", async () => {
    await staff("ADMIN");
    await prisma.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_publica_prueba') THEN CREATE ROLE api_publica_prueba NOLOGIN; END IF; END $$;`);
    await prisma.$executeRawUnsafe(`GRANT SELECT ON public.users, public.orders TO api_publica_prueba`);

    const seen = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE api_publica_prueba`);
      return tx.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM public.users`;
    });

    expect(seen[0]?.n).toBe(0);
    expect(await prisma.user.count()).toBe(1);
  });
});

describe("conexión cifrada", () => {
  const supabase = "postgres://postgres.abcdefghijklmnopqrst:clave@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require";

  it("local sin cifrar y en UTC; Supabase siempre cifrado", () => {
    const local = pgPoolConfig({ connectionString: "postgresql://postgres:postgres@localhost:5434/pesquera" });
    expect(local.ssl).toBe(false);
    expect(local.options).toBe("-c TimeZone=UTC");

    const remote = pgPoolConfig({ connectionString: supabase, max: 5 });
    expect(remote.ssl).toEqual({ rejectUnauthorized: false });
    expect(remote.options).toBeUndefined(); // el pooler de Supabase no acepta parámetros de arranque
    expect(remote.max).toBe(5);
    expect(remote.connectionString).not.toContain("sslmode"); // una sola regla: la de `ssl`
  });

  it("con el certificado del proyecto se verifica el servidor", () => {
    const pem = "-----BEGIN CERTIFICATE-----\nMIIDxTCCAq2gAwIBAgIBADANBgkqhkiG9w0BAQsFADBXMQswCQYDVQQGEwJVUzEQ\n-----END CERTIFICATE-----";
    expect(effectiveSsl({ connectionString: supabase, caCert: pem })).toBe("verify-full");
    const config = pgPoolConfig({ connectionString: supabase, caCert: pem.replace(/\n/g, "\\n") });
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: pem });
    // También en base64 (variables de una sola línea).
    expect((pgPoolConfig({ connectionString: supabase, caCert: Buffer.from(pem).toString("base64") }).ssl as { ca: string }).ca).toBe(pem);
  });
});
