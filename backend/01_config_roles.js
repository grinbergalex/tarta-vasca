/**
 * ============================================================================
 * TARTA VASCA — BACKEND v6 "InvCore" (rewrite 2026-06-28)
 * Capa central unica de inventario. Reusa columnas v5 de tu hoja:
 *   Inventario col6=total | col16=res_ruta | col17=res_apartado
 *   disponible = total - res_ruta - res_apartado.  Hoja Inv_Ledger = bitacora.
 *
 * QUE CAMBIA vs v4.5.17:
 *  - Toda mutacion de inventario pasa por InvCore (producir/descontar/reservar/
 *    liberar/transferir/ajustar) y queda asentada en Inv_Ledger.
 *  - Transferencias atomicas y sin fantasmas.  Apartados con reserva FISICA:
 *    al entregar (convertirReservaAVenta) ahora SI descuenta inventario.
 *  - Disponible = una sola formula en todo el sistema (no mas oversell de
 *    stock reservado a ruta/apartado).
 *  - auditarConsistencia() compara inventario vs ledger (debe dar verde).
 *
 * ACTIVACION (NO pegar en media operacion):
 *  1. Pega TODO este codigo en Apps Script (reemplaza el actual). Guardar.
 *  2. Implementar -> Editar implementacion existente -> Nueva version (misma URL).
 *  3. En el editor, ejecutar UNA vez la funcion:  migrarReservasFisicas()
 *     (inicializa res_ruta/res_apartado desde apartados y rutas abiertas).
 *  4. Hacer conteo fisico con la pestana Ajuste de inventario (ambas sucursales).
 *  5. Ejecutar  auditarConsistencia()  -> debe decir "CONSISTENCIA OK (verde)".
 *  6. El index.html (frontend) NO cambia: ya lee disponible/reservado del backend.
 *
 * v6.1 (2026-07-02): (a) la reposicion por anulacion YA asienta en Inv_Ledger
 * (tipo REPOSICION_ANULACION) — limitacion v1 cerrada; (b) auditoria automatica
 * diaria 7am con correo solo si hay rojo + latido verde los lunes.
 * Activar una vez desde el editor:  instalarAuditoriaDiaria()
 * ============================================================================
 */

/**
TARTA VASCA — Apps Script API v4.5.17-pedido2 (base v4.5.13-skip-anulados)

CAMBIOS v4.5.17 (14-jun-2026):
★ getPedidoSugerido ahora devuelve TAMBIEN un segundo metodo (sugerido2 /
totalSugerido2 / metodo2): "tendencia mismo dia". Promedio ponderado de los
4 mismos dias de la semana anteriores con UNIDADES REALES (hace 1/2/3/4 sem
= 32/24/16/8%, bloque 80%) + 20% del sugerido del metodo 1, +10% buffer.
Redistribuye el peso de las semanas sin datos entre las que si tienen ventas.
El metodo 1 (ventana-7d) se conserva intacto.

BASE: v4.5.7-fix-inventario  (que a su vez basa en v4.5.6-flush-rutaId)

CAMBIOS v4.5.8 (24-may-2026):
★ altaProduccion ahora también usa LockService.waitLock(30s) + flush().
Sin esto, una venta inmediata después de cargar producción podía leer
inventario stale y sub-descontar. Cierra el último flanco del bug
de "inventario no se actualiza".

CAMBIOS v4.5.7 (24-may-2026):
★ FIX CRÍTICO: Inventario no descontaba correctamente cuando un mismo
sabor/tamaño aparecía repetido en la misma venta (ej. paquete con
sabores repetidos). Causa: descontarFIFO usaba un snapshot stale
de Inventario; ahora cada llamada re-lee fresh.
★ FIFO desactivado por decisión de negocio (ya no se ordena por fecha).
Renombrado descontarFIFO → descontarStock (alias mantenido).
★ LockService.waitLock(30s) en registrarVenta, registrarMerma y
eliminarMovimiento — serializa escrituras entre sesiones concurrentes.
★ Atómico: si cualquier item de la venta falla al descontar, todas las
deducciones se revierten (_rollbackInventario) y NO se registra venta.
★ Pre-check agregado por SKU: suma cantidades de items repetidos ANTES
de validar stock disponible.
★ eliminarMovimiento: nunca falla en silencio. Si stock no se puede
reponer al cancelar, devuelve {ok:true, advertencia:true, mensaje:"⚠️ ..."}
con detalle de fallas y conteo (repuesto_uds / esperado_uds).
★ _reponerStockVenta: regex de lotes permisivo, re-lee inventario fresh,
fallback que crea lote REINGRESO si no encuentra ninguno previo.

Funciones tocadas:

descontarStock (nueva, reemplaza descontarFIFO)

_rollbackInventario (nueva)

descontarFIFO (mantenida como alias backward-compat)

calcularDisponible (acepta hoja o snapshot)

registrarVenta

registrarMerma

eliminarMovimiento

_reponerStockVenta
*/
const VIDA_UTIL_DIAS = 9999;  // CADUCIDAD ELIMINADA — constante conservada por compatibilidad
const FACTOR_SEMANAS_MES = 4.2;
const SESION_HORAS = 24;                  // v4.4 — máximo absoluto
const SESION_INACTIVIDAD_MIN = 60;        // v4.4 — auto-logout 60 min sin actividad
const MAX_SESIONES_OWNER = 99;
const MAX_SESIONES_NORMAL = 3;
const TZ_MX = "America/Mexico_City";
// v4.4 — Horarios por sucursal por día (0=Domingo). 24h format.
const HORARIOS_SUCURSAL = {
"Polanco":    [{abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}],
"Cuajimalpa": [{abre:"10:00",cierra:"14:30"}, {abre:"09:00",cierra:"18:00"}, {abre:"09:00",cierra:"18:00"}, {abre:"09:00",cierra:"18:00"}, {abre:"09:00",cierra:"18:00"}, {abre:"09:00",cierra:"18:00"}, {abre:"09:00",cierra:"14:30"}]
};
function getHorarioHoy(sucursal, fecha) {
fecha = fecha || new Date();
const cfg = HORARIOS_SUCURSAL[sucursal];
return cfg ? cfg[fecha.getDay()] : { abre: "10:00", cierra: "19:00" };
}
function calcMontoMensual(monto, frecuencia) {
if (frecuencia === "Semanal") return monto * FACTOR_SEMANAS_MES;
if (frecuencia === "Mensual") return monto;
return 0;
}
// =================================================================================
// ROLES Y PERMISOS — v4.3
// =================================================================================
/**
Devuelve los permisos para un rol dado.
Owner:        todo permitido (admin del sistema)
Vendedor:     solo vende en su sucursal
Cocinero:     solo produce y transfiere; NO vende
Mixto:        produce, transfiere y vende en su sucursal
Admin_Ventas: vende en ambas sucursales y transfiere

NUEVO en v4.3: `puedeAnular` indica si el usuario puede anular movimientos.
Por defecto solo Owner; pero un Owner puede otorgarlo a un usuario específico
vía editarUsuario({campos: {permisos_extra: {puedeAnular: true}}}) — ver más abajo.
*/

