// ============================================================================
// SINCRONIZADOR HOJA -> SHOPIFY — La Tarta Vasca
//
// La hoja "Tarta Vasca — Sistema" es la fuente unica de verdad: lo que ahi
// esta activo es lo que se vende en latartavasca.com, con sus precios.
//
// Dos modos (propiedad del script MODO):
//   REVISAR (default) — compara y avisa por correo. No escribe nada.
//   APLICAR           — ademas corrige Shopify: precios, crea sabores nuevos
//                       (en borrador hasta que tengan foto), publica los que ya
//                       tienen foto y esconde lo que ya no esta en la hoja.
//
// Llave de Shopify: propiedades SHOPIFY_CLIENT_ID y SHOPIFY_CLIENT_SECRET de
// una app del Dev Dashboard instalada en la tienda (client credentials grant).
// Sin llave solo se puede REVISAR contra la pagina publica.
//
// Freno de seguridad: si una corrida quiere cambiar demasiado de golpe (p. ej.
// porque la hoja se leyo mal), no aplica nada y avisa. Ver LIMITES.
//
// El manifiesto pide el permiso completo de hojas solo porque
// SpreadsheetApp.openById no acepta el de solo lectura; nunca se escribe en la hoja.
//
// Proyecto de Apps Script APARTE del sistema de sucursales (backend/): no
// comparte namespace con el POS ni puede romperlo.
// ============================================================================

const ID_HOJA_SISTEMA = "1If_QmZL89krnRfX2DlJaHSp9VD7FE2fO766pd-rvcyI";
const URL_TIENDA = "https://latartavasca.com";
const TIENDA_MYSHOPIFY = "17g081-gu.myshopify.com";
const VERSION_API = "2025-07";
// El canal se llama distinto según el idioma de quien consulta la API.
const NOMBRES_PUBLICACION_TIENDA = ["tienda online", "online store"];

// Tamaños que se venden en linea. Otros "tamaños" de la hoja (Paquete de 6,
// AGUA) no son tartas por tamaño y no se suben.
const TAMANOS_EN_LINEA = ["Individual", "Mediana", "Grande"];
const NOMBRE_OPCION_TAMANO = "tamaño";

// Renglones tipo "Sabor" en la hoja que no son tartas.
const NO_SON_TARTAS = ["VELAS", "AGUA"];

const PREFIJO_ETIQUETA_SABOR = "sabor:";
const ETIQUETA_PENDIENTE_FOTO = "pendiente-foto";

const LIMITES = { esconder: 3, crear: 5, precios: 30 };

const DESCRIPCION_TAMANOS =
  "<div style=\"background-color: #f7efe6; padding: 14px 18px; border-radius: 10px; font-family: 'Georgia', serif; color: #5a4634; line-height: 1.7;\">" +
  "<strong>Tamaños y porciones</strong><br><strong>Individual:</strong> 12 cm de diámetro · 1 a 2 porciones<br>" +
  "<strong>Mediana:</strong> 20 cm de diámetro · 4 a 5 porciones<br><strong>Grande:</strong> 25 cm de diámetro · 10 a 12 porciones</div>";

const PALABRAS_DE_RELLENO = ["tarta", "vasca", "de", "&", "y"];

// ---------------------------------------------------------------- Entradas

// Corrida manual desde el editor: siempre manda el reporte y nunca escribe.
function revisarDiferencias() {
  return sincronizar_({ aplicar: false, correoSiempre: true });
}

// La que corre el disparador cada 15 min. Aplica solo si MODO = APLICAR.
function sincronizar() {
  const modo = String(PropertiesService.getScriptProperties().getProperty("MODO") || "REVISAR").toUpperCase();
  return sincronizar_({ aplicar: modo === "APLICAR", correoSiempre: false });
}

// Instala los dos relojes: catálogo cada 15 min (sincronizar) y pedidos cada 5 min
// (registrarPedidosShopify, que no registra nada mientras VENTAS_MODO no sea UNO o
// APLICAR). Los pedidos van más seguido porque un pedido "para hoy" aparta las
// piezas en la sucursal hasta que entra al sistema.
const MINUTOS_CATALOGO = 15;
const MINUTOS_PEDIDOS = 5;
function instalarDisparadores() {
  desinstalarDisparadores();
  ScriptApp.newTrigger("sincronizar").timeBased().everyMinutes(MINUTOS_CATALOGO).create();
  ScriptApp.newTrigger("registrarPedidosShopify").timeBased().everyMinutes(MINUTOS_PEDIDOS).create();
}

function desinstalarDisparadores() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
}

function sincronizar_(opciones) {
  const hoja = leerHoja_();
  const token = obtenerToken_();
  const productos = token ? leerProductosAdmin_(token) : leerProductosPublicos_();
  const plan = planificar_(hoja, productos);
  const resultado = { plan: plan, aplicado: [], errores: [], frenado: null, conLlave: !!token, aplico: false };

  if (opciones.aplicar) {
    if (!token) resultado.errores.push("MODO = APLICAR pero falta la llave de Shopify: no se cambió nada.");
    else {
      resultado.frenado = revisarFreno_(plan);
      if (!resultado.frenado) { aplicar_(plan, token, resultado); resultado.aplico = true; }
    }
  }

  const texto = redactarReporte_(resultado);
  Logger.log(texto);
  if (opciones.correoSiempre || debeAvisar_(resultado, texto)) {
    MailApp.sendEmail(correoReporte_(), asuntoReporte_(resultado), texto);
  }
  return resultado;
}

// ---------------------------------------------------------------- Lectura de la hoja

function leerHoja_() {
  const ss = SpreadsheetApp.openById(ID_HOJA_SISTEMA);
  const filasCatalogo = ss.getSheetByName("Catálogo").getDataRange().getValues().slice(1);
  const sabores = filasCatalogo
    .filter(f => f[0] === "Sabor" && esVerdadero_(f[2]))
    .map(f => String(f[1]).trim())
    .filter(nombre => nombre && NO_SON_TARTAS.indexOf(nombre) === -1);
  const precios = leerPreciosBase_(ss.getSheetByName("Precios").getDataRange().getValues().slice(1));
  return { sabores: sabores, precios: precios };
}

// Precio de venta normal (sin canal) por sabor y tamaño, con el _BASE_ de
// respaldo. Los renglones con canal (Rappi, etc.) no aplican a la pagina.
function leerPreciosBase_(filasPrecios) {
  const base = {};
  const porSabor = {};
  filasPrecios.forEach(f => {
    const sabor = String(f[0]).trim(), tamano = String(f[1]).trim(), canal = String(f[6] || "").trim();
    const precio = Number(f[2]);
    if (canal || TAMANOS_EN_LINEA.indexOf(tamano) === -1 || !precio) return;
    if (sabor === "_BASE_") base[tamano] = precio;
    else porSabor[sabor + "|" + tamano] = precio;
  });
  return function precioDe(sabor, tamano) {
    const especifico = porSabor[sabor + "|" + tamano];
    return especifico !== undefined ? especifico : base[tamano];
  };
}

// ---------------------------------------------------------------- Lectura de Shopify

// Forma comun: { id, titulo, estado, etiquetas, tieneFoto, esTarjetaRegalo,
//               variantes: { Individual: { id, precio }, ... } }

function leerProductosAdmin_(token) {
  const consulta = "query Productos($cursor: String) { products(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } " +
    "nodes { id title status tags isGiftCard featuredMedia { id } variants(first: 10) { nodes { id title price } } } } }";
  const productos = [];
  let cursor = null;
  do {
    const pagina = llamarShopify_(token, consulta, { cursor: cursor }).products;
    pagina.nodes.forEach(p => productos.push({
      id: p.id, titulo: p.title, estado: p.status, etiquetas: p.tags, tieneFoto: !!p.featuredMedia, esTarjetaRegalo: p.isGiftCard,
      variantes: p.variants.nodes.reduce((acc, v) => { acc[v.title] = { id: v.id, precio: Number(v.price) }; return acc; }, {})
    }));
    cursor = pagina.pageInfo.hasNextPage ? pagina.pageInfo.endCursor : null;
  } while (cursor);
  return productos;
}

// Sin llave: solo lo publicado, sin ids ni borradores.
function leerProductosPublicos_() {
  const respuesta = UrlFetchApp.fetch(URL_TIENDA + "/products.json?limit=250", { muteHttpExceptions: true });
  if (respuesta.getResponseCode() !== 200) throw new Error("No se pudo leer la tienda: HTTP " + respuesta.getResponseCode());
  return JSON.parse(respuesta.getContentText()).products.map(p => ({
    id: null, titulo: p.title, estado: "ACTIVE", etiquetas: p.tags || [], tieneFoto: p.images.length > 0, esTarjetaRegalo: false,
    variantes: p.variants.reduce((acc, v) => { acc[v.title] = { id: null, precio: Number(v.price) }; return acc; }, {})
  }));
}

// ---------------------------------------------------------------- Plan

// Compara hoja contra Shopify y devuelve lo que habria que hacer, sin hacerlo.
function planificar_(hoja, productos) {
  const plan = { precios: [], crear: [], publicar: [], esconder: [], etiquetar: [], faltaFoto: [], tamanosFaltantes: [], coinciden: [] };
  const vigentes = productos.filter(p => p.estado !== "ARCHIVED" && !p.esTarjetaRegalo);
  const usados = {};

  hoja.sabores.forEach(sabor => {
    const producto = buscarProducto_(sabor, vigentes);
    if (!producto) { plan.crear.push({ sabor: sabor, precios: preciosDeSabor_(hoja, sabor) }); return; }
    usados[producto.titulo] = true;
    if (producto.etiquetas.indexOf(PREFIJO_ETIQUETA_SABOR + sabor) === -1) plan.etiquetar.push({ sabor: sabor, producto: producto });

    const cambios = [];
    TAMANOS_EN_LINEA.forEach(tamano => {
      const variante = producto.variantes[tamano];
      const precioHoja = hoja.precios(sabor, tamano);
      if (!variante) { plan.tamanosFaltantes.push(sabor + " — " + tamano); return; }
      if (precioHoja !== undefined && precioHoja !== variante.precio) cambios.push({ tamano: tamano, varianteId: variante.id, de: variante.precio, a: precioHoja });
    });
    if (cambios.length) plan.precios.push({ sabor: sabor, producto: producto, cambios: cambios });

    if (producto.estado !== "ACTIVE") {
      if (producto.tieneFoto) plan.publicar.push({ sabor: sabor, producto: producto });
      else plan.faltaFoto.push(sabor);
    } else if (!cambios.length) plan.coinciden.push(sabor);
  });

  vigentes
    .filter(p => p.estado === "ACTIVE" && !usados[p.titulo])
    .forEach(p => plan.esconder.push({ producto: p }));
  return plan;
}

function preciosDeSabor_(hoja, sabor) {
  return TAMANOS_EN_LINEA.reduce((acc, t) => { acc[t] = hoja.precios(sabor, t); return acc; }, {});
}

// Primero por etiqueta "sabor:<nombre>" (exacta); si no, por nombre: el
// producto cuyo titulo contiene todas las palabras del sabor y tiene menos
// palabras de sobra ("Queso" -> "Tarta Vasca de Queso", no "... Queso & Frutos Rojos").
function buscarProducto_(sabor, productos) {
  const porEtiqueta = productos.filter(p => p.etiquetas.indexOf(PREFIJO_ETIQUETA_SABOR + sabor) !== -1);
  if (porEtiqueta.length) return porEtiqueta[0];
  const palabrasSabor = palabrasClave_(sabor);
  let mejor = null, menosSobrantes = Infinity;
  productos.forEach(producto => {
    const palabrasProducto = palabrasClave_(producto.titulo);
    const contieneTodas = palabrasSabor.every(p => palabrasProducto.indexOf(p) !== -1);
    const sobrantes = palabrasProducto.length - palabrasSabor.length;
    const preferible = sobrantes < menosSobrantes || (sobrantes === menosSobrantes && producto.estado === "ACTIVE");
    if (contieneTodas && preferible) { mejor = producto; menosSobrantes = sobrantes; }
  });
  return mejor;
}

function palabrasClave_(texto) {
  return String(texto).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9&]+/).filter(p => p && PALABRAS_DE_RELLENO.indexOf(p) === -1);
}

function revisarFreno_(plan) {
  const cambiosDePrecio = plan.precios.reduce((n, p) => n + p.cambios.length, 0);
  if (plan.esconder.length > LIMITES.esconder) return "esconder " + plan.esconder.length + " productos (límite " + LIMITES.esconder + ")";
  if (plan.crear.length > LIMITES.crear) return "crear " + plan.crear.length + " sabores (límite " + LIMITES.crear + ")";
  if (cambiosDePrecio > LIMITES.precios) return "cambiar " + cambiosDePrecio + " precios (límite " + LIMITES.precios + ")";
  return null;
}

// ---------------------------------------------------------------- Aplicar

function aplicar_(plan, token, resultado) {
  const intentar = (descripcion, accion) => {
    try { accion(); resultado.aplicado.push(descripcion); }
    catch (e) { resultado.errores.push(descripcion + ": " + e.message); }
  };
  plan.etiquetar.forEach(e => intentar("Etiqueta " + e.sabor + " → " + e.producto.titulo, () =>
    mutar_(token, "mutation Etiquetar($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }",
      { id: e.producto.id, tags: [PREFIJO_ETIQUETA_SABOR + e.sabor] }, "tagsAdd")));

  plan.precios.forEach(p => intentar("Precios de " + p.sabor + ": " + p.cambios.map(c => c.tamano + " $" + c.de + "→$" + c.a).join(", "), () =>
    mutar_(token, "mutation Precios($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }",
      { productId: p.producto.id, variants: p.cambios.map(c => ({ id: c.varianteId, price: c.a.toFixed(2) })) }, "productVariantsBulkUpdate")));

  plan.crear.forEach(c => intentar("Creado en borrador (falta foto): " + c.sabor, () => crearSabor_(token, c)));

  plan.publicar.forEach(p => intentar("Publicado: " + p.producto.titulo, () => {
    cambiarEstado_(token, p.producto.id, "ACTIVE");
    mutar_(token, "mutation Publicar($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }",
      { id: p.producto.id, input: [{ publicationId: idPublicacionTienda_(token) }] }, "publishablePublish");
  }));

  plan.esconder.forEach(e => intentar("Escondido (no está en la hoja): " + e.producto.titulo, () => cambiarEstado_(token, e.producto.id, "DRAFT")));
}

function crearSabor_(token, c) {
  const tamanos = TAMANOS_EN_LINEA.filter(t => c.precios[t] !== undefined);
  mutar_(token, "mutation Crear($input: ProductSetInput!) { productSet(input: $input, synchronous: true) { product { id } userErrors { field message } } }", {
    input: {
      title: "Tarta Vasca de " + c.sabor,
      vendor: "La Tarta Vasca",
      status: "DRAFT",
      tags: [PREFIJO_ETIQUETA_SABOR + c.sabor, ETIQUETA_PENDIENTE_FOTO],
      descriptionHtml: DESCRIPCION_TAMANOS,
      productOptions: [{ name: NOMBRE_OPCION_TAMANO, values: tamanos.map(t => ({ name: t })) }],
      variants: tamanos.map(t => ({ optionValues: [{ optionName: NOMBRE_OPCION_TAMANO, name: t }], price: c.precios[t].toFixed(2), inventoryPolicy: "CONTINUE" }))
    }
  }, "productSet");
}

function cambiarEstado_(token, id, estado) {
  mutar_(token, "mutation Estado($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id status } userErrors { field message } } }",
    { product: { id: id, status: estado } }, "productUpdate");
}

let idPublicacionTiendaMemo_ = null;
function idPublicacionTienda_(token) {
  if (idPublicacionTiendaMemo_) return idPublicacionTiendaMemo_;
  const publicaciones = llamarShopify_(token, "query { publications(first: 20) { nodes { id name } } }", {}).publications.nodes;
  const tienda = publicaciones.filter(p => NOMBRES_PUBLICACION_TIENDA.indexOf(String(p.name).trim().toLowerCase()) !== -1)[0];
  if (!tienda) throw new Error("No encontré el canal de la tienda en línea. Canales que veo: " + publicaciones.map(p => p.name).join(", "));
  idPublicacionTiendaMemo_ = tienda.id;
  return tienda.id;
}

// ---------------------------------------------------------------- API de Shopify

// Token de 24 h a partir de la llave (client credentials grant). Se guarda en
// cache 23 h para no pedir uno nuevo en cada corrida.
function obtenerToken_() {
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty("SHOPIFY_CLIENT_ID"), secreto = props.getProperty("SHOPIFY_CLIENT_SECRET");
  if (!clientId || !secreto) return null;
  const cache = CacheService.getScriptCache();
  const guardado = cache.get("shopify_token");
  if (guardado) return guardado;
  const respuesta = UrlFetchApp.fetch("https://" + TIENDA_MYSHOPIFY + "/admin/oauth/access_token", {
    method: "post", muteHttpExceptions: true,
    payload: { client_id: clientId, client_secret: secreto, grant_type: "client_credentials" }
  });
  if (respuesta.getResponseCode() !== 200) throw new Error("Shopify rechazó la llave: HTTP " + respuesta.getResponseCode() + " " + respuesta.getContentText());
  const token = JSON.parse(respuesta.getContentText()).access_token;
  cache.put("shopify_token", token, 23 * 60 * 60);
  return token;
}

function llamarShopify_(token, consulta, variables) {
  const respuesta = UrlFetchApp.fetch("https://" + TIENDA_MYSHOPIFY + "/admin/api/" + VERSION_API + "/graphql.json", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { "X-Shopify-Access-Token": token },
    payload: JSON.stringify({ query: consulta, variables: variables })
  });
  const cuerpo = JSON.parse(respuesta.getContentText());
  if (respuesta.getResponseCode() !== 200 || cuerpo.errors) throw new Error("Shopify: " + JSON.stringify(cuerpo.errors || respuesta.getContentText()));
  return cuerpo.data;
}

function mutar_(token, mutacion, variables, campo) {
  const errores = llamarShopify_(token, mutacion, variables)[campo].userErrors;
  if (errores && errores.length) throw new Error(errores.map(e => e.message).join("; "));
}

// ---------------------------------------------------------------- Reporte

function asuntoReporte_(r) {
  if (r.errores.length) return "⚠️ Tarta Vasca — el sincronizador tuvo errores";
  if (r.frenado) return "🛑 Tarta Vasca — el sincronizador se frenó por seguridad";
  if (r.aplicado.length) return "Tarta Vasca — se actualizaron " + r.aplicado.length + " cosas en la página";
  const n = pendientesDelPlan_(r.plan);
  return n ? "Tarta Vasca — " + n + " diferencias entre la hoja y la página" : "Tarta Vasca — la página coincide con la hoja ✅";
}

function pendientesDelPlan_(p) {
  return p.precios.length + p.crear.length + p.publicar.length + p.esconder.length + p.faltaFoto.length + p.tamanosFaltantes.length;
}

function redactarReporte_(r) {
  const p = r.plan;
  const seccion = (titulo, lista) => titulo + " (" + lista.length + ")\n" + (lista.length ? lista.map(x => "  • " + x).join("\n") : "  —") + "\n\n";
  let encabezado;
  if (r.aplico) encabezado = "SINCRONIZACIÓN HOJA → PÁGINA (se aplicaron los cambios)\n\n";
  else if (r.frenado) encabezado = "🛑 FRENO DE SEGURIDAD: la corrida quería " + r.frenado + ". No se cambió nada. Revisa la hoja.\n\n";
  else encabezado = "REVISIÓN HOJA vs PÁGINA (solo lectura, no se cambió nada)" + (r.conLlave ? "" : " — sin llave: solo se ve lo publicado") + "\n\n";

  return encabezado +
    (r.aplico ? seccion("Cambios hechos", r.aplicado) : "") +
    (r.errores.length ? seccion("Errores", r.errores) : "") +
    seccion("Sabores de la hoja que no existen en la página" + (r.aplico ? "" : " (se crearían en borrador)"), p.crear.map(c => c.sabor)) +
    seccion("Sabores que esperan foto para publicarse", p.faltaFoto) +
    seccion("Sabores con foto listos para publicar", p.publicar.map(x => x.sabor)) +
    seccion("Precios distintos a la hoja", p.precios.map(x => x.sabor + ": " + x.cambios.map(c => c.tamano + " página $" + c.de + " / hoja $" + c.a).join(", "))) +
    seccion("A la venta en la página pero NO en la hoja", p.esconder.map(x => x.producto.titulo)) +
    seccion("Tamaños que faltan en la página", p.tamanosFaltantes) +
    seccion("Sabores a la venta que coinciden con la hoja", p.coinciden);
}

// En corridas automaticas solo se manda correo si algo cambio, hubo error o
// freno, o el reporte es distinto al ultimo enviado (no spamear cada 15 min).
function debeAvisar_(resultado, texto) {
  if (resultado.aplicado.length || resultado.errores.length || resultado.frenado) return true;
  const props = PropertiesService.getScriptProperties();
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, texto));
  if (props.getProperty("ULTIMO_REPORTE") === huella) return false;
  props.setProperty("ULTIMO_REPORTE", huella);
  return true;
}

// El repo es publico: el correo no va en el codigo. Propiedad CORREO_REPORTE
// o, si no existe, la cuenta dueña del script.
function correoReporte_() {
  return PropertiesService.getScriptProperties().getProperty("CORREO_REPORTE") || Session.getEffectiveUser().getEmail();
}

function esVerdadero_(valor) {
  return valor === true || String(valor).toUpperCase() === "TRUE";
}
