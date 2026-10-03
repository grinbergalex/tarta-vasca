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
// Lo registra el usuario "shopify" del POS (rol Vendedor, Cuajimalpa) con el
// método de pago "Shopify" (comisión 3% en la hoja Comisiones).
//
// Fase actual: SOLO REVISAR. revisarVentasShopify() lee los pedidos y manda
// por correo cómo se registraría cada uno, sin llamar al POS.
//
// Necesita la llave de Shopify con el permiso read_orders (ver GUIA_LLAVE.md).
// ============================================================================

const SUCURSAL_TIENDA_EN_LINEA = "Cuajimalpa";   // la sucursal de Shopify es Av Noche de Paz 14, Cuajimalpa
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
    "shippingLine { title originalPriceSet { shopMoney { amount } } } customer { firstName lastName } " +
    "shippingAddress { name phone zip } phone email customAttributes { key value } " +
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

  const nombre = pedido.customer ? [pedido.customer.firstName, pedido.customer.lastName].filter(Boolean).join(" ")
    : (pedido.shippingAddress ? pedido.shippingAddress.name : "");
  const telefono = pedido.phone || (pedido.shippingAddress ? pedido.shippingAddress.phone : "") || "";
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
      sucursal: SUCURSAL_TIENDA_EN_LINEA,
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
    return "  • " + t.pedido + " · " + v.canal + (v.fechaEntrega ? " · entrega " + v.fechaEntrega : "") +
      " · " + productos + (v.envio ? " · envío $" + v.envio : "") + (t.problemas.length ? "  → NO: " + t.problemas.join("; ") : "");
  };
  const si = traducidos.filter(t => t.registrable), no = traducidos.filter(t => !t.registrable);
  return "VENTAS DE SHOPIFY → SISTEMA (solo revisar: no se registró nada)\n" +
    "Entrarían como RESERVAS pagadas (método Shopify); la sucursal las convierte en venta el día de la entrega.\n\n" +
    "Se registrarían (" + si.length + ")\n" + (si.map(linea).join("\n") || "  —") + "\n\n" +
    "No se registrarían (" + no.length + ")\n" + (no.map(linea).join("\n") || "  —") + "\n";
}
