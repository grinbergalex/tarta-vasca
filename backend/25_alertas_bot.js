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
const ALERTA_URGENTES = ["queja_u_observacion", "mensajero", "cliente_esperando"];

function botAlertaPersonal(ss, origen, tipo, titulo, detalle, conversacionId) {
  const clave = "bot_alerta_" + origen + "_" + tipo + "_" + conversacionId;
  const cache = CacheService.getScriptCache();
  let aviso;
  if (cache.get(clave)) {
    aviso = { configurado: false, motivo: "ya se avisó hace poco de lo mismo en esta conversación", destinatarios: [], resultados: [] };
  } else {
    cache.put(clave, "1", BOT_ALERTA_REPETIDA_SEGUNDOS);
    aviso = manychatAvisarEquipo(ss, MANYCHAT_CLAVE_FLUJO_ALERTA, titulo, detalle, MANYCHAT_MAX_DETALLE);
  }
  _botRegistrarAlerta(ss, origen, tipo, conversacionId, titulo, detalle, aviso);
  return aviso;
}

function _botRegistrarAlerta(ss, origen, tipo, conversacionId, titulo, detalle, aviso) {
  try {
    let hoja = ss.getSheetByName(ALERTAS_BOT_HOJA);
    if (!hoja) {
      hoja = ss.insertSheet(ALERTAS_BOT_HOJA);
      hoja.getRange(1, 1, 1, 7).setValues([["Fecha y hora", "Tipo", "Urgente", "Conversación", "Título", "Detalle", "Resultado"]]).setFontWeight("bold");
      hoja.setFrozenRows(1);
    }
    const fila = [Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd HH:mm"), tipo + " (" + origen + ")", ALERTA_URGENTES.indexOf(tipo) !== -1 ? "SÍ" : "", conversacionId, titulo, detalle, _pedidoResultadoAviso(aviso)];
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

// Respuesta mientras está pausada. Si el cliente sigue escribiendo y la persona no ha llegado (BOT_DISCULPA_MINUTOS),
// Maite se disculpa por la espera y se le recuerda al equipo; si no, el aviso va una sola vez por hora y luego silencio.
function botRespuestaPausada(conversacionId) {
  const cache = CacheService.getScriptCache();
  const minutos = _botMinutosPausada(conversacionId);
  if (minutos >= BOT_DISCULPA_MINUTOS && !cache.get("bot_pausa_disculpa_" + conversacionId)) {
    cache.put("bot_pausa_disculpa_" + conversacionId, "1", BOT_DISCULPA_MINUTOS * 60);
    botAlertaPersonal(SpreadsheetApp.getActiveSpreadsheet(), "recordatorio", "cliente_esperando", "⏰ Un cliente sigue esperando a una persona",
      "Lleva " + Math.round(minutos) + " min esperando y volvió a escribir (conv. " + conversacionId + ")", conversacionId);
    return { ok: true, respuesta: BOT_TEXTO_DISCULPA, handoff: true, alerta: "cliente_esperando", pausada: true };
  }
  const clave = "bot_pausa_avisada_" + conversacionId;
  const primera = !cache.get(clave);
  if (primera) cache.put(clave, "1", 3600);
  return { ok: true, respuesta: primera ? BOT_TEXTO_PAUSA : "", handoff: true, alerta: "pausada", pausada: true };
}
