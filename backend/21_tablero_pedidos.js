// ============================================================================
// v9 — TABLERO DE PEDIDOS (pestaña "Tablero_Pedidos" de la hoja del sistema)
//
// Un solo lugar donde caen TODOS los pedidos, vengan de donde vengan: el bot de Instagram, la tienda en línea
// (Shopify), el teléfono, el mostrador u otras fuentes. Es una vista de solo lectura que se reconstruye sola a partir
// de la hoja Ventas (la fuente de verdad); no se edita a mano.
//
// - Un pedido por renglón, con estado, origen, cliente, contacto, piezas, total, pago, entrega y quién lo confirma.
// - Primero lo que falta por confirmar, luego lo confirmado, al final lo entregado y lo no recogido (últimos días).
// - Los pedidos que no traen referencia (Shopify, teléfono, mostrador) la reciben aquí: así todos se pueden nombrar igual.
// - Se actualiza cada TABLERO_MINUTOS_ACTUALIZACION min (instalarTableroPedidos) y al instante cuando alguien confirma,
//   entrega o marca "no llegó" desde el sistema.
// ============================================================================

function _tableroFecha(valor, formato) {
  return valor instanceof Date ? Utilities.formatDate(valor, TZ_MX, formato) : String(valor || "");
}

// Teléfono de cada cliente (hoja Clientes: ID, Nombre, Teléfono, ...).
function _tableroTelefonos(ss) {
  const mapa = {};
  const hoja = ss.getSheetByName("Clientes");
  if (!hoja || hoja.getLastRow() < 2) return mapa;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 3).getValues().forEach(function (f) { if (f[0] && f[2]) mapa[String(f[0])] = String(f[2]); });
  return mapa;
}

function _tableroOrigen(fila, idx) {
  const marcado = String(fila[idx.origen_pedido] || "");
  if (marcado) return marcado;
  const notas = String(fila[14] || ""), metodo = String(fila[10] || ""), canal = String(fila[9] || "");
  if (metodo === "Shopify" || notas.indexOf("Pedido en línea") !== -1) return "Shopify";
  if (canal === "Apartado" || canal === "Reservado") return "Teléfono o mostrador";
  return "Otro";
}

// Cómo pagó o va a pagar: los pedidos del bot lo traen en la nota ("Pago: transferencia").
function _tableroPago(fila) {
  const m = String(fila[14] || "").match(/Pago: (\w+)/);
  return m ? m[1] : String(fila[10] || "");
}

function _tableroEsCerradoReciente(estado, fechaEntrega, limiteIso) {
  return (estado === PEDIDO_ESTADO.ENTREGADO || estado === PEDIDO_ESTADO.NO_RECOGIDO) && fechaEntrega >= limiteIso;
}

function _tableroOrdenar(a, b) {
  const rango = function (e) { return e === PEDIDO_ESTADO.POR_CONFIRMAR || e === PEDIDO_ESTADO.APARTADO ? 0 : e === PEDIDO_ESTADO.CONFIRMADO ? 1 : 2; };
  const dif = rango(a.estado) - rango(b.estado);
  if (dif) return dif;
  const porFecha = String(a.fechaEntrega || "9999").localeCompare(String(b.fechaEntrega || "9999"));
  // Lo pendiente: lo más próximo primero. Lo cerrado: lo más reciente primero.
  return (rango(a.estado) === 2 ? -porFecha : porFecha) || String(a.llego).localeCompare(String(b.llego));
}

function _tableroLeerPedidos(ss, hoja, idx) {
  const ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  const desde = Math.max(2, ultima - TABLERO_VENTANA_FILAS + 1);
  const valores = hoja.getRange(desde, 1, ultima - desde + 1, hoja.getLastColumn()).getValues();
  const telefonos = _tableroTelefonos(ss);
  const idxEnvio = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].indexOf("envio_monto");
  const limite = new Date(); limite.setDate(limite.getDate() - TABLERO_DIAS_CERRADOS);
  const limiteIso = Utilities.formatDate(limite, TZ_MX, "yyyy-MM-dd");
  const grupos = {}, orden = [];
  valores.forEach(function (f) {
    const estado = _pedidoEstadoDe(f, idx);
    const abierto = (estado === PEDIDO_ESTADO.APARTADO || estado === PEDIDO_ESTADO.POR_CONFIRMAR || estado === PEDIDO_ESTADO.CONFIRMADO) && f[idx.tipo] === "Reservado";
    const fechaEntrega = idx.fechaEntrega !== -1 ? _tableroFecha(f[idx.fechaEntrega], "yyyy-MM-dd").substring(0, 10) : "";
    if (!abierto && !_tableroEsCerradoReciente(estado, fechaEntrega, limiteIso)) return;
    const id = String(f[0]);
    if (!grupos[id]) {
      grupos[id] = { idVenta: id, referencia: String(f[idx.referencia] || ""), estado: estado, origen: _tableroOrigen(f, idx), cliente: String(f[12] || ""),
        contacto: String(f[idx.contacto_seguimiento] || "") || telefonos[String(f[11])] || "", pago: _tableroPago(f), canal: String(f[9] || ""), sucursal: String(f[3] || ""),
        fechaEntrega: fechaEntrega, llego: _tableroFecha(f[1], "yyyy-MM-dd HH:mm"), items: [], total: Number(idxEnvio !== -1 ? f[idxEnvio] : 0) || 0 };
      orden.push(id);
    }
    grupos[id].items.push((Number(f[6]) || 0) + " " + f[4] + " " + f[5]);
    grupos[id].total += Number(f[8]) || 0;
  });
  return orden.map(function (id) { return grupos[id]; }).sort(_tableroOrdenar);
}

// Los pedidos sin referencia (Shopify, teléfono, mostrador) la reciben aquí. Se limita por corrida para no pasarse de tiempo.
function _tableroAsignarReferencias(ss, pedidos) {
  let asignadas = 0;
  pedidos.forEach(function (p) {
    if (p.referencia || asignadas >= TABLERO_MAX_ASIGNACIONES) return;
    const estado = p.origen === "Shopify" ? PEDIDO_ESTADO.POR_CONFIRMAR : PEDIDO_ESTADO.APARTADO;
    p.referencia = pedidoAnotar(ss, p.idVenta, { estado: estado, contacto: p.contacto, origen: p.origen });
    if (p.referencia) { p.estado = estado; asignadas++; }
  });
  return asignadas;
}

function _tableroFila(p) {
  const domicilio = p.canal === BOT_CANAL_DOMICILIO;
  return [p.referencia || "—", p.estado, p.origen, p.cliente, p.contacto, p.items.join(" + "), p.total, p.pago, domicilio ? "Domicilio" : "Recoger", p.sucursal, p.fechaEntrega, p.llego,
    p.estado === PEDIDO_ESTADO.POR_CONFIRMAR || p.estado === PEDIDO_ESTADO.APARTADO || p.estado === PEDIDO_ESTADO.CONFIRMADO ? _pedidoQuienGestiona({ canal: p.canal, sucursal: p.sucursal }) : ""];
}

function _tableroPrepararHoja(ss) {
  let hoja = ss.getSheetByName(TABLERO_HOJA);
  if (hoja) return hoja;
  hoja = ss.insertSheet(TABLERO_HOJA);
  hoja.setTabColor("#b08a4a");
  hoja.getRange(1, 1, 1, TABLERO_ENCABEZADO.length).setValues([TABLERO_ENCABEZADO]).setFontWeight("bold").setBackground("#2E4756").setFontColor("#FFFFFF");
  hoja.setFrozenRows(1);
  const rango = hoja.getRange(2, 1, 1000, TABLERO_ENCABEZADO.length);
  const regla = function (texto, color) { return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT($B2,' + texto.length + ')="' + texto + '"').setBackground(color).setRanges([rango]).build(); };
  hoja.setConditionalFormatRules([regla(PEDIDO_ESTADO.POR_CONFIRMAR, "#fff0c9"), regla(PEDIDO_ESTADO.APARTADO, "#fff0c9"), regla(PEDIDO_ESTADO.CONFIRMADO, "#d6efdc"), regla(PEDIDO_ESTADO.ENTREGADO, "#cfe3f5"), regla(PEDIDO_ESTADO.NO_RECOGIDO, "#f6d4cf")]);
  [110, 110, 130, 150, 150, 320, 70, 100, 90, 100, 110, 130, 220].forEach(function (ancho, i) { hoja.setColumnWidth(i + 1, ancho); });
  hoja.getRange(1, 1, 1, TABLERO_ENCABEZADO.length).createFilter();
  return hoja;
}

// Reconstruye la pestaña. Seguro de correr varias veces; si ya hay una corrida en marcha, no empieza otra.
function tableroPedidosActualizar() {
  const cache = CacheService.getScriptCache();
  if (cache.get("tablero_corriendo")) return { ok: true, omitido: "ya hay una actualización en marcha" };
  cache.put("tablero_corriendo", "1", 120);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    _pedidoAsegurarColumnas(ss);
    const ventas = ss.getSheetByName("Ventas");
    const idx = _pedidoIndices(ventas);
    const pedidos = _tableroLeerPedidos(ss, ventas, idx);
    const asignadas = _tableroAsignarReferencias(ss, pedidos);
    const hoja = _tableroPrepararHoja(ss);
    const filas = pedidos.map(_tableroFila);
    const anteriores = Math.max(hoja.getLastRow() - 1, 0);
    if (filas.length) {
      hoja.getRange(2, 1, filas.length, TABLERO_ENCABEZADO.length).setValues(filas);
      hoja.getRange(2, 11, filas.length, 1).setNumberFormat("ddd dd/MM");
      hoja.getRange(2, 12, filas.length, 1).setNumberFormat("dd/MM HH:mm");
    }
    if (anteriores > filas.length) hoja.getRange(2 + filas.length, 1, anteriores - filas.length, TABLERO_ENCABEZADO.length).clearContent();
    hoja.getRange(1, TABLERO_ENCABEZADO.length + 2).setValue("Actualizado " + Utilities.formatDate(new Date(), TZ_MX, "dd/MM HH:mm") + " · " + filas.length + " pedidos");
    return { ok: true, pedidos: filas.length, referenciasNuevas: asignadas };
  } finally { cache.remove("tablero_corriendo"); }
}

// Un pedido nuevo del bot entra al tablero al instante con UN solo renglón arriba (la reconstrucción completa tarda 2-4 s,
// demasiado para el turno que ManyChat espera). La revisión de cada 5 min lo reacomoda con el resto.
function tableroAgregarPedidoNuevo(pedido) {
  const hoja = _tableroPrepararHoja(SpreadsheetApp.getActiveSpreadsheet());
  hoja.insertRowBefore(2);
  hoja.getRange(2, 1, 1, TABLERO_ENCABEZADO.length).setValues([_tableroFila(pedido)]);
  hoja.getRange(2, 11, 1, 1).setNumberFormat("ddd dd/MM");
  hoja.getRange(2, 12, 1, 1).setNumberFormat("dd/MM HH:mm");
}

// Para llamarla después de confirmar, entregar o marcar "no llegó": no repite si acaba de correr.
function _tableroRefrescarSiHaceFalta() {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get("tablero_reciente")) return;
    cache.put("tablero_reciente", "1", 20);
    tableroPedidosActualizar();
  } catch (e) { Logger.log("Tablero: " + e); }
}

// Correr UNA vez desde el editor.
function instalarTableroPedidos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "tableroPedidosActualizar") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("tableroPedidosActualizar").timeBased().everyMinutes(TABLERO_MINUTOS_ACTUALIZACION).create();
}
