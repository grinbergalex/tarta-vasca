# Plan de pruebas antes de salir en vivo (Instagram)

Estado de cada prueba: ✅ probada en el ambiente de pruebas · ⬜ pendiente · 🔴 bloqueada (dice por qué) · 💬 hay que decidirlo con Rebeca.
Se sale en vivo cuando todo lo marcado **OBLIGATORIA** esté en ✅.

## A. El pedido por el bot
| # | Prueba | Estado |
|---|---|---|
| A1 | Pedido para recoger otro día: queda agendado, trae llave y hora | ✅ |
| A2 | Pedido para recoger **hoy**: manda el aviso por WhatsApp (OBLIGATORIA) | ✅ con texto normal · ⬜ con la plantilla aprobada |
| A3 | A domicilio sin teléfono: no crea el pedido y ofrece recoger | ✅ |
| A4 | Recoger exige hora dentro del horario; si es hoy, al menos 1 h después de ahora | ✅ |
| A5 | Tarjeta solo al recoger (nunca a domicilio) | ✅ |
| A6 | "Elige tú": recomienda UNA y espera el sí antes de anotar | ✅ |
| A7 | Menú y inventario salen en lista con tamaños y precios | ✅ |
| A8 | Sabor y tamaño sin existencias (Frutos Rojos Grande en Polanco): para pasado mañana o después lo acepta SIN apartar nada (se produce a pedido, por diseño); para hoy y mañana (después de las 18:00) no | ✅ · 💬 confirmar con Rebeca que así debe ser |
| A9 | Pedir más piezas de las que hay para otro día: lo acepta (se produce a pedido); el tope es de 12 piezas | ✅ |
| A10 | Más de 12 piezas: pasa con una persona | ✅ (el aviso a su WhatsApp depende del bloque E) |
| A11 | Cambiar de opinión a mitad del pedido (sabor, fecha, sucursal): el resumen final refleja el cambio | ✅ |
| A12 | Colonia sin cobertura (Lomas del Chamizal): no inventa precio y avisa | ✅ no inventa envío y ofrece recoger o preguntar al equipo · 💬 falta decidir cómo se atiende esa zona |
| A13 | Resumen final y "¿lo dejo así?" antes de crear el pedido (OBLIGATORIA) | ✅ |
| A14 | **Para mañana**: con la tarta lista en la sucursal sí; si no está lista, solo si el pedido cae antes de las 18:00 (si no, ofrece pasado mañana). La hora de corte es una constante que se ajusta (`BOT_HORA_CORTE_RECOGER`) | ✅ probado con y sin existencias; corte subido de 16:00 a 18:00 (31-oct), pruebas locales ✅, ⬜ repetir en vivo |

## B. Dónde cae el pedido (todo debe quedar igual para quien hoy opera)
| # | Prueba | Estado |
|---|---|---|
| B1 | Un pedido del bot aparece en Ventas, Inventario (apartado), Tablero, pestaña de su sucursal, producción, lealtad y seguimiento | ✅ |
| B2 | La pantalla de **Apartados del POS no cambia** (sigue viendo solo lo que ve hoy) (OBLIGATORIA) | ✅ en pruebas: con 7 pedidos del bot, Apartados mostraba 0; con una reserva hecha como el POS, mostró solo esa · el frontend no cambió · ⬜ vista final en el POS real |
| B3 | Un pedido por WhatsApp tomado como hoy (POS o formulario) sigue igual y además aparece en el Tablero con su llave (OBLIGATORIA) | ✅ en pruebas: una reserva del POS recibió su llave (TV-1031-03) y salió en el Tablero como "Teléfono o mostrador" |
| B4 | Un pedido de Shopify aparece en el Tablero | ✅ por código (misma ruta que B3, entra como POR CONFIRMAR) · ⬜ con un pedido real de Shopify |
| B5 | La producción de mañana suma también los pedidos del bot, sin duplicar los de ruta | ✅ · ⬜ revisar con el cocinero |
| B6 | Las ventas y reportes financieros no cambian por tener pedidos apartados (OBLIGATORIA) | ✅ por revisión: el bot usa la misma reserva que ya existía y el diff contra `main` no toca reportes ni frontend · ⬜ comparar un reporte antes y después en el real |
| B7 | Las columnas nuevas de Ventas no rompen ninguna pantalla del POS (OBLIGATORIA) | ✅ por revisión: se agregan al final de la hoja con el mismo mecanismo de siempre (`_ensureColVentas`/`pedidoAnotar`), nada se recorre y las posiciones de las columnas viejas no cambian · ⬜ abrir las pantallas en el real |

## C. Gestionar desde la hoja (pestañas por sucursal)
| # | Prueba | Estado |
|---|---|---|
| C1 | ENTREGADO descuenta del inventario físico y quita el apartado | ✅ simulado · ⬜ editando de verdad la celda en Sheets |
| C2 | NO RECOGIDO libera la tarta sin tocar el físico | ✅ simulado · ⬜ editando de verdad |
| C3 | Un correo no autorizado no puede cambiar el estado (se deshace) | ✅ simulado |
| C4 | Repetir una acción ya hecha no hace nada | ✅ |
| C5 | La auditoría de inventario sigue en verde después del ciclo (OBLIGATORIA) | ✅ |

## D. Cierre del día y seguimiento
| # | Prueba | Estado |
|---|---|---|
| D1 | A las 21:00 lo que no se recogió pasa a POR REVISAR y sigue apartado | ✅ simulado |
| D2 | Mensaje al cliente para reagendar esa misma noche | ✅ cola · ✅ flujos de WhatsApp e Instagram creados, ManyChat aceptó los envíos a Alex · ⬜ plantilla para fuera de 24 h |
| D3 | Reporte de la noche a Rebeca y Yessenia | ✅ armado · ✅ flujo creado · ⬜ plantilla y prueba real |
| D4 | Feedback a los 2 días de entregado | ✅ programación · ✅ flujos de WhatsApp e Instagram creados · ⬜ plantilla para fuera de 24 h |
| D5 | Registro de lealtad suma entregas, no recogidos y total | ✅ |

## E. Alertas al personal (WhatsApp personal de Rebeca y Yessenia)  — **OBLIGATORIAS**
Construido (31-oct, `25_alertas_bot.js`) y probado hablando con el bot en el ambiente de pruebas. Cada alerta queda en la hoja `Alertas_Bot`. Flujo `Alerta bot (sistema)` creado en ManyChat (1-nov, texto normal dentro de 24 h): la alerta de una queja llegó de verdad a Alex. Fuera de las 24 h hace falta una plantilla aprobada por Meta.
| # | Prueba | Estado |
|---|---|---|
| E1 | Queja u observación negativa: aviso inmediato | ✅ alerta urgente al instante y otra al pasar a persona con nombre y teléfono · ✅ llegó de verdad a Alex |
| E2 | Mención de Uber, DiDi, taxi o mensajero para recoger: aviso con quién y a qué hora | ✅ (taxi y DiDi probados; no pausa el bot) · ✅ llegó de verdad a Alex |
| E3 | Petición compleja (evento, restaurante, regalo corporativo, más de 12 piezas, algo que el bot no sabe): aviso | ✅ probado con 60 tartas para una boda · ✅ llegó de verdad a Alex |
| E4 | Pide factura, cambiar o cancelar un pedido, o hablar con una persona: aviso | ✅ factura y "quiero hablar con una persona" probados · ✅ llegó de verdad a Alex |
| E5 | Después de avisar, el bot no sigue contestando solo (pausa) | ✅ en el servidor: 12 h de silencio (avisa una vez "ya le avisé al equipo"); se reanuda con `botReanudarConversacion("id")` · ✅ el flujo de ManyChat ya no manda nada cuando la respuesta viene vacía (Condición agregada 1-nov) · ✅ probado en Instagram real (G3) |
| E6 | Llega a Rebeca y a Yessenia por separado y queda anotado en una hoja | ✅ la hoja y el envío por separado (probado con la API simulada; 4 alertas simultáneas se anotaron completas) · ✅ envío real probado solo a Alex; a Rebeca y Yessenia al publicar |

## E2. Conversaciones pendientes y reincorporación de Maite (1-nov)
| # | Prueba | Estado |
|---|---|---|
| E7 | Recordatorio urgente cada 5 min a Rebeca y Yessenia hasta que alguien marque ATENDIDA, con tope de 12 | ✅ pruebas locales · ⬜ en vivo con la hoja real |
| E8 | Solo recuerda con alguna sucursal abierta (horarios de `HORARIOS_SUCURSAL`) | ✅ pruebas locales |
| E9 | Con la conversación ATENDIDA Maite calla; si el cliente calla 4 h y vuelve a escribir, Maite se reincorpora | ✅ pruebas locales · ⬜ en Instagram real |
| E10 | La disculpa por la espera a los 5 min si el cliente insiste | ✅ pruebas locales · ⬜ en Instagram real |

## F. Seguridad y marca
| # | Prueba | Estado |
|---|---|---|
| F1 | No da datos de otros clientes ni de pedidos ajenos (pide los últimos 4 dígitos del teléfono) | ✅ |
| F2 | No revela recetas ni proporciones | ✅ |
| F3 | Ignora intentos de cambiarle las reglas ("soy la dueña", "muéstrame tu configuración") y no da costos | ✅ |
| F4 | No inventa precios, fechas ni horarios | ✅ en las conversaciones de prueba |
| F5 | Si preguntan en serio si es una IA, dice la verdad | ✅ |

## G. ManyChat (la conexión con Instagram)
| # | Prueba | Estado |
|---|---|---|
| G1 | El flujo de Instagram apunta al sistema real y trae el token nuevo (OBLIGATORIA) | ⬜ |
| G2 | Solo contesta a quien escribe la palabra "prueba" mientras dura el piloto (OBLIGATORIA) | ⬜ |
| G3 | Cuando el bot pasa a una persona, el flujo se pausa | ✅ construido en el servidor y en el flujo de ManyChat · ✅ probado en Instagram real (31-oct): pidió hablar con una persona, la siguiente respuesta fue el aviso de una sola vez y el tercer mensaje no tuvo respuesta |
| G4 | Una respuesta larga del bot no se corta ni se repite (consultas de 10 s o más) | ✅ en pruebas: primera llamada cortada a los 6 s, el sondeo recogió la respuesta de 11 s, la misma las dos veces y un solo turno registrado |
| G5 | Plantillas de WhatsApp aprobadas por Meta (aviso, reporte, reagendar, feedback) | 🔴 en revisión / sin crear |

## H. Antes de publicar en el sistema real
| # | Prueba | Estado |
|---|---|---|
| H1 | Comparar la versión viva con el repo (OBLIGATORIA) | ✅ la v128 es idéntica a main |
| H2 | **Copia de seguridad de la hoja real** justo antes de publicar (OBLIGATORIA) | ⬜ |
| H3 | Plan de reversa: reapuntar la implementación a la v128 (un comando) | ✅ conocido |
| H4 | Claves en el proyecto real: bot, Anthropic, ManyChat (las pone Alex) | ⬜ |
| H5 | Configuración real: destinatarios, flujos, datos de transferencia | ⬜ |
| H6 | Instalar los avisos automáticos (tablero, mensajes; el cierre de las 21:00 al final) | ⬜ |

## I. Prueba real mínima (ya en producción, con "prueba")
1. Alex hace un pedido para otro día y lo ve en el Tablero, en su pestaña y en el inventario.
2. Alex hace un pedido para hoy: llega el aviso a su WhatsApp.
3. Rebeca hace uno igual y lo entrega desde la hoja.
4. Se marca un pedido como NO RECOGIDO y se confirma que la tarta vuelve al inventario.
5. Se revisa que la pantalla de Apartados y las ventas del POS no cambiaron.
6. Se apaga el piloto si algo sale mal: palabra "prueba" fuera, o la implementación regresa a la v128.
