/**
 * setupPreciosFinales — correr UNA VEZ desde el editor.
 *
 * Aplica los precios DEFINITIVOS:
 *
 * BASE (Tienda, Domicilio, Uber Eats, etc.):
 *   Individual = $210
 *   Mediana    = $390
 *   Grande     = $690
 *
 * RAPPI (override fijo por canal):
 *   Individual = $230
 *   Mediana    = $420
 *   Grande     = $720
 *
 * Después del script, los paquetes 3 y 4 los maneja el backend según el canal:
 *   Paquete 3:  $590 base · $630 Rappi
 *   Paquete 4:  $720 base · $760 Rappi
 *
 * Logger.log muestra todo lo que cambió. Si se ejecuta dos veces, no hace nada porque detecta sin cambios.
 */
function setupPreciosFinales() {
  const PRECIOS_BASE  = { "Individual": 210, "Mediana": 390, "Grande": 690 };
  const PRECIOS_RAPPI = { "Individual": 230, "Mediana": 420, "Grande": 720 };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName("Precios");
  if (!hoja) { Logger.log("❌ No existe la hoja Precios"); return { ok: false }; }
  const datos = hoja.getDataRange().getValues();
  const ahora = new Date();
  let cambiosBase = 0, cambiosRappi = 0, agregadosRappi = 0;

  Logger.log("=== Iniciando setup de precios finales ===");

  // 1) Actualizar precios BASE (sin canal específico)
  for (let i = 1; i < datos.length; i++) {
    const [sabor, tamano, precioActual, , , , canal] = datos[i];
    if (!sabor || !tamano) continue;
    if (canal && canal !== "_BASE_" && canal !== "") continue; // saltar precios por canal
    const nuevoPrecio = PRECIOS_BASE[tamano];
    if (nuevoPrecio === undefined) continue; // tamaño desconocido (Mini, etc.)
    if (Number(precioActual) === nuevoPrecio) continue;
    hoja.getRange(i+1, 3).setValue(nuevoPrecio);
    hoja.getRange(i+1, 4).setValue(ahora);
    hoja.getRange(i+1, 5).setValue("setup-precios-finales");
    hoja.getRange(i+1, 6).setValue(ahora);
    Logger.log(`  ✓ BASE ${sabor} ${tamano}: $${precioActual} → $${nuevoPrecio}`);
    cambiosBase++;
  }

  // 2) Crear/actualizar overrides para canal RAPPI (sabor vacío = aplica a todos los sabores)
  const datosActualizados = hoja.getDataRange().getValues();
  const tamanos = Object.keys(PRECIOS_RAPPI);
  for (const tamano of tamanos) {
    const precio = PRECIOS_RAPPI[tamano];
    let encontrada = false;
    for (let i = 1; i < datosActualizados.length; i++) {
      const r = datosActualizados[i];
      const dSabor = r[0], dTamano = r[1], dCanal = r[6] || "";
      // Override de Rappi: sin sabor específico (o "_GLOBAL_") + tamaño coincide + canal = Rappi
      if ((dSabor === "" || dSabor === "_GLOBAL_") && dTamano === tamano && dCanal === "Rappi") {
        encontrada = true;
        if (Number(r[2]) !== precio) {
          hoja.getRange(i+1, 3).setValue(precio);
          hoja.getRange(i+1, 4).setValue(ahora);
          hoja.getRange(i+1, 5).setValue("setup-precios-finales");
          hoja.getRange(i+1, 6).setValue(ahora);
          Logger.log(`  ✓ RAPPI ${tamano}: $${r[2]} → $${precio}`);
          cambiosRappi++;
        }
        break;
      }
    }
    if (!encontrada) {
      // Estructura: Sabor, Tamaño, Precio, VigenteDesde, ModificadoPor, FechaMod, Canal
      hoja.appendRow(["_GLOBAL_", tamano, precio, ahora, "setup-precios-finales", ahora, "Rappi"]);
      Logger.log(`  + RAPPI ${tamano}: $${precio} (nuevo override)`);
      agregadosRappi++;
    }
  }

  Logger.log("\n=== Resumen ===");
  Logger.log(`Precios BASE actualizados:    ${cambiosBase}`);
  Logger.log(`Precios RAPPI actualizados:   ${cambiosRappi}`);
  Logger.log(`Precios RAPPI agregados:      ${agregadosRappi}`);
  Logger.log("\nPaquetes (3 y 4) los maneja el backend según el canal — no requieren hoja.");

  return { ok: true, cambiosBase, cambiosRappi, agregadosRappi };
}
