// ============================================================================
// v7.6 — TIENDA EN LÍNEA: disponibilidad para el calendario del carrito (Shopify)
// Acción PÚBLICA (sin token): la consulta el carrito de latartavasca.com.
// No expone el inventario: solo qué sabor+tamaño se puede recoger HOY en cada
// sucursal (disponible >= RECOGER_MIN_PIEZAS_MISMO_DIA), cuántas como máximo
// (dejando la pieza de reserva) y las reglas del
// calendario (horarios, preparación, corte). El cálculo de fechas vive en el
// tema de Shopify; aquí solo la verdad del inventario y la configuración.
// Cache 30 s, invalidado al instante por cualquier movimiento (_invLedger).
// ============================================================================
function tiendaDisponibilidad() {
  const enCache = _velGet("inv", "tienda_disp");
  if (enCache) return enCache;
  const respuesta = {
    ok: true,
    ahora: Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd'T'HH:mm:ss"),
    hoy: _tiendaListasHoy(SpreadsheetApp.getActiveSpreadsheet()),
    reglas: {
      horarios: RECOGER_HORARIOS,
      diasPreparacion: RECOGER_DIAS_PREPARACION,
      horaCorte: RECOGER_HORA_CORTE,
      intervaloMin: RECOGER_INTERVALO_MIN,
      diasAMostrar: RECOGER_DIAS_A_MOSTRAR
    }
  };
  _velPut("inv", "tienda_disp", respuesta, 30);
  return respuesta;
}

// { "Cuajimalpa": [{ k:"Oreo|Grande", max:2 }, ...], "Polanco": [...] }
// Solo lo que alcanza el mínimo. max = cuántas se pueden llevar hoy dejando
// en sucursal la pieza de reserva (disponible − (mínimo − 1)).
function _tiendaListasHoy(ss) {
  const disponible = _tiendaDisponiblePorSku(ss);
  const listas = {};
  Object.keys(RECOGER_HORARIOS).forEach(function (suc) { listas[suc] = []; });
  Object.keys(disponible).forEach(function (clave) {
    const partes = clave.split("|");
    const suc = partes[2];
    const disp = disponible[clave];
    if (listas[suc] && disp >= RECOGER_MIN_PIEZAS_MISMO_DIA) {
      listas[suc].push({ k: partes[0] + "|" + partes[1], max: disp - (RECOGER_MIN_PIEZAS_MISMO_DIA - 1) });
    }
  });
  return listas;
}

// Mismo criterio que invSaldos, en una sola lectura de la hoja:
// disponible = total − res_ruta − res_apartado; las reservas solo cuentan en lotes con stock.
function _tiendaDisponiblePorSku(ss) {
  const hoja = ss.getSheetByName("Inventario");
  const idx = _invIdx(hoja);
  const datos = hoja.getDataRange().getValues();
  const disponible = {};
  for (let i = 1; i < datos.length; i++) {
    const r = datos[i];
    if (!r[1] || _invAnulada(r, idx)) continue;
    const cant = _invNum(r[5]);
    let reservado = 0;
    if (cant > 0) {
      if (idx.ruta !== -1) reservado += _invNum(r[idx.ruta]);
      if (idx.apart !== -1) reservado += _invNum(r[idx.apart]);
    }
    const clave = r[1] + "|" + r[2] + "|" + r[3];
    disponible[clave] = (disponible[clave] || 0) + cant - reservado;
  }
  return disponible;
}
