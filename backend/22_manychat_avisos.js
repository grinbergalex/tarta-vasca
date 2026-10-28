// ============================================================================
// v9 — AVISOS POR MANYCHAT (la línea 55 8803 9327 está conectada a ManyChat, no a la API directa de Meta)
//
// ManyChat no deja mandar una plantilla de WhatsApp directo por la API: se llena el contenido en dos campos del contacto
// (aviso_referencia y aviso_detalle) y se manda un FLUJO de ManyChat cuyo único paso es la plantilla aprobada
// "aviso_pedido_hoy", que usa esos dos campos como variables.
//
// La clave de la API vive en Propiedades del script (MANYCHAT_API_TOKEN), nunca en el código ni en el chat.
// La hoja Configuración trae el resto (lo edita el equipo):
//   aviso_hoy_manychat   quién recibe los pedidos para hoy, como "Yessenia:19277176,Rebeca:112452108"
//                        (el número es el id del contacto en ManyChat: sale de su URL en Contactos)
//   manychat_flujo_aviso identificador (ns) del flujo que manda la plantilla
// Para que alguien pueda recibirlo tiene que haber escrito alguna vez a la línea (así existe como contacto).
// ============================================================================

function _manychatToken() {
  return PropertiesService.getScriptProperties().getProperty("MANYCHAT_API_TOKEN") || "";
}

// Devuelve { ok, codigo, cuerpo }. Nunca lanza error: un aviso que falla no debe tirar el pedido.
function _manychatLlamar(metodo, ruta, cuerpo) {
  try {
    const opciones = { method: metodo, headers: { Authorization: "Bearer " + _manychatToken(), Accept: "application/json" }, muteHttpExceptions: true };
    if (cuerpo) { opciones.contentType = "application/json"; opciones.payload = JSON.stringify(cuerpo); }
    const r = UrlFetchApp.fetch(MANYCHAT_API_URL + ruta, opciones);
    let json = null;
    try { json = JSON.parse(r.getContentText()); } catch (e) { }
    const codigo = r.getResponseCode();
    return { ok: codigo === 200 && !!json && json.status === "success", codigo: codigo, cuerpo: json || String(r.getContentText()).substring(0, 200) };
  } catch (e) { return { ok: false, codigo: 0, cuerpo: String(e && e.message || e) }; }
}

// "Nombre:id,Nombre:id" -> [{ nombre, id }]
function _manychatDestinatarios(ss) {
  return String(_cfgVal(ss, MANYCHAT_CLAVE_DESTINOS_HOY, "")).split(/[,;]+/).map(function (parte) {
    const i = parte.indexOf(":");
    return { nombre: i === -1 ? "" : parte.substring(0, i).trim(), id: (i === -1 ? parte : parte.substring(i + 1)).replace(/\D/g, "") };
  }).filter(function (d) { return d.id.length > 0; });
}

function _manychatLimpiar(texto) {
  return _whatsappLimpiar(texto, MANYCHAT_MAX_DETALLE);
}

// Llena los dos campos del contacto y manda el flujo con la plantilla. Devuelve { ok, detalle }.
function _manychatEnviarFlujo(idContacto, flujo, referencia, detalle) {
  const campos = _manychatLlamar("post", "/fb/subscriber/setCustomFields", {
    subscriber_id: Number(idContacto),
    fields: [{ field_name: MANYCHAT_CAMPO_REFERENCIA, field_value: _manychatLimpiar(referencia) }, { field_name: MANYCHAT_CAMPO_DETALLE, field_value: _manychatLimpiar(detalle) }]
  });
  if (!campos.ok) return { ok: false, detalle: "campos " + campos.codigo + " " + JSON.stringify(campos.cuerpo).substring(0, 150) };
  const envio = _manychatLlamar("post", "/fb/sending/sendFlow", { subscriber_id: Number(idContacto), flow_ns: flujo });
  return { ok: envio.ok, detalle: envio.ok ? "" : "flujo " + envio.codigo + " " + JSON.stringify(envio.cuerpo).substring(0, 150) };
}

// Avisa a cada destinatario. Devuelve { configurado, motivo, destinatarios, resultados:[{ nombre, ok, detalle }] }.
function manychatAvisarPedidoHoy(ss, referencia, detalle) {
  const destinatarios = _manychatDestinatarios(ss);
  const flujo = String(_cfgVal(ss, MANYCHAT_CLAVE_FLUJO_AVISO, "")).trim();
  const salida = { configurado: false, motivo: "", destinatarios: destinatarios, resultados: [] };
  if (!_manychatToken()) { salida.motivo = "falta MANYCHAT_API_TOKEN en Propiedades del script"; return salida; }
  if (!flujo) { salida.motivo = "falta " + MANYCHAT_CLAVE_FLUJO_AVISO + " en Configuración"; return salida; }
  if (!destinatarios.length) { salida.motivo = "falta " + MANYCHAT_CLAVE_DESTINOS_HOY + " en Configuración"; return salida; }
  salida.configurado = true;
  destinatarios.forEach(function (d) {
    const r = _manychatEnviarFlujo(d.id, flujo, referencia, detalle);
    salida.resultados.push({ nombre: d.nombre || d.id, ok: r.ok, detalle: r.detalle });
  });
  return salida;
}
