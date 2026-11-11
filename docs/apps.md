# Apps de Marea: Windows y Android

Las dos apps se conectan al **mismo servidor** de Marea (Railway + Supabase, ver [produccion.md](produccion.md)).
Los datos viven allá, no en el computador ni en el celular:

- Lo que entra en el PC sale **al instante** en el celular, y al revés.
- Si un equipo se daña o se cambia, no se pierde nada: se instala la app en otro y se entra con la misma cuenta.

```
PC con Windows (Marea-Setup.exe) ──┐
                                   ├──▶ Servidor de Marea (Railway) ──▶ Base de datos (Supabase)
Celular Android (Marea.apk) ───────┘         ▲
                                             └── Tienda de los clientes (/tienda)
```

| | Windows | Android |
|---|---|---|
| Qué es | Programa con su propia ventana e ícono | App con su ícono, a pantalla completa (sin barra de direcciones) |
| En vivo | Sí, mientras esté abierto (también escondido en la bandeja) | Sí, mientras esté abierta |
| Pedido nuevo | Sonido, aviso de Windows y el botón de la barra de tareas parpadea | Notificación aunque la app esté cerrada o el celular bloqueado |
| Arranca con el equipo | Sí (se puede apagar) | No hace falta: los avisos llegan igual |

Quién recibe el aviso de «Pedido nuevo #123»:

- **Sí se avisa:** todo el equipo que activó los avisos en su celular o computador, por los pedidos por atender (tienda en línea, llamada, WhatsApp).
- **No se avisa:** a quien registró el pedido, ni por una venta de mostrador que ya quedó entregada.

---

## 1. Antes de construir las apps

1. Marea debe estar publicada en Railway ([produccion.md](produccion.md)) y abrir en `https://<tu-dominio>`.
2. En **Ajustes**, guarda el **nombre** de la pesquera y sube el **logo**. El ícono y el nombre de las apps se toman
   de ahí al construirlas: el logo nunca se guarda en el repositorio.

## 2. Construir y publicar (GitHub)

1. En GitHub: **Actions → «Apps (Windows y Android)» → Run workflow**.
2. **Dirección de tu Marea:** `https://<tu-dominio>`. Para no escribirla cada vez, créala una sola vez en
   **Settings → Secrets and variables → Actions → Variables → New variable**, con el nombre `MAREA_URL`.
3. **Versión:** `1.0.0` la primera vez. Súbela en cada publicación (`1.0.1`, `1.1.0`…): Android solo instala
   encima una versión mayor.
4. En unos 10 minutos quedan en **Releases** (página principal del repositorio, a la derecha):
   - `Marea-Setup-1.0.0.exe`: Windows.
   - `Marea-1.0.0.apk`: Android.

El enlace para compartir con el equipo es `https://github.com/Juan0703music/pesquera/releases/latest`.

También puedes pedírmelo a mí: «publica las apps, versión 1.0.1».

## 3. Instalar en Windows

1. Descarga `Marea-Setup-<versión>.exe` y ábrelo.
2. Si aparece **«Windows protegió su PC»**, toca **Más información → Ejecutar de todas formas**. Pasa porque el
   instalador no tiene una firma comercial (cuesta cientos de dólares al año); el programa es el de este repositorio.
3. Se instala solo (sin pedir permisos de administrador), crea el acceso en el escritorio y abre Marea.
4. Cada persona entra con su correo y contraseña y ve lo de su rol (Administrador, Ventas, Despacho o Bodega).
   La sesión queda guardada.

No se configura nada más: la dirección de la nube viene dentro del instalador. GitHub la pone al construirlo.

Cómo se comporta:

- **Cerrar la ventana (X) no cierra Marea:** queda en la **bandeja del sistema**, junto al reloj, avisando de
  los pedidos. Para cerrarla del todo: clic derecho en el ícono → **Salir de Marea**.
- En el menú del ícono: **Iniciar con Windows** (viene activado).
- Al pasar el mouse por el ícono se ve cuántos pedidos hay abiertos.
- **Sin internet:** muestra «Sin conexión» y vuelve sola al panel cuando la conexión regresa. Los datos siguen a
  salvo en la nube.
- **Atajos:**
  - `F5` recarga.
  - `Ctrl` + rueda del mouse amplía o reduce.
  - `F11` pone pantalla completa (útil para «En vivo 3D» en un televisor).
- **Desinstalar:** Configuración de Windows → Aplicaciones → Marea.

## 4. Instalar en Android

1. En el celular, abre el enlace de **Releases** y descarga `Marea-<versión>.apk`.
2. Ábrelo. Android pide permitir **«Instalar apps desconocidas»** para el navegador o el gestor de archivos:
   actívalo solo para esa instalación.
3. Abre **Marea** y entra con tu cuenta.
4. Toca **«Activar avisos»** (aparece arriba la primera vez) y acepta las notificaciones. Llega uno de prueba.
   Después se puede apagar o volver a encender con la **campana** del menú.

Requisitos y detalles:

- Necesita **Google Chrome** instalado y actualizado: la app usa su motor. Sin Chrome, abre igual, pero con
  barra de direcciones.
- Si los avisos no llegan con el celular bloqueado, quítale la optimización de batería a Chrome. Algunas marcas
  (Xiaomi, Huawei, Samsung) duermen las apps en segundo plano: Ajustes → Batería → Chrome → Sin restricciones.
- **Actualizar:** instala el `.apk` nuevo encima: se conservan la sesión y los avisos.

## 5. ¿Cuándo hay que reinstalar?

Casi nunca. Las pantallas vienen del servidor: cada mejora que se publica en Railway aparece sola en el PC y en
el celular. Solo hace falta instalar una versión nueva de las apps en estos casos:

- Cambió la dirección de la nube (por ejemplo, un dominio propio). Va dentro de cada instalador, así que hay que
  publicar uno nuevo e instalarlo encima.
- Cambió el logo y quieres el ícono nuevo.
- Hubo una mejora en el programa mismo (bandeja, ventana, ícono).

## 6. Otras formas, sin instalar nada

- **Android:** en Chrome, abre `https://<tu-dominio>/app`, menú ⋮ → **Instalar app**. Queda igual de completa,
  con avisos.
- **Windows:** en Edge o Chrome, abre el panel y pulsa el ícono **Instalar** de la barra de direcciones. En este
  caso los avisos llegan como notificaciones del navegador.

---

## Para el mantenimiento

**Llave de firma de Android.** Está en `~/Documentos/Marea-firma-android/` del PC de Juan (llave, contraseña y
huella) y en GitHub como secretos cifrados:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`

**Haz una copia en un USB o en tu nube personal.** Si se pierde, las actualizaciones ya no se pueden instalar
encima: habría que desinstalar y reinstalar en cada celular. Nunca va en el repositorio.

**Verificación del sitio.** El servidor publica en `/.well-known/assetlinks.json` la huella de esa llave
(`apps/android/huella-sha256.txt`). Así Android confirma que la app y el sitio son del mismo dueño: abre sin barra
de direcciones y recibe los avisos.

- Si alguna vez cambia la llave, actualiza ese archivo y la variable `ANDROID_CERT_SHA256`.
- GitHub revisa que la app firmada coincida con esa huella antes de publicarla.

**Avisos (Web Push).** El servidor crea sus llaves de envío la primera vez y las guarda en la base (tabla
`web_push_keys`, incluida en las copias de seguridad). Si prefieres manejarlas tú:

1. Genéralas con `npx web-push generate-vapid-keys`.
2. Ponlas en Railway como `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`.

Si se cambian, cada equipo debe volver a activar los avisos.

**Ensayo de la construcción.** En «Run workflow» marca **Ensayo**. Construye las dos apps sin servidor y sin
publicar, para comprobar que todo compila. Las apps de un ensayo no sirven para instalar: la de Windows solo
muestra «Instalador de prueba».

| Problema | Qué hacer |
|---|---|
| La app de Android abre con barra de direcciones | El servidor no publica la huella correcta: revisa `https://<tu-dominio>/.well-known/assetlinks.json` y que Chrome esté actualizado. Desinstala y vuelve a instalar la app |
| No llegan avisos al celular | Toca la campana del menú (debe verse activa). Revisa que Marea tenga permiso de notificaciones y que Chrome no tenga restricción de batería |
| Windows no muestra avisos | Configuración → Sistema → Notificaciones → Marea activado; y que Marea esté en la bandeja (no «Salir») |
| «Run workflow» falla en «Revisar datos» | La dirección no responde como Marea: revisa que Railway esté arriba y que sea `https://` sin ruta |
