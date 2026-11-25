# Rediseño app del vendedor — Pieza 1: Cáscara — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cambiar la "cáscara" de la app de tablet al rediseño: iconos SVG, menú nuevo, Ruta con empezar ruta, orden fijo, Por visitar / Visitados y contador de notas, hoja del cliente, agregar a ruta, Prospectos y Gastos simplificado. Solo tablet.

**Architecture:** Toda decisión nueva vive en funciones puras con prueba (`src/estado/*.ts`, repositorios en `src/datos/repositorios/`), como ya hace la app: la tablet no tiene pruebas de pantalla (`jest.config.js`). Las pantallas (`app/`, `src/ui/*.tsx`) solo pintan lo que esas funciones deciden y se verifican a mano en el emulador. Sin migraciones locales nuevas, sin tocar backend, portal ni el contrato de sincronización.

**Tech Stack:** Expo Router 57, React Native 0.86, `react-native-svg` 15.15.4 (ya instalada), SQLite local (`expo-sqlite`; `better-sqlite3` en pruebas), Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` (secciones 3, 4, 5, 6, 11 "Gastos / Agregar cliente / Prospectos", 15 pieza 1, 16-bis "Inventario y candado" y "Prospectos"). Maquetas: `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor/maquetas.html`, pantallas 1, 2, 3, 6, 7, 19, 20, 21. **Las maquetas mandan en acomodo y textos; el spec manda en reglas.**

## Global Constraints

- **Dónde se trabaja:** worktree nuevo desde `origin/main`, rama `feature/rediseno-pieza-1-cascara` (p. ej. `JAWA ANDROID/proyecto-sinmex-cascara`). **Nunca** en `JAWA ANDROID/proyecto-sinmex` (clon de demo).
- **El spec, las maquetas y este plan viven en la rama local `docs/rediseno-app-vendedor`**, no en `main`. Primer commit de la rama nueva (el precedente es "Spec y plan: retiro de merma"):
  `git checkout docs/rediseno-app-vendedor -- docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md docs/superpowers/specs/2026-11-18-rediseno-app-vendedor docs/superpowers/plans/2026-11-24-rediseno-pieza-1-cascara.md`
  y `git commit -m "Spec y plan: rediseño de la app del vendedor, pieza 1"`.
- **Iconos SVG siempre** (`react-native-svg`). Ningún emoji ni glifo Unicode **como icono**. Los signos que son texto (`×` en "4 × Mango", `−` y `=` en la fórmula de Inventario, `→` en el kilometraje de Cerrar el día) se quedan.
- Se mantiene el sistema de diseño de `src/ui/tokens.ts`; no se agregan colores.
- Toda pantalla del menú lleva arriba a la izquierda el botón de menú; las de un flujo (vender, cobrar, merma, visita) llevan "atrás".
- Lo grabado no se edita ni se anula en la app.
- Textos en español de México, los de las maquetas.
- Sin migración local nueva: `ruta_orden_local` se deja de leer pero la tabla se queda.
- Sin cambios a `apps/backend`, `apps/portal`, `supabase/` ni `src/sincronizacion/contrato.ts`.
- Verificación por tarea: `npm test --workspace=apps/tablet`, `npm run typecheck --workspace=apps/tablet` y `npm run lint --workspace=apps/tablet` en verde.
- Commits con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR al final; el rediseño no tiene issue propio todavía: si Mario lo crea, el PR lleva `Refs #N`. **Nunca** se mergea.

## Lo que la pieza 1 deja provisional (lo terminan otras piezas)

| Entrada del menú | En la pieza 1 abre | La termina |
|---|---|---|
| Ventas / Cobranza | pantalla pendiente | pieza 5 |
| Merma / Cambios | `merma/index` actual (merma del trayecto y consumo) | pieza 4 |
| Corte | `cerrar-dia` actual (km final), **sin** candado de clientes (ver Task 2) | pieza 6 |
| Seleccionar impresora | pantalla pendiente | pieza 7 |
| Sugerido de carga | pantalla pendiente | pieza 8 |

El botón de la hoja del cliente se llama **"Merma"** hasta la pieza 4 (que agrega Cambios y lo renombra a "Merma y cambios").

## Review Focus

1. **App reiniciada a media mañana**: con jornada de hoy ya abierta, la Ruta no vuelve a pedir vehículo ni km; con jornada de **ayer** abierta (no cerrada) sí pide empezar la de hoy. → prueba en Task 3 (`candadoDeClientes` con jornada de otra fecha).
2. **Sucursal con control de inventario apagado**: al empezar ruta los clientes se abren de inmediato, aunque haya una carga pendiente (el aviso de carga sigue, no bloquea). → prueba en Task 3.
3. **Vehículo asignado por el portal dado de baja o de otra sucursal**: no se preselecciona un vehículo que no está en la lista; cae al primero. → prueba en Task 3 (`vehiculoPorOmision`).
4. **Venta a crédito de hoy que ya bajó en el pull**: aparece en `venta` y en `nota_pendiente`; el contador la cuenta **una vez**; si se liquidó hoy deja de contar. → prueba en Task 4.
5. **Día cerrado**: la Ruta queda en solo lectura, la hoja del cliente no permite acciones, y Corte no se bloquea por clientes sin visitar (el corte ya se hizo). → pruebas en Task 2 (`entradasMenu` con día cerrado) y Task 5 (`accionesCliente` con `operacionesHabilitadas: false`).

---

### Task 1: Iconos SVG

**Files:**
- Create: `apps/tablet/src/ui/iconos.ts` (puro: nombres y trazos)
- Create: `apps/tablet/src/ui/icono.tsx` (componente)
- Modify: `apps/tablet/src/ui/boton.tsx`, `apps/tablet/src/ui/boton-icono.tsx`, `apps/tablet/src/ui/boton-menu.tsx` si pinta glifos
- Modify: todo `app/**/*.tsx` y `src/ui/*.tsx` que pase `glifo=`
- Test: `apps/tablet/src/ui/iconos.spec.ts`, `apps/tablet/src/ui/sin-glifos.spec.ts`

**Interfaces:**
- Produces:
  - `type NombreIcono = 'menu' | 'sincronizar' | 'agregar-cliente' | 'atras' | 'adelante' | 'cerrar' | 'palomita' | 'mas' | 'menos' | 'ubicacion' | 'telefono' | 'mapa' | 'nota' | 'candado' | 'camion' | 'inventario' | 'vender' | 'cobrar' | 'visita' | 'merma' | 'gasto' | 'corte' | 'prospecto' | 'impresora' | 'sugerido' | 'salir' | 'foto' | 'registros'`
  - `NOMBRES_ICONO: readonly NombreIcono[]`
  - `TRAZOS: Record<NombreIcono, readonly string[]>` — atributos `d` de `<Path>` en una caja de 24×24, trazo `currentColor` 2.2, extremos redondeados (el mismo estilo de las maquetas; copiar los `d` de ahí cuando existan).
  - `Icono({ nombre, tamano = 20, color }: { nombre: NombreIcono; tamano?: number; color: string })` en `icono.tsx`.
  - `Boton` y `BotonIcono` cambian `glifo?: string` / `glifo: string` por `icono?: NombreIcono` / `icono: NombreIcono`. El resto de sus props no cambia.

- [ ] **Step 1: Write the failing tests**

```ts
// iconos.spec.ts
import { NOMBRES_ICONO, TRAZOS } from './iconos';

test('cada icono tiene al menos un trazo y ninguno vacío', () => {
  for (const nombre of NOMBRES_ICONO) {
    expect(TRAZOS[nombre]?.length).toBeGreaterThan(0);
    for (const d of TRAZOS[nombre]) expect(d.trim()).toMatch(/^[Mm]/);
  }
});

test('no hay trazos sin nombre', () => {
  expect(Object.keys(TRAZOS).sort()).toEqual([...NOMBRES_ICONO].sort());
});
```

```ts
// sin-glifos.spec.ts — recorre app/ y src/ leyendo .ts/.tsx con fs, SIN los *.spec.ts
// (este mismo archivo tiene los glifos en su regex).
const SOLO_ICONO = /[☰↻✓←◉⌖⬤]|\p{Extended_Pictographic}/u;
test('nadie pasa glifo= a un botón', () => {
  expect(archivos().filter((f) => /\bglifo=/.test(leer(f)))).toEqual([]);
});
test('ningún archivo usa glifos de icono ni emojis fuera de comentarios', () => {
  expect(archivos().filter((f) => SOLO_ICONO.test(sinComentarios(leer(f))))).toEqual([]);
});
```

`archivos()` lista `.ts`/`.tsx` bajo `app/` y `src/` de `path.resolve(__dirname, '../..')` (la carpeta `apps/tablet`), sin `*.spec.ts`. `sinComentarios` quita `//…` y `/* … */` (incluye `{/* … */}` de JSX), porque hay comentarios que nombran los glifos viejos (`cobranza.tsx:380`, `venta.tsx:368` y `:504`, `boton.tsx:65`). `×`, `−`, `→` y `=` **no** van en la regex: son texto en `venta.tsx`, `inventario/index.tsx`, `cerrar-dia.tsx` y `movimiento.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=apps/tablet -- src/ui/iconos.spec.ts src/ui/sin-glifos.spec.ts`
Expected: FAIL (`iconos` no existe; `sin-glifos` lista los ~20 archivos que hoy usan `glifo=`).

- [ ] **Step 3: Implement `iconos.ts`, `icono.tsx`, cambiar `Boton`/`BotonIcono` a `icono` y reemplazar cada `glifo=`**

Correspondencia de los `glifo=` actuales: `☰`→`menu`, `↻`→`sincronizar`, `+`→`mas`, `−`→`menos`, `×`→`cerrar`, `✓`→`palomita`, `←`→`atras`, `→`→`adelante`, `⌖`→`ubicacion` (`prospectos.tsx:336`, `visita-sin-venta.tsx:239`), `◉` y `⬤`→`foto` (botones "Tomar foto" de `prospectos.tsx:377`, `visita-sin-venta.tsx:210`, `gastos/registrar.tsx:166`), `$`→`cobrar` (`venta.tsx:377`), `=`→`cobrar` ("Liquidar", `cobranza.tsx:477`). `Icono` dibuja `<Svg viewBox="0 0 24 24">` con un `<Path>` por trazo, `fill="none"`, `stroke={color}`, `strokeWidth={2.2}`, `strokeLinecap="round"`, `strokeLinejoin="round"`, y `accessible={false}` (la etiqueta la lleva el botón).

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npm test --workspace=apps/tablet && npm run typecheck --workspace=apps/tablet && npm run lint --workspace=apps/tablet`
Expected: PASS.

- [ ] **Step 5: Verify in the emulator**

Levantar Metro (puerto 8082) y abrir Ruta, una ficha y Gastos: todos los botones que antes tenían glifo muestran el SVG, del color del texto del botón, en claro y deshabilitado.

- [ ] **Step 6: Commit**

```bash
git add apps/tablet/src/ui apps/tablet/app
git commit -m "Rediseño pieza 1: iconos SVG en lugar de glifos"
```

---

### Task 2: Menú lateral nuevo y marco de las pantallas del menú

**Files:**
- Modify: `apps/tablet/src/estado/ruta-del-dia.ts` (`entradasMenu`, `EntradaMenu`)
- Create: `apps/tablet/src/estado/pie-menu.ts`
- Create: `apps/tablet/src/ui/marco-menu.tsx`
- Modify: `apps/tablet/src/ui/menu-lateral.tsx` (entrada con candado y su nota; acción `salir`)
- Create: `apps/tablet/app/(jornada)/registros.tsx`, `apps/tablet/app/(jornada)/impresora.tsx`, `apps/tablet/app/(jornada)/sugerido-de-carga.tsx` (las tres con `PantallaPendiente` dentro de `MarcoMenu`)
- Modify: `apps/tablet/app/(jornada)/_layout.tsx` (`headerShown: false` en las pantallas del menú; quitar `ruta` y `operacion/index`)
- Modify: `apps/tablet/app/(jornada)/inventario/index.tsx`, `gastos/index.tsx`, `merma/index.tsx`, `prospectos.tsx`, `cerrar-dia.tsx` (envolver en `MarcoMenu`)
- Delete: `apps/tablet/app/(jornada)/ruta.tsx`, `apps/tablet/app/(jornada)/operacion/index.tsx` (antes, `grep -rn "operacion'" app src` y `grep -rn "/ruta'" app src` para quitar cada enlace)
- Test: `apps/tablet/src/estado/ruta-del-dia.spec.ts`, `apps/tablet/src/estado/pie-menu.spec.ts`, `apps/tablet/src/estado/menu-jornada.spec.ts` si cambia

**Interfaces:**
- Consumes: `NombreIcono` (Task 1).
- Produces:
  - `interface EntradaMenu { clave: ClaveMenu; titulo: string; icono: NombreIcono; destino: string | null; deshabilitada: boolean; nota: string | null }` con `type ClaveMenu = 'ruta' | 'inventario' | 'sugerido' | 'registros' | 'merma' | 'gastos' | 'corte' | 'prospectos' | 'impresora' | 'salir'`. `destino` es `null` solo en `salir` (lo maneja la pantalla).
  - `entradasMenu({ porVisitar, diaCerrado }: { porVisitar: number; diaCerrado: boolean }): EntradaMenu[]` — se quita el parámetro posicional `diaCerrado: boolean`.
  - `textoHaceCuanto(desde: MomentoISO | null, ahora: MomentoISO): string` y `textoSinSincronizar(n: number): string` en `pie-menu.ts`.
  - `MarcoMenu({ titulo, derecha, children }: { titulo: string; derecha?: ReactNode; children: ReactNode })` — cabecera propia (menú a la izquierda, título, `derecha`), `MenuLateral` con las entradas, pie con indicador, vendedor, vehículo y sucursal. Toma todo de `useJawa()`/`useSesion()`; las pantallas solo le pasan título y contenido.

Orden y textos exactos (spec §5, maqueta 3): Ruta, Inventario, Sugerido de carga, Ventas / Cobranza, Merma / Cambios, Gastos, Corte, Prospectos, Seleccionar impresora, Cerrar sesión. Destinos: `/(jornada)`, `/(jornada)/inventario`, `/(jornada)/sugerido-de-carga`, `/(jornada)/registros`, `/(jornada)/merma`, `/(jornada)/gastos`, `/(jornada)/cerrar-dia`, `/(jornada)/prospectos`, `/(jornada)/impresora`, `null`.

- [ ] **Step 1: Write the failing tests**

```ts
test('entradas del menú en el orden del spec', () => {
  expect(entradasMenu({ porVisitar: 0, diaCerrado: false }).map((e) => e.titulo)).toEqual([
    'Ruta', 'Inventario', 'Sugerido de carga', 'Ventas / Cobranza', 'Merma / Cambios',
    'Gastos', 'Corte', 'Prospectos', 'Seleccionar impresora', 'Cerrar sesión',
  ]);
});

test('Corte con candado y "faltan N clientes" mientras haya por visitar', () => {
  const corte = (n: number) => entradasMenu({ porVisitar: n, diaCerrado: false }).find((e) => e.clave === 'corte')!;
  expect(corte(4)).toMatchObject({ deshabilitada: true, nota: 'faltan 4 clientes' });
  expect(corte(1)).toMatchObject({ deshabilitada: true, nota: 'falta 1 cliente' });
  expect(corte(0)).toMatchObject({ deshabilitada: false, nota: null });
});

test('con el día cerrado, Corte se abre (ya se hizo) y lo que captura se apaga', () => {
  const e = entradasMenu({ porVisitar: 3, diaCerrado: true });
  expect(e.find((x) => x.clave === 'corte')!.deshabilitada).toBe(false);
  expect(e.filter((x) => x.deshabilitada).map((x) => x.clave).sort()).toEqual(['gastos', 'merma']);
});
```

```ts
// pie-menu.spec.ts
test('hace cuánto', () => {
  const ahora = '2026-11-24T18:30:00.000Z';
  expect(textoHaceCuanto(null, ahora)).toBe('nunca');
  expect(textoHaceCuanto('2026-11-24T18:29:40.000Z', ahora)).toBe('hace un momento');
  expect(textoHaceCuanto('2026-11-24T18:18:00.000Z', ahora)).toBe('hace 12 min');
  expect(textoHaceCuanto('2026-11-24T16:00:00.000Z', ahora)).toBe('hace 2 h');
});
test('sin sincronizar', () => {
  expect(textoSinSincronizar(0)).toBe('Todo sincronizado');
  expect(textoSinSincronizar(3)).toBe('3 sin sincronizar');
});
```

Quitar del spec existente las pruebas de las entradas viejas ("Todos los clientes", "Ruta y GPS", "Cerrar el día").

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=apps/tablet -- src/estado/ruta-del-dia.spec.ts src/estado/pie-menu.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `entradasMenu`, `pie-menu.ts`, `MarcoMenu` and the three pending screens; wrap the menu screens**

`MarcoMenu` sale de lo que hoy está dentro de `app/(jornada)/index.tsx` (cabecera propia + `MenuLateral` + `confirmarSalida`), para que Ruta y las demás pantallas del menú compartan una sola copia. El pie: `textoSinSincronizar(contarPendientesDeSubir(datos))` · `textoHaceCuanto(datos.catalogos.frescuraCatalogos(), new Date().toISOString())`, luego nombre del vendedor, "Vehículo: <nombre>" (solo con jornada; el de `jornada.vehiculo_id`) y "Sucursal: <nombre de sucursal>".

**El candado de Corte NO se prende en la pieza 1: `MarcoMenu` pasa `porVisitar: 0`.** Mientras Corte sea el `cerrar-dia` de hoy, el candado puede dejar el día sin cerrar: con control de inventario prendido y sin carga aceptada, los clientes no se abren (ni para Visita), "faltan N" nunca llega a 0 y la jornada no sube. La función ya trae y prueba la regla; la pieza 6 la conecta junto con el Corte nuevo (con `agruparRutaEnCurso(...).porVisitar.length`). Deja este motivo en un comentario junto a la llamada.

- [ ] **Step 4: Run tests, typecheck and lint** — `npm test --workspace=apps/tablet && npm run typecheck --workspace=apps/tablet && npm run lint --workspace=apps/tablet`. Expected: PASS.

- [ ] **Step 5: Verify in the emulator**

El menú se ve como la maqueta 3 desde Ruta, Inventario, Gastos, Merma / Cambios, Prospectos y Corte; cada entrada abre su destino (Corte abre `cerrar-dia`, sin candado en esta pieza); "Cerrar sesión" confirma como hoy.

- [ ] **Step 6: Commit** — `git commit -m "Rediseño pieza 1: menú lateral nuevo y marco de las pantallas del menú"`

---

### Task 3: Empezar ruta desde la Ruta (vehículo, km y candado de clientes)

**Files:**
- Create: `apps/tablet/src/estado/empezar-ruta.ts`
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts` (`vehiculoAsignadoHoy`)
- Modify: `apps/tablet/src/datos/repositorios/cargas.ts` (`candadoDeHoy`)
- Create: `apps/tablet/src/ui/tarjeta-empezar-ruta.tsx`
- Modify: `apps/tablet/app/index.tsx` (sin jornada también va a `/(jornada)`), `apps/tablet/app/(jornada)/_layout.tsx` (sin jornada solo deja pasar `index`; cualquier otra pantalla redirige a `/(jornada)`), `apps/tablet/app/(jornada)/index.tsx`
- Delete: `apps/tablet/app/abrir-dia.tsx` (y su `Stack.Screen` en `app/_layout.tsx`)
- Test: `apps/tablet/src/estado/empezar-ruta.spec.ts`, `apps/tablet/src/datos/repositorios/catalogos.spec.ts`, `apps/tablet/src/datos/repositorios/cargas.spec.ts`

**Interfaces:**
- Produces:
  - `vehiculoPorOmision(vehiculos: readonly Pick<Vehiculo, 'id'>[], asignadoId: string | null, elegidoId: string | null): string | null` — elegido si está en la lista; si no, asignado si está en la lista; si no, el primero; `null` sin vehículos.
  - `type CandadoClientes = { tipo: 'empezar' } | { tipo: 'sin-carga' } | { tipo: 'carga-pendiente'; cargaId: string } | { tipo: 'rechazada' } | null` (`null` = clientes abiertos).
  - `candadoDeClientes({ jornada, hoy, controlInventario, cargas }: { jornada: Pick<Jornada, 'fecha'> | null; hoy: FechaISO; controlInventario: boolean; cargas: readonly Pick<CargaInventario, 'id' | 'fecha' | 'estado' | 'activo'>[] }): CandadoClientes`
  - `TEXTO_CANDADO: Record<'sin-carga' | 'carga-pendiente' | 'rechazada', { titulo: string; texto: string }>`
  - `catalogos.vehiculoAsignadoHoy(): string | null` — `vehiculo_id` de la `ruta_dia` viva de `reloj.hoy()`.
  - `cargas.candadoDeHoy(vendedorId: string, jornada: Pick<Jornada, 'fecha'> | null): CandadoClientes`

Reglas (spec §4 y §16-bis): sin jornada de **hoy** → `empezar`. Control apagado → `null`. Con control: alguna carga viva de hoy `aceptada` → `null` (una recarga pendiente a media ruta **no** vuelve a cerrar); si no, una `pendiente` → `carga-pendiente`; si no, alguna `rechazada` → `rechazada`; sin cargas → `sin-carga`.

Textos: `carga-pendiente` = { titulo: 'Falta aceptar tu inventario', texto: 'Tienes una carga esperando. Acéptala para poder vender.' }; `sin-carga` = { titulo: 'Aún no te cargan', texto: 'Cuando el almacén capture tu carga, aquí te avisamos para aceptarla.' }; `rechazada` = { titulo: 'Rechazaste la carga', texto: 'Espera a que el almacén te mande una carga nueva para poder vender.' }. Botón de los tres: "Ir a inventario".

- [ ] **Step 1: Write the failing tests**

```ts
const HOY = '2026-11-24';
const carga = (estado: string, id = 'c1', fecha = HOY) => ({ id, fecha, estado, activo: 1 as const });

test('sin jornada de hoy hay que empezar ruta (también con la de ayer abierta)', () => {
  expect(candadoDeClientes({ jornada: null, hoy: HOY, controlInventario: true, cargas: [] })).toEqual({ tipo: 'empezar' });
  expect(candadoDeClientes({ jornada: { fecha: '2026-11-23' }, hoy: HOY, controlInventario: false, cargas: [] })).toEqual({ tipo: 'empezar' });
});

test('control apagado: clientes abiertos aunque haya carga pendiente', () => {
  expect(candadoDeClientes({ jornada: { fecha: HOY }, hoy: HOY, controlInventario: false, cargas: [carga('pendiente')] })).toBeNull();
});

test('control prendido', () => {
  const j = { fecha: HOY };
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [] })).toEqual({ tipo: 'sin-carga' });
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [carga('pendiente')] })).toEqual({ tipo: 'carga-pendiente', cargaId: 'c1' });
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [carga('rechazada')] })).toEqual({ tipo: 'rechazada' });
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [carga('aceptada'), carga('pendiente', 'c2')] })).toBeNull();
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [{ ...carga('aceptada'), activo: 0 }] })).toEqual({ tipo: 'sin-carga' });
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [carga('aceptada', 'c1', '2026-11-23')] })).toEqual({ tipo: 'sin-carga' });
});

test('vehículo por omisión', () => {
  const lista = [{ id: 'v1' }, { id: 'v2' }];
  expect(vehiculoPorOmision(lista, 'v2', null)).toBe('v2');
  expect(vehiculoPorOmision(lista, 'v9', null)).toBe('v1'); // asignado dado de baja u otra sucursal
  expect(vehiculoPorOmision(lista, 'v2', 'v1')).toBe('v1'); // lo cambió el vendedor
  expect(vehiculoPorOmision(lista, null, 'v9')).toBe('v1');
  expect(vehiculoPorOmision([], 'v2', null)).toBeNull();
});
```

En `catalogos.spec.ts`: con un snapshot que traiga `rutasDia: [{ id: 'rd1', fecha: HOY, nombre_ruta: 'Lunes 1', vehiculo_id: 'veh-1', activo: 1 }]`, `vehiculoAsignadoHoy()` da `'veh-1'`; con `activo: 0` o con fecha de ayer da `null`. En `cargas.spec.ts`: `candadoDeHoy` con la carga de prueba pendiente y el control prendido da `carga-pendiente`; tras `aplicarRespuesta` aceptada da `null`.

- [ ] **Step 2: Run tests to verify they fail** — `npm test --workspace=apps/tablet -- empezar-ruta catalogos cargas`. Expected: FAIL.

- [ ] **Step 3: Implement the pure functions and repository methods**

- [ ] **Step 4: Implement `TarjetaEmpezarRuta` and the routing change**

La tarjeta (maqueta 1) va arriba de la lista: selector de vehículo (los de `catalogos.listarVehiculos(sucursalId)`, preseleccionado con `vehiculoPorOmision`), "Kilometraje inicial" y "Empezar ruta". Al tocar: `datos.jornadas.abrir({ vendedorId, vehiculoId, kmInicial })`, `datos.rutas.purgar()` (con el mismo `try/catch` de `abrir-dia.tsx`) y `refrescarJornada()`. Errores de `ErrorJornada` se muestran en la tarjeta. Con candado `sin-carga` / `carga-pendiente` / `rechazada` la tarjeta cambia al aviso de la maqueta 2 con `TEXTO_CANDADO` y "Ir a inventario" (a `/(jornada)/inventario/[cargaId]` si hay `cargaId`, si no a `/(jornada)/inventario`). Con candado distinto de `null`, las filas se pintan atenuadas y `onTocar` no hace nada. La tarjeta "Carga por aceptar" actual de la Ruta se quita (la sustituye el aviso cuando hay candado; sin candado, una recarga pendiente se sigue avisando con la misma tarjeta de hoy).

- [ ] **Step 5: Run tests, typecheck and lint.** Expected: PASS.

- [ ] **Step 6: Verify in the emulator**

`adb shell pm clear` NO (choca folios; ver memoria del proyecto): usar un vendedor sin jornada hoy. Login → cae en Ruta con la tarjeta y el vehículo asignado en el portal ya elegido → Empezar ruta → aviso de inventario (con control prendido) → aceptar carga → clientes abiertos. Reiniciar la app: no vuelve a pedir km.

- [ ] **Step 7: Commit** — `git commit -m "Rediseño pieza 1: empezar ruta en la Ruta con el vehículo asignado y candado de inventario"`

---

### Task 4: Ruta en curso: orden fijo, Por visitar / Visitados, resumen y contador de notas

**Files:**
- Modify: `apps/tablet/src/datos/repositorios/rutas.ts` (`delDia`: orden y columnas nuevas; quitar `reordenar` y su uso)
- Modify: `apps/tablet/src/datos/repositorios/notas-asignadas.ts` (`queTraePorCliente`)
- Modify: `apps/tablet/src/estado/ruta-del-dia.ts` (`agruparRutaEnCurso`, `resumenVisitado`; quitar `moverElemento` e `indiceDestino`)
- Create: `apps/tablet/src/ui/pesos.ts` (se mueve `pesos` de `cifra.tsx`, que lo reexporta)
- Modify: `apps/tablet/src/ui/lista-ruta.tsx` (sin arrastre; fila con número de orden, contador de notas con icono `nota`, resumen en Visitados)
- Modify: `apps/tablet/app/(jornada)/index.tsx` (secciones; cabecera: a la derecha `agregar-cliente` → `/(jornada)/agregar-a-ruta` y `sincronizar` con su número)
- Test: `apps/tablet/src/datos/repositorios/rutas.spec.ts`, `apps/tablet/src/datos/repositorios/notas-asignadas.spec.ts`, `apps/tablet/src/estado/ruta-del-dia.spec.ts`

**Interfaces:**
- Consumes: `CandadoClientes` (Task 3), `NombreIcono` (Task 1).
- Produces:
  - `FilaRutaDelDia` gana: `venta_contado_centavos: number`, `venta_credito_centavos: number`, `cobro_centavos: number`, `con_merma: boolean`, `notas_que_trae: number`. `visitado` pasa a ser venta, cobro, visita, comentario de no cobro **o merma del cliente** de hoy. `posicion` se quita.
  - `notasAsignadas.queTraePorCliente(vendedorId: string): Map<string, number>`
  - `agruparRutaEnCurso<T extends FilaAgrupable>(filas: readonly T[]): { porVisitar: T[]; visitados: T[]; fueraDeRuta: T[] }` — vivas sin visitar / vivas visitadas (con o sin venta) / quitadas con actividad (misma regla de hoy). Sustituye a `agruparRuta` en la pantalla; `agruparRuta` y `FilaVisitadoSinVenta` se borran si nada más los usa.
  - `resumenVisitado(f: Pick<FilaRutaDelDia, 'venta_contado_centavos' | 'venta_credito_centavos' | 'cobro_centavos' | 'con_merma' | 'ultima_visita_motivo' | 'visita_sin_venta'>): string`

Orden: `order by r.orden, c.nombre` (ya no `ruta_orden_local`). Contador (spec §4): asignadas de hoy con saldo > 0 y no liquidadas hoy **más** ventas a crédito de hoy de este vendedor con ese cliente; una venta de hoy que ya bajó como `nota_pendiente` (mismo `folio`) cuenta solo si esa nota sigue `activo = 1` con saldo > 0, y nunca dos veces si además está asignada. Cero no se pinta.

`resumenVisitado`, partes en este orden unidas con " · ": "Cobro $850.00" si cobró; "Venta $1,240.00" si vendió de contado; "Venta a crédito $1,240.00" si a crédito; "Merma" si registró merma; si no hay ninguna de esas y hubo visita, "Visita sin venta · <motivo en minúsculas>" ("Visita sin venta" a secas sin motivo). **Formato de dinero: el de la app, con centavos** (`pesos()`); las maquetas sin centavos son de ejemplo.

`pesos()` hoy vive en `src/ui/cifra.tsx` (un `.tsx` que Jest no carga): moverlo tal cual a `src/ui/pesos.ts` (`export function pesos(centavos: number): string`) y que `cifra.tsx` lo reexporte, para que `ruta-del-dia.ts` y `hoja-cliente.ts` (Task 5) lo importen de `@/ui/pesos`.

- [ ] **Step 1: Write the failing tests**

```ts
// ruta-del-dia.spec.ts
test('por visitar, visitados (con o sin venta) y fuera de ruta', () => {
  const g = agruparRutaEnCurso([
    fila('a', 1, false), fila('b', 1, true), fila('c', 1, true, true), fila('d', 0, true), fila('e', 0, false),
  ]);
  expect(g.porVisitar.map((f) => f.cliente_id)).toEqual(['a']);
  expect(g.visitados.map((f) => f.cliente_id)).toEqual(['b', 'c']);
  expect(g.fueraDeRuta.map((f) => f.cliente_id)).toEqual(['d']);
});

test('resumen de lo hecho', () => {
  const base = { venta_contado_centavos: 0, venta_credito_centavos: 0, cobro_centavos: 0, con_merma: false, ultima_visita_motivo: null, visita_sin_venta: false };
  expect(resumenVisitado({ ...base, cobro_centavos: 85000, venta_credito_centavos: 124000 })).toBe('Cobro $850.00 · Venta a crédito $1,240.00');
  expect(resumenVisitado({ ...base, venta_contado_centavos: 50000, con_merma: true })).toBe('Venta $500.00 · Merma');
  expect(resumenVisitado({ ...base, visita_sin_venta: true, ultima_visita_motivo: 'Cerrado' })).toBe('Visita sin venta · cerrado');
  expect(resumenVisitado({ ...base, visita_sin_venta: true })).toBe('Visita sin venta');
  expect(resumenVisitado({ ...base, con_merma: true })).toBe('Merma');
});
```

En `rutas.spec.ts`, con el `montar()` que ya existe (más `movimientos: crearRepositorioMovimientos(deps, { catalogos })` y `notasAsignadas`):

- **"el orden es el del servidor aunque exista ruta_orden_local"**: aplicar del servidor `cli-1` orden 1 y `cli-3` orden 2; `insert into ruta_orden_local (fecha, cliente_id, posicion) values (HOY, 'cli-3', 0)` a mano; `delDia().map((f) => f.cliente_id)` es `['cli-1', 'cli-3']`.
- **"una merma del cliente hoy lo manda a visitados"**: abrir jornada, `movimientos.registrar` de tipo `merma_cliente` con `cli-1` y una línea recibida; la fila de `cli-1` tiene `visitado: true`, `con_merma: true`, `visita_sin_venta: false`.
- **"suma venta de contado, a crédito y cobro de hoy"**: una venta de contado de 500.00 y una a crédito de 1,240.00 a `cli-1`, y un cobro de 850.00 a una nota pendiente de `cli-1`; la fila trae `venta_contado_centavos: 50000`, `venta_credito_centavos: 124000`, `cobro_centavos: 85000`. Una venta de **ayer** no suma.

En `notas-asignadas.spec.ts`, **"notas que trae: asignada con saldo + venta a crédito de hoy, sin contar doble"**, con `queTraePorCliente('ven-1').get('cli-1')` después de cada paso:

1. Una `nota_asignada` de hoy a una `nota_pendiente` de `cli-1` con saldo 1,000.00 → `1`.
2. Una venta a crédito local de hoy a `cli-1` (folio `F1`) → `2`.
3. Snapshot con una `nota_pendiente` folio `F1`, saldo > 0, activa → `2`.
4. Además, una `nota_asignada` de hoy a esa nota `F1` → `2`.
5. Un cobro de hoy que liquida la nota del paso 1 → `1`.
6. Una venta de contado de hoy a `cli-1` → sigue `1`.
7. La `nota_pendiente` `F1` llega con `activo: 0` (se pagó en la oficina) → `0` (y `get` puede dar `undefined`: comparar con `?? 0`).

- [ ] **Step 2: Run tests to verify they fail.** Expected: FAIL.

- [ ] **Step 3: Implement repository and pure changes**

- [ ] **Step 4: Implement the screen**: secciones "Por visitar N" y "Visitados N" (maqueta 6); las de "Fuera de ruta" y "Atendidos fuera de ruta" se quedan debajo como hoy. Sin arrastre ni `reordenar`. El botón "Agregar a mi ruta" del final y el de la tarjeta "Sin ruta" se quedan.

- [ ] **Step 5: Run tests, typecheck and lint.** Expected: PASS.

- [ ] **Step 6: Verify in the emulator**: la ruta sale en el orden del portal; un cliente con venta o merma baja a Visitados con su resumen y se puede volver a abrir; el número de notas coincide con las notas que trae.

- [ ] **Step 7: Commit** — `git commit -m "Rediseño pieza 1: ruta en orden fijo con Por visitar, Visitados y notas que trae"`

---

### Task 5: Hoja del cliente

**Files:**
- Create: `apps/tablet/src/estado/hoja-cliente.ts`
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx`
- Modify: `apps/tablet/app/(jornada)/_layout.tsx` (`operacion/[clienteId]/index` como hoja; ver Step 0)
- Test: `apps/tablet/src/estado/hoja-cliente.spec.ts`

**Interfaces:**
- Consumes: `CandadoClientes` (Task 3); `pesos` de `@/ui/pesos` (Task 4); `porAtender`, `motivoBloqueoVenta` de `src/datos/notas-asignadas-reglas.ts`; `venderDesdeFicha` de `src/estado/notas-asignadas.ts` (solo su `destino`).
- Produces:
  - `accionesCliente({ asignadas, notasConSaldo, esProspecto, operacionesHabilitadas, candado }: { asignadas: readonly NotaAsignadaDeHoy[]; notasConSaldo: number; esProspecto: boolean; operacionesHabilitadas: boolean; candado: CandadoClientes }): AccionesCliente`
  - `interface AccionesCliente { vender: { habilitado: boolean; nota: string | null }; cobrar: { visible: boolean; principal: boolean; nota: string } | null; visita: { habilitado: boolean }; merma: { habilitado: boolean } }`

Reglas (spec §6): con `candado !== null` o `operacionesHabilitadas: false`, todo deshabilitado. **Cobrar** visible si hay alguna nota con saldo (asignada o no) y no es prospecto; `principal` si `porAtender(asignadas)` no está vacío; `nota` = "1 nota asignada · $1,120.00" / "2 notas asignadas · $2,000.00" (suma de saldos de `porAtender(asignadas)`), o "1 nota pendiente" / "N notas pendientes" si no hay asignada por atender. **Vender**: `habilitado = motivoBloqueoVenta(asignadas) === null`, y si no, `nota: 'Cobra primero'`; para prospecto, nota "Solo regalo de bienvenida".

**Ojo, cambio de regla respecto de hoy:** hoy la ficha usa `venderDesdeFicha(asignadas).bloqueo`, que **no** bloquea mientras haya una asignada por atender (manda a la pantalla `notas-asignadas` a cobrar o comentar). El spec §6 y Mario piden que con condición Vender salga **apagado hasta que se grabe el cobro que la cumple**, que es exactamente `motivoBloqueoVenta(asignadas)` (usa `cumpleCondicion`, sin pasar por `porAtender`). No se toca ninguna función de `notas-asignadas-reglas.ts`. Cuando Vender sí está habilitado, el destino sigue saliendo de `venderDesdeFicha(asignadas).destino` (una asignada sin condición sigue pasando primero por `notas-asignadas`). `ventas.registrar()` ya revisa el mismo bloqueo dentro de su transacción.

- [ ] **Step 0: Probar la hoja en el emulador antes de construir**

Poner en `_layout.tsx` `options={{ presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true, headerShown: false }}` a `operacion/[clienteId]/index` y abrir un cliente en el emulador. Si la hoja sube sobre la ruta y se puede arrastrar a pantalla completa, seguir. Si no (versión de `react-native-screens`, Android), **no** inventar un modal propio: dejar la ficha como pantalla completa con el contenido en el orden de la maqueta 7 y anotarlo en el PR.

- [ ] **Step 1: Write the failing tests**

```ts
test('sin notas no hay Cobrar', () => {
  expect(accionesCliente({ asignadas: [], notasConSaldo: 0, esProspecto: false, operacionesHabilitadas: true, candado: null }).cobrar).toBeNull();
});
test('con nota no asignada, Cobrar sin destacar', () => {
  expect(accionesCliente({ asignadas: [], notasConSaldo: 2, esProspecto: false, operacionesHabilitadas: true, candado: null }).cobrar)
    .toEqual({ visible: true, principal: false, nota: '2 notas pendientes' });
});
test('nota asignada con condición: Cobrar principal y Vender apagado con "Cobra primero"', () => {
  const a = accionesCliente({ asignadas: [asignada({ saldoCentavos: 112000, condicion: 'liquidar' })], notasConSaldo: 1, esProspecto: false, operacionesHabilitadas: true, candado: null });
  expect(a.cobrar).toEqual({ visible: true, principal: true, nota: '1 nota asignada · $1,120.00' });
  expect(a.vender).toEqual({ habilitado: false, nota: 'Cobra primero' });
});
test('condición ya cumplida hoy: Vender se enciende y Cobrar deja de ser principal', () => {
  const a = accionesCliente({ asignadas: [asignada({ saldoCentavos: 0, condicion: 'liquidar', tocadaHoy: true, liquidadaHoy: true })], notasConSaldo: 0, esProspecto: false, operacionesHabilitadas: true, candado: null });
  expect(a.vender).toEqual({ habilitado: true, nota: null });
  expect(a.cobrar).toBeNull();
});
test('con candado de inventario nada se puede hacer', () => {
  const a = accionesCliente({ asignadas: [], notasConSaldo: 1, esProspecto: false, operacionesHabilitadas: true, candado: { tipo: 'sin-carga' } });
  expect([a.vender.habilitado, a.visita.habilitado, a.merma.habilitado]).toEqual([false, false, false]);
});
test('día cerrado: nada se puede hacer', () => {
  const a = accionesCliente({ asignadas: [], notasConSaldo: 1, esProspecto: false, operacionesHabilitadas: false, candado: null });
  expect([a.vender.habilitado, a.visita.habilitado, a.merma.habilitado]).toEqual([false, false, false]);
});
test('prospecto: sin Cobrar y Vender con su nota', () => {
  const a = accionesCliente({ asignadas: [], notasConSaldo: 0, esProspecto: true, operacionesHabilitadas: true, candado: null });
  expect(a.cobrar).toBeNull();
  expect(a.vender).toEqual({ habilitado: true, nota: 'Solo regalo de bienvenida' });
});
```

`asignada(cambios)` es un helper local que arma un `NotaAsignadaDeHoy` completo (`asignacionId: 'a1'`, `ventaNotaId: 'n1'`, `clienteId: 'cli-1'`, `folio: 'TJ261124JP01'`, `fecha: '2026-11-20'`, `saldoCentavos: 100000`, `diasAtraso: 0`, `condicion: 'ninguna'`, `tocadaHoy: false`, `liquidadaHoy: false`, `comentadaHoy: false`) y aplica `cambios`.

- [ ] **Step 2: Run tests to verify they fail.** Expected: FAIL.

- [ ] **Step 3: Implement `accionesCliente`**

- [ ] **Step 4: Rebuild the sheet** (maqueta 7): nombre; "Encargado" con nombre y teléfono (toca → marcador, `urlTelefono`); botón **Ir** (`urlMapa`, abre Maps); botones en rejilla: Cobrar (si aplica, a lo ancho y primero cuando `principal`, con su `nota`; abre `cobranza` con la primera de `porAtender` como hoy), Vender (con su `nota` debajo cuando está apagado), Visita ("sin venta"), Merma. El **recado de la oficina** se queda visible arriba de los botones (es un aviso, no un detalle). La tarjeta "Notas asignadas por cobrar" con "Continuar sin cobrar" también se queda visible, debajo de los botones, mientras haya asignadas por atender (la pregunta abierta 3 del spec, si se conserva el comentario de no cobro, no está resuelta: no se esconde). Lo demás (saldo a favor, promociones, ventas / visitas / movimientos / cobros de hoy y foto) va plegado en "Ver más", sin cambiar su lógica. La hoja recibe el candado con `datos.cargas.candadoDeHoy(vendedor.id, jornada)`.

- [ ] **Step 5: Run tests, typecheck and lint.** Expected: PASS.

- [ ] **Step 6: Verify in the emulator**: tocar un cliente abre la hoja sobre la ruta; "Ir" abre Maps; con nota asignada con condición aparece Cobrar destacado y Vender apagado con "Cobra primero"; tras cobrar, Vender se enciende.

- [ ] **Step 7: Commit** — `git commit -m "Rediseño pieza 1: hoja del cliente con encargado, Ir y acciones"`

---

### Task 6: Agregar a ruta, Prospectos y Gastos simplificado

**Files:**
- Modify: `apps/tablet/src/estado/ruta-del-dia.ts` (`clientesParaAgregar`, sustituye a `filtrarParaAgregar`)
- Modify: `apps/tablet/app/(jornada)/agregar-a-ruta.tsx`
- Modify: `apps/tablet/app/(jornada)/prospectos.tsx` (lista "Capturados" primero con "Nuevo prospecto"; el formulario se abre aparte o se despliega; tocar un capturado con espejo local abre su hoja)
- Modify: `apps/tablet/app/(jornada)/gastos/index.tsx` (formulario arriba: Motivo + Cantidad + "Guardar gasto"; abajo "Gastos de hoy" con total)
- Delete: `apps/tablet/app/(jornada)/gastos/registrar.tsx` (y su `Stack.Screen`)
- Test: `apps/tablet/src/estado/ruta-del-dia.spec.ts`, `apps/tablet/src/estado/gasto.spec.ts`

**Interfaces:**
- Produces:
  - `clientesParaAgregar<T extends Pick<Cliente, 'id' | 'nombre' | 'tipo' | 'activo'>>(clientes: readonly T[], enRuta: ReadonlySet<string>, busqueda: string, limite?: number): (T & { enRuta: boolean })[]` — todos los clientes activos de la sucursal (tipo `cliente`), en orden alfabético, filtrados por nombre sin acentos, con `enRuta`.
  - `gasto.ts` no cambia: la pantalla llama `validarGasto` con `comentario: ''` y `fotoUri: null` (el servidor ya los acepta vacíos).

- [ ] **Step 1: Write the failing tests**

```ts
test('agregar a ruta muestra a todos con su marca "En ruta"', () => {
  const r = clientesParaAgregar(
    [c('1', 'Mini Súper Otay'), c('2', 'Abarrotes La Esperanza'), c('3', 'Prospecto X', 'prospecto'), c('4', 'Baja', 'cliente', 0)],
    new Set(['1']), '',
  );
  expect(r.map((x) => [x.nombre, x.enRuta])).toEqual([['Abarrotes La Esperanza', false], ['Mini Súper Otay', true]]);
});
test('busca sin acentos', () => {
  expect(clientesParaAgregar([c('1', 'Mini Súper Otay')], new Set(), 'super').length).toBe(1);
});
```

En `gasto.spec.ts`, **"un gasto con solo motivo y cantidad es válido"**: `validarGasto({ campo, monto: '500.00', comentario: '', fotoUri: null, diaCerrado: false })` (la `EntradaGasto` de hoy; la pantalla manda `comentario: ''` y `fotoUri: null` fijos) devuelve `faltantes: []` y `gasto: { campoEgresoId: campo.id, montoCentavos: 50000, comentario: '', fotoUri: null }`. Si esa prueba ya pasa sin cambios, se queda como guardia y el Step 2 de esta tarea solo falla por `clientesParaAgregar`.

- [ ] **Step 2: Run tests to verify they fail.** Expected: FAIL.

- [ ] **Step 3: Implement** `clientesParaAgregar` and the three screens (maquetas 19, 20, 21). Agregar a ruta: renglón con "En ruta" (no tocable) o botón "Agregar a ruta" (`datos.rutas.agregar`, como hoy, con y sin red). Gastos: el selector de motivo es el de `camposParaGasto`; el número usa `montoACentavos`; se quitan observaciones, método y foto.

- [ ] **Step 4: Run tests, typecheck and lint.** Expected: PASS.

- [ ] **Step 5: Verify in the emulator**: agregar un cliente sin red lo pone al final de "Por visitar" con "Por subir"; un prospecto capturado abre su hoja (con el candado de Task 3); un gasto se guarda con motivo y cantidad y aparece abajo.

- [ ] **Step 6: Commit** — `git commit -m "Rediseño pieza 1: agregar a ruta, Prospectos y Gastos simplificado"`

---

### Task 7: Cierre de la pieza

**Files:**
- Modify: `apps/tablet/README.md` (pantallas que cambiaron)
- Vault: `20-Arquitectura/App Tablet.md` y `00-Inicio/Estado del proyecto.md` (commit y push a `main` del vault)

- [ ] **Step 1:** `npm test --workspace=apps/tablet && npm run typecheck --workspace=apps/tablet && npm run lint --workspace=apps/tablet && npm run export --workspace=apps/tablet` — todo en verde.
- [ ] **Step 2:** Recorrido completo en el emulador contra la maqueta: login → Ruta → empezar → inventario → cliente → vender → Visitados → menú → Gastos → Agregar a ruta → Prospectos → Corte con candado.
- [ ] **Step 3:** Actualizar README y vault; commit.
- [ ] **Step 4:** `git push -u origin feature/rediseno-pieza-1-cascara` y abrir PR con resumen, lo provisional (tabla de arriba), el cambio de regla de Vender (Task 5) y, si la hoja quedó como pantalla completa, el motivo. No mergear.
