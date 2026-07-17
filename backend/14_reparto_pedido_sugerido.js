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

