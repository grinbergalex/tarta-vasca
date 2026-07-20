// =================================================================================
// CLIENTES
// =================================================================================
function registrarOActualizarCliente(ss, cliente) {
const hoja = ss.getSheetByName("Clientes");
const datos = hoja.getDataRange().getValues();
const nombre = cliente.nombre.trim();
const telefono = (cliente.telefono||"").trim();
const email = (cliente.email||"").trim();
for (let i = 1; i < datos.length; i++) {
const [id, nom, tel, eml] = datos[i];
if (!id) continue;
if ((telefono&&tel===telefono)||(email&&eml===email)||(nom&&nom.toLowerCase()===nombre.toLowerCase()&&!telefono&&!email)) {
if (telefono&&!tel) hoja.getRange(i+1,3).setValue(telefono);
if (email&&!eml) hoja.getRange(i+1,4).setValue(email);
return id;
}
}
const id = "CLI-" + new Date().getTime();
hoja.appendRow([id, nombre, telefono, email, "", "", "CDMX", new Date().toISOString(), ""]);
return id;
}
function registrarHistorialCliente(ss, clienteId, idVenta, fechaVenta, sucursal, canal, metodoPago, total, items) {
let hoja = ss.getSheetByName("Clientes_Historial");
if (!hoja) {
hoja = ss.insertSheet("Clientes_Historial");
hoja.setTabColor("#16a085");
const headers = ["Cliente ID", "Venta ID", "Fecha", "Sucursal", "Canal", "Método Pago", "Total", "Productos"];
const rango = hoja.getRange(1,1,1,headers.length); rango.setValues([headers]); rango.setBackground("#2E4756"); rango.setFontColor("#FFFFFF"); rango.setFontWeight("bold"); hoja.setFrozenRows(1);
}
hoja.appendRow([clienteId, idVenta, fechaVenta, sucursal, canal, metodoPago, total, items.join(" | ")]);
}
function buscarCliente(body, sesion) {
const { busqueda } = body;
if (!busqueda || busqueda.length < 2) return { ok: true, clientes: [] };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Clientes");
const datos = hoja.getDataRange().getValues();
const term = busqueda.toLowerCase();
const clientes = [];
for (let i = 1; i < datos.length; i++) {
const [id, nombre, telefono, email] = datos[i];
if (!id) continue;
if ((nombre&&nombre.toLowerCase().includes(term))||(telefono&&telefono.includes(term))||(email&&email.toLowerCase().includes(term))) clientes.push({ id, nombre, telefono, email });
if (clientes.length >= 5) break;
}
return { ok: true, clientes };
}
function getHistorialCliente(body, sesion) {
const { clienteId } = body;
if (!clienteId) return { ok: false, error: "clienteId requerido." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hojaC = ss.getSheetByName("Clientes");
const datosC = hojaC.getDataRange().getValues();
let clienteInfo = null;
for (let i = 1; i < datosC.length; i++) {
if (datosC[i][0] === clienteId) { clienteInfo = { id: datosC[i][0], nombre: datosC[i][1], telefono: datosC[i][2], email: datosC[i][3] }; break; }
}
const hojaH = ss.getSheetByName("Clientes_Historial");
if (!hojaH) return { ok: true, cliente: clienteInfo, historial: [] };
const datosH = hojaH.getDataRange().getValues();
const historial = [];
for (let i = 1; i < datosH.length; i++) {
const [cid, ventaId, fecha, sucursal, canal, metodoPago, total, productos] = datosH[i];
if (cid === clienteId) historial.unshift({ ventaId, fecha: fecha instanceof Date ? Utilities.formatDate(fecha, TZ_MX, "yyyy-MM-dd'T'HH:mm:ss") : fecha, sucursal, canal, metodoPago, total: Number(total), productos });
}
return { ok: true, cliente: clienteInfo, historial };
}
function getVentas(body, sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Ventas");
const datos = hoja.getDataRange().getValues();
// Detectar columna estado_anul para filtrar
const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
const idxEstadoAnul = headers.indexOf("estado_anul");
const idxAnulPor = headers.indexOf("anulado_por");
const idxAnulMotivo = headers.indexOf("anulado_motivo");
const idxNotas = headers.indexOf("notas");
const idxN = idxNotas === -1 ? 14 : idxNotas;
const _incAnul = !!(body && body.incluirAnuladas);   // el historial de Ventas las pide para mostrarlas marcadas
const _desde = body && body.desde ? String(body.desde) : null;   // "yyyy-MM-dd"
const _hasta = body && body.hasta ? String(body.hasta) : null;
const _rango = _desde || _hasta;
const ventas = [];
const _ini = _rango ? 1 : Math.max(1, datos.length-200);
for (let i = _ini; i < datos.length; i++) {
const [idVenta, fecha, usuario, sucursal, sabor, tamano, cantidad, precio, subtotal, canal, metodoPago, clienteId, clienteNombre] = datos[i];
if (!idVenta) continue;
const _esAnulada = idxEstadoAnul !== -1 && datos[i][idxEstadoAnul] === "ANULADO";
if (_esAnulada && !_incAnul) continue;  // ocultar anuladas salvo que se pidan explicitamente
if (_rango) {
const _fdd = fecha instanceof Date ? Utilities.formatDate(fecha, TZ_MX, "yyyy-MM-dd") : String(fecha).substring(0,10);
if (_desde && _fdd < _desde) continue;
if (_hasta && _fdd > _hasta) continue;
}
const fechaFmt = fecha instanceof Date ? Utilities.formatDate(fecha, TZ_MX, "yyyy-MM-dd'T'HH:mm:ss") : fecha;
// Extraer rutaId de notas si existe
const notas = String(datos[i][idxN] || "");
const matchRuta = notas.match(/RUTA-[A-Z0-9-]+/);
const rutaId = matchRuta ? matchRuta[0] : null;
ventas.unshift({ idVenta, fecha: fechaFmt, usuario, sucursal, sabor, tamano, cantidad: Number(cantidad), precio: Number(precio), subtotal: Number(subtotal), canal, metodoPago, clienteId, clienteNombre, notas, rutaId, tipoOp: (function(){var ix=headers.indexOf("tipo_op");return ix!==-1?(datos[i][ix]||"Venta"):"Venta";})(), anulada: _esAnulada, anuladoPor: _esAnulada && idxAnulPor !== -1 ? String(datos[i][idxAnulPor] || "") : "", anuladoMotivo: _esAnulada && idxAnulMotivo !== -1 ? String(datos[i][idxAnulMotivo] || "") : "" });
}
return { ok: true, ventas };
}
// =================================================================================
// CATÁLOGO
// =================================================================================
function getCatalogo(sesion) {
const _velHitCat = _velGet("cat", "catalogo"); if (_velHitCat) return _velHitCat; // v6.3
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Catálogo");
const datos = hoja.getDataRange().getValues();
const sabores=[], tamanos=[], sucursales=[], canales=[];
for (let i = 1; i < datos.length; i++) {
const [tipo, nombre, activo] = datos[i];
if (!tipo) continue;
const item = { nombre, activo: activo==="TRUE"||activo===true, fila: i+1 };
if (tipo==="Sabor") sabores.push(item);
else if (tipo==="Tamaño") tamanos.push(item);
else if (tipo==="Sucursal") sucursales.push(item);
else if (tipo==="Canal") canales.push(item);
}
if (canales.length === 0) { sembrarCanales(ss); return getCatalogo(sesion); }
// Dedup de canales por nombre: el Catálogo acumuló filas "Canal" repetidas por re-siembra,
// lo que hacía que el menú las listara varias veces. Conserva la primera aparición.
const _cv = {};
const canalesUnicos = canales.filter(c => { const n = String(c.nombre); if (_cv[n]) return false; _cv[n] = true; return true; });
const _velOutCat = { ok: true, sabores, tamanos, sucursales, canales: canalesUnicos }; // v6.3
_velPut("cat", "catalogo", _velOutCat, 300);
return _velOutCat;
}
function sembrarCanales(ss) {
const hoja = ss.getSheetByName("Catálogo");
[["Canal","Tienda","TRUE",1,""],["Canal","Domicilio","TRUE",2,""],["Canal","Rappi","TRUE",3,""],["Canal","Uber Eats","FALSE",4,""]].forEach(f => hoja.appendRow(f));
_velBump("cat"); // v6.3
}
function altaSabor(body, sesion) { soloOwner(sesion); const res = toggleCatalogo(sesion,"Sabor",body.nombre,true); if(res.ok){try{crearPreciosSabor(body.nombre,sesion);}catch(e){}} return res; }
function bajaSabor(body, sesion)  { soloOwner(sesion); return toggleCatalogo(sesion,"Sabor",body.nombre,false); }
function altaTamano(body, sesion) { soloOwner(sesion); return toggleCatalogo(sesion,"Tamaño",body.nombre,true); }
function bajaTamano(body, sesion) { soloOwner(sesion); return toggleCatalogo(sesion,"Tamaño",body.nombre,false); }
function altaCanal(body, sesion)  { soloOwner(sesion); return toggleCatalogo(sesion,"Canal",body.nombre,true); }
function bajaCanal(body, sesion)  { soloOwner(sesion); return toggleCatalogo(sesion,"Canal",body.nombre,false); }
function toggleCatalogo(sesion, tipo, nombre, activar) {
if (!nombre) return { ok: false, error: "Nombre requerido." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Catálogo");
const datos = hoja.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0]===tipo && datos[i][1].toLowerCase()===nombre.toLowerCase()) {
hoja.getRange(i+1,3).setValue(activar?"TRUE":"FALSE");
_velBump("cat"); // v6.3
registrarAuditoria(sesion.usuario, sesion.rol, activar?"ALTA_"+tipo.toUpperCase():"BAJA_"+tipo.toUpperCase(), `${tipo} ${activar?"activado":"desactivado"}: ${nombre}`);
return { ok: true, mensaje: `✅ ${tipo} "${nombre}" ${activar?"activado":"desactivado"}.` };
}
}
if (activar) {
hoja.appendRow([tipo, nombre, "TRUE", datos.filter(d=>d[0]===tipo).length+1, ""]);
_velBump("cat"); // v6.3
registrarAuditoria(sesion.usuario, sesion.rol, "ALTA_"+tipo.toUpperCase(), `Nuevo ${tipo}: ${nombre}`);
return { ok: true, mensaje: `✅ ${tipo} "${nombre}" agregado.` };
}
return { ok: false, error: `${tipo} "${nombre}" no encontrado.` };
}
// =================================================================================
// PRECIOS
// =================================================================================
function repararPreciosSabores(sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hojacat = ss.getSheetByName("Catálogo");
const datosCat = hojacat.getDataRange().getValues();
const saboresActivos = [];
for (let i = 1; i < datosCat.length; i++) {
if (datosCat[i][0]==="Sabor"&&(datosCat[i][2]==="TRUE"||datosCat[i][2]===true)) saboresActivos.push(datosCat[i][1]);
}
let creados = 0;
for (const sab of saboresActivos) { crearPreciosSabor(sab, sesion); creados++; }
_utilMarcarDirty();
return { ok: true, mensaje: `✅ Precios reparados para ${creados} sabores.` };
}
function crearPreciosSabor(sabor, sesion) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hojaPrecios = ss.getSheetByName("Precios");
const datosPrecios = hojaPrecios.getDataRange().getValues();
const hojacat = ss.getSheetByName("Catálogo");
const datosCat = hojacat.getDataRange().getValues();
const ahora = new Date().toISOString();
const tamanos = [];
for (let i = 1; i < datosCat.length; i++) {
if (datosCat[i][0]==="Tamaño"&&(datosCat[i][2]==="TRUE"||datosCat[i][2]===true)) tamanos.push(datosCat[i][1]);
}
for (const tamano of tamanos) {
const yaExiste = datosPrecios.slice(1).some(r => r[0]===sabor&&r[1]===tamano);
if (yaExiste) continue;
const precioRef = datosPrecios.slice(1).find(r => r[1]===tamano);
const precio = precioRef ? (Number(precioRef[2])||0) : 0;
hojaPrecios.appendRow([sabor, tamano, precio, ahora, sesion.usuario, ahora]);
}
_velBump("pre"); // v6.3
}
function getPrecios(sesion) {
const _velHitPre = _velGet("pre", "precios"); if (_velHitPre) return _velHitPre; // v6.3
const datos = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Precios").getDataRange().getValues();
const precios = [];
for (let i = 1; i < datos.length; i++) {
const [sabor, tamano, precio, vigenteDesde, modificadoPor, fechaMod, canal] = datos[i];
if (!sabor) continue;
precios.push({ sabor, tamano, precio: Number(precio), canal: canal||"", vigenteDesde, modificadoPor, fechaMod });
}
const _velOutPre = { ok: true, precios }; // v6.3
_velPut("pre", "precios", _velOutPre, 300);
return _velOutPre;
}
function updatePrecio(body, sesion) {
soloOwner(sesion);
const { sabor, tamano, precio } = body;
if (!sabor||!tamano||precio===undefined||precio<0) return { ok: false, error: "Datos inválidos." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Precios");
const datos = hoja.getDataRange().getValues();
const ahora = new Date().toISOString();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0]===sabor&&datos[i][1]===tamano) {
const anterior = datos[i][2];
hoja.getRange(i+1,3).setValue(precio); hoja.getRange(i+1,4).setValue(ahora); hoja.getRange(i+1,5).setValue(sesion.usuario); hoja.getRange(i+1,6).setValue(ahora);
_velBump("pre"); // v6.3
registrarAuditoria(sesion.usuario, sesion.rol, "UPDATE_PRECIO", `${sabor} ${tamano}: $${anterior} → $${precio}`);
_utilMarcarDirty();
return { ok: true, mensaje: `✅ Precio: ${sabor} ${tamano} = $${precio}` };
}
}
hoja.appendRow([sabor, tamano, precio, ahora, sesion.usuario, ahora]);
_velBump("pre"); // v6.3
return { ok: true, mensaje: `✅ Precio creado: ${sabor} ${tamano} = $${precio}` };
}
function getPrecioActual(ss, sabor, tamano, canal) {
// Rappi cobra precio por tamaño (precio de la app, no de mostrador). Autoritativo aquí
// para que cualquier resolución server-side de precio Rappi sea consistente con el front
// y NUNCA aplique la vieja regla de +$20 ni los precios base de la hoja Precios.
if (canal === "Rappi") {
const RAPPI_PRECIOS = { "Individual": 240, "Mediana": 420, "Grande": 750 };
if (RAPPI_PRECIOS[tamano] != null) return RAPPI_PRECIOS[tamano];
}
const datos = ss.getSheetByName("Precios").getDataRange().getValues();
let precioPorTamanoBase=0, precioPorSaborBase=0, precioPorCanalTamano=0;
for (let i = 1; i < datos.length; i++) {
const dSabor=datos[i][0], dTamano=datos[i][1], dPrecio=Number(datos[i][2])||0, dCanal=datos[i][6]||"";
const esCanal = canal&&dCanal===canal;
const esBase = !dCanal||dCanal==="BASE";
if (esCanal&&dSabor===sabor&&dTamano===tamano) return dPrecio;
if (esCanal&&dTamano===tamano&&!precioPorCanalTamano) precioPorCanalTamano=dPrecio;
if (esBase&&dSabor===sabor&&dTamano===tamano) precioPorSaborBase=dPrecio;
if (esBase&&dTamano===tamano&&!precioPorTamanoBase) precioPorTamanoBase=dPrecio;
}
return precioPorCanalTamano||precioPorSaborBase||precioPorTamanoBase;
}
// =================================================================================
// AUDITORÍA
// =================================================================================
function registrarAuditoria(usuario, rol, accion, detalles) {
SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Auditoría").appendRow([new Date().toISOString(), usuario, rol, accion, detalles, ""]);
}
function getAuditoria(sesion) {
soloOwner(sesion);
// v6.3: lee solo las ultimas 100 filas (la hoja crece con cada accion del equipo)
const _hAud = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Auditoría");
const _lrA = _hAud.getLastRow();
const _nA = Math.min(100, Math.max(0, _lrA - 1));
const datos = _nA > 0 ? _hAud.getRange(_lrA - _nA + 1, 1, _nA, 5).getValues() : [];
const registros = [];
for (let i = 0; i < datos.length; i++) {
const [fecha, usuario, rol, accion, detalles] = datos[i];
if (!fecha) continue;
registros.unshift({ fecha: fecha instanceof Date ? Utilities.formatDate(fecha, TZ_MX, "yyyy-MM-dd'T'HH:mm:ss") : fecha, usuario, rol, accion, detalles });
}
return { ok: true, registros };
}
// =================================================================================
// HELPERS
// =================================================================================
function hashSimple(str) {
let hash = 0;
for (let i = 0; i < str.length; i++) {
const char = str.charCodeAt(i);
hash = ((hash << 5) - hash) + char;
hash = hash & hash;
}
return "TV_" + Math.abs(hash).toString(16).toUpperCase();
}
function getSucursalUsuario(usuario) {
const datos = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Usuarios").getDataRange().getValues();
for (let i = 1; i < datos.length; i++) if (datos[i][0]===usuario) return datos[i][3];
return "Cuajimalpa";
}
function _registrarAuditoria(ss, sesion, accion, detalles) {
registrarAuditoria(sesion.usuario, sesion.rol, accion, detalles);
}
