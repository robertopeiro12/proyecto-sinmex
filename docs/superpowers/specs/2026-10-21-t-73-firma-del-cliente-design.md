# T-73 · Firma del cliente en la nota de venta — diseño

**Ticket:** #118 · **Pieza 7 del rediseño** (spec T-37, 2026-10-12) · **Depende de:** T-16, T-39 (canal de fotos generalizado), T-17 (edición en el portal)

## Objetivo

Que el cliente firme en la tablet cada venta, para que el negocio tenga evidencia digital además de la nota de papel. La firma sube por el canal de fotos y el portal la muestra en el detalle de la venta.

**No cambia:** las notas de papel se siguen usando (vault [[App Tablet]] §2); la firma digital las **complementa**. La tablet ya no edita ni anula ventas (D3 de T-16), así que el "bloqueo" del ticket ya existe: la firma es la evidencia de esa venta cerrada. El portal sigue pudiendo editarla (T-17).

## Decisiones de producto

**D1 · Firma obligatoria en toda venta, sin poder omitirla.** Elegido por Mario. Contado y crédito por igual. Sin firma, "Grabar venta" no se habilita.

**D2 · Nombre de quien firma: opcional.** Elegido por Mario. Texto libre, recortado, hasta 80 caracteres; vacío se guarda como `null`.

**D3 · Se firma en el paso de revisión, antes de grabar.** Como la firma es obligatoria, se captura antes de grabar y se guarda en la misma transacción que la venta: no puede existir una venta grabada sin firma por un cierre de la app a medio camino. *(agente)*

**D4 · Volver a captura borra la firma.** El cliente firmó un total; si cambian las cantidades, firma otra vez. *(agente)*

**D5 · Dibujo con `react-native-svg` + `PanResponder`; la imagen sube como JPG por el canal de fotos.** Elegido por Mario (opción A). Una dependencia nativa nueva (`react-native-svg`, la que fija `expo install` para SDK 57): **hace falta un APK nuevo**. El servidor sigue aceptando solo JPG (`validarFoto`): la tablet convierte el PNG de `toDataURL` a JPG con `expo-image-manipulator`, que ya trae.

**D6 · Respaldo si `toDataURL` no funciona.** La Tarea 1 del plan lo comprueba en el emulador antes de construir nada más. Si falla, se para y se replantea con la opción B (trazos como JSON dentro de la operación de venta); no se improvisa.

**Enmiendas de implementación (2026-10-21, aprobadas por el controlador).**

- El `origen` de las ventas del portal es `'portal'` (no `'oficina'`); es el valor real del código.
- La imagen de la firma de una venta de otra sucursal responde **403**, con el mismo alcance que el detalle de la venta.
- Las columnas de firma de `venta_nota` son de `FirmasVentaService`/`FirmasVentaRepository` (`ventas-cobranza`), no de métodos sueltos de `VentasService`.
- `editada` también pasa a `true` al asignar una factura o marcar una cuenta incobrable, no solo al editar la nota.
- El portal carga la imagen con la sesión (`fetch` + URL `blob:`), no con un `<img src>` directo.
- Las fuentes de fotos de la tablet ganan un `fallaDefinitiva` opcional: solo las firmas tratan el 404 como definitivo; las demás fuentes lo siguen reintentando.

## Tablet

### Componente de firma (`src/ui/recuadro-firma.tsx`)

- Recuadro de fondo **blanco** (también en tema oscuro: la firma es un papel), trazo negro de 3 px, alto fijo ~220 dp, ancho de la tarjeta.
- `PanResponder` acumula trazos (`Punto[][]`); cada trazo se dibuja como `<Path d=…>`. Un toque sin arrastre deja un punto (trazo de un solo punto, dibujado como círculo pequeño).
- El fondo blanco es un `<Rect>` **dentro** del `Svg`, para que el PNG exportado no salga transparente (un PNG transparente pasa a JPG negro).
- Botón "Borrar firma" (tono `neutra`) vacía los trazos.
- Expone por `ref`: `exportarPng(): Promise<string>` (base64, vía `svgRef.toDataURL`).
- La lógica pura vive aparte y se prueba sin pantalla: `src/estado/firma.ts` con
  - `trazoAPath(puntos: Punto[]): string` — el `d` del path (un punto → arco mínimo);
  - `hayFirma(trazos: Punto[][]): boolean` — al menos un punto;
  - `normalizarNombreFirma(texto: string): string | null` — recorta, vacío → `null`, más de 80 → error;
  - `puedeGrabarVenta(...)` — las condiciones previas que ya hay **y** `hayFirma`.

### Pantalla de venta (`app/(jornada)/operacion/[clienteId]/venta.tsx`)

- **Revisión:** debajo del resumen, tarjeta "Firma del cliente" con el recuadro, "Borrar firma" y el campo "Nombre de quien firma (opcional)". Texto de ayuda: "Pide al cliente que firme con el dedo." "Grabar venta" deshabilitado mientras `!hayFirma`.
- **Volver a captura** (botón que ya existe): vacía trazos y nombre (D4).
- **Al grabar**, con la guardia de doble toque que ya existe:
  1. `exportarPng()` → base64.
  2. Escribir el PNG en caché, convertir a JPG con `expo-image-manipulator` (calidad 0.8, ancho máximo 1000 px) y mover el resultado a `documentDirectory/firmas/firma-<idVenta>.jpg`. El id de la venta se genera **antes** (hoy lo genera `registrar()`; pasa a aceptarlo como parámetro opcional o a exponer `generarId`).
  3. `datos.ventas.registrar({ …, firma: { uri, nombre } })` — la misma transacción que hoy graba venta, líneas, regalos y folio guarda `firma_local` y `firma_nombre`.
  4. Si falla 1 o 2: no se llama a `registrar`, no se quema folio, aviso "No se pudo guardar la firma. Intenta de nuevo." y la pantalla sigue en revisión con la firma intacta. Si falla 3 después de escribir el archivo, el archivo queda huérfano (inofensivo; se sobrescribe en el reintento porque el id se conserva mientras la pantalla siga abierta).
- **Pantalla "Venta grabada":** agrega "Firmada por {nombre}" o "Firmada" si no hay nombre.

### Datos locales

- **Migración 016** (`016-firma-venta.ts`): agrega a `venta` `firma_local text`, `firma_nombre text`, `firma_subida_en text`, `firma_error text` y `firma_descartada integer not null default 0 check (firma_descartada in (0, 1))` — el mismo esquema derivado que la foto de visita (013) y de gasto (015), con prefijo `firma_`; ninguna toca `sync_estado`. Índice `idx_venta_firma_pendiente on venta (sync_estado) where firma_local is not null and firma_subida_en is null and firma_descartada = 0`.
- `RepositorioVentas`:
  - `registrar()` acepta `firma: { uri: string; nombre: string | null }` **obligatoria** en el tipo (D1). Las pruebas existentes de `registrar` se actualizan.
  - métodos de la cola de foto como los de `RepositorioGastos`: `firmasPendientes()`, `marcarFirmaSubida`, `anotarErrorFirma`, `descartarFirma`. Elegible: `firma_local is not null and firma_subida_en is null and firma_descartada = 0` **y** la operación de la venta ya aceptada (mismo criterio que visita/gasto).
- `src/sincronizacion/fuente-fotos.ts`: nueva `FuenteFotos` de tipo `venta` (`fuenteFirmasVentas`), sumada a la lista después de gastos.
- `fuente-ventas.ts`: el cuerpo de la operación agrega `firma: { nombre }` cuando la venta tiene `firma_local` (siempre, en ventas nuevas).
- **Ficha del cliente, "Ventas de hoy":** junto al estado de sincronización, "firma por subir" mientras `firma_subida_en` sea null.

## Contrato de sincronización

- Operación `venta`: campo **opcional** `firma: { nombre: string | null }`. Aditivo: `CONTRATO_ACTUAL` sigue en **1**. `contrato.ts` se actualiza en backend y tablet a la vez, y `docs/contrato-sincronizacion.md` en el mismo commit.
- Presencia de `firma` = la venta espera una imagen. Ausente = app vieja (venta sin firma).
- `firma.nombre`: string recortado de 1 a 80 caracteres o `null`; otro tipo o más largo → la operación se rechaza con `datos-invalidos` desde `normalizarDatosVenta`, como cualquier otro campo mal formado de la venta.
- `POST /sync/foto/:clave` acepta ahora la clave de una operación `venta`.

## Servidor

- **Migración** `supabase/migrations/20261021120000_venta_firma.sql` (timestamp único, regla de CLAUDE.md):
  ```sql
  alter table venta_nota
    add column firma_esperada boolean not null default false,
    add column firma_nombre text check (firma_nombre is null or char_length(firma_nombre) between 1 and 80),
    add column firma_archivo text,
    add column firma_subida_en timestamptz,
    add constraint ck_venta_firma_archivo check (firma_archivo is null or firma_esperada);
  ```
  pgTAP `99_venta_firma_test.sql`: columnas, default, los dos checks.
- **Normalización** (`datos-venta.ts`): `VentaNormalizada.firma: { nombre: string | null } | null`.
- **Proyección** (`registrarVenta`): guarda `firma_esperada = firma !== null` y `firma_nombre`. Las ventas del portal (`origen = 'portal'`) siguen con `firma_esperada = false`.
- **Canal de fotos** (`foto.service.ts`): rama `mia.tipo === 'venta'`:
  - `entidadTabla !== 'venta_nota' || entidadId === null` → 409 (no proyectada; la tablet reintenta).
  - `validarFoto(cuerpo)`; la venta debe existir y no estar eliminada → si no, 404.
  - `firma_esperada = false` → 409 "Esa venta no espera firma." (no debería pasar; protege de una tablet que mande foto a una venta vieja).
  - Archivo `venta-<id>-firma.jpg` (agregar el dominio a `nombreArchivoFoto`), escrito **antes** de anotar la columna; reenviar escribe el mismo nombre.
  - El dueño de las columnas de `venta_nota` es `ventas-cobranza`: `VentasService` (o el repositorio que ya escribe `venta_nota`) expone `existeConFirmaEsperada(id)` y `anotarFirma(id, archivo, subidaEn)`, como `GastosService`.
  - Los mensajes de 404/409 genéricos del servicio pasan a nombrar "la venta" junto con prospecto, visita y gasto.
- **Detalle de venta** (`GET /ventas/:id`, `ventas-consulta.service.ts`): `VentaDetalle.firma: { esperada: boolean; nombre: string | null; subidaEn: string | null }` y `VentaDetalle.editada: boolean`.
- **Imagen:** `GET /ventas/:id/firma` — mismo alcance que `GET /ventas/:id` (la consulta de detalle ya valida sucursal); 404 si no hay archivo; `image/jpeg`, `Cache-Control: private, no-store`, como `/gastos/:id/foto`.

## Portal

En `components/ventas/detalle-venta.tsx`, bloque "Firma del cliente":

| Estado | Se muestra |
|---|---|
| `subidaEn` presente | La imagen (`<img>` desde `/ventas/:id/firma`, alto máx. 160 px, fondo blanco, borde), "Firmó: {nombre}" si hay nombre, "Firmada en la tablet". |
| `esperada` y sin `subidaEn` | "Firma pendiente de subir: llega cuando el vendedor sincronice." |
| no `esperada` | "Sin firma (venta capturada en oficina o anterior a la firma en tablet)." |

Si hay firma **y** `actualizado_por_usuario_id` no es null, aviso debajo: *"Esta nota se editó en el portal después de firmarse; la firma corresponde a la versión original."* `VentaDetalle` no expone hoy la edición: se agrega `editada: boolean` (`actualizado_por_usuario_id is not null`) en `ventas-consulta.service.ts`.

## Fuera de alcance

- Volver a pedir la firma tras una edición en el portal.
- Firma en cobranza, visita o gasto.
- Bajar la firma a la tablet.
- Mostrar la firma en el reporte de ventas o en exportaciones.
- Imprimir o enviar la nota firmada al cliente.

## Review Focus

1. **Tema oscuro:** el recuadro sigue blanco y el JPG sale con fondo blanco, nunca negro.
2. **Volver a captura y regresar:** la firma anterior no sobrevive; Grabar vuelve a quedar deshabilitado.
3. **Doble toque en Grabar mientras se exporta la firma:** una sola venta, un solo folio.
4. **Foto de firma antes de que la venta esté proyectada** (push y fotos en la misma sincronización, venta rechazada después): 409 y reintento, nunca archivo sin venta.
5. **Venta eliminada en el portal antes de que suba su firma:** 404 → la tablet la descarta, no reintenta para siempre.

## Pruebas

- **Tablet:** `firma.spec.ts` (path, `hayFirma`, nombre, `puedeGrabarVenta`), migración 016, `ventas.spec.ts` (firma en la misma transacción; fallo de inserción no deja firma ni folio), cola de firmas (`fuente-fotos.spec.ts`), cuerpo de la operación con `firma`.
- **Backend unit:** normalización de `firma`; foto de venta: no proyectada 409, no espera firma 409, eliminada 404, reenvío idempotente, ajena 403.
- **Backend e2e:** push de venta con y sin `firma`; subida de firma y lectura por `GET /ventas/:id/firma`; alcance de sucursal.
- **pgTAP:** columnas y checks.
- **Portal:** los tres estados y el aviso de edición.
- **Emulador (al final):** venta sin red con firma → sincronizar → firma visible en el portal; tema oscuro.

## Para el despliegue

- Migración `20261021120000_venta_firma.sql` a la nube antes del backend; backend antes de la app.
- **APK nuevo** por `react-native-svg` (no basta actualizar por Metro).
- Una app vieja sigue funcionando: sus ventas llegan sin `firma` y se ven como "sin firma".
