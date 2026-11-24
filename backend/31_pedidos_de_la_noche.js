// ============================================================================
// 31 — PEDIDOS QUE LLEGARON EN LA NOCHE (Alex, 24-nov-2026)
//
// El reporte de entregas de mañana sale a las 18:00 (26_entregas_manana.js). Lo que se pide después —por ejemplo a las
// 22:00 para recoger a primera hora— no entraba en ningún aviso: Maite solo lo acepta si ya está en la sucursal, queda
// apartado, pero nadie se enteraba hasta abrir el tablero.
//
// Ahora, una hora antes de que abra cada sucursal, si llegaron pedidos para recoger HOY después del reporte de ayer, sale
// UN aviso por sucursal con esos pedidos y lo que dice el inventario. Si no llegó ninguno, no sale nada.
// Lo corre la revisión del tablero de cada 5 min (tableroPedidosActualizar): no necesita un disparador propio.
// ============================================================================

// pedidos: los que ya leyó el tablero (_tableroLeerPedidos). ahora: para probar; en producción, la hora real.
function pedidosDeLaNocheAvisar(ss, pedidos, ahora) {
  const momento = ahora instanceof Date ? ahora : new Date();
  const hoyIso = _entregasFecha(momento, 0);
  const minuto = _botMinutos(Utilities.formatDate(momento, TZ_MX, "HH:mm"));
  const desde = _entregasFecha(momento, -1) + " " + ("0" + ENTREGAS_MANANA_HORA).slice(-2) + ":00";   // después del reporte de ayer
  const enviadas = _nocheEnviadas(hoyIso);
  const resultado = [];
  Object.keys(HORARIOS_SUCURSAL).forEach(function (sucursal) {
    const horario = HORARIOS_SUCURSAL[sucursal][_botDiaSemana(hoyIso)];
    if (!horario || enviadas.indexOf(sucursal) !== -1) return;
    const abre = _botMinutos(horario.abre);
    if (minuto < abre - NOCHE_AVISO_MINUTOS_ANTES || minuto >= abre) return;   // solo en la hora antes de abrir
    _nocheMarcarEnviada(hoyIso, sucursal);   // una vez por sucursal y día, haya o no pedidos
    const deLaNoche = pedidos.filter(function (p) {
      return _entregasAbierto(p) && !_entregasEsDomicilio(p) && p.sucursal === sucursal && p.fechaEntrega === hoyIso && String(p.llego) >= desde;
    });
    if (!deLaNoche.length) return;
    const deHoy = pedidos.filter(function (p) { return _entregasAbierto(p) && !_entregasEsDomicilio(p) && p.sucursal === sucursal && p.fechaEntrega === hoyIso; });
    resultado.push(_nocheEnviar(ss, sucursal, hoyIso, deLaNoche, _entregasFaltantes(ss, deHoy, [])));
  });
  return resultado;
}

function _nocheEnviar(ss, sucursal, hoyIso, deLaNoche, faltantes) {
  const titulo = "🌙 Pedidos que llegaron en la noche · " + sucursal + " · " + _botFechaLegible(hoyIso);
  const detalle = _nocheDetalle(deLaNoche, faltantes);
  const aviso = manychatAvisarEquipo(ss, MANYCHAT_CLAVE_FLUJO_REPORTE, titulo, detalle, MANYCHAT_MAX_ALERTA);
  _botRegistrarAlerta(ss, "noche", "pedidos_de_la_noche", sucursal, titulo, detalle, aviso);
  return { sucursal: sucursal, pedidos: deLaNoche.length, faltantes: faltantes.length, aviso: _pedidoResultadoAviso(aviso) };
}

// "Llegaron después del reporte de las 6 pm. Para recoger hoy:" + un renglón por pedido + lo que dice el inventario.
function _nocheDetalle(deLaNoche, faltantes) {
  const lineas = ["Llegaron después del reporte de las " + ENTREGAS_MANANA_HORA + ":00. Para recoger hoy:", ""];
  deLaNoche.forEach(function (p) { lineas.push(_entregasRenglonTienda(p)); });
  lineas.push("");
  if (!faltantes.length) lineas.push("✅ Según el inventario sí hay todo lo de hoy en la sucursal.");
  else {
    lineas.push("⚠️ Según el inventario falta para lo de hoy:");
    faltantes.forEach(function (f) { lineas.push("• " + (f.pide - f.hay) + " " + f.sabor + " " + f.tamano + " (piden " + f.pide + ", hay " + f.hay + ")"); });
  }
  return lineas.join("\n");
}

// Qué sucursales ya recibieron el aviso hoy. Una sola propiedad: guarda solo el día en curso, no se acumulan.
function _nocheEnviadas(hoyIso) {
  try {
    const d = JSON.parse(PropertiesService.getScriptProperties().getProperty(NOCHE_PROPIEDAD) || "{}");
    return d.fecha === hoyIso ? d.sucursales || [] : [];
  } catch (e) { return []; }
}

function _nocheMarcarEnviada(hoyIso, sucursal) {
  const sucursales = _nocheEnviadas(hoyIso).concat([sucursal]);
  PropertiesService.getScriptProperties().setProperty(NOCHE_PROPIEDAD, JSON.stringify({ fecha: hoyIso, sucursales: sucursales }));
}
