// =================================================================================
// SETUP v4.3 — ejecutar UNA VEZ desde el editor
// =================================================================================
function setupV43() {
const ss = SpreadsheetApp.getActiveSpreadsheet();
let creadas = [];
// 1. Hoja Sesiones_Activas
if (!ss.getSheetByName("Sesiones_Activas")) {
const h = ss.insertSheet("Sesiones_Activas");
h.setTabColor("#5DADE2");
const headers = ["token", "usuario", "rol", "sucursal", "device_info", "creado", "ultimoAcceso"];
h.getRange(1, 1, 1, headers.length).setValues([headers]);
h.getRange(1, 1, 1, headers.length).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
h.setFrozenRows(1);
h.setColumnWidth(1, 300); h.setColumnWidth(5, 220);
creadas.push("Sesiones_Activas");
}
// 2. Hoja Auditoria_Eliminados
if (!ss.getSheetByName("Auditoria_Eliminados")) {
const h = ss.insertSheet("Auditoria_Eliminados");
h.setTabColor("#E74C3C");
const headers = ["timestamp", "hoja_origen", "id_origen", "tipo_mov", "usuario", "motivo", "datos_originales", "stock_revertido"];
h.getRange(1, 1, 1, headers.length).setValues([headers]);
h.getRange(1, 1, 1, headers.length).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
h.setFrozenRows(1);
h.setColumnWidth(1, 160); h.setColumnWidth(7, 360);
creadas.push("Auditoria_Eliminados");
}
// 3. Asegurar columna PermisosExtra en Usuarios
const hUsu = ss.getSheetByName("Usuarios");
if (hUsu) {
const headers = hUsu.getRange(1, 1, 1, hUsu.getLastColumn()).getValues()[0];
if (headers.indexOf("PermisosExtra") === -1) {
const newCol = hUsu.getLastColumn() + 1;
hUsu.getRange(1, newCol).setValue("PermisosExtra");
hUsu.getRange(1, newCol).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
}
}
// 4. Migrar tokens viejos de Configuración → Sesiones_Activas (best effort)
try {
const hConf = ss.getSheetByName("Configuración");
if (hConf) {
const datos = hConf.getDataRange().getValues();
const hSes = ss.getSheetByName("Sesiones_Activas");
const ahora = new Date().toISOString();
for (let i = 1; i < datos.length; i++) {
const key = String(datos[i][0] || "");
const token = String(datos[i][1] || "");
if (key.startsWith("token_") && token) {
const usuario = key.replace("token_", "");
const partes = token.split("|");
const rol = partes[1] || "";
const sucursal = getSucursalUsuario(usuario);
hSes.appendRow([token, usuario, rol, sucursal, "migrado-v4.3", ahora, ahora]);
}
}
}
} catch(e) { Logger.log("Migración tokens: " + e.message); }
const msg = creadas.length > 0
? "✅ Setup v4.3 listo.\n\nHojas creadas: " + creadas.join(", ") + "\nTokens migrados de Configuración → Sesiones_Activas."
: "✅ Setup v4.3 ya estaba aplicado. Sin cambios.";
try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log(msg); }
return msg;
}
// =================================================================================
// ENTRADA HTTP
// =================================================================================
function doPost(e) {
try {
const body = JSON.parse(e.postData.contents);
return respuesta(despachar(body));
} catch (err) {
return respuesta({ ok: false, error: "Error interno: " + err.message });
}
}
function doGet(e) {
try {
if (e && e.parameter && e.parameter.data) {
const body = JSON.parse(e.parameter.data);
return respuesta(despachar(body));
}
return respuesta({ ok: true, mensaje: "Tarta Vasca API v4.3 activa" });
} catch(err) {
return respuesta({ ok: false, error: err.message });
}
}
function despachar(body) {
const accion = body.accion;
if (accion === "login") return login(body);
if (accion === "logout") return logout(body);
const sesion = validarToken(body.token);
if (!sesion.ok) return { ok: false, error: "Sesión inválida o expirada. Vuelve a iniciar sesión." };
switch (accion) {
case "bootstrap":               return bootstrap(body, sesion);   // v7.1 — arranque en 1 sola peticion
case "getStock":                return getStock(body, sesion);
case "altaProduccion":          return altaProduccion(body, sesion);
case "ajustarInventario":       return ajustarInventario(body, sesion);  // Ajuste por conteo fisico (Owner)
case "registrarVenta":          return registrarVenta(body, sesion);
case "registrarMerma":          return registrarMerma(body, sesion);
case "getCatalogo":             return getCatalogo(sesion);
case "altaSabor":               return altaSabor(body, sesion);
case "bajaSabor":               return bajaSabor(body, sesion);
case "altaTamano":              return altaTamano(body, sesion);
case "bajaTamano":              return bajaTamano(body, sesion);
case "altaCanal":               return altaCanal(body, sesion);
case "bajaCanal":               return bajaCanal(body, sesion);
case "getZonasEnvio":           return getZonasEnvio(sesion);
case "saveZonaEnvio":           return saveZonaEnvio(body, sesion);
case "deleteZonaEnvio":         return deleteZonaEnvio(body, sesion);
case "registrarNota":           return registrarNota(body, sesion);                  // Notas del creador
case "getNotas":                return getNotas(body, sesion);
case "setNotaEstado":           return setNotaEstado(body, sesion);
case "getCanalPrecios":         return getCanalPrecios(sesion);
case "saveCanalPrecio":         return saveCanalPrecio(body, sesion);
case "deleteCanalPrecio":       return deleteCanalPrecio(body, sesion);
case "getPrecios":              return getPrecios(sesion);
case "updatePrecio":            return updatePrecio(body, sesion);
case "actualizarMetodoVenta":   return actualizarMetodoVenta(body, sesion);
case "getRutasAbiertas":        return getRutasAbiertas(body, sesion);
case "archivarRuta":            return archivarRuta(body, sesion);
case "actualizarMetodoVentaBatch": return actualizarMetodoVentaBatch(body, sesion);
case "getRutasCerradas":        return getRutasCerradas(body, sesion);
case "getUsuarios":             return getUsuarios(sesion);
case "crearUsuario":            return crearUsuario(body, sesion);
case "editarUsuario":           return editarUsuario(body, sesion);   // NUEVO v4.3
case "toggleUsuario":           return toggleUsuario(body, sesion);
case "cambiarPassword":         return cambiarPassword(body, sesion);
case "getAuditoria":            return getAuditoria(sesion);
case "buscarCliente":           return buscarCliente(body, sesion);
case "getHistorialCliente":     return getHistorialCliente(body, sesion);
case "getVentas":               return getVentas(body, sesion);
case "getInsumos":              return getInsumos(sesion);
case "saveInsumo":              return saveInsumo(body, sesion);
case "deleteInsumo":            return deleteInsumo(body, sesion);
case "getRecetas":              return getRecetas(sesion);
case "saveReceta":              return saveReceta(body, sesion);
case "deleteRecetaIngrediente": return deleteRecetaIngrediente(body, sesion);
case "getCalculoCosto":         return getCalculoCosto(body, sesion);
case "bulkLoadInsumos":         return bulkLoadInsumos(body, sesion);
case "bulkLoadReceta":          return bulkLoadReceta(body, sesion);
case "iaProcesar":              return iaProcesar(body, sesion);             // v6.5d proxy IA
case "repararPreciosSabores":   return repararPreciosSabores(sesion);
case "getGastos":               return getGastos(sesion);
case "saveGasto":               return saveGasto(body, sesion);
case "deleteGasto":             return deleteGasto(body, sesion);
case "getObjetivos":            return getObjetivos(sesion);
case "saveObjetivo":            return saveObjetivo(body, sesion);
case "deleteObjetivo":          return deleteObjetivo(body, sesion);
case "limpiarDatos":            return limpiarDatos(sesion);
case "getStockMinMax":          return getStockMinMax(sesion);
case "saveStockMinMax":         return saveStockMinMax(body, sesion);
case "getMensajes":             return getMensajes(sesion);
case "enviarMensaje":           return enviarMensaje(body, sesion);
case "marcarLeidoMensaje":      return marcarLeidoMensaje(body, sesion);
case "getAlertas":              return getAlertas(sesion);
case "getComisionesConfig":     return getComisionesConfig(sesion);
case "saveComisionConfig":      return saveComisionConfig(body, sesion);
case "generarReciboPDF":        return generarReciboPDF(body.idVenta||body.id, sesion, body.soloHtml===true);
    case "enviarReciboEmail":       return enviarReciboEmail(body.idVenta||body.id, body.email, sesion);
    case "auditarConsistencia":     return auditarConsistencia();
    case "migrarReservasFisicas":   soloOwner(sesion); return migrarReservasFisicas();
    case "registrarTransferencia":  return registrarTransferencia(body, sesion);
case "getTransferencias":       return getTransferencias(sesion);
case "confirmarTransferencia":  return confirmarTransferencia(body, sesion);
case "getMisPermisos":          return getMisPermisos(sesion);
case "listarMovimientosRecientes": return listarMovimientosRecientes(body, sesion);  // NUEVO v4.3
case "eliminarMovimiento":      return eliminarMovimiento(body, sesion);              // NUEVO v4.3
case "getSesionesActivas":      return getSesionesActivas(body, sesion);              // NUEVO v4.3
case "abrirDia":                return abrirDia(body, sesion);                        // NUEVO v4.4
case "cerrarDia":               return cerrarDia(body, sesion);                       // NUEVO v4.4
case "getDiaActual":            return getDiaActual(body, sesion);                    // NUEVO v4.4
// ===== CONTROL DE CAJA (v7) =====
case "cajaEstado":              return cajaEstado(body, sesion);
case "cajaAbrir":               return cajaAbrir(body, sesion);
case "cajaCerrar":              return cajaCerrar(body, sesion);
case "cajaFijarSaldo":          return cajaFijarSaldo(body, sesion);                  // solo Dueña
case "cajaAportacion":          return cajaAportacion(body, sesion);
case "retiroRegistrar":         return retiroRegistrar(body, sesion);
case "retiroAutorizar":         return retiroAutorizar(body, sesion);
case "retiroRechazar":          return retiroRechazar(body, sesion);
case "retiroSubirEvidencia":    return retiroSubirEvidencia(body, sesion);
case "retiroConciliar":         return retiroConciliar(body, sesion);
case "getRetiros":              return getRetiros(body, sesion);
case "exportarDisponibleDocx":  return exportarDisponibleDocx(body, sesion);          // NUEVO v4.4
case "getAnalisisDemanda":      return getAnalisisDemanda(body, sesion);              // NUEVO v4.4
case "getSeguimientoVentas":    return getSeguimientoVentas(body, sesion);            // NUEVO v4.4
case "getEstadoResultados":     return getEstadoResultados(body, sesion);             // NUEVO v4.5.13 (P&L)
case "recalcularUtilidades":    soloOwner(sesion); recalcularUtilidades(SpreadsheetApp.getActiveSpreadsheet()); return { ok:true, mensaje:"Utilidades recalculadas con costos corregidos." };  // FIX costos
case "getPedidoSugerido":       return getPedidoSugerido(body, sesion);               // NUEVO v4.5.16 (cocinada)
case "getProduccionManana":     return getProduccionManana(body, sesion);             // Adecuacion 3
case "repInstalarTriggerProduccion": return repInstalarTriggerProduccion();           // Adecuacion 3
case "getReservas":             return getReservas(body, sesion);                     // NUEVO v4.4b
case "getApartados":            return getApartados(body, sesion);                     // Adecuacion 2
case "registrarApartado":       return registrarVenta(body, sesion);                  // Adecuacion 2 (extiende reserva)
case "convertirReservaAVenta":  return convertirReservaAVenta(body, sesion);          // NUEVO v4.4b
case "liberarReserva":          return liberarReserva(body, sesion);                  // NUEVO v4.4b
case "getSucursalesUsuario":    return getSucursalesUsuario(body, sesion);            // NUEVO v4.4b
// ===== REPARTO A DOMICILIO =====
case "repartoEstado":        return repartoEstado(body, sesion);
case "repartoGeocode":       return repartoGeocode(body, sesion);
case "repartoAddPedido":     return repartoAddPedido(body, sesion);
case "repartoDelPedido":     return repartoDelPedido(body, sesion);
case "repartoProponer":      return repartoProponer(body, sesion);
case "repartoPlanear":       return repartoPlanear(body, sesion);
case "repartoSetChofer":     return repartoSetChofer(body, sesion);
case "repartoSetResultado":  return repartoSetResultado(body, sesion);
case "repartoSetFormaPago":  return repartoSetFormaPago(body, sesion);
case "repartoSetEfectivo":   return repartoSetEfectivo(body, sesion);
case "repartoCerrarRuta":    return repartoCerrarRuta(body, sesion);
case "repartoReprogramar":   return repartoReprogramar(body, sesion);
case "repartoDelRuta":       return repartoDelRuta(body, sesion);
case "repartoLiberar":       return repartoLiberar(body, sesion);                  // Liberar tarta apartada (ruta)
default: return { ok: false, error: "Acción desconocida: " + accion };
}
}
// =================================================================================
// ARRANQUE EN UNA SOLA PETICION (v7.1)
// =================================================================================
// La app pedia catalogo, precios, stock, canal-precios, comisiones y recetas por
// separado — y cargarPrecios volvia a pedir el catalogo — o sea 6 o 7 viajes de 1 a 2
// segundos cada uno antes de poder vender. Aqui se responden todos juntos.
// Cada bloque va en su propio try: si uno truena, los demas llegan igual y el frontend
// completa lo que falte por su ruta de siempre.
function bootstrap(body, sesion) {
const salida = { ok: true };
function bloque(nombre, fn) {
try { salida[nombre] = fn(); }
catch (e) { salida[nombre] = { ok: false, error: String(e && e.message || e) }; }
}
bloque("catalogo",     function () { return getCatalogo(sesion); });
bloque("precios",      function () { return getPrecios(sesion); });
bloque("stock",        function () { return getStock(body, sesion); });
bloque("canalPrecios", function () { return getCanalPrecios(sesion); });
bloque("comisiones",   function () { return getComisionesConfig(sesion); });
bloque("recetas",      function () { return getRecetas(sesion); });
return salida;
}
function respuesta(data) {
return ContentService
.createTextOutput(JSON.stringify(data))
.setMimeType(ContentService.MimeType.JSON);
}
