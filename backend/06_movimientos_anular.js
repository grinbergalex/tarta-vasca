// =================================================================================
// NUEVO v4.3 — MOVIMIENTOS RECIENTES + ELIMINAR (SOFT-DELETE)
// =================================================================================
/**
Lista movimientos recientes en cualquiera de las 3 hojas operativas.
body = {
tipo: "Ventas" | "Inventario" | "Transferencias" | undefined (todos),
rango: "hoy" | "3d" | "7d" | "30d" (default 7d)
}

Devuelve hasta 200 movimientos, ordenados del más reciente al más viejo.
Vendedor solo ve sus propios movimientos; Owner ve todo.
*/
function listarMovimientosRecientes(body, sesion) {
const tipos = body.tipo ? [body.tipo] : ["Ventas", "Inventario", "Transferencias"];
const rango = body.rango || "7d";
const desde = _calcularDesde(rango);
const ss = SpreadsheetApp.getActiveSpreadsheet();
const out = [];
tipos.forEach(t => {
const h = ss.getSheetByName(t);
if (!h) return;
// v6.3: lee solo las ultimas 1200 filas (el rango max es 30d) y los headers UNA vez
// (antes _extraerEstadoFila releia los headers del sheet EN CADA FILA — el gran
// culpable de la lentitud de Movimientos)
const _lrM = h.getLastRow(), _lcM = h.getLastColumn();
if (_lrM < 2) return;
const _iniM = Math.max(2, _lrM - 1200 + 1);
const datos = h.getRange(_iniM, 1, _lrM - _iniM + 1, _lcM).getValues();
const _hdrsM = h.getRange(1, 1, 1, _lcM).getValues()[0];
const _idxAnulM = _hdrsM.indexOf("estado_anul");
for (let i = datos.length - 1; i >= 0; i--) {
const fila = datos[i];
if (!fila[0]) continue;
const fecha = _extraerFechaFila(t, fila);
if (!fecha || fecha < desde) continue;
const usuarioFila = _extraerUsuarioFila(t, fila);
// Vendedor solo ve sus movimientos
if (sesion.rol !== "Owner" && usuarioFila !== sesion.usuario) continue;
const estado = _velEstadoFila(t, fila, _idxAnulM);
out.push({
hoja: t,
fila_idx: _iniM + i,
id: String(fila[0]),
fecha: Utilities.formatDate(fecha, TZ_MX, "yyyy-MM-dd'T'HH:mm:ss"),  // FIX-TZ: enviar CDMX
usuario: usuarioFila,
detalle: _construirDetalle(t, fila),
monto_o_cantidad: _extraerMontoCantidad(t, fila),
estado: estado || "Activo"
});
}
});
out.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
return { ok: true, movimientos: out.slice(0, 200) };
}
/**
Soft-delete de un movimiento.
body = { hoja: "Ventas"|"Inventario"|"Transferencias", id, motivo }

Acciones:

Marca la fila con estado "ANULADO" + columnas anulado_por, anulado_fecha, anulado_motivo

Si la fila era Venta no-merma → devuelve stock al inventario (lotes_origen)

Registra en Auditoria_Eliminados con el snapshot de la fila completa

Solo Owner por defecto; permite a usuarios con PermisosExtra.puedeAnular.
*/
function eliminarMovimiento(body, sesion) {
// v4.5.13-fix: si viene marcada como liberacion de reserva, exige puedeVender
// (no puedeAnular). Mas abajo se valida que las filas objetivo sean realmente
// reservas (tipo_op="Reservado") para que la bandera no pueda abusarse.
const _liberacionReserva = !!(body && body._liberacionReserva);
if (_liberacionReserva) {
requierePuedeVender(sesion);
} else {
requierePuedeAnular(sesion);
}
const { hoja, id, motivo } = body;
if (!hoja || !id) return { ok: false, error: "hoja e id requeridos." };
if (!motivo || !motivo.trim()) return { ok: false, error: "El motivo es obligatorio." };
const hojasPermitidas = ["Ventas", "Inventario", "Transferencias"];
if (hojasPermitidas.indexOf(hoja) === -1) return { ok: false, error: "Hoja no admite anulación." };
// Lock para evitar choques con ventas/mermas concurrentes
const lock = LockService.getScriptLock();
try { lock.waitLock(30000); }
catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
try {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName(hoja);
if (!h) return { ok: false, error: `Hoja "${hoja}" no existe.` };
    // v6.5: antes esto leia TODA la hoja (getDataRange) en cada anulacion. Con miles de filas
    // acumuladas con el tiempo, esa lectura completa era la causa principal de que "Confirmar
    // anulacion" tardara tanto. Igual que ya se hizo en listarMovimientosRecientes (v6.3),
    // primero buscamos solo en las ultimas 1200 filas — de ahi SIEMPRE viene el id, porque la
    // UI solo deja anular movimientos que aparecen en ese listado, y el listado ya esta acotado
    // a esas mismas 1200 filas. Si por algun motivo no aparece ahi, caemos a un escaneo completo
    // de respaldo: nunca deja de encontrar un movimiento valido, solo tarda mas en ese caso raro.
    const _lrEM = h.getLastRow(), _lcEM = h.getLastColumn();
    if (_lrEM < 2) return { ok: false, error: "Movimiento no encontrado." };
    const _iniEM = Math.max(2, _lrEM - 1200 + 1);
    const _rangoEM = h.getRange(_iniEM, 1, _lrEM - _iniEM + 1, _lcEM).getValues();
    const _headerEM = h.getRange(1, 1, 1, _lcEM).getValues()[0];
    let datos = new Array(_lrEM);
    datos[0] = _headerEM;
    for (let k = 0; k < _rangoEM.length; k++) datos[_iniEM - 1 + k] = _rangoEM[k];
    const filasObjetivo = [];
    for (let i = _iniEM - 1; i < _lrEM; i++) {
      if (datos[i] && String(datos[i][0]) === String(id)) filasObjetivo.push(i + 1);
    }
    if (filasObjetivo.length === 0 && _iniEM > 2) {
      // Respaldo: el id no aparecio en las ultimas 1200 filas — escaneo completo.
      datos = h.getDataRange().getValues();
      for (let i = 1; i < datos.length; i++) {
        if (String(datos[i][0]) === String(id)) filasObjetivo.push(i + 1);
      }
    }
    if (filasObjetivo.length === 0) return { ok: false, error: "Movimiento no encontrado." };

    // v4.5.13-fix: la bandera _liberacionReserva solo es valida si TODAS las filas
    // objetivo son reservas (tipo_op="Reservado") en la hoja Ventas. Evita que se use
    // para anular ventas reales sin permiso puedeAnular.
    if (_liberacionReserva) {
      const _idxTipoOp = datos[0].indexOf("tipo_op");
      const _todasReserva = _idxTipoOp !== -1 && filasObjetivo.every(function(fn){ return String(datos[fn - 1][_idxTipoOp]) === "Reservado"; });
      if (hoja !== "Ventas" || !_todasReserva) {
        return { ok: false, error: "Esta accion solo libera reservas (apartados)." };
      }
    }

    const estadoActual = _extraerEstadoFila(hoja, datos[filasObjetivo[0] - 1]);
    if (estadoActual === "ANULADO") return { ok: false, error: "Este movimiento ya está anulado." };

    const headersOriginales = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
    const colsAuditoria = ["estado_anul", "anulado_por", "anulado_fecha", "anulado_motivo"];
    colsAuditoria.forEach(c => {
      if (headersOriginales.indexOf(c) === -1) {
        const newCol = h.getLastColumn() + 1;
        h.getRange(1, newCol).setValue(c);
        h.getRange(1, newCol).setBackground("#E74C3C").setFontColor("#FFFFFF").setFontWeight("bold");
      }
    });
    const headersFinales = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
    const colEstado = headersFinales.indexOf("estado_anul") + 1;
    const colPor = headersFinales.indexOf("anulado_por") + 1;
    const colFecha = headersFinales.indexOf("anulado_fecha") + 1;
    const colMotivo = headersFinales.indexOf("anulado_motivo") + 1;

    const ahora = new Date().toISOString();
    let totalRepuesto = 0;
    let totalAReponer = 0;
    const fallasReposicion = []; // detalle de items que no se pudieron reponer
    const filasSnapshot = [];

    filasObjetivo.forEach(filaNum => {
      const dataFila = h.getRange(filaNum, 1, 1, h.getLastColumn()).getValues()[0];
      filasSnapshot.push(dataFila);
      h.getRange(filaNum, colEstado).setValue("ANULADO");
      h.getRange(filaNum, colPor).setValue(sesion.usuario);
      h.getRange(filaNum, colFecha).setValue(ahora);
      h.getRange(filaNum, colMotivo).setValue(motivo);

      if (hoja === "Ventas") {
        const canalFila = String(dataFila[9] || "");
        const cantFila = Number(dataFila[6]) || 0;
        // v4.5.12-fix: SOLO las reservas no descontaron stock. Los regalos (Cortesía)
        // SÍ descuentan inventario al registrarse, así que al anularlos hay que reponer.
        const requiereReponer = cantFila > 0 && canalFila !== "Reservado";
        if (requiereReponer) {
          totalAReponer += cantFila;
          try {
            invProducir(ss, String(dataFila[4]), String(dataFila[5]), String(dataFila[3]), cantFila, id, sesion.usuario, "Reingreso por anulacion de venta"); var r = {ok:true, repuesto:cantFila};
            if (r && r.ok) {
              totalRepuesto += r.repuesto;
              if (r.repuesto < cantFila) {
                fallasReposicion.push(`${dataFila[4]} ${dataFila[5]}: faltaron ${cantFila - r.repuesto} uds`);
              }
            } else {
              fallasReposicion.push(`${dataFila[4]} ${dataFila[5]} × ${cantFila}: ${r && r.error ? r.error : "razón desconocida"}`);
            }
          } catch(e) {
            fallasReposicion.push(`${dataFila[4]} ${dataFila[5]} × ${cantFila}: ${e.message}`);
          }
        }
      }
    
      if (hoja === "Transferencias") {
        var _sb=dataFila[1], _tm=dataFila[2], _ct=Number(dataFila[3])||0;
        if(_ct>0){
          try{
            var _disp=invDisponible(ss,_sb,_tm,"Polanco");
            var _rev=Math.min(_ct,_disp);
            if(_rev>0){
              invDescontar(ss,_sb,_tm,"Polanco",_rev,id,sesion.usuario,"Anulacion transferencia","TRANSFER_ANUL");
              invProducir(ss,_sb,_tm,"Cuajimalpa",_rev,id,sesion.usuario,"Anulacion transferencia (regreso a Cuajimalpa)");
            }
            if(_rev<_ct) fallasReposicion.push(_sb+" "+_tm+": solo se regresaron "+_rev+" de "+_ct+" (Polanco ya no tenia el resto)");
          }catch(e){ fallasReposicion.push(_sb+" "+_tm+": "+e.message); }
        }
      }
});
    SpreadsheetApp.flush();
    _velBump("inv"); // v6.4: invalida el cache de stock también al anular filas de Inventario
                      // (antes solo se invalidaba al anular Ventas/Transferencias vía invProducir/invDescontar)

    const stockOk = fallasReposicion.length === 0 && (hoja !== "Ventas" || totalRepuesto === totalAReponer);

    const hAudit = ss.getSheetByName("Auditoria_Eliminados");
    if (hAudit) {
      hAudit.appendRow([
        ahora, hoja, id, hoja, sesion.usuario, motivo,
        JSON.stringify(filasSnapshot), stockOk
      ]);
    }

    registrarAuditoria(sesion.usuario, sesion.rol, "ANULAR_" + hoja.toUpperCase(),
      `${hoja} ${id} | filas: ${filasObjetivo.length} | motivo: ${motivo}${stockOk ? " | stock devuelto OK" : " | ⚠️ stock NO repuesto: " + fallasReposicion.join("; ")}`);

    if (hoja === "Ventas") { _utilMarcarDirty(); }

    if (stockOk) {
      return {
        ok: true,
        mensaje: hoja === "Ventas"
          ? `✅ Venta ${id} anulada. Inventario actualizado (${totalRepuesto} uds devueltas).`
          : `✅ ${hoja} ${id} anulado.`,
        stock_revertido: true,
        filas_afectadas: filasObjetivo.length
      };
    } else {
      // Devolvemos ok:true porque la anulación SÍ se aplicó, pero con advertencia visible
      return {
        ok: true,
        advertencia: true,
        mensaje: `⚠️ Venta ${id} anulada PERO el inventario NO se repuso completamente. Revisar manualmente: ${fallasReposicion.join("; ")}`,
        stock_revertido: false,
        repuesto_uds: totalRepuesto,
        esperado_uds: totalAReponer,
        detalle_fallas: fallasReposicion,
        filas_afectadas: filasObjetivo.length
      };
    }
} finally {
try { lock.releaseLock(); } catch(_){}
}
}
// ── Helpers movimientos ─────────────────────────────────────
function _calcularDesde(rango) {
const ahora = new Date();
switch (rango) {
case "hoy": return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
case "3d":  return new Date(ahora.getTime() - 3 * 86400000);
case "7d":  return new Date(ahora.getTime() - 7 * 86400000);
case "30d": return new Date(ahora.getTime() - 30 * 86400000);
default:    return new Date(ahora.getTime() - 7 * 86400000);
}
}
function _extraerFechaFila(hoja, fila) {
// Ventas: col 2 (índice 1)
// Inventario: col 7 (índice 6) fechaAlta
// Transferencias: col 6 (índice 5) Fecha Solicitud
const idx = hoja === "Ventas" ? 1 : hoja === "Inventario" ? 6 : 5;
const raw = fila[idx];
if (!raw) return null;
try { return new Date(raw); } catch(e) { return null; }
}
function _extraerUsuarioFila(hoja, fila) {
// Ventas: col 3 (índice 2) usuario
// Inventario: no tiene usuario directo → ""
// Transferencias: col 8 (índice 7) solicitadoPor
if (hoja === "Ventas") return fila[2] || "";
if (hoja === "Transferencias") return fila[7] || "";
return "";
}
function _extraerEstadoFila(hoja, fila) {
// Buscar columna "estado_anul" si existe
const ss = SpreadsheetApp.getActiveSpreadsheet();
const h = ss.getSheetByName(hoja);
if (!h) return "";
const headers = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
const idxEstadoAnul = headers.indexOf("estado_anul");
if (idxEstadoAnul !== -1 && fila[idxEstadoAnul]) return fila[idxEstadoAnul];
// Caso especial Inventario col 10 (índice 9)
if (hoja === "Inventario") return fila[9] || "";
// Transferencias col 5 (índice 4) Estado
if (hoja === "Transferencias") return fila[4] || "";
return "";
}
function _construirDetalle(hoja, fila) {
if (hoja === "Ventas") {
// [idVenta, fecha, usuario, sucursal, sabor, tamano, cantidad, precio, subtotal, canal, metodoPago, ...]
return `${fila[6] || ""}× ${fila[4] || ""} ${fila[5] || ""} · ${fila[9] || ""} (${fila[3] || ""})`;
}
if (hoja === "Inventario") {
// [id, sabor, tamano, sucursal, cantInicial, cantActual, fechaAlta, fechaCad, lote, estado]
return `Carga ${fila[4] || ""}× ${fila[1] || ""} ${fila[2] || ""} (${fila[3] || ""}) · lote ${fila[8] || ""}`;
}
if (hoja === "Transferencias") {
// [ID, Sabor, Tamaño, Cantidad, Estado, Fecha Solicitud, ...]
return `${fila[3] || ""}× ${fila[1] || ""} ${fila[2] || ""} → Polanco`;
}
return "";
}
function _extraerMontoCantidad(hoja, fila) {
if (hoja === "Ventas") {
const total = Number(fila[8]) || 0;
return total > 0 ? "$" + total.toLocaleString("es-MX") : "$0";
}
if (hoja === "Inventario") {
return (fila[5] || 0) + " uds";
}
if (hoja === "Transferencias") {
return (fila[3] || 0) + " uds";
}
return "";
}
// Devuelve stock al inventario después de anular una venta. Best effort por lote.
// Devuelve stock al inventario al anular una venta. v4.5.0: robusto.
//   * Re-lee Inventario fresh
//   * Regex permisivo para lotes (acepta cualquier caracter excepto coma/paréntesis)
//   * Devuelve {ok, repuesto, error?} con cuenta exacta
// v6.1: asienta en Inv_Ledger la reposicion de stock que ocurre al ANULAR una venta/merma.
// Cierra la "Limitacion v1" del header: sin esto, auditarConsistencia marcaba desfase en esa SKU.
function _ledgerReposicion(ss, filaVenta, qty, detalle){
  try{
    var s = invSaldos(ss, filaVenta[4], filaVenta[5], filaVenta[3]);
    _invLedger(ss, "REPOSICION_ANULACION", filaVenta[4], filaVenta[5], filaVenta[3], "", qty, 0, 0, s.total, s.resRuta, s.resApartado, String(filaVenta[0]||""), String(filaVenta[2]||""), detalle || "Reposicion de stock por anulacion");
  }catch(e){ try{ Logger.log("_ledgerReposicion fallo: "+e); }catch(e2){} }
}
function _reponerStockVenta(ss, filaVenta) {
const sucursal = filaVenta[3];
const sabor = filaVenta[4];
const tamano = filaVenta[5];
const cantidad = Number(filaVenta[6]) || 0;
const lotesOrigen = String(filaVenta[13] || ""); // ej: "LOTE-A(2), LOTE-B(1)"
if (cantidad <= 0 || !sabor || !tamano) return { ok: false, error: "fila sin cantidad/sabor/tamaño", repuesto: 0 };
const hInv = ss.getSheetByName("Inventario");
if (!hInv) return { ok: false, error: "hoja Inventario no existe", repuesto: 0 };
let datosInv = hInv.getDataRange().getValues();
// v4.5.12-fix: NUNCA reponer sobre una fila de Inventario anulada (estado_anul === "ANULADO").
// getStock oculta esas filas; si el stock se sumara ahí "desaparecería" del inventario visible
// aunque numéricamente se haya repuesto. Esa era la causa de "anulo una venta/merma y el stock
// no regresa". Saltamos esas filas en TODAS las rutas de reposición.
const headersInv = datosInv[0] || [];
const idxAnulInv = headersInv.indexOf("estado_anul");
const filaAnulada = function(i){ return idxAnulInv !== -1 && datosInv[i][idxAnulInv] === "ANULADO"; };
let repuesto = 0;
if (lotesOrigen) {
// Regex permisivo: captura nombre_lote(cantidad) — el nombre puede tener cualquier char excepto , ( ) o espacio
const matches = lotesOrigen.match(/([^,()\s]+)((\d+))/g) || [];
for (const m of matches) {
const partes = m.match(/^([^,()\s]+)((\d+))$/);
if (!partes) continue;
const loteNombre = partes[1];
const qty = parseInt(partes[2]) || 0;
if (qty <= 0) continue;
let aplicado = false;
for (let i = 1; i < datosInv.length; i++) {
if (datosInv[i][8] === loteNombre && !filaAnulada(i)) {
const cantActual = Number(datosInv[i][5]) || 0;
const nueva = cantActual + qty;
hInv.getRange(i + 1, 6).setValue(nueva);
if (nueva > 0) hInv.getRange(i + 1, 10).setValue("activo");
repuesto += qty;
aplicado = true;
// refrescar datosInv en memoria para que la siguiente iteración no use stale
datosInv[i][5] = nueva;
break;
}
}
if (!aplicado) {
// Lote no encontrado (posiblemente borrado): caer al fallback de sumar al primer lote NO anulado del par
for (let i = 1; i < datosInv.length; i++) {
if (datosInv[i][1] === sabor && datosInv[i][2] === tamano && datosInv[i][3] === sucursal && !filaAnulada(i)) {
const cantActual = Number(datosInv[i][5]) || 0;
const nueva = cantActual + qty;
hInv.getRange(i + 1, 6).setValue(nueva);
hInv.getRange(i + 1, 10).setValue("activo");
datosInv[i][5] = nueva;
repuesto += qty;
aplicado = true;
break;
}
}
}
}
SpreadsheetApp.flush();
if (repuesto === cantidad) { _ledgerReposicion(ss, filaVenta, repuesto); return { ok: true, repuesto }; }
if (repuesto > 0) { _ledgerReposicion(ss, filaVenta, repuesto, `parcial: solo ${repuesto}/${cantidad} repuestas`); return { ok: true, repuesto, error: `parcial: solo ${repuesto}/${cantidad} repuestas` }; }
// Si los lotes no matchearon nada, caer al fallback total
}
// Fallback total: sumar la cantidad al primer lote NO anulado del par sabor/tamano/sucursal
for (let i = 1; i < datosInv.length; i++) {
if (datosInv[i][1] === sabor && datosInv[i][2] === tamano && datosInv[i][3] === sucursal && !filaAnulada(i)) {
const cantActual = Number(datosInv[i][5]) || 0;
const nueva = cantActual + cantidad;
hInv.getRange(i + 1, 6).setValue(nueva);
hInv.getRange(i + 1, 10).setValue("activo");
SpreadsheetApp.flush();
_ledgerReposicion(ss, filaVenta, cantidad, "fallback: lote del par");
return { ok: true, repuesto: cantidad };
}
}
// Último fallback: crear un lote nuevo "REINGRESO"
const ahora = new Date().toISOString();
const loteNuevo = `REINGRESO-${sabor.substring(0,3).toUpperCase()}-${ahora.substring(0,10)}`;
hInv.appendRow(["INV-"+Date.now(), sabor, tamano, sucursal, cantidad, cantidad, new Date(), "", loteNuevo, "activo", "sistema_anul"]);
SpreadsheetApp.flush();
_ledgerReposicion(ss, filaVenta, cantidad, "REINGRESO "+loteNuevo);
return { ok: true, repuesto: cantidad, error: `creado lote nuevo ${loteNuevo} (no se encontró ninguno previo del par)` };
}
