/**
 * Copias de seguridad de Marea.
 *
 *   npm run db:backup                          crea una copia de DATABASE_URL en BACKUP_DIR (por defecto backups/)
 *   npm run db:backup:verify [-- <carpeta>]    restaura la copia más reciente en una base temporal LOCAL,
 *                                              compara los datos y la borra (prueba de restauración)
 *   npm run db:restore -- <carpeta> --target <url> --yes
 *                                              restaura en una base VACÍA (nunca sobrescribe datos)
 *
 * Formato: una carpeta por copia con `manifest.json` (migraciones, tablas, filas y columnas) y un CSV
 * comprimido por tabla, generado con `COPY` de PostgreSQL dentro de una sola transacción de solo lectura
 * (instantánea consistente). No necesita pg_dump. El logo y las fotos van dentro de la base, así que
 * quedan incluidos en la copia.
 *
 * Con Supabase: DATABASE_URL es la del pooler en modo sesión y la conexión va cifrada con las mismas
 * reglas que la aplicación (DATABASE_SSL, DATABASE_CA_CERT). La prueba de restauración nunca crea bases
 * en Supabase: usa el PostgreSQL local (`npm run db:start`) o BACKUP_VERIFY_URL.
 *
 * Las copias contienen datos del negocio (clientes, ventas, cuentas): `backups/` está en .gitignore y
 * nunca se sube al repositorio.
 */
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import pg from "pg";
import { from as copyFrom, to as copyTo } from "pg-copy-streams";
import { type DatabaseSsl, isLocalDatabase, pgPoolConfig } from "../src/config/pg-options.js";

if (existsSync(".env")) process.loadEnvFile(".env");

/** Orden de restauración: cada tabla después de las que referencia. */
const TABLES = [
  "users",
  "sessions",
  "push_subscriptions",
  "web_push_keys",
  "settings",
  "business_logo",
  "payment_accounts",
  "categories",
  "products",
  "product_photos",
  "customers",
  "orders",
  "order_items",
  "order_events",
  "inventory_movements",
];

interface Manifest {
  app: "marea";
  format: 1;
  createdAt: string;
  migrations: string[];
  tables: Record<string, { rows: number; columns: string[] }>;
}

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || "backups");
const KEEP = Number(process.env.BACKUP_KEEP || 14);
const LOCAL_VERIFY_URL = "postgresql://postgres:postgres@localhost:5434/postgres";
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Misma regla de cifrado que la aplicación. En local la sesión va en UTC; Supabase ya está en UTC. */
function connect(connectionString: string) {
  return new pg.Client(
    pgPoolConfig({
      connectionString,
      ssl: (process.env.DATABASE_SSL as DatabaseSsl | undefined) || "auto",
      caCert: process.env.DATABASE_CA_CERT || undefined,
    }),
  );
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL.");
  return url;
}

/** Para mensajes: la dirección sin la contraseña. */
function describe(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
  } catch {
    return "(dirección inválida)";
  }
}

async function appliedMigrations(client: pg.Client): Promise<string[]> {
  const exists = await client.query(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`);
  if (!exists.rows[0].ok) return [];
  const result = await client.query(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  return result.rows.map((row) => row.migration_name as string);
}

/** Evita olvidar una tabla nueva: si existe una tabla que no está en la lista, la copia falla. */
async function assertKnownTables(client: pg.Client) {
  const result = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
  const unknown = result.rows.map((row) => row.tablename as string).filter((table) => !TABLES.includes(table));
  if (unknown.length > 0) throw new Error(`Tablas sin incluir en scripts/backup.ts: ${unknown.join(", ")}`);
}

function listBackups(): string[] {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((name) => name.startsWith("marea-") && existsSync(path.join(BACKUP_DIR, name, "manifest.json")))
    .sort();
}

// ───────────────────────────── Crear ─────────────────────────────

async function createBackup(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(BACKUP_DIR, `marea-${stamp}`);
  mkdirSync(dir, { recursive: true });

  const sourceUrl = requireDatabaseUrl();
  const client = connect(sourceUrl);
  await client.connect();
  const manifest: Manifest = { app: "marea", format: 1, createdAt: new Date().toISOString(), migrations: [], tables: {} };
  try {
    // Instantánea consistente de todas las tablas.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    manifest.migrations = await appliedMigrations(client);
    await assertKnownTables(client);
    for (const table of TABLES) {
      const columns = (
        await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
          [table],
        )
      ).rows.map((row) => row.column_name as string);
      const rows = Number((await client.query(`SELECT COUNT(*) AS n FROM ${quote(table)}`)).rows[0].n);
      const columnList = columns.map(quote).join(", ");
      await pipeline(
        client.query(copyTo(`COPY ${quote(table)} (${columnList}) TO STDOUT WITH (FORMAT csv, HEADER true)`)),
        createGzip(),
        createWriteStream(path.join(dir, `${table}.csv.gz`)),
      );
      manifest.tables[table] = { rows, columns };
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally {
    await client.end();
  }

  writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // Conservación: solo las últimas KEEP copias.
  const all = listBackups();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });

  const total = Object.values(manifest.tables).reduce((sum, table) => sum + table.rows, 0);
  console.log(`Copia creada de ${describe(sourceUrl)}: ${dir}`);
  console.log(`  ${TABLES.length} tablas · ${total} filas · migración ${manifest.migrations.at(-1) ?? "—"}`);
  return dir;
}

// ───────────────────────────── Restaurar ─────────────────────────────

async function restoreBackup(dir: string, targetUrl: string) {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  if (manifest.app !== "marea" || manifest.format !== 1) throw new Error("La carpeta no es una copia de Marea.");

  // 1. Esquema: las mismas migraciones que tenía la base original.
  execFileSync(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: targetUrl },
    stdio: "pipe",
  });

  const client = connect(targetUrl);
  await client.connect();
  try {
    const migrations = await appliedMigrations(client);
    const missing = manifest.migrations.filter((name) => !migrations.includes(name));
    if (missing.length > 0) throw new Error(`La base de destino no tiene las migraciones: ${missing.join(", ")}`);

    // 2. Nunca se sobrescriben datos: la base de destino debe estar vacía.
    for (const table of TABLES) {
      const rows = Number((await client.query(`SELECT COUNT(*) AS n FROM ${quote(table)}`)).rows[0].n);
      if (rows > 0) throw new Error(`La base de destino ya tiene datos (${table}). Restaura en una base vacía.`);
    }

    // 3. Datos, en una sola transacción y en orden de dependencias (las restricciones se verifican).
    await client.query("BEGIN");
    for (const table of TABLES) {
      const entry = manifest.tables[table];
      if (!entry) continue;
      const columnList = entry.columns.map(quote).join(", ");
      await pipeline(
        createReadStream(path.join(dir, `${table}.csv.gz`)),
        createGunzip(),
        client.query(copyFrom(`COPY ${quote(table)} (${columnList}) FROM STDIN WITH (FORMAT csv, HEADER true)`)),
      );
    }
    // Los números de pedido siguen desde el último restaurado.
    await client.query(`SELECT setval(pg_get_serial_sequence('orders', 'number'), GREATEST((SELECT MAX(number) FROM orders), 1), (SELECT COUNT(*) > 0 FROM orders))`);
    await client.query("COMMIT");

    // 4. Comprobación: mismas filas que en la copia.
    const problems: string[] = [];
    for (const table of TABLES) {
      const expected = manifest.tables[table]?.rows ?? 0;
      const actual = Number((await client.query(`SELECT COUNT(*) AS n FROM ${quote(table)}`)).rows[0].n);
      if (actual !== expected) problems.push(`${table}: ${actual} filas (se esperaban ${expected})`);
    }
    if (problems.length > 0) throw new Error(`La restauración no coincide:\n  ${problems.join("\n  ")}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
  return manifest;
}

// ───────────────────────────── Verificar ─────────────────────────────

/** Servidor donde se hace la prueba: el local de desarrollo, nunca Supabase. */
function verifyServerUrl(): string {
  if (process.env.BACKUP_VERIFY_URL) return process.env.BACKUP_VERIFY_URL;
  const source = requireDatabaseUrl();
  return isLocalDatabase(source) ? source : LOCAL_VERIFY_URL;
}

/** Prueba de restauración: base temporal → restaurar → comparar → borrar. */
async function verifyBackup(dir: string) {
  const serverUrl = new URL(verifyServerUrl());
  const tempName = `marea_verificacion_${Date.now()}`;
  const targetUrl = new URL(serverUrl);
  targetUrl.pathname = `/${tempName}`;

  const admin = connect(serverUrl.toString());
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `No se pudo conectar a ${describe(serverUrl.toString())} para la prueba de restauración (${(error as Error).message}). ` +
        "Arranca el PostgreSQL local con `npm run db:start` o define BACKUP_VERIFY_URL.",
    );
  }
  await admin.query(`CREATE DATABASE ${quote(tempName)}`);
  const started = Date.now();
  try {
    const manifest = await restoreBackup(dir, targetUrl.toString());

    // Además de contar filas: las relaciones, el dinero y el inventario siguen intactos.
    const check = connect(targetUrl.toString());
    await check.connect();
    try {
      const count = async (sql: string) => Number((await check.query(sql)).rows[0].n);
      const orphanItems = await count(`SELECT COUNT(*) AS n FROM order_items i LEFT JOIN orders o ON o.id = i.order_id WHERE o.id IS NULL`);
      const wrongTotals = await count(`SELECT COUNT(*) AS n FROM orders WHERE total <> subtotal + delivery_fee`);
      const negativeStock = await count(`SELECT COUNT(*) AS n FROM products WHERE stock_milli < 0`);
      const admins = await count(`SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND active`);
      if (orphanItems > 0 || wrongTotals > 0 || negativeStock > 0) {
        throw new Error(`Inconsistencias: ${orphanItems} detalles huérfanos, ${wrongTotals} totales incorrectos, ${negativeStock} existencias negativas.`);
      }
      if (manifest.tables.users?.rows && admins === 0) throw new Error("La copia no tiene ningún administrador activo.");
    } finally {
      await check.end();
    }

    const total = Object.values(manifest.tables).reduce((sum, table) => sum + table.rows, 0);
    console.log(`✔ Restauración verificada: ${path.basename(dir)}`);
    console.log(`  ${Object.keys(manifest.tables).length} tablas y ${total} filas restauradas en ${((Date.now() - started) / 1000).toFixed(1)} s (base temporal en ${describe(serverUrl.toString())}, ya borrada).`);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${quote(tempName)} WITH (FORCE)`);
    await admin.end();
  }
}

// ───────────────────────────── Comandos ─────────────────────────────

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : (args[index + 1] ?? "");
};

try {
  if (command === "create") {
    await createBackup();
  } else if (command === "verify") {
    const dir = args[0] && !args[0].startsWith("--") ? path.resolve(args[0]) : path.join(BACKUP_DIR, listBackups().at(-1) ?? "");
    if (!existsSync(path.join(dir, "manifest.json"))) throw new Error("No hay copias para verificar. Crea una con npm run db:backup.");
    await verifyBackup(dir);
  } else if (command === "restore") {
    const dir = args[0] && !args[0].startsWith("--") ? path.resolve(args[0]) : "";
    const target = flag("--target");
    if (!dir || !target) throw new Error("Uso: npm run db:restore -- <carpeta-de-la-copia> --target <url-de-una-base-vacía> --yes");
    if (!args.includes("--yes")) throw new Error(`Agrega --yes para confirmar la restauración en ${describe(target)}.`);
    const manifest = await restoreBackup(dir, target);
    console.log(`✔ Copia restaurada (${Object.keys(manifest.tables).length} tablas) en ${describe(target)}.`);
  } else {
    console.log("Comandos: create | verify [carpeta] | restore <carpeta> --target <url> --yes");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`✘ ${(error as Error).message}`);
  process.exitCode = 1;
}
