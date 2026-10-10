# T-69 · Encargado obligatorio en Cliente y Prospecto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer obligatorio el campo **Encargado** al dar de alta un [[Cliente]] desde el Portal Web (T-12) y un Prospecto desde la App Tablet (T-40) — hoy es opcional en los dos.

**Architecture:** Mismo criterio que T-68 (placas de Vehículo) y que ya usa esta base para `vehiculo.km_inicial`: la columna `cliente.encargado` se queda **nullable** en Postgres — ya hay clientes/prospectos dados de alta sin el dato y no se inventa uno para ellos — y la obligatoriedad se exige en la **capa de captura**: los DTOs del Portal, la validación del `push` de la app en el backend, y el repositorio local SQLite de la tablet. El contrato de sincronización (`DatosProspecto.encargado`) se endurece de `string | null` a `string`, igual que ya están tipados `nombre` y `telefono` en ese mismo tipo — es tipo lógico (garantizado por quien escribe), no un reflejo literal de la columna SQL.

**Tech Stack:** NestJS + class-validator (backend), Next.js (portal), React Native/Expo + SQLite (tablet), Jest/Supertest + pgTAP (pruebas).

**Spec:** GitHub issue [T-69 (#99)](https://github.com/robertopeiro12/proyecto-sinmex/issues/99). Confirmado verbalmente por el cliente en junta con Roberto el 2026-09-29.

## Global Constraints

- La columna `cliente.encargado` **no cambia** en Postgres (sigue `text`, nullable). No hay migración de base en este plan.
- `encargado` pasa a **obligatorio** en `CrearClienteDto` y `EditarClienteDto` del Portal — mismo patrón que `nombre`, que ya es `@MinLength(1)` no opcional en los dos (recordar: `EditarClienteDto` manda el **estado completo** en cada guardado, a diferencia de `EditarVehiculoDto`, que es PATCH parcial).
- `encargado` pasa a **obligatorio** en `normalizarDatosProspecto` (validación del `push`, backend) y en `RepositorioProspectos.registrar()` (validación local, tablet) — mismo patrón que `telefono` en esos dos archivos.
- El tipo `DatosProspecto.encargado` del contrato de sincronización pasa de `string | null` a `string`. **Se tocan los dos archivos duplicados** (`apps/backend/src/modules/sincronizacion/contrato.ts` y `apps/tablet/src/sincronizacion/contrato.ts`) **y** `docs/contrato-sincronizacion.md` **en el mismo commit** — regla explícita del `CLAUDE.md` del repo.
- No se toca el tipo `Cliente.encargado: string | null` (catálogo que **baja** por el `pull`) ni `ClienteDetalle.encargado: string | null` (respuesta del Portal): esos representan filas que ya existen y pueden legítimamente no tener el dato.
- Tope de longitud sin cambio: 120 caracteres (`LARGO_MAX_ENCARGADO`, ya existe en tres archivos).

## Review Focus

- Un Cliente o Prospecto **ya existente** sin encargado (dado de alta antes de este cambio) no debe bloquearse al editar otro campo — para Prospecto esto no aplica (la app no tiene edición de prospectos ya capturados), pero para Cliente sí: `EditarClienteDto` exige el estado completo, así que el formulario del Portal debe **mostrar el campo vacío y dejar que el administrador lo llene** en ese guardado, no debe romper la pantalla ni impedir abrir el formulario de edición.
- El botón "Guardar prospecto" de la app debe quedar deshabilitado sin encargado, **igual que ya lo está sin nombre o sin teléfono** — no basta con que el backend lo rechace después.
- El `push` de un prospecto sin encargado debe rechazarse **por operación** (`datos-invalidos`, motivo `encargado: ...`), nunca tumbar el lote completo — mismo contrato que ya cubre `nombre` y `telefono`.
- El contrato de sincronización duplicado (backend + tablet) no puede quedar desincronizado: si uno de los dos types cambia y el otro no, el `tsc --noEmit` de la tablet no lo detecta porque son archivos independientes — hay que tocar los dos a mano.
- Los fixtures compartidos de las pruebas e2e (`datosMinimos`/`cambios` en `clientes.e2e-spec.ts`, `alta()` en `prospectos.e2e-spec.ts`) ya usan `encargado` con un valor por defecto en casi todos los casos — verificar que **ningún** test que hoy pasa por otra razón (no por encargado) empiece a fallar por el campo nuevo.

---

## Task 1: Backend — Portal (CrearClienteDto / EditarClienteDto / ClientesService)

**Files:**
- Modify: `apps/backend/src/modules/cartera-clientes/dto/crear-cliente.dto.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/dto/editar-cliente.dto.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/clientes.service.ts`

**Interfaces:**
- Produces: `CrearClienteDto.encargado: string` (obligatorio), `EditarClienteDto.encargado: string` (obligatorio, parte del estado completo). Task 6 (Portal) y Task 7 (e2e) consumen esta forma.

- [ ] **Step 1: `CrearClienteDto`**

Modify `apps/backend/src/modules/cartera-clientes/dto/crear-cliente.dto.ts`. El bloque de `encargado` pasa de:

```ts
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(120, {
    message: 'El nombre del encargado no puede pasar de 120 caracteres.',
  })
  encargado?: string;
```

a:

```ts
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del encargado es obligatorio.' })
  @MaxLength(120, {
    message: 'El nombre del encargado no puede pasar de 120 caracteres.',
  })
  encargado!: string;
```

- [ ] **Step 2: `EditarClienteDto`**

Modify `apps/backend/src/modules/cartera-clientes/dto/editar-cliente.dto.ts`. Mismo cambio: quitar `@IsOptional()`, agregar `@MinLength(1, ...)`, y el campo pasa de `encargado?: string;` a `encargado!: string;`.

- [ ] **Step 3: `ClientesService` — quitar el `?? null`**

Modify `apps/backend/src/modules/cartera-clientes/clientes.service.ts`. Hay dos ocurrencias de `encargado: dto.encargado ?? null,` (en `crear()` y en `editar()`) — las dos pasan a `encargado: dto.encargado,` (ya no puede ser `undefined`, el DTO lo garantiza).

- [ ] **Step 4: Compilar**

Run: `npm run build --workspace=apps/backend`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/cartera-clientes/dto/crear-cliente.dto.ts apps/backend/src/modules/cartera-clientes/dto/editar-cliente.dto.ts apps/backend/src/modules/cartera-clientes/clientes.service.ts
git commit -m "T-69: encargado obligatorio en el alta/edicion de Cliente (Portal)"
```

---

## Task 2: Backend — validación del alta de Prospecto (push de la app)

**Files:**
- Modify: `apps/backend/src/modules/cartera-clientes/datos-prospecto.ts`
- Modify: `apps/backend/src/modules/cartera-clientes/datos-prospecto.spec.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `ProspectoNormalizado.encargado: string` (era `string | null`). Task 3 (contrato) y `ClientesService.crearProspecto` (sin cambios, ya reenvía `prospecto.encargado` tal cual) dependen de este tipo.

- [ ] **Step 1: `ProspectoNormalizado` y la validación**

Modify `apps/backend/src/modules/cartera-clientes/datos-prospecto.ts`. La interfaz pasa de:

```ts
  /** Nombre del encargado. */
  encargado: string | null;
```

a:

```ts
  /** Nombre del encargado: quien atiende el negocio. Obligatorio. */
  encargado: string;
```

El bloque de validación, dentro de `normalizarDatosProspecto`, pasa de:

```ts
  const encargado = opcional('encargado', datos.encargado, LARGO_MAX_ENCARGADO);
  if (!encargado.ok) return encargado.error;
```

a (mismo patrón que el bloque de `telefono`, unas líneas arriba en el mismo archivo):

```ts
  // Obligatorio desde el 2026-09-29 (confirmado por el cliente en junta con
  // Roberto): antes era opcional aqui y en el alta de Cliente del Portal
  // (T-12). Ver el `[!warning]` en `Cliente.md` del vault.
  const encargado = texto(datos.encargado);
  if (encargado === null) {
    return invalido('encargado', 'es obligatorio: quien atiende el negocio.');
  }
  if (encargado.length > LARGO_MAX_ENCARGADO) {
    return invalido(
      'encargado',
      `no puede pasar de ${LARGO_MAX_ENCARGADO} caracteres.`,
    );
  }
```

Y el `return` final de la función pasa de:

```ts
  return {
    ok: true,
    prospecto: {
      nombre,
      telefono,
      encargado: encargado.valor,
      tipoNegocioId,
      comentarios: comentarios.valor,
      lat: ubicacion.lat,
      lng: ubicacion.lng,
    },
  };
```

a (ya no hay `.valor`: `texto()` devuelve el string directo, no un objeto resultado):

```ts
  return {
    ok: true,
    prospecto: {
      nombre,
      telefono,
      encargado,
      tipoNegocioId,
      comentarios: comentarios.valor,
      lat: ubicacion.lat,
      lng: ubicacion.lng,
    },
  };
```

- [ ] **Step 2: Reescribir `datos-prospecto.spec.ts`**

Reemplazar el archivo completo:

```ts
import { normalizarDatosProspecto } from './datos-prospecto';

/** Lo minimo que el contrato manda para un prospecto. */
const minimo = {
  nombre: 'Tacos Aaron',
  telefono: '6641112233',
  encargado: 'Don Aaron',
};

function bueno(datos: Record<string, unknown>) {
  const r = normalizarDatosProspecto(datos);
  if (!r.ok) throw new Error(`se esperaba ok, llego: ${r.motivo}`);
  return r.prospecto;
}

function malo(datos: Record<string, unknown>, campo: string) {
  const r = normalizarDatosProspecto(datos);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.campo).toBe(campo);
  // El motivo empieza por el campo: es lo que la tablet guarda en `sync_error` y
  // lo que el vendedor acaba leyendo.
  expect(r.motivo.startsWith(`${campo}:`)).toBe(true);
}

describe('normalizarDatosProspecto', () => {
  it('lo minimo: nombre, telefono y encargado', () => {
    expect(bueno(minimo)).toEqual({
      nombre: 'Tacos Aaron',
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipoNegocioId: null,
      comentarios: null,
      lat: null,
      lng: null,
    });
  });

  it('normaliza los siete campos que dicto el cliente (menos la foto)', () => {
    expect(
      bueno({
        nombre: '  Tacos Aaron  ',
        telefono: ' 664-111-2233 ',
        encargado: ' Don Aaron ',
        tipo_negocio_id: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        comentarios: '  Quiere probar jamaica  ',
        lat: 32.5149,
        lng: -117.0382,
      }),
    ).toEqual({
      nombre: 'Tacos Aaron',
      telefono: '664-111-2233',
      encargado: 'Don Aaron',
      // En minusculas: Postgres compara uuid sin importar mayusculas.
      tipoNegocioId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      comentarios: 'Quiere probar jamaica',
      lat: 32.5149,
      lng: -117.0382,
    });
  });

  it('la foto que manda la tablet se ignora: todavia no se guarda en ningun lado', () => {
    // El contrato reserva `foto: null` para no tener que cambiar el sobre el dia
    // que se decida donde vive el archivo. Mandarla no es un error.
    expect(bueno({ ...minimo, foto: null }).nombre).toBe('Tacos Aaron');
    expect(bueno({ ...minimo, foto: 'file:///tmp/x.jpg' }).nombre).toBe(
      'Tacos Aaron',
    );
  });

  describe('nombre del negocio', () => {
    it('es obligatorio', () => {
      malo({ telefono: '664', encargado: 'Don Aaron' }, 'nombre');
      malo({ nombre: '   ', telefono: '664', encargado: 'Don Aaron' }, 'nombre');
      malo({ nombre: 42, telefono: '664', encargado: 'Don Aaron' }, 'nombre');
    });

    it('tiene tope de largo', () => {
      malo(
        { nombre: 'x'.repeat(201), telefono: '664', encargado: 'Don Aaron' },
        'nombre',
      );
      expect(
        bueno({ nombre: 'x'.repeat(200), telefono: '664', encargado: 'Don Aaron' })
          .nombre,
      ).toHaveLength(200);
    });
  });

  describe('telefono', () => {
    it('es obligatorio: `cliente.telefono` sigue siendo not null', () => {
      malo({ nombre: 'Tacos', encargado: 'Don Aaron' }, 'telefono');
      malo({ nombre: 'Tacos', telefono: '  ', encargado: 'Don Aaron' }, 'telefono');
    });

    it('tiene tope de largo', () => {
      malo(
        { nombre: 'Tacos', telefono: '6'.repeat(31), encargado: 'Don Aaron' },
        'telefono',
      );
    });
  });

  describe('encargado', () => {
    // Obligatorio desde el 2026-09-29 (T-69, confirmado por el cliente en
    // junta): antes vivia en "campos opcionales de texto", junto a
    // `comentarios`. Mismas pruebas que `telefono` de arriba, adaptadas.
    it('es obligatorio', () => {
      malo({ nombre: 'Tacos', telefono: '664' }, 'encargado');
      malo({ nombre: 'Tacos', telefono: '664', encargado: '  ' }, 'encargado');
    });

    it('un tipo que no es texto se rechaza en vez de convertirse', () => {
      malo({ ...minimo, encargado: 7 }, 'encargado');
    });

    it('tiene tope de largo', () => {
      malo({ ...minimo, encargado: 'x'.repeat(121) }, 'encargado');
      expect(
        bueno({ ...minimo, encargado: 'x'.repeat(120) }).encargado,
      ).toHaveLength(120);
    });
  });

  describe('campos opcionales de texto', () => {
    it('ausente, null y vacio se guardan como null', () => {
      for (const valor of [undefined, null, '', '   ']) {
        const p = bueno({ ...minimo, comentarios: valor });
        expect(p.comentarios).toBeNull();
      }
    });

    it('un tipo que no es texto se rechaza en vez de convertirse', () => {
      malo({ ...minimo, comentarios: { a: 1 } }, 'comentarios');
    });

    it('tienen tope de largo', () => {
      malo({ ...minimo, comentarios: 'x'.repeat(501) }, 'comentarios');
    });
  });

  describe('tipo_negocio_id', () => {
    it('es opcional: [[Cliente]] no lo hace obligatorio', () => {
      expect(bueno(minimo).tipoNegocioId).toBeNull();
      expect(
        bueno({ ...minimo, tipo_negocio_id: null }).tipoNegocioId,
      ).toBeNull();
    });

    /**
     * Sin esta comprobacion, `where id = 'abc'` no devuelve cero filas: hace que
     * Postgres reviente con 22P02, y eso seria un **500 para todo el lote** — el
     * todo-o-nada que el contrato promete no hacer. La tablet ademas traduce un
     * 5xx a "sin red" y reintentaria para siempre en silencio.
     */
    it('un uuid mal formado se rechaza ANTES de llegar a Postgres', () => {
      malo({ ...minimo, tipo_negocio_id: 'abc' }, 'tipo_negocio_id');
      malo({ ...minimo, tipo_negocio_id: '' }, 'tipo_negocio_id');
      malo({ ...minimo, tipo_negocio_id: 12 }, 'tipo_negocio_id');
      malo(
        { ...minimo, tipo_negocio_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeeg' },
        'tipo_negocio_id',
      );
    });
  });

  describe('ubicacion', () => {
    it('sin ubicacion es un caso normal: el vendedor pudo negar el permiso', () => {
      expect(bueno(minimo)).toMatchObject({ lat: null, lng: null });
      expect(bueno({ ...minimo, lat: null, lng: null })).toMatchObject({
        lat: null,
        lng: null,
      });
    });

    it('media coordenada se rechaza: no ubica nada y parece un dato bueno', () => {
      malo({ ...minimo, lat: 32.5 }, 'lat/lng');
      malo({ ...minimo, lng: -117 }, 'lat/lng');
      malo({ ...minimo, lat: 32.5, lng: null }, 'lat/lng');
    });

    it('acepta el 0 en las dos (isla Null, pero es una coordenada valida)', () => {
      expect(bueno({ ...minimo, lat: 0, lng: 0 })).toMatchObject({
        lat: 0,
        lng: 0,
      });
    });

    /**
     * `numeric(9,6)` de Postgres desborda con 22003, que seria otro 500 para
     * todo el lote. Se cortan en los rangos reales de la Tierra, que son mas
     * estrictos: una latitud de 200 no es una coordenada.
     */
    it('rechaza lo que no cabe en numeric(9,6) ni en la Tierra', () => {
      malo({ ...minimo, lat: 91, lng: 0 }, 'lat');
      malo({ ...minimo, lat: -91, lng: 0 }, 'lat');
      malo({ ...minimo, lat: 0, lng: 181 }, 'lng');
      malo({ ...minimo, lat: 0, lng: -181 }, 'lng');
      expect(bueno({ ...minimo, lat: 90, lng: -180 })).toMatchObject({
        lat: 90,
        lng: -180,
      });
    });

    it('rechaza NaN e Infinity, que Postgres aceptaria en un numeric', () => {
      malo({ ...minimo, lat: Number.NaN, lng: 0 }, 'lat');
      malo({ ...minimo, lat: 0, lng: Number.POSITIVE_INFINITY }, 'lng');
    });

    it('rechaza una coordenada que viaja como texto: el contrato manda numeros', () => {
      malo({ ...minimo, lat: '32.5149', lng: '-117.0382' }, 'lat');
    });
  });
});
```

- [ ] **Step 3: Correr el archivo**

Run: `npm test --workspace=apps/backend -- datos-prospecto.spec.ts`
Expected: todo en verde.

- [ ] **Step 4: Correr `crear-prospecto.spec.ts` (no debería necesitar cambios)**

Run: `npm test --workspace=apps/backend -- crear-prospecto.spec.ts`
Expected: en verde sin tocar el archivo — su factory `prospecto()` ya pone `encargado: 'Don Aaron'` por defecto, así que sigue siendo compatible con el tipo `string`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/cartera-clientes/datos-prospecto.ts apps/backend/src/modules/cartera-clientes/datos-prospecto.spec.ts
git commit -m "T-69: encargado obligatorio en el alta de Prospecto (push de la app)"
```

---

## Task 3: Contrato de sincronización (backend + tablet + docs, mismo commit)

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts`
- Modify: `apps/tablet/src/sincronizacion/contrato.ts`
- Modify: `docs/contrato-sincronizacion.md`

**Interfaces:**
- Produces: `DatosProspecto.encargado: string` (era `string | null`) en los dos archivos, idénticos. Task 4 (`fuente-prospectos.ts` de la tablet) consume este tipo.

- [ ] **Step 1: `apps/backend/src/modules/sincronizacion/contrato.ts`**

El campo `nombre` de `DatosProspecto` pierde su comentario de "lo unico obligatorio junto al telefono" (ya no es exacto: ahora son tres), y `encargado` pasa de `string | null` a `string`:

```ts
export type DatosProspecto = {
  /** Nombre del negocio. */
  nombre: string;
  telefono: string;
  /**
   * Nombre del encargado: quien atiende el negocio. Obligatorio junto con
   * `nombre` y `telefono` (confirmado por el cliente en junta, 2026-09-29 —
   * antes era opcional).
   */
  encargado: string;
  /** Del catalogo `tipos_negocio` que baja en el `pull`. */
  tipo_negocio_id: string | null;
  comentarios: string | null;
```

(El resto del `type` — `lat`, `lng`, `foto` — no cambia.)

- [ ] **Step 2: `apps/tablet/src/sincronizacion/contrato.ts`**

Aplicar exactamente el mismo cambio del Step 1 — es la copia normativa duplicada a propósito (Metro no puede importar del backend).

- [ ] **Step 3: `docs/contrato-sincronizacion.md`**

La línea del ejemplo JSON de la sección `### \`tipo: "prospecto"\`` pasa de:

```
    "encargado": "Don Aarón",          // o null
```

a:

```
    "encargado": "Don Aarón",          // obligatorio
```

- [ ] **Step 4: Verificar que los dos `contrato.ts` quedaron idénticos en el campo `DatosProspecto`**

Run: `diff <(sed -n '/^export type DatosProspecto/,/^};/p' apps/backend/src/modules/sincronizacion/contrato.ts) <(sed -n '/^export type DatosProspecto/,/^};/p' apps/tablet/src/sincronizacion/contrato.ts)`
Expected: sin diferencias.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/sincronizacion/contrato.ts apps/tablet/src/sincronizacion/contrato.ts docs/contrato-sincronizacion.md
git commit -m "T-69: contrato de sincronizacion - encargado obligatorio (backend + tablet + docs)"
```

---

## Task 4: Tablet — repositorio local de Prospectos

**Files:**
- Modify: `apps/tablet/src/datos/repositorios/prospectos.ts`
- Modify: `apps/tablet/src/datos/repositorios/prospectos.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/motor.spec.ts`

**Interfaces:**
- Consumes: `DatosProspecto` de `apps/tablet/src/sincronizacion/contrato.ts` (Task 3, vía `fuente-prospectos.ts`, sin cambios propios — ya compila porque `Prospecto.encargado` pasa a `string`).
- Produces: `DatosRegistroProspecto.encargado: string` (era `string | null`), `Prospecto.encargado: string` (era `string | null`, en `apps/tablet/src/datos/tipos.ts`). Task 5 (pantalla) consume esta forma.

- [ ] **Step 1: `apps/tablet/src/datos/tipos.ts` — tipo `Prospecto.encargado`**

El campo (línea 231, dentro de `interface Prospecto`) pasa de:

```ts
  encargado: string | null;
```

a:

```ts
  encargado: string;
```

- [ ] **Step 2: `apps/tablet/src/datos/repositorios/prospectos.ts` — tipo e implementación**

La interfaz `DatosRegistroProspecto` pasa de:

```ts
  telefono: string;
  encargado: string | null;
  tipoNegocioId: string | null;
```

a:

```ts
  telefono: string;
  encargado: string;
  tipoNegocioId: string | null;
```

El bloque de validación dentro de `registrar()` pasa de:

```ts
      const encargado = recortar(datos.encargado);
      if (encargado !== null && encargado.length > LARGO_MAX_ENCARGADO) {
        throw new ErrorProspecto(
          `El nombre del encargado no puede pasar de ${LARGO_MAX_ENCARGADO} caracteres.`,
        );
      }
```

a (mismo patrón que el bloque de `telefono`, unas líneas arriba en el mismo archivo):

```ts
      const encargado = recortar(datos.encargado);
      if (encargado === null) {
        throw new ErrorProspecto('Captura el nombre del encargado.');
      }
      if (encargado.length > LARGO_MAX_ENCARGADO) {
        throw new ErrorProspecto(
          `El nombre del encargado no puede pasar de ${LARGO_MAX_ENCARGADO} caracteres.`,
        );
      }
```

(El resto de `registrar()` no cambia: el `insert` ya usa `$encargado: encargado`, y ahora `encargado` es `string`, compatible.)

- [ ] **Step 3: Reescribir las dos pruebas afectadas en `prospectos.spec.ts`**

El test `'el nombre del negocio y el telefono son obligatorios'` (dentro de `describe('registrar', ...)`) pasa de:

```ts
    it('el nombre del negocio y el telefono son obligatorios', () => {
      const { prospectos } = montar();

      expect(() => prospectos.registrar(captura({ nombre: '   ' }))).toThrow(
        ErrorProspecto,
      );
      expect(() => prospectos.registrar(captura({ telefono: '' }))).toThrow(
        /teléfono/i,
      );
    });
```

a:

```ts
    it('el nombre del negocio, el telefono y el encargado son obligatorios', () => {
      const { prospectos } = montar();

      expect(() => prospectos.registrar(captura({ nombre: '   ' }))).toThrow(
        ErrorProspecto,
      );
      expect(() => prospectos.registrar(captura({ telefono: '' }))).toThrow(
        /teléfono/i,
      );
      expect(() => prospectos.registrar(captura({ encargado: '   ' }))).toThrow(
        /encargado/i,
      );
    });
```

El test `'recorta los espacios y guarda los opcionales vacios como null'` pasa de:

```ts
    it('recorta los espacios y guarda los opcionales vacios como null', () => {
      const { prospectos } = montar();

      const p = prospectos.registrar(
        captura({
          nombre: '  Tacos Aaron  ',
          telefono: ' 664 ',
          encargado: '   ',
          comentarios: '',
        }),
      );

      expect(p).toMatchObject({
        nombre: 'Tacos Aaron',
        telefono: '664',
        encargado: null,
        comentarios: null,
      });
    });
```

a (`encargado` ya no es un "opcional vacío": se recorta, pero deja de tener sentido probarlo vacío en este test — su caso vacío ya vive en el test de "obligatorios" de arriba):

```ts
    it('recorta los espacios y guarda los opcionales vacios como null', () => {
      const { prospectos } = montar();

      const p = prospectos.registrar(
        captura({
          nombre: '  Tacos Aaron  ',
          telefono: ' 664 ',
          encargado: '  Don Aaron  ',
          comentarios: '',
        }),
      );

      expect(p).toMatchObject({
        nombre: 'Tacos Aaron',
        telefono: '664',
        encargado: 'Don Aaron',
        comentarios: null,
      });
    });
```

(El test `'respeta los mismos topes de largo que el servidor'`, más abajo en el mismo archivo, no cambia: ya prueba `captura({ encargado: 'x'.repeat(121) })` esperando `toThrow`, y eso sigue siendo válido tal cual.)

- [ ] **Step 4: `motor.spec.ts` — el fixture `conProspectoConFoto`**

En `apps/tablet/src/sincronizacion/motor.spec.ts`, dentro de la función `conProspectoConFoto`, el literal pasado a `prospectos.registrar({...})` cambia `encargado: null,` por `encargado: 'Don Aaron',`.

- [ ] **Step 5: Correr las pruebas de la tablet**

Run: `npm test --workspace=apps/tablet -- prospectos.spec.ts motor.spec.ts fuente-prospectos.spec.ts`
Expected: todo en verde. `fuente-prospectos.spec.ts` no necesita edición — su factory `captura()` ya pone `encargado: 'Don Aaron'` por defecto.

- [ ] **Step 6: Typecheck completo de la tablet**

Run: `npm run typecheck --workspace=apps/tablet`
Expected: sin errores. Esto confirma que `fuente-prospectos.ts` (que asigna `encargado: p.encargado` al `DatosProspecto` del contrato) sigue compilando: `Prospecto.encargado` (Step 1) y `DatosProspecto.encargado` (Task 3) son ahora los dos `string`.

- [ ] **Step 7: Commit**

```bash
git add apps/tablet/src/datos/tipos.ts apps/tablet/src/datos/repositorios/prospectos.ts apps/tablet/src/datos/repositorios/prospectos.spec.ts apps/tablet/src/sincronizacion/motor.spec.ts
git commit -m "T-69: encargado obligatorio en el repositorio local de Prospectos (tablet)"
```

---

## Task 5: Tablet — pantalla de Prospectos

**Files:**
- Modify: `apps/tablet/app/(jornada)/prospectos.tsx`

**Interfaces:**
- Consumes: `datos.prospectos.registrar()` con `encargado: string` (Task 4).

- [ ] **Step 1: Habilitar el botón solo con encargado capturado**

`puedeGuardar` pasa de:

```tsx
  const puedeGuardar =
    vendedor !== null &&
    sucursalId !== null &&
    nombre.trim() !== '' &&
    telefono.trim() !== '';
```

a:

```tsx
  const puedeGuardar =
    vendedor !== null &&
    sucursalId !== null &&
    nombre.trim() !== '' &&
    telefono.trim() !== '' &&
    encargado.trim() !== '';
```

- [ ] **Step 2: Quitar "(opcional)" del placeholder**

El `<Campo etiqueta="Encargado" ... />` pasa de:

```tsx
      <Campo
        etiqueta="Encargado"
        value={encargado}
        onChangeText={setEncargado}
        placeholder="Quién atiende (opcional)"
        autoCapitalize="words"
      />
```

a:

```tsx
      <Campo
        etiqueta="Encargado"
        value={encargado}
        onChangeText={setEncargado}
        placeholder="Quién atiende"
        autoCapitalize="words"
      />
```

- [ ] **Step 3: `guardar()` ya no manda `null`**

Dentro de `guardar()`, la llamada a `datos.prospectos.registrar({...})` pasa la línea:

```tsx
        encargado: encargado.trim() === '' ? null : encargado,
```

a:

```tsx
        encargado: encargado.trim(),
```

(El botón ya garantiza que no está vacío por `puedeGuardar`; el repositorio de Task 4 es el respaldo si algo más llamara a `registrar()` directamente.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace=apps/tablet`
Expected: sin errores (ya se corrió en Task 4 Step 6, pero este archivo es el que realmente ejercita el tipo `string` no-nulo end to end).

- [ ] **Step 5: Commit**

```bash
git add "apps/tablet/app/(jornada)/prospectos.tsx"
git commit -m "T-69: encargado obligatorio en la pantalla de Prospectos"
```

---

## Task 6: Portal Web — formulario y lib de Cliente

**Files:**
- Modify: `apps/portal/src/lib/clientes.ts`
- Modify: `apps/portal/src/components/clientes/formulario-cliente.tsx`

**Interfaces:**
- Consumes: `POST /clientes` y `PATCH /clientes/:id` con `encargado` obligatorio (Task 1).

- [ ] **Step 1: `lib/clientes.ts`**

`DatosClienteFormulario.encargado` pasa de:

```ts
  encargado?: string;
```

a:

```ts
  encargado: string;
```

- [ ] **Step 2: `formulario-cliente.tsx` — el payload**

Dentro de `alEnviar`, la línea:

```tsx
      encargado: encargado.trim() === "" ? undefined : encargado,
```

pasa a (mismo patrón que `nombre`/`domicilio`/`telefono`, que se mandan tal cual y dejan que el backend recorte):

```tsx
      encargado,
```

- [ ] **Step 3: `formulario-cliente.tsx` — el campo obligatorio en el JSX**

El `<input id="encargado" ... />` gana `required`:

```tsx
            <input
              id="encargado"
              required
              maxLength={120}
              disabled={enviando}
              value={encargado}
              onChange={(e) => setEncargado(e.target.value)}
              className="w-48 rounded-md border px-3 py-2 text-sm"
            />
```

- [ ] **Step 4: Build del portal**

Run: `npm run build --workspace=apps/portal`
Expected: sin errores de TypeScript.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/lib/clientes.ts apps/portal/src/components/clientes/formulario-cliente.tsx
git commit -m "T-69: encargado obligatorio en el formulario de Cliente (Portal)"
```

---

## Task 7: Backend — pruebas e2e (Portal y App)

**Files:**
- Modify: `apps/backend/test/clientes.e2e-spec.ts`
- Modify: `apps/backend/test/prospectos.e2e-spec.ts`

**Interfaces:**
- Consumes: `POST /clientes`, `PATCH /clientes/:id` (Task 1) y `POST /sync/push` con operaciones `prospecto` (Task 2).

- [ ] **Step 1: `clientes.e2e-spec.ts` — los dos builders compartidos**

`datosMinimos` (dentro de `describe('POST /clientes', ...)`) gana una línea:

```ts
    const datosMinimos = (extra: Record<string, unknown> = {}) => ({
      nombre: `${PREFIJO} Alta`,
      domicilio: 'Domicilio',
      telefono: '000',
      encargado: 'Encargado de prueba',
      factura: false,
      tipo: 'cliente',
      listaPrecioId: listaId,
      promocion: 'ninguna',
      productosPromocion: [],
      overridesPrecio: [],
      vigenteDesde: '2026-08-31',
      ...extra,
    });
```

`cambios` (dentro de `describe('PATCH /clientes/:id', ...)`) gana la misma línea:

```ts
    const cambios = (extra: Record<string, unknown> = {}) => ({
      nombre: `${PREFIJO} Editado`,
      domicilio: 'Domicilio editado',
      telefono: '111',
      encargado: 'Encargado editado',
      factura: true,
      listaPrecioId: listaId,
      promocion: 'ninguna',
      productosPromocion: [],
      overridesPrecio: [],
      vigenteDesde: '2026-08-31',
      ...extra,
    });
```

- [ ] **Step 2: Nuevo test — falta el encargado**

Justo después de `it('responde 400 si falta un campo obligatorio', ...)` (dentro de `describe('POST /clientes', ...)`), agregar:

```ts
    it('responde 400 si falta el encargado', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { encargado: _encargado, ...sinEncargado } = datosMinimos();
      await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(sinEncargado)
        .expect(400);
    });
```

- [ ] **Step 3: Correr `clientes.e2e-spec.ts`**

Run: `npm run test:e2e --workspace=apps/backend -- clientes.e2e-spec.ts`
Expected: todo en verde, incluyendo el test nuevo. Ninguno de los tests existentes debería fallar: todos pasan por `datosMinimos()`/`cambios()`.

- [ ] **Step 4: `prospectos.e2e-spec.ts` — corregir el fixture que mandaba `encargado: null`**

El test `'acepta un alta sin ubicacion: negar el permiso no puede bloquear el registro'` pasa de:

```ts
  it('acepta un alta sin ubicacion: negar el permiso no puede bloquear el registro', async () => {
    const op = alta({
      datos: {
        nombre: `${PREFIJO} Sin Ubicacion`,
        telefono: '6649998877',
        encargado: null,
        tipo_negocio_id: null,
        comentarios: null,
        lat: null,
        lng: null,
        foto: null,
      },
    });
```

a (el punto de este test es la ubicación, no el encargado — se le da un valor válido para no mezclar los dos motivos):

```ts
  it('acepta un alta sin ubicacion: negar el permiso no puede bloquear el registro', async () => {
    const op = alta({
      datos: {
        nombre: `${PREFIJO} Sin Ubicacion`,
        telefono: '6649998877',
        encargado: 'Encargado de prueba',
        tipo_negocio_id: null,
        comentarios: null,
        lat: null,
        lng: null,
        foto: null,
      },
    });
```

- [ ] **Step 5: Nuevo test — falta el encargado en el push**

Justo después de `it('un alta sin nombre de negocio se rechaza nombrando el campo', ...)`, agregar:

```ts
  it('un alta sin encargado se rechaza nombrando el campo', async () => {
    const op = alta({
      datos: {
        nombre: `${PREFIJO} Sin Encargado`,
        telefono: '6641112233',
        foto: null,
      },
    });

    const cuerpo = (await push({ operaciones: [op] }).expect(200))
      .body as RespuestaPush;
    expect(cuerpo.resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'datos-invalidos',
    });
    expect(cuerpo.resultados[0].motivo).toMatch(/^encargado:/);
  });
```

- [ ] **Step 6: Correr `prospectos.e2e-spec.ts`**

Run: `npm run test:e2e --workspace=apps/backend -- prospectos.e2e-spec.ts`
Expected: todo en verde, incluyendo el test nuevo y el fixture corregido.

- [ ] **Step 7: Correr toda la suite e2e del backend**

Run: `npm run test:e2e --workspace=apps/backend`
Expected: en verde de punta a punta — confirma que ningún otro archivo e2e (por ejemplo `sincronizacion.e2e-spec.ts`, que también manda operaciones `prospecto` en algún escenario compartido) quedó con un `encargado` faltante o nulo por accidente. Si algo falla ahí, es un fixture adicional no cubierto por este plan: corregirlo con el mismo criterio (agregar `encargado` con un valor de prueba) antes de dar la tarea por completa.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/test/clientes.e2e-spec.ts apps/backend/test/prospectos.e2e-spec.ts
git commit -m "T-69: pruebas e2e de encargado obligatorio (Cliente y Prospecto)"
```

---

## Task 8: Verificación manual en el Portal

**Files:** (ninguno — verificación con navegador)

- [ ] **Step 1: Levantar el backend y el portal**

Run: `npm run backend` y `npm run portal`.

- [ ] **Step 2: Probar el alta de Cliente**

En `http://localhost:3001/catalogo/clientes`: abrir "Nuevo cliente", dejar Encargado vacío → el navegador bloquea el envío (`required`). Llenarlo → guarda sin problema.

- [ ] **Step 3: Probar la edición de un cliente ya existente sin encargado**

Si hay un cliente o prospecto sembrado antes de este cambio con encargado vacío, abrirlo para editar: el formulario debe abrir normal (no truena), con el campo Encargado vacío — y ahora el navegador **sí** exige llenarlo para guardar cualquier otro cambio, porque `EditarClienteDto` manda el estado completo (a diferencia de Vehículo/T-68, que es PATCH parcial). Confirma el Review Focus de este plan: es una fricción real y esperada, no un bug.

- [ ] **Step 4: No se puede probar la app sin una tablet o emulador**

`npm run typecheck --workspace=apps/tablet` y `npm test --workspace=apps/tablet` (Task 4/5) son lo único verificable en esta sesión — no hay dispositivo Android disponible. Anotar explícitamente en el PR: "sin probar en tablet física", igual que T-40 lo dejó anotado.
