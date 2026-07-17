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
