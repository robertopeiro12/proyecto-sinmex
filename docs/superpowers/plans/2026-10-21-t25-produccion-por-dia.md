# T-25 · Producción por día — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans, tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** registrar y corregir la producción diaria por presentación (sabor + tamaño) y sucursal, con su total, desde
el portal.

**Arquitectura:** tabla nueva `produccion` (migración + pgTAP); en el backend, reglas puras + repositorio + servicio +
controlador dentro de `modules/produccion/` (junto a las cargas de T-27, que son la referencia de estilo: Kysely,
`hoyEnTijuana`, alcance de sucursal, `@RequierePermiso`); en el portal, `lib/produccion.ts` y una pantalla nueva con las
piezas comunes de `components/ui/`.

**Tecnología:** Postgres (Supabase local), NestJS + Kysely, Vitest/Jest, Next.js 15 + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-t25-produccion-por-dia-design.md`

## Restricciones globales

- Fuente de verdad: lo que dijo el cliente (spec §2). No inventar reglas: por omisión hoy, días anteriores sí, futuro
  no; por presentación; total del día; corregir un día.
- Permiso **`almacen_general.gestionar`** (ya existe). No se crea permiso nuevo.
- Migración `supabase/migrations/20261023120000_produccion.sql` (timestamp único; revisado contra `main` y ramas).
- Montos no aplican: todo en **piezas enteras > 0**; 0 = sin registro.
- "Hoy" siempre en Tijuana (`hoyEnTijuana`, como cargas y Tesorería).
- Backend: `npm test --workspace=apps/backend`, `npm run test:e2e --workspace=apps/backend` (Postgres local),
  `npm run lint --workspace=apps/backend`, `npm run build --workspace=apps/backend`. Portal: `npm test
  --workspace=apps/portal`, `npx tsc --noEmit -p apps/portal`, `npm run lint --workspace=apps/portal`.
- No se toca `apps/tablet` ni Recarga/Gastos (de Mario).

## Puntos a revisar

1. **Poner en 0 una presentación ya capturada** la da de baja (no deja una fila con 0). e2e en la Tarea 3.
2. **Volver a capturar una presentación que se dio de baja ese día** crea una fila nueva sin chocar con el índice único
   (es parcial). pgTAP en la Tarea 1 y e2e en la Tarea 3.
3. **Fecha futura** (mañana en Tijuana aunque en UTC ya sea mañana) → 400; hoy en Tijuana a las 23:00 → permitido. Unit
   en la Tarea 2.
4. **Presentación desactivada con piezas ese día** sigue apareciendo en el `GET` para no esconder lo capturado. e2e en
   la Tarea 3.
5. **Cambiar de fecha con cambios sin guardar** pregunta antes de descartar. Prueba en la Tarea 4.

---

### Tarea 1: Migración `produccion` y pgTAP

**Archivos:** Crear `supabase/migrations/20261023120000_produccion.sql`, `supabase/tests/99_produccion_test.sql`;
regenerar `apps/backend/src/database/schema.d.ts` (`npm run db:types --workspace=apps/backend`).

- [ ] **Paso 1:** pgTAP `99_produccion_test.sql` (copiar el estilo de `99_carga_test.sql`): la tabla existe con sus
  columnas; `piezas > 0` (insertar 0 falla); FK a sucursal, presentación y usuario; índice único parcial
  `(fecha, sucursal_id, presentacion_id) where deleted_at is null` (dos vivas fallan; una viva + una borrada entran);
  `updated_at` se mueve con el trigger de la casa.
- [ ] **Paso 2:** correr pgTAP (`npm run supabase -- test db`) → FALLA.
- [ ] **Paso 3:** migración: tabla `produccion` (`id uuid pk default gen_random_uuid()`, `fecha date not null`,
  `sucursal_id`, `presentacion_id`, `piezas integer not null check (piezas > 0)`, `capturo_usuario_id not null`,
  `actualizado_por_usuario_id null`, `created_at`, `updated_at`, `deleted_at`), índice único parcial, índice por
  `(sucursal_id, fecha)`, trigger de `updated_at` igual que otras tablas. Comentario de cabecera con el pre-flight
  (tabla nueva, nada que contar).
- [ ] **Paso 4:** `npm run supabase -- migration up --local`, pgTAP pasa, `db:types` regenera `schema.d.ts`.
- [ ] **Paso 5: Commit** `T-25: tabla produccion con una fila viva por día, sucursal y presentación`.

### Tarea 2: Reglas puras

**Archivos:** Crear `apps/backend/src/modules/produccion/reglas-produccion.ts` y `reglas-produccion.spec.ts`.

**Interfaces:**
```ts
export interface LineaPedida { presentacionId: string; piezas: number }
export interface FilaViva { id: string; presentacionId: string; piezas: number }
export function validarDia(entrada: { fecha: string; lineas: LineaPedida[] }, hoyTijuana: string): string[] // mensajes; [] = válido
export function planDelDia(vivas: FilaViva[], pedidas: LineaPedida[]): {
  crear: LineaPedida[]; actualizar: { id: string; piezas: number }[]; borrar: string[] }
```

- [ ] **Paso 1: Pruebas** (Punto a revisar 3 y 1): fecha mal formada; fecha futura rechazada y hoy aceptado; piezas
  negativas, decimales o no numéricas rechazadas; presentación repetida rechazada; `planDelDia`: nueva con piezas → crear;
  existente con piezas distintas → actualizar; igual → nada; existente en 0 o ausente → borrar; 0 sin fila → nada.
- [ ] **Paso 2:** correr → FALLA.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** pasa; lint y build limpios.
- [ ] **Paso 5: Commit** `T-25: reglas puras para validar y reemplazar la producción de un día`.

### Tarea 3: Endpoints `GET` y `PUT /produccion`

**Archivos:** Crear `apps/backend/src/modules/produccion/produccion.repository.ts`, `produccion.service.ts`,
`produccion.controller.ts`; modificar `produccion.module.ts`; crear `apps/backend/test/produccion.e2e-spec.ts`.

**Interfaces (respuesta del `GET` y del `PUT`, camelCase):**
```ts
{ fecha: string; sucursal: { id: string; codigo: string };
  lineas: { presentacionId: string; producto: string; presentacion: string; activa: boolean; piezas: number }[];
  totalPiezas: number; actualizadoEn: string | null }
```
`PUT` body: `{ fecha: string; sucursal: string /* código */; lineas: { presentacionId: string; piezas: number }[] }`.

- [ ] **Paso 1: e2e** (copiar el armado de `test/cargas.e2e-spec.ts`): sin permiso 403; otra sucursal (usuario atado)
  404; `GET` de un día vacío trae todas las presentaciones activas en 0 y total 0; `PUT` crea y el `GET` lo refleja con
  total; corregir actualiza y guarda `actualizado_por_usuario_id`; poner en 0 da de baja (Punto 1); volver a capturar la
  misma presentación ese día entra (Punto 2); presentación desactivada con piezas sigue en el `GET` con `activa: false`
  (Punto 4); fecha futura 400 con el mensaje de las reglas.
- [ ] **Paso 2:** correr → FALLA.
- [ ] **Paso 3:** implementar con `@RequierePermiso('almacen_general.gestionar')`, el alcance de sucursal de las
  cargas, `validarDia` antes de la transacción, y en la transacción leer las vivas del día `for update`, aplicar
  `planDelDia` y responder como el `GET`. Orden de líneas: producto y presentación como en el catálogo.
- [ ] **Paso 4:** e2e y unit pasan; lint y build limpios.
- [ ] **Paso 5: Commit** `T-25: GET y PUT de la producción del día con permiso de Almacén General`.

### Tarea 4: Pantalla del portal

**Archivos:** Crear `apps/portal/src/lib/produccion.ts`, `apps/portal/src/components/produccion/pantalla-produccion-dia.tsx`
(+ `.test.tsx`), `apps/portal/src/app/(portal)/produccion/produccion-del-dia/page.tsx`; modificar
`components/layout/nav-config.ts` (entrada "Producción del día" arriba de "Recarga").

- [ ] **Paso 1: Pruebas:** sin permiso → `EstadoPantalla` sin permiso; con "Todas las sucursales" → elige sucursal;
  carga el día de hoy con una fila por presentación y el total; escribir piezas actualiza el total; Guardar manda el
  `PUT` con todas las líneas y muestra "Producción guardada."; el campo de fecha no permite mañana (`max` = hoy en
  Tijuana); cambiar de fecha con cambios sin guardar abre `alertdialog` "¿Descartar los cambios?" y cancelar no cambia
  la fecha (Punto 5); error del servidor sale en `Aviso` de error con su mensaje.
- [ ] **Paso 2:** correr → FALLA.
- [ ] **Paso 3:** implementar con `Pantalla`, `EncabezadoPantalla` ("Producción del día" / "Las piezas que se hicieron
  cada día, por sabor y tamaño."), `Campo` + `Entrada type="date"`, `CajaTabla`/`Tabla`/`FilaTotal`, `Button`, `Aviso`,
  `useConfirmar`. Permiso con `puede("almacen_general.gestionar")`. Sucursal de `?sucursal=` como las demás pantallas.
- [ ] **Paso 4:** pruebas del portal (incluida la de `nav-config`), tsc y lint limpios.
- [ ] **Paso 5: Commit** `T-25: pantalla Producción del día en el portal`.

### Tarea 5: Documentación

- [ ] CLAUDE.md: bloque corto "Producción por día (T-25)" (tabla, una viva por día/sucursal/presentación, permiso
  `almacen_general.gestionar`, endpoints, pantalla, migración a subir después del merge).
- [ ] Vault: [[Producción]] (implementado en T-25, por sabor y tamaño, sin T-24 todavía), [[Estado del proyecto]] (fila
  T-25) y bitácora del día. Commit del vault **sin push**.
- [ ] **Commit** `T-25: CLAUDE.md con la producción por día`.

### Tarea 6: Revisión en navegador (controlador) y cierre

- [ ] Backend 3010 contra la base local, portal limpio, usuarios `revision` y `revision-tj`: capturar hoy, corregir,
  poner en 0, día anterior, intento de mañana, cambiar de fecha con cambios; 1366 px sin scroll lateral.
- [ ] Tras el merge: subir la migración a `sinmex dev` con el protocolo de push (pre-flight: tabla nueva).
