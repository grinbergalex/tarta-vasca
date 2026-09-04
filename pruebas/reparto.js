
/* ===== Estado del módulo de reparto ===== */
var REP = { base:[], rutas:[], params:{capTartas:13,jornadaMin:360,choferes:3}, tartasActuales:[], depot:null, capCoord:null };
var repVista = { rol:"Admin", chofer:"" };
var repEsc = null, repIdeal = null;
async function cargarReparto(){
  // Fecha local, NO UTC: toISOString adelantaba un día a partir de las 18:00 de CDMX.
  var hoy = _hoyCDMXString();
  if(L("rep-fecha")&&!L("rep-fecha").value) L("rep-fecha").value = hoy;
  if(L("rep-hoy")&&!L("rep-hoy").value) L("rep-hoy").value = hoy;
  // Fecha de envío del pedido (punto 7): default mañana
  var man = new Date(); man.setDate(man.getDate()+1);
  var manStr = man.getFullYear()+"-"+String(man.getMonth()+1).padStart(2,"0")+"-"+String(man.getDate()).padStart(2,"0");
  if(L("rep-fechaPedido")&&!L("rep-fechaPedido").value) L("rep-fechaPedido").value = manStr;
  if(!S.catalogo){ try{ await cargarCatalogo(); }catch(e){} }
  repPoblarTartas();
  try{ await repCargarZonasEnvio(); }catch(e){}
  var _di=L("rep-dir"); if(_di&&!_di._repGeoBound){ _di._repGeoBound=true; _di.addEventListener("input", repResetGeo); }
  await repReload();
  var perms=(typeof getPermisos==="function")?(getPermisos()||{}):{};
  var tab=L("tab-reparto");
  if(perms.esChofer){
    repVista.rol="Chofer"; repVista.chofer=S.usuario;
    tab.querySelectorAll(".card").forEach(function(c){c.style.display="none";});
    var vc=document.getElementById("rep-rol"); if(vc&&vc.parentElement) vc.parentElement.style.display="none";
    L("rep-overlay").style.display="block";
    var bk=L("rep-overlay").querySelector("button"); if(bk) bk.style.display="none";
    repRenderChofer();
  } else {
    tab.querySelectorAll(".card").forEach(function(c){c.style.display="";});
    var vc2=document.getElementById("rep-rol"); if(vc2&&vc2.parentElement) vc2.parentElement.style.display="";
  }
}
async function repReload(){
  var res = await api("repartoEstado");
  if(!res || !res.ok){ toast("No se pudo cargar reparto","error"); return; }
  REP.base = res.base||[]; REP.rutas = res.rutas||[]; REP.params = res.params||REP.params;
  if(res.depot) REP.depot = res.depot;
  repRenderBase(); repRenderRutas(); repRenderAvisos(); repRenderCocina(); repRenderInv();
}
/* ===== Selector de tartas (cascada estilo ventas, desde catálogo, SIN stock) ===== */
function repPoblarTartas(){
  if(!S.catalogo) return;
  var sab=(S.catalogo.sabores||[]).filter(function(s){return s.activo;}).map(function(s){return s.nombre;});
  var tam=(S.catalogo.tamanos||[]).filter(function(t){return t.activo;}).map(function(t){return t.nombre;});
  var selS=L("rep-sabor"), selT=L("rep-tamano");
  if(selS) selS.innerHTML = sab.map(function(n){return "<option value=\""+n+"\">"+n+"</option>";}).join("");
  if(selT) selT.innerHTML = tam.map(function(n){return "<option value=\""+n+"\">"+n+"</option>";}).join("");
  repPrecioPreview();
  repRenderTartasList();
}
function repPrecioTarta(sabor,tamano){
  if(typeof getPrecioActualLocal==="function") return getPrecioActualLocal(sabor,tamano);
  if(!S.precios) return 0;
  var p=S.precios.find(function(x){return x.tamano===tamano&&x.precio>0;});
  return p?p.precio:0;
}
function repPrecioPreview(){
  var sabor=L("rep-sabor")?L("rep-sabor").value:"", tamano=L("rep-tamano")?L("rep-tamano").value:"";
  var cant=parseInt(L("rep-cant")?L("rep-cant").value:1)||1;
  var pr=repPrecioTarta(sabor,tamano);
  var el=L("rep-tarta-precio");
  if(el) el.innerHTML = pr>0 ? ("$"+pr.toLocaleString('es-MX')+" × "+cant+" = <strong>$"+(pr*cant).toLocaleString('es-MX')+"</strong>") : "<span style='color:var(--muted)'>sin precio</span>";
}
function repAddTarta(){
  var sabor=L("rep-sabor").value, tamano=L("rep-tamano").value;
  var cant=parseInt(L("rep-cant").value)||0;
  if(!sabor||!tamano){ toast("Selecciona sabor y tamaño","error"); return; }
  if(cant<1){ toast("Cantidad inválida","error"); return; }
  var precio=repPrecioTarta(sabor,tamano);
  REP.tartasActuales.push({ sabor:sabor, tamano:tamano, cantidad:cant, precio:precio });
  L("rep-cant").value=1;
  repRenderTartasList();
  repRenderMontoAuto();
}
function repQuitarTarta(i){ REP.tartasActuales.splice(i,1); repRenderTartasList(); repRenderMontoAuto(); }
function repRenderTartasList(){
  var el=L("rep-tartas-list"); if(!el) return;
  var t=REP.tartasActuales||[];
  if(!t.length){ el.innerHTML="<div style='font-size:12px;color:var(--muted)'>Sin tartas — agrega arriba.</div>"; return; }
  el.innerHTML = t.map(function(it,i){
    return "<div class='rep-tarta-row'><div style='flex:1'><strong>"+it.cantidad+"×</strong> "+it.sabor+" "+it.tamano+
      "</div><span style='color:var(--accent);margin-right:10px'>$"+(it.precio*it.cantidad).toLocaleString('es-MX')+"</span>"+
      "<button class='btn-remove' onclick='repQuitarTarta("+i+")'>×</button></div>";
  }).join("");
}
function repRenderMontoAuto(){
  var el=L("rep-monto-auto"); if(!el) return;
  var auto=(REP.tartasActuales||[]).reduce(function(a,t){return a+t.precio*t.cantidad;},0);
  var tot=(REP.tartasActuales||[]).reduce(function(a,t){return a+t.cantidad;},0);
  el.innerHTML = tot ? ("Auto: <strong>$"+auto.toLocaleString('es-MX')+"</strong> · "+tot+" tarta"+(tot!==1?"s":"")) : "";
  try{ repEnvioInfo(); }catch(e){}
}
/* ===== (punto 1) Verificación de dirección en el mapa antes de subir ===== */
async function repVerificarDir(){
  var dir=L("rep-dir").value.trim();
  if(!dir){ toast("Escribe la dirección primero","error"); return; }
  var st=L("rep-geo-status"); if(st) st.innerHTML="<span style='color:var(--muted)'>Buscando…</span>";
  var btn=L("rep-verificar-btn"); if(btn) btn.disabled=true;
  var res=await api("repartoGeocode",{dir:dir});
  if(btn) btn.disabled=false;
  if(res && res.ok && res.found){
    REP.capCoord={lat:res.lat, lon:res.lon};
    if(st) st.innerHTML="<span style='color:var(--success)'>✓ Dirección encontrada — revísala en el mapa</span>";
    repShowPin("rep-cap-mapa", res.lat, res.lon, dir);
  } else {
    REP.capCoord=null;
    if(st) st.innerHTML="<span style='color:var(--danger)'>⚠ No se encontró. Afina la dirección (calle y número, colonia, alcaldía, CP).</span>";
    var m=L("rep-cap-mapa"); if(m) m.style.display="none";
  }
}
function repShowPin(contId, lat, lon, label){
  var cont=L(contId); if(!cont) return;
  var LF=window._LF; if(!LF||!LF.map){ cont.style.display="none"; return; }
  cont.style.display="block";
  if(repMaps[contId]){ try{ repMaps[contId].remove(); }catch(e){} repMaps[contId]=null; }
  var map=LF.map(cont).setView([Number(lat),Number(lon)],15); repMaps[contId]=map;
  LF.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map);
  LF.circleMarker([Number(lat),Number(lon)],{radius:9,color:"#C8602A",fillColor:"#C8602A",fillOpacity:.9,weight:2}).addTo(map).bindPopup(label||"").openPopup();
  setTimeout(function(){ try{ map.invalidateSize(); }catch(e){} },250);
}
function repResetGeo(){ REP.capCoord=null; var st=L("rep-geo-status"); if(st) st.innerHTML=""; var m=L("rep-cap-mapa"); if(m) m.style.display="none"; }
/* ===== Captura ===== */
async function repAddPedido(){
  var cli=L("rep-cli").value.trim(), tel=L("rep-tel").value.trim(), dir=L("rep-dir").value.trim();
  if(!cli) return toast("Falta el cliente","error");
  if(!tel) return toast("El teléfono es obligatorio","error");
  if(!dir) return toast("Falta la dirección","error");
  if(!REP.capCoord) return toast("Primero verifica la dirección en el mapa (botón 📍)","error");
  var tartas = REP.tartasActuales||[];
  if(!tartas.length) return toast("Agrega al menos una tarta al pedido","error");
  var totalCant = tartas.reduce(function(a,t){return a+t.cantidad;},0);
  var detalle = tartas.map(function(t){return t.cantidad+"× "+t.sabor+" "+t.tamano;}).join(" · ");
  var montoAuto = tartas.reduce(function(a,t){return a+t.precio*t.cantidad;},0);
  var montoManual = parseFloat(L("rep-monto").value)||0;
  var monto = montoManual>0 ? montoManual : montoAuto;
  var _envInp=L("rep-envio"); var _subt=montoAuto;
  var envio=(_subt>=1500)?0:(parseFloat(_envInp?_envInp.value:"")||0);
  if(_subt<1500 && _envInp && (_envInp.value===""||_envInp.value==null)) return toast("Captura el costo de envio (obligatorio)","error");
  var pedido = {
    cliente:cli, tel:tel, dir:dir, zona:L("rep-zona").value.trim(),
    referencia:L("rep-ref").value.trim(), instruccion:L("rep-inst").value.trim(),
    fechaDeseada:L("rep-fechaPedido").value, pago:L("rep-pago").value,
    lat:REP.capCoord.lat, lon:REP.capCoord.lon,
    tartas:totalCant, detalle:detalle, items:tartas, monto:monto, envio:envio
  };
  var res = await api("repartoAddPedido",{pedido:pedido});
  if(res.ok){
    ["rep-cli","rep-tel","rep-dir","rep-zona","rep-ref","rep-inst"].forEach(function(id){ if(L(id)) L(id).value=""; });
    L("rep-monto").value=0; REP.tartasActuales=[]; repRenderTartasList(); repRenderMontoAuto(); repPrecioPreview(); repResetGeo();
    if(L("rep-envio")){L("rep-envio").value="";L("rep-envio").disabled=false;} if(L("rep-envio-zona"))L("rep-envio-zona").value=""; if(L("rep-envio-info"))L("rep-envio-info").innerHTML="";
    toast(res.geocodificado?"Pedido agregado y geocodificado":"Pedido agregado (no se pudo geocodificar; revisa la dirección)");
    await repReload();
  } else toast(res.error||"Error","error");
}
async function repDelPedido(id){ if(!confirm("¿Eliminar pedido?"))return; var r=await api("repartoDelPedido",{id:id}); if(r.ok) await repReload(); }
function repRenderBase(){
  L("rep-cnt").textContent = REP.base.length;
  L("rep-base").innerHTML = !REP.base.length ? "<div style='font-size:12px;color:var(--muted)'>Sin pedidos en base.</div>" :
    "<div style='overflow-x:auto'><table style='width:100%;font-size:12px;border-collapse:collapse'><tr><th style='text-align:left'>Cliente</th><th style='text-align:left'>Dirección</th><th style='text-align:left'>Fecha</th><th style='text-align:left'>Envío</th><th style='text-align:left'>🎂</th><th>Tartas</th><th></th></tr>"+
    REP.base.map(function(p){ return "<tr style='border-top:1px solid var(--warm)'><td>"+p.cliente+(p.tel?"<div style='color:var(--muted);font-size:11px'>📞 "+p.tel+"</div>":"")+"</td><td>"+(p.dir||p.zona)+
      (p.referencia?"<div style='color:var(--muted);font-size:11px'>Ref: "+p.referencia+"</div>":"")+(p.instruccion?"<div style='color:var(--muted);font-size:11px'>"+p.instruccion+"</div>":"")+(p.lat?"":" <span style='color:#b22'>⚠sin geo</span>")+"</td><td>"+(p.fechaDeseada||"—")+"</td><td>$"+(Number(p.envio)||0)+"</td><td>"+(p.detalle||"")+"</td><td style='text-align:center'>"+p.tartas+
      "</td><td><span style='color:#b22;cursor:pointer' onclick=\"repDelPedido('"+p.id+"')\">✕</span></td></tr>"; }).join("")+"</table></div>";
}
/* ===== Proponer ===== */
/* ===== (punto 2) Opciones de local Polanco ===== */
function repTogglePolanco(){
  var w=L("rep-polFirst-wrap"); if(!w) return;
  var on=L("rep-incPolanco")&&L("rep-incPolanco").checked;
  w.style.display = on ? "flex" : "none";
  if(!on && L("rep-polFirst")) L("rep-polFirst").checked=false;
}
function repPolancoOpts(){
  return {
    incluirPolanco: !!(L("rep-incPolanco")&&L("rep-incPolanco").checked),
    polancoPrimero: !!(L("rep-polFirst")&&L("rep-polFirst").checked)
  };
}
async function repProponer(pedir){
  var res = await api("repartoProponer", repPolancoOpts());
  if(!res.ok) return toast(res.error||"Error","error");
  repEsc = res.escenarios; repIdeal = res.ideal;
  var html = repScn(repIdeal, ">>> IDEAL RECOMENDADO", true);
  if(repIdeal.k>=3){ var menos=(repEsc[repIdeal.k-1].rompe||[]).join(", ")||"n/a";
    html += "<div style='background:#fff4e0;border:1px solid #f0c97a;padding:6px;border-radius:6px;margin:6px 0;font-size:12px'><b>Aviso:</b> recomiendo "+repIdeal.k+" rutas. Con menos se rebasa: "+menos+".</div>"; }
  var shown=[repIdeal.k];
  var mostrar = pedir.concat([1,2]).filter(function(v,i,a){return a.indexOf(v)===i;}).sort();
  mostrar.forEach(function(k){ if(k!==repIdeal.k && repEsc[k]){ html += repScn(repEsc[k], "Escenario "+k+" ruta(s)", false); shown.push(k); } });
  L("rep-escenarios").innerHTML = "<div style='font-size:12px;color:var(--muted);margin-bottom:6px'>🗺️ Cada escenario muestra su recorrido en el mini-mapa de la derecha (zoom con la rueda o +/−, o \"Ampliar\"). Compara y aprieta \"Planear esta ruta\" en el que prefieras.</div>" + html;
  shown.forEach(function(k){ repPaintMap("rep-esc-map-"+k, null, _repLegsEscenario(repEsc[k])); });
}
async function repForzar(){ var n=+L("rep-forzar").value; if(!(n>=1&&n<=4))return toast("N entre 1 y 4","error");
  var res=await api("repartoProponer", repPolancoOpts()); if(!res.ok)return toast(res.error,"error"); repEsc=res.escenarios; repIdeal=res.ideal; var e=res.escenarios[n];
  L("rep-escenarios").innerHTML = repScn(e,"FORZADO a "+n+" ruta(s)",true);
  repPaintMap("rep-esc-map-"+n, null, _repLegsEscenario(e)); }
function repScn(e, titulo, ideal){
  var est = e.factible ? "<span style='color:#1d7a35'>FACTIBLE</span>" : "<span style='color:#b22'>REBASA: "+e.rompe.join(", ")+"</span>";
  var det = "<b>"+titulo+" · "+e.k+" ruta(s)</b> — "+est+" — "+e.kmT.toFixed(1)+" km";
  e.rutas.forEach(function(r,i){ var fl=[]; if(r.excCap)fl.push("+"+r.excCap+" tartas sobre cap"); if(r.excJor)fl.push("+"+Math.round(r.excJor)+" min sobre tiempo");
    det += "<div style='font-size:12px;margin:4px 0;border-left:3px solid "+REP_COLORES[i%REP_COLORES.length]+";padding-left:6px'>Chofer "+(i+1)+": "+r.tartas+" tartas · "+r.paradas+" paradas · "+r.km.toFixed(1)+" km · "+Math.round(r.dur)+" min "+(fl.length?"<span style='color:#b22'>⚠ "+fl.join("; ")+"</span>":"")+
      "<br><span style='color:#888'>Cocina → "+r.seq.map(function(p){return p.cliente;}).join(" → ")+" → Cocina</span></div>"; });
  det += "<button class='btn-sec' style='margin-top:6px' onclick='repPlanear("+e.k+")'>📌 Planear esta ruta</button>";
  var mapId = "rep-esc-map-"+e.k;
  var h = "<div style='border:"+(ideal?"2px solid #7a1f2b":"1px solid #ddd")+";border-radius:8px;padding:10px;margin-bottom:8px'>"+
    "<div style='display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start'>"+
      "<div style='flex:1;min-width:240px'>"+det+"</div>"+
      "<div style='width:300px;max-width:100%'>"+
        "<div id='"+mapId+"' style='height:200px;border-radius:10px;overflow:hidden'></div>"+
        "<button class='btn-sec' style='margin-top:6px;font-size:12px;padding:6px 10px' onclick=\"repToggleMapSize('"+mapId+"')\">⤢ Ampliar / reducir mapa</button>"+
      "</div>"+
    "</div></div>";
  return h;
}
function repToggleMapSize(mapId){
  var el=L(mapId); if(!el) return;
  el.style.height = (el.style.height==="460px") ? "200px" : "460px";
  var m=repMaps[mapId]; if(m) setTimeout(function(){ try{ m.invalidateSize(); }catch(e){} },60);
}
async function repPlanear(k){ var fecha=L("rep-fecha").value;
  var o=repPolancoOpts(); o.k=k; o.fecha=fecha;
  var res=await api("repartoPlanear",o);
  if(res.ok){ toast("Ruta planeada para "+fecha); await repReload(); L("rep-escenarios").innerHTML=""; } else toast(res.error||"Error","error"); }
/* ===== Helpers ===== */
function repAllStops(r){ return r.choferes.reduce(function(a,c){return a.concat(c.stops);},[]); }
function repEfEsperado(r){ return repAllStops(r).filter(function(s){return s.resultado==="entregada"&&!s.pagadoPrevio&&s.formaPago==="Efectivo";}).reduce(function(a,s){return a+(+s.monto||0);},0); }
function repTotMetodo(r){ var t={Tarjeta:0,Efectivo:0,Transferencia:0,Prepago:0}; repAllStops(r).filter(function(s){return s.resultado==="entregada";}).forEach(function(s){ if(s.pagadoPrevio)t.Prepago+=(+s.monto||0); else t[s.formaPago]=(t[s.formaPago]||0)+(+s.monto||0); }); return t; }
function repMapsUrl(c){ var o=encodeURIComponent("Cuajimalpa de Morelos, Ciudad de México");
  var wp=c.stops.map(function(s){return encodeURIComponent(s.dir||s.zona);}).join("%7C");
  return "https://www.google.com/maps/dir/?api=1&origin="+o+"&destination="+o+"&waypoints="+wp+"&travelmode=driving"; }
/* ===== Rutas (admin) ===== */
function repRenderRutas(){
  var cont=L("rep-rutas");
  if(!REP.rutas.length){ cont.innerHTML="<div style='font-size:12px;color:#888'>Aún no hay rutas planeadas.</div>"; return; }
  cont.innerHTML = REP.rutas.map(function(r){
    var stops=repAllStops(r), tot=stops.length;
    var ent=stops.filter(function(s){return s.resultado==="entregada";}).length;
    var fall=stops.filter(function(s){return s.resultado==="fallida";}).length;
    var repr=stops.filter(function(s){return s.resultado==="reprogramada";}).length;
    var resu=stops.filter(function(s){return s.resultado;}).length;
    var color=r.estado==="Cerrada"?"#1d7a35":(r.estado==="En ruta"?"#8a5a00":"#1d4ed8");
    var h="<div style='border:1px solid #ddd;border-radius:8px;padding:10px;margin-bottom:10px'>"+
      "<div style='display:flex;justify-content:space-between'><b>📅 "+r.fecha+" · "+r.k+" ruta(s) · "+tot+" paradas · "+r.kmT.toFixed(1)+" km</b>"+
      "<span style='color:"+color+";font-weight:700'>"+r.estado.toUpperCase()+"</span></div>"+
      "<div style='font-size:12px;color:#666'>Resueltas "+resu+"/"+tot+" · ✓"+ent+" entregadas · ✗"+fall+" fallidas · ↻"+repr+" reprog.</div>";
    r.choferes.forEach(function(c,ci){
      h+="<div style='margin-top:8px'><b>Ruta "+(ci+1)+":</b> <input value=\""+(c.nombre||"")+"\" placeholder='Nombre del chofer' "+(r.estado==="Cerrada"?"disabled":"")+" onchange=\"repSetChofer('"+r.id+"',"+ci+",this.value)\" style='width:180px'> <span style='font-size:12px;color:#888'>· "+c.stops.length+" paradas</span></div>";
      c.stops.forEach(function(s,si){
        var dis=r.estado==="Cerrada"?"disabled":"";
        var est = s.resultado==="entregada"?"✓ Entregada "+(s.horaEntrega||""):(s.resultado==="fallida"?"✗ Fallida":(s.resultado==="reprogramada"?"↻ Reprog.":"pendiente"));
        var pago = s.pagadoPrevio ? "PREPAGADO" :
          "Pago: <select "+dis+" onchange=\"repSetFP('"+r.id+"',"+ci+","+si+",this.value)\">"+["Tarjeta","Efectivo","Transferencia"].map(function(o){return "<option "+(s.formaPago===o?"selected":"")+">"+o+"</option>";}).join("")+"</select>";
        h+="<div style='display:flex;gap:8px;align-items:center;font-size:12px;border-top:1px dashed #eee;padding:4px 0;flex-wrap:wrap'>"+
          "<b>"+s.cliente+"</b> <span style='color:#888'>"+s.dir+" · 🎂 "+(s.detalle||s.tartas+"t")+" · $"+s.monto+"</span>"+
          "<span style='margin-left:auto'>"+est+"</span>"+
          "<select id=\"rar_"+r.id+"_"+ci+"_"+si+"\" "+dis+">"+[["","—"],["entregada","Entregada"],["fallida","Fallida"],["reprogramada","Reprogramar"]].map(function(o){return "<option value='"+o[0]+"' "+(s.resultado===o[0]?"selected":"")+">"+o[1]+"</option>";}).join("")+"</select>"+
          pago+"<button class='btn-sec' "+dis+" onclick=\"repSetResultado('"+r.id+"',"+ci+","+si+")\">Aplicar</button>"+
          ((r.estado!=="Cerrada" && s.resultado!=="entregada")?"<button class='btn-sec' onclick=\"repLiberarStop('"+r.id+"',"+ci+","+si+")\" style='color:#b22;border-color:#e3b2b2' title='Sacar de la ruta y devolver la tarta a inventario'>Liberar</button>":"")+"</div>";
      });
    });
    var tm=repTotMetodo(r), ef=repEfEsperado(r), efRec=(r.efectivoRecibido===""||r.efectivoRecibido==null)?"":r.efectivoRecibido;
    var dif=(efRec==="")?null:(+efRec-ef);
    h+="<div style='background:#faf7f4;padding:8px;border-radius:6px;margin-top:8px;font-size:12px'><b>Conciliación:</b> Tarjeta $"+tm.Tarjeta+" · Transferencia $"+tm.Transferencia+" · Prepago $"+tm.Prepago+" · <b>Efectivo esperado $"+ef+"</b>"+
      (ef>0?"<div style='margin-top:4px'>Efectivo recibido $<input type='number' value='"+efRec+"' "+(r.estado==="Cerrada"?"disabled":"")+" style='width:100px' onchange=\"repSetEfectivo('"+r.id+"',this.value)\"> "+(dif===null?"sin conciliar":(dif===0?"✓ cuadra":"diferencia $"+dif))+"</div>":"")+"</div>";
    var puede=stops.every(function(s){return s.resultado;})&&stops.every(function(s){return s.resultado!=="entregada"||s.confirmado;})&&(ef===0||efRec!=="")&&r.estado!=="Cerrada";
    h+="<div style='margin-top:8px;display:flex;gap:8px'><button class='btn-sec' onclick=\"repDocs('"+r.id+"')\">🧾 Documentos</button>"+
      "<button class='btn' "+(puede?"":"disabled")+" onclick=\"repCerrar('"+r.id+"')\">🔒 Cerrar ruta</button>"+
      "<button class='btn-sec' onclick=\"repDelRuta('"+r.id+"')\">Eliminar</button></div></div>";
    return h;
  }).join("");
  repRenderMapa();
}
/* ===== Mapa de rutas (Leaflet + OpenStreetMap), color por ruta ===== */
var repMaps={};
var REP_COLORES=["#C8602A","#2E5C4A","#1976D2","#C9A84C","#9C27B0","#E91E63","#00897B","#5D4037"];
// Pintor genérico reutilizable. legs = [{label, pts:[{lat,lon,popup}]}]
function repPaintMap(contId, leyId, legs){
  var cont=L(contId); if(!cont) return;
  var ley=leyId?L(leyId):null;
  var LF=window._LF||(typeof window.L==="object"?window.L:null);
  if(!LF||!LF.map){ cont.style.display="none"; if(ley) ley.style.display="none"; if(typeof toast==="function") toast("No se pudo cargar el mapa (Leaflet). Revisa tu conexión.","error"); return; }
  var hay=(legs||[]).some(function(lg){ return (lg.pts||[]).some(function(p){return p.lat&&p.lon;}); });
  if(repMaps[contId]){ try{ repMaps[contId].remove(); }catch(e){} repMaps[contId]=null; }
  if(!hay){ cont.style.display="none"; if(ley) ley.style.display="none"; return; }
  cont.style.display="block";
  var depot=(REP.depot&&REP.depot.lat)?[Number(REP.depot.lat),Number(REP.depot.lon)]:[19.3587,-99.2960];
  var map=LF.map(cont).setView(depot,12); repMaps[contId]=map;
  LF.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map);
  var bounds=[depot];
  LF.circleMarker(depot,{radius:9,color:"#7A1F2B",fillColor:"#7A1F2B",fillOpacity:1,weight:2}).addTo(map).bindPopup("🏠 <b>Cocina Cuajimalpa</b> (salida y regreso)");
  var leyenda=[];
  (legs||[]).forEach(function(lg,li){
    var col=REP_COLORES[li%REP_COLORES.length];
    var pts=[depot]; var nP=0;
    (lg.pts||[]).forEach(function(p){
      if(!p.lat||!p.lon) return;
      nP++;
      var ll=[Number(p.lat),Number(p.lon)]; pts.push(ll); bounds.push(ll);
      LF.circleMarker(ll,{radius:8,color:col,fillColor:col,fillOpacity:.9,weight:2}).addTo(map)
        .bindPopup(p.popup||"").bindTooltip(String(nP),{permanent:true,direction:"center",className:"rep-map-num"});
    });
    pts.push(depot);
    if(nP){ LF.polyline(pts,{color:col,weight:4,opacity:.8}).addTo(map);
      leyenda.push({col:col, txt:(lg.label||("Ruta "+(li+1)))+" · "+nP+" parada"+(nP!==1?"s":"")}); }
  });
  if(ley){
    ley.style.display="flex";
    ley.innerHTML = "<span style='display:inline-flex;align-items:center;gap:6px'><span style='width:12px;height:12px;border-radius:50%;background:#7A1F2B;display:inline-block'></span>Cocina Cuajimalpa</span>"+
      leyenda.map(function(e){ return "<span style='display:inline-flex;align-items:center;gap:6px'><span style='width:18px;height:4px;border-radius:2px;background:"+e.col+";display:inline-block'></span>"+e.txt+"</span>"; }).join("");
  }
  setTimeout(function(){ try{ map.invalidateSize(); if(bounds.length>1) map.fitBounds(bounds,{padding:[30,30]}); }catch(e){} },250);
}
// Legs de rutas YA planeadas
function _repLegsPlaneadas(){
  var legs=[];
  (REP.rutas||[]).filter(function(r){return r.estado!=="Cerrada";}).forEach(function(r){
    (r.choferes||[]).forEach(function(c,ci){
      legs.push({ label:"Ruta "+(ci+1)+(c.nombre?" · "+c.nombre:"")+" · "+r.fecha,
        pts:(c.stops||[]).map(function(s){ return { lat:s.lat, lon:s.lon,
          popup:"<b>"+s.cliente+"</b><br>"+(s.detalle||(s.tartas+" tartas"))+"<br>"+s.dir+
            (s.referencia?"<br><i>Ref: "+s.referencia+"</i>":"")+(s.instruccion?"<br><i>"+s.instruccion+"</i>":"")+"<br>$"+s.monto+" · "+(s.formaPago||"") }; }) });
    });
  });
  return legs;
}
function repRenderMapa(){ repPaintMap("rep-mapa","rep-mapa-leyenda", _repLegsPlaneadas()); }
// Legs de un ESCENARIO propuesto (aún no planeado)
function _repLegsEscenario(e){
  if(!e||!e.rutas) return [];
  return e.rutas.map(function(r,i){
    return { label:"Ruta "+(i+1)+" · "+r.tartas+" tartas · "+(r.km!=null?r.km.toFixed(1)+" km":""),
      pts:(r.seq||[]).map(function(p){ return { lat:p.lat, lon:p.lon,
        popup:"<b>"+p.cliente+"</b><br>"+(p.detalle||(p.tartas+" tartas"))+"<br>"+(p.dir||"") }; }) };
  });
}
function repMapEscenario(k){
  var e = (typeof repEsc!=="undefined" && repEsc) ? repEsc[k] : null;
  repPaintMap("rep-esc-mapa","rep-esc-leyenda", _repLegsEscenario(e));
}
async function repSetChofer(id,ci,val){ await api("repartoSetChofer",{id:id,ci:ci,nombre:val}); }
async function repSetFP(id,ci,si,val){ await api("repartoSetFormaPago",{id:id,ci:ci,si:si,formaPago:val}); }
async function repSetResultado(id,ci,si){ var res=L("rar_"+id+"_"+ci+"_"+si).value; if(!res)return toast("Elige resultado","error");
  var r=await api("repartoSetResultado",{id:id,ci:ci,si:si,resultado:res}); if(r.ok) await repReload(); else toast(r.error,"error"); }
async function repSetEfectivo(id,val){ await api("repartoSetEfectivo",{id:id,valor:val}); await repReload(); }
async function repCerrar(id){ var r=await api("repartoCerrarRuta",{id:id}); if(r.ok){toast(r.mensaje||"Ruta cerrada"); await repReload();} else toast(r.error||"No se pudo cerrar","error"); }
async function repDelRuta(id){ if(!confirm("¿Eliminar ruta? Los pedidos NO entregados regresan a la base para re-planearse."))return; var r=await api("repartoDelRuta",{id:id}); if(r.ok) await repReload(); }
async function repLiberarStop(id,ci,si){
  if(!confirm("¿Liberar esta tarta? Sale de la ruta y vuelve a inventario disponible. Úsalo si el pedido se canceló o cambió (aun si la ruta ya está fijada o la tarta ya se horneó)."))return;
  var r=await api("repartoLiberar",{rutaId:id,ci:ci,si:si});
  if(r.ok){ toast(r.mensaje||"Tarta liberada"); await repReload(); } else toast(r.error||"Error","error");
}
async function repDelTodasRutas(){
  var rutas=(REP.rutas||[]).filter(function(r){return r.estado!=="Cerrada";});
  if(!rutas.length){ toast("No hay rutas planeadas para limpiar"); return; }
  if(!confirm("¿Eliminar las "+rutas.length+" ruta(s) planeadas (no cerradas)? Borra los planes de prueba; no afecta ventas ya registradas."))return;
  for(var i=0;i<rutas.length;i++){ try{ await api("repartoDelRuta",{id:rutas[i].id}); }catch(e){} }
  toast("Rutas planeadas eliminadas"); await repReload();
}
async function repReprog(id,ci,si){ var f=L("rrp_"+id+"_"+ci+"_"+si).value; if(!f)return toast("Define la nueva fecha","error");
  var r=await api("repartoReprogramar",{id:id,ci:ci,si:si,fecha:f}); if(r.ok){toast("Reprogramado a "+f); await repReload();} else toast(r.error,"error"); }
/* ===== Avisos de reprogramación ===== */
function repRenderAvisos(){
  var list=[]; REP.rutas.forEach(function(r){ r.choferes.forEach(function(c,ci){ c.stops.forEach(function(s,si){ if((s.resultado==="fallida"||s.resultado==="reprogramada")&&!s.reprogramado) list.push({r:r,ci:ci,si:si,s:s}); }); }); });
  L("rep-avisosCard").querySelector("h3").innerHTML = "🔔 Avisos: entregas a reprogramar "+(list.length?"<span style='background:#fff4e0;border:1px solid #f0c97a;padding:1px 8px;border-radius:10px'>"+list.length+"</span>":"");
  if(!list.length){ L("rep-avisos").innerHTML="<div style='font-size:12px;color:#888'>Sin entregas pendientes de reprogramar.</div>"; return; }
  L("rep-avisos").innerHTML = list.map(function(o){ var s=o.s;
    return "<div style='border:1px solid #f0c97a;border-radius:8px;padding:8px;margin-bottom:6px;font-size:12px'><b>"+s.cliente+"</b> — "+(s.resultado==="fallida"?"✗ Fallida":"↻ Reprogramar")+
      "<br><span style='color:#888'>🎂 "+(s.detalle||s.tartas+"t")+" · $"+s.monto+" · "+s.dir+"</span><br>Era de la ruta del <b>"+o.r.fecha+"</b>"+
      "<div style='margin-top:4px'>Nueva fecha: <input type='date' id='rrp_"+o.r.id+"_"+o.ci+"_"+o.si+"'> <button class='btn-sec' onclick=\"repReprog('"+o.r.id+"',"+o.ci+","+o.si+")\">Reprogramar → a la base</button></div></div>"; }).join("");
}
/* ===== Cocina / Inventario (cálculo cliente desde rutas) ===== */
function repTartasPorFecha(){ var m={}; REP.rutas.forEach(function(r){ if(r.estado==="Cerrada")return; var t=repAllStops(r).reduce(function(a,s){return a+(+s.tartas||0);},0); m[r.fecha]=(m[r.fecha]||0)+t; }); return m; }
function repDias(a,b){ return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000); }
function repRenderCocina(){
  var cont=L("rep-cocina"); var hoy=L("rep-hoy").value||_hoyCDMXString();
  var need=repTartasPorFecha(), fechas=Object.keys(need).sort();
  if(!fechas.length){ cont.innerHTML="<div style='font-size:12px;color:#888'>No hay rutas que requieran producción.</div>"; return; }
  cont.innerHTML = fechas.map(function(f){ var nec=need[f], d=repDias(hoy,f), alerta=(d>=1&&d<=2);
    return "<div style='border:1px solid #ddd;border-radius:6px;padding:6px;margin-bottom:4px;font-size:12px'><b>📅 "+f+"</b> ("+(d<0?"pasada":(d===0?"HOY":d+" días"))+") · <b>"+nec+"</b> tartas a hornear "+
      (alerta?"<span style='background:#fff4e0;border:1px solid #f0c97a;padding:1px 6px;border-radius:8px'>🔔 HORNEAR</span>":(d===0?"<span style='color:#8a5a00'>⚠ HOY</span>":"en agenda"))+"</div>"; }).join("");
}
function repRenderInv(){
  var cont=L("rep-inv");
  var total=+(L("rep-stock")?L("rep-stock").value:0)||0;
  var filtro=(L("rep-inv-filtro")?L("rep-inv-filtro").value:"todo");
  var pf=repTartasPorFecha();              // {fecha: tartas} de rutas no cerradas
  var fechas=Object.keys(pf).sort();
  var ruta=fechas.reduce(function(a,k){return a+pf[k];},0), pos=total-ruta;
  var hoy=(L("rep-hoy")&&L("rep-hoy").value)||_hoyCDMXString();
  var html="";
  // Bloque RUTA — tartas para envío (puntos 4 y 5)
  if(filtro==="todo"||filtro==="ruta"){
    html+="<div style='background:rgba(122,31,43,.06);border-left:3px solid #7a1f2b;border-radius:8px;padding:10px 12px;margin-bottom:8px'>"+
      "<div style='font-weight:700;color:#7a1f2b;margin-bottom:4px'>🚚 Tartas para envío (ruta) — "+ruta+" en total</div>"+
      "<div style='font-size:11px;color:#888;margin-bottom:6px'>Se cocinan el <b>día anterior</b> a su entrega, así no compiten con la demanda de mostrador (sobre todo Cuajimalpa).</div>";
    if(!fechas.length){ html+="<div style='font-size:12px;color:#888'>Sin tartas comprometidas a ruta.</div>"; }
    else { html+=fechas.map(function(f){ var d=repDias(hoy,f);
        var coc=new Date(new Date(f+'T00:00:00').getTime()-86400000);
        var cocStr=coc.getFullYear()+'-'+String(coc.getMonth()+1).padStart(2,'0')+'-'+String(coc.getDate()).padStart(2,'0');
        var alerta=(d>=1&&d<=2);
        return "<div style='font-size:12px;padding:4px 0;border-top:1px solid rgba(0,0,0,.05)'><b>"+pf[f]+"</b> tartas · entrega <b>"+f+"</b> ("+(d<0?"pasada":(d===0?"HOY":d+" día"+(d!==1?"s":"")))+") → cocinar <b>"+cocStr+"</b>"+(alerta?" <span style='background:#fff4e0;border:1px solid #f0c97a;padding:1px 6px;border-radius:8px'>🔔 hornear</span>":"")+"</div>";
      }).join(""); }
    html+="</div>";
  }
  // Bloque TIENDA — mostrador
  if(filtro==="todo"||filtro==="tienda"){
    html+="<div style='background:rgba(46,92,74,.06);border-left:3px solid #2e5c4a;border-radius:8px;padding:10px 12px'>"+
      "<div style='font-weight:700;color:#2e5c4a;margin-bottom:6px'>🏪 Tartas para tienda (mostrador)</div>"+
      "<div style='display:flex;gap:18px;font-size:13px;flex-wrap:wrap'>"+
        "<div><b>Stock total</b><br>"+total+"</div>"+
        "<div><b>Comprometido a ruta</b><br><span style='color:#7a1f2b'>"+ruta+"</span></div>"+
        "<div><b>Disponible mostrador</b><br><span style='color:"+(pos<0?'#b22':'#1d7a35')+"'>"+pos+"</span></div>"+
      "</div>"+
      (pos<0?"<div style='background:#fbe6e6;color:#b22;padding:6px;border-radius:6px;margin-top:6px;font-size:12px'>⚠ Faltan "+(-pos)+" tartas: lo comprometido a ruta supera el stock de mostrador.</div>":"")+
      "</div>";
  }
  cont.innerHTML=html;
}
/* ===== Vista de chofer (admin puede verla también — punto 3) ===== */
function repSetRol(rol){ repVista.rol=rol; var cs=L("rep-choferSel");
  if(rol==="Chofer"){
    var opts=[];
    (REP.rutas||[]).forEach(function(r){ (r.choferes||[]).forEach(function(c,ci){
      var nom=(c.nombre&&c.nombre.trim())?c.nombre.trim():("Ruta "+(ci+1)+" sin asignar");
      opts.push("<option value=\""+r.id+"|"+ci+"\">"+r.fecha+" · "+nom+" · "+c.stops.length+" paradas</option>");
    }); });
    cs.innerHTML = opts.length?opts.join(""):"<option value=''>(no hay rutas planeadas)</option>";
    cs.style.display=""; repVista.choferKey=cs.value; L("rep-overlay").style.display="block"; repRenderChofer();
  } else { cs.style.display="none"; L("rep-overlay").style.display="none"; }
}
function repRenderChofer(){
  var cont=L("rep-choferCont");
  var perms=(typeof getPermisos==="function")?(getPermisos()||{}):{};
  var bloques=[], titulo;
  if(perms.esChofer){
    var nombre=S.usuario;
    (REP.rutas||[]).forEach(function(r){ (r.choferes||[]).forEach(function(c,ci){ if((c.nombre||"").trim().toLowerCase()===(nombre||"").trim().toLowerCase()) bloques.push({r:r,c:c,ci:ci}); }); });
    titulo="🍰 Mi ruta — "+(nombre||"");
    if(!bloques.length){ cont.innerHTML="<h2 style='color:#7a1f2b'>"+titulo+"</h2><p style='color:#888'>No tienes rutas asignadas todavía.</p>"; return; }
  } else {
    var sel=L("rep-choferSel"); if(sel && sel.style.display!=="none" && sel.value) repVista.choferKey=sel.value;
    var key=repVista.choferKey;
    if(key){ var pp=String(key).split("|"); var rid=pp[0], cci=parseInt(pp[1]);
      (REP.rutas||[]).forEach(function(r){ if(r.id===rid && r.choferes[cci]) bloques.push({r:r,c:r.choferes[cci],ci:cci}); }); }
    titulo = bloques.length ? ("🍰 Vista del chofer — "+(bloques[0].c.nombre||("Ruta "+(bloques[0].ci+1)))) : "🍰 Vista del chofer";
    if(!bloques.length){ cont.innerHTML="<h2 style='color:#7a1f2b'>"+titulo+"</h2><p style='color:#888'>Elige una ruta en el selector de arriba. Si no aparece ninguna, todavía no hay rutas planeadas.</p>"; return; }
  }
  cont.innerHTML = repRenderChoferHTML(titulo, bloques);
}
function repRenderChoferHTML(titulo, bloques){
  var h="<h2 style='color:#7a1f2b'>"+titulo+"</h2>";
  bloques.forEach(function(o){ var r=o.r,c=o.c,ci=o.ci;
    h+="<div style='border:1px solid #ddd;border-radius:10px;padding:12px;margin:10px 0;max-width:680px'><div style='display:flex;justify-content:space-between'><b>📅 "+r.fecha+"</b><a target='_blank' style='color:#fff;background:#7a1f2b;padding:3px 8px;border-radius:6px;text-decoration:none' href='"+repMapsUrl(c)+"'>🗺️ Google Maps</a></div>";
    c.stops.forEach(function(s,si){ var dis=r.estado==="Cerrada"?"disabled":"";
      var est=s.resultado==="entregada"?"✓ Entregada "+(s.horaEntrega||""):(s.resultado==="fallida"?"✗ Fallida":(s.resultado==="reprogramada"?"↻ Reprog.":"por entregar"));
      h+="<div style='border-top:1px dashed #eee;padding:8px 0;font-size:13px'><b>"+s.cliente+"</b> — "+est+"<br><span style='color:#888'>📍 "+s.dir+(s.referencia?" · "+s.referencia:"")+(s.tel?" · 📞 "+s.tel:"")+"</span>"+(s.instruccion?"<br><span style='color:#888'>📝 "+s.instruccion+"</span>":"")+"<br><b>🎂 "+(s.detalle||s.tartas+"t")+"</b> · 🎂 $"+s.monto+(Number(s.envio)>0?(" + 🚚 $"+s.envio+" = $"+((Number(s.monto)||0)+(Number(s.envio)||0))):"")+" · "+(s.esLocal?"LOCAL (sin venta)":(s.pagadoPrevio?"PREPAGADO":"cobrar"))+
        "<div style='margin-top:4px'>Resultado: <select id='crr_"+r.id+"_"+ci+"_"+si+"' "+dis+">"+[["","—"],["entregada","Entregada"],["fallida","Fallida (nadie)"],["reprogramada","Reprogramar"]].map(function(opt){return "<option value='"+opt[0]+"' "+(s.resultado===opt[0]?"selected":"")+">"+opt[1]+"</option>";}).join("")+"</select> "+
        "Pago: <select id='cpp_"+r.id+"_"+ci+"_"+si+"' "+dis+">"+["Tarjeta","Efectivo","Transferencia"].map(function(opt){return "<option "+(s.formaPago===opt?"selected":"")+">"+opt+"</option>";}).join("")+"</select> "+
        "<button class='btn' "+dis+" onclick=\"repChoferConfirm('"+r.id+"',"+ci+","+si+")\">Confirmar y guardar</button></div></div>"; });
    h+="</div>";
  });
  return h;
}
async function repChoferConfirm(id,ci,si){ var res=L("crr_"+id+"_"+ci+"_"+si).value; if(!res)return toast("Elige el resultado","error");
  var fp=L("cpp_"+id+"_"+ci+"_"+si).value;
  var r=await api("repartoSetResultado",{id:id,ci:ci,si:si,resultado:res,formaPago:fp});
  if(r.ok){ toast("Guardado"); await repReload(); repRenderChofer(); } else toast(r.error,"error"); }
/* ===== Documentos de chofer (imprimible) ===== */
function repDocs(id){
  var r=null; REP.rutas.forEach(function(x){if(x.id===id)r=x;});
  if(!r)return;
  var w=window.open("","_blank");
  var html="<html><head><meta charset='utf-8'><title>Hojas de ruta "+r.fecha+"</title><style>body{font-family:sans-serif}.hoja{padding:24px;page-break-after:always}.hoja:last-child{page-break-after:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px}th{background:#f3ece8}@media print{button{display:none}}</style></head><body><button onclick='window.print()'>Imprimir / PDF</button>";
  r.choferes.forEach(function(c){
    var nom=(c.nombre&&c.nombre.trim())?c.nombre.trim():("Chofer "+c.idx);
    html+="<section class='hoja'><h2>🍰 Tarta Vasca — Hoja de ruta</h2><div>Fecha: <b>"+r.fecha+"</b> · Chofer: <b>"+nom+"</b> · Salida: Cocina Cuajimalpa · Canal: Ruta</div><table><tr><th>#</th><th>Cliente</th><th>Dirección / referencia</th><th>Contacto</th><th>Tartas</th><th>Monto</th><th>Envío</th><th>Total</th><th>Pago</th><th>¿Pagó?</th></tr>";
    c.stops.forEach(function(s,i){
      var dirCol = s.dir + (s.referencia?"<br><i>Ref: "+s.referencia+"</i>":"") + (s.instruccion?"<br><i>"+s.instruccion+"</i>":"");
      html+="<tr><td>"+(i+1)+"</td><td>"+s.cliente+"</td><td>"+dirCol+"</td><td>"+(s.tel||"—")+"</td><td>"+(s.detalle||s.tartas)+"</td><td>$"+s.monto+"</td><td>$"+(Number(s.envio)||0)+"</td><td>$"+((Number(s.monto)||0)+(Number(s.envio)||0))+"</td><td>"+s.formaPago+"</td><td>"+(s.pagadoPrevio?"Prepagado":(s.resultado==="entregada"?"Cobrado":"Pendiente"))+"</td></tr>";
    });
    html+="</table></section>";
  });
  html+="</body></html>";
  w.document.write(html);
  w.document.close();
}
/* ===== (Adecuaciones) Envio en reparto ===== */
async function repCargarZonasEnvio(){
  if(!S.zonasEnvio || !S.zonasEnvio.length){ try{ await cargarZonasEnvio(); }catch(e){} }
  var sel=L("rep-envio-zona"); if(!sel) return;
  var act=(S.zonasEnvio||[]).filter(function(z){return z.activo;});
  sel.innerHTML = "<option value=''>- Selecciona zona -</option>" + act.map(function(z){ return "<option value='"+z.costo+"'>"+z.nombre+" - $"+z.costo.toLocaleString('es-MX')+"</option>"; }).join("");
}
function repZonaEnvioChange(){
  var sel=L("rep-envio-zona"); if(!sel) return;
  var c=parseInt(sel.value||"0")||0;
  if(L("rep-envio")) L("rep-envio").value=c;
  repEnvioInfo();
}
function repEnvioInfo(){
  var el=L("rep-envio-info"); if(!el) return;
  var subtotal=(REP.tartasActuales||[]).reduce(function(a,t){return a+t.precio*t.cantidad;},0);
  var inp=L("rep-envio");
  if(subtotal>=1500){
    if(inp){ inp.value=0; inp.disabled=true; }
    el.innerHTML="<span style='color:var(--success)'>✓ Envío gratis (pedido ≥ $1,500)</span>";
  } else {
    if(inp) inp.disabled=false;
    var env=parseFloat(inp?inp.value:0)||0;
    el.innerHTML = env>0 ? ("Envío: <strong>$"+env.toLocaleString('es-MX')+"</strong> — se suma al total (1 por pedido)") : "<span style='color:var(--muted)'>Captura el costo de envío (1 por pedido). Selecciona zona o escríbelo.</span>";
  }
}
/* ===== (Adecuacion 2) Apartados ===== */
var AP = { tartas: [] };
function apPoblar(){
  if(!S.catalogo) return;
  var sab=(S.catalogo.sabores||[]).filter(function(s){return s.activo;}).map(function(s){return s.nombre;});
  var tam=(S.catalogo.tamanos||[]).filter(function(t){return t.activo;}).map(function(t){return t.nombre;});
  if(L("ap-sabor")) L("ap-sabor").innerHTML=sab.map(function(n){return "<option>"+n+"</option>";}).join("");
  if(L("ap-tamano")) L("ap-tamano").innerHTML=tam.map(function(n){return "<option>"+n+"</option>";}).join("");
  var sucSel=L("ap-suc"), perms=(typeof getPermisos==="function"?getPermisos():{})||{};
  if(sucSel){
    var sucs = perms.puedeVerAmbas ? ((S.catalogo.sucursales||[]).filter(function(s){return s.activo;}).map(function(s){return s.nombre;})) : [S.sucursal];
    sucSel.innerHTML=sucs.map(function(n){return "<option>"+n+"</option>";}).join("");
    var g=L("ap-suc-group"); if(g) g.style.display = perms.puedeVerAmbas ? "" : "none";
  }
  apPrecio();
}
function apPrecio(){
  var sabor=L("ap-sabor")?L("ap-sabor").value:"", tamano=L("ap-tamano")?L("ap-tamano").value:"";
  var cant=parseInt(L("ap-cant")?L("ap-cant").value:1)||1;
  var pr=(typeof repPrecioTarta==="function")?repPrecioTarta(sabor,tamano):0;
  var el=L("ap-tarta-precio");
  if(el) el.innerHTML = pr>0 ? ("$"+pr.toLocaleString('es-MX')+" × "+cant+" = <strong>$"+(pr*cant).toLocaleString('es-MX')+"</strong>") : "<span style='color:var(--muted)'>sin precio</span>";
}
function apAddTarta(){
  var sabor=L("ap-sabor").value, tamano=L("ap-tamano").value, cant=parseInt(L("ap-cant").value)||0;
  if(!sabor||!tamano) return toast("Selecciona sabor y tamaño","error");
  if(cant<1) return toast("Cantidad inválida","error");
  var pr=(typeof repPrecioTarta==="function")?repPrecioTarta(sabor,tamano):0;
  AP.tartas.push({sabor:sabor,tamano:tamano,cantidad:cant,precio:pr});
  L("ap-cant").value=1; apRenderTartas();
}
function apQuitar(i){ AP.tartas.splice(i,1); apRenderTartas(); }
function apRenderTartas(){
  var el=L("ap-tartas-list"); if(!el) return;
  var t=AP.tartas||[];
  el.innerHTML = !t.length ? "<div style='font-size:12px;color:var(--muted)'>Sin tartas.</div>" :
    t.map(function(it,i){ return "<div class='rep-tarta-row'><div style='flex:1'><strong>"+it.cantidad+"×</strong> "+it.sabor+" "+it.tamano+"</div><span style='color:var(--accent);margin-right:10px'>$"+(it.precio*it.cantidad).toLocaleString('es-MX')+"</span><button class='btn-remove' onclick='apQuitar("+i+")'>×</button></div>"; }).join("");
  var tot=t.reduce(function(a,x){return a+x.precio*x.cantidad;},0);
  if(L("ap-total")) L("ap-total").innerHTML = t.length ? ("Total apartado: <strong>$"+tot.toLocaleString('es-MX')+"</strong>") : "";
}
async function cargarApartados(){
  if(!S.catalogo){ try{ await cargarCatalogo(); }catch(e){} }
  apPoblar();
  if(L("ap-fecha")&&!L("ap-fecha").value){ var m=new Date(); m.setDate(m.getDate()+1); L("ap-fecha").value=m.getFullYear()+"-"+String(m.getMonth()+1).padStart(2,"0")+"-"+String(m.getDate()).padStart(2,"0"); }
  apRenderTartas();
  await apReload();
}
async function apReload(){
  var res=await api("getApartados");
  var cont=L("ap-list");
  if(!res||!res.ok){ if(cont) cont.innerHTML="<div style='font-size:12px;color:var(--muted)'>No se pudo cargar.</div>"; return; }
  var ap=res.apartados||[];
  if(L("ap-cnt")) L("ap-cnt").textContent=ap.length;
  if(!cont) return;
  cont.innerHTML = !ap.length ? "<div style='font-size:12px;color:var(--muted)'>Sin apartados pendientes.</div>" :
    ap.map(function(a){
      var its=a.items.map(function(it){return it.cantidad+"× "+it.sabor+" "+it.tamano;}).join(" · ");
      return "<div style='border:1px solid var(--warm);border-radius:8px;padding:10px;margin-bottom:8px'>"+
        "<div style='display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px'><div><b>"+(a.clienteNombre||"Cliente")+"</b> · 📅 entrega <b>"+(a.fechaEntrega||"—")+"</b></div><div style='color:var(--accent);font-weight:700'>$"+a.total.toLocaleString('es-MX')+"</div></div>"+
        "<div style='font-size:12px;color:var(--muted);margin-top:4px'>"+its+" · "+a.sucursal+(a.anticipo>0?(" · anticipo $"+a.anticipo.toLocaleString('es-MX')):"")+"</div>"+
        "<div style='margin-top:6px;display:flex;gap:8px;flex-wrap:wrap'><button class='btn-sec' onclick=\"apConvertir('"+a.idVenta+"')\">✓ Entregar (convertir a venta)</button><button class='btn-sec' onclick=\"apLiberar('"+a.idVenta+"')\">Liberar</button></div>"+
      "</div>"; }).join("");
}
async function apGuardar(){
  var cli=L("ap-cli").value.trim();
  if(!cli) return toast("Falta el cliente","error");
  if(!L("ap-fecha").value) return toast("La fecha de entrega es obligatoria","error");
  if(!AP.tartas.length) return toast("Agrega al menos una tarta","error");
  var perms=(typeof getPermisos==="function"?getPermisos():{})||{};
  var suc = (perms.puedeVerAmbas && L("ap-suc")) ? L("ap-suc").value : S.sucursal;
  var items=AP.tartas.map(function(t){return {sabor:t.sabor,tamano:t.tamano,cantidad:t.cantidad,precioUnitario:t.precio};});
  var res=await api("registrarApartado",{
    items:items, tipoOp:"reserva", canal:"Apartado",
    metodoPago:L("ap-metodo").value, anticipo:parseFloat(L("ap-anticipo").value)||0,
    fechaEntrega:L("ap-fecha").value, sucursal:suc,
    cliente:{nombre:cli, telefono:L("ap-tel").value.trim()},
    opId: opIdNuevo()
  });
  if(res.ok){
    if(res.mensaje && res.mensaje.indexOf("⚠️")!==-1) toast(res.mensaje,"error");
    else toast("📦 Apartado guardado");
    L("ap-cli").value=""; L("ap-tel").value=""; L("ap-anticipo").value=0; AP.tartas=[]; apRenderTartas();
    await apReload();
  } else toast(res.error||"Error","error");
}
async function apConvertir(id){
  if(!confirm("¿Marcar como entregado y convertir a venta?")) return;
  var res=await api("convertirReservaAVenta",{idVenta:id,canal:"Mostrador"});
  if(res.ok){ toast("✅ Apartado entregado"); await apReload(); } else toast(res.error||"Error","error");
}
async function apLiberar(id){
  if(!confirm("¿Liberar (cancelar) este apartado?")) return;
  var res=await api("liberarReserva",{idVenta:id,motivo:"Apartado liberado"});
  if(res.ok){ toast("Apartado liberado"); await apReload(); } else toast(res.error||"Error","error");
}
/* ===== Notas del creador (Owner) ===== */
async function notaEnviar(){
  var tipo=(L("nota-tipo")?L("nota-tipo").value:"Error");
  var seccion=(L("nota-seccion")&&L("nota-seccion").value||"").trim();
  var pestana=(L("nota-pestana")&&L("nota-pestana").value||"").trim();
  var subp=(L("nota-subpestana")&&L("nota-subpestana").value||"").trim();
  var quepaso=(L("nota-quepaso")&&L("nota-quepaso").value||"").trim();
  var quedebio=(L("nota-quedebio")&&L("nota-quedebio").value||"").trim();
  var ejemplo=(L("nota-ejemplo")&&L("nota-ejemplo").value||"").trim();
  var partes=[];
  if(seccion) partes.push("Sección: "+seccion);
  if(pestana||subp) partes.push("Pestaña: "+(pestana||"-")+(subp?(" / Sub-pestaña: "+subp):""));
  if(quepaso) partes.push("Qué pasó: "+quepaso);
  if(quedebio) partes.push("Qué debió pasar: "+quedebio);
  if(ejemplo) partes.push("Ejemplo: "+ejemplo);
  var texto=partes.join("\n");
  if(!texto){ toast("Escribe al menos qué pasó.","error"); return; }
  var btn=L("nota-btn"); if(btn){ btn.disabled=true; btn.textContent="Enviando..."; }
  var fotoData="";
  try{ fotoData=await _notaLeerFotoResize(); }catch(e){ fotoData=""; }
  var res=await api("registrarNota",{tipo:tipo, texto:texto, foto:fotoData});
  if(btn){ btn.disabled=false; btn.textContent="Enviar comentario"; }
  if(res&&res.ok){
    toast(res.mensaje||"Nota enviada");
    ["nota-seccion","nota-pestana","nota-subpestana","nota-quepaso","nota-quedebio","nota-ejemplo"].forEach(function(id){ if(L(id)) L(id).value=""; });
    if(L("nota-foto")) L("nota-foto").value="";
    if(L("nota-foto-prev")) L("nota-foto-prev").innerHTML="";
    cargarNotas();
  } else { toast((res&&res.error)||"Error al enviar","error"); }
}
function _notaPrevFoto(){
  var inp=L("nota-foto"), prev=L("nota-foto-prev");
  if(!inp||!prev) return;
  if(!inp.files||!inp.files[0]){ prev.innerHTML=""; return; }
  var r=new FileReader();
  r.onload=function(e){ prev.innerHTML='<img src="'+e.target.result+'" style="max-width:160px;max-height:120px;border-radius:8px;border:1px solid var(--border)">'; };
  r.readAsDataURL(inp.files[0]);
}
function _notaLeerFotoResize(){
  return new Promise(function(resolve){
    var inp=L("nota-foto");
    if(!inp||!inp.files||!inp.files[0]){ resolve(""); return; }
    var reader=new FileReader();
    reader.onload=function(e){
      var img=new Image();
      img.onload=function(){
        var max=1200, w=img.width, h=img.height;
        if(w>max||h>max){ if(w>=h){ h=Math.round(h*max/w); w=max; } else { w=Math.round(w*max/h); h=max; } }
        var c=document.createElement("canvas"); c.width=w; c.height=h;
        c.getContext("2d").drawImage(img,0,0,w,h);
        try{ resolve(c.toDataURL("image/jpeg",0.7)); }catch(err){ resolve(""); }
      };
      img.onerror=function(){ resolve(""); };
      img.src=e.target.result;
    };
    reader.onerror=function(){ resolve(""); };
    reader.readAsDataURL(inp.files[0]);
  });
}
async function cargarNotas(){
  var res=await api("getNotas",{limite:30});
  var cont=L("nota-list"); if(!cont) return;
  if(!res.ok){ cont.innerHTML="<div style='font-size:12px;color:var(--muted)'>No se pudieron cargar.</div>"; return; }
  var notas=res.notas||[];
  if(L("nota-cnt")) L("nota-cnt").textContent=notas.length;
  cont.innerHTML = !notas.length ? "<div style='font-size:12px;color:var(--muted)'>Sin notas todavia.</div>" :
    notas.map(function(n){
      var ic = n.tipo==="Idea" ? "💡" : "🐞";
      var col = (n.estado==="resuelta"||n.estado==="cargada") ? "#1d7a35" : (n.tipo==="Idea"?"#8a5a00":"#b22");
      var badge = "<span style='font-size:11px;color:"+col+";font-weight:700'>"+(n.estado||"nueva").toUpperCase()+"</span>";
      var esAdmin = ((typeof getPermisos==="function"?getPermisos():{})||{}).esAdmin;
      var acc = (esAdmin && n.estado==="nueva") ? "<button class='btn-sec' onclick=\"notaResolver('"+n.id+"')\" style='font-size:11px;padding:4px 8px'>Marcar atendida</button>" : "";
      return "<div style='border-top:1px dashed #eee;padding:8px 0;display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap'>"+
        "<div style='flex:1;min-width:200px'><div style='font-size:11px;color:var(--muted)'>"+ic+" "+n.tipo+" · "+String(n.fecha||"").replace('T',' ').substring(0,16)+" · "+badge+"</div>"+
        "<div style='font-size:13px;margin-top:2px;white-space:pre-wrap'>"+String(n.texto||"").replace(/</g,'&lt;')+"</div>"+
        (n.foto? "<div style='margin-top:4px'><a href='"+String(n.foto).replace(/'/g,'%27')+"' target='_blank' rel='noopener' style='font-size:12px'>📷 Ver pantallazo</a></div>" : "")+
        "</div>"+acc+"</div>";
    }).join("");
}
async function notaResolver(id){
  if(!confirm("¿Marcar esta nota como atendida?")) return;
  var res=await api("setNotaEstado",{id:id, estado:"resuelta"});
  if(res.ok){ toast("Nota actualizada"); cargarNotas(); } else toast(res.error||"Error","error");
}
/* ===== (Adecuacion 3) Produccion para manana (ruta + apartados) ===== */
async function cargarProduccionManana(){
  var f=L("prodman-fecha");
  if(f&&!f.value){ var m=new Date(); m.setDate(m.getDate()+1); f.value=m.getFullYear()+"-"+String(m.getMonth()+1).padStart(2,"0")+"-"+String(m.getDate()).padStart(2,"0"); }
  var fecha=f?f.value:"";
  var res=await api("getProduccionManana", fecha?{fecha:fecha}:{});
  var cont=L("prodman-list"); if(!cont) return;
  if(!res||!res.ok){ cont.innerHTML="<div style='font-size:12px;color:var(--muted)'>No se pudo cargar.</div>"; return; }
  if(!res.items.length){ cont.innerHTML="<div style='font-size:12px;color:var(--muted)'>Nada que hornear para "+res.fecha+".</div>"; return; }
  cont.innerHTML = "<div style='font-weight:700;margin-bottom:6px'>📅 Entrega "+res.fecha+" — "+res.totalTartas+" tartas</div>"+
    res.items.map(function(x){ var m=[]; if(x.ruta)m.push("ruta "+x.ruta); if(x.apartado)m.push("apartado "+x.apartado);
      return "<div style='border:1px solid var(--warm);border-radius:6px;padding:6px 10px;margin-bottom:4px;font-size:13px'><b>"+x.cantidad+"×</b> "+x.sabor+" "+x.tamano+" <span style='color:var(--muted);font-size:11px'>("+m.join(", ")+")</span></div>"; }).join("");
}
