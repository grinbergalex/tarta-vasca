// =================================================================================
// ████████████████████████████████████████████████████████████████████████████████
// █  CONTROL DE CAJA / APERTURA-CIERRE DE TIENDA — v7 (2026-07-20)                █
// ████████████████████████████████████████████████████████████████████████████████
// =================================================================================
// Sistema de control de efectivo y auditoría por sucursal. Todo el dinero que entra
// o sale de la caja queda en un LIBRO MAYOR append-only (Caja_Ledger), clonado del
// patrón de Inv_Ledger (delta + saldo resultante, lock en el llamador, flush antes
// de asentar). Los movimientos importantes NUNCA se editan: se corrigen con nuevos
// movimientos (retiro, aportación) o con el "saldo en caja al momento" de la Dueña.
//
// MODELO DE EFECTIVO (saldo corriente CONTINUO, no se reinicia cada día):
//   esperado(sucursal) = saldo_base(último OVERRIDE_DUEÑA)
//                      + Σ ventas en Efectivo (hoja Ventas, no anuladas, tipo Venta)
//                      + Σ aportaciones
//                      − Σ retiros (recolección / sueldo / bono / compra / otro)
//   La apertura y el cierre son PUNTOS DE CONCILIACIÓN: capturan el efectivo físico,
//   lo comparan contra el esperado, registran la diferencia y mandan correo — pero
//   NO ajustan el saldo. Solo la Dueña ajusta con cajaFijarSaldo (sobrescribe).
//
// SETUP (una sola vez, desde el editor de Apps Script):
//   1) setupCaja()                → crea hojas + llaves de config.
//   2) Llenar en la hoja "Configuración": caja_correo_dueña y caja_correo_admin.
//   3) instalarCierreAutoCaja()   → trigger de cierre automático (cada 30 min).
// =================================================================================

// Sucursales del negocio (fuente única: coincide con getSucursalesUsuario / InvCore).
var CAJA_SUCURSALES = ["Cuajimalpa", "Polanco"];
// Categorías de retiro. "Otro" exige texto libre en `motivo`. Agregar aquí escala sin tocar lógica.
var CAJA_CATEGORIAS_RETIRO = ["Recolección de efectivo", "Pago de sueldo", "Pago de bono", "Compra / gasto", "Otro"];

// =================================================================================
// SETUP + HOJAS
// =================================================================================
function setupCaja() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureHojaCajaSesiones(ss);
  ensureHojaCajaLedger(ss);
  ensureHojaRetiros(ss);
  ensureHojaRetirosEvidencias(ss);
  _cajaSeedConfig(ss, "caja_correo_dueña", "");
  _cajaSeedConfig(ss, "caja_correo_admin", "");
  _cajaSeedConfig(ss, "caja_cierre_auto_margen_horas", "2");
  _cajaSeedConfig(ss, "caja_cierre_auto_inactividad_min", "90");
  // NO usar SpreadsheetApp.getUi().alert() aquí: al correr desde el editor la ventana
  // se queda esperando un clic que nadie da y la función agota los 6 min de límite.
  var msg = "✅ Setup Caja listo. Hojas: Caja_Sesiones, Caja_Ledger, Retiros, Retiros_Evidencias. Ahora corre instalarCierreAutoCaja().";
  Logger.log(msg);
  return msg;
}
/**
 * Diagnóstico rápido (sin UI, sin escrituras): dice qué quedó creado.
 * Correr desde el editor y leer el Registro de ejecución.
 */
function verificarCaja() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojas = ["Caja_Sesiones", "Caja_Ledger", "Retiros", "Retiros_Evidencias"];
  var out = [];
  for (var i = 0; i < hojas.length; i++) out.push((ss.getSheetByName(hojas[i]) ? "OK   " : "FALTA") + "  " + hojas[i]);
  var claves = ["caja_correo_dueña", "caja_correo_admin", "caja_cierre_auto_margen_horas", "caja_cierre_auto_inactividad_min"];
  for (var j = 0; j < claves.length; j++) {
    var v = _cfgVal(ss, claves[j], null);
    out.push((v === null ? "FALTA" : "OK   ") + "  config: " + claves[j] + (v ? " = " + v : ""));
  }
  var trg = ScriptApp.getProjectTriggers(), tieneTrigger = false;
  for (var k = 0; k < trg.length; k++) if (trg[k].getHandlerFunction() === "cierreAutoCaja") tieneTrigger = true;
  out.push((tieneTrigger ? "OK   " : "FALTA") + "  trigger cierreAutoCaja");
  var msg = "=== ESTADO DEL MÓDULO DE CAJA ===\n" + out.join("\n");
  Logger.log(msg);
  return msg;
}
/**
 * Diagnóstico del CÁLCULO del efectivo esperado (solo lectura).
 * Muestra de dónde sale cada número y las últimas ventas en efectivo detectadas,
 * para poder verificar que las columnas se están leyendo bien.
 */
function diagnosticoCaja() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = [];
  for (var s = 0; s < CAJA_SUCURSALES.length; s++) {
    var suc = CAJA_SUCURSALES[s];
    var base = _cajaBaseline(ss, suc);
    var acumHoy = _cajaSumaVentasEfectivo(ss, suc);
    var calc = cajaEsperado(ss, suc);
    out.push("");
    out.push("──────── " + suc + " ────────");
    if (!base.existe) { out.push("  SIN BASE: la Dueña aún no ha usado 'Fijar saldo'."); }
    else {
      out.push("  Saldo base declarado ....... " + _cajaMoney(base.saldo) + "   (fila " + (base.fila + 1) + " del Caja_Ledger, " + base.ts + ")");
      out.push("  Ventas efectivo al fijar ... " + _cajaMoney(base.ventasAcum));
      out.push("  Ventas efectivo acumuladas . " + _cajaMoney(acumHoy));
      out.push("  → Ventas del periodo ....... " + _cajaMoney(calc.ventasEfectivo));
      out.push("  + Aportaciones ............. " + _cajaMoney(calc.aportaciones));
      out.push("  − Retiros .................. " + _cajaMoney(-calc.retiros));
      out.push("  = ESPERADO ................. " + _cajaMoney(calc.esperado));
    }
  }
  // Últimas ventas en efectivo vistas por el cálculo (verifica el mapeo de columnas)
  var hV = ss.getSheetByName("Ventas");
  if (hV) {
    var d = hV.getDataRange().getValues();
    var H = d[0], iAnul = H.indexOf("estado_anul"), iTipo = H.indexOf("tipo_op"), iPagos = H.indexOf("pagos");
    var vistas = [];
    for (var i = d.length - 1; i >= 1 && vistas.length < 8; i--) {
      var r = d[i];
      var metodo = String(r[10]).trim();
      if (metodo !== "Efectivo" && metodo !== METODO_MIXTO) continue;
      if (iAnul !== -1 && r[iAnul] === "ANULADO") continue;
      if (iTipo !== -1 && r[iTipo] && r[iTipo] !== "Venta") continue;
      var monto = Number(r[8]) || 0, nota = "";
      if (metodo === METODO_MIXTO) {                      // v7.2 — solo una fila del ticket trae el desglose
        if (iPagos === -1 || !r[iPagos]) continue;
        var det = _pagosLeer(r[iPagos]);
        monto = _pagosMonto(det.pagos, "Efectivo");
        nota = " | dividido: " + _pagosTexto(det.pagos);
      }
      vistas.push("   " + r[0] + " | " + r[3] + " | " + _cajaMoney(monto) + " | " + (r[1] instanceof Date ? Utilities.formatDate(r[1], TZ_MX, "yyyy-MM-dd HH:mm") : r[1]) + nota);
    }
    out.push("");
    out.push("Últimas ventas en EFECTIVO detectadas (id | sucursal | subtotal | fecha):");
    out.push(vistas.length ? vistas.join("\n") : "   NINGUNA — revisar el método de pago en la hoja Ventas.");
  }
  var msg = "=== DIAGNÓSTICO DEL CÁLCULO DE CAJA ===" + out.join("\n");
  Logger.log(msg);
  return msg;
}
function _cajaSeedConfig(ss, clave, valor) {
  var h = ss.getSheetByName("Configuración");
  if (!h) { h = ss.insertSheet("Configuración"); h.appendRow(["Parámetro", "Valor", "Descripción"]); }
  var d = h.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) { if (String(d[i][0]) === clave) return; }
  h.appendRow([clave, valor, "Caja (v7)"]);
}
function _cajaHeader(h, headers, colwidths) {
  var r = h.getRange(1, 1, 1, headers.length);
  r.setValues([headers]); r.setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
  h.setFrozenRows(1);
  if (colwidths) { for (var k in colwidths) h.setColumnWidth(Number(k), colwidths[k]); }
}
function ensureHojaCajaSesiones(ss) {
  var h = ss.getSheetByName("Caja_Sesiones");
  if (!h) {
    h = ss.insertSheet("Caja_Sesiones"); h.setTabColor("#B9770E");
    _cajaHeader(h, ["id", "sucursal", "caja_id", "turno", "fecha", "estado", "apertura_por", "apertura_at",
      "efectivo_fisico_ini", "esperado_ini", "dif_ini", "cierre_por", "cierre_at",
      "efectivo_fisico_fin", "esperado_fin", "dif_fin", "respuestas_apertura", "respuestas_cierre", "notas"],
      { 1: 150, 17: 260, 18: 260, 19: 220 });
  }
  return h;
}
function ensureHojaCajaLedger(ss) {
  var h = ss.getSheetByName("Caja_Ledger");
  if (!h) {
    h = ss.insertSheet("Caja_Ledger"); h.setTabColor("#7D6608");
    _cajaHeader(h, ["timestamp", "tipo", "sucursal", "caja_id", "sesion_id", "delta", "saldo", "referencia", "usuario", "motivo", "ventas_acum"],
      { 1: 160, 2: 150, 10: 340 });
    return h;
  }
  // Migración: `ventas_acum` se agregó después. Guarda el acumulado de ventas en
  // efectivo que existía al momento de un OVERRIDE_DUEÑA (base del cálculo).
  var hdr = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
  if (hdr.indexOf("ventas_acum") === -1) {
    var col = h.getLastColumn() + 1;
    h.getRange(1, col).setValue("ventas_acum").setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
  }
  return h;
}
function ensureHojaRetiros(ss) {
  var h = ss.getSheetByName("Retiros");
  if (!h) {
    h = ss.insertSheet("Retiros"); h.setTabColor("#922B21");
    _cajaHeader(h, ["id", "sucursal", "sesion_id", "categoria", "monto", "motivo", "estado",
      "solicitado_por", "solicitado_at", "autorizado_por", "autorizado_at", "entregado_at",
      "conciliado_por", "conciliado_at", "evidencias", "notas"],
      { 1: 160, 4: 150, 6: 240, 16: 240 });
  }
  return h;
}
function ensureHojaRetirosEvidencias(ss) {
  var h = ss.getSheetByName("Retiros_Evidencias");
  if (!h) {
    h = ss.insertSheet("Retiros_Evidencias"); h.setTabColor("#B03A2E");
    _cajaHeader(h, ["id", "retiro_id", "tipo", "url_drive", "folio", "subido_por", "subido_at"],
      { 1: 180, 2: 160, 4: 360 });
  }
  return h;
}

// =================================================================================
// LEDGER (append-only, clon de _invLedger) + CÁLCULO DE EFECTIVO ESPERADO
// =================================================================================
// El timestamp se guarda con el MISMO formato que _invLedger (texto local, no ISO):
// un ISO con "Z" lo convierte Sheets a fecha y le quita la zona, desfasando 6 horas.
// Aquí el timestamp es SOLO informativo — ningún cálculo depende de él.
function _cajaLedger(ss, tipo, sucursal, sesionId, delta, saldo, ref, usuario, motivo, ventasAcum) {
  var h = ensureHojaCajaLedger(ss);
  var fila = [Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd HH:mm:ss"), tipo, sucursal, "principal", sesionId || "",
    Number(delta) || 0, Number(saldo) || 0, ref || "", usuario || "", motivo || ""];
  fila.push(ventasAcum == null ? "" : Number(ventasAcum) || 0);   // col 11: ventas_acum
  h.appendRow(fila);
  _cajaMemoInvalidar();   // v7.1 — el asiento puede cambiar el esperado dentro de esta misma ejecucion
}
/**
 * Última "verdad" declarada por la Dueña. Devuelve el saldo, la FILA del asiento
 * (el orden del libro es cronológico porque es append-only) y el acumulado de
 * ventas en efectivo que ya existía en ese momento.
 * Se apoya en posición de fila y en acumulados — nunca en comparar fechas.
 */
function _cajaBaseline(ss, sucursal) {
  var h = ss.getSheetByName("Caja_Ledger");
  if (!h) return { existe: false, saldo: 0, fila: 0, ventasAcum: 0, ts: "" };
  var d = h.getDataRange().getValues();
  if (d.length < 2) return { existe: false, saldo: 0, fila: 0, ventasAcum: 0, ts: "" };
  var iAcum = d[0].indexOf("ventas_acum");
  for (var i = d.length - 1; i >= 1; i--) {
    if (d[i][2] !== sucursal || d[i][1] !== "OVERRIDE_DUEÑA") continue;
    var acum = (iAcum !== -1 && d[i][iAcum] !== "" && d[i][iAcum] != null) ? (Number(d[i][iAcum]) || 0) : null;
    if (acum === null) {
      // Migración auto-sanadora: asientos creados antes de este arreglo no traen el
      // acumulado. Se fija ahora, de modo que a partir de este momento el conteo
      // sea exacto. (Si quieres cuadrar el pasado, vuelve a "Fijar saldo".)
      acum = _cajaSumaVentasEfectivo(ss, sucursal);
      if (iAcum !== -1) { try { h.getRange(i + 1, iAcum + 1).setValue(acum); } catch (e) { } }
    }
    return { existe: true, saldo: Number(d[i][6]) || 0, fila: i, ventasAcum: acum, ts: String(d[i][0] || "") };
  }
  return { existe: false, saldo: 0, fila: 0, ventasAcum: 0, ts: "" };
}
// Acumulado histórico de ventas en efectivo (sin filtro de tiempo).
// v7.1 — La hoja Ventas crece sin límite y esto la recorría ENTERA, una vez por
// sucursal y otra vez desde _cajaBaseline. Con dos sucursales eran 2-4 recorridos
// completos en la misma petición, y cajaEstado corre al arrancar la app: por eso el
// arranque se volvía más lento cada mes. Ahora se recorre UNA vez y se memoiza
// durante la ejecución. No se usa CacheService a propósito: el memo vive solo lo que
// dura la petición, así que no puede quedar desfasado de la hoja (que es dinero).
var _CAJA_VEF_MEMO = null;
function _cajaMemoInvalidar() { _CAJA_VEF_MEMO = null; }
function _cajaMapaVentasEfectivo(ss) {
  var mapa = {};
  var h = ss.getSheetByName("Ventas");
  if (!h) return mapa;
  var d = h.getDataRange().getValues();
  if (d.length < 2) return mapa;
  var H = d[0], iAnul = H.indexOf("estado_anul"), iTipo = H.indexOf("tipo_op"), iPagos = H.indexOf("pagos");
  var mixtos = {};   // v7.2 — tickets con pago dividido, juntados por id
  for (var i = 1; i < d.length; i++) {
    var r = d[i];
    var metodo = String(r[10]).trim();                         // metodoPago (col K / idx10)
    if (metodo !== "Efectivo" && metodo !== METODO_MIXTO) continue;
    if (iTipo !== -1 && r[iTipo] && r[iTipo] !== "Venta") continue;  // excluye Reservado/Regalo
    var anulada = (iAnul !== -1 && r[iAnul] === "ANULADO");
    var suc = r[3];                                            // sucursal (col D / idx3)
    if (metodo === "Efectivo") {
      if (!anulada) mapa[suc] = (mapa[suc] || 0) + (Number(r[8]) || 0);   // subtotal (col I / idx8)
      continue;
    }
    // Pago dividido: el desglose vive en UNA sola fila del ticket, pero el monto vivo
    // esta repartido en todas — hay que juntarlas antes de decidir cuanto entro en caja.
    var t = mixtos[r[0]] || (mixtos[r[0]] = { suc: suc, vivo: 0, det: null });
    if (iPagos !== -1 && r[iPagos] && !t.det) t.det = _pagosLeer(r[iPagos]);
    if (!anulada) t.vivo += Number(r[8]) || 0;
  }
  for (var id in mixtos) {
    var m = mixtos[id];
    if (!m.det) continue;                                      // sin desglose legible no se adivina
    var efectivo = _pagosMonto(m.det.pagos, "Efectivo");
    // Tope contra lo que sigue vivo del ticket: si se anula (entera o en parte) el efectivo
    // baja igual que en una venta normal, y deja fuera el envio cobrado en efectivo — que
    // esta cuenta nunca ha contado (la columna envio_monto no entra aqui).
    if (efectivo > m.vivo) efectivo = m.vivo;
    mapa[m.suc] = (mapa[m.suc] || 0) + efectivo;
  }
  return mapa;
}
function _cajaSumaVentasEfectivo(ss, sucursal) {
  if (!_CAJA_VEF_MEMO) _CAJA_VEF_MEMO = _cajaMapaVentasEfectivo(ss);
  return _CAJA_VEF_MEMO[sucursal] || 0;
}
// Suma de deltas del ledger de un tipo, para los asientos POSTERIORES a `filaDesde`.
function _cajaSumaLedgerDesdeFila(ss, sucursal, tipo, filaDesde) {
  var h = ss.getSheetByName("Caja_Ledger");
  if (!h) return 0;
  var d = h.getDataRange().getValues(), suma = 0;
  for (var i = Math.max(1, (filaDesde || 0) + 1); i < d.length; i++) {
    if (d[i][2] !== sucursal || d[i][1] !== tipo) continue;
    suma += Number(d[i][5]) || 0;                              // delta (idx5)
  }
  return suma;
}
// Fórmula única del efectivo esperado (corriente) + desglose para correos/UI.
function cajaEsperado(ss, sucursal) {
  var base = _cajaBaseline(ss, sucursal);
  // Sin "saldo en caja al momento" declarado aún: la Dueña debe fijarlo la primera vez.
  // No sumamos ventas históricas (daría un esperado sin sentido).
  if (!base.existe) {
    return { esperado: 0, baseline: 0, baselineTs: null, ventasEfectivo: 0, aportaciones: 0, retiros: 0, desde: "(sin configurar)", sinBase: true };
  }
  // Ventas del periodo = acumulado de hoy − acumulado al momento del ajuste.
  var ventas = _cajaSumaVentasEfectivo(ss, sucursal) - base.ventasAcum;
  var aport = _cajaSumaLedgerDesdeFila(ss, sucursal, "APORTACION", base.fila);
  var retiros = _cajaSumaLedgerDesdeFila(ss, sucursal, "RETIRO", base.fila);  // deltas negativos
  var esperado = base.saldo + ventas + aport + retiros;
  return {
    esperado: esperado, baseline: base.saldo, baselineTs: base.ts,
    ventasEfectivo: ventas, aportaciones: aport, retiros: retiros,
    desde: base.ts || "inicio", sinBase: false
  };
}

// =================================================================================
// HELPERS DE FORMATO / CORREO
// =================================================================================
function _cajaMoney(n) {
  n = Number(n) || 0;
  var s = Math.abs(n).toFixed(2).split(".");
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-$" : "$") + s[0] + "." + s[1];
}
function _esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function _cajaFila(k, v) { return "<tr><td style='padding:4px 12px 4px 0;color:#666'>" + k + "</td><td style='padding:4px 0;font-weight:bold'>" + v + "</td></tr>"; }
function _cajaTabla(rows) { return "<table style='border-collapse:collapse;font-size:14px;margin:6px 0'>" + rows + "</table>"; }
function _cajaCorreoWrap(titulo, inner) {
  return "<div style='font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222'>" +
    "<div style='background:#2E4756;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0'>" +
    "<div style='font-size:18px;font-weight:bold'>Tarta Vasca — Control de caja</div>" +
    "<div style='font-size:14px;opacity:.9'>" + _esc(titulo) + "</div></div>" +
    "<div style='border:1px solid #e3e3e3;border-top:none;padding:16px 20px;border-radius:0 0 8px 8px'>" + inner +
    "<p style='font-size:11px;color:#888;margin-top:20px'>Correo automático del sistema Tarta Vasca. No responder.</p>" +
    "</div></div>";
}
// Destinatarios de los correos de caja. Cada celda de config admite VARIOS correos
// separados por coma o punto y coma (para cuando haya más administradoras).
// Si no hay ninguno configurado, cae al correo de alertas del sistema.
function _cajaDestinatarios(ss) {
  var raw = [String(_cfgVal(ss, "caja_correo_dueña", "") || ""), String(_cfgVal(ss, "caja_correo_admin", "") || "")];
  var arr = [], vistos = {};
  for (var i = 0; i < raw.length; i++) {
    var partes = raw[i].split(/[,;]/);
    for (var j = 0; j < partes.length; j++) {
      var e = partes[j].trim();
      if (e && e.indexOf("@") > 0 && !vistos[e.toLowerCase()]) { vistos[e.toLowerCase()] = true; arr.push(e); }
    }
  }
  if (!arr.length) { try { arr.push(AUDIT_EMAIL_DESTINO); } catch (e) { } }
  return arr;
}
/**
 * Configura los correos que reciben los avisos de caja (correr una vez).
 * Después los puedes cambiar cuando quieras en la hoja Configuración,
 * en las filas caja_correo_dueña / caja_correo_admin. Sin tocar código.
 */
function configurarCorreosCaja() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  _cajaSetConfig(ss, "caja_correo_dueña", "rebecielak@me.com");
  _cajaSetConfig(ss, "caja_correo_admin", "grinbergalex@gmail.com");
  var msg = "✅ Correos de caja: " + _cajaDestinatarios(ss).join(", ");
  Logger.log(msg);
  return msg;
}
function _cajaSetConfig(ss, clave, valor) {
  var h = ss.getSheetByName("Configuración");
  if (!h) { h = ss.insertSheet("Configuración"); h.appendRow(["Parámetro", "Valor", "Descripción"]); }
  var d = h.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) { if (String(d[i][0]) === clave) { h.getRange(i + 1, 2).setValue(valor); return; } }
  h.appendRow([clave, valor, "Caja (v7)"]);
}
function _cajaEnviarCorreo(ss, asunto, html) {
  var to = _cajaDestinatarios(ss).join(",");
  if (!to) return;
  var fromAddr = String(_cfgVal(ss, "negocio_email_envio", "") || "").trim();
  try {
    if (fromAddr) GmailApp.sendEmail(to, asunto, "Este correo requiere un visor HTML.", { from: fromAddr, name: "Tarta Vasca — Caja", htmlBody: html });
    else MailApp.sendEmail({ to: to, subject: asunto, htmlBody: html, name: "Tarta Vasca — Caja" });
  } catch (e) {
    try { MailApp.sendEmail({ to: to, subject: asunto, htmlBody: html, name: "Tarta Vasca — Caja" }); } catch (e2) { }
  }
}
function _cajaRespuestasHtml(resp) {
  if (!resp || typeof resp !== "object") return "";
  var ks = Object.keys(resp); if (!ks.length) return "";
  var rows = ""; for (var i = 0; i < ks.length; i++) rows += _cajaFila(_esc(ks[i]), _esc(resp[ks[i]]));
  return _cajaTabla(rows);
}
function _cajaRetirosPendientesHtml(ss, sucursal) {
  var pend = _cajaRetirosPendientes(ss, sucursal);
  var h = "<h3 style='margin:16px 0 6px'>Retiros pendientes" + (sucursal ? " — " + _esc(sucursal) : "") + "</h3>";
  if (!pend.length) return h + "<p style='color:#1a6b3c'>Ninguno. ✅</p>";
  var rows = "<tr style='background:#f3f3f3'><th align='left'>Fecha</th><th align='left'>Usuario</th><th align='right'>Monto</th><th align='left'>Categoría</th><th align='left'>Estado</th></tr>";
  for (var i = 0; i < pend.length; i++) {
    var r = pend[i];
    rows += "<tr><td>" + _esc(r.fecha) + "</td><td>" + _esc(r.usuario) + "</td><td align='right'>" + _cajaMoney(r.monto) +
      "</td><td>" + _esc(r.categoria) + (r.motivo ? " (" + _esc(r.motivo) + ")" : "") + "</td><td>" + _esc(r.estado) + "</td></tr>";
  }
  return h + "<table style='border-collapse:collapse;font-size:13px;width:100%' border='1' cellpadding='5'>" + rows + "</table>";
}
function _cajaCorreoAperturaCierre(ss, tipo, sucursal, usuario, fisico, calc, dif, respuestas, notas) {
  var concilia = Math.abs(dif) < 0.005;
  var ahora = new Date();
  var estadoConcil = calc.sinBase
    ? "<span style='color:#b8860b;font-weight:bold'>⏳ Falta que la Dueña fije el saldo inicial</span>"
    : (concilia
      ? "<span style='color:#1a6b3c;font-weight:bold'>✅ Concilia</span>"
      : "<span style='color:#b3261e;font-weight:bold'>⚠️ Diferencia " + _cajaMoney(dif) + "</span>");
  var body = _cajaTabla(
    _cajaFila("Sucursal", _esc(sucursal)) +
    _cajaFila("Usuario", _esc(usuario)) +
    _cajaFila("Fecha", Utilities.formatDate(ahora, TZ_MX, "dd/MM/yyyy")) +
    _cajaFila("Hora", Utilities.formatDate(ahora, TZ_MX, "HH:mm")) +
    _cajaFila("Efectivo esperado (sistema)", _cajaMoney(calc.esperado)) +
    _cajaFila("Efectivo físico (contado)", _cajaMoney(fisico)) +
    _cajaFila("¿Concilia?", estadoConcil) +
    _cajaFila("Diferencia", _cajaMoney(dif))
  );
  body += "<h3 style='margin:16px 0 6px'>Cómo se calculó el esperado</h3>" + _cajaTabla(
    _cajaFila("Saldo base (último ajuste de Dueña)", _cajaMoney(calc.baseline)) +
    _cajaFila("+ Ventas en efectivo", _cajaMoney(calc.ventasEfectivo)) +
    _cajaFila("+ Aportaciones", _cajaMoney(calc.aportaciones)) +
    _cajaFila("− Retiros", _cajaMoney(calc.retiros)) +
    _cajaFila("= Esperado", _cajaMoney(calc.esperado))
  );
  if (notas) body += "<p><b>Observaciones:</b> " + _esc(notas) + "</p>";
  var extra = _cajaRespuestasHtml(respuestas);
  if (extra) body += "<h3 style='margin:16px 0 6px'>Respuestas de " + (tipo === "APERTURA" ? "apertura" : "cierre") + "</h3>" + extra;
  body += _cajaRetirosPendientesHtml(ss, sucursal);
  var asunto = (calc.sinBase ? "⏳ CONFIGURA SALDO · " : (concilia ? "" : "⚠️ DIFERENCIA DE CAJA · ")) + (tipo === "APERTURA" ? "Apertura" : "Cierre") + " " + sucursal +
    " · esperado " + (calc.sinBase ? "(sin configurar)" : _cajaMoney(calc.esperado)) + " vs físico " + _cajaMoney(fisico);
  _cajaEnviarCorreo(ss, asunto, _cajaCorreoWrap((tipo === "APERTURA" ? "Apertura" : "Cierre") + " de tienda — " + sucursal, body));
}
function _cajaCorreoCierreAuto(ss, sucursal, calc) {
  var body = "<p>La tienda de <b>" + _esc(sucursal) + "</b> se <b>cerró automáticamente</b> por inactividad (nadie hizo el cierre manual).</p>" +
    _cajaTabla(
      _cajaFila("Sucursal", _esc(sucursal)) +
      _cajaFila("Fecha", Utilities.formatDate(new Date(), TZ_MX, "dd/MM/yyyy")) +
      _cajaFila("Hora", Utilities.formatDate(new Date(), TZ_MX, "HH:mm")) +
      _cajaFila("Efectivo esperado (sistema)", _cajaMoney(calc.esperado)) +
      _cajaFila("Efectivo físico", "<span style='color:#b3261e'>No se contó (cierre automático)</span>")
    ) + _cajaRetirosPendientesHtml(ss, sucursal);
  _cajaEnviarCorreo(ss, "⚠️ Cierre AUTOMÁTICO — " + sucursal + " · esperado " + _cajaMoney(calc.esperado),
    _cajaCorreoWrap("Cierre automático de tienda — " + sucursal, body));
}
function _cajaNotificarSolicitud(ss, sucursal, usuario, monto, categoria, motivo, id) {
  try {
    ensureHojaMensajes(ss).appendRow(["MSG-" + Date.now(), "Sistema", "todos", "💸 Solicitud de retiro (" + sucursal + ")",
      usuario + " solicita retirar " + _cajaMoney(monto) + " — " + categoria + (motivo ? ": " + motivo : "") + ". Requiere autorización.",
      "retiro", false, new Date().toISOString()]);
  } catch (e) { }
  var body = "<p><b>" + _esc(usuario) + "</b> solicita un retiro en <b>" + _esc(sucursal) + "</b>.</p>" +
    _cajaTabla(_cajaFila("Monto", _cajaMoney(monto)) + _cajaFila("Categoría", _esc(categoria)) +
      (motivo ? _cajaFila("Motivo", _esc(motivo)) : "") + _cajaFila("Estado", "SOLICITADO")) +
    "<p>Autorízalo o recházalo dentro de la app (módulo <b>Control de caja</b>).</p>";
  _cajaEnviarCorreo(ss, "💸 Solicitud de retiro — " + sucursal + " (" + _cajaMoney(monto) + ")", _cajaCorreoWrap("Solicitud de retiro de efectivo", body));
}

// =================================================================================
// LOCALIZADORES / VISIBILIDAD
// =================================================================================
function _cajaFindSesionAbierta(hS, sucursal) {
  var d = hS.getDataRange().getValues();
  for (var i = d.length - 1; i >= 1; i--) { if (d[i][1] === sucursal && d[i][5] === "ABIERTA") return { fila: i + 1, row: d[i] }; }
  return null;
}
function _cajaFindRetiro(hR, id) {
  var d = hR.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) { if (d[i][0] === id) return { fila: i + 1, row: d[i] }; }
  return null;
}
function _cajaSucursalesVisibles(sesion) {
  var p = getPermisos(sesion.rol);
  if (p.puedeVerAmbas || p.esAdmin) return CAJA_SUCURSALES.slice();
  var s = getSucursalUsuario(sesion.usuario);
  if (s === "Ambas") return CAJA_SUCURSALES.slice();
  return CAJA_SUCURSALES.indexOf(s) !== -1 ? [s] : [];
}
function _cajaResolverSucursal(body, sesion) {
  var p = getPermisos(sesion.rol);
  var s = p.puedeVerAmbas ? body.sucursal : getSucursalUsuario(sesion.usuario);
  if (s === "Ambas") s = getSucursalUsuario(sesion.usuario);
  if (s === "Ambas") s = "";
  return s;
}
function _cajaRetirosPendientes(ss, sucursal) {
  var h = ss.getSheetByName("Retiros");
  if (!h) return [];
  var d = h.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    var r = d[i]; if (!r[0]) continue;
    if (sucursal && r[1] !== sucursal) continue;
    var e = r[6]; if (e === "CONCILIADO" || e === "RECHAZADO" || e === "CANCELADO") continue;
    out.push({ fecha: r[8] ? formatFechaHoraMX(new Date(r[8])) : "", usuario: r[7], monto: Number(r[4]) || 0, categoria: r[3], motivo: r[5], estado: e });
  }
  return out;
}

// =================================================================================
// ESTADO (para la UI y el gating "tienda cerrada = no operar")
// =================================================================================
function cajaEstado(body, sesion) {
  var p = getPermisos(sesion.rol);
  if (!p.cajaOperar) return { ok: true, sucursales: [], sinCaja: true }; // Cocina/Chofer no participan
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hS = ensureHojaCajaSesiones(ss);
  var vis = _cajaSucursalesVisibles(sesion);
  // No mostrar el esperado a quien cuenta el efectivo (para no sesgar el conteo).
  var puedeVerMontos = p.esAdmin || p.cajaAutorizar || p.cajaFijarSaldo || p.puedeVerHistorial;
  var sucs = [];
  for (var i = 0; i < vis.length; i++) {
    var suc = vis[i];
    var ab = _cajaFindSesionAbierta(hS, suc);
    // v7.1 — Para quien no ve montos (Vendedora/Mixto) el esperado se calculaba y
    // enseguida se tiraba, pagando el recorrido completo de la hoja Ventas. Y esta
    // llamada es justo la que traba el arranque de la app. Solo se calcula si se usa;
    // lo unico que hace falta es saber si ya hay saldo base declarado.
    var calc = puedeVerMontos ? cajaEsperado(ss, suc) : null;
    var sinBase = calc ? (calc.sinBase === true) : !_cajaBaseline(ss, suc).existe;
    var pend = _cajaRetirosPendientes(ss, suc);
    sucs.push({
      sucursal: suc, abierta: !!ab,
      aperturaPor: ab ? ab.row[6] : null, aperturaAt: ab ? ab.row[7] : null,
      esperado: puedeVerMontos ? calc.esperado : null,
      desglose: puedeVerMontos ? calc : null,
      sinBase: sinBase,
      retirosPendientes: pend.length,
      retirosPendientesMonto: pend.reduce(function (a, x) { return a + x.monto; }, 0)
    });
  }
  return {
    ok: true, sucursales: sucs, categorias: CAJA_CATEGORIAS_RETIRO,
    permisos: {
      cajaOperar: p.cajaOperar, cajaRetiroDirecto: p.cajaRetiroDirecto, cajaSolicitarRetiro: p.cajaSolicitarRetiro,
      cajaAutorizar: p.cajaAutorizar, cajaConciliar: p.cajaConciliar, cajaFijarSaldo: p.cajaFijarSaldo, puedeVerMontos: puedeVerMontos
    }
  };
}

// =================================================================================
// ABRIR / CERRAR TIENDA
// =================================================================================
function cajaAbrir(body, sesion) {
  requierePermiso(sesion, "cajaOperar", "Tu rol no permite operar la caja.");
  var sucursal = _cajaResolverSucursal(body, sesion);
  if (!sucursal) return { ok: false, error: "Especifica una sucursal (Cuajimalpa o Polanco)." };
  if (CAJA_SUCURSALES.indexOf(sucursal) === -1) return { ok: false, error: "Sucursal inválida." };
  var fisico = Number(body.efectivoFisico);
  if (isNaN(fisico) || fisico < 0) return { ok: false, error: "Captura el efectivo físico en caja (número válido)." };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hS = ensureHojaCajaSesiones(ss);
    var abierta = _cajaFindSesionAbierta(hS, sucursal);
    if (abierta) return { ok: false, error: sucursal + " ya tiene la tienda ABIERTA (desde " + formatFechaHoraMX(abierta.row[7]) + " por " + abierta.row[6] + ")." };
    var calc = cajaEsperado(ss, sucursal);
    var dif = calc.sinBase ? 0 : (fisico - calc.esperado);  // sin saldo base declarado no hay contra qué conciliar
    var id = "CJ-" + Date.now();
    var hoyStr = Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd");
    var nowIso = new Date().toISOString();
    var respuestas = (body.respuestas && typeof body.respuestas === "object") ? body.respuestas : {};
    hS.appendRow([id, sucursal, body.cajaId || "principal", body.turno || "", hoyStr, "ABIERTA", sesion.usuario, nowIso,
      fisico, calc.esperado, dif, "", "", "", "", "", JSON.stringify(respuestas), "", body.notas || ""]);
    _cajaLedger(ss, "APERTURA", sucursal, id, 0, calc.esperado, id, sesion.usuario,
      "Apertura · físico " + _cajaMoney(fisico) + " vs esperado " + _cajaMoney(calc.esperado) + " · dif " + _cajaMoney(dif));
    // Unificación: snapshot de inventario existente (best-effort, no bloquea la caja).
    try { abrirDia({ sucursal: sucursal, notas: "(apertura de caja)" }, sesion); } catch (_e) { }
    registrarAuditoria(sesion.usuario, sesion.rol, "CAJA_ABRIR", sucursal + " · físico " + _cajaMoney(fisico) + " · esperado " + _cajaMoney(calc.esperado) + " · dif " + _cajaMoney(dif));
    try { _cajaCorreoAperturaCierre(ss, "APERTURA", sucursal, sesion.usuario, fisico, calc, dif, respuestas, body.notas || ""); } catch (_e) { }
    return { ok: true, mensaje: "✅ Tienda ABIERTA en " + sucursal + ".", id: id, esperado: calc.esperado, efectivoFisico: fisico, diferencia: dif, concilia: Math.abs(dif) < 0.005 };
  } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
  finally { try { lock.releaseLock(); } catch (_e) { } }
}
function cajaCerrar(body, sesion) {
  requierePermiso(sesion, "cajaOperar", "Tu rol no permite operar la caja.");
  var sucursal = _cajaResolverSucursal(body, sesion);
  if (!sucursal) return { ok: false, error: "Especifica una sucursal." };
  var fisico = Number(body.efectivoFisico);
  if (isNaN(fisico) || fisico < 0) return { ok: false, error: "Captura el efectivo físico en caja (número válido)." };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hS = ensureHojaCajaSesiones(ss);
    var abierta = _cajaFindSesionAbierta(hS, sucursal);
    if (!abierta) return { ok: false, error: sucursal + " no tiene la tienda abierta." };
    var calc = cajaEsperado(ss, sucursal);
    var dif = calc.sinBase ? 0 : (fisico - calc.esperado);  // sin saldo base declarado no hay contra qué conciliar
    var nowIso = new Date().toISOString();
    hS.getRange(abierta.fila, 6).setValue("CERRADA");
    hS.getRange(abierta.fila, 12).setValue(sesion.usuario);   // cierre_por
    hS.getRange(abierta.fila, 13).setValue(nowIso);           // cierre_at
    hS.getRange(abierta.fila, 14).setValue(fisico);           // efectivo_fisico_fin
    hS.getRange(abierta.fila, 15).setValue(calc.esperado);    // esperado_fin
    hS.getRange(abierta.fila, 16).setValue(dif);              // dif_fin
    hS.getRange(abierta.fila, 18).setValue(JSON.stringify((body.respuestas && typeof body.respuestas === "object") ? body.respuestas : {}));
    _cajaLedger(ss, "CIERRE", sucursal, abierta.row[0], 0, calc.esperado, abierta.row[0], sesion.usuario,
      "Cierre · físico " + _cajaMoney(fisico) + " vs esperado " + _cajaMoney(calc.esperado) + " · dif " + _cajaMoney(dif));
    try { cerrarDia({ sucursal: sucursal }, sesion); } catch (_e) { }
    registrarAuditoria(sesion.usuario, sesion.rol, "CAJA_CERRAR", sucursal + " · físico " + _cajaMoney(fisico) + " · esperado " + _cajaMoney(calc.esperado) + " · dif " + _cajaMoney(dif));
    try { _cajaCorreoAperturaCierre(ss, "CIERRE", sucursal, sesion.usuario, fisico, calc, dif, body.respuestas || {}, body.notas || ""); } catch (_e) { }
    return { ok: true, mensaje: "✅ Tienda CERRADA en " + sucursal + ".", esperado: calc.esperado, efectivoFisico: fisico, diferencia: dif, concilia: Math.abs(dif) < 0.005 };
  } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
  finally { try { lock.releaseLock(); } catch (_e) { } }
}

// =================================================================================
// SALDO EN CAJA AL MOMENTO (SOLO DUEÑA) — sobrescribe el esperado (nueva base)
// =================================================================================
function cajaFijarSaldo(body, sesion) {
  requierePermiso(sesion, "cajaFijarSaldo", "Solo la Dueña puede fijar el saldo en caja.");
  var sucursal = body.sucursal;
  if (CAJA_SUCURSALES.indexOf(sucursal) === -1) return { ok: false, error: "Selecciona una sucursal válida." };
  var declarado = Number(body.monto);
  if (isNaN(declarado) || declarado < 0) return { ok: false, error: "Captura el saldo en caja (número válido)." };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
  try {
    var _opId = String(body.opId || "").trim(); var _dup = _opYaRegistrada(_opId); if (_dup) return _dup;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var espAntes = cajaEsperado(ss, sucursal).esperado;
    var delta = declarado - espAntes;
    // Se guarda el acumulado de ventas en efectivo de ESTE momento: es el punto de
    // corte contra el que se miden las ventas siguientes (sin depender de fechas).
    var ventasAcum = _cajaSumaVentasEfectivo(ss, sucursal);
    _cajaLedger(ss, "OVERRIDE_DUEÑA", sucursal, "", delta, declarado, "OVERRIDE", sesion.usuario,
      (body.motivo || "Saldo en caja fijado por la Dueña") + " · antes " + _cajaMoney(espAntes) + " → " + _cajaMoney(declarado), ventasAcum);
    registrarAuditoria(sesion.usuario, sesion.rol, "CAJA_FIJAR_SALDO", sucursal + " · " + _cajaMoney(espAntes) + " → " + _cajaMoney(declarado) + " (Δ" + _cajaMoney(delta) + ")");
    var _res = { ok: true, mensaje: "✅ Saldo de caja fijado en " + _cajaMoney(declarado) + " para " + sucursal + ".", esperado: declarado, ajuste: delta };
    _opRegistrar(_opId, _res);
    return _res;
  } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
  finally { try { lock.releaseLock(); } catch (_e) { } }
}

// =================================================================================
// APORTACIÓN DE EFECTIVO (entra dinero a la caja)
// =================================================================================
function cajaAportacion(body, sesion) {
  requierePermiso(sesion, "cajaOperar", "Tu rol no permite operar la caja.");
  var sucursal = _cajaResolverSucursal(body, sesion) || getSucursalUsuario(sesion.usuario);
  if (CAJA_SUCURSALES.indexOf(sucursal) === -1) return { ok: false, error: "Sucursal inválida." };
  var monto = Number(body.monto);
  if (isNaN(monto) || monto <= 0) return { ok: false, error: "El monto de la aportación debe ser mayor a 0." };
  var motivo = String(body.motivo || "").trim();
  if (!motivo) return { ok: false, error: "Describe el motivo de la aportación." };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
  try {
    var _opId = String(body.opId || "").trim(); var _dup = _opYaRegistrada(_opId); if (_dup) return _dup;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var espAntes = cajaEsperado(ss, sucursal).esperado;
    _cajaLedger(ss, "APORTACION", sucursal, "", monto, espAntes + monto, "APORTACION", sesion.usuario, motivo);
    registrarAuditoria(sesion.usuario, sesion.rol, "CAJA_APORTACION", sucursal + " · " + _cajaMoney(monto) + " · " + motivo);
    var _res = { ok: true, mensaje: "✅ Aportación registrada (" + _cajaMoney(monto) + ").", esperado: espAntes + monto };
    _opRegistrar(_opId, _res);
    return _res;
  } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
  finally { try { lock.releaseLock(); } catch (_e) { } }
}

// =================================================================================
// RETIROS — máquina de estados:
//   Vendedora:   SOLICITADO → (autorizar) ENTREGADO → (evidencia) COMPROBADO → (conciliar) CONCILIADO
//   Dueña/Admin: (retiro directo)          ENTREGADO → (evidencia) COMPROBADO → (conciliar) CONCILIADO
//                SOLICITADO → (rechazar) RECHAZADO
//   * Autorizar = liberar el efectivo (asienta el RETIRO en el ledger). Trazable: queda
//     autorizado_por/at y entregado_at. Subir comprobante NO concilia: solo Dueña/Admin.
// =================================================================================
function retiroRegistrar(body, sesion) {
  var p = getPermisos(sesion.rol);
  if (!p.cajaRetiroDirecto && !p.cajaSolicitarRetiro) throw new Error("Tu rol no permite retirar ni solicitar efectivo.");
  var sucursal = _cajaResolverSucursal(body, sesion) || getSucursalUsuario(sesion.usuario);
  if (CAJA_SUCURSALES.indexOf(sucursal) === -1) return { ok: false, error: "Sucursal inválida." };
  var monto = Number(body.monto);
  if (isNaN(monto) || monto <= 0) return { ok: false, error: "El monto del retiro debe ser mayor a 0." };
  var categoria = String(body.categoria || "").trim();
  if (CAJA_CATEGORIAS_RETIRO.indexOf(categoria) === -1) return { ok: false, error: "Selecciona una categoría de retiro válida." };
  var motivo = String(body.motivo || "").trim();
  if (categoria === "Otro" && !motivo) return { ok: false, error: "Describe el motivo del retiro (categoría Otro)." };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
  try {
    var _opId = String(body.opId || "").trim(); var _dup = _opYaRegistrada(_opId); if (_dup) return _dup;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hR = ensureHojaRetiros(ss);
    var id = "RET-" + Date.now();
    var nowIso = new Date().toISOString();
    var directo = p.cajaRetiroDirecto;
    var estado = directo ? "ENTREGADO" : "SOLICITADO";
    hR.appendRow([id, sucursal, "", categoria, monto, motivo, estado, sesion.usuario, nowIso,
      directo ? sesion.usuario : "", directo ? nowIso : "", directo ? nowIso : "", "", "", 0, body.notas || ""]);
    if (directo) {
      var espAntes = cajaEsperado(ss, sucursal).esperado;
      _cajaLedger(ss, "RETIRO", sucursal, "", -monto, espAntes - monto, id, sesion.usuario, categoria + (motivo ? " · " + motivo : ""));
    }
    registrarAuditoria(sesion.usuario, sesion.rol, directo ? "CAJA_RETIRO_DIRECTO" : "CAJA_RETIRO_SOLICITUD",
      sucursal + " · " + _cajaMoney(monto) + " · " + categoria + (motivo ? " · " + motivo : ""));
    if (!directo) { try { _cajaNotificarSolicitud(ss, sucursal, sesion.usuario, monto, categoria, motivo, id); } catch (_e) { } }
    var _res = directo
      ? { ok: true, mensaje: "✅ Retiro registrado (" + _cajaMoney(monto) + "). Sube la evidencia para completarlo.", id: id, estado: estado, requiereEvidencia: true }
      : { ok: true, mensaje: "📩 Solicitud enviada (" + _cajaMoney(monto) + "). Espera autorización de la Dueña/Administradora.", id: id, estado: estado };
    _opRegistrar(_opId, _res);
    return _res;
  } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
  finally { try { lock.releaseLock(); } catch (_e) { } }
}
function retiroAutorizar(body, sesion) {
  requierePermiso(sesion, "cajaAutorizar", "Tu rol no permite autorizar retiros.");
  var id = String(body.id || ""); if (!id) return { ok: false, error: "Falta el id del retiro." };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hR = ensureHojaRetiros(ss);
    var f = _cajaFindRetiro(hR, id); if (!f) return { ok: false, error: "Retiro no encontrado." };
    if (f.row[6] !== "SOLICITADO") return { ok: false, error: "Solo se autoriza un retiro en estado SOLICITADO (está " + f.row[6] + ")." };
    var sucursal = f.row[1], monto = Number(f.row[4]) || 0, nowIso = new Date().toISOString();
    hR.getRange(f.fila, 7).setValue("ENTREGADO");
    hR.getRange(f.fila, 10).setValue(sesion.usuario); // autorizado_por
    hR.getRange(f.fila, 11).setValue(nowIso);          // autorizado_at
    hR.getRange(f.fila, 12).setValue(nowIso);          // entregado_at
    var espAntes = cajaEsperado(ss, sucursal).esperado;
    _cajaLedger(ss, "RETIRO", sucursal, "", -monto, espAntes - monto, id, sesion.usuario,
      (f.row[3] || "") + (f.row[5] ? " · " + f.row[5] : "") + " · autorizó " + sesion.usuario);
    registrarAuditoria(sesion.usuario, sesion.rol, "CAJA_RETIRO_AUTORIZAR", id + " · " + sucursal + " · " + _cajaMoney(monto));
    try {
      ensureHojaMensajes(ss).appendRow(["MSG-" + Date.now(), "Sistema", f.row[7], "✅ Retiro autorizado",
        "Tu retiro de " + _cajaMoney(monto) + " (" + f.row[3] + ") fue autorizado por " + sesion.usuario + ". Sube la evidencia.", "retiro", false, new Date().toISOString()]);
    } catch (e) { }
    return { ok: true, mensaje: "✅ Retiro autorizado y entregado. Falta subir la evidencia.", estado: "ENTREGADO" };
  } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
  finally { try { lock.releaseLock(); } catch (_e) { } }
}
function retiroRechazar(body, sesion) {
  requierePermiso(sesion, "cajaAutorizar", "Tu rol no permite rechazar retiros.");
  var id = String(body.id || ""); if (!id) return { ok: false, error: "Falta el id del retiro." };
  var motivo = String(body.motivo || "").trim();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hR = ensureHojaRetiros(ss);
    var f = _cajaFindRetiro(hR, id); if (!f) return { ok: false, error: "Retiro no encontrado." };
    if (f.row[6] !== "SOLICITADO") return { ok: false, error: "Solo se rechaza un retiro SOLICITADO (está " + f.row[6] + ")." };
    hR.getRange(f.fila, 7).setValue("RECHAZADO");
    hR.getRange(f.fila, 16).setValue((f.row[15] ? f.row[15] + " | " : "") + "Rechazado por " + sesion.usuario + (motivo ? ": " + motivo : ""));
    registrarAuditoria(sesion.usuario, sesion.rol, "CAJA_RETIRO_RECHAZAR", id + " · " + f.row[1] + (motivo ? " · " + motivo : ""));
    try {
      ensureHojaMensajes(ss).appendRow(["MSG-" + Date.now(), "Sistema", f.row[7], "❌ Retiro rechazado",
        "Tu retiro de " + _cajaMoney(Number(f.row[4]) || 0) + " (" + f.row[3] + ") fue rechazado por " + sesion.usuario + (motivo ? ": " + motivo : "") + ".", "retiro", false, new Date().toISOString()]);
    } catch (e) { }
    return { ok: true, mensaje: "Retiro rechazado.", estado: "RECHAZADO" };
  } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
  finally { try { lock.releaseLock(); } catch (_e) { } }
}
function retiroSubirEvidencia(body, sesion) {
  requierePermiso(sesion, "cajaOperar", "Tu rol no permite operar la caja.");
  var id = String(body.id || "");
  var archivos = Array.isArray(body.archivos) ? body.archivos : (body.archivo ? [body.archivo] : []);
  if (!id) return { ok: false, error: "Falta el id del retiro." };
  if (!archivos.length) return { ok: false, error: "Adjunta al menos un archivo (foto o PDF)." };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hR = ensureHojaRetiros(ss);
    var f = _cajaFindRetiro(hR, id); if (!f) return { ok: false, error: "Retiro no encontrado." };
    var estado = f.row[6];
    if (estado === "RECHAZADO" || estado === "CANCELADO") return { ok: false, error: "El retiro está " + estado + "." };
    if (f.row[7] !== sesion.usuario && !getPermisos(sesion.rol).cajaAutorizar) return { ok: false, error: "Solo quien hizo el retiro o un administrador puede subir evidencia." };
    var hE = ensureHojaRetirosEvidencias(ss);
    var folioBase = Number(f.row[14]) || 0, guardadas = 0;
    for (var i = 0; i < archivos.length; i++) {
      var g = _cajaGuardarEvidencia(archivos[i], id, folioBase + i + 1);
      if (!g) continue;
      hE.appendRow(["EV-" + Date.now() + "-" + i, id, g.tipo, g.url, "", sesion.usuario, new Date().toISOString()]);
      guardadas++;
    }
    if (!guardadas) return { ok: false, error: "No se pudo procesar la evidencia (formato no válido)." };
    var total = folioBase + guardadas;
    hR.getRange(f.fila, 15).setValue(total);
    var nuevoEstado = estado;
    if (estado === "ENTREGADO") { hR.getRange(f.fila, 7).setValue("COMPROBADO"); nuevoEstado = "COMPROBADO"; }
    registrarAuditoria(sesion.usuario, sesion.rol, "CAJA_RETIRO_EVIDENCIA", id + " · +" + guardadas + " archivo(s)");
    return { ok: true, mensaje: "✅ Evidencia subida (" + guardadas + ").", evidencias: total, estado: nuevoEstado };
  } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
  finally { try { lock.releaseLock(); } catch (_e) { } }
}
function retiroConciliar(body, sesion) {
  requierePermiso(sesion, "cajaConciliar", "Solo la Dueña o la Administradora concilian retiros.");
  var id = String(body.id || ""); if (!id) return { ok: false, error: "Falta el id del retiro." };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hR = ensureHojaRetiros(ss);
    var f = _cajaFindRetiro(hR, id); if (!f) return { ok: false, error: "Retiro no encontrado." };
    if (f.row[6] !== "COMPROBADO") return { ok: false, error: "Solo se concilia un retiro con evidencia (estado COMPROBADO). Actual: " + f.row[6] + "." };
    hR.getRange(f.fila, 7).setValue("CONCILIADO");
    hR.getRange(f.fila, 13).setValue(sesion.usuario);            // conciliado_por
    hR.getRange(f.fila, 14).setValue(new Date().toISOString());  // conciliado_at
    registrarAuditoria(sesion.usuario, sesion.rol, "CAJA_RETIRO_CONCILIAR", id + " · " + f.row[1] + " · " + _cajaMoney(Number(f.row[4]) || 0));
    return { ok: true, mensaje: "✅ Retiro conciliado.", estado: "CONCILIADO" };
  } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
  finally { try { lock.releaseLock(); } catch (_e) { } }
}
function getRetiros(body, sesion) {
  requierePermiso(sesion, "cajaOperar", "Tu rol no permite ver la caja.");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hR = ensureHojaRetiros(ss);
  var vis = _cajaSucursalesVisibles(sesion);
  var soloPend = body && body.soloPendientes;
  var filtroSuc = body && body.sucursal;
  var d = hR.getDataRange().getValues();
  var hE = ss.getSheetByName("Retiros_Evidencias");
  var evAll = hE ? hE.getDataRange().getValues() : [];
  var out = [];
  for (var i = d.length - 1; i >= 1; i--) {
    var r = d[i]; if (!r[0]) continue;
    if (vis.indexOf(r[1]) === -1) continue;
    if (filtroSuc && r[1] !== filtroSuc) continue;
    var estado = r[6];
    if (soloPend && (estado === "CONCILIADO" || estado === "RECHAZADO" || estado === "CANCELADO")) continue;
    var evs = [];
    for (var j = 1; j < evAll.length; j++) { if (evAll[j][1] === r[0]) evs.push({ tipo: evAll[j][2], url: evAll[j][3], subidoPor: evAll[j][5], subidoAt: evAll[j][6] }); }
    out.push({
      id: r[0], sucursal: r[1], categoria: r[3], monto: Number(r[4]) || 0, motivo: r[5], estado: estado,
      solicitadoPor: r[7], solicitadoAt: r[8], autorizadoPor: r[9], autorizadoAt: r[10], entregadoAt: r[11],
      conciliadoPor: r[12], conciliadoAt: r[13], evidenciasCount: Number(r[14]) || 0, evidencias: evs, notas: r[15]
    });
    if (out.length >= 200) break;
  }
  return { ok: true, retiros: out, categorias: CAJA_CATEGORIAS_RETIRO };
}
// Evidencia como expediente: base64 (foto/imagen o PDF) → carpeta Drive "TV_Caja_Evidencias".
// Preparado para folios físicos (columna `folio` de Retiros_Evidencias) más adelante.
function _cajaGuardarEvidencia(dataUrl, retiroId, idx) {
  try {
    var m = /^data:([a-zA-Z0-9.+\/-]+);base64,([\s\S]*)$/.exec(String(dataUrl || ""));
    if (!m) return null;
    var mime = m[1], b64 = m[2];
    var bytes = Utilities.base64Decode(b64);
    var esPdf = mime.indexOf("pdf") >= 0;
    var ext = esPdf ? "pdf" : (mime.indexOf("png") >= 0 ? "png" : (mime.indexOf("webp") >= 0 ? "webp" : "jpg"));
    var blob = Utilities.newBlob(bytes, mime, retiroId + "-" + idx + "." + ext);
    var it = DriveApp.getFoldersByName("TV_Caja_Evidencias");
    var folder = it.hasNext() ? it.next() : DriveApp.createFolder("TV_Caja_Evidencias");
    var file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
    return { url: file.getUrl(), tipo: esPdf ? "pdf" : "imagen" };
  } catch (e) { return null; }
}

// =================================================================================
// CIERRE AUTOMÁTICO POR INACTIVIDAD (trigger cada 30 min)
// =================================================================================
function instalarCierreAutoCaja() {
  var ya = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ya.length; i++) { if (ya[i].getHandlerFunction() === "cierreAutoCaja") ScriptApp.deleteTrigger(ya[i]); }
  ScriptApp.newTrigger("cierreAutoCaja").timeBased().everyMinutes(30).create();
  var msg = "✅ Trigger de cierre automático de caja instalado (cada 30 min).";
  Logger.log(msg);  // sin getUi().alert(): bloquea la ejecución al correr desde el editor
  return msg;
}
function _cajaCombinarHora(base, horaStr) {
  var p = String(horaStr || "19:00").split(":");
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), Number(p[0]) || 0, Number(p[1]) || 0, 0);
}
function _cajaUltimaActividad(ss, sucursal) {
  var h = ss.getSheetByName("Sesiones_Activas");
  if (!h) return null;
  var d = h.getDataRange().getValues(), max = null;
  for (var i = 1; i < d.length; i++) {
    if (d[i][3] !== sucursal) continue;            // sucursal (col D)
    var t = d[i][6] ? new Date(d[i][6]) : null;    // ultimoAcceso (col G)
    if (t && (!max || t > max)) max = t;
  }
  return max;
}
function cierreAutoCaja() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hS = ensureHojaCajaSesiones(ss);
  var margenH = Number(_cfgVal(ss, "caja_cierre_auto_margen_horas", 2)) || 2;
  var inactMin = Number(_cfgVal(ss, "caja_cierre_auto_inactividad_min", 90)) || 90;
  var ahora = new Date();
  for (var s = 0; s < CAJA_SUCURSALES.length; s++) {
    var sucursal = CAJA_SUCURSALES[s];
    var ab = _cajaFindSesionAbierta(hS, sucursal);
    if (!ab) continue;
    var horario = getHorarioHoy(sucursal, ahora);
    var cierre = _cajaCombinarHora(ahora, horario.cierra);
    var pasoCierre = ahora.getTime() > (cierre.getTime() + margenH * 3600000);
    var ultAct = _cajaUltimaActividad(ss, sucursal);
    var inactivo = !ultAct || ((ahora.getTime() - ultAct.getTime()) / 60000 > inactMin);
    if (!pasoCierre || !inactivo) continue;
    var calc = cajaEsperado(ss, sucursal);
    hS.getRange(ab.fila, 6).setValue("CERRADA_AUTO");
    hS.getRange(ab.fila, 12).setValue("Sistema");                 // cierre_por
    hS.getRange(ab.fila, 13).setValue(ahora.toISOString());       // cierre_at
    hS.getRange(ab.fila, 15).setValue(calc.esperado);             // esperado_fin
    hS.getRange(ab.fila, 19).setValue((ab.row[18] ? ab.row[18] + " | " : "") + "Cierre automático por inactividad");
    _cajaLedger(ss, "CIERRE_AUTO", sucursal, ab.row[0], 0, calc.esperado, ab.row[0], "Sistema", "Cierre automático por inactividad");
    try { registrarAuditoria("Sistema", "-", "CAJA_CIERRE_AUTO", sucursal + " · esperado " + _cajaMoney(calc.esperado)); } catch (e) { }
    try { _cajaCorreoCierreAuto(ss, sucursal, calc); } catch (e) { }
    try { cerrarDia({ sucursal: sucursal }, { usuario: "Sistema", rol: "Owner", sucursal: sucursal }); } catch (e) { }
  }
}
