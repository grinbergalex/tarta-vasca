// Se ejecuta DESPUES de leaflet.min.js, que es lo ultimo que carga la pagina.
//
// v7.2 — Las librerias de terceros se movieron al final, despues de app.js, para que
// un CDN colgado no pueda impedir que la app arranque. El precio de moverlas es que
// Leaflet ya no carga antes que app.js: Leaflet publica su objeto en window.L y la app
// tiene su propia global L() (getElementById), asi que al cargar despues se la pisa.
// Aqui se deshace ese choque:
//   1. Se guarda Leaflet en window._LF, que es lo que usa reparto.js.
//   2. noConflict() le devuelve a window.L el valor que tenia antes de Leaflet,
//      o sea la L() de la app. Para eso existe esa funcion en Leaflet.
//
// Si Leaflet no llego a cargar (CDN caido o lento), _LF se queda sin definir y
// reparto.js lo detecta solo: esconde el mapa y avisa. El resto de la app funciona.
(function () {
  var LF = window.L;
  if (LF && typeof LF.map === "function") {          // es Leaflet, no la L() de la app
    window._LF = LF;
    if (typeof LF.noConflict === "function") window.L = LF.noConflict();
  }
  // Red de seguridad: la app entera depende de L(). Si por cualquier motivo dejo de
  // ser una funcion, se restaura aqui antes de que nada la use.
  if (typeof window.L !== "function") {
    window.L = function (id) { return document.getElementById(id); };
  }
})();
