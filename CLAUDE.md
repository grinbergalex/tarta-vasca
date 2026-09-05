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

## Cómo desplegar el backend

1. Editar en `backend/` (nunca directo en el editor online: git es la fuente
   de verdad; el editor online solo para correr funciones).
2. `cd backend && clasp push`
3. En el editor de Apps Script: **Implementar → Administrar implementaciones →
   ✏️ sobre la implementación existente → Versión: "Nueva versión" → Implementar**.
   ⚠️ NUNCA "Nueva implementación": eso genera otra URL y el frontend
   (`API_URL` en index.html, línea ~1985) quedaría apuntando a la vieja.

`clasp push` solo sube el código; producción no cambia hasta el paso 3.

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

## v7.1 — Arranque y sesiones (4-sep-2026)

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

## Legacy / pendientes

- `cargaInv 17.js`, `ventasmasivoCuaji17.js`, `limpiar apartados.js`:
  scripts de migración de una sola vez — no llamarlos desde el API.
- La "carga masiva con IA" pasa por la acción `iaProcesar` del backend
  (v6.5d), que usa la API key guardada en Propiedades del script
  (`ANTHROPIC_API_KEY`). **Nunca** poner una API key en index.html —
  GitHub Pages es público.
