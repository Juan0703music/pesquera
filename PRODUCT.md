# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Equipo de una sola pesquera** (Colombia, costa Caribe): administrador o dueño, ventas (mostrador, llamadas, WhatsApp), despacho (alistar y pesar) y bodega (entradas de mercancía, conteos, mermas). Usan el panel en el mostrador y la bodega con luz fuerte (a veces con las manos mojadas o con guantes), en la oficina del dueño, en un televisor en la pared con el tablero en vivo y en los celulares del personal.
- **Clientes de la tienda en línea**: familias y hogares (compran 1 a 3 kg, miran fotos y precios), restaurantes y negocios (5 a 20 kg, casi siempre lo mismo), turistas o clientes de temporada (no conocen los productos) y revendedores (otros pescaderos o tiendas). Compran desde el celular.

## Product Purpose

Recibir pedidos (mostrador, llamada, WhatsApp y tienda en línea), alistarlos con el peso real, entregarlos, llevar el inventario por kilo y por unidad, ver las ventas del día con cierre de caja y seguir el negocio en vivo. Éxito: el pedido sale con el peso y el cobro correctos, la existencia cuadra con la bodega y el dueño ve el día sin preguntar.

## Positioning

Hecho para el pescado: se vende por kilo con el peso real al alistar (el total del cliente es estimado hasta el pesaje), el inventario distingue lo comprometido en pedidos abiertos de lo disponible, y cada salida guarda el costo para estimar la ganancia del día.

## Operating Context

- La pesquera **no hace domicilios** (decisión del dueño, 2026-11-09): todos los pedidos se recogen en el local. Flujo: Recibido → Alistando (pesaje) → Listo → Entregado.
- Llega mercancía (lancha, proveedores) y se registra como entrada con su costo; hay mermas y conteos físicos.
- Cobro en efectivo, Nequi, transferencia, llave Bre-B (QR del banco) o datáfono; los restaurantes a veces a crédito.
- Al comprar en línea, al cliente le importa: qué llegó fresco hoy, elegir cómo lo quiere (entero, limpio, en postas, en filete…), fotos y descripción clara, y repetir rápido su pedido de siempre.

## Capabilities and Constraints

- Una sola pesquera (no es multiempresa). Moneda COP sin centavos; cantidades en milésimas (gramos). Zona horaria America/Bogota.
- Roles: Administrador, Ventas, Despacho, Bodega. El registro desde la entrada queda pendiente hasta que el administrador lo apruebe.
- La tienda no revela existencias exactas ni costos: solo si hay, si quedan pocos y hasta cuánto se puede pedir.
- Tecnología: Node + Express + TypeScript + Prisma/PostgreSQL; pantallas en HTML y JavaScript sin framework; política de seguridad de contenido estricta (sin scripts ni estilos en línea).

## Brand Commitments

- «Marea» es el nombre provisional del software; el nombre de la pesquera lo pone el dueño en Ajustes (en uso: «LU&MAR»).
- Identidad marina confirmada por el dueño (2026-11-08): menú «mar profundo», acción aguamarina, tipografía Bricolage Grotesque para títulos y cifras, tema claro «hielo» y oscuro «abismo» (por defecto, el del equipo de cada persona).
- Todo el texto en español de Colombia.

## Evidence on Hand

- Fotos reales de los productos: el dueño las subirá desde el panel (Inventario). Mientras no haya foto, se usa una ilustración; no inventar fotos.
- Datos de demostración (`npm run db:seed`) son ficticios: no presentarlos como clientes, ventas o testimonios reales.

## Product Principles

1. El peso real manda: todo valor por kilo es estimado hasta el pesaje y se dice así.
2. Rápido en el mostrador: pocas pantallas, botones grandes, el siguiente paso siempre visible.
3. La existencia no miente: comprometido, disponible y kardex siempre cuadran.
4. Lo fresco al frente: lo que llegó hoy y lo que queda poco se ve primero.
5. Nada de domicilios: el cliente recoge en la pesquera.

## Accessibility & Inclusion

Contraste alto para pantallas con luz fuerte, objetivos táctiles grandes (40 px o más) para celulares y guantes, información de estado siempre con icono y texto (nunca solo color).
