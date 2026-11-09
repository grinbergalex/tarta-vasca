// ============================================================================
// v9 — LOS PEDIDOS DE MAITE SE ANOTAN EN EL EXCEL DE PEDIDOS (decisión de Alex, 1-nov; recoger, 8-nov)
//
// Van al Excel los de domicilio y los de recoger para mañana o después. Los de recoger HOY no: esos se resuelven en la tienda
// con lo que ya hay (decisión de Alex, 8-nov). Un pedido para recoger lleva en la dirección "Recoger en <sucursal> · <hora>".
//
// Las rutas se planean a mano con el Excel donde caen todos los pedidos ("Pedidos Tarta Vasca (Respuestas)", la hoja del
// formulario). Un pedido a domicilio de Maite se anota ahí igual que lo haría una persona: un renglón al final con marca de
// hora, nombre, fecha de entrega, dirección, teléfono y un número en la columna de cada sabor y tamaño. En la columna 58 (vacía
// y sin título) va "Maite · TV-… · pago · total" para saber de dónde salió. Lo que no tenga columna en el formulario (un sabor
// nuevo) se agrega a la dirección entre corchetes, para que nadie lo pierda.
// Corre en cada revisión del tablero (cada 5 min), no en el turno de Maite (abrir otro Excel tarda). Nunca anota dos veces:
// la hoja Excel_Pedidos_Anotados del Sistema guarda cada llave anotada. Sin la clave excel_pedidos_id no hace nada.
// ============================================================================

function _excelNormalizar(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

// "Tarta de LOTUS (CHICA 2 porciones $240)" -> "Individual"
function _excelTamanoDe(encabezado) {
  const t = _excelNormalizar(encabezado);
  if (/\b(chica|individual)\b/.test(t)) return "Individual";
  if (/\bmedian[ao]\b/.test(t)) return "Mediana";
  if (/\bgrande\b/.test(t)) return "Grande";
  return "";
}

// "Tarta tradicional de queso (MEDIANA, $420)" -> "queso"; "Dulce de leche" -> "dulce leche". El mismo cálculo sirve para el sabor
// del menú y para el encabezado del formulario, así coinciden aunque cambien acentos, mayúsculas o "Tarta de".
function _excelClaveSabor(texto) {
  return _excelNormalizar(texto).replace(/\(.*?\)/g, " ").replace(/\b(tarta|de|del|tradicional|chica|individual|mediana|mediano|grande)\b/g, " ")
    .replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}

// { "queso|Mediana": columna (1 = A) }. Si un sabor y tamaño aparece dos veces, gana la columna más a la derecha (la más nueva).
function _excelMapaColumnas(encabezados) {
  const mapa = {};
  encabezados.forEach(function (enc, i) {
    const tamano = _excelTamanoDe(enc), sabor = _excelClaveSabor(enc);
    if (i >= 5 && tamano && sabor) mapa[sabor + "|" + tamano] = i + 1;
  });
  return mapa;
}

// Columna del sabor y tamaño. Si no hay una igual, se acepta la única cuyo nombre empiece igual ("Taro" -> "Taro velvet").
function _excelColumna(mapa, sabor, tamano) {
  const clave = _excelClaveSabor(sabor);
  if (mapa[clave + "|" + tamano]) return mapa[clave + "|" + tamano];
  const parecidas = Object.keys(mapa).filter(function (k) { const p = k.split("|"); return p[1] === tamano && p[0].indexOf(clave + " ") === 0; });
  return parecidas.length === 1 ? mapa[parecidas[0]] : null;
}

function _excelTelefono(contacto) {
  const t = String(contacto || "").replace(/\D/g, "");
  return t.length >= 10 ? t : "";
}

// El renglón como lo capturaría una persona. Devuelve { fila, sinColumna: ["1 Elote Grande", …] }.
function _excelFila(p, mapa, columnas) {
  const fila = new Array(Math.max(columnas, EXCEL_PEDIDOS_COL_NOTA)).fill("");
  const sinColumna = [];
  p.items.forEach(function (texto) {
    const x = _entregasPieza(texto);
    const col = x ? _excelColumna(mapa, x.sabor, x.tamano) : null;
    if (col) fila[col - 1] = (Number(fila[col - 1]) || 0) + x.cantidad;
    else sinColumna.push(texto);
  });
  const p3 = String(p.fechaEntrega).split("-");
  fila[0] = new Date();
  fila[1] = p.cliente || "";
  fila[2] = new Date(Number(p3[0]), Number(p3[1]) - 1, Number(p3[2]));
  fila[3] = _excelDondeSeEntrega(p) + (sinColumna.length ? " [+ " + sinColumna.join(", ") + "]" : "");
  fila[4] = _excelTelefono(p.contacto);
  fila[EXCEL_PEDIDOS_COL_NOTA - 1] = ["Maite", p.referencia, p.pago, "$" + p.total].filter(Boolean).join(" · ");
  return { fila: fila, sinColumna: sinColumna };
}

function _excelDondeSeEntrega(p) {
  if (p.canal === BOT_CANAL_DOMICILIO) return p.direccion || "";
  return ["Recoger en " + p.sucursal, p.hora].filter(Boolean).join(" · ");
}

// Domicilio siempre; recoger solo si es para un día después de hoy.
function _excelVaAlExcel(p, hoyIso) {
  return p.canal === BOT_CANAL_DOMICILIO ? p.fechaEntrega >= hoyIso : p.fechaEntrega > hoyIso;
}

function _excelRegistroHoja(ss) {
  return _hojaDeRegistro(ss, EXCEL_PEDIDOS_REGISTRO, ["Llave", "Anotado el", "Renglón en el Excel", "Fecha de entrega", "Cliente", "Sin columna en el formulario"], [110, 130, 130, 120, 180, 300]);
}

function _excelLlavesAnotadas(ss) {
  const hoja = _excelRegistroHoja(ss);
  const llaves = {};
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues().forEach(function (f) { llaves[String(f[0])] = true; });
  return llaves;
}

// El pedido se cerró (o quedó por revisar): se marca en su renglón del Excel, en la columna de estado. Solo los que Maite anotó ahí
// (los busca en Excel_Pedidos_Anotados). Nunca lanza error: marcar el Excel no debe tirar la entrega en el POS.
function excelPedidoMarcarEstado(ss, referencia, estado) {
  try {
    const id = String(_cfgVal(ss, EXCEL_PEDIDOS_CLAVE_ID, "")).trim();
    const registro = _excelRegistroHoja(ss);
    if (!id || !referencia || registro.getLastRow() < 2) return false;
    const filas = registro.getRange(2, 1, registro.getLastRow() - 1, 3).getValues();
    const anotado = filas.filter(function (f) { return String(f[0]) === String(referencia); })[0];
    if (!anotado) return false;
    const texto = { ENTREGADO: "✅ ENTREGADO", "NO RECOGIDO": "✗ NO RECOGIDO", "POR REVISAR": "⏳ POR REVISAR" }[estado] || estado;
    SpreadsheetApp.openById(id).getSheetByName(EXCEL_PEDIDOS_HOJA).getRange(Number(anotado[2]), EXCEL_PEDIDOS_COL_ESTADO)
      .setValue(texto + " " + Utilities.formatDate(new Date(), TZ_MX, "dd/MM HH:mm"));
    return true;
  } catch (e) { Logger.log("Excel de pedidos, estado de " + referencia + ": " + e); return false; }
}

// pedidos: los que ya leyó el tablero. Devuelve cuántos se anotaron.
function pedidosMaiteAlExcel(ss, pedidos) {
  const id = String(_cfgVal(ss, EXCEL_PEDIDOS_CLAVE_ID, "")).trim();
  if (!id) return 0;
  const hoyIso = Utilities.formatDate(new Date(), TZ_MX, "yyyy-MM-dd");
  const anotadas = _excelLlavesAnotadas(ss);
  const nuevos = pedidos.filter(function (p) {
    return BOT_ORIGENES.indexOf(p.origen) !== -1 && PEDIDO_ESTADOS_ABIERTOS.indexOf(p.estado) !== -1
      && p.referencia && !anotadas[p.referencia] && _excelVaAlExcel(p, hoyIso);
  });
  if (!nuevos.length) return 0;
  const excel = SpreadsheetApp.openById(id).getSheetByName(EXCEL_PEDIDOS_HOJA);
  const columnas = excel.getLastColumn();
  const mapa = _excelMapaColumnas(excel.getRange(1, 1, 1, columnas).getValues()[0]);
  const registro = _excelRegistroHoja(ss);
  nuevos.forEach(function (p) {
    const armado = _excelFila(p, mapa, columnas);
    excel.appendRow(armado.fila);
    registro.appendRow([p.referencia, _fechaHora(new Date()), excel.getLastRow(), p.fechaEntrega, p.cliente, armado.sinColumna.join(", ")]);
  });
  return nuevos.length;
}
