// ============================================================
// CONFIGURACIÓN INICIAL DEL CATÁLOGO — Tarta Vasca
// Carga: Sucursales, Tamaños, Canales, Precios y Comisiones
// Ejecutar UNA vez desde el editor de Apps Script
// ============================================================

function configurarCatalogo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hCat = ss.getSheetByName("Catálogo");
  const hPre = ss.getSheetByName("Precios");
  const hConf = ss.getSheetByName("Configuración");
  const ahora = new Date().toISOString();

  if (!hCat) { SpreadsheetApp.getUi().alert("❌ No se encontró la hoja Catálogo."); return; }

  // ── 1. Limpiar y recargar sucursales, tamaños y canales ──
  const datos = hCat.getDataRange().getValues();

  // Borrar sucursales, tamaños y canales existentes
  for (let i = datos.length - 1; i >= 1; i--) {
    const tipo = datos[i][0];
    if (tipo === "Sucursal" || tipo === "Tamaño" || tipo === "Canal") {
      hCat.deleteRow(i + 1);
    }
  }

  // Sucursales
  hCat.appendRow(["Sucursal", "Cuajimalpa", "TRUE", ahora, ahora]);
  hCat.appendRow(["Sucursal", "Polanco",    "TRUE", ahora, ahora]);

  // Tamaños
  hCat.appendRow(["Tamaño", "Individual", "TRUE", ahora, ahora]);
  hCat.appendRow(["Tamaño", "Mediana",    "TRUE", ahora, ahora]);
  hCat.appendRow(["Tamaño", "Grande",     "TRUE", ahora, ahora]);

  // Canales
  hCat.appendRow(["Canal", "Tienda",    "TRUE", ahora, ahora]);
  hCat.appendRow(["Canal", "Domicilio", "TRUE", ahora, ahora]);
  hCat.appendRow(["Canal", "Rappi",     "TRUE", ahora, ahora]);
  hCat.appendRow(["Canal", "Uber Eats", "TRUE", ahora, ahora]);

  // ── 2. Precios base por tamaño (para todos los sabores) ──
  // Individual: $190, Mediana: $370, Grande: $670
  // Rappi: Individual: $210, Mediana: $390, Grande: $690
  if (hPre) {
    // Borrar precios existentes
    if (hPre.getLastRow() > 1) {
      hPre.deleteRows(2, hPre.getLastRow() - 1);
    }

    // Obtener sabores activos del catálogo
    const catDatos = hCat.getDataRange().getValues();
    const sabores = catDatos.slice(1)
      .filter(r => r[0] === "Sabor" && (r[2] === "TRUE" || r[2] === true))
      .map(r => r[1]);

    const precios = [
      { tamano: "Individual", precio: 190 },
      { tamano: "Mediana",    precio: 370 },
      { tamano: "Grande",     precio: 670 },
    ];

    // Precio base por tamaño (sin sabor específico — fallback)
    // Columnas: Sabor, Tamaño, Precio, VigenteDesde, ModificadoPor, FechaMod, Canal
    precios.forEach(p => {
      hPre.appendRow(["_BASE_", p.tamano, p.precio, ahora, "_sistema_", ahora, ""]);
    });

    // Precio Rappi por tamaño
    const preciosRappi = [
      { tamano: "Individual", precio: 210 },
      { tamano: "Mediana",    precio: 390 },
      { tamano: "Grande",     precio: 690 },
    ];
    preciosRappi.forEach(p => {
      hPre.appendRow(["_BASE_", p.tamano, p.precio, ahora, "_sistema_", ahora, "Rappi"]);
    });

    // Precio base por sabor+tamaño para todos los sabores
    sabores.forEach(sabor => {
      precios.forEach(p => {
        hPre.appendRow([sabor, p.tamano, p.precio, ahora, "_sistema_", ahora, ""]);
      });
      // Precio Rappi por sabor+tamaño
      preciosRappi.forEach(p => {
        hPre.appendRow([sabor, p.tamano, p.precio, ahora, "_sistema_", ahora, "Rappi"]);
      });
    });

    Logger.log("✅ Precios cargados para " + sabores.length + " sabores (base + Rappi)");
  }

  // ── 3. Guardar comisiones en Configuración ──
  // Rappi: -23%, Tarjeta: -6%, Transferencia: -3%
  if (hConf) {
    // Buscar y actualizar o agregar filas de comisiones
    const confDatos = hConf.getDataRange().getValues();
    const comisiones = [
      ["comision_rappi",           "-23"],
      ["comision_ubereats",        "-23"],
      ["comision_tarjeta",         "-6"],
      ["comision_transferencia",   "-3"],
    ];

    comisiones.forEach(([clave, valor]) => {
      let encontrado = false;
      for (let i = 1; i < confDatos.length; i++) {
        if (confDatos[i][0] === clave) {
          hConf.getRange(i + 1, 2).setValue(valor);
          encontrado = true;
          break;
        }
      }
      if (!encontrado) hConf.appendRow([clave, valor, ahora]);
    });

    Logger.log("✅ Comisiones guardadas en Configuración");
  }

  SpreadsheetApp.getUi().alert(
    "✅ Catálogo configurado correctamente.\n\n" +
    "Sucursales: Cuajimalpa, Polanco\n" +
    "Tamaños: Individual ($190), Mediana ($370), Grande ($670)\n" +
    "Canales: Tienda, Domicilio, Rappi, Uber Eats\n\n" +
    "Precios base: Individual $190 · Mediana $370 · Grande $670\n" +
    "Precios Rappi: Individual $210 · Mediana $390 · Grande $690\n\n" +
    "Comisiones:\n" +
    "• Rappi / Uber Eats: -23%\n" +
    "• Tarjeta: -6%\n" +
    "• Transferencia bancaria: -3%"
  );
}