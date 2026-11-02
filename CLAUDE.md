# Tarta Vasca — POS/ERP

Sistema de punto de venta e inventario para una pastelería con 3 sucursales:
**Bosques** (la cocina: produce, transfiere, sale a reparto y también vende),
**Cuajimalpa** y **Polanco** (solo punto de venta, se surten por transferencia
desde Bosques). La lista vive en `SUCURSALES` / `SUCURSAL_COCINA`
(`backend/01_config_roles.js`) y se espeja en `app.js` (`SUCURSALES`, `SUC_COCINA`).
Funciones: ventas, producción, stock, recetas/costos, rutas de
reparto, reportes financieros, usuarios con roles.

## Arquitectura

```
index.html  ──fetch──►  Apps Script web app (backend/)  ──►  Google Sheet (= base de datos)
```

- **Frontend**: vanilla JS, sin build. Cuatro archivos:
  - `index.html` — todo el markup + scripts chicos inline
  - `styles.css` — estilos
  - `app.js` — la lógica principal (api(), ventas, stock, reportes…)
  - `reparto.js` — módulo de reparto a domicilio y apartados
  Servido por **GitHub Pages desde `main`**: ⚠️ **cada push a `main` es un
  deploy inmediato a producción** (https://grinbergalex.github.io/tarta-vasca/).
- **Backend**: `backend/*.js` — Google Apps Script vinculado al Sheet.
  Se sincroniza con `clasp` (login actual: grinbergalex@gmail.com).
  Todos los archivos comparten UN solo namespace global (los límites de
  archivo son solo organización). El prefijo numérico define el orden:
  - `01`–`16`: código vivo, agrupado por dominio (config, InvCore, HTTP,
    auth, ventas, reportes, mantenimiento, **caja (16)**…). El router está en
    `04_http_setup.js` (`despachar()`).
  - `90`–`99`: scripts de una sola vez (setup, migraciones, utilerías
    peligrosas) — nunca llamarlos desde el API. ⚠️ `98_util_limpiar_reservas`
    borra TODAS las reservas físicas.
- **Base de datos**: el Google Sheet. Las pestañas (Ventas, Inventario,
  Usuarios, Sesiones_Activas, Inv_Ledger, …) son **datos de producción**.
  La pestaña Utilidades es un reporte generado — se reconstruye sola.

## Los dos ambientes

|          | Producción (la tienda)                    | Pruebas                                |
|----------|-------------------------------------------|----------------------------------------|
| Frontend | raíz del repo → `/tarta-vasca/`           | `pruebas/` → `/tarta-vasca/pruebas/`   |
| Backend  | la carpeta `backend/` (la que usa `clasp`)| **otro** proyecto de Apps Script, fuera de este repo |
| Hoja     | la de producción                          | TARTA VASCA — PRUEBAS                  |

**`backend/` es siempre producción.** Desde ahí no se puede desplegar a pruebas:
el backend de pruebas es otro proyecto y su código se lleva a mano — por eso
`pruebas/backend-solo-pruebas/` no tiene `.clasp.json`.

## Cómo desplegar

**Frontend — no hay paso extra.** Cualquier push a `main` es deploy inmediato a
producción. Solo hay que subir el `?v=` de los archivos en `index.html` para que las
tablets no se queden con código viejo. ⚠️ **Olvidarlo no es cosmético:** el 5-sep-2026
salió el `index.html` nuevo con el `app.js` viejo en caché y el botón de pago dividido
quedó pintado pero muerto al tocarlo. Si cambia `app.js`, `styles.css` o `index.html`,
sube el `?v=` en el mismo commit.

**Backend — dos pasos.** El segundo se puede hacer a mano en el editor o desde la
terminal; las dos vías hacen exactamente lo mismo.

1. Editar en `backend/` (nunca directo en el editor online: git es la fuente de
   verdad; el editor online solo para correr funciones) y `cd backend && clasp push`.
   Esto **solo sube el código al proyecto: producción no cambia todavía.**
2. En el editor de Apps Script: **Implementar → Administrar implementaciones →
   ✏️ sobre la implementación existente → Versión: "Nueva versión" → Implementar**.
   ⚠️ NUNCA "Nueva implementación": genera otra URL y el frontend (`API_URL`,
   `app.js` línea 2) seguiría hablándole a la vieja.

El paso 2 desde la terminal (es como se publicó la v7.2 en los dos ambientes, sin
abrir el editor):

```bash
clasp -P backend create-version "v7.2 pago dividido"
clasp -P backend update-deployment <deploymentId> --versionNumber <N>
```

El `deploymentId` de producción es el que coincide con el `API_URL` de `app.js`;
sale de `clasp list-deployments`. `update-deployment` reapunta la implementación
**existente**, así que la URL no cambia — es el equivalente exacto de "Nueva versión",
no de "Nueva implementación".

⚠️ El paso 2 publica **todo lo que haya en el proyecto**, no solo lo último que
tocaste, y esto vale igual por terminal que por el editor. Si alguien hizo `clasp push` antes, su código se va en esa misma versión.
Fue exactamente lo que pasó el 4-sep-2026: al publicar el pago dividido se
desplegaron también, sin querer, los arreglos v7.1 que ya estaban subidos.

## Cómo saber qué está desplegado (sin adivinar)

```bash
cd backend && clasp list-deployments
```

La línea cuyo id coincide con la `API_URL` de `app.js` es producción, y el `@N` dice
qué versión está viva. Para leer el código exacto que está corriendo, sin tocar el
repo ni el proyecto:

```bash
REPO=$(pwd)                                   # parado en la raiz del repo
D=$(mktemp -d) && cp backend/.clasp.json "$D"
(cd "$D" && clasp pull --versionNumber N)     # N = el numero que salio arriba
diff -rq "$D" "$REPO/backend" | grep -v clasp.json    # sin lineas = coinciden
rm -rf "$D"
```

Solo lee: no toca el repo ni el proyecto de Apps Script.

## Reglas duras

- **Antes de cualquier `clasp push`, baja la versión viva y compárala con el repo** (receta de
  "Cómo saber qué está desplegado"). Solo publica si lo único distinto es lo que quieres subir. El
  19-oct-2026 producción (v124) traía el calendario del carrito de Shopify
  (`17_tienda_en_linea.js`) subido desde la rama `calendario-tienda`, que no estaba en `main`: un
  push desde `main` lo habría borrado. Todo lo que se publique desde otra rama se junta con `main`
  el mismo día; `main` es la única rama de despliegue.
- **No anular reservas de Shopify desde la pantalla de Movimientos todavía.** `eliminarMovimiento`
  repone stock cuando el canal de la fila no es "Reservado", y esas reservas vienen con
  `tipo_op = Reservado` pero canal Tienda o Domicilio: sumaría piezas que nunca se descontaron.
  Está anotado como tarea; mientras tanto se limpian con scripts como `101` y `102`.
- **No reintroducir `recalcularUtilidades()` en rutas de escritura.** Se movió
  a un trigger cada 10 min (v6.5) porque reconstruía todo el reporte dentro de
  cada venta sosteniendo el lock global — causaba lentitud y errores de
  "Sistema ocupado". Las escrituras solo llaman `_utilMarcarDirty()`.
- Toda acción nueva del API: agregarla al `switch` de `despachar()` en
  `04_http_setup.js` **y**, si es de solo lectura, a la lista `LECTURA` en
  `app.js` (línea 3). Las lecturas van por GET y las escrituras por POST — y un
  POST a Apps Script contesta 302, así que obliga a un segundo viaje: dejar una
  lectura fuera de `LECTURA` le cuesta el doble de latencia.
- **El filtro "Tipo de operación" de los reportes nunca queda vacío.** A diferencia
  de sabores/tamaños/canales (vacío = todos), una lista de `tipos` vacía no dejaba
  pasar ninguna fila y todos los reportes salían en cero: el chip "Venta" viene
  activo y tocarlo lo apagaba (bug 1-ago). El toggle (`_toggleFiltro`) impide
  apagar el último tipo y `_tiposActivos()` cae a `venta` si llegara vacío.
- Toda mutación de inventario pasa por InvCore y queda en `Inv_Ledger`
  (ver encabezado de `02_invcore.js`). `auditarConsistencia()` debe dar verde.
- Los textos de UI y comentarios van en español.
- **Clean Code**: nombres descriptivos sin espacios ni acentos en archivos,
  funciones cortas que hacen una sola cosa, sin código muerto ni copias
  "por si acaso" (para eso está git), sin números mágicos (constantes en
  `01_config_roles.js`), y borrar > comentar código viejo.

## Triggers instalados (una sola vez, desde el editor)

| Función | Frecuencia | Instalador |
|---|---|---|
| `auditoriaDiaria` | diario 7am | `instalarAuditoriaDiaria()` |
| `respaldoDiario` | diario 2am | (ver Código.js) |
| `recalcularUtilidadesSiDirty` | cada 10 min | `instalarTriggerUtilidades()` |
| `cierreAutoCaja` | cada 30 min | `instalarCierreAutoCaja()` |

Los triggers corren como la cuenta que ejecutó el instalador.

## Módulo Control de Caja (v7)

Control de efectivo y auditoría por sucursal. Backend en `16_caja_control.js`;
frontend en `caja.js` + pane `#tab-caja` en `index.html`.

- **Efectivo esperado = saldo corriente CONTINUO** (no se reinicia por día):
  `saldo_base(último OVERRIDE_DUEÑA) + ventas Efectivo (hoja Ventas) + aportaciones
  − retiros`. La apertura/cierre son puntos de **conciliación** (capturan efectivo
  físico, comparan, registran diferencia, mandan correo) pero **no** ajustan el saldo.
- **Libro mayor** `Caja_Ledger` (append-only, clon de `Inv_Ledger`). Otras hojas:
  `Caja_Sesiones` (apertura/cierre), `Retiros`, `Retiros_Evidencias`.
- **Solo la Dueña** (`cajaFijarSaldo`) puede sobrescribir el esperado ("saldo en caja
  al momento") → asienta `OVERRIDE_DUEÑA`, que es la nueva base.
- **Retiros**: máquina de estados `SOLICITADO → ENTREGADO → COMPROBADO → CONCILIADO`
  (+ `RECHAZADO`). Vendedora solicita; Dueña/Admin autorizan (autorizar = liberar
  efectivo, asienta el `RETIRO`). Evidencia = expediente multi-archivo en Drive
  (`TV_Caja_Evidencias`). Conciliar solo Dueña/Admin y exige evidencia. Los retiros
  no conciliados salen en **cada** correo de apertura/cierre.
- **Correos** a `caja_correo_dueña` / `caja_correo_admin` (hoja Configuración).
  Asunto con `⚠️ DIFERENCIA DE CAJA` si no concilia.
- **v7 también amplió el rol `Admin_Ventas`** (Yessenia): ahora produce, ve historial,
  modifica inventario y cancela operaciones (`getPermisos` en `03_recibos.js`).

**Setup del módulo (una vez, desde el editor, tras `clasp push` + nueva versión):**
1. `setupCaja()` — crea las 4 hojas y las llaves de config.
2. Llenar en la hoja `Configuración`: `caja_correo_dueña` y `caja_correo_admin`.
3. `instalarCierreAutoCaja()` — trigger de cierre automático (cada 30 min; cierra
   una sucursal ABIERTA si pasó su horario+margen y no hay actividad).

> El gating "tienda cerrada = no operar" para la Vendedora vive en el frontend
> (`cajaGateInicial` la lleva al flujo de apertura). `registrarVenta` **no** se
> bloquea en backend (para no romper rutas/reservas); endurecerlo es un follow-up.

## v7.1 — Arranque, sesiones y CDN (4-sep-2026)

> Desplegado en producción en la **versión 119** del Apps Script, junto con el pago
> dividido. Nota: varios comentarios de estos cambios dicen "v7.2" (los de los CDN);
> son estos, no el pago dividido de la sección de abajo, que se etiquetó igual.

Arreglos a "a veces no entra / tarda mucho en poder usarlo":

- **`crearSesion` invalida el cache al expulsar.** Al pasar el tope de sesiones se
  borraba la fila pero no se llamaba `_velTokenDrop`, así que el token expulsado
  seguía sirviendo desde `CacheService` y moría horas después, sin patrón. Era la
  causa principal de las sesiones que se caían solas.
- **Sesión por dispositivo.** El frontend manda `device_id` (localStorage) y el
  backend reemplaza la fila de ESE dispositivo en vez de crear otra. Sin esto, un
  usuario compartido entre tablets rotaba expulsiones sin parar.
- `MAX_SESIONES_NORMAL` 3 → 10 y `SESION_INACTIVIDAD_MIN` 60 → 720 min.
- **Borrado de sesiones expiradas en bloque** (`deleteRows` agrupando contiguas) en
  vez de un `deleteRow` por fila: el login tardaba en proporción a la basura acumulada.
- **Acción `bootstrap`**: catálogo + precios + stock + canal-precios + comisiones +
  recetas en UNA sola petición. El arranque hacía 8 o 9 viajes de 1-2 s cada uno.
  El frontend cae solo a la ruta vieja si el backend aún no la tiene desplegada.
- **`_cajaSumaVentasEfectivo` recorre la hoja Ventas una sola vez** (mapa por sucursal,
  memoizado durante la ejecución, invalidado en `_cajaLedger` y al registrar venta).
  Antes eran 2-4 recorridos completos por petición, y `cajaEstado` corre al arrancar
  la app: por eso el arranque se volvía más lento cada mes. A propósito **no** usa
  `CacheService`: el memo vive solo lo que dura la petición, así que no puede quedar
  desfasado de la hoja (que es dinero).
- **`cajaEstado` no calcula el esperado para quien no lo ve** (Vendedora/Mixto): se
  calculaba y se tiraba, y esa llamada es justo la que traba el arranque.
- **Ningún recurso de terceros bloquea la app (v7.2).** Chart.js (205 KB) y Leaflet
  (147 KB) eran `<script>` síncronos en el `head`: la pantalla se quedaba EN BLANCO
  hasta que respondieran los dos CDN. Ahora cargan **al final del body, después de
  `app.js`**, y las dos hojas de estilo de terceros van con `media="print"` +
  `onload="this.media='all'"`. Lo único bloqueante es `styles.css`, que es propio.
  Dos archivos nuevos sostienen el orden:
  - `arranque.js` — llama a `arrancarApp()`. Va después de `caja.js` (porque
    `iniciarApp()` consulta `cajaGateInicial`) y **antes** de los CDN. Antes esto
    colgaba de `DOMContentLoaded`, que espera a *todos* los scripts diferidos: con un
    CDN colgado la sesión guardada no se restauraba nunca.
  - `leaflet_despues.js` — Leaflet publica su objeto en `window.L` y la app tiene su
    propia `L()` (getElementById). Al cargar Leaflet **después** de `app.js` la pisa,
    así que aquí se guarda en `window._LF` y `noConflict()` devuelve `window.L` a la
    app. Si Leaflet no llegó, `_LF` queda sin definir y `reparto.js` lo detecta solo.
    ⚠️ **Este archivo ya no existe** — lo reemplazó `asegurarLeaflet()` en la v7.3.
  Verificado contra un servidor que acepta la conexión y nunca responde: con los tres
  CDN colgados se puede iniciar sesión, vender y ver stock; solo faltan gráficas y mapa.

## v7.3 — Las librerías de terceros solo cuando se usan (16-sep-2026)

La v7.2 logró que un CDN colgado no dejara la pantalla en blanco, pero Chart.js
(200 KB), su plugin de etiquetas (13 KB) y Leaflet (144 KB) **se seguían bajando
siempre**: eran 111 de los 215 KB comprimidos que baja la tablet en cada carga —
la mitad del peso— aunque la vendedora solo abriera la pantalla de venta.

- **`asegurarChart()` y `asegurarLeaflet()`** (`app.js`, junto a `toast`) inyectan
  el `<script>` la primera vez que hace falta. `_libs` guarda la **promesa**, así que
  dos llamadas seguidas comparten una sola descarga; si falla se borra la entrada
  para que el siguiente intento vuelva a probar.
- **Puntos de uso** (son todos): `renderPiesSeccion`, `_renderGraficaLineaPeriodo` y
  `_renderGraficaLineaUtilPeriodo` para Chart; `repShowPin` y `repPaintMap` para
  Leaflet. Las cinco se volvieron `async` y esperan a la librería antes de dibujar.
  Ningún llamador usaba su valor de retorno, por eso el cambio es seguro.
- **`leaflet_despues.js` se borró**: el `noConflict()` que deshace el choque entre la
  `L` de Leaflet y la `L()` de la app vive ahora dentro de `asegurarLeaflet()`.
- **La hoja de estilo de Leaflet se quedó en el `<head>`** (con `media="print"`): son
  2 KB y traerla bajo demanda arriesga que el mapa se pinte un instante sin estilos.
- Si un CDN se cae, el comportamiento es el mismo que en v7.2: la app entera funciona
  y solo esa gráfica o ese mapa avisan que no se pudieron cargar.
- **Timeout en `api()`** (25 s lecturas, 60 s escrituras). Antes no había ninguno: un
  Apps Script atorado dejaba el fetch colgado para siempre, sin error y sin salida.

## v7.4 — Menos consultas de fondo (18-sep-2026)

- **Mensajes y alertas del encabezado cada 10 min, no cada 2** (`MENSAJES_REVISION_MS`).
  Eran dos llamadas por revisión, ~480 al día, compitiendo con las ventas por un backend
  que tarda 1.4-2.7 s por llamada. Abrir la bandeja (`toggleBandeja`) sigue refrescando
  al momento.
- **No se consulta con la app en segundo plano** (`document.hidden`).
- **Los relojes ya no se apilan.** Salir y volver a entrar sin recargar llamaba otra vez a
  `iniciarApp()` y sumaba otro `setInterval`; en una tablet compartida cada cambio de
  usuario multiplicaba las consultas. `programarRevisionMensajes()` limpia el anterior.
- **Pendiente a propósito: el token sigue en la URL de las lecturas.** Sacarlo obliga a
  mandar las lecturas por POST, y un POST a Apps Script cuesta un segundo viaje (302):
  cada lectura se volvería más lenta. Hacerlo solo junto con un cambio de backend pensado.

## v7.2 — Pago dividido (5-sep-2026)

Un mismo ticket cobrado con varios métodos (p. ej. $300 en efectivo y $200 con tarjeta).

- **Dónde vive el desglose.** La hoja Ventas tiene UNA fila por producto y un solo
  `metodo_pago` por fila, así que el desglose no cabe ahí: va como JSON en la columna
  **`pagos`**, escrita **solo en la primera fila del ticket**, con la forma
  `{ total, envio, pagos:[{metodo,monto}] }`. `metodo_pago` queda en `"Mixto"`.
  La columna **se crea sola** en la primera venta dividida (`_ensureColVentas`): no hay
  migración que correr. Escribirla en una sola fila es lo que deja sumar por ticket sin
  contar dos veces; todo lo que lee el desglose asume eso.
- **Reglas.** Solo en ventas normales: el regalo no cobra, la reserva paga al entregar y
  en Rappi/Uber Eats cobra la plataforma. La suma tiene que cuadrar con el total (productos
  + envío) dentro de `PAGO_TOLERANCIA`; se valida **antes** de tocar stock, porque validarlo
  después obligaría a deshacer el descuento. Un solo método en el desglose **no** es pago
  dividido: se guarda como venta normal, sin JSON.
- **Caja.** `_cajaMapaVentasEfectivo` junta las filas del ticket mixto y suma la parte en
  efectivo **topada contra lo que sigue vivo del ticket**, para que anular (entera o en parte)
  saque el efectivo igual que en una venta normal, y para dejar fuera el envío cobrado en
  efectivo — que este cálculo nunca ha contado.
- **Comisiones.** Con pago dividido la comisión es el promedio ponderado por monto
  (`getComision` en `app.js`, `comisionPct` en `14_reparto_pedido_sugerido.js`): cobrar la
  mitad con tarjeta no cuesta lo mismo que cobrarlo todo con tarjeta.
- **Conciliación.** El monto del ticket se reparte entre los métodos en proporción a lo
  cobrado con cada uno, así que el total de la conciliación sigue siendo el total vendido.
  Las piezas no se parten: se cargan al método que pagó más.
- **Frontend.** La sección **Pago** (`#pago-section`) va **debajo del carrito**, no arriba:
  se cobra cuando ya se sabe cuánto es. Arriba queda solo el canal, que sí tiene que ir antes
  porque cambia los precios de lo que se agrega. Dos opciones a la vista, "Un solo método" y
  "Dividir el pago" (`setModoPago`), para que se vea que existen las dos sin tener que probar.
  Con el pago dividido se esconde el select de método y se manda `pagos` en vez de `metodoPago`;
  el aviso dice cuánto falta o cuánto sobra y "Resto" completa la diferencia.
- **`renderPagoDividido()` es la única que decide qué se ve en esa sección.** Antes
  `onCanalChange` y `actualizarMetodoPago` también escribían sobre el select del método, así
  que cualquier refresco (agregar al carrito, recargar catálogo) podía dejar el control a
  medias. Si algo más vuelve a tocar esos `style.display`, vuelve el mismo bug.
- Se probó primero en `/pruebas/` (ver `pruebas/LEEME.md`) antes de subirlo.

## v8 — Cocina Bosques (oct-2026)

La cocina pasó de Cuajimalpa a Bosques; Cuajimalpa quedó como punto de venta.

- `altaProduccion` solo acepta `SUCURSAL_COCINA`. Rutas, reservas de ruta y ventas de ruta
  usan la cocina; `REP_DEPOT` (14) lleva las coordenadas **aproximadas de Bosques: confirmar**.
  Los horarios de atención (`HORARIOS_SUCURSAL`, 01) ya son los reales (oct-2026) y son la
  única fuente: `RECOGER_HORARIOS` (recolección en la tienda en línea) los lee de ahí.
- `registrarTransferencia` recibe `origen` y `destino` (por defecto cocina → punto de venta). Se
  guardan en columnas `origen`/`destino` de la hoja Transferencias (se crean solas); las filas
  anteriores a v8 se leen como Cuajimalpa → Polanco (`_origenDestinoTransferencia`).
- `getCatalogo` agrega solo la fila `Sucursal / Bosques` al Catálogo si falta.
- Gastos "Ambas" se reparten entre las 3 sucursales (antes ÷2).
- El stock de Cuajimalpa **no se movió**: Bosques arranca en cero. Pasos del día del cambio
  en `backend/100_migracion_cocina_bosques.js`. Cerrar rutas abiertas antes de desplegar.
- Direcciones de recibo: llave `negocio_direccion_bosques` en Configuración.
- Scripts de una sola vez de la puesta en marcha: `100_migracion_cocina_bosques.js` (diagnóstico y
  reasignación de cocineros), `101_limpiar_apartados_fantasma_polanco.js` y
  `102_anular_reserva_vencida_cuajimalpa.js` (ya corridos el 19-oct; abortan solos si se repiten).
- Pendientes: el sincronizador de Shopify (`shopify-sync`) sigue mandando los envíos a domicilio como
  reservas en Cuajimalpa (`SUCURSAL_ENVIOS`); cambiarlo a Bosques exige un usuario del POS para Bosques.

## v9 — Bot de Instagram y pedidos con seguimiento (oct-2026, rama `feat/bot-instagram-cerebro`)

✅ **Publicado el 1-nov-2026 en la versión 130** (backend) y en `main` (POS, `app.js?v=20261101`, `reparto.js?v=20261101b`), en modo
**piloto**. Respaldo previo de la hoja: "RESPALDO Tarta Vasca — Sistema 1-nov-2026 antes de publicar Maite". Reversa: `update-deployment`
a la versión 129 (o 128). Hecho en producción: Configuración con los flujos de ManyChat (`aviso_hoy_manychat` = solo Alex en el piloto),
`Bot_Manual` copiado de pruebas, pestañas del tablero creadas y triggers instalados (tablero cada 5 min, menú de Estado, mensajes a
clientes, recordatorios de pendientes, reporte de las 18:00). **Falta**: claves en Propiedades (las pone Alex: `BOT_TOKEN`,
`MANYCHAT_API_TOKEN`, revisar `ANTHROPIC_API_KEY`), cambiar en ManyChat la URL y el token del flujo del bot y del botón Atendida a los de
producción, `excel_pedidos_id` (vacío a propósito en el piloto), el cierre de las 21:00 (`instalarRevisionDiariaPedidos`, se instala
después de limpiar los 12 pedidos de Shopify abiertos), proteger las hojas de datos y la prueba real mínima (plan, sección I).

- **Bot**: `18_bot_conversacion.js` (cerebro con IA y herramientas), `18_bot_chat.html` (chat de pruebas) y
  `103_setup_bot_manual.js` (una vez: pestaña `Bot_Manual`, la guía de marca que edita el equipo). Acciones
  públicas protegidas con `BOT_TOKEN`: `botConversar` y `botRespuesta` (ManyChat se rinde a ~8 s: la primera llamada
  se corta pero el servidor termina, y `botRespuesta` espera hasta `BOT_SONDEO_MAX_SEGUNDOS` y devuelve la misma
  respuesta las veces que se pida). La API key de Anthropic va en Propiedades del script, nunca en el código.
- **Interruptor `BOT_PEDIDOS_ACTIVOS`** (01): apagado, el bot solo consulta y manda a los canales de pedido.
- **Un pedido es una reserva de la hoja Ventas** (`tipo_op = Reservado`) venga de donde venga (bot, Shopify,
  teléfono, mostrador); `registrarVenta` ya aparta el inventario (`res_apartado`). `19_pedidos_seguimiento.js` agrega
  columnas que se crean solas (`referencia` TV-MMDD-NN, `estado_pedido`, `contacto_seguimiento`, `origen_pedido`) y las
  acciones `pedidoConfirmar`, `pedidoEntregar` (= `convertirReservaAVenta`) y `pedidoNoRecogido`.
- ⚠️ **`pedidoNoRecogido` NO usa `eliminarMovimiento`**: esa función repone stock si el canal de la fila no es
  "Reservado", y estas reservas traen canal Tienda o Domicilio (suma piezas que nunca se descontaron). Libera con
  `invLiberar` y marca `ANULADO` directo. Quedan en la hoja `Pedidos_No_Recogidos` (lista de la campaña).
- **Regla de no recogido** (reemplazada el 28-oct: ya nada se cancela solo): el día de la entrega, al CERRAR la sucursal, lo que debió
  recogerse y no llegó pasa a **POR REVISAR** y SIGUE APARTADO (`pedido_gracia_dias` suma días de espera). Lo corre `pedidosRevisionDiaria`
  (21:00; instalar una vez con `instalarRevisionDiariaPedidos()`), que ahora es el **cierre del día** de `24_seguimiento_clientes.js`. Solo
  recolección en sucursal. La persona autorizada lo resuelve desde la hoja: ENTREGADO (si sí llegó) o NO RECOGIDO (libera las tartas).
- **Velocidad del pedido** (ManyChat solo espera ~8 s + un sondeo de 7 s): la hoja Ventas ya pasa de 11 mil filas, así que
  `pedidoAnotar` busca solo en las últimas `PEDIDO_VENTANA_FILAS`, escribe en bloque y saca el consecutivo de una
  propiedad del script; `crear_pedido` reutiliza la fecha validada en la conversación (`_botCalcularFechaMemo`); y con
  `crear_pedido` exitoso el mensaje de confirmación lo arma el sistema (`_botMensajeConfirmacion`) sin otra llamada a la
  IA. El turno que confirma bajó de 18-35 s a ~9 s. `registrarVenta` (3 s) no se tocó.
- **Claves de Configuración** (las llena el equipo; vacías, el bot no inventa nada): `pedido_datos_transferencia`,
  `pedido_politica_no_recoger`, `pedido_gracia_dias`, `bot_correo_avisos`.
- **Avisos por WhatsApp** (`20_whatsapp_avisos.js`): API oficial de Meta con una plantilla aprobada de dos variables
  (`aviso_equipo_tarta_vasca`). Sin claves no hace nada. Las claves van en Propiedades del script (`WHATSAPP_TOKEN`,
  `WHATSAPP_PHONE_ID`), nunca en el código; los destinatarios en Configuración (`aviso_whatsapp_numeros`). Un aviso que
  falla nunca tira el pedido: `_botAvisar` lo atrapa. Solo probado con la API simulada: falta el alta en Meta.
- **Quién gestiona un pedido** (`_pedidoPuedeGestionar`): todos lo ven; lo confirma el punto de venta de ESA sucursal
  (para recoger) o quien hace las rutas, rol Chofer (a domicilio). Dueña y Administradora pueden con todo. Entregar y
  "no llegó" no los hace el Chofer hoy.
- **Recordatorio** (⚠️ NO instalar: desde el 1-nov nadie confirma pedidos a mano; lo reemplaza el reporte de las 18:00)
  `pedidosRecordatorioSinConfirmar` (`instalarRecordatorioPedidos()`, cada `pedido_recordatorio_horas`,
  por defecto 2, de 9 a 20 h): lista lo que llegó hoy y nadie confirmó, a todo el equipo y, por WhatsApp, a los números
  de `aviso_whatsapp_resumen` (la Dueña).
- **SIGUIENTE ETAPA (pedido de Alex, 27-oct-2026): mandar el recibo al cliente cuando el chofer marque el pedido como
  entregado.** Para eso el Chofer tiene que poder anotar "entregado" (hoy `pedidoEntregar` exige `puedeVender`, que el
  Chofer no tiene, y `_pedidoPuedeGestionar` lo excluye con `permitirChofer = false`), y al entregar el sistema debe generar
  el recibo (ya existe en `03_recibos.js`) y enviarlo al cliente por su canal de seguimiento (WhatsApp con plantilla
  aprobada, o Instagram dentro de la ventana de 24 h).
- **DECISIÓN DE REBECA (27-oct-2026): no Telegram ni nada más.** La línea +52 55 8803 9327 es de clientes **y** la interna.
  Los pedidos caen a un **tablero** (pestaña `Tablero_Pedidos`, `21_tablero_pedidos.js`) donde entran todos: bot, Shopify,
  teléfono, mostrador y otras fuentes. Es una vista de solo lectura que se reconstruye de la hoja Ventas cada 5 min
  (`instalarTableroPedidos()`) y al instante al confirmar, entregar o marcar "no llegó". Los pedidos sin referencia
  (Shopify, teléfono) la reciben ahí; los de Shopify entran como POR CONFIRMAR. Pendiente: importar las "otras fuentes"
  que se peguen a mano (hoja de entrada → reservas en Ventas).
- **Avisos al WhatsApp personal de Rebeca y Yessenia, desde la línea de clientes**: requiere conectar la línea con
  **convivencia** (app Business + API). Meta solo la permite vía un Solution/Tech Provider; ManyChat la ofrece en BETA y
  falta confirmar México y su artículo de ayuda. Los avisos saldrían por la API de ManyChat o por Meta una vez conectada.
  Los grupos por API de WhatsApp NO sirven (exigen Cuenta Oficial de Negocio, máximo 8 y no con números de la app).
- **Pendiente**: la pantalla de Apartados y la producción de mañana (`getApartados`, `getProduccionManana`) solo ven
  canal "Apartado", así que no muestran los pedidos del bot ni de Shopify; botones en el POS para confirmar, entregar y
  marcar no recogido; aviso por WhatsApp al +52 55 8803 9327; datos de la transferencia; regla de no recogido; envíos por
  círculos de distancia (propuesta en `propuesta-radios-envio.pdf`).

### Cómo opera la tienda hoy y cómo lo refleja el sistema (decisiones de Alex, 28-oct-2026)

- **Pedido de hoy para hoy**: hoy Yessenia (administradora) lo cacha porque ella atiende Instagram y WhatsApp, y llama a la
  sucursal para avisar. El sistema lo replica: al registrarse un apartado con fecha de entrega = hoy, avisa **al instante por
  WhatsApp a Yessenia y a Rebeca** (`aviso_whatsapp_numeros`), con cliente, pedido, sucursal y hora a la que pasa, y ellas
  avisan a la tienda. El pedido queda APARTADO y se cierra al marcarlo ENTREGADO: esa es la validación de que se vendió.
  **Implementado en pruebas (28-oct)**: `pedidoAvisarSiEsDeHoy` (19), llamado desde `_botCrearPedido`. Sale **por ManyChat**
  (`22_manychat_avisos.js`), no por la API directa de Meta: la línea quedó conectada con convivencia a través de ManyChat
  (cuenta fb5801453, WABA 461630757038215, portafolio "La tarta vasca", 28-oct) y ManyChat no deja mandar plantillas por la API:
  se llenan dos campos del contacto (`aviso_referencia`, `aviso_detalle`) y se manda un flujo cuyo único paso es la plantilla
  **`aviso_pedido_hoy`** (Utility, es_MX, enviada a revisión de Meta el 28-oct). Clave de la API en Propiedades del script
  (`MANYCHAT_API_TOKEN`); en Configuración: `aviso_hoy_manychat` = `Yessenia:<id>,Rebeca:<id>` (id del contacto en ManyChat, de su
  URL en Contactos; solo existen si escribieron alguna vez a la línea) y `manychat_flujo_aviso` = ns del flujo. Cada aviso queda
  en `Avisos_Pedidos_Hoy` (resultado "NO SE MANDÓ: falta …" mientras falte algo). El aviso genérico de pedido nuevo ya no sale
  por WhatsApp (`sinWhatsapp`). Falta: aprobar la plantilla, crear el flujo en ManyChat, y que lo usen también los pedidos de
  Shopify/teléfono para hoy (hoy solo el bot). La API de ManyChat no encuentra contactos de WhatsApp por teléfono ni por nombre:
  por eso se guardan sus ids.
- **Hora de recoger (28-oct)**: el bot la pide siempre para recoger (`_botValidarHoraRecoger`: HH:MM, dentro del horario de la
  sucursal ese día y, si es hoy, al menos `BOT_MARGEN_HORA_RECOGER_MIN` después de ahora). A domicilio no se pide hora. Hoy se
  guarda en el motivo de la fila de Ventas ("Hora: HH:MM") y sale en la confirmación al cliente; falta una columna propia
  en Ventas/Tablero cuando se construya el libro de pedidos.
- **Fecha mínima para recoger (31-oct)**: mañana solo se acepta lo que ya está listo en la sucursal; lo que no está listo, para mañana, solo si el pedido cae antes de `BOT_HORA_CORTE_RECOGER` (18:00, igual que domicilio; empezó en 16:00 y Alex la subió el 31-oct; se ajusta ahí); después, pasado mañana. A domicilio rige `BOT_HORA_CORTE_DOMICILIO` (también 18:00). `RECOGER_HORA_CORTE` (17:00) es del calendario de la tienda en línea y no se toca. ⚠️ En el proyecto de pruebas había un parche viejo que hacía que `tiendaDisponibilidad` leyera el inventario REAL de producción; ya se quitó (el bot de pruebas debe usar el inventario de pruebas).
- **Alertas del bot al WhatsApp de Rebeca y Yessenia y pausa (31-oct)** (`25_alertas_bot.js`): quejas, Uber/DiDi/taxi/mensajero, peticiones complejas (evento, restaurante, más de 12 piezas, algo que el bot no sabe), factura, cambio o cancelación y "quiero hablar con una persona". Salen por ManyChat (mismos destinatarios `aviso_hoy_manychat`) con el flujo `manychat_flujo_alerta` (campos `aviso_referencia` = título y `aviso_detalle` = detalle; plantilla de WhatsApp pendiente de crear). Cada alerta queda en la hoja `Alertas_Bot` (también "NO SE MANDÓ: falta …"). La misma alerta de la misma conversación no se repite en 10 min. Los elogios (`observacion`) no mandan WhatsApp. `pasar_a_persona` además **pausa** la conversación `BOT_PAUSA_HORAS` (12): el bot calla y solo avisa una vez "ya le avisé al equipo" (respuesta vacía el resto del tiempo). En ManyChat, el flujo `Bot Tarta Vasca - PRUEBA` ya trae (1-nov) una **Condición** entre las solicitudes y el mensaje: si `bot_respuesta` no tiene valor no manda nada y el flujo termina; falta probarlo con una conversación real de Instagram. Si el cliente vuelve a escribir y ya pasaron `BOT_DISCULPA_MINUTOS` (5) desde el traspaso, Maite se disculpa por la espera y se manda un recordatorio urgente (`cliente_esperando`) a Rebeca y Yessenia (una vez por cada 5 minutos que siga escribiendo). **Conversaciones pendientes (1-nov)**: cada traspaso abre un renglón PENDIENTE en `Conversaciones_Pendientes` y el trigger `botRecordatoriosPendientes` (cada 5 min, `instalarRecordatoriosPendientes()`) manda un recordatorio urgente a Rebeca y Yessenia cada `BOT_RECORDATORIO_MINUTOS` hasta que alguien cambie el Estado a ATENDIDA (menú desplegable); tope `BOT_RECORDATORIOS_MAX` (12; luego avisa que nadie atendió y queda SIN ATENDER) y solo mientras alguna sucursal esté abierta (`HORARIOS_SUCURSAL`; con la tienda cerrada se retoma al abrir). **Texto sugerido aparte (1-nov)**: el texto para pegarle al cliente ya no va dentro de la alerta sino como **segundo mensaje de WhatsApp, solo con el texto** (flujo `Texto sugerido (sistema)`, campo `bot_sugerencia`, clave `manychat_flujo_sugerencia`), para copiarlo de un toque; los recordatorios no lo repiten. El texto no lleva huecos ("te escribe el equipo de La Tarta Vasca"). **Botón Atendida (1-nov)**: la alerta de WhatsApp (flujo `Alerta bot (sistema)`) trae el texto sugerido para decirle al cliente (`BOT_SUGERENCIAS_CLIENTE`) y un botón **Atendida** que llama a la acción pública `botAtendida` (protegida con `BOT_TOKEN`) con el campo de ManyChat `bot_conversacion`; la acción marca el renglón ATENDIDA y paran los recordatorios (también a la otra persona). ⚠️ El botón lleva la URL y el BOT_TOKEN **de pruebas** dentro de la solicitud externa del flujo: al publicar hay que cambiarlos por los reales. **ManyChat pausa solo** las automatizaciones de un contacto mientras un agente conversa desde su Bandeja (Configuración → Comportamiento de Inbox → "Pausar las automatizaciones durante las conversaciones"; puesto en **1 hora** el 1-nov): si la persona responde desde la Bandeja de ManyChat, el flujo ni siquiera llama a Maite. `BOT_REENGANCHE_HORAS` = 1.5. El sistema NO ve lo que contesta la persona desde Instagram o WhatsApp: la marca ATENDIDA es la única señal de que ya llegó alguien. Con la conversación ATENDIDA Maite calla mientras el cliente siga conversando; si el cliente calla más de `BOT_REENGANCHE_HORAS` (4) y vuelve a escribir, Maite se reincorpora (`botRespuestaPausada` devuelve null). Si nadie la marca ATENDIDA, la pausa sigue hasta `BOT_PAUSA_HORAS`. `botReanudarConversacion("id")` la reanuda a mano. Flujo `Alerta bot (sistema)` creado en ManyChat el 1-nov y probado de verdad: la alerta de una queja llegó a Alex (en Configuración de pruebas `manychat_flujo_alerta`). El correo y la bandeja del POS siguen igual; el WhatsApp directo de Meta quedó apagado para estos avisos (`sinWhatsapp`).
- **Maite en comentarios de fotos y stories (decisión de Alex, 1-nov; SOLO cuando se esté en vivo, no en pruebas)**: que siga la conversación **en la foto** (público) y que toda la información de La Tarta Vasca (precios, disponibilidad, sabores, horarios) se dé ahí aunque sea pública; al llegar el momento de **compartir datos personales (dirección, teléfono)** le pide al cliente pasarse al mensaje directo y ahí sigue el pedido. Pendiente de construir: hoy el flujo solo se activa con mensajes directos. Hay que comprobar en ManyChat qué permite el disparador "Comentarios de publicaciones" (respuesta pública, si cada comentario nuevo en el hilo vuelve a disparar, límite de un mensaje privado por comentario) y que el bot detecte y nunca pida ni acepte datos personales en público. Las respuestas a stories llegan como mensaje directo (son privadas por naturaleza), así que ahí no aplica lo "público".
- **Más motivos de alerta (decisiones de Alex, 1-nov)**: alianza o colaboración, pedidos recurrentes o cadena de restaurantes (`pedidos_recurrentes_o_cadena`), amenaza, extorsión, robo o tema legal (`amenaza_o_legal`, urgente: Maite responde neutra, sin admitir culpa), recados dirigidos al equipo (`recado_para_equipo`, no pausa) y quien se dice famoso o con muchos seguidores (se trata como cualquier cliente; si pide cortesías es colaboración). Un perfil verificado o con más de 50,000 seguidores **no se puede detectar**: ManyChat no expone esos datos para Instagram (solo ventana de mensajería, última interacción, última vez visto y optado por ingreso); haría falta la API de perfil de Instagram con permisos de Meta. La charla fuera de tema se contesta en una línea y se regresa a las tartas.
- **Consistencia de fechas (1-nov)**: `calcular_fecha_entrega` reutiliza la fecha ya validada en la conversación (`_botCalcularFechaMemo(..., true)`), y si Maite no repite los productos al volver a consultarla se usan los últimos (`_botItemsOMemoria`): sin productos el sistema cree que no hay piezas listas y niega fechas posibles. Se vio una vez que "mañana" se aceptó y se negó al confirmar; no se repitió. `Bot_Log` guarda ahora cómo se consultó cada fecha (entrega, sucursal, fecha, productos, resultado) para diagnosticarlo.
- **Nadie le contesta el pedido al cliente (decisión de Alex, 1-nov)**: Maite lo cierra con la llave, el día, la hora y el pago; el
  mensaje final ya no dice "el equipo te confirma". El estado POR CONFIRMAR / CONFIRMADO queda como marca interna de la sucursal.
- **Reporte de las 18:00, entregas de mañana (1-nov)** (`26_entregas_manana.js`, `pedidosEntregasManana`, instalar una vez con
  `instalarEntregasManana()`): a Rebeca y Yessenia por WhatsApp (ManyChat; destinatarios `aviso_hoy_manychat`) un mensaje con una sección
  por punto de venta (Polanco, Cuajimalpa, Bosques) y una de Domicilio: cuántos pedidos y tartas, ✅ todo hay / ⚠️ falta (hornear y
  transferir; en Bosques "por hornear", que incluye domicilio) y un renglón por pedido (hora, cliente, piezas, total, pago, llave). Entran
  todos los orígenes de Ventas (bot, Shopify, POS) y, en Domicilio, también los capturados a mano en Reparto. Falta = piezas de mañana −
  (inventario de la tienda − lo que aún se entrega hoy). No cuenta ventas de mostrador de mañana ni pedidos que lleguen después de las 18:00.
  Cada sección va en su propio campo de ManyChat (`entregas_polanco`, `entregas_cuajimalpa`, `entregas_bosques`, `entregas_domicilio`, más
  `aviso_referencia` con la fecha) dentro del flujo `Entregas manana (sistema)` (clave `manychat_flujo_entregas_manana`, ns
  `content20261101202729_499516`, texto normal dentro de 24 h, con saltos de línea). Cuando el flujo use plantilla de WhatsApp (sus variables
  no aceptan saltos de línea), poner `manychat_entregas_una_linea` = si. Huella completa en `Reportes_Entregas`. Probado en pruebas @100 con
  `probarEntregasManana()` (solo pruebas): detectó la falta de Frutos Rojos Grande en Polanco y llegó a Alex.
- ⚠️ **Los pedidos a domicilio del bot y de Shopify NO entran a Reparto** (solo a Ventas y al Tablero): quien arma la ruta no los ve ahí.
  Decisión de Alex (1-nov): las rutas se planean A MANO, no con la pantalla de Reparto (que además está apagada, ver abajo). Los
  domicilios de Maite deben caer al **Excel de pedidos** ("Pedidos Tarta Vasca (Respuestas)", hoja "Respuestas de formulario 1", de
  latartavasca@gmail.com: marca temporal, nombre, fecha de entrega, dirección, teléfono y una columna por sabor y tamaño) en su fecha,
  como si los hubiera capturado una persona, y salir en el reporte de las 18:00 (sección Domicilio: "Confirmen que estén en la ruta de
  mañana"). **Construido (1-nov, `27_excel_pedidos.js`, `pedidosDomicilioAlExcel`)**: en cada revisión del tablero (cada 5 min, no en
  el turno de Maite) cada domicilio abierto de Maite (origen Instagram/WhatsApp) con llave se agrega al final de esa hoja como lo haría
  una persona: marca de hora, nombre, fecha de entrega (Date), dirección, teléfono y la cantidad en la columna de su sabor y tamaño
  (se emparejan por nombre sin acentos ni "Tarta de"; "Taro" → "Taro velvet" si es la única que empieza igual). Lo que no tiene columna
  en el formulario va en la dirección entre corchetes. En la columna 58 (vacía) va "Maite · TV-… · pago · total". No se repite: hoja
  `Excel_Pedidos_Anotados` del Sistema. Clave de Configuración `excel_pedidos_id` (vacía = no hace nada; en producción el id del Excel
  real `1_TM6QEAMk0P7oWuSCiSFasqFKnufE3xGYkQEl2d9dK4`). El reporte de las 18:00 agrega en Domicilio "🆕 Entraron hoy para otros días
  (ya en el Excel)". Probado en pruebas @108 con un Excel de prueba que solo copia los encabezados del real (TV-1101-05 cayó en Lotus
  MEDIANA y Pistache GRANDE, fecha 04/11).
- 🔴 **BUG EN PRODUCCIÓN (encontrado el 1-nov): el módulo de Reparto del backend está desactivado desde el 16-jul-2026** (commit
  24e6ff5, al dividir el backend en archivos). En `14_reparto_pedido_sugerido.js` el comentario que abre "MÓDULO REPARTO A DOMICILIO"
  termina en `===== /` en vez de `*/`, así que todo hasta el siguiente `*/` (≈ líneas 365-688: `repartoSetup`, `repartoEstado`,
  `repartoAddPedido`, `repartoPlanear`, `repartoCerrarRuta`, `_repLeerPedidos`…) es comentario. Las acciones del API que los llaman
  fallan con ReferenceError y `getProduccionManana` deja fuera, en silencio, los pedidos de Reparto. Está igual en `main` y en la v128.
  Arreglarlo reactiva el módulo en producción: probarlo antes en pruebas y confirmar con Rebeca si hoy usan la pantalla de Reparto.
- **Entregar desde el POS (decisión de Alex, 1-nov, opción A)**: la venta de un pedido se registra en el POS, así que la pantalla de
  **Apartados** (`getApartados`, `reparto.js` `apReload`) ahora muestra también los pedidos de Maite y de Shopify (canal Tienda o
  Domicilio) con llave, hora, origen y forma de pago, y botones **"✓ Entregado"** (`pedidoEntregar`: apartado → venta UNA vez, con la
  forma de pago que el cliente dio a Maite, `_pedidoMetodoDeNotas`) y **"✗ No llegó"** (`pedidoNoRecogido`). A esos pedidos NO se
  les muestra "Liberar" (usa `eliminarMovimiento` y repondría tartas). Los domicilios los puede entregar el punto de venta de Bosques
  (antes solo Dueña/Administradora). Control de cerrados: al entregar, no llegó o quedar POR REVISAR se marca la columna 59 del Excel
  de pedidos ("✅ ENTREGADO dd/MM HH:mm", `excelPedidoMarcarEstado`) y el reporte de la noche trae "✅ Entregados hoy (N): …".
  Probado en pruebas @110 (TV-1101-03 y TV-1101-05 entregados una sola vez, TV-1101-01 y -04 no llegó, auditoría en verde). La
  pantalla del POS solo se probó con datos de ejemplo (no hay POS de pruebas): ⚠️ al publicar, el `reparto.js` nuevo va en `main` y
  necesita el backend nuevo el MISMO momento (si no, "Entregado" falla).
- **Venta de Ruta (decisión de Alex, 1-nov)**: Yessenia captura la venta de ruta en el POS al entregar (canal "Ruta") y, si no se
  entregó, la cancela. Para que un domicilio de Maite o de Shopify no se venda dos veces, al elegir el canal **Ruta** en la venta sale
  arriba la caja "🚚 Pedidos a domicilio ya apartados" (`rutaPedidosPendientes`, `reparto.js`; vencidos u hoy) con "✓ Entregado"
  (`pedidoEntregar` con `canal: "Ruta"`: el apartado se vuelve UNA venta de canal Ruta) y "✗ No llegó". Probado en pruebas (TV-1101-07:
  una sola fila Ruta / Transferencia / Venta, la segunda vez "ya se entregó", auditoría en verde); la caja, solo con datos de ejemplo.
  Los de Shopify se descuentan de Cuajimalpa (ahí los aparta el sincronizador), aunque la tarta salga de Bosques.
- **Shopify: los 12 pedidos abiertos (#1052-#1063) son reales** (pagados en línea, $9,450, Shopify los marca entregados). No se sabe si
  la venta también se capturó en el POS: se le preguntó a Yessenia (1-nov). Si sí → solo liberar el apartado; si no → convertirlos en
  venta (método Shopify) para que se descuenten una vez. Contacto de pruebas "Sara" (TV-1029-01) cerrado en pruebas el 1-nov.
- **Triggers con fecha simulada**: un trigger instalable pasa un EVENTO como primer argumento; la función que recibe `ahora` para
  pruebas debe usar `ahora instanceof Date ? ahora : new Date()` (así fallaba `botRecordatoriosPendientes`, ya corregido).
- **Punto 6: cómo afectan los pedidos al resto del sistema (1-nov, probado en pruebas)**:
  - 🔴 **Anular o liberar una reserva ya no inventa piezas** (`eliminarMovimiento`, 06): antes decidía por el canal ("Reservado") y los
    apartados del POS (canal "Apartado") y los pedidos (Tienda/Domicilio) **reponían** stock que nunca se descontó, y además dejaban
    `res_apartado` sin liberar. Ahora decide por `tipo_op`: una reserva se libera y no se repone. ⚠️ El bug de los apartados normales
    estaba en producción ("Liberar" en Apartados) y es la causa probable de los apartados fantasma. ✅ **Publicado solo ese arreglo el
    1-nov en la versión 129** (commit 1ee31d7 en `main`; 06 y 13); lo demás de esta rama sigue sin publicar. `liberarReserva` ya no libera
    dos veces y rechaza los pedidos con llave ("márcalo como No llegó").
  - **Reportes**: una reserva sin entregar ya no cuenta como venta: `_tipoOpVenta` (app.js) la clasifica "reserva" (chip "📦 Apartado sin
    entregar", apagado por defecto) en diario, periodo, conciliación y utilidades; Utilidades (10), Seguimiento de ventas y Análisis
    de demanda (12, `_ventaVendidaDeVerdad`) se saltan reservas y anuladas.
  - **Al entregar un pedido** (`pedidoEntregar`): la venta cae el **día que se entrega** (columna B; la fecha del pedido queda en notas
    como "Pedido hecho …" y el tablero la lee de ahí, `_tableroLlego`); todo domicilio queda canal **Ruta** (misma meta se entregue
    desde Ruta o desde Apartados); la forma de pago desconocida queda **"Por definir"**, nunca Efectivo (inflaba la caja y mandaba
    correos de diferencia). Shopify conserva "Shopify".
  - Decidido (Alex, 1-nov): el efectivo que cobra el chofer en un domicilio entra a la caja de Bosques (así funciona hoy). La comisión
    de "Shopify" ya está en la hoja Comisiones (−3%). Pendiente: revisar las fórmulas de "Espejo para Shopify" y "Resumen ventas por sabor
    y canal" (no están en el código: si suman Ventas sin filtrar `tipo_op`, cuentan pedidos abiertos); y que la auditoría diaria
    compare `res_apartado` contra las reservas abiertas de Ventas (hoy no lo detecta).
- **Diseño de los WhatsApp al equipo (1-nov)**: el reporte de la noche va por secciones como el de las 18:00 (✅ entregados, ⏳ siguen
  apartadas por 📍 tienda y 🚚 Domicilio, un renglón por pedido con 🔑 llave); las alertas, un dato por renglón (`botDetalleAlerta`);
  el pedido para hoy, el ticket que eligió Alex (`pedidoTicketHoy`). ⚠️ El diseño (saltos de línea) solo llega como **texto normal**,
  y WhatsApp solo entrega texto normal si la persona escribió a la línea en las últimas 24 h. ManyChat **no expone** esa ventana para
  WhatsApp (ni por API: `last_interaction` viene vacío; ni como condición de flujo: solo existe para Instagram), así que no se puede
  elegir solo. Regla: el flujo que es plantilla de Meta se marca `<clave>_es_plantilla` = si y recibe la versión de una línea; los
  demás reciben el diseño. Lo que siempre llega con diseño será cada plantilla nueva al aprobarse (`pedido_hoy_ticket` ya enviada).
- **Plantilla `entregas_manana` (reporte de las 18:00) enviada a Meta el 1-nov** (Utility, es_MX): "📋 *ENTREGAS DE MAÑANA* ·
  {aviso_referencia}" y un renglón por sección (📍 Polanco, Cuajimalpa, Bosques, 🚚 Domicilio con `entregas_*`). Al aprobarse:
  cambiar el flujo `Entregas manana (sistema)` a esa plantilla y poner `manychat_entregas_una_linea` = si (sus variables no
  aceptan saltos de línea). ManyChat Pro se cobra solo el 5-nov (USD 348/año + excedentes arriba de 2,500 contactos, hoy 242).
- 🔴 **Shopify en producción (revisado el 1-nov, solo lectura)**: las reservas de la tienda en línea **nunca se cierran**. De #1052 a
  #1063 hay 11 pedidos ABIERTOS (17 tartas apartadas; 7 a domicilio en Cuajimalpa) con fecha de entrega del 23 al 31-oct. La venta
  real se registra aparte (las rutas, canal "Ruta", las captura Yessenia al vender: 265 renglones en octubre), así que esas tartas
  siguen apartadas de más. Limpiarlas con un script de una vez (como `101`/`102`) solo con el OK de Alex.
- **Informe de buenas prácticas y decisiones pendientes**: `recomendaciones-para-manana.md` (raíz del repo).
- **Domicilio o días después**: solo se registra en la lista de pedidos (Ventas y Tablero; los de domicilio NO llegan solos a Reparto, ver
  arriba); no manda aviso al momento, sale en el reporte de las 18:00 del día anterior.
  La visibilidad en producción el día de cocinar es solo "subirlo al sistema" por ahora (sin aviso de anticipación):
  pendiente corregir `getProduccionManana`, que hoy solo ve canal "Apartado".
- **Lo que no se cerró**: no hay recordatorio por hora de recogida. Al final del día todos los pedidos de hoy sin cerrar
  pasan por el barrido de las 21:00 → POR REVISAR → autorizan Rebeca o Yessenia por la página de aprobación (nada se cancela solo).
- **SIGUIENTE ETAPA — seguimiento al cliente** (con teléfono o Instagram del pedido; las ventas de mostrador sin contacto no aplican):
  - Pedidos **entregados**: al **día siguiente** se pregunta "¿todo bien?, ¿qué le pareció?"; la respuesta (calificación y
    comentario) se guarda junto al pedido y una mala avisa a Rebeca.
  - Pedidos **que no llegaron** (cancelados por no recogido): **esa misma noche**, después de que se autoriza la cancelación,
    alimenta la campaña de recuperación (hoja `Pedidos_No_Recogidos`, ya existe).
  - Límites de canal: Instagram solo dentro de 24 h del último mensaje del cliente (para entregas de días después casi
    nunca aplica); WhatsApp fuera de esa ventana exige **plantilla aprobada por Meta** y tiene costo por mensaje.
- **Libro de diseño** (prueba, datos de ejemplo, no es el real): pestañas Pedidos activos, una por sucursal, Rutas, Finales,
  Cancelados, Resumen, Bitácora y Configuración. El Estado es un menú desplegable en todas; cambiarlo mueve el pedido y lo anota
  en la Bitácora; los pedidos para recoger deben traer hora (si falta, se pone roja).
  Se construiría en pestañas nuevas dentro del Excel que Rebeca decida (el de respuestas del formulario o el Sistema).

### Ambiente de pruebas completo (28-oct-2026, en construcción)

Pedido de Alex: un ambiente de pruebas desde cero con inventario inicial, donde un pedido se vea en todos los lugares y se pruebe
todo el ciclo. Hecho hasta ahora (solo en el proyecto de pruebas, no en producción):
- **Reset** (`95_prueba_reset.js`, vive solo en el proyecto de pruebas, con candados: token, hoja "…PRUEBAS…" y frase de
  confirmación): libera las reservas, borra de Ventas los pedidos con referencia, vacía las pestañas del tablero, avisos,
  no recogidos y Bot_Log, reinicia las referencias y carga un inventario inicial conocido (Bosques 12/8/6, Cuajimalpa y Polanco
  6/3/2 por sabor en Individual/Mediana/Grande, con escaseces a propósito: Frutos Rojos Grande en Polanco 0, Queso Mediana en
  Cuajimalpa 1, Pumpkin spice Individual en Polanco 1; todo lo que no sea tarta del menú en cero). Termina con
  `reconciliarLedger()` y `auditarConsistencia()` en verde. ⚠️ `invAjustar` sobre un SKU sin fila previa asienta el ajuste
  DOS veces en el libro mayor (lo da de alta con `invProducir` y luego asienta la diferencia completa): por eso el reset reconcilia.
- **Llave de recolección**: el mensaje de confirmación dice "Tu llave es TV-…": se la da a quien lo atienda en la sucursal para
  que encuentren su tarta apartada (es la referencia; la pestaña la nombra "Llave").
- **Pestañas por sucursal** (`21_tablero_pedidos.js`): `Pedidos Bosques`, `Pedidos Cuajimalpa` y `Pedidos Polanco` además de
  `Tablero_Pedidos`, con hora de recoger como columna. Un pedido nuevo entra al instante en la general y en la de su sucursal
  (los domicilios salen de Bosques); confirmar/entregar/no llegó cambia el estado del renglón en todas las pestañas al instante;
  la revisión de cada 5 min reacomoda el orden. Ya no se reconstruye todo en cada acción (tardaba y dejaba renglones viejos).
- **Producción del día** (`getProduccionManana`) ahora cuenta también los pedidos del bot y de Shopify (`PEDIDO_CANALES_PRODUCCION`).
  `getApartados` NO se tocó a propósito: esa pantalla tiene cancelar, que usa `eliminarMovimiento` y repondría stock que nunca se
  descontó en los canales Tienda y Domicilio.
- **Lealtad** (`23_clientes_lealtad.js`, hoja `Clientes_Lealtad`): un renglón por cliente (clave: teléfono; sin teléfono, su
  conversación de Instagram) con pedidos hechos, entregados, no recogidos, total comprado, primer pedido y última entrega.
- **Cierre del día y mensajes a clientes** (`24_seguimiento_clientes.js`, todo probado en el proyecto de pruebas con un reloj simulado):
  - `pedidosCierreDelDia` (21:00): lo que no se recogió pasa a POR REVISAR (sigue apartado), se programa un mensaje al cliente
    ofreciéndole reagendar para mañana u otra fecha, y a Rebeca y Yessenia les llega el **reporte de la noche** con las tartas apartadas
    sin entregar, por sucursal (con llave, cliente, piezas y hora). Queda huella en `Reportes_Noche`.
  - **Feedback**: al entregar un pedido se programa para `FEEDBACK_DIAS` (2) días después a las `FEEDBACK_HORA` (10:00) el mensaje
    "¿cómo te fue?". Los mensajes proactivos pasan por la cola `Mensajes_Clientes` (PENDIENTE → ENVIADO / FALLÓ / SIN CANAL, con el
    motivo); `mensajesClientesEnviarAhora` (cada 30 min, `instalarMensajesClientes()`) manda los que ya toca.
  - `Seguimiento_Pedidos` guarda por llave el id de contacto de ManyChat (la conversación del bot) y el canal: sin él no hay mensaje.
    Los pedidos de Shopify o teléfono quedan SIN CANAL hasta tener una forma de ubicar al cliente en ManyChat.
  - **Menú de Estado en las pestañas por sucursal**: opciones CONFIRMADO, ENTREGADO y NO RECOGIDO. `tableroAlEditar` (trigger instalable,
    `instalarMenuEstadoPedidos()`) ejecuta la misma acción que el punto de venta (entregar descuenta, no recogido libera) con el nombre
    de quien editó en la auditoría; si falla o el correo no está en `pedidos_hoja_autorizados` (vacío = cualquiera con edición), revierte
    la celda y avisa. ⚠️ Si Alex cambia el rol con el que corren estas acciones, revisar `tableroAplicarEstado` (usa Owner internamente).
  - Flujos de ManyChat que usa el envío (cada uno es un flujo de un solo paso con campos del contacto): `manychat_flujo_aviso`,
    `manychat_flujo_reporte` (aviso_referencia + aviso_detalle), `manychat_flujo_cliente_instagram` y `manychat_flujo_cliente_whatsapp`
    (mensaje_cliente). Mientras falte la clave o el flujo en Configuración, el envío queda anotado como "NO SE MANDÓ: falta …" y el
    mensaje sigue PENDIENTE. Creados en ManyChat el 1-nov (texto normal, dentro de la ventana de 24 h): alerta, reporte y mensaje al cliente por WhatsApp. El campo que lleva el mensaje al cliente es `aviso_detalle` (el campo `mensaje_cliente` nunca existió en ManyChat). El flujo de Instagram (`manychat_flujo_cliente_instagram`) también quedó creado; ManyChat aceptó los envíos de prueba a Alex por WhatsApp e Instagram. **Pendiente**: las plantillas de WhatsApp
    (`reporte_apartados_noche`, `reagendar_pedido`, `feedback_pedido`) para que lleguen fuera de la ventana de 24 h.
  - Para probar sin esperar días: el proyecto de pruebas tiene rutas que reciben una hora simulada (cierre del día y envío de mensajes).
  - **Reloj simulado de Maite (solo pruebas, 1-nov)**: `95_prueba_reloj.js` redefine `_botAhora` (se carga después de 18 y gana);
    `relojSimuladoEncender("13:00")` hace que Maite crea que hoy (fecha real) son esas horas, para probar pedidos "para hoy" con las
    tiendas cerradas; caduca sola a las 2 h o con `relojSimuladoApagar()`. `95_prueba_correr.js` tiene una sola función
    (`correrPrueba`) para correr pruebas desde el editor sin pelear con el menú de funciones.
  - Falta: que el cliente conteste al mensaje de reagendar y el bot cambie la fecha del pedido (hoy lo pasa con una persona).

## Piloto en producción — noche del 1-nov

- ✅ **Maite contesta desde producción (versión 132).** El bloqueo era el permiso "Conectarse a un servicio externo" (`UrlFetchApp`) de
  grinbergalex@gmail.com, que quedó sin marcar en el consentimiento granular de Google; implementar desde el editor no lo volvía a pedir.
  Se arregló con `autorizarPermisos()` (15): `ScriptApp.requireAllScopes` obliga a mostrar todos los permisos ("Seleccionar todo").
  Si vuelve a pasar con un permiso nuevo, correrla otra vez. **`clasp update-deployment` nunca pide permisos.**
- ✅ **Recoger hoy o mañana**: Maite ofrece lo que ya está en la sucursal (`_botOfrecerLoQueHay`, `listo_en_sucursal`). Probado en vivo:
  pedido TV-1101-13 (1 Lotus Individual, Polanco, lunes 2-nov 13:00, efectivo) entró a Ventas, al tablero y a "Pedidos Polanco"; se
  liberó con el menú de Estado → NO RECOGIDO (anulado por "hoja-grinbergalex"), lo que también probó el menú en producción. Quedó un
  renglón de prueba en `Pedidos_No_Recogidos` y avisos "El bot falló" de la prueba en la bandeja del POS (borrables).
- ⚠️ **No llegó la confirmación con la llave** de ese pedido: en el piloto escribir "prueba" varias veces deja varias copias del flujo de
  ManyChat esperando, y dos llamaron a Maite a la vez con el mismo "Sí". Arreglo **listo sin publicar** (commit 6fbee5f): un mensaje
  repetido en 20 s se procesa una vez (`_botMensajeRepetido`) y el envío tardío no tumba el turno. En vivo (sin palabra clave) no hay copias.
- ⚠️ **Auditoría de producción**: Bosques Queso Grande inventario 10 vs libro mayor 14. Viene del 30-oct (venta de Ruta de 4 y
  transferencias), antes de Maite. No se tocó: revisar con Yessenia antes de reconciliar.

## Legacy / pendientes

- `cargaInv 17.js`, `ventasmasivoCuaji17.js`, `limpiar apartados.js`:
  scripts de migración de una sola vez — no llamarlos desde el API.
- La "carga masiva con IA" pasa por la acción `iaProcesar` del backend
  (v6.5d), que usa la API key guardada en Propiedades del script
  (`ANTHROPIC_API_KEY`). **Nunca** poner una API key en index.html —
  GitHub Pages es público.
