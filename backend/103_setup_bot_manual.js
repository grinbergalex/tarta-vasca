// ============================================================================
// ONE-OFF — Crea la pestaña "Bot_Manual" con la guía de marca que lee el bot de Instagram.
//
// De dónde sale: el "Manual de marca y atención La Tarta Vasca" de Rebeca (oct-2026), solo las partes que
// sirven para atender clientes (historia, filosofía, sabores, recomendaciones, preguntas frecuentes,
// pedidos y canales) más las formas de pago y facturas. Se dejó fuera lo interno del equipo (limpieza,
// uniformes, presentación del local). La sección de historia no repite que la cocina esté en Cuajimalpa:
// la cocina hoy es Bosques (v8) y el manual de papel está desactualizado en eso.
//
// Después de correrla, la pestaña se EDITA directamente en la hoja (Tema | Contenido): el bot la lee en
// vivo, así que un cambio de texto no requiere tocar código. Los temas válidos están en BOT_TEMAS_MANUAL.
//
// Correr UNA sola vez desde el editor. Si la pestaña ya tiene contenido, aborta sin tocar nada.
// NO llamar desde el API.
// ============================================================================
const BOT_MANUAL_INICIAL = [
  ["historia", `La historia de La Tarta Vasca comenzó cuando su fundadora vivía en Madrid, donde estudió repostería española y trabajó en un lugar reconocido por tener como postre más icónico la tradicional tarta vasca.
Ahí aprendió la técnica auténtica y, al regresar a México, decidió adaptarla a su propio estilo y gustos, buscando crear una versión mucho más equilibrada: cremosa, suave y llena de sabor, sin llegar a ser empalagosa.
La marca comenzó hace dos años desde casa. Al crecer, abrimos nuestro primer local y una cocina donde elaboramos las tartas de manera artesanal, y desde ahí enviamos tartas frescas todos los días a nuestros puntos de venta.`],

  ["filosofia", `En La Tarta Vasca creemos que un producto gourmet se construye cuidando cada detalle. Antes de lanzar cualquier receta hacemos muchas pruebas hasta estar seguras de que el sabor, la textura y el balance representan la calidad de la marca.
Nunca escatimamos en ingredientes. Usamos materia prima de la mejor calidad y quesos cuidadosamente seleccionados. Además, cada sabor se elabora con una combinación distinta de quesos para lograr un perfil único.
Nuestro branding, empaque y espacios también forman parte de la experiencia: el papel, el amarre con yute, las cajas, los locales y la atención hacen que el cliente sienta que está recibiendo algo especial.
No vendemos únicamente una tarta. Vendemos un momento especial.`],

  ["sabores", `TARTA TRADICIONAL DE QUESO — La clásica, la icónica y la esencia de la marca.
Está elaborada con una mezcla especial de quesos, entre ellos queso Idiazábal (un queso español de oveja con un toque ahumado), queso bola y un sutil toque de queso azul. Esta combinación está pensada para lograr profundidad de sabor, balance y una experiencia muy gourmet. Aunque tiene mucha personalidad, no es empalagosa. Es firme y caramelizada por fuera, pero suave y cremosa por dentro.
Cómo describirla: "Es nuestra tarta más clásica e icónica." / "Lleva queso Idiazábal, que es un queso español de oveja con un toque ahumado." / "El queso azul es muy sutil; no domina, solo ayuda a dar profundidad y balance." / "Es dulce sin ser empalagosa y muy cremosa por dentro."
Perfil de sabor: cremosa, balanceada, profunda, ligeramente ahumada y gourmet.

TARTA DE QUESO CON FRUTOS ROJOS — Una versión frutal y elegante de nuestra tarta de queso.
Lleva una mezcla de queso Idiazábal y queso bola, que aporta profundidad, cremosidad y un balance muy especial. Encima lleva un coulis de frutos rojos preparado de manera artesanal, que aporta frescura, acidez y un contraste perfecto con la cremosidad de la tarta. Es ideal para quienes buscan una opción cremosa, pero con un toque más fresco y frutal.
Cómo describirla: "Es una tarta de queso muy cremosa con un toque fresco por el coulis artesanal de frutos rojos." / "Lleva queso Idiazábal y queso bola, por eso tiene tanta profundidad de sabor." / "El coulis de frutos rojos lo preparamos nosotros de manera artesanal."
Perfil de sabor: cremosa, frutal, fresca, balanceada y artesanal.

TARTA LOTUS — Una de las favoritas para quienes aman los sabores caramelizados.
Está elaborada con base de galleta Lotus, una mezcla cremosa de queso con Lotus y una capa de arena de Lotus encima. Tiene el sabor característico de la galleta caramelizada, con una textura muy antojable. Es una opción más dulce, cálida y reconfortante, sin perder el balance de la marca.
Cómo describirla: "Si te gustan los sabores caramelizados, esta te va a encantar." / "Tiene base de galleta Lotus, mezcla con Lotus y arena de Lotus encima." / "Es dulce, cremosa y muy apapachadora."
Perfil de sabor: caramelizada, cremosa, de dulzor equilibrado, reconfortante y con textura.

TARTA PISTACHE — Una tarta elegante y equilibrada donde el pistache es protagonista sin saturar el sabor.
La mezcla cremosa de queso se complementa con pistache y termina con pistache ligeramente salado encima para aportar textura y contraste. El resultado es una tarta sofisticada, cremosa y perfectamente balanceada entre lo dulce y lo salado.
Cómo describirla: "Tiene un sabor muy elegante y gourmet." / "El pistache salado encima ayuda a resaltar muchísimo el sabor." / "Es cremosa, con un contraste crujiente delicioso."
Perfil de sabor: elegante, cremosa, con balance dulce-salado, crujiente y gourmet.

TARTA GUAYABRÍ — Una tarta con personalidad, pensada para quienes buscan una combinación diferente y memorable.
Mezcla la cremosidad del queso con el sabor de la guayaba, logrando un contraste elegante entre lo dulce, lo frutal y lo cremoso. Es una opción muy especial para clientes que quieren salir de lo clásico y probar algo distintivo de la marca.
Cómo describirla: "Es una de nuestras tartas más especiales y diferentes." / "Tiene un contraste delicioso entre queso y guayaba." / "Es ideal si quieres algo gourmet, frutal y fuera de lo tradicional."
Perfil de sabor: frutal, cremosa, diferente, gourmet y memorable.

TARTA DE QUESO AZUL — Si te gusta el sabor intenso a queso, esta es para ti.
Lleva la combinación de queso ideal, queso bola y un toque mucho más profundo de queso azul, balanceado con el punto de dulzor perfecto para endulzar pero no empalagar. Esta tarta salió como sabor de temporada y, gracias al éxito que tuvo, se quedó en el menú.`],

  ["recomendar_sabores", `Si el cliente busca probar la clásica: Tradicional de Queso.
Si busca algo frutal y fresco: Queso con Frutos Rojos.
Si busca algo más dulce y caramelizado: Lotus.
Si busca algo gourmet y sofisticado: Pistache.
Si busca algo diferente y frutal: Guayabrí.
Si busca algo de temporada: Pumpkin spice.
Si busca un sabor intenso a queso: Queso Azul.

Los sabores más pedidos son la Tradicional de queso (si nunca has probado una Tarta Vasca, te recomendamos empezar por esta) y, entre los más característicos, Lotus, Pistache y Guayabrí.`],

  ["preguntas_frecuentes", `¿Cuál recomiendan si es mi primera vez? La Tradicional de Queso, porque es la más icónica y representa la esencia de la marca.
¿Sabe fuerte el queso azul? No. En la Tradicional es un toque muy sutil que no domina el sabor; ayuda a dar profundidad y balance.
¿Qué es el queso Idiazábal? Es un queso español de oveja con un toque ahumado. Aporta profundidad y un perfil muy especial a nuestras tartas de queso.
¿Cuál es la más dulce? Lotus y Pumpkin spice tienen perfiles más dulces y caramelizados.
¿Cuál es más fresca? La de Queso con Frutos Rojos es la más fresca.
¿Tienen disponibilidad diaria? Sí, tenemos disponibilidad en tienda; pero si buscan un sabor o tamaño específico, recomendamos apartarlo con anticipación.
¿Hacen envíos? Sí. Contamos con servicio a domicilio con costos distintos según la zona de entrega.`],

  ["pedidos_y_canales", `Las tartas se pueden hacer sobre pedido y también contamos con disponibilidad diaria en tienda. Si un cliente busca un sabor o tamaño específico, siempre recomendamos apartarlo con anticipación para asegurar disponibilidad. También contamos con servicio a domicilio con distintos costos según la zona de entrega.
Se puede hacer un pedido: directamente en tienda; por nuestro WhatsApp 55 8803 9327; desde el formulario de pedidos https://forms.gle/EtqthXF4g7no7Cg79; en latartavasca.com; o aquí por Instagram.`],

  ["pagos_y_facturas", `Aceptamos pago en efectivo, por transferencia y con tarjeta. La tarjeta es únicamente en sucursal: en los envíos a domicilio no se puede pagar con tarjeta porque no contamos con más terminales (a domicilio, efectivo o transferencia).
Sí emitimos facturas. Quien requiera una factura necesita comunicarse con el equipo.`]
];

function setupBotManual() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(BOT_HOJA_MANUAL);
  if (hoja && hoja.getLastRow() > 1) throw new Error("ABORTADO: " + BOT_HOJA_MANUAL + " ya tiene contenido. Edítalo directamente en la hoja.");
  if (!hoja) hoja = ss.insertSheet(BOT_HOJA_MANUAL);
  hoja.getRange(1, 1, 1, 2).setValues([["Tema", "Contenido"]]).setFontWeight("bold").setBackground("#2E4756").setFontColor("#FFFFFF");
  hoja.getRange(2, 1, BOT_MANUAL_INICIAL.length, 2).setValues(BOT_MANUAL_INICIAL);
  hoja.setColumnWidth(1, 170); hoja.setColumnWidth(2, 700);
  hoja.getRange(2, 2, BOT_MANUAL_INICIAL.length, 1).setWrap(true).setVerticalAlignment("top");
  hoja.setFrozenRows(1);
  return BOT_MANUAL_INICIAL.length + " temas cargados en " + BOT_HOJA_MANUAL + ".";
}
