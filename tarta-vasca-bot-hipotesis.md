# Bot de Instagram para Tarta Vasca: lo que aprendí y la hipótesis de construcción

Borrador para revisar mañana. Es una hipótesis, no un diseño final: lo marcado con **[confirmar]** lo tiene que validar Rebeca. No incluye datos personales de clientes.

---

## 1. Lo que aprendí del negocio

**Fuentes leídas:** bandeja de Instagram de @tartavasca (Primary, General y Solicitudes), bandeja de ManyChat, el archivo *Tarta Vasca — Sistema* (solo la estructura de inventario, precios, zonas y configuración) y la estructura del formulario de pedidos.

**Cómo se vende hoy**
- Los pedidos entran por un **formulario de Google** ("Pedidos Tarta Vasca"). Pide: nombre, **fecha deseada (mínimo 24 h de anticipación)**, dirección si quieren envío a domicilio (con costo extra), teléfono y las tartas por sabor y tamaño.
- En Instagram, cuando alguien pregunta por un pedido, Rebeca o su equipo **manda el link del formulario y las rutas que cubren**, u ofrece **entregar en una tienda**.
- Después el equipo **confirma por mensaje** pedidos ya registrados ("solo para confirmar si registró un pedido para el martes").
- Hay sucursales en **Polanco** y **Cuajimalpa**, con horarios distintos [confirmar vigentes].

**Qué preguntan los clientes (lo poco que hay en DMs)**
- Si ya abrieron o si abren mañana en una sucursal, y los horarios.
- Dónde queda una sucursal.
- Si hacen envío (por ejemplo, para un cumpleaños).
- Hasta cuándo hay un sabor de temporada (por ejemplo, pumpkin spice, "solo durante este mes").
- Alguien que quería mandar su catálogo en PDF (probablemente un contacto comercial, no un cliente final).
- La mayor parte del tráfico **no son preguntas**: son reacciones y menciones a historias, a las que Rebeca responde con gratitud.

**Catálogo visto en el formulario (de 2024, no usar como fuente de precios)**
- Sabores de línea: tradicional de queso, Lotus, Pistache, Oreo, Frutos Rojos, Guayabrie, Queso Azul, Pumpkin Spice (temporada), Elote Dorado, Carajillo, Dulce de Leche, Matcha, Kinder Bueno, Taro Velvet, Cacao Intenso, Limón Amalfi, Cookie Dough, además de pan de muerto relleno de tarta (temporada).
- Tamaños: individual o chica (2 porciones), mediana y grande.
- Descripciones con gancho, por ejemplo: "mezcla perfecta de quesos con café colombiano y licor del 43".

**Aviso sobre precios.** Hay más de una fuente y no coinciden: el formulario antiguo, la pestaña *Precios* del Sistema (base individual 240, mediana 420, vigente desde el 3 de octubre de 2026) y la pestaña *Utilidades* (que muestra 260 y 450 para queso). **El bot solo debe usar una fuente.** Propongo *Precios* del Sistema [confirmar].

### Lo que pide el audio del 21 de octubre (transcrito, resumen fiel)
- **Objetivo:** que el bot se sienta **parte del equipo**, con un trato muy cercano, y que comprar una tarta sea agradable **de principio a fin**.
- **Qué debe hacer:** resolver cualquier duda, ofrecer productos y tamaños, hablar de las sucursales y su ubicación (**con el link de Google Maps de cada tienda**), ofrecer **servicio a domicilio respetando los horarios que se pueden cumplir**, y **contestar sobre la disponibilidad de tartas**. Mucha gente escribe antes de ir a la tienda para confirmar que haya la tarta que quiere.
- **Datos que debe tomar en un pedido:**
  1. Nombre del cliente.
  2. Fecha para la que quiere el pedido.
  3. **Fecha y hora en que se toma el pedido** (para poder identificarlo).
  4. Tarta o tartas: **tamaño y sabor**.
  5. **Total del pedido**, y si es a domicilio, el **costo de envío sumado al total**.
  6. Dirección de entrega y teléfono; o, si recoge, **en qué sucursal**.
- **Ticket electrónico:** al final, un resumen con los productos y el total.
- **Formas de pago que debe explicar:** efectivo al comprar o al repartidor, transferencia, o tarjeta en la sucursal.

---

## 2. Personalidad del bot

**Base:** la voz real de Rebeca en sus mensajes.
- Agradecida y cercana, como con una amiga. Habla de **tú** y usa el **nombre** del cliente.
- Cálida y juguetona: "gracias x compartir ❤️", "q linda, muchas gracias por visitarnos!!". Emojis de corazón, con medida.
- Lo práctico, corto y claro: horarios, dirección, cómo pedir.
- Evita el tono corporativo ("estimado cliente", "le informamos").
- Cuida la comunidad: agradece cuando comparten o mencionan la tienda.

**Ejemplos de voz (para afinar con Rebeca)**
- Saludo: "Hola [nombre]! ❤️ Qué gusto saludarte. ¿Te ayudo con un pedido o quieres ver qué tartas hay hoy?"
- Agradecimiento: "Gracias x compartir, [nombre]! Nos hace el día ❤️"
- Dato práctico: "Polanco abre de 11 a 7 y Cuajimalpa de 10 a 2:30 [confirmar]. ¿Te queda alguna?"

**Honestidad.** El bot suena natural y no se presenta como robot, pero **si un cliente pregunta en serio si habla con una persona o con una IA, lo dice con claridad y con cariño**, y ofrece pasar con Rebeca. No inventa nada: si no sabe algo, lo dice y lo pasa al equipo.

---

## 3. Hipótesis de procesos

### 3.1 Vender (conversación para tomar un pedido)
1. **Saludo y reconocimiento.** Si ya es cliente (campo o etiqueta en ManyChat), lo saluda por su nombre.
2. **Intención.** ¿Quiere pedir, ver qué hay, o tiene una duda?
3. **Fecha primero.** Es lo que decide el camino:
   - **Mínimo 24 h de anticipación**, como en el formulario actual [confirmar]: pedido por encargo desde el catálogo.
   - **Hoy o mañana:** solo lo que haya en inventario del día, para recoger en tienda [confirmar si hay entrega el mismo día].
4. **Qué tarta.** Sabor, tamaño y cantidad. Le muestra solo sabores **activos y disponibles** para esa fecha, y menciona los de temporada.
5. **Entrega.** Recoger en sucursal (Polanco o Cuajimalpa) o a domicilio. Para domicilio pide colonia o dirección, calcula la zona y le dice el costo de envío (hoy hay zonas de $60 y $90 [confirmar]).
6. **Datos para completar el pedido:** nombre, teléfono, dirección (o sucursal de recolección) y notas (alergias, dedicatoria, etc.). El bot registra solo la **fecha y hora en que se toma el pedido**.
7. **Resumen y confirmación del cliente.** Un **ticket electrónico** en un mensaje: productos, envío si aplica y **total**. Pide un "sí".
8. **Formas de pago:** efectivo (en tienda o al repartidor), transferencia o tarjeta en sucursal. El bot **no cobra**; las explica [confirmar anticipo, si lo hay].
9. **Registro y aviso.** Guarda el pedido como **Por confirmar**, avisa a Rebeca y le dice al cliente que ella o el equipo le confirman.

**Consulta de disponibilidad (caso muy frecuente según el audio):** alguien quiere ir a comprar a la tienda y pregunta si hay cierta tarta. El bot responde con el inventario de esa sucursal y manda el **link de Google Maps** de la tienda.

### 3.2 Ver el inventario del día
- Fuente: el **archivo espejo de solo lectura**, no el Sistema.
- **Disponible = cantidad actual − reservas**, solo en estado activo y no caducado. La vida útil configurada es de 4 días.
- Por sucursal y tamaño. El bot responde "hoy tenemos…" y no promete cantidades exactas: "según lo que tenemos ahorita; Rebeca te confirma".
- Se actualiza con fórmulas (casi en tiempo real). Antes de confiar en él lo probamos con un cambio real de inventario.

### 3.3 Crear pedidos
- Cada pedido es **una fila ordenada** en una hoja propia del bot (*Pedidos_Bot*): id, fecha del pedido, fecha de entrega, cliente, usuario de Instagram, teléfono, artículos (sabor, tamaño, cantidad), entrega (tienda o domicilio), dirección, zona, envío, total, notas, **estado** (Por confirmar, Confirmado, Cancelado, Modificado) e historial de cambios.
- **No escribe en el Sistema ni en la hoja actual del formulario**, que es muy ancha (una columna por producto). Rebeca confirma y pasa el pedido a su proceso. Más adelante se puede automatizar ese paso [confirmar cómo usa su equipo la hoja del formulario y las rutas].

### 3.4 Editar pedidos (último en construirse)
- **Identificación:** nombre y teléfono del pedido, para que nadie edite el de otra persona.
- **Cuándo se puede:** mientras esté *Por confirmar*, o hasta 24 h antes de la entrega [confirmar]. Después, pasa con Rebeca.
- Cada cambio queda con fecha y hora, el estado pasa a *Modificado* y se avisa a Rebeca.

### 3.5 Dudas
- **Sobre las tartas:** ingredientes, alérgenos, conservación, porciones, vida útil (4 días en Configuración). Sale de una hoja de preguntas frecuentes que Rebeca valida.
- **Sobre La Tarta Vasca:** historia, sucursales, horarios, cómo pedir, comunidad.
- Lo que no esté en esa información, **no lo inventa**: lo pasa a Rebeca.

---

## 4. Arquitectura propuesta

```
Instagram (@tartavasca)
        │
     ManyChat  ── etiquetas, campos, traspaso a humano
        │  llamada externa (External Request, plan Pro)
        ▼
 Servicio del bot ── Claude con estas herramientas:
        │             · consultar_inventario(fecha, sucursal)
        │             · consultar_precios_y_zonas()
        │             · crear_pedido(...)
        │             · buscar_pedido(nombre, teléfono)
        │             · editar_pedido(...)
        ▼
 Archivo espejo (solo lectura)  ← fórmulas ←  Sistema (nunca expuesto)
 Pedidos_Bot (escritura)  →  aviso a Rebeca
```

- **Regla central:** el bot solo dice precios, disponibilidad y costos que salen de las herramientas, nunca de su memoria.
- **ManyChat Pro:** las llamadas externas requieren el plan de pago; hay que confirmarlo en su pantalla de planes. Alternativa a evaluar: una plataforma de IA hecha para esto.
- **Ventana de 24 h de Instagram:** el bot responde dentro de las 24 h siguientes al último mensaje del cliente. Si Rebeca confirma después, el aviso al cliente podría no llegar por ahí [verificar].
- **Pruebas:** con una palabra clave exclusiva (`PRUEBA`), sin tocar el saludo ni la respuesta predeterminada que ven los clientes reales.

---

## 5. Riesgos y pendientes

1. **Precios en conflicto** entre tres fuentes. Elegir una.
2. **Seguridad del Sistema:** la pestaña *Usuarios* parece guardar contraseñas sin cifrar. Corregirlo aparte y mantener el Sistema fuera del alcance del bot.
3. **Datos de clientes** (teléfonos, direcciones): solo la información necesaria, en la hoja del bot, con acceso limitado.
4. **Datos desactualizados:** horarios y sabores de 2024 y 2026 conviven. Todo debe validarse con Rebeca.
5. **Cambios de menú o temporada** (pan de muerto, pumpkin spice): quién actualiza el catálogo y cuándo.

---

## 6. Preguntas para mañana

1. ¿Cuál es la **fuente oficial de precios**?
2. ¿Hay **entrega el mismo día**? ¿Cuánto se pide de **anticipo** y cómo se cobra?
3. ¿Cómo usa su equipo la **hoja del formulario** y las **rutas de entrega**? ¿Qué días y zonas cubren?
4. Horarios y sucursales **vigentes**.
5. ¿Quieres que el bot también **conteste menciones y reacciones a historias** con agradecimiento, o eso lo sigue haciendo Rebeca en persona?
6. Alérgenos, porciones y conservación de **cada sabor**.
7. ¿Cuándo debe **pasar la conversación a Rebeca**? (pedidos grandes, eventos, quejas, regalos corporativos…)
8. ¿Cómo debe **avisarle** el bot a Rebeca de un pedido nuevo: WhatsApp, correo o notificación de ManyChat?
9. **Links de Google Maps** de Polanco y Cuajimalpa.
10. **Horarios de entrega a domicilio** que sí se pueden cumplir, por zona y por día.
11. ¿El **ticket electrónico** basta como mensaje de texto, o lo quieren como imagen o PDF con la marca?
12. En el audio dices que el bot "simule que sea uno de nosotros": confirmamos que hablará como parte del equipo, y que si un cliente pregunta en serio si es una IA, lo dirá.
