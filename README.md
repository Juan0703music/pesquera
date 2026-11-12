# Marea — software para la pesquera

Recibe pedidos, los despacha con el **peso real**, lleva el **inventario por kilo y por unidad**, muestra las
**ventas del día** con cierre de caja y un tablero **En vivo con gráficas 3D** que se actualiza al instante.

> «Marea» es un nombre provisional. El nombre de la pesquera se cambia en **Ajustes** y aparece en el panel y en la tienda.

## Úsalo en el navegador (la forma principal)

**<https://juan0703music.github.io/pesquera/>**: se abre en Edge o Chrome. **No necesita servidor ni nube.**

- Todo se guarda dentro del navegador de ese computador: PostgreSQL en WebAssembly, con la misma lógica de este
  repositorio.
- Cada persona del equipo entra tocando su nombre, con PIN si lo tiene.
- Las copias de seguridad se descargan desde Ajustes.

Guía: **[docs/navegador.md](docs/navegador.md)**.

Esta versión no tiene la tienda en línea ni los avisos al celular, porque los datos no salen del computador. Lo
que sigue en este README describe además la versión con servidor (Supabase + Railway), que se conserva en el
repositorio por si algún día se quiere en la nube.

## Qué hace

| Pantalla | Para qué | Quién la ve |
|---|---|---|
| **Pedidos** | Tablero en columnas (Recibidos → Alistando → Listos). La pesquera no hace domicilios: el cliente recoge. Pedido nuevo por mostrador, llamada o WhatsApp; venta de mostrador que se entrega y descuenta en el acto; pesaje con el peso real; despacho; cobro; cancelación. Suena y avisa cuando entra un pedido. | Todos (cada rol con sus botones) |
| **Inventario** | Existencia, comprometido (pedidos abiertos) y disponible; foto de cada producto (se guarda en WebP, sin la ubicación del celular) y «cómo lo puede pedir el cliente» (entero, limpio, en postas…); alertas de stock bajo; entradas de mercancía con costo (costo promedio ponderado), conteos físicos, mermas y kardex por producto. | Todos ven; Bodega y Admin mueven |
| **Ventas del día** | Ventas, ticket promedio, kilos, cobrado vs. por cobrar, ganancia estimada, cierre de caja por forma de pago (imprimible), más vendidos y origen. Cualquier día. | Admin y Ventas |
| **En vivo 3D** | Cifras del día contra ayer a la misma hora, pedidos ahora, actividad, ventas por hora × categoría en 3D, bodega en 3D (valor y nivel de existencia) y los últimos 14 días en 3D. Cada gráfica tiene tooltip y «Ver como tabla». | Admin |
| **Cuentas de cobro** | Llaves Bre-B (celular, documento o código de comercio, correo, @alias), Nequi, Daviplata y cuentas bancarias. Se sube el pantallazo del QR que da el banco: Marea lee el código y lo muestra nítido (la imagen no se guarda). | Admin configura; Ventas las ve para cobrar |
| **Personal / Ajustes** | Usuarios por rol; **logo de la pesquera** (se guarda en la base, no en el repositorio, y se usa en el panel, la entrada, la tienda, el seguimiento y el ícono de la pestaña); datos de la pesquera, dirección de recogida, pedido mínimo y tienda abierta/cerrada. | Admin |
| **Tienda** (`/tienda`) | «La pizarra del día»: lo que llegó hoy (o lo más pedido) con fotos y la lista de precios del día; buscador y categorías; ficha con foto, cortes y cantidades rápidas (½ a 10 kg); «Pedir lo mismo» de la última vez; el cliente recoge en la pesquera y sigue su pedido en vivo. | Público |

### Reglas del negocio (las hace cumplir el servidor y la base de datos)

- Cantidades en milésimas (gramos para lo que va por kilo) y dinero en pesos enteros: sin errores de redondeo.
- Sin domicilios: todo pedido se recoge en la pesquera (Recibido → Alistando → Listo → Entregado). Los pedidos antiguos con domicilio se conservan en el historial.
- Al **recibir** un pedido la mercancía queda **comprometida**; se **descuenta** al entregarlo, con el peso real si se pesó.
- Nunca hay existencias negativas: el despacho se rechaza si no alcanza (también con dos personas despachando a la vez).
- La tienda en línea no deja pedir más de lo disponible; el personal sí puede, con aviso (el pesaje manda).
- Un pedido que ya salió solo lo anula el administrador, y la mercancía vuelve al inventario.
- «Llegó hoy» sale de las entradas de mercancía registradas hoy en Inventario; «quedan pocos», de lo disponible.
- Pagos por transferencia: el cliente ve las cuentas según la forma de pago (Nequi → Nequi y llave Bre-B; transferencia →
  banco, Daviplata y Bre-B). En el seguimiento ve el QR y el valor; si hay productos por kilo sin pesar, el valor dice
  «estimado» hasta el pesaje. En el panel, «Cobrar con QR» lo muestra en pantalla o lo envía por WhatsApp.
- Cada salida guarda el costo promedio del momento: así se calcula la ganancia estimada del día.
- «Hoy» es el día en Colombia (`TIME_ZONE`), no el de UTC.

### Cuentas del equipo

- **Primera vez:** si todavía no hay nadie registrado, la pantalla de entrada pide crear la cuenta del **administrador**.
- **Después:** cada persona del equipo se registra en «Crear cuenta» y elige su puesto. Queda **pendiente** y no puede
  entrar hasta que el administrador la apruebe en **Personal**, donde también le confirma o le cambia el rol.
  Así nadie de afuera puede registrarse y ver ventas, clientes o inventario.
- El administrador también puede crear cuentas directamente en «Personal → Agregar persona».

### Roles

| Rol | Puede |
|---|---|
| Administrador | Todo |
| Ventas | Recibir pedidos, cobrar, despachar, ver ventas del día |
| Despacho | Alistar, pesar, marcar listo, despachar y entregar |
| Bodega | Entradas de mercancía, conteos y mermas |

### Aspecto

- Identidad marina: menú «mar profundo» en los dos temas, acción aguamarina y tipografía propia (Bricolage Grotesque,
  servida desde el proyecto, sin internet) para títulos y cifras.
- **Tema claro u oscuro** con el botón «Claro / Oscuro» del menú (también en la entrada y en la tienda). Por defecto sigue
  el tema del equipo; la elección se recuerda en cada navegador. Cada tema tiene sus propios colores, también en las gráficas 3D.
- **Modo pantalla** en «En vivo 3D» para dejar el tablero a pantalla completa en un televisor.

## Cómo arrancarlo (desarrollo)

Requisitos: Node 22.12 o superior. No hace falta Docker: PostgreSQL corre embebido.

```bash
npm install
npm run db:start          # terminal 1: PostgreSQL local en el puerto 5434 (Ctrl+C para detenerlo)
npm run db:deploy         # aplica las migraciones
npm run db:seed           # pesquera de demostración con 14 días de historia
npm run dev               # terminal 2: http://localhost:3100
npm run demo:live         # opcional, terminal 3: simula pedidos y despachos para ver el tablero moverse
```

En desarrollo, la pantalla de entrada muestra botones de **Modo demostración** para entrar con un clic como cada puesto
(nunca en producción). Usuarios de la demostración (contraseña `marea12345`): `admin@pesquera.test`, `ventas@pesquera.test`,
`despacho@pesquera.test`, `bodega@pesquera.test`. Para volver a empezar: `SEED_RESET=1 npm run db:seed`.

## Producción (Supabase + Railway)

La base de datos va en **Supabase** y la aplicación en **Railway**, que la construye con el `Dockerfile` y la
vuelve a publicar con cada cambio en `main`. Paso a paso, variables, costos y problemas comunes:
**[docs/produccion.md](docs/produccion.md)**.

- Al arrancar, Marea revisa su configuración y **no arranca** si algo es inseguro: la base fuera de UTC, una base
  remota sin cifrar, un servidor nuevo sin `SETUP_CODE` o cuentas de demostración activas.
- La primera cuenta (administrador) se crea en `/login` con el código `SETUP_CODE`.
- Todas las tablas tienen seguridad por filas (RLS) y sin permisos para la API pública de Supabase.
- Las migraciones se aplican solas al desplegar; si fallan, sigue funcionando la versión anterior.

### Apps para Windows y Android

- **Windows:** instalador `.exe` con su propia ventana. Queda en la bandeja del sistema y avisa con sonido y
  notificación de Windows cada pedido nuevo.
- **Android:** `.apk` con el panel a pantalla completa y **avisos aunque la app esté cerrada** (Web Push).

Las dos se conectan al mismo servidor, así que lo que entra en el PC sale al instante en el celular. GitHub las
construye con el logo y el nombre de la pesquera (Actions → «Apps (Windows y Android)») y las deja en Releases.
Guía: **[docs/apps.md](docs/apps.md)**.

### Copias de seguridad

```bash
npm run db:backup                 # copia de DATABASE_URL en backups/ (no se sube a GitHub)
npm run db:backup:verify          # la restaura en una base temporal local, la revisa y la borra
npm run db:restore -- backups/marea-<fecha> --target <url-de-una-base-vacía> --yes
```

## Pruebas

```bash
npm run typecheck
npm test                  # levanta un PostgreSQL temporal y aplica las migraciones
```

## Cómo está hecho

- **Servidor:** Node + Express 5 + TypeScript, Prisma 7 sobre PostgreSQL, Zod para validar, sesiones con cookie httpOnly (Argon2id).
- **Tiempo real:** Socket.IO avisa cada cambio a las pantallas abiertas; PostgreSQL sigue siendo la fuente de verdad.
- **Pantallas:** HTML + JavaScript sin framework; gráficas 3D con Three.js servido desde `node_modules` (sin CDN). Política de seguridad de contenido estricta (sin scripts ni estilos en línea).
- `prisma/schema.prisma` (modelo), `src/modules/*` (API por módulo), `public/` (pantallas), `tests/` (pruebas).
