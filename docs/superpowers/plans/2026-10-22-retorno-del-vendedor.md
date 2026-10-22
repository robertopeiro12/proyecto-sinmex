# Retorno del vendedor — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans, tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que el almacenista capture y corrija en el portal las piezas que regresa cada vendedor por día y
presentación, con lo cargado ese día como referencia.

**Arquitectura:** el mismo molde de T-25 (producción por día), ya en `main`: tabla con una fila viva por día y clave,
reglas puras reutilizadas de `modules/produccion/reglas-produccion.ts` (`validarDia`, `planDelDia`, `esFechaReal`),
repositorio/servicio/controlador/DTO en `modules/produccion/`, y una pantalla del portal hermana de
`components/produccion/pantalla-produccion-dia.tsx`. Bloqueo de la fila del vendedor (`for no key update`) como cargas.

**Tecnología:** Postgres (Supabase local), NestJS + Kysely, Jest, Next.js 15 + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-retorno-del-vendedor-design.md`

## Restricciones globales

- Fuente de verdad: spec §2. Piezas **buenas** retornadas por vendedor/día/presentación; merma fuera; no se valida
  retorno ≤ cargado; fecha hoy o anterior (hoy en Tijuana), nunca futura; 0 = sin registro.
- Permiso **`retorno.gestionar`** (ya existe). No se crea permiso. No se asignan permisos a perfiles.
- Migración `supabase/migrations/20261024120000_retorno.sql` (timestamp único; revisar `ls supabase/migrations`).
- Reutilizar, no copiar, las reglas de `reglas-produccion.ts` (si hace falta generalizar un nombre, hacerlo ahí con sus
  pruebas, sin cambiar el comportamiento de producción).
- No tocar `apps/tablet`, ni el flujo de cargas/Recarga de Mario (solo leer cargas aceptadas).
- Backend: `npm test`, `npm run test:e2e`, `lint`, `build` del backend; portal: `npm test`, `tsc --noEmit`, `lint`.

## Puntos a revisar

1. **`cargadas` cuenta solo cargas aceptadas** del vendedor ese día (no pendientes, rechazadas ni dadas de baja). e2e.
2. **Dos guardados del mismo vendedor y día** se serializan (fila del vendedor bloqueada); el día queda como el último. e2e.
3. **Vendedor de otra sucursal** para un usuario atado → 404 sin revelar si existe. e2e.
4. **Cambiar de vendedor o de fecha con cambios** pregunta antes; cancelar no cambia nada. Portal.
5. **Un vendedor sin cargas ese día** igual permite capturar retorno (el almacenista registra lo que cuenta). e2e.

---

### Tarea 1: Migración `retorno` y pgTAP

**Archivos:** Crear `supabase/migrations/20261024120000_retorno.sql`, `supabase/tests/99_retorno_test.sql`; regenerar
`apps/backend/src/database/schema.d.ts`.

- [ ] pgTAP primero (estilo `99_produccion_test.sql`): columnas; `piezas > 0`; FKs a vendedor, sucursal, presentación,
  usuario; índice único parcial `(fecha, vendedor_id, presentacion_id) where deleted_at is null` (dos vivas fallan; viva +
  borrada entran); trigger de `updated_at`.
- [ ] Migración (molde `20261023120000_produccion.sql`), solo local (`npm run supabase -- migration up --local`), pgTAP
  pasa, `db:types`, build del backend compila.
- [ ] **Commit** `Retorno: tabla retorno con una fila viva por día, vendedor y presentación`.

### Tarea 2: `GET` y `PUT /retornos`

**Archivos:** Crear `apps/backend/src/modules/produccion/retornos.repository.ts`, `retornos.service.ts`,
`retornos.controller.ts`, `dto/retorno.dto.ts`; modificar `produccion.module.ts` (solo registrar providers/controlador);
crear `apps/backend/test/retornos.e2e-spec.ts`. Si se generaliza algo de `reglas-produccion.ts`, con sus pruebas.

**Interfaces (camelCase):**
```ts
GET /retornos?fecha=YYYY-MM-DD&vendedor=<uuid> →
{ fecha: string; vendedor: { id: string; nombre: string }; sucursal: { id: string; codigo: string };
  lineas: { presentacionId: string; producto: string; presentacion: string; activa: boolean; piezas: number; cargadas: number }[];
  totalPiezas: number; actualizadoEn: string | null }
PUT /retornos  body { fecha: string; vendedor: string /* uuid */; lineas: { presentacionId: string; piezas: number }[] }
→ misma forma que el GET
```

- [ ] e2e primero (armado como `test/produccion.e2e-spec.ts` y `test/cargas.e2e-spec.ts`; días de prueba deterministas
  que ninguna otra suite use): 403 sin permiso; vendedor de otra sucursal 404 (Punto 3) y vendedor inexistente 404; día
  vacío con todas las presentaciones activas en 0 y `cargadas` correctas (Punto 1: una carga aceptada suma, una pendiente
  / rechazada / borrada no); crear, corregir (`actualizado_por_usuario_id`), 0 da de baja; vendedor sin cargas captura
  (Punto 5); fecha futura 400; dos PUT en paralelo se serializan (Punto 2); DTO: uuid, enteros, `@ArrayMaxSize(500)`.
- [ ] Implementar con `@RequierePermiso('retorno.gestionar')`, alcance por la sucursal del vendedor, `validarDia` antes
  de la transacción, y en la transacción bloquear la fila del vendedor `for no key update`, leer vivas `for update`,
  aplicar `planDelDia`, guardar `sucursal_id` = la del vendedor, responder como el `GET`.
- [ ] unit + e2e (completo) + lint + build limpios.
- [ ] **Commit** `Retorno: GET y PUT del retorno del vendedor con permiso retorno.gestionar`.

### Tarea 3: Pantalla del portal

**Archivos:** Crear `apps/portal/src/lib/retornos.ts`, `apps/portal/src/components/produccion/pantalla-retorno.tsx`
(+ `.test.tsx`), `apps/portal/src/app/(portal)/produccion/retorno/page.tsx`; modificar `components/layout/nav-config.ts`
("Retorno" debajo de "Recarga"). Si conviene, extraer a un archivo común lo compartido con `pantalla-produccion-dia.tsx`
(sin cambiar su comportamiento ni sus pruebas).

- [ ] Pruebas primero: sin permiso / elige sucursal con `EstadoPantalla`; lista de vendedores activos de la sucursal;
  al elegir vendedor carga el día con columnas Producto, Presentación, Cargadas, Piezas retornadas y el total; Guardar
  manda el `PUT` y muestra "Retorno guardado."; fecha máxima hoy y fecha futura tecleada no consulta; cambiar de vendedor
  o fecha con cambios abre `alertdialog` y cancelar no cambia nada (Punto 4); error del servidor en `Aviso`.
- [ ] Implementar con piezas comunes (`Pantalla`, `EncabezadoPantalla` "Retorno" / "Las piezas que regresa cada
  vendedor al final del día.", `Campo` + `Lista`/`Entrada`, tabla común con `FilaTotal`, `Aviso`, `useConfirmar`,
  celdas alineadas al centro). Permiso `puede("retorno.gestionar")`. Debe caber a 1366 px.
- [ ] pruebas del portal, tsc, lint limpios.
- [ ] **Commit** `Retorno: pantalla Retorno en el portal`.

### Tarea 4: Documentación

- [ ] CLAUDE.md: bloque corto "Retorno del vendedor" junto al de T-25 (tabla, permiso, endpoints, pantalla, relación
  con T-24 y con el corte de T-27, migración a subir después del merge).
- [ ] Vault: [[Inventario]] (sección del retorno), [[Estado del proyecto]] (fila nueva) y bitácora del día. Commit del
  vault sin push.
- [ ] **Commit** `Retorno: CLAUDE.md con la captura del retorno`.

### Tarea 5: Navegador (controlador) y cierre

- [ ] Backend 3010 contra la base local; capturar un retorno de un vendedor con carga aceptada y de otro sin carga,
  corregir, poner en 0, cambiar de vendedor con cambios; 1366 px.
- [ ] Tras el merge: migración a `sinmex dev` con el protocolo de push.
