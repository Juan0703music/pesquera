# Marea en producción: Supabase + Railway

Esta guía pone Marea en internet con un dominio `https://…` para el equipo y para la tienda de los clientes.

- **Supabase** guarda la base de datos (PostgreSQL), con el logo y las fotos incluidos.
- **Railway** ejecuta la aplicación: construye la imagen con el `Dockerfile` del repositorio y la publica.

```
Clientes y equipo ──HTTPS──▶ Railway (Marea, 1 réplica) ──TLS, pooler modo sesión──▶ Supabase (PostgreSQL)
```

Tiempo estimado: 30 a 45 minutos la primera vez.

> **Nunca pegues contraseñas ni la URL de la base en el repositorio, en issues o en chats.** Solo van en las
> variables de Railway y en tu gestor de contraseñas. El repositorio es público.

---

## 1. Supabase: crear la base

1. Entra a <https://supabase.com/dashboard> con tu cuenta (la misma de Contafi) → **New project**.
   - En el plan gratuito caben **2 proyectos activos por organización**. Si ya tienes dos, crea una
     organización nueva o pasa a Pro.
2. Datos del proyecto:
   - **Name:** `marea` (o el nombre de la pesquera).
   - **Database password:** pulsa **Generate a password** y guárdala en tu gestor de contraseñas.
     Si escribes una a mano, usa solo letras y números: los símbolos `@ : / ? # %` dañan la URL de conexión.
   - **Region:** **East US (North Virginia)**. Railway no tiene servidores en Suramérica: con la base y la
     aplicación en Virginia, cada consulta tarda ~1 ms en vez de ~120 ms. Desde Colombia, Virginia queda igual de
     cerca que São Paulo.
   - **Security options:** desmarca **Enable Data API**. Marea no la usa: se conecta directo a PostgreSQL.
3. Espera a que el proyecto termine de crearse (1 a 2 minutos).

### 1.1 Copiar la URL de conexión

Pulsa **Connect** (arriba). Elige **Session pooler** (no «Direct connection»: esa solo funciona por IPv6 y
Railway no la alcanza). La URL tiene esta forma:

```
postgresql://postgres.abcdefghijklmnopqrst:[YOUR-PASSWORD]@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

Reemplaza `[YOUR-PASSWORD]` por la contraseña y **agrega al final `?sslmode=require`**: las migraciones
quedan siempre cifradas. Esta URL completa será la variable `DATABASE_URL`.

### 1.2 Descargar el certificado

**Project Settings → Database → SSL Configuration → Download certificate**. Con él, Marea comprueba que de
verdad habla con Supabase («verify-full») y no con un intermediario.

Para pegarlo en Railway como una sola línea:

```bash
base64 -w0 ~/Descargas/prod-ca-2021.crt; echo
```

El texto que sale es la variable `DATABASE_CA_CERT`. También se puede pegar el certificado tal cual, con sus
líneas `-----BEGIN CERTIFICATE-----`.

En la misma pantalla activa **Enforce SSL on incoming connections**: nadie podrá conectarse sin cifrar.

### 1.3 Comprobar la zona horaria

En **SQL Editor** ejecuta `SHOW timezone;`. Debe decir `UTC`, que es lo normal en Supabase. Marea guarda las
fechas en UTC y calcula «hoy» en hora de Colombia (`TIME_ZONE`). Si no dice UTC, la aplicación no arranca y
te muestra el comando para corregirlo.

### Qué protege la base

- La migración `cerrar_api_de_datos_supabase` activa la **seguridad por filas (RLS)** en todas las tablas y quita
  los permisos a los roles `anon` y `authenticated`. Aunque alguien active la Data API o consiga la clave
  pública, no ve ni una fila. Una prueba automática falla si una tabla nueva queda sin RLS.
- El asesor de seguridad de Supabase puede mostrar «RLS enabled, no policy» en cada tabla. Es lo esperado: sin
  políticas, nadie lee por la API.

---

## 2. Railway: publicar la aplicación

1. Entra a <https://railway.com> con tu cuenta de GitHub → **New Project → Deploy from GitHub repo** →
   `Juan0703music/pesquera`. Railway encuentra el `Dockerfile` y lo usa solo.
2. El primer despliegue va a fallar porque faltan las variables. Es normal.
3. Abre el servicio → **Settings**:
   - **Networking → Generate Domain.** Te da algo como `pesquera-production.up.railway.app`.
   - **Deploy → Healthcheck Path:** `/api/v1/health`. Railway solo cambia a la versión nueva cuando responde bien.
   - **Deploy → Region:** **US East (Virginia)**, la misma zona de la base.
   - **Replicas:** deja **1**. El tablero en vivo avisa los cambios entre pantallas desde la memoria del
     servidor; con dos réplicas, unas pantallas no se enterarían de lo que pasa en la otra.
   - **Serverless** (apagar cuando no hay visitas): déjalo **apagado**. Las pantallas en vivo necesitan el
     servidor encendido.
   - No pongas «Pre-deploy command»: la imagen ya aplica las migraciones al arrancar.
4. **Variables → Raw Editor** y pega, con tus valores:

```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres.abcdefghijklmnopqrst:CLAVE@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
DATABASE_CA_CERT=LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t...
SETUP_CODE=un-codigo-largo-que-solo-tu-conoces
APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
COOKIE_SECURE=true
TRUST_PROXY=1
TIME_ZONE=America/Bogota
LOG_LEVEL=info
```

- `SETUP_CODE`: con él se crea la cuenta del administrador (paso 3). Genera uno con `openssl rand -base64 24`.
- `APP_URL`: `${{RAILWAY_PUBLIC_DOMAIN}}` lo llena Railway con el dominio del paso 3. Si luego pones un dominio
  propio (por ejemplo `pedidos.lumar.com.co`), escríbelo aquí.
- `PORT` no se define: Railway la pone sola.
- `DATABASE_POOL_MAX` (opcional, 5 por defecto): conexiones simultáneas a Supabase. 5 alcanzan para una pesquera.
- Avisos al celular: no hace falta configurar nada (el servidor crea sus llaves la primera vez). Opcionales:
  `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`. Las apps de Windows y Android: [apps.md](apps.md).

5. Guarda. Railway vuelve a desplegar. En **Deploy Logs** debes ver que se aplicaron las migraciones y
   `Marea escuchando…`. Si algo falta, el log lo dice con la solución (ver «Problemas comunes»).

### Qué revisa Marea al arrancar

| Situación | Resultado |
|---|---|
| La base no está en UTC | No arranca y muestra el comando para corregirla |
| Base remota sin cifrado (`DATABASE_SSL=disable`) | No arranca |
| No hay cuentas y falta `SETUP_CODE` | No arranca: así nadie de afuera se registra primero y se queda con todo |
| Hay cuentas de demostración activas (contraseña conocida) | No arranca y muestra el comando para desactivarlas |
| Falta el certificado, `COOKIE_SECURE` no es `true`, `APP_URL` sin https o `TRUST_PROXY=0` | Arranca con un aviso en el log |

---

## 3. Primera entrada

1. Abre `https://<tu-dominio>/login`. Como no hay cuentas, pide crear la del **administrador** y el
   **código de configuración**: escribe el `SETUP_CODE`.
2. **Ajustes:** nombre de la pesquera, teléfono, WhatsApp, dirección de recogida y pedido mínimo. Guarda.
   Después sube el **logo** (necesita los datos guardados primero).
3. **Cuentas de cobro:** llaves Bre-B, Nequi, Daviplata y cuentas bancarias, con el QR de cada una.
4. **Inventario:** categorías, productos con su foto y precio, y la primera **entrada de mercancía** con el costo.
5. **Personal:** cada persona del equipo se registra en «Crear cuenta» y tú la apruebas aquí.
6. Ya con tu cuenta creada, puedes **borrar `SETUP_CODE`** de las variables de Railway: no se vuelve a usar.
7. Comparte con los clientes `https://<tu-dominio>/tienda`.

> La base de tu PC tiene la **demostración** (usuarios `@pesquera.test` con contraseña `marea12345`). **No la
> copies a producción.** Empieza limpia y carga los datos reales desde el panel. Si alguna vez restauras una copia
> con esos usuarios, Marea no arranca hasta desactivarlos.

---

## 4. Actualizaciones

Cada cambio que llega a la rama `main` de GitHub se publica solo:

1. Railway construye la imagen nueva.
2. Al arrancar, aplica las migraciones pendientes (`prisma migrate deploy`).
3. Si el arranque o la verificación de salud fallan, **la versión anterior sigue funcionando** y el error queda
   en **Deploy Logs**.

Las migraciones se aplican directo en la base de producción. Antes de subir un cambio que trae una migración,
haz una copia de seguridad (sección 5). Si prefieres decidir cuándo se publica, en **Settings → Source** cambia
la rama a `produccion` y sube a esa rama solo lo que quieras publicar.

Para volver a una versión anterior: **Deployments →** la versión buena **→ Redeploy**. Ojo: eso no deshace las
migraciones. Si una migración dañó datos, se restaura una copia.

---

## 5. Copias de seguridad

- **Supabase Pro** hace una copia diaria y la guarda 7 días (se restaura desde el panel). **El plan gratuito no
  incluye copias que puedas descargar.**
- **Copias propias** (en cualquier plan), desde tu PC, con el proyecto clonado y `npm install` hecho. Las
  copias quedan en `backups/`, que nunca se sube a GitHub porque tiene datos de clientes y ventas.

```bash
cd ~/Escritorio/pesquera
read -rsp "URL de Supabase (no se muestra ni queda en el historial): " DATABASE_URL; echo; export DATABASE_URL
export DATABASE_CA_CERT=~/Descargas/prod-ca-2021.crt

npm run db:backup            # copia de la base de producción en backups/marea-<fecha>/
npm run db:start             # en otra terminal: PostgreSQL local para la prueba
npm run db:backup:verify     # restaura la copia en una base temporal LOCAL, revisa filas, totales e
                             # inventario, y la borra (nunca crea bases en Supabase)
```

- Se conservan las últimas 14 copias (`BACKUP_KEEP` cambia el número).
- **Restaurar** en una base vacía (por ejemplo, un proyecto nuevo de Supabase). Nunca sobrescribe datos: si la
  base de destino tiene algo, se detiene.

```bash
npm run db:restore -- backups/marea-<fecha> --target "<URL del pooler del proyecto nuevo>" --yes
```

Recomendación: una copia cada semana y antes de cada actualización con migración. Guarda una copia fuera del
PC (disco externo o tu nube personal, en una carpeta privada).

---

## 6. Costos aproximados

Son precios de referencia; revísalos en las páginas de cada servicio antes de decidir.

| Servicio | Plan | Precio | Notas |
|---|---|---|---|
| Railway | Hobby | ~5 USD/mes | Incluye 5 USD de consumo; Marea con una réplica suele caber o pasar por poco |
| Supabase | Free | 0 | 500 MB de base (alcanza para años de pedidos y cientos de fotos). Pausa el proyecto tras 7 días sin actividad. Sin copias descargables |
| Supabase | Pro | ~25 USD/mes | Copias diarias, sin pausas y más espacio. Recomendado cuando la pesquera dependa del sistema |

---

## 7. Problemas comunes

| En el log | Qué hacer |
|---|---|
| `zona horaria «…» y debe estar en UTC` | En Supabase → SQL Editor: `ALTER DATABASE postgres SET timezone TO 'UTC';` y redeploy |
| `falta SETUP_CODE` | Agrega `SETUP_CODE` en las variables de Railway |
| `cuenta(s) de demostración activas` | En Supabase → SQL Editor: `UPDATE users SET active = false WHERE email LIKE '%@pesquera.test';` |
| `password authentication failed` | Contraseña equivocada o con símbolos sin codificar. Cámbiala en Supabase → Database → Reset password (solo letras y números) |
| `ENETUNREACH` o una dirección con `:` (IPv6) | Estás usando «Direct connection»: cambia a la URL del **Session pooler** |
| `self-signed certificate` o `Hostname/IP does not match` | Revisa que `DATABASE_CA_CERT` sea el certificado de **este** proyecto. Para salir del paso, `DATABASE_SSL=require` (cifra sin verificar) mientras se revisa |
| `too many connections` / `max clients reached` | Baja `DATABASE_POOL_MAX` (por ejemplo a 3) |
| La verificación de salud no pasa | Lee el error en Deploy Logs: casi siempre es una de las anteriores |

---

## Lista final

- [ ] Proyecto de Supabase en Virginia, Data API desactivada y SSL obligatorio.
- [ ] Contraseña de la base solo en el gestor de contraseñas y en Railway.
- [ ] `DATABASE_URL` del **Session pooler** con `?sslmode=require`, y `DATABASE_CA_CERT` puesto.
- [ ] Railway en Virginia con 1 réplica, healthcheck `/api/v1/health` y dominio generado.
- [ ] Cuenta del administrador creada con `SETUP_CODE`; después, `SETUP_CODE` borrado.
- [ ] Datos de la pesquera, logo, cuentas de cobro y productos cargados.
- [ ] Primera copia de seguridad hecha **y verificada** (`db:backup` + `db:backup:verify`).
- [ ] Apps de Windows y Android construidas y publicadas ([apps.md](apps.md)).
