# Marea — software para la pesquera

Recibe pedidos, los despacha con el **peso real**, lleva el **inventario por kilo y por unidad**, muestra las
**ventas del día** con cierre de caja y un tablero **En vivo con gráficas 3D** que se actualiza al instante.

> «Marea» es un nombre provisional. El nombre de la pesquera se cambia en **Ajustes** y aparece en el panel y en la tienda.

## Qué hace

| Pantalla | Para qué | Quién la ve |
|---|---|---|
| **Pedidos** | Tablero en columnas (Recibidos → Alistando → Listos → En camino). Pedido nuevo por mostrador, llamada o WhatsApp; venta de mostrador que se entrega y descuenta en el acto; pesaje con el peso real; despacho; cobro; cancelación. Suena y avisa cuando entra un pedido. | Todos (cada rol con sus botones) |
| **Inventario** | Existencia, comprometido (pedidos abiertos) y disponible; alertas de stock bajo; entradas de mercancía con costo (costo promedio ponderado), conteos físicos, mermas y kardex por producto. | Todos ven; Bodega y Admin mueven |
| **Ventas del día** | Ventas, ticket promedio, kilos, cobrado vs. por cobrar, ganancia estimada, cierre de caja por forma de pago (imprimible), más vendidos y origen. Cualquier día. | Admin y Ventas |
| **En vivo 3D** | Cifras del día contra ayer a la misma hora, pedidos ahora, actividad, ventas por hora × categoría en 3D, bodega en 3D (valor y nivel de existencia) y los últimos 14 días en 3D. Cada gráfica tiene tooltip y «Ver como tabla». | Admin |
| **Personal / Ajustes** | Usuarios por rol; datos de la pesquera, domicilio, pedido mínimo y tienda abierta/cerrada. | Admin |
| **Tienda** (`/tienda`) | Los clientes piden desde el celular, solo lo disponible, y siguen su pedido en vivo con un enlace propio. | Público |

### Reglas del negocio (las hace cumplir el servidor y la base de datos)

- Cantidades en milésimas (gramos para lo que va por kilo) y dinero en pesos enteros: sin errores de redondeo.
- Al **recibir** un pedido la mercancía queda **comprometida**; se **descuenta** cuando sale (despachado, o entregado si el cliente recoge), con el peso real si se pesó.
- Nunca hay existencias negativas: el despacho se rechaza si no alcanza (también con dos personas despachando a la vez).
- La tienda en línea no deja pedir más de lo disponible; el personal sí puede, con aviso (el pesaje manda).
- Un pedido que ya salió solo lo anula el administrador, y la mercancía vuelve al inventario.
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
