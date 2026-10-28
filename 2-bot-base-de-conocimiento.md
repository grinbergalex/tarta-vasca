# Tarta Vasca: fuentes de verdad del bot y discrepancias (v2)

**Principio:** el bot **no guarda datos propios** del negocio. Cada dato vive en **un solo lugar que ya existe** y el bot lo lee ahí, en vivo. Así, cuando Rebeca cambia un precio, un horario o el inventario, el bot lo sabe sin que nadie actualice nada más.

Este documento es una **foto de lo que dicen hoy las fuentes** (para revisar), no una copia que haya que mantener.

---

## 1. Una fuente por dato

| Dato | Fuente única | Cómo lo usa el bot |
|---|---|---|
| Precios por sabor y tamaño | **Sistema**, pestaña *Precios* (ya reflejada en *Espejo para Shopify*) | Lectura en vivo |
| Zonas y costos de envío | **Sistema**, pestaña *ZonasEnvio* (igual en Shopify) | Lectura en vivo |
| Sabores activos | **Sistema**, pestaña *Catálogo* | Lectura en vivo |
| **Inventario del día** | **Sistema**, pestaña *Inventario* (cantidad − reservas) | Lectura en vivo, por una vista de solo lectura |
| Horarios, direcciones, historia, preguntas frecuentes, alérgenos, conservación, descripciones y porciones | **Shopify** (páginas y productos) | Lectura en vivo por la API de Shopify |
| **Pedidos, clientes y reservas** | **Sistema** (ya tiene pedidos, reparto, reservas y clientes) | Escritura por **un punto de entrada controlado**, no por acceso al archivo |
| Voz, tono y reglas de conversación | **Instrucciones del bot** | Es lo único propio del bot |

Dos consecuencias:
- **No se crea otro espejo ni otra hoja de pedidos.** Ya existe un *Espejo para Shopify (se llena solo)* con Catálogo, Precios y Zonas; solo falta exponer el inventario.
- **Los pedidos del bot entran al mismo sistema que usa Rebeca**, para que haya un solo lugar donde se ven, se reservan y se reparten.

---

## 2. Lo que dicen hoy las fuentes

### Sucursales y horarios (Shopify, página *Entregas y preguntas*)
- **Cuajimalpa:** Av. Noche de Paz 14, local 16B, Col. Granjas Navidad. Lunes a viernes 9:00 a 18:00; sábado y domingo 10:00 a 15:00.
- **Polanco:** Calle Arquímedes 69, Col. Polanco. Lunes a domingo 11:00 a 19:00.
- **Links de Google Maps que me diste:**
  - Polanco: https://maps.app.goo.gl/8SgqYN1heaJwBbSu5
  - Cuajimalpa: https://maps.app.goo.gl/qHVxeqaJqz8RAETN8
  - Nuevo local (una cocina, no atiende público): https://maps.app.goo.gl/FK1PCmWkxqKNLTYW6
- WhatsApp del negocio: 55 8803 9327.

### Tamaños (Shopify)
- Individual o chica: 1 a 2 porciones. Mediana: 4 a 5. Grande: 10 a 12.

### Entrega a domicilio (Shopify y Sistema coinciden)
- Dentro de CDMX, **de martes a sábado**.
- **$60:** Interlomas, Bosques de las Lomas, Lomas, Cuajimalpa, Herradura, Santa Fe, Bosque Real, Tecamachalco.
- **$90:** Polanco, Las Águilas, Roma, Condesa, Nápoles, Del Valle, Narvarte, Pedregal (**no se cubre Tlalpan**).
- **$120:** Satélite, Coyoacán, Juárez, Reforma Centro (hasta el Ángel).

### Precios (Sistema, vigentes desde el 3 de octubre de 2026)
- **Tienda y domicilio:** individual/chica $240, mediana $420, grande $720.
- **Rappi:** $260, $450 y $780. *Esto explica los números distintos que vi antes: no eran un conflicto, eran otro canal.* El bot de Instagram usa los precios de **tienda y domicilio**.

### Producto (Shopify)
- Todas las tartas llevan **gluten, lácteos y huevo**. La de **pistache** además lleva fruto seco.
- **Tradicional, Queso Azul y Guayabrie** llevan una fracción de quesos **no pasteurizados**: a quien esté embarazada se le recomienda consultar a su médico.
- **Duración:** 5 días desde que la recibes, refrigerada; sacarla 30 minutos antes; **no congelar**. Se puede viajar con ella en bolsa térmica.
- **Regalos:** se puede incluir tarjeta con dedicatoria y caja especial; el mensaje se escribe al hacer el pedido.
- **Pedidos grandes o para restaurantes y eventos:** cotización personalizada (el bot pasa con una persona).
- Los quesos son españoles y franceses; la receta nació de la formación de la fundadora en España. La historia completa está en *Nuestra historia*.
- Sabores activos en Shopify, con descripción: Tradicional, Lotus, Pistache, Oreo, Frutos Rojos, Guayabrie y Pumpkin Spice (edición de temporada).

### Anticipación para pedir
- "Idealmente con 24 a 48 horas".
- Para hoy o mañana **depende de lo que haya disponible**; con dos días o más, siempre se puede.

---

## 3. Discrepancias a corregir en el origen (no en el bot)

Si no se corrigen, el bot repetirá la contradicción. Cada una se arregla **en su fuente**:

| # | Discrepancia | Qué hay que decidir |
|---|---|---|
| 1 | **Cocina y sucursales:** el proyecto *tarta-vasca* (v8, oct-2026) dice que **la cocina pasó a Bosques** (Av. Stim 1374, Lomas del Chamizal) y que **Cuajimalpa quedó solo como punto de venta**. Pero Shopify sigue llamando "taller" a Av. Noche de Paz 14 (Cuajimalpa). | Actualizar Shopify. Confirmar si Bosques recibe clientes y su horario: el sistema lo tiene "por confirmar con Rebe". |
| 2 | **Links de Maps:** los de Shopify ("Cómo llegar") son distintos a los que me pasaste. | ¿Cuáles son los vigentes? Actualizar Shopify. |
| 3 | **Horarios de Cuajimalpa:** Shopify dice L–V 9–18 y S–D 10–15; un mensaje antiguo decía 10:00 a 14:30. | Confirmar. |
| 4 | **Tamaños:** la página de preguntas dice 12 / 20 / 25 cm; las fichas de producto dicen 13 / 18 / 24 cm, con pesos (500 g, 900 g, 1.9 kg). | Una sola versión. |
| 5 | **Nombre del tamaño chico:** "Chica" en unas fichas, "Individual" en otras y en el Sistema. | Un solo nombre. |
| 6 | **Sabores activos:** el Sistema marca activos Gorgonzola y Cabra & Higo (en Shopify están en borrador); Pumpkin Spice está activo en Shopify y no aparece en el Catálogo del Sistema. | Alinear ambos. |
| 7 | **Inventario en Shopify:** muestra cifras enormes (por ejemplo, 212,969), que no son reales. | El inventario **real** es el del Sistema; el bot no debe leerlo de Shopify. |
| 8 | **Duración:** 5 días para el cliente (Shopify) y 4 días de vida útil en el Sistema. | Es lo normal (margen interno), pero conviene confirmarlo. |
| 9 | **Anticipación:** el formulario viejo pedía 24 h mínimo; Shopify dice "según disponibilidad". | Elegir la regla del bot. |
| 10 | **Pagos y anticipo:** del audio (efectivo, transferencia, tarjeta en sucursal) pero no están en Shopify. | Dónde se publican, para leerlos de ahí. |

---

## 4. Lo que sigue sin existir en ninguna fuente

1. **Horario de entrega a domicilio** (¿mañana o tarde? ¿ventanas?).
2. **Datos para transferencia** y anticipo.
3. Cambios y cancelaciones de pedidos.
4. Datos por sabor que no están publicados (los que no están activos en Shopify).
5. Respuestas para **dedicatorias y velas** (existen *VELAS* y *AGUA* como extras en el Sistema).

Lo mejor es publicar esto en **Shopify** (por ejemplo, en *Entregas y preguntas*), para que lo lean tanto los clientes de la tienda como el bot.
