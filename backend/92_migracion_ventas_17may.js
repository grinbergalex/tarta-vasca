/**
 * TARTA VASCA — Completar las 2 ventas que fallaron por stock
 * Fecha: 17-may-2026
 *
 * Faltó stock de:
 *   - 1× Sevillana Grande Cuajimalpa
 *   - 1× Limón Mediana Cuajimalpa
 *
 * Este script:
 *   1. Carga esas 2 piezas al inventario
 *   2. Registra las 2 ventas que faltaron (Azyhadeé Toran + Mariana Carmona)
 *
 * USO:
 *   Selecciona `completarVentas17May` → ▶ Ejecutar
 */

function completarVentas17May() {
  const SUCURSAL = "Cuajimalpa";
  const ui = SpreadsheetApp.getUi();

  const sesionFake = { usuario: "alex", rol: "Owner", sucursal: SUCURSAL };

  // ── PASO 1: Cargar 1 Sevillana Grande y 1 Limón Mediana ──
  const cargas = [
    { sabor: "Sevillana", tamano: "Grande",  cantidad: 1 },
    { sabor: "Limón",     tamano: "Mediana", cantidad: 1 }
  ];
  let cargasOK = 0;
  const erroresCarga = [];
  cargas.forEach(c => {
    try {
      const res = altaProduccion({ sabor: c.sabor, tamano: c.tamano, sucursal: SUCURSAL, cantidad: c.cantidad }, sesionFake);
      if (res && res.ok) cargasOK++;
      else erroresCarga.push(`${c.sabor} ${c.tamano}: ${res?res.error:"sin respuesta"}`);
    } catch(e) {
      erroresCarga.push(`${c.sabor} ${c.tamano}: ${e.message}`);
    }
    Utilities.sleep(150);
  });

  if (erroresCarga.length > 0) {
    ui.alert("❌ Falló cargar inventario:\n" + erroresCarga.join("\n") + "\n\nAborto. No se intentaron las ventas.");
    return;
  }

  // ── PASO 2: Registrar las 2 ventas que faltaron ──
  const ventas = [
    // #3 Azyhadeé Toran — Sevillana Grande — Tarjeta
    { cliente: { nombre: "Azyhadeé Toran", telefono: "5591991530" }, canal: "Tienda", metodoPago: "Tarjeta",
      items: [{ sabor: "Sevillana", tamano: "Grande", cantidad: 1, precioUnitario: 670 }] },

    // #4 Mariana Carmona — Queso Mediana + Limón Mediana — Tarjeta
    // (la Queso Mediana de Mariana NO se registró antes porque la venta entera falló;
    //  hay que registrarla otra vez con AMBOS items)
    { cliente: { nombre: "Mariana Carmona" }, canal: "Tienda", metodoPago: "Tarjeta",
      items: [
        { sabor: "Queso", tamano: "Mediana", cantidad: 1, precioUnitario: 370 },
        { sabor: "Limón", tamano: "Mediana", cantidad: 1, precioUnitario: 370 }
      ]}
  ];

  let ventasOK = 0;
  const erroresVenta = [];
  ventas.forEach((v, i) => {
    try {
      const body = {
        items: v.items,
        canal: v.canal,
        metodoPago: v.metodoPago,
        sucursal: SUCURSAL,
        cliente: v.cliente,
        tipoOp: "venta"
      };
      const res = registrarVenta(body, sesionFake);
      if (res && res.ok) ventasOK++;
      else erroresVenta.push(`#${i+1} ${v.cliente.nombre}: ${res?res.error:"sin respuesta"}`);
      Utilities.sleep(150);
    } catch(e) {
      erroresVenta.push(`#${i+1} ${v.cliente.nombre}: ${e.message}`);
    }
  });

  let msg = `✅ Inventario: ${cargasOK}/2 cargadas\n✅ Ventas: ${ventasOK}/${ventas.length} registradas`;
  if (erroresVenta.length > 0) msg += `\n\n❌ Errores:\n${erroresVenta.map(e => "• " + e).join("\n")}`;
  ui.alert("Resultado", msg, ui.ButtonSet.OK);
}