# Marea en el navegador (sin servidor ni nube)

Marea se abre en **Edge o Chrome** desde un enlace. Todo se guarda **dentro de ese navegador, en ese computador**:
no hay servidor, ni base de datos en internet, ni pagos mensuales.

**Dirección:** <https://juan0703music.github.io/pesquera/>

> La página la publica GitHub (gratis). Lo único que viene de internet es el programa. Pedidos, inventario,
> ventas, personal, fotos y logo nunca salen del computador.

---

## Primera vez

1. Abre la dirección en **Edge** (o Chrome) del computador de la pesquera.
2. La primera vez tarda unos segundos: descarga el programa (unos 20 MB) y lo guarda. Después abre aunque no
   haya internet.
3. Escribe el **nombre de la pesquera**, **tu nombre** y, si quieres, un **PIN** de 4 a 8 números. Eres el
   administrador.
4. En **Ajustes**, sube el logo y completa los datos.
5. En **Personal**, agrega al equipo: nombre, rol (Ventas, Despacho, Bodega o Administrador) y un PIN opcional.

**Consejo:** guarda la dirección en favoritos o crea un acceso directo. En Edge: menú ⋯ → Más herramientas →
Anclar a la barra de tareas.

## Entrar cada día

La pantalla de entrada muestra al equipo. Cada persona **toca su nombre**: si tiene PIN lo escribe; si no, entra
de una. Para cambiar de persona, toca el botón de salir, abajo en el menú.

- Sin PIN, cualquiera que use el computador puede entrar como esa persona.
- **Pon PIN al menos al administrador**: así nadie más ve las ventas ni cambia precios o personal.

## Copias de seguridad (muy importante)

Como todo está en el navegador, si se daña el computador o alguien **borra los datos de navegación** de Edge, se
pierde lo que no tenga copia.

- **Ajustes → Copia de seguridad → Descargar copia** guarda un archivo `marea-copia-AAAA-MM-DD.tar.gz` en
  Descargas. Trae todo: pedidos, inventario, ventas, personal, fotos y logo.
- Hazla **cada semana**. Si pasan 7 días sin copia, Marea se lo recuerda al administrador arriba en cada pantalla.
- Guarda la copia **fuera del computador**: una USB, tu correo o tu nube personal.

**Restaurar:**

- **En el mismo computador:** Ajustes → Copia de seguridad → **Restaurar una copia**. Reemplaza todo lo que hay
  en el navegador por lo de la copia.
- **En un computador nuevo:** abre la dirección. En la primera pantalla toca **«Restaurar una copia de
  seguridad»**, elige el archivo y listo: todo vuelve, con el mismo equipo y los mismos PIN.

## Tienda por QR (los clientes piden desde su celular)

Los clientes escanean el QR, ven la pizarra del día (productos, fotos, precios y lo que llegó hoy) y hacen su pedido.
El pedido aparece **al instante** en «Pedidos → Recibidos», con sonido. El cliente ve en su celular, en vivo, cada
paso: recibido, alistando y listo para recoger.

**Activarla (una sola vez):** Ajustes → **Tienda por QR → Activar la tienda por QR**. Ahí mismo puedes:

- **Descargar el QR** o **Imprimir cartel** para el mostrador. El QR no cambia nunca: imprímelo una vez.
- **Copiar enlace** para tu estado de WhatsApp o tus redes.
- **Recibir pedidos por el QR:** sí o no. En pausa, los clientes ven la tienda pero no pueden pedir.
- **Pedido mínimo.**
- Ver la **conexión**, por ejemplo «En línea (5 de 5 retransmisores)».

**Cuándo funciona:** mientras Marea esté **abierto en este computador, con alguien adentro y con internet**. El
cliente puede usar datos móviles o cualquier wifi. Si el PC está apagado o sin internet, la tienda dice «En este
momento la pesquera no está conectada» y no deja pedir. Cuando vuelve, se abre sola.

**Cómo funciona por dentro:**

- No hay servidor ni nube. Tu navegador y los celulares se hablan a través de **retransmisores públicos y
  gratuitos de la red Nostr**. Marea usa 5 a la vez, por si alguno falla.
- **El catálogo es público:** lo que ves en la tienda.
- **Cada pedido y cada aviso van cifrados:** solo tu Marea puede leer los pedidos, y solo el celular del cliente
  puede leer los avisos de su pedido. Ni los retransmisores pueden leerlos.
- **La llave de la tienda** (la que hace que el QR sea tuyo) queda guardada en Marea y va en las copias de
  seguridad. Si restauras una copia en otro computador, el QR impreso sigue sirviendo.
- **Protecciones:**
  - Un mismo celular no puede mandar más de 5 pedidos por hora.
  - Se rechaza lo que pida más de lo disponible.
  - El cliente recibe el motivo de cualquier rechazo.

## Cosas para tener en cuenta

- **Un solo computador y un solo navegador.** Los datos de Edge no los ve Chrome, ni otro computador, ni el
  celular. Usen siempre el mismo navegador en el mismo computador.
- **No borres los «datos de sitios» ni las «cookies» de Edge.** Si alguien limpia el navegador, se pierden los
  datos: para eso es la copia de seguridad.
- **Varias pestañas o ventanas a la vez sí funcionan.** Por ejemplo, «En vivo 3D» en un televisor como segunda
  pantalla: se actualiza al instante con cada pedido.
- **Sin avisos al celular del equipo.** Los pedidos del QR suenan en el PC donde está Marea abierto.
- **Actualizaciones:** cada mejora que se publique llega sola la próxima vez que se abra Marea. Los datos no se
  tocan.

---

## Cómo está hecho (para el mantenimiento)

- `web/publico/`: las pantallas (las mismas del panel, adaptadas). La entrada es por persona y PIN, y Ajustes
  tiene las copias de seguridad.
- `web/servidor/`: el «servidor» que corre **dentro del navegador**, en un service worker (`sw.ts`):
  - **Base de datos:** PostgreSQL de verdad, compilado a WebAssembly (PGlite), guardado en IndexedDB. Usa las
    mismas migraciones de `prisma/migrations`.
  - **Prisma:** usa un cliente propio para el navegador (`generator web` en `schema.prisma`).
  - **Rutas:** las mismas de `src/modules/*`, con un enrutador compatible con Express (`express.ts`).
  - **Reemplazos del navegador:** sharp → canvas (`imagenes.ts`), argon2 → PIN con PBKDF2 (`cripto.ts`),
    cookies → cabecera `X-Marea-Sesion`, Socket.IO → `BroadcastChannel` entre pestañas.
- **Tienda por QR:**
  - `web/servidor/tienda.ts`, en el service worker, guarda la llave, firma el catálogo, abre los pedidos
    cifrados (NIP-17) y prepara los avisos.
  - `web/publico/js/puente-tienda.js` es el puente: una sola pestaña, con un candado entre pestañas, que habla con
    los retransmisores.
  - `web/publico/js/tienda-red.js` es la tienda del celular.
  - Los retransmisores están en `web/servidor/tienda-comun.ts`.
- `web/construir.mjs`: empaqueta todo con esbuild en `web/dist`. `web/servir.mjs` lo sirve en este computador
  igual que GitHub Pages.
- **Restaurar:** la copia se abre en una base nueva (`idb://marea-<fecha>`). Cuando está lista pasa a ser la
  actual, y la anterior se borra al siguiente arranque. Nunca queda a medio restaurar.

**Comandos:**

```bash
npm run web:tipos            # revisión de tipos
npm run web:pruebas          # pruebas del «servidor» del navegador (en Node, con PGlite)
npm run web:construir        # construye web/dist (base «/»)
npm run web:servir           # http://localhost:4173/
node web/construir.mjs --base /pesquera/ && node web/servir.mjs --base /pesquera/   # igual que en GitHub Pages
```

**Publicación:** cada cambio en `main` que toque `web/`, `src/` o `prisma/` se publica solo en GitHub Pages
(Actions → «Marea en el navegador»). Antes de publicar se revisan los tipos y se corren las pruebas.

**Migraciones:** si se agrega una migración en `prisma/migrations`, cada navegador la aplica sola al abrir Marea.
Debe funcionar sobre datos existentes, igual que en el servidor.
