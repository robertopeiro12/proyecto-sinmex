# T-50 · Reporte de Kilometraje (+ T-15, exportación a Excel) — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: usa superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).
> Los encabezados son `### Tarea N:` (en español): el script `task-brief` solo reconoce `Task N`; extrae los
> briefs con el `awk` de la memoria del proyecto (cambiando `Task` por `Tarea`).

**Objetivo:** que la oficina consulte en *Información → Reportes → Kilometraje* las jornadas cerradas por
vehículo y rango de fechas (km inicial, final, kilómetros, **salto** contra la jornada anterior del mismo
vehículo, totales) y lo exporte a Excel con una utilidad reutilizable (T-15).

**Arquitectura:** el backend (`modules/estadisticas/`) expone `GET /reportes/kilometraje`: una consulta con
ventana (`lag` por vehículo) trae filas planas y la regla pura `armarReporte` agrupa, calcula saltos y suma, todo
en **décimas de km enteras**. El portal agrega `lib/excel/` (construir el `.xlsx` con `exceljs` cargado bajo
demanda, y descargarlo), `lib/reportes.ts` (tipos, llamada, formato y la definición de Excel del reporte) y dos
pantallas: la lista de reportes y el reporte.

**Stack:** NestJS + Kysely (backend), Postgres/Supabase (solo lectura; **sin migración**), Next.js 15 + React 19 +
Vitest + Testing Library (portal), `exceljs@4.4.0`. **La app de tablet no se toca.**

**Spec:** `docs/superpowers/specs/2026-10-13-t50-reporte-kilometraje-design.md` — léelo antes de empezar. Manda el
spec; si este plan lo contradice (fuera de las desviaciones anotadas abajo), para y pregunta.

## Restricciones globales

- Rama `feature/t-50-reporte-kilometraje`. Comandos **desde la raíz del repo** con los scripts del workspace
  (`CLAUDE.md`). Pruebas e2e con el stack local de Supabase arriba (`docker context ls`; en la Mac de Roberto,
  `colima start` y `npm run supabase start`). **Nunca** apuntes nada a `sinmex dev` (la nube).
- **No hagas `git push`, ni `gh pr`, ni `gh issue`.** La Tarea 6 deja los textos para quien coordina.
- **No toques `apps/tablet`** (Portal = Roberto, App = Mario).
- **Sin migración**: la tabla `jornada` (T-38) y el permiso `reportes.ver` (T-05) ya existen.
- Endpoint (sesión de portal; no `@SoloApp()`):

  | Método y ruta | Permiso | Query | Respuesta |
  |---|---|---|---|
  | `GET /reportes/kilometraje` | `reportes.ver` | `desde`, `hasta` (obligatorias, `AAAA-MM-DD`), `vehiculo` (uuid, opcional), `sucursal` (código o `todas`, opcional) | `200` `ReporteKilometraje` |

- **Kilómetros en décimas de km enteras** en el cable (`jornada.km_*` es `numeric(10,1)`): se convierte en SQL
  con `round(km * 10)::int`; nunca `parseFloat(x) * 10` en JS.
- **Salto** de una jornada = `km_inicial` − `km_final` de la jornada **anterior del mismo vehículo** (orden
  `fecha, cerrada_en, id`), buscada **aunque caiga antes de `desde`**. `null` si no hay anterior; `0` si coincide.
- Solo jornadas vivas (`jornada.deleted_at is null`). Un vehículo desactivado (`activo = false`) **sí** aparece.
- Alcance: `resolverAlcance(sucursalDelUsuario, normalizarSucursalPedida(sucursal))` sobre `jornada.sucursal_id`.
  Un usuario atado a TJ que pide `sucursal=MX` → 403 (`No tienes acceso a esa sucursal.`, lo lanza
  `resolverAlcance`). Un `vehiculo` de otra sucursal no trae filas (no se revela).
- Mensajes exactos del **servidor** (400):
  - `La fecha "desde" debe tener el formato AAAA-MM-DD.` · `La fecha "hasta" debe tener el formato AAAA-MM-DD.` (DTO)
  - `El vehículo no es válido.` (DTO)
  - `La fecha "desde" no es una fecha válida.` · `La fecha "hasta" no es una fecha válida.`
  - `La fecha "desde" no puede ser posterior a "hasta".`
  - `El rango no puede pasar de un año.` (más de **366** días contando ambos extremos)
- Mensajes exactos del **portal**:
  - Sin permiso: `No tienes permiso para ver reportes`
  - Fechas invertidas: `La fecha inicial no puede ser posterior a la final.`
  - Vacío: `No hay jornadas cerradas en ese rango.`
  - Botones: `Consultar` · `Exportar a Excel`
- Formato de km en pantalla: `formatearKm(decimas)` → miles con coma y un decimal (`10000.5` km → `10,000.5`);
  salto con signo: `+150.0` / `−30.0` (signo menos tipográfico `−`, U+2212).
- Excel: `exceljs@4.4.0`, cargado con `await import("exceljs")` **solo al exportar**. Números como números,
  fechas como fecha de Excel (`dd/mm/yyyy`), encabezados en negrita con fondo gris y **congelados**,
  `subtotal`/`total` en negrita con borde superior, `grupo` en negrita, `resaltada` con fondo `FFFEF3C7`.
  Archivo del reporte: `kilometraje_<desde>_a_<hasta>.xlsx`.
- Comentarios y nombres en español, sin acentos en identificadores, con la densidad de comentarios del código
  vecino. Commits `T-50: …` que terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (o el
  modelo que de verdad lo escribió).

### Desviaciones del spec (decididas al escribir el plan)

1. **Orden dentro de un vehículo:** `fecha, cerrada_en, id` (el mismo con el que se calcula el salto), no "fecha,
   luego vendedor". Así el renglón anterior en pantalla es justo contra el que se compara el salto.
2. **`exceljs` trae un aviso moderado heredado** (`uuid < 11.1.1`, "Missing buffer bounds check in v3/v5/v6";
   `exceljs` solo usa `v4`). Se fuerza `uuid@^11.1.1` **solo para `exceljs`** con `overrides` en el
   `package.json` raíz; probado: `exceljs` sigue funcionando y `npm audit` queda en 0. El spec decía "sin
   vulnerabilidades conocidas": con el override es cierto.
3. **`construirLibro` devuelve `ArrayBuffer`** creado con `new Uint8Array(await writeBuffer()).buffer` (en Node
   `writeBuffer` da un `Buffer`; en el navegador, un `ArrayBuffer`): misma firma que el spec, comportamiento
   igual en los dos.
4. **Vehículos dados de baja** (`vehiculo.deleted_at`) también aparecen si tienen jornadas en el rango: sus
   kilómetros se recorrieron (mismo criterio que "desactivado").
5. **Lista de vehículos del filtro**: `GET /vehiculos?sucursal=` ya existe y **no** exige permiso (T-11); se
   reusa `listarVehiculos` de `lib/vehiculos.ts`.

## Puntos de revisión (Review Focus)

1. **Primer día del rango con jornada anterior fuera del rango**: el salto se compara contra esa jornada previa,
   no queda vacío. → Tarea 1 (unitaria con `kmFinalAnteriorDecimas` ya dado) y Tarea 2 (e2e que siembra la
   anterior antes de `desde`).
2. **Una jornada borrada en medio** no cuenta como "anterior": el salto se mide contra la última jornada viva.
   → Tarea 2 (e2e con una jornada borrada entre dos vivas).
3. **Decimales del odómetro** (`10,250.5`): no se pierden ni se redondean mal en el salto ni en los totales.
   → Tarea 2 (e2e: 10250.5 → 102505 décimas; salto 1495) y Tarea 4 (`formatearKm`).
4. **Rango de un año exacto** (366 días con bisiesto) pasa y 367 no; fecha inexistente (`2019-02-30`) es 400, no
   500. → Tarea 1 (unitaria de `validarRango`) y Tarea 2 (e2e).
5. **Exportar con filtros puestos**: el Excel trae el rango, la sucursal y el vehículo que se usaron, y exporta
   lo que está en pantalla aunque el usuario haya cambiado los filtros sin volver a consultar. → Tarea 4
   (`definicionExcelKilometraje` recibe el reporte y los filtros **aplicados**) y Tarea 5 (prueba de pantalla).

## Mapa de archivos

| Archivo | Tarea | Responsabilidad |
|---|---|---|
| `apps/backend/src/modules/estadisticas/reglas-kilometraje.ts` (+ `.spec.ts`) | 1 | `validarRango`, `armarReporte` y los tipos de la respuesta |
| `apps/backend/src/modules/estadisticas/dto/reporte-kilometraje.dto.ts` | 2 | Forma del query |
| `apps/backend/src/modules/estadisticas/reporte-kilometraje.repository.ts` | 2 | La consulta con `lag` |
| `apps/backend/src/modules/estadisticas/reporte-kilometraje.service.ts` | 2 | Validar, alcance, armar |
| `apps/backend/src/modules/estadisticas/reporte-kilometraje.controller.ts` | 2 | `GET /reportes/kilometraje` |
| `apps/backend/src/modules/estadisticas/estadisticas.module.ts` | 2 | Registrar lo anterior |
| `apps/backend/test/reporte-kilometraje.e2e-spec.ts` | 2 | De punta a punta |
| `package.json` (raíz), `apps/portal/package.json`, `package-lock.json` | 3 | `exceljs` + override de `uuid` |
| `apps/portal/src/lib/excel/definicion.ts` | 3 | Tipos de la utilidad |
| `apps/portal/src/lib/excel/construir-libro.ts` (+ `.test.ts`) | 3 | Armar el `.xlsx` |
| `apps/portal/src/lib/excel/exportar.ts` (+ `.test.ts`) | 3 | Descargar |
| `apps/portal/src/lib/reportes.ts` (+ `.test.ts`) | 4 | Tipos, llamada, `formatearKm`, `formatearSalto`, `definicionExcelKilometraje` |
| `apps/portal/src/components/reportes/lista-reportes.tsx` (+ `.test.tsx`) | 5 | *Información → Reportes* |
| `apps/portal/src/components/reportes/tabla-kilometraje.tsx` | 5 | Grupos, totales, saltos |
| `apps/portal/src/components/reportes/pantalla-kilometraje.tsx` (+ `.test.tsx`) | 5 | Filtros, estados, exportar |
| `apps/portal/src/app/(portal)/informacion/reportes/page.tsx`, `…/reportes/kilometraje/page.tsx` | 5 | Rutas |
| `CLAUDE.md`, vault (`../jawa-obsidian-memory`) | 6 | Documentación |

## Modelo sugerido por tarea

| Tarea | Qué | Implementar | Revisar |
|---|---|---|---|
| 1 | Regla pura y validación | `haiku` | `sonnet` |
| 2 | Endpoint + SQL con ventana + e2e | `sonnet` | **`opus`** |
| 3 | Utilidad de Excel (T-15) | `sonnet` | `sonnet` |
| 4 | `lib/reportes.ts` | `haiku` | `sonnet` |
| 5 | Pantallas | `sonnet` | `sonnet` |
| 6 | Verificación, prueba a mano y documentación | `sonnet` | **`opus`** (revisión final de rama) |

---

### Tarea 1: La regla pura — validar el rango y armar el reporte

Sin base de datos: recibe filas planas (lo que traerá el SQL de la Tarea 2) y devuelve la respuesta agrupada,
con saltos y totales. Aquí se definen los tipos que viajan al portal.

**Archivos:**
- Crear: `apps/backend/src/modules/estadisticas/reglas-kilometraje.ts`
- Prueba: `apps/backend/src/modules/estadisticas/reglas-kilometraje.spec.ts`

**Interfaces:**
- Consume: `esFechaReal(fecha: string): boolean` de `apps/backend/src/modules/ventas-cobranza/venta-portal.ts`
  (ya existe; valida formato y que el día exista).
- Produce:
  - `MAX_DIAS_RANGO = 366`
  - `validarRango(desde: string, hasta: string): string | null` (el mensaje de error, o `null` si está bien)
  - `interface FilaJornada { jornadaId; vehiculoId; vehiculoNombre; placas: string | null; vehiculoActivo: boolean; fecha; vendedor; kmInicialDecimas: number; kmFinalDecimas: number; kmFinalAnteriorDecimas: number | null; fechaAnterior: string | null }`
  - `interface JornadaEnReporte`, `interface VehiculoEnReporte`, `interface ReporteKilometraje` (forma del spec §4.1)
  - `armarReporte(desde: string, hasta: string, filas: readonly FilaJornada[]): ReporteKilometraje`

- [ ] **Paso 1: Escribe la prueba que falla**

```ts
// apps/backend/src/modules/estadisticas/reglas-kilometraje.spec.ts
import {
  MAX_DIAS_RANGO,
  armarReporte,
  validarRango,
  type FilaJornada,
} from './reglas-kilometraje';

const fila = (extra: Partial<FilaJornada>): FilaJornada => ({
  jornadaId: 'j',
  vehiculoId: 'v-a',
  vehiculoNombre: 'Nissan-01',
  placas: 'ABC-123',
  vehiculoActivo: true,
  fecha: '2026-10-01',
  vendedor: 'Juan Pérez',
  kmInicialDecimas: 100000,
  kmFinalDecimas: 102500,
  kmFinalAnteriorDecimas: null,
  fechaAnterior: null,
  ...extra,
});

describe('validarRango', () => {
  it('acepta un rango normal', () => {
    expect(validarRango('2026-10-01', '2026-10-13')).toBeNull();
  });

  it('rechaza fechas que no existen', () => {
    expect(validarRango('2026-02-30', '2026-03-01')).toBe(
      'La fecha "desde" no es una fecha válida.',
    );
    expect(validarRango('2026-03-01', '2026-13-01')).toBe(
      'La fecha "hasta" no es una fecha válida.',
    );
  });

  it('rechaza desde posterior a hasta', () => {
    expect(validarRango('2026-10-13', '2026-10-01')).toBe(
      'La fecha "desde" no puede ser posterior a "hasta".',
    );
  });

  it(`acepta ${MAX_DIAS_RANGO} días contando ambos extremos (con bisiesto) y rechaza uno más`, () => {
    // 2024 es bisiesto: del 1 de enero al 31 de diciembre son 366 días.
    expect(validarRango('2024-01-01', '2024-12-31')).toBeNull();
    expect(validarRango('2024-01-01', '2025-01-01')).toBe(
      'El rango no puede pasar de un año.',
    );
  });
});

describe('armarReporte', () => {
  it('sin filas da un reporte vacío con totales en 0', () => {
    expect(armarReporte('2026-10-01', '2026-10-13', [])).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-13',
      vehiculos: [],
      totalKilometrosDecimas: 0,
      totalSaltoDecimas: 0,
    });
  });

  it('calcula kilómetros y el salto contra la anterior (Review Focus 1: aunque sea de antes del rango)', () => {
    const reporte = armarReporte('2026-10-02', '2026-10-13', [
      fila({
        jornadaId: 'j1',
        fecha: '2026-10-02',
        kmInicialDecimas: 104000,
        kmFinalDecimas: 105200,
        // La anterior (01/10) quedó fuera del rango: el SQL la trae igual.
        kmFinalAnteriorDecimas: 102505,
        fechaAnterior: '2026-10-01',
      }),
      fila({
        jornadaId: 'j2',
        fecha: '2026-10-03',
        vendedor: 'Pedro López',
        kmInicialDecimas: 105200,
        kmFinalDecimas: 106000,
        kmFinalAnteriorDecimas: 105200,
        fechaAnterior: '2026-10-02',
      }),
    ]);

    expect(reporte.vehiculos).toHaveLength(1);
    const [v] = reporte.vehiculos;
    expect(v.jornadas).toEqual([
      {
        jornadaId: 'j1',
        fecha: '2026-10-02',
        vendedor: 'Juan Pérez',
        kmInicialDecimas: 104000,
        kmFinalDecimas: 105200,
        kilometrosDecimas: 1200,
        saltoDecimas: 1495,
        fechaAnterior: '2026-10-01',
      },
      {
        jornadaId: 'j2',
        fecha: '2026-10-03',
        vendedor: 'Pedro López',
        kmInicialDecimas: 105200,
        kmFinalDecimas: 106000,
        kilometrosDecimas: 800,
        saltoDecimas: 0,
        fechaAnterior: '2026-10-02',
      },
    ]);
    expect(v.totalKilometrosDecimas).toBe(2000);
    expect(v.totalSaltoDecimas).toBe(1495);
    expect(reporte.totalKilometrosDecimas).toBe(2000);
    expect(reporte.totalSaltoDecimas).toBe(1495);
  });

  it('sin jornada anterior el salto es null y no suma; un salto negativo resta', () => {
    const reporte = armarReporte('2026-10-01', '2026-10-13', [
      fila({ jornadaId: 'j1' }),
      fila({
        jornadaId: 'j2',
        fecha: '2026-10-02',
        kmInicialDecimas: 102200,
        kmFinalDecimas: 102800,
        kmFinalAnteriorDecimas: 102500,
        fechaAnterior: '2026-10-01',
      }),
    ]);
    const [v] = reporte.vehiculos;
    expect(v.jornadas.map((j) => j.saltoDecimas)).toEqual([null, -300]);
    expect(v.totalSaltoDecimas).toBe(-300);
  });

  it('agrupa por vehículo, ordena por nombre y luego placas, y conserva el orden de las jornadas', () => {
    const reporte = armarReporte('2026-10-01', '2026-10-13', [
      fila({ jornadaId: 'z1', vehiculoId: 'v-z', vehiculoNombre: 'Zeta', placas: null }),
      fila({ jornadaId: 'a2', vehiculoId: 'v-a2', vehiculoNombre: 'Alfa', placas: 'BBB-2' }),
      fila({ jornadaId: 'a1', vehiculoId: 'v-a1', vehiculoNombre: 'Alfa', placas: 'AAA-1', vehiculoActivo: false }),
      fila({ jornadaId: 'a1b', vehiculoId: 'v-a1', vehiculoNombre: 'Alfa', placas: 'AAA-1', vehiculoActivo: false, fecha: '2026-10-02' }),
    ]);
    expect(reporte.vehiculos.map((v) => [v.vehiculoId, v.activo])).toEqual([
      ['v-a1', false],
      ['v-a2', true],
      ['v-z', true],
    ]);
    expect(reporte.vehiculos[0].jornadas.map((j) => j.jornadaId)).toEqual(['a1', 'a1b']);
    expect(reporte.vehiculos[0]).toMatchObject({ nombre: 'Alfa', placas: 'AAA-1' });
  });
});
```

- [ ] **Paso 2: Corre la prueba y confirma que falla**

Run: `npm test --workspace=apps/backend -- reglas-kilometraje`
Expected: FAIL con `Cannot find module './reglas-kilometraje'`.

- [ ] **Paso 3: Escribe la implementación**

```ts
// apps/backend/src/modules/estadisticas/reglas-kilometraje.ts
import { esFechaReal } from '../ventas-cobranza/venta-portal';

/**
 * Reporte de Kilometraje (T-50): las reglas sin base de datos.
 *
 * El SQL (`ReporteKilometrajeRepository`) trae filas planas ya ordenadas por
 * vehiculo y por `fecha, cerrada_en, id`, cada una con el `km_final` de la
 * jornada ANTERIOR del mismo vehiculo (`lag`), aunque esa anterior caiga antes
 * de `desde`. Aqui se agrupa, se calcula el salto y se suma. Todo en DECIMAS de
 * km enteras: `jornada.km_*` es `numeric(10,1)` y asi no hay flotantes.
 */

/** Un año con bisiesto, contando los dos extremos. */
export const MAX_DIAS_RANGO = 366;

const MS_DIA = 24 * 60 * 60 * 1000;

/** El mensaje del 400, o `null` si el rango sirve. El formato ya lo valido el DTO. */
export function validarRango(desde: string, hasta: string): string | null {
  if (!esFechaReal(desde)) return 'La fecha "desde" no es una fecha válida.';
  if (!esFechaReal(hasta)) return 'La fecha "hasta" no es una fecha válida.';
  if (desde > hasta) return 'La fecha "desde" no puede ser posterior a "hasta".';
  const dias =
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) /
      MS_DIA +
    1;
  if (dias > MAX_DIAS_RANGO) return 'El rango no puede pasar de un año.';
  return null;
}

/** Lo que trae el SQL por jornada. */
export interface FilaJornada {
  jornadaId: string;
  vehiculoId: string;
  vehiculoNombre: string;
  placas: string | null;
  vehiculoActivo: boolean;
  /** `AAAA-MM-DD`. */
  fecha: string;
  vendedor: string;
  kmInicialDecimas: number;
  kmFinalDecimas: number;
  /** `km_final` de la jornada anterior del mismo vehiculo; `null` si no hay. */
  kmFinalAnteriorDecimas: number | null;
  fechaAnterior: string | null;
}

export interface JornadaEnReporte {
  jornadaId: string;
  fecha: string;
  vendedor: string;
  kmInicialDecimas: number;
  kmFinalDecimas: number;
  kilometrosDecimas: number;
  /** `null` = sin jornada anterior; `0` = empezó donde terminó la anterior. */
  saltoDecimas: number | null;
  fechaAnterior: string | null;
}

export interface VehiculoEnReporte {
  vehiculoId: string;
  nombre: string;
  placas: string | null;
  activo: boolean;
  jornadas: JornadaEnReporte[];
  totalKilometrosDecimas: number;
  totalSaltoDecimas: number;
}

export interface ReporteKilometraje {
  desde: string;
  hasta: string;
  vehiculos: VehiculoEnReporte[];
  totalKilometrosDecimas: number;
  totalSaltoDecimas: number;
}

/** Nombre y luego placas; un vehiculo sin placas va al final de su nombre. */
function compararVehiculos(a: VehiculoEnReporte, b: VehiculoEnReporte): number {
  const porNombre = a.nombre.localeCompare(b.nombre, 'es');
  if (porNombre !== 0) return porNombre;
  if (a.placas === b.placas) return a.vehiculoId.localeCompare(b.vehiculoId);
  if (a.placas === null) return 1;
  if (b.placas === null) return -1;
  return a.placas.localeCompare(b.placas, 'es');
}

/**
 * Agrupa por vehiculo conservando el orden en que llegan las jornadas (el del
 * SQL, que es el mismo con el que se calculo el salto: desviacion 1 del plan).
 */
export function armarReporte(
  desde: string,
  hasta: string,
  filas: readonly FilaJornada[],
): ReporteKilometraje {
  const porVehiculo = new Map<string, VehiculoEnReporte>();

  for (const f of filas) {
    let vehiculo = porVehiculo.get(f.vehiculoId);
    if (!vehiculo) {
      vehiculo = {
        vehiculoId: f.vehiculoId,
        nombre: f.vehiculoNombre,
        placas: f.placas,
        activo: f.vehiculoActivo,
        jornadas: [],
        totalKilometrosDecimas: 0,
        totalSaltoDecimas: 0,
      };
      porVehiculo.set(f.vehiculoId, vehiculo);
    }

    const kilometrosDecimas = f.kmFinalDecimas - f.kmInicialDecimas;
    const saltoDecimas =
      f.kmFinalAnteriorDecimas === null
        ? null
        : f.kmInicialDecimas - f.kmFinalAnteriorDecimas;

    vehiculo.jornadas.push({
      jornadaId: f.jornadaId,
      fecha: f.fecha,
      vendedor: f.vendedor,
      kmInicialDecimas: f.kmInicialDecimas,
      kmFinalDecimas: f.kmFinalDecimas,
      kilometrosDecimas,
      saltoDecimas,
      fechaAnterior: f.fechaAnterior,
    });
    vehiculo.totalKilometrosDecimas += kilometrosDecimas;
    vehiculo.totalSaltoDecimas += saltoDecimas ?? 0;
  }

  const vehiculos = [...porVehiculo.values()].sort(compararVehiculos);
  return {
    desde,
    hasta,
    vehiculos,
    totalKilometrosDecimas: vehiculos.reduce(
      (t, v) => t + v.totalKilometrosDecimas,
      0,
    ),
    totalSaltoDecimas: vehiculos.reduce((t, v) => t + v.totalSaltoDecimas, 0),
  };
}
```

- [ ] **Paso 4: Corre la prueba y confirma que pasa**

Run: `npm test --workspace=apps/backend -- reglas-kilometraje`
Expected: PASS, 9 pruebas.

- [ ] **Paso 5: Suite, lint y commit**

Run: `npm test --workspace=apps/backend` y `npm run lint --workspace=apps/backend`
Expected: todo en verde.

```bash
git add apps/backend/src/modules/estadisticas/reglas-kilometraje.ts apps/backend/src/modules/estadisticas/reglas-kilometraje.spec.ts
git commit -m "T-50: regla pura del reporte de kilometraje — rango, saltos y totales en decimas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: `GET /reportes/kilometraje` — consulta con ventana, servicio, controller y e2e

**Archivos:**
- Crear: `apps/backend/src/modules/estadisticas/dto/reporte-kilometraje.dto.ts`
- Crear: `apps/backend/src/modules/estadisticas/reporte-kilometraje.repository.ts`
- Crear: `apps/backend/src/modules/estadisticas/reporte-kilometraje.service.ts`
- Crear: `apps/backend/src/modules/estadisticas/reporte-kilometraje.controller.ts`
- Modificar: `apps/backend/src/modules/estadisticas/estadisticas.module.ts`
- Prueba: `apps/backend/test/reporte-kilometraje.e2e-spec.ts`

**Interfaces:**
- Consume (Tarea 1): `validarRango`, `armarReporte`, `FilaJornada`, `ReporteKilometraje` de `./reglas-kilometraje`.
- Consume (existentes): `resolverAlcance`, `normalizarSucursalPedida` de `../sucursales/alcance-sucursal`;
  `buscarSucursalUsuario(db, usuarioId)` de `../sucursales/buscar-sucursal-usuario`; `DB_CONNECTION`,
  `Database` de `../../database/database.tokens`; `RequierePermiso` y `UsuarioActual` de `../auth/`.
- Produce: `GET /reportes/kilometraje` → `ReporteKilometraje` (camelCase).

- [ ] **Paso 1: Escribe la e2e que falla**

```ts
// apps/backend/test/reporte-kilometraje.e2e-spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
import type { ReporteKilometraje } from './../src/modules/estadisticas/reglas-kilometraje';

// Mismo patron que vehiculos.e2e-spec.ts: SUFIJO con PID para que las suites
// en paralelo no se pisen.
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-e2e-km-${SUFIJO}`;
const PLACA = `K${(Date.now() % 36 ** 5).toString(36)}${process.pid.toString(36)}`;

// Fechas de 2019: ninguna otra suite siembra jornadas ahi. Aun asi, las
// aserciones filtran por los vehiculos de esta suite (o piden `vehiculo=`),
// porque el reporte es por sucursal y otra suite podria sembrar en TJ.
describe('Reporte de kilometraje (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const vendedorIds: string[] = [];
  const vehiculoIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let vehA: string; // TJ, activo
  let vehB: string; // TJ, desactivado
  let vehMx: string; // MX
  let juan: string;
  let pedro: string;
  let ana: string; // MX

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

  /** `Auxiliar Administrativo` esta vacio de permisos: sirve como "sin reportes.ver". */
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

  const sembrarVendedor = async (nombre: string, sucursalId: string): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-km-${vendedorIds.length + 1}-${SUFIJO}`,
        nombre,
        password_hash: 'x',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const sembrarVehiculo = async (
    nombre: string,
    sucursalId: string,
    activo = true,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vehiculo')
      .values({
        nombre: `${PREFIJO} ${nombre}`,
        placas: `${PLACA}${vehiculoIds.length}`,
        sucursal_id: sucursalId,
        km_inicial: 0,
        activo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vehiculoIds.push(id);
    return id;
  };

  /** Una jornada cerrada a las 22:00 UTC de su dia (14:00 de Tijuana). */
  const sembrarJornada = async (j: {
    vendedorId: string;
    vehiculoId: string;
    sucursalId: string;
    fecha: string;
    kmInicial: number;
    kmFinal: number;
    borrada?: boolean;
  }): Promise<void> => {
    await db
      .insertInto('jornada')
      .values({
        vendedor_id: j.vendedorId,
        vehiculo_id: j.vehiculoId,
        sucursal_id: j.sucursalId,
        fecha: j.fecha,
        km_inicial: j.kmInicial,
        km_final: j.kmFinal,
        abierta_en: `${j.fecha}T15:00:00Z`,
        cerrada_en: `${j.fecha}T22:00:00Z`,
        ...(j.borrada ? { deleted_at: `${j.fecha}T23:00:00Z` } : {}),
      })
      .execute();
  };

  const pedirReporte = (cookie: string, query: string) =>
    request(app.getHttpServer())
      .get(`/reportes/kilometraje?${query}`)
      .set('Cookie', cookie);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    idTijuana = (
      await db.selectFrom('sucursal').select('id').where('codigo', '=', 'TJ').executeTakeFirstOrThrow()
    ).id;
    idMexicali = (
      await db.selectFrom('sucursal').select('id').where('codigo', '=', 'MX').executeTakeFirstOrThrow()
    ).id;

    await crearUsuario(`e2e-km-gen-${SUFIJO}`, 'Administrador General', null);
    await crearUsuario(`e2e-km-tj-${SUFIJO}`, 'Administrador General', idTijuana);
    await crearUsuario(`e2e-km-sin-${SUFIJO}`, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(`e2e-km-gen-${SUFIJO}`);
    cookieTijuana = await iniciarSesion(`e2e-km-tj-${SUFIJO}`);
    cookieSinPermiso = await iniciarSesion(`e2e-km-sin-${SUFIJO}`);

    juan = await sembrarVendedor(`Juan ${SUFIJO}`, idTijuana);
    pedro = await sembrarVendedor(`Pedro ${SUFIJO}`, idTijuana);
    ana = await sembrarVendedor(`Ana ${SUFIJO}`, idMexicali);
    vehA = await sembrarVehiculo('A', idTijuana);
    vehB = await sembrarVehiculo('B', idTijuana, false);
    vehMx = await sembrarVehiculo('MX', idMexicali);

    // Vehiculo A: 01/03 fuera del rango que se consulta (desde 05/03),
    // 03/03 BORRADA (Review Focus 2: no cuenta como anterior), 05/03 con salto
    // contra la del 01/03, 06/03 sin salto.
    await sembrarJornada({ vendedorId: juan, vehiculoId: vehA, sucursalId: idTijuana, fecha: '2019-03-01', kmInicial: 10000, kmFinal: 10250.5 });
    await sembrarJornada({ vendedorId: pedro, vehiculoId: vehA, sucursalId: idTijuana, fecha: '2019-03-03', kmInicial: 10300, kmFinal: 10399, borrada: true });
    await sembrarJornada({ vendedorId: pedro, vehiculoId: vehA, sucursalId: idTijuana, fecha: '2019-03-05', kmInicial: 10400, kmFinal: 10520 });
    await sembrarJornada({ vendedorId: juan, vehiculoId: vehA, sucursalId: idTijuana, fecha: '2019-03-06', kmInicial: 10520, kmFinal: 10600 });
    // Vehiculo B (desactivado): una jornada.
    await sembrarJornada({ vendedorId: juan, vehiculoId: vehB, sucursalId: idTijuana, fecha: '2019-03-10', kmInicial: 500, kmFinal: 560 });
    // Vehiculo de MX.
    await sembrarJornada({ vendedorId: ana, vehiculoId: vehMx, sucursalId: idMexicali, fecha: '2019-03-07', kmInicial: 2000, kmFinal: 2100 });
  });

  afterAll(async () => {
    if (vehiculoIds.length > 0) {
      await db.deleteFrom('jornada').where('vehiculo_id', 'in', vehiculoIds).execute();
      await db.deleteFrom('vehiculo').where('id', 'in', vehiculoIds).execute();
    }
    if (vendedorIds.length > 0) {
      await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    }
    if (usuarioIds.length > 0) {
      await db.deleteFrom('sesion_refresh').where('usuario_id', 'in', usuarioIds).execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  it('sin reportes.ver responde 403', async () => {
    await pedirReporte(cookieSinPermiso, 'desde=2019-03-01&hasta=2019-03-31').expect(403);
  });

  it('agrupa por vehiculo, en decimas, con el salto contra la anterior fuera del rango y sin contar la borrada', async () => {
    const res = await pedirReporte(
      cookieGeneral,
      `desde=2019-03-05&hasta=2019-03-31&vehiculo=${vehA}`,
    ).expect(200);
    const reporte = res.body as ReporteKilometraje;

    expect(reporte.vehiculos).toHaveLength(1);
    const [v] = reporte.vehiculos;
    expect(v).toMatchObject({ vehiculoId: vehA, nombre: `${PREFIJO} A`, activo: true });
    expect(v.jornadas).toEqual([
      {
        jornadaId: expect.any(String) as string,
        fecha: '2019-03-05',
        vendedor: `Pedro ${SUFIJO}`,
        kmInicialDecimas: 104000,
        kmFinalDecimas: 105200,
        kilometrosDecimas: 1200,
        // 10,400.0 − 10,250.5 = 149.5 km: contra el 01/03, no contra la borrada del 03/03.
        saltoDecimas: 1495,
        fechaAnterior: '2019-03-01',
      },
      {
        jornadaId: expect.any(String) as string,
        fecha: '2019-03-06',
        vendedor: `Juan ${SUFIJO}`,
        kmInicialDecimas: 105200,
        kmFinalDecimas: 106000,
        kilometrosDecimas: 800,
        saltoDecimas: 0,
        fechaAnterior: '2019-03-05',
      },
    ]);
    expect(v.totalKilometrosDecimas).toBe(2000);
    expect(v.totalSaltoDecimas).toBe(1495);
    expect(reporte.totalKilometrosDecimas).toBe(2000);
  });

  it('la primera jornada de un vehiculo no tiene salto y un vehiculo desactivado aparece', async () => {
    const res = await pedirReporte(cookieGeneral, 'desde=2019-03-01&hasta=2019-03-31&sucursal=TJ').expect(200);
    const reporte = res.body as ReporteKilometraje;
    const a = reporte.vehiculos.find((v) => v.vehiculoId === vehA);
    const b = reporte.vehiculos.find((v) => v.vehiculoId === vehB);
    expect(a?.jornadas.map((j) => j.fecha)).toEqual(['2019-03-01', '2019-03-05', '2019-03-06']);
    expect(a?.jornadas[0].saltoDecimas).toBeNull();
    expect(a?.jornadas[0].kmFinalDecimas).toBe(102505);
    expect(b).toMatchObject({ activo: false, totalKilometrosDecimas: 600 });
    expect(reporte.vehiculos.some((v) => v.vehiculoId === vehMx)).toBe(false);
  });

  it('General con sucursal=MX ve solo MX; un usuario de TJ no ve MX ni puede pedirla', async () => {
    const mx = (await pedirReporte(cookieGeneral, 'desde=2019-03-01&hasta=2019-03-31&sucursal=MX').expect(200))
      .body as ReporteKilometraje;
    expect(mx.vehiculos.some((v) => v.vehiculoId === vehMx)).toBe(true);
    expect(mx.vehiculos.some((v) => v.vehiculoId === vehA)).toBe(false);

    const tj = (await pedirReporte(cookieTijuana, 'desde=2019-03-01&hasta=2019-03-31').expect(200))
      .body as ReporteKilometraje;
    expect(tj.vehiculos.some((v) => v.vehiculoId === vehA)).toBe(true);
    expect(tj.vehiculos.some((v) => v.vehiculoId === vehMx)).toBe(false);

    // Pedir el vehiculo de MX por id desde TJ no revela nada.
    const ajeno = (await pedirReporte(cookieTijuana, `desde=2019-03-01&hasta=2019-03-31&vehiculo=${vehMx}`).expect(200))
      .body as ReporteKilometraje;
    expect(ajeno.vehiculos).toEqual([]);

    await pedirReporte(cookieTijuana, 'desde=2019-03-01&hasta=2019-03-31&sucursal=MX').expect(403);
  });

  it.each([
    ['desde=2019-3-1&hasta=2019-03-31', 'La fecha "desde" debe tener el formato AAAA-MM-DD.'],
    ['hasta=2019-03-31', 'La fecha "desde" debe tener el formato AAAA-MM-DD.'],
    ['desde=2019-02-30&hasta=2019-03-31', 'La fecha "desde" no es una fecha válida.'],
    ['desde=2019-03-31&hasta=2019-03-01', 'La fecha "desde" no puede ser posterior a "hasta".'],
    ['desde=2019-01-01&hasta=2020-01-02', 'El rango no puede pasar de un año.'],
    ['desde=2019-03-01&hasta=2019-03-31&vehiculo=no-es-uuid', 'El vehículo no es válido.'],
  ])('400 con %s', async (query, mensaje) => {
    const res = await pedirReporte(cookieGeneral, query).expect(400);
    const cuerpo = res.body as { message: string | string[] };
    const mensajes = Array.isArray(cuerpo.message) ? cuerpo.message : [cuerpo.message];
    expect(mensajes).toContain(mensaje);
  });

  it('un año exacto pasa (Review Focus 4)', async () => {
    await pedirReporte(cookieGeneral, 'desde=2019-01-01&hasta=2020-01-01').expect(200);
  });
});
```

- [ ] **Paso 2: Corre la e2e y confirma que falla**

Run: `npm run test:e2e --workspace=apps/backend -- reporte-kilometraje`
Expected: FAIL — las peticiones dan **404** (la ruta no existe) y el import de `reglas-kilometraje` solo trae
tipos (de la Tarea 1).

- [ ] **Paso 3: El DTO**

```ts
// apps/backend/src/modules/estadisticas/dto/reporte-kilometraje.dto.ts
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /reportes/kilometraje` (T-50). El formato lo valida aqui; que el dia
 * exista, el orden y el tope de un año, `validarRango` (reglas-kilometraje.ts).
 */
export class ReporteKilometrajeDto {
  @Matches(RE_FECHA, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  desde!: string;

  @Matches(RE_FECHA, {
    message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.',
  })
  hasta!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'El vehículo no es válido.' })
  vehiculo?: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}
```

- [ ] **Paso 4: El repositorio (la consulta con `lag`)**

```ts
// apps/backend/src/modules/estadisticas/reporte-kilometraje.repository.ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { FilaJornada } from './reglas-kilometraje';

export interface FiltroJornadas {
  desde: string;
  hasta: string;
  vehiculoId: string | null;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  codigoSucursal: string | null;
}

@Injectable()
export class ReporteKilometrajeRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /**
   * Las jornadas vivas del rango, cada una con el `km_final` de la jornada
   * ANTERIOR del mismo vehiculo. El `lag` corre sobre TODO lo anterior a
   * `hasta` y el `desde` se aplica despues: asi el primer dia del rango se
   * compara con la ultima jornada previa (Review Focus 1). Las borradas no
   * entran ni como renglon ni como "anterior" (Review Focus 2).
   *
   * Orden `fecha, cerrada_en, id`: el mismo para el salto y para la pantalla
   * (desviacion 1 del plan). Los km salen en DECIMAS enteras desde SQL.
   */
  async jornadas(f: FiltroJornadas): Promise<FilaJornada[]> {
    const filas = await sql<{
      jornada_id: string;
      vehiculo_id: string;
      vehiculo_nombre: string;
      placas: string | null;
      vehiculo_activo: boolean;
      fecha: string;
      vendedor: string;
      km_inicial_decimas: number;
      km_final_decimas: number;
      km_final_anterior_decimas: number | null;
      fecha_anterior: string | null;
    }>`
      with base as (
        select j.id, j.vehiculo_id, j.vendedor_id, j.fecha, j.cerrada_en,
               j.km_inicial, j.km_final,
               lag(j.km_final) over w as km_final_anterior,
               lag(j.fecha) over w as fecha_anterior
          from jornada j
          join sucursal s on s.id = j.sucursal_id
         where j.deleted_at is null
           and j.fecha <= ${f.hasta}::date
           and (${f.vehiculoId}::uuid is null or j.vehiculo_id = ${f.vehiculoId}::uuid)
           and (${f.codigoSucursal}::text is null or s.codigo = ${f.codigoSucursal}::text)
        window w as (partition by j.vehiculo_id order by j.fecha, j.cerrada_en, j.id)
      )
      select b.id as jornada_id,
             b.vehiculo_id,
             v.nombre as vehiculo_nombre,
             v.placas,
             v.activo as vehiculo_activo,
             to_char(b.fecha, 'YYYY-MM-DD') as fecha,
             ve.nombre as vendedor,
             round(b.km_inicial * 10)::int as km_inicial_decimas,
             round(b.km_final * 10)::int as km_final_decimas,
             round(b.km_final_anterior * 10)::int as km_final_anterior_decimas,
             to_char(b.fecha_anterior, 'YYYY-MM-DD') as fecha_anterior
        from base b
        join vehiculo v on v.id = b.vehiculo_id
        join vendedor ve on ve.id = b.vendedor_id
       where b.fecha >= ${f.desde}::date
       order by b.vehiculo_id, b.fecha, b.cerrada_en, b.id
    `.execute(this.db);

    return filas.rows.map((r) => ({
      jornadaId: r.jornada_id,
      vehiculoId: r.vehiculo_id,
      vehiculoNombre: r.vehiculo_nombre,
      placas: r.placas,
      vehiculoActivo: r.vehiculo_activo,
      fecha: r.fecha,
      vendedor: r.vendedor,
      kmInicialDecimas: r.km_inicial_decimas,
      kmFinalDecimas: r.km_final_decimas,
      kmFinalAnteriorDecimas: r.km_final_anterior_decimas,
      fechaAnterior: r.fecha_anterior,
    }));
  }
}
```

> Nota: `round(numeric)::int` lo manda `pg` como **número** (int4), no como cadena; `numeric` sin convertir
> llegaría como texto. Si alguna columna llegara como cadena, la e2e (`kmFinalDecimas: 102505` con `toEqual`)
> lo atrapa.

- [ ] **Paso 5: Servicio y controller**

```ts
// apps/backend/src/modules/estadisticas/reporte-kilometraje.service.ts
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type { ReporteKilometrajeDto } from './dto/reporte-kilometraje.dto';
import {
  armarReporte,
  validarRango,
  type ReporteKilometraje,
} from './reglas-kilometraje';
import { ReporteKilometrajeRepository } from './reporte-kilometraje.repository';

@Injectable()
export class ReporteKilometrajeService {
  constructor(private readonly repo: ReporteKilometrajeRepository) {}

  async kilometraje(
    usuarioId: string,
    q: ReporteKilometrajeDto,
  ): Promise<ReporteKilometraje> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);

    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );

    const filas = await this.repo.jornadas({
      desde: q.desde,
      hasta: q.hasta,
      vehiculoId: q.vehiculo ?? null,
      codigoSucursal: alcance.tipo === 'una' ? alcance.codigo : null,
    });
    return armarReporte(q.desde, q.hasta, filas);
  }
}
```

```ts
// apps/backend/src/modules/estadisticas/reporte-kilometraje.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { ReporteKilometrajeDto } from './dto/reporte-kilometraje.dto';
import type { ReporteKilometraje } from './reglas-kilometraje';
import { ReporteKilometrajeService } from './reporte-kilometraje.service';

// T-50. `reportes.ver` ("Acceso a reportes", sembrado en T-05) es el permiso
// de toda la seccion Informacion -> Reportes.
@Controller('reportes')
export class ReportesController {
  constructor(private readonly kilometraje: ReporteKilometrajeService) {}

  @Get('kilometraje')
  @RequierePermiso('reportes.ver')
  reporteKilometraje(
    @UsuarioActual() usuarioId: string,
    @Query() q: ReporteKilometrajeDto,
  ): Promise<ReporteKilometraje> {
    return this.kilometraje.kilometraje(usuarioId, q);
  }
}
```

- [ ] **Paso 6: Registra en el módulo**

```ts
// apps/backend/src/modules/estadisticas/estadisticas.module.ts
import { Module } from '@nestjs/common';
import { ReportesController } from './reporte-kilometraje.controller';
import { ReporteKilometrajeRepository } from './reporte-kilometraje.repository';
import { ReporteKilometrajeService } from './reporte-kilometraje.service';

// "Estadisticas y Reportes" del vault. T-50 trae el primero: Kilometraje
// (lee `jornada` de T-38; no escribe nada).
@Module({
  controllers: [ReportesController],
  providers: [ReporteKilometrajeService, ReporteKilometrajeRepository],
})
export class EstadisticasModule {}
```

- [ ] **Paso 7: Corre la e2e y confirma que pasa**

Run: `npm run test:e2e --workspace=apps/backend -- reporte-kilometraje`
Expected: PASS, 11 pruebas (1 + 1 + 1 + 1 + 6 del `it.each` + 1).

- [ ] **Paso 8: Suites completas, lint, build y commit**

Run: `npm test --workspace=apps/backend`, `npm run test:e2e --workspace=apps/backend`,
`npm run lint --workspace=apps/backend`, `npm run build --workspace=apps/backend`
Expected: todo en verde.

```bash
git add apps/backend/src/modules/estadisticas apps/backend/test/reporte-kilometraje.e2e-spec.ts
git commit -m "T-50: GET /reportes/kilometraje — jornadas por vehiculo con el salto contra la anterior

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
