// =================================================================================
// INVENTARIO
// =================================================================================
function getStock(body, sesion) {
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hoy = new Date();
const permisos = getPermisos(sesion.rol);
let sucursalFiltro = null;
// Vendedor y Mixto pueden VER stock de ambas sucursales (siguen vendiendo solo en la suya).
var _verStockAmbas = permisos.puedeVerAmbas || sesion.rol === "Vendedor" || sesion.rol === "Mixto";
if (!_verStockAmbas) {
sucursalFiltro = getSucursalUsuario(sesion.usuario);
} else {
sucursalFiltro = body.sucursal || null;
}
// v6.3: cache 30s por sucursal — se invalida al instante con cualquier movimiento (_invLedger)
const _velKey = "stock_" + (sucursalFiltro || "ALL");
const _velHit = _velGet("inv", _velKey);
if (_velHit) return _velHit;
const hoja = ss.getSheetByName("Inventario");
const datos = hoja.getDataRange().getValues();
// Detectar columna estado_anul para filtrar ANULADO
const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
const idxEstadoAnul = headers.indexOf("estado_anul");
const stock = [];
for (let i = 1; i < datos.length; i++) {
const [id, sabor, tamano, sucursal, cantInicial, cantActual, fechaAlta, fechaCad, lote, estado] = datos[i];
if (!sabor) continue;
if (idxEstadoAnul !== -1 && datos[i][idxEstadoAnul] === "ANULADO") continue;  // ignorar anuladas
if (sucursalFiltro && sucursal !== sucursalFiltro) continue;
// CADUCIDAD ELIMINADA — siempre vigente
stock.push({ fila: i+1, id, sabor, tamano, sucursal, cantInicial: Number(cantInicial), cantActual: Number(cantActual), fechaAlta, fechaCaducidad: null, diasRestantes: 9999, vencido: false, porVencer: false, lote, estado });
}
// Reservas separadas apartado/ruta (para mostrar Total/Tienda/Apartado/Ruta).
try {
var _Hr=datos[0]; var _ir=_Hr.indexOf("res_ruta"), _ip=_Hr.indexOf("res_apartado");
for (var _si=0; _si<stock.length; _si++){
var _row = datos[stock[_si].fila-1] || [];
var _ap = _ip!==-1 ? (Number(_row[_ip])||0) : 0;
var _ru = _ir!==-1 ? (Number(_row[_ir])||0) : 0;
stock[_si].reservadoApartado=_ap; stock[_si].reservadoRuta=_ru; stock[_si].reservado=_ap+_ru;
stock[_si].disponibleNeto=Math.max(0, Number(stock[_si].cantActual)-_ap-_ru);
stock[_si].disponibleTienda=stock[_si].disponibleNeto;
}
} catch(e){}
const _velOut = { ok: true, stock }; // v6.3
_velPut("inv", _velKey, _velOut, 30);
return _velOut;
}
function altaProduccion(body, sesion) {
requierePuedeProducir(sesion);
const { sabor, tamano, sucursal, cantidad } = body;
if (!sabor || !tamano || !sucursal || !cantidad || cantidad <= 0) return { ok:false, error:"Faltan datos requeridos." };
const lock=LockService.getScriptLock(); try{lock.waitLock(30000);}catch(e){return{ok:false,error:"El sistema esta ocupado, intenta de nuevo."};}
try{
  const _opId=String(body.opId||"").trim();
  const _opDup=_opYaRegistrada(_opId);
  if(_opDup) return _opDup;
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  invProducir(ss, String(sabor).trim(), String(tamano).trim(), sucursal, Number(cantidad), "PRODUCCION", sesion.usuario, "Alta produccion");
  registrarAuditoria(sesion.usuario, sesion.rol, "PRODUCCION", cantidad+"x "+sabor+" "+tamano+" @ "+sucursal);
  const _resOk = { ok:true, mensaje:"✅ "+cantidad+" "+sabor+" "+tamano+" agregados a "+sucursal+"." };
  _opRegistrar(_opId,_resOk);
  return _resOk;
}catch(err){ return { ok:false, error:String(err&&err.message?err.message:err) }; }
finally{ try{lock.releaseLock();}catch(_e){} }
}
// =================================================================================
// AJUSTE DE INVENTARIO POR CONTEO FISICO (v4.5.13-skip-anulados) — solo Owner
// Pone el sistema igual al conteo fisico de cada SKU. Consolida lotes en una sola
// fila, limpia "stock fantasma" (filas anuladas con piezas) y registra en Auditoria.
// =================================================================================
function ajustarInventario(body, sesion) {
requierePermiso(sesion, "puedeModificarInventario", "Tu rol no permite modificar inventario.");  // v7: Owner + Admin_Ventas
const sucursal=body.sucursal; const ajustes=Array.isArray(body.ajustes)?body.ajustes:[];
if(!sucursal) return {ok:false,error:"Falta la sucursal."};
if(!ajustes.length) return {ok:false,error:"No hay ajustes que aplicar."};
const lock=LockService.getScriptLock(); try{lock.waitLock(30000);}catch(e){return{ok:false,error:"Sistema ocupado."};}
try{
  const ss=SpreadsheetApp.getActiveSpreadsheet(); const resumen=[];
  for(const a of ajustes){ const sabor=String(a.sabor||"").trim(), tamano=String(a.tamano||"").trim(), conteo=parseInt(a.conteo);
    if(!sabor||!tamano||isNaN(conteo)||conteo<0) continue;
    const r=invAjustar(ss,sabor,tamano,sucursal,conteo,sesion.usuario,body.motivo||"Conteo fisico");
    resumen.push(sabor+" "+tamano+": "+r.antes+"->"+r.despues+" (d"+r.diff+")");
    registrarAuditoria(sesion.usuario,sesion.rol,"AJUSTE_INVENTARIO",sabor+" "+tamano+" @ "+sucursal+": "+r.antes+"->"+r.despues);
  }
  return {ok:true, mensaje:"✅ Ajuste aplicado al conteo fisico.", resumen};
}catch(err){return{ok:false,error:String(err&&err.message?err.message:err)};}
finally{try{lock.releaseLock();}catch(_e){}}
}
// =================================================================================
// VENTAS MULTI-PRODUCTO
// =================================================================================
function registrarVenta(body, sesion) {
requierePuedeVender(sesion);
const { items, canal, metodoPago, cliente, tipoOp, motivo, anticipo, envio, fechaEntrega } = body;
const esRegalo = tipoOp === "regalo";
const esReserva = tipoOp === "reserva";  // v4.4
if (esRegalo && !getPermisos(sesion.rol).esAdmin) return { ok: false, error: "Tu rol no permite registrar regalos." };  // solo Owner (Vendedor no da cortesias)
if (!items || items.length === 0) return { ok: false, error: "Agrega al menos un producto." };
if (!esRegalo && !esReserva && !canal) return { ok: false, error: "Selecciona el canal de venta." };
if (!esRegalo && !esReserva && !metodoPago) return { ok: false, error: "Selecciona el método de pago." };
if (esRegalo && !motivo) return { ok: false, error: "El motivo del regalo es obligatorio." };
if (esReserva && (!cliente || !cliente.nombre || cliente.nombre.trim() === "")) return { ok: false, error: "El cliente es obligatorio para reservar." };
const itemsNorm = items.map(i => ({ sabor: String(i.sabor||"").trim(), tamano: String(i.tamano||"").trim(), cantidad: parseInt(i.cantidad)||0, precioUnitario: Number(i.precioUnitario)||0, descuento: Number(i.descuento)||0, descTipo: String(i.descTipo||""), esPaquete: i.esPaquete === true, paqueteId: String(i.paqueteId||"") }));
for (const item of itemsNorm) {
if (!item.sabor || !item.tamano || item.cantidad <= 0) return { ok: false, error: `Item inválido: ${item.sabor} ${item.tamano} × ${item.cantidad}` };
}
const canalReal = esRegalo ? "Cortesía" : (esReserva ? (canal || "Reservado") : canal);
const PAQUETE_PRECIOS = {
base:  { 3: 590, 4: 720 },
Rappi: { 3: 630, 4: 780 }
};
const tablaPaq = (canalReal === "Rappi") ? PAQUETE_PRECIOS.Rappi : PAQUETE_PRECIOS.base;
const grupos = {};
itemsNorm.filter(i => i.esPaquete).forEach(i => {
if (!i.paqueteId) i.paqueteId = "PKG-DEFAULT";
if (!grupos[i.paqueteId]) grupos[i.paqueteId] = [];
grupos[i.paqueteId].push(i);
});
for (const pid in grupos) {
const g = grupos[pid];
const size = g.length;
if (!(size === 3 || size === 4)) {
return { ok: false, error: `Paquete inválido (${pid}): debe tener 3 o 4 items, tiene ${size}.` };
}
for (const item of g) {
if (item.tamano !== "Individual") return { ok: false, error: "Paquete: solo aplica a tamaño Individual." };
if (item.cantidad !== 1) return { ok: false, error: "Paquete: cada sabor cuenta como 1 unidad." };
}
const suma = g.reduce((s,x) => s + x.precioUnitario, 0);
const esperado = tablaPaq[size];
if (Math.abs(suma - esperado) > 1) {
return { ok: false, error: `Paquete ${size} en canal ${canalReal}: precio total esperado $${esperado}, recibido $${suma}.` };
}
}
const metodoReal = esRegalo ? "Regalo" : (esReserva ? (metodoPago || "Pendiente") : metodoPago);
const canalRequiereCliente = !esRegalo && canalReal !== "Rappi" && canalReal !== "Uber Eats";
if (canalRequiereCliente && !esReserva && (!cliente || !cliente.nombre || cliente.nombre.trim() === "")) return { ok: false, error: "El nombre del cliente es obligatorio para este canal." };
// VALIDACIÓN B3 v2 — Solo Owner puede aplicar descuentos
if (sesion.rol !== "Owner") {
for (const item of itemsNorm) {
if (item.descuento > 0 && !item.esPaquete) {
return { ok: false, error: "Tu rol no permite aplicar descuentos. Pídeselo al Owner." };
}
}
}
const permisos = getPermisos(sesion.rol);
let sucursal;
if (permisos.puedeVerAmbas && body.sucursal) sucursal = body.sucursal;
else if (permisos.puedeVerAmbas) { sucursal = getSucursalUsuario(sesion.usuario); if (sucursal === "Ambas") sucursal = "Cuajimalpa"; }
else sucursal = getSucursalUsuario(sesion.usuario);
// ============================================================
// SECCIÓN CRÍTICA — LockService garantiza serialización entre sesiones
// ============================================================
const lock = LockService.getScriptLock();
try {
lock.waitLock(30000); // hasta 30s esperando si otra sesión está escribiendo
} catch (e) {
return { ok: false, error: "El sistema está ocupado, intenta de nuevo en unos segundos." };
}
const cambiosTotales = [];   // para rollback si algo falla a mitad
const filasAppendedRows = []; // para rollback de Ventas si fuera necesario
let hojaVentas = null;
try {
const _opId = String(body.opId || "").trim();
const _opDup = _opYaRegistrada(_opId);
if (_opDup) return _opDup;
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hojaInv = ss.getSheetByName("Inventario");
if (!hojaInv) throw new Error("No existe la hoja Inventario.");
    // PRE-CHECK AGREGADO POR SKU — suma cantidades de items repetidos antes de validar stock
    // Las reservas NO descuentan stock (igual que antes), así que se saltan
    if (!esReserva) {
      const demanda = {}; // sabor||tamano -> cantidad total
      for (const item of itemsNorm) {
        const k = item.sabor + "||" + item.tamano;
        demanda[k] = (demanda[k] || 0) + item.cantidad;
      }
      const datosInvCheck = hojaInv.getDataRange().getValues();
      for (const k in demanda) {
        const [sabor, tamano] = k.split("||");
        const disp = calcularDisponible(datosInvCheck, sabor, tamano, sucursal, new Date());
        if (disp < demanda[k]) {
          return { ok: false, error: `Stock insuficiente: ${sabor} ${tamano} — disponible: ${disp}, solicitado total: ${demanda[k]}` };
        }
      }
    }

    let clienteId = "";
    if (cliente && cliente.nombre && cliente.nombre.trim() !== "") {
      clienteId = registrarOActualizarCliente(ss, cliente);
    } else if (!canalRequiereCliente) {
      clienteId = canalReal;
    }
    const ahora = new Date();
    const idVenta = (esReserva ? "RES-" : "VTA-") + ahora.getTime();
    // FEAT-RUTAS (v4.5.6): permitir fechaPersonalizada (rutas planeadas con fecha futura)
    let fechaVenta = ahora;
    if (body.fechaPersonalizada) {
      const fp = new Date(body.fechaPersonalizada);
      if (!isNaN(fp.getTime())) fechaVenta = fp;
    }
    hojaVentas = ss.getSheetByName("Ventas");
    let totalVenta = 0;
    const resumenItems = [];
    const headersV = hojaVentas.getRange(1, 1, 1, hojaVentas.getLastColumn()).getValues()[0];
    const idxTipoOp = headersV.indexOf("tipo_op");
    const idxAnticipo = headersV.indexOf("anticipo_reserva");
    const idxEnvio = headersV.indexOf("envio_monto");
    const idxFechaEnt = headersV.indexOf("fecha_entrega");
    const tipoOpVal = esReserva ? "Reservado" : (esRegalo ? "Regalo" : "Venta");

    // PASO 1 — descontar TODO el stock primero (con re-lectura fresh por item).
    // Si algo falla, rollback inmediato. Las reservas NO descuentan stock.
    const lotesPorItem = [];
    for (const item of itemsNorm) {
      if (esReserva) { lotesPorItem.push([]); continue; }
      const res = descontarStock(hojaInv, item.sabor, item.tamano, sucursal, item.cantidad);
      lotesPorItem.push(res.lotesDescontados);
      cambiosTotales.push(...res.cambios);
    }

    // PASO 2 — solo si todo el descuento salió bien, escribimos las filas de Ventas
    for (let idx = 0; idx < itemsNorm.length; idx++) {
      const item = itemsNorm[idx];
      const { sabor, tamano, cantidad, descuento, descTipo } = item;
      let precio = item.precioUnitario > 0 ? item.precioUnitario : getPrecioActual(ss, sabor, tamano, canalReal);
      if (esRegalo) precio = 0;
      const precioOriginal = getPrecioActual(ss, sabor, tamano);
      const subtotal = precio * cantidad;
      totalVenta += subtotal;
      const notas = [item.esPaquete?`PAQ-${grupos[item.paqueteId]?grupos[item.paqueteId].length:"X"}IND`:"", descuento>0&&!item.esPaquete?`Desc: ${descuento}${descTipo==="pct"?"%":"$"} (orig $${precioOriginal})`:"", esRegalo?`Regalo: ${motivo}`:"", esReserva?`Reserva${motivo?": "+motivo:""}`:"", motivo&&!esRegalo&&!esReserva&&!item.esPaquete?`Nota: ${motivo}`:""].filter(Boolean).join(" | ");
      hojaVentas.appendRow([idVenta, fechaVenta, sesion.usuario, sucursal, sabor, tamano, cantidad, precio, subtotal, canalReal, metodoReal, clienteId, cliente?(cliente.nombre||""):"", lotesPorItem[idx].join(", "), notas]);
      const nuevaFila = hojaVentas.getLastRow();
      filasAppendedRows.push(nuevaFila);
      if (idxTipoOp !== -1) hojaVentas.getRange(nuevaFila, idxTipoOp + 1).setValue(tipoOpVal);
      if (esReserva && idxAnticipo !== -1 && Number(anticipo) > 0) hojaVentas.getRange(nuevaFila, idxAnticipo + 1).setValue(Number(anticipo));
      if (idxFechaEnt !== -1 && fechaEntrega) hojaVentas.getRange(nuevaFila, idxFechaEnt + 1).setValue(String(fechaEntrega).substring(0,10));
      if (idx === 0 && idxEnvio !== -1 && Number(envio) > 0) hojaVentas.getRange(nuevaFila, idxEnvio + 1).setValue(Number(envio));
      resumenItems.push(`${cantidad} ${sabor} ${tamano}`);
    }
    SpreadsheetApp.flush();
    // InvCore: asentar venta en ledger (solo en exito) y reservar fisicamente apartados.
    // v6.5c: los fallos ya NO se tragan en silencio — quedan en Auditoría y, si un
    // apartado no pudo apartar stock físico, el vendedor lo ve en la respuesta.
    const _fallasReserva = [];
    for (var _ii=0; _ii<itemsNorm.length; _ii++){ var _it=itemsNorm[_ii];
      if (esReserva){
        try{ invReservar(ss,_it.sabor,_it.tamano,sucursal,_it.cantidad,"apartado",idVenta,sesion.usuario); }
        catch(_e){ _fallasReserva.push(_it.sabor+" "+_it.tamano+": "+(_e&&_e.message?_e.message:_e)); }
      }
      else {
        try{ var _sx=invSaldos(ss,_it.sabor,_it.tamano,sucursal); _invLedger(ss,(canalReal==="Ruta"?"VENTA_RUTA":"VENTA"),_it.sabor,_it.tamano,sucursal,(lotesPorItem[_ii]||[]).join(", "),-_it.cantidad,0,0,_sx.total,_sx.resRuta,_sx.resApartado,idVenta,sesion.usuario,canalReal); }
        catch(_e){ try{ registrarAuditoria(sesion.usuario, sesion.rol, "LEDGER_FAIL", "VENTA "+idVenta+" | "+_it.sabor+" "+_it.tamano+": "+(_e&&_e.message?_e.message:_e)); }catch(_e2){} }
      }
    }
    if (_fallasReserva.length) {
      try{ registrarAuditoria(sesion.usuario, sesion.rol, "RESERVA_SIN_STOCK", "Apartado "+idVenta+" NO apartó stock físico (riesgo de sobreventa): "+_fallasReserva.join("; ")); }catch(_e2){}
    }

    if (clienteId && clienteId !== "Rappi" && clienteId !== "Uber Eats" && clienteId !== "Cortesía" && !esReserva) {
      registrarHistorialCliente(ss, clienteId, idVenta, fechaVenta, sucursal, canalReal, metodoReal, totalVenta, resumenItems);
    }
    const accionAud = esReserva ? "RESERVA" : (esRegalo ? "REGALO" : "VENTA");
    registrarAuditoria(sesion.usuario, sesion.rol, accionAud, `ID: ${idVenta} | ${resumenItems.join(", ")} | ${canalReal} | $${totalVenta}${motivo?" | "+motivo:""}${anticipo?" | anticipo $"+anticipo:""}`);
    _utilMarcarDirty();
    try { _generarAlertasMensajes(ss, sesion); } catch(e) {}
    let msgRes = esReserva ? `📌 Reserva registrada` : (esRegalo ? `✅ Regalo registrado` : `✅ Venta registrada`);
    if (_fallasReserva.length) msgRes += " ⚠️ OJO: no se pudo apartar stock físico ("+_fallasReserva.join("; ")+"). Puede venderse doble — revisa el stock.";
    const _resOk = { ok: true, mensaje: msgRes, idVenta, items: resumenItems, total: totalVenta, cliente: clienteId, esReserva, envio: Number(envio)||0, totalConEnvio: totalVenta + (Number(envio)||0) };
    _opRegistrar(_opId, _resOk);
    return _resOk;

} catch (err) {
// ROLLBACK: revertir todo el stock descontado
try {
const ss2 = SpreadsheetApp.getActiveSpreadsheet();
const hInv2 = ss2.getSheetByName("Inventario");
if (hInv2 && cambiosTotales.length > 0) rollbackInventario(hInv2, cambiosTotales);
} catch(eRb) {
try { registrarAuditoria(sesion.usuario, sesion.rol, "ROLLBACK_FAIL", "VENTA falló y el rollback también: " + eRb.message); } catch(e){}
}
return { ok: false, error: "No se registró la venta: " + (err && err.message ? err.message : String(err)) + ". El inventario quedó intacto." };
} finally {
try { lock.releaseLock(); } catch(_){}
}
}
// =================================================================================
// MERMA
// =================================================================================
function registrarMerma(body, sesion) {
const p = getPermisos(sesion.rol);
if (!p.puedeProducir && !p.puedeTransferir && !p.esAdmin) throw new Error("Tu rol no permite registrar mermas.");
const { items, sucursal: sucBody, motivo } = body;
if (!items || items.length === 0) return { ok: false, error: "Agrega al menos un producto." };
if (!motivo || !motivo.trim()) return { ok: false, error: "El motivo es obligatorio." };
const sucursal = p.puedeVerAmbas ? (sucBody || "Cuajimalpa") : getSucursalUsuario(sesion.usuario);
// Normalizar items
const itemsNorm = items.map(i => ({
sabor: String(i.sabor || "").trim(),
tamano: String(i.tamano || "").trim(),
cantidad: parseInt(i.cantidad) || 0
}));
// Lock
const lock = LockService.getScriptLock();
try { lock.waitLock(30000); }
catch (e) { return { ok: false, error: "El sistema está ocupado, intenta de nuevo." }; }
const cambiosTotales = [];
try {
const _opId = String(body.opId || "").trim();
const _opDup = _opYaRegistrada(_opId);
if (_opDup) return _opDup;
const ss = SpreadsheetApp.getActiveSpreadsheet();
const hojaInv = ss.getSheetByName("Inventario");
if (!hojaInv) throw new Error("No existe la hoja Inventario.");
    // Pre-check agregado por SKU
    const demanda = {};
    for (const item of itemsNorm) {
      if (!item.sabor || !item.tamano || item.cantidad <= 0) {
        return { ok: false, error: `Item inválido: ${item.sabor} ${item.tamano} × ${item.cantidad}` };
      }
      const k = item.sabor + "||" + item.tamano;
      demanda[k] = (demanda[k] || 0) + item.cantidad;
    }
    const datosInvCheck = hojaInv.getDataRange().getValues();
    for (const k in demanda) {
      const [sabor, tamano] = k.split("||");
      const disp = calcularDisponible(datosInvCheck, sabor, tamano, sucursal, new Date());
      if (disp < demanda[k]) return { ok: false, error: `Stock insuficiente: ${sabor} ${tamano} — disponible: ${disp}, solicitado: ${demanda[k]}` };
    }

    const ahora = new Date();
    const idVenta = "MRM-" + ahora.getTime();
    const fechaVenta = ahora;
    const hojaVentas = ss.getSheetByName("Ventas");
    const resumen = [];

    // PASO 1 — descontar todo primero
    const lotesPorItem = [];
    for (const item of itemsNorm) {
      const res = descontarStock(hojaInv, item.sabor, item.tamano, sucursal, item.cantidad);
      lotesPorItem.push(res.lotesDescontados);
      cambiosTotales.push(...res.cambios);
    }
    // PASO 2 — escribir filas de Ventas/Merma
    for (const item of itemsNorm) {
      resumen.push(`${item.cantidad} ${item.sabor} ${item.tamano}`);
      hojaVentas.appendRow([idVenta, fechaVenta, sesion.usuario, sucursal, item.sabor, item.tamano, item.cantidad, 0, 0, "Merma", "Merma", "", "", "", `Merma: ${motivo}`]);
    }
    SpreadsheetApp.flush();

    // v6.5c: asentar merma en Inv_Ledger — antes NO se asentaba y cada merma
    // dejaba drift permanente inventario-vs-ledger en auditarConsistencia().
    for (let _mi = 0; _mi < itemsNorm.length; _mi++) { const _it = itemsNorm[_mi];
      try { const _sx = invSaldos(ss, _it.sabor, _it.tamano, sucursal); _invLedger(ss, "MERMA", _it.sabor, _it.tamano, sucursal, (lotesPorItem[_mi]||[]).join(", "), -_it.cantidad, 0, 0, _sx.total, _sx.resRuta, _sx.resApartado, idVenta, sesion.usuario, motivo||""); }
      catch(_e) { try { registrarAuditoria(sesion.usuario, sesion.rol, "LEDGER_FAIL", "MERMA "+idVenta+" | "+_it.sabor+" "+_it.tamano+": "+(_e&&_e.message?_e.message:_e)); } catch(_e2) {} }
    }
    registrarAuditoria(sesion.usuario, sesion.rol, "MERMA", `${resumen.join(", ")} | ${sucursal} | Motivo: ${motivo}`);
    try { _generarAlertasMensajes(ss, sesion); } catch(e) {}
    const _resOk = { ok: true, mensaje: `✅ Merma registrada: ${resumen.join(", ")}` };
    _opRegistrar(_opId, _resOk);
    return _resOk;

} catch (err) {
try {
const ss2 = SpreadsheetApp.getActiveSpreadsheet();
const hInv2 = ss2.getSheetByName("Inventario");
if (hInv2 && cambiosTotales.length > 0) rollbackInventario(hInv2, cambiosTotales);
} catch(e){}
return { ok: false, error: "No se registró la merma: " + (err && err.message ? err.message : String(err)) + ". El inventario quedó intacto." };
} finally {
try { lock.releaseLock(); } catch(_){}
}
}
// calcularDisponible — acepta hoja O snapshot. Si recibe snapshot lo usa (compatible legacy);
// si recibe la hoja, re-lee fresh. Mantiene firma original.
function calcularDisponible(datosInv, sabor, tamano, sucursal, hoy) {
// InvCore: disponible = total - res_ruta - res_apartado (skip anuladas). Fuente unica.
let datos = datosInv;
if (datos && typeof datos.getDataRange === "function") datos = datos.getDataRange().getValues();
if (!datos || datos.length === 0) return 0;
const H=datos[0]; const ia=H.indexOf("estado_anul"), ir=H.indexOf("res_ruta"), ip=H.indexOf("res_apartado");
let total=0,ruta=0,apart=0;
for (let i=1;i<datos.length;i++){ const r=datos[i];
  if (r[1]!==sabor||r[2]!==tamano||r[3]!==sucursal) continue;
  if (ia!==-1 && r[ia]==="ANULADO") continue;
  total+=Number(r[5])||0; if(ir!==-1)ruta+=Number(r[ir])||0; if(ip!==-1)apart+=Number(r[ip])||0;
}
return total-ruta-apart;
}
// =================================================================================
// STOCK — Atomic, lock-protected, no-FIFO (v4.5.0)
// =================================================================================
// descontarStock — versión robusta:
//   * Re-lee Inventario fresh en cada llamada (no usa snapshot stale)
//   * Sin orden por fecha (FIFO desactivado por decisión de negocio)
//   * Valida stock total antes de tocar
//   * Devuelve { lotesDescontados:[...], cambios:[{fila,cantPrevia,lote}] } para permitir rollback
//   * Hace flush() al final para garantizar persistencia
function descontarStock(hojaInv, sabor, tamano, sucursal, cantidad) {
if (!cantidad || cantidad <= 0) {
return { lotesDescontados: [], cambios: [] };
}
const datosInv = hojaInv.getDataRange().getValues();
// v4.5.13-skip-anulados: jamas descontar de filas anuladas (estado_anul === "ANULADO").
// Si no se filtran, una venta puede restar de "stock fantasma" invisible al usuario:
// la venta queda registrada pero el stock visible no baja. Header dinamico (idx -1 = legacy).
const idxEstadoAnul = datosInv.length ? datosInv[0].indexOf("estado_anul") : -1;
const lotes = [];
let totalDisponible = 0;
for (let i = 1; i < datosInv.length; i++) {
if (idxEstadoAnul !== -1 && datosInv[i][idxEstadoAnul] === "ANULADO") continue; // ignorar anuladas
const [, sab, tam, suc,, cantAct,,, lote, estado] = datosInv[i];
const cant = Number(cantAct) || 0;
if (sab === sabor && tam === tamano && suc === sucursal && cant > 0 && estado !== "agotado_x_anul") {
lotes.push({ fila: i + 1, cantAct: cant, lote: String(lote || "") });
totalDisponible += cant;
}
}
if (totalDisponible < cantidad) {
throw new Error(`Stock insuficiente: ${sabor} ${tamano} en ${sucursal} — disponible ${totalDisponible}, solicitado ${cantidad}`);
}
// Orden estable: por aparición en la hoja (sin sort por fecha)
let restante = cantidad;
const cambios = [];
const lotesDescontados = [];
for (const lote of lotes) {
if (restante <= 0) break;
const descontar = Math.min(restante, lote.cantAct);
const nuevaCant = lote.cantAct - descontar;
hojaInv.getRange(lote.fila, 6).setValue(nuevaCant);
if (nuevaCant === 0) hojaInv.getRange(lote.fila, 10).setValue("agotado");
cambios.push({ fila: lote.fila, cantPrevia: lote.cantAct, lote: lote.lote });
lotesDescontados.push(`${lote.lote || "lote"}(${descontar})`);
restante -= descontar;
}
SpreadsheetApp.flush();
return { lotesDescontados, cambios };
}
// Restaura el inventario a su estado previo dado una lista de cambios.
// Se usa cuando una venta falla a mitad y hay que revertir todo lo descontado.
function rollbackInventario(hojaInv, cambios) {
if (!cambios || cambios.length === 0) return;
for (const c of cambios) {
try {
hojaInv.getRange(c.fila, 6).setValue(c.cantPrevia);
if (c.cantPrevia > 0) hojaInv.getRange(c.fila, 10).setValue("activo");
} catch (e) {
// si una fila falla al revertir, registramos pero seguimos
try { Logger.log("Rollback fila " + c.fila + " falló: " + e.message); } catch(e){}
}
}
SpreadsheetApp.flush();
}
// Alias backward-compat: si algún caller viejo invoca descontarFIFO, lo redirigimos.
// Ignora `datosInv` y `hoy` legacy y delega a descontarStock.
function descontarFIFO(hojaInv, datosInv, sabor, tamano, sucursal, cantidad, hoy) {
const r = descontarStock(hojaInv, sabor, tamano, sucursal, cantidad);
return r.lotesDescontados;
}
