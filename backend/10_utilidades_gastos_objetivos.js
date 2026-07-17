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
