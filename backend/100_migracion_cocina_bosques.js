// ============================================================================
// ONE-OFF v8 — La cocina pasa de Cuajimalpa a Bosques.
//
// Cuajimalpa queda solo como punto de venta; Bosques produce, transfiere, reparte
// y tambien vende. El stock que hoy tiene Cuajimalpa SE QUEDA en Cuajimalpa (es
// producto fisicamente alli): Bosques arranca en cero y se llena produciendo.
//
// Orden en el dia del cambio (NO correr en media operacion):
//   1. diagnosticoCocinaBosques()       -> solo lee: rutas/apartados abiertos y usuarios.
//   2. Cerrar o entregar las rutas abiertas: sus reservas viven en Cuajimalpa y, desde
//      v8, "liberar" una ruta busca la reserva en Bosques.
//   3. Desplegar backend (clasp push + nueva version) y luego el frontend.
//   4. reasignarCocinerosABosques()     -> pasa los usuarios Cocinero a Bosques.
//      (Los Mixto/Vendedor se reasignan a mano desde Usuarios: hay que decidir uno por uno.)
//   5. Primer conteo fisico en Bosques desde Ajuste de inventario, y fijar stock minimo/
//      maximo de Bosques en la pestana de limites si se quieren alertas.
//
// NO llamar desde el API. Idempotente: se puede correr de nuevo sin efectos extra.
// ============================================================================
function diagnosticoCocinaBosques() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var reporte = [];

  var pedidos = _repLeerPedidos(ss).filter(function (p) { return p.estado === "base" || p.estado === "planeado"; });
  reporte.push("Rutas/pedidos de reparto abiertos (reservan en Cuajimalpa): " + pedidos.length);

  var ventas = ss.getSheetByName("Ventas").getDataRange().getValues();
  var iTipo = ventas[0].indexOf("tipo_op"), iAnul = ventas[0].indexOf("estado_anul");
  var apartados = ventas.slice(1).filter(function (r) {
    return r[0] && (iTipo === -1 || r[iTipo] === "Reservado") && (iAnul === -1 || r[iAnul] !== "ANULADO");
  }).length;
  reporte.push("Filas de apartados vigentes (se quedan en la sucursal donde se hicieron): " + apartados);

  var usuarios = ss.getSheetByName("Usuarios").getDataRange().getValues().slice(1);
  usuarios.forEach(function (u) {
    if (u[0]) reporte.push("Usuario " + u[0] + " | rol " + u[2] + " | sucursal " + u[3]);
  });

  Logger.log(reporte.join("\n"));
  return reporte;
}

function reasignarCocinerosABosques() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Usuarios");
  var datos = hoja.getDataRange().getValues();
  var cambiados = [];
  for (var i = 1; i < datos.length; i++) {
    if (datos[i][2] === "Cocinero" && datos[i][3] !== SUCURSAL_COCINA) {
      hoja.getRange(i + 1, 4).setValue(SUCURSAL_COCINA);
      cambiados.push(datos[i][0]);
    }
  }
  Logger.log("Cocineros pasados a " + SUCURSAL_COCINA + ": " + (cambiados.join(", ") || "ninguno"));
  return cambiados;
}
