-- This is an empty migration.-- Escrito a mano: límites para que una llave o un QR no se usen para guardar otra cosa.
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_key_length" CHECK (char_length("account_key") BETWEEN 3 AND 80);
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_qr_length" CHECK ("qr_payload" IS NULL OR char_length("qr_payload") <= 1000);
