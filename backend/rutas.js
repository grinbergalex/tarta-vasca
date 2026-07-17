function TEST_addPedido(){
  var r = repartoAddPedido({ pedido:{ cliente:"PRUEBA", tel:"55", dir:"Polanco", zona:"Polanco", tartas:1, monto:0, detalle:"x", pago:"Cobra chofer" }}, {ok:true});
  Logger.log(JSON.stringify(r));
}