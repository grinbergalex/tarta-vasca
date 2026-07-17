// =================================================================================
// ████ v4.4b — RESERVAS (lista + convertir a venta + liberar) ████
// =================================================================================
// Lista todas las reservas abiertas (tipo_op = "Reservado", no anuladas)
function getReservas(body, sesion) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName("Ventas");
if (!h) return { ok: true, reservas: [] };
const headers = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
const datos = h.getDataRange().getValues();
const idxTipoOp = headers.indexOf("tipo_op");
const idxEstadoAnul = headers.indexOf("estado_anul");
const idxAnticipo = headers.indexOf("anticipo_reserva");
if (idxTipoOp === -1) return { ok: true, reservas: [] };
// Filtro por sucursal si el usuario no puede ver ambas
const permisos = getPermisos(sesion.rol);
const sucursalUsuario = permisos.puedeVerAmbas ? null : getSucursalUsuario(sesion.usuario);
const grupos = {};
for (let i = 1; i < datos.length; i++) {
const r = datos[i];
if (r[idxTipoOp] !== "Reservado") continue;
if (idxEstadoAnul !== -1 && r[idxEstadoAnul] === "ANULADO") continue;
const [idVenta, fecha, usuario, sucursal, sabor, tamano, cantidad, precio, subtotal, canal, metodoPago, clienteId, clienteNombre, , notas] = r;
if (sucursalUsuario && sucursal !== sucursalUsuario) continue;
if (!grupos[idVenta]) {
grupos[idVenta] = {
idVenta,
fecha: fecha instanceof Date ? Utilities.formatDate(fecha, TZ_MX, "yyyy-MM-dd'T'HH:mm:ss") : fecha,
usuario, sucursal, canal, metodoPago,
clienteId, clienteNombre,
anticipo: idxAnticipo !== -1 ? (Number(r[idxAnticipo]) || 0) : 0,
notas, items: [], total: 0
};
}
grupos[idVenta].items.push({ sabor, tamano, cantidad: Number(cantidad), precio: Number(precio), subtotal: Number(subtotal) });
grupos[idVenta].total += Number(subtotal);
}
// Ordenar por fecha descendente
const reservas = Object.values(grupos).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
return { ok: true, reservas };
}
// Convierte reserva → venta. Cambia tipo_op a "Venta" en todas las filas del idVenta.
// Si recibe canal, metodoPago o cliente nuevos, los actualiza.
function convertirReservaAVenta(body, sesion) {
requierePuedeVender(sesion);
const { idVenta, canal, metodoPago, cliente } = body;
if (!idVenta) return { ok:false, error:"Falta idVenta." };
const lock=LockService.getScriptLock(); try{lock.waitLock(30000);}catch(e){return{ok:false,error:"Sistema ocupado."};}
try{
const ss=SpreadsheetApp.getActiveSpreadsheet(); const h=ss.getSheetByName("Ventas");
const headers=h.getRange(1,1,1,h.getLastColumn()).getValues()[0];
const datos=h.getDataRange().getValues();
const idxTipoOp=headers.indexOf("tipo_op"), idxEstadoAnul=headers.indexOf("estado_anul");
if (idxTipoOp===-1) return { ok:false, error:"Falta columna tipo_op." };
const filas=[]; let infoActual=null;
for (let i=1;i<datos.length;i++){ if (datos[i][0]!==idVenta) continue;
  if (idxEstadoAnul!==-1 && datos[i][idxEstadoAnul]==="ANULADO") continue;
  if (datos[i][idxTipoOp]!=="Reservado") return { ok:false, error:"Esta venta ya no es una reserva." };
  filas.push(i+1);
  if(!infoActual) infoActual={ sucursal:datos[i][3], canal:datos[i][9], metodoPago:datos[i][10], clienteId:datos[i][11], clienteNombre:datos[i][12] };
}
if (!filas.length) return { ok:false, error:"Reserva no encontrada." };
for (const fn of filas){ const r=datos[fn-1]; const sb=r[4],tm=r[5],ct=Number(r[6])||0,sc=r[3];
  try{ invLiberar(ss,sb,tm,sc,ct,"apartado",idVenta,sesion.usuario); }catch(e){}
  invDescontar(ss,sb,tm,sc,ct,idVenta,sesion.usuario,"Entrega apartado","VENTA");
}
const canalFinal=canal&&canal.trim()?canal:(infoActual.canal==="Reservado"?"Mostrador":infoActual.canal);
const metodoFinal=metodoPago&&metodoPago.trim()?metodoPago:(infoActual.metodoPago==="Pendiente"?"Efectivo":infoActual.metodoPago);
let clienteIdFinal=infoActual.clienteId, clienteNombreFinal=infoActual.clienteNombre;
if (cliente&&cliente.nombre&&cliente.nombre.trim()){ clienteIdFinal=registrarOActualizarCliente(ss,cliente); clienteNombreFinal=cliente.nombre; }
filas.forEach(function(filaNum){
  h.getRange(filaNum, idxTipoOp+1).setValue("Venta");
  h.getRange(filaNum,10).setValue(canalFinal);
  h.getRange(filaNum,11).setValue(metodoFinal);
  if(clienteIdFinal) h.getRange(filaNum,12).setValue(clienteIdFinal);
  if(clienteNombreFinal) h.getRange(filaNum,13).setValue(clienteNombreFinal);
  var notaAct=h.getRange(filaNum,15).getValue()||"";
  h.getRange(filaNum,15).setValue((notaAct?notaAct+" | ":"")+"Convertida de reserva "+new Date().toISOString());
});
let total=0; filas.forEach(function(filaNum){ total+=Number(h.getRange(filaNum,9).getValue())||0; });
if (clienteIdFinal && clienteIdFinal!=="Rappi" && clienteIdFinal!=="Uber Eats"){
  try{ var items=filas.map(function(filaNum){ return h.getRange(filaNum,7).getValue()+" "+h.getRange(filaNum,5).getValue()+" "+h.getRange(filaNum,6).getValue(); });
    registrarHistorialCliente(ss,clienteIdFinal,idVenta,h.getRange(filas[0],2).getValue(),infoActual.sucursal,canalFinal,metodoFinal,total,items); }catch(e){}
}
registrarAuditoria(sesion.usuario,sesion.rol,"CONVERTIR_RESERVA",idVenta+" -> Venta | "+canalFinal+" | $"+total);
_utilMarcarDirty();
return { ok:true, mensaje:"Reserva "+idVenta+" convertida a venta", total };
}catch(err){ return {ok:false,error:String(err&&err.message?err.message:err)}; }
finally{ try{lock.releaseLock();}catch(_e){} }
}
// Libera la reserva: usa eliminarMovimiento (soft delete) para devolver stock
function liberarReserva(body, sesion) {
const { idVenta, motivo } = body;
if (!idVenta) return { ok:false, error:"Falta idVenta." };
requierePuedeVender(sesion);
try{
  const ss=SpreadsheetApp.getActiveSpreadsheet(); const h=ss.getSheetByName("Ventas");
  const headers=h.getRange(1,1,1,h.getLastColumn()).getValues()[0];
  const idxTipo=headers.indexOf("tipo_op"), idxAnul=headers.indexOf("estado_anul");
  const datos=h.getDataRange().getValues();
  for(let i=1;i<datos.length;i++){ const r=datos[i]; if(r[0]!==idVenta)continue;
    if(idxAnul!==-1&&r[idxAnul]==="ANULADO")continue;
    if(idxTipo!==-1&&r[idxTipo]!=="Reservado")continue;
    try{ invLiberar(ss,r[4],r[5],r[3],Number(r[6])||0,"apartado",idVenta,sesion.usuario); }catch(e){}
  }
}catch(e){}
return eliminarMovimiento({ hoja:"Ventas", id:idVenta, motivo:motivo||"Reserva liberada", _liberacionReserva:true }, sesion);
}
// Endpoint helper: sucursales que el usuario puede operar
function getSucursalesUsuario(body, sesion) {
const permisos = getPermisos(sesion.rol);
if (permisos.puedeVerAmbas) return { ok: true, sucursales: ["Polanco", "Cuajimalpa"] };
return { ok: true, sucursales: [getSucursalUsuario(sesion.usuario)] };
}

// =================================================================================
// ACTUALIZAR MÉTODO DE PAGO (post-ruta)
// =================================================================================
function actualizarMetodoVenta(body, sesion) {
// Permitir Owner o Admin_Ventas
if (sesion.rol !== "Owner" && sesion.rol !== "Admin_Ventas") {
return { ok: false, error: "Acción reservada para Owner o Admin_Ventas." };
}
const { idVenta, nuevoMetodo } = body;
if (!idVenta || !nuevoMetodo) return { ok: false, error: "Datos requeridos." };
const validos = ["Efectivo", "Tarjeta", "Transferencia", "Por definir"];
if (!validos.includes(nuevoMetodo)) return { ok: false, error: "Método inválido. Usa: " + validos.join(", ") };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Ventas");
if (!hoja) return { ok: false, error: "Hoja Ventas no encontrada." };
const datos = hoja.getDataRange().getValues();
let filasActualizadas = 0;
let metodoAnterior = "";
for (let i = 1; i < datos.length; i++) {
if (datos[i][0] === idVenta) {
if (!metodoAnterior) metodoAnterior = datos[i][10];
hoja.getRange(i+1, 11).setValue(nuevoMetodo);  // columna K = metodoPago
filasActualizadas++;
}
}
if (filasActualizadas === 0) return { ok: false, error: "Venta no encontrada." };
SpreadsheetApp.flush();  // FIX: forzar commit
registrarAuditoria(sesion.usuario, sesion.rol, "UPDATE_METODO_PAGO", `${idVenta}: ${metodoAnterior} → ${nuevoMetodo}`);
return { ok: true, mensaje: `✅ Método actualizado a ${nuevoMetodo}`, filasActualizadas };
}

// =================================================================================
// RUTAS — gestión de pagos pendientes
// =================================================================================
function ensureHojaRutasArchivadas(ss) {
let h = ss.getSheetByName("RutasArchivadas");
if (!h) {
h = ss.insertSheet("RutasArchivadas");
h.setTabColor("#7B3F00");
const headers = ["RutaID", "ArchivadoPor", "FechaArchivado"];
const r = h.getRange(1, 1, 1, headers.length);
r.setValues([headers]);
r.setBackground("#2E4756");
r.setFontColor("#FFFFFF");
r.setFontWeight("bold");
h.setFrozenRows(1);
h.setColumnWidth(1, 280);
h.setColumnWidth(2, 160);
h.setColumnWidth(3, 180);
}
return h;
}
function _esRol(sesion, roles) {
return roles.includes(sesion.rol);
}
/**
getRutasAbiertas — devuelve todas las rutas activas (con al menos 1 cliente Por definir
y no archivadas). Agrupa por rutaId. Solo Owner y Admin_Ventas.
*/
function getRutasAbiertas(body, sesion) {
if (!_esRol(sesion, ["Owner", "Admin_Ventas"])) {
return { ok: false, error: "Acción reservada para Owner o Admin_Ventas." };
}
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Ventas");
if (!hoja) return { ok: true, rutas: [] };
const datos = hoja.getDataRange().getValues();
const headers = datos[0];
const idxNotas = headers.indexOf("notas");
const idxN = idxNotas === -1 ? 14 : idxNotas;
const idxEstadoAnul = headers.indexOf("estado_anul");
// Cargar archivadas
const hArch = ensureHojaRutasArchivadas(ss);
const archDatos = hArch.getDataRange().getValues();
const archivadas = new Set();
for (let i = 1; i < archDatos.length; i++) {
if (archDatos[i][0]) archivadas.add(String(archDatos[i][0]));
}
// Agrupar ventas por rutaId
const rutas = {};
for (let i = 1; i < datos.length; i++) {
const r = datos[i];
if (idxEstadoAnul !== -1 && r[idxEstadoAnul] === "ANULADO") continue;
const notas = String(r[idxN] || "");
const m = notas.match(/RUTA-[A-Z0-9-]+/);
if (!m) continue;
const rutaId = m[0];
if (archivadas.has(rutaId)) continue;
if (!rutas[rutaId]) rutas[rutaId] = { rutaId, paradas: {}, fecha: r[1] };
const idVenta = r[0];
if (!rutas[rutaId].paradas[idVenta]) {
rutas[rutaId].paradas[idVenta] = {
idVenta, fecha: r[1], clienteNombre: r[12] || "", canal: r[9],
metodoPago: r[10], items: [], total: 0
};
}
rutas[rutaId].paradas[idVenta].items.push({
sabor: r[4], tamano: r[5], cantidad: Number(r[6]) || 0,
precio: Number(r[7]) || 0, subtotal: Number(r[8]) || 0
});
rutas[rutaId].paradas[idVenta].total += Number(r[8]) || 0;
}
// Formatear fechas y convertir paradas a arrays
const resultado = [];
for (const rutaId in rutas) {
const ruta = rutas[rutaId];
const paradasArr = Object.values(ruta.paradas);
const pagadas = paradasArr.filter(p => p.metodoPago && p.metodoPago !== "Por definir").length;
const fechaFmt = ruta.fecha instanceof Date
? Utilities.formatDate(ruta.fecha, TZ_MX, "yyyy-MM-dd")
: (typeof ruta.fecha === "string" ? ruta.fecha.substring(0, 10) : "");
// Formatear fecha de cada parada
paradasArr.forEach(p => {
p.fecha = p.fecha instanceof Date
? Utilities.formatDate(p.fecha, TZ_MX, "yyyy-MM-dd'T'HH:mm:ss")
: p.fecha;
});
resultado.push({
rutaId,
fechaRuta: fechaFmt,
totalParadas: paradasArr.length,
pagadas,
pendientes: paradasArr.length - pagadas,
completa: pagadas === paradasArr.length,
paradas: paradasArr
});
}
// Ordenar: más recientes primero (por fecha)
resultado.sort((a, b) => (b.fechaRuta || "").localeCompare(a.fechaRuta || ""));
return { ok: true, rutas: resultado };
}
/**
archivarRuta — marca una ruta como archivada. Solo si todos sus pagos están definidos.
*/
function archivarRuta(body, sesion) {
if (!_esRol(sesion, ["Owner", "Admin_Ventas"])) {
return { ok: false, error: "Acción reservada para Owner o Admin_Ventas." };
}
const { rutaId } = body;
if (!rutaId) return { ok: false, error: "rutaId requerido." };
// Verificar que todas las paradas de esa ruta tengan método definido
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Ventas");
const datos = hoja.getDataRange().getValues();
const headers = datos[0];
const idxNotas = headers.indexOf("notas");
const idxN = idxNotas === -1 ? 14 : idxNotas;
let pendientes = 0;
for (let i = 1; i < datos.length; i++) {
const notas = String(datos[i][idxN] || "");
if (notas.indexOf(rutaId) === -1) continue;
const metodo = datos[i][10];
if (!metodo || metodo === "Por definir") pendientes++;
}
if (pendientes > 0) {
return { ok: false, error: `No se puede archivar: ${pendientes} pago(s) pendientes.` };
}
// Archivar
const hArch = ensureHojaRutasArchivadas(ss);
const archDatos = hArch.getDataRange().getValues();
for (let i = 1; i < archDatos.length; i++) {
if (String(archDatos[i][0]) === rutaId) {
return { ok: false, error: "Ruta ya archivada." };
}
}
hArch.appendRow([rutaId, sesion.usuario, new Date()]);
registrarAuditoria(sesion.usuario, sesion.rol, "ARCHIVAR_RUTA", rutaId);
return { ok: true, mensaje: "Ruta archivada." };
}

/**
actualizarMetodoVentaBatch — actualiza varios métodos en una sola llamada
body: { items: [ {idVenta, nuevoMetodo}, ... ] }
*/
function actualizarMetodoVentaBatch(body, sesion) {
if (!_esRol(sesion, ["Owner", "Admin_Ventas"])) {
return { ok: false, error: "Acción reservada para Owner o Admin_Ventas." };
}
const items = Array.isArray(body.items) ? body.items : [];
if (items.length === 0) return { ok: false, error: "Sin items." };
const validos = ["Efectivo", "Tarjeta", "Transferencia", "Por definir"];
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Ventas");
if (!hoja) return { ok: false, error: "Hoja Ventas no encontrada." };
const datos = hoja.getDataRange().getValues();
// Indexar filas por idVenta
const filasPorId = {};
for (let i = 1; i < datos.length; i++) {
const id = datos[i][0];
if (!id) continue;
if (!filasPorId[id]) filasPorId[id] = [];
filasPorId[id].push({ row: i + 1, metodoActual: datos[i][10] });
}
let exitosos = 0, fallidos = 0;
const errores = [];
for (const it of items) {
const { idVenta, nuevoMetodo } = it;
if (!idVenta || !nuevoMetodo) { fallidos++; errores.push(`${idVenta}: datos faltantes`); continue; }
if (!validos.includes(nuevoMetodo)) { fallidos++; errores.push(`${idVenta}: método inválido`); continue; }
const filas = filasPorId[idVenta];
if (!filas || filas.length === 0) { fallidos++; errores.push(`${idVenta}: no encontrada`); continue; }
const metodoAnterior = filas[0].metodoActual;
filas.forEach(f => hoja.getRange(f.row, 11).setValue(nuevoMetodo));
registrarAuditoria(sesion.usuario, sesion.rol, "UPDATE_METODO_PAGO", `${idVenta}: ${metodoAnterior} → ${nuevoMetodo}`);
exitosos++;
}
SpreadsheetApp.flush();  // FIX: forzar commit antes de responder
return { ok: true, exitosos, fallidos, errores, mensaje: `${exitosos} actualizado(s)${fallidos > 0 ? ` · ${fallidos} con error` : ''}` };
}
/**
getRutasCerradas — devuelve rutas archivadas con fechaRuta = hoy CDMX
*/
function getRutasCerradas(body, sesion) {
if (!_esRol(sesion, ["Owner", "Admin_Ventas"])) {
return { ok: false, error: "Acción reservada para Owner o Admin_Ventas." };
}
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Ventas");
if (!hoja) return { ok: true, rutas: [] };
const datos = hoja.getDataRange().getValues();
const headers = datos[0];
const idxNotas = headers.indexOf("notas");
const idxN = idxNotas === -1 ? 14 : idxNotas;
const idxEstadoAnul = headers.indexOf("estado_anul");
// Cargar archivadas
const hArch = ensureHojaRutasArchivadas(ss);
const archDatos = hArch.getDataRange().getValues();
const archivadas = new Set();
for (let i = 1; i < archDatos.length; i++) {
if (archDatos[i][0]) archivadas.add(String(archDatos[i][0]));
}
const hoyStr = Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd");
// Agrupar ventas archivadas con fechaRuta = hoy
const rutas = {};
for (let i = 1; i < datos.length; i++) {
const r = datos[i];
if (idxEstadoAnul !== -1 && r[idxEstadoAnul] === "ANULADO") continue;
const notas = String(r[idxN] || "");
const m = notas.match(/RUTA-[A-Z0-9-]+/);
if (!m) continue;
const rutaId = m[0];
if (!archivadas.has(rutaId)) continue;
// Filtrar por fecha de hoy
const fechaVenta = r[1];
const fechaStr = fechaVenta instanceof Date
? Utilities.formatDate(fechaVenta, TZ_MX, "yyyy-MM-dd")
: (typeof fechaVenta === "string" ? fechaVenta.substring(0, 10) : "");
if (fechaStr !== hoyStr) continue;
if (!rutas[rutaId]) rutas[rutaId] = { rutaId, paradas: {}, fecha: fechaVenta };
const idVenta = r[0];
if (!rutas[rutaId].paradas[idVenta]) {
rutas[rutaId].paradas[idVenta] = {
idVenta, fecha: r[1], clienteNombre: r[12] || "", canal: r[9],
metodoPago: r[10], items: [], total: 0
};
}
rutas[rutaId].paradas[idVenta].items.push({
sabor: r[4], tamano: r[5], cantidad: Number(r[6]) || 0,
precio: Number(r[7]) || 0, subtotal: Number(r[8]) || 0
});
rutas[rutaId].paradas[idVenta].total += Number(r[8]) || 0;
}
const resultado = [];
for (const rutaId in rutas) {
const ruta = rutas[rutaId];
const paradasArr = Object.values(ruta.paradas);
paradasArr.forEach(p => {
p.fecha = p.fecha instanceof Date
? Utilities.formatDate(p.fecha, TZ_MX, "yyyy-MM-dd'T'HH:mm:ss")
: p.fecha;
});
resultado.push({
rutaId,
fechaRuta: hoyStr,
totalParadas: paradasArr.length,
paradas: paradasArr
});
}
resultado.sort((a, b) => b.rutaId.localeCompare(a.rutaId));
return { ok: true, rutas: resultado };
}
function autorizarDocApp() {
const doc = DocumentApp.create("test_autorizacion_borrar");
doc.saveAndClose();
Logger.log("OK: " + doc.getUrl());
}
