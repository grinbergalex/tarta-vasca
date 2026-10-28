# Tarta Vasca: cómo se conecta el bot a lo que ya existe (v3, tras revisar el proyecto)

Revisé el repositorio *tarta-vasca* (el POS, el Apps Script y el sincronizador de Shopify). **No modifiqué nada.** Esto sustituye a las versiones anteriores.

## Lo que ya existe y el bot puede reutilizar

El sistema es un POS de Apps Script (`backend/`) sobre el Google Sheet, con un único punto de entrada HTTP. Y **ya hay un camino para pedidos en línea**: los pedidos pagados de Shopify entran al POS como **reservas** (no como ventas), con la misma puerta que usa la app de sucursal.

| Pieza existente | Qué hace | Cómo la usa el bot |
|---|---|---|
| `tiendaDisponibilidad` (acción **pública**, sin credenciales) | Devuelve, por sucursal, qué sabor y tamaño se puede **recoger hoy** y cuántas piezas máximo, más las reglas del calendario (horarios de recolección, días de preparación, hora de corte). **No expone el inventario**: solo lo que alcanza el mínimo. Caché de 30 s, se invalida con cada movimiento. | **Inventario del día** y reglas de fechas, sin dar acceso a nada. |
| `registrarVenta` con `tipoOp: "reserva"` | Crea la reserva: items (sabor, tamaño, cantidad), canal (*Tienda* o *Domicilio*), fecha de entrega, envío, cliente (nombre, teléfono), anticipo. Si el precio va en 0, **el sistema usa su propia tabla de precios**. Es **idempotente** con un `opId` (no duplica un pedido repetido). Registra auditoría, cliente y reserva de stock. | **Crear pedido** (igual que el sincronizador de Shopify). |
| `getReservas`, `getApartados`, `convertirReservaAVenta`, `liberarReserva` | Ver, convertir en venta el día de la entrega, o liberar. | La sucursal convierte la reserva el día de la entrega; **editar pedido** se apoya en liberar y volver a crear. |
| `getPrecios`, `getZonasEnvio`, `getCatalogo` | Precios, zonas de envío y sabores activos (requieren sesión de un usuario del POS). | Precios y costo de envío. |
| `enviarMensaje` y correos (`MailApp`) | Mensajes dentro del POS y correos (ya se usan para la caja). | Avisar a Rebeca. |
| Sincronizador de Shopify | Convierte pedidos **pagados** de Shopify en reservas, con una cuenta de POS por sucursal. | El patrón a imitar para el bot. |

**Reglas del calendario que ya están definidas en el sistema** (y que el bot debe respetar, no reinventar):
- Recoger **hoy** solo si en esa sucursal quedan **al menos 2 piezas** de ese sabor y tamaño (se deja 1 de reserva).
- Pedido sobre demanda: **1 día de preparación**; los pedidos **después de las 17:00** suman un día más.
- Se puede reservar hasta **14 días** adelante; horarios de recolección de **60 minutos**.
- Horarios de recolección: Cuajimalpa L–V 9:00–18:00 y S–D 10:00–15:00; Polanco todos los días 11:00–19:00.

Esto confirma tu intuición del audio: **los pasos dependen de la fecha deseada**. Hoy y con piezas suficientes → recoger hoy; si no → sobre pedido, con las reglas de arriba.

## Flujo propuesto

1. El cliente dice para cuándo quiere la tarta y dónde la recibe.
2. El bot consulta `tiendaDisponibilidad` (pública):
   - **Hoy y hay piezas** → ofrece recoger hoy en esa sucursal, dentro del horario.
   - **Si no** → aplica la preparación de 1 día (+1 si pasó de las 17:00) y propone la primera fecha posible, dentro del horario.
3. Domicilio: martes a sábado, con costo por zona ($60, $90, $120).
4. Toma nombre, teléfono, dirección y notas, y manda el **ticket electrónico**.
5. Con el "sí" del cliente, crea la **reserva** (`registrarVenta`, `tipoOp: reserva`, `opId` propio, método de pago *Pendiente*, anticipo 0).
6. Avisa a Rebeca. La reserva ya aparece en la app de la sucursal (*Ventas → Apartados*), que es donde el equipo trabaja.

## Lo que hay que decidir o construir

1. **Una cuenta del POS para el bot**, con rol limitado y revocable. El sincronizador usa una cuenta por sucursal porque el POS registra en la sucursal del usuario; un rol que vea ambas permitiría elegir la sucursal. Es una decisión de permisos.
2. **Cálculo de la "primera fecha posible".** Hoy esa lógica vive en el **tema de Shopify** (el calendario del carrito). Si el bot la reescribe, puede dar una fecha distinta a la de la tienda en línea. Lo más consistente es **mover el cálculo al backend como una acción pública** que usen el tema y el bot. Es un cambio al sistema en producción.
3. **Método de pago *Pendiente***: hoy el sincronizador usa *Shopify*. El bot necesita un método propio (por ejemplo, *Instagram*) para reportes y comisiones. Revisar cómo lo trata la hoja *Comisiones*.
4. **Envíos a domicilio:** el sincronizador los registra en **Cuajimalpa**, pero el proyecto ya anota que deben salir de **Bosques** (la cocina). Hay que resolverlo antes de que el bot tome pedidos a domicilio.
5. **Cómo avisa a Rebeca** (ver opciones abajo).
6. **Editar pedido (al final):** no existe "editar"; sería liberar la reserva y crear otra con el mismo `opId` de origen, conservando historial.

## Reglas del proyecto que hay que respetar al cambiar algo

(Están en `CLAUDE.md` del repo.)
- `backend/` es **producción**; el ambiente de pruebas es **otro** proyecto de Apps Script y otra hoja. Todo se prueba primero ahí.
- Antes de cualquier `clasp push`, **bajar la versión viva y compararla con el repo**. Publicar una versión despliega *todo* lo que haya subido.
- Un push a `main` es deploy inmediato del frontend.
- Toda acción nueva va en el `switch` de `despachar()` y, si es de lectura, en la lista `LECTURA` de `app.js`.
- No poner llaves en el frontend (GitHub Pages es público).

## Cómo avisar a Rebeca

| Opción | Ventajas | Desventajas |
|---|---|---|
| **La reserva en *Apartados* del POS** | Ya existe; es su herramienta | Hay que abrir la app |
| **Mensaje dentro del POS** (`enviarMensaje`) | Ya existe; llega con la campana de alertas | Solo si tiene la app abierta |
| **Correo** (`MailApp`) | Ya se usa para la caja; queda registro | No es instantáneo |
| **Notificación de ManyChat** + asignar el chat a Rebeca | Ve y contesta en el mismo chat | Requiere la app móvil de ManyChat |
| **WhatsApp** o **Telegram** | Inmediato | WhatsApp requiere API y costo; Telegram, instalarlo |

**Recomendación:** la reserva en el POS + **correo** + notificación de ManyChat para traspasos a persona.

## Seguridad

- La pestaña *Usuarios* del Sistema guarda contraseñas que parecen estar sin cifrar. Corregirlo aparte.
- El bot **no usa** una cuenta del dueño: cuenta propia, permisos mínimos, revocable.
- `tiendaDisponibilidad` es pública pero no expone inventario; es seguro dejarla como está.

## Pruebas (en el ambiente de pruebas, nunca en producción)

1. Que el bot ofrezca "recoger hoy" solo cuando haya al menos 2 piezas.
2. Un pedido después de las 17:00: debe sumar un día.
3. Un pedido repetido (mismo `opId`): no debe duplicar.
4. Que la reserva aparezca en *Apartados*, con su cliente, fecha y envío.
5. Un cambio de inventario o de precio en el sistema: el bot lo refleja sin tocar nada más.

## Pendientes antes de construir

1. Decidir la cuenta del POS del bot y el método de pago.
2. Decidir si el cálculo de fechas pasa al backend.
3. Resolver los envíos desde Bosques.
4. Corregir las discrepancias de datos entre Shopify y el Sistema.
5. Decidir el plan de ManyChat (las llamadas externas son del plan Pro).
