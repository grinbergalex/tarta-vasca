# Tarta Vasca — POS/ERP

Sistema de punto de venta e inventario para una pastelería con 2 sucursales
(Cuajimalpa y Nápoles): ventas, producción, stock, recetas/costos, rutas de
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
  Verificado contra un servidor que acepta la conexión y nunca responde: con los tres
  CDN colgados se puede iniciar sesión, vender y ver stock; solo faltan gráficas y mapa.
- **Timeout en `api()`** (25 s lecturas, 60 s escrituras). Antes no había ninguno: un
  Apps Script atorado dejaba el fetch colgado para siempre, sin error y sin salida.

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

## Legacy / pendientes

- `cargaInv 17.js`, `ventasmasivoCuaji17.js`, `limpiar apartados.js`:
  scripts de migración de una sola vez — no llamarlos desde el API.
- La "carga masiva con IA" pasa por la acción `iaProcesar` del backend
  (v6.5d), que usa la API key guardada en Propiedades del script
  (`ANTHROPIC_API_KEY`). **Nunca** poner una API key en index.html —
  GitHub Pages es público.
