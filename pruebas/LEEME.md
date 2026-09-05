# Ambiente de pruebas — NO ES EL SISTEMA REAL

Copia del sitio apuntada a la hoja de pruebas.

- Hoja: TARTA VASCA — PRUEBAS 4-sep-2026 (cuenta personal)
  https://docs.google.com/spreadsheets/d/1VqutRQfM9zQVdah3efKTSs4ekn07JGGjsAF8c_N5MmU
- Sistema (Apps Script) de esa hoja: `1NrEAmxAYSxi7U0kXD4qXfpeKtUttVo0W7h_Pn28uSvuZfiHogKLSbzu2`
  Implementacion que usa este sitio: `AKfycbxHgJK4fWgTeDopx0nzYAiWVgqGITD2dktUQrYLLJIAldtB4GHaHvM7P74s7LLEjJlW`
- Unica diferencia contra el sitio real: la linea del `API_URL` en `app.js`.
- La copia del sistema no tiene ningun aviso programado (0 activadores).
- Los correos de caja de esta copia van a alexanderg@grupoautomundo.com,
  nunca a la duena.
- Se reconoce en pantalla porque el negocio se llama "TARTA VASCA — PRUEBAS".

Creado el 4-sep-2026 para probar el pago dividido en un ticket.

## Pruebas del backend

`backend-solo-pruebas/95_prueba_pago_dividido.js` vive UNICAMENTE en el sistema de
pruebas (nunca en `backend/`, que es produccion). Registra ventas contra la hoja de
pruebas, revisa lo que quedo escrito y las cancela al final. Se corre desde el editor
de Apps Script del script de pruebas: abrir el archivo, elegir `pruebaPagoDividido`
y Ejecutar. Debe terminar en "TODO OK".

## Como actualizarlo

1. Frontend: copiar los archivos del sitio real a `pruebas/` y cambiar el
   `API_URL` por el de arriba. Se sirve en `grinbergalex.github.io/tarta-vasca/pruebas/`.
2. Backend: `clasp push` contra el scriptId de arriba (no contra el de
   `backend/.clasp.json`, que es produccion), luego `clasp create-version` y
   `clasp update-deployment <deploymentId> --versionNumber <n>` para que la
   implementacion siga en la MISMA URL.
