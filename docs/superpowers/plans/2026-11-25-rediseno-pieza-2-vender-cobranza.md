# Rediseño app del vendedor — Pieza 2: Vender y Cobranza — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vender en tres pasos (Promociones en checklist → lista de lo disponible con teclado propio → Cobranza con Liquidar / Abonar / Crédito y nombre de quien atiende obligatorio), sin firma en pantalla, y Cobrar una nota con las mismas leyendas.

**Architecture:** El abono al vender viaja **dentro de la operación `venta`** (campo nuevo `abono_centavos`) y el servidor lo escribe como el cobro automático del contado (`cobranza_abono` de origen `venta_contado`, sin `cobro`), con la nota en `abonado`. Así no hace falta que la tablet conozca el id de `venta_nota` (el servidor le da uno nuevo; ver "Por qué no un cobro aparte"). El nombre de quien atiende es un campo nuevo `atendio` (columna `venta_nota.atendio_nombre`), separado de la firma de T-73. Toda decisión de pantalla vive en funciones puras con prueba; las pantallas solo pintan.

**Tech Stack:** NestJS + Kysely (backend), Postgres/Supabase migrations, Next.js (portal), Expo Router + SQLite (tablet), Jest/Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §8 (Promociones y la lista), §9 (Cobranza de la venta), §10 (Cobrar). Maquetas 8–13 en `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor/maquetas.html`. **Maquetas mandan en acomodo y textos; el spec en reglas.**

## Global Constraints

- Rama `feature/rediseno-pieza-1-cascara`, worktree `JAWA ANDROID/proyecto-sinmex-cascara` (todas las piezas del rediseño van en esta rama). **No se abre PR** (Mario: un solo PR al final). Nunca tocar `JAWA ANDROID/proyecto-sinmex`.
- Iconos SVG (`src/ui/iconos.ts`), nunca glifos ni emojis; `src/ui/sin-glifos.spec.ts` lo vigila.
- En pantalla se dice "promociones" / "piezas de promoción", nunca "regalos".
- Contrato de sincronización: cambios **aditivos**, `CONTRATO_ACTUAL` sigue en 1; los dos `contrato.ts` (backend normativo y copia de la tablet) y `docs/contrato-sincronizacion.md` cambian en el mismo commit.
- Migración del servidor con timestamp único (revisar `ls supabase/migrations`); aplicarla con `npm run supabase -- migration up --local` y regenerar `npm run db:types --workspace=apps/backend`. **No** se sube a la nube.
- Hasta la pieza 7 (impresión) el botón dice **"Grabar"**, no "Grabar e imprimir".
- Dinero en centavos enteros; formato en pantalla con `pesos()` de `@/ui/pesos` ("$1,120.00").
- Verificación por tarea: las suites del paquete tocado (`npm test --workspace=apps/tablet|apps/backend|apps/portal`, typecheck/lint/build según el paquete) en verde; e2e del backend cuando la tarea lo dice (requiere Supabase local arriba).
- Commits con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisiones tomadas sin respuesta de Mario (se pueden tumbar)

1. **Abono al vender en efectivo**, como el contado de hoy (el contado de la tablet ya se proyecta con `metodo_pago = 'efectivo'`). La forma de pago sigue siendo pregunta abierta.
2. **Cobrar conserva Efectivo / Transferencia / Cheque** (chips debajo del monto, efectivo por omisión) aunque la maqueta 13 no los dibuja: quitarlos perdería una función que hoy se usa. La **fecha de pago** deja de capturarse: es hoy.
3. **No se pide el nombre de quien atiende al Cobrar** (Mario lo pidió para la venta).
4. Los campos de la venta que la maqueta no tiene (`num_nota`, `factura`, `comentarios`) **se quitan de la pantalla** y se mandan con su valor por omisión (`null`, `'N/A'`, `null`). La oficina los corrige en el portal si hace falta.
5. **Abonar** exige un monto mayor que cero y **menor** que el total (o que lo que debe, en Cobrar); igual al total es Liquidar.
6. La presentación de una promoción que da un producto viene elegida: la primera del catálogo (spec §8).
7. El comentario "Continuar sin cobrar" se conserva como está (pieza 1).

## Por qué no un cobro aparte para el abono al vender

El servidor inserta `venta_nota` con un id nuevo (`ventas.repository.ts` `insertarVenta` → `.returning('id')`), así que una `cobranza` de la tablet que apunte al `venta.id` local cae para siempre en `nota-no-encontrada`; y en la tablet `cobranza.venta_nota_id` es FK a `nota_pendiente`, que solo llena el pull. Además, un cobro (`cobro_id` no nulo) bloquearía editar la venta en el portal (T-17), cosa que el cobro automático del contado no hace.

## Review Focus

1. **Venta abonada editada o eliminada en el portal** (T-17): el abono de origen `venta_contado` debe recalcularse/borrarse igual que el del contado y el status quedar coherente (`pendiente`/`abonado`/`pagada`). → prueba en Task 1 (e2e de edición de una venta abonada).
2. **Tablet vieja** (sin `atendio` ni `abono_centavos`): la venta entra igual que hoy. → prueba en Task 1 (`datos-venta.spec.ts`).
3. **Abono que llega igual o mayor al total, o con `contado`**: `datos-invalidos`, nunca un 500. → prueba en Task 1.
4. **Venta solo de piezas de promoción ($0.00)**: Cobranza ofrece solo Liquidar (sin Abonar ni Crédito) y graba como hoy. → prueba en Task 4 (`opcionesCobranza`).
5. **Control de inventario apagado**: la lista muestra todas las presentaciones activas sin "te quedan" y el teclado no tiene tope. → prueba en Task 4 (`renglonesVenta`, `teclear`).

---

### Task 1: Servidor — `atendio` y `abono_centavos` en la venta

**Files:**
- Create: `supabase/migrations/<timestamp único>_venta_atendio.sql` (columna `venta_nota.atendio_nombre text` con check `atendio_nombre is null or char_length(btrim(atendio_nombre)) between 1 and 80`)
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts`, `apps/tablet/src/sincronizacion/contrato.ts`, `docs/contrato-sincronizacion.md`
- Modify: `apps/backend/src/modules/ventas-cobranza/datos-venta.ts` (+ spec), `ventas.service.ts` (+ spec), `ventas.repository.ts`, `reglas-venta.ts` (+ spec), `apps/backend/src/database/schema.d.ts` (regenerado)
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts` (detalle con `atendio`)
- Test: `apps/backend/test/ventas.e2e-spec.ts` o `sincronizacion.e2e-spec.ts` (el que ya cubre el push de ventas)

**Interfaces:**
- Produces (contrato, `DatosVenta`): `atendio?: string | null` (1..80 recortado; vacío = null) y `abono_centavos?: number | null` (entero, `0 < abono < monto_total`, solo con `contado_credito = 'credito'`). Ausentes = comportamiento de hoy.
- Produces (`VentaNormalizada`): `atendio: string | null`, `abonoCentavos: number | null`.
- Produces (detalle de venta del portal): `atendio: string | null`.

Reglas: con `abono_centavos` la venta se proyecta con status `abonado` y un `cobranza_abono` de origen `venta_contado`, `cobro_id` null, `metodo_pago = 'efectivo'`, `fecha_pago = fecha_operacion`, `tipo = 'abono'`, por el monto del abono (mismo camino que el abono automático del contado en `ventas.service.ts`). `statusInicial` gana el caso. Errores de forma con `datos-invalidos` y el campo (`abono_centavos: …`, `atendio: …`).

- [ ] **Step 1: Write the failing tests** — en `datos-venta.spec.ts`: `atendio` válido/recortado/vacío→null/>80 inválido/no texto inválido; `abono_centavos` ausente o null → null; entero entre 1 y total−1 con crédito → válido; 0, negativo, decimal, igual al total, mayor al total, o con contado → `datos-invalidos` con campo `abono_centavos`. En `reglas-venta.spec.ts`: `statusInicial` con abono → `abonado`. En `ventas.service.spec.ts`: crédito con abono inserta un abono `venta_contado` por el monto y guarda `atendio_nombre`. e2e: push de una venta a crédito con `abono_centavos: 30000` sobre total 80400 → `venta_nota.status = 'abonado'`, saldo 50400, un `cobranza_abono` vivo de origen `venta_contado`; la venta aparece en el pull como nota pendiente con saldo 50400 y `abonos_json` con ese abono; **editar esa venta en el portal** (cambiar una cantidad) conserva el abono y recalcula status/saldo; eliminarla da de baja el abono.
- [ ] **Step 2: Run tests to verify they fail** — `npm test --workspace=apps/backend -- datos-venta reglas-venta ventas.service`. Expected: FAIL.
- [ ] **Step 3: Migración**, aplicar local (`npm run supabase -- migration up --local`) y `npm run db:types --workspace=apps/backend`.
- [ ] **Step 4: Implement** contrato (los dos `contrato.ts` y el doc), normalización, proyección y detalle. Si la edición del portal (T-17, `ventas-edicion.*`) trata el abono `venta_contado` como "el total del contado", ajustarla para que respete el monto de un abono de venta a crédito y documentarlo en el código.
- [ ] **Step 5: Run** `npm test --workspace=apps/backend`, `npm run test:e2e --workspace=apps/backend` (suites tocadas), `npm run lint --workspace=apps/backend`, `npm run build --workspace=apps/backend`. Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "Rediseño pieza 2: la venta lleva quién atendió y el abono al vender"`

---

### Task 2: Portal — "Atendió" en el detalle de la venta

**Files:**
- Modify: `apps/portal/src/lib/ventas.ts` (tipo del detalle), el componente del detalle (`apps/portal/src/components/ventas/detalle-venta.tsx` o el que pinta la cabecera) y `firma-venta.tsx` si hace falta
- Test: `apps/portal/src/components/ventas/detalle-venta.test.tsx`

**Interfaces:**
- Consumes: `atendio: string | null` del detalle (Task 1).

Reglas: en la cabecera del detalle, "Atendió: <nombre>" cuando `atendio` no es null; nada si es null. El bloque de firma de T-73 no cambia (ventas viejas). Usar las piezas de `components/ui/`.

- [ ] **Step 1: Failing test** — el detalle con `atendio: 'María de Jesús Ramos'` muestra "Atendió" y el nombre; con `null` no muestra "Atendió".
- [ ] **Step 2: Run** `npm test --workspace=apps/portal -- detalle-venta`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test --workspace=apps/portal` y `npm run lint --workspace=apps/portal`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Rediseño pieza 2: el portal muestra quién atendió la venta"`

---

### Task 3: Tablet, datos — venta sin firma, con quién atendió y abono

**Files:**
- Create: `apps/tablet/src/datos/migraciones/020-venta-atendio-abono.ts` (+ spec) y registrarla en `migraciones/index.ts`: `alter table venta add column atendio_nombre text` y `add column abono_centavos integer` (sin check: lo valida el repositorio)
- Modify: `apps/tablet/src/datos/tipos.ts` (`Venta`), `apps/tablet/src/datos/repositorios/ventas.ts` (+ spec), `apps/tablet/src/datos/ventas-reglas.ts` (+ spec), `apps/tablet/src/sincronizacion/fuente-ventas.ts` (+ spec)
- Modify: `apps/tablet/src/datos/repositorios/rutas.ts` y `src/estado/ruta-del-dia.ts` solo si hace falta para que el resumen de Visitados diga "Venta a crédito" también con abono (sin cambiar textos)

**Interfaces:**
- Produces: `DatosRegistroVenta` pierde `firma` y `numNota`/`factura`/`comentarios` pasan a opcionales (por omisión `null`/`'N/A'`/`null`); gana `atendio: string` (obligatorio) y `abonoCentavos?: number | null`.
- Produces: `validarAtendio(texto: string): string | null` (mensaje de error o null; recorta; 1..80) en `ventas-reglas.ts`, y `LARGO_MAX_ATENDIO = 80`.
- Produces: en el push, `atendio` y `abono_centavos` (solo si no es null) en `datos` de la venta; **ya no se manda `firma`** para ventas nuevas. `fuenteFirmasVentas` no cambia (sube firmas de ventas viejas que aún no suben).

Reglas en `ventas.registrar`: `atendio` recortado obligatorio ("Escribe el nombre de quien atiende."), >80 → error; `abonoCentavos` solo con crédito y `0 < abono < total` ("El abono debe ser mayor a $0.00 y menor al total."); con contado o null se guarda null. Lo demás (inventario, notas asignadas, folio) no cambia.

- [ ] **Step 1: Failing tests** — `ventas.spec.ts`: registra sin firma con `atendio`; sin `atendio` o en blanco → `ErrorVenta`; `atendio` de 81 → `ErrorVenta`; crédito con abono 30000 sobre 80400 → guarda `abono_centavos = 30000`; abono 0, = total o con contado → `ErrorVenta`; ninguna de esas quema folio. `fuente-ventas.spec.ts`: la operación lleva `atendio` y `abono_centavos` y **no** lleva `firma`; una venta vieja con `firma_local` sigue mandando `firma`. `ventas-reglas.spec.ts`: `validarAtendio`. Migración 020: columnas nuevas nulas en filas viejas.
- [ ] **Step 2: Run** `npm test --workspace=apps/tablet -- ventas fuente-ventas 020`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test --workspace=apps/tablet`, typecheck y lint. Expected: PASS. (La pantalla `venta.tsx` deja de compilar si todavía pasa `firma`: en este paso basta con mandarle `atendio` fijo de la captura vieja; Task 5 la rehace.)
- [ ] **Step 5: Commit** — `git commit -m "Rediseño pieza 2: la tablet graba la venta con quién atendió y el abono, sin firma"`

---

### Task 4: Tablet, reglas de las pantallas de venta y cobro

**Files:**
- Create: `apps/tablet/src/estado/venta-pasos.ts` (+ spec)
- Create: `apps/tablet/src/estado/cobrar.ts` (+ spec)

**Interfaces:**
- Produces en `venta-pasos.ts`:
  - `type PasoVenta = 'promociones' | 'lista' | 'cobranza' | 'grabada'`; `primerPaso(hayPromociones: boolean): PasoVenta`; `pasoAnterior(p: PasoVenta, hayPromociones: boolean): PasoVenta | null` (`null` = salir de la venta; desde `grabada` también `null`).
  - `checklistPromociones(promociones: readonly PromocionAplicable[], descartados: ReadonlySet<string>): { todas: boolean; palomeadas: number; total: number }` y `alternarTodas(promociones, descartados): Set<string>` (si todas están palomeadas, las quita todas; si no, las pone todas).
  - `presentacionPorOmision(productoId: string, catalogo: CatalogoPromociones): string | null` — la primera presentación del producto en el orden del catálogo.
  - `interface RenglonVenta { presentacionId: string; etiqueta: string; precioCentavos: number; quedan: number | null }`; `renglonesVenta({ presentaciones, existencias, controlInventario }): RenglonVenta[]` — orden alfabético por etiqueta ("Producto · volumen", sin acentos para ordenar), solo con precio; con control prendido solo `quedan > 0`; con control apagado todas y `quedan: null`.
  - `teclear(actual: string, tecla: '0'|'1'|…|'9'|'borrar', maximo: number | null): string` — sin ceros a la izquierda, `borrar` quita el último dígito, nunca pasa de `maximo` (si una tecla lo excede, se queda en `maximo`), vacío = "".
  - `type OpcionCobranza = 'liquidar' | 'abonar' | 'credito'`; `opcionesCobranza(totalCentavos: number): OpcionCobranza[]` (total 0 → solo `['liquidar']`).
  - `validarCobranzaVenta({ opcion, abonoTexto, totalCentavos, atendio }): { problemas: string[]; contadoCredito: 'contado' | 'credito'; abonoCentavos: number | null }` — liquidar → contado, sin abono; crédito → crédito, sin abono; abonar → crédito con abono `0 < abono < total`; usa `validarAtendio` (Task 3) y `montoACentavos` de `src/estado/gasto.ts`.
  - `textoSaldoPendiente(saldoCentavos: number): string` → `"Saldo pendiente por liquidar $504.00"`.
- Produces en `cobrar.ts`:
  - `notaAlFrente(notas, asignadas, notaIdPedida): NotaPendiente | null` — la pedida si está; si no, `notaParaCobrar(asignadas)` si está entre las notas; si no, la primera por fecha.
  - `type OpcionCobro = 'liquidar' | 'abonar'`; `validarCobro({ opcion, montoTexto, saldoCentavos }): { problemas: string[]; montoCentavos: number | null }` — liquidar = saldo; abonar `0 < monto < saldo`.
  - `textoOtrasNotas(n: number): string` → `"Otras notas pendientes · 1"`.

- [ ] **Step 1: Failing tests** con los valores de las maquetas: `renglonesVenta` (orden "Arándano · 500 ml", "Arándano · 1 L", "Cebada · 500 ml"…; una con `quedan: 0` no sale; control apagado → todas con `quedan: null`); `teclear('', '6', 20) === '6'`, `teclear('6', '5', 20) === '20'`, `teclear('0', '4', null) === '4'`, `teclear('12', 'borrar', null) === '1'`; `opcionesCobranza(0)` → `['liquidar']`; `validarCobranzaVenta` abonar 300.00 de 804.00 → crédito con 30000 y sin problemas, abonar 804.00 → problema, liquidar → contado, atendio vacío → problema "Escribe el nombre de quien atiende."; `textoSaldoPendiente(50400) === 'Saldo pendiente por liquidar $504.00'`; `checklistPromociones`/`alternarTodas` con 3 promociones y 1 descartada (`{ todas: false, palomeadas: 2, total: 3 }`); `pasoAnterior('lista', false) === null`, `pasoAnterior('lista', true) === 'promociones'`, `pasoAnterior('cobranza', x) === 'lista'`; `notaAlFrente` (pedida, asignada, primera); `validarCobro` abonar 400.00 sobre 1,120.00 → 40000, abonar 1,120.00 → problema, liquidar → 112000; `textoOtrasNotas(1)`.
- [ ] **Step 2: Run** `npm test --workspace=apps/tablet -- venta-pasos cobrar`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** suite completa de la tablet, typecheck y lint. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Rediseño pieza 2: reglas de los pasos de venta y del cobro"`

---

### Task 5: Tablet, pantalla de Vender (Promociones → lista → Cobranza)

**Files:**
- Modify (reescribir): `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`
- Create: `apps/tablet/src/ui/teclado-cantidad.tsx` (teclado de números grandes con "Siguiente" y borrar con icono)
- Delete si quedan sin uso: `apps/tablet/src/ui/recuadro-firma.tsx`, `apps/tablet/src/fotos/firma-expo.ts`, y de `src/estado/firma.ts` lo que solo servía a la captura (`puedeGrabarVenta`, `crearGrabadorVenta`, `normalizarNombreFirma` si nadie más los usa) con sus pruebas. **No** borrar `fuenteFirmasVentas` ni `firmaPorSubir` (ventas viejas).

**Interfaces:**
- Consumes: todo lo de Task 4; `ventas.registrar` de Task 3; `calcularRegalos`/`aplicarRegalos`/`problemasDeRegalos` de `promociones-reglas.ts`; `datos.cargas.paraVenta(vendedorId)` (existencias y bloqueo); `datos.notasAsignadas.bloqueoDeVenta(clienteId)`.

Pasos (un solo componente con estado; Atrás del encabezado y del sistema va a `pasoAnterior`, con `beforeRemove`/`BackHandler`):
1. **Promociones** (maqueta 8): solo si `promociones.length > 0`. "Seleccionar todas" con "N de M palomeadas", checklist con la frase, chips de presentación cuando la promoción da un producto con varias (viene elegida `presentacionPorOmision`), botón "Continuar a vender". Palomeada = no está en `descartados`.
2. **Lista** (maquetas 9 y 10): `renglonesVenta`; renglón con cantidad pintado; tocar la cantidad abre `TecladoCantidad` (abajo, fijo); "Siguiente" pasa al renglón de abajo sin cerrar; tope = `quedan` menos lo que ya va de promoción en esa presentación (nunca negativo). Barra fija abajo: "N PIEZAS + M PROMO", total, botón "Ir a cobranza" (apagado sin piezas vendidas ni de promoción). Avisos de bloqueo de carga pendiente y de nota con condición como hoy, arriba de la lista.
3. **Cobranza** (maquetas 11 y 12): la nota (renglones "cantidad × etiqueta", importe; piezas de promoción "(promoción)" en $0.00; total); "Cobranza" con `opcionesCobranza`; con Liquidar el monto es el total y no se edita; con Abonar campo de monto y `textoSaldoPendiente(total − abono)`; con Crédito `textoSaldoPendiente(total)`; "Nombre de quien atiende" (obligatorio); botón **"Grabar"** con guardia de doble toque; errores de `validarCobranzaVenta` y de `ventas.registrar` visibles.
4. **Grabada**: folio y total como hoy; "Volver a la ruta" (`router.dismissTo('/(jornada)')`).

- [ ] **Step 1:** Construir la pantalla y el teclado.
- [ ] **Step 2:** `npm test --workspace=apps/tablet` (incluye `sin-glifos`), typecheck y lint. Expected: PASS.
- [ ] **Step 3: Commit** — `git commit -m "Rediseño pieza 2: vender en tres pasos sin firma"`
- [ ] **Step 4 (controlador, emulador):** Vender con promociones (quitar una, elegir presentación), lista con teclado y tope, Abonar 300 de un total, Crédito, Liquidar; la venta sube y en Postgres local la nota queda `abonado` con su abono; el número de notas de la fila sube con Abonar/Crédito.

---

### Task 6: Tablet, pantalla de Cobrar

**Files:**
- Modify (reescribir): `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx`

**Interfaces:**
- Consumes: `notaAlFrente`, `validarCobro`, `textoOtrasNotas`, `textoSaldoPendiente` (Task 4); `agruparNotasParaCobrar`, `etiquetaCondicionPendiente` de `src/estado/notas-asignadas.ts`; `datos.cobranzas.registrar` (sin cambios).

Pantalla (maqueta 13): la nota al frente con "Nota asignada" si lo es, folio, condición (`etiquetaCondicionPendiente`), fecha, total, abonos anteriores con fecha y "Debe". "Cobranza" con Liquidar / Abonar (Liquidar pone lo que debe y no se edita), `textoSaldoPendiente(debe − monto)` con Abonar, chips Efectivo / Transferencia / Cheque (efectivo por omisión), `fecha_pago` = hoy. Botón "Otras notas pendientes · N" (N = notas del cliente menos la del frente; oculto si 0) que abre la lista agrupada (asignadas / otras) para elegir otra nota al frente. Botón **"Grabar"** con guardia de doble toque; sin paso de revisión. Al grabar, pantalla de hecho con lo aplicado (como hoy) y "Volver a la ruta".

- [ ] **Step 1:** Construir la pantalla.
- [ ] **Step 2:** suite de la tablet, typecheck y lint. Expected: PASS.
- [ ] **Step 3: Commit** — `git commit -m "Rediseño pieza 2: cobrar con la nota al frente, Liquidar y Abonar"`
- [ ] **Step 4 (controlador, emulador):** cobrar una nota asignada con condición `abonar` (Abonar 400 de 1,120) y ver que Vender se enciende; Liquidar otra; "Otras notas pendientes".

---

### Task 7: Cierre de la pieza

- [ ] **Step 1:** Suites completas: tablet, backend (unit + e2e), portal; typecheck/lint/build.
- [ ] **Step 2:** Actualizar `CLAUDE.md` raíz (bloques de T-73 firma: la tablet ya no captura firma; venta con `atendio` y `abono_centavos`), `apps/tablet/README.md`, `docs/contrato-sincronizacion.md` (ya en Task 1) y el spec §9 si la implementación cambió algo.
- [ ] **Step 3:** Bóveda: `20-Arquitectura/App Tablet.md` y `00-Inicio/Estado del proyecto.md` (fila del rediseño: pieza 2 hecha, sin PR). Commit y push a `main` de la bóveda.
- [ ] **Step 4:** `git push` de la rama (respaldo). **No** abrir PR.
