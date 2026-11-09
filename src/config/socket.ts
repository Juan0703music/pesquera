import type http from "node:http";
import { Server } from "socket.io";
import { authService } from "../modules/auth/auth.service.js";
import { readSessionToken } from "../modules/auth/session-cookie.js";
import { live, type LiveEvent } from "../services/live.service.js";
import { logger } from "../utils/logger.js";
import { isAllowedOrigin } from "./cors.js";

/**
 * Tiempo real del panel: cada cambio (pedido nuevo, pesaje, despacho, pago, entrada de mercancía…)
 * llega al instante a todas las pantallas abiertas del equipo.
 *
 * - Autentica con la misma cookie de sesión del panel.
 * - Rechaza conexiones de otros sitios (cabecera Origin).
 * - Cada minuto vuelve a validar la sesión: si la persona cerró sesión o la desactivaron, se desconecta.
 * - Solo avisa: las pantallas vuelven a consultar la API (PostgreSQL es la fuente de verdad).
 */
const REVALIDATE_MS = 60_000;
export const STAFF_ROOM = "staff";

interface ServerToClientEvents {
  ready: (payload: { userId: string }) => void;
  change: (event: LiveEvent) => void;
}

interface SocketData {
  token: string;
  userId: string;
}

export function attachSocket(server: http.Server) {
  const io = new Server<Record<string, never>, ServerToClientEvents, Record<string, never>, SocketData>(server, {
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || isAllowedOrigin(origin, req.headers.host));
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = readSessionToken(socket.request.headers.cookie);
      const resolved = token ? await authService.resolveSession(token) : null;
      if (!token || !resolved) return next(new Error("UNAUTHORIZED"));
      socket.data = { token, userId: resolved.auth.userId };
      next();
    } catch (error) {
      logger.error({ err: error }, "Error al autenticar un socket");
      next(new Error("SERVER_ERROR"));
    }
  });

  io.on("connection", (socket) => {
    void socket.join(STAFF_ROOM);
    socket.emit("ready", { userId: socket.data.userId });
    const timer = setInterval(async () => {
      try {
        if (!(await authService.resolveSession(socket.data.token))) socket.disconnect(true);
      } catch {
        // Error temporal de base de datos: se intenta en la siguiente revisión.
      }
    }, REVALIDATE_MS);
    timer.unref();
    socket.on("disconnect", () => clearInterval(timer));
  });

  const off = live.on((event) => io.to(STAFF_ROOM).emit("change", event));

  return {
    io,
    async close() {
      off();
      await io.close();
    },
  };
}
