/**
 * Enrutador compatible con lo que usan los módulos de Marea de Express 5 (Router, get/post/put/patch/delete,
 * use con prefijo, parámetros «:id», manejadores async y middlewares de error de 4 argumentos).
 * En la versión del navegador reemplaza a "express": las rutas de src/modules/* corren tal cual.
 */

export type Next = (error?: unknown) => void;
export type Handler = (req: Req, res: Res, next: Next) => unknown;
export type ErrorHandler = (error: unknown, req: Req, res: Res, next: Next) => unknown;
type AnyHandler = Handler | ErrorHandler | RouterFn;
// Los módulos de src/ declaran sus manejadores con los tipos de Express; también se aceptan.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = (...args: any[]) => unknown;

interface RouteMethod {
  (path: string, ...handlers: Handler[]): RouterInstance;
  (path: string, ...handlers: Loose[]): RouterInstance;
}
interface UseMethod {
  (...handlers: AnyHandler[]): RouterInstance;
  (path: string, ...handlers: AnyHandler[]): RouterInstance;
  (path: string, ...handlers: Loose[]): RouterInstance;
  (...handlers: Loose[]): RouterInstance;
}
export interface RouterInstance extends RouterFn {
  get: RouteMethod;
  post: RouteMethod;
  put: RouteMethod;
  patch: RouteMethod;
  delete: RouteMethod;
  use: UseMethod;
}

export interface Req {
  method: string;
  /** Ruta relativa al enrutador actual (cambia al entrar en un enrutador montado). */
  path: string;
  url: string;
  originalUrl: string;
  baseUrl: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  auth?: unknown;
  requestId?: string;
  ip?: string;
}

export interface Res {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  headersSent: boolean;
  status(code: number): Res;
  set(name: string | Record<string, string>, value?: string): Res;
  setHeader(name: string, value: string): Res;
  type(type: string): Res;
  json(body: unknown): Res;
  send(body?: unknown): Res;
  end(): Res;
  redirect(status: number | string, url?: string): Res;
}

interface RouterFn {
  (req: Req, res: Res, next: Next): void;
  __router: true;
}

const MIME: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  json: "application/json",
  html: "text/html; charset=utf-8",
  text: "text/plain; charset=utf-8",
};

/** Respuesta en memoria; `terminada` se cumple cuando un manejador responde. */
export function createResponse(): Res & { terminada: Promise<void> } {
  let finish!: () => void;
  const terminada = new Promise<void>((resolve) => (finish = resolve));
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    headersSent: false,
    terminada,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    set(name: string | Record<string, string>, value?: string) {
      if (typeof name === "string") res.headers[name.toLowerCase()] = String(value);
      else for (const [key, val] of Object.entries(name)) res.headers[key.toLowerCase()] = String(val);
      return res;
    },
    setHeader(name: string, value: string) {
      return res.set(name, value);
    },
    type(type: string) {
      res.headers["content-type"] = MIME[type] ?? type;
      return res;
    },
    json(body: unknown) {
      res.headers["content-type"] ??= "application/json";
      res.body = JSON.stringify(body);
      return res.end();
    },
    send(body?: unknown) {
      if (body !== undefined && body !== null && typeof body === "object" && !(body instanceof Uint8Array) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
        return res.json(body);
      }
      res.body = body;
      return res.end();
    },
    end() {
      if (!res.headersSent) {
        res.headersSent = true;
        finish();
      }
      return res;
    },
    redirect(status: number | string, url?: string) {
      const target = typeof status === "string" ? status : (url ?? "/");
      res.statusCode = typeof status === "number" ? status : 302;
      res.headers.location = target;
      return res.end();
    },
  };
  return res;
}

interface Layer {
  method: string | null;
  /** Expresión de la ruta; en «use» también acepta la ruta como prefijo. */
  regex: RegExp;
  keys: string[];
  prefix: boolean;
  handlers: AnyHandler[];
}

function compile(path: string, prefix: boolean) {
  const keys: string[] = [];
  const clean = path === "/" ? "" : path.replace(/\/$/, "");
  const pattern = clean
    .split(/(:[A-Za-z_][A-Za-z0-9_]*)/)
    .map((part) => {
      if (part.startsWith(":")) {
        keys.push(part.slice(1));
        return "([^/]+?)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return { regex: new RegExp(`^${pattern}${prefix ? "(?=/|$)" : "/?$"}`, "i"), keys };
}

async function invoke(fn: AnyHandler, error: unknown, req: Req, res: Res, next: Next) {
  try {
    const isErrorHandler = fn.length === 4 && !(fn as RouterFn).__router;
    if (error !== undefined) {
      if (isErrorHandler) await (fn as ErrorHandler)(error, req, res, next);
      else next(error);
      return;
    }
    if (isErrorHandler) return next();
    await (fn as Handler)(req, res, next);
  } catch (caught) {
    next(caught);
  }
}

export function Router() {
  const stack: Layer[] = [];

  const router = ((req: Req, res: Res, done: Next) => {
    let index = 0;
    const startPath = req.path;
    const startBase = req.baseUrl;

    const next: Next = (error) => {
      req.path = startPath;
      req.baseUrl = startBase;
      if (res.headersSent) return;
      const layer = stack[index++];
      if (!layer) return done(error);
      if (layer.method && layer.method !== req.method && !(layer.method === "GET" && req.method === "HEAD")) return next(error);
      const match = layer.regex.exec(startPath);
      if (!match) return next(error);
      const params: Record<string, string> = {};
      layer.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1] ?? "")));

      if (layer.prefix) {
        const consumed = match[0];
        req.baseUrl = startBase + consumed;
        req.path = startPath.slice(consumed.length) || "/";
      }
      req.params = { ...req.params, ...params };

      // Los manejadores de la capa, en cadena; al final sigue el enrutador.
      let step = 0;
      const chain: Next = (chainError) => {
        if (res.headersSent) return;
        const fn = layer.handlers[step++];
        if (!fn) return next(chainError);
        void invoke(fn, chainError, req, res, chain);
      };
      chain(error);
    };
    next();
  }) as RouterInstance;
  router.__router = true;

  const route = (method: string): RouteMethod => (path: string, ...handlers: (AnyHandler | Loose)[]) => {
    const { regex, keys } = compile(path, false);
    stack.push({ method, regex, keys, prefix: false, handlers: handlers.flat() as AnyHandler[] });
    return router;
  };
  router.get = route("GET");
  router.post = route("POST");
  router.put = route("PUT");
  router.patch = route("PATCH");
  router.delete = route("DELETE");
  router.use = ((...args: (string | AnyHandler | Loose)[]) => {
    const path = typeof args[0] === "string" ? (args.shift() as string) : "/";
    const { regex, keys } = compile(path, true);
    stack.push({ method: null, regex, keys, prefix: true, handlers: (args as AnyHandler[]).flat() });
    return router;
  }) as UseMethod;
  return router;
}

/** Los cuerpos ya llegan leídos (JSON o bytes): estos lectores no hacen nada. */
const passThrough: Handler = (_req, _res, next) => next();
const express = Object.assign(() => Router(), {
  Router,
  raw: (_options?: unknown) => passThrough,
  json: (_options?: unknown) => passThrough,
});

export default express;
export type RequestHandler = Handler;
export type ErrorRequestHandler = ErrorHandler;
