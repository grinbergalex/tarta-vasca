// ============================================================================
// VENTAS DE SHOPIFY -> SISTEMA DE SUCURSALES — La Tarta Vasca
//
// Cada pedido pagado en latartavasca.com debe quedar registrado en el sistema
// (hoja "Tarta Vasca — Sistema") como si se hubiera capturado en sucursal.
//
// Diseño: NO se escribe directo en las hojas. El pedido se traduce al mismo
// cuerpo que manda la app de sucursales a registrarVenta() del POS (backend/
// 08_inventario_ventas.js), para reusar lo que esa puerta ya garantiza:
// Inv_Ledger, historial del cliente, auditoría y anti-duplicados por opId
// ("SHOPIFY-#1048": registrar dos veces el mismo pedido no duplica la venta).
//
// Entra como RESERVA pagada, no como venta: las tartas en línea se hornean para
// el día de entrega, así que al llegar el pedido todavía no hay stock que
// descontar. El día de la entrega la sucursal la convierte en venta desde la
// app (convertirReservaAVenta, 13_reservas_rutas.js) y ahí se descuenta.
// Efecto conocido: al registrarla el POS intenta apartar stock físico, no hay,
// y deja una nota RESERVA_SIN_STOCK en Auditoría. Es esperado para estas.
//
// Sucursal: todo envío a domicilio sale de Cuajimalpa; "recoger en tienda" va
// a la sucursal que eligió el cliente. Cada sucursal tiene su usuario del POS
// (rol Vendedor; el POS registra en la sucursal del usuario):
//   Cuajimalpa -> POS_USUARIO_CUAJI / POS_PASSWORD_CUAJI
//   Polanco    -> POS_USUARIO_POLANCO / POS_PASSWORD_POLANCO
// Método de pago "Shopify" (comisión 3% en la hoja Comisiones).
//
// Modos (propiedad VENTAS_MODO):
//   REVISAR (default) — solo manda por correo cómo entraría cada pedido.
//   UNO     — registra solo el pedido de VENTAS_SOLO_PEDIDO (ej. "#1050").
//   APLICAR — registra todos los pedidos pagados creados desde VENTAS_DESDE.
// Sin VENTAS_DESDE nunca registra: los pedidos viejos ya los capturó la sucursal.
// Cada pedido registrado queda en la propiedad REG_<pedido> = id de la reserva,
// y nunca se vuelve a mandar (el anti-duplicados del POS solo dura 6 horas).
//
// Necesita la llave de Shopify con el permiso read_orders (ver GUIA_LLAVE.md).
// ============================================================================

const SUCURSAL_ENVIOS = "Cuajimalpa";            // de aquí salen todos los envíos a domicilio
const SUCURSALES_RECOGER = ["Polanco", "Cuajimalpa"];  // se busca en el nombre del punto de recolección
const POS_API_URL = "https://script.google.com/macros/s/AKfycbxJfDX3lwu5AE9GDA1WGZ3_MP3AAGPsCz54CdzS_cnE9zxQArN1zLmjnZixwc2A13eF/exec";
const SUFIJO_PROPIEDAD_SUCURSAL = { "Cuajimalpa": "CUAJI", "Polanco": "POLANCO" };
const CANAL_DOMICILIO = "Domicilio";
const CANAL_RECOGER = "Tienda";
const METODO_PAGO_SHOPIFY = "Shopify";
const TIPO_OPERACION = "reserva";
const PREFIJO_OPERACION = "SHOPIFY-";
const DIAS_A_REVISAR = 30;

function revisarVentasShopify() {
  const token = obtenerToken_();
  if (!token) throw new Error("Falta la llave de Shopify (ver GUIA_LLAVE.md).");
  const hoja = leerHoja_();
  const pedidos = leerPedidosAdmin_(token, DIAS_A_REVISAR);
  const traducidos = pedidos.map(p => traducirPedido_(p, hoja));
  const texto = redactarReporteVentas_(traducidos);
  Logger.log(texto);
  MailApp.sendEmail(correoReporte_(), "Tarta Vasca — " + traducidos.length + " pedidos de Shopify: así entrarían al sistema", texto);
  return traducidos;
}

function leerPedidosAdmin_(token, dias) {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const consulta = "query Pedidos($q: String, $cursor: String) { orders(first: 50, after: $cursor, query: $q, sortKey: CREATED_AT) { " +
    "pageInfo { hasNextPage endCursor } nodes { name createdAt cancelledAt test displayFinancialStatus " +
    "shippingLine { title originalPriceSet { shopMoney { amount } } } " +
    "shippingAddress { name phone zip } billingAddress { name phone } phone email customAttributes { key value } " +
    "lineItems(first: 20) { nodes { title variantTitle quantity discountedUnitPriceSet { shopMoney { amount } } } } } } }";
  const pedidos = [];
  let cursor = null;
  do {
    const pagina = llamarShopify_(token, consulta, { q: "created_at:>='" + desde + "'", cursor: cursor }).orders;
    pagina.nodes.forEach(p => pedidos.push(p));
    cursor = pagina.pageInfo.hasNextPage ? pagina.pageInfo.endCursor : null;
  } while (cursor);
  return pedidos;
}

// Pedido de Shopify (forma del Admin API) -> cuerpo de registrarVenta + lo que
// impide registrarlo. Funcion pura: no lee ni escribe nada.
function traducirPedido_(pedido, hoja) {
  const problemas = [];
  const atributos = (pedido.customAttributes || []).reduce((acc, a) => { acc[a.key] = a.value; return acc; }, {});
  const esDomicilio = atributos["Checkout channel"] === "DELIVERY";
  const sucursal = esDomicilio ? SUCURSAL_ENVIOS : sucursalDeRecoleccion_(pedido.shippingLine ? pedido.shippingLine.title : "");

  if (pedido.test) problemas.push("es un pedido de prueba");
  if (pedido.cancelledAt) problemas.push("está cancelado");
  if (pedido.displayFinancialStatus !== "PAID") problemas.push("no está pagado (" + pedido.displayFinancialStatus + ")");

  const items = pedido.lineItems.nodes.map(li => {
    const sabor = saborDeProducto_(li.title, hoja.sabores);
    const tamano = TAMANOS_EN_LINEA.indexOf(li.variantTitle) !== -1 ? li.variantTitle : null;
    if (!sabor) problemas.push("no reconozco el sabor de \"" + li.title + "\"");
    if (!tamano) problemas.push("no reconozco el tamaño \"" + li.variantTitle + "\" de " + li.title);
    return { sabor: sabor, tamano: tamano, cantidad: li.quantity, precioUnitario: Number(li.discountedUnitPriceSet.shopMoney.amount) };
  });

  // Sin read_customers: el nombre y el teléfono salen de las direcciones del pedido.
  const envioA = pedido.shippingAddress || {}, cobroA = pedido.billingAddress || {};
  const nombre = envioA.name || cobroA.name || "";
  const telefono = pedido.phone || envioA.phone || cobroA.phone || "";
  const envio = pedido.shippingLine ? Number(pedido.shippingLine.originalPriceSet.shopMoney.amount) : 0;
  const totalProductos = items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0);

  return {
    pedido: pedido.name,
    creado: pedido.createdAt,
    registrable: problemas.length === 0,
    problemas: problemas,
    venta: {
      opId: PREFIJO_OPERACION + pedido.name,
      tipoOp: TIPO_OPERACION,
      anticipo: totalProductos + envio,   // ya pagado completo en Shopify
      sucursal: sucursal,
      canal: esDomicilio ? CANAL_DOMICILIO : CANAL_RECOGER,
      metodoPago: METODO_PAGO_SHOPIFY,
      items: items,
      envio: envio,
      fechaEntrega: fechaEntregaISO_(atributos["Local delivery date"] || atributos["Pickup date"]),
      cliente: { nombre: nombre || "Cliente Shopify " + pedido.name, telefono: telefono, email: pedido.email || "" },
      motivo: "Pedido en línea " + pedido.name
    }
  };
}

// En "recoger en tienda" Shopify pone como título del envío el nombre del punto
// de recolección ("La Tarta Vasca" = Cuajimalpa, "La Tarta Vasca Polanco").
function sucursalDeRecoleccion_(tituloEnvio) {
  const t = String(tituloEnvio).toLowerCase();
  return SUCURSALES_RECOGER.filter(s => t.indexOf(s.toLowerCase()) !== -1)[0] || SUCURSAL_ENVIOS;
}

// "Saturday, 03 October 2026" -> "2026-10-03" (formato de la app de entregas).
function fechaEntregaISO_(texto) {
  if (!texto) return "";
  const meses = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  const m = String(texto).toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (!m || !meses[m[2]]) return "";
  return m[3] + "-" + ("0" + meses[m[2]]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
}

// Titulo del producto en Shopify -> sabor de la hoja. Gana el sabor con más
// palabras contenidas en el titulo ("Queso & Frutos Rojos" -> Frutos Rojos,
// no Queso). La etiqueta sabor:<nombre> del sincronizador no viaja en el
// pedido, por eso se empata por nombre.
function saborDeProducto_(titulo, sabores) {
  const palabrasTitulo = palabrasClave_(titulo);
  let mejor = null, masPalabras = 0;
  sabores.forEach(sabor => {
    const palabras = palabrasClave_(sabor);
    const todas = palabras.length && palabras.every(p => palabrasTitulo.indexOf(p) !== -1);
    if (todas && palabras.length > masPalabras) { mejor = sabor; masPalabras = palabras.length; }
  });
  return mejor;
}

function redactarReporteVentas_(traducidos) {
  const linea = t => {
    const v = t.venta;
    const productos = v.items.map(i => i.cantidad + " " + (i.sabor || "?") + " " + (i.tamano || "?") + " $" + i.precioUnitario).join(", ");
    return "  • " + t.pedido + " · " + v.sucursal + " · " + v.canal + (v.fechaEntrega ? " · entrega " + v.fechaEntrega : "") +
      " · " + productos + (v.envio ? " · envío $" + v.envio : "") + (t.problemas.length ? "  → NO: " + t.problemas.join("; ") : "");
  };
  const si = traducidos.filter(t => t.registrable), no = traducidos.filter(t => !t.registrable);
  return "VENTAS DE SHOPIFY → SISTEMA (solo revisar: no se registró nada)\n" +
    "Entrarían como RESERVAS pagadas (método Shopify); la sucursal las convierte en venta el día de la entrega.\n\n" +
    "Se registrarían (" + si.length + ")\n" + (si.map(linea).join("\n") || "  —") + "\n\n" +
    "No se registrarían (" + no.length + ")\n" + (no.map(linea).join("\n") || "  —") + "\n";
}

// ---------------------------------------------------------------- Registrar en el POS

// Corrida manual o del disparador. Respeta VENTAS_MODO (ver encabezado).
function registrarPedidosShopify() {
  const props = PropertiesService.getScriptProperties();
  const modo = String(props.getProperty("VENTAS_MODO") || "REVISAR").toUpperCase();
  if (modo === "REVISAR") return revisarVentasShopify();

  const candado = LockService.getScriptLock();
  if (!candado.tryLock(30000)) return null;   // otra corrida está registrando
  try {
    const token = obtenerToken_();
    if (!token) throw new Error("Falta la llave de Shopify (ver GUIA_LLAVE.md).");
    const desde = props.getProperty("VENTAS_DESDE");
    if (!desde) throw new Error("Falta VENTAS_DESDE: sin fecha de inicio no se registra nada, para no duplicar pedidos viejos.");
    const hoja = leerHoja_();
    const pedidos = leerPedidosAdmin_(token, DIAS_A_REVISAR);
    const elegidos = elegirPorRegistrar_(pedidos.map(p => traducirPedido_(p, hoja)), pedidos, {
      modo: modo, desde: desde, soloPedido: props.getProperty("VENTAS_SOLO_PEDIDO"),
      yaRegistrado: nombre => !!props.getProperty("REG_" + nombre)
    });
    const resultados = elegidos.map(t => registrarUnPedido_(t, props));
    if (resultados.length) {
      const texto = redactarReporteRegistro_(resultados);
      Logger.log(texto);
      const conError = resultados.filter(r => !r.ok).length;
      MailApp.sendEmail(correoReporte_(), (conError ? "⚠️ " : "") + "Tarta Vasca — " + (resultados.length - conError) +
        " pedidos de Shopify registrados en el sistema" + (conError ? " (" + conError + " con error)" : ""), texto);
    } else Logger.log("No hay pedidos nuevos por registrar.");
    return resultados;
  } finally {
    candado.releaseLock();
  }
}

// Funcion pura: de los pedidos traducidos, cuáles se mandan al POS en esta corrida.
function elegirPorRegistrar_(traducidos, pedidos, op) {
  const creado = {};
  pedidos.forEach(p => { creado[p.name] = p.createdAt; });
  return traducidos.filter(t => {
    if (!t.registrable || op.yaRegistrado(t.pedido)) return false;
    if (op.modo === "UNO") return t.pedido === op.soloPedido;
    if (op.modo === "APLICAR") return new Date(creado[t.pedido]) >= new Date(op.desde);
    return false;
  });
}

function registrarUnPedido_(t, props) {
  const sufijo = SUFIJO_PROPIEDAD_SUCURSAL[t.venta.sucursal];
  try {
    const tokenPos = sesionPos_(sufijo, props);
    let res = llamarPos_(Object.assign({ accion: "registrarVenta", token: tokenPos }, t.venta));
    if (!res.ok && /sesi[oó]n/i.test(res.error || "")) {   // token del POS vencido: entrar de nuevo una vez
      CacheService.getScriptCache().remove("pos_token_" + sufijo);
      res = llamarPos_(Object.assign({ accion: "registrarVenta", token: sesionPos_(sufijo, props) }, t.venta));
    }
    if (!res.ok) return { pedido: t.pedido, venta: t.venta, ok: false, error: res.error };
    props.setProperty("REG_" + t.pedido, res.idVenta || "registrado");
    return { pedido: t.pedido, venta: t.venta, ok: true, idVenta: res.idVenta, aviso: res.mensaje };
  } catch (e) {
    return { pedido: t.pedido, venta: t.venta, ok: false, error: e.message };
  }
}

// Token del POS para el usuario de esa sucursal; se guarda 6 h en cache.
function sesionPos_(sufijo, props) {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get("pos_token_" + sufijo);
  if (guardado) return guardado;
  const usuario = props.getProperty("POS_USUARIO_" + sufijo), password = props.getProperty("POS_PASSWORD_" + sufijo);
  if (!usuario || !password) throw new Error("Faltan POS_USUARIO_" + sufijo + " / POS_PASSWORD_" + sufijo + " en las propiedades.");
  const res = llamarPos_({ accion: "login", usuario: usuario, password: password, device_info: "Sincronizador Shopify", device_id: "sync-shopify-" + sufijo });
  if (!res.ok) throw new Error("El sistema rechazó al usuario " + usuario + ": " + res.error);
  cache.put("pos_token_" + sufijo, res.token, 6 * 60 * 60);
  return res.token;
}

function llamarPos_(cuerpo) {
  const respuesta = UrlFetchApp.fetch(POS_API_URL, {
    method: "post", contentType: "text/plain", payload: JSON.stringify(cuerpo), muteHttpExceptions: true, followRedirects: true
  });
  try { return JSON.parse(respuesta.getContentText()); }
  catch (e) { return { ok: false, error: "Respuesta no válida del sistema (HTTP " + respuesta.getResponseCode() + ")" }; }
}

function redactarReporteRegistro_(resultados) {
  return "PEDIDOS DE SHOPIFY → SISTEMA (se registraron como RESERVAS pagadas, método Shopify)\n" +
    "La sucursal las convierte en venta el día de la entrega desde Ventas → Apartados.\n\n" +
    resultados.map(r => "  • " + r.pedido + " · " + r.venta.sucursal + " · " + r.venta.canal +
      (r.venta.fechaEntrega ? " · entrega " + r.venta.fechaEntrega : "") + " · $" + r.venta.anticipo +
      (r.ok ? " → ✅ " + r.idVenta : " → ❌ " + r.error)).join("\n") + "\n";
}

// Prueba de conexión: entra al POS con los usuarios de cada sucursal y lee sus
// permisos. No registra nada.
function probarConexionPos() {
  const props = PropertiesService.getScriptProperties();
  const lineas = Object.keys(SUFIJO_PROPIEDAD_SUCURSAL).map(sucursal => {
    const sufijo = SUFIJO_PROPIEDAD_SUCURSAL[sucursal];
    try {
      CacheService.getScriptCache().remove("pos_token_" + sufijo);
      const res = llamarPos_({ accion: "getMisPermisos", token: sesionPos_(sufijo, props) });
      return sucursal + ": " + (res.ok !== false ? "✅ entra al sistema" + (res.permisos && res.permisos.puedeVender ? " y puede registrar ventas" : "") : "❌ " + res.error);
    } catch (e) {
      return sucursal + ": ❌ " + e.message;
    }
  });
  Logger.log("PRUEBA DE CONEXIÓN CON EL SISTEMA (no se registró nada)\n" + lineas.join("\n"));
  return lineas;
}
