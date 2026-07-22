// =================================================================================
// CONTROL DE CAJA — módulo frontend (v7)
// Depende de globals de app.js: api(), toast(), getPermisos(), opIdNuevo(), L(), S, irAPane()
// =================================================================================
var CAJA = { estado: null, sucSel: null, categorias: [], permisos: {}, retiros: [] };

// ---- helpers ----
function _cajaH(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function _cajaMoney(n) { n = Number(n) || 0; var s = Math.abs(n).toFixed(2).split("."); s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); return (n < 0 ? "-$" : "$") + s[0] + "." + s[1]; }
function _cajaFecha(v) { if (!v) return ""; try { var d = new Date(v); return d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return String(v); } }
function _cajaFilesToBase64(fileList) {
  var files = Array.prototype.slice.call(fileList || []);
  return Promise.all(files.map(function (f) {
    return new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res(rd.result); }; rd.onerror = function () { res(null); }; rd.readAsDataURL(f); });
  })).then(function (arr) { return arr.filter(Boolean); });
}

// ---- modal genérico (autónomo, sin depender del CSS de modales existente) ----
function cajaModal(opts) {
  return new Promise(function (resolve) {
    var ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px";
    var m = document.createElement("div");
    m.style.cssText = "background:var(--card,#fff);color:var(--text,#222);border-radius:14px;max-width:440px;width:100%;padding:20px;max-height:90vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3)";
    var html = "<div style='font-size:16px;font-weight:700;margin-bottom:10px'>" + _cajaH(opts.titulo || "") + "</div>";
    if (opts.html) html += "<div style='margin-bottom:10px'>" + opts.html + "</div>";
    (opts.campos || []).forEach(function (c) {
      html += "<div class='form-group'><label class='form-label'>" + _cajaH(c.label) + (c.required ? " *" : "") + "</label>";
      if (c.type === "select") html += "<select class='form-select' data-k='" + c.key + "'>" + (c.options || []).map(function (o) { return "<option value='" + _cajaH(o) + "'>" + _cajaH(o) + "</option>"; }).join("") + "</select>";
      else if (c.type === "textarea") html += "<textarea class='form-input' data-k='" + c.key + "' rows='2' placeholder='" + _cajaH(c.placeholder || "") + "'>" + _cajaH(c.value || "") + "</textarea>";
      else if (c.type === "file") html += "<input class='form-input' type='file' data-k='" + c.key + "' accept='image/*,application/pdf' multiple>";
      else html += "<input class='form-input' type='" + (c.type || "text") + "' data-k='" + c.key + "' " + (c.min != null ? "min='" + c.min + "' " : "") + (c.step ? "step='" + c.step + "' " : "") + "placeholder='" + _cajaH(c.placeholder || "") + "' value='" + _cajaH(c.value != null ? c.value : "") + "'>";
      html += "</div>";
    });
    var okLabel = opts.submitLabel || "Guardar";
    var soloCerrar = !(opts.campos && opts.campos.length);
    html += "<div style='display:flex;gap:8px;justify-content:flex-end;margin-top:6px'>" +
      (soloCerrar ? "" : "<button class='btn-outline' data-act='cancel' style='margin:0'>Cancelar</button>") +
      "<button class='btn-main btn-green' data-act='ok' style='margin:0'>" + _cajaH(okLabel) + "</button></div>";
    m.innerHTML = html; ov.appendChild(m); document.body.appendChild(ov);
    function close(v) { try { document.body.removeChild(ov); } catch (e) { } resolve(v); }
    var cancelBtn = m.querySelector("[data-act='cancel']"); if (cancelBtn) cancelBtn.onclick = function () { close(null); };
    ov.onclick = function (e) { if (e.target === ov) close(null); };
    m.querySelector("[data-act='ok']").onclick = async function () {
      if (soloCerrar) return close({});
      var vals = {}, files = {}, ok = true;
      opts.campos.forEach(function (c) {
        var el = m.querySelector("[data-k='" + c.key + "']");
        if (c.type === "file") { files[c.key] = el.files; }
        else { vals[c.key] = el.value; if (c.required && !String(el.value).trim()) { ok = false; el.style.borderColor = "#b3261e"; } }
      });
      if (!ok) return;
      for (var k in files) { vals[k] = await _cajaFilesToBase64(files[k]); }
      close(vals);
    };
  });
}

// ---- carga / render ----
async function cargarCaja() {
  var cont = L("caja-estado"); if (cont) cont.innerHTML = "<div class='loading'><div class='spinner'></div></div>";
  var res = await api("cajaEstado");
  CAJA.estado = res;
  _cajaRenderHeader();   // mantiene sincronizado el botón del encabezado
  if (!res || !res.ok || res.sinCaja) {
    if (cont) cont.innerHTML = "<div class='card'>Tu rol no participa en la caja.</div>";
    L("caja-acciones").innerHTML = ""; L("caja-retiros").innerHTML = ""; L("caja-suc-sel").innerHTML = "";
    return;
  }
  CAJA.categorias = res.categorias || [];
  CAJA.permisos = res.permisos || {};
  var sucs = res.sucursales || [];
  if (!CAJA.sucSel || !sucs.some(function (s) { return s.sucursal === CAJA.sucSel; })) CAJA.sucSel = sucs[0] ? sucs[0].sucursal : null;
  renderCajaSucSel(sucs);
  renderCajaEstado();
  cargarCajaRetiros();
}
function renderCajaSucSel(sucs) {
  var el = L("caja-suc-sel"); if (!el) return;
  if (!sucs || sucs.length <= 1) { el.innerHTML = ""; return; }
  el.innerHTML = sucs.map(function (s) {
    var activo = s.sucursal === CAJA.sucSel;
    return "<button class='btn-outline' style='margin:0 0 0 6px;" + (activo ? "background:#2E4756;color:#fff;border-color:#2E4756" : "") + "' onclick=\"cajaSetSuc('" + s.sucursal + "')\">" + _cajaH(s.sucursal) + "</button>";
  }).join("");
}
function cajaSetSuc(s) { CAJA.sucSel = s; renderCajaSucSel((CAJA.estado || {}).sucursales || []); renderCajaEstado(); renderCajaRetiros(); }
function renderCajaEstado() {
  var res = CAJA.estado || {};
  var s = (res.sucursales || []).filter(function (x) { return x.sucursal === CAJA.sucSel; })[0];
  var cont = L("caja-estado"); if (!cont) return;
  if (!s) { cont.innerHTML = ""; L("caja-acciones").innerHTML = ""; return; }
  var estadoBadge = s.abierta ? "<span style='color:#1a6b3c;font-weight:700'>● ABIERTA</span>" : "<span style='color:#b3261e;font-weight:700'>● CERRADA</span>";
  var html = "<div class='card'>";
  html += "<div class='card-title' style='margin:0'>" + _cajaH(s.sucursal) + " — " + estadoBadge + "</div>";
  if (s.abierta) html += "<div class='card-sub'>Abierta por " + _cajaH(s.aperturaPor || "") + (s.aperturaAt ? " · " + _cajaFecha(s.aperturaAt) : "") + "</div>";
  if (s.sinBase && s.esperado != null) {
    html += "<div style='margin:10px 0;padding:10px;border:1px solid #b8860b;border-radius:8px;background:rgba(184,134,11,.08);font-size:13px'>⏳ La Dueña aún no ha fijado el saldo inicial de esta caja. Usa <b>⚖️ Fijar saldo (Dueña)</b> para establecer el efectivo real actual; a partir de ahí el esperado se calcula solo.</div>";
  } else if (s.esperado != null) {
    html += "<div style='font-size:24px;font-weight:800;margin:10px 0 2px'>" + _cajaMoney(s.esperado) + "</div><div class='card-sub'>Efectivo esperado (según el sistema)</div>";
    if (s.desglose) { var d = s.desglose; html += "<div style='font-size:12px;color:var(--muted);margin-top:6px'>Base " + _cajaMoney(d.baseline) + " + ventas efectivo " + _cajaMoney(d.ventasEfectivo) + " + aportaciones " + _cajaMoney(d.aportaciones) + " − retiros " + _cajaMoney(-d.retiros) + "</div>"; }
  } else {
    html += "<div class='card-sub' style='margin-top:8px'>El efectivo esperado lo ve la Dueña/Administradora (para no sesgar tu conteo).</div>";
  }
  html += "<div style='margin-top:10px'>🔴 Retiros pendientes: <b>" + s.retirosPendientes + "</b>" + (s.retirosPendientesMonto ? " (" + _cajaMoney(s.retirosPendientesMonto) + ")" : "") + "</div>";
  html += "</div>";
  cont.innerHTML = html;
  renderCajaAcciones(s);
}
function renderCajaAcciones(s) {
  var p = CAJA.permisos || {}; var cont = L("caja-acciones"); if (!cont) return;
  var b = [];
  if (!s.abierta) b.push("<button class='btn-main btn-green' style='margin:0' onclick=\"cajaAbrirFlow()\">🔓 Abrir tienda</button>");
  else b.push("<button class='btn-main' style='margin:0;background:#b3261e' onclick=\"cajaCerrarFlow()\">🔒 Cerrar tienda</button>");
  b.push("<button class='btn-outline' style='margin:0' onclick=\"cajaAportacionFlow()\">➕ Aportación</button>");
  if (p.cajaRetiroDirecto) b.push("<button class='btn-outline' style='margin:0' onclick=\"cajaRetiroFlow()\">💵 Retirar efectivo</button>");
  else if (p.cajaSolicitarRetiro) b.push("<button class='btn-outline' style='margin:0' onclick=\"cajaRetiroFlow()\">💵 Solicitar retiro</button>");
  if (p.cajaFijarSaldo) b.push("<button class='btn-outline' style='margin:0;border-color:#b3261e;color:#b3261e' onclick=\"cajaFijarSaldoFlow()\">⚖️ Fijar saldo (Dueña)</button>");
  cont.innerHTML = "<div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:8px'>" + b.join("") + "</div>";
}

// ---- flujos ----
async function cajaAbrirFlow() {
  var v = await cajaModal({
    titulo: "Abrir tienda — " + CAJA.sucSel, submitLabel: "Abrir tienda", campos: [
      { key: "efectivoFisico", label: "¿Cuánto dinero hay físicamente en la caja?", type: "number", min: 0, step: "0.01", required: true, placeholder: "0.00" },
      { key: "notas", label: "Observaciones (opcional)", type: "textarea" }
    ]
  });
  if (!v) return;
  var r = await api("cajaAbrir", { sucursal: CAJA.sucSel, efectivoFisico: Number(v.efectivoFisico), notas: v.notas, respuestas: {} });
  toast(r.ok ? r.mensaje : (r.error || "Error"), r.ok ? "success" : "error");
  if (r.ok) cargarCaja();
}
async function cajaCerrarFlow() {
  var v = await cajaModal({
    titulo: "Cerrar tienda — " + CAJA.sucSel, submitLabel: "Cerrar tienda", campos: [
      { key: "efectivoFisico", label: "¿Cuánto dinero hay físicamente en la caja?", type: "number", min: 0, step: "0.01", required: true, placeholder: "0.00" },
      { key: "notas", label: "Observaciones (opcional)", type: "textarea" }
    ]
  });
  if (!v) return;
  var r = await api("cajaCerrar", { sucursal: CAJA.sucSel, efectivoFisico: Number(v.efectivoFisico), notas: v.notas, respuestas: {} });
  toast(r.ok ? r.mensaje : (r.error || "Error"), r.ok ? "success" : "error");
  if (r.ok) cargarCaja();
}
async function cajaAportacionFlow() {
  var v = await cajaModal({
    titulo: "Aportación de efectivo — " + CAJA.sucSel, submitLabel: "Registrar", campos: [
      { key: "monto", label: "Monto", type: "number", min: 0, step: "0.01", required: true },
      { key: "motivo", label: "Motivo", type: "textarea", required: true }
    ]
  });
  if (!v) return;
  var r = await api("cajaAportacion", { sucursal: CAJA.sucSel, monto: Number(v.monto), motivo: v.motivo, opId: opIdNuevo() });
  toast(r.ok ? r.mensaje : (r.error || "Error"), r.ok ? "success" : "error");
  if (r.ok) cargarCaja();
}
async function cajaRetiroFlow() {
  var directo = (CAJA.permisos || {}).cajaRetiroDirecto;
  var v = await cajaModal({
    titulo: (directo ? "Retirar efectivo" : "Solicitar retiro") + " — " + CAJA.sucSel, submitLabel: directo ? "Registrar retiro" : "Enviar solicitud", campos: [
      { key: "categoria", label: "Categoría", type: "select", options: CAJA.categorias, required: true },
      { key: "monto", label: "Monto", type: "number", min: 0, step: "0.01", required: true },
      { key: "motivo", label: "Motivo / descripción (obligatorio si es 'Otro')", type: "textarea" }
    ]
  });
  if (!v) return;
  var r = await api("retiroRegistrar", { sucursal: CAJA.sucSel, categoria: v.categoria, monto: Number(v.monto), motivo: v.motivo, opId: opIdNuevo() });
  toast(r.ok ? r.mensaje : (r.error || "Error"), r.ok ? "success" : "error");
  if (r.ok) { cargarCaja(); if (directo && r.id) setTimeout(function () { cajaEvidenciaFlow(r.id); }, 400); }
}
async function cajaFijarSaldoFlow() {
  var v = await cajaModal({
    titulo: "Fijar saldo en caja — " + CAJA.sucSel, submitLabel: "Sobrescribir saldo", campos: [
      { key: "monto", label: "Saldo REAL en caja al momento", type: "number", min: 0, step: "0.01", required: true },
      { key: "motivo", label: "Motivo (opcional)", type: "textarea" }
    ]
  });
  if (!v) return;
  if (!confirm("Esto SOBREESCRIBE el efectivo esperado de " + CAJA.sucSel + " a " + _cajaMoney(Number(v.monto)) + ". ¿Continuar?")) return;
  var r = await api("cajaFijarSaldo", { sucursal: CAJA.sucSel, monto: Number(v.monto), motivo: v.motivo, opId: opIdNuevo() });
  toast(r.ok ? r.mensaje : (r.error || "Error"), r.ok ? "success" : "error");
  if (r.ok) cargarCaja();
}

// ---- retiros ----
async function cargarCajaRetiros() {
  var res = await api("getRetiros", {});
  CAJA.retiros = (res && res.retiros) || [];
  renderCajaRetiros();
}
function renderCajaRetiros() {
  var cont = L("caja-retiros"); if (!cont) return;
  var p = CAJA.permisos || {};
  var list = (CAJA.retiros || []).filter(function (r) { return r.sucursal === CAJA.sucSel; });
  var html = "<div class='card'><div class='card-title'>Retiros — " + _cajaH(CAJA.sucSel || "") + "</div>";
  if (!list.length) { cont.innerHTML = html + "<div class='card-sub'>Sin retiros.</div></div>"; return; }
  html += "<div style='overflow-x:auto'><table style='width:100%;border-collapse:collapse;font-size:13px'><tr style='text-align:left;color:var(--muted)'><th>Fecha</th><th>Usuario</th><th>Categoría</th><th style='text-align:right'>Monto</th><th>Estado</th><th></th></tr>";
  list.forEach(function (r) {
    html += "<tr style='border-top:1px solid rgba(0,0,0,.08)'><td>" + _cajaFecha(r.solicitadoAt) + "</td><td>" + _cajaH(r.solicitadoPor || "") +
      "</td><td>" + _cajaH(r.categoria || "") + (r.motivo ? "<div style='font-size:11px;color:var(--muted)'>" + _cajaH(r.motivo) + "</div>" : "") +
      "</td><td style='text-align:right'>" + _cajaMoney(r.monto) + "</td><td>" + cajaEstadoBadge(r.estado) + "</td><td style='text-align:right;white-space:nowrap'>" + cajaRetiroBotones(r, p) + "</td></tr>";
  });
  cont.innerHTML = html + "</table></div></div>";
}
function cajaEstadoBadge(e) {
  var c = { SOLICITADO: "#b8860b", ENTREGADO: "#1f6fb2", COMPROBADO: "#7d3c98", CONCILIADO: "#1a6b3c", RECHAZADO: "#b3261e", CANCELADO: "#777" }[e] || "#555";
  return "<span style='color:" + c + ";font-weight:700'>" + e + "</span>";
}
function cajaRetiroBotones(r, p) {
  var b = [];
  if (r.estado === "SOLICITADO" && p.cajaAutorizar) {
    b.push("<button class='btn-outline' style='margin:0;padding:4px 8px' onclick=\"cajaAutorizar('" + r.id + "')\">Autorizar</button>");
    b.push("<button class='btn-outline' style='margin:0 0 0 4px;padding:4px 8px;border-color:#b3261e;color:#b3261e' onclick=\"cajaRechazar('" + r.id + "')\">Rechazar</button>");
  }
  if (r.estado === "ENTREGADO") b.push("<button class='btn-outline' style='margin:0;padding:4px 8px' onclick=\"cajaEvidenciaFlow('" + r.id + "')\">Subir evidencia</button>");
  if (r.estado === "COMPROBADO" && p.cajaConciliar) b.push("<button class='btn-main btn-green' style='margin:0;padding:4px 8px' onclick=\"cajaConciliar('" + r.id + "')\">Conciliar</button>");
  if (r.evidenciasCount > 0 && r.evidencias && r.evidencias.length) b.push("<button class='btn-outline' style='margin:0 0 0 4px;padding:4px 8px' onclick=\"cajaVerEvidencias('" + r.id + "')\">📎 " + r.evidenciasCount + "</button>");
  return b.join("");
}
async function cajaAutorizar(id) {
  if (!confirm("¿Autorizar y entregar este retiro? Se descontará del efectivo esperado.")) return;
  var r = await api("retiroAutorizar", { id: id });
  toast(r.ok ? r.mensaje : (r.error || "Error"), r.ok ? "success" : "error");
  if (r.ok) cargarCaja();
}
async function cajaRechazar(id) {
  var v = await cajaModal({ titulo: "Rechazar retiro", submitLabel: "Rechazar", campos: [{ key: "motivo", label: "Motivo del rechazo", type: "textarea", required: true }] });
  if (!v) return;
  var r = await api("retiroRechazar", { id: id, motivo: v.motivo });
  toast(r.ok ? r.mensaje : (r.error || "Error"), r.ok ? "success" : "error");
  if (r.ok) cargarCaja();
}
async function cajaConciliar(id) {
  if (!confirm("¿Marcar este retiro como CONCILIADO? (requiere evidencia ya subida)")) return;
  var r = await api("retiroConciliar", { id: id });
  toast(r.ok ? r.mensaje : (r.error || "Error"), r.ok ? "success" : "error");
  if (r.ok) cargarCaja();
}
async function cajaEvidenciaFlow(id) {
  var v = await cajaModal({ titulo: "Subir evidencia del retiro", submitLabel: "Subir", campos: [{ key: "archivos", label: "Foto(s) o PDF del comprobante", type: "file" }] });
  if (!v) return;
  var archivos = v.archivos || [];
  if (!archivos.length) { toast("Selecciona al menos un archivo.", "error"); return; }
  var r = await api("retiroSubirEvidencia", { id: id, archivos: archivos });
  toast(r.ok ? r.mensaje : (r.error || "Error"), r.ok ? "success" : "error");
  if (r.ok) cargarCaja();
}
function cajaVerEvidencias(id) {
  var r = (CAJA.retiros || []).filter(function (x) { return x.id === id; })[0];
  if (!r || !r.evidencias || !r.evidencias.length) return;
  var links = r.evidencias.map(function (e, i) {
    return "<a href='" + _cajaH(e.url) + "' target='_blank' rel='noopener' style='display:block;margin:6px 0'>📎 Evidencia " + (i + 1) + " (" + _cajaH(e.tipo) + ") — " + _cajaH(e.subidoPor || "") + "</a>";
  }).join("");
  cajaModal({ titulo: "Evidencias del retiro", html: links, campos: [], submitLabel: "Cerrar" });
}

// ---- botón de Abrir/Cerrar tienda en el encabezado (siempre visible) ----
function _cajaRenderHeader() {
  var btn = L("hdr-caja"); if (!btn) return;
  var res = CAJA.estado || {};
  var sucs = res.sucursales || [];
  if (!res.ok || res.sinCaja || !sucs.length) { btn.style.display = "none"; return; }
  var cerradas = sucs.filter(function (s) { return !s.abierta; });
  var angosto = (window.innerWidth || 999) < 620;   // en celular solo el ícono
  btn.style.display = "";
  if (cerradas.length) {
    btn.textContent = angosto ? ("🔓" + (sucs.length > 1 ? " " + cerradas.length : "")) : ("🔓 Abrir tienda" + (sucs.length > 1 ? " (" + cerradas.length + ")" : ""));
    btn.title = "Abrir tienda";
    btn.style.background = "#1a6b3c";
    btn.setAttribute("data-accion", "abrir");
  } else {
    btn.textContent = angosto ? "🔒" : "🔒 Cerrar tienda";
    btn.title = "Cerrar tienda";
    btn.style.background = "#b3261e";
    btn.setAttribute("data-accion", "cerrar");
  }
}
async function cajaHeaderRefresh() {
  var btn = L("hdr-caja"); if (!btn) return;
  var p = (typeof getPermisos === "function") ? (getPermisos() || {}) : {};
  if (!p.cajaOperar && !p.esAdmin) { btn.style.display = "none"; return; }
  var res = await api("cajaEstado");
  CAJA.estado = res;
  if (res && res.ok) { CAJA.categorias = res.categorias || []; CAJA.permisos = res.permisos || {}; }
  _cajaRenderHeader();
}
// Con una sola sucursal actúa directo; con varias lleva a la pantalla para elegir.
function cajaHeaderClick() {
  var sucs = ((CAJA.estado || {}).sucursales) || [];
  var btn = L("hdr-caja");
  var accion = btn ? btn.getAttribute("data-accion") : "abrir";
  if (sucs.length === 1) {
    CAJA.sucSel = sucs[0].sucursal;
    if (accion === "cerrar") cajaCerrarFlow(); else cajaAbrirFlow();
    return;
  }
  if (typeof irAPane === "function") irAPane("caja");
}

// ---- gating de apertura al iniciar sesión ----
async function cajaGateInicial() {
  await cajaHeaderRefresh();   // deja el botón del encabezado listo para todos
  var p = (typeof getPermisos === "function") ? (getPermisos() || {}) : {};
  // Solo se fuerza a operadores básicos (Vendedora/Mixto). Dueña y Administradora
  // (mando de caja) no se bloquean; Cocina/Chofer no operan caja.
  if (!p.cajaOperar || p.cajaAutorizar) return;
  var res = CAJA.estado;
  if (!res || !res.ok || res.sinCaja) return;
  var mias = res.sucursales || [];
  var cerradas = mias.filter(function (s) { return !s.abierta; });
  if (mias.length && cerradas.length === mias.length) {
    toast("La tienda está cerrada. Ábrela para poder operar.", "error");
    if (typeof irAPane === "function") irAPane("caja");
  }
}
