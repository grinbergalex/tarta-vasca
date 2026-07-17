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


