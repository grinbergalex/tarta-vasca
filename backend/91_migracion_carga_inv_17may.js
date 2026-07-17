/**
 * TARTA VASCA — Carga masiva de producción
 * Fecha producción: 17 de mayo de 2026 (hoy)
 * Caducidad: +4 días según VIDA_UTIL_DIAS
 *
 * SUCURSAL POR DEFECTO: Cuajimalpa
 * (Si necesitas Polanco, cambia la constante SUCURSAL_DEFAULT abajo)
 *
 * USO:
 * 1. Apps Script editor → pega esta función al final del .gs
 *    (o en un archivo separado dentro del mismo proyecto)
 * 2. Selecciona la función `cargarProduccion17May2026` del dropdown
 * 3. Click ▶ Ejecutar
 * 4. Te muestra preview con TODO antes de cargar — das YES para confirmar
 * 5. Carga los 4 items uno por uno
 *
 * NOTA: "Guayabrie" sólo existe en Cuajimalpa según el catálogo histórico.
 * Si la quieres en Polanco, primero agrégala al catálogo.
 */

function cargarProduccion17May2026() {
  const SUCURSAL_DEFAULT = "Cuajimalpa";   // ← cámbialo a "Polanco" si fue ahí

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // ── ITEMS A CARGAR ──
  const items = [
    { sucursal: SUCURSAL_DEFAULT, sabor: "Queso",     tamano: "Individual", cantidad: 12 },
    { sucursal: SUCURSAL_DEFAULT, sabor: "Limón",     tamano: "Individual", cantidad: 12 },
    { sucursal: SUCURSAL_DEFAULT, sabor: "Guayabrie", tamano: "Individual", cantidad: 12 },
    { sucursal: SUCURSAL_DEFAULT, sabor: "Lotus",     tamano: "Individual", cantidad: 4  }
  ];

  // ── 1. Leer catálogo activo ──
  const hCat = ss.getSheetByName("Catálogo");
  if (!hCat) { ui.alert("❌ No encuentro hoja 'Catálogo'."); return; }
  const datosCat = hCat.getDataRange().getValues();
  const saboresCat = [], tamanosCat = [], sucursalesCat = [];
  for (let i = 1; i < datosCat.length; i++) {
    const [tipo, nombre, activo] = datosCat[i];
    if (!tipo || !nombre) continue;
    if (activo !== "TRUE" && activo !== true) continue;
    if (tipo === "Sabor") saboresCat.push(nombre);
    else if (tipo === "Tamaño") tamanosCat.push(nombre);
    else if (tipo === "Sucursal") sucursalesCat.push(nombre);
  }

  // ── 2. Fuzzy match ──
  function norm(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  }
  function fuzzy(input, candidatos) {
    const ni = norm(input);
    for (const c of candidatos) if (norm(c) === ni) return c;
    for (const c of candidatos) {
      const nc = norm(c);
      if (nc.includes(ni) || ni.includes(nc)) return c;
    }
    const niFirst = ni.split(" ")[0];
    for (const c of candidatos) {
      if (norm(c).split(" ")[0] === niFirst) return c;
    }
    return null;
  }

  // ── 3. Validar ──
  const validados = items.map(it => ({
    ...it,
    saborResuelto:    fuzzy(it.sabor,    saboresCat),
    tamanoResuelto:   fuzzy(it.tamano,   tamanosCat),
    sucursalResuelta: fuzzy(it.sucursal, sucursalesCat)
  }));

  const sinMatch = validados.filter(v => !v.saborResuelto || !v.tamanoResuelto || !v.sucursalResuelta);
  if (sinMatch.length > 0) {
    let msg = "❌ Items sin match en el catálogo (NO se cargó nada):\n\n";
    sinMatch.forEach(v => {
      const faltan = [];
      if (!v.saborResuelto)    faltan.push("sabor '" + v.sabor + "'");
      if (!v.tamanoResuelto)   faltan.push("tamaño '" + v.tamano + "'");
      if (!v.sucursalResuelta) faltan.push("sucursal '" + v.sucursal + "'");
      msg += "• " + v.sucursal + " " + v.sabor + " " + v.tamano + " ×" + v.cantidad + " → falta: " + faltan.join(", ") + "\n";
    });
    msg += "\nAgrega lo faltante al Catálogo y vuelve a correr.";
    ui.alert(msg);
    return;
  }

  // ── 4. Preview ──
  let preview = "Carga masiva PRODUCCIÓN — preview:\n\n";
  let totalPiezas = 0;
  validados.forEach(v => {
    preview += v.sucursalResuelta + " · " + v.saborResuelto + " " + v.tamanoResuelto + " ×" + v.cantidad + "\n";
    totalPiezas += v.cantidad;
  });
  preview += "\nTotal: " + validados.length + " cargas, " + totalPiezas + " piezas.\n¿Continuar?";

  const resp = ui.alert("Carga producción 17-may-2026", preview, ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) {
    ui.alert("❌ Cancelado.");
    return;
  }

  // ── 5. Ejecutar ──
  const sesionFake = { usuario: "alex", rol: "Owner" };
  let exitos = 0;
  const errores = [];

  validados.forEach(v => {
    try {
      const res = altaProduccion({
        sabor:    v.saborResuelto,
        tamano:   v.tamanoResuelto,
        sucursal: v.sucursalResuelta,
        cantidad: v.cantidad
      }, sesionFake);
      if (res && res.ok) {
        exitos++;
      } else {
        errores.push(v.sucursalResuelta + " " + v.saborResuelto + " " + v.tamanoResuelto + ": " + (res ? res.error : "sin respuesta"));
      }
      Utilities.sleep(100);
    } catch (e) {
      errores.push(v.sucursalResuelta + " " + v.saborResuelto + " " + v.tamanoResuelto + ": " + e.message);
    }
  });

  // ── 6. Reporte ──
  let final = "✅ Carga completa.\n\nÉxitos: " + exitos + " / " + validados.length;
  if (errores.length > 0) {
    final += "\n\n❌ Errores (" + errores.length + "):\n" + errores.map(e => "• " + e).join("\n");
  }
  ui.alert("Resultado", final, ui.ButtonSet.OK);
}