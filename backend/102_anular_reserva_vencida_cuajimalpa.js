// ============================================================================
// ONE-OFF 2026-10-19 — Anular la reserva vencida de Cuajimalpa.
//
// La reserva RES-1791398309199 (pedido en linea de Shopify, Hiram Ortiz Reyes,
// 1 Oreo Mediana, hecha el 7-oct con entrega el 10-oct) lleva 9 dias vencida.
// La dueña pidio desaparecerla del POS.
//
// Solo anula la fila en Ventas (estado ANULADO + snapshot en Auditoria_Eliminados).
// NO toca el inventario: esta reserva nunca aparto piezas fisicas (res_apartado = 0) y
// Cuajimalpa tiene 0 Oreo Mediana. NO cancela el pedido ni devuelve el pago en Shopify.
//
// Correr UNA sola vez desde el editor. Si la reserva ya esta anulada, aborta sin tocar nada.
// NO llamar desde el API.
// ============================================================================
var _ANULAR_RESERVA_ID = "RES-1791398309199";
var _ANULAR_RESERVA_SUCURSAL = "Cuajimalpa";
var _ANULAR_RESERVA_MOTIVO = "Reserva vencida (entrega 10-oct-2026) retirada del POS el 19-oct-2026";
var _ANULAR_RESERVA_USUARIO = "limpieza-oct2026";

function anularReservaVencidaCuajimalpa() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var h = ss.getSheetByName("Ventas");
    var headers = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
    var iAnul = headers.indexOf("estado_anul"), iTipo = headers.indexOf("tipo_op");
    ["estado_anul", "anulado_por", "anulado_fecha", "anulado_motivo"].forEach(function (c) {
      if (headers.indexOf(c) === -1) throw new Error("ABORTADO: falta la columna " + c + " en Ventas.");
    });
    var datos = h.getDataRange().getValues();

    var filas = [];
    for (var i = 1; i < datos.length; i++) {
      var r = datos[i];
      if (r[0] !== _ANULAR_RESERVA_ID) continue;
      if (r[iAnul] === "ANULADO") continue;
      if (r[iTipo] !== "Reservado") continue;
      if (r[3] !== _ANULAR_RESERVA_SUCURSAL) throw new Error("ABORTADO: la fila " + (i + 1) + " no es de " + _ANULAR_RESERVA_SUCURSAL + ".");
      filas.push(i + 1);
    }
    if (!filas.length) throw new Error("ABORTADO: la reserva " + _ANULAR_RESERVA_ID + " ya no esta vigente. No se hizo nada.");

    var cEstado = headers.indexOf("estado_anul") + 1, cPor = headers.indexOf("anulado_por") + 1;
    var cFecha = headers.indexOf("anulado_fecha") + 1, cMotivo = headers.indexOf("anulado_motivo") + 1;
    var ahora = new Date().toISOString();
    var snapshot = [];
    filas.forEach(function (fila) {
      snapshot.push(h.getRange(fila, 1, 1, h.getLastColumn()).getValues()[0]);
      h.getRange(fila, cEstado).setValue("ANULADO");
      h.getRange(fila, cPor).setValue(_ANULAR_RESERVA_USUARIO);
      h.getRange(fila, cFecha).setValue(ahora);
      h.getRange(fila, cMotivo).setValue(_ANULAR_RESERVA_MOTIVO);
    });

    var hAudit = ss.getSheetByName("Auditoria_Eliminados");
    if (hAudit) hAudit.appendRow([ahora, "Ventas", _ANULAR_RESERVA_ID, "Ventas", _ANULAR_RESERVA_USUARIO, _ANULAR_RESERVA_MOTIVO, JSON.stringify(snapshot), true]);
    registrarAuditoria(_ANULAR_RESERVA_USUARIO, "Owner", "ANULAR_RESERVA_VENCIDA", _ANULAR_RESERVA_ID + " | " + _ANULAR_RESERVA_SUCURSAL);
    SpreadsheetApp.flush();
    _velBump("inv");
    _utilMarcarDirty();

    Logger.log("Listo. Reserva " + _ANULAR_RESERVA_ID + " anulada (" + filas.length + " fila).");
    return filas.length;
  } finally {
    try { lock.releaseLock(); } catch (_e) {}
  }
}
