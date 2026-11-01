// ============================================================================
// v9 — TABLERO DE PEDIDOS (pestañas "Tablero_Pedidos" y "Pedidos <sucursal>" de la hoja del sistema)
//
// Un solo lugar donde caen TODOS los pedidos, vengan de donde vengan: el bot de Instagram, la tienda en línea
// (Shopify), el teléfono, el mostrador u otras fuentes. Son vistas que se reconstruyen solas a partir de la hoja
// Ventas (la fuente de verdad); no se editan a mano.
//
// - Tablero_Pedidos trae todos; "Pedidos Bosques", "Pedidos Cuajimalpa" y "Pedidos Polanco" traen solo los de esa sucursal
//   (los de domicilio salen de la cocina, así que viven en Bosques).
// - Un pedido por renglón, con estado, origen, cliente, contacto, piezas, total, pago, entrega, hora y quién lo confirma.
// - Primero lo que falta por confirmar, luego lo confirmado, al final lo entregado y lo no recogido (últimos días).
// - Los pedidos que no traen referencia (Shopify, teléfono, mostrador) la reciben aquí: así todos se pueden nombrar igual.
// - Se reconstruyen cada TABLERO_MINUTOS_ACTUALIZACION min (instalarTableroPedidos). Un pedido nuevo del bot entra al
//   instante, y confirmar, entregar o marcar "no llegó" cambia el estado de su renglón al instante.
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

// A qué hora pasa por su pedido: los pedidos del bot la traen en la nota ("Hora: 18:30").
function _tableroHora(fila) {
  const m = String(fila[14] || "").match(/Hora: (\d{1,2}:\d{2})/);
  return m ? m[1] : "";
}

function _tableroEsCerradoReciente(estado, fechaEntrega, limiteIso) {
  return (estado === PEDIDO_ESTADO.ENTREGADO || estado === PEDIDO_ESTADO.NO_RECOGIDO) && fechaEntrega >= limiteIso;
}

function _tableroOrdenar(a, b) {
  const rango = function (e) { return e === PEDIDO_ESTADO.POR_CONFIRMAR || e === PEDIDO_ESTADO.APARTADO || e === PEDIDO_ESTADO.POR_REVISAR ? 0 : e === PEDIDO_ESTADO.CONFIRMADO ? 1 : 2; };
  const dif = rango(a.estado) - rango(b.estado);
  if (dif) return dif;
  const porFecha = String(a.fechaEntrega || "9999").localeCompare(String(b.fechaEntrega || "9999"));
  // Lo pendiente: lo más próximo primero. Lo cerrado: lo más reciente primero.
  return (rango(a.estado) === 2 ? -porFecha : porFecha) || String(a.hora).localeCompare(String(b.hora)) || String(a.llego).localeCompare(String(b.llego));
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
    const abierto = PEDIDO_ESTADOS_ABIERTOS.indexOf(estado) !== -1 && f[idx.tipo] === "Reservado";
    const fechaEntrega = idx.fechaEntrega !== -1 ? _tableroFecha(f[idx.fechaEntrega], "yyyy-MM-dd").substring(0, 10) : "";
    if (!abierto && !_tableroEsCerradoReciente(estado, fechaEntrega, limiteIso)) return;
    const id = String(f[0]);
    if (!grupos[id]) {
      grupos[id] = { idVenta: id, referencia: String(f[idx.referencia] || ""), estado: estado, origen: _tableroOrigen(f, idx), cliente: String(f[12] || ""),
        contacto: String(f[idx.contacto_seguimiento] || "") || telefonos[String(f[11])] || "", pago: _tableroPago(f), canal: String(f[9] || ""), sucursal: String(f[3] || ""),
        fechaEntrega: fechaEntrega, hora: _tableroHora(f), llego: _tableroFecha(f[1], "yyyy-MM-dd HH:mm"), items: [], total: Number(idxEnvio !== -1 ? f[idxEnvio] : 0) || 0 };
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
  return [p.referencia || "—", p.estado, p.origen, p.cliente, p.contacto, p.items.join(" + "), p.total, p.pago, domicilio ? "Domicilio" : "Recoger", p.sucursal, p.fechaEntrega, p.hora || "", p.llego,
    PEDIDO_ESTADOS_ABIERTOS.indexOf(p.estado) !== -1 ? _pedidoQuienGestiona({ canal: p.canal, sucursal: p.sucursal }) : ""];
}

// Nombres de todas las pestañas del tablero: la general y una por sucursal.
function _tableroNombresHojas() {
  return [TABLERO_HOJA].concat(SUCURSALES.map(function (s) { return TABLERO_PREFIJO_SUCURSAL + s; }));
}

function _tableroPrepararHoja(ss, nombre) {
  let hoja = ss.getSheetByName(nombre);
  if (hoja) return hoja;
  hoja = ss.insertSheet(nombre);
  hoja.setTabColor(nombre === TABLERO_HOJA ? "#b08a4a" : "#2E4756");
  hoja.getRange(1, 1, 1, TABLERO_ENCABEZADO.length).setValues([TABLERO_ENCABEZADO]).setFontWeight("bold").setBackground("#2E4756").setFontColor("#FFFFFF");
  hoja.setFrozenRows(1);
  [110, 110, 130, 150, 150, 320, 70, 100, 90, 100, 110, 60, 130, 220].forEach(function (ancho, i) { hoja.setColumnWidth(i + 1, ancho); });
  hoja.getRange(1, 1, 1, TABLERO_ENCABEZADO.length).createFilter();
  return hoja;
}

// Color por estado y, en las pestañas por sucursal, el menú de Estado (confirmar, entregar, no llegó) para quien atiende.
function _tableroFormatoEstado(hoja, conMenu) {
  const rango = hoja.getRange(2, 1, 1000, TABLERO_ENCABEZADO.length);
  const regla = function (texto, color) { return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT($B2,' + texto.length + ')="' + texto + '"').setBackground(color).setRanges([rango]).build(); };
  hoja.setConditionalFormatRules([regla(PEDIDO_ESTADO.POR_REVISAR, "#e8d3f0"), regla(PEDIDO_ESTADO.POR_CONFIRMAR, "#fff0c9"), regla(PEDIDO_ESTADO.APARTADO, "#fff0c9"), regla(PEDIDO_ESTADO.CONFIRMADO, "#d6efdc"), regla(PEDIDO_ESTADO.ENTREGADO, "#cfe3f5"), regla(PEDIDO_ESTADO.NO_RECOGIDO, "#f6d4cf")]);
  if (conMenu) hoja.getRange(2, 2, 1000, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PEDIDO_ESTADOS_HOJA, true).setAllowInvalid(true).build());
}

// Escribe las filas en una pestaña y borra lo que sobre de la corrida anterior.
function _tableroEscribir(hoja, filas, conMenu) {
  const anteriores = Math.max(hoja.getLastRow() - 1, 0);
  hoja.getRange(1, 1, 1, TABLERO_ENCABEZADO.length).setValues([TABLERO_ENCABEZADO]);   // al día si cambian los nombres de las columnas
  if (filas.length) {
    hoja.getRange(2, 1, filas.length, TABLERO_ENCABEZADO.length).setValues(filas);
    hoja.getRange(2, 11, filas.length, 1).setNumberFormat("ddd dd/MM");
    hoja.getRange(2, 12, filas.length, 1).setNumberFormat("@");
    hoja.getRange(2, 13, filas.length, 1).setNumberFormat("dd/MM HH:mm");
  }
  if (anteriores > filas.length) hoja.getRange(2 + filas.length, 1, anteriores - filas.length, TABLERO_ENCABEZADO.length).clearContent();
  _tableroFormatoEstado(hoja, conMenu);
  hoja.getRange(1, TABLERO_ENCABEZADO.length + 2).setValue("Actualizado " + Utilities.formatDate(new Date(), TZ_MX, "dd/MM HH:mm") + " · " + filas.length + " pedidos");
}

// Reconstruye las pestañas. Seguro de correr varias veces; si ya hay una corrida en marcha, no empieza otra.
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
    _tableroEscribir(_tableroPrepararHoja(ss, TABLERO_HOJA), pedidos.map(_tableroFila), false);
    SUCURSALES.forEach(function (sucursal) {
      const propios = pedidos.filter(function (p) { return p.sucursal === sucursal; });
      _tableroEscribir(_tableroPrepararHoja(ss, TABLERO_PREFIJO_SUCURSAL + sucursal), propios.map(_tableroFila), true);
    });
    return { ok: true, pedidos: pedidos.length, referenciasNuevas: asignadas };
  } finally { cache.remove("tablero_corriendo"); }
}

// Un pedido nuevo del bot entra al instante con UN solo renglón arriba (la reconstrucción completa tarda varios segundos,
// demasiado para el turno que ManyChat espera). La revisión de cada 5 min lo reacomoda con el resto.
function tableroAgregarPedidoNuevo(pedido) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombres = [TABLERO_HOJA];
  if (SUCURSALES.indexOf(pedido.sucursal) !== -1) nombres.push(TABLERO_PREFIJO_SUCURSAL + pedido.sucursal);
  nombres.forEach(function (nombre) {
    const hoja = _tableroPrepararHoja(ss, nombre);
    hoja.insertRowBefore(2);
    hoja.getRange(2, 1, 1, TABLERO_ENCABEZADO.length).setValues([_tableroFila(pedido)]);
    hoja.getRange(2, 11, 1, 1).setNumberFormat("ddd dd/MM");
    hoja.getRange(2, 12, 1, 1).setNumberFormat("@");
    hoja.getRange(2, 13, 1, 1).setNumberFormat("dd/MM HH:mm");
  });
}

// Cambia el estado de UN renglón al instante en todas las pestañas (confirmar, entregar, no llegó), sin reconstruirlas:
// así dos acciones seguidas nunca dejan un renglón viejo. El orden completo lo acomoda la revisión de cada 5 minutos.
function tableroMarcarEstado(referencia, estado) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    _tableroNombresHojas().forEach(function (nombre) {
      const hoja = ss.getSheetByName(nombre);
      if (!hoja || hoja.getLastRow() < 2) return;
      const fila = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues().map(function (f) { return String(f[0]); }).indexOf(String(referencia));
      if (fila !== -1) hoja.getRange(fila + 2, 2).setValue(estado);
    });
  } catch (e) { Logger.log("Tablero: " + e); }
}

// Correr UNA vez desde el editor.
function instalarTableroPedidos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "tableroPedidosActualizar") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("tableroPedidosActualizar").timeBased().everyMinutes(TABLERO_MINUTOS_ACTUALIZACION).create();
}

// ---------------------------------------------------------------------------
// Menú de Estado de las pestañas por sucursal: quien atiende confirma, entrega o marca "no llegó" desde la hoja.
// Cambiar el Estado ejecuta la misma acción que el punto de venta (entregar descuenta del inventario; no llegó libera lo
// apartado), y queda en la auditoría con el nombre de quien lo hizo.
// ---------------------------------------------------------------------------
function _tableroAutorizado(ss, correo) {
  const lista = String(_cfgVal(ss, PEDIDO_CLAVE_AUTORIZADOS_HOJA, "")).toLowerCase().split(/[,;\s]+/).filter(String);
  return !lista.length || lista.indexOf(String(correo).toLowerCase()) !== -1;
}

function _tableroMetodoPago(pago) {
  const metodos = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta" };
  return metodos[String(pago).toLowerCase()] || "Efectivo";
}

// Aplica el estado que se eligió en la hoja. Devuelve { ok, error }.
function tableroAplicarEstado(referencia, nuevo, pago, usuario) {
  const sesion = { usuario: usuario, rol: "Owner" };
  if (nuevo === PEDIDO_ESTADO.CONFIRMADO) return pedidoConfirmar({ referencia: referencia }, sesion);
  if (nuevo === PEDIDO_ESTADO.ENTREGADO) return pedidoEntregar({ referencia: referencia, metodoPago: _tableroMetodoPago(pago) }, sesion);
  if (nuevo === PEDIDO_ESTADO.NO_RECOGIDO) return pedidoNoRecogido({ referencia: referencia }, sesion);
  return { ok: false, error: "Estado no válido." };
}

// Trigger instalable (instalarMenuEstadoPedidos): se dispara cuando alguien edita una celda.
function tableroAlEditar(e) {
  if (!e || !e.range || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  const hoja = e.range.getSheet();
  if (hoja.getName().indexOf(TABLERO_PREFIJO_SUCURSAL) !== 0 || e.range.getColumn() !== 2 || e.range.getRow() < 2) return;
  const nuevo = String(e.value || "").trim();
  if (PEDIDO_ESTADOS_HOJA.indexOf(nuevo) === -1) return;
  const ss = e.source;
  const fila = hoja.getRange(e.range.getRow(), 1, 1, TABLERO_ENCABEZADO.length).getValues()[0];
  const correo = (e.user && e.user.getEmail && e.user.getEmail()) || "";
  const deshacer = function (motivo) { e.range.setValue(e.oldValue || ""); ss.toast(motivo, "No se hizo el cambio", 8); };
  if (!_tableroAutorizado(ss, correo)) return deshacer("Solo pueden cambiar el estado las personas autorizadas.");
  const r = tableroAplicarEstado(String(fila[0]), nuevo, fila[7], "hoja-" + (correo ? correo.split("@")[0] : "sin-correo"));
  if (!r.ok) return deshacer(r.error || "No se pudo hacer el cambio.");
  ss.toast(fila[0] + " → " + nuevo, "Listo", 4);
}

// Correr UNA vez desde el editor.
function instalarMenuEstadoPedidos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "tableroAlEditar") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("tableroAlEditar").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}
