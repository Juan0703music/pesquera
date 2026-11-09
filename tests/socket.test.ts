import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { attachSocket } from "../src/config/socket.js";
import type { LiveEvent } from "../src/services/live.service.js";
import { product, settings, staff } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

let server: http.Server;
let realtime: ReturnType<typeof attachSocket>;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = http.createServer(createApp());
  realtime = attachSocket(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const socket of sockets) socket.close();
  await realtime.close();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await resetDatabase();
  await settings();
});

function open(cookie?: string) {
  const socket = connect(url, { transports: ["websocket"], extraHeaders: cookie ? { cookie } : {}, reconnection: false });
  sockets.push(socket);
  return socket;
}

describe("tiempo real", () => {
  it("rechaza conexiones sin sesión", async () => {
    const socket = open();
    const error = await new Promise<Error>((resolve) => socket.on("connect_error", resolve));
    expect(error.message).toBe("UNAUTHORIZED");
  });

  it("avisa al instante a las pantallas abiertas cuando entra un pedido", async () => {
    const { agent } = await staff("ADMIN");
    const login = await agent.get("/api/v1/auth/me");
    expect(login.status).toBe(200);
    const cookie = (agent as unknown as { jar: { getCookies: (opts: object) => { toValueString: () => string }[] } }).jar
      .getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: false })
      .map((item) => item.toValueString())
      .join("; ");
    const socket = open(cookie);
    await new Promise((resolve) => socket.on("ready", resolve));
    const mojarra = await product({ stock: 5 });

    const received = new Promise<LiveEvent>((resolve) => socket.on("change", (event) => event.kind === "order.created" && resolve(event)));
    await agent.post("/api/v1/orders").send({
      source: "WHATSAPP", deliveryType: "RECOGE", paymentMethod: "EFECTIVO", customer: { name: "Hotel Playa Mar" }, items: [{ productId: mojarra.id, qty: 1 }],
    });

    const event = await received;
    expect(event).toMatchObject({ scope: "orders", kind: "order.created", data: { number: 1, customerName: "Hotel Playa Mar", status: "RECIBIDO" } });
  });
});
