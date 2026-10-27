/**
 * ============================================================================
 * TARTA VASCA — BACKEND v6 "InvCore" (rewrite 2026-06-28)
 * Capa central unica de inventario. Reusa columnas v5 de tu hoja:
 *   Inventario col6=total | col16=res_ruta | col17=res_apartado
 *   disponible = total - res_ruta - res_apartado.  Hoja Inv_Ledger = bitacora.
 *
 * QUE CAMBIA vs v4.5.17:
 *  - Toda mutacion de inventario pasa por InvCore (producir/descontar/reservar/
 *    liberar/transferir/ajustar) y queda asentada en Inv_Ledger.
 *  - Transferencias atomicas y sin fantasmas.  Apartados con reserva FISICA:
 *    al entregar (convertirReservaAVenta) ahora SI descuenta inventario.
 *  - Disponible = una sola formula en todo el sistema (no mas oversell de
 *    stock reservado a ruta/apartado).
 *  - auditarConsistencia() compara inventario vs ledger (debe dar verde).
 *
 * ACTIVACION (NO pegar en media operacion):
 *  1. Pega TODO este codigo en Apps Script (reemplaza el actual). Guardar.
 *  2. Implementar -> Editar implementacion existente -> Nueva version (misma URL).
 *  3. En el editor, ejecutar UNA vez la funcion:  migrarReservasFisicas()
 *     (inicializa res_ruta/res_apartado desde apartados y rutas abiertas).
 *  4. Hacer conteo fisico con la pestana Ajuste de inventario (ambas sucursales).
 *  5. Ejecutar  auditarConsistencia()  -> debe decir "CONSISTENCIA OK (verde)".
 *  6. El index.html (frontend) NO cambia: ya lee disponible/reservado del backend.
 *
 * v6.1 (2026-07-02): (a) la reposicion por anulacion YA asienta en Inv_Ledger
 * (tipo REPOSICION_ANULACION) — limitacion v1 cerrada; (b) auditoria automatica
 * diaria 7am con correo solo si hay rojo + latido verde los lunes.
 * Activar una vez desde el editor:  instalarAuditoriaDiaria()
 * ============================================================================
 */

/**
TARTA VASCA — Apps Script API v4.5.17-pedido2 (base v4.5.13-skip-anulados)

CAMBIOS v4.5.17 (14-jun-2026):
★ getPedidoSugerido ahora devuelve TAMBIEN un segundo metodo (sugerido2 /
totalSugerido2 / metodo2): "tendencia mismo dia". Promedio ponderado de los
4 mismos dias de la semana anteriores con UNIDADES REALES (hace 1/2/3/4 sem
= 32/24/16/8%, bloque 80%) + 20% del sugerido del metodo 1, +10% buffer.
Redistribuye el peso de las semanas sin datos entre las que si tienen ventas.
El metodo 1 (ventana-7d) se conserva intacto.

BASE: v4.5.7-fix-inventario  (que a su vez basa en v4.5.6-flush-rutaId)

CAMBIOS v4.5.8 (24-may-2026):
★ altaProduccion ahora también usa LockService.waitLock(30s) + flush().
Sin esto, una venta inmediata después de cargar producción podía leer
inventario stale y sub-descontar. Cierra el último flanco del bug
de "inventario no se actualiza".

CAMBIOS v4.5.7 (24-may-2026):
★ FIX CRÍTICO: Inventario no descontaba correctamente cuando un mismo
sabor/tamaño aparecía repetido en la misma venta (ej. paquete con
sabores repetidos). Causa: descontarFIFO usaba un snapshot stale
de Inventario; ahora cada llamada re-lee fresh.
★ FIFO desactivado por decisión de negocio (ya no se ordena por fecha).
Renombrado descontarFIFO → descontarStock (alias mantenido).
★ LockService.waitLock(30s) en registrarVenta, registrarMerma y
eliminarMovimiento — serializa escrituras entre sesiones concurrentes.
★ Atómico: si cualquier item de la venta falla al descontar, todas las
deducciones se revierten (_rollbackInventario) y NO se registra venta.
★ Pre-check agregado por SKU: suma cantidades de items repetidos ANTES
de validar stock disponible.
★ eliminarMovimiento: nunca falla en silencio. Si stock no se puede
reponer al cancelar, devuelve {ok:true, advertencia:true, mensaje:"⚠️ ..."}
con detalle de fallas y conteo (repuesto_uds / esperado_uds).
★ _reponerStockVenta: regex de lotes permisivo, re-lee inventario fresh,
fallback que crea lote REINGRESO si no encuentra ninguno previo.

Funciones tocadas:

descontarStock (nueva, reemplaza descontarFIFO)

_rollbackInventario (nueva)

descontarFIFO (mantenida como alias backward-compat)

calcularDisponible (acepta hoja o snapshot)

registrarVenta

registrarMerma

eliminarMovimiento

_reponerStockVenta
*/
const VIDA_UTIL_DIAS = 9999;  // CADUCIDAD ELIMINADA — constante conservada por compatibilidad
const FACTOR_SEMANAS_MES = 4.2;
const SESION_HORAS = 24;                  // v4.4 — máximo absoluto
const SESION_INACTIVIDAD_MIN = 720;       // v7.1 — auto-logout 12 h sin actividad.
// Estaba en 60: una tarde floja bastaba para tirar a la vendedora al login, y cada
// re-login expulsaba la sesion mas vieja de ese usuario (ver crearSesion). 12 h cubre
// una jornada completa sin dejar la sesion viva de un dia para otro.
const MAX_SESIONES_OWNER = 99;
const MAX_SESIONES_NORMAL = 10;           // v7.1 — era 3: con un usuario compartido entre
// varias tablets el tope se tocaba a diario y cada login expulsaba a alguien mas.
const TZ_MX = "America/Mexico_City";
// v7.2 — Pago dividido: un ticket cobrado con varios métodos.
// El método del ticket queda como METODO_MIXTO y el desglose vive en la columna
// "pagos" de la hoja Ventas (JSON, solo en la PRIMERA fila del ticket).
const METODOS_PAGO = ["Efectivo", "Tarjeta", "Transferencia"];
const METODO_MIXTO = "Mixto";
const PAGO_TOLERANCIA = 0.5;   // pesos: margen de redondeo al cuadrar el desglose
// v8 — Cocina Bosques. UNICA fuente de verdad de las sucursales.
// Bosques es la cocina: ahi se produce, de ahi salen las transferencias y las rutas
// de reparto, y tambien vende. Cuajimalpa y Polanco son solo punto de venta: reciben
// stock por transferencia desde la cocina. Mantener el mismo orden en app.js (SUCURSALES).
const SUCURSAL_COCINA = "Bosques";
const SUCURSALES_PUNTO_VENTA = ["Cuajimalpa", "Polanco"];
const SUCURSALES = [SUCURSAL_COCINA].concat(SUCURSALES_PUNTO_VENTA);
const SUCURSAL_LEGADO_ORIGEN_TRANSFER = "Cuajimalpa";  // antes de v8 la cocina era Cuajimalpa
const SUCURSAL_LEGADO_DESTINO_TRANSFER = "Polanco";    // y lo unico transferible iba a Polanco
// Horarios de atención a clientes por sucursal, por día (0=Domingo). 24h format; null = cerrado.
// UNICA fuente de verdad: la caja, el cierre automático, los reportes del día y la
// recolección de la tienda en línea leen de aquí.
const HORARIO_ENTRE_SEMANA = { abre: "09:00", cierra: "18:00" };
const HORARIO_SABADO_COCINA = { abre: "09:00", cierra: "15:00" };
const HORARIO_DOMINGO_CUAJIMALPA = { abre: "11:00", cierra: "15:00" };
const HORARIO_POLANCO = { abre: "11:00", cierra: "19:00" };
const HORARIO_CERRADO = { abre: "00:00", cierra: "00:00", cerrado: true };  // lo que ve el código en un día sin atención
const HORARIOS_SUCURSAL = {
"Bosques":    [null, HORARIO_ENTRE_SEMANA, HORARIO_ENTRE_SEMANA, HORARIO_ENTRE_SEMANA, HORARIO_ENTRE_SEMANA, HORARIO_ENTRE_SEMANA, HORARIO_SABADO_COCINA],
"Cuajimalpa": [HORARIO_DOMINGO_CUAJIMALPA, HORARIO_ENTRE_SEMANA, HORARIO_ENTRE_SEMANA, HORARIO_ENTRE_SEMANA, HORARIO_ENTRE_SEMANA, HORARIO_ENTRE_SEMANA, HORARIO_SABADO_COCINA],
"Polanco":    [HORARIO_POLANCO, HORARIO_POLANCO, HORARIO_POLANCO, HORARIO_POLANCO, HORARIO_POLANCO, HORARIO_POLANCO, HORARIO_POLANCO]
};
// v7.6 — Tienda en línea: recolección en sucursal (calendario del carrito de Shopify).
// Es el mismo horario de atención (HORARIOS_SUCURSAL); solo las sucursales donde se recoge.
const RECOGER_HORARIOS = {
"Cuajimalpa": HORARIOS_SUCURSAL["Cuajimalpa"],
"Polanco":    HORARIOS_SUCURSAL["Polanco"]
};
const RECOGER_MIN_PIEZAS_MISMO_DIA = 2;  // con menos piezas en sucursal, la tarta se pide para después
const RECOGER_DIAS_PREPARACION = 1;      // días que tarda una tarta sobre pedido
const RECOGER_HORA_CORTE = "17:00";      // pedidos sobre pedido después de esta hora suman un día más
const RECOGER_INTERVALO_MIN = 60;        // tamaño de cada horario que elige el cliente
const RECOGER_DIAS_A_MOSTRAR = 14;       // hasta cuántos días adelante se puede reservar
// v9 — Bot de Instagram (18_bot_conversacion.js). Las reglas de fechas reutilizan RECOGER_*.
const BOT_MODELO = "claude-sonnet-5-5";
const BOT_MAX_TOKENS = 1024;
const BOT_MAX_VUELTAS_HERRAMIENTAS = 6;     // veces que puede pedir herramientas en un solo turno
const BOT_MAX_MENSAJES_HISTORIAL = 30;      // mensajes de la conversación que recuerda
const BOT_HISTORIAL_SEGUNDOS = 21600;       // 6 h: la conversación se olvida sola
const BOT_MAX_TURNOS_POR_CONVERSACION = 60; // tope para cuidar el gasto de IA
const BOT_MAX_CARACTERES_MENSAJE = 1000;
// --- Pedidos con seguimiento (v9) -------------------------------------------------
const PEDIDO_PREFIJO_REFERENCIA = "TV";
const PEDIDO_PROPIEDAD_CONSECUTIVO = "PEDIDO_REF_";      // propiedad del script con el último consecutivo del día
const PEDIDO_VENTANA_FILAS = 200;                        // un pedido recién creado se busca solo en las últimas filas de Ventas
const PEDIDO_COLUMNAS = ["referencia", "estado_pedido", "contacto_seguimiento", "origen_pedido"];  // se crean solas en Ventas
const PEDIDO_ESTADO = { APARTADO: "APARTADO", POR_CONFIRMAR: "POR CONFIRMAR", CONFIRMADO: "CONFIRMADO", ENTREGADO: "ENTREGADO", NO_RECOGIDO: "NO RECOGIDO", CANCELADO: "CANCELADO" };
const PEDIDO_MOTIVO_NO_RECOGIDO = "Cliente no llegó";
const PEDIDO_HOJA_NO_RECOGIDOS = "Pedidos_No_Recogidos";   // lista de trabajo de la campaña de recuperación
const PEDIDO_CANALES_RECOGER = ["Tienda", "Apartado", "Reservado"];   // canales con recolección en sucursal (Domicilio va por ruta)
const PEDIDO_HORA_REVISION = 21;                           // hora del reporte diario (después de cerrar todas las sucursales)
const PEDIDO_RECORDATORIO_DESDE = 9;                       // el recordatorio de pedidos sin confirmar solo sale entre estas horas
const PEDIDO_RECORDATORIO_HASTA = 20;
const PEDIDO_RECORDATORIO_HORAS_DEFECTO = 2;
const PEDIDO_CLAVE_RECORDATORIO_HORAS = "pedido_recordatorio_horas";
// Claves de la hoja Configuración (las edita el equipo; si están vacías el bot no inventa nada):
const PEDIDO_CLAVE_TRANSFERENCIA = "pedido_datos_transferencia";   // banco, titular, CLABE e indicaciones de la transferencia
const PEDIDO_CLAVE_POLITICA = "pedido_politica_no_recoger";        // qué pasa si el cliente no pasa por su pedido
const PEDIDO_CLAVE_AUTO_NO_RECOGIDO = "pedido_auto_no_recogido";   // "SI" = el reporte diario marca solo los vencidos
const PEDIDO_CLAVE_GRACIA_DIAS = "pedido_gracia_dias";             // días después de la fecha de entrega antes de darlo por no recogido
// --- Avisos por WhatsApp (v9, ver 20_whatsapp_avisos.js) ---
const WHATSAPP_VERSION_API = "v21.0";
const WHATSAPP_IDIOMA = "es_MX";
const WHATSAPP_PLANTILLA_DEFECTO = "aviso_equipo_tarta_vasca";
const WHATSAPP_CLAVE_NUMEROS = "aviso_whatsapp_numeros";
const WHATSAPP_CLAVE_PLANTILLA = "aviso_whatsapp_plantilla";
const WHATSAPP_CLAVE_RESUMEN = "aviso_whatsapp_resumen";   // números que reciben además el resumen de pendientes (la Dueña)
const WHATSAPP_MAX_DETALLE = 700;      // las variables de una plantilla no pueden pasar de ~1000 caracteres en total
const BOT_DIAS_COMPLETOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const BOT_MESES_NOMBRE = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const BOT_NOMBRE = "";                      // nombre con el que se presenta el bot (pendiente de definir con Rebeca); vacío = sin nombre
const BOT_PEDIDOS_ACTIVOS = true;         // encendido en la rama de pruebas: el bot toma pedidos; false = solo consulta
const BOT_HERRAMIENTAS_DE_PEDIDO = ["cotizar_pedido", "crear_pedido", "consultar_pedido"];
const BOT_MAX_PIEZAS_POR_PEDIDO = 12;       // más que esto pasa con una persona (eventos, regalos corporativos)
const BOT_USUARIO = "bot-instagram";
const BOT_ROL = "Admin_Ventas";             // sesión interna (nunca sale por el API): permite elegir la sucursal al reservar
const BOT_SUCURSAL_DOMICILIO = SUCURSAL_COCINA;
const BOT_DIAS_ENTREGA_DOMICILIO = [2, 3, 4, 5, 6];   // martes a sábado, como dice la página de la tienda
const BOT_VENTANA_ENTREGA = { abre: "09:00", cierra: "15:00" };
const BOT_HORA_CORTE_DOMICILIO = "18:00";   // pedidos a domicilio después de esta hora suman un día
const BOT_MARGEN_MISMO_DIA_MIN = 60;        // para recoger hoy, tiene que faltar al menos esto para cerrar
const BOT_TIENDA_URL = "https://latartavasca.com";
const BOT_TAMANOS = ["Individual", "Mediana", "Grande"];
const BOT_ALIAS_TAMANO = { "chica": "Individual", "individual": "Individual", "mediana": "Mediana", "grande": "Grande" };
const BOT_SUCURSALES_RECOGER = ["Cuajimalpa", "Polanco", "Bosques"];   // dónde se puede recoger un pedido del bot (horario = HORARIOS_SUCURSAL)
const BOT_MAX_LLAMADAS_POR_DIA = 1500;      // tope de gasto de IA por día, para todas las conversaciones
const BOT_MAX_PEDIDOS_POR_HORA = 12;        // contra pedidos falsos en masa
const BOT_COTIZACION_SEGUNDOS = 3600;       // el ticket mostrado vale una hora para poder crear el pedido
const BOT_HOJA_MANUAL = "Bot_Manual";                   // pestaña de la hoja con la guía de marca (Tema | Contenido); Rebeca la edita
const BOT_TEMAS_MANUAL = ["historia", "filosofia", "sabores", "recomendar_sabores", "preguntas_frecuentes", "pedidos_y_canales", "pagos_y_facturas"];
const BOT_COLECCION_TEMPORADA = "temporada";            // colección de la tienda en línea con el sabor de temporada
const BOT_ETIQUETA_TEMPORADA_HASTA = "temporada-hasta:"; // etiqueta opcional del producto, ej. temporada-hasta:2026-10-31
const BOT_CANAL_RECOGER = "Tienda";
const BOT_CANAL_DOMICILIO = "Domicilio";
const BOT_CACHE_INFO_SEGUNDOS = 600;        // páginas y menú de Shopify
const BOT_CACHE_FECHA_SEGUNDOS = 300;        // la fecha ya validada en la conversación se reutiliza al crear el pedido
const BOT_CACHE_MENU_SEGUNDOS = 60;         // el menú ya calculado (un cambio de precio llega al bot en menos de 1 min)
const BOT_SONDEO_MAX_SEGUNDOS = 7;           // cuánto puede esperar botRespuesta a que la respuesta esté lista (ManyChat corta a ~8 s)
const BOT_SONDEO_PASO_MS = 500;
const BOT_RESULTADO_SEGUNDOS = 600;         // cuánto se guarda la respuesta lista para que ManyChat la recoja
// Dónde están las sucursales (el horario sale de HORARIOS_SUCURSAL). ⚠ La dirección de Bosques salió
// de un mensaje de mayo-2026: confirmar con Rebe.
const BOT_SUCURSALES_INFO = {
"Polanco":    { direccion: "Calle Arquímedes 69, Col. Polanco", mapa: "https://maps.app.goo.gl/8SgqYN1heaJwBbSu5" },
"Cuajimalpa": { direccion: "Av. Noche de Paz 14, local 16B, Col. Granjas Navidad", mapa: "https://maps.app.goo.gl/qHVxeqaJqz8RAETN8" },
"Bosques":    { direccion: "Av. Stim 1374, Lomas del Chamizal, Cuajimalpa de Morelos", mapa: "https://maps.app.goo.gl/FK1PCmWkxqKNLTYW6" }
};
function getHorarioHoy(sucursal, fecha) {
fecha = fecha || new Date();
const cfg = HORARIOS_SUCURSAL[sucursal];
if (!cfg) return { abre: "10:00", cierra: "19:00" };
return cfg[fecha.getDay()] || HORARIO_CERRADO;
}
function calcMontoMensual(monto, frecuencia) {
if (frecuencia === "Semanal") return monto * FACTOR_SEMANAS_MES;
if (frecuencia === "Mensual") return monto;
return 0;
}
// =================================================================================
// ROLES Y PERMISOS — v4.3
// =================================================================================
/**
Devuelve los permisos para un rol dado.
Owner:        todo permitido (admin del sistema)
Vendedor:     solo vende en su sucursal
Cocinero:     solo produce y transfiere; NO vende
Mixto:        produce, transfiere y vende en su sucursal
Admin_Ventas: vende en ambas sucursales y transfiere

NUEVO en v4.3: `puedeAnular` indica si el usuario puede anular movimientos.
Por defecto solo Owner; pero un Owner puede otorgarlo a un usuario específico
vía editarUsuario({campos: {permisos_extra: {puedeAnular: true}}}) — ver más abajo.
*/

