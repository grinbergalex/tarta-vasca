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
