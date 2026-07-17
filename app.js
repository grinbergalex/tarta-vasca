
const API_URL = "https://script.google.com/macros/s/AKfycbxJfDX3lwu5AE9GDA1WGZ3_MP3AAGPsCz54CdzS_cnE9zxQArN1zLmjnZixwc2A13eF/exec";
const LECTURA = ["getCatalogo","getStock","getPrecios","getUsuarios","getAuditoria","buscarCliente","getHistorialCliente","getVentas","getInsumos","getRecetas","getCalculoCosto","listarMovimientosRecientes","getSesionesActivas","repartoEstado","repartoProponer","repartoGeocode"];
let S = {
  token:null, usuario:null, rol:null, sucursal:null, permisos:null,
  catalogo:null, precios:null, stock:null,
  carrito:[], clienteSel:null, comisionesConfig:{},
  filtroSuc:null, filtroTam:null, precioEditar:null, itemTipo:null,
  insumos:[], recetas:[], recetaActual:[],
  movimientos:[], anularPendiente:null,
  lastProdSabor: localStorage.getItem("tv_lastProdSabor") || null,
  lastProdTamano: localStorage.getItem("tv_lastProdTamano") || null,
  modoItem: "suelto",
  // v3.4.16: agregado `tipos: ["venta"]` a cada filterset de reportes
  reporteFiltros: { sabores: [], tamanos: [], canales: [], tipos: ["venta"] },
  ventasReporte: [],
  periodoActual: { preset: "semana", desde: null, hasta: null, modoLinea: "dia" },
  periodoFiltros: { sabores: [], tamanos: [], canales: [], tipos: ["venta"] },
  oportFiltros: { sabores: [], tamanos: [], canales: [], tipos: ["venta"] },
  oportAgrupacion: "sabor_tamano",
  pivotModo: "unidades",
  movSeleccionados: new Set(),
  ruta: { paradas: [], tartasActuales: [] },
  // FEAT-UTILIDAD v3.4.15 + tipos v3.4.16
  utildiarioFiltros: { sabores: [], tamanos: [], canales: [], tipos: ["venta"] },
  utilperiodoFiltros: { sabores: [], tamanos: [], canales: [], tipos: ["venta"] },
  utilperiodoActual: { preset: "semana", desde: null, hasta: null, modoLinea: "dia" },
  // v3.4.16: filtro de tipo de operación para conciliación
  conciFiltros: { tipos: ["venta"] }
};
const PERMISOS_FALLBACK = {
  "Owner":        { esAdmin:true,  puedeVender:true,  puedeProducir:true,  puedeTransferir:true,  puedeVerAmbas:true,  puedeAnular:true  },
  "Vendedor":     { esAdmin:false, puedeVender:true,  puedeProducir:false, puedeTransferir:false, puedeVerAmbas:false, puedeVerStockAmbas:true, puedeAnular:false },
  "Cocinero":     { esAdmin:false, puedeVender:false, puedeProducir:true,  puedeTransferir:true,  puedeVerAmbas:true,  puedeAnular:false },
  "Mixto":        { esAdmin:false, puedeVender:true,  puedeProducir:true,  puedeTransferir:true,  puedeVerAmbas:false, puedeVerStockAmbas:true, puedeAnular:false },
  "Admin_Ventas": { esAdmin:false, puedeVender:true,  puedeProducir:false, puedeTransferir:true,  puedeVerAmbas:true,  puedeAnular:false },
  "Chofer":       { esAdmin:false, puedeVender:false, puedeProducir:false, puedeTransferir:false, puedeVerAmbas:false, puedeAnular:false, esChofer:true }
};
function getPermisos() {
  const base = S.permisos || PERMISOS_FALLBACK[S.rol] || PERMISOS_FALLBACK["Vendedor"];
  // Vendedor/Mixto pueden VER stock de ambas sucursales (siguen vendiendo solo en la suya).
  // Se calcula aquí por si el backend aún no envía la bandera.
  if (base && !base.puedeVerStockAmbas && (S.rol === "Vendedor" || S.rol === "Mixto")) {
    return Object.assign({}, base, { puedeVerStockAmbas: true });
  }
  return base;
}
// v6.5b — Idempotencia: las escrituras críticas (venta/merma/producción/
// transferencia/apartado) mandan body.opId (UUID). Si la respuesta se pierde,
// api() reintenta UNA vez con el MISMO opId y el servidor regresa el resultado
// original en lugar de duplicar la operación.
function opIdNuevo(){ return (crypto.randomUUID ? crypto.randomUUID() : "OP-"+Date.now()+"-"+Math.random().toString(36).slice(2)); }
async function api(accion, body={}, _reintento=false) {
  const payload = {accion, token:S.token, ...body};
  try {
    if (LECTURA.includes(accion)) {
      const r = await fetch(API_URL+"?data="+encodeURIComponent(JSON.stringify(payload)),{redirect:"follow"});
      return JSON.parse(await r.text());
    } else {
      const r = await fetch(API_URL,{method:"POST",body:JSON.stringify(payload),redirect:"follow"});
      const txt = await r.text();
      try { return JSON.parse(txt); }
      catch(e) {
        if (payload.opId && !_reintento) { await new Promise(rs=>setTimeout(rs,1500)); return api(accion, body, true); }
        return {ok:false, error:"No se pudo confirmar la respuesta del servidor. Antes de repetir, revisa Movimientos recientes para ver si la acción ya se guardó."};
      }
    }
  } catch(e) {
    if (payload.opId && !_reintento) { await new Promise(rs=>setTimeout(rs,1500)); return api(accion, body, true); }
    return {ok:false,error:"Error de conexión."};
  }
}
function L(id) { return document.getElementById(id); }
function toast(msg, tipo="success") {
  const el = L("toast");
  el.textContent = msg;
  el.className = "toast "+tipo;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), 3200);
}
function convertirUnidad(cantidad, unidadReceta, unidadInsumo) {
  const ur = (unidadReceta || "").toLowerCase().trim();
  const ui = (unidadInsumo  || "").toLowerCase().trim();
  if (ur === ui) return cantidad;
  if (ur === "g"   && ui === "kg")  return cantidad / 1000;
  if (ur === "kg"  && ui === "g")   return cantidad * 1000;
  if (ur === "g"   && ui === "mg")  return cantidad * 1000;
  if (ur === "mg"  && ui === "g")   return cantidad / 1000;
  if (ur === "ml"  && ui === "l")   return cantidad / 1000;
  if (ur === "l"   && ui === "ml")  return cantidad * 1000;
  if (ur === "ml"  && ui === "lt")  return cantidad / 1000;
  if (ur === "lt"  && ui === "ml")  return cantidad * 1000;
  if (ur === "g"   && (ui === "l" || ui === "lt"))  return cantidad / 1000;
  if ((ur === "l" || ur === "lt") && ui === "g")    return cantidad * 1000;
  if (ur === "ml"  && ui === "g")   return cantidad;
  if (ur === "g"   && ui === "ml")  return cantidad;
  if (ur === "kg"  && (ui === "l" || ui === "lt"))  return cantidad;
  if ((ur === "l" || ur === "lt") && ui === "kg")   return cantidad;
  return cantidad;
}
function fmtMXN(n) {
  return '$'+Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:0,maximumFractionDigits:0});
}
// ============================================================
// v3.4.16 — Helpers de tipo de operación (filtro en reportes)
// ============================================================
// Clasifica una fila de venta según su naturaleza analítica:
//   "venta"  = comercial real (default visible)
//   "regalo" = cortesía (canal "Cortesía")
//   "merma"  = merma operativa (canal "Merma")
function _tipoOpVenta(v) {
  if (!v) return "venta";
  if (v.canal === "Merma") return "merma";
  if (v.canal === "Cortesía") return "regalo";
  return "venta";
}
const TIPOS_OP = [["venta","🛍 Venta"],["regalo","🎁 Regalo"],["merma","🗑 Merma"]];
function _renderChipsTipo(idEl, filtros, fnToggle) {
  const el = L(idEl);
  if (!el) return;
  el.innerHTML = TIPOS_OP.map(function(par){
    var v = par[0], lbl = par[1];
    return '<div class="chip ' + ((filtros.tipos||[]).indexOf(v)>=0 ? 'active' : '') + '" onclick="' + fnToggle + '(\'tipos\',\'' + v + '\')">' + lbl + '</div>';
  }).join("");
}
L("btn-login").addEventListener("click", doLogin);
L("login-pass").addEventListener("keydown", e=>{ if(e.key==="Enter") doLogin(); });
async function doLogin() {
  const usuario=L("login-user").value.trim(), password=L("login-pass").value;
  const err=L("login-error"), btn=L("btn-login");
  if(!usuario||!password){err.textContent="Ingresa usuario y contraseña.";err.style.display="block";return;}
  btn.disabled=true;btn.textContent="Entrando...";err.style.display="none";
  const device_info = navigator.userAgent.substring(0,80);
  const res=await api("login",{usuario,password,device_info});
  if(res.ok){S.token=res.token;S.usuario=res.usuario;S.rol=res.rol;S.sucursal=res.sucursal;S.permisos=res.permisos||null;iniciarApp();}
  else{err.textContent=res.error||"Error al iniciar sesión.";err.style.display="block";}
  btn.disabled=false;btn.textContent="Entrar";
}
function iniciarApp() {
  L("login-screen").style.display="none";
  L("app").style.display="flex";
  L("hdr-usuario").textContent=S.usuario;
  aplicarPermisosUI();
  setupNav();
  cargarCatalogo();
  cargarStock();
  cargarComisionesConfig();
  cargarCanalPreciosAlInicio();
  cargarRecetasAlInicio();
  setTimeout(cargarMensajesHeader, 1500);
  setInterval(cargarMensajesHeader, 120000);
}
function aplicarPermisosUI() {
  const p = getPermisos();
  document.querySelectorAll(".owner-only").forEach(el => { el.style.display = p.esAdmin ? "" : "none"; });
  document.querySelectorAll(".perm-vender").forEach(el => { el.style.display = p.puedeVender ? "" : "none"; });
  document.querySelectorAll(".perm-producir").forEach(el => { el.style.display = p.puedeProducir ? "" : "none"; });
  document.querySelectorAll(".perm-transferir").forEach(el => { el.style.display = p.puedeTransferir ? "" : "none"; });
  document.querySelectorAll(".perm-ver-ambas").forEach(el => { el.style.display = p.puedeVerAmbas ? "" : "none"; });
  const venta_suc = L("venta-suc-group");
  if (venta_suc) venta_suc.style.display = p.puedeVerAmbas ? "" : "none";
}
// ===== MENÚ AGRUPADO (2 niveles) — v3.4.27 =====
const MENU = [
  { id:"mp", label:"🥫 Materia prima", items:[
    { label:"Insumos",          pane:"costos", sub:["setCostosTab","insumos"],     perm:"owner" },
    { label:"Recetas",          pane:"costos", sub:["setCostosTab","recetas"],     perm:"owner" },
    { label:"Calculadora",      pane:"costos", sub:["setCostosTab","calculadora"], perm:"owner" },
    { label:"Carga masiva",     pane:"costos", sub:["setCostosTab","carga"],       perm:"owner" },
  ]},
  { id:"inv", label:"🎂 Inventario", items:[
    { label:"Stock",            pane:"stock",          perm:"all" },
    { label:"Producción",       pane:"produccion",     perm:"producir" },
    { label:"Transferencias",   pane:"transferencias", perm:"transferir" },
    { label:"Pedido sugerido",  pane:"reporte", sub:["setReporteTab","pedido"], perm:"owner" },
    { label:"Ajuste de inventario", pane:"ajuste", perm:"owner" },
  ]},
  { id:"ven", label:"🛒 Ventas", items:[
    { label:"Nueva venta",      pane:"venta",  perm:"vender" },
    { label:"Apartados",        pane:"apartados", perm:"vender" },
    { label:"Rutas",            pane:"rutas",  perm:"owner" },
    { label:"Historial",        pane:"ventas", perm:"owner" },
  ]},
  { id:"rep", label:"🚚 Reparto", items:[
    { label:"Reparto a domicilio", pane:"reparto", perm:"repartoadmin" },
    { label:"Mi ruta", pane:"reparto", perm:"chofer" },
  ]},
  { id:"op", label:"📊 Operación", items:[
    { label:"Seguimiento diario",pane:"reporte", sub:["setReporteTab","diario"],    perm:"owner" },
    { label:"Por período",       pane:"reporte", sub:["setReporteTab","periodo"],   perm:"owner" },
    { label:"Stock por hora",    pane:"reporte", sub:["setReporteTab","stockhora"], perm:"owner" },
    { label:"Objetivos",         pane:"objetivos", perm:"owner" },
    { label:"Cómo se calcula",   pane:"reporte", sub:["setReporteTab","formulas"],  perm:"owner" },
  ]},
  { id:"fin", label:"💰 Finanzas", items:[
    { label:"Gastos",              pane:"costos",  sub:["setCostosTab","gastos"],         perm:"owner" },
    { label:"Comisiones",          pane:"costos",  sub:["setCostosTab","comisiones"],     perm:"owner" },
    { label:"Conciliación",        pane:"reporte", sub:["setReporteTab","conciliacion"],  perm:"owner" },
    { label:"Utilidad por ventas", pane:"utilidades", perm:"owner" },
    { label:"Utilidad unitaria",   pane:"costos",  sub:["setCostosTab","tabla-util"],    perm:"owner" },
    { label:"Utilidad diaria",     pane:"reporte", sub:["setReporteTab","utildiario"],   perm:"owner" },
    { label:"Utilidad por período",pane:"reporte", sub:["setReporteTab","utilperiodo"],  perm:"owner" },
    { label:"Estado de resultados",pane:"reporte", sub:["setReporteTab","estado"],       perm:"owner" },
  ]},
  { id:"adm", label:"⚙️ Admin", items:[
    { label:"Movimientos", pane:"movimientos", perm:"owner" },
    { label:"Alertas",     pane:"alertas",     perm:"owner" },
    { label:"Usuarios",    pane:"usuarios",    perm:"owner" },
    { label:"Auditoría",   pane:"auditoria",   perm:"owner" },
    { label:"Catálogo",    pane:"catalogo",    perm:"owner" },
    { label:"Precios",     pane:"precios",     perm:"owner" },
  ]},
  { id:"notas", label:"📝 Notas", items:[
    { label:"Notas y reportes", pane:"notas", perm:"all" },
  ]},
];
function _permOK(perm){
  const p = getPermisos() || {};
  if(perm==="all") return true;
  if(perm==="owner") return !!p.esAdmin;
  if(perm==="vender") return !!p.puedeVender || !!p.esAdmin;
  if(perm==="producir") return !!p.puedeProducir || !!p.esAdmin;
  if(perm==="transferir") return !!p.puedeTransferir || !!p.esAdmin;
  if(perm==="repartoadmin") return !!p.esAdmin || (!!p.puedeVender && !!p.puedeVerAmbas);
  if(perm==="chofer") return !!p.esChofer || !!p.esAdmin;
  return false;
}
function _loadPane(t){
  if(t==="stock") cargarStock();
  else if(t==="usuarios") cargarUsuarios();
  else if(t==="movimientos") cargarMovimientos();
  else if(t==="auditoria") cargarAuditoria();
  else if(t==="catalogo") cargarCatalogoPantalla();
  else if(t==="ventas") cargarVentas();
  else if(t==="reporte") cargarReporte();
  else if(t==="venta") iniciarVenta();
  else if(t==="rutas") { iniciarRuta(); cargarRutasAbiertas(); }
  else if(t==="costos") { if(!S.insumos.length) cargarCostos(); else renderCostos(); }
  else if(t==="utilidades") cargarUtilidades();
  else if(t==="precios") { cargarPrecios(); cargarZonasEnvio(); cargarCanalPrecios(); }
  else if(t==="objetivos") iniciarTablero();
  else if(t==="transferencias") cargarTransferencias();
  else if(t==="alertas") cargarAlertas();
  else if(t==="reparto") cargarReparto();
  else if(t==="apartados") cargarApartados();
  else if(t==="notas") cargarNotas();
  else if(t==="produccion") cargarProduccionManana();
  else if(t==="ajuste") cargarAjusteInv();
}
function irAPane(pane, subFn, subKey){
  document.querySelectorAll(".tab-pane").forEach(p=>p.style.display="none");
  const el = L("tab-"+pane); if(el) el.style.display="block";
  _loadPane(pane);
  if(subFn && typeof window[subFn]==="function") window[subFn](subKey);
}
function _renderItems(grupo){
  const cont = L("nav-items"); if(!cont) return;
  const items = grupo.items.filter(it=>_permOK(it.perm));
  cont.innerHTML = "";
  items.forEach((it,idx)=>{
    const b = document.createElement("div");
    b.className = "subnav-item" + (idx===0?" active":"");
    b.textContent = it.label;
    b.onclick = ()=>{ cont.querySelectorAll(".subnav-item").forEach(x=>x.classList.remove("active")); b.classList.add("active"); irAPane(it.pane, it.sub?it.sub[0]:null, it.sub?it.sub[1]:null); };
    cont.appendChild(b);
  });
  if(items[0]) irAPane(items[0].pane, items[0].sub?items[0].sub[0]:null, items[0].sub?items[0].sub[1]:null);
}
function renderMenu(){
  const cont = L("nav-groups"); if(!cont) return;
  const grupos = MENU.filter(g=>g.items.some(it=>_permOK(it.perm)));
  cont.innerHTML = "";
  grupos.forEach((g,idx)=>{
    const b = document.createElement("div");
    b.className = "nav-tab nav-group" + (idx===0?" active":"");
    b.textContent = g.label;
    b.onclick = ()=>{ cont.querySelectorAll(".nav-group").forEach(x=>x.classList.remove("active")); b.classList.add("active"); _renderItems(g); };
    cont.appendChild(b);
  });
  if(grupos[0]) _renderItems(grupos[0]);
}
function setupNav(){ renderMenu(); }
// ===== Ajuste de inventario (conteo fisico) — solo Owner =====
async function cargarAjusteInv(){
  const sel = L("ajuste-suc");
  if(sel && !sel.dataset.pob){
    const sucs = ((S.catalogo&&S.catalogo.sucursales)||[]).filter(s=>s.activo).map(s=>s.nombre);
    const list = sucs.length?sucs:["Cuajimalpa","Polanco"];
    sel.innerHTML = list.map(s=>'<option value="'+s+'">'+s+'</option>').join("");
    sel.dataset.pob = "1";
  }
  await refrescarAjusteInv();
}
async function refrescarAjusteInv(){
  const suc = (L("ajuste-suc")&&L("ajuste-suc").value) || "Cuajimalpa";
  const tb = L("ajuste-tbody");
  if(tb) tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:14px">Cargando...</td></tr>';
  const res = await api("getStock",{sucursal:suc});
  if(!res.ok){ toast(res.error||"Error al cargar stock","error"); return; }
  const map = {};
  (res.stock||[]).forEach(s=>{
    if(s.sucursal!==suc) return;
    const k = s.sabor+"||"+s.tamano;
    if(!map[k]) map[k] = {sabor:s.sabor, tamano:s.tamano, sistema:0};
    map[k].sistema += Number(s.cantActual)||0;
  });
  const rows = Object.keys(map).map(k=>map[k]).sort((a,b)=> a.sabor.localeCompare(b.sabor) || a.tamano.localeCompare(b.tamano));
  S._ajusteRows = rows;
  if(!rows.length){ if(tb) tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:14px">Sin stock registrado en '+suc+'.</td></tr>'; return; }
  if(tb) tb.innerHTML = rows.map((r,i)=>
    '<tr style="border-bottom:1px solid var(--border,#f0f0f0)">'+
      '<td style="padding:8px">'+r.sabor+'</td>'+
      '<td style="padding:8px">'+r.tamano+'</td>'+
      '<td style="text-align:center;padding:8px">'+r.sistema+'</td>'+
      '<td style="text-align:center;padding:8px"><input type="number" min="0" id="aj-cnt-'+i+'" value="'+r.sistema+'" style="width:72px;text-align:center;padding:4px" oninput="_ajusteDelta('+i+')"></td>'+
      '<td id="aj-delta-'+i+'" style="text-align:center;padding:8px;color:var(--muted)">0</td>'+
    '</tr>'
  ).join("");
}
function _ajusteDelta(i){
  const r = (S._ajusteRows||[])[i]; if(!r) return;
  const el0 = L("aj-cnt-"+i); const v = el0 ? parseInt(el0.value) : NaN;
  const d = (isNaN(v)?r.sistema:v) - r.sistema;
  const el = L("aj-delta-"+i); if(!el) return;
  el.textContent = (d>0?"+":"")+d;
  el.style.color = d===0 ? "var(--muted)" : (d<0 ? "var(--danger)" : "var(--accent)");
}
async function aplicarAjusteInv(){
  const suc = (L("ajuste-suc")&&L("ajuste-suc").value) || "Cuajimalpa";
  const rows = S._ajusteRows||[];
  const ajustes = [];
  rows.forEach((r,i)=>{
    const el = L("aj-cnt-"+i); if(!el) return;
    const v = parseInt(el.value);
    if(isNaN(v)||v<0) return;
    if(v !== r.sistema) ajustes.push({sabor:r.sabor, tamano:r.tamano, conteo:v});
  });
  if(!ajustes.length){ toast("No hay cambios que aplicar.","error"); return; }
  if(!confirm("Vas a ajustar "+ajustes.length+" producto(s) en "+suc+" al conteo fisico. Esto sobrescribe la cantidad del sistema. Continuar?")) return;
  const btn = L("ajuste-aplicar"); if(btn){ btn.disabled=true; btn.textContent="Aplicando..."; }
  const res = await api("ajustarInventario",{sucursal:suc, ajustes:ajustes});
  if(btn){ btn.disabled=false; btn.textContent="Aplicar ajuste"; }
  if(res.ok){ toast(res.mensaje||"Inventario ajustado"); await refrescarAjusteInv(); if(typeof cargarStock==="function") cargarStock(); }
  else toast(res.error||"Error al ajustar","error");
}
async function cargarCatalogo() {
  const res=await api("getCatalogo");
  if(!res.ok) return;
  S.catalogo=res;
  await cargarPrecios(true);
  poblarSelectsVenta();
}
function poblarSelectsVenta() {
  if(!S.catalogo) return;
  const suc=(S.catalogo.sucursales||[]).filter(s=>s.activo).map(s=>s.nombre);
  const can=[...new Set((S.catalogo.canales||[]).filter(c=>c.activo).map(c=>c.nombre))];
  const canFinal=can.length>0?can.filter(c=>c!=="Uber Eats"):["Tienda","Domicilio","Rappi"];
  const selSuc = L("venta-sucursal");
  const sucActual = selSuc?.value;
  llenar("venta-sucursal", suc);
  if(selSuc){
    if(sucActual && suc.includes(sucActual)){
      selSuc.value = sucActual;
    } else if(S.sucursal && suc.includes(S.sucursal)){
      selSuc.value = S.sucursal;
    }
  }
  // v3.4.17-fix: preservar canal y método al repoblar — evita que post-confirmar venta
  // se resetee la selección del usuario (bug reportado por Yesenia/Dulce).
  const selCanal = L("venta-canal");
  const canalActual = selCanal?.value;
  const selMetodo = L("venta-metodo");
  const metodoActual = selMetodo?.value;
  llenar("venta-canal",canFinal);
  if(selCanal && canalActual && canFinal.includes(canalActual)){
    selCanal.value = canalActual;
  }
  actualizarMetodoPago(); actualizarUICanal();
  if(selMetodo && metodoActual){
    const optsMet = Array.from(selMetodo.options).map(o=>o.value);
    if(optsMet.includes(metodoActual)) selMetodo.value = metodoActual;
  }
  if(!getPermisos().puedeVerAmbas) L("venta-suc-group").style.display="none";
  const sabAll=(S.catalogo.sabores||[]).filter(s=>s.activo).map(s=>s.nombre);
  const tamAll=(S.catalogo.tamanos||[]).filter(t=>t.activo).map(t=>t.nombre);
  const prodSaborActual = L("prod-sabor")?.value;
  const prodTamanoActual = L("prod-tamano")?.value;
  llenar("prod-sabor", sabAll);
  llenar("prod-tamano", tamAll);
  if (prodSaborActual && sabAll.includes(prodSaborActual)) L("prod-sabor").value = prodSaborActual;
  else if (S.lastProdSabor && sabAll.includes(S.lastProdSabor)) L("prod-sabor").value = S.lastProdSabor;
  if (prodTamanoActual && tamAll.includes(prodTamanoActual)) L("prod-tamano").value = prodTamanoActual;
  else if (S.lastProdTamano && tamAll.includes(S.lastProdTamano)) L("prod-tamano").value = S.lastProdTamano;
  ["receta-sabor","calc-sabor","bulk-receta-sabor"].forEach(id=>llenar(id,sabAll));
  ["receta-tamano","calc-tamano","bulk-receta-tamano"].forEach(id=>llenar(id,tamAll));
  actualizarSelectoresCascada();
}
function stockConDisponibilidad(campo) {
  if(!S.stock) return [];
  const sucursal = getPermisos().puedeVerAmbas ? (L("venta-sucursal")?.value || null) : S.sucursal;
  const disponibles=S.stock.filter(s=>!s.vencido&&s.cantActual>0&&(!sucursal||s.sucursal===sucursal));
  return [...new Set(disponibles.map(s=>s[campo]))];
}
function llenar(id, opciones) {
  const sel=L(id);
  if(!sel) return;
  sel.innerHTML=opciones.map(o=>`<option value="${o}">${o}</option>`).join("");
}
const COMISIONES_DEFAULT = {"Rappi":-0.23,"Uber Eats":-0.23,"Tarjeta":-0.06,"Transferencia":-0.03,"Efectivo":0};
function getComisionesActuales(){
  if(S.comisionesConfig && Object.keys(S.comisionesConfig).length>0) return S.comisionesConfig;
  return COMISIONES_DEFAULT;
}
function getComision(canal,metodo){
  const C=getComisionesActuales();
  return canal==="Rappi"||canal==="Uber Eats"?C[canal]||-0.23:(C[metodo]||0);
}
function esPlataforma(canal){return canal==="Rappi"||canal==="Uber Eats";}
function actualizarMetodoPago(){
  const canal=L("venta-canal")?.value;
  if(!canal) return;
  const esPlat=esPlataforma(canal);
  llenar("venta-metodo",esPlat?[canal]:["Efectivo","Tarjeta","Transferencia"]);
  const metodoGroup=L("venta-metodo")?.parentElement;
  if(metodoGroup) metodoGroup.style.display=esPlat?"none":"block";
}
function actualizarUICanal(){
  const canal=L("venta-canal")?.value;
  if(!canal) return;
  const aviso=L("canal-aviso"), cli=L("cliente-section");
  if(esPlataforma(canal)){aviso.style.display="flex";if(cli)cli.style.display="none";}
  else{aviso.style.display="none";if(cli)cli.style.display="block";}
}
L("venta-canal")?.addEventListener("change",()=>{ onCanalChange(); });
async function cargarStock() {
  L("stock-content").innerHTML=`<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  const res=await api("getStock");
  if(!res.ok){L("stock-content").innerHTML=`<div class="empty-state"><div>Error al cargar</div></div>`;return;}
  S.stock=res.stock;
  // v6.4: si el catálogo no cargó al iniciar sesión (falla de red), reintentarlo aquí
  // para que los filtros de sucursal/tamaño y la tabla sabor×tamaño no se queden vacíos.
  if(!S.catalogo) await cargarCatalogo();
  renderStock(); poblarSelectsVenta();
}
function renderStock(){
  const stock=S.stock||[];
  const busqueda=(L("stock-search").value||"").toLowerCase();
  let f=stock.filter(s=>!s.vencido&&s.cantActual>0);
  if(S.filtroSuc) f=f.filter(s=>s.sucursal===S.filtroSuc);
  if(S.filtroTam) f=f.filter(s=>s.tamano===S.filtroTam);
  if(busqueda)    f=f.filter(s=>s.sabor.toLowerCase().includes(busqueda));
  if(!S.cuadritosVisibles) S.cuadritosVisibles={total:true,tienda:true,apartado:true,ruta:true};
  const _sumTotal = f.reduce((s,i)=>s+Number(i.cantActual||0),0);
  const _sumTienda = f.reduce((s,i)=>s+Number(i.disponibleTienda!=null?i.disponibleTienda:(i.disponibleNeto!=null?i.disponibleNeto:i.cantActual)||0),0);
  const _sumApartado = f.reduce((s,i)=>s+Number(i.reservadoApartado||0),0);
  const _sumRuta = f.reduce((s,i)=>s+Number(i.reservadoRuta||0),0);
  L("sum-total").textContent=_sumTotal;
  if(L("sum-tienda")) L("sum-tienda").textContent=_sumTienda;
  if(L("sum-apartado")) L("sum-apartado").textContent=_sumApartado;
  if(L("sum-ruta")) L("sum-ruta").textContent=_sumRuta;
  [["total","card-total"],["tienda","card-tienda"],["apartado","card-apartado"],["ruta","card-ruta"]].forEach(([k,id])=>{ const el=L(id); if(el) el.style.display=S.cuadritosVisibles[k]?"":"none"; });
  const _cuadEl=L("filtros-cuadritos");
  if(_cuadEl){
    const _labels={total:"Total",tienda:"Tienda",apartado:"Apartado",ruta:"Ruta"};
    _cuadEl.innerHTML=Object.keys(_labels).map(k=>`<div class="chip ${S.cuadritosVisibles[k]?'active':''}" data-cuad="${k}">${_labels[k]}</div>`).join("");
    _cuadEl.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{const k=c.dataset.cuad;S.cuadritosVisibles[k]=!S.cuadritosVisibles[k];renderStock();}));
  }
  L("stock-summary").style.display="grid";
  L("stock-sub").textContent=S.filtroSuc||((!getPermisos().puedeVerAmbas&&!getPermisos().puedeVerStockAmbas)?S.sucursal:"todas las sucursales");
  if(S.catalogo&&(getPermisos().puedeVerAmbas||getPermisos().puedeVerStockAmbas)){
    const sucs=(S.catalogo.sucursales||[]).filter(s=>s.activo).map(s=>s.nombre);
    L("filtros-suc").innerHTML=`<div class="chip ${!S.filtroSuc?'active':''}" data-suc="">Todas</div>`+sucs.map(s=>`<div class="chip ${S.filtroSuc===s?'active':''}" data-suc="${s}">${s}</div>`).join("");
    L("filtros-suc").querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{S.filtroSuc=c.dataset.suc||null;renderStock();}));
  } else {
    L("filtros-suc").innerHTML="";
  }
  if(S.catalogo){
    const tams=(S.catalogo.tamanos||[]).filter(t=>t.activo).map(t=>t.nombre);
    L("filtros-tam").innerHTML=`<div class="chip ${!S.filtroTam?'active':''}" data-tam="">Todos</div>`+tams.map(t=>`<div class="chip ${S.filtroTam===t?'active':''}" data-tam="${t}">${t}</div>`).join("");
    L("filtros-tam").querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{S.filtroTam=c.dataset.tam||null;renderStock();}));
  }
  if(f.length===0){L("stock-content").innerHTML=`<div class="empty-state"><div class="empty-icon">📦</div><div>Sin stock disponible</div></div>`;return;}
  const puedeAmbas = getPermisos().puedeVerAmbas || getPermisos().puedeVerStockAmbas;
  const sucsRender = puedeAmbas
    ? (S.filtroSuc ? [S.filtroSuc] : ["Cuajimalpa","Polanco"])
    : [S.sucursal];
  let html = "";
  sucsRender.forEach(suc => {
    const stockSuc = f.filter(s => s.sucursal === suc);
    const totalSuc = stockSuc.reduce((t, s) => t + Number(s.cantActual||0), 0);
    const reservadoSuc = stockSuc.reduce((t, s) => t + Number(s.reservado||0), 0);
    const netoSuc = stockSuc.reduce((t, s) => t + Number(s.disponibleNeto!=null ? s.disponibleNeto : s.cantActual||0), 0);
    const color = suc === "Cuajimalpa" ? "var(--green)" : "var(--accent)";
    html += `<div class="card" style="margin-bottom:12px;border-left:4px solid ${color};overflow-x:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div style="font-weight:700;font-size:15px;color:${color}">📍 ${suc}</div>
        <div style="font-size:12px;color:var(--muted)"><strong>${totalSuc}</strong> piezas${reservadoSuc>0?` · <span style="color:#7a1f2b">${reservadoSuc} apartado/ruta</span> · <strong style="color:#1d7a35">${netoSuc} neto</strong>`:""}</div>
      </div>
      ${reservadoSuc>0?`<div style="font-size:11px;color:#7a1f2b;background:rgba(122,31,43,.06);border-radius:6px;padding:6px 8px;margin-bottom:8px">🔒 Reservado (ruta/apartado): ${stockSuc.filter(s=>Number(s.reservado||0)>0).map(s=>`${s.reservado}× ${s.sabor} ${s.tamano}`).join(" · ")}</div>`:""}
      ${_tablaPivotInventario(stockSuc, color, "inv_"+suc.toLowerCase())}
    </div>`;
  });
  L("stock-content").innerHTML = html;
}
L("stock-search").addEventListener("input",renderStock);
async function iniciarVenta(){
  await cargarStock();
  if(S.catalogo) poblarSelectsVenta();
  actualizarUICanal();
  actualizarSelectoresCascada();
}
function getSucursalVenta(){return getPermisos().puedeVerAmbas?(L("venta-sucursal")?.value||S.sucursal):S.sucursal;}
function calcDisp(sabor,tamano){
  if(!S.stock) return 0;
  const suc=getSucursalVenta();
  const enCarrito=S.carrito.filter(i=>i.sabor===sabor&&i.tamano===tamano).reduce((s,i)=>s+i.cantidad,0);
  const enStock=S.stock.filter(s=>s.sabor===sabor&&s.tamano===tamano&&s.sucursal===suc&&!s.vencido&&s.cantActual>0).reduce((s,i)=>s+i.cantActual,0);
  return Math.max(0,enStock-enCarrito);
}
function getPrecio(tamano){if(!S.precios)return 0;const p=S.precios.find(p=>p.tamano===tamano);return p?p.precio:0;}
function actualizarSelectoresCascada(){
  if(!S.stock||!S.catalogo) return;
  const suc = getSucursalVenta();
  const sabActual = L("item-sabor")?.value;
  const tamActual = L("item-tamano")?.value;
  const stockSuc = S.stock.filter(s=>!s.vencido&&s.cantActual>0&&s.sucursal===suc);
  const saboresConStock = [...new Set(stockSuc.map(s=>s.sabor))];
  const selSab = L("item-sabor");
  if(selSab){
    if(saboresConStock.length === 0){
      selSab.innerHTML = '<option value="">— Sin stock disponible —</option>';
      selSab.disabled = true;
    } else {
      selSab.disabled = false;
      selSab.innerHTML = saboresConStock.map(n=>`<option value="${n}">${n}</option>`).join("");
      if(sabActual && saboresConStock.includes(sabActual)) selSab.value = sabActual;
    }
  }
  const sabFinal = L("item-sabor")?.value;
  const stockSabSuc = sabFinal ? stockSuc.filter(s=>s.sabor===sabFinal) : [];
  const tamanosConStock = [...new Set(stockSabSuc.map(s=>s.tamano))];
  const selTam = L("item-tamano");
  if(selTam){
    if(tamanosConStock.length === 0){
      selTam.innerHTML = '<option value="">—</option>';
      selTam.disabled = true;
    } else {
      selTam.disabled = false;
      selTam.innerHTML = tamanosConStock.map(n=>`<option value="${n}">${n}</option>`).join("");
      if(tamActual && tamanosConStock.includes(tamActual)) selTam.value = tamActual;
    }
  }
  const tamFinal = L("item-tamano")?.value;
  actualizarSelectCantidad(sabFinal, tamFinal);
  actualizarPrecioPreview();
}
function actualizarSelectCantidad(sabor, tamano){
  const sel = L("item-cantidad");
  if(!sel) return;
  if(!sabor||!tamano){
    sel.innerHTML=`<option value="">— selecciona sabor y tamaño —</option>`;
    sel.disabled=true;
    L("item-disp").innerHTML="";
    return;
  }
  const disp = calcDisp(sabor, tamano);
  if(disp<=0){
    sel.innerHTML=`<option value="">Sin stock disponible</option>`;
    sel.disabled=true;
    L("item-disp").innerHTML=`<span class="disp-badge disp-out">Sin stock</span>`;
    return;
  }
  const valActual = parseInt(sel.value)||1;
  sel.innerHTML = Array.from({length:disp},(_,i)=>i+1).map(n=>`<option value="${n}">${n}</option>`).join("");
  sel.disabled = false;
  if(valActual>=1&&valActual<=disp) sel.value = valActual;
  const cls = disp<=2?"disp-low":"disp-ok";
  L("item-disp").innerHTML=`<span class="disp-badge ${cls}">${disp} disponibles</span>`;
}
function onItemSaborChange(){ actualizarSelectoresCascada(); }
function onItemTamanoChange(){
  actualizarSelectCantidad(L("item-sabor")?.value, L("item-tamano")?.value);
  actualizarPrecioPreview();
}
L("venta-sucursal")?.addEventListener("change",()=>{ actualizarSelectoresCascada(); });
function actualizarDisp(){ actualizarSelectoresCascada(); }
let tipoOp = "venta";
function setTipoOp(tipo, btn){
  tipoOp = tipo;
  document.querySelectorAll(".tipo-op-btn").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  const aviso = L("aviso-tipo-op");
  const ventaFields = L("venta-fields");
  const descRow = L("descuento-row");
  const motivoRow = L("motivo-row");
  const clienteSection = L("cliente-section");
  const btnConfirmar = L("btn-confirmar");
  if(tipo === "venta"){
    aviso.style.display = "none";
    ventaFields.style.display = "block";
    descRow.style.display = "flex";
    motivoRow.style.display = "none";
    clienteSection.style.display = "block";
    btnConfirmar.textContent = "Confirmar venta ✓";
    btnConfirmar.style.background = "";
    L("modo-item-row").style.display = "flex";
  } else if(tipo === "regalo"){
    L("modo-item-row").style.display = "none";
    L("paquete-box").style.display = "none";
    L("suelto-box").style.display = "block";
    S.modoItem = "suelto";
    aviso.style.display = "block";
    aviso.style.background = "rgba(46,92,74,.1)";
    aviso.style.color = "var(--success)";
    aviso.textContent = "🎁 Regalo — se descuenta stock pero no se cobra. Requiere motivo.";
    ventaFields.style.display = "none";
    descRow.style.display = "none";
    motivoRow.style.display = "block";
    clienteSection.style.display = "block";
    btnConfirmar.textContent = "Registrar regalo 🎁";
    btnConfirmar.style.background = "#2E5C4A";
  } else if(tipo === "merma"){
    L("modo-item-row").style.display = "none";
    L("paquete-box").style.display = "none";
    L("suelto-box").style.display = "block";
    S.modoItem = "suelto";
    aviso.style.display = "block";
    aviso.style.background = "rgba(192,57,43,.08)";
    aviso.style.color = "var(--danger)";
    aviso.textContent = "🗑 Merma — se descuenta stock sin registrar venta ni cliente. Requiere motivo.";
    ventaFields.style.display = "none";
    descRow.style.display = "none";
    motivoRow.style.display = "block";
    clienteSection.style.display = "none";
    btnConfirmar.textContent = "Registrar merma 🗑";
    btnConfirmar.style.background = "var(--danger)";
  }
  S.carrito = [];
  L("op-motivo").value = "";
  renderCarrito();
}
// === Precios Rappi por tamaño (el cliente paga el precio de la app de Rappi, no el de mostrador) ===
// Editar aquí si Rappi cambia sus precios. Aplica al seleccionar canal "Rappi".
const RAPPI_PRECIOS = { "Individual": 240, "Mediana": 420, "Grande": 750 };
function precioCanal(sabor, tamano, canal){
  if(canal === "Rappi" && RAPPI_PRECIOS[tamano] != null) return RAPPI_PRECIOS[tamano];
  let p = getPrecioActualLocal(sabor, tamano);
  const regla = (S.canalPrecios||[]).find(r=>r.canal===canal&&r.activo);
  if(regla && p>0){
    if(regla.tipo==="pct") p = Math.round(p*(1+regla.valor/100));
    else p = Math.max(0, p + regla.valor);
  }
  return p;
}
function actualizarPrecioPreview(){
  const sabor = L("item-sabor")?.value;
  const tamano = L("item-tamano")?.value;
  const cantidad = parseInt(L("item-cantidad")?.value)||1;
  const descVal = parseFloat(L("item-descuento")?.value)||0;
  const descTipo = L("item-desc-tipo")?.value||"pct";
  const canalActual = L("venta-canal")?.value||"";
  let precioBase = precioCanal(sabor, tamano, canalActual);
  if(!precioBase){ L("item-precio-preview").innerHTML=""; return; }
  let precioFinal = precioBase;
  if(descVal > 0){
    if(descTipo === "pct") precioFinal = precioBase * (1 - descVal/100);
    else precioFinal = Math.max(0, precioBase - descVal);
  }
  const preview = descVal > 0
    ? `<span style="text-decoration:line-through;color:var(--muted)">$${precioBase.toLocaleString('es-MX')}</span> → <strong style="color:var(--accent)">$${precioFinal.toLocaleString('es-MX')}</strong>`
    : `<span style="color:var(--muted)">$${precioBase.toLocaleString('es-MX')}</span>`;
  L("item-precio-preview").innerHTML = preview + ` × ${cantidad}`;
}
function getPrecioActualLocal(sabor, tamano){
  if(!S.precios) return 0;
  const esp = S.precios.find(p=>p.sabor===sabor&&p.tamano===tamano);
  if(esp&&esp.precio>0) return esp.precio;
  const base = S.precios.find(p=>p.tamano===tamano&&p.precio>0);
  return base ? base.precio : 0;
}
L("item-descuento")?.addEventListener("input", actualizarPrecioPreview);
L("item-desc-tipo")?.addEventListener("change", actualizarPrecioPreview);
L("item-sabor")?.addEventListener("change", actualizarPrecioPreview);
L("item-tamano")?.addEventListener("change", actualizarPrecioPreview);
L("item-cantidad")?.addEventListener("input", actualizarPrecioPreview);
L("btn-agregar-item")?.addEventListener("click",()=>{
  const sabor=L("item-sabor")?.value, tamano=L("item-tamano")?.value;
  const cantidad=parseInt(L("item-cantidad")?.value)||0;
  const sucursal=getSucursalVenta();
  if(!sabor||!tamano){toast("Selecciona sabor y tamaño","error");return;}
  if(!cantidad||cantidad<1){toast("Selecciona una cantidad","error");return;}
  const optSab = L("item-sabor")?.querySelector(`option[value="${sabor}"]`);
  const optTam = L("item-tamano")?.querySelector(`option[value="${tamano}"]`);
  if(optSab?.disabled){toast(`${sabor} no tiene stock en ${sucursal}`, "error");return;}
  if(optTam?.disabled){toast(`Tamaño ${tamano} no disponible para ${sabor} en ${sucursal}`, "error");return;}
  const canalActual = L("venta-canal")?.value||"";
  let precioBase = precioCanal(sabor,tamano,canalActual);
  let precioFinal=precioBase, descuento=0, descTipo="";
  if(tipoOp==="venta"){
    const descVal=parseFloat(L("item-descuento")?.value)||0;
    descTipo=L("item-desc-tipo")?.value||"pct";
    if(descVal>0){
      descuento=descVal;
      if(descTipo==="pct") precioFinal=precioBase*(1-descVal/100);
      else precioFinal=Math.max(0,precioBase-descVal);
    }
  } else { precioFinal=0; }
  precioFinal=Math.round(precioFinal*100)/100;
  const disponible=calcDisp(sabor,tamano);
  const enCarrito=S.carrito.filter(i=>i.sabor===sabor&&i.tamano===tamano).reduce((s,i)=>s+i.cantidad,0);
  if(enCarrito+cantidad>disponible){
    toast(`Solo hay ${disponible} disponibles (${enCarrito} ya en carrito)`,"error");
    actualizarSelectCantidad(sabor,tamano);
    return;
  }
  S.carrito.push({sabor,tamano,cantidad,precioBase,precio:precioFinal,descuento,descTipo,subtotal:precioFinal*cantidad});
  if(L("item-descuento")) L("item-descuento").value="0";
  L("item-precio-preview").innerHTML="";
  renderCarrito();
  actualizarSelectCantidad(sabor,tamano);
  toast(`${sabor} ${tamano} × ${cantidad} agregado`);
});
function renderCarrito(){
  const items=L("carrito-items");
  if(S.carrito.length===0){items.innerHTML=`<div class="carrito-vacio">Sin productos — agrega uno arriba</div>`;L("carrito-total-bar").style.display="none";return;}
  items.innerHTML=S.carrito.map((item,i)=>{
    const tieneDesc=item.descuento>0&&tipoOp==="venta";
    const descLabel=tieneDesc?(item.descTipo==="pct"?`-${item.descuento}%`:`-$${item.descuento}`):"";
    return `<div class="carrito-item"${item.esPaquete?' style="background:rgba(200,96,42,.05);border-left:3px solid var(--accent);padding-left:8px"':''}>
      <div class="carrito-info">
        <div class="carrito-nombre">${item.sabor} ${item.tamano}${item.esPaquete?' <span style="font-size:9px;background:var(--accent);color:white;padding:2px 6px;border-radius:6px;letter-spacing:1px;margin-left:4px">PAQ</span>':''}</div>
        <div class="carrito-sub">
          ${item.cantidad} ×
          ${tieneDesc?`<span style="text-decoration:line-through;color:var(--muted)">$${item.precioBase.toLocaleString('es-MX')}</span> `:""}
          $${item.precio.toLocaleString('es-MX')}
          ${tieneDesc?`<span style="color:var(--success);font-size:11px"> ${descLabel}</span>`:""}
          ${tipoOp!=="venta"?`<span style="color:var(--muted);font-size:11px"> (${tipoOp})</span>`:""}
        </div>
      </div>
      <span class="carrito-precio">${tipoOp==="venta"?"$"+item.subtotal.toLocaleString('es-MX'):"$0"}</span>
      <button class="btn-remove" onclick="quitarItem(${i})">×</button>
    </div>`;
  }).join("");
  const total=S.carrito.reduce((s,i)=>s+i.subtotal,0);
  const totalOriginal=S.carrito.reduce((s,i)=>s+i.precioBase*i.cantidad,0);
  const hayDesc=totalOriginal>total&&tipoOp==="venta";
  const costoEnvio = S.costoEnvio || 0;
  const totalConEnvio = tipoOp==="venta" ? total + costoEnvio : 0;
  const canal  = L("venta-canal")?.value||"";
  const metodo = L("venta-metodo")?.value||"";
  const comPct = tipoOp==="venta" ? getComision(canal,metodo) : 0;
  const comMonto = Math.round(totalConEnvio * comPct);
  const ingresoNeto = totalConEnvio + comMonto;
  L("total-num").textContent = tipoOp==="venta" ? "$"+totalConEnvio.toLocaleString('es-MX') : "$0";
  L("carrito-total-bar").style.display="flex";
  const descTotalLabel=L("descuento-total-label");
  if(hayDesc){
    descTotalLabel.style.display="block";
    descTotalLabel.textContent=`Ahorro cliente: $${(totalOriginal-total).toLocaleString('es-MX')}`;
  } else { descTotalLabel.style.display="none"; }
  const envioLabel = L("envio-total-label");
  if(costoEnvio>0&&tipoOp==="venta"){ envioLabel.style.display="block"; envioLabel.textContent=`Envío: $${costoEnvio.toLocaleString('es-MX')} incluido`; }
  else { envioLabel.style.display="none"; }
  let comLabel = L("comision-total-label");
  if(!comLabel){
    comLabel = document.createElement("div");
    comLabel.id="comision-total-label";
    comLabel.style.cssText="font-size:11px;color:rgba(255,255,255,.6)";
    L("carrito-total-bar").firstElementChild.appendChild(comLabel);
  }
  if(comMonto!==0&&tipoOp==="venta"&&getPermisos().esAdmin){
    const pct=Math.abs(comPct*100).toFixed(0);
    const nombre=canal==="Rappi"||canal==="Uber Eats"?canal:metodo;
    comLabel.style.display="block";
    comLabel.textContent=`${nombre} ${pct}%: -$${Math.abs(comMonto).toLocaleString('es-MX')} → Neto: $${ingresoNeto.toLocaleString('es-MX')}`;
  } else { comLabel.style.display="none"; }
}
function quitarItem(idx){S.carrito.splice(idx,1);renderCarrito();actualizarDisp();}
let searchTO;
L("cli-nombre")?.addEventListener("input",()=>{
  clearTimeout(searchTO);
  const v=L("cli-nombre").value.trim();
  if(v.length<2){L("sugerencias").style.display="none";return;}
  searchTO=setTimeout(()=>buscarCliente(v),350);
});
async function buscarCliente(term){
  const res=await api("buscarCliente",{busqueda:term});
  if(!res.ok||res.clientes.length===0){L("sugerencias").style.display="none";return;}
  L("sugerencias").innerHTML=res.clientes.map(c=>`<div class="sug-item" onclick='selCliente(${JSON.stringify(c).replace(/'/g,"\\'")})'><strong>${c.nombre}</strong>${c.telefono?` · ${c.telefono}`:""}</div>`).join("");
  L("sugerencias").style.display="block";
}
function selCliente(c){
  S.clienteSel=c;
  L("cli-nombre").value=c.nombre;
  L("sugerencias").style.display="none";
  L("cli-encontrado").style.display="block";
  L("cli-nuevo").style.display="none";
  L("cli-avatar").textContent=c.nombre[0].toUpperCase();
  L("cli-nombre-disp").textContent=c.nombre;
  L("cli-meta-disp").textContent=[c.telefono,c.email].filter(Boolean).join(" · ")||"Sin datos adicionales";
}
function limpiarCliente(){S.clienteSel=null;L("cli-nombre").value="";L("cli-encontrado").style.display="none";L("cli-nuevo").style.display="grid";}
document.addEventListener("click",e=>{if(!e.target.closest("#cli-nombre")&&!e.target.closest("#sugerencias"))L("sugerencias").style.display="none";});
L("btn-confirmar").addEventListener("click",async()=>{
  if(S.carrito.length===0){toast("Agrega al menos un producto","error");return;}
  const sucursal=getSucursalVenta();
  const btn=L("btn-confirmar");
  btn.disabled=true; btn.textContent="Registrando...";
  if(tipoOp==="merma"){
    const motivo=L("op-motivo").value.trim();
    if(!motivo){toast("El motivo es obligatorio","error");btn.disabled=false;btn.textContent="Registrar merma 🗑";return;}
    const res=await api("registrarMerma",{
      items:S.carrito.map(i=>({sabor:i.sabor,tamano:i.tamano,cantidad:i.cantidad})),
      sucursal, motivo, opId: opIdNuevo()
    });
    if(res.ok){ toast(`✅ Merma registrada`); limpiarVenta(); cargarStock(); }
    else toast(res.error,"error");
  } else {
    const canal = tipoOp==="regalo" ? "Cortesía" : L("venta-canal").value;
    const metodo = tipoOp==="regalo" ? "Regalo" : L("venta-metodo").value;
    if(tipoOp==="venta"&&!canal){toast("Selecciona un canal","error");btn.disabled=false;btn.textContent="Confirmar venta ✓";return;}
    const motivo = tipoOp==="regalo" ? L("op-motivo").value.trim() : "";
    if(tipoOp==="regalo"&&!motivo){toast("El motivo es obligatorio","error");btn.disabled=false;btn.textContent="Registrar regalo 🎁";return;}
    const plataforma=esPlataforma(canal);
    let cliente=null;
    if(!plataforma){
      const nombre=L("cli-nombre").value.trim();
      if(!nombre){toast("El nombre del cliente es obligatorio","error");btn.disabled=false;btn.textContent=tipoOp==="regalo"?"Registrar regalo 🎁":"Confirmar venta ✓";return;}
      cliente=S.clienteSel||{nombre,telefono:L("cli-tel").value.trim(),email:L("cli-email").value.trim()};
    }
    const items=S.carrito.map(i=>({
      sabor:i.sabor, tamano:i.tamano, cantidad:i.cantidad,
      precioUnitario:i.precio, descuento:i.descuento||0, descTipo:i.descTipo||"",
      esPaquete: i.esPaquete === true,
      paqueteId: i.paqueteId || ""
    }));
    const res=await api("registrarVenta",{items,canal,metodoPago:metodo,sucursal,cliente,tipoOp,motivo,opId:opIdNuevo()});
    if(res.ok){
      const total=S.carrito.reduce((s,i)=>s+i.subtotal,0);
      toast(tipoOp==="regalo"?`✅ Regalo registrado`:`✅ Venta $${total.toLocaleString('es-MX')} registrada`);
      const _idRecibo=res.idVenta;
      const _cTel=(cliente&&cliente.telefono)||"";
      const _cMail=(cliente&&cliente.email)||"";
      limpiarVenta(); cargarStock();
      if(_idRecibo && tipoOp!=="regalo" && tipoOp!=="merma" && true){ imprimirReciboAuto(_idRecibo); }
    } else toast(res.error,"error");
  }
  btn.disabled=false;
  btn.textContent=tipoOp==="merma"?"Registrar merma 🗑":tipoOp==="regalo"?"Registrar regalo 🎁":"Confirmar venta ✓";
});
function limpiarVenta(){
  S.carrito=[];S.clienteSel=null;S.costoEnvio=0;renderCarrito();
  L("cli-nombre").value="";L("cli-tel").value="";L("cli-email").value="";
  L("cli-encontrado").style.display="none";L("cli-nuevo").style.display="grid";
  const selCant=L("item-cantidad");
  if(selCant){selCant.innerHTML=`<option value="">— selecciona sabor y tamaño —</option>`;selCant.disabled=true;}
  L("item-disp").innerHTML="";
  if(L("item-descuento")) L("item-descuento").value="0";
  L("item-precio-preview").innerHTML="";
  L("op-motivo").value="";
  setTipoOp("venta",L("op-venta"));
}
L("btn-limpiar-venta").addEventListener("click",()=>{limpiarVenta();toast("Venta limpiada");});
L("btn-cargar-prod").addEventListener("click",async()=>{
  const sabor=L("prod-sabor").value,tamano=L("prod-tamano").value,cantidad=parseInt(L("prod-cantidad").value);
  if(!sabor||!tamano||cantidad<1){toast("Completa todos los campos","error");return;}
  const btn=L("btn-cargar-prod");btn.disabled=true;btn.textContent="Cargando...";
  const res=await api("altaProduccion",{sabor,tamano,sucursal:"Cuajimalpa",cantidad,opId:opIdNuevo()});
  if(res.ok){
    toast(res.mensaje);
    L("prod-cantidad").value="1";
    S.lastProdSabor = sabor;
    S.lastProdTamano = tamano;
    try { localStorage.setItem("tv_lastProdSabor", sabor); localStorage.setItem("tv_lastProdTamano", tamano); } catch(e) {}
    cargarStock();
  } else toast(res.error,"error");
  btn.disabled=false;btn.textContent="Cargar producción";
});
const PAQUETE_CONFIG = {
  paquete3: { size: 3, totalBase: 590, totalRappi: 630, tituloBase: "🎁 Paquete 3 indiv — $590 (no Rappi)", tituloRappi: "🎁 Paquete 3 indiv — $630 (Rappi)" },
  paquete4: { size: 4, totalBase: 720, totalRappi: 780, tituloBase: "🎁 Paquete 4 indiv — $720 (no Rappi)", tituloRappi: "🎁 Paquete 4 indiv — $780 (Rappi)" }
};
function _esCanalRappi() {
  return (L("venta-canal")?.value || "") === "Rappi";
}
function getPaqueteTotal(modo) {
  const cfg = PAQUETE_CONFIG[modo];
  return _esCanalRappi() ? cfg.totalRappi : cfg.totalBase;
}
function getPaqueteTitulo(modo) {
  const cfg = PAQUETE_CONFIG[modo];
  return _esCanalRappi() ? cfg.tituloRappi : cfg.tituloBase;
}
function setModoItem(modo) {
  S.modoItem = modo;
  document.querySelectorAll(".modo-item-btn").forEach(b => b.classList.remove("active"));
  const btnId = modo === "suelto" ? "modo-suelto-btn" : (modo === "paquete3" ? "modo-paquete3-btn" : "modo-paquete4-btn");
  L(btnId).classList.add("active");
  L("suelto-box").style.display = (modo === "suelto") ? "block" : "none";
  L("paquete-box").style.display = (modo === "suelto") ? "none" : "block";
  if (modo !== "suelto") {
    const cfg = PAQUETE_CONFIG[modo];
    L("paq-titulo").textContent = getPaqueteTitulo(modo);
    L("btn-agregar-paquete").textContent = `+ Agregar paquete al carrito ($${getPaqueteTotal(modo)})`;
    let h = "";
    for (let i = 1; i <= cfg.size; i++) {
      h += `<div class="form-group" style="margin-bottom:8px"><label class="form-label">Individual ${i}</label><select class="form-select paq-sabor" id="paq-sabor-${i}" onchange="actualizarPaqueteStocks()"></select></div>`;
    }
    L("paq-selectores").innerHTML = h;
    poblarSelectsPaquete();
  }
}
function _getStockIndividual() {
  if (!S.stock) return {};
  const sucursal = getSucursalVenta();
  const stockInd = (S.stock || []).filter(s => s.tamano === "Individual" && !s.vencido && s.cantActual > 0 && (!sucursal || s.sucursal === sucursal));
  const porSabor = {};
  stockInd.forEach(s => { porSabor[s.sabor] = (porSabor[s.sabor] || 0) + Number(s.cantActual); });
  S.carrito.forEach(it => {
    if (it.tamano === "Individual") porSabor[it.sabor] = (porSabor[it.sabor] || 0) - it.cantidad;
  });
  return porSabor;
}
function poblarSelectsPaquete() {
  if (!S.stock) return;
  const modo = S.modoItem;
  if (modo === "suelto") return;
  const size = PAQUETE_CONFIG[modo].size;
  const porSabor = _getStockIndividual();
  const sabores = Object.keys(porSabor).filter(s => porSabor[s] > 0).sort();
  if (sabores.length === 0) {
    L("paq-aviso").innerHTML = '<span style="color:var(--danger)">⚠ Sin stock de individuales</span>';
    for (let i = 1; i <= size; i++) L("paq-sabor-" + i).innerHTML = '<option value="">— sin stock —</option>';
    return;
  }
  for (let i = 1; i <= size; i++) L("paq-sabor-" + i).innerHTML = '<option value="">— Selecciona —</option>';
  actualizarPaqueteStocks();
}
function actualizarPaqueteStocks() {
  const modo = S.modoItem;
  if (modo === "suelto") return;
  const size = PAQUETE_CONFIG[modo].size;
  const porSabor = _getStockIndividual();
  const seleccionados = [];
  for (let i = 1; i <= size; i++) seleccionados.push(L("paq-sabor-" + i).value || "");
  for (let i = 1; i <= size; i++) {
    const sel = L("paq-sabor-" + i);
    const valActual = sel.value;
    const consumidoOtros = {};
    seleccionados.forEach((s, j) => {
      if (j !== i - 1 && s) consumidoOtros[s] = (consumidoOtros[s] || 0) + 1;
    });
    const sabores = Object.keys(porSabor).filter(s => porSabor[s] > (consumidoOtros[s] || 0)).sort();
    if (valActual && !sabores.includes(valActual)) sabores.push(valActual);
    sabores.sort();
    let opts = '<option value="">— Selecciona —</option>';
    sabores.forEach(s => {
      const dispParaEsteSelect = (porSabor[s] || 0) - (consumidoOtros[s] || 0);
      opts += `<option value="${s}"${s===valActual?' selected':''}>${s} (${dispParaEsteSelect} disp)</option>`;
    });
    sel.innerHTML = opts;
    if (valActual) sel.value = valActual;
  }
  const completos = seleccionados.every(s => s);
  const conteo = {};
  seleccionados.forEach(s => { if (s) conteo[s] = (conteo[s] || 0) + 1; });
  const conflictos = [];
  for (const s in conteo) {
    if (conteo[s] > (porSabor[s] || 0)) conflictos.push(`${s} (${conteo[s]}/${porSabor[s]||0})`);
  }
  if (conflictos.length > 0) {
    L("paq-aviso").innerHTML = '<span style="color:var(--danger)">⚠ Stock insuficiente: ' + conflictos.join(", ") + '</span>';
    L("btn-agregar-paquete").disabled = true;
  } else if (!completos) {
    L("paq-aviso").innerHTML = `<span style="color:var(--muted)">Selecciona los ${size} sabores</span>`;
    L("btn-agregar-paquete").disabled = true;
  } else {
    L("paq-aviso").textContent = "";
    L("btn-agregar-paquete").disabled = false;
  }
}
L("btn-agregar-paquete").addEventListener("click", () => {
  const modo = S.modoItem;
  if (modo === "suelto") return;
  const cfg = PAQUETE_CONFIG[modo];
  const total = getPaqueteTotal(modo);
  const sabores = [];
  for (let i = 1; i <= cfg.size; i++) sabores.push(L("paq-sabor-" + i).value);
  if (sabores.some(s => !s)) { toast(`Selecciona los ${cfg.size} sabores`, "error"); return; }
  const porSabor = _getStockIndividual();
  const conteo = {};
  sabores.forEach(s => { conteo[s] = (conteo[s] || 0) + 1; });
  for (const s in conteo) {
    if (conteo[s] > (porSabor[s] || 0)) {
      toast(`Stock insuficiente de ${s}: necesitas ${conteo[s]}, hay ${porSabor[s] || 0}`, "error");
      return;
    }
  }
  const precios = new Array(cfg.size).fill(Math.floor(total / cfg.size));
  let resto = total - precios.reduce((s,p)=>s+p, 0);
  for (let i = 0; i < cfg.size && resto > 0; i++) { precios[i]++; resto--; }
  const pid = "PKG-" + Date.now() + "-" + Math.floor(Math.random()*1000);
  sabores.forEach((sabor, idx) => {
    const precio = precios[idx];
    S.carrito.push({
      sabor, tamano: "Individual", cantidad: 1,
      precio, precioBase: precio,
      descuento: 0, descTipo: "", subtotal: precio,
      esPaquete: true, paqueteId: pid, paqueteSize: cfg.size
    });
  });
  for (let i = 1; i <= cfg.size; i++) L("paq-sabor-" + i).value = "";
  toast(`✅ Paquete ${cfg.size} individuales agregado ($${total})`);
  renderCarrito();
  actualizarDisp();
  poblarSelectsPaquete();
});
function recalcularPreciosPaquetesEnCarrito() {
  if (!S.carrito || S.carrito.length === 0) return;
  const grupos = {};
  S.carrito.forEach((it, idx) => {
    if (!it.esPaquete || !it.paqueteId) return;
    if (!grupos[it.paqueteId]) grupos[it.paqueteId] = [];
    grupos[it.paqueteId].push({ it, idx });
  });
  let cambio = false;
  for (const pid in grupos) {
    const g = grupos[pid];
    const size = g.length;
    const modo = size === 3 ? "paquete3" : (size === 4 ? "paquete4" : null);
    if (!modo) continue;
    const nuevoTotal = getPaqueteTotal(modo);
    const sumaActual = g.reduce((s,x)=>s+x.it.precio, 0);
    if (sumaActual === nuevoTotal) continue;
    const precios = new Array(size).fill(Math.floor(nuevoTotal / size));
    let resto = nuevoTotal - precios.reduce((s,p)=>s+p, 0);
    for (let i = 0; i < size && resto > 0; i++) { precios[i]++; resto--; }
    g.forEach((x, i) => {
      S.carrito[x.idx].precio = precios[i];
      S.carrito[x.idx].precioBase = precios[i];
      S.carrito[x.idx].subtotal = precios[i];
    });
    cambio = true;
  }
  if (cambio) { toast("Precios de paquetes recalculados para nuevo canal"); renderCarrito(); }
}
document.addEventListener("DOMContentLoaded", () => {
  const sel = L("venta-canal");
  if (sel) sel.addEventListener("change", () => {
    if (S.modoItem !== "suelto") setModoItem(S.modoItem);
    recalcularPreciosPaquetesEnCarrito();
  });
});
let _ventasHist = [];
async function cargarVentas(){
  L("ventas-list").innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  const fd=L("fv-fdesde")?.value||"", fh=L("fv-fhasta")?.value||"";
  const params={}; if(fd) params.desde=fd; if(fh) params.hasta=fh;
  const res=await api("getVentas", params);
  if(!res.ok) return;
  _ventasHist = res.ventas || [];
  poblarFiltrosVentas();
  renderVentasHist();
}
function _optsVent(sel, valores, label){
  const el=L(sel); if(!el) return;
  const actual=el.value;
  el.innerHTML = `<option value="">${label}</option>` + valores.map(v=>`<option value="${v}">${v}</option>`).join("");
  if(valores.includes(actual)) el.value=actual;
}
function poblarFiltrosVentas(){
  const uniq=(f)=>Array.from(new Set(_ventasHist.map(f).filter(Boolean))).sort();
  _optsVent("fv-sucursal", uniq(v=>v.sucursal), "Todas las sucursales");
  _optsVent("fv-canal",    uniq(v=>v.canal),    "Todos los canales");
  _optsVent("fv-metodo",   uniq(v=>v.metodoPago),"Todos los métodos");
  _optsVent("fv-sabor",    uniq(v=>v.sabor),     "Todos los sabores");
  _optsVent("fv-tamano",   uniq(v=>v.tamano),    "Todos los tamaños");
  _optsVent("fv-tipo",     uniq(v=>v.tipoOp),    "Todos los tipos");
}
function limpiarFiltrosVentas(){
  ["fv-sucursal","fv-canal","fv-metodo","fv-sabor","fv-tamano","fv-tipo","fv-fdesde","fv-fhasta"].forEach(id=>{const e=L(id);if(e)e.value="";});
  cargarVentas();
}
async function imprimirReciboAuto(idVenta){
  try{
    const res = await api("generarReciboPDF", {idVenta});
    if(!res || !res.ok || !res.url){ toast((res&&res.error)||"No se pudo generar el recibo","error"); return; }
    const ifr=document.createElement('iframe');
    ifr.style.display='none';
    ifr.src=res.url;
    document.body.appendChild(ifr);
    ifr.onload=function(){
      try{ ifr.contentWindow.focus(); ifr.contentWindow.print(); }catch(e){}
      setTimeout(()=>{ try{ document.body.removeChild(ifr); }catch(e){} }, 60000);
    };
  }catch(e){ toast("Error al generar el recibo","error"); }
}

async function enviarRecibo(idVenta, opts){
  opts=opts||{};
  const metodo=prompt("¿Cómo enviar el recibo?\n\n1 = WhatsApp\n2 = Correo");
  if(metodo===null) return;
  const op=String(metodo).trim();
  if(op==="1"){
    let tel=prompt(opts.tel?"Confirma el WhatsApp del cliente (10 dígitos):":"Número de WhatsApp del cliente (10 dígitos):", opts.tel||"");
    if(!tel) return;
    tel=String(tel).replace(/\D/g,"");
    if(tel.length===10) tel="52"+tel;
    var _w=window.open("","_blank"); // iOS: abrir la pestaña DENTRO del toque, antes del await
    toast("Generando recibo...");
    const res=await api("generarReciboPDF",{idVenta});
    if(!res||!res.ok){ if(_w)try{_w.close();}catch(e){} toast((res&&res.error)||"No se pudo generar el recibo","error"); return; }
    var _wa="https://wa.me/"+tel+"?text="+encodeURIComponent("Aquí está tu recibo de Tarta Vasca\n"+res.url);
    if(_w){ try{_w.location.href=_wa;}catch(e){ window.location.href=_wa; } } else { window.location.href=_wa; }
  } else if(op==="2"){
    const email=prompt(opts.email?"Confirma el correo del cliente:":"Correo del cliente:", opts.email||"");
    if(!email) return;
    toast("Enviando recibo por correo...");
    const res=await api("enviarReciboEmail",{idVenta,email});
    if(res&&res.ok) toast("✅ "+(res.mensaje||"Recibo enviado")); else toast((res&&res.error)||"No se pudo enviar","error");
  } else { toast("Opción no válida (1 o 2)","error"); }
}
function renderVentasHist(){
  const fS=L("fv-sucursal")?.value||"", fC=L("fv-canal")?.value||"", fM=L("fv-metodo")?.value||"",
        fSa=L("fv-sabor")?.value||"", fT=L("fv-tamano")?.value||"", fTp=L("fv-tipo")?.value||"";
  const rows=_ventasHist.filter(v=>
    (!fS||v.sucursal===fS)&&(!fC||v.canal===fC)&&(!fM||v.metodoPago===fM)&&
    (!fSa||v.sabor===fSa)&&(!fT||v.tamano===fT)&&(!fTp||(v.tipoOp||"Venta")===fTp));
  if(rows.length===0){ L("ventas-list").innerHTML=`<div class="empty-state"><div>Sin ventas con esos filtros</div></div>`; if(L("ventas-count"))L("ventas-count").textContent="0 operaciones"; return; }
  const grupos={};
  rows.forEach(v=>{
    if(!grupos[v.idVenta]) grupos[v.idVenta]={...v,items:[]};
    grupos[v.idVenta].items.push({sabor:v.sabor,tamano:v.tamano,cantidad:v.cantidad,subtotal:v.subtotal});
    if (v.rutaId && !grupos[v.idVenta].rutaId) grupos[v.idVenta].rutaId = v.rutaId;
  });
  const lista=Object.values(grupos);
  const totMonto=rows.reduce((s,v)=>s+(Number(v.subtotal)||0),0);
  if(L("ventas-count")) L("ventas-count").textContent = `${lista.length} operación${lista.length!==1?"es":""} · ${rows.length} líneas · $${totMonto.toLocaleString('es-MX')}`;
  L("ventas-list").innerHTML=lista.map(g=>{
    const rutaTag = g.rutaId ? `<span class="tag" style="background:rgba(200,96,42,.15);color:var(--accent);font-weight:700">🚚 ${g.rutaId}</span>` : "";
    const metodoColor = (!g.metodoPago || g.metodoPago === "Por definir") ? 'style="background:#FFEBEE;color:#C0392B;font-weight:700"' : "";
    return `
    <div class="historial-item">
      <div class="hist-fecha">${g.fecha?g.fecha.substring(0,16).replace('T',' '):''} · <code style="font-size:10px;color:var(--muted)">${g.idVenta}</code></div>
      <div class="hist-productos">${g.items.map(i=>`${i.cantidad}× ${i.sabor} ${i.tamano}`).join(" · ")}</div>
      <div class="hist-meta">
        <span class="tag">${g.canal}</span><span class="tag" ${metodoColor}>${g.metodoPago}</span><span class="tag">${g.sucursal}</span>
        ${g.clienteNombre?`<span class="tag">${g.clienteNombre}</span>`:""}
        ${rutaTag}
        <span class="tag tag-total">$${g.items.reduce((s,i)=>s+i.subtotal,0).toLocaleString('es-MX')}</span>
        <button class="btn-sm" onclick="enviarRecibo('${g.idVenta}')" style="margin-left:6px">🧾 Recibo</button>
      </div>
    </div>`;
  }).join("");
}
async function cargarCatalogoPantalla(){
  const res=await api("getCatalogo");if(!res.ok)return;S.catalogo=res;
  const renderList=(items,tipo,id)=>{
    L(id).innerHTML=items.map(item=>`
      <div class="cat-item">
        <span style="font-size:14px;font-weight:500">${item.nombre}${!item.activo?'<span style="color:var(--muted);font-size:11px"> (inactivo)</span>':''}</span>
        ${item.activo?`<button class="btn-sm btn-sm-danger" onclick="togCat('${tipo}','${item.nombre}',false)">Dar de baja</button>`:`<button class="btn-sm btn-sm-success" onclick="togCat('${tipo}','${item.nombre}',true)">Reactivar</button>`}
      </div>`).join("");
  };
  renderList(res.sabores,"Sabor","cat-sabores");renderList(res.tamanos,"Tamaño","cat-tamanos");renderList(res.canales||[],"Canal","cat-canales");
}
async function togCat(tipo,nombre,activar){
  if(!activar&&!confirm(`¿Dar de baja "${nombre}"?`)) return;
  const mapa={Sabor:activar?"altaSabor":"bajaSabor","Tamaño":activar?"altaTamano":"bajaTamano",Canal:activar?"altaCanal":"bajaCanal"};
  const res=await api(mapa[tipo],{nombre});
  if(res.ok){toast(res.mensaje);cargarCatalogoPantalla();cargarCatalogo();}else toast(res.error,"error");
}
function abrirModalItem(tipo){S.itemTipo=tipo;L("modal-item-title").textContent=`Nuevo ${tipo.toLowerCase()}`;L("modal-item-label").textContent=`Nombre del ${tipo.toLowerCase()}`;L("modal-item-input").value="";L("modal-nuevo-item").classList.add("show");}
L("btn-guardar-item").addEventListener("click",async()=>{
  const nombre=L("modal-item-input").value.trim();
  if(!nombre){toast("Ingresa un nombre","error");return;}
  const mapa={Sabor:"altaSabor","Tamaño":"altaTamano"};
  const res=await api(mapa[S.itemTipo],{nombre});
  if(res.ok){toast(res.mensaje);L("modal-nuevo-item").classList.remove("show");cargarCatalogoPantalla();cargarCatalogo();}else toast(res.error,"error");
});
async function cargarPrecios(silencioso=false){
  if(!silencioso) L("precios-content").innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  const [resP,resC]=await Promise.all([api("getPrecios"),api("getCatalogo")]);
  if(!resP.ok||!resC.ok) return;
  S.precios=resP.precios;
  if(silencioso) return;
  const tamanos=(resC.tamanos||[]).filter(t=>t.activo).map(t=>t.nombre);
  const getP=t=>{const p=resP.precios.find(p=>p.tamano===t);return p?p.precio:0;};
  L("precios-content").innerHTML=tamanos.map(tamano=>`
    <div class="precio-row">
      <span class="precio-label">${tamano}</span>
      <span class="precio-val" onclick="abrirModalPrecio('${tamano}',${getP(tamano)})">$${getP(tamano).toLocaleString('es-MX')}</span>
    </div>`).join("");
}
async function repararPrecios(){
  const btn=event.target;btn.disabled=true;btn.textContent="Reparando...";
  const res=await api("repararPreciosSabores",{});
  if(res.ok){toast(res.mensaje);cargarPrecios();}else toast(res.error,"error");
  btn.disabled=false;btn.textContent="🔧 Crear precios para sabores sin precio";
}
function abrirModalPrecio(tamano,precioActual){S.precioEditar=tamano;L("modal-precio-title").textContent=`Precio — ${tamano}`;L("modal-precio-input").value=precioActual;L("modal-precio").classList.add("show");setTimeout(()=>L("modal-precio-input").focus(),100);}
L("btn-guardar-precio").addEventListener("click",async()=>{
  const precio=parseFloat(L("modal-precio-input").value);
  if(isNaN(precio)||precio<0){toast("Precio inválido","error");return;}
  const tamano=S.precioEditar;
  const sabores=(S.catalogo?.sabores||[]).filter(s=>s.activo).map(s=>s.nombre);
  const promesas=sabores.map(sabor=>api("updatePrecio",{sabor,tamano,precio}));
  const resultados=await Promise.all(promesas);
  if(resultados.every(r=>r.ok)){toast(`✅ Precio ${tamano} = $${precio.toLocaleString('es-MX')}`);L("modal-precio").classList.remove("show");cargarPrecios();}
  else toast("Error al guardar precio","error");
});
function setCostosTab(tab){
  document.querySelectorAll(".costos-tab").forEach(t=>{t.classList.toggle("active",t.getAttribute("onclick")===`setCostosTab('${tab}')`)});
  document.querySelectorAll(".costos-section").forEach(s=>s.classList.remove("active"));
  L("costos-"+tab).classList.add("active");
  if(tab==="recetas") renderRecetaActual();
  if(tab==="calculadora") calcularCosto();
  if(tab==="tabla-util") renderTablaUtilidades();
  if(tab==="gastos") cargarGastos();
  if(tab==="comisiones") cargarComisionesConfig();
}
async function cargarCostos(){
  L("insumos-list").innerHTML=`<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  const [resI,resR]=await Promise.all([api("getInsumos"),api("getRecetas")]);
  if(resI.ok) S.insumos=resI.insumos;
  if(resR.ok) S.recetas=resR.recetas;
  renderCostos();
}
function renderCostos(){
  renderInsumos();
  renderRecetaActual();
  poblarRecetaInsumoSelect();
}
function renderInsumos(){
  const activos=S.insumos.filter(i=>i.activo);
  if(activos.length===0){
    L("insumos-list").innerHTML=`<div class="empty-state"><div class="empty-icon">📦</div><div>Sin insumos cargados</div></div>`;
    return;
  }
  L("insumos-list").innerHTML=activos.map(ins=>`
    <div class="insumo-row">
      <div>
        <div class="insumo-nombre">${ins.nombre}</div>
        <div class="insumo-meta">${ins.buyQty} ${ins.buyUnit} = ${fmtMXN(ins.buyPrice)}</div>
      </div>
      <div>
        <div class="insumo-costo">${fmtMXN(ins.costoPorUnidad)}</div>
        <div class="insumo-costo-label">por ${ins.buyUnit==="unidad"?"unidad":ins.buyUnit}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn-del-small" onclick="abrirEditarInsumo('${ins.id}')" title="Editar">✏️</button>
        <button class="btn-del-small" onclick="bajaInsumo('${ins.id}')" title="Dar de baja">✕</button>
      </div>
    </div>`).join("");
}
function poblarRecetaInsumoSelect(){
  const activos=S.insumos.filter(i=>i.activo);
  const sel=L("receta-new-insumo");
  if(!sel) return;
  sel.innerHTML=activos.map(i=>`<option value="${i.id}">${i.nombre} (${fmtMXN(i.costoPorUnidad)}/${i.buyUnit})</option>`).join("");
}
["new-ins-buyqty","new-ins-price"].forEach(id=>{
  L(id)?.addEventListener("input",()=>{
    const qty=parseFloat(L("new-ins-buyqty")?.value)||0;
    const price=parseFloat(L("new-ins-price")?.value)||0;
    if(qty>0&&price>0){
      const cu=price/qty;
      L("new-ins-costo-preview").style.display="flex";
      L("new-ins-costo-val").textContent=fmtMXN(cu)+` / ${L("new-ins-buyunit")?.value||"unidad"}`;
    } else L("new-ins-costo-preview").style.display="none";
  });
});
["edit-ins-buyqty","edit-ins-price"].forEach(id=>{
  L(id)?.addEventListener("input",()=>{
    const qty=parseFloat(L("edit-ins-buyqty")?.value)||0;
    const price=parseFloat(L("edit-ins-price")?.value)||0;
    if(qty>0&&price>0){L("edit-ins-costo-val").textContent=fmtMXN(price/qty)+` / ${L("edit-ins-buyunit")?.value||"unidad"}`;}
  });
});
async function guardarNuevoInsumo(){
  const nombre=L("new-ins-nombre").value.trim();
  const buyQty=parseFloat(L("new-ins-buyqty").value)||0;
  const buyUnit=L("new-ins-buyunit").value;
  const buyPrice=parseFloat(L("new-ins-price").value)||0;
  if(!nombre){toast("Ingresa el nombre del insumo","error");return;}
  if(!buyQty||!buyPrice){toast("Ingresa la dimensión de compra y el precio","error");return;}
  const res=await api("saveInsumo",{insumo:{nombre,descripcion:L("new-ins-desc").value.trim(),buyQty,buyUnit,buyPrice,activo:true}});
  if(res.ok){
    toast(`✅ ${nombre} agregado`);
    L("new-ins-nombre").value="";L("new-ins-desc").value="";L("new-ins-buyqty").value="";L("new-ins-price").value="";
    L("new-ins-costo-preview").style.display="none";
    const resI=await api("getInsumos");if(resI.ok)S.insumos=resI.insumos;
    renderInsumos();poblarRecetaInsumoSelect();
  } else toast(res.error,"error");
}
function abrirEditarInsumo(id){
  const ins=S.insumos.find(i=>i.id===id);
  if(!ins) return;
  L("edit-ins-id").value=id;
  L("edit-ins-nombre").value=ins.nombre;
  L("edit-ins-desc").value=ins.descripcion||"";
  L("edit-ins-buyqty").value=ins.buyQty;
  L("edit-ins-buyunit").value=ins.buyUnit;
  L("edit-ins-price").value=ins.buyPrice;
  L("edit-ins-costo-val").textContent=fmtMXN(ins.costoPorUnidad)+` / ${ins.buyUnit}`;
  L("modal-editar-insumo").classList.add("show");
}
L("btn-guardar-editar-insumo").addEventListener("click",async()=>{
  const id=L("edit-ins-id").value;
  const buyQty=parseFloat(L("edit-ins-buyqty").value)||0;
  const buyPrice=parseFloat(L("edit-ins-price").value)||0;
  const res=await api("saveInsumo",{insumo:{id,nombre:L("edit-ins-nombre").value.trim(),descripcion:L("edit-ins-desc").value.trim(),buyQty,buyUnit:L("edit-ins-buyunit").value,buyPrice,activo:true}});
  if(res.ok){toast("✅ Insumo actualizado");L("modal-editar-insumo").classList.remove("show");const resI=await api("getInsumos");if(resI.ok)S.insumos=resI.insumos;renderInsumos();poblarRecetaInsumoSelect();}
  else toast(res.error,"error");
});
async function bajaInsumo(id){
  if(!confirm("¿Dar de baja este insumo?")) return;
  const res=await api("deleteInsumo",{id});
  if(res.ok){toast("Insumo dado de baja");const resI=await api("getInsumos");if(resI.ok)S.insumos=resI.insumos;renderInsumos();poblarRecetaInsumoSelect();}
  else toast(res.error,"error");
}
function cargarRecetaActual(){renderRecetaActual();}
function renderRecetaActual(){
  const sabor=L("receta-sabor")?.value;
  const tamano=L("receta-tamano")?.value;
  if(!sabor||!tamano){L("receta-ingredientes-list").innerHTML="";return;}
  const receta=S.recetas.find(r=>r.sabor===sabor&&r.tamano===tamano);
  S.recetaActual=receta?JSON.parse(JSON.stringify(receta.ingredientes)):[];
  renderIngredientesReceta();
}
function renderIngredientesReceta(){
  const el=L("receta-ingredientes-list");
  if(!S.recetaActual||S.recetaActual.length===0){el.innerHTML=`<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px">Sin ingredientes — agrega abajo</div>`;return;}
  el.innerHTML=S.recetaActual.map((ing,idx)=>{
    const ins=S.insumos.find(i=>i.id===ing.insumoId);
    const costoPorUni=ins?ins.costoPorUnidad:0;
    const cantConvertida=ins?convertirUnidad(ing.cantidad,ing.unidad,ins.buyUnit):ing.cantidad;
    const costoLinea=costoPorUni*cantConvertida;
    return `<div class="receta-row">
      <div><div class="receta-row-nombre">${ing.insumoNombre||"Insumo"}</div></div>
      <div class="receta-row-cant">${ing.cantidad} ${ing.unidad}</div>
      <div class="receta-row-costo">${costoLinea>0?fmtMXN(costoLinea):"—"}</div>
      <button class="btn-del-small" onclick="quitarIngredienteReceta(${idx})">✕</button>
    </div>`;
  }).join("");
  const costoTotal=S.recetaActual.reduce((s,ing)=>{const ins=S.insumos.find(i=>i.id===ing.insumoId);const cant=ins?convertirUnidad(ing.cantidad,ing.unidad,ins.buyUnit):ing.cantidad;return s+(ins?ins.costoPorUnidad*cant:0);},0);
  el.innerHTML+=`<div class="calc-total-row"><span style="color:var(--muted)">Subtotal ingredientes:&nbsp;<strong style="color:var(--accent);font-size:16px">${fmtMXN(costoTotal)}</strong></span></div>`;
}
function syncInsumoNombre(){
  const insumoId = L("receta-new-insumo")?.value;
  if(!insumoId) return;
  const ins = S.insumos.find(i=>i.id===insumoId);
  if(ins) L("receta-new-nombre").value = ins.nombre;
}
function agregarIngredienteReceta(){
  const insumoId  = L("receta-new-insumo")?.value || "";
  const nombre    = L("receta-new-nombre")?.value.trim() || "";
  const qty       = parseFloat(L("receta-new-qty")?.value)||0;
  const unit      = L("receta-new-unit")?.value||"unidad";
  const nombreFinal = nombre || (S.insumos.find(i=>i.id===insumoId)?.nombre) || "";
  if(!nombreFinal){ toast("Escribe el nombre del ingrediente o selecciona uno del catálogo","error"); return; }
  if(!qty){ toast("Ingresa la cantidad","error"); return; }
  S.recetaActual.push({ insumoId, insumoNombre: nombreFinal, cantidad: qty, unidad: unit });
  L("receta-new-qty").value = "";
  L("receta-new-nombre").value = "";
  L("receta-new-insumo").value = "";
  renderIngredientesReceta();
}
function quitarIngredienteReceta(idx){S.recetaActual.splice(idx,1);renderIngredientesReceta();}
async function guardarRecetaCompleta(){
  const sabor=L("receta-sabor")?.value;
  const tamano=L("receta-tamano")?.value;
  if(!sabor||!tamano){toast("Selecciona sabor y tamaño","error");return;}
  const btn=L("btn-guardar-receta");btn.disabled=true;btn.textContent="Guardando...";
  const res=await api("saveReceta",{sabor,tamano,ingredientes:S.recetaActual});
  if(res.ok){
    toast(`✅ Receta ${sabor} ${tamano} guardada`);
    const resR=await api("getRecetas");if(resR.ok)S.recetas=resR.recetas;
  } else toast(res.error,"error");
  btn.disabled=false;btn.textContent="Guardar receta";
}
async function calcularCosto(){
  const sabor=L("calc-sabor")?.value;
  const tamano=L("calc-tamano")?.value;
  if(!sabor||!tamano) return;
  L("calc-resultado").innerHTML=`<div class="loading"><div class="spinner"></div>Calculando...</div>`;
  const res=await api("getCalculoCosto",{sabor,tamano});
  if(!res.ok){L("calc-resultado").innerHTML=`<div class="empty-state"><div>${res.error}</div></div>`;return;}
  if(res.lineas.length===0){L("calc-resultado").innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><div>Sin receta para ${sabor} ${tamano}</div></div>`;return;}
  const precio=S.precios?.find(p=>p.tamano===tamano)?.precio||0;
  const margen=precio>0?((precio-res.costoTotal)/precio*100):0;
  L("calc-resultado").innerHTML=`
    <div class="calc-hero">
      <div class="calc-hero-label">${sabor} · ${tamano}</div>
      <div class="calc-hero-price">${fmtMXN(res.costoTotal)}</div>
      <div class="calc-hero-sub">Costo de producción${precio>0?` · PVP: ${fmtMXN(precio)} · Margen: ${margen.toFixed(1)}%`:""}</div>
    </div>
    <table class="calc-lineas-table">
      <thead><tr><th>Ingrediente</th><th>Cant.</th><th style="text-align:right">Costo</th></tr></thead>
      <tbody>${res.lineas.map(l=>`<tr><td>${l.insumoNombre}</td><td style="color:var(--muted)">${l.cantidad} ${l.unidad}</td><td style="text-align:right;font-weight:700;color:var(--accent)">${l.costoLinea>0?fmtMXN(l.costoLinea):"—"}</td></tr>`).join("")}</tbody>
    </table>
    <div class="calc-total-row"><span style="color:var(--muted)">Total costo:&nbsp;<strong style="color:var(--accent);font-size:16px">${fmtMXN(res.costoTotal)}</strong></span></div>`;
}
async function procesarBulkInsumos(){
  const texto=L("bulk-insumos-text").value.trim();
  if(!texto){toast("Ingresa la lista de insumos","error");return;}
  const btn=L("btn-bulk-insumos");btn.disabled=true;btn.textContent="Procesando con IA...";
  try {
    // v6.5d: la llamada a la IA ahora pasa por el backend (accion iaProcesar),
    // que guarda la API key en Propiedades del script — nunca en este HTML.
    const resIA=await api("iaProcesar",{prompt:`Convierte esta lista de insumos de pastelería a JSON. Extrae: nombre, descripcion (opcional), buyQty (número), buyUnit (unidad: unidad/g/kg/ml/L/docena), buyPrice (número, precio en MXN). Responde SOLO con un array JSON sin markdown ni texto extra. Lista:\n${texto}`});
    if(!resIA.ok) throw new Error(resIA.error);
    const txt=resIA.texto||"";
    const clean=txt.replace(/```json|```/g,"").trim();
    const insumos=JSON.parse(clean);
    const res=await api("bulkLoadInsumos",{insumos});
    if(res.ok){toast(`✅ ${res.creados.length} insumos cargados`);L("bulk-insumos-text").value="";const resI=await api("getInsumos");if(resI.ok)S.insumos=resI.insumos;renderInsumos();poblarRecetaInsumoSelect();}
    else toast(res.error,"error");
  } catch(e){toast("Error al procesar: "+e.message,"error");}
  btn.disabled=false;btn.textContent="Procesar y cargar insumos";
}
async function procesarBulkReceta(){
  const texto=L("bulk-receta-text").value.trim();
  const sabor=L("bulk-receta-sabor")?.value;
  const tamano=L("bulk-receta-tamano")?.value;
  if(!texto||!sabor||!tamano){toast("Completa todos los campos","error");return;}
  const btn=L("btn-bulk-receta");btn.disabled=true;btn.textContent="Procesando con IA...";
  const insumosDisponibles=S.insumos.filter(i=>i.activo).map(i=>`${i.id}: ${i.nombre}`).join("\n");
  try {
    const resIA=await api("iaProcesar",{prompt:`Tengo esta lista de insumos disponibles con sus IDs:\n${insumosDisponibles}\n\nConvierte esta receta a JSON, mapeando cada ingrediente al insumoId más cercano de los disponibles. Campos: insumoId, insumoNombre, cantidad (número), unidad (unidad/g/kg/ml/L). Responde SOLO con array JSON sin markdown. Receta:\n${texto}`});
    if(!resIA.ok) throw new Error(resIA.error);
    const txt=resIA.texto||"";
    const clean=txt.replace(/```json|```/g,"").trim();
    const ingredientes=JSON.parse(clean);
    const res=await api("saveReceta",{sabor,tamano,ingredientes});
    if(res.ok){toast(`✅ Receta ${sabor} ${tamano} guardada`);L("bulk-receta-text").value="";const resR=await api("getRecetas");if(resR.ok)S.recetas=resR.recetas;}
    else toast(res.error,"error");
  } catch(e){toast("Error al procesar: "+e.message,"error");}
  btn.disabled=false;btn.textContent="Procesar y guardar receta";
}
const ROL_INFO = {
  "Owner":        { color:"#fff3cd", text:"#856404", desc:"Acceso total al sistema" },
  "Vendedor":     { color:"#d1ecf1", text:"#0c5460", desc:"Solo vende en su sucursal asignada" },
  "Cocinero":     { color:"#f8d7da", text:"#721c24", desc:"Produce y transfiere. NO vende." },
  "Mixto":        { color:"#d4edda", text:"#155724", desc:"Vende en su sucursal + produce + transfiere" },
  "Admin_Ventas": { color:"#fef3c7", text:"#92400e", desc:"Vende en ambas sucursales + transfiere" },
  "Chofer":       { color:"#e0e7ff", text:"#3730a3", desc:"Solo ve y opera sus rutas de reparto" }
};
function onCambioRol() {
  const rol = L("nu-rol").value;
  const info = ROL_INFO[rol] || {};
  const sucSelect = L("nu-sucursal");
  if (rol === "Owner" || rol === "Admin_Ventas" || rol === "Cocinero") {
    sucSelect.value = "Ambas";
  }
  const infoEl = L("nu-rol-info");
  if (infoEl) infoEl.textContent = info.desc || "";
}
async function cargarUsuarios(){
  const res=await api("getUsuarios");if(!res.ok)return;
  S.usuariosLista = res.usuarios;
  L("usuarios-list").innerHTML=res.usuarios.map(u=>{
    const info = ROL_INFO[u.rol] || ROL_INFO["Vendedor"];
    const esYo = u.usuario===S.usuario;
    return `
    <div class="usuario-row">
      <div style="flex:1">
        <div style="font-size:14px;font-weight:500"><span class="rol-chip" style="background:${info.color};color:${info.text}">${u.rol}</span>${u.usuario}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${u.sucursal} · ${u.ultimoAcceso?u.ultimoAcceso.substring(0,10):'Sin acceso aún'}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${!esYo ? `<button class="btn-editar-mini" onclick="abrirEditarUsuario('${u.usuario}')">Editar</button>` : ''}
        ${!esYo ? `<button class="toggle-btn ${u.activo?'activo':''}" onclick="togUsuario('${u.usuario}')">${u.activo?'Activo':'Inactivo'}</button>` : '<span style="font-size:11px;color:var(--muted)">Tú</span>'}
      </div>
    </div>`;
  }).join("");
}
async function togUsuario(usuario){const res=await api("toggleUsuario",{usuario});if(res.ok){toast(res.mensaje);cargarUsuarios();}else toast(res.error,"error");}
L("btn-guardar-usuario").addEventListener("click",async()=>{
  const usuario=L("nu-usuario").value.trim(),password=L("nu-password").value;
  const rol=L("nu-rol").value,sucursal=L("nu-sucursal").value;
  if(!usuario||!password){toast("Completa todos los campos","error");return;}
  const res=await api("crearUsuario",{usuario,password,rol,sucursal});
  if(res.ok){toast(res.mensaje);L("modal-nuevo-usuario").classList.remove("show");cargarUsuarios();}else toast(res.error,"error");
});
L("btn-cambiar-pw").addEventListener("click",async()=>{
  const actual=L("pw-actual").value,nueva=L("pw-nueva").value;
  if(!actual||!nueva){toast("Completa ambos campos","error");return;}
  const res=await api("cambiarPassword",{usuario:S.usuario,passwordActual:actual,passwordNuevo:nueva});
  if(res.ok){toast(res.mensaje);L("pw-actual").value="";L("pw-nueva").value="";}else toast(res.error,"error");
});
function abrirEditarUsuario(usuario){
  const u = (S.usuariosLista||[]).find(x=>x.usuario===usuario);
  if(!u){ toast("Usuario no encontrado","error"); return; }
  L("edu-target").value = u.usuario;
  L("edu-username").value = u.usuario;
  L("edu-password").value = "";
  L("edu-rol").value = u.rol;
  L("edu-sucursal").value = u.sucursal;
  L("edu-activo").checked = !!u.activo;
  const puedeAnular = (u.permisos && u.permisos.puedeAnular) || (u.permisosExtra && u.permisosExtra.puedeAnular) || false;
  L("edu-puede-anular").checked = !!puedeAnular;
  L("modal-editar-usuario").classList.add("show");
}
L("btn-guardar-editar-usuario").addEventListener("click", async () => {
  const target = L("edu-target").value;
  if(!target){ toast("Sin usuario objetivo","error"); return; }
  const campos = {
    rol: L("edu-rol").value,
    sucursal: L("edu-sucursal").value,
    activo: L("edu-activo").checked,
    permisos_extra: { puedeAnular: L("edu-puede-anular").checked }
  };
  const pw = L("edu-password").value;
  if(pw && pw.length >= 4) campos.password = pw;
  const btn = L("btn-guardar-editar-usuario");
  btn.disabled = true; btn.textContent = "Guardando...";
  const res = await api("editarUsuario", { usuario_objetivo: target, campos });
  btn.disabled = false; btn.textContent = "Guardar cambios";
  if(res.ok){
    let msg = "✅ Usuario actualizado.";
    if(res.sesionesCerradas > 0) msg += ` (${res.sesionesCerradas} sesion${res.sesionesCerradas>1?'es':''} cerrada${res.sesionesCerradas>1?'s':''})`;
    toast(msg);
    L("modal-editar-usuario").classList.remove("show");
    cargarUsuarios();
  } else {
    toast(res.error||"Error al guardar","error");
  }
});
async function cargarMovimientos(){
  L("movimientos-list").innerHTML=`<div class="loading"><div class="spinner"></div>Cargando movimientos...</div>`;
  const tipo = L("mov-filtro-tipo").value || "";
  const rango = L("mov-filtro-rango").value || "7d";
  const res = await api("listarMovimientosRecientes", { tipo, rango });
  if(!res.ok){ L("movimientos-list").innerHTML=`<div class="empty-state"><div>Error: ${res.error||"sin datos"}</div></div>`; return; }
  S.movimientos = res.movimientos || [];
  renderMovimientos();
}
function renderMovimientos(){
  const movs = S.movimientos || [];
  if(movs.length === 0){
    L("movimientos-list").innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><div>Sin movimientos en este rango</div></div>`;
    const bar = L("mov-multi-bar"); if(bar) bar.style.display = "none";
    return;
  }
  const puedeAnular = getPermisos().puedeAnular || getPermisos().esAdmin;
  if (!S.movSeleccionados) S.movSeleccionados = new Set();
  const idsValidos = new Set(movs.filter(m => m.estado !== "ANULADO").map(m => `${m.hoja}|${m.id}`));
  S.movSeleccionados = new Set([...S.movSeleccionados].filter(k => idsValidos.has(k)));
  const cabecera = puedeAnular ? `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--warm);border-radius:8px;margin-bottom:8px">
      <input type="checkbox" id="mov-todos" onchange="toggleTodosMov(this.checked)" style="width:16px;height:16px;cursor:pointer">
      <label for="mov-todos" style="font-size:12px;cursor:pointer;flex:1">Seleccionar todos los anulables</label>
      <span id="mov-count" style="font-size:11px;color:var(--muted)"></span>
    </div>` : "";
  L("movimientos-list").innerHTML = cabecera + movs.map(m => {
    const anulado = m.estado === "ANULADO";
    const fechaFmt = m.fecha ? m.fecha.substring(0,16).replace("T"," ") : "";
    const key = `${m.hoja}|${m.id}`;
    const checked = S.movSeleccionados.has(key);
    return `<div class="mov-row${anulado?' anulado':''}" style="grid-template-columns:auto auto 1fr auto auto">
      ${puedeAnular && !anulado ? `<input type="checkbox" data-mov-key="${key}" onchange="toggleMovSel('${key}',this.checked)" ${checked?'checked':''} style="width:16px;height:16px;cursor:pointer">` : '<div></div>'}
      <div class="mov-fecha">${fechaFmt}</div>
      <div>
        <div style="font-size:13px;font-weight:500">${m.detalle||""}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">
          <span class="mov-tipo-chip mov-tipo-${m.hoja}">${m.hoja}</span>
          ${m.usuario?` · ${m.usuario}`:""}
          ${anulado?` · <span style="color:var(--danger);font-weight:600">ANULADO</span>`:""}
        </div>
      </div>
      <div style="font-weight:700;font-size:14px;color:var(--accent);text-align:right">${m.monto_o_cantidad||""}</div>
      <div>
        ${anulado || !puedeAnular ? "—" : `<button class="btn-anular" onclick="abrirAnularMovimiento('${m.hoja}','${m.id}','${(m.detalle||"").replace(/'/g,"\\'").replace(/"/g,"&quot;")}','${m.monto_o_cantidad||""}','${fechaFmt}')">Anular</button>`}
      </div>
    </div>`;
  }).join("");
  actualizarBarraMovMulti();
}
function toggleMovSel(key, checked) {
  if (checked) S.movSeleccionados.add(key);
  else S.movSeleccionados.delete(key);
  actualizarBarraMovMulti();
  const sel = L("mov-todos");
  if (sel) {
    const total = (S.movimientos||[]).filter(m => m.estado !== "ANULADO").length;
    sel.checked = S.movSeleccionados.size === total && total > 0;
  }
}
function toggleTodosMov(checked) {
  if (checked) {
    (S.movimientos||[]).forEach(m => {
      if (m.estado !== "ANULADO") S.movSeleccionados.add(`${m.hoja}|${m.id}`);
    });
  } else {
    S.movSeleccionados.clear();
  }
  renderMovimientos();
}
function actualizarBarraMovMulti() {
  const bar = L("mov-multi-bar");
  if (!bar) return;
  const count = S.movSeleccionados.size;
  if (count === 0) { bar.style.display = "none"; return; }
  bar.style.display = "flex";
  L("mov-multi-count").textContent = count;
  const lbl = L("mov-count");
  if (lbl) lbl.textContent = `${count} seleccionado${count !== 1 ? 's' : ''}`;
}
async function anularSeleccionadosMov() {
  const motivo = L("mov-multi-motivo").value.trim();
  if (!motivo) { toast("El motivo es obligatorio", "error"); return; }
  const keys = [...S.movSeleccionados];
  if (keys.length === 0) return;
  const btn = L("btn-anular-multi");
  btn.disabled = true; btn.textContent = "Anulando...";
  let exitosos = 0, fallidos = 0;
  for (const key of keys) {
    const [hoja, id] = key.split("|");
    try {
      const res = await api("eliminarMovimiento", { hoja, id, motivo });
      if (res.ok) exitosos++; else fallidos++;
    } catch(e) { fallidos++; }
  }
  btn.disabled = false; btn.textContent = "Anular seleccionados";
  toast(`${exitosos} anulado${exitosos!==1?'s':''}${fallidos>0?` · ${fallidos} con error`:''}`, fallidos>0?"error":"success");
  S.movSeleccionados.clear();
  L("mov-multi-motivo").value = "";
  L("modal-anular-multi").classList.remove("show");
  cargarMovimientos();
  cargarStock();
}
function abrirModalAnularMulti() {
  if (S.movSeleccionados.size === 0) { toast("No hay seleccionados", "error"); return; }
  L("modal-anular-multi-count").textContent = S.movSeleccionados.size;
  L("mov-multi-motivo").value = "";
  L("modal-anular-multi").classList.add("show");
}
function abrirAnularMovimiento(hoja, id, detalle, monto, fecha){
  S.anularPendiente = { hoja, id };
  L("anular-detalle").textContent = `${hoja} · ${fecha}\n${detalle}\n${monto}`;
  L("anular-motivo").value = "";
  L("modal-anular-mov").classList.add("show");
}
L("btn-confirmar-anular").addEventListener("click", async () => {
  if(!S.anularPendiente){ toast("Sin movimiento seleccionado","error"); return; }
  const motivo = L("anular-motivo").value.trim();
  if(!motivo){ toast("El motivo es obligatorio","error"); return; }
  const btn = L("btn-confirmar-anular");
  btn.disabled = true; btn.textContent = "Anulando...";
  const res = await api("eliminarMovimiento", {
    hoja: S.anularPendiente.hoja,
    id: S.anularPendiente.id,
    motivo
  });
  btn.disabled = false; btn.textContent = "Confirmar anulación";
  if(res.ok){
    let msg = res.mensaje || "✅ Anulado";
    if(res.stock_revertido) msg += " (stock devuelto)";
    toast(msg);
    L("modal-anular-mov").classList.remove("show");
    S.anularPendiente = null;
    cargarMovimientos();
    cargarStock();
  } else {
    toast(res.error||"Error al anular","error");
  }
});
let bandejaAbierta = false;
async function cargarMensajesHeader(){
  if(!S.token) return;
  const [resMsgs, resAlertas] = await Promise.all([
    api("getMensajes"),
    api("getAlertas")
  ]);
  if(!resMsgs.ok) return;
  S.mensajes = resMsgs.mensajes || [];
  const noLeidos = resMsgs.noLeidos || 0;
  const alertasActivas = resAlertas.ok ? (resAlertas.alertas||[]).length : 0;
  const sugerenciasActivas = resAlertas.ok ? (resAlertas.sugerencias||[]).length : 0;
  const totalBadge = noLeidos + alertasActivas + sugerenciasActivas;
  const badge = L("badge-mensajes");
  if(totalBadge > 0){ badge.style.display = "block"; badge.textContent = totalBadge > 9 ? "9+" : totalBadge; }
  else { badge.style.display = "none"; }
  S.alertasActivas = resAlertas.ok ? resAlertas.alertas||[] : [];
  S.sugerenciasActivas = resAlertas.ok ? resAlertas.sugerencias||[] : [];
  renderBandeja();
  if(S.usuarios){
    L("msg-para").innerHTML = `<option value="todos">Todos</option>` +
      S.usuarios.filter(u=>u.usuario!==S.usuario).map(u=>`<option value="${u.usuario}">${u.usuario} (${u.rol})</option>`).join("");
  }
}
function renderBandeja(){
  const msgs = S.mensajes || [];
  const alertas = S.alertasActivas || [];
  const sugerencias = S.sugerenciasActivas || [];
  const iconos = {alerta_stock:"⚠️", sugerencia:"💡", transferencia:"🔄", manual:"✉️"};
  let html = "";
  if(alertas.length > 0){
    html += `<div style="font-size:10px;font-weight:700;color:var(--danger);letter-spacing:.08em;padding:6px 0 4px;text-transform:uppercase">⚠️ Alertas activas (${alertas.length})</div>`;
    html += alertas.map(a=>`
      <div style="padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;gap:8px">
          <span>${a.urgente?"⛔":"⚠️"}</span>
          <div>
            <div style="font-weight:700;font-size:12px">${a.sabor} ${a.tamano} — ${a.sucursal}</div>
            <div style="font-size:11px;color:var(--muted)">Stock: ${a.stock} · Mín: ${a.minimo}</div>
          </div>
        </div>
      </div>`).join("");
  }
  if(sugerencias.length > 0){
    html += `<div style="font-size:10px;font-weight:700;color:var(--accent);letter-spacing:.08em;padding:8px 0 4px;text-transform:uppercase">💡 Sugerencias (${sugerencias.length})</div>`;
    html += sugerencias.map(s=>`
      <div style="padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:12px;color:var(--ink)">${s.mensaje}</div>
      </div>`).join("");
  }
  if(msgs.length > 0){
    if(alertas.length > 0 || sugerencias.length > 0)
      html += `<div style="font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.08em;padding:8px 0 4px;text-transform:uppercase">Mensajes</div>`;
    html += msgs.map(m=>`
      <div onclick="leerMensaje('${m.id}')" style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;opacity:${m.leido?.7:1}">
        <div style="display:flex;gap:8px;align-items:flex-start">
          <span style="font-size:15px">${iconos[m.tipo]||"✉️"}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:${m.leido?400:700};font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.asunto}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${m.de} · ${m.fecha?m.fecha.substring(0,16).replace("T"," "):""}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.cuerpo}</div>
          </div>
          ${!m.leido?'<div style="width:7px;height:7px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0"></div>':''}
        </div>
      </div>`).join("");
  }
  if(!html){ html = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">Sin mensajes ni alertas</div>`; }
  L("bandeja-lista").innerHTML = html;
}
async function leerMensaje(id){
  const m = (S.mensajes||[]).find(x=>x.id===id);
  if(!m) return;
  if(!m.leido){
    await api("marcarLeidoMensaje",{id});
    m.leido = true;
    cargarMensajesHeader();
  }
  alert(`${m.asunto}\n\nDe: ${m.de}\n${m.fecha?m.fecha.substring(0,16).replace("T"," "):""}\n\n${m.cuerpo}`);
}
function toggleBandeja(){
  bandejaAbierta = !bandejaAbierta;
  L("bandeja-mensajes").style.display = bandejaAbierta ? "block" : "none";
  if(bandejaAbierta) cargarMensajesHeader();
}
function abrirNuevoMensaje(){ L("modal-nuevo-msg").style.display="flex"; }
function cerrarModalMensaje(){ L("modal-nuevo-msg").style.display="none"; L("msg-asunto").value=""; L("msg-cuerpo").value=""; }
async function enviarMensajeUI(){
  const asunto=L("msg-asunto").value.trim(), cuerpo=L("msg-cuerpo").value.trim();
  if(!asunto||!cuerpo){ toast("Escribe asunto y mensaje","error"); return; }
  const res=await api("enviarMensaje",{para:L("msg-para").value,asunto,cuerpo,tipo:"manual"});
  if(res.ok){ toast("✅ Mensaje enviado"); cerrarModalMensaje(); cargarMensajesHeader(); }
  else toast(res.error,"error");
}
async function cargarAlertas(){
  L("alertas-panel").innerHTML=`<div class="loading"><div class="spinner"></div>Calculando alertas...</div>`;
  L("limites-lista").innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  if(!S.catalogo?.sabores){ const resC=await api("getCatalogo"); if(resC.ok) S.catalogo=resC; }
  if(S.catalogo?.sabores){
    L("lim-sabor").innerHTML  =S.catalogo.sabores.filter(s=>s.activo).map(s=>`<option>${s.nombre}</option>`).join("");
    L("lim-tamano").innerHTML =S.catalogo.tamanos.filter(t=>t.activo).map(t=>`<option>${t.nombre}</option>`).join("");
  }
  const [resA,resL]=await Promise.all([api("getAlertas"),api("getStockMinMax")]);
  if(resA.ok){
    const alertas=resA.alertas||[], sug=resA.sugerencias||[];
    if(!alertas.length&&!sug.length){
      L("alertas-panel").innerHTML=`<div class="card" style="text-align:center;padding:20px;color:var(--success)">✅ Todo el stock está dentro de los límites definidos</div>`;
    } else {
      const aHtml=alertas.map(a=>`
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:20px">${a.urgente?"⛔":"⚠️"}</span>
          <div><div style="font-weight:600;font-size:13px">${a.sabor} ${a.tamano} — ${a.sucursal}</div>
          <div style="font-size:12px;color:var(--muted)">Stock: ${a.stock} · Mín: ${a.minimo}${a.maximo?" · Máx: "+a.maximo:""}</div></div>
        </div>`).join("");
      const sHtml=sug.map(s=>`
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:20px">${s.tipo==="transferencia"?"🔄":"📋"}</span>
          <div style="flex:1"><div style="font-weight:600;font-size:13px">${s.tipo==="transferencia"?"Sugerencia: transferencia":"Sugerencia: producción"}</div>
          <div style="font-size:12px;color:var(--muted)">${s.mensaje}</div>
          ${s.tipo==="transferencia"?`<button onclick="aplicarSugerenciaTransferencia('${s.sabor}','${s.tamano}',${s.cantidad})" style="margin-top:6px;font-size:11px;background:var(--accent);color:white;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-family:'DM Sans',sans-serif">Aplicar →</button>`:""}
          </div>
        </div>`).join("");
      L("alertas-panel").innerHTML=`<div class="card">
        ${alertas.length?`<div style="font-weight:700;font-size:13px;margin-bottom:4px;color:var(--danger)">⚠️ ${alertas.length} alerta${alertas.length>1?"s":""}</div>${aHtml}`:""}
        ${sug.length?`<div style="font-weight:700;font-size:13px;margin:12px 0 4px;color:var(--accent)">💡 ${sug.length} sugerencia${sug.length>1?"s":""}</div>${sHtml}`:""}
      </div>`;
    }
  }
  if(resL.ok){ S.limites=resL.limites||[]; renderLimitesList(); }
}
function renderLimitesList(){
  const limites=(S.limites||[]).filter(l=>l.activo);
  if(!limites.length){ L("limites-lista").innerHTML=`<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px">Sin límites definidos</div>`; return; }
  const ag={};
  limites.forEach(l=>{ if(!ag[l.sucursal]) ag[l.sucursal]=[]; ag[l.sucursal].push(l); });
  L("limites-lista").innerHTML=Object.entries(ag).map(([suc,lista])=>`
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;margin-bottom:6px;text-transform:uppercase">${suc}</div>
      ${lista.map(l=>`<div class="insumo-item">
        <div style="flex:1;font-size:13px">${l.sabor} <span style="color:var(--muted)">${l.tamano}</span></div>
        <div style="font-size:12px;color:var(--muted);margin:0 10px">mín <strong style="color:var(--ink)">${l.minimo}</strong> · máx <strong style="color:var(--ink)">${l.maximo||"—"}</strong></div>
      </div>`).join("")}
    </div>`).join("");
}
async function guardarLimite(){
  const sucursal=L("lim-sucursal").value, sabor=L("lim-sabor").value, tamano=L("lim-tamano").value;
  const minimo=parseInt(L("lim-min").value)||0, maximo=parseInt(L("lim-max").value)||0;
  if(!sabor||!tamano||!minimo){ toast("Completa todos los campos obligatorios","error"); return; }
  if(maximo>0&&maximo<minimo){ toast("El máximo debe ser mayor que el mínimo","error"); return; }
  const res=await api("saveStockMinMax",{sucursal,sabor,tamano,minimo,maximo});
  if(res.ok){ toast(res.mensaje); L("lim-min").value=""; L("lim-max").value=""; cargarAlertas(); }
  else toast(res.error,"error");
}
function aplicarSugerenciaTransferencia(sabor,tamano,cantidad){
  irAPane("transferencias");
  setTimeout(()=>{ L("trf-sabor").value=sabor; L("trf-tamano").value=tamano; L("trf-cantidad").value=cantidad; },400);
}
function onCambioSaborTrf(){
  const stock = S.stock || [];
  const sabor = L("trf-sabor").value;
  const enCuaji = stock.filter(s => s.sucursal === "Cuajimalpa" && !s.vencido && s.cantActual > 0 && s.sabor === sabor);
  const tamanosValidos = [...new Set(enCuaji.map(s => s.tamano))];
  const selTamano = L("trf-tamano");
  const tamActual = selTamano.value;
  selTamano.innerHTML = tamanosValidos.map(t => `<option>${t}</option>`).join("");
  if(tamanosValidos.includes(tamActual)) selTamano.value = tamActual;
  actualizarStockTrf();
}
function actualizarStockTrf(){
  const sabor  = L("trf-sabor")?.value;
  const tamano = L("trf-tamano")?.value;
  const selCant = L("trf-cantidad");
  if(!sabor||!tamano){
    if(selCant){selCant.innerHTML='<option value="">— elige sabor y tamaño —</option>';selCant.disabled=true;}
    L("trf-stock-preview").style.display="none"; return;
  }
  const stock  = S.stock||[];
  const cuaji  = stock.filter(s=>s.sabor===sabor&&s.tamano===tamano&&s.sucursal==="Cuajimalpa"&&!s.vencido).reduce((s,i)=>s+i.cantActual,0);
  const polanco= stock.filter(s=>s.sabor===sabor&&s.tamano===tamano&&s.sucursal==="Polanco"&&!s.vencido).reduce((s,i)=>s+i.cantActual,0);
  L("trf-stock-cuaji").textContent   = cuaji;
  L("trf-stock-polanco").textContent = polanco;
  L("trf-stock-cuaji").style.color   = cuaji===0?"var(--danger)":cuaji<=3?"var(--warning)":"var(--ink)";
  L("trf-stock-preview").style.display = "block";
  if(selCant){
    if(cuaji > 0){
      selCant.innerHTML = Array.from({length:cuaji},(_,i)=>i+1).map(n=>`<option value="${n}">${n}</option>`).join("");
      selCant.disabled = false;
    } else {
      selCant.innerHTML = '<option value="">Sin stock en Cuajimalpa</option>';
      selCant.disabled = true;
    }
  }
}
async function cargarTransferencias(){
  if(!S.catalogo?.sabores){ const resC=await api("getCatalogo"); if(resC.ok) S.catalogo=resC; }
  const resStock = await api("getStock");
  if(resStock.ok) S.stock = resStock.stock;
  if(S.catalogo?.sabores){ poblarSelectoresTransferencia(); actualizarStockTrf(); }
  L("trf-lista").innerHTML=`<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  const res=await api("getTransferencias");
  if(!res.ok){ L("trf-lista").innerHTML=`<div class="empty-state">Error al cargar</div>`; return; }
  S.transferencias=res.transferencias||[];
  renderTransferenciasList();
}
function poblarSelectoresTransferencia(){
  const stock = S.stock || [];
  const enCuaji = stock.filter(s => s.sucursal === "Cuajimalpa" && !s.vencido && s.cantActual > 0);
  const saboresValidos = [...new Set(enCuaji.map(s => s.sabor))];
  const tamanosValidos = [...new Set(enCuaji.map(s => s.tamano))];
  const selSabor = L("trf-sabor");
  const selTamano = L("trf-tamano");
  if(saboresValidos.length === 0){
    selSabor.innerHTML = '<option value="">— Sin stock en Cuajimalpa —</option>';
    selTamano.innerHTML = '<option value="">—</option>';
    selSabor.disabled = true; selTamano.disabled = true;
    return;
  }
  selSabor.disabled = false; selTamano.disabled = false;
  const sabActual = selSabor.value;
  const tamActual = selTamano.value;
  selSabor.innerHTML = saboresValidos.map(s => `<option>${s}</option>`).join("");
  if(saboresValidos.includes(sabActual)) selSabor.value = sabActual;
  const sabSel = selSabor.value;
  const tamanosParaSabor = [...new Set(enCuaji.filter(s => s.sabor === sabSel).map(s => s.tamano))];
  selTamano.innerHTML = tamanosParaSabor.map(t => `<option>${t}</option>`).join("");
  if(tamanosParaSabor.includes(tamActual)) selTamano.value = tamActual;
}
function renderTransferenciasList(){
  const lista=S.transferencias||[];
  if(!lista.length){ L("trf-lista").innerHTML=`<div class="empty-state"><div class="empty-icon">🔄</div><div>Sin transferencias registradas</div></div>`; return; }
  L("trf-lista").innerHTML=lista.map(t=>`
    <div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div>
          <span style="font-weight:700">${t.cantidad}× ${t.sabor} ${t.tamano}</span>
          <span style="margin-left:8px;font-size:11px;font-weight:600;color:var(--success)">✅ MOVIDO A POLANCO</span>
        </div>
      </div>
      <div style="font-size:12px;color:var(--muted)">${t.fechaSolicitud?t.fechaSolicitud.substring(0,16).replace("T"," "):""}${t.solicitadoPor?" · por "+t.solicitadoPor:""}${t.notas?" · "+t.notas:""}</div>
    </div>`).join("");
}
async function solicitarTransferencia(){
  const sabor=L("trf-sabor").value, tamano=L("trf-tamano").value;
  const cantidad=parseInt(L("trf-cantidad")?.value)||0, notas=L("trf-notas")?.value.trim()||"";
  if(!sabor||!tamano||cantidad<=0){ toast("Completa sabor, tamaño y cantidad","error"); return; }
  const btn=L("btn-trf"); btn.disabled=true; btn.textContent="Registrando...";
  const res=await api("registrarTransferencia",{sabor,tamano,cantidad,notas,opId:opIdNuevo()});
  btn.disabled=false; btn.textContent="REGISTRAR TRANSFERENCIA";
  if(res.ok){ toast(res.mensaje); L("trf-cantidad").value=""; L("trf-notas").value=""; await cargarStock(); cargarTransferencias(); cargarMensajesHeader(); }
  else toast(res.error,"error");
}
async function confirmarTrf(id){
  if(!confirm("¿Confirmar recepción en Polanco? Esto moverá el stock.")) return;
  const res=await api("confirmarTransferencia",{id});
  if(res.ok){ toast(res.mensaje); cargarTransferencias(); cargarMensajesHeader(); }
  else toast(res.error,"error");
}
async function cargarAuditoria(){
  const res=await api("getAuditoria");if(!res.ok)return;
  L("auditoria-list").innerHTML=res.registros.length===0?`<div class="empty-state"><div>Sin registros</div></div>`
    :res.registros.map(r=>`<div class="audit-row"><div class="audit-accion">${r.accion}</div><div class="audit-detalle">${r.detalles}</div><div class="audit-meta">${r.usuario} · ${r.fecha?r.fecha.substring(0,16).replace('T',' '):''}</div></div>`).join("");
}
async function ejecutarLimpiarDatos(){
  if(!confirm("⚠️ ¿Seguro que quieres borrar todos los datos de prueba?\n\nEsto eliminará:\n• Ventas\n• Stock / Inventario\n• Clientes\n• Auditoría\n• Utilidades\n• Transferencias\n\nNO se borrarán: catálogo, precios, insumos, recetas ni usuarios.")) return;
  if(!confirm("Segunda confirmación: ¿ESTÁS SEGURO? Esta acción no se puede deshacer.")) return;
  const btn = event.target; btn.disabled=true; btn.textContent="Limpiando...";
  const res = await api("limpiarDatos",{});
  btn.disabled=false; btn.textContent="🗑 Limpiar datos de prueba";
  if(res.ok){ toast(res.mensaje); cargarAuditoria(); cargarStock(); }
  else toast(res.error,"error");
}
async function cargarGastos(){
  L("gastos-list").innerHTML=`<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  const res = await api("getGastos");
  if(!res.ok){ L("gastos-list").innerHTML=`<div class="empty-state">Error al cargar gastos</div>`; return; }
  S.gastos = res.gastos || [];
  renderGastosList();
}
function montoMensual(g) {
  if (!g || !g.activo) return 0;
  if (g.montoMensual !== undefined) return g.montoMensual;
  if (g.frecuencia === "Semanal") return g.monto * 4.2;
  if (g.frecuencia === "Mensual") return g.monto;
  return 0;
}
function renderGastosList(){
  const gastos = (S.gastos||[]).filter(g=>g.activo);
  if(gastos.length === 0){
    L("gastos-list").innerHTML=`<div class="empty-state"><div class="empty-icon">💸</div><div>Sin gastos registrados — agrega renta, comisiones, merma, etc.</div></div>`;
    return;
  }
  const esMesEsp = g => /^\d{4}-\d{2}$/.test(g.vigencia||"Siempre");
  const fijos     = gastos.filter(g=>g.tipo==="Fijo");
  const semifijos = gastos.filter(g=>g.tipo==="Semifijo");
  const variables = gastos.filter(g=>g.tipo==="Variable");
  function etiquetaFrecuencia(g){
    if(g.frecuencia==="% sobre venta") return `${g.monto}%`;
    if(g.frecuencia==="Condicional") return `${fmtMXN(g.monto)} si se cumple`;
    if(g.frecuencia==="Por unidad") return `${fmtMXN(g.monto)}/pieza`;
    const mens = montoMensual(g);
    const sufijo = g.frecuencia==="Semanal" ? ` <span style="font-size:11px;color:var(--muted);font-weight:400">${fmtMXN(g.monto)}/sem × 4.2</span>` : "";
    return `<span style="color:var(--accent);font-weight:700">${fmtMXN(mens)}/mes</span>${sufijo}`;
  }
  function vigenciaTag(g){
    return esMesEsp(g)
      ? `<span class="tag" style="background:rgba(200,96,42,.15);color:var(--accent);font-weight:700">📌 Solo ${g.vigencia}</span>`
      : `<span class="tag" style="background:var(--warm);color:var(--muted)">Recurrente</span>`;
  }
  function renderGrupo(lista, titulo){
    if(!lista.length) return "";
    return `<div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;margin:12px 0 6px;text-transform:uppercase">${titulo}</div>
      ${lista.map(g=>`
        <div class="insumo-item">
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px">${g.concepto}</div>
            <div style="font-size:12px;color:var(--muted)">${g.frecuencia} · ${g.sucursal}${g.descripcion?' · '+g.descripcion:''}</div>
            <div style="margin-top:3px">${vigenciaTag(g)}</div>
            ${g.frecuencia==="Condicional"&&g.condicion?`<div style="font-size:11px;color:var(--accent);margin-top:2px">📋 ${g.condicion}${g.aplicaA?' → '+g.aplicaA:''}</div>`:''}
          </div>
          <div style="font-weight:700;font-size:15px;color:var(--accent);margin:0 12px">${etiquetaFrecuencia(g)}</div>
          <div style="display:flex;gap:6px">
            <button class="btn-icon" onclick="editarGasto('${g.id}')">✏️</button>
            <button class="btn-icon" onclick="bajaGasto('${g.id}')">✕</button>
          </div>
        </div>`).join("")}`;
  }
  // Resumen mensual = solo gastos recurrentes (los de un mes específico no son base mensual)
  const recurrentes = gastos.filter(g=>!esMesEsp(g));
  const extraord    = gastos.filter(esMesEsp);
  const totalMensual = recurrentes.reduce((s,g) => s + montoMensual(g), 0);
  const totalCuaji = recurrentes.filter(g=>g.sucursal==="Cuajimalpa"||g.sucursal==="Ambas")
    .reduce((s,g) => s + (g.sucursal==="Ambas" ? montoMensual(g)*0.5 : montoMensual(g)), 0);
  const totalPolanco = recurrentes.filter(g=>g.sucursal==="Polanco"||g.sucursal==="Ambas")
    .reduce((s,g) => s + (g.sucursal==="Ambas" ? montoMensual(g)*0.5 : montoMensual(g)), 0);
  const extraTxt = extraord.length ? `<div style="font-size:11px;color:var(--muted);margin-top:8px">+ ${extraord.length} gasto(s) extraordinario(s) de un mes específico (se suman solo en su mes dentro del Estado de resultados).</div>` : "";
  const resumenHTML = `
    <div style="margin-top:16px;padding:14px 16px;background:var(--card);border-radius:12px;border:1px solid var(--border)">
      <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;margin-bottom:10px;text-transform:uppercase">Resumen mensual recurrente</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px;text-align:center;padding:10px;background:var(--bg);border-radius:8px">
          <div style="font-size:18px;font-weight:700;color:var(--accent)">${fmtMXN(totalCuaji)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Cuajimalpa</div>
        </div>
        <div style="flex:1;min-width:140px;text-align:center;padding:10px;background:var(--bg);border-radius:8px">
          <div style="font-size:18px;font-weight:700;color:var(--accent)">${fmtMXN(totalPolanco)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Polanco</div>
        </div>
        <div style="flex:1;min-width:140px;text-align:center;padding:10px;background:var(--ink);border-radius:8px">
          <div style="font-size:18px;font-weight:700;color:#fff">${fmtMXN(totalMensual)}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px">Total empresa</div>
        </div>
      </div>
      ${extraTxt}
    </div>`;
  L("gastos-list").innerHTML = renderGrupo(fijos,"Gastos fijos") + renderGrupo(semifijos,"Gastos semifijos") + renderGrupo(variables,"Gastos variables") + resumenHTML;
}
function toggleGastoCondicional(){
  const esCondicional = L("g-frecuencia").value === "Condicional";
  const fields = L("gasto-condicional-fields");
  fields.style.display = esCondicional ? "block" : "none";
  L("g-monto-label").textContent = esCondicional ? "Monto del bono/comisión ($)" : "Monto ($) *";
}
function toggleGastoVigencia(){
  const esMes = L("g-vigencia") && L("g-vigencia").value === "mes";
  const w = L("g-vigencia-mes-wrap");
  if(w) w.style.display = esMes ? "block" : "none";
}
function editarGasto(id){
  const g = (S.gastos||[]).find(x=>x.id===id);
  if(!g) return;
  L("gasto-id").value         = g.id;
  L("g-concepto").value       = g.concepto;
  L("g-tipo").value           = g.tipo;
  L("g-frecuencia").value     = g.frecuencia;
  L("g-monto").value          = g.monto;
  L("g-sucursal").value       = g.sucursal;
  L("g-descripcion").value    = g.descripcion||"";
  L("g-condicion").value      = g.condicion||"";
  L("g-aplica-a").value       = g.aplicaA||"";
  if(g.vigencia && /^\d{4}-\d{2}$/.test(g.vigencia)){ L("g-vigencia").value="mes"; L("g-vigencia-mes").value=g.vigencia; }
  else { L("g-vigencia").value="Siempre"; L("g-vigencia-mes").value=""; }
  toggleGastoCondicional();
  toggleGastoVigencia();
  L("gasto-form-title").textContent = "Editar gasto";
  L("btn-cancelar-gasto").style.display = "inline-block";
  L("g-concepto").focus();
}
function cancelarEditarGasto(){
  ["gasto-id","g-concepto","g-descripcion","g-monto","g-condicion","g-aplica-a"].forEach(id=>L(id).value="");
  L("g-tipo").value="Fijo"; L("g-frecuencia").value="Mensual"; L("g-sucursal").value="Ambas";
  L("g-vigencia").value="Siempre"; L("g-vigencia-mes").value=""; toggleGastoVigencia();
  L("gasto-condicional-fields").style.display="none";
  L("gasto-form-title").textContent="Nuevo gasto";
  L("btn-cancelar-gasto").style.display="none";
}
async function guardarGasto(){
  const concepto = L("g-concepto").value.trim();
  if(!concepto){ toast("El concepto es obligatorio","error"); return; }
  const monto = parseFloat(L("g-monto").value);
  if(!monto||monto<=0){ toast("Ingresa un monto válido","error"); return; }
  const vigSel = L("g-vigencia").value;
  let vigencia = "Siempre";
  if(vigSel==="mes"){
    vigencia = L("g-vigencia-mes").value||"";
    if(!/^\d{4}-\d{2}$/.test(vigencia)){ toast("Elige el mes del gasto único","error"); return; }
  }
  const btn = L("btn-guardar-gasto"); btn.disabled=true; btn.textContent="Guardando...";
  const payload = {
    id:          L("gasto-id").value||undefined,
    concepto,
    descripcion: L("g-descripcion").value.trim(),
    tipo:        L("g-tipo").value,
    frecuencia:  L("g-frecuencia").value,
    monto,
    sucursal:    L("g-sucursal").value,
    condicion:   L("g-condicion").value.trim(),
    aplicaA:     L("g-aplica-a").value.trim(),
    vigencia,
    activo:      true
  };
  const res = await api("saveGasto", payload);
  btn.disabled=false; btn.textContent="GUARDAR GASTO";
  if(res.ok){ toast(res.mensaje); cancelarEditarGasto(); cargarGastos(); }
  else toast(res.error,"error");
}
async function bajaGasto(id){
  const g = (S.gastos||[]).find(x=>x.id===id);
  if(!g||!confirm(`¿Dar de baja "${g.concepto}"?`)) return;
  const res = await api("deleteGasto",{id});
  if(res.ok){ toast(res.mensaje); cargarGastos(); }
  else toast(res.error,"error");
}
async function cargarZonasEnvio(){
  const res = await api("getZonasEnvio");
  if(res.ok) S.zonasEnvio = res.zonas || [];
  renderZonasList();
  const sel = L("venta-zona");
  if(sel){
    const activas = (S.zonasEnvio||[]).filter(z=>z.activo);
    sel.innerHTML = `<option value="">— Sin costo de envío —</option>` +
      activas.map(z=>`<option value="${z.id}" data-costo="${z.costo}">${z.nombre} — $${z.costo.toLocaleString('es-MX')}</option>`).join("");
  }
}
function renderZonasList(){
  const zonas = (S.zonasEnvio||[]).filter(z=>z.activo);
  if(!zonas.length){
    L("zonas-lista").innerHTML=`<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px">Sin zonas definidas — agrega la primera abajo</div>`;
    return;
  }
  L("zonas-lista").innerHTML = zonas.map(z=>`
    <div class="insumo-item">
      <div style="flex:1">
        <div style="font-weight:600;font-size:13px">${z.nombre}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${z.colonias.slice(0,5).join(", ")}${z.colonias.length>5?" ...":""}</div>
      </div>
      <div style="font-weight:700;color:var(--accent);margin:0 12px">$${z.costo.toLocaleString('es-MX')}</div>
      <button class="btn-icon" onclick="eliminarZona('${z.id}')">✕</button>
    </div>`).join("");
}
async function guardarZonaEnvio(){
  const nombre  = L("zona-nombre").value.trim();
  const costo   = parseInt(L("zona-costo").value)||0;
  const colonias= L("zona-colonias").value.trim();
  if(!nombre||!costo){ toast("Completa nombre y costo","error"); return; }
  if(!colonias){ toast("Agrega al menos una colonia o CP","error"); return; }
  const res = await api("saveZonaEnvio",{nombre,costo,colonias});
  if(res.ok){
    toast(res.mensaje);
    L("zona-nombre").value=""; L("zona-costo").value=""; L("zona-colonias").value="";
    await cargarZonasEnvio();
  } else toast(res.error,"error");
}
async function eliminarZona(id){
  if(!confirm("¿Eliminar esta zona?")) return;
  const res = await api("deleteZonaEnvio",{id});
  if(res.ok){ toast(res.mensaje); cargarZonasEnvio(); }
  else toast(res.error,"error");
}
function onZonaChange(){
  const sel = L("venta-zona");
  const opt = sel?.options[sel.selectedIndex];
  const costo = parseInt(opt?.dataset?.costo||"0")||0;
  S.costoEnvio = costo;
  const aviso = L("envio-costo-aviso");
  if(costo > 0){
    aviso.style.display = "block";
    aviso.textContent = `🚗 Costo de envío: $${costo.toLocaleString('es-MX')} — se sumará al total`;
  } else { aviso.style.display = "none"; }
  renderCarrito();
}
async function cargarCanalPrecios(){
  const [resCP, resCat] = await Promise.all([api("getCanalPrecios"), S.catalogo?Promise.resolve({ok:false}):api("getCatalogo")]);
  if(resCP.ok) S.canalPrecios = resCP.reglas || [];
  if(resCat.ok) S.catalogo = resCat;
  const canales = (S.catalogo?.canales||[]).filter(c=>c.activo).map(c=>c.nombre);
  L("cp-canal").innerHTML = canales.map(c=>`<option>${c}</option>`).join("");
  renderCanalPreciosList();
}
function actualizarLabelCP(){
  const tipo = L("cp-tipo").value;
  L("cp-valor-label").textContent = tipo==="pct" ? "Valor % (+ sube, - baja)" : "Valor $ por pieza (+ sube, - baja)";
  actualizarPreviewCP();
}
function actualizarPreviewCP(){
  const canal = L("cp-canal").value;
  const tipo  = L("cp-tipo").value;
  const valor = parseFloat(L("cp-valor").value)||0;
  if(!canal||!valor){ L("cp-preview").textContent=""; return; }
  const ejemplo = 210;
  const nuevo = tipo==="pct" ? ejemplo*(1+valor/100) : ejemplo+valor;
  L("cp-preview").textContent = `Ejemplo: tarta Chico $${ejemplo} → $${Math.round(nuevo)} en ${canal}`;
}
L("cp-valor")?.addEventListener("input", actualizarPreviewCP);
L("cp-canal")?.addEventListener("change", actualizarPreviewCP);
function renderCanalPreciosList(){
  const reglas = (S.canalPrecios||[]).filter(r=>r.activo);
  if(!reglas.length){
    L("canal-precios-lista").innerHTML=`<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px">Sin reglas definidas</div>`;
    return;
  }
  L("canal-precios-lista").innerHTML = reglas.map(r=>`
    <div class="insumo-item">
      <div style="flex:1;font-size:13px"><strong>${r.canal}</strong></div>
      <div style="margin:0 12px;font-size:13px;color:${r.valor>=0?"var(--success)":"var(--danger)"}">
        ${r.valor>=0?"+":""}${r.valor}${r.tipo==="pct"?"%":"$"} por pieza
      </div>
      <button class="btn-icon" onclick="eliminarCanalPrecio('${r.id}')">✕</button>
    </div>`).join("");
}
async function guardarCanalPrecio(){
  const canal = L("cp-canal").value;
  const tipo  = L("cp-tipo").value;
  const valor = parseFloat(L("cp-valor").value);
  if(!canal||isNaN(valor)){ toast("Completa canal y valor","error"); return; }
  const res = await api("saveCanalPrecio",{canal,tipo,valor});
  if(res.ok){ toast(res.mensaje); L("cp-valor").value=""; cargarCanalPrecios(); }
  else toast(res.error,"error");
}
async function eliminarCanalPrecio(id){
  const res = await api("deleteCanalPrecio",{id});
  if(res.ok){ toast("✅ Regla eliminada"); cargarCanalPrecios(); }
  else toast(res.error,"error");
}
function onCanalChange(){
  const canal = L("venta-canal")?.value;
  const esPlat = esPlataforma(canal);
  const metodoGroup = L("venta-metodo")?.parentElement;
  if(metodoGroup) metodoGroup.style.display = esPlat ? "none" : "block";
  // v3.4.18-fix: preservar el metodo de pago seleccionado al reconstruir la lista
  // (bug: a algunos usuarios se les cambiaba la forma de pago sola al cambiar de canal)
  const _selMet = L("venta-metodo");
  const _metAnt = _selMet ? _selMet.value : "";
  llenar("venta-metodo", esPlat ? [canal] : ["Efectivo","Tarjeta","Transferencia"]);
  if(_selMet && _metAnt){
    const _opts = Array.from(_selMet.options).map(o=>o.value);
    if(_opts.includes(_metAnt)) _selMet.value = _metAnt;
  }
  const cli = L("cliente-section");
  if(cli) cli.style.display = esPlat ? "none" : "block";
  L("canal-aviso").style.display = esPlat ? "flex" : "none";
  const esDomicilio = canal === "Domicilio";
  L("envio-section").style.display = esDomicilio ? "block" : "none";
  if(!esDomicilio){ S.costoEnvio = 0; if(L("envio-costo-aviso")) L("envio-costo-aviso").style.display="none"; }
  const aviso = L("canal-precio-aviso");
  if(canal==="Rappi"){
    aviso.style.display="block";
    aviso.textContent=`💡 Precios Rappi por tamaño: Individual $${RAPPI_PRECIOS.Individual} · Mediana $${RAPPI_PRECIOS.Mediana} · Grande $${RAPPI_PRECIOS.Grande}`;
  } else {
    const regla = (S.canalPrecios||[]).find(r=>r.canal===canal&&r.activo);
    if(regla){ aviso.style.display="block"; aviso.textContent=`💡 Regla para ${canal}: ${regla.valor>=0?"+":""}${regla.valor}${regla.tipo==="pct"?"%":"$"} por pieza`; }
    else aviso.style.display="none";
  }
  actualizarPrecioPreview();
  renderCarrito();
}
async function renderTablaUtilidades(){
  L("tabla-util-content").innerHTML=`<div class="loading"><div class="spinner"></div>Calculando...</div>`;
  const [resR, resI, resP] = await Promise.all([api("getRecetas"), api("getInsumos"), api("getPrecios")]);
  if(!resR.ok || !resI.ok || !resP.ok){
    L("tabla-util-content").innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><div>Error al cargar datos</div></div>`;
    return;
  }
  const recetas = resR.recetas || [];
  const insumos = resI.insumos || [];
  const precios = resP.precios || [];
  S.recetas = recetas; S.insumos = insumos; S.precios = precios;
  if(recetas.length === 0){
    L("tabla-util-content").innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><div>Sin recetas cargadas — ve a la pestaña Recetas para agregar ingredientes</div></div>`;
    return;
  }
  const insumosIdx = {};
  insumos.forEach(i => insumosIdx[i.id] = i);
  function getPrecio(sabor, tamano){
    const especifico = precios.find(p => p.sabor === sabor && p.tamano === tamano);
    if(especifico && especifico.precio > 0) return especifico.precio;
    const porTamano = precios.find(p => p.tamano === tamano && p.precio > 0);
    return porTamano ? porTamano.precio : 0;
  }
  const filas = recetas
    .filter(r => r.ingredientes && r.ingredientes.length > 0)
    .map(r => {
      const costo = r.ingredientes.reduce((sum, ing) => {
        const ins = insumosIdx[ing.insumoId];
        const cantConvU = ins ? convertirUnidad(ing.cantidad, ing.unidad||ins.buyUnit, ins.buyUnit) : ing.cantidad;
        return sum + (ins ? ins.costoPorUnidad * cantConvU : 0);
      }, 0);
      const precio = getPrecio(r.sabor, r.tamano);
      const utilidad = precio > 0 ? precio - costo : null;
      const margen   = precio > 0 ? (utilidad / precio * 100) : null;
      return { sabor: r.sabor, tamano: r.tamano, costo, precio, utilidad, margen };
    });
  if(filas.length === 0){
    L("tabla-util-content").innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><div>Sin recetas con ingredientes cargados</div></div>`;
    return;
  }
  const header = `<div class="util-row header"><span>Producto</span><span style="text-align:right">Costo</span><span style="text-align:right">Precio</span><span style="text-align:right">Utilidad</span><span style="text-align:right">Margen</span></div>`;
  const rows = filas.map(f => {
    const mCls = f.margen === null ? '' : f.margen >= 50 ? 'margen-alto' : f.margen >= 30 ? 'margen-med' : 'margen-bajo';
    const uCls = f.utilidad === null ? '' : f.utilidad >= 0 ? 'util-verde' : 'util-rojo';
    return `<div class="util-row">
        <div><div class="util-nombre">${f.sabor}</div><div style="font-size:11px;color:var(--muted)">${f.tamano}</div></div>
        <div class="util-val">${fmtMXN(f.costo)}</div>
        <div class="util-val">${f.precio > 0 ? fmtMXN(f.precio) : '<span style="color:var(--danger);font-size:11px">Sin precio</span>'}</div>
        <div class="util-val ${uCls}">${f.utilidad !== null ? fmtMXN(f.utilidad) : '—'}</div>
        <div style="text-align:right">
          ${f.margen !== null ? `<span class="util-margen ${mCls}">${f.margen.toFixed(1)}%</span>` : '<span style="color:var(--muted);font-size:11px">—</span>'}
        </div>
      </div>`;
  }).join('');
  L("tabla-util-content").innerHTML = header + rows;
}
let utilState = { ventas: [], recetas: [], insumos: [], listo: false };
async function cargarUtilidades(){
  L("util-ops-list").innerHTML=`<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  L("util-resumen-periodo").style.display="none";
  const hoy = new Date();
  const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  L("f-desde").value = _fmtDateInput(primerDia);
  L("f-hasta").value  = _fmtDateInput(hoy);
  const [resV, resR, resI] = await Promise.all([api("getVentas"), api("getRecetas"), api("getInsumos")]);
  if(!resV.ok){ L("util-ops-list").innerHTML=`<div class="empty-state"><div>Error al cargar ventas</div></div>`; return; }
  utilState.ventas  = resV.ventas  || [];
  utilState.recetas = resR.ok ? resR.recetas : (S.recetas || []);
  utilState.insumos = resI.ok ? resI.insumos : (S.insumos || []);
  utilState.listo   = true;
  if(resR.ok) S.recetas = utilState.recetas;
  if(resI.ok) S.insumos = utilState.insumos;
  _poblarFiltrosUtil();
  renderUtilidades();
}
function _fmtDateInput(d){ return d.toISOString().substring(0,10); }
function _poblarFiltrosUtil(){
  const ventas = utilState.ventas;
  const sucursales = [...new Set(ventas.map(v=>v.sucursal).filter(Boolean))];
  const canales    = [...new Set(ventas.map(v=>v.canal).filter(Boolean))];
  const sabores    = [...new Set(ventas.map(v=>v.sabor).filter(Boolean))];
  const tamanos    = [...new Set(ventas.map(v=>v.tamano).filter(Boolean))];
  _llenarSelect("f-sucursal", sucursales);
  _llenarSelect("f-canal",    canales);
  _llenarSelect("f-sabor",    sabores);
  _llenarSelect("f-tamano",   tamanos);
}
function _llenarSelect(id, opciones){
  const sel = L(id);
  if(!sel) return;
  const actual = sel.value;
  sel.innerHTML = `<option value="">Todos</option>` + opciones.map(o=>`<option value="${o}">${o}</option>`).join("");
  if(actual) sel.value = actual;
}
function aplicarFiltrosUtil(){ renderUtilidades(); }
function limpiarFiltrosUtil(){
  const hoy = new Date();
  const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  L("f-desde").value   = _fmtDateInput(primerDia);
  L("f-hasta").value   = _fmtDateInput(hoy);
  L("f-sucursal").value = ""; L("f-canal").value = ""; L("f-metodo").value = "";
  L("f-sabor").value = ""; L("f-tamano").value = "";
  renderUtilidades();
}
function renderUtilidades(){
  if(!utilState.listo){ L("util-ops-list").innerHTML=`<div class="loading"><div class="spinner"></div></div>`; return; }
  const desde   = L("f-desde").value;
  const hasta   = L("f-hasta").value;
  const fSuc    = L("f-sucursal").value;
  const fCanal  = L("f-canal").value;
  const fMetodo = L("f-metodo").value;
  const fSabor  = L("f-sabor").value;
  const fTamano = L("f-tamano").value;
  const desdeD = desde ? new Date(desde+"T00:00:00") : null;
  const hastaD = hasta ? new Date(hasta+"T23:59:59") : null;
  const insumosIdx = {};
  utilState.insumos.forEach(i => insumosIdx[i.id] = i);
  function getCostoReceta(sabor, tamano){
    const rec = utilState.recetas.find(r => r.sabor === sabor && r.tamano === tamano);
    if(!rec || !rec.ingredientes.length) return null;
    return rec.ingredientes.reduce((s, ing) => {
      const ins = insumosIdx[ing.insumoId];
      const cantConv = ins ? convertirUnidad(ing.cantidad, ing.unidad||ins.buyUnit, ins.buyUnit) : ing.cantidad;
      return s + (ins ? ins.costoPorUnidad * cantConv : 0);
    }, 0);
  }
  let ventasFiltradas = utilState.ventas.filter(v => {
    if(desdeD && v.fecha && new Date(v.fecha) < desdeD) return false;
    if(hastaD && v.fecha && new Date(v.fecha) > hastaD) return false;
    if(fSuc    && v.sucursal   !== fSuc)    return false;
    if(fCanal  && v.canal      !== fCanal)  return false;
    if(fMetodo && v.metodoPago !== fMetodo) return false;
    if(fSabor  && v.sabor      !== fSabor)  return false;
    if(fTamano && v.tamano     !== fTamano) return false;
    return true;
  });
  const grupos = {};
  ventasFiltradas.forEach(v => {
    if(!grupos[v.idVenta]) grupos[v.idVenta] = { ...v, items: [] };
    grupos[v.idVenta].items.push({ sabor: v.sabor, tamano: v.tamano, cantidad: v.cantidad, subtotal: v.subtotal, precio: v.precio });
  });
  if(Object.keys(grupos).length === 0){
    L("util-resumen-periodo").style.display = "none";
    L("util-ops-list").innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><div>Sin ventas en el período seleccionado</div></div>`;
    return;
  }
  let totalIngresos = 0, totalCostos = 0, totalUtilidad = 0, sinReceta = 0;
  const ops = Object.values(grupos).map(g => {
    const ingresoBase = g.items.reduce((s,i) => s + i.subtotal, 0);
    const comPct = getComision(g.canal||"", g.metodoPago||"");
    const comMonto = Math.round(ingresoBase * comPct);
    const ingreso = ingresoBase + comMonto;
    let costo = 0; let calculable = true;
    g.items.forEach(i => {
      const c = getCostoReceta(i.sabor, i.tamano);
      if(c === null) calculable = false;
      else costo += c * i.cantidad;
    });
    const utilidad = calculable ? ingreso - costo : null;
    const margen   = calculable && ingreso > 0 ? (utilidad / ingreso * 100) : null;
    if(calculable){ totalIngresos += ingreso; totalCostos += costo; totalUtilidad += utilidad; }
    else { totalIngresos += ingreso; sinReceta++; }
    return { ...g, ingresoBase, ingreso, comMonto, costo: calculable ? costo : null, utilidad, margen, calculable };
  });
  const totalMargen = totalIngresos > 0 ? (totalUtilidad / totalIngresos * 100) : 0;
  L("util-resumen-periodo").style.display = "block";
  L("up-ingresos").textContent  = fmtMXN(totalIngresos);
  L("up-costos").textContent    = fmtMXN(totalCostos);
  L("up-utilidad").textContent  = fmtMXN(totalUtilidad);
  L("up-utilidad").style.color  = totalUtilidad >= 0 ? "var(--success)" : "var(--danger)";
  L("up-margen").textContent    = totalMargen.toFixed(1) + "%";
  L("up-margen").style.color    = totalMargen >= 30 ? "var(--success)" : totalMargen >= 0 ? "var(--warning)" : "var(--danger)";
  const periodoTxt = desde && hasta ? `${desde} → ${hasta}` : desde ? `Desde ${desde}` : hasta ? `Hasta ${hasta}` : "Todo el historial";
  L("up-periodo-label").textContent = periodoTxt;
  L("up-ops-count").textContent = `${ops.length} operación${ops.length !== 1 ? "es" : ""}`;
  if(sinReceta > 0){
    L("up-sin-receta-aviso").style.display = "inline";
    L("up-sin-receta-num").textContent = sinReceta;
  } else { L("up-sin-receta-aviso").style.display = "none"; }
  L("util-ops-list").innerHTML = ops.map(g => {
    const mCls = g.margen === null ? '' : g.margen >= 50 ? 'margen-alto' : g.margen >= 30 ? 'margen-med' : 'margen-bajo';
    const uCls = g.utilidad === null ? '' : g.utilidad >= 0 ? 'util-verde' : 'util-rojo';
    return `<div class="op-row">
      <div class="op-fecha">${g.fecha ? g.fecha.substring(0,16).replace('T',' ') : ''}</div>
      <div class="op-prods">${g.items.map(i=>`${i.cantidad}× ${i.sabor} ${i.tamano}`).join(' · ')}</div>
      <div class="op-nums">
        <div class="op-num-card"><div class="op-num-val">${fmtMXN(g.ingreso)}</div><div class="op-num-label">Ingreso neto${g.comMonto<0?` <span style="font-size:10px;color:var(--danger)">-$${Math.abs(g.comMonto).toLocaleString('es-MX')}</span>`:''}</div></div>
        <div class="op-num-card"><div class="op-num-val">${g.calculable ? fmtMXN(g.costo) : '—'}</div><div class="op-num-label">Costo</div></div>
        <div class="op-num-card"><div class="op-num-val ${uCls}">${g.utilidad !== null ? fmtMXN(g.utilidad) : '—'}</div><div class="op-num-label">Utilidad</div></div>
      </div>
      <div class="op-tags">
        <span class="tag${g.canal==='Merma'?' tag-merma':g.canal==='Cortesía'?' tag-regalo':''}">${g.canal||''}</span>
        ${g.canal!=='Merma'?`<span class="tag">${g.metodoPago||''}</span>`:''}
        <span class="tag">${g.sucursal||''}</span>
        ${g.clienteNombre ? `<span class="tag">${g.clienteNombre}</span>` : ''}
        ${g.margen !== null ? `<span class="util-margen ${mCls}" style="font-size:11px">${g.margen.toFixed(1)}% margen</span>` : '<span class="tag" style="color:var(--warning)">sin receta</span>'}
      </div>
    </div>`;
  }).join('');
}
async function cargarComisionesConfig(){
  const res = await api("getComisionesConfig");
  if(res.ok && res.comisiones){ S.comisionesConfig = res.comisiones; }
  else { S.comisionesConfig = {...COMISIONES_DEFAULT}; }
  renderComisionesList();
}
function renderComisionesList(){
  const el = L("comisiones-lista");
  if(!el) return;
  const C = S.comisionesConfig;
  const nombres = {"Tarjeta":"Tarjeta crédito/débito","Transferencia":"Transferencia","Rappi":"Rappi","Uber Eats":"Uber Eats","Efectivo":"Efectivo"};
  el.innerHTML = Object.entries(nombres).map(([key,label])=>{
    const raw = C[key];
    const pct = typeof raw==='number' ? Math.abs(raw*100).toFixed(1) : '0.0';
    const color = parseFloat(pct)>0 ? 'var(--accent)' : 'var(--muted)';
    return `<div class="insumo-row">
      <div><div class="insumo-nombre">${label}</div><div class="insumo-meta">Se descuenta del ingreso al vender</div></div>
      <div><div class="insumo-costo" style="color:${color}">${pct}%</div><div class="insumo-costo-label">comisión</div></div>
      <button class="btn-del-small" onclick="editarComision('${key}',${pct})" title="Editar">✏️</button>
    </div>`;
  }).join("");
}
function editarComision(nombre, pct){
  const sel = L("com-nombre"); if(sel) sel.value = nombre;
  const inp = L("com-pct"); if(inp) inp.value = pct;
  actualizarPreviewComision();
  L("com-nombre").scrollIntoView({behavior:"smooth",block:"nearest"});
}
function actualizarPreviewComision(){
  const pct = parseFloat(L("com-pct")?.value)||0;
  const prev = L("com-preview");
  if(!prev) return;
  if(!pct){ prev.textContent="Sin comisión (0%)"; return; }
  const ejemplo = 350;
  const cargo = Math.round(ejemplo * pct/100);
  prev.textContent = `Ejemplo: venta de $${ejemplo} → cargo $${cargo} → ingreso neto $${ejemplo-cargo}`;
}
L("com-pct")?.addEventListener("input", actualizarPreviewComision);
async function guardarComision(){
  const nombre = L("com-nombre")?.value;
  const pct = parseFloat(L("com-pct")?.value)||0;
  if(!nombre){ toast("Selecciona un método","error"); return; }
  const res = await api("saveComisionConfig",{nombre, porcentaje: -(pct/100)});
  if(res.ok){
    S.comisionesConfig[nombre] = -(pct/100);
    renderComisionesList();
    toast(`✅ Comisión ${nombre}: ${pct}%`);
    if(L("com-pct")) L("com-pct").value="";
  } else { toast(res.error||"Error al guardar comisión","error"); }
}
async function cargarCanalPreciosAlInicio(){
  const res = await api("getCanalPrecios");
  if(res.ok) S.canalPrecios = res.reglas || [];
}
async function cargarRecetasAlInicio(){
  const res = await api("getRecetas");
  if(res.ok) S.recetas = res.recetas || [];
}
const EQUIV = { "Individual": 0.5, "Mediana": 1, "Mediano": 1, "Grande": 2 };
function getMetas() {
  const mes  = parseInt(L("tbl-mes")?.value)  || new Date().getMonth()+1;
  const anio = parseInt(L("tbl-anio")?.value) || new Date().getFullYear();
  const key  = `metas_${mes}_${anio}`;
  return S[key] || { cuaji: 0, polanco: 0, ruta: 0 };
}
async function cargarMetas(mes, anio) {
  const key = `metas_${mes}_${anio}`;
  try {
    const res = await api("getObjetivos");
    if (res && res.ok) {
      const objs = (res.objetivos || []).filter(o => o.activo !== false && Number(o.mes) === Number(mes) && Number(o.anio) === Number(anio));
      const find = suc => { const o = objs.find(x => x.sucursal === suc); return o ? (Number(o.metaTotal) || 0) : 0; };
      S[key] = { cuaji: find("Cuajimalpa"), polanco: find("Polanco"), ruta: find("Ruta") };
    } else if (!S[key]) {
      S[key] = { cuaji: 0, polanco: 0, ruta: 0 };
    }
  } catch (e) {
    if (!S[key]) S[key] = { cuaji: 0, polanco: 0, ruta: 0 };
  }
  return S[key];
}
async function guardarMetasTablero() {
  const mes   = parseInt(L("tbl-mes")?.value)  || new Date().getMonth()+1;
  const anio  = parseInt(L("tbl-anio")?.value) || new Date().getFullYear();
  const key   = `metas_${mes}_${anio}`;
  const cuaji   = parseFloat(L("tbl-meta-cuaji")?.value)   || 0;
  const polanco = parseFloat(L("tbl-meta-polanco")?.value) || 0;
  const ruta    = parseFloat(L("tbl-meta-ruta")?.value)    || 0;
  try {
    await api("saveObjetivo", { id:"OBJ-"+anio+"-"+mes+"-Cuajimalpa", nombre:"Meta "+mes+"/"+anio+" Cuajimalpa", sucursal:"Cuajimalpa", mes, anio, metaTotal:cuaji });
    await api("saveObjetivo", { id:"OBJ-"+anio+"-"+mes+"-Polanco",    nombre:"Meta "+mes+"/"+anio+" Polanco",    sucursal:"Polanco",    mes, anio, metaTotal:polanco });
    await api("saveObjetivo", { id:"OBJ-"+anio+"-"+mes+"-Ruta",       nombre:"Meta "+mes+"/"+anio+" Ruta",       sucursal:"Ruta",       mes, anio, metaTotal:ruta });
  } catch(e) {}
  S[key] = { cuaji, polanco, ruta };
  toast("✅ Metas guardadas");
  renderTablero();
}
async function toggleObjetivosConfig() {
  const body  = L("tbl-config-body");
  const arrow = L("tbl-config-arrow");
  const open  = body.style.display === "block";
  body.style.display  = open ? "none" : "block";
  arrow.textContent   = open ? "▼" : "▲";
  if (!open) {
    const mes  = parseInt(L("tbl-mes")?.value)  || new Date().getMonth()+1;
    const anio = parseInt(L("tbl-anio")?.value) || new Date().getFullYear();
    const key  = `metas_${mes}_${anio}`;
    if (!S[key]) { await cargarMetas(mes, anio); }
    const metas = getMetas();
    if (L("tbl-meta-cuaji"))   L("tbl-meta-cuaji").value   = metas.cuaji;
    if (L("tbl-meta-polanco")) L("tbl-meta-polanco").value = metas.polanco;
    if (L("tbl-meta-ruta"))    L("tbl-meta-ruta").value    = metas.ruta;
  }
}
let _vistaTablero = "mes";
function setVistaTablero(vista) {
  _vistaTablero = vista;
  const btnMes = L("tbl-btn-mes");
  const btnSem = L("tbl-btn-sem");
  const selSem = L("tbl-semana");
  if (vista === "mes") {
    btnMes.style.background = "var(--ink)"; btnMes.style.color = "#fff";
    btnSem.style.background = "transparent"; btnSem.style.color = "var(--muted)";
    if (selSem) selSem.style.display = "none";
  } else {
    btnSem.style.background = "var(--ink)"; btnSem.style.color = "#fff";
    btnMes.style.background = "transparent"; btnMes.style.color = "var(--muted)";
    if (selSem) selSem.style.display = "";
  }
  renderTablero();
}
async function iniciarTablero() {
  const hoy = new Date();
  if (L("tbl-mes"))  L("tbl-mes").value  = String(hoy.getMonth()+1);
  if (L("tbl-anio")) L("tbl-anio").value = String(hoy.getFullYear());
  await renderTablero();
}
async function renderTablero() {
  const contenido = L("tbl-contenido");
  if (!contenido) return;
  contenido.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">Calculando...</div>';
  const mes   = parseInt(L("tbl-mes")?.value)   || new Date().getMonth()+1;
  const anio  = parseInt(L("tbl-anio")?.value)  || new Date().getFullYear();
  const semana = parseInt(L("tbl-semana")?.value) || 1;
  await cargarMetas(mes, anio);
  const metas = getMetas();
  const esSemana = _vistaTablero === "semana";
  const _diasMes = new Date(anio, mes, 0).getDate();
  const _desdeMes = `${anio}-${String(mes).padStart(2,"0")}-01`;
  const _hastaMes = `${anio}-${String(mes).padStart(2,"0")}-${String(_diasMes).padStart(2,"0")}`;
  const res = await api("getVentas", { desde: _desdeMes, hasta: _hastaMes });
  if (!res.ok) { contenido.innerHTML = '<div style="padding:20px;color:var(--danger)">Error cargando ventas</div>'; return; }
  const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const ventas = res.ventas.filter(v => {
    if (!v.fecha) return false;
    const f = new Date(v.fecha);
    if (f.getMonth()+1 !== mes || f.getFullYear() !== anio) return false;
    if (v.canal === "Merma" || v.canal === "Cortesía") return false;
    if ((v.tipoOp || "Venta") !== "Venta") return false;   // solo ventas reales (no regalo/merma/reserva)
    if (esSemana) {
      const dia = f.getDate();
      const semanaVenta = Math.min(4, Math.ceil(dia / 7));
      if (semanaVenta !== semana) return false;
    }
    return true;
  });
  // Prorrateo por días: cada semana del mes pesa según sus días (sem 1-3 = 7 días; sem 4 = el resto).
  const _diasSemana = esSemana ? (semana < 4 ? 7 : Math.max(1, _diasMes - 21)) : _diasMes;
  const factorMeta = _diasSemana / _diasMes;
  const metasCuajiEfectiva   = metas.cuaji   * factorMeta;
  const metasPolancoEfectiva = metas.polanco * factorMeta;
  const metasRutaEfectiva    = (metas.ruta || 0) * factorMeta;
  function calcEquiv(ventasSuc) {
    let total = 0;
    const desglose = {};
    for (const v of ventasSuc) {
      const factor = EQUIV[v.tamano] ?? 1;
      total += v.cantidad * factor;
      const key = v.tamano;
      if (!desglose[key]) desglose[key] = { cantidad: 0, equiv: 0 };
      desglose[key].cantidad += v.cantidad;
      desglose[key].equiv    += v.cantidad * factor;
    }
    return { total, desglose };
  }
  const vRuta    = ventas.filter(v => v.canal === "Ruta");
  const vCuaji   = ventas.filter(v => v.sucursal === "Cuajimalpa" && v.canal !== "Ruta");
  const vPolanco = ventas.filter(v => v.sucursal === "Polanco");
  const resCuaji   = calcEquiv(vCuaji);
  const resPolanco = calcEquiv(vPolanco);
  const resRuta    = calcEquiv(vRuta);
  const totalEquiv = resCuaji.total + resPolanco.total + resRuta.total;
  const metaTotal  = metasCuajiEfectiva + metasPolancoEfectiva + metasRutaEfectiva;
  const periodoLabel = esSemana ? `Semana ${semana} · ${MESES[mes]} ${anio}` : `${MESES[mes]} ${anio}`;
  function barraHTML(pct, color) {
    const w = Math.min(100, pct);
    const bg = pct >= 100 ? "#2E5C4A" : pct >= 70 ? "#86BDAD" : pct >= 40 ? "#F39C12" : "#E74C3C";
    return `<div style="background:rgba(0,0,0,.08);border-radius:100px;height:14px;overflow:hidden;margin:8px 0">
      <div style="width:${w}%;height:14px;background:${bg};border-radius:100px;transition:.8s ease;position:relative">
        ${w > 15 ? `<span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;color:#fff">${pct.toFixed(0)}%</span>` : ""}
      </div>
    </div>`;
  }
  function tamanosHTML(desglose) {
    const orden = ["Individual","Mediana","Mediano","Grande"];
    const filas = orden.filter(t => desglose[t]?.cantidad > 0).map(t => {
      const d = desglose[t];
      const factor = EQUIV[t] ?? 1;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.05)">
        <div style="font-size:13px;color:var(--muted)">${t} <span style="font-size:11px">(×${factor})</span></div>
        <div style="display:flex;gap:16px;align-items:center">
          <span style="font-size:13px;color:var(--ink)">${d.cantidad} pzas</span>
          <span style="font-size:14px;font-weight:700;color:var(--accent);min-width:50px;text-align:right">= ${d.equiv.toFixed(1)}</span>
        </div>
      </div>`;
    }).join("");
    return filas || '<div style="font-size:13px;color:var(--muted);padding:8px 0">Sin ventas registradas</div>';
  }
  function tarjetaSucursal(nombre, resultado, meta, color) {
    const pct = meta > 0 ? (resultado.total / meta * 100) : 0;
    const faltante = Math.max(0, meta - resultado.total);
    const estado = pct >= 100 ? "✅ Meta alcanzada" : pct >= 70 ? "🟡 Buen ritmo" : pct >= 40 ? "🟠 En progreso" : "🔴 Por debajo";
    return `
    <div style="background:var(--card);border-radius:16px;padding:20px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <div style="font-weight:700;font-size:16px">${nombre}</div>
        <div style="font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;background:rgba(0,0,0,.06)">${estado}</div>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:2px">
        <div style="font-size:44px;font-weight:800;font-family:'Fraunces',serif;color:${pct>=100?'#2E5C4A':'var(--ink)'}">${resultado.total.toFixed(1)}</div>
        <div style="font-size:18px;color:var(--muted);margin-bottom:4px">/ ${meta}</div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:4px">medianas equivalentes</div>
      ${barraHTML(pct, color)}
      ${faltante > 0 ? `<div style="font-size:12px;color:var(--muted);margin-top:4px">Faltan <strong>${faltante.toFixed(1)}</strong> medianas equivalentes</div>` : ""}
      <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;margin-bottom:6px;text-transform:uppercase">Desglose por tamaño</div>
        ${tamanosHTML(resultado.desglose)}
      </div>
    </div>`;
  }
  const pctTotal = metaTotal > 0 ? (totalEquiv / metaTotal * 100) : 0;
  const totalHTML = `
    <div style="background:var(--ink);border-radius:16px;padding:20px;margin-bottom:12px;color:#fff">
      <div style="font-size:13px;opacity:.7;margin-bottom:4px;font-weight:600;letter-spacing:.05em;text-transform:uppercase">Total empresa · ${periodoLabel}</div>
      <div style="display:flex;align-items:baseline;gap:8px">
        <div style="font-size:52px;font-weight:800;font-family:'Fraunces',serif">${totalEquiv.toFixed(1)}</div>
        <div style="font-size:20px;opacity:.6">/ ${metaTotal}</div>
      </div>
      <div style="font-size:13px;opacity:.7;margin-bottom:8px">medianas equivalentes</div>
      ${barraHTML(pctTotal, "#86BDAD")}
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:13px;opacity:.8">
        <span>Cuajimalpa: ${resCuaji.total.toFixed(1)}</span>
        <span>Polanco: ${resPolanco.total.toFixed(1)}</span>
        <span>Ruta: ${resRuta.total.toFixed(1)}</span>
      </div>
    </div>`;
  contenido.innerHTML = totalHTML +
    tarjetaSucursal("Cuajimalpa", resCuaji,   metasCuajiEfectiva,   "#86BDAD") +
    tarjetaSucursal("Polanco",    resPolanco, metasPolancoEfectiva, "#86BDAD") +
    tarjetaSucursal("Ruta",       resRuta,    metasRutaEfectiva,    "#C8602A");
}
L("btn-logout").addEventListener("click",async()=>{
  if(S.token){
    try { await api("logout",{}); } catch(e){}
  }
  limpiarVenta();
  S={token:null,usuario:null,rol:null,sucursal:null,permisos:null,catalogo:null,precios:null,stock:null,carrito:[],clienteSel:null,filtroSuc:null,filtroTam:null,insumos:[],recetas:[],recetaActual:[],costoEnvio:0,zonasEnvio:[],canalPrecios:[],comisionesConfig:{},movimientos:[],anularPendiente:null,reporteFiltros:{sabores:[],tamanos:[],canales:[],tipos:["venta"]},periodoFiltros:{sabores:[],tamanos:[],canales:[],tipos:["venta"]},oportFiltros:{sabores:[],tamanos:[],canales:[],tipos:["venta"]},utildiarioFiltros:{sabores:[],tamanos:[],canales:[],tipos:["venta"]},utilperiodoFiltros:{sabores:[],tamanos:[],canales:[],tipos:["venta"]},utilperiodoActual:{preset:"semana",desde:null,hasta:null,modoLinea:"dia"},conciFiltros:{tipos:["venta"]}};
  L("app").style.display="none";L("login-screen").style.display="flex";L("login-user").value="";L("login-pass").value="";
});
document.querySelectorAll(".modal-overlay").forEach(o=>{o.addEventListener("click",e=>{if(e.target===o)o.classList.remove("show");});});
async function cargarReporte() {
  if (!S.catalogo) { const res = await api("getCatalogo"); if (res.ok) S.catalogo = res; }
  L("reporte-content").innerHTML = '<div class="loading"><div class="spinner"></div>Cargando...</div>';
  const res = await api("getVentas");
  if (!res.ok) { L("reporte-content").innerHTML = '<div class="empty-state"><div>Error al cargar ventas</div></div>'; return; }
  S.ventasReporte = res.ventas || [];
  _renderFiltrosReporte();
  renderReporte();
}
function _renderFiltrosReporte() {
  const sabores = (S.catalogo?.sabores || []).filter(s => s.activo).map(s => s.nombre);
  const tamanos = (S.catalogo?.tamanos || []).filter(t => t.activo).map(t => t.nombre);
  const canales = ["Tienda", "Domicilio", "Rappi", "Uber Eats"];
  const f = S.reporteFiltros;
  L("reporte-filtros-sabor").innerHTML = sabores.map(s =>
    `<div class="chip ${f.sabores.includes(s) ? 'active' : ''}" onclick="toggleFiltroReporte('sabores','${s}')">${s}</div>`).join("");
  L("reporte-filtros-tamano").innerHTML = tamanos.map(t =>
    `<div class="chip ${f.tamanos.includes(t) ? 'active' : ''}" onclick="toggleFiltroReporte('tamanos','${t}')">${t}</div>`).join("");
  L("reporte-filtros-canal").innerHTML = canales.map(c =>
    `<div class="chip ${f.canales.includes(c) ? 'active' : ''}" onclick="toggleFiltroReporte('canales','${c}')">${c}</div>`).join("");
  _renderChipsTipo("reporte-filtros-tipo", f, "toggleFiltroReporte"); // v3.4.16
}
function toggleFiltroReporte(tipo, valor) {
  const arr = S.reporteFiltros[tipo];
  const idx = arr.indexOf(valor);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(valor);
  _renderFiltrosReporte();
  renderReporte();
}
function _hoyCDMXString() {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, "0");
  const d = String(hoy.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}
function _ventasFiltradas(rangoFn) {
  const hoyStr = _hoyCDMXString();
  const f = S.reporteFiltros;
  return (S.ventasReporte || []).filter(v => {
    if (!v.fecha) return false;
    if (!(f.tipos||["venta"]).includes(_tipoOpVenta(v))) return false; // v3.4.16: filtro tipo
    if (!rangoFn(v.fecha, hoyStr)) return false;
    if (f.sabores.length && !f.sabores.includes(v.sabor)) return false;
    if (f.tamanos.length && !f.tamanos.includes(v.tamano)) return false;
    if (f.canales.length && !f.canales.includes(v.canal)) return false;
    return true;
  });
}
function _esHoy(fechaStr, hoyStr) {
  return String(fechaStr).startsWith(hoyStr);
}
function _resumenVentas(ventas) {
  const idVentas = new Set(ventas.map(v => v.idVenta));
  const total = ventas.reduce((s, v) => s + (Number(v.subtotal) || 0), 0);
  const piezas = ventas.reduce((s, v) => s + (Number(v.cantidad) || 0), 0);
  const porTamano = {};
  ventas.forEach(v => {
    if (!porTamano[v.tamano]) porTamano[v.tamano] = { piezas: 0, monto: 0 };
    porTamano[v.tamano].piezas += Number(v.cantidad) || 0;
    porTamano[v.tamano].monto += Number(v.subtotal) || 0;
  });
  const porCanal = {};
  ventas.forEach(v => {
    if (!porCanal[v.canal]) porCanal[v.canal] = { piezas: 0, monto: 0 };
    porCanal[v.canal].piezas += Number(v.cantidad) || 0;
    porCanal[v.canal].monto += Number(v.subtotal) || 0;
  });
  const porSabor = {};
  ventas.forEach(v => {
    if (!porSabor[v.sabor]) porSabor[v.sabor] = { piezas: 0, monto: 0 };
    porSabor[v.sabor].piezas += Number(v.cantidad) || 0;
    porSabor[v.sabor].monto += Number(v.subtotal) || 0;
  });
  return { total, piezas, transacciones: idVentas.size, porTamano, porCanal, porSabor };
}
function _sortKeyPivot(scope) {
  if (!S.pivotSort) S.pivotSort = {};
  return S.pivotSort[scope] || null;
}
function togglePivotSort(scope, col) {
  if (!S.pivotSort) S.pivotSort = {};
  const cur = S.pivotSort[scope];
  if (cur && cur.col === col) {
    S.pivotSort[scope] = { col, dir: cur.dir === "desc" ? "asc" : "desc" };
  } else {
    S.pivotSort[scope] = { col, dir: col === "_sabor" ? "asc" : "desc" };
  }
  if (scope.startsWith("rep_") || scope.startsWith("per_")) {
    const subDia = L("reporte-diario");
    const subPer = L("reporte-periodo");
    if (subDia && subDia.classList.contains("active")) renderReporte();
    if (subPer && subPer.classList.contains("active")) renderReportePeriodo();
  } else if (scope.startsWith("inv_")) {
    renderStock();
  }
}
function _tablaPivotSaborTamano(ventas, modo, color, scope) {
  scope = scope || "rep_total";
  const sabores = (S.catalogo?.sabores || []).filter(s => s.activo).map(s => s.nombre);
  const tamanos = (S.catalogo?.tamanos || []).filter(t => t.activo).map(t => t.nombre);
  if (sabores.length === 0 || tamanos.length === 0) return "";
  const M = {};
  sabores.forEach(sab => { M[sab] = {}; tamanos.forEach(tam => M[sab][tam] = { piezas: 0, monto: 0 }); });
  (ventas || []).forEach(v => {
    if (!M[v.sabor] || !M[v.sabor][v.tamano]) return;
    M[v.sabor][v.tamano].piezas += Number(v.cantidad) || 0;
    M[v.sabor][v.tamano].monto  += Number(v.subtotal) || 0;
  });
  return _renderPivotMatriz(M, sabores, tamanos, modo, color, scope, true);
}
function _renderPivotMatriz(M, sabores, tamanos, modo, color, scope, usaMonto, mostrarTotales) {
  const fmt = (cell) => {
    if (!cell) return '<span style="color:var(--border)">—</span>';
    if (usaMonto && modo === "monto") {
      return cell.monto > 0 ? `$${cell.monto.toLocaleString('es-MX')}` : '<span style="color:var(--border)">—</span>';
    }
    return cell.piezas > 0 ? `<strong>${cell.piezas}</strong>` : '<span style="color:var(--border)">—</span>';
  };
  const tieneAlgo = (sab) => tamanos.some(tam => {
    const c = M[sab][tam] || { piezas: 0, monto: 0 };
    return ((usaMonto && modo === "monto") ? c.monto : c.piezas) > 0;
  });
  const saboresVisibles = sabores.filter(tieneAlgo);
  if (saboresVisibles.length === 0) {
    return `<div style="padding:14px;color:var(--muted);font-size:12px;text-align:center">Sin datos en esta vista.</div>`;
  }
  const sk = _sortKeyPivot(scope);
  let sabOrden = [...saboresVisibles];
  if (sk && sk.col === "_sabor") {
    sabOrden.sort((a, b) => sk.dir === "asc" ? a.localeCompare(b) : b.localeCompare(a));
  } else if (sk && tamanos.includes(sk.col)) {
    const valor = (sab) => {
      const c = M[sab] && M[sab][sk.col];
      if (!c) return 0;
      return (usaMonto && modo === "monto") ? c.monto : c.piezas;
    };
    sabOrden.sort((a, b) => sk.dir === "asc" ? valor(a) - valor(b) : valor(b) - valor(a));
  } else {
    const tot = (sab) => tamanos.reduce((s, tam) => {
      const c = M[sab][tam] || { piezas: 0, monto: 0 };
      return s + ((usaMonto && modo === "monto") ? c.monto : c.piezas);
    }, 0);
    sabOrden.sort((a, b) => tot(b) - tot(a));
  }
  const arrow = (col) => {
    if (!sk || sk.col !== col) return '<span style="opacity:.25;font-size:9px">▲▼</span>';
    return sk.dir === "asc" ? '<span style="font-size:10px">▲</span>' : '<span style="font-size:10px">▼</span>';
  };
  const thStyleBase = "padding:6px 8px;background:var(--warm);border-bottom:2px solid var(--border);cursor:pointer;user-select:none";
  let html = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr>
      <th style="${thStyleBase};text-align:left" onclick="togglePivotSort('${scope}','_sabor')">Sabor ${arrow("_sabor")}</th>`;
  tamanos.forEach(tam => {
    html += `<th style="${thStyleBase};text-align:right" onclick="togglePivotSort('${scope}','${tam.replace(/'/g,"\\'")}')">${tam} ${arrow(tam)}</th>`;
  });
  if (mostrarTotales) {
    html += `<th style="${thStyleBase};text-align:right;color:${color}">Total</th>`;
  }
  html += `</tr></thead><tbody>`;
  const totalSab = {}, totalTam = {};
  let totalG = { piezas: 0, monto: 0 };
  if (mostrarTotales) {
    sabOrden.forEach(sab => { totalSab[sab] = { piezas: 0, monto: 0 }; });
    tamanos.forEach(tam => { totalTam[tam] = { piezas: 0, monto: 0 }; });
    sabOrden.forEach(sab => tamanos.forEach(tam => {
      const c = M[sab][tam] || { piezas:0, monto:0 };
      totalSab[sab].piezas += c.piezas; totalSab[sab].monto += c.monto;
      totalTam[tam].piezas += c.piezas; totalTam[tam].monto += c.monto;
      totalG.piezas       += c.piezas; totalG.monto       += c.monto;
    }));
  }
  sabOrden.forEach(sab => {
    html += `<tr><td style="padding:6px 8px;border-bottom:1px solid var(--warm);font-weight:500">${sab}</td>`;
    tamanos.forEach(tam => {
      html += `<td style="padding:6px 8px;border-bottom:1px solid var(--warm);text-align:right">${fmt(M[sab][tam])}</td>`;
    });
    if (mostrarTotales) {
      html += `<td style="padding:6px 8px;border-bottom:1px solid var(--warm);text-align:right;color:${color};font-weight:700">${fmt(totalSab[sab])}</td>`;
    }
    html += `</tr>`;
  });
  if (mostrarTotales) {
    html += `<tr style="background:var(--warm)"><td style="padding:6px 8px;font-weight:700;color:${color}">Total</td>`;
    tamanos.forEach(tam => {
      html += `<td style="padding:6px 8px;text-align:right;color:${color};font-weight:700">${fmt(totalTam[tam])}</td>`;
    });
    html += `<td style="padding:6px 8px;text-align:right;color:${color};font-weight:700">${fmt(totalG)}</td></tr>`;
  }
  html += `</tbody></table>`;
  return html;
}
function _tablaPivotInventario(stock, color, scope) {
  scope = scope || "inv_total";
  const sabores = (S.catalogo?.sabores || []).filter(s => s.activo).map(s => s.nombre);
  const tamanos = (S.catalogo?.tamanos || []).filter(t => t.activo).map(t => t.nombre);
  if (sabores.length === 0 || tamanos.length === 0) return "";
  const M = {};
  sabores.forEach(sab => { M[sab] = {}; tamanos.forEach(tam => M[sab][tam] = { piezas: 0 }); });
  (stock || []).forEach(s => {
    if (s.vencido || s.cantActual <= 0) return;
    if (!M[s.sabor] || !M[s.sabor][s.tamano]) return;
    M[s.sabor][s.tamano].piezas += Number(s.cantActual) || 0;
  });
  return _renderPivotMatriz(M, sabores, tamanos, "unidades", color, scope, false, true);
}
function setPivotModo(modo) {
  S.pivotModo = modo;
  if (L("tab-reporte") && L("tab-reporte").style.display !== "none") {
    const subDia = L("reporte-diario");
    const subPer = L("reporte-periodo");
    if (subDia && subDia.classList.contains("active")) renderReporte();
    if (subPer && subPer.classList.contains("active")) renderReportePeriodo();
  }
}
function _bloquePivotsReporte(ventasTotal, vCuaji, vPolanco) {
  const modo = S.pivotModo || "unidades";
  const card = (titulo, color, secId, ventas) => `<div class="card" style="margin-bottom:12px;border-left:4px solid ${color}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
      <div style="font-weight:700;font-size:15px;color:${color}">${titulo}</div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">${modo === "monto" ? "monto ($)" : "unidades"}</div>
    </div>
    <div style="overflow-x:auto">${_tablaPivotSaborTamano(ventas, modo, color, "rep_"+secId)}</div>
  </div>`;
  return `<div style="height:6px;background:linear-gradient(90deg,transparent,var(--border),transparent);border-radius:3px;margin:18px 0"></div>
    <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;margin-bottom:10px;text-transform:uppercase;text-align:center">Tabla sabor × tamaño</div>
    ${card("🏢 Total empresa", "var(--accent)", "total", ventasTotal)}
    ${card("🍰 Cuajimalpa", "var(--green)", "cuaji", vCuaji)}
    ${card("🍰 Polanco", "var(--accent)", "polanco", vPolanco)}`;
}
function _chipsPivotModo() {
  const m = S.pivotModo || "unidades";
  return `<div class="filter-row" style="margin-bottom:10px">
    <div class="chip ${m==='unidades'?'active':''}" onclick="setPivotModo('unidades')">📦 Unidades</div>
    <div class="chip ${m==='monto'?'active':''}" onclick="setPivotModo('monto')">💲 Monto</div>
  </div>`;
}
function _tarjetaResumen(titulo, r, color, secId, ventas) {
  function rowsGrid(obj, ordenarPorPiezas) {
    let keys = Object.keys(obj || {});
    if (ordenarPorPiezas) keys.sort((a,b) => (obj[b].piezas||0) - (obj[a].piezas||0));
    else keys.sort();
    if (keys.length === 0) return '';
    const totalPiezas = keys.reduce((s, k) => s + (obj[k].piezas || 0), 0);
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">` +
      keys.map(k => {
        const pct = totalPiezas > 0 ? (obj[k].piezas / totalPiezas * 100).toFixed(0) : 0;
        return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--warm);font-size:12px">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:6px">${k} <span style="color:var(--muted);font-size:11px">(${pct}%)</span></span>
          <span style="white-space:nowrap"><strong>${obj[k].piezas}</strong> · $${obj[k].monto.toLocaleString('es-MX')}</span>
        </div>`;
      }).join("") + `</div>`;
  }
  const rowsT = rowsGrid(r.porTamano, false);
  const rowsC = rowsGrid(r.porCanal, false);
  const rowsS = rowsGrid(r.porSabor, true);
  return `<div class="card" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-weight:700;font-size:16px">${titulo}</div>
      <div style="font-family:'Fraunces',serif;font-size:32px;font-weight:500;color:${color}">$${r.total.toLocaleString('es-MX')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="summary-card" style="padding:10px"><div class="summary-num" style="font-size:22px">${r.piezas}</div><div class="summary-label">Piezas</div></div>
      <div class="summary-card" style="padding:10px"><div class="summary-num" style="font-size:22px">${r.transacciones}</div><div class="summary-label">Tickets</div></div>
      <div class="summary-card" style="padding:10px"><div class="summary-num" style="font-size:22px;color:${color}">${r.piezas > 0 ? '$' + Math.round(r.total / r.piezas).toLocaleString('es-MX') : '—'}</div><div class="summary-label">Prom/pieza</div></div>
    </div>
    ${rowsT ? `<div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;margin-bottom:6px;text-transform:uppercase">Por tamaño</div>${rowsT}` : ''}
    ${rowsC ? `<div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;margin-bottom:6px;margin-top:12px;text-transform:uppercase">Por canal</div>${rowsC}` : ''}
    ${rowsS ? `<div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;margin-bottom:6px;margin-top:12px;text-transform:uppercase">Por sabor</div>${rowsS}` : ''}
  </div>`;
}
function _tarjetaPie(titulo, color, secId) {
  return `<div class="card" style="margin-bottom:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-weight:700;font-size:16px;color:${color}">📊 ${titulo}</div>
      <button onclick="resetPieDrillDown('${secId}')" class="btn-outline" style="width:auto;font-size:11px;padding:4px 10px;margin-top:0">↺ Reiniciar</button>
    </div>
    <div id="pie-container-${secId}"></div>
  </div>`;
}
function renderReporte() {
  const ventasHoy = _ventasFiltradas(_esHoy);
  const hoyStr = _hoyCDMXString();
  const ahora = new Date();
  L("reporte-fecha").innerHTML = `📅 Hoy: <strong>${hoyStr.split('-').reverse().join('-')}</strong> · Actualizado ${String(ahora.getHours()).padStart(2,'0')}:${String(ahora.getMinutes()).padStart(2,'0')} hrs`;
  if (ventasHoy.length === 0) {
    L("reporte-content").innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">📊</div><div>Sin ventas hoy${(S.reporteFiltros.sabores.length || S.reporteFiltros.tamanos.length || S.reporteFiltros.canales.length) ? ' (con los filtros aplicados)' : ''}</div></div></div>`;
    return;
  }
  const vCuaji = ventasHoy.filter(v => v.sucursal === "Cuajimalpa" && v.canal !== "Ruta");
  const vPolanco = ventasHoy.filter(v => v.sucursal === "Polanco");
  const vRuta = ventasHoy.filter(v => v.canal === "Ruta");
  const total = _resumenVentas(ventasHoy);
  const cuaji = _resumenVentas(vCuaji);
  const polanco = _resumenVentas(vPolanco);
  const ruta = _resumenVentas(vRuta);
  S.ventasPorSeccion = { total: ventasHoy, cuaji: vCuaji, polanco: vPolanco, ruta: vRuta };
  L("reporte-content").innerHTML =
    _tarjetaResumen("🏢 Total empresa", total, "var(--accent)", "total", ventasHoy) +
    _tarjetaResumen("🍰 Cuajimalpa", cuaji, "var(--green)", "cuaji", vCuaji) +
    _tarjetaResumen("🍰 Polanco", polanco, "var(--accent)", "polanco", vPolanco) +
    _tarjetaResumen("🚚 Ruta", ruta, "#C8602A", "ruta", vRuta) +
    _chipsPivotModo() +
    _bloquePivotsReporte(ventasHoy, vCuaji, vPolanco) +
    `<div style="height:6px;background:linear-gradient(90deg,transparent,var(--border),transparent);border-radius:3px;margin:18px 0"></div>` +
    `<div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;margin-bottom:10px;text-transform:uppercase;text-align:center">Análisis gráfico (drill-down)</div>` +
    _tarjetaPie("Total empresa", "var(--accent)", "total") +
    _tarjetaPie("Cuajimalpa", "var(--green)", "cuaji") +
    _tarjetaPie("Polanco", "var(--accent)", "polanco") +
    _tarjetaPie("Ruta", "#C8602A", "ruta");
  setTimeout(() => {
    ["total", "cuaji", "polanco", "ruta"].forEach(secId => renderPiesSeccion(secId));
  }, 50);
}
const DIMENSIONES = {
  sabor: { label: "Por sabor", campo: "sabor" },
  tamano: { label: "Por tamaño", campo: "tamano" },
  canal: { label: "Por canal", campo: "canal" }
};
const COLORES_PIE = ["#C8602A", "#2E5C4A", "#86BDAD", "#C9A84C", "#1976D2", "#9C27B0", "#FF9800", "#4CAF50", "#E91E63", "#607D8B", "#795548", "#3F51B5"];
const COLOR_POR_SABOR = {};
const COLOR_POR_TAMANO = { "Individual": "#86BDAD", "Mediana": "#C8602A", "Grande": "#2E5C4A" };
const COLOR_POR_CANAL = { "Tienda": "#C8602A", "Domicilio": "#1976D2", "Rappi": "#FF6F00", "Uber Eats": "#000000", "Mostrador": "#C8602A" };
function _colorParaValor(dimension, valor) {
  if (dimension === "tamano") {
    return COLOR_POR_TAMANO[valor] || _hashColor(valor);
  }
  if (dimension === "canal") {
    return COLOR_POR_CANAL[valor] || _hashColor(valor);
  }
  if (!COLOR_POR_SABOR[valor]) {
    const idx = Object.keys(COLOR_POR_SABOR).length;
    COLOR_POR_SABOR[valor] = COLORES_PIE[idx % COLORES_PIE.length];
  }
  return COLOR_POR_SABOR[valor];
}
function _hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
  return COLORES_PIE[Math.abs(h) % COLORES_PIE.length];
}
if (!S.pieEstado) S.pieEstado = { total: [], cuaji: [], polanco: [], ruta: [] };
function setReporteTab(tab) {
  document.querySelectorAll("#tab-reporte > .costos-tabs > .costos-tab").forEach(t =>
    t.classList.toggle("active", t.getAttribute("onclick") === `setReporteTab('${tab}')`));
  ["diario", "periodo", "conciliacion", "stockhora", "utildiario", "utilperiodo", "estado", "pedido", "formulas"].forEach(s => {
    const el = L("reporte-" + s);
    if (el) el.classList.toggle("active", s === tab);
  });
  if (tab === "stockhora") cargarStockHora();
  if (tab === "periodo") cargarReportePeriodo();
  if (tab === "conciliacion") cargarConciliacion();
  if (tab === "utildiario") cargarUtilDiario();
  if (tab === "utilperiodo") cargarUtilPeriodo();
  if (tab === "estado") cargarEstadoResultados();
  if (tab === "pedido") cargarPedidoSugerido();
}
// === ESTADO DE RESULTADOS (P&L vivo) — v3.4.20 (29-may-2026) ===
let _estadoData = null, _estadoDim = "sabor";
async function cargarEstadoResultados(){
  const d=new Date(), mesAct=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  const sd=L("estado-desde"), sh=L("estado-hasta");
  if(sd && !sd.value) sd.value=mesAct;
  if(sh && !sh.value) sh.value=mesAct;
  const desde=sd?sd.value:mesAct, hasta=sh?sh.value:mesAct;
  L("estado-content").innerHTML='<div class="card"><div class="empty-state"><div class="empty-icon">⏳</div><div>Calculando…</div></div></div>';
  const res=await api("getEstadoResultados",{desde,hasta});
  if(!res||!res.ok){ L("estado-content").innerHTML='<div class="card"><div class="empty-state"><div class="empty-icon">⚠️</div><div>'+((res&&res.error)||"Error al cargar")+'</div></div></div>'; return; }
  _estadoData=res; renderEstadoResultados();
}
function setEstadoDim(dim){ _estadoDim=dim; renderEstadoResultados(); }
function renderEstadoResultados(){
  const res=_estadoData; if(!res) return;
  const cols=[["Consolidado",res.consolidado],["Polanco",res.sucursales.Polanco],["Cuajimalpa",res.sucursales.Cuajimalpa]];
  const pct=v=>(v==null||isNaN(v))?"—":(v.toFixed(1)+"%");
  const row=(label,key,opts={})=>{
    const tds=cols.map(([n,d])=>{
      const val=d[key]; const txt=opts.pct?pct(val):fmtMXN(val);
      let style="text-align:right";
      if(opts.neg&&val<0) style+=";color:var(--danger)";
      if(opts.good) style+=(val>=0?";color:var(--success)":";color:var(--danger)");
      if(opts.strong) style+=";font-weight:700";
      return `<td style="${style}">${txt}</td>`;
    }).join("");
    const lbl=opts.strong?"font-weight:700":(opts.pct?"color:var(--muted);font-size:12px":"");
    const tr=opts.border?"border-top:2px solid var(--border)":"";
    return `<tr style="${tr}"><td style="${lbl}">${label}</td>${tds}</tr>`;
  };
  const rangoTxt = res.desde===res.hasta ? res.desde : `${res.desde} → ${res.hasta} (${res.nMeses} meses)`;
  const fijoLabel = res.nMeses>1 ? `(−) Costos fijos (×${res.nMeses} meses)` : "(−) Costos fijos";
  const dimKey = _estadoDim==="tamano" ? "porTamano" : "porSabor";
  const dimName = _estadoDim==="tamano" ? "Tamaño" : "Sabor";
  const breakTable = (col)=>{
    const arr=col[dimKey]||[];
    if(arr.length===0) return '<div style="font-size:12px;color:var(--muted)">Sin datos</div>';
    return `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr><th style="text-align:left;padding:3px 0">${dimName}</th><th style="text-align:right">Ing. neto</th><th style="text-align:right">Costo</th><th style="text-align:right">Utilidad</th><th style="text-align:right">Margen</th><th style="text-align:right">U.</th></tr></thead>
      <tbody>${arr.map(b=>{
        const uCls=b.utilidad>=0?"color:var(--success)":"color:var(--danger)";
        return `<tr><td style="padding:2px 0">${b.key}</td><td style="text-align:right">${fmtMXN(b.ingreso)}</td><td style="text-align:right">${fmtMXN(b.costo)}</td><td style="text-align:right;${uCls}">${fmtMXN(b.utilidad)}</td><td style="text-align:right">${pct(b.margen)}</td><td style="text-align:right">${b.unidades}</td></tr>`;
      }).join("")}</tbody></table>`;
  };
  const html=`
    <div class="card" style="overflow-x:auto">
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">Periodo <strong>${rangoTxt}</strong> · generado ${res.generado}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr><th style="text-align:left;padding:4px 0"></th>${cols.map(([n])=>`<th style="text-align:right;padding:4px 0;color:var(--accent)">${n}</th>`).join("")}</tr></thead>
        <tbody>
          ${row("Ingresos brutos (ventas)","ingresoBruto")}
          ${row("(−) Comisiones canal/método","comision",{neg:true})}
          ${row("= Ingresos netos","ingresoNeto",{strong:true})}
          ${row("(−) Costo variable (receta)","costoVar")}
          ${row("= Utilidad bruta","utilidadBruta",{strong:true,good:true,border:true})}
          ${row("Margen bruto","margenBruto",{pct:true})}
          ${row("(−) Mermas y regalos (costo)","mermaRegaloCosto")}
          ${row(fijoLabel,"fijoTotal")}
          ${row("= Utilidad neta","utilidadNeta",{strong:true,good:true,border:true})}
          ${row("Margen neto","margenNeto",{pct:true})}
        </tbody>
      </table>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px">
        ${cols.map(([n,d])=>`<div style="background:var(--warm);border-radius:10px;padding:10px">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">${n}</div>
          <div style="font-size:12px;margin-top:4px">Operaciones: <strong>${d.ops}</strong> · ${d.unidades} u.</div>
          <div style="font-size:12px">Ticket promedio: <strong>${fmtMXN(d.ticketProm)}</strong></div>
          <div style="font-size:12px">Costos fijos/mes: <strong>${fmtMXN(d.fijoMensual)}</strong></div>
          <div style="font-size:12px">Venta de equilibrio/mes: <strong>${d.ventaEquilibrio==null?"—":fmtMXN(d.ventaEquilibrio)}</strong></div>
        </div>`).join("")}
      </div>
      <div style="margin-top:18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-weight:700;font-size:14px">Contribución por ${dimName.toLowerCase()} y localidad</div>
        <div style="display:flex;gap:2px">
          <button onclick="setEstadoDim('sabor')" class="costos-tab ${_estadoDim==='sabor'?'active':''}" style="padding:5px 12px;font-size:11px">Por sabor</button>
          <button onclick="setEstadoDim('tamano')" class="costos-tab ${_estadoDim==='tamano'?'active':''}" style="padding:5px 12px;font-size:11px">Por tamaño</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:10px">
        ${cols.map(([n,d])=>`<div style="background:var(--warm);border-radius:10px;padding:10px">
          <div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:6px">${n}</div>
          ${breakTable(d)}
        </div>`).join("")}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:12px;line-height:1.5">
        Ingresos netos = ventas − comisión de canal/método. Utilidad bruta = ingresos netos − costo de receta.
        Mermas y regalos se restan como fuga. Costos fijos: hoja <strong>Gastos</strong> al 100% por mes (× nº de meses del rango);
        los sin sucursal se reparten 50/50. La contribución prorratea la comisión del ticket entre sus líneas.
      </div>
    </div>`;
  L("estado-content").innerHTML=html;
}
async function cargarPedidoSugerido(){
  const sel=L("pedido-fecha");
  if(sel && !sel.value){ const d=new Date(); d.setDate(d.getDate()+1); sel.value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  const fecha=sel?sel.value:"";
  L("pedido-content").innerHTML='<div class="card"><div class="empty-state"><div class="empty-icon">⏳</div><div>Calculando…</div></div></div>';
  const res=await api("getPedidoSugerido", fecha?{fecha}:{});
  if(!res||!res.ok){ L("pedido-content").innerHTML='<div class="card"><div class="empty-state"><div class="empty-icon">⚠️</div><div>'+((res&&res.error)||"Error al calcular")+'</div></div></div>'; return; }
  const tabla=(loc,arr)=>{
    if(!arr.length) return `<div style="font-size:12px;color:var(--muted)">Sin datos suficientes para ${loc}</div>`;
    return `<table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr><th style="text-align:left;padding:4px 0">Sabor</th><th style="text-align:left">Tamaño</th><th style="text-align:right">Pot/día</th><th style="text-align:right" title="Método A: ventana 7 días (actual)">Sug A</th><th style="text-align:right" title="Método B: tendencia mismo día">Sug B</th></tr></thead>
      <tbody>${arr.map(r=>`<tr><td style="padding:3px 0">${r.sabor}</td><td>${r.tamano}</td><td style="text-align:right;color:var(--muted)">${r.promPotencial}</td><td style="text-align:right;font-weight:700;color:var(--accent)">${r.sugerido}</td><td style="text-align:right;font-weight:700;color:var(--success)">${r.sugerido2!=null?r.sugerido2:"—"}</td></tr>`).join("")}</tbody></table>`;
  };
  const dia=res.diaSemana.toLowerCase();
  const modoTxt = `promedio ponderado de 7 días (del ${dia} de la semana pasada al día previo al objetivo)`;
  const cols=[["Polanco",res.sucursales.Polanco],["Cuajimalpa",res.sucursales.Cuajimalpa]];
  const html=`
    <div class="card">
      <div style="font-size:14px;margin-bottom:4px"><strong>${res.diaSemana} ${res.fecha}</strong> · cocinada sugerida</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Base: ${modoTxt} · +${res.bufferPct}% · ${(res.diasUsados||[]).map((d,i)=>`${d} (${Math.round((res.pesos&&res.pesos[i]!=null?res.pesos[i]:0)*100)}%)`).join(" · ")||"—"}</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px">
        ${cols.map(([loc,arr])=>`<div style="background:var(--warm);border-radius:10px;padding:12px">
          <div style="font-weight:700;margin-bottom:8px">${loc} · <span style="color:var(--accent)">A: ${res.totalSugerido[loc]}</span> · <span style="color:var(--success)">B: ${res.totalSugerido2?res.totalSugerido2[loc]:0}</span> pzas</div>
          ${tabla(loc,arr)}
        </div>`).join("")}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:12px;line-height:1.5"><strong style="color:var(--accent)">Sug A — método actual (ventana 7 días):</strong> Potencial/día = lo vendido ese día, proyectado a día completo si se agotó temprano. Promedio ponderado de los 7 días previos (mismo día de la semana pasada y día previo al objetivo 25% c/u; los otros 5 días 10% c/u) +${res.bufferPct}%, redondeando hacia arriba.<br><strong style="color:var(--success)">Sug B — tendencia mismo día:</strong> promedio ponderado de los 4 ${dia}s anteriores con <em>unidades realmente vendidas</em> (hace 1/2/3/4 semanas con 32/24/16/8% — bloque 80%) + 20% del Sug A, +${(res.metodo2&&res.metodo2.bufferPct!=null)?res.metodo2.bufferPct:10}% al final. Si falta una semana, su peso se reparte entre las que sí tienen ventas.${(res.metodo2&&res.metodo2.diasMismoDia)?" Días usados: "+res.metodo2.diasMismoDia.map((d,i)=>`${d} (${Math.round((res.metodo2.pesosMismoDia&&res.metodo2.pesosMismoDia[i]!=null?res.metodo2.pesosMismoDia[i]:0)*100)}%)`).join(" · ")+".":""}<br>Ninguno incluye ventas de ruta (esas se planean según lo que pidan los clientes).</div>
    </div>`;
  L("pedido-content").innerHTML=html;
}
function resetPieDrillDown(secId) {
  S.pieEstado[secId] = [];
  renderPiesSeccion(secId);
}
function _ventasFiltradasPorEstado(ventas, estado) {
  let resultado = ventas;
  estado.forEach(nivel => {
    resultado = resultado.filter(v => v[DIMENSIONES[nivel.dimension].campo] === nivel.valorSeleccionado);
  });
  return resultado;
}
function _agruparPor(ventas, campo) {
  const grupos = {};
  ventas.forEach(v => {
    const k = v[campo] || "(sin)";
    if (!grupos[k]) grupos[k] = { piezas: 0, monto: 0 };
    grupos[k].piezas += Number(v.cantidad) || 0;
    grupos[k].monto += Number(v.subtotal) || 0;
  });
  return Object.keys(grupos).sort((a, b) => grupos[b].piezas - grupos[a].piezas).map(k => ({ key: k, ...grupos[k] }));
}
function _dimensionesDisponibles(secId) {
  const usadas = S.pieEstado[secId].map(n => n.dimension);
  return Object.keys(DIMENSIONES).filter(d => !usadas.includes(d));
}
function renderPiesSeccion(secId) {
  const container = L("pie-container-" + secId);
  if (!container) return;
  const ventasSec = S.ventasPorSeccion?.[secId] || [];
  if (ventasSec.length === 0) { container.innerHTML = '<div style="font-size:12px;color:var(--muted)">Sin datos para mostrar</div>'; return; }
  const estado = S.pieEstado[secId];
  const niveles = estado.length;
  const ventasFiltradas = _ventasFiltradasPorEstado(ventasSec, estado);
  const disponibles = _dimensionesDisponibles(secId);
  if (disponibles.length === 0) {
    container.innerHTML = `<div style="background:var(--warm);border-radius:10px;padding:14px;text-align:center;font-size:12px;color:var(--muted)">
      ✓ Has llegado al nivel más profundo. Click en ↺ Reiniciar para empezar de nuevo.
    </div>`;
    return;
  }
  const nivelActual = niveles + 1;
  const breadcrumb = estado.length === 0 ? "" :
    estado.map((n, i) => `<span style="font-size:11px;background:var(--warm);padding:3px 8px;border-radius:6px;margin-right:4px">${DIMENSIONES[n.dimension].label}: <strong>${n.valorSeleccionado}</strong></span>`).join("");
  if (!S.pieDimensionPorNivel) S.pieDimensionPorNivel = {};
  const keyNivel = `${secId}-${nivelActual}`;
  if (!S.pieDimensionPorNivel[keyNivel] || !disponibles.includes(S.pieDimensionPorNivel[keyNivel])) {
    S.pieDimensionPorNivel[keyNivel] = disponibles[0];
  }
  const dimSel = S.pieDimensionPorNivel[keyNivel];
  const grupos = _agruparPor(ventasFiltradas, DIMENSIONES[dimSel].campo);
  const canvasId = `pie-${secId}-n${nivelActual}`;
  const selOpts = disponibles.map(d => `<option value="${d}"${d===dimSel?' selected':''}>${DIMENSIONES[d].label}</option>`).join("");
  container.innerHTML = `
    <div style="margin-bottom:10px">${breadcrumb}</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span style="font-size:11px;color:var(--muted)">Nivel ${nivelActual}:</span>
      <select class="mini-select" style="width:auto;flex:1" onchange="cambiarDimensionPie('${secId}', ${nivelActual}, this.value)">${selOpts}</select>
    </div>
    <div style="position:relative;width:100%;height:280px"><canvas id="${canvasId}"></canvas></div>
    <div style="font-size:11px;color:var(--muted);margin-top:6px;text-align:center">Click en una rebanada para ver el siguiente nivel</div>
  `;
  setTimeout(() => {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const labels = grupos.map(g => g.key);
    const data = grupos.map(g => g.piezas);
    const colores = labels.map(lbl => _colorParaValor(dimSel, lbl));
    const chart = new Chart(ctx, {
      type: "pie",
      plugins: [window.ChartDataLabels],
      data: { labels, datasets: [{ data, backgroundColor: colores, borderColor: "#fff", borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "right", labels: { font: { size: 11 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: (ctx) => {
            const i = ctx.dataIndex;
            const total = data.reduce((s, v) => s + v, 0);
            const pct = total > 0 ? (grupos[i].piezas / total * 100).toFixed(1) : 0;
            return `${labels[i]}: ${grupos[i].piezas} uds (${pct}%) · $${grupos[i].monto.toLocaleString('es-MX')}`;
          }}},
          datalabels: {
            color: "#fff",
            font: { weight: "bold", size: 12 },
            textAlign: "center",
            textShadowBlur: 4,
            textShadowColor: "rgba(0,0,0,0.7)",
            formatter: (value, ctx) => {
              const total = ctx.chart.data.datasets[0].data.reduce((s, v) => s + v, 0);
              const pct = total > 0 ? value / total * 100 : 0;
              if (pct < 4) return "";
              return value + "\n(" + pct.toFixed(1) + "%)";
            }
          }
        },
        onClick: (evt, elements) => {
          if (elements.length === 0) return;
          const idx = elements[0].index;
          const valor = labels[idx];
          S.pieEstado[secId].push({ dimension: dimSel, valorSeleccionado: valor });
          renderPiesSeccion(secId);
        }
      }
    });
  }, 50);
}
function cambiarDimensionPie(secId, nivel, dim) {
  const key = `${secId}-${nivel}`;
  S.pieDimensionPorNivel[key] = dim;
  renderPiesSeccion(secId);
}
const STOCK_HORA_RANGO = { inicio: 9, fin: 21 };
async function cargarStockHora() {
  L("stockhora-content").innerHTML = '<div class="loading"><div class="spinner"></div>Cargando...</div>';
  if (!S.catalogo) { const c = await api("getCatalogo"); if (c.ok) S.catalogo = c; }
  const [resStock, resVentas] = await Promise.all([api("getStock"), api("getVentas")]);
  if (!resStock.ok || !resVentas.ok) {
    L("stockhora-content").innerHTML = '<div class="empty-state"><div>Error al cargar datos</div></div>';
    return;
  }
  S.stock = resStock.stock || [];
  S.ventasReporte = resVentas.ventas || [];
  _renderFiltrosOportunidad();
  renderStockHora();
  renderOportunidad();
}
async function cargarOportunidad() {
  await cargarStockHora();
}
function _renderFiltrosOportunidad() {
  const sabores = (S.catalogo?.sabores || []).filter(s => s.activo).map(s => s.nombre);
  const tamanos = (S.catalogo?.tamanos || []).filter(t => t.activo).map(t => t.nombre);
  const canales = ["Tienda", "Domicilio", "Rappi", "Uber Eats"];
  const f = S.oportFiltros;
  const elS = L("oport-filtros-sabor");
  const elT = L("oport-filtros-tamano");
  const elC = L("oport-filtros-canal");
  if (elS) elS.innerHTML = sabores.map(s =>
    `<div class="chip ${f.sabores.includes(s) ? 'active' : ''}" onclick="toggleFiltroOport('sabores','${s}')">${s}</div>`).join("");
  if (elT) elT.innerHTML = tamanos.map(t =>
    `<div class="chip ${f.tamanos.includes(t) ? 'active' : ''}" onclick="toggleFiltroOport('tamanos','${t}')">${t}</div>`).join("");
  if (elC) elC.innerHTML = canales.map(c =>
    `<div class="chip ${f.canales.includes(c) ? 'active' : ''}" onclick="toggleFiltroOport('canales','${c}')">${c}</div>`).join("");
  _renderChipsTipo("oport-filtros-tipo", f, "toggleFiltroOport"); // v3.4.16
  const elA = L("oport-agrup-chips");
  if (elA) {
    const ag = S.oportAgrupacion || "sabor_tamano";
    const opts = [
      ["sabor_tamano",   "Sabor + Tamaño"],
      ["tamano",         "Solo Tamaño"],
      ["sabor",          "Solo Sabor"],
      ["general",        "General (total)"],
      ["facet_tamano",   "Tablas por Tamaño"],
      ["facet_sabor",    "Tablas por Sabor"]
    ];
    elA.innerHTML = opts.map(([k,lbl]) =>
      `<div class="chip ${ag === k ? 'active' : ''}" onclick="setOportAgrupacion('${k}')">${lbl}</div>`).join("");
  }
}
function toggleFiltroOport(tipo, valor) {
  const arr = S.oportFiltros[tipo];
  const idx = arr.indexOf(valor);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(valor);
  _renderFiltrosOportunidad();
  renderStockHora();
  renderOportunidad();
}
function setOportAgrupacion(modo) {
  S.oportAgrupacion = modo;
  _renderFiltrosOportunidad();
  renderOportunidad();
}
function _ventasOportFiltradas(ventas) {
  const f = S.oportFiltros || { sabores:[], tamanos:[], canales:[], tipos:["venta"] };
  return (ventas || []).filter(v => {
    if (!(f.tipos||["venta"]).includes(_tipoOpVenta(v))) return false; // v3.4.16: filtro tipo
    if (f.sabores.length && !f.sabores.includes(v.sabor)) return false;
    if (f.tamanos.length && !f.tamanos.includes(v.tamano)) return false;
    if (f.canales.length && !f.canales.includes(v.canal)) return false;
    return true;
  });
}
function _extraerHora(fechaStr) {
  if (!fechaStr || fechaStr.length < 13) return null;
  return parseInt(fechaStr.substring(11, 13));
}
function renderStockHora() {
  const hoyStr = _hoyCDMXString();
  const f = S.oportFiltros || { sabores:[], tamanos:[], canales:[], tipos:["venta"] };
  const ventasHoy = (S.ventasReporte || []).filter(v => {
    if (!v.fecha || !String(v.fecha).startsWith(hoyStr)) return false;
    if (!(f.tipos||["venta"]).includes(_tipoOpVenta(v))) return false; // v3.4.16: filtro tipo
    if ((v.tipoOp || v.tipo_op) === "Reservado") return false; // excluir apartados
    if (v.canal === "Ruta") return false; // excluir ruta
    if (v.canal === "Merma" || v.canal === "Cortesía") return false; // excluir mermas/cortesías
    if (f.sabores.length && !f.sabores.includes(v.sabor)) return false;
    if (f.tamanos.length && !f.tamanos.includes(v.tamano)) return false;
    if (f.canales.length && !f.canales.includes(v.canal)) return false;
    return true;
  });
  const ahora = new Date();
  const horaActual = ahora.getHours();
  const tamanosAll = (S.catalogo?.tamanos || []).filter(t => t.activo).map(t => t.nombre);
  const saboresAll = (S.catalogo?.sabores || []).filter(s => s.activo).map(s => s.nombre);
  const tamanos = f.tamanos.length ? tamanosAll.filter(t => f.tamanos.includes(t)) : tamanosAll;
  const sabores = f.sabores.length ? saboresAll.filter(s => f.sabores.includes(s)) : saboresAll;
  const sucursales = ["Cuajimalpa", "Polanco"];
  const stockActual = {};
  (S.stock || []).forEach(s => {
    if (s.vencido || s.cantActual <= 0) return;
    if (f.sabores.length && !f.sabores.includes(s.sabor)) return;
    if (f.tamanos.length && !f.tamanos.includes(s.tamano)) return;
    const k = `${s.sucursal}|${s.sabor}|${s.tamano}`;
    stockActual[k] = (stockActual[k] || 0) + Number(s.cantActual);
  });
  const ventasPorHora = {};
  ventasHoy.forEach(v => {
    const h = _extraerHora(v.fecha);
    if (h === null) return;
    const k = `${v.sucursal}|${v.sabor}|${v.tamano}|${h}`;
    ventasPorHora[k] = (ventasPorHora[k] || 0) + (Number(v.cantidad) || 0);
  });
  const ventasTotal = {};
  ventasHoy.forEach(v => {
    const k = `${v.sucursal}|${v.sabor}|${v.tamano}`;
    ventasTotal[k] = (ventasTotal[k] || 0) + (Number(v.cantidad) || 0);
  });
  const stockInicial = {};
  sucursales.forEach(suc => {
    sabores.forEach(sab => {
      tamanos.forEach(tam => {
        const k = `${suc}|${sab}|${tam}`;
        const inicial = (stockActual[k] || 0) + (ventasTotal[k] || 0);
        if (inicial > 0) stockInicial[k] = inicial;
      });
    });
  });
  const horaFinMostrar = Math.max(STOCK_HORA_RANGO.inicio, Math.min(STOCK_HORA_RANGO.fin, horaActual));
  const horas = [];
  for (let h = STOCK_HORA_RANGO.inicio; h <= horaFinMostrar; h++) horas.push(h);
  let html = "";
  ["Total", "Cuajimalpa", "Polanco"].forEach(loc => {
    html += _renderTablaStockHora(loc, sabores, tamanos, horas, stockInicial, ventasPorHora, ventasTotal);
  });
  if (!html) html = '<div class="card"><div class="empty-state"><div class="empty-icon">📦</div><div>Sin datos para mostrar</div></div></div>';
  L("stockhora-content").innerHTML = html;
}
function _renderTablaStockHora(loc, sabores, tamanos, horas, stockInicial, ventasPorHora, ventasTotal) {
  const sucursales = loc === "Total" ? ["Cuajimalpa", "Polanco"] : [loc];
  ventasTotal = ventasTotal || {};
  const _ventasDelDia = (sab, tam) => sucursales.reduce((s, suc) => s + (ventasTotal[`${suc}|${sab}|${tam}`] || 0), 0);
  const tamanosOrden = [...tamanos].sort((a, b) => {
    const vA = sabores.reduce((s, sab) => s + _ventasDelDia(sab, a), 0);
    const vB = sabores.reduce((s, sab) => s + _ventasDelDia(sab, b), 0);
    if (vB !== vA) return vB - vA;
    const sA = sabores.reduce((s, sab) => s + sucursales.reduce((t, suc) => t + (stockInicial[`${suc}|${sab}|${a}`] || 0), 0), 0);
    const sB = sabores.reduce((s, sab) => s + sucursales.reduce((t, suc) => t + (stockInicial[`${suc}|${sab}|${b}`] || 0), 0), 0);
    return sB - sA;
  });
  let hayDatos = false;
  for (const suc of sucursales) {
    for (const sab of sabores) for (const tam of tamanos) {
      if ((stockInicial[`${suc}|${sab}|${tam}`] || 0) > 0) { hayDatos = true; break; }
    }
    if (hayDatos) break;
  }
  if (!hayDatos) return "";
  const color = loc === "Total" ? "var(--accent)" : (loc === "Cuajimalpa" ? "var(--green)" : "var(--accent)");
  let h = `<div class="card" style="margin-bottom:14px;overflow-x:auto">
    <div style="font-weight:700;font-size:16px;color:${color};margin-bottom:10px">📦 ${loc}</div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:600px">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid var(--border);background:var(--warm);position:sticky;left:0;z-index:2">Sabor</th>`;
  horas.forEach(hr => {
    h += `<th style="text-align:right;padding:6px 6px;border-bottom:2px solid var(--border);background:var(--warm);min-width:36px">${String(hr).padStart(2,'0')}h</th>`;
  });
  h += `</tr></thead><tbody>`;
  tamanosOrden.forEach(tam => {
    let saboresConStock = sabores.filter(sab => {
      let total = 0;
      sucursales.forEach(suc => { total += stockInicial[`${suc}|${sab}|${tam}`] || 0; });
      return total > 0;
    });
    saboresConStock = saboresConStock.sort((a, b) => {
      const vA = _ventasDelDia(a, tam), vB = _ventasDelDia(b, tam);
      if (vB !== vA) return vB - vA;
      const sA = sucursales.reduce((s, suc) => s + (stockInicial[`${suc}|${a}|${tam}`] || 0), 0);
      const sB = sucursales.reduce((s, suc) => s + (stockInicial[`${suc}|${b}|${tam}`] || 0), 0);
      return sB - sA;
    });
    if (saboresConStock.length === 0) return;
    h += `<tr><td colspan="${horas.length + 1}" style="background:rgba(200,96,42,0.08);padding:5px 8px;font-weight:700;font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:1px;border-top:1px solid var(--border)">${tam}</td></tr>`;
    saboresConStock.forEach(sab => {
      const inicial = sucursales.reduce((s, suc) => s + (stockInicial[`${suc}|${sab}|${tam}`] || 0), 0);
      let stockH = inicial;
      let agotadoEn = null;
      h += `<tr><td style="padding:5px 8px;border-bottom:1px solid var(--warm);position:sticky;left:0;background:white;font-weight:500">${sab}</td>`;
      horas.forEach((hr, idx) => {
        let ventasH = 0;
        sucursales.forEach(suc => { ventasH += ventasPorHora[`${suc}|${sab}|${tam}|${hr}`] || 0; });
        if (idx === 0) {
          stockH = inicial - ventasH;
        } else {
          stockH = stockH - ventasH;
        }
        if (stockH < 0) stockH = 0;
        const esCero = stockH === 0 && inicial > 0;
        const esRecienAgotado = esCero && agotadoEn === null;
        if (esCero && agotadoEn === null) agotadoEn = hr;
        const bg = esCero ? "background:#FFEBEE;color:#C0392B" : (ventasH > 0 ? "background:#FFF3E0" : "");
        const fw = esRecienAgotado ? "font-weight:700" : "";
        h += `<td style="padding:5px 6px;border-bottom:1px solid var(--warm);text-align:right;${bg};${fw}">${stockH}${ventasH > 0 ? `<span style="font-size:9px;color:var(--muted);display:block;line-height:1">-${ventasH}</span>` : ''}</td>`;
      });
      h += `</tr>`;
    });
  });
  h += `</tbody></table>
    <div style="font-size:11px;color:var(--muted);margin-top:8px">
      Cada celda muestra <strong>stock al final de esa hora</strong>.
      <span style="display:inline-block;width:10px;height:10px;background:#FFF3E0;border:1px solid #E67E22;margin-left:8px"></span> hubo ventas en esa hora ·
      <span style="display:inline-block;width:10px;height:10px;background:#FFEBEE;border:1px solid #C0392B;margin-left:8px"></span> agotado
    </div>
  </div>`;
  return h;
}
function _hoyDate() {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), h.getDate(), 23, 59, 59);
}
function _calcularRangoPreset(preset) {
  const hoy = new Date();
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);
  let ini = new Date(fin);
  if (preset === "semana") {
    const dow = hoy.getDay() || 7;
    ini.setDate(hoy.getDate() - (dow - 1));
    ini.setHours(0, 0, 0, 0);
  } else if (preset === "mes") {
    ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  } else if (preset === "trimestre") {
    const q = Math.floor(hoy.getMonth() / 3);
    ini = new Date(hoy.getFullYear(), q * 3, 1);
  } else if (preset === "anio") {
    ini = new Date(hoy.getFullYear(), 0, 1);
  } else {
    ini.setHours(0, 0, 0, 0);
  }
  return { ini, fin };
}
function _fmtFecha(d) {
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function setPeriodoPreset(preset) {
  S.periodoActual.preset = preset;
  document.querySelectorAll("#periodo-presets .chip").forEach(c =>
    c.classList.toggle("active", c.dataset.preset === preset));
  const customRow = L("periodo-custom-row");
  if (customRow) customRow.style.display = preset === "custom" ? "grid" : "none";
  if (preset !== "custom") {
    const r = _calcularRangoPreset(preset);
    S.periodoActual.desde = r.ini;
    S.periodoActual.hasta = r.fin;
    if (L("periodo-desde")) L("periodo-desde").value = _fmtFecha(r.ini);
    if (L("periodo-hasta")) L("periodo-hasta").value = _fmtFecha(r.fin);
  } else {
    const r = _calcularRangoPreset("semana");
    if (L("periodo-desde") && !L("periodo-desde").value) L("periodo-desde").value = _fmtFecha(r.ini);
    if (L("periodo-hasta") && !L("periodo-hasta").value) L("periodo-hasta").value = _fmtFecha(r.fin);
  }
  renderReportePeriodo();
}
function setModoLinea(modo) {
  S.periodoActual.modoLinea = modo;
  L("modo-dia-btn").classList.toggle("active", modo === "dia");
  L("modo-acum-btn").classList.toggle("active", modo === "acumulado");
  renderReportePeriodo();
}
async function cargarReportePeriodo() {
  if (!S.catalogo) { const res = await api("getCatalogo"); if (res.ok) S.catalogo = res; }
  L("periodo-content").innerHTML = '<div class="loading"><div class="spinner"></div>Cargando...</div>';
  const res = await api("getVentas", { desde: "2020-01-01" }); // FIX histórico: traer TODO (sin el tope de 200 filas del backend)
  if (!res.ok) { L("periodo-content").innerHTML = '<div class="empty-state"><div>Error</div></div>'; return; }
  S.ventasReporte = res.ventas || [];
  if (!S.periodoActual.desde) setPeriodoPreset(S.periodoActual.preset);
  else { _renderFiltrosPeriodo(); renderReportePeriodo(); }
}
function _renderFiltrosPeriodo() {
  const sabores = (S.catalogo?.sabores || []).filter(s => s.activo).map(s => s.nombre);
  const tamanos = (S.catalogo?.tamanos || []).filter(t => t.activo).map(t => t.nombre);
  const canales = ["Tienda", "Domicilio", "Rappi", "Uber Eats"];
  const f = S.periodoFiltros;
  if (L("periodo-filtros-sabor")) L("periodo-filtros-sabor").innerHTML = sabores.map(s =>
    `<div class="chip ${f.sabores.includes(s) ? 'active' : ''}" onclick="toggleFiltroPeriodo('sabores','${s}')">${s}</div>`).join("");
  if (L("periodo-filtros-tamano")) L("periodo-filtros-tamano").innerHTML = tamanos.map(t =>
    `<div class="chip ${f.tamanos.includes(t) ? 'active' : ''}" onclick="toggleFiltroPeriodo('tamanos','${t}')">${t}</div>`).join("");
  if (L("periodo-filtros-canal")) L("periodo-filtros-canal").innerHTML = canales.map(c =>
    `<div class="chip ${f.canales.includes(c) ? 'active' : ''}" onclick="toggleFiltroPeriodo('canales','${c}')">${c}</div>`).join("");
  _renderChipsTipo("periodo-filtros-tipo", f, "toggleFiltroPeriodo"); // v3.4.16
}
function toggleFiltroPeriodo(tipo, valor) {
  const arr = S.periodoFiltros[tipo];
  const idx = arr.indexOf(valor);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(valor);
  renderReportePeriodo();
}
function _ventasPeriodoFiltradas() {
  let ini, fin;
  if (S.periodoActual.preset === "custom") {
    const d = L("periodo-desde").value, h = L("periodo-hasta").value;
    ini = d ? new Date(d + "T00:00:00") : null;
    fin = h ? new Date(h + "T23:59:59") : null;
  } else {
    ini = S.periodoActual.desde;
    fin = S.periodoActual.hasta;
  }
  const f = S.periodoFiltros;
  return (S.ventasReporte || []).filter(v => {
    if (!v.fecha) return false;
    if (!(f.tipos||["venta"]).includes(_tipoOpVenta(v))) return false; // v3.4.16: filtro tipo
    const fv = new Date(v.fecha);
    if (ini && fv < ini) return false;
    if (fin && fv > fin) return false;
    if (f.sabores.length && !f.sabores.includes(v.sabor)) return false;
    if (f.tamanos.length && !f.tamanos.includes(v.tamano)) return false;
    if (f.canales.length && !f.canales.includes(v.canal)) return false;
    return true;
  });
}
function renderReportePeriodo() {
  _renderFiltrosPeriodo();
  const ventas = _ventasPeriodoFiltradas();
  const desde = S.periodoActual.preset === "custom"
    ? (L("periodo-desde")?.value || "—")
    : _fmtFecha(S.periodoActual.desde);
  const hasta = S.periodoActual.preset === "custom"
    ? (L("periodo-hasta")?.value || "—")
    : _fmtFecha(S.periodoActual.hasta);
  L("periodo-rango-label").innerHTML = `📅 Rango: <strong>${desde.split('-').reverse().join('-')}</strong> → <strong>${hasta.split('-').reverse().join('-')}</strong> · ${ventas.length} ventas filtradas`;
  _renderGraficaLineaPeriodo(ventas);
  if (ventas.length === 0) {
    L("periodo-content").innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">📊</div><div>Sin ventas en este período</div></div></div>';
    return;
  }
  const vCuaji = ventas.filter(v => v.sucursal === "Cuajimalpa" && v.canal !== "Ruta");
  const vPolanco = ventas.filter(v => v.sucursal === "Polanco");
  const vRuta = ventas.filter(v => v.canal === "Ruta");
  const total = _resumenVentas(ventas);
  const cuaji = _resumenVentas(vCuaji);
  const polanco = _resumenVentas(vPolanco);
  const ruta = _resumenVentas(vRuta);
  S.ventasPorSeccion = { total: ventas, cuaji: vCuaji, polanco: vPolanco, ruta: vRuta };
  S.pieEstado = { total: [], cuaji: [], polanco: [], ruta: [] };
  L("periodo-content").innerHTML =
    _tarjetaResumen("🏢 Total empresa", total, "var(--accent)", "total", ventas) +
    _tarjetaResumen("🍰 Cuajimalpa", cuaji, "var(--green)", "cuaji", vCuaji) +
    _tarjetaResumen("🍰 Polanco", polanco, "var(--accent)", "polanco", vPolanco) +
    _tarjetaResumen("🚚 Ruta", ruta, "#C8602A", "ruta", vRuta) +
    _chipsPivotModo() +
    _bloquePivotsReporte(ventas, vCuaji, vPolanco) +
    `<div style="height:6px;background:linear-gradient(90deg,transparent,var(--border),transparent);border-radius:3px;margin:18px 0"></div>` +
    `<div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;margin-bottom:10px;text-transform:uppercase;text-align:center">Análisis gráfico (drill-down)</div>` +
    _tarjetaPie("Total empresa", "var(--accent)", "total") +
    _tarjetaPie("Cuajimalpa", "var(--green)", "cuaji") +
    _tarjetaPie("Polanco", "var(--accent)", "polanco") +
    _tarjetaPie("Ruta", "#C8602A", "ruta");
  setTimeout(() => {
    ["total", "cuaji", "polanco", "ruta"].forEach(secId => renderPiesSeccion(secId));
  }, 50);
}
let _chartLineaPeriodo = null;
function _renderGraficaLineaPeriodo(ventas) {
  const ctx = L("grafica-linea-periodo");
  if (!ctx) return;
  let ini, fin;
  if (S.periodoActual.preset === "custom") {
    const d = L("periodo-desde").value, h = L("periodo-hasta").value;
    ini = d ? new Date(d + "T00:00:00") : null;
    fin = h ? new Date(h + "T23:59:59") : null;
  } else {
    ini = new Date(S.periodoActual.desde);
    fin = new Date(S.periodoActual.hasta);
  }
  if (!ini || !fin) return;
  const dias = [];
  const cur = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate());
  while (cur <= fin) {
    dias.push(_fmtFecha(cur));
    cur.setDate(cur.getDate() + 1);
  }
  const acc = {};
  dias.forEach(d => acc[d] = { total: 0, cuaji: 0, polanco: 0, ruta: 0, totalU: 0, cuajiU: 0, polancoU: 0, rutaU: 0 });
  ventas.forEach(v => {
    const fechaStr = String(v.fecha).substring(0, 10);
    if (!acc[fechaStr]) return;
    const monto = Number(v.subtotal) || 0;
    const uds = Number(v.cantidad) || 0;
    acc[fechaStr].total += monto; acc[fechaStr].totalU += uds;
    if (v.canal === "Ruta") { acc[fechaStr].ruta += monto; acc[fechaStr].rutaU += uds; }
    else if (v.sucursal === "Cuajimalpa") { acc[fechaStr].cuaji += monto; acc[fechaStr].cuajiU += uds; }
    else if (v.sucursal === "Polanco") { acc[fechaStr].polanco += monto; acc[fechaStr].polancoU += uds; }
  });
  let totales = dias.map(d => acc[d].total);
  let cuajis = dias.map(d => acc[d].cuaji);
  let polancos = dias.map(d => acc[d].polanco);
  let rutas = dias.map(d => acc[d].ruta);
  let totalesU = dias.map(d => acc[d].totalU);
  let cuajisU = dias.map(d => acc[d].cuajiU);
  let polancosU = dias.map(d => acc[d].polancoU);
  let rutasU = dias.map(d => acc[d].rutaU);
  if (S.periodoActual.modoLinea === "acumulado") {
    let sT = 0, sC = 0, sP = 0, sR = 0;
    totales = totales.map(x => sT += x);
    cuajis = cuajis.map(x => sC += x);
    polancos = polancos.map(x => sP += x);
    rutas = rutas.map(x => sR += x);
    let sTu = 0, sCu = 0, sPu = 0, sRu = 0;
    totalesU = totalesU.map(x => sTu += x);
    cuajisU = cuajisU.map(x => sCu += x);
    polancosU = polancosU.map(x => sPu += x);
    rutasU = rutasU.map(x => sRu += x);
  }
  const unidadesPorLabel = { "Total": totalesU, "Cuajimalpa": cuajisU, "Polanco": polancosU, "Ruta": rutasU };
  if (_chartLineaPeriodo) { try { _chartLineaPeriodo.destroy(); } catch(e) {} }
  _chartLineaPeriodo = new Chart(ctx, {
    type: "line",
    data: {
      labels: dias.map(d => { const p = d.split('-'); return p[2] + '-' + p[1]; }),
      datasets: [
        { label: "Total", data: totales, borderColor: "#C8602A", backgroundColor: "rgba(200,96,42,.1)", tension: 0.3, fill: false, borderWidth: 3 },
        { label: "Cuajimalpa", data: cuajis, borderColor: "#2E5C4A", backgroundColor: "rgba(46,92,74,.1)", tension: 0.3, fill: false, borderWidth: 2 },
        { label: "Polanco", data: polancos, borderColor: "#1976D2", backgroundColor: "rgba(25,118,210,.1)", tension: 0.3, fill: false, borderWidth: 2 },
        { label: "Ruta", data: rutas, borderColor: "#C8602A", backgroundColor: "rgba(200,96,42,.1)", tension: 0.3, fill: false, borderWidth: 2 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", labels: { font: { size: 12 }, boxWidth: 14 } },
        tooltip: { callbacks: { label: (ctx) => {
          const uds = unidadesPorLabel[ctx.dataset.label]?.[ctx.dataIndex] ?? 0;
          return `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString('es-MX')} · ${uds} piezas`;
        }}}
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 60 } },
        y: { ticks: { callback: (v) => "$" + v.toLocaleString('es-MX'), font: { size: 11 } } }
      }
    }
  });
}
async function iniciarRuta() {
  if (!S.catalogo) await cargarCatalogo();
  await cargarStock();
  const inp = L("ruta-fecha");
  if (inp && !inp.value) {
    const m = new Date();
    m.setDate(m.getDate() + 1);
    inp.value = `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}-${String(m.getDate()).padStart(2,'0')}`;
  }
  poblarSelectoresRuta();
  renderTartasParada();
  renderParadasRuta();
}
function poblarSelectoresRuta() {
  if (!S.stock || !S.catalogo) return;
  const stockCuaji = (S.stock || []).filter(s => s.sucursal === "Cuajimalpa" && s.cantActual > 0);
  const sabores = [...new Set(stockCuaji.map(s => s.sabor))].sort();
  const selS = L("ruta-tarta-sabor");
  if (sabores.length === 0) {
    selS.innerHTML = '<option value="">— Sin stock en Cuajimalpa —</option>';
    selS.disabled = true;
    L("ruta-tarta-tamano").innerHTML = '<option value="">—</option>';
    L("ruta-tarta-tamano").disabled = true;
    return;
  }
  selS.disabled = false;
  const sabActual = selS.value;
  selS.innerHTML = sabores.map(s => `<option value="${s}">${s}</option>`).join("");
  if (sabores.includes(sabActual)) selS.value = sabActual;
  onRutaSaborChange();
}
function onRutaSaborChange() {
  if (!S.stock) return;
  const sabor = L("ruta-tarta-sabor")?.value;
  if (!sabor) return;
  const stockSab = (S.stock || []).filter(s => s.sucursal === "Cuajimalpa" && s.sabor === sabor && s.cantActual > 0);
  const tamanos = [...new Set(stockSab.map(s => s.tamano))];
  const selT = L("ruta-tarta-tamano");
  if (tamanos.length === 0) {
    selT.innerHTML = '<option value="">— sin stock —</option>';
    selT.disabled = true;
  } else {
    selT.disabled = false;
    selT.innerHTML = tamanos.map(t => `<option value="${t}">${t}</option>`).join("");
  }
  onRutaTamanoChange();
}
function onRutaTamanoChange() {
  const sabor = L("ruta-tarta-sabor")?.value;
  const tamano = L("ruta-tarta-tamano")?.value;
  const selC = L("ruta-tarta-cantidad");
  if (!sabor || !tamano) {
    selC.innerHTML = '<option value="">— selecciona sabor y tamaño —</option>';
    selC.disabled = true;
    L("ruta-tarta-disp").innerHTML = "";
    return;
  }
  const enStock = (S.stock || []).filter(s => s.sucursal === "Cuajimalpa" && s.sabor === sabor && s.tamano === tamano && s.cantActual > 0).reduce((a, s) => a + s.cantActual, 0);
  const enParadasYaAgregadas = (S.ruta.paradas || []).reduce((a, p) => a + (p.items || []).filter(i => i.sabor === sabor && i.tamano === tamano).reduce((b, i) => b + i.cantidad, 0), 0);
  const enParadaActual = (S.ruta.tartasActuales || []).filter(t => t.sabor === sabor && t.tamano === tamano).reduce((a, t) => a + t.cantidad, 0);
  const disp = Math.max(0, enStock - enParadasYaAgregadas - enParadaActual);
  if (disp <= 0) {
    selC.innerHTML = '<option value="">Sin stock disponible</option>';
    selC.disabled = true;
    L("ruta-tarta-disp").innerHTML = '<span class="disp-badge disp-out">Sin stock</span>';
    return;
  }
  selC.innerHTML = Array.from({length: disp}, (_, i) => i + 1).map(n => `<option value="${n}">${n}</option>`).join("");
  selC.disabled = false;
  L("ruta-tarta-disp").innerHTML = `<span class="disp-badge ${disp <= 2 ? 'disp-low' : 'disp-ok'}">${disp} disponibles</span>`;
}
function rutaAgregarTarta() {
  const sabor = L("ruta-tarta-sabor")?.value;
  const tamano = L("ruta-tarta-tamano")?.value;
  const cantidad = parseInt(L("ruta-tarta-cantidad")?.value) || 0;
  if (!sabor || !tamano || cantidad <= 0) { toast("Completa los datos de la tarta", "error"); return; }
  S.ruta.tartasActuales.push({ sabor, tamano, cantidad });
  renderTartasParada();
  onRutaTamanoChange();
}
function renderTartasParada() {
  const tartas = S.ruta.tartasActuales || [];
  const el = L("ruta-tartas-parada");
  if (tartas.length === 0) { el.innerHTML = ""; return; }
  el.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">Tartas de esta parada:</div>' + tartas.map((t, i) =>
    `<div style="display:flex;justify-content:space-between;background:white;padding:6px 10px;border-radius:8px;margin-bottom:4px;font-size:13px">
      <span><strong>${t.cantidad}</strong> × ${t.sabor} ${t.tamano}</span>
      <button onclick="rutaQuitarTarta(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px">×</button>
    </div>`).join("");
}
function rutaQuitarTarta(idx) {
  S.ruta.tartasActuales.splice(idx, 1);
  renderTartasParada();
  onRutaTamanoChange();
}
function rutaAgregarParada() {
  const nombre = L("ruta-cli-nombre").value.trim();
  const telefono = L("ruta-cli-tel").value.trim();
  const tartas = S.ruta.tartasActuales || [];
  if (!nombre) { toast("El nombre del cliente es obligatorio", "error"); return; }
  if (tartas.length === 0) { toast("Agrega al menos una tarta", "error"); return; }
  S.ruta.paradas.push({
    id: "P-" + Date.now(),
    nombre, telefono,
    items: tartas.slice()
  });
  L("ruta-cli-nombre").value = "";
  L("ruta-cli-tel").value = "";
  S.ruta.tartasActuales = [];
  renderTartasParada();
  renderParadasRuta();
  poblarSelectoresRuta();
  toast(`✅ Parada ${S.ruta.paradas.length} agregada: ${nombre}`);
}
function renderParadasRuta() {
  const paradas = S.ruta.paradas || [];
  const el = L("ruta-paradas-list");
  const btn = L("btn-ruta-confirmar");
  if (paradas.length === 0) {
    el.innerHTML = '<div class="carrito-vacio">Sin paradas todavía — agrega arriba</div>';
    btn.textContent = "Confirmar ruta (0 paradas)";
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  btn.textContent = `Confirmar ruta (${paradas.length} parada${paradas.length !== 1 ? 's' : ''})`;
  const totalTartas = paradas.reduce((s, p) => s + p.items.reduce((a, i) => a + i.cantidad, 0), 0);
  el.innerHTML = paradas.map((p, i) =>
    `<div style="background:var(--warm);border-radius:12px;padding:12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div>
          <div style="font-weight:700;font-size:14px">${i+1}. ${p.nombre}</div>
          <div style="font-size:11px;color:var(--muted)">📞 ${p.telefono}</div>
        </div>
        <button onclick="rutaQuitarParada(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:18px;padding:0 4px">×</button>
      </div>
      <div style="font-size:12px;color:var(--ink)">${p.items.map(it => `${it.cantidad}× ${it.sabor} ${it.tamano}`).join(" · ")}</div>
    </div>`).join("") +
    `<div style="background:var(--ink);color:white;border-radius:10px;padding:10px 14px;font-size:13px;margin-top:6px">
      <strong>${paradas.length}</strong> parada${paradas.length !== 1 ? 's' : ''} · <strong>${totalTartas}</strong> tarta${totalTartas !== 1 ? 's' : ''} totales
    </div>`;
}
function rutaQuitarParada(idx) {
  if (!confirm("¿Quitar esta parada de la ruta?")) return;
  S.ruta.paradas.splice(idx, 1);
  renderParadasRuta();
  poblarSelectoresRuta();
}
async function confirmarRuta() {
  const paradas = S.ruta.paradas || [];
  if (paradas.length === 0) { toast("Sin paradas en la ruta", "error"); return; }
  const fechaInput = L("ruta-fecha").value;
  if (!fechaInput) { toast("Selecciona la fecha de la ruta", "error"); return; }
  const btn = L("btn-ruta-confirmar");
  btn.disabled = true; btn.textContent = "Registrando ruta...";
  const rutaId = "RUTA-" + Date.now();
  let exitosos = 0, fallidos = 0;
  const errores = [];
  for (let i = 0; i < paradas.length; i++) {
    const p = paradas[i];
    btn.textContent = `Registrando parada ${i+1}/${paradas.length}...`;
    const items = p.items.map(it => ({ sabor: it.sabor, tamano: it.tamano, cantidad: it.cantidad, precioUnitario: 0, descuento: 0, descTipo: "" }));
    const cliente = { nombre: p.nombre, telefono: p.telefono || "", email: "" };
    const ahoraT = new Date();
    const fechaPersonalizada = `${fechaInput}T${String(ahoraT.getHours()).padStart(2,'0')}:${String(ahoraT.getMinutes()).padStart(2,'0')}:${String(ahoraT.getSeconds()).padStart(2,'0')}`;
    try {
      const res = await api("registrarVenta", {
        items, canal: "Domicilio", metodoPago: "Por definir",
        sucursal: "Cuajimalpa", cliente, tipoOp: "venta",
        motivo: rutaId,
        fechaPersonalizada, opId: opIdNuevo()
      });
      if (res.ok) exitosos++; else { fallidos++; errores.push(`${p.nombre}: ${res.error}`); }
    } catch(e) { fallidos++; errores.push(`${p.nombre}: ${e.message}`); }
  }
  btn.disabled = false;
  btn.textContent = `Confirmar ruta (${(S.ruta.paradas||[]).length} paradas)`;
  if (fallidos === 0) {
    toast(`✅ Ruta ${rutaId} registrada: ${exitosos} paradas`);
    _resetRutaSinConfirmar();
    await cargarStock();
    setRutaTab("abiertas");
  } else {
    toast(`⚠ ${exitosos} OK, ${fallidos} con error. Ver detalles.`, "error");
    console.error("Errores ruta:", errores);
    alert("Errores en la ruta:\n" + errores.join("\n"));
  }
}
function _resetRutaSinConfirmar() {
  S.ruta = { paradas: [], tartasActuales: [] };
  if (L("ruta-cli-nombre")) L("ruta-cli-nombre").value = "";
  if (L("ruta-cli-tel")) L("ruta-cli-tel").value = "";
  renderTartasParada();
  renderParadasRuta();
  poblarSelectoresRuta();
}
function limpiarRuta() {
  if (S.ruta.paradas.length > 0 && !confirm("¿Descartar TODA la ruta? Se perderán las paradas no registradas.")) return;
  S.ruta = { paradas: [], tartasActuales: [] };
  L("ruta-cli-nombre").value = "";
  L("ruta-cli-tel").value = "";
  renderTartasParada();
  renderParadasRuta();
  poblarSelectoresRuta();
}
function setRutaTab(tab) {
  document.querySelectorAll("#tab-rutas > .costos-tabs > .costos-tab").forEach(t =>
    t.classList.toggle("active", t.getAttribute("onclick") === `setRutaTab('${tab}')`));
  ["nueva", "abiertas", "cerradas"].forEach(s =>
    L("ruta-tab-" + s).classList.toggle("active", s === tab));
  if (tab === "abiertas") cargarRutasAbiertas();
  if (tab === "cerradas") cargarRutasCerradas();
}
async function cargarRutasAbiertas() {
  const el = L("rutas-abiertas-list");
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div>Cargando rutas...</div>';
  const res = await api("getRutasAbiertas");
  if (!res.ok) { el.innerHTML = `<div class="empty-state"><div>Error: ${res.error || "sin datos"}</div></div>`; return; }
  S.rutasAbiertas = res.rutas || [];
  renderRutasAbiertas();
}
function renderRutasAbiertas() {
  const rutas = S.rutasAbiertas || [];
  const el = L("rutas-abiertas-list");
  if (rutas.length === 0) {
    el.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">✅</div><div>Sin rutas abiertas</div></div></div>';
    return;
  }
  el.innerHTML = rutas.map(r => {
    const headerColor = r.completa ? "var(--success)" : "var(--accent)";
    const headerLabel = r.completa ? "✅ Lista para archivar" : `${r.pendientes} pendiente(s)`;
    const paradasHTML = r.paradas.map(p => {
      const yaPago = p.metodoPago && p.metodoPago !== "Por definir";
      const itemsTxt = p.items.map(i => `${i.cantidad}× ${i.sabor} ${i.tamano}`).join(" · ");
      return `<div style="background:${yaPago ? 'rgba(46,92,74,.06)' : 'var(--warm)'};border-left:3px solid ${yaPago ? 'var(--success)' : 'var(--accent)'};border-radius:10px;padding:12px;margin-bottom:8px" data-ruta-id="${r.rutaId}" data-venta-id="${p.idVenta}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">
          <div style="flex:1">
            <div style="font-weight:700;font-size:13px">${p.clienteNombre || "(sin nombre)"} ${yaPago ? '<span style="font-size:10px;background:var(--success);color:white;padding:2px 8px;border-radius:6px;margin-left:6px">PAGADO</span>' : ''}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${itemsTxt}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">ID venta: <code>${p.idVenta}</code></div>
          </div>
          <div style="font-family:'Fraunces',serif;font-size:18px;color:var(--accent)">$${(p.total || 0).toLocaleString('es-MX')}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
          <label style="font-size:11px;color:var(--muted);min-width:60px">Pago:</label>
          <select class="mini-select metodo-pago-select" id="metodo-${p.idVenta}" data-venta-id="${p.idVenta}" data-original="${p.metodoPago || 'Por definir'}" style="flex:1">
            <option value="">— Por definir —</option>
            <option value="Efectivo" ${p.metodoPago === "Efectivo" ? "selected" : ""}>Efectivo</option>
            <option value="Tarjeta" ${p.metodoPago === "Tarjeta" ? "selected" : ""}>Tarjeta</option>
            <option value="Transferencia" ${p.metodoPago === "Transferencia" ? "selected" : ""}>Transferencia</option>
          </select>
        </div>
      </div>`;
    }).join("");
    const totalRuta = r.paradas.reduce((s, p) => s + (p.total || 0), 0);
    return `<div class="card" style="margin-bottom:12px;border-left:4px solid ${headerColor}" data-card-ruta="${r.rutaId}">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-weight:700;font-size:15px">🚚 ${r.rutaId}</div>
          <div style="font-size:11px;color:var(--muted)">Fecha ruta: <strong>${r.fechaRuta}</strong> · ${r.totalParadas} paradas · Total: $${totalRuta.toLocaleString('es-MX')}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:11px;font-weight:700;color:${headerColor};background:rgba(0,0,0,.04);padding:4px 10px;border-radius:12px">${headerLabel}</span>
        </div>
      </div>
      ${paradasHTML}
      <div style="display:flex;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
        <button onclick="confirmarPagosRutaBatch('${r.rutaId}')" class="btn-main" style="flex:1;background:var(--accent);margin-top:0">💾 Confirmar pagos de esta ruta</button>
        ${r.completa ? `<button onclick="archivarRutaUI('${r.rutaId}')" style="background:var(--success);color:white;border:none;border-radius:8px;padding:0 16px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer">📦 Archivar</button>` : ''}
      </div>
    </div>`;
  }).join("");
}
async function confirmarPagosRutaBatch(rutaId) {
  const card = document.querySelector(`[data-card-ruta="${rutaId}"]`);
  if (!card) return;
  const selects = card.querySelectorAll(".metodo-pago-select");
  const items = [];
  let sinCambios = 0;
  selects.forEach(sel => {
    const valor = sel.value;
    if (!valor || valor === "Por definir") return;
    const original = sel.dataset.original || "";
    if (valor === original) { sinCambios++; return; }
    items.push({ idVenta: sel.dataset.ventaId, nuevoMetodo: valor });
  });
  if (items.length === 0) {
    toast(sinCambios > 0 ? "Sin cambios para confirmar" : "Selecciona al menos un método antes de confirmar", "error");
    return;
  }
  const res = await api("actualizarMetodoVentaBatch", { items });
  if (!res.ok) { toast(res.error || "Error al actualizar", "error"); return; }
  toast(`✅ ${res.exitosos} pago(s) confirmado(s)${res.fallidos > 0 ? ` · ${res.fallidos} con error` : ''}`);
  await cargarRutasAbiertas();
  const ruta = (S.rutasAbiertas || []).find(r => r.rutaId === rutaId);
  if (ruta && ruta.completa) {
    setTimeout(() => {
      if (confirm(`✅ Todos los clientes de ${rutaId} ya pagaron. ¿Archivar la ruta?`)) {
        archivarRutaUI(rutaId);
      }
    }, 300);
  }
}
async function cargarRutasCerradas() {
  const el = L("rutas-cerradas-list");
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div>Cargando...</div>';
  const res = await api("getRutasCerradas");
  if (!res.ok) { el.innerHTML = `<div class="empty-state"><div>Error: ${res.error || "sin datos"}</div></div>`; return; }
  const rutas = res.rutas || [];
  if (rutas.length === 0) {
    el.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">📦</div><div>Sin rutas cerradas hoy</div></div></div>';
    return;
  }
  el.innerHTML = rutas.map(r => {
    const totalRuta = r.paradas.reduce((s, p) => s + (p.total || 0), 0);
    const paradasHTML = r.paradas.map(p => {
      const itemsTxt = p.items.map(i => `${i.cantidad}× ${i.sabor} ${i.tamano}`).join(" · ");
      return `<div style="background:rgba(46,92,74,.04);border-left:3px solid var(--success);border-radius:10px;padding:10px 12px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${p.clienteNombre || "(sin nombre)"}</div>
            <div style="font-size:11px;color:var(--muted)">${itemsTxt}</div>
            <div style="font-size:10px;color:var(--muted)">ID: <code>${p.idVenta}</code> · ${p.metodoPago}</div>
          </div>
          <div style="font-family:'Fraunces',serif;font-size:16px;color:var(--accent)">$${(p.total || 0).toLocaleString('es-MX')}</div>
        </div>
      </div>`;
    }).join("");
    return `<div class="card" style="margin-bottom:12px;border-left:4px solid var(--success)">
      <div style="margin-bottom:10px">
        <div style="font-weight:700;font-size:15px">📦 ${r.rutaId}</div>
        <div style="font-size:11px;color:var(--muted)">Fecha: <strong>${r.fechaRuta}</strong> · ${r.totalParadas} paradas · Total: $${totalRuta.toLocaleString('es-MX')}</div>
      </div>
      ${paradasHTML}
    </div>`;
  }).join("");
}
async function confirmarPagoRuta(rutaId, idVenta) {
  const sel = L("metodo-" + idVenta);
  if (!sel) return;
  const nuevoMetodo = sel.value || "Por definir";
  if (!nuevoMetodo || nuevoMetodo === "Por definir") {
    toast("Selecciona un método antes de confirmar", "error");
    return;
  }
  const res = await api("actualizarMetodoVenta", { idVenta, nuevoMetodo });
  if (!res.ok) { toast(res.error || "Error al actualizar", "error"); return; }
  toast(`✅ ${nuevoMetodo} confirmado`);
  await cargarRutasAbiertas();
  const ruta = (S.rutasAbiertas || []).find(r => r.rutaId === rutaId);
  if (ruta && ruta.completa) {
    setTimeout(() => {
      if (confirm(`✅ Todos los clientes de ${rutaId} ya pagaron. ¿Archivar la ruta?\n\n(Si archivas, dejará de aparecer en 'Rutas abiertas'.)`)) {
        archivarRutaUI(rutaId);
      }
    }, 300);
  }
}
async function archivarRutaUI(rutaId) {
  const res = await api("archivarRuta", { rutaId });
  if (!res.ok) { toast(res.error || "Error al archivar", "error"); return; }
  toast(`✅ Ruta ${rutaId} archivada`);
  await cargarRutasAbiertas();
}
const HORAS_APERTURA = {
  "Cuajimalpa": { abre: 9, cierra: 18 },
  "Polanco":    { abre: 11, cierra: 19 }
};
function _ventasUltimosNDias(ventas, n) {
  const hoy = new Date();
  hoy.setHours(23, 59, 59, 999);
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - n + 1);
  desde.setHours(0, 0, 0, 0);
  return ventas.filter(v => {
    if (!v.fecha) return false;
    // v3.4.16: el filtro de tipo se aplica antes en _ventasOportFiltradas
    const fv = new Date(v.fecha);
    return fv >= desde && fv <= hoy;
  });
}
function renderOportunidad() {
  const el = L("oportunidad-content");
  if (!el) return;
  if (!S.ventasReporte || !S.catalogo) {
    el.innerHTML = '<div class="card"><div class="empty-state"><div>Sin datos</div></div></div>';
    return;
  }
  let ventasBase = _ventasOportFiltradas(S.ventasReporte);
  const ventas30d = _ventasUltimosNDias(ventasBase, 30);
  if (ventas30d.length === 0) {
    el.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">📊</div><div>Sin ventas en los últimos 30 días (con los filtros aplicados)</div></div></div>';
    return;
  }
  const fechasMs = ventas30d.map(v => new Date(v.fecha).getTime());
  const fechaMin = Math.min(...fechasMs);
  const hoyMs = new Date().setHours(23, 59, 59, 999);
  const diasEfectivos = Math.max(1, Math.min(30, Math.ceil((hoyMs - fechaMin) / (24 * 3600 * 1000)) + 1));
  const agrupado = {};
  ventas30d.forEach(v => {
    const key = `${v.sucursal}|${v.sabor}|${v.tamano}`;
    const fechaStr = String(v.fecha).substring(0, 10);
    const hora = parseInt(String(v.fecha).substring(11, 13)) || 0;
    if (!agrupado[key]) agrupado[key] = { sucursal: v.sucursal, sabor: v.sabor, tamano: v.tamano, porDia: {} };
    if (!agrupado[key].porDia[fechaStr]) agrupado[key].porDia[fechaStr] = { qty: 0, lastHour: 0 };
    agrupado[key].porDia[fechaStr].qty += Number(v.cantidad) || 0;
    if (hora > agrupado[key].porDia[fechaStr].lastHour) agrupado[key].porDia[fechaStr].lastHour = hora;
  });
  const base = [];
  for (const key in agrupado) {
    const g = agrupado[key];
    const horario = HORAS_APERTURA[g.sucursal] || { abre: 10, cierra: 19 };
    const horasAbierto = horario.cierra - horario.abre;
    const dias = Object.keys(g.porDia);
    let totalReal = 0, totalPotencial = 0, diasAgotamiento = 0;
    dias.forEach(d => {
      const dato = g.porDia[d];
      totalReal += dato.qty;
      const horasConStock = Math.max(0.5, dato.lastHour - horario.abre + 1);
      const sePuedeProyectar = dato.lastHour > 0 && (horario.cierra - dato.lastHour) >= 2 && dato.qty >= 2;
      if (sePuedeProyectar) {
        diasAgotamiento++;
        const tasa = dato.qty / horasConStock;
        const proyectado = tasa * horasAbierto;
        totalPotencial += proyectado;
      } else {
        totalPotencial += dato.qty;
      }
    });
    if (totalReal > 0) {
      base.push({
        sucursal: g.sucursal, sabor: g.sabor, tamano: g.tamano,
        totalReal, totalPotencial,
        promReal: totalReal / diasEfectivos,
        promPotencial: totalPotencial / diasEfectivos,
        oportunidad: Math.max(0, (totalPotencial - totalReal) / diasEfectivos),
        diasConVentas: dias.length, diasAgotamiento
      });
    }
  }
  if (base.length === 0) {
    el.innerHTML = '<div class="card"><div class="empty-state"><div>Sin oportunidades detectadas</div></div></div>';
    return;
  }
  const modo = S.oportAgrupacion || "sabor_tamano";
  const ordenTam = { "Individual": 1, "Mediana": 2, "Grande": 3 };
  const VIST_LABEL = {
    sabor_tamano: "Sabor + Tamaño",
    tamano: "Solo Tamaño",
    sabor: "Solo Sabor",
    general: "General",
    facet_tamano: "Tablas por Tamaño",
    facet_sabor: "Tablas por Sabor"
  };
  function keyAgrup(r) {
    if (modo === "tamano")  return `${r.sucursal}||${r.tamano}`;
    if (modo === "sabor")   return `${r.sucursal}|${r.sabor}|`;
    if (modo === "general") return `${r.sucursal}||`;
    return `${r.sucursal}|${r.sabor}|${r.tamano}`;
  }
  const agg = {};
  base.forEach(r => {
    const k = keyAgrup(r);
    if (!agg[k]) agg[k] = { sucursal: r.sucursal,
                            sabor: (modo === "tamano" || modo === "general") ? "—" : r.sabor,
                            tamano: (modo === "sabor"  || modo === "general") ? "—" : r.tamano,
                            promReal: 0, promPotencial: 0, oportunidad: 0,
                            diasAgotamiento: 0, diasConVentas: 0, _filas: 0 };
    agg[k].promReal      += r.promReal;
    agg[k].promPotencial += r.promPotencial;
    agg[k].oportunidad   += r.oportunidad;
    agg[k].diasAgotamiento += r.diasAgotamiento;
    agg[k].diasConVentas   = Math.max(agg[k].diasConVentas, r.diasConVentas);
    agg[k]._filas++;
  });
  const resultados = Object.values(agg);
  const headerInfo = `<div style="background:rgba(46,92,74,.08);border-left:3px solid var(--green);padding:8px 12px;border-radius:6px;font-size:12px;color:var(--ink);margin-bottom:12px">📊 <strong>Promedios sobre ${diasEfectivos} día(s)</strong> · vista: <strong>${VIST_LABEL[modo] || modo}</strong></div>`;
  function _renderTablaSimple(filas, dimKey, dimLabel) {
    filas.sort((a, b) => b.promReal - a.promReal);
    let head = `
      <thead><tr>
        <th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">${dimLabel}</th>
        <th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Venta/día</th>
        <th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Potencial/día</th>
        <th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Oportunidad</th>
        <th style="text-align:center;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Días agotó</th>
      </tr></thead>`;
    let body = "<tbody>";
    filas.forEach(r => {
      const oportColor = r.oportunidad > 0.5 ? "var(--danger)" : "var(--muted)";
      body += `<tr>
        <td style="padding:6px;border-bottom:1px solid var(--warm)">${r[dimKey]}</td>
        <td style="padding:6px;border-bottom:1px solid var(--warm);text-align:right"><strong>${r.promReal.toFixed(1)}</strong></td>
        <td style="padding:6px;border-bottom:1px solid var(--warm);text-align:right;color:var(--success)"><strong>${r.promPotencial.toFixed(1)}</strong></td>
        <td style="padding:6px;border-bottom:1px solid var(--warm);text-align:right;color:${oportColor};font-weight:700">${r.oportunidad > 0 ? '+' + r.oportunidad.toFixed(1) : '—'}</td>
        <td style="padding:6px;border-bottom:1px solid var(--warm);text-align:center;color:var(--muted)">${r.diasAgotamiento}</td>
      </tr>`;
    });
    body += "</tbody>";
    return `<table style="width:100%;border-collapse:collapse;font-size:12px">${head}${body}</table>`;
  }
  let html = headerInfo;
  ["Cuajimalpa", "Polanco"].forEach(suc => {
    const color = suc === "Cuajimalpa" ? "var(--green)" : "var(--accent)";
    if (modo === "facet_tamano" || modo === "facet_sabor") {
      const datosSuc = base.filter(r => r.sucursal === suc);
      if (datosSuc.length === 0) return;
      const facetDim   = (modo === "facet_tamano") ? "tamano" : "sabor";
      const innerDim   = (modo === "facet_tamano") ? "sabor"  : "tamano";
      const innerLabel = (innerDim === "sabor") ? "Sabor" : "Tamaño";
      const totales = {};
      datosSuc.forEach(r => {
        const k = r[facetDim];
        if (!totales[k]) totales[k] = { promReal: 0, oportunidad: 0 };
        totales[k].promReal    += r.promReal;
        totales[k].oportunidad += r.oportunidad;
      });
      const valoresFacet = Object.keys(totales).sort((a, b) => {
        if (facetDim === "tamano") {
          const oA = ordenTam[a] || 9, oB = ordenTam[b] || 9;
          if (oA !== oB) return oA - oB;
        }
        return totales[b].promReal - totales[a].promReal;
      });
      html += `<div class="card" style="margin-bottom:12px;border-left:4px solid ${color}">
        <div style="font-weight:700;font-size:16px;color:${color};margin-bottom:10px">📍 ${suc}</div>`;
      valoresFacet.forEach(val => {
        const filas = datosSuc.filter(r => r[facetDim] === val);
        if (filas.length === 0) return;
        const subTotalReal = filas.reduce((s,r)=>s+r.promReal,0);
        const subTotalOpor = filas.reduce((s,r)=>s+r.oportunidad,0);
        html += `<div style="margin-bottom:14px;padding:10px 12px;background:var(--warm);border-radius:8px">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap">
            <div style="font-weight:700;font-size:14px;color:var(--accent);text-transform:uppercase;letter-spacing:.06em">${(facetDim==="tamano"?"🍰 ":"🎂 ")}${val}</div>
            <div style="font-size:11px;color:var(--muted)">Total ${val.toLowerCase()}: <strong>${subTotalReal.toFixed(1)}</strong> ventas/día · oportunidad <strong style="color:${subTotalOpor>0.5?'var(--danger)':'var(--muted)'}">${subTotalOpor>0?'+'+subTotalOpor.toFixed(1):'—'}</strong></div>
          </div>
          ${_renderTablaSimple(filas, innerDim, innerLabel)}
        </div>`;
      });
      html += `<div style="font-size:11px;color:var(--muted);margin-top:8px">
        <strong>Cálculo:</strong> Venta real = ventas últimos 30 días ÷ días con datos. Potencial = si la última venta del día fue ≥2h antes del cierre Y hubo ≥2 ventas, se proyecta. Cada tabla = un ${facetDim === "tamano" ? "tamaño" : "sabor"} con filas por ${innerDim === "sabor" ? "sabor" : "tamaño"}.
      </div></div>`;
      return;
    }
    const datos = resultados.filter(r => r.sucursal === suc);
    if (datos.length === 0) return;
    datos.sort((a, b) => b.promReal - a.promReal);
    const showSabor = (modo === "sabor_tamano" || modo === "sabor");
    const showTamano = (modo === "sabor_tamano" || modo === "tamano");
    let theadCells = "";
    if (showSabor)  theadCells += `<th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Sabor</th>`;
    if (showTamano) theadCells += `<th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Tamaño</th>`;
    if (!showSabor && !showTamano) theadCells += `<th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Vista</th>`;
    theadCells += `
          <th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Venta/día</th>
          <th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Potencial/día</th>
          <th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Oportunidad</th>
          <th style="text-align:center;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Días agotó</th>`;
    html += `<div class="card" style="margin-bottom:12px;border-left:4px solid ${color}">
      <div style="font-weight:700;font-size:16px;color:${color};margin-bottom:10px">📍 ${suc}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>${theadCells}</tr></thead><tbody>`;
    datos.forEach(r => {
      const oportColor = r.oportunidad > 0.5 ? "var(--danger)" : "var(--muted)";
      let rowCells = "";
      if (showSabor)  rowCells += `<td style="padding:6px;border-bottom:1px solid var(--warm)">${r.sabor}</td>`;
      if (showTamano) rowCells += `<td style="padding:6px;border-bottom:1px solid var(--warm);color:var(--muted)">${r.tamano}</td>`;
      if (!showSabor && !showTamano) rowCells += `<td style="padding:6px;border-bottom:1px solid var(--warm);color:var(--muted)">Total ${suc}</td>`;
      rowCells += `
        <td style="padding:6px;border-bottom:1px solid var(--warm);text-align:right"><strong>${r.promReal.toFixed(1)}</strong></td>
        <td style="padding:6px;border-bottom:1px solid var(--warm);text-align:right;color:var(--success)"><strong>${r.promPotencial.toFixed(1)}</strong></td>
        <td style="padding:6px;border-bottom:1px solid var(--warm);text-align:right;color:${oportColor};font-weight:700">${r.oportunidad > 0 ? '+' + r.oportunidad.toFixed(1) : '—'}</td>
        <td style="padding:6px;border-bottom:1px solid var(--warm);text-align:center;color:var(--muted)">${r.diasAgotamiento}</td>`;
      html += `<tr>${rowCells}</tr>`;
    });
    html += `</tbody></table>
      <div style="font-size:11px;color:var(--muted);margin-top:8px">
        <strong>Cálculo:</strong> Venta real = ventas últimos 30 días ÷ días con datos. Potencial = si la última venta del día fue ≥2h antes del cierre Y hubo ≥2 ventas, se proyecta usando la tasa de venta de las horas con stock × horas totales abierto.
      </div>
    </div>`;
  });
  el.innerHTML = html;
}
const METODOS_CONCI = ["Efectivo", "Tarjeta", "Transferencia", "Rappi", "Uber Eats", "Por definir"];
const COLOR_METODO = {
  "Efectivo":      "#2E7D32",
  "Tarjeta":       "#1565C0",
  "Transferencia": "#6A1B9A",
  "Rappi":         "#E91E63",
  "Uber Eats":     "#000000",
  "Por definir":   "#C0392B"
};
async function cargarConciliacion() {
  L("conciliacion-content").innerHTML = '<div class="loading"><div class="spinner"></div>Cargando...</div>';
  if (!S.catalogo) { const c = await api("getCatalogo"); if (c.ok) S.catalogo = c; }
  if (!S.ventasReporte || S.ventasReporte.length === 0) {
    const res = await api("getVentas");
    if (!res.ok) { L("conciliacion-content").innerHTML = '<div class="empty-state"><div>Error al cargar ventas</div></div>'; return; }
    S.ventasReporte = res.ventas || [];
  }
  if (!L("conci-desde").value) {
    const hoy = _hoyCDMXString();
    L("conci-desde").value = hoy;
    L("conci-hasta").value = hoy;
  }
  _renderFiltrosConci(); // v3.4.16
  renderConciliacion();
}
function _renderFiltrosConci() {
  if (!S.conciFiltros) S.conciFiltros = { tipos: ["venta"] };
  _renderChipsTipo("conci-filtros-tipo", S.conciFiltros, "toggleFiltroConci");
}
function toggleFiltroConci(tipo, valor) {
  if (!S.conciFiltros) S.conciFiltros = { tipos: ["venta"] };
  const arr = S.conciFiltros[tipo];
  const idx = arr.indexOf(valor);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(valor);
  _renderFiltrosConci();
  renderConciliacion();
}
function setConciPreset(preset) {
  document.querySelectorAll('[id^="conci-preset-"]').forEach(c => c.classList.remove("active"));
  L("conci-preset-" + preset).classList.add("active");
  const hoy = new Date();
  const fmt = (d) => {
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  };
  let desde, hasta;
  if (preset === "hoy") { desde = fmt(hoy); hasta = fmt(hoy); }
  else if (preset === "ayer") { const a = new Date(hoy); a.setDate(a.getDate()-1); desde = fmt(a); hasta = fmt(a); }
  else if (preset === "7d") { const a = new Date(hoy); a.setDate(a.getDate()-6); desde = fmt(a); hasta = fmt(hoy); }
  else if (preset === "mes") { const a = new Date(hoy.getFullYear(), hoy.getMonth(), 1); desde = fmt(a); hasta = fmt(hoy); }
  L("conci-desde").value = desde;
  L("conci-hasta").value = hasta;
  renderConciliacion();
}
function _ventasEnRangoConci() {
  const d = L("conci-desde").value, h = L("conci-hasta").value;
  if (!d || !h) return [];
  const f = S.conciFiltros || { tipos: ["venta"] };
  return (S.ventasReporte || []).filter(v => {
    if (!v.fecha) return false;
    if (!(f.tipos||["venta"]).includes(_tipoOpVenta(v))) return false; // v3.4.16: filtro tipo
    const fStr = String(v.fecha).substring(0, 10);
    return fStr >= d && fStr <= h;
  });
}
function renderConciliacion() {
  const ventas = _ventasEnRangoConci();
  const desde = L("conci-desde").value, hasta = L("conci-hasta").value;
  const labelRango = desde === hasta
    ? desde.split("-").reverse().join("-")
    : `${desde.split("-").reverse().join("-")} → ${hasta.split("-").reverse().join("-")}`;
  if (ventas.length === 0) {
    L("conciliacion-content").innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">💰</div><div>Sin ventas en el rango seleccionado (${labelRango})</div></div></div>`;
    return;
  }
  const agg = {};
  const sucs = ["Cuajimalpa", "Polanco"];
  const initSuc = () => { const o = {}; METODOS_CONCI.forEach(m => o[m] = { monto:0, tickets:new Set(), piezas:0 }); return o; };
  const total = initSuc();
  sucs.forEach(suc => agg[suc] = initSuc());
  ventas.forEach(v => {
    const m = v.metodoPago || "Por definir";
    const metodoNorm = METODOS_CONCI.includes(m) ? m : "Por definir";
    const target = agg[v.sucursal];
    if (target) {
      target[metodoNorm].monto   += Number(v.subtotal) || 0;
      target[metodoNorm].piezas  += Number(v.cantidad) || 0;
      if (v.idVenta) target[metodoNorm].tickets.add(v.idVenta);
      else target[metodoNorm].tickets.add(String(v.fecha) + "|" + (v.cliente||""));
    }
    total[metodoNorm].monto   += Number(v.subtotal) || 0;
    total[metodoNorm].piezas  += Number(v.cantidad) || 0;
    if (v.idVenta) total[metodoNorm].tickets.add(v.idVenta);
    else total[metodoNorm].tickets.add(String(v.fecha) + "|" + (v.cliente||""));
  });
  let html = `<div style="background:rgba(46,92,74,.08);border-left:3px solid var(--green);padding:8px 12px;border-radius:6px;font-size:12px;color:var(--ink);margin-bottom:12px">📅 Período: <strong>${labelRango}</strong> · ${ventas.length} ventas</div>`;
  const blocks = [
    { titulo: "🏢 Total empresa", color: "var(--accent)", data: total },
    { titulo: "🍰 Cuajimalpa",    color: "var(--green)",  data: agg["Cuajimalpa"] },
    { titulo: "🍰 Polanco",       color: "var(--accent)", data: agg["Polanco"] }
  ];
  blocks.forEach(b => {
    const sumaMonto = METODOS_CONCI.reduce((s, m) => s + b.data[m].monto, 0);
    if (sumaMonto === 0) return;
    html += `<div class="card" style="margin-bottom:12px;border-left:4px solid ${b.color}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:6px">
        <div style="font-weight:700;font-size:16px;color:${b.color}">${b.titulo}</div>
        <div style="font-family:'Fraunces',serif;font-size:24px;font-weight:500;color:${b.color}">$${sumaMonto.toLocaleString('es-MX')}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr>
          <th style="text-align:left;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Método de pago</th>
          <th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Cobro cliente</th>
          <th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Ingreso neto</th>
          <th style="text-align:center;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Tickets</th>
          <th style="text-align:center;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">Piezas</th>
          <th style="text-align:right;padding:8px 6px;border-bottom:2px solid var(--border);background:var(--warm)">% del total</th>
        </tr></thead><tbody>`;
    const ordenados = [...METODOS_CONCI].sort((a, c) => b.data[c].monto - b.data[a].monto);
    ordenados.forEach(m => {
      const d = b.data[m];
      if (d.monto === 0 && d.tickets.size === 0) return;
      const pct = sumaMonto > 0 ? (d.monto / sumaMonto * 100).toFixed(1) : "0.0";
      const colorM = COLOR_METODO[m] || "var(--ink)";
      const comTarjeta = Math.abs(getComisionesActuales()["Tarjeta"] ?? 0.06);
      const ingresoNeto = (m === "Tarjeta") ? d.monto * (1 - comTarjeta) : d.monto;
      html += `<tr>
        <td style="padding:8px 6px;border-bottom:1px solid var(--warm)"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorM};margin-right:8px;vertical-align:middle"></span><strong>${m}</strong></td>
        <td style="padding:8px 6px;border-bottom:1px solid var(--warm);text-align:right;font-weight:700">$${d.monto.toLocaleString('es-MX')}</td>
        <td style="padding:8px 6px;border-bottom:1px solid var(--warm);text-align:right;color:var(--muted)">$${ingresoNeto.toLocaleString('es-MX', {maximumFractionDigits:0})}</td>
        <td style="padding:8px 6px;border-bottom:1px solid var(--warm);text-align:center;color:var(--muted)">${d.tickets.size}</td>
        <td style="padding:8px 6px;border-bottom:1px solid var(--warm);text-align:center;color:var(--muted)">${d.piezas}</td>
        <td style="padding:8px 6px;border-bottom:1px solid var(--warm);text-align:right;color:var(--muted)">${pct}%</td>
      </tr>`;
    });
    html += `</tbody></table>
      <div style="margin-top:10px;padding:8px 10px;background:var(--warm);border-radius:6px;font-size:11px;color:var(--muted)">
        <strong>Conciliación:</strong> Efectivo = lo que debe haber en caja física · Tarjeta + Transferencia = debe estar en cuenta bancaria · Rappi/Uber Eats = lo deposita la plataforma (mensual, menos comisión) · "Por definir" = ventas a domicilio sin método asignado todavía.
      </div>
    </div>`;
  });
  L("conciliacion-content").innerHTML = html;
}
// ============================================================
// FEAT-UTILIDAD v3.4.15 — Reportes de utilidad (diaria + período)
// ============================================================
async function cargarUtilDiario() {
  L("utildiario-content").innerHTML = '<div class="loading"><div class="spinner"></div>Cargando...</div>';
  if (!S.catalogo) { const c = await api("getCatalogo"); if (c.ok) S.catalogo = c; }
  if (!S.recetas || S.recetas.length === 0) { const r = await api("getRecetas"); if (r.ok) S.recetas = r.recetas; }
  if (!S.insumos || S.insumos.length === 0) { const i = await api("getInsumos"); if (i.ok) S.insumos = i.insumos; }
  const v = await api("getVentas"); if (v.ok) S.ventasReporte = v.ventas || [];
  _renderFiltrosUtilDiario();
  renderUtilDiario();
}
async function cargarUtilPeriodo() {
  if (!S.catalogo) { const c = await api("getCatalogo"); if (c.ok) S.catalogo = c; }
  if (!S.recetas || S.recetas.length === 0) { const r = await api("getRecetas"); if (r.ok) S.recetas = r.recetas; }
  if (!S.insumos || S.insumos.length === 0) { const i = await api("getInsumos"); if (i.ok) S.insumos = i.insumos; }
  L("utilperiodo-content").innerHTML = '<div class="loading"><div class="spinner"></div>Cargando...</div>';
  const v = await api("getVentas", { desde: "2020-01-01" }); // FIX histórico: traer TODO (sin el tope de 200 filas del backend)
  if (!v.ok) { L("utilperiodo-content").innerHTML = '<div class="empty-state"><div>Error al cargar ventas</div></div>'; return; }
  S.ventasReporte = v.ventas || [];
  if (!S.utilperiodoActual.desde) setUtilPeriodoPreset(S.utilperiodoActual.preset);
  else { _renderFiltrosUtilPeriodo(); renderUtilPeriodo(); }
}
function _enriquecerUtilidad(ventas) {
  if (!S.recetas || !S.insumos) return { ventasEnriquecidas: [], sinReceta: 0 };
  const insumosIdx = {};
  S.insumos.forEach(i => insumosIdx[i.id] = i);
  function costoReceta(sabor, tamano) {
    const rec = S.recetas.find(r => r.sabor === sabor && r.tamano === tamano);
    if (!rec || !rec.ingredientes || rec.ingredientes.length === 0) return null;
    return rec.ingredientes.reduce((s, ing) => {
      const ins = insumosIdx[ing.insumoId];
      const cant = ins ? convertirUnidad(ing.cantidad, ing.unidad || ins.buyUnit, ins.buyUnit) : ing.cantidad;
      return s + (ins ? ins.costoPorUnidad * cant : 0);
    }, 0);
  }
  let sinReceta = 0;
  const ventasEnriquecidas = [];
  ventas.forEach(v => {
    const c = costoReceta(v.sabor, v.tamano);
    if (c === null) { sinReceta++; return; }
    const subtotal = Number(v.subtotal) || 0;
    const cantidad = Number(v.cantidad) || 0;
    const comPct = getComision(v.canal || "", v.metodoPago || "");
    const comMonto = Math.round(subtotal * comPct);
    const ingresoNeto = subtotal + comMonto;
    const costo = c * cantidad;
    const utilidad = ingresoNeto - costo;
    const margen = ingresoNeto > 0 ? (utilidad / ingresoNeto * 100) : 0;
    ventasEnriquecidas.push(Object.assign({}, v, { ingresoNeto, costo, utilidad, margen, comMonto }));
  });
  return { ventasEnriquecidas, sinReceta };
}
function _resumenUtilidad(ventas) {
  const tickets = new Set(ventas.map(v => v.idVenta));
  const piezas = ventas.reduce((s, v) => s + (Number(v.cantidad) || 0), 0);
  const ingreso = ventas.reduce((s, v) => s + v.ingresoNeto, 0);
  const costo = ventas.reduce((s, v) => s + v.costo, 0);
  const utilidad = ingreso - costo;
  const margen = ingreso > 0 ? (utilidad / ingreso * 100) : 0;
  function dim(campo) {
    const o = {};
    ventas.forEach(v => {
      const k = v[campo] || "(sin)";
      if (!o[k]) o[k] = { piezas: 0, ingreso: 0, costo: 0, utilidad: 0 };
      o[k].piezas += Number(v.cantidad) || 0;
      o[k].ingreso += v.ingresoNeto;
      o[k].costo += v.costo;
      o[k].utilidad += v.utilidad;
    });
    return o;
  }
  return {
    tickets: tickets.size, piezas, ingreso, costo, utilidad, margen,
    porTamano: dim("tamano"), porCanal: dim("canal"), porSabor: dim("sabor")
  };
}
function _tarjetaResumenUtilidad(titulo, r, color) {
  function dimRow(obj, ordenarPorUtilidad) {
    let keys = Object.keys(obj || {});
    if (keys.length === 0) return "";
    if (ordenarPorUtilidad) keys.sort((a, b) => obj[b].utilidad - obj[a].utilidad);
    else keys.sort();
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">` + keys.map(k => {
      const d = obj[k];
      const margen = d.ingreso > 0 ? (d.utilidad / d.ingreso * 100) : 0;
      const colU = d.utilidad >= 0 ? "var(--success)" : "var(--danger)";
      return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--warm);font-size:12px">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:6px">${k} <span style="color:var(--muted);font-size:11px">(${d.piezas} pz)</span></span>
        <span style="white-space:nowrap"><strong style="color:${colU}">$${Math.round(d.utilidad).toLocaleString('es-MX')}</strong> · ${margen.toFixed(1)}%</span>
      </div>`;
    }).join("") + `</div>`;
  }
  const colorU = r.utilidad >= 0 ? color : "var(--danger)";
  const colorMargen = r.margen >= 50 ? "var(--success)" : r.margen >= 30 ? "var(--warning)" : "var(--danger)";
  return `<div class="card" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-weight:700;font-size:16px">${titulo}</div>
      <div style="font-family:'Fraunces',serif;font-size:32px;font-weight:500;color:${colorU}">$${Math.round(r.utilidad).toLocaleString('es-MX')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="summary-card" style="padding:10px"><div class="summary-num" style="font-size:18px;color:var(--green)">$${Math.round(r.ingreso).toLocaleString('es-MX')}</div><div class="summary-label">Ingreso neto</div></div>
      <div class="summary-card" style="padding:10px"><div class="summary-num" style="font-size:18px;color:var(--muted)">$${Math.round(r.costo).toLocaleString('es-MX')}</div><div class="summary-label">Costo recetas</div></div>
      <div class="summary-card" style="padding:10px"><div class="summary-num" style="font-size:22px;color:${colorMargen}">${r.margen.toFixed(1)}%</div><div class="summary-label">Margen</div></div>
      <div class="summary-card" style="padding:10px"><div class="summary-num" style="font-size:22px">${r.tickets}</div><div class="summary-label">Tickets</div></div>
    </div>
    ${Object.keys(r.porTamano).length ? `<div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;margin-bottom:6px;text-transform:uppercase">Por tamaño</div>${dimRow(r.porTamano, false)}` : ""}
    ${Object.keys(r.porCanal).length ? `<div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;margin-bottom:6px;margin-top:12px;text-transform:uppercase">Por canal</div>${dimRow(r.porCanal, false)}` : ""}
    ${Object.keys(r.porSabor).length ? `<div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;margin-bottom:6px;margin-top:12px;text-transform:uppercase">Por sabor</div>${dimRow(r.porSabor, true)}` : ""}
  </div>`;
}
function _renderFiltrosUtilDiario() {
  const sabores = (S.catalogo?.sabores || []).filter(s => s.activo).map(s => s.nombre);
  const tamanos = (S.catalogo?.tamanos || []).filter(t => t.activo).map(t => t.nombre);
  const canales = ["Tienda", "Domicilio", "Rappi", "Uber Eats"];
  const f = S.utildiarioFiltros;
  L("utildiario-filtros-sabor").innerHTML  = sabores.map(s => `<div class="chip ${f.sabores.includes(s) ? 'active' : ''}" onclick="toggleFiltroUtilDiario('sabores','${s}')">${s}</div>`).join("");
  L("utildiario-filtros-tamano").innerHTML = tamanos.map(t => `<div class="chip ${f.tamanos.includes(t) ? 'active' : ''}" onclick="toggleFiltroUtilDiario('tamanos','${t}')">${t}</div>`).join("");
  L("utildiario-filtros-canal").innerHTML  = canales.map(c => `<div class="chip ${f.canales.includes(c) ? 'active' : ''}" onclick="toggleFiltroUtilDiario('canales','${c}')">${c}</div>`).join("");
  _renderChipsTipo("utildiario-filtros-tipo", f, "toggleFiltroUtilDiario"); // v3.4.16
}
function toggleFiltroUtilDiario(tipo, valor) {
  const arr = S.utildiarioFiltros[tipo];
  const idx = arr.indexOf(valor);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(valor);
  _renderFiltrosUtilDiario();
  renderUtilDiario();
}
function renderUtilDiario() {
  const hoyStr = _hoyCDMXString();
  const f = S.utildiarioFiltros;
  const ventasHoyBruto = (S.ventasReporte || []).filter(v => {
    if (!v.fecha) return false;
    if (!(f.tipos||["venta"]).includes(_tipoOpVenta(v))) return false; // v3.4.16: filtro tipo
    if (!String(v.fecha).startsWith(hoyStr)) return false;
    if (f.sabores.length && !f.sabores.includes(v.sabor)) return false;
    if (f.tamanos.length && !f.tamanos.includes(v.tamano)) return false;
    if (f.canales.length && !f.canales.includes(v.canal)) return false;
    return true;
  });
  const ahora = new Date();
  L("utildiario-fecha").innerHTML = `📅 Hoy: <strong>${hoyStr.split('-').reverse().join('-')}</strong> · Actualizado ${String(ahora.getHours()).padStart(2,'0')}:${String(ahora.getMinutes()).padStart(2,'0')} hrs`;
  if (ventasHoyBruto.length === 0) {
    L("utildiario-content").innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">💎</div><div>Sin ventas hoy${(f.sabores.length || f.tamanos.length || f.canales.length) ? ' (con los filtros aplicados)' : ''}</div></div></div>`;
    return;
  }
  const enrTotal   = _enriquecerUtilidad(ventasHoyBruto);
  const enrCuaji   = _enriquecerUtilidad(ventasHoyBruto.filter(v => v.sucursal === "Cuajimalpa"));
  const enrPolanco = _enriquecerUtilidad(ventasHoyBruto.filter(v => v.sucursal === "Polanco"));
  const aviso = enrTotal.sinReceta > 0
    ? `<div style="background:rgba(231,126,34,.1);border-left:3px solid var(--warning);padding:8px 12px;border-radius:6px;font-size:12px;color:var(--ink);margin-bottom:12px">⚠️ <strong>${enrTotal.sinReceta}</strong> línea(s) de venta sin receta cargada — excluidas del cálculo. Cárgalas en Costos › Recetas para que cuenten.</div>`
    : "";
  L("utildiario-content").innerHTML = aviso +
    _tarjetaResumenUtilidad("🏢 Total empresa", _resumenUtilidad(enrTotal.ventasEnriquecidas),   "var(--accent)") +
    _tarjetaResumenUtilidad("🍰 Cuajimalpa",    _resumenUtilidad(enrCuaji.ventasEnriquecidas),   "var(--green)") +
    _tarjetaResumenUtilidad("🍰 Polanco",       _resumenUtilidad(enrPolanco.ventasEnriquecidas), "var(--accent)");
}
function _renderFiltrosUtilPeriodo() {
  const sabores = (S.catalogo?.sabores || []).filter(s => s.activo).map(s => s.nombre);
  const tamanos = (S.catalogo?.tamanos || []).filter(t => t.activo).map(t => t.nombre);
  const canales = ["Tienda", "Domicilio", "Rappi", "Uber Eats"];
  const f = S.utilperiodoFiltros;
  if (L("utilperiodo-filtros-sabor"))  L("utilperiodo-filtros-sabor").innerHTML  = sabores.map(s => `<div class="chip ${f.sabores.includes(s) ? 'active' : ''}" onclick="toggleFiltroUtilPeriodo('sabores','${s}')">${s}</div>`).join("");
  if (L("utilperiodo-filtros-tamano")) L("utilperiodo-filtros-tamano").innerHTML = tamanos.map(t => `<div class="chip ${f.tamanos.includes(t) ? 'active' : ''}" onclick="toggleFiltroUtilPeriodo('tamanos','${t}')">${t}</div>`).join("");
  if (L("utilperiodo-filtros-canal"))  L("utilperiodo-filtros-canal").innerHTML  = canales.map(c => `<div class="chip ${f.canales.includes(c) ? 'active' : ''}" onclick="toggleFiltroUtilPeriodo('canales','${c}')">${c}</div>`).join("");
  _renderChipsTipo("utilperiodo-filtros-tipo", f, "toggleFiltroUtilPeriodo"); // v3.4.16
}
function toggleFiltroUtilPeriodo(tipo, valor) {
  const arr = S.utilperiodoFiltros[tipo];
  const idx = arr.indexOf(valor);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(valor);
  renderUtilPeriodo();
}
function setUtilPeriodoPreset(preset) {
  S.utilperiodoActual.preset = preset;
  document.querySelectorAll("#utilperiodo-presets .chip").forEach(c =>
    c.classList.toggle("active", c.dataset.preset === preset));
  const customRow = L("utilperiodo-custom-row");
  if (customRow) customRow.style.display = preset === "custom" ? "grid" : "none";
  if (preset !== "custom") {
    const r = _calcularRangoPreset(preset);
    S.utilperiodoActual.desde = r.ini;
    S.utilperiodoActual.hasta = r.fin;
    if (L("utilperiodo-desde")) L("utilperiodo-desde").value = _fmtFecha(r.ini);
    if (L("utilperiodo-hasta")) L("utilperiodo-hasta").value = _fmtFecha(r.fin);
  } else {
    const r = _calcularRangoPreset("semana");
    if (L("utilperiodo-desde") && !L("utilperiodo-desde").value) L("utilperiodo-desde").value = _fmtFecha(r.ini);
    if (L("utilperiodo-hasta") && !L("utilperiodo-hasta").value) L("utilperiodo-hasta").value = _fmtFecha(r.fin);
  }
  renderUtilPeriodo();
}
function setUtilModoLinea(modo) {
  S.utilperiodoActual.modoLinea = modo;
  L("utilperiodo-modo-dia-btn").classList.toggle("active", modo === "dia");
  L("utilperiodo-modo-acum-btn").classList.toggle("active", modo === "acumulado");
  renderUtilPeriodo();
}
function _ventasUtilPeriodoFiltradas() {
  let ini, fin;
  if (S.utilperiodoActual.preset === "custom") {
    const d = L("utilperiodo-desde").value, h = L("utilperiodo-hasta").value;
    ini = d ? new Date(d + "T00:00:00") : null;
    fin = h ? new Date(h + "T23:59:59") : null;
  } else {
    ini = S.utilperiodoActual.desde;
    fin = S.utilperiodoActual.hasta;
  }
  const f = S.utilperiodoFiltros;
  return (S.ventasReporte || []).filter(v => {
    if (!v.fecha) return false;
    if (!(f.tipos||["venta"]).includes(_tipoOpVenta(v))) return false; // v3.4.16: filtro tipo
    const fv = new Date(v.fecha);
    if (ini && fv < ini) return false;
    if (fin && fv > fin) return false;
    if (f.sabores.length && !f.sabores.includes(v.sabor)) return false;
    if (f.tamanos.length && !f.tamanos.includes(v.tamano)) return false;
    if (f.canales.length && !f.canales.includes(v.canal)) return false;
    return true;
  });
}
function renderUtilPeriodo() {
  _renderFiltrosUtilPeriodo();
  const ventasBruto = _ventasUtilPeriodoFiltradas();
  const desde = S.utilperiodoActual.preset === "custom"
    ? (L("utilperiodo-desde")?.value || "—")
    : _fmtFecha(S.utilperiodoActual.desde);
  const hasta = S.utilperiodoActual.preset === "custom"
    ? (L("utilperiodo-hasta")?.value || "—")
    : _fmtFecha(S.utilperiodoActual.hasta);
  L("utilperiodo-rango-label").innerHTML = `📅 Rango: <strong>${desde.split('-').reverse().join('-')}</strong> → <strong>${hasta.split('-').reverse().join('-')}</strong> · ${ventasBruto.length} ventas filtradas`;
  _renderGraficaLineaUtilPeriodo(ventasBruto);
  if (ventasBruto.length === 0) {
    L("utilperiodo-content").innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">💎</div><div>Sin ventas en este período</div></div></div>';
    return;
  }
  const enrTotal   = _enriquecerUtilidad(ventasBruto);
  const enrCuaji   = _enriquecerUtilidad(ventasBruto.filter(v => v.sucursal === "Cuajimalpa"));
  const enrPolanco = _enriquecerUtilidad(ventasBruto.filter(v => v.sucursal === "Polanco"));
  const aviso = enrTotal.sinReceta > 0
    ? `<div style="background:rgba(231,126,34,.1);border-left:3px solid var(--warning);padding:8px 12px;border-radius:6px;font-size:12px;color:var(--ink);margin-bottom:12px">⚠️ <strong>${enrTotal.sinReceta}</strong> línea(s) de venta sin receta cargada — excluidas del cálculo.</div>`
    : "";
  L("utilperiodo-content").innerHTML = aviso +
    _tarjetaResumenUtilidad("🏢 Total empresa", _resumenUtilidad(enrTotal.ventasEnriquecidas),   "var(--accent)") +
    _tarjetaResumenUtilidad("🍰 Cuajimalpa",    _resumenUtilidad(enrCuaji.ventasEnriquecidas),   "var(--green)") +
    _tarjetaResumenUtilidad("🍰 Polanco",       _resumenUtilidad(enrPolanco.ventasEnriquecidas), "var(--accent)");
}
let _chartLineaUtilPeriodo = null;
function _renderGraficaLineaUtilPeriodo(ventasBruto) {
  const ctx = L("grafica-linea-utilperiodo");
  if (!ctx) return;
  let ini, fin;
  if (S.utilperiodoActual.preset === "custom") {
    const d = L("utilperiodo-desde").value, h = L("utilperiodo-hasta").value;
    ini = d ? new Date(d + "T00:00:00") : null;
    fin = h ? new Date(h + "T23:59:59") : null;
  } else {
    ini = new Date(S.utilperiodoActual.desde);
    fin = new Date(S.utilperiodoActual.hasta);
  }
  if (!ini || !fin) return;
  const dias = [];
  const cur = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate());
  while (cur <= fin) { dias.push(_fmtFecha(cur)); cur.setDate(cur.getDate() + 1); }
  const enr = _enriquecerUtilidad(ventasBruto);
  const acc = {};
  dias.forEach(d => acc[d] = { total: 0, cuaji: 0, polanco: 0 });
  enr.ventasEnriquecidas.forEach(v => {
    const fechaStr = String(v.fecha).substring(0, 10);
    if (!acc[fechaStr]) return;
    acc[fechaStr].total += v.utilidad;
    if (v.sucursal === "Cuajimalpa")   acc[fechaStr].cuaji   += v.utilidad;
    else if (v.sucursal === "Polanco") acc[fechaStr].polanco += v.utilidad;
  });
  let totales  = dias.map(d => acc[d].total);
  let cuajis   = dias.map(d => acc[d].cuaji);
  let polancos = dias.map(d => acc[d].polanco);
  if (S.utilperiodoActual.modoLinea === "acumulado") {
    let sT = 0, sC = 0, sP = 0;
    totales  = totales.map(x  => sT += x);
    cuajis   = cuajis.map(x   => sC += x);
    polancos = polancos.map(x => sP += x);
  }
  if (_chartLineaUtilPeriodo) { try { _chartLineaUtilPeriodo.destroy(); } catch(e) {} }
  _chartLineaUtilPeriodo = new Chart(ctx, {
    type: "line",
    data: {
      labels: dias.map(d => { const p = d.split('-'); return p[2] + '-' + p[1]; }),
      datasets: [
        { label: "Total",      data: totales,  borderColor: "#C8602A", backgroundColor: "rgba(200,96,42,.1)", tension: 0.3, fill: false, borderWidth: 3 },
        { label: "Cuajimalpa", data: cuajis,   borderColor: "#2E5C4A", backgroundColor: "rgba(46,92,74,.1)",  tension: 0.3, fill: false, borderWidth: 2 },
        { label: "Polanco",    data: polancos, borderColor: "#1976D2", backgroundColor: "rgba(25,118,210,.1)", tension: 0.3, fill: false, borderWidth: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", labels: { font: { size: 12 }, boxWidth: 14 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: $${Math.round(c.parsed.y).toLocaleString('es-MX')}` } }
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 60 } },
        y: { ticks: { callback: (v) => "$" + v.toLocaleString('es-MX'), font: { size: 11 } } }
      }
    }
  });
}
