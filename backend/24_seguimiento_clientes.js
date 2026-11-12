// ============================================================================
// v9 — SEGUIMIENTO AL CLIENTE Y CIERRE DEL DÍA
//
// Lo que el sistema hace por su cuenta, sin que nadie lo pida:
//  1. CIERRE DEL DÍA (pedidosCierreDelDia, trigger de las 21:00, ya cerradas todas las sucursales):
//     - los pedidos para recoger que ya pasaron su hora límite, y los de domicilio que no se entregaron ese día, pasan a POR
//       REVISAR y SIGUEN APARTADOS (nada se cancela solo: una persona decide), y esa misma noche se le manda al cliente un
//       mensaje ofreciendo reagendar;
//     - a Rebeca y a Yessenia les llega el reporte de las tartas apartadas que no se entregaron.
//  2. FEEDBACK: al marcar un pedido como entregado se programa, para FEEDBACK_DIAS días después, un mensaje preguntando
//     "¿cómo te fue?".
//  3. Los mensajes a clientes pasan por una cola (hoja Mensajes_Clientes) que deja huella de qué se mandó, a quién y cómo salió;
//     mensajesClientesEnviarAhora (trigger cada 30 min) manda los que ya toca por ManyChat.
// Hojas: Seguimiento_Pedidos (una fila por pedido con su id de contacto en ManyChat), Mensajes_Clientes y Reportes_Noche.
// Un cliente solo recibe mensaje si el pedido trae su id de contacto de ManyChat (los pedidos del bot lo traen).
// ============================================================================

function _hojaDeRegistro(ss, nombre, encabezado, anchos) {
  let hoja = ss.getSheetByName(nombre);
  if (hoja) return hoja;
  hoja = ss.insertSheet(nombre);
  hoja.getRange(1, 1, 1, encabezado.length).setValues([encabezado]).setFontWeight("bold").setBackground("#2E4756").setFontColor("#FFFFFF");
  hoja.setFrozenRows(1);
  hoja.setTabColor("#8a5a9a");
  anchos.forEach(function (ancho, i) { hoja.setColumnWidth(i + 1, ancho); });
  return hoja;
}

function _fechaHora(fecha) { return Utilities.formatDate(fecha, TZ_MX, "yyyy-MM-dd HH:mm"); }

// ---------------------------------------------------------------------------
// Seguimiento de cada pedido
// ---------------------------------------------------------------------------
function _seguimientoHoja(ss) {
  return _hojaDeRegistro(ss, SEGUIMIENTO_HOJA, SEGUIMIENTO_ENCABEZADO, [110, 150, 170, 90, 110, 100, 110, 60, 110, 130, 150, 150]);
}

function _seguimientoFila(hoja, referencia) {
  const ultima = hoja.getLastRow();
  if (ultima < 2) return -1;
  const i = hoja.getRange(2, 1, ultima - 1, 1).getValues().map(function (f) { return String(f[0]); }).indexOf(String(referencia));
  return i === -1 ? -1 : i + 2;
}

// datos: { referencia, cliente, contacto, canal, idContacto, sucursal, fechaEntrega, hora, estado }
function seguimientoRegistrarPedido(ss, d) {
  const hoja = _seguimientoHoja(ss);
  const nueva = hoja.getLastRow() + 1;
  hoja.getRange(nueva, 7, 1, 2).setNumberFormat("@");
  hoja.getRange(nueva, 1, 1, SEGUIMIENTO_ENCABEZADO.length).setValues([[d.referencia, d.cliente, d.contacto, d.canal, d.idContacto, d.sucursal, d.fechaEntrega, d.hora || "", d.estado, "", "", ""]]);
}

function seguimientoLeer(ss, referencia) {
  const hoja = _seguimientoHoja(ss);
  const fila = _seguimientoFila(hoja, referencia);
  if (fila === -1) return null;
  const valores = hoja.getRange(fila, 1, 1, SEGUIMIENTO_ENCABEZADO.length).getValues()[0];
  const dato = {};
  SEGUIMIENTO_ENCABEZADO.forEach(function (c, i) { dato[c] = valores[i]; });
  return dato;
}

// campos: { "Estado": "...", "Feedback": "..." } (por nombre de columna)
function seguimientoActualizar(ss, referencia, campos) {
  const hoja = _seguimientoHoja(ss);
  const fila = _seguimientoFila(hoja, referencia);
  if (fila === -1) return;
  Object.keys(campos).forEach(function (columna) {
    const i = SEGUIMIENTO_ENCABEZADO.indexOf(columna);
    if (i !== -1) hoja.getRange(fila, i + 1).setValue(campos[columna]);
  });
}

// Al entregar: cierra el seguimiento y programa el mensaje de feedback.
function seguimientoMarcarEntregado(ss, referencia, ahora) {
  const pedido = seguimientoLeer(ss, referencia);
  if (!pedido) return;
  seguimientoActualizar(ss, referencia, { "Estado": PEDIDO_ESTADO.ENTREGADO, "Entregado el": _fechaHora(ahora) });
  mensajeClienteProgramar(ss, { tipo: MENSAJE_TIPO.FEEDBACK, llave: referencia, cliente: pedido["Cliente"], idContacto: pedido["Id ManyChat"], canal: pedido["Canal"], programado: _feedbackProgramado(ahora) });
}

// Fecha y hora en que toca preguntar "¿cómo te fue?": FEEDBACK_DIAS días después de la entrega, a las FEEDBACK_HORA.
function _feedbackProgramado(entrega) {
  const f = new Date(entrega.getTime());
  f.setDate(f.getDate() + FEEDBACK_DIAS);
  return Utilities.formatDate(f, TZ_MX, "yyyy-MM-dd") + " " + FEEDBACK_HORA;
}

// ---------------------------------------------------------------------------
// Cola de mensajes a clientes
// ---------------------------------------------------------------------------
function _mensajesHoja(ss) {
  const hoja = _hojaDeRegistro(ss, MENSAJES_HOJA, MENSAJES_ENCABEZADO, [130, 90, 110, 140, 110, 90, 420, 100, 260, 130]);
  return hoja;
}

function _mensajeTexto(tipo, nombre, llave, domicilio) {
  const saludo = "Hola" + (nombre ? " " + nombre : "") + ", ";
  if (tipo === MENSAJE_TIPO.REAGENDAR) return saludo + (domicilio ? "hoy no pudimos entregarte tu pedido " : "hoy no pudiste pasar por tu pedido ") + llave + " y tu tarta sigue apartada. ¿Te la reagendamos para mañana o para otra fecha? Respóndeme por aquí con el día y la hora que te acomoden.";
  return saludo + "¿cómo te fue con tu tarta? Cuéntame qué te pareció: tu opinión nos ayuda a mejorar.";
}

// d: { tipo, llave, cliente, idContacto, canal, programado ("yyyy-MM-dd HH:mm") }. No repite el mismo mensaje del mismo día.
function mensajeClienteProgramar(ss, d) {
  const hoja = _mensajesHoja(ss);
  const ultima = hoja.getLastRow();
  const dia = String(d.programado).substring(0, 10);
  if (ultima > 1) {
    const repetido = hoja.getRange(2, 1, ultima - 1, 3).getValues().some(function (f) { return String(f[0]).substring(0, 10) === dia && f[1] === d.tipo && String(f[2]) === String(d.llave); });
    if (repetido) return false;
  }
  const nombre = String(d.cliente || "").split(" ")[0];
  const nueva = ultima + 1;
  hoja.getRange(nueva, 1, 1, 1).setNumberFormat("@");
  hoja.getRange(nueva, 10, 1, 1).setNumberFormat("@");
  hoja.getRange(nueva, 1, 1, MENSAJES_ENCABEZADO.length).setValues([[d.programado, d.tipo, d.llave, d.cliente, d.idContacto, d.canal, _mensajeTexto(d.tipo, nombre, d.llave, d.domicilio), "PENDIENTE", "", ""]]);
  return true;
}

// Manda por ManyChat los mensajes pendientes que ya toca mandar (a la hora "ahora"). Lo que no se pudo mandar por falta de
// configuración sigue PENDIENTE; lo demás queda ENVIADO, FALLÓ o SIN CANAL con su motivo.
function mensajesClientesEnviar(ss, ahora) {
  const hoja = _mensajesHoja(ss);
  const ultima = hoja.getLastRow();
  const resumen = { enviados: 0, fallidos: 0, pendientes: 0 };
  if (ultima < 2) return resumen;
  const tope = _fechaHora(ahora);
  hoja.getRange(2, 1, ultima - 1, MENSAJES_ENCABEZADO.length).getValues().forEach(function (f, i) {
    if (f[7] !== "PENDIENTE") return;
    if (String(f[0]) > tope) { resumen.pendientes++; return; }
    const r = manychatMensajeCliente(ss, f[4], f[5], f[6]);
    if (!r.configurado) { hoja.getRange(i + 2, 9).setValue("NO SE MANDÓ: " + r.detalle); resumen.pendientes++; return; }
    const estado = r.ok ? "ENVIADO" : (/^SIN CANAL/.test(r.detalle) ? "SIN CANAL" : "FALLÓ");
    hoja.getRange(i + 2, 8, 1, 3).setValues([[estado, r.ok ? "ok" : r.detalle, r.ok ? tope : ""]]);
    if (r.ok) {
      resumen.enviados++;
      seguimientoActualizar(ss, String(f[2]), f[1] === MENSAJE_TIPO.FEEDBACK ? { "Feedback": "enviado " + tope } : { "Reagenda": "enviado " + tope });
    } else resumen.fallidos++;
  });
  return resumen;
}

function mensajesClientesEnviarAhora() {
  return mensajesClientesEnviar(SpreadsheetApp.getActiveSpreadsheet(), new Date());
}

// Correr UNA vez desde el editor: cada 30 minutos manda los mensajes a clientes que ya toca mandar.
function instalarMensajesClientes() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "mensajesClientesEnviarAhora") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("mensajesClientesEnviarAhora").timeBased().everyMinutes(30).create();
}

// ---------------------------------------------------------------------------
// Cierre del día
// ---------------------------------------------------------------------------
// Los pedidos que siguen apartados y debían entregarse hoy o antes.
function _cierreAbiertos(ss, hoyIso) {
  const ventas = ss.getSheetByName("Ventas");
  const idx = _pedidoIndices(ventas);
  return _tableroLeerPedidos(ss, ventas, idx).filter(function (p) { return PEDIDO_ESTADOS_ABIERTOS.indexOf(p.estado) !== -1 && p.fechaEntrega && p.fechaEntrega <= hoyIso; });
}

// Control de apartados completados (pedido de Alex, 1-nov): los que debían entregarse hoy y ya se entregaron.
function _cierreEntregadosHoy(ss, hoyIso) {
  const ventas = ss.getSheetByName("Ventas");
  return _tableroLeerPedidos(ss, ventas, _pedidoIndices(ventas)).filter(function (p) { return p.estado === PEDIDO_ESTADO.ENTREGADO && p.fechaEntrega === hoyIso; });
}

// Un renglón por pedido, igual que el reporte de las 18:00: "• 13:00 Alex: 1 Queso Mediana · 🔑 TV-1101-02"
function _reporteNocheRenglon(p) {
  return "• " + (p.hora ? p.hora + " " : "") + (p.cliente || "sin nombre") + ": " + p.items.join(", ") + " · 🔑 " + p.referencia;
}

// Control de apartados completados (pedido de Alex, 1-nov).
function _reporteEntregadosTexto(entregados) {
  if (!entregados.length) return "✅ *Entregados hoy:* ninguno";
  return "✅ *Entregados hoy (" + entregados.length + ")*\n" + entregados.map(_reporteNocheRenglon).join("\n");
}

// Lo que sigue apartado, con una sección por punto de venta y una de Domicilio (como el reporte de las 18:00).
function _reporteNocheTexto(abiertos) {
  if (!abiertos.length) return "🎉 Todo lo apartado se entregó.";
  const porSeccion = {};
  abiertos.forEach(function (p) {
    const seccion = String(p.canal) === BOT_CANAL_DOMICILIO ? ENTREGAS_SECCION_DOMICILIO : p.sucursal;
    (porSeccion[seccion] = porSeccion[seccion] || []).push(p);
  });
  const orden = ENTREGAS_TIENDAS.concat([ENTREGAS_SECCION_DOMICILIO]).filter(function (s) { return porSeccion[s]; })
    .concat(Object.keys(porSeccion).filter(function (s) { return ENTREGAS_TIENDAS.indexOf(s) === -1 && s !== ENTREGAS_SECCION_DOMICILIO; }));
  return "⏳ *Siguen apartadas (" + abiertos.length + ")*\n" + orden.map(function (s) {
    return "\n" + (s === ENTREGAS_SECCION_DOMICILIO ? "🚚 " : "📍 ") + "*" + s + "*\n" + porSeccion[s].map(_reporteNocheRenglon).join("\n");
  }).join("\n") + "\n\nMañana se resuelven en Apartados del POS: ✓ Entregado o ✗ No llegó.";
}

function _reporteNocheRegistrar(ss, titulo, detalle, aviso, ahora) {
  const hoja = _hojaDeRegistro(ss, REPORTE_NOCHE_HOJA, ["Fecha y hora", "Reporte", "Resultado"], [130, 600, 300]);
  hoja.getRange(hoja.getLastRow() + 1, 1, 1, 3).setNumberFormat("@");
  hoja.appendRow([_fechaHora(ahora), titulo + " — " + detalle, _pedidoResultadoAviso(aviso)]);
}

function _seguimientoProgramarReagenda(ss, pedido, ahora) {
  const seguimiento = seguimientoLeer(ss, pedido.referencia);
  mensajeClienteProgramar(ss, {
    tipo: MENSAJE_TIPO.REAGENDAR, llave: pedido.referencia, cliente: pedido.cliente, idContacto: seguimiento ? seguimiento["Id ManyChat"] : "",
    canal: seguimiento ? seguimiento["Canal"] : "", programado: _fechaHora(ahora), domicilio: String(pedido.canal) === BOT_CANAL_DOMICILIO
  });
}

// Los elogios del día van juntos en el reporte de la noche en vez de un WhatsApp por cada uno (12-nov-2026).
function _reporteElogiosHoy(ss, hoyIso) {
  const hoja = ss.getSheetByName(ALERTAS_BOT_HOJA);
  if (!hoja || hoja.getLastRow() < 2) return "";
  const elogios = hoja.getRange(2, 1, hoja.getLastRow() - 1, 6).getValues().filter(function (f) {
    const fecha = f[0] instanceof Date ? Utilities.formatDate(f[0], TZ_MX, "yyyy-MM-dd") : String(f[0]).substring(0, 10);
    return fecha === hoyIso && String(f[1]).indexOf("observacion (") === 0;
  }).map(function (f) {
    const texto = (String(f[5]).match(/💬 ([^\n]*)/) || [])[1] || "";
    return "• " + texto.substring(0, REPORTE_ELOGIO_MAX);
  });
  return elogios.length ? "\n\n💛 Felicitaciones de hoy (" + elogios.length + "):\n" + elogios.join("\n") : "";
}

// Trigger de las 21:00. Nada se cancela solo: lo que no se recogió queda POR REVISAR (sigue apartado) y se avisa al cliente.
function pedidosCierreDelDia(ahora) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const momento = ahora || new Date();
  const hoyIso = Utilities.formatDate(momento, TZ_MX, "yyyy-MM-dd");
  let porRevisar = 0, sinMarcar = 0;
  // Marcar cada pedido tarda (lee Ventas y otras hojas): con muchos vencidos se acababan los 6 min del trigger y el reporte
  // no salía (8-nov). Pasado el tope se deja de marcar —lo que falte se marca la noche siguiente— y el reporte sale siempre.
  const limite = Date.now() + CIERRE_MARCAR_MAX_MS;
  pedidosVencidos(ss, momento, _cfgVal(ss, PEDIDO_CLAVE_GRACIA_DIAS, 0)).forEach(function (p) {
    if (p.estado === PEDIDO_ESTADO.POR_REVISAR) return;
    if (Date.now() > limite) { sinMarcar++; return; }
    pedidoAnotar(ss, p.idVenta, { estado: PEDIDO_ESTADO.POR_REVISAR });
    tableroMarcarEstado(p.referencia, PEDIDO_ESTADO.POR_REVISAR);
    seguimientoActualizar(ss, p.referencia, { "Estado": PEDIDO_ESTADO.POR_REVISAR });
    excelPedidoMarcarEstado(ss, p.referencia, PEDIDO_ESTADO.POR_REVISAR);
    _seguimientoProgramarReagenda(ss, p, momento);
    porRevisar++;
  });
  const abiertos = _cierreAbiertos(ss, hoyIso);
  const entregados = _cierreEntregadosHoy(ss, hoyIso);
  const titulo = "Reporte de la noche " + Utilities.formatDate(momento, TZ_MX, "dd/MM") + ": " + entregados.length + " entregadas · "
    + (abiertos.length ? abiertos.length + " apartadas sin entregar" : "nada pendiente");
  const detalle = _reporteEntregadosTexto(entregados) + "\n\n" + _reporteNocheTexto(abiertos)
    + (sinMarcar ? "\n\n⚠️ " + sinMarcar + " pedidos vencidos no alcanzaron a pasar a POR REVISAR: se marcan mañana." : "")
    + _reporteElogiosHoy(ss, hoyIso);
  const aviso = manychatAvisarEquipo(ss, MANYCHAT_CLAVE_FLUJO_REPORTE, titulo, detalle, MANYCHAT_MAX_REPORTE);
  _reporteNocheRegistrar(ss, titulo, detalle, aviso, momento);
  return { ok: true, porRevisar: porRevisar, apartadasSinEntregar: abiertos.length, reporte: _pedidoResultadoAviso(aviso), mensajes: mensajesClientesEnviar(ss, momento) };
}
