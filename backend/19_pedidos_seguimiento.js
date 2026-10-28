// ============================================================================
// v9 — PEDIDOS CON SEGUIMIENTO (referencia, estados, entrega, "cliente no llegó" y reporte diario)
//
// Un pedido es una RESERVA en la hoja Ventas (tipo_op = "Reservado"), venga de donde venga: el bot de
// Instagram, la tienda en línea, el teléfono o el mostrador. Al crearla, InvCore ya marca las piezas como
// apartadas (res_apartado). Aquí se agrega lo que faltaba:
//   - referencia legible (TV-MMDD-NN) para rastrear el pedido en la conversación y en el local;
//   - estado del pedido (columna estado_pedido) y contacto de seguimiento;
//   - entregar: convertir la reserva en venta (baja el apartado y descuenta el inventario);
//   - cliente no llegó: libera el apartado SIN tocar el stock y deja el pedido en la lista de la campaña;
//   - reporte diario con los apartados vencidos y no recogidos.
//
// ⚠️ No se usa eliminarMovimiento para liberar: repone stock cuando el canal de la fila no es "Reservado"
// y estas reservas traen canal Tienda o Domicilio (ver CLAUDE.md).
// ============================================================================

// Una sola lectura del encabezado; solo escribe si falta alguna columna (antes eran ocho lecturas por llamada).
function _pedidoAsegurarColumnas(ss) {
  const hoja = ss.getSheetByName("Ventas");
  if (!hoja) return;
  const ultimaCol = hoja.getLastColumn();
  const encabezado = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0];
  const faltan = PEDIDO_COLUMNAS.concat(["estado_anul", "anulado_por", "anulado_fecha", "anulado_motivo"]).filter(function (c) { return encabezado.indexOf(c) === -1; });
  if (faltan.length) hoja.getRange(1, ultimaCol + 1, 1, faltan.length).setValues([faltan]);
}

function _pedidoIndices(hoja) {
  const h = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const idx = { tipo: h.indexOf("tipo_op"), fechaEntrega: h.indexOf("fecha_entrega"), anul: h.indexOf("estado_anul"), anulPor: h.indexOf("anulado_por"), anulFecha: h.indexOf("anulado_fecha"), anulMotivo: h.indexOf("anulado_motivo") };
  PEDIDO_COLUMNAS.forEach(function (c) { idx[c] = h.indexOf(c); });
  return idx;
}

function _pedidoTexto(v) { return v instanceof Date ? Utilities.formatDate(v, TZ_MX, "yyyy-MM-dd") : String(v == null ? "" : v); }

// Referencia del día: TV-MMDD-NN (NN = consecutivo de los pedidos de ese día). Corta y fácil de decir en el mostrador.
// El consecutivo vive en una propiedad del script: la hoja Ventas ya pasa de 10 mil filas y leerla entera tardaba segundos.
// Solo la primera vez del día se lee la columna de referencias para no repetir una que ya exista.
function _pedidoSiguienteReferencia(hoja, idx, ahora) {
  const dia = Utilities.formatDate(ahora, TZ_MX, "MMdd");
  const prefijo = PEDIDO_PREFIJO_REFERENCIA + "-" + dia + "-";
  const props = PropertiesService.getScriptProperties();
  const clave = PEDIDO_PROPIEDAD_CONSECUTIVO + dia;
  let n = Number(props.getProperty(clave)) || 0;
  if (!n) {
    Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf(PEDIDO_PROPIEDAD_CONSECUTIVO) === 0) props.deleteProperty(k); });
    if (idx.referencia !== -1 && hoja.getLastRow() > 1) {
      hoja.getRange(2, idx.referencia + 1, hoja.getLastRow() - 1, 1).getValues().forEach(function (f) {
        if (String(f[0]).indexOf(prefijo) === 0) n = Math.max(n, Number(String(f[0]).slice(prefijo.length)) || 0);
      });
    }
  }
  n += 1;
  props.setProperty(clave, String(n));
  return prefijo + ("0" + n).slice(-2);
}

// Filas (número de fila, base 1) de un pedido. Un pedido recién creado está al final de la hoja: se busca solo en las
// últimas filas y, si no aparece, en toda la columna A.
function _pedidoFilasDe(hoja, idVenta) {
  const ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  const buscar = function (desde, cuantas) {
    const filas = [];
    hoja.getRange(desde, 1, cuantas, 1).getValues().forEach(function (f, i) { if (String(f[0]) === String(idVenta)) filas.push(desde + i); });
    return filas;
  };
  const cuantas = Math.min(ultima - 1, PEDIDO_VENTANA_FILAS);
  const recientes = buscar(ultima - cuantas + 1, cuantas);
  return recientes.length ? recientes : buscar(2, ultima - 1);
}

// Anota referencia, estado, contacto y origen en TODAS las filas del pedido. Devuelve la referencia.
function pedidoAnotar(ss, idVenta, datos) {
  _pedidoAsegurarColumnas(ss);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return ""; }
  try {
    const hoja = ss.getSheetByName("Ventas");
    const idx = _pedidoIndices(hoja);
    const filas = _pedidoFilasDe(hoja, idVenta);
    if (!filas.length) return "";
    const existente = String(hoja.getRange(filas[0], idx.referencia + 1).getValue() || "");
    const referencia = existente || _pedidoSiguienteReferencia(hoja, idx, new Date());
    const contiguas = idx.estado_pedido === idx.referencia + 1 && idx.contacto_seguimiento === idx.referencia + 2 && idx.origen_pedido === idx.referencia + 3;
    if (contiguas && datos.estado && datos.contacto != null && datos.origen) {
      const valores = filas.map(function () { return [referencia, datos.estado, datos.contacto, datos.origen]; });
      const primera = filas[0], seguidas = filas.every(function (f, i) { return f === primera + i; });
      if (seguidas) hoja.getRange(primera, idx.referencia + 1, filas.length, 4).setValues(valores);
      else filas.forEach(function (f, i) { hoja.getRange(f, idx.referencia + 1, 1, 4).setValues([valores[i]]); });
    } else {
      filas.forEach(function (f) {
        hoja.getRange(f, idx.referencia + 1).setValue(referencia);
        if (datos.estado) hoja.getRange(f, idx.estado_pedido + 1).setValue(datos.estado);
        if (datos.contacto != null) hoja.getRange(f, idx.contacto_seguimiento + 1).setValue(datos.contacto);
        if (datos.origen) hoja.getRange(f, idx.origen_pedido + 1).setValue(datos.origen);
      });
    }
    return referencia;
  } finally { try { lock.releaseLock(); } catch (e) { } }
}

// Estado que ve el cliente y el equipo, a partir de lo que dice la fila (sirve también para pedidos de Shopify o teléfono).
function _pedidoEstadoDe(fila, idx) {
  const anulado = idx.anul !== -1 && fila[idx.anul] === "ANULADO";
  if (anulado) return String(fila[idx.anulMotivo] || "").indexOf(PEDIDO_MOTIVO_NO_RECOGIDO) !== -1 ? PEDIDO_ESTADO.NO_RECOGIDO : PEDIDO_ESTADO.CANCELADO;
  const tipo = idx.tipo !== -1 ? fila[idx.tipo] : "";
  const marcado = idx.estado_pedido !== -1 ? String(fila[idx.estado_pedido] || "") : "";
  if (tipo === "Venta") return marcado === PEDIDO_ESTADO.ENTREGADO ? PEDIDO_ESTADO.ENTREGADO : "VENTA";
  return marcado || PEDIDO_ESTADO.APARTADO;
}

// Lee un pedido por referencia (TV-1027-03) o por idVenta (RES-...). Prefiere el más reciente.
function pedidoLeer(ss, clave) {
  const hoja = ss.getSheetByName("Ventas");
  if (!hoja || hoja.getLastRow() < 2) return null;
  _pedidoAsegurarColumnas(ss);
  const idx = _pedidoIndices(hoja);
  const valores = hoja.getDataRange().getValues();
  const buscada = String(clave || "").trim().toUpperCase();
  if (!buscada) return null;
  let pedido = null;
  for (let i = valores.length - 1; i >= 1; i--) {
    const f = valores[i];
    const esClave = String(f[0]).toUpperCase() === buscada || (idx.referencia !== -1 && String(f[idx.referencia]).toUpperCase() === buscada);
    if (!esClave) continue;
    if (!pedido) {
      pedido = { idVenta: String(f[0]), referencia: String(f[idx.referencia] || ""), estado: _pedidoEstadoDe(f, idx), sucursal: f[3], canal: f[9], cliente: f[12],
        fechaEntrega: idx.fechaEntrega !== -1 ? _pedidoTexto(f[idx.fechaEntrega]).substring(0, 10) : "", contacto: String(f[idx.contacto_seguimiento] || ""), origen: String(f[idx.origen_pedido] || ""), notas: String(f[14] || ""), creado: f[1] instanceof Date ? Utilities.formatDate(f[1], TZ_MX, "yyyy-MM-dd HH:mm") : String(f[1] || ""), items: [], total: 0, filas: [] };
    } else if (String(f[0]) !== pedido.idVenta) { continue; }
    pedido.items.push({ sabor: f[4], tamano: f[5], cantidad: Number(f[6]) || 0, subtotal: Number(f[8]) || 0 });
    pedido.total += Number(f[8]) || 0;
    pedido.filas.push(i + 1);
  }
  return pedido;
}

// Todos ven el pedido (el aviso le llega a todo el equipo), pero lo gestiona quien corresponde:
//  - para recoger: el punto de venta de ESA sucursal;
//  - a domicilio: quien hace las rutas (Chofer), solo para confirmar;
//  - la Dueña y la Administradora (ven ambas sucursales y venden) pueden con todo.
function _pedidoPuedeGestionar(sesion, pedido, permitirChofer) {
  const perm = getPermisos(sesion.rol);
  if (perm.puedeVerAmbas && perm.puedeVender) return true;
  if (String(pedido.canal) === BOT_CANAL_DOMICILIO) return !!(permitirChofer && perm.esChofer);
  return !!(perm.puedeVender && getSucursalUsuario(sesion.usuario) === pedido.sucursal);
}

function _pedidoQuienGestiona(pedido) {
  return String(pedido.canal) === BOT_CANAL_DOMICILIO ? "quien hace las rutas" : "el punto de venta de " + pedido.sucursal;
}

function _pedidoResolver(ss, body) {
  const pedido = pedidoLeer(ss, body.referencia || body.idVenta);
  return pedido || null;
}

function pedidoConfirmar(body, sesion) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pedido = _pedidoResolver(ss, body || {});
  if (!pedido) return { ok: false, error: "Pedido no encontrado." };
  if (!_pedidoPuedeGestionar(sesion, pedido, true)) return { ok: false, error: "Este pedido lo confirma " + _pedidoQuienGestiona(pedido) + "." };
  if (pedido.estado !== PEDIDO_ESTADO.POR_CONFIRMAR && pedido.estado !== PEDIDO_ESTADO.APARTADO) return { ok: false, error: "Este pedido está " + pedido.estado + ": no se puede confirmar." };
  pedidoAnotar(ss, pedido.idVenta, { estado: PEDIDO_ESTADO.CONFIRMADO });
  registrarAuditoria(sesion.usuario, sesion.rol, "PEDIDO_CONFIRMADO", pedido.referencia + " (" + pedido.idVenta + ")");
  _tableroRefrescarSiHaceFalta();
  return { ok: true, referencia: pedido.referencia, estado: PEDIDO_ESTADO.CONFIRMADO };
}

// Ya se entregó: la reserva pasa a venta (baja el apartado y descuenta el inventario).
function pedidoEntregar(body, sesion) {
  requierePuedeVender(sesion);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pedido = _pedidoResolver(ss, body || {});
  if (!pedido) return { ok: false, error: "Pedido no encontrado." };
  if (!_pedidoPuedeGestionar(sesion, pedido, false)) return { ok: false, error: "Este pedido lo entrega " + _pedidoQuienGestiona(pedido) + "." };
  if (pedido.estado === PEDIDO_ESTADO.ENTREGADO) return { ok: false, error: "Este pedido ya se entregó." };
  const res = convertirReservaAVenta({ idVenta: pedido.idVenta, metodoPago: body.metodoPago }, sesion);
  if (!res.ok) return res;
  pedidoAnotar(ss, pedido.idVenta, { estado: PEDIDO_ESTADO.ENTREGADO });
  _tableroRefrescarSiHaceFalta();
  return { ok: true, referencia: pedido.referencia, estado: PEDIDO_ESTADO.ENTREGADO, total: res.total };
}

// El cliente no llegó: libera lo apartado (sin reponer stock, porque las reservas nunca lo descontaron),
// anula el pedido con su motivo y lo deja en la lista de la campaña.
function pedidoNoRecogido(body, sesion) {
  const resultado = _pedidoMarcarNoRecogido(body, sesion);
  if (resultado.ok) _tableroRefrescarSiHaceFalta();
  return resultado;
}

function _pedidoMarcarNoRecogido(body, sesion) {
  requierePuedeVender(sesion);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  _pedidoAsegurarColumnas(ss);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: "Sistema ocupado." }; }
  try {
    const pedido = _pedidoResolver(ss, body || {});
    if (!pedido) return { ok: false, error: "Pedido no encontrado." };
    if (!_pedidoPuedeGestionar(sesion, pedido, false)) return { ok: false, error: "Este pedido lo gestiona " + _pedidoQuienGestiona(pedido) + "." };
    if (pedido.estado === PEDIDO_ESTADO.ENTREGADO || pedido.estado === PEDIDO_ESTADO.NO_RECOGIDO || pedido.estado === PEDIDO_ESTADO.CANCELADO || pedido.estado === "VENTA") {
      return { ok: false, error: "Este pedido está " + pedido.estado + ": no se puede marcar como no recogido." };
    }
    const hoja = ss.getSheetByName("Ventas");
    const idx = _pedidoIndices(hoja);
    const ahora = new Date();
    pedido.filas.forEach(function (f) {
      const r = hoja.getRange(f, 1, 1, hoja.getLastColumn()).getValues()[0];
      try { invLiberar(ss, r[4], r[5], r[3], Number(r[6]) || 0, "apartado", pedido.idVenta, sesion.usuario); } catch (e) { }
      hoja.getRange(f, idx.anul + 1).setValue("ANULADO");
      hoja.getRange(f, idx.anulPor + 1).setValue(sesion.usuario);
      hoja.getRange(f, idx.anulFecha + 1).setValue(ahora.toISOString());
      hoja.getRange(f, idx.anulMotivo + 1).setValue(PEDIDO_MOTIVO_NO_RECOGIDO + (body.nota ? ": " + body.nota : ""));
      hoja.getRange(f, idx.estado_pedido + 1).setValue(PEDIDO_ESTADO.NO_RECOGIDO);
    });
    _pedidoRegistrarNoRecogido(ss, pedido, ahora);
    registrarAuditoria(sesion.usuario, sesion.rol, "PEDIDO_NO_RECOGIDO", pedido.referencia + " (" + pedido.idVenta + ") | liberado el apartado");
    _utilMarcarDirty();
    return { ok: true, referencia: pedido.referencia, estado: PEDIDO_ESTADO.NO_RECOGIDO };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally { try { lock.releaseLock(); } catch (e) { } }
}

function _pedidoResumenItems(pedido) {
  return pedido.items.map(function (i) { return i.cantidad + " " + i.sabor + " " + i.tamano; }).join(", ");
}

function _pedidoMensajeCampana(pedido) {
  const nombre = String(pedido.cliente || "").split(" ")[0];
  return "Hola" + (nombre ? " " + nombre : "") + ", te escribimos de La Tarta Vasca. Vimos que tu pedido " + pedido.referencia + " (" + _pedidoResumenItems(pedido) + ") no se pudo recoger el " + pedido.fechaEntrega + ". ¿Todo bien? Cuéntanos qué pasó; si quieres, lo preparamos de nuevo para que lo recojas cuando te acomode.";
}

function _pedidoRegistrarNoRecogido(ss, pedido, ahora) {
  let hoja = ss.getSheetByName(PEDIDO_HOJA_NO_RECOGIDOS);
  if (!hoja) {
    hoja = ss.insertSheet(PEDIDO_HOJA_NO_RECOGIDOS);
    hoja.appendRow(["registrado", "referencia", "id_venta", "cliente", "contacto_seguimiento", "pedido", "total", "fecha_entrega", "sucursal", "origen", "estado_campana", "mensaje_sugerido"]);
    hoja.setFrozenRows(1);
  }
  hoja.appendRow([Utilities.formatDate(ahora, TZ_MX, "yyyy-MM-dd HH:mm"), pedido.referencia, pedido.idVenta, pedido.cliente, pedido.contacto, _pedidoResumenItems(pedido), pedido.total, pedido.fechaEntrega, pedido.sucursal, pedido.origen, "Pendiente", _pedidoMensajeCampana(pedido)]);
}

// Regla: el día de la entrega, al CERRAR la sucursal, lo que debió recogerse y no llegó se da por no recogido.
// Con días de gracia > 0 se espera ese número de días más. Pura (recibe fechas y minutos) para poder probarla.
function _pedidoEsVencido(fechaEntregaIso, cierraMin, hoyIso, minAhora, diasGracia) {
  const limite = new Date(fechaEntregaIso + "T12:00:00");
  limite.setDate(limite.getDate() + (Number(diasGracia) || 0));
  const limiteIso = Utilities.formatDate(limite, TZ_MX, "yyyy-MM-dd");
  if (limiteIso < hoyIso) return true;
  return limiteIso === hoyIso && minAhora > cierraMin;
}

function _pedidoMinutos(hhmm) { const p = String(hhmm || "0:0").split(":"); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); }

// Reservas para recoger en sucursal que ya pasaron su hora límite y siguen apartadas.
function pedidosVencidos(ss, ahora, diasGracia) {
  const hoja = ss.getSheetByName("Ventas");
  if (!hoja || hoja.getLastRow() < 2) return [];
  _pedidoAsegurarColumnas(ss);
  const idx = _pedidoIndices(hoja);
  const valores = hoja.getDataRange().getValues();
  const hoyIso = Utilities.formatDate(ahora, TZ_MX, "yyyy-MM-dd");
  const minAhora = _pedidoMinutos(Utilities.formatDate(ahora, TZ_MX, "HH:mm"));
  const vistos = {}, vencidos = [];
  for (let i = 1; i < valores.length; i++) {
    const f = valores[i];
    if (idx.tipo === -1 || f[idx.tipo] !== "Reservado") continue;
    if (idx.anul !== -1 && f[idx.anul] === "ANULADO") continue;
    if (PEDIDO_CANALES_RECOGER.indexOf(String(f[9])) === -1) continue;
    const fecha = idx.fechaEntrega !== -1 ? _pedidoTexto(f[idx.fechaEntrega]).substring(0, 10) : "";
    if (!fecha) continue;
    const horario = getHorarioHoy(String(f[3]), ahora);
    if (!_pedidoEsVencido(fecha, _pedidoMinutos(horario.cierra), hoyIso, minAhora, diasGracia)) continue;
    const id = String(f[0]);
    if (vistos[id]) continue;
    vistos[id] = true;
    const pedido = pedidoLeer(ss, id);
    if (pedido) vencidos.push(pedido);
  }
  return vencidos;
}

// Reporte diario (trigger a las 21:00, ya cerradas todas las sucursales). Por defecto marca solos los vencidos y libera las
// tartas; con pedido_auto_no_recogido = NO solo los lista para que una persona los marque.
function pedidosRevisionDiaria() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const auto = String(_cfgVal(ss, PEDIDO_CLAVE_AUTO_NO_RECOGIDO, "SI")).toUpperCase() === "SI";
  const vencidos = pedidosVencidos(ss, new Date(), _cfgVal(ss, PEDIDO_CLAVE_GRACIA_DIAS, 0));
  const sesion = { usuario: "sistema", rol: "Owner" };
  const marcados = [];
  if (auto) vencidos.forEach(function (p) { const r = pedidoNoRecogido({ idVenta: p.idVenta }, sesion); if (r.ok) marcados.push(p); });
  const lista = (auto ? marcados : vencidos).map(function (p) {
    return "• " + p.referencia + " · " + (p.cliente || "sin nombre") + " · " + (p.contacto || "sin contacto") + " · " + _pedidoResumenItems(p) + " · $" + p.total + " · debía recogerse el " + p.fechaEntrega + " en " + p.sucursal;
  });
  if (!lista.length) return { ok: true, vencidos: 0 };
  const titulo = auto ? "📋 Pedidos no recogidos (ya liberados): " + lista.length : "📋 Pedidos apartados vencidos por revisar: " + lista.length;
  const pie = auto ? "\n\nLas tartas ya volvieron al inventario. La lista de la campaña está en la hoja " + PEDIDO_HOJA_NO_RECOGIDOS + ", con un mensaje sugerido para cada cliente."
    : "\n\nSiguen apartados. Márcalos como no recogidos para liberar las tartas y llevarlos a la campaña.";
  _botAvisar(titulo, lista.join("\n") + pie);
  return { ok: true, vencidos: lista.length, marcados: marcados.length };
}

// Correr UNA vez desde el editor.
function instalarRevisionDiariaPedidos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "pedidosRevisionDiaria") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("pedidosRevisionDiaria").timeBased().everyDays(1).atHour(PEDIDO_HORA_REVISION).inTimezone(TZ_MX).create();
}


// ---------------------------------------------------------------------------
// RECORDATORIO: lo que llegó hoy y nadie ha confirmado
// ---------------------------------------------------------------------------
function pedidosSinConfirmar(ss, hoyIso) {
  const hoja = ss.getSheetByName("Ventas");
  if (!hoja || hoja.getLastRow() < 2) return [];
  _pedidoAsegurarColumnas(ss);
  const idx = _pedidoIndices(hoja);
  const valores = hoja.getDataRange().getValues();
  const vistos = {}, pendientes = [];
  for (let i = valores.length - 1; i >= 1; i--) {
    const f = valores[i];
    if (idx.tipo === -1 || f[idx.tipo] !== "Reservado") continue;
    if (idx.anul !== -1 && f[idx.anul] === "ANULADO") continue;
    if (String(f[idx.estado_pedido]) !== PEDIDO_ESTADO.POR_CONFIRMAR) continue;
    const creado = f[1] instanceof Date ? Utilities.formatDate(f[1], TZ_MX, "yyyy-MM-dd") : String(f[1]).substring(0, 10);
    if (creado !== hoyIso) continue;
    const id = String(f[0]);
    if (vistos[id]) continue;
    vistos[id] = true;
    const pedido = pedidoLeer(ss, id);
    if (pedido) pendientes.push(pedido);
  }
  return pendientes.reverse();
}

function _pedidoLineaPendiente(p) {
  const hora = String(p.creado).substring(11, 16);
  return "• " + p.referencia + " · llegó " + (hora || "hoy") + " · " + _pedidoResumenItems(p) + " · $" + p.total + " · " + (p.cliente || "sin nombre") + " · " + (p.contacto || "sin contacto") + " · " + (String(p.canal) === BOT_CANAL_DOMICILIO ? "domicilio" : "recoge en " + p.sucursal) + " → lo confirma " + _pedidoQuienGestiona(p);
}

// Un pedido para HOY se avisa al instante por WhatsApp a Yessenia y Rebeca (por ManyChat, ver 22_manychat_avisos.js): ellas
// llaman a la sucursal, como se hace hoy. Cualquier otro (domicilio o días después) solo se registra.
// Cada aviso deja huella en Avisos_Pedidos_Hoy.
function pedidoAvisarSiEsDeHoy(ss, p) {
  if (p.fechaEntrega !== Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd")) return { enviado: false };
  const donde = p.domicilio ? "A DOMICILIO: " + p.direccion : "Recoge en " + p.sucursal + (p.hora ? " a las " + p.hora : "");
  const detalle = [p.cliente, p.contacto, p.resumen + " ($" + p.total + ")", donde].filter(Boolean).join(", ");
  const aviso = manychatAvisarPedidoHoy(ss, p.referencia, detalle);
  _pedidoRegistrarAvisoHoy(ss, p.referencia, detalle, aviso);
  return { enviado: aviso.configurado, destinatarios: aviso.destinatarios.length };
}

function _pedidoResultadoAviso(aviso) {
  if (!aviso.configurado) return "NO SE MANDÓ: " + aviso.motivo;
  return aviso.resultados.map(function (r) { return r.nombre + (r.ok ? " enviado" : " FALLÓ " + r.detalle); }).join(" · ");
}

function _pedidoRegistrarAvisoHoy(ss, referencia, detalle, aviso) {
  let hoja = ss.getSheetByName(PEDIDO_HOJA_AVISOS_HOY);
  if (!hoja) {
    hoja = ss.insertSheet(PEDIDO_HOJA_AVISOS_HOY);
    hoja.getRange(1, 1, 1, 5).setValues([["Fecha y hora", "Pedido", "Para", "Detalle", "Resultado"]]).setFontWeight("bold");
    hoja.setFrozenRows(1);
  }
  const para = aviso.destinatarios.map(function (d) { return d.nombre || d.id; }).join(", ");
  hoja.appendRow([Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd HH:mm"), referencia, para, detalle, _pedidoResultadoAviso(aviso)]);
}

// Trigger cada pocas horas: solo avisa dentro del horario y solo si hay pedidos de hoy sin confirmar.
// Va a todo el equipo (mensaje interno y correo) y a los números del resumen (la Dueña) por WhatsApp.
function pedidosRecordatorioSinConfirmar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ahora = new Date();
  const hora = Number(Utilities.formatDate(ahora, TZ_MX, "H"));
  if (hora < PEDIDO_RECORDATORIO_DESDE || hora >= PEDIDO_RECORDATORIO_HASTA) return { ok: true, enviado: false, motivo: "fuera de horario" };
  const pendientes = pedidosSinConfirmar(ss, Utilities.formatDate(ahora, TZ_MX, "yyyy-MM-dd"));
  if (!pendientes.length) return { ok: true, enviado: false, pendientes: 0 };
  _botAvisar("⏰ Pedidos de hoy sin confirmar: " + pendientes.length, pendientes.map(_pedidoLineaPendiente).join("\n") + "\n\nSi ya lo viste, confírmalo en el sistema para que deje de aparecer aquí.", { whatsappResumen: true });
  return { ok: true, enviado: true, pendientes: pendientes.length };
}

// Correr UNA vez desde el editor. Cada cuántas horas lo dice Configuración (pedido_recordatorio_horas, por defecto 2).
function instalarRecordatorioPedidos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "pedidosRecordatorioSinConfirmar") ScriptApp.deleteTrigger(t); });
  const horas = Math.max(1, Math.min(12, Number(_cfgVal(SpreadsheetApp.getActiveSpreadsheet(), PEDIDO_CLAVE_RECORDATORIO_HORAS, PEDIDO_RECORDATORIO_HORAS_DEFECTO)) || PEDIDO_RECORDATORIO_HORAS_DEFECTO));
  ScriptApp.newTrigger("pedidosRecordatorioSinConfirmar").timeBased().everyHours(horas).create();
}
