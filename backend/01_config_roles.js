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
const PEDIDO_ESTADO = { APARTADO: "APARTADO", POR_CONFIRMAR: "POR CONFIRMAR", CONFIRMADO: "CONFIRMADO", POR_REVISAR: "POR REVISAR", ENTREGADO: "ENTREGADO", NO_RECOGIDO: "NO RECOGIDO", CANCELADO: "CANCELADO" };   // POR REVISAR: no se recogió y sigue apartado hasta que una persona decida
const PEDIDO_ESTADOS_ABIERTOS = [PEDIDO_ESTADO.APARTADO, PEDIDO_ESTADO.POR_CONFIRMAR, PEDIDO_ESTADO.CONFIRMADO, PEDIDO_ESTADO.POR_REVISAR];   // lo que sigue apartado y todavía no se cierra
const PEDIDO_MOTIVO_NO_RECOGIDO = "Cliente no llegó";
const PEDIDO_MOTIVO_VENDIDO_APARTE = "Entregado; la venta se capturó aparte en el POS";   // Shopify lo entregó: se libera el apartado sin crear otra venta
const PEDIDO_MOTIVO_CANCELADO_SHOPIFY = "Cancelado en Shopify";
const PEDIDO_HOJA_NO_RECOGIDOS = "Pedidos_No_Recogidos";   // lista de trabajo de la campaña de recuperación
const PEDIDO_CANALES_PRODUCCION = ["Apartado", "Tienda", "Domicilio"];   // reservas que son pedidos (mostrador, bot, Shopify): cuentan en la producción del día
const PEDIDO_CANALES_RECOGER = ["Tienda", "Apartado", "Reservado"];   // canales con recolección en sucursal (Domicilio va por ruta)
const PEDIDO_HORA_REVISION = 21;                           // hora del reporte diario (después de cerrar todas las sucursales)
const PEDIDO_RECORDATORIO_DESDE = 9;                       // el recordatorio de pedidos sin confirmar solo sale entre estas horas
const PEDIDO_RECORDATORIO_HASTA = 20;
const PEDIDO_RECORDATORIO_HORAS_DEFECTO = 2;
const PEDIDO_CLAVE_RECORDATORIO_HORAS = "pedido_recordatorio_horas";
// Tablero de pedidos (21_tablero_pedidos.js): pestaña de solo lectura donde caen todos los pedidos de todas las fuentes.
const TABLERO_HOJA = "Tablero_Pedidos";
const TABLERO_PREFIJO_SUCURSAL = "Pedidos ";   // una pestaña por sucursal: "Pedidos Polanco", "Pedidos Cuajimalpa", "Pedidos Bosques"
const TABLERO_ENCABEZADO = ["Llave", "Estado", "Origen", "Cliente", "Contacto", "Pedido", "Total", "Pago", "Entrega", "Sucursal", "Fecha de entrega", "Hora", "Llegó", "Confirma"];
const TABLERO_VENTANA_FILAS = 4000;            // solo se lee el final de Ventas: ahí están los pedidos abiertos y los recientes
const TABLERO_DIAS_CERRADOS = 7;               // cuántos días siguen visibles los entregados y no recogidos
const TABLERO_MAX_ASIGNACIONES = 15;           // referencias nuevas por corrida (pedidos de Shopify, teléfono o mostrador)
const TABLERO_MINUTOS_ACTUALIZACION = 5;       // 1, 5, 10, 15 o 30 (lo que permite Apps Script)
// Claves de la hoja Configuración (las edita el equipo; si están vacías el bot no inventa nada):
const PEDIDO_CLAVE_TRANSFERENCIA = "pedido_datos_transferencia";   // banco, titular, CLABE e indicaciones de la transferencia
const PEDIDO_CLAVE_POLITICA = "pedido_politica_no_recoger";        // qué pasa si el cliente no pasa por su pedido
// --- Cierre del día, mensajes a clientes y seguimiento (v9, ver 24_seguimiento_clientes.js) ---
const SEGUIMIENTO_HOJA = "Seguimiento_Pedidos";
const SEGUIMIENTO_ENCABEZADO = ["Llave", "Cliente", "Contacto", "Canal", "Id ManyChat", "Sucursal", "Fecha de entrega", "Hora", "Estado", "Entregado el", "Feedback", "Reagenda"];
const MENSAJES_HOJA = "Mensajes_Clientes";                 // cola de mensajes proactivos a clientes: qué, a quién, cuándo y cómo salió
const MENSAJES_ENCABEZADO = ["Programado", "Tipo", "Llave", "Cliente", "Id ManyChat", "Canal", "Mensaje", "Estado", "Resultado", "Enviado el"];
const MENSAJE_TIPO = { REAGENDAR: "reagendar", FEEDBACK: "feedback" };
const REPORTE_NOCHE_HOJA = "Reportes_Noche";               // huella del reporte diario a Rebeca y Yessenia
const ENTREGAS_MANANA_HOJA = "Reportes_Entregas";           // huella del reporte de las 18:00: lo que se recoge mañana en cada tienda
const ENTREGAS_MANANA_HORA = 18;                            // la misma hora de corte para pedir para mañana (BOT_HORA_CORTE_RECOGER)
const ENTREGAS_TIENDAS = ["Polanco", "Cuajimalpa", "Bosques"];   // orden de las secciones del reporte; al final va Domicilio
const ENTREGAS_SECCION_DOMICILIO = "Domicilio";
const PEDIDO_CANAL_RUTA = "Ruta";
const PEDIDO_METODO_POR_DEFINIR = "Por definir";   // forma de pago de un pedido entregado cuando nadie la sabe (se corrige en el POS)   // canal con el que Yessenia captura las ventas de ruta en el POS
const ENTREGAS_CAMPOS = { Polanco: "entregas_polanco", Cuajimalpa: "entregas_cuajimalpa", Bosques: "entregas_bosques", Domicilio: "entregas_domicilio" };   // campos de ManyChat, uno por sección
const ENTREGAS_MAX_SECCION = 900;                           // caracteres por sección en el WhatsApp (el detalle completo está en las pestañas del tablero)
// --- Domicilios de Maite al Excel de pedidos (v9, ver 27_excel_pedidos.js) ---
const EXCEL_PEDIDOS_CLAVE_ID = "excel_pedidos_id";          // Configuración: id del Excel de pedidos ("Pedidos Tarta Vasca (Respuestas)"); vacío = no se anota nada
const EXCEL_PEDIDOS_HOJA = "Respuestas de formulario 1";
const EXCEL_PEDIDOS_COL_NOTA = 58;                         // primera columna vacía y sin título del Excel: ahí va "Maite · TV-… · pago · total"
const EXCEL_PEDIDOS_COL_ESTADO = 59;                       // la siguiente: "✅ ENTREGADO dd/MM HH:mm", "✗ NO RECOGIDO …" o "⏳ POR REVISAR …" (control de apartados cerrados)
const EXCEL_PEDIDOS_REGISTRO = "Excel_Pedidos_Anotados";     // hoja del Sistema: qué pedido se anotó, cuándo y en qué renglón (para no repetirlo)
const BOT_ORIGENES = ["Instagram", "WhatsApp"];             // origen_pedido de los pedidos que toma Maite
const ENTREGAS_CLAVE_UNA_LINEA = "manychat_entregas_una_linea";   // Configuración: "si" cuando el flujo use la plantilla de WhatsApp (sus variables no aceptan saltos de línea)
const FEEDBACK_DIAS = 2;                                    // días después de la entrega en que se pregunta "¿cómo te fue?"
const FEEDBACK_HORA = "10:00";
const PEDIDO_ESTADOS_HOJA = [PEDIDO_ESTADO.CONFIRMADO, PEDIDO_ESTADO.ENTREGADO, PEDIDO_ESTADO.NO_RECOGIDO];   // opciones del menú de Estado en las pestañas por sucursal
const PEDIDO_CLAVE_AUTORIZADOS_HOJA = "pedidos_hoja_autorizados";   // correos que pueden cambiar el Estado desde la hoja (vacío = cualquiera con acceso de edición)
const PEDIDO_CLAVE_GRACIA_DIAS = "pedido_gracia_dias";             // días después de la fecha de entrega antes de darlo por no recogido
// --- Avisos por WhatsApp (v9, ver 20_whatsapp_avisos.js) ---
const WHATSAPP_VERSION_API = "v21.0";
const WHATSAPP_IDIOMA = "es_MX";
const WHATSAPP_PLANTILLA_DEFECTO = "aviso_equipo_tarta_vasca";
const WHATSAPP_CLAVE_NUMEROS = "aviso_whatsapp_numeros";
const WHATSAPP_CLAVE_PLANTILLA = "aviso_whatsapp_plantilla";
const WHATSAPP_CLAVE_RESUMEN = "aviso_whatsapp_resumen";   // números que reciben además el resumen de pendientes (la Dueña)
const PEDIDO_HOJA_AVISOS_HOY = "Avisos_Pedidos_Hoy";      // registro de cada aviso de pedido para hoy: qué se mandó, a quién y si salió
// --- Avisos por ManyChat (v9, ver 22_manychat_avisos.js): la línea quedó conectada por ManyChat, no por la API directa de Meta ---
const MANYCHAT_API_URL = "https://api.manychat.com";
const MANYCHAT_CLAVE_DESTINOS_HOY = "aviso_hoy_manychat";   // quién recibe los pedidos para HOY: "Yessenia:19277176,Rebeca:112452108" (id de contacto en ManyChat)
const MANYCHAT_CLAVE_FLUJO_AVISO = "manychat_flujo_aviso";  // identificador (ns) del flujo de ManyChat que manda la plantilla aviso_pedido_hoy
const MANYCHAT_CAMPO_REFERENCIA = "aviso_referencia";       // campos de usuario de ManyChat que llenan las dos variables de la plantilla
const MANYCHAT_CAMPO_DETALLE = "aviso_detalle";
const MANYCHAT_CAMPOS_PEDIDO_HOY = { donde: "aviso_donde", cliente: "aviso_cliente", pedido: "aviso_pedido", pago: "aviso_pago" };   // aviso de pedido para hoy en formato visual: un dato por campo
const MANYCHAT_CLAVE_FLUJO_REPORTE = "manychat_flujo_reporte";                 // flujo del reporte de la noche a Rebeca y Yessenia
const MANYCHAT_CLAVE_FLUJO_ENTREGAS = "manychat_flujo_entregas_manana";        // flujo del reporte de las 18:00 (entregas de mañana en tienda) a Rebeca y Yessenia
const MANYCHAT_CLAVE_FLUJO_INSTAGRAM = "manychat_flujo_cliente_instagram";    // flujos que mandan un mensaje al cliente según su canal
const MANYCHAT_CLAVE_FLUJO_WHATSAPP = "manychat_flujo_cliente_whatsapp";
const MANYCHAT_CAMPO_MENSAJE = "aviso_detalle";                                // campo de usuario que lleva el texto al cliente (el mismo de los avisos: cada contacto tiene el suyo, así no se crea otro campo en ManyChat)
const MANYCHAT_CLAVE_FLUJO_ALERTA = "manychat_flujo_alerta";                   // flujo de las alertas del bot (queja, mensajero, petición compleja…) a Rebeca y Yessenia
const MANYCHAT_CLAVE_FLUJO_SUGERENCIA = "manychat_flujo_sugerencia";            // flujo del mensaje aparte con el texto sugerido para el cliente (campo bot_sugerencia)
const MANYCHAT_CAMPO_SUGERENCIA = "bot_sugerencia";
const ALERTAS_BOT_HOJA = "Alertas_Bot";                                        // huella de cada alerta del bot, se haya mandado o no
const BOT_ALERTA_REPETIDA_SEGUNDOS = 600;                                      // la misma alerta de la misma conversación no se vuelve a mandar en este lapso
const ALERTA_ESPERA_CANDADO_MS = 10000;                                        // cuánto espera una alerta para anotarse si otra está escribiendo
const BOT_PAUSA_PREFIJO = "bot_pausa_";                                        // propiedad del script por conversación pasada a una persona
const BOT_DISCULPA_MINUTOS = 5;                                                // si pasan tantos minutos desde el traspaso y el cliente vuelve a escribir, Maite se disculpa y se le recuerda al equipo
const PENDIENTES_HOJA = "Conversaciones_Pendientes";                          // un renglón por conversación pasada a una persona; ATENDIDA detiene los recordatorios
const PENDIENTE_ESTADO = { PENDIENTE: "PENDIENTE", ATENDIDA: "ATENDIDA", SIN_ATENDER: "SIN ATENDER" };
const BOT_RECORDATORIO_MINUTOS = 5;                                            // cada cuánto se le recuerda al equipo que un cliente espera (Alex, 1-nov)
const BOT_RECORDATORIOS_MAX = 12;                                              // tope de recordatorios por conversación (con 5 min = 1 hora); después avisa que nadie atendió
const MX_OFFSET_HORAS = 6;                                                     // México sin horario de verano (UTC-6): sirve para leer fechas de la hoja
const BOT_REENGANCHE_HORAS = 1.5;                                              // con la conversación ATENDIDA, si el cliente calla tantas horas y vuelve a escribir, Maite se reincorpora (Alex, 1-nov)
const BOT_PAUSA_HORAS = 12;                                                  // cuánto calla el bot tras pasar a una persona
const MANYCHAT_SUFIJO_PLANTILLA = "_es_plantilla";   // "manychat_flujo_X_es_plantilla" = si: ese flujo es una plantilla de Meta y se le manda todo en una línea
const MANYCHAT_MAX_REPORTE = 900;                                            // el reporte de la noche puede ser más largo que un aviso
const MANYCHAT_MAX_DETALLE = 300;                           // la variable de una plantilla no debe pasar de unos cientos de caracteres
const MANYCHAT_MAX_ALERTA = 700;                                           // las alertas llevan además el texto sugerido para el cliente
const MANYCHAT_CAMPO_CONVERSACION = "bot_conversacion";                        // campo de usuario con la conversación del cliente: lo usa el botón ATENDIDA del flujo de alerta
const WHATSAPP_MAX_DETALLE = 700;     // las variables de una plantilla no pueden pasar de ~1000 caracteres en total
const BOT_DIAS_COMPLETOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const BOT_MESES_NOMBRE = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const BOT_NOMBRE = "Maite";                 // nombre con el que se presenta el bot (Alex y Rebeca, 27-oct-2026); vacío = sin nombre
const BOT_PEDIDOS_ACTIVOS = true;         // encendido en la rama de pruebas: el bot toma pedidos; false = solo consulta
const BOT_HERRAMIENTAS_DE_PEDIDO = ["cotizar_pedido", "crear_pedido", "consultar_pedido"];
const BOT_CONSULTA_MAX_PEDIDOS = 5;          // bot: cuántos pedidos devuelve como máximo una consulta por nombre y teléfono
const BOT_MAX_PIEZAS_POR_PEDIDO = 12;       // más que esto pasa con una persona (eventos, regalos corporativos)
const BOT_USUARIO = "bot-instagram";
const BOT_ROL = "Admin_Ventas";             // sesión interna (nunca sale por el API): permite elegir la sucursal al reservar
const BOT_SUCURSAL_DOMICILIO = SUCURSAL_COCINA;
const BOT_DIAS_ENTREGA_DOMICILIO = [2, 3, 4, 5, 6];   // martes a sábado, como dice la página de la tienda
const BOT_VENTANA_ENTREGA = { abre: "09:00", cierra: "15:00" };
const BOT_URL_AVISO_PRIVACIDAD = "https://latartavasca.com/pages/aviso-de-privacidad"; // aviso integral VF (28-oct), ya publicado en la tienda en línea
const BOT_HORA_CORTE_RECOGER = "18:00";      // bot: para recoger MAÑANA algo que no está listo, el pedido tiene que caer antes de esta hora (Alex, 31-oct: 16:00, subida a 18:00 igual que domicilio; se ajusta aquí). RECOGER_HORA_CORTE es de la tienda en línea y no se toca
const BOT_HORA_CORTE_DOMICILIO = "18:00";   // pedidos a domicilio después de esta hora suman un día
const BOT_PAGOS_RECOGER = ["efectivo", "transferencia", "tarjeta"];   // la tarjeta solo se paga en sucursal, al recoger
const BOT_PAGOS_DOMICILIO = ["efectivo", "transferencia"];
const BOT_MARGEN_HORA_RECOGER_MIN = 60;  // para recoger hoy, la hora elegida tiene que ser al menos esto después de ahora
const BOT_MARGEN_MISMO_DIA_MIN = 60;       // para recoger hoy, tiene que faltar al menos esto para cerrar
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
const BOT_DUPLICADO_SEGUNDOS = 20;   // el mismo mensaje de la misma conversación dentro de este lapso se procesa una sola vez
const BOT_RESCATE_SEGUNDOS = 16;            // si el turno tarda más, ManyChat ya dejó de esperar (~8 s + sondeo de 7 s): el sistema le manda la respuesta al cliente por su cuenta
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

