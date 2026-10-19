// ============================================================================
// ONE-OFF 2026-08-21 — Revertir el conteo fisico de Polanco de las 20:34.
//
// Que paso: a las 19:22-19:26 Rebeca capturo la transferencia Cuajimalpa ->
// Polanco de 162 piezas (producto horneado a las 19:04, que sale en el reparto
// de la manana). A las 20:34 conto fisicamente Polanco, donde ese producto
// todavia no estaba, y el sistema borro 158 piezas. Cuajimalpa ya habia sido
// debitada, asi que las 162 piezas quedaron fuera del sistema en ambos lados.
//
// Que hace: devuelve Polanco al estado posterior a la transferencia (paso 2).
// NO borra el historico — Inv_Ledger es append-only: asienta la reversa.
// Trabaja con DELTAS sobre el saldo vivo, no con valores absolutos, para no
// pisar ventas registradas despues del conteo.
//
// Correr UNA sola vez desde el editor. Tiene guarda anti-doble-ejecucion.
// NO llamar desde el API.
// ============================================================================
var _REV_MOTIVO_21AGO = "Reversa conteo 21-ago 20:34 (borro transferencia 19:22 aun no recibida)";

function revertirConteoPolanco21ago() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Guarda: si ya se corrio, abortar.
  var hl = ss.getSheetByName("Inv_Ledger");
  var d = hl.getDataRange().getValues();
  for (var i = d.length - 1; i > 0 && i > d.length - 400; i--) {
    if (String(d[i][14]).indexOf("Reversa conteo 21-ago") !== -1) {
      throw new Error("ABORTADO: la reversa ya se ejecuto (fila " + (i + 1) + " de Inv_Ledger). No se hizo nada.");
    }
  }

  // [sabor, tamano, delta a devolver] — inverso exacto de los 15 ajustes de las 20:34.
  var DELTA = [
    ["Carajillo",    "Individual",   7],
    ["Frutos Rojos", "Mediana",     -1],
    ["Gorgonzola",   "Individual",   2],
    ["Guayabrie",    "Grande",       2],
    ["Guayabrie",    "Individual",  21],
    ["Lotus",        "Grande",       3],
    ["Lotus",        "Individual",  20],
    ["Lotus",        "Mediana",      5],
    ["Matcha",       "Individual",   8],
    ["Oreo",         "Individual",   5],
    ["Pistache",     "Grande",       1],
    ["Pistache",     "Individual",  11],
    ["Pistache",     "Mediana",      2],
    ["Queso",        "Individual",  62],
    ["Queso",        "Mediana",     10]
  ];

  var lineas = [], sumaDelta = 0, totalAntes = 0, totalDespues = 0;
  for (var k = 0; k < DELTA.length; k++) {
    var sabor = DELTA[k][0], tamano = DELTA[k][1], delta = DELTA[k][2];
    var actual = invSaldos(ss, sabor, tamano, "Polanco").total;
    var objetivo = actual + delta;
    if (objetivo < 0) throw new Error("ABORTADO en " + sabor + " " + tamano + ": el objetivo quedaria negativo (" + objetivo + ").");
    var r = invAjustar(ss, sabor, tamano, "Polanco", objetivo, "alex", _REV_MOTIVO_21AGO);
    sumaDelta += r.diff; totalAntes += r.antes; totalDespues += r.despues;
    lineas.push("  " + sabor + " " + tamano + ": " + r.antes + " -> " + r.despues + " (" + (r.diff >= 0 ? "+" : "") + r.diff + ")");
  }

  var res = "REVERSA APLICADA — Polanco\n" + lineas.join("\n") +
            "\n  TOTAL de los 15 SKU: " + totalAntes + " -> " + totalDespues + " (" + (sumaDelta >= 0 ? "+" : "") + sumaDelta + ")" +
            "\n  Polanco completo ahora: " + _revTotalSucursal(ss, "Polanco") + " piezas" +
            "\n  Cuajimalpa (sin tocar): " + _revTotalSucursal(ss, "Cuajimalpa") + " piezas";
  Logger.log(res);
  return res;
}

// Total fisico de una sucursal, misma regla que InvCore (ignora anuladas).
function _revTotalSucursal(ss, suc) {
  var hoja = ss.getSheetByName("Inventario");
  var idx = _invIdx(hoja), datos = hoja.getDataRange().getValues(), t = 0;
  for (var i = 1; i < datos.length; i++) {
    var r = datos[i];
    if (r[3] !== suc || !r[1]) continue;
    if (_invAnulada(r, idx) || r[9] === "agotado_x_anul") continue;
    t += _invNum(r[5]);
  }
  return t;
}
