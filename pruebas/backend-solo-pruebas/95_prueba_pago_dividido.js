// =================================================================================
// PRUEBA DEL PAGO DIVIDIDO (v7.2) — SOLO EN EL AMBIENTE DE PRUEBAS
// Registra ventas de prueba en la hoja, revisa lo que quedo escrito y las cancela
// al final. No debe subirse al sistema real.
// =================================================================================
function pruebaPagoDividido() {
  var out = [], fallas = 0;
  function chk(nombre, cond, extra) {
    if (!cond) fallas++;
    out.push((cond ? "OK    " : "FALLA ") + "| " + nombre + (extra ? "  ->  " + extra : ""));
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sesion = { usuario: "__prueba_pago_dividido__", rol: "Owner" };
  var suc = "Cuajimalpa";
  var creadas = [];

  // --- SKU con stock suficiente para las 3 ventas de prueba ---
  // getStock devuelve un renglon por lote: hay que sumar los lotes del mismo SKU.
  var porSku = {};
  (getStock({ sucursal: suc }, sesion).stock || []).forEach(function (s) {
    if (s.sucursal !== suc) return;
    var k = s.sabor + "|||" + s.tamano;
    porSku[k] = (porSku[k] || 0) + (Number(s.disponibleNeto) || 0);
  });
  var elegido = Object.keys(porSku).filter(function (k) { return porSku[k] >= 3; })[0];
  if (!elegido) { var m0 = "SIN STOCK suficiente en " + suc + ": no se puede correr la prueba."; Logger.log(m0); return m0; }
  var sabor = elegido.split("|||")[0], tamano = elegido.split("|||")[1];
  out.push("SKU de prueba: " + sabor + " " + tamano + " @ " + suc + " (disponible " + porSku[elegido] + ")");

  function venta(pagos, metodoPago, canal, cant) {
    return registrarVenta({
      items: [{ sabor: sabor, tamano: tamano, cantidad: cant || 1, precioUnitario: 100 }],
      canal: canal || "Tienda", metodoPago: metodoPago || "", pagos: pagos,
      cliente: { nombre: "PRUEBA PAGO DIVIDIDO" }, tipoOp: "venta",
      sucursal: suc, opId: "PRUEBA-" + new Date().getTime() + "-" + Math.random()
    }, sesion);
  }
  function filasDe(idVenta) {
    var h = ss.getSheetByName("Ventas"), d = h.getDataRange().getValues(), H = d[0], r = [];
    for (var i = 1; i < d.length; i++) if (String(d[i][0]) === String(idVenta)) r.push({ fila: d[i], H: H });
    return r;
  }

  // --- 1. Un desglose que no cuadra se rechaza y no toca el inventario ---
  // Se lee del Inventario y no de getStock: getStock cachea 30 s y una lectura cacheada
  // no probaria nada.
  function disponible() {
    var d = ss.getSheetByName("Inventario").getDataRange().getValues();
    return calcularDisponible(d, sabor, tamano, suc, new Date());
  }
  var dispAntes = disponible();
  var r1 = venta([{ metodo: "Efectivo", monto: 60 }, { metodo: "Tarjeta", monto: 30 }]);
  chk("desglose que no cuadra: rechazado", !r1.ok, r1.error || "se registro igual");
  var dispDespues = disponible();
  chk("el rechazo no descuenta stock", dispAntes === dispDespues, dispAntes + " -> " + dispDespues);

  // --- 2. Metodo inexistente y plataforma ---
  var r2 = venta([{ metodo: "Vales", monto: 100 }]);
  chk("metodo desconocido: rechazado", !r2.ok, r2.error || "se registro igual");
  var r3 = venta([{ metodo: "Efectivo", monto: 50 }, { metodo: "Tarjeta", monto: 50 }], "", "Rappi");
  chk("en Rappi no se puede dividir", !r3.ok, r3.error || "se registro igual");

  // --- 3. Venta dividida que cuadra ---
  _cajaMemoInvalidar();
  var efectivoAntes = _cajaSumaVentasEfectivo(ss, suc);
  var r4 = venta([{ metodo: "Efectivo", monto: 60 }, { metodo: "Tarjeta", monto: 40 }]);
  chk("venta dividida 60/40: registrada", r4.ok, r4.error || r4.idVenta);
  if (r4.ok) {
    creadas.push(r4.idVenta);
    var fs = filasDe(r4.idVenta);
    var H = fs.length ? fs[0].H : [];
    var iPagos = H.indexOf ? H.indexOf("pagos") : -1;
    chk("la columna pagos existe", iPagos !== -1);
    chk("metodo_pago = Mixto", fs.length > 0 && String(fs[0].fila[10]) === "Mixto", fs.length ? String(fs[0].fila[10]) : "sin filas");
    var det = iPagos !== -1 && fs.length ? _pagosLeer(fs[0].fila[iPagos]) : { pagos: [], total: 0 };
    chk("desglose guardado", _pagosMonto(det.pagos, "Efectivo") === 60 && _pagosMonto(det.pagos, "Tarjeta") === 40, JSON.stringify(det));
    chk("total de productos guardado", det.total === 100, String(det.total));
    chk("solo la primera fila trae el desglose", fs.length === 1 || !fs[1].fila[iPagos], "filas: " + fs.length);
    _cajaMemoInvalidar();
    var efectivoDespues = _cajaSumaVentasEfectivo(ss, suc);
    chk("caja suma SOLO los $60 en efectivo", efectivoDespues - efectivoAntes === 60, efectivoAntes + " -> " + efectivoDespues);
    var rec = generarReciboPDF(r4.idVenta, sesion, true);
    chk("el recibo muestra el desglose", rec.ok && rec.html.indexOf("Pago Efectivo") !== -1 && rec.html.indexOf("Pago Tarjeta") !== -1);
  }

  // --- 4. Un solo metodo en el desglose = venta normal, sin JSON ---
  var r5 = venta([{ metodo: "Transferencia", monto: 100 }]);
  chk("un solo metodo: se registra como venta normal", r5.ok, r5.error || "");
  if (r5.ok) {
    creadas.push(r5.idVenta);
    var fs5 = filasDe(r5.idVenta), H5 = fs5.length ? fs5[0].H : [], iP5 = H5.indexOf ? H5.indexOf("pagos") : -1;
    chk("metodo_pago = Transferencia (no Mixto)", fs5.length > 0 && String(fs5[0].fila[10]) === "Transferencia", fs5.length ? String(fs5[0].fila[10]) : "sin filas");
    chk("sin desglose guardado", iP5 === -1 || !fs5[0].fila[iP5]);
  }

  // --- 5. Venta normal de siempre: no cambio nada ---
  _cajaMemoInvalidar();
  var efAntes2 = _cajaSumaVentasEfectivo(ss, suc);
  var r6 = venta(null, "Efectivo");
  chk("venta normal en efectivo: registrada", r6.ok, r6.error || "");
  if (r6.ok) {
    creadas.push(r6.idVenta);
    _cajaMemoInvalidar();
    chk("caja suma los $100 completos", _cajaSumaVentasEfectivo(ss, suc) - efAntes2 === 100);
  }

  _cajaMemoInvalidar();
  var efAntesCancelar = _cajaSumaVentasEfectivo(ss, suc);
  // --- Limpieza: cancelar las ventas de prueba (repone stock) ---
  for (var k = 0; k < creadas.length; k++) {
    var del = eliminarMovimiento({ hoja: "Ventas", id: creadas[k], motivo: "Prueba automatica del pago dividido" }, sesion);
    out.push((del.ok ? "OK    " : "FALLA ") + "| cancelada " + creadas[k] + (del.ok ? "" : " -> " + del.error));
    if (!del.ok) fallas++;
  }

  _cajaMemoInvalidar();
  var efFinal = _cajaSumaVentasEfectivo(ss, suc);
  // Al cancelar, el efectivo del ticket dividido tiene que salir de caja igual que el de
  // una venta normal: $60 del dividido mas $100 de la venta normal en efectivo.
  chk("cancelar saca el efectivo de caja", efAntesCancelar - efFinal === 160, efAntesCancelar + " -> " + efFinal);
  chk("caja vuelve al punto de partida", efFinal === efectivoAntes, efectivoAntes + " vs " + efFinal);

  var msg = "=== PRUEBA PAGO DIVIDIDO ===\n" + out.join("\n") + "\n\n" + (fallas ? fallas + " FALLA(S)" : "TODO OK");
  Logger.log(msg);
  return msg;
}
