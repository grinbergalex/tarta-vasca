// ============================================================================
// v9 — REGISTRO DE LEALTAD (hoja "Clientes_Lealtad")
//
// Un renglón por cliente, venga de donde venga el pedido, para saber quién compra, cuánto y cada cuándo, y quién falla.
// Es la base de los programas de lealtad (descuentos, regalos, avisos de sabores nuevos).
// - La clave es el teléfono (10 dígitos). Si el cliente no lo dio y solo se le sigue por Instagram, la clave es su
//   conversación (IG-<id>): en cuanto dé un teléfono en un pedido futuro, nace su renglón con teléfono.
// - Un pedido nuevo suma a "Pedidos hechos"; entregarlo suma a "Entregados" y al total comprado; no recogerlo suma a
//   "No recogidos". Lo que cuenta como compra es lo entregado, no lo apartado.
// - Nunca tira el pedido: quien llama lo envuelve en try/catch.
// ============================================================================

const LEALTAD_HOJA = "Clientes_Lealtad";
const LEALTAD_ENCABEZADO = ["Clave", "Nombre", "Teléfono", "Canal", "Pedidos hechos", "Entregados", "No recogidos", "Total comprado", "Primer pedido", "Última entrega", "Última llave"];

function _lealtadClave(contacto) {
  const texto = String(contacto || "");
  const digitos = texto.replace(/\D/g, "");
  if (/^(Teléfono|WhatsApp)/.test(texto) && digitos.length >= 10) return digitos.slice(-10);
  const conversacion = texto.match(/conversación (\S+)\)/);
  if (conversacion) return "IG-" + conversacion[1];
  return digitos.length >= 10 ? digitos.slice(-10) : texto;
}

function _lealtadTelefono(contacto) {
  const digitos = String(contacto || "").replace(/\D/g, "");
  return /^(Teléfono|WhatsApp)/.test(String(contacto || "")) && digitos.length >= 10 ? digitos.slice(-10) : "";
}

function _lealtadHoja(ss) {
  let hoja = ss.getSheetByName(LEALTAD_HOJA);
  if (hoja) return hoja;
  hoja = ss.insertSheet(LEALTAD_HOJA);
  hoja.getRange(1, 1, 1, LEALTAD_ENCABEZADO.length).setValues([LEALTAD_ENCABEZADO]).setFontWeight("bold").setBackground("#2E4756").setFontColor("#FFFFFF");
  hoja.setFrozenRows(1);
  hoja.setTabColor("#8a5a9a");
  [150, 160, 110, 100, 100, 90, 100, 110, 120, 120, 110].forEach(function (ancho, i) { hoja.setColumnWidth(i + 1, ancho); });
  return hoja;
}

// Cambia lo que haga falta del renglón del cliente (lo crea si no existe). cambios: { nombre, canal, hechos, entregados, noRecogidos, total, llave, entrega }
function _lealtadActualizar(ss, contacto, cambios) {
  const clave = _lealtadClave(contacto);
  if (!clave) return;
  const hoja = _lealtadHoja(ss);
  const ahora = Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd HH:mm");
  const ultima = hoja.getLastRow();
  const claves = ultima > 1 ? hoja.getRange(2, 1, ultima - 1, 1).getValues().map(function (f) { return String(f[0]); }) : [];
  const i = claves.indexOf(clave);
  const fila = i === -1 ? [clave, "", _lealtadTelefono(contacto), "", 0, 0, 0, 0, ahora, "", ""] : hoja.getRange(i + 2, 1, 1, LEALTAD_ENCABEZADO.length).getValues()[0];
  if (cambios.nombre) fila[1] = cambios.nombre;
  if (cambios.canal) fila[3] = cambios.canal;
  fila[4] = Number(fila[4]) + (cambios.hechos || 0);
  fila[5] = Number(fila[5]) + (cambios.entregados || 0);
  fila[6] = Number(fila[6]) + (cambios.noRecogidos || 0);
  fila[7] = Number(fila[7]) + (cambios.total || 0);
  if (cambios.entrega) fila[9] = ahora;
  if (cambios.llave) fila[10] = cambios.llave;
  hoja.getRange(i === -1 ? ultima + 1 : i + 2, 1, 1, LEALTAD_ENCABEZADO.length).setValues([fila]);
}

function lealtadRegistrarPedido(ss, datos) {
  _lealtadActualizar(ss, datos.contacto, { nombre: datos.cliente, canal: datos.canal, hechos: 1, llave: datos.referencia });
}

function lealtadRegistrarEntrega(ss, pedido) {
  _lealtadActualizar(ss, pedido.contacto, { nombre: pedido.cliente, entregados: 1, total: Number(pedido.total) || 0, entrega: true, llave: pedido.referencia });
}

function lealtadRegistrarNoRecogido(ss, pedido) {
  _lealtadActualizar(ss, pedido.contacto, { nombre: pedido.cliente, noRecogidos: 1, llave: pedido.referencia });
}
