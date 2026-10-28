// ============================================================================
// v9 — AVISOS AL EQUIPO POR WHATSAPP (API oficial de Meta, con plantilla aprobada)
//
// Sin claves configuradas no hace nada (los avisos siguen saliendo por el mensaje interno del sistema y el correo).
// Las claves NUNCA van en el código: viven en Propiedades del script.
//   WHATSAPP_TOKEN     token permanente de la app de Meta (usuario del sistema)
//   WHATSAPP_PHONE_ID  id del número remitente (no es el número: lo da Meta Business)
// La hoja Configuración trae el resto (las edita el equipo):
//   aviso_whatsapp_numeros   números que reciben el aviso, separados por coma, con lada de país: 525588039327
//   aviso_whatsapp_resumen   números que reciben ADEMÁS el resumen de pedidos sin confirmar (la Dueña)
//   aviso_whatsapp_plantilla nombre de la plantilla aprobada (por defecto WHATSAPP_PLANTILLA_DEFECTO)
// La plantilla lleva dos variables de texto: {{1}} el asunto y {{2}} el detalle. WhatsApp no permite saltos de línea
// ni más de 3 espacios seguidos dentro de una variable, por eso se limpia el texto.
// ============================================================================

function _whatsappCredenciales() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("WHATSAPP_TOKEN"), phoneId = props.getProperty("WHATSAPP_PHONE_ID");
  return token && phoneId ? { token: token, phoneId: phoneId } : null;
}

function _whatsappLimpiar(texto, maximo) {
  return String(texto == null ? "" : texto).replace(/[\r\n\t]+/g, " | ").replace(/ {4,}/g, "   ").trim().substring(0, maximo);
}

function _whatsappNumeros(ss, clave) {
  return String(_cfgVal(ss, clave || WHATSAPP_CLAVE_NUMEROS, "")).split(/[,;\s]+/).map(function (n) { return n.replace(/\D/g, ""); }).filter(function (n) { return n.length >= 12; });
}

// Cuerpo de la petición a la API de Meta para una plantilla con dos variables de texto.
function _whatsappPayload(destino, plantilla, variables) {
  return {
    messaging_product: "whatsapp", to: destino, type: "template",
    template: { name: plantilla, language: { code: WHATSAPP_IDIOMA }, components: [{ type: "body", parameters: variables.map(function (v) { return { type: "text", text: v }; }) }] }
  };
}

function _whatsappEnviar(credenciales, payload) {
  const resp = UrlFetchApp.fetch("https://graph.facebook.com/" + WHATSAPP_VERSION_API + "/" + credenciales.phoneId + "/messages", {
    method: "post", contentType: "application/json", headers: { Authorization: "Bearer " + credenciales.token },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const codigo = resp.getResponseCode();
  return { ok: codigo >= 200 && codigo < 300, codigo: codigo, cuerpo: String(resp.getContentText()).substring(0, 300) };
}

// Manda el aviso a cada número. Nunca lanza error: un aviso que falla no debe tirar el pedido ni la conversación.
// opciones: sinWhatsapp (no manda nada), whatsappResumen (suma los números del resumen).
function _avisarPorWhatsApp(asunto, cuerpo, opciones) {
  const resultados = [];
  try {
    if (opciones && opciones.sinWhatsapp) return resultados;
    const credenciales = _whatsappCredenciales();
    if (!credenciales) return resultados;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const plantilla = String(_cfgVal(ss, WHATSAPP_CLAVE_PLANTILLA, WHATSAPP_PLANTILLA_DEFECTO));
    const variables = [_whatsappLimpiar(asunto, 120), _whatsappLimpiar(cuerpo, WHATSAPP_MAX_DETALLE)];
    const destinos = _whatsappNumeros(ss);
    if (opciones && opciones.whatsappResumen) _whatsappNumeros(ss, WHATSAPP_CLAVE_RESUMEN).forEach(function (n) { if (destinos.indexOf(n) === -1) destinos.push(n); });
    destinos.forEach(function (numero) {
      try {
        const r = _whatsappEnviar(credenciales, _whatsappPayload(numero, plantilla, variables));
        resultados.push({ numero: numero.slice(-4), ok: r.ok, codigo: r.codigo, detalle: r.ok ? "" : r.cuerpo });
        if (!r.ok) Logger.log("WhatsApp aviso falló (" + r.codigo + "): " + r.cuerpo);
      } catch (e) { resultados.push({ numero: numero.slice(-4), ok: false, detalle: String(e && e.message || e) }); }
    });
  } catch (e) { Logger.log("WhatsApp aviso: " + e); }
  return resultados;
}
