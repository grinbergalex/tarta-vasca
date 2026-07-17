// ============================================================================
// v6.5 — UTILIDADES DIFERIDAS (2026-07-16)
// Antes: recalcularUtilidades() corria DENTRO de cada venta/merma/gasto/precio,
// reconstruyendo la hoja Utilidades completa (una fila por venta historica)
// mientras sostenia el lock global. Con el historial creciendo, cada venta se
// volvia mas lenta y los demas usuarios chocaban con "Sistema ocupado".
// Ahora: las escrituras solo marcan una bandera (milisegundos) y un trigger
// cada 10 min reconstruye la hoja SOLO si hubo cambios. La hoja Utilidades
// no la lee ninguna accion de la API (los reportes del app calculan desde
// Ventas); es solo la pestana que se consulta en el Sheet, asi que puede
// llevar hasta 10 min de retraso sin afectar nada.
// ACTIVAR UNA VEZ desde el editor:  instalarTriggerUtilidades()
// ============================================================================
function _utilMarcarDirty(){
  try { PropertiesService.getScriptProperties().setProperty("UTIL_DIRTY", "1"); } catch(e) {}
}

function recalcularUtilidadesSiDirty(){
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("UTIL_DIRTY") !== "1") return;
  props.deleteProperty("UTIL_DIRTY");
  // Sin lock: si una venta escribe a mitad de la reconstruccion, esa venta
  // re-marca la bandera y el siguiente tick corrige la hoja.
  recalcularUtilidades(SpreadsheetApp.getActiveSpreadsheet());
}

function instalarTriggerUtilidades(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()==="recalcularUtilidadesSiDirty") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("recalcularUtilidadesSiDirty").timeBased().everyMinutes(10).create();
  _utilMarcarDirty(); // fuerza una primera reconstruccion al proximo tick
  Logger.log("OK: trigger cada 10 min instalado (recalcularUtilidadesSiDirty).");
  return { ok:true, mensaje:"Trigger de utilidades instalado (cada 10 min)." };
}

// ============================================================================
// v6.5d — PROXY DE IA (2026-07-16)
// La "carga masiva con IA" del frontend llamaba a api.anthropic.com directo
// desde el navegador: sin API key no funcionaba, y ponerla en el HTML la
// haria publica. Ahora el frontend llama la accion "iaProcesar" y este proxy
// hace la llamada con la key guardada en Propiedades del script.
// ACTIVAR: Configuracion del proyecto (engrane) → Propiedades del script →
// agregar ANTHROPIC_API_KEY con una key de console.anthropic.com.
// ============================================================================
function iaProcesar(body, sesion) {
  soloOwner(sesion);
  const apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) return { ok:false, error:"Falta configurar ANTHROPIC_API_KEY en Apps Script (Configuración del proyecto → Propiedades del script)." };
  const prompt = String(body.prompt || "").substring(0, 30000);
  if (!prompt.trim()) return { ok:false, error:"Falta el texto a procesar." };
  try {
    const resp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }]
      }),
      muteHttpExceptions: true
    });
    const data = JSON.parse(resp.getContentText());
    if (resp.getResponseCode() !== 200) {
      const msg = (data && data.error && data.error.message) ? data.error.message : ("HTTP " + resp.getResponseCode());
      return { ok:false, error: "IA: " + msg };
    }
    let texto = "";
    (data.content || []).forEach(function(b){ if (b.type === "text") texto += b.text; });
    if (!texto) return { ok:false, error: "IA: respuesta vacía (stop_reason: " + (data.stop_reason||"?") + ")." };
    return { ok:true, texto: texto };
  } catch(e) { return { ok:false, error: "IA: " + e.message }; }
}

// ============================================================================
// v6.5b — IDEMPOTENCIA DE ESCRITURAS (2026-07-16)
// El frontend manda body.opId (UUID) en venta/merma/produccion/transferencia.
// Si la misma operacion llega dos veces (reintento tras respuesta perdida),
// el servidor regresa el resultado original en vez de duplicarla. El check
// corre DENTRO del lock para que dos peticiones simultaneas no se crucen.
// ponytail: CacheService puede desalojar antes de las 6h; si pasa, el dedupe
// no aplica y queda el comportamiento previo. Cubre la ventana real de
// reintentos (segundos). Si algun dia hiciera falta durabilidad total,
// migrar a una hoja de operaciones con limpieza periodica.
// ============================================================================
function _opYaRegistrada(opId){
  if(!opId) return null;
  try { const c = CacheService.getScriptCache().get("tvop_"+opId); return c ? JSON.parse(c) : null; } catch(e){ return null; }
}
function _opRegistrar(opId, resultado){
  if(!opId) return;
  try { CacheService.getScriptCache().put("tvop_"+opId, JSON.stringify(resultado), 21600); } catch(e){}
}

// ============================================================================
// v6.1 — AUDITORIA AUTOMATICA DIARIA (2026-07-02)
// instalarAuditoriaDiaria(): correr UNA sola vez desde el editor (crea el
//   trigger diario de las 7am; si ya existia, lo reemplaza).
// auditoriaDiaria(): corre auditarConsistencia() y manda correo SOLO si hay
//   inconsistencias (rojo). Los lunes manda ademas un "latido" verde para
//   confirmar que la vigilancia sigue activa.
// ============================================================================
var AUDIT_EMAIL_DESTINO = "grinbergalex@gmail.com";

function instalarAuditoriaDiaria(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()==="auditoriaDiaria") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("auditoriaDiaria").timeBased().everyDays(1).atHour(7).create();
  Logger.log("OK: trigger diario 7am instalado (auditoriaDiaria).");
  return { ok:true, mensaje:"Trigger diario 7am instalado." };
}

function auditoriaDiaria(){
  var res;
  try{ res = auditarConsistencia(); }
  catch(e){
    MailApp.sendEmail(AUDIT_EMAIL_DESTINO, "[Tarta Vasca] ROJO: la auditoria de inventario fallo al correr", "Error al ejecutar auditarConsistencia():\n\n"+e+"\n\nRevisar en Apps Script (editor > Ejecuciones).");
    return;
  }
  var esLunes = (new Date()).getDay()===1;
  if(res.ok){
    if(esLunes) MailApp.sendEmail(AUDIT_EMAIL_DESTINO, "[Tarta Vasca] Verde: inventario consistente (latido semanal)", "auditarConsistencia() salio en verde.\n\nEste correo llega solo los lunes, para confirmar que la auditoria diaria sigue corriendo. Los demas dias: sin noticias = verde.");
    return;
  }
  var cuerpo = "La auditoria diaria encontro "+res.diferencias.length+" SKU con diferencias entre Inventario e Inv_Ledger:\n\n";
  res.diferencias.forEach(function(d){
    cuerpo += "- "+d.sku+"\n    Inventario: total "+d.inventario.total+", ruta "+d.inventario.ruta+", apartado "+d.inventario.apart+"\n    Ledger:     total "+d.ledger.total+", ruta "+d.ledger.ruta+", apartado "+d.ledger.apart+"\n";
  });
  cuerpo += "\nQue hacer: 1) revisar los movimientos recientes de esas SKU en la hoja Inv_Ledger; 2) si el fisico es correcto, corregir con la pestana Ajuste de inventario (conteo fisico).";
  MailApp.sendEmail(AUDIT_EMAIL_DESTINO, "[Tarta Vasca] ROJO: "+res.diferencias.length+" inconsistencia(s) de inventario", cuerpo);
}


// ============================================================================
// v6.1 — ANCLA DE APERTURA DEL LEDGER (correr UNA vez desde el editor)
// Contexto: del ~14 al 28-jun el sistema corrio con codigo v4 que NO escribia
// en Inv_Ledger -> el ledger tiene un hueco de 2 semanas y la auditoria sale
// roja aunque el inventario fisico este bien. Esta funcion escribe un asiento
// APERTURA_CORTE por SKU con el delta exacto para que la suma del ledger quede
// igual al inventario actual. Termina corriendo la auditoria (debe dar verde).
// ============================================================================
function anclarLedgerApertura(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var res=auditarConsistencia();
  if(res.ok){ Logger.log("Ledger ya esta en verde; no se escribio nada."); return res; }
  var ref="ANCLA-"+Utilities.formatDate(new Date(),TZ_MX,"yyyyMMdd-HHmm");
  res.diferencias.forEach(function(d){
    var p=d.sku.split("|"); var suc=p[0], sabor=p[1], tam=p[2];
    var dT=(d.inventario.total-d.ledger.total), dR=(d.inventario.ruta-d.ledger.ruta), dA=(d.inventario.apart-d.ledger.apart);
    _invLedger(ss,"APERTURA_CORTE",sabor,tam,suc,"",dT,dR,dA,d.inventario.total,d.inventario.ruta,d.inventario.apart,ref,"sistema","Corte de apertura: ancla el ledger al inventario actual (hueco v4 del 14-28 jun)");
  });
  SpreadsheetApp.flush();
  var fin=auditarConsistencia();
  Logger.log(fin.ok ? "ANCLA OK -> CONSISTENCIA verde" : "Quedaron diferencias: "+JSON.stringify(fin.diferencias));
  return fin;
}


// ============================================================================
// v6.2 — RESPALDO AUTOMATICO DIARIO DEL SHEET (2026-07-02)
// Pegar este bloque AL FINAL del codigo (o usar el archivo completo v6.2).
// instalarRespaldoDiario(): correr UNA vez desde el editor. Crea trigger 2am.
// respaldoDiario(): copia el Sheet completo a la carpeta Drive "Respaldos TV"
//   y borra (a papelera) los respaldos con mas de 30 dias. Si falla, correo.
// ============================================================================
var RESPALDO_FOLDER_NAME = "Respaldos TV";
var RESPALDO_DIAS_CONSERVAR = 30;

function instalarRespaldoDiario(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()==="respaldoDiario") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("respaldoDiario").timeBased().everyDays(1).atHour(2).create();
  Logger.log("OK: trigger diario 2am instalado (respaldoDiario).");
  return { ok:true, mensaje:"Respaldo diario 2am instalado." };
}

function respaldoDiario(){
  try{
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var file = DriveApp.getFileById(ss.getId());
    var it = DriveApp.getFoldersByName(RESPALDO_FOLDER_NAME);
    var folder = it.hasNext() ? it.next() : DriveApp.createFolder(RESPALDO_FOLDER_NAME);
    var nombre = "TV_respaldo_" + Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd_HHmm");
    file.makeCopy(nombre, folder);
    var lim = new Date(Date.now() - RESPALDO_DIAS_CONSERVAR*24*60*60*1000);
    var files = folder.getFiles();
    while(files.hasNext()){
      var f = files.next();
      if(f.getName().indexOf("TV_respaldo_")===0 && f.getDateCreated() < lim) f.setTrashed(true);
    }
    Logger.log("Respaldo OK: " + nombre);
    return { ok:true, nombre:nombre };
  }catch(e){
    try{ MailApp.sendEmail(AUDIT_EMAIL_DESTINO, "[Tarta Vasca] ROJO: fallo el respaldo diario del Sheet", "Error al respaldar:\n\n"+e+"\n\nRevisar en Apps Script > Ejecuciones."); }catch(e2){}
    return { ok:false, error:String(e) };
  }
}


// ============================================================================
// v6.3 — VELOCIDAD (2026-07-03)
// (1) Sesiones: validarToken usa CacheService — ya no lee+escribe la hoja
//     Sesiones_Activas en cada peticion (solo cache frio y refresco cada 5 min).
// (2) Cache de lecturas: getStock (30s), getCatalogo/getPrecios/getZonasEnvio/
//     getCanalPrecios (300s). Invalidacion instantanea al escribir:
//     _velBump(ns) cambia la "version" del namespace y todo lo cacheado muere.
//     El stock se invalida en _invLedger = punto unico de TODO movimiento.
// (3) Lecturas acotadas: Movimientos (1200 filas + headers 1 sola vez),
//     Transferencias (300), Auditoria (100).
// Sin cambios de logica de negocio. El frontend NO cambia.
// ============================================================================
var VEL_TOKEN_WRITE_MS = 5 * 60 * 1000; // ultimoAcceso a hoja max cada 5 min

function _velCache(){ return CacheService.getScriptCache(); }
function _velVer(ns){ try{ return _velCache().get("velv_"+ns) || "0"; }catch(e){ return "0"; } }
function _velBump(ns){ try{ _velCache().put("velv_"+ns, String(Date.now()), 21600); }catch(e){} }
function _velGet(ns, key){
  try{ var raw=_velCache().get("veld_"+ns+"_"+_velVer(ns)+"_"+key); return raw?JSON.parse(raw):null; }catch(e){ return null; }
}
function _velPut(ns, key, obj, secs){
  try{ var s=JSON.stringify(obj); if(s.length<95000) _velCache().put("veld_"+ns+"_"+_velVer(ns)+"_"+key, s, secs); }catch(e){}
}
function _velTokenDrop(token){
  try{ var p=String(token||"").split("|"); if(p.length) _velCache().remove("tvtok_"+p[0]); }catch(e){}
}
// Toca ultimoAcceso leyendo SOLO la columna A (no toda la hoja)
function _sesTouch(token, ahora){
  try{
    var h=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sesiones_Activas"); if(!h) return;
    var n=h.getLastRow(); if(n<2) return;
    var col=h.getRange(2,1,n-1,1).getValues();
    for(var i=0;i<col.length;i++){ if(col[i][0]===token){ h.getRange(i+2,7).setValue(ahora.toISOString()); return; } }
  }catch(e){}
}
function _sesEliminarFila(token){
  try{
    var h=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sesiones_Activas"); if(!h) return;
    var n=h.getLastRow(); if(n<2) return;
    var col=h.getRange(2,1,n-1,1).getValues();
    for(var i=col.length-1;i>=0;i--){ if(col[i][0]===token){ h.deleteRow(i+2); return; } }
  }catch(e){}
}
// Igual que _extraerEstadoFila pero SIN releer headers del sheet por cada fila
function _velEstadoFila(hoja, fila, idxEstadoAnul){
  if (idxEstadoAnul !== -1 && fila[idxEstadoAnul]) return fila[idxEstadoAnul];
  if (hoja === "Inventario") return fila[9] || "";
  if (hoja === "Transferencias") return fila[4] || "";
  return "";
}