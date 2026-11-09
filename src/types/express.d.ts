import type { Role } from "../generated/prisma/enums.js";

/** Persona del equipo autenticada por la cookie de sesión. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  name: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      /** Lo define el middleware `authenticate`. */
      auth?: AuthContext;
    }
  }
}

export {};
