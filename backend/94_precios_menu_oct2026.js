/**
 * Precios y menú de octubre 2026 — correr UNA VEZ desde el editor.
 *
 * aplicarPreciosOct2026():
 *   BASE (Tienda, Domicilio, Ruta, página):  Individual $240 · Mediana $420 · Grande $720
 *   RAPPI:                                   Individual $260 · Mediana $450 · Grande $780
 *   ENVÍO: Poniente $60 · Centro $90 · Lejano $120 (mismos ID de zona)
 *
 * aplicarMenuOct2026():
 *   Deja activos en Catálogo solo los sabores del menú. Los demás quedan en
 *   Activo = FALSE (no se borra nada; se reactivan cambiando la celda).
 *
 * Las dos son idempotentes: si se corren otra vez no cambian nada.
 * Logger.log muestra cada cambio.
 */
const OCT26_PRECIOS_BASE  = { "Individual": 240, "Mediana": 420, "Grande": 720 };
const OCT26_PRECIOS_RAPPI = { "Individual": 260, "Mediana": 450, "Grande": 780 };
const OCT26_ENVIOS = {
  "ZNV-50":  { nombre: "$60 (Poniente)", costo: 60 },
  "ZNV-80":  { nombre: "$90 (Centro)",   costo: 90 },
  "ZNV-100": { nombre: "$120 (Lejano)",  costo: 120 }
};
const OCT26_MENU = ["Queso", "Gorgonzola", "Pistache", "Lotus", "Guayabrie", "Oreo", "Frutos Rojos", "Cabra & Higo"];
const OCT26_NO_SON_TARTAS = ["VELAS", "AGUA"];
const OCT26_AUTOR = "precios-oct-2026";

function aplicarPreciosOct2026() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ahora = new Date();
  const precios = _oct26ActualizarPrecios(ss.getSheetByName("Precios"), ahora);
  const envios = _oct26ActualizarEnvios(ss.getSheetByName("ZonasEnvio"), ahora);
  _velBump("pre");
  _velBump("zon");
  _utilMarcarDirty();
  Logger.log(`=== Listo: ${precios.cambiados} precios y ${envios.cambiados} envíos cambiados ===`);
  if (precios.sinTocar.length) Logger.log("Renglones de otros canales sin tocar:\n  " + precios.sinTocar.join("\n  "));
  return { ok: true, precios: precios.cambiados, envios: envios.cambiados };
}

function _oct26ActualizarPrecios(hoja, ahora) {
  const datos = hoja.getDataRange().getValues();
  let cambiados = 0;
  const sinTocar = [];
  for (let i = 1; i < datos.length; i++) {
    const [sabor, tamano, precioActual, , , , canal] = datos[i];
    if (!sabor || OCT26_PRECIOS_BASE[tamano] === undefined) continue;
    const canalTxt = String(canal || "").trim();
    let nuevo;
    if (canalTxt === "") nuevo = OCT26_PRECIOS_BASE[tamano];
    else if (canalTxt === "Rappi") nuevo = OCT26_PRECIOS_RAPPI[tamano];
    else { sinTocar.push(`${sabor} ${tamano} (${canalTxt}) $${precioActual}`); continue; }
    if (Number(precioActual) === nuevo) continue;
    hoja.getRange(i + 1, 3, 1, 4).setValues([[nuevo, ahora, OCT26_AUTOR, ahora]]);
    Logger.log(`  ✓ ${sabor} ${tamano} ${canalTxt || "base"}: $${precioActual} → $${nuevo}`);
    cambiados++;
  }
  return { cambiados, sinTocar };
}

function _oct26ActualizarEnvios(hoja, ahora) {
  const datos = hoja.getDataRange().getValues();
  let cambiados = 0;
  for (let i = 1; i < datos.length; i++) {
    const nuevo = OCT26_ENVIOS[datos[i][0]];
    if (!nuevo) continue;
    if (datos[i][1] === nuevo.nombre && Number(datos[i][3]) === nuevo.costo) continue;
    hoja.getRange(i + 1, 2).setValue(nuevo.nombre);
    hoja.getRange(i + 1, 4).setValue(nuevo.costo);
    hoja.getRange(i + 1, 6).setValue(ahora.toISOString());
    Logger.log(`  ✓ Envío ${datos[i][0]}: ${datos[i][1]} $${datos[i][3]} → ${nuevo.nombre} $${nuevo.costo}`);
    cambiados++;
  }
  return { cambiados };
}

function aplicarMenuOct2026() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Catálogo");
  const datos = hoja.getDataRange().getValues();
  let apagados = 0;
  const faltan = OCT26_MENU.filter(s => !datos.some(f => f[0] === "Sabor" && f[1] === s));
  if (faltan.length) { Logger.log("❌ No encontré en Catálogo: " + faltan.join(", ") + ". No cambié nada."); return { ok: false, faltan }; }
  for (let i = 1; i < datos.length; i++) {
    const [tipo, nombre, activo] = datos[i];
    if (tipo !== "Sabor" || OCT26_NO_SON_TARTAS.indexOf(nombre) !== -1) continue;
    const debeEstar = OCT26_MENU.indexOf(nombre) !== -1;
    const esta = activo === true || String(activo).toUpperCase() === "TRUE";
    if (esta === debeEstar) continue;
    hoja.getRange(i + 1, 3).setValue(debeEstar);
    Logger.log(`  ✓ ${nombre}: ${debeEstar ? "activado" : "apagado"}`);
    apagados++;
  }
  _velBump("cat");
  Logger.log(`=== Listo: ${apagados} sabores cambiados ===`);
  return { ok: true, cambiados: apagados };
}
