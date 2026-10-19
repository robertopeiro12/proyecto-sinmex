# T-72 · Prospecto con ubicación y geocodificación en el servidor — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que todo prospecto que llega de la tablet termine con coordenada: el alta exige "Dirección del negocio" cuando
no hay GPS, la dirección sube en la operación `prospecto` y el servidor la convierte en coordenada con Google después
del commit; el portal muestra de dónde salió la ubicación y puede ubicar a cualquier cliente con su domicilio.

**Architecture:** columna nueva `cliente.ubicacion_origen` (`gps`/`geocodificada`/`manual`, nula ⇔ `lat` nula). Un
módulo nuevo `modules/integraciones/geocodificacion/` expone el token `GEOCODIFICADOR` (implementación de Google con
`fetch` nativo y 5 s de `AbortController`, parser puro de la respuesta). `UbicacionClientesService` (cartera-clientes)
hace el intento en segundo plano (`update … where lat is null`, `updated_at = now()`) y el `POST /clientes/:id/ubicar`
del portal, que sí espera. `SincronizacionService` dispara el intento **después del commit** de un prospecto aplicado
con domicilio y sin GPS; `ClientesService` lo dispara después de guardar desde el portal. En la tablet, la migración
local 014 trae `prospecto.domicilio` y `cliente.ubicacion_origen`; la regla "dirección obligatoria sin GPS" vive en la
función pura `validarAltaProspecto`, que comparte con la visita de T-39 el criterio de coordenada válida.

**Tech Stack:** NestJS 11 + Kysely + Joi (backend), Postgres local vía Supabase (e2e, pgTAP), Next.js 15 + Vitest +
Testing Library (portal), Expo SDK 57 / React Native + SQLite + Jest en Node (tablet; sin pruebas de pantalla).

**Spec:** `docs/superpowers/specs/2026-10-19-t-72-geocodificacion-design.md` — léelo antes de empezar. Sus decisiones
D1…D7 **no se renegocian**. Si este plan lo contradice, manda el spec: para y pregunta.

---

## Global Constraints

Copiadas del spec y del repo. Cada tarea las incluye:

- Rama `feature/t-72-geocodificacion`. Todos los comandos **desde la raíz del worktree**
  (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t72`), con los scripts del workspace
  (`--workspace=apps/...`). **Nunca** entres a `../proyecto-sinmex` (clon de demo) ni a otro clon.
- **`CONTRATO_ACTUAL` sigue en 1.** `DatosProspecto.domicilio` y `ClientePull.ubicacion_origen` son aditivos.
- **Los tipos del contrato están duplicados**: `apps/backend/src/modules/sincronizacion/contrato.ts` (normativo) y
  `apps/tablet/src/sincronizacion/contrato.ts`. Si una tarea toca uno, toca el otro **y**
  `docs/contrato-sincronizacion.md` **en el mismo commit**.
- `domicilio` del prospecto: se recorta, vacío = `null`, **máximo 300 caracteres**; si se pasa, `datos-invalidos` con
  un motivo que empieza por `domicilio:`.
- **Ninguna prueba ni e2e llama a Google.** Las unitarias prueban el parser con JSON de ejemplo y `fetch` falso; los
  e2e sustituyen el proveedor con `.overrideProvider(GEOCODIFICADOR).useValue(...)`.
- **La clave sale solo del entorno** (`GOOGLE_MAPS_API_KEY`, opcional) y **nunca** aparece en logs, respuestas ni
  detalles de error. Al registrar un error se loguea el `status` de Google o el código HTTP, **nunca la URL**.
- Llamada a Google: `https://maps.googleapis.com/maps/api/geocode/json` con `address`, `region=mx`,
  `components=country:MX`, `language=es`, `key`; **tiempo máximo 5 s** con `AbortController`; `fetch` nativo, sin
  dependencias nuevas.
- **Precisión**: se acepta el primer resultado solo si `location_type` es `ROOFTOP`, `RANGE_INTERPOLATED` o
  `GEOMETRIC_CENTER`; `APPROXIMATE` = `imprecisa`; `ZERO_RESULTS` = `no-encontrada`; red, cuota, `REQUEST_DENIED`,
  5xx o tiempo agotado = `error`.
- **Después del commit, nunca dentro de la transacción del push, y el push nunca espera a Google.** Solo para
  prospectos **recién aplicados** (no `duplicada`, no `rechazada`) con `domicilio` y sin `lat`/`lng`.
- El intento escribe con `update cliente set lat, lng, ubicacion_origen = 'geocodificada', updated_at = now() where
  id = ? and lat is null`. Sin reintentos automáticos, sin cola, sin cron. `sin-configurar` se loguea **una vez por
  arranque** como `warn`.
- `POST /clientes/:id/ubicar`: permiso **`cliente.gestionar`**, alcance por sucursal del usuario y **404 fuera de
  alcance**; espera como mucho 5 s; responde `200 { lat, lng, ubicacionOrigen: 'geocodificada' }`, o `409`/`502` con
  estos motivos **exactos**:
  - "El cliente no tiene domicilio."
  - "Ya tiene ubicación; bórrala primero para volver a ubicarlo."
  - "Google solo encontró la colonia o la ciudad: agrega calle y número."
  - "Google no encontró esa dirección."
  - "Falta configurar la clave de Google en el servidor."
  - `502`: "Google no respondió; intenta en un momento."
- Etiquetas de origen del portal, exactas: "GPS de la tablet", "Ubicada por Google", "Capturada a mano", "Sin
  ubicación". Botón: "Ubicar con la dirección". Campo de la tablet: "Dirección del negocio".
- Base de datos: **nunca `db reset`**. Migraciones locales solo con `npm run supabase -- migration up --local` (con el
  `--`). Supabase local es **compartido entre sesiones**. **Nunca apuntes nada a la nube** (`sinmex dev`): `.env.test`
  va a `127.0.0.1:54322`; no se corre `db push` ni nada con `--db-url`.
- Backend: lint **solo por archivo**: `npm exec --workspace=apps/backend -- prettier --write <archivos>` y
  `npm exec --workspace=apps/backend -- eslint <archivos>`. **Nunca** `npm run lint --workspace=apps/backend` (lleva
  `--fix` y reescribe archivos ajenos). Typecheck del backend = `npm run build --workspace=apps/backend`. Pruebas:
  `npm test --workspace=apps/backend -- <patrón>` y `npm run test:e2e --workspace=apps/backend -- <patrón>`.
- Los e2e **siembran lo que usan** con sufijo `${Date.now()}-${process.pid}` y lo borran en `afterAll` en orden
  inverso a las llaves foráneas.
- Portal: `npm test --workspace=apps/portal -- <patrón>`, `npx tsc --noEmit -p apps/portal`,
  `npm run lint --workspace=apps/portal`.
- Tablet: `npm run typecheck --workspace=apps/tablet`, `npm run lint --workspace=apps/tablet`,
  `npm test --workspace=apps/tablet -- <patrón>`. Las pruebas son **solo** `src/**/*.spec.ts` en Node: nada de
  pantallas. **La lógica de la tablet vive en funciones puras con pruebas de Jest**; la pantalla solo la llama. **No**
  corras el prettier de la raíz sobre la tablet.
- Migraciones locales de la tablet: **nunca se edita una publicada** (001…013); la nueva es la **014**.
- Código en español, **identificadores sin acentos**, **textos al usuario en español con acentos**. Comentarios que
  explican *por qué*; sigue el estilo del archivo que tocas.
- `git status` limpio al terminar cada tarea; un commit por tarea (o más si el implementador lo prefiere), con el
  trailer exacto en la última línea del mensaje: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Lo que el spec implica y ninguna prueba cubriría si no se añade aquí; cada línea se pinó en la tarea dueña:

1. **La oficina edita la ficha de un cliente ubicado por Google (o por GPS) y guarda sin tocar la ubicación** → el
   formulario reenvía la misma coordenada y el origen **no** debe volverse "Capturada a mano". Tarea 1
   (`origenAlGuardar`) y Tarea 4 (e2e "reenviar la misma coordenada conserva el origen").
2. **Google tarda (hasta 5 s) mientras la tablet sube su lote** → el push responde enseguida y la coordenada aparece
   después. Tarea 5 (e2e con el falso que demora 1.5 s).
3. **La WiFi se cae después de aplicar y la tablet reenvía el alta** (`duplicada`), o el alta se rechaza → no hay
   segundo intento ni intento alguno. Tarea 5 (e2e de `duplicada` y de `tipo-negocio-inexistente`).
4. **La oficina captura una coordenada a mano mientras Google responde** → la de la oficina gana. Tarea 3 (unitaria:
   `guardarGeocodificada` devuelve `false` → 409) y Tarea 4 (e2e del `where lat is null` sobre una fila con `lat`).
5. **El GPS entrega una lectura inválida** (NaN, fuera de rango) en el alta → cuenta como "sin GPS": se exige la
   dirección y se guarda con `lat`/`lng` en null. Tarea 8 (`validarAltaProspecto`).

---

## Mapa de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `supabase/migrations/20261019120000_cliente_ubicacion_origen.sql` | Columna, backfill y checks | 1 |
| `supabase/tests/99_cliente_ubicacion_origen_test.sql` | pgTAP de la columna | 1 |
| `apps/backend/src/modules/cartera-clientes/ubicacion-origen.ts` | Reglas puras de origen y de "¿geocodificar al guardar?" | 1, 4 |
| `apps/backend/src/modules/integraciones/geocodificacion/geocodificador.ts` | Interfaz, resultado y token | 2 |
| `apps/backend/src/modules/integraciones/geocodificacion/respuesta-google.ts` | Parser puro de la respuesta | 2 |
| `apps/backend/src/modules/integraciones/geocodificacion/google.ts` | Llamada a Google (fetch + 5 s) | 2 |
| `apps/backend/src/modules/integraciones/geocodificacion/geocodificador-falso.ts` | Falso de desarrollo (`GEOCODIFICADOR_FALSO=1`) | 2 |
| `apps/backend/src/modules/integraciones/geocodificacion/geocodificacion.module.ts` | Proveedor `GEOCODIFICADOR` | 2 |
| `apps/backend/src/modules/cartera-clientes/ubicacion-clientes.service.ts` | Intento en segundo plano y `ubicar` | 3 |
| `apps/backend/test/apoyo-geocodificador.ts` | Falso de los e2e y espera | 4 |
| `apps/backend/test/ubicacion-clientes.e2e-spec.ts` | e2e del portal | 4 |
| `apps/backend/test/geocodificacion-sync.e2e-spec.ts` | e2e del push y del pull | 5 |
| `apps/portal/src/lib/ubicacion-cliente.ts` | Etiqueta de origen y visibilidad del botón (puro) | 6 |
| `apps/tablet/src/datos/migraciones/014-prospecto-domicilio.ts` | Migración local 014 | 7 |
| `apps/tablet/src/estado/coordenada.ts` | Coordenada válida, compartida con la visita | 8 |
| `apps/tablet/src/estado/alta-prospecto.ts` | `validarAltaProspecto` y textos de ubicación | 8 |

---

### Tarea 1: `cliente.ubicacion_origen`: migración, pgTAP y cada escritor la respeta (D3)

**Files:**
- Create: `supabase/tests/99_cliente_ubicacion_origen_test.sql`
- Create: `supabase/migrations/20261019120000_cliente_ubicacion_origen.sql`
- Modify (generado): `apps/backend/src/database/schema.d.ts`
- Create: `apps/backend/src/modules/cartera-clientes/ubicacion-origen.ts`
- Create: `apps/backend/src/modules/cartera-clientes/ubicacion-origen.spec.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.repository.ts` (`ClienteDetalle`, `DatosClienteBase`,
  `FilaDetalle`, `aDetalle`, `COLUMNAS_DETALLE`, `insertarProspecto`, `crear`, `actualizar`)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.service.ts` (`crear`, `editar`)
- Modify: `apps/backend/test/sincronizacion.e2e-spec.ts:692-708` (fixture con `lat`)

**Interfaces:**
- Consumes: tabla `cliente` (`lat`, `lng`, trigger `trg_cliente_updated`).
- Produces: columna `cliente.ubicacion_origen text` con `ck_cliente_ubicacion_origen_valor` y
  `ck_cliente_ubicacion_origen_con_lat`; en Kysely `Cliente.ubicacion_origen: string | null`;
  `type OrigenUbicacion = 'gps' | 'geocodificada' | 'manual'`;
  `interface UbicacionActual { lat: number | null; lng: number | null; ubicacionOrigen: OrigenUbicacion | null }`;
  `origenAlGuardar(nueva: { lat: number | null; lng: number | null }, actual: UbicacionActual | null): OrigenUbicacion | null`;
  `ClienteDetalle.ubicacionOrigen: OrigenUbicacion | null`; `DatosClienteBase.ubicacion_origen: OrigenUbicacion | null`.
  `insertarProspecto` escribe `'gps'` si llega `lat` (firma sin cambios).

> Por qué todo junto: en cuanto la migración existe, cualquier `insert`/`update` de `cliente` con `lat` y sin
> `ubicacion_origen` viola el check. Esta tarea deja la base y **todos** sus escritores coherentes, para que los e2e
> que ya existen sigan en verde.

- [ ] **Paso 1: la prueba pgTAP que falla**

`supabase/tests/99_cliente_ubicacion_origen_test.sql`:

```sql
begin;
select plan(11);

-- T-72 (D3): `cliente.ubicacion_origen` dice de donde salio la coordenada
-- actual: 'gps' (la tablet al dar de alta), 'geocodificada' (Google, desde el
-- servidor) o 'manual' (la oficina en el portal). Nula si y solo si no hay `lat`.
-- Prefijo `ZZ-pgtap-T72`; todo se va con el rollback.

select has_column('cliente', 'ubicacion_origen');
select col_type_is('cliente', 'ubicacion_origen', 'text', 'ubicacion_origen es text');
select col_is_null('cliente', 'ubicacion_origen',
  'nulable: un cliente sin coordenada no tiene origen');

-- Backfill: ninguna fila con coordenada se quedo sin origen.
select is(
  (select count(*)::int from cliente where lat is not null and ubicacion_origen is null),
  0, 'toda fila con coordenada tiene origen (el backfill la marco manual)');

insert into sucursal (codigo, nombre) values ('UO', 'Test ubicacion T-72');
create temporary table ref on commit drop as
  select (select id from sucursal where codigo = 'UO') as sucursal;

select lives_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, lat, lng, ubicacion_origen)
    select 'ZZ-pgtap-T72 GPS', null, '6641112233', false, 'prospecto', null, sucursal, 32.5149, -117.0382, 'gps' from ref$$,
  'un prospecto con GPS entra con origen gps');

select lives_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id)
    select 'ZZ-pgtap-T72 Sin', 'Av. Revolucion 1234', '6641112233', false, 'prospecto', null, sucursal from ref$$,
  'sin coordenada y sin origen entra');

select lives_ok(
  $$update cliente set lat = 32.5251, lng = -117.0213, ubicacion_origen = 'geocodificada'
     where nombre = 'ZZ-pgtap-T72 Sin'$$,
  'el servidor anota la coordenada de Google con su origen');

select lives_ok(
  $$update cliente set lat = null, lng = null, ubicacion_origen = null
     where nombre = 'ZZ-pgtap-T72 GPS'$$,
  'borrar la coordenada borra su origen');

select throws_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, lat, lng, ubicacion_origen)
    select 'ZZ-pgtap-T72 Raro', null, '1', false, 'prospecto', null, sucursal, 32.5, -117, 'satelite' from ref$$,
  '23514', null, 'solo gps, geocodificada o manual');

select throws_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, lat, lng)
    select 'ZZ-pgtap-T72 SinOrigen', null, '1', false, 'prospecto', null, sucursal, 32.5, -117 from ref$$,
  '23514', null, 'con coordenada el origen es obligatorio');

select throws_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, ubicacion_origen)
    select 'ZZ-pgtap-T72 OrigenSolo', null, '1', false, 'prospecto', null, sucursal, 'manual' from ref$$,
  '23514', null, 'sin coordenada no hay origen');

select * from finish();
rollback;
```

- [ ] **Paso 2: correr y ver fallar**

`npm run supabase -- test db --local` → `99_cliente_ubicacion_origen_test.sql` falla en `has_column` (la columna no
existe). Las demás suites siguen como estaban.

- [ ] **Paso 3: la migración**

`supabase/migrations/20261019120000_cliente_ubicacion_origen.sql`:

```sql
-- T-72: de donde salio la coordenada actual del cliente (D3).
-- Spec: docs/superpowers/specs/2026-10-19-t-72-geocodificacion-design.md
--
-- * 'gps': la tomo la tablet al dar de alta el prospecto.
-- * 'geocodificada': la calculo el servidor con Google a partir del domicilio.
-- * 'manual': la capturo la oficina en el portal.
-- * null: no hay coordenada.
--
-- Backfill: toda fila con coordenada queda 'manual'. Antes de T-72 las
-- coordenadas solo se capturaban a mano en el portal o por GPS en un
-- prospecto; distinguirlas no vale la pena y 'manual' es la etiqueta
-- conservadora.
--
-- El update del backfill dispara `trg_cliente_updated` y mueve `updated_at` de
-- esas filas. Es a proposito: asi el pull incremental les baja
-- `ubicacion_origen` a las tablets sin un vuelco completo.
--
-- > [!info] Pre-flight para quien empuje esto a `sinmex dev`
-- > Los dos checks no pueden fallar: el backfill cubre toda fila con `lat`
-- > antes de crearlos. La consulta queda escrita para el comentario del PR
-- > (cuantas filas va a marcar el backfill):
-- >
-- >   select count(*) from cliente where lat is not null;

alter table cliente add column ubicacion_origen text;

update cliente set ubicacion_origen = 'manual' where lat is not null;

alter table cliente add constraint ck_cliente_ubicacion_origen_valor
  check (ubicacion_origen in ('gps', 'geocodificada', 'manual'));

-- Nula si y solo si no hay coordenada. Se ata a `lat`, como dice D3. `cliente`
-- no tiene un check de "lat y lng juntas" y este ticket no lo agrega: el portal
-- y la tablet ya mandan las dos o ninguna.
alter table cliente add constraint ck_cliente_ubicacion_origen_con_lat
  check ((ubicacion_origen is null) = (lat is null));
```

- [ ] **Paso 4: aplicar y ver pasar**

```bash
npm run supabase -- migration list --local     # 20261019120000 aparece sin aplicar
npm run supabase -- migration up --local       # aplica solo las pendientes; NUNCA db reset
npm run supabase -- test db --local            # 99_cliente_ubicacion_origen_test.sql: 11/11
```

Si `migration list` muestra **otras** migraciones pendientes que no son de esta rama (otra sesión trabaja en el mismo
Supabase local), **para** y avisa al controlador antes de aplicar.

- [ ] **Paso 5: regenerar los tipos de Kysely**

```bash
npm run db:types --workspace=apps/backend
git diff apps/backend/src/database/schema.d.ts
```

El diff debe agregar **solo** `ubicacion_origen: string | null;` en `interface Cliente`. Si aparecen tablas o columnas
ajenas (migraciones de otra rama aplicadas al Supabase compartido), deja solo lo de T-72 a mano en ese archivo.

- [ ] **Paso 6: la prueba unitaria de `origenAlGuardar` que falla**

`apps/backend/src/modules/cartera-clientes/ubicacion-origen.spec.ts`:

```ts
import { origenAlGuardar } from './ubicacion-origen';

const GOOGLE = {
  lat: 32.5251,
  lng: -117.0213,
  ubicacionOrigen: 'geocodificada' as const,
};

describe('origenAlGuardar (T-72, D3)', () => {
  it('un alta sin coordenada no tiene origen', () => {
    expect(origenAlGuardar({ lat: null, lng: null }, null)).toBeNull();
  });

  it('un alta con coordenada la capturo la oficina', () => {
    expect(origenAlGuardar({ lat: 32.5, lng: -117 }, null)).toBe('manual');
  });

  it('reenviar la misma coordenada conserva su origen: el formulario manda la ficha completa', () => {
    expect(origenAlGuardar({ lat: 32.5251, lng: -117.0213 }, GOOGLE)).toBe(
      'geocodificada',
    );
    expect(
      origenAlGuardar(
        { lat: 32.5149, lng: -117.0382 },
        { lat: 32.5149, lng: -117.0382, ubicacionOrigen: 'gps' },
      ),
    ).toBe('gps');
  });

  it('cambiar cualquiera de las dos la vuelve manual', () => {
    expect(origenAlGuardar({ lat: 32.53, lng: -117.0213 }, GOOGLE)).toBe(
      'manual',
    );
    expect(origenAlGuardar({ lat: 32.5251, lng: -117.03 }, GOOGLE)).toBe(
      'manual',
    );
  });

  it('borrar la coordenada borra su origen', () => {
    expect(origenAlGuardar({ lat: null, lng: null }, GOOGLE)).toBeNull();
  });

  it('una coordenada nueva en un cliente que no tenia es manual', () => {
    expect(
      origenAlGuardar(
        { lat: 32.5, lng: -117 },
        { lat: null, lng: null, ubicacionOrigen: null },
      ),
    ).toBe('manual');
  });
});
```

Run: `npm test --workspace=apps/backend -- ubicacion-origen` → FAIL ("Cannot find module './ubicacion-origen'").

- [ ] **Paso 7: implementar `ubicacion-origen.ts`**

`apps/backend/src/modules/cartera-clientes/ubicacion-origen.ts`:

```ts
/**
 * De donde salio la coordenada de un cliente (T-72, D3), y que origen se guarda
 * cuando el portal manda latitud y longitud.
 *
 * Puro, sin base de datos. La base lo hace cumplir con dos checks
 * (`ck_cliente_ubicacion_origen_valor`, `ck_cliente_ubicacion_origen_con_lat`):
 * nulo si y solo si no hay `lat`.
 */
export type OrigenUbicacion = 'gps' | 'geocodificada' | 'manual';

/** La coordenada que ya tiene el cliente, con su origen. */
export interface UbicacionActual {
  lat: number | null;
  lng: number | null;
  ubicacionOrigen: OrigenUbicacion | null;
}

/**
 * El origen que se guarda con un alta o una edicion del portal.
 *
 * - Sin `lat` no hay coordenada: `null` (borrar la coordenada borra su origen).
 * - La MISMA coordenada que ya tenia conserva su origen. El formulario del
 *   portal manda siempre la ficha completa (`EditarClienteDto`), asi que guardar
 *   sin tocar la ubicacion reenvia la de Google o la del GPS; si eso la volviera
 *   `'manual'`, cada edicion borraria de donde salio.
 * - Cualquier otra coordenada la capturo la oficina: `'manual'`.
 *
 * `actual` es `null` en un alta.
 */
export function origenAlGuardar(
  nueva: { lat: number | null; lng: number | null },
  actual: UbicacionActual | null,
): OrigenUbicacion | null {
  if (nueva.lat === null) return null;
  if (
    actual !== null &&
    actual.ubicacionOrigen !== null &&
    actual.lat === nueva.lat &&
    actual.lng === nueva.lng
  ) {
    return actual.ubicacionOrigen;
  }
  return 'manual';
}
```

Run: `npm test --workspace=apps/backend -- ubicacion-origen` → PASS (6).

- [ ] **Paso 8: el repositorio lee y escribe `ubicacion_origen`**

En `apps/backend/src/modules/cartera-clientes/clientes.repository.ts`:

1. Import, junto a los demás:

```ts
import type { OrigenUbicacion } from './ubicacion-origen';
```

2. En `interface ClienteDetalle`, después de `lng: number | null;`:

```ts
  /**
   * T-72 (D3): de donde salio la coordenada (`'gps'`, `'geocodificada'`,
   * `'manual'`), o `null` si no hay. El portal pinta la etiqueta con esto.
   */
  ubicacionOrigen: OrigenUbicacion | null;
```

3. En `interface DatosClienteBase`, después de `lng: number | null;`:

```ts
  /** T-72: lo calcula `origenAlGuardar`; la base exige nulo si y solo si `lat` es nula. */
  ubicacion_origen: OrigenUbicacion | null;
```

4. En `interface FilaDetalle`, después de `lng: string | null;`: `ubicacion_origen: string | null;`

5. En `aDetalle`, después de `lng: aNumero(fila.lng),`:

```ts
    // El check de la base garantiza que solo llega uno de los tres o null.
    ubicacionOrigen: fila.ubicacion_origen as OrigenUbicacion | null,
```

6. En `COLUMNAS_DETALLE`, después de `'cliente.lng',`: `'cliente.ubicacion_origen',`

7. En `insertarProspecto`, dentro de `.values({...})`, después de `lng: datos.lng?.toString() ?? null,`:

```ts
        // T-72 (D2): la coordenada de un alta de la app solo puede ser del GPS.
        ubicacion_origen: datos.lat !== null ? 'gps' : null,
```

8. En `crear`, dentro de `.values({...})`, después de `lng: datos.lng?.toString() ?? null,`:
   `ubicacion_origen: datos.ubicacion_origen,`

9. En `actualizar`, dentro de `.set({...})`, después de `lng: cambios.lng?.toString() ?? null,`:
   `ubicacion_origen: cambios.ubicacion_origen,`

- [ ] **Paso 9: el servicio calcula el origen al guardar desde el portal**

En `apps/backend/src/modules/cartera-clientes/clientes.service.ts`:

1. Import: `import { origenAlGuardar } from './ubicacion-origen';`
2. En `crear`, dentro del objeto que se pasa a `this.repo.crear(`, después de `lng: dto.lng ?? null,`:

```ts
          // T-72 (D3): un alta del portal con coordenada la capturo la oficina.
          ubicacion_origen: origenAlGuardar(
            { lat: dto.lat ?? null, lng: dto.lng ?? null },
            null,
          ),
```

3. En `editar`, dentro del objeto que se pasa a `this.repo.actualizar(`, después de `lng: dto.lng ?? null,`:

```ts
          // T-72 (D3): la misma coordenada conserva su origen; otra es 'manual'.
          ubicacion_origen: origenAlGuardar(
            { lat: dto.lat ?? null, lng: dto.lng ?? null },
            cliente,
          ),
```

(`cliente` es el `ClienteDetalle` que `editar` ya leyó; tiene `lat`, `lng` y `ubicacionOrigen`.)

- [ ] **Paso 10: el fixture de `sincronizacion.e2e-spec.ts` que siembra un cliente con `lat`**

En `apps/backend/test/sincronizacion.e2e-spec.ts`, en el `insertInto('cliente')` del `beforeAll` que trae
`lat: '32.514900'` y `lng: '-117.038200'`, agrega después de `lng`:

```ts
          // T-72: con coordenada, el origen es obligatorio (ck_cliente_ubicacion_origen_con_lat).
          ubicacion_origen: 'manual',
```

Busca si queda otro: `grep -rn "lat: '" apps/backend/test apps/backend/src` → solo ese fixture y un caso de
`datos-prospecto.spec.ts` que no escribe en la base.

- [ ] **Paso 11: verificar**

```bash
npm run build --workspace=apps/backend
npm exec --workspace=apps/backend -- prettier --write src/modules/cartera-clientes/ubicacion-origen.ts src/modules/cartera-clientes/ubicacion-origen.spec.ts src/modules/cartera-clientes/clientes.repository.ts src/modules/cartera-clientes/clientes.service.ts test/sincronizacion.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/cartera-clientes/ubicacion-origen.ts src/modules/cartera-clientes/ubicacion-origen.spec.ts src/modules/cartera-clientes/clientes.repository.ts src/modules/cartera-clientes/clientes.service.ts test/sincronizacion.e2e-spec.ts
npm test --workspace=apps/backend -- cartera-clientes
npm run test:e2e --workspace=apps/backend -- clientes prospectos prospecto-venta sincronizacion foto-prospecto
```

Expected: build sin errores, eslint sin errores, unitarias y e2e en verde (los e2e ya existentes no cambian de
resultado: ninguno escribe `lat` sin pasar por el repositorio salvo el fixture del Paso 10).

- [ ] **Paso 12: commit**

```bash
git add supabase/migrations/20261019120000_cliente_ubicacion_origen.sql supabase/tests/99_cliente_ubicacion_origen_test.sql apps/backend/src/database/schema.d.ts apps/backend/src/modules/cartera-clientes/ubicacion-origen.ts apps/backend/src/modules/cartera-clientes/ubicacion-origen.spec.ts apps/backend/src/modules/cartera-clientes/clientes.repository.ts apps/backend/src/modules/cartera-clientes/clientes.service.ts apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "T-72: cliente.ubicacion_origen (migración, pgTAP y origen al guardar)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: Módulo de geocodificación: parser, Google con 5 s, falso de desarrollo y configuración (D4)

**Files:**
- Create: `apps/backend/src/modules/integraciones/geocodificacion/geocodificador.ts`
- Create: `apps/backend/src/modules/integraciones/geocodificacion/respuesta-google.ts`
- Create: `apps/backend/src/modules/integraciones/geocodificacion/respuesta-google.spec.ts`
- Create: `apps/backend/src/modules/integraciones/geocodificacion/google.ts`
- Create: `apps/backend/src/modules/integraciones/geocodificacion/google.spec.ts`
- Create: `apps/backend/src/modules/integraciones/geocodificacion/geocodificador-falso.ts`
- Create: `apps/backend/src/modules/integraciones/geocodificacion/geocodificacion.module.ts`
- Create: `apps/backend/src/modules/integraciones/geocodificacion/geocodificacion.module.spec.ts`
- Modify: `apps/backend/src/configuracion.schema.ts` (dos claves al final del objeto)
- Create: `apps/backend/src/configuracion.schema.spec.ts`
- Modify: `.env.example` (bloque nuevo al final)

**Interfaces:**
- Consumes: `ConfigService` de `@nestjs/config` (global en `AppModule`).
- Produces (para las Tareas 3–5):
  - `type ResultadoGeocodificacion = { estado: 'ok'; lat: number; lng: number } | { estado: 'sin-configurar' } | { estado: 'imprecisa' } | { estado: 'no-encontrada' } | { estado: 'error'; detalle: string }`
  - `interface Geocodificador { geocodificar(direccion: string): Promise<ResultadoGeocodificacion> }`
  - `const GEOCODIFICADOR: unique symbol` (token de Nest)
  - `interpretarRespuestaGoogle(cuerpo: unknown): ResultadoGeocodificacion`
  - `geocodificarConGoogle(direccion: string, opciones: { clave: string | null; fetch: typeof fetch; tiempoMaxMs: number }): Promise<ResultadoGeocodificacion>`, `TIEMPO_MAX_MS = 5000`, `URL_GEOCODING`
  - `class GeocodificadorGoogle implements Geocodificador` (`constructor(config: ConfigService)`)
  - `class GeocodificadorFalso implements Geocodificador`, `COORDENADA_DE_DESARROLLO`
  - `crearGeocodificador(config: ConfigService): Geocodificador`; `GeocodificacionModule` exporta `GEOCODIFICADOR`
  - Variables `GOOGLE_MAPS_API_KEY` (opcional, admite blanco) y `GEOCODIFICADOR_FALSO` (`'0' | '1'`, default `'0'`)

> `modules/integraciones/` no existe todavía: esta tarea lo crea (spec D4). No es un módulo de dominio del vault sino
> la frontera con servicios externos, como lo describe [[Integraciones]].

- [ ] **Paso 1: las pruebas del parser que fallan**

`apps/backend/src/modules/integraciones/geocodificacion/respuesta-google.spec.ts`:

```ts
import { interpretarRespuestaGoogle } from './respuesta-google';

/** Respuesta OK de Google con un resultado del tipo pedido. */
const conTipo = (
  location_type: string,
  lat: unknown = 32.5251234,
  lng: unknown = -117.0213456,
) => ({
  status: 'OK',
  results: [{ geometry: { location: { lat, lng }, location_type } }],
});

describe('interpretarRespuestaGoogle (T-72, D4)', () => {
  it.each(['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER'])(
    '%s es ok, redondeada a 6 decimales como numeric(9,6)',
    (tipo) => {
      expect(interpretarRespuestaGoogle(conTipo(tipo))).toEqual({
        estado: 'ok',
        lat: 32.525123,
        lng: -117.021346,
      });
    },
  );

  it('APPROXIMATE (colonia o ciudad) es imprecisa: una coordenada mala es peor que ninguna', () => {
    expect(interpretarRespuestaGoogle(conTipo('APPROXIMATE'))).toEqual({
      estado: 'imprecisa',
    });
  });

  it('solo mira el primer resultado', () => {
    const cuerpo = {
      status: 'OK',
      results: [
        conTipo('APPROXIMATE').results[0],
        conTipo('ROOFTOP').results[0],
      ],
    };
    expect(interpretarRespuestaGoogle(cuerpo)).toEqual({ estado: 'imprecisa' });
  });

  it('ZERO_RESULTS es no-encontrada', () => {
    expect(
      interpretarRespuestaGoogle({ status: 'ZERO_RESULTS', results: [] }),
    ).toEqual({ estado: 'no-encontrada' });
  });

  it.each([
    'REQUEST_DENIED',
    'OVER_QUERY_LIMIT',
    'OVER_DAILY_LIMIT',
    'INVALID_REQUEST',
    'UNKNOWN_ERROR',
  ])('%s es error con el status, sin el error_message de Google', (status) => {
    expect(
      interpretarRespuestaGoogle({
        status,
        error_message: 'The provided API key is invalid.',
        results: [],
      }),
    ).toEqual({ estado: 'error', detalle: `Google respondió ${status}.` });
  });

  it.each([null, 'texto', 42, []])(
    'un cuerpo que no es objeto (%p) es error',
    (cuerpo) => {
      expect(interpretarRespuestaGoogle(cuerpo)).toMatchObject({
        estado: 'error',
      });
    },
  );

  it('sin status es error', () => {
    expect(interpretarRespuestaGoogle({ results: [] })).toEqual({
      estado: 'error',
      detalle: 'Google respondió sin status.',
    });
  });

  it('OK sin resultados o sin coordenada legible es error', () => {
    expect(interpretarRespuestaGoogle({ status: 'OK', results: [] })).toEqual({
      estado: 'error',
      detalle: 'Google respondió OK sin una coordenada legible.',
    });
    expect(
      interpretarRespuestaGoogle(conTipo('ROOFTOP', '32.5', -117)),
    ).toMatchObject({ estado: 'error' });
    expect(
      interpretarRespuestaGoogle(conTipo('ROOFTOP', 32.5, Number.NaN)),
    ).toMatchObject({ estado: 'error' });
  });

  it('una coordenada fuera de la Tierra es error', () => {
    expect(interpretarRespuestaGoogle(conTipo('ROOFTOP', 91, -117))).toMatchObject(
      { estado: 'error' },
    );
    expect(interpretarRespuestaGoogle(conTipo('ROOFTOP', 32, -181))).toMatchObject(
      { estado: 'error' },
    );
  });

  it('un location_type desconocido es error, nunca ok', () => {
    expect(interpretarRespuestaGoogle(conTipo('SATELITE'))).toEqual({
      estado: 'error',
      detalle: 'Google respondió un location_type desconocido.',
    });
  });
});
```

Run: `npm test --workspace=apps/backend -- respuesta-google` → FAIL ("Cannot find module './respuesta-google'").

- [ ] **Paso 2: el contrato del geocodificador y el parser**

`apps/backend/src/modules/integraciones/geocodificacion/geocodificador.ts`:

```ts
/**
 * Convertir una direccion en coordenada (T-72, D4).
 *
 * Interfaz y token, sin implementacion: `cartera-clientes` depende de esto y no
 * de Google, y las pruebas inyectan un falso (`overrideProvider(GEOCODIFICADOR)`).
 * Ninguna prueba ni e2e llama a Google.
 */
export type ResultadoGeocodificacion =
  | { estado: 'ok'; lat: number; lng: number }
  /** No hay `GOOGLE_MAPS_API_KEY`: nada falla, el cliente se queda sin coordenada. */
  | { estado: 'sin-configurar' }
  /** Google solo encontro algo aproximado (colonia o ciudad). */
  | { estado: 'imprecisa' }
  /** `ZERO_RESULTS`. */
  | { estado: 'no-encontrada' }
  /**
   * Red, cuota, `REQUEST_DENIED`, 5xx o tiempo agotado. `detalle` es para el
   * log: lleva el `status` de Google o el codigo HTTP, **nunca** la URL ni la
   * clave.
   */
  | { estado: 'error'; detalle: string };

export interface Geocodificador {
  geocodificar(direccion: string): Promise<ResultadoGeocodificacion>;
}

/** Token de Nest del geocodificador. */
export const GEOCODIFICADOR = Symbol('GEOCODIFICADOR');
```

`apps/backend/src/modules/integraciones/geocodificacion/respuesta-google.ts`:

```ts
import type { ResultadoGeocodificacion } from './geocodificador';

/**
 * Lo que se acepta de Google como coordenada buena (D4). `APPROXIMATE` (nivel
 * colonia o ciudad) no: para rutear, una coordenada mala es peor que ninguna.
 */
export const TIPOS_PRECISOS: readonly string[] = [
  'ROOFTOP',
  'RANGE_INTERPOLATED',
  'GEOMETRIC_CENTER',
];

interface GeometriaGoogle {
  location?: { lat?: unknown; lng?: unknown };
  location_type?: unknown;
}

/** `numeric(9,6)`: se guarda con 6 decimales, asi que se responde igual. */
function redondear6(valor: number): number {
  return Math.round(valor * 1e6) / 1e6;
}

function enRango(valor: unknown, maximo: number): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isFinite(valor) &&
    valor >= -maximo &&
    valor <= maximo
  );
}

/**
 * El cuerpo JSON de la Geocoding API, a un resultado del dominio. Puro: se
 * prueba con JSON de ejemplo.
 *
 * Nunca copia `error_message` de Google al `detalle`: el `detalle` acaba en el
 * log y lo unico que hace falta ahi es el `status`.
 */
export function interpretarRespuestaGoogle(
  cuerpo: unknown,
): ResultadoGeocodificacion {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
    return {
      estado: 'error',
      detalle: 'Google respondió algo que no es una respuesta de geocodificación.',
    };
  }
  const { status, results } = cuerpo as { status?: unknown; results?: unknown };

  if (status === 'ZERO_RESULTS') return { estado: 'no-encontrada' };
  if (typeof status !== 'string') {
    return { estado: 'error', detalle: 'Google respondió sin status.' };
  }
  if (status !== 'OK') {
    return { estado: 'error', detalle: `Google respondió ${status}.` };
  }

  const primero: unknown = Array.isArray(results) ? results[0] : undefined;
  const geometria = (primero as { geometry?: GeometriaGoogle } | undefined)
    ?.geometry;
  const lat = geometria?.location?.lat;
  const lng = geometria?.location?.lng;
  if (!enRango(lat, 90) || !enRango(lng, 180)) {
    return {
      estado: 'error',
      detalle: 'Google respondió OK sin una coordenada legible.',
    };
  }

  const tipo = geometria?.location_type;
  if (tipo === 'APPROXIMATE') return { estado: 'imprecisa' };
  if (typeof tipo !== 'string' || !TIPOS_PRECISOS.includes(tipo)) {
    return {
      estado: 'error',
      detalle: 'Google respondió un location_type desconocido.',
    };
  }
  return { estado: 'ok', lat: redondear6(lat), lng: redondear6(lng) };
}
```

Run: `npm test --workspace=apps/backend -- respuesta-google` → PASS.

- [ ] **Paso 3: las pruebas de la llamada a Google que fallan**

`apps/backend/src/modules/integraciones/geocodificacion/google.spec.ts`:

```ts
import type { ConfigService } from '@nestjs/config';
import {
  GeocodificadorGoogle,
  TIEMPO_MAX_MS,
  URL_GEOCODING,
  geocodificarConGoogle,
} from './google';

const CLAVE = 'AIzaClaveSecretaDePrueba123';

const ROOFTOP = {
  status: 'OK',
  results: [
    {
      geometry: {
        location: { lat: 32.5251, lng: -117.0213 },
        location_type: 'ROOFTOP',
      },
    },
  ],
};

/** Un `fetch` falso que responde siempre lo mismo y anota las URL. */
function fetchQueResponde(cuerpo: unknown, status = 200) {
  const urls: string[] = [];
  const fn = jest.fn((url: string | URL | Request) => {
    urls.push(String(url));
    return Promise.resolve(
      new Response(
        typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
        { status, headers: { 'content-type': 'application/json' } },
      ),
    );
  });
  return { fetch: fn as unknown as typeof fetch, espia: fn, urls };
}

const opciones = (
  fetch: typeof globalThis.fetch,
  extra: Partial<{ clave: string | null; tiempoMaxMs: number }> = {},
) => ({ clave: CLAVE, fetch, tiempoMaxMs: 1000, ...extra });

describe('geocodificarConGoogle (T-72, D4)', () => {
  it('el tiempo maximo de produccion es de 5 s', () => {
    expect(TIEMPO_MAX_MS).toBe(5_000);
  });

  it('sin clave no toca la red: sin-configurar', async () => {
    const { fetch, espia } = fetchQueResponde(ROOFTOP);
    await expect(
      geocodificarConGoogle('Calle 1', opciones(fetch, { clave: null })),
    ).resolves.toEqual({ estado: 'sin-configurar' });
    expect(espia).not.toHaveBeenCalled();
  });

  it('pide la direccion en Mexico y en espanol, con la clave', async () => {
    const { fetch, urls } = fetchQueResponde(ROOFTOP);
    await expect(
      geocodificarConGoogle('Av. Revolución 1234, Zona Centro', opciones(fetch)),
    ).resolves.toEqual({ estado: 'ok', lat: 32.5251, lng: -117.0213 });

    const url = new URL(urls[0]);
    expect(`${url.origin}${url.pathname}`).toBe(URL_GEOCODING);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      address: 'Av. Revolución 1234, Zona Centro',
      region: 'mx',
      components: 'country:MX',
      language: 'es',
      key: CLAVE,
    });
  });

  it('un 5xx es error con el codigo HTTP', async () => {
    const { fetch } = fetchQueResponde('caido', 503);
    await expect(
      geocodificarConGoogle('Calle 1', opciones(fetch)),
    ).resolves.toEqual({ estado: 'error', detalle: 'Google respondió HTTP 503.' });
  });

  it('un JSON roto es error', async () => {
    const { fetch } = fetchQueResponde('{no es json', 200);
    await expect(
      geocodificarConGoogle('Calle 1', opciones(fetch)),
    ).resolves.toEqual({ estado: 'error', detalle: 'Google respondió un JSON roto.' });
  });

  it('sin red es error', async () => {
    const fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof globalThis.fetch;
    await expect(
      geocodificarConGoogle('Calle 1', opciones(fetch)),
    ).resolves.toEqual({ estado: 'error', detalle: 'No hubo conexión con Google.' });
  });

  it('se rinde al tiempo maximo: el AbortController corta la peticion', async () => {
    const fetch = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolver, rechazar) => {
          init?.signal?.addEventListener('abort', () =>
            rechazar(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof globalThis.fetch;

    const inicio = Date.now();
    await expect(
      geocodificarConGoogle('Calle 1', opciones(fetch, { tiempoMaxMs: 30 })),
    ).resolves.toEqual({
      estado: 'error',
      detalle: 'Google no respondió a tiempo (30 ms).',
    });
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });

  it('ningun detalle de error lleva la clave ni la URL', async () => {
    const casos: (typeof globalThis.fetch)[] = [
      fetchQueResponde({ status: 'REQUEST_DENIED', error_message: `bad ${CLAVE}` })
        .fetch,
      fetchQueResponde('x', 500).fetch,
      fetchQueResponde('{roto', 200).fetch,
      jest
        .fn()
        .mockRejectedValue(
          new TypeError(`fetch failed ${URL_GEOCODING}?key=${CLAVE}`),
        ) as unknown as typeof globalThis.fetch,
    ];
    for (const fetch of casos) {
      const r = await geocodificarConGoogle('Calle 1', opciones(fetch));
      expect(r.estado).toBe('error');
      expect(JSON.stringify(r)).not.toContain(CLAVE);
      expect(JSON.stringify(r)).not.toContain('maps.googleapis.com');
    }
  });
});

describe('GeocodificadorGoogle', () => {
  const config = (valores: Record<string, string | undefined>) =>
    ({ get: (clave: string) => valores[clave] }) as unknown as ConfigService;

  it.each([undefined, '', '   '])(
    'sin una clave util (%p) es sin-configurar y no toca la red',
    async (clave) => {
      const original = globalThis.fetch;
      const espia = jest.fn();
      globalThis.fetch = espia as unknown as typeof fetch;
      try {
        await expect(
          new GeocodificadorGoogle(
            config({ GOOGLE_MAPS_API_KEY: clave }),
          ).geocodificar('Calle 1'),
        ).resolves.toEqual({ estado: 'sin-configurar' });
        expect(espia).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = original;
      }
    },
  );
});
```

Run: `npm test --workspace=apps/backend -- integraciones/geocodificacion/google` → FAIL ("Cannot find module './google'").

- [ ] **Paso 4: la llamada a Google**

`apps/backend/src/modules/integraciones/geocodificacion/google.ts`:

```ts
import type { ConfigService } from '@nestjs/config';
import type {
  Geocodificador,
  ResultadoGeocodificacion,
} from './geocodificador';
import { interpretarRespuestaGoogle } from './respuesta-google';

export const URL_GEOCODING =
  'https://maps.googleapis.com/maps/api/geocode/json';

/** D4: como mucho 5 s. El boton del portal espera esto; el push nunca. */
export const TIEMPO_MAX_MS = 5_000;

export interface OpcionesGoogle {
  /** `null` = sin configurar: no se toca la red. */
  clave: string | null;
  /** Inyectable para las pruebas; en produccion, el `fetch` nativo de Node. */
  fetch: typeof globalThis.fetch;
  tiempoMaxMs: number;
}

/**
 * Una consulta a la Geocoding API (T-72, D4). **Nunca lanza**: todo fallo es
 * un resultado `error`, porque quien llama decide (el intento en segundo plano
 * solo loguea; el portal responde 502).
 *
 * > [!danger] La URL lleva la clave
 * > Por eso ningun `detalle` incluye la URL ni el mensaje del error de `fetch`
 * > (que en algunas versiones de Node la repite): solo el `status` de Google,
 * > el codigo HTTP o una frase fija.
 */
export async function geocodificarConGoogle(
  direccion: string,
  opciones: OpcionesGoogle,
): Promise<ResultadoGeocodificacion> {
  if (opciones.clave === null) return { estado: 'sin-configurar' };

  const parametros = new URLSearchParams({
    address: direccion,
    region: 'mx',
    components: 'country:MX',
    language: 'es',
    key: opciones.clave,
  });
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), opciones.tiempoMaxMs);
  try {
    const res = await opciones.fetch(
      `${URL_GEOCODING}?${parametros.toString()}`,
      { signal: control.signal },
    );
    if (!res.ok) {
      return { estado: 'error', detalle: `Google respondió HTTP ${res.status}.` };
    }
    return interpretarRespuestaGoogle(await res.json());
  } catch (error) {
    if (control.signal.aborted) {
      return {
        estado: 'error',
        detalle: `Google no respondió a tiempo (${opciones.tiempoMaxMs} ms).`,
      };
    }
    if (error instanceof SyntaxError) {
      return { estado: 'error', detalle: 'Google respondió un JSON roto.' };
    }
    return { estado: 'error', detalle: 'No hubo conexión con Google.' };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * El geocodificador de produccion. La clave sale del entorno
 * (`GOOGLE_MAPS_API_KEY`) y no sale de esta clase: ni logs ni respuestas.
 * Una clave en blanco cuenta como "sin configurar".
 */
export class GeocodificadorGoogle implements Geocodificador {
  private readonly clave: string | null;

  constructor(config: ConfigService) {
    const clave = config.get<string>('GOOGLE_MAPS_API_KEY')?.trim();
    this.clave = clave ? clave : null;
  }

  geocodificar(direccion: string): Promise<ResultadoGeocodificacion> {
    return geocodificarConGoogle(direccion, {
      clave: this.clave,
      // Se lee al llamar, no al construir: las pruebas sustituyen el global.
      fetch: (entrada, init) => globalThis.fetch(entrada, init),
      tiempoMaxMs: TIEMPO_MAX_MS,
    });
  }
}
```

Run: `npm test --workspace=apps/backend -- integraciones/geocodificacion/google` → PASS.

- [ ] **Paso 5: la prueba del proveedor que falla**

`apps/backend/src/modules/integraciones/geocodificacion/geocodificacion.module.spec.ts`:

```ts
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  COORDENADA_DE_DESARROLLO,
  GeocodificadorFalso,
} from './geocodificador-falso';
import { crearGeocodificador } from './geocodificacion.module';
import { GeocodificadorGoogle } from './google';

const config = (valores: Record<string, string | undefined>) =>
  ({ get: (clave: string) => valores[clave] }) as unknown as ConfigService;

describe('crearGeocodificador (T-72)', () => {
  let avisos: jest.SpyInstance;
  beforeEach(() => {
    avisos = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => avisos.mockRestore());

  it('por defecto es el de Google', () => {
    expect(crearGeocodificador(config({}))).toBeInstanceOf(GeocodificadorGoogle);
    expect(
      crearGeocodificador(config({ GEOCODIFICADOR_FALSO: '0' })),
    ).toBeInstanceOf(GeocodificadorGoogle);
    expect(avisos).not.toHaveBeenCalled();
  });

  it('GEOCODIFICADOR_FALSO=1 da el falso de desarrollo, y lo avisa en el log', async () => {
    const g = crearGeocodificador(config({ GEOCODIFICADOR_FALSO: '1' }));
    expect(g).toBeInstanceOf(GeocodificadorFalso);
    await expect(g.geocodificar('cualquier cosa')).resolves.toEqual({
      estado: 'ok',
      ...COORDENADA_DE_DESARROLLO,
    });
    expect(avisos).toHaveBeenCalledTimes(1);
  });
});
```

Run: `npm test --workspace=apps/backend -- geocodificacion.module` → FAIL ("Cannot find module").

- [ ] **Paso 6: el falso de desarrollo y el módulo**

`apps/backend/src/modules/integraciones/geocodificacion/geocodificador-falso.ts`:

```ts
import type {
  Geocodificador,
  ResultadoGeocodificacion,
} from './geocodificador';

/** Centro de Tijuana. */
export const COORDENADA_DE_DESARROLLO = { lat: 32.514947, lng: -117.038247 };

/**
 * **Solo desarrollo** (`GEOCODIFICADOR_FALSO=1`): toda direccion se "ubica" en
 * el centro de Tijuana sin llamar a Google. Existe para la aceptacion en el
 * emulador (spec, "Pruebas") mientras no haya clave. Los e2e NO lo usan: traen
 * su propio falso (`test/apoyo-geocodificador.ts`).
 */
export class GeocodificadorFalso implements Geocodificador {
  geocodificar(): Promise<ResultadoGeocodificacion> {
    return Promise.resolve({ estado: 'ok', ...COORDENADA_DE_DESARROLLO });
  }
}
```

`apps/backend/src/modules/integraciones/geocodificacion/geocodificacion.module.ts`:

```ts
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GEOCODIFICADOR, type Geocodificador } from './geocodificador';
import { GeocodificadorFalso } from './geocodificador-falso';
import { GeocodificadorGoogle } from './google';

/** El geocodificador segun el entorno. Exportado para probarlo sin Nest. */
export function crearGeocodificador(config: ConfigService): Geocodificador {
  if (config.get<string>('GEOCODIFICADOR_FALSO') === '1') {
    new Logger('Geocodificacion').warn(
      'GEOCODIFICADOR_FALSO=1: toda dirección se ubica en el centro de Tijuana sin llamar a Google. Solo para desarrollo.',
    );
    return new GeocodificadorFalso();
  }
  return new GeocodificadorGoogle(config);
}

/**
 * Integracion con la Geocoding API de Google (T-72, D4). Expone solo el token
 * `GEOCODIFICADOR`: quien lo usa (`cartera-clientes`) no sabe que es Google, y
 * los e2e lo sustituyen con `overrideProvider(GEOCODIFICADOR)`.
 */
@Module({
  providers: [
    {
      provide: GEOCODIFICADOR,
      inject: [ConfigService],
      useFactory: crearGeocodificador,
    },
  ],
  exports: [GEOCODIFICADOR],
})
export class GeocodificacionModule {}
```

Run: `npm test --workspace=apps/backend -- geocodificacion` → PASS (las tres suites del módulo).

- [ ] **Paso 7: la configuración**

`apps/backend/src/configuracion.schema.spec.ts`:

```ts
import { configuracionSchema } from './configuracion.schema';

describe('configuracionSchema (T-72)', () => {
  it('GOOGLE_MAPS_API_KEY es opcional y admite la linea en blanco del .env.example', () => {
    const clave = configuracionSchema.extract('GOOGLE_MAPS_API_KEY');
    expect(clave.validate(undefined).error).toBeUndefined();
    expect(clave.validate('').error).toBeUndefined();
    expect(clave.validate('AIza123').error).toBeUndefined();
  });

  it('GEOCODIFICADOR_FALSO solo acepta 0 o 1, y por defecto es 0', () => {
    const falso = configuracionSchema.extract('GEOCODIFICADOR_FALSO');
    expect(falso.validate(undefined).value).toBe('0');
    expect(falso.validate('1').error).toBeUndefined();
    expect(falso.validate('si').error).toBeDefined();
  });
});
```

Run: `npm test --workspace=apps/backend -- configuracion.schema` → FAIL (la clave no existe en el schema).

En `apps/backend/src/configuracion.schema.ts`, después de la línea `FOTOS_DIR: Joi.string().min(1).default('var/fotos'),`
y antes del `});` que cierra el objeto:

```ts

  // T-72: clave de la Geocoding API de Google. OPCIONAL a proposito (respuesta
  // 1 de Mario, 2026-10-19): sin ella nada falla, los clientes se quedan sin
  // coordenada y el portal avisa que falta. Admite la linea en blanco del
  // .env.example; `GeocodificadorGoogle` trata el blanco como "sin configurar".
  GOOGLE_MAPS_API_KEY: Joi.string().allow('').optional(),
  // T-72, solo desarrollo: '1' ubica toda direccion en el centro de Tijuana
  // sin llamar a Google (aceptacion en el emulador). Nunca en produccion.
  GEOCODIFICADOR_FALSO: Joi.string().valid('0', '1').default('0'),
```

Run: `npm test --workspace=apps/backend -- configuracion.schema` → PASS.

Al final de `.env.example`:

```bash

# --- Geocodificacion (T-72) ---
# Clave de la Geocoding API de Google. OPCIONAL: sin ella nada falla; los
# prospectos sin GPS se quedan sin coordenada y el boton "Ubicar con la
# direccion" del portal avisa que falta configurarla. Vive SOLO en el servidor
# (restringela a la Geocoding API en la consola de Google) y nunca se loguea.
GOOGLE_MAPS_API_KEY=
# Solo desarrollo: 1 hace que toda direccion se "ubique" en el centro de
# Tijuana sin llamar a Google (para probar el flujo en el emulador). Nunca en
# produccion.
GEOCODIFICADOR_FALSO=0
```

- [ ] **Paso 8: verificar y commit**

```bash
npm run build --workspace=apps/backend
npm exec --workspace=apps/backend -- prettier --write src/modules/integraciones src/configuracion.schema.ts src/configuracion.schema.spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/integraciones src/configuracion.schema.ts src/configuracion.schema.spec.ts
npm test --workspace=apps/backend -- geocodificacion configuracion.schema
git add apps/backend/src/modules/integraciones apps/backend/src/configuracion.schema.ts apps/backend/src/configuracion.schema.spec.ts .env.example
git commit -m "T-72: módulo de geocodificación (Google con 5 s, parser y falso de desarrollo)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

El módulo todavía no se importa en ningún lado: la Tarea 3 lo enchufa en `cartera-clientes`.

---

### Tarea 3: `UbicacionClientesService`: el intento en segundo plano y `ubicar` (D5)

**Files:**
- Create: `apps/backend/src/modules/cartera-clientes/ubicacion-clientes.service.ts`
- Create: `apps/backend/src/modules/cartera-clientes/ubicacion-clientes.service.spec.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.repository.ts` (dos métodos nuevos al final de la clase,
  antes de `buscarSucursalUsuario`)
- Modify: `apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts` (importa `GeocodificacionModule`,
  provee y exporta `UbicacionClientesService`)

**Interfaces:**
- Consumes: `GEOCODIFICADOR`, `Geocodificador`, `ResultadoGeocodificacion` (Tarea 2); `ClientesRepository`;
  `resolverAlcance` de `sucursales/alcance-sucursal`.
- Produces (para las Tareas 4 y 5):
  - `ClientesRepository.ubicacionDe(id: string): Promise<{ domicilio: string | null; lat: number | null; sucursalCodigo: string } | undefined>`
  - `ClientesRepository.guardarGeocodificada(id: string, lat: number, lng: number): Promise<boolean>` — `true` si
    escribió (la fila seguía con `lat` nula).
  - `MOTIVOS_UBICAR` (los seis textos del spec), `interface UbicacionGeocodificada { lat: number; lng: number; ubicacionOrigen: 'geocodificada' }`
  - `UbicacionClientesService.geocodificarEnSegundoPlano(clienteId: string): Promise<void>` — **nunca rechaza**;
    quien llama la dispara con `void` y no la espera.
  - `UbicacionClientesService.ubicar(usuarioId: string, clienteId: string): Promise<UbicacionGeocodificada>` — lanza
    `NotFoundException` (no existe o fuera de alcance), `ConflictException` o `BadGatewayException` con los motivos.

- [ ] **Paso 1: las pruebas que fallan**

`apps/backend/src/modules/cartera-clientes/ubicacion-clientes.service.spec.ts`:

```ts
import {
  BadGatewayException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Geocodificador,
  ResultadoGeocodificacion,
} from '../integraciones/geocodificacion/geocodificador';
import type { ClientesRepository } from './clientes.repository';
import {
  MOTIVOS_UBICAR,
  UbicacionClientesService,
} from './ubicacion-clientes.service';

const ID = '7f2c0000-0000-4000-8000-000000000001';
const DOMICILIO = 'Av. Revolución 1234, Zona Centro';
const OK: ResultadoGeocodificacion = {
  estado: 'ok',
  lat: 32.5251,
  lng: -117.0213,
};

interface ClienteUbicable {
  domicilio: string | null;
  lat: number | null;
  sucursalCodigo: string;
}

function montar({
  existe = true,
  cliente = { domicilio: DOMICILIO, lat: null, sucursalCodigo: 'TJ' } as ClienteUbicable,
  resultado = OK as ResultadoGeocodificacion | Error,
  guardada = true,
  codigoUsuario = null as string | null,
} = {}) {
  const repo = {
    ubicacionDe: jest.fn().mockResolvedValue(existe ? cliente : undefined),
    guardarGeocodificada: jest.fn().mockResolvedValue(guardada),
    buscarSucursalUsuario: jest
      .fn()
      .mockResolvedValue({ id: null, codigo: codigoUsuario }),
  };
  const geocodificador = {
    geocodificar: jest.fn((_direccion: string) =>
      resultado instanceof Error
        ? Promise.reject(resultado)
        : Promise.resolve(resultado),
    ),
  };
  const servicio = new UbicacionClientesService(
    repo as unknown as ClientesRepository,
    geocodificador as Geocodificador,
  );
  return { servicio, repo, geocodificador };
}

let avisos: jest.SpyInstance;
beforeEach(() => {
  avisos = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
});
afterEach(() => avisos.mockRestore());

describe('MOTIVOS_UBICAR (T-72, D5)', () => {
  it('son los textos exactos del spec', () => {
    expect(MOTIVOS_UBICAR).toEqual({
      sinDomicilio: 'El cliente no tiene domicilio.',
      yaTiene: 'Ya tiene ubicación; bórrala primero para volver a ubicarlo.',
      imprecisa:
        'Google solo encontró la colonia o la ciudad: agrega calle y número.',
      noEncontrada: 'Google no encontró esa dirección.',
      sinConfigurar: 'Falta configurar la clave de Google en el servidor.',
      error: 'Google no respondió; intenta en un momento.',
    });
  });
});

describe('geocodificarEnSegundoPlano (T-72, D5)', () => {
  it('con domicilio y sin coordenada, geocodifica el domicilio recortado y guarda', async () => {
    const { servicio, repo, geocodificador } = montar({
      cliente: { domicilio: `  ${DOMICILIO}  `, lat: null, sucursalCodigo: 'TJ' },
    });
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(geocodificador.geocodificar).toHaveBeenCalledWith(DOMICILIO);
    expect(repo.guardarGeocodificada).toHaveBeenCalledWith(ID, 32.5251, -117.0213);
  });

  it('si ya tiene coordenada no llama a Google', async () => {
    const { servicio, geocodificador, repo } = montar({
      cliente: { domicilio: DOMICILIO, lat: 32.5, sucursalCodigo: 'TJ' },
    });
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(geocodificador.geocodificar).not.toHaveBeenCalled();
    expect(repo.guardarGeocodificada).not.toHaveBeenCalled();
  });

  it.each([null, '', '   '])(
    'sin domicilio util (%p) no llama a Google',
    async (domicilio) => {
      const { servicio, geocodificador } = montar({
        cliente: { domicilio, lat: null, sucursalCodigo: 'TJ' },
      });
      await servicio.geocodificarEnSegundoPlano(ID);
      expect(geocodificador.geocodificar).not.toHaveBeenCalled();
    },
  );

  it('un cliente que ya no existe no hace nada', async () => {
    const { servicio, geocodificador } = montar({ existe: false });
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(geocodificador.geocodificar).not.toHaveBeenCalled();
  });

  it.each<ResultadoGeocodificacion>([
    { estado: 'imprecisa' },
    { estado: 'no-encontrada' },
    { estado: 'error', detalle: 'Google respondió REQUEST_DENIED.' },
  ])('un resultado $estado solo se loguea, sin guardar', async (resultado) => {
    const { servicio, repo } = montar({ resultado });
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(repo.guardarGeocodificada).not.toHaveBeenCalled();
    expect(avisos).toHaveBeenCalledTimes(1);
  });

  it('el error se loguea con su detalle (el status de Google)', async () => {
    const { servicio } = montar({
      resultado: { estado: 'error', detalle: 'Google respondió REQUEST_DENIED.' },
    });
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(String(avisos.mock.calls[0][0])).toContain(
      'Google respondió REQUEST_DENIED.',
    );
  });

  it('sin clave se avisa UNA vez por arranque', async () => {
    const { servicio } = montar({ resultado: { estado: 'sin-configurar' } });
    await servicio.geocodificarEnSegundoPlano(ID);
    await servicio.geocodificarEnSegundoPlano(ID);
    expect(avisos).toHaveBeenCalledTimes(1);
    expect(String(avisos.mock.calls[0][0])).toContain('GOOGLE_MAPS_API_KEY');
  });

  it('nunca rechaza: un fallo inesperado solo se loguea', async () => {
    const { servicio } = montar({ resultado: new Error('se cayo la base') });
    await expect(servicio.geocodificarEnSegundoPlano(ID)).resolves.toBeUndefined();
    expect(avisos).toHaveBeenCalledTimes(1);
  });
});

describe('ubicar (T-72, D5)', () => {
  /** El error que lanza `ubicar`, para revisar clase y mensaje con una sola llamada. */
  const errorDe = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

  it('ok: guarda y responde la coordenada con su origen', async () => {
    const { servicio, repo } = montar();
    await expect(servicio.ubicar('usuario-1', ID)).resolves.toEqual({
      lat: 32.5251,
      lng: -117.0213,
      ubicacionOrigen: 'geocodificada',
    });
    expect(repo.guardarGeocodificada).toHaveBeenCalledWith(ID, 32.5251, -117.0213);
  });

  it('si la oficina capturo una coordenada mientras Google respondia, 409 y no la pisa', async () => {
    const { servicio } = montar({ guardada: false });
    const error = await errorDe(servicio.ubicar('usuario-1', ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(MOTIVOS_UBICAR.yaTiene);
  });

  it('un cliente que no existe es 404', async () => {
    const { servicio } = montar({ existe: false });
    expect(await errorDe(servicio.ubicar('usuario-1', ID))).toBeInstanceOf(
      NotFoundException,
    );
  });

  it('un cliente de otra sucursal es 404, y no llama a Google', async () => {
    const { servicio, geocodificador } = montar({
      codigoUsuario: 'TJ',
      cliente: { domicilio: DOMICILIO, lat: null, sucursalCodigo: 'MX' },
    });
    expect(await errorDe(servicio.ubicar('usuario-1', ID))).toBeInstanceOf(
      NotFoundException,
    );
    expect(geocodificador.geocodificar).not.toHaveBeenCalled();
  });

  it('un usuario atado a la sucursal del cliente si puede', async () => {
    const { servicio } = montar({ codigoUsuario: 'TJ' });
    await expect(servicio.ubicar('usuario-1', ID)).resolves.toMatchObject({
      ubicacionOrigen: 'geocodificada',
    });
  });

  it.each([null, '  '])('sin domicilio (%p) es 409', async (domicilio) => {
    const { servicio, geocodificador } = montar({
      cliente: { domicilio, lat: null, sucursalCodigo: 'TJ' },
    });
    const error = await errorDe(servicio.ubicar('usuario-1', ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(MOTIVOS_UBICAR.sinDomicilio);
    expect(geocodificador.geocodificar).not.toHaveBeenCalled();
  });

  it('con coordenada es 409 y no llama a Google', async () => {
    const { servicio, geocodificador } = montar({
      cliente: { domicilio: DOMICILIO, lat: 32.5, sucursalCodigo: 'TJ' },
    });
    const error = await errorDe(servicio.ubicar('usuario-1', ID));
    expect((error as Error).message).toBe(MOTIVOS_UBICAR.yaTiene);
    expect(geocodificador.geocodificar).not.toHaveBeenCalled();
  });

  it.each<[ResultadoGeocodificacion, string]>([
    [{ estado: 'imprecisa' }, MOTIVOS_UBICAR.imprecisa],
    [{ estado: 'no-encontrada' }, MOTIVOS_UBICAR.noEncontrada],
    [{ estado: 'sin-configurar' }, MOTIVOS_UBICAR.sinConfigurar],
  ])('%o es 409 con su motivo, sin guardar', async (resultado, motivo) => {
    const { servicio, repo } = montar({ resultado });
    const error = await errorDe(servicio.ubicar('usuario-1', ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(motivo);
    expect(repo.guardarGeocodificada).not.toHaveBeenCalled();
  });

  it('error de Google es 502 con su motivo', async () => {
    const { servicio } = montar({
      resultado: { estado: 'error', detalle: 'Google respondió HTTP 503.' },
    });
    const error = await errorDe(servicio.ubicar('usuario-1', ID));
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as Error).message).toBe(MOTIVOS_UBICAR.error);
  });
});
```

Run: `npm test --workspace=apps/backend -- ubicacion-clientes` → FAIL ("Cannot find module './ubicacion-clientes.service'").

- [ ] **Paso 2: los dos métodos del repositorio**

En `apps/backend/src/modules/cartera-clientes/clientes.repository.ts`, dentro de la clase, justo antes de
`/** Delegado al helper compartido (D9 del plan, Task 2). */`:

```ts
  /**
   * Lo minimo para geocodificar (T-72): domicilio, si ya tiene coordenada y de
   * que sucursal es (para el alcance del portal). `undefined` si no existe o
   * esta dado de baja.
   */
  async ubicacionDe(id: string): Promise<
    | { domicilio: string | null; lat: number | null; sucursalCodigo: string }
    | undefined
  > {
    const fila = await this.db
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .select(['cliente.domicilio', 'cliente.lat', 'sucursal.codigo'])
      .where('cliente.id', '=', id)
      .where('cliente.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!fila) return undefined;
    return {
      domicilio: fila.domicilio,
      lat: aNumero(fila.lat),
      sucursalCodigo: fila.codigo,
    };
  }

  /**
   * Anota la coordenada que dio Google (T-72, D5). Devuelve `false` si no
   * escribio nada.
   *
   * - `where lat is null`: si la oficina capturo una coordenada mientras Google
   *   respondia, gana la de la oficina. Es la unica proteccion contra esa
   *   carrera, y por eso vive en el `where` y no en una lectura previa.
   * - `updated_at = now()` explicito (el trigger tambien lo haria): es lo que
   *   hace que la coordenada baje sola en el siguiente pull incremental.
   */
  async guardarGeocodificada(
    id: string,
    lat: number,
    lng: number,
  ): Promise<boolean> {
    const res = await this.db
      .updateTable('cliente')
      .set({
        lat: lat.toString(),
        lng: lng.toString(),
        ubicacion_origen: 'geocodificada',
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .where('lat', 'is', null)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }
```

- [ ] **Paso 3: el servicio**

`apps/backend/src/modules/cartera-clientes/ubicacion-clientes.service.ts`:

```ts
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GEOCODIFICADOR,
  type Geocodificador,
  type ResultadoGeocodificacion,
} from '../integraciones/geocodificacion/geocodificador';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import { ClientesRepository } from './clientes.repository';

/** Los motivos del spec (D5), exactos: el portal los pinta tal cual. */
export const MOTIVOS_UBICAR = {
  sinDomicilio: 'El cliente no tiene domicilio.',
  yaTiene: 'Ya tiene ubicación; bórrala primero para volver a ubicarlo.',
  imprecisa:
    'Google solo encontró la colonia o la ciudad: agrega calle y número.',
  noEncontrada: 'Google no encontró esa dirección.',
  sinConfigurar: 'Falta configurar la clave de Google en el servidor.',
  error: 'Google no respondió; intenta en un momento.',
} as const;

export interface UbicacionGeocodificada {
  lat: number;
  lng: number;
  ubicacionOrigen: 'geocodificada';
}

type ResultadoFallido = Exclude<ResultadoGeocodificacion, { estado: 'ok' }>;

/**
 * Convertir el domicilio de un cliente en coordenada (T-72, D5).
 *
 * Vive en Cartera de Clientes porque es la duena de `cliente` (ADR-0009); el
 * proveedor (Google) llega por el token `GEOCODIFICADOR` y no se conoce aqui.
 *
 * Dos entradas:
 * - `geocodificarEnSegundoPlano`: la disparan el push (despues del commit de un
 *   prospecto) y el guardado del portal, **sin esperarla**. Nunca rechaza.
 * - `ubicar`: el boton del portal. Esta si espera (Google tiene 5 s) y traduce
 *   cada resultado a 200/409/502.
 *
 * Sin reintentos, sin cola, sin cron: un intento perdido (reinicio del proceso,
 * Google caido) se repite a mano con el boton.
 */
@Injectable()
export class UbicacionClientesService {
  private readonly logger = new Logger(UbicacionClientesService.name);
  /** `sin-configurar` se avisa una sola vez por arranque, no en cada alta. */
  private avisoSinClaveDado = false;

  constructor(
    private readonly repo: ClientesRepository,
    @Inject(GEOCODIFICADOR) private readonly geocodificador: Geocodificador,
  ) {}

  /**
   * Un intento, si todavia hace falta: el cliente existe, no tiene coordenada y
   * tiene domicilio. Solo mira `lat` y `domicilio`: que el prospecto se haya
   * convertido en cliente mientras tanto no importa.
   */
  async geocodificarEnSegundoPlano(clienteId: string): Promise<void> {
    try {
      const cliente = await this.repo.ubicacionDe(clienteId);
      const domicilio = cliente?.domicilio?.trim() ?? '';
      if (!cliente || cliente.lat !== null || domicilio === '') return;

      const r = await this.geocodificador.geocodificar(domicilio);
      if (r.estado === 'ok') {
        await this.repo.guardarGeocodificada(clienteId, r.lat, r.lng);
        return;
      }
      this.registrar(clienteId, r);
    } catch (error) {
      // Nunca rechaza: quien llama no espera esta promesa, y un rechazo sin
      // `catch` tumbaria el proceso. Solo el nombre del error, no su mensaje.
      this.logger.warn(
        `Geocodificación del cliente ${clienteId}: falló sin resultado (${error instanceof Error ? error.name : 'error'}).`,
      );
    }
  }

  async ubicar(
    usuarioId: string,
    clienteId: string,
  ): Promise<UbicacionGeocodificada> {
    const cliente = await this.repo.ubicacionDe(clienteId);
    if (!cliente) throw new NotFoundException('No existe ese cliente.');

    // D5: fuera de alcance es 404, no 403: no confirma que el cliente exista.
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(fila.codigo, null);
    if (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo) {
      throw new NotFoundException('No existe ese cliente.');
    }

    const domicilio = cliente.domicilio?.trim() ?? '';
    if (domicilio === '') {
      throw new ConflictException(MOTIVOS_UBICAR.sinDomicilio);
    }
    if (cliente.lat !== null) {
      throw new ConflictException(MOTIVOS_UBICAR.yaTiene);
    }

    const r = await this.geocodificador.geocodificar(domicilio);
    switch (r.estado) {
      case 'ok': {
        const guardada = await this.repo.guardarGeocodificada(
          clienteId,
          r.lat,
          r.lng,
        );
        // Alguien capturo una coordenada mientras Google respondia: gana la suya.
        if (!guardada) throw new ConflictException(MOTIVOS_UBICAR.yaTiene);
        return { lat: r.lat, lng: r.lng, ubicacionOrigen: 'geocodificada' };
      }
      case 'imprecisa':
        throw new ConflictException(MOTIVOS_UBICAR.imprecisa);
      case 'no-encontrada':
        throw new ConflictException(MOTIVOS_UBICAR.noEncontrada);
      case 'sin-configurar':
        throw new ConflictException(MOTIVOS_UBICAR.sinConfigurar);
      case 'error':
        this.registrar(clienteId, r);
        throw new BadGatewayException(MOTIVOS_UBICAR.error);
    }
  }

  /** `warn` sin la clave: el `detalle` solo lleva el status de Google o el HTTP. */
  private registrar(clienteId: string, r: ResultadoFallido): void {
    if (r.estado === 'sin-configurar') {
      if (this.avisoSinClaveDado) return;
      this.avisoSinClaveDado = true;
      this.logger.warn(
        'Geocodificación: falta GOOGLE_MAPS_API_KEY; los clientes se quedan sin coordenada hasta configurarla.',
      );
      return;
    }
    this.logger.warn(
      `Geocodificación del cliente ${clienteId}: ${r.estado === 'error' ? r.detalle : r.estado}.`,
    );
  }
}
```

- [ ] **Paso 4: enchufarlo en el módulo**

En `apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts`:

1. Imports nuevos:

```ts
import { GeocodificacionModule } from '../integraciones/geocodificacion/geocodificacion.module';
import { UbicacionClientesService } from './ubicacion-clientes.service';
```

2. En `@Module({`, agrega antes de `controllers:`:

```ts
  // T-72: el geocodificador (Google) llega por token; Cartera de Clientes no lo conoce.
  imports: [GeocodificacionModule],
```

3. En `providers`, después de `FotosRepository,`:

```ts
    // T-72: geocodificacion del domicilio (segundo plano y boton del portal).
    UbicacionClientesService,
```

4. En `exports`, agrega `UbicacionClientesService` (la usa `sincronizacion/` en la Tarea 5):
   `exports: [PreciosRepository, ClientesService, FotosService, UbicacionClientesService],` y una línea al comentario de
   arriba: `// T-72: \`sincronizacion/\` dispara el intento de geocodificar despues del commit de un prospecto.`

- [ ] **Paso 5: verificar y commit**

```bash
npm test --workspace=apps/backend -- ubicacion-clientes
npm run build --workspace=apps/backend
npm exec --workspace=apps/backend -- prettier --write src/modules/cartera-clientes/ubicacion-clientes.service.ts src/modules/cartera-clientes/ubicacion-clientes.service.spec.ts src/modules/cartera-clientes/clientes.repository.ts src/modules/cartera-clientes/cartera-clientes.module.ts
npm exec --workspace=apps/backend -- eslint src/modules/cartera-clientes/ubicacion-clientes.service.ts src/modules/cartera-clientes/ubicacion-clientes.service.spec.ts src/modules/cartera-clientes/clientes.repository.ts src/modules/cartera-clientes/cartera-clientes.module.ts
npm run test:e2e --workspace=apps/backend -- app.e2e clientes
```

Expected: unitarias en verde; el e2e de arranque (`app.e2e`) y `clientes` siguen en verde (el módulo resuelve
`GEOCODIFICADOR`; sin clave en `.env.test`, el de Google no toca la red).

```bash
git add apps/backend/src/modules/cartera-clientes/ubicacion-clientes.service.ts apps/backend/src/modules/cartera-clientes/ubicacion-clientes.service.spec.ts apps/backend/src/modules/cartera-clientes/clientes.repository.ts apps/backend/src/modules/cartera-clientes/cartera-clientes.module.ts
git commit -m "T-72: UbicacionClientesService (intento en segundo plano y ubicar)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: Portal en el backend: `POST /clientes/:id/ubicar` y el intento al guardar (D3, D5)

**Files:**
- Modify: `apps/backend/src/modules/cartera-clientes/ubicacion-origen.ts` (+ `pideGeocodificarAlGuardar`)
- Modify: `apps/backend/src/modules/cartera-clientes/ubicacion-origen.spec.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.service.ts` (constructor, `crear`, `editar`)
- Modify: `apps/backend/src/modules/cartera-clientes/crear-prospecto.spec.ts:44-53` (`montar`)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.controller.ts` (constructor y handler nuevo)
- Modify: `apps/backend/src/modules/cartera-clientes/dto/crear-cliente.dto.ts`, `dto/editar-cliente.dto.ts`
  (`domicilio` hasta 300)
- Create: `apps/backend/test/apoyo-geocodificador.ts`
- Create: `apps/backend/test/ubicacion-clientes.e2e-spec.ts`

**Interfaces:**
- Consumes: `origenAlGuardar` (Tarea 1); `UbicacionClientesService`, `MOTIVOS_UBICAR`, `UbicacionGeocodificada`,
  `ClientesRepository.guardarGeocodificada` (Tarea 3); `GEOCODIFICADOR`, `Geocodificador`,
  `ResultadoGeocodificacion` (Tarea 2).
- Produces:
  - `pideGeocodificarAlGuardar(domicilioAntes: string | null | undefined, guardado: { domicilio: string | null; lat: number | null }): boolean`
    (`undefined` = alta)
  - `new ClientesService(repo: ClientesRepository, ubicacion: UbicacionClientesService)`
  - Endpoint `POST /clientes/:id/ubicar` → `200 UbicacionGeocodificada`
  - `test/apoyo-geocodificador.ts`: `class GeocodificadorDePrueba implements Geocodificador` con
    `responder(direccion, resultado, demoraMs = 0)`, `vecesCon(direccion): number`, `llamadas: string[]`;
    `COORDENADA_FALSA = { lat: 32.5251, lng: -117.0213 }`; `esperarHasta<T>(leer, listo, ms = 3000): Promise<T>`;
    `pausa(ms): Promise<void>` (los usa también la Tarea 5).

- [ ] **Paso 1: la regla de "¿geocodificar al guardar?" (prueba que falla)**

Agrega al final de `apps/backend/src/modules/cartera-clientes/ubicacion-origen.spec.ts` (y suma
`pideGeocodificarAlGuardar` al import de arriba):

```ts
describe('pideGeocodificarAlGuardar (T-72, D5)', () => {
  const SIN = { domicilio: 'Av. Revolución 1234', lat: null };

  it('un alta con domicilio y sin coordenada si', () => {
    expect(pideGeocodificarAlGuardar(undefined, SIN)).toBe(true);
  });

  it('una edicion que cambio el domicilio, sin coordenada, si', () => {
    expect(pideGeocodificarAlGuardar('Calle vieja 1', SIN)).toBe(true);
    expect(pideGeocodificarAlGuardar(null, SIN)).toBe(true);
  });

  it('una edicion que no cambio el domicilio no (solo espacios no es un cambio)', () => {
    expect(pideGeocodificarAlGuardar('Av. Revolución 1234', SIN)).toBe(false);
    expect(pideGeocodificarAlGuardar('  Av. Revolución 1234 ', SIN)).toBe(false);
  });

  it('con coordenada nunca', () => {
    expect(
      pideGeocodificarAlGuardar(undefined, { domicilio: 'Calle 1', lat: 32.5 }),
    ).toBe(false);
    expect(
      pideGeocodificarAlGuardar('Otra', { domicilio: 'Calle 1', lat: 32.5 }),
    ).toBe(false);
  });

  it('sin domicilio nunca', () => {
    expect(
      pideGeocodificarAlGuardar(undefined, { domicilio: null, lat: null }),
    ).toBe(false);
    expect(
      pideGeocodificarAlGuardar('Calle 1', { domicilio: '  ', lat: null }),
    ).toBe(false);
  });
});
```

Run: `npm test --workspace=apps/backend -- ubicacion-origen` → FAIL (`pideGeocodificarAlGuardar` no existe).

- [ ] **Paso 2: implementarla**

Al final de `apps/backend/src/modules/cartera-clientes/ubicacion-origen.ts`:

```ts
/**
 * ¿Intentar geocodificar despues de guardar desde el portal? (T-72, D5)
 *
 * Solo si el cliente quedo con domicilio, sin coordenada, y el domicilio es
 * nuevo (un alta, `domicilioAntes === undefined`) o cambio. Reintentar el mismo
 * domicilio en cada guardado gastaria una consulta por edicion para obtener la
 * misma respuesta; para eso esta el boton "Ubicar con la dirección".
 */
export function pideGeocodificarAlGuardar(
  domicilioAntes: string | null | undefined,
  guardado: { domicilio: string | null; lat: number | null },
): boolean {
  const despues = guardado.domicilio?.trim() ?? '';
  if (despues === '' || guardado.lat !== null) return false;
  if (domicilioAntes === undefined) return true;
  return (domicilioAntes?.trim() ?? '') !== despues;
}
```

Run: `npm test --workspace=apps/backend -- ubicacion-origen` → PASS.

- [ ] **Paso 3: el falso de los e2e**

`apps/backend/test/apoyo-geocodificador.ts`:

```ts
import type {
  Geocodificador,
  ResultadoGeocodificacion,
} from '../src/modules/integraciones/geocodificacion/geocodificador';

/** Lo que responde el falso cuando no se le dijo otra cosa. */
export const COORDENADA_FALSA = { lat: 32.5251, lng: -117.0213 } as const;

/**
 * Geocodificador de los e2e (T-72): **ninguna prueba llama a Google**. Se
 * inyecta con `.overrideProvider(GEOCODIFICADOR).useValue(falso)`.
 *
 * Responde por direccion: cada prueba usa direcciones unicas, asi que un intento
 * en segundo plano de otra prueba no le roba la respuesta. Anota cada llamada.
 */
export class GeocodificadorDePrueba implements Geocodificador {
  readonly llamadas: string[] = [];
  private readonly respuestas = new Map<
    string,
    { resultado: ResultadoGeocodificacion; demoraMs: number }
  >();

  responder(
    direccion: string,
    resultado: ResultadoGeocodificacion,
    demoraMs = 0,
  ): void {
    this.respuestas.set(direccion, { resultado, demoraMs });
  }

  vecesCon(direccion: string): number {
    return this.llamadas.filter((d) => d === direccion).length;
  }

  geocodificar(direccion: string): Promise<ResultadoGeocodificacion> {
    this.llamadas.push(direccion);
    const r = this.respuestas.get(direccion);
    const resultado: ResultadoGeocodificacion = r?.resultado ?? {
      estado: 'ok',
      ...COORDENADA_FALSA,
    };
    return new Promise((resolver) =>
      setTimeout(() => resolver(resultado), r?.demoraMs ?? 0),
    );
  }
}

export const pausa = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Lee hasta que `listo` se cumpla o pasen `ms` (el intento corre en segundo
 * plano). Devuelve la ultima lectura: la prueba afirma sobre ella.
 */
export async function esperarHasta<T>(
  leer: () => Promise<T>,
  listo: (valor: T) => boolean,
  ms = 3_000,
): Promise<T> {
  const limite = Date.now() + ms;
  for (;;) {
    const valor = await leer();
    if (listo(valor) || Date.now() >= limite) return valor;
    await pausa(50);
  }
}
```

- [ ] **Paso 4: el e2e del portal (falla)**

`apps/backend/test/ubicacion-clientes.e2e-spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import { ClientesRepository } from './../src/modules/cartera-clientes/clientes.repository';
import { MOTIVOS_UBICAR } from './../src/modules/cartera-clientes/ubicacion-clientes.service';
import {
  GEOCODIFICADOR,
  type ResultadoGeocodificacion,
} from './../src/modules/integraciones/geocodificacion/geocodificador';
import {
  COORDENADA_FALSA,
  GeocodificadorDePrueba,
  esperarHasta,
  pausa,
} from './apoyo-geocodificador';

/**
 * T-72 (D3, D5) desde el portal: el boton "Ubicar con la dirección", el intento
 * al guardar y el origen de la coordenada. Con un geocodificador FALSO: ninguna
 * prueba llama a Google.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_GENERAL = `e2e-ubi-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-ubi-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-ubi-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-ubi-${SUFIJO}`;

interface FilaUbicacion {
  domicilio: string | null;
  lat: string | null;
  lng: string | null;
  ubicacion_origen: string | null;
  updated_at: Date;
}

describe('Ubicación de clientes desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const falso = new GeocodificadorDePrueba();
  const usuarioIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let listaId: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let consecutivo = 0;

  /** Una direccion que ninguna otra prueba usa. */
  const direccion = (nombre: string) => `${PREFIJO} ${nombre} ${++consecutivo}`;

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<void> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', perfil)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({
        login,
        nombre: login,
        password_hash: hash,
        perfil_id: perfilId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
  };

  /** Un cliente sembrado por debajo de la API (no dispara intentos). */
  const sembrar = async ({
    domicilio = direccion('Calle'),
    coordenada = null,
    sucursalId = idTijuana,
    deLaApp = false,
  }: {
    domicilio?: string | null;
    coordenada?: { lat: number; lng: number; origen: string } | null;
    sucursalId?: string;
    deLaApp?: boolean;
  } = {}): Promise<string> => {
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${PREFIJO} cliente ${++consecutivo}`,
        domicilio,
        encargado: 'Encargado de prueba',
        telefono: '000',
        factura: false,
        tipo: deLaApp ? 'prospecto' : 'cliente',
        lista_precio_id: deLaApp ? null : listaId,
        lat: coordenada?.lat.toString() ?? null,
        lng: coordenada?.lng.toString() ?? null,
        ubicacion_origen: coordenada?.origen ?? null,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const fila = (id: string): Promise<FilaUbicacion> =>
    db
      .selectFrom('cliente')
      .select(['domicilio', 'lat', 'lng', 'ubicacion_origen', 'updated_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const ubicar = (id: string, cookie = cookieGeneral) =>
    request(app.getHttpServer())
      .post(`/clientes/${id}/ubicar`)
      .set('Cookie', cookie);

  /** El cuerpo completo que manda el formulario al editar. */
  const edicion = (domicilio: string, extra: Record<string, unknown> = {}) => ({
    nombre: `${PREFIJO} editado`,
    domicilio,
    telefono: '000',
    factura: false,
    listaPrecioId: listaId,
    overridesPrecio: [],
    vigenteDesde: '2026-10-19',
    ...extra,
  });

  const editar = (id: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/clientes/${id}`)
      .set('Cookie', cookieGeneral)
      .send(cuerpo)
      .expect(200);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GEOCODIFICADOR)
      .useValue(falso)
      .compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idTijuana = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    idMexicali = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;
    listaId = (
      await db
        .selectFrom('lista_precio')
        .select('id')
        .where('nombre', '=', 'Lista 1')
        .executeTakeFirstOrThrow()
    ).id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    // Que ningun intento en segundo plano escriba despues del borrado.
    await pausa(300);
    await db
      .deleteFrom('cliente')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  describe('POST /clientes/:id/ubicar', () => {
    it('200: guarda la coordenada de Google, con su origen, y toca updated_at', async () => {
      const id = await sembrar();
      const antes = await fila(id);

      const res = await ubicar(id).expect(200);

      expect(res.body).toEqual({
        lat: COORDENADA_FALSA.lat,
        lng: COORDENADA_FALSA.lng,
        ubicacionOrigen: 'geocodificada',
      });
      const despues = await fila(id);
      expect(Number(despues.lat)).toBe(COORDENADA_FALSA.lat);
      expect(Number(despues.lng)).toBe(COORDENADA_FALSA.lng);
      expect(despues.ubicacion_origen).toBe('geocodificada');
      expect(despues.updated_at.getTime()).toBeGreaterThan(
        antes.updated_at.getTime(),
      );
      // La ficha del portal ve el origen.
      const ficha = await request(app.getHttpServer())
        .get(`/clientes/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((ficha.body as { ubicacionOrigen: string }).ubicacionOrigen).toBe(
        'geocodificada',
      );
    });

    it('409 si no tiene domicilio (un prospecto de la app sin direccion)', async () => {
      const id = await sembrar({ domicilio: null, deLaApp: true });
      const res = await ubicar(id).expect(409);
      expect((res.body as { message: string }).message).toBe(
        MOTIVOS_UBICAR.sinDomicilio,
      );
    });

    it('409 si ya tiene coordenada, sin llamar a Google', async () => {
      const domicilio = direccion('Con coordenada');
      const id = await sembrar({
        domicilio,
        coordenada: { lat: 32.5, lng: -117, origen: 'manual' },
      });
      const res = await ubicar(id).expect(409);
      expect((res.body as { message: string }).message).toBe(
        MOTIVOS_UBICAR.yaTiene,
      );
      expect(falso.vecesCon(domicilio)).toBe(0);
    });

    it.each<[string, ResultadoGeocodificacion, string]>([
      ['imprecisa', { estado: 'imprecisa' }, MOTIVOS_UBICAR.imprecisa],
      ['no encontrada', { estado: 'no-encontrada' }, MOTIVOS_UBICAR.noEncontrada],
      ['sin clave', { estado: 'sin-configurar' }, MOTIVOS_UBICAR.sinConfigurar],
    ])('409 %s, con su motivo y sin guardar', async (nombre, resultado, motivo) => {
      const domicilio = direccion(nombre);
      falso.responder(domicilio, resultado);
      const id = await sembrar({ domicilio });

      const res = await ubicar(id).expect(409);

      expect((res.body as { message: string }).message).toBe(motivo);
      expect((await fila(id)).lat).toBeNull();
    });

    it('502 si Google no respondio', async () => {
      const domicilio = direccion('Caido');
      falso.responder(domicilio, {
        estado: 'error',
        detalle: 'Google respondió HTTP 503.',
      });
      const id = await sembrar({ domicilio });
      const res = await ubicar(id).expect(502);
      expect((res.body as { message: string }).message).toBe(
        MOTIVOS_UBICAR.error,
      );
    });

    it('403 sin cliente.gestionar', async () => {
      const id = await sembrar();
      await ubicar(id, cookieSinPermiso).expect(403);
      expect((await fila(id)).lat).toBeNull();
    });

    it('404 para un usuario de otra sucursal', async () => {
      const id = await sembrar({ sucursalId: idMexicali });
      await ubicar(id, cookieTijuana).expect(404);
      expect((await fila(id)).lat).toBeNull();
    });

    it('404 si el cliente no existe', async () => {
      await ubicar(randomUUID()).expect(404);
    });
  });

  describe('guardar desde el portal', () => {
    it('editar el domicilio sin coordenada dispara el intento, sin esperarlo', async () => {
      const id = await sembrar();
      const nuevo = direccion('Domicilio nuevo');

      await editar(id, edicion(nuevo));

      const despues = await esperarHasta(
        () => fila(id),
        (f) => f.lat !== null,
      );
      expect(despues.ubicacion_origen).toBe('geocodificada');
      expect(falso.vecesCon(nuevo)).toBe(1);
    });

    it('guardar con el mismo domicilio no vuelve a intentar', async () => {
      const domicilio = direccion('Mismo');
      const id = await sembrar({ domicilio });
      await editar(id, edicion(domicilio));
      await pausa(300);
      expect(falso.vecesCon(domicilio)).toBe(0);
    });

    it('un alta sin coordenada dispara el intento', async () => {
      const domicilio = direccion('Alta');
      const res = await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieGeneral)
        .send({
          nombre: `${PREFIJO} alta`,
          domicilio,
          telefono: '000',
          encargado: 'Lupita',
          factura: false,
          tipo: 'cliente',
          listaPrecioId: listaId,
          overridesPrecio: [],
          vigenteDesde: '2026-10-19',
          sucursalId: idTijuana,
        })
        .expect(201);
      const id = (res.body as { id: string }).id;
      const despues = await esperarHasta(
        () => fila(id),
        (f) => f.lat !== null,
      );
      expect(despues.ubicacion_origen).toBe('geocodificada');
    });

    it('una coordenada capturada a mano queda como manual, y no se geocodifica', async () => {
      const domicilio = direccion('A mano');
      const id = await sembrar();
      await editar(id, edicion(domicilio, { lat: 32.51, lng: -117.03 }));
      const f = await fila(id);
      expect(f.ubicacion_origen).toBe('manual');
      await pausa(300);
      expect(falso.vecesCon(domicilio)).toBe(0);
    });

    it('reenviar la misma coordenada conserva el origen; cambiarla la vuelve manual; borrarla, nula', async () => {
      const domicilio = direccion('Ubicada');
      const id = await sembrar({
        domicilio,
        coordenada: { lat: 32.5251, lng: -117.0213, origen: 'geocodificada' },
      });

      await editar(id, edicion(domicilio, { lat: 32.5251, lng: -117.0213 }));
      expect((await fila(id)).ubicacion_origen).toBe('geocodificada');

      await editar(id, edicion(domicilio, { lat: 32.53, lng: -117.0213 }));
      expect((await fila(id)).ubicacion_origen).toBe('manual');

      await editar(id, edicion(domicilio));
      const f = await fila(id);
      expect(f.lat).toBeNull();
      expect(f.ubicacion_origen).toBeNull();
    });

    it('acepta un domicilio de 300 caracteres (el de la tablet) y rechaza uno de 301', async () => {
      const id = await sembrar({
        coordenada: { lat: 32.5, lng: -117, origen: 'manual' },
      });
      const largo = `${PREFIJO} `.padEnd(300, 'x');
      await editar(id, edicion(largo, { lat: 32.5, lng: -117 }));
      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieGeneral)
        .send(edicion(`${largo}x`, { lat: 32.5, lng: -117 }))
        .expect(400);
    });
  });

  describe('ClientesRepository.guardarGeocodificada', () => {
    it('no pisa una coordenada que la oficina capturo mientras tanto', async () => {
      const id = await sembrar({
        coordenada: { lat: 32.5, lng: -117, origen: 'manual' },
      });
      const repo = app.get(ClientesRepository);

      await expect(
        repo.guardarGeocodificada(id, 32.6, -117.1),
      ).resolves.toBe(false);

      const f = await fila(id);
      expect(Number(f.lat)).toBe(32.5);
      expect(f.ubicacion_origen).toBe('manual');
    });
  });
});
```

Run: `npm run test:e2e --workspace=apps/backend -- ubicacion-clientes` → FAIL: los casos de `/ubicar` responden 404
(la ruta no existe todavía), los de "guardar" no ven coordenada y el de 300 caracteres da 400.

- [ ] **Paso 5: `ClientesService` dispara el intento después de guardar**

En `apps/backend/src/modules/cartera-clientes/clientes.service.ts`:

1. Imports: cambia `import { origenAlGuardar } from './ubicacion-origen';` por
   `import { origenAlGuardar, pideGeocodificarAlGuardar } from './ubicacion-origen';` y agrega
   `import { UbicacionClientesService } from './ubicacion-clientes.service';`

2. Constructor:

```ts
  constructor(
    private readonly repo: ClientesRepository,
    // T-72: el intento de geocodificar despues de guardar (sin esperarlo).
    private readonly ubicacion: UbicacionClientesService,
  ) {}
```

3. En `crear`, reemplaza el bloque `try { return await this.repo.crear(...); } catch (error) { ... }` (desde
   `try {` hasta el cierre del `catch`) por esto; el objeto de datos, los overrides y `dto.vigenteDesde` quedan
   **idénticos** a como los dejó la Tarea 1:

```ts
    let creado: ClienteDetalle;
    try {
      creado = await this.repo.crear(
        {
          nombre: dto.nombre,
          domicilio: dto.domicilio,
          telefono: dto.telefono,
          encargado: dto.encargado,
          factura: dto.factura,
          tipo: dto.tipo,
          tipo_negocio_id: dto.tipoNegocioId ?? null,
          lista_precio_id: dto.listaPrecioId,
          pct_comision: dto.pctComision ?? null,
          plazo_credito_dias: dto.plazoCreditoDias ?? null,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          // T-72 (D3): un alta del portal con coordenada la capturo la oficina.
          ubicacion_origen: origenAlGuardar(
            { lat: dto.lat ?? null, lng: dto.lng ?? null },
            null,
          ),
          comentarios: dto.comentarios ?? null,
          sucursal_id: sucursalId,
          altaUsuarioId: usuarioId,
        },
        // En el alta, un override con `precio: null` no tiene nada que
        // limpiar (no hay fila previa) -- se descarta antes de llegar al
        // repositorio.
        overridesUnicos.filter(
          (o): o is { presentacionId: string; precio: number } =>
            o.precio !== null,
        ),
        dto.vigenteDesde,
      );
    } catch (error) {
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }

    // T-72 (D5): despues de la transaccion del alta y SIN esperar a Google; el
    // resultado se ve al recargar la ficha.
    if (pideGeocodificarAlGuardar(undefined, creado)) {
      void this.ubicacion.geocodificarEnSegundoPlano(creado.id);
    }
    return creado;
```

4. En `editar`, reemplaza igual el `try { return await this.repo.actualizar(...); } catch ...`:

```ts
    let editado: ClienteDetalle;
    try {
      editado = await this.repo.actualizar(
        id,
        {
          nombre: dto.nombre,
          domicilio: dto.domicilio,
          telefono: dto.telefono,
          // Omitirlo conserva el actual (T-69): no se borra ni bloquea clientes viejos.
          encargado: dto.encargado ?? cliente.encargado,
          factura: dto.factura,
          tipo_negocio_id: dto.tipoNegocioId ?? null,
          lista_precio_id: dto.listaPrecioId,
          pct_comision: dto.pctComision ?? null,
          plazo_credito_dias: dto.plazoCreditoDias ?? null,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          // T-72 (D3): la misma coordenada conserva su origen; otra es 'manual'.
          ubicacion_origen: origenAlGuardar(
            { lat: dto.lat ?? null, lng: dto.lng ?? null },
            cliente,
          ),
          comentarios: dto.comentarios ?? null,
        },
        dto.overridesPrecio,
        dto.vigenteDesde,
      );
    } catch (error) {
      if (esViolacionFk(error)) {
        throw new NotFoundException('Alguno de los datos enviados no existe.');
      }
      throw error;
    }

    // T-72 (D5): solo si el domicilio cambio y no hay coordenada.
    if (pideGeocodificarAlGuardar(cliente.domicilio, editado)) {
      void this.ubicacion.geocodificarEnSegundoPlano(id);
    }
    return editado;
```

5. En `apps/backend/src/modules/cartera-clientes/crear-prospecto.spec.ts`, en `montar`, cambia la construcción del
   servicio (el prospecto no usa el intento del portal):

```ts
  const ubicacion = { geocodificarEnSegundoPlano: jest.fn() };
  const servicio = new ClientesService(
    repo as unknown as ClientesRepository,
    ubicacion as unknown as UbicacionClientesService,
  );
```

   con el import `import type { UbicacionClientesService } from './ubicacion-clientes.service';`.

- [ ] **Paso 6: el endpoint y los DTO**

En `apps/backend/src/modules/cartera-clientes/clientes.controller.ts`:

1. Agrega `HttpCode` al import de `@nestjs/common` y
   `import { UbicacionClientesService, type UbicacionGeocodificada } from './ubicacion-clientes.service';`
2. Constructor: después de `private readonly fotos: FotosService,` agrega

```ts
    // T-72: "Ubicar con la dirección" (espera a Google, como mucho 5 s).
    private readonly ubicacion: UbicacionClientesService,
```

3. Después del handler `convertirACliente`:

```ts
  /**
   * "Ubicar con la dirección" (T-72, D5): geocodifica el domicilio guardado y,
   * si Google da una coordenada precisa, la anota con origen `geocodificada`.
   *
   * A diferencia del intento en segundo plano, **espera** (Google tiene 5 s) y
   * responde el resultado: 200 con la coordenada, 409 con el motivo en espanol
   * o 502 si Google no respondio. `cliente.gestionar`, como editar la ficha;
   * otra sucursal es 404. 200 y no 201: no crea nada.
   */
  @Post(':id/ubicar')
  @HttpCode(200)
  @RequierePermiso('cliente.gestionar')
  async ubicar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UbicacionGeocodificada> {
    return this.ubicacion.ubicar(usuarioId, id);
  }
```

En `dto/crear-cliente.dto.ts` y `dto/editar-cliente.dto.ts`, el `@MaxLength` de `domicilio` pasa de 200 a 300 (el de
la tablet, D1), en los dos:

```ts
  // T-72: 300, igual que la "Dirección del negocio" de la tablet; con 200 un
  // prospecto que llego de la app no se podria volver a guardar.
  @MaxLength(300, { message: 'El domicilio no puede pasar de 300 caracteres.' })
  domicilio!: string;
```

Run: `npm run test:e2e --workspace=apps/backend -- ubicacion-clientes` → PASS.

- [ ] **Paso 7: verificar y commit**

```bash
npm test --workspace=apps/backend -- cartera-clientes
npm run build --workspace=apps/backend
npm exec --workspace=apps/backend -- prettier --write src/modules/cartera-clientes/ubicacion-origen.ts src/modules/cartera-clientes/ubicacion-origen.spec.ts src/modules/cartera-clientes/clientes.service.ts src/modules/cartera-clientes/crear-prospecto.spec.ts src/modules/cartera-clientes/clientes.controller.ts src/modules/cartera-clientes/dto/crear-cliente.dto.ts src/modules/cartera-clientes/dto/editar-cliente.dto.ts test/apoyo-geocodificador.ts test/ubicacion-clientes.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/cartera-clientes/ubicacion-origen.ts src/modules/cartera-clientes/ubicacion-origen.spec.ts src/modules/cartera-clientes/clientes.service.ts src/modules/cartera-clientes/crear-prospecto.spec.ts src/modules/cartera-clientes/clientes.controller.ts src/modules/cartera-clientes/dto/crear-cliente.dto.ts src/modules/cartera-clientes/dto/editar-cliente.dto.ts test/apoyo-geocodificador.ts test/ubicacion-clientes.e2e-spec.ts
npm run test:e2e --workspace=apps/backend -- ubicacion-clientes clientes foto-prospecto
git add apps/backend/src/modules/cartera-clientes apps/backend/test/apoyo-geocodificador.ts apps/backend/test/ubicacion-clientes.e2e-spec.ts
git commit -m "T-72: POST /clientes/:id/ubicar y geocodificación al guardar desde el portal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 5: Push y pull: `domicilio` en el prospecto, intento después del commit y `ubicacion_origen` (D2, D3, D5)

**Files:**
- Modify: `apps/backend/src/modules/cartera-clientes/datos-prospecto.ts` (`ProspectoNormalizado`, constante y
  normalización)
- Modify: `apps/backend/src/modules/cartera-clientes/datos-prospecto.spec.ts` (dos `toEqual` + casos nuevos)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.repository.ts` (`insertarProspecto`)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.service.ts` (`crearProspecto`)
- Modify: `apps/backend/src/modules/cartera-clientes/crear-prospecto.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/despacho-prospecto.ts` (+ `pideGeocodificacion`)
- Modify: `apps/backend/src/modules/sincronizacion/despacho-prospecto.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (constructor y `aplicar`)
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` (`clientes`)
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts` (`DatosProspecto`, `ClientePull`)
- Modify: `apps/tablet/src/sincronizacion/contrato.ts` (`DatosProspecto`, `ClientePull`)
- Modify: `docs/contrato-sincronizacion.md` (§5 y §6)
- Create: `apps/backend/test/geocodificacion-sync.e2e-spec.ts`

**Interfaces:**
- Consumes: `UbicacionClientesService.geocodificarEnSegundoPlano` (Tarea 3, exportado por `CarteraClientesModule`);
  `GeocodificadorDePrueba`, `COORDENADA_FALSA`, `esperarHasta`, `pausa` (Tarea 4); `GEOCODIFICADOR` (Tarea 2).
- Produces:
  - `ProspectoNormalizado.domicilio: string | null`; `LARGO_MAX_DOMICILIO = 300` (backend)
  - `insertarProspecto(datos: { …; domicilio: string | null; … }, trx)`
  - `pideGeocodificacion(prospecto: ProspectoNormalizado): boolean`
  - Cable: `DatosProspecto.domicilio?: string | null` (las dos copias); backend
    `ClientePull.ubicacion_origen: 'gps' | 'geocodificada' | 'manual' | null`; tablet
    `ClientePull.ubicacion_origen?: 'gps' | 'geocodificada' | 'manual' | null` (opcional: un servidor anterior no la
    manda). La Tarea 7 consume estos dos de la tablet.

- [ ] **Paso 1: la forma de `domicilio` (pruebas que fallan)**

En `apps/backend/src/modules/cartera-clientes/datos-prospecto.spec.ts`:

1. En los dos `toEqual` de "lo minimo: nombre, telefono y encargado" y "normaliza los siete campos…", agrega
   `domicilio: null,` después de `comentarios`.
2. Al final del `describe('normalizarDatosProspecto', …)`, antes de su `});`:

```ts
  describe('domicilio (T-72, D2)', () => {
    it('se recorta y viaja', () => {
      expect(
        bueno({ ...minimo, domicilio: '  Av. Revolución 1234, Zona Centro  ' })
          .domicilio,
      ).toBe('Av. Revolución 1234, Zona Centro');
    });

    it('ausente, null y vacio son null: una tablet anterior no lo manda', () => {
      for (const domicilio of [undefined, null, '', '   ']) {
        expect(bueno({ ...minimo, domicilio }).domicilio).toBeNull();
      }
    });

    it('acepta 300 caracteres y rechaza 301 con un motivo que lo dice', () => {
      expect(bueno({ ...minimo, domicilio: 'x'.repeat(300) }).domicilio).toHaveLength(
        300,
      );
      const r = normalizarDatosProspecto({
        ...minimo,
        domicilio: 'x'.repeat(301),
      });
      expect(r).toEqual({
        ok: false,
        campo: 'domicilio',
        motivo: 'domicilio: no puede pasar de 300 caracteres.',
      });
    });

    it('un tipo que no es texto se rechaza en vez de convertirse', () => {
      malo({ ...minimo, domicilio: 1234 }, 'domicilio');
    });
  });
```

Run: `npm test --workspace=apps/backend -- datos-prospecto` → FAIL (falta `domicilio` en el resultado).

- [ ] **Paso 2: normalizar `domicilio`**

En `apps/backend/src/modules/cartera-clientes/datos-prospecto.ts`:

1. En `interface ProspectoNormalizado`, después de `comentarios: string | null;`:

```ts
  /**
   * T-72 (D2): "Dirección del negocio" que escribio el vendedor, o `null`.
   * Se guarda en `cliente.domicilio`; sin `lat`/`lng`, el servidor la
   * geocodifica despues del commit. Que sea obligatoria sin GPS lo exige la
   * tablet (`validarAltaProspecto`): aqui solo se valida la forma.
   */
  domicilio: string | null;
```

2. Después de `export const LARGO_MAX_COMENTARIO = 500;`:

```ts
/** T-72: el mismo tope que la tablet (`LARGO_MAX_DOMICILIO` de `prospectos.ts`). */
export const LARGO_MAX_DOMICILIO = 300;
```

3. En `normalizarDatosProspecto`, después de `if (!comentarios.ok) return comentarios.error;`:

```ts
  // T-72 (D2): opcional en el cable; una tablet anterior no la manda.
  const domicilio = opcional('domicilio', datos.domicilio, LARGO_MAX_DOMICILIO);
  if (!domicilio.ok) return domicilio.error;
```

4. En el objeto `prospecto` del `return` final, después de `comentarios: comentarios.valor,`:
   `domicilio: domicilio.valor,`

Run: `npm test --workspace=apps/backend -- datos-prospecto` → PASS.

- [ ] **Paso 3: `crearProspecto` guarda el domicilio (prueba que falla)**

En `apps/backend/src/modules/cartera-clientes/crear-prospecto.spec.ts`:

1. En el fixture `prospecto(...)`, después de `comentarios: 'Quiere probar jamaica',`: `domicilio: null,`
2. En la primera prueba ("inserta el prospecto en la sucursal del vendedor…"), en el objeto esperado de
   `insertarProspecto`, después de `comentarios: 'Quiere probar jamaica',`: `domicilio: null,`
3. Prueba nueva, después de "sin ubicacion se guarda igual…":

```ts
  it('guarda la direccion que escribio el vendedor (T-72, D2)', async () => {
    const { servicio, repo } = montar();

    await servicio.crearProspecto(
      prospecto({ domicilio: 'Av. Revolución 1234', lat: null, lng: null }),
      contexto(),
      trx,
    );

    expect(repo.insertarProspecto).toHaveBeenCalledWith(
      expect.objectContaining({
        domicilio: 'Av. Revolución 1234',
        lat: null,
        lng: null,
      }),
      trx,
    );
  });
```

Run: `npm test --workspace=apps/backend -- crear-prospecto` → FAIL (`insertarProspecto` no recibe `domicilio`).

- [ ] **Paso 4: el repositorio y el servicio**

En `clientes.repository.ts`, `insertarProspecto`:

1. En el tipo de `datos`, después de `comentarios: string | null;`: `domicilio: string | null;`
2. En `.values({...})`, cambia `domicilio: null,` por:

```ts
        // T-72 (D2): la direccion que escribio el vendedor, o null.
        domicilio: datos.domicilio,
```

3. En el comentario del método, cambia "Sin `domicilio`, sin `lista_precio_id`…" por "Sin `lista_precio_id`…" y
   agrega: "El `domicilio` llega desde T-72 cuando el vendedor lo escribió (obligatorio en la tablet sin GPS)."

En `clientes.service.ts`, `crearProspecto`, en el objeto que se pasa a `insertarProspecto`, después de
`comentarios: prospecto.comentarios,`: `domicilio: prospecto.domicilio,`

Run: `npm test --workspace=apps/backend -- crear-prospecto` → PASS.

- [ ] **Paso 5: `pideGeocodificacion` (prueba que falla)**

Al final de `apps/backend/src/modules/sincronizacion/despacho-prospecto.spec.ts` (suma `pideGeocodificacion` al
import de `./despacho-prospecto`):

```ts
describe('pideGeocodificacion (T-72, D5)', () => {
  const normalizado = (datos: Record<string, unknown>) => {
    const r = prepararProspecto(
      operacion({
        datos: {
          nombre: 'Tacos Aaron',
          telefono: '6641112233',
          encargado: 'Don Aaron',
          ...datos,
        },
      }),
    );
    if (!r.ok) throw new Error(r.motivo);
    return r.prospecto;
  };

  it('con direccion y sin GPS si', () => {
    expect(
      pideGeocodificacion(
        normalizado({ domicilio: 'Av. Revolución 1234', lat: null, lng: null }),
      ),
    ).toBe(true);
  });

  it('con GPS no, aunque traiga direccion: gana la coordenada del GPS', () => {
    expect(
      pideGeocodificacion(
        normalizado({
          domicilio: 'Av. Revolución 1234',
          lat: 32.5149,
          lng: -117.0382,
        }),
      ),
    ).toBe(false);
  });

  it('sin direccion no (una tablet anterior)', () => {
    expect(pideGeocodificacion(normalizado({ lat: null, lng: null }))).toBe(
      false,
    );
  });
});
```

Run: `npm test --workspace=apps/backend -- despacho-prospecto` → FAIL.

Al final de `apps/backend/src/modules/sincronizacion/despacho-prospecto.ts`:

```ts
/**
 * ¿El servidor intenta geocodificar este alta despues del commit? (T-72, D5)
 *
 * Solo con direccion y sin GPS: con coordenada del GPS no hay nada que
 * calcular, y sin direccion no hay con que.
 */
export function pideGeocodificacion(prospecto: ProspectoNormalizado): boolean {
  return prospecto.domicilio !== null && prospecto.lat === null;
}
```

Run: `npm test --workspace=apps/backend -- despacho-prospecto` → PASS.

- [ ] **Paso 6: el intento después del commit, en `SincronizacionService`**

En `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`:

1. Imports: `import { UbicacionClientesService } from '../cartera-clientes/ubicacion-clientes.service';` y cambia
   `import { CODIGO_POR_RAZON_PROSPECTO } from './despacho-prospecto';` por
   `import { CODIGO_POR_RAZON_PROSPECTO, pideGeocodificacion } from './despacho-prospecto';`
2. Constructor, después de `private readonly visitas: VisitasService,`:

```ts
    // T-72: geocodificar el domicilio de un prospecto sin GPS, DESPUES del commit.
    private readonly ubicacion: UbicacionClientesService,
```

3. En `aplicar`, dentro del `try`, entre el cierre de `await reintentarAnteConflicto(...)` y el `return {` que arma
   el resultado, inserta:

```ts
      // T-72 (D5): aqui la transaccion ya hizo commit (`enTransaccion` resolvio)
      // y el intento se dispara SIN esperarlo: el push no espera a Google. Solo
      // un alta recien aplicada; un reenvio `duplicada` no repite el intento, y
      // una rechazada nunca llega a esta linea (sale por el `catch`).
      if (
        !guardado.duplicada &&
        proyeccion?.tipo === 'prospecto' &&
        pideGeocodificacion(proyeccion.prospecto)
      ) {
        // T-75: la clave del prospecto ES el id del cliente.
        void this.ubicacion.geocodificarEnSegundoPlano(op.clave);
      }
```

- [ ] **Paso 7: el pull baja `ubicacion_origen`**

En `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts`, método `clientes`:

1. En el `.select([...])`, después de `'lng',`: `'ubicacion_origen',`
2. En el `map`, después de `lng: aNumero(f.lng),`:

```ts
      // T-72 (D3): de donde salio la coordenada. La tablet la guarda.
      ubicacion_origen: f.ubicacion_origen as ClientePull['ubicacion_origen'],
```

- [ ] **Paso 8: el contrato (las dos copias) y el documento, en el mismo commit**

**`apps/backend/src/modules/sincronizacion/contrato.ts`:**

1. En el comentario de `DatosProspecto`, borra la viñeta de "Lo que NO viaja":

```
 * - **`domicilio`**: no se captura. Lo sustituye la ubicacion, y en Postgres la
 *   columna dejo de ser obligatoria para un prospecto.
```

2. En `DatosProspecto`, después de `comentarios: string | null;`:

```ts
  /**
   * T-72 (D2): la direccion del negocio que escribio el vendedor. Hasta 300
   * caracteres; se recorta y un texto vacio cuenta como `null`. La tablet la
   * exige cuando no hay GPS; el servidor solo valida la forma (mas de 300 o no
   * texto = `datos-invalidos`, motivo `domicilio: …`). Se guarda en
   * `cliente.domicilio` y, sin `lat`/`lng`, el servidor la geocodifica despues
   * del commit, sin que el push espere.
   *
   * Opcional: una tablet anterior no la manda. Aditivo, `CONTRATO_ACTUAL` sigue
   * en 1.
   */
  domicilio?: string | null;
```

3. En `ClientePull`, después de `lng: number | null;`:

```ts
  /**
   * T-72 (D3): de donde salio la coordenada: `'gps'` (la tablet al dar de alta
   * el prospecto), `'geocodificada'` (el servidor, con Google) o `'manual'` (la
   * oficina en el portal); `null` sin coordenada. Cuando el servidor geocodifica
   * le toca `updated_at`, asi que coordenada y origen bajan solos en el pull
   * incremental. Aditivo: una tablet anterior lo ignora.
   */
  ubicacion_origen: 'gps' | 'geocodificada' | 'manual' | null;
```

**`apps/tablet/src/sincronizacion/contrato.ts`:**

1. En el comentario de `DatosProspecto`, borra la misma viñeta de `domicilio` (mismo texto).
2. En `DatosProspecto`, después de `comentarios: string | null;`:

```ts
  /**
   * T-72 (D2): "Dirección del negocio", hasta 300. Obligatoria al capturar sin
   * GPS (`validarAltaProspecto`); el servidor la geocodifica despues del commit.
   * Opcional en el cable.
   */
  domicilio?: string | null;
```

3. En `ClientePull`, después de `lng: number | null;`:

```ts
  /**
   * T-72 (D3). **Opcional en la copia de la tablet**: un servidor anterior no lo
   * manda (`aSnapshot` lo vuelve `null`). Se guarda; aun no se muestra.
   */
  ubicacion_origen?: 'gps' | 'geocodificada' | 'manual' | null;
```

**`docs/contrato-sincronizacion.md`:**

1. §5, ejemplo de `clientes`: cambia `"lat": 32.5149, "lng": -117.0382, "sucursal_id": "…",` por
   `"lat": 32.5149, "lng": -117.0382, "ubicacion_origen": "manual", "sucursal_id": "…",`
2. §5, después de la sección "`foto_subida_en` del cliente (T-39)" y antes de "La baja viaja como bandera, nunca como
   ausencia", agrega una sección de tercer nivel titulada `` `ubicacion_origen` del cliente (T-72) `` con este cuerpo:

```text
Campo **nuevo** y aditivo en `clientes`: de dónde salió la coordenada actual. `"gps"` (la tablet al dar de alta el
prospecto), `"geocodificada"` (el servidor, con Google, a partir del domicilio) o `"manual"` (la oficina en el
portal); `null` cuando no hay coordenada (la base exige nulo si y solo si `lat` es nula). Las coordenadas anteriores
a T-72 bajan como `"manual"`.

Cuando el servidor geocodifica un prospecto después de su alta, le toca `updated_at`: la coordenada y
`"geocodificada"` bajan solas en el siguiente pull incremental. La tablet guarda el campo y todavía no lo muestra.
```

3. §6, ejemplo JSON del prospecto: después de la línea de `"comentarios"` agrega
   `    "domicilio": "Av. Revolución 1234, Zona Centro",  // T-72: hasta 300; null o ausente si no hay`
4. §6, en "Lo que **no** viaja", borra la viñeta de `domicilio` ("no se captura. Lo sustituye la ubicación…", dos
   líneas) y, después de la lista, agrega:

```text
> [!info] T-72: `domicilio` sí viaja, opcional
> La "Dirección del negocio" que escribió el vendedor, recortada y de hasta 300 caracteres (vacía = `null`). La
> tablet la exige cuando no hay GPS; el servidor solo valida la forma y la guarda en `cliente.domicilio`. Si el alta
> llega **sin** `lat`/`lng` y **con** `domicilio`, el servidor la geocodifica **después del commit** y sin que el push
> espere (un reenvío `duplicada` o un alta rechazada no disparan nada). Una tablet anterior no la manda y no pasa
> nada: `CONTRATO_ACTUAL` sigue en 1.
```

5. §6, "Cinco reglas que se rechazan **por operación**" pasa a "Seis reglas…", y la tabla gana la fila:
   `| Un \`domicilio\` de más de 300 caracteres, o que no es texto | El motivo empieza por \`domicilio:\` y dice el tope (T-72) |`

- [ ] **Paso 9: el e2e del push y del pull**

`apps/backend/test/geocodificacion-sync.e2e-spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import { GEOCODIFICADOR } from './../src/modules/integraciones/geocodificacion/geocodificador';
import {
  CONTRATO_ACTUAL,
  type RespuestaPull,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';
import {
  COORDENADA_FALSA,
  GeocodificadorDePrueba,
  esperarHasta,
  pausa,
} from './apoyo-geocodificador';

/**
 * T-72 (D2, D3, D5) por el cable: el alta de prospecto con `domicilio` y sin
 * GPS se geocodifica DESPUES del commit, sin que el push espere, y la
 * coordenada baja en el pull. Geocodificador FALSO: ninguna prueba llama a
 * Google.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-geo-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-geo-${SUFIJO}`;
const FECHA = '2026-10-19';

interface FilaCliente {
  domicilio: string | null;
  lat: string | null;
  lng: string | null;
  ubicacion_origen: string | null;
}

describe('Geocodificación de prospectos por el push (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const falso = new GeocodificadorDePrueba();
  let vendedorId: string;
  let tipoNegocioBorradoId: string;
  let bearer: string;
  let consecutivo = 0;

  const direccion = (nombre: string) => `${PREFIJO} ${nombre} ${++consecutivo}`;

  const push = async (operaciones: unknown[]): Promise<RespuestaPush> => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const pull = async (): Promise<RespuestaPull> => {
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?contrato=${CONTRATO_ACTUAL}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return res.body as RespuestaPull;
  };

  /** Un alta de prospecto; `datos` pisa los de por defecto. */
  const alta = (datos: Record<string, unknown> = {}) => ({
    clave: randomUUID(),
    tipo: 'prospecto',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:03:22.000Z`,
    datos: {
      nombre: `${PREFIJO} prospecto ${++consecutivo}`,
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipo_negocio_id: null,
      comentarios: null,
      lat: null,
      lng: null,
      foto: null,
      ...datos,
    },
  });

  const fila = (id: string): Promise<FilaCliente> =>
    db
      .selectFrom('cliente')
      .select(['domicilio', 'lat', 'lng', 'ubicacion_origen'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GEOCODIFICADOR)
      .useValue(falso)
      .compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const sucursal = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'TJ')
      .executeTakeFirstOrThrow();
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor geocodificacion',
          password_hash: await new PasswordService().hashear(PASSWORD),
          sucursal_id: sucursal.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    tipoNegocioBorradoId = (
      await db
        .insertInto('tipo_negocio')
        .values({ nombre: `${PREFIJO} Ciber`, deleted_at: new Date() })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const login = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;
  });

  afterAll(async () => {
    // Que ningun intento en segundo plano escriba despues del borrado.
    await pausa(300);
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('cliente')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('tipo_negocio')
      .where('id', '=', tipoNegocioBorradoId)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await app.close();
  });

  it('con domicilio y sin GPS: se guarda la direccion, se geocodifica y el pull la baja', async () => {
    const domicilio = direccion('Av. Revolución');
    const op = alta({ domicilio: `  ${domicilio}  ` });

    const r = await push([op]);
    expect(r.resultados[0]).toMatchObject({ estado: 'aplicada' });

    const f = await esperarHasta(
      () => fila(op.clave),
      (x) => x.lat !== null,
    );
    expect(f.domicilio).toBe(domicilio);
    expect(Number(f.lat)).toBe(COORDENADA_FALSA.lat);
    expect(Number(f.lng)).toBe(COORDENADA_FALSA.lng);
    expect(f.ubicacion_origen).toBe('geocodificada');
    expect(falso.vecesCon(domicilio)).toBe(1);

    const cliente = (await pull()).catalogos.clientes.find(
      (c) => c.id === op.clave,
    );
    expect(cliente).toMatchObject({
      domicilio,
      lat: COORDENADA_FALSA.lat,
      lng: COORDENADA_FALSA.lng,
      ubicacion_origen: 'geocodificada',
    });
  });

  it('el push responde sin esperar a Google', async () => {
    const domicilio = direccion('Calle lenta');
    falso.responder(domicilio, { estado: 'ok', ...COORDENADA_FALSA }, 1_500);
    const op = alta({ domicilio });

    const inicio = Date.now();
    const r = await push([op]);

    expect(Date.now() - inicio).toBeLessThan(1_000);
    expect(r.resultados[0]).toMatchObject({ estado: 'aplicada' });
    expect((await fila(op.clave)).lat).toBeNull();
    const despues = await esperarHasta(
      () => fila(op.clave),
      (x) => x.lat !== null,
    );
    expect(despues.ubicacion_origen).toBe('geocodificada');
  });

  it('con GPS no se llama al geocodificador y el origen es gps', async () => {
    const domicilio = direccion('Con GPS');
    const op = alta({ domicilio, lat: 32.5149, lng: -117.0382 });

    await push([op]);
    await pausa(300);

    const f = await fila(op.clave);
    expect(f.domicilio).toBe(domicilio);
    expect(f.ubicacion_origen).toBe('gps');
    expect(falso.vecesCon(domicilio)).toBe(0);
    const cliente = (await pull()).catalogos.clientes.find(
      (c) => c.id === op.clave,
    );
    expect(cliente?.ubicacion_origen).toBe('gps');
  });

  it('un reenvio duplicada no vuelve a intentar', async () => {
    const domicilio = direccion('Reenviada');
    const op = alta({ domicilio });
    await push([op]);
    await esperarHasta(
      () => fila(op.clave),
      (x) => x.lat !== null,
    );

    const r = await push([op]);
    await pausa(300);

    expect(r.resultados[0]).toMatchObject({ estado: 'duplicada' });
    expect(falso.vecesCon(domicilio)).toBe(1);
  });

  it('un alta rechazada no dispara intento', async () => {
    const domicilio = direccion('Rechazada');
    const op = alta({ domicilio, tipo_negocio_id: tipoNegocioBorradoId });

    const r = await push([op]);
    await pausa(300);

    expect(r.resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'tipo-negocio-inexistente',
    });
    expect(falso.vecesCon(domicilio)).toBe(0);
  });

  it('un domicilio de 301 caracteres es datos-invalidos con su motivo', async () => {
    const op = alta({ domicilio: 'x'.repeat(301) });
    const r = await push([op]);
    expect(r.resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'datos-invalidos',
      motivo: 'domicilio: no puede pasar de 300 caracteres.',
    });
  });

  it('una tablet anterior que no manda domicilio entra igual, sin intento', async () => {
    const op = alta();
    delete (op.datos as Record<string, unknown>).domicilio;
    const antes = falso.llamadas.length;

    const r = await push([op]);
    await pausa(300);

    expect(r.resultados[0]).toMatchObject({ estado: 'aplicada' });
    const f = await fila(op.clave);
    expect(f.domicilio).toBeNull();
    expect(f.lat).toBeNull();
    expect(f.ubicacion_origen).toBeNull();
    expect(falso.llamadas.length).toBe(antes);
  });
});
```

Run: `npm run test:e2e --workspace=apps/backend -- geocodificacion-sync` → PASS. (Con el Paso 6 deshecho, el primer
caso se queda sin coordenada: la prueba mide el intento.)

- [ ] **Paso 10: verificar y commit**

```bash
npm test --workspace=apps/backend -- cartera-clientes sincronizacion
npm run build --workspace=apps/backend
npm run typecheck --workspace=apps/tablet
npm exec --workspace=apps/backend -- prettier --write src/modules/cartera-clientes/datos-prospecto.ts src/modules/cartera-clientes/datos-prospecto.spec.ts src/modules/cartera-clientes/clientes.repository.ts src/modules/cartera-clientes/clientes.service.ts src/modules/cartera-clientes/crear-prospecto.spec.ts src/modules/sincronizacion/despacho-prospecto.ts src/modules/sincronizacion/despacho-prospecto.spec.ts src/modules/sincronizacion/sincronizacion.service.ts src/modules/sincronizacion/sincronizacion.repository.ts src/modules/sincronizacion/contrato.ts test/geocodificacion-sync.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/cartera-clientes/datos-prospecto.ts src/modules/cartera-clientes/datos-prospecto.spec.ts src/modules/cartera-clientes/clientes.repository.ts src/modules/cartera-clientes/clientes.service.ts src/modules/cartera-clientes/crear-prospecto.spec.ts src/modules/sincronizacion/despacho-prospecto.ts src/modules/sincronizacion/despacho-prospecto.spec.ts src/modules/sincronizacion/sincronizacion.service.ts src/modules/sincronizacion/sincronizacion.repository.ts src/modules/sincronizacion/contrato.ts test/geocodificacion-sync.e2e-spec.ts
npm run lint --workspace=apps/tablet
npm run test:e2e --workspace=apps/backend -- geocodificacion-sync prospectos prospecto-venta sincronizacion
git add apps/backend/src/modules/cartera-clientes apps/backend/src/modules/sincronizacion apps/backend/test/geocodificacion-sync.e2e-spec.ts apps/tablet/src/sincronizacion/contrato.ts docs/contrato-sincronizacion.md
git commit -m "T-72: domicilio en el alta de prospecto, geocodificación después del commit y ubicacion_origen en el pull

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: Portal: origen de la ubicación y "Ubicar con la dirección" en la ficha (D6)

**Files:**
- Modify: `apps/portal/src/lib/clientes.ts` (`OrigenUbicacion`, `ClienteDetalle.ubicacionOrigen`,
  `UbicacionGeocodificada`, `ubicarCliente`)
- Create: `apps/portal/src/lib/ubicacion-cliente.ts`
- Create: `apps/portal/src/lib/ubicacion-cliente.test.ts`
- Modify: `apps/portal/src/components/clientes/formulario-cliente.tsx`
- Modify: `apps/portal/src/components/clientes/pantalla-clientes.test.tsx` (fixture + `describe` nuevo al final)

**Interfaces:**
- Consumes: `POST /clientes/:id/ubicar` y `ClienteDetalle.ubicacionOrigen` del backend (Tareas 1 y 4); `ErrorApi`,
  `mensajeDe` de `lib/api.ts`.
- Produces: `type OrigenUbicacion = "gps" | "geocodificada" | "manual"`; `ubicarCliente(id: string): Promise<UbicacionGeocodificada>`;
  `etiquetaOrigenUbicacion(latTexto: string, lngTexto: string, referencia: UbicacionReferencia): string`;
  `muestraBotonUbicar(latTexto: string, lngTexto: string, domicilioGuardado: string | null): boolean`.

> Las reglas puras van en `lib/ubicacion-cliente.ts` y **no** en `lib/clientes.ts`: las pruebas de pantalla hacen
> `vi.mock("@/lib/clientes")`, que reemplaza todo lo que exporta ese archivo por funciones vacías.

- [ ] **Paso 1: las reglas puras (prueba que falla)**

`apps/portal/src/lib/ubicacion-cliente.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { etiquetaOrigenUbicacion, muestraBotonUbicar } from "./ubicacion-cliente";

const GOOGLE = { lat: 32.5251, lng: -117.0213, origen: "geocodificada" as const };
const NADA = { lat: null, lng: null, origen: null };

describe("etiquetaOrigenUbicacion (T-72, D6)", () => {
  it("sin coordenada en los campos: Sin ubicación", () => {
    expect(etiquetaOrigenUbicacion("", " ", GOOGLE)).toBe("Sin ubicación");
    expect(etiquetaOrigenUbicacion("", "", NADA)).toBe("Sin ubicación");
  });

  it("la coordenada guardada dice su origen", () => {
    expect(etiquetaOrigenUbicacion("32.5251", "-117.0213", GOOGLE)).toBe("Ubicada por Google");
    expect(
      etiquetaOrigenUbicacion("32.5149", "-117.0382", { lat: 32.5149, lng: -117.0382, origen: "gps" }),
    ).toBe("GPS de la tablet");
    expect(
      etiquetaOrigenUbicacion("32.5", "-117", { lat: 32.5, lng: -117, origen: "manual" }),
    ).toBe("Capturada a mano");
  });

  it("una coordenada distinta de la guardada es una captura a mano", () => {
    expect(etiquetaOrigenUbicacion("32.53", "-117.0213", GOOGLE)).toBe("Capturada a mano");
    expect(etiquetaOrigenUbicacion("32.5", "-117", NADA)).toBe("Capturada a mano");
  });
});

describe("muestraBotonUbicar (T-72, D6)", () => {
  it("sin coordenada y con domicilio, sí", () => {
    expect(muestraBotonUbicar("", "", "Av. Revolución 1234")).toBe(true);
  });

  it("con coordenada o sin domicilio, no", () => {
    expect(muestraBotonUbicar("32.5", "-117", "Av. Revolución 1234")).toBe(false);
    expect(muestraBotonUbicar("", "", null)).toBe(false);
    expect(muestraBotonUbicar("", "", "   ")).toBe(false);
  });
});
```

Run: `npm test --workspace=apps/portal -- ubicacion-cliente` → FAIL ("Failed to resolve import").

- [ ] **Paso 2: el cliente de la API y las reglas**

En `apps/portal/src/lib/clientes.ts`:

1. Después de `export type TipoFiltro = TipoCliente | "todos";`:

```ts
/** De dónde salió la coordenada (T-72, D3). */
export type OrigenUbicacion = "gps" | "geocodificada" | "manual";
```

2. En `interface ClienteDetalle`, después de `lng: number | null;`:

```ts
  /** De dónde salió la coordenada (T-72): `null` si no hay. */
  ubicacionOrigen: OrigenUbicacion | null;
```

3. Al final del archivo:

```ts
/** Lo que responde "Ubicar con la dirección" cuando Google encontró el domicilio. */
export interface UbicacionGeocodificada {
  lat: number;
  lng: number;
  ubicacionOrigen: "geocodificada";
}

/**
 * "Ubicar con la dirección" (T-72, D5): el servidor geocodifica el domicilio
 * guardado y espera a Google (como mucho 5 s). Un 409 o un 502 llega como
 * `ErrorApi` con el motivo en español en `mensajeApi`.
 */
export function ubicarCliente(id: string): Promise<UbicacionGeocodificada> {
  return apiFetch<UbicacionGeocodificada>(`/clientes/${id}/ubicar`, {
    method: "POST",
  });
}
```

`apps/portal/src/lib/ubicacion-cliente.ts`:

```ts
import type { OrigenUbicacion } from "./clientes";

/** Las etiquetas del spec (D6), exactas. */
const TEXTO_ORIGEN: Record<OrigenUbicacion, string> = {
  gps: "GPS de la tablet",
  geocodificada: "Ubicada por Google",
  manual: "Capturada a mano",
};

/** La coordenada guardada (o la que acaba de dar Google) y su origen. */
export interface UbicacionReferencia {
  lat: number | null;
  lng: number | null;
  origen: OrigenUbicacion | null;
}

/**
 * La etiqueta junto a Latitud y Longitud (T-72, D6).
 *
 * Mira los CAMPOS del formulario, no solo lo guardado: si la oficina cambia la
 * coordenada, lo que se va a guardar es una captura a mano, y el servidor la
 * marcará así (`origenAlGuardar`). Si los campos siguen igual que la
 * referencia, conserva su origen.
 */
export function etiquetaOrigenUbicacion(
  latTexto: string,
  lngTexto: string,
  referencia: UbicacionReferencia,
): string {
  if (latTexto.trim() === "" && lngTexto.trim() === "") return "Sin ubicación";
  const igual =
    referencia.origen !== null &&
    referencia.lat === Number(latTexto) &&
    referencia.lng === Number(lngTexto);
  return igual && referencia.origen !== null
    ? TEXTO_ORIGEN[referencia.origen]
    : TEXTO_ORIGEN.manual;
}

/**
 * El botón "Ubicar con la dirección" aparece si no hay coordenada y el cliente
 * tiene domicilio GUARDADO (es el que geocodifica el servidor).
 */
export function muestraBotonUbicar(
  latTexto: string,
  lngTexto: string,
  domicilioGuardado: string | null,
): boolean {
  return (
    latTexto.trim() === "" &&
    lngTexto.trim() === "" &&
    (domicilioGuardado ?? "").trim() !== ""
  );
}
```

Run: `npm test --workspace=apps/portal -- ubicacion-cliente` → PASS.

- [ ] **Paso 3: las pruebas de pantalla que fallan**

En `apps/portal/src/components/clientes/pantalla-clientes.test.tsx`:

1. En el fixture `DETALLE`, después de `lng: null,`: `ubicacionOrigen: null,`
2. Con los demás `vi.mocked`: `const ubicarCliente = vi.mocked(clientesLib.ubicarCliente);`
3. Al final del archivo:

```tsx
describe("PantallaClientes · ubicación (T-72, D6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tiposNegocioLib.listarTiposNegocio).mockResolvedValue([]);
    vi.mocked(productosLib.listarProductos).mockResolvedValue([]);
    vi.mocked(preciosLib.listarListasPrecio).mockResolvedValue([
      { id: "lista-1", nombre: "Lista 1" },
    ]);
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([]);
    vi.mocked(promocionesLib.listarPromociones).mockResolvedValue([]);
  });

  /** Abre la edición del cliente con este detalle y espera al formulario. */
  async function abrirEdicion(detalle: ClienteDetalle) {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    listarClientes.mockResolvedValue([RESUMEN]);
    obtenerCliente.mockResolvedValue(detalle);
    render(<PantallaClientes sucursal={null} tipo="todos" />);
    await screen.findByText("Abarrotes Lupita");
    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    await screen.findByLabelText("Latitud");
    return usuario;
  }

  const UBICAR = { name: "Ubicar con la dirección" };

  it.each<[NonNullable<ClienteDetalle["ubicacionOrigen"]>, string]>([
    ["gps", "GPS de la tablet"],
    ["geocodificada", "Ubicada por Google"],
    ["manual", "Capturada a mano"],
  ])("con origen %s dice «%s» y no ofrece ubicar", async (origen, texto) => {
    await abrirEdicion({ ...DETALLE, lat: 32.5251, lng: -117.0213, ubicacionOrigen: origen });
    expect(screen.getByText(`Origen de la ubicación: ${texto}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", UBICAR)).not.toBeInTheDocument();
  });

  it("sin coordenada y con domicilio: «Sin ubicación», y el botón pinta la coordenada de Google", async () => {
    ubicarCliente.mockResolvedValue({ lat: 32.5251, lng: -117.0213, ubicacionOrigen: "geocodificada" });
    const usuario = await abrirEdicion(DETALLE);
    expect(screen.getByText("Origen de la ubicación: Sin ubicación")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", UBICAR));

    expect(await screen.findByText("Origen de la ubicación: Ubicada por Google")).toBeInTheDocument();
    expect(ubicarCliente).toHaveBeenCalledWith("1");
    expect((screen.getByLabelText("Latitud") as HTMLInputElement).value).toBe("32.5251");
    expect((screen.getByLabelText("Longitud") as HTMLInputElement).value).toBe("-117.0213");
    expect(screen.queryByRole("button", UBICAR)).not.toBeInTheDocument();
  });

  it.each([
    [409, "El cliente no tiene domicilio."],
    [409, "Ya tiene ubicación; bórrala primero para volver a ubicarlo."],
    [409, "Google solo encontró la colonia o la ciudad: agrega calle y número."],
    [409, "Google no encontró esa dirección."],
    [409, "Falta configurar la clave de Google en el servidor."],
    [502, "Google no respondió; intenta en un momento."],
  ])("un %i pinta «%s» y deja la ubicación vacía", async (status, motivo) => {
    ubicarCliente.mockRejectedValue(new ErrorApi("Error de la API", status, motivo));
    const usuario = await abrirEdicion(DETALLE);

    await usuario.click(screen.getByRole("button", UBICAR));

    expect(await screen.findByText(motivo)).toBeInTheDocument();
    expect((screen.getByLabelText("Latitud") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", UBICAR)).toBeEnabled();
  });

  it("mientras espera a Google el botón dice «Ubicando…» y no se puede repetir", async () => {
    let responder: (r: clientesLib.UbicacionGeocodificada) => void = () => {};
    ubicarCliente.mockReturnValue(
      new Promise((resolver) => {
        responder = resolver;
      }),
    );
    const usuario = await abrirEdicion(DETALLE);

    await usuario.click(screen.getByRole("button", UBICAR));

    expect(screen.getByRole("button", { name: "Ubicando…" })).toBeDisabled();
    responder({ lat: 32.5251, lng: -117.0213, ubicacionOrigen: "geocodificada" });
    expect(await screen.findByText("Origen de la ubicación: Ubicada por Google")).toBeInTheDocument();
  });

  it("un prospecto sin domicilio no ofrece ubicar", async () => {
    await abrirEdicion({ ...DETALLE, tipo: "prospecto", domicilio: null, listaPrecioId: null });
    expect(screen.queryByRole("button", UBICAR)).not.toBeInTheDocument();
  });

  it("cambiar a mano una coordenada de Google la marca «Capturada a mano»", async () => {
    const usuario = await abrirEdicion({
      ...DETALLE,
      lat: 32.5251,
      lng: -117.0213,
      ubicacionOrigen: "geocodificada",
    });
    const latitud = screen.getByLabelText("Latitud");
    await usuario.clear(latitud);
    await usuario.type(latitud, "32.53");
    expect(screen.getByText("Origen de la ubicación: Capturada a mano")).toBeInTheDocument();
  });
});
```

Run: `npm test --workspace=apps/portal -- pantalla-clientes` → FAIL (no existe el texto "Origen de la ubicación: …").

- [ ] **Paso 4: el formulario**

En `apps/portal/src/components/clientes/formulario-cliente.tsx`:

1. Imports: agrega `ubicarCliente` al import de `@/lib/clientes`, y

```tsx
import { mensajeDe } from "@/lib/api";
import {
  etiquetaOrigenUbicacion,
  muestraBotonUbicar,
  type UbicacionReferencia,
} from "@/lib/ubicacion-cliente";
```

2. Después de `const [lng, setLng] = useState(cliente?.lng?.toString() ?? "");`:

```tsx
  // T-72 (D6): la coordenada guardada (o la que acaba de dar Google) y su
  // origen. La etiqueta compara los campos contra esto.
  const [referencia, setReferencia] = useState<UbicacionReferencia>({
    lat: cliente?.lat ?? null,
    lng: cliente?.lng ?? null,
    origen: cliente?.ubicacionOrigen ?? null,
  });
  const [ubicando, setUbicando] = useState(false);
  const [avisoUbicar, setAvisoUbicar] = useState<string | null>(null);
```

3. Después de la función `cambiarOverride`:

```tsx
  /**
   * "Ubicar con la dirección" (T-72, D5): el servidor espera a Google (≤ 5 s).
   * Con éxito, la coordenada ya quedó guardada: se pinta en los campos y en la
   * referencia, así que la etiqueta dice "Ubicada por Google" y guardar después
   * no la vuelve "a mano". Un 409/502 trae el motivo en español.
   */
  async function ubicarConDireccion() {
    if (!cliente) return;
    setAvisoUbicar(null);
    setUbicando(true);
    try {
      const r = await ubicarCliente(cliente.id);
      setLat(r.lat.toString());
      setLng(r.lng.toString());
      setReferencia({ lat: r.lat, lng: r.lng, origen: r.ubicacionOrigen });
    } catch (err) {
      setAvisoUbicar(mensajeDe(err, "No se pudo ubicar al cliente."));
    } finally {
      setUbicando(false);
    }
  }
```

4. En el `<input id="domicilio" …>`, `maxLength={200}` pasa a `maxLength={300}` (T-72: el mismo tope que la tablet y el
   backend).

5. En el `<fieldset>` "Ubicación y notas", entre el `<div className="flex flex-wrap gap-4">` de Latitud/Longitud y el
   `<div>` de Comentarios:

```tsx
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Origen de la ubicación: {etiquetaOrigenUbicacion(lat, lng, referencia)}
          </p>
          {!esAlta && muestraBotonUbicar(lat, lng, cliente.domicilio) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={enviando || ubicando}
              onClick={ubicarConDireccion}
            >
              {ubicando ? "Ubicando…" : "Ubicar con la dirección"}
            </Button>
          )}
        </div>
        {avisoUbicar && (
          <p role="status" className="text-sm text-destructive">
            {avisoUbicar}
          </p>
        )}
```

Run: `npm test --workspace=apps/portal -- pantalla-clientes ubicacion-cliente` → PASS.

- [ ] **Paso 5: verificar y commit**

```bash
npm test --workspace=apps/portal -- clientes ubicacion-cliente
npx tsc --noEmit -p apps/portal
npm run lint --workspace=apps/portal
git add apps/portal/src/lib/clientes.ts apps/portal/src/lib/ubicacion-cliente.ts apps/portal/src/lib/ubicacion-cliente.test.ts apps/portal/src/components/clientes/formulario-cliente.tsx apps/portal/src/components/clientes/pantalla-clientes.test.tsx
git commit -m "T-72: portal: origen de la ubicación y botón Ubicar con la dirección

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 7: Tablet: migración 014, `domicilio` en el alta y en su espejo, y `ubicacion_origen` del pull (D1, D2, D3)

**Files:**
- Create: `apps/tablet/src/datos/migraciones/014-prospecto-domicilio.ts`
- Create: `apps/tablet/src/datos/migraciones/014-prospecto-domicilio.spec.ts`
- Modify: `apps/tablet/src/datos/migraciones/index.ts`
- Modify: `apps/tablet/src/datos/migraciones/013-visitas.spec.ts:51-56` (deja de afirmar que es la última)
- Modify: `apps/tablet/src/datos/tipos.ts` (`OrigenUbicacion`, `Cliente.ubicacion_origen`, `Prospecto.domicilio`)
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts` (`SnapshotCatalogos.clientes`, `COLUMNAS.cliente`)
- Modify: `apps/tablet/src/datos/repositorios/catalogos.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/motor.ts` (`aSnapshot`)
- Modify: `apps/tablet/src/sincronizacion/motor.spec.ts`
- Modify: `apps/tablet/src/datos/repositorios/prospectos.ts` (`DatosRegistroProspecto`, `LARGO_MAX_DOMICILIO`,
  `registrar`)
- Modify: `apps/tablet/src/datos/repositorios/prospectos.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/fuente-prospectos.ts`
- Modify: `apps/tablet/src/sincronizacion/fuente-prospectos.spec.ts`

**Interfaces:**
- Consumes: tablet `DatosProspecto.domicilio?` y `ClientePull.ubicacion_origen?` (Tarea 5).
- Produces (para las Tareas 8 y 9):
  - `type OrigenUbicacion = 'gps' | 'geocodificada' | 'manual'`; `Cliente.ubicacion_origen: OrigenUbicacion | null`;
    `Prospecto.domicilio: string | null`
  - `export const LARGO_MAX_DOMICILIO = 300` en `src/datos/repositorios/prospectos.ts`
  - `DatosRegistroProspecto.domicilio?: string | null` — `registrar` lo recorta, lo mide (`ErrorProspecto` si pasa de
    300) y lo guarda en `prospecto.domicilio` y en `cliente.domicilio` del espejo; el espejo guarda
    `ubicacion_origen = 'gps'` si hay `lat`.

- [ ] **Paso 1: la migración 014 (prueba que falla)**

`apps/tablet/src/datos/migraciones/014-prospecto-domicilio.spec.ts`:

```ts
import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 014 trae la direccion del negocio en el alta de prospecto y el origen de
 * la coordenada del cliente que baja en el pull (T-72).
 */

const TS = "'2026-10-19T00:00:00.000Z'";

function baseAlDia(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones);
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${TS});
  `);
  return bd;
}

function columnas(bd: BaseDatos, tabla: string): { name: string; notnull: number }[] {
  return bd.getAllSync<{ name: string; notnull: number }>(
    `select name, "notnull" from pragma_table_info('${tabla}')`,
  );
}

describe('migracion 014: prospecto-domicilio (T-72)', () => {
  it('la 014 es la ultima y deja versionEsquema en 14', () => {
    expect(migraciones[13]?.nombre).toBe('prospecto-domicilio');
    expect(migraciones[13]?.version).toBe(14);
    expect(migraciones).toHaveLength(14);
    expect(versionEsquema(baseAlDia())).toBe(14);
  });

  it('prospecto gana domicilio, nulable (las filas anteriores no lo tienen)', () => {
    expect(columnas(baseAlDia(), 'prospecto')).toContainEqual({ name: 'domicilio', notnull: 0 });
  });

  it('cliente gana ubicacion_origen, nulable', () => {
    expect(columnas(baseAlDia(), 'cliente')).toContainEqual({ name: 'ubicacion_origen', notnull: 0 });
  });

  it('ubicacion_origen no tiene check: un valor nuevo del servidor no tumba el pull', () => {
    const bd = baseAlDia();
    expect(() =>
      bd.runSync(
        `insert into cliente (id, nombre, domicilio, telefono, tipo, sucursal_id, activo, sincronizado_en, ubicacion_origen)
         values ('cli-1', 'Abarrotes', 'Calle 5', '664', 'cliente', 'suc-tj', 1, ${TS}, 'otro-origen')`,
      ),
    ).not.toThrow();
  });
});
```

Run: `npm test --workspace=apps/tablet -- 014-prospecto-domicilio` → FAIL (`migraciones[13]` es `undefined`).

- [ ] **Paso 2: la migración**

`apps/tablet/src/datos/migraciones/014-prospecto-domicilio.ts`:

```ts
import type { Migracion } from './motor';

/**
 * Prospecto con direccion y origen de la coordenada (T-72).
 *
 * - `prospecto.domicilio`: la "Dirección del negocio" del alta (D1). Obligatoria
 *   sin GPS, pero la regla vive en `validarAltaProspecto`, no en la tabla: las
 *   filas capturadas antes de esta version no la tienen.
 * - `cliente.ubicacion_origen`: baja en el pull (`'gps'`, `'geocodificada'`,
 *   `'manual'` o null). Se guarda y todavia no se muestra (fuera de alcance).
 *   **Sin check** a proposito: si el servidor agrega un origen, un check aqui
 *   haria fallar el upsert del snapshot entero.
 */
export const prospectoDomicilio: Migracion = {
  version: 14,
  nombre: 'prospecto-domicilio',
  sql: `
    alter table prospecto add column domicilio text;
    alter table cliente add column ubicacion_origen text;
  `,
};
```

En `apps/tablet/src/datos/migraciones/index.ts`: `import { prospectoDomicilio } from './014-prospecto-domicilio';`
después del import de `./013-visitas`, y `prospectoDomicilio,` después de `visitas,` en el arreglo.

En `apps/tablet/src/datos/migraciones/013-visitas.spec.ts`, la primera prueba deja de afirmar que es la última (mismo
cambio que hizo la 012 cuando llegó la 013):

```ts
  it('la 013 es visitas y deja de ser la ultima con la 014 (T-72)', () => {
    expect(migraciones[12]?.nombre).toBe('visitas');
    expect(migraciones[12]?.version).toBe(13);
    expect(versionEsquema(baseAlDia())).toBe(migraciones.length);
  });
```

Run: `npm test --workspace=apps/tablet -- migraciones` → PASS.

- [ ] **Paso 3: tipos**

En `apps/tablet/src/datos/tipos.ts`:

1. Antes de `export interface Cliente {`:

```ts
/** De donde salio la coordenada del cliente (T-72, D3). Baja en el pull; la tablet aun no la muestra. */
export type OrigenUbicacion = 'gps' | 'geocodificada' | 'manual';
```

2. En `interface Cliente`, después de `foto_cache_subida_en: MomentoISO | null;`:

```ts
  /**
   * T-72 (D3): de donde salio la coordenada, tal como baja en el pull. `null`
   * sin coordenada o con un servidor anterior. El espejo local de un prospecto
   * con GPS nace en `'gps'`.
   */
  ubicacion_origen: OrigenUbicacion | null;
```

3. En `interface Prospecto`, después de `lng: number | null;`:

```ts
  /**
   * T-72 (D1): la "Dirección del negocio". Obligatoria al capturar sin GPS
   * (`validarAltaProspecto`); `null` con GPS si no se escribio, y en filas
   * anteriores a la migracion 014.
   */
  domicilio: string | null;
```

- [ ] **Paso 4: el pull guarda `ubicacion_origen` (pruebas que fallan)**

Al final de `apps/tablet/src/datos/repositorios/catalogos.spec.ts`:

```ts
describe('origen de la ubicacion del cliente (T-72, D3)', () => {
  it('el pull lo guarda', () => {
    const { catalogos } = conCatalogos();
    const base = snapshotDePrueba().clientes![0]!;
    catalogos.guardarSnapshot({ clientes: [{ ...base, ubicacion_origen: 'geocodificada' }] });
    expect(catalogos.obtenerCliente('cli-1')?.ubicacion_origen).toBe('geocodificada');
  });

  it('un servidor anterior a T-72 no lo manda: queda null', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.obtenerCliente('cli-1')?.ubicacion_origen).toBeNull();
  });
});
```

En `apps/tablet/src/sincronizacion/motor.spec.ts`, después del `describe('aSnapshot (T-37)', …)`:

```ts
describe('aSnapshot (T-72)', () => {
  it('pasa ubicacion_origen y tolera un servidor que todavia no lo manda', () => {
    const respuesta = respuestaPullDePrueba();
    respuesta.catalogos.clientes[0] = { ...respuesta.catalogos.clientes[0]!, ubicacion_origen: 'gps' };
    expect(aSnapshot(respuesta).clientes?.map((c) => c.ubicacion_origen)).toEqual(['gps', null]);
  });
});
```

Run: `npm test --workspace=apps/tablet -- catalogos motor` → FAIL (la columna no se escribe y `aSnapshot` no la pasa).

- [ ] **Paso 5: `catalogos.ts` y `aSnapshot`**

En `apps/tablet/src/datos/repositorios/catalogos.ts`:

1. `SnapshotCatalogos.clientes` (también opcional `ubicacion_origen`, como `foto_subida_en`):

```ts
  /**
   * `foto_subida_en` (T-39) y `ubicacion_origen` (T-72) son opcionales aqui (un
   * servidor anterior no los manda; el upsert escribe `null`) y
   * `foto_cache_subida_en` no viene nunca del pull.
   */
  clientes?: (Omit<
    Cliente,
    'sincronizado_en' | 'foto_subida_en' | 'foto_cache_subida_en' | 'ubicacion_origen'
  > &
    Partial<Pick<Cliente, 'foto_subida_en' | 'ubicacion_origen'>>)[];
```

2. En `COLUMNAS.cliente`, después de `'foto_subida_en',`:

```ts
    // T-72 (D3): de donde salio la coordenada. Se guarda; aun no se muestra.
    'ubicacion_origen',
```

En `apps/tablet/src/sincronizacion/motor.ts`, en `aSnapshot`, dentro de `clientes: c.clientes.map((cliente) => ({`,
después de `foto_subida_en: cliente.foto_subida_en ?? null,`:

```ts
      // T-72: un servidor anterior no lo manda.
      ubicacion_origen: cliente.ubicacion_origen ?? null,
```

Run: `npm test --workspace=apps/tablet -- catalogos motor` → PASS.

- [ ] **Paso 6: el alta guarda la dirección (pruebas que fallan)**

En `apps/tablet/src/datos/repositorios/prospectos.spec.ts`, dentro de `describe('registrar', …)`, después del
`describe('ubicacion', …)`:

```ts
    describe('direccion del negocio (T-72, D1)', () => {
      it('se guarda recortada en el prospecto y en su espejo de cliente', () => {
        const { prospectos, catalogos } = montar();

        const p = prospectos.registrar(
          captura({ lat: null, lng: null, domicilio: '  Av. Revolución 1234, Zona Centro  ' }),
        );

        expect(p.domicilio).toBe('Av. Revolución 1234, Zona Centro');
        expect(catalogos.obtenerCliente(p.id)).toMatchObject({
          domicilio: 'Av. Revolución 1234, Zona Centro',
          lat: null,
          lng: null,
          ubicacion_origen: null,
        });
      });

      it('vacia o ausente se guarda como null', () => {
        const { prospectos } = montar();
        expect(prospectos.registrar(captura({ domicilio: '   ' })).domicilio).toBeNull();
        expect(prospectos.registrar(captura()).domicilio).toBeNull();
      });

      it('con GPS el espejo dice que la coordenada salio del GPS', () => {
        const { prospectos, catalogos } = montar();
        const p = prospectos.registrar(captura());
        expect(catalogos.obtenerCliente(p.id)?.ubicacion_origen).toBe('gps');
      });

      it('tiene el mismo tope que el servidor: 300', () => {
        const { prospectos } = montar();
        expect(prospectos.registrar(captura({ domicilio: 'x'.repeat(300) })).domicilio).toHaveLength(300);
        expect(() => prospectos.registrar(captura({ domicilio: 'x'.repeat(301) }))).toThrow(
          new ErrorProspecto('La dirección no puede pasar de 300 caracteres.'),
        );
      });
    });
```

En `apps/tablet/src/sincronizacion/fuente-prospectos.spec.ts`:

1. En la prueba "arma el sobre con la clave, la fecha local y los datos", en `datos`, después de
   `comentarios: 'Quiere probar jamaica',`: `domicilio: null,`
2. Prueba nueva al final del `describe`:

```ts
  it('manda la direccion del negocio (T-72, D2)', () => {
    const { prospectos, fuente } = montar();
    prospectos.registrar(captura({ lat: null, lng: null, domicilio: 'Av. Revolución 1234' }));

    expect(fuente.pendientes()[0]?.datos).toMatchObject({
      domicilio: 'Av. Revolución 1234',
      lat: null,
      lng: null,
    });
  });
```

Run: `npm test --workspace=apps/tablet -- prospectos fuente-prospectos` → FAIL.

- [ ] **Paso 7: el repositorio y la fuente del push**

En `apps/tablet/src/datos/repositorios/prospectos.ts`:

1. En `interface DatosRegistroProspecto`, después de `lng: number | null;`:

```ts
  /**
   * T-72 (D1): "Dirección del negocio", hasta 300. Cuando es obligatoria (sin
   * GPS) lo decide `validarAltaProspecto`; aqui solo se recorta, se mide y se
   * guarda en `prospecto` y en el espejo de `cliente`. Opcional para quien no la
   * pasa (pruebas y capturas anteriores).
   */
  domicilio?: string | null;
```

2. Después de `export const LARGO_MAX_COMENTARIOS = 500;`:

```ts
/** T-72: el mismo tope que el servidor (`LARGO_MAX_DOMICILIO` de `datos-prospecto.ts`). */
export const LARGO_MAX_DOMICILIO = 300;
```

3. En `registrar`, después del bloque del comentario (`if (comentarios !== null && comentarios.length > …) { … }`):

```ts
      const domicilio = recortar(datos.domicilio ?? null);
      if (domicilio !== null && domicilio.length > LARGO_MAX_DOMICILIO) {
        throw new ErrorProspecto(
          `La dirección no puede pasar de ${LARGO_MAX_DOMICILIO} caracteres.`,
        );
      }
```

4. El `insert into prospecto` (primer `bd.runSync` dentro de `enTransaccion`) queda así; solo se suman la columna
   `domicilio` y su parámetro:

```ts
        bd.runSync(
          `insert into prospecto (
             id, fecha, vendedor_id, sucursal_id, nombre, telefono, encargado,
             tipo_negocio_id, comentarios, lat, lng, domicilio, foto_uri, grabado_en, sync_estado
           ) values (
             $id, $fecha, $vendedor_id, $sucursal_id, $nombre, $telefono, $encargado,
             $tipo_negocio_id, $comentarios, $lat, $lng, $domicilio, $foto_uri, $grabado_en, 'pendiente'
           )`,
          {
            $id: id,
            // `reloj.hoy()` es la fecha LOCAL de la tablet (Tijuana), la misma que
            // viaja como `fecha_operacion`: el servidor no la re-deriva de UTC.
            $fecha: reloj.hoy(),
            $vendedor_id: datos.vendedorId,
            $sucursal_id: datos.sucursalId,
            $nombre: nombre,
            $telefono: telefono,
            $encargado: encargado,
            $tipo_negocio_id: datos.tipoNegocioId,
            $comentarios: comentarios,
            $lat: datos.lat,
            $lng: datos.lng,
            // T-72 (D1): la direccion que escribio, o null.
            $domicilio: domicilio,
            // La foto, si la hubo. No se valida nada de ella aqui a proposito:
            // todo lo que podia fallar (permiso, camara, compresion, tamano) ya
            // fallo antes de llegar, y en ese caso esto vale `null`. Este `insert`
            // **no puede** tener una forma de fracasar por la foto.
            $foto_uri: datos.fotoUri ?? null,
            $grabado_en: ahora,
          },
        );
```

5. El `insert into cliente` del espejo queda así (el comentario de arriba cambia "Sin precios ni domicilio" por "Sin
   precios"):

```ts
        // T-75 (D1): el espejo local. Mismo id: el servidor lo adoptara (D2) y
        // el pull pisara esta fila por id sin duplicar. Sin precios: la venta
        // solo admite regalo y la conversion es del portal. T-72: con la
        // direccion, la ficha abre Maps por domicilio mientras no haya coordenada.
        bd.runSync(
          `insert into cliente (
             id, nombre, domicilio, telefono, encargado, tipo, pct_comision,
             plazo_credito_dias, primera_venta_en, lat, lng, ubicacion_origen,
             sucursal_id, activo, saldo_favor_centavos, sincronizado_en
           ) values (
             $id, $nombre, $domicilio, $telefono, $encargado, 'prospecto', null,
             null, null, $lat, $lng, $ubicacion_origen,
             $sucursal_id, 1, 0, $sincronizado_en
           )`,
          {
            $id: id,
            $nombre: nombre,
            $domicilio: domicilio,
            $telefono: telefono,
            $encargado: encargado,
            $lat: datos.lat,
            $lng: datos.lng,
            // T-72 (D3): la coordenada de un alta solo puede ser del GPS.
            $ubicacion_origen: datos.lat !== null ? 'gps' : null,
            $sucursal_id: datos.sucursalId,
            $sincronizado_en: ahora,
          },
        );
```

En `apps/tablet/src/sincronizacion/fuente-prospectos.ts`, en el objeto `datos`, después de `comentarios: p.comentarios,`:

```ts
          // T-72 (D2): la direccion del negocio; null si no se escribio.
          domicilio: p.domicilio,
```

Run: `npm test --workspace=apps/tablet -- prospectos fuente-prospectos` → PASS.

- [ ] **Paso 8: verificar y commit**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git add apps/tablet/src/datos apps/tablet/src/sincronizacion/motor.ts apps/tablet/src/sincronizacion/motor.spec.ts apps/tablet/src/sincronizacion/fuente-prospectos.ts apps/tablet/src/sincronizacion/fuente-prospectos.spec.ts
git commit -m "T-72: tablet: migración 014, domicilio del prospecto y ubicacion_origen del pull

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 8: Tablet: `validarAltaProspecto` y la coordenada válida compartida con la visita (D1)

**Files:**
- Create: `apps/tablet/src/estado/coordenada.ts`
- Create: `apps/tablet/src/estado/coordenada.spec.ts`
- Modify: `apps/tablet/src/estado/visita.ts` (usa `esCoordenadaValida`)
- Create: `apps/tablet/src/estado/alta-prospecto.ts`
- Create: `apps/tablet/src/estado/alta-prospecto.spec.ts`

**Interfaces:**
- Consumes: `LARGO_MAX_DOMICILIO` (Tarea 7); `type ResultadoUbicacion` de `src/ubicacion/obtener.ts` (solo el tipo).
- Produces (para la Tarea 9):
  - `esCoordenadaValida(lat: number, lng: number): boolean`
  - `type UbicacionAlta = { estado: 'sin-tomar' } | { estado: 'buscando' } | { estado: 'ok'; lat: number; lng: number } | { estado: 'fallo'; permisoNegado: boolean }`
  - `interface EntradaAltaProspecto { nombre: string; telefono: string; encargado: string; ubicacion: UbicacionAlta; domicilio: string }`
  - `interface ValidacionAltaProspecto { faltantes: string[]; domicilioObligatorio: boolean; ubicacion: { lat: number | null; lng: number | null; domicilio: string | null } | null }`
  - `validarAltaProspecto(e: EntradaAltaProspecto): ValidacionAltaProspecto`
  - `ubicacionAltaDe(r: ResultadoUbicacion): UbicacionAlta`
  - `avisoUbicacionAlta(u: UbicacionAlta): string | null`

> D1: la dirección es obligatoria **cuando no hay coordenada válida**: no se tomó (el vendedor no tocó "Usar mi
> ubicación"), el permiso se negó, se acabó el tiempo o la lectura está fuera de rango o no es finita. Esa última
> regla es la de T-39 D7 y vive **una sola vez**, en `coordenada.ts`, para que visita y alta no puedan discrepar.

- [ ] **Paso 1: la coordenada válida (prueba que falla)**

`apps/tablet/src/estado/coordenada.spec.ts`:

```ts
import { esCoordenadaValida } from './coordenada';

describe('esCoordenadaValida (T-39 D7, T-72 D1)', () => {
  it('una coordenada de Tijuana y los bordes de la Tierra son validos', () => {
    expect(esCoordenadaValida(32.5149, -117.0382)).toBe(true);
    expect(esCoordenadaValida(0, 0)).toBe(true);
    expect(esCoordenadaValida(90, 180)).toBe(true);
    expect(esCoordenadaValida(-90, -180)).toBe(true);
  });

  it.each([
    [Number.NaN, -117],
    [32.5, Number.NaN],
    [Number.POSITIVE_INFINITY, -117],
    [32.5, Number.NEGATIVE_INFINITY],
    [90.0001, -117],
    [-91, -117],
    [32.5, 180.5],
    [32.5, -181],
  ])('(%p, %p) no es valida: cuenta como sin GPS', (lat, lng) => {
    expect(esCoordenadaValida(lat, lng)).toBe(false);
  });
});
```

Run: `npm test --workspace=apps/tablet -- coordenada` → FAIL ("Cannot find module './coordenada'").

- [ ] **Paso 2: implementarla y usarla en la visita**

`apps/tablet/src/estado/coordenada.ts`:

```ts
/**
 * ¿Es una lectura del GPS que se puede guardar? (T-39 D7, T-72 D1)
 *
 * Una coordenada fuera de rango o no finita cuenta como "sin GPS": la pantalla
 * pide la direccion y se guarda con `lat`/`lng` en null. Vive aqui una sola vez
 * para que la visita y el alta de prospecto no puedan discrepar.
 */
export function esCoordenadaValida(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
```

En `apps/tablet/src/estado/visita.ts`:

1. Import: `import { esCoordenadaValida } from './coordenada';`
2. Reemplaza el bloque de `coordenadasValidas` y `gps`:

```ts
  // El repositorio no revisa el rango: lo hace esta funcion. Una coordenada invalida (NaN, fuera
  // de rango) es "sin GPS": nunca bloquea si hay direccion, y sin ella se pide como en `fallo`.
  const coordenadasValidas =
    u.estado === 'ok' &&
    Number.isFinite(u.lat) &&
    Number.isFinite(u.lng) &&
    u.lat >= -90 &&
    u.lat <= 90 &&
    u.lng >= -180 &&
    u.lng <= 180;
  const gps = u.estado === 'ok' && coordenadasValidas ? u : null;
```

   por:

```ts
  // El repositorio no revisa el rango: lo hace esta funcion. Una coordenada invalida (NaN, fuera
  // de rango) es "sin GPS": nunca bloquea si hay direccion, y sin ella se pide como en `fallo`.
  // La regla es la misma del alta de prospecto (T-72): `esCoordenadaValida`.
  const gps = u.estado === 'ok' && esCoordenadaValida(u.lat, u.lng) ? u : null;
```

Run: `npm test --workspace=apps/tablet -- coordenada visita` → PASS (las pruebas de `validarVisita` no cambian).

- [ ] **Paso 3: `validarAltaProspecto` (prueba que falla)**

`apps/tablet/src/estado/alta-prospecto.spec.ts`:

```ts
import {
  avisoUbicacionAlta,
  ubicacionAltaDe,
  validarAltaProspecto,
  type EntradaAltaProspecto,
  type UbicacionAlta,
} from './alta-prospecto';

const GPS = { estado: 'ok' as const, lat: 32.5149, lng: -117.0382 };
const SIN_GPS = 'Sin GPS: escribe la dirección del negocio.';

const entrada = (cambios: Partial<EntradaAltaProspecto> = {}): EntradaAltaProspecto => ({
  nombre: 'Tacos Aaron',
  telefono: '6641112233',
  encargado: 'Don Aaron',
  ubicacion: GPS,
  domicilio: '',
  ...cambios,
});

describe('validarAltaProspecto (T-72, D1)', () => {
  it('con GPS la direccion es opcional', () => {
    expect(validarAltaProspecto(entrada())).toEqual({
      faltantes: [],
      domicilioObligatorio: false,
      ubicacion: { lat: 32.5149, lng: -117.0382, domicilio: null },
    });
  });

  it('con GPS y direccion se guardan las dos, la direccion recortada', () => {
    expect(validarAltaProspecto(entrada({ domicilio: '  Av. Revolución 1234  ' })).ubicacion).toEqual({
      lat: 32.5149,
      lng: -117.0382,
      domicilio: 'Av. Revolución 1234',
    });
  });

  it.each<[string, UbicacionAlta]>([
    ['no se tomo', { estado: 'sin-tomar' }],
    ['permiso negado', { estado: 'fallo', permisoNegado: true }],
    ['sin senal o tiempo agotado', { estado: 'fallo', permisoNegado: false }],
  ])('sin GPS (%s) la direccion es obligatoria', (_caso, ubicacion) => {
    const sin = validarAltaProspecto(entrada({ ubicacion }));
    expect(sin.domicilioObligatorio).toBe(true);
    expect(sin.faltantes).toEqual([SIN_GPS]);
    expect(sin.ubicacion).toBeNull();

    expect(validarAltaProspecto(entrada({ ubicacion, domicilio: ' Av. Revolución 1234 ' })).ubicacion).toEqual({
      lat: null,
      lng: null,
      domicilio: 'Av. Revolución 1234',
    });
  });

  it.each([
    [Number.NaN, -117],
    [32.5, Number.POSITIVE_INFINITY],
    [91, -117],
    [32.5, -181],
  ])('una lectura invalida (%p, %p) cuenta como sin GPS y no se guarda', (lat, lng) => {
    const ubicacion: UbicacionAlta = { estado: 'ok', lat, lng };
    expect(validarAltaProspecto(entrada({ ubicacion })).faltantes).toEqual([SIN_GPS]);
    expect(validarAltaProspecto(entrada({ ubicacion })).domicilioObligatorio).toBe(true);
    expect(validarAltaProspecto(entrada({ ubicacion, domicilio: 'Calle 5' })).ubicacion).toEqual({
      lat: null,
      lng: null,
      domicilio: 'Calle 5',
    });
  });

  it('solo espacios no cuenta como direccion', () => {
    expect(validarAltaProspecto(entrada({ ubicacion: { estado: 'sin-tomar' }, domicilio: '   ' })).faltantes).toEqual([
      SIN_GPS,
    ]);
  });

  it('mientras busca la ubicacion espera, salvo que ya haya direccion', () => {
    expect(validarAltaProspecto(entrada({ ubicacion: { estado: 'buscando' } })).faltantes).toEqual([
      'Esperando la ubicación…',
    ]);
    expect(
      validarAltaProspecto(entrada({ ubicacion: { estado: 'buscando' }, domicilio: 'Calle 5' })).ubicacion,
    ).toEqual({ lat: null, lng: null, domicilio: 'Calle 5' });
  });

  it('la direccion tiene el tope del servidor: 300', () => {
    expect(validarAltaProspecto(entrada({ domicilio: 'x'.repeat(300) })).faltantes).toEqual([]);
    expect(validarAltaProspecto(entrada({ domicilio: 'x'.repeat(301) })).faltantes).toEqual([
      'La dirección no puede pasar de 300 caracteres.',
    ]);
  });

  it('nombre, telefono y encargado siguen siendo obligatorios, en el orden de la pantalla', () => {
    const r = validarAltaProspecto(
      entrada({ nombre: ' ', telefono: '', encargado: '  ', ubicacion: { estado: 'sin-tomar' } }),
    );
    expect(r.faltantes).toEqual([
      'Captura el nombre del negocio.',
      'Captura el teléfono del negocio.',
      'Captura el nombre del encargado.',
      SIN_GPS,
    ]);
    expect(r.ubicacion).toBeNull();
  });
});

describe('ubicacionAltaDe', () => {
  it('una lectura buena pasa sin la precision', () => {
    expect(ubicacionAltaDe({ estado: 'ok', lat: 32.5, lng: -117, precisionM: 12 })).toEqual({
      estado: 'ok',
      lat: 32.5,
      lng: -117,
    });
  });

  it('permiso negado y sin senal son fallos distintos', () => {
    expect(ubicacionAltaDe({ estado: 'permiso-negado' })).toEqual({ estado: 'fallo', permisoNegado: true });
    expect(ubicacionAltaDe({ estado: 'sin-senal', detalle: 'tiempo' })).toEqual({
      estado: 'fallo',
      permisoNegado: false,
    });
  });
});

describe('avisoUbicacionAlta', () => {
  it('dice que hacer en cada fallo, y nada si no hay fallo', () => {
    expect(avisoUbicacionAlta({ estado: 'fallo', permisoNegado: true })).toBe(
      'Sin permiso de ubicación. Escribe la dirección del negocio para guardarlo; la oficina lo ubicará con ella.',
    );
    expect(avisoUbicacionAlta({ estado: 'fallo', permisoNegado: false })).toBe(
      'No se pudo leer la ubicación (sin señal de GPS). Escribe la dirección del negocio o inténtalo afuera del local.',
    );
    expect(avisoUbicacionAlta({ estado: 'ok', lat: Number.NaN, lng: -117 })).toBe(
      'El GPS dio una ubicación que no sirve. Escribe la dirección del negocio o vuelve a intentarlo.',
    );
    expect(avisoUbicacionAlta(GPS)).toBeNull();
    expect(avisoUbicacionAlta({ estado: 'sin-tomar' })).toBeNull();
    expect(avisoUbicacionAlta({ estado: 'buscando' })).toBeNull();
  });
});
```

Run: `npm test --workspace=apps/tablet -- alta-prospecto` → FAIL ("Cannot find module './alta-prospecto'").

- [ ] **Paso 4: implementarla**

`apps/tablet/src/estado/alta-prospecto.ts`:

```ts
import { LARGO_MAX_DOMICILIO } from '@/datos/repositorios/prospectos';
import type { ResultadoUbicacion } from '@/ubicacion/obtener';

import { esCoordenadaValida } from './coordenada';

/**
 * Lo que decide la pantalla "Prospectos" (T-72, D1), sin React: la tablet no
 * tiene pruebas de pantalla, asi que la regla vive aqui y la pantalla solo la
 * pinta (mismo criterio que `visita.ts`).
 */

/**
 * En que va la ubicacion del alta. `sin-tomar` es el estado inicial: el
 * vendedor todavia no toco "Usar mi ubicación", y eso tambien es "sin GPS".
 */
export type UbicacionAlta =
  | { estado: 'sin-tomar' }
  | { estado: 'buscando' }
  | { estado: 'ok'; lat: number; lng: number }
  | { estado: 'fallo'; permisoNegado: boolean };

/** Lo que el vendedor lleva capturado, tal cual (los textos sin recortar). */
export interface EntradaAltaProspecto {
  nombre: string;
  telefono: string;
  encargado: string;
  ubicacion: UbicacionAlta;
  /** "Dirección del negocio". */
  domicilio: string;
}

export interface ValidacionAltaProspecto {
  /** Lo que falta, en el orden de la pantalla. Vacio = se puede guardar. */
  faltantes: string[];
  /** Sin coordenada valida, la direccion es obligatoria (D1). */
  domicilioObligatorio: boolean;
  /**
   * Lo que va a `prospectos.registrar`: la coordenada si es valida (si no,
   * null) y la direccion recortada (o null). `null` si falta algo.
   */
  ubicacion: { lat: number | null; lng: number | null; domicilio: string | null } | null;
}

function limpio(texto: string): string | null {
  const t = texto.trim();
  return t === '' ? null : t;
}

/**
 * La validacion del alta. Pura: misma entrada, misma salida. Los largos se miden con
 * `String.length`, igual que `datos-prospecto.ts` del backend.
 */
export function validarAltaProspecto(e: EntradaAltaProspecto): ValidacionAltaProspecto {
  const faltantes: string[] = [];
  const u = e.ubicacion;
  // T-39 D7 / T-72 D1: una lectura fuera de rango o no finita es "sin GPS".
  const gps = u.estado === 'ok' && esCoordenadaValida(u.lat, u.lng) ? u : null;
  const domicilio = limpio(e.domicilio);

  if (limpio(e.nombre) === null) faltantes.push('Captura el nombre del negocio.');
  if (limpio(e.telefono) === null) faltantes.push('Captura el teléfono del negocio.');
  if (limpio(e.encargado) === null) faltantes.push('Captura el nombre del encargado.');
  if (domicilio !== null && domicilio.length > LARGO_MAX_DOMICILIO) {
    faltantes.push(`La dirección no puede pasar de ${LARGO_MAX_DOMICILIO} caracteres.`);
  }
  if (gps === null && domicilio === null) {
    faltantes.push(
      u.estado === 'buscando' ? 'Esperando la ubicación…' : 'Sin GPS: escribe la dirección del negocio.',
    );
  }

  return {
    faltantes,
    domicilioObligatorio: gps === null,
    ubicacion:
      faltantes.length === 0 ? { lat: gps?.lat ?? null, lng: gps?.lng ?? null, domicilio } : null,
  };
}

/** El resultado de `obtenerUbicacion` (que nunca lanza) como estado del alta. */
export function ubicacionAltaDe(r: ResultadoUbicacion): UbicacionAlta {
  return r.estado === 'ok'
    ? { estado: 'ok', lat: r.lat, lng: r.lng }
    : { estado: 'fallo', permisoNegado: r.estado === 'permiso-negado' };
}

/** Que hacer cuando la ubicacion no sirve, en palabras del vendedor; `null` si no hay nada que decir. */
export function avisoUbicacionAlta(u: UbicacionAlta): string | null {
  if (u.estado === 'fallo') {
    return u.permisoNegado
      ? 'Sin permiso de ubicación. Escribe la dirección del negocio para guardarlo; la oficina lo ubicará con ella.'
      : 'No se pudo leer la ubicación (sin señal de GPS). Escribe la dirección del negocio o inténtalo afuera del local.';
  }
  if (u.estado === 'ok' && !esCoordenadaValida(u.lat, u.lng)) {
    return 'El GPS dio una ubicación que no sirve. Escribe la dirección del negocio o vuelve a intentarlo.';
  }
  return null;
}
```

Run: `npm test --workspace=apps/tablet -- alta-prospecto` → PASS.

- [ ] **Paso 5: verificar y commit**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git add apps/tablet/src/estado/coordenada.ts apps/tablet/src/estado/coordenada.spec.ts apps/tablet/src/estado/visita.ts apps/tablet/src/estado/alta-prospecto.ts apps/tablet/src/estado/alta-prospecto.spec.ts
git commit -m "T-72: tablet: validarAltaProspecto y coordenada válida compartida con la visita

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 9: Tablet: "Dirección del negocio" en la pantalla de Prospectos (D1)

**Files:**
- Modify: `apps/tablet/app/(jornada)/prospectos.tsx`

**Interfaces:**
- Consumes: `validarAltaProspecto`, `ubicacionAltaDe`, `avisoUbicacionAlta`, `UbicacionAlta` (Tarea 8);
  `LARGO_MAX_DOMICILIO` y `DatosRegistroProspecto.domicilio` (Tarea 7); `obtenerUbicacion` (ya existe, nunca lanza).
- Produces: nada que consuman otras tareas. La pantalla solo pinta lo que devuelve `validarAltaProspecto`.

> Sin pruebas de pantalla en la tablet (Global Constraints): todo lo decidible ya está probado en la Tarea 8. Esta
> tarea se verifica con typecheck, lint, la suite completa y la aceptación en el emulador (la hace el controlador).

- [ ] **Paso 1: imports y estado**

En `apps/tablet/app/(jornada)/prospectos.tsx`:

1. Imports nuevos (junto a los de `@/estado/...` y `@/datos/...`):

```tsx
import { LARGO_MAX_DOMICILIO } from '@/datos/repositorios/prospectos';
import {
  avisoUbicacionAlta,
  ubicacionAltaDe,
  validarAltaProspecto,
  type UbicacionAlta,
} from '@/estado/alta-prospecto';
```

2. Reemplaza los tres estados de la ubicación:

```tsx
  const [ubicacion, setUbicacion] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [avisoUbicacion, setAvisoUbicacion] = useState<string | null>(null);
  const [buscandoUbicacion, setBuscandoUbicacion] = useState(false);
```

   por:

```tsx
  // T-72 (D1): la ubicacion como estado de `validarAltaProspecto`. `sin-tomar`
  // tambien es "sin GPS": sin tocar "Usar mi ubicación" se exige la direccion.
  const [ubicacion, setUbicacion] = useState<UbicacionAlta>({ estado: 'sin-tomar' });
  const [domicilio, setDomicilio] = useState('');
```

3. Reemplaza el bloque de `puedeGuardar` (con su comentario de "La foto **no** aparece aqui…") por:

```tsx
  // Toda la regla del alta vive en `validarAltaProspecto` (T-72): los tres
  // obligatorios que dicto el cliente y la direccion cuando no hay GPS. La foto
  // **no** aparece: un prospecto sin foto es un prospecto completo.
  const validacion = useMemo(
    () => validarAltaProspecto({ nombre, telefono, encargado, ubicacion, domicilio }),
    [nombre, telefono, encargado, ubicacion, domicilio],
  );
  const puedeGuardar = vendedor !== null && sucursalId !== null && validacion.ubicacion !== null;
```

- [ ] **Paso 2: `ubicar` y `guardar`**

1. Reemplaza la función `ubicar` completa por:

```tsx
  async function ubicar() {
    setUbicacion({ estado: 'buscando' });
    // `obtenerUbicacion` nunca lanza: permiso negado y sin senal llegan como estado.
    setUbicacion(ubicacionAltaDe(await obtenerUbicacion()));
  }
```

2. En `guardar`, después del `if (!vendedor || !sucursalId) { … return; }`:

```tsx
    const datosUbicacion = validacion.ubicacion;
    if (datosUbicacion === null) {
      setError(validacion.faltantes.join(' '));
      return;
    }
```

3. En la llamada a `datos.prospectos.registrar({...})`, reemplaza
   `lat: ubicacion?.lat ?? null,` y `lng: ubicacion?.lng ?? null,` por:

```tsx
        // Una lectura invalida del GPS ya llega como null (T-39 D7).
        lat: datosUbicacion.lat,
        lng: datosUbicacion.lng,
        // T-72 (D1): obligatoria sin GPS; va al prospecto y a su espejo de cliente.
        domicilio: datosUbicacion.domicilio,
```

4. En el bloque que limpia el formulario, reemplaza `setUbicacion(null);` y `setAvisoUbicacion(null);` por:

```tsx
      setUbicacion({ estado: 'sin-tomar' });
      setDomicilio('');
```

5. El mensaje de guardado:

```tsx
      setGuardado(
        p.lat === null
          ? `Guardado "${p.nombre}" sin GPS, con su dirección: la oficina lo ubicará con ella. Queda pendiente de subir.`
          : `Guardado "${p.nombre}" con ubicación. Queda pendiente de subir.`,
      );
```

- [ ] **Paso 3: la tarjeta de ubicación y el campo de dirección**

Reemplaza la `<Tarjeta … etiqueta="Ubicación del negocio">` completa (desde su apertura hasta su `</Tarjeta>`) por:

```tsx
      <Tarjeta
        estado={ubicacion.estado === 'ok' && !validacion.domicilioObligatorio ? 'listo' : 'neutro'}
        etiqueta="Ubicación del negocio"
      >
        {ubicacion.estado === 'ok' && !validacion.domicilioObligatorio ? (
          <>
            <Pastilla texto="ubicación capturada" estado="listo" />
            {/* Toda cifra que el vendedor lea va en monoespaciada (regla 3). */}
            <Cifra valor={`${ubicacion.lat.toFixed(6)}, ${ubicacion.lng.toFixed(6)}`} />
          </>
        ) : (
          <Text style={estilos.textoSuave}>
            Sin ubicación. Si no hay GPS, escribe abajo la dirección del negocio: la oficina lo ubicará con ella.
          </Text>
        )}

        <Boton
          etiqueta={ubicacion.estado === 'ok' ? 'Volver a ubicar' : 'Usar mi ubicación'}
          tono="neutra"
          glifo="⌖"
          onPress={ubicar}
          ocupado={ubicacion.estado === 'buscando'}
          estilo={{ marginTop: espacio.sm }}
        />

        {avisoUbicacionAlta(ubicacion) ? (
          <Text style={estilos.textoSuave}>{avisoUbicacionAlta(ubicacion)}</Text>
        ) : null}
      </Tarjeta>

      {/* T-72 (D1): siempre visible; obligatoria sin GPS. Si el GPS llega despues
          de escribirla, se guardan las dos cosas. */}
      <Campo
        etiqueta={
          validacion.domicilioObligatorio
            ? 'Dirección del negocio (obligatoria sin GPS)'
            : 'Dirección del negocio (opcional)'
        }
        value={domicilio}
        onChangeText={setDomicilio}
        placeholder="Calle, número y colonia"
        maxLength={LARGO_MAX_DOMICILIO}
        multiline
      />
```

Y, justo después del `<Boton etiqueta="Guardar prospecto" … />`:

```tsx
      {validacion.faltantes.length > 0 ? (
        <Text style={estilos.textoSuave}>{validacion.faltantes.join(' ')}</Text>
      ) : null}
```

- [ ] **Paso 4: el comentario de cabecera**

En el JSDoc de `Prospectos`, reemplaza el bloque `> [!warning] La ubicacion NO bloquea el alta` (sus cinco líneas)
por:

```tsx
 * > [!warning] Sin GPS, la direccion es obligatoria (T-72, D1)
 * > Si el vendedor niega el permiso, no hay senal o no toca "Usar mi
 * > ubicación", el prospecto se guarda sin coordenadas **pero con la "Dirección
 * > del negocio"**: es lo que el servidor convierte en coordenada (Google) para
 * > rutearlo. Es la misma regla que la visita de T-39. La regla vive en
 * > `validarAltaProspecto` (`src/estado/alta-prospecto.ts`), con pruebas.
```

- [ ] **Paso 5: verificar y commit**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
git status --short apps/tablet    # solo prospectos.tsx; si expo ensucio package.json o tsconfig.json, git checkout de esos
git add "apps/tablet/app/(jornada)/prospectos.tsx"
git commit -m "T-72: tablet: Dirección del negocio en el alta de prospecto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Busca que no quede ninguna referencia vieja: `grep -n "avisoUbicacion\b\|buscandoUbicacion\|setAvisoUbicacion" "apps/tablet/app/(jornada)/prospectos.tsx"`
→ sin resultados (el typecheck ya lo habría delatado).

---

### Tarea 10: Documentación del repo (CLAUDE.md, README de la tablet)

**Files:**
- Modify: `CLAUDE.md` (bloque nuevo después del de Visita sin venta, T-39; una línea en el de Prospectos, T-75)
- Modify: `apps/tablet/README.md` (sección "Prospectos: venderles desde que se capturan (T-75)")
- Modify: `docs/superpowers/specs/2026-10-19-t-72-geocodificacion-design.md` (solo si la ejecución cambió algo:
  anota la enmienda bajo "Decisiones")

**Interfaces:**
- Consumes: todo lo anterior. No produce código.

- [ ] **Paso 1: `CLAUDE.md`**

1. En el bloque de Prospectos (T-75), después de la viñeta que empieza "**La tablet crea el espejo en `cliente` con el
   mismo id**", agrega:

```markdown
  - **T-72**: el alta gana "Dirección del negocio" (obligatoria sin GPS) y el espejo la guarda en `cliente.domicilio`,
    así que la ficha abre Maps por domicilio mientras el servidor no la geocodifique. Ver el bloque de T-72.
```

2. Después del bloque de Visita sin venta (T-39), agrega:

```markdown
- **Geocodificación de prospectos (T-72).** El alta de prospecto de la tablet gana "Dirección del negocio" (obligatoria
  sin GPS; una coordenada inválida cuenta como sin GPS) y el servidor convierte direcciones en coordenadas con la
  Geocoding API de Google. Spec: `docs/superpowers/specs/2026-10-19-t-72-geocodificacion-design.md`.
  - **`GOOGLE_MAPS_API_KEY`** (opcional, solo en el servidor; ver `.env.example`). Sin ella nada falla: el intento da
    `sin-configurar` y el portal lo dice. La clave **nunca** se loguea ni sale en respuestas; se loguea el `status` de
    Google o el código HTTP. `GEOCODIFICADOR_FALSO=1` (solo desarrollo) ubica todo en el centro de Tijuana sin Google.
  - Módulo `modules/integraciones/geocodificacion/` (token `GEOCODIFICADOR`, `fetch` nativo, **5 s** con
    `AbortController`; solo `ROOFTOP`/`RANGE_INTERPOLATED`/`GEOMETRIC_CENTER`, `APPROXIMATE` = `imprecisa`). **Las
    pruebas inyectan un falso** (`test/apoyo-geocodificador.ts` con `overrideProvider(GEOCODIFICADOR)`): ninguna llama
    a Google.
  - **Después del commit y sin bloquear**: `SincronizacionService` dispara
    `UbicacionClientesService.geocodificarEnSegundoPlano` tras aplicar un prospecto con `domicilio` y sin GPS (nunca en
    `duplicada` ni `rechazada`); `ClientesService` lo dispara al guardar desde el portal si el domicilio cambió y no
    hay coordenada. Nunca dentro de la transacción. El update es `… where lat is null` con `updated_at = now()`: no
    pisa una coordenada capturada mientras tanto y baja sola en el pull. Sin reintentos, cola ni cron.
  - `cliente.ubicacion_origen` (`gps`/`geocodificada`/`manual`; nula ⇔ `lat` nula; backfill `manual`). El portal
    conserva el origen si reenvía la misma coordenada y pone `manual` si cambia (`ubicacion-origen.ts`). Baja en el
    pull; la tablet la guarda (migración local 014) y todavía no la muestra.
  - Portal: "Ubicar con la dirección" → `POST /clientes/:id/ubicar` (permiso `cliente.gestionar`, otra sucursal =
    **404**, espera ≤ 5 s): 200 con la coordenada, 409/502 con el motivo en español. El domicilio admite 300
    caracteres (antes 200), igual que la tablet.
  - `DatosProspecto.domicilio` (≤ 300) es aditivo: `CONTRATO_ACTUAL` sigue en 1.
  - **Nube**: `20261019120000_cliente_ubicacion_origen.sql` se sube a `sinmex dev` después del merge, con el protocolo
    de push (su comentario trae el pre-flight; el backfill mueve `updated_at` de los clientes con coordenada a
    propósito).
```

- [ ] **Paso 2: `apps/tablet/README.md`**

En la sección "Prospectos: venderles desde que se capturan (T-75)", después de la viñeta "- La foto se liga por id
(`fotoLocalDe`), con respaldo por nombre + teléfono.", agrega:

```markdown
- **Dirección del negocio (T-72)**: campo del alta, obligatorio cuando no hay coordenada válida (no se tomó, permiso
  negado, sin señal o lectura fuera de rango). La regla es `validarAltaProspecto` (`src/estado/alta-prospecto.ts`, con
  pruebas) y comparte con la visita `esCoordenadaValida` (`src/estado/coordenada.ts`). Se guarda en
  `prospecto.domicilio` y en el espejo (`cliente.domicilio`; migración 014), sube como `domicilio` en la operación y
  el servidor la geocodifica; la coordenada baja en el pull con `ubicacion_origen` (se guarda, no se muestra).
```

- [ ] **Paso 3: commit**

```bash
git add CLAUDE.md apps/tablet/README.md docs/superpowers/specs/2026-10-19-t-72-geocodificacion-design.md
git commit -m "T-72: documentación (CLAUDE.md, README de la tablet)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Conflictos para el controlador

- **Supabase local compartido.** La Tarea 1 aplica una migración con `migration up --local` y regenera `schema.d.ts`.
  Si otra sesión dejó migraciones de otra rama aplicadas, `db:types` las arrastra: hay que quedarse solo con lo de
  T-72 en el diff. Nunca `db reset`, nunca nada contra `sinmex dev`.
- **Orden de las tareas.** 1 → 2 → 3 → 4 → 5 en el backend (cada una consume la anterior); 6 necesita 1 y 4; 7
  necesita 5 (los tipos del contrato de la tablet); 8 necesita 7; 9 necesita 8. La 10 al final.
- **El push de la migración a la nube** lo hace quien mergee (protocolo de `CLAUDE.md`), no esta rama. Pre-flight:
  `select count(*) from cliente where lat is not null;` (filas que el backfill marca `manual`; los checks no pueden
  fallar porque el backfill corre antes). Las tablets bajarán otra vez esos clientes (el backfill mueve `updated_at`).
- **Vault** (al terminar, el controlador, no un subagente): `ADR-0014 Geocodificación de direcciones` (D7: Google,
  costo, clave solo en servidor restringida a la Geocoding API, fallos sin cola y reintento a mano, `APPROXIMATE`
  descartado, Nominatim/OSM descartado), [[Integraciones]], [[T-40 Registro de Prospectos]], [[Cliente]]
  (`ubicacion_origen`), Estado del proyecto y bitácora.
- **Aceptación manual en el emulador** (spec, "Pruebas"): backend **contra el Postgres local** (no `.env.development`,
  que apunta a la nube) con `GEOCODIFICADOR_FALSO=1`; alta sin GPS (permiso negado) → la pantalla exige la dirección →
  guardar con dirección → sincronizar → en Postgres local la fila tiene `ubicacion_origen = 'geocodificada'` → el pull
  siguiente la baja y la ficha abre Maps por coordenada. En el portal: un cliente sin coordenada con domicilio muestra
  "Sin ubicación" y "Ubicar con la dirección". La prueba contra Google real queda **pendiente** hasta que Mario tenga
  la clave. La hace el controlador, con capturas, en un clon propio (nunca en `proyecto-sinmex`).
