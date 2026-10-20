# Portal · UI parejo y fácil de usar, Etapa 1 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el portal se sienta un solo sistema: menú lateral fijo con la sucursal en su color, piezas comunes en `components/ui/` y las 5 pantallas más disparejas (Ventas, Cobranza, Facturas, Peticiones, Kilometraje) pasadas a esas piezas, sin cambiar ninguna regla de negocio.

**Architecture:** Primero los cimientos sin pantalla (colores y letra en `globals.css` + `app/layout.tsx`, formatos y rangos juntos en `lib/formato.ts` y `lib/fechas.ts`, el mapa de colores en `lib/sucursal-color.ts`); luego las piezas de `components/ui/` (cada una con su prueba), luego el marco (`components/layout/marco-portal.tsx` reemplaza la barra de arriba y el menú viejo) y al final una tarea por pantalla. Las piezas interactivas se apoyan en base-ui (`AlertDialog`, `Tabs`, `Menu`, `Collapsible`), ya instalado y probado en jsdom.

**Tech Stack:** Next.js 15.5 (App Router), React 19.1, Tailwind v4 (`@theme` en `globals.css`), `@base-ui/react` 1.6, `lucide-react`, `next/font/google`, Vitest 3 + Testing Library + user-event 14 (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-20-portal-ui-etapa-1-design.md` (autoridad). Maqueta de referencia (tamaños y colores exactos): la del spec, `https://claude.ai/artifact/PTs75Sx63RnyF5t8PwybbR`.

> **Ensayo en seco (2026-10-20):** el código de las Tasks 1-14 se aplicó tal cual en un worktree desechable sobre `c773187`: 85 archivos de prueba / 708 pruebas en verde, `tsc --noEmit` y lint limpios después de cada tarea, y `next build` sin errores. Lo único que no se ensayó es la revisión en navegador (Task 14, Step 4) y las notas del vault.

## Global Constraints

- **No se toca** `apps/tablet`, `apps/backend`, `supabase/`, ni las pantallas de Mario: `components/produccion/` (Recarga) y `components/gastos/` (Gastos).
- **Ninguna regla de negocio, endpoint ni texto de negocio cambia** (spec §1). Solo forma, orden visual y los textos de interfaz que este plan nombra.
- **Sin dependencias npm nuevas.** `@base-ui/react` 1.6 (`dialog`, `alert-dialog`, `tabs`, `menu`, `collapsible`), `lucide-react` y `next/font/google` ya están.
- El portal se usa **en computadora desde 1366 px**; sin diseño de celular. A 1366 y 1920 px, con el menú abierto o escondido, **la página nunca se desplaza de lado** (una tabla ancha se desplaza dentro de su caja).
- Colores exactos (spec §2.1): Tijuana `TJ` `#1d5b79`; Mexicali `MX` `#6b2d5c`; Todas las sucursales y tinta `#18211d`; menú `#f2f4f1`; líneas `#dde2dd`; texto secundario `#5f6b65`; éxito `#1f7a4d` sobre `#e6f3ec`; aviso `#8a4f06` sobre `#fdf3e1`; error `#b42318` sobre `#fdecea`; información `#3d5566` sobre `#eaf0f4`.
- Letra: **Public Sans** para todo el texto; **Bricolage Grotesque** solo para el título de la pantalla y el nombre de la sucursal; la mono se queda **solo donde ya se usa** (folios).
- Sin etiquetas en mayúsculas, sin sombras en todas las cajas, sin degradados. Sombra solo en lo que flota (lista de sucursales, menú del usuario, ventana de confirmar). Radios: **10 px cajas, 7 px botones y campos, pastillas redondas**. Movimiento solo cuando el usuario actúa, con `motion-reduce`.
- Fechas en pantalla `dd/mm/aaaa`; con hora `dd/mm/aaaa hh:mm`. Nunca se formatean pasando por `Date` (corre el día).
- `localStorage` solo a través de `lib/almacen-local.ts` (con `try/catch`); todo funciona sin él.
- Textos fijos: **"Todas las sucursales"**; el botón del filtro de fechas se llama **"Mostrar"**; **"Exportar a Excel"** / **"Exportando…"**; **"La fecha inicial no puede ser posterior a la final."**; **"Cargando…"**; **"No tienes permiso para ver esta sección."**; etiqueta gris **"Pronto"** en las pantallas "Próximamente".
- Después de **cada** tarea, desde la raíz del repo, los tres limpios: `npm test --workspace=apps/portal`, `npx --workspace=apps/portal tsc --noEmit`, `npm run lint --workspace=apps/portal`.
- Pruebas: Vitest + Testing Library. Se mockea la capa de red (`lib/*.ts`) con `importOriginal`, como las pruebas que ya existen. Una prueba nueva se corre sola con `npx --workspace=apps/portal vitest run <ruta relativa a apps/portal>`.
- Commits en español, con prefijo `Portal UI:`, en la rama `feature/portal-ui-etapa-1`, terminando con una línea en blanco y `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Una fecha que no tiene la forma esperada** (vacía, o con hora UTC como `2026-10-21T19:00:00.000Z`): se muestra tal cual, nunca recorrida un día ni a medias. Prueba en la Task 1 (`formato.test.ts`).
2. **Sin `localStorage` o con basura guardada** (ventana privada, datos bloqueados, JSON roto): el menú abre la sección actual, se puede plegar y esconder, y nada truena. Pruebas en la Task 6 (`secciones-menu.test.tsx`) y la Task 8 (`marco-portal.test.tsx`).
3. **Una sucursal sin color o un código escrito raro** (`?sucursal=en`, `?sucursal=TODAS`, Ensenada el año que viene): tinta y su nombre de la lista; "todas" en cualquier forma es Todas las sucursales. Pruebas en la Task 1 (`sucursal-color.test.ts`) y la Task 7 (`use-sucursal-actual.test.tsx`).
4. **Confirmar dos veces** (doble clic en "Eliminar venta", o una pregunta nueva con otra abierta): la acción corre una sola vez y la pregunta vieja se contesta "no". Pruebas en la Task 4 (`confirmar.test.tsx`) y la Task 9 (`detalle-venta.test.tsx`).
5. **Una tabla ancha a 1366 px con el menú abierto**: la página no se desplaza de lado (`main` con `min-w-0`, la tabla en `CajaTabla` con su propio desplazamiento). Pruebas en la Task 2 (`tabla.test.tsx`) y la Task 8 (`marco-portal.test.tsx`), más la revisión en navegador de la Task 14.

## Mapa de archivos

**Nuevos** (todos bajo `apps/portal/src/`):

| Archivo | Para qué |
|---|---|
| `lib/formato.ts` | `formatearPesos`, `formatearFecha`, `formatearFechaHora`, `plural`, `iniciales` |
| `lib/fechas.ts` | `RangoFechas`, `diaAnterior`, `primerDiaDelMes`, `rangoSemana`, `rangoMes` |
| `lib/sucursal-color.ts` | El color y las siglas de cada sucursal (un solo mapa) |
| `lib/almacen-local.ts` | `leerLocal` / `guardarLocal` que nunca truenan |
| `components/ui/aviso.tsx` | `Aviso` (error / éxito / advertencia / información) |
| `components/ui/etiqueta.tsx` | `Etiqueta`, `EtiquetaStatusVenta`, `TONO_STATUS_VENTA` |
| `components/ui/monto.tsx` | `Monto` (negativo en rojo) |
| `components/ui/fecha.tsx` | `Fecha` (`dd/mm/aaaa`, con hora opcional) |
| `components/ui/tabla.tsx` | `CajaTabla`, `Tabla`, `Th`, `Td`, `TdMonto`, `Fila`, `FilaVacia`, `FilaGrupo`, `FilaTotal` |
| `components/ui/campo.tsx` | `Campo`, `Entrada`, `Lista`, `AreaTexto`, `Casilla` |
| `components/ui/pestanas.tsx` | `Pestanas` (base-ui Tabs) |
| `components/ui/confirmar.tsx` | `Confirmar`, `useConfirmar`, `OpcionesConfirmar` |
| `components/ui/encabezado-pantalla.tsx` | `Pantalla`, `EncabezadoPantalla` |
| `components/ui/estado-pantalla.tsx` | `EstadoPantalla`, `TEXTO_ESTADO_PANTALLA` |
| `components/ui/filtro-fechas.tsx` | `FiltroFechas`, `MENSAJE_RANGO_INVERTIDO` |
| `components/ui/boton-excel.tsx` | `BotonExcel` |
| `components/layout/secciones-menu.tsx` | Las secciones plegables del menú |
| `components/layout/use-sucursal-actual.ts` | Qué sucursal se está viendo y cómo cambiarla |
| `components/layout/bloque-sucursal.tsx` | El bloque de color con la sucursal (y su lista) |
| `components/layout/bloque-usuario.tsx` | Iniciales, nombre, perfil y "Cerrar sesión" |
| `components/layout/marco-portal.tsx` | El marco: menú (o franja escondida) + contenido + título de la pestaña |

Cada archivo nuevo de `lib/` y `components/` lleva su `*.test.ts(x)` al lado.

**Se modifican:** `app/globals.css`, `app/layout.tsx`, `app/(portal)/layout.tsx`, `components/ui/button.tsx`, `components/layout/nav-config.ts`, `lib/ventas.ts`, `lib/reportes.ts`, `lib/reporte-ventas.ts`, `lib/tesoreria.ts`, `lib/peticiones.ts`, las 5 pantallas (Ventas, Cobranza, Facturas, Peticiones, Kilometraje) y sus pruebas, los importadores de rangos de fechas (Tesorería, Flujo, Clientes nuevos, Reporte de Ventas, Cuentas por Cobrar), las 3 copias de `TarjetaMensaje` (Perfiles, Usuarios, Precios), Promociones (texto de "elige sucursal") y `CLAUDE.md`.

**Se borran:** `components/layout/barra-usuario.tsx`, `components/layout/selector-sucursal.tsx`, `components/layout/sidebar-nav.tsx`.

---

### Task 1: Colores, letra y formatos en un solo lugar

**Files:**
- Modify: `apps/portal/src/app/globals.css` (archivo completo)
- Modify: `apps/portal/src/app/layout.tsx` (fuentes)
- Modify: `apps/portal/src/components/ui/button.tsx:7` (radio de 7 px)
- Create: `apps/portal/src/lib/formato.ts`, `apps/portal/src/lib/formato.test.ts`
- Create: `apps/portal/src/lib/fechas.ts`, `apps/portal/src/lib/fechas.test.ts`
- Create: `apps/portal/src/lib/sucursal-color.ts`, `apps/portal/src/lib/sucursal-color.test.ts`
- Modify: `apps/portal/src/lib/ventas.ts:95-103`, `apps/portal/src/lib/reportes.ts:1-3,72-80`, `apps/portal/src/lib/reporte-ventas.ts:71-89`, `apps/portal/src/lib/tesoreria.ts:286-288,324-329` (re-exportan)
- Modify (importan rangos de `lib/fechas`, y `plural` de `lib/formato`): `components/tesoreria/pestana-vista.tsx:8-19`, `components/tesoreria/pestana-movimientos.tsx:7-22`, `components/reportes/pantalla-clientes-nuevos.tsx:15-16`, `components/flujo-efectivo/pantalla-flujo-efectivo.tsx:15-17`, `components/reporte-ventas/pantalla-reporte-ventas.tsx:10-31`, `components/cuentas-por-cobrar/pantalla-cuentas-por-cobrar.tsx:18`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `lib/formato.ts`: `formatearPesos(centavos: number): string`, `formatearFecha(iso: string): string`, `formatearFechaHora(valor: string): string`, `plural(n: number, uno: string, varios: string): string`, `iniciales(nombre: string): string`.
  - `lib/fechas.ts`: `interface RangoFechas { desde: string; hasta: string }`, `diaAnterior(fecha: string): string`, `primerDiaDelMes(fecha: string): string`, `rangoSemana(hoy: string): RangoFechas`, `rangoMes(hoy: string): RangoFechas`.
  - `lib/sucursal-color.ts`: `COLOR_TODAS = "var(--suc-todas)"`, `colorDeSucursal(codigo: string | null): string`, `siglasDeSucursal(codigo: string | null): string`.
  - Clases de Tailwind nuevas: `bg-menu`, `bg-sucursal` / `border-sucursal` / `ring-sucursal` / `accent-sucursal` (leen `--suc`), `text-success` `bg-success-soft`, `text-warning` `bg-warning-soft`, `text-info` `bg-info-soft`, `bg-destructive-soft`, `font-titulo`. Variables CSS `--suc-tj`, `--suc-mx`, `--suc-todas`, `--suc`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`apps/portal/src/lib/formato.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatearFecha, formatearFechaHora, formatearPesos, iniciales, plural } from "./formato";
import * as reportes from "./reportes";
import * as ventas from "./ventas";

describe("formatearPesos", () => {
  it("centavos con separador de miles y el signo antes del $", () => {
    expect(formatearPesos(27000)).toBe("$270.00");
    expect(formatearPesos(123456)).toBe("$1,234.56");
    expect(formatearPesos(-5000)).toBe("-$50.00");
    expect(formatearPesos(0)).toBe("$0.00");
  });

  it("lib/ventas lo sigue exportando: las importaciones viejas no se rompen", () => {
    expect(ventas.formatearPesos).toBe(formatearPesos);
  });
});

describe("formatearFecha", () => {
  it("AAAA-MM-DD → dd/mm/aaaa sin pasar por Date", () => {
    expect(formatearFecha("2026-10-02")).toBe("02/10/2026");
    expect(formatearFecha("2027-01-01")).toBe("01/01/2027");
  });

  it("Review Focus 1: lo que no es una fecha AAAA-MM-DD sale tal cual", () => {
    expect(formatearFecha("")).toBe("");
    expect(formatearFecha("2026-10-21T19:00:00.000Z")).toBe("2026-10-21T19:00:00.000Z");
    expect(formatearFecha("—")).toBe("—");
  });

  it("lib/reportes lo sigue exportando", () => {
    expect(reportes.formatearFecha).toBe(formatearFecha);
  });
});

describe("formatearFechaHora", () => {
  it("AAAA-MM-DD hh:mm (hora de Tijuana, como la manda el servidor) → dd/mm/aaaa hh:mm", () => {
    expect(formatearFechaHora("2026-10-13 09:15")).toBe("13/10/2026 09:15");
  });

  it("Review Focus 1: una hora UTC o una fecha sin hora sale tal cual (no se adivina la zona)", () => {
    expect(formatearFechaHora("2026-10-21T19:00:00.000Z")).toBe("2026-10-21T19:00:00.000Z");
    expect(formatearFechaHora("2026-10-13")).toBe("2026-10-13");
    expect(formatearFechaHora("")).toBe("");
  });
});

describe("plural", () => {
  it("uno y varios", () => {
    expect(plural(1, "venta", "ventas")).toBe("1 venta");
    expect(plural(0, "venta", "ventas")).toBe("0 ventas");
    expect(plural(3, "nota", "notas")).toBe("3 notas");
  });
});

describe("iniciales", () => {
  it("primera letra de las dos primeras palabras; una palabra da sus dos primeras letras", () => {
    expect(iniciales("Admin Local")).toBe("AL");
    expect(iniciales("  roberto  peiro garcía ")).toBe("RP");
    expect(iniciales("Roberto")).toBe("RO");
    expect(iniciales("ángel")).toBe("ÁN");
    expect(iniciales("   ")).toBe("?");
  });
});
```

`apps/portal/src/lib/fechas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diaAnterior, primerDiaDelMes, rangoMes, rangoSemana } from "./fechas";
import * as reporteVentas from "./reporte-ventas";
import * as reportes from "./reportes";
import * as tesoreria from "./tesoreria";

describe("diaAnterior", () => {
  it("cruza meses, años y el 29 de febrero", () => {
    expect(diaAnterior("2026-10-20")).toBe("2026-10-19");
    expect(diaAnterior("2026-03-01")).toBe("2026-02-28");
    expect(diaAnterior("2028-03-01")).toBe("2028-02-29");
    expect(diaAnterior("2027-01-01")).toBe("2026-12-31");
  });
});

describe("primerDiaDelMes", () => {
  it("el día 1 del mismo mes", () => {
    expect(primerDiaDelMes("2026-10-19")).toBe("2026-10-01");
    expect(primerDiaDelMes("2026-02-28")).toBe("2026-02-01");
  });
});

describe("rangoSemana", () => {
  it("de lunes a domingo, aunque la semana cruce de mes o de año", () => {
    expect(rangoSemana("2026-10-14")).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" });
    expect(rangoSemana("2026-10-12")).toEqual({ desde: "2026-10-12", hasta: "2026-10-18" });
    expect(rangoSemana("2026-11-01")).toEqual({ desde: "2026-10-26", hasta: "2026-11-01" });
    expect(rangoSemana("2026-12-31")).toEqual({ desde: "2026-12-28", hasta: "2027-01-03" });
  });
});

describe("rangoMes", () => {
  it("del 1 al último día, febrero bisiesto incluido", () => {
    expect(rangoMes("2026-10-14")).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(rangoMes("2026-02-10")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoMes("2028-02-10")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoMes("2026-12-31")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });
});

describe("los archivos de antes re-exportan las mismas funciones", () => {
  it("reporte-ventas, reportes y tesoreria", () => {
    expect(reporteVentas.rangoSemana).toBe(rangoSemana);
    expect(reporteVentas.rangoMes).toBe(rangoMes);
    expect(reportes.primerDiaDelMes).toBe(primerDiaDelMes);
    expect(tesoreria.diaAnterior).toBe(diaAnterior);
    expect(tesoreria.primerDiaDelMesDe).toBe(primerDiaDelMes);
  });
});
```

`apps/portal/src/lib/sucursal-color.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COLOR_TODAS, colorDeSucursal, siglasDeSucursal } from "./sucursal-color";

describe("colorDeSucursal", () => {
  it("Tijuana azul pacífico y Mexicali morado jamaica, sin importar mayúsculas", () => {
    expect(colorDeSucursal("TJ")).toBe("var(--suc-tj)");
    expect(colorDeSucursal("tj")).toBe("var(--suc-tj)");
    expect(colorDeSucursal("MX")).toBe("var(--suc-mx)");
  });

  it("Review Focus 3: todas, o una sucursal sin color asignado, van en tinta", () => {
    expect(colorDeSucursal(null)).toBe(COLOR_TODAS);
    expect(colorDeSucursal("todas")).toBe(COLOR_TODAS);
    expect(colorDeSucursal("TODAS")).toBe(COLOR_TODAS);
    expect(colorDeSucursal("EN")).toBe(COLOR_TODAS);
    expect(COLOR_TODAS).toBe("var(--suc-todas)");
  });
});

describe("siglasDeSucursal", () => {
  it("el código en mayúsculas; todas dice Todas", () => {
    expect(siglasDeSucursal("tj")).toBe("TJ");
    expect(siglasDeSucursal("MX")).toBe("MX");
    expect(siglasDeSucursal(null)).toBe("Todas");
    expect(siglasDeSucursal("todas")).toBe("Todas");
  });
});
```

- [ ] **Step 2: Correr las pruebas y ver que fallan**

Run: `npx --workspace=apps/portal vitest run src/lib/formato.test.ts src/lib/fechas.test.ts src/lib/sucursal-color.test.ts`
Expected: FAIL — `Failed to resolve import "./formato"` (y lo mismo para `./fechas` y `./sucursal-color`).

- [ ] **Step 3: Crear `lib/formato.ts`, `lib/fechas.ts` y `lib/sucursal-color.ts`**

`apps/portal/src/lib/formato.ts`:

```ts
/**
 * Formatos de pantalla del portal (UI Etapa 1, spec §4.5). Antes vivían repartidos
 * (lib/ventas.ts, lib/reportes.ts y dos copias de `plural`); esos archivos los
 * re-exportan para no romper importaciones.
 */

/** Centavos a `$1,234.56`. El signo va antes del $ ("-$50.00"), como se escribe a mano (T-34). */
export function formatearPesos(centavos: number): string {
  const signo = centavos < 0 ? "-" : "";
  return `${signo}$${(Math.abs(centavos) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const FECHA_Y_HORA = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/**
 * `AAAA-MM-DD` → `dd/mm/aaaa`, sin pasar por `Date` (que correría el día). Lo que no
 * tenga esa forma sale tal cual: mejor ver el dato crudo que una fecha inventada.
 */
export function formatearFecha(iso: string): string {
  const m = SOLO_FECHA.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * `AAAA-MM-DD hh:mm` → `dd/mm/aaaa hh:mm`. El servidor ya la manda en hora de Tijuana
 * (`to_char(... at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI')`). Una hora UTC
 * (`...T19:00:00.000Z`) sale tal cual: convertirla aquí sería adivinar la zona.
 */
export function formatearFechaHora(valor: string): string {
  const m = FECHA_Y_HORA.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : valor;
}

/** `plural(3, "venta", "ventas")` → `"3 ventas"`. */
export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** Para el círculo del usuario: "Admin Local" → "AL"; "Roberto" → "RO". */
export function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "?";
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return `${palabras[0][0]}${palabras[1][0]}`.toUpperCase();
}
```

`apps/portal/src/lib/fechas.ts`:

```ts
/**
 * Rangos de fechas `AAAA-MM-DD` para los atajos de los filtros (UI Etapa 1, spec §4.3).
 * Se cuenta en UTC a medianoche: el día del calendario no depende de la zona del
 * navegador (el equipo desarrolla en Europe/Madrid). "Hoy" lo da `hoyEnTijuana()`
 * (lib/ventas.ts); aquí solo se cuenta a partir de él.
 */

export interface RangoFechas {
  desde: string;
  hasta: string;
}

const MS_DIA = 24 * 60 * 60 * 1000;
const aFecha = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const aIso = (d: Date): string => d.toISOString().slice(0, 10);

/** El día anterior (atajo "Ayer"). */
export function diaAnterior(fecha: string): string {
  const d = aFecha(fecha);
  d.setUTCDate(d.getUTCDate() - 1);
  return aIso(d);
}

/** El día 1 del mes de `fecha`. */
export function primerDiaDelMes(fecha: string): string {
  return `${fecha.slice(0, 8)}01`;
}

/** Lunes a domingo de la semana de `hoy`. */
export function rangoSemana(hoy: string): RangoFechas {
  const d = aFecha(hoy);
  const desdeLunes = (d.getUTCDay() + 6) % 7;
  const lunes = new Date(d.getTime() - desdeLunes * MS_DIA);
  return { desde: aIso(lunes), hasta: aIso(new Date(lunes.getTime() + 6 * MS_DIA)) };
}

/** Del día 1 al último día del mes de `hoy`. */
export function rangoMes(hoy: string): RangoFechas {
  const [anio, mes] = hoy.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0));
  return { desde: primerDiaDelMes(hoy), hasta: aIso(ultimo) };
}
```

`apps/portal/src/lib/sucursal-color.ts`:

```ts
/**
 * El color de cada sucursal (UI Etapa 1, spec §2.1): la única parte llamativa del
 * portal, para saber dónde estás sin leer. Los valores viven en `globals.css`
 * (`--suc-tj`, `--suc-mx`, `--suc-todas`, con su versión oscura).
 *
 * Una sucursal nueva (Ensenada) usa la tinta hasta que se le asigne un color: se
 * agrega aquí Y su variable en `globals.css`.
 */
const COLOR_POR_CODIGO: Record<string, string> = {
  TJ: "var(--suc-tj)",
  MX: "var(--suc-mx)",
};

export const COLOR_TODAS = "var(--suc-todas)";

/** Mismo valor reservado que usa el backend en alcance-sucursal.ts. */
const TODAS = "todas";

const esTodas = (codigo: string | null): codigo is null =>
  codigo === null || codigo === "" || codigo.toLowerCase() === TODAS;

/** `null` (o "todas") = Todas las sucursales. */
export function colorDeSucursal(codigo: string | null): string {
  if (esTodas(codigo)) return COLOR_TODAS;
  return COLOR_POR_CODIGO[codigo.toUpperCase()] ?? COLOR_TODAS;
}

/** Lo que dice la pastilla del menú escondido: "TJ", "MX" o "Todas". */
export function siglasDeSucursal(codigo: string | null): string {
  return esTodas(codigo) ? "Todas" : codigo.toUpperCase();
}
```

- [ ] **Step 4: Hacer que los archivos viejos re-exporten**

En `apps/portal/src/lib/ventas.ts`, reemplazar las líneas 95-103:

```ts
/** Centavos a `$1,234.56`. */
export function formatearPesos(centavos: number): string {
  // El signo va antes del $ ("-$50.00"), como se escribe a mano (T-34).
  const signo = centavos < 0 ? "-" : "";
  return `${signo}$${(Math.abs(centavos) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
```

por:

```ts
/** Vive en lib/formato.ts (UI Etapa 1); se re-exporta para no romper importaciones. */
export { formatearPesos } from "./formato";
```

En `apps/portal/src/lib/reportes.ts`, reemplazar las líneas 1-2:

```ts
import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
```

por:

```ts
import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
import { formatearFecha } from "./formato";

// Viven en lib/formato.ts y lib/fechas.ts (UI Etapa 1); se re-exportan para no romper importaciones.
export { formatearFecha };
export { primerDiaDelMes } from "./fechas";
```

y borrar las líneas 72-80 (quedan sin definición local):

```ts
/** `AAAA-MM-DD` → `dd/mm/aaaa`, sin pasar por `Date` (que correria el dia). */
export function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

export function primerDiaDelMes(hoy: string): string {
  return `${hoy.slice(0, 8)}01`;
}

```

En `apps/portal/src/lib/reporte-ventas.ts`, reemplazar las líneas 71-89:

```ts
const MS_DIA = 24 * 60 * 60 * 1000;

const aFecha = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const aIso = (d: Date): string => d.toISOString().slice(0, 10);

/** Lunes a domingo de la semana de `hoy` (`AAAA-MM-DD`), sin zona horaria de por medio. */
export function rangoSemana(hoy: string): { desde: string; hasta: string } {
  const d = aFecha(hoy);
  const desdeLunes = (d.getUTCDay() + 6) % 7;
  const lunes = new Date(d.getTime() - desdeLunes * MS_DIA);
  return { desde: aIso(lunes), hasta: aIso(new Date(lunes.getTime() + 6 * MS_DIA)) };
}

/** Del día 1 al último día del mes de `hoy`. */
export function rangoMes(hoy: string): { desde: string; hasta: string } {
  const [anio, mes] = hoy.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0));
  return { desde: `${hoy.slice(0, 8)}01`, hasta: aIso(ultimo) };
}
```

por:

```ts
/** Viven en lib/fechas.ts (UI Etapa 1); se re-exportan para no romper importaciones. */
export { rangoMes, rangoSemana } from "./fechas";
```

En `apps/portal/src/lib/tesoreria.ts`, reemplazar las líneas 286-288:

```ts
export function primerDiaDelMesDe(fecha: string): string {
  return `${fecha.slice(0, 8)}01`;
}
```

por:

```ts
/** Vive en lib/fechas.ts como `primerDiaDelMes` (UI Etapa 1); se re-exporta con su nombre de antes. */
export { primerDiaDelMes as primerDiaDelMesDe } from "./fechas";
```

y las líneas 324-329:

```ts
/** El dia anterior a `AAAA-MM-DD` (para el atajo "Ayer"). */
export function diaAnterior(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
```

por:

```ts
/** Vive en lib/fechas.ts (UI Etapa 1); se re-exporta para no romper importaciones. */
export { diaAnterior } from "./fechas";
```

- [ ] **Step 5: Los que usaban rangos de fechas los importan de `lib/fechas` (spec §4.3), y `plural` de `lib/formato`**

`apps/portal/src/components/tesoreria/pestana-vista.tsx` — reemplazar:

```ts
import { rangoMes, rangoSemana } from "@/lib/reporte-ventas";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
import {
  definicionExcelTesoreria,
  diaAnterior,
  describirEvento,
```

por:

```ts
import { diaAnterior, rangoMes, rangoSemana } from "@/lib/fechas";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
import {
  definicionExcelTesoreria,
  describirEvento,
```

`apps/portal/src/components/tesoreria/pestana-movimientos.tsx` — reemplazar:

```ts
import { formatearFecha } from "@/lib/reportes";
import {
  eliminarMovimiento,
  ETIQUETA_TIPO,
  listarCuentasTesoreria,
  listarMovimientos,
  primerDiaDelMesDe,
  type CuentaTesoreria,
```

por:

```ts
import { primerDiaDelMes } from "@/lib/fechas";
import { formatearFecha } from "@/lib/reportes";
import {
  eliminarMovimiento,
  ETIQUETA_TIPO,
  listarCuentasTesoreria,
  listarMovimientos,
  type CuentaTesoreria,
```

y en el mismo archivo:

```ts
  const [desde, setDesde] = useState(primerDiaDelMesDe(hoy));
```

por:

```ts
  const [desde, setDesde] = useState(primerDiaDelMes(hoy));
```

`apps/portal/src/components/reportes/pantalla-clientes-nuevos.tsx` — reemplazar:

```ts
import { rangoMes, rangoSemana } from "@/lib/reporte-ventas";
import { etiquetaSucursal, formatearFecha, primerDiaDelMes } from "@/lib/reportes";
```

por:

```ts
import { primerDiaDelMes, rangoMes, rangoSemana } from "@/lib/fechas";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
```

`apps/portal/src/components/flujo-efectivo/pantalla-flujo-efectivo.tsx` — reemplazar:

```ts
import { rangoMes, rangoSemana } from "@/lib/reporte-ventas";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
import { diaAnterior } from "@/lib/tesoreria";
```

por:

```ts
import { diaAnterior, rangoMes, rangoSemana } from "@/lib/fechas";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
```

`apps/portal/src/components/reporte-ventas/pantalla-reporte-ventas.tsx` — reemplazar:

```ts
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
import {
  definicionExcelReporteVentas,
  formatearPiezas,
  obtenerReporteVentas,
  rangoMes,
  rangoSemana,
  type ReporteVentas,
} from "@/lib/reporte-ventas";
```

por:

```ts
import { rangoMes, rangoSemana } from "@/lib/fechas";
import { plural } from "@/lib/formato";
import { etiquetaSucursal, formatearFecha } from "@/lib/reportes";
import {
  definicionExcelReporteVentas,
  formatearPiezas,
  obtenerReporteVentas,
  type ReporteVentas,
} from "@/lib/reporte-ventas";
```

y borrar en el mismo archivo la línea:

```ts
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

```

`apps/portal/src/components/cuentas-por-cobrar/pantalla-cuentas-por-cobrar.tsx` — reemplazar:

```ts
import { formatearPesos } from "@/lib/ventas";
import { TablaCuentasPorCobrar } from "./tabla-cuentas-por-cobrar";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
```

por:

```ts
import { plural } from "@/lib/formato";
import { formatearPesos } from "@/lib/ventas";
import { TablaCuentasPorCobrar } from "./tabla-cuentas-por-cobrar";
```

- [ ] **Step 6: Colores y letra**

Reemplazar **todo** `apps/portal/src/app/globals.css` por:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* Las fuentes las carga app/layout.tsx con next/font, en <html>. Apuntar --font-sans a
     si misma invalidaba la variable y todo el portal caia en Times. */
  --font-sans: var(--font-public-sans);
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-sans);
  /* Solo el titulo de la pantalla y el nombre de la sucursal (UI Etapa 1, spec §2.1). */
  --font-titulo: var(--font-bricolage);
  /* UI Etapa 1: el menu, el color de la sucursal que se esta viendo y los colores que informan. */
  --color-menu: var(--menu);
  --color-sucursal: var(--suc);
  --color-success: var(--success);
  --color-success-soft: var(--success-soft);
  --color-warning: var(--warning);
  --color-warning-soft: var(--warning-soft);
  --color-info: var(--info);
  --color-info-soft: var(--info-soft);
  --color-destructive-soft: var(--destructive-soft);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  /* Base tranquila (spec §2.1): contenido en blanco, tinta, menu gris con toque verde. */
  --background: #ffffff;
  --foreground: #18211d;
  --card: #ffffff;
  --card-foreground: #18211d;
  --popover: #ffffff;
  --popover-foreground: #18211d;
  --primary: #18211d;
  --primary-foreground: #ffffff;
  --secondary: #f2f4f1;
  --secondary-foreground: #18211d;
  --muted: #f2f4f1;
  --muted-foreground: #5f6b65;
  --accent: #e8ece7;
  --accent-foreground: #18211d;
  --destructive: #b42318;
  --border: #dde2dd;
  --input: #dde2dd;
  --ring: #5f6b65;
  --chart-1: oklch(0.87 0 0);
  --chart-2: oklch(0.556 0 0);
  --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
  --radius: 0.625rem;
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
  --menu: #f2f4f1;
  /* Colores que informan: el texto sobre su fondo suave. */
  --success: #1f7a4d;
  --success-soft: #e6f3ec;
  --warning: #8a4f06;
  --warning-soft: #fdf3e1;
  --destructive-soft: #fdecea;
  --info: #3d5566;
  --info-soft: #eaf0f4;
  /* Un color por sucursal (lib/sucursal-color.ts). La que no tenga usa la tinta. */
  --suc-tj: #1d5b79;
  --suc-mx: #6b2d5c;
  --suc-todas: #18211d;
  --suc: var(--suc-todas);
}

.dark {
  --background: #141917;
  --foreground: #e6ebe7;
  --card: #1b211e;
  --card-foreground: #e6ebe7;
  --popover: #1b211e;
  --popover-foreground: #e6ebe7;
  --primary: #e6ebe7;
  --primary-foreground: #141917;
  --secondary: #1b211e;
  --secondary-foreground: #e6ebe7;
  --muted: #1b211e;
  --muted-foreground: #9aa7a0;
  --accent: #242b27;
  --accent-foreground: #e6ebe7;
  --destructive: #f08a7e;
  --border: #2c3430;
  --input: #2c3430;
  --ring: #9aa7a0;
  --chart-1: oklch(0.87 0 0);
  --chart-2: oklch(0.556 0 0);
  --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
  --menu: #1b211e;
  --success: #6cc79a;
  --success-soft: #18301f;
  --warning: #f0b45a;
  --warning-soft: #33270f;
  --destructive-soft: #3a1a17;
  --info: #a9c1d1;
  --info-soft: #1d2a33;
  --suc-tj: #3f86a8;
  --suc-mx: #a35a90;
  --suc-todas: #4a5650;
  --suc: var(--suc-todas);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
  /* Movimiento solo cuando el usuario actua, y nunca si pidio menos movimiento (spec §2.1). */
  @media (prefers-reduced-motion: reduce) {
    *,
    ::before,
    ::after {
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
    }
  }
}
```

Reemplazar las líneas 1-13 de `apps/portal/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
```

por:

```tsx
import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

// UI Etapa 1 (spec §2.1): Public Sans para todo el texto (cifras de ancho fijo con
// `tabular-nums`) y Bricolage Grotesque solo para el titulo de la pantalla y el nombre
// de la sucursal. La mono se queda donde ya se usaba (folios).
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
```

y en el mismo archivo:

```tsx
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`}>
```

por:

```tsx
    <html lang="es" className={`${publicSans.variable} ${bricolage.variable} ${geistMono.variable}`}>
```

En `apps/portal/src/components/ui/button.tsx`, línea 7 (la cadena base de `buttonVariants`), reemplazar el fragmento `justify-center rounded-lg border` por `justify-center rounded-[7px] border` (radio de botones, spec §2.1). El resto de la cadena y los `rounded-*` de los tamaños `xs`/`sm` se quedan igual.

- [ ] **Step 7: Correr las pruebas nuevas y ver que pasan**

Run: `npx --workspace=apps/portal vitest run src/lib/formato.test.ts src/lib/fechas.test.ts src/lib/sucursal-color.test.ts`
Expected: PASS (todas).

- [ ] **Step 8: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: todas las pruebas pasan (las de `lib/ventas.test.ts`, `lib/reportes.test.ts`, `lib/reporte-ventas.test.ts`, `lib/tesoreria.test.ts` siguen en verde por los re-exports), `tsc` sin errores, lint sin avisos.

- [ ] **Step 9: Commit**

```bash
git add apps/portal/src/app/globals.css apps/portal/src/app/layout.tsx apps/portal/src/components/ui/button.tsx \
  apps/portal/src/lib/formato.ts apps/portal/src/lib/formato.test.ts apps/portal/src/lib/fechas.ts apps/portal/src/lib/fechas.test.ts \
  apps/portal/src/lib/sucursal-color.ts apps/portal/src/lib/sucursal-color.test.ts \
  apps/portal/src/lib/ventas.ts apps/portal/src/lib/reportes.ts apps/portal/src/lib/reporte-ventas.ts apps/portal/src/lib/tesoreria.ts \
  apps/portal/src/components/tesoreria/pestana-vista.tsx apps/portal/src/components/tesoreria/pestana-movimientos.tsx \
  apps/portal/src/components/reportes/pantalla-clientes-nuevos.tsx apps/portal/src/components/flujo-efectivo/pantalla-flujo-efectivo.tsx \
  apps/portal/src/components/reporte-ventas/pantalla-reporte-ventas.tsx apps/portal/src/components/cuentas-por-cobrar/pantalla-cuentas-por-cobrar.tsx
git commit -m "$(cat <<'EOF'
Portal UI: colores, letra y formatos en un solo lugar

Public Sans y Bricolage Grotesque, colores que informan y uno por sucursal
en globals.css; lib/formato.ts, lib/fechas.ts y lib/sucursal-color.ts. Los
archivos de antes re-exportan.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Aviso, Etiqueta, Monto, Fecha y la Tabla común

**Files:**
- Create: `apps/portal/src/components/ui/aviso.tsx`, `aviso.test.tsx`
- Create: `apps/portal/src/components/ui/etiqueta.tsx`, `etiqueta.test.tsx`
- Create: `apps/portal/src/components/ui/monto.tsx`, `monto.test.tsx`
- Create: `apps/portal/src/components/ui/fecha.tsx`, `fecha.test.tsx`
- Create: `apps/portal/src/components/ui/tabla.tsx`, `tabla.test.tsx`

**Interfaces:**
- Consumes: `formatearPesos`, `formatearFecha`, `formatearFechaHora` (`@/lib/formato`, Task 1); `ETIQUETA_STATUS`, `type StatusVenta` (`@/lib/ventas`); clases `bg-success-soft` etc. (Task 1).
- Produces:
  - `Aviso({ tono, children, className }: { tono: TonoAviso; children: ReactNode; className?: string })`, `type TonoAviso = "error" | "exito" | "advertencia" | "informacion"`. `error` → `role="alert"`; los demás → `role="status"`. Lleva `data-tono`.
  - `Etiqueta({ tono = "neutro", children, className })`, `type TonoEtiqueta = "exito" | "advertencia" | "error" | "informacion" | "neutro"`, `TONO_STATUS_VENTA: Record<StatusVenta, TonoEtiqueta>`, `EtiquetaStatusVenta({ status }: { status: StatusVenta })`. La pastilla lleva `data-tono`.
  - `Monto({ centavos, className }: { centavos: number; className?: string })` → `<span>` (negativo con `text-destructive`).
  - `Fecha({ valor, conHora = false }: { valor: string; conHora?: boolean })` → `<time dateTime={valor}>`.
  - `CajaTabla(props: ComponentProps<"div"> & { altoMaximo?: string })`, `Tabla(props: ComponentProps<"table"> & { densidad?: "normal" | "compacta" })`, `Th(props: ComponentProps<"th"> & { alinear?: "izquierda" | "derecha" | "centro" })`, `Td(props: ComponentProps<"td"> & { alinear?: ... })`, `TdMonto(props: Omit<ComponentProps<"td">, "children"> & { centavos: number })`, `Fila(props: ComponentProps<"tr"> & { interactiva?: boolean })`, `FilaVacia({ columnas, children })`, `FilaGrupo({ columnas, children })`, `FilaTotal(props: ComponentProps<"tr">)`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`apps/portal/src/components/ui/aviso.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Aviso } from "./aviso";

describe("Aviso", () => {
  it("un error interrumpe al lector de pantalla (alert) y lleva su tono", () => {
    render(<Aviso tono="error">No se pudo guardar.</Aviso>);
    const aviso = screen.getByRole("alert");
    expect(aviso).toHaveTextContent("No se pudo guardar.");
    expect(aviso).toHaveAttribute("data-tono", "error");
  });

  it.each(["exito", "advertencia", "informacion"] as const)("%s espera su turno (status)", (tono) => {
    render(<Aviso tono={tono}>Listo.</Aviso>);
    expect(screen.getByRole("status")).toHaveAttribute("data-tono", tono);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
```

`apps/portal/src/components/ui/etiqueta.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Etiqueta, EtiquetaStatusVenta } from "./etiqueta";

describe("EtiquetaStatusVenta", () => {
  it.each([
    ["pagada", "Pagada", "exito"],
    ["pendiente", "Pendiente", "advertencia"],
    ["abonado", "Abonado", "informacion"],
    ["promocion", "Promoción", "neutro"],
    ["cuenta_perdida", "Cuenta perdida", "error"],
  ] as const)("%s dice %s en tono %s", (status, texto, tono) => {
    render(<EtiquetaStatusVenta status={status} />);
    expect(screen.getByText(texto)).toHaveAttribute("data-tono", tono);
  });
});

describe("Etiqueta", () => {
  it("sin tono es neutra", () => {
    render(<Etiqueta>Prospecto</Etiqueta>);
    expect(screen.getByText("Prospecto")).toHaveAttribute("data-tono", "neutro");
  });
});
```

`apps/portal/src/components/ui/monto.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Monto } from "./monto";

describe("Monto", () => {
  it("pesos con cifras de ancho fijo", () => {
    render(<Monto centavos={123456} />);
    const monto = screen.getByText("$1,234.56");
    expect(monto).toHaveClass("tabular-nums");
    expect(monto).not.toHaveClass("text-destructive");
  });

  it("un negativo va en rojo y con el signo antes del $", () => {
    render(<Monto centavos={-5000} />);
    expect(screen.getByText("-$50.00")).toHaveClass("text-destructive");
  });
});
```

`apps/portal/src/components/ui/fecha.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Fecha } from "./fecha";

describe("Fecha", () => {
  it("dd/mm/aaaa, con la fecha original en dateTime", () => {
    render(<Fecha valor="2024-03-04" />);
    expect(screen.getByText("04/03/2024")).toHaveAttribute("dateTime", "2024-03-04");
  });

  it("con hora: dd/mm/aaaa hh:mm", () => {
    render(<Fecha valor="2026-10-13 09:15" conHora />);
    expect(screen.getByText("13/10/2026 09:15")).toBeInTheDocument();
  });
});
```

`apps/portal/src/components/ui/tabla.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CajaTabla, Fila, FilaGrupo, FilaTotal, FilaVacia, Tabla, Td, TdMonto, Th } from "./tabla";

function Ejemplo({ densidad }: { densidad?: "normal" | "compacta" }) {
  return (
    <CajaTabla altoMaximo="70vh" data-testid="caja">
      <Tabla densidad={densidad}>
        <thead>
          <tr>
            <Th>Cliente</Th>
            <Th alinear="derecha">Saldo</Th>
          </tr>
        </thead>
        <tbody>
          <FilaGrupo columnas={2}>Nissan-01</FilaGrupo>
          <Fila interactiva>
            <Td>Abarrotes Lupita</Td>
            <TdMonto centavos={-5000} />
          </Fila>
          <FilaVacia columnas={2}>Sin ventas.</FilaVacia>
          <FilaTotal>
            <Td>Total</Td>
            <TdMonto centavos={123456} />
          </FilaTotal>
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

describe("Tabla", () => {
  it("Review Focus 5: la caja se desplaza sola y no empuja la página; con alto máximo fija el encabezado", () => {
    render(<Ejemplo />);
    const caja = screen.getByTestId("caja");
    expect(caja).toHaveClass("overflow-auto");
    expect(caja.style.maxHeight).toBe("70vh");
    expect(screen.getByRole("columnheader", { name: "Cliente" })).toHaveClass("sticky");
  });

  it("encabezados con scope de columna y los montos a la derecha, sin cortar", () => {
    render(<Ejemplo />);
    expect(screen.getByRole("columnheader", { name: "Saldo" })).toHaveAttribute("scope", "col");
    expect(screen.getByRole("columnheader", { name: "Saldo" })).toHaveClass("text-right");
    const celda = screen.getByText("$1,234.56").closest("td");
    expect(celda).toHaveClass("text-right", "whitespace-nowrap");
    expect(screen.getByText("-$50.00")).toHaveClass("text-destructive");
  });

  it("densidad compacta queda en la tabla; normal por defecto", () => {
    const { unmount } = render(<Ejemplo />);
    expect(screen.getByRole("table")).toHaveAttribute("data-densidad", "normal");
    unmount();
    render(<Ejemplo densidad="compacta" />);
    expect(screen.getByRole("table")).toHaveAttribute("data-densidad", "compacta");
  });

  it("fila de grupo, fila vacía y fila de total", () => {
    render(<Ejemplo />);
    expect(screen.getByText("Nissan-01", { selector: "th" })).toHaveAttribute("scope", "rowgroup");
    expect(screen.getByText("Nissan-01", { selector: "th" })).toHaveAttribute("colSpan", "2");
    expect(screen.getByText("Sin ventas.")).toHaveAttribute("colSpan", "2");
    expect(screen.getByText("Total").closest("tr")).toHaveClass("font-semibold");
    expect(screen.getByText("Abarrotes Lupita").closest("tr")).toHaveClass("hover:bg-menu");
  });
});
```

- [ ] **Step 2: Correr las pruebas y ver que fallan**

Run: `npx --workspace=apps/portal vitest run src/components/ui`
Expected: FAIL — `Failed to resolve import "./aviso"` (y las demás).

- [ ] **Step 3: Escribir las piezas**

`apps/portal/src/components/ui/aviso.tsx`:

```tsx
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type TonoAviso = "error" | "exito" | "advertencia" | "informacion";

const ESTILO: Record<TonoAviso, { clase: string; Icono: typeof CircleAlert }> = {
  error: { clase: "bg-destructive-soft text-destructive", Icono: CircleAlert },
  exito: { clase: "bg-success-soft text-success", Icono: CircleCheck },
  advertencia: { clase: "bg-warning-soft text-warning", Icono: TriangleAlert },
  informacion: { clase: "bg-info-soft text-info", Icono: Info },
};

/**
 * Un mensaje en su color (UI Etapa 1, spec §4.5): verde = salió bien, ámbar = ojo,
 * rojo = error, gris azulado = información. El error interrumpe al lector de
 * pantalla (`alert`); los demás esperan su turno (`status`).
 */
export function Aviso({ tono, children, className }: { tono: TonoAviso; children: ReactNode; className?: string }) {
  const { clase, Icono } = ESTILO[tono];
  return (
    <div
      role={tono === "error" ? "alert" : "status"}
      data-tono={tono}
      className={cn("flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm", clase, className)}
    >
      <Icono aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
```

`apps/portal/src/components/ui/etiqueta.tsx`:

```tsx
import type { ReactNode } from "react";
import { ETIQUETA_STATUS, type StatusVenta } from "@/lib/ventas";
import { cn } from "@/lib/utils";

export type TonoEtiqueta = "exito" | "advertencia" | "error" | "informacion" | "neutro";

const CLASE: Record<TonoEtiqueta, string> = {
  exito: "bg-success-soft text-success",
  advertencia: "bg-warning-soft text-warning",
  error: "bg-destructive-soft text-destructive",
  informacion: "bg-info-soft text-info",
  neutro: "bg-muted text-muted-foreground",
};

/** Pastilla redonda con un estado corto (spec §4.5). Sin mayúsculas a propósito. */
export function Etiqueta({
  tono = "neutro",
  children,
  className,
}: {
  tono?: TonoEtiqueta;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-tono={tono}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        CLASE[tono],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Pagada verde, Pendiente ámbar, Abonado gris azulado, Promoción gris, Cuenta perdida rojo. */
export const TONO_STATUS_VENTA: Record<StatusVenta, TonoEtiqueta> = {
  pagada: "exito",
  pendiente: "advertencia",
  abonado: "informacion",
  promocion: "neutro",
  cuenta_perdida: "error",
};

/** El texto sale de `ETIQUETA_STATUS` (lib/ventas.ts), que no cambia. */
export function EtiquetaStatusVenta({ status }: { status: StatusVenta }) {
  return <Etiqueta tono={TONO_STATUS_VENTA[status]}>{ETIQUETA_STATUS[status]}</Etiqueta>;
}
```

`apps/portal/src/components/ui/monto.tsx`:

```tsx
import { formatearPesos } from "@/lib/formato";
import { cn } from "@/lib/utils";

/** Pesos desde centavos, con cifras de ancho fijo; un negativo va en rojo (spec §4.5). */
export function Monto({ centavos, className }: { centavos: number; className?: string }) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", centavos < 0 && "text-destructive", className)}>
      {formatearPesos(centavos)}
    </span>
  );
}
```

`apps/portal/src/components/ui/fecha.tsx`:

```tsx
import { formatearFecha, formatearFechaHora } from "@/lib/formato";

/** `dd/mm/aaaa` (o `dd/mm/aaaa hh:mm` con `conHora`); el valor original queda en `dateTime`. */
export function Fecha({ valor, conHora = false }: { valor: string; conHora?: boolean }) {
  return (
    <time dateTime={valor} className="tabular-nums whitespace-nowrap">
      {conHora ? formatearFechaHora(valor) : formatearFecha(valor)}
    </time>
  );
}
```

`apps/portal/src/components/ui/tabla.tsx`:

```tsx
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Monto } from "./monto";

/*
 * La tabla común (UI Etapa 1, spec §4.2), con el estilo de Reporte de Ventas y
 * Tesorería: encabezados en gris sobre el color del menú, filas separadas por línea.
 */

type Alineacion = "izquierda" | "derecha" | "centro";

const ALINEAR: Record<Alineacion, string> = {
  izquierda: "text-left",
  derecha: "text-right",
  centro: "text-center",
};

/**
 * La caja: borde, esquinas de 10 px y su propio desplazamiento. Una tabla ancha se
 * desplaza aquí dentro y la página no (el `main` del marco lleva `min-w-0`). Con
 * `altoMaximo` también se desplaza hacia abajo dentro de la caja y el encabezado queda fijo.
 */
export function CajaTabla({ altoMaximo, className, style, ...props }: ComponentProps<"div"> & { altoMaximo?: string }) {
  return (
    <div
      {...props}
      className={cn("overflow-auto rounded-[10px] border", className)}
      style={altoMaximo ? { ...style, maxHeight: altoMaximo } : style}
    />
  );
}

export function Tabla({
  densidad = "normal",
  className,
  ...props
}: ComponentProps<"table"> & { densidad?: "normal" | "compacta" }) {
  return (
    <table
      {...props}
      data-densidad={densidad}
      className={cn("group/tabla w-full border-collapse text-sm tabular-nums", className)}
    />
  );
}

export function Th({ alinear = "izquierda", scope = "col", className, ...props }: ComponentProps<"th"> & { alinear?: Alineacion }) {
  return (
    <th
      {...props}
      scope={scope}
      className={cn(
        "sticky top-0 z-[1] border-b bg-menu px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap text-muted-foreground group-data-[densidad=compacta]/tabla:py-1.5",
        ALINEAR[alinear],
        className,
      )}
    />
  );
}

export function Td({ alinear = "izquierda", className, ...props }: ComponentProps<"td"> & { alinear?: Alineacion }) {
  return (
    <td
      {...props}
      className={cn("border-b px-3 py-2 group-data-[densidad=compacta]/tabla:py-1", ALINEAR[alinear], className)}
    />
  );
}

/** Un monto: a la derecha, cifras de ancho fijo y sin cortarse en dos renglones. */
export function TdMonto({ centavos, className, ...props }: Omit<ComponentProps<"td">, "children"> & { centavos: number }) {
  return (
    <Td {...props} alinear="derecha" className={cn("whitespace-nowrap", className)}>
      <Monto centavos={centavos} />
    </Td>
  );
}

/** `interactiva`: la fila se puede picar y lleva un tono suave al pasar el mouse. */
export function Fila({ interactiva = false, className, ...props }: ComponentProps<"tr"> & { interactiva?: boolean }) {
  return <tr {...props} className={cn(interactiva && "hover:bg-menu", className)} />;
}

export function FilaVacia({ columnas, children }: { columnas: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={columnas} className="px-3 py-6 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

/** El encabezado de un grupo (un vehículo, un día): ocupa todo el ancho. */
export function FilaGrupo({ columnas, children }: { columnas: number; children: ReactNode }) {
  return (
    <tr>
      <th colSpan={columnas} scope="rowgroup" className="border-b bg-menu px-3 py-2 text-left font-semibold">
        {children}
      </th>
    </tr>
  );
}

export function FilaTotal({ className, ...props }: ComponentProps<"tr">) {
  return <tr {...props} className={cn("font-semibold [&>td]:border-t-2 [&>td]:border-b-0", className)} />;
}
```

- [ ] **Step 4: Correr las pruebas y ver que pasan**

Run: `npx --workspace=apps/portal vitest run src/components/ui`
Expected: PASS.

- [ ] **Step 5: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/ui/aviso.tsx apps/portal/src/components/ui/aviso.test.tsx \
  apps/portal/src/components/ui/etiqueta.tsx apps/portal/src/components/ui/etiqueta.test.tsx \
  apps/portal/src/components/ui/monto.tsx apps/portal/src/components/ui/monto.test.tsx \
  apps/portal/src/components/ui/fecha.tsx apps/portal/src/components/ui/fecha.test.tsx \
  apps/portal/src/components/ui/tabla.tsx apps/portal/src/components/ui/tabla.test.tsx
git commit -m "$(cat <<'EOF'
Portal UI: Aviso, Etiqueta, Monto, Fecha y la tabla común

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Campos de formulario y Pestañas

**Files:**
- Create: `apps/portal/src/components/ui/campo.tsx`, `campo.test.tsx`
- Create: `apps/portal/src/components/ui/pestanas.tsx`, `pestanas.test.tsx`

**Interfaces:**
- Consumes: clases `ring-sucursal`, `border-sucursal`, `accent-sucursal` (Task 1); `@base-ui/react/tabs`.
- Produces:
  - `Campo({ id, etiqueta, opcional = false, ayuda, error, className, children }: { id: string; etiqueta: ReactNode; opcional?: boolean; ayuda?: ReactNode; error?: string | null; className?: string; children: ReactNode })` — el `<label htmlFor={id}>`; con `opcional` agrega " (opcional)". Los controles de adentro toman de él `id`, `aria-invalid` y `aria-describedby` (lo que el control traiga explícito gana).
  - `Entrada(props: ComponentProps<"input">)`, `Lista(props: ComponentProps<"select">)`, `AreaTexto(props: ComponentProps<"textarea">)`, `Casilla(props: Omit<ComponentProps<"input">, "type"> & { etiqueta?: ReactNode })`.
  - `interface Pestana { valor: string; etiqueta: string; contenido: ReactNode }`, `Pestanas({ pestanas, valorInicial, conservarMontadas = false, etiqueta, className }: { pestanas: Pestana[]; valorInicial?: string; conservarMontadas?: boolean; etiqueta?: string; className?: string })`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`apps/portal/src/components/ui/campo.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AreaTexto, Campo, Casilla, Entrada, Lista } from "./campo";

describe("Campo", () => {
  it("la etiqueta nombra al control de adentro", () => {
    render(
      <Campo id="km-desde" etiqueta="Desde">
        <Entrada type="date" defaultValue="2026-10-01" />
      </Campo>,
    );
    const control = screen.getByLabelText("Desde");
    expect(control).toHaveAttribute("id", "km-desde");
    expect(control).toHaveValue("2026-10-01");
    expect(control).not.toHaveAttribute("aria-invalid");
  });

  it("marca (opcional) en la etiqueta", () => {
    render(
      <Campo id="comentario" etiqueta="Comentario" opcional>
        <AreaTexto />
      </Campo>,
    );
    expect(screen.getByLabelText("Comentario (opcional)").tagName).toBe("TEXTAREA");
  });

  it("ayuda y error quedan ligados al control con aria-describedby y aria-invalid", () => {
    render(
      <Campo id="monto" etiqueta="Monto" ayuda="En pesos." error="El monto debe ser mayor a $0.">
        <Entrada />
      </Campo>,
    );
    const control = screen.getByLabelText("Monto");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription("En pesos. El monto debe ser mayor a $0.");
  });

  it("lo que el control trae explícito gana", () => {
    render(
      <Campo id="uno" etiqueta="Vehículo">
        <Lista id="otro" aria-label="Vehículo propio">
          <option value="">Todos</option>
        </Lista>
      </Campo>,
    );
    expect(screen.getByRole("combobox", { name: "Vehículo propio" })).toHaveAttribute("id", "otro");
  });

  it("deshabilitado pasa al control", () => {
    render(
      <Campo id="n" etiqueta="Número">
        <Entrada disabled />
      </Campo>,
    );
    expect(screen.getByLabelText("Número")).toBeDisabled();
  });
});

describe("Entrada fuera de un Campo", () => {
  it("funciona sola con su aria-label", () => {
    render(<Entrada aria-label="Cantidad de Horchata 1 L" type="number" />);
    expect(screen.getByLabelText("Cantidad de Horchata 1 L")).toHaveAttribute("type", "number");
  });
});

describe("Casilla", () => {
  it("con etiqueta visible", () => {
    render(<Casilla etiqueta="Mostrar también las N/A" defaultChecked />);
    expect(screen.getByLabelText("Mostrar también las N/A")).toBeChecked();
  });

  it("sin etiqueta visible, con aria-label", () => {
    render(<Casilla aria-label="Marcar TJ240401OF01" />);
    expect(screen.getByRole("checkbox", { name: "Marcar TJ240401OF01" })).not.toBeChecked();
  });
});
```

`apps/portal/src/components/ui/pestanas.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pestanas } from "./pestanas";

const PESTANAS = [
  { valor: "asignar", etiqueta: "Asignar", contenido: <input aria-label="Marcado" defaultValue="lo que escribí" /> },
  { valor: "buscar", etiqueta: "Buscar y corregir", contenido: <p>Panel de búsqueda</p> },
];

describe("Pestanas", () => {
  it("abre en la primera, ligada a su panel", () => {
    render(<Pestanas etiqueta="Facturas" pestanas={PESTANAS} />);
    expect(screen.getByRole("tablist", { name: "Facturas" })).toBeInTheDocument();
    const asignar = screen.getByRole("tab", { name: "Asignar" });
    expect(asignar).toHaveAttribute("aria-selected", "true");
    const panel = document.getElementById(asignar.getAttribute("aria-controls") ?? "");
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", asignar.id);
    expect(screen.queryByText("Panel de búsqueda")).not.toBeInTheDocument();
  });

  it("valorInicial elige otra", () => {
    render(<Pestanas pestanas={PESTANAS} valorInicial="buscar" />);
    expect(screen.getByRole("tab", { name: "Buscar y corregir" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Panel de búsqueda")).toBeInTheDocument();
  });

  it("las flechas cambian de pestaña y mueven el foco", async () => {
    const usuario = userEvent.setup();
    render(<Pestanas pestanas={PESTANAS} />);
    screen.getByRole("tab", { name: "Asignar" }).focus();
    await usuario.keyboard("{ArrowRight}");
    const buscar = screen.getByRole("tab", { name: "Buscar y corregir" });
    expect(buscar).toHaveAttribute("aria-selected", "true");
    expect(buscar).toHaveFocus();
    await usuario.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Asignar" })).toHaveAttribute("aria-selected", "true");
  });

  it("sin conservarMontadas, la otra pestaña se desmonta (empieza limpia al volver)", async () => {
    const usuario = userEvent.setup();
    render(<Pestanas pestanas={PESTANAS} />);
    await usuario.clear(screen.getByLabelText("Marcado"));
    await usuario.type(screen.getByLabelText("Marcado"), "nuevo");
    await usuario.click(screen.getByRole("tab", { name: "Buscar y corregir" }));
    expect(screen.queryByLabelText("Marcado")).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("tab", { name: "Asignar" }));
    expect(screen.getByLabelText("Marcado")).toHaveValue("lo que escribí");
  });

  it("con conservarMontadas, la otra queda oculta pero no se pierde lo escrito", async () => {
    const usuario = userEvent.setup();
    render(<Pestanas pestanas={PESTANAS} conservarMontadas />);
    await usuario.clear(screen.getByLabelText("Marcado"));
    await usuario.type(screen.getByLabelText("Marcado"), "nuevo");
    const asignar = screen.getByRole("tab", { name: "Asignar" });
    await usuario.click(screen.getByRole("tab", { name: "Buscar y corregir" }));
    expect(document.getElementById(asignar.getAttribute("aria-controls") ?? "")).toHaveAttribute("hidden");
    await usuario.click(asignar);
    expect(screen.getByLabelText("Marcado")).toHaveValue("nuevo");
  });
});
```

- [ ] **Step 2: Correr las pruebas y ver que fallan**

Run: `npx --workspace=apps/portal vitest run src/components/ui/campo.test.tsx src/components/ui/pestanas.test.tsx`
Expected: FAIL — `Failed to resolve import "./campo"` / `"./pestanas"`.

- [ ] **Step 3: Escribir `campo.tsx` y `pestanas.tsx`**

`apps/portal/src/components/ui/campo.tsx`:

```tsx
"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Campos de formulario (UI Etapa 1, spec §4.6): mismo tamaño, borde visible al
 * escribir (en el color de la sucursal), aspecto de deshabilitado y "(opcional)".
 */

interface ContextoCampo {
  id: string;
  describidoPor: string | undefined;
  invalido: boolean;
}

const Contexto = createContext<ContextoCampo | null>(null);

type AriaInvalido = ComponentProps<"input">["aria-invalid"];

/** Lo que un control toma de su Campo. Lo que el control traiga explícito gana. */
function atributosDeCampo(
  campo: ContextoCampo | null,
  propio: { id?: string; "aria-invalid"?: AriaInvalido; "aria-describedby"?: string },
) {
  return {
    id: propio.id ?? campo?.id,
    "aria-invalid": propio["aria-invalid"] ?? (campo?.invalido ? true : undefined),
    "aria-describedby": propio["aria-describedby"] ?? campo?.describidoPor,
  };
}

const CLASE_CONTROL =
  "h-9 rounded-[7px] border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-sucursal focus-visible:ring-2 focus-visible:ring-sucursal/25 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive";

export function Campo({
  id,
  etiqueta,
  opcional = false,
  ayuda,
  error,
  className,
  children,
}: {
  id: string;
  etiqueta: ReactNode;
  opcional?: boolean;
  ayuda?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  const describidoPor = [idAyuda, idError].filter(Boolean).join(" ") || undefined;
  return (
    <Contexto.Provider value={{ id, describidoPor, invalido: Boolean(error) }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-[13px] font-semibold">
          {etiqueta}
          {opcional && <span className="font-normal text-muted-foreground"> (opcional)</span>}
        </label>
        {children}
        {ayuda && (
          <p id={idAyuda} className="text-xs text-muted-foreground">
            {ayuda}
          </p>
        )}
        {error && (
          <p id={idError} className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    </Contexto.Provider>
  );
}

export function Entrada({ className, ...props }: ComponentProps<"input">) {
  const campo = useContext(Contexto);
  return <input {...props} {...atributosDeCampo(campo, props)} className={cn(CLASE_CONTROL, className)} />;
}

/** Lista desplegable nativa (`<select>`). */
export function Lista({ className, ...props }: ComponentProps<"select">) {
  const campo = useContext(Contexto);
  return <select {...props} {...atributosDeCampo(campo, props)} className={cn(CLASE_CONTROL, "pr-8", className)} />;
}

export function AreaTexto({ className, rows = 2, ...props }: ComponentProps<"textarea">) {
  const campo = useContext(Contexto);
  return (
    <textarea
      {...props}
      rows={rows}
      {...atributosDeCampo(campo, props)}
      className={cn(CLASE_CONTROL, "h-auto min-h-16 py-2", className)}
    />
  );
}

/** Casilla de verificación; con `etiqueta` lleva su texto al lado, sin ella necesita `aria-label`. */
export function Casilla({ etiqueta, className, ...props }: Omit<ComponentProps<"input">, "type"> & { etiqueta?: ReactNode }) {
  const control = (
    <input
      {...props}
      type="checkbox"
      className={cn("size-4 cursor-pointer accent-sucursal disabled:cursor-not-allowed", className)}
    />
  );
  if (!etiqueta) return control;
  return (
    <label className="inline-flex items-center gap-2 text-sm has-disabled:text-muted-foreground">
      {control}
      {etiqueta}
    </label>
  );
}
```

`apps/portal/src/components/ui/pestanas.tsx`:

```tsx
"use client";

import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Pestana {
  valor: string;
  etiqueta: string;
  contenido: ReactNode;
}

/**
 * Pestañas (UI Etapa 1, spec §4.6) sobre base-ui Tabs: roles y teclas ARIA de fábrica
 * (las flechas cambian de pestaña). `conservarMontadas`: las otras quedan ocultas y no
 * se desmontan (Facturas no pierde lo marcado); sin ella, volver a una pestaña la
 * empieza limpia (Peticiones).
 */
export function Pestanas({
  pestanas,
  valorInicial,
  conservarMontadas = false,
  etiqueta,
  className,
}: {
  pestanas: Pestana[];
  valorInicial?: string;
  conservarMontadas?: boolean;
  etiqueta?: string;
  className?: string;
}) {
  return (
    <Tabs.Root defaultValue={valorInicial ?? pestanas[0]?.valor} className={cn("flex flex-col gap-4", className)}>
      <Tabs.List activateOnFocus aria-label={etiqueta} className="flex gap-1 border-b">
        {pestanas.map((p) => (
          <Tabs.Tab
            key={p.valor}
            value={p.valor}
            className="-mb-px rounded-t-[7px] border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-sucursal/40 data-[active]:border-sucursal data-[active]:text-foreground"
          >
            {p.etiqueta}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {pestanas.map((p) => (
        <Tabs.Panel key={p.valor} value={p.valor} keepMounted={conservarMontadas} className="outline-none">
          {p.contenido}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
```

- [ ] **Step 4: Correr las pruebas y ver que pasan**

Run: `npx --workspace=apps/portal vitest run src/components/ui/campo.test.tsx src/components/ui/pestanas.test.tsx`
Expected: PASS.

- [ ] **Step 5: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/ui/campo.tsx apps/portal/src/components/ui/campo.test.tsx \
  apps/portal/src/components/ui/pestanas.tsx apps/portal/src/components/ui/pestanas.test.tsx
git commit -m "$(cat <<'EOF'
Portal UI: campos de formulario y pestañas comunes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Confirmar (ventana en lugar de window.confirm)

**Files:**
- Modify: `apps/portal/src/components/ui/button.tsx:10-21` (variante `peligro`)
- Create: `apps/portal/src/components/ui/confirmar.tsx`, `confirmar.test.tsx`

**Interfaces:**
- Consumes: `Button` (`@/components/ui/button`), `@base-ui/react/alert-dialog`, `font-titulo` (Task 1).
- Produces:
  - `interface OpcionesConfirmar { titulo: string; descripcion: string; confirmar: string; tono?: "peligro" | "normal" }`.
  - `Confirmar({ abierta, opciones, onRespuesta }: { abierta: boolean; opciones: OpcionesConfirmar | null; onRespuesta: (si: boolean) => void })`.
  - `useConfirmar(): { confirmar: (opciones: OpcionesConfirmar) => Promise<boolean>; ventana: ReactNode }` — **sin proveedor**: la pantalla pinta `{ventana}` en su propio árbol y espera `await confirmar({...})`.
  - `Button` gana `variant="peligro"` (rojo lleno, texto blanco).

> Decisión: no hay proveedor global en el layout. Así las pantallas se prueban solas (como hoy, sin envolverlas) y cada `useConfirmar()` es dueño de su ventana.

- [ ] **Step 1: Escribir la prueba que falla**

`apps/portal/src/components/ui/confirmar.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useConfirmar, type OpcionesConfirmar } from "./confirmar";

const ELIMINAR: OpcionesConfirmar = {
  titulo: "¿Eliminar la venta TJ261006AP05?",
  descripcion: "No se puede deshacer.",
  confirmar: "Eliminar venta",
};

function Prueba({ alResponder }: { alResponder: (si: boolean) => void }) {
  const { confirmar, ventana } = useConfirmar();
  return (
    <div>
      <button type="button" onClick={() => void confirmar(ELIMINAR).then(alResponder)}>
        Eliminar
      </button>
      <button
        type="button"
        onClick={() =>
          void confirmar({ titulo: "¿Marcar como cuenta perdida?", descripcion: "La venta dejará de cobrarse.", confirmar: "Marcar como perdida", tono: "normal" }).then(alResponder)
        }
      >
        Otra pregunta
      </button>
      {ventana}
    </div>
  );
}

describe("useConfirmar", () => {
  it("muestra título y qué pasa, y contesta sí con el botón del verbo exacto", async () => {
    const usuario = userEvent.setup();
    const alResponder = vi.fn();
    render(<Prueba alResponder={alResponder} />);
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    const ventana = screen.getByRole("alertdialog", { name: "¿Eliminar la venta TJ261006AP05?" });
    expect(ventana).toHaveAccessibleDescription("No se puede deshacer.");
    await usuario.click(screen.getByRole("button", { name: "Eliminar venta" }));
    await waitFor(() => expect(alResponder).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Cancelar contesta no", async () => {
    const usuario = userEvent.setup();
    const alResponder = vi.fn();
    render(<Prueba alResponder={alResponder} />);
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(alResponder).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Escape contesta no", async () => {
    const usuario = userEvent.setup();
    const alResponder = vi.fn();
    render(<Prueba alResponder={alResponder} />);
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(alResponder).toHaveBeenCalledWith(false));
  });

  it("Review Focus 4: doble clic en confirmar contesta una sola vez", async () => {
    const usuario = userEvent.setup();
    const alResponder = vi.fn();
    render(<Prueba alResponder={alResponder} />);
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    // Dos clics seguidos sobre el mismo botón: el primero cierra la ventana, el segundo no hace nada.
    const confirmarBoton = screen.getByRole("button", { name: "Eliminar venta" });
    fireEvent.click(confirmarBoton);
    fireEvent.click(confirmarBoton);
    await waitFor(() => expect(alResponder).toHaveBeenCalledTimes(1));
    expect(alResponder).toHaveBeenCalledWith(true);
  });

  it("Review Focus 4: una pregunta nueva contesta no a la que seguía abierta", async () => {
    const alResponder = vi.fn();
    function DosPreguntas() {
      const { confirmar, ventana } = useConfirmar();
      const [hecho, setHecho] = useState(false);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              void confirmar(ELIMINAR).then(alResponder);
              void confirmar({ ...ELIMINAR, titulo: "¿Otra?" }).then(alResponder);
              setHecho(true);
            }}
          >
            Dos
          </button>
          {hecho && <span>hecho</span>}
          {ventana}
        </div>
      );
    }
    const usuario = userEvent.setup();
    render(<DosPreguntas />);
    await usuario.click(screen.getByRole("button", { name: "Dos" }));
    await waitFor(() => expect(alResponder).toHaveBeenCalledWith(false));
    expect(screen.getByRole("alertdialog", { name: "¿Otra?" })).toBeInTheDocument();
  });

  it("tono normal no pinta el botón en rojo", async () => {
    const usuario = userEvent.setup();
    render(<Prueba alResponder={vi.fn()} />);
    await usuario.click(screen.getByRole("button", { name: "Otra pregunta" }));
    expect(screen.getByRole("button", { name: "Marcar como perdida" })).not.toHaveClass("bg-destructive");
  });
});
```

- [ ] **Step 2: Correr la prueba y ver que falla**

Run: `npx --workspace=apps/portal vitest run src/components/ui/confirmar.test.tsx`
Expected: FAIL — `Failed to resolve import "./confirmar"`.

- [ ] **Step 3: Agregar la variante `peligro` al botón**

En `apps/portal/src/components/ui/button.tsx`, reemplazar:

```ts
        link: "text-primary underline-offset-4 hover:underline",
```

por:

```ts
        link: "text-primary underline-offset-4 hover:underline",
        /** Rojo lleno: solo para el botón que confirma algo sin vuelta atrás (ventana de Confirmar). */
        peligro:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
```

- [ ] **Step 4: Escribir `confirmar.tsx`**

`apps/portal/src/components/ui/confirmar.tsx`:

```tsx
"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";

export interface OpcionesConfirmar {
  /** "¿Eliminar la venta TJ261006AP05?" */
  titulo: string;
  /** Una línea de qué pasa: "No se puede deshacer." */
  descripcion: string;
  /** El verbo exacto del botón: "Eliminar venta", "Marcar como perdida". */
  confirmar: string;
  /** `peligro` (rojo, el default) para lo que borra o no tiene vuelta; `normal` para lo demás. */
  tono?: "peligro" | "normal";
}

/**
 * La ventana de confirmar (UI Etapa 1, spec §4.4), base-ui AlertDialog: el foco entra a
 * la ventana, Escape cancela y el resto de la pantalla queda inerte mientras está abierta.
 */
export function Confirmar({
  abierta,
  opciones,
  onRespuesta,
}: {
  abierta: boolean;
  opciones: OpcionesConfirmar | null;
  onRespuesta: (si: boolean) => void;
}) {
  return (
    <AlertDialog.Root
      open={abierta}
      onOpenChange={(abrir) => {
        if (!abrir) onRespuesta(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-[rgb(15_20_18/0.45)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-2.5 rounded-xl bg-background p-[22px] shadow-[0_20px_50px_rgb(0_0_0/0.25)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          <AlertDialog.Title className="font-titulo text-[19px] leading-snug font-bold">{opciones?.titulo}</AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted-foreground">{opciones?.descripcion}</AlertDialog.Description>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onRespuesta(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={opciones?.tono === "normal" ? "default" : "peligro"}
              onClick={() => onRespuesta(true)}
            >
              {opciones?.confirmar}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * `const { confirmar, ventana } = useConfirmar();` — la pantalla pinta `{ventana}` y en
 * su acción hace `if (!(await confirmar({...}))) return;`. Reemplaza a `window.confirm`.
 * Cada pregunta se contesta una sola vez; una pregunta nueva contesta "no" a la que
 * siguiera abierta, y desmontar la pantalla contesta "no" a la pendiente.
 */
export function useConfirmar(): {
  confirmar: (opciones: OpcionesConfirmar) => Promise<boolean>;
  ventana: ReactNode;
} {
  const [estado, setEstado] = useState<{ abierta: boolean; opciones: OpcionesConfirmar | null }>({
    abierta: false,
    opciones: null,
  });
  const pendiente = useRef<((si: boolean) => void) | null>(null);

  const responder = useCallback((si: boolean) => {
    const resolver = pendiente.current;
    pendiente.current = null;
    // Se conservan las opciones al cerrar: el texto no desaparece durante la animación de salida.
    setEstado((actual) => ({ ...actual, abierta: false }));
    resolver?.(si);
  }, []);

  const confirmar = useCallback(
    (opciones: OpcionesConfirmar) =>
      new Promise<boolean>((resolver) => {
        pendiente.current?.(false);
        pendiente.current = resolver;
        setEstado({ abierta: true, opciones });
      }),
    [],
  );

  useEffect(
    () => () => {
      pendiente.current?.(false);
      pendiente.current = null;
    },
    [],
  );

  return {
    confirmar,
    ventana: <Confirmar abierta={estado.abierta} opciones={estado.opciones} onRespuesta={responder} />,
  };
}
```

- [ ] **Step 5: Correr la prueba y ver que pasa**

Run: `npx --workspace=apps/portal vitest run src/components/ui/confirmar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/components/ui/button.tsx apps/portal/src/components/ui/confirmar.tsx apps/portal/src/components/ui/confirmar.test.tsx
git commit -m "$(cat <<'EOF'
Portal UI: ventana de confirmar con useConfirmar (en lugar de window.confirm)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Encabezado y estados de pantalla, filtro de fechas y botón de Excel

**Files:**
- Create: `apps/portal/src/components/ui/encabezado-pantalla.tsx`, `encabezado-pantalla.test.tsx`
- Create: `apps/portal/src/components/ui/estado-pantalla.tsx`, `estado-pantalla.test.tsx`
- Create: `apps/portal/src/components/ui/filtro-fechas.tsx`, `filtro-fechas.test.tsx`
- Create: `apps/portal/src/components/ui/boton-excel.tsx`, `boton-excel.test.tsx`
- Modify: `apps/portal/src/components/perfiles/pantalla-perfiles.tsx:21-32,43-47,90-95` (sin `TarjetaMensaje`)
- Modify: `apps/portal/src/components/usuarios/pantalla-usuarios.tsx:21-32,44-49` (sin `TarjetaMensaje`)
- Modify: `apps/portal/src/components/precios/pantalla-precios.tsx:27-44,64-80` (sin `TarjetaMensaje`)
- Modify: `apps/portal/src/components/promociones/pantalla-promociones.tsx:4,12-29` y `pantalla-promociones.test.tsx:97-101` (el "elige sucursal" ya no está "arriba")

**Interfaces:**
- Consumes: `Button` (con `variant="peligro"` no se usa aquí), `Aviso` (Task 2), `Campo`, `Entrada` (Task 3), `diaAnterior`, `rangoMes`, `rangoSemana`, `type RangoFechas` (`@/lib/fechas`, Task 1), `hoyEnTijuana` (`@/lib/ventas`).
- Produces:
  - `Pantalla({ children }: { children: ReactNode })` (columna con separación de 20 px), `EncabezadoPantalla({ titulo, descripcion, acciones }: { titulo: string; descripcion?: string; acciones?: ReactNode })` → `<h1>` en `font-titulo` 28 px + una línea gris + acciones a la derecha.
  - `type TipoEstadoPantalla = "cargando" | "sin-permiso" | "elige-sucursal"`, `TEXTO_ESTADO_PANTALLA: Record<TipoEstadoPantalla, string>`, `EstadoPantalla({ tipo, titulo }: { tipo: TipoEstadoPantalla; titulo?: string })` (sin `titulo` pinta solo el texto, para usarlo dentro de un panel).
  - `MENSAJE_RANGO_INVERTIDO = "La fecha inicial no puede ser posterior a la final."`, `FiltroFechas({ id, desde, hasta, onCambio, onMostrar, deshabilitado = false, children, acciones }: { id: string; desde: string; hasta: string; onCambio: (rango: RangoFechas) => void; onMostrar: (rango: RangoFechas) => void; deshabilitado?: boolean; children?: ReactNode; acciones?: ReactNode })`. Inputs con ids `${id}-desde` / `${id}-hasta`, etiquetas "Desde" / "Hasta", atajos "Hoy · Ayer · Esta semana · Este mes", botón submit **"Mostrar"**. Si `desde > hasta` muestra `Aviso` de error con `MENSAJE_RANGO_INVERTIDO` y **no** llama `onMostrar`.
  - `BotonExcel({ exportando, disabled, onClick }: { exportando: boolean; disabled?: boolean; onClick: () => void })` → "Exportar a Excel" / "Exportando…".

- [ ] **Step 1: Escribir las pruebas que fallan**

`apps/portal/src/components/ui/encabezado-pantalla.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EncabezadoPantalla, Pantalla } from "./encabezado-pantalla";

describe("EncabezadoPantalla", () => {
  it("título como h1, la línea que explica y el botón principal", () => {
    render(
      <Pantalla>
        <EncabezadoPantalla
          titulo="Ventas"
          descripcion="Busca una venta por fecha, cliente o # de nota para verla, editarla o eliminarla."
          acciones={<button type="button">Registrar venta</button>}
        />
      </Pantalla>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Ventas" })).toHaveClass("font-titulo");
    expect(screen.getByText(/para verla, editarla o eliminarla/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar venta" })).toBeInTheDocument();
  });

  it("sin descripción ni acciones, solo el título", () => {
    render(<EncabezadoPantalla titulo="Facturas" />);
    expect(screen.getByRole("heading", { level: 1, name: "Facturas" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

`apps/portal/src/components/ui/estado-pantalla.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstadoPantalla, TEXTO_ESTADO_PANTALLA } from "./estado-pantalla";

describe("EstadoPantalla", () => {
  it("el mismo texto en todas las pantallas", () => {
    expect(TEXTO_ESTADO_PANTALLA).toEqual({
      cargando: "Cargando…",
      "sin-permiso": "No tienes permiso para ver esta sección.",
      "elige-sucursal": "Elige una sucursal en el menú lateral para ver esta sección.",
    });
  });

  it("con título: el encabezado de la pantalla y el texto debajo", () => {
    render(<EstadoPantalla titulo="Cobranza" tipo="sin-permiso" />);
    expect(screen.getByRole("heading", { level: 1, name: "Cobranza" })).toBeInTheDocument();
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
  });

  it("sin título: solo el texto (dentro de un panel)", () => {
    render(<EstadoPantalla tipo="cargando" />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
```

`apps/portal/src/components/ui/filtro-fechas.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { RangoFechas } from "@/lib/fechas";
import { FiltroFechas, MENSAJE_RANGO_INVERTIDO } from "./filtro-fechas";

// "Hoy" fijo en un domingo 1 de noviembre: "Esta semana" cruza de mes y "Ayer" también.
vi.mock("@/lib/ventas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ventas")>()),
  hoyEnTijuana: () => "2026-11-01",
}));

function Prueba({ onMostrar, deshabilitado = false }: { onMostrar: (r: RangoFechas) => void; deshabilitado?: boolean }) {
  const [rango, setRango] = useState<RangoFechas>({ desde: "2026-10-01", hasta: "2026-10-15" });
  return (
    <FiltroFechas
      id="prueba"
      desde={rango.desde}
      hasta={rango.hasta}
      onCambio={setRango}
      onMostrar={onMostrar}
      deshabilitado={deshabilitado}
      acciones={<button type="button">Exportar a Excel</button>}
    >
      <label>
        Vehículo
        <select defaultValue="">
          <option value="">Todos</option>
        </select>
      </label>
    </FiltroFechas>
  );
}

describe("FiltroFechas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Desde, Hasta, los filtros de la pantalla, Mostrar y Excel", () => {
    render(<Prueba onMostrar={vi.fn()} />);
    expect(screen.getByLabelText("Desde")).toHaveAttribute("id", "prueba-desde");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-10-15");
    expect(screen.getByLabelText("Vehículo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeInTheDocument();
  });

  it.each([
    ["Hoy", "2026-11-01", "2026-11-01"],
    ["Ayer", "2026-10-31", "2026-10-31"],
    ["Esta semana", "2026-10-26", "2026-11-01"],
    ["Este mes", "2026-11-01", "2026-11-30"],
  ])("el atajo %s pone %s a %s sin consultar", async (atajo, desde, hasta) => {
    const usuario = userEvent.setup();
    const onMostrar = vi.fn();
    render(<Prueba onMostrar={onMostrar} />);
    await usuario.click(screen.getByRole("button", { name: atajo }));
    expect(screen.getByLabelText("Desde")).toHaveValue(desde);
    expect(screen.getByLabelText("Hasta")).toHaveValue(hasta);
    expect(onMostrar).not.toHaveBeenCalled();
  });

  it("Mostrar entrega el rango", async () => {
    const usuario = userEvent.setup();
    const onMostrar = vi.fn();
    render(<Prueba onMostrar={onMostrar} />);
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(onMostrar).toHaveBeenCalledWith({ desde: "2026-10-01", hasta: "2026-10-15" });
  });

  it("con fechas invertidas avisa y no consulta; un atajo quita el aviso", async () => {
    const usuario = userEvent.setup();
    const onMostrar = vi.fn();
    render(<Prueba onMostrar={onMostrar} />);
    // Un <input type="date"> en jsdom se cambia con un evento, no tecleando.
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-12-31" } });
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent(MENSAJE_RANGO_INVERTIDO);
    expect(onMostrar).not.toHaveBeenCalled();
    await usuario.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("deshabilitado apaga Mostrar", () => {
    render(<Prueba onMostrar={vi.fn()} deshabilitado />);
    expect(screen.getByRole("button", { name: "Mostrar" })).toBeDisabled();
  });
});
```

`apps/portal/src/components/ui/boton-excel.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BotonExcel } from "./boton-excel";

describe("BotonExcel", () => {
  it("Exportar a Excel llama a onClick", async () => {
    const onClick = vi.fn();
    render(<BotonExcel exportando={false} onClick={onClick} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Exportar a Excel" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("mientras exporta dice Exportando… y no se deja picar", () => {
    render(<BotonExcel exportando onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Exportando…" })).toBeDisabled();
  });

  it("sin nada que exportar está apagado", () => {
    render(<BotonExcel exportando={false} disabled onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Correr las pruebas y ver que fallan**

Run: `npx --workspace=apps/portal vitest run src/components/ui/encabezado-pantalla.test.tsx src/components/ui/estado-pantalla.test.tsx src/components/ui/filtro-fechas.test.tsx src/components/ui/boton-excel.test.tsx`
Expected: FAIL — no se resuelven los imports.

- [ ] **Step 3: Escribir las cuatro piezas**

`apps/portal/src/components/ui/encabezado-pantalla.tsx`:

```tsx
import type { ReactNode } from "react";

/** La columna de una pantalla: lo de arriba a abajo, con 20 px entre cada cosa. */
export function Pantalla({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>;
}

/**
 * El encabezado de toda pantalla (UI Etapa 1, spec §4.1): título, UNA línea que dice
 * para qué sirve (la principal ayuda de "intuitivo") y el botón principal a la derecha.
 */
export function EncabezadoPantalla({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-titulo text-[28px] leading-tight font-bold">{titulo}</h1>
        {descripcion && <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}
```

`apps/portal/src/components/ui/estado-pantalla.tsx`:

```tsx
import { EncabezadoPantalla, Pantalla } from "./encabezado-pantalla";

export type TipoEstadoPantalla = "cargando" | "sin-permiso" | "elige-sucursal";

/** Mismo texto, tamaño y lugar en todas las pantallas (UI Etapa 1, spec §4.1). */
export const TEXTO_ESTADO_PANTALLA: Record<TipoEstadoPantalla, string> = {
  cargando: "Cargando…",
  "sin-permiso": "No tienes permiso para ver esta sección.",
  "elige-sucursal": "Elige una sucursal en el menú lateral para ver esta sección.",
};

/**
 * Lo que se ve en lugar de la pantalla mientras carga la sesión, sin permiso, o cuando
 * hace falta elegir una sucursal. Sin `titulo` pinta solo el texto (dentro de un panel).
 */
export function EstadoPantalla({ tipo, titulo }: { tipo: TipoEstadoPantalla; titulo?: string }) {
  const texto = <p className="text-sm text-muted-foreground">{TEXTO_ESTADO_PANTALLA[tipo]}</p>;
  if (!titulo) return texto;
  return (
    <Pantalla>
      <EncabezadoPantalla titulo={titulo} />
      {texto}
    </Pantalla>
  );
}
```

`apps/portal/src/components/ui/filtro-fechas.tsx`:

```tsx
"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { diaAnterior, rangoMes, rangoSemana, type RangoFechas } from "@/lib/fechas";
import { hoyEnTijuana } from "@/lib/ventas";
import { Aviso } from "./aviso";
import { Button } from "./button";
import { Campo, Entrada } from "./campo";

export const MENSAJE_RANGO_INVERTIDO = "La fecha inicial no puede ser posterior a la final.";

/**
 * El filtro de fechas de toda pantalla con rango (UI Etapa 1, spec §4.3): Desde, Hasta,
 * los atajos y el botón **Mostrar**. Los atajos solo cambian las fechas: consultar
 * sigue siendo Mostrar. `children` son los demás filtros de la pantalla (van antes de
 * Mostrar) y `acciones` lo que va después (el botón de Excel).
 */
export function FiltroFechas({
  id,
  desde,
  hasta,
  onCambio,
  onMostrar,
  deshabilitado = false,
  children,
  acciones,
}: {
  id: string;
  desde: string;
  hasta: string;
  onCambio: (rango: RangoFechas) => void;
  onMostrar: (rango: RangoFechas) => void;
  deshabilitado?: boolean;
  children?: ReactNode;
  acciones?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const hoy = hoyEnTijuana();
  const ayer = diaAnterior(hoy);
  const atajos: { texto: string; rango: RangoFechas }[] = [
    { texto: "Hoy", rango: { desde: hoy, hasta: hoy } },
    { texto: "Ayer", rango: { desde: ayer, hasta: ayer } },
    { texto: "Esta semana", rango: rangoSemana(hoy) },
    { texto: "Este mes", rango: rangoMes(hoy) },
  ];

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (desde > hasta) {
      setError(MENSAJE_RANGO_INVERTIDO);
      return;
    }
    setError(null);
    onMostrar({ desde, hasta });
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={alEnviar} className="flex flex-wrap items-end gap-3 rounded-[10px] border p-3.5">
        <Campo id={`${id}-desde`} etiqueta="Desde">
          <Entrada type="date" required value={desde} onChange={(e) => onCambio({ desde: e.target.value, hasta })} />
        </Campo>
        <Campo id={`${id}-hasta`} etiqueta="Hasta">
          <Entrada type="date" required value={hasta} onChange={(e) => onCambio({ desde, hasta: e.target.value })} />
        </Campo>
        <div role="group" aria-label="Atajos de fechas" className="flex items-center gap-0.5">
          {atajos.map((a) => (
            <Button
              key={a.texto}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                onCambio(a.rango);
              }}
            >
              {a.texto}
            </Button>
          ))}
        </div>
        {children}
        <Button type="submit" disabled={deshabilitado}>
          Mostrar
        </Button>
        {acciones}
      </form>
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}
```

`apps/portal/src/components/ui/boton-excel.tsx`:

```tsx
"use client";

import { FileSpreadsheet } from "lucide-react";
import { Button } from "./button";

/** El botón de Excel de todo reporte (UI Etapa 1, spec §4.3). La pantalla hace la exportación. */
export function BotonExcel({
  exportando,
  disabled = false,
  onClick,
}: {
  exportando: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="outline" disabled={disabled || exportando} onClick={onClick}>
      <FileSpreadsheet aria-hidden />
      {exportando ? "Exportando…" : "Exportar a Excel"}
    </Button>
  );
}
```

- [ ] **Step 4: Correr las pruebas nuevas y ver que pasan**

Run: `npx --workspace=apps/portal vitest run src/components/ui/encabezado-pantalla.test.tsx src/components/ui/estado-pantalla.test.tsx src/components/ui/filtro-fechas.test.tsx src/components/ui/boton-excel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Las 3 copias de `TarjetaMensaje` y el "elige sucursal" de Promociones pasan a `EstadoPantalla` (spec §4.1)**

`apps/portal/src/components/perfiles/pantalla-perfiles.tsx` — agregar debajo de la línea `import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";`:

```tsx
import { Aviso } from "@/components/ui/aviso";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
```

borrar el bloque:

```tsx
function TarjetaMensaje({ mensaje }: { mensaje: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfiles y Permisos</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{mensaje}</p>
      </CardContent>
    </Card>
  );
}

```

y reemplazar:

```tsx
    return <TarjetaMensaje mensaje="Cargando…" />;
  }
  if (!puede("perfil.gestionar")) {
    return <TarjetaMensaje mensaje="No tienes permiso para ver esta sección." />;
```

por:

```tsx
    return <EstadoPantalla titulo="Perfiles y Permisos" tipo="cargando" />;
  }
  if (!puede("perfil.gestionar")) {
    return <EstadoPantalla titulo="Perfiles y Permisos" tipo="sin-permiso" />;
```

y, más abajo (los estados de la matriz), reemplazar:

```tsx
  if (error) {
    return <TarjetaMensaje mensaje={error} />;
  }
  if (!datos) {
    return <TarjetaMensaje mensaje="Cargando…" />;
  }
```

por:

```tsx
  if (error) {
    return (
      <Pantalla>
        <EncabezadoPantalla titulo="Perfiles y Permisos" />
        <Aviso tono="error">{error}</Aviso>
      </Pantalla>
    );
  }
  if (!datos) {
    return <EstadoPantalla titulo="Perfiles y Permisos" tipo="cargando" />;
  }
```

`apps/portal/src/components/usuarios/pantalla-usuarios.tsx` — agregar debajo de la línea `import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";`:

```tsx
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
```

borrar el bloque:

```tsx
function TarjetaMensaje({ mensaje }: { mensaje: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usuarios</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{mensaje}</p>
      </CardContent>
    </Card>
  );
}

```

y reemplazar:

```tsx
    return <TarjetaMensaje mensaje="Cargando…" />;
  }
  if (!puede("usuario.gestionar")) {
    return <TarjetaMensaje mensaje="No tienes permiso para ver esta sección." />;
```

por:

```tsx
    return <EstadoPantalla titulo="Usuarios" tipo="cargando" />;
  }
  if (!puede("usuario.gestionar")) {
    return <EstadoPantalla titulo="Usuarios" tipo="sin-permiso" />;
```

`apps/portal/src/components/precios/pantalla-precios.tsx` — agregar debajo de la línea `import { useAuth } from "@/components/auth/auth-provider";`:

```tsx
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
```

borrar el bloque:

```tsx
/** El mismo Card/CardHeader/CardTitle que usa esta pantalla en sus tres
 * estados sin matriz (General sin filtro, cargando, codigo sin resolver):
 * evita repetir el marcado tres veces. */
function TarjetaMensaje({ mensaje }: { mensaje: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Listas de Precios</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{mensaje}</p>
      </CardContent>
    </Card>
  );
}

const MENSAJE_ELIGE_SUCURSAL =
  "Elige una sucursal en el filtro para ver y editar sus precios.";

```

reemplazar **las dos** apariciones (Edit con `replace_all: true`) de:

```tsx
    return <TarjetaMensaje mensaje={MENSAJE_ELIGE_SUCURSAL} />;
```

por:

```tsx
    return <EstadoPantalla titulo="Listas de Precios" tipo="elige-sucursal" />;
```

y reemplazar:

```tsx
      return <TarjetaMensaje mensaje="Cargando…" />;
```

por:

```tsx
      return <EstadoPantalla titulo="Listas de Precios" tipo="cargando" />;
```

`apps/portal/src/components/promociones/pantalla-promociones.tsx` — reemplazar:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
```

por:

```tsx
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
```

y reemplazar:

```tsx
    return (
      <Card>
        <CardHeader>
          <CardTitle>Promociones</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            {cargando || usuario === null
              ? "Cargando…"
              : "Elige una sucursal en el selector de arriba para ver sus promociones."}
          </p>
        </CardContent>
      </Card>
    );
```

por:

```tsx
    // El selector de sucursal ya no está arriba: vive en el menú lateral (UI Etapa 1).
    return <EstadoPantalla titulo="Promociones" tipo={cargando || usuario === null ? "cargando" : "elige-sucursal"} />;
```

`apps/portal/src/components/promociones/pantalla-promociones.test.tsx` — reemplazar:

```tsx
    expect(screen.getByText(/Elige una sucursal en el selector de arriba/)).toBeInTheDocument();
```

por:

```tsx
    expect(screen.getByText("Elige una sucursal en el menú lateral para ver esta sección.")).toBeInTheDocument();
```

- [ ] **Step 6: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde (incluidas `pantalla-usuarios.test.tsx` y `pantalla-promociones.test.tsx`).

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/components/ui/encabezado-pantalla.tsx apps/portal/src/components/ui/encabezado-pantalla.test.tsx \
  apps/portal/src/components/ui/estado-pantalla.tsx apps/portal/src/components/ui/estado-pantalla.test.tsx \
  apps/portal/src/components/ui/filtro-fechas.tsx apps/portal/src/components/ui/filtro-fechas.test.tsx \
  apps/portal/src/components/ui/boton-excel.tsx apps/portal/src/components/ui/boton-excel.test.tsx \
  apps/portal/src/components/perfiles/pantalla-perfiles.tsx apps/portal/src/components/usuarios/pantalla-usuarios.tsx \
  apps/portal/src/components/precios/pantalla-precios.tsx \
  apps/portal/src/components/promociones/pantalla-promociones.tsx apps/portal/src/components/promociones/pantalla-promociones.test.tsx
git commit -m "$(cat <<'EOF'
Portal UI: encabezado y estados de pantalla, filtro de fechas y botón de Excel

EstadoPantalla reemplaza las tres copias de TarjetaMensaje y el aviso de
"elige sucursal" de Promociones (el selector ya no está arriba).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Secciones del menú que se abren y cierran

**Files:**
- Modify: `apps/portal/src/components/layout/nav-config.ts` (archivo completo)
- Create: `apps/portal/src/components/layout/nav-config.test.ts`
- Create: `apps/portal/src/lib/almacen-local.ts`, `apps/portal/src/lib/almacen-local.test.ts`
- Create: `apps/portal/src/components/layout/secciones-menu.tsx`, `secciones-menu.test.tsx`
- Modify: `apps/portal/vitest.setup.ts` (un `localStorage` que funcione en las pruebas con Node 25+)

**Interfaces:**
- Consumes: `@base-ui/react/collapsible`, `next/link`, `cn`.
- Produces:
  - `nav-config.ts`: `type NavItem = { label: string; href: string; pronto?: true }`, `type NavSection = { label: string; items: NavItem[] }`, `navSections: NavSection[]` (orden del spec: Operación, Finanzas, Producción, Información, Catálogo), `interface ItemActual { seccion: string; item: NavItem }`, `buscarItemActual(pathname: string): ItemActual | null`, `tituloDePestana(pathname: string, sucursal: string | null): string`.
  - `lib/almacen-local.ts`: `leerLocal(clave: string): string | null`, `guardarLocal(clave: string, valor: string): void`.
  - `secciones-menu.tsx`: `CLAVE_SECCIONES = "jawa.menu.secciones"`, `SeccionesMenu({ pathname, sucursal }: { pathname: string; sucursal: string | null })` → `<nav aria-label="Menú principal">`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`apps/portal/src/lib/almacen-local.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardarLocal, leerLocal } from "./almacen-local";

describe("almacen-local", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("guarda y lee", () => {
    guardarLocal("jawa.prueba", "1");
    expect(leerLocal("jawa.prueba")).toBe("1");
    expect(leerLocal("jawa.otra")).toBeNull();
  });

  it("Review Focus 2: sin localStorage (ventana privada, datos bloqueados) no truena", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(leerLocal("jawa.prueba")).toBeNull();
    expect(() => guardarLocal("jawa.prueba", "1")).not.toThrow();
  });
});
```

`apps/portal/src/components/layout/nav-config.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buscarItemActual, navSections, tituloDePestana } from "./nav-config";

// Sin `new URL(relativa, import.meta.url)`: en el entorno jsdom, `URL` es la de jsdom y
// resuelve contra http://localhost.
const PAGINAS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "(portal)");

describe("navSections", () => {
  it("en el orden del spec", () => {
    expect(navSections.map((s) => s.label)).toEqual(["Operación", "Finanzas", "Producción", "Información", "Catálogo"]);
  });

  it("toda pantalla que todavía es Placeholder lleva pronto, y ninguna otra", () => {
    for (const seccion of navSections) {
      for (const item of seccion.items) {
        const pagina = readFileSync(join(PAGINAS, ...item.href.split("/").filter(Boolean), "page.tsx"), "utf8");
        expect({ href: item.href, pronto: item.pronto === true }).toEqual({
          href: item.href,
          pronto: pagina.includes("Placeholder"),
        });
      }
    }
  });
});

describe("buscarItemActual", () => {
  it("la opción exacta", () => {
    expect(buscarItemActual("/operacion/ventas")).toEqual({
      seccion: "Operación",
      item: { label: "Ventas", href: "/operacion/ventas" },
    });
  });

  it("una pantalla dentro de otra es la de href más largo, por segmentos completos", () => {
    expect(buscarItemActual("/informacion/reportes/kilometraje")?.item.label).toBe("Reportes");
    expect(buscarItemActual("/operacion")?.item.label).toBe("Dashboard");
    expect(buscarItemActual("/operacion/ventas/algo")?.item.label).toBe("Ventas");
    expect(buscarItemActual("/operacionx")).toBeNull();
    expect(buscarItemActual("/login")).toBeNull();
  });
});

describe("tituloDePestana", () => {
  it("pantalla | JAWA y la sucursal; con todas, sin sucursal", () => {
    expect(tituloDePestana("/operacion/ventas", "Tijuana")).toBe("Ventas | JAWA Tijuana");
    expect(tituloDePestana("/operacion/ventas", null)).toBe("Ventas | JAWA");
    expect(tituloDePestana("/informacion/reportes/kilometraje", "Mexicali")).toBe("Reportes | JAWA Mexicali");
  });

  it("una dirección fuera del menú dice solo JAWA", () => {
    expect(tituloDePestana("/desconocida", "Tijuana")).toBe("JAWA Tijuana");
    expect(tituloDePestana("/desconocida", null)).toBe("JAWA");
  });
});
```

`apps/portal/src/components/layout/secciones-menu.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CLAVE_SECCIONES, SeccionesMenu } from "./secciones-menu";

describe("SeccionesMenu", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("abre sola la sección de la pantalla actual y marca su opción", () => {
    render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    expect(screen.getByRole("navigation", { name: "Menú principal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Operación" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Finanzas" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Ventas" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Facturas" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: "Tesorería" })).not.toBeInTheDocument();
  });

  it("una pantalla dentro de Reportes abre Información y marca Reportes", () => {
    render(<SeccionesMenu pathname="/informacion/reportes/kilometraje" sucursal={null} />);
    expect(screen.getByRole("button", { name: "Información" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Reportes" })).toHaveAttribute("aria-current", "page");
  });

  it("los enlaces conservan la sucursal elegida", () => {
    render(<SeccionesMenu pathname="/operacion/ventas" sucursal="TJ" />);
    expect(screen.getByRole("link", { name: "Cobranza" })).toHaveAttribute("href", "/operacion/cobranza?sucursal=TJ");
  });

  it("lo que todavía no existe dice Pronto; lo que existe no", () => {
    render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    const rutaSemanal = screen.getByRole("link", { name: "Ruta Semanal Pronto" });
    expect(within(rutaSemanal).getByText("Pronto")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: "Ventas" })).queryByText("Pronto")).not.toBeInTheDocument();
  });

  it("recuerda lo que el usuario abre y cierra", async () => {
    const usuario = userEvent.setup();
    const { unmount } = render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    await usuario.click(screen.getByRole("button", { name: "Finanzas" }));
    expect(screen.getByRole("button", { name: "Finanzas" })).toHaveAttribute("aria-expanded", "true");
    expect(JSON.parse(localStorage.getItem(CLAVE_SECCIONES) ?? "{}")).toMatchObject({ Finanzas: true });
    unmount();

    render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Finanzas" })).toHaveAttribute("aria-expanded", "true"));
  });

  it("la sección actual se abre aunque se haya guardado cerrada", async () => {
    localStorage.setItem(CLAVE_SECCIONES, JSON.stringify({ "Operación": false, "Catálogo": true }));
    render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Catálogo" })).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByRole("button", { name: "Operación" })).toHaveAttribute("aria-expanded", "true");
  });

  it("Review Focus 2: con basura guardada arranca solo con la sección actual", async () => {
    localStorage.setItem(CLAVE_SECCIONES, "{no es json");
    render(<SeccionesMenu pathname="/finanzas/tesoreria" sucursal={null} />);
    expect(screen.getByRole("button", { name: "Finanzas" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Operación" })).toHaveAttribute("aria-expanded", "false");
  });

  it("Review Focus 2: sin localStorage se puede abrir y cerrar igual", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const usuario = userEvent.setup();
    render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    expect(screen.getByRole("button", { name: "Operación" })).toHaveAttribute("aria-expanded", "true");
    await usuario.click(screen.getByRole("button", { name: "Catálogo" }));
    expect(screen.getByRole("button", { name: "Catálogo" })).toHaveAttribute("aria-expanded", "true");
    await usuario.click(screen.getByRole("button", { name: "Operación" }));
    expect(screen.getByRole("button", { name: "Operación" })).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Un `localStorage` de verdad en las pruebas**

Con Node 25 o más nuevo (la Mac de Roberto tiene Node 26), Node trae su propio `localStorage` global: sin
`--localstorage-file` vale `undefined` y tapa al de jsdom, así que en las pruebas `localStorage` no existe. En
`apps/portal/vitest.setup.ts`, reemplazar:

```ts
afterEach(() => {
  cleanup();
});
```

por:

```ts
afterEach(() => {
  cleanup();
});

// Node 25+ trae su propio `localStorage` global; sin `--localstorage-file` vale undefined y
// tapa al de jsdom. Las pruebas usan el de jsdom (el mismo que tendría el navegador). Con un
// Node más viejo, o en las pruebas con `@vitest-environment node` (sin jsdom), no se toca nada.
const entorno = globalThis as unknown as { jsdom?: { window: Window } };
if (typeof globalThis.localStorage === "undefined" && entorno.jsdom) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: entorno.jsdom.window.localStorage });
}
```

- [ ] **Step 3: Correr las pruebas y ver que fallan**

Run: `npx --workspace=apps/portal vitest run src/lib/almacen-local.test.ts src/components/layout`
Expected: FAIL — no existen `almacen-local`, `secciones-menu`, ni `buscarItemActual` / `tituloDePestana`; la prueba de `pronto` falla porque ningún item lo lleva.

- [ ] **Step 4: Escribir `almacen-local.ts`, `nav-config.ts` y `secciones-menu.tsx`**

`apps/portal/src/lib/almacen-local.ts`:

```ts
/**
 * localStorage que nunca truena (UI Etapa 1, spec §3.3 y §3.5): en ventana privada,
 * con los datos del sitio bloqueados o en el render del servidor (sin `window`)
 * simplemente no se recuerda nada. Solo para comodidades de esta computadora
 * (qué secciones del menú están abiertas, si el menú está escondido).
 */
export function leerLocal(clave: string): string | null {
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

export function guardarLocal(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento: no se recuerda, y ya.
  }
}
```

Reemplazar **todo** `apps/portal/src/components/layout/nav-config.ts` por:

```ts
export type NavItem = {
  label: string;
  href: string;
  /** La pantalla todavía es un "Próximamente" (`Placeholder`): el menú la marca "Pronto". */
  pronto?: true;
};
export type NavSection = { label: string; items: NavItem[] };

// Orden del spec (UI Etapa 1, §3.3). Una pantalla nueva se agrega aquí; mientras su
// page.tsx sea un Placeholder lleva `pronto: true` (nav-config.test.ts lo exige).
export const navSections: NavSection[] = [
  {
    label: "Operación",
    items: [
      { label: "Dashboard", href: "/operacion", pronto: true },
      { label: "Registrar venta", href: "/operacion/registrar-venta" },
      { label: "Ventas", href: "/operacion/ventas" },
      { label: "Facturas", href: "/operacion/facturas" },
      { label: "Cobranza", href: "/operacion/cobranza" },
      { label: "Cuentas por Cobrar", href: "/operacion/cuentas-por-cobrar" },
      { label: "Reporte de Ventas", href: "/operacion/reporte-de-ventas" },
      { label: "Promociones", href: "/operacion/promociones" },
      { label: "Procesos", href: "/operacion/procesos", pronto: true },
      { label: "Peticiones", href: "/operacion/peticiones" },
      { label: "Notificaciones", href: "/operacion/notificaciones", pronto: true },
      { label: "Ruta Diaria", href: "/operacion/ruta-diaria" },
      { label: "Ruta Semanal", href: "/operacion/ruta-semanal", pronto: true },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { label: "Tesorería", href: "/finanzas/tesoreria" },
      { label: "Gastos", href: "/finanzas/gastos" },
      { label: "Flujo de Efectivo", href: "/finanzas/flujo-efectivo" },
    ],
  },
  {
    label: "Producción",
    items: [
      { label: "Peticiones", href: "/produccion/peticiones", pronto: true },
      { label: "Recarga", href: "/produccion/recarga" },
      { label: "Corte", href: "/produccion/corte", pronto: true },
      { label: "Almacenes", href: "/produccion/almacenes", pronto: true },
    ],
  },
  {
    label: "Información",
    items: [
      { label: "Reportes", href: "/informacion/reportes" },
      { label: "Análisis Cliente", href: "/informacion/analisis-cliente", pronto: true },
      { label: "Nómina", href: "/informacion/nomina", pronto: true },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { label: "Sucursales", href: "/catalogo/sucursales" },
      { label: "Clientes", href: "/catalogo/clientes" },
      { label: "Vendedores", href: "/catalogo/vendedores" },
      { label: "Vehículos", href: "/catalogo/vehiculos" },
      { label: "Motivos de visita", href: "/catalogo/motivos-de-visita" },
      { label: "Campos de egreso", href: "/catalogo/campos-de-egreso" },
      { label: "Productos", href: "/catalogo/productos" },
      { label: "Listas de Precios", href: "/catalogo/precios" },
      { label: "Usuarios", href: "/catalogo/usuarios" },
      { label: "Perfiles y Permisos", href: "/catalogo/perfiles-y-permisos" },
    ],
  },
];

export interface ItemActual {
  seccion: string;
  item: NavItem;
}

/**
 * La opción del menú de esta dirección: la de `href` más largo que la contenga por
 * segmentos completos. `/informacion/reportes/kilometraje` es "Reportes";
 * `/operacion/ventas` no es "Dashboard" (`/operacion`).
 */
export function buscarItemActual(pathname: string): ItemActual | null {
  let mejor: ItemActual | null = null;
  for (const seccion of navSections) {
    for (const item of seccion.items) {
      const coincide = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (coincide && (mejor === null || item.href.length > mejor.item.href.length)) {
        mejor = { seccion: seccion.label, item };
      }
    }
  }
  return mejor;
}

/** "Ventas | JAWA Tijuana"; con todas las sucursales, "Ventas | JAWA" (spec §3.2). */
export function tituloDePestana(pathname: string, sucursal: string | null): string {
  const marca = sucursal ? `JAWA ${sucursal}` : "JAWA";
  const actual = buscarItemActual(pathname);
  return actual ? `${actual.item.label} | ${marca}` : marca;
}
```

`apps/portal/src/components/layout/secciones-menu.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { guardarLocal, leerLocal } from "@/lib/almacen-local";
import { cn } from "@/lib/utils";
import { buscarItemActual, navSections } from "./nav-config";

export const CLAVE_SECCIONES = "jawa.menu.secciones";

type Abiertas = Record<string, boolean>;

/** Lo guardado, o nada si no hay, no se puede leer o es basura. */
function leerGuardadas(): Abiertas {
  const texto = leerLocal(CLAVE_SECCIONES);
  if (!texto) return {};
  try {
    const valor: unknown = JSON.parse(texto);
    if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return {};
    return Object.fromEntries(Object.entries(valor).filter(([, v]) => typeof v === "boolean")) as Abiertas;
  } catch {
    return {};
  }
}

/**
 * Las secciones del menú (UI Etapa 1, spec §3.3): cada una se abre y se cierra; la de
 * la pantalla actual se abre sola al entrar; lo demás se recuerda en esta computadora.
 */
export function SeccionesMenu({ pathname, sucursal }: { pathname: string; sucursal: string | null }) {
  const actual = buscarItemActual(pathname);
  const seccionActual = actual?.seccion ?? null;
  // En el servidor no hay localStorage: se arranca solo con la sección actual.
  const [abiertas, setAbiertas] = useState<Abiertas>(() => (seccionActual ? { [seccionActual]: true } : {}));

  useEffect(() => {
    const guardadas = leerGuardadas();
    // Lo que ya está en pantalla (la sección actual abierta) gana sobre lo guardado.
    setAbiertas((enPantalla) => ({ ...guardadas, ...enPantalla }));
  }, []);

  useEffect(() => {
    if (seccionActual) {
      setAbiertas((enPantalla) => (enPantalla[seccionActual] ? enPantalla : { ...enPantalla, [seccionActual]: true }));
    }
  }, [seccionActual]);

  function alternar(seccion: string, abrir: boolean) {
    const nuevas = { ...abiertas, [seccion]: abrir };
    setAbiertas(nuevas);
    guardarLocal(CLAVE_SECCIONES, JSON.stringify(nuevas));
  }

  const sufijo = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";

  return (
    <nav aria-label="Menú principal" className="flex flex-col gap-0.5">
      {navSections.map((seccion) => {
        const abierta = abiertas[seccion.label] ?? false;
        return (
          <Collapsible.Root
            key={seccion.label}
            open={abierta}
            onOpenChange={(abrir) => alternar(seccion.label, abrir)}
          >
            <Collapsible.Trigger className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-sucursal/40">
              {seccion.label}
              <ChevronDown
                aria-hidden
                className={cn(
                  "size-4 text-muted-foreground transition-transform duration-150",
                  !abierta && "-rotate-90",
                )}
              />
            </Collapsible.Trigger>
            <Collapsible.Panel className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-150 data-[ending-style]:h-0 data-[starting-style]:h-0">
              <ul className="mb-1.5 flex flex-col gap-px">
                {seccion.items.map((item) => {
                  const activo = actual?.item.href === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={`${item.href}${sufijo}`}
                        aria-current={activo ? "page" : undefined}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md py-1.5 pr-2 pl-5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-sucursal/40",
                          activo && "bg-background font-semibold shadow-[inset_3px_0_0_var(--suc)]",
                        )}
                      >
                        <span>{item.label}</span>{" "}
                        {item.pronto && (
                          <span className="rounded-full border px-1.5 text-[11px] font-normal text-muted-foreground">
                            Pronto
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Collapsible.Panel>
          </Collapsible.Root>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Correr las pruebas y ver que pasan**

Run: `npx --workspace=apps/portal vitest run src/lib/almacen-local.test.ts src/components/layout`
Expected: PASS. (El menú viejo, `sidebar-nav.tsx`, sigue montado en el layout y sigue funcionando: solo usa `navSections`, `label` y `href`.)

- [ ] **Step 6: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/vitest.setup.ts apps/portal/src/lib/almacen-local.ts apps/portal/src/lib/almacen-local.test.ts \
  apps/portal/src/components/layout/nav-config.ts apps/portal/src/components/layout/nav-config.test.ts \
  apps/portal/src/components/layout/secciones-menu.tsx apps/portal/src/components/layout/secciones-menu.test.tsx
git commit -m "$(cat <<'EOF'
Portal UI: secciones del menú que se abren y cierran, con "Pronto"

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: La sucursal y el usuario en el menú

**Files:**
- Create: `apps/portal/src/components/layout/use-sucursal-actual.ts`, `use-sucursal-actual.test.tsx`
- Create: `apps/portal/src/components/layout/bloque-sucursal.tsx`, `bloque-sucursal.test.tsx`
- Create: `apps/portal/src/components/layout/bloque-usuario.tsx`, `bloque-usuario.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (`@/components/auth/auth-provider`), `listarSucursales`, `type Sucursal` (`@/lib/sucursales`), `colorDeSucursal`, `siglasDeSucursal` (Task 1), `iniciales` (Task 1), `type UsuarioSesion` (`@/lib/api`), `@base-ui/react/menu`, `next/navigation`.
- Produces:
  - `NOMBRE_TODAS = "Todas las sucursales"`.
  - `interface SucursalActual { codigo: string | null; nombre: string; siglas: string; color: string; puedeElegir: boolean; opciones: Sucursal[]; elegir: (codigo: string | null) => void }`.
  - `useSucursalActual(): SucursalActual` — atado: la suya (ignora `?sucursal=`); General: la de `?sucursal=` (sin distinguir mayúsculas; `todas` = todas) o todas. `puedeElegir` = no atado y más de una sucursal activa. `elegir(null)` quita `?sucursal=` y conserva lo demás de la dirección.
  - `BloqueSucursal({ sucursal }: { sucursal: SucursalActual })`.
  - `BloqueUsuario({ usuario, onCerrarSesion }: { usuario: UsuarioSesion | null; onCerrarSesion: () => void })`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`apps/portal/src/components/layout/use-sucursal-actual.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import type { UsuarioSesion } from "@/lib/api";
import * as sucursalesLib from "@/lib/sucursales";
import type { Sucursal } from "@/lib/sucursales";
import { NOMBRE_TODAS, useSucursalActual } from "./use-sucursal-actual";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(), useRouter: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/sucursales", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales")>()),
  listarSucursales: vi.fn(),
}));

const SUCURSALES: Sucursal[] = [
  { id: "s1", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false },
  { id: "s2", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
  { id: "s3", codigo: "EN", nombre: "Ensenada", activa: true, controlInventario: false },
  { id: "s4", codigo: "BC", nombre: "Baja", activa: false, controlInventario: false },
];
const GENERAL: UsuarioSesion = { id: "u1", login: "admin", nombre: "Admin Local", perfil: "Administrador General", sucursal: null, permisos: [] };
const ATADO: UsuarioSesion = { ...GENERAL, id: "u2", sucursal: { id: "s1", codigo: "TJ", nombre: "Tijuana" } };

const push = vi.fn();

function preparar(query: string, usuario: UsuarioSesion | null = GENERAL, ruta = "/operacion/ventas") {
  vi.mocked(usePathname).mockReturnValue(ruta);
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>);
  vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(useAuth).mockReturnValue({ usuario, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
}

describe("useSucursalActual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue(SUCURSALES);
  });

  it("General con ?sucursal=TJ: Tijuana en su color, y puede elegir entre las activas", async () => {
    preparar("sucursal=TJ");
    const { result } = renderHook(() => useSucursalActual());
    expect(result.current.codigo).toBe("TJ");
    await waitFor(() => expect(result.current.nombre).toBe("Tijuana"));
    expect(result.current.color).toBe("var(--suc-tj)");
    expect(result.current.siglas).toBe("TJ");
    expect(result.current.puedeElegir).toBe(true);
    expect(result.current.opciones.map((s) => s.codigo)).toEqual(["TJ", "MX", "EN"]);
    // Sin filtro a propósito: se pide todo lo que el usuario puede elegir.
    expect(sucursalesLib.listarSucursales).toHaveBeenCalledWith();
  });

  it("sin parámetro, o con ?sucursal=TODAS, son todas las sucursales en tinta", async () => {
    preparar("");
    const sin = renderHook(() => useSucursalActual());
    expect(sin.result.current).toMatchObject({ codigo: null, nombre: NOMBRE_TODAS, siglas: "Todas", color: "var(--suc-todas)" });
    sin.unmount();
    preparar("sucursal=TODAS");
    const todas = renderHook(() => useSucursalActual());
    expect(todas.result.current.codigo).toBeNull();
    await waitFor(() => expect(todas.result.current.puedeElegir).toBe(true));
  });

  it("Review Focus 3: ?sucursal=en (minúsculas, sin color asignado) es Ensenada en tinta", async () => {
    preparar("sucursal=en");
    const { result } = renderHook(() => useSucursalActual());
    await waitFor(() => expect(result.current.nombre).toBe("Ensenada"));
    expect(result.current.codigo).toBe("EN");
    expect(result.current.color).toBe("var(--suc-todas)");
  });

  it("un usuario atado ve la suya aunque la dirección diga otra, y no elige", async () => {
    preparar("sucursal=MX", ATADO);
    const { result } = renderHook(() => useSucursalActual());
    expect(result.current).toMatchObject({ codigo: "TJ", nombre: "Tijuana", color: "var(--suc-tj)" });
    await waitFor(() => expect(sucursalesLib.listarSucursales).toHaveBeenCalled());
    expect(result.current.puedeElegir).toBe(false);
  });

  it("elegir cambia ?sucursal= y conserva lo demás; todas lo quita", () => {
    preparar("sucursal=TJ&vista=movimientos", GENERAL, "/finanzas/tesoreria");
    const { result } = renderHook(() => useSucursalActual());
    act(() => result.current.elegir("MX"));
    expect(push).toHaveBeenLastCalledWith("/finanzas/tesoreria?sucursal=MX&vista=movimientos");
    act(() => result.current.elegir(null));
    expect(push).toHaveBeenLastCalledWith("/finanzas/tesoreria?vista=movimientos");
  });

  it("si la lista no carga se queda con el código y no ofrece elegir", async () => {
    vi.mocked(sucursalesLib.listarSucursales).mockRejectedValue(new Error("red"));
    preparar("sucursal=TJ");
    const { result } = renderHook(() => useSucursalActual());
    await waitFor(() => expect(sucursalesLib.listarSucursales).toHaveBeenCalled());
    expect(result.current.nombre).toBe("TJ");
    expect(result.current.puedeElegir).toBe(false);
  });

  it("sin sesión todavía no pide la lista", () => {
    preparar("", null);
    renderHook(() => useSucursalActual());
    expect(sucursalesLib.listarSucursales).not.toHaveBeenCalled();
  });
});
```

`apps/portal/src/components/layout/bloque-sucursal.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Sucursal } from "@/lib/sucursales";
import { BloqueSucursal } from "./bloque-sucursal";
import type { SucursalActual } from "./use-sucursal-actual";

const OPCIONES: Sucursal[] = [
  { id: "s1", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false },
  { id: "s2", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
];

function sucursal(cambios: Partial<SucursalActual> = {}): SucursalActual {
  return {
    codigo: "TJ",
    nombre: "Tijuana",
    siglas: "TJ",
    color: "var(--suc-tj)",
    puedeElegir: true,
    opciones: OPCIONES,
    elegir: vi.fn(),
    ...cambios,
  };
}

describe("BloqueSucursal", () => {
  it("quien puede elegir abre la lista: todas y cada sucursal, con palomita en la actual", async () => {
    const usuario = userEvent.setup();
    const actual = sucursal();
    render(<BloqueSucursal sucursal={actual} />);
    const boton = screen.getByRole("button", { name: "Sucursal: Tijuana. Cambiar de sucursal" });
    expect(boton).toHaveTextContent("Tijuana");
    await usuario.click(boton);
    expect(await screen.findByRole("menuitemradio", { name: "Tijuana" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Todas las sucursales" })).toHaveAttribute("aria-checked", "false");
    await usuario.click(screen.getByRole("menuitemradio", { name: "Mexicali" }));
    expect(actual.elegir).toHaveBeenCalledWith("MX");
  });

  it("elegir Todas las sucursales manda null", async () => {
    const usuario = userEvent.setup();
    const actual = sucursal();
    render(<BloqueSucursal sucursal={actual} />);
    await usuario.click(screen.getByRole("button", { name: /Cambiar de sucursal/ }));
    await usuario.click(await screen.findByRole("menuitemradio", { name: "Todas las sucursales" }));
    expect(actual.elegir).toHaveBeenCalledWith(null);
  });

  it("un usuario atado ve su sucursal sin flecha ni lista", () => {
    render(<BloqueSucursal sucursal={sucursal({ puedeElegir: false })} />);
    expect(screen.getByText("Tijuana")).toBeInTheDocument();
    expect(screen.getByText("Sucursal")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

`apps/portal/src/components/layout/bloque-usuario.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UsuarioSesion } from "@/lib/api";
import { BloqueUsuario } from "./bloque-usuario";

const ATADO: UsuarioSesion = {
  id: "u2",
  login: "ana",
  nombre: "Admin Local",
  perfil: "Administrador General",
  sucursal: { id: "s1", codigo: "TJ", nombre: "Tijuana" },
  permisos: [],
};

describe("BloqueUsuario", () => {
  it("iniciales, nombre y perfil; sin el código General ni el de sucursal", () => {
    render(<BloqueUsuario usuario={ATADO} onCerrarSesion={vi.fn()} />);
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("Admin Local")).toBeInTheDocument();
    expect(screen.getByText("Administrador General")).toBeInTheDocument();
    expect(screen.queryByText("General")).not.toBeInTheDocument();
    expect(screen.queryByText("TJ")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Cerrar sesión" })).not.toBeInTheDocument();
  });

  it("Cerrar sesión vive en su menú", async () => {
    const usuario = userEvent.setup();
    const onCerrarSesion = vi.fn();
    render(<BloqueUsuario usuario={ATADO} onCerrarSesion={onCerrarSesion} />);
    await usuario.click(screen.getByRole("button", { name: /Admin Local/ }));
    await usuario.click(await screen.findByRole("menuitem", { name: "Cerrar sesión" }));
    expect(onCerrarSesion).toHaveBeenCalledTimes(1);
  });

  it("mientras carga la sesión deja el lugar sin botón", () => {
    render(<BloqueUsuario usuario={null} onCerrarSesion={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr las pruebas y ver que fallan**

Run: `npx --workspace=apps/portal vitest run src/components/layout/use-sucursal-actual.test.tsx src/components/layout/bloque-sucursal.test.tsx src/components/layout/bloque-usuario.test.tsx`
Expected: FAIL — no se resuelven los imports.

- [ ] **Step 3: Escribir el hook y los dos bloques**

`apps/portal/src/components/layout/use-sucursal-actual.ts`:

```ts
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { colorDeSucursal, siglasDeSucursal } from "@/lib/sucursal-color";

/** Mismo valor reservado que usa el backend en alcance-sucursal.ts. */
const TODAS = "todas";

export const NOMBRE_TODAS = "Todas las sucursales";

export interface SucursalActual {
  /** `null` = todas las sucursales. */
  codigo: string | null;
  nombre: string;
  siglas: string;
  color: string;
  /** Un General con más de una sucursal activa. */
  puedeElegir: boolean;
  /** Las sucursales activas que puede elegir. */
  opciones: Sucursal[];
  /** `null` = todas: quita `?sucursal=` de la dirección. */
  elegir: (codigo: string | null) => void;
}

/**
 * Qué sucursal se está viendo (UI Etapa 1, spec §3.2). Por dentro funciona igual que el
 * selector de antes: `?sucursal=` en la dirección, sin parámetro = todas. Un usuario
 * atado ve siempre la suya (el backend ignora el parámetro para él).
 */
export function useSucursalActual(): SucursalActual {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { usuario } = useAuth();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const hayUsuario = usuario !== null;

  useEffect(() => {
    if (!hayUsuario) return;
    let vigente = true;
    // Sin filtro a propósito: hace falta todo lo que el usuario puede elegir, no lo que
    // está viendo ahora mismo. El backend ya lo acota a lo que le toca.
    listarSucursales()
      .then((lista) => {
        if (vigente) setSucursales(lista);
      })
      .catch(() => {
        if (vigente) setSucursales([]);
      });
    return () => {
      vigente = false;
    };
  }, [hayUsuario]);

  const elegir = useCallback(
    (codigo: string | null) => {
      const nuevos = new URLSearchParams(params.toString());
      // "todas" es el default: se quita el parámetro en vez de escribirlo (la URL queda
      // limpia y ?sucursal= nunca aparece vacío).
      if (codigo === null) nuevos.delete("sucursal");
      else nuevos.set("sucursal", codigo);
      const query = nuevos.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [params, pathname, router],
  );

  const activas = sucursales.filter((s) => s.activa);
  const pedida = params.get("sucursal");

  let codigo: string | null = null;
  let nombre = NOMBRE_TODAS;
  if (usuario?.sucursal) {
    codigo = usuario.sucursal.codigo;
    nombre = usuario.sucursal.nombre;
  } else if (pedida && pedida.toLowerCase() !== TODAS) {
    const encontrada = sucursales.find((s) => s.codigo.toLowerCase() === pedida.toLowerCase());
    codigo = encontrada?.codigo ?? pedida.toUpperCase();
    nombre = encontrada?.nombre ?? codigo;
  }

  return {
    codigo,
    nombre,
    siglas: siglasDeSucursal(codigo),
    color: colorDeSucursal(codigo),
    puedeElegir: !usuario?.sucursal && activas.length > 1,
    opciones: activas,
    elegir,
  };
}
```

`apps/portal/src/components/layout/bloque-sucursal.tsx`:

```tsx
"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { colorDeSucursal } from "@/lib/sucursal-color";
import { cn } from "@/lib/utils";
import { NOMBRE_TODAS, type SucursalActual } from "./use-sucursal-actual";

const TODAS = "todas";

const CLASE_BLOQUE =
  "mx-3 mb-3 flex items-end justify-between gap-2 rounded-[10px] bg-sucursal px-3 pt-2.5 pb-3 text-left text-white";

/**
 * La sucursal en grande, en su color (UI Etapa 1, spec §3.2). Quien puede elegir abre
 * la lista; un usuario atado solo ve la suya, sin flecha.
 */
export function BloqueSucursal({ sucursal }: { sucursal: SucursalActual }) {
  const contenido = (
    <span className="flex min-w-0 flex-col">
      <span className="text-xs opacity-80">Sucursal</span>
      <span className="truncate font-titulo text-[22px] leading-tight font-bold">{sucursal.nombre}</span>
    </span>
  );

  if (!sucursal.puedeElegir) return <div className={CLASE_BLOQUE}>{contenido}</div>;

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Sucursal: ${sucursal.nombre}. Cambiar de sucursal`}
        className={cn(
          CLASE_BLOQUE,
          "w-[calc(100%-1.5rem)] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sucursal focus-visible:ring-offset-2",
        )}
      >
        {contenido}
        <ChevronDown aria-hidden className="mb-1 size-4 shrink-0" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Menu.Popup className="w-[232px] rounded-[10px] border bg-background p-1.5 text-sm shadow-[0_12px_30px_rgb(0_0_0/0.15)] outline-none">
            <Menu.RadioGroup
              value={sucursal.codigo ?? TODAS}
              onValueChange={(valor) => sucursal.elegir(valor === TODAS ? null : String(valor))}
            >
              <Opcion valor={TODAS} nombre={NOMBRE_TODAS} color={colorDeSucursal(null)} />
              {sucursal.opciones.map((s) => (
                <Opcion key={s.id} valor={s.codigo} nombre={s.nombre} color={colorDeSucursal(s.codigo)} />
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Opcion({ valor, nombre, color }: { valor: string; nombre: string; color: string }) {
  return (
    <Menu.RadioItem
      value={valor}
      closeOnClick
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-menu"
    >
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="flex-1">{nombre}</span>
      <Menu.RadioItemIndicator>
        <Check aria-hidden className="size-4" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  );
}
```

`apps/portal/src/components/layout/bloque-usuario.tsx`:

```tsx
"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronsUpDown, LogOut } from "lucide-react";
import type { UsuarioSesion } from "@/lib/api";
import { iniciales } from "@/lib/formato";

/**
 * El usuario abajo del menú (UI Etapa 1, spec §3.4): iniciales, nombre y perfil. Sin el
 * código "General" ni el de sucursal (la sucursal ya está arriba). "Cerrar sesión" vive
 * en un menú pequeño: salir deja de estar a la vista todo el tiempo.
 */
export function BloqueUsuario({
  usuario,
  onCerrarSesion,
}: {
  usuario: UsuarioSesion | null;
  onCerrarSesion: () => void;
}) {
  if (!usuario) return <div aria-hidden className="h-[59px] shrink-0 border-t" />;

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${usuario.nombre}, ${usuario.perfil}. Abrir opciones`}
        className="flex w-full shrink-0 items-center gap-2.5 border-t px-3 py-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-sucursal focus-visible:ring-inset"
      >
        <span
          aria-hidden
          className="grid size-[34px] shrink-0 place-items-center rounded-full bg-foreground text-[13px] font-semibold text-background"
        >
          {iniciales(usuario.nombre)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{usuario.nombre}</span>
          <span className="block truncate text-xs text-muted-foreground">{usuario.perfil}</span>
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50">
          <Menu.Popup className="w-[232px] rounded-[10px] border bg-background p-1.5 text-sm shadow-[0_12px_30px_rgb(0_0_0/0.15)] outline-none">
            <Menu.Item
              onClick={onCerrarSesion}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-menu"
            >
              <LogOut aria-hidden className="size-4" />
              Cerrar sesión
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
```

- [ ] **Step 4: Correr las pruebas y ver que pasan**

Run: `npx --workspace=apps/portal vitest run src/components/layout/use-sucursal-actual.test.tsx src/components/layout/bloque-sucursal.test.tsx src/components/layout/bloque-usuario.test.tsx`
Expected: PASS.

- [ ] **Step 5: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/layout/use-sucursal-actual.ts apps/portal/src/components/layout/use-sucursal-actual.test.tsx \
  apps/portal/src/components/layout/bloque-sucursal.tsx apps/portal/src/components/layout/bloque-sucursal.test.tsx \
  apps/portal/src/components/layout/bloque-usuario.tsx apps/portal/src/components/layout/bloque-usuario.test.tsx
git commit -m "$(cat <<'EOF'
Portal UI: bloque de sucursal en su color y bloque de usuario con Cerrar sesión

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: El marco del portal (menú fijo, menú escondido y título de la pestaña)

**Files:**
- Create: `apps/portal/src/components/layout/marco-portal.tsx`, `marco-portal.test.tsx`
- Modify: `apps/portal/src/app/(portal)/layout.tsx` (archivo completo)
- Modify: `apps/portal/src/app/layout.tsx` (`metadata` sin `title`)
- Modify: `apps/portal/src/components/precios/pantalla-precios.tsx` (un comentario que nombra el archivo borrado)
- Delete: `apps/portal/src/components/layout/barra-usuario.tsx`, `selector-sucursal.tsx`, `sidebar-nav.tsx`

**Interfaces:**
- Consumes: `SeccionesMenu` (Task 6), `tituloDePestana` (Task 6), `useSucursalActual`, `BloqueSucursal`, `BloqueUsuario` (Task 7), `leerLocal`/`guardarLocal` (Task 6), `iniciales` (Task 1), `useAuth`.
- Produces: `CLAVE_MENU_ESCONDIDO = "jawa.menu.escondido"`, `MarcoPortal({ children }: { children: ReactNode })`. El `<main>` lleva `min-w-0` y la línea de 3 px del color de la sucursal; el contenedor fija `--suc` para todo lo de adentro.

- [ ] **Step 1: Escribir la prueba que falla**

`apps/portal/src/components/layout/marco-portal.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import type { UsuarioSesion } from "@/lib/api";
import * as sucursalesLib from "@/lib/sucursales";
import type { Sucursal } from "@/lib/sucursales";
import { CLAVE_MENU_ESCONDIDO, MarcoPortal } from "./marco-portal";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(), useRouter: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/sucursales", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales")>()),
  listarSucursales: vi.fn(),
}));

const SUCURSALES: Sucursal[] = [
  { id: "s1", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false },
  { id: "s2", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
];
const GENERAL: UsuarioSesion = { id: "u1", login: "admin", nombre: "Admin Local", perfil: "Administrador General", sucursal: null, permisos: [] };
const ATADO: UsuarioSesion = { ...GENERAL, id: "u2", sucursal: { id: "s1", codigo: "TJ", nombre: "Tijuana" } };

const cerrarSesion = vi.fn();

function preparar(query = "sucursal=TJ", usuario: UsuarioSesion = GENERAL) {
  vi.mocked(usePathname).mockReturnValue("/operacion/ventas");
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>);
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn() } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(useAuth).mockReturnValue({ usuario, cargando: false, cerrarSesion, puede: () => true });
  vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue(SUCURSALES);
}

function renderizar() {
  return render(
    <MarcoPortal>
      <p>Contenido de la pantalla</p>
    </MarcoPortal>,
  );
}

describe("MarcoPortal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
    cerrarSesion.mockResolvedValue(undefined);
  });

  it("Review Focus 5: el contenido no empuja la página y el menú ocupa el alto de la ventana", () => {
    preparar();
    renderizar();
    const main = screen.getByText("Contenido de la pantalla").closest("main");
    expect(main).toHaveClass("min-w-0", "border-sucursal");
    expect(screen.getByRole("navigation", { name: "Menú principal" }).closest("aside")).toHaveClass("sticky", "h-dvh");
    expect(screen.getByRole("link", { name: "Ventas" })).toHaveAttribute("aria-current", "page");
  });

  it("el color de la sucursal llega a todo el marco", () => {
    preparar();
    renderizar();
    const marco = screen.getByText("Contenido de la pantalla").closest("main")?.parentElement;
    expect(marco?.style.getPropertyValue("--suc")).toBe("var(--suc-tj)");
  });

  it("la pestaña dice la pantalla y la sucursal", async () => {
    preparar();
    renderizar();
    await waitFor(() => expect(document.title).toBe("Ventas | JAWA Tijuana"));
  });

  it("con todas las sucursales la pestaña dice solo JAWA", async () => {
    preparar("");
    renderizar();
    await waitFor(() => expect(document.title).toBe("Ventas | JAWA"));
    // El botón aparece cuando llega la lista de sucursales (hay más de una para elegir).
    expect(await screen.findByRole("button", { name: /Sucursal: Todas las sucursales/ })).toBeInTheDocument();
  });

  it("un usuario atado ve su sucursal sin lista y la pestaña la dice", async () => {
    preparar("sucursal=MX", ATADO);
    renderizar();
    await waitFor(() => expect(document.title).toBe("Ventas | JAWA Tijuana"));
    expect(screen.queryByRole("button", { name: /Cambiar de sucursal/ })).not.toBeInTheDocument();
  });

  it("☰ esconde el menú y deja la franja con la sucursal y las iniciales; se recuerda", async () => {
    preparar();
    const usuario = userEvent.setup();
    const { unmount } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Esconder menú" }));
    expect(screen.queryByRole("navigation", { name: "Menú principal" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar menú" })).toBeInTheDocument();
    expect(screen.getByText("TJ")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("Contenido de la pantalla")).toBeInTheDocument();
    expect(localStorage.getItem(CLAVE_MENU_ESCONDIDO)).toBe("1");
    unmount();

    renderizar();
    expect(await screen.findByRole("button", { name: "Mostrar menú" })).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Mostrar menú" }));
    expect(screen.getByRole("navigation", { name: "Menú principal" })).toBeInTheDocument();
    expect(localStorage.getItem(CLAVE_MENU_ESCONDIDO)).toBe("0");
  });

  it("Review Focus 2: sin localStorage el menú arranca abierto y se esconde igual", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    preparar();
    const usuario = userEvent.setup();
    renderizar();
    expect(screen.getByRole("navigation", { name: "Menú principal" })).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Esconder menú" }));
    expect(screen.getByRole("button", { name: "Mostrar menú" })).toBeInTheDocument();
  });

  it("Cerrar sesión desde el menú del usuario", async () => {
    preparar();
    const usuario = userEvent.setup();
    renderizar();
    await usuario.click(screen.getByRole("button", { name: /Admin Local/ }));
    await usuario.click(await screen.findByRole("menuitem", { name: "Cerrar sesión" }));
    expect(cerrarSesion).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Correr la prueba y ver que falla**

Run: `npx --workspace=apps/portal vitest run src/components/layout/marco-portal.test.tsx`
Expected: FAIL — `Failed to resolve import "./marco-portal"`.

- [ ] **Step 3: Escribir `marco-portal.tsx`**

`apps/portal/src/components/layout/marco-portal.tsx`:

```tsx
"use client";

import { Menu as IconoMenu } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { guardarLocal, leerLocal } from "@/lib/almacen-local";
import { iniciales } from "@/lib/formato";
import { BloqueSucursal } from "./bloque-sucursal";
import { BloqueUsuario } from "./bloque-usuario";
import { tituloDePestana } from "./nav-config";
import { SeccionesMenu } from "./secciones-menu";
import { useSucursalActual } from "./use-sucursal-actual";

export const CLAVE_MENU_ESCONDIDO = "jawa.menu.escondido";

function BotonMenu({ etiqueta, onClick }: { etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sucursal/40"
    >
      <IconoMenu aria-hidden className="size-4" />
    </button>
  );
}

/**
 * El marco de todas las pantallas (UI Etapa 1, spec §3): el menú lateral ocupa el alto
 * de la ventana y no se mueve al bajar por una tabla; el contenido lleva `min-w-0` para
 * que una tabla ancha se desplace dentro de su caja y no empuje la página. El color de
 * la sucursal (`--suc`) se fija aquí para todo lo de adentro.
 */
export function MarcoPortal({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { usuario, cerrarSesion } = useAuth();
  const sucursal = useSucursalActual();
  // En el servidor no hay localStorage: se arranca abierto y se ajusta al montar.
  const [escondido, setEscondido] = useState(false);

  useEffect(() => {
    setEscondido(leerLocal(CLAVE_MENU_ESCONDIDO) === "1");
  }, []);

  function alternarMenu() {
    const nuevo = !escondido;
    setEscondido(nuevo);
    guardarLocal(CLAVE_MENU_ESCONDIDO, nuevo ? "1" : "0");
  }

  const titulo = tituloDePestana(pathname, sucursal.codigo === null ? null : sucursal.nombre);
  const estilo = { "--suc": sucursal.color } as CSSProperties;

  return (
    <div className="flex min-h-dvh" style={estilo}>
      {/* React 19 sube este <title> al <head>; app/layout.tsx ya no fija uno propio. */}
      <title>{titulo}</title>
      {escondido ? (
        <aside
          aria-label="Menú escondido"
          className="sticky top-0 flex h-dvh w-[60px] shrink-0 flex-col items-center gap-3 border-r bg-menu py-3.5"
        >
          <BotonMenu etiqueta="Mostrar menú" onClick={alternarMenu} />
          <span title={sucursal.nombre} className="rounded-md bg-sucursal px-1.5 py-1 text-xs font-bold text-white">
            {sucursal.siglas}
          </span>
          {usuario && (
            <span
              title={usuario.nombre}
              className="mt-auto grid size-[34px] place-items-center rounded-full bg-foreground text-[13px] font-semibold text-background"
            >
              {iniciales(usuario.nombre)}
            </span>
          )}
        </aside>
      ) : (
        <aside className="sticky top-0 flex h-dvh w-64 shrink-0 flex-col border-r bg-menu">
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <span className="font-titulo text-xl font-bold">JAWA</span>
            <BotonMenu etiqueta="Esconder menú" onClick={alternarMenu} />
          </div>
          <BloqueSucursal sucursal={sucursal} />
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <SeccionesMenu pathname={pathname} sucursal={params.get("sucursal")} />
          </div>
          <BloqueUsuario usuario={usuario} onCerrarSesion={() => void cerrarSesion()} />
        </aside>
      )}
      <main className="min-w-0 flex-1 border-t-[3px] border-sucursal px-8 py-7">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Correr la prueba y ver que pasa**

Run: `npx --workspace=apps/portal vitest run src/components/layout/marco-portal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Montar el marco y quitar la barra de arriba**

Reemplazar **todo** `apps/portal/src/app/(portal)/layout.tsx` por:

```tsx
import type { ReactNode } from "react";
import { Suspense } from "react";
import { AuthProvider } from "@/components/auth/auth-provider";
import { MarcoPortal } from "@/components/layout/marco-portal";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {/* El marco lee ?sucursal= (useSearchParams): Next pide un Suspense para las páginas estáticas ("Próximamente"). */}
      <Suspense fallback={null}>
        <MarcoPortal>{children}</MarcoPortal>
      </Suspense>
    </AuthProvider>
  );
}
```

En `apps/portal/src/app/layout.tsx`, reemplazar:

```tsx
export const metadata: Metadata = {
  title: "JAWA · Portal",
  description: "Portal de administración de JAWA",
};
```

por:

```tsx
// Sin `title`: lo pone cada pantalla del portal ("Ventas | JAWA Tijuana", MarcoPortal) y el
// login trae el suyo. Dos <title> en el <head> harían que el navegador mostrara el primero.
export const metadata: Metadata = {
  description: "Portal de administración de JAWA",
};
```

Borrar los tres archivos del menú viejo:

```bash
git rm apps/portal/src/components/layout/barra-usuario.tsx apps/portal/src/components/layout/selector-sucursal.tsx apps/portal/src/components/layout/sidebar-nav.tsx
```

En `apps/portal/src/components/precios/pantalla-precios.tsx`, reemplazar:

```tsx
  // siquiera le pinta un <select>, ver selector-sucursal.tsx). General: la
```

por:

```tsx
  // siquiera le pinta una lista, ver use-sucursal-actual.ts). General: la
```

- [ ] **Step 6: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde; `grep -rn "BarraUsuario\|SidebarNav\|selector-sucursal" apps/portal/src` no encuentra nada fuera de comentarios de historia (`clientes/filtro-tipo.tsx` menciona "SelectorSucursal (T-09)" como patrón: se queda).

- [ ] **Step 7: Ver el marco en el navegador (rápido)**

Con el stack local arriba (ver la Task 14, Step 3, para levantarlo), abrir `http://localhost:3001/operacion/ventas` en una ventana de incógnito (la extensión de Chrome de Roberto achica el viewport fuera de incógnito): el menú no se mueve al bajar, ☰ lo esconde y deja la franja con la pastilla de la sucursal, la pestaña dice "Ventas | JAWA" o "Ventas | JAWA Tijuana" según la sucursal, y "Cerrar sesión" está en el menú del usuario.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/components/layout/marco-portal.tsx apps/portal/src/components/layout/marco-portal.test.tsx \
  "apps/portal/src/app/(portal)/layout.tsx" apps/portal/src/app/layout.tsx apps/portal/src/components/precios/pantalla-precios.tsx
git commit -m "$(cat <<'EOF'
Portal UI: menú lateral fijo con la sucursal en su color y menú escondido

La barra de arriba desaparece: sucursal y usuario viven en el menú. La
pestaña del navegador dice la pantalla y la sucursal.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Ventas (lista, detalle y editar) con las piezas nuevas

**Files:**
- Modify: `apps/portal/src/components/ventas/pantalla-ventas.tsx` (archivo completo)
- Modify: `apps/portal/src/components/ventas/detalle-venta.tsx` (archivo completo)
- Modify: `apps/portal/src/components/ventas/formulario-editar-venta.tsx` (archivo completo)
- Modify: `apps/portal/src/components/ventas/tabla-productos-venta.tsx` (archivo completo; también la usa Registrar venta, sin cambiar su forma)
- Test: `apps/portal/src/components/ventas/pantalla-ventas.test.tsx`, `detalle-venta.test.tsx`, `formulario-editar-venta.test.tsx`

**Interfaces:**
- Consumes: `Aviso`, `EtiquetaStatusVenta`, `Monto`, `Fecha`, `CajaTabla`/`Tabla`/`Th`/`Td`/`TdMonto`/`Fila` (Task 2); `Campo`, `Entrada` (Task 3); `useConfirmar` (Task 4); `Pantalla`, `EncabezadoPantalla`, `FiltroFechas` (Task 5); `buttonVariants` (`@/components/ui/button`); `formatearFecha`, `formatearPesos` (`@/lib/formato`).
- Produces: nada nuevo para otras tareas. Las props de `PantallaVentas`, `DetalleVenta`, `FormularioEditarVenta` y `TablaProductosVenta` no cambian.

Cambios visibles a propósito (spec §5): encabezado con su explicación y "Registrar venta" a la derecha (solo con `venta.registrar`); filtro de fechas común con atajos y **Buscar → Mostrar**; fechas `dd/mm/aaaa`; status en pastilla de color; precios a la derecha; **Eliminar** y **Marcar como cuenta perdida** piden confirmación en la ventana común; "Volver" pasa al encabezado del detalle.

- [ ] **Step 1: Ajustar las pruebas a lo que cambia (y agregar las nuevas)**

En `apps/portal/src/components/ventas/pantalla-ventas.test.tsx`:

Reemplazar:

```tsx
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
```

por:

```tsx
    expect(screen.getByText("Pendiente")).toHaveAttribute("data-tono", "advertencia");
    expect(screen.getByText("04/03/2024")).toBeInTheDocument();
```

Reemplazar:

```tsx
  it("aplica los filtros al pulsar Buscar, con la sucursal del selector", async () => {
```

por:

```tsx
  it("aplica los filtros al pulsar Mostrar, con la sucursal del selector", async () => {
```

Reemplazar las **dos** apariciones (Edit con `replace_all: true`) de:

```tsx
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
```

por:

```tsx
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
```

Reemplazar la prueba completa:

```tsx
  it("Eliminar confirmado vuelve a la búsqueda y la refresca", async () => {
    const usuario = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    eliminarVenta.mockResolvedValue({ id: "v1" });
    render(<PantallaVentas sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: "TJ240304AP01" }));
    await usuario.click(await screen.findByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("button", { name: "Buscar" })).toBeInTheDocument();
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(2));
  });
});
```

por:

```tsx
  it("Eliminar confirmado en la ventana vuelve a la búsqueda y la refresca", async () => {
    const usuario = userEvent.setup();
    eliminarVenta.mockResolvedValue({ id: "v1" });
    render(<PantallaVentas sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: "TJ240304AP01" }));
    await usuario.click(await screen.findByRole("button", { name: "Eliminar" }));
    await usuario.click(screen.getByRole("button", { name: "Eliminar venta" }));

    expect(await screen.findByRole("button", { name: "Mostrar" })).toBeInTheDocument();
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(2));
  });

  it("el encabezado explica la pantalla y lleva a Registrar venta con la sucursal", async () => {
    render(<PantallaVentas sucursal="TJ" />);
    expect(screen.getByRole("heading", { level: 1, name: "Ventas" })).toBeInTheDocument();
    expect(screen.getByText(/para verla, editarla o eliminarla/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar venta" })).toHaveAttribute(
      "href",
      "/operacion/registrar-venta?sucursal=TJ",
    );
    await screen.findByRole("button", { name: "TJ240304AP01" });
  });

  it("sin venta.registrar no ofrece Registrar venta", async () => {
    vi.mocked(useAuth).mockReturnValue({
      usuario: null,
      cargando: false,
      cerrarSesion: vi.fn(),
      puede: (clave) => clave !== "venta.registrar",
    });
    render(<PantallaVentas sucursal={null} />);
    await screen.findByRole("button", { name: "TJ240304AP01" });
    expect(screen.queryByRole("link", { name: "Registrar venta" })).not.toBeInTheDocument();
  });

  it("con fechas invertidas avisa y no vuelve a buscar", async () => {
    const usuario = userEvent.setup();
    render(<PantallaVentas sucursal={null} />);
    await screen.findByRole("button", { name: "TJ240304AP01" });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2099-12-31" } });
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior a la final.");
    expect(buscarVentas).toHaveBeenCalledTimes(1);
  });
});
```

En `apps/portal/src/components/ventas/detalle-venta.test.tsx`:

Reemplazar:

```tsx
    expect(screen.getByText("Abonado")).toBeInTheDocument();
    expect(screen.getByText("Entregar temprano")).toBeInTheDocument();
```

por:

```tsx
    expect(screen.getByText("Abonado")).toHaveAttribute("data-tono", "informacion");
    expect(screen.getByText("04/03/2024")).toBeInTheDocument();
    expect(screen.getByText("05/03/2024")).toBeInTheDocument();
    expect(screen.getByText("Entregar temprano")).toBeInTheDocument();
```

Reemplazar el bloque de cuatro pruebas que va de `it("Eliminar pide confirmación y, si se cancela, no hace nada", async () => {` hasta el final de `it("Marcar como cuenta perdida confirma y entrega la venta actualizada", ...)`:

```tsx
  it("Eliminar pide confirmación y, si se cancela, no hace nada", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { usuario, onEliminada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(confirmar).toHaveBeenCalledWith("¿Eliminar la venta TJ240304OF01 (nota 1234)? No se puede deshacer.");
    expect(eliminarVenta).not.toHaveBeenCalled();
    expect(onEliminada).not.toHaveBeenCalled();
  });

  // Review Focus 5
  it("Eliminar confirmado llama una sola vez aunque se pulse dos veces, y avisa al terminar", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let terminar!: (v: { id: string }) => void;
    eliminarVenta.mockReturnValue(
      new Promise<{ id: string }>((r) => {
        terminar = r;
      }),
    );
    const { usuario, onEliminada } = renderizar();
    const boton = screen.getByRole("button", { name: "Eliminar" });
    await usuario.click(boton);
    await usuario.click(boton);
    expect(eliminarVenta).toHaveBeenCalledTimes(1);
    expect(eliminarVenta).toHaveBeenCalledWith("v1");
    terminar({ id: "v1" });
    await vi.waitFor(() => expect(onEliminada).toHaveBeenCalledTimes(1));
  });

  it("Marcar como cuenta perdida confirma y entrega la venta actualizada", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    const actualizada = { ...VENTA, status: "cuenta_perdida" as const, editable: false, puedeMarcarPerdida: false };
    marcarCuentaPerdida.mockResolvedValue(actualizada);
    const { usuario, onCambiada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Marcar como cuenta perdida" }));
    expect(confirmar).toHaveBeenCalledWith("La venta TJ240304OF01 dejará de cobrarse. ¿Continuar?");
    await vi.waitFor(() => expect(onCambiada).toHaveBeenCalledWith(actualizada));
  });
```

por:

```tsx
  it("Eliminar pregunta en la ventana y, si se cancela, no hace nada", async () => {
    const { usuario, onEliminada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    const ventana = screen.getByRole("alertdialog", { name: "¿Eliminar la venta TJ240304OF01 (nota 1234)?" });
    expect(ventana).toHaveTextContent("No se puede deshacer.");
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(eliminarVenta).not.toHaveBeenCalled();
    expect(onEliminada).not.toHaveBeenCalled();
  });

  // Review Focus 5 (T-17) y Review Focus 4 (UI Etapa 1)
  it("Eliminar confirmado llama una sola vez aunque se pulse dos veces, y avisa al terminar", async () => {
    let terminar!: (v: { id: string }) => void;
    eliminarVenta.mockReturnValue(
      new Promise<{ id: string }>((r) => {
        terminar = r;
      }),
    );
    const { usuario, onEliminada } = renderizar();
    const boton = screen.getByRole("button", { name: "Eliminar" });
    await usuario.click(boton);
    // Dos clics seguidos en "Eliminar venta": el primero cierra la ventana, el segundo no hace nada.
    const confirmarBoton = screen.getByRole("button", { name: "Eliminar venta" });
    fireEvent.click(confirmarBoton);
    fireEvent.click(confirmarBoton);
    // Mientras se elimina el botón queda apagado: otro clic no abre otra pregunta.
    await vi.waitFor(() => expect(boton).toBeDisabled());
    await usuario.click(boton);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(eliminarVenta).toHaveBeenCalledTimes(1);
    expect(eliminarVenta).toHaveBeenCalledWith("v1");
    terminar({ id: "v1" });
    await vi.waitFor(() => expect(onEliminada).toHaveBeenCalledTimes(1));
  });

  it("Marcar como cuenta perdida pregunta en la ventana y entrega la venta actualizada", async () => {
    const actualizada = { ...VENTA, status: "cuenta_perdida" as const, editable: false, puedeMarcarPerdida: false };
    marcarCuentaPerdida.mockResolvedValue(actualizada);
    const { usuario, onCambiada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Marcar como cuenta perdida" }));
    expect(
      screen.getByRole("alertdialog", { name: "¿Marcar la venta TJ240304OF01 como cuenta perdida?" }),
    ).toHaveTextContent("La venta dejará de cobrarse.");
    await usuario.click(screen.getByRole("button", { name: "Marcar como perdida" }));
    await vi.waitFor(() => expect(onCambiada).toHaveBeenCalledWith(actualizada));
  });
```

Reemplazar:

```tsx
  it("muestra el mensaje del servidor", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    eliminarVenta.mockRejectedValue(new ErrorApi("fallo", 409, "Tiene cobros registrados: no se puede eliminar."));
    const { usuario, onEliminada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
```

por:

```tsx
  it("muestra el mensaje del servidor", async () => {
    eliminarVenta.mockRejectedValue(new ErrorApi("fallo", 409, "Tiene cobros registrados: no se puede eliminar."));
    const { usuario, onEliminada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    await usuario.click(screen.getByRole("button", { name: "Eliminar venta" }));
```

Reemplazar la línea de imports:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
```

por:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
```

Reemplazar:

```tsx
    const ETIQUETA = "Pedir borrado del cobro del 2024-03-05 por $100.00";
```

por:

```tsx
    const ETIQUETA = "Pedir borrado del cobro del 05/03/2024 por $100.00";
```

En `apps/portal/src/components/ventas/formulario-editar-venta.test.tsx`, reemplazar:

```tsx
    expect(screen.getByText("2024-03-04")).toBeInTheDocument();
```

por:

```tsx
    expect(screen.getByText("04/03/2024")).toBeInTheDocument();
```

- [ ] **Step 2: Correr las pruebas de Ventas y ver que fallan**

Run: `npx --workspace=apps/portal vitest run src/components/ventas`
Expected: FAIL — no hay botón "Mostrar" ni enlace "Registrar venta", las fechas salen `2024-03-04`, no aparece `alertdialog`.

- [ ] **Step 3: Reescribir las cuatro piezas de Ventas**

Reemplazar **todo** `apps/portal/src/components/ventas/pantalla-ventas.tsx` por:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { buttonVariants } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { CajaTabla, Fila, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  ETIQUETA_ORIGEN,
  buscarVentas,
  hoyEnTijuana,
  obtenerVenta,
  type ResultadoBusquedaVentas,
  type VentaDetalle,
} from "@/lib/ventas";
import { BuscadorCliente } from "./buscador-cliente";
import { DetalleVenta } from "./detalle-venta";
import { FormularioEditarVenta } from "./formulario-editar-venta";

interface Filtro {
  desde: string;
  hasta: string;
  cliente: ClienteResumen | null;
  numNota: string;
}

type Vista =
  | { tipo: "busqueda" }
  | { tipo: "detalle"; venta: VentaDetalle }
  | { tipo: "edicion"; venta: VentaDetalle };

function filtroDeHoy(): Filtro {
  const hoy = hoyEnTijuana();
  return { desde: hoy, hasta: hoy, cliente: null, numNota: "" };
}

/**
 * Ventas (T-17, parte 2, §3): buscar por rango de fechas, cliente y # de nota;
 * ver el detalle; editar, eliminar o marcar como cuenta perdida. Vale para las
 * ventas de la tablet y del portal.
 *
 * Los filtros viven aquí y no en la vista de búsqueda: así "Volver" regresa
 * con los mismos filtros y vuelve a buscar (la venta pudo cambiar).
 */
export function PantallaVentas({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [borrador, setBorrador] = useState<Filtro>(filtroDeHoy);
  const [aplicado, setAplicado] = useState<Filtro>(filtroDeHoy);
  const [resultado, setResultado] = useState<ResultadoBusquedaVentas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>({ tipo: "busqueda" });

  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => {
        if (vigente) setClientes(lista);
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar los clientes.");
      });
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  // Cada `setAplicado` (Mostrar, Volver) es un objeto nuevo: vuelve a buscar.
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    buscarVentas({
      desde: aplicado.desde,
      hasta: aplicado.hasta,
      sucursal,
      clienteId: aplicado.cliente?.id ?? null,
      numNota: aplicado.numNota,
    })
      .then((r) => {
        if (!vigente) return;
        setResultado(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (vigente) setError(mensajeDe(err, "No se pudieron buscar las ventas."));
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [aplicado, sucursal]);

  function volverABusqueda() {
    setVista({ tipo: "busqueda" });
    setAplicado((actual) => ({ ...actual }));
  }

  async function abrir(id: string) {
    setError(null);
    try {
      setVista({ tipo: "detalle", venta: await obtenerVenta(id) });
    } catch (err) {
      setError(mensajeDe(err, "No se pudo abrir la venta."));
    }
  }

  if (vista.tipo === "edicion") {
    return (
      <FormularioEditarVenta
        venta={vista.venta}
        onGuardada={(actualizada) => setVista({ tipo: "detalle", venta: actualizada })}
        onCancelar={() => setVista({ tipo: "detalle", venta: vista.venta })}
      />
    );
  }

  if (vista.tipo === "detalle") {
    return (
      <DetalleVenta
        venta={vista.venta}
        onVolver={volverABusqueda}
        onEditar={() => setVista({ tipo: "edicion", venta: vista.venta })}
        onCambiada={(actualizada) => setVista({ tipo: "detalle", venta: actualizada })}
        onEliminada={volverABusqueda}
      />
    );
  }

  const enlaceRegistrar = sucursal
    ? `/operacion/registrar-venta?sucursal=${encodeURIComponent(sucursal)}`
    : "/operacion/registrar-venta";

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Ventas"
        descripcion="Busca una venta por fecha, cliente o # de nota para verla, editarla o eliminarla."
        acciones={
          puede("venta.registrar") ? (
            <Link href={enlaceRegistrar} className={buttonVariants()}>
              Registrar venta
            </Link>
          ) : undefined
        }
      />

      <FiltroFechas
        id="ventas"
        desde={borrador.desde}
        hasta={borrador.hasta}
        onCambio={(rango) => setBorrador({ ...borrador, ...rango })}
        onMostrar={() => setAplicado({ ...borrador })}
        deshabilitado={cargando}
      >
        <BuscadorCliente
          clientes={clientes}
          cliente={borrador.cliente}
          onElegir={(cliente) => setBorrador({ ...borrador, cliente })}
          onQuitar={() => setBorrador({ ...borrador, cliente: null })}
          etiquetaQuitar="Quitar"
        />
        <Campo id="buscar-num-nota" etiqueta="# de nota">
          <Entrada
            maxLength={30}
            value={borrador.numNota}
            onChange={(e) => setBorrador({ ...borrador, numNota: e.target.value })}
            className="w-40"
          />
        </Campo>
      </FiltroFechas>

      {error && <Aviso tono="error">{error}</Aviso>}

      {resultado?.hayMas && (
        <Aviso tono="advertencia">Hay más de 200 ventas: acota el rango o filtra por cliente.</Aviso>
      )}

      {resultado && resultado.ventas.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay ventas con esos filtros.</p>
      )}

      {resultado && resultado.ventas.length > 0 && (
        <CajaTabla>
          <Tabla className="min-w-[860px]">
            <thead>
              <tr>
                <Th>Folio</Th>
                <Th>Fecha</Th>
                <Th>Cliente</Th>
                <Th>Repartidor</Th>
                <Th># de nota</Th>
                <Th alinear="derecha">Monto</Th>
                <Th>Status</Th>
                <Th>Origen</Th>
                <Th alinear="derecha">Saldo</Th>
              </tr>
            </thead>
            <tbody>
              {resultado.ventas.map((v) => (
                <Fila key={v.id} interactiva>
                  <Td>
                    <button
                      type="button"
                      onClick={() => void abrir(v.id)}
                      className="font-mono underline-offset-2 hover:underline"
                    >
                      {v.folio}
                    </button>
                  </Td>
                  <Td>
                    <Fecha valor={v.fecha} />
                  </Td>
                  <Td>{v.cliente}</Td>
                  <Td>{v.repartidor ?? "Oficina"}</Td>
                  <Td>{v.numNota ?? "—"}</Td>
                  <TdMonto centavos={v.montoCentavos} />
                  <Td>
                    <EtiquetaStatusVenta status={v.status} />
                  </Td>
                  <Td>{ETIQUETA_ORIGEN[v.origen]}</Td>
                  <TdMonto centavos={v.saldoCentavos} />
                </Fila>
              ))}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}
    </Pantalla>
  );
}
```

Reemplazar **todo** `apps/portal/src/components/ventas/detalle-venta.tsx` por:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { PedirBorradoCobro } from "@/components/peticiones/pedir-borrado-cobro";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { ETIQUETA_METODO_PAGO } from "@/lib/cobranzas";
import { formatearFecha, formatearPesos } from "@/lib/formato";
import { ETIQUETA_BORRADO_PEDIDO } from "@/lib/peticiones";
import {
  ETIQUETA_ORIGEN,
  eliminarVenta,
  marcarCuentaPerdida,
  obtenerVenta,
  type VentaDetalle,
} from "@/lib/ventas";
import { FirmaVenta } from "./firma-venta";

const ETIQUETA_COBRO: Record<VentaDetalle["cobros"][number]["origen"], string> = {
  venta_contado: "Cobro de contado",
  cobro: "Cobranza",
  saldo_favor: "Saldo a favor",
};

/** Lo que salió de pedir un borrado: bien (verde) o la pantalla quedó vieja (ámbar). */
type AvisoDetalle = { texto: string; tono: "exito" | "advertencia" };

/**
 * El detalle de una venta y sus acciones (T-17, parte 2, §3.2). Los botones
 * salen de las banderas del servidor (`editable`, `puedeMarcarPerdida`) Y del
 * permiso `venta.editar_eliminar`: el servidor no conoce la pantalla y la
 * pantalla no decide reglas de la venta.
 */
export function DetalleVenta({
  venta,
  onVolver,
  onEditar,
  onCambiada,
  onEliminada,
}: {
  venta: VentaDetalle;
  onVolver: () => void;
  onEditar: () => void;
  onCambiada: (actualizada: VentaDetalle) => void;
  onEliminada: () => void;
}) {
  const { puede } = useAuth();
  const puedeGestionar = puede("venta.editar_eliminar");
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo completar la acción.");
  const { confirmar, ventana } = useConfirmar();
  const puedePedirBorrado = puede("cobranza.editar_eliminar");
  // El pago cuyo borrado se está pidiendo (T-34); uno a la vez.
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<AvisoDetalle | null>(null);

  function pedirBorrado(cobroId: string | null) {
    if (cobroId === null) return;
    setAviso(null);
    setPidiendo(cobroId);
  }

  /** Tras pedir (o tras un 409): la venta fresca, para que el cobro diga "Borrado pedido · pendiente". */
  async function refrescar(texto: string, tono: AvisoDetalle["tono"]) {
    setPidiendo(null);
    setAviso({ texto, tono });
    try {
      onCambiada(await obtenerVenta(venta.id));
    } catch {
      setAviso({ texto: `${texto} Vuelve a abrir la venta para ver el cambio.`, tono: "advertencia" });
    }
  }

  async function eliminar() {
    const si = await confirmar({
      titulo: `¿Eliminar la venta ${venta.folio}${venta.numNota ? ` (nota ${venta.numNota})` : ""}?`,
      descripcion:
        "La venta deja de contar en reportes y en cobranza, y su folio no se vuelve a usar. No se puede deshacer.",
      confirmar: "Eliminar venta",
    });
    if (!si) return;
    await enviar(() => eliminarVenta(venta.id), onEliminada);
  }

  async function marcarPerdida() {
    const si = await confirmar({
      titulo: `¿Marcar la venta ${venta.folio} como cuenta perdida?`,
      descripcion: "La venta dejará de cobrarse.",
      confirmar: "Marcar como perdida",
    });
    if (!si) return;
    await enviar(
      async () => {
        onCambiada(await marcarCuentaPerdida(venta.id));
      },
      () => {},
    );
  }

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo={`Venta ${venta.folio}`}
        descripcion="Lo que se vendió y lo que se ha cobrado. Desde aquí se edita, se elimina o se marca como cuenta perdida."
        acciones={
          <Button variant="outline" onClick={onVolver} disabled={enviando}>
            Volver
          </Button>
        }
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-[10px] border p-4 text-sm md:grid-cols-4">
        <Dato etiqueta="Fecha" valor={<Fecha valor={venta.fecha} />} />
        <Dato etiqueta="Cliente" valor={`${venta.cliente} · ${venta.sucursalCodigo}`} />
        <Dato etiqueta="Repartidor" valor={venta.repartidor ?? "Oficina"} />
        <Dato etiqueta="# de nota" valor={venta.numNota ?? "Sin nota"} />
        <Dato etiqueta="Contado o crédito" valor={venta.contadoCredito === "contado" ? "Contado" : "Crédito"} />
        <Dato
          etiqueta="Factura"
          valor={venta.facturaNumero ? `Facturada · ${venta.facturaNumero}` : venta.factura}
        />
        <Dato etiqueta="Status" valor={<EtiquetaStatusVenta status={venta.status} />} />
        <Dato etiqueta="Origen" valor={ETIQUETA_ORIGEN[venta.origen]} />
        <Dato etiqueta="Monto" valor={<Monto centavos={venta.montoCentavos} />} />
        <Dato etiqueta="Saldo pendiente" valor={<Monto centavos={venta.saldoCentavos} />} />
        {venta.comentarios && <Dato etiqueta="Comentarios" valor={venta.comentarios} />}
      </dl>

      <CajaTabla>
        <Tabla>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th alinear="derecha">Cantidad</Th>
              <Th alinear="derecha">Promoción</Th>
              <Th alinear="derecha">Precio</Th>
              <Th alinear="derecha">Subtotal</Th>
            </tr>
          </thead>
          <tbody>
            {venta.lineas.map((l) => (
              <tr key={l.presentacionId}>
                <Td>{`${l.producto} ${l.volumen}`}</Td>
                <Td alinear="derecha">{l.cantidad}</Td>
                <Td alinear="derecha">{l.cantidadPromocion}</Td>
                <TdMonto centavos={l.precioCentavos} />
                <TdMonto centavos={l.subtotalCentavos} />
              </tr>
            ))}
          </tbody>
        </Tabla>
      </CajaTabla>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Cobros</h2>
        {venta.cobros.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin cobros.</p>
        ) : (
          <CajaTabla>
            <Tabla>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Método</Th>
                  <Th>Origen</Th>
                  <Th alinear="derecha">Monto</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {venta.cobros.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Fecha valor={c.fechaPago} />
                    </Td>
                    <Td>{ETIQUETA_METODO_PAGO[c.metodoPago] ?? c.metodoPago}</Td>
                    <Td>{ETIQUETA_COBRO[c.origen]}</Td>
                    <TdMonto centavos={c.montoCentavos} />
                    <Td alinear="derecha">
                      {c.cobroId !== null && c.peticionPendiente && (
                        <span className="text-muted-foreground">{ETIQUETA_BORRADO_PEDIDO}</span>
                      )}
                      {c.cobroId !== null && !c.peticionPendiente && puedePedirBorrado && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Pedir borrado del cobro del ${formatearFecha(c.fechaPago)} por ${formatearPesos(c.montoCentavos)}`}
                          disabled={pidiendo !== null}
                          onClick={() => pedirBorrado(c.cobroId)}
                        >
                          Pedir borrado
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        )}
      </section>

      <FirmaVenta ventaId={venta.id} firma={venta.firma} editada={venta.editada} />

      {pidiendo && (
        <PedirBorradoCobro
          key={pidiendo}
          cobroId={pidiendo}
          onEnviada={(mensaje) => void refrescar(mensaje, "exito")}
          onDesactualizado={(mensaje) => void refrescar(mensaje, "advertencia")}
          onCancelar={() => setPidiendo(null)}
        />
      )}

      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}

      {venta.motivoNoEditable && <p className="text-sm text-muted-foreground">{venta.motivoNoEditable}</p>}

      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="flex flex-wrap gap-2">
        {puedeGestionar && venta.editable && (
          <>
            <Button onClick={onEditar} disabled={enviando}>
              Editar
            </Button>
            <Button variant="destructive" onClick={() => void eliminar()} disabled={enviando}>
              Eliminar
            </Button>
          </>
        )}
        {puedeGestionar && venta.puedeMarcarPerdida && (
          <Button variant="outline" onClick={() => void marcarPerdida()} disabled={enviando}>
            Marcar como cuenta perdida
          </Button>
        )}
      </div>

      {ventana}
    </Pantalla>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="mt-0.5">{valor}</dd>
    </div>
  );
}
```

Reemplazar **todo** `apps/portal/src/components/ventas/formulario-editar-venta.tsx` por:

```tsx
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { Fecha } from "@/components/ui/fecha";
import {
  REPARTIDOR_OFICINA,
  camposDeCondiciones,
  capturaDeLineas,
  conCaptura,
  condicionesDeVenta,
  editarVenta,
  filasDeEdicion,
  formatearPesos,
  lineasDeCaptura,
  listarRepartidores,
  obtenerCatalogoVenta,
  totalDeCaptura,
  type Captura,
  type CondicionesVenta,
  type PresentacionDeCatalogo,
  type Repartidor,
  type VentaDetalle,
} from "@/lib/ventas";
import { CamposCondicionesVenta } from "./campos-condiciones-venta";
import { SelectorRepartidor } from "./selector-repartidor";
import { TablaProductosVenta } from "./tabla-productos-venta";

/**
 * Editar una venta (T-17, parte 2, §3.3): el mismo formulario que "Registrar
 * venta" con el cliente y la fecha fijos. Las líneas existentes muestran su
 * precio guardado; las presentaciones nuevas, el de la lista a la fecha de la
 * venta. El servidor vuelve a resolver todo al grabar.
 */
export function FormularioEditarVenta({
  venta,
  onGuardada,
  onCancelar,
}: {
  venta: VentaDetalle;
  onGuardada: (actualizada: VentaDetalle) => void;
  onCancelar: () => void;
}) {
  const [catalogo, setCatalogo] = useState<PresentacionDeCatalogo[]>([]);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [cargado, setCargado] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [repartidor, setRepartidor] = useState(venta.vendedorId ?? REPARTIDOR_OFICINA);
  const [captura, setCaptura] = useState<Captura>(() => capturaDeLineas(venta.lineas));
  const [condiciones, setCondiciones] = useState<CondicionesVenta>(() => condicionesDeVenta(venta));
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar la venta.");

  useEffect(() => {
    let vigente = true;
    Promise.all([
      obtenerCatalogoVenta(venta.clienteId, venta.fecha),
      listarRepartidores(venta.sucursalId),
    ])
      .then(([lista, activos]) => {
        if (!vigente) return;
        setCatalogo(lista);
        setRepartidores(activos);
        setCargado(true);
      })
      .catch(() => {
        if (vigente) setErrorCarga("No se pudieron cargar los productos y repartidores de la venta.");
      });
    return () => {
      vigente = false;
    };
  }, [venta.clienteId, venta.fecha, venta.sucursalId]);

  const filas = useMemo(() => filasDeEdicion(venta.lineas, catalogo), [venta.lineas, catalogo]);
  const totalCentavos = totalDeCaptura(filas, captura);

  // El repartidor actual pudo darse de baja: se conserva como opción para no
  // cambiárselo sin querer (el servidor no lo re-valida si no cambia).
  const opciones = useMemo(() => {
    const actual = venta.vendedorId;
    if (actual === null || repartidores.some((r) => r.id === actual)) return repartidores;
    const nombre = venta.repartidor ?? "Vendedor";
    return [...repartidores, { id: actual, nombre: cargado ? `${nombre} (inactivo)` : nombre }];
  }, [repartidores, cargado, venta.vendedorId, venta.repartidor]);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErrorLocal(null);
    if (repartidor === "") {
      setErrorLocal("Elige el repartidor.");
      return;
    }
    const armadas = lineasDeCaptura(filas, captura);
    if (!armadas.ok) {
      setErrorLocal(armadas.error);
      return;
    }
    await enviar(
      async () => {
        onGuardada(
          await editarVenta(venta.id, {
            vendedorId: repartidor === REPARTIDOR_OFICINA ? null : repartidor,
            ...camposDeCondiciones(condiciones),
            lineas: armadas.lineas,
          }),
        );
      },
      () => {},
    );
  }

  const mensajeError = errorLocal ?? error;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo={`Editar venta ${venta.folio}`}
        descripcion="Cambia productos, repartidor o condiciones. El cliente y la fecha no se cambian; los productos que ya tenía conservan su precio."
      />
      <form onSubmit={alEnviar} className="flex flex-col gap-5">
        {errorCarga && <Aviso tono="error">{errorCarga}</Aviso>}

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-[13px] font-semibold">Fecha</span>
            <Fecha valor={venta.fecha} />
          </div>
          <div className="flex min-w-72 flex-1 flex-col gap-1.5 text-sm">
            <span className="text-[13px] font-semibold">Cliente</span>
            <span>
              {venta.cliente} · {venta.sucursalCodigo}
            </span>
          </div>
          <SelectorRepartidor
            repartidores={opciones}
            valor={repartidor}
            onCambio={setRepartidor}
            disabled={enviando}
            conOficina={venta.origen === "portal"}
          />
        </div>

        <TablaProductosVenta
          filas={filas}
          captura={captura}
          onCambio={(id, campo, valor) => setCaptura((actual) => conCaptura(actual, id, campo, valor))}
          disabled={enviando}
        />

        <p className="text-right text-base font-semibold">Total: {formatearPesos(totalCentavos)}</p>

        <CamposCondicionesVenta
          valores={condiciones}
          onCambio={(cambio) => setCondiciones((actual) => ({ ...actual, ...cambio }))}
          disabled={enviando}
        />

        {mensajeError && <Aviso tono="error">{mensajeError}</Aviso>}

        <div className="flex gap-2">
          <Button type="submit" disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </Button>
          <Button type="button" variant="outline" disabled={enviando} onClick={onCancelar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Pantalla>
  );
}
```

Reemplazar **todo** `apps/portal/src/components/ventas/tabla-productos-venta.tsx` por:

```tsx
"use client";

import { Entrada } from "@/components/ui/campo";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, Tabla, Td, Th } from "@/components/ui/tabla";
import { leerPiezas, type Captura, type FilaProducto } from "@/lib/ventas";

/** La captura de productos (T-17): cantidad y promoción por presentación, con subtotal en vivo. */
export function TablaProductosVenta({
  filas,
  captura,
  onCambio,
  disabled,
}: {
  filas: FilaProducto[];
  captura: Captura;
  onCambio: (presentacionId: string, campo: "cantidad" | "promocion", valor: string) => void;
  disabled: boolean;
}) {
  return (
    <CajaTabla>
      <Tabla densidad="compacta">
        <thead>
          <tr>
            <Th>Producto</Th>
            <Th alinear="derecha">Precio</Th>
            <Th>Cantidad</Th>
            <Th>Promoción</Th>
            <Th alinear="derecha">Subtotal</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const nombre = `${f.producto} ${f.volumen}`;
            const sinPrecio = f.precioCentavos === null;
            const piezas = leerPiezas(captura[f.presentacionId]?.cantidad ?? "") ?? 0;
            return (
              <tr key={f.presentacionId}>
                <Td>{nombre}</Td>
                <Td alinear="derecha" className="whitespace-nowrap">
                  {sinPrecio ? (
                    <span className="text-muted-foreground">sin precio en la lista</span>
                  ) : (
                    <Monto centavos={f.precioCentavos ?? 0} />
                  )}
                </Td>
                <Td>
                  <Entrada
                    aria-label={`Cantidad de ${nombre}`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="numeric"
                    disabled={f.deshabilitada || disabled}
                    value={captura[f.presentacionId]?.cantidad ?? ""}
                    onChange={(e) => onCambio(f.presentacionId, "cantidad", e.target.value)}
                    className="h-8 w-24"
                  />
                </Td>
                <Td>
                  <Entrada
                    aria-label={`Promoción de ${nombre}`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="numeric"
                    disabled={f.deshabilitada || disabled}
                    value={captura[f.presentacionId]?.promocion ?? ""}
                    onChange={(e) => onCambio(f.presentacionId, "promocion", e.target.value)}
                    className="h-8 w-24"
                  />
                </Td>
                <Td alinear="derecha" className="whitespace-nowrap">
                  {f.deshabilitada || sinPrecio ? "—" : <Monto centavos={piezas * (f.precioCentavos ?? 0)} />}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}
```

- [ ] **Step 4: Correr las pruebas de Ventas y ver que pasan**

Run: `npx --workspace=apps/portal vitest run src/components/ventas`
Expected: PASS (incluida `pantalla-registrar-venta.test.tsx`, que también usa `TablaProductosVenta`).

- [ ] **Step 5: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde; `grep -n "window.confirm" apps/portal/src/components/ventas/*.tsx` no encuentra nada.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/ventas/pantalla-ventas.tsx apps/portal/src/components/ventas/pantalla-ventas.test.tsx \
  apps/portal/src/components/ventas/detalle-venta.tsx apps/portal/src/components/ventas/detalle-venta.test.tsx \
  apps/portal/src/components/ventas/formulario-editar-venta.tsx apps/portal/src/components/ventas/formulario-editar-venta.test.tsx \
  apps/portal/src/components/ventas/tabla-productos-venta.tsx
git commit -m "$(cat <<'EOF'
Portal UI: Ventas con encabezado, filtro común, fechas legibles y ventana de confirmar

Buscar pasa a Mostrar; Eliminar y Marcar como cuenta perdida preguntan en la
ventana común en lugar de window.confirm.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Cobranza (buscar y cobrar al cliente) con las piezas nuevas

**Files:**
- Modify: `apps/portal/src/components/cobranza/pantalla-cobranza.tsx` (archivo completo)
- Modify: `apps/portal/src/components/cobranza/buscar-por-cobrar.tsx` (archivo completo)
- Modify: `apps/portal/src/components/cobranza/cobranza-cliente.tsx` (archivo completo)
- Modify: `apps/portal/src/components/cobranza/registrar-pago.tsx:4,83,211-215,228-232`, `apps/portal/src/components/cobranza/aplicar-saldo-favor.tsx:4,122-126,139-143`
- Test: `pantalla-cobranza.test.tsx`, `buscar-por-cobrar.test.tsx`, `cobranza-cliente.test.tsx`, `registrar-pago.test.tsx` (mismo directorio)

**Interfaces:**
- Consumes: `Aviso`, `EtiquetaStatusVenta`, `Monto`, `Fecha`, `CajaTabla`/`Tabla`/`Th`/`Td`/`TdMonto`/`Fila` (Task 2); `Campo`, `Entrada`, `Casilla` (Task 3); `useConfirmar` (Task 4); `Pantalla`, `EncabezadoPantalla`, `EstadoPantalla` (Task 5); `formatearFecha`, `formatearPesos` (`@/lib/formato`).
- Produces: nada nuevo. Las props de `PantallaCobranza`, `BuscarPorCobrar`, `CobranzaCliente`, `RegistrarPago` y `AplicarSaldoFavor` no cambian.

Cambios visibles a propósito: encabezado con explicación; tablas comunes con montos a la derecha; fechas `dd/mm/aaaa` (también en los abonos anteriores y en el aviso de "la nota más vieja"); status en pastilla; avisos de color; "Marcar como cuenta perdida" pregunta en la ventana; "sin permiso" con el texto común. Los botones "Buscar por fecha" y "Buscar por # de nota" se quedan (no son un rango de fechas).

- [ ] **Step 1: Ajustar las pruebas**

`apps/portal/src/components/cobranza/pantalla-cobranza.test.tsx` — reemplazar **las dos** apariciones (Edit con `replace_all: true`) de:

```tsx
    expect(screen.getByText("No tienes permiso para registrar cobranza")).toBeInTheDocument();
```

por:

```tsx
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
```

y agregar antes del último `});` del archivo:

```tsx

  it("el encabezado dice para qué sirve la pantalla", () => {
    mockAuth(() => true);
    render(<PantallaCobranza sucursal={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Cobranza" })).toBeInTheDocument();
    expect(screen.getByText(/por cliente, por fecha de la venta o por # de nota/)).toBeInTheDocument();
  });
```

`apps/portal/src/components/cobranza/buscar-por-cobrar.test.tsx` — reemplazar:

```tsx
    expect(screen.getByText("$40.00")).toBeInTheDocument();
```

por:

```tsx
    expect(screen.getByText("$40.00")).toBeInTheDocument();
    expect(screen.getByText("01/04/2024")).toBeInTheDocument();
    expect(screen.getByText("Abonado")).toHaveAttribute("data-tono", "informacion");
```

`apps/portal/src/components/cobranza/cobranza-cliente.test.tsx`:

Reemplazar:

```tsx
    expect(screen.getByText("2024-04-03 · $30.00 · Saldo a favor")).toBeInTheDocument();
```

por:

```tsx
    expect(screen.getByText("03/04/2024 · $30.00 · Saldo a favor")).toBeInTheDocument();
```

Reemplazar:

```tsx
    expect(screen.getByText("Abonado")).toBeInTheDocument();
  });
```

por:

```tsx
    expect(screen.getByText("Abonado")).toHaveAttribute("data-tono", "informacion");
    expect(screen.getByText("02/04/2024")).toBeInTheDocument();
  });
```

Reemplazar las dos pruebas:

```tsx
  it("Marcar como cuenta perdida confirma, marca y recarga", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    marcarCuentaPerdida.mockResolvedValue({} as VentaDetalle);
    const { usuario } = renderizar();
    await usuario.click(await screen.findByRole("button", { name: "Marcar TJ240401OF01 como cuenta perdida" }));
    expect(confirmar).toHaveBeenCalledWith("La venta TJ240401OF01 dejará de cobrarse. ¿Continuar?");
    expect(marcarCuentaPerdida).toHaveBeenCalledWith("n1");
    expect(await screen.findByRole("status")).toHaveTextContent("La venta TJ240401OF01 quedó como cuenta perdida.");
    await waitFor(() => expect(porCobrarDeCliente).toHaveBeenCalledTimes(2));
  });

  it("si no confirma, no marca nada", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { usuario } = renderizar();
    await usuario.click(await screen.findByRole("button", { name: "Marcar TJ240401OF01 como cuenta perdida" }));
    expect(marcarCuentaPerdida).not.toHaveBeenCalled();
  });
```

por:

```tsx
  it("Marcar como cuenta perdida pregunta en la ventana, marca y recarga", async () => {
    marcarCuentaPerdida.mockResolvedValue({} as VentaDetalle);
    const { usuario } = renderizar();
    await usuario.click(await screen.findByRole("button", { name: "Marcar TJ240401OF01 como cuenta perdida" }));
    expect(
      screen.getByRole("alertdialog", { name: "¿Marcar la venta TJ240401OF01 como cuenta perdida?" }),
    ).toHaveTextContent("La venta dejará de cobrarse.");
    await usuario.click(screen.getByRole("button", { name: "Marcar como perdida" }));
    expect(marcarCuentaPerdida).toHaveBeenCalledWith("n1");
    expect(await screen.findByRole("status")).toHaveTextContent("La venta TJ240401OF01 quedó como cuenta perdida.");
    await waitFor(() => expect(porCobrarDeCliente).toHaveBeenCalledTimes(2));
  });

  it("si cancela en la ventana, no marca nada", async () => {
    const { usuario } = renderizar();
    await usuario.click(await screen.findByRole("button", { name: "Marcar TJ240401OF01 como cuenta perdida" }));
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(marcarCuentaPerdida).not.toHaveBeenCalled();
  });
```

Reemplazar:

```tsx
    vi.spyOn(window, "confirm").mockReturnValue(true);
    marcarCuentaPerdida.mockResolvedValue({} as VentaDetalle);
    await usuario.click(screen.getByRole("button", { name: "Marcar TJ240402OF01 como cuenta perdida" }));
```

por:

```tsx
    marcarCuentaPerdida.mockResolvedValue({} as VentaDetalle);
    await usuario.click(screen.getByRole("button", { name: "Marcar TJ240402OF01 como cuenta perdida" }));
    await usuario.click(screen.getByRole("button", { name: "Marcar como perdida" }));
```

Reemplazar:

```tsx
    const ETIQUETA = "Pedir borrado del abono del 2024-04-03 por $30.00";
```

por:

```tsx
    const ETIQUETA = "Pedir borrado del abono del 03/04/2024 por $30.00";
```

`apps/portal/src/components/cobranza/registrar-pago.test.tsx` — reemplazar:

```tsx
      "La fecha del pago no puede ser anterior a la nota más vieja que marcaste (2024-04-01).",
```

por:

```tsx
      "La fecha del pago no puede ser anterior a la nota más vieja que marcaste (01/04/2024).",
```

- [ ] **Step 2: Correr las pruebas de Cobranza y ver que fallan**

Run: `npx --workspace=apps/portal vitest run src/components/cobranza`
Expected: FAIL — textos de permiso y fechas viejos, sin `alertdialog`, sin `data-tono`.

- [ ] **Step 3: Reescribir la pantalla, la búsqueda y la cobranza del cliente**

Reemplazar **todo** `apps/portal/src/components/cobranza/pantalla-cobranza.tsx` por:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { BuscarPorCobrar } from "./buscar-por-cobrar";
import { CobranzaCliente } from "./cobranza-cliente";

type Vista = { tipo: "buscar" } | { tipo: "cliente"; clienteId: string; notaId: string | null };

/** Operación → Cobranza (T-21): buscar la cuenta por cobrar y registrar el pago.
 *  Con `clienteInicial` (desde Cuentas por Cobrar, T-22) abre directo ese cliente. */
export function PantallaCobranza({
  sucursal,
  clienteInicial = null,
  notaInicial = null,
}: {
  sucursal: string | null;
  clienteInicial?: string | null;
  notaInicial?: string | null;
}) {
  const router = useRouter();
  const { puede, cargando: cargandoSesion } = useAuth();
  const [vista, setVista] = useState<Vista>(() =>
    clienteInicial
      ? { tipo: "cliente", clienteId: clienteInicial, notaId: notaInicial }
      : { tipo: "buscar" },
  );

  // Mientras /auth/me no contesta, `puede()` da false a todos: sin esto, quien
  // si tiene el permiso ve "No tienes permiso" un instante (como PantallaPerfiles).
  if (cargandoSesion) return <EstadoPantalla titulo="Cobranza" tipo="cargando" />;

  if (!puede("cobranza.registrar")) return <EstadoPantalla titulo="Cobranza" tipo="sin-permiso" />;

  if (vista.tipo === "cliente") {
    return (
      <CobranzaCliente
        clienteId={vista.clienteId}
        notaInicial={vista.notaId}
        onVolver={() => {
          setVista({ tipo: "buscar" });
          // Si venía de Cuentas por Cobrar, ?cliente=&nota= seguiría en la dirección y
          // cambiar de sucursal (o recargar) reabriría al cliente viejo: se quitan.
          if (clienteInicial) {
            router.replace(
              sucursal
                ? `/operacion/cobranza?${new URLSearchParams({ sucursal })}`
                : "/operacion/cobranza",
            );
          }
        }}
      />
    );
  }

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Cobranza"
        descripcion="Busca la cuenta por cobrar por cliente, por fecha de la venta o por # de nota, y registra su pago."
      />
      <BuscarPorCobrar
        sucursal={sucursal}
        onElegir={(clienteId, notaId) => setVista({ tipo: "cliente", clienteId, notaId })}
      />
    </Pantalla>
  );
}
```

Reemplazar **todo** `apps/portal/src/components/cobranza/buscar-por-cobrar.tsx` por:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, Fila, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import { buscarPorCobrar, type NotaPorCobrar } from "@/lib/cobranzas";
import { hoyEnTijuana } from "@/lib/ventas";

/**
 * §3.1: buscar la cuenta por cobrar. Por cliente se entra directo; por fecha de
 * la venta o por # de nota sale una tabla de notas por cobrar de cualquier
 * cliente del alcance, y un clic entra a su cliente con esa nota ya marcada.
 */
export function BuscarPorCobrar({
  sucursal,
  onElegir,
}: {
  sucursal: string | null;
  onElegir: (clienteId: string, notaId: string | null) => void;
}) {
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [fecha, setFecha] = useState(hoyEnTijuana);
  const [numNota, setNumNota] = useState("");
  const [notas, setNotas] = useState<NotaPorCobrar[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cuenta las búsquedas: solo la última puede escribir el resultado.
  const busqueda = useRef(0);

  useEffect(() => {
    // Otra sucursal = otro alcance: los resultados de la anterior ya no valen.
    busqueda.current += 1;
    setNotas(null);
    setError(null);
    setBuscando(false);
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => {
        if (vigente) setClientes(lista);
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar los clientes.");
      });
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  async function buscar(filtro: { fecha: string } | { numNota: string }) {
    const mia = ++busqueda.current;
    setBuscando(true);
    setError(null);
    try {
      const lista = await buscarPorCobrar(filtro, sucursal);
      if (mia === busqueda.current) setNotas(lista);
    } catch (err) {
      if (mia !== busqueda.current) return;
      setNotas(null);
      setError(mensajeDe(err, "No se pudieron buscar las notas por cobrar."));
    } finally {
      if (mia === busqueda.current) setBuscando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-[10px] border p-3.5">
        <BuscadorCliente clientes={clientes} cliente={null} onElegir={(c) => onElegir(c.id, null)} onQuitar={() => {}} />

        <div className="flex flex-wrap items-end gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void buscar({ fecha });
            }}
            className="flex items-end gap-2"
          >
            <Campo id="cobranza-fecha" etiqueta="Fecha de la venta">
              <Entrada type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Campo>
            <Button type="submit" variant="outline" disabled={buscando}>
              Buscar por fecha
            </Button>
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (numNota.trim() !== "") void buscar({ numNota });
            }}
            className="flex items-end gap-2"
          >
            <Campo id="cobranza-num-nota" etiqueta="# de nota">
              <Entrada maxLength={30} value={numNota} onChange={(e) => setNumNota(e.target.value)} className="w-40" />
            </Campo>
            <Button type="submit" variant="outline" disabled={buscando || numNota.trim() === ""}>
              Buscar por # de nota
            </Button>
          </form>
        </div>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      {notas !== null &&
        (notas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay notas por cobrar con esa búsqueda.</p>
        ) : (
          <CajaTabla>
            <Tabla className="min-w-[860px]">
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Fecha</Th>
                  <Th>Folio</Th>
                  <Th># de nota</Th>
                  <Th alinear="derecha">Total</Th>
                  <Th alinear="derecha">Saldo</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => (
                  <Fila key={n.id} interactiva>
                    <Td>
                      {n.cliente} · {n.sucursalCodigo}
                    </Td>
                    <Td>
                      <Fecha valor={n.fecha} />
                    </Td>
                    <Td className="font-mono">{n.folio}</Td>
                    <Td>{n.numNota ?? "—"}</Td>
                    <TdMonto centavos={n.montoCentavos} />
                    <TdMonto centavos={n.saldoCentavos} className="font-semibold" />
                    <Td>
                      <EtiquetaStatusVenta status={n.status} />
                    </Td>
                    <Td alinear="derecha">
                      <Button
                        type="button"
                        size="sm"
                        aria-label={`Cobrar ${n.folio}`}
                        onClick={() => onElegir(n.clienteId, n.id)}
                      >
                        Cobrar
                      </Button>
                    </Td>
                  </Fila>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        ))}
    </div>
  );
}
```

Reemplazar **todo** `apps/portal/src/components/cobranza/cobranza-cliente.tsx` por:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PedirBorradoCobro } from "@/components/peticiones/pedir-borrado-cobro";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Casilla } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, Fila, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { ETIQUETA_METODO_PAGO, porCobrarDeCliente, type ClientePorCobrar } from "@/lib/cobranzas";
import { formatearFecha, formatearPesos } from "@/lib/formato";
import { ETIQUETA_BORRADO_PEDIDO } from "@/lib/peticiones";
import { marcarCuentaPerdida } from "@/lib/ventas";
import { AplicarSaldoFavor } from "./aplicar-saldo-favor";
import { RegistrarPago } from "./registrar-pago";

/** El aviso de arriba: salió bien (verde) o la pantalla quedó vieja y se recargó (ámbar). */
type AvisoCobranza = { texto: string; tono: "exito" | "advertencia" };

/**
 * §3.2: las notas por cobrar de un cliente, de la más vieja a la más nueva,
 * para marcar las que paga. El reparto lo calcula el servidor (vista previa) y
 * lo vuelve a decidir al grabar, con las notas bloqueadas: aquí solo se arma la
 * selección.
 */
export function CobranzaCliente({
  clienteId,
  notaInicial,
  onVolver,
}: {
  clienteId: string;
  notaInicial: string | null;
  onVolver: () => void;
}) {
  const { puede } = useAuth();
  const { confirmar, ventana } = useConfirmar();
  const [datos, setDatos] = useState<ClientePorCobrar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set(notaInicial ? [notaInicial] : []));
  const [aviso, setAviso] = useState<AvisoCobranza | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [marcando, setMarcando] = useState(false);
  // Sube con cada carga buena: los paneles de pago se remontan y sus vistas previas viejas desaparecen.
  const [version, setVersion] = useState(0);
  // El pago cuyo borrado se está pidiendo (T-34); uno a la vez. Toda recarga lo cierra.
  const [pidiendo, setPidiendo] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    porCobrarDeCliente(clienteId)
      .then((d) => {
        if (!vigente) return;
        setDatos(d);
        setVersion((v) => v + 1);
        setError(null);
        // Una nota que ya no está por cobrar (la pagó alguien) se desmarca sola.
        setSeleccion((actual) => new Set([...actual].filter((id) => d.notas.some((n) => n.id === id))));
      })
      .catch((err) => {
        if (!vigente) return;
        // Sin datos frescos no se muestra la tabla vieja ni el formulario de pago:
        // nadie debe cobrar sobre saldos que quizá ya cambiaron.
        setDatos(null);
        setError(mensajeDe(err, "No se pudo cargar la cobranza del cliente."));
      });
    return () => {
      vigente = false;
    };
  }, [clienteId, recarga]);

  const recargar = useCallback((texto: string, tono: AvisoCobranza["tono"] = "exito") => {
    setAviso({ texto, tono });
    setPidiendo(null);
    setRecarga((n) => n + 1);
  }, []);

  /** El 409 de "ya cambió": se recarga y el mensaje del servidor queda a la vista, en ámbar. */
  const recargarDesactualizado = useCallback((texto: string) => recargar(texto, "advertencia"), [recargar]);

  function alternar(id: string) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  async function marcarPerdida(id: string, folio: string) {
    const si = await confirmar({
      titulo: `¿Marcar la venta ${folio} como cuenta perdida?`,
      descripcion: "La venta dejará de cobrarse.",
      confirmar: "Marcar como perdida",
    });
    if (!si) return;
    setMarcando(true);
    setError(null);
    try {
      await marcarCuentaPerdida(id);
      setSeleccion((actual) => new Set([...actual].filter((x) => x !== id)));
      recargar(`La venta ${folio} quedó como cuenta perdida.`);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo marcar como cuenta perdida."));
    } finally {
      setMarcando(false);
    }
  }

  const palomeadas = datos ? datos.notas.filter((n) => seleccion.has(n.id)) : [];
  const puedePerdida = puede("venta.editar_eliminar");
  const puedePedirBorrado = puede("cobranza.editar_eliminar");

  function pedirBorrado(cobroId: string | null) {
    if (cobroId === null) return;
    setAviso(null);
    setPidiendo(cobroId);
  }

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo={datos ? `Cobranza · ${datos.nombre}` : "Cobranza"}
        descripcion="Marca las notas que paga el cliente, revisa la vista previa y graba el pago."
        acciones={
          <Button type="button" variant="outline" onClick={onVolver}>
            ← Volver a buscar
          </Button>
        }
      />

      {datos && datos.saldoFavorCentavos > 0 && (
        <p className="text-sm">
          Saldo a favor: <Monto centavos={datos.saldoFavorCentavos} className="font-semibold" />
        </p>
      )}

      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      {datos &&
        (datos.notas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este cliente no tiene notas por cobrar.</p>
        ) : (
          <CajaTabla>
            <Tabla className="min-w-[980px]">
              <thead>
                <tr>
                  <Th>
                    <span className="sr-only">Marcar</span>
                  </Th>
                  <Th>Fecha</Th>
                  <Th>Folio</Th>
                  <Th># de nota</Th>
                  <Th alinear="derecha">Total</Th>
                  <Th alinear="derecha">Saldo</Th>
                  <Th>Status</Th>
                  <Th>Abonos anteriores</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {datos.notas.map((n) => (
                  <Fila key={n.id} interactiva className="align-top">
                    <Td>
                      <Casilla
                        aria-label={`Marcar ${n.folio}`}
                        checked={seleccion.has(n.id)}
                        onChange={() => alternar(n.id)}
                      />
                    </Td>
                    <Td>
                      <Fecha valor={n.fecha} />
                    </Td>
                    <Td className="font-mono">{n.folio}</Td>
                    <Td>{n.numNota ?? "—"}</Td>
                    <TdMonto centavos={n.montoCentavos} />
                    <TdMonto centavos={n.saldoCentavos} className="font-semibold" />
                    <Td>
                      <EtiquetaStatusVenta status={n.status} />
                    </Td>
                    <Td>
                      {n.abonos.length === 0 ? (
                        "—"
                      ) : (
                        <details>
                          <summary className="cursor-pointer">
                            {n.abonos.length} {n.abonos.length === 1 ? "abono" : "abonos"}
                          </summary>
                          <ul>
                            {n.abonos.map((a, i) => (
                              <li key={`${a.fechaPago}-${i}`}>
                                {`${formatearFecha(a.fechaPago)} · ${formatearPesos(a.montoCentavos)} · ${ETIQUETA_METODO_PAGO[a.metodoPago] ?? a.metodoPago}`}
                                {a.cobroId !== null && a.peticionPendiente && (
                                  <span className="ml-2 text-muted-foreground">{ETIQUETA_BORRADO_PEDIDO}</span>
                                )}
                                {a.cobroId !== null && !a.peticionPendiente && puedePedirBorrado && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="ml-2"
                                    aria-label={`Pedir borrado del abono del ${formatearFecha(a.fechaPago)} por ${formatearPesos(a.montoCentavos)}`}
                                    disabled={pidiendo !== null}
                                    onClick={() => pedirBorrado(a.cobroId)}
                                  >
                                    Pedir borrado
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </Td>
                    <Td alinear="derecha">
                      {puedePerdida && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          aria-label={`Marcar ${n.folio} como cuenta perdida`}
                          disabled={marcando}
                          onClick={() => void marcarPerdida(n.id, n.folio)}
                        >
                          Marcar como cuenta perdida
                        </Button>
                      )}
                    </Td>
                  </Fila>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        ))}

      {pidiendo && (
        <PedirBorradoCobro
          key={pidiendo}
          cobroId={pidiendo}
          onEnviada={recargar}
          onDesactualizado={recargarDesactualizado}
          onCancelar={() => setPidiendo(null)}
        />
      )}

      {datos && palomeadas.length > 0 && (
        <RegistrarPago
          key={version}
          cliente={datos}
          palomeadas={palomeadas}
          onRegistrado={recargar}
          onDesactualizado={recargarDesactualizado}
        />
      )}

      {datos && datos.saldoFavorCentavos > 0 && palomeadas.length > 0 && (
        <AplicarSaldoFavor
          key={`${version}|${palomeadas.map((n) => n.id).join(",")}|${datos.saldoFavorCentavos}`}
          cliente={datos}
          palomeadas={palomeadas}
          onAplicado={recargar}
          onDesactualizado={recargarDesactualizado}
        />
      )}

      {ventana}
    </Pantalla>
  );
}
```

- [ ] **Step 4: Avisos de color y fecha legible en Registrar pago y Aplicar saldo a favor**

`apps/portal/src/components/cobranza/registrar-pago.tsx` — reemplazar:

```tsx
import { Button } from "@/components/ui/button";
```

por:

```tsx
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { formatearFecha } from "@/lib/formato";
```

reemplazar:

```tsx
      return `La fecha del pago no puede ser anterior a la nota más vieja que marcaste (${masVieja}).`;
```

por:

```tsx
      return `La fecha del pago no puede ser anterior a la nota más vieja que marcaste (${formatearFecha(masVieja)}).`;
```

reemplazar:

```tsx
      {avisoLocal && (
        <p role="alert" className="text-sm text-destructive">
          {avisoLocal}
        </p>
      )}
```

por:

```tsx
      {avisoLocal && <Aviso tono="error">{avisoLocal}</Aviso>}
```

y reemplazar:

```tsx
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
```

por:

```tsx
      {error && <Aviso tono="error">{error}</Aviso>}
```

`apps/portal/src/components/cobranza/aplicar-saldo-favor.tsx` — reemplazar:

```tsx
import { Button } from "@/components/ui/button";
```

por:

```tsx
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
```

y hacer los mismos dos reemplazos de `avisoLocal` y `error` que en `registrar-pago.tsx` (los bloques son idénticos).

- [ ] **Step 5: Correr las pruebas de Cobranza y ver que pasan**

Run: `npx --workspace=apps/portal vitest run src/components/cobranza`
Expected: PASS.

- [ ] **Step 6: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde; `grep -n "window.confirm" apps/portal/src/components/cobranza/*.tsx` no encuentra nada.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/components/cobranza/
git commit -m "$(cat <<'EOF'
Portal UI: Cobranza con tablas comunes, fechas legibles, avisos de color y ventana de confirmar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Facturas (asignar y buscar) con pestañas comunes

**Files:**
- Modify: `apps/portal/src/components/facturas/pantalla-facturas.tsx` (archivo completo)
- Modify: `apps/portal/src/components/facturas/asignar-factura.tsx` (archivo completo)
- Modify: `apps/portal/src/components/facturas/buscar-facturas.tsx` (archivo completo)
- Test: `apps/portal/src/components/facturas/pantalla-facturas.test.tsx` (archivo completo), `buscar-facturas.test.tsx` (archivo completo), `asignar-factura.test.tsx` (dos cambios)

**Interfaces:**
- Consumes: `Aviso`, `EtiquetaStatusVenta`, `Fecha`, `CajaTabla`/`Tabla`/`Th`/`Td`/`TdMonto`/`Fila` (Task 2); `Campo`, `Entrada`, `Casilla`, `Pestanas` (Task 3); `useConfirmar` (Task 4); `Pantalla`, `EncabezadoPantalla`, `EstadoPantalla` (Task 5); `formatearFechaHora`, `formatearPesos`, `plural` (`@/lib/formato`).
- Produces: nada nuevo. Las props de `PantallaFacturas`, `AsignarFactura` y `BuscarFacturas` no cambian.

Cambios visibles a propósito: las pestañas hechas a mano pasan a `Pestanas` (con `conservarMontadas`: cambiar de pestaña no borra lo marcado); "sin permiso" se decide una vez arriba con `EstadoPantalla` (los paneles conservan su propia guarda, con el texto común); fechas legibles (también "registró Ana el 07/10/2026 10:00"); quitar ventas pregunta en la ventana común.

- [ ] **Step 1: Ajustar las pruebas**

Reemplazar **todo** `apps/portal/src/components/facturas/pantalla-facturas.test.tsx` por:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as clientesLib from "@/lib/clientes";
import * as facturasLib from "@/lib/facturas";
import { PantallaFacturas } from "./pantalla-facturas";

vi.mock("@/lib/clientes");
vi.mock("@/lib/facturas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/facturas")>();
  return { ...real, listarPorFacturar: vi.fn(), buscarFacturas: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

/** El panel que controla una pestaña (base-ui genera los ids). */
function panelDe(pestana: HTMLElement): HTMLElement | null {
  return document.getElementById(pestana.getAttribute("aria-controls") ?? "");
}

describe("PantallaFacturas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([
      { id: "c1", nombre: "Cobach XXI", telefono: "664", tipo: "cliente", tipoNegocio: null, sucursalCodigo: "TJ" },
    ]);
    vi.mocked(facturasLib.listarPorFacturar).mockResolvedValue([
      { id: "v1", folio: "TJ240401OF01", fecha: "2024-04-01", numNota: null, montoCentavos: 10000, status: "pendiente", factura: "pendiente" },
    ]);
  });

  it("encabezado con su explicación, y pestañas ligadas a sus paneles con ARIA", () => {
    render(<PantallaFacturas sucursal={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Facturas" })).toBeInTheDocument();
    expect(screen.getByText(/factura del SAT/)).toBeInTheDocument();
    const asignar = screen.getByRole("tab", { name: "Asignar" });
    const buscar = screen.getByRole("tab", { name: "Buscar y corregir" });
    expect(asignar).toHaveAttribute("aria-selected", "true");
    expect(asignar).toHaveAttribute("tabindex", "0");
    expect(buscar).toHaveAttribute("tabindex", "-1");
    expect(panelDe(asignar)).toHaveAttribute("role", "tabpanel");
    expect(panelDe(asignar)).toHaveAttribute("aria-labelledby", asignar.id);
    expect(panelDe(buscar)).toHaveAttribute("aria-labelledby", buscar.id);
    expect(panelDe(buscar)).toHaveAttribute("hidden");
  });

  it("las flechas cambian de pestaña", async () => {
    const usuario = userEvent.setup();
    render(<PantallaFacturas sucursal={null} />);
    screen.getByRole("tab", { name: "Asignar" }).focus();
    await usuario.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Buscar y corregir" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Buscar y corregir" })).toHaveFocus();
    await usuario.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Asignar" })).toHaveAttribute("aria-selected", "true");
  });

  it("cambiar de pestaña no pierde las ventas marcadas", async () => {
    const usuario = userEvent.setup();
    render(<PantallaFacturas sucursal={null} />);
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    await usuario.click(await screen.findByLabelText("Marcar TJ240401OF01"));
    await waitFor(() => expect(screen.getByLabelText("Marcar TJ240401OF01")).toBeChecked());
    const asignar = screen.getByRole("tab", { name: "Asignar" });
    await usuario.click(screen.getByRole("tab", { name: "Buscar y corregir" }));
    expect(panelDe(asignar)).toHaveAttribute("hidden"); // oculto, no desmontado
    await usuario.click(asignar);
    expect(screen.getByLabelText("Marcar TJ240401OF01")).toBeChecked();
  });

  it("mientras carga la sesión dice Cargando…; sin el permiso lo dice, sin pestañas ni pedir nada", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    const { unmount } = render(<PantallaFacturas sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
    unmount();

    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaFacturas sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(clientesLib.listarClientes).not.toHaveBeenCalled();
  });
});
```

Reemplazar **todo** `apps/portal/src/components/facturas/buscar-facturas.test.tsx` por:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import * as facturasLib from "@/lib/facturas";
import type { FacturaConVentas } from "@/lib/facturas";
import { BuscarFacturas } from "./buscar-facturas";

vi.mock("@/lib/clientes");
vi.mock("@/lib/facturas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/facturas")>();
  return { ...real, buscarFacturas: vi.fn(), renombrarFactura: vi.fn(), quitarDeFactura: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const buscarFacturas = vi.mocked(facturasLib.buscarFacturas);
const renombrarFactura = vi.mocked(facturasLib.renombrarFactura);
const quitarDeFactura = vi.mocked(facturasLib.quitarDeFactura);

const FACTURA: FacturaConVentas = {
  id: "f1", numero: "A708", clienteId: "c1", cliente: "Cobach XXI", sucursalCodigo: "TJ",
  creadoPor: "Ana", creadoEn: "2026-10-07 10:00", totalCentavos: 15050,
  ventas: [
    { id: "v1", folio: "TJ240401OF01", fecha: "2024-04-01", numNota: null, montoCentavos: 10000, status: "pendiente" },
    { id: "v2", folio: "TJ240402OF01", fecha: "2024-04-02", numNota: null, montoCentavos: 5050, status: "pendiente" },
  ],
};

async function buscarA708() {
  const usuario = userEvent.setup();
  render(<BuscarFacturas sucursal={null} />);
  await usuario.type(screen.getByLabelText("Número de factura a buscar"), "a708");
  await usuario.click(screen.getByRole("button", { name: "Buscar" }));
  await screen.findByText("Factura A708");
  return usuario;
}

/** "Quitar de la factura" abre la ventana; "Quitar ventas" confirma. */
async function quitarYConfirmar(usuario: ReturnType<typeof userEvent.setup>, dentroDe?: HTMLElement) {
  const lugar = dentroDe ? within(dentroDe) : screen;
  await usuario.click(lugar.getByRole("button", { name: "Quitar de la factura" }));
  await usuario.click(screen.getByRole("button", { name: "Quitar ventas" }));
}

describe("BuscarFacturas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([]);
    buscarFacturas.mockResolvedValue([FACTURA]);
  });

  it("busca por número y muestra cliente, cuándo se registró, ventas y total", async () => {
    await buscarA708();
    expect(buscarFacturas).toHaveBeenCalledWith({ numero: "a708", clienteId: undefined, sucursal: null });
    const tarjeta = screen.getByRole("region", { name: "Factura A708" });
    expect(within(tarjeta).getByText(/Cobach XXI/)).toBeInTheDocument();
    expect(within(tarjeta).getByText(/el 07\/10\/2026 10:00/)).toBeInTheDocument();
    expect(within(tarjeta).getByText("01/04/2024")).toBeInTheDocument();
    expect(within(tarjeta).getByText("Total: $150.50")).toBeInTheDocument();
  });

  it("cambia el número", async () => {
    renombrarFactura.mockResolvedValue({ ...FACTURA, numero: "A780" });
    const usuario = await buscarA708();
    const campo = screen.getByLabelText("Nuevo número de A708");
    await usuario.clear(campo);
    await usuario.type(campo, "A780");
    await usuario.click(screen.getByRole("button", { name: "Guardar número" }));
    expect(renombrarFactura).toHaveBeenCalledWith("f1", "A780");
    expect(await screen.findByText("Factura A780")).toBeInTheDocument();
  });

  it("quita ventas después de confirmar en la ventana", async () => {
    quitarDeFactura.mockResolvedValue({ factura: { ...FACTURA, ventas: [FACTURA.ventas[1]], totalCentavos: 5050 } });
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await quitarYConfirmar(usuario);
    expect(quitarDeFactura).toHaveBeenCalledWith("f1", ["v1"]);
    expect(await screen.findByText("Total: $50.50")).toBeInTheDocument();
  });

  it("si se quitan todas, la ventana lo advierte, la factura desaparece y se avisa", async () => {
    quitarDeFactura.mockResolvedValue({ factura: null });
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByLabelText("Quitar TJ240402OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    const ventana = screen.getByRole("alertdialog", { name: "¿Quitar todas las ventas de la factura A708?" });
    expect(ventana).toHaveTextContent("la factura A708 desaparece");
    await usuario.click(screen.getByRole("button", { name: "Quitar ventas" }));
    expect(await screen.findByRole("status")).toHaveTextContent("La factura A708 se borró: ya no tenía ventas.");
    expect(screen.queryByText("Factura A708")).not.toBeInTheDocument();
    expect(screen.queryByText("No se encontraron facturas.")).not.toBeInTheDocument();
  });

  it("muestra el mensaje del servidor al renombrar", async () => {
    renombrarFactura.mockRejectedValue(new ErrorApi("x", 409, "La factura A780 ya está asignada a Otra."));
    const usuario = await buscarA708();
    const campo = screen.getByLabelText("Nuevo número de A708");
    await usuario.clear(campo);
    await usuario.type(campo, "A780");
    await usuario.click(screen.getByRole("button", { name: "Guardar número" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La factura A780 ya está asignada a Otra.");
  });

  it("sin resultados lo dice", async () => {
    buscarFacturas.mockResolvedValue([]);
    const usuario = userEvent.setup();
    render(<BuscarFacturas sucursal={null} />);
    await usuario.type(screen.getByLabelText("Número de factura a buscar"), "Z1");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("No se encontraron facturas.")).toBeInTheDocument();
  });

  it("mientras carga la sesión dice Cargando…, no \"No tienes permiso\"", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<BuscarFacturas sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin el permiso muestra el texto y no pide clientes", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => false });
    render(<BuscarFacturas sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(clientesLib.listarClientes).not.toHaveBeenCalled();
  });

  it("buscar sin número ni cliente muestra el error de validación", async () => {
    const usuario = userEvent.setup();
    render(<BuscarFacturas sucursal={null} />);
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe un número de factura o elige un cliente.");
    expect(buscarFacturas).not.toHaveBeenCalled();
  });

  it("buscar por cliente llama con clienteId", async () => {
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([
      { id: "c1", nombre: "Cobach XXI", telefono: "664", tipo: "cliente", tipoNegocio: null, sucursalCodigo: "TJ" },
    ]);
    const usuario = userEvent.setup();
    render(<BuscarFacturas sucursal="TJ" />);
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Factura A708");
    expect(buscarFacturas).toHaveBeenCalledWith({ numero: undefined, clienteId: "c1", sucursal: "TJ" });
  });

  it("cancelar en la ventana no quita nada", async () => {
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(quitarDeFactura).not.toHaveBeenCalled();
  });

  it("la ventana de quitar solo algunas lo dice", async () => {
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    const ventana = screen.getByRole("alertdialog", { name: "¿Quitar 1 venta de la factura A708?" });
    expect(ventana).toHaveTextContent('Regresan a "pendiente".');
  });

  it("un error al quitar se ve dentro de la tarjeta", async () => {
    quitarDeFactura.mockRejectedValue(new ErrorApi("x", 409, "La venta ya tiene cobros."));
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await quitarYConfirmar(usuario);
    const tarjeta = screen.getByRole("region", { name: "Factura A708" });
    expect(await within(tarjeta).findByRole("alert")).toHaveTextContent("La venta ya tiene cobros.");
  });

  it("el error al renombrar queda en su tarjeta, no arriba", async () => {
    renombrarFactura.mockRejectedValue(new ErrorApi("x", 409, "Repetida."));
    const usuario = await buscarA708();
    const campo = screen.getByLabelText("Nuevo número de A708");
    await usuario.clear(campo);
    await usuario.type(campo, "A780");
    await usuario.click(screen.getByRole("button", { name: "Guardar número" }));
    const tarjeta = screen.getByRole("region", { name: "Factura A708" });
    expect(await within(tarjeta).findByRole("alert")).toHaveTextContent("Repetida.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("el aviso de borrada se limpia al buscar de nuevo", async () => {
    quitarDeFactura.mockResolvedValue({ factura: null });
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByLabelText("Quitar TJ240402OF01"));
    await quitarYConfirmar(usuario);
    await screen.findByRole("status");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Factura A708");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("el aviso de borrada se limpia al actuar en otra tarjeta", async () => {
    const OTRA: FacturaConVentas = {
      ...FACTURA,
      id: "f2",
      numero: "B1",
      ventas: [{ ...FACTURA.ventas[0], id: "v9", folio: "TJ240409OF01" }],
    };
    buscarFacturas.mockResolvedValue([FACTURA, OTRA]);
    quitarDeFactura.mockResolvedValueOnce({ factura: null }).mockRejectedValueOnce(new ErrorApi("x", 409, "Nope."));
    const usuario = await buscarA708();
    const a = screen.getByRole("region", { name: "Factura A708" });
    await usuario.click(within(a).getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(within(a).getByLabelText("Quitar TJ240402OF01"));
    await quitarYConfirmar(usuario, a);
    await screen.findByRole("status");
    const b = screen.getByRole("region", { name: "Factura B1" });
    await usuario.click(within(b).getByLabelText("Quitar TJ240409OF01"));
    await quitarYConfirmar(usuario, b);
    await within(b).findByRole("alert");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("si responden las búsquedas en desorden, gana la última", async () => {
    const resolvers: ((f: FacturaConVentas[]) => void)[] = [];
    buscarFacturas.mockImplementation(() => new Promise((r) => resolvers.push(r)));
    const usuario = userEvent.setup();
    render(<BuscarFacturas sucursal={null} />);
    await usuario.type(screen.getByLabelText("Número de factura a buscar"), "A");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    await usuario.type(screen.getByLabelText("Número de factura a buscar"), "B");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    // La segunda responde primero; la primera llega tarde y se ignora.
    resolvers[1]([{ ...FACTURA, id: "f2", numero: "AB" }]);
    expect(await screen.findByText("Factura AB")).toBeInTheDocument();
    await act(async () => {
      resolvers[0]([FACTURA]);
    });
    expect(screen.getByText("Factura AB")).toBeInTheDocument();
    expect(screen.queryByText("Factura A708")).not.toBeInTheDocument();
  });

  it("una búsqueda en vuelo no pisa el error de validación posterior", async () => {
    let resolver: (f: FacturaConVentas[]) => void = () => {};
    buscarFacturas.mockImplementation(() => new Promise((r) => (resolver = r)));
    const usuario = userEvent.setup();
    render(<BuscarFacturas sucursal={null} />);
    const campo = screen.getByLabelText("Número de factura a buscar");
    await usuario.type(campo, "A");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    await usuario.clear(campo);
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe un número de factura");
    await act(async () => {
      resolver([FACTURA]);
    });
    expect(screen.queryByText("Factura A708")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
```

En `apps/portal/src/components/facturas/asignar-factura.test.tsx`, reemplazar:

```tsx
    expect(screen.getByText("No tienes permiso para asignar facturas.")).toBeInTheDocument();
```

por:

```tsx
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
```

y reemplazar:

```tsx
    expect(listarPorFacturar).toHaveBeenCalledWith("c1", false);
```

por:

```tsx
    expect(listarPorFacturar).toHaveBeenCalledWith("c1", false);
    expect(screen.getByText("01/04/2024")).toBeInTheDocument();
    expect(screen.getByText("Abonado")).toHaveAttribute("data-tono", "informacion");
```

- [ ] **Step 2: Correr las pruebas de Facturas y ver que fallan**

Run: `npx --workspace=apps/portal vitest run src/components/facturas`
Expected: FAIL — sin encabezado, sin `alertdialog`, textos de permiso y fechas viejos.

- [ ] **Step 3: Reescribir las tres piezas de Facturas**

Reemplazar **todo** `apps/portal/src/components/facturas/pantalla-facturas.tsx` por:

```tsx
"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Pestanas } from "@/components/ui/pestanas";
import { AsignarFactura } from "./asignar-factura";
import { BuscarFacturas } from "./buscar-facturas";

/** Operación → Facturas (T-19): asignar, y buscar y corregir. */
export function PantallaFacturas({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando } = useAuth();

  // Sin esto, quien si tiene el permiso ve "No tienes permiso" un instante.
  if (cargando) return <EstadoPantalla titulo="Facturas" tipo="cargando" />;
  if (!puede("venta.asignar_factura")) return <EstadoPantalla titulo="Facturas" tipo="sin-permiso" />;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Facturas"
        descripcion="Anota el número de la factura del SAT en las ventas de un cliente, o corrige una factura ya anotada."
      />
      {/* conservarMontadas: cambiar de pestaña no debe borrar lo marcado. */}
      <Pestanas
        etiqueta="Facturas"
        conservarMontadas
        pestanas={[
          { valor: "asignar", etiqueta: "Asignar", contenido: <AsignarFactura sucursal={sucursal} /> },
          { valor: "buscar", etiqueta: "Buscar y corregir", contenido: <BuscarFacturas sucursal={sucursal} /> },
        ]}
      />
    </Pantalla>
  );
}
```

Reemplazar **todo** `apps/portal/src/components/facturas/asignar-factura.tsx` por:

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Casilla, Entrada } from "@/components/ui/campo";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, Fila, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  LARGO_MAX_NUMERO_FACTURA,
  asignarFactura,
  listarPorFacturar,
  totalSeleccionado,
  type VentaPorFacturar,
} from "@/lib/facturas";
import { formatearPesos, plural } from "@/lib/formato";

/**
 * Asignar factura a notas de ventas (T-19, §5.1 del spec): cliente → marcar
 * ventas → teclear el número del SAT. El servidor decide si se puede; aquí solo
 * se arma la selección.
 */
export function AsignarFactura({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [incluirNA, setIncluirNA] = useState(false);
  const [ventas, setVentas] = useState<VentaPorFacturar[]>([]);
  const [cargada, setCargada] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [numero, setNumero] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo asignar la factura.");

  const permitido = puede("venta.asignar_factura");

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => vigente && setClientes(lista))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [sucursal, permitido]);

  useEffect(() => {
    if (!cliente) return;
    let vigente = true;
    setCargada(false);
    setErrorCarga(null);
    listarPorFacturar(cliente.id, incluirNA)
      .then((lista) => {
        if (!vigente) return;
        setVentas(lista);
        setSeleccion(new Set());
        setCargada(true);
      })
      .catch((err) => {
        if (!vigente) return;
        // Un fallo de carga no es "sin ventas": se limpia la lista y se avisa.
        setVentas([]);
        setSeleccion(new Set());
        setErrorCarga(mensajeDe(err, "No se pudo cargar la lista de ventas por facturar."));
        setCargada(true);
      });
    return () => {
      vigente = false;
    };
  }, [cliente, incluirNA, recarga]);

  // Sin esto, quien si tiene el permiso ve "No tienes permiso" un instante.
  if (cargandoSesion) return <EstadoPantalla tipo="cargando" />;
  if (!permitido) return <EstadoPantalla tipo="sin-permiso" />;

  const total = totalSeleccionado(ventas, seleccion);
  // Mientras recarga la lista es la anterior: no se deja marcar filas viejas.
  const bloqueada = enviando || !cargada;
  const todas = ventas.length > 0 && seleccion.size === ventas.length;

  function alternar(id: string) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!cliente) return;
    const ids = ventas.filter((v) => seleccion.has(v.id)).map((v) => v.id);
    await enviar(
      async () => {
        setAviso(null);
        const factura = await asignarFactura(cliente.id, numero.trim(), ids);
        setAviso(`Factura ${factura.numero} asignada a ${plural(ids.length, "venta", "ventas")} (${formatearPesos(total)})`);
        setNumero("");
        setRecarga((n) => n + 1);
      },
      () => {},
    );
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <BuscadorCliente
        clientes={clientes}
        cliente={cliente}
        onElegir={(c) => {
          setCliente(c);
          setAviso(null);
        }}
        onQuitar={() => {
          setCliente(null);
          setAviso(null);
          setVentas([]);
          setSeleccion(new Set());
        }}
        disabled={enviando}
      />

      {aviso && <Aviso tono="exito">{aviso}</Aviso>}

      {cliente && (
        <>
          <Casilla
            etiqueta="Mostrar también las N/A"
            checked={incluirNA}
            onChange={(e) => setIncluirNA(e.target.checked)}
            disabled={enviando}
          />

          {errorCarga ? (
            <Aviso tono="error">{errorCarga}</Aviso>
          ) : cargada && ventas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este cliente no tiene ventas por facturar.</p>
          ) : (
            <CajaTabla>
              <Tabla className="min-w-[720px]">
                <thead>
                  <tr>
                    <Th>
                      <Casilla
                        aria-label="Seleccionar todas"
                        checked={todas}
                        onChange={() => setSeleccion(todas ? new Set() : new Set(ventas.map((v) => v.id)))}
                        disabled={bloqueada}
                      />
                    </Th>
                    <Th>Fecha</Th>
                    <Th>Folio</Th>
                    <Th># de nota</Th>
                    <Th alinear="derecha">Monto</Th>
                    <Th>Status</Th>
                    <Th>Factura</Th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.map((v) => (
                    <Fila key={v.id} interactiva>
                      <Td>
                        <Casilla
                          aria-label={`Marcar ${v.folio}`}
                          checked={seleccion.has(v.id)}
                          onChange={() => alternar(v.id)}
                          disabled={bloqueada}
                        />
                      </Td>
                      <Td>
                        <Fecha valor={v.fecha} />
                      </Td>
                      <Td className="font-mono">{v.folio}</Td>
                      <Td>{v.numNota ?? "—"}</Td>
                      <TdMonto centavos={v.montoCentavos} />
                      <Td>
                        <EtiquetaStatusVenta status={v.status} />
                      </Td>
                      <Td>{v.factura}</Td>
                    </Fila>
                  ))}
                </tbody>
              </Tabla>
            </CajaTabla>
          )}

          <p className="text-right text-base font-semibold">Total marcado: {formatearPesos(total)}</p>

          <div className="flex flex-wrap items-end gap-3">
            <Campo id="numero-factura" etiqueta="Número de factura">
              <Entrada
                maxLength={LARGO_MAX_NUMERO_FACTURA}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                disabled={enviando}
                className="w-48"
              />
            </Campo>
            <Button type="submit" disabled={enviando || seleccion.size === 0 || numero.trim() === ""}>
              {enviando ? "Asignando…" : "Asignar"}
            </Button>
          </div>
        </>
      )}

      {error && <Aviso tono="error">{error}</Aviso>}
    </form>
  );
}
```

Reemplazar **todo** `apps/portal/src/components/facturas/buscar-facturas.tsx` por:

```tsx
"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Casilla, Entrada } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  LARGO_MAX_NUMERO_FACTURA,
  buscarFacturas,
  quitarDeFactura,
  renombrarFactura,
  type FacturaConVentas,
} from "@/lib/facturas";
import { formatearFechaHora, formatearPesos, plural } from "@/lib/formato";

/** Buscar facturas por número o cliente, cambiar su número o quitarle ventas (T-19, §5.2). */
export function BuscarFacturas({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [numero, setNumero] = useState("");
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [facturas, setFacturas] = useState<FacturaConVentas[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Cada búsqueda lleva un número: si responde una vieja después de una nueva, se ignora.
  const busqueda = useRef(0);
  // Cambia con cada resultado nuevo: las tarjetas se remontan y no arrastran errores ni marcas viejas.
  const [generacion, setGeneracion] = useState(0);
  const permitido = puede("venta.asignar_factura");

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => vigente && setClientes(lista))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [sucursal, permitido]);

  // Sin esto, quien si tiene el permiso ve "No tienes permiso" un instante.
  if (cargandoSesion) return <EstadoPantalla tipo="cargando" />;
  if (!permitido) return <EstadoPantalla tipo="sin-permiso" />;

  async function alBuscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    // Se avanza el contador antes de validar: una búsqueda en vuelo no debe pisar este error.
    const mia = ++busqueda.current;
    if (numero.trim() === "" && !cliente) {
      setError("Escribe un número de factura o elige un cliente.");
      return;
    }
    try {
      const encontradas = await buscarFacturas({
        numero: numero.trim() || undefined,
        clienteId: cliente?.id,
        sucursal,
      });
      if (mia === busqueda.current) {
        setFacturas(encontradas);
        setGeneracion((n) => n + 1);
      }
    } catch (err) {
      if (mia === busqueda.current) setError(mensajeDe(err, "No se pudieron buscar las facturas."));
    }
  }

  function reemplazar(id: string, nueva: FacturaConVentas | null) {
    setFacturas((actual) => (actual ?? []).flatMap((f) => (f.id !== id ? [f] : nueva ? [nueva] : [])));
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={alBuscar} className="flex flex-wrap items-end gap-3 rounded-[10px] border p-3.5">
        <Campo id="buscar-numero-factura" etiqueta="Número de factura a buscar">
          <Entrada
            maxLength={LARGO_MAX_NUMERO_FACTURA}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            className="w-48"
          />
        </Campo>
        <BuscadorCliente
          clientes={clientes}
          cliente={cliente}
          onElegir={setCliente}
          onQuitar={() => setCliente(null)}
          etiquetaQuitar="Quitar"
        />
        <Button type="submit">Buscar</Button>
      </form>

      {aviso && <Aviso tono="exito">{aviso}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      {/* Tras borrar la ultima, el aviso ya explica por que no hay ninguna. */}
      {facturas !== null && facturas.length === 0 && !aviso && (
        <p className="text-sm text-muted-foreground">No se encontraron facturas.</p>
      )}

      {(facturas ?? []).map((f) => (
        <TarjetaFactura
          key={`${generacion}-${f.id}`}
          alActuar={() => setAviso(null)}
          factura={f}
          onCambiada={(nueva) => reemplazar(f.id, nueva)}
          onBorrada={() => {
            reemplazar(f.id, null);
            setAviso(`La factura ${f.numero} se borró: ya no tenía ventas.`);
          }}
        />
      ))}
    </div>
  );
}

function TarjetaFactura({
  factura,
  onCambiada,
  onBorrada,
  alActuar,
}: {
  factura: FacturaConVentas;
  onCambiada: (f: FacturaConVentas) => void;
  onBorrada: () => void;
  /** Avisa al padre que se hizo algo en esta tarjeta (limpia el aviso de arriba). */
  alActuar: () => void;
}) {
  const { confirmar, ventana } = useConfirmar();
  const [error, setError] = useState<string | null>(null);
  const [nuevoNumero, setNuevoNumero] = useState(factura.numero);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const titulo = `Factura ${factura.numero}`;

  async function guardarNumero() {
    setError(null);
    alActuar();
    setEnviando(true);
    try {
      const nueva = await renombrarFactura(factura.id, nuevoNumero.trim());
      onCambiada(nueva);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo cambiar el número."));
    } finally {
      setEnviando(false);
    }
  }

  async function quitar() {
    const todas = marcadas.size === factura.ventas.length;
    const si = await confirmar(
      todas
        ? {
            titulo: `¿Quitar todas las ventas de la factura ${factura.numero}?`,
            descripcion: `Regresan a "pendiente" y la factura ${factura.numero} desaparece.`,
            confirmar: "Quitar ventas",
          }
        : {
            titulo: `¿Quitar ${plural(marcadas.size, "venta", "ventas")} de la factura ${factura.numero}?`,
            descripcion: 'Regresan a "pendiente".',
            confirmar: "Quitar ventas",
          },
    );
    if (!si) return;
    setError(null);
    alActuar();
    setEnviando(true);
    try {
      const { factura: nueva } = await quitarDeFactura(factura.id, [...marcadas]);
      setMarcadas(new Set());
      if (nueva) onCambiada(nueva);
      else onBorrada();
    } catch (err) {
      setError(mensajeDe(err, "No se pudieron quitar las ventas."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section aria-label={titulo} className="flex flex-col gap-3 rounded-[10px] border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{titulo}</h3>
        <p className="text-sm text-muted-foreground">
          {factura.cliente} · {factura.sucursalCodigo} · registró {factura.creadoPor} el{" "}
          {formatearFechaHora(factura.creadoEn)}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Campo id={`renombrar-${factura.id}`} etiqueta={`Nuevo número de ${factura.numero}`}>
          <Entrada
            maxLength={LARGO_MAX_NUMERO_FACTURA}
            value={nuevoNumero}
            onChange={(e) => setNuevoNumero(e.target.value)}
            disabled={enviando}
            className="w-48"
          />
        </Campo>
        <Button
          variant="outline"
          onClick={() => void guardarNumero()}
          disabled={enviando || nuevoNumero.trim() === "" || nuevoNumero.trim() === factura.numero}
        >
          Guardar número
        </Button>
      </div>

      <CajaTabla>
        <Tabla>
          <thead>
            <tr>
              <Th>
                <span className="sr-only">Quitar</span>
              </Th>
              <Th>Fecha</Th>
              <Th>Folio</Th>
              <Th># de nota</Th>
              <Th alinear="derecha">Monto</Th>
            </tr>
          </thead>
          <tbody>
            {factura.ventas.map((v) => (
              <tr key={v.id}>
                <Td>
                  <Casilla
                    aria-label={`Quitar ${v.folio}`}
                    checked={marcadas.has(v.id)}
                    onChange={() =>
                      setMarcadas((actual) => {
                        const nueva = new Set(actual);
                        if (nueva.has(v.id)) nueva.delete(v.id);
                        else nueva.add(v.id);
                        return nueva;
                      })
                    }
                    disabled={enviando}
                  />
                </Td>
                <Td>
                  <Fecha valor={v.fecha} />
                </Td>
                <Td className="font-mono">{v.folio}</Td>
                <Td>{v.numNota ?? "—"}</Td>
                <TdMonto centavos={v.montoCentavos} />
              </tr>
            ))}
          </tbody>
        </Tabla>
      </CajaTabla>

      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Total: {formatearPesos(factura.totalCentavos)}</p>
        <Button variant="destructive" onClick={() => void quitar()} disabled={enviando || marcadas.size === 0}>
          Quitar de la factura
        </Button>
      </div>

      {ventana}
    </section>
  );
}
```

- [ ] **Step 4: Correr las pruebas de Facturas y ver que pasan**

Run: `npx --workspace=apps/portal vitest run src/components/facturas`
Expected: PASS.

- [ ] **Step 5: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde; `grep -n "window.confirm" apps/portal/src/components/facturas/*.tsx` no encuentra nada.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/facturas/
git commit -m "$(cat <<'EOF'
Portal UI: Facturas con pestañas comunes, tablas, fechas y ventana de confirmar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Peticiones con pestañas, fecha y hora legibles y avisos de color

**Files:**
- Modify: `apps/portal/src/components/peticiones/pantalla-peticiones.tsx` (archivo completo)
- Modify: `apps/portal/src/components/peticiones/bandeja-peticiones.tsx` (archivo completo)
- Modify: `apps/portal/src/components/peticiones/vista-borrado.tsx` (archivo completo)
- Modify: `apps/portal/src/lib/peticiones.ts:1-3,134-148` (`describirPago` con fecha `dd/mm/aaaa`)
- Test: `apps/portal/src/components/peticiones/pantalla-peticiones.test.tsx` (archivo completo), `bandeja-peticiones.test.tsx`, `pedir-borrado-cobro.test.tsx`, `apps/portal/src/lib/peticiones.test.ts`

**Interfaces:**
- Consumes: `Aviso`, `Etiqueta`, `EtiquetaStatusVenta`, `Fecha`, `CajaTabla`/`Tabla`/`Th`/`Td`/`TdMonto` (Task 2); `Campo`, `AreaTexto`, `Pestanas` (Task 3); `Pantalla`, `EncabezadoPantalla`, `EstadoPantalla` (Task 5); `formatearFecha`, `formatearFechaHora` (`@/lib/formato`).
- Produces: `describirPago` sigue con la misma firma; solo cambia la fecha del texto (`"Pago de $1,000.00 · Tacos Erick · 10/10/2026 · Efectivo · cobró Juan Pérez"`). La usan la bandeja y la vista previa de borrado (también en Ventas y Cobranza).

> Decisión: Peticiones **no** gana una ventana de confirmar. Nunca usó `window.confirm`: "Autorizar" ya abre un panel con la vista previa del borrado y su propio "Confirmar y borrar", y "Denegar" el suyo con "Confirmar denegación". Una ventana encima sería preguntar dos veces.

- [ ] **Step 1: Ajustar las pruebas**

Reemplazar **todo** `apps/portal/src/components/peticiones/pantalla-peticiones.test.tsx` por:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as peticionesLib from "@/lib/peticiones";
import { PantallaPeticiones } from "./pantalla-peticiones";

vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return { ...real, listarPeticiones: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const listarPeticiones = vi.mocked(peticionesLib.listarPeticiones);

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

describe("PantallaPeticiones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarPeticiones.mockResolvedValue([]);
  });

  it("mientras carga la sesión dice Cargando…, no \"No tienes permiso\"", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaPeticiones sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin peticiones.gestionar lo dice y no pide nada", () => {
    mockAuth((clave) => clave !== "peticiones.gestionar");
    render(<PantallaPeticiones sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(listarPeticiones).not.toHaveBeenCalled();
  });

  it("encabezado con su explicación; abre en Pendientes con la sucursal del filtro; Historial pide las resueltas", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaPeticiones sucursal="TJ" />);
    expect(screen.getByRole("heading", { level: 1, name: "Peticiones" })).toBeInTheDocument();
    expect(screen.getByText(/borrar un pago/)).toBeInTheDocument();
    expect(await screen.findByText("No hay peticiones pendientes.")).toBeInTheDocument();
    expect(listarPeticiones).toHaveBeenCalledWith("pendiente", "TJ");
    expect(screen.getByRole("tab", { name: "Pendientes" })).toHaveAttribute("aria-selected", "true");

    await usuario.click(screen.getByRole("tab", { name: "Historial" }));
    expect(screen.getByRole("tab", { name: "Historial" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("No hay peticiones resueltas.")).toBeInTheDocument();
    expect(listarPeticiones).toHaveBeenLastCalledWith("historial", "TJ");
  });
});
```

En `apps/portal/src/components/peticiones/bandeja-peticiones.test.tsx`:

Reemplazar:

```tsx
    expect(screen.getByText("2026-10-13 09:15")).toBeInTheDocument();
```

por:

```tsx
    expect(screen.getByText("13/10/2026 09:15")).toBeInTheDocument();
```

Reemplazar:

```tsx
      screen.getByText("Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Efectivo · cobró Juan Pérez"),
```

por:

```tsx
      screen.getByText("Pago de $1,000.00 · Tacos Erick · 10/10/2026 · Efectivo · cobró Juan Pérez"),
```

Reemplazar:

```tsx
    expect(await screen.findByText("Denegada")).toBeInTheDocument();
    expect(screen.getByText("Beto · 2026-10-13 10:00")).toBeInTheDocument();
```

por:

```tsx
    expect(await screen.findByText("Denegada")).toHaveAttribute("data-tono", "neutro");
    expect(screen.getByText("Beto · 13/10/2026 10:00")).toBeInTheDocument();
```

En `apps/portal/src/components/peticiones/pedir-borrado-cobro.test.tsx`, reemplazar:

```tsx
      await screen.findByText("Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Efectivo · cobró Juan Pérez"),
```

por:

```tsx
      await screen.findByText("Pago de $1,000.00 · Tacos Erick · 10/10/2026 · Efectivo · cobró Juan Pérez"),
```

En `apps/portal/src/lib/peticiones.test.ts`, reemplazar:

```ts
      "Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Efectivo · cobró Juan Pérez",
    );
    expect(describirPago({ ...PETICION.cobro, cobrador: null, metodoPago: "transferencia" })).toBe(
      "Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Transferencia · Oficina",
    );
    expect(
      describirPago({ ...PETICION.cobro, origen: "saldo_favor", metodoPago: "saldo_favor", cobrador: null }),
    ).toBe("Saldo a favor aplicado de $1,000.00 · Tacos Erick · 2026-10-10");
```

por:

```ts
      "Pago de $1,000.00 · Tacos Erick · 10/10/2026 · Efectivo · cobró Juan Pérez",
    );
    expect(describirPago({ ...PETICION.cobro, cobrador: null, metodoPago: "transferencia" })).toBe(
      "Pago de $1,000.00 · Tacos Erick · 10/10/2026 · Transferencia · Oficina",
    );
    expect(
      describirPago({ ...PETICION.cobro, origen: "saldo_favor", metodoPago: "saldo_favor", cobrador: null }),
    ).toBe("Saldo a favor aplicado de $1,000.00 · Tacos Erick · 10/10/2026");
```

- [ ] **Step 2: Correr las pruebas de Peticiones y ver que fallan**

Run: `npx --workspace=apps/portal vitest run src/components/peticiones src/lib/peticiones.test.ts`
Expected: FAIL — no hay `tab`, las fechas salen `2026-10-13 09:15` y `2026-10-10`.

- [ ] **Step 3: `describirPago` con fecha legible**

En `apps/portal/src/lib/peticiones.ts`, reemplazar:

```ts
import { ErrorApi, apiFetch } from "./api";
import { ETIQUETA_METODO_PAGO } from "./cobranzas";
import { formatearPesos } from "./ventas";
```

por:

```ts
import { ErrorApi, apiFetch } from "./api";
import { ETIQUETA_METODO_PAGO } from "./cobranzas";
import { formatearFecha, formatearPesos } from "./formato";
```

y reemplazar:

```ts
/** "Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Efectivo · cobró Juan Pérez" (§3.1). */
export function describirPago(c: {
  cliente: string;
  montoCentavos: number;
  metodoPago: string;
  origen: "cobro" | "saldo_favor";
  fechaPago: string;
  cobrador: string | null;
}): string {
  if (c.origen === "saldo_favor")
    return `Saldo a favor aplicado de ${formatearPesos(c.montoCentavos)} · ${c.cliente} · ${c.fechaPago}`;
  const metodo = ETIQUETA_METODO_PAGO[c.metodoPago] ?? c.metodoPago;
  const quien = c.cobrador ? `cobró ${c.cobrador}` : "Oficina";
  return `Pago de ${formatearPesos(c.montoCentavos)} · ${c.cliente} · ${c.fechaPago} · ${metodo} · ${quien}`;
}
```

por:

```ts
/** "Pago de $1,000.00 · Tacos Erick · 10/10/2026 · Efectivo · cobró Juan Pérez" (§3.1). */
export function describirPago(c: {
  cliente: string;
  montoCentavos: number;
  metodoPago: string;
  origen: "cobro" | "saldo_favor";
  fechaPago: string;
  cobrador: string | null;
}): string {
  const fecha = formatearFecha(c.fechaPago);
  if (c.origen === "saldo_favor")
    return `Saldo a favor aplicado de ${formatearPesos(c.montoCentavos)} · ${c.cliente} · ${fecha}`;
  const metodo = ETIQUETA_METODO_PAGO[c.metodoPago] ?? c.metodoPago;
  const quien = c.cobrador ? `cobró ${c.cobrador}` : "Oficina";
  return `Pago de ${formatearPesos(c.montoCentavos)} · ${c.cliente} · ${fecha} · ${metodo} · ${quien}`;
}
```

- [ ] **Step 4: Reescribir la pantalla, la bandeja y la vista previa**

Reemplazar **todo** `apps/portal/src/components/peticiones/pantalla-peticiones.tsx` por:

```tsx
"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Pestanas } from "@/components/ui/pestanas";
import { BandejaPeticiones } from "./bandeja-peticiones";

/** Operación → Peticiones (T-34): autorizar o denegar el borrado de pagos. */
export function PantallaPeticiones({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();

  // Mientras /auth/me no contesta, `puede()` da false a todos: sin esto, quien
  // si tiene el permiso ve "No tienes permiso" un instante (como PantallaPerfiles).
  if (cargandoSesion) return <EstadoPantalla titulo="Peticiones" tipo="cargando" />;
  if (!puede("peticiones.gestionar")) return <EstadoPantalla titulo="Peticiones" tipo="sin-permiso" />;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Peticiones"
        descripcion="Autoriza o niega las peticiones para borrar un pago. Al autorizar se borra el pago completo."
      />
      {/* Sin conservarMontadas: cambiar de pestaña empieza limpio (sin avisos ni paneles de la otra). */}
      <Pestanas
        etiqueta="Peticiones"
        pestanas={[
          {
            valor: "pendiente",
            etiqueta: "Pendientes",
            contenido: <BandejaPeticiones status="pendiente" sucursal={sucursal} />,
          },
          {
            valor: "historial",
            etiqueta: "Historial",
            contenido: <BandejaPeticiones status="historial" sucursal={sucursal} />,
          },
        ]}
      />
    </Pantalla>
  );
}
```

Reemplazar **todo** `apps/portal/src/components/peticiones/bandeja-peticiones.tsx` por:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { AreaTexto, Campo } from "@/components/ui/campo";
import { Etiqueta, type TonoEtiqueta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { formatearFechaHora } from "@/lib/formato";
import {
  ETIQUETA_STATUS_PETICION,
  LARGO_MAX_TEXTO,
  autorizarPeticion,
  denegarPeticion,
  describirPago,
  esConflicto409,
  listarPeticiones,
  textoAutorizada,
  textoDenegada,
  vistaPreviaDePeticion,
  type PeticionEnBandeja,
  type StatusPeticion,
  type VistaBorrado,
} from "@/lib/peticiones";
import { VistaBorradoPago } from "./vista-borrado";

type Accion = { tipo: "autorizar" | "denegar"; peticion: PeticionEnBandeja };

/** Cómo termina una acción: un aviso (salió bien) o una alerta (409: la pantalla quedó vieja). */
type Fin = { aviso: string } | { alerta: string };

/** Autorizada = el pago se borró (información); denegada = no pasó nada (gris). */
const TONO_PETICION: Record<StatusPeticion, TonoEtiqueta> = {
  pendiente: "advertencia",
  autorizada: "informacion",
  denegada: "neutro",
};

/**
 * La bandeja de peticiones (T-34, §3.2). La lista la arma el servidor con el
 * alcance del usuario; autorizar y denegar los vuelve a decidir el servidor con
 * la petición bloqueada. Toda acción, salga bien o con 409, cierra el panel y
 * recarga la lista: lo que se ve nunca se queda viejo.
 */
export function BandejaPeticiones({
  status,
  sucursal,
}: {
  status: "pendiente" | "historial";
  sucursal: string | null;
}) {
  const [peticiones, setPeticiones] = useState<PeticionEnBandeja[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [fin, setFin] = useState<Fin | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;
    listarPeticiones(status, sucursal)
      .then((lista) => {
        if (!vigente) return;
        setPeticiones(lista);
        setErrorCarga(null);
      })
      .catch((err) => {
        if (!vigente) return;
        setPeticiones(null);
        setErrorCarga(mensajeDe(err, "No se pudieron cargar las peticiones."));
      });
    return () => {
      vigente = false;
    };
  }, [status, sucursal, recarga]);

  const terminar = useCallback((resultado: Fin) => {
    setFin(resultado);
    setAccion(null);
    setRecarga((n) => n + 1);
  }, []);

  function abrir(tipo: Accion["tipo"], peticion: PeticionEnBandeja) {
    setFin(null);
    setAccion({ tipo, peticion });
  }

  const pendientes = status === "pendiente";

  return (
    <div className="flex flex-col gap-4">
      {fin && "aviso" in fin && <Aviso tono="exito">{fin.aviso}</Aviso>}
      {fin && "alerta" in fin && <Aviso tono="error">{fin.alerta}</Aviso>}
      {errorCarga && <Aviso tono="error">{errorCarga}</Aviso>}
      {peticiones === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {peticiones &&
        (peticiones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {pendientes ? "No hay peticiones pendientes." : "No hay peticiones resueltas."}
          </p>
        ) : (
          <CajaTabla>
            <Tabla className="min-w-[980px]">
              <thead>
                <tr>
                  <Th>Pedida</Th>
                  <Th>Pidió</Th>
                  <Th>Cliente</Th>
                  <Th>Pago</Th>
                  <Th>Notas</Th>
                  <Th>Motivo</Th>
                  {pendientes ? (
                    <Th>
                      <span className="sr-only">Acciones</span>
                    </Th>
                  ) : (
                    <>
                      <Th>Resultado</Th>
                      <Th>Resolvió</Th>
                      <Th>Comentario</Th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {peticiones.map((p) => (
                  <tr key={p.id} className="align-top">
                    <Td>
                      <Fecha valor={p.creadaEn} conHora />
                    </Td>
                    <Td>{p.solicito}</Td>
                    <Td>{`${p.cobro.cliente} · ${p.sucursalCodigo}`}</Td>
                    <Td>{describirPago(p.cobro)}</Td>
                    <Td className="font-mono">{p.cobro.folios.join(", ") || "—"}</Td>
                    <Td>{p.motivo}</Td>
                    {pendientes ? (
                      <Td alinear="derecha">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            aria-label={`Autorizar petición de ${p.cobro.cliente}`}
                            disabled={accion !== null}
                            onClick={() => abrir("autorizar", p)}
                          >
                            Autorizar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`Denegar petición de ${p.cobro.cliente}`}
                            disabled={accion !== null}
                            onClick={() => abrir("denegar", p)}
                          >
                            Denegar
                          </Button>
                        </div>
                      </Td>
                    ) : (
                      <>
                        <Td>
                          <Etiqueta tono={TONO_PETICION[p.status]}>{ETIQUETA_STATUS_PETICION[p.status]}</Etiqueta>
                        </Td>
                        <Td>{`${p.resolvio ?? "—"} · ${p.resueltaEn ? formatearFechaHora(p.resueltaEn) : "—"}`}</Td>
                        <Td>{p.comentario ?? "—"}</Td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        ))}

      {accion?.tipo === "autorizar" && (
        <AutorizarPeticion
          key={accion.peticion.id}
          peticion={accion.peticion}
          onTerminar={terminar}
          onCancelar={() => setAccion(null)}
        />
      )}
      {accion?.tipo === "denegar" && (
        <DenegarPeticion
          key={accion.peticion.id}
          peticion={accion.peticion}
          onTerminar={terminar}
          onCancelar={() => setAccion(null)}
        />
      )}
    </div>
  );
}

/** Autorizar: la vista previa recalculada al abrir, y confirmar. */
function AutorizarPeticion({
  peticion,
  onTerminar,
  onCancelar,
}: {
  peticion: PeticionEnBandeja;
  onTerminar: (fin: Fin) => void;
  onCancelar: () => void;
}) {
  const [vista, setVista] = useState<VistaBorrado | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo autorizar la petición.");
  // El efecto de carga depende solo de la petición: el aviso al padre se lee del ref.
  const avisar = useRef(onTerminar);
  useEffect(() => {
    avisar.current = onTerminar;
  });

  useEffect(() => {
    let vigente = true;
    vistaPreviaDePeticion(peticion.id)
      .then((v) => {
        if (vigente) setVista(v);
      })
      .catch((err) => {
        if (!vigente) return;
        if (esConflicto409(err)) {
          avisar.current({ alerta: err.mensajeApi ?? "La petición cambió; vuelve a cargar." });
          return;
        }
        setErrorCarga(mensajeDe(err, "No se pudo calcular la vista previa."));
      });
    return () => {
      vigente = false;
    };
  }, [peticion.id]);

  async function confirmar() {
    await enviar(
      async () => {
        try {
          onTerminar({ aviso: textoAutorizada(await autorizarPeticion(peticion.id)) });
        } catch (err) {
          if (esConflicto409(err)) {
            onTerminar({ alerta: err.mensajeApi ?? "La petición cambió; vuelve a cargar." });
            return;
          }
          throw err;
        }
      },
      () => {},
    );
  }

  return (
    <section aria-label="Autorizar petición" className="flex flex-col gap-3 rounded-[10px] border p-4">
      <h3 className="text-sm font-semibold">Autorizar: se borra el pago completo</h3>
      <p className="text-sm">{`Motivo: ${peticion.motivo}`}</p>
      {errorCarga && <Aviso tono="error">{errorCarga}</Aviso>}
      {vista === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {vista && <VistaBorradoPago vista={vista} />}
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          onClick={() => void confirmar()}
          disabled={enviando || vista === null || vista.bloqueo !== null}
        >
          Confirmar y borrar
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}

/** Denegar: comentario opcional. El pago no cambia. */
function DenegarPeticion({
  peticion,
  onTerminar,
  onCancelar,
}: {
  peticion: PeticionEnBandeja;
  onTerminar: (fin: Fin) => void;
  onCancelar: () => void;
}) {
  const [comentario, setComentario] = useState("");
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo denegar la petición.");

  async function confirmar() {
    await enviar(
      async () => {
        try {
          onTerminar({ aviso: textoDenegada(await denegarPeticion(peticion.id, comentario)) });
        } catch (err) {
          if (esConflicto409(err)) {
            onTerminar({ alerta: err.mensajeApi ?? "La petición cambió; vuelve a cargar." });
            return;
          }
          throw err;
        }
      },
      () => {},
    );
  }

  return (
    <section aria-label="Denegar petición" className="flex flex-col gap-3 rounded-[10px] border p-4">
      <h3 className="text-sm font-semibold">{`Denegar: ${describirPago(peticion.cobro)}`}</h3>
      <Campo id={`denegar-comentario-${peticion.id}`} etiqueta="Comentario" opcional>
        <AreaTexto maxLength={LARGO_MAX_TEXTO} value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </Campo>
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex gap-2">
        <Button type="button" onClick={() => void confirmar()} disabled={enviando}>
          Confirmar denegación
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}
```

Reemplazar **todo** `apps/portal/src/components/peticiones/vista-borrado.tsx` por:

```tsx
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { CajaTabla, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { formatearPesos } from "@/lib/formato";
import { describirPago, type VistaBorrado } from "@/lib/peticiones";

/**
 * Qué pasaría si se borra el pago (§3.1): lo calculó el servidor con las notas
 * bloqueadas. La usan quien pide y quien autoriza. El bloqueo (saldo a favor ya
 * aplicado) se lee aquí; el servidor lo rechazaría igual al autorizar.
 */
export function VistaBorradoPago({ vista }: { vista: VistaBorrado }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">{describirPago(vista.cobro)}</p>
      {vista.notas.length > 0 && (
        <CajaTabla>
          <Tabla densidad="compacta">
            <thead>
              <tr>
                <Th>Folio</Th>
                <Th># de nota</Th>
                <Th alinear="derecha">Le abonó</Th>
                <Th alinear="derecha">Saldo hoy</Th>
                <Th alinear="derecha">Saldo tras borrar</Th>
                <Th>Queda</Th>
              </tr>
            </thead>
            <tbody>
              {vista.notas.map((n) => (
                <tr key={n.notaId}>
                  <Td className="font-mono">{n.folio}</Td>
                  <Td>{n.numNota ?? "—"}</Td>
                  <TdMonto centavos={n.delPagoCentavos} />
                  <TdMonto centavos={n.saldoAntesCentavos} />
                  <TdMonto centavos={n.saldoDespuesCentavos} className="font-semibold" />
                  <Td>
                    <EtiquetaStatusVenta status={n.statusDespues} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}
      {vista.movimientoSaldoFavorCentavos !== 0 && (
        <p>{`Saldo a favor: ${formatearPesos(vista.saldoFavorAntesCentavos)} → ${formatearPesos(vista.saldoFavorDespuesCentavos)}`}</p>
      )}
      {/* Texto rojo sin role: el que avisa en voz alta es el panel que lo contiene. */}
      {vista.bloqueo && <p className="font-medium text-destructive">{vista.bloqueo.motivo}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Correr las pruebas de Peticiones y ver que pasan**

Run: `npx --workspace=apps/portal vitest run src/components/peticiones src/lib/peticiones.test.ts src/components/ventas/detalle-venta.test.tsx src/components/cobranza/cobranza-cliente.test.tsx`
Expected: PASS (las dos últimas usan la vista previa de borrado).

- [ ] **Step 6: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/components/peticiones/ apps/portal/src/lib/peticiones.ts apps/portal/src/lib/peticiones.test.ts
git commit -m "$(cat <<'EOF'
Portal UI: Peticiones con pestañas comunes, fecha y hora legibles y avisos de color

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Reporte de Kilometraje con el filtro de fechas común

**Files:**
- Modify: `apps/portal/src/components/reportes/pantalla-kilometraje.tsx` (archivo completo)
- Modify: `apps/portal/src/components/reportes/tabla-kilometraje.tsx` (archivo completo)
- Test: `apps/portal/src/components/reportes/pantalla-kilometraje.test.tsx`

**Interfaces:**
- Consumes: `Aviso`, `Fecha`, `CajaTabla`/`Tabla`/`Th`/`Td`/`FilaGrupo`/`FilaTotal` (Task 2); `Campo`, `Lista` (Task 3); `Pantalla`, `EncabezadoPantalla`, `EstadoPantalla`, `FiltroFechas`, `BotonExcel` (Task 5); `primerDiaDelMes`, `type RangoFechas` (`@/lib/fechas`, Task 1).
- Produces: nada nuevo. `PantallaKilometraje({ sucursal })` y `TablaKilometraje({ reporte })` no cambian de forma.

Cambios visibles a propósito: **Consultar → Mostrar**; atajos de fechas; "sin permiso" con el texto común; tabla común (espacio entre columnas, kilómetros a la derecha, encabezado fijo dentro de su caja, salto en ámbar suave).

- [ ] **Step 1: Ajustar las pruebas**

En `apps/portal/src/components/reportes/pantalla-kilometraje.test.tsx`:

Reemplazar:

```tsx
    expect(screen.getByText("No tienes permiso para ver reportes")).toBeInTheDocument();
```

por:

```tsx
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
```

Reemplazar:

```tsx
  it("arranca con el mes en curso, lista los vehiculos de la sucursal y no consulta hasta Consultar", async () => {
```

por:

```tsx
  it("arranca con el mes en curso, lista los vehiculos de la sucursal y no consulta hasta Mostrar", async () => {
```

Reemplazar **todas** las apariciones (Edit con `replace_all: true`; son cinco) de:

```tsx
    await usuario.click(screen.getByRole("button", { name: "Consultar" }));
```

por:

```tsx
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
```

Agregar al inicio del archivo, junto a los demás imports:

```tsx
import { diaAnterior } from "@/lib/fechas";
```

y agregar antes del último `});` del archivo:

```tsx

  it("el encabezado explica el reporte; los atajos cambian el rango sin consultar", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaKilometraje sucursal={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Reporte de Kilometraje" })).toBeInTheDocument();
    expect(screen.getByText(/Un salto avisa/)).toBeInTheDocument();
    const ayer = diaAnterior(hoyEnTijuana());
    await usuario.click(screen.getByRole("button", { name: "Ayer" }));
    expect(screen.getByLabelText("Desde")).toHaveValue(ayer);
    expect(screen.getByLabelText("Hasta")).toHaveValue(ayer);
    expect(obtener).not.toHaveBeenCalled();
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(obtener).toHaveBeenCalledWith({ desde: ayer, hasta: ayer, vehiculoId: null, sucursal: null });
  });
```

- [ ] **Step 2: Correr la prueba y ver que falla**

Run: `npx --workspace=apps/portal vitest run src/components/reportes/pantalla-kilometraje.test.tsx`
Expected: FAIL — no hay botón "Mostrar" ni atajos; el texto de permiso es el viejo.

- [ ] **Step 3: Reescribir la pantalla y la tabla**

Reemplazar **todo** `apps/portal/src/components/reportes/pantalla-kilometraje.tsx` por:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { BotonExcel } from "@/components/ui/boton-excel";
import { Campo, Lista } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { mensajeDe } from "@/lib/api";
import { exportarExcel } from "@/lib/excel/exportar";
import { primerDiaDelMes, type RangoFechas } from "@/lib/fechas";
import {
  definicionExcelKilometraje,
  etiquetaSucursal,
  etiquetaVehiculo,
  obtenerReporteKilometraje,
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
 * con `key={sucursal}`: cambiar la sucursal en el menú empieza limpio.
 */
export function PantallaKilometraje({ sucursal }: { sucursal: string | null }) {
  const { puede, usuario, cargando: cargandoSesion } = useAuth();
  const permitido = puede("reportes.ver");
  const [rango, setRango] = useState<RangoFechas>(() => {
    const hoy = hoyEnTijuana();
    return { desde: primerDiaDelMes(hoy), hasta: hoy };
  });
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

  // Mientras /auth/me no contesta, `puede()` da false a todos: sin esto, quien
  // si tiene el permiso ve "No tienes permiso" un instante (como PantallaPerfiles).
  if (cargandoSesion) return <EstadoPantalla titulo="Reporte de Kilometraje" tipo="cargando" />;
  if (!permitido) return <EstadoPantalla titulo="Reporte de Kilometraje" tipo="sin-permiso" />;

  // FiltroFechas ya revisó que la fecha inicial no sea posterior a la final.
  async function alMostrar({ desde, hasta }: RangoFechas) {
    setError(null);
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
    <Pantalla>
      <EncabezadoPantalla
        titulo="Reporte de Kilometraje"
        descripcion="Los kilómetros de cada vehículo por jornada cerrada. Un salto avisa que la jornada empezó con otro kilometraje que el de la anterior."
      />

      <FiltroFechas
        id="km"
        desde={rango.desde}
        hasta={rango.hasta}
        onCambio={setRango}
        onMostrar={(r) => void alMostrar(r)}
        deshabilitado={cargando}
        acciones={<BotonExcel exportando={exportando} disabled={!hayResultados} onClick={() => void alExportar()} />}
      >
        <Campo id="km-vehiculo" etiqueta="Vehículo">
          <Lista value={vehiculoId} onChange={(e) => setVehiculoId(e.target.value)}>
            <option value="">Todos</option>
            {vehiculos.map((v) => (
              <option key={v.id} value={v.id}>
                {etiquetaVehiculo(v)}
              </option>
            ))}
          </Lista>
        </Campo>
      </FiltroFechas>

      {error && <Aviso tono="error">{error}</Aviso>}

      {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {consultado &&
        (hayResultados ? (
          <TablaKilometraje reporte={consultado.reporte} />
        ) : (
          <p className="text-sm text-muted-foreground">No hay jornadas cerradas en ese rango.</p>
        ))}
    </Pantalla>
  );
}
```

Reemplazar **todo** `apps/portal/src/components/reportes/tabla-kilometraje.tsx` por:

```tsx
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, FilaGrupo, FilaTotal, Tabla, Td, Th } from "@/components/ui/tabla";
import {
  etiquetaVehiculo,
  explicarSalto,
  formatearKm,
  formatearSalto,
  type ReporteKilometraje,
} from "@/lib/reportes";
import { cn } from "@/lib/utils";

/** Un `tbody` por vehiculo: encabezado, sus jornadas y su total. Gran total en el `tfoot`. */
export function TablaKilometraje({ reporte }: { reporte: ReporteKilometraje }) {
  return (
    <CajaTabla altoMaximo="70vh">
      <Tabla className="min-w-[720px]">
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Vendedor</Th>
            <Th alinear="derecha">Km inicial</Th>
            <Th alinear="derecha">Km final</Th>
            <Th alinear="derecha">Kilómetros</Th>
            <Th alinear="derecha">Salto</Th>
          </tr>
        </thead>
        {reporte.vehiculos.map((v) => (
          <tbody key={v.vehiculoId}>
            <FilaGrupo columnas={6}>{etiquetaVehiculo(v)}</FilaGrupo>
            {v.jornadas.map((j) => {
              const conSalto = j.saltoDecimas !== null && j.saltoDecimas !== 0;
              return (
                <tr
                  key={j.jornadaId}
                  className={cn(conSalto && "bg-warning-soft")}
                  data-salto={conSalto ? "si" : undefined}
                >
                  <Td>
                    <Fecha valor={j.fecha} />
                  </Td>
                  <Td>{j.vendedor}</Td>
                  <Td alinear="derecha">{formatearKm(j.kmInicialDecimas)}</Td>
                  <Td alinear="derecha">{formatearKm(j.kmFinalDecimas)}</Td>
                  <Td alinear="derecha">{formatearKm(j.kilometrosDecimas)}</Td>
                  <Td alinear="derecha" className="font-semibold" title={explicarSalto(j)}>
                    {formatearSalto(j.saltoDecimas)}
                  </Td>
                </tr>
              );
            })}
            <FilaTotal>
              <Td colSpan={4}>Total {etiquetaVehiculo(v)}</Td>
              <Td alinear="derecha">{formatearKm(v.totalKilometrosDecimas)}</Td>
              <Td alinear="derecha">{formatearSalto(v.totalSaltoDecimas)}</Td>
            </FilaTotal>
          </tbody>
        ))}
        <tfoot>
          <FilaTotal>
            <Td colSpan={4}>Total general</Td>
            <Td alinear="derecha">{formatearKm(reporte.totalKilometrosDecimas)}</Td>
            <Td alinear="derecha">{formatearSalto(reporte.totalSaltoDecimas)}</Td>
          </FilaTotal>
        </tfoot>
      </Tabla>
    </CajaTabla>
  );
}
```

- [ ] **Step 4: Correr la prueba y ver que pasa**

Run: `npx --workspace=apps/portal vitest run src/components/reportes/pantalla-kilometraje.test.tsx`
Expected: PASS.

- [ ] **Step 5: Todo el portal limpio**

Run: `npm test --workspace=apps/portal && npx --workspace=apps/portal tsc --noEmit && npm run lint --workspace=apps/portal`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/reportes/pantalla-kilometraje.tsx apps/portal/src/components/reportes/tabla-kilometraje.tsx \
  apps/portal/src/components/reportes/pantalla-kilometraje.test.tsx
git commit -m "$(cat <<'EOF'
Portal UI: Kilometraje con filtro de fechas común, atajos y tabla común

Consultar pasa a Mostrar.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Dejarlo escrito y revisarlo en el navegador

**Files:**
- Modify: `CLAUDE.md` (bloque nuevo "Portal UI (piezas comunes, Etapa 1)" después de "Reportes y Excel")
- Modify (vault, repo aparte): `../jawa-obsidian-memory/20-Arquitectura/Portal Web.md`, `../jawa-obsidian-memory/00-Inicio/Estado del proyecto.md`, `../jawa-obsidian-memory/40-Equipo/Bitácora/<fecha de hoy>.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la regla escrita para el trabajo que siga (Etapa 2 en adelante).

- [ ] **Step 1: El bloque de `CLAUDE.md`**

En `CLAUDE.md`, reemplazar:

```markdown
    `components/reporte-ventas/tabla-reporte-ventas.tsx` (`table-fixed`, `colgroup`, `min-w`, scroll en su caja).

`npm run supabase -- migration up --local` aplica migraciones nuevas al Postgres local (ojo con el
```

por:

```markdown
    `components/reporte-ventas/tabla-reporte-ventas.tsx` (`table-fixed`, `colgroup`, `min-w`, scroll en su caja).

- **Portal UI (piezas comunes, Etapa 1).** Spec: `docs/superpowers/specs/2026-10-20-portal-ui-etapa-1-design.md`.
  - **Toda pantalla nueva, o una vieja que se toque, usa `apps/portal/src/components/ui/`**: `EncabezadoPantalla`
    (título + UNA línea que dice para qué sirve), `EstadoPantalla` (Cargando / sin permiso / elige sucursal, mismo texto
    en todas), `Tabla`/`Th`/`Td`/`TdMonto`/`CajaTabla`, `FiltroFechas` (botón **Mostrar**, atajos Hoy · Ayer · Esta
    semana · Este mes) + `BotonExcel`, `Aviso`, `Etiqueta`/`EtiquetaStatusVenta`, `Monto`, `Fecha`, `Campo` y sus
    controles, `Pestanas`. Para confirmar, `useConfirmar()` (pinta `{ventana}` en la pantalla), **nunca `window.confirm`**.
  - Formatos y rangos en un solo lugar: `lib/formato.ts` (`formatearPesos`, `formatearFecha`, `formatearFechaHora`,
    `plural`, `iniciales`) y `lib/fechas.ts` (`rangoSemana`, `rangoMes`, `diaAnterior`, `primerDiaDelMes`). Los archivos
    de antes (`lib/ventas.ts`, `lib/reportes.ts`, `lib/reporte-ventas.ts`, `lib/tesoreria.ts`) solo re-exportan.
  - **El color de la sucursal vive en `lib/sucursal-color.ts`** (TJ azul pacífico, MX morado jamaica, todas = tinta) y
    en las variables `--suc-…` de `globals.css`. Una sucursal nueva usa la tinta hasta que se agregue en los dos
    lugares. Es la única parte llamativa del portal: no se usa para otra cosa.
  - El marco es `components/layout/marco-portal.tsx`: sucursal arriba en su color, secciones plegables, usuario y
    "Cerrar sesión" abajo, ☰ lo esconde (se recuerda con `lib/almacen-local.ts`), y el `<title>` de la pestaña
    ("Ventas | JAWA Tijuana"). Una pantalla nueva se agrega en `nav-config.ts`; mientras su `page.tsx` sea un
    `Placeholder` lleva `pronto: true` (una prueba lo exige).
  - Siguen con el estilo de antes hasta su etapa: catálogos, Tesorería, Reporte de Ventas, Clientes nuevos, Flujo,
    Cuentas por Cobrar, Registrar venta, Perfiles, Precios, Promociones, Ruta diaria. **Recarga y Gastos son de Mario:**
    no se tocan sin él.

`npm run supabase -- migration up --local` aplica migraciones nuevas al Postgres local (ojo con el
```

- [ ] **Step 2: La memoria del proyecto (vault)**

En `../jawa-obsidian-memory/20-Arquitectura/Portal Web.md`: cambiar en el frontmatter `actualizado: 2026-10-14` por la fecha de hoy, y agregar justo antes de la línea `## Módulos de dominio que expone el portal`:

```markdown
## Interfaz común (UI Etapa 1)

Desde la Etapa 1 de "Portal UI parejo" (spec `docs/superpowers/specs/2026-10-20-portal-ui-etapa-1-design.md` en el
repo de código), el portal tiene **un marco y piezas comunes**:

- **Menú lateral fijo** con la **sucursal en su color** arriba (Tijuana azul `#1d5b79`, Mexicali morado `#6b2d5c`,
  Todas las sucursales en tinta), secciones que se abren y cierran, el usuario y "Cerrar sesión" abajo, y ☰ para
  esconderlo. La barra de arriba desapareció. La pestaña del navegador dice "Ventas | JAWA Tijuana".
- El filtro "Por sucursal" de arriba (ver la sección anterior) **sigue funcionando igual por dentro** (`?sucursal=`); solo
  cambió de lugar: ahora es el bloque de la sucursal del menú.
- Piezas comunes en `apps/portal/src/components/ui/` (encabezado con una línea que explica la pantalla, tablas, filtro de
  fechas con **Mostrar** y atajos, avisos de color, ventana de confirmar en lugar de `window.confirm`). La lista y las
  reglas están en el `CLAUDE.md` del repo.
- Pasadas a las piezas en esta etapa: **Ventas, Cobranza, Facturas, Peticiones y Kilometraje**. Las demás van en etapas
  siguientes; Recarga y Gastos (de Mario) cuando él lo decida.
```

En `../jawa-obsidian-memory/00-Inicio/Estado del proyecto.md`: cambiar `actualizado:` del frontmatter a la fecha de hoy y agregar como **última fila** de la tabla de issues (la que contiene la fila `| T-51 |`):

```markdown
| *(sin ticket)* | **Portal UI parejo, Etapa 1** — menú lateral fijo con la sucursal en su color, piezas comunes en `components/ui/`, y Ventas, Cobranza, Facturas, Peticiones y Kilometraje pasadas a ellas | 🟡 En rama `feature/portal-ui-etapa-1` (Roberto + agente). Sin migración, sin backend, la app no cambia. Ver [[Portal Web]] |
```

En `../jawa-obsidian-memory/40-Equipo/Bitácora/`, en la nota del día (créala desde `99-Plantillas/` si no existe), agregar una línea:

```markdown
- Portal UI Etapa 1 implementada en `feature/portal-ui-etapa-1`: menú lateral con la sucursal en su color, piezas comunes y 5 pantallas pasadas. Ver [[Portal Web]].
```

- [ ] **Step 3: Levantar el stack local (base local, nunca `sinmex dev`)**

```bash
docker context ls                                   # ¿Colima o Docker Desktop? En la Mac de Roberto: colima start
npm run supabase start                              # solo si el stack no está arriba
npm run supabase -- migration list --local          # si falta alguna: npm run supabase -- migration up --local
NODE_ENV=test npm run crear-usuario --workspace=apps/backend   # dos veces: un General (sin sucursal) y uno atado a TJ
NODE_ENV=test PORT=3010 npm run backend             # .env.test = Postgres local; el 3000 está ocupado en esa Mac
curl http://localhost:3010/health                   # otra terminal: debe contestar ok
NEXT_PUBLIC_API_URL=http://localhost:3010 npm run portal       # otra terminal: http://localhost:3001
```

Si la base local no tiene ventas, registra dos o tres desde *Operación → Registrar venta* (es la base local).

- [ ] **Step 4: Revisión en el navegador, a 1366 y 1920 px**

En Chrome **en ventana de incógnito** (la extensión de la ventana normal fija un viewport chico). Ancho con DevTools → *Toggle device toolbar* → 1366 × 768 y luego 1920 × 1080. Con el usuario **General** y luego con el **atado a TJ**. Marca cada casilla:

- [ ] En las 5 pantallas (Ventas, Cobranza, Facturas, Peticiones, Kilometraje), con el menú **abierto** y **escondido**, la consola dice `true` para `document.documentElement.scrollWidth <= window.innerWidth` (la página no se desplaza de lado; una tabla ancha se desplaza dentro de su caja).
- [ ] Al bajar por una tabla larga (Ventas con "Este mes"), el menú no se mueve.
- [ ] General: el bloque de sucursal abre la lista con "Todas las sucursales", Tijuana y Mexicali con palomita en la actual. Elegir Mexicali pinta de morado el bloque, la línea de arriba del contenido y la marca de la opción activa, y la pestaña dice "Ventas | JAWA Mexicali"; Todas → tinta y "Ventas | JAWA". Recargar conserva la elección.
- [ ] Atado: el bloque dice Tijuana, sin flecha ni lista, aunque la dirección traiga `?sucursal=MX`.
- [ ] ☰ deja la franja delgada con la pastilla (TJ / MX / Todas) y las iniciales; recargar la deja escondida; ☰ la vuelve a abrir.
- [ ] Cerrar Operación y abrir Catálogo, recargar estando en Ventas: Catálogo sigue abierta y Operación se abre sola.
- [ ] Las 9 pantallas "Próximamente" del menú dicen "Pronto".
- [ ] Abajo: iniciales, nombre y perfil (sin "General" ni código de sucursal); su menú tiene "Cerrar sesión", que lleva al login (pestaña "Entrar · JAWA").
- [ ] Ventas: encabezado con su línea y "Registrar venta"; fechas `dd/mm/aaaa`; status en pastillas de color; atajos y **Mostrar**; "Eliminar" y "Marcar como cuenta perdida" abren la ventana (Escape y Cancelar no hacen nada).
- [ ] Cobranza: montos a la derecha; "Marcar como cuenta perdida" abre la ventana; registrar un pago muestra el aviso verde.
- [ ] Facturas: pestañas con flechas; lo marcado en Asignar sigue al volver de "Buscar y corregir"; "Quitar de la factura" abre la ventana.
- [ ] Peticiones: pestañas Pendientes / Historial; fecha y hora `dd/mm/aaaa hh:mm`.
- [ ] Kilometraje: atajos, **Mostrar**, salto en ámbar suave, "Exportar a Excel" descarga el archivo.
- [ ] Recarga y Gastos (de Mario) abren bien dentro del marco nuevo.
- [ ] Letra: DevTools → *Computed → font-family* del texto dice Public Sans; el título de la pantalla y el nombre de la sucursal, Bricolage Grotesque.

Si algo falla, se corrige en la tarea que lo produjo (con su prueba) antes de seguir.

- [ ] **Step 5: El build de producción compila**

Run: `npm run build --workspace=apps/portal`
Expected: termina sin errores (necesita red para bajar las fuentes de Google, igual que antes con Geist) y sin el aviso de `useSearchParams() should be wrapped in a suspense boundary`.

- [ ] **Step 6: Cerrar la sesión de trabajo**

`Ctrl+C` al backend y al portal; `npm run supabase stop`; `colima stop` si se usa Colima.

- [ ] **Step 7: Commits**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Portal UI: CLAUDE.md explica las piezas comunes y el color de la sucursal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
git -C ../jawa-obsidian-memory add "20-Arquitectura/Portal Web.md" "00-Inicio/Estado del proyecto.md" 40-Equipo/Bitácora
git -C ../jawa-obsidian-memory commit -m "$(cat <<'EOF'
Portal UI Etapa 1: menú lateral con la sucursal en su color y piezas comunes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

> **Para el PR (cuando Roberto lo pida):** incluir una nota para Mario: *"Recarga y Gastos no se tocaron. Sí cambian alrededor de ellas el marco (menú lateral en lugar de la barra de arriba) y los colores base del tema en `globals.css` (tinta, grises, rojo). Revisa que tus pantallas se vean bien."*

---

## Fuera de este plan (a propósito)

- Las demás pantallas y las otras 13 llamadas a `window.confirm` (Tesorería, Usuarios, Clientes, Ruta diaria, catálogos…): una etapa por PR, como dice el spec §5.
- Modo oscuro completo (los colores oscuros quedan definidos en `.dark`, pero nada lo activa), diseño de celular, color de marca.
- Recordar el menú escondido **antes** del primer pintado (hoy se ajusta al montar: un instante abierto al recargar). Haría falta una cookie leída en el servidor; no lo pide el spec.
