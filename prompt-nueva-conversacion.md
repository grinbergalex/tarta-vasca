# Prompt para la nueva conversación (1-nov-2026)

Pega esto al abrir la conversación nueva, parado en la carpeta `tarta-vasca`, rama `feat/bot-instagram-cerebro`:

---

Lee `CLAUDE.md` (sección v9, en especial "Cómo opera la tienda hoy") y `recomendaciones-para-manana.md`.

Contexto: Maite es el bot de Instagram de La Tarta Vasca (Claude + ManyChat + Apps Script). Todo está en el proyecto de pruebas y en commits locales de la rama `feat/bot-instagram-cerebro`; producción (@128) y `main` no se han tocado. Última versión en pruebas: @95 (aviso de privacidad).

Objetivo de hoy: salir en vivo en Instagram. Empieza por:
1. Revisar en Meta (WhatsApp Manager, cuenta La Tarta Vasca) si aprobaron las 4 plantillas que envié a revisión el 1-nov: `alerta_bot_equipo`, `reagendar_pedido`, `feedback_pedido`, `reporte_apartados_noche`. Si las aprobaron, cambia los flujos de ManyChat a las plantillas; si rechazaron o recategorizaron alguna, dímelo.
2. Seguir los pasos de salida en vivo de `plan-de-pruebas-salida-en-vivo.md` y de la sección de publicación de `recomendaciones-para-manana.md`.

Reglas: no hagas push ni merge a `main`, ni publiques a producción, sin que yo diga "publícalo". Las claves las pongo yo en Propiedades del script. No envíes correos (solo borradores). Antes de cualquier `clasp push` a producción, baja la versión viva y compárala con el repo.

Pendientes míos que aún no cierro: datos de la transferencia (CLABE), cobertura de envío de Lomas del Chamizal y Granjas Navidad, y revisar el feedback por Instagram (solo funciona dentro de 24 h) al terminar de implementar. Maite NO revela que es IA salvo que le pregunten.

Ideas para después: que Maite reconozca al cliente (histórico y "llevabas X tiempo sin comprar"); responder comentarios en fotos cuando estemos en vivo.
