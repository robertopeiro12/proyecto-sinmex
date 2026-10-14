# T-75 · Camino en la app hasta el prospecto — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el vendedor pueda venderle (solo regalo de bienvenida) a un prospecto **en cuanto lo captura**, sin
red, y que llegue a su ficha desde "Prospectos de hoy" y desde "Todos los clientes"; que el servidor adopte el id
de la tablet para que la venta encolada encuentre al cliente; y que la pantalla de la jornada muestre a quién se
atendió fuera de ruta.

**Architecture:** la tablet inserta, en la misma transacción del alta de prospecto, su espejo en la tabla local
`cliente` con el **mismo id** y `tipo = 'prospecto'` (D1). El servidor, que ya crea una fila `cliente` por cada
alta, pasa a usar como `id` la `clave` de la operación, validada como UUID (D2); el cable no cambia. Las fuentes del
push se reordenan para que el alta llegue antes que la venta (D3), porque el alcance se comprueba una vez por lote.
Todo lo decidible sin React vive en funciones puras con pruebas (`ruta-del-dia.ts`, `fuentes.ts`); las pantallas
solo pintan. El prospecto **no** entra a la ruta (D5) y la conversión sigue siendo del portal, misma fila.

**Tech Stack:** NestJS 11 + Kysely (backend), Postgres local vía Supabase (e2e), Expo SDK 57 / React Native +
SQLite + Jest en Node (tablet; sin pruebas de pantalla). Sin cambios en el portal ni DDL.

**Spec:** `docs/superpowers/specs/2026-10-14-t-75-camino-prospecto-design.md` — léelo antes de empezar. Sus
decisiones D1…D10 **no se renegocian**. Si este plan lo contradice, manda el spec: para y pregunta.

---

## Global Constraints

Copiadas del spec y del repo. Cada tarea las incluye:

- Rama `feature/t-75-camino-prospecto`. Todos los comandos **desde la raíz del worktree**
  (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t75`), con los scripts del workspace
  (`--workspace=apps/...`). **Nunca** entres a `../proyecto-sinmex` (clon de demo).
- Código en español, **identificadores sin acentos**, **mensajes al usuario con acentos**. Comentarios que
  explican *por qué*. Sigue el estilo de los archivos que tocas (doc-comments con `> [!info]`, etc.).
- **El cable no cambia**: `CONTRATO_ACTUAL` sigue en **1**; ningún campo nuevo en `contrato.ts`. Lo que cambia es
  una regla (la clave de un `prospecto` debe ser UUID y pasa a ser el `id` del cliente), y se documenta en
  `apps/backend/src/modules/sincronizacion/contrato.ts` y en `docs/contrato-sincronizacion.md` **en la misma
  tarea** (Tarea 1).
- ADR-0009: **una transacción por operación**; una rechazada **no deja fila** (ni buzón ni negocio).
- `fecha_operacion` la manda la tablet; **el servidor no la re-deriva de UTC**.
- **Sin migraciones**: ni de Postgres ni local (D10). Si crees que hace falta una, para y pregunta.
- Nada de `db reset`. Supabase local es **compartido entre sesiones**. **Nunca apuntar a `sinmex dev`**;
  `.env.test` va a `127.0.0.1:54322`.
- Backend: lint **solo por archivo**: `npm exec --workspace=apps/backend -- prettier --write <archivos>` y
  `npm exec --workspace=apps/backend -- eslint <archivos>`. **Nunca** `npm run lint --workspace=apps/backend`
  (lleva `--fix` y reescribe archivos ajenos). Typecheck del backend = `npm run build --workspace=apps/backend`.
  Pruebas: `npm test --workspace=apps/backend`, `npm run test:e2e --workspace=apps/backend` (Postgres local
  arriba).
- Tablet: `npm run typecheck --workspace=apps/tablet`, `npm run lint --workspace=apps/tablet`,
  `npm test --workspace=apps/tablet`. Las pruebas son **solo** `src/**/*.spec.ts` en Node: nada de pantallas.
  Todo lo decidible va a una función pura con prueba; la pantalla solo la llama.
- Los e2e **siembran lo que usan** (productos, presentaciones, precio, tipos de negocio) con sufijo
  `${Date.now()}-${process.pid}` y lo borran en `afterAll`: el Postgres de CI no tiene catálogo.
- `git status` limpio al terminar cada tarea; un commit por tarea (o más si el implementador lo prefiere), con el
  trailer exacto `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

Lo que el spec implica y ninguna prueba de tarea cubriría si no se añade aquí; cada línea se pinó en la tarea dueña:

1. **Alta rechazada y reenviada con la misma clave** → la segunda vez entra con el **mismo id** (no quedó fila la
   primera vez). Tarea 1, e2e "un tipo de negocio dado de baja…" ampliado.
2. **Prospecto capturado antes de esta versión** (fila `prospecto` sin `cliente` local con su id) → la fila de
   "Prospectos de hoy" se pinta sin enlace y la app no truena. Tarea 6 (`enlaceAFicha` puro, Tarea 5).
3. **Venta encolada a un prospecto cuyo alta sigue en error** → la venta queda en `error` por alcance y **vuelve a
   intentarse**; no se pierde ni se marca sincronizada. Tarea 2, e2e del mismo lote.
4. **Dos ventas al mismo prospecto fuera de ruta** → una sola fila en "Atendidos fuera de ruta", con el estado más
   grave. Tarea 5.
5. **Prospecto que ya está en la ruta como cliente** (la oficina lo convirtió y lo puso en ruta el mismo día,
   y la tablet aún tiene la venta local) → **no** sale en "Atendidos fuera de ruta". Tarea 5.

---

### Tarea 1: El servidor adopta el id de la tablet para el prospecto (D2)

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/despacho-prospecto.ts`
- Modify: `apps/backend/src/modules/sincronizacion/despacho-prospecto.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (case `'prospecto'`, ~línea 468)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.service.ts` (`ContextoProspecto`, `crearProspecto`)
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.repository.ts` (`insertarProspecto`)
- Modify: `apps/backend/src/modules/cartera-clientes/prospecto-rechazado.ts` (razón nueva)
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts` (doc de `DatosProspecto`/clave)
- Modify: `apps/backend/test/prospectos.e2e-spec.ts`
- Modify: `docs/contrato-sincronizacion.md` (§6 `tipo: "prospecto"`, §7 "La clave")

**Interfaces:**
- Consumes: `OperacionNormalizada.clave` (string), `ProspectoRechazado`, `esViolacionUnicidad` y
  `restriccionDelError` de `src/database/errores-postgres.ts`.
- Produces: `ContextoProspecto.id: string` (la clave, ya validada como UUID); `RazonRechazoProspecto` gana
  `'id-ocupado'`, mapeada a `'datos-invalidos'`.

- [ ] **Paso 1: prueba unitaria que falla — clave no UUID**

En `despacho-prospecto.spec.ts`, después del caso "rechaza un prospecto que llega con cliente_id":

```ts
  /**
   * T-75 (D2): la clave del prospecto pasa a ser el `id` del `cliente` que se
   * crea (la tablet ya lo registro localmente con ese id). `cliente.id` es
   * `uuid`, asi que una clave que no lo sea no puede entrar — y es un bug de la
   * tablet, no un catalogo viejo: `datos-invalidos`.
   */
  it('rechaza un prospecto cuya clave no es un uuid: es el id del cliente', () => {
    const r = prepararProspecto(operacion({ clave: 'prosp-123-abc' }));

    expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
    if (r.ok) return;
    expect(r.motivo).toMatch(/clave/);
    expect(r.motivo).toMatch(/uuid/i);
  });

  it('acepta la clave en mayusculas: Postgres compara uuid sin importar mayusculas', () => {
    const r = prepararProspecto(
      operacion({ clave: '7F2C0000-0000-4000-8000-000000000001' }),
    );
    expect(r.ok).toBe(true);
  });
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/backend -- despacho-prospecto` → el primer caso falla (hoy `ok: true`).

- [ ] **Paso 3: validar la clave en `prepararProspecto`**

En `despacho-prospecto.ts`, antes de `normalizarDatosProspecto`:

```ts
const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * T-75 (D2): la clave **es** el id del cliente que se va a crear. La tablet
   * registro el prospecto localmente con ese id y puede tener ya una venta
   * encolada que apunta a el; si el servidor inventara otro id, esa venta
   * nunca encontraria a su cliente. `cliente.id` es `uuid`, asi que la clave
   * tiene que serlo: una que no lo sea es un bug de la tablet (la app siempre
   * manda `randomUUID()`), no un catalogo viejo — `datos-invalidos`.
   */
  if (!RE_UUID.test(op.clave)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'clave: la clave de un prospecto debe ser un uuid; es el id con el que la tablet ya lo registró.',
    };
  }
```

Correr de nuevo: pasa.

- [ ] **Paso 4: la razón `id-ocupado`**

En `prospecto-rechazado.ts`:

```ts
export type RazonRechazoProspecto =
  /** … (doc existente de tipo-negocio-inexistente) */
  | 'tipo-negocio-inexistente'
  /**
   * T-75 (D2): ya existe un `cliente` con el id que trae la clave. No puede
   * pasar con una tablet sana (la clave es un uuid v4 recien generado y un
   * reenvio cae antes en `duplicada` por el buzon), asi que es un bug o una
   * clave inventada: se rechaza con motivo y **no** es un 500.
   */
  | 'id-ocupado';
```

En `despacho-prospecto.ts`:

```ts
export const CODIGO_POR_RAZON_PROSPECTO: Record<RazonRechazoProspecto, CodigoRechazo> = {
  'tipo-negocio-inexistente': 'tipo-negocio-inexistente',
  'id-ocupado': 'datos-invalidos',
};
```

- [ ] **Paso 5: `ContextoProspecto.id` y el insert con id**

En `clientes.service.ts`, `ContextoProspecto` gana:

```ts
  /**
   * T-75 (D2): el id con el que nace el `cliente` = la clave de idempotencia
   * de la operacion, ya validada como uuid por `prepararProspecto`. La tablet
   * lo registro con ese id y su venta de bienvenida (encolada sin red) apunta
   * a el; el servidor **no** inventa otro.
   */
  id: string;
```

En `crearProspecto`, el `return this.repo.insertarProspecto({...})` pasa a:

```ts
    try {
      return await this.repo.insertarProspecto(
        {
          id: contexto.id,
          nombre: prospecto.nombre,
          // … (los demás campos como están)
          sucursalId: contexto.sucursalId,
        },
        trx,
      );
    } catch (error) {
      // Solo la llave primaria: otro `unique` seria otro bug y debe reventar.
      if (
        esViolacionUnicidad(error) &&
        restriccionDelError(error) === 'cliente_pkey'
      ) {
        throw new ProspectoRechazado({
          razon: 'id-ocupado',
          motivo: `Ya existe un cliente con el id ${contexto.id}; la tablet mandó una clave que no es nueva.`,
        });
      }
      throw error;
    }
```

Importa `esViolacionUnicidad` y `restriccionDelError` de `'../../database/errores-postgres'` (ya se importa
`esViolacionCheck` de `'../../database/errores-postgres'`: añádelos a esa misma línea de import). La PK de
`cliente` se llama `cliente_pkey` (comprobado en el Postgres local al planificar).

En `clientes.repository.ts`, `insertarProspecto` recibe `id: string` en `datos` y lo escribe: `.values({ id: datos.id, nombre: … })`.

En `sincronizacion.service.ts`, case `'prospecto'`: añade `id: op.clave,` al contexto con el comentario
`// T-75 (D2): la clave ES el id del cliente (uuid validado en prepararProspecto).`

- [ ] **Paso 6: `npm run build --workspace=apps/backend` y `npm test --workspace=apps/backend`** → verde.
  Si `clientes.service.spec.ts` o `sincronizacion.service.spec.ts` arman un `ContextoProspecto` a mano, añádeles
  `id` con un uuid literal.

- [ ] **Paso 7: e2e — claves UUID y el id adoptado**

En `apps/backend/test/prospectos.e2e-spec.ts`:

1. `import { randomUUID } from 'node:crypto';` y en `alta()`: `clave: randomUUID(),` (con el comentario
   `// T-75: la clave es el id del cliente; la tablet manda uuid v4.`).
2. En "proyecta el alta a un cliente con tipo prospecto…", tras `expect(filas).toHaveLength(1)`:
   ```ts
   // T-75 (D2): el servidor adopta la clave como id. Es lo que permite que una
   // venta encolada sin red, que ya apunta a ese id, encuentre a su cliente.
   expect(filas[0].id).toBe(op.clave);
   ```
3. Casos nuevos, después de "un prospecto con cliente_id se rechaza":
   ```ts
   it('una clave que no es uuid se rechaza por operacion: es el id del cliente (T-75)', async () => {
     const op = alta({ clave: `prosp-${SUFIJO}-texto` });
     const cuerpo = (await push({ operaciones: [op] }).expect(200)).body as RespuestaPush;
     expect(cuerpo.resultados[0]).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
     expect(cuerpo.resultados[0].motivo).toMatch(/clave/);
     expect(await clientePorNombre(`${PREFIJO} Tacos Aaron`)).toHaveLength(0);
   });

   it('una clave igual al id de un cliente existente se rechaza con motivo, no con 500 (T-75)', async () => {
     const existente = await db
       .insertInto('cliente')
       .values({
         nombre: `${PREFIJO} Ya existia`,
         domicilio: 'Calle 1',
         telefono: '6640000000',
         tipo: 'cliente',
         lista_precio_id: listaId,
         sucursal_id: sucursalId,
       })
       .returning('id')
       .executeTakeFirstOrThrow();
     const op = alta({ clave: existente.id, datos: { ...alta().datos, nombre: `${PREFIJO} Choca` } });
     const cuerpo = (await push({ operaciones: [op] }).expect(200)).body as RespuestaPush;
     expect(cuerpo.resultados[0]).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
     expect(cuerpo.resultados[0].motivo).toMatch(/id/);
     // Una rechazada no deja fila: ni en cliente ni en el buzon.
     expect(await clientePorNombre(`${PREFIJO} Choca`)).toHaveLength(0);
     expect(
       await db.selectFrom('sync_operacion').select('id').where('clave_idempotencia', '=', op.clave).execute(),
     ).toHaveLength(0);
   });
   ```
   (`alta({ datos })` reemplaza `datos` completo: por eso se reconstruye con `...alta().datos`.)
4. **Review Focus 1.** En "un tipo de negocio dado de baja se rechaza con su codigo propio" (ya reenvía una
   `corregida` con la misma clave): añade al final
   `expect((await clientePorNombre(…nombre de la corregida…))[0].id).toBe(op.clave);` usando el nombre que ese
   caso ya usa.

Correr: `npm run test:e2e --workspace=apps/backend -- prospectos` → verde. También
`npm run test:e2e --workspace=apps/backend -- foto-prospecto` (ya usa `randomUUID()`; debe seguir verde).

- [ ] **Paso 8: documentar la regla (mismo commit)**

`contrato.ts`, en el doc-comment de `DatosProspecto` (≈ línea 287): añade un párrafo:

```
 * T-75 (D2): la `clave` de un prospecto **es el id** con el que el servidor
 * crea el `cliente`. Debe ser uuid (la tablet manda `randomUUID()`); si no lo
 * es, `datos-invalidos`. Asi una venta capturada sin red contra ese prospecto
 * (que la tablet ya registro con ese id) encuentra a su cliente al subir.
```

`docs/contrato-sincronizacion.md`, §6 `tipo: "prospecto"`: tras el bloque JSON añade una nota
`> [!info] T-75: la clave es el id del cliente` con el mismo contenido, y en la tabla de rechazos una fila
`| Una clave que no es uuid | Es el id del `cliente` que se crea (T-75) |`. §7 "La clave": añade una frase
"Para un `prospecto`, además, la clave pasa a ser el `id` del `cliente` creado (T-75)." Actualiza la cabecera del
documento (línea 4, lista de ampliaciones) con "· T-75: la clave del prospecto es el id del cliente".

- [ ] **Paso 9: lint por archivo y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/sincronizacion/despacho-prospecto.ts src/modules/sincronizacion/despacho-prospecto.spec.ts src/modules/sincronizacion/sincronizacion.service.ts src/modules/cartera-clientes/clientes.service.ts src/modules/cartera-clientes/clientes.repository.ts src/modules/cartera-clientes/prospecto-rechazado.ts src/modules/sincronizacion/contrato.ts test/prospectos.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint <los mismos archivos>
git add -A && git commit -m "T-75: el servidor adopta la clave del prospecto como id del cliente (D2)"
```

---

### Tarea 2: e2e del camino completo: alta y venta de bienvenida en dos lotes (D3)

**Files:**
- Create: `apps/backend/test/prospecto-venta.e2e-spec.ts`

**Interfaces:**
- Consumes: Tarea 1 (id = clave). Contrato de la venta (`DatosVenta.lineas[]`, `regalos` opcional) y
  `formarFolio`/`asignarSegmento` como en `promociones-sync.e2e-spec.ts`.
- Produces: nada en código; es la prueba que fija D3 y D4 del lado servidor.

- [ ] **Paso 1: la suite**

Copia la estructura de `prospectos.e2e-spec.ts` (vendedor propio con segmento, tipo de negocio sembrado,
`afterAll` en orden inverso) y de `promociones-sync.e2e-spec.ts` (producto + presentación + `precio` de "Lista 1"
en la sucursal del vendedor; borrado de `venta_nota_promocion`, `venta_nota_detalle`, `cobranza_abono`,
`venta_nota`, `sync_operacion`, `cliente`, `precio`, `presentacion`, `producto`, `tipo_negocio`,
`sesion_vendedor`, `vendedor`). Cabecera:

```ts
/**
 * T-75 (D3, D4): el prospecto se captura y se le vende sin red; al subir, el
 * alta va en un lote y la venta de bienvenida (solo regalo) en otro, porque el
 * alcance de los clientes se comprueba UNA vez por lote. Fija:
 *
 * 1. Lote 1 `prospecto` (clave = id) → aplicada; lote 2 `venta` a ese id con
 *    una linea de 0 vendidas y N regaladas → aplicada, nota en $0,
 *    `cliente.primera_venta_en` puesto.
 * 2. Las dos en el MISMO lote → la venta cae `cliente-fuera-de-alcance` y el
 *    alta entra; el reenvio de la venta sola entra (D4: se reintenta).
 * 3. Un alta rechazada (tipo de negocio de baja) + su venta → las dos
 *    rechazadas; corregida el alta, el reenvio de ambas (en dos lotes) entra.
 */
```

Helpers:

```ts
const altaProspecto = (extra: Record<string, unknown> = {}) => ({
  clave: randomUUID(),
  tipo: 'prospecto',
  fecha_operacion: FECHA,
  ocurrido_en: `${FECHA}T18:03:22.000Z`,
  datos: {
    nombre: `${PREFIJO} Bienvenida ${Math.random().toString(36).slice(2)}`,
    telefono: '6641112233',
    encargado: 'Don Aaron',
    tipo_negocio_id: tipoNegocioId,
    comentarios: null,
    lat: null,
    lng: null,
    foto: null,
  },
  ...extra,
});

/** Venta de solo regalo (bienvenida): 0 vendidas, 2 regaladas, a $0. */
const ventaRegalo = (clienteId: string) => ({
  clave: randomUUID(),
  tipo: 'venta',
  cliente_id: clienteId,
  fecha_operacion: FECHA,
  ocurrido_en: `${FECHA}T18:10:00.000Z`,
  folio: formarFolio(sucursalCodigo, FECHA, segmento, ++consecutivo),
  datos: {
    num_nota: null,
    contado_credito: 'contado',
    factura: 'N/A',
    comentarios: null,
    lineas: [
      { presentacion_id: presentacionId, cantidad: 0, cantidad_promocion: 2, precio_centavos: 0 },
    ],
  },
});
```

`FECHA = '2026-10-15'`; `consecutivo` empieza en 0.

- [ ] **Paso 2: los tres casos**

```ts
it('alta en un lote y venta de bienvenida en el siguiente: las dos entran y marca la primera venta', async () => {
  const alta = altaProspecto();
  const r1 = (await push({ operaciones: [alta] })).resultados[0];
  expect(r1.estado).toBe('aplicada');

  const venta = ventaRegalo(alta.clave);
  const r2 = (await push({ operaciones: [venta] })).resultados[0];
  expect(r2).toMatchObject({ estado: 'aplicada' });

  const nota = await db.selectFrom('venta_nota').selectAll().where('folio', '=', venta.folio).executeTakeFirstOrThrow();
  expect(nota.cliente_id).toBe(alta.clave);
  expect(Number(nota.monto_total)).toBe(0); // `numeric` llega como cadena desde `pg`
  const cliente = await db.selectFrom('cliente').select(['tipo', 'primera_venta_en']).where('id', '=', alta.clave).executeTakeFirstOrThrow();
  expect(cliente.tipo).toBe('prospecto');
  expect(cliente.primera_venta_en).not.toBeNull();
});

it('alta y venta en el MISMO lote: la venta cae por alcance y entra al reenviarla sola (D3, D4)', async () => {
  const alta = altaProspecto();
  const venta = ventaRegalo(alta.clave);
  const r = await push({ operaciones: [alta, venta] });
  expect(r.resultados[0].estado).toBe('aplicada');
  expect(r.resultados[1]).toMatchObject({ estado: 'rechazada', codigo: 'cliente-fuera-de-alcance' });

  const reenvio = (await push({ operaciones: [venta] })).resultados[0];
  expect(reenvio.estado).toBe('aplicada');
});

it('alta rechazada: su venta tambien cae; corregida el alta, las dos entran en dos lotes', async () => {
  const alta = altaProspecto({ datos: { ...altaProspecto().datos, tipo_negocio_id: tipoNegocioBorradoId } });
  const venta = ventaRegalo(alta.clave);
  expect((await push({ operaciones: [alta] })).resultados[0]).toMatchObject({ estado: 'rechazada', codigo: 'tipo-negocio-inexistente' });
  expect((await push({ operaciones: [venta] })).resultados[0]).toMatchObject({ estado: 'rechazada', codigo: 'cliente-fuera-de-alcance' });

  const corregida = { ...alta, datos: { ...alta.datos, tipo_negocio_id: tipoNegocioId } };
  expect((await push({ operaciones: [corregida] })).resultados[0].estado).toBe('aplicada');
  expect((await push({ operaciones: [venta] })).resultados[0].estado).toBe('aplicada');
  expect((await db.selectFrom('cliente').select('id').where('id', '=', alta.clave).execute())).toHaveLength(1);
});
```

- [ ] **Paso 3: correr** `npm run test:e2e --workspace=apps/backend -- prospecto-venta` → verde. Si la venta
  de solo regalo fuera rechazada por `precio-no-asignado`, **para**: el spec dice que entra (D1, verificado en
  `reglas-venta.ts`: solo `cantidad > 0` exige precio); reporta en vez de cambiar la regla.

- [ ] **Paso 4: lint por archivo y commit** `T-75: e2e del alta y la venta de bienvenida en dos lotes (D3, D4)`.

---

### Tarea 3: El prospecto nace como cliente local; consultas nuevas (D1, D6, D7, D9)

**Files:**
- Modify: `apps/tablet/src/datos/repositorios/prospectos.ts` (`registrar`, `fotoLocalDe`)
- Modify: `apps/tablet/src/datos/repositorios/prospectos.spec.ts`
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts` (`listarProspectos`)
- Modify: `apps/tablet/src/datos/repositorios/catalogos.spec.ts`
- Modify: `apps/tablet/src/datos/repositorios/ventas.ts` (`delDiaDelVendedor`)
- Modify: `apps/tablet/src/datos/repositorios/ventas.spec.ts`

**Interfaces:**
- Consumes: `enTransaccion` de `./deps`, tabla local `cliente` (columnas de `COLUMNAS.cliente` en
  `catalogos.ts`: `id, nombre, domicilio, telefono, encargado, tipo, pct_comision, plazo_credito_dias,
  primera_venta_en, lat, lng, sucursal_id, activo, saldo_favor_centavos` + `sincronizado_en`).
- Produces:
  - `prospectos.registrar(datos)` además deja `catalogos.obtenerCliente(p.id)` con `tipo: 'prospecto'`.
  - `catalogos.listarProspectos(sucursalId: string): Cliente[]`.
  - `prospectos.fotoLocalDe(cliente: Pick<Cliente, 'id' | 'nombre' | 'telefono'>): string | null` (firma ampliada
    con `id`).
  - `ventas.delDiaDelVendedor(vendedorId: string, fecha?: FechaISO): Venta[]`.

- [ ] **Paso 1: pruebas que fallan**

`prospectos.spec.ts`, dentro de `describe('registrar')`:

```ts
    /**
     * T-75 (D1): el prospecto nace tambien como `cliente` local con el MISMO id
     * y `tipo = 'prospecto'`. Es lo que hace que tenga ficha, bienvenida y venta
     * de solo regalo desde el momento en que se guarda, sin red. El servidor
     * adoptara ese id (D2) y el pull pisara la fila por id sin duplicar.
     */
    it('crea su espejo en cliente, con el mismo id y tipo prospecto', () => {
      const { prospectos, catalogos } = montar();

      const p = prospectos.registrar(captura());

      expect(catalogos.obtenerCliente(p.id)).toMatchObject({
        id: p.id,
        nombre: 'Tacos Aaron',
        domicilio: null,
        telefono: '6641112233',
        encargado: 'Don Aaron',
        tipo: 'prospecto',
        pct_comision: null,
        plazo_credito_dias: null,
        primera_venta_en: null,
        lat: 32.5149,
        lng: -117.0382,
        sucursal_id: SUCURSAL,
        activo: 1,
        saldo_favor_centavos: 0,
        sincronizado_en: '2026-08-07T15:00:00.000Z',
      });
      // No es cliente de ruta: la lista de "Agregar a mi ruta" no lo ofrece (D5).
      expect(catalogos.listarClientes(SUCURSAL).map((c) => c.id)).not.toContain(p.id);
      expect(catalogos.listarProspectos(SUCURSAL).map((c) => c.id)).toContain(p.id);
    });

    it('si el espejo falla, tampoco queda el prospecto (una transaccion)', () => {
      const { prospectos, deps } = montar();
      // `depsDePrueba` genera ids `id-1`, `id-2`, …: el primer registrar va a pedir
      // `id-1`. Un cliente que ya lo ocupa hace chocar el insert del espejo.
      deps.bd.runSync(
        `insert into cliente (id, nombre, domicilio, telefono, tipo, sucursal_id, activo, sincronizado_en)
         values ('id-1', 'Ocupa', 'x', '1', 'cliente', $suc, 1, 'x')`,
        { $suc: SUCURSAL },
      );
      expect(() => prospectos.registrar(captura())).toThrow();
      expect(prospectos.pendientesDeSincronizar()).toEqual([]);
    });
```

En `describe('fotoLocalDe')`, cambia las llamadas existentes para pasar `id` (un id que no exista, p. ej.
`'otro-id'`, así siguen probando el fallback) y añade:

```ts
    it('T-75 (D9): primero por id del prospecto, aunque el nombre no coincida', () => {
      const { prospectos } = montar();
      const p = prospectos.registrar(captura({ fotoUri: 'file:///cache/foto-id.jpg' }));
      expect(
        prospectos.fotoLocalDe({ id: p.id, nombre: 'Renombrado en el portal', telefono: '0' }),
      ).toBe('file:///cache/foto-id.jpg');
    });
```

`catalogos.spec.ts`, junto a "no lista prospectos como clientes de ruta":

```ts
  it('listarProspectos: solo tipo prospecto, activos, por nombre (T-75)', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.listarProspectos('suc-tj').map((c) => c.id)).toEqual(['cli-2']);
    expect(catalogos.listarProspectos('suc-mx')).toEqual([]);
  });
```

Si el snapshot de prueba no tiene un prospecto **inactivo**, añade en el caso uno con
`deps.bd.runSync('update cliente set activo = 0 where id = $id', { $id: 'cli-2' })` y comprueba que la lista
queda vacía.

`ventas.spec.ts`: localiza `montar()` y el helper `venta()`; añade:

```ts
  describe('delDiaDelVendedor (T-75, D7)', () => {
    it('las ventas del dia del vendedor, en orden de captura, sin las de otro dia', () => {
      const { ventas, deps } = montar();
      const a = ventas.registrar(venta());
      const b = ventas.registrar(venta({ numNota: '2347' }));
      expect(ventas.delDiaDelVendedor(a.vendedor_id).map((v) => v.id)).toEqual([a.id, b.id]);
      expect(ventas.delDiaDelVendedor(a.vendedor_id, '2020-01-01')).toEqual([]);
    });
  });
```

(Dos ventas al mismo `cli-1`: `cli-2` es prospecto sin precios y `registrar` rechazaría la línea vendida; lo
que se prueba es la consulta, no la regla de venta.)

- [ ] **Paso 2: correr y ver fallar** `npm test --workspace=apps/tablet -- prospectos catalogos ventas`.

- [ ] **Paso 3: implementar**

`prospectos.ts`: importa `enTransaccion` de `./deps`. En `registrar`, envuelve el `insert into prospecto` y el
nuevo insert en `enTransaccion(bd, () => { … })`, y actualiza el doc-comment del repositorio (el `> [!info] No
emite folio…` dice que no abre transacción: cámbialo a "abre transacción solo para que el espejo en `cliente`
(T-75) y la fila de `prospecto` nazcan o fallen juntos; sigue sin folio"):

```ts
      enTransaccion(bd, () => {
        bd.runSync(`insert into prospecto (…) values (…)`, { … });  // el existente

        // T-75 (D1): el espejo local. Mismo id: el servidor lo adoptara (D2) y
        // el pull pisara esta fila por id sin duplicar. Sin precios ni
        // domicilio: la venta solo admite regalo y la conversion es del portal.
        bd.runSync(
          `insert into cliente (
             id, nombre, domicilio, telefono, encargado, tipo, pct_comision,
             plazo_credito_dias, primera_venta_en, lat, lng, sucursal_id, activo,
             saldo_favor_centavos, sincronizado_en
           ) values (
             $id, $nombre, null, $telefono, $encargado, 'prospecto', null,
             null, null, $lat, $lng, $sucursal_id, 1, 0, $sincronizado_en
           )`,
          {
            $id: id,
            $nombre: nombre,
            $telefono: telefono,
            $encargado: encargado,
            $lat: datos.lat,
            $lng: datos.lng,
            $sucursal_id: datos.sucursalId,
            $sincronizado_en: ahora,
          },
        );
      });
```

`fotoLocalDe`:

```ts
    fotoLocalDe(cliente: Pick<Cliente, 'id' | 'nombre' | 'telefono'>): string | null {
      // T-75 (D9): desde esta version el prospecto y su cliente comparten id.
      const porId = bd.getFirstSync<{ foto_uri: string }>(
        'select foto_uri from prospecto where id = $id and foto_uri is not null',
        { $id: cliente.id },
      );
      if (porId) return porId.foto_uri;
      // Prospectos de antes de T-75: el servidor les dio otro id; se reconocen
      // por nombre y telefono (lower() de SQLite solo pliega ASCII; aceptable:
      // los dos nombres salen del mismo teclado).
      … (la consulta existente)
    },
```

`catalogos.ts`, debajo de `listarClientes`:

```ts
    /** Prospectos activos de una sucursal (T-75, D6): la pestana "Prospectos". */
    listarProspectos(sucursalId: string): Cliente[] {
      return bd.getAllSync<Cliente>(
        `select * from cliente
         where sucursal_id = $sucursal_id and tipo = 'prospecto' and activo = 1
         order by nombre`,
        { $sucursal_id: sucursalId },
      );
    },
```

`ventas.ts`, debajo de `delDia`:

```ts
    /** Ventas del vendedor en un dia (T-75, D7): "Atendidos fuera de ruta". */
    delDiaDelVendedor(vendedorId: string, fecha: FechaISO = reloj.hoy()): Venta[] {
      return bd.getAllSync<Venta>(
        `select * from venta
          where vendedor_id = $vendedor_id and fecha = $fecha
          order by grabada_en, rowid`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      );
    },
```

- [ ] **Paso 4: correr todo** `npm test --workspace=apps/tablet` y `npm run typecheck --workspace=apps/tablet`.
  Quien llame a `fotoLocalDe` con un objeto sin `id` deja de compilar: hoy es solo la ficha
  (`operacion/[clienteId]/index.tsx`, que pasa el `cliente` completo: compila sin cambios).

- [ ] **Paso 5: lint y commit** `npm run lint --workspace=apps/tablet` →
  `T-75: el prospecto nace como cliente local; listarProspectos, foto por id y ventas del día (D1, D6, D7, D9)`.

---

### Tarea 4: Orden de las fuentes del push, en una función con prueba (D3)

**Files:**
- Create: `apps/tablet/src/sincronizacion/fuentes.ts`
- Create: `apps/tablet/src/sincronizacion/fuentes.spec.ts`
- Modify: `apps/tablet/src/estado/proveedor-sesion.tsx` (≈ líneas 93-104)

**Interfaces:**
- Consumes: `fuenteJornadas`, `fuenteVentas`, `fuenteProspectos`, `fuenteCobranzas`, `fuenteRutas` (ya existen) y
  `FuentesConPendientes` de `./pendientes`.
- Produces: `fuentesDelPush(datos: FuentesConPendientes): FuenteOperaciones[]`.

- [ ] **Paso 1: prueba que falla** (`fuentes.spec.ts`)

```ts
import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
// Copia tal cual la funcion `montar()` de `./pendientes.spec.ts` (arma los cinco repositorios).
import { fuentesDelPush } from './fuentes';

describe('fuentesDelPush (T-75, D3)', () => {
  it('sube los prospectos ANTES que las ventas: el alcance se comprueba una vez por lote', () => {
    const datos = montar();
    expect(fuentesDelPush(datos).map((f) => f.tipo)).toEqual([
      'jornada',
      'prospecto',
      'venta',
      'cobranza',
      'ruta-alta',
    ]);
  });
});
```

- [ ] **Paso 2: implementar** (`fuentes.ts`)

```ts
import type { FuenteOperaciones } from './motor';
import { fuenteCobranzas } from './fuente-cobranzas';
import { fuenteJornadas } from './fuente-jornadas';
import { fuenteProspectos } from './fuente-prospectos';
import { fuenteRutas } from './fuente-rutas';
import { fuenteVentas } from './fuente-ventas';
import type { FuentesConPendientes } from './pendientes';

/**
 * Las fuentes del push, **en el orden en que suben**. Cada fuente manda sus
 * lotes en requests separados, asi que el orden de esta lista es el orden en
 * que el servidor ve las cosas.
 *
 * - Jornadas primero (T-16): las ventas del dia suben despues de la jornada.
 * - **Prospectos antes que ventas (T-75, D3)**: el servidor comprueba el
 *   alcance de los clientes UNA vez por lote, antes de aplicar nada. La venta
 *   de bienvenida a un prospecto capturado sin red apunta a un cliente que
 *   solo existe cuando su alta ya entro; si fuera en el mismo lote o antes,
 *   caeria `cliente-fuera-de-alcance` y entraria hasta la siguiente
 *   sincronizacion.
 * - Cobranzas despues de ventas (T-20): nunca antes que una venta del dia.
 * - Altas de ruta (T-37) no dependen de nadie: al final.
 *
 * Vive aqui y no en `proveedor-sesion.tsx` para que el orden tenga prueba.
 */
export function fuentesDelPush(datos: FuentesConPendientes): FuenteOperaciones[] {
  return [
    fuenteJornadas(datos.jornadas),
    fuenteProspectos(datos.prospectos),
    fuenteVentas(datos.ventas),
    fuenteCobranzas(datos.cobranzas),
    fuenteRutas(datos.rutas),
  ];
}
```

`proveedor-sesion.tsx`: sustituye el arreglo literal y su comentario por `fuentes: fuentesDelPush(datos),` y quita
los imports de las cinco fuentes que queden sin uso.

- [ ] **Paso 3: correr** `npm test --workspace=apps/tablet -- fuentes pendientes motor`, `typecheck`, `lint`.
- [ ] **Paso 4: commit** `T-75: prospectos antes que ventas en el push, con prueba (D3)`.

---

### Tarea 5: Funciones puras de la pantalla: atendidos fuera de ruta y enlace a la ficha (D4, D6, D7)

**Files:**
- Modify: `apps/tablet/src/estado/ruta-del-dia.ts`
- Modify: `apps/tablet/src/estado/ruta-del-dia.spec.ts`

**Interfaces:**
- Consumes: `FilaAgrupable`, `Venta` (`cliente_id`, `sync_estado`), `Cliente` (`nombre`, `tipo`), `Prospecto`
  (`sync_estado`, `sync_error`).
- Produces:
  ```ts
  export type EstadoSubida = 'error' | 'pendiente' | 'listo';
  export function estadoSubida(estados: readonly SyncEstado[]): EstadoSubida | null; // null si vacío
  export interface AtendidoFueraDeRuta { cliente_id: string; nombre: string; esProspecto: boolean; estado: EstadoSubida }
  export function atendidosFueraDeRuta(
    filasRuta: readonly FilaAgrupable[],
    ventas: readonly Pick<Venta, 'cliente_id' | 'sync_estado'>[],
    cliente: (id: string) => Pick<Cliente, 'nombre' | 'tipo'> | null,
  ): AtendidoFueraDeRuta[];
  export function pastillaAlta(p: Pick<Prospecto, 'sync_estado' | 'sync_error'> | null): { texto: string; estado: Estado; detalle: string | null } | null;
  export function enlaceAFicha(prospectoId: string, existeCliente: (id: string) => boolean): string | null;
  ```

- [ ] **Paso 1: pruebas que fallan** (añadir a `ruta-del-dia.spec.ts`)

```ts
describe('estadoSubida (T-75)', () => {
  it('lo mas grave manda: error > pendiente > listo; vacio es null', () => {
    expect(estadoSubida([])).toBeNull();
    expect(estadoSubida(['sincronizado'])).toBe('listo');
    expect(estadoSubida(['sincronizado', 'pendiente'])).toBe('pendiente');
    expect(estadoSubida(['enviando'])).toBe('pendiente');
    expect(estadoSubida(['pendiente', 'error', 'sincronizado'])).toBe('error');
  });
});

describe('atendidosFueraDeRuta (T-75, D7)', () => {
  const cliente = (id: string) =>
    ({
      a: { nombre: 'Abarrotes', tipo: 'cliente' as const },
      p: { nombre: 'Prospecto Z', tipo: 'prospecto' as const },
      z: { nombre: 'Zapateria', tipo: 'cliente' as const },
    })[id] ?? null;
  const venta = (cliente_id: string, sync_estado: 'pendiente' | 'enviando' | 'sincronizado' | 'error' = 'pendiente') => ({ cliente_id, sync_estado });

  it('una venta a un cliente que no esta en la ruta lo lista; el prospecto va marcado', () => {
    const r = atendidosFueraDeRuta([], [venta('z', 'sincronizado'), venta('p')], cliente);
    expect(r).toEqual([
      { cliente_id: 'p', nombre: 'Prospecto Z', esProspecto: true, estado: 'pendiente' },
      { cliente_id: 'z', nombre: 'Zapateria', esProspecto: false, estado: 'listo' },
    ]);
  });

  it('en la ruta viva, o quitado con visita, NO sale: ya lo pinta la ruta (Review Focus 5)', () => {
    const r = atendidosFueraDeRuta(
      [fila('a', 1, false), fila('z', 0, true)],
      [venta('a'), venta('z')],
      cliente,
    );
    expect(r).toEqual([]);
  });

  it('quitado SIN visita y con venta local: sale (la ruta no lo pinta)', () => {
    const r = atendidosFueraDeRuta([fila('a', 0, false)], [venta('a')], cliente);
    expect(r.map((x) => x.cliente_id)).toEqual(['a']);
  });

  it('dos ventas al mismo cliente: una fila con el estado mas grave (Review Focus 4)', () => {
    const r = atendidosFueraDeRuta([], [venta('a', 'sincronizado'), venta('a', 'error')], cliente);
    expect(r).toEqual([{ cliente_id: 'a', nombre: 'Abarrotes', esProspecto: false, estado: 'error' }]);
  });

  it('un cliente que ya no esta en el catalogo local se omite sin tronar', () => {
    expect(atendidosFueraDeRuta([], [venta('fantasma')], cliente)).toEqual([]);
  });
});

describe('pastillaAlta (T-75, D4)', () => {
  it('sin fila de prospecto (bajo de otra tablet) no hay pastilla', () => {
    expect(pastillaAlta(null)).toBeNull();
  });
  it('por subir / subiendo / subido / rechazado con motivo', () => {
    expect(pastillaAlta({ sync_estado: 'pendiente', sync_error: null })).toEqual({ texto: 'alta por subir', estado: 'pendiente', detalle: null });
    expect(pastillaAlta({ sync_estado: 'enviando', sync_error: null })).toEqual({ texto: 'alta subiendo', estado: 'pendiente', detalle: null });
    expect(pastillaAlta({ sync_estado: 'sincronizado', sync_error: null })).toEqual({ texto: 'alta subida', estado: 'listo', detalle: null });
    expect(pastillaAlta({ sync_estado: 'error', sync_error: 'Ese tipo de negocio ya no existe.' })).toEqual({
      texto: 'alta rechazada',
      estado: 'error',
      detalle: 'Ese tipo de negocio ya no existe. Su venta subirá cuando el alta entre.',
    });
  });
});

describe('enlaceAFicha (T-75, D6; Review Focus 2)', () => {
  it('solo si existe el cliente local con ese id (prospectos de antes de T-75 no enlazan)', () => {
    expect(enlaceAFicha('p1', (id) => id === 'p1')).toBe('p1');
    expect(enlaceAFicha('viejo', () => false)).toBeNull();
  });
});
```

- [ ] **Paso 2: implementar** en `ruta-del-dia.ts` (importa `SyncEstado`, `Venta`, `Prospecto` de `@/datos/tipos`
  y `Estado` de `@/ui/pantalla`):

```ts
export type EstadoSubida = 'error' | 'pendiente' | 'listo';

/** Lo mas grave manda (misma regla que "Ventas de hoy" en la ficha). `null` si no hay nada. */
export function estadoSubida(estados: readonly SyncEstado[]): EstadoSubida | null {
  if (estados.length === 0) return null;
  if (estados.includes('error')) return 'error';
  if (estados.some((e) => e === 'pendiente' || e === 'enviando')) return 'pendiente';
  return 'listo';
}

export interface AtendidoFueraDeRuta {
  cliente_id: string;
  nombre: string;
  esProspecto: boolean;
  estado: EstadoSubida;
}

/**
 * Clientes y prospectos con venta del dia en esta tablet que la ruta NO pinta
 * (T-75, D7): ni vivos ni quitados-con-visita (esos ya salen en "Fuera de
 * ruta"). Un quitado sin visita con venta local si sale: la venta es real y la
 * ruta ya no lo muestra. Por nombre; uno por cliente, con el estado mas grave.
 */
export function atendidosFueraDeRuta(
  filasRuta: readonly FilaAgrupable[],
  ventas: readonly Pick<Venta, 'cliente_id' | 'sync_estado'>[],
  cliente: (id: string) => Pick<Cliente, 'nombre' | 'tipo'> | null,
): AtendidoFueraDeRuta[] {
  const pintados = new Set(
    filasRuta.filter((f) => f.activo === 1 || f.visitado).map((f) => f.cliente_id),
  );
  const porCliente = new Map<string, SyncEstado[]>();
  for (const v of ventas) {
    if (pintados.has(v.cliente_id)) continue;
    porCliente.set(v.cliente_id, [...(porCliente.get(v.cliente_id) ?? []), v.sync_estado]);
  }
  const filas: AtendidoFueraDeRuta[] = [];
  for (const [cliente_id, estados] of porCliente) {
    const c = cliente(cliente_id);
    if (!c) continue;
    filas.push({ cliente_id, nombre: c.nombre, esProspecto: c.tipo === 'prospecto', estado: estadoSubida(estados)! });
  }
  return filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** La pastilla del alta del prospecto en su ficha (T-75, D4). `null` si no es de esta tablet. */
export function pastillaAlta(
  p: Pick<Prospecto, 'sync_estado' | 'sync_error'> | null,
): { texto: string; estado: Estado; detalle: string | null } | null {
  if (!p) return null;
  switch (p.sync_estado) {
    case 'pendiente':
      return { texto: 'alta por subir', estado: 'pendiente', detalle: null };
    case 'enviando':
      return { texto: 'alta subiendo', estado: 'pendiente', detalle: null };
    case 'sincronizado':
      return { texto: 'alta subida', estado: 'listo', detalle: null };
    case 'error':
      return {
        texto: 'alta rechazada',
        estado: 'error',
        detalle: `${p.sync_error ?? 'El servidor rechazó el alta.'} Su venta subirá cuando el alta entre.`,
      };
  }
}

/** Id de la ficha a la que enlaza una fila de "Prospectos de hoy", o `null` (T-75, D6). */
export function enlaceAFicha(prospectoId: string, existeCliente: (id: string) => boolean): string | null {
  return existeCliente(prospectoId) ? prospectoId : null;
}
```

- [ ] **Paso 3: correr** `npm test --workspace=apps/tablet -- ruta-del-dia`, `typecheck`, `lint`.
- [ ] **Paso 4: commit** `T-75: atendidos fuera de ruta, pastilla del alta y enlace a la ficha (puros, D4, D6, D7)`.

---

### Tarea 6: Pantallas: "Prospectos" enlaza a la ficha y "Todos los clientes" gana la pestaña Prospectos (D6)

**Files:**
- Modify: `apps/tablet/app/(jornada)/prospectos.tsx`
- Modify: `apps/tablet/app/(jornada)/operacion/index.tsx`

**Interfaces:**
- Consumes: `enlaceAFicha` (Tarea 5), `catalogos.listarProspectos`, `catalogos.obtenerCliente` (Tarea 3),
  `primeraLineaDomicilio`, `Opcion` de `@/ui/opcion`, `router` de `expo-router`.

No hay pruebas de pantalla: el criterio es `typecheck` + `lint` + revisión de lectura + aceptación manual del
controlador. Mantén el estilo de la pantalla (una acción primaria, color + palabra).

- [ ] **Paso 1: `prospectos.tsx`**

1. Estado nuevo `const [ultimoId, setUltimoId] = useState<string | null>(null);`. En `guardar()`, tras
   `setGuardado(...)`: `setUltimoId(p.id);`.
2. La tarjeta "Listo" gana un botón debajo del texto:
   ```tsx
   <Boton
     etiqueta="Abrir su ficha"
     tono="neutra"
     onPress={() => router.push({ pathname: '/(jornada)/operacion/[clienteId]', params: { clienteId: ultimoId! } })}
     estilo={{ marginTop: espacio.sm }}
   />
   ```
   solo si `ultimoId !== null`. Importa `router` de `expo-router`. Comentario: `// T-75 (D6): venderle en cuanto
   se captura; la ficha ya existe porque el alta creo su espejo en cliente.`
3. `FilaProspecto`: calcula
   `const destino = enlaceAFicha(prospecto.id, (id) => datos.catalogos.obtenerCliente(id) !== null);` y, si no es
   `null`, envuelve la `Tarjeta` en un `Pressable` con `accessibilityRole="button"`,
   `accessibilityLabel={`${prospecto.nombre}, abrir ficha`}` y `onPress={() => router.push({ pathname:
   '/(jornada)/operacion/[clienteId]', params: { clienteId: destino } })}`; añade dentro de la tarjeta una línea
   `<Text style={estilos.textoSuave}>Toca para abrir su ficha y darle su bienvenida.</Text>`. Sin enlace (prospecto
   de antes de T-75, Review Focus 2) la fila queda como hoy.

- [ ] **Paso 2: `operacion/index.tsx`**

1. `const [pestana, setPestana] = useState<'clientes' | 'prospectos'>('clientes');`
2. La lista se deriva de la pestaña:
   ```ts
   const lista = useMemo<Cliente[]>(() => {
     void versionCatalogos;
     if (!sucursalId) return [];
     return pestana === 'clientes'
       ? datos.catalogos.listarClientes(sucursalId)
       : datos.catalogos.listarProspectos(sucursalId);
   }, [datos, sucursalId, versionCatalogos, pestana]);
   ```
3. Debajo del subtítulo, una fila de dos `Opcion` (`etiqueta="Clientes"` / `"Prospectos"`, `seleccionada`,
   `onPress`), con `accessibilityRole` ya dado por `Opcion`. El subtítulo dice
   `{lista.length} {pestana === 'clientes' ? 'cliente(s)' : 'prospecto(s)'} en el catálogo local…`.
4. La tarjeta vacía cambia de texto en la pestaña Prospectos: etiqueta "Sin prospectos", texto "No hay prospectos
   en el catálogo local. Los que captures en Prospectos aparecen aquí al guardarlos."
5. `descripcion={primeraLineaDomicilio(cliente.domicilio)}` (importa de `@/estado/ruta-del-dia`) en vez de
   `${cliente.domicilio}`.
6. Actualiza el doc-comment de la pantalla: "T-75: pestañas Clientes | Prospectos; un prospecto llega aquí desde
   que se captura (espejo local) o cuando lo captura otra tablet y baja por pull."

- [ ] **Paso 3:** `npm run typecheck --workspace=apps/tablet && npm run lint --workspace=apps/tablet && npm test --workspace=apps/tablet`.
- [ ] **Paso 4: commit** `T-75: Prospectos enlaza a la ficha; Todos los clientes con pestaña Prospectos (D6)`.

---

### Tarea 7: Pantallas: ficha del prospecto y "Atendidos fuera de ruta" (D4, D6, D7)

**Files:**
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx`
- Modify: `apps/tablet/app/(jornada)/index.tsx`
- Modify: `apps/tablet/src/ui/lista-ruta.tsx` (fila nueva)

**Interfaces:**
- Consumes: `pastillaAlta`, `atendidosFueraDeRuta`, `AtendidoFueraDeRuta` (Tarea 5), `prospectos.porId`,
  `ventas.delDiaDelVendedor` (Tarea 3), `vendedor` de `useJawa()`.

- [ ] **Paso 1: ficha** (`[clienteId]/index.tsx`)

1. `const esProspecto = cliente.tipo === 'prospecto';` después del `if (!cliente)`.
2. `const alta = esProspecto ? pastillaAlta(datos.prospectos.porId(cliente.id)) : null;` (dentro del `useMemo`
   de `hoy` o con las mismas dependencias: `ultimaSincronizacion` cambia la pastilla cuando el push termina).
3. Subtítulo: si `esProspecto`, antepone "Prospecto · " al texto actual.
4. Tarjeta "Promociones": si `alta !== null`, debajo de las frases:
   ```tsx
   <Pastilla texto={alta.texto} estado={alta.estado} />
   {alta.detalle ? <Text style={estilos.textoSuave}>{alta.detalle}</Text> : null}
   ```
5. Botones: "Cobrar" y "Merma, promoción, consumo y gasto" **no se pintan** si `esProspecto` (comentario: `// T-75
   (D6): un prospecto no tiene notas ni inventario que ajustar; la conversion es del portal.`). "Vender" cambia su
   `descripcion` a "Solo regalo de bienvenida: el prospecto no tiene lista de precios" cuando `esProspecto`.
6. Tarjetas "Notas pendientes" y "Cobros de hoy": no se pintan si `esProspecto`.

- [ ] **Paso 2: fila nueva** (`lista-ruta.tsx`)

```tsx
/** Un cliente o prospecto con venta de hoy que no esta en la ruta (T-75, D7). */
export function FilaAtendidoFueraDeRuta({
  fila,
  onTocar,
}: {
  fila: AtendidoFueraDeRuta;
  onTocar: (clienteId: string) => void;
}) {
  const { t } = useTema();
  const pastilla = { error: 'con error', pendiente: 'por subir', listo: 'subido' }[fila.estado];
  // `EstadoSubida` es un subconjunto de `Estado`: la pastilla lo recibe tal cual.
  const estado: Estado = fila.estado;
  return (
    <Pressable
      onPress={() => onTocar(fila.cliente_id)}
      accessibilityRole="button"
      accessibilityLabel={`${fila.nombre}, atendido fuera de ruta, ${pastilla}`}
      style={({ pressed }) => [ /* mismos estilos que FilaFueraDeRuta */ ]}
    >
      <View style={{ flex: 1, gap: espacio.xs }}>
        <Text numberOfLines={1} style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}>
          {fila.nombre}
        </Text>
        <View style={{ flexDirection: 'row', gap: espacio.xs }}>
          {fila.esProspecto ? <Pastilla texto="prospecto" estado="neutro" /> : null}
          <Pastilla texto={pastilla} estado={estado} />
        </View>
      </View>
    </Pressable>
  );
}
```

- [ ] **Paso 3: pantalla de la jornada** (`index.tsx`)

```ts
  // T-75 (D7): a quien se le vendio hoy sin estar en la ruta (prospectos de bienvenida incluidos).
  const atendidos = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    void ultimaSincronizacion;
    if (!vendedor) return [];
    return atendidosFueraDeRuta(filas, datos.ventas.delDiaDelVendedor(vendedor.id), (id) =>
      datos.catalogos.obtenerCliente(id),
    );
  }, [datos, filas, vendedor, vueltas, versionCatalogos, ultimaSincronizacion]);
```

y, después del bloque "Fuera de ruta":

```tsx
        {atendidos.length > 0 ? (
          <View style={{ gap: espacio.sm, marginTop: espacio.lg }}>
            <Text style={estilos.seccion}>Atendidos fuera de ruta</Text>
            {atendidos.map((a) => (
              <FilaAtendidoFueraDeRuta key={a.cliente_id} fila={a} onTocar={abrirCliente} />
            ))}
          </View>
        ) : null}
```

`sinRuta` **no** cambia (la ruta vacía sigue mostrando su aviso aunque haya atendidos).

- [ ] **Paso 4:** `typecheck`, `lint`, `test` de la tablet en verde.
- [ ] **Paso 5: commit** `T-75: ficha del prospecto (pastilla del alta, sin cobranza) y Atendidos fuera de ruta (D4, D6, D7)`.

---

### Tarea 8: Documentación del repo (CLAUDE.md, README de la tablet, spec)

**Files:**
- Modify: `CLAUDE.md` (nuevo bloque después del de Promociones T-74)
- Modify: `apps/tablet/README.md` (sección "Ruta del día y pantalla principal (T-37)" y una nueva "Prospectos: venderles desde que se capturan (T-75)")
- Modify: `docs/superpowers/specs/2026-10-14-t-75-camino-prospecto-design.md` (solo si la ejecución cambió algo: anotar la enmienda bajo "Decisiones")

- [ ] **Paso 1: `CLAUDE.md`**, bloque `- **Prospectos desde la app: venta desde que se capturan (T-75).**` con cuatro viñetas:
  (1) la tablet crea el espejo en `cliente` con el mismo id al guardar el alta (D1); (2) el servidor adopta la
  clave como `cliente.id`, exige UUID y rechaza choques con motivo (D2) — sin cambio de contrato; (3) el push sube
  **prospectos antes que ventas** (`src/sincronizacion/fuentes.ts`, con prueba): el alcance se comprueba una vez
  por lote, no lo reordenes (D3); (4) el prospecto no entra a la ruta; se atiende desde su ficha, y "Atendidos fuera
  de ruta" lo muestra (D5, D7). Enlaza el spec.
- [ ] **Paso 2: `apps/tablet/README.md`**: en la tabla de la capa de datos, `fuentes.ts`; sección nueva con el
  flujo de aceptación del spec resumido (captura → ficha → venta solo regalo → sincroniza → pestaña Prospectos) y la
  nota de los prospectos de antes de T-75 (sin enlace desde "Prospectos de hoy").
- [ ] **Paso 3: commit** `T-75: documentación (CLAUDE.md, README de la tablet)`.

---

## Conflictos para el controlador

- **`fotoLocalDe` cambia de firma** (gana `id`). Hoy solo la ficha la llama con el `cliente` completo: compila. Si
  otra pantalla la llamara con `{ nombre, telefono }`, la Tarea 3 debe añadirle el `id` real, nunca uno inventado.
- **`contarPendientesDeSubir` y `fuentesDelPush`** comparten el tipo `FuentesConPendientes` pero son dos listas; si
  un ticket futuro suma una fuente tiene que tocar las dos. Se deja así a propósito (una cuenta, la otra ordena).
- **El e2e de la Tarea 2 depende de que `revisarLineas` no exija precio con `cantidad = 0`.** Verificado en el
  código al planificar; si cambió, el implementador para y reporta.
- **Vault**: las notas (`T-40 Registro de Prospectos`, `Promociones`, `Rutas`, `App Tablet`, `Cliente`, Estado,
  bitácora) las actualiza el controlador tras la revisión final, no un subagente (repo aparte).
- **Aceptación manual en el emulador** (flujo de 9 pasos del spec): la hace el controlador después de la revisión
  final, con capturas, como en T-74.
