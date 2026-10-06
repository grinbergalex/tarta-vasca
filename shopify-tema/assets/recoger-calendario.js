/* ==========================================================================
   Calendario del carrito — La Tarta Vasca
   Decide desde qué día se puede recoger (o recibir) el pedido según el
   inventario EN VIVO del sistema de sucursales:
     - Si de cada tarta del carrito hay suficiente en la sucursal → desde HOY.
     - Si alguna no alcanza → se prepara: desde hoy + días de preparación
       (+1 si ya pasó la hora de corte), en el siguiente día que abra.
   Guarda la elección como atributos del carrito con los mismos nombres que
   usaba la app anterior, para que el sincronizador del sistema los lea igual.
   ========================================================================== */
(function () {
  "use strict";

  var raiz = document.getElementById("recoger-calendario");
  if (!raiz) return;

  var CFG = JSON.parse(raiz.getAttribute("data-config"));
  var CACHE_MS = 30 * 1000;
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  var DIAS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MESES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  var estado = {
    canal: CFG.atributos.canal === "DELIVERY" ? "DELIVERY" : "PICKUP",
    sucursal: CFG.atributos.sucursal || CFG.sucursales[0].clave,
    fecha: CFG.atributos.fecha || "",
    hora: CFG.atributos.hora || "",
    datos: null,
    carrito: null,
    productos: {}
  };

  // ---------- Datos ----------------------------------------------------------
  function leerDisponibilidad() {
    try {
      var guardado = JSON.parse(sessionStorage.getItem("tv_disp") || "null");
      if (guardado && Date.now() - guardado.t < CACHE_MS) return Promise.resolve(guardado.d);
    } catch (e) {}
    var url = CFG.api + "?data=" + encodeURIComponent(JSON.stringify({ accion: "tiendaDisponibilidad" }));
    return fetch(url, { redirect: "follow" }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) throw new Error("sin datos");
      d._recibido = Date.now();
      try { sessionStorage.setItem("tv_disp", JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
      return d;
    });
  }

  function leerCarrito() {
    return fetch("/cart.js", { headers: { Accept: "application/json" } }).then(function (r) { return r.json(); });
  }

  function leerSabor(handle) {
    if (estado.productos[handle] !== undefined) return Promise.resolve(estado.productos[handle]);
    return fetch("/products/" + handle + ".js").then(function (r) { return r.json(); }).then(function (p) {
      var etiqueta = (p.tags || []).filter(function (t) { return t.indexOf("sabor:") === 0; })[0];
      estado.productos[handle] = etiqueta ? etiqueta.slice(6) : null;
      return estado.productos[handle];
    }).catch(function () { estado.productos[handle] = null; return null; });
  }

  function tamanoDe(item) {
    var opcion = (item.options_with_values || []).filter(function (o) { return /tama/i.test(o.name); })[0];
    return opcion ? opcion.value : item.variant_title;
  }

  // ---------- Fechas (todo en hora de la Ciudad de México) -------------------
  // El servidor manda "ahora" en hora de México: se usa como reloj, no el del cliente.
  function relojMx() {
    var p = estado.datos.ahora.split(/[-T:]/).map(Number);
    var base = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]);
    var transcurrido = Date.now() - estado.datos._recibido;
    return new Date(base + transcurrido); // se lee con getUTC*: es "hora de México"
  }
  function sumarDias(fecha, n) { return new Date(fecha.getTime() + n * 86400000); }
  function claveDia(f) { return f.getUTCFullYear() + "-" + pad(f.getUTCMonth() + 1) + "-" + pad(f.getUTCDate()); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function aMinutos(hhmm) { var p = hhmm.split(":"); return Number(p[0]) * 60 + Number(p[1]); }
  function hora12(min) {
    var h = Math.floor(min / 60), m = min % 60, sufijo = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12;
    return pad(h12) + ":" + pad(m) + " " + sufijo;
  }
  function textoFechaEs(f) { return DIAS[f.getUTCDay()] + " " + f.getUTCDate() + " de " + MESES[f.getUTCMonth()]; }
  // Mismo formato que escribía la app anterior: "Monday, 05 October 2026"
  function textoFechaEn(f) { return DIAS_EN[f.getUTCDay()] + ", " + pad(f.getUTCDate()) + " " + MESES_EN[f.getUTCMonth()] + " " + f.getUTCFullYear(); }

  function reglaActual() {
    var r = estado.datos.reglas;
    if (estado.canal === "DELIVERY") {
      return { sucursal: CFG.domicilio.sucursal, horarios: CFG.domicilio.horarios, corte: CFG.domicilio.horaCorte, prep: r.diasPreparacion, mismoDia: CFG.domicilio.mismoDia, ventana: true };
    }
    return { sucursal: estado.sucursal, horarios: r.horarios[estado.sucursal], corte: r.horaCorte, prep: r.diasPreparacion, mismoDia: true, ventana: false };
  }

  // Cada tarta del carrito: ¿se puede hoy en la sucursal de la regla?
  function evaluarTartas(regla) {
    var listas = estado.datos.hoy[regla.sucursal] || [];
    var hoy = {};
    listas.forEach(function (sku) { hoy[sku.k || sku] = sku.max === undefined ? Infinity : sku.max; });
    return estado.carrito.items.map(function (item) {
      var sabor = estado.productos[item.handle];
      var sku = sabor + "|" + tamanoDe(item);
      var maxHoy = hoy[sku] || 0;
      return { item: item, nombre: item.product_title + " " + tamanoDe(item), listaHoy: regla.mismoDia && !!sabor && item.quantity <= maxHoy, maxHoy: maxHoy };
    });
  }

  function horariosDelDia(regla, fecha) {
    var h = regla.horarios[fecha.getUTCDay()];
    if (!h) return [];
    if (regla.ventana) return [{ ini: aMinutos(h.abre), fin: aMinutos(h.cierra) }];
    var paso = estado.datos.reglas.intervaloMin, slots = [];
    for (var m = aMinutos(h.abre); m + paso <= aMinutos(h.cierra); m += paso) slots.push({ ini: m, fin: m + paso });
    return slots;
  }

  // Primer día y lista de días elegibles
  function calendario(regla, todasHoy) {
    var ahora = relojMx();
    var minutosAhora = ahora.getUTCHours() * 60 + ahora.getUTCMinutes();
    var dias = [];
    var desde;
    if (todasHoy) desde = 0;
    else desde = regla.prep + (minutosAhora >= aMinutos(regla.corte) ? 1 : 0);
    for (var i = desde; i < estado.datos.reglas.diasAMostrar; i++) {
      var f = sumarDias(ahora, i);
      var slots = horariosDelDia(regla, f);
      if (i === 0) slots = slots.filter(function (s) { return s.ini >= minutosAhora + CFG.margenMismoDiaMin; });
      if (slots.length) dias.push({ fecha: f, clave: claveDia(f), slots: slots, esHoy: i === 0 });
    }
    return dias;
  }

  // ---------- Pantalla -------------------------------------------------------
  function el(tag, attrs, hijos) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "texto") n.textContent = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (hijos || []).forEach(function (h) { if (h) n.appendChild(h); });
    return n;
  }

  function pintar() {
    var cuerpo = raiz.querySelector(".rc-cuerpo");
    cuerpo.innerHTML = "";
    if (!estado.carrito || !estado.carrito.items.length) { bloquearPago(false); return; }

    cuerpo.appendChild(selectorCanal());
    if (estado.canal === "PICKUP") cuerpo.appendChild(selectorSucursal());

    var regla = reglaActual();
    var tartas = evaluarTartas(regla);
    var todasHoy = tartas.every(function (t) { return t.listaHoy; });
    var dias = calendario(regla, todasHoy);

    cuerpo.appendChild(resumenTartas(tartas, todasHoy, dias, regla));

    if (!dias.some(function (d) { return d.clave === estado.fecha; })) { estado.fecha = ""; estado.hora = ""; }
    cuerpo.appendChild(selectorFecha(dias));
    var dia = dias.filter(function (d) { return d.clave === estado.fecha; })[0];
    if (dia) cuerpo.appendChild(selectorHora(dia, regla));
    if (dia && !dia.slots.some(function (s) { return textoSlot(s) === estado.hora; })) estado.hora = "";

    var completo = !!(estado.fecha && estado.hora);
    if (!completo) cuerpo.appendChild(el("p", { class: "rc-aviso rc-aviso--error", texto: estado.canal === "PICKUP" ? "Elige fecha y hora para recoger antes de pagar." : "Elige la fecha de entrega antes de pagar." }));
    bloquearPago(!completo);
    guardar(dia, regla);
  }

  function selectorCanal() {
    return el("div", { class: "rc-opciones", role: "radiogroup", "aria-label": "Cómo quieres tu pedido" }, [
      boton("Recoger en tienda", estado.canal === "PICKUP", function () { estado.canal = "PICKUP"; pintar(); }),
      boton("Entrega a domicilio", estado.canal === "DELIVERY", function () { estado.canal = "DELIVERY"; pintar(); })
    ]);
  }

  function selectorSucursal() {
    return el("div", { class: "rc-bloque" }, [el("p", { class: "rc-titulo", texto: "Sucursal" })].concat(
      CFG.sucursales.map(function (s) {
        return el("label", { class: "rc-sucursal" + (estado.sucursal === s.clave ? " rc-activo" : "") }, [
          el("input", { type: "radio", name: "rc-sucursal", value: s.clave, onchange: function () { estado.sucursal = s.clave; pintar(); } }),
          el("span", {}, [el("strong", { texto: s.nombre }), el("br"), el("small", { texto: s.direccion })])
        ]);
      })
    ).map(function (n) { var r = n.querySelector && n.querySelector("input"); if (r && r.value === estado.sucursal) r.checked = true; return n; }));
  }

  function resumenTartas(tartas, todasHoy, dias, regla) {
    var lista = el("ul", { class: "rc-tartas" }, tartas.map(function (t) {
      var txt = t.listaHoy ? "lista hoy" : (regla.mismoDia ? (t.maxHoy > 0 ? "hoy solo hay " + t.maxHoy + "; se prepara" : "se prepara sobre pedido") : "sobre pedido");
      return el("li", { class: t.listaHoy ? "rc-ok" : "rc-prep" }, [el("span", { texto: (t.listaHoy ? "✅ " : "⏳ ") + t.nombre + (t.item.quantity > 1 ? " ×" + t.item.quantity : "") }), el("small", { texto: " — " + txt })]);
    }));
    var primero = dias[0];
    var mensaje;
    if (!primero) mensaje = "No hay fechas disponibles en los próximos días. Escríbenos por WhatsApp.";
    else if (todasHoy && primero.esHoy) mensaje = "¡Todo está listo! Puedes " + (estado.canal === "PICKUP" ? "recogerlo hoy." : "recibirlo hoy.");
    else if (todasHoy && !primero.esHoy) mensaje = "Tenemos todo, pero hoy ya no hay horarios. Primera fecha: " + textoFechaEs(primero.fecha) + ".";
    else {
      var pendientes = tartas.filter(function (t) { return !t.listaHoy; }).map(function (t) { return t.nombre; });
      mensaje = "Tu pedido se puede " + (estado.canal === "PICKUP" ? "recoger" : "entregar") + " a partir del " + textoFechaEs(primero.fecha) + " porque " +
        (pendientes.length === 1 ? "la " + pendientes[0] + " se prepara" : "estas tartas se preparan") + " sobre pedido." +
        (regla.mismoDia && tartas.some(function (t) { return t.listaHoy; }) ? " Si quieres lo que está listo hoy, pídelo por separado." : "");
    }
    return el("div", { class: "rc-bloque" }, [lista, el("p", { class: "rc-aviso", texto: mensaje })]);
  }

  function selectorFecha(dias) {
    var sel = el("select", { class: "rc-select", "aria-label": "Fecha", onchange: function (e) { estado.fecha = e.target.value; estado.hora = ""; pintar(); } },
      [el("option", { value: "", texto: "Elige una fecha" })].concat(dias.map(function (d) {
        var o = el("option", { value: d.clave, texto: (d.esHoy ? "Hoy, " : "") + textoFechaEs(d.fecha) });
        if (d.clave === estado.fecha) o.selected = true;
        return o;
      })));
    return el("div", { class: "rc-bloque" }, [el("p", { class: "rc-titulo", texto: estado.canal === "PICKUP" ? "Fecha para recoger" : "Fecha de entrega" }), sel]);
  }

  function textoSlot(s) { return hora12(s.ini) + " - " + hora12(s.fin); }

  function selectorHora(dia, regla) {
    if (regla.ventana && dia.slots.length === 1 && !estado.hora) estado.hora = textoSlot(dia.slots[0]);
    var sel = el("select", { class: "rc-select", "aria-label": "Horario", onchange: function (e) { estado.hora = e.target.value; pintar(); } },
      [el("option", { value: "", texto: "Elige un horario" })].concat(dia.slots.map(function (s) {
        var o = el("option", { value: textoSlot(s), texto: textoSlot(s) });
        if (textoSlot(s) === estado.hora) o.selected = true;
        return o;
      })));
    return el("div", { class: "rc-bloque" }, [el("p", { class: "rc-titulo", texto: regla.ventana ? "Horario de entrega" : "Horario para recoger" }), sel]);
  }

  function boton(texto, activo, alClic) {
    return el("button", { type: "button", class: "rc-opcion" + (activo ? " rc-activo" : ""), "aria-pressed": activo ? "true" : "false", onclick: alClic, texto: texto });
  }

  // ---------- Guardar y bloquear el pago -------------------------------------
  var ultimoGuardado = "";
  function guardar(dia, regla) {
    var esRecoger = estado.canal === "PICKUP";
    var suc = CFG.sucursales.filter(function (s) { return s.clave === regla.sucursal; })[0];
    var fechaEn = dia && estado.fecha ? textoFechaEn(dia.fecha) : "";
    var attrs = {
      "Checkout channel": estado.canal,
      "Location": suc ? suc.nombre : "",
      "Pickup date": esRecoger ? fechaEn : "",
      "Pickup time": esRecoger ? estado.hora : "",
      "Local delivery date": esRecoger ? "" : fechaEn,
      "Local delivery time": esRecoger ? "" : estado.hora
    };
    var firma = JSON.stringify(attrs);
    if (firma === ultimoGuardado) return;
    ultimoGuardado = firma;
    fetch("/cart/update.js", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ attributes: attrs }) });
  }

  function bloquearPago(bloquear) {
    document.querySelectorAll('[name="checkout"], #checkout').forEach(function (b) {
      b.disabled = bloquear;
      b.setAttribute("aria-disabled", bloquear ? "true" : "false");
    });
  }

  // ---------- Arranque y refrescos -------------------------------------------
  function cargar() {
    raiz.classList.add("rc-cargando");
    return Promise.all([leerDisponibilidad(), leerCarrito()]).then(function (res) {
      if (!res[0]._recibido) res[0]._recibido = Date.now();
      estado.datos = res[0];
      estado.carrito = res[1];
      return Promise.all(estado.carrito.items.map(function (i) { return leerSabor(i.handle); }));
    }).then(function () {
      raiz.classList.remove("rc-cargando");
      raiz.querySelector(".rc-error").hidden = true;
      pintar();
    }).catch(function () {
      raiz.classList.remove("rc-cargando");
      raiz.querySelector(".rc-error").hidden = false;
      bloquearPago(true);
    });
  }

  // Dawn vuelve a pintar el pie del carrito al cambiar cantidades: el botón de
  // pagar renace habilitado y el carrito cambió. Se re-evalúa con lo nuevo.
  document.addEventListener("submit", function (e) {
    if (e.target && (e.target.id === "cart" || e.target.id === "CartDrawer-Form") && raiz.querySelector('.rc-aviso--error')) {
      e.preventDefault();
      raiz.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, true);
  if (typeof subscribe === "function" && typeof PUB_SUB_EVENTS !== "undefined") {
    subscribe(PUB_SUB_EVENTS.cartUpdate, function () { leerCarrito().then(function (c) { estado.carrito = c; return Promise.all(c.items.map(function (i) { return leerSabor(i.handle); })); }).then(pintar); });
  }
  setInterval(function () { if (!document.hidden) { sessionStorage.removeItem("tv_disp"); cargar(); } }, 2 * 60 * 1000);

  cargar();
})();
