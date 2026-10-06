# Cómo sacar la llave de Shopify para el sincronizador

La llave son dos datos: **Client ID** y **Client secret**. El secret es como una
contraseña: **no se manda por chat ni correo**, se pega directo en Google.

## A. Crear la app privada (en Shopify)

1. Entra a **https://dev.shopify.com/dashboard** con la cuenta que administra la
   tienda de La Tarta Vasca (si pide organización, la de la tienda).
2. **Create app** / **Crear app** → nombre: `Sincronizador hoja`.
3. En la versión de la app, en **Access scopes / Permisos**, marca:
   - `read_products`, `write_products`
   - `read_publications`, `write_publications`
   - `read_orders` (para que las ventas de la página entren al sistema)
4. **Release / Publicar** esa versión.
5. **Install / Instalar** la app en la tienda **La Tarta Vasca** y acepta los permisos.
6. En **Settings / Configuración** de la app copia el **Client ID** y el **Client secret**.

> Si en el paso 1 no aparece la tienda, la dueña de la cuenta (Rebeca) tiene que
> hacerlo ella o agregarte a su organización.

## B. Guardar la llave (en Google)

1. Abre el sincronizador con tu cuenta **personal** de Gmail (la dueña del script):
   https://script.google.com/d/1roF0IIHXZIrJB6gPv3ZfC8Nmny__DDZRXjuj98B_EViyRd704AlwHDck/edit
2. A la izquierda, el engrane **⚙️ Configuración del proyecto**.
3. Hasta abajo, **Propiedades de la secuencia de comandos** → **Agregar propiedad**:
   - `SHOPIFY_CLIENT_ID` → pega el Client ID
   - `SHOPIFY_CLIENT_SECRET` → pega el Client secret
4. **Guardar**.

## C. Probar (todavía sin cambiar nada)

1. Vuelve al editor (icono `< >`), elige **revisarDiferencias** y **▷ Ejecutar**.
   Pedirá permiso otra vez (ahora también para "disparadores"): **Permitir**.
2. Te llega el correo. Con la llave ya debe decir que Manchego está
   **"listo para publicar"** y los 10 sabores **"esperan foto"**.

## D. Encenderlo (solo cuando la prueba C salga bien)

1. En **Propiedades**: agrega `MODO` → `APLICAR`.
2. En el editor elige **instalarDisparadores** → **▷ Ejecutar** (una vez; vuelve a correrlo si cambian los minutos).

Desde ese momento, cada 15 minutos la página se iguala a la hoja. Si algo raro
pasa (p. ej. la hoja se lee casi vacía), el **freno de seguridad** no cambia nada
y te manda un correo 🛑.

**Para apagarlo:** cambia `MODO` a `REVISAR`, o ejecuta **desinstalarDisparadores**.

## E. Preparar el sistema de sucursales para las ventas de la página

Los pedidos de Shopify van a entrar al sistema como **reservas pagadas** (método
"Shopify"). El día de la entrega se convierten en venta desde **Ventas → Apartados**,
igual que cualquier apartado.

1. **Usuario "shopify"** (lo hace la dueña en la app de sucursales):
   **⚙️ Admin → Usuarios** → nuevo usuario `shopify`, rol **Vendedor**, sucursal
   **Cuajimalpa**, con una contraseña que tú elijas.
   Luego, en el sincronizador (**⚙️ Configuración del proyecto → Propiedades**):
   - `POS_USUARIO` → `shopify`
   - `POS_PASSWORD` → la contraseña que elegiste (la pegas tú; no se manda por chat)
2. **Comisión 3% de Shopify**: la pantalla de Comisiones de la app no trae
   "Shopify" en su lista, así que se agrega directo en la hoja
   **Tarta Vasca — Sistema → pestaña Comisiones**, un renglón nuevo al final:
   - Columna A: `Shopify`
   - Columna B: `-0.03`
   - Columna C: la fecha de hoy

> Detalle conocido: al convertir el apartado en venta, la app pone el canal
> "Mostrador". El método "Shopify" sí se conserva. Si se quiere conservar
> "Domicilio", es un cambio pequeño en la app de sucursales (pendiente).
