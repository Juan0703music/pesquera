-- Escrito a mano. Supabase publica el esquema «public» en su API de datos (PostgREST), a la que cualquiera
-- puede llamar con la llave pública del proyecto. Marea no usa esa API: el único que entra a la base es su
-- servidor, como dueño de las tablas. Por eso:
--   1. Seguridad por filas (RLS) activada en todas las tablas y sin políticas: los roles de la API no ven nada.
--      El dueño de las tablas (el usuario con el que se conecta Marea) no está sujeto a RLS.
--   2. En Supabase (donde existen los roles anon y authenticated) además se les quitan los permisos,
--      también para las tablas que se creen en el futuro.
-- En la base local de desarrollo esos roles no existen y solo se aplica el punto 1.
-- Toda migración nueva que cree una tabla debe activar RLS en ella (lo verifica tests/supabase-security.test.ts).

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated';
  END IF;
END
$$;
