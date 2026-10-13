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

---

### Tarea 3: La utilidad de Excel (T-15) — `lib/excel/`

Reutilizable por cualquier reporte del portal: recibe una definición (título, filtros, columnas, filas) y genera
un `.xlsx` real en el navegador. No sabe nada de kilometraje.

**Archivos:**
- Modificar: `package.json` (raíz) — `overrides` de `uuid` solo para `exceljs` (desviación 2)
- Modificar: `apps/portal/package.json` y `package-lock.json` — dependencia `exceljs@4.4.0`
- Crear: `apps/portal/src/lib/excel/definicion.ts`
- Crear: `apps/portal/src/lib/excel/construir-libro.ts` (+ `construir-libro.test.ts`)
- Crear: `apps/portal/src/lib/excel/exportar.ts` (+ `exportar.test.ts`)

**Interfaces:**
- Produce:
  - `type TipoColumna = "texto" | "numero" | "pesos" | "fecha"`
  - `interface ColumnaExcel { encabezado: string; ancho?: number; tipo: TipoColumna; decimales?: number }`
  - `type Celda = string | number | null` — en columnas `numero`/`pesos` va el número **en la unidad que se
    muestra** (km, pesos), no en décimas ni centavos; en `fecha`, `AAAA-MM-DD` (otro texto se escribe tal cual,
    p. ej. "Total Nissan-01" en la primera columna)
  - `interface FilaExcel { celdas: Celda[]; tipo?: "normal" | "subtotal" | "total" | "grupo"; resaltada?: boolean }`
  - `interface DefinicionExcel { titulo: string; filtros: Array<[etiqueta: string, valor: string]>; columnas: ColumnaExcel[]; filas: FilaExcel[]; nombreArchivo: string }`
  - `cargarExcelJS(): Promise<typeof import("exceljs")>`
  - `construirLibro(def: DefinicionExcel): Promise<ArrayBuffer>`
  - `exportarExcel(def: DefinicionExcel): Promise<void>`

- [ ] **Paso 1: Instala `exceljs` y el override**

Run: `npm install exceljs@4.4.0 --workspace=apps/portal`

Agrega al `package.json` de la **raíz**, después de `devDependencies`:

```json
  "overrides": {
    "exceljs": {
      "uuid": "^11.1.1"
    }
  }
```

Run: `npm install` y luego `npm ls uuid --workspace=apps/portal` (debe mostrar `exceljs@4.4.0 └── uuid@11.x`) y
`npm audit --omit=dev --workspace=apps/portal` (no debe listar `uuid` por `exceljs`).
Si `npm install` cambia en `package-lock.json` solo marcas `"peer": true` de otros paquetes, eso es ruido de la
versión de npm: no lo mezcles, quédate con los cambios de `exceljs`/`uuid` (`git add -p package-lock.json`).

- [ ] **Paso 2: Los tipos**

```ts
// apps/portal/src/lib/excel/definicion.ts

/**
 * Exportacion a Excel reutilizable (T-15). Un reporte describe QUE quiere en
 * la hoja; `construirLibro` decide COMO se ve. Nada aqui sabe de kilometraje.
 */

export type TipoColumna = "texto" | "numero" | "pesos" | "fecha";

export interface ColumnaExcel {
  encabezado: string;
  /** Ancho en caracteres. Sin el, el del encabezado + 2 (minimo 12). */
  ancho?: number;
  tipo: TipoColumna;
  /** Solo para `numero`. Por defecto 0. */
  decimales?: number;
}

/**
 * - `numero` / `pesos`: el numero en la unidad que se ve (km, pesos), no en
 *   decimas ni centavos.
 * - `fecha`: `AAAA-MM-DD`. Cualquier otro texto se escribe tal cual (p. ej.
 *   "Total Nissan-01" en la primera columna de un subtotal).
 */
export type Celda = string | number | null;

export interface FilaExcel {
  celdas: Celda[];
  /** `grupo`: encabezado de un bloque (negrita). `subtotal`/`total`: negrita con borde arriba. */
  tipo?: "normal" | "subtotal" | "total" | "grupo";
  /** Fondo amarillo claro: algo que hay que mirar (p. ej. un salto de kilometraje). */
  resaltada?: boolean;
}

export interface DefinicionExcel {
  /** Fila 1, en negrita. */
  titulo: string;
  /** Una fila cada uno, debajo del titulo: "Rango: 01/10/2026 a 13/10/2026". */
  filtros: Array<[etiqueta: string, valor: string]>;
  columnas: ColumnaExcel[];
  filas: FilaExcel[];
  /** Sin extension. */
  nombreArchivo: string;
}
```

- [ ] **Paso 3: Escribe la prueba de `construirLibro` que falla**

```ts
// apps/portal/src/lib/excel/construir-libro.test.ts
// @vitest-environment node
// En jsdom, `exceljs` (version de Node) no siempre se lleva con los Blob/Buffer
// del entorno; el libro no toca el DOM, asi que se prueba en Node.
import { describe, expect, it } from "vitest";
import { cargarExcelJS, construirLibro } from "./construir-libro";
import type { DefinicionExcel } from "./definicion";

const DEF: DefinicionExcel = {
  titulo: "Reporte de prueba",
  filtros: [
    ["Rango", "01/10/2026 a 13/10/2026"],
    ["Sucursal", "TJ"],
  ],
  columnas: [
    { encabezado: "Fecha", tipo: "fecha", ancho: 12 },
    { encabezado: "Vendedor", tipo: "texto", ancho: 24 },
    { encabezado: "Km", tipo: "numero", decimales: 1 },
    { encabezado: "Monto", tipo: "pesos" },
  ],
  filas: [
    { tipo: "grupo", celdas: ["Nissan-01", null, null, null] },
    { celdas: ["2026-10-01", "Juan Pérez", 10250.5, 1500] },
    { celdas: ["2026-10-02", "Pedro López", 120, null], resaltada: true },
    { tipo: "subtotal", celdas: ["Total Nissan-01", null, 10370.5, 1500] },
    { tipo: "total", celdas: ["Total general", null, 10370.5, 1500] },
  ],
  nombreArchivo: "prueba",
};

async function leer(def: DefinicionExcel) {
  const ExcelJS = await cargarExcelJS();
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await construirLibro(def));
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error("El libro no trae hoja.");
  return hoja;
}

describe("construirLibro", () => {
  it("pone titulo, filtros y encabezados congelados en negrita con fondo gris", async () => {
    const hoja = await leer(DEF);
    expect(hoja.getCell("A1").value).toBe("Reporte de prueba");
    expect(hoja.getCell("A1").font?.bold).toBe(true);
    expect(hoja.getCell("A2").value).toBe("Rango: 01/10/2026 a 13/10/2026");
    expect(hoja.getCell("A3").value).toBe("Sucursal: TJ");
    // Fila 4 en blanco; encabezados en la 5.
    expect(hoja.getRow(5).values).toEqual([undefined, "Fecha", "Vendedor", "Km", "Monto"]);
    expect(hoja.getCell("A5").font?.bold).toBe(true);
    expect(hoja.getCell("A5").fill).toMatchObject({ pattern: "solid", fgColor: { argb: "FFE5E7EB" } });
    expect(hoja.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
    expect(hoja.getColumn(1).width).toBe(12);
    expect(hoja.getColumn(3).width).toBe(12); // "Km" + 2 < 12: minimo
  });

  it("escribe numeros como numeros, fechas como fechas y cada formato", async () => {
    const hoja = await leer(DEF);
    const fecha = hoja.getCell("A7").value;
    expect(fecha).toBeInstanceOf(Date);
    expect((fecha as Date).toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(hoja.getCell("A7").numFmt).toBe("dd/mm/yyyy");
    expect(hoja.getCell("C7").value).toBe(10250.5);
    expect(typeof hoja.getCell("C7").value).toBe("number");
    expect(hoja.getCell("C7").numFmt).toBe("#,##0.0");
    expect(hoja.getCell("D7").numFmt).toBe('"$"#,##0.00');
    expect(hoja.getCell("D8").value).toBeNull();
  });

  it("negrita en grupo, subtotal y total; borde arriba en subtotal y total; resaltada en amarillo", async () => {
    const hoja = await leer(DEF);
    expect(hoja.getCell("A6").font?.bold).toBe(true); // grupo
    expect(hoja.getCell("A6").value).toBe("Nissan-01");
    expect(hoja.getCell("B8").fill).toMatchObject({ fgColor: { argb: "FFFEF3C7" } });
    const sinResaltar = hoja.getCell("A7").fill as { fgColor?: { argb?: string } } | undefined;
    expect(sinResaltar?.fgColor?.argb).not.toBe("FFFEF3C7");
    expect(hoja.getCell("A9").value).toBe("Total Nissan-01"); // texto en columna de fecha
    expect(hoja.getCell("C9").font?.bold).toBe(true);
    expect(hoja.getCell("C9").border?.top?.style).toBe("thin");
    expect(hoja.getCell("C10").font?.bold).toBe(true);
    expect(hoja.getCell("C10").border?.top?.style).toBe("thin");
  });
});
```

- [ ] **Paso 4: Corre la prueba y confirma que falla**

Run: `npm test --workspace=apps/portal -- src/lib/excel/construir-libro.test.ts`
Expected: FAIL con `Failed to resolve import "./construir-libro"`.

- [ ] **Paso 5: Implementa `construirLibro`**

```ts
// apps/portal/src/lib/excel/construir-libro.ts
import type { Borders, Fill } from "exceljs";
import type { Celda, ColumnaExcel, DefinicionExcel } from "./definicion";

type ModuloExcelJS = typeof import("exceljs");

/**
 * `exceljs` pesa ~1 MB: se carga SOLO al exportar, no con cada pantalla.
 * Es CommonJS: segun quien lo empaquete (Next en el navegador, Vitest en
 * Node) llega con o sin `default`.
 */
export async function cargarExcelJS(): Promise<ModuloExcelJS> {
  const modulo = (await import("exceljs")) as ModuloExcelJS & {
    default?: ModuloExcelJS;
  };
  return modulo.default ?? modulo;
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RELLENO_ENCABEZADO: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
const RELLENO_RESALTADA: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
const BORDE_ARRIBA: Partial<Borders> = { top: { style: "thin" } };

function formato(col: ColumnaExcel): string | undefined {
  switch (col.tipo) {
    case "numero": {
      const decimales = col.decimales ?? 0;
      return decimales > 0 ? `#,##0.${"0".repeat(decimales)}` : "#,##0";
    }
    case "pesos":
      return '"$"#,##0.00';
    case "fecha":
      return "dd/mm/yyyy";
    default:
      return undefined;
  }
}

/** Una fecha `AAAA-MM-DD` va como fecha de Excel (medianoche UTC: sin corrimiento de dia). */
function aValor(celda: Celda, col: ColumnaExcel | undefined): string | number | Date | null {
  if (col?.tipo === "fecha" && typeof celda === "string" && RE_FECHA.test(celda)) {
    return new Date(`${celda}T00:00:00Z`);
  }
  return celda;
}

/** El `.xlsx` como `ArrayBuffer`, sin tocar el DOM (se prueba en Node). */
export async function construirLibro(def: DefinicionExcel): Promise<ArrayBuffer> {
  const ExcelJS = await cargarExcelJS();
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Reporte");

  hoja.columns = def.columnas.map((c) => ({
    width: c.ancho ?? Math.max(12, c.encabezado.length + 2),
  }));

  const titulo = hoja.addRow([def.titulo]);
  titulo.getCell(1).font = { bold: true, size: 14 };
  for (const [etiqueta, valor] of def.filtros) {
    hoja.addRow([`${etiqueta}: ${valor}`]);
  }
  hoja.addRow([]);

  const encabezados = hoja.addRow(def.columnas.map((c) => c.encabezado));
  encabezados.eachCell((celda) => {
    celda.font = { bold: true };
    celda.fill = RELLENO_ENCABEZADO;
  });
  hoja.views = [{ state: "frozen", ySplit: encabezados.number }];

  for (const fila of def.filas) {
    const renglon = hoja.addRow(fila.celdas.map((c, i) => aValor(c, def.columnas[i])));
    def.columnas.forEach((col, i) => {
      const celda = renglon.getCell(i + 1);
      const numFmt = formato(col);
      if (numFmt) celda.numFmt = numFmt;
      if (fila.tipo && fila.tipo !== "normal") celda.font = { bold: true };
      if (fila.tipo === "subtotal" || fila.tipo === "total") celda.border = BORDE_ARRIBA;
      if (fila.resaltada) celda.fill = RELLENO_RESALTADA;
    });
  }

  // En Node `writeBuffer` da un Buffer y en el navegador un ArrayBuffer;
  // `new Uint8Array(...)` deja en los dos un ArrayBuffer propio y completo.
  return new Uint8Array(await libro.xlsx.writeBuffer()).buffer as ArrayBuffer;
}
```

- [ ] **Paso 6: Corre la prueba y confirma que pasa**

Run: `npm test --workspace=apps/portal -- src/lib/excel/construir-libro.test.ts`
Expected: PASS, 3 pruebas.

- [ ] **Paso 7: Prueba de `exportarExcel` que falla**

```ts
// apps/portal/src/lib/excel/exportar.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as construir from "./construir-libro";
import { exportarExcel } from "./exportar";
import type { DefinicionExcel } from "./definicion";

vi.mock("./construir-libro", () => ({ construirLibro: vi.fn(), cargarExcelJS: vi.fn() }));

const DEF: DefinicionExcel = {
  titulo: "T",
  filtros: [],
  columnas: [{ encabezado: "A", tipo: "texto" }],
  filas: [],
  nombreArchivo: "kilometraje_2026-10-01_a_2026-10-13",
};

describe("exportarExcel", () => {
  const crear = vi.fn(() => "blob:prueba");
  const revocar = vi.fn();

  beforeEach(() => {
    vi.mocked(construir.construirLibro).mockResolvedValue(new ArrayBuffer(4));
    // jsdom no implementa createObjectURL.
    Object.defineProperty(URL, "createObjectURL", { value: crear, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revocar, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("descarga el libro con el nombre .xlsx y libera la URL", async () => {
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("kilometraje_2026-10-01_a_2026-10-13.xlsx");
      expect(this.href).toBe("blob:prueba");
    });

    await exportarExcel(DEF);

    expect(construir.construirLibro).toHaveBeenCalledWith(DEF);
    expect(clic).toHaveBeenCalledTimes(1);
    const blob = crear.mock.calls[0]?.[0] as unknown as Blob;
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(revocar).toHaveBeenCalledWith("blob:prueba");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
```

Run: `npm test --workspace=apps/portal -- src/lib/excel/exportar.test.ts`
Expected: FAIL con `Failed to resolve import "./exportar"`.

- [ ] **Paso 8: Implementa `exportarExcel`**

```ts
// apps/portal/src/lib/excel/exportar.ts
import { construirLibro } from "./construir-libro";
import type { DefinicionExcel } from "./definicion";

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Arma el libro y lo descarga como `<nombreArchivo>.xlsx`. */
export async function exportarExcel(def: DefinicionExcel): Promise<void> {
  const datos = await construirLibro(def);
  const url = URL.createObjectURL(new Blob([datos], { type: TIPO_XLSX }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `${def.nombreArchivo}.xlsx`;
  document.body.appendChild(enlace);
  try {
    enlace.click();
  } finally {
    enlace.remove();
    URL.revokeObjectURL(url);
  }
}
```

Run: `npm test --workspace=apps/portal -- src/lib/excel`
Expected: PASS, 4 pruebas.

- [ ] **Paso 9: Suite, lint y commit**

Run: `npm test --workspace=apps/portal` y `npm run lint --workspace=apps/portal`
Expected: todo en verde. (`pantalla-ruta-diaria.test.tsx` tiene una falla intermitente previa ajena: si falla,
re-corre y anótalo.)

```bash
git add package.json package-lock.json apps/portal/package.json apps/portal/src/lib/excel
git commit -m "T-15: utilidad reutilizable de exportacion a Excel (exceljs bajo demanda)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: `lib/reportes.ts` — tipos, llamada, formatos y la definición de Excel del reporte

**Archivos:**
- Crear: `apps/portal/src/lib/reportes.ts`
- Prueba: `apps/portal/src/lib/reportes.test.ts`

**Interfaces:**
- Consume: `apiFetch` de `./api`; `DefinicionExcel`, `FilaExcel` de `./excel/definicion` (Tarea 3). La forma de
  `ReporteKilometraje` es la del backend (Tarea 1), copiada aquí: el portal no importa del backend.
- Produce:
  - tipos `JornadaEnReporte`, `VehiculoEnReporte`, `ReporteKilometraje`
  - `interface FiltrosKilometraje { desde: string; hasta: string; vehiculoId: string | null; sucursal: string | null }`
  - `obtenerReporteKilometraje(f: FiltrosKilometraje): Promise<ReporteKilometraje>`
  - `formatearKm(decimas: number): string` · `formatearSalto(decimas: number | null): string`
  - `formatearFecha(iso: string): string` (`AAAA-MM-DD` → `dd/mm/aaaa`)
  - `explicarSalto(j: JornadaEnReporte): string | undefined`
  - `etiquetaVehiculo(v: { nombre: string; placas: string | null; activo: boolean }): string`
  - `etiquetaSucursal(codigoDelUsuario: string | null, pedida: string | null): string`
  - `primerDiaDelMes(hoy: string): string`
  - `definicionExcelKilometraje(reporte: ReporteKilometraje, filtros: { sucursal: string; vehiculo: string }): DefinicionExcel`

- [ ] **Paso 1: Escribe la prueba que falla**

```ts
// apps/portal/src/lib/reportes.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  definicionExcelKilometraje,
  etiquetaSucursal,
  etiquetaVehiculo,
  explicarSalto,
  formatearFecha,
  formatearKm,
  formatearSalto,
  obtenerReporteKilometraje,
  primerDiaDelMes,
  type ReporteKilometraje,
} from "./reportes";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const REPORTE: ReporteKilometraje = {
  desde: "2026-10-01",
  hasta: "2026-10-13",
  vehiculos: [
    {
      vehiculoId: "v1",
      nombre: "Nissan-01",
      placas: "ABC-123",
      activo: true,
      jornadas: [
        { jornadaId: "j1", fecha: "2026-10-01", vendedor: "Juan Pérez", kmInicialDecimas: 100000, kmFinalDecimas: 102505, kilometrosDecimas: 2505, saltoDecimas: null, fechaAnterior: null },
        { jornadaId: "j2", fecha: "2026-10-02", vendedor: "Pedro López", kmInicialDecimas: 104000, kmFinalDecimas: 105200, kilometrosDecimas: 1200, saltoDecimas: 1495, fechaAnterior: "2026-10-01" },
      ],
      totalKilometrosDecimas: 3705,
      totalSaltoDecimas: 1495,
    },
  ],
  totalKilometrosDecimas: 3705,
  totalSaltoDecimas: 1495,
};

describe("obtenerReporteKilometraje", () => {
  beforeEach(() => apiFetch.mockReset());

  it("manda rango y omite vehiculo y sucursal si no hay", async () => {
    apiFetch.mockResolvedValue(REPORTE);
    await obtenerReporteKilometraje({ desde: "2026-10-01", hasta: "2026-10-13", vehiculoId: null, sucursal: null });
    expect(apiFetch).toHaveBeenCalledWith("/reportes/kilometraje?desde=2026-10-01&hasta=2026-10-13");
  });

  it("agrega vehiculo y sucursal", async () => {
    apiFetch.mockResolvedValue(REPORTE);
    await obtenerReporteKilometraje({ desde: "2026-10-01", hasta: "2026-10-13", vehiculoId: "v1", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenCalledWith(
      "/reportes/kilometraje?desde=2026-10-01&hasta=2026-10-13&vehiculo=v1&sucursal=TJ",
    );
  });
});

describe("formatos", () => {
  it("formatearKm: miles con coma y un decimal (Review Focus 3)", () => {
    expect(formatearKm(100005)).toBe("10,000.5");
    expect(formatearKm(0)).toBe("0.0");
    expect(formatearKm(-300)).toBe("−30.0");
  });

  it("formatearSalto: vacio sin salto, con signo si lo hay", () => {
    expect(formatearSalto(null)).toBe("");
    expect(formatearSalto(0)).toBe("");
    expect(formatearSalto(1500)).toBe("+150.0");
    expect(formatearSalto(-300)).toBe("−30.0");
  });

  it("formatearFecha y primerDiaDelMes", () => {
    expect(formatearFecha("2026-10-02")).toBe("02/10/2026");
    expect(primerDiaDelMes("2026-10-13")).toBe("2026-10-01");
  });

  it("explicarSalto solo cuando hay salto", () => {
    expect(explicarSalto(REPORTE.vehiculos[0].jornadas[0])).toBeUndefined();
    expect(explicarSalto(REPORTE.vehiculos[0].jornadas[1])).toBe(
      "Empezó 149.5 km distinto a como terminó la jornada anterior de este vehículo (01/10/2026).",
    );
  });

  it("etiquetas de vehiculo y sucursal", () => {
    expect(etiquetaVehiculo({ nombre: "Nissan-01", placas: "ABC-123", activo: true })).toBe("Nissan-01 (ABC-123)");
    expect(etiquetaVehiculo({ nombre: "Vieja", placas: null, activo: false })).toBe("Vieja (desactivado)");
    expect(etiquetaSucursal("TJ", null)).toBe("TJ");
    expect(etiquetaSucursal(null, "MX")).toBe("MX");
    expect(etiquetaSucursal(null, "todas")).toBe("Todas");
    expect(etiquetaSucursal(null, null)).toBe("Todas");
  });
});

describe("definicionExcelKilometraje", () => {
  it("arma titulo, filtros aplicados, columnas y filas con grupo, subtotal, total y salto resaltado", () => {
    const def = definicionExcelKilometraje(REPORTE, { sucursal: "TJ", vehiculo: "Todos" });
    expect(def.titulo).toBe("Reporte de Kilometraje");
    expect(def.filtros).toEqual([
      ["Rango", "01/10/2026 a 13/10/2026"],
      ["Sucursal", "TJ"],
      ["Vehículo", "Todos"],
    ]);
    expect(def.columnas.map((c) => c.encabezado)).toEqual(["Fecha", "Vendedor", "Km inicial", "Km final", "Kilómetros", "Salto"]);
    expect(def.nombreArchivo).toBe("kilometraje_2026-10-01_a_2026-10-13");
    expect(def.filas).toEqual([
      { tipo: "grupo", celdas: ["Nissan-01 (ABC-123)", null, null, null, null, null] },
      { celdas: ["2026-10-01", "Juan Pérez", 10000, 10250.5, 250.5, null], resaltada: false },
      { celdas: ["2026-10-02", "Pedro López", 10400, 10520, 120, 149.5], resaltada: true },
      { tipo: "subtotal", celdas: ["Total Nissan-01 (ABC-123)", null, null, null, 370.5, 149.5] },
      { tipo: "total", celdas: ["Total general", null, null, null, 370.5, 149.5] },
    ]);
  });
});
```

- [ ] **Paso 2: Corre la prueba y confirma que falla**

Run: `npm test --workspace=apps/portal -- src/lib/reportes.test.ts`
Expected: FAIL con `Failed to resolve import "./reportes"`.

- [ ] **Paso 3: Implementa**

```ts
// apps/portal/src/lib/reportes.ts
import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";

/*
 * Reporte de Kilometraje (T-50). Misma forma que
 * apps/backend/src/modules/estadisticas/reglas-kilometraje.ts (el portal no
 * puede importar del backend). Kilometros en DECIMAS de km enteras.
 */

export interface JornadaEnReporte {
  jornadaId: string;
  fecha: string;
  vendedor: string;
  kmInicialDecimas: number;
  kmFinalDecimas: number;
  kilometrosDecimas: number;
  /** `null` = sin jornada anterior; `0` = empezo donde termino la anterior. */
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

export interface FiltrosKilometraje {
  desde: string;
  hasta: string;
  vehiculoId: string | null;
  /** Codigo, `todas`, o null: lo decide el servidor (`resolverAlcance`). */
  sucursal: string | null;
}

export function obtenerReporteKilometraje(f: FiltrosKilometraje): Promise<ReporteKilometraje> {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (f.vehiculoId) q.set("vehiculo", f.vehiculoId);
  if (f.sucursal) q.set("sucursal", f.sucursal);
  return apiFetch<ReporteKilometraje>(`/reportes/kilometraje?${q.toString()}`);
}

const MENOS = "−"; // U+2212: el signo menos tipografico, no el guion.

/** `100005` → `"10,000.5"`; negativos con `−`. */
export function formatearKm(decimas: number): string {
  const texto = (Math.abs(decimas) / 10).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return decimas < 0 ? `${MENOS}${texto}` : texto;
}

/** Vacio sin salto (`null` o `0`); si no, con signo: `+150.0` / `−30.0`. */
export function formatearSalto(decimas: number | null): string {
  if (decimas === null || decimas === 0) return "";
  return decimas > 0 ? `+${formatearKm(decimas)}` : formatearKm(decimas);
}

/** `AAAA-MM-DD` → `dd/mm/aaaa`, sin pasar por `Date` (que correria el dia). */
export function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

export function primerDiaDelMes(hoy: string): string {
  return `${hoy.slice(0, 8)}01`;
}

/** El `title` del salto en pantalla. */
export function explicarSalto(j: JornadaEnReporte): string | undefined {
  if (j.saltoDecimas === null || j.saltoDecimas === 0 || j.fechaAnterior === null) return undefined;
  return `Empezó ${formatearKm(Math.abs(j.saltoDecimas))} km distinto a como terminó la jornada anterior de este vehículo (${formatearFecha(j.fechaAnterior)}).`;
}

export function etiquetaVehiculo(v: { nombre: string; placas: string | null; activo: boolean }): string {
  return `${v.nombre}${v.placas ? ` (${v.placas})` : ""}${v.activo ? "" : " (desactivado)"}`;
}

/** Lo que dice el Excel en "Sucursal": la del usuario si esta atado a una; si no, la pedida o "Todas". */
export function etiquetaSucursal(codigoDelUsuario: string | null, pedida: string | null): string {
  if (codigoDelUsuario) return codigoDelUsuario;
  if (!pedida || pedida.toLowerCase() === "todas") return "Todas";
  return pedida.toUpperCase();
}

const km = (decimas: number): number => decimas / 10;
const saltoEnKm = (decimas: number | null): number | null =>
  decimas === null || decimas === 0 ? null : decimas / 10;

/**
 * Lo que esta en pantalla, como hoja de Excel. `filtros` son los APLICADOS en
 * la ultima consulta, no lo que el usuario tenga escrito ahora (Review Focus 5).
 */
export function definicionExcelKilometraje(
  reporte: ReporteKilometraje,
  filtros: { sucursal: string; vehiculo: string },
): DefinicionExcel {
  const filas: FilaExcel[] = [];
  for (const v of reporte.vehiculos) {
    const etiqueta = etiquetaVehiculo(v);
    filas.push({ tipo: "grupo", celdas: [etiqueta, null, null, null, null, null] });
    for (const j of v.jornadas) {
      filas.push({
        celdas: [j.fecha, j.vendedor, km(j.kmInicialDecimas), km(j.kmFinalDecimas), km(j.kilometrosDecimas), saltoEnKm(j.saltoDecimas)],
        resaltada: j.saltoDecimas !== null && j.saltoDecimas !== 0,
      });
    }
    filas.push({
      tipo: "subtotal",
      celdas: [`Total ${etiqueta}`, null, null, null, km(v.totalKilometrosDecimas), saltoEnKm(v.totalSaltoDecimas)],
    });
  }
  filas.push({
    tipo: "total",
    celdas: ["Total general", null, null, null, km(reporte.totalKilometrosDecimas), saltoEnKm(reporte.totalSaltoDecimas)],
  });

  return {
    titulo: "Reporte de Kilometraje",
    filtros: [
      ["Rango", `${formatearFecha(reporte.desde)} a ${formatearFecha(reporte.hasta)}`],
      ["Sucursal", filtros.sucursal],
      ["Vehículo", filtros.vehiculo],
    ],
    columnas: [
      { encabezado: "Fecha", tipo: "fecha", ancho: 12 },
      { encabezado: "Vendedor", tipo: "texto", ancho: 28 },
      { encabezado: "Km inicial", tipo: "numero", decimales: 1, ancho: 14 },
      { encabezado: "Km final", tipo: "numero", decimales: 1, ancho: 14 },
      { encabezado: "Kilómetros", tipo: "numero", decimales: 1, ancho: 14 },
      { encabezado: "Salto", tipo: "numero", decimales: 1, ancho: 12 },
    ],
    filas,
    nombreArchivo: `kilometraje_${reporte.desde}_a_${reporte.hasta}`,
  };
}
```

- [ ] **Paso 4: Corre la prueba y confirma que pasa**

Run: `npm test --workspace=apps/portal -- src/lib/reportes.test.ts`
Expected: PASS, 8 pruebas.

- [ ] **Paso 5: Suite, lint y commit**

Run: `npm test --workspace=apps/portal` y `npm run lint --workspace=apps/portal`

```bash
git add apps/portal/src/lib/reportes.ts apps/portal/src/lib/reportes.test.ts
git commit -m "T-50: portal — lib/reportes: llamada, formatos de km y la hoja de Excel del reporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 5: Portal — *Información → Reportes* y el Reporte de Kilometraje

**Archivos:**
- Crear: `apps/portal/src/components/reportes/lista-reportes.tsx` (+ `lista-reportes.test.tsx`)
- Crear: `apps/portal/src/components/reportes/tabla-kilometraje.tsx`
- Crear: `apps/portal/src/components/reportes/pantalla-kilometraje.tsx` (+ `pantalla-kilometraje.test.tsx`)
- Modificar: `apps/portal/src/app/(portal)/informacion/reportes/page.tsx` (hoy `Placeholder`)
- Crear: `apps/portal/src/app/(portal)/informacion/reportes/kilometraje/page.tsx`

**Interfaces:**
- Consume (Tarea 4): `obtenerReporteKilometraje`, `definicionExcelKilometraje`, `etiquetaSucursal`,
  `etiquetaVehiculo`, `explicarSalto`, `formatearFecha`, `formatearKm`, `formatearSalto`, `primerDiaDelMes`,
  `ReporteKilometraje` de `@/lib/reportes`.
- Consume (Tarea 3): `exportarExcel` de `@/lib/excel/exportar`.
- Consume (existentes): `useAuth()` → `{ usuario, puede }` de `@/components/auth/auth-provider`;
  `listarVehiculos(sucursal)` y `Vehiculo` de `@/lib/vehiculos`; `hoyEnTijuana()` de `@/lib/ventas`;
  `mensajeDe(err, porDefecto)` de `@/lib/api`; `cn` de `@/lib/utils`; `Button`, `Card*` de `@/components/ui/`.
- Produce: `ListaReportes({ sucursal })`, `PantallaKilometraje({ sucursal })`, `TablaKilometraje({ reporte })`.

- [ ] **Paso 1: Escribe las pruebas que fallan**

```tsx
// apps/portal/src/components/reportes/lista-reportes.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ListaReportes } from "./lista-reportes";

vi.mock("@/components/auth/auth-provider");
// next/link fuera del router de Next: un <a> basta para la prueba.
vi.mock("next/link", () => ({
  default: ({ href, children, ...resto }: { href: string; children: ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

describe("ListaReportes", () => {
  it("sin reportes.ver lo dice", () => {
    mockAuth(() => false);
    render(<ListaReportes sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver reportes")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Kilometraje" })).not.toBeInTheDocument();
  });

  it("enlaza Kilometraje conservando la sucursal del filtro global", () => {
    mockAuth((clave) => clave === "reportes.ver");
    render(<ListaReportes sucursal="TJ" />);
    expect(screen.getByRole("link", { name: "Kilometraje" })).toHaveAttribute(
      "href",
      "/informacion/reportes/kilometraje?sucursal=TJ",
    );
  });
});
```

```tsx
// apps/portal/src/components/reportes/pantalla-kilometraje.test.tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as excel from "@/lib/excel/exportar";
import * as reportes from "@/lib/reportes";
import type { ReporteKilometraje } from "@/lib/reportes";
import { hoyEnTijuana } from "@/lib/ventas";
import * as vehiculosLib from "@/lib/vehiculos";
import { PantallaKilometraje } from "./pantalla-kilometraje";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/reportes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/reportes")>();
  return { ...real, obtenerReporteKilometraje: vi.fn() };
});
vi.mock("@/lib/vehiculos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vehiculos")>();
  return { ...real, listarVehiculos: vi.fn() };
});
vi.mock("@/lib/excel/exportar", () => ({ exportarExcel: vi.fn() }));

const obtener = vi.mocked(reportes.obtenerReporteKilometraje);
const listarVehiculos = vi.mocked(vehiculosLib.listarVehiculos);
const exportarExcel = vi.mocked(excel.exportarExcel);

const REPORTE: ReporteKilometraje = {
  desde: "2026-10-01",
  hasta: "2026-10-13",
  vehiculos: [
    {
      vehiculoId: "v1",
      nombre: "Nissan-01",
      placas: "ABC-123",
      activo: true,
      jornadas: [
        { jornadaId: "j1", fecha: "2026-10-01", vendedor: "Juan Pérez", kmInicialDecimas: 100000, kmFinalDecimas: 102505, kilometrosDecimas: 2505, saltoDecimas: null, fechaAnterior: null },
        { jornadaId: "j2", fecha: "2026-10-02", vendedor: "Pedro López", kmInicialDecimas: 104000, kmFinalDecimas: 105200, kilometrosDecimas: 1200, saltoDecimas: 1495, fechaAnterior: "2026-10-01" },
      ],
      totalKilometrosDecimas: 3705,
      totalSaltoDecimas: 1495,
    },
    {
      vehiculoId: "v2",
      nombre: "Vieja",
      placas: null,
      activo: false,
      jornadas: [
        { jornadaId: "j3", fecha: "2026-10-03", vendedor: "Juan Pérez", kmInicialDecimas: 5000, kmFinalDecimas: 5600, kilometrosDecimas: 600, saltoDecimas: null, fechaAnterior: null },
      ],
      totalKilometrosDecimas: 600,
      totalSaltoDecimas: 0,
    },
  ],
  totalKilometrosDecimas: 4305,
  totalSaltoDecimas: 1495,
};

const VEHICULOS = [
  { id: "v1", nombre: "Nissan-01", placas: "ABC-123", kmInicial: 0, sucursalId: "s", sucursalCodigo: "TJ", activo: true },
  { id: "v2", nombre: "Vieja", placas: null, kmInicial: 0, sucursalId: "s", sucursalCodigo: "TJ", activo: false },
];

function mockAuth(puede: (clave: string) => boolean, codigoSucursal: string | null = null) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1",
      login: "ana",
      nombre: "Ana",
      perfil: "Administrador General",
      sucursal: codigoSucursal ? { id: "s", codigo: codigoSucursal, nombre: codigoSucursal } : null,
      permisos: [],
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

describe("PantallaKilometraje", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarVehiculos.mockResolvedValue(VEHICULOS);
    obtener.mockResolvedValue(REPORTE);
    exportarExcel.mockResolvedValue(undefined);
  });

  it("sin reportes.ver lo dice y no pide nada", () => {
    mockAuth(() => false);
    render(<PantallaKilometraje sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver reportes")).toBeInTheDocument();
    expect(listarVehiculos).not.toHaveBeenCalled();
    expect(obtener).not.toHaveBeenCalled();
  });

  it("arranca con el mes en curso, lista los vehiculos de la sucursal y no consulta hasta Consultar", async () => {
    mockAuth(() => true);
    render(<PantallaKilometraje sucursal="TJ" />);
    const hoy = hoyEnTijuana();
    expect(screen.getByLabelText("Desde")).toHaveValue(`${hoy.slice(0, 8)}01`);
    expect(screen.getByLabelText("Hasta")).toHaveValue(hoy);
    expect(await screen.findByRole("option", { name: "Vieja (desactivado)" })).toBeInTheDocument();
    expect(listarVehiculos).toHaveBeenCalledWith("TJ");
    expect(obtener).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
  });

  it("con fechas invertidas avisa y no consulta", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal={null} />);
    const desde = screen.getByLabelText("Desde");
    await usuario.clear(desde);
    await usuario.type(desde, "2026-12-31");
    await usuario.click(screen.getByRole("button", { name: "Consultar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior a la final.");
    expect(obtener).not.toHaveBeenCalled();
  });

  it("pinta grupos, totales y el salto resaltado con su explicacion", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal="TJ" />);
    await usuario.click(screen.getByRole("button", { name: "Consultar" }));

    expect(await screen.findByText("Nissan-01 (ABC-123)")).toBeInTheDocument();
    expect(screen.getByText("Vieja (desactivado)", { selector: "th" })).toBeInTheDocument();
    const salto = screen.getByText("+149.5");
    expect(salto).toHaveAttribute(
      "title",
      "Empezó 149.5 km distinto a como terminó la jornada anterior de este vehículo (01/10/2026).",
    );
    expect(salto.closest("tr")).toHaveAttribute("data-salto", "si");
    expect(screen.getByText("02/10/2026").closest("tr")).toHaveAttribute("data-salto", "si");
    expect(screen.getByText("01/10/2026").closest("tr")).not.toHaveAttribute("data-salto");
    const total = screen.getByText("Total general").closest("tr");
    expect(total).not.toBeNull();
    expect(within(total as HTMLElement).getByText("430.5")).toBeInTheDocument();
    expect(obtener).toHaveBeenCalledWith({
      desde: `${hoyEnTijuana().slice(0, 8)}01`,
      hasta: hoyEnTijuana(),
      vehiculoId: null,
      sucursal: "TJ",
    });
  });

  it("sin jornadas lo dice y no deja exportar", async () => {
    mockAuth(() => true);
    obtener.mockResolvedValue({ ...REPORTE, vehiculos: [], totalKilometrosDecimas: 0, totalSaltoDecimas: 0 });
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal={null} />);
    await usuario.click(screen.getByRole("button", { name: "Consultar" }));
    expect(await screen.findByText("No hay jornadas cerradas en ese rango.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
  });

  it("muestra el mensaje del servidor si la consulta falla", async () => {
    mockAuth(() => true);
    obtener.mockRejectedValue(new ErrorApi("x", 400, "El rango no puede pasar de un año."));
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal={null} />);
    await usuario.click(screen.getByRole("button", { name: "Consultar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El rango no puede pasar de un año.");
  });

  it("Review Focus 5: exporta lo consultado con los filtros aplicados, aunque luego se cambien", async () => {
    mockAuth(() => true, "TJ");
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal={null} />);
    await screen.findByRole("option", { name: "Nissan-01 (ABC-123)" });
    await usuario.selectOptions(screen.getByLabelText("Vehículo"), "v1");
    await usuario.click(screen.getByRole("button", { name: "Consultar" }));
    await screen.findByText("Total general");

    // Cambia los filtros SIN volver a consultar.
    await usuario.selectOptions(screen.getByLabelText("Vehículo"), "");
    await usuario.click(screen.getByRole("button", { name: "Exportar a Excel" }));

    expect(exportarExcel).toHaveBeenCalledTimes(1);
    const def = exportarExcel.mock.calls[0]?.[0];
    expect(def?.filtros).toEqual([
      ["Rango", "01/10/2026 a 13/10/2026"],
      ["Sucursal", "TJ"],
      ["Vehículo", "Nissan-01 (ABC-123)"],
    ]);
    expect(def?.nombreArchivo).toBe("kilometraje_2026-10-01_a_2026-10-13");
  });
});
```

- [ ] **Paso 2: Corre las pruebas y confirma que fallan**

Run: `npm test --workspace=apps/portal -- src/components/reportes`
Expected: FAIL con `Failed to resolve import "./lista-reportes"` y `"./pantalla-kilometraje"`.

- [ ] **Paso 3: La lista de reportes**

```tsx
// apps/portal/src/components/reportes/lista-reportes.tsx
"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";

/** Información → Reportes (T-50): la lista. Hoy, uno; Ventas (#49), Clientes nuevos (#51)... se suman aqui. */
export function ListaReportes({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const consulta = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reportes</CardTitle>
      </CardHeader>
      <CardContent>
        {!puede("reportes.ver") ? (
          <p className="text-sm text-muted-foreground">No tienes permiso para ver reportes</p>
        ) : (
          <ul className="flex flex-col gap-3">
            <li>
              <Link href={`/informacion/reportes/kilometraje${consulta}`} className="font-medium underline">
                Kilometraje
              </Link>
              <p className="text-sm text-muted-foreground">
                Kilómetros por vehículo y día, con los saltos entre jornadas. Exportable a Excel.
              </p>
            </li>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Paso 4: La tabla**

```tsx
// apps/portal/src/components/reportes/tabla-kilometraje.tsx
import {
  etiquetaVehiculo,
  explicarSalto,
  formatearFecha,
  formatearKm,
  formatearSalto,
  type ReporteKilometraje,
} from "@/lib/reportes";
import { cn } from "@/lib/utils";

/** Un `tbody` por vehiculo: encabezado, sus jornadas y su total. Gran total en el `tfoot`. */
export function TablaKilometraje({ reporte }: { reporte: ReporteKilometraje }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-2">Fecha</th>
          <th>Vendedor</th>
          <th className="text-right">Km inicial</th>
          <th className="text-right">Km final</th>
          <th className="text-right">Kilómetros</th>
          <th className="text-right">Salto</th>
        </tr>
      </thead>
      {reporte.vehiculos.map((v) => (
        <tbody key={v.vehiculoId}>
          <tr className="border-t bg-muted/40">
            <th colSpan={6} scope="rowgroup" className="py-2 text-left font-semibold">
              {etiquetaVehiculo(v)}
            </th>
          </tr>
          {v.jornadas.map((j) => {
            const conSalto = j.saltoDecimas !== null && j.saltoDecimas !== 0;
            return (
              <tr
                key={j.jornadaId}
                className={cn("border-t", conSalto && "bg-amber-50")}
                data-salto={conSalto ? "si" : undefined}
              >
                <td className="py-1.5">{formatearFecha(j.fecha)}</td>
                <td>{j.vendedor}</td>
                <td className="text-right">{formatearKm(j.kmInicialDecimas)}</td>
                <td className="text-right">{formatearKm(j.kmFinalDecimas)}</td>
                <td className="text-right">{formatearKm(j.kilometrosDecimas)}</td>
                <td className="text-right font-semibold" title={explicarSalto(j)}>
                  {formatearSalto(j.saltoDecimas)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t font-semibold">
            <td colSpan={4} className="py-1.5">
              Total {etiquetaVehiculo(v)}
            </td>
            <td className="text-right">{formatearKm(v.totalKilometrosDecimas)}</td>
            <td className="text-right">{formatearSalto(v.totalSaltoDecimas)}</td>
          </tr>
        </tbody>
      ))}
      <tfoot>
        <tr className="border-t-2 font-semibold">
          <td colSpan={4} className="py-2">
            Total general
          </td>
          <td className="text-right">{formatearKm(reporte.totalKilometrosDecimas)}</td>
          <td className="text-right">{formatearSalto(reporte.totalSaltoDecimas)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
```

- [ ] **Paso 5: La pantalla**

```tsx
// apps/portal/src/components/reportes/pantalla-kilometraje.tsx
"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import {
  definicionExcelKilometraje,
  etiquetaSucursal,
  etiquetaVehiculo,
  obtenerReporteKilometraje,
  primerDiaDelMes,
  type ReporteKilometraje,
} from "@/lib/reportes";
import { listarVehiculos, type Vehiculo } from "@/lib/vehiculos";
import { hoyEnTijuana } from "@/lib/ventas";
import { TablaKilometraje } from "./tabla-kilometraje";

/** Lo que se consulto y con que filtros: es lo que se exporta (Review Focus 5). */
interface Consultado {
  reporte: ReporteKilometraje;
  sucursal: string;
  vehiculo: string;
}

/**
 * Información → Reportes → Kilometraje (T-50). La pagina monta este componente
 * con `key={sucursal}`: cambiar el selector global de sucursal empieza limpio.
 */
export function PantallaKilometraje({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario } = useAuth();
  const permitido = puede("reportes.ver");
  const [desde, setDesde] = useState(() => primerDiaDelMes(hoyEnTijuana()));
  const [hasta, setHasta] = useState(() => hoyEnTijuana());
  const [vehiculoId, setVehiculoId] = useState("");
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [consultado, setConsultado] = useState<Consultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Una consulta lenta que llega tarde no pisa a la mas nueva.
  const ultimaConsulta = useRef(0);

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarVehiculos(sucursal).then(
      (lista) => {
        if (vigente) setVehiculos(lista);
      },
      () => {
        // Sin la lista, el filtro se queda en "Todos": el reporte sigue sirviendo.
      },
    );
    return () => {
      vigente = false;
    };
  }, [permitido, sucursal]);

  if (!permitido) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reporte de Kilometraje</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver reportes</p>
        </CardContent>
      </Card>
    );
  }

  async function alConsultar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (desde > hasta) {
      setError("La fecha inicial no puede ser posterior a la final.");
      return;
    }
    const esta = ++ultimaConsulta.current;
    setCargando(true);
    try {
      const reporte = await obtenerReporteKilometraje({
        desde,
        hasta,
        vehiculoId: vehiculoId || null,
        sucursal,
      });
      if (esta !== ultimaConsulta.current) return;
      const elegido = vehiculos.find((v) => v.id === vehiculoId);
      setConsultado({
        reporte,
        sucursal: etiquetaSucursal(usuario?.sucursal?.codigo ?? null, sucursal),
        vehiculo: elegido ? etiquetaVehiculo(elegido) : "Todos",
      });
    } catch (err) {
      if (esta !== ultimaConsulta.current) return;
      setConsultado(null);
      setError(mensajeDe(err, "No se pudo consultar el reporte."));
    } finally {
      if (esta === ultimaConsulta.current) setCargando(false);
    }
  }

  async function alExportar() {
    if (!consultado) return;
    setError(null);
    setExportando(true);
    try {
      await exportarExcel(
        definicionExcelKilometraje(consultado.reporte, {
          sucursal: consultado.sucursal,
          vehiculo: consultado.vehiculo,
        }),
      );
    } catch {
      setError("No se pudo generar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const hayResultados = consultado !== null && consultado.reporte.vehiculos.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporte de Kilometraje</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alConsultar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="km-desde" className="text-sm font-medium">
              Desde
            </label>
            <input
              id="km-desde"
              type="date"
              required
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="km-hasta" className="text-sm font-medium">
              Hasta
            </label>
            <input
              id="km-hasta"
              type="date"
              required
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="km-vehiculo" className="text-sm font-medium">
              Vehículo
            </label>
            <select
              id="km-vehiculo"
              value={vehiculoId}
              onChange={(e) => setVehiculoId(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Todos</option>
              {vehiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {etiquetaVehiculo(v)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={cargando}>
            Consultar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!hayResultados || exportando}
            onClick={() => void alExportar()}
          >
            Exportar a Excel
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}

        {consultado &&
          (hayResultados ? (
            <TablaKilometraje reporte={consultado.reporte} />
          ) : (
            <p className="text-sm text-muted-foreground">No hay jornadas cerradas en ese rango.</p>
          ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Paso 6: Las rutas**

```tsx
// apps/portal/src/app/(portal)/informacion/reportes/page.tsx
import { ListaReportes } from "@/components/reportes/lista-reportes";

// Server component delgado (mismo patron que /operacion/peticiones).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <ListaReportes sucursal={sucursal ?? null} />;
}
```

```tsx
// apps/portal/src/app/(portal)/informacion/reportes/kilometraje/page.tsx
import { PantallaKilometraje } from "@/components/reportes/pantalla-kilometraje";

// `key`: cambiar la sucursal del selector global vuelve a montar la pantalla
// (filtros y resultados limpios, sin mostrar datos de la sucursal anterior).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaKilometraje key={sucursal ?? ""} sucursal={sucursal ?? null} />;
}
```

- [ ] **Paso 7: Corre las pruebas y confirma que pasan**

Run: `npm test --workspace=apps/portal -- src/components/reportes`
Expected: PASS, 9 pruebas (2 + 7).

- [ ] **Paso 8: Suite, lint, build y commit**

Run: `npm test --workspace=apps/portal`, `npm run lint --workspace=apps/portal`,
`npm run build --workspace=apps/portal`
Expected: todo en verde. El build es el que comprueba que Next empaqueta `exceljs` para el navegador (carga
diferida en un chunk aparte): si el build falla por `exceljs` (p. ej. `fs`/`stream`), **para y reporta** — no
lo "arregles" con configuración de webpack sin preguntar.

```bash
git add apps/portal/src/components/reportes "apps/portal/src/app/(portal)/informacion/reportes"
git commit -m "T-50: portal — Informacion -> Reportes y el Reporte de Kilometraje con exportar a Excel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: Verificación completa, prueba a mano contra la base LOCAL y documentación

**Archivos:**
- Modificar: `CLAUDE.md`
- Modificar (vault, `../jawa-obsidian-memory`, commit local **sin push**): `10-Dominio/Modulos/Estadísticas y Reportes.md`,
  `20-Arquitectura/Stack tecnológico.md` (si existe; si no, la nota de stack que enlace ADR-0002),
  `00-Inicio/Estado del proyecto.md`, `40-Equipo/Bitácora/2026-10-13.md`
- Crear (fuera de git, en el espacio de trabajo que indique el coordinador): `texto-pr.md` y `textos-issues.md`

- [ ] **Paso 1: Todas las suites**

Run, desde la raíz:
- `npm run lint --workspace=apps/backend` · `npm run build --workspace=apps/backend`
- `npm test --workspace=apps/backend` · `npm run test:e2e --workspace=apps/backend`
- `npm run supabase -- test db` (no cambia: sin migración)
- `npm test --workspace=apps/portal` · `npm run lint --workspace=apps/portal` · `npm run build --workspace=apps/portal`
- `git diff main --stat -- apps/tablet` → vacío
- `npm run db:types --workspace=apps/backend` y `git diff --exit-code apps/backend/src/database/schema.d.ts` → sin cambios

Anota los números de cada una para el texto del PR.

- [ ] **Paso 2: Prueba a mano contra la base LOCAL**

> **`.env.development` apunta a la NUBE.** No lo uses. **Nunca** `npm run crear-usuario`/`crear-vendedor` (van a
> la nube).

1. Usuario de prueba con hash real (desde la raíz):
   ```bash
   HASH=$(cd apps/backend && node -e "require('@node-rs/argon2').hash('t50admin1234').then(h=>process.stdout.write(h))")
   C=$(docker ps --format '{{.Names}}' | grep supabase_db)
   docker exec -i $C psql -U postgres -v hash="$HASH" <<'SQL'
   insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
   select 't50admin', 'Admin T-50', :'hash', p.id, null from perfil p where p.nombre = 'Administrador General';
   SQL
   ```
2. Datos: un vendedor y dos vehículos de TJ, y jornadas de este mes con **un salto** (+149.5) y un vehículo
   desactivado (por SQL, como en la e2e de la Tarea 2: `insert into vendedor …`, `insert into vehiculo …`,
   `insert into jornada (… abierta_en, cerrada_en)`), con nombres `T50 …` para poder borrarlos.
3. Backend y portal contra la local:
   ```bash
   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)
   PORT=3010 npm run backend                                  # terminal 1
   NEXT_PUBLIC_API_URL=http://localhost:3010 npm run portal   # terminal 2
   ```
   Comprueba que el backend lee la local: `t50admin` entra por `/auth/login` (solo existe en la local).
4. En el navegador (`http://localhost:3001`): *Información → Reportes → Kilometraje*; consultar el mes; ver el
   grupo, el salto resaltado con su `title`, el desactivado, los totales; filtrar por vehículo; fechas invertidas;
   **Exportar a Excel** y abrir el `.xlsx` (números sumables, fechas, negritas, amarillo, encabezado congelado).
   Si hay herramientas de navegador (Playwright / Claude in Chrome), guarda capturas en el espacio de trabajo.
5. Limpieza: detén backend y portal; borra lo sembrado (`jornada` → `vehiculo` → `vendedor` → `sesion_refresh` →
   `usuario`, por los nombres `T50 …`/`t50admin`) y confirma que la base quedó como estaba.

- [ ] **Paso 3: `CLAUDE.md`**

Agrega, después del bloque **Ruta diaria (T-37)** y antes de la línea que empieza con
`` `npm run supabase -- migration up --local` aplica migraciones nuevas``:

```markdown
- **Reportes y Excel (T-50 / T-15).** `GET /reportes/kilometraje` (`modules/estadisticas/`, permiso `reportes.ver`)
  lee la `jornada` de T-38; no escribe nada.
  - Kilómetros en **décimas de km enteras** (`round(km * 10)::int` en SQL; las columnas son `numeric(10,1)`).
  - **Salto** = `km_inicial` − `km_final` de la jornada anterior **del mismo vehículo** (orden `fecha, cerrada_en,
    id`), buscada aunque caiga antes de `desde` (`lag` sobre todo lo anterior a `hasta`; el `desde` se aplica
    después). Las jornadas borradas no cuentan.
  - Rango máximo de 366 días; vehículos desactivados o dados de baja sí aparecen.
  - **Todo reporte del portal exporta con `apps/portal/src/lib/excel/`** (`exportarExcel(definición)`), que carga
    `exceljs` solo al exportar. `uuid` de `exceljs` va forzado a `^11.1.1` con `overrides` en el `package.json`
    raíz (aviso de seguridad heredado).
```

- [ ] **Paso 4: Vault** (`../jawa-obsidian-memory`; lee su `AGENTS.md`; frontmatter con `actualizado: 2026-10-13`)

- `Estadísticas y Reportes.md`: el Reporte Kilometraje ya existe (T-50): columnas, salto, rango, Excel; la
  utilidad de Excel (T-15) es la que usarán Ventas (#49), Clientes nuevos (#51) y Nómina (#47).
- Nota de stack del portal: dependencia `exceljs` (carga diferida) y el override de `uuid`.
- `Estado del proyecto.md`: filas **T-50** y **T-15** (implementadas en la rama, PR por abrir) y en **T-38** que su
  tercer criterio queda cubierto por T-50.
- Bitácora `2026-10-13.md`: sección "T-50 y T-15" con las decisiones (renglón por jornada, saltos, T-15 dentro de
  T-50) y la prueba a mano.
- Commit local en el vault (sin `.obsidian/graph.json`), **sin push**.

- [ ] **Paso 5: Textos para quien coordina (sin publicar)**

`texto-pr.md` (cuerpo del PR):

````markdown
## T-50 · Reporte de Kilometraje (+ T-15, exportación a Excel)

*Información → Reportes → Kilometraje*: las jornadas cerradas que sube la tablet (T-38), por vehículo y rango de
fechas, con km inicial, final, kilómetros, **salto** contra la jornada anterior del mismo vehículo y totales.
Exportable a Excel con la utilidad nueva `lib/excel` (T-15), que usarán los demás reportes.

- Un renglón por jornada, agrupado por vehículo, con total por vehículo y gran total.
- **Salto:** si una jornada empieza distinto a como terminó la anterior del mismo vehículo (aunque esa anterior
  sea de antes del rango), el renglón se resalta y dice cuánto (+ km sin registrar, − odómetro que "retrocede").
- Filtros: rango (máx. un año), vehículo y el "Por sucursal" global. Permiso `reportes.ver`.
- Excel real (`exceljs`, cargado solo al exportar): números sumables, fechas, subtotales en negrita, saltos en
  amarillo, encabezado congelado.
- **Sin migración.** La app de tablet no cambia.

### Desviaciones del spec
1. Orden dentro de un vehículo `fecha, cerrada_en, id` (el mismo del salto), no "fecha, luego vendedor".
2. `exceljs` trae un aviso moderado heredado (`uuid` < 11.1.1); se fuerza `uuid@^11.1.1` solo para `exceljs` con
   `overrides` en el `package.json` raíz (`npm audit` en 0).
3. `construirLibro` devuelve `ArrayBuffer` igual en Node y en el navegador.
4. Vehículos dados de baja también aparecen si tienen jornadas en el rango.
5. La lista de vehículos del filtro reusa `GET /vehiculos` (ya existente).

### Pruebas
- Backend: lint y build · unitarias **N** · e2e **N** · pgTAP **N** (sin cambios)
- Portal: **N** pruebas · lint y build
- Tablet: sin cambios (`git diff main --stat -- apps/tablet` vacío)
- A mano en navegador contra la base local: consulta, salto resaltado, vehículo desactivado, filtros, Excel abierto.

### Para Mario
La app no cambia. El reporte se llena con las jornadas que cierra la tablet (T-38): en `sinmex dev` hoy hay 0.

Closes #50
Closes #15

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

`textos-issues.md` (para publicar después del merge):

- **#50**: marcar las 3 casillas (columnas; rango con datos de la app; Excel) y comentar
  "Hecho en #<PR>: *Información → Reportes → Kilometraje*, con salto entre jornadas y exportación a Excel."
- **#15**: marcar las 3 casillas y comentar "Hecho en #<PR> (dentro de T-50): `apps/portal/src/lib/excel/`
  (`exportarExcel(definición)`): encabezados, filtros/rango en el encabezado, subtotales y totales; `exceljs`
  cargado solo al exportar. La usan los próximos reportes (#49, #51, #47)."
- **#38**: marcar la tercera casilla ("alimenta el reporte de kilometraje") — las dos primeras las cierra Mario o
  ya están; comentar "El reporte de kilometraje ya existe (#<PR>, T-50)."
- **#64**: comentario "Idea de T-50: comparar la primera jornada de un vehículo contra el `km_inicial` de su
  alta (hoy el salto solo se mide entre jornadas)."
- **#49, #51, #47**: comentario "La utilidad de Excel ya existe: `apps/portal/src/lib/excel/` (T-15, #<PR>)."

- [ ] **Paso 6: Commit (repo)**

```bash
git add CLAUDE.md
git commit -m "T-50: CLAUDE.md — reportes, decimas de km, salto y la utilidad de Excel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Autorrevisión del plan (hecha al escribirlo)

- **Cobertura del spec:** §3.1 lista y permiso → Tarea 5; §3.2 filtros, tabla, salto, totales, vacío, exportar →
  Tareas 1, 4, 5; §4.1 endpoint, validación, alcance, `lag`, décimas → Tareas 1–2; §4.2 pantallas y `lib/reportes`
  → Tareas 4–5; §4.3 `lib/excel` con `exceljs` diferido, formatos, congelado → Tarea 3; §6 pruebas → en cada
  tarea; §7 documentación y cierre de issues → Tarea 6. Sin huecos.
- **Marcadores pendientes:** ninguno; los "N" del texto del PR los llena la Tarea 6 con los números reales.
- **Tipos entre tareas:** `ReporteKilometraje`/`VehiculoEnReporte`/`JornadaEnReporte` iguales en backend
  (Tarea 1) y portal (Tarea 4); `DefinicionExcel`/`FilaExcel` (Tarea 3) los consume `definicionExcelKilometraje`
  (Tarea 4) y `exportarExcel` (Tarea 5).
- **Review Focus:** 1 → Tareas 1 y 2; 2 → Tarea 2; 3 → Tareas 2 y 4; 4 → Tareas 1 y 2; 5 → Tareas 4 y 5.
