# T-38 · Jornada y kilometraje — backend + candados de la tablet (spec)

**Fecha:** 2026-10-10 · **Rama:** `feature/t-38-jornada` (ya trae la parte de tablet del 18-sep y `main` en `e3fa44d`, PR #112)
**Origen:** revisión de errores de la app en el emulador (2026-10-10, Pixel 7 / Android 16, backend local, Postgres local 35/35).
**Decisiones:** las D1…D7 las tomó el agente el 2026-10-10 bajo la instrucción de Mario *"lánzalos por subagent driven"*, sin recorrido previo. Cada una dice qué cuesta si está mal. Mario puede revertir cualquiera en la revisión del PR.

## Qué se rompe hoy (medido)

**E1 · El kilometraje del día llega al servidor y nadie lo guarda.** La tablet sube la jornada cerrada como operación `tipo: 'jornada'`. El servidor la acepta y la deja en `sync_operacion` como `aplicada`, pero `despacho.ts` devuelve `proyeccion: null` para ese tipo y no existe ninguna tabla `jornada` ni de kilometraje en `public`. Evidencia (Postgres local, 2026-10-10 18:24Z):

```
select tipo, entidad_tabla, datos from sync_operacion where tipo='jornada';
jornada | (null) | {"km_final": 128512, "abierta_en": "2026-10-10T18:03:53.458Z", "cerrada_en": "2026-10-10T18:19:55.706Z", "cliente_id": null, "km_inicial": 128450, "vehiculo_id": "106c93f1-0c9a-4efc-b167-8c73eea9b023"}
select table_name from information_schema.tables where table_schema='public' and table_name ilike '%jornada%';  -- 0 filas
```

Ese es exactamente el sobre que la tablet ya manda hoy (`apps/tablet/src/sincronizacion/fuente-jornadas.ts`): `fecha_operacion` = `jornada.fecha`, `ocurrido_en` = `cerrada_en`, `datos` = `{ vehiculo_id, km_inicial, km_final, abierta_en, cerrada_en, cliente_id: null }`. **No se inventan campos nuevos ni se cambia el sobre.**

**E2 · La app deja vender y cobrar con el día ya cerrado.** En SQLite: `jornada.cerrada_en = 2026-10-10T18:19:55Z`; venta `TJ261010DM03` con `grabada_en = 2026-10-10T18:22:08Z`, sincronizada sin rechazo. El guardia de `app/(jornada)/_layout.tsx` exige que exista jornada, no que esté abierta. El vault (`App Tablet`, §5) solo dice que el km final va *"antes de enviar el corte"*; no define qué pasa después de cerrar. Es una decisión de producto (D6).

**E3 · "1 registro por subir" todo el día.** Recién abierto el día, la tarjeta de sincronización dice `1 REGISTRO POR SUBIR`; al sincronizar, la alerta dice *"se subieron 0"* y la pastilla sigue en 1 (capturas s08/s10). Causa: `contarPendientesDeSubir()` suma `jornadas.pendientesDeSincronizar()`, que devuelve toda jornada con `sync_estado in ('pendiente','error')` sin mirar `estado`; `fuente-jornadas.ts:38` solo sube las `cerrada`. La jornada abierta cuenta como pendiente pero nunca viaja.

## Decisiones

**D1 · Tabla `jornada` en Postgres**, migración nueva con timestamp posterior a `20261007160000`. Columnas: `id uuid pk default gen_random_uuid()`, `created_at/updated_at/deleted_at` con el patrón del repo, `vendedor_id uuid not null → vendedor`, `vehiculo_id uuid not null → vehiculo`, `sucursal_id uuid not null → sucursal`, `fecha date not null` (= `fecha_operacion` que manda la tablet, el servidor **no** la re-deriva), `km_inicial numeric(10,1) not null check (>= 0)`, `km_final numeric(10,1) not null check (>= km_inicial)`, `abierta_en timestamptz not null`, `cerrada_en timestamptz not null`. Única `(vendedor_id, fecha)` sobre filas vivas, espejo de la restricción de SQLite. Índice por `(sucursal_id, fecha)` para el reporte. Trigger de `updated_at`, grants y RLS **con el mismo patrón que `cobranza_abono` / `venta_nota`** en migraciones previas (el planificador lo copia, no lo inventa). pgTAP propio. Solo jornadas **cerradas**: hasta T-43 el buzón es de solo escritura y la tablet no sube las abiertas. *Si está mal:* una columna de más o de menos se corrige con otra migración aditiva.

**D2 · Proyección según ADR-0009.** `tipo: 'jornada'` deja de ser "sin módulo". `despacho.ts` valida la **forma** de `datos` antes de la transacción (`vehiculo_id` uuid, `km_inicial`/`km_final` números finitos ≥ 0, `abierta_en`/`cerrada_en` ISO-8601; `cliente_id` se ignora) y produce `{ tipo: 'jornada', jornada: JornadaNormalizada }`. `rutas/JornadasService.cerrarJornada(jornada, contexto)` inserta la fila **dentro de la transacción de la operación** y devuelve `{ tabla: 'jornada', id }` para `entidad_tabla`/`entidad_id` (enmienda §2.4: **sin** columna `sync_operacion_id`). Una rechazada no deja fila. *Si está mal:* el patrón ya existe en `registrarVenta`/`registrarCobranza`; desviarse de él es lo único caro.

**D3 · Códigos de rechazo nuevos, aditivos** en `CODIGOS_RECHAZO` de **los dos** contratos (`apps/backend/src/modules/sincronizacion/contrato.ts` y `apps/tablet/src/sincronizacion/contrato.ts`) y en `docs/contrato-sincronizacion.md`, sin subir `CONTRATO_ACTUAL`:
- `jornada-datos-invalidos` — forma de `datos` incorrecta (antes de la transacción).
- `jornada-km-invalido` — `km_final < km_inicial`.
- `vehiculo-inexistente` — el vehículo no existe, está dado de baja o es de otra sucursal que la del vendedor del token.
- `jornada-duplicada` — ya hay jornada viva de ese vendedor en esa fecha con **otra** clave de idempotencia (la misma clave ya la resuelve el buzón como `duplicada`).
La tablet ya deja la fila en `error` con el motivo que mande el servidor; no hace falta pantalla nueva. *Si está mal:* un código de más no rompe a nadie; uno genérico sí (regla global).

**D4 · Sin backfill.** Las operaciones `jornada` que ya están en `sync_operacion` como aplicadas sin proyección no se reprocesan en esta rama. Se anota en el PR; si Roberto quiere, es un script aparte.

**D5 · Sin endpoint de reporte.** El reporte de Kilometraje del portal (`GET` por sucursal y rango) es del lado del portal (Roberto). Esta rama deja la tabla poblada y nada más. Se anota como siguiente paso en el PR.

**D6 · Cerrar el día cierra las operaciones (tablet).** Tres capas, las tres obligatorias:
1. **Confirmación antes de cerrar** (`Alert.alert` con dos botones, como `confirmarSalida` en `app/(jornada)/index.tsx`): *"Después de cerrar el día ya no podrás vender, cobrar ni registrar prospectos en esta tablet. ¿Cerrar el día con km final N?"* — Cancelar / Cerrar el día.
2. **Menú de la jornada** (`app/(jornada)/index.tsx`): con la jornada `cerrada`, las tarjetas *Operación por cliente*, *Prospectos* y *Ruta y GPS* quedan deshabilitadas (si `BotonMenu` no admite `deshabilitado`, se le agrega con el patrón de `Boton`) y aparece una tarjeta `estado="listo"` *"Día cerrado · km final N · lo capturado sube con «Sincronizar ahora»"*. *Cerrar el día* sigue navegable (muestra el resumen) y *Sincronizar ahora* sigue activo.
3. **Capa de datos**: `ventas.registrar`, `cobranzas.registrar` y `prospectos.registrar` lanzan `ErrorJornada('El día ya está cerrado. No se pueden registrar operaciones hasta la siguiente jornada.')` cuando la jornada de hoy del vendedor está `cerrada`. Es el candado que vale aunque alguien llegue por una ruta profunda. Las pantallas ya muestran `e.message` de los errores de dominio. Pruebas en Node para los tres repositorios.
*Si está mal:* un vendedor que cierre por error se queda sin vender ese día (no hay reabrir). Se deshace quitando la capa 3 y el deshabilitado de la 2; la confirmación de la 1 conviene igual.

**D7 · El contador cuenta solo lo que viaja.** `jornadas.pendientesDeSincronizar()` devuelve solo `estado = 'cerrada' and sync_estado in ('pendiente','error')`. El filtro de `fuente-jornadas.ts:38` queda redundante; puede quedarse con un comentario o quitarse, pero `fuente-jornadas.spec.ts` (ya existe, 191 líneas) debe seguir en verde. Prueba nueva: con una jornada abierta, `contarPendientesDeSubir` da 0; al cerrarla, 1.

## Restricciones globales (van en el plan)

- Código en español, identificadores sin acentos, mensajes al usuario con acentos. Comentarios que explican *por qué*. Respuestas de la API en camelCase. Baja lógica; `deleted_at` nunca sale.
- Contrato solo aditivo; `CONTRATO_ACTUAL` no sube. Tipos en los dos archivos de contrato a la vez y en `docs/contrato-sincronizacion.md`.
- ADR-0009 (vault): una transacción por operación; rechazada no deja fila; código específico; trazabilidad por `entidad_tabla`/`entidad_id`.
- `fecha_operacion` la manda la tablet; el servidor no la re-deriva de UTC.
- Supabase local es compartido entre sesiones: `npm run supabase -- migration up --local` (siempre con `--`), nunca `db reset`. pgTAP: `npm run supabase -- test db --local`. `npm run db:types --workspace=apps/backend` y comprobar que `schema.d.ts` cambia solo por la tabla nueva.
- Nunca apuntar a `sinmex dev`. El push de la migración a la nube lo hace Roberto al mergear.
- Los conteos de pruebas los mide el implementador contra la línea base; no se escriben en el plan.
- Los implementadores no despachan subagentes, no empujan, no mergean.

## Fuera de alcance

Reporte de kilometraje en el portal (D5), backfill (D4), T-33 (corte), reabrir jornada, sincronización de jornadas abiertas (T-43).
