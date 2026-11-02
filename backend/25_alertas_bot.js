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
const BOT_TEXTO_PAUSA = "Ya le avisé al equipo y una persona te escribe personalmente en cuanto pueda ❤️";
const BOT_TEXTO_DISCULPA = "Una disculpa por la espera 🙏 Ya le recordé al equipo que sigues aquí, y alguien te escribe personalmente lo antes posible ❤️";
const ALERTA_URGENTES = ["queja_u_observacion", "mensajero", "cliente_esperando", "amenaza_o_legal"];

function botAlertaPersonal(ss, origen, tipo, titulo, detalle, conversacionId) {
  const clave = "bot_alerta_" + origen + "_" + tipo + "_" + conversacionId;
  const cache = CacheService.getScriptCache();
  let aviso;
  if (cache.get(clave)) {
    aviso = { configurado: false, motivo: "ya se avisó hace poco de lo mismo en esta conversación", destinatarios: [], resultados: [] };
  } else {
    cache.put(clave, "1", BOT_ALERTA_REPETIDA_SEGUNDOS);
    aviso = manychatAvisarEquipo(ss, MANYCHAT_CLAVE_FLUJO_ALERTA, titulo, detalle, MANYCHAT_MAX_ALERTA, [{ nombre: MANYCHAT_CAMPO_CONVERSACION, valor: String(conversacionId) }]);
    // El texto sugerido va en un mensaje APARTE, solo con el texto, para copiarlo y pegarlo de un toque. Los recordatorios no lo repiten.
    if (aviso.configurado && !/^recordatorio/.test(origen)) aviso.sugerencia = manychatSugerenciaEquipo(ss, _botSugerenciaCliente(tipo));
  }
  _botRegistrarAlerta(ss, origen, tipo, conversacionId, titulo, detalle, aviso);
  return aviso;
}

// El cuerpo de toda alerta, un dato por renglón (en la plantilla los renglones se vuelven " | ").
function botDetalleAlerta(canal, texto, conversacionId) {
  return "📱 " + (canal || "Instagram") + "\n💬 " + String(texto || "").trim() + "\n🔎 Conversación " + conversacionId;
}

// Texto que Rebeca o Yessenia copian y pegan al cliente al tomar la conversación: listo para pegar, sin huecos que llenar ni promesas (reembolsos, fechas).
const BOT_SUGERENCIAS_CLIENTE = {
  queja_u_observacion: "Hola, te escribe el equipo de La Tarta Vasca. Lamento mucho lo que pasó; ya lo estoy revisando personalmente y te escribo en un momento.",
  mensajero: "Hola, te escribe el equipo de La Tarta Vasca. Tengo tu aviso del mensajero; ¿a nombre de quién lo recoge y a qué hora aproximada?",
  cotizacion_evento_o_restaurante: "Hola, te escribe el equipo de La Tarta Vasca. Gracias por pensar en nosotros; ¿me cuentas la fecha, cuántas piezas y el lugar para cotizarte?",
  factura: "Hola, te escribe el equipo de La Tarta Vasca. Con gusto te ayudo con tu factura; ¿me compartes tus datos fiscales y el número de tu pedido?",
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
  hoja.getRange(pendiente.fila, PENDIENTE_COL.ESTADO + 1).setValue(PENDIENTE_ESTADO.ATENDIDA);
  _botPendienteAnotarMensaje(ss, pendiente.fila);
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
  PropertiesService.getScriptProperties().deleteProperty(BOT_PAUSA_PREFIJO + String(conversacionId));
}

// Minutos que lleva pausada la conversación (la pausa guarda cuándo termina: inicio = fin - BOT_PAUSA_HORAS).
function _botMinutosPausada(conversacionId) {
  const hasta = Number(PropertiesService.getScriptProperties().getProperty(BOT_PAUSA_PREFIJO + conversacionId));
  return hasta ? (Date.now() - (hasta - BOT_PAUSA_HORAS * 3600 * 1000)) / 60000 : 0;
}

// Respuesta mientras está pausada. Devuelve null si la conversación ya terminó con la persona y Maite vuelve a participar.
//  - Si la persona ya la marcó ATENDIDA: Maite calla mientras el cliente siga conversando; cuando pasan BOT_REENGANCHE_HORAS
//    sin que el cliente escriba y vuelve a escribir, se considera una conversación nueva y Maite se reincorpora.
//  - Si sigue PENDIENTE y el cliente insiste (BOT_DISCULPA_MINUTOS), Maite se disculpa por la espera; si no, el aviso va
//    una sola vez por hora y luego silencio.
// Los recordatorios al equipo no salen de aquí sino de botRecordatoriosPendientes (cada BOT_RECORDATORIO_MINUTOS).
function botRespuestaPausada(conversacionId) {
  const cache = CacheService.getScriptCache();
  const pendiente = _botPendienteDe(SpreadsheetApp.getActiveSpreadsheet(), conversacionId);
  if (pendiente && pendiente.estado === PENDIENTE_ESTADO.ATENDIDA) {
    const silencio = Date.now() - pendiente.ultimoMensajeMs;
    _botPendienteAnotarMensaje(SpreadsheetApp.getActiveSpreadsheet(), pendiente.fila);
    if (silencio > BOT_REENGANCHE_HORAS * 3600000) { botReanudarConversacion(conversacionId); return null; }
    return { ok: true, respuesta: "", handoff: true, alerta: "atendida_por_persona", pausada: true };
  }
  const minutos = _botMinutosPausada(conversacionId);
  if (minutos >= BOT_DISCULPA_MINUTOS && !cache.get("bot_pausa_disculpa_" + conversacionId)) {
    cache.put("bot_pausa_disculpa_" + conversacionId, "1", BOT_DISCULPA_MINUTOS * 60);
    return { ok: true, respuesta: BOT_TEXTO_DISCULPA, handoff: true, alerta: "cliente_esperando", pausada: true };
  }
  const clave = "bot_pausa_avisada_" + conversacionId;
  const primera = !cache.get(clave);
  if (primera) cache.put(clave, "1", 3600);
  return { ok: true, respuesta: primera ? BOT_TEXTO_PAUSA : "", handoff: true, alerta: "pausada", pausada: true };
}

// ---------------------------------------------------------------------------
// CONVERSACIONES PENDIENTES: recordatorio urgente cada BOT_RECORDATORIO_MINUTOS hasta que alguien la marque ATENDIDA
//
// Cada traspaso a una persona abre un renglón PENDIENTE en `Conversaciones_Pendientes`. Quien la atiende cambia el Estado
// a ATENDIDA (menú desplegable) y los recordatorios paran. El sistema no ve lo que se contesta desde Instagram o WhatsApp,
// así que esa marca es la única forma de saber que ya llegó alguien. Tope: BOT_RECORDATORIOS_MAX; solo mientras
// haya alguna sucursal abierta (HORARIOS_SUCURSAL): con la tienda cerrada no se recuerda y se retoma al abrir.
// Se instala una vez con instalarRecordatoriosPendientes().
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

// El último renglón de esa conversación: { fila, estado, ultimoMensajeMs } o null.
function _botPendienteDe(ss, conversacionId) {
  const hoja = ss.getSheetByName(PENDIENTES_HOJA);
  if (!hoja || hoja.getLastRow() < 2) return null;
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, PENDIENTE_COLUMNAS).getValues();
  for (let i = filas.length - 1; i >= 0; i--) {
    if (String(filas[i][PENDIENTE_COL.CONVERSACION]) === String(conversacionId)) {
      return { fila: i + 2, estado: String(filas[i][PENDIENTE_COL.ESTADO]), ultimoMensajeMs: _pendienteDesdeMs(filas[i][PENDIENTE_COL.MENSAJE_CLIENTE]) || _pendienteDesdeMs(filas[i][PENDIENTE_COL.DESDE]) };
    }
  }
  return null;
}

function _botPendienteAnotarMensaje(ss, fila) {
  try { ss.getSheetByName(PENDIENTES_HOJA).getRange(fila, PENDIENTE_COL.MENSAJE_CLIENTE + 1).setValue(Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd HH:mm")); } catch (e) { }
}

// Milisegundos de una fecha "yyyy-MM-dd HH:mm" de la hoja (hora de México).
function _pendienteDesdeMs(texto) {
  const m = String(texto).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + MX_OFFSET_HORAS, +m[5]) : 0;
}

// Trigger cada BOT_RECORDATORIO_MINUTOS. `ahora` solo se pasa en las pruebas.
function botRecordatoriosPendientes(ahora) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(PENDIENTES_HOJA);
  if (!hoja || hoja.getLastRow() < 2) return { enviados: 0 };
  const ahoraFecha = ahora instanceof Date ? ahora : new Date();   // el trigger pasa un evento, no una fecha
  const dow = Number(Utilities.formatDate(ahoraFecha, TZ_MX, "u")) % 7;   // 0 = domingo
  const minutosDelDia = Number(Utilities.formatDate(ahoraFecha, TZ_MX, "H")) * 60 + Number(Utilities.formatDate(ahoraFecha, TZ_MX, "m"));
  if (!_botTiendaAbierta(dow, minutosDelDia)) return { enviados: 0, tiendaCerrada: true };
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues();
  let enviados = 0;
  filas.forEach(function (f, i) {
    if (String(f[PENDIENTE_COL.ESTADO]) !== PENDIENTE_ESTADO.PENDIENTE) return;
    const hechos = Number(f[PENDIENTE_COL.RECORDATORIOS]) || 0;
    const desde = _pendienteDesdeMs(f[PENDIENTE_COL.DESDE]);
    const ultimo = _pendienteDesdeMs(f[PENDIENTE_COL.ULTIMO]) || desde;
    const minutos = Math.round((ahoraFecha.getTime() - desde) / 60000);
    if (ahoraFecha.getTime() - ultimo < BOT_RECORDATORIO_MINUTOS * 60000) return;
    const fila = i + 2;
    if (hechos >= BOT_RECORDATORIOS_MAX) {
      hoja.getRange(fila, PENDIENTE_COL.ESTADO + 1).setValue(PENDIENTE_ESTADO.SIN_ATENDER);
      botAlertaPersonal(ss, "recordatorio_final", "cliente_esperando", "🚨 Nadie atendió a un cliente", "⏱️ Pasaron " + minutos + " min y se acabaron los recordatorios.\n" + botDetalleAlerta(f[PENDIENTE_COL.CANAL], f[PENDIENTE_COL.MOTIVO], f[PENDIENTE_COL.CONVERSACION]), f[PENDIENTE_COL.CONVERSACION]);
      return;
    }
    botAlertaPersonal(ss, "recordatorio" + (hechos + 1), "cliente_esperando", "⏰ Un cliente espera a una persona (" + (hechos + 1) + ")",
      "⏱️ Lleva " + minutos + " min esperando.\n" + botDetalleAlerta(f[PENDIENTE_COL.CANAL], f[PENDIENTE_COL.MOTIVO], f[PENDIENTE_COL.CONVERSACION]) + "\n👉 Al atenderlo toca *Atendida* (o cámbialo en " + PENDIENTES_HOJA + ").", f[PENDIENTE_COL.CONVERSACION]);
    hoja.getRange(fila, PENDIENTE_COL.RECORDATORIOS + 1).setValue(hechos + 1);
    hoja.getRange(fila, PENDIENTE_COL.ULTIMO + 1).setValue(Utilities.formatDate(ahoraFecha, TZ_MX, "yyyy-MM-dd HH:mm"));
    enviados++;
  });
  return { enviados: enviados };
}

function instalarRecordatoriosPendientes() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "botRecordatoriosPendientes") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("botRecordatoriosPendientes").timeBased().everyMinutes(BOT_RECORDATORIO_MINUTOS).create();
}
