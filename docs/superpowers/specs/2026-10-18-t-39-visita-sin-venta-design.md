# T-39 · Visita sin venta y motivo de no surtido (spec)

**Fecha:** 2026-10-18 · **Estado:** diseño aprobado en diálogo con Mario; falta que revise este texto.
**Issue:** #39, que es la pieza 3 del rediseño de la app (spec de T-37, "El rediseño completo, en piezas"). Este spec también absorbe **T-78** (#129).
**Depende de:** T-16 ✅, T-37 ✅, T-40 ✅, T-75 ✅.
**Vault:** [[Rutas]], [[Ruta]], [[Visita-Venta]], [[T-40 Registro de Prospectos]], [[App Tablet]], [[ADR-0009 Proyección de operaciones sincronizadas a los módulos de dominio|ADR-0009]].

## Para qué

Cuando un cliente de la ruta no compra, el vendedor tiene que poder dejar constancia de **por qué**:
- el motivo, elegido de un catálogo que la oficina administra;
- la hora;
- quién lo atendió;
- dónde estaba;
- una foto, cuando el motivo la exige.

Todo esto tiene que funcionar sin red, como la venta. La oficina usa estos datos para justificar los clientes no surtidos y, más adelante, para la notificación [[Visita-Venta]] (2 o más visitas sin venta). Hoy el botón **Visita** de la ficha abre una pantalla vacía (`visita-sin-venta.tsx`, `PantallaPendiente`).

## Respuestas de Mario (2026-10-18)

1. **Vender después de una visita sí se puede.** Una vez registrada la visita, el cliente sale de la lista de la ruta y pasa a la sección **"Visitados sin venta"**, al final. Si después compra, regresa a la ruta con su palomita.
2. **Sin GPS, la visita exige una dirección escrita.** No se puede guardar sin un punto GPS o sin ese texto.
3. **Quién atendió** depende de una casilla en el catálogo, **"exige nombre de quien atendió"**, junto a la de "exige foto". De semilla, "No estaba el encargado" pide nombre y "Cerrado" no.
4. **No hay pantalla de visitas en el portal** en este ticket. Los datos quedan en la base, para T-55 y para los reportes.

## Decisiones

**D1 · Catálogo `motivo_visita` (servidor), global y no por sucursal, igual que `tipo_negocio`.**
- Columnas:
  - `id uuid` (pk, `gen_random_uuid()`)
  - `nombre text not null`
  - `exige_foto boolean not null default false`
  - `exige_atendio boolean not null default false`
  - `deleted_at timestamptz`
  - `creado_en` y `actualizado_en timestamptz not null default now()`
- Índice único `uq_motivo_visita_nombre` sobre `lower(btrim(nombre))` `where deleted_at is null`, el mismo patrón que `tesoreria_cuenta`.
- Check: `btrim(nombre) <> ''`.
- La semilla va en la misma migración:

| Nombre | `exige_foto` | `exige_atendio` |
|---|---|---|
| Tenía producto | no | no |
| Sin dinero | no | no |
| No estaba el encargado | **sí** | **sí** |
| Competencia | no | no |
| Cerrado | **sí** | no |

**D2 · Tabla `visita` (servidor).**
- Columnas:
  - `id uuid` (pk). Es **la clave de la operación**, adoptada como en T-75 D2: la tablet ya conoce el id, y así la foto se liga sin ambigüedad.
  - `vendedor_id`, `sucursal_id` y `cliente_id`, con FK y `not null`.
  - `motivo_visita_id uuid not null` (FK).
  - `fecha date not null`: es el `fecha_operacion` del sobre y el día al que cuenta la visita.
  - `visitada_en timestamptz not null`: el instante en que el vendedor la guardó.
  - `observaciones text` y `atendio text`, opcionales.
  - `lat numeric(9,6)`, `lng numeric(9,6)`, `precision_m numeric` y `direccion_texto text`.
  - `foto_archivo text` y `foto_subida_en timestamptz`.
  - `creado_en timestamptz not null default now()`.
- Checks:
  - lat y lng van juntas, las dos nulas o las dos con valor, y en rango;
  - **hay ubicación**: `(lat is not null) or (btrim(coalesce(direccion_texto,'')) <> '')`;
  - la foto va completa, igual que `ck_cliente_foto_completa`.
- Índices sobre `(cliente_id, fecha)` y `(vendedor_id, fecha)`.
- **No lleva FK a `jornada`.** La tablet solo sube la jornada ya cerrada, así que el día ya queda dado por vendedor y fecha.
- Se puede visitar **a un prospecto**: su ficha ya tiene el botón Visita (T-75 D6).
- **Puede haber varias visitas al día por cliente.** Eso es lo que necesita Visita-Venta.

**D3 · Operación nueva `visita` en el push.** Es un tipo nuevo y no el `ruta` reservado. Ese nombre se confunde con la ruta del día, y `ruta` sigue como hoy, guardado sin proyectar. Es aditivo: **`CONTRATO_ACTUAL` sigue en 1**.

`cliente_id` va en el **sobre**, así que se comprueba con el alcance normal del lote. No lleva folio.

```ts
export type DatosVisita = {
  motivo_visita_id: string;      // uuid
  visitada_en: string;           // ISO-8601 con zona
  observaciones?: string | null; // <= 500 caracteres
  atendio?: string | null;       // <= 120 caracteres
  lat?: number | null;           // -90..90, ambas o ninguna
  lng?: number | null;           // -180..180
  precision_m?: number | null;   // >= 0
  direccion_texto?: string | null; // <= 300; obligatoria (no vacia) si no hay lat/lng
};
```

- `prepararVisita` (`despacho-visita.ts`) valida la forma: la clave debe ser un uuid, y la ubicación tiene que estar presente según la regla de arriba.
  - Cualquier falla de forma es `datos-invalidos`, con un motivo que la nombre.
  - Los textos se recortan (trim) y un texto vacío se guarda como `null`.
- La proyección es `VisitasService.registrarVisita(datos, contexto, trx)`, en `modules/rutas/` (ADR-0009). Inserta con `id = clave` y devuelve `{tabla: 'visita', id}`.
- Códigos de rechazo nuevos (aditivos):
  - **`motivo-visita-inexistente`**: el id no existe en `motivo_visita`. Un motivo **dado de baja sí se acepta**: el vendedor lo eligió sin red cuando estaba vivo.
  - **`visita-id-ocupado`**: el id choca con una visita existente de otra operación. El motivo del rechazo es neutro, como en T-75.
- **El servidor no revisa "exige foto" ni "exige nombre".** La oficina puede cambiar las casillas mientras la tablet está sin red, y rechazar una visita ya hecha por un cambio posterior sería injusto. Lo exige la tablet al guardar.
- Orden del push: `jornadas → prospectos → ventas → cobranzas → visitas → rutas`. La visita va después de prospectos por la misma razón que la venta (T-75 D3).

**D4 · El catálogo baja en el pull.**
- Va en `catalogos.motivos_visita: MotivoVisitaPull[]`, con `{id, nombre, exige_foto, exige_atendio, activo}`. `activo = deleted_at is null`, el mismo patrón `bandera` de `tipos_negocio`.
- Es incremental por `desde` sobre `actualizado_en`, y la baja lógica también actualiza `actualizado_en`.
- La tablet hace upsert en su tabla local `motivo_visita`.

**D5 · Portal: Catálogo › Motivos de visita.**
- Una pantalla con la tabla del catálogo: nombre, "Exige foto" y "Exige nombre".
- Alta y edición en un formulario con el nombre y las dos casillas. Baja lógica con confirmación.
- Endpoints:
  - `GET /motivos-visita`, que en el portal lista solo los vivos;
  - `POST /motivos-visita`;
  - `PATCH /motivos-visita/:id`;
  - `DELETE /motivos-visita/:id`, que pone `deleted_at`.
- Permiso nuevo **`motivo_visita.gestionar`** (grupo General, como los demás catálogos), sembrado en la migración, para escribir. Leer requiere sesión del portal.
- Los nombres duplicados entre vivos se rechazan con 409 y un mensaje que lo diga.
- Patrón a copiar: la pestaña de cuentas de Tesorería (baja lógica) y la pantalla genérica de catálogo.
- Se agrega al menú, en el grupo Catálogo de `nav-config.ts`.

**D6 · Tablet: datos locales (migración 013).**
- La tabla `motivo_visita` replica el pull: `id`, `nombre`, `exige_foto`, `exige_atendio`, `activo`.
- La tabla `visita` lleva:
  - los campos de D2, más `motivo_nombre`, copia del nombre al guardar, para pintar sin join aunque el motivo cambie;
  - `foto_local` (ruta en el teléfono), `foto_estado`, con el mismo esquema que la foto del prospecto;
  - `sync_estado` y `sync_error`, con el patrón de `venta`/`cobranza`.
- El id es la clave.
- Repositorio nuevo `visitas.ts` con:
  - `registrar` (una transacción);
  - `delDia(clienteId, fecha)`;
  - `delDiaDelVendedor(vendedorId, fecha)`;
  - `pendientesDeSincronizar`, `marcarSincronizada` y `marcarError`.
- Fuente nueva `fuente-visitas.ts`, con `fuente-cobranzas.ts` como plantilla.

**D7 · Pantalla "Visita sin venta"** (reemplaza a `visita-sin-venta.tsx`).
1. Al abrirla, empieza a pedir la ubicación con `obtenerUbicacion()` (10 s, nunca lanza). Así el punto ya está listo al guardar.
2. **Motivo**: una lista de opciones con los motivos activos del catálogo local, por nombre.
3. **Observaciones**: texto libre, opcional.
4. **Quién atendió**: un campo que aparece y es obligatorio si el motivo tiene `exige_atendio`; si no, es opcional.
5. **Foto**: botón "Tomar foto", que es obligatorio si el motivo tiene `exige_foto`. Reutiliza la captura y compresión del prospecto, generalizada (D9).
6. **Ubicación**: la pantalla muestra en qué estado está:
   - "Buscando ubicación…";
   - "Ubicación tomada (±N m)";
   - "No se pudo obtener la ubicación". En este caso aparece el campo **"Dirección o referencia"**, obligatorio.
   - Si la ubicación llega mientras el campo ya está escrito, se guardan las dos cosas.
7. **Guardar**: se habilita solo cuando se cumple lo que falte. La hora (`visitada_en`) se toma al guardar. Después de guardar, regresa a la ruta del día con el aviso "Visita registrada".
- Sin catálogo local, porque no ha sincronizado nunca, la pantalla lo dice y no deja guardar.
- Toda la validación vive en una función pura `validarVisita(...)`, con pruebas, en `src/estado/visita.ts`. La pantalla solo la pinta.

**D8 · La ruta del día y la ficha.**
- **Atendido (venta o cobranza hoy) gana a visitado.** El cliente con venta o cobranza sigue en la ruta con la palomita, igual que hoy, aunque también tenga visitas.
- **Visitado sin venta.** Es el cliente de la ruta viva con al menos una visita hoy y sin venta ni cobranza.
  - Sale de la lista y aparece en la sección nueva **"Visitados sin venta"**, después de la lista y antes de "Fuera de ruta".
  - Cada fila muestra el nombre, el motivo y la hora de la **última** visita, y el estado de subida de sus visitas, con la misma regla que las ventas (error > pendiente > listo).
  - Tocar la fila abre la ficha, y desde ahí se puede vender. Al vender, regresa a la ruta con la palomita.
- **La consulta de la ruta.** `rutas.delDia` agrega `visita_sin_venta` y `ultima_visita` (motivo y hora), con el mismo estilo de subconsulta que `visitado`. `visitado` pasa a contar también las visitas, y así "Fuera de ruta" incluye al cliente quitado por la oficina que solo fue visitado.
- **`agruparRuta`** devuelve también `visitadosSinVenta`. Sigue siendo una función pura y se le agregan pruebas.
- **Fuera de la ruta.** Un cliente o prospecto visitado que no está en la ruta de hoy aparece en **"Atendidos fuera de ruta"** (T-75 D7) con la etiqueta "visita". `atendidosFueraDeRuta` también recibe las visitas del día.
- **La ficha** gana la tarjeta **"Visitas de hoy"**, con el motivo, la hora y la pastilla de subida de cada visita. El botón Visita deja de decir "pendiente T-39".
- **Efectividad (T-46).** Una visita no cuenta como cliente vendido. Este ticket solo deja el dato.

**D9 · Fotos: canal generalizado, archivo nombrado por id (T-78) y descarga a la tablet.**
- **Subida.**
  - `POST /sync/foto/:clave` acepta operaciones `prospecto` **y** `visita`. Busca la clave **entre las operaciones del vendedor del token**.
  - Si la clave no existe, 404; si existe solo para otro vendedor, 403.
  - Cualquier otro tipo de operación da 409, y una operación sin proyectar también da 409, como hoy.
  - Una visita guarda en `visita.foto_archivo`/`foto_subida_en`; un prospecto, en `cliente`.
- **Nombre del archivo (T-78).**
  - Los archivos nuevos se llaman `cliente-<cliente.id>.jpg` y `visita-<visita.id>.jpg`, nunca por la clave de idempotencia.
  - Los archivos ya guardados no se migran: `foto_archivo` guarda el nombre y el servidor siempre lee por esa columna.
  - Se cierra #129 con esa nota.
- **Tablet.**
  - La cola de fotos acepta varias fuentes. `proveedor-sesion.tsx` le pasa las de prospectos y visitas.
  - La captura `capturarFotoProspecto` se generaliza a `capturarFoto(destino)`, con la misma compresión de 300 KB.
  - La foto de una visita se sube cuando su operación ya está aplicada.
- **Descarga.**
  - Endpoint nuevo `GET /sync/foto/cliente/:clienteId` (`@SoloApp`): devuelve el JPEG de la foto del cliente o prospecto si es de la sucursal del vendedor, y 404 si no tiene foto o no está en su alcance.
  - El pull de clientes agrega `foto_subida_en` (aditivo).
  - Cuando la ficha no tiene la foto en el teléfono, o la tiene más vieja que `foto_subida_en`, la descarga una vez y la guarda en caché, en el directorio de documentos y por id. Sin red, sigue mostrando "sin foto" como hoy.
  - Las fotos de visitas **no** bajan a la tablet: nadie las necesita ahí todavía.

## Fuera de alcance

- Una pantalla en el portal para consultar las visitas, con sus fotos (respuesta 4 de Mario).
- La notificación Visita-Venta (T-55): este ticket solo deja los datos.
- La efectividad de la ruta (T-46) y el mapa (T-41).
- Que la tablet suba una visita editada o borrada: la visita no se edita, igual que la venta.

## Errores y casos límite

- **Permiso de cámara negado**: hay que dejar la foto como pendiente. Con un motivo que exige foto, no se puede guardar, y la pantalla lo dice y ofrece abrir los ajustes.
- **Permiso de ubicación negado o tiempo agotado**: aparece el campo de dirección (D7); nunca bloquea si se escribe la dirección.
- **Motivo dado de baja después de guardar**: la visita sube igual (D3). La tablet deja de ofrecer ese motivo en el siguiente pull.
- **Visita rechazada**: la pastilla "rechazado" con su motivo aparece en la ficha y en la fila de "Visitados sin venta". Se reintenta en la siguiente sincronización.
- **Foto que no sube**: la visita aplicada queda bien, y la foto se reintenta como la del prospecto.

## Pruebas

- **Backend unit**: `prepararVisita` (cada regla de forma), `VisitasService` y la ruta de la foto (prospecto, visita, ajena, tipo equivocado y sin proyectar).
- **Backend e2e** (`test/visita.e2e-spec.ts`):
  - push de una visita con GPS y otra sin GPS con dirección;
  - visita a un prospecto subido en el mismo push;
  - motivo dado de baja aceptado e inexistente rechazado;
  - id ocupado;
  - foto de visita subida y foto de cliente descargada (de su sucursal; ajena da 404);
  - el pull trae los motivos y la baja.
  - Las e2e del portal: CRUD de motivos con permiso, sin permiso (403) y nombre duplicado (409).
- **pgTAP**: los checks de `visita` y `motivo_visita`, la semilla y el permiso.
- **Tablet (Jest)**: `validarVisita`, `agruparRuta` con visitados sin venta, `atendidosFueraDeRuta` con visitas, el repositorio de visitas y `fuentesDelPush` con el orden nuevo.
- **Portal**: pruebas de pantalla del catálogo, con el patrón de T-65.
- **Aceptación en el emulador**:
  - visita "Cerrado" sin red, con foto;
  - el cliente pasa a "Visitados sin venta";
  - sincronizar y comprobar en Postgres la visita y el archivo `visita-<id>.jpg`;
  - venderle y que regrese a la ruta;
  - visita con la ubicación negada, que exige la dirección.

## Memoria y documentos

- `docs/contrato-sincronizacion.md` §6 agrega la operación `visita`, el pull `motivos_visita` y la descarga de fotos.
- `CLAUDE.md` agrega un bloque de T-39.
- En el vault, al terminar: [[Rutas]], [[Ruta]] y [[App Tablet]]; el ADR-0009 cambia su nota de que `ruta` estaba reservado para la visita; Estado del proyecto y la bitácora.

## Conflicto previsible

El [PR #135](https://github.com/robertopeiro12/proyecto-sinmex/pull/135) (menú lateral) cambia `app/(jornada)/index.tsx`, y este ticket le agrega una sección. Si #135 se mergea primero, esta rama trae `main` antes del PR. Si no, lo resuelve quien mergee después.
