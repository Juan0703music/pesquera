import http from "node:http";
import { createApp } from "./app.js";
import { prisma } from "./config/database.js";
import { env } from "./config/env.js";
import { attachSocket } from "./config/socket.js";
import { logger } from "./utils/logger.js";

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Error no controlado: el proceso se reinicia");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Promesa rechazada sin manejar: el proceso se reinicia");
  process.exit(1);
});

const server = http.createServer(createApp());
// Socket.IO comparte el servidor HTTP en /socket.io/ (pantallas en vivo del equipo).
const realtime = attachSocket(server);

server.listen(env.PORT, () => {
  logger.info(`Marea escuchando en ${env.APP_URL} (puerto ${env.PORT})`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Señal ${signal}: cerrando el servidor…`);
  setTimeout(() => process.exit(1), 8_000).unref();
  await realtime.close();
  server.close();
  server.closeIdleConnections();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
