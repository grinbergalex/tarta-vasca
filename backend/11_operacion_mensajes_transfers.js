// =================================================================================
// LIMPIAR DATOS
// =================================================================================
function limpiarDatos(sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hojas = ["Inventario","Ventas","Clientes","Clientes_Historial","Auditoría","Utilidades","Transferencias","StockLimites","Mensajes","Objetivos"];
hojas.forEach(nombre => { const h=ss.getSheetByName(nombre); if(h&&h.getLastRow()>1) h.deleteRows(2,h.getLastRow()-1); });
_registrarAuditoria(ss,sesion,"LIMPIAR_DATOS","Datos limpiados.");
return { ok: true, mensaje: "✅ Datos limpiados correctamente." };
}
function limpiarTodo() {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hojasABorrar = ["Inventario","Ventas","Clientes","Clientes_Historial","Auditoría","Utilidades","Transferencias","Mensajes"];
let limpiadas=0, totalFilas=0;
hojasABorrar.forEach(nombre => {
const h = ss.getSheetByName(nombre);
if (h && h.getLastRow() > 1) {
const filas = h.getLastRow()-1;
h.deleteRows(2, filas);
limpiadas++; totalFilas += filas;
}
});
Logger.log("✅ Limpieza: " + limpiadas + " hojas, " + totalFilas + " filas borradas.");
SpreadsheetApp.getUi().alert("✅ Limpieza completada\n\nHojas limpiadas: " + limpiadas + "\nFilas borradas: " + totalFilas);
}
// =================================================================================
// STOCK MIN/MAX
// =================================================================================
function ensureHojaStockLimites(ss) {
let h=ss.getSheetByName("StockLimites");
if(!h){
h=ss.insertSheet("StockLimites"); h.setTabColor("#884EA0");
const headers=["ID","Sucursal","Sabor","Tamaño","Mínimo","Máximo","Activo","Modificado"];
const r=h.getRange(1,1,1,headers.length); r.setValues([headers]); r.setBackground("#2E4756"); r.setFontColor("#FFFFFF"); r.setFontWeight("bold"); h.setFrozenRows(1);
h.setColumnWidth(1,160); h.setColumnWidth(2,120); h.setColumnWidth(3,160); h.setColumnWidth(4,100);
}
return h;
}
function getStockMinMax(sesion) {
soloOwner(sesion);
const ss=SpreadsheetApp.getActiveSpreadsheet(), h=ensureHojaStockLimites(ss), datos=h.getDataRange().getValues(), limites=[];
for(let i=1;i<datos.length;i++){const r=datos[i];if(!r[0])continue;limites.push({id:r[0],sucursal:r[1],sabor:r[2],tamano:r[3],minimo:Number(r[4])||0,maximo:Number(r[5])||0,activo:r[6]===true||r[6]==="TRUE",modificado:r[7]});}
return {ok:true,limites};
}
function saveStockMinMax(body, sesion) {
soloOwner(sesion);
const ss=SpreadsheetApp.getActiveSpreadsheet(), h=ensureHojaStockLimites(ss), datos=h.getDataRange().getValues(), ahora=new Date().toISOString(), id=body.id||("SLM-"+Date.now());
const fila=[id,body.sucursal||"",body.sabor||"",body.tamano||"",Number(body.minimo)||0,Number(body.maximo)||0,true,ahora];
for(let i=1;i<datos.length;i++){if(datos[i][0]===id||(datos[i][1]===body.sucursal&&datos[i][2]===body.sabor&&datos[i][3]===body.tamano)){h.getRange(i+1,1,1,8).setValues([fila]);return{ok:true,mensaje:"✅ Límite actualizado.",id};}}
h.appendRow(fila);
return {ok:true,mensaje:"✅ Límite guardado.",id};
}
// =================================================================================
// ALERTAS
// =================================================================================
function getAlertas(sesion) {
soloOwner(sesion);
const ss=SpreadsheetApp.getActiveSpreadsheet();
const hInv=ss.getSheetByName("Inventario"), inv=hInv?hInv.getDataRange().getValues():[];
const stockMap={};
for(let i=1;i<inv.length;i++){const r=inv[i];if(!r[0])continue;const sucursal=r[3],sabor=r[1],tamano=r[2],cant=Number(r[5])||0,hoy=new Date();const k=`${sucursal}|${sabor}|${tamano}`;stockMap[k]=(stockMap[k]||0)+cant;}
const hLim=ensureHojaStockLimites(ss), lim=hLim.getDataRange().getValues(), alertas=[], sugerencias=[];
for(let i=1;i<lim.length;i++){
const r=lim[i];if(!r[0]||r[6]===false||r[6]==="FALSE")continue;
const sucursal=r[1],sabor=r[2],tamano=r[3],minimo=Number(r[4]),maximo=Number(r[5]),k=`${sucursal}|${sabor}|${tamano}`,stock=stockMap[k]||0;
if(minimo>0&&stock<=minimo){
const urgente=stock===0;
alertas.push({tipo:"bajo",urgente,sucursal,sabor,tamano,stock,minimo,maximo,mensaje:`${urgente?"⛔":"⚠️"} ${sabor} ${tamano} en ${sucursal}: ${stock} uds (mínimo: ${minimo})`});
const producir=maximo>0?maximo-stock:minimo*2;
sugerencias.push({tipo:"produccion",sucursal,sabor,tamano,mensaje:`Producir ${producir} ${sabor} ${tamano} para ${sucursal}`});
const otraSuc=sucursal==="Cuajimalpa"?"Polanco":"Cuajimalpa", kOtra=`${otraSuc}|${sabor}|${tamano}`, stockOtra=stockMap[kOtra]||0, limOtra=_getLimite(lim,otraSuc,sabor,tamano);
if(limOtra&&stockOtra>limOtra.maximo&&limOtra.maximo>0){const excedente=stockOtra-limOtra.maximo,transferir=Math.min(excedente,minimo-stock);if(transferir>0)sugerencias.push({tipo:"transferencia",de:otraSuc,a:sucursal,sabor,tamano,cantidad:transferir,mensaje:`Transferir ${transferir} ${sabor} ${tamano} de ${otraSuc} → ${sucursal}`});}
}
if(maximo>0&&stock>maximo) alertas.push({tipo:"excedente",sucursal,sabor,tamano,stock,minimo,maximo,mensaje:`📦 ${sabor} ${tamano} en ${sucursal}: ${stock} uds (máximo: ${maximo})`});
}
return {ok:true,alertas,sugerencias,totalAlertas:alertas.length,hayUrgentes:alertas.some(a=>a.urgente)};
}
function _getLimite(limDatos,sucursal,sabor,tamano){for(let i=1;i<limDatos.length;i++){const r=limDatos[i];if(r[1]===sucursal&&r[2]===sabor&&r[3]===tamano)return{minimo:Number(r[4]),maximo:Number(r[5])};}return null;}
// =================================================================================
// MENSAJES
// =================================================================================
function ensureHojaMensajes(ss) {
let h=ss.getSheetByName("Mensajes");
if(!h){h=ss.insertSheet("Mensajes");h.setTabColor("#1A6B3C");const headers=["ID","De","Para","Asunto","Cuerpo","Tipo","Leído","Fecha"];const r=h.getRange(1,1,1,headers.length);r.setValues([headers]);r.setBackground("#2E4756");r.setFontColor("#FFFFFF");r.setFontWeight("bold");h.setFrozenRows(1);h.setColumnWidth(4,200);h.setColumnWidth(5,320);}
return h;
}
function getMensajes(sesion) {
const ss=SpreadsheetApp.getActiveSpreadsheet(), h=ensureHojaMensajes(ss), datos=h.getDataRange().getValues(), mensajes=[];
for(let i=datos.length-1;i>=1;i--){const r=datos[i];if(!r[0])continue;if(r[2]!==sesion.usuario&&r[2]!=="todos")continue;mensajes.push({id:r[0],de:r[1],para:r[2],asunto:r[3],cuerpo:r[4],tipo:r[5],leido:r[6]===true||r[6]==="TRUE",fecha: r[7] instanceof Date ? Utilities.formatDate(r[7], TZ_MX, "yyyy-MM-dd'T'HH:mm:ss") : r[7]});if(mensajes.length>=50)break;}
return {ok:true,mensajes,noLeidos:mensajes.filter(m=>!m.leido).length};
}
function enviarMensaje(body,sesion){const ss=SpreadsheetApp.getActiveSpreadsheet(),h=ensureHojaMensajes(ss),id="MSG-"+Date.now();h.appendRow([id,body.de||sesion.usuario,body.para||"todos",body.asunto||"",body.cuerpo||"",body.tipo||"manual",false,new Date().toISOString()]);return{ok:true,mensaje:"✅ Mensaje enviado.",id};}
function marcarLeidoMensaje(body,sesion){const ss=SpreadsheetApp.getActiveSpreadsheet(),h=ensureHojaMensajes(ss),datos=h.getDataRange().getValues();for(let i=1;i<datos.length;i++){if(datos[i][0]===body.id){h.getRange(i+1,7).setValue(true);return{ok:true};}}return{ok:false,error:"Mensaje no encontrado."};}
function _generarAlertasMensajes(ss, sesion) {
try {
const alertasRes = getAlertas(sesion); if (!alertasRes.ok) return;
const h = ensureHojaMensajes(ss);
alertasRes.alertas.forEach(a => { h.appendRow(["MSG-"+Date.now(),"Sistema","todos",a.urgente?"⛔ Stock agotado":"⚠️ Stock bajo",a.mensaje,"alerta_stock",false,new Date().toISOString()]); Utilities.sleep(10); });
alertasRes.sugerencias.forEach(s => { h.appendRow(["MSG-"+Date.now(),"Sistema","todos",s.tipo==="transferencia"?"🔄 Sugerencia de transferencia":"📋 Sugerencia de producción",s.mensaje,"sugerencia",false,new Date().toISOString()]); Utilities.sleep(10); });
} catch(e) {}
}
// =================================================================================
// TRANSFERENCIAS
// =================================================================================
function ensureHojaTransferencias(ss) {
let h=ss.getSheetByName("Transferencias");
if(!h){h=ss.insertSheet("Transferencias");h.setTabColor("#2E86C1");const headers=["ID","Sabor","Tamaño","Cantidad","Estado","Fecha Solicitud","Fecha Confirmación","Solicitado Por","Confirmado Por","Notas"];const r=h.getRange(1,1,1,headers.length);r.setValues([headers]);r.setBackground("#2E4756");r.setFontColor("#FFFFFF");r.setFontWeight("bold");h.setFrozenRows(1);h.setColumnWidth(1,160);h.setColumnWidth(2,160);h.setColumnWidth(10,220);}
return h;
}
function registrarTransferencia(body, sesion) {
requierePuedeTransferir(sesion);
const sabor=body.sabor, tamano=body.tamano, cantidad=Number(body.cantidad);
if(!sabor||!tamano||!cantidad||cantidad<=0) return {ok:false,error:"Faltan datos de la transferencia."};
const lock=LockService.getScriptLock();
try{ lock.waitLock(30000); }catch(e){ return {ok:false,error:"El sistema esta ocupado, intenta de nuevo."}; }
try{
  const _opId=String(body.opId||"").trim();
  const _opDup=_opYaRegistrada(_opId);
  if(_opDup) return _opDup;
  const ss=SpreadsheetApp.getActiveSpreadsheet(), ahora=new Date().toISOString(), id="TRF-"+Date.now();
  invTransferir(ss,sabor,tamano,cantidad,id,sesion.usuario,body.notas||"");
  const h=ensureHojaTransferencias(ss);
  h.appendRow([id,sabor,tamano,cantidad,"completada",ahora,ahora,sesion.usuario,sesion.usuario,body.notas||""]);
  registrarAuditoria(sesion.usuario,sesion.rol,"TRANSFERENCIA",`${cantidad}x ${sabor} ${tamano} Cuajimalpa -> Polanco`);
  const _resOk={ok:true,mensaje:`✅ ${cantidad} ${sabor} ${tamano} movidos a Polanco.`,id};
  _opRegistrar(_opId,_resOk);
  return _resOk;
}catch(err){ return {ok:false,error:String(err&&err.message?err.message:err)}; }
finally{ try{lock.releaseLock();}catch(_e){} }
}
function getTransferencias(sesion){
const p = getPermisos(sesion.rol);
if (!p.esAdmin && !p.puedeTransferir) throw new Error("Acción no permitida.");
const ss=SpreadsheetApp.getActiveSpreadsheet(),h=ensureHojaTransferencias(ss),transferencias=[];
// v6.3: lee solo las ultimas 300 filas (la vista muestra max 100)
const _lrT=h.getLastRow(),_lcT=h.getLastColumn();
const _iniT=Math.max(2,_lrT-300+1);
const datos=_lrT<2?[]:h.getRange(_iniT,1,_lrT-_iniT+1,_lcT).getValues();
const headers = h.getRange(1, 1, 1, _lcT).getValues()[0];
const idxEstadoAnul = headers.indexOf("estado_anul");
for(let i=datos.length-1;i>=0;i--){const r=datos[i];if(!r[0])continue;if(idxEstadoAnul!==-1&&r[idxEstadoAnul]==="ANULADO")continue;transferencias.push({id:r[0],sabor:r[1],tamano:r[2],cantidad:Number(r[3]),estado:r[4],fechaSolicitud: r[5] instanceof Date ? Utilities.formatDate(r[5], TZ_MX, "yyyy-MM-dd'T'HH:mm:ss") : r[5],fechaConfirmacion: r[6] instanceof Date ? Utilities.formatDate(r[6], TZ_MX, "yyyy-MM-dd'T'HH:mm:ss") : r[6],solicitadoPor:r[7],confirmadoPor:r[8],notas:r[9]});if(transferencias.length>=100)break;}
return {ok:true,transferencias};
}
function confirmarTransferencia(body, sesion) {
requierePuedeTransferir(sesion);
const ss=SpreadsheetApp.getActiveSpreadsheet(), h=ensureHojaTransferencias(ss), datos=h.getDataRange().getValues(), ahora=new Date().toISOString();
for(let i=1;i<datos.length;i++){
  if(datos[i][0]!==body.id)continue;
  if(datos[i][4]!=="pendiente")return{ok:false,error:"La transferencia ya fue procesada."};
  const sabor=datos[i][1],tamano=datos[i][2],cantidad=Number(datos[i][3]);
  const lock=LockService.getScriptLock(); try{lock.waitLock(30000);}catch(e){return{ok:false,error:"Sistema ocupado."};}
  try{ invTransferir(ss,sabor,tamano,cantidad,body.id,sesion.usuario,"confirmacion");
    h.getRange(i+1,5).setValue("confirmada");h.getRange(i+1,7).setValue(ahora);h.getRange(i+1,9).setValue(sesion.usuario);
    _registrarAuditoria(ss,sesion,"CONFIRMAR_TRANSFERENCIA",`${cantidad}x ${sabor} ${tamano} | ID: ${body.id}`);
    return{ok:true,mensaje:"✅ Transferencia confirmada."};
  }catch(err){return{ok:false,error:String(err&&err.message?err.message:err)};}
  finally{try{lock.releaseLock();}catch(_e){}}
}
return{ok:false,error:"Transferencia no encontrada."};
}
function _getStockSucursal(ss,sucursal,sabor,tamano){ return invDisponible(ss,sabor,tamano,sucursal); }
// =================================================================================
// ZONAS DE ENVÍO
// =================================================================================
function ensureHojaZonasEnvio(ss){let h=ss.getSheetByName("ZonasEnvio");if(!h){h=ss.insertSheet("ZonasEnvio");h.setTabColor("#1A5276");const headers=["ID","Nombre zona","Colonias / Códigos postales","Costo envío ($)","Activo","Modificado"];const r=h.getRange(1,1,1,headers.length);r.setValues([headers]);r.setBackground("#2E4756");r.setFontColor("#FFFFFF");r.setFontWeight("bold");h.setFrozenRows(1);h.setColumnWidth(2,180);h.setColumnWidth(3,320);h.setColumnWidth(4,120);}return h;}
function getZonasEnvio(sesion){const _vhZ=_velGet("zon","zonas");if(_vhZ)return _vhZ;const ss=SpreadsheetApp.getActiveSpreadsheet(),h=ensureHojaZonasEnvio(ss),datos=h.getDataRange().getValues(),zonas=[];for(let i=1;i<datos.length;i++){const r=datos[i];if(!r[0])continue;zonas.push({id:r[0],nombre:r[1],colonias:String(r[2]||"").split(",").map(s=>s.trim()).filter(Boolean),costo:Number(r[3])||0,activo:r[4]===true||r[4]==="TRUE",modificado:r[5]});}const _voZ={ok:true,zonas};_velPut("zon","zonas",_voZ,300);return _voZ;}
function saveZonaEnvio(body,sesion){soloOwner(sesion);_velBump("zon");const ss=SpreadsheetApp.getActiveSpreadsheet(),h=ensureHojaZonasEnvio(ss),datos=h.getDataRange().getValues(),ahora=new Date().toISOString(),id=body.id||("ZNV-"+Date.now()),colonias=Array.isArray(body.colonias)?body.colonias.join(", "):String(body.colonias||""),fila=[id,body.nombre||"",colonias,Number(body.costo)||0,true,ahora];for(let i=1;i<datos.length;i++){if(datos[i][0]===id){h.getRange(i+1,1,1,6).setValues([fila]);return{ok:true,mensaje:"✅ Zona actualizada.",id};}}h.appendRow(fila);_registrarAuditoria(ss,sesion,"ALTA_ZONA_ENVIO",`${body.nombre} — $${body.costo}`);return{ok:true,mensaje:"✅ Zona de envío guardada.",id};}
function deleteZonaEnvio(body,sesion){soloOwner(sesion);_velBump("zon");const ss=SpreadsheetApp.getActiveSpreadsheet(),h=ensureHojaZonasEnvio(ss),datos=h.getDataRange().getValues();for(let i=1;i<datos.length;i++){if(datos[i][0]===body.id){h.getRange(i+1,5).setValue(false);return{ok:true,mensaje:"✅ Zona eliminada."};}}return{ok:false,error:"Zona no encontrada."};}
// ===== NOTAS DEL CREADOR (Owner) — buzon error/idea para el robot nocturno =====
function ensureHojaNotas(ss){
var h=ss.getSheetByName("Notas_Creador");
if(!h){ h=ss.insertSheet("Notas_Creador"); h.setTabColor("#6C3483");
var hdr=["id","fecha","usuario","tipo","texto","estado","procesado_skill","foto_url"];
var r=h.getRange(1,1,1,hdr.length); r.setValues([hdr]); r.setBackground("#2E4756"); r.setFontColor("#FFFFFF"); r.setFontWeight("bold"); h.setFrozenRows(1);
h.setColumnWidth(5,420);
}
return h;
}
function guardarFotoNota(dataUrl, id){
try{
if(!dataUrl || String(dataUrl).indexOf("base64,")<0) return "";
var m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/.exec(String(dataUrl));
if(!m) return "";
var tipo=m[1], b64=m[2];
var bytes=Utilities.base64Decode(b64);
var ext = tipo.indexOf("png")>=0?"png":(tipo.indexOf("webp")>=0?"webp":"jpg");
var blob=Utilities.newBlob(bytes, tipo, "nota"+id+"."+ext);
var folder;
var it=DriveApp.getFoldersByName("TV_Notas_Fotos");
folder = it.hasNext()? it.next() : DriveApp.createFolder("TV_Notas_Fotos");
var f=folder.createFile(blob);
try{ f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }catch(e){}
return f.getUrl();
}catch(e){ return ""; }
}
function registrarNota(body, sesion){
// Visible/usable por TODOS los usuarios autenticados (la sesion ya viene validada).
var texto=String((body&&body.texto)||"").trim();
if(!texto) return {ok:false, error:"La nota viene vacia."};
var tipo=(body&&body.tipo==="Idea")?"Idea":"Error";
var ss=SpreadsheetApp.getActiveSpreadsheet(), h=ensureHojaNotas(ss);
// migracion: asegurar columna foto_url en hojas viejas
var hdr=h.getRange(1,1,1,h.getLastColumn()).getValues()[0];
var idxFoto=hdr.indexOf("foto_url");
if(idxFoto===-1){ idxFoto=h.getLastColumn(); h.getRange(1, idxFoto+1).setValue("foto_url"); }
var id="NT-"+Date.now()+"-"+Math.floor(Math.random()*1000);
var fecha=Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd'T'HH:mm:ss");
var fotoUrl = (body&&body.foto)? _guardarFotoNota(body.foto, id) : "";
var fila=[id, fecha, sesion.usuario||"", tipo, texto, "nueva", ""];
while(fila.length < idxFoto) fila.push("");
fila[idxFoto]=fotoUrl;
h.appendRow(fila);
try{ registrarAuditoria(ss, sesion, "NOTA"+tipo.toUpperCase(), texto.substring(0,120)); }catch(e){}
return {ok:true, mensaje:(tipo==="Idea"?"💡 Idea guardada":"🐞 Error registrado")+(fotoUrl?" (con foto)":"")+" — se procesa esta noche."};
}
function getNotas(body, sesion){
var ss=SpreadsheetApp.getActiveSpreadsheet(), h=ss.getSheetByName("Notas_Creador");
if(!h) return {ok:true, notas:[]};
var d=h.getDataRange().getValues(), out=[];
for(var i=1;i<d.length;i++){ var r=d[i]; if(!r[0]) continue;
out.push({ id:r[0],
fecha: r[1] instanceof Date ? Utilities.formatDate(r[1], TZ_MX, "yyyy-MM-dd'T'HH:mm:ss") : String(r[1]||""),
usuario:r[2], tipo:r[3], texto:r[4], estado:r[5]||"nueva", procesado:r[6]||"",
foto: (function(){ var fi=d[0].indexOf("foto_url"); return fi>=0?(r[fi]||""):""; })() });
}
out.sort(function(a,b){ return String(b.fecha).localeCompare(String(a.fecha)); });
var lim=(body&&body.limite)?Number(body.limite):50;
return {ok:true, notas: out.slice(0, lim)};
}
function setNotaEstado(body, sesion){
soloOwner(sesion);
var id=body&&body.id, estado=(body&&body.estado)||"resuelta";
if(!id) return {ok:false, error:"Falta id."};
var ss=SpreadsheetApp.getActiveSpreadsheet(), h=ensureHojaNotas(ss), d=h.getDataRange().getValues();
for(var i=1;i<d.length;i++){ if(d[i][0]===id){ h.getRange(i+1,6).setValue(estado); return {ok:true, mensaje:"Nota actualizada."}; } }
return {ok:false, error:"Nota no encontrada."};
}
// =================================================================================
// PRECIOS POR CANAL
// =================================================================================
function ensureHojaCanalPrecios(ss){let h=ss.getSheetByName("CanalPrecios");if(!h){h=ss.insertSheet("CanalPrecios");h.setTabColor("#884EA0");const headers=["ID","Canal","Tipo","Valor","Activo","Modificado"];const r=h.getRange(1,1,1,headers.length);r.setValues([headers]);r.setBackground("#2E4756");r.setFontColor("#FFFFFF");r.setFontWeight("bold");h.setFrozenRows(1);h.setColumnWidth(2,160);h.setColumnWidth(3,100);h.setColumnWidth(4,100);}return h;}
function getCanalPrecios(sesion){const _vhC=_velGet("cnl","reglas");if(_vhC)return _vhC;const ss=SpreadsheetApp.getActiveSpreadsheet(),h=ensureHojaCanalPrecios(ss),datos=h.getDataRange().getValues(),reglas=[];for(let i=1;i<datos.length;i++){const r=datos[i];if(!r[0])continue;reglas.push({id:r[0],canal:r[1],tipo:r[2],valor:Number(r[3])||0,activo:r[4]===true||r[4]==="TRUE",modificado:r[5]});}const _voC={ok:true,reglas};_velPut("cnl","reglas",_voC,300);return _voC;}
function saveCanalPrecio(body,sesion){soloOwner(sesion);_velBump("cnl");const ss=SpreadsheetApp.getActiveSpreadsheet(),h=ensureHojaCanalPrecios(ss),datos=h.getDataRange().getValues(),ahora=new Date().toISOString(),id=body.id||("CPN-"+Date.now()),fila=[id,body.canal||"",body.tipo||"pct",Number(body.valor)||0,true,ahora];for(let i=1;i<datos.length;i++){if(datos[i][1]===body.canal&&datos[i][0]!==id)h.getRange(i+1,5).setValue(false);if(datos[i][0]===id){h.getRange(i+1,1,1,6).setValues([fila]);return{ok:true,mensaje:"✅ Regla actualizada.",id};}}h.appendRow(fila);_registrarAuditoria(ss,sesion,"ALTA_CANAL_PRECIO",`${body.canal}: ${body.tipo==="pct"?body.valor+"%":"$"+body.valor}`);return{ok:true,mensaje:"✅ Regla guardada.",id};}
function deleteCanalPrecio(body,sesion){soloOwner(sesion);_velBump("cnl");const ss=SpreadsheetApp.getActiveSpreadsheet(),h=ensureHojaCanalPrecios(ss),datos=h.getDataRange().getValues();for(let i=1;i<datos.length;i++){if(datos[i][0]===body.id){h.getRange(i+1,5).setValue(false);return{ok:true};}}return{ok:false,error:"Regla no encontrada."};}
// =================================================================================
// COMISIONES
// =================================================================================
function ensureHojaComisiones(ss) {
let h = ss.getSheetByName("Comisiones");
if (!h) {
h = ss.insertSheet("Comisiones"); h.setTabColor("#884EA0");
const headers = ["Método / Canal", "Porcentaje (decimal)", "Modificado"];
const r = h.getRange(1,1,1,headers.length); r.setValues([headers]); r.setBackground("#2E4756"); r.setFontColor("#FFFFFF"); r.setFontWeight("bold"); h.setFrozenRows(1);
h.setColumnWidth(1,200); h.setColumnWidth(2,180); h.setColumnWidth(3,200);
const defaults = [["Tarjeta",-0.06,new Date().toISOString()],["Transferencia",-0.03,new Date().toISOString()],["Rappi",-0.23,new Date().toISOString()],["Uber Eats",-0.23,new Date().toISOString()],["Efectivo",0,new Date().toISOString()]];
h.getRange(2,1,defaults.length,3).setValues(defaults);
}
return h;
}
function getComisionesConfig(sesion) {
soloOwner(sesion);
const ss=SpreadsheetApp.getActiveSpreadsheet(), h=ensureHojaComisiones(ss), datos=h.getDataRange().getValues(), comisiones={};
for(let i=1;i<datos.length;i++){const nombre=datos[i][0],pct=Number(datos[i][1]);if(nombre)comisiones[nombre]=pct;}
return {ok:true,comisiones};
}
function saveComisionConfig(body, sesion) {
soloOwner(sesion);
const{nombre,porcentaje}=body;
if(!nombre)return{ok:false,error:"Nombre requerido."};
const ss=SpreadsheetApp.getActiveSpreadsheet(),h=ensureHojaComisiones(ss),datos=h.getDataRange().getValues(),ahora=new Date().toISOString();
for(let i=1;i<datos.length;i++){
if(datos[i][0]===nombre){h.getRange(i+1,2).setValue(Number(porcentaje)||0);h.getRange(i+1,3).setValue(ahora);registrarAuditoria(sesion.usuario,sesion.rol,"UPDATE_COMISION",`${nombre}: ${(Math.abs(Number(porcentaje))*100).toFixed(1)}%`);return{ok:true,mensaje:`✅ Comisión ${nombre} actualizada.`};}
}
h.appendRow([nombre,Number(porcentaje)||0,ahora]);
registrarAuditoria(sesion.usuario,sesion.rol,"ALTA_COMISION",`${nombre}: ${(Math.abs(Number(porcentaje))*100).toFixed(1)}%`);
return{ok:true,mensaje:`✅ Comisión ${nombre} guardada.`};
}
// =================================================================================
// CARGA INICIAL (sin cambios)
// =================================================================================
function cargarDatosIniciales() {
const ss=SpreadsheetApp.getActiveSpreadsheet(), ui=SpreadsheetApp.getUi();
let log=[];
const INSUMOS=[{nombre:"Galleta Lotus",buyQty:250,buyUnit:"g",buyPrice:60},{nombre:"Chocolate blanco",buyQty:1000,buyUnit:"g",buyPrice:250},{nombre:"Frutos rojos",buyQty:1300,buyUnit:"g",buyPrice:180},{nombre:"Limón Colima",buyQty:1000,buyUnit:"g",buyPrice:55},{nombre:"Limón",buyQty:1000,buyUnit:"g",buyPrice:55},{nombre:"Limón eureka",buyQty:1000,buyUnit:"g",buyPrice:65},{nombre:"Merengue",buyQty:500,buyUnit:"g",buyPrice:250},{nombre:"Queso brie",buyQty:1000,buyUnit:"g",buyPrice:500},{nombre:"Tapa galleta Oreo",buyQty:9000,buyUnit:"g",buyPrice:1000},{nombre:"Galleta Oreo",buyQty:115,buyUnit:"g",buyPrice:15},{nombre:"Ate de guayaba",buyQty:6000,buyUnit:"g",buyPrice:140},{nombre:"Guayaba en almíbar",buyQty:400,buyUnit:"g",buyPrice:62}];
const hojaIns=ensureHojaInsumos(ss), datosIns=hojaIns.getDataRange().getValues(), nombresExistentes=datosIns.slice(1).map(r=>String(r[1]).toLowerCase());
let insumosCreados=0;
for(const ins of INSUMOS){if(nombresExistentes.includes(ins.nombre.toLowerCase())){log.push("↩ Ya existe: "+ins.nombre);continue;}const id="INS-"+new Date().getTime()+Math.floor(Math.random()*1000),costo=ins.buyPrice/ins.buyQty;hojaIns.appendRow([id,ins.nombre,"",ins.buyQty,ins.buyUnit,ins.buyPrice,costo,"TRUE",new Date().toISOString()]);log.push("✅ Insumo: "+ins.nombre);insumosCreados++;Utilities.sleep(50);}
ui.alert("Carga inicial completada","Insumos nuevos: "+insumosCreados+"\n\n"+log.join("\n"),ui.ButtonSet.OK);
}
