// ============================================================================
// ONE-OFF 2026-10-19 — Quitar los apartados "fantasma" de Polanco.
//
// Que pasa: la reserva RES-1791394720078 (Juan Eduardo Ramirez, 7-oct, entrega
// 9-oct, 1 Lotus Grande + 1 Guayabrie Grande) nunca se entrego y esas piezas no
// existen fisicamente en Polanco, pero siguen contando como stock y como apartadas.
//
// Que hace, en este orden:
//   1. Libera el apartado en Inventario (res_apartado 1 -> 0 en cada SKU).
//   2. Marca las filas de la reserva en Ventas como ANULADO y deja el snapshot en
//      Auditoria_Eliminados.
//   3. Descuenta las 2 piezas del stock de Polanco (asienta AJUSTE_LIMPIEZA en Inv_Ledger).
//
// Por que NO usa eliminarMovimiento: esa anulacion REPONE stock cuando el canal de la
// fila no es "Reservado", y esta reserva viene con canal "Tienda" — sumaria 2 piezas
// fantasma en vez de quitarlas.
//
// Correr UNA sola vez desde el editor. Si la reserva ya esta anulada, aborta sin tocar nada.
// NO llamar desde el API.
// ============================================================================
var _LIMPIEZA_RESERVA_ID = "RES-1791394720078";
var _LIMPIEZA_SUCURSAL = "Polanco";
var _LIMPIEZA_MOTIVO = "Apartado no real (limpieza 19-oct-2026): las piezas no existian fisicamente";
var _LIMPIEZA_USUARIO = "limpieza-oct2026";

function limpiarApartadosFantasmaPolanco() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var h = ss.getSheetByName("Ventas");
    var headers = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
    var iAnul = headers.indexOf("estado_anul"), iTipo = headers.indexOf("tipo_op");
    var datos = h.getDataRange().getValues();

    var filas = [];
    for (var i = 1; i < datos.length; i++) {
      var r = datos[i];
      if (r[0] !== _LIMPIEZA_RESERVA_ID) continue;
      if (iAnul !== -1 && r[iAnul] === "ANULADO") continue;
      if (iTipo !== -1 && r[iTipo] !== "Reservado") continue;
      if (r[3] !== _LIMPIEZA_SUCURSAL) throw new Error("ABORTADO: la fila " + (i + 1) + " no es de " + _LIMPIEZA_SUCURSAL + ".");
      filas.push(i + 1);
    }
    if (!filas.length) throw new Error("ABORTADO: la reserva " + _LIMPIEZA_RESERVA_ID + " ya no esta vigente. No se hizo nada.");

    var colsAnul = ["estado_anul", "anulado_por", "anulado_fecha", "anulado_motivo"];
    colsAnul.forEach(function (c) {
      if (headers.indexOf(c) === -1) throw new Error("ABORTADO: falta la columna " + c + " en Ventas.");
    });
    var cEstado = headers.indexOf("estado_anul") + 1, cPor = headers.indexOf("anulado_por") + 1;
    var cFecha = headers.indexOf("anulado_fecha") + 1, cMotivo = headers.indexOf("anulado_motivo") + 1;

    var ahora = new Date().toISOString();
    var snapshot = [];
    var resumen = [];
    filas.forEach(function (fila) {
      var r = h.getRange(fila, 1, 1, h.getLastColumn()).getValues()[0];
      var sabor = String(r[4]), tamano = String(r[5]), cant = Number(r[6]) || 0;
      snapshot.push(r);

      invLiberar(ss, sabor, tamano, _LIMPIEZA_SUCURSAL, cant, "apartado", _LIMPIEZA_RESERVA_ID, _LIMPIEZA_USUARIO);
      h.getRange(fila, cEstado).setValue("ANULADO");
      h.getRange(fila, cPor).setValue(_LIMPIEZA_USUARIO);
      h.getRange(fila, cFecha).setValue(ahora);
      h.getRange(fila, cMotivo).setValue(_LIMPIEZA_MOTIVO);
      invDescontar(ss, sabor, tamano, _LIMPIEZA_SUCURSAL, cant, _LIMPIEZA_RESERVA_ID, _LIMPIEZA_USUARIO, _LIMPIEZA_MOTIVO, "AJUSTE_LIMPIEZA");
      resumen.push(cant + "x " + sabor + " " + tamano);
    });

    var hAudit = ss.getSheetByName("Auditoria_Eliminados");
    if (hAudit) hAudit.appendRow([ahora, "Ventas", _LIMPIEZA_RESERVA_ID, "Ventas", _LIMPIEZA_USUARIO, _LIMPIEZA_MOTIVO, JSON.stringify(snapshot), false]);
    registrarAuditoria(_LIMPIEZA_USUARIO, "Owner", "LIMPIEZA_APARTADO", _LIMPIEZA_RESERVA_ID + " | " + resumen.join(", ") + " | " + _LIMPIEZA_SUCURSAL);
    SpreadsheetApp.flush();
    _velBump("inv");
    _utilMarcarDirty();

    Logger.log("Listo. Se quitaron de " + _LIMPIEZA_SUCURSAL + ": " + resumen.join(", "));
    return resumen;
  } finally {
    try { lock.releaseLock(); } catch (_e) {}
  }
}
