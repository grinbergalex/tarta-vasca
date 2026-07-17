// =================================================================================
// AUTH — REESCRITO v4.3 con multi-sesión
// =================================================================================
function login(body) {
const { usuario, password, device_info } = body;
if (!usuario || !password) return { ok: false, error: "Usuario y contraseña requeridos." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const datos = hoja.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
const [usu, hash, rol, sucursal, activo] = datos[i];
if (usu !== usuario) continue;
if (activo !== "TRUE" && activo !== true) return { ok: false, error: "Usuario inactivo." };
if (hash !== hashSimple(password)) return { ok: false, error: "Contraseña incorrecta." };
const token = crearSesion(usuario, rol, sucursal, device_info || "sin-etiqueta");
hoja.getRange(i + 1, 6).setValue(new Date().toISOString());
registrarAuditoria(usuario, rol, "LOGIN", "Inicio de sesión" + (device_info ? " · " + device_info.substring(0, 60) : ""));
const permisos = getPermisos(rol);
// Mergear permisos extra del usuario
const extra = leerPermisosExtraUsuario(usuario);
if (extra) Object.keys(extra).forEach(k => { if (extra[k] === true) permisos[k] = true; });
return { ok: true, token, usuario, rol, sucursal, permisos };
}
return { ok: false, error: "Usuario no encontrado." };
}
function logout(body) {
const token = body.token;
if (!token) return { ok: true, mensaje: "Sin token, ya no hay sesión." };
_velTokenDrop(token); // v6.3: invalida cache de sesion
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName("Sesiones_Activas");
if (!h) return { ok: true, mensaje: "Sesión cerrada." };
const datos = h.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0] === token) {
const usuario = datos[i][1];
const rol = datos[i][2];
h.deleteRow(i + 1);
registrarAuditoria(usuario, rol, "LOGOUT", "Sesión cerrada manualmente");
return { ok: true, mensaje: "Sesión cerrada." };
}
}
return { ok: true, mensaje: "Sesión ya no existía." };
}
function getMisPermisos(sesion) {
const permisos = getPermisos(sesion.rol);
const extra = leerPermisosExtraUsuario(sesion.usuario);
if (extra) Object.keys(extra).forEach(k => { if (extra[k] === true) permisos[k] = true; });
return { ok: true, rol: sesion.rol, permisos };
}
// Crea sesión en hoja Sesiones_Activas, controla tope de sesiones concurrentes
function crearSesion(usuario, rol, sucursal, deviceInfo) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
let h = ss.getSheetByName("Sesiones_Activas");
if (!h) {
setupV43();
h = ss.getSheetByName("Sesiones_Activas");
}
const ahora = new Date();
const ahoraISO = ahora.toISOString();
const expira = ahora.getTime() + (SESION_HORAS * 60 * 60 * 1000);
const token = "TVT-" + Math.random().toString(36).substring(2, 12) + "-" + ahora.getTime() + "|" + rol + "|" + expira;
// Limpiar sesiones expiradas y contar las del usuario
const datos = h.getDataRange().getValues();
const filasMias = [];
const filasAEliminar = [];
for (let i = datos.length - 1; i >= 1; i--) {
const t = String(datos[i][0] || "");
const partes = t.split("|");
const expToken = partes.length === 3 ? parseInt(partes[2]) : 0;
const usuT = datos[i][1];
const creadoT = datos[i][5];
if (!t || ahora.getTime() > expToken) {
filasAEliminar.push(i + 1);
continue;
}
if (usuT === usuario) filasMias.push({ fila: i + 1, creado: new Date(creadoT) });
}
// Eliminar expiradas
filasAEliminar.forEach(f => h.deleteRow(f));
// Tope concurrentes — recargar datos porque las filas cambiaron
const tope = rol === "Owner" ? MAX_SESIONES_OWNER : MAX_SESIONES_NORMAL;
if (filasMias.length >= tope) {
// Recargar datos y volver a localizar las filas del usuario
const datos2 = h.getDataRange().getValues();
const propias = [];
for (let i = 1; i < datos2.length; i++) {
if (datos2[i][1] === usuario) propias.push({ fila: i + 1, creado: new Date(datos2[i][5]) });
}
propias.sort((a, b) => a.creado - b.creado);
// Eliminar las más viejas hasta dejar (tope - 1) y dar espacio a la nueva
while (propias.length >= tope) {
const masVieja = propias.shift();
h.deleteRow(masVieja.fila);
// Ajustar las filas restantes (la fila eliminada hace que las posteriores bajen 1)
propias.forEach(p => { if (p.fila > masVieja.fila) p.fila -= 1; });
}
}
h.appendRow([token, usuario, rol, sucursal, deviceInfo, ahoraISO, ahoraISO]);
return token;
}
function validarToken(token) {
// v6.3: cache primero — evita leer+escribir la hoja Sesiones en CADA peticion.
// La hoja solo se toca en cache frio o para refrescar ultimoAcceso cada 5 min.
if (!token) return { ok: false };
const partes = token.split("|");
if (partes.length !== 3) return { ok: false };
const [_idPart, rol, expira] = partes;
const ahora = new Date();
if (ahora.getTime() > parseInt(expira)) return { ok: false, error: "Sesión expirada (24h)" };
try {
  const cRaw = CacheService.getScriptCache().get("tvtok_" + _idPart);
  if (cRaw) {
    const s = JSON.parse(cRaw);
    const minutos = (ahora.getTime() - s.a) / 60000;
    if (minutos > SESION_INACTIVIDAD_MIN) {
      _velTokenDrop(token); _sesEliminarFila(token);
      return { ok: false, error: "Sesión cerrada por inactividad (" + Math.floor(minutos) + " min)" };
    }
    s.a = ahora.getTime();
    if (ahora.getTime() - (s.w || 0) > VEL_TOKEN_WRITE_MS) { _sesTouch(token, ahora); s.w = ahora.getTime(); }
    CacheService.getScriptCache().put("tvtok_" + _idPart, JSON.stringify(s), 21600);
    return { ok: true, usuario: s.u, rol: s.r, sucursal: s.s };
  }
} catch (e) {}
// Cache frio: flujo v4.4 contra la hoja + poblar cache
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName("Sesiones_Activas");
if (!h) return { ok: false };
const datos = h.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0] === token) {
// v4.4 — Check inactividad
const ultimoAccesoStr = datos[i][6];
if (ultimoAccesoStr) {
const ultimoAcceso = new Date(ultimoAccesoStr);
const minutos = (ahora - ultimoAcceso) / 60000;
if (minutos > SESION_INACTIVIDAD_MIN) {
try { h.deleteRow(i + 1); } catch(e) {}
return { ok: false, error: `Sesión cerrada por inactividad (${Math.floor(minutos)} min)` };
}
}
// Actualizar ultimoAcceso
try { h.getRange(i + 1, 7).setValue(ahora.toISOString()); } catch(e) {}
try { CacheService.getScriptCache().put("tvtok_" + _idPart, JSON.stringify({ u: datos[i][1], r: datos[i][2], s: datos[i][3], a: ahora.getTime(), w: ahora.getTime() }), 21600); } catch(e) {}
return { ok: true, usuario: datos[i][1], rol: datos[i][2], sucursal: datos[i][3] };
}
}
return { ok: false };
}
// Lista de sesiones activas — Owner ve todas, el resto solo las suyas
function getSesionesActivas(body, sesion) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName("Sesiones_Activas");
if (!h) return { ok: true, sesiones: [] };
const datos = h.getDataRange().getValues();
const sesiones = [];
for (let i = 1; i < datos.length; i++) {
const r = datos[i];
if (!r[0]) continue;
if (sesion.rol !== "Owner" && r[1] !== sesion.usuario) continue;
sesiones.push({
token_corto: String(r[0]).substring(0, 18) + "...",
usuario: r[1], rol: r[2], sucursal: r[3],
device_info: r[4], creado: r[5], ultimoAcceso: r[6],
esLaActual: r[0] === body.token
});
}
return { ok: true, sesiones };
}
// Cierra TODAS las sesiones de un usuario — usado tras editar rol/desactivar
function cerrarSesionesUsuario(usuario) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName("Sesiones_Activas");
if (!h) return 0;
const datos = h.getDataRange().getValues();
let cerradas = 0;
for (let i = datos.length - 1; i >= 1; i--) {
if (datos[i][1] === usuario) {
_velTokenDrop(String(datos[i][0] || "")); // v6.3: invalida cache de sesion
h.deleteRow(i + 1);
cerradas++;
}
}
return cerradas;
}
// Lee PermisosExtra JSON de un usuario (devuelve null si no tiene)
function leerPermisosExtraUsuario(usuario) {
try {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hUsu = ss.getSheetByName("Usuarios");
if (!hUsu) return null;
const headers = hUsu.getRange(1, 1, 1, hUsu.getLastColumn()).getValues()[0];
const idxExtra = headers.indexOf("PermisosExtra");
if (idxExtra === -1) return null;
const datos = hUsu.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0] === usuario) {
const raw = datos[i][idxExtra];
if (!raw) return null;
return JSON.parse(raw);
}
}
} catch(e) { return null; }
return null;
}
// =================================================================================
// USUARIOS — REESCRITO v4.3 con editarUsuario
// =================================================================================
function getUsuarios(sesion) {
soloOwner(sesion);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
const datos = hoja.getDataRange().getValues();
const idxExtra = headers.indexOf("PermisosExtra");
const usuarios = [];
for (let i = 1; i < datos.length; i++) {
const [usuario,, rol, sucursal, activo, ultimoAcceso, fechaCreacion] = datos[i];
if (!usuario) continue;
let extra = null;
if (idxExtra !== -1) {
try { extra = datos[i][idxExtra] ? JSON.parse(datos[i][idxExtra]) : null; } catch(e) {}
}
const permisos = getPermisos(rol);
if (extra) Object.keys(extra).forEach(k => { if (extra[k] === true) permisos[k] = true; });
usuarios.push({ usuario, rol, sucursal, activo: activo==="TRUE"||activo===true, ultimoAcceso, fechaCreacion, permisos, permisosExtra: extra });
}
return { ok: true, usuarios };
}
function crearUsuario(body, sesion) {
soloOwner(sesion);
const { usuario, password, rol, sucursal } = body;
if (!usuario||!password||!rol||!sucursal) return { ok: false, error: "Faltan datos." };
const rolesValidos = ["Owner","Vendedor","Cocinero","Mixto","Admin_Ventas","Chofer"];
if (!rolesValidos.includes(rol)) return { ok: false, error: `Rol inválido. Permitidos: ${rolesValidos.join(", ")}` };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const datos = hoja.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) if (datos[i][0]===usuario) return { ok: false, error: `Usuario "${usuario}" ya existe.` };
// 8 columnas estándar; si hay PermisosExtra agregar columna vacía
const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
const nuevaFila = [usuario, hashSimple(password), rol, sucursal, "TRUE", "", new Date().toISOString(), sesion.usuario];
while (nuevaFila.length < headers.length) nuevaFila.push("");
hoja.appendRow(nuevaFila);
registrarAuditoria(sesion.usuario, sesion.rol, "CREAR_USUARIO", `${usuario} (${rol} - ${sucursal})`);
return { ok: true, mensaje: `✅ Usuario "${usuario}" creado.` };
}
/**
NUEVO v4.3 — Editar usuario (solo Owner).
body = {
usuario_objetivo: "pau",                                      // requerido
campos: {
nombre, password (string, vacío = no cambiar),
rol, sucursal, activo (boolean),
permisos_extra: { puedeAnular: true, ... }                  // opcional
}
}

Si cambia rol O activo → todas las sesiones del usuario se invalidan
(tiene que volver a hacer login en cada dispositivo).
*/
function editarUsuario(body, sesion) {
soloOwner(sesion);
const usuarioObjetivo = body.usuario_objetivo;
const campos = body.campos || {};
if (!usuarioObjetivo) return { ok: false, error: "usuario_objetivo requerido." };
// No te puedes desactivar a ti mismo
if (usuarioObjetivo === sesion.usuario && campos.activo === false) {
return { ok: false, error: "No puedes desactivarte a ti mismo." };
}
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
const datos = hoja.getDataRange().getValues();
// Localizar fila del usuario
let filaIdx = -1;
for (let i = 1; i < datos.length; i++) {
if (datos[i][0] === usuarioObjetivo) { filaIdx = i; break; }
}
if (filaIdx === -1) return { ok: false, error: "Usuario no encontrado." };
const cambiosLog = [];
// Password (opcional)
if (campos.password && typeof campos.password === "string" && campos.password.length > 0) {
hoja.getRange(filaIdx + 1, 2).setValue(hashSimple(campos.password));
cambiosLog.push("password");
}
// Rol (validar)
let cambioRol = false;
if (campos.rol && campos.rol !== datos[filaIdx][2]) {
const rolesValidos = ["Owner","Vendedor","Cocinero","Mixto","Admin_Ventas","Chofer"];
if (!rolesValidos.includes(campos.rol)) return { ok: false, error: "Rol inválido." };
hoja.getRange(filaIdx + 1, 3).setValue(campos.rol);
cambiosLog.push(`rol: ${datos[filaIdx][2]} → ${campos.rol}`);
cambioRol = true;
}
// Sucursal
if (campos.sucursal && campos.sucursal !== datos[filaIdx][3]) {
hoja.getRange(filaIdx + 1, 4).setValue(campos.sucursal);
cambiosLog.push(`sucursal: ${datos[filaIdx][3]} → ${campos.sucursal}`);
}
// Activo
let cambioActivo = false;
if (typeof campos.activo === "boolean") {
const actualActivo = datos[filaIdx][4] === "TRUE" || datos[filaIdx][4] === true;
if (campos.activo !== actualActivo) {
hoja.getRange(filaIdx + 1, 5).setValue(campos.activo ? "TRUE" : "FALSE");
cambiosLog.push(`activo: ${actualActivo} → ${campos.activo}`);
cambioActivo = true;
}
}
// PermisosExtra
if (campos.permisos_extra && typeof campos.permisos_extra === "object") {
const idxExtra = headers.indexOf("PermisosExtra");
if (idxExtra === -1) {
// Crear columna PermisosExtra al final
const newCol = hoja.getLastColumn() + 1;
hoja.getRange(1, newCol).setValue("PermisosExtra");
hoja.getRange(1, newCol).setBackground("#2E4756").setFontColor("#FFFFFF").setFontWeight("bold");
hoja.getRange(filaIdx + 1, newCol).setValue(JSON.stringify(campos.permisos_extra));
} else {
hoja.getRange(filaIdx + 1, idxExtra + 1).setValue(JSON.stringify(campos.permisos_extra));
}
cambiosLog.push("permisos_extra: " + JSON.stringify(campos.permisos_extra));
}
if (cambiosLog.length === 0) return { ok: true, mensaje: "Sin cambios.", cambios: [] };
// Si cambió rol o se desactivó: cerrar TODAS sus sesiones
let sesionesCerradas = 0;
if (cambioRol || cambioActivo) {
sesionesCerradas = cerrarSesionesUsuario(usuarioObjetivo);
}
registrarAuditoria(sesion.usuario, sesion.rol, "EDITAR_USUARIO", `${usuarioObjetivo} | ${cambiosLog.join(" | ")}${sesionesCerradas > 0 ? " | sesiones cerradas: " + sesionesCerradas : ""}`);
return { ok: true, mensaje: `✅ Usuario "${usuarioObjetivo}" actualizado.`, cambios: cambiosLog, sesionesCerradas };
}
function toggleUsuario(body, sesion) {
soloOwner(sesion);
const { usuario } = body;
if (!usuario) return { ok: false, error: "Usuario requerido." };
if (usuario===sesion.usuario) return { ok: false, error: "No puedes desactivarte a ti mismo." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const datos = hoja.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0]===usuario) {
const activo = datos[i][4]==="TRUE"||datos[i][4]===true;
hoja.getRange(i+1,5).setValue(activo?"FALSE":"TRUE");
// Al desactivar: cerrar todas sus sesiones
if (activo) cerrarSesionesUsuario(usuario);
registrarAuditoria(sesion.usuario, sesion.rol, activo?"DESACTIVAR_USUARIO":"ACTIVAR_USUARIO", usuario);
return { ok: true, mensaje: `✅ Usuario "${usuario}" ${activo?"desactivado":"activado"}.` };
}
}
return { ok: false, error: "Usuario no encontrado." };
}
function cambiarPassword(body, sesion) {
const { usuario, passwordActual, passwordNuevo } = body;
if (!usuario||!passwordActual||!passwordNuevo) return { ok: false, error: "Faltan datos." };
if (sesion.rol!=="Owner"&&usuario!==sesion.usuario) return { ok: false, error: "Solo puedes cambiar tu propia contraseña." };
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoja = ss.getSheetByName("Usuarios");
const datos = hoja.getDataRange().getValues();
for (let i = 1; i < datos.length; i++) {
if (datos[i][0]===usuario) {
if (sesion.usuario===usuario&&datos[i][1]!==hashSimple(passwordActual)) return { ok: false, error: "Contraseña actual incorrecta." };
hoja.getRange(i+1,2).setValue(hashSimple(passwordNuevo));
registrarAuditoria(sesion.usuario, sesion.rol, "CAMBIO_PASSWORD", `Contraseña cambiada: ${usuario}`);
return { ok: true, mensaje: "✅ Contraseña actualizada." };
}
}
return { ok: false, error: "Usuario no encontrado." };
}
