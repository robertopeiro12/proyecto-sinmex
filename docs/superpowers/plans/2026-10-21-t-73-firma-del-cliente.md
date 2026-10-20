# T-73 · Firma del cliente en la nota de venta — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el cliente firme con el dedo en la tablet cada venta (contado y crédito, sin poder omitirla) antes de
grabarla; que la firma se guarde en la misma transacción que la venta y su folio; que suba como JPG por el canal de
fotos cuando la venta ya está aceptada; y que el portal la muestre en el detalle de la venta, con el nombre de quien
firmó y un aviso si la nota se editó después.

**Architecture:** en la tablet, `react-native-svg` + `PanResponder` dibujan la firma en un recuadro blanco
(`src/ui/recuadro-firma.tsx`); toda decisión vive en funciones puras con prueba (`src/estado/firma.ts`: el `d` del
trazo, `hayFirma`, el nombre, `puedeGrabarVenta` y el grabador con guardia de doble toque). Al grabar, `toDataURL`
da un PNG que `src/fotos/firma-expo.ts` convierte a JPG (`expo-image-manipulator`) y deja en
`documentDirectory/firmas/firma-<idVenta>.jpg`; el id de la venta se genera **antes** y `ventas.registrar()` guarda
`firma_local`/`firma_nombre` (migración local 016) en la transacción del folio. La operación `venta` lleva el campo
aditivo `firma: { nombre }` (contrato sigue en 1); `normalizarDatosVenta` lo valida y `registrarVenta` escribe
`venta_nota.firma_esperada`/`firma_nombre`. La imagen sube por `POST /sync/foto/:clave` (rama `venta`, archivo
`venta-<id>-firma.jpg`), cuyas columnas son de `ventas-cobranza` (`FirmasVentaService`). La tablet descarta la firma si
la venta ya no existe (404 definitivo solo para firmas). El portal lee `VentaDetalle.firma` y `editada` y baja la
imagen de `GET /ventas/:id/firma`.

**Tech Stack:** NestJS 11 + Kysely (backend), Postgres local vía Supabase (e2e, pgTAP), Next.js 15 + Vitest +
Testing Library (portal), Expo SDK 57 / React Native 0.86 + `react-native-svg` + SQLite + Jest en Node (tablet; sin
pruebas de pantalla).

**Spec:** `docs/superpowers/specs/2026-10-21-t-73-firma-del-cliente-design.md` — léelo antes de empezar. Sus
decisiones D1…D6 **no se renegocian**. Si este plan lo contradice, manda el spec: para y pregunta (ver
"Conflictos para el controlador" al final, donde están las que este plan tuvo que interpretar).

---

## Global Constraints

Copiadas del spec y del repo. Cada tarea las incluye:

- Rama `feature/t-73-firma-nota`. Todos los comandos **desde la raíz del worktree**
  (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t73`), con los scripts del workspace
  (`--workspace=apps/...`). **Nunca** entres a `../proyecto-sinmex` (clon de demo) ni a otro clon.
- Si el worktree **no tiene `node_modules`** (recién clonado), corre `npm install` desde la raíz antes de la primera
  tarea. Nada más se instala, salvo `react-native-svg` en la Tarea 1.
- **`react-native-svg`** se agrega con la versión que fija Expo SDK 57, con
  `npm exec --workspace=apps/tablet -- expo install react-native-svg` (corre `expo install` dentro de `apps/tablet`
  y respeta el lockfile raíz del monorepo). Comprueba la versión contra
  `npm exec --workspace=apps/tablet -- node -p "require('expo/bundledNativeModules.json')['react-native-svg']"`.
  Si `expo install` toca otra cosa (otras versiones en `apps/tablet/package.json`, `tsconfig.json`, `app.json`), se
  revierte con `git checkout -- <archivo>` y solo se queda la línea de `react-native-svg` y su `package-lock.json`.
  Es **dependencia nativa**: hace falta un APK nuevo (no basta Metro).
- **`CONTRATO_ACTUAL` sigue en 1.** `firma` es un campo **opcional y aditivo** de `datos` de la operación `venta`.
  Presencia = la venta espera imagen; ausencia (o `null`) = app vieja, venta sin firma.
- **Los tipos del contrato están duplicados**: `apps/backend/src/modules/sincronizacion/contrato.ts` (normativo) y
  `apps/tablet/src/sincronizacion/contrato.ts`. Si una tarea toca uno, toca el otro **y**
  `docs/contrato-sincronizacion.md` **en el mismo commit**.
- `firma.nombre`: texto recortado de 1 a 80 caracteres o `null` (en blanco = `null`); otro tipo o más largo →
  `datos-invalidos` con motivo que empieza por `firma.nombre`. Una venta del portal (`origen = 'portal'`) queda con
  `firma_esperada = false`.
- Canal de fotos para `venta`: no proyectada → **409**; venta inexistente o eliminada → **404**; venta que no espera
  firma → **409** "Esa venta no espera firma."; archivo `venta-<venta_nota.id>-firma.jpg`, escrito **antes** de anotar
  las columnas; reenviar escribe el mismo nombre. Otro vendedor → **403** (como hoy).
- ADR-0009: **una transacción por operación**; una operación rechazada **no deja fila**. Las columnas de firma de
  `venta_nota` son de `ventas-cobranza`; `sincronizacion/` solo resuelve la clave y despacha.
- Base de datos: **nunca `db reset`**. Migraciones locales solo con `npm run supabase -- migration up --local` (con el
  `--`). Supabase local es **compartido entre sesiones**. **Nunca apuntes nada a la nube** (`sinmex dev`): `.env.test`
  va a `127.0.0.1:54322`; no se corre `db push` ni nada con `--db-url`. La migración del servidor es
  `supabase/migrations/20261021120000_venta_firma.sql` (timestamp único; antes de crearla, `ls supabase/migrations`).
- pgTAP: `npm run supabase -- test db --local` (CI no lo corre: lo corre el implementador).
- Backend: lint **solo por archivo**: `npm exec --workspace=apps/backend -- prettier --write <archivos>` y
  `npm exec --workspace=apps/backend -- eslint <archivos>`. **Nunca** `npm run lint --workspace=apps/backend` (lleva
  `--fix` y reescribe archivos ajenos). Typecheck del backend = `npm run build --workspace=apps/backend`. Pruebas:
  `npm test --workspace=apps/backend -- <patrón>` y `npm run test:e2e --workspace=apps/backend -- <patrón>`.
- Los e2e **siembran lo que usan** con sufijo `${Date.now()}-${process.pid}` y lo borran en `afterAll` en orden
  inverso a las llaves foráneas. Las ventas del e2e de la firma usan la fecha **2015-06-15** (ninguna otra suite vende
  ese día; el folio es único en toda la base).
- Portal: `npm test --workspace=apps/portal -- <patrón>`, `npx tsc --noEmit -p apps/portal`,
  `npm run lint --workspace=apps/portal`. Tiene que caber en una ventana de **1366 px**.
- Tablet: `npm run typecheck --workspace=apps/tablet`, `npm run lint --workspace=apps/tablet`,
  `npm test --workspace=apps/tablet -- <patrón>`. Las pruebas son **solo** `src/**/*.spec.ts` en Node: nada de
  pantallas ni de `react-native`/`react-native-svg`/`expo-*` en un `.spec.ts`. **La lógica de la tablet vive en
  funciones puras con pruebas de Jest**; la pantalla solo la llama. Grabar lleva **guardia contra el doble toque**
  (aquí, `crearGrabadorVenta`, que se queda cerrado mientras exporta, convierte y graba).
- Migraciones locales de la tablet: **nunca se edita una publicada** (001…015); la nueva es la **016**.
- Una venta grabada **no se edita ni se anula** en la tablet (D3 de T-16). La firma no cambia eso.
- Código en español, **identificadores sin acentos**, **textos al usuario en español con acentos** ("Firma del
  cliente", "Borrar firma", "No se pudo guardar la firma. Intenta de nuevo."). Comentarios que explican *por qué*;
  sigue el estilo del archivo que tocas.
- **Nunca `git add -f`** de nada bajo `.superpowers/` (ni de ningún archivo ignorado). `git status` limpio al terminar
  cada tarea; un commit por tarea (o más si el implementador lo prefiere), con el trailer exacto en la última línea
  del mensaje: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Si `expo` (prebuild o `install`) ensucia `apps/tablet/package.json`, `apps/tablet/tsconfig.json` o `app.json` con
  cambios que no son de la tarea, se revierte con `git checkout -- <archivo>` antes del commit.

## Review Focus

Los cinco puntos del spec; cada uno se pinó en la tarea dueña:

1. **Tema oscuro: el recuadro sigue blanco y el JPG sale con fondo blanco, nunca negro.** Tarea 1: el fondo es un
   `<Rect fill={PAPEL_FIRMA}>` **dentro** del `Svg` (constante, no token de tema; prueba en `firma.spec.ts`) y el paso
   manual del controlador fuerza el modo noche del sistema (`adb shell cmd uimode night yes`), exporta y mira el JPG
   sacado del equipo.
2. **Volver a captura y regresar: la firma anterior no sobrevive; Grabar vuelve a quedar deshabilitado.** Tarea 7:
   "Corregir" pone `FIRMA_VACIA` y `puedeGrabarVenta({ …, trazos: FIRMA_VACIA.trazos })` es `false`
   (`firma.spec.ts`, "volver a captura deja Grabar deshabilitado").
3. **Doble toque en Grabar mientras se exporta la firma: una sola venta, un solo folio.** Tarea 7:
   `crearGrabadorVenta` — dos `grabar()` sin esperar → el segundo da `null` y `registrar` corre **una** vez; tras
   grabar, el candado no se suelta (`firma.spec.ts`).
4. **Foto de firma antes de que la venta esté proyectada** (push y fotos en la misma sincronización, venta rechazada
   después): 409 y reintento, nunca archivo sin venta. Tarea 4 (unit: `entidad_id` nulo → 409 sin escribir; e2e: la
   firma de una venta **rechazada** → 404 y ningún archivo) y Tarea 6 (`firmasPendientes()` no ofrece la firma de una
   venta `pendiente` o `error`; la cola solo sube firmas de ventas `sincronizado`).
5. **Venta eliminada en el portal antes de que suba su firma: 404 → la tablet la descarta, no reintenta para
   siempre.** Tarea 4 (e2e: `DELETE /ventas/:id` y luego la firma → 404 sin archivo) y Tarea 6
   (`fuenteFirmasVentas.fallaDefinitiva(clave, 404)` y la prueba del motor: un 404 de una firma se **descarta**; uno de
   otra fuente sigue siendo temporal).

---

### Tarea 1: Tablet: `react-native-svg`, lógica pura de la firma, recuadro y conversión a JPG — con la prueba en el emulador (D5, D6)

**Files:**
- Modify: `apps/tablet/package.json`, `package-lock.json` (solo `react-native-svg`)
- Create: `apps/tablet/src/datos/reglas-firma.ts`
- Create: `apps/tablet/src/estado/firma.ts`
- Test: `apps/tablet/src/estado/firma.spec.ts`
- Create: `apps/tablet/src/ui/recuadro-firma.tsx`
- Modify: `apps/tablet/src/ui/pantalla.tsx` (prop `desplazable`)
- Create: `apps/tablet/src/fotos/firma-expo.ts`
- Temporal, **nunca se commitea**: `apps/tablet/app/prueba-firma.tsx` (solo para el paso del controlador)

**Interfaces:**
- Consumes: `Boton`, `useTema`, `colores`/`espacio`/`grosor`/`radio` de `src/ui/`; `expo-file-system`
  (`File`, `Directory`, `Paths`), `expo-image-manipulator` (`ImageManipulator`, `SaveFormat`), `Image.getSize` de
  `react-native`.
- Produces:
  - `src/datos/reglas-firma.ts`: `export const LARGO_MAX_NOMBRE_FIRMA = 80;`
    `export function nombreFirmaValido(nombre: string | null): boolean`.
  - `src/estado/firma.ts`: `export interface Punto { x: number; y: number }`; constantes `LARGO_MAX_NOMBRE_FIRMA`
    (reexportada), `ALTO_RECUADRO_FIRMA = 220`, `GROSOR_TRAZO_FIRMA = 3`, `RADIO_PUNTO_FIRMA = 1.5`,
    `PAPEL_FIRMA = '#FFFFFF'`, `TINTA_FIRMA = '#000000'`, `ANCHO_MAX_FIRMA_PX = 1000`, `CALIDAD_JPG_FIRMA = 0.8`,
    `MS_MAX_EXPORTAR_FIRMA = 5000`; `export class ErrorFirma extends Error`;
    `trazoAPath(puntos: readonly Punto[]): string`; `hayFirma(trazos: readonly (readonly Punto[])[]): boolean`;
    `normalizarNombreFirma(texto: string): string | null` (lanza `ErrorFirma` con más de 80);
    `anchoDestinoFirma(anchoPng: number): number | null`; `nombreArchivoFirma(ventaId: string): string`;
    `quitarPrefijoDataUrl(datos: string): string`; `base64ABytes(base64: string): Uint8Array`;
    `conLimiteDeTiempo<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T>`.
  - `src/ui/recuadro-firma.tsx`: `export interface ControlFirma { exportarPng(): Promise<string>; borrar(): void }` y
    `export const RecuadroFirma` (`forwardRef<ControlFirma, { trazos: Punto[][]; alCambiar: (trazos: Punto[][]) => void; alDibujar?: (dibujando: boolean) => void; deshabilitado?: boolean }>`).
  - `src/ui/pantalla.tsx`: `Pantalla` acepta `desplazable?: boolean` (default `true`; `false` apaga el scroll mientras
    se firma).
  - `src/fotos/firma-expo.ts`: `export async function guardarFirmaJpg(ventaId: string, pngBase64: string): Promise<string>`
    (la URI final en `documentDirectory/firmas/firma-<ventaId>.jpg`).

> El implementador (subagente) para después del Paso 9 (typecheck, lint, pruebas y commit) y **reporta**. El Paso 10
> es del **controlador**, en el emulador: si `toDataURL` no da un PNG o la conversión no deja un JPG blanco con trazo
> negro, **se para todo** (spec D6) y se replantea con la opción B. Las Tareas 2…8 no empiezan antes de ese visto
> bueno.

- [ ] **Paso 1: la dependencia**

```bash
npm exec --workspace=apps/tablet -- node -p "require('expo/bundledNativeModules.json')['react-native-svg']"
npm exec --workspace=apps/tablet -- expo install react-native-svg
git diff --stat
```

El primer comando imprime el rango que fija Expo SDK 57; `apps/tablet/package.json` debe quedar con
`"react-native-svg": "<ese rango>"` en `dependencies` (orden alfabético, después de `react-native-screens`). El diff
debe tocar **solo** `apps/tablet/package.json` (esa línea) y `package-lock.json`. Cualquier otro archivo o versión
que `expo install` haya cambiado se revierte con `git checkout -- <archivo>` (y si fue en `package.json`, se edita a
mano para dejar solo la línea nueva y se vuelve a correr `npm install` desde la raíz para que el lockfile cuadre).

`react-native-svg` no lleva config plugin: **no** se toca `app.json`.

- [ ] **Paso 2: la prueba de la lógica pura, que falla**

`apps/tablet/src/estado/firma.spec.ts`:

```ts
import { LARGO_MAX_NOMBRE_FIRMA as TOPE_DATOS, nombreFirmaValido } from '@/datos/reglas-firma';

import {
  ANCHO_MAX_FIRMA_PX,
  base64ABytes,
  conLimiteDeTiempo,
  ErrorFirma,
  hayFirma,
  LARGO_MAX_NOMBRE_FIRMA,
  anchoDestinoFirma,
  nombreArchivoFirma,
  normalizarNombreFirma,
  PAPEL_FIRMA,
  quitarPrefijoDataUrl,
  TINTA_FIRMA,
  trazoAPath,
} from './firma';

/**
 * La firma del cliente (T-73). Todo lo que se puede decidir sin pantalla vive en
 * `firma.ts` y se prueba aqui: la tablet no tiene pruebas de componentes.
 */

describe('trazoAPath', () => {
  it('sin puntos no dibuja nada', () => {
    expect(trazoAPath([])).toBe('');
  });

  it('varios puntos son una linea: M al primero y L a cada siguiente', () => {
    expect(
      trazoAPath([
        { x: 10, y: 20 },
        { x: 15, y: 25 },
        { x: 30, y: 22 },
      ]),
    ).toBe('M 10 20 L 15 25 L 30 22');
  });

  it('redondea a una decima: el path no carga 15 decimales por punto', () => {
    expect(
      trazoAPath([
        { x: 10.04, y: 20.06 },
        { x: 15.55, y: 25.449 },
      ]),
    ).toBe('M 10 20.1 L 15.6 25.4');
  });

  it('un toque sin arrastre es un circulo minimo (dos arcos), no un path vacio', () => {
    // Un `M x y` solo no pinta nada en Android; dos arcos de radio 1.5 con el
    // trazo de 3 px dejan un punto visible.
    expect(trazoAPath([{ x: 50, y: 60 }])).toBe('M 48.5 60 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0');
  });
});

describe('hayFirma', () => {
  it('sin trazos, o con trazos vacios, no hay firma', () => {
    expect(hayFirma([])).toBe(false);
    expect(hayFirma([[], []])).toBe(false);
  });

  it('un solo punto ya es firma', () => {
    expect(hayFirma([[], [{ x: 1, y: 1 }]])).toBe(true);
  });
});

describe('normalizarNombreFirma (D2)', () => {
  it('recorta, y en blanco es null', () => {
    expect(normalizarNombreFirma('  Doña Lupe  ')).toBe('Doña Lupe');
    expect(normalizarNombreFirma('')).toBeNull();
    expect(normalizarNombreFirma('    ')).toBeNull();
  });

  it(`hasta ${LARGO_MAX_NOMBRE_FIRMA} caracteres entra; uno mas es ErrorFirma`, () => {
    expect(normalizarNombreFirma('x'.repeat(80))).toBe('x'.repeat(80));
    expect(() => normalizarNombreFirma('x'.repeat(81))).toThrow(ErrorFirma);
    expect(() => normalizarNombreFirma('x'.repeat(81))).toThrow('no puede pasar de 80 caracteres');
  });

  it('el tope es el mismo que comprueba el repositorio', () => {
    expect(LARGO_MAX_NOMBRE_FIRMA).toBe(TOPE_DATOS);
    expect(nombreFirmaValido(null)).toBe(true);
    expect(nombreFirmaValido('Doña Lupe')).toBe(true);
    expect(nombreFirmaValido('')).toBe(false);
    expect(nombreFirmaValido(' Doña Lupe')).toBe(false);
    expect(nombreFirmaValido('x'.repeat(81))).toBe(false);
  });
});

describe('papel y tinta (Review Focus 1)', () => {
  it('el fondo es blanco y el trazo negro, fijos: no salen del tema', () => {
    // Un PNG transparente pasa a JPG con fondo NEGRO. El fondo es un <Rect> de
    // este color dentro del Svg, y no depende del tema de la app.
    expect(PAPEL_FIRMA).toBe('#FFFFFF');
    expect(TINTA_FIRMA).toBe('#000000');
  });
});

describe('conversion a JPG', () => {
  it(`solo se reduce lo que pasa de ${ANCHO_MAX_FIRMA_PX} px de ancho`, () => {
    expect(anchoDestinoFirma(1400)).toBe(1000);
    expect(anchoDestinoFirma(1001)).toBe(1000);
    expect(anchoDestinoFirma(1000)).toBeNull();
    expect(anchoDestinoFirma(640)).toBeNull();
  });

  it('el archivo local es firma-<idVenta>.jpg: reintentar con el mismo id lo sobrescribe', () => {
    expect(nombreArchivoFirma('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(
      'firma-3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg',
    );
  });

  it('quita el prefijo data: si toDataURL lo trae, y deja el base64 si no', () => {
    expect(quitarPrefijoDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
    expect(quitarPrefijoDataUrl('iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
  });

  it('base64ABytes decodifica igual que Buffer, con y sin relleno', () => {
    for (const texto of ['', 'a', 'ab', 'abc', 'abcd', 'firma del cliente ñ']) {
      const b64 = Buffer.from(texto, 'utf8').toString('base64');
      expect(Array.from(base64ABytes(b64))).toEqual(Array.from(Buffer.from(texto, 'utf8')));
      expect(Array.from(base64ABytes(b64.replace(/=+$/, '')))).toEqual(Array.from(Buffer.from(texto, 'utf8')));
    }
    // Los primeros bytes de un PNG: 0x89 'P' 'N' 'G'.
    expect(Array.from(base64ABytes('iVBORw0KGgo=').slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('base64ABytes rechaza lo que no es base64', () => {
    expect(() => base64ABytes('no es base64!')).toThrow(ErrorFirma);
    expect(() => base64ABytes('abcde')).toThrow(ErrorFirma);
  });
});

describe('conLimiteDeTiempo', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('deja pasar lo que llega a tiempo', async () => {
    await expect(conLimiteDeTiempo(Promise.resolve('png'), 1000, 'tarde')).resolves.toBe('png');
  });

  it('deja pasar el error de la promesa', async () => {
    await expect(conLimiteDeTiempo(Promise.reject(new Error('roto')), 1000, 'tarde')).rejects.toThrow('roto');
  });

  it('si no llega, rechaza con ErrorFirma al vencer el plazo', async () => {
    const nunca = new Promise<string>(() => {});
    const resultado = conLimiteDeTiempo(nunca, 1000, 'La firma tardó demasiado en guardarse.');
    jest.advanceTimersByTime(1000);
    await expect(resultado).rejects.toThrow(ErrorFirma);
  });
});
```

- [ ] **Paso 3: correr y ver fallar**

`npm test --workspace=apps/tablet -- firma` → falla al resolver `./firma` y `@/datos/reglas-firma` (no existen).

- [ ] **Paso 4: los topes compartidos**

`apps/tablet/src/datos/reglas-firma.ts`:

```ts
/**
 * Los topes de la firma del cliente (T-73) que comparten la pantalla y el
 * repositorio de ventas.
 *
 * Viven en `src/datos/` (como `reglas-gasto.ts`) porque el repositorio los
 * vuelve a comprobar antes de abrir la transaccion, y `src/datos/` no importa de
 * `src/estado/`. `src/estado/firma.ts` los reexporta para la pantalla.
 *
 * El mismo 80 esta en `datos-venta.ts` del servidor y en el check de
 * `venta_nota.firma_nombre`: si cambia uno, cambian los tres.
 */
export const LARGO_MAX_NOMBRE_FIRMA = 80;

/**
 * Lo unico que el repositorio graba como nombre de quien firma: `null` o un
 * texto YA recortado de 1 a 80 caracteres (`normalizarNombreFirma` de la
 * pantalla lo deja asi).
 */
export function nombreFirmaValido(nombre: string | null): boolean {
  return (
    nombre === null ||
    (nombre === nombre.trim() && nombre.length >= 1 && nombre.length <= LARGO_MAX_NOMBRE_FIRMA)
  );
}
```

- [ ] **Paso 5: la lógica pura**

`apps/tablet/src/estado/firma.ts`:

```ts
import { LARGO_MAX_NOMBRE_FIRMA } from '@/datos/reglas-firma';

export { LARGO_MAX_NOMBRE_FIRMA };

/**
 * La firma del cliente en la nota (T-73), sin React ni modulos nativos: la
 * tablet no tiene pruebas de pantalla, asi que todo lo que se puede decidir
 * vive aqui y `src/ui/recuadro-firma.tsx` / `src/fotos/firma-expo.ts` solo lo
 * llaman (mismo reparto que `gasto.ts` frente a su pantalla).
 */

/** Un punto del dedo, en coordenadas del recuadro (dp). */
export interface Punto {
  x: number;
  y: number;
}

/** Alto fijo del recuadro; el ancho es el de la tarjeta. */
export const ALTO_RECUADRO_FIRMA = 220;
/** Grosor del trazo, en dp. */
export const GROSOR_TRAZO_FIRMA = 3;
/** Radio del circulo con que se dibuja un toque sin arrastre. */
export const RADIO_PUNTO_FIRMA = 1.5;

/**
 * La firma es un PAPEL: blanco y tinta negra, tambien con el sistema en modo
 * noche. Constantes y no tokens del tema a proposito: el fondo se pinta como un
 * `<Rect>` dentro del `Svg` para que el PNG exportado no salga transparente — un
 * PNG transparente pasa a JPG con fondo negro (Review Focus 1).
 */
export const PAPEL_FIRMA = '#FFFFFF';
export const TINTA_FIRMA = '#000000';

/** El JPG que sube: ancho maximo y calidad (spec, pantalla de venta paso 2). */
export const ANCHO_MAX_FIRMA_PX = 1000;
export const CALIDAD_JPG_FIRMA = 0.8;

/** Lo que se espera a `toDataURL` antes de darlo por fallido (no bloquear Grabar para siempre). */
export const MS_MAX_EXPORTAR_FIRMA = 5000;

/** Error de la firma (exportar, convertir, nombre demasiado largo). */
export class ErrorFirma extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorFirma';
  }
}

/** Una decima basta para el dedo y deja el path corto. */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * El `d` del `<Path>` de un trazo. Un solo punto (toque sin arrastre) es un
 * circulo minimo de dos arcos: un `M x y` solo no pinta nada en Android.
 */
export function trazoAPath(puntos: readonly Punto[]): string {
  const primero = puntos[0];
  if (primero === undefined) return '';
  if (puntos.length === 1) {
    const r = RADIO_PUNTO_FIRMA;
    return `M ${r1(primero.x - r)} ${r1(primero.y)} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  }
  return puntos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${r1(p.x)} ${r1(p.y)}`).join(' ');
}

/** ¿Hay al menos un punto? Es lo unico que habilita "Grabar venta" (D1). */
export function hayFirma(trazos: readonly (readonly Punto[])[]): boolean {
  return trazos.some((t) => t.length > 0);
}

/**
 * El nombre de quien firma (D2): opcional, recortado; en blanco es `null`.
 * Mas de 80 lanza: el campo ya tiene `maxLength`, esto es la red.
 */
export function normalizarNombreFirma(texto: string): string | null {
  const recortado = texto.trim();
  if (recortado === '') return null;
  if (recortado.length > LARGO_MAX_NOMBRE_FIRMA) {
    throw new ErrorFirma(`El nombre de quien firma no puede pasar de ${LARGO_MAX_NOMBRE_FIRMA} caracteres.`);
  }
  return recortado;
}

/** El ancho al que se reduce el PNG, o `null` si ya cabe. Nunca agranda. */
export function anchoDestinoFirma(anchoPng: number): number | null {
  return anchoPng > ANCHO_MAX_FIRMA_PX ? ANCHO_MAX_FIRMA_PX : null;
}

/**
 * El archivo local de la firma. Sale del id de la venta, que la pantalla genera
 * antes de grabar y conserva mientras siga abierta: reintentar sobrescribe el
 * mismo archivo en vez de dejar huerfanos.
 */
export function nombreArchivoFirma(ventaId: string): string {
  return `firma-${ventaId}.jpg`;
}

/** `toDataURL` puede traer o no el prefijo `data:image/png;base64,`. */
export function quitarPrefijoDataUrl(datos: string): string {
  return datos.replace(/^data:image\/png;base64,/, '');
}

const ALFABETO_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 a bytes, sin `atob` ni `Buffer` (que no estan garantizados en los tipos
 * de React Native). El PNG se escribe a disco como bytes para pasarlo por
 * `expo-image-manipulator`.
 */
export function base64ABytes(base64: string): Uint8Array {
  const limpio = base64.replace(/[\s=]/g, '');
  if (!/^[A-Za-z0-9+/]*$/.test(limpio) || limpio.length % 4 === 1) {
    throw new ErrorFirma('La imagen de la firma no es base64 válido.');
  }
  const bytes = new Uint8Array(Math.floor((limpio.length * 3) / 4));
  let acumulado = 0;
  let bits = 0;
  let j = 0;
  for (const caracter of limpio) {
    acumulado = ((acumulado << 6) | ALFABETO_BASE64.indexOf(caracter)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[j] = (acumulado >> bits) & 0xff;
      j += 1;
    }
  }
  return bytes;
}

/**
 * La promesa, o un `ErrorFirma(mensaje)` si no llega en `ms`. Para `toDataURL`,
 * que si no llama a su callback dejaria la pantalla esperando para siempre.
 */
export function conLimiteDeTiempo<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new ErrorFirma(mensaje)), ms);
    promesa.then(
      (valor) => {
        clearTimeout(temporizador);
        resolve(valor);
      },
      (error: unknown) => {
        clearTimeout(temporizador);
        reject(error instanceof Error ? error : new ErrorFirma(String(error)));
      },
    );
  });
}
```

- [ ] **Paso 6: correr y ver pasar**

`npm test --workspace=apps/tablet -- firma` → todas las pruebas de `firma.spec.ts` en verde.

- [ ] **Paso 7: `Pantalla` deja apagar el scroll mientras se firma**

El `ScrollView` de `Pantalla` se queda con un trazo vertical a medio dibujar (Android intercepta el gesto). La pantalla
de venta apagará el scroll mientras el dedo está en el recuadro. En `apps/tablet/src/ui/pantalla.tsx`, la firma de
`Pantalla` pasa a:

```tsx
export function Pantalla({
  titulo,
  subtitulo,
  children,
  formulario = false,
  sinCabecera = false,
  desplazable = true,
}: {
  titulo?: string;
  subtitulo?: ReactNode;
  children: ReactNode;
  formulario?: boolean;
  /**
   * La pantalla se dibuja **sin cabecera de navegacion** (`headerShown: false`).
   *
   * Cuando hay cabecera, React Navigation ya reserva el alto de la barra de
   * estado; cuando no la hay, nadie lo hace y el titulo se mete **debajo del
   * reloj**. Se vio asi en el emulador, en `login`, que es la primera pantalla
   * que ve el vendedor cada manana.
   */
  sinCabecera?: boolean;
  /**
   * `false` apaga el scroll (T-73): mientras el cliente firma, un trazo vertical
   * no debe mover la pantalla en vez de dibujar.
   */
  desplazable?: boolean;
}) {
```

y el `ScrollView` gana `scrollEnabled={desplazable}`:

```tsx
    <ScrollView
      style={estilos.pantalla}
      contentContainerStyle={[
        formulario ? estilos.contenidoCentrado : estilos.contenido,
        sinCabecera && { paddingTop: insets.top + espacio.md },
      ]}
      keyboardShouldPersistTaps="handled"
      scrollEnabled={desplazable}
    >
```

- [ ] **Paso 8: el recuadro y la conversión (solo typecheck y lint: no se prueban en Node)**

`apps/tablet/src/ui/recuadro-firma.tsx`:

```tsx
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import {
  ALTO_RECUADRO_FIRMA,
  conLimiteDeTiempo,
  ErrorFirma,
  GROSOR_TRAZO_FIRMA,
  MS_MAX_EXPORTAR_FIRMA,
  PAPEL_FIRMA,
  quitarPrefijoDataUrl,
  TINTA_FIRMA,
  trazoAPath,
  type Punto,
} from '@/estado/firma';

import { Boton } from './boton';
import { colores, espacio, grosor, radio } from './tokens';

/** Lo que la pantalla puede pedirle al recuadro por `ref`. */
export interface ControlFirma {
  /** El dibujo como PNG en base64, sin prefijo `data:`. Rechaza si no llega en {@link MS_MAX_EXPORTAR_FIRMA}. */
  exportarPng(): Promise<string>;
  /** Vacia los trazos (lo mismo que "Borrar firma"). */
  borrar(): void;
}

interface Props {
  /** Los trazos, en el estado de la pantalla: asi "Corregir" puede vaciarlos (D4). */
  trazos: Punto[][];
  alCambiar: (trazos: Punto[][]) => void;
  /** `true` al poner el dedo, `false` al levantarlo: la pantalla apaga su scroll mientras tanto. */
  alDibujar?: (dibujando: boolean) => void;
  /** Mientras se graba no se dibuja ni se borra. */
  deshabilitado?: boolean;
}

/**
 * El recuadro donde firma el cliente (T-73, D5).
 *
 * - Papel **blanco** tambien con el sistema en modo noche: el fondo es un
 *   `<Rect>` DENTRO del `Svg`, asi que el PNG de `toDataURL` sale opaco y el JPG
 *   no se vuelve negro (Review Focus 1).
 * - `PanResponder` en un `View` que envuelve al `Svg`, y el `Svg` con
 *   `pointerEvents="none"`: asi `locationX/Y` son siempre relativos al recuadro y
 *   no al trazo que el dedo este tocando.
 * - Cada trazo es un `<Path>`; un toque sin arrastre es un circulo minimo
 *   (`trazoAPath`).
 */
export const RecuadroFirma = forwardRef<ControlFirma, Props>(function RecuadroFirma(
  { trazos, alCambiar, alDibujar, deshabilitado = false },
  ref,
) {
  const svg = useRef<Svg>(null);
  // El PanResponder se crea una vez; lee lo ultimo por refs.
  const actuales = useRef(trazos);
  const avisar = useRef(alCambiar);
  const avisarDibujo = useRef(alDibujar);
  const bloqueado = useRef(deshabilitado);
  useEffect(() => {
    actuales.current = trazos;
  }, [trazos]);
  useEffect(() => {
    avisar.current = alCambiar;
    avisarDibujo.current = alDibujar;
  }, [alCambiar, alDibujar]);
  useEffect(() => {
    bloqueado.current = deshabilitado;
  }, [deshabilitado]);

  const gestos = useMemo(() => {
    const punto = (e: GestureResponderEvent): Punto => ({
      x: e.nativeEvent.locationX,
      y: e.nativeEvent.locationY,
    });
    const publicar = (nuevos: Punto[][]) => {
      actuales.current = nuevos;
      avisar.current(nuevos);
    };
    const soltar = () => avisarDibujo.current?.(false);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !bloqueado.current,
      onMoveShouldSetPanResponder: () => !bloqueado.current,
      // A media firma, ni el scroll ni otro gesto se quedan con el dedo.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        avisarDibujo.current?.(true);
        publicar([...actuales.current, [punto(e)]]);
      },
      onPanResponderMove: (e) => {
        const previos = actuales.current;
        const ultimo = previos[previos.length - 1] ?? [];
        publicar([...previos.slice(0, -1), [...ultimo, punto(e)]]);
      },
      onPanResponderRelease: soltar,
      onPanResponderTerminate: soltar,
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      exportarPng: () =>
        conLimiteDeTiempo(
          new Promise<string>((resolve, reject) => {
            const actual = svg.current;
            if (!actual) {
              reject(new ErrorFirma('El recuadro de firma no está en pantalla.'));
              return;
            }
            actual.toDataURL((base64: string) => resolve(quitarPrefijoDataUrl(base64)));
          }),
          MS_MAX_EXPORTAR_FIRMA,
          'La firma tardó demasiado en guardarse.',
        ),
      borrar: () => {
        actuales.current = [];
        avisar.current([]);
      },
    }),
    [],
  );

  return (
    <View style={{ gap: espacio.sm, marginTop: espacio.sm }}>
      <View
        {...gestos.panHandlers}
        accessibilityLabel="Recuadro para la firma del cliente"
        style={{
          height: ALTO_RECUADRO_FIRMA,
          borderWidth: grosor.fuerte,
          borderColor: colores.bordeFuerte,
          borderRadius: radio.medio,
          overflow: 'hidden',
        }}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg ref={svg} width="100%" height="100%">
            <Rect x={0} y={0} width="100%" height="100%" fill={PAPEL_FIRMA} />
            {trazos.map((t, i) => (
              <Path
                key={i}
                d={trazoAPath(t)}
                stroke={TINTA_FIRMA}
                strokeWidth={GROSOR_TRAZO_FIRMA}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </Svg>
        </View>
      </View>
      <Boton
        etiqueta="Borrar firma"
        tono="neutra"
        ancho="ajustado"
        onPress={() => {
          actuales.current = [];
          avisar.current([]);
        }}
        deshabilitado={deshabilitado || trazos.length === 0}
      />
    </View>
  );
});
```

`apps/tablet/src/fotos/firma-expo.ts`:

```ts
/**
 * El adaptador nativo de la firma del cliente (T-73, D5): del PNG de
 * `toDataURL` al JPG que el servidor acepta (`validarFoto` solo admite JPEG).
 *
 * Como `expo.ts`, aqui no hay ni una decision: el ancho, la calidad y el nombre
 * del archivo salen de `@/estado/firma` (probado en Node). Esto solo traduce a
 * `expo-file-system` y `expo-image-manipulator`.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

import {
  anchoDestinoFirma,
  base64ABytes,
  CALIDAD_JPG_FIRMA,
  nombreArchivoFirma,
} from '@/estado/firma';

/**
 * Escribe el PNG en cache, lo convierte a JPG (calidad 0.8, ancho maximo
 * 1000 px) y lo deja en `documentDirectory/firmas/firma-<ventaId>.jpg`, que la
 * limpieza de cache del sistema no toca: la firma tiene que sobrevivir hasta que
 * haya WiFi. Devuelve la URI final.
 *
 * Lanza si algo falla; quien llama (`crearGrabadorVenta`) no graba la venta en
 * ese caso, asi que no se quema folio. Reintentar con el mismo `ventaId`
 * sobrescribe el mismo archivo.
 */
export async function guardarFirmaJpg(ventaId: string, pngBase64: string): Promise<string> {
  const png = new File(Paths.cache, `firma-${ventaId}.png`);
  if (png.exists) png.delete();
  png.write(base64ABytes(pngBase64));

  const { width } = await Image.getSize(png.uri);
  const contexto = ImageManipulator.manipulate(png.uri);
  const ancho = anchoDestinoFirma(width);
  if (ancho !== null) contexto.resize({ width: ancho });
  const imagen = await contexto.renderAsync();
  const jpg = await imagen.saveAsync({ format: SaveFormat.JPEG, compress: CALIDAD_JPG_FIRMA });

  const carpeta = new Directory(Paths.document, 'firmas');
  carpeta.create({ intermediates: true, idempotent: true });
  const destino = new File(carpeta, nombreArchivoFirma(ventaId));
  if (destino.exists) destino.delete();
  new File(jpg.uri).move(destino);

  try {
    png.delete();
  } catch {
    // El PNG es solo un paso intermedio en cache: si no se pudo borrar, el
    // sistema lo limpia.
  }
  return destino.uri;
}
```

- [ ] **Paso 9: verificar y commit (el implementador termina aquí y reporta)**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
git status
git add apps/tablet/package.json package-lock.json apps/tablet/src/datos/reglas-firma.ts apps/tablet/src/estado/firma.ts apps/tablet/src/estado/firma.spec.ts apps/tablet/src/ui/recuadro-firma.tsx apps/tablet/src/ui/pantalla.tsx apps/tablet/src/fotos/firma-expo.ts
git commit -m "T-73 (tablet): react-native-svg, lógica pura de la firma, recuadro y conversión a JPG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Si el typecheck se queja de la firma de `toDataURL`, de `Image.getSize` (promesa) o de `File.move`, **no improvises
otra API**: anota el error exacto en el reporte y para; el controlador lo resuelve en el Paso 10 con el emulador
delante.

- [ ] **Paso 10 (CONTROLADOR, manual, en el emulador): ¿`toDataURL` funciona? (D6)**

Instala un APK de desarrollo de **este** worktree (la dependencia es nativa). Ojo: reemplaza la app `mx.jawa.tablet`
del emulador compartido; ver "Conflictos".

1. `npm exec --workspace=apps/tablet -- expo prebuild -p android --clean` (genera `apps/tablet/android`, ignorado por
   git). `git status`: si `expo` tocó `apps/tablet/package.json` o `tsconfig.json`, `git checkout -- <archivo>`.
2. Crea el archivo temporal `apps/tablet/app/prueba-firma.tsx` (**no se commitea**):

```tsx
import { useRef, useState } from 'react';
import { Image, Text } from 'react-native';

import { hayFirma, type Punto } from '@/estado/firma';
import { guardarFirmaJpg } from '@/fotos/firma-expo';
import { Boton } from '@/ui/boton';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { RecuadroFirma, type ControlFirma } from '@/ui/recuadro-firma';

/** SOLO para el paso 10 de la Tarea 1 de T-73. Se borra al terminar. */
export default function PruebaFirma() {
  const recuadro = useRef<ControlFirma>(null);
  const [trazos, setTrazos] = useState<Punto[][]>([]);
  const [dibujando, setDibujando] = useState(false);
  const [resultado, setResultado] = useState('');
  const [uri, setUri] = useState<string | null>(null);

  async function probar() {
    try {
      const control = recuadro.current;
      if (!control) throw new Error('sin recuadro');
      const png = await control.exportarPng();
      const jpg = await guardarFirmaJpg('00000000-0000-4000-8000-000000000073', png);
      setResultado(`PNG: ${png.length} car., empieza por ${png.slice(0, 11)} · JPG: ${jpg}`);
      setUri(`${jpg}?v=${Date.now()}`);
    } catch (e) {
      setResultado(`FALLO: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <Pantalla titulo="Prueba de firma (T-73)" desplazable={!dibujando}>
      <Tarjeta etiqueta="Firma">
        <RecuadroFirma ref={recuadro} trazos={trazos} alCambiar={setTrazos} alDibujar={setDibujando} />
      </Tarjeta>
      <Boton etiqueta="Exportar" onPress={() => void probar()} deshabilitado={!hayFirma(trazos)} />
      <Text selectable>{resultado}</Text>
      {uri ? (
        // Fondo rojo detras: si el JPG tuviera zonas negras o transparentes se notaria.
        <Image source={{ uri }} style={{ width: 320, height: 140, backgroundColor: 'red' }} resizeMode="contain" />
      ) : null}
    </Pantalla>
  );
}
```

3. `npm run android --workspace=apps/tablet -- --port 8082` (Metro en 8082: el 8081 suele estar ocupado).
4. `adb shell am start -W -a android.intent.action.VIEW -d "jawatablet://prueba-firma" mx.jawa.tablet`.
5. Firma con trazos **horizontales y verticales** y un **toque suelto** (a mano o con
   `adb shell input swipe 300 900 700 1000 400` y `adb shell input tap 500 950`; ajusta coordenadas al recuadro).
   Comprueba: el trazo sigue al dedo, el scroll **no** se roba los trazos verticales, el toque deja un punto, "Borrar
   firma" vacía.
6. "Exportar": el texto debe decir que el PNG **empieza por `iVBORw0KGgo`** y mostrar la ruta
   `…/files/firmas/firma-00000000-0000-4000-8000-000000000073.jpg`; la imagen debajo: **trazo negro sobre blanco**, sin
   rojo ni negro de fondo.
7. Modo noche del sistema: `adb shell cmd uimode night yes`, vuelve a firmar y exportar; mismo resultado. Después
   `adb shell cmd uimode night no`.
8. Saca el JPG y míralo:
   `adb exec-out run-as mx.jawa.tablet cat files/firmas/firma-00000000-0000-4000-8000-000000000073.jpg > /private/tmp/firma-t73.jpg`
   y ábrelo (herramienta Read): fondo blanco, trazo negro, ancho ≤ 1000 px.
9. Borra `apps/tablet/app/prueba-firma.tsx`; `git status` limpio.

**Si el paso 6, 7 u 8 falla (no hay PNG, el callback nunca llega, el JPG sale negro o transparente) → PARA.** Es el
respaldo D6: se replantea con la opción B (trazos como JSON en la operación) y se vuelve a preguntar a Mario; no se
improvisa. Si solo falla el scroll del paso 5, se arregla aquí mismo antes de seguir.

---

### Tarea 2: Migración del servidor: columnas de firma en `venta_nota` (servidor del spec)

**Files:**
- Create: `supabase/tests/99_venta_firma_test.sql`
- Create: `supabase/migrations/20261021120000_venta_firma.sql`
- Modify (generado): `apps/backend/src/database/schema.d.ts`

**Interfaces:**
- Consumes: tabla `venta_nota` (con `ck_venta_nota_origen_actores` de T-17: una venta `app` exige vendedor), semillas
  `sucursal` `TJ` y `lista_precio` `Lista 1`.
- Produces: columnas `venta_nota.firma_esperada boolean not null default false`, `firma_nombre text` (check 1..80),
  `firma_archivo text`, `firma_subida_en timestamptz` y el check `ck_venta_firma_archivo`; en Kysely,
  `VentaNota.firma_archivo: string | null`, `firma_esperada: Generated<boolean>`, `firma_nombre: string | null`,
  `firma_subida_en: Timestamp | null`.

- [ ] **Paso 1: la prueba pgTAP que falla**

`supabase/tests/99_venta_firma_test.sql`:

```sql
begin;
select plan(12);

-- T-73: lo que la BASE garantiza de la firma del cliente en la nota aunque
-- alguien escriba por debajo del servicio. Prefijo `zz-pgtap-t73`/`ZZ-pgtap-T73`;
-- folios `ZZPGTAPT73nn` (12 caracteres, como los reales). Todo se va con el
-- rollback.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t73', 'Vendedor pgTAP T-73', 'x', id
    from sucursal where codigo = 'TJ';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T73 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));

create temporary table _t73 on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as tj,
  (select id from vendedor where login = 'zz-pgtap-t73') as vendedor,
  (select id from cliente where nombre = 'ZZ-pgtap-T73 Cliente') as cliente;

------------------------------------------------------------------
-- Estructura
------------------------------------------------------------------

select has_column('venta_nota', 'firma_esperada', 'la nota dice si espera la firma del cliente');
select has_column('venta_nota', 'firma_nombre', 'la nota guarda el nombre de quien firmo');
select has_column('venta_nota', 'firma_archivo', 'la nota guarda el archivo de la firma');
select has_column('venta_nota', 'firma_subida_en', 'la nota guarda cuando llego la firma');
select col_not_null('venta_nota', 'firma_esperada', 'firma_esperada no admite null');
select col_default_is('venta_nota', 'firma_esperada', 'false',
  'una venta nace sin esperar firma: portal y apps anteriores a T-73');

------------------------------------------------------------------
-- Los checks
------------------------------------------------------------------

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
       semana, mes, status, sucursal_id, firma_esperada, firma_nombre)
    select 'ZZPGTAPT7301', '2026-10-06', cliente, vendedor, 100.00, 'contado',
           41, 10, 'pagada', tj, true, 'Doña Lupe'
      from _t73$$,
  'una venta de la tablet con firma y nombre entra'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
       semana, mes, status, sucursal_id, firma_esperada, firma_nombre)
    select 'ZZPGTAPT7302', '2026-10-06', cliente, vendedor, 100.00, 'contado',
           41, 10, 'pagada', tj, true, ''
      from _t73$$,
  '23514', null,
  'el nombre de quien firma no puede ser vacio: sin nombre es null'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
       semana, mes, status, sucursal_id, firma_esperada, firma_nombre)
    select 'ZZPGTAPT7303', '2026-10-06', cliente, vendedor, 100.00, 'contado',
           41, 10, 'pagada', tj, true, repeat('x', 81)
      from _t73$$,
  '23514', null,
  'el nombre de quien firma no pasa de 80 caracteres'
);

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
       semana, mes, status, sucursal_id, firma_esperada, firma_nombre)
    select 'ZZPGTAPT7304', '2026-10-06', cliente, vendedor, 100.00, 'contado',
           41, 10, 'pagada', tj, true, repeat('x', 80)
      from _t73$$,
  'un nombre de 80 caracteres si cabe'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
       semana, mes, status, sucursal_id, firma_archivo)
    select 'ZZPGTAPT7305', '2026-10-06', cliente, vendedor, 100.00, 'contado',
           41, 10, 'pagada', tj, 'venta-x-firma.jpg'
      from _t73$$,
  '23514', null,
  'una venta que no espera firma no puede tener archivo de firma'
);

select lives_ok(
  $$update venta_nota
       set firma_archivo = 'venta-x-firma.jpg', firma_subida_en = now()
     where folio = 'ZZPGTAPT7301'$$,
  'a la venta que la espera se le anota el archivo'
);

select * from finish();
rollback;
```

> Los 12: 4 `has_column`, `col_not_null`, `col_default_is`, y 6 de los checks (3 `lives_ok`, 3 `throws_ok`).

- [ ] **Paso 2: correr y ver fallar**

`npm run supabase -- test db --local` → `99_venta_firma_test.sql` falla en los `has_column` (las columnas no
existen). Las demás suites siguen como estaban.

- [ ] **Paso 3: la migración**

Antes, `ls supabase/migrations | tail -3`: la última debe ser `20261020120000_gastos_ruta.sql`. Si alguien ya usó
`20261021120000`, para y avisa.

`supabase/migrations/20261021120000_venta_firma.sql`:

```sql
-- T-73: firma del cliente en la nota de venta.
-- Spec: docs/superpowers/specs/2026-10-21-t-73-firma-del-cliente-design.md
--
-- La tablet captura la firma ANTES de grabar (D3) y la sube como JPG por el
-- canal de fotos (`POST /sync/foto/:clave`), aparte del lote del push. Por eso
-- la nota guarda dos cosas distintas:
--
-- * `firma_esperada` / `firma_nombre`: lo dice la operacion `venta` (campo
--   `firma` del contrato) al proyectar. Presente = la venta espera imagen.
--   Las del portal y las de apps anteriores a T-73 quedan en false: "sin firma".
-- * `firma_archivo` / `firma_subida_en`: los anota el canal de fotos cuando la
--   imagen llega (`venta-<id>-firma.jpg` dentro de FOTOS_DIR).
--
-- Columnas nuevas, con default o nulas: las filas existentes quedan con
-- `firma_esperada = false` y sin archivo, asi que ningun check puede fallar y
-- no hay filas que contar en el pre-flight contra la nube (solo el
-- `migration list` antes y despues del protocolo de CLAUDE.md).

alter table venta_nota
  add column firma_esperada boolean not null default false,
  add column firma_nombre text
    check (firma_nombre is null or char_length(firma_nombre) between 1 and 80),
  add column firma_archivo text,
  add column firma_subida_en timestamptz,
  -- Una nota que no espera firma (portal, app vieja) nunca recibe archivo: el
  -- canal de fotos responde 409 antes de escribir.
  add constraint ck_venta_firma_archivo check (firma_archivo is null or firma_esperada);
```

- [ ] **Paso 4: aplicar y ver pasar**

```bash
npm run supabase -- migration list --local     # 20261021120000 aparece sin aplicar
npm run supabase -- migration up --local       # aplica solo las pendientes; NUNCA db reset
npm run supabase -- test db --local            # 99_venta_firma_test.sql: 12/12
```

Si `migration list` muestra **otras** migraciones pendientes que no son de esta rama (otra sesión trabaja en el mismo
Supabase local), **para** y avisa al controlador antes de aplicar.

- [ ] **Paso 5: regenerar los tipos de Kysely**

```bash
npm run db:types --workspace=apps/backend
git diff apps/backend/src/database/schema.d.ts
```

El diff debe agregar **solo** cuatro líneas a `export interface VentaNota`, entre `fecha` y `folio` (orden alfabético
del generador):

```ts
  fecha: Timestamp;
  firma_archivo: string | null;
  firma_esperada: Generated<boolean>;
  firma_nombre: string | null;
  firma_subida_en: Timestamp | null;
  folio: string;
```

Si aparecen tablas o columnas ajenas (migraciones de otra rama aplicadas al Supabase compartido), deja solo estas
cuatro líneas a mano.

- [ ] **Paso 6: typecheck y commit**

```bash
npm run build --workspace=apps/backend
git add supabase/migrations/20261021120000_venta_firma.sql supabase/tests/99_venta_firma_test.sql apps/backend/src/database/schema.d.ts
git commit -m "T-73: migración de las columnas de firma en venta_nota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 3: Backend: `firma` en la operación `venta` — contrato, normalización y proyección (contrato del spec)

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts` (tipo `FirmaVenta`, `DatosVenta.firma?`)
- Modify: `apps/tablet/src/sincronizacion/contrato.ts` (la copia)
- Modify: `docs/contrato-sincronizacion.md` (§6 `datos` de una venta: ejemplo y subsección `firma`)
- Modify: `apps/backend/src/modules/ventas-cobranza/datos-venta.ts`
- Test: `apps/backend/src/modules/ventas-cobranza/datos-venta.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/despacho.spec.ts` (la venta normalizada gana `firma: null`)
- Modify: `apps/backend/src/modules/ventas-cobranza/venta-portal.spec.ts` (ídem)
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.repository.ts` (`NuevaVentaNota`, `insertarVenta`)
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.service.ts` (`registrarVenta`)
- Test: `apps/backend/src/modules/ventas-cobranza/ventas.service.spec.ts`
- Test: `apps/backend/test/venta-firma.e2e-spec.ts` (nuevo)

**Interfaces:**
- Consumes (Tarea 2): columnas `venta_nota.firma_esperada`, `firma_nombre` y sus tipos en `schema.d.ts`.
- Produces:
  - `export type FirmaVenta = { nombre: string | null }` y `DatosVenta.firma?: FirmaVenta | null` en los dos
    `contrato.ts`.
  - `datos-venta.ts`: `export const LARGO_MAX_NOMBRE_FIRMA = 80;`
    `export interface FirmaNormalizada { nombre: string | null }`;
    `VentaNormalizada.firma: FirmaNormalizada | null` (null = la venta no espera firma).
  - `NuevaVentaNota.firmaEsperada: boolean`, `NuevaVentaNota.firmaNombre: string | null`; `insertarVenta` los escribe
    en `firma_esperada`/`firma_nombre`.
  - `registrarVenta` graba `firmaEsperada = venta.firma !== null` y `firmaNombre = venta.firma?.nombre ?? null`. La
    venta del portal pasa por `normalizarDatosVenta` sin `firma` → `firmaEsperada = false`.

- [ ] **Paso 1: las pruebas unitarias que fallan**

En `apps/backend/src/modules/ventas-cobranza/datos-venta.spec.ts`:

1. En el primer caso (`'acepta la forma del contrato y la deja lista para el servicio'`), el objeto esperado gana
   `firma: null` después de `regalos: []`:

```ts
        regalos: [],
        firma: null,
      },
    });
  });
```

2. Al final del archivo agrega:

```ts
describe('firma (T-73)', () => {
  it('sin firma la venta no la espera: firma null (tablet anterior o portal)', () => {
    const r = normalizarDatosVenta(CLIENTE, datos());
    expect(r.ok && r.venta.firma).toBeNull();
    const conNull = normalizarDatosVenta(CLIENTE, datos({ firma: null }));
    expect(conNull.ok && conNull.venta.firma).toBeNull();
  });

  it('con firma recorta el nombre', () => {
    const r = normalizarDatosVenta(CLIENTE, datos({ firma: { nombre: '  Doña Lupe  ' } }));
    expect(r.ok && r.venta.firma).toEqual({ nombre: 'Doña Lupe' });
  });

  it('un nombre null, ausente o en blanco es firma sin nombre', () => {
    for (const firma of [{ nombre: null }, {}, { nombre: '   ' }]) {
      const r = normalizarDatosVenta(CLIENTE, datos({ firma }));
      expect(r.ok && r.venta.firma).toEqual({ nombre: null });
    }
  });

  it(`hasta ${LARGO_MAX_NOMBRE_FIRMA} caracteres entra; uno mas es invalido y el motivo empieza por firma.nombre`, () => {
    const ok = normalizarDatosVenta(CLIENTE, datos({ firma: { nombre: 'x'.repeat(80) } }));
    expect(ok.ok && ok.venta.firma).toEqual({ nombre: 'x'.repeat(80) });
    const largo = normalizarDatosVenta(CLIENTE, datos({ firma: { nombre: 'x'.repeat(81) } }));
    expect(largo).toMatchObject({ ok: false, campo: 'firma.nombre' });
    expect(!largo.ok && largo.motivo).toMatch(/^firma\.nombre: /);
  });

  it('un nombre que no es texto es invalido', () => {
    const r = normalizarDatosVenta(CLIENTE, datos({ firma: { nombre: 42 } }));
    expect(r).toMatchObject({ ok: false, campo: 'firma.nombre' });
  });

  it('una firma que no es objeto es invalida', () => {
    for (const firma of ['si', true, ['Lupe']]) {
      const r = normalizarDatosVenta(CLIENTE, datos({ firma }));
      expect(r).toMatchObject({ ok: false, campo: 'firma' });
      expect(!r.ok && r.motivo).toMatch(/^firma: /);
    }
  });
});
```

y en el `import` de la primera línea suma `LARGO_MAX_NOMBRE_FIRMA`:

```ts
import { LARGO_MAX_NOMBRE_FIRMA, MAX_LINEAS_VENTA, normalizarDatosVenta } from './datos-venta';
```

En `apps/backend/src/modules/ventas-cobranza/ventas.service.spec.ts`:

1. El helper `venta()` gana `firma: null` después de `regalos: []`:

```ts
  regalos: [],
  firma: null,
  ...extra,
});
```

2. En el primer caso (`'graba cabecera y detalle con monto, status, semana, mes y el % de comision congelado'`), el
   objeto exacto de `repo.insertarVenta` gana dos campos después de `capturoUsuarioId: null,`:

```ts
        origen: 'app',
        capturoUsuarioId: null,
        firmaEsperada: false,
        firmaNombre: null,
      },
      trx,
    );
```

3. Al final del archivo agrega:

```ts
describe('VentasService.registrarVenta con firma (T-73)', () => {
  it('una venta con firma la espera y guarda el nombre', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarVenta(venta({ firma: { nombre: 'Doña Lupe' } }), contexto(), trx);
    expect(repo.insertarVenta).toHaveBeenCalledWith(
      expect.objectContaining({ firmaEsperada: true, firmaNombre: 'Doña Lupe' }),
      trx,
    );
  });

  it('una firma sin nombre la espera igual, con nombre null', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarVenta(venta({ firma: { nombre: null } }), contexto(), trx);
    expect(repo.insertarVenta).toHaveBeenCalledWith(
      expect.objectContaining({ firmaEsperada: true, firmaNombre: null }),
      trx,
    );
  });

  it('una venta del portal no espera firma', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarVenta(venta(), contexto({ origen: 'portal', usuarioId: 'usuario-oficina' }), trx);
    expect(repo.insertarVenta).toHaveBeenCalledWith(
      expect.objectContaining({ origen: 'portal', firmaEsperada: false, firmaNombre: null }),
      trx,
    );
  });
});
```

En `apps/backend/src/modules/sincronizacion/despacho.spec.ts`, caso `'una venta valida se prepara para VentasService'`,
y en `apps/backend/src/modules/ventas-cobranza/venta-portal.spec.ts`, el caso cuyo esperado termina en
`// D9 (T-74): el portal no lleva trazabilidad de promociones.` + `regalos: [],`: agrega `firma: null,` justo después
de esa línea `regalos: [],` (el portal tampoco manda firma).

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/backend -- datos-venta ventas.service despacho venta-portal` → fallan por tipos
(`firma` no existe en `VentaNormalizada`, `firmaEsperada` no existe en `NuevaVentaNota`) y, una vez compilen, los
casos nuevos de firma.

- [ ] **Paso 3: el contrato (los dos archivos y el documento, en el mismo commit)**

En `apps/backend/src/modules/sincronizacion/contrato.ts`, después de `export type RegaloVenta = { … };`:

```ts
/**
 * La firma del cliente en una venta (T-73). Solo el nombre viaja en la
 * operacion; la imagen sube aparte por `POST /sync/foto/:clave` con la clave de
 * esta misma venta, cuando la venta ya fue aceptada.
 */
export type FirmaVenta = {
  /** Quien firmo: texto de 1 a 80 caracteres (se recorta; en blanco es null) o `null`. */
  nombre: string | null;
};
```

y en `DatosVenta`, después de `regalos?: RegaloVenta[];`:

```ts
  /**
   * T-73. Opcional y aditivo (`CONTRATO_ACTUAL` sigue en 1). Presente = la venta
   * espera la imagen de la firma del cliente por el canal de fotos. Ausente (o
   * `null`) = tablet anterior a T-73: la venta entra sin firma. Un `nombre` que no
   * es texto o pasa de 80 caracteres es `datos-invalidos` (`firma.nombre: …`).
   */
  firma?: FirmaVenta | null;
```

En `apps/tablet/src/sincronizacion/contrato.ts`, después de `export type RegaloVenta = { … };`:

```ts
/** Copia del backend (T-73). Solo el nombre: la imagen va por el canal de fotos. */
export type FirmaVenta = {
  nombre: string | null;
};
```

y en `DatosVenta`, después de `regalos?: RegaloVenta[];`:

```ts
  /**
   * T-73. La tablet la manda en toda venta grabada desde la 016 (la firma es
   * obligatoria, D1). Presente = el servidor espera la imagen por el canal de
   * fotos.
   */
  firma?: FirmaVenta | null;
```

En `docs/contrato-sincronizacion.md`, sección `### \`datos\` de una venta (T-16)`:

1. En el bloque `jsonc` de ejemplo, reemplaza el cierre de `lineas` y de `datos`:

```
    "lineas": [                      // 1..50, sin presentación repetida
      { "presentacion_id": "uuid", "cantidad": 24, "cantidad_promocion": 2, "precio_centavos": 1350 }
      // enteros ≥ 0; cantidad + cantidad_promocion > 0;
      // precio_centavos siempre presente, > 0 si cantidad > 0 (0 solo en líneas de pura promoción)
    ]
  }
```

por:

```
    "lineas": [                      // 1..50, sin presentación repetida
      { "presentacion_id": "uuid", "cantidad": 24, "cantidad_promocion": 2, "precio_centavos": 1350 }
      // enteros ≥ 0; cantidad + cantidad_promocion > 0;
      // precio_centavos siempre presente, > 0 si cantidad > 0 (0 solo en líneas de pura promoción)
    ],
    "firma": { "nombre": "Doña Lupe" } // T-73, opcional: presente = espera la imagen de la firma
  }
```

2. Después de la última viñeta de `#### \`regalos\` (T-74)` ("- Al proyectar la primera nota del cliente, el servidor
   marca `cliente.primera_venta_en` (D14); ver arriba."), agrega:

~~~markdown
#### `firma` (T-73)

La firma del cliente en la nota. **Opcional y aditivo** (`CONTRATO_ACTUAL` sigue en 1): la tablet desde T-73 la manda
en toda venta (la firma es obligatoria en la app); una tablet anterior no la manda y la venta del portal no la lleva.

```jsonc
"firma": { "nombre": "Doña Lupe" }    // opcional; ausente o null = la venta no espera firma
```

- **Presencia = la venta espera una imagen.** El servidor guarda `venta_nota.firma_esperada = true` y el nombre; la
  imagen llega aparte por `POST /sync/foto/:clave` con la clave de esta venta (ver "Fotos"). Ausente o `null`:
  `firma_esperada = false` y el portal la muestra como "Sin firma".
- `nombre`: texto que se recorta, de 1 a 80 caracteres; en blanco o `null` es firma sin nombre. Otro tipo o más de 80
  → `datos-invalidos` con motivo `firma.nombre: …`. `firma` que no es objeto → `datos-invalidos` (`firma: …`).
- Editar la venta en el portal no borra la firma ni la vuelve a pedir: el portal avisa que la firma corresponde a la
  versión original.
~~~

- [ ] **Paso 4: la normalización**

En `apps/backend/src/modules/ventas-cobranza/datos-venta.ts`:

1. Después de `export interface RegaloNormalizado { … }`:

```ts
/** La firma del cliente (T-73): solo el nombre; la imagen va por el canal de fotos. */
export interface FirmaNormalizada {
  /** Recortado, de 1 a 80; `null` si no dijo su nombre. */
  nombre: string | null;
}
```

2. En `VentaNormalizada`, después de `regalos: RegaloNormalizado[];`:

```ts
  /**
   * T-73. `null` = la venta no espera firma (tablet anterior a T-73 o venta del
   * portal). Presente = la imagen llegara por el canal de fotos.
   */
  firma: FirmaNormalizada | null;
```

3. Junto a las otras constantes (después de `LARGO_MAX_TEXTO_PROMOCION`):

```ts
/** Mismo tope que el check de `venta_nota.firma_nombre` y que `reglas-firma.ts` de la tablet. */
export const LARGO_MAX_NOMBRE_FIRMA = 80;
```

4. Justo antes de `if (montoTotalCentavos(lineas) > MAX_CENTAVOS) {`:

```ts
  // T-73: opcional y aditivo. Presente = la venta espera la imagen de la firma
  // por el canal de fotos; ausente o null = tablet anterior, venta sin firma.
  let firma: FirmaNormalizada | null = null;
  const firmaCruda = datos.firma;
  if (firmaCruda !== undefined && firmaCruda !== null) {
    if (typeof firmaCruda !== 'object' || Array.isArray(firmaCruda)) {
      return invalido('firma', 'debe ser un objeto con el nombre de quien firmo.');
    }
    const nombreCrudo = (firmaCruda as Record<string, unknown>).nombre;
    let nombre: string | null = null;
    if (nombreCrudo !== undefined && nombreCrudo !== null) {
      if (typeof nombreCrudo !== 'string') {
        return invalido('firma.nombre', 'debe ser texto o null.');
      }
      const recortado = nombreCrudo.trim();
      if (recortado.length > LARGO_MAX_NOMBRE_FIRMA) {
        return invalido(
          'firma.nombre',
          `no puede pasar de ${LARGO_MAX_NOMBRE_FIRMA} caracteres.`,
        );
      }
      nombre = recortado === '' ? null : recortado;
    }
    firma = { nombre };
  }
```

5. En el `return` final, `venta` gana `firma` después de `regalos`:

```ts
  return {
    ok: true,
    venta: {
      clienteId,
      numNota,
      contadoCredito,
      factura,
      comentarios,
      lineas,
      regalos,
      firma,
    },
  };
```

- [ ] **Paso 5: la proyección**

En `apps/backend/src/modules/ventas-cobranza/ventas.repository.ts`, `NuevaVentaNota` gana, después de
`capturoUsuarioId`:

```ts
  /** T-73: la venta espera la imagen de la firma (vino `firma` en la operacion). */
  firmaEsperada: boolean;
  /** T-73: quien firmo; `null` si no lo dijo o si no hay firma. */
  firmaNombre: string | null;
```

y `insertarVenta` los escribe (después de `capturo_usuario_id: venta.capturoUsuarioId,`):

```ts
        capturo_usuario_id: venta.capturoUsuarioId,
        firma_esperada: venta.firmaEsperada,
        firma_nombre: venta.firmaNombre,
```

En `apps/backend/src/modules/ventas-cobranza/ventas.service.ts`, en la llamada a `this.repo.insertarVenta({ … })`,
después de `capturoUsuarioId: contexto.usuarioId,`:

```ts
        capturoUsuarioId: contexto.usuarioId,
        // T-73: la firma la captura la tablet antes de grabar; aqui solo se
        // anota que la imagen llegara por el canal de fotos. El portal nunca la
        // manda (`normalizarDatosVenta` sin `firma` → null).
        firmaEsperada: venta.firma !== null,
        firmaNombre: venta.firma?.nombre ?? null,
```

- [ ] **Paso 6: correr y ver pasar las unitarias**

`npm test --workspace=apps/backend -- datos-venta ventas.service despacho venta-portal` → verde.

- [ ] **Paso 7: el e2e del push, que primero falla**

`apps/backend/test/venta-firma.e2e-spec.ts`:

```ts
// PRIMER import, a proposito: pone FOTOS_DIR antes de que `app.module.ts` lea la configuracion.
import { FOTOS_DIR_PRUEBA } from './apoyo-fotos-dir';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
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
import {
  CONTRATO_ACTUAL,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';
import { formarFolio } from './../src/modules/sincronizacion/folio';
import { asignarSegmento } from './../src/modules/sincronizacion/segmento-vendedor';

/**
 * T-73: la firma del cliente en la venta. Esta suite prueba el push (la
 * operacion `venta` con y sin `firma`); la Tarea 4 le suma la subida de la
 * imagen por el canal de fotos y la lectura del portal.
 *
 * Fecha 2015-06-15: ninguna otra suite vende ese dia y el folio es unico en
 * toda la base.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN = `e2e-firma-v-${SUFIJO}`;
const PREFIJO = `ZZ-e2e-firma-${SUFIJO}`;
const FECHA = '2015-06-15';

describe('Firma del cliente en la venta (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let vendedorId: string;
  let bearer: string;
  let productoId: string;
  let presentacionId: string;
  let clienteId: string;
  let segmento: string;
  let consecutivo = 0;

  const push = async (operaciones: unknown[], token = bearer) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  /** Una venta de la tablet, con lo que se quiera cambiar en `datos`. */
  const venta = (datos: Record<string, unknown> = {}) => ({
    clave: randomUUID(),
    tipo: 'venta',
    cliente_id: clienteId,
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T14:03:22.000-07:00`,
    folio: formarFolio('TJ', FECHA, segmento, ++consecutivo),
    datos: {
      num_nota: null,
      contado_credito: 'credito',
      factura: 'N/A',
      comentarios: null,
      lineas: [
        {
          presentacion_id: presentacionId,
          cantidad: 2,
          cantidad_promocion: 0,
          precio_centavos: 1500,
        },
      ],
      ...datos,
    },
  });

  const notaPorFolio = (folio: string) =>
    db
      .selectFrom('venta_nota')
      .select([
        'id',
        'firma_esperada',
        'firma_nombre',
        'firma_archivo',
        'firma_subida_en',
      ])
      .where('folio', '=', folio)
      .executeTakeFirst();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    tjId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;

    // Catalogo propio: la base de CI no trae productos. La venta de la tablet
    // exige algun precio para la presentacion (D12 de T-16).
    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `${PREFIJO} Jamaica` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    presentacionId = (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen: '1 L' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('precio')
      .values({
        presentacion_id: presentacionId,
        lista_precio_id: lista.id,
        sucursal_id: tjId,
        precio: '15.00',
        vigente_desde: '2015-01-01',
      })
      .execute();
    clienteId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `${PREFIJO} Abarrotes Lupita`,
          domicilio: 'Calle 1',
          telefono: '6640000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: tjId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // El folio lleva el segmento del vendedor (T-14), que asigna el servidor.
    const ocupados = new Set(
      (
        await db
          .selectFrom('vendedor')
          .select('folio_segmento')
          .where('folio_segmento', 'is not', null)
          .where('deleted_at', 'is', null)
          .execute()
      ).map((f) => f.folio_segmento as string),
    );
    segmento = asignarSegmento('Firma Venta', ocupados) as string;
    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Firma Venta',
          password_hash: await app.get(PasswordService).hashear(PASSWORD),
          sucursal_id: tjId,
          folio_segmento: segmento,
        })
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
    // Orden inverso a las llaves foraneas.
    const notas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('vendedor_id', '=', vendedorId);
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('cliente').where('id', '=', clienteId).execute();
    await db
      .deleteFrom('precio')
      .where('presentacion_id', '=', presentacionId)
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('id', '=', presentacionId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await app.close();
    await fs.rm(FOTOS_DIR_PRUEBA, { recursive: true, force: true });
  });

  describe('push (contrato)', () => {
    it('una venta con firma la espera y guarda el nombre recortado', async () => {
      const op = venta({ firma: { nombre: '  Doña Lupe  ' } });
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      expect(await notaPorFolio(op.folio)).toMatchObject({
        firma_esperada: true,
        firma_nombre: 'Doña Lupe',
        firma_archivo: null,
        firma_subida_en: null,
      });
    });

    it('una firma sin nombre la espera igual', async () => {
      const op = venta({ firma: { nombre: null } });
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      expect(await notaPorFolio(op.folio)).toMatchObject({
        firma_esperada: true,
        firma_nombre: null,
      });
    });

    it('una venta sin firma (app anterior a T-73) entra y no la espera', async () => {
      const op = venta();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      expect(await notaPorFolio(op.folio)).toMatchObject({
        firma_esperada: false,
        firma_nombre: null,
      });
    });

    it('un nombre de mas de 80 caracteres rechaza la venta entera y no deja fila', async () => {
      const op = venta({ firma: { nombre: 'x'.repeat(81) } });
      const [r] = (await push([op])).resultados;
      expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
      expect(r.motivo).toMatch(/^firma\.nombre/);
      expect(await notaPorFolio(op.folio)).toBeUndefined();
      const buzon = await db
        .selectFrom('sync_operacion')
        .select('id')
        .where('clave_idempotencia', '=', op.clave)
        .execute();
      expect(buzon).toEqual([]);
    });
  });
});
```

`npm run test:e2e --workspace=apps/backend -- venta-firma` sin los Pasos 3–5 fallaría en los dos primeros casos
(`firma_esperada` false) y en el último (la venta entraría). Con ellos aplicados debe pasar entera.

- [ ] **Paso 8: lint, typecheck, regresión y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/sincronizacion/contrato.ts src/modules/ventas-cobranza/datos-venta.ts src/modules/ventas-cobranza/datos-venta.spec.ts src/modules/sincronizacion/despacho.spec.ts src/modules/ventas-cobranza/venta-portal.spec.ts src/modules/ventas-cobranza/ventas.repository.ts src/modules/ventas-cobranza/ventas.service.ts src/modules/ventas-cobranza/ventas.service.spec.ts test/venta-firma.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/sincronizacion/contrato.ts src/modules/ventas-cobranza/datos-venta.ts src/modules/ventas-cobranza/datos-venta.spec.ts src/modules/sincronizacion/despacho.spec.ts src/modules/ventas-cobranza/venta-portal.spec.ts src/modules/ventas-cobranza/ventas.repository.ts src/modules/ventas-cobranza/ventas.service.ts src/modules/ventas-cobranza/ventas.service.spec.ts test/venta-firma.e2e-spec.ts
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- venta-firma sincronizacion ventas
npm run typecheck --workspace=apps/tablet
git add apps/backend/src/modules/sincronizacion/contrato.ts apps/tablet/src/sincronizacion/contrato.ts docs/contrato-sincronizacion.md apps/backend/src/modules/ventas-cobranza/datos-venta.ts apps/backend/src/modules/ventas-cobranza/datos-venta.spec.ts apps/backend/src/modules/sincronizacion/despacho.spec.ts apps/backend/src/modules/ventas-cobranza/venta-portal.spec.ts apps/backend/src/modules/ventas-cobranza/ventas.repository.ts apps/backend/src/modules/ventas-cobranza/ventas.service.ts apps/backend/src/modules/ventas-cobranza/ventas.service.spec.ts apps/backend/test/venta-firma.e2e-spec.ts
git commit -m "T-73: la operación venta lleva firma (contrato aditivo) y la nota anota si la espera

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Los `npm exec --workspace=apps/backend` corren dentro de `apps/backend`: por eso las rutas van relativas a esa
carpeta. `npm run typecheck --workspace=apps/tablet` confirma que la copia del contrato compila.)

---

### Tarea 4: Backend: la firma sube por el canal de fotos, `GET /ventas/:id/firma` y `VentaDetalle.firma`/`editada` (servidor del spec)

**Files:**
- Modify: `apps/backend/src/modules/cartera-clientes/foto-prospecto.ts` (`EntidadFoto` gana `'venta'`; sufijo `firma`)
- Test: `apps/backend/src/modules/cartera-clientes/foto-prospecto.spec.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/firmas-venta.repository.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/firmas-venta.service.ts`
- Test: `apps/backend/src/modules/ventas-cobranza/firmas-venta.service.spec.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts` (providers y export)
- Modify: `apps/backend/src/modules/sincronizacion/foto.service.ts` (rama `venta`, quinto parámetro, mensajes)
- Test: `apps/backend/src/modules/sincronizacion/foto.service.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/foto.controller.ts` (solo el comentario de cabecera)
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts` (`CabeceraVenta.firma`, `editada`)
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts` (`GET /ventas/:id/firma`)
- Modify: `apps/backend/test/ventas-editar.e2e-spec.ts` (el `toEqual` del detalle gana `firma` y `editada`)
- Test: `apps/backend/test/venta-firma.e2e-spec.ts` (imagen y portal)
- Modify: `docs/contrato-sincronizacion.md` (§6 "Fotos")

**Interfaces:**
- Consumes (Tareas 2 y 3): columnas `venta_nota.firma_*`; la operación `venta` proyectada deja en el buzón
  `entidad_tabla = 'venta_nota'`, `entidad_id = venta_nota.id` (`sincronizacion.service.ts`, `{ tabla: 'venta_nota', id }`);
  `FotosService.validarFoto`, `escribirArchivo`, `rutaDeArchivo` (exportado por `CarteraClientesModule`, que
  `VentasCobranzaModule` ya importa); `exigirAlcanceSobre` (`alcance-venta.ts`);
  `VentasConsultaRepository.cabecera`; `VentasPortalRepository.buscarSucursalUsuario`.
- Produces:
  - `EntidadFoto = 'cliente' | 'visita' | 'gasto' | 'venta'`;
    `nombreArchivoFoto(entidad: EntidadFoto, id: string, sufijo?: 'firma'): string` (`venta-<id>-firma.jpg`).
  - `export type EstadoFirmaVenta = 'inexistente' | 'no-espera' | 'espera'`;
    `FirmasVentaRepository.estadoFirma(id: string): Promise<EstadoFirmaVenta>`,
    `anotarFirma(id: string, archivo: string, subidaEn: Date): Promise<boolean>`,
    `archivoFirma(id: string): Promise<string | null>`.
  - `FirmasVentaService.estadoFirma(ventaId)`, `anotarFirma(ventaId, archivo, subidaEn)` (mismas firmas) y
    `rutaFirma(usuarioId: string, ventaId: string): Promise<string>`; exportado por `VentasCobranzaModule`.
  - `FotoService` recibe un quinto parámetro `firmas: FirmasVentaService`; `POST /sync/foto/:clave` acepta `venta`.
  - `export interface FirmaDeVenta { esperada: boolean; nombre: string | null; subidaEn: string | null }`;
    `CabeceraVenta.firma: FirmaDeVenta` y `CabeceraVenta.editada: boolean` (y por herencia `VentaDetalle`).
  - `GET /ventas/:id/firma` → `image/jpeg`, `Cache-Control: private, no-store`; 404 si la venta no existe, está
    eliminada o no tiene archivo; 403 si es de otra sucursal (mismo alcance que `GET /ventas/:id`).

- [ ] **Paso 1: las pruebas unitarias que fallan**

En `apps/backend/src/modules/cartera-clientes/foto-prospecto.spec.ts`, dentro de `describe('nombreArchivoFoto (T-78)', …)`,
después del primer `it`:

```ts
  it('la firma de una venta es venta-<id>-firma.jpg (T-73): distinta de una foto de la misma fila', () => {
    expect(nombreArchivoFoto('venta', id, 'firma')).toBe(`venta-${id}-firma.jpg`);
    expect(nombreArchivoFoto('venta', id, 'firma')).toBe(nombreArchivoFoto('venta', id, 'firma'));
    expect(() => nombreArchivoFoto('venta', '../x', 'firma')).toThrow(/no utilizable/);
  });
```

`apps/backend/src/modules/ventas-cobranza/firmas-venta.service.spec.ts`:

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FirmasVentaService } from './firmas-venta.service';

const VENTA = 'a1b2c3d4-0000-4000-8000-000000000073';
const ARCHIVO = `venta-${VENTA}-firma.jpg`;

function montar(
  opciones: {
    cabecera?: { sucursalCodigo: string } | undefined;
    codigoUsuario?: string | null;
    archivo?: string | null;
  } = {},
) {
  const repo = {
    estadoFirma: jest.fn().mockResolvedValue('espera'),
    anotarFirma: jest.fn().mockResolvedValue(true),
    archivoFirma: jest
      .fn()
      .mockResolvedValue('archivo' in opciones ? opciones.archivo : ARCHIVO),
  };
  const consulta = {
    cabecera: jest
      .fn()
      .mockResolvedValue(
        'cabecera' in opciones ? opciones.cabecera : { sucursalCodigo: 'TJ' },
      ),
  };
  const portal = {
    buscarSucursalUsuario: jest.fn().mockResolvedValue({
      codigo: 'codigoUsuario' in opciones ? opciones.codigoUsuario : null,
    }),
  };
  const fotos = {
    rutaDeArchivo: jest.fn().mockResolvedValue(`/fotos/${ARCHIVO}`),
  };
  const servicio = new FirmasVentaService(
    repo as never,
    consulta as never,
    portal as never,
    fotos as never,
  );
  return { servicio, repo, consulta, portal, fotos };
}

describe('FirmasVentaService (T-73)', () => {
  it('estadoFirma y anotarFirma son del repositorio de la venta', async () => {
    const { servicio, repo } = montar();
    const subida = new Date('2026-10-21T19:00:00.000Z');
    await expect(servicio.estadoFirma(VENTA)).resolves.toBe('espera');
    await expect(servicio.anotarFirma(VENTA, ARCHIVO, subida)).resolves.toBe(true);
    expect(repo.anotarFirma).toHaveBeenCalledWith(VENTA, ARCHIVO, subida);
  });

  describe('rutaFirma (GET /ventas/:id/firma)', () => {
    it('con archivo devuelve la ruta del disco de fotos', async () => {
      const { servicio, fotos } = montar();
      await expect(servicio.rutaFirma('usuario-1', VENTA)).resolves.toBe(`/fotos/${ARCHIVO}`);
      expect(fotos.rutaDeArchivo).toHaveBeenCalledWith(ARCHIVO, 'Esa venta no tiene firma.');
    });

    it('una venta que no existe o esta eliminada es 404', async () => {
      const { servicio, repo } = montar({ cabecera: undefined });
      await expect(servicio.rutaFirma('usuario-1', VENTA)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.archivoFirma).not.toHaveBeenCalled();
    });

    it('otra sucursal es 403, el mismo alcance que el detalle', async () => {
      const { servicio, repo } = montar({ codigoUsuario: 'MX' });
      await expect(servicio.rutaFirma('usuario-1', VENTA)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.archivoFirma).not.toHaveBeenCalled();
    });

    it('un usuario atado a la sucursal de la venta si la ve', async () => {
      const { servicio } = montar({ codigoUsuario: 'TJ' });
      await expect(servicio.rutaFirma('usuario-1', VENTA)).resolves.toBe(`/fotos/${ARCHIVO}`);
    });

    it('sin archivo (pendiente o sin firma) es 404 y no mira el disco', async () => {
      const { servicio, fotos } = montar({ archivo: null });
      await expect(servicio.rutaFirma('usuario-1', VENTA)).rejects.toBeInstanceOf(NotFoundException);
      expect(fotos.rutaDeArchivo).not.toHaveBeenCalled();
    });
  });
});
```

En `apps/backend/src/modules/sincronizacion/foto.service.spec.ts`:

1. `montar` gana `firmas` como quinto parámetro:

```ts
  const gastos = {
    existe: jest.fn().mockResolvedValue(true),
    anotarFoto: jest.fn().mockResolvedValue(true),
  };
  const firmas = {
    estadoFirma: jest.fn().mockResolvedValue('espera'),
    anotarFirma: jest.fn().mockResolvedValue(true),
  };
  const servicio = new FotoService(
    repo as never,
    fotos as never,
    visitas as never,
    gastos as never,
    firmas as never,
  );
  return { servicio, repo, fotos, visitas, gastos, firmas };
}
```

2. El caso `'una venta (o cualquier tipo sin foto) es 409'` deja de ser cierto para la venta. Reemplázalo por:

```ts
  it('una cobranza (o cualquier tipo sin foto ni firma) es 409', async () => {
    const { servicio, fotos } = montar([
      operacion({ tipo: 'cobranza', entidadTabla: 'cobro' }),
    ]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });
```

3. Antes de `describe('FotoService.rutaDeCliente (T-39, D9)', …)`, agrega:

```ts
describe('FotoService.subir con la firma de una venta (T-73)', () => {
  // El id de la nota NO es la clave: la venta_nota la crea el servidor.
  const VENTA_ID = 'a1b2c3d4-0000-4000-8000-000000000073';
  const ARCHIVO = `venta-${VENTA_ID}-firma.jpg`;
  const deVenta = (extra: Partial<OperacionParaFoto> = {}) =>
    operacion({
      tipo: 'venta',
      entidadTabla: 'venta_nota',
      entidadId: VENTA_ID,
      ...extra,
    });

  it('una venta que espera firma valida, escribe venta-<id de la nota>-firma.jpg y anota', async () => {
    const { servicio, fotos, firmas, gastos } = montar([deVenta()]);
    const r = await servicio.subir(VENDEDOR, CLAVE, JPEG);
    expect(fotos.validarFoto).toHaveBeenCalledWith(JPEG);
    expect(firmas.estadoFirma).toHaveBeenCalledWith(VENTA_ID);
    expect(fotos.escribirArchivo).toHaveBeenCalledWith(ARCHIVO, JPEG);
    expect(firmas.anotarFirma).toHaveBeenCalledWith(
      VENTA_ID,
      ARCHIVO,
      expect.any(Date),
    );
    expect(gastos.anotarFoto).not.toHaveBeenCalled();
    expect(r.clave).toBe(CLAVE);
  });

  it('reenviar escribe el mismo nombre: un solo archivo', async () => {
    const { servicio, fotos } = montar([deVenta()]);
    await servicio.subir(VENDEDOR, CLAVE, JPEG);
    await servicio.subir(VENDEDOR, CLAVE, JPEG);
    expect(fotos.escribirArchivo).toHaveBeenNthCalledWith(1, ARCHIVO, JPEG);
    expect(fotos.escribirArchivo).toHaveBeenNthCalledWith(2, ARCHIVO, JPEG);
  });

  it('una venta sin proyectar es 409, no escribe ni pregunta por la nota (Review Focus 4)', async () => {
    for (const extra of [
      { entidadTabla: null, entidadId: null },
      { entidadTabla: 'venta_nota', entidadId: null },
    ]) {
      const { servicio, fotos, firmas } = montar([deVenta(extra)]);
      await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(fotos.escribirArchivo).not.toHaveBeenCalled();
      expect(firmas.estadoFirma).not.toHaveBeenCalled();
    }
  });

  it('una venta eliminada o inexistente es 404 y no escribe nada (Review Focus 5)', async () => {
    const { servicio, fotos, firmas } = montar([deVenta()]);
    firmas.estadoFirma.mockResolvedValue('inexistente');
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('una venta que no espera firma es 409 "Esa venta no espera firma." y no escribe nada', async () => {
    const { servicio, fotos, firmas } = montar([deVenta()]);
    firmas.estadoFirma.mockResolvedValue('no-espera');
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toThrow(
      'Esa venta no espera firma.',
    );
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('si la nota se elimina entre escribir y anotar, 404', async () => {
    const { servicio, firmas } = montar([deVenta()]);
    firmas.anotarFirma.mockResolvedValue(false);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('una imagen que no pasa la validacion no toca la venta', async () => {
    const { servicio, fotos, firmas } = montar([deVenta()]);
    fotos.validarFoto.mockImplementation(() => {
      throw new Error('415');
    });
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toThrow('415');
    expect(firmas.estadoFirma).not.toHaveBeenCalled();
    expect(firmas.anotarFirma).not.toHaveBeenCalled();
  });

  it('la firma de la venta de otro vendedor es 403 y no escribe nada', async () => {
    const { servicio, fotos } = montar([deVenta({ vendedorId: 'otro' })]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/backend -- foto-prospecto firmas-venta foto.service` → `firmas-venta.service` no existe,
`nombreArchivoFoto` no acepta `'venta'` ni sufijo, y los casos de venta caen en el 409 genérico.

- [ ] **Paso 3: el nombre del archivo**

En `apps/backend/src/modules/cartera-clientes/foto-prospecto.ts`:

```ts
/** A que fila pertenece una foto. El prefijo del archivo lo dice (T-78). T-73: la firma de una venta. */
export type EntidadFoto = 'cliente' | 'visita' | 'gasto' | 'venta';
```

y `nombreArchivoFoto` gana el sufijo (agrega al final de su comentario la línea
`* T-73: \`sufijo\` nombra una imagen de la fila que no es "la foto": la firma de una venta es \`venta-<id>-firma.jpg\`.`):

```ts
export function nombreArchivoFoto(
  entidad: EntidadFoto,
  id: string,
  sufijo?: 'firma',
): string {
  if (!claveNombrable(id)) {
    throw new Error(
      `id no utilizable como nombre de archivo: ${JSON.stringify(id)}`,
    );
  }
  return `${entidad}-${id}${sufijo === undefined ? '' : `-${sufijo}`}.jpg`;
}
```

- [ ] **Paso 4: el dueño de las columnas de firma**

`apps/backend/src/modules/ventas-cobranza/firmas-venta.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

/** Lo que dice una nota de su firma, para el canal de fotos (T-73). */
export type EstadoFirmaVenta = 'inexistente' | 'no-espera' | 'espera';

/**
 * Las columnas de firma de `venta_nota` fuera de la transaccion del push
 * (T-73). `VentasRepository` no inyecta la conexion a proposito (todo lo suyo
 * corre en la `trx` de quien llama); el canal de fotos y el portal leen y
 * escriben sueltos, como `GastosRepository.existe/anotarFoto`.
 */
@Injectable()
export class FirmasVentaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Inexistente (o eliminada), viva sin firma esperada, o viva esperandola. Tres
   * respuestas y no un booleano: el canal contesta 404 a la primera y 409 a la
   * segunda.
   */
  async estadoFirma(id: string): Promise<EstadoFirmaVenta> {
    const fila = await this.db
      .selectFrom('venta_nota')
      .select('firma_esperada')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!fila) return 'inexistente';
    return fila.firma_esperada ? 'espera' : 'no-espera';
  }

  /**
   * Anota la imagen. `false` si la nota se elimino (o dejo de esperar firma)
   * entre la comprobacion y la escritura del archivo.
   *
   * El trigger de `updated_at` la mueve: una nota a credito vuelve a bajar en el
   * pull incremental, lo que es inofensivo (la tablet hace upsert por id).
   */
  async anotarFirma(
    id: string,
    archivo: string,
    subidaEn: Date,
  ): Promise<boolean> {
    const fila = await this.db
      .updateTable('venta_nota')
      .set({ firma_archivo: archivo, firma_subida_en: subidaEn })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .where('firma_esperada', '=', true)
      .returning('id')
      .executeTakeFirst();
    return fila !== undefined;
  }

  /** El archivo de la firma de una nota viva, o `null` si no ha llegado o no hay. */
  async archivoFirma(id: string): Promise<string | null> {
    const fila = await this.db
      .selectFrom('venta_nota')
      .select('firma_archivo')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .where('firma_archivo', 'is not', null)
      .executeTakeFirst();
    return fila?.firma_archivo ?? null;
  }
}
```

`apps/backend/src/modules/ventas-cobranza/firmas-venta.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { FotosService } from '../cartera-clientes/fotos.service';
import { exigirAlcanceSobre } from './alcance-venta';
import {
  FirmasVentaRepository,
  type EstadoFirmaVenta,
} from './firmas-venta.repository';
import { VentasConsultaRepository } from './ventas-consulta.repository';
import { VentasPortalRepository } from './ventas-portal.repository';

const SIN_FIRMA = 'Esa venta no tiene firma.';

/**
 * La firma del cliente en la nota (T-73). Ventas y Cobranza es la duena de
 * `venta_nota` y por tanto de sus columnas de firma (ADR-0009): el canal de
 * fotos de `sincronizacion/` resuelve la clave y despacha aqui, como hace con
 * `GastosService` y `VisitasService`.
 */
@Injectable()
export class FirmasVentaService {
  constructor(
    private readonly repo: FirmasVentaRepository,
    private readonly consulta: VentasConsultaRepository,
    private readonly portal: VentasPortalRepository,
    // La imagen vive en el disco de fotos de Cartera, como el ticket del gasto.
    private readonly fotos: FotosService,
  ) {}

  /** Para el canal de fotos: 404 si `inexistente`, 409 si `no-espera`. */
  estadoFirma(ventaId: string): Promise<EstadoFirmaVenta> {
    return this.repo.estadoFirma(ventaId);
  }

  /** Para el canal de fotos, despues de escribir el archivo. */
  anotarFirma(
    ventaId: string,
    archivo: string,
    subidaEn: Date,
  ): Promise<boolean> {
    return this.repo.anotarFirma(ventaId, archivo, subidaEn);
  }

  /**
   * `GET /ventas/:id/firma`: el mismo alcance que `GET /ventas/:id` (venta viva,
   * 404; otra sucursal, 403 por `exigirAlcanceSobre`), y 404 si la imagen no ha
   * llegado o la venta no la espera.
   */
  async rutaFirma(usuarioId: string, ventaId: string): Promise<string> {
    const cabecera = await this.consulta.cabecera(ventaId);
    if (!cabecera) throw new NotFoundException('No existe esa venta.');
    exigirAlcanceSobre(
      await this.portal.buscarSucursalUsuario(usuarioId),
      cabecera.sucursalCodigo,
    );
    const archivo = await this.repo.archivoFirma(ventaId);
    if (archivo === null) throw new NotFoundException(SIN_FIRMA);
    return this.fotos.rutaDeArchivo(archivo, SIN_FIRMA);
  }
}
```

En `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`:

1. Imports (en orden alfabético con los demás):

```ts
import { FirmasVentaRepository } from './firmas-venta.repository';
import { FirmasVentaService } from './firmas-venta.service';
```

2. En `providers`, después de `VentasEdicionRepository,`:

```ts
    VentasEdicionRepository,
    // T-73: la firma del cliente en la nota
    FirmasVentaService,
    FirmasVentaRepository,
```

3. Los exports pasan a:

```ts
  // T-73: `FirmasVentaService` para el canal de fotos de sincronizacion/.
  exports: [VentasService, CobranzasService, FirmasVentaService],
```

- [ ] **Paso 5: el canal de fotos**

En `apps/backend/src/modules/sincronizacion/foto.service.ts`:

1. Import: `import { FirmasVentaService } from '../ventas-cobranza/firmas-venta.service';`
2. El constructor gana, después de `gastos`:

```ts
    // T-73: Ventas y Cobranza es la duena de `venta_nota` y de sus columnas de firma.
    private readonly firmas: FirmasVentaService,
```

3. Los textos genéricos nombran la venta. El 404:

```ts
      throw new NotFoundException(
        'No hay ninguna operacion con esa clave. Sincroniza el prospecto, la visita, el gasto o la venta antes de subir su foto.',
      );
```

el 403:

```ts
      throw new ForbiddenException(
        'Esa operacion no es tuya: la foto solo la puede subir el vendedor que registro el prospecto, la visita, el gasto o la venta.',
      );
```

4. Después del bloque `if (mia.tipo === 'gasto') { … }` y antes del `throw` final:

```ts
    if (mia.tipo === 'venta') {
      // T-73. Mismo 409 que la visita: la nota todavia no existe, la tablet
      // reintenta en la siguiente sincronizacion (Review Focus 4).
      if (mia.entidadTabla !== 'venta_nota' || mia.entidadId === null) {
        throw new ConflictException(
          'Esa venta todavia no esta proyectada. Reintenta en la siguiente sincronizacion.',
        );
      }
      const subidaEn = await this.guardarFirmaDeVenta(mia.entidadId, cuerpo);
      return { clave, subida_en: subidaEn.toISOString() };
    }
```

y el `throw` final queda:

```ts
    // Cualquier otro tipo no tiene foto. `409` y no `400`: la peticion esta
    // bien formada, lo que no encaja es el estado del servidor.
    throw new ConflictException(
      `La operacion ${clave} es de tipo "${mia.tipo}", y solo un prospecto, una visita, un gasto o una venta (su firma) lleva imagen.`,
    );
```

5. Después de `guardarDeGasto`:

```ts
  /**
   * La firma del cliente de una venta (T-73): mismas reglas de bytes y mismo
   * orden que la foto del gasto — el archivo primero, la columna despues. El
   * nombre sale del id de la NOTA (no de la clave), con el sufijo `firma`:
   * reenviar escribe el mismo `venta-<id>-firma.jpg`.
   *
   * Una nota eliminada en el portal es 404: la tablet la descarta (Review Focus
   * 5). Una que no espera firma (venta de una app vieja) es 409.
   */
  private async guardarFirmaDeVenta(
    ventaId: string,
    cuerpo: Buffer,
  ): Promise<Date> {
    this.fotos.validarFoto(cuerpo);
    const estado = await this.firmas.estadoFirma(ventaId);
    if (estado === 'inexistente') {
      throw new NotFoundException('Esa venta ya no existe.');
    }
    if (estado === 'no-espera') {
      throw new ConflictException('Esa venta no espera firma.');
    }
    const archivo = nombreArchivoFoto('venta', ventaId, 'firma');
    await this.fotos.escribirArchivo(archivo, cuerpo);
    const subidaEn = new Date();
    if (!(await this.firmas.anotarFirma(ventaId, archivo, subidaEn))) {
      throw new NotFoundException('Esa venta ya no existe.');
    }
    return subidaEn;
  }
```

6. En el comentario de la clase, `resolver la clave (prospecto, visita o gasto; T-39, T-30)` pasa a
   `resolver la clave (prospecto, visita, gasto o venta; T-39, T-30, T-73)`.

En `apps/backend/src/modules/sincronizacion/foto.controller.ts`, la primera línea del comentario de la clase pasa a
` * La foto del prospecto (T-40), de la visita (T-39) o del gasto (T-30), o la firma de una venta (T-73), que sube la tablet, y la`
(el resto del comentario no cambia).

- [ ] **Paso 6: correr y ver pasar las unitarias**

`npm test --workspace=apps/backend -- foto-prospecto firmas-venta foto.service` → verde.

- [ ] **Paso 7: el detalle de la venta y el endpoint de la imagen**

En `apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts`:

1. Antes de `export interface CabeceraVenta`:

```ts
/** La firma del cliente (T-73), como la ve el portal. */
export interface FirmaDeVenta {
  /** La tablet la mando con firma: la imagen llega (o llego) por el canal de fotos. */
  esperada: boolean;
  nombre: string | null;
  /** Cuando llego la imagen, en ISO; `null` = todavia no (o no se espera). */
  subidaEn: string | null;
}
```

2. `CabeceraVenta` gana, después de `origen: OrigenVenta;`:

```ts
  /** T-73. */
  firma: FirmaDeVenta;
  /**
   * T-73: el portal toco la nota despues de grabarse
   * (`actualizado_por_usuario_id is not null`): la firma corresponde a la
   * version original.
   */
  editada: boolean;
```

3. En `cabecera(id)`, el tipo de la fila gana

```ts
      firma_esperada: boolean;
      firma_nombre: string | null;
      firma_subida_en: Date | string | null;
      editada: boolean;
```

el `select` gana columnas (la línea `vn.monto_total, vn.status, vn.origen` pasa a):

```sql
             vn.monto_total, vn.status, vn.origen,
             vn.firma_esperada, vn.firma_nombre, vn.firma_subida_en,
             (vn.actualizado_por_usuario_id is not null) as editada
```

y el objeto que devuelve gana, después de `origen: f.origen as OrigenVenta,`:

```ts
      firma: {
        esperada: f.firma_esperada,
        nombre: f.firma_nombre,
        subidaEn:
          f.firma_subida_en === null
            ? null
            : new Date(f.firma_subida_en).toISOString(),
      },
      editada: f.editada,
```

En `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts`:

1. Imports: `import { createReadStream } from 'node:fs';` arriba; suma `Header` y `StreamableFile` al import de
   `@nestjs/common`; `import { FirmasVentaService } from './firmas-venta.service';`.
2. El constructor gana, después de `edicion`:

```ts
    // T-73: la imagen de la firma del cliente.
    private readonly firmas: FirmasVentaService,
```

3. Después del handler `detalle` (`@Get(':id')`):

```ts
  /**
   * T-73: la imagen de la firma del cliente. Mismo alcance que el detalle (solo
   * sesion; otra sucursal 403) y mismo patron que `GET /gastos/:id/foto`:
   * `rutaFirma` ya comprobo que el archivo se puede leer, asi que el stream no
   * falla a media respuesta. Sin cache: la firma es un documento del cliente.
   */
  @Get(':id/firma')
  @Header('Cache-Control', 'private, no-store')
  async firma(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const ruta = await this.firmas.rutaFirma(usuarioId, id.toLowerCase());
    return new StreamableFile(createReadStream(ruta), { type: 'image/jpeg' });
  }
```

En `apps/backend/test/ventas-editar.e2e-spec.ts`, caso `'cabecera, líneas con su precio, cobros y banderas'`: el
`toEqual` gana, justo después de `origen: 'portal',`:

```ts
        origen: 'portal',
        // T-73: la venta del portal no espera firma y no se ha editado.
        firma: { esperada: false, nombre: null, subidaEn: null },
        editada: false,
```

- [ ] **Paso 8: el e2e de la imagen y del portal**

En `apps/backend/test/venta-firma.e2e-spec.ts`:

1. Imports: después de `import { promises as fs } from 'node:fs';` agrega `import { join } from 'node:path';`, y
   después del import de `segmento-vendedor` agrega
   `import type { VentaDetalle } from './../src/modules/ventas-cobranza/ventas-consulta.service';`.

2. Después de `const FECHA = '2015-06-15';`:

```ts
const LOGIN_AJENO = `e2e-firma-a-${SUFIJO}`;
const LOGIN_GENERAL = `e2e-firma-gen-${SUFIJO}`;
const LOGIN_MX = `e2e-firma-mx-${SUFIJO}`;
```

3. Después de la función `notaPorFolio` (la última auxiliar, justo antes de `beforeAll`):

```ts
  let vendedorAjenoId: string;
  let bearerAjeno: string;
  let usuarioGeneralId: string;
  let usuarioMxId: string;
  let cookieGeneral: string;
  let cookieMx: string;

  const http = () => request(app.getHttpServer());

  const jpeg = (relleno = 'firma'): Buffer =>
    Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(relleno, 'utf8'),
      Buffer.from([0xff, 0xd9]),
    ]);

  const subirFoto = (clave: string, cuerpo: Buffer, token = bearer) =>
    http()
      .post(`/sync/foto/${clave}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/jpeg')
      .send(cuerpo);

  const archivos = async (id: string) =>
    (await fs.readdir(FOTOS_DIR_PRUEBA)).filter((n) => n.includes(id));

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await http()
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
    sucursalId: string | null,
  ): Promise<string> => {
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({
        login,
        nombre: login,
        password_hash: await app.get(PasswordService).hashear(PASSWORD),
        perfil_id: perfilId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const detalle = async (id: string, cookie = cookieGeneral) =>
    (await http().get(`/ventas/${id}`).set('Cookie', cookie).expect(200))
      .body as VentaDetalle;

  const bajarFirma = (id: string, cookie = cookieGeneral) =>
    http()
      .get(`/ventas/${id}/firma`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, fin) => {
        const partes: Buffer[] = [];
        res.on('data', (p: Buffer) => partes.push(p));
        res.on('end', () => fin(null, Buffer.concat(partes)));
      });

  /** Empuja una venta con firma y devuelve su clave y el id de su nota. */
  const ventaFirmada = async (nombre: string | null = 'Doña Lupe') => {
    const op = venta({ firma: { nombre } });
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    const nota = await notaPorFolio(op.folio);
    if (!nota) throw new Error('La venta no se proyecto.');
    return { clave: op.clave, ventaId: nota.id };
  };
```

4. Al final de `beforeAll`, después de calcular `bearer`:

```ts
    const mxId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;
    vendedorAjenoId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_AJENO,
          nombre: 'Vendedor ajeno de la firma',
          password_hash: await app.get(PasswordService).hashear(PASSWORD),
          sucursal_id: tjId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const loginAjeno = await http()
      .post('/auth/app/login')
      .send({ login: LOGIN_AJENO, password: PASSWORD })
      .expect(200);
    bearerAjeno = (loginAjeno.body as { tokenAcceso: string }).tokenAcceso;

    usuarioGeneralId = await crearUsuario(LOGIN_GENERAL, null);
    usuarioMxId = await crearUsuario(LOGIN_MX, mxId);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieMx = await iniciarSesion(LOGIN_MX);
```

5. En `afterAll`, reemplaza las dos últimas limpiezas de vendedor:

```ts
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
```

por:

```ts
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    // Despues de borrar las notas: `eliminado_por_usuario_id` apunta al usuario.
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', [usuarioGeneralId, usuarioMxId])
      .execute();
    await db
      .deleteFrom('usuario')
      .where('id', 'in', [usuarioGeneralId, usuarioMxId])
      .execute();
```

6. Al final, antes del último `});` del `describe` principal, agrega:

```ts
  describe('imagen por el canal de fotos', () => {
    it('la firma de una venta aplicada se guarda como venta-<id>-firma.jpg y se anota en la nota', async () => {
      const { clave, ventaId } = await ventaFirmada();
      const bytes = jpeg('firma de Lupe');

      const res = await subirFoto(clave, bytes).expect(200);
      expect(res.body).toMatchObject({ clave });
      expect(await archivos(ventaId)).toEqual([`venta-${ventaId}-firma.jpg`]);
      expect(
        await fs.readFile(join(FOTOS_DIR_PRUEBA, `venta-${ventaId}-firma.jpg`)),
      ).toEqual(bytes);
      const nota = await db
        .selectFrom('venta_nota')
        .select(['firma_archivo', 'firma_subida_en'])
        .where('id', '=', ventaId)
        .executeTakeFirstOrThrow();
      expect(nota.firma_archivo).toBe(`venta-${ventaId}-firma.jpg`);
      expect(nota.firma_subida_en).not.toBeNull();
    });

    it('reenviar la firma deja un solo archivo, con lo ultimo que llego', async () => {
      const { clave, ventaId } = await ventaFirmada();
      await subirFoto(clave, jpeg('primer intento')).expect(200);
      const segunda = jpeg('segundo intento');
      await subirFoto(clave, segunda).expect(200);
      expect(await archivos(ventaId)).toEqual([`venta-${ventaId}-firma.jpg`]);
      expect(
        await fs.readFile(join(FOTOS_DIR_PRUEBA, `venta-${ventaId}-firma.jpg`)),
      ).toEqual(segunda);
    });

    it('una venta sin firma (app anterior a T-73) responde 409 y no deja archivo', async () => {
      const op = venta();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      const nota = await notaPorFolio(op.folio);
      const res = await subirFoto(op.clave, jpeg()).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Esa venta no espera firma.',
      );
      expect(await archivos(nota?.id ?? 'sin-nota')).toEqual([]);
    });

    it('la firma de una venta rechazada es 404 y nunca deja archivo (Review Focus 4)', async () => {
      const op = venta({ firma: { nombre: 'x'.repeat(81) } });
      expect((await push([op])).resultados[0].estado).toBe('rechazada');
      await subirFoto(op.clave, jpeg()).expect(404);
      expect(await archivos(op.clave)).toEqual([]);
    });

    it('la firma de una venta eliminada en el portal es 404 y no deja archivo (Review Focus 5)', async () => {
      const { clave, ventaId } = await ventaFirmada();
      await http()
        .delete(`/ventas/${ventaId}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      await subirFoto(clave, jpeg()).expect(404);
      expect(await archivos(ventaId)).toEqual([]);
    });

    it('la firma de la venta de otro vendedor es 403 y no deja archivo', async () => {
      const { clave, ventaId } = await ventaFirmada();
      await subirFoto(clave, jpeg(), bearerAjeno).expect(403);
      expect(await archivos(ventaId)).toEqual([]);
    });
  });

  describe('portal: detalle y GET /ventas/:id/firma', () => {
    it('el detalle trae la firma subida y GET /firma la sirve como JPEG privado sin cache', async () => {
      const { clave, ventaId } = await ventaFirmada();
      const bytes = jpeg('firma para el portal');
      await subirFoto(clave, bytes).expect(200);

      const d = await detalle(ventaId);
      expect(d.firma).toEqual({
        esperada: true,
        nombre: 'Doña Lupe',
        subidaEn: expect.any(String) as string,
      });
      expect(d.editada).toBe(false);

      const res = await bajarFirma(ventaId).expect(200);
      expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toEqual(bytes);
    });

    it('una firma pendiente de subir: esperada sin subidaEn, y GET /firma es 404', async () => {
      const { ventaId } = await ventaFirmada(null);
      expect((await detalle(ventaId)).firma).toEqual({
        esperada: true,
        nombre: null,
        subidaEn: null,
      });
      await bajarFirma(ventaId).expect(404);
    });

    it('una venta sin firma no la espera', async () => {
      const op = venta();
      expect((await push([op])).resultados[0].estado).toBe('aplicada');
      const nota = await notaPorFolio(op.folio);
      expect((await detalle(nota?.id ?? '')).firma).toEqual({
        esperada: false,
        nombre: null,
        subidaEn: null,
      });
    });

    it('editada es true cuando el portal toco la nota', async () => {
      const { ventaId } = await ventaFirmada();
      await db
        .updateTable('venta_nota')
        .set({ actualizado_por_usuario_id: usuarioGeneralId })
        .where('id', '=', ventaId)
        .execute();
      expect((await detalle(ventaId)).editada).toBe(true);
    });

    it('otra sucursal: GET /firma es 403, igual que el detalle', async () => {
      const { clave, ventaId } = await ventaFirmada();
      await subirFoto(clave, jpeg()).expect(200);
      await http().get(`/ventas/${ventaId}`).set('Cookie', cookieMx).expect(403);
      await bajarFirma(ventaId, cookieMx).expect(403);
    });
  });
```

- [ ] **Paso 9: el documento del canal de fotos**

En `docs/contrato-sincronizacion.md`, sección `### Fotos: subida y descarga (canal aparte del lote; T-40, T-39, T-30)`:

1. El título pasa a `### Fotos: subida y descarga (canal aparte del lote; T-40, T-39, T-30, T-73)`.
2. La viñeta de `POST /sync/foto/:clave` pasa a:

```markdown
- **`POST /sync/foto/:clave`** (`@SoloApp`, cuerpo = el JPEG crudo, máx. 2 MB). La `clave` es la de una operación
  `prospecto`, `visita`, `gasto` **o** `venta` (la firma del cliente, T-73) del vendedor del token. 404 si nadie tiene
  esa clave (o la operación se rechazó: no dejó fila) o si la fila ya no existe (una venta eliminada en el portal);
  403 si es de otro vendedor; 409 si es de otro tipo, aún no está proyectada o es una venta que no espera firma
  ("Esa venta no espera firma."); 413 si pesa de más; 415 si no es un JPEG completo. Responde
  `200 { clave, subida_en }` también la primera vez.
```

3. La viñeta del nombre del archivo pasa a:

```markdown
- **Nombre del archivo (T-78):** `cliente-<cliente.id>.jpg`, `visita-<visita.id>.jpg`, `gasto-<gasto.id>.jpg` (T-30) y
  `venta-<venta_nota.id>-firma.jpg` (T-73), nunca la clave. Reenviar escribe el mismo nombre: un solo archivo. Los
  archivos de antes (`<clave>.jpg`) no se migran; el servidor siempre lee por `foto_archivo` / `firma_archivo`.
```

4. La viñeta de dónde se anota cada foto gana al final:
   `; la firma de la venta, en \`venta_nota.firma_archivo/firma_subida_en\` (solo si \`firma_esperada\`).`
5. La última viñeta (`GET /sync/foto/cliente/:clienteId`) gana al final:
   ` La firma de la venta tampoco baja; el portal la ve en \`GET /ventas/:id/firma\`.`

- [ ] **Paso 10: lint, typecheck, regresión y commit**

```bash
npm exec --workspace=apps/backend -- prettier --write src/modules/cartera-clientes/foto-prospecto.ts src/modules/cartera-clientes/foto-prospecto.spec.ts src/modules/ventas-cobranza/firmas-venta.repository.ts src/modules/ventas-cobranza/firmas-venta.service.ts src/modules/ventas-cobranza/firmas-venta.service.spec.ts src/modules/ventas-cobranza/ventas-cobranza.module.ts src/modules/sincronizacion/foto.service.ts src/modules/sincronizacion/foto.service.spec.ts src/modules/sincronizacion/foto.controller.ts src/modules/ventas-cobranza/ventas-consulta.repository.ts src/modules/ventas-cobranza/ventas.controller.ts test/ventas-editar.e2e-spec.ts test/venta-firma.e2e-spec.ts
npm exec --workspace=apps/backend -- eslint src/modules/cartera-clientes/foto-prospecto.ts src/modules/cartera-clientes/foto-prospecto.spec.ts src/modules/ventas-cobranza/firmas-venta.repository.ts src/modules/ventas-cobranza/firmas-venta.service.ts src/modules/ventas-cobranza/firmas-venta.service.spec.ts src/modules/ventas-cobranza/ventas-cobranza.module.ts src/modules/sincronizacion/foto.service.ts src/modules/sincronizacion/foto.service.spec.ts src/modules/sincronizacion/foto.controller.ts src/modules/ventas-cobranza/ventas-consulta.repository.ts src/modules/ventas-cobranza/ventas.controller.ts test/ventas-editar.e2e-spec.ts test/venta-firma.e2e-spec.ts
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- venta-firma ventas-editar gasto-foto-pull foto-prospecto visita cobranzas-portal peticiones
git add apps/backend/src/modules/cartera-clientes/foto-prospecto.ts apps/backend/src/modules/cartera-clientes/foto-prospecto.spec.ts apps/backend/src/modules/ventas-cobranza/firmas-venta.repository.ts apps/backend/src/modules/ventas-cobranza/firmas-venta.service.ts apps/backend/src/modules/ventas-cobranza/firmas-venta.service.spec.ts apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts apps/backend/src/modules/sincronizacion/foto.service.ts apps/backend/src/modules/sincronizacion/foto.service.spec.ts apps/backend/src/modules/sincronizacion/foto.controller.ts apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts apps/backend/src/modules/ventas-cobranza/ventas.controller.ts apps/backend/test/ventas-editar.e2e-spec.ts apps/backend/test/venta-firma.e2e-spec.ts docs/contrato-sincronizacion.md
git commit -m "T-73: la firma sube por el canal de fotos y el portal la lee en el detalle y en GET /ventas/:id/firma

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Si otro e2e compara el detalle de una venta con `toEqual` exacto y ahora falla solo por `firma`/`editada`, agrégale
esos dos campos con los valores que correspondan (no relajes la comparación a `toMatchObject`).

---

### Tarea 5: Portal: bloque "Firma del cliente" en el detalle de la venta (portal del spec)

**Files:**
- Modify: `apps/portal/src/lib/ventas.ts` (`FirmaDeVenta`, `VentaDetalle.firma`/`editada`, `descargarFirmaVenta`)
- Create: `apps/portal/src/components/ventas/firma-venta.tsx`
- Modify: `apps/portal/src/components/ventas/detalle-venta.tsx`
- Test: `apps/portal/src/components/ventas/detalle-venta.test.tsx`
- Modify (solo el literal `VentaDetalle` de prueba): `apps/portal/src/components/ventas/pantalla-ventas.test.tsx`,
  `apps/portal/src/components/ventas/formulario-editar-venta.test.tsx`, `apps/portal/src/lib/ventas.test.ts`

**Interfaces:**
- Consumes (Tarea 4): `GET /ventas/:id` con `firma: { esperada, nombre, subidaEn }` y `editada`;
  `GET /ventas/:id/firma` (JPEG); `apiFetchBlob` de `lib/api.ts`.
- Produces:
  - `export interface FirmaDeVenta { esperada: boolean; nombre: string | null; subidaEn: string | null }`;
    `VentaDetalle.firma: FirmaDeVenta`, `VentaDetalle.editada: boolean`.
  - `export function descargarFirmaVenta(id: string): Promise<Blob>`.
  - `export function FirmaVenta({ ventaId, firma, editada }: { ventaId: string; firma: FirmaDeVenta; editada: boolean })`.

> La imagen se pide con `fetch` (`apiFetchBlob`) y se pinta con una URL de objeto, no con `<img src="/ventas/:id/firma">`:
> un `<img>` no refresca la sesión y a los 15 minutos saldría rota sin error (mismo motivo que `FotoProspecto` y el
> ticket del gasto). Los bytes son los de `GET /ventas/:id/firma`.

- [ ] **Paso 1: las pruebas que fallan**

En `apps/portal/src/components/ventas/detalle-venta.test.tsx`:

1. El mock de `@/lib/ventas` gana `descargarFirmaVenta`:

```ts
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return {
    ...real,
    eliminarVenta: vi.fn(),
    marcarCuentaPerdida: vi.fn(),
    obtenerVenta: vi.fn(),
    descargarFirmaVenta: vi.fn(),
  };
});
```

y, junto a los demás `vi.mocked`:

```ts
const descargarFirmaVenta = vi.mocked(ventasLib.descargarFirmaVenta);
```

2. El literal `VENTA` gana, después de `puedeMarcarPerdida: true,`:

```ts
  // T-73: la venta de prueba es del portal: no espera firma.
  firma: { esperada: false, nombre: null, subidaEn: null },
  editada: false,
```

3. En el `beforeEach` del `describe("DetalleVenta", …)`, después de `mockAuth(() => true);`:

```ts
    // jsdom no tiene almacén de blobs (ver foto-prospecto.test.tsx).
    URL.createObjectURL = vi.fn(() => "blob:firma");
    URL.revokeObjectURL = vi.fn();
    descargarFirmaVenta.mockResolvedValue(new Blob(["firma"]));
```

4. Al final del archivo agrega (en el import de `@testing-library/react` suma `waitFor`):

```ts
describe("DetalleVenta · firma del cliente (T-73)", () => {
  const conFirma = (firma: VentaDetalle["firma"], editada = false): VentaDetalle => ({
    ...VENTA,
    origen: "app",
    firma,
    editada,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(() => true);
    URL.createObjectURL = vi.fn(() => "blob:firma");
    URL.revokeObjectURL = vi.fn();
    descargarFirmaVenta.mockResolvedValue(new Blob(["firma"]));
  });

  it("subida: la imagen, quién firmó y que se firmó en la tablet", async () => {
    renderizar(conFirma({ esperada: true, nombre: "Doña Lupe", subidaEn: "2026-10-21T19:00:00.000Z" }));
    const imagen = await screen.findByAltText("Firma del cliente");
    expect(imagen).toHaveAttribute("src", "blob:firma");
    expect(descargarFirmaVenta).toHaveBeenCalledWith("v1");
    expect(screen.getByText("Firmó: Doña Lupe")).toBeInTheDocument();
    expect(screen.getByText("Firmada en la tablet")).toBeInTheDocument();
  });

  it("subida sin nombre: sin la línea de quién firmó", async () => {
    renderizar(conFirma({ esperada: true, nombre: null, subidaEn: "2026-10-21T19:00:00.000Z" }));
    await screen.findByAltText("Firma del cliente");
    expect(screen.queryByText(/^Firmó:/)).not.toBeInTheDocument();
  });

  it("esperada y sin subir: pendiente de la sincronización, sin pedir la imagen", () => {
    renderizar(conFirma({ esperada: true, nombre: "Doña Lupe", subidaEn: null }));
    expect(
      screen.getByText("Firma pendiente de subir: llega cuando el vendedor sincronice."),
    ).toBeInTheDocument();
    expect(descargarFirmaVenta).not.toHaveBeenCalled();
  });

  it("no esperada: sin firma, sin pedir la imagen", () => {
    renderizar(conFirma({ esperada: false, nombre: null, subidaEn: null }));
    expect(
      screen.getByText("Sin firma (venta capturada en oficina o anterior a la firma en tablet)."),
    ).toBeInTheDocument();
    expect(descargarFirmaVenta).not.toHaveBeenCalled();
  });

  it("firmada y editada en el portal: avisa que la firma es de la versión original", async () => {
    renderizar(conFirma({ esperada: true, nombre: null, subidaEn: "2026-10-21T19:00:00.000Z" }, true));
    await screen.findByAltText("Firma del cliente");
    expect(
      screen.getByText(
        "Esta nota se editó en el portal después de firmarse; la firma corresponde a la versión original.",
      ),
    ).toBeInTheDocument();
  });

  it("editada pero sin firma: no hay aviso", () => {
    renderizar(conFirma({ esperada: false, nombre: null, subidaEn: null }, true));
    expect(screen.queryByText(/después de firmarse/)).not.toBeInTheDocument();
  });

  it("si la imagen no baja, lo dice sin romper el detalle", async () => {
    descargarFirmaVenta.mockRejectedValue(new Error("red"));
    renderizar(conFirma({ esperada: true, nombre: "Doña Lupe", subidaEn: "2026-10-21T19:00:00.000Z" }));
    await waitFor(() => expect(screen.getByText("No se pudo cargar la firma.")).toBeInTheDocument());
    expect(screen.getByText("Firmó: Doña Lupe")).toBeInTheDocument();
  });
});
```

En `pantalla-ventas.test.tsx`, `formulario-editar-venta.test.tsx` y `lib/ventas.test.ts`, el literal `VentaDetalle`
gana, justo después de su línea `puedeMarcarPerdida: …,`:

```ts
  firma: { esperada: false, nombre: null, subidaEn: null },
  editada: false,
```

- [ ] **Paso 2: correr y ver fallar**

`npm test --workspace=apps/portal -- detalle-venta` → no existe `descargarFirmaVenta` y el detalle no muestra el bloque.

- [ ] **Paso 3: tipos y descarga**

En `apps/portal/src/lib/ventas.ts`:

1. El import pasa a `import { apiFetch, apiFetchBlob } from "./api";`.
2. Antes de `export interface VentaDetalle`:

```ts
/** La firma del cliente en la nota (T-73). */
export interface FirmaDeVenta {
  /** La tablet la mandó con firma: la imagen llega (o llegó) al sincronizar. */
  esperada: boolean;
  nombre: string | null;
  /** Cuándo llegó la imagen, en ISO; `null` = todavía no (o no se espera). */
  subidaEn: string | null;
}
```

3. `VentaDetalle` gana, después de `puedeMarcarPerdida: boolean;`:

```ts
  /** T-73. */
  firma: FirmaDeVenta;
  /** T-73: el portal tocó la nota después de grabarse. */
  editada: boolean;
```

4. Después de `obtenerVenta`:

```ts
/** La imagen de la firma (T-73). Con `fetch` y no con `<img src>`: ver `FotoProspecto`. */
export function descargarFirmaVenta(id: string): Promise<Blob> {
  return apiFetchBlob(`/ventas/${encodeURIComponent(id)}/firma`);
}
```

- [ ] **Paso 4: el bloque**

`apps/portal/src/components/ventas/firma-venta.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { descargarFirmaVenta, type FirmaDeVenta } from "@/lib/ventas";

/**
 * La firma del cliente en el detalle de la venta (T-73). Tres estados, del
 * servidor (`firma.esperada`, `firma.subidaEn`): subida, pendiente de subir o
 * sin firma (venta del portal o de una app anterior).
 *
 * Los bytes se piden con `fetch` y se pintan con una URL de objeto que se revoca
 * al desmontar, como `FotoProspecto`. Fondo blanco y borde: la firma es un papel.
 */
export function FirmaVenta({
  ventaId,
  firma,
  editada,
}: {
  ventaId: string;
  firma: FirmaDeVenta;
  editada: boolean;
}) {
  const subida = firma.subidaEn !== null;
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    if (!subida) return;
    let vigente = true;
    let creada: string | null = null;
    descargarFirmaVenta(ventaId)
      .then((blob) => {
        if (!vigente) return;
        creada = URL.createObjectURL(blob);
        setUrl(creada);
      })
      .catch(() => {
        if (vigente) setFallo(true);
      });
    return () => {
      vigente = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [ventaId, subida]);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Firma del cliente</h3>

      {subida && (
        <>
          {fallo && <p className="text-sm text-muted-foreground">No se pudo cargar la firma.</p>}
          {!fallo && url === null && <p className="text-sm text-muted-foreground">Cargando la firma…</p>}
          {url !== null && (
            // eslint-disable-next-line @next/next/no-img-element -- el src es una URL de objeto
            // (blob:) creada en el navegador: next/image no puede ver estos bytes.
            <img
              src={url}
              alt="Firma del cliente"
              className="max-h-40 w-fit max-w-full rounded-md border bg-white object-contain p-1"
            />
          )}
          {firma.nombre && <p className="text-sm">{`Firmó: ${firma.nombre}`}</p>}
          <p className="text-sm text-muted-foreground">Firmada en la tablet</p>
        </>
      )}

      {!subida && firma.esperada && (
        <p className="text-sm text-muted-foreground">
          Firma pendiente de subir: llega cuando el vendedor sincronice.
        </p>
      )}

      {!firma.esperada && (
        <p className="text-sm text-muted-foreground">
          Sin firma (venta capturada en oficina o anterior a la firma en tablet).
        </p>
      )}

      {firma.esperada && editada && (
        <p role="note" className="rounded-md border p-3 text-sm">
          Esta nota se editó en el portal después de firmarse; la firma corresponde a la versión original.
        </p>
      )}
    </section>
  );
}
```

(`max-h-40` = 160 px, el alto máximo del spec.)

En `apps/portal/src/components/ventas/detalle-venta.tsx`: importa `import { FirmaVenta } from "./firma-venta";` y,
justo después del `</section>` de "Cobros" (antes de `{pidiendo && (`), agrega:

```tsx
        <FirmaVenta ventaId={venta.id} firma={venta.firma} editada={venta.editada} />
```

- [ ] **Paso 5: correr y ver pasar; tipos, lint y la pantalla**

```bash
npm test --workspace=apps/portal -- detalle-venta pantalla-ventas formulario-editar-venta ventas
npx tsc --noEmit -p apps/portal
npm run lint --workspace=apps/portal
```

Mira el bloque en el navegador a **1366 px** con una venta de cada estado (si no hay backend a mano, basta con que el
bloque sea una columna dentro de la tarjeta del detalle, que ya cabe: no agrega ancho fijo).

- [ ] **Paso 6: commit**

```bash
git add apps/portal/src/lib/ventas.ts apps/portal/src/components/ventas/firma-venta.tsx apps/portal/src/components/ventas/detalle-venta.tsx apps/portal/src/components/ventas/detalle-venta.test.tsx apps/portal/src/components/ventas/pantalla-ventas.test.tsx apps/portal/src/components/ventas/formulario-editar-venta.test.tsx apps/portal/src/lib/ventas.test.ts
git commit -m "T-73 (portal): bloque Firma del cliente en el detalle de la venta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: Tablet: migración 016, la firma en `ventas.registrar`, la cola de firmas y el cuerpo de la venta (datos locales del spec)

**Files:**
- Create: `apps/tablet/src/datos/migraciones/016-firma-venta.ts`
- Test: `apps/tablet/src/datos/migraciones/016-firma-venta.spec.ts`
- Modify: `apps/tablet/src/datos/migraciones/index.ts`
- Modify: `apps/tablet/src/datos/migraciones/015-gastos.spec.ts` (deja de ser la última)
- Modify: `apps/tablet/src/datos/tipos.ts` (`Venta` gana las cinco columnas)
- Modify: `apps/tablet/src/datos/repositorios/ventas.ts`
- Modify: `apps/tablet/src/datos/pruebas-apoyo.ts` (`FIRMA_DE_PRUEBA`)
- Test: `apps/tablet/src/datos/repositorios/ventas.spec.ts`
- Modify (cada `ventas.registrar` gana `firma`): `apps/tablet/src/datos/repositorios/candado-jornada.spec.ts`,
  `cobranzas.spec.ts`, `promociones.spec.ts`, `rutas.spec.ts`, `apps/tablet/src/sincronizacion/pendientes.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/api-foto.ts` (`FotoTemporalError.status`) · Test: `api-foto.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/fuente-fotos.ts` (`fallaDefinitiva`, `fuenteFirmasVentas`) · Test:
  `fuente-fotos.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/motor.ts` (descarte por `fallaDefinitiva`) · Test: `motor.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/fuente-ventas.ts` (`firma: { nombre }`) · Test: `fuente-ventas.spec.ts`
- Modify: `apps/tablet/src/estado/proveedor-sesion.tsx` (la cola suma las firmas después de los gastos)
- Modify: `docs/contrato-sincronizacion.md` (una frase en "Fotos": qué hace la tablet con el 404 de una firma)

**Interfaces:**
- Consumes (Tareas 1 y 3): `LARGO_MAX_NOMBRE_FIRMA`, `nombreFirmaValido` (`src/datos/reglas-firma.ts`);
  `DatosVenta.firma?: FirmaVenta | null` en `src/sincronizacion/contrato.ts`.
- Produces:
  - Migración 16 `firma-venta`: `venta.firma_local text`, `firma_nombre text`, `firma_subida_en text`,
    `firma_error text`, `firma_descartada integer not null default 0` (0/1) e índice `idx_venta_firma_pendiente`.
  - `Venta.firma_local: string | null`, `firma_nombre: string | null`, `firma_subida_en: MomentoISO | null`,
    `firma_error: string | null`, `firma_descartada: Booleano`.
  - `export interface FirmaRegistroVenta { uri: string; nombre: string | null }`;
    `DatosRegistroVenta.firma: FirmaRegistroVenta` (**obligatoria**) y `DatosRegistroVenta.id?: string`.
  - `RepositorioVentas.firmasPendientes(): Venta[]`, `marcarFirmaSubida(id: string, subidaEn: MomentoISO): void`,
    `anotarErrorFirma(id: string, motivo: string): void`, `descartarFirma(id: string, motivo: string): void`.
  - `FotoTemporalError.status: number | null` (constructor `(mensaje: string, status: number | null = null)`).
  - `FuenteFotos.fallaDefinitiva?(clave: string, status: number): boolean`; `combinarFuentesFotos` la reenvía a la
    fuente dueña; `export function fuenteFirmasVentas(ventas: RepositorioVentas): FuenteFotos` (`tipo: 'venta'`,
    404 definitivo).
  - `fuenteVentas` agrega `datos.firma = { nombre: firma_nombre }` cuando `firma_local !== null`.
  - `FIRMA_DE_PRUEBA` en `pruebas-apoyo.ts`.

- [ ] **Paso 1: la migración 016, con su prueba que falla**

`apps/tablet/src/datos/migraciones/016-firma-venta.spec.ts`:

```ts
import type { BaseDatos } from '../base-datos';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/**
 * La 016 trae la firma del cliente en la venta (T-73): el mismo esquema
 * derivado que la foto de la visita (013) y del gasto (015), con prefijo
 * `firma_`, y sin tocar `sync_estado`.
 */

function baseAlDia(): BaseDatos {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

/** Una venta como la dejaba la app antes de T-73 (sin columnas de firma). */
function insertarVentaVieja(bd: BaseDatos, cambios: Record<string, string | number | null> = {}) {
  const fila: Record<string, string | number | null> = {
    id: 'venta-vieja',
    fecha: '2026-08-07',
    cliente_id: 'cli-1',
    vendedor_id: 'ven-1',
    sucursal_id: 'suc-tj',
    folio: 'TJ260807AP01',
    contado_credito: 'contado',
    monto_total_centavos: 2800,
    grabada_en: '2026-08-07T15:00:00.000Z',
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into venta (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 016: firma de la venta (T-73)', () => {
  it('la 016 es la ultima y deja versionEsquema en 16', () => {
    expect(migraciones[15]?.nombre).toBe('firma-venta');
    expect(migraciones[15]?.version).toBe(16);
    expect(migraciones).toHaveLength(16);
    expect(versionEsquema(baseAlDia())).toBe(16);
  });

  it('una venta anterior queda sin firma, no descartada y con su sync_estado intacto', () => {
    const bd = baseAlDia();
    insertarVentaVieja(bd);
    expect(
      bd.getFirstSync(
        `select firma_local, firma_nombre, firma_subida_en, firma_error, firma_descartada, sync_estado
           from venta where id = $id`,
        { $id: 'venta-vieja' },
      ),
    ).toEqual({
      firma_local: null,
      firma_nombre: null,
      firma_subida_en: null,
      firma_error: null,
      firma_descartada: 0,
      sync_estado: 'pendiente',
    });
  });

  it('firma_descartada es 0/1', () => {
    const bd = baseAlDia();
    insertarVentaVieja(bd);
    expect(() => bd.runSync(`update venta set firma_descartada = 2 where id = 'venta-vieja'`)).toThrow(/CHECK/);
    expect(() => bd.runSync(`update venta set firma_descartada = 1 where id = 'venta-vieja'`)).not.toThrow();
  });

  it('existe el indice de la cola de firmas', () => {
    expect(
      baseAlDia().getFirstSync<{ name: string }>(
        `select name from sqlite_master where type = 'index' and name = 'idx_venta_firma_pendiente'`,
      ),
    ).toEqual({ name: 'idx_venta_firma_pendiente' });
  });
});
```

`npm test --workspace=apps/tablet -- 016-firma` → falla (no hay migración 16).

`apps/tablet/src/datos/migraciones/016-firma-venta.ts`:

```ts
import type { Migracion } from './motor';

/**
 * La firma del cliente en la venta (T-73).
 *
 * La pantalla captura la firma en la revision, antes de grabar (D3), y
 * `ventas.registrar()` guarda la ruta del JPG y el nombre **en la misma
 * transaccion** que la venta, sus lineas y su folio: no puede quedar una venta
 * grabada sin firma por un cierre de la app a medio camino.
 *
 * La imagen sube despues, por el canal de fotos, con el **mismo esquema
 * derivado** que la foto de la visita (013) y la del gasto (015), con prefijo
 * `firma_`: `firma_local` + `firma_subida_en` + `firma_error` +
 * `firma_descartada`. Ninguna toca `sync_estado`: una firma que no sube no se
 * lleva la venta. Las ventas de antes de la 016 quedan con `firma_local` nulo y
 * nunca entran a la cola.
 *
 * `alter table … add column` alcanza (no hay que rehacer la tabla como en la
 * 009): SQLite admite agregar una columna con `not null default` y `check`.
 */
export const firmaVenta: Migracion = {
  version: 16,
  nombre: 'firma-venta',
  sql: `
    alter table venta add column firma_local text;
    alter table venta add column firma_nombre text;
    alter table venta add column firma_subida_en text;
    alter table venta add column firma_error text;
    alter table venta add column firma_descartada integer not null default 0
      check (firma_descartada in (0, 1));

    -- La cola de firmas, como idx_gasto_foto_pendiente (015).
    create index idx_venta_firma_pendiente on venta (sync_estado)
      where firma_local is not null and firma_subida_en is null and firma_descartada = 0;
  `,
};
```

En `apps/tablet/src/datos/migraciones/index.ts`: `import { firmaVenta } from './016-firma-venta';` (después del de
`015-gastos`) y `firmaVenta,` al final del arreglo, después de `gastos,`.

En `apps/tablet/src/datos/migraciones/015-gastos.spec.ts`, reemplaza el primer `it`:

```ts
  it('la 015 es la ultima y deja versionEsquema en 15', () => {
    expect(migraciones[14]?.nombre).toBe('gastos');
    expect(migraciones[14]?.version).toBe(15);
    expect(migraciones).toHaveLength(15);
    expect(versionEsquema(baseAlDia())).toBe(15);
  });
```

por:

```ts
  it('la 015 es gastos y deja de ser la ultima con la 016 (T-73)', () => {
    expect(migraciones[14]?.nombre).toBe('gastos');
    expect(migraciones[14]?.version).toBe(15);
    expect(versionEsquema(baseAlDia())).toBe(migraciones.length);
  });
```

`npm test --workspace=apps/tablet -- migraciones` → verde.

- [ ] **Paso 2: el tipo `Venta` y el dato de prueba**

En `apps/tablet/src/datos/tipos.ts`, `interface Venta` gana, después de `sincronizado_en: MomentoISO | null;`:

```ts
  /**
   * T-73: ruta local del JPG de la firma del cliente
   * (`documentDirectory/firmas/firma-<id>.jpg`). `null` solo en ventas
   * anteriores a la migracion 016: desde entonces la firma es obligatoria (D1).
   */
  firma_local: string | null;
  /** Quien firmo; `null` si no lo dijo (D2). */
  firma_nombre: string | null;
  /** Cuando recibio la imagen el SERVIDOR. `null` = todavia no esta arriba ("firma por subir"). */
  firma_subida_en: MomentoISO | null;
  /** Ultimo motivo por el que la firma no subio. Se limpia al subir. */
  firma_error: string | null;
  /** `1` = no recuperable (la venta se elimino en el portal, 413, 415, archivo perdido): no se reintenta. */
  firma_descartada: Booleano;
```

En `apps/tablet/src/datos/pruebas-apoyo.ts`, después de `MOMENTO`:

```ts
/**
 * La firma de una venta de prueba (T-73): `ventas.registrar()` la exige (D1).
 * La ruta nunca se abre en las pruebas: solo se guarda y viaja en la cola.
 */
export const FIRMA_DE_PRUEBA: { uri: string; nombre: string | null } = {
  uri: 'file:///documentos/firmas/firma-prueba.jpg',
  nombre: null,
};
```

- [ ] **Paso 3: las pruebas del repositorio, que fallan**

En `apps/tablet/src/datos/repositorios/ventas.spec.ts`:

1. El import de `../pruebas-apoyo` suma `FIRMA_DE_PRUEBA`:
   `import { depsDePrueba, FIRMA_DE_PRUEBA, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';`
2. El helper `venta()` gana `firma: FIRMA_DE_PRUEBA,` justo antes de `...extra,`.
3. Al final del archivo:

```ts
describe('firma del cliente (T-73)', () => {
  const FIRMA = { uri: 'file:///documentos/firmas/firma-x.jpg', nombre: 'Doña Lupe' };

  it('graba la firma en la misma venta: ruta y nombre, por subir y sin error', () => {
    const { ventas } = montar();
    const v = ventas.registrar(venta({ firma: FIRMA }));
    expect(v).toMatchObject({
      firma_local: 'file:///documentos/firmas/firma-x.jpg',
      firma_nombre: 'Doña Lupe',
      firma_subida_en: null,
      firma_error: null,
      firma_descartada: 0,
      sync_estado: 'pendiente',
    });
  });

  it('usa el id que le da la pantalla: el archivo de la firma ya se nombro con el', () => {
    const { folios, ventas } = montar();
    const v = ventas.registrar(venta({ id: 'venta-de-la-pantalla' }));
    expect(v.id).toBe('venta-de-la-pantalla');
    expect(folios.porOperacion('venta-de-la-pantalla')?.folio).toBe(v.folio);
  });

  it('sin firma no graba ni quema folio (D1)', () => {
    const { deps, folios, ventas } = montar();
    expect(() => ventas.registrar(venta({ firma: { uri: '   ', nombre: null } }))).toThrow(ErrorVenta);
    expect(folios.consecutivoDe('ven-1')).toBe(0);
    expect(cuantas(deps, 'venta')).toBe(0);
  });

  it('un nombre sin recortar o de mas de 80 caracteres no se graba', () => {
    const { deps, ventas } = montar();
    expect(() => ventas.registrar(venta({ firma: { uri: FIRMA.uri, nombre: 'x'.repeat(81) } }))).toThrow(
      ErrorVenta,
    );
    expect(() => ventas.registrar(venta({ firma: { uri: FIRMA.uri, nombre: ' Lupe ' } }))).toThrow(ErrorVenta);
    expect(cuantas(deps, 'venta')).toBe(0);
  });

  it('un fallo dentro de la transaccion no deja firma ni folio', () => {
    const { deps, folios, ventas } = montar();
    deps.bd.execSync('drop table venta_linea;');
    expect(() => ventas.registrar(venta({ firma: FIRMA }))).toThrow();
    expect(folios.consecutivoDe('ven-1')).toBe(0);
    expect(
      deps.bd.getFirstSync<{ n: number }>('select count(*) as n from venta where firma_local is not null')?.n,
    ).toBe(0);
  });

  describe('cola de firmas', () => {
    it('solo ofrece firmas de ventas ya sincronizadas: ni pendientes ni rechazadas (Review Focus 4)', () => {
      const { ventas } = montar();
      const aceptada = ventas.registrar(venta());
      const rechazada = ventas.registrar(venta({ numNota: '2347' }));
      ventas.marcarError(rechazada.id, 'precio-no-asignado: el cliente no tiene precio');
      expect(ventas.firmasPendientes()).toEqual([]);

      ventas.marcarSincronizada(aceptada.id);
      expect(ventas.firmasPendientes().map((v) => v.id)).toEqual([aceptada.id]);
    });

    it('una venta anterior a la 016 (sin firma_local) nunca entra a la cola', () => {
      const { deps, ventas } = montar();
      const v = ventas.registrar(venta());
      deps.bd.runSync('update venta set firma_local = null where id = $id', { $id: v.id });
      ventas.marcarSincronizada(v.id);
      expect(ventas.firmasPendientes()).toEqual([]);
    });

    it('marcarFirmaSubida la saca de la cola y limpia el error, sin tocar sync_estado', () => {
      const { ventas } = montar();
      const v = ventas.registrar(venta());
      ventas.marcarSincronizada(v.id);
      ventas.anotarErrorFirma(v.id, 'sin red');
      ventas.marcarFirmaSubida(v.id, '2026-08-07T16:00:00.000Z');
      expect(ventas.porId(v.id)).toMatchObject({
        firma_subida_en: '2026-08-07T16:00:00.000Z',
        firma_error: null,
        sync_estado: 'sincronizado',
      });
      expect(ventas.firmasPendientes()).toEqual([]);
    });

    it('anotarErrorFirma la deja en la cola; descartarFirma la saca; ninguna toca sync_estado', () => {
      const { ventas } = montar();
      const temporal = ventas.registrar(venta());
      const definitiva = ventas.registrar(venta({ numNota: '2347' }));
      ventas.marcarSincronizada(temporal.id);
      ventas.marcarSincronizada(definitiva.id);

      ventas.anotarErrorFirma(temporal.id, 'El servidor respondio 500.');
      ventas.descartarFirma(definitiva.id, 'Esa venta ya no existe.');

      expect(ventas.firmasPendientes().map((v) => v.id)).toEqual([temporal.id]);
      expect(ventas.porId(temporal.id)).toMatchObject({
        firma_error: 'El servidor respondio 500.',
        firma_descartada: 0,
        sync_estado: 'sincronizado',
      });
      expect(ventas.porId(definitiva.id)).toMatchObject({
        firma_error: 'Esa venta ya no existe.',
        firma_descartada: 1,
        sync_estado: 'sincronizado',
      });
    });
  });
});
```

En los demás archivos de prueba que llaman a `ventas.registrar` sin firma, agrega `firma: FIRMA_DE_PRUEBA,` en la
línea siguiente a su `lineas: [ … ],` (y suma `FIRMA_DE_PRUEBA` al import de `pruebas-apoyo` que ya tiene ese
archivo — `'../pruebas-apoyo'` o `'@/datos/pruebas-apoyo'`):

- `src/datos/repositorios/candado-jornada.spec.ts`: la constante `const venta: DatosRegistroVenta = { … }`.
- `src/datos/repositorios/cobranzas.spec.ts`: el `ventas.registrar({ … })` del caso
  `'cobrar no consume numero de la serie…'`.
- `src/datos/repositorios/promociones.spec.ts`: el `ventas.registrar({ … })` con `clienteId: 'cli-2'`.
- `src/datos/repositorios/rutas.spec.ts`: el `ventas.registrar({ … })` de `venderA`.
- `src/sincronizacion/pendientes.spec.ts`: el `ventas.registrar({ … })` del caso que suma pendientes.

`npm test --workspace=apps/tablet -- ventas` → fallan los nuevos (no hay `firma` en `DatosRegistroVenta`, ni
`firmasPendientes`, ni columnas leídas).

- [ ] **Paso 4: el repositorio**

En `apps/tablet/src/datos/repositorios/ventas.ts`:

1. Imports: el `import type { … } from '../tipos';` suma `MomentoISO`; agrega
   `import { LARGO_MAX_NOMBRE_FIRMA, nombreFirmaValido } from '../reglas-firma';`.
2. Después de `export interface RegaloRegistroVenta { … }`:

```ts
/** La firma del cliente (T-73): el JPG ya escrito y el nombre ya normalizado por la pantalla. */
export interface FirmaRegistroVenta {
  /** Ruta local del JPG (`documentDirectory/firmas/firma-<id>.jpg`). */
  uri: string;
  /** `null` = no dijo su nombre (D2). */
  nombre: string | null;
}
```

3. `DatosRegistroVenta` gana, al principio:

```ts
  /**
   * T-73: el id lo genera la pantalla ANTES de grabar, para nombrar con el el
   * archivo de la firma. Sin el, lo genera este repositorio (como antes).
   */
  id?: string;
```

   y, al final:

```ts
  /** T-73 (D1): obligatoria. Se guarda en la misma transaccion que la venta y su folio. */
  firma: FirmaRegistroVenta;
```

4. En `registrar`, justo después del bloque que comprueba que cada regalo tenga línea (el `for` sobre
   `regaladas.keys()`) y antes de `const id = generarId();`:

```ts
      // T-73 (D1): sin firma no hay venta. La pantalla no deja llegar aqui sin
      // ella; esto es la red por si otra pantalla llamara a `registrar`. Va antes
      // de abrir la transaccion: no se quema folio.
      if (datos.firma.uri.trim() === '') {
        throw new ErrorVenta('Falta la firma del cliente. Pídele que firme antes de grabar.');
      }
      if (!nombreFirmaValido(datos.firma.nombre)) {
        throw new ErrorVenta(
          `El nombre de quien firma no es válido (de 1 a ${LARGO_MAX_NOMBRE_FIRMA} caracteres, sin espacios al inicio ni al final).`,
        );
      }
```

5. `const id = generarId();` pasa a `const id = datos.id ?? generarId();`.
6. El `insert into venta` gana las dos columnas:

```ts
        bd.runSync(
          `insert into venta (
             id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
             contado_credito, factura, comentarios, monto_total_centavos,
             grabada_en, sync_estado, firma_local, firma_nombre
           ) values (
             $id, $fecha, $cliente_id, $vendedor_id, $sucursal_id, $folio, $num_nota,
             $contado_credito, $factura, $comentarios, $monto_total_centavos,
             $grabada_en, 'pendiente', $firma_local, $firma_nombre
           )`,
```

   y en sus parámetros, después de `$grabada_en: ahora,`:

```ts
            $grabada_en: ahora,
            // T-73: la firma entra o sale con la venta y el folio.
            $firma_local: datos.firma.uri,
            $firma_nombre: datos.firma.nombre,
```

7. Después de `marcarError`, antes del cierre del objeto `repo`:

```ts
    // ----------------------------------------------------------------------
    // La firma del cliente (T-73). Mismo reparto que la foto del gasto
    // (`gastos.ts`): estos `update` no mencionan `sync_estado` ni `sync_error`.
    // Una firma que no sube no se lleva la venta.
    // ----------------------------------------------------------------------

    /**
     * Firmas por subir: de ventas ya **sincronizadas**. Antes, la nota no existe
     * en el servidor (el canal responde 409) y una venta rechazada no dejo fila
     * (404): reintentarlas solo gastaria WiFi (Review Focus 4).
     */
    firmasPendientes(): Venta[] {
      return bd.getAllSync<Venta>(
        `select * from venta
          where sync_estado = 'sincronizado'
            and firma_local is not null
            and firma_subida_en is null
            and firma_descartada = 0
          order by fecha, grabada_en, rowid`,
      );
    },

    marcarFirmaSubida(id: string, subidaEn: MomentoISO): void {
      bd.runSync(`update venta set firma_subida_en = $en, firma_error = null where id = $id`, {
        $en: subidaEn,
        $id: id,
      });
    },

    anotarErrorFirma(id: string, motivo: string): void {
      bd.runSync(`update venta set firma_error = $motivo where id = $id`, { $motivo: motivo, $id: id });
    },

    descartarFirma(id: string, motivo: string): void {
      bd.runSync(`update venta set firma_descartada = 1, firma_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },
```

`npm test --workspace=apps/tablet -- ventas candado-jornada cobranzas promociones rutas pendientes` → verde.

- [ ] **Paso 5: el 404 de una firma es definitivo — pruebas que fallan**

En `apps/tablet/src/sincronizacion/api-foto.spec.ts`, dentro de
`describe('temporal: la misma foto puede entrar en otra pasada', …)`, al final:

```ts
    it('el error temporal lleva el codigo HTTP: cada fuente decide si para ella es definitivo (T-73)', async () => {
      const { cliente } = montar(jsonNest(404, 'Esa venta ya no existe.'));

      const error = await cliente.subir('token-vivo', CLAVE, URI).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FotoTemporalError);
      expect((error as FotoTemporalError).status).toBe(404);
    });
```

En `apps/tablet/src/sincronizacion/motor.spec.ts`, dentro de `describe('permanente contra temporal', …)`, al final:

```ts
      describe('una falla que la fuente declara definitiva (T-73, Review Focus 5)', () => {
        /** Una cola de una sola firma que recuerda que se hizo con ella. */
        function fuenteDeUnaFirma() {
          const registro = { descartadas: [] as string[], anotadas: [] as string[] };
          const fuente: FuenteFotos = {
            tipo: 'venta',
            pendientes: () =>
              registro.descartadas.length === 0
                ? [{ clave: 'venta-1', uri: 'file:///documentos/firmas/firma-venta-1.jpg' }]
                : [],
            marcarSubida: jest.fn(),
            anotarError: (clave) => {
              registro.anotadas.push(clave);
            },
            descartar: (clave) => {
              registro.descartadas.push(clave);
            },
            fallaDefinitiva: (_clave, status) => status === 404,
          };
          return { fuente, registro };
        }

        it('un 404 de una firma (la venta se elimino en el portal) se descarta y no se reintenta', async () => {
          const { fuente, registro } = fuenteDeUnaFirma();
          const { motor, escenario } = montar({
            fotos: () => fuente,
            subirFoto: () => Promise.reject(new FotoTemporalError('Esa venta ya no existe.', 404)),
          });

          const r = await motor.sincronizar();
          expect(registro).toEqual({ descartadas: ['venta-1'], anotadas: [] });
          expect(r.fotos).toMatchObject({ descartadas: 1, pendientes: 0 });

          await motor.sincronizar();
          expect(escenario.fotos).toHaveLength(1);
        });

        it('un 409 de la misma firma sigue siendo temporal', async () => {
          const { fuente, registro } = fuenteDeUnaFirma();
          const { motor } = montar({
            fotos: () => fuente,
            subirFoto: () =>
              Promise.reject(new FotoTemporalError('Esa venta todavia no esta proyectada.', 409)),
          });

          const r = await motor.sincronizar();
          expect(registro).toEqual({ descartadas: [], anotadas: ['venta-1'] });
          expect(r.fotos).toMatchObject({ descartadas: 0, pendientes: 1 });
        });
      });
```

En `apps/tablet/src/sincronizacion/fuente-fotos.spec.ts`:

1. Imports: agrega
   `import { crearRepositorioFolios } from '@/datos/repositorios/folios';` y
   `import { crearRepositorioVentas } from '@/datos/repositorios/ventas';`, y `fuenteFirmasVentas` al import de
   `./fuente-fotos`.
2. Al final del archivo:

```ts
describe('firmas de ventas en la cola combinada (T-73)', () => {
  function montarConVentas() {
    const deps = depsDePrueba();
    const catalogos = crearRepositorioCatalogos(deps);
    catalogos.guardarSnapshot(snapshotDePrueba());
    const gastos = crearRepositorioGastos(deps, { catalogos });
    const ventas = crearRepositorioVentas(deps, { catalogos, folios: crearRepositorioFolios(deps) });
    const fuente = combinarFuentesFotos([
      fuenteFotosProspectos(crearRepositorioProspectos(deps, { catalogos })),
      fuenteFotosVisitas(crearRepositorioVisitas(deps, { catalogos })),
      fuenteFotosGastos(gastos),
      fuenteFirmasVentas(ventas),
    ]);
    return { gastos, ventas, fuente };
  }

  const ventaFirmada = (
    ventas: ReturnType<typeof montarConVentas>['ventas'],
    uri = 'file:///documentos/firmas/firma-v.jpg',
  ) =>
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      firma: { uri, nombre: 'Doña Lupe' },
    });

  it('la firma sale solo cuando la venta ya esta sincronizada; una rechazada no (Review Focus 4)', () => {
    const { ventas, fuente } = montarConVentas();
    const v = ventaFirmada(ventas);
    const rechazada = ventaFirmada(ventas, 'file:///documentos/firmas/firma-r.jpg');
    ventas.marcarError(rechazada.id, 'precio-no-asignado: sin precio');
    expect(fuente.pendientes()).toEqual([]);

    ventas.marcarSincronizada(v.id);
    expect(fuente.pendientes()).toEqual([{ clave: v.id, uri: 'file:///documentos/firmas/firma-v.jpg' }]);
  });

  it('gastos antes que ventas, y cada resultado vuelve a SU repositorio', () => {
    const { gastos, ventas, fuente } = montarConVentas();
    const v = ventaFirmada(ventas);
    ventas.marcarSincronizada(v.id);
    const g = gastos.registrar({
      vendedorId: 'ven-1',
      campoEgresoId: 'ce-gasolina',
      montoCentavos: 25050,
      comentario: null,
      fotoUri: 'file:///cache/ticket.jpg',
    });
    gastos.marcarSincronizada(g.id);

    expect(fuente.pendientes().map((f) => f.clave)).toEqual([g.id, v.id]);
    fuente.marcarSubida(v.id, '2026-08-07T16:00:00.000Z');
    expect(ventas.porId(v.id)?.firma_subida_en).toBe('2026-08-07T16:00:00.000Z');
    expect(gastos.porId(g.id)?.foto_subida_en).toBeNull();
  });

  it('un 404 es definitivo solo para la firma; un 409 no (Review Focus 5)', () => {
    const { gastos, ventas, fuente } = montarConVentas();
    const v = ventaFirmada(ventas);
    ventas.marcarSincronizada(v.id);
    const g = gastos.registrar({
      vendedorId: 'ven-1',
      campoEgresoId: 'ce-gasolina',
      montoCentavos: 8000,
      comentario: null,
      fotoUri: 'file:///cache/ticket.jpg',
    });
    gastos.marcarSincronizada(g.id);
    fuente.pendientes();

    expect(fuente.fallaDefinitiva?.(v.id, 404)).toBe(true);
    expect(fuente.fallaDefinitiva?.(v.id, 409)).toBe(false);
    expect(fuente.fallaDefinitiva?.(g.id, 404)).toBe(false);
  });

  it('descartar la firma la saca de la cola sin tocar la venta', () => {
    const { ventas, fuente } = montarConVentas();
    const v = ventaFirmada(ventas);
    ventas.marcarSincronizada(v.id);
    fuente.pendientes();
    fuente.descartar(v.id, 'Esa venta ya no existe.');
    expect(fuente.pendientes()).toEqual([]);
    expect(ventas.porId(v.id)).toMatchObject({ firma_descartada: 1, sync_estado: 'sincronizado' });
  });
});
```

`npm test --workspace=apps/tablet -- api-foto motor fuente-fotos` → fallan: `status` no existe,
`fallaDefinitiva` no está en `FuenteFotos`, `fuenteFirmasVentas` no existe y el motor anota el 404 en vez de
descartarlo.

- [ ] **Paso 6: el código del 404 definitivo**

En `apps/tablet/src/sincronizacion/api-foto.ts`:

1. En la tabla del comentario de cabecera, después de la fila del 404, agrega:
   `| 404 de la firma de una venta (T-73) | {@link FotoTemporalError} con \`status\` 404 | la cola de firmas lo trata como definitivo (\`fallaDefinitiva\`): la venta se eliminó en el portal |`
2. `FotoTemporalError` pasa a:

```ts
export class FotoTemporalError extends Error {
  /**
   * El codigo HTTP que la provoco, o `null` si no hubo uno util (un 2xx que no
   * se pudo leer). Sirve para que una FUENTE decida si para ella es definitivo:
   * la cola de firmas (T-73) descarta un 404 porque la venta se elimino en el
   * portal; para las demas fotos un 404 sigue siendo "todavia no".
   */
  readonly status: number | null;

  constructor(mensaje: string, status: number | null = null) {
    super(mensaje);
    this.name = 'FotoTemporalError';
    this.status = status;
  }
}
```

3. El `throw new FotoTemporalError(mensajeDe(respuesta));` del bloque `if (!estaOk(respuesta.status))` pasa a
   `throw new FotoTemporalError(mensajeDe(respuesta), respuesta.status);` (el del 2xx ilegible queda sin `status`).

En `apps/tablet/src/sincronizacion/fuente-fotos.ts`:

1. Import: `import type { RepositorioVentas } from '@/datos/repositorios/ventas';`.
2. `FuenteFotos` gana, después de `descartar`:

```ts
  /**
   * Opcional (T-73): ¿este fallo TEMPORAL es definitivo para esta fuente? El
   * motor descarta en vez de anotar si responde `true`. Sin el metodo, todo
   * fallo temporal se reintenta (prospectos, visitas, gastos).
   */
  fallaDefinitiva?(clave: string, status: number): boolean;
```

3. Después de `fuenteFotosGastos`:

```ts
/**
 * Las firmas del cliente de las ventas (T-73). Obligatorias desde la 016: toda
 * venta nueva trae una. `firmasPendientes()` ya exige `sync_estado =
 * 'sincronizado'`: antes de que el servidor acepte la venta no existe la nota a
 * la que la firma pertenece.
 *
 * A diferencia de las otras fuentes, **un 404 es definitivo**: la venta ya fue
 * aceptada (si no, no estaria en la cola), asi que un 404 solo puede ser que la
 * oficina la elimino en el portal. Reintentarlo seria para siempre (Review
 * Focus 5).
 */
export function fuenteFirmasVentas(ventas: RepositorioVentas): FuenteFotos {
  return {
    tipo: 'venta',
    pendientes(): FotoPorSubir[] {
      return ventas
        .firmasPendientes()
        .flatMap((v) => (v.firma_local === null ? [] : [{ clave: v.id, uri: v.firma_local }]));
    },
    marcarSubida: (clave, subidaEn) => ventas.marcarFirmaSubida(clave, subidaEn),
    anotarError: (clave, motivo) => ventas.anotarErrorFirma(clave, motivo),
    descartar: (clave, motivo) => ventas.descartarFirma(clave, motivo),
    fallaDefinitiva: (_clave, status) => status === 404,
  };
}
```

4. En `combinarFuentesFotos`, el objeto que devuelve gana, después de `descartar`:

```ts
    fallaDefinitiva: (clave, status) => duenaDe(clave).fallaDefinitiva?.(clave, status) ?? false,
```

5. En el comentario de `FotoPorSubir.clave`, la mención `\`gasto-<id>.jpg\` en T-30/T-31,` suma
   `y la firma de la venta (\`venta-<id de la nota>-firma.jpg\`, T-73)`.

En `apps/tablet/src/sincronizacion/motor.ts`, en `subirFotos`, el bloque de `FotoTemporalError` pasa a:

```ts
        if (error instanceof FotoTemporalError) {
          // T-73: una fuente puede declarar definitivo un fallo temporal (la
          // firma de una venta eliminada en el portal da 404 para siempre).
          if (error.status !== null && fotos.fuente.fallaDefinitiva?.(foto.clave, error.status)) {
            fotos.fuente.descartar(foto.clave, error.message);
            total.descartadas += 1;
            continue;
          }
          fotos.fuente.anotarError(foto.clave, error.message);
          total.pendientes += 1;
          continue;
        }
```

y en el comentario de `subirFotos`, la viñeta **Temporal** gana al final:
` Salvo que la fuente lo declare definitivo (\`fallaDefinitiva\`, T-73): un 404 de una firma de venta se descarta.`

`npm test --workspace=apps/tablet -- api-foto motor fuente-fotos` → verde.

- [ ] **Paso 7: el cuerpo de la operación — prueba que falla**

En `apps/tablet/src/sincronizacion/fuente-ventas.spec.ts`:

1. Import: `import { depsDePrueba, FIRMA_DE_PRUEBA, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';`.
2. `montar()` devuelve también `deps`: `return { deps, ventas, fuente: fuenteVentas(ventas) };`.
3. En `'arma el sobre exacto del contrato…'`, el `ventas.registrar({ … })` gana, después de `regalos: REGALOS,`:
   `firma: { uri: 'file:///documentos/firmas/firma-v.jpg', nombre: 'Doña Lupe' },` y el `datos` esperado gana,
   después del arreglo `regalos`:

```ts
          // T-73: toda venta nueva trae firma; solo viaja el nombre.
          firma: { nombre: 'Doña Lupe' },
```

4. En los otros tres `ventas.registrar({ … })` del archivo, agrega `firma: FIRMA_DE_PRUEBA,` después de `lineas`.
5. Al final del `describe`:

```ts
  it('una firma sin nombre viaja con nombre null', () => {
    const { ventas, fuente } = montar();
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      firma: FIRMA_DE_PRUEBA,
    });
    expect(fuente.pendientes()[0]?.datos.firma).toEqual({ nombre: null });
  });

  it('una venta anterior a la 016 (sin firma_local) no manda la clave: el servidor no espera imagen', () => {
    const { deps, ventas, fuente } = montar();
    const v = ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      firma: FIRMA_DE_PRUEBA,
    });
    deps.bd.runSync('update venta set firma_local = null where id = $id', { $id: v.id });
    expect(fuente.pendientes()[0]?.datos).not.toHaveProperty('firma');
  });
```

`npm test --workspace=apps/tablet -- fuente-ventas` → fallan los que esperan `firma` en `datos`.

- [ ] **Paso 8: el cuerpo de la operación**

En `apps/tablet/src/sincronizacion/fuente-ventas.ts`, dentro de `datos: DatosVenta = { … }`, después del bloque de
`regalos`:

```ts
          // T-73: presente = el servidor espera la imagen por el canal de fotos.
          // Una venta anterior a la 016 no tiene firma_local y no la manda.
          ...(v.firma_local !== null ? { firma: { nombre: v.firma_nombre } } : {}),
```

y en el comentario de la función suma la viñeta:
` * - **\`firma\`** (T-73): \`{ nombre }\` en toda venta con firma local; la imagen sube aparte (\`fuenteFirmasVentas\`).`

En `apps/tablet/src/estado/proveedor-sesion.tsx`: suma `fuenteFirmasVentas` al import de
`@/sincronizacion/fuente-fotos` y la cola pasa a:

```tsx
      // T-40 / T-39 / T-30 / T-73: el canal de la foto, aparte del lote del push.
      // Corre despues, y solo para lo que el servidor ya acepto — antes no existe
      // la fila a la que la imagen pertenece. Una cola, varias fuentes; las
      // firmas de las ventas al final.
      fotos: {
        fuente: combinarFuentesFotos([
          fuenteFotosProspectos(datos.prospectos),
          fuenteFotosVisitas(datos.visitas),
          fuenteFotosGastos(datos.gastos),
          fuenteFirmasVentas(datos.ventas),
        ]),
        api: crearClienteFotosExpo(),
      },
```

En `docs/contrato-sincronizacion.md`, sección "Fotos", al final de la viñeta de `POST /sync/foto/:clave` agrega:
` La tablet trata el **404 de la firma de una venta** como definitivo (la venta ya se aceptó, así que solo puede haberse eliminado en el portal) y deja de reintentarla; para las demás fotos un 404 sigue siendo temporal.`

- [ ] **Paso 9: verificar todo y commit**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
```

`typecheck` va a señalar `app/(jornada)/operacion/[clienteId]/venta.tsx` (su `datos.ventas.registrar({ … })` no
manda `firma`): **es esperado** y lo resuelve la Tarea 7. Para que este commit compile, en esa llamada agrega
temporalmente la línea `firma: { uri: '', nombre: null }, // T-73: la pone la Tarea 7` — con `uri` vacía el
repositorio rechaza la venta con "Falta la firma del cliente…", así que entre esta tarea y la siguiente la app no graba
ventas sin firma. La Tarea 7 la reemplaza.

```bash
git add apps/tablet/src/datos/migraciones/016-firma-venta.ts apps/tablet/src/datos/migraciones/016-firma-venta.spec.ts apps/tablet/src/datos/migraciones/index.ts apps/tablet/src/datos/migraciones/015-gastos.spec.ts apps/tablet/src/datos/tipos.ts apps/tablet/src/datos/repositorios/ventas.ts apps/tablet/src/datos/pruebas-apoyo.ts apps/tablet/src/datos/repositorios/ventas.spec.ts apps/tablet/src/datos/repositorios/candado-jornada.spec.ts apps/tablet/src/datos/repositorios/cobranzas.spec.ts apps/tablet/src/datos/repositorios/promociones.spec.ts apps/tablet/src/datos/repositorios/rutas.spec.ts apps/tablet/src/sincronizacion/pendientes.spec.ts apps/tablet/src/sincronizacion/api-foto.ts apps/tablet/src/sincronizacion/api-foto.spec.ts apps/tablet/src/sincronizacion/fuente-fotos.ts apps/tablet/src/sincronizacion/fuente-fotos.spec.ts apps/tablet/src/sincronizacion/motor.ts apps/tablet/src/sincronizacion/motor.spec.ts apps/tablet/src/sincronizacion/fuente-ventas.ts apps/tablet/src/sincronizacion/fuente-ventas.spec.ts apps/tablet/src/estado/proveedor-sesion.tsx "apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx" docs/contrato-sincronizacion.md
git commit -m "T-73 (tablet): migración 016, la firma en la venta, su cola de subida y el campo firma del push

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 7: Tablet: la firma en la revisión de la venta, "Firmada por" y "Firma por subir" en la ficha (pantalla del spec, D1–D4)

**Files:**
- Modify: `apps/tablet/src/estado/firma.ts` (estado de la pantalla, `puedeGrabarVenta`, grabador, textos)
- Test: `apps/tablet/src/estado/firma.spec.ts`
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx` ("Ventas de hoy")

**Interfaces:**
- Consumes (Tareas 1 y 6): `RecuadroFirma`/`ControlFirma`, `guardarFirmaJpg`, `normalizarNombreFirma`, `hayFirma`,
  `ErrorFirma`, `LARGO_MAX_NOMBRE_FIRMA`; `Pantalla.desplazable`; `datos.ventas.registrar({ id?, …, firma: { uri, nombre } })`;
  `Venta.firma_local/firma_nombre/firma_subida_en/firma_descartada`; `datos.deps.generarId`.
- Produces (en `src/estado/firma.ts`):
  - `export interface EstadoFirma { trazos: Punto[][]; nombre: string }`; `export const FIRMA_VACIA: EstadoFirma`.
  - `export const MENSAJE_FALLO_FIRMA = 'No se pudo guardar la firma. Intenta de nuevo.'`.
  - `export function puedeGrabarVenta(e: { contadoCredito: ContadoCredito | null; trazos: readonly (readonly Punto[])[]; grabando: boolean }): boolean`.
  - `export type ResultadoGrabarVenta<V> = { estado: 'grabada'; venta: V } | { estado: 'sin-firma'; mensaje: string } | { estado: 'error'; error: unknown }`;
    `export interface PasosGrabarVenta<V> { exportarPng(): Promise<string>; guardarJpg(pngBase64: string): Promise<string>; registrar(firmaUri: string): V }`;
    `export interface GrabadorVenta<V> { grabar(pasos: PasosGrabarVenta<V>): Promise<ResultadoGrabarVenta<V> | null> }`;
    `export function crearGrabadorVenta<V>(): GrabadorVenta<V>`.
  - `export function textoFirmada(nombre: string | null): string`;
    `export function firmaPorSubir(v: Pick<Venta, 'firma_local' | 'firma_subida_en' | 'firma_descartada'>): boolean`.

- [ ] **Paso 1: las pruebas que fallan**

En `apps/tablet/src/estado/firma.spec.ts`, el import de `./firma` suma `crearGrabadorVenta`, `FIRMA_VACIA`,
`firmaPorSubir`, `MENSAJE_FALLO_FIRMA`, `puedeGrabarVenta`, `textoFirmada` y el tipo `PasosGrabarVenta`; al final del
archivo agrega:

```ts
describe('puedeGrabarVenta (D1)', () => {
  const UN_TRAZO = [[{ x: 1, y: 1 }]];

  it('con pago elegido, firma y sin estar grabando, si', () => {
    expect(puedeGrabarVenta({ contadoCredito: 'contado', trazos: UN_TRAZO, grabando: false })).toBe(true);
    expect(puedeGrabarVenta({ contadoCredito: 'credito', trazos: UN_TRAZO, grabando: false })).toBe(true);
  });

  it('sin firma no, ni de contado ni a credito', () => {
    expect(puedeGrabarVenta({ contadoCredito: 'contado', trazos: [], grabando: false })).toBe(false);
    expect(puedeGrabarVenta({ contadoCredito: 'credito', trazos: [[]], grabando: false })).toBe(false);
  });

  it('sin pago elegido o mientras graba, no', () => {
    expect(puedeGrabarVenta({ contadoCredito: null, trazos: UN_TRAZO, grabando: false })).toBe(false);
    expect(puedeGrabarVenta({ contadoCredito: 'contado', trazos: UN_TRAZO, grabando: true })).toBe(false);
  });

  it('volver a captura deja Grabar deshabilitado: la firma vacia no sobrevive (D4, Review Focus 2)', () => {
    expect(FIRMA_VACIA).toEqual({ trazos: [], nombre: '' });
    expect(puedeGrabarVenta({ contadoCredito: 'contado', trazos: FIRMA_VACIA.trazos, grabando: false })).toBe(false);
  });
});

describe('crearGrabadorVenta', () => {
  const pasosQue = (cambios: Partial<PasosGrabarVenta<{ id: string }>> = {}) => {
    const pasos = {
      exportarPng: jest.fn(async () => 'iVBORw0KGgo='),
      guardarJpg: jest.fn(async () => 'file:///documentos/firmas/firma-v.jpg'),
      registrar: jest.fn((_uri: string) => ({ id: 'v' })),
      ...cambios,
    };
    return pasos;
  };

  it('exporta, convierte y graba con la ruta del JPG', async () => {
    const pasos = pasosQue();
    const r = await crearGrabadorVenta<{ id: string }>().grabar(pasos);
    expect(r).toEqual({ estado: 'grabada', venta: { id: 'v' } });
    expect(pasos.guardarJpg).toHaveBeenCalledWith('iVBORw0KGgo=');
    expect(pasos.registrar).toHaveBeenCalledWith('file:///documentos/firmas/firma-v.jpg');
  });

  it('si exportar falla no graba (no se quema folio) y deja reintentar', async () => {
    const grabador = crearGrabadorVenta<{ id: string }>();
    const fallida = pasosQue({ exportarPng: jest.fn(async () => Promise.reject(new Error('sin PNG'))) });
    await expect(grabador.grabar(fallida)).resolves.toEqual({ estado: 'sin-firma', mensaje: MENSAJE_FALLO_FIRMA });
    expect(fallida.registrar).not.toHaveBeenCalled();

    const buena = pasosQue();
    await expect(grabador.grabar(buena)).resolves.toMatchObject({ estado: 'grabada' });
  });

  it('si convertir a JPG falla tampoco graba', async () => {
    const pasos = pasosQue({ guardarJpg: jest.fn(async () => Promise.reject(new Error('disco'))) });
    await expect(crearGrabadorVenta<{ id: string }>().grabar(pasos)).resolves.toEqual({
      estado: 'sin-firma',
      mensaje: MENSAJE_FALLO_FIRMA,
    });
    expect(pasos.registrar).not.toHaveBeenCalled();
  });

  it('si registrar lanza, devuelve el error y deja reintentar', async () => {
    const grabador = crearGrabadorVenta<{ id: string }>();
    const error = new Error('Sin segmento de folio');
    const fallida = pasosQue({
      registrar: jest.fn(() => {
        throw error;
      }),
    });
    await expect(grabador.grabar(fallida)).resolves.toEqual({ estado: 'error', error });
    await expect(grabador.grabar(pasosQue())).resolves.toMatchObject({ estado: 'grabada' });
  });

  it('un segundo toque mientras exporta se ignora: una sola venta, un solo folio (Review Focus 3)', async () => {
    let soltarPng: (png: string) => void = () => {};
    const pasos = pasosQue({
      exportarPng: jest.fn(
        () =>
          new Promise<string>((resolve) => {
            soltarPng = resolve;
          }),
      ),
    });
    const grabador = crearGrabadorVenta<{ id: string }>();

    const primero = grabador.grabar(pasos);
    await expect(grabador.grabar(pasos)).resolves.toBeNull();
    soltarPng('iVBORw0KGgo=');

    await expect(primero).resolves.toEqual({ estado: 'grabada', venta: { id: 'v' } });
    expect(pasos.exportarPng).toHaveBeenCalledTimes(1);
    expect(pasos.registrar).toHaveBeenCalledTimes(1);
  });

  it('despues de grabar no se suelta: un toque tardio no graba otra venta', async () => {
    const pasos = pasosQue();
    const grabador = crearGrabadorVenta<{ id: string }>();
    await grabador.grabar(pasos);
    await expect(grabador.grabar(pasos)).resolves.toBeNull();
    expect(pasos.registrar).toHaveBeenCalledTimes(1);
  });
});

describe('textos de la firma', () => {
  it('"Firmada por {nombre}" o "Firmada"', () => {
    expect(textoFirmada('Doña Lupe')).toBe('Firmada por Doña Lupe');
    expect(textoFirmada(null)).toBe('Firmada');
  });

  it('firma por subir: con firma local, sin subir y no descartada', () => {
    const base = { firma_local: 'file:///documentos/firmas/firma-v.jpg', firma_subida_en: null, firma_descartada: 0 as const };
    expect(firmaPorSubir(base)).toBe(true);
    expect(firmaPorSubir({ ...base, firma_subida_en: '2026-08-07T16:00:00.000Z' })).toBe(false);
    expect(firmaPorSubir({ ...base, firma_descartada: 1 })).toBe(false);
    expect(firmaPorSubir({ ...base, firma_local: null })).toBe(false);
  });
});
```

`npm test --workspace=apps/tablet -- firma` → fallan los nuevos (las funciones no existen).

- [ ] **Paso 2: la lógica**

En `apps/tablet/src/estado/firma.ts`:

1. Debajo del import de `reglas-firma`: `import type { ContadoCredito, Venta } from '@/datos/tipos';`
2. Al final del archivo:

```ts
/** Lo que la pantalla de venta guarda de la firma mientras esta en revision. */
export interface EstadoFirma {
  trazos: Punto[][];
  /** El texto del campo tal cual; se normaliza al grabar (`normalizarNombreFirma`). */
  nombre: string;
}

/** Como empieza la revision y como queda al volver a captura (D4): el cliente firmo un total. */
export const FIRMA_VACIA: EstadoFirma = { trazos: [], nombre: '' };

/** Si exportar o convertir la firma falla: no se graba la venta ni se quema folio. */
export const MENSAJE_FALLO_FIRMA = 'No se pudo guardar la firma. Intenta de nuevo.';

/**
 * "Grabar venta" se habilita con las condiciones de siempre (el pago elegido,
 * no estar grabando) **y** la firma del cliente (D1: obligatoria, contado y
 * credito por igual).
 */
export function puedeGrabarVenta(e: {
  contadoCredito: ContadoCredito | null;
  trazos: readonly (readonly Punto[])[];
  grabando: boolean;
}): boolean {
  return e.contadoCredito !== null && !e.grabando && hayFirma(e.trazos);
}

export type ResultadoGrabarVenta<V> =
  | { estado: 'grabada'; venta: V }
  /** Exportar o convertir fallo: `registrar` no se llamo, no hay folio quemado. */
  | { estado: 'sin-firma'; mensaje: string }
  /** `registrar` lanzo (regla de negocio, folio, jornada o SQLite): la transaccion ya hizo rollback. */
  | { estado: 'error'; error: unknown };

/** Los tres pasos de grabar, inyectados para poder probar el orden y la guardia sin pantalla. */
export interface PasosGrabarVenta<V> {
  exportarPng(): Promise<string>;
  guardarJpg(pngBase64: string): Promise<string>;
  registrar(firmaUri: string): V;
}

export interface GrabadorVenta<V> {
  /** `null` = se ignoro: ya hay una grabacion en curso (o ya se grabo). */
  grabar(pasos: PasosGrabarVenta<V>): Promise<ResultadoGrabarVenta<V> | null>;
}

/**
 * Grabar con firma (T-73): exportar el PNG, convertirlo a JPG y solo entonces
 * `registrar` (spec, pantalla de venta pasos 1-4). Con la **guardia de doble
 * toque** dentro: la exportacion es asincrona, y un segundo toque en ese hueco
 * no debe emitir un segundo folio (Review Focus 3).
 *
 * El candado se suelta solo si algo fallo (para reintentar con la firma
 * intacta). Tras grabar se queda cerrado: la pantalla ya paso a "Venta grabada" y
 * un toque que llegara tarde no puede grabar otra venta.
 */
export function crearGrabadorVenta<V>(): GrabadorVenta<V> {
  let cerrado = false;
  return {
    async grabar(pasos) {
      if (cerrado) return null;
      cerrado = true;
      let uri: string;
      try {
        const png = await pasos.exportarPng();
        uri = await pasos.guardarJpg(png);
      } catch {
        cerrado = false;
        return { estado: 'sin-firma', mensaje: MENSAJE_FALLO_FIRMA };
      }
      try {
        return { estado: 'grabada', venta: pasos.registrar(uri) };
      } catch (error) {
        cerrado = false;
        return { estado: 'error', error };
      }
    },
  };
}

/** La linea de la pantalla "Venta grabada". */
export function textoFirmada(nombre: string | null): string {
  return nombre ? `Firmada por ${nombre}` : 'Firmada';
}

/** "Firma por subir" en la ficha: hay firma, el servidor aun no la tiene y no se dio por perdida. */
export function firmaPorSubir(
  v: Pick<Venta, 'firma_local' | 'firma_subida_en' | 'firma_descartada'>,
): boolean {
  return v.firma_local !== null && v.firma_subida_en === null && v.firma_descartada === 0;
}
```

`npm test --workspace=apps/tablet -- firma` → verde.

- [ ] **Paso 3: la pantalla de venta**

En `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`:

1. Imports: `import { useMemo, useRef, useState } from 'react';` y, después de `import { useJawa } from '@/estado/proveedor-jawa';`:

```ts
import {
  crearGrabadorVenta,
  ErrorFirma,
  FIRMA_VACIA,
  hayFirma,
  LARGO_MAX_NOMBRE_FIRMA,
  MENSAJE_FALLO_FIRMA,
  normalizarNombreFirma,
  puedeGrabarVenta,
  textoFirmada,
  type EstadoFirma,
} from '@/estado/firma';
import { guardarFirmaJpg } from '@/fotos/firma-expo';
```

   y, después de `import { Pantalla, Tarjeta } from '@/ui/pantalla';`:
   `import { RecuadroFirma, type ControlFirma } from '@/ui/recuadro-firma';`

2. Después de `const [elecciones, setElecciones] = useState<Map<string, string>>(new Map());` (antes del primer
   `useMemo` de `lineasBase`, para que los hooks se llamen siempre en el mismo orden):

```ts
  /** T-73: la firma del cliente (trazos y nombre), capturada en la revision (D3). */
  const [firma, setFirma] = useState<EstadoFirma>(FIRMA_VACIA);
  /** Mientras el dedo esta en el recuadro, la pantalla no se desplaza. */
  const [dibujando, setDibujando] = useState(false);
  const recuadro = useRef<ControlFirma>(null);
  /**
   * T-73: el id de la venta se genera ANTES de grabar, porque nombra el archivo
   * de la firma. Se conserva mientras la pantalla siga abierta: un reintento
   * sobrescribe el mismo `firma-<id>.jpg` en vez de dejar huerfanos.
   */
  const [ventaId] = useState(() => datos.deps.generarId());
  /** Guardia de doble toque: exportar, convertir y grabar es asincrono (Review Focus 3). */
  const [grabador] = useState(() => crearGrabadorVenta<Venta>());
```

3. Reemplaza la función `grabar()` entera por estas dos:

```ts
  function volverACaptura() {
    // D4: el cliente firmo un total; si cambian las cantidades, firma otra vez.
    setFirma(FIRMA_VACIA);
    setProblemas([]);
    setPaso('captura');
  }

  async function grabar() {
    // `revisar` no deja llegar aqui sin elegir; la comprobacion es para el tipo.
    if (contadoCredito === null) return;
    const pago = contadoCredito;
    let nombre: string | null = null;
    try {
      nombre = normalizarNombreFirma(firma.nombre);
    } catch (e) {
      setProblemas([e instanceof ErrorFirma ? e.message : MENSAJE_FALLO_FIRMA]);
      return;
    }
    setGrabando(true);
    const resultado = await grabador.grabar({
      exportarPng: () => {
        const control = recuadro.current;
        return control
          ? control.exportarPng()
          : Promise.reject(new ErrorFirma('El recuadro de firma no está en pantalla.'));
      },
      guardarJpg: (png) => guardarFirmaJpg(ventaId, png),
      registrar: (firmaUri) =>
        datos.ventas.registrar({
          id: ventaId,
          vendedorId,
          clienteId,
          numNota,
          contadoCredito: pago,
          factura,
          comentarios: comentarios.trim() === '' ? null : comentarios,
          // Sin precios: los pone el repositorio (D15).
          lineas: resumen.lineas.map((l) => ({
            presentacionId: l.presentacionId,
            cantidad: l.cantidad,
            cantidadPromocion: l.cantidadPromocion,
          })),
          // Solo los regalos con presentacion: `revisar` ya exigio elegirla, y el
          // repositorio vuelve a comprobar que cuadran con `cantidadPromocion`.
          regalos: regalos
            .filter((r) => r.presentacionId !== null)
            .map((r) => ({
              promocionId: r.promocionId,
              presentacionId: r.presentacionId as string,
              cantidad: r.cantidad,
              texto: r.texto,
            })),
          // T-73: misma transaccion que la venta, sus lineas y su folio.
          firma: { uri: firmaUri, nombre },
        }),
    });
    // Segundo toque mientras el primero corre: el primero se encarga de todo.
    if (resultado === null) return;
    setGrabando(false);
    if (resultado.estado === 'grabada') {
      setProblemas([]);
      setGrabada(resultado.venta);
      setPaso('grabada');
      return;
    }
    if (resultado.estado === 'sin-firma') {
      // No se llamo a `registrar`: ni venta ni folio. La firma sigue en el recuadro.
      setProblemas([resultado.mensaje]);
      return;
    }
    const e = resultado.error;
    setProblemas([
      e instanceof ErrorVenta || e instanceof ErrorFolio || e instanceof ErrorJornada
        ? e.message
        : 'No se pudo grabar la venta. No se consumió ningún folio; intenta de nuevo.',
    ]);
  }
```

   (Esto también quita la línea temporal `firma: { uri: '', nombre: null }, // T-73: la pone la Tarea 7` que dejó la
   Tarea 6.)

4. Pantalla "Venta grabada": dentro de `<Tarjeta estado="listo" etiqueta="Folio">`, después del `<Text>` del total y
   antes del de "Quedó guardada en la tablet…":

```tsx
          <Text style={estilos.textoTarjeta}>{textoFirmada(grabada.firma_nombre)}</Text>
```

5. Revisión: `<Pantalla titulo="Revisa la venta" …>` gana `desplazable={!dibujando}`. Después de la
   `<Tarjeta estado="accion" etiqueta="Total">…</Tarjeta>` y antes de `{problemas.map(…)}`:

```tsx
        {/*
          T-73 (D1, D3): la firma se captura aqui, antes de grabar, y se guarda en
          la misma transaccion. Sin firma, "Grabar venta" no se habilita.
        */}
        <Tarjeta estado={hayFirma(firma.trazos) ? 'listo' : 'pendiente'} etiqueta="Firma del cliente">
          <Text style={estilos.textoSuave}>Pide al cliente que firme con el dedo.</Text>
          <RecuadroFirma
            ref={recuadro}
            trazos={firma.trazos}
            alCambiar={(trazos) => setFirma((previa) => ({ ...previa, trazos }))}
            alDibujar={setDibujando}
            deshabilitado={grabando}
          />
          <Campo
            etiqueta="Nombre de quien firma (opcional)"
            value={firma.nombre}
            onChangeText={(nombre) => setFirma((previa) => ({ ...previa, nombre }))}
            maxLength={LARGO_MAX_NOMBRE_FIRMA}
            editable={!grabando}
          />
        </Tarjeta>
```

6. La fila de acciones de la revisión pasa a:

```tsx
        <View style={estilos.filaAcciones}>
          <Boton
            etiqueta="Corregir"
            tono="neutra"
            glifo="←"
            onPress={volverACaptura}
            deshabilitado={grabando}
          />
          <Boton
            etiqueta="Grabar venta"
            glifo="✓"
            onPress={() => void grabar()}
            ocupado={grabando}
            deshabilitado={!puedeGrabarVenta({ contadoCredito, trazos: firma.trazos, grabando })}
          />
        </View>
```

7. En el comentario de la función `PantallaVenta` agrega al final:
   ` * T-73: la revision pide la firma del cliente (obligatoria) y "Corregir" la borra (D4).`

- [ ] **Paso 4: "Firma por subir" en la ficha**

En `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx`:

1. Import: `import { firmaPorSubir } from '@/estado/firma';` (después del de `@/estado/menu-jornada`).
2. En "Ventas de hoy", después de `<Pastilla texto={ETIQUETA_SYNC[v.sync_estado]} estado={ESTADO_SYNC[v.sync_estado]} />`:

```tsx
              {/* T-73: la firma sube aparte, cuando la venta ya esta arriba. */}
              {firmaPorSubir(v) ? <Pastilla texto="Firma por subir" estado="pendiente" /> : null}
```

- [ ] **Paso 5: verificar y commit**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm run export --workspace=apps/tablet
git status
git add apps/tablet/src/estado/firma.ts apps/tablet/src/estado/firma.spec.ts "apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx" "apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx"
git commit -m "T-73 (tablet): la venta pide la firma del cliente antes de grabar y la ficha avisa si falta subirla

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`npm run export` comprueba que Metro resuelve `react-native-svg` dentro del monorepo. Si deja archivos en
`apps/tablet/dist/` están ignorados; `git status` debe salir limpio.

- [ ] **Paso 6 (CONTROLADOR, manual, en el emulador; al final del ticket)**

Con el backend local y el APK de esta rama (Tarea 1, Paso 10, pasos 1 y 3), con la red del emulador cortada
(`adb shell svc wifi disable` y `adb shell svc data disable`; ojo: `adb reverse` no corta la red):

1. Venta a un cliente: "Revisar" → la revisión muestra "Firma del cliente"; "Grabar venta" deshabilitado.
2. Firmar → se habilita; "Corregir" → captura; "Revisar" otra vez → el recuadro vacío y "Grabar venta"
   deshabilitado (Review Focus 2).
3. Firmar, nombre "Doña Lupe", **doble toque rápido** en "Grabar venta" → una sola venta y un solo folio en la ficha
   (Review Focus 3).
4. "Venta grabada" dice "Firmada por Doña Lupe"; la ficha muestra la venta con "Firma por subir".
5. Red de vuelta (`adb shell svc wifi enable`), sincronizar → en Postgres local
   `select firma_esperada, firma_nombre, firma_archivo from venta_nota where folio = '<folio>';` con archivo
   `venta-<id>-firma.jpg`; la ficha ya no dice "Firma por subir"; el portal (detalle de la venta) muestra la firma con
   "Firmó: Doña Lupe".
6. Repetir 3–5 con `adb shell cmd uimode night yes` (Review Focus 1) y volver a `night no`.
El 404 de una venta eliminada antes de que suba su firma (Review Focus 5) no se puede provocar a mano (push e imagen
van en la misma sincronización): lo cubren el e2e de la Tarea 4 y la prueba del motor de la Tarea 6.

---

### Tarea 8: Documentación del repo (CLAUDE.md y README de la tablet)

**Files:**
- Modify: `CLAUDE.md` (bloque nuevo después del de Gastos de la ruta (T-30 / T-31) y antes de "Reportes y Excel")
- Modify: `apps/tablet/README.md` (sección nueva antes de "Pruebas"; nota del APK en "Desarrollo")
- Modify: `docs/superpowers/specs/2026-10-21-t-73-firma-del-cliente-design.md` (solo si el controlador aprobó
  alguna de las interpretaciones de "Conflictos": se anotan como enmienda con fecha bajo "Decisiones de producto")

**Interfaces:**
- Consumes: todo lo anterior. No produce código.

- [ ] **Paso 1: `CLAUDE.md`**

Después del bloque `- **Gastos de la ruta y campos de egreso (T-30 / T-31).** …` (su última viñeta termina en
"Esta rama lleva el fix de PR #139 (migración de T-72 renombrada a `20261019130000`).") y antes de
`- **Reportes y Excel (T-50 / T-15).**`, agrega:

```markdown
- **Firma del cliente en la nota (T-73).** El cliente firma con el dedo en la tablet **toda** venta (contado y crédito,
  sin poder omitirla) antes de grabarla; la firma complementa la nota de papel. Spec:
  `docs/superpowers/specs/2026-10-21-t-73-firma-del-cliente-design.md`.
  - **Tablet**: la revisión de la venta lleva el recuadro (`src/ui/recuadro-firma.tsx`, `react-native-svg` +
    `PanResponder`, papel **blanco** como `<Rect>` dentro del `Svg` para que el PNG no salga transparente) y el nombre
    opcional (≤ 80). "Grabar venta" no se habilita sin firma; "Corregir" la borra. Toda decisión vive en
    `src/estado/firma.ts` (`puedeGrabarVenta`, `crearGrabadorVenta` con la guardia de doble toque), con pruebas.
  - **El id de la venta se genera antes de grabar**: `toDataURL` → PNG → JPG (`src/fotos/firma-expo.ts`,
    `expo-image-manipulator`, 0.8, ≤ 1000 px) en `documentDirectory/firmas/firma-<id>.jpg`, y `ventas.registrar({ id,
    …, firma: { uri, nombre } })` guarda `firma_local`/`firma_nombre` en la **misma transacción** que la venta y el
    folio (migración local 016). Si exportar o convertir falla, no se graba ni se quema folio.
  - **`react-native-svg` es nativa: hace falta un APK nuevo.** Una app vieja sigue funcionando: sus ventas llegan sin
    `firma` y el portal las muestra "sin firma".
  - **Contrato**: `firma: { nombre }` opcional en `datos` de la operación `venta` (aditivo, `CONTRATO_ACTUAL` sigue en
    1). Presencia = la venta espera imagen (`venta_nota.firma_esperada`); `nombre` > 80 o de otro tipo →
    `datos-invalidos` (`firma.nombre`). Las ventas del portal quedan con `firma_esperada = false`.
  - **Imagen**: sube por `POST /sync/foto/:clave` (rama `venta`) como `venta-<venta_nota.id>-firma.jpg`; 409 si aún
    no está proyectada o no espera firma, 404 si la venta se eliminó. Las columnas son de `ventas-cobranza`
    (`FirmasVentaService`/`FirmasVentaRepository`). La tablet trata **solo** el 404 de una firma como definitivo
    (`fuenteFirmasVentas.fallaDefinitiva`; `FotoTemporalError.status`) y la descarta; la cola sube las firmas después
    de las fotos de gastos y solo de ventas ya sincronizadas.
  - **Portal**: `VentaDetalle.firma { esperada, nombre, subidaEn }` y `editada` (`actualizado_por_usuario_id is not
    null`); bloque "Firma del cliente" en el detalle (imagen por `GET /ventas/:id/firma`, mismo alcance que el detalle,
    `Cache-Control: private, no-store`), "pendiente de subir" o "sin firma", y el aviso si la nota se editó después
    de firmarse. Editar en el portal **no** vuelve a pedir la firma.
  - **Nube**: `20261021120000_venta_firma.sql` se sube a `sinmex dev` después del merge y **antes** del backend (y el
    backend antes de la app), con el protocolo de push (pre-flight: columnas nuevas con default; nada que contar).
```

- [ ] **Paso 2: README de la tablet**

En `apps/tablet/README.md`:

1. En "Desarrollo", después del bloque de comandos, agrega el párrafo:

```markdown
**Dependencias nativas.** `react-native-svg` (T-73, la firma del cliente) es nativa: después de instalarla o
actualizarla hace falta un APK nuevo (`expo prebuild -p android --clean` y `expo run:android`); Metro solo no basta.
```

2. Después de la sección "Gastos de la ruta (T-30/T-31)" (antes de "Pruebas"), agrega una sección de nivel 2 (dos `#`)
   titulada **Firma del cliente en la venta (T-73)** y, debajo del título, este texto (el título va fuera del bloque
   aquí solo para que el extractor de tareas no lo confunda con una sección del plan):

```markdown
Spec: `docs/superpowers/specs/2026-10-21-t-73-firma-del-cliente-design.md`.

- **Revisión de la venta** (`app/(jornada)/operacion/[clienteId]/venta.tsx`): tarjeta "Firma del cliente" con el
  recuadro (`src/ui/recuadro-firma.tsx`), "Borrar firma" y "Nombre de quien firma (opcional)". "Grabar venta" solo se
  habilita con firma (`puedeGrabarVenta`); "Corregir" vuelve a captura y **borra** la firma (el cliente firmó un total).
  Mientras el dedo está en el recuadro la pantalla no se desplaza (`Pantalla desplazable`).
- **Al grabar** (`crearGrabadorVenta`, ignora el segundo toque): `exportarPng()` (`toDataURL`) → `guardarFirmaJpg`
  (`src/fotos/firma-expo.ts`: JPG 0.8, ≤ 1000 px, en `documentDirectory/firmas/firma-<id>.jpg`) → `ventas.registrar`
  con el id generado antes y `firma: { uri, nombre }`, en la misma transacción que la venta y su folio. Si la firma no
  se pudo guardar, la venta no se graba, no se quema folio y la pantalla sigue en revisión con la firma.
- **"Venta grabada"** dice "Firmada por {nombre}" o "Firmada"; la ficha marca "Firma por subir" mientras el servidor no
  tenga la imagen (`firmaPorSubir`).
- **Datos** (migración 016): `venta.firma_local`, `firma_nombre`, `firma_subida_en`, `firma_error`,
  `firma_descartada` (esquema derivado como la foto de la visita y del gasto; no tocan `sync_estado`).
- **Sincroniza**: la operación `venta` lleva `firma: { nombre }`; la imagen sube por la cola de fotos
  (`fuenteFirmasVentas`, después de los gastos) cuando la venta ya está sincronizada. Un 404 (la venta se eliminó en el
  portal) la descarta (`fallaDefinitiva`); un 409 se reintenta.
```

- [ ] **Paso 3: el spec (solo si hace falta)**

Si el controlador aprobó alguna interpretación de "Conflictos para el controlador" que el spec dice distinto (p. ej.
`FirmasVentaService` en lugar de métodos en `VentasService`, o el 403 de otra sucursal), anótala en el spec bajo
"Decisiones de producto" como enmienda con fecha. Si no cambió nada, no toques el spec.

- [ ] **Paso 4: commit**

```bash
git add CLAUDE.md apps/tablet/README.md
# solo si el spec cambió:
# git add docs/superpowers/specs/2026-10-21-t-73-firma-del-cliente-design.md
git commit -m "T-73: documentación (CLAUDE.md y README de la tablet)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Conflictos para el controlador

1. **El 404 de una foto hoy es temporal para todas las fuentes** (`api-foto.ts`, `motor.ts`): sin cambio, la tablet
   reintentaría para siempre la firma de una venta eliminada, contra el Review Focus 5. El spec pide el resultado pero
   no el mecanismo. **Decidido en el plan (Tarea 6):** `FotoTemporalError` lleva `status` y `FuenteFotos` gana el
   método opcional `fallaDefinitiva`; solo `fuenteFirmasVentas` declara el 404 definitivo (la venta ya fue aceptada,
   así que un 404 solo puede ser eliminación). Prospectos, visitas y gastos no cambian. Recomiendo aceptarlo.
2. **Alcance de `GET /ventas/:id/firma` en otra sucursal: 403, no 404.** El spec dice "mismo alcance que
   `GET /ventas/:id`", que contesta **403** (`exigirAlcanceSobre`); el brief pedía 404 (como `/gastos/:id/foto`). El plan
   sigue al spec (403): el detalle ya revela la existencia con su 403, así que un 404 aquí no ocultaría nada.
   Recomiendo 403.
3. **`Cache-Control`.** El spec dice `private, no-store` "como `/gastos/:id/foto`", pero ese endpoint usa
   `private, max-age=300`. El plan usa `private, no-store` (el valor literal del spec). Cualquiera funciona; el archivo
   no cambia una vez subido salvo reenvío idéntico.
4. **Campo de `registrar`: `firma: { uri, nombre }`** (spec) y no `{ local, nombre }` (brief). El plan usa `uri`.
5. **Dueño de las columnas de firma.** El spec sugiere `existeConFirmaEsperada(id)` y `anotarFirma` en `VentasService`
   "(o el repositorio que ya escribe `venta_nota`)". `VentasRepository` no inyecta conexión (todo corre en la `trx` de
   quien llama) y agregar un parámetro al constructor de `VentasService` rompe sus pruebas. **Decidido:**
   `FirmasVentaService` + `FirmasVentaRepository` en `ventas-cobranza`, exportado por el módulo. Y `estadoFirma` devuelve
   `'inexistente' | 'no-espera' | 'espera'` en vez de un booleano, porque el canal necesita distinguir 404 de 409.
6. **Nombre del archivo `venta-<id>-firma.jpg`**: `nombreArchivoFoto` gana un tercer parámetro opcional `sufijo:
   'firma'` (el id es el de `venta_nota`, que genera el servidor; no la clave).
7. **`editada` = `actualizado_por_usuario_id is not null`** (literal del spec), pero esa columna también la escriben
   **asignar factura** (`facturas.repository.ts`) y **marcar cuenta perdida** (`ventas-edicion.repository.ts`): el aviso
   "se editó después de firmarse" saldrá también en esos casos, aunque las líneas no cambiaron. Recomiendo aceptarlo
   ahora (es lo que el spec dice) y, si molesta, restringirlo en otro ticket con una columna propia de edición.
8. **El aviso de edición** sale cuando `firma.esperada && editada` (no solo con la imagen ya subida): la firma pendiente
   también corresponde a la versión original. El spec dice "si hay firma"; el plan lo interpreta así.
9. **El portal no usa `<img src="/ventas/:id/firma">`** sino `fetch` (`apiFetchBlob`) + URL de objeto, como
   `FotoProspecto` y el ticket del gasto: un `<img>` a la API no refresca la sesión.
10. **La app no tiene tema oscuro** (`app.json` → `userInterfaceStyle: "light"`). El Review Focus 1 se comprueba con el
    modo noche **del sistema** (`adb shell cmd uimode night yes`) y el fondo blanco fijo dentro del `Svg`.
11. **El scroll se roba los trazos verticales** en Android si no se apaga: `Pantalla` gana `desplazable` y el recuadro
    avisa `alDibujar` (Tarea 1). El paso del emulador lo confirma.
12. **El paso del emulador (Tarea 1, Paso 10) instala un APK de desarrollo de esta rama sobre `mx.jawa.tablet`** del
    emulador compartido con el clon de demo y otras sesiones (y cambia el modo noche del sistema un momento). Avisar
    antes; después, la app de demo se reinstala desde su clon (no desde este).
13. **`node_modules` no está instalado en este worktree**, así que el rango exacto de `react-native-svg` que fija SDK 57
    no se pudo leer al escribir el plan; la Tarea 1 lo lee de `expo/bundledNativeModules.json` y `expo install` lo
    aplica. Hay que correr `npm install` en la raíz antes de empezar.
14. **"Firma por subir"** excluye las firmas descartadas (venta eliminada, 413, 415, archivo perdido): mostrarla "por
    subir" para siempre sería falso. El spec dice "mientras `firma_subida_en` sea null".
15. **`firma: null` en el push** se trata igual que ausente (como `regalos: null`); el spec solo menciona "ausente".
16. **Entre la Tarea 6 y la 7** la pantalla de venta compila con una firma vacía que el repositorio rechaza: en ese
    intervalo la app no graba ventas (no se publica nada entre tareas, pero si alguien probara en el emulador a media
    rama, verá "Falta la firma del cliente…").
17. **Supabase local compartido.** La Tarea 2 aplica una migración con `migration up --local` y regenera
    `schema.d.ts`; si otra sesión dejó migraciones de otra rama aplicadas, hay que quedarse solo con las cuatro líneas de
    `VentaNota`. Nunca `db reset`, nunca nada contra `sinmex dev`. El push a la nube lo hace quien mergee (migración
    antes que backend, backend antes que la app).
18. **Vault** (`[[App Tablet]]` §2 —la firma complementa la nota de papel—, `[[Venta-Nota]]`, Estado del proyecto y
    bitácora): lo actualiza el controlador tras la revisión final, no un subagente.
