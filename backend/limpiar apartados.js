function limpiarReservasViejas(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName("Inventario");
  var hdr = h.getRange(1,1,1,h.getLastColumn()).getValues()[0];
  var ir = hdr.indexOf("res_ruta")+1, ip = hdr.indexOf("res_apartado")+1;
  if (ir<1 || ip<1){ Logger.log("No hay columnas res_ruta/res_apartado"); return; }
  var n = h.getLastRow();
  for (var f=2; f<=n; f++){ h.getRange(f,ir).setValue(0); h.getRange(f,ip).setValue(0); }
  SpreadsheetApp.flush();
  Logger.log("Listo: reservas viejas limpiadas en "+(n-1)+" filas (res_ruta y res_apartado = 0).");
}
