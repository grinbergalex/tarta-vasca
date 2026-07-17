/**
 * ============================================================================
 * TARTA VASCA — BACKEND v6 "InvCore" (rewrite 2026-06-28)
 * Capa central unica de inventario. Reusa columnas v5 de tu hoja:
 *   Inventario col6=total | col16=res_ruta | col17=res_apartado
 *   disponible = total - res_ruta - res_apartado.  Hoja Inv_Ledger = bitacora.
 *
 * QUE CAMBIA vs v4.5.17:
 *  - Toda mutacion de inventario pasa por InvCore (producir/descontar/reservar/
 *    liberar/transferir/ajustar) y queda asentada en Inv_Ledger.
 *  - Transferencias atomicas y sin fantasmas.  Apartados con reserva FISICA:
 *    al entregar (convertirReservaAVenta) ahora SI descuenta inventario.
 *  - Disponible = una sola formula en todo el sistema (no mas oversell de
 *    stock reservado a ruta/apartado).
 *  - auditarConsistencia() compara inventario vs ledger (debe dar verde).
 *
 * ACTIVACION (NO pegar en media operacion):
 *  1. Pega TODO este codigo en Apps Script (reemplaza el actual). Guardar.
 *  2. Implementar -> Editar implementacion existente -> Nueva version (misma URL).
 *  3. En el editor, ejecutar UNA vez la funcion:  migrarReservasFisicas()
 *     (inicializa res_ruta/res_apartado desde apartados y rutas abiertas).
 *  4. Hacer conteo fisico con la pestana Ajuste de inventario (ambas sucursales).
 *  5. Ejecutar  auditarConsistencia()  -> debe decir "CONSISTENCIA OK (verde)".
 *  6. El index.html (frontend) NO cambia: ya lee disponible/reservado del backend.
 *
 * v6.1 (2026-07-02): (a) la reposicion por anulacion YA asienta en Inv_Ledger
 * (tipo REPOSICION_ANULACION) — limitacion v1 cerrada; (b) auditoria automatica
 * diaria 7am con correo solo si hay rojo + latido verde los lunes.
 * Activar una vez desde el editor:  instalarAuditoriaDiaria()
 * ============================================================================
 */

/**
TARTA VASCA — Apps Script API v4.5.17-pedido2 (base v4.5.13-skip-anulados)

CAMBIOS v4.5.17 (14-jun-2026):
★ getPedidoSugerido ahora devuelve TAMBIEN un segundo metodo (sugerido2 /
totalSugerido2 / metodo2): "tendencia mismo dia". Promedio ponderado de los
4 mismos dias de la semana anteriores con UNIDADES REALES (hace 1/2/3/4 sem
= 32/24/16/8%, bloque 80%) + 20% del sugerido del metodo 1, +10% buffer.
Redistribuye el peso de las semanas sin datos entre las que si tienen ventas.
El metodo 1 (ventana-7d) se conserva intacto.

BASE: v4.5.7-fix-inventario  (que a su vez basa en v4.5.6-flush-rutaId)

CAMBIOS v4.5.8 (24-may-2026):
★ altaProduccion ahora también usa LockService.waitLock(30s) + flush().
Sin esto, una venta inmediata después de cargar producción podía leer
inventario stale y sub-descontar. Cierra el último flanco del bug
de "inventario no se actualiza".

CAMBIOS v4.5.7 (24-may-2026):
★ FIX CRÍTICO: Inventario no descontaba correctamente cuando un mismo
sabor/tamaño aparecía repetido en la misma venta (ej. paquete con
sabores repetidos). Causa: descontarFIFO usaba un snapshot stale
de Inventario; ahora cada llamada re-lee fresh.
★ FIFO desactivado por decisión de negocio (ya no se ordena por fecha).
Renombrado descontarFIFO → descontarStock (alias mantenido).
★ LockService.waitLock(30s) en registrarVenta, registrarMerma y
eliminarMovimiento — serializa escrituras entre sesiones concurrentes.
★ Atómico: si cualquier item de la venta falla al descontar, todas las
deducciones se revierten (_rollbackInventario) y NO se registra venta.
★ Pre-check agregado por SKU: suma cantidades de items repetidos ANTES
de validar stock disponible.
★ eliminarMovimiento: nunca falla en silencio. Si stock no se puede
reponer al cancelar, devuelve {ok:true, advertencia:true, mensaje:"⚠️ ..."}
con detalle de fallas y conteo (repuesto_uds / esperado_uds).
★ _reponerStockVenta: regex de lotes permisivo, re-lee inventario fresh,
fallback que crea lote REINGRESO si no encuentra ninguno previo.

Funciones tocadas:

descontarStock (nueva, reemplaza descontarFIFO)

_rollbackInventario (nueva)

descontarFIFO (mantenida como alias backward-compat)

calcularDisponible (acepta hoja o snapshot)

registrarVenta

registrarMerma

eliminarMovimiento

_reponerStockVenta
*/
const VIDA_UTIL_DIAS = 9999;  // CADUCIDAD ELIMINADA — constante conservada por compatibilidad
const FACTOR_SEMANAS_MES = 4.2;
const SESION_HORAS = 24;                  // v4.4 — máximo absoluto
const SESION_INACTIVIDAD_MIN = 60;        // v4.4 — auto-logout 60 min sin actividad
const MAX_SESIONES_OWNER = 99;
const MAX_SESIONES_NORMAL = 3;
const TZ_MX = "America/Mexico_City";
// v4.4 — Horarios por sucursal por día (0=Domingo). 24h format.
const HORARIOS_SUCURSAL = {
"Polanco":    [{abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}, {abre:"11:00",cierra:"19:00"}],
"Cuajimalpa": [{abre:"10:00",cierra:"14:30"}, {abre:"09:00",cierra:"18:00"}, {abre:"09:00",cierra:"18:00"}, {abre:"09:00",cierra:"18:00"}, {abre:"09:00",cierra:"18:00"}, {abre:"09:00",cierra:"18:00"}, {abre:"09:00",cierra:"14:30"}]
};
function getHorarioHoy(sucursal, fecha) {
fecha = fecha || new Date();
const cfg = HORARIOS_SUCURSAL[sucursal];
return cfg ? cfg[fecha.getDay()] : { abre: "10:00", cierra: "19:00" };
}
function calcMontoMensual(monto, frecuencia) {
if (frecuencia === "Semanal") return monto * FACTOR_SEMANAS_MES;
if (frecuencia === "Mensual") return monto;
return 0;
}
// =================================================================================
// ROLES Y PERMISOS — v4.3
// =================================================================================
/**
Devuelve los permisos para un rol dado.
Owner:        todo permitido (admin del sistema)
Vendedor:     solo vende en su sucursal
Cocinero:     solo produce y transfiere; NO vende
Mixto:        produce, transfiere y vende en su sucursal
Admin_Ventas: vende en ambas sucursales y transfiere

NUEVO en v4.3: `puedeAnular` indica si el usuario puede anular movimientos.
Por defecto solo Owner; pero un Owner puede otorgarlo a un usuario específico
vía editarUsuario({campos: {permisos_extra: {puedeAnular: true}}}) — ver más abajo.
*/

// ============================================================================
// InvCore — CAPA CENTRAL ÚNICA DE INVENTARIO (rewrite 2026-06-28)
// Columnas Inventario: 6=Cantidad Actual(TOTAL fisico) | 16=res_ruta | 17=res_apartado
//   disponible = total - res_ruta - res_apartado.  estado_anul(12)==="ANULADO" => ignorar.
// Toda mutacion de inventario pasa SOLO por estas funciones y queda en Inv_Ledger.
// ============================================================================
function _invIdx(hoja){
  var h=hoja.getRange(1,1,1,hoja.getLastColumn()).getValues()[0];
  return { anul:h.indexOf("estado_anul"), ruta:h.indexOf("res_ruta"), apart:h.indexOf("res_apartado") };
}
function _invAnulada(r,idx){ return idx.anul!==-1 && r[idx.anul]==="ANULADO"; }
function _invNum(v){ return Number(v)||0; }
function _invLedger(ss, tipo, sabor,tamano,suc, lote, dCant,dRuta,dApart, sCant,sRuta,sApart, ref, usuario, motivo){
  var h=ss.getSheetByName("Inv_Ledger");
  if(!h){ h=ss.insertSheet("Inv_Ledger"); h.appendRow(["timestamp","tipo","sabor","tamano","sucursal","lote","d_cant","d_res_ruta","d_res_apartado","saldo_cant","saldo_res_ruta","saldo_res_apartado","referencia","usuario","motivo"]); }
  h.appendRow([Utilities.formatDate(new Date(),TZ_MX,"yyyy-MM-dd HH:mm:ss"),tipo,sabor,tamano,suc,lote||"",dCant,dRuta,dApart,sCant,sRuta,sApart,ref||"",usuario||"",motivo||""]);
  _velBump("inv"); // v6.3: cualquier movimiento de inventario invalida el cache de stock
}
// Saldos agregados por SKU+sucursal (solo filas activas)
function invSaldos(ss, sabor,tamano,suc){
  var hoja=ss.getSheetByName("Inventario"); var idx=_invIdx(hoja); var datos=hoja.getDataRange().getValues();
  var total=0,ruta=0,apart=0;
  for(var i=1;i<datos.length;i++){ var r=datos[i];
    if(r[1]!==sabor||r[2]!==tamano||r[3]!==suc) continue; if(_invAnulada(r,idx)) continue;
    var _c=_invNum(r[5]); total+=_c;
    // Solo contar reservas sobre lotes con stock real (>0). Ignora reservas huerfanas
    // en lotes agotados (basura del intento v5 a medias) que inflaban lo reservado.
    if(_c>0){ if(idx.ruta!==-1)ruta+=_invNum(r[idx.ruta]); if(idx.apart!==-1)apart+=_invNum(r[idx.apart]); }
  }
  return { total:total, resRuta:ruta, resApartado:apart, disponible: total-ruta-apart };
}
function invDisponible(ss, sabor,tamano,suc){ return invSaldos(ss,sabor,tamano,suc).disponible; }
// fila activa consolidada (o null)
function _invFilaActiva(hoja, idx, sabor,tamano,suc){
  var datos=hoja.getDataRange().getValues();
  var _fallback=null;
  for(var i=1;i<datos.length;i++){ var r=datos[i];
    if(r[1]!==sabor||r[2]!==tamano||r[3]!==suc) continue; if(_invAnulada(r,idx)) continue;
    if(r[9]==="agotado_x_anul") continue;
    if((_invNum(r[5]))>0) return { fila:i+1, row:r };
    if(!_fallback) _fallback={ fila:i+1, row:r };
  }
  return _fallback;
}
// PRODUCIR: +total (consolida en fila activa o crea)
function invProducir(ss, sabor,tamano,suc, cant, ref, usuario, motivo){
  if(cant<=0) return; var hoja=ss.getSheetByName("Inventario"); var idx=_invIdx(hoja);
  var fa=_invFilaActiva(hoja,idx,sabor,tamano,suc); var lote;
  if(fa){ var nuevo=_invNum(fa.row[5])+cant; hoja.getRange(fa.fila,6).setValue(nuevo); hoja.getRange(fa.fila,5).setValue(_invNum(fa.row[4])+cant); hoja.getRange(fa.fila,7).setValue(new Date()); lote=fa.row[8]||""; }
  else { lote=(sabor.substring(0,3).toUpperCase())+"-"+tamano.substring(0,1).toUpperCase()+"-"+Utilities.formatDate(new Date(),TZ_MX,"yyyyMMdd"); var row=new Array(hoja.getLastColumn()).fill(""); row[0]="INV-"+Date.now(); row[1]=sabor;row[2]=tamano;row[3]=suc;row[4]=cant;row[5]=cant;row[6]=new Date();row[8]=lote;row[9]="activo";row[10]=usuario||""; if(idx.ruta!==-1)row[idx.ruta]=0; if(idx.apart!==-1)row[idx.apart]=0; hoja.appendRow(row); }
  SpreadsheetApp.flush();
  var s=invSaldos(ss,sabor,tamano,suc);
  _invLedger(ss,"PRODUCCION",sabor,tamano,suc,lote,cant,0,0,s.total,s.resRuta,s.resApartado,ref,usuario,motivo||"Alta produccion");
}
// DESCONTAR total (venta tienda / merma / baja por entrega). Valida disponible. Devuelve lotes string.
function invDescontar(ss, sabor,tamano,suc, cant, ref, usuario, motivo, tipoLedger){
  var hoja=ss.getSheetByName("Inventario"); var idx=_invIdx(hoja); var datos=hoja.getDataRange().getValues();
  var disp=invSaldos(ss,sabor,tamano,suc).disponible;
  if(disp<cant) throw new Error("Stock insuficiente: "+sabor+" "+tamano+" en "+suc+" — disponible "+disp+", solicitado "+cant);
  var restante=cant, lotes=[];
  for(var i=1;i<datos.length && restante>0;i++){ var r=datos[i];
    if(r[1]!==sabor||r[2]!==tamano||r[3]!==suc) continue; if(_invAnulada(r,idx)) continue; if(r[9]==="agotado_x_anul") continue;
    var c=_invNum(r[5]); if(c<=0) continue; var d=Math.min(c,restante); hoja.getRange(i+1,6).setValue(c-d);
    if(c-d===0) hoja.getRange(i+1,10).setValue("agotado"); lotes.push((r[8]||"lote")+"("+d+")"); restante-=d;
  }
  if(restante>0) throw new Error("Error al descontar "+sabor+" "+tamano+" (faltan "+restante+").");
  SpreadsheetApp.flush();
  var s=invSaldos(ss,sabor,tamano,suc);
  _invLedger(ss,tipoLedger||"VENTA",sabor,tamano,suc,lotes.join(", "),-cant,0,0,s.total,s.resRuta,s.resApartado,ref,usuario,motivo||"");
  return { lotes: lotes.join(", ") };
}
// RESERVAR: disponible -> res_ruta|res_apartado (total NO cambia)
function invReservar(ss, sabor,tamano,suc, cant, tipo, ref, usuario){
  if(cant<=0) return; var col= tipo==="ruta" ? "res_ruta":"res_apartado";
  var hoja=ss.getSheetByName("Inventario"); var idx=_invIdx(hoja); var ci= tipo==="ruta"?idx.ruta:idx.apart;
  if(ci===-1) throw new Error("Falta columna "+col+" en Inventario.");
  var disp=invSaldos(ss,sabor,tamano,suc).disponible; if(disp<cant) throw new Error("No hay disponible para reservar "+sabor+" "+tamano+" en "+suc+" (disp "+disp+").");
  var fa=_invFilaActiva(hoja,idx,sabor,tamano,suc); if(!fa) throw new Error("Sin fila activa para reservar "+sabor+" "+tamano+".");
  hoja.getRange(fa.fila,ci+1).setValue(_invNum(fa.row[ci])+cant); SpreadsheetApp.flush();
  var s=invSaldos(ss,sabor,tamano,suc);
  _invLedger(ss,"RESERVA_"+tipo.toUpperCase(),sabor,tamano,suc,fa.row[8]||"",0, tipo==="ruta"?cant:0, tipo==="apartado"?cant:0, s.total,s.resRuta,s.resApartado,ref,usuario,"Reserva "+tipo);
}
// LIBERAR: res_* -> disponible (cancelacion). Nunca deja negativo.
function invLiberar(ss, sabor,tamano,suc, cant, tipo, ref, usuario){
  if(cant<=0) return; var hoja=ss.getSheetByName("Inventario"); var idx=_invIdx(hoja); var ci= tipo==="ruta"?idx.ruta:idx.apart; if(ci===-1) return;
  var datos=hoja.getDataRange().getValues(); var restante=cant;
  for(var i=1;i<datos.length && restante>0;i++){ var r=datos[i]; if(r[1]!==sabor||r[2]!==tamano||r[3]!==suc) continue; if(_invAnulada(r,idx)) continue;
    var res=_invNum(r[ci]); if(res<=0) continue; var d=Math.min(res,restante); hoja.getRange(i+1,ci+1).setValue(res-d); restante-=d; }
  SpreadsheetApp.flush();
  var s=invSaldos(ss,sabor,tamano,suc);
  _invLedger(ss,"LIBERA_"+tipo.toUpperCase(),sabor,tamano,suc,"",0, tipo==="ruta"?-(cant-restante):0, tipo==="apartado"?-(cant-restante):0, s.total,s.resRuta,s.resApartado,ref,usuario,"Cancelacion "+tipo);
}
// ENTREGAR reserva: res_* -> baja definitiva (total -cant Y res -cant)
function invEntregarReserva(ss, sabor,tamano,suc, cant, tipo, ref, usuario){
  if(cant<=0) return; var hoja=ss.getSheetByName("Inventario"); var idx=_invIdx(hoja); var ci= tipo==="ruta"?idx.ruta:idx.apart;
  var datos=hoja.getDataRange().getValues(); var restRes=cant, restTot=cant, lotes=[];
  for(var i=1;i<datos.length && (restRes>0||restTot>0);i++){ var r=datos[i]; if(r[1]!==sabor||r[2]!==tamano||r[3]!==suc) continue; if(_invAnulada(r,idx)) continue;
    if(restRes>0 && ci!==-1){ var res=_invNum(r[ci]); if(res>0){ var dr=Math.min(res,restRes); hoja.getRange(i+1,ci+1).setValue(res-dr); restRes-=dr; } }
    if(restTot>0){ var c=_invNum(r[5]); if(c>0){ var dt=Math.min(c,restTot); hoja.getRange(i+1,6).setValue(c-dt); if(c-dt===0)hoja.getRange(i+1,10).setValue("agotado"); lotes.push((r[8]||"lote")+"("+dt+")"); restTot-=dt; } }
  }
  SpreadsheetApp.flush();
  var s=invSaldos(ss,sabor,tamano,suc);
  _invLedger(ss,"ENTREGA_"+tipo.toUpperCase(),sabor,tamano,suc,lotes.join(", "),-(cant-restTot), tipo==="ruta"?-(cant-restRes):0, tipo==="apartado"?-(cant-restRes):0, s.total,s.resRuta,s.resApartado,ref,usuario,"Entrega "+tipo);
  return { lotes: lotes.join(", ") };
}
// TRANSFERIR Cuajimalpa -> Polanco (inmediata, atomica)
function invTransferir(ss, sabor,tamano, cant, ref, usuario, notas){
  if(cant<=0) throw new Error("Cantidad invalida.");
  var dispC=invSaldos(ss,sabor,tamano,"Cuajimalpa").disponible;
  if(dispC<cant) throw new Error("Disponible insuficiente en Cuajimalpa: hay "+dispC+" de "+sabor+" "+tamano);
  invDescontar(ss,sabor,tamano,"Cuajimalpa",cant,ref,usuario,"Transferencia -> Polanco","TRANSFER_OUT");
  invProducir(ss,sabor,tamano,"Polanco",cant,ref,usuario,"Transferencia desde Cuajimalpa"+(notas?": "+notas:""));
}
// AJUSTAR (nivelacion conteo fisico): fija total al conteo, audita antes/despues/diff
function invAjustar(ss, sabor,tamano,suc, conteo, usuario, motivo){
  var hoja=ss.getSheetByName("Inventario"); var idx=_invIdx(hoja); var datos=hoja.getDataRange().getValues();
  var antes=0, primera=null, fantasmas=[];
  for(var i=1;i<datos.length;i++){ var r=datos[i]; if(r[1]!==sabor||r[2]!==tamano||r[3]!==suc) continue;
    if(_invAnulada(r,idx)){ if(_invNum(r[5])!==0) fantasmas.push(i+1); continue; }
    if(r[9]==="agotado_x_anul") continue; antes+=_invNum(r[5]); if(primera===null) primera={fila:i+1,row:r}; else { hoja.getRange(i+1,6).setValue(0); hoja.getRange(i+1,10).setValue("agotado"); }
  }
  for(var f=0;f<fantasmas.length;f++){ hoja.getRange(fantasmas[f],6).setValue(0); hoja.getRange(fantasmas[f],10).setValue("agotado_x_anul"); }
  if(primera){ hoja.getRange(primera.fila,6).setValue(conteo); hoja.getRange(primera.fila,10).setValue(conteo>0?"activo":"agotado"); }
  else if(conteo>0){ invProducir(ss,sabor,tamano,suc,conteo,"AJUSTE",usuario,"Alta por ajuste"); }
  SpreadsheetApp.flush();
  var s=invSaldos(ss,sabor,tamano,suc);
  _invLedger(ss,"AJUSTE",sabor,tamano,suc,primera?primera.row[8]:"",conteo-antes,0,0,s.total,s.resRuta,s.resApartado,"AJUSTE",usuario,(motivo||"Conteo fisico")+" | antes:"+antes+" despues:"+conteo+" diff:"+(conteo-antes));
  return { antes:antes, despues:conteo, diff:conteo-antes };
}
function getConfigInt(ss, clave, def){
  try{ var h=ss.getSheetByName("Config"); if(!h) return def; var d=h.getDataRange().getValues();
    for(var i=1;i<d.length;i++){ if(d[i][0]===clave){ var v=parseInt(d[i][1]); return isNaN(v)?def:v; } } }catch(e){}
  return def;
}
// AUDITORIA DE CONSISTENCIA: ledger reconstruido vs saldos actuales
function auditarConsistencia(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var hoja=ss.getSheetByName("Inventario"); var idx=_invIdx(hoja); var datos=hoja.getDataRange().getValues();
  var hled=ss.getSheetByName("Inv_Ledger"); var led=hled?hled.getDataRange().getValues():[];
  var cur={}, lg={};
  for(var i=1;i<datos.length;i++){ var r=datos[i]; if(!r[1]) continue; if(_invAnulada(r,idx)) continue;
    var k=r[3]+"|"+r[1]+"|"+r[2]; if(!cur[k])cur[k]={total:0,ruta:0,apart:0};
    cur[k].total+=_invNum(r[5]); if(idx.ruta!==-1)cur[k].ruta+=_invNum(r[idx.ruta]); if(idx.apart!==-1)cur[k].apart+=_invNum(r[idx.apart]); }
  for(var j=1;j<led.length;j++){ var L=led[j]; var k2=L[4]+"|"+L[2]+"|"+L[3]; if(!lg[k2])lg[k2]={total:0,ruta:0,apart:0};
    lg[k2].total+=_invNum(L[6]); lg[k2].ruta+=_invNum(L[7]); lg[k2].apart+=_invNum(L[8]); }
  var difs=[]; var keys={}; Object.keys(cur).forEach(function(k){keys[k]=1}); Object.keys(lg).forEach(function(k){keys[k]=1});
  Object.keys(keys).forEach(function(k){ var a=cur[k]||{total:0,ruta:0,apart:0}; var b=lg[k]||{total:0,ruta:0,apart:0};
    if(a.total!==b.total||a.ruta!==b.ruta||a.apart!==b.apart) difs.push({sku:k, inventario:a, ledger:b}); });
  Logger.log(difs.length? ("INCONSISTENCIAS: "+JSON.stringify(difs)) : "CONSISTENCIA OK (verde)");
  return { ok: difs.length===0, diferencias: difs };
}

// v6.5c — reconciliarLedger(): correr UNA sola vez desde el editor despues de
// desplegar el fix de mermas (antes las mermas no se asentaban en Inv_Ledger y
// dejaban drift permanente). Asienta una entrada RECONCILIACION por SKU para
// que la suma del ledger vuelva a cuadrar con Inventario. Despues de correrla,
// auditarConsistencia() debe dar verde.
function reconciliarLedger(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var hoja=ss.getSheetByName("Inventario"); var idx=_invIdx(hoja); var datos=hoja.getDataRange().getValues();
  var hled=ss.getSheetByName("Inv_Ledger"); var led=hled?hled.getDataRange().getValues():[];
  var cur={}, lg={};
  for(var i=1;i<datos.length;i++){ var r=datos[i]; if(!r[1]) continue; if(_invAnulada(r,idx)) continue;
    var k=r[3]+"|"+r[1]+"|"+r[2]; if(!cur[k])cur[k]={total:0,ruta:0,apart:0};
    cur[k].total+=_invNum(r[5]); if(idx.ruta!==-1)cur[k].ruta+=_invNum(r[idx.ruta]); if(idx.apart!==-1)cur[k].apart+=_invNum(r[idx.apart]); }
  for(var j=1;j<led.length;j++){ var L=led[j]; var k2=L[4]+"|"+L[2]+"|"+L[3]; if(!lg[k2])lg[k2]={total:0,ruta:0,apart:0};
    lg[k2].total+=_invNum(L[6]); lg[k2].ruta+=_invNum(L[7]); lg[k2].apart+=_invNum(L[8]); }
  var keys={}; Object.keys(cur).forEach(function(k){keys[k]=1}); Object.keys(lg).forEach(function(k){keys[k]=1});
  var ajustadas=0;
  Object.keys(keys).forEach(function(k){
    var a=cur[k]||{total:0,ruta:0,apart:0}; var b=lg[k]||{total:0,ruta:0,apart:0};
    var dT=a.total-b.total, dR=a.ruta-b.ruta, dA=a.apart-b.apart;
    if(dT===0&&dR===0&&dA===0) return;
    var p=k.split("|"); // suc|sabor|tamano
    _invLedger(ss,"RECONCILIACION",p[1],p[2],p[0],"",dT,dR,dA,a.total,a.ruta,a.apart,"RECON","sistema","Cierre de drift historico (mermas sin asentar en ledger)");
    ajustadas++;
  });
  Logger.log("RECONCILIACION: "+ajustadas+" SKUs ajustados. Correr auditarConsistencia() para verificar verde.");
  return { ok:true, skusAjustados: ajustadas };
}


function migrarReservasFisicas(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const hInv=ss.getSheetByName("Inventario"); const idx=_invIdx(hInv);
  if(idx.ruta===-1||idx.apart===-1) return {ok:false,error:"Faltan columnas res_ruta/res_apartado en Inventario."};
  var datos=hInv.getDataRange().getValues();
  for(var i=1;i<datos.length;i++){ if(!datos[i][1])continue; hInv.getRange(i+1,idx.ruta+1).setValue(0); hInv.getRange(i+1,idx.apart+1).setValue(0); }
  SpreadsheetApp.flush();
  // Apartados abiertos (Ventas tipo_op=Reservado, no anulado)
  var hV=ss.getSheetByName("Ventas"); var dv=hV.getDataRange().getValues(); var HV=dv[0];
  var iTipo=HV.indexOf("tipo_op"), iAnul=HV.indexOf("estado_anul");
  for(var r=1;r<dv.length;r++){ var row=dv[r]; if(!row[0])continue;
    if(iTipo!==-1 && row[iTipo]!=="Reservado") continue;
    if(iAnul!==-1 && row[iAnul]==="ANULADO") continue;
    try{ invReservar(ss,row[4],row[5],row[3],Number(row[6])||0,"apartado","MIGRA",row[2]); }catch(e){}
  }
  // Rutas abiertas (Reparto_Pedidos estado base/planeado)
  try{ var peds=_repLeerPedidos(ss);
    for(var p=0;p<peds.length;p++){ var pe=peds[p]; if(pe.estado!=="base"&&pe.estado!=="planeado")continue;
      var its=[]; try{ its=JSON.parse(pe.items||"[]"); }catch(e2){ its=[]; }
      for(var k=0;k<its.length;k++){ try{ invReservar(ss,its[k].sabor,its[k].tamano,"Cuajimalpa",Number(its[k].cantidad)||1,"ruta","MIGRA","migracion"); }catch(e3){} }
    }
  }catch(e){}
  SpreadsheetApp.flush();
  return auditarConsistencia();
}


// ============================================================================
// RECIBOS DIGITALES (PDF a Drive + link para WhatsApp) — 2026-06-28
// Encabezado configurable en la hoja "Configuración" (Parámetro/Valor):
//   negocio_nombre, negocio_telefono, negocio_instagram,
//   negocio_direccion_cuajimalpa, negocio_direccion_polanco
// ============================================================================
function _cfgVal(ss, clave, def){
  try{ var h=ss.getSheetByName("Configuración"); if(!h) return def; var d=h.getDataRange().getValues();
    for(var i=1;i<d.length;i++){ if(String(d[i][0])===clave){ var v=d[i][1]; return (v===""||v==null)?def:v; } } }catch(e){}
  return def;
}
function _ensureFolderRecibos(){
  var it=DriveApp.getFoldersByName("Recibos Tarta Vasca");
  return it.hasNext()? it.next() : DriveApp.createFolder("Recibos Tarta Vasca");
}
function generarReciboPDF(idVenta, sesion){
  requierePuedeVender(sesion);
  if(!idVenta) return {ok:false,error:"Falta idVenta."};
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var h=ss.getSheetByName("Ventas"); var datos=h.getDataRange().getValues(); var H=datos[0];
  var iAnul=H.indexOf("estado_anul"), iEnv=H.indexOf("envio_monto");
  var lineas=[], info=null, total=0, envio=0;
  for(var i=1;i<datos.length;i++){ var r=datos[i]; if(String(r[0])!==String(idVenta)) continue;
    if(iAnul!==-1 && r[iAnul]==="ANULADO") continue;
    lineas.push({sabor:r[4],tamano:r[5],cant:Number(r[6])||0,precio:Number(r[7])||0,sub:Number(r[8])||0});
    total+=Number(r[8])||0;
    if(!info) info={fecha:r[1],usuario:r[2],sucursal:r[3],canal:r[9],metodo:r[10],cliente:r[12]};
    if(iEnv!==-1 && Number(r[iEnv])>0) envio=Number(r[iEnv]);
  }
  if(!lineas.length) return {ok:false,error:"Venta no encontrada o anulada."};
  var nombre=_cfgVal(ss,"negocio_nombre","Tarta Vasca");
  var suc=info.sucursal||"";
  var dir=_cfgVal(ss,"negocio_direccion_"+String(suc).toLowerCase(), _cfgVal(ss,"negocio_direccion",""));
  var tel=_cfgVal(ss,"negocio_telefono","");
  var ig=_cfgVal(ss,"negocio_instagram","");
  var fechaTxt = info.fecha instanceof Date ? Utilities.formatDate(info.fecha,TZ_MX,"dd/MM/yyyy HH:mm") : String(info.fecha||"").substring(0,16).replace("T"," ");
  var filas = lineas.map(function(l){ return "<tr><td>"+l.cant+"</td><td>"+l.sabor+" "+l.tamano+"</td><td style='text-align:right'>$"+l.precio+"</td><td style='text-align:right'>$"+l.sub+"</td></tr>"; }).join("");
  var totalFinal=total+envio;
  var html="<div style='font-family:Arial,Helvetica,sans-serif;width:300px;margin:0 auto;color:#222'>"+
    "<div style='text-align:center'><div style='font-size:20px;font-weight:bold'>"+nombre+"</div>"+
    "<div style='font-size:12px'>Sucursal "+suc+"</div>"+
    (dir?"<div style='font-size:11px'>"+dir+"</div>":"")+
    (tel?"<div style='font-size:11px'>Tel: "+tel+"</div>":"")+"</div>"+
    "<hr><div style='font-size:11px'>Folio: "+idVenta+"<br>Fecha: "+fechaTxt+"<br>Atendio: "+(info.usuario||"")+" &middot; Pago: "+(info.metodo||"")+(info.cliente?"<br>Cliente: "+info.cliente:"")+"</div><hr>"+
    "<table style='width:100%;font-size:12px;border-collapse:collapse'><thead><tr><th style='text-align:left'>Cant</th><th style='text-align:left'>Producto</th><th style='text-align:right'>P.U.</th><th style='text-align:right'>Importe</th></tr></thead><tbody>"+filas+"</tbody></table><hr>"+
    (envio>0?"<div style='font-size:12px;display:flex;justify-content:space-between'><span>Envio</span><span>$"+envio+"</span></div>":"")+
    "<div style='font-size:16px;font-weight:bold;display:flex;justify-content:space-between'><span>TOTAL</span><span>$"+totalFinal+"</span></div><hr>"+
    "<div style='text-align:center;font-size:11px'>"+_cfgVal(ss,"negocio_mensaje_pie","Gracias por tu compra!")+(ig?"<br>"+ig:"")+"</div></div>";
  var blob=Utilities.newBlob(html,"text/html","recibo.html").getAs("application/pdf").setName("Recibo_"+idVenta+".pdf");
  var folder=_ensureFolderRecibos();
  var ex=folder.getFilesByName("Recibo_"+idVenta+".pdf"); while(ex.hasNext()){ ex.next().setTrashed(true); }
  var file=folder.createFile(blob);
  try{ file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }catch(e){}
  return {ok:true, url:file.getUrl(), id:file.getId(), total:totalFinal};
}


function enviarReciboEmail(idVenta, email, sesion){
  requierePuedeVender(sesion);
  if(!email || String(email).indexOf("@")<0) return {ok:false,error:"Correo invalido."};
  var r=generarReciboPDF(idVenta, sesion);
  if(!r.ok) return r;
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  try{
    var blob=DriveApp.getFileById(r.id).getAs("application/pdf").setName("Recibo_"+idVenta+".pdf");
    var fromAddr=_cfgVal(ss,"negocio_email_envio","");
    var nombre=_cfgVal(ss,"negocio_nombre","Tarta Vasca");
    var htmlBody="Gracias por tu compra en "+nombre+".<br>Adjuntamos tu recibo en PDF.<br><br>Tambien puedes verlo aqui: "+r.url;
    var body="Gracias por tu compra en "+nombre+". Recibo: "+r.url;
    var to=String(email).trim();
    if(fromAddr){
      try{
        GmailApp.sendEmail(to, "Tu recibo - "+nombre, body, {from:fromAddr, name:nombre, htmlBody:htmlBody, attachments:[blob]});
        return {ok:true, mensaje:"Recibo enviado a "+email+" (desde "+fromAddr+")", url:r.url};
      }catch(eAlias){
        MailApp.sendEmail({to:to, subject:"Tu recibo - "+nombre, name:nombre, htmlBody:htmlBody, attachments:[blob]});
        return {ok:true, mensaje:"Recibo enviado a "+email+" (el alias "+fromAddr+" aun no esta listo; salio de la cuenta base)", url:r.url};
      }
    }
    MailApp.sendEmail({to:to, subject:"Tu recibo - "+nombre, name:nombre, htmlBody:htmlBody, attachments:[blob]});
    return {ok:true, mensaje:"Recibo enviado a "+email, url:r.url};
  }catch(e){ return {ok:false, error:"No se pudo enviar el correo: "+e.message}; }
}


function autorizarPermisos(){
  // EJECUTAR UNA VEZ. Autoriza Drive (completo) + Gmail (incluye envio con alias).
  var it=DriveApp.getFoldersByName("Recibos Tarta Vasca");
  var f = it.hasNext() ? it.next() : DriveApp.createFolder("Recibos Tarta Vasca");
  var tmp = f.createFile("autorizacion_tmp.txt", "ok", "text/plain");
  tmp.setTrashed(true);
  try { GmailApp.getAliases(); } catch(e){}                 // autoriza Gmail (alias/envio)
  try { MailApp.getRemainingDailyQuota(); } catch(e){}
  return "Permisos de Drive (completo) y Gmail (con alias) autorizados correctamente.";
}


function probarCorreoTV(){
  // Selecciona ESTA funcion en el menu y Ejecutar. Lee el "Registro de ejecucion" abajo.
  var yo = Session.getEffectiveUser().getEmail();
  var quota = MailApp.getRemainingDailyQuota();
  Logger.log("CUENTA QUE ENVIA: " + yo);
  Logger.log("CORREOS DISPONIBLES HOY: " + quota);
  MailApp.sendEmail(yo, "Prueba recibo - Tarta Vasca", "Si recibes esto, el correo funciona. Revisa tambien spam.");
  Logger.log("RESULTADO: correo enviado a " + yo + " (revisa bandeja y SPAM)");
  return "Cuenta: " + yo + " | Cuota: " + quota + " | Enviado.";
}


function guardarDatosNegocio(){
  // EJECUTAR UNA VEZ desde el editor. Guarda los datos del negocio para los recibos.
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var h=ss.getSheetByName("Configuración");
  if(!h){ h=ss.insertSheet("Configuración"); h.appendRow(["Parámetro","Valor","Descripción"]); }
  var datos={
    "negocio_nombre":"Tarta Vasca",
    "negocio_telefono":"55-8803-9327",
    "negocio_instagram":"@tartavasca",
    "negocio_email_envio":"latartavasca@gmail.com",
    "negocio_mensaje_pie":"\u00A1Gracias por tu compra! - Esperamos verte pronto",
    "negocio_direccion_cuajimalpa":"Av Noche de Paz 14, Granjas Navidad, Cuajimalpa de Morelos, 05219, CDMX",
    "negocio_direccion_polanco":"C. Arqu\u00EDmedes 69, Chapultepec Morales, Polanco V Secc, Miguel Hidalgo, 11560, CDMX"
  };
  var vals=h.getDataRange().getValues();
  Object.keys(datos).forEach(function(k){
    var found=false;
    for(var i=1;i<vals.length;i++){ if(String(vals[i][0])===k){ h.getRange(i+1,2).setValue(datos[k]); found=true; break; } }
    if(!found) h.appendRow([k, datos[k], "Dato del negocio para recibos"]);
  });
  SpreadsheetApp.flush();
  return "Datos del negocio guardados en Configuración.";
}


function verAliasTV(){
  // Ejecutar y leer el Registro de ejecucion. Dice todo lo necesario.
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("CUENTA QUE EJECUTA EL SCRIPT: " + Session.getEffectiveUser().getEmail());
  Logger.log("ALIAS DE ENVIO DISPONIBLES: " + JSON.stringify(GmailApp.getAliases()));
  Logger.log("negocio_email_envio EN CONFIG: '" + _cfgVal(ss,"negocio_email_envio","(VACIO)") + "'");
  return "Revisa el Registro de ejecucion (las 3 lineas de arriba).";
}

function getPermisos(rol) {
switch(rol) {
case "Owner":
return { esAdmin:true, puedeVender:true, puedeProducir:true, puedeTransferir:true, puedeVerAmbas:true, puedeAnular:true };
case "Vendedor":
return { esAdmin:false, puedeVender:true, puedeProducir:false, puedeTransferir:false, puedeVerAmbas:false, puedeAnular:false };
case "Cocinero":
return { esAdmin:false, puedeVender:false, puedeProducir:true, puedeTransferir:true, puedeVerAmbas:true, puedeAnular:false };
case "Mixto":
return { esAdmin:false, puedeVender:true, puedeProducir:true, puedeTransferir:true, puedeVerAmbas:false, puedeAnular:false };
case "Admin_Ventas":
return { esAdmin:false, puedeVender:true, puedeProducir:false, puedeTransferir:true, puedeVerAmbas:true, puedeAnular:false };
case "Chofer":
return { esAdmin:false, puedeVender:false, puedeProducir:false, puedeTransferir:false, puedeVerAmbas:false, puedeAnular:false, esChofer:true };
default:
return { esAdmin:false, puedeVender:false, puedeProducir:false, puedeTransferir:false, puedeVerAmbas:false, puedeAnular:false };
}
}
function soloOwner(sesion) {
if (sesion.rol !== "Owner") throw new Error("Acción reservada para Owner.");
}
function requierePuedeVender(sesion) {
if (!getPermisos(sesion.rol).puedeVender) throw new Error("Tu rol no permite registrar ventas.");
}
function requierePuedeProducir(sesion) {
if (!getPermisos(sesion.rol).puedeProducir) throw new Error("Tu rol no permite producción.");
}
function requierePuedeTransferir(sesion) {
if (!getPermisos(sesion.rol).puedeTransferir) throw new Error("Tu rol no permite transferencias.");
}
function requierePuedeAnular(sesion) {
// Por defecto solo Owner; si tiene permiso individual lo respeta
if (sesion.rol === "Owner") return;
const extra = leerPermisosExtraUsuario(sesion.usuario);
if (extra && extra.puedeAnular) return;
throw new Error("Tu rol no permite anular movimientos. Pídeselo al Owner.");
}
// =================================================================================
// SETUP v4.3 — ejecutar UNA VEZ desde el editor
// =================================================================================
function setupV43() {
const ss = SpreadsheetApp.getActiveSpreadsheet();
let creadas = [];
// 1. Hoja Sesiones_Activas
if (!ss.getSheetByName("Sesiones_Activas")) {
const h = ss.insertSheet("Sesiones_Activas");
h.setTabColor("#5DADE2");
const headers = ["token", "usuario", "rol", "sucursal", "device_info", "creado", "ultimoAcceso"];
h.getRange(1, 1, 1, headers.length).setValues([headers]);
h.getRange(1, 1, 1, headers.length).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
h.setFrozenRows(1);
h.setColumnWidth(1, 300); h.setColumnWidth(5, 220);
creadas.push("Sesiones_Activas");
}
// 2. Hoja Auditoria_Eliminados
if (!ss.getSheetByName("Auditoria_Eliminados")) {
const h = ss.insertSheet("Auditoria_Eliminados");
h.setTabColor("#E74C3C");
const headers = ["timestamp", "hoja_origen", "id_origen", "tipo_mov", "usuario", "motivo", "datos_originales", "stock_revertido"];
h.getRange(1, 1, 1, headers.length).setValues([headers]);
h.getRange(1, 1, 1, headers.length).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
h.setFrozenRows(1);
h.setColumnWidth(1, 160); h.setColumnWidth(7, 360);
creadas.push("Auditoria_Eliminados");
}
// 3. Asegurar columna PermisosExtra en Usuarios
const hUsu = ss.getSheetByName("Usuarios");
if (hUsu) {
const headers = hUsu.getRange(1, 1, 1, hUsu.getLastColumn()).getValues()[0];
if (headers.indexOf("PermisosExtra") === -1) {
const newCol = hUsu.getLastColumn() + 1;
hUsu.getRange(1, newCol).setValue("PermisosExtra");
hUsu.getRange(1, newCol).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
}
}
// 4. Migrar tokens viejos de Configuración → Sesiones_Activas (best effort)
try {
const hConf = ss.getSheetByName("Configuración");
if (hConf) {
const datos = hConf.getDataRange().getValues();
const hSes = ss.getSheetByName("Sesiones_Activas");
const ahora = new Date().toISOString();
for (let i = 1; i < datos.length; i++) {
const key = String(datos[i][0] || "");
const token = String(datos[i][1] || "");
if (key.startsWith("token_") && token) {
const usuario = key.replace("token_", "");
const partes = token.split("|");
const rol = partes[1] || "";
const sucursal = getSucursalUsuario(usuario);
hSes.appendRow([token, usuario, rol, sucursal, "migrado-v4.3", ahora, ahora]);
}
}
}
} catch(e) { Logger.log("Migración tokens: " + e.message); }
const msg = creadas.length > 0
? "✅ Setup v4.3 listo.\n\nHojas creadas: " + creadas.join(", ") + "\nTokens migrados de Configuración → Sesiones_Activas."
: "✅ Setup v4.3 ya estaba aplicado. Sin cambios.";
try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log(msg); }
return msg;
}
// =================================================================================
// ENTRADA HTTP
// =================================================================================
function doPost(e) {
try {
const body = JSON.parse(e.postData.contents);
return respuesta(despachar(body));
} catch (err) {
return respuesta({ ok: false, error: "Error interno: " + err.message });
}
}
function doGet(e) {
try {
if (e && e.parameter && e.parameter.data) {
const body = JSON.parse(e.parameter.data);
return respuesta(despachar(body));
}
return respuesta({ ok: true, mensaje: "Tarta Vasca API v4.3 activa" });
} catch(err) {
return respuesta({ ok: false, error: err.message });
}
}
function despachar(body) {
const accion = body.accion;
if (accion === "login") return login(body);
if (accion === "logout") return logout(body);
const sesion = validarToken(body.token);
if (!sesion.ok) return { ok: false, error: "Sesión inválida o expirada. Vuelve a iniciar sesión." };
switch (accion) {
case "getStock":                return getStock(body, sesion);
case "altaProduccion":          return altaProduccion(body, sesion);
case "ajustarInventario":       return ajustarInventario(body, sesion);  // Ajuste por conteo fisico (Owner)
case "registrarVenta":          return registrarVenta(body, sesion);
case "registrarMerma":          return registrarMerma(body, sesion);
case "getCatalogo":             return getCatalogo(sesion);
case "altaSabor":               return altaSabor(body, sesion);
case "bajaSabor":               return bajaSabor(body, sesion);
case "altaTamano":              return altaTamano(body, sesion);
case "bajaTamano":              return bajaTamano(body, sesion);
case "altaCanal":               return altaCanal(body, sesion);
case "bajaCanal":               return bajaCanal(body, sesion);
case "getZonasEnvio":           return getZonasEnvio(sesion);
case "saveZonaEnvio":           return saveZonaEnvio(body, sesion);
case "deleteZonaEnvio":         return deleteZonaEnvio(body, sesion);
case "registrarNota":           return registrarNota(body, sesion);                  // Notas del creador
case "getNotas":                return getNotas(body, sesion);
case "setNotaEstado":           return setNotaEstado(body, sesion);
case "getCanalPrecios":         return getCanalPrecios(sesion);
case "saveCanalPrecio":         return saveCanalPrecio(body, sesion);
case "deleteCanalPrecio":       return deleteCanalPrecio(body, sesion);
case "getPrecios":              return getPrecios(sesion);
case "updatePrecio":            return updatePrecio(body, sesion);
case "actualizarMetodoVenta":   return actualizarMetodoVenta(body, sesion);
case "getRutasAbiertas":        return getRutasAbiertas(body, sesion);
case "archivarRuta":            return archivarRuta(body, sesion);
case "actualizarMetodoVentaBatch": return actualizarMetodoVentaBatch(body, sesion);
case "getRutasCerradas":        return getRutasCerradas(body, sesion);
case "getUsuarios":             return getUsuarios(sesion);
case "crearUsuario":            return crearUsuario(body, sesion);
case "editarUsuario":           return editarUsuario(body, sesion);   // NUEVO v4.3
case "toggleUsuario":           return toggleUsuario(body, sesion);
case "cambiarPassword":         return cambiarPassword(body, sesion);
case "getAuditoria":            return getAuditoria(sesion);
case "buscarCliente":           return buscarCliente(body, sesion);
case "getHistorialCliente":     return getHistorialCliente(body, sesion);
case "getVentas":               return getVentas(body, sesion);
case "getInsumos":              return getInsumos(sesion);
case "saveInsumo":              return saveInsumo(body, sesion);
case "deleteInsumo":            return deleteInsumo(body, sesion);
case "getRecetas":              return getRecetas(sesion);
case "saveReceta":              return saveReceta(body, sesion);
case "deleteRecetaIngrediente": return deleteRecetaIngrediente(body, sesion);
case "getCalculoCosto":         return getCalculoCosto(body, sesion);
case "bulkLoadInsumos":         return bulkLoadInsumos(body, sesion);
case "bulkLoadReceta":          return bulkLoadReceta(body, sesion);
case "iaProcesar":              return iaProcesar(body, sesion);             // v6.5d proxy IA
case "repararPreciosSabores":   return repararPreciosSabores(sesion);
case "getGastos":               return getGastos(sesion);
case "saveGasto":               return saveGasto(body, sesion);
case "deleteGasto":             return deleteGasto(body, sesion);
case "getObjetivos":            return getObjetivos(sesion);
case "saveObjetivo":            return saveObjetivo(body, sesion);
case "deleteObjetivo":          return deleteObjetivo(body, sesion);
case "limpiarDatos":            return limpiarDatos(sesion);
case "getStockMinMax":          return getStockMinMax(sesion);
case "saveStockMinMax":         return saveStockMinMax(body, sesion);
case "getMensajes":             return getMensajes(sesion);
case "enviarMensaje":           return enviarMensaje(body, sesion);
case "marcarLeidoMensaje":      return marcarLeidoMensaje(body, sesion);
case "getAlertas":              return getAlertas(sesion);
case "getComisionesConfig":     return getComisionesConfig(sesion);
case "saveComisionConfig":      return saveComisionConfig(body, sesion);
case "generarReciboPDF":        return generarReciboPDF(body.idVenta||body.id, sesion);
    case "enviarReciboEmail":       return enviarReciboEmail(body.idVenta||body.id, body.email, sesion);
    case "auditarConsistencia":     return auditarConsistencia();
    case "migrarReservasFisicas":   soloOwner(sesion); return migrarReservasFisicas();
    case "registrarTransferencia":  return registrarTransferencia(body, sesion);
case "getTransferencias":       return getTransferencias(sesion);
case "confirmarTransferencia":  return confirmarTransferencia(body, sesion);
case "getMisPermisos":          return getMisPermisos(sesion);
case "listarMovimientosRecientes": return listarMovimientosRecientes(body, sesion);  // NUEVO v4.3
case "eliminarMovimiento":      return eliminarMovimiento(body, sesion);              // NUEVO v4.3
case "getSesionesActivas":      return getSesionesActivas(body, sesion);              // NUEVO v4.3
case "abrirDia":                return abrirDia(body, sesion);                        // NUEVO v4.4
case "cerrarDia":               return cerrarDia(body, sesion);                       // NUEVO v4.4
case "getDiaActual":            return getDiaActual(body, sesion);                    // NUEVO v4.4
case "exportarDisponibleDocx":  return exportarDisponibleDocx(body, sesion);          // NUEVO v4.4
case "getAnalisisDemanda":      return getAnalisisDemanda(body, sesion);              // NUEVO v4.4
case "getSeguimientoVentas":    return getSeguimientoVentas(body, sesion);            // NUEVO v4.4
case "getEstadoResultados":     return getEstadoResultados(body, sesion);             // NUEVO v4.5.13 (P&L)
case "recalcularUtilidades":    soloOwner(sesion); recalcularUtilidades(SpreadsheetApp.getActiveSpreadsheet()); return { ok:true, mensaje:"Utilidades recalculadas con costos corregidos." };  // FIX costos
case "getPedidoSugerido":       return getPedidoSugerido(body, sesion);               // NUEVO v4.5.16 (cocinada)
case "getProduccionManana":     return getProduccionManana(body, sesion);             // Adecuacion 3
case "repInstalarTriggerProduccion": return repInstalarTriggerProduccion();           // Adecuacion 3
case "getReservas":             return getReservas(body, sesion);                     // NUEVO v4.4b
case "getApartados":            return getApartados(body, sesion);                     // Adecuacion 2
case "registrarApartado":       return registrarVenta(body, sesion);                  // Adecuacion 2 (extiende reserva)
case "convertirReservaAVenta":  return convertirReservaAVenta(body, sesion);          // NUEVO v4.4b
case "liberarReserva":          return liberarReserva(body, sesion);                  // NUEVO v4.4b
case "getSucursalesUsuario":    return getSucursalesUsuario(body, sesion);            // NUEVO v4.4b
// ===== REPARTO A DOMICILIO =====
case "repartoEstado":        return repartoEstado(body, sesion);
case "repartoGeocode":       return repartoGeocode(body, sesion);
case "repartoAddPedido":     return repartoAddPedido(body, sesion);
case "repartoDelPedido":     return repartoDelPedido(body, sesion);
case "repartoProponer":      return repartoProponer(body, sesion);
case "repartoPlanear":       return repartoPlanear(body, sesion);
case "repartoSetChofer":     return repartoSetChofer(body, sesion);
case "repartoSetResultado":  return repartoSetResultado(body, sesion);
case "repartoSetFormaPago":  return repartoSetFormaPago(body, sesion);
case "repartoSetEfectivo":   return repartoSetEfectivo(body, sesion);
case "repartoCerrarRuta":    return repartoCerrarRuta(body, sesion);
case "repartoReprogramar":   return repartoReprogramar(body, sesion);
case "repartoDelRuta":       return repartoDelRuta(body, sesion);
case "repartoLiberar":       return repartoLiberar(body, sesion);                  // Liberar tarta apartada (ruta)
default: return { ok: false, error: "Acción desconocida: " + accion };
}
}
function respuesta(data) {
return ContentService
.createTextOutput(JSON.stringify(data))
.setMimeType(ContentService.MimeType.JSON);
}
// =================================================================================
// AUTH — REESCRITO v4.3 con multi-sesión
// =================================================================================
function login(body) {
const { usuario, password, device_info } = body;
if (!usuario || !password) return { ok: false, error: "Usuario y contraseña requeridos." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const datos = hoja.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
const [usu, hash, rol, sucursal, activo] = datos[i];
if (usu !== usuario) continue;
if (activo !== "TRUE" && activo !== true) return { ok: false, error: "Usuario inactivo." };
if (hash !== hashSimple(password)) return { ok: false, error: "Contraseña incorrecta." };
const token = crearSesion(usuario, rol, sucursal, device_info || "sin-etiqueta");
hoja.getRange(i + 1, 6).setValue(new Date().toISOString());
registrarAuditoria(usuario, rol, "LOGIN", "Inicio de sesión" + (device_info ? " · " + device_info.substring(0, 60) : ""));
const permisos = getPermisos(rol);
// Mergear permisos extra del usuario
const extra = leerPermisosExtraUsuario(usuario);
if (extra) Object.keys(extra).forEach(k => { if (extra[k] === true) permisos[k] = true; });
return { ok: true, token, usuario, rol, sucursal, permisos };
}
return { ok: false, error: "Usuario no encontrado." };
}
function logout(body) {
const token = body.token;
if (!token) return { ok: true, mensaje: "Sin token, ya no hay sesión." };
_velTokenDrop(token); // v6.3: invalida cache de sesion
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName("Sesiones_Activas");
if (!h) return { ok: true, mensaje: "Sesión cerrada." };
const datos = h.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0] === token) {
const usuario = datos[i][1];
const rol = datos[i][2];
h.deleteRow(i + 1);
registrarAuditoria(usuario, rol, "LOGOUT", "Sesión cerrada manualmente");
return { ok: true, mensaje: "Sesión cerrada." };
}
}
return { ok: true, mensaje: "Sesión ya no existía." };
}
function getMisPermisos(sesion) {
const permisos = getPermisos(sesion.rol);
const extra = leerPermisosExtraUsuario(sesion.usuario);
if (extra) Object.keys(extra).forEach(k => { if (extra[k] === true) permisos[k] = true; });
return { ok: true, rol: sesion.rol, permisos };
}
// Crea sesión en hoja Sesiones_Activas, controla tope de sesiones concurrentes
function crearSesion(usuario, rol, sucursal, deviceInfo) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
let h = ss.getSheetByName("Sesiones_Activas");
if (!h) {
setupV43();
h = ss.getSheetByName("Sesiones_Activas");
}
const ahora = new Date();
const ahoraISO = ahora.toISOString();
const expira = ahora.getTime() + (SESION_HORAS * 60 * 60 * 1000);
const token = "TVT-" + Math.random().toString(36).substring(2, 12) + "-" + ahora.getTime() + "|" + rol + "|" + expira;
// Limpiar sesiones expiradas y contar las del usuario
const datos = h.getDataRange().getValues();
const filasMias = [];
const filasAEliminar = [];
for (let i = datos.length - 1; i >= 1; i--) {
const t = String(datos[i][0] || "");
const partes = t.split("|");
const expToken = partes.length === 3 ? parseInt(partes[2]) : 0;
const usuT = datos[i][1];
const creadoT = datos[i][5];
if (!t || ahora.getTime() > expToken) {
filasAEliminar.push(i + 1);
continue;
}
if (usuT === usuario) filasMias.push({ fila: i + 1, creado: new Date(creadoT) });
}
// Eliminar expiradas
filasAEliminar.forEach(f => h.deleteRow(f));
// Tope concurrentes — recargar datos porque las filas cambiaron
const tope = rol === "Owner" ? MAX_SESIONES_OWNER : MAX_SESIONES_NORMAL;
if (filasMias.length >= tope) {
// Recargar datos y volver a localizar las filas del usuario
const datos2 = h.getDataRange().getValues();
const propias = [];
for (let i = 1; i < datos2.length; i++) {
if (datos2[i][1] === usuario) propias.push({ fila: i + 1, creado: new Date(datos2[i][5]) });
}
propias.sort((a, b) => a.creado - b.creado);
// Eliminar las más viejas hasta dejar (tope - 1) y dar espacio a la nueva
while (propias.length >= tope) {
const masVieja = propias.shift();
h.deleteRow(masVieja.fila);
// Ajustar las filas restantes (la fila eliminada hace que las posteriores bajen 1)
propias.forEach(p => { if (p.fila > masVieja.fila) p.fila -= 1; });
}
}
h.appendRow([token, usuario, rol, sucursal, deviceInfo, ahoraISO, ahoraISO]);
return token;
}
function validarToken(token) {
// v6.3: cache primero — evita leer+escribir la hoja Sesiones en CADA peticion.
// La hoja solo se toca en cache frio o para refrescar ultimoAcceso cada 5 min.
if (!token) return { ok: false };
const partes = token.split("|");
if (partes.length !== 3) return { ok: false };
const [_idPart, rol, expira] = partes;
const ahora = new Date();
if (ahora.getTime() > parseInt(expira)) return { ok: false, error: "Sesión expirada (24h)" };
try {
  const cRaw = CacheService.getScriptCache().get("tvtok_" + _idPart);
  if (cRaw) {
    const s = JSON.parse(cRaw);
    const minutos = (ahora.getTime() - s.a) / 60000;
    if (minutos > SESION_INACTIVIDAD_MIN) {
      _velTokenDrop(token); _sesEliminarFila(token);
      return { ok: false, error: "Sesión cerrada por inactividad (" + Math.floor(minutos) + " min)" };
    }
    s.a = ahora.getTime();
    if (ahora.getTime() - (s.w || 0) > VEL_TOKEN_WRITE_MS) { _sesTouch(token, ahora); s.w = ahora.getTime(); }
    CacheService.getScriptCache().put("tvtok_" + _idPart, JSON.stringify(s), 21600);
    return { ok: true, usuario: s.u, rol: s.r, sucursal: s.s };
  }
} catch (e) {}
// Cache frio: flujo v4.4 contra la hoja + poblar cache
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName("Sesiones_Activas");
if (!h) return { ok: false };
const datos = h.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0] === token) {
// v4.4 — Check inactividad
const ultimoAccesoStr = datos[i][6];
if (ultimoAccesoStr) {
const ultimoAcceso = new Date(ultimoAccesoStr);
const minutos = (ahora - ultimoAcceso) / 60000;
if (minutos > SESION_INACTIVIDAD_MIN) {
try { h.deleteRow(i + 1); } catch(e) {}
return { ok: false, error: `Sesión cerrada por inactividad (${Math.floor(minutos)} min)` };
}
}
// Actualizar ultimoAcceso
try { h.getRange(i + 1, 7).setValue(ahora.toISOString()); } catch(e) {}
try { CacheService.getScriptCache().put("tvtok_" + _idPart, JSON.stringify({ u: datos[i][1], r: datos[i][2], s: datos[i][3], a: ahora.getTime(), w: ahora.getTime() }), 21600); } catch(e) {}
return { ok: true, usuario: datos[i][1], rol: datos[i][2], sucursal: datos[i][3] };
}
}
return { ok: false };
}
// Lista de sesiones activas — Owner ve todas, el resto solo las suyas
function getSesionesActivas(body, sesion) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName("Sesiones_Activas");
if (!h) return { ok: true, sesiones: [] };
const datos = h.getDataRange().getValues();
const sesiones = [];
for (let i = 1; i < datos.length; i++) {
const r = datos[i];
if (!r[0]) continue;
if (sesion.rol !== "Owner" && r[1] !== sesion.usuario) continue;
sesiones.push({
token_corto: String(r[0]).substring(0, 18) + "...",
usuario: r[1], rol: r[2], sucursal: r[3],
device_info: r[4], creado: r[5], ultimoAcceso: r[6],
esLaActual: r[0] === body.token
});
}
return { ok: true, sesiones };
}
// Cierra TODAS las sesiones de un usuario — usado tras editar rol/desactivar
function cerrarSesionesUsuario(usuario) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName("Sesiones_Activas");
if (!h) return 0;
const datos = h.getDataRange().getValues();
let cerradas = 0;
for (let i = datos.length - 1; i >= 1; i--) {
if (datos[i][1] === usuario) {
_velTokenDrop(String(datos[i][0] || "")); // v6.3: invalida cache de sesion
h.deleteRow(i + 1);
cerradas++;
}
}
return cerradas;
}
// Lee PermisosExtra JSON de un usuario (devuelve null si no tiene)
function leerPermisosExtraUsuario(usuario) {
try {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hUsu = ss.getSheetByName("Usuarios");
if (!hUsu) return null;
const headers = hUsu.getRange(1, 1, 1, hUsu.getLastColumn()).getValues()[0];
const idxExtra = headers.indexOf("PermisosExtra");
if (idxExtra === -1) return null;
const datos = hUsu.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0] === usuario) {
const raw = datos[i][idxExtra];
if (!raw) return null;
return JSON.parse(raw);
}
}
} catch(e) { return null; }
return null;
}
// =================================================================================
// USUARIOS — REESCRITO v4.3 con editarUsuario
// =================================================================================
function getUsuarios(sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
const datos = hoja.getDataRange().getValues();
const idxExtra = headers.indexOf("PermisosExtra");
const usuarios = [];
for (let i = 1; i < datos.length; i++) {
const [usuario,, rol, sucursal, activo, ultimoAcceso, fechaCreacion] = datos[i];
if (!usuario) continue;
let extra = null;
if (idxExtra !== -1) {
try { extra = datos[i][idxExtra] ? JSON.parse(datos[i][idxExtra]) : null; } catch(e) {}
}
const permisos = getPermisos(rol);
if (extra) Object.keys(extra).forEach(k => { if (extra[k] === true) permisos[k] = true; });
usuarios.push({ usuario, rol, sucursal, activo: activo==="TRUE"||activo===true, ultimoAcceso, fechaCreacion, permisos, permisosExtra: extra });
}
return { ok: true, usuarios };
}
function crearUsuario(body, sesion) {
soloOwner(sesion);
const { usuario, password, rol, sucursal } = body;
if (!usuario||!password||!rol||!sucursal) return { ok: false, error: "Faltan datos." };
const rolesValidos = ["Owner","Vendedor","Cocinero","Mixto","Admin_Ventas","Chofer"];
if (!rolesValidos.includes(rol)) return { ok: false, error: `Rol inválido. Permitidos: ${rolesValidos.join(", ")}` };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const datos = hoja.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) if (datos[i][0]===usuario) return { ok: false, error: `Usuario "${usuario}" ya existe.` };
// 8 columnas estándar; si hay PermisosExtra agregar columna vacía
const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
const nuevaFila = [usuario, hashSimple(password), rol, sucursal, "TRUE", "", new Date().toISOString(), sesion.usuario];
while (nuevaFila.length < headers.length) nuevaFila.push("");
hoja.appendRow(nuevaFila);
registrarAuditoria(sesion.usuario, sesion.rol, "CREAR_USUARIO", `${usuario} (${rol} - ${sucursal})`);
return { ok: true, mensaje: `✅ Usuario "${usuario}" creado.` };
}
/**
NUEVO v4.3 — Editar usuario (solo Owner).
body = {
usuario_objetivo: "pau",                                      // requerido
campos: {
nombre, password (string, vacío = no cambiar),
rol, sucursal, activo (boolean),
permisos_extra: { puedeAnular: true, ... }                  // opcional
}
}

Si cambia rol O activo → todas las sesiones del usuario se invalidan
(tiene que volver a hacer login en cada dispositivo).
*/
function editarUsuario(body, sesion) {
soloOwner(sesion);
const usuarioObjetivo = body.usuario_objetivo;
const campos = body.campos || {};
if (!usuarioObjetivo) return { ok: false, error: "usuario_objetivo requerido." };
// No te puedes desactivar a ti mismo
if (usuarioObjetivo === sesion.usuario && campos.activo === false) {
return { ok: false, error: "No puedes desactivarte a ti mismo." };
}
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
const datos = hoja.getDataRange().getValues();
// Localizar fila del usuario
let filaIdx = -1;
for (let i = 1; i < datos.length; i++) {
if (datos[i][0] === usuarioObjetivo) { filaIdx = i; break; }
}
if (filaIdx === -1) return { ok: false, error: "Usuario no encontrado." };
const cambiosLog = [];
// Password (opcional)
if (campos.password && typeof campos.password === "string" && campos.password.length > 0) {
hoja.getRange(filaIdx + 1, 2).setValue(hashSimple(campos.password));
cambiosLog.push("password");
}
// Rol (validar)
let cambioRol = false;
if (campos.rol && campos.rol !== datos[filaIdx][2]) {
const rolesValidos = ["Owner","Vendedor","Cocinero","Mixto","Admin_Ventas","Chofer"];
if (!rolesValidos.includes(campos.rol)) return { ok: false, error: "Rol inválido." };
hoja.getRange(filaIdx + 1, 3).setValue(campos.rol);
cambiosLog.push(`rol: ${datos[filaIdx][2]} → ${campos.rol}`);
cambioRol = true;
}
// Sucursal
if (campos.sucursal && campos.sucursal !== datos[filaIdx][3]) {
hoja.getRange(filaIdx + 1, 4).setValue(campos.sucursal);
cambiosLog.push(`sucursal: ${datos[filaIdx][3]} → ${campos.sucursal}`);
}
// Activo
let cambioActivo = false;
if (typeof campos.activo === "boolean") {
const actualActivo = datos[filaIdx][4] === "TRUE" || datos[filaIdx][4] === true;
if (campos.activo !== actualActivo) {
hoja.getRange(filaIdx + 1, 5).setValue(campos.activo ? "TRUE" : "FALSE");
cambiosLog.push(`activo: ${actualActivo} → ${campos.activo}`);
cambioActivo = true;
}
}
// PermisosExtra
if (campos.permisos_extra && typeof campos.permisos_extra === "object") {
const idxExtra = headers.indexOf("PermisosExtra");
if (idxExtra === -1) {
// Crear columna PermisosExtra al final
const newCol = hoja.getLastColumn() + 1;
hoja.getRange(1, newCol).setValue("PermisosExtra");
hoja.getRange(1, newCol).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
hoja.getRange(filaIdx + 1, newCol).setValue(JSON.stringify(campos.permisos_extra));
} else {
hoja.getRange(filaIdx + 1, idxExtra + 1).setValue(JSON.stringify(campos.permisos_extra));
}
cambiosLog.push("permisos_extra: " + JSON.stringify(campos.permisos_extra));
}
if (cambiosLog.length === 0) return { ok: true, mensaje: "Sin cambios.", cambios: [] };
// Si cambió rol o se desactivó: cerrar TODAS sus sesiones
let sesionesCerradas = 0;
if (cambioRol || cambioActivo) {
sesionesCerradas = cerrarSesionesUsuario(usuarioObjetivo);
}
registrarAuditoria(sesion.usuario, sesion.rol, "EDITAR_USUARIO", `${usuarioObjetivo} | ${cambiosLog.join(" | ")}${sesionesCerradas > 0 ? " | sesiones cerradas: " + sesionesCerradas : ""}`);
return { ok: true, mensaje: `✅ Usuario "${usuarioObjetivo}" actualizado.`, cambios: cambiosLog, sesionesCerradas };
}
function toggleUsuario(body, sesion) {
soloOwner(sesion);
const { usuario } = body;
if (!usuario) return { ok: false, error: "Usuario requerido." };
if (usuario===sesion.usuario) return { ok: false, error: "No puedes desactivarte a ti mismo." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const datos = hoja.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0]===usuario) {
const activo = datos[i][4]==="TRUE"||datos[i][4]===true;
hoja.getRange(i+1,5).setValue(activo?"FALSE":"TRUE");
// Al desactivar: cerrar todas sus sesiones
if (activo) cerrarSesionesUsuario(usuario);
registrarAuditoria(sesion.usuario, sesion.rol, activo?"DESACTIVAR_USUARIO":"ACTIVAR_USUARIO", usuario);
return { ok: true, mensaje: `✅ Usuario "${usuario}" ${activo?"desactivado":"activado"}.` };
}
}
return { ok: false, error: "Usuario no encontrado." };
}
function cambiarPassword(body, sesion) {
const { usuario, passwordActual, passwordNuevo } = body;
if (!usuario||!passwordActual||!passwordNuevo) return { ok: false, error: "Faltan datos." };
if (sesion.rol!=="Owner"&&usuario!==sesion.usuario) return { ok: false, error: "Solo puedes cambiar tu propia contraseña." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const datos = hoja.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0]===usuario) {
if (sesion.usuario===usuario&&datos[i][1]!==hashSimple(passwordActual)) return { ok: false, error: "Contraseña actual incorrecta." };
hoja.getRange(i+1,2).setValue(hashSimple(passwordNuevo));
registrarAuditoria(sesion.usuario, sesion.rol, "CAMBIO_PASSWORD", `Contraseña cambiada: ${usuario}`);
return { ok: true, mensaje: "✅ Contraseña actualizada." };
}
}
return { ok: false, error: "Usuario no encontrado." };
}
// =================================================================================
// NUEVO v4.3 — MOVIMIENTOS RECIENTES + ELIMINAR (SOFT-DELETE)
// =================================================================================
/**
Lista movimientos recientes en cualquiera de las 3 hojas operativas.
body = {
tipo: "Ventas" | "Inventario" | "Transferencias" | undefined (todos),
rango: "hoy" | "3d" | "7d" | "30d" (default 7d)
}

Devuelve hasta 200 movimientos, ordenados del más reciente al más viejo.
Vendedor solo ve sus propios movimientos; Owner ve todo.
*/
function listarMovimientosRecientes(body, sesion) {
const tipos = body.tipo ? [body.tipo] : ["Ventas", "Inventario", "Transferencias"];
const rango = body.rango || "7d";
const desde = _calcularDesde(rango);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const out = [];
tipos.forEach(t => {
const h = ss.getSheetByName(t);
if (!h) return;
// v6.3: lee solo las ultimas 1200 filas (el rango max es 30d) y los headers UNA vez
// (antes _extraerEstadoFila releia los headers del sheet EN CADA FILA — el gran
// culpable de la lentitud de Movimientos)
const _lrM = h.getLastRow(), _lcM = h.getLastColumn();
if (_lrM < 2) return;
const _iniM = Math.max(2, _lrM - 1200 + 1);
const datos = h.getRange(_iniM, 1, _lrM - _iniM + 1, _lcM).getValues();
const _hdrsM = h.getRange(1, 1, 1, _lcM).getValues()[0];
const _idxAnulM = _hdrsM.indexOf("estado_anul");
for (let i = datos.length - 1; i >= 0; i--) {
const fila = datos[i];
if (!fila[0]) continue;
const fecha = _extraerFechaFila(t, fila);
if (!fecha || fecha < desde) continue;
const usuarioFila = _extraerUsuarioFila(t, fila);
// Vendedor solo ve sus movimientos
if (sesion.rol !== "Owner" && usuarioFila !== sesion.usuario) continue;
const estado = _velEstadoFila(t, fila, _idxAnulM);
out.push({
hoja: t,
fila_idx: _iniM + i,
id: String(fila[0]),
fecha: Utilities.formatDate(fecha, TZ_MX, "yyyy-MM-dd'T'HH:mm:ss"),  // FIX-TZ: enviar CDMX
usuario: usuarioFila,
detalle: _construirDetalle(t, fila),
monto_o_cantidad: _extraerMontoCantidad(t, fila),
estado: estado || "Activo"
});
}
});
out.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
return { ok: true, movimientos: out.slice(0, 200) };
}
/**
Soft-delete de un movimiento.
body = { hoja: "Ventas"|"Inventario"|"Transferencias", id, motivo }

Acciones:

Marca la fila con estado "ANULADO" + columnas anulado_por, anulado_fecha, anulado_motivo

Si la fila era Venta no-merma → devuelve stock al inventario (lotes_origen)

Registra en Auditoria_Eliminados con el snapshot de la fila completa

Solo Owner por defecto; permite a usuarios con PermisosExtra.puedeAnular.
*/
function eliminarMovimiento(body, sesion) {
// v4.5.13-fix: si viene marcada como liberacion de reserva, exige puedeVender
// (no puedeAnular). Mas abajo se valida que las filas objetivo sean realmente
// reservas (tipo_op="Reservado") para que la bandera no pueda abusarse.
const _liberacionReserva = !!(body && body._liberacionReserva);
if (_liberacionReserva) {
requierePuedeVender(sesion);
} else {
requierePuedeAnular(sesion);
}
const { hoja, id, motivo } = body;
if (!hoja || !id) return { ok: false, error: "hoja e id requeridos." };
if (!motivo || !motivo.trim()) return { ok: false, error: "El motivo es obligatorio." };
const hojasPermitidas = ["Ventas", "Inventario", "Transferencias"];
if (hojasPermitidas.indexOf(hoja) === -1) return { ok: false, error: "Hoja no admite anulación." };
// Lock para evitar choques con ventas/mermas concurrentes
const lock = LockService.getScriptLock();
try { lock.waitLock(30000); }
catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
try {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName(hoja);
if (!h) return { ok: false, error: `Hoja "${hoja}" no existe.` };
    // v6.5: antes esto leia TODA la hoja (getDataRange) en cada anulacion. Con miles de filas
    // acumuladas con el tiempo, esa lectura completa era la causa principal de que "Confirmar
    // anulacion" tardara tanto. Igual que ya se hizo en listarMovimientosRecientes (v6.3),
    // primero buscamos solo en las ultimas 1200 filas — de ahi SIEMPRE viene el id, porque la
    // UI solo deja anular movimientos que aparecen en ese listado, y el listado ya esta acotado
    // a esas mismas 1200 filas. Si por algun motivo no aparece ahi, caemos a un escaneo completo
    // de respaldo: nunca deja de encontrar un movimiento valido, solo tarda mas en ese caso raro.
    const _lrEM = h.getLastRow(), _lcEM = h.getLastColumn();
    if (_lrEM < 2) return { ok: false, error: "Movimiento no encontrado." };
    const _iniEM = Math.max(2, _lrEM - 1200 + 1);
    const _rangoEM = h.getRange(_iniEM, 1, _lrEM - _iniEM + 1, _lcEM).getValues();
    const _headerEM = h.getRange(1, 1, 1, _lcEM).getValues()[0];
    let datos = new Array(_lrEM);
    datos[0] = _headerEM;
    for (let k = 0; k < _rangoEM.length; k++) datos[_iniEM - 1 + k] = _rangoEM[k];
    const filasObjetivo = [];
    for (let i = _iniEM - 1; i < _lrEM; i++) {
      if (datos[i] && String(datos[i][0]) === String(id)) filasObjetivo.push(i + 1);
    }
    if (filasObjetivo.length === 0 && _iniEM > 2) {
      // Respaldo: el id no aparecio en las ultimas 1200 filas — escaneo completo.
      datos = h.getDataRange().getValues();
      for (let i = 1; i < datos.length; i++) {
        if (String(datos[i][0]) === String(id)) filasObjetivo.push(i + 1);
      }
    }
    if (filasObjetivo.length === 0) return { ok: false, error: "Movimiento no encontrado." };

    // v4.5.13-fix: la bandera _liberacionReserva solo es valida si TODAS las filas
    // objetivo son reservas (tipo_op="Reservado") en la hoja Ventas. Evita que se use
    // para anular ventas reales sin permiso puedeAnular.
    if (_liberacionReserva) {
      const _idxTipoOp = datos[0].indexOf("tipo_op");
      const _todasReserva = _idxTipoOp !== -1 && filasObjetivo.every(function(fn){ return String(datos[fn - 1][_idxTipoOp]) === "Reservado"; });
      if (hoja !== "Ventas" || !_todasReserva) {
        return { ok: false, error: "Esta accion solo libera reservas (apartados)." };
      }
    }

    const estadoActual = _extraerEstadoFila(hoja, datos[filasObjetivo[0] - 1]);
    if (estadoActual === "ANULADO") return { ok: false, error: "Este movimiento ya está anulado." };

    const headersOriginales = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
    const colsAuditoria = ["estado_anul", "anulado_por", "anulado_fecha", "anulado_motivo"];
    colsAuditoria.forEach(c => {
      if (headersOriginales.indexOf(c) === -1) {
        const newCol = h.getLastColumn() + 1;
        h.getRange(1, newCol).setValue(c);
        h.getRange(1, newCol).setBackground("#E74C3C").setFontColor("#FFFFFF").setFontWeight("bold");
      }
    });
    const headersFinales = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
    const colEstado = headersFinales.indexOf("estado_anul") + 1;
    const colPor = headersFinales.indexOf("anulado_por") + 1;
    const colFecha = headersFinales.indexOf("anulado_fecha") + 1;
    const colMotivo = headersFinales.indexOf("anulado_motivo") + 1;

    const ahora = new Date().toISOString();
    let totalRepuesto = 0;
    let totalAReponer = 0;
    const fallasReposicion = []; // detalle de items que no se pudieron reponer
    const filasSnapshot = [];

    filasObjetivo.forEach(filaNum => {
      const dataFila = h.getRange(filaNum, 1, 1, h.getLastColumn()).getValues()[0];
      filasSnapshot.push(dataFila);
      h.getRange(filaNum, colEstado).setValue("ANULADO");
      h.getRange(filaNum, colPor).setValue(sesion.usuario);
      h.getRange(filaNum, colFecha).setValue(ahora);
      h.getRange(filaNum, colMotivo).setValue(motivo);

      if (hoja === "Ventas") {
        const canalFila = String(dataFila[9] || "");
        const cantFila = Number(dataFila[6]) || 0;
        // v4.5.12-fix: SOLO las reservas no descontaron stock. Los regalos (Cortesía)
        // SÍ descuentan inventario al registrarse, así que al anularlos hay que reponer.
        const requiereReponer = cantFila > 0 && canalFila !== "Reservado";
        if (requiereReponer) {
          totalAReponer += cantFila;
          try {
            invProducir(ss, String(dataFila[4]), String(dataFila[5]), String(dataFila[3]), cantFila, id, sesion.usuario, "Reingreso por anulacion de venta"); var r = {ok:true, repuesto:cantFila};
            if (r && r.ok) {
              totalRepuesto += r.repuesto;
              if (r.repuesto < cantFila) {
                fallasReposicion.push(`${dataFila[4]} ${dataFila[5]}: faltaron ${cantFila - r.repuesto} uds`);
              }
            } else {
              fallasReposicion.push(`${dataFila[4]} ${dataFila[5]} × ${cantFila}: ${r && r.error ? r.error : "razón desconocida"}`);
            }
          } catch(e) {
            fallasReposicion.push(`${dataFila[4]} ${dataFila[5]} × ${cantFila}: ${e.message}`);
          }
        }
      }
    
      if (hoja === "Transferencias") {
        var _sb=dataFila[1], _tm=dataFila[2], _ct=Number(dataFila[3])||0;
        if(_ct>0){
          try{
            var _disp=invDisponible(ss,_sb,_tm,"Polanco");
            var _rev=Math.min(_ct,_disp);
            if(_rev>0){
              invDescontar(ss,_sb,_tm,"Polanco",_rev,id,sesion.usuario,"Anulacion transferencia","TRANSFER_ANUL");
              invProducir(ss,_sb,_tm,"Cuajimalpa",_rev,id,sesion.usuario,"Anulacion transferencia (regreso a Cuajimalpa)");
            }
            if(_rev<_ct) fallasReposicion.push(_sb+" "+_tm+": solo se regresaron "+_rev+" de "+_ct+" (Polanco ya no tenia el resto)");
          }catch(e){ fallasReposicion.push(_sb+" "+_tm+": "+e.message); }
        }
      }
});
    SpreadsheetApp.flush();
    _velBump("inv"); // v6.4: invalida el cache de stock también al anular filas de Inventario
                      // (antes solo se invalidaba al anular Ventas/Transferencias vía invProducir/invDescontar)

    const stockOk = fallasReposicion.length === 0 && (hoja !== "Ventas" || totalRepuesto === totalAReponer);

    const hAudit = ss.getSheetByName("Auditoria_Eliminados");
    if (hAudit) {
      hAudit.appendRow([
        ahora, hoja, id, hoja, sesion.usuario, motivo,
        JSON.stringify(filasSnapshot), stockOk
      ]);
    }

    registrarAuditoria(sesion.usuario, sesion.rol, "ANULAR_" + hoja.toUpperCase(),
      `${hoja} ${id} | filas: ${filasObjetivo.length} | motivo: ${motivo}${stockOk ? " | stock devuelto OK" : " | ⚠️ stock NO repuesto: " + fallasReposicion.join("; ")}`);

    if (hoja === "Ventas") { _utilMarcarDirty(); }

    if (stockOk) {
      return {
        ok: true,
        mensaje: hoja === "Ventas"
          ? `✅ Venta ${id} anulada. Inventario actualizado (${totalRepuesto} uds devueltas).`
          : `✅ ${hoja} ${id} anulado.`,
        stock_revertido: true,
        filas_afectadas: filasObjetivo.length
      };
    } else {
      // Devolvemos ok:true porque la anulación SÍ se aplicó, pero con advertencia visible
      return {
        ok: true,
        advertencia: true,
        mensaje: `⚠️ Venta ${id} anulada PERO el inventario NO se repuso completamente. Revisar manualmente: ${fallasReposicion.join("; ")}`,
        stock_revertido: false,
        repuesto_uds: totalRepuesto,
        esperado_uds: totalAReponer,
        detalle_fallas: fallasReposicion,
        filas_afectadas: filasObjetivo.length
      };
    }
} finally {
try { lock.releaseLock(); } catch(_){}
}
}
// ── Helpers movimientos ─────────────────────────────────────
function _calcularDesde(rango) {
const ahora = new Date();
switch (rango) {
case "hoy": return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
case "3d":  return new Date(ahora.getTime() - 3 * 86400000);
case "7d":  return new Date(ahora.getTime() - 7 * 86400000);
case "30d": return new Date(ahora.getTime() - 30 * 86400000);
default:    return new Date(ahora.getTime() - 7 * 86400000);
}
}
function _extraerFechaFila(hoja, fila) {
// Ventas: col 2 (índice 1)
// Inventario: col 7 (índice 6) fechaAlta
// Transferencias: col 6 (índice 5) Fecha Solicitud
const idx = hoja === "Ventas" ? 1 : hoja === "Inventario" ? 6 : 5;
const raw = fila[idx];
if (!raw) return null;
try { return new Date(raw); } catch(e) { return null; }
}
function _extraerUsuarioFila(hoja, fila) {
// Ventas: col 3 (índice 2) usuario
// Inventario: no tiene usuario directo → ""
// Transferencias: col 8 (índice 7) solicitadoPor
if (hoja === "Ventas") return fila[2] || "";
if (hoja === "Transferencias") return fila[7] || "";
return "";
}
function _extraerEstadoFila(hoja, fila) {
// Buscar columna "estado_anul" si existe
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName(hoja);
if (!h) return "";
const headers = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
const idxEstadoAnul = headers.indexOf("estado_anul");
if (idxEstadoAnul !== -1 && fila[idxEstadoAnul]) return fila[idxEstadoAnul];
// Caso especial Inventario col 10 (índice 9)
if (hoja === "Inventario") return fila[9] || "";
// Transferencias col 5 (índice 4) Estado
if (hoja === "Transferencias") return fila[4] || "";
return "";
}
function _construirDetalle(hoja, fila) {
if (hoja === "Ventas") {
// [idVenta, fecha, usuario, sucursal, sabor, tamano, cantidad, precio, subtotal, canal, metodoPago, ...]
return `${fila[6] || ""}× ${fila[4] || ""} ${fila[5] || ""} · ${fila[9] || ""} (${fila[3] || ""})`;
}
if (hoja === "Inventario") {
// [id, sabor, tamano, sucursal, cantInicial, cantActual, fechaAlta, fechaCad, lote, estado]
return `Carga ${fila[4] || ""}× ${fila[1] || ""} ${fila[2] || ""} (${fila[3] || ""}) · lote ${fila[8] || ""}`;
}
if (hoja === "Transferencias") {
// [ID, Sabor, Tamaño, Cantidad, Estado, Fecha Solicitud, ...]
return `${fila[3] || ""}× ${fila[1] || ""} ${fila[2] || ""} → Polanco`;
}
return "";
}
function _extraerMontoCantidad(hoja, fila) {
if (hoja === "Ventas") {
const total = Number(fila[8]) || 0;
return total > 0 ? "$" + total.toLocaleString("es-MX") : "$0";
}
if (hoja === "Inventario") {
return (fila[5] || 0) + " uds";
}
if (hoja === "Transferencias") {
return (fila[3] || 0) + " uds";
}
return "";
}
// Devuelve stock al inventario después de anular una venta. Best effort por lote.
// Devuelve stock al inventario al anular una venta. v4.5.0: robusto.
//   * Re-lee Inventario fresh
//   * Regex permisivo para lotes (acepta cualquier caracter excepto coma/paréntesis)
//   * Devuelve {ok, repuesto, error?} con cuenta exacta
// v6.1: asienta en Inv_Ledger la reposicion de stock que ocurre al ANULAR una venta/merma.
// Cierra la "Limitacion v1" del header: sin esto, auditarConsistencia marcaba desfase en esa SKU.
function _ledgerReposicion(ss, filaVenta, qty, detalle){
  try{
    var s = invSaldos(ss, filaVenta[4], filaVenta[5], filaVenta[3]);
    _invLedger(ss, "REPOSICION_ANULACION", filaVenta[4], filaVenta[5], filaVenta[3], "", qty, 0, 0, s.total, s.resRuta, s.resApartado, String(filaVenta[0]||""), String(filaVenta[2]||""), detalle || "Reposicion de stock por anulacion");
  }catch(e){ try{ Logger.log("_ledgerReposicion fallo: "+e); }catch(e2){} }
}
function _reponerStockVenta(ss, filaVenta) {
const sucursal = filaVenta[3];
const sabor = filaVenta[4];
const tamano = filaVenta[5];
const cantidad = Number(filaVenta[6]) || 0;
const lotesOrigen = String(filaVenta[13] || ""); // ej: "LOTE-A(2), LOTE-B(1)"
if (cantidad <= 0 || !sabor || !tamano) return { ok: false, error: "fila sin cantidad/sabor/tamaño", repuesto: 0 };
const hInv = ss.getSheetByName("Inventario");
if (!hInv) return { ok: false, error: "hoja Inventario no existe", repuesto: 0 };
let datosInv = hInv.getDataRange().getValues();
// v4.5.12-fix: NUNCA reponer sobre una fila de Inventario anulada (estado_anul === "ANULADO").
// getStock oculta esas filas; si el stock se sumara ahí "desaparecería" del inventario visible
// aunque numéricamente se haya repuesto. Esa era la causa de "anulo una venta/merma y el stock
// no regresa". Saltamos esas filas en TODAS las rutas de reposición.
const headersInv = datosInv[0] || [];
const idxAnulInv = headersInv.indexOf("estado_anul");
const filaAnulada = function(i){ return idxAnulInv !== -1 && datosInv[i][idxAnulInv] === "ANULADO"; };
let repuesto = 0;
if (lotesOrigen) {
// Regex permisivo: captura nombre_lote(cantidad) — el nombre puede tener cualquier char excepto , ( ) o espacio
const matches = lotesOrigen.match(/([^,()\s]+)((\d+))/g) || [];
for (const m of matches) {
const partes = m.match(/^([^,()\s]+)((\d+))$/);
if (!partes) continue;
const loteNombre = partes[1];
const qty = parseInt(partes[2]) || 0;
if (qty <= 0) continue;
let aplicado = false;
for (let i = 1; i < datosInv.length; i++) {
if (datosInv[i][8] === loteNombre && !filaAnulada(i)) {
const cantActual = Number(datosInv[i][5]) || 0;
const nueva = cantActual + qty;
hInv.getRange(i + 1, 6).setValue(nueva);
if (nueva > 0) hInv.getRange(i + 1, 10).setValue("activo");
repuesto += qty;
aplicado = true;
// refrescar datosInv en memoria para que la siguiente iteración no use stale
datosInv[i][5] = nueva;
break;
}
}
if (!aplicado) {
// Lote no encontrado (posiblemente borrado): caer al fallback de sumar al primer lote NO anulado del par
for (let i = 1; i < datosInv.length; i++) {
if (datosInv[i][1] === sabor && datosInv[i][2] === tamano && datosInv[i][3] === sucursal && !filaAnulada(i)) {
const cantActual = Number(datosInv[i][5]) || 0;
const nueva = cantActual + qty;
hInv.getRange(i + 1, 6).setValue(nueva);
hInv.getRange(i + 1, 10).setValue("activo");
datosInv[i][5] = nueva;
repuesto += qty;
aplicado = true;
break;
}
}
}
}
SpreadsheetApp.flush();
if (repuesto === cantidad) { _ledgerReposicion(ss, filaVenta, repuesto); return { ok: true, repuesto }; }
if (repuesto > 0) { _ledgerReposicion(ss, filaVenta, repuesto, `parcial: solo ${repuesto}/${cantidad} repuestas`); return { ok: true, repuesto, error: `parcial: solo ${repuesto}/${cantidad} repuestas` }; }
// Si los lotes no matchearon nada, caer al fallback total
}
// Fallback total: sumar la cantidad al primer lote NO anulado del par sabor/tamano/sucursal
for (let i = 1; i < datosInv.length; i++) {
if (datosInv[i][1] === sabor && datosInv[i][2] === tamano && datosInv[i][3] === sucursal && !filaAnulada(i)) {
const cantActual = Number(datosInv[i][5]) || 0;
const nueva = cantActual + cantidad;
hInv.getRange(i + 1, 6).setValue(nueva);
hInv.getRange(i + 1, 10).setValue("activo");
SpreadsheetApp.flush();
_ledgerReposicion(ss, filaVenta, cantidad, "fallback: lote del par");
return { ok: true, repuesto: cantidad };
}
}
// Último fallback: crear un lote nuevo "REINGRESO"
const ahora = new Date().toISOString();
const loteNuevo = `REINGRESO-${sabor.substring(0,3).toUpperCase()}-${ahora.substring(0,10)}`;
hInv.appendRow(["INV-"+Date.now(), sabor, tamano, sucursal, cantidad, cantidad, new Date(), "", loteNuevo, "activo", "sistema_anul"]);
SpreadsheetApp.flush();
_ledgerReposicion(ss, filaVenta, cantidad, "REINGRESO "+loteNuevo);
return { ok: true, repuesto: cantidad, error: `creado lote nuevo ${loteNuevo} (no se encontró ninguno previo del par)` };
}
// =================================================================================
// INSUMOS
// =================================================================================
function ensureHojaInsumos(ss) {
let hoja = ss.getSheetByName("Insumos");
if (!hoja) {
hoja = ss.insertSheet("Insumos");
hoja.setTabColor("#86BDAD");
const headers = ["ID", "Nombre", "Descripción", "Cant. Compra", "Unidad Compra", "Precio Compra ($)", "Costo x Unidad", "Activo", "Modificado"];
const rango = hoja.getRange(1, 1, 1, headers.length);
rango.setValues([headers]);
rango.setBackground("#2E4756"); rango.setFontColor("#FFFFFF"); rango.setFontWeight("bold");
hoja.setFrozenRows(1); hoja.setColumnWidth(2, 180); hoja.setColumnWidth(3, 220);
}
return hoja;
}
function getInsumos(sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ensureHojaInsumos(ss);
const datos = hoja.getDataRange().getValues();
const insumos = [];
for (let i = 1; i < datos.length; i++) {
const [id, nombre, descripcion, buyQty, buyUnit, buyPrice, costoPorUnidad, activo] = datos[i];
if (!id) continue;
insumos.push({ id: String(id), nombre: nombre||"", descripcion: descripcion||"", buyQty: Number(buyQty)||0, buyUnit: buyUnit||"unidad", buyPrice: Number(buyPrice)||0, costoPorUnidad: Number(costoPorUnidad)||0, activo: activo==="TRUE"||activo===true });
}
return { ok: true, insumos };
}
function saveInsumo(body, sesion) {
soloOwner(sesion);
const { insumo } = body;
if (!insumo || !insumo.nombre) return { ok: false, error: "Nombre del insumo requerido." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ensureHojaInsumos(ss);
const datos = hoja.getDataRange().getValues();
const ahora = new Date().toISOString();
const costoPorUnidad = (insumo.buyQty > 0 && insumo.buyPrice > 0) ? insumo.buyPrice / insumo.buyQty : 0;
if (insumo.id) {
for (let i = 1; i < datos.length; i++) {
if (String(datos[i][0]) === String(insumo.id)) {
hoja.getRange(i + 1, 1, 1, 9).setValues([[insumo.id, insumo.nombre, insumo.descripcion||"", insumo.buyQty||0, insumo.buyUnit||"unidad", insumo.buyPrice||0, costoPorUnidad, insumo.activo!==false?"TRUE":"FALSE", ahora]]);
registrarAuditoria(sesion.usuario, sesion.rol, "UPDATE_INSUMO", `${insumo.nombre}: $${costoPorUnidad.toFixed(4)}/u`);
_utilMarcarDirty();
return { ok: true, mensaje: `✅ Insumo "${insumo.nombre}" actualizado.`, costoPorUnidad };
}
}
}
const id = "INS-" + new Date().getTime();
hoja.appendRow([id, insumo.nombre, insumo.descripcion||"", insumo.buyQty||0, insumo.buyUnit||"unidad", insumo.buyPrice||0, costoPorUnidad, "TRUE", ahora]);
registrarAuditoria(sesion.usuario, sesion.rol, "ALTA_INSUMO", `${insumo.nombre}: ${insumo.buyQty} ${insumo.buyUnit} = $${insumo.buyPrice}`);
return { ok: true, mensaje: `✅ Insumo "${insumo.nombre}" creado.`, id, costoPorUnidad };
}
function deleteInsumo(body, sesion) {
soloOwner(sesion);
const { id } = body;
if (!id) return { ok: false, error: "ID requerido." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ensureHojaInsumos(ss);
const datos = hoja.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (String(datos[i][0]) === String(id)) {
hoja.getRange(i + 1, 8).setValue("FALSE");
registrarAuditoria(sesion.usuario, sesion.rol, "BAJA_INSUMO", `ID: ${id} — ${datos[i][1]}`);
return { ok: true, mensaje: "✅ Insumo dado de baja." };
}
}
return { ok: false, error: "Insumo no encontrado." };
}
function bulkLoadInsumos(body, sesion) {
soloOwner(sesion);
const { insumos } = body;
if (!insumos || !Array.isArray(insumos) || insumos.length === 0) return { ok: false, error: "Lista de insumos requerida." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ensureHojaInsumos(ss);
const ahora = new Date().toISOString();
const creados = [];
for (const ins of insumos) {
if (!ins.nombre) continue;
const id = "INS-" + new Date().getTime() + Math.floor(Math.random()*1000);
const costoPorUnidad = (ins.buyQty > 0 && ins.buyPrice > 0) ? ins.buyPrice / ins.buyQty : 0;
hoja.appendRow([id, ins.nombre, ins.descripcion||"", ins.buyQty||0, ins.buyUnit||"unidad", ins.buyPrice||0, costoPorUnidad, "TRUE", ahora]);
creados.push(ins.nombre);
Utilities.sleep(50);
}
registrarAuditoria(sesion.usuario, sesion.rol, "BULK_INSUMOS", `${creados.length} insumos: ${creados.join(", ")}`);
return { ok: true, mensaje: `✅ ${creados.length} insumos cargados.`, creados };
}
// =================================================================================
// RECETAS
// =================================================================================
function ensureHojaRecetas(ss) {
let hoja = ss.getSheetByName("Recetas");
if (!hoja) {
hoja = ss.insertSheet("Recetas");
hoja.setTabColor("#C9A84C");
const headers = ["Sabor", "Tamaño", "Insumo ID", "Insumo Nombre", "Cantidad", "Unidad", "Notas", "Modificado"];
const rango = hoja.getRange(1, 1, 1, headers.length);
rango.setValues([headers]);
rango.setBackground("#2E4756"); rango.setFontColor("#FFFFFF"); rango.setFontWeight("bold");
hoja.setFrozenRows(1); hoja.setColumnWidth(1, 140); hoja.setColumnWidth(4, 180);
}
return hoja;
}
function getRecetas(sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ensureHojaRecetas(ss);
const datos = hoja.getDataRange().getValues();
const recetasMap = {};
for (let i = 1; i < datos.length; i++) {
const [sabor, tamano, insumoId, insumoNombre, cantidad, unidad, notas] = datos[i];
if (!sabor) continue;
const key = `${sabor}|||${tamano}`;
if (!recetasMap[key]) recetasMap[key] = { sabor, tamano, ingredientes: [] };
recetasMap[key].ingredientes.push({ fila: i+1, insumoId: String(insumoId||""), insumoNombre: insumoNombre||"", cantidad: Number(cantidad)||0, unidad: unidad||"", notas: notas||"" });
}
return { ok: true, recetas: Object.values(recetasMap) };
}
function saveReceta(body, sesion) {
soloOwner(sesion);
const { sabor, tamano, ingredientes } = body;
if (!sabor || !tamano) return { ok: false, error: "Sabor y tamaño requeridos." };
if (!ingredientes || !Array.isArray(ingredientes)) return { ok: false, error: "Ingredientes requeridos." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ensureHojaRecetas(ss);
const datos = hoja.getDataRange().getValues();
const ahora = new Date().toISOString();
const filasABorrar = [];
for (let i = 1; i < datos.length; i++) {
if (datos[i][0] === sabor && datos[i][1] === tamano) filasABorrar.push(i + 1);
}
for (let j = filasABorrar.length - 1; j >= 0; j--) hoja.deleteRow(filasABorrar[j]);
for (const ing of ingredientes) {
hoja.appendRow([sabor, tamano, ing.insumoId||"", ing.insumoNombre||"", ing.cantidad||0, ing.unidad||"", ing.notas||"", ahora]);
}
registrarAuditoria(sesion.usuario, sesion.rol, "UPDATE_RECETA", `${sabor} ${tamano}: ${ingredientes.length} ingredientes`);
_utilMarcarDirty();
return { ok: true, mensaje: `✅ Receta ${sabor} ${tamano} guardada.` };
}
function deleteRecetaIngrediente(body, sesion) {
soloOwner(sesion);
const { sabor, tamano, insumoId } = body;
if (!sabor || !tamano || !insumoId) return { ok: false, error: "Datos requeridos." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ensureHojaRecetas(ss);
const datos = hoja.getDataRange().getValues();
for (let i = datos.length - 1; i >= 1; i--) {
if (datos[i][0] === sabor && datos[i][1] === tamano && String(datos[i][2]) === String(insumoId)) {
hoja.deleteRow(i + 1);
return { ok: true, mensaje: "✅ Ingrediente eliminado." };
}
}
return { ok: false, error: "Ingrediente no encontrado en receta." };
}
function bulkLoadReceta(body, sesion) {
soloOwner(sesion);
const { sabor, tamano, ingredientes } = body;
if (!sabor || !tamano || !ingredientes) return { ok: false, error: "Sabor, tamaño e ingredientes requeridos." };
return saveReceta({ sabor, tamano, ingredientes }, sesion);
}
// =================================================================================
// CÁLCULO DE COSTO
// =================================================================================
function getCalculoCosto(body, sesion) {
soloOwner(sesion);
const { sabor, tamano } = body;
if (!sabor || !tamano) return { ok: false, error: "Sabor y tamaño requeridos." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hojaIns = ensureHojaInsumos(ss);
const datosIns = hojaIns.getDataRange().getValues();
const insumosMap = {};
for (let i = 1; i < datosIns.length; i++) {
const [id, nombre, , , buyUnit, , costoPorUnidad] = datosIns[i];
if (!id) continue;
insumosMap[String(id)] = { id: String(id), nombre, buyUnit: buyUnit||"", costoPorUnidad: Number(costoPorUnidad) };
}
const hojaRec = ensureHojaRecetas(ss);
const datosRec = hojaRec.getDataRange().getValues();
const lineas = [];
for (let i = 1; i < datosRec.length; i++) {
const [sab, tam, insumoId, insumoNombre, cantidad, unidad, notas] = datosRec[i];
if (sab === sabor && tam === tamano) {
const insumo = insumosMap[String(insumoId)];
const costoPorUnidad = insumo ? insumo.costoPorUnidad : 0;
const _cantConv = _convUnidadReceta(Number(cantidad)||0, unidad, insumo?insumo.buyUnit:"");   // FIX costos
lineas.push({ insumoId: String(insumoId||""), insumoNombre: insumoNombre||(insumo?insumo.nombre:""), cantidad: Number(cantidad)||0, unidad: unidad||"", notas: notas||"", costoPorUnidad, costoLinea: costoPorUnidad * _cantConv });
}
}
const costoTotal = lineas.reduce((s, l) => s + l.costoLinea, 0);
return { ok: true, sabor, tamano, lineas, costoTotal };
}
// =================================================================================
// INVENTARIO
// =================================================================================
function getStock(body, sesion) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoy = new Date();
const permisos = getPermisos(sesion.rol);
let sucursalFiltro = null;
// Vendedor y Mixto pueden VER stock de ambas sucursales (siguen vendiendo solo en la suya).
var _verStockAmbas = permisos.puedeVerAmbas || sesion.rol === "Vendedor" || sesion.rol === "Mixto";
if (!_verStockAmbas) {
sucursalFiltro = getSucursalUsuario(sesion.usuario);
} else {
sucursalFiltro = body.sucursal || null;
}
// v6.3: cache 30s por sucursal — se invalida al instante con cualquier movimiento (_invLedger)
const _velKey = "stock_" + (sucursalFiltro || "ALL");
const _velHit = _velGet("inv", _velKey);
if (_velHit) return _velHit;
const hoja = ss.getSheetByName("Inventario");
const datos = hoja.getDataRange().getValues();
// Detectar columna estado_anul para filtrar ANULADO
const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
const idxEstadoAnul = headers.indexOf("estado_anul");
const stock = [];
for (let i = 1; i < datos.length; i++) {
const [id, sabor, tamano, sucursal, cantInicial, cantActual, fechaAlta, fechaCad, lote, estado] = datos[i];
if (!sabor) continue;
if (idxEstadoAnul !== -1 && datos[i][idxEstadoAnul] === "ANULADO") continue;  // ignorar anuladas
if (sucursalFiltro && sucursal !== sucursalFiltro) continue;
// CADUCIDAD ELIMINADA — siempre vigente
stock.push({ fila: i+1, id, sabor, tamano, sucursal, cantInicial: Number(cantInicial), cantActual: Number(cantActual), fechaAlta, fechaCaducidad: null, diasRestantes: 9999, vencido: false, porVencer: false, lote, estado });
}
// Reservas separadas apartado/ruta (para mostrar Total/Tienda/Apartado/Ruta).
try {
var _Hr=datos[0]; var _ir=_Hr.indexOf("res_ruta"), _ip=_Hr.indexOf("res_apartado");
for (var _si=0; _si<stock.length; _si++){
var _row = datos[stock[_si].fila-1] || [];
var _ap = _ip!==-1 ? (Number(_row[_ip])||0) : 0;
var _ru = _ir!==-1 ? (Number(_row[_ir])||0) : 0;
stock[_si].reservadoApartado=_ap; stock[_si].reservadoRuta=_ru; stock[_si].reservado=_ap+_ru;
stock[_si].disponibleNeto=Math.max(0, Number(stock[_si].cantActual)-_ap-_ru);
stock[_si].disponibleTienda=stock[_si].disponibleNeto;
}
} catch(e){}
const _velOut = { ok: true, stock }; // v6.3
_velPut("inv", _velKey, _velOut, 30);
return _velOut;
}
function altaProduccion(body, sesion) {
requierePuedeProducir(sesion);
const { sabor, tamano, sucursal, cantidad } = body;
if (!sabor || !tamano || !sucursal || !cantidad || cantidad <= 0) return { ok:false, error:"Faltan datos requeridos." };
const lock=LockService.getScriptLock(); try{lock.waitLock(30000);}catch(e){return{ok:false,error:"El sistema esta ocupado, intenta de nuevo."};}
try{
  const _opId=String(body.opId||"").trim();
  const _opDup=_opYaRegistrada(_opId);
  if(_opDup) return _opDup;
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  invProducir(ss, String(sabor).trim(), String(tamano).trim(), sucursal, Number(cantidad), "PRODUCCION", sesion.usuario, "Alta produccion");
  registrarAuditoria(sesion.usuario, sesion.rol, "PRODUCCION", cantidad+"x "+sabor+" "+tamano+" @ "+sucursal);
  const _resOk = { ok:true, mensaje:"✅ "+cantidad+" "+sabor+" "+tamano+" agregados a "+sucursal+"." };
  _opRegistrar(_opId,_resOk);
  return _resOk;
}catch(err){ return { ok:false, error:String(err&&err.message?err.message:err) }; }
finally{ try{lock.releaseLock();}catch(_e){} }
}
// =================================================================================
// AJUSTE DE INVENTARIO POR CONTEO FISICO (v4.5.13-skip-anulados) — solo Owner
// Pone el sistema igual al conteo fisico de cada SKU. Consolida lotes en una sola
// fila, limpia "stock fantasma" (filas anuladas con piezas) y registra en Auditoria.
// =================================================================================
function ajustarInventario(body, sesion) {
soloOwner(sesion);
const sucursal=body.sucursal; const ajustes=Array.isArray(body.ajustes)?body.ajustes:[];
if(!sucursal) return {ok:false,error:"Falta la sucursal."};
if(!ajustes.length) return {ok:false,error:"No hay ajustes que aplicar."};
const lock=LockService.getScriptLock(); try{lock.waitLock(30000);}catch(e){return{ok:false,error:"Sistema ocupado."};}
try{
  const ss=SpreadsheetApp.getActiveSpreadsheet(); const resumen=[];
  for(const a of ajustes){ const sabor=String(a.sabor||"").trim(), tamano=String(a.tamano||"").trim(), conteo=parseInt(a.conteo);
    if(!sabor||!tamano||isNaN(conteo)||conteo<0) continue;
    const r=invAjustar(ss,sabor,tamano,sucursal,conteo,sesion.usuario,body.motivo||"Conteo fisico");
    resumen.push(sabor+" "+tamano+": "+r.antes+"->"+r.despues+" (d"+r.diff+")");
    registrarAuditoria(sesion.usuario,sesion.rol,"AJUSTE_INVENTARIO",sabor+" "+tamano+" @ "+sucursal+": "+r.antes+"->"+r.despues);
  }
  return {ok:true, mensaje:"✅ Ajuste aplicado al conteo fisico.", resumen};
}catch(err){return{ok:false,error:String(err&&err.message?err.message:err)};}
finally{try{lock.releaseLock();}catch(_e){}}
}
// =================================================================================
// VENTAS MULTI-PRODUCTO
// =================================================================================
function registrarVenta(body, sesion) {
requierePuedeVender(sesion);
const { items, canal, metodoPago, cliente, tipoOp, motivo, anticipo, envio, fechaEntrega } = body;
const esRegalo = tipoOp === "regalo";
const esReserva = tipoOp === "reserva";  // v4.4
if (!items || items.length === 0) return { ok: false, error: "Agrega al menos un producto." };
if (!esRegalo && !esReserva && !canal) return { ok: false, error: "Selecciona el canal de venta." };
if (!esRegalo && !esReserva && !metodoPago) return { ok: false, error: "Selecciona el método de pago." };
if (esRegalo && !motivo) return { ok: false, error: "El motivo del regalo es obligatorio." };
if (esReserva && (!cliente || !cliente.nombre || cliente.nombre.trim() === "")) return { ok: false, error: "El cliente es obligatorio para reservar." };
const itemsNorm = items.map(i => ({ sabor: String(i.sabor||"").trim(), tamano: String(i.tamano||"").trim(), cantidad: parseInt(i.cantidad)||0, precioUnitario: Number(i.precioUnitario)||0, descuento: Number(i.descuento)||0, descTipo: String(i.descTipo||""), esPaquete: i.esPaquete === true, paqueteId: String(i.paqueteId||"") }));
for (const item of itemsNorm) {
if (!item.sabor || !item.tamano || item.cantidad <= 0) return { ok: false, error: `Item inválido: ${item.sabor} ${item.tamano} × ${item.cantidad}` };
}
const canalReal = esRegalo ? "Cortesía" : (esReserva ? (canal || "Reservado") : canal);
const PAQUETE_PRECIOS = {
base:  { 3: 590, 4: 720 },
Rappi: { 3: 630, 4: 780 }
};
const tablaPaq = (canalReal === "Rappi") ? PAQUETE_PRECIOS.Rappi : PAQUETE_PRECIOS.base;
const grupos = {};
itemsNorm.filter(i => i.esPaquete).forEach(i => {
if (!i.paqueteId) i.paqueteId = "PKG-DEFAULT";
if (!grupos[i.paqueteId]) grupos[i.paqueteId] = [];
grupos[i.paqueteId].push(i);
});
for (const pid in grupos) {
const g = grupos[pid];
const size = g.length;
if (!(size === 3 || size === 4)) {
return { ok: false, error: `Paquete inválido (${pid}): debe tener 3 o 4 items, tiene ${size}.` };
}
for (const item of g) {
if (item.tamano !== "Individual") return { ok: false, error: "Paquete: solo aplica a tamaño Individual." };
if (item.cantidad !== 1) return { ok: false, error: "Paquete: cada sabor cuenta como 1 unidad." };
}
const suma = g.reduce((s,x) => s + x.precioUnitario, 0);
const esperado = tablaPaq[size];
if (Math.abs(suma - esperado) > 1) {
return { ok: false, error: `Paquete ${size} en canal ${canalReal}: precio total esperado $${esperado}, recibido $${suma}.` };
}
}
const metodoReal = esRegalo ? "Regalo" : (esReserva ? (metodoPago || "Pendiente") : metodoPago);
const canalRequiereCliente = !esRegalo && canalReal !== "Rappi" && canalReal !== "Uber Eats";
if (canalRequiereCliente && !esReserva && (!cliente || !cliente.nombre || cliente.nombre.trim() === "")) return { ok: false, error: "El nombre del cliente es obligatorio para este canal." };
// VALIDACIÓN B3 v2 — Solo Owner puede aplicar descuentos
if (sesion.rol !== "Owner") {
for (const item of itemsNorm) {
if (item.descuento > 0 && !item.esPaquete) {
return { ok: false, error: "Tu rol no permite aplicar descuentos. Pídeselo al Owner." };
}
}
}
const permisos = getPermisos(sesion.rol);
let sucursal;
if (permisos.puedeVerAmbas && body.sucursal) sucursal = body.sucursal;
else if (permisos.puedeVerAmbas) { sucursal = getSucursalUsuario(sesion.usuario); if (sucursal === "Ambas") sucursal = "Cuajimalpa"; }
else sucursal = getSucursalUsuario(sesion.usuario);
// ============================================================
// SECCIÓN CRÍTICA — LockService garantiza serialización entre sesiones
// ============================================================
const lock = LockService.getScriptLock();
try {
lock.waitLock(30000); // hasta 30s esperando si otra sesión está escribiendo
} catch (e) {
return { ok: false, error: "El sistema está ocupado, intenta de nuevo en unos segundos." };
}
const cambiosTotales = [];   // para rollback si algo falla a mitad
const filasAppendedRows = []; // para rollback de Ventas si fuera necesario
let hojaVentas = null;
try {
const _opId = String(body.opId || "").trim();
const _opDup = _opYaRegistrada(_opId);
if (_opDup) return _opDup;
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hojaInv = ss.getSheetByName("Inventario");
if (!hojaInv) throw new Error("No existe la hoja Inventario.");
    // PRE-CHECK AGREGADO POR SKU — suma cantidades de items repetidos antes de validar stock
    // Las reservas NO descuentan stock (igual que antes), así que se saltan
    if (!esReserva) {
      const demanda = {}; // sabor||tamano -> cantidad total
      for (const item of itemsNorm) {
        const k = item.sabor + "||" + item.tamano;
        demanda[k] = (demanda[k] || 0) + item.cantidad;
      }
      const datosInvCheck = hojaInv.getDataRange().getValues();
      for (const k in demanda) {
        const [sabor, tamano] = k.split("||");
        const disp = calcularDisponible(datosInvCheck, sabor, tamano, sucursal, new Date());
        if (disp < demanda[k]) {
          return { ok: false, error: `Stock insuficiente: ${sabor} ${tamano} — disponible: ${disp}, solicitado total: ${demanda[k]}` };
        }
      }
    }

    let clienteId = "";
    if (cliente && cliente.nombre && cliente.nombre.trim() !== "") {
      clienteId = registrarOActualizarCliente(ss, cliente);
    } else if (!canalRequiereCliente) {
      clienteId = canalReal;
    }
    const ahora = new Date();
    const idVenta = (esReserva ? "RES-" : "VTA-") + ahora.getTime();
    // FEAT-RUTAS (v4.5.6): permitir fechaPersonalizada (rutas planeadas con fecha futura)
    let fechaVenta = ahora;
    if (body.fechaPersonalizada) {
      const fp = new Date(body.fechaPersonalizada);
      if (!isNaN(fp.getTime())) fechaVenta = fp;
    }
    hojaVentas = ss.getSheetByName("Ventas");
    let totalVenta = 0;
    const resumenItems = [];
    const headersV = hojaVentas.getRange(1, 1, 1, hojaVentas.getLastColumn()).getValues()[0];
    const idxTipoOp = headersV.indexOf("tipo_op");
    const idxAnticipo = headersV.indexOf("anticipo_reserva");
    const idxEnvio = headersV.indexOf("envio_monto");
    const idxFechaEnt = headersV.indexOf("fecha_entrega");
    const tipoOpVal = esReserva ? "Reservado" : (esRegalo ? "Regalo" : "Venta");

    // PASO 1 — descontar TODO el stock primero (con re-lectura fresh por item).
    // Si algo falla, rollback inmediato. Las reservas NO descuentan stock.
    const lotesPorItem = [];
    for (const item of itemsNorm) {
      if (esReserva) { lotesPorItem.push([]); continue; }
      const res = descontarStock(hojaInv, item.sabor, item.tamano, sucursal, item.cantidad);
      lotesPorItem.push(res.lotesDescontados);
      cambiosTotales.push(...res.cambios);
    }

    // PASO 2 — solo si todo el descuento salió bien, escribimos las filas de Ventas
    for (let idx = 0; idx < itemsNorm.length; idx++) {
      const item = itemsNorm[idx];
      const { sabor, tamano, cantidad, descuento, descTipo } = item;
      let precio = item.precioUnitario > 0 ? item.precioUnitario : getPrecioActual(ss, sabor, tamano, canalReal);
      if (esRegalo) precio = 0;
      const precioOriginal = getPrecioActual(ss, sabor, tamano);
      const subtotal = precio * cantidad;
      totalVenta += subtotal;
      const notas = [item.esPaquete?`PAQ-${grupos[item.paqueteId]?grupos[item.paqueteId].length:"X"}IND`:"", descuento>0&&!item.esPaquete?`Desc: ${descuento}${descTipo==="pct"?"%":"$"} (orig $${precioOriginal})`:"", esRegalo?`Regalo: ${motivo}`:"", esReserva?`Reserva${motivo?": "+motivo:""}`:"", motivo&&!esRegalo&&!esReserva&&!item.esPaquete?`Nota: ${motivo}`:""].filter(Boolean).join(" | ");
      hojaVentas.appendRow([idVenta, fechaVenta, sesion.usuario, sucursal, sabor, tamano, cantidad, precio, subtotal, canalReal, metodoReal, clienteId, cliente?(cliente.nombre||""):"", lotesPorItem[idx].join(", "), notas]);
      const nuevaFila = hojaVentas.getLastRow();
      filasAppendedRows.push(nuevaFila);
      if (idxTipoOp !== -1) hojaVentas.getRange(nuevaFila, idxTipoOp + 1).setValue(tipoOpVal);
      if (esReserva && idxAnticipo !== -1 && Number(anticipo) > 0) hojaVentas.getRange(nuevaFila, idxAnticipo + 1).setValue(Number(anticipo));
      if (idxFechaEnt !== -1 && fechaEntrega) hojaVentas.getRange(nuevaFila, idxFechaEnt + 1).setValue(String(fechaEntrega).substring(0,10));
      if (idx === 0 && idxEnvio !== -1 && Number(envio) > 0) hojaVentas.getRange(nuevaFila, idxEnvio + 1).setValue(Number(envio));
      resumenItems.push(`${cantidad} ${sabor} ${tamano}`);
    }
    SpreadsheetApp.flush();
    // InvCore: asentar venta en ledger (solo en exito) y reservar fisicamente apartados.
    // v6.5c: los fallos ya NO se tragan en silencio — quedan en Auditoría y, si un
    // apartado no pudo apartar stock físico, el vendedor lo ve en la respuesta.
    const _fallasReserva = [];
    for (var _ii=0; _ii<itemsNorm.length; _ii++){ var _it=itemsNorm[_ii];
      if (esReserva){
        try{ invReservar(ss,_it.sabor,_it.tamano,sucursal,_it.cantidad,"apartado",idVenta,sesion.usuario); }
        catch(_e){ _fallasReserva.push(_it.sabor+" "+_it.tamano+": "+(_e&&_e.message?_e.message:_e)); }
      }
      else {
        try{ var _sx=invSaldos(ss,_it.sabor,_it.tamano,sucursal); _invLedger(ss,(canalReal==="Ruta"?"VENTA_RUTA":"VENTA"),_it.sabor,_it.tamano,sucursal,(lotesPorItem[_ii]||[]).join(", "),-_it.cantidad,0,0,_sx.total,_sx.resRuta,_sx.resApartado,idVenta,sesion.usuario,canalReal); }
        catch(_e){ try{ registrarAuditoria(sesion.usuario, sesion.rol, "LEDGER_FAIL", "VENTA "+idVenta+" | "+_it.sabor+" "+_it.tamano+": "+(_e&&_e.message?_e.message:_e)); }catch(_e2){} }
      }
    }
    if (_fallasReserva.length) {
      try{ registrarAuditoria(sesion.usuario, sesion.rol, "RESERVA_SIN_STOCK", "Apartado "+idVenta+" NO apartó stock físico (riesgo de sobreventa): "+_fallasReserva.join("; ")); }catch(_e2){}
    }

    if (clienteId && clienteId !== "Rappi" && clienteId !== "Uber Eats" && clienteId !== "Cortesía" && !esReserva) {
      registrarHistorialCliente(ss, clienteId, idVenta, fechaVenta, sucursal, canalReal, metodoReal, totalVenta, resumenItems);
    }
    const accionAud = esReserva ? "RESERVA" : (esRegalo ? "REGALO" : "VENTA");
    registrarAuditoria(sesion.usuario, sesion.rol, accionAud, `ID: ${idVenta} | ${resumenItems.join(", ")} | ${canalReal} | $${totalVenta}${motivo?" | "+motivo:""}${anticipo?" | anticipo $"+anticipo:""}`);
    _utilMarcarDirty();
    try { _generarAlertasMensajes(ss, sesion); } catch(e) {}
    let msgRes = esReserva ? `📌 Reserva registrada` : (esRegalo ? `✅ Regalo registrado` : `✅ Venta registrada`);
    if (_fallasReserva.length) msgRes += " ⚠️ OJO: no se pudo apartar stock físico ("+_fallasReserva.join("; ")+"). Puede venderse doble — revisa el stock.";
    const _resOk = { ok: true, mensaje: msgRes, idVenta, items: resumenItems, total: totalVenta, cliente: clienteId, esReserva, envio: Number(envio)||0, totalConEnvio: totalVenta + (Number(envio)||0) };
    _opRegistrar(_opId, _resOk);
    return _resOk;

} catch (err) {
// ROLLBACK: revertir todo el stock descontado
try {
const ss2 = SpreadsheetApp.getActiveSpreadsheet();
const hInv2 = ss2.getSheetByName("Inventario");
if (hInv2 && cambiosTotales.length > 0) rollbackInventario(hInv2, cambiosTotales);
} catch(eRb) {
try { registrarAuditoria(sesion.usuario, sesion.rol, "ROLLBACK_FAIL", "VENTA falló y el rollback también: " + eRb.message); } catch(e){}
}
return { ok: false, error: "No se registró la venta: " + (err && err.message ? err.message : String(err)) + ". El inventario quedó intacto." };
} finally {
try { lock.releaseLock(); } catch(_){}
}
}
// =================================================================================
// MERMA
// =================================================================================
function registrarMerma(body, sesion) {
const p = getPermisos(sesion.rol);
if (!p.puedeProducir && !p.puedeTransferir && !p.esAdmin) throw new Error("Tu rol no permite registrar mermas.");
const { items, sucursal: sucBody, motivo } = body;
if (!items || items.length === 0) return { ok: false, error: "Agrega al menos un producto." };
if (!motivo || !motivo.trim()) return { ok: false, error: "El motivo es obligatorio." };
const sucursal = p.puedeVerAmbas ? (sucBody || "Cuajimalpa") : getSucursalUsuario(sesion.usuario);
// Normalizar items
const itemsNorm = items.map(i => ({
sabor: String(i.sabor || "").trim(),
tamano: String(i.tamano || "").trim(),
cantidad: parseInt(i.cantidad) || 0
}));
// Lock
const lock = LockService.getScriptLock();
try { lock.waitLock(30000); }
catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
const cambiosTotales = [];
try {
const _opId = String(body.opId || "").trim();
const _opDup = _opYaRegistrada(_opId);
if (_opDup) return _opDup;
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hojaInv = ss.getSheetByName("Inventario");
if (!hojaInv) throw new Error("No existe la hoja Inventario.");
    // Pre-check agregado por SKU
    const demanda = {};
    for (const item of itemsNorm) {
      if (!item.sabor || !item.tamano || item.cantidad <= 0) {
        return { ok: false, error: `Item inválido: ${item.sabor} ${item.tamano} × ${item.cantidad}` };
      }
      const k = item.sabor + "||" + item.tamano;
      demanda[k] = (demanda[k] || 0) + item.cantidad;
    }
    const datosInvCheck = hojaInv.getDataRange().getValues();
    for (const k in demanda) {
      const [sabor, tamano] = k.split("||");
      const disp = calcularDisponible(datosInvCheck, sabor, tamano, sucursal, new Date());
      if (disp < demanda[k]) return { ok: false, error: `Stock insuficiente: ${sabor} ${tamano} — disponible: ${disp}, solicitado: ${demanda[k]}` };
    }

    const ahora = new Date();
    const idVenta = "MRM-" + ahora.getTime();
    const fechaVenta = ahora;
    const hojaVentas = ss.getSheetByName("Ventas");
    const resumen = [];

    // PASO 1 — descontar todo primero
    const lotesPorItem = [];
    for (const item of itemsNorm) {
      const res = descontarStock(hojaInv, item.sabor, item.tamano, sucursal, item.cantidad);
      lotesPorItem.push(res.lotesDescontados);
      cambiosTotales.push(...res.cambios);
    }
    // PASO 2 — escribir filas de Ventas/Merma
    for (const item of itemsNorm) {
      resumen.push(`${item.cantidad} ${item.sabor} ${item.tamano}`);
      hojaVentas.appendRow([idVenta, fechaVenta, sesion.usuario, sucursal, item.sabor, item.tamano, item.cantidad, 0, 0, "Merma", "Merma", "", "", "", `Merma: ${motivo}`]);
    }
    SpreadsheetApp.flush();

    // v6.5c: asentar merma en Inv_Ledger — antes NO se asentaba y cada merma
    // dejaba drift permanente inventario-vs-ledger en auditarConsistencia().
    for (let _mi = 0; _mi < itemsNorm.length; _mi++) { const _it = itemsNorm[_mi];
      try { const _sx = invSaldos(ss, _it.sabor, _it.tamano, sucursal); _invLedger(ss, "MERMA", _it.sabor, _it.tamano, sucursal, (lotesPorItem[_mi]||[]).join(", "), -_it.cantidad, 0, 0, _sx.total, _sx.resRuta, _sx.resApartado, idVenta, sesion.usuario, motivo||""); }
      catch(_e) { try { registrarAuditoria(sesion.usuario, sesion.rol, "LEDGER_FAIL", "MERMA "+idVenta+" | "+_it.sabor+" "+_it.tamano+": "+(_e&&_e.message?_e.message:_e)); } catch(_e2) {} }
    }
    registrarAuditoria(sesion.usuario, sesion.rol, "MERMA", `${resumen.join(", ")} | ${sucursal} | Motivo: ${motivo}`);
    try { _generarAlertasMensajes(ss, sesion); } catch(e) {}
    const _resOk = { ok: true, mensaje: `✅ Merma registrada: ${resumen.join(", ")}` };
    _opRegistrar(_opId, _resOk);
    return _resOk;

} catch (err) {
try {
const ss2 = SpreadsheetApp.getActiveSpreadsheet();
const hInv2 = ss2.getSheetByName("Inventario");
if (hInv2 && cambiosTotales.length > 0) rollbackInventario(hInv2, cambiosTotales);
} catch(e){}
return { ok: false, error: "No se registró la merma: " + (err && err.message ? err.message : String(err)) + ". El inventario quedó intacto." };
} finally {
try { lock.releaseLock(); } catch(_){}
}
}
// calcularDisponible — acepta hoja O snapshot. Si recibe snapshot lo usa (compatible legacy);
// si recibe la hoja, re-lee fresh. Mantiene firma original.
function calcularDisponible(datosInv, sabor, tamano, sucursal, hoy) {
// InvCore: disponible = total - res_ruta - res_apartado (skip anuladas). Fuente unica.
let datos = datosInv;
if (datos && typeof datos.getDataRange === "function") datos = datos.getDataRange().getValues();
if (!datos || datos.length === 0) return 0;
const H=datos[0]; const ia=H.indexOf("estado_anul"), ir=H.indexOf("res_ruta"), ip=H.indexOf("res_apartado");
let total=0,ruta=0,apart=0;
for (let i=1;i<datos.length;i++){ const r=datos[i];
  if (r[1]!==sabor||r[2]!==tamano||r[3]!==sucursal) continue;
  if (ia!==-1 && r[ia]==="ANULADO") continue;
  total+=Number(r[5])||0; if(ir!==-1)ruta+=Number(r[ir])||0; if(ip!==-1)apart+=Number(r[ip])||0;
}
return total-ruta-apart;
}
// =================================================================================
// STOCK — Atomic, lock-protected, no-FIFO (v4.5.0)
// =================================================================================
// descontarStock — versión robusta:
//   * Re-lee Inventario fresh en cada llamada (no usa snapshot stale)
//   * Sin orden por fecha (FIFO desactivado por decisión de negocio)
//   * Valida stock total antes de tocar
//   * Devuelve { lotesDescontados:[...], cambios:[{fila,cantPrevia,lote}] } para permitir rollback
//   * Hace flush() al final para garantizar persistencia
function descontarStock(hojaInv, sabor, tamano, sucursal, cantidad) {
if (!cantidad || cantidad <= 0) {
return { lotesDescontados: [], cambios: [] };
}
const datosInv = hojaInv.getDataRange().getValues();
// v4.5.13-skip-anulados: jamas descontar de filas anuladas (estado_anul === "ANULADO").
// Si no se filtran, una venta puede restar de "stock fantasma" invisible al usuario:
// la venta queda registrada pero el stock visible no baja. Header dinamico (idx -1 = legacy).
const idxEstadoAnul = datosInv.length ? datosInv[0].indexOf("estado_anul") : -1;
const lotes = [];
let totalDisponible = 0;
for (let i = 1; i < datosInv.length; i++) {
if (idxEstadoAnul !== -1 && datosInv[i][idxEstadoAnul] === "ANULADO") continue; // ignorar anuladas
const [, sab, tam, suc,, cantAct,,, lote, estado] = datosInv[i];
const cant = Number(cantAct) || 0;
if (sab === sabor && tam === tamano && suc === sucursal && cant > 0 && estado !== "agotado_x_anul") {
lotes.push({ fila: i + 1, cantAct: cant, lote: String(lote || "") });
totalDisponible += cant;
}
}
if (totalDisponible < cantidad) {
throw new Error(`Stock insuficiente: ${sabor} ${tamano} en ${sucursal} — disponible ${totalDisponible}, solicitado ${cantidad}`);
}
// Orden estable: por aparición en la hoja (sin sort por fecha)
let restante = cantidad;
const cambios = [];
const lotesDescontados = [];
for (const lote of lotes) {
if (restante <= 0) break;
const descontar = Math.min(restante, lote.cantAct);
const nuevaCant = lote.cantAct - descontar;
hojaInv.getRange(lote.fila, 6).setValue(nuevaCant);
if (nuevaCant === 0) hojaInv.getRange(lote.fila, 10).setValue("agotado");
cambios.push({ fila: lote.fila, cantPrevia: lote.cantAct, lote: lote.lote });
lotesDescontados.push(`${lote.lote || "lote"}(${descontar})`);
restante -= descontar;
}
SpreadsheetApp.flush();
return { lotesDescontados, cambios };
}
// Restaura el inventario a su estado previo dado una lista de cambios.
// Se usa cuando una venta falla a mitad y hay que revertir todo lo descontado.
function rollbackInventario(hojaInv, cambios) {
if (!cambios || cambios.length === 0) return;
for (const c of cambios) {
try {
hojaInv.getRange(c.fila, 6).setValue(c.cantPrevia);
if (c.cantPrevia > 0) hojaInv.getRange(c.fila, 10).setValue("activo");
} catch (e) {
// si una fila falla al revertir, registramos pero seguimos
try { Logger.log("Rollback fila " + c.fila + " falló: " + e.message); } catch(e){}
}
}
SpreadsheetApp.flush();
}
// Alias backward-compat: si algún caller viejo invoca descontarFIFO, lo redirigimos.
// Ignora `datosInv` y `hoy` legacy y delega a descontarStock.
function descontarFIFO(hojaInv, datosInv, sabor, tamano, sucursal, cantidad, hoy) {
const r = descontarStock(hojaInv, sabor, tamano, sucursal, cantidad);
return r.lotesDescontados;
}
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
const idxNotas = headers.indexOf("notas");
const idxN = idxNotas === -1 ? 14 : idxNotas;
const _desde = body && body.desde ? String(body.desde) : null;   // "yyyy-MM-dd"
const _hasta = body && body.hasta ? String(body.hasta) : null;
const _rango = _desde || _hasta;
const ventas = [];
const _ini = _rango ? 1 : Math.max(1, datos.length-200);
for (let i = _ini; i < datos.length; i++) {
const [idVenta, fecha, usuario, sucursal, sabor, tamano, cantidad, precio, subtotal, canal, metodoPago, clienteId, clienteNombre] = datos[i];
if (!idVenta) continue;
if (idxEstadoAnul !== -1 && datos[i][idxEstadoAnul] === "ANULADO") continue;  // ocultar anuladas
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
ventas.unshift({ idVenta, fecha: fechaFmt, usuario, sucursal, sabor, tamano, cantidad: Number(cantidad), precio: Number(precio), subtotal: Number(subtotal), canal, metodoPago, clienteId, clienteNombre, notas, rutaId, tipoOp: (function(){var ix=headers.indexOf("tipo_op");return ix!==-1?(datos[i][ix]||"Venta"):"Venta";})() });
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
// =================================================================================
// UTILIDADES (recálculo)
// =================================================================================
function recalcularUtilidades(ss) {
ss = ss || SpreadsheetApp.getActiveSpreadsheet(); // FIX 2026-07-04: permite correrla manual desde el editor (Run) sin pasar ss
let hoja = ss.getSheetByName("Utilidades");
if (!hoja) { hoja = ss.insertSheet("Utilidades"); hoja.setTabColor("#2e5c4a"); }
hoja.clearContents(); hoja.clearFormats();
const ahora = new Date().toISOString();
const insumosMap = _buildInsumosMap(ss);
const insumosUnidMap = _buildInsumosUnidMap(ss);   // FIX costos
const recetasMap = _buildRecetasMap(ss);
const precios    = _buildPreciosMap(ss);
const preciosEspecificos = _buildPreciosEspecificosMap(ss);
const headersProd = ["Sabor","Tamaño","Costo Receta ($)","Precio Venta ($)","Utilidad ($)","Margen (%)","Estado Margen","Actualizado"];
hoja.getRange(1,1,1,headersProd.length).setValues([headersProd]);
_formatHeader(hoja, 1, headersProd.length);
const filasProd = [];
for (const key of Object.keys(recetasMap)) {
const ingredientes = recetasMap[key];
if (!ingredientes||ingredientes.length===0) continue;
const [sab,tam] = key.split("|||");
const costo = _calcCostoReceta(ingredientes, insumosMap, insumosUnidMap);
const precio = preciosEspecificos[key]||precios[tam]||0;
const utilidad = precio>0?precio-costo:"";
const margen = precio>0?((precio-costo)/precio*100):"";
const estado = typeof margen==="number"?(margen>=50?"✅ Bueno":margen>=30?"⚠️ Regular":"🔴 Bajo"):"Sin precio";
filasProd.push([sab,tam,costo,precio||"",utilidad,typeof margen==="number"?Math.round(margen*10)/10:"",estado,ahora]);
}
if (filasProd.length>0) {
hoja.getRange(2,1,filasProd.length,headersProd.length).setValues(filasProd);
[hoja.getRange(2,3,filasProd.length,1),hoja.getRange(2,4,filasProd.length,1),hoja.getRange(2,5,filasProd.length,1)].forEach(r=>r.setNumberFormat("$#,##0.00"));
hoja.getRange(2,6,filasProd.length,1).setNumberFormat('0.0"%"');
hoja.getRange(2,7,filasProd.length,1).setFontWeight("bold");
}
const filaInicio = filasProd.length+4;
hoja.getRange(filaInicio-1,1).setValue("UTILIDADES POR OPERACIÓN").setFontWeight("bold").setFontSize(11).setFontColor("#2e5c4a");
const headersOp = ["ID Venta","Fecha","Sucursal","Canal","Productos","Ingreso ($)","Costo ($)","Utilidad ($)","Margen (%)","Sin Receta"];
hoja.getRange(filaInicio,1,1,headersOp.length).setValues([headersOp]);
_formatHeader(hoja, filaInicio, headersOp.length);
const hojaVentas = ss.getSheetByName("Ventas");
const datosVentas = hojaVentas?hojaVentas.getDataRange().getValues():[];
const headersVentas = datosVentas.length > 0 ? datosVentas[0] : [];
const idxEstadoAnul = headersVentas.indexOf("estado_anul");
const gruposVentas = {};
for (let i = 1; i < datosVentas.length; i++) {
if (idxEstadoAnul !== -1 && datosVentas[i][idxEstadoAnul] === "ANULADO") continue;  // saltar anuladas
const [idVenta,fecha,,sucursal,sabor,tamano,cantidad,precio,subtotal,canal] = datosVentas[i];
if (!idVenta) continue;
if (!gruposVentas[idVenta]) gruposVentas[idVenta]={idVenta,fecha,sucursal,canal,items:[]};
gruposVentas[idVenta].items.push({sabor,tamano,cantidad:Number(cantidad),precio:Number(precio),subtotal:Number(subtotal)});
}
const filasOp = [];
for (const g of Object.values(gruposVentas)) {
const ingreso = g.items.reduce((s,i)=>s+i.subtotal,0);
let costo=0, sinReceta=false;
const resumenProds = [];
for (const it of g.items) {
const key=`${it.sabor}|||${it.tamano}`;
if (!recetasMap[key]) sinReceta=true;
else costo+=_calcCostoReceta(recetasMap[key],insumosMap,insumosUnidMap)*it.cantidad;
resumenProds.push(`${it.cantidad}× ${it.sabor} ${it.tamano}`);
}
const utilidad = sinReceta?"":ingreso-costo;
const margen = (!sinReceta&&ingreso>0)?((utilidad/ingreso)*100):"";
filasOp.push([g.idVenta,g.fecha?String(g.fecha).substring(0,16).replace("T"," "):"",g.sucursal,g.canal,resumenProds.join(" | "),ingreso,sinReceta?"":costo,utilidad,typeof margen==="number"?Math.round(margen*10)/10:"",sinReceta?"Sí":"No"]);
}
if (filasOp.length>0) {
const filaDataOp = filaInicio+1;
hoja.getRange(filaDataOp,1,filasOp.length,headersOp.length).setValues(filasOp);
[6,7,8].forEach(col=>hoja.getRange(filaDataOp,col,filasOp.length,1).setNumberFormat("$#,##0.00"));
hoja.getRange(filaDataOp,9,filasOp.length,1).setNumberFormat('0.0"%"');
}
const filaResumen = filaInicio+filasOp.length+3;
const totalIngreso=filasOp.reduce((s,r)=>s+(typeof r[5]==="number"?r[5]:0),0);
const totalCosto=filasOp.reduce((s,r)=>s+(typeof r[6]==="number"?r[6]:0),0);
const totalUtil=filasOp.reduce((s,r)=>s+(typeof r[7]==="number"?r[7]:0),0);
const totalMargen=totalIngreso>0?(totalUtil/totalIngreso*100):0;
hoja.getRange(filaResumen,1,1,headersOp.length).setValues([["TOTALES","","","","",totalIngreso,totalCosto,totalUtil,Math.round(totalMargen*10)/10,""]]);
hoja.getRange(filaResumen,1,1,headersOp.length).setBackground("#2e5c4a").setFontColor("#ffffff").setFontWeight("bold");
[6,7,8].forEach(col=>hoja.getRange(filaResumen,col,1,1).setNumberFormat("$#,##0.00"));
hoja.getRange(filaResumen,9,1,1).setNumberFormat('0.0"%"');
hoja.setColumnWidth(1,160); hoja.setColumnWidth(2,140); hoja.setColumnWidth(5,220); hoja.setFrozenRows(1);
}
function _formatHeader(hoja, fila, ncols) {
const r = hoja.getRange(fila,1,1,ncols);
r.setBackground("#1a1a1a"); r.setFontColor("#ffffff"); r.setFontWeight("bold"); r.setFontSize(10);
}
function _buildInsumosMap(ss) {
const hoja = ss.getSheetByName("Insumos"); if (!hoja) return {};
const datos = hoja.getDataRange().getValues(); if (datos.length<=1) return {};
const map = {};
for (let i = 1; i < datos.length; i++) {
const id=datos[i][0], costoPorUnidad=datos[i][6];
if (!id) continue;   // FIX costos: incluir insumos inactivos que sigan en recetas (igual que el HTML)
map[String(id)] = Number(costoPorUnidad)||0;
}
return map;
}
// FIX costos: conversion de unidades (port exacto de convertirUnidad del HTML)
function _convUnidadReceta(cant, ur, ui){
ur=String(ur||"").toLowerCase().trim(); ui=String(ui||"").toLowerCase().trim();
cant=Number(cant)||0;
if(ur===ui) return cant;
if(ur==="g"&&ui==="kg") return cant/1000;
if(ur==="kg"&&ui==="g") return cant1000;
if(ur==="g"&&ui==="mg") return cant1000;
if(ur==="mg"&&ui==="g") return cant/1000;
if(ur==="ml"&&ui==="l") return cant/1000;
if(ur==="l"&&ui==="ml") return cant1000;
if(ur==="ml"&&ui==="lt") return cant/1000;
if(ur==="lt"&&ui==="ml") return cant1000;
if(ur==="g"&&(ui==="l"||ui==="lt")) return cant/1000;
if((ur==="l"||ur==="lt")&&ui==="g") return cant*1000;
if(ur==="ml"&&ui==="g") return cant;
if(ur==="g"&&ui==="ml") return cant;
if(ur==="kg"&&(ui==="l"||ui==="lt")) return cant;
if((ur==="l"||ur==="lt")&&ui==="kg") return cant;
return cant;
}
// FIX costos: mapa insumoId -> unidad de compra (col 5 "Unidad Compra"), sin filtro de activo.
function _buildInsumosUnidMap(ss) {
const hoja = ss.getSheetByName("Insumos"); if (!hoja) return {};
const datos = hoja.getDataRange().getValues(); if (datos.length<=1) return {};
const map = {};
for (let i = 1; i < datos.length; i++) {
const id=datos[i][0], unidad=datos[i][4];
if (!id) continue;
map[String(id)] = String(unidad||"");
}
return map;
}
function _buildRecetasMap(ss) {
const hoja = ss.getSheetByName("Recetas"); if (!hoja) return {};
const datos = hoja.getDataRange().getValues(); if (datos.length<=1) return {};
const map = {};
for (let i = 1; i < datos.length; i++) {
const sabor=datos[i][0], tamano=datos[i][1], insumoId=datos[i][2], cantidad=datos[i][4], unidad=datos[i][5];
if (!sabor||!tamano||!insumoId) continue;
const key=`${sabor}|||${tamano}`;
if (!map[key]) map[key]=[];
map[key].push({ insumoId: String(insumoId), cantidad: Number(cantidad)||0, unidad: unidad||"" });
}
return map;
}
function _buildPreciosMap(ss) {
const hoja = ss.getSheetByName("Precios"); if (!hoja) return {};
const datos = hoja.getDataRange().getValues();
const map = {};
for (let i = 1; i < datos.length; i++) {
const tamano=datos[i][1], precio=Number(datos[i][2])||0;
if (tamano&&!map[tamano]) map[tamano]=precio;
}
return map;
}
function _buildPreciosEspecificosMap(ss) {
const hoja = ss.getSheetByName("Precios"); if (!hoja) return {};
const datos = hoja.getDataRange().getValues();
const map = {};
for (let i = 1; i < datos.length; i++) {
const sabor=datos[i][0], tamano=datos[i][1], precio=Number(datos[i][2])||0;
if (sabor&&tamano&&precio>0) map[`${sabor}|||${tamano}`]=precio;
}
return map;
}
function _calcCostoReceta(ingredientes, insumosMap, insumosUnidMap) {
return ingredientes.reduce(function(s,ing){
var costoU = insumosMap[ing.insumoId]||0;
var ui = insumosUnidMap ? (insumosUnidMap[ing.insumoId]||"") : "";
var cant = _convUnidadReceta(ing.cantidad, ing.unidad, ui);   // FIX costos: kg/L vs g
return s + costoU*cant;
},0);
}
// =================================================================================
// GASTOS
// =================================================================================
function ensureHojaGastos(ss) {
let hoja = ss.getSheetByName("Gastos");
if (!hoja) {
hoja = ss.insertSheet("Gastos");
hoja.setTabColor("#8B4513");
const headers = ["ID","Concepto","Descripción","Tipo","Frecuencia","Monto","Sucursal","Condición","Aplica a","Activo","Creado","Modificado","Monto Mensual","Vigencia"];
const rango = hoja.getRange(1,1,1,headers.length); rango.setValues([headers]); rango.setBackground("#2E4756"); rango.setFontColor("#FFFFFF"); rango.setFontWeight("bold"); hoja.setFrozenRows(1);
hoja.setColumnWidth(1,160); hoja.setColumnWidth(2,200); hoja.setColumnWidth(3,220); hoja.setColumnWidth(8,280); hoja.setColumnWidth(9,180);
}
// asegurar columna "Vigencia" (col 14) en hojas creadas antes de v4.5.15
if (hoja.getLastColumn() < 14 || hoja.getRange(1,14).getValue() !== "Vigencia") {
hoja.getRange(1,14).setValue("Vigencia").setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
}
return hoja;
}
function getGastos(sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ensureHojaGastos(ss);
const datos = hoja.getDataRange().getValues();
const gastos = [];
for (let i = 1; i < datos.length; i++) {
const r=datos[i]; if(!r[0]) continue;
const monto=Number(r[5])||0, frecuencia=r[4]||"Mensual";
gastos.push({ id:r[0], concepto:r[1], descripcion:r[2], tipo:r[3], frecuencia, monto, montoMensual:calcMontoMensual(monto,frecuencia), sucursal:r[6], condicion:r[7]||"", aplicaA:r[8]||"", activo:r[9]===true||r[9]==="TRUE", creado:r[10], modificado:r[11], vigencia:r[13]||"Siempre" });
}
return { ok: true, gastos };
}
function saveGasto(body, sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ensureHojaGastos(ss);
const datos = hoja.getDataRange().getValues();
const ahora = new Date().toISOString();
const id=body.id||("GST-"+Date.now()), concepto=body.concepto||"", desc=body.descripcion||"", tipo=body.tipo||"Fijo", frecuencia=body.frecuencia||"Mensual", monto=Number(body.monto)||0, sucursal=body.sucursal||"Ambas", condicion=body.condicion||"", aplicaA=body.aplicaA||"", activo=body.activo!==false, vigencia=body.vigencia||"Siempre";
for (let i = 1; i < datos.length; i++) {
if (datos[i][0]===id) {
const montoMens=calcMontoMensual(monto,frecuencia);
hoja.getRange(i+1,1,1,14).setValues([[id,concepto,desc,tipo,frecuencia,monto,sucursal,condicion,aplicaA,activo,datos[i][10],ahora,montoMens,vigencia]]);
_registrarAuditoria(ss,sesion,"UPDATE_GASTO",`${concepto} | ${tipo} | $${monto}`);
_utilMarcarDirty();
return { ok: true, mensaje: `✅ Gasto "${concepto}" actualizado.`, id };
}
}
const montoMensNew=calcMontoMensual(monto,frecuencia);
hoja.appendRow([id,concepto,desc,tipo,frecuencia,monto,sucursal,condicion,aplicaA,activo,ahora,ahora,montoMensNew,vigencia]);
_registrarAuditoria(ss,sesion,"ALTA_GASTO",`${concepto} | ${tipo} | $${monto}`);
_utilMarcarDirty();
return { ok: true, mensaje: `✅ Gasto "${concepto}" creado.`, id };
}
function deleteGasto(body, sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ensureHojaGastos(ss);
const datos = hoja.getDataRange().getValues();
const ahora = new Date().toISOString();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0]===body.id) {
hoja.getRange(i+1,8).setValue(false); hoja.getRange(i+1,10).setValue(ahora);
_registrarAuditoria(ss,sesion,"BAJA_GASTO",`ID: ${body.id} | ${datos[i][1]}`);
_utilMarcarDirty();
return { ok: true, mensaje: `✅ Gasto dado de baja.` };
}
}
return { ok: false, error: "Gasto no encontrado." };
}
// =================================================================================
// OBJETIVOS
// =================================================================================
function ensureHojaObjetivos(ss) {
let hoja = ss.getSheetByName("Objetivos");
if (!hoja) {
hoja = ss.insertSheet("Objetivos");
hoja.setTabColor("#1A5276");
const headers = ["ID","Nombre","Sucursal","Mes","Año","Meta Total (uds)","Líneas (JSON)","Activo","Creado","Modificado"];
const rango = hoja.getRange(1,1,1,headers.length); rango.setValues([headers]); rango.setBackground("#2E4756"); rango.setFontColor("#FFFFFF"); rango.setFontWeight("bold"); hoja.setFrozenRows(1);
hoja.setColumnWidth(1,160); hoja.setColumnWidth(2,220); hoja.setColumnWidth(7,320);
}
return hoja;
}
function getObjetivos(sesion) {
soloOwner(sesion);
const ss=SpreadsheetApp.getActiveSpreadsheet(), hoja=ensureHojaObjetivos(ss), datos=hoja.getDataRange().getValues(), objetivos=[];
for (let i=1;i<datos.length;i++) {
const r=datos[i]; if(!r[0]) continue;
let lineas=[]; try{lineas=JSON.parse(r[6])||[];}catch(e){}
objetivos.push({id:r[0],nombre:r[1],sucursal:r[2],mes:Number(r[3]),anio:Number(r[4]),metaTotal:Number(r[5])||0,lineas,activo:r[7]===true||r[7]==="TRUE",creado:r[8],modificado:r[9]});
}
return { ok: true, objetivos };
}
function saveObjetivo(body, sesion) {
soloOwner(sesion);
const ss=SpreadsheetApp.getActiveSpreadsheet(), hoja=ensureHojaObjetivos(ss), datos=hoja.getDataRange().getValues(), ahora=new Date().toISOString();
const id=body.id||("OBJ-"+Date.now()), nombre=body.nombre||"", sucursal=body.sucursal||"Ambas", mes=Number(body.mes)||new Date().getMonth()+1, anio=Number(body.anio)||new Date().getFullYear(), metaTotal=Number(body.metaTotal)||0, lineas=JSON.stringify(body.lineas||[]), activo=body.activo!==false;
for (let i=1;i<datos.length;i++) {
if (datos[i][0]===id) {
hoja.getRange(i+1,1,1,10).setValues([[id,nombre,sucursal,mes,anio,metaTotal,lineas,activo,datos[i][8],ahora]]);
_registrarAuditoria(ss,sesion,"UPDATE_OBJETIVO",`${nombre} | ${sucursal} | ${mes}/${anio}`);
return { ok: true, mensaje: `✅ Objetivo "${nombre}" actualizado.`, id };
}
}
hoja.appendRow([id,nombre,sucursal,mes,anio,metaTotal,lineas,activo,ahora,ahora]);
_registrarAuditoria(ss,sesion,"ALTA_OBJETIVO",`${nombre} | ${sucursal} | ${mes}/${anio}`);
return { ok: true, mensaje: `✅ Objetivo "${nombre}" creado.`, id };
}
function deleteObjetivo(body, sesion) {
soloOwner(sesion);
const ss=SpreadsheetApp.getActiveSpreadsheet(), hoja=ensureHojaObjetivos(ss), datos=hoja.getDataRange().getValues(), ahora=new Date().toISOString();
for (let i=1;i<datos.length;i++) {
if (datos[i][0]===body.id) {
hoja.getRange(i+1,8).setValue(false); hoja.getRange(i+1,10).setValue(ahora);
_registrarAuditoria(ss,sesion,"BAJA_OBJETIVO",`ID: ${body.id}`);
return { ok: true, mensaje: `✅ Objetivo eliminado.` };
}
}
return { ok: false, error: "Objetivo no encontrado." };
}
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
// =================================================================================
// ████████████████████████████████████████████████████████████████████████████████
// █                                                                              █
// █                  CÓDIGO NUEVO v4.4 — AGREGADO 18-MAY-2026                    █
// █                                                                              █
// ████████████████████████████████████████████████████████████████████████████████
// =================================================================================
// =================================================================================
// SETUP v4.4 — ejecutar UNA VEZ después de pegar este archivo
// =================================================================================
function setupV44() {
const ss = SpreadsheetApp.getActiveSpreadsheet();
let creadas = [];
// 1. Timezone
ss.setSpreadsheetTimeZone(TZ_MX);
creadas.push("Timezone → " + TZ_MX);
// 2. Hoja Dia_Operacion (snapshots de apertura/cierre)
if (!ss.getSheetByName("Dia_Operacion")) {
const h = ss.insertSheet("Dia_Operacion");
h.setTabColor("#86BDAD");
const headers = ["id","fecha","sucursal","estado","abierto_por","abierto_at","cerrado_por","cerrado_at","snapshot_inicial","snapshot_final","notas"];
h.getRange(1, 1, 1, headers.length).setValues([headers]);
h.getRange(1, 1, 1, headers.length).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
h.setFrozenRows(1);
h.setColumnWidth(9, 360); h.setColumnWidth(10, 360);
creadas.push("Dia_Operacion");
}
// 3. Asegurar que la hoja Ventas tenga columnas tipo_op y anticipo_reserva
const hV = ss.getSheetByName("Ventas");
if (hV) {
const headers = hV.getRange(1, 1, 1, hV.getLastColumn()).getValues()[0];
if (headers.indexOf("tipo_op") === -1) {
const newCol = hV.getLastColumn() + 1;
hV.getRange(1, newCol).setValue("tipo_op");
hV.getRange(1, newCol).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
creadas.push("Ventas.tipo_op");
}
if (headers.indexOf("anticipo_reserva") === -1) {
const newCol = hV.getLastColumn() + 1;
hV.getRange(1, newCol).setValue("anticipo_reserva");
hV.getRange(1, newCol).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
creadas.push("Ventas.anticipo_reserva");
}
}
const msg = "✅ Setup v4.4 listo.\n\nCambios aplicados: " + creadas.join(", ");
try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log(msg); }
return msg;
}
// =================================================================================
// HELPERS DE FECHA EN ZONA MX
// =================================================================================
function formatHoraMX(fecha) {
if (!fecha) return "";
const d = (fecha instanceof Date) ? fecha : new Date(fecha);
return Utilities.formatDate(d, TZ_MX, "HH:mm");
}
function formatFechaHoraMX(fecha) {
if (!fecha) return "";
const d = (fecha instanceof Date) ? fecha : new Date(fecha);
return Utilities.formatDate(d, TZ_MX, "dd/MM/yyyy HH:mm");
}
// =================================================================================
// A6 — ABRIR / CERRAR TIENDA + SNAPSHOT
// =================================================================================
function abrirDia(body, sesion) {
const sucursal = body.sucursal || sesion.sucursal;
if (!sucursal || sucursal === "Ambas") return { ok: false, error: "Especifica una sucursal." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ensureHojaDiaOperacion(ss);
const hoyStr = Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd");
// ¿Ya está abierta hoy?
const datos = h.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][1] === hoyStr && datos[i][2] === sucursal && datos[i][3] === "ABIERTA") {
return { ok: false, error: `${sucursal} ya está abierta hoy desde las ${formatHoraMX(datos[i][5])}` };
}
}
// Snapshot del inventario disponible
const snapshot = _snapshotInventarioDisponible(ss, sucursal);
const id = "DIA-" + Date.now();
const nowIso = new Date().toISOString();
h.appendRow([id, hoyStr, sucursal, "ABIERTA", sesion.usuario, nowIso, "", "", JSON.stringify(snapshot), "", body.notas || ""]);
registrarAuditoria(sesion.usuario, sesion.rol, "ABRIR_DIA", `${sucursal} · ${snapshot.totalUnidades} piezas iniciales`);
return { ok: true, mensaje: `✅ ${sucursal} abierta. Snapshot inicial: ${snapshot.totalUnidades} piezas en ${snapshot.skus.length} SKUs.`, snapshot };
}
function cerrarDia(body, sesion) {
const sucursal = body.sucursal || sesion.sucursal;
if (!sucursal || sucursal === "Ambas") return { ok: false, error: "Especifica una sucursal." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ensureHojaDiaOperacion(ss);
const hoyStr = Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd");
const datos = h.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][1] === hoyStr && datos[i][2] === sucursal && datos[i][3] === "ABIERTA") {
const snapshotFinal = _snapshotInventarioDisponible(ss, sucursal);
h.getRange(i + 1, 4).setValue("CERRADA");
h.getRange(i + 1, 7).setValue(sesion.usuario);
h.getRange(i + 1, 8).setValue(new Date().toISOString());
h.getRange(i + 1, 10).setValue(JSON.stringify(snapshotFinal));
registrarAuditoria(sesion.usuario, sesion.rol, "CERRAR_DIA", `${sucursal} · ${snapshotFinal.totalUnidades} piezas finales`);
return { ok: true, mensaje: `✅ ${sucursal} cerrada. Snapshot final: ${snapshotFinal.totalUnidades} piezas.`, snapshotFinal };
}
}
return { ok: false, error: `${sucursal} no tiene día abierto hoy.` };
}
function getDiaActual(body, sesion) {
const sucursal = body.sucursal || sesion.sucursal;
if (!sucursal || sucursal === "Ambas") {
return { ok: true, dias: [_getDiaSucursal("Polanco"), _getDiaSucursal("Cuajimalpa")]};
}
return { ok: true, dia: _getDiaSucursal(sucursal) };
}
function _getDiaSucursal(sucursal) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName("Dia_Operacion");
if (!h) return { sucursal, estado: "SIN_REGISTRO", horario: getHorarioHoy(sucursal) };
const hoyStr = Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd");
const datos = h.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][1] === hoyStr && datos[i][2] === sucursal) {
return {
sucursal, estado: datos[i][3],
abierto_por: datos[i][4], abierto_at: datos[i][5],
cerrado_por: datos[i][6], cerrado_at: datos[i][7],
horario: getHorarioHoy(sucursal)
};
}
}
return { sucursal, estado: "SIN_ABRIR", horario: getHorarioHoy(sucursal) };
}
function ensureHojaDiaOperacion(ss) {
let h = ss.getSheetByName("Dia_Operacion");
if (!h) { setupV44(); h = ss.getSheetByName("Dia_Operacion"); }
return h;
}
function _snapshotInventarioDisponible(ss, sucursal) {
const hInv = ss.getSheetByName("Inventario");
const datos = hInv.getDataRange().getValues();
const hoy = new Date();
const skuMap = {};
for (let i = 1; i < datos.length; i++) {
const [, sab, tam, suc,, cantAct,, fechaCad,, estado] = datos[i];
if (suc !== sucursal) continue;
if (estado === "ANULADO" || estado === "ELIMINADO") continue;
if (!sab || !tam) continue;
// caducidad eliminada
const cant = Number(cantAct) || 0;
if (cant <= 0) continue;
const k = sab + "|" + tam;
skuMap[k] = (skuMap[k] || 0) + cant;
}
const skus = Object.keys(skuMap).map(k => {
const [sabor, tamano] = k.split("|");
return { sabor, tamano, cantidad: skuMap[k] };
});
const totalUnidades = skus.reduce((s, x) => s + x.cantidad, 0);
return { sucursal, skus, totalUnidades, capturado_at: new Date().toISOString() };
}
// =================================================================================
// A7 — EXPORTAR DISPONIBLE A DOCX
// =================================================================================
function exportarDisponibleDocx(body, sesion) {
const sucursal = body.sucursal || "Ambas";
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hInv = ss.getSheetByName("Inventario");
const datos = hInv.getDataRange().getValues();
const hoy = new Date();
const sucursales = sucursal === "Ambas" ? ["Polanco", "Cuajimalpa"] : [sucursal];
const porSuc = {};
sucursales.forEach(s => porSuc[s] = {});
for (let i = 1; i < datos.length; i++) {
const [, sab, tam, suc,, cantAct,, fechaCad,, estado] = datos[i];
if (!sucursales.includes(suc)) continue;
if (estado === "ANULADO" || estado === "ELIMINADO") continue;
// caducidad eliminada
const cant = Number(cantAct) || 0;
if (cant <= 0) continue;
const k = sab + "|" + tam;
porSuc[suc][k] = (porSuc[suc][k] || 0) + cant;
}
const hoyStr = Utilities.formatDate(hoy, TZ_MX, "dd-MM-yyyy");
const horaStr = Utilities.formatDate(hoy, TZ_MX, "HH:mm");
const doc = DocumentApp.create(`TV Disponible ${hoyStr} ${horaStr}`);
const body_doc = doc.getBody();
body_doc.appendParagraph("Tarta Vasca — Disponible").setHeading(DocumentApp.ParagraphHeading.HEADING1);
body_doc.appendParagraph(`Generado: ${hoyStr} ${horaStr}`).setItalic(true);
body_doc.appendParagraph("");
sucursales.forEach(suc => {
body_doc.appendParagraph(suc).setHeading(DocumentApp.ParagraphHeading.HEADING2);
const items = Object.keys(porSuc[suc]);
if (items.length === 0) {
body_doc.appendParagraph("Sin disponible.").setItalic(true);
return;
}
const tabla = [["Sabor", "Tamaño", "Cantidad"]];
items.sort().forEach(k => {
const [sabor, tamano] = k.split("|");
tabla.push([sabor, tamano, String(porSuc[suc][k])]);
});
const t = body_doc.appendTable(tabla);
t.getRow(0).editAsText().setBold(true);
body_doc.appendParagraph("");
});
doc.saveAndClose();
const file = DriveApp.getFileById(doc.getId());
file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
return { ok: true, mensaje: "Documento creado", docId: doc.getId(), docUrl: doc.getUrl(), downloadUrl: `https://docs.google.com/document/d/${doc.getId()}/export?format=docx` };
}
// =================================================================================
// C — ANÁLISIS DE DEMANDA (esqueleto inicial)
// =================================================================================
function getAnalisisDemanda(body, sesion) {
const u = String(sesion.usuario || "").toLowerCase();
if (sesion.rol !== "Owner" && u !== "rebeca" && u !== "rebe") {
throw new Error("Acceso reservado a Owner y Rebeca.");
}
const fechaStr = body.fecha || Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd");
const sucursales = body.sucursal && body.sucursal !== "Ambas" ? [body.sucursal] : ["Polanco", "Cuajimalpa"];
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hDia = ss.getSheetByName("Dia_Operacion");
const hV = ss.getSheetByName("Ventas");
if (!hDia || !hV) return { ok: true, resultado: [], aviso: "Faltan hojas Dia_Operacion o Ventas" };
const datosDia = hDia.getDataRange().getValues();
const datosV = hV.getDataRange().getValues();
const resultado = [];
sucursales.forEach(suc => {
let snapshot = null, abierto_at = null, cerrado_at = null;
for (let i = 1; i < datosDia.length; i++) {
if (datosDia[i][1] === fechaStr && datosDia[i][2] === suc) {
try { snapshot = JSON.parse(datosDia[i][8]); } catch(e) {}
abierto_at = datosDia[i][5];
cerrado_at = datosDia[i][7];
break;
}
}
if (!snapshot) {
resultado.push({ sucursal: suc, error: "Sin apertura registrada para esta fecha." });
return;
}
    const horario = getHorarioHoy(suc, new Date(fechaStr));
    const horaApertura = abierto_at ? new Date(abierto_at) : _combinarHora(fechaStr, horario.abre);
    const horaCierre = _combinarHora(fechaStr, horario.cierra);
    const ahora = new Date();
    const horaFinReporte = cerrado_at ? new Date(cerrado_at) : (ahora < horaCierre ? ahora : horaCierre);

    const ventasPorSku = {};
    for (let i = 1; i < datosV.length; i++) {
      const [idV, fecha, , sucursal, sabor, tamano, cantidad, , , canal] = datosV[i];
      if (sucursal !== suc) continue;
      if (canal === "Merma" || canal === "Cortesía") continue;
      const fd = new Date(fecha);
      if (Utilities.formatDate(fd, TZ_MX, "yyyy-MM-dd") !== fechaStr) continue;
      const k = sabor + "|" + tamano;
      if (!ventasPorSku[k]) ventasPorSku[k] = [];
      ventasPorSku[k].push({ hora: fd, cantidad: Number(cantidad) || 0 });
    }

    const items = snapshot.skus.map(sku => {
      const k = sku.sabor + "|" + sku.tamano;
      const ventas = ventasPorSku[k] || [];
      const vendido = ventas.reduce((s, v) => s + v.cantidad, 0);
      const stockRestante = sku.cantidad - vendido;
      const horasAbiertas = (horaFinReporte - horaApertura) / 3600000;
      const ventasPorHora = horasAbiertas > 0 ? vendido / horasAbiertas : 0;

      let estado, horaAgotamiento, perdidaProyectada, horasStockRestante;
      if (stockRestante <= 0 && ventas.length > 0) {
        const ultimaVenta = ventas[ventas.length - 1].hora;
        horaAgotamiento = formatHoraMX(ultimaVenta);
        const horasDespues = Math.max(0, (horaCierre - ultimaVenta) / 3600000);
        const horasUsadasParaAgotar = (ultimaVenta - horaApertura) / 3600000;
        const velocidad = horasUsadasParaAgotar > 0 ? sku.cantidad / horasUsadasParaAgotar : 0;
        perdidaProyectada = Math.floor(velocidad * horasDespues);
        estado = "AGOTADO";
      } else {
        horasStockRestante = ventasPorHora > 0 ? stockRestante / ventasPorHora : null;
        estado = stockRestante <= 0 ? "AGOTADO_SIN_VENTAS" : "DISPONIBLE";
      }

      return {
        sucursal: suc, sabor: sku.sabor, tamano: sku.tamano,
        stockInicial: sku.cantidad, vendido,
        stockRestante: Math.max(0, stockRestante),
        ventasPorHora: Number(ventasPorHora.toFixed(2)),
        estado, horaAgotamiento, perdidaProyectada,
        horasStockRestante: horasStockRestante !== null ? Number(horasStockRestante.toFixed(1)) : null
      };
    });
    resultado.push({ sucursal: suc, items, horario, abierto_at, cerrado_at });
});
return { ok: true, fecha: fechaStr, resultado };
}
function _combinarHora(fechaStr, horaStr) {
const [a, m, d] = fechaStr.split("-").map(Number);
const [hh, mm] = horaStr.split(":").map(Number);
return new Date(a, m - 1, d, hh, mm);
}
// =================================================================================
// C — SEGUIMIENTO DE VENTAS
// =================================================================================
function getSeguimientoVentas(body, sesion) {
const u = String(sesion.usuario || "").toLowerCase();
if (sesion.rol !== "Owner" && u !== "rebeca" && u !== "rebe") {
throw new Error("Acceso reservado a Owner y Rebeca.");
}
const fechaStr = body.fecha || Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd");
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hV = ss.getSheetByName("Ventas");
const datosV = hV.getDataRange().getValues();
const porHora = { Polanco: {}, Cuajimalpa: {}, Total: {} };
const porSabor = {};
const porTamano = {};
const porCanal = {};
let totalUnidades = 0;
let totalDinero = 0;
for (let i = 1; i < datosV.length; i++) {
const [, fecha, , sucursal, sabor, tamano, cantidad, , subtotal, canal] = datosV[i];
if (canal === "Merma") continue;
const fd = new Date(fecha);
if (Utilities.formatDate(fd, TZ_MX, "yyyy-MM-dd") !== fechaStr) continue;
const hora = Utilities.formatDate(fd, TZ_MX, "HH") + ":00";
const cant = Number(cantidad) || 0;
const monto = Number(subtotal) || 0;
    if (porHora[sucursal]) porHora[sucursal][hora] = (porHora[sucursal][hora] || 0) + cant;
    porHora.Total[hora] = (porHora.Total[hora] || 0) + cant;
    porSabor[sabor] = (porSabor[sabor] || 0) + cant;
    porTamano[tamano] = (porTamano[tamano] || 0) + cant;
    porCanal[canal] = (porCanal[canal] || 0) + cant;
    totalUnidades += cant;
    totalDinero += monto;
}
return { ok: true, fecha: fechaStr, totalUnidades, totalDinero, porHora, porSabor, porTamano, porCanal };
}
// =================================================================================
// FIN v4.4
// =================================================================================
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
// =================================================================================
// ████████████████████████████████████████████████████████████████████████████████
// █   ESTADO DE RESULTADOS (P&L vivo) — v4.5.13  ·  agregado 29-may-2026          █
// ████████████████████████████████████████████████████████████████████████████████
// Estado de resultados en tiempo real: Consolidado + Polanco + Cuajimalpa.
//  - periodo: "YYYY-MM" (default = mes en curso, zona MX)
//  - Ingresos = ventas reales (tipo_op "Venta", canal != "Merma"), netas de comisión
//    canal/método (mismos criterios que el reporte 💎 Utilidad por período).
//  - Costo variable = costo de receta de lo vendido.
//  - Mermas y regalos se reportan como línea aparte (fuga), no inflan el margen bruto.
//  - Costos fijos = hoja Gastos (Monto Mensual). Si el gasto trae Sucursal -> a ese local;
//    si no (Ambas / Compartido / vacío) -> se reparte 50/50.
//  - Mes en curso: costos fijos prorrateados por días transcurridos. Mes cerrado: completo.
// Reutiliza helpers existentes: _buildInsumosMap, _buildRecetasMap, _calcCostoReceta,
// ensureHojaComisiones, ensureHojaGastos, calcMontoMensual.
function _getComisionesMap(ss) {
const h = ensureHojaComisiones(ss);
const d = h.getDataRange().getValues();
const m = {};
for (let i = 1; i < d.length; i++) { if (d[i][0]) m[d[i][0]] = Number(d[i][1]); }
return Object.keys(m).length ? m
: { "Rappi": -0.23, "Uber Eats": -0.23, "Tarjeta": -0.06, "Transferencia": -0.03, "Efectivo": 0 };
}
function _gastosActivosMensual(ss) {
const h = ensureHojaGastos(ss);
const d = h.getDataRange().getValues();
const out = [];
for (let i = 1; i < d.length; i++) {
const r = d[i]; if (!r[0]) continue;
const activo = (r[9] === true || r[9] === "TRUE");
if (!activo) continue;
out.push({ montoMensual: calcMontoMensual(Number(r[5]) || 0, r[4] || "Mensual"), sucursal: r[6], vigencia: r[13] || "Siempre" });
}
return out;
}

// getEstadoResultados — v4.5.14 (29-may-2026)
//  - Rango por meses: body.desde / body.hasta ("yyyy-MM"). Default ambos = mes en curso.
//    (compat: body.periodo aplica a desde y hasta). Siempre granularidad mensual.
//  - Costos fijos al 100% por mes (sin prorrateo por día) × nº de meses del rango.
//  - Devuelve, por columna (consolidado + cada sucursal), el desglose de contribución
//    por sabor y por tamaño (ingreso neto, costo, utilidad, margen, unidades). La comisión
//    se prorratea a nivel línea según la participación de la línea en el ingreso del ticket.
function getEstadoResultados(body, sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const tz = TZ_MX;
const hoy = new Date();
const mesActual = Utilities.formatDate(hoy, tz, "yyyy-MM");
let desde = (body && body.desde) ? String(body.desde) : ((body && body.periodo) ? String(body.periodo) : mesActual);
let hasta = (body && body.hasta) ? String(body.hasta) : ((body && body.periodo) ? String(body.periodo) : desde);
if (desde > hasta) { const t = desde; desde = hasta; hasta = t; }
const da = Number(desde.split("-")[0]), dm = Number(desde.split("-")[1]);
const ha = Number(hasta.split("-")[0]), hm = Number(hasta.split("-")[1]);
const nMeses = (ha - da) * 12 + (hm - dm) + 1;
const insumosMap = _buildInsumosMap(ss);
const insumosUnidMap = _buildInsumosUnidMap(ss);   // FIX costos
const recetasMap = _buildRecetasMap(ss);
const comMap     = _getComisionesMap(ss);
const costoUnit = function (sabor, tamano) {
const key = sabor + "|||" + tamano;
if (!recetasMap[key]) return null;
return _calcCostoReceta(recetasMap[key], insumosMap, insumosUnidMap);
};
const comisionPct = function (canal, metodo) {
return (canal === "Rappi" || canal === "Uber Eats")
? (comMap[canal] != null ? comMap[canal] : -0.23)
: (comMap[metodo] || 0);
};
const hV = ss.getSheetByName("Ventas");
const datosV = hV ? hV.getDataRange().getValues() : [];
const headersV = datosV[0] || [];
const idxTipoOp = headersV.indexOf("tipo_op");
const idxAnul   = headersV.indexOf("estado_anul");
function blank() { return { ingresoBruto: 0, comision: 0, costoVar: 0, mermaRegaloCosto: 0, unidades: 0, ops: {}, sabor: {}, tamano: {} }; }
const acc = { Polanco: blank(), Cuajimalpa: blank() };
const grupos = {}; // idVenta -> { sucursal, canal, metodo, ingreso, lines:[] }
for (let i = 1; i < datosV.length; i++) {
const r = datosV[i];
const idVenta = r[0]; if (!idVenta) continue;
if (idxAnul !== -1 && r[idxAnul] === "ANULADO") continue;
const fd = (r[1] instanceof Date) ? r[1] : new Date(r[1]);
if (isNaN(fd.getTime())) continue;
const ym = Utilities.formatDate(fd, tz, "yyyy-MM");
if (ym < desde || ym > hasta) continue;
    const sucursal = r[3], sabor = r[4], tamano = r[5];
    const cantidad = Number(r[6]) || 0, subtotal = Number(r[8]) || 0, canal = r[9], metodo = r[10];
    const tipoOp = idxTipoOp !== -1 ? r[idxTipoOp] : "Venta";
    if (tipoOp === "Reservado") continue;
    if (!acc[sucursal]) continue;

    const cu = costoUnit(sabor, tamano);
    const costoLinea = (cu == null) ? 0 : cu * cantidad;
    const esMerma  = (canal === "Merma" || tipoOp === "Merma");
    const esRegalo = (tipoOp === "Regalo" || canal === "Cortesía" || subtotal === 0);
    if (esMerma || esRegalo) { acc[sucursal].mermaRegaloCosto += costoLinea; continue; }

    if (!grupos[idVenta]) grupos[idVenta] = { sucursal: sucursal, canal: canal, metodo: metodo, ingreso: 0, lines: [] };
    grupos[idVenta].ingreso += subtotal;
    grupos[idVenta].lines.push({ sabor: sabor, tamano: tamano, cant: cantidad, subtotal: subtotal, costoLinea: costoLinea });
    acc[sucursal].unidades += cantidad;
    acc[sucursal].ops[idVenta] = true;
}
function addBreak(map, key, ingNeto, costo, cant) {
if (!map[key]) map[key] = { ingreso: 0, costo: 0, unidades: 0 };
map[key].ingreso += ingNeto; map[key].costo += costo; map[key].unidades += cant;
}
Object.keys(grupos).forEach(function (id) {
const g = grupos[id];
const a = acc[g.sucursal]; if (!a) return;
const comTicket = Math.round(g.ingreso * comisionPct(g.canal, g.metodo)); // negativo
a.ingresoBruto += g.ingreso;
a.comision     += comTicket;
g.lines.forEach(function (ln) {
a.costoVar += ln.costoLinea;
const share   = g.ingreso > 0 ? (ln.subtotal / g.ingreso) : 0;
const ingNeto = ln.subtotal + comTicket * share;
addBreak(a.sabor,  ln.sabor,  ingNeto, ln.costoLinea, ln.cant);
addBreak(a.tamano, ln.tamano, ingNeto, ln.costoLinea, ln.cant);
});
});
// costos fijos por mes según vigencia (100% por mes, sin prorrateo)
const mesesRango = [];
{ let yy = da, mm = dm; for (let k = 0; k < nMeses; k++) { mesesRango.push(yy + "-" + ("0" + mm).slice(-2)); mm++; if (mm > 12) { mm = 1; yy++; } } }
const fijRecMensual = { Polanco: 0, Cuajimalpa: 0 };  // recurrentes (monto por mes)
const fijExtra      = { Polanco: 0, Cuajimalpa: 0 };  // extraordinarios que caen dentro del rango
_gastosActivosMensual(ss).forEach(function (g) {
const apl = String(g.vigencia || "").trim();
const esMes = /^\d{4}-\d{2}$/.test(apl);
let target = null;
if (esMes) { if (mesesRango.indexOf(apl) !== -1) target = fijExtra; }
else target = fijRecMensual;
if (!target) return;  // gasto de un mes que no está en el rango -> se ignora
const s = String(g.sucursal || "").trim();
if (s === "Polanco")         target.Polanco    += g.montoMensual;
else if (s === "Cuajimalpa") target.Cuajimalpa += g.montoMensual;
else { target.Polanco += g.montoMensual / 2; target.Cuajimalpa += g.montoMensual / 2; }
});
function ordenarBreak(map) {
return Object.keys(map).map(function (k) {
const b = map[k];
const ingreso = Math.round(b.ingreso), costo = Math.round(b.costo);
const utilidad = ingreso - costo;
const margen = ingreso > 0 ? (utilidad / ingreso * 100) : null;
return { key: k, ingreso: ingreso, costo: costo, utilidad: utilidad, margen: margen, unidades: b.unidades };
}).sort(function (x, y) { return y.utilidad - x.utilidad; });
}
function armarCol(a, fijoRecMes, fijoExtra) {
const ingresoBruto = Math.round(a.ingresoBruto);
const comision     = Math.round(a.comision);
const ingresoNeto  = ingresoBruto + comision;
const costoVar     = Math.round(a.costoVar);
const utilidadBruta = ingresoNeto - costoVar;
const margenBruto  = ingresoNeto > 0 ? (utilidadBruta / ingresoNeto * 100) : null;
const mermaReg     = Math.round(a.mermaRegaloCosto);
const fijoMensual  = Math.round(fijoRecMes);
const fijoTotal    = Math.round(fijoRecMes * nMeses + (fijoExtra || 0));
const utilidadNeta = utilidadBruta - mermaReg - fijoTotal;
const margenNeto   = ingresoNeto > 0 ? (utilidadNeta / ingresoNeto * 100) : null;
const ops          = Object.keys(a.ops).length;
const ticketProm   = ops > 0 ? Math.round(ingresoBruto / ops) : 0;
const margenBrutoFrac = (margenBruto != null && margenBruto > 0) ? margenBruto / 100 : null;
const ventaEquilibrio = margenBrutoFrac ? Math.round(fijoMensual / margenBrutoFrac) : null;
return {
ingresoBruto: ingresoBruto, comision: comision, ingresoNeto: ingresoNeto,
costoVar: costoVar, utilidadBruta: utilidadBruta, margenBruto: margenBruto,
mermaRegaloCosto: mermaReg, fijoMensual: fijoMensual, fijoTotal: fijoTotal,
utilidadNeta: utilidadNeta, margenNeto: margenNeto,
ops: ops, unidades: a.unidades, ticketProm: ticketProm, ventaEquilibrio: ventaEquilibrio,
porSabor: ordenarBreak(a.sabor), porTamano: ordenarBreak(a.tamano)
};
}
function mergeMap(dst, src) {
Object.keys(src).forEach(function (k) {
if (!dst[k]) dst[k] = { ingreso: 0, costo: 0, unidades: 0 };
dst[k].ingreso += src[k].ingreso; dst[k].costo += src[k].costo; dst[k].unidades += src[k].unidades;
});
}
const accCons = blank();
["Polanco", "Cuajimalpa"].forEach(function (s) {
const a = acc[s];
accCons.ingresoBruto += a.ingresoBruto; accCons.comision += a.comision;
accCons.costoVar += a.costoVar; accCons.mermaRegaloCosto += a.mermaRegaloCosto;
accCons.unidades += a.unidades;
Object.keys(a.ops).forEach(function (id) { accCons.ops[id] = true; });
mergeMap(accCons.sabor, a.sabor); mergeMap(accCons.tamano, a.tamano);
});
return {
ok: true,
desde: desde, hasta: hasta, nMeses: nMeses,
consolidado: armarCol(accCons, fijRecMensual.Polanco + fijRecMensual.Cuajimalpa, fijExtra.Polanco + fijExtra.Cuajimalpa),
sucursales: { Polanco: armarCol(acc.Polanco, fijRecMensual.Polanco, fijExtra.Polanco), Cuajimalpa: armarCol(acc.Cuajimalpa, fijRecMensual.Cuajimalpa, fijExtra.Cuajimalpa) },
generado: Utilities.formatDate(hoy, tz, "yyyy-MM-dd HH:mm")
};
}
// =================================================================================
// ████ PEDIDO / COCINADA SUGERIDA — v4.5.18 (29-may-2026) ████
// =================================================================================
// Recomienda cuánto cocinar por sabor-tamaño en cada localidad para un día objetivo.
//  - "Potencial/día" por SKU = mismo cálculo del reporte de Oportunidad: si el día se
//    proyecta (última venta ≥2h antes del cierre y ≥2 piezas) -> tasa×horas abierto; si no, lo vendido.
//  - Promedia el potencial de los últimos N (=4) días del MISMO día de semana que el objetivo.
//    Si no hay N de ese día con ventas, cae a los últimos N días calendario con ventas.
//  - Excluye ventas de RUTA (esas se planean según pedidos de clientes) y mermas/regalos/reservas
//    (la base es la misma que el "potencial": tipo_op = Venta).
//  - Sugerido = promedio del potencial × 1.15, redondeado HACIA ARRIBA.
const _HORAS_APERTURA_PS = { "Cuajimalpa": { abre: 9, cierra: 18 }, "Polanco": { abre: 11, cierra: 19 } };
const _DIAS_ES = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
function _dowFromStr(fechaStr) { // fechaStr "yyyy-MM-dd" -> 0=Dom..6=Sab
const p = fechaStr.split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
}
function getPedidoSugerido(body, sesion) {
const u = String(sesion.usuario || "").toLowerCase();
if (sesion.rol !== "Owner" && u !== "rebeca" && u !== "rebe") throw new Error("Acceso reservado a Owner y Rebeca.");
const ss = SpreadsheetApp.getActiveSpreadsheet();
const tz = TZ_MX;
const n = Number(body && body.n) > 0 ? Number(body.n) : 4;
const buffer = (body && body.buffer != null) ? Number(body.buffer) : 0.25;
const targetStr = (body && body.fecha) ? String(body.fecha).substring(0, 10) : Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
const targetDow = _dowFromStr(targetStr);
const hV = ss.getSheetByName("Ventas");
const datosV = hV ? hV.getDataRange().getValues() : [];
const headersV = datosV[0] || [];
const idxTipoOp = headersV.indexOf("tipo_op");
const idxAnul   = headersV.indexOf("estado_anul");
const idxNotas  = headersV.indexOf("notas"); const idxN = idxNotas === -1 ? 14 : idxNotas;
// perSku[suc|sabor|tamano][fechaStr] = { qty, lastHour }
const perSku = {};
const diasConVenta = {};   // fechaStr -> true (días con venta calificable)
for (let i = 1; i < datosV.length; i++) {
const r = datosV[i];
if (!r[0]) continue;
if (idxAnul !== -1 && r[idxAnul] === "ANULADO") continue;
const tipoOp = idxTipoOp !== -1 ? (r[idxTipoOp] || "Venta") : "Venta";
if (tipoOp !== "Venta") continue;                 // solo ventas reales (igual que "potencial")
const canal = r[9];
if (canal === "Merma" || canal === "Cortesía") continue;
if (canal === "Ruta") continue;                    // (punto 6) excluir SIEMPRE ventas de ruta por canal
const notas = String(r[idxN] || "");
if (notas.indexOf("RUTA-") !== -1) continue;       // excluir ventas de ruta (compat. por nota)
const fd = (r[1] instanceof Date) ? r[1] : new Date(r[1]);
if (isNaN(fd.getTime())) continue;
const fechaStr = Utilities.formatDate(fd, tz, "yyyy-MM-dd");
if (fechaStr >= targetStr) continue;               // solo días anteriores al objetivo
const suc = r[3], sabor = r[4], tamano = r[5];
if (suc !== "Polanco" && suc !== "Cuajimalpa") continue;
const cant = Number(r[6]) || 0;
const hora = Number(Utilities.formatDate(fd, tz, "H")) || 0;
const k = suc + "|" + sabor + "|" + tamano;
if (!perSku[k]) perSku[k] = {};
if (!perSku[k][fechaStr]) perSku[k][fechaStr] = { qty: 0, lastHour: 0 };
perSku[k][fechaStr].qty += cant;
if (hora > perSku[k][fechaStr].lastHour) perSku[k][fechaStr].lastHour = hora;
diasConVenta[fechaStr] = true;
}
// Ventana fija: los 7 días calendario anteriores al objetivo (target-7 ... target-1).
// Para un sábado objetivo: del sábado pasado (target-7) a ayer viernes (target-1).
const _tp = targetStr.split("-");
const _tBase = new Date(Number(_tp[0]), Number(_tp[1]) - 1, Number(_tp[2]));
function _ymd(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
const sampleDays = [];   // ascendente: target-7 (más viejo) ... target-1 (ayer)
for (let _k = 7; _k >= 1; _k--) sampleDays.push(_ymd(new Date(_tBase.getFullYear(), _tBase.getMonth(), _tBase.getDate() - _k)));
const N = sampleDays.length; // 7
// Pesos: target-7 (mismo día de la semana pasada) 25% y target-1 (ayer) 25%; los otros 5 días 10% c/u. Suman 100%.
const pesos = [0.25, 0.10, 0.10, 0.10, 0.10, 0.10, 0.25];
const modo = "ventana-7d";
function potencialDia(suc, dato) {
if (!dato) return 0;
const h = _HORAS_APERTURA_PS[suc] || { abre: 10, cierra: 19 };
const horasAbierto = h.cierra - h.abre;
const horasConStock = Math.max(0.5, dato.lastHour - h.abre + 1);
const sePuedeProyectar = dato.lastHour > 0 && (h.cierra - dato.lastHour) >= 2 && dato.qty >= 2;
return sePuedeProyectar ? (dato.qty / horasConStock) * horasAbierto : dato.qty;
}
// ===== METODO 2 (tendencia mismo dia de la semana) - v4.5.17 =====
// Para un lunes objetivo: promedio ponderado de los 4 lunes anteriores usando las
// UNIDADES REALMENTE VENDIDAS (sin proyeccion de potencial), combinado con el
// sugerido del metodo 1:
//   hace 1 semana 32% . hace 2 sem 24% . hace 3 sem 16% . hace 4 sem 8%  (bloque mismo-dia = 80%)
//   + 20% del sugerido del metodo 1
//   + 10% de buffer al final (redondeo hacia arriba)
// Si falta alguno de los 4 mismos dias (sin venta o sucursal cerrada ese dia), su peso
// se redistribuye proporcionalmente entre los mismos dias que SI tienen datos; el bloque
// mismo-dia sigue valiendo 80% del total. Si ninguno de los 4 tiene datos, el metodo 2
// queda como espejo del metodo 1.
const PESOS_MISMODIA = [0.32, 0.24, 0.16, 0.08]; // hace 1, 2, 3, 4 semanas
const BLOQUE_MISMODIA = 0.80;
const PESO_M1_EN_M2 = 0.20;
const BUFFER2 = 0.10;
const diasMismoDia = []; // [t-7, t-14, t-21, t-28]
for (let _w = 1; _w <= 4; _w++) diasMismoDia.push(_ymd(new Date(_tBase.getFullYear(), _tBase.getMonth(), _tBase.getDate() - 7 * _w)));
const sucursales = { Polanco: [], Cuajimalpa: [] };
Object.keys(perSku).forEach(function (k) {
const parts = k.split("|"); const suc = parts[0], sabor = parts[1], tamano = parts[2];
if (N === 0) return;
// --- Metodo 1: ventana 7 dias, potencial corregido ---
let prom = 0;
for (let _i = 0; _i < N; _i++) prom += pesos[_i] * potencialDia(suc, perSku[k][sampleDays[_i]]);
const sugerido = Math.ceil(prom * (1 + buffer));
// --- Metodo 2: tendencia mismo dia (unidades reales) + metodo 1 ---
let _sumW = 0, _acc = 0;
for (let _w = 0; _w < 4; _w++) {
const _dato = perSku[k][diasMismoDia[_w]];
const _qty = _dato ? _dato.qty : 0;
if (_qty > 0) { _sumW += PESOS_MISMODIA[_w]; _acc += PESOS_MISMODIA[_w] * _qty; }
}
let base2;
if (_sumW > 0) {
const _bloque = _acc * (BLOQUE_MISMODIA / _sumW); // renormaliza el bloque a 80% entre los dias con datos
base2 = _bloque + PESO_M1_EN_M2 * sugerido;
} else {
base2 = sugerido; // sin datos de mismos dias -> espejo del metodo 1
}
const sugerido2 = Math.ceil(base2 * (1 + BUFFER2));
if (sugerido >= 1 || sugerido2 >= 1) sucursales[suc].push({ sabor: sabor, tamano: tamano, promPotencial: Number(prom.toFixed(1)), sugerido: sugerido, sugerido2: sugerido2 });
});
const ordenTam = { "Individual": 1, "Mediana": 2, "Grande": 3 };
["Polanco", "Cuajimalpa"].forEach(function (s) {
sucursales[s].sort(function (a, b) {
const ta = ordenTam[a.tamano] || 9, tb = ordenTam[b.tamano] || 9;
if (ta !== tb) return ta - tb;
return b.sugerido - a.sugerido;
});
});
const totalSugerido = {
Polanco: sucursales.Polanco.reduce(function (s, x) { return s + x.sugerido; }, 0),
Cuajimalpa: sucursales.Cuajimalpa.reduce(function (s, x) { return s + x.sugerido; }, 0)
};
const totalSugerido2 = {
Polanco: sucursales.Polanco.reduce(function (s, x) { return s + (x.sugerido2 || 0); }, 0),
Cuajimalpa: sucursales.Cuajimalpa.reduce(function (s, x) { return s + (x.sugerido2 || 0); }, 0)
};
return {
ok: true,
fecha: targetStr,
diaSemana: _DIAS_ES[targetDow],
modo: modo,                 // "ventana-7d"
n: N, muestras: N,
diasUsados: sampleDays,
bufferPct: Math.round(buffer * 100),
pesos: pesos,
sucursales: sucursales,
totalSugerido: totalSugerido,
totalSugerido2: totalSugerido2,
metodo2: {
etiqueta: "tendencia mismo dia",
diasMismoDia: diasMismoDia,           // [hace 1, 2, 3, 4 semanas]
pesosMismoDia: PESOS_MISMODIA,         // [0.32, 0.24, 0.16, 0.08]
pesoMetodo1: PESO_M1_EN_M2,            // 0.20
bufferPct: Math.round(BUFFER2 * 100)   // 10
},
generado: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm")
};
}
/* =================================================================================
MÓDULO REPARTO A DOMICILIO (integrado) — corre repartoSetup() una vez tras desplegar
================================================================================= /
// -------- Parámetros (ajustables) --------
var REP_PARAMS = { capTartas: 13, jornadaMin: 360, horaInicio: 8.560, minServicio: 10,
velKmh: 18, factorVial: 1.35, choferes: 3 };
var REP_DEPOT  = { nombre: "Cocina Cuajimalpa", lat: 19.3587, lon: -99.2960,
dir: "Cuajimalpa de Morelos, Ciudad de México" };
var REP_PRECIO_TARTA = 650; // respaldo si el pedido no trae monto
// (punto 2) Local Tarta Vasca Polanco como parada opcional en la ruta.
// ⚠ Coordenadas aproximadas de Polanco — ajusta lat/lon a la dirección exacta del local.
var REP_POLANCO = { nombre: "Tarta Vasca Polanco", lat: 19.4319, lon: -99.1936,
dir: "Tarta Vasca, Polanco, Miguel Hidalgo, CDMX" };
function _repPolancoNode(forzarPrimero){
return { id:"LOCAL-POLANCO", cliente:"🏬 Tarta Vasca Polanco", tel:"", dir:REP_POLANCO.dir,
zona:"Polanco", lat:REP_POLANCO.lat, lon:REP_POLANCO.lon, tartas:0, detalle:"Local Polanco (parada)",
monto:0, envio:0, pago:"Pagado", estado:"base", fechaDeseada:"", referencia:"", instruccion:"", items:[],
esLocal:true, forzarPrimero:!!forzarPrimero };
}
function _repBaseConPolanco(base, body){
if(body && body.incluirPolanco){ var b=base.slice(); b.push(_repPolancoNode(body.polancoPrimero)); return b; }
return base;
}
// -------- Setup de hojas --------
function repartoSetup() {
var ss = SpreadsheetApp.getActiveSpreadsheet();
_repHojaPedidos(ss); _repHojaRutas(ss); _repSembrarCanalRuta(ss);
_ensureColVentas(ss,"envio_monto"); _ensureColVentas(ss,"fecha_entrega");
_repSeedZonasEnvio(ss);
try { repInstalarTriggerProduccion(); } catch(e){}
return { ok:true, mensaje:"✅ Reparto: hojas, columnas (envio/fecha entrega), zonas y trigger de produccion listos." };
}
function _repHojaPedidos(ss){
var hdr=["id","cliente","tel","dir","zona","lat","lon","tartas","detalle","monto","pago","estado","fechaDeseada","creado","referencia","instruccion","items","envio"];
var h = ss.getSheetByName("Reparto_Pedidos");
if(!h){ h = ss.insertSheet("Reparto_Pedidos"); h.setTabColor("#7A1F2B");
var r=h.getRange(1,1,1,hdr.length); r.setValues([hdr]); r.setBackground("#2E4756"); r.setFontColor("#FFFFFF"); r.setFontWeight("bold"); h.setFrozenRows(1);
} else if(h.getLastColumn() < hdr.length){
// Migración: agrega columnas referencia/instruccion/items a hojas creadas antes de este patch
try{ if(h.getMaxColumns() < hdr.length) h.insertColumnsAfter(h.getMaxColumns(), hdr.length - h.getMaxColumns()); }catch(e){}
h.getRange(1,1,1,hdr.length).setValues([hdr]);
}
return h;
}
function _repParseItems(v){ try{ if(!v) return []; return (typeof v==="string") ? JSON.parse(v) : v; }catch(e){ return []; } }
function _repHojaRutas(ss){
var h = ss.getSheetByName("Reparto_Rutas");
if(!h){ h = ss.insertSheet("Reparto_Rutas"); h.setTabColor("#7A1F2B");
var hdr=["id","fecha","estado","json","creado","cerrado"];
var r=h.getRange(1,1,1,hdr.length); r.setValues([hdr]); r.setBackground("#2E4756"); r.setFontColor("#FFFFFF"); r.setFontWeight("bold"); h.setFrozenRows(1);
}
return h;
}
function _repSembrarCanalRuta(ss){
try { if (typeof sembrarCanales==="function") sembrarCanales(ss); } catch(e){}
// Asegura el canal "Ruta" en el catálogo (reutiliza toggleCatalogo si existe)
try { toggleCatalogo({usuario:"sistema",rol:"Owner"}, "Canal", "Ruta", true); } catch(e){}
}
// -------- Geometría / distancia (Maps real para geocodificar) --------
function _repHaversine(a,b){ var R=6371, rad=function(x){return x*Math.PI/180;};
var dla=rad(b[0]-a[0]), dlo=rad(b[1]-a[1]);
var h=Math.sin(dla/2)*Math.sin(dla/2)+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dlo/2)*Math.sin(dlo/2);
return 2*R*Math.asin(Math.sqrt(h)); }
function _repDist(a,b){ return _repHaversine(a,b)*REP_PARAMS.factorVial; }
function _repGeocode(dir){
try { var r = Maps.newGeocoder().setRegion("mx").geocode(dir);
if(r && r.status==="OK" && r.results.length){ var loc=r.results[0].geometry.location; return [loc.lat, loc.lng]; }
} catch(e){}
return null;
}
function _repCoord(p){ return [Number(p.lat), Number(p.lon)]; }
// -------- Motor de ruteo (mismo algoritmo validado en pruebas) --------
function _repLargo(seq){ var d=[REP_DEPOT.lat,REP_DEPOT.lon]; if(!seq.length) return 0;
var t=_repDist(d,_repCoord(seq[0])); for(var i=0;i<seq.length-1;i++) t+=_repDist(_repCoord(seq[i]),_repCoord(seq[i+1]));
return t+_repDist(_repCoord(seq[seq.length-1]),d); }
function _repSecuenciar(ped){ var d=[REP_DEPOT.lat,REP_DEPOT.lon], rest=ped.slice(), ruta=[], act=d;
while(rest.length){ var best=rest[0]; for(var i=1;i<rest.length;i++) if(_repDist(act,_repCoord(rest[i]))<_repDist(act,_repCoord(best))) best=rest[i];
ruta.push(best); act=_repCoord(best); rest.splice(rest.indexOf(best),1); }
return _repDosOpt(ruta); }
function _repDosOpt(ruta){ var mej=ruta, mejora=true;
while(mejora){ mejora=false; for(var i=0;i<mej.length-1;i++) for(var j=i+1;j<mej.length;j++){
var cand=mej.slice(0,i).concat(mej.slice(i,j+1).reverse(), mej.slice(j+1));
if(_repLargo(cand)<_repLargo(mej)-1e-9){ mej=cand; mejora=true; } } }
return mej; }
function _repParticionar(ped,k){ var d=[REP_DEPOT.lat,REP_DEPOT.lon];
var ord=ped.slice().sort(function(a,b){ return Math.atan2(_repCoord(a)[0]-d[0],_repCoord(a)[1]-d[1])-Math.atan2(_repCoord(b)[0]-d[0],_repCoord(b)[1]-d[1]); });
var total=ord.reduce(function(s,p){return s+(Number(p.tartas)||0);},0), obj=total/k, grupos=[], act=[], carga=0;
for(var i=0;i<ord.length;i++){ var p=ord[i];
if(carga+(Number(p.tartas)||0)>obj && grupos.length<k-1 && act.length){ grupos.push(act); act=[]; carga=0; }
act.push(p); carga+=(Number(p.tartas)||0); }
if(act.length) grupos.push(act); while(grupos.length<k) grupos.push([]); return grupos; }
function _repEvaluar(ped,k){ var grupos=_repParticionar(ped,k), rutas=[];
for(var g=0; g<grupos.length; g++){ if(!grupos[g].length) continue;
var seq=_repSecuenciar(grupos[g]), km=_repLargo(seq);
var dur=km/REP_PARAMS.velKmh60 + seq.lengthREP_PARAMS.minServicio;
var tartas=grupos[g].reduce(function(s,p){return s+(Number(p.tartas)||0);},0);
rutas.push({ seq:seq, km:km, dur:dur, tartas:tartas, paradas:seq.length,
excCap:Math.max(0,tartas-REP_PARAMS.capTartas), excJor:Math.max(0,dur-REP_PARAMS.jornadaMin) }); }
var kmT=rutas.reduce(function(s,r){return s+r.km;},0), rompe=[];
if(rutas.some(function(r){return r.excCap;})) rompe.push("capacidad");
if(rutas.some(function(r){return r.excJor;})) rompe.push("tiempo");
if(k>REP_PARAMS.choferes) rompe.push("choferes");
return { k:k, rutas:rutas, kmT:kmT, factible:rompe.length===0, rompe:rompe }; }
function _repIdeal(esc){ var f=Object.keys(esc).map(function(k){return esc[k];}).filter(function(e){return e.factible;});
if(f.length) return f.sort(function(a,b){return a.k-b.k || a.kmT-b.kmT;})[0];
return Object.keys(esc).map(function(k){return esc[k];}).sort(function(a,b){return a.rompe.length-b.rompe.length || a.kmT-b.kmT;})[0]; }
// -------- Persistencia --------
function _repLeerPedidos(ss){ var h=_repHojaPedidos(ss), d=h.getDataRange().getValues(), out=[];
for(var i=1;i<d.length;i++){ var r=d[i]; if(!r[0]) continue;
out.push({ id:r[0],cliente:r[1],tel:r[2],dir:r[3],zona:r[4],lat:r[5],lon:r[6],tartas:Number(r[7])||0,
detalle:r[8],monto:Number(r[9])||0,pago:r[10],estado:r[11]||"base",fechaDeseada:r[12]||"",
referencia:r[14]||"",instruccion:r[15]||"",items:_repParseItems(r[16]),envio:Number(r[17])||0 }); }
return out; }
function _repBasePool(ss){ return _repLeerPedidos(ss).filter(function(p){return p.estado==="base";}); }
function _repLeerRutas(ss){ var h=_repHojaRutas(ss), d=h.getDataRange().getValues(), out=[];
for(var i=1;i<d.length;i++){ if(!d[i][0]) continue; try{ out.push(JSON.parse(d[i][3])); }catch(e){} }
return out; }
function _repGuardarRuta(ss,ruta){ var h=_repHojaRutas(ss), d=h.getDataRange().getValues();
for(var i=1;i<d.length;i++){ if(d[i][0]===ruta.id){ h.getRange(i+1,3).setValue(ruta.estado); h.getRange(i+1,4).setValue(JSON.stringify(ruta));
if(ruta.estado==="Cerrada") h.getRange(i+1,6).setValue(new Date().toISOString()); return; } }
h.appendRow([ruta.id, ruta.fecha, ruta.estado, JSON.stringify(ruta), new Date().toISOString(), ""]); }
function _repGetRuta(ss,id){ var rs=_repLeerRutas(ss); for(var i=0;i<rs.length;i++) if(rs[i].id===id) return rs[i]; return null; }
function _repMarcarPedidoEstado(ss,id,estado,fechaDeseada){ var h=_repHojaPedidos(ss), d=h.getDataRange().getValues();
for(var i=1;i<d.length;i++){ if(d[i][0]===id){ h.getRange(i+1,12).setValue(estado); if(fechaDeseada!==undefined) h.getRange(i+1,13).setValue(fechaDeseada); return; } } }
// -------- Estado completo para el frontend --------
function repartoEstado(body, sesion){
var ss=SpreadsheetApp.getActiveSpreadsheet();
return { ok:true, params:REP_PARAMS, depot:REP_DEPOT, base:_repBasePool(ss), rutas:_repLeerRutas(ss), pedidosTodos:_repLeerPedidos(ss) };
}
// (punto 1) Geocodificar una dirección ANTES de guardar el pedido, para confirmarla en el mapa.
function repartoGeocode(body, sesion){
var dir = (body && body.dir) ? String(body.dir) : "";
if(!dir) return { ok:true, found:false };
var coord = _repGeocode(dir);
if(coord) return { ok:true, found:true, lat:coord[0], lon:coord[1] };
return { ok:true, found:false };
}
// -------- Captura de pedidos --------
function repartoAddPedido(body, sesion){
var ss = SpreadsheetApp.getActiveSpreadsheet(), h = _repHojaPedidos(ss);
var p  = body.pedido || {};
var id = "RPD-" + Date.now() + "-" + Math.floor(Math.random()*1000);
var monto = (Number(p.monto) > 0) ? Number(p.monto) : ((Number(p.tartas)||0) * REP_PRECIO_TARTA);
// (Adecuacion 1) Envio: 1 por pedido. Gratis si el subtotal de tartas >= $1,500.
var _envio = (monto >= 1500) ? 0 : (Number(p.envio) || 0);
// 1) GUARDAR primero -- esto NO depende de Maps, asi que nunca se bloquea.
//    FIX-TZ (punto 9): 'creado' en hora CDMX (antes ISO/UTC). + campos nuevos: fechaDeseada(7), referencia, instruccion, items.
h.appendRow([ id, p.cliente||"", p.tel||"", p.dir||"", p.zona||"", "", "", Number(p.tartas)||1,
p.detalle||"", monto, p.pago||"Tarjeta", "base", p.fechaDeseada||"",
Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd'T'HH:mm:ss"),
p.referencia||"", p.instruccion||"", JSON.stringify(p.items||[]), _envio ]);
SpreadsheetApp.flush();
// 2) Coordenadas: (punto 1) si el frontend ya las verificó en el mapa las usamos; si no, geocodifica best-effort.
var geo = false, coord = null;
if (p.lat != null && p.lon != null && p.lat !== "" && p.lon !== "" && !isNaN(Number(p.lat)) && !isNaN(Number(p.lon))) {
coord = [Number(p.lat), Number(p.lon)];
} else {
try { coord = _repGeocode(p.dir||""); } catch(e) {}
}
if (coord) {
var d = h.getDataRange().getValues();
for (var i = d.length-1; i >= 1; i--) {
if (d[i][0] === id) {
h.getRange(i+1, 6).setValue(coord[0]);  // col 6 = lat
h.getRange(i+1, 7).setValue(coord[1]);  // col 7 = lon
geo = true;
break;
}
}
}
return { ok:true, id:id, geocodificado: geo };
}
function repartoDelPedido(body, sesion){ var ss=SpreadsheetApp.getActiveSpreadsheet(), h=_repHojaPedidos(ss), d=h.getDataRange().getValues();
for(var i=1;i<d.length;i++){ if(d[i][0]===body.id){ h.deleteRow(i+1); return {ok:true}; } } return {ok:false,error:"No encontrado"}; }
// -------- Proponer (escenarios) --------
function repartoProponer(body, sesion){
var ss=SpreadsheetApp.getActiveSpreadsheet(), base=_repBasePool(ss).filter(function(p){return p.lat&&p.lon;});
if(!base.length) return { ok:false, error:"No hay pedidos geocodificados en la base." };
var baseEval=_repBaseConPolanco(base, body);   // (punto 2) incluye local Polanco si se pidió
var esc={}; [1,2,3,4].forEach(function(k){ esc[k]=_repEvaluar(baseEval,k); });
return { ok:true, escenarios:esc, ideal:_repIdeal(esc) };
}
// -------- Planear (fija ruta, saca pedidos de la base) --------
function repartoPlanear(body, sesion){
var ss=SpreadsheetApp.getActiveSpreadsheet(), base=_repBasePool(ss).filter(function(p){return p.lat&&p.lon;});
if(!base.length) return { ok:false, error:"Base vacía." };
var k=Number(body.k)||1, fecha=body.fecha||Utilities.formatDate(new Date(),TZ_MX,"yyyy-MM-dd");
var baseEval=_repBaseConPolanco(base, body);   // (punto 2) incluye local Polanco si se pidió
var e=_repEvaluar(baseEval,k);
var choferes=e.rutas.map(function(r,i){ return { idx:i+1, nombre:"",
stops:r.seq.map(function(p){ return { id:p.id, cliente:p.cliente, dir:p.dir, tel:p.tel, zona:p.zona, lat:p.lat, lon:p.lon,
tartas:p.tartas, detalle:p.detalle, monto:p.monto, envio:p.envio||0, canal:"Ruta", esLocal:p.esLocal||false,
referencia:p.referencia||"", instruccion:p.instruccion||"", items:p.items||[],
formaPago:(["Tarjeta","Efectivo","Transferencia"].indexOf(p.pago)>=0?p.pago:(p.pago==="Cobra chofer"?"Efectivo":"Tarjeta")),
pagadoPrevio:(p.pago==="Pagado"),
confirmado:(p.pago==="Pagado"), entregado:false, horaEntrega:"", resultado:"", reprogramado:false, ventaId:"" }; }) }; });
// (punto 2) Polanco como primera parada: mueve la parada del local al inicio de la ruta 1
if(body && body.incluirPolanco && body.polancoPrimero && choferes.length){
var localStop=null;
choferes.forEach(function(c){ for(var j=0;j<c.stops.length;j++){ if(c.stops[j].esLocal){ localStop=c.stops.splice(j,1)[0]; break; } } });
if(localStop) choferes[0].stops.unshift(localStop);
}
var ruta={ id:"RRT-"+Date.now(), fecha:fecha, estado:"Planeada", k:e.k, factible:e.factible, rompe:e.rompe,
kmT:e.kmT, choferes:choferes, efectivoRecibido:"" };
_repGuardarRuta(ss,ruta);
base.forEach(function(p){ _repMarcarPedidoEstado(ss,p.id,"planeado"); }); // solo pedidos reales (el local no es fila)
return { ok:true, ruta:ruta };
}
function repartoSetChofer(body, sesion){ var ss=SpreadsheetApp.getActiveSpreadsheet(), r=_repGetRuta(ss,body.id);
if(!r) return {ok:false}; r.choferes[body.ci].nombre=body.nombre||""; _repGuardarRuta(ss,r); return {ok:true}; }
// -------- Operación del chofer / admin --------
function repartoSetResultado(body, sesion){ var ss=SpreadsheetApp.getActiveSpreadsheet(), r=_repGetRuta(ss,body.id);
if(!r||r.estado==="Cerrada") return {ok:false,error:"Ruta no editable"}; var s=r.choferes[body.ci].stops[body.si];
if(r.estado==="Planeada"&&body.resultado) r.estado="En ruta"; s.resultado=body.resultado;
if(body.formaPago) s.formaPago=body.formaPago;
if(body.resultado==="entregada"){ s.entregado=true; s.confirmado=true; s.horaEntrega=Utilities.formatDate(new Date(),TZ_MX,"HH:mm"); }
else { s.entregado=false; s.horaEntrega=""; if(!s.pagadoPrevio) s.confirmado=false; }
_repGuardarRuta(ss,r); return {ok:true, ruta:r}; }
function repartoSetFormaPago(body, sesion){ var ss=SpreadsheetApp.getActiveSpreadsheet(), r=_repGetRuta(ss,body.id);
if(!r||r.estado==="Cerrada") return {ok:false}; var s=r.choferes[body.ci].stops[body.si]; s.formaPago=body.formaPago; _repGuardarRuta(ss,r); return {ok:true}; }
function repartoSetEfectivo(body, sesion){ var ss=SpreadsheetApp.getActiveSpreadsheet(), r=_repGetRuta(ss,body.id);
if(!r) return {ok:false}; r.efectivoRecibido=(body.valor===""?"":Number(body.valor)); _repGuardarRuta(ss,r); return {ok:true}; }
function _repAllStops(r){ return r.choferes.reduce(function(a,c){return a.concat(c.stops);},[]); }
function _repEfectivoEsperado(r){ return _repAllStops(r).filter(function(s){return s.resultado==="entregada"&&!s.pagadoPrevio&&s.formaPago==="Efectivo";}).reduce(function(a,s){return a+(Number(s.monto)||0)+(Number(s.envio)||0);},0); }
// -------- Cerrar ruta: registra cada entrega como venta canal "Ruta" --------
function repartoCerrarRuta(body, sesion){
var ss=SpreadsheetApp.getActiveSpreadsheet(), r=_repGetRuta(ss,body.id);
if(!r) return {ok:false,error:"Ruta no encontrada"};
var stops=_repAllStops(r);
if(!stops.every(function(s){return s.esLocal||!!s.resultado;})) return {ok:false,error:"Faltan paradas por resolver."};
if(!stops.every(function(s){return s.esLocal||s.resultado!=="entregada"||s.confirmado;})) return {ok:false,error:"Faltan pagos por confirmar."};
var ef=_repEfectivoEsperado(r);
if(ef>0 && (r.efectivoRecibido===""||r.efectivoRecibido===undefined||r.efectivoRecibido===null)) return {ok:false,error:"Captura el efectivo recibido para conciliar."};
// Registrar ventas de las entregas (reutiliza registrarVenta — inventario, P&L, historial)
var errores=[];
r.choferes.forEach(function(c){ c.stops.forEach(function(s){
if(s.esLocal) return;   // (punto 2) el local Polanco es parada logística, no venta
if(s.resultado==="entregada" && !s.ventaId){
var lineas;
if(s.items && s.items.length){
// Registrar cada tarta con su sabor/tamaño exacto del catálogo
lineas = s.items.map(function(it){ return { sabor:it.sabor, tamano:it.tamano,
cantidad: Number(it.cantidad)||1,
precioUnitario: (Number(it.precio)>0 ? Number(it.precio) : ((Number(s.monto)/(Number(s.tartas)||1))||REP_PRECIO_TARTA)) }; });
} else {
// Compat. con pedidos viejos sin items estructurados
lineas = [{ sabor:(s.sabor||_repSaborDeDetalle(s.detalle)||"Frutos Rojos"), tamano:(s.tamano||"Mediana"),
cantidad: Number(s.tartas)||1, precioUnitario: (Number(s.monto)/(Number(s.tartas)||1))||REP_PRECIO_TARTA }];
}
lineas.forEach(function(_ln){ try{ invLiberar(ss,_ln.sabor,_ln.tamano,"Cuajimalpa",Number(_ln.cantidad)||1,"ruta",(r.id||"ruta"),sesion.usuario); }catch(_e){ try{ registrarAuditoria(sesion.usuario,sesion.rol,"LIBERA_FAIL","Ruta "+(r.id||"?")+" | "+_ln.sabor+" "+_ln.tamano+": "+(_e&&_e.message?_e.message:_e)); }catch(_e2){} } });
var resV = registrarVenta({ items:lineas, canal:"Ruta", metodoPago: s.formaPago||"Efectivo", envio: Number(s.envio)||0,
cliente:{ nombre:s.cliente||"Cliente ruta", telefono:s.tel||"" }, sucursal:"Cuajimalpa" }, sesion);
if(resV && resV.ok){ s.ventaId = resV.idVenta || resV.id || "OK"; } else { errores.push((s.cliente||s.id)+": "+(resV&&resV.error||"error")); }
}
}); });
if(errores.length){ _repGuardarRuta(ss,r); return {ok:false, error:"Algunas ventas no se registraron: "+errores.join(" · "), parcial:true }; }
r.estado="Cerrada"; _repGuardarRuta(ss,r);
return {ok:true, mensaje:"✅ Ruta cerrada y ventas registradas (canal Ruta).", ruta:r};
}
function _repSaborDeDetalle(det){ if(!det) return null; det=String(det);
var sab=["Frutos Rojos","Clásica","Queso","Chocolate"]; for(var i=0;i<sab.length;i++) if(det.indexOf(sab[i])>=0) return sab[i]; return null; }
// -------- Reprogramar (la admin pone la fecha; el pedido vuelve a la base) --------
function repartoReprogramar(body, sesion){
var ss=SpreadsheetApp.getActiveSpreadsheet(), r=_repGetRuta(ss,body.id);
if(!r) return {ok:false}; var s=r.choferes[body.ci].stops[body.si];
if(!body.fecha) return {ok:false,error:"La administradora debe definir la nueva fecha."};
var h=_repHojaPedidos(ss), id="RPD-"+Date.now()+"-"+Math.floor(Math.random()*1000);
h.appendRow([id, s.cliente, s.tel, s.dir, s.zona, s.lat, s.lon, s.tartas, s.detalle, s.monto,
(s.pagadoPrevio?"Pagado":(s.formaPago||"Tarjeta")), "base", body.fecha,
Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd'T'HH:mm:ss"),
s.referencia||"", s.instruccion||"", JSON.stringify(s.items||[]), s.envio||0]);
s.reprogramado=true; s.reprogramadoA=body.fecha; _repGuardarRuta(ss,r);
return {ok:true, nuevoId:id};
}
function repartoDelRuta(body, sesion){ var ss=SpreadsheetApp.getActiveSpreadsheet(), h=_repHojaRutas(ss), d=h.getDataRange().getValues();
for(var i=1;i<d.length;i++){ if(d[i][0]===body.id){
// Al eliminar la ruta, los pedidos NO entregados regresan a la base (re-planeables); no quedan huerfanos en "planeado".
try{ var r=JSON.parse(d[i][3]); (r.choferes||[]).forEach(function(c){ (c.stops||[]).forEach(function(s){ if(s.id && !s.esLocal && s.resultado!=="entregada") _repMarcarPedidoEstado(ss,s.id,"base"); }); }); }catch(e){}
h.deleteRow(i+1); return {ok:true}; } } return {ok:false}; }
// Libera UNA tarta apartada para ruta: la quita de su ruta (si esta planeada) y marca el
// pedido como "liberado" para que deje de reservar inventario. Funciona SIEMPRE (base o
// planeado), aun despues de fijada la ruta o cocinada la tarta. No toca stock fisico: la
// tarta cocinada simplemente vuelve a contar como disponible (neto) al soltar la reserva.
function repartoLiberar(body, sesion){
var ss=SpreadsheetApp.getActiveSpreadsheet();
var pedidoId = body.pedidoId || body.id || "";
var quitadas = 0;
if(body.rutaId && body.ci!=null && body.si!=null){
var r=_repGetRuta(ss, body.rutaId);
if(r && r.estado!=="Cerrada" && r.choferes[body.ci] && r.choferes[body.ci].stops[body.si]){
var st=r.choferes[body.ci].stops[body.si];
if(st.resultado==="entregada") return {ok:false, error:"Esa parada ya se entrego/registro como venta. Para revertirla usa Anular en Ventas."};
if(!pedidoId) pedidoId=st.id||"";
r.choferes[body.ci].stops.splice(body.si,1);
_repGuardarRuta(ss,r); quitadas++;
}
} else if(pedidoId){
var rutas=_repLeerRutas(ss);
for(var ri=0;ri<rutas.length;ri++){ var rr=rutas[ri]; if(rr.estado==="Cerrada") continue; var ch=false;
for(var ci=0;ci<rr.choferes.length;ci++){ var stops=rr.choferes[ci].stops;
for(var si=stops.length-1;si>=0;si--){ if(stops[si].id===pedidoId){
if(stops[si].resultado==="entregada") return {ok:false, error:"Esa parada ya se entrego/registro como venta. Usa Anular en Ventas."};
stops.splice(si,1); ch=true; quitadas++; } } }
if(ch) _repGuardarRuta(ss,rr); }
}
if(pedidoId) _repMarcarPedidoEstado(ss, pedidoId, "liberado");
if(!pedidoId && !quitadas) return {ok:false, error:"No se encontro el pedido a liberar."};
return {ok:true, mensaje:"Tarta liberada — vuelve a inventario disponible.", quitadas:quitadas};
}

function TEST_addPedido(){
var r = repartoAddPedido({ pedido:{ cliente:"PRUEBA", tel:"55", dir:"Polanco", zona:"Polanco", tartas:1, monto:0, detalle:"x", pago:"Cobra chofer" }}, {ok:true});
Logger.log(JSON.stringify(r));
}
/* =================================================================================
ADECUACIONES REPARTO (envio / apartados / senal cocina / inventario neto)
================================================================================= */
function _ensureColVentas(ss, name){
var h = ss.getSheetByName("Ventas"); if(!h) return;
var lastCol = h.getLastColumn();
var headers = h.getRange(1,1,1,lastCol).getValues()[0];
if(headers.indexOf(name) !== -1) return;
h.getRange(1, lastCol+1).setValue(name);
}
function _repSeedZonasEnvio(ss){
// Idempotente: agrega SOLO las zonas canonicas que falten (por ID). Asi un redeploy +
// repartoSetup() agrega la zona nueva ($150) sin duplicar ni tocar las existentes.
var h = ensureHojaZonasEnvio(ss);
var d = h.getDataRange().getValues();
var existentes = {};
for(var i=1;i<d.length;i++){ if(d[i][0]) existentes[d[i][0]] = true; }
var ahora = new Date().toISOString();
var zonas = [
["ZNV-50","$50 (Poniente)","Bosques de las Lomas, Interlomas, Tecamachalco, Santa Fe, Cuajimalpa, Lomas de Chapultepec, Bosque Real, Lomas Country Club, Herradura",50,true,ahora],
["ZNV-80","$80 (Centro)","Polanco, Las Aguilas, Irrigacion, Condesa, Roma, Napoles, Narvarte, Del Valle, Pedregal",80,true,ahora],
["ZNV-100","$100 (Lejano)","Satelite, Coyoacan, Reforma Centro (hasta el Angel)",100,true,ahora],
["ZNV-150","$150 (Muy lejano)","Zonas muy lejanas / fuera de la cobertura habitual (mas de ~25 km de Cuajimalpa)",150,true,ahora]
];
zonas.forEach(function(z){ if(!existentes[z[0]]) h.appendRow(z); });
}
function _reservasPorSkuSep(ss){
var out = {};
function ensure(k){ if(!out[k]) out[k]={ruta:0, apartado:0}; return out[k]; }
try {
var peds = _repLeerPedidos(ss);
for (var i=0;i<peds.length;i++){
var p = peds[i];
if (p.estado!=="base" && p.estado!=="planeado") continue;
var its = p.items || [];
for (var j=0;j<its.length;j++){
var it = its[j];
if(!it || !it.sabor || !it.tamano) continue;
ensure("Cuajimalpa|"+it.sabor+"|"+it.tamano).ruta += (Number(it.cantidad)||0);
}
}
} catch(e){}
try {
var hV = ss.getSheetByName("Ventas");
if (hV){
var dV = hV.getDataRange().getValues();
var hd = dV[0]||[];
var iTipo = hd.indexOf("tipo_op"), iAnul = hd.indexOf("estado_anul");
for (var r=1;r<dV.length;r++){
var row = dV[r];
if(!row[0]) continue;
if(iTipo!==-1 && row[iTipo]!=="Reservado") continue;
if(iAnul!==-1 && row[iAnul]==="ANULADO") continue;
if(row[9]!=="Apartado") continue;
ensure(row[3]+"|"+row[4]+"|"+row[5]).apartado += (Number(row[6])||0);
}
}
} catch(e){}
return out;
}
function _reservasPorSku(ss){
var out = {};
try {
var peds = _repLeerPedidos(ss);
for (var i=0;i<peds.length;i++){
var p = peds[i];
if (p.estado!=="base" && p.estado!=="planeado") continue;
var its = p.items || [];
for (var j=0;j<its.length;j++){
var it = its[j];
if(!it || !it.sabor || !it.tamano) continue;
var k = "Cuajimalpa|"+it.sabor+"|"+it.tamano;
out[k] = (out[k]||0) + (Number(it.cantidad)||0);
}
}
} catch(e){}
try {
var hV = ss.getSheetByName("Ventas");
if (hV){
var dV = hV.getDataRange().getValues();
var hd = dV[0]||[];
var iTipo = hd.indexOf("tipo_op"), iAnul = hd.indexOf("estado_anul");
for (var r=1;r<dV.length;r++){
var row = dV[r];
if(!row[0]) continue;
if(iTipo!==-1 && row[iTipo]!=="Reservado") continue;
if(iAnul!==-1 && row[iAnul]==="ANULADO") continue;
if(row[9]!=="Apartado") continue;
var k2 = row[3]+"|"+row[4]+"|"+row[5];
out[k2] = (out[k2]||0) + (Number(row[6])||0);
}
}
} catch(e){}
return out;
}
function getApartados(body, sesion){
var ss = SpreadsheetApp.getActiveSpreadsheet();
var h = ss.getSheetByName("Ventas");
if(!h) return { ok:true, apartados:[] };
var headers = h.getRange(1,1,1,h.getLastColumn()).getValues()[0];
var datos = h.getDataRange().getValues();
var iTipo = headers.indexOf("tipo_op"), iAnul = headers.indexOf("estado_anul"),
iAnt = headers.indexOf("anticipo_reserva"), iFe = headers.indexOf("fecha_entrega");
if(iTipo===-1) return { ok:true, apartados:[] };
var perm = getPermisos(sesion.rol);
var sucU = perm.puedeVerAmbas ? null : getSucursalUsuario(sesion.usuario);
var grupos = {};
for(var i=1;i<datos.length;i++){
var r = datos[i];
if(r[iTipo]!=="Reservado") continue;
if(r[9]!=="Apartado") continue;
if(iAnul!==-1 && r[iAnul]==="ANULADO") continue;
if(sucU && r[3]!==sucU) continue;
var id=r[0];
if(!grupos[id]){
grupos[id]={ idVenta:id,
fecha: r[1] instanceof Date ? Utilities.formatDate(r[1], TZ_MX, "yyyy-MM-dd'T'HH:mm:ss") : r[1],
fechaEntrega: iFe!==-1 ? (r[iFe] instanceof Date ? Utilities.formatDate(r[iFe], TZ_MX, "yyyy-MM-dd") : (r[iFe]||"")) : "",
usuario:r[2], sucursal:r[3], metodoPago:r[10], clienteId:r[11], clienteNombre:r[12],
anticipo: iAnt!==-1 ? (Number(r[iAnt])||0) : 0, notas:r[14], items:[], total:0 };
}
grupos[id].items.push({ sabor:r[4], tamano:r[5], cantidad:Number(r[6]), precio:Number(r[7]), subtotal:Number(r[8]) });
grupos[id].total += Number(r[8]);
}
var apartados = Object.keys(grupos).map(function(k){return grupos[k];}).sort(function(a,b){
return String(a.fechaEntrega||"9999").localeCompare(String(b.fechaEntrega||"9999")); });
return { ok:true, apartados:apartados };
}
function getProduccionManana(body, sesion){
var ss = SpreadsheetApp.getActiveSpreadsheet();
var tz = TZ_MX;
var target = (body && body.fecha) ? String(body.fecha).substring(0,10)
: Utilities.formatDate(new Date(new Date().getTime()+86400000), tz, "yyyy-MM-dd");
var acc = {};
var detalle = [];
function add(sabor,tamano,cant,motivo,quien){
if(!sabor||!tamano||!(cant>0)) return;
var k=sabor+"|"+tamano;
if(!acc[k]) acc[k]={sabor:sabor,tamano:tamano,cantidad:0,ruta:0,apartado:0};
acc[k].cantidad+=cant;
if(motivo==="Ruta") acc[k].ruta+=cant; else acc[k].apartado+=cant;
detalle.push({motivo:motivo, quien:quien||"", sabor:sabor, tamano:tamano, cantidad:cant});
}
try {
var peds=_repLeerPedidos(ss);
for(var i=0;i<peds.length;i++){ var p=peds[i];
if(p.estado==="Cerrada"||p.estado==="cerrado"||p.estado==="liberado"||p.estado==="cancelado") continue;
if(String(p.fechaDeseada).substring(0,10)!==target) continue;
var its=p.items||[];
for(var j=0;j<its.length;j++) add(its[j].sabor,its[j].tamano,Number(its[j].cantidad)||0,"Ruta",p.cliente);
}
} catch(e){}
try {
var hV=ss.getSheetByName("Ventas");
if(hV){ var dV=hV.getDataRange().getValues(), hd=dV[0]||[];
var iTipo=hd.indexOf("tipo_op"), iAnul=hd.indexOf("estado_anul"), iFe=hd.indexOf("fecha_entrega");
for(var r=1;r<dV.length;r++){ var row=dV[r]; if(!row[0])continue;
if(iTipo!==-1&&row[iTipo]!=="Reservado")continue;
if(row[9]!=="Apartado")continue;
if(iAnul!==-1&&row[iAnul]==="ANULADO")continue;
var fe = iFe!==-1 ? row[iFe] : "";
var feStr = fe instanceof Date ? Utilities.formatDate(fe,tz,"yyyy-MM-dd") : String(fe).substring(0,10);
if(feStr!==target)continue;
add(row[4],row[5],Number(row[6])||0,"Apartado",row[12]||"");
}
}
} catch(e){}
var items=Object.keys(acc).map(function(k){return acc[k];}).sort(function(a,b){
return a.sabor===b.sabor ? String(a.tamano).localeCompare(String(b.tamano)) : String(a.sabor).localeCompare(String(b.sabor)); });
var totalTartas=items.reduce(function(s,x){return s+x.cantidad;},0);
return { ok:true, fecha:target, items:items, detalle:detalle, totalTartas:totalTartas };
}
function repNotificarProduccionManana(){
var ss=SpreadsheetApp.getActiveSpreadsheet();
var res=getProduccionManana({}, {usuario:"sistema", rol:"Owner"});
if(!res.ok || !res.items.length) return;
var lineas=res.items.map(function(x){
var mot=[]; if(x.ruta) mot.push("ruta:"+x.ruta); if(x.apartado) mot.push("apartado:"+x.apartado);
return "- "+x.cantidad+"x "+x.sabor+" "+x.tamano+" ("+mot.join(", ")+")";
}).join("\n");
var cuerpo="Para entregar el "+res.fecha+" - hornear hoy ("+res.totalTartas+" tartas):\n"+lineas;
var h=ensureHojaMensajes(ss);
h.appendRow(["MSG-"+Date.now(),"Sistema","todos","Produccion para manana (ruta + apartados)",cuerpo,"produccion_reparto",false,new Date().toISOString()]);
}
function repInstalarTriggerProduccion(){
var ya=ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==="repNotificarProduccionManana";});
if(ya) return {ok:true, mensaje:"Trigger de produccion ya estaba instalado."};
ScriptApp.newTrigger("repNotificarProduccionManana").timeBased().atHour(18).everyDays(1).create();
return {ok:true, mensaje:"Trigger diario 18:00 (produccion para manana) instalado."};
}

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