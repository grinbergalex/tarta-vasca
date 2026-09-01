// ============================================================================
// RECIBOS DIGITALES (PDF a Drive + link para WhatsApp) — 2026-06-28
// Encabezado configurable en la hoja "Configuración" (Parámetro/Valor):
//   negocio_nombre, negocio_telefono, negocio_instagram,
//   negocio_direccion_cuajimalpa, negocio_direccion_polanco
// ============================================================================
function _cfgVal(ss, clave, def){
  try{ var h=ss.getSheetByName("Configuración"); if(!h) return def; var d=h.getDataRange().getValues();
    for(var i=1;i<d.length;i++){ if(String(d[i][0])===clave){ var v=d[i][1]; return (v===""||v==null)?def:v; } } }catch(e){}
  return def;
}
function _ensureFolderRecibos(){
  var it=DriveApp.getFoldersByName("Recibos Tarta Vasca");
  return it.hasNext()? it.next() : DriveApp.createFolder("Recibos Tarta Vasca");
}
// Logo de la marca ya preparado para termica: monocromo puro a 460 puntos de
// ancho. La impresora no reproduce grises, asi que el original en gris claro se
// paso por umbral; va embebido para que el recibo no dependa de la red al
// imprimir. Si se vacia esta constante, el recibo cae al nombre en texto.
var LOGO_RECIBO_B64 = "iVBORw0KGgoAAAANSUhEUgAAAcwAAAFyAQAAAABQYNcuAAANS0lEQVR42u1cTYwcxRX+uqfxdGDxDpDAGDmeRnBIpBAtQUocYjyNg4BDlCDlgnLJJiIJUqRoI+VAkOIpG0fsAWU3iiIFBcULWIgDB5QLHAg0XsteRZa9hihSAti93sUeFBN6dhe7Z6ipl0P/TNVMT29Phb+EndNU73z9Xr169eq9V++tQdD8tExofz6ZUFcbSjlQI1/C3ZKmhJdcQ2+uLRuLQg8a+Ne80NUSU/MqwLHcPBkO+YhS+3dr5zkN/QRDqa5OAPA5VkZnuLQFY917gK06YiKGCQOBBvQcpkpMR4cXwAwXPnB2ZOhtNiIVXRwZutMKMAGEo8+VXLgWR2DiOa1NJ+Dm7bph0CPaVsI4ihBACMFGpvor10F4YnvQHZXqKqZ88IpzrT8ywyfZ+BTH7h1bRGfUTbejfubkEhERza+NuOlu8FGNvk0M1ygrWyEqgWMDAMZWxpC8ppiEd8KvRN9OA+DFoYI54WL6EuDNUaiObZuLv20BcJwVhpoMFVl3r/ZG0aZxmdAT2ock/bMwtO2qDIovukXXNVxSx/zQtqLQS30CNZauMwsy3MQX1uVxx6aic/Vw/TPKkVcBK7hzyvWgpowprBfcOa+748oWn0bbK0g16Bufp+Wi+9XuG1ezT8osqMUGT6BiDJ8XA0KptYsxzI1+O0gOFWP4TUz1b/1M/ykDeho7+/lgzWLQ3+P6vidvZx7QGdDLUOl7UoFXCEoWu9i/0HTILwIV/ov9dtcSblBkv5Z+NGCxzc4DL0wUUYll3hh4dHJw6wQZVmLr4CQOfc4tJOHy4L62u6yQDotdA49O3pqhw1m+/45BBbDDYr7//YOsVQvu1z2Dj5xC0GncNKgmbqGtXqJ3B551iV4eENMAVPwyOxSoFff9+z5nCzDMw0aGvX7JrBegyvZlEDj8M3fjncP/yDK0pDxd3pjhdrmVfH2l9/RMq4Ax3fJiGtm83gsGndUiKnFz+u0NyYSuFIGOpQK5i7G8o2MQaqa+u3FD7+lsEaiRkvJ69qjlFNo5vT3X26S2O5LL9b68wKxQhiCIjT8Zy5/PyRRkWYn02GCknw0xIeIDozQalMOCWdGiKjyAVTQyBER8/KSoXdLIEAClP1cGHaGCYvqaKyabWgwT1Tgd02IYYGam7S6yri4wyuLIoWMgSPKvN4SqR9reURRxUXFJX0wX5x8bQ19WUmsv5KT2BqCutDO5aaSI0sZQaTVoNtyaumn+xiohBdgXb13LfD5MJaSTJDiX65uZOY7/uan14QFBvjZduVPbwFw+JEgvAL1Qy6Wam25tXap+DAlt0w91oTYLNKHeRTQ1of4pb1ET2q6X5/Sg9ICZl4DPXdf2FZ9Zy1lXa/jfOuWVJzXX9Xn4ezSh7i4v1ITapekjetBu6E/o6vC04dkf/aWMl3tY5UHNFRuaVuK9ailwfC0rYb+vPVezM6ELNUhfwo/4eZ7EkExt9HmwCl9XJYJ8hvNuQOzqv43hLLfzXK5jgp8hTZers39W0zatVK4wNM8csSYqeouDccGmNKH2RW9ed6tfZWhqE6zKlcLUo/raL57cr+tLTL7yuCY03IoLmnN1LwPTpGpZebFKLnQ235rmBWbXApN66t/5JpZ9vaPZNE+8p2lg6I5wt/ZxxT+G8gPKVYhcqJW7NLlQA4vac/UuaEN9Uxu6Mqc9V/K0qXaF+79XzKKf+fn0zBX6kSQZ2qVRxqaEN6Gb0E3oJvT/FNoyDMMwhrl0+0wA+xwdqi4AuMOgZSoPP7Icc3iJq4lqlG7J/lQAwMmejhlMIi72ygwm8xx8MAC2p3FWmkZujJUXfJmmtpdjWrnHd947zeawy78NuTaH3iVEEsqJV+KLOHnRWVEddobWCGD4LdCHvenYKFD6oKiK/85KLH4E1ejig5orjQIdVL25otBwZIa7FgC0kqC1bSt3b2QBMGwAZLgAyIwu28pxHQ4RedgFjBORX4pSfj4R1YlCEIVAgyhAmYhCSMnAU+8CXbYHPGL5qdM9TXSBZsDQJDYLtEQHQDNkPYbvAsN693a/HDRCgB4lRchP2R6WMRUCTxsNAE/BS6FUtT0E3IvzNWKiwuSr/QMWcARjHJiGC+CA5afQjgNgrp1kidZVLepW4WMaJkAVOEC3Kkk4dAFiFxM7FDApDw9wB6AKDAbhoBKNU+gigw+kXDwhHSaCoekmGs1d2EDTNYMU+gosSLcL+9X8ls/MQEh732c9qrQ/3l6GpB+9W8w70svZELDicQxdVW1t321B20wPvlZvHD+ctQHASQyj08up+QAWLAA8SHV3wZJ1eEKRqJK46UYVz1ZSrGTEFdBmag24bBNYsoGseI4CCIGxdM4ihfb5IaXBSxbItfGeRHWLuk/Hepn7IDoIOUwun9U8hT6oZvkD+QDrYDcQxkaLAYjH5rBaooX+qng1NF+Vofep5uw51Yo8CzAmXXQ/K0HJyS1ym42EQ9I4hXbU364zxcp1HcCVzu+uI0Hb6vK8Jr0FAPcARzpnuSdBX0Vmb4ORVJoCFS5XnkrQb6lS+oP6pqcB2EIdJ9CumkTuOMphQNMAtlB6ING0BOWT6hHgKa6EmABggCVmTkxI0KYqpVMqv5GVY54yTqDL6m+Pqs5EZOV6qxNIBqa/W2RaHUYv7q3OsqRopP5WEpoAgDsj85Kuzp0StO/OhzuKK0Fxi0SyOtHYzPhtZNAlZyJ+sZlocDQ2B36rGn/5xUbigEVjM/O3S6ozkbyYeZFBiMbmwG8B4LDqSiQvdhWmRnIv1ZtcM4MMcEAt5El4qgQyj+bAb1PhD/Kf1POaBX1ENhgEeBK0j4yiIOT2eOIjeaYV9cdhb3ojSdhQru02hnrDXExzQ+0H6zkHDVkyG1MVwxzrDaH20GjrQ00u+MMKtTeGdodV3pkb3b5nNvDkUPWH+vSkLya3H2rmMLkan3addCMZKZRiloLswoNQ2jBGJGMOIIQ59BLQV2cUxs+8Pob7QnKzL9bZ2xNQxU9XyMwgRDkKZA9IeG/EdsSNMLi0IBZQBwTAgCNAALBobAJCAHV58Tj29iRlRGLlgAcwWCEIDpMcPTAEYUTU9kIQ4EtSdjyEHD5gw+QQDB5CDjPi1JnDoXSyAVwX98j2aRGvAgGoAqOL9+IxongtKIutJUKNiHjdo2Ccby/HhRzjRGGJygYvUdggYvV54iUqGwGIAjSIAzVDoExEomZQCOwt9aACGGcCDZ+IfIxH4wBEPhpEQGNfBCWUSQD0cAydISKg7pGHEhGFqBEx1P2ppCLFK6WlJl6diJWV6hPfSEAkEI+DDSt78Onpzd+EbkI3oZvQbMd7BOjZjjZ07gw0awjoqrfLmia8M2HpMtz0Cvy2L+thZgbNQ5zqIAv6rQ0qqKII3cuAUqWQYDLDBgdtObBpZ3ZonFtU0ktmmlKRPee+VEM3muRCnNn+kwxtA6tSYgbn+tLj0ZtnXCXJEi3n6lasbE+KVgHcpRaw/2txAgDtiAX9PZnqSi8htro4ePkWT+52Frcqy40nx4jGk2rY2mCb5UydiIjHvSet83Jh7EJveY45gHhIpTruAkB3XbnuiqnWiCctlNsbROF5lWrUS9s6GbeHH+wrx43jAdrOgLZ65URRqLN6b+w1z8lictI6YvH1RFSS7t4W6Xms/cdciWGpQZ2fJ6KjagNoGPVtPRoPq5n1wxy8CeComlZpRwv365jWNlmH0972i2jfC2BM1UPzOQCguLNbfFVR/x9E05gzo67Gn6pr807ERJLRe0bJTrhLEZ0xftoDzlhpr2ybAaHPolTcGqsAxCvHZWideVeT3YXzlgGTvlzlwJkuWweaWHL/Oo8qAO4GFJLd2Tn5EleCFYIAP4i5uwhi3QkBgyMAluHj5UfpQhcILUNMdhCeYkwJQg3/as5COFur4od8ylsHTMyuABaOu7+pCLcLBMzgNljrMOxAMeE7nPZ0cNqddfhN4c/RBI6H4QKwwA7QVoff2QEw5Yez7emzR3D5igyl9SMtzN3fvd5ts9aTWASw6M4CoGDvZ902WweWpnb/FqcwP03v3Cd3ewmUvYOGHzgN/25WFnWiGZyrE82EduCSNz5D9LAPg9hBuxaiIbdE+9bd2x6/kZdsOn6iejdvEHmGT0QzrcfO2jQ9UyMqs/m2uOXxO+qtcVkRu843Hvvxyt/MsRa+u/qTezgDnMPXAMDfv3/z23i+OwlcN7MLnW+v/AUXA3m/+iCf5omoJepLdHA5thxE3jivr/GGR0Q7axQaNC8aM0oPN7sl6V8Liehgr8PRrxOtBXSJiMI6iTIR31tToKXk31asLRFRTW31Ph/9MYx3ZfL/AqK50tiKnKluq2lmfAkAkJy/bzG5FY/XH0nq/2tExPp6ApSNL8pKv3rYSEwpTwUkGYm+bk8Vyus08ideV+5Cs5Sx3axpR5I3antr1hg+6NrLzdB3E7oJ3YTmQReX0OgEOv059JUztR2d7+zUoComynjDWtBi+ASmMv+bRbG2/qbpaEK9PXl9fDnQh1C5SQRazY7TbSaHXaM0O26BUzXCT9rB8R98N/ka0uOLNAAAAABJRU5ErkJggg==";

// Recibo para impresora termica de 80mm. El area imprimible son 576 puntos y a
// esa densidad la maqueta de pantalla (300 px) sale diminuta: aqui todo se
// dimensiona contra esos 576 puntos. Se evitan flex y grid — el motor que
// dibuja el HTML en la app de impresion es viejo y solo respeta float.
function _reciboHtmlTermico(d){
  function esc(t){ return String(t==null?"":t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  var filas = (d.lineas||[]).map(function(l){
    return "<tr>"
      + "<td style='padding:7px 0;vertical-align:top'>"+l.cant+"</td>"
      + "<td style='padding:7px 10px;vertical-align:top'>"+esc(l.sabor)+" "+esc(l.tamano)+"</td>"
      + "<td style='padding:7px 0;text-align:right;white-space:nowrap;vertical-align:top'>$"+l.sub+"</td>"
      + "</tr>";
  }).join("");
  var sep = "<div style='border-top:3px dashed #000;margin:12px 0'></div>";
  var fila2 = function(izq, der, tam, negrita){
    return "<div style='font-size:"+tam+"px;"+(negrita?"font-weight:bold;":"")+"overflow:hidden;margin:4px 0'>"
         + "<span style='float:left'>"+izq+"</span><span style='float:right'>"+der+"</span>"
         + "</div><div style='clear:both'></div>";
  };
  return "<div style=\"width:576px;font-family:Arial,Helvetica,sans-serif;color:#000;font-size:26px;line-height:1.35\">"
    + "<div style='text-align:center'>"
    +   (LOGO_RECIBO_B64
        ? "<img src='data:image/png;base64,"+LOGO_RECIBO_B64+"' style='width:460px;display:block;margin:0 auto 8px'>"
        : "<div style='font-size:46px;font-weight:bold'>"+esc(d.nombre)+"</div>")
    +   "<div style='font-size:26px'>Sucursal "+esc(d.sucursal)+"</div>"
    +   (d.direccion?"<div style='font-size:21px'>"+esc(d.direccion)+"</div>":"")
    +   (d.telefono ?"<div style='font-size:21px'>Tel: "+esc(d.telefono)+"</div>":"")
    + "</div>"
    + sep
    + "<div style='font-size:24px'>"
    +   "Folio: "+esc(d.folio)+"<br>"
    +   "Fecha: "+esc(d.fecha)+"<br>"
    +   "Atendio: "+esc(d.usuario)+" &middot; Pago: "+esc(d.metodo)
    +   (d.cliente?"<br>Cliente: "+esc(d.cliente):"")
    + "</div>"
    + sep
    + "<table style='width:100%;border-collapse:collapse;font-size:26px'>"
    +   "<thead><tr style='font-size:21px'>"
    +     "<th style='text-align:left'>Cant</th>"
    +     "<th style='text-align:left;padding-left:10px'>Producto</th>"
    +     "<th style='text-align:right'>Importe</th>"
    +   "</tr></thead><tbody>"+filas+"</tbody>"
    + "</table>"
    + sep
    + (Number(d.envio)>0 ? fila2("Envio","$"+d.envio,26,false) : "")
    + fila2("TOTAL","$"+d.total,42,true)
    + sep
    + "<div style='text-align:center;font-size:24px'>"+esc(d.pie)+(d.instagram?"<br>"+esc(d.instagram):"")+"</div>"
    + "<div style='height:40px'></div>"
    + "</div>";
}

// soloHtml: devuelve el recibo sin escribir el PDF en Drive. Esa escritura tarda
// segundos, y mientras corre Android cancela el permiso para abrir la app de
// impresion — por eso al imprimir se pide solo el HTML y el PDF se genera aparte.
function generarReciboPDF(idVenta, sesion, soloHtml){
  requierePuedeVender(sesion);
  if(!idVenta) return {ok:false,error:"Falta idVenta."};
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var h=ss.getSheetByName("Ventas"); var datos=h.getDataRange().getValues(); var H=datos[0];
  var iAnul=H.indexOf("estado_anul"), iEnv=H.indexOf("envio_monto");
  var lineas=[], info=null, total=0, envio=0;
  for(var i=1;i<datos.length;i++){ var r=datos[i]; if(String(r[0])!==String(idVenta)) continue;
    if(iAnul!==-1 && r[iAnul]==="ANULADO") continue;
    lineas.push({sabor:r[4],tamano:r[5],cant:Number(r[6])||0,precio:Number(r[7])||0,sub:Number(r[8])||0});
    total+=Number(r[8])||0;
    if(!info) info={fecha:r[1],usuario:r[2],sucursal:r[3],canal:r[9],metodo:r[10],cliente:r[12]};
    if(iEnv!==-1 && Number(r[iEnv])>0) envio=Number(r[iEnv]);
  }
  if(!lineas.length) return {ok:false,error:"Venta no encontrada o anulada."};
  var nombre=_cfgVal(ss,"negocio_nombre","Tarta Vasca");
  var suc=info.sucursal||"";
  var dir=_cfgVal(ss,"negocio_direccion_"+String(suc).toLowerCase(), _cfgVal(ss,"negocio_direccion",""));
  var tel=_cfgVal(ss,"negocio_telefono","");
  var ig=_cfgVal(ss,"negocio_instagram","");
  var fechaTxt = info.fecha instanceof Date ? Utilities.formatDate(info.fecha,TZ_MX,"dd/MM/yyyy HH:mm") : String(info.fecha||"").substring(0,16).replace("T"," ");
  var filas = lineas.map(function(l){ return "<tr><td>"+l.cant+"</td><td>"+l.sabor+" "+l.tamano+"</td><td style='text-align:right'>$"+l.precio+"</td><td style='text-align:right'>$"+l.sub+"</td></tr>"; }).join("");
  var totalFinal=total+envio;
  var html="<div style='font-family:Arial,Helvetica,sans-serif;width:300px;margin:0 auto;color:#222'>"+
    "<div style='text-align:center'><div style='font-size:20px;font-weight:bold'>"+nombre+"</div>"+
    "<div style='font-size:12px'>Sucursal "+suc+"</div>"+
    (dir?"<div style='font-size:11px'>"+dir+"</div>":"")+
    (tel?"<div style='font-size:11px'>Tel: "+tel+"</div>":"")+"</div>"+
    "<hr><div style='font-size:11px'>Folio: "+idVenta+"<br>Fecha: "+fechaTxt+"<br>Atendio: "+(info.usuario||"")+" &middot; Pago: "+(info.metodo||"")+(info.cliente?"<br>Cliente: "+info.cliente:"")+"</div><hr>"+
    "<table style='width:100%;font-size:12px;border-collapse:collapse'><thead><tr><th style='text-align:left'>Cant</th><th style='text-align:left'>Producto</th><th style='text-align:right'>P.U.</th><th style='text-align:right'>Importe</th></tr></thead><tbody>"+filas+"</tbody></table><hr>"+
    (envio>0?"<div style='font-size:12px;display:flex;justify-content:space-between'><span>Envio</span><span>$"+envio+"</span></div>":"")+
    "<div style='font-size:16px;font-weight:bold;display:flex;justify-content:space-between'><span>TOTAL</span><span>$"+totalFinal+"</span></div><hr>"+
    "<div style='text-align:center;font-size:11px'>"+_cfgVal(ss,"negocio_mensaje_pie","Gracias por tu compra!")+(ig?"<br>"+ig:"")+"</div></div>";
  var htmlTermico = _reciboHtmlTermico({
    nombre:nombre, sucursal:suc, direccion:dir, telefono:tel, instagram:ig,
    folio:idVenta, fecha:fechaTxt, usuario:info.usuario, metodo:info.metodo,
    cliente:info.cliente, lineas:lineas, envio:envio, total:totalFinal,
    pie:_cfgVal(ss,"negocio_mensaje_pie","Gracias por tu compra!")
  });
  if(soloHtml) return {ok:true, total:totalFinal, html:html, htmlTermico:htmlTermico};
  var blob=Utilities.newBlob(html,"text/html","recibo.html").getAs("application/pdf").setName("Recibo_"+idVenta+".pdf");
  var folder=_ensureFolderRecibos();
  var ex=folder.getFilesByName("Recibo_"+idVenta+".pdf"); while(ex.hasNext()){ ex.next().setTrashed(true); }
  var file=folder.createFile(blob);
  try{ file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }catch(e){}
  // html: el frontend lo imprime en un iframe local (mismo origen) — el PDF de Drive
  // no se puede imprimir desde un iframe por ser de otro dominio.
  return {ok:true, url:file.getUrl(), id:file.getId(), total:totalFinal, html:html, htmlTermico:htmlTermico};
}


function enviarReciboEmail(idVenta, email, sesion){
  requierePuedeVender(sesion);
  if(!email || String(email).indexOf("@")<0) return {ok:false,error:"Correo invalido."};
  var r=generarReciboPDF(idVenta, sesion);
  if(!r.ok) return r;
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  try{
    var blob=DriveApp.getFileById(r.id).getAs("application/pdf").setName("Recibo_"+idVenta+".pdf");
    var fromAddr=_cfgVal(ss,"negocio_email_envio","");
    var nombre=_cfgVal(ss,"negocio_nombre","Tarta Vasca");
    var htmlBody="Gracias por tu compra en "+nombre+".<br>Adjuntamos tu recibo en PDF.<br><br>Tambien puedes verlo aqui: "+r.url;
    var body="Gracias por tu compra en "+nombre+". Recibo: "+r.url;
    var to=String(email).trim();
    if(fromAddr){
      try{
        GmailApp.sendEmail(to, "Tu recibo - "+nombre, body, {from:fromAddr, name:nombre, htmlBody:htmlBody, attachments:[blob]});
        return {ok:true, mensaje:"Recibo enviado a "+email+" (desde "+fromAddr+")", url:r.url};
      }catch(eAlias){
        MailApp.sendEmail({to:to, subject:"Tu recibo - "+nombre, name:nombre, htmlBody:htmlBody, attachments:[blob]});
        return {ok:true, mensaje:"Recibo enviado a "+email+" (el alias "+fromAddr+" aun no esta listo; salio de la cuenta base)", url:r.url};
      }
    }
    MailApp.sendEmail({to:to, subject:"Tu recibo - "+nombre, name:nombre, htmlBody:htmlBody, attachments:[blob]});
    return {ok:true, mensaje:"Recibo enviado a "+email, url:r.url};
  }catch(e){ return {ok:false, error:"No se pudo enviar el correo: "+e.message}; }
}


function autorizarPermisos(){
  // EJECUTAR UNA VEZ. Autoriza Drive (completo) + Gmail (incluye envio con alias).
  var it=DriveApp.getFoldersByName("Recibos Tarta Vasca");
  var f = it.hasNext() ? it.next() : DriveApp.createFolder("Recibos Tarta Vasca");
  var tmp = f.createFile("autorizacion_tmp.txt", "ok", "text/plain");
  tmp.setTrashed(true);
  try { GmailApp.getAliases(); } catch(e){}                 // autoriza Gmail (alias/envio)
  try { MailApp.getRemainingDailyQuota(); } catch(e){}
  return "Permisos de Drive (completo) y Gmail (con alias) autorizados correctamente.";
}


function probarCorreoTV(){
  // Selecciona ESTA funcion en el menu y Ejecutar. Lee el "Registro de ejecucion" abajo.
  var yo = Session.getEffectiveUser().getEmail();
  var quota = MailApp.getRemainingDailyQuota();
  Logger.log("CUENTA QUE ENVIA: " + yo);
  Logger.log("CORREOS DISPONIBLES HOY: " + quota);
  MailApp.sendEmail(yo, "Prueba recibo - Tarta Vasca", "Si recibes esto, el correo funciona. Revisa tambien spam.");
  Logger.log("RESULTADO: correo enviado a " + yo + " (revisa bandeja y SPAM)");
  return "Cuenta: " + yo + " | Cuota: " + quota + " | Enviado.";
}


function guardarDatosNegocio(){
  // EJECUTAR UNA VEZ desde el editor. Guarda los datos del negocio para los recibos.
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var h=ss.getSheetByName("Configuración");
  if(!h){ h=ss.insertSheet("Configuración"); h.appendRow(["Parámetro","Valor","Descripción"]); }
  var datos={
    "negocio_nombre":"Tarta Vasca",
    "negocio_telefono":"55-8803-9327",
    "negocio_instagram":"@tartavasca",
    "negocio_email_envio":"latartavasca@gmail.com",
    "negocio_mensaje_pie":"\u00A1Gracias por tu compra! - Esperamos verte pronto",
    "negocio_direccion_cuajimalpa":"Av Noche de Paz 14, Granjas Navidad, Cuajimalpa de Morelos, 05219, CDMX",
    "negocio_direccion_polanco":"C. Arqu\u00EDmedes 69, Chapultepec Morales, Polanco V Secc, Miguel Hidalgo, 11560, CDMX"
  };
  var vals=h.getDataRange().getValues();
  Object.keys(datos).forEach(function(k){
    var found=false;
    for(var i=1;i<vals.length;i++){ if(String(vals[i][0])===k){ h.getRange(i+1,2).setValue(datos[k]); found=true; break; } }
    if(!found) h.appendRow([k, datos[k], "Dato del negocio para recibos"]);
  });
  SpreadsheetApp.flush();
  return "Datos del negocio guardados en Configuración.";
}


function verAliasTV(){
  // Ejecutar y leer el Registro de ejecucion. Dice todo lo necesario.
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("CUENTA QUE EJECUTA EL SCRIPT: " + Session.getEffectiveUser().getEmail());
  Logger.log("ALIAS DE ENVIO DISPONIBLES: " + JSON.stringify(GmailApp.getAliases()));
  Logger.log("negocio_email_envio EN CONFIG: '" + _cfgVal(ss,"negocio_email_envio","(VACIO)") + "'");
  return "Revisa el Registro de ejecucion (las 3 lineas de arriba).";
}

/**
 * Flags de caja (v7 — módulo Control de Caja):
 *   cajaOperar        : abrir/cerrar tienda y operar caja de su sucursal
 *   cajaRetiroDirecto : retirar efectivo directo (Dueña/Admin) — igual documenta y sube evidencia
 *   cajaSolicitarRetiro: pedir un retiro que otro debe autorizar (Vendedora)
 *   cajaAutorizar     : autorizar solicitudes de retiro
 *   cajaConciliar     : marcar un retiro como conciliado
 *   cajaFijarSaldo    : "saldo en caja al momento" — sobrescribe el esperado (SOLO Dueña)
 * Otros v7:
 *   puedeVerHistorial      : ver el historial de ventas (getVentas)
 *   puedeModificarInventario: ajuste de inventario por conteo físico
 */
function getPermisos(rol) {
switch(rol) {
case "Owner":
return { esAdmin:true, puedeVender:true, puedeProducir:true, puedeTransferir:true, puedeVerAmbas:true, puedeAnular:true, puedeVerHistorial:true, puedeModificarInventario:true, cajaOperar:true, cajaRetiroDirecto:true, cajaSolicitarRetiro:false, cajaAutorizar:true, cajaConciliar:true, cajaFijarSaldo:true };
case "Vendedor":
return { esAdmin:false, puedeVender:true, puedeProducir:false, puedeTransferir:false, puedeVerAmbas:false, puedeAnular:false, puedeVerHistorial:false, puedeModificarInventario:false, cajaOperar:true, cajaRetiroDirecto:false, cajaSolicitarRetiro:true, cajaAutorizar:false, cajaConciliar:false, cajaFijarSaldo:false };
case "Cocinero":
return { esAdmin:false, puedeVender:false, puedeProducir:true, puedeTransferir:true, puedeVerAmbas:true, puedeAnular:false, puedeVerHistorial:false, puedeModificarInventario:false, cajaOperar:false, cajaRetiroDirecto:false, cajaSolicitarRetiro:false, cajaAutorizar:false, cajaConciliar:false, cajaFijarSaldo:false };
case "Mixto":
return { esAdmin:false, puedeVender:true, puedeProducir:true, puedeTransferir:true, puedeVerAmbas:false, puedeAnular:false, puedeVerHistorial:false, puedeModificarInventario:false, cajaOperar:true, cajaRetiroDirecto:false, cajaSolicitarRetiro:true, cajaAutorizar:false, cajaConciliar:false, cajaFijarSaldo:false };
case "Admin_Ventas":
// v7: la Administradora (Yessenia) — ahora también produce, ve historial, modifica
// inventario y cancela operaciones, y tiene mando de caja (autorizar/conciliar retiros).
return { esAdmin:false, puedeVender:true, puedeProducir:true, puedeTransferir:true, puedeVerAmbas:true, puedeAnular:true, puedeVerHistorial:true, puedeModificarInventario:true, cajaOperar:true, cajaRetiroDirecto:true, cajaSolicitarRetiro:false, cajaAutorizar:true, cajaConciliar:true, cajaFijarSaldo:false };
case "Chofer":
return { esAdmin:false, puedeVender:false, puedeProducir:false, puedeTransferir:false, puedeVerAmbas:false, puedeAnular:false, esChofer:true, puedeVerHistorial:false, puedeModificarInventario:false, cajaOperar:false, cajaRetiroDirecto:false, cajaSolicitarRetiro:false, cajaAutorizar:false, cajaConciliar:false, cajaFijarSaldo:false };
default:
return { esAdmin:false, puedeVender:false, puedeProducir:false, puedeTransferir:false, puedeVerAmbas:false, puedeAnular:false, puedeVerHistorial:false, puedeModificarInventario:false, cajaOperar:false, cajaRetiroDirecto:false, cajaSolicitarRetiro:false, cajaAutorizar:false, cajaConciliar:false, cajaFijarSaldo:false };
}
}
function soloOwner(sesion) {
if (sesion.rol !== "Owner") throw new Error("Acción reservada para Owner.");
}
function requierePuedeVender(sesion) {
if (!getPermisos(sesion.rol).puedeVender) throw new Error("Tu rol no permite registrar ventas.");
}
function requierePuedeProducir(sesion) {
if (!getPermisos(sesion.rol).puedeProducir) throw new Error("Tu rol no permite producción.");
}
function requierePuedeTransferir(sesion) {
if (!getPermisos(sesion.rol).puedeTransferir) throw new Error("Tu rol no permite transferencias.");
}
function requierePuedeAnular(sesion) {
// Por defecto solo Owner; si tiene permiso individual lo respeta
if (sesion.rol === "Owner") return;
if (getPermisos(sesion.rol).puedeAnular) return;  // v7: roles con puedeAnular (ej. Admin_Ventas)
const extra = leerPermisosExtraUsuario(sesion.usuario);
if (extra && extra.puedeAnular) return;
throw new Error("Tu rol no permite anular movimientos. Pídeselo al Owner.");
}
// v7 — helpers de permiso reutilizables por el módulo de caja y los fixes de Admin_Ventas
function requierePermiso(sesion, flag, mensaje) {
if (!getPermisos(sesion.rol)[flag]) throw new Error(mensaje || "Tu rol no permite esta acción.");
}
