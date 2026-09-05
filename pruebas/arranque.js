// Ultimo de los scripts propios: dispara el arranque de la app.
//
// v7.2 — Antes esto colgaba de DOMContentLoaded dentro de app.js. El problema es que
// DOMContentLoaded no se dispara hasta que TODOS los scripts con defer terminaron,
// incluidos los de los CDN: con un CDN colgado, la sesion guardada nunca se restauraba
// y la vendedora tenia que volver a escribir su contrasena aunque la app ya estuviera
// pintada. Este archivo va antes que los CDN, asi que el arranque ya no depende de ellos.
//
// Va DESPUES de caja.js a proposito: iniciarApp() pregunta si existe cajaGateInicial
// (el gate de "tienda cerrada" de la vendedora) y esa funcion vive en caja.js.
// Todos estos scripts son "defer", asi que el DOM ya esta completo cuando esto corre.
arrancarApp();
