/**
 * Simulador de actividad para ver el tablero en vivo moverse:  npm run demo:live
 *
 * Entra a la API como el administrador de la demostración y, cada pocos segundos, recibe un pedido,
 * pesa, despacha o entrega uno abierto, o registra una entrada de mercancía. Todo pasa por la API real,
 * así que las pantallas abiertas lo ven llegar por Socket.IO como si lo hiciera una persona.
 *
 * Variables: DEMO_URL (http://localhost:3100), DEMO_EMAIL, DEMO_PASSWORD, DEMO_INTERVAL_MS (5000).
 * No se ejecuta con NODE_ENV=production.
 */
if (process.env.NODE_ENV === "production") {
  console.error("El simulador de demostración no se ejecuta en producción.");
  process.exit(1);
}

const BASE = (process.env.DEMO_URL ?? "http://localhost:3100").replace(/\/$/, "");
const EMAIL = process.env.DEMO_EMAIL ?? "admin@pesquera.test";
const PASSWORD = process.env.DEMO_PASSWORD ?? "marea12345";
const INTERVAL = Number(process.env.DEMO_INTERVAL_MS ?? 5000);

const NAMES = ["Restaurante El Muelle", "Hotel Playa Mar", "Cevichería Don Chepe", "Señora Carmen", "Don Álvaro", "Asadero La Bahía", "Yuranis", "Comidas Rápidas El Golfo", "Ledys", "Don Manuel"];
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

let cookie = "";

async function call<T = { data: unknown }>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0]!;
  const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json as T;
}

interface Product { id: string; name: string; unit: "KG" | "UNIDAD"; availableMilli: number; stockMilli: number; minStockMilli: number }
interface Order { id: string; number: number; status: string; deliveryType: string; items: { id: string; unit: string; qtyMilli: number; actualQtyMilli: number | null }[] }

async function newOrder() {
  const { data: products } = await call<{ data: Product[] }>("/catalog/products");
  const available = products.filter((product) => product.availableMilli > 3000);
  if (!available.length) return entry();
  const lines = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => pick(available))
    .filter((product, index, list) => list.indexOf(product) === index)
    .map((product) => ({ productId: product.id, qty: product.unit === "KG" ? Math.round((0.5 + Math.random() * 4) * 2) / 2 : 1 + Math.floor(Math.random() * 3) }));
  const counter = Math.random() < 0.35;
  const { data } = await call<{ data: { number: number; total: number } }>("/orders", {
    source: counter ? "MOSTRADOR" : pick(["WHATSAPP", "TELEFONO"]),
    customer: { name: pick(NAMES) },
    paymentMethod: pick(["EFECTIVO", "NEQUI", "TRANSFERENCIA", "DATAFONO"]),
    paid: counter,
    completeNow: counter,
    items: lines,
  });
  console.log(`${counter ? "Venta de mostrador" : "Pedido nuevo"} #${data.number} por ${data.total.toLocaleString("es-CO")}`);
}

async function advance() {
  const { data: orders } = await call<{ data: Order[] }>("/orders");
  const open = orders.filter((order) => ["RECIBIDO", "ALISTANDO", "LISTO", "DESPACHADO"].includes(order.status));
  if (!open.length) return newOrder();
  const order = pick(open);
  const unweighed = order.items.filter((item) => item.unit === "KG" && item.actualQtyMilli === null);
  if (["RECIBIDO", "ALISTANDO"].includes(order.status) && unweighed.length) {
    await call(`/orders/${order.id}/weigh`, { items: unweighed.map((item) => ({ itemId: item.id, actualQty: Math.round((item.qtyMilli / 1000) * (0.95 + Math.random() * 0.1) * 100) / 100 })) });
    return console.log(`Pedido #${order.number} pesado`);
  }
  const next = { RECIBIDO: "ALISTANDO", ALISTANDO: "LISTO", LISTO: "DESPACHADO", DESPACHADO: "ENTREGADO" }[order.status]!;
  await call(`/orders/${order.id}/status`, { status: next });
  console.log(`Pedido #${order.number} → ${next}`);
}

async function entry() {
  const { data: products } = await call<{ data: Product[] }>("/catalog/products");
  const low = products.filter((product) => product.stockMilli <= product.minStockMilli * 1.5);
  const product = pick(low.length ? low : products);
  const qty = product.unit === "KG" ? 10 + Math.round(Math.random() * 20) : 10 + Math.floor(Math.random() * 20);
  await call("/inventory/movements", { type: "ENTRADA", productId: product.id, qty, supplier: "Lancha La Esperanza" });
  console.log(`Entrada: ${qty} ${product.unit === "KG" ? "kg" : "und"} de ${product.name}`);
}

await call("/auth/login", { email: EMAIL, password: PASSWORD });
console.log(`Simulando actividad en ${BASE} cada ${INTERVAL / 1000} s. Ctrl+C para detener.`);
for (;;) {
  const roll = Math.random();
  try {
    if (roll < 0.4) await newOrder();
    else if (roll < 0.9) await advance();
    else await entry();
  } catch (error) {
    console.log(`(omitido: ${(error as Error).message})`);
  }
  await new Promise((resolve) => setTimeout(resolve, INTERVAL * (0.6 + Math.random() * 0.8)));
}
