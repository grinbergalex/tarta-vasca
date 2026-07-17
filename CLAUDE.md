# Tarta Vasca — POS/ERP

Sistema de punto de venta e inventario para una pastelería con 2 sucursales
(Cuajimalpa y Nápoles): ventas, producción, stock, recetas/costos, rutas de
reparto, reportes financieros, usuarios con roles.

## Arquitectura

```
index.html  ──fetch──►  Apps Script web app (backend/)  ──►  Google Sheet (= base de datos)
```

- **Frontend**: `index.html` — un solo archivo, vanilla JS, sin build.
  Servido por **GitHub Pages desde `main`**: ⚠️ **cada push a `main` es un
  deploy inmediato a producción** (https://grinbergalex.github.io/tarta-vasca/).
- **Backend**: `backend/*.js` — Google Apps Script vinculado al Sheet.
  Se sincroniza con `clasp` (login: maichomper@gmail.com).
- **Base de datos**: el Google Sheet. Las pestañas (Ventas, Inventario,
  Usuarios, Sesiones_Activas, Inv_Ledger, …) son **datos de producción**.
  La pestaña Utilidades es un reporte generado — se reconstruye sola.

## Cómo desplegar el backend

1. Editar en `backend/` (nunca directo en el editor online: git es la fuente
   de verdad; el editor online solo para correr funciones).
2. `cd backend && clasp push`
3. En el editor de Apps Script: **Implementar → Administrar implementaciones →
   ✏️ sobre la implementación existente → Versión: "Nueva versión" → Implementar**.
   ⚠️ NUNCA "Nueva implementación": eso genera otra URL y el frontend
   (`API_URL` en index.html, línea ~1985) quedaría apuntando a la vieja.

`clasp push` solo sube el código; producción no cambia hasta el paso 3.

## Reglas duras

- **No reintroducir `recalcularUtilidades()` en rutas de escritura.** Se movió
  a un trigger cada 10 min (v6.5) porque reconstruía todo el reporte dentro de
  cada venta sosteniendo el lock global — causaba lentitud y errores de
  "Sistema ocupado". Las escrituras solo llaman `_utilMarcarDirty()`.
- Toda acción nueva del API: agregarla al `switch` de `despachar()` en
  `Código.js` **y**, si es de solo lectura, a la lista `LECTURA` en
  `index.html` (las lecturas van por GET, las escrituras por POST).
- Toda mutación de inventario pasa por InvCore y queda en `Inv_Ledger`
  (ver encabezado de `Código.js`). `auditarConsistencia()` debe dar verde.
- Los textos de UI y comentarios van en español.

## Triggers instalados (una sola vez, desde el editor)

| Función | Frecuencia | Instalador |
|---|---|---|
| `auditoriaDiaria` | diario 7am | `instalarAuditoriaDiaria()` |
| `respaldoDiario` | diario 2am | (ver Código.js) |
| `recalcularUtilidadesSiDirty` | cada 10 min | `instalarTriggerUtilidades()` |

Los triggers corren como la cuenta que ejecutó el instalador.

## Legacy / pendientes

- `cargaInv 17.js`, `ventasmasivoCuaji17.js`, `limpiar apartados.js`:
  scripts de migración de una sola vez — no llamarlos desde el API.
- La "carga masiva con IA" pasa por la acción `iaProcesar` del backend
  (v6.5d), que usa la API key guardada en Propiedades del script
  (`ANTHROPIC_API_KEY`). **Nunca** poner una API key en index.html —
  GitHub Pages es público.
