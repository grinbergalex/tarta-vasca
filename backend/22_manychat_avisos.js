// ============================================================================
// v9 — MENSAJES POR MANYCHAT (la línea 55 8803 9327 está conectada a ManyChat, no a la API directa de Meta)
//
// ManyChat no deja mandar una plantilla de WhatsApp (ni un mensaje fuera de la ventana de 24 h) directo por la API: se llena
// el contenido en campos del contacto y se manda un FLUJO de ManyChat cuyo único paso es el mensaje (la plantilla aprobada,
// o un texto normal dentro de la ventana de 24 h). Hay cuatro flujos, todos con campos del contacto como variables:
//   aviso de pedido para hoy ........ campos aviso_referencia y aviso_detalle        (manychat_flujo_aviso)
//   reporte de la noche ............. campos aviso_referencia y aviso_detalle        (manychat_flujo_reporte)
//   mensaje al cliente, Instagram ... campo mensaje_cliente                           (manychat_flujo_cliente_instagram)
//   mensaje al cliente, WhatsApp .... campo mensaje_cliente                           (manychat_flujo_cliente_whatsapp)
//
// La clave de la API vive en Propiedades del script (MANYCHAT_API_TOKEN), nunca en el código ni en el chat.
// La hoja Configuración trae el resto (lo edita el equipo):
//   aviso_hoy_manychat   quién recibe avisos y reportes, como "Yessenia:19277176,Rebeca:112452108"
//                        (el número es el id del contacto en ManyChat: sale de su URL en Contactos)
//   manychat_flujo_*     identificador (ns) de cada flujo
// Para que alguien del equipo pueda recibirlo tiene que haber escrito alguna vez a la línea (así existe como contacto).
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

// Llena los campos del contacto y manda el flujo. campos: [{ nombre, valor }]. Devuelve { ok, detalle }.
function _manychatEnviarFlujo(idContacto, flujo, campos) {
  const llenado = _manychatLlamar("post", "/fb/subscriber/setCustomFields", {
    subscriber_id: Number(idContacto),
    fields: campos.map(function (c) { return { field_name: c.nombre, field_value: c.valor }; })
  });
  if (!llenado.ok) return { ok: false, detalle: "campos " + llenado.codigo + " " + JSON.stringify(llenado.cuerpo).substring(0, 150) };
  const envio = _manychatLlamar("post", "/fb/sending/sendFlow", { subscriber_id: Number(idContacto), flow_ns: flujo });
  return { ok: envio.ok, detalle: envio.ok ? "" : "flujo " + envio.codigo + " " + JSON.stringify(envio.cuerpo).substring(0, 150) };
}

// Avisa al equipo (Yessenia y Rebeca) con un flujo de dos campos: título y detalle.
// Devuelve { configurado, motivo, destinatarios, resultados:[{ nombre, ok, detalle }] }.
function manychatAvisarEquipo(ss, claveFlujo, titulo, detalle, maximo, camposExtra) {
  const destinatarios = _manychatDestinatarios(ss);
  const flujo = String(_cfgVal(ss, claveFlujo, "")).trim();
  const salida = { configurado: false, motivo: "", destinatarios: destinatarios, resultados: [] };
  if (!_manychatToken()) { salida.motivo = "falta MANYCHAT_API_TOKEN en Propiedades del script"; return salida; }
  if (!flujo) { salida.motivo = "falta " + claveFlujo + " en Configuración"; return salida; }
  if (!destinatarios.length) { salida.motivo = "falta " + MANYCHAT_CLAVE_DESTINOS_HOY + " en Configuración"; return salida; }
  salida.configurado = true;
  const campos = [{ nombre: MANYCHAT_CAMPO_REFERENCIA, valor: _whatsappLimpiar(titulo, MANYCHAT_MAX_DETALLE) }, { nombre: MANYCHAT_CAMPO_DETALLE, valor: _whatsappLimpiar(detalle, maximo || MANYCHAT_MAX_DETALLE) }].concat(camposExtra || []);
  destinatarios.forEach(function (d) {
    const r = _manychatEnviarFlujo(d.id, flujo, campos);
    salida.resultados.push({ nombre: d.nombre || d.id, ok: r.ok, detalle: r.detalle });
  });
  return salida;
}

function manychatAvisarPedidoHoy(ss, referencia, detalle) {
  return manychatAvisarEquipo(ss, MANYCHAT_CLAVE_FLUJO_AVISO, referencia, detalle, MANYCHAT_MAX_DETALLE);
}

// Un mensaje proactivo a UN cliente por su canal. Devuelve { configurado, ok, detalle }.
function manychatMensajeCliente(ss, idContacto, canal, texto) {
  const clave = canal === "WhatsApp" ? MANYCHAT_CLAVE_FLUJO_WHATSAPP : MANYCHAT_CLAVE_FLUJO_INSTAGRAM;
  const flujo = String(_cfgVal(ss, clave, "")).trim();
  if (!_manychatToken()) return { configurado: false, ok: false, detalle: "falta MANYCHAT_API_TOKEN en Propiedades del script" };
  if (!flujo) return { configurado: false, ok: false, detalle: "falta " + clave + " en Configuración" };
  if (!/^\d+$/.test(String(idContacto || ""))) return { configurado: true, ok: false, detalle: "SIN CANAL: el pedido no trae el id de contacto de ManyChat" };
  const r = _manychatEnviarFlujo(idContacto, flujo, [{ nombre: MANYCHAT_CAMPO_MENSAJE, valor: _whatsappLimpiar(texto, 1000) }]);
  return { configurado: true, ok: r.ok, detalle: r.detalle };
}

// Manda el texto sugerido como mensaje aparte a quienes reciben las alertas (flujo de un solo paso con el campo bot_sugerencia).
// Devuelve un texto corto para la hoja Alertas_Bot.
function manychatSugerenciaEquipo(ss, texto) {
  const flujo = String(_cfgVal(ss, MANYCHAT_CLAVE_FLUJO_SUGERENCIA, "")).trim();
  if (!flujo) return "sin flujo de sugerencia";
  const resultados = _manychatDestinatarios(ss).map(function (d) {
    const r = _manychatEnviarFlujo(d.id, flujo, [{ nombre: MANYCHAT_CAMPO_SUGERENCIA, valor: _whatsappLimpiar(texto, MANYCHAT_MAX_ALERTA) }]);
    return (d.nombre || d.id) + (r.ok ? " ok" : " FALLÓ " + r.detalle);
  });
  return resultados.join(", ");
}
