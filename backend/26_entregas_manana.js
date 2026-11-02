// ============================================================================
// v9 — REPORTE DE LAS 18:00: LO QUE SE ENTREGA MAÑANA, POR PUNTO DE VENTA
//
// Pedido de Alex (1-nov): a nadie se le contesta el pedido (Maite ya lo cierra con su llave), pero alguien revisa cada tarde
// que haya todo para entregar mañana. A las 18:00 (la hora de corte para pedir para mañana) Rebeca y Yessenia reciben por
// WhatsApp un mensaje con una sección por punto de venta (Polanco, Cuajimalpa, Bosques) y una de Domicilio:
//   - cuántos pedidos y tartas, si alcanza lo que hay en la tienda o qué falta (hornear / transferir),
//   - un renglón por pedido: hora, cliente, piezas, total, pago y llave.
// Entran todos los pedidos de la hoja Ventas: bot, Shopify y POS. Las rutas se arman a mano, así que la sección Domicilio pide
// confirmar que cada pedido esté en la ruta de mañana.
// "Falta" = piezas de mañana − (inventario de la tienda − lo que todavía se debe entregar hoy). Domicilio sale de Bosques, así que
// cuenta en lo que necesita Bosques. No cuenta lo que se venda en mostrador mañana temprano.
// Huella en la hoja Reportes_Entregas.
// ============================================================================

function _entregasFecha(ahora, dias) {
  return Utilities.formatDate(new Date(ahora.getTime() + dias * 86400000), TZ_MX, "yyyy-MM-dd");
}

function _entregasAbierto(p) { return PEDIDO_ESTADOS_ABIERTOS.indexOf(p.estado) !== -1; }
function _entregasEsDomicilio(p) { return p.canal === BOT_CANAL_DOMICILIO; }

// "2 Frutos Rojos Mediana" -> { cantidad: 2, sabor: "Frutos Rojos", tamano: "Mediana" }
function _entregasPieza(texto) {
  const m = String(texto).match(/^(\d+) (.+) (\S+)$/);
  return m && BOT_TAMANOS.indexOf(m[3]) !== -1 ? { cantidad: Number(m[1]), sabor: m[2], tamano: m[3] } : null;
}

// { "Bosques|Queso|Mediana": piezas }. Domicilio cuenta en la cocina, de donde sale.
function _entregasPiezasPorSku(pedidos) {
  const piezas = {};
  pedidos.forEach(function (p) {
    const sucursal = _entregasEsDomicilio(p) ? SUCURSAL_COCINA : p.sucursal;
    p.items.map(_entregasPieza).filter(Boolean).forEach(function (x) {
      const clave = sucursal + "|" + x.sabor + "|" + x.tamano;
      piezas[clave] = (piezas[clave] || 0) + x.cantidad;
    });
  });
  return piezas;
}

// [{ sucursal, sabor, tamano, pide, hay }] solo de lo que no alcanza.
function _entregasFaltantes(ss, manana, pendientesHoy) {
  const pide = _entregasPiezasPorSku(manana);
  const comprometido = _entregasPiezasPorSku(pendientesHoy);
  return Object.keys(pide).map(function (clave) {
    const p = clave.split("|");
    const hay = Math.max(0, invSaldos(ss, p[1], p[2], p[0]).total - (comprometido[clave] || 0));
    return { sucursal: p[0], sabor: p[1], tamano: p[2], pide: pide[clave], hay: hay };
  }).filter(function (f) { return f.pide > f.hay; });
}

function _entregasTartas(pedidos) {
  return pedidos.reduce(function (t, p) { return t + p.items.reduce(function (s, i) { return s + (Number(String(i).split(" ")[0]) || 0); }, 0); }, 0);
}

function _entregasDinero(n) { return "$" + Math.round(Number(n) || 0).toLocaleString("en-US"); }

// "• 12:00 Ana López: 1 Queso Mediana · $420 · transferencia · TV-1102-01"
function _entregasRenglonTienda(p) {
  return "• " + (p.hora || "sin hora") + " " + (p.cliente || "sin nombre") + ": " + p.items.join(" + ") + " · " + _entregasDinero(p.total)
    + (p.pago ? " · " + p.pago : "") + (p.referencia ? " · " + p.referencia : "");
}

// "• Ana López, Calle 1 (Lomas): 1 Queso Grande · $880 · efectivo · TV-…"
function _entregasRenglonDomicilio(p) {
  return "• " + (p.cliente || "sin nombre") + (p.direccion ? ", " + p.direccion : "") + ": " + p.items.join(" + ") + " · " + _entregasDinero(p.total)
    + (p.pago ? " · " + p.pago : "") + (p.referencia ? " · " + p.referencia : "");
}

function _entregasFaltaTexto(faltan, accion) {
  return "⚠️ " + accion + ": " + faltan.map(function (f) { return (f.pide - f.hay) + " " + f.sabor + " " + f.tamano + " (piden " + f.pide + ", hay " + f.hay + ")"; }).join(", ");
}

function _entregasCuenta(n, singular, plural) { return n + " " + (n === 1 ? singular : plural); }

function _entregasResumen(pedidos) {
  return _entregasCuenta(pedidos.length, "pedido", "pedidos") + " · " + _entregasCuenta(_entregasTartas(pedidos), "tarta", "tartas");
}

// Bosques es la cocina: lo que le falta incluye lo de domicilio, así que se avisa aunque no tenga pedidos para recoger.
function _entregasSeccionTienda(tienda, pedidos, faltantes) {
  const faltan = faltantes.filter(function (f) { return f.sucursal === tienda; });
  const cocina = tienda === SUCURSAL_COCINA;
  if (!pedidos.length && !faltan.length) return "Sin pedidos.";
  const estado = !faltan.length ? "✅ Todo hay en tienda."
    : _entregasFaltaTexto(faltan, cocina ? "Por hornear (tienda y domicilio)" : "Falta, hornear y transferir");
  const ordenados = pedidos.slice().sort(function (a, b) { return String(a.hora).localeCompare(String(b.hora)); });
  return [pedidos.length ? _entregasResumen(pedidos) : "Sin pedidos para recoger.", estado].concat(ordenados.map(_entregasRenglonTienda)).join("\n");
}

// Mañana, más los domicilios que entraron hoy para días después (ya están en el Excel de pedidos en su fecha).
function _entregasSeccionDomicilio(pedidos, nuevosOtrosDias) {
  const partes = [];
  if (pedidos.length) partes.push(_entregasResumen(pedidos) + " · salen de " + SUCURSAL_COCINA, "⚠️ Confirmen que estén en la ruta de mañana.");
  else partes.push("Sin pedidos para mañana.");
  partes.push.apply(partes, pedidos.map(_entregasRenglonDomicilio));
  if (nuevosOtrosDias.length) {
    partes.push("🆕 Entraron hoy para otros días (ya en el Excel):");
    partes.push.apply(partes, nuevosOtrosDias.map(function (p) { return _entregasRenglonDomicilio(p).replace("• ", "• " + p.fechaEntrega.substring(8, 10) + "/" + p.fechaEntrega.substring(5, 7) + " "); }));
  }
  return partes.join("\n");
}

// Recorta una sección para el WhatsApp sin cortar un renglón a la mitad; el resumen y el estado (dos primeros renglones) siempre van.
function _entregasRecortar(texto, maximo) {
  if (texto.length <= maximo) return texto;
  const renglones = texto.split("\n");
  let salida = renglones.slice(0, 2).join("\n");
  for (let i = 2; i < renglones.length; i++) {
    const cola = "\n… y " + (renglones.length - i) + " más en la pestaña del tablero";
    if ((salida + "\n" + renglones[i]).length + cola.length > maximo) return salida + cola;
    salida += "\n" + renglones[i];
  }
  return salida;
}

// { Polanco: "texto", Cuajimalpa: …, Bosques: …, Domicilio: … }
function _entregasSecciones(manana, faltantes, nuevosOtrosDias) {
  const secciones = {};
  ENTREGAS_TIENDAS.forEach(function (t) {
    secciones[t] = _entregasSeccionTienda(t, manana.filter(function (p) { return !_entregasEsDomicilio(p) && p.sucursal === t; }), faltantes);
  });
  secciones[ENTREGAS_SECCION_DOMICILIO] = _entregasSeccionDomicilio(manana.filter(_entregasEsDomicilio), nuevosOtrosDias || []);
  return secciones;
}

function _entregasCampos(ss, secciones) {
  const unaLinea = /^s[ií]/i.test(String(_cfgVal(ss, ENTREGAS_CLAVE_UNA_LINEA, "")));
  return Object.keys(ENTREGAS_CAMPOS).map(function (s) {
    const texto = _entregasRecortar(secciones[s], ENTREGAS_MAX_SECCION);
    return { nombre: ENTREGAS_CAMPOS[s], valor: unaLinea ? texto.replace(/\n+/g, "  ") : texto };
  });
}

function _entregasRegistrar(ss, titulo, secciones, aviso, ahora) {
  const hoja = _hojaDeRegistro(ss, ENTREGAS_MANANA_HOJA, ["Fecha y hora", "Reporte", "Resultado"], [130, 600, 300]);
  const texto = titulo + "\n" + Object.keys(secciones).map(function (s) { return s.toUpperCase() + "\n" + secciones[s]; }).join("\n\n");
  hoja.getRange(hoja.getLastRow() + 1, 1, 1, 3).setNumberFormat("@");
  hoja.appendRow([_fechaHora(ahora), texto, _pedidoResultadoAviso(aviso)]);
}

// Trigger de las 18:00. "ahora" solo se pasa en pruebas (reloj simulado).
function pedidosEntregasManana(ahora) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const momento = ahora instanceof Date ? ahora : new Date();
  const hoyIso = _entregasFecha(momento, 0);
  const mananaIso = _entregasFecha(momento, 1);
  const ventas = ss.getSheetByName("Ventas");
  const abiertos = _tableroLeerPedidos(ss, ventas, _pedidoIndices(ventas)).filter(_entregasAbierto);
  const manana = abiertos.filter(function (p) { return p.fechaEntrega === mananaIso; });
  const pendientesHoy = abiertos.filter(function (p) { return p.fechaEntrega && p.fechaEntrega <= hoyIso; });
  const faltantes = _entregasFaltantes(ss, manana, pendientesHoy);
  const nuevosOtrosDias = abiertos.filter(function (p) { return _entregasEsDomicilio(p) && String(p.llego).substring(0, 10) === hoyIso && p.fechaEntrega > mananaIso; });
  const secciones = _entregasSecciones(manana, faltantes, nuevosOtrosDias);
  const total = manana.length;
  const titulo = _botFechaLegible(mananaIso) + " · " + (total ? total + " pedidos" + (faltantes.length ? " · ⚠️ FALTAN TARTAS" : " · ✅ todo listo") : "sin pedidos");
  const aviso = manychatAvisarEquipo(ss, MANYCHAT_CLAVE_FLUJO_ENTREGAS, titulo, titulo, MANYCHAT_MAX_DETALLE, _entregasCampos(ss, secciones));
  _entregasRegistrar(ss, titulo, secciones, aviso, momento);
  return { ok: true, fecha: mananaIso, pedidos: total, faltantes: faltantes, titulo: titulo, secciones: secciones, reporte: _pedidoResultadoAviso(aviso) };
}

// Correr UNA vez desde el editor. Apps Script lo corre entre las 18:00 y las 18:15 aprox.
function instalarEntregasManana() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "pedidosEntregasManana") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("pedidosEntregasManana").timeBased().everyDays(1).atHour(ENTREGAS_MANANA_HORA).nearMinute(5).inTimezone(TZ_MX).create();
}
