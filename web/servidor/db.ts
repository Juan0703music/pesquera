/**
 * Base de datos de la versión del navegador (reemplaza a src/config/database.ts al empaquetar).
 *
 * PostgreSQL de verdad, compilado a WebAssembly (PGlite), guardado en el almacenamiento del navegador
 * (IndexedDB). Prisma habla con él igual que con el servidor, así que la lógica de Marea es la misma.
 * El adaptador apunta a un intermediario: al restaurar una copia se cambia la base sin reiniciar nada.
 */
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { MIGRACIONES } from "virtual:migraciones";
import { PrismaClient } from "../generado/prisma/client.js";
import type { Prisma } from "../generado/prisma/client.js";

export interface RecursosBase {
  pgliteWasmModule?: WebAssembly.Module;
  initdbWasmModule?: WebAssembly.Module;
  fsBundle?: Blob;
}

/** Dónde vive la base: «idb://marea» en el navegador; en memoria en las pruebas. */
let ubicacion: string | undefined;
let recursos: RecursosBase = {};
let actual: PGlite | null = null;

const intermediario = new Proxy({} as PGlite, {
  get(_destino, propiedad) {
    const base = actual;
    if (!base) throw new Error("La base de datos de Marea todavía no está abierta.");
    const valor = Reflect.get(base, propiedad, base) as unknown;
    return typeof valor === "function" ? (valor as (...args: unknown[]) => unknown).bind(base) : valor;
  },
});

export const prisma = new PrismaClient({ adapter: new PrismaPGlite(intermediario) });

/** Cliente normal o dentro de una transacción (`prisma.$transaction(async (tx) => …)`). */
export type DbClient = typeof prisma | Prisma.TransactionClient;

/** Aplica las migraciones que falten (las mismas de prisma/migrations) y deja la sesión en UTC. */
export async function prepararBase(pg: PGlite) {
  await pg.exec(`SET TimeZone TO 'UTC'`);
  await pg.exec(`CREATE TABLE IF NOT EXISTS _marea_migraciones (nombre text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())`);
  const hechas = new Set((await pg.query<{ nombre: string }>(`SELECT nombre FROM _marea_migraciones`)).rows.map((fila) => fila.nombre));
  for (const migracion of MIGRACIONES) {
    if (hechas.has(migracion.nombre)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(migracion.sql);
      await tx.query(`INSERT INTO _marea_migraciones (nombre) VALUES ($1)`, [migracion.nombre]);
    });
  }
}

/**
 * Abre la base (y la crea la primera vez). `copia`: arranca desde una copia de seguridad.
 * `alCambiar`: se avisa la nueva ubicación cuando una restauración pasa a otra base (el service worker la guarda).
 */
let alCambiar: ((ubicacion: string | undefined) => Promise<void>) | undefined;
let cambio: Promise<void> | null = null;

export async function abrirBase(dataDir: string | undefined, recursosBase: RecursosBase, opciones: { copia?: Blob; alCambiar?: typeof alCambiar } = {}) {
  ubicacion = dataDir;
  recursos = recursosBase;
  alCambiar = opciones.alCambiar;
  const pg = await PGlite.create(dataDir, { ...recursosBase, ...(opciones.copia ? { loadDataDir: opciones.copia } : {}) });
  await prepararBase(pg);
  actual = pg;
  return pg;
}

export function baseActual() {
  return actual;
}

/** Mientras se cambia la base (restauración), las peticiones esperan aquí. */
export function esperarCambio() {
  return cambio ?? Promise.resolve();
}

/** Copia completa de la base (archivo .tar.gz de PostgreSQL). */
export async function volcarBase(): Promise<Blob> {
  if (!actual) throw new Error("La base de datos de Marea todavía no está abierta.");
  return actual.dumpDataDir("gzip");
}

/** Comprueba que un archivo sea una copia de Marea abriéndolo aparte, en memoria. */
export async function revisarCopia(copia: Blob) {
  // Antes de dársela a PostgreSQL: debe ser un .tar.gz completo (un archivo cualquiera se rechaza aquí).
  const inicio = new Uint8Array(await copia.slice(0, 2).arrayBuffer());
  if (inicio[0] !== 0x1f || inicio[1] !== 0x8b) return false;
  try {
    const lector = copia.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    while (!(await lector.read()).done);
  } catch {
    return false;
  }
  const prueba = await PGlite.create(undefined, { ...recursos, loadDataDir: copia });
  try {
    const { rows } = await prueba.query<{ ok: boolean }>(`SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public.orders') IS NOT NULL AS ok`);
    return rows[0]?.ok === true;
  } finally {
    await prueba.close();
  }
}

/**
 * Reemplaza toda la base por una copia (ya revisada). La copia se abre en una base NUEVA y, cuando está lista,
 * pasa a ser la actual; la anterior se cierra (y el service worker la borra la próxima vez que arranque).
 * Así nunca queda la pesquera sin base, ni a medio restaurar.
 */
export async function reemplazarBase(copia: Blob) {
  let terminar!: () => void;
  cambio = new Promise<void>((resolve) => (terminar = resolve));
  try {
    const nueva = ubicacion?.startsWith("idb://") ? `idb://marea-${Date.now()}` : undefined;
    const pg = await PGlite.create(nueva, { ...recursos, loadDataDir: copia });
    await prepararBase(pg);
    const anterior = actual;
    actual = pg;
    ubicacion = nueva;
    await alCambiar?.(nueva);
    // Las consultas que ya iban en la base anterior terminan antes de cerrarla.
    setTimeout(() => void anterior?.close().catch(() => undefined), 3000);
  } finally {
    cambio = null;
    terminar();
  }
}
