// ============================================================================
// 96 — DIAGNOSTICO DE USO (2026-07-16, temporal)
// Correr reporteUsoSistema() desde el editor (Run) y leer el Execution log.
// Solo LEE datos — no modifica nada. Sirve para decidir qué módulos se usan
// de verdad y cuáles conviene ocultar del menú.
// ============================================================================
function reporteUsoSistema() {
  var DIAS = 90;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var corte = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000);
  var L = [];
  L.push("===== USO DEL SISTEMA — últimos " + DIAS + " días =====");

  // --- 1. Acciones registradas en Auditoría (escrituras) ---
  var hAud = ss.getSheetByName("Auditoría");
  if (hAud) {
    var aud = hAud.getDataRange().getValues();
    var porAccion = {}, ultimaVez = {}, loginsPorUsuario = {};
    for (var i = 1; i < aud.length; i++) {
      var f = new Date(aud[i][0]); if (isNaN(f.getTime())) continue;
      var acc = String(aud[i][3] || "?");
      if (!ultimaVez[acc] || f > ultimaVez[acc]) ultimaVez[acc] = f;
      if (f < corte) continue;
      porAccion[acc] = (porAccion[acc] || 0) + 1;
      if (acc === "LOGIN") {
        var u = String(aud[i][1]) + " (" + String(aud[i][2]) + ")";
        loginsPorUsuario[u] = (loginsPorUsuario[u] || 0) + 1;
      }
    }
    L.push("\n--- Acciones (veces en " + DIAS + " días | última vez) ---");
    Object.keys(ultimaVez).sort().forEach(function(acc){
      L.push("  " + acc + ": " + (porAccion[acc] || 0) + " | " +
             Utilities.formatDate(ultimaVez[acc], TZ_MX, "yyyy-MM-dd"));
    });
    L.push("\n--- Logins por usuario ---");
    Object.keys(loginsPorUsuario).sort().forEach(function(u){
      L.push("  " + u + ": " + loginsPorUsuario[u]);
    });
  }

  // --- 2. Ventas por canal y tipo (revela Rappi/Uber/Domicilio/Ruta/Apartado) ---
  var hV = ss.getSheetByName("Ventas");
  if (hV) {
    var dv = hV.getDataRange().getValues();
    var idxTipo = dv[0].indexOf("tipo_op");
    var porCanal = {}, porTipo = {};
    for (var j = 1; j < dv.length; j++) {
      var fv = new Date(dv[j][1]); if (isNaN(fv.getTime()) || fv < corte) continue;
      porCanal[String(dv[j][9] || "?")] = (porCanal[String(dv[j][9] || "?")] || 0) + 1;
      if (idxTipo !== -1) porTipo[String(dv[j][idxTipo] || "Venta")] = (porTipo[String(dv[j][idxTipo] || "Venta")] || 0) + 1;
    }
    L.push("\n--- Ventas por canal (" + DIAS + " días) ---");
    Object.keys(porCanal).sort().forEach(function(c){ L.push("  " + c + ": " + porCanal[c]); });
    L.push("--- Ventas por tipo ---");
    Object.keys(porTipo).sort().forEach(function(t){ L.push("  " + t + ": " + porTipo[t]); });
  }

  // --- 3. Hojas de módulos: filas totales (0 o pocas = módulo sin usar) ---
  var hojas = ["Objetivos","Mensajes","Notas_Creador","Gastos","Transferencias",
               "ZonasEnvio","StockLimites","Recetas","Insumos","Clientes",
               "Comisiones","Reparto","Rutas"];
  L.push("\n--- Filas por hoja de módulo (sin encabezado) ---");
  hojas.forEach(function(nombre){
    var h = ss.getSheetByName(nombre);
    L.push("  " + nombre + ": " + (h ? Math.max(0, h.getLastRow() - 1) : "(no existe)"));
  });

  var reporte = L.join("\n");
  Logger.log(reporte);
  return reporte;
}
