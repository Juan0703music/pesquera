import { z } from "zod";
import { parseBreBKey } from "./payment-accounts.service.js";

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const holderName = z.string({ error: "Escribe el nombre del titular." }).trim().min(2, "Escribe el nombre del titular.").max(80);
const holderDocument = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s.]/g, ""))
    .refine((value) => /^\d{5,12}(-\d)?$/.test(value), "Escribe la cédula o el NIT solo con números (el NIT puede llevar el dígito de verificación: 900123456-7).")
    .optional(),
);
const active = z.boolean().default(true);

/** Celular de billetera (Nequi, Daviplata): 10 dígitos que empiezan por 3. */
const walletNumber = z
  .string({ error: "Escribe el número." })
  .trim()
  .transform((value) => value.replace(/[\s.-]/g, "").replace(/^(\+?57)(?=3\d{9}$)/, ""))
  .refine((value) => /^3\d{9}$/.test(value), "Escribe el celular de la billetera: 10 dígitos que empiezan por 3.");

/** Cuenta de cobro según su tipo; cada tipo valida su número o llave. */
export const PaymentAccountSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("BRE_B"),
      accountKey: z
        .string({ error: "Escribe la llave Bre-B." })
        .trim()
        .transform((value, ctx) => {
          const parsed = parseBreBKey(value);
          if (!parsed) {
            ctx.addIssue({
              code: "custom",
              message: "Esa llave no parece de Bre-B. Usa el celular (300 123 4567), la cédula, el NIT o el código de comercio, el correo o una llave que empiece por @.",
            });
            return z.NEVER;
          }
          return parsed.key;
        }),
      holderName,
      holderDocument,
      active,
    }),
    z.object({ kind: z.literal("NEQUI"), accountKey: walletNumber, holderName, holderDocument, active }),
    z.object({ kind: z.literal("DAVIPLATA"), accountKey: walletNumber, holderName, holderDocument, active }),
    z.object({
      kind: z.literal("BANCO"),
      accountKey: z
        .string({ error: "Escribe el número de cuenta." })
        .trim()
        .transform((value) => value.replace(/[\s.-]/g, ""))
        .refine((value) => /^\d{6,20}$/.test(value), "Escribe el número de cuenta solo con números."),
      bankName: z.string({ error: "Escribe el banco." }).trim().min(3, "Escribe el banco.").max(60),
      bankAccountType: z.enum(["AHORROS", "CORRIENTE"], { error: "Elige si es de ahorros o corriente." }),
      holderName,
      holderDocument,
      active,
    }),
  ],
  { error: "Elige el tipo de cuenta." },
);

export type PaymentAccountInput = z.infer<typeof PaymentAccountSchema>;
