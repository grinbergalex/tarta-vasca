// ============================================================================
// v9 — ALERTAS DEL BOT AL WHATSAPP PERSONAL DE REBECA Y YESSENIA, Y PAUSA DEL BOT
//
// Cuando el bot detecta una queja, un Uber/DiDi/taxi para recoger, una petición compleja (evento, restaurante,
// alergias, algo que no sabe), una factura, un cambio o cancelación, o que el cliente pide hablar con una persona,
// además de la bandeja del POS y el correo manda un WhatsApp a quienes están en `aviso_hoy_manychat`.
// Sale por ManyChat con el flujo `manychat_flujo_alerta` (campos aviso_referencia = título, aviso_detalle = detalle),
// igual que los avisos de pedido. Cada alerta queda en la hoja `Alertas_Bot`, se haya mandado o no.
//
// Pausa: tras pasar_a_persona el bot deja de contestar esa conversación `BOT_PAUSA_HORAS` horas para no
// pisar a la persona que ya la atiende. Con el cliente escribiendo de nuevo se le dice UNA vez que ya se avisó.
// Se reanuda a mano con `botReanudarConversacion("<id>")` desde el editor.
// ============================================================================

// Del tipo que manda el bot a lo que se escribe en la hoja y se usa como prioridad.
const ALERTA_URGENTES = ["queja_u_observacion", "mensajero", "cliente_esperando", "amenaza_o_legal", "falla_bot"];
const ALERTA_CON_SUGERENCIA =["queja_u_observacion"];   // solo en quejas va el segundo WhatsApp con el texto para pegarle al cliente (12-nov: cada alerta eran 2 mensajes)

function botAlertaPersonal(ss, origen, tipo, titulo, detalle, conversacionId) {
  const clave = "bot_alerta_" + origen + "_" + tipo + "_" + conversacionId;
  const cache = CacheService.getScriptCache();
  let aviso;
  if (!BOT_ALERTAS_ACTIVAS) {
    aviso = { configurado: false, motivo: "alertas de Maite apagadas (BOT_ALERTAS_ACTIVAS)", destinatarios: [], resultados: [] };
  } else if (cache.get(clave)) {
    aviso = { configurado: false, motivo: "ya se avisó hace poco de lo mismo en esta conversación", destinatarios: [], resultados: [] };
  } else {
    cache.put(clave, "1", BOT_ALERTA_REPETIDA_SEGUNDOS);
    // Cada aviso llega solo, con el botón "Atendida" de ESTA conversación; lo pendiente se recuerda aparte cada 3 h.
    aviso = manychatAvisarEquipo(ss, MANYCHAT_CLAVE_FLUJO_ALERTA, titulo, detalle, MANYCHAT_MAX_ALERTA, [{ nombre: MANYCHAT_CAMPO_CONVERSACION, valor: String(conversacionId) }]);
    // El texto sugerido va en un mensaje APARTE, solo con el texto, para copiarlo y pegarlo de un toque. Los recordatorios no lo repiten.
    if (aviso.configurado && !/^recordatorio/.test(origen) && ALERTA_CON_SUGERENCIA.indexOf(tipo) !== -1) aviso.sugerencia = manychatSugerenciaEquipo(ss, _botSugerenciaCliente(tipo));
  }
  _botRegistrarAlerta(ss, origen, tipo, conversacionId, titulo, detalle, aviso);
  return aviso;
}

// El cuerpo de toda alerta, un dato por renglón (en la plantilla los renglones se vuelven " | ").
function botDetalleAlerta(canal, texto, conversacionId) {
  return "📱 " + (canal || "Instagram") + "\n📝 " + String(texto || "").trim() + "\n\n" + botEnlaceChat(conversacionId);
}

// Texto que Rebeca o Yessenia copian y pegan al cliente al tomar la conversación: listo para pegar, sin huecos que llenar ni promesas (reembolsos, fechas).
const BOT_SUGERENCIAS_CLIENTE = {
  queja_u_observacion: "Hola, te escribe el equipo de La Tarta Vasca. Lamento mucho lo que pasó; ya lo estoy revisando personalmente y te escribo en un momento.",
  mensajero: "Hola, te escribe el equipo de La Tarta Vasca. Tengo tu aviso del mensajero; ¿a nombre de quién lo recoge y a qué hora aproximada?",
  cotizacion_evento_o_restaurante: "Hola, te escribe el equipo de La Tarta Vasca. Gracias por pensar en nosotros; ¿me cuentas la fecha, cuántas piezas y el lugar para cotizarte?",
  factura: "Hola, te escribe el equipo de La Tarta Vasca. Ya tenemos tus datos para la factura; en cuanto esté lista te la mandamos a tu correo.",
  alianza_o_colaboracion: "Hola, te escribe el equipo de La Tarta Vasca. Gracias por escribirnos; ¿nos cuentas más de tu propuesta y cómo te gustaría colaborar?",
  pedidos_recurrentes_o_cadena: "Hola, te escribe el equipo de La Tarta Vasca. Gracias por pensar en nosotros; ¿cuántas piezas necesitas, con qué frecuencia y en qué ubicaciones?",
  amenaza_o_legal: "Hola, te escribe el equipo de La Tarta Vasca. Recibimos tu mensaje y lo estamos atendiendo directamente. Para poder ayudarte, ¿nos compartes los detalles por este medio?"
};
const BOT_SUGERENCIA_GENERICA = "Hola, te escribe el equipo de La Tarta Vasca. Ya vi tu mensaje y te ayudo personalmente.";
function _botSugerenciaCliente(tipo) { return BOT_SUGERENCIAS_CLIENTE[tipo] || BOT_SUGERENCIA_GENERICA; }

// Acción pública protegida con BOT_TOKEN: el botón ATENDIDA del WhatsApp de la alerta la llama (solicitud externa de ManyChat).
function botAtendida(body) {
  const secreto = PropertiesService.getScriptProperties().getProperty("BOT_TOKEN");
  if (!secreto || String(body.botToken || "") !== secreto) return { ok: false, error: "No autorizado." };
  const conversacionId = String(body.conversacionId || "").replace(/[^A-Za-z0-9_-]/g, "").substring(0, 64);
  if (!conversacionId) return { ok: false, error: "Falta la conversación." };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pendiente = _botPendienteDe(ss, conversacionId);
  if (!pendiente) return { ok: false, error: "No hay una conversación pendiente con ese id." };
  const hoja = ss.getSheetByName(PENDIENTES_HOJA);
  // Todos los renglones pendientes de esa conversación, no solo el último: si quedaba uno viejo (la queja antes del
  // "pidió persona"), seguía mandando recordatorios y su botón ya no lo podía cerrar (24-nov).
  _botFilasPendientes(hoja, conversacionId).concat([pendiente.fila]).forEach(function (fila) {
    hoja.getRange(fila, PENDIENTE_COL.ESTADO + 1).setValue(PENDIENTE_ESTADO.ATENDIDA);
  });
  _botPendienteAnotarMensaje(ss, pendiente.fila);
  botPausar(conversacionId);
  _botMarcarHumano(conversacionId);   // volver a tocar el botón le da a la persona otros BOT_HUMANO_MINUTOS
  return { ok: true, estado: PENDIENTE_ESTADO.ATENDIDA };
}

function _botRegistrarAlerta(ss, origen, tipo, conversacionId, titulo, detalle, aviso) {
  try {
    let hoja = ss.getSheetByName(ALERTAS_BOT_HOJA);
    if (!hoja) {
      hoja = ss.insertSheet(ALERTAS_BOT_HOJA);
      hoja.getRange(1, 1, 1, 7).setValues([["Fecha y hora", "Tipo", "Urgente", "Conversación", "Título", "Detalle", "Resultado"]]).setFontWeight("bold");
      hoja.setFrozenRows(1);
    }
    const fila = [Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd HH:mm"), tipo + " (" + origen + ")", ALERTA_URGENTES.indexOf(tipo) !== -1 ? "SÍ" : "", conversacionId, titulo, detalle, _pedidoResultadoAviso(aviso) + (aviso.sugerencia ? " | sugerencia: " + aviso.sugerencia : "")];
    // Varias conversaciones pueden alertar al mismo tiempo: sin candado, dos appendRow seguidos se pisan y se pierde un renglón.
    const candado = LockService.getDocumentLock();   // candado propio: no compite con el de las ventas
    candado.waitLock(ALERTA_ESPERA_CANDADO_MS);
    try { hoja.appendRow(fila); } finally { candado.releaseLock(); }
  } catch (e) { }
}

// ---------------------------------------------------------------------------
// PAUSA
// ---------------------------------------------------------------------------
function botPausar(conversacionId) {
  PropertiesService.getScriptProperties().setProperty(BOT_PAUSA_PREFIJO + conversacionId, String(Date.now() + BOT_PAUSA_HORAS * 3600 * 1000));
}

function botEstaPausada(conversacionId) {
  const props = PropertiesService.getScriptProperties();
  const hasta = Number(props.getProperty(BOT_PAUSA_PREFIJO + conversacionId));
  if (!hasta) return false;
  if (Date.now() < hasta) return true;
  props.deleteProperty(BOT_PAUSA_PREFIJO + conversacionId);
  return false;
}

// Desde el editor: botReanudarConversacion("2131509035")
function botReanudarConversacion(conversacionId) {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(BOT_PAUSA_PREFIJO + String(conversacionId));
  props.deleteProperty(BOT_HUMANO_PREFIJO + String(conversacionId));
}

// Respuesta mientras está pausada. Devuelve null cuando Maite debe contestar normal (Alex, 11-nov-2026: "es importante que
// siempre esté lista").
//  - Mientras siga PENDIENTE (nadie la ha tomado), Maite sigue ayudando; el aviso al equipo ya salió y los recordatorios
//    siguen saliendo de botRecordatoriosPendientes hasta que alguien la marque ATENDIDA.
//  - Cuando una persona la marca ATENDIDA, Maite calla BOT_HUMANO_MINUTOS para no encimarse; pasado ese lapso vuelve a
//    contestar sola. El sistema no ve lo que la persona escribe desde Instagram o WhatsApp: si necesita más tiempo, vuelve a
//    tocar ATENDIDA. Lo que conteste desde la Bandeja de ManyChat pausa a Maite desde ManyChat mismo.
function botRespuestaPausada(conversacionId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pendiente = _botPendienteDe(ss, conversacionId);
  if (pendiente) _botPendienteAnotarMensaje(ss, pendiente.fila);
  if (!pendiente || pendiente.estado !== PENDIENTE_ESTADO.ATENDIDA) return null;
  const props = PropertiesService.getScriptProperties();
  const desde = Number(props.getProperty(BOT_HUMANO_PREFIJO + conversacionId)) || _botMarcarHumano(conversacionId);   // ATENDIDA puesta a mano en la hoja: cuenta desde ahora
  if (Date.now() - desde < BOT_HUMANO_MINUTOS * 60000) return { ok: true, respuesta: "", handoff: true, alerta: "atendida_por_persona", pausada: true };
  botReanudarConversacion(conversacionId);
  return null;
}

function _botMarcarHumano(conversacionId) {
  const ahora = Date.now();
  PropertiesService.getScriptProperties().setProperty(BOT_HUMANO_PREFIJO + conversacionId, String(ahora));
  return ahora;
}

// ---------------------------------------------------------------------------
// CONVERSACIONES PENDIENTES: recordatorio urgente cada BOT_RECORDATORIO_MINUTOS hasta que alguien la marque ATENDIDA
//
// Cada traspaso a una persona abre un renglón PENDIENTE en `Conversaciones_Pendientes`. Quien la atiende cambia el Estado
// a ATENDIDA (menú desplegable) y los recordatorios paran. El sistema no ve lo que se contesta desde Instagram o WhatsApp,
// así que esa marca es la única forma de saber que ya llegó alguien. Tope: BOT_RECORDATORIOS_MAX; solo mientras
// haya alguna sucursal abierta (HORARIOS_SUCURSAL): con la tienda cerrada no se recuerda y se retoma al abrir.
// Lo corre la revisión del tablero cada 5 min (tableroPedidosActualizar).
// ---------------------------------------------------------------------------
const PENDIENTE_COL = { CONVERSACION: 0, CANAL: 1, DESDE: 2, MOTIVO: 3, ESTADO: 4, RECORDATORIOS: 5, ULTIMO: 6, MENSAJE_CLIENTE: 7 };
const PENDIENTE_COLUMNAS = 8;

function botPendienteRegistrar(ss, conversacionId, canal, tipo, resumen) {
  try {
    let hoja = ss.getSheetByName(PENDIENTES_HOJA);
    if (!hoja) {
      hoja = ss.insertSheet(PENDIENTES_HOJA);
      hoja.getRange(1, 1, 1, PENDIENTE_COLUMNAS).setValues([["Conversación", "Canal", "Desde", "Motivo", "Estado", "Recordatorios", "Último recordatorio", "Último mensaje del cliente"]]).setFontWeight("bold");
      hoja.setFrozenRows(1);
    }
    const ahora = Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd HH:mm");
    hoja.appendRow([conversacionId, canal, ahora, tipo + ": " + resumen, PENDIENTE_ESTADO.PENDIENTE, 0, "", ahora]);
    const ultima = hoja.getLastRow();
    try { hoja.getRange(ultima, PENDIENTE_COL.ESTADO + 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList([PENDIENTE_ESTADO.PENDIENTE, PENDIENTE_ESTADO.ATENDIDA], true).build()); } catch (e) { }
  } catch (e) { }
}

// Hay tienda abierta si alguna sucursal está en su horario de atención (HORARIOS_SUCURSAL, la única fuente).
function _botTiendaAbierta(dow, minutosDelDia) {
  return SUCURSALES.some(function (sucursal) {
    const horario = (HORARIOS_SUCURSAL[sucursal] || [])[dow];
    if (!horario || horario.cerrado) return false;
    return minutosDelDia >= _hhmmAMinutos(horario.abre) && minutosDelDia < _hhmmAMinutos(horario.cierra);
  });
}
function _hhmmAMinutos(hhmm) { const p = String(hhmm).split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); }

// El último renglón de esa conversación: { fila, estado } o null.
function _botPendienteDe(ss, conversacionId) {
  const hoja = ss.getSheetByName(PENDIENTES_HOJA);
  if (!hoja || hoja.getLastRow() < 2) return null;
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, PENDIENTE_COLUMNAS).getValues();
  for (let i = filas.length - 1; i >= 0; i--) {
    if (String(filas[i][PENDIENTE_COL.CONVERSACION]) === String(conversacionId)) {
      return { fila: i + 2, estado: String(filas[i][PENDIENTE_COL.ESTADO]) };
    }
  }
  return null;
}

// Números de renglón de esa conversación que siguen PENDIENTE.
function _botFilasPendientes(hoja, conversacionId) {
  if (!hoja || hoja.getLastRow() < 2) return [];
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, PENDIENTE_COLUMNAS).getValues(), out = [];
  filas.forEach(function (f, i) {
    if (String(f[PENDIENTE_COL.CONVERSACION]) === String(conversacionId) && String(f[PENDIENTE_COL.ESTADO]) === PENDIENTE_ESTADO.PENDIENTE) out.push(i + 2);
  });
  return out;
}

function _botPendienteAnotarMensaje(ss, fila) {
  try { ss.getSheetByName(PENDIENTES_HOJA).getRange(fila, PENDIENTE_COL.MENSAJE_CLIENTE + 1).setValue(Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd HH:mm")); } catch (e) { }
}

// Milisegundos de una fecha "yyyy-MM-dd HH:mm" de la hoja (hora de México).
function _pendienteDesdeMs(texto) {
  if (texto instanceof Date) return texto.getTime();   // la hoja convierte "yyyy-MM-dd HH:mm" en fecha: antes daba 0 y "lleva 29 millones de min"
  const m = String(texto).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + MX_OFFSET_HORAS, +m[5]) : 0;
}

// Lo de los últimos BOT_PENDIENTE_DIAS_RECORDAR días se recuerda (algo que quedó pendiente a las 18:00 se recuerda al abrir).
function _pendienteEsReciente(desde, ahoraFecha) {
  const ms = _pendienteDesdeMs(desde);
  return !!ms && ahoraFecha.getTime() - ms < BOT_PENDIENTE_DIAS_RECORDAR * 86400000;
}

// Cada conversación se recuerda cada BOT_RECORDATORIO_MINUTOS. `ahora` solo se pasa en las pruebas.
function botRecordatoriosPendientes(ahora) {
  if (!BOT_RECORDATORIOS_ACTIVOS) return { enviados: 0, apagado: true };   // apagado de emergencia
  // Lo corren su trigger (si está instalado) y la revisión del tablero de cada 5 min: el candado evita que dos corridas
  // al mismo tiempo manden el mismo recordatorio dos veces.
  const cache = CacheService.getScriptCache();
  if (cache.get("recordatorios_corriendo")) return { enviados: 0, omitido: "ya hay una corrida en marcha" };
  cache.put("recordatorios_corriendo", "1", 120);
  try { return _botRecordar(ahora); } finally { cache.remove("recordatorios_corriendo"); }
}

function _botRecordar(ahora) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(PENDIENTES_HOJA);
  if (!hoja || hoja.getLastRow() < 2) return { enviados: 0 };
  const ahoraFecha = ahora instanceof Date ? ahora : new Date();   // el trigger pasa un evento, no una fecha
  const dow = Number(Utilities.formatDate(ahoraFecha, TZ_MX, "u")) % 7;   // 0 = domingo
  const minutosDelDia = Number(Utilities.formatDate(ahoraFecha, TZ_MX, "H")) * 60 + Number(Utilities.formatDate(ahoraFecha, TZ_MX, "m"));
  if (!_botTiendaAbierta(dow, minutosDelDia)) return { enviados: 0, tiendaCerrada: true };
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues();
  let enviados = 0;
  // Un recordatorio por CONVERSACIÓN, aunque tenga varios renglones pendientes (p. ej. queja y luego "pidió persona"):
  // manda el más antiguo y los demás renglones de esa conversación siguen su mismo paso (24-nov: llegaban dos por cliente).
  const grupos = {}, orden = [];
  filas.forEach(function (f, i) {
    if (String(f[PENDIENTE_COL.ESTADO]) !== PENDIENTE_ESTADO.PENDIENTE) return;
    // Lo viejo se cierra sin avisar (12-nov: pruebas de días atrás sonaban toda la mañana).
    if (!_pendienteEsReciente(f[PENDIENTE_COL.DESDE], ahoraFecha)) { hoja.getRange(i + 2, PENDIENTE_COL.ESTADO + 1).setValue(PENDIENTE_ESTADO.SIN_ATENDER); return; }
    const id = String(f[PENDIENTE_COL.CONVERSACION]);
    if (!grupos[id]) { grupos[id] = []; orden.push(id); }
    grupos[id].push({ f: f, fila: i + 2 });
  });
  orden.forEach(function (id) {
    const f = grupos[id][0].f, renglones = grupos[id].map(function (g) { return g.fila; });
    const hechos = Number(f[PENDIENTE_COL.RECORDATORIOS]) || 0;
    const desde = _pendienteDesdeMs(f[PENDIENTE_COL.DESDE]);
    const ultimo = _pendienteDesdeMs(f[PENDIENTE_COL.ULTIMO]) || desde;
    if (ahoraFecha.getTime() - ultimo < BOT_RECORDATORIO_MINUTOS * 60000) return;
    const descripcion = grupos[id].map(function (g) { return _botDescripcionPendiente(g.f[PENDIENTE_COL.MOTIVO]); }).join("\n📝 ");
    if (hechos >= BOT_RECORDATORIOS_MAX) {
      renglones.forEach(function (fila) { hoja.getRange(fila, PENDIENTE_COL.ESTADO + 1).setValue(PENDIENTE_ESTADO.SIN_ATENDER); });
      botAlertaPersonal(ss, "recordatorio_final", "cliente_esperando", "🚨 Nadie atendió a un cliente", "⏱️ Pasaron " + _botHace(ahoraFecha.getTime() - desde) + " y se acabaron los recordatorios.\n" + botDetalleAlerta(f[PENDIENTE_COL.CANAL], descripcion, id), id);
      return;
    }
    botAlertaPersonal(ss, "recordatorio" + (hechos + 1), "cliente_esperando", "⏰ Pendiente sin atender (" + (hechos + 1) + " de " + BOT_RECORDATORIOS_MAX + ")",
      "⏱️ Lleva " + _botHace(ahoraFecha.getTime() - desde) + " esperando.\n" + botDetalleAlerta(f[PENDIENTE_COL.CANAL], descripcion, id) + "\n👉 Al atenderlo toca *Atendida* (o cámbialo en " + PENDIENTES_HOJA + ").", id);
    const cuando = Utilities.formatDate(ahoraFecha, TZ_MX, "yyyy-MM-dd HH:mm");
    renglones.forEach(function (fila) {
      hoja.getRange(fila, PENDIENTE_COL.RECORDATORIOS + 1).setValue(hechos + 1);
      hoja.getRange(fila, PENDIENTE_COL.ULTIMO + 1).setValue(cuando);
    });
    enviados++;
  });
  return { enviados: enviados };
}

// Ya no hace falta un trigger propio: lo corre tableroPedidosActualizar cada 5 min. Esto quita el viejo, si quedó instalado.
function quitarTriggerRecordatoriosPendientes() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "botRecordatoriosPendientes") ScriptApp.deleteTrigger(t); });
}
