# T-72 · Prospecto con ubicación y geocodificación en el servidor (spec)

**Fecha:** 2026-10-19 · **Estado:** diseño aprobado en diálogo con Mario; falta su revisión de este texto.
**Issue:** #117. Es la pieza 4 del rediseño de la app (spec de T-37, "El rediseño completo, en piezas").
**Depende de:** T-40 ✅, T-75 ✅, T-39 ✅.
**Vault:** [[T-40 Registro de Prospectos]], [[Cartera de Clientes]], [[Cliente]], [[Integraciones]], [[App Tablet]].

## Para qué

La oficina necesita que cada prospecto que llega de la tablet tenga **coordenada**. Sirve para rutearlo (T-41) y para que la ficha abra Maps exacto.

Lo que ya existe:
- El alta de prospecto toma el GPS, sin bloquear.
- La ficha abre Maps por coordenada, y por domicilio cuando no hay coordenada.
- El portal tiene campos manuales de latitud y longitud.

Lo que falta:
- Un prospecto sin señal llega sin nada útil. No hay campo de dirección en el alta.
- Nadie convierte una dirección en coordenada.

## Respuestas de Mario (2026-10-19)

1. **La clave de Google la saca él después.** Todo se construye para leer la clave de una variable del servidor. Sin ella, nada falla: los prospectos quedan sin coordenada y el portal avisa que falta configurarla.
2. **El reintento del portal aplica a cualquier cliente o prospecto**, no solo a prospectos. Así toda la cartera puede quedar lista para mapa y ruteo.
3. **En el alta de la app, la dirección es obligatoria si no hay GPS.** Es la misma regla que la visita de T-39.

## Decisiones

**D1 · Dirección en el alta de prospecto (tablet).**
- El formulario de "Prospectos" gana el campo **"Dirección del negocio"** (hasta 300 caracteres).
- Es obligatorio cuando no hay coordenada válida: no se tomó, el permiso se negó, se acabó el tiempo o la coordenada está fuera de rango o no es finita. Ese último caso cuenta como "sin GPS", igual que en T-39 D7.
- Con GPS es opcional.
- La regla vive en una función pura `validarAltaProspecto` (en `src/estado/`, con pruebas). La pantalla solo pinta lo que esa función devuelve.
- La dirección se guarda en la fila local de `prospecto` (columna nueva `domicilio`, migración local **014**). También va al espejo local de `cliente.domicilio` (T-75 D1), así que la ficha la muestra y abre Maps con ella mientras no haya coordenada.

**D2 · `domicilio` en la operación `prospecto` (contrato aditivo).**
- `DatosProspecto` gana `domicilio?: string | null`: se recorta, un texto vacío cuenta como `null` y el máximo es de 300 caracteres. Si se pasa del máximo, el rechazo es `datos-invalidos` con un motivo que lo diga.
- Una tablet vieja no lo manda y no pasa nada. **`CONTRATO_ACTUAL` sigue en 1.**
- `crearProspecto` guarda `cliente.domicilio`. Si llegan `lat`/`lng`, guarda también `ubicacion_origen = 'gps'`.
- Se tocan juntos los dos `contrato.ts` y `docs/contrato-sincronizacion.md` §6.

**D3 · Columna `cliente.ubicacion_origen` (migración del servidor).**
- Es `text`, admite nulo, y su check acepta `('gps', 'geocodificada', 'manual')`. Dice de dónde salió la coordenada actual. Es nula cuando no hay coordenada, y un check exige que sea nula **si y solo si** `lat` es nula.
- **Backfill:** a los clientes que ya tienen coordenada se les pone `'manual'`. Antes de este ticket las coordenadas solo se capturaban a mano en el portal o por GPS en un prospecto. Distinguirlas no vale la pena, y `'manual'` es la etiqueta conservadora.
- **Portal:** un `lat`/`lng` capturado a mano en el formulario guarda `'manual'`. Borrar la coordenada pone `null`.
- **Pull:** `ClientePull` gana `ubicacion_origen`, de forma aditiva. La tablet la guarda, pero en este ticket no la muestra.

**D4 · Geocodificador (backend, módulo nuevo `modules/integraciones/geocodificacion/`).**
- La interfaz es `Geocodificador.geocodificar(direccion: string): Promise<ResultadoGeocodificacion>`, donde el resultado es uno de:
  - `{ estado: 'ok', lat, lng }`
  - `{ estado: 'sin-configurar' }`: no hay `GOOGLE_MAPS_API_KEY`
  - `{ estado: 'imprecisa' }`: Google solo encontró algo aproximado
  - `{ estado: 'no-encontrada' }`: `ZERO_RESULTS`
  - `{ estado: 'error', detalle }`: red, cuota, `REQUEST_DENIED`, 5xx o tiempo agotado
- La implementación de Google llama a `https://maps.googleapis.com/maps/api/geocode/json` con:
  - `address = <domicilio>`, `region = mx`, `components = country:MX`, `language = es`
  - un **tiempo máximo de 5 s** (`AbortController`)
  - `fetch` nativo de Node, sin dependencias nuevas
- **Precisión:** se acepta el primer resultado solo si `geometry.location_type` es `ROOFTOP`, `RANGE_INTERPOLATED` o `GEOMETRIC_CENTER`. Si es `APPROXIMATE` (nivel colonia o ciudad), devuelve `imprecisa`. Una coordenada mala es peor que ninguna para rutear.
- **La clave sale del entorno y nunca aparece en logs ni en respuestas.** Al registrar un error se loguea el `status` de Google, nunca la URL completa.
- **Inyección:** en las pruebas se inyecta un falso. Las unitarias prueban el *parser* de la respuesta de Google con JSON de ejemplo. Ninguna prueba ni e2e llama a Google.
- `.env.example` documenta `GOOGLE_MAPS_API_KEY`, que es opcional.

**D5 · Cuándo se geocodifica (backend).**
- **Prospecto que llega de la tablet** con `domicilio` y sin coordenada:
  - **Después del commit** de la operación, `SincronizacionService` dispara `UbicacionClientesService.geocodificarEnSegundoPlano(clienteId)` sin esperarla. El push responde sin esperar a Google.
  - El intento lee el cliente. Si todavía no tiene coordenada y tiene domicilio, geocodifica.
  - Con `ok`, hace un `update cliente set lat, lng, ubicacion_origen = 'geocodificada', updated_at = now() where id = ? and lat is null`. La condición `lat is null` evita pisar una coordenada que la oficina capturó mientras tanto. Tocar `updated_at` es lo que hace que la coordenada baje sola en el siguiente pull.
  - Cualquier otro resultado solo se loguea (`warn`, sin la clave). No hay reintentos automáticos, ni cola, ni cron. Si el proceso se reinicia a medio intento, se reintenta desde el portal.
- **Portal, guardar cliente** (alta o edición):
  - Si después de guardar el cliente tiene domicilio, no tiene coordenada, y el domicilio cambió (o es un alta), el servidor intenta geocodificar **después** de la transacción del guardado, con el mismo `update … where lat is null`.
  - La respuesta del guardado no espera a Google. El resultado se ve al recargar la ficha.
- **Portal, botón "Ubicar con la dirección"**: llama a `POST /clientes/:id/ubicar`, que **sí espera** (como mucho 5 s) y responde según el resultado:
  - `200 { lat, lng, ubicacionOrigen: 'geocodificada' }`;
  - `409` con un motivo en español, para los demás casos:

    | Caso | Motivo |
    |---|---|
    | El cliente no tiene domicilio | "El cliente no tiene domicilio." |
    | Ya tiene coordenada | "Ya tiene ubicación; bórrala primero para volver a ubicarlo." |
    | `imprecisa` | "Google solo encontró la colonia o la ciudad: agrega calle y número." |
    | `no-encontrada` | "Google no encontró esa dirección." |
    | `sin-configurar` | "Falta configurar la clave de Google en el servidor." |

  - `502` con "Google no respondió; intenta en un momento." cuando el resultado es `error`.
  - Permiso: **`cliente.gestionar`**, el mismo con el que se edita la ficha. El alcance es la sucursal del usuario, con el patrón de `clientes.controller.ts`; fuera de alcance responde 404.

**D6 · Portal: la ficha del cliente.**
- Junto a los campos de latitud y longitud se muestra de dónde salió la ubicación: "GPS de la tablet", "Ubicada por Google", "Capturada a mano" o "Sin ubicación".
- Si el cliente no tiene coordenada y sí tiene domicilio, aparece el botón **"Ubicar con la dirección"**. Al terminar, pinta la coordenada o el motivo del 409/502.
- Pruebas de pantalla con el patrón de T-65.

**D7 · ADR corto: `ADR-0014 Geocodificación de direcciones` (vault).**
- **Proveedor:** Google Geocoding API.
- **Costo:** unos 5 USD por cada 1 000 consultas, con 200 USD de crédito mensual. El volumen esperado son cientos de consultas al mes, así que el costo es de cero en la práctica.
- **Seguridad:** la clave va solo en el servidor, restringida a la Geocoding API.
- **Fallos:** nunca bloquean y se reintentan a mano. Sin cola.
- **Precisión mínima:** se descartan los resultados `APPROXIMATE`.
- **Alternativa descartada:** Nominatim/OSM, que es gratis pero tiene menos precisión en México y prohíbe el uso intensivo.

## Fuera de alcance

- Geocodificar en bloque la cartera existente. Se hace cliente por cliente con el botón; un lote sería otro ticket si hace falta.
- Geocodificación inversa (de coordenada a dirección).
- El mapa de clientes y el ruteo (T-41).
- Mostrar `ubicacion_origen` en la tablet.

## Errores y casos límite

- **Sin clave en el servidor:** el intento en segundo plano devuelve `sin-configurar`, lo loguea una sola vez por arranque como `warn` y no hace nada más. El botón responde 409 con su mensaje.
- **La oficina captura una coordenada a mano mientras Google responde:** el `where lat is null` la protege.
- **Prospecto convertido antes de que Google responda:** no importa, porque el intento solo mira `lat` y `domicilio`.
- **Alta rechazada** (por ejemplo `tipo-negocio-inexistente`): no hay commit, así que no hay intento. Se intentará cuando el alta entre.
- **Reenvío `duplicada`:** no dispara otro intento.

## Pruebas

- **Backend unit:**
  - el parser de respuestas de Google: ok con cada `location_type`, `APPROXIMATE`, `ZERO_RESULTS`, `REQUEST_DENIED`, `OVER_QUERY_LIMIT`, JSON roto;
  - el tiempo agotado y `sin-configurar`;
  - la validación de `domicilio` en `datos-prospecto`;
  - `UbicacionClientesService` con un geocodificador falso: no pisa una coordenada existente y toca `updated_at`.
- **Backend e2e** (con el geocodificador falso inyectado):
  - un alta de prospecto con domicilio y sin GPS termina con `lat`/`lng` y `'geocodificada'`, y el pull siguiente la baja;
  - con GPS no se llama al geocodificador;
  - `POST /clientes/:id/ubicar` en cada caso (200, 409 por caso, 502, 403 sin permiso, 404 de otra sucursal);
  - editar el domicilio en el portal dispara el intento;
  - una coordenada manual queda como `'manual'`.
- **pgTAP:** el check de `ubicacion_origen` y el backfill.
- **Tablet (Jest):** `validarAltaProspecto`, la migración 014 y que el alta guarde `domicilio` en `prospecto` y en el espejo de `cliente`.
- **Portal:** la pantalla con la etiqueta de origen y el botón, en éxito y en cada error.
- **Aceptación en el emulador:**
  - sin GPS, el alta exige dirección;
  - con la dirección escrita sube, y con un geocodificador falso en local se comprueba que la coordenada baja en el pull y la ficha abre Maps por coordenada;
  - la prueba contra Google real queda pendiente hasta que Mario tenga la clave.

## Memoria y documentos

- `CLAUDE.md` gana un bloque de T-72: la variable `GOOGLE_MAPS_API_KEY`, la regla de "después del commit, sin bloquear" y `where lat is null`.
- `docs/contrato-sincronizacion.md` documenta `domicilio` en el prospecto y `ubicacion_origen` en el pull.
- `.env.example` documenta la variable.
- En el vault, al terminar: el ADR-0014, [[Integraciones]], [[T-40 Registro de Prospectos]], [[Cliente]], Estado del proyecto y la bitácora.
