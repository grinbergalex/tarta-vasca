// La app define una global L() (getElementById) que pisa la L de Leaflet.
// Aqui se captura Leaflet antes de que app.js se cargue y la tape.
// v7.1 — Vive en su propio archivo porque los <script> del head ahora son "defer":
// un <script> inline no se puede diferir, y corriendo en linea se ejecutaria antes
// que Leaflet, guardando undefined.
window._LF = window.L;
