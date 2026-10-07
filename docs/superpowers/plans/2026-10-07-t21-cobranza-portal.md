# T-21 · Cobranza / Abono desde el Portal — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: usa superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que la oficina registre desde el Portal el pago de una o varias notas de un cliente (y aplique
su saldo a favor), con la misma regla de reparto que la tablet, y que la cobranza deje de llevar folio en el
servidor, el contrato y la app.

**Arquitectura:** primero se quita el folio de la cobranza en el servidor y el contrato (la tablet sin
actualizar sigue entrando: su folio se ignora); después una migración agrega `capturo_usuario_id`, el método
y origen `saldo_favor`, el movimiento `aplicacion`, y borra las columnas `folio`. La app de tablet deja de
emitir folio al cobrar (migración local 010). En el servidor, `repartirPagoEnNotas` generaliza a
`repartirPago`; `CobranzasService` gana `planearPago`/`registrarPago`/`planearSaldoFavor`/`aplicarSaldoFavor`,
todas decidiendo sobre las notas **bloqueadas**; un servicio y un controller nuevos (`/cobranzas`) los
exponen al portal, que gana la pantalla *Operación → Cobranza*.

**Stack:** NestJS + Kysely (backend), Postgres/Supabase + pgTAP (base), Expo/React Native + SQLite + Jest
(tablet, solo TypeScript), Next.js + Vitest + Testing Library (portal).

**Spec:** `docs/superpowers/specs/2026-10-07-t21-cobranza-portal-design.md` — léelo antes de empezar. Manda
el spec; si este plan lo contradice, para y pregunta.

## Restricciones globales

- Rama `feature/t-21-cobranza-portal`. Comandos **desde la raíz del repo**, con los scripts del workspace
  (`CLAUDE.md`). Pruebas con el stack local de Supabase arriba (`docker context ls`; en la Mac de Roberto,
  `colima start` y luego `npm run supabase start`). **Nunca** apuntes nada a `sinmex dev` (la nube): ni
  migraciones, ni pruebas, ni la prueba a mano.
- **No hagas `git push`, ni `gh pr`, ni `gh issue comment`.** La Tarea 9 deja los textos para quien coordina.
- Migración de Postgres (una sola): `supabase/migrations/20261007160000_cobranza_portal.sql`. Aplicar con
  `npm run supabase -- migration up --local` (con el `--`) y regenerar tipos con
  `npm run db:types --workspace=apps/backend`.
- Migración local de la tablet: `apps/tablet/src/datos/migraciones/010-cobranza-sin-folio.ts`, versión `10`,
  nombre `cobranza-sin-folio`.
- **La cobranza no lleva folio, en ningún lado** (cliente, 2026-10-07: *"Un solo folio"*, *"Porque la
  cobranza no lleva folio"*). Una operación `cobranza` que llegue **con** folio (tablet sin actualizar) se
  registra y el folio **se ignora sin validarlo**: no se guarda en `cobranza_abono`, ni en
  `saldo_favor_movimiento`, ni en `sync_operacion.folio`. **No se sube `CONTRATO_ACTUAL`.**
- Permiso: **`cobranza.registrar`** (ya existe desde T-05: no se crea ninguno y el conteo de 27 claves de
  `93_permiso_sucursal_test.sql` no cambia). Todos los endpoints de `/cobranzas` lo exigen, lectura incluida.
  La cuenta perdida reusa `POST /ventas/:id/cuenta-perdida` y su permiso `venta.editar_eliminar`.
- Endpoints (todos `@RequierePermiso('cobranza.registrar')`):

  | Método y ruta | Cuerpo / query | Respuesta |
  |---|---|---|
  | `GET /cobranzas/por-cobrar` | **exactamente uno** de `clienteId` (uuid), `fecha` (`AAAA-MM-DD`) o `numNota`; `sucursal?` | con `clienteId`: `ClientePorCobrar`; con `fecha`/`numNota`: `NotaPorCobrar[]` |
  | `POST /cobranzas/vista-previa` | `{ clienteId, notaIds, montoCentavos, modo: 'pago' \| 'saldo_favor' }` | `200` `PlanDeCobro` (no escribe) |
  | `POST /cobranzas` | `{ clienteId, notaIds, montoCentavos, fechaPago, metodoPago, vendedorId: uuid \| null }` | `201` `CobroRegistrado` |
  | `POST /cobranzas/saldo-favor` | `{ clienteId, notaIds, montoCentavos }` | `201` `CobroRegistrado` |

- `notaIds`: 1 a 200 uuids; repetidos cuentan una vez. `montoCentavos`: **entero** de 1 a 999_999_999_999
  (un número con decimales o un texto es 400). `metodoPago`: `transferencia` (default en la pantalla),
  `efectivo` o `cheque`. `vendedorId`: `null` = **Oficina** (default en la pantalla) o un vendedor **activo**
  de la sucursal **del cliente**.
- Reparto (una sola regla, `repartirPagoEnNotas`): primero las **palomeadas** de la más vieja a la más nueva
  (`fecha`, luego `folio`), después las **demás** notas cobrables del cliente en el mismo orden, y lo que
  sobre a **saldo a favor**. `repartirPago(monto, nota, notas)` (servidor **y** tablet) no cambia de
  comportamiento y sus pruebas actuales no se tocan.
- Aplicar saldo a favor: solo a las palomeadas, **sin** excedente; `metodo_pago = origen = 'saldo_favor'`,
  `vendedor_id` null, `fecha_pago = fecha_operacion = hoy en Tijuana`, y un movimiento **negativo** en
  `saldo_favor_movimiento` con `origen = 'aplicacion'`.
- Un cobro del portal lleva `fecha_operacion = hoyEnTijuana()` y `capturo_usuario_id` = quien lo capturó.
  Las decisiones (¿la nota sigue cobrable?, ¿cuánto saldo a favor hay?) se toman **sobre las filas
  bloqueadas `for update`**, nunca sobre una lectura previa (la lección de T-19).
- Notas por cobrar: `status in ('pendiente','abonado')` y `deleted_at is null`, de la más vieja a la más
  nueva. El alcance de sucursal es el **del cliente**, como en el cobro de la tablet.
- Dinero: centavos enteros en todo el cable; en el servidor `aPesos`/`aCentavos`; en el portal
  `leerMontoCentavos` (texto → centavos sin punto flotante). Nunca `parseFloat(x) * 100`.
- Mensajes exactos del **servidor** (los usan las pruebas y la pantalla):
  - `La nota ${folio} ya no tiene saldo; vuelve a cargar.`
  - `Una de las notas marcadas no es de este cliente o ya no existe; vuelve a cargar.`
  - `La fecha del pago no puede ser anterior a la nota más vieja que marcaste (${fecha}).`
  - `La fecha del pago no puede ser futura.`
  - `Esa fecha no existe.`
  - `El monto debe ser mayor a $0 y tener a lo más 2 decimales.`
  - `El monto es demasiado grande.`
  - `El método de pago debe ser transferencia, efectivo o cheque.`
  - `Elige quién cobró: Oficina o un repartidor.`
  - `El cobrador no es un repartidor activo de la sucursal del cliente.`
  - `El cliente solo tiene ${pesos} de saldo a favor.` (p. ej. `El cliente solo tiene $150.00 de saldo a favor.`)
  - `Las notas marcadas solo deben ${pesos}: no se puede aplicar más saldo a favor que eso.`
  - `Marca al menos una nota.`
  - `Busca por cliente, fecha o # de nota (uno solo).`
  - `No existe ese cliente.`
  - `Otro usuario estaba modificando las notas de este cliente al mismo tiempo; vuelve a intentar.`
  - Códigos: `fecha-anterior` → **400**; `nota-ajena`, `nota-sin-saldo`, `saldo-favor-insuficiente`,
    `excede-lo-que-deben` y `40P01`/`40001` → **409**. Nunca 500.
- Mensajes exactos del **portal**:
  - Sin permiso: `No tienes permiso para registrar cobranza`
  - Éxito del pago: `Cobro registrado: ${formatearPesos(monto)} a ${cliente}` (p. ej.
    `Cobro registrado: $1,500.00 a Cobach XXI`)
  - Éxito del saldo a favor: `Saldo a favor aplicado: ${formatearPesos(monto)} a ${cliente}`
  - Monto de saldo a favor por encima del disponible: `No puede ser mayor al saldo a favor (${pesos}).`
  - Vista previa por nota: `${folio} pagada` o `${folio} abono ${pesos}, debe ${pesos}`; `${folio} sin pago`
    si a una palomeada no le alcanzó; `A saldo a favor: ${pesos}`.
  - `Este cliente no tiene notas por cobrar.` · `No hay notas por cobrar con esa búsqueda.`
- Mensajes exactos de la **tablet**: título final `Cobro grabado`, subtítulo `${cliente} · así quedaron sus
  notas.`; error genérico `No se pudo grabar el cobro. No se guardó nada; intenta de nuevo.`; vendedor
  ausente `Este vendedor no está en la tablet. Sincroniza antes de cobrar.`; `NOMBRE_METODO.saldo_favor =
  'Saldo a favor'`.
- **Tablet: solo TypeScript, nada de código nativo** (en el repo no hay Kotlin/Java) y solo lo de §4.6 del
  spec. `apps/tablet/src/datos/cobranzas-reglas.ts` solo cambia su comentario de cabecera.
- Comentarios y nombres en español, sin acentos en identificadores, con la densidad de comentarios del
  código vecino. Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Puntos de revisión (Review Focus)

1. **Una nota palomeada que la tablet (u otro usuario) pagó mientras la pantalla estaba abierta**: el cobro
   del portal debe esperar el candado, ver la nota ya pagada y responder 409
   `La nota ${folio} ya no tiene saldo; vuelve a cargar.` sin grabar nada (ni en las otras palomeadas).
   → pruebas en la Tarea 4 (unitaria) y en la Tarea 5 (e2e con la transacción en vuelo).
2. **Fecha del pago anterior a la nota palomeada más vieja, o futura**: 400 con el mensaje; la pantalla lo
   avisa antes de pedir la vista previa. → pruebas en las Tareas 4, 5 y 8.
3. **Aplicar más saldo a favor del que hay, o más de lo que deben las palomeadas** (incluido otro usuario
   gastándolo al mismo tiempo, que se serializa por el candado): 409 y nada grabado; la pantalla no deja
   pasar un monto mayor al saldo. → pruebas en las Tareas 4, 5 y 8.
4. **Montos tecleados raros**: `1,500.50`, `$200`, `10.5` se entienden; `10.005`, `1,50`, `0` no; en el
   cable, `150050.5` o `"15000"` son 400. Nunca un centavo de más por punto flotante. → pruebas en las
   Tareas 5, 6 y 8.
5. **Una tablet sin actualizar que sigue mandando folio en la cobranza** (bien formado o no): el cobro entra,
   el folio no queda en `sync_operacion` y ese número sigue libre para una venta. → pruebas en la Tarea 1.

## Mapa de archivos

| Archivo | Tarea | Responsabilidad |
|---|---|---|
| `apps/backend/src/modules/sincronizacion/operaciones.ts` | 1 | Ignorar el folio de una `cobranza` |
| `apps/backend/src/modules/sincronizacion/despacho-cobranza.ts` | 1 | Ya no exige folio |
| `apps/backend/src/modules/sincronizacion/contrato.ts` + `apps/tablet/src/sincronizacion/contrato.ts` + `docs/contrato-sincronizacion.md` | 1 | Contrato sin folio en cobranza; `MetodoPagoAbono` |
| `supabase/migrations/20261007160000_cobranza_portal.sql` + `supabase/tests/99_cobranza_portal_test.sql` | 2 | Esquema de T-21 |
| `apps/tablet/src/datos/migraciones/010-cobranza-sin-folio.ts`, `repositorios/cobranzas.ts`, `cobranzas-textos.ts` | 3 | La app cobra sin folio |
| `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts` | 4 | `repartirPagoEnNotas` |
| `apps/backend/src/modules/ventas-cobranza/pago-rechazado.ts` | 4 | Rechazos del pago del portal y sus mensajes |
| `apps/backend/src/modules/ventas-cobranza/cobranzas.{service,repository}.ts` | 4 | Una regla para tablet y portal |
| `apps/backend/src/modules/ventas-cobranza/cobranzas-portal.{repository,service}.ts`, `cobranzas.controller.ts`, `dto/cobranzas.dto.ts` | 5 | Endpoints `/cobranzas` |
| `apps/portal/src/lib/cobranzas.ts` | 6 | Tipos, llamadas y `leerMontoCentavos` |
| `apps/portal/src/components/cobranza/*` + `app/(portal)/operacion/cobranza/page.tsx` | 7, 8 | Pantalla *Operación → Cobranza* |

---

### Tarea 1: El servidor deja de pedir y de guardar el folio de la cobranza

Va **antes** que la migración a propósito: si se borrara primero la columna `folio`, el código que todavía
la escribe dejaría de compilar y las e2e de T-20 tronarían. Aquí el código deja de usarla; la Tarea 2 la borra.
El contrato de la tablet se toca **en este mismo commit** (solo tipos y comentarios), como manda `CLAUDE.md`.
Ningún lector devuelve hoy el folio de un cobro (el detalle de venta usa `CobroDeVenta`, sin folio, y
`AbonoPull` no lo lleva): no hay lectura que cambiar, solo escrituras.

**Archivos:**
- Modificar: `apps/backend/src/modules/sincronizacion/operaciones.ts` (`OperacionNormalizada.folio`, `normalizarOperacion`)
- Modificar: `apps/backend/src/modules/sincronizacion/operaciones.spec.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/despacho-cobranza.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/despacho-cobranza.spec.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (`proyectar`, caso `cobranza`)
- Modificar: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` (`notasPendientes`)
- Modificar: `apps/backend/src/modules/sincronizacion/contrato.ts`
- Modificar: `apps/tablet/src/sincronizacion/contrato.ts`
- Modificar: `docs/contrato-sincronizacion.md`
- Modificar: `apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts` (`ContextoCobranza`, `registrarCobranza`)
- Modificar: `apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts` (`NuevoAbono`, `NuevoSaldoFavor`, inserts)
- Modificar: `apps/backend/src/modules/ventas-cobranza/cobranzas.service.spec.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas.service.ts` y `ventas-edicion.service.ts` (cobro de contado)
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas.service.spec.ts`
- Modificar: `apps/backend/test/sincronizacion.e2e-spec.ts`, `apps/backend/test/ventas.e2e-spec.ts`,
  `apps/backend/test/ventas-editar.e2e-spec.ts`

**Interfaces:**
- Consume: nada nuevo.
- Produce:
  - `ContextoCobranza = { sucursalId: string; fechaOperacion: string; vendedorId: string; usuarioId: string | null }` (sin `folio`; la Tarea 4 relaja `vendedorId` a `string | null`).
  - `NuevoAbono` y `NuevoSaldoFavor` **sin** `folio`.
  - En los dos `contrato.ts`: `export type MetodoPagoAbono = MetodoPago | 'saldo_favor'` y
    `AbonoPull.metodo_pago: MetodoPagoAbono`.
  - Una `OperacionNormalizada` de `tipo: 'cobranza'` siempre trae `folio: null`.

- [ ] **Paso 1: Pruebas unitarias que fallan**

En `apps/backend/src/modules/sincronizacion/operaciones.spec.ts`, dentro de `describe('normalizarOperacion', …)`,
agrega al final:

```ts
  describe('folio de la cobranza (T-21)', () => {
    it('una cobranza con folio (tablet sin actualizar) entra y el folio se ignora', () => {
      const r = normalizarOperacion(
        valida({ tipo: 'cobranza', folio: 'TJ260807AP04' }),
        VENDEDOR,
        HOY,
        CTX,
      );
      expect(r.ok).toBe(true);
      if (r.ok !== true) return;
      expect(r.operacion.folio).toBeNull();
    });

    it('ni siquiera se valida: un folio mal formado no rechaza la cobranza', () => {
      const r = normalizarOperacion(
        valida({ tipo: 'cobranza', folio: 'NO-ES-UN-FOLIO' }),
        VENDEDOR,
        HOY,
        CTX,
      );
      expect(r.ok).toBe(true);
      if (r.ok !== true) return;
      expect(r.operacion.folio).toBeNull();
    });

    it('a una venta se le sigue revisando el folio', () => {
      const r = normalizarOperacion(
        valida({ tipo: 'venta', folio: 'NO-ES-UN-FOLIO' }),
        VENDEDOR,
        HOY,
        CTX,
      );
      expect(r).toMatchObject({ ok: false, codigo: 'folio-invalido' });
    });
  });
```

En `apps/backend/src/modules/sincronizacion/despacho-cobranza.spec.ts`:
- en la fábrica `op`, cambia `folio: 'TJ260914AP04',` por `folio: null,` (la tablet nueva ya no lo manda);
- en el `it.each`, **borra** la fila `['una cobranza sin folio', { folio: null }, 'folio: '],`;
- agrega, después del primer `it`:

```ts
  it('una cobranza sin folio se prepara: la cobranza no lleva folio (T-21)', () => {
    expect(prepararCobranza(op({ folio: null }))).toMatchObject({ ok: true });
  });
```

- [ ] **Paso 2: Correr y ver que fallan**

Run: `npm test --workspace=apps/backend -- operaciones despacho-cobranza`
Expected: FAIL — `operaciones.spec.ts` devuelve el folio en vez de `null` y rechaza `NO-ES-UN-FOLIO`;
`despacho-cobranza.spec.ts` rechaza la cobranza sin folio con `datos-invalidos`.

- [ ] **Paso 3: Ignorar el folio de la cobranza**

En `apps/backend/src/modules/sincronizacion/operaciones.ts`, reemplaza el comentario de
`OperacionNormalizada.folio` por:

```ts
  /**
   * El [[Folios|folio]] que la tablet emitio **offline** para esta operacion,
   * o `null` si su tipo no lleva folio.
   *
   * Hoy solo la `venta` lo lleva (T-16). La `jornada` no es una nota que nadie
   * firme, y la `cobranza` **no lleva folio** (T-21, cliente 2026-10-07): el que
   * mande una tablet sin actualizar se descarta aqui y llega como `null`.
   */
  folio: string | null;
```

y, en `normalizarOperacion`, cambia el bloque del folio (el que empieza con
`// El folio es OPCIONAL: hoy la \`jornada\` no lo lleva`) por:

```ts
  // El folio es OPCIONAL: la `jornada` no lo lleva (no es una nota que nadie
  // firme). Cuando viene, se comprueba a fondo — un folio emitido no se corrige
  // hacia atras.
  //
  // T-21: la cobranza NO lleva folio (cliente, 2026-10-07: "Un solo folio",
  // "Porque la cobranza no lleva folio"). Una tablet sin actualizar todavia lo
  // manda: se IGNORA sin validarlo, para no perder un cobro real por un dato
  // que ya no significa nada, y no se guarda en ningun lado (en
  // `sync_operacion.folio` ocuparia un numero de la serie de ventas).
  const folio = tipo === 'cobranza' ? null : texto(op.folio);
  if (folio !== null) {
```

(el resto del `if`, con `revisarFolio`, queda igual).

En `apps/backend/src/modules/sincronizacion/despacho-cobranza.ts`, `prepararCobranza` queda así:

```ts
export function prepararCobranza(
  op: OperacionNormalizada,
): PreparacionCobranza {
  // T-21: sin comprobacion de folio. La cobranza no lleva folio, y el que
  // mande una tablet sin actualizar ya lo descarto `normalizarOperacion`.
  const r = normalizarDatosCobranza(op.clienteId, op.fechaOperacion, op.datos);
  if (!r.ok) {
    return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
  }
  return { ok: true, cobranza: r.cobranza };
}
```

- [ ] **Paso 4: Correr y ver que pasan**

Run: `npm test --workspace=apps/backend -- operaciones despacho`
Expected: PASS (incluido `despacho.spec.ts`, cuya prueba de cobranza trae folio y sigue preparándose).

- [ ] **Paso 5: El dominio deja de escribir el folio**

`apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts`: reemplaza el comentario y la interfaz
`ContextoCobranza` por:

```ts
/**
 * Quien y cuando (D13). Desde la tablet `usuarioId` es null; el portal (T-21)
 * lo llena. **Sin folio**: la cobranza no lleva folio (cliente, 2026-10-07);
 * solo las ventas se numeran.
 *
 * Era un alias de `ContextoVenta` hasta T-17, que le agrego a la venta `origen`
 * y `metodoPagoContado` y le quito el null al folio. La cobranza no usa nada de
 * eso.
 */
export interface ContextoCobranza {
  sucursalId: string;
  fechaOperacion: string;
  vendedorId: string;
  usuarioId: string | null;
}
```

y en `registrarCobranza` borra las dos líneas `folio: contexto.folio,` (la de `insertarAbono` y la de
`insertarSaldoFavor`).

`apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts`: borra `folio: string | null;` de
`NuevoAbono` y de `NuevoSaldoFavor`, y las líneas `folio: abono.folio,` (en `insertarAbono`) y
`folio: movimiento.folio,` (en `insertarSaldoFavor`).

`apps/backend/src/modules/ventas-cobranza/ventas.service.ts`: en el `insertarAbono` del cobro de contado,
borra `folio: contexto.folio,`. `apps/backend/src/modules/ventas-cobranza/ventas-edicion.service.ts`: en el
`insertarAbono` de `editar`, borra `folio: venta.folio,`. (El folio de la venta sigue en `venta_nota.folio`;
el cobro de contado lo alcanza por `venta_nota_id`.)

`apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`, en `proyectar`, el caso `cobranza`
queda:

```ts
      case 'cobranza':
        // Devuelve la primera fila de cobranza_abono, o el movimiento de saldo
        // a favor si todo el pago quedo a favor. Sin folio (T-21).
        return this.cobranzas.registrarCobranza(
          proyeccion.cobranza,
          {
            sucursalId: vendedor.sucursal_id,
            fechaOperacion: op.fechaOperacion,
            vendedorId: vendedor.id,
            usuarioId: null,
          },
          trx,
        );
```

- [ ] **Paso 6: Ajustar las unitarias del dominio**

`cobranzas.service.spec.ts`:
- en `const contexto: ContextoCobranza = {…}` borra `folio: 'TJ260914AP04',`;
- borra **todas** las líneas `folio: 'TJ260914AP04',` de las expectativas (en el primer `it` y en el de
  excedente: tres `toHaveBeenNthCalledWith` y el `insertarSaldoFavor`);
- renombra `'el excedente va a las otras notas por fecha y el resto a saldo a favor, con el mismo folio'` a
  `'el excedente va a las otras notas por fecha y el resto a saldo a favor'`.

`ventas.service.spec.ts`: en la expectativa de `cobranzas.insertarAbono` de
`'contado con monto deja su cobro venta_contado por el total (T-20, D2)'` borra `folio: 'TJ260914AP03',`, y en
la del `describe` de Oficina (`expect.objectContaining({ vendedorId: null, metodoPago: 'transferencia', … })`)
borra `folio: 'TJ260914OF01',`. **No** toques los `folio` de las expectativas de `insertarVenta`.

Run: `npm test --workspace=apps/backend && npm run build --workspace=apps/backend`
Expected: PASS y compila.

- [ ] **Paso 7: El contrato, en los dos lados y en `docs/`**

`apps/backend/src/modules/sincronizacion/contrato.ts`:

Después de `export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';` agrega:

```ts
/**
 * Metodo de un abono que BAJA en el pull (T-21): el de los cobros mas
 * `saldo_favor`, que es la oficina aplicando saldo a favor (no entro dinero).
 * La tablet nunca lo manda en un push: `DatosCobranza.metodo_pago` sigue siendo
 * {@link MetodoPago}. Aditivo: una tablet vieja guarda los abonos como JSON sin
 * validar el metodo y lo muestra tal cual.
 */
export type MetodoPagoAbono = MetodoPago | 'saldo_favor';
```

Reemplaza el comentario de `DatosCobranza` por:

```ts
/**
 * `datos` de una operacion `tipo: "cobranza"` (T-20).
 *
 * Un pago del cliente sobre UNA nota que eligio el vendedor. `cliente_id`
 * viaja en el **sobre** y es obligatorio. **No lleva folio** (T-21, cliente
 * 2026-10-07: "la cobranza no lleva folio"): si llega uno —una tablet sin
 * actualizar— se ignora sin validarlo y no se guarda. No subio la version:
 * ver `docs/contrato-sincronizacion.md` §6.
 *
 * El servidor reparte el monto: primero la nota elegida hasta su saldo,
 * despues las otras notas pendientes del cliente de la mas vieja a la mas
 * nueva, y lo que sobre queda como saldo a favor. Un monto mayor al saldo se
 * acepta.
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
```

y en `AbonoPull` cambia `metodo_pago: MetodoPago;` por `metodo_pago: MetodoPagoAbono;`.

`apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts`: en el `import type { … } from
'./contrato'` cambia `MetodoPago,` por `MetodoPagoAbono,`, y en `notasPendientes` cambia
`metodo_pago: a.metodo_pago as MetodoPago,` por `metodo_pago: a.metodo_pago as MetodoPagoAbono,`.

`apps/tablet/src/sincronizacion/contrato.ts`:

Después de `export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';` agrega:

```ts
/**
 * Metodo de un abono que baja en el pull (T-21): los de cobro mas `saldo_favor`
 * (la oficina aplico saldo a favor). La tablet nunca lo manda en un push.
 */
export type MetodoPagoAbono = MetodoPago | 'saldo_favor';
```

En `AbonoPull` cambia `metodo_pago: MetodoPago;` por `metodo_pago: MetodoPagoAbono;`. Reemplaza el comentario
de `DatosCobranza` por:

```ts
/**
 * `datos` de una operacion `tipo: "cobranza"` (T-20).
 *
 * Un pago sobre UNA nota; el servidor reparte el excedente a las otras notas
 * del cliente y al saldo a favor. `cliente_id` va en el sobre y es
 * obligatorio. **Sin folio** (T-21): la cobranza no lleva folio.
 */
```

y en `OperacionSaliente.folio` reemplaza el párrafo `Hoy la \`jornada\` no lo lleva … (T-16/T-20).` por:

```ts
   * Hoy solo la venta lo lleva, y en ella es obligatorio (T-16). La `jornada`
   * no es una nota que nadie firme, y la cobranza no lleva folio (T-21): el
   * servidor ignora el que llegue.
```

`docs/contrato-sincronizacion.md`:

1. En el `> [!warning] Es un cambio de significado y aun así NO subió la versión` del §5, cambia la última
   frase `y el \`num_nota\` nulo (2026-10-06, abajo): tampoco subieron la versión.` por
   `el \`num_nota\` nulo (2026-10-06, abajo) y la cobranza sin folio (T-21, §6): tampoco subieron la versión.`
2. En "Notas pendientes: saldo derivado, abonos y notas cerradas (T-20)", después del bullet de `abonos`, agrega:

```markdown
- Desde T-21, un abono puede venir con `metodo_pago: "saldo_favor"`: la oficina aplicó saldo a favor a
  esa nota (no entró dinero). Una tablet vieja lo guarda como texto y lo muestra tal cual.
```

3. Reemplaza la sección completa `### \`datos\` de una cobranza (T-20)` (desde su título hasta el bullet
   `- Cada cobranza se aplica en **su propia transacción** junto con su fila del buzón (§7).`, inclusive) por:

````markdown
### `datos` de una cobranza (T-20; sin folio desde T-21)

```jsonc
{
  "clave": "uuid del cobro local",
  "tipo": "cobranza",
  "fecha_operacion": "2026-09-14",
  "ocurrido_en": "2026-09-14T12:10:00.000-07:00",
  "cliente_id": "uuid",              // obligatorio en cobranza
  // SIN "folio": la cobranza no lleva folio (T-21). Si llega, se ignora.
  "datos": {
    "venta_nota_id": "uuid",         // la nota que eligió el vendedor (id del pull)
    "monto_centavos": 15000,         // entero, 1..999999999999; puede pasar del saldo
    "metodo_pago": "efectivo",       // efectivo | transferencia | cheque
    "fecha_pago": "2026-09-12"       // AAAA-MM-DD, no posterior a fecha_operacion
  }
}
```

- `cliente_id` viaja **en el sobre** y es **obligatorio**: sin él → `datos-invalidos`.
- **La cobranza no lleva folio** (respuesta del cliente, 2026-10-07: *"Un solo folio"*, *"Porque la
  cobranza no lleva folio"*; solo las ventas se numeran). Si una operación `cobranza` llega **con** `folio`
  —una tablet sin actualizar—, el servidor **lo ignora sin validarlo** y registra el cobro: no se rechaza
  para no perder dinero cobrado, y el folio no se guarda en ningún lado (ni en `cobranza_abono`, ni en
  `saldo_favor_movimiento`, ni en `sync_operacion.folio`, donde ocuparía un número de la serie de ventas).
- **El servidor reparte el pago**, en este orden: la nota elegida hasta su saldo; si sobra, las
  **otras notas pendientes/abonadas del mismo cliente, de la más vieja a la más nueva** (`fecha` y
  luego `folio`); lo que aún sobre queda como **saldo a favor** del cliente. Cada nota que recibe
  dinero gana una fila en `cobranza_abono`; queda `pagada` si su saldo llega a 0 y `abonado` si no.
- **El saldo es derivado**: `monto_total − Σ abonos vivos`, calculado por el servidor al proyectar.
- **Una nota ya pagada, de cuenta perdida o borrada no rechaza el cobro**: su saldo aplicable es 0 y todo el
  monto pasa a las otras notas y al saldo a favor. El dinero sí se cobró.
- El único rechazo del dominio es **`nota-no-encontrada`**: la nota no existe, su cliente no es de
  la sucursal del vendedor, o no es del `cliente_id` del sobre.
- `fecha_pago` es informativa: el corte cuenta el cobro en `fecha_operacion`.
- Cada cobranza se aplica en **su propia transacción** junto con su fila del buzón (§7).

> [!warning] Quitar el folio de la cobranza NO subió la versión (T-21)
> Mismo criterio que el `num_nota` nulo y el `encargado` obligatorio: la app no está publicada y la única
> tablet en uso es la de prueba de Mario. Un build viejo que mande folio en la cobranza no se rompe (se
> ignora); solo gasta un número de su serie local. **Revisarlo al publicar la primera tablet.** Orden de
> despliegue: primero el servidor; después la app nueva, y **antes de instalarla, sincronizar** la tablet
> para subir los cobros pendientes.
````

4. En §7, en el bullet de `CobranzasService.registrarCobranza`, cambia `recibe dinero (mismo folio), su
   \`status\`` por `recibe dinero, su \`status\``.
5. En §7 "Cómo convive con el folio", en el punto 4, cambia
   `Implementado en T-16 para \`venta\`; en \`cobranza\` (T-20) se copia a cada fila \`cobranza_abono\` del cobro, donde **no** es \`unique\` (la unicidad vive en el buzón).`
   por `Implementado en T-16 para \`venta\`. La \`cobranza\` **no lleva folio** desde T-21 (§6).`
6. En §9, cambia la fila `| Usar el saldo a favor, eliminar una cobranza con autorización, cobranza desde el portal | **T-21 / T-34** |`
   por `| Eliminar una cobranza con autorización (el saldo a favor y la cobranza desde el portal ya están: T-21) | **T-34** |`.

Run: `npm run build --workspace=apps/backend && npm run typecheck --workspace=apps/tablet`
Expected: compila y `tsc` de la tablet sin errores (la tablet todavía manda folio; el tipo es opcional).

- [ ] **Paso 8: e2e — la cobranza entra sin folio, y con folio también**

`apps/backend/test/sincronizacion.e2e-spec.ts`:

a) Cambia el comentario de `FECHA_COBROS` por:

```ts
  /**
   * Dia de los cobros de prueba. Distinto de `FECHA_VENTAS`: la prueba de la
   * tablet sin actualizar (T-21) usa un folio de este dia y comprueba que una
   * venta todavia lo puede tomar.
   */
```

b) Borra `let ultimoConsecutivoCobro = 0;`.

c) `cobranzaValida` queda **sin** folio:

```ts
  /** Una cobranza que el servidor acepta (contrato §6). Sin folio: la cobranza no lleva folio (T-21). */
  const cobranzaValida = (
    cliente: string,
    ventaNotaId: string,
    datos: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) =>
    operacion({
      tipo: 'cobranza',
      cliente_id: cliente,
      fecha_operacion: FECHA_COBROS,
      ocurrido_en: `${FECHA_COBROS}T16:20:00.000-07:00`,
      datos: {
        venta_nota_id: ventaNotaId,
        monto_centavos: 5000,
        metodo_pago: 'efectivo',
        fecha_pago: FECHA_COBROS,
        ...datos,
      },
      ...extra,
    });
```

d) En `abonosDe` y en `saldoFavorDe` borra `'folio',` de la lista del `select`.

e) En `'una venta de contado nace pagada'` borra `'folio',` del `select` y `folio: op.folio as string,` del
   `toMatchObject`.

f) En `'una cobranza valida entra a cobranza_abono y el buzon apunta a la fila'` borra
   `folio: op.folio as string,`. En `'liquidar exacto deja la nota pagada y la fila es tipo cobranza'` borra
   `folio: op.folio as string,`. En `'lo que sobra de todas las notas queda como saldo a favor del cliente'`
   borra `folio: op.folio as string,`.

g) Renombra `'el excedente va a las otras notas de la mas vieja a la mas nueva, con el mismo folio (D1)'` a
   `'el excedente va a las otras notas de la mas vieja a la mas nueva (D1)'` y cambia sus tres
   expectativas de filas por:

```ts
        expect([aElegida.monto, aElegida.tipo]).toEqual(['100.00', 'cobranza']);
        expect([aVieja.monto, aVieja.tipo]).toEqual(['50.00', 'cobranza']);
        expect([aMedia.monto, aMedia.tipo, aMedia.saldo_pendiente]).toEqual([
          '50.00',
          'abono',
          '30.00',
        ]);
```

h) Reemplaza la prueba `'una cobranza sin folio es datos-invalidos'` completa por estas tres:

```ts
    it('una cobranza sin folio se registra: la cobranza no lleva folio (T-21)', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '250.00', fecha: '2026-08-02' },
      ]);
      const op = cobranzaValida(cli, notas[0]);
      expect(op).not.toHaveProperty('folio');

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');
      expect(await abonosDe(notas[0])).toHaveLength(1);
    });

    it('Review Focus 5: una cobranza CON folio (tablet sin actualizar) se registra; el folio no se guarda y el numero sigue libre', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '250.00', fecha: '2026-08-02' },
      ]);
      const folio = formarFolio(sucursalCodigo, FECHA_COBROS, segmento, 98);
      const op = cobranzaValida(cli, notas[0], {}, { folio });

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');
      expect(await abonosDe(notas[0])).toHaveLength(1);
      const buzon = await db
        .selectFrom('sync_operacion')
        .select('folio')
        .where('vendedor_id', '=', vendedorId)
        .where('clave_idempotencia', '=', op.clave)
        .executeTakeFirstOrThrow();
      expect(buzon.folio).toBeNull();

      // Ese numero no quedo ocupado: una venta del mismo dia lo puede tomar.
      const venta = ventaValida({ folio }, FECHA_COBROS);
      const resVenta = (await push({ operaciones: [venta] }).expect(200))
        .body as RespuestaPush;
      expect(resVenta.resultados[0].estado).toBe('aplicada');
    });

    it('Review Focus 5: un folio mal formado en una cobranza tampoco la rechaza', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '250.00', fecha: '2026-08-02' },
      ]);
      const op = cobranzaValida(cli, notas[0], {}, { folio: 'NO-ES-UN-FOLIO' });

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');
      expect(await abonosDe(notas[0])).toHaveLength(1);
    });
```

`apps/backend/test/ventas.e2e-spec.ts`: en `abonosDe` cambia
`.select(['monto', 'metodo_pago', 'vendedor_id', 'origen', 'folio'])` por
`.select(['monto', 'metodo_pago', 'vendedor_id', 'origen'])`, y en la prueba de contado con transferencia
de Oficina borra `folio: venta.folio,` del objeto esperado por `abonosDe`.

`apps/backend/test/ventas-editar.e2e-spec.ts`: en `abonar` borra `folio: null,` del `values`; en `cobrosDe`
borra `'folio',` del `select`; en `'crédito → contado lo crea con el método elegido, la fecha de la venta y
el repartidor'` borra `folio: v.folio,` del objeto esperado.

- [ ] **Paso 9: Correr las e2e afectadas**

Run: `npm run test:e2e --workspace=apps/backend -- sincronizacion ventas`
Expected: PASS (el patrón `ventas` corre `ventas.e2e-spec.ts` y `ventas-editar.e2e-spec.ts`), incluidas las
tres pruebas nuevas.

- [ ] **Paso 10: Lint y commit**

Run: `npm run lint --workspace=apps/backend && npm run lint --workspace=apps/tablet`
Expected: sin errores (el lint del backend aplica prettier con `--fix`).

```bash
git add apps/backend/src/modules/sincronizacion apps/backend/src/modules/ventas-cobranza \
  apps/backend/test/sincronizacion.e2e-spec.ts apps/backend/test/ventas.e2e-spec.ts \
  apps/backend/test/ventas-editar.e2e-spec.ts apps/tablet/src/sincronizacion/contrato.ts \
  docs/contrato-sincronizacion.md
git commit -m "T-21: la cobranza ya no lleva folio en el servidor ni en el contrato

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarea 2: Migración `cobranza_portal`, pruebas de la base y tipos

**Archivos:**
- Crear: `supabase/migrations/20261007160000_cobranza_portal.sql`
- Crear: `supabase/tests/99_cobranza_portal_test.sql`
- Modificar: `supabase/tests/99_cobranza_saldo_favor_test.sql` (se reescribe entero: ya no hay `folio`)
- Modificar (generado): `apps/backend/src/database/schema.d.ts`

**Interfaces:**
- Consume: Tarea 1 (ningún código escribe ya `cobranza_abono.folio` ni `saldo_favor_movimiento.folio`).
- Produce:
  - Columnas `cobranza_abono.capturo_usuario_id` y `saldo_favor_movimiento.capturo_usuario_id`
    (`uuid` → `usuario`, nulas).
  - Checks `ck_cobranza_abono_metodo` (`efectivo|transferencia|cheque|saldo_favor`),
    `ck_cobranza_abono_origen` (`venta_contado|cobro|saldo_favor`),
    `ck_cobranza_abono_saldo_favor` (`(origen = 'saldo_favor') = (metodo_pago = 'saldo_favor')`),
    `ck_saldo_favor_origen` (`excedente_cobro|aplicacion`).
  - Sin `cobranza_abono.folio`, sin `saldo_favor_movimiento.folio`, sin `idx_cobranza_abono_folio`.
  - En `schema.d.ts`: `CobranzaAbono.capturo_usuario_id: string | null` y
    `SaldoFavorMovimiento.capturo_usuario_id: string | null`; ninguna de las dos con `folio`.

- [ ] **Paso 1: Prueba pgTAP nueva (falla)**

`supabase/tests/99_cobranza_portal_test.sql`:

```sql
begin;
select plan(12);

-- T-21: cobranza desde el portal. Lo que la BASE garantiza aunque alguien
-- escriba por debajo del servicio. Prefijo `zz-pgtap-t21`.

insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t21', 'Usuario pgTAP T-21', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T21 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));
insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota, contado_credito,
     semana, mes, status, sucursal_id, origen, capturo_usuario_id)
  select 'ZZPGTAPT2101', '2026-10-07', c.id, null, 300.00, null, 'credito',
         41, 10, 'pendiente', c.sucursal_id, 'portal', u.id
    from cliente c, usuario u
   where c.nombre = 'ZZ-pgtap-T21 Cliente' and u.login = 'zz-pgtap-t21';

create temporary table _t21 on commit drop as
select
  (select id from usuario where login = 'zz-pgtap-t21') as usuario,
  (select id from cliente where nombre = 'ZZ-pgtap-T21 Cliente') as cliente,
  (select id from venta_nota where folio = 'ZZPGTAPT2101') as nota;

select hasnt_column('cobranza_abono', 'folio',
  'la cobranza no lleva folio (cliente, 2026-10-07)');
select hasnt_column('saldo_favor_movimiento', 'folio',
  'el saldo a favor tampoco');
select hasnt_index('cobranza_abono', 'idx_cobranza_abono_folio',
  'el indice del folio se fue con la columna');
select fk_ok('cobranza_abono', 'capturo_usuario_id', 'usuario', 'id',
  'el cobro del portal guarda quien lo capturo');
select fk_ok('saldo_favor_movimiento', 'capturo_usuario_id', 'usuario', 'id',
  'el movimiento de saldo a favor tambien');
select col_is_null('cobranza_abono', 'capturo_usuario_id',
  'la tablet no lo llena: admite null');

select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen, capturo_usuario_id)
    select nota, '2026-10-07', '2026-10-07', null, 100.00, 'abono',
           200.00, 'saldo_favor', 'saldo_favor', usuario
      from _t21$$,
  'aplicar saldo a favor: metodo y origen saldo_favor, sin cobrador'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-10-07', '2026-10-07', null, 10.00, 'abono',
           190.00, 'saldo_favor', 'cobro'
      from _t21$$,
  '23514', null,
  'el metodo saldo_favor solo va con el origen saldo_favor'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-10-07', '2026-10-07', null, 10.00, 'abono',
           190.00, 'efectivo', 'saldo_favor'
      from _t21$$,
  '23514', null,
  'y el origen saldo_favor solo con el metodo saldo_favor'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-10-07', '2026-10-07', null, 10.00, 'abono',
           190.00, 'tarjeta', 'cobro'
      from _t21$$,
  '23514', null,
  'un metodo fuera del catalogo no entra'
);

select lives_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, fecha_operacion, capturo_usuario_id)
    select cliente, null, -100.00, 'aplicacion', '2026-10-07', usuario from _t21$$,
  'aplicar saldo a favor deja un movimiento negativo de origen aplicacion'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, fecha_operacion)
    select cliente, null, 10.00, 'ajuste', '2026-10-07' from _t21$$,
  '23514', null,
  'otro origen de saldo a favor no entra'
);

select * from finish();
rollback;
```

- [ ] **Paso 2: Correrla y ver que falla**

Run: `npm run supabase -- test db`
Expected: FAIL en `99_cobranza_portal_test.sql` (`folio` todavía existe y `capturo_usuario_id` no).

- [ ] **Paso 3: Confirmar el nombre de los tres checks viejos**

Los checks de `metodo_pago` (T-05) y de los dos `origen` (T-20) se declararon en línea, así que llevan el
nombre que les puso Postgres. Confírmalo en la base local antes de escribir la migración:

```bash
DB_LOCAL=$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)
psql "$DB_LOCAL" -c "select conrelid::regclass as tabla, conname from pg_constraint where conrelid in ('cobranza_abono'::regclass, 'saldo_favor_movimiento'::regclass) and contype = 'c' order by 1, 2"
```

Expected: entre otros, `cobranza_abono_metodo_pago_check`, `cobranza_abono_origen_check` y
`saldo_favor_movimiento_origen_check`. Si no tienes `psql`, corre la misma consulta dentro del contenedor:
`docker exec -i $(docker ps --format '{{.Names}}' | grep supabase_db) psql -U postgres -c "…"`. Si algún
nombre no coincide, usa el que salga en la migración de abajo.

- [ ] **Paso 4: Escribir la migración**

`supabase/migrations/20261007160000_cobranza_portal.sql`:

```sql
-- T-21: cobranza desde el portal.
--
-- 1. Quien capturo el cobro en el portal (la tablet deja null).
-- 2. Aplicar saldo a favor desde el portal: el abono lleva metodo y origen
--    `saldo_favor` (no es dinero nuevo: Flujo y Tesoreria no deben contarlo) y
--    el libro de saldo a favor gana el movimiento negativo `aplicacion`.
-- 3. La cobranza NO lleva folio. Respuesta del cliente (2026-10-07): "Un solo
--    folio", "Porque la cobranza no lleva folio". Solo las ventas se numeran.
--    `cobranza_abono.folio` tambien guardaba una copia del folio de la venta en
--    los cobros de contado: sobra, la venta lo tiene en `venta_nota.folio`.
--
-- Ver docs/superpowers/specs/2026-10-07-t21-cobranza-portal-design.md §4.4.

alter table cobranza_abono
  add column capturo_usuario_id uuid references usuario(id);

alter table cobranza_abono drop constraint cobranza_abono_metodo_pago_check;
alter table cobranza_abono add constraint ck_cobranza_abono_metodo
  check (metodo_pago in ('efectivo', 'transferencia', 'cheque', 'saldo_favor'));

alter table cobranza_abono drop constraint cobranza_abono_origen_check;
alter table cobranza_abono add constraint ck_cobranza_abono_origen
  check (origen in ('venta_contado', 'cobro', 'saldo_favor'));

-- Uno sin el otro no tiene sentido: el metodo `saldo_favor` es justamente
-- "esto lo pago su saldo a favor", y ese abono no es un cobro ni una venta.
alter table cobranza_abono add constraint ck_cobranza_abono_saldo_favor
  check ((origen = 'saldo_favor') = (metodo_pago = 'saldo_favor'));

alter table saldo_favor_movimiento
  add column capturo_usuario_id uuid references usuario(id);

alter table saldo_favor_movimiento drop constraint saldo_favor_movimiento_origen_check;
alter table saldo_favor_movimiento add constraint ck_saldo_favor_origen
  check (origen in ('excedente_cobro', 'aplicacion'));

drop index if exists idx_cobranza_abono_folio;
alter table cobranza_abono drop column folio;
alter table saldo_favor_movimiento drop column folio;
```

- [ ] **Paso 5: Reescribir la prueba de T-20 sin folio**

`supabase/tests/99_cobranza_saldo_favor_test.sql` (reemplaza el archivo entero; las tres comprobaciones del
folio se van y las filas se ubican por nota, monto y fecha):

```sql
begin;
select plan(23);

-- Cobranza, abono y saldo a favor (T-20).
--
-- T-05 creo `cobranza_abono` sin origen, sin fecha de operacion y sin checks
-- de importe. T-20 es el primero que escribe en ella (desde el push de la
-- tablet y desde la venta de contado), y lo que se prueba aqui es lo que la
-- BASE garantiza aunque el portal o un script entren por debajo del servicio.
-- T-21 le quito el folio (la cobranza no lleva folio): eso se prueba en
-- 99_cobranza_portal_test.sql.
--
-- Nombres con prefijo `ZZ-pgtap` para no chocar con datos reales; el vendedor
-- va SIN segmento de folio para no depender de cuales estan ocupados.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t20', 'Vendedor pgTAP T-20', 'x', id
    from sucursal where codigo = 'TJ';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T20 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));
insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
     contado_credito, semana, mes, status, sucursal_id)
  select 'ZZPGTAPT2001', '2026-09-10', c.id, v.id, 250.00, '900',
         'credito', 37, 9, 'pendiente', c.sucursal_id
    from cliente c, vendedor v
   where c.nombre = 'ZZ-pgtap-T20 Cliente' and v.login = 'zz-pgtap-t20';

create temporary table _t20 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t20') as vendedor,
  (select id from cliente where nombre = 'ZZ-pgtap-T20 Cliente') as cliente,
  (select id from venta_nota where folio = 'ZZPGTAPT2001') as nota;

------------------------------------------------------------------
-- cobranza_abono: estructura
------------------------------------------------------------------

select has_column('cobranza_abono', 'origen',
  'el cobro dice si salio de una venta de contado o de un cobro capturado (D2)');
select has_column('cobranza_abono', 'fecha_operacion',
  'el cobro cuenta en el corte del dia en que se capturo (D3)');
select col_not_null('cobranza_abono', 'fecha_operacion',
  'fecha_operacion es obligatoria');
select has_index('cobranza_abono', 'idx_cobranza_abono_nota',
  'los abonos de una nota se buscan por nota: saldo derivado, D7');

------------------------------------------------------------------
-- cobranza_abono: reglas
------------------------------------------------------------------

select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-12', '2026-09-14', vendedor, 50.00, 'abono',
           200.00, 'efectivo'
      from _t20$$,
  'acepta un abono con fecha de operacion'
);

select is(
  (select origen from cobranza_abono
    where venta_nota_id = (select nota from _t20) and monto = 50.00),
  'cobro',
  'un cobro sin origen explicito es un cobro capturado'
);

-- Un mismo cobro reparte a varias filas; nada en la base lo impide.
select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-12', '2026-09-14', vendedor, 200.00, 'cobranza',
           0.00, 'efectivo'
      from _t20$$,
  'acepta otra fila del mismo dia sobre la misma nota'
);

select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-09-14', '2026-09-14', vendedor, 250.00, 'cobranza',
           0.00, 'efectivo', 'venta_contado'
      from _t20$$,
  'acepta el cobro automatico de una venta de contado'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-14', '2026-09-14', vendedor, 0.00, 'abono',
           250.00, 'efectivo'
      from _t20$$,
  '23514',
  null,
  'rechaza un cobro de $0'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-14', '2026-09-14', vendedor, 10.00, 'abono',
           -0.01, 'efectivo'
      from _t20$$,
  '23514',
  null,
  'rechaza un saldo pendiente negativo: el excedente va a saldo a favor'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-09-14', '2026-09-14', vendedor, 10.00, 'abono',
           240.00, 'efectivo', 'portal'
      from _t20$$,
  '23514',
  null,
  'rechaza un origen fuera del catalogo'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-14', vendedor, 10.00, 'abono',
           240.00, 'efectivo'
      from _t20$$,
  '23502',
  null,
  'rechaza un cobro sin fecha de operacion'
);

------------------------------------------------------------------
-- saldo_favor_movimiento
------------------------------------------------------------------

select has_table('saldo_favor_movimiento',
  'el saldo a favor es un libro de movimientos (D5)');
select fk_ok('saldo_favor_movimiento', 'cliente_id', 'cliente', 'id',
  'cada movimiento es de un cliente');
select fk_ok('saldo_favor_movimiento', 'vendedor_id', 'vendedor', 'id',
  'y lo origina un vendedor');
select has_index('saldo_favor_movimiento', 'idx_saldo_favor_cliente',
  'el saldo de un cliente se suma por cliente');
select has_trigger('saldo_favor_movimiento', 'trg_saldo_favor_movimiento_updated',
  'updated_at se mantiene solo, como en el resto del esquema');

select lives_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, fecha_operacion)
    select cliente, vendedor, 30.50, 'excedente_cobro', '2026-09-14'
      from _t20$$,
  'acepta el excedente de un cobro'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, fecha_operacion)
    select cliente, vendedor, 0.00, 'excedente_cobro', '2026-09-14'
      from _t20$$,
  '23514',
  null,
  'rechaza un movimiento de $0'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, fecha_operacion)
    select cliente, vendedor, 10.00, 'ajuste_portal', '2026-09-14'
      from _t20$$,
  '23514',
  null,
  'un origen fuera del catalogo no entra (T-21 solo agrego aplicacion)'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen)
    select cliente, vendedor, 10.00, 'excedente_cobro'
      from _t20$$,
  '23502',
  null,
  'rechaza un movimiento sin fecha de operacion'
);

------------------------------------------------------------------
-- Backfill de fecha_operacion, simulado
------------------------------------------------------------------

-- Despues de migrar ya no hay filas sin fecha, asi que se recrea el estado de
-- antes dentro de esta transaccion y se corre el MISMO update de la migracion.
alter table cobranza_abono alter column fecha_operacion drop not null;

insert into cobranza_abono
    (venta_nota_id, fecha_pago, vendedor_id, monto, tipo, saldo_pendiente, metodo_pago)
  select nota, '2026-09-11', vendedor, 10.00, 'abono', 190.00, 'efectivo'
    from _t20;

update cobranza_abono set fecha_operacion = fecha_pago where fecha_operacion is null;

select is(
  (select fecha_operacion from cobranza_abono
    where venta_nota_id = (select nota from _t20) and fecha_pago = '2026-09-11'),
  '2026-09-11'::date,
  'una fila previa toma su fecha de pago como fecha de operacion'
);

select lives_ok(
  $$alter table cobranza_abono alter column fecha_operacion set not null$$,
  'tras el backfill ya no queda ninguna fila sin fecha de operacion'
);

select * from finish();
rollback;
```

- [ ] **Paso 6: Aplicar, regenerar tipos y correr pgTAP**

Run:
```
npm run supabase -- migration up --local
npm run db:types --workspace=apps/backend
npm run supabase -- test db
```
Expected: `All tests successful`. En `schema.d.ts`, `CobranzaAbono` y `SaldoFavorMovimiento` ya no tienen
`folio` y tienen `capturo_usuario_id: string | null`.

- [ ] **Paso 7: Comprobar que nada dependía del folio**

Run:
```
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
```
Expected: compila; unitarias y e2e en verde. El que detecta un uso olvidado es TypeScript: `schema.d.ts` ya
no tiene esas columnas, así que un `select('folio')` o un `values({ folio })` sobre `cobranza_abono` o
`saldo_favor_movimiento` no compila (ni en `src` ni en las e2e, que ts-jest también revisa).

- [ ] **Paso 8: Pre-flight para la nube (NO lo corras: es para quien mergea)**

No ejecutes nada contra `sinmex dev`. Estas consultas van en el PR (Tarea 9) para que Roberto las corra
antes de `db push`; cada una debe dar **0**:

```sql
select count(*) from cobranza_abono where folio is not null;
select count(*) from saldo_favor_movimiento where folio is not null;
select count(*) from cobranza_abono
 where metodo_pago not in ('efectivo', 'transferencia', 'cheque', 'saldo_favor');
select count(*) from cobranza_abono
 where origen not in ('venta_contado', 'cobro', 'saldo_favor');
select count(*) from cobranza_abono
 where (origen = 'saldo_favor') <> (metodo_pago = 'saldo_favor');
select count(*) from saldo_favor_movimiento
 where origen not in ('excedente_cobro', 'aplicacion');
```

Si la primera no da 0 (hay cobros o ventas de contado en la nube), **no se empuja**: se le avisa a Roberto,
porque borrar la columna perdería ese dato.

- [ ] **Paso 9: Commit**

```bash
git add supabase/migrations/20261007160000_cobranza_portal.sql supabase/tests/99_cobranza_portal_test.sql \
  supabase/tests/99_cobranza_saldo_favor_test.sql apps/backend/src/database/schema.d.ts
git commit -m "T-21: migracion — capturo_usuario_id, saldo_favor como metodo y origen, sin folio en la cobranza

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 3: La app de tablet cobra sin folio

Solo TypeScript (spec §4.6). La copia de `repartirPago` de la tablet **no cambia**.

**Archivos:**
- Crear: `apps/tablet/src/datos/migraciones/010-cobranza-sin-folio.ts`
- Crear: `apps/tablet/src/datos/migraciones/010-cobranza-sin-folio.spec.ts`
- Modificar: `apps/tablet/src/datos/migraciones/index.ts`
- Modificar: `apps/tablet/src/datos/migraciones/008-cobranzas.spec.ts`
- Modificar: `apps/tablet/src/datos/tipos.ts` (`Cobranza`, `AbonoNota`, `MetodoPagoAbono`)
- Crear: `apps/tablet/src/datos/cobranzas-textos.ts` y `cobranzas-textos.spec.ts`
- Modificar: `apps/tablet/src/datos/index.ts`
- Modificar: `apps/tablet/src/datos/repositorios/cobranzas.ts` y `cobranzas.spec.ts`
- Modificar: `apps/tablet/src/datos/inicializar.ts`
- Modificar: `apps/tablet/src/sincronizacion/fuente-cobranzas.ts` y `fuente-cobranzas.spec.ts`
- Modificar: `apps/tablet/src/sincronizacion/pendientes.spec.ts`
- Modificar: `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx`

**Interfaces:**
- Consume: Tarea 1 (`MetodoPagoAbono` en `sincronizacion/contrato.ts`; el servidor acepta cobros sin folio).
- Produce:
  - `crearRepositorioCobranzas(deps: DepsRepositorio, { catalogos }: { catalogos: RepositorioCatalogos })`
    (ya **no** recibe `folios`).
  - `Cobranza` sin `folio`.
  - `export type MetodoPagoAbono = MetodoPago | 'saldo_favor'` en `datos/tipos.ts`; `AbonoNota.metodo_pago: MetodoPagoAbono`.
  - `NOMBRE_METODO: Record<MetodoPagoAbono, string>` y
    `lineasDelCobro(reparto: Reparto, notas: readonly { id: string; folio: string }[]): LineaDeCobro[]`
    en `datos/cobranzas-textos.ts`, con
    `LineaDeCobro = { notaId: string; folio: string; montoCentavos: number; saldoDespuesCentavos: number }`.

- [ ] **Paso 1: Prueba de la migración local 010 (falla)**

`apps/tablet/src/datos/migraciones/010-cobranza-sin-folio.spec.ts`:

```ts
import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 010 rehace `cobranza` sin la columna `folio` (T-21: la cobranza no lleva
 * folio). Lo que hay que demostrar es que rehacer no se lleve nada por delante:
 * los cobros que todavia no suben, con su estado y su error.
 */

const HASTA_009 = migraciones.slice(0, 9);

function baseCon009(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, HASTA_009);
  const ts = "'2026-10-07T00:00:00.000Z'";
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${ts});
    insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
      values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', ${ts});
    insert into cliente (id, nombre, domicilio, telefono, tipo, promocion, sucursal_id, activo, sincronizado_en)
      values ('cli-1', 'Abarrotes La Esquina', 'Calle 5', '6641234567', 'cliente', 'ninguna', 'suc-tj', 1, ${ts});
    insert into nota_pendiente
      (id, cliente_id, folio, num_nota, fecha, status, monto_total_centavos,
       saldo_centavos, activo, sincronizado_en, abonos_json)
      values ('nota-1', 'cli-1', 'TJ261001AP01', null, '2026-10-01', 'abonado',
              10000, 5000, 1, ${ts}, '[]');
    insert into cobranza
      (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, venta_nota_id,
       monto_centavos, metodo_pago, fecha_pago, grabada_en, sync_estado, sync_error)
      values
        ('cob-1', '2026-10-07', 'cli-1', 'ven-1', 'suc-tj', 'TJ261007AP02', 'nota-1',
         4000, 'transferencia', '2026-10-06', ${ts}, 'error', 'nota-no-encontrada: x'),
        ('cob-2', '2026-10-07', 'cli-1', 'ven-1', 'suc-tj', 'TJ261007AP03', 'nota-1',
         1000, 'efectivo', '2026-10-07', ${ts}, 'pendiente', null);
  `);
  return bd;
}

describe('migracion 010: la cobranza sin folio (T-21)', () => {
  it('es la migracion 10 y deja la base al dia', () => {
    expect(migraciones[9]?.nombre).toBe('cobranza-sin-folio');
    expect(migraciones[9]?.version).toBe(10);
    const bd = baseCon009();
    ejecutarMigraciones(bd, migraciones);
    expect(versionEsquema(bd)).toBe(migraciones.length);
  });

  it('quita la columna folio de cobranza', () => {
    const bd = baseCon009();
    ejecutarMigraciones(bd, migraciones);
    const columnas = bd
      .getAllSync<{ name: string }>(`select name from pragma_table_info('cobranza')`)
      .map((c) => c.name);
    expect(columnas).not.toContain('folio');
    expect(columnas).toContain('venta_nota_id');
  });

  it('conserva los cobros pendientes de subir, con su estado y su error', () => {
    const bd = baseCon009();
    ejecutarMigraciones(bd, migraciones);
    expect(
      bd.getAllSync(
        'select id, monto_centavos, metodo_pago, fecha_pago, sync_estado, sync_error from cobranza order by id',
      ),
    ).toEqual([
      {
        id: 'cob-1',
        monto_centavos: 4000,
        metodo_pago: 'transferencia',
        fecha_pago: '2026-10-06',
        sync_estado: 'error',
        sync_error: 'nota-no-encontrada: x',
      },
      {
        id: 'cob-2',
        monto_centavos: 1000,
        metodo_pago: 'efectivo',
        fecha_pago: '2026-10-07',
        sync_estado: 'pendiente',
        sync_error: null,
      },
    ]);
  });

  it('un cobro nuevo entra sin folio; las llaves foraneas y los checks siguen en pie', () => {
    const bd = baseCon009();
    ejecutarMigraciones(bd, migraciones);
    const insertar = (id: string, nota: string, metodo: string) =>
      bd.runSync(
        `insert into cobranza
           (id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id,
            monto_centavos, metodo_pago, fecha_pago, grabada_en)
         values ($id, '2026-10-07', 'cli-1', 'ven-1', 'suc-tj', $nota,
                 500, $metodo, '2026-10-07', '2026-10-07T18:00:00.000Z')`,
        { $id: id, $nota: nota, $metodo: metodo },
      );
    expect(() => insertar('cob-3', 'nota-1', 'cheque')).not.toThrow();
    expect(() => insertar('cob-4', 'no-existe', 'cheque')).toThrow(/FOREIGN KEY/);
    expect(() => insertar('cob-5', 'nota-1', 'tarjeta')).toThrow(/CHECK/);
  });

  it('recrea los indices de la 008', () => {
    const bd = baseCon009();
    ejecutarMigraciones(bd, migraciones);
    const indices = bd
      .getAllSync<{ name: string }>(
        `select name from sqlite_master where type = 'index' and tbl_name = 'cobranza'`,
      )
      .map((i) => i.name);
    expect(indices).toEqual(expect.arrayContaining(['idx_cobranza_sync', 'idx_cobranza_cliente_fecha']));
  });
});
```

Run: `npm test --workspace=apps/tablet -- 010-cobranza`
Expected: FAIL (`migraciones[9]` no existe).

- [ ] **Paso 2: Escribir la migración 010**

`apps/tablet/src/datos/migraciones/010-cobranza-sin-folio.ts`:

```ts
import type { Migracion } from './motor';

/**
 * La cobranza deja de llevar folio en la base local (T-21).
 *
 * ## Por que
 *
 * Respuesta del cliente (2026-10-07): *"Un solo folio"*, *"Porque la cobranza
 * no lleva folio"*. Solo las ventas se numeran. Hasta aqui la tablet le emitia
 * un folio a cada cobro y gastaba un numero de la serie del vendedor; desde
 * T-21 el repositorio ya no lo emite y el servidor ignora el que llegue.
 *
 * ## Por que se rehace la tabla
 *
 * `ALTER TABLE ... DROP COLUMN` de SQLite no puede quitar una columna `unique`
 * (como era `folio`). Mismo procedimiento que la 005 y la 009: crear la tabla
 * nueva, copiar por nombre, borrar la vieja, renombrar y recrear los indices,
 * con las llaves foraneas apagadas por el motor. Nadie apunta a `cobranza`, asi
 * que la unica tabla que se comprueba es ella misma (sus llaves a `cliente`,
 * `vendedor`, `sucursal` y `nota_pendiente`).
 *
 * **Los cobros pendientes de subir se conservan**: viajan sin folio en el
 * siguiente push, y el servidor los acepta igual.
 */
export const cobranzaSinFolio: Migracion = {
  version: 10,
  nombre: 'cobranza-sin-folio',
  sinLlavesForaneas: { comprobar: ['cobranza'] },
  sql: `
    create table cobranza_nueva (
      id               text primary key,          -- = clave de idempotencia
      fecha            text not null,             -- reloj.hoy(), dia de trabajo
      cliente_id       text not null references cliente(id),
      vendedor_id      text not null references vendedor(id),
      sucursal_id      text not null references sucursal(id),
      venta_nota_id    text not null references nota_pendiente(id),
      monto_centavos   integer not null check (monto_centavos > 0),
      metodo_pago      text not null check (metodo_pago in ('efectivo','transferencia','cheque')),
      fecha_pago       text not null,
      grabada_en       text not null,
      sync_estado      text not null default 'pendiente'
                         check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error       text,
      sincronizado_en  text
    );

    insert into cobranza_nueva (
      id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id,
      monto_centavos, metodo_pago, fecha_pago, grabada_en, sync_estado,
      sync_error, sincronizado_en
    )
    select
      id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id,
      monto_centavos, metodo_pago, fecha_pago, grabada_en, sync_estado,
      sync_error, sincronizado_en
    from cobranza;

    drop table cobranza;
    alter table cobranza_nueva rename to cobranza;

    -- Los indices no viajan con el \`rename\`: se recrean igual que en 008.
    create index idx_cobranza_sync on cobranza (sync_estado) where sync_estado <> 'sincronizado';
    create index idx_cobranza_cliente_fecha on cobranza (cliente_id, fecha);
  `,
};
```

En `apps/tablet/src/datos/migraciones/index.ts` agrega `import { cobranzaSinFolio } from './010-cobranza-sin-folio';`
después del import de la 009, y `cobranzaSinFolio,` al final del arreglo `migraciones`.

`apps/tablet/src/datos/migraciones/008-cobranzas.spec.ts` (corre contra la base al día, que ya no tiene
`folio`): cambia `INSERTAR_COBRANZA` y `cobro` por

```ts
const INSERTAR_COBRANZA = `insert into cobranza
  (id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id,
   monto_centavos, metodo_pago, fecha_pago, grabada_en)
  values ($id, '2026-08-07', 'cli-1', 'ven-1', 'suc-tj', 'nota-1',
          $monto_centavos, $metodo_pago, '2026-08-07', '2026-08-07T15:00:00.000Z')`;

const cobro = (extra: Record<string, string | number> = {}) => ({
  $id: 'cob-1',
  $monto_centavos: 5000,
  $metodo_pago: 'efectivo',
  ...extra,
});
```

y **borra** la prueba `it('el folio es unico', …)` (desde T-21 no hay folio; la 010 lo prueba).

Run: `npm test --workspace=apps/tablet -- migraciones`
Expected: PASS (`008`, `009` y `010`). La 009 sigue pasando: inserta su cobro con folio en una base de la
008 y la 010 lo copia sin él.

- [ ] **Paso 3: Tipos y textos (pruebas que fallan)**

`apps/tablet/src/datos/cobranzas-textos.spec.ts`:

```ts
import type { Reparto } from './cobranzas-reglas';
import { lineasDelCobro, NOMBRE_METODO } from './cobranzas-textos';

describe('textos de la cobranza (T-21)', () => {
  it('el abono que aplico la oficina con saldo a favor se nombra "Saldo a favor"', () => {
    expect(NOMBRE_METODO.saldo_favor).toBe('Saldo a favor');
    expect(NOMBRE_METODO.efectivo).toBe('efectivo');
  });

  it('lineasDelCobro pone el folio de cada nota que recibio dinero, en el orden del reparto', () => {
    const reparto: Reparto = {
      aplicaciones: [
        { notaId: 'nota-2', montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'nota-1', montoCentavos: 2000, saldoAntesCentavos: 15000, saldoDespuesCentavos: 13000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    };
    expect(
      lineasDelCobro(reparto, [
        { id: 'nota-1', folio: 'TJ260801AP01' },
        { id: 'nota-2', folio: 'TJ260802AP03' },
      ]),
    ).toEqual([
      { notaId: 'nota-2', folio: 'TJ260802AP03', montoCentavos: 10000, saldoDespuesCentavos: 0 },
      { notaId: 'nota-1', folio: 'TJ260801AP01', montoCentavos: 2000, saldoDespuesCentavos: 13000 },
    ]);
  });

  it('si la nota ya no esta en la lista, usa su id: nunca deja la linea vacia', () => {
    const reparto: Reparto = {
      aplicaciones: [
        { notaId: 'nota-x', montoCentavos: 500, saldoAntesCentavos: 500, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 0,
    };
    expect(lineasDelCobro(reparto, [])[0]?.folio).toBe('nota-x');
  });
});
```

Run: `npm test --workspace=apps/tablet -- cobranzas-textos`
Expected: FAIL (el módulo no existe).

- [ ] **Paso 4: Implementar tipos y textos**

`apps/tablet/src/datos/tipos.ts`:

Después de `export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';` agrega:

```ts
/**
 * Metodo de un abono que baja del servidor (T-21): ademas de los del cobro,
 * `saldo_favor` cuando la oficina aplico saldo a favor a la nota. La tablet no
 * cobra con saldo a favor; solo lo muestra.
 */
export type MetodoPagoAbono = MetodoPago | 'saldo_favor';
```

En `AbonoNota` cambia `metodo_pago: MetodoPago;` por `metodo_pago: MetodoPagoAbono;`. En `Cobranza` borra
`folio: string;` y cambia el comentario de `fecha` por `/** Dia de trabajo (\`reloj.hoy()\`), el de \`fecha_operacion\`. */`;
cambia el comentario de la interfaz por:

```ts
/**
 * Un cobro grabado en la tablet (T-20). Ver las migraciones `008-cobranzas.ts`
 * y `010-cobranza-sin-folio.ts`: **sin folio** desde T-21.
 *
 * No guarda el reparto: lo recalcula el servidor. No se edita.
 */
```

`apps/tablet/src/datos/cobranzas-textos.ts`:

```ts
import type { Reparto } from './cobranzas-reglas';
import type { MetodoPagoAbono } from './tipos';

/**
 * Como se le dice al vendedor el metodo de un abono (T-20, T-21).
 *
 * Los del cobro van en minusculas porque se leen dentro de una frase ("en
 * efectivo"). `saldo_favor` lo introdujo T-21: la oficina aplico saldo a favor
 * a esa nota desde el portal; la tablet solo lo muestra.
 */
export const NOMBRE_METODO: Record<MetodoPagoAbono, string> = {
  efectivo: 'efectivo',
  transferencia: 'transferencia',
  cheque: 'cheque',
  saldo_favor: 'Saldo a favor',
};

/** Una nota que recibio dinero de un cobro, lista para pintarse. */
export interface LineaDeCobro {
  notaId: string;
  folio: string;
  montoCentavos: number;
  saldoDespuesCentavos: number;
}

/**
 * El reparto con el folio de cada nota (T-21: la vista final del cobro muestra
 * el monto y como quedaron las notas, ya no un folio del cobro).
 *
 * Hay que calcularlo ANTES de grabar: una nota que queda en 0 sale de las
 * pendientes (`activo = 0`) y despues ya no se encontraria su folio.
 */
export function lineasDelCobro(
  reparto: Reparto,
  notas: readonly { id: string; folio: string }[],
): LineaDeCobro[] {
  const folios = new Map(notas.map((n) => [n.id, n.folio]));
  return reparto.aplicaciones.map((a) => ({
    notaId: a.notaId,
    folio: folios.get(a.notaId) ?? a.notaId,
    montoCentavos: a.montoCentavos,
    saldoDespuesCentavos: a.saldoDespuesCentavos,
  }));
}
```

En `apps/tablet/src/datos/index.ts`, después del bloque que exporta de `./cobranzas-reglas`, agrega:

```ts
export { lineasDelCobro, NOMBRE_METODO } from './cobranzas-textos';
export type { LineaDeCobro } from './cobranzas-textos';
```

Run: `npm test --workspace=apps/tablet -- cobranzas-textos`
Expected: PASS.

- [ ] **Paso 5: El repositorio deja de emitir folio (pruebas que fallan)**

En `apps/tablet/src/datos/repositorios/cobranzas.spec.ts`:

a) `montar` crea el repositorio sin `folios` (pero conserva `folios` para la venta y para contar):

```ts
function montar(opciones: { sinSegmento?: boolean } = {}) {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  const snapshot = snapshotDePrueba();
  if (opciones.sinSegmento) {
    snapshot.vendedores = (snapshot.vendedores ?? []).map((v) => ({
      ...v,
      folio_segmento: null,
    }));
  }
  catalogos.guardarSnapshot(snapshot);
  const folios = crearRepositorioFolios(deps);
  return {
    deps,
    catalogos,
    folios,
    cobranzas: crearRepositorioCobranzas(deps, { catalogos }),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
  };
}
```

b) Cambia el import `import { crearRepositorioFolios, ErrorFolio } from './folios';` por
`import { crearRepositorioFolios } from './folios';`.

c) Reemplaza las pruebas `'graba el cobro con el folio del dia y lo deja pendiente de subir'`,
`'si el folio no se puede emitir no queda ni cobro ni saldo descontado'`,
`'un fallo DESPUES de emitir el folio tambien lo deshace: no se quema un numero (D16)'`,
`'un monto de $0 se rechaza antes de emitir folio'`, `'ventas y cobros comparten el contador de folios del dia'`
y `'si un oyente del refresco truena, el cobro ya grabado no se reporta como fallido'` por estas:

```ts
  it('graba el cobro SIN folio y lo deja pendiente de subir (T-21)', () => {
    const { deps, cobranzas } = montar();
    const c = cobranzas.registrar(cobro({ metodoPago: 'transferencia', fechaPago: '2026-08-05' }));

    expect(c).toEqual({
      id: 'id-1',
      fecha: '2026-08-07',
      cliente_id: 'cli-1',
      vendedor_id: 'ven-1',
      sucursal_id: 'suc-tj',
      venta_nota_id: 'nota-1',
      monto_centavos: 5000,
      metodo_pago: 'transferencia',
      fecha_pago: '2026-08-05',
      grabada_en: '2026-08-07T15:00:00.000Z',
      sync_estado: 'pendiente',
      sync_error: null,
      sincronizado_en: null,
    });
    expect(cuantas(deps, 'folio_emitido')).toBe(0);
  });

  it('un vendedor sin segmento de folio tambien puede cobrar: la cobranza no lleva folio', () => {
    const { deps, cobranzas } = montar({ sinSegmento: true });
    expect(() => cobranzas.registrar(cobro())).not.toThrow();
    expect(cuantas(deps, 'cobranza')).toBe(1);
  });

  it('cobrar no consume numero de la serie: la venta despues de un cobro sigue el consecutivo de ventas', () => {
    const { folios, ventas, cobranzas } = montar();
    cobranzas.registrar(cobro());
    expect(folios.consecutivoDe('ven-1')).toBe(0);
    const v = ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '2346',
      contadoCredito: 'credito',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
    });
    expect(v.folio).toBe('TJ260807AP01');
  });

  it('un fallo a media grabacion no deja ni cobro ni saldo descontado (D15)', () => {
    const { deps, cobranzas } = montar();
    // Se rompe a proposito la siguiente escritura de la transaccion (el
    // reparto local), cuando la cabecera del cobro ya se inserto. Un trigger
    // que aborta el UPDATE logra el fallo tardio sin tocar la lectura previa
    // de `nota_pendiente`.
    deps.bd.execSync(`
      create trigger t20_bloquea_reparto
      before update on nota_pendiente
      begin
        select raise(abort, 'fallo forzado de prueba');
      end;
    `);
    expect(() => cobranzas.registrar(cobro())).toThrow();
    expect(cuantas(deps, 'cobranza')).toBe(0);
    expect(nota(deps, 'nota-1')?.saldo_centavos).toBe(15000);
  });

  it('un monto de $0 se rechaza y no graba nada', () => {
    const { deps, cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ montoCentavos: 0 }))).toThrow(ErrorCobranza);
    expect(cuantas(deps, 'cobranza')).toBe(0);
  });

  it('un vendedor que no esta en la tablet se rechaza', () => {
    const { cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ vendedorId: 'ven-x' }))).toThrow(
      'Este vendedor no está en la tablet. Sincroniza antes de cobrar.',
    );
  });

  it('si un oyente del refresco truena, el cobro ya grabado no se reporta como fallido', () => {
    const { catalogos, cobranzas, deps } = montar();
    catalogos.suscribir(() => {
      throw new Error('una pantalla abierta truena al refrescar');
    });

    const grabada = cobranzas.registrar(cobro());

    // El cobro esta firme: propagar el error haria que la pantalla dijera "no
    // se guardo nada" e invitara a cobrar dos veces.
    expect(grabada.id).toBe('id-1');
    expect(cuantas(deps, 'cobranza')).toBe(1);
    expect(nota(deps, 'nota-1')?.saldo_centavos).toBe(10000);
  });
```

d) Cambia el comentario de cabecera del `describe` a `/** Cobranza en la tablet (T-20; sin folio desde T-21). … */`
(el resto del texto igual).

En `apps/tablet/src/sincronizacion/fuente-cobranzas.spec.ts`: `montar` crea
`crearRepositorioCobranzas(deps, { catalogos })` y se borra el import de `crearRepositorioFolios`; la prueba
del sobre queda:

```ts
  it('arma el sobre exacto del contrato: cliente en el sobre, el pago en datos y SIN folio (T-21)', () => {
    const { cobranzas, fuente } = montar();
    const c = cobranzas.registrar(cobro);

    const [op] = fuente.pendientes();
    expect(op).toEqual({
      // La clave es el id de la fila: no cambia entre reintentos.
      clave: c.id,
      tipo: 'cobranza',
      fecha_operacion: '2026-08-07',
      ocurrido_en: '2026-08-07T15:00:00.000Z',
      cliente_id: 'cli-1',
      datos: {
        venta_nota_id: 'nota-1',
        monto_centavos: 5000,
        metodo_pago: 'cheque',
        fecha_pago: '2026-08-06',
      },
    });
    expect(op).not.toHaveProperty('folio');
  });
```

En `apps/tablet/src/sincronizacion/pendientes.spec.ts`, cambia
`cobranzas: crearRepositorioCobranzas(deps, { catalogos, folios }),` por
`cobranzas: crearRepositorioCobranzas(deps, { catalogos }),`.

Run: `npm test --workspace=apps/tablet -- cobranzas fuente-cobranzas pendientes`
Expected: FAIL (el repositorio todavía emite folio y la `cobranza` local ya no tiene la columna).

- [ ] **Paso 6: Implementar el repositorio y la fuente**

`apps/tablet/src/datos/repositorios/cobranzas.ts`:

Cambia el import `import type { RepositorioFolios } from './folios';` — **bórralo**. Reemplaza el comentario
de `crearRepositorioCobranzas` y su firma por:

```ts
/**
 * La cobranza en ruta (T-20): grabar con reparto local, consultar y la cola
 * del push.
 *
 * **Sin folio** (T-21): el cliente aclaro que la cobranza no lleva folio ("Un
 * solo folio"); solo las ventas se numeran. Cobrar ya no gasta un numero de la
 * serie del vendedor.
 *
 * Recibe `catalogos` ya creado, como las ventas: es quien publica la version
 * que observan las pantallas.
 */
export function crearRepositorioCobranzas(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
```

Reemplaza `registrar` completo por:

```ts
    /**
     * Graba un cobro y aplica el reparto local, en **una sola transaccion**
     * (D15). Sin folio (T-21).
     *
     * Todo lo que puede fallar por una regla se comprueba ANTES de abrir la
     * transaccion. Lo que falla dentro (SQLite) hace `rollback` de todo.
     *
     * @throws {ErrorCobranza} si la captura no se puede grabar.
     */
    registrar(datos: DatosRegistroCobranza): Cobranza {
      const hoy = reloj.hoy();

      const cliente = catalogos.obtenerCliente(datos.clienteId);
      if (!cliente || cliente.activo !== 1) {
        throw new ErrorCobranza(
          'Este cliente ya no está en el catálogo de la tablet. Sincroniza antes de cobrarle.',
        );
      }

      // La sucursal del cobro es la del vendedor, como la de la venta (antes
      // salia del folio emitido).
      const vendedor = bd.getFirstSync<{ sucursal_id: string }>(
        'select sucursal_id from vendedor where id = $id',
        { $id: datos.vendedorId },
      );
      if (!vendedor) {
        throw new ErrorCobranza('Este vendedor no está en la tablet. Sincroniza antes de cobrar.');
      }

      const nota = catalogos
        .notasPendientesDe(datos.clienteId)
        .find((n) => n.id === datos.ventaNotaId);
      if (!nota) {
        throw new ErrorCobranza(
          'Esa nota ya no está pendiente para este cliente. Sincroniza y vuelve a intentarlo.',
        );
      }

      const problemas = problemasDeCobro({
        notaFecha: nota.fecha,
        montoCentavos: datos.montoCentavos,
        metodoPago: datos.metodoPago,
        fechaPago: datos.fechaPago,
        hoy,
      });
      if (problemas.length > 0) {
        throw new ErrorCobranza(problemas.join(' '));
      }

      const fechaPago = datos.fechaPago.trim();
      const reparto = repartirPago(datos.montoCentavos, datos.ventaNotaId, notasParaReparto(datos.clienteId));
      const id = generarId();
      const ahora = reloj.ahora();

      enTransaccion(bd, () => {
        bd.runSync(
          `insert into cobranza (
             id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id,
             monto_centavos, metodo_pago, fecha_pago, grabada_en, sync_estado
           ) values (
             $id, $fecha, $cliente_id, $vendedor_id, $sucursal_id, $venta_nota_id,
             $monto_centavos, $metodo_pago, $fecha_pago, $grabada_en, 'pendiente'
           )`,
          {
            $id: id,
            // El dia de trabajo: viaja como `fecha_operacion`.
            $fecha: hoy,
            $cliente_id: datos.clienteId,
            $vendedor_id: datos.vendedorId,
            $sucursal_id: vendedor.sucursal_id,
            $venta_nota_id: datos.ventaNotaId,
            $monto_centavos: datos.montoCentavos,
            $metodo_pago: datos.metodoPago,
            $fecha_pago: fechaPago,
            $grabada_en: ahora,
          },
        );

        // Reparto local (D15): el siguiente pull lo pisa con la verdad del servidor.
        for (const a of reparto.aplicaciones) {
          const actual = bd.getFirstSync<{ abonos_json: string }>(
            'select abonos_json from nota_pendiente where id = $id',
            { $id: a.notaId },
          );
          const abonos: AbonoNota[] = [
            ...leerAbonos(actual?.abonos_json ?? '[]'),
            { fecha_pago: fechaPago, monto_centavos: a.montoCentavos, metodo_pago: datos.metodoPago },
          ];
          bd.runSync(
            `update nota_pendiente set
               saldo_centavos = $saldo,
               -- El CHECK local solo admite pendiente/abonado: una nota en 0
               -- se retira con activo = 0, no con 'pagada'.
               status = 'abonado',
               activo = $activo,
               abonos_json = $abonos_json
             where id = $id`,
            {
              $saldo: a.saldoDespuesCentavos,
              $activo: a.saldoDespuesCentavos === 0 ? 0 : 1,
              $abonos_json: JSON.stringify(abonos),
              $id: a.notaId,
            },
          );
        }

        if (reparto.saldoFavorCentavos > 0) {
          bd.runSync(
            `update cliente set saldo_favor_centavos = saldo_favor_centavos + $monto where id = $id`,
            { $monto: reparto.saldoFavorCentavos, $id: datos.clienteId },
          );
        }
      });

      // Despues del commit: la ficha y la venta releen notas y saldo a favor.
      // Si un oyente truena, el cobro ya esta grabado: no puede propagarse como
      // si la grabacion hubiera fallado (la pantalla diria "no se guardo nada"
      // e invitaria a cobrar dos veces).
      try {
        catalogos.publicarCambio();
      } catch {
        // Solo se pierde el refresco de pantallas abiertas; el cobro esta firme.
      }

      const grabada = repo.porId(id);
      if (!grabada) throw new ErrorCobranza('No se pudo leer el cobro recién grabado.');
      return grabada;
    },
```

`apps/tablet/src/datos/inicializar.ts`: cambia
`cobranzas: crearRepositorioCobranzas(deps, { catalogos, folios }),` por
`cobranzas: crearRepositorioCobranzas(deps, { catalogos }),`, y el comentario de `folios` en la interfaz por:

```ts
  /**
   * Emision offline de folios (T-14). La usa `ventas` (T-16) dentro de su
   * propia transaccion. La cobranza ya no emite folio (T-21).
   */
```

`apps/tablet/src/sincronizacion/fuente-cobranzas.ts`: cambia el comentario por

```ts
/**
 * Los cobros capturados en ruta, como operaciones del push (T-20).
 *
 * - **`clave`** es el `id` de la fila: no cambia, y reenviar no duplica.
 * - **`fecha_operacion`** es el dia de trabajo en que se grabo.
 * - **`cliente_id`** va en el sobre, no en `datos` (contrato §6). **Sin folio**:
 *   la cobranza no lleva folio (T-21).
 * - **`datos`** es el pago tal cual; el reparto lo hace el servidor.
 *
 * Se registra DESPUES de la fuente de ventas: el motor sube por fuente y en
 * orden, asi que un cobro nunca llega antes que las ventas del dia. Los
 * rechazados siguen en la cola y se reenvian (patron D19 de T-16).
 */
```

y borra la línea `folio: c.folio,` del objeto que devuelve `pendientes()`.

Run: `npm test --workspace=apps/tablet`
Expected: PASS completo.

- [ ] **Paso 7: La pantalla de cobranza**

`apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx`:

a) El import de `@/datos` queda:

```ts
import {
  ErrorCobranza,
  leerAbonos,
  leerMontoCentavos,
  lineasDelCobro,
  NOMBRE_METODO,
  problemasDeCobro,
  type Cobranza,
  type LineaDeCobro,
  type MetodoPago,
  type NotaPendiente,
  type SyncEstado,
} from '@/datos';
```

b) Cambia el comentario de `type Paso` por
`Los tres pasos del cobro (D16). Un cobro grabado no se edita en la tablet: la revision es obligatoria y al final se muestra el monto y como quedaron las notas (T-21: la cobranza no lleva folio).`,
y **borra** la constante local `NOMBRE_METODO` (ahora viene de `@/datos`).

c) Cambia el comentario de `PantallaCobranza` por
`Cobranza / abono de un cliente (T-20): elegir la nota, capturar el pago, revisar el reparto y grabar. Sin folio desde T-21.`
(el párrafo del reparto igual), y el de `const hoy` por `// El dia de trabajo del reloj de la tablet: el de \`fecha_operacion\`.`

d) Cambia el estado `grabado`:

```ts
  const [grabado, setGrabado] = useState<{
    cobro: Cobranza;
    lineas: LineaDeCobro[];
    saldoFavorCentavos: number;
  } | null>(null);
```

e) `grabar()` queda:

```ts
  function grabar() {
    // `revisar` no deja llegar aqui sin nota ni monto; la comprobacion es para el tipo.
    if (nota === null || montoCentavos === null) return;
    // Guardia contra doble toque: un segundo toque mientras el primero corre
    // grabaria el cobro dos veces.
    if (grabando) return;
    setGrabando(true);
    // Antes de grabar: una nota que queda en 0 sale de `notas` y ya no se
    // encontraria su folio.
    const lineas = reparto ? lineasDelCobro(reparto, notas) : [];
    const saldoFavorCentavos = reparto?.saldoFavorCentavos ?? 0;
    try {
      const cobro = datos.cobranzas.registrar({
        vendedorId,
        clienteId,
        ventaNotaId: nota.id,
        montoCentavos,
        metodoPago: metodo,
        fechaPago,
      });
      setProblemas([]);
      setGrabado({ cobro, lineas, saldoFavorCentavos });
      setPaso('grabada');
    } catch (e) {
      setProblemas([
        e instanceof ErrorCobranza
          ? e.message
          : 'No se pudo grabar el cobro. No se guardó nada; intenta de nuevo.',
      ]);
    } finally {
      setGrabando(false);
    }
  }
```

f) El paso 3 queda:

```tsx
  /* ---------------------------------------------------------------- */
  /* 3. Grabada: el monto y como quedaron las notas (T-21)             */
  /* ---------------------------------------------------------------- */

  if (paso === 'grabada' && grabado) {
    const { cobro, lineas, saldoFavorCentavos } = grabado;
    return (
      <Pantalla titulo="Cobro grabado" subtitulo={`${nombreCliente} · así quedaron sus notas.`}>
        <Tarjeta estado="listo" etiqueta="Cobro">
          <Cifra valor={pesos(cobro.monto_centavos)} tamano="grande" />
          <Text style={estilos.textoSuave}>
            En {NOMBRE_METODO[cobro.metodo_pago]} · pagado el {cobro.fecha_pago}
          </Text>
          {lineas.map((l) => (
            <Text key={l.notaId} style={estilos.textoTarjeta}>
              <Cifra valor={pesos(l.montoCentavos)} /> · nota <Cifra valor={l.folio} />{' '}
              {l.saldoDespuesCentavos === 0 ? (
                'pagada'
              ) : (
                <>
                  queda debiendo <Cifra valor={pesos(l.saldoDespuesCentavos)} tono="aviso" />
                </>
              )}
            </Text>
          ))}
          {saldoFavorCentavos > 0 ? (
            <Text style={estilos.textoTarjeta}>
              Saldo a favor del cliente: <Cifra valor={pesos(saldoFavorCentavos)} tono="exito" />
            </Text>
          ) : null}
          <Text style={estilos.textoSuave}>
            Quedó guardado en la tablet y sube solo al sincronizar. Si otra tablet o la oficina ya
            cobró esa nota, el servidor pasa el dinero a las otras notas o al saldo a favor.
          </Text>
        </Tarjeta>

        {/* Unica accion de este paso. */}
        <Boton
          etiqueta="Volver al cliente"
          glifo="←"
          onPress={() => router.back()}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      </Pantalla>
    );
  }
```

g) En el paso 2 (revisión): borra `const folioDe = …`; cambia `· folio{' '}` por `· nota{' '}` en la tarjeta
"Cobro"; y la tarjeta "Cómo se reparte" recorre `lineasDelCobro(reparto, notas)`:

```tsx
        <Tarjeta etiqueta="Cómo se reparte">
          {lineasDelCobro(reparto, notas).map((l) => (
            <Text key={l.notaId} style={estilos.textoTarjeta}>
              <Cifra valor={l.folio} /> · <Cifra valor={pesos(l.montoCentavos)} /> ·{' '}
              {l.saldoDespuesCentavos === 0 ? (
                'queda pagada'
              ) : (
                <>
                  queda debiendo <Cifra valor={pesos(l.saldoDespuesCentavos)} tono="aviso" />
                </>
              )}
            </Text>
          ))}
          {reparto.saldoFavorCentavos > 0 ? (
            <Text style={estilos.textoTarjeta}>
              Saldo a favor del cliente:{' '}
              <Cifra valor={pesos(reparto.saldoFavorCentavos)} tono="exito" />
            </Text>
          ) : null}
        </Tarjeta>
```

h) En "Cobros de hoy", la línea de cada cobro queda:

```tsx
              <Text style={estilos.textoTarjeta}>
                <Cifra valor={pesos(c.monto_centavos)} /> · {NOMBRE_METODO[c.metodo_pago]} · pagado el{' '}
                {c.fecha_pago}
              </Text>
```

- [ ] **Paso 8: Tipos, lint, pruebas y bundle**

Run:
```
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
npm run export --workspace=apps/tablet
```
Expected: todo en verde; `export` termina el bundle de Metro sin errores. `grep -n "folio" "apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx"`
solo debe mostrar el folio **de la nota** (`nota.folio`, `l.folio`, la etiqueta de accesibilidad).

- [ ] **Paso 9: Commit**

```bash
git add apps/tablet
git commit -m "T-21: la app cobra sin folio (migracion local 010) y muestra el monto y las notas al final

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarea 4: Una regla para una o varias notas, y el servicio que la usa (pago y saldo a favor)

**Archivos:**
- Modificar: `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts` (`repartirPagoEnNotas`, `repartirPago` como envoltura)
- Crear: `apps/backend/src/modules/ventas-cobranza/reglas-cobranza-notas.spec.ts` (`reglas-cobranza.spec.ts` **no se toca**)
- Modificar: `apps/tablet/src/datos/cobranzas-reglas.ts` (solo el comentario de cabecera)
- Crear: `apps/backend/src/modules/ventas-cobranza/pago-rechazado.ts` y `pago-rechazado.spec.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/cobranzas.service.spec.ts` (se reescribe entero)
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-edicion.repository.ts` (`abonosDeCobroVivos`)
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts` (`CobroDeVenta.origen`)
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-consulta.service.ts` (`completar`)
- Modificar: `apps/backend/src/modules/ventas-cobranza/acciones-venta.ts` (comentario de `accionesDeVenta`)
- Modificar: `apps/backend/test/ventas-editar.e2e-spec.ts`

**Interfaces:**
- Consume: Tarea 1 (`ContextoCobranza` sin folio) y Tarea 2 (`capturo_usuario_id`, método/origen `saldo_favor`,
  origen `aplicacion`).
- Produce (los usa la Tarea 5):

```ts
// reglas-cobranza.ts
export function repartirPagoEnNotas(
  montoCentavos: number,
  notasElegidasIds: readonly string[],
  notas: readonly NotaParaReparto[],
): Reparto;

// pago-rechazado.ts
export type RazonPagoRechazado =
  | 'nota-ajena' | 'nota-sin-saldo' | 'fecha-anterior'
  | 'saldo-favor-insuficiente' | 'excede-lo-que-deben';
export class PagoRechazado extends Error { readonly razon: RazonPagoRechazado }
export function formatearPesos(centavos: number): string; // "$1,500.00"

// cobranzas.repository.ts
export type MetodoAbono = MetodoPago | 'saldo_favor';
// NotaBloqueada gana `numNota: string | null`
// bloquearNotasDelCliente(clienteId: string, notaElegidaIds: readonly string[], trx): Promise<NotaBloqueada[]>
// bloquearSaldoFavor(clienteId: string, trx): Promise<string[]>   // montos `numeric` vivos, ya bloqueados
// NuevoAbono: metodoPago: MetodoAbono; origen: 'cobro' | 'venta_contado' | 'saldo_favor'; capturoUsuarioId?: string | null
// NuevoSaldoFavor: origen: 'excedente_cobro' | 'aplicacion'; capturoUsuarioId: string | null

// cobranzas.service.ts
export interface ContextoCobranza { sucursalId: string; fechaOperacion: string; vendedorId: string | null; usuarioId: string | null }
export interface NotasAPagar { clienteId: string; notaIds: string[]; montoCentavos: number }
export interface PagoEnNotas extends NotasAPagar { metodoPago: MetodoPago; fechaPago: string }
export interface AplicacionDeCobro {
  notaId: string; folio: string; numNota: string | null; fecha: string;
  montoCentavos: number; saldoAntesCentavos: number; saldoDespuesCentavos: number;
  status: 'pagada' | 'abonado'; palomeada: boolean;
}
export interface PlanDeCobro { aplicaciones: AplicacionDeCobro[]; saldoFavorCentavos: number }
// CobranzasService:
//   registrarCobranza(cobranza: CobranzaNormalizada, contexto, trx): Promise<EntidadCobranza>   (tablet, igual que hoy)
//   planearPago(pago: NotasAPagar, trx): Promise<PlanDeCobro>
//   registrarPago(pago: PagoEnNotas, contexto, trx): Promise<PlanDeCobro>
//   planearSaldoFavor(pago: NotasAPagar, trx): Promise<PlanDeCobro>
//   aplicarSaldoFavor(pago: NotasAPagar, contexto, trx): Promise<PlanDeCobro>
```

- [ ] **Paso 1: Pruebas de la regla para varias notas (fallan)**

`apps/backend/src/modules/ventas-cobranza/reglas-cobranza-notas.spec.ts`:

```ts
import {
  repartirPago,
  repartirPagoEnNotas,
  type NotaParaReparto,
} from './reglas-cobranza';

/**
 * `repartirPagoEnNotas` (T-21): la oficina palomea VARIAS notas. Las pruebas de
 * `repartirPago` (una nota, compartidas con la tablet) siguen en
 * `reglas-cobranza.spec.ts` sin cambiar: son la garantia de que la tablet no
 * nota nada.
 */
const nota = (
  id: string,
  fecha: string,
  folio: string,
  saldoCentavos: number,
  cobrable = true,
): NotaParaReparto => ({ id, fecha, folio, cobrable, saldoCentavos });

// A es la mas vieja; las palomeadas son C y B, mandadas en desorden.
const NOTAS = [
  nota('C', '2026-08-05', 'TJ260805AP01', 5000),
  nota('A', '2026-08-01', 'TJ260801AP01', 10000),
  nota('B', '2026-08-03', 'TJ260803AP01', 8000),
];

describe('repartirPagoEnNotas (T-21)', () => {
  it('paga primero la palomeada mas vieja aunque llegue en desorden; la ultima queda abonada', () => {
    expect(repartirPagoEnNotas(12000, ['C', 'B'], NOTAS)).toEqual({
      aplicaciones: [
        { notaId: 'B', montoCentavos: 8000, saldoAntesCentavos: 8000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'C', montoCentavos: 4000, saldoAntesCentavos: 5000, saldoDespuesCentavos: 1000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    });
  });

  it('lo que sobra de las palomeadas va a las demas de la mas vieja a la mas nueva, y luego a saldo a favor', () => {
    const r = repartirPagoEnNotas(30000, ['C'], NOTAS);
    expect(r.aplicaciones.map((a) => [a.notaId, a.montoCentavos])).toEqual([
      ['C', 5000],
      ['A', 10000],
      ['B', 8000],
    ]);
    expect(r.saldoFavorCentavos).toBe(7000);
  });

  it('una palomeada que ya no es cobrable no recibe nada y el dinero sigue su orden', () => {
    const notas = [
      nota('A', '2026-08-01', 'TJ260801AP01', 10000, false),
      nota('B', '2026-08-03', 'TJ260803AP01', 8000),
    ];
    const r = repartirPagoEnNotas(5000, ['A', 'B'], notas);
    expect(r.aplicaciones.map((a) => [a.notaId, a.montoCentavos])).toEqual([['B', 5000]]);
  });

  it('con la misma fecha desempata el folio', () => {
    const notas = [
      nota('X', '2026-08-01', 'TJ260801AP02', 1000),
      nota('Y', '2026-08-01', 'TJ260801AP01', 1000),
    ];
    expect(
      repartirPagoEnNotas(1500, ['X', 'Y'], notas).aplicaciones.map((a) => a.notaId),
    ).toEqual(['Y', 'X']);
  });

  it('con una sola elegida da exactamente lo mismo que repartirPago', () => {
    for (const elegida of ['A', 'B', 'C', 'no-existe']) {
      for (const monto of [1, 4000, 12000, 23000, 30000]) {
        expect(repartirPagoEnNotas(monto, [elegida], NOTAS)).toEqual(
          repartirPago(monto, elegida, NOTAS),
        );
      }
    }
  });

  it('un monto que no es entero positivo es un bug de quien llama', () => {
    expect(() => repartirPagoEnNotas(0, ['A'], NOTAS)).toThrow(Error);
    expect(() => repartirPagoEnNotas(10.5, ['A'], NOTAS)).toThrow(Error);
  });
});
```

Run: `npm test --workspace=apps/backend -- reglas-cobranza-notas`
Expected: FAIL (`repartirPagoEnNotas` no existe).

- [ ] **Paso 2: Implementar la regla**

En `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts`:

a) Al final del comentario de cabecera (antes de `*/`) agrega:

```ts
 *
 * `repartirPagoEnNotas` (varias notas elegidas, T-21) existe SOLO aqui: el
 * portal no reparte localmente (pide la vista previa al servidor) y la tablet
 * sigue cobrando una nota a la vez. `repartirPago` es `repartirPagoEnNotas` con
 * una sola nota y da exactamente lo mismo que la copia de la tablet.
```

b) Cambia el comentario de `Reparto.aplicaciones` por `/** En orden: las elegidas primero (por fecha y folio) y despues las demas por fecha y folio. */`.

c) Reemplaza `repartirPago` completa (su comentario y su cuerpo) por:

```ts
/**
 * Reparte un pago entre una o varias notas elegidas (D1, T-21): primero las
 * elegidas de la mas vieja a la mas nueva (`fecha`, luego `folio`), despues
 * las otras notas cobrables del cliente en el mismo orden, y lo que sobre
 * queda como saldo a favor.
 *
 * Un pago mayor al saldo **se acepta** (Mario). Una elegida que ya no es
 * cobrable (D9) no recibe nada y su parte sigue el orden; rechazarla o no es
 * decision de quien llama (la tablet no rechaza; el portal si, antes).
 *
 * @throws {Error} si `montoCentavos` no es un entero positivo: la forma del
 * pago ya la valido quien llama, asi que llegar aqui con eso es un bug.
 */
export function repartirPagoEnNotas(
  montoCentavos: number,
  notasElegidasIds: readonly string[],
  notas: readonly NotaParaReparto[],
): Reparto {
  if (!Number.isSafeInteger(montoCentavos) || montoCentavos <= 0) {
    throw new Error(
      `repartirPagoEnNotas necesita un entero positivo de centavos, no ${montoCentavos}.`,
    );
  }

  const elegidas = new Set(notasElegidasIds);
  const orden = [
    ...notas.filter((n) => elegidas.has(n.id)).sort(porFechaYFolio),
    ...notas.filter((n) => !elegidas.has(n.id)).sort(porFechaYFolio),
  ];

  const aplicaciones: Aplicacion[] = [];
  let restante = montoCentavos;

  for (const n of orden) {
    if (restante === 0) break;
    if (!n.cobrable || n.saldoCentavos <= 0) continue;

    const monto = Math.min(restante, n.saldoCentavos);
    const despues = n.saldoCentavos - monto;
    aplicaciones.push({
      notaId: n.id,
      montoCentavos: monto,
      saldoAntesCentavos: n.saldoCentavos,
      saldoDespuesCentavos: despues,
      tipo: despues === 0 ? 'cobranza' : 'abono',
      status: despues === 0 ? 'pagada' : 'abonado',
    });
    restante -= monto;
  }

  return { aplicaciones, saldoFavorCentavos: restante };
}

/**
 * Reparte un pago sobre UNA nota elegida (D1): la de la tablet. Es
 * `repartirPagoEnNotas` con una sola nota; su copia en la tablet
 * (`apps/tablet/src/datos/cobranzas-reglas.ts`) da lo mismo.
 *
 * @throws {Error} si `montoCentavos` no es un entero positivo.
 */
export function repartirPago(
  montoCentavos: number,
  notaElegidaId: string,
  notas: readonly NotaParaReparto[],
): Reparto {
  return repartirPagoEnNotas(montoCentavos, [notaElegidaId], notas);
}
```

d) En `apps/tablet/src/datos/cobranzas-reglas.ts`, dentro del `> [!warning] \`repartirPago\` esta duplicada a proposito`
de la cabecera, agrega al final de esa cita:

```ts
 * >
 * > `repartirPagoEnNotas` (varias notas, T-21) existe solo en el servidor: el
 * > portal no reparte localmente y la tablet sigue cobrando una nota a la vez.
 * > Para una nota da exactamente lo mismo que esta copia.
```

(no cambies nada más de ese archivo).

Run: `npm test --workspace=apps/backend -- reglas-cobranza && npm test --workspace=apps/tablet -- cobranzas-reglas`
Expected: PASS en las dos (`reglas-cobranza.spec.ts` y la de la tablet sin tocar).

- [ ] **Paso 3: Los rechazos del pago del portal (pruebas que fallan)**

`apps/backend/src/modules/ventas-cobranza/pago-rechazado.spec.ts`:

```ts
import {
  MOTIVO_NOTA_AJENA,
  PagoRechazado,
  formatearPesos,
  motivoExcedeLoQueDeben,
  motivoFechaAnterior,
  motivoNotaSinSaldo,
  motivoSaldoFavorInsuficiente,
} from './pago-rechazado';

describe('formatearPesos', () => {
  it('pone signo de pesos, comas de miles y dos decimales, sin coma flotante', () => {
    expect(formatearPesos(150000)).toBe('$1,500.00');
    expect(formatearPesos(5)).toBe('$0.05');
    expect(formatearPesos(123456789)).toBe('$1,234,567.89');
    expect(formatearPesos(-3000)).toBe('-$30.00');
  });
});

describe('mensajes del pago (T-21)', () => {
  it('son los del spec, palabra por palabra', () => {
    expect(motivoNotaSinSaldo('TJ261001AP03')).toBe(
      'La nota TJ261001AP03 ya no tiene saldo; vuelve a cargar.',
    );
    expect(MOTIVO_NOTA_AJENA).toBe(
      'Una de las notas marcadas no es de este cliente o ya no existe; vuelve a cargar.',
    );
    expect(motivoFechaAnterior('2026-10-01')).toBe(
      'La fecha del pago no puede ser anterior a la nota más vieja que marcaste (2026-10-01).',
    );
    expect(motivoSaldoFavorInsuficiente(15000)).toBe(
      'El cliente solo tiene $150.00 de saldo a favor.',
    );
    expect(motivoExcedeLoQueDeben(8000)).toBe(
      'Las notas marcadas solo deben $80.00: no se puede aplicar más saldo a favor que eso.',
    );
  });

  it('PagoRechazado lleva su razon y el mensaje', () => {
    const e = new PagoRechazado('nota-ajena', MOTIVO_NOTA_AJENA);
    expect(e).toBeInstanceOf(Error);
    expect(e.razon).toBe('nota-ajena');
    expect(e.message).toBe(MOTIVO_NOTA_AJENA);
  });
});
```

Run: `npm test --workspace=apps/backend -- pago-rechazado`
Expected: FAIL (el módulo no existe).

- [ ] **Paso 4: Implementar `pago-rechazado.ts`**

`apps/backend/src/modules/ventas-cobranza/pago-rechazado.ts`:

```ts
/**
 * Un pago del PORTAL que el dominio no acepta (T-21).
 *
 * Distinto de `CobranzaRechazada` a proposito: la tablet NO rechaza una nota
 * ya pagada (D9: el dinero si se cobro y rechazarlo lo perderia), y su unica
 * razon viaja al contrato de sincronizacion. La oficina, en cambio, tiene la
 * pantalla enfrente: si la nota que palomeo ya no tiene saldo, se le dice y
 * vuelve a cargar. `CobranzasPortalService` traduce esto a 400/409.
 */
export type RazonPagoRechazado =
  /** Una palomeada no llego entre las bloqueadas: no existe o es de otro cliente. */
  | 'nota-ajena'
  /** Una palomeada ya no es cobrable (pagada, cuenta perdida, borrada) o esta en 0. */
  | 'nota-sin-saldo'
  /** `fechaPago` antes de la palomeada mas vieja. */
  | 'fecha-anterior'
  /** Aplicar mas saldo a favor del que tiene el cliente. */
  | 'saldo-favor-insuficiente'
  /** Aplicar mas saldo a favor del que deben las palomeadas. */
  | 'excede-lo-que-deben';

export class PagoRechazado extends Error {
  readonly razon: RazonPagoRechazado;

  constructor(razon: RazonPagoRechazado, motivo: string) {
    super(motivo);
    this.name = 'PagoRechazado';
    this.razon = razon;
  }
}

/** Centavos a `$1,234.56`, sin coma flotante (igual que `formatearPesos` del portal). */
export function formatearPesos(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(centavos);
  const enteros = Math.floor(absoluto / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signo}$${enteros}.${String(absoluto % 100).padStart(2, '0')}`;
}

export const MOTIVO_NOTA_AJENA =
  'Una de las notas marcadas no es de este cliente o ya no existe; vuelve a cargar.';

export const motivoNotaSinSaldo = (folio: string): string =>
  `La nota ${folio} ya no tiene saldo; vuelve a cargar.`;

export const motivoFechaAnterior = (fecha: string): string =>
  `La fecha del pago no puede ser anterior a la nota más vieja que marcaste (${fecha}).`;

export const motivoSaldoFavorInsuficiente = (disponibleCentavos: number): string =>
  `El cliente solo tiene ${formatearPesos(disponibleCentavos)} de saldo a favor.`;

export const motivoExcedeLoQueDeben = (debenCentavos: number): string =>
  `Las notas marcadas solo deben ${formatearPesos(debenCentavos)}: no se puede aplicar más saldo a favor que eso.`;
```

Run: `npm test --workspace=apps/backend -- pago-rechazado`
Expected: PASS.

- [ ] **Paso 5: Pruebas del servicio (se reescribe el archivo; fallan)**

`apps/backend/src/modules/ventas-cobranza/cobranzas.service.spec.ts` (reemplázalo entero; las pruebas de T-20
quedan con las mismas afirmaciones, más `capturoUsuarioId` y `origen` en lo que se escribe):

```ts
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { CobranzaNormalizada } from './datos-cobranza';
import { CobranzaRechazada } from './cobranza-rechazada';
import type { NotaBloqueada, NotaParaCobro } from './cobranzas.repository';
import {
  CobranzasService,
  type ContextoCobranza,
  type PagoEnNotas,
} from './cobranzas.service';
import { PagoRechazado } from './pago-rechazado';

const CLIENTE = 'cliente-1';
const SUCURSAL = 'sucursal-tj';
const A = 'nota-a';
const B = 'nota-b';
const C = 'nota-c';

/** El servicio no usa la transaccion: solo la pasa a quien escribe. */
const trx = {} as Transaction<DB>;

/** La tablet: su vendedor y sin usuario. */
const contexto: ContextoCobranza = {
  sucursalId: SUCURSAL,
  fechaOperacion: '2026-09-14',
  vendedorId: 'vendedor-1',
  usuarioId: null,
};

/** El portal (T-21): Oficina y quien capturo. */
const contextoPortal: ContextoCobranza = {
  sucursalId: SUCURSAL,
  fechaOperacion: '2026-10-07',
  vendedorId: null,
  usuarioId: 'usuario-1',
};

const cobro = (
  extra: Partial<CobranzaNormalizada> = {},
): CobranzaNormalizada => ({
  clienteId: CLIENTE,
  ventaNotaId: A,
  montoCentavos: 5000,
  metodoPago: 'efectivo',
  fechaPago: '2026-09-10',
  ...extra,
});

const pago = (extra: Partial<PagoEnNotas> = {}): PagoEnNotas => ({
  clienteId: CLIENTE,
  notaIds: [C, B],
  montoCentavos: 12000,
  metodoPago: 'transferencia',
  fechaPago: '2026-10-05',
  ...extra,
});

const bloqueada = (
  id: string,
  fecha: string,
  montoTotal: string,
  extra: Partial<NotaBloqueada> = {},
): NotaBloqueada => ({
  id,
  fecha,
  folio: `TJ${fecha.slice(2, 4)}${fecha.slice(5, 7)}${fecha.slice(8, 10)}AP01`,
  numNota: null,
  status: 'pendiente',
  borrada: false,
  montoTotal,
  ...extra,
});

function montar(
  opciones: {
    nota?: NotaParaCobro | undefined;
    bloqueadas?: NotaBloqueada[];
    abonado?: Map<string, string>;
    saldoFavor?: string[];
  } = {},
) {
  let abonos = 0;
  const repo = {
    notaParaCobro: jest
      .fn()
      .mockResolvedValue(
        'nota' in opciones
          ? opciones.nota
          : { id: A, clienteId: CLIENTE, sucursalId: SUCURSAL },
      ),
    bloquearNotasDelCliente: jest
      .fn()
      .mockResolvedValue(
        opciones.bloqueadas ?? [bloqueada(A, '2026-08-01', '250.00')],
      ),
    abonadoPorNota: jest
      .fn()
      .mockResolvedValue(opciones.abonado ?? new Map([[A, '100.00']])),
    insertarAbono: jest
      .fn()
      .mockImplementation(() => Promise.resolve(`abono-${++abonos}`)),
    actualizarStatusNota: jest.fn().mockResolvedValue(undefined),
    insertarSaldoFavor: jest.fn().mockResolvedValue('favor-1'),
    bloquearSaldoFavor: jest.fn().mockResolvedValue(opciones.saldoFavor ?? []),
  };
  const servicio = new CobranzasService(repo);
  return { servicio, repo };
}

/** A (08-01, $100), B (08-03, $80) y C (08-05, $50), sin abonos. */
const tresNotas = (saldoFavor?: string[]) =>
  montar({
    bloqueadas: [
      bloqueada(A, '2026-08-01', '100.00'),
      bloqueada(B, '2026-08-03', '80.00'),
      bloqueada(C, '2026-08-05', '50.00'),
    ],
    abonado: new Map(),
    saldoFavor,
  });

describe('CobranzasService.registrarCobranza (tablet, T-20)', () => {
  it('un abono parcial deja una fila abono con la foto del saldo y la nota abonado', async () => {
    const { servicio, repo } = montar();

    await expect(
      servicio.registrarCobranza(cobro(), contexto, trx),
    ).resolves.toEqual({
      tabla: 'cobranza_abono',
      id: 'abono-1',
    });

    expect(repo.insertarAbono).toHaveBeenCalledTimes(1);
    expect(repo.insertarAbono).toHaveBeenCalledWith(
      {
        ventaNotaId: A,
        vendedorId: 'vendedor-1',
        fechaPago: '2026-09-10',
        fechaOperacion: '2026-09-14',
        monto: '50.00',
        tipo: 'abono',
        saldoPendiente: '100.00',
        metodoPago: 'efectivo',
        origen: 'cobro',
        capturoUsuarioId: null,
      },
      trx,
    );
    expect(repo.actualizarStatusNota).toHaveBeenCalledWith(A, 'abonado', trx);
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('liquidar deja la fila tipo cobranza con saldo 0 y la nota pagada', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarCobranza(
      cobro({ montoCentavos: 15000 }),
      contexto,
      trx,
    );

    expect(repo.insertarAbono).toHaveBeenCalledWith(
      expect.objectContaining({
        monto: '150.00',
        tipo: 'cobranza',
        saldoPendiente: '0.00',
      }),
      trx,
    );
    expect(repo.actualizarStatusNota).toHaveBeenCalledWith(A, 'pagada', trx);
  });

  it('el excedente va a las otras notas por fecha y el resto a saldo a favor', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [
        bloqueada(A, '2026-08-05', '100.00'),
        bloqueada(B, '2026-08-03', '80.00'),
        bloqueada(C, '2026-08-01', '50.00', { status: 'abonado' }),
      ],
      abonado: new Map([[C, '20.00']]),
    });

    await expect(
      servicio.registrarCobranza(
        cobro({ montoCentavos: 25000 }),
        contexto,
        trx,
      ),
    ).resolves.toEqual({ tabla: 'cobranza_abono', id: 'abono-1' });

    // A (elegida) 100, luego C (la mas vieja, saldo 30) y B (80): sobran 40.
    expect(repo.insertarAbono).toHaveBeenCalledTimes(3);
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ventaNotaId: A, monto: '100.00' }),
      trx,
    );
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ventaNotaId: C, monto: '30.00' }),
      trx,
    );
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ ventaNotaId: B, monto: '80.00' }),
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: 'vendedor-1',
        monto: '40.00',
        origen: 'excedente_cobro',
        fechaOperacion: '2026-09-14',
        capturoUsuarioId: null,
      },
      trx,
    );
  });

  it('una nota elegida ya pagada no se rechaza: el dinero va a las demas (D9)', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [
        bloqueada(A, '2026-08-01', '250.00', { status: 'pagada' }),
        bloqueada(B, '2026-08-02', '60.00'),
      ],
      abonado: new Map([[A, '250.00']]),
    });

    await expect(
      servicio.registrarCobranza(
        cobro({ montoCentavos: 10000 }),
        contexto,
        trx,
      ),
    ).resolves.toEqual({ tabla: 'cobranza_abono', id: 'abono-1' });

    expect(repo.insertarAbono).toHaveBeenCalledTimes(1);
    expect(repo.insertarAbono).toHaveBeenCalledWith(
      expect.objectContaining({
        ventaNotaId: B,
        monto: '60.00',
        tipo: 'cobranza',
      }),
      trx,
    );
    expect(repo.actualizarStatusNota).not.toHaveBeenCalledWith(
      A,
      expect.anything(),
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '40.00' }),
      trx,
    );
  });

  it('una nota elegida borrada tampoco recibe dinero, aunque diga pendiente', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [bloqueada(A, '2026-08-01', '250.00', { borrada: true })],
      abonado: new Map(),
    });

    await servicio.registrarCobranza(cobro(), contexto, trx);

    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '50.00' }),
      trx,
    );
  });

  it('si todo queda a favor, el buzon apunta al movimiento de saldo a favor', async () => {
    const { servicio } = montar({
      bloqueadas: [bloqueada(A, '2026-08-01', '250.00', { status: 'pagada' })],
      abonado: new Map([[A, '250.00']]),
    });

    await expect(
      servicio.registrarCobranza(cobro(), contexto, trx),
    ).resolves.toEqual({
      tabla: 'saldo_favor_movimiento',
      id: 'favor-1',
    });
  });

  it('bloquea las notas del cliente antes de leer lo abonado (D13)', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarCobranza(cobro(), contexto, trx);

    expect(repo.bloquearNotasDelCliente).toHaveBeenCalledWith(
      CLIENTE,
      [A],
      trx,
    );
    expect(repo.abonadoPorNota).toHaveBeenCalledWith([A], trx);
    expect(
      repo.bloquearNotasDelCliente.mock.invocationCallOrder[0],
    ).toBeLessThan(repo.abonadoPorNota.mock.invocationCallOrder[0]);
  });

  it('una nota que no existe es nota-no-encontrada y no escribe nada', async () => {
    const { servicio, repo } = montar({ nota: undefined });

    const error: unknown = await servicio
      .registrarCobranza(cobro(), contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CobranzaRechazada);
    expect(error).toMatchObject({ razon: 'nota-no-encontrada' });
    expect(repo.bloquearNotasDelCliente).not.toHaveBeenCalled();
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('una nota de un cliente de otra sucursal es nota-no-encontrada', async () => {
    const { servicio, repo } = montar({
      nota: { id: A, clienteId: CLIENTE, sucursalId: 'sucursal-mx' },
    });
    await expect(
      servicio.registrarCobranza(cobro(), contexto, trx),
    ).rejects.toMatchObject({
      razon: 'nota-no-encontrada',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });

  it('una nota de otro cliente es nota-no-encontrada', async () => {
    const { servicio, repo } = montar({
      nota: { id: A, clienteId: 'cliente-2', sucursalId: SUCURSAL },
    });
    await expect(
      servicio.registrarCobranza(cobro(), contexto, trx),
    ).rejects.toMatchObject({
      razon: 'nota-no-encontrada',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });
});

describe('CobranzasService.registrarPago (portal, T-21)', () => {
  it('paga primero la palomeada mas vieja y la ultima queda abonada; las demas no se tocan', async () => {
    const { servicio, repo } = tresNotas();

    const plan = await servicio.registrarPago(pago(), contextoPortal, trx);

    expect(plan).toEqual({
      aplicaciones: [
        {
          notaId: B,
          folio: 'TJ260803AP01',
          numNota: null,
          fecha: '2026-08-03',
          montoCentavos: 8000,
          saldoAntesCentavos: 8000,
          saldoDespuesCentavos: 0,
          status: 'pagada',
          palomeada: true,
        },
        {
          notaId: C,
          folio: 'TJ260805AP01',
          numNota: null,
          fecha: '2026-08-05',
          montoCentavos: 4000,
          saldoAntesCentavos: 5000,
          saldoDespuesCentavos: 1000,
          status: 'abonado',
          palomeada: true,
        },
      ],
      saldoFavorCentavos: 0,
    });
    expect(repo.insertarAbono).toHaveBeenCalledTimes(2);
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      1,
      {
        ventaNotaId: B,
        vendedorId: null,
        fechaPago: '2026-10-05',
        fechaOperacion: '2026-10-07',
        monto: '80.00',
        tipo: 'cobranza',
        saldoPendiente: '0.00',
        metodoPago: 'transferencia',
        origen: 'cobro',
        capturoUsuarioId: 'usuario-1',
      },
      trx,
    );
    expect(repo.actualizarStatusNota).not.toHaveBeenCalledWith(
      A,
      expect.anything(),
      trx,
    );
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('lo que sobra va a las demas (de la mas vieja) y luego a saldo a favor, sin cobrador', async () => {
    const { servicio, repo } = tresNotas();

    const plan = await servicio.registrarPago(
      pago({ notaIds: [C], montoCentavos: 30000 }),
      contextoPortal,
      trx,
    );

    expect(
      plan.aplicaciones.map((a) => [a.notaId, a.montoCentavos, a.palomeada]),
    ).toEqual([
      [C, 5000, true],
      [A, 10000, false],
      [B, 8000, false],
    ]);
    expect(plan.saldoFavorCentavos).toBe(7000);
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: null,
        monto: '70.00',
        origen: 'excedente_cobro',
        fechaOperacion: '2026-10-07',
        capturoUsuarioId: 'usuario-1',
      },
      trx,
    );
  });

  it('bloquea las notas del cliente con TODAS las palomeadas antes de leer lo abonado', async () => {
    const { servicio, repo } = tresNotas();
    await servicio.registrarPago(pago(), contextoPortal, trx);
    expect(repo.bloquearNotasDelCliente).toHaveBeenCalledWith(
      CLIENTE,
      [C, B],
      trx,
    );
    expect(
      repo.bloquearNotasDelCliente.mock.invocationCallOrder[0],
    ).toBeLessThan(repo.abonadoPorNota.mock.invocationCallOrder[0]);
  });

  it('Review Focus 1: una palomeada que ya quedo pagada (la cobro la tablet) se rechaza y no se graba nada', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [
        bloqueada(B, '2026-08-03', '80.00', { status: 'pagada' }),
        bloqueada(C, '2026-08-05', '50.00'),
      ],
      abonado: new Map([[B, '80.00']]),
    });

    const error: unknown = await servicio
      .registrarPago(pago(), contextoPortal, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PagoRechazado);
    expect(error).toMatchObject({
      razon: 'nota-sin-saldo',
      message: 'La nota TJ260803AP01 ya no tiene saldo; vuelve a cargar.',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.actualizarStatusNota).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<NotaBloqueada>, Map<string, string>]>([
    ['abonado pero ya en 0', { status: 'abonado' }, new Map([[B, '80.00']])],
    ['borrada', { borrada: true }, new Map()],
    ['de cuenta perdida', { status: 'cuenta_perdida' }, new Map()],
  ])('una palomeada %s tambien es nota-sin-saldo', async (_caso, extra, abonado) => {
    const { servicio } = montar({
      bloqueadas: [
        bloqueada(B, '2026-08-03', '80.00', extra),
        bloqueada(C, '2026-08-05', '50.00'),
      ],
      abonado,
    });
    await expect(
      servicio.registrarPago(pago(), contextoPortal, trx),
    ).rejects.toMatchObject({ razon: 'nota-sin-saldo' });
  });

  it('una palomeada que no llego bloqueada (de otro cliente o inexistente) es nota-ajena', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [bloqueada(C, '2026-08-05', '50.00')],
      abonado: new Map(),
    });
    await expect(
      servicio.registrarPago(pago(), contextoPortal, trx),
    ).rejects.toMatchObject({
      razon: 'nota-ajena',
      message:
        'Una de las notas marcadas no es de este cliente o ya no existe; vuelve a cargar.',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });

  it('Review Focus 2: una fecha de pago anterior a la palomeada mas vieja se rechaza', async () => {
    const { servicio, repo } = tresNotas();
    await expect(
      servicio.registrarPago(
        pago({ fechaPago: '2026-08-02' }),
        contextoPortal,
        trx,
      ),
    ).rejects.toMatchObject({
      razon: 'fecha-anterior',
      message:
        'La fecha del pago no puede ser anterior a la nota más vieja que marcaste (2026-08-03).',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });

  it('el mismo dia que la palomeada mas vieja si se acepta', async () => {
    const { servicio } = tresNotas();
    await expect(
      servicio.registrarPago(
        pago({ fechaPago: '2026-08-03' }),
        contextoPortal,
        trx,
      ),
    ).resolves.toMatchObject({ saldoFavorCentavos: 0 });
  });
});

describe('CobranzasService.planearPago (vista previa, T-21)', () => {
  it('da el mismo reparto que registrarPago sin escribir nada', async () => {
    const { servicio, repo } = tresNotas();
    const plan = await servicio.planearPago(
      { clienteId: CLIENTE, notaIds: [C, B], montoCentavos: 12000 },
      trx,
    );
    expect(plan.aplicaciones.map((a) => [a.notaId, a.montoCentavos])).toEqual([
      [B, 8000],
      [C, 4000],
    ]);
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.actualizarStatusNota).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('tambien rechaza una palomeada sin saldo', async () => {
    const { servicio } = montar({
      bloqueadas: [bloqueada(B, '2026-08-03', '80.00', { status: 'pagada' })],
      abonado: new Map([[B, '80.00']]),
    });
    await expect(
      servicio.planearPago(
        { clienteId: CLIENTE, notaIds: [B], montoCentavos: 100 },
        trx,
      ),
    ).rejects.toMatchObject({ razon: 'nota-sin-saldo' });
  });
});

describe('CobranzasService.aplicarSaldoFavor (T-21)', () => {
  it('reparte solo entre las palomeadas, con metodo y origen saldo_favor, y deja el movimiento negativo', async () => {
    const { servicio, repo } = tresNotas(['150.00']);

    const plan = await servicio.aplicarSaldoFavor(
      { clienteId: CLIENTE, notaIds: [A, B], montoCentavos: 12000 },
      contextoPortal,
      trx,
    );

    expect(
      plan.aplicaciones.map((a) => [a.notaId, a.montoCentavos, a.status]),
    ).toEqual([
      [A, 10000, 'pagada'],
      [B, 2000, 'abonado'],
    ]);
    expect(plan.saldoFavorCentavos).toBe(0);
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      1,
      {
        ventaNotaId: A,
        vendedorId: null,
        fechaPago: '2026-10-07',
        fechaOperacion: '2026-10-07',
        monto: '100.00',
        tipo: 'cobranza',
        saldoPendiente: '0.00',
        metodoPago: 'saldo_favor',
        origen: 'saldo_favor',
        capturoUsuarioId: 'usuario-1',
      },
      trx,
    );
    expect(repo.actualizarStatusNota).not.toHaveBeenCalledWith(
      C,
      expect.anything(),
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledTimes(1);
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: null,
        monto: '-120.00',
        origen: 'aplicacion',
        fechaOperacion: '2026-10-07',
        capturoUsuarioId: 'usuario-1',
      },
      trx,
    );
  });

  it('bloquea el saldo a favor DESPUES de las notas: mismo orden de candados que el cobro', async () => {
    const { servicio, repo } = tresNotas(['150.00']);
    await servicio.aplicarSaldoFavor(
      { clienteId: CLIENTE, notaIds: [A], montoCentavos: 1000 },
      contextoPortal,
      trx,
    );
    expect(repo.bloquearSaldoFavor).toHaveBeenCalledWith(CLIENTE, trx);
    expect(
      repo.bloquearNotasDelCliente.mock.invocationCallOrder[0],
    ).toBeLessThan(repo.bloquearSaldoFavor.mock.invocationCallOrder[0]);
  });

  it('Review Focus 3: mas saldo a favor del que hay se rechaza y no se graba nada', async () => {
    const { servicio, repo } = tresNotas(['100.00', '-30.00']);
    await expect(
      servicio.aplicarSaldoFavor(
        { clienteId: CLIENTE, notaIds: [A, B], montoCentavos: 8000 },
        contextoPortal,
        trx,
      ),
    ).rejects.toMatchObject({
      razon: 'saldo-favor-insuficiente',
      message: 'El cliente solo tiene $70.00 de saldo a favor.',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('Review Focus 3: mas de lo que deben las palomeadas se rechaza (no se mueve saldo a favor a saldo a favor)', async () => {
    const { servicio, repo } = tresNotas(['500.00']);
    await expect(
      servicio.aplicarSaldoFavor(
        { clienteId: CLIENTE, notaIds: [B], montoCentavos: 9000 },
        contextoPortal,
        trx,
      ),
    ).rejects.toMatchObject({
      razon: 'excede-lo-que-deben',
      message:
        'Las notas marcadas solo deben $80.00: no se puede aplicar más saldo a favor que eso.',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });

  it('planearSaldoFavor da el mismo plan sin escribir', async () => {
    const { servicio, repo } = tresNotas(['150.00']);
    const plan = await servicio.planearSaldoFavor(
      { clienteId: CLIENTE, notaIds: [A, B], montoCentavos: 12000 },
      trx,
    );
    expect(plan.aplicaciones.map((a) => a.notaId)).toEqual([A, B]);
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });
});
```

Run: `npm test --workspace=apps/backend -- cobranzas.service`
Expected: FAIL (no compila: faltan `PagoEnNotas`, `registrarPago`, `bloquearSaldoFavor`, `numNota`…).

- [ ] **Paso 6: Implementar el repositorio**

`apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts` queda así (el resto de métodos igual que
en la Tarea 1):

a) `NotaBloqueada` gana, después de `folio: string;`:

```ts
  /** `null` si no hubo nota de papel. Solo para pintar la vista previa (T-21). */
  numNota: string | null;
```

b) Después de `NotaBloqueada`, agrega:

```ts
/** Como se pago un abono: un metodo del catalogo o, al aplicar saldo a favor, `saldo_favor` (T-21). */
export type MetodoAbono = MetodoPago | 'saldo_favor';
```

c) `NuevoAbono` y `NuevoSaldoFavor` quedan:

```ts
/** Una fila de `cobranza_abono` lista para escribir. El dinero ya viene como texto (`aPesos`). */
export interface NuevoAbono {
  ventaNotaId: string;
  /** `null` = Oficina: el cobro de contado de una venta de Oficina (T-17) o un cobro del portal (T-21). */
  vendedorId: string | null;
  fechaPago: string;
  fechaOperacion: string;
  monto: string;
  tipo: TipoAbono;
  saldoPendiente: string;
  metodoPago: MetodoAbono;
  origen: 'cobro' | 'venta_contado' | 'saldo_favor';
  /** Quien lo capturo en el portal (T-21). La tablet y la venta no lo ponen (queda null). */
  capturoUsuarioId?: string | null;
}

export interface NuevoSaldoFavor {
  clienteId: string;
  vendedorId: string | null;
  /** Texto `numeric`: positivo si es excedente, negativo si es aplicacion (T-21). */
  monto: string;
  origen: 'excedente_cobro' | 'aplicacion';
  fechaOperacion: string;
  capturoUsuarioId: string | null;
}
```

d) `bloquearNotasDelCliente` queda:

```ts
  /**
   * Bloquea `for update`, en orden de `id`, las notas que pueden recibir dinero
   * y las elegidas (D13; T-21: una o varias).
   *
   * El orden fijo es lo que evita el deadlock entre dos cobros del mismo
   * cliente; si aun asi Postgres elige victima, `reintentarAnteConflicto`
   * repite la operacion entera (tablet) o el portal responde 409. Con READ
   * COMMITTED, las consultas que siguen al candado ya ven los abonos que el
   * otro cobro confirmo. Una elegida de OTRO cliente no sale (filtro por
   * cliente): quien llama lo detecta.
   */
  async bloquearNotasDelCliente(
    clienteId: string,
    notaElegidaIds: readonly string[],
    trx: Transaction<DB>,
  ): Promise<NotaBloqueada[]> {
    const filas = await sql<{
      id: string;
      fecha: string;
      folio: string;
      num_nota: string | null;
      status: string;
      borrada: boolean;
      monto_total: string;
    }>`
      select id, to_char(fecha, 'YYYY-MM-DD') as fecha, folio, num_nota, status,
             deleted_at is not null as borrada, monto_total
        from venta_nota
       where cliente_id = ${clienteId}
         and ((status in ('pendiente', 'abonado') and deleted_at is null)
              or id = any(${[...notaElegidaIds]}::uuid[]))
       order by id
         for update
    `.execute(trx);

    return filas.rows.map((f) => ({
      id: f.id,
      fecha: f.fecha,
      folio: f.folio,
      numNota: f.num_nota,
      status: f.status,
      borrada: f.borrada,
      montoTotal: f.monto_total,
    }));
  }
```

e) En `insertarAbono`, en el `values`, agrega `capturo_usuario_id: abono.capturoUsuarioId ?? null,`. En
`insertarSaldoFavor`, cambia `origen: 'excedente_cobro',` por `origen: movimiento.origen,` y agrega
`capturo_usuario_id: movimiento.capturoUsuarioId,`; cambia su comentario por
`/** Movimiento de saldo a favor (D5; T-21: tambien la aplicacion, negativa) y \`updated_at\` del cliente, para que el pull incremental le baje el saldo nuevo a la tablet (D12). */`.

f) Al final de la clase, agrega:

```ts
  /**
   * Bloquea `for update` los movimientos vivos de saldo a favor del cliente y
   * devuelve sus montos (texto `numeric`). Se llama DESPUES de bloquear sus
   * notas, como el cobro: mismo orden de candados, sin abrazo mortal (T-21).
   * Un excedente que entre a la vez solo SUBE el saldo: no hace falta frenarlo.
   */
  async bloquearSaldoFavor(
    clienteId: string,
    trx: Transaction<DB>,
  ): Promise<string[]> {
    const filas = await sql<{ monto: string }>`
      select monto
        from saldo_favor_movimiento
       where cliente_id = ${clienteId}
         and deleted_at is null
       order by id
         for update
    `.execute(trx);
    return filas.rows.map((f) => f.monto);
  }
```

- [ ] **Paso 7: Implementar el servicio**

`apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts` (reemplázalo entero):

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { aCentavos, aPesos } from '../sincronizacion/dinero';
import { CobranzaRechazada } from './cobranza-rechazada';
import {
  CobranzasRepository,
  type MetodoAbono,
  type NotaBloqueada,
} from './cobranzas.repository';
import type { CobranzaNormalizada, MetodoPago } from './datos-cobranza';
import {
  MOTIVO_NOTA_AJENA,
  PagoRechazado,
  motivoExcedeLoQueDeben,
  motivoFechaAnterior,
  motivoNotaSinSaldo,
  motivoSaldoFavorInsuficiente,
} from './pago-rechazado';
import {
  esCobrable,
  repartirPagoEnNotas,
  saldoDerivadoCentavos,
  type NotaParaReparto,
  type Reparto,
} from './reglas-cobranza';

/**
 * Quien y cuando (D13). **Sin folio**: la cobranza no lleva folio (cliente,
 * 2026-10-07).
 *
 * - Tablet: `vendedorId` es el de la sesion y `usuarioId` null.
 * - Portal (T-21): `vendedorId` es el cobrador elegido (`null` = Oficina) y
 *   `usuarioId` quien capturo.
 */
export interface ContextoCobranza {
  sucursalId: string;
  fechaOperacion: string;
  vendedorId: string | null;
  usuarioId: string | null;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadCobranza {
  tabla: 'cobranza_abono' | 'saldo_favor_movimiento';
  id: string;
}

/** Las notas que palomeo la oficina y cuanto (T-21). Sin repetir, en minusculas. */
export interface NotasAPagar {
  clienteId: string;
  notaIds: string[];
  montoCentavos: number;
}

/** Un pago del portal: las notas y el monto, mas como y cuando se pago. */
export interface PagoEnNotas extends NotasAPagar {
  metodoPago: MetodoPago;
  fechaPago: string;
}

/** Lo que el pago deja en una nota, con lo necesario para pintarlo (T-21). */
export interface AplicacionDeCobro {
  notaId: string;
  folio: string;
  numNota: string | null;
  fecha: string;
  montoCentavos: number;
  saldoAntesCentavos: number;
  saldoDespuesCentavos: number;
  status: 'pagada' | 'abonado';
  /** `true` si la oficina la palomeo; `false` si le toco del excedente. */
  palomeada: boolean;
}

/** La vista previa y lo que se grabo: el mismo calculo (§3.3). */
export interface PlanDeCobro {
  aplicaciones: AplicacionDeCobro[];
  /** Lo que iria (o fue) a saldo a favor. Siempre 0 al aplicar saldo a favor. */
  saldoFavorCentavos: number;
}

/** Las notas del cliente ya bloqueadas, con su saldo derivado (D7). */
interface NotasConSaldo {
  bloqueadas: NotaBloqueada[];
  paraReparto: NotaParaReparto[];
}

/** Una palomeada ya comprobada sobre la fila bloqueada. */
interface Palomeada {
  nota: NotaBloqueada;
  saldoCentavos: number;
}

/** Como se escriben las filas de un reparto. */
interface FormaDelAbono {
  fechaPago: string;
  metodoPago: MetodoAbono;
  origen: 'cobro' | 'saldo_favor';
}

/**
 * La cobranza: **una regla, un sitio** (ADR-0009). La tablet entra por el
 * `push` con una nota (`registrarCobranza`); el portal (T-21) entra por
 * `CobranzasPortalService` con una o varias (`registrarPago`,
 * `aplicarSaldoFavor`). Las dos rutas reparten con `repartirPagoEnNotas` y
 * escriben con `escribir`.
 */
@Injectable()
export class CobranzasService {
  constructor(private readonly repo: CobranzasRepository) {}

  /**
   * Registra un cobro de la tablet cuya forma ya valido
   * `normalizarDatosCobranza`, dentro de la transaccion de quien llama.
   *
   * Reparte el monto (D1): la nota elegida, las otras notas cobrables del
   * cliente por fecha y folio, y el resto a saldo a favor. Una nota elegida ya
   * pagada, de cuenta perdida o borrada no se rechaza (D9).
   *
   * Devuelve la primera fila `cobranza_abono` creada o, si todo quedo a favor,
   * el movimiento de saldo a favor.
   *
   * @throws {CobranzaRechazada} `nota-no-encontrada` (D10). No escribe nada antes de lanzar.
   */
  async registrarCobranza(
    cobranza: CobranzaNormalizada,
    contexto: ContextoCobranza,
    trx: Transaction<DB>,
  ): Promise<EntidadCobranza> {
    const nota = await this.repo.notaParaCobro(cobranza.ventaNotaId, trx);
    if (
      !nota ||
      nota.sucursalId !== contexto.sucursalId ||
      nota.clienteId !== cobranza.clienteId
    ) {
      throw new CobranzaRechazada({
        razon: 'nota-no-encontrada',
        motivo: `La nota ${cobranza.ventaNotaId} no existe o no es de este cliente.`,
      });
    }

    const notaIds = [cobranza.ventaNotaId];
    // D13: primero el candado, despues los saldos.
    const { paraReparto } = await this.bloquear(
      cobranza.clienteId,
      notaIds,
      trx,
    );
    const reparto = repartirPagoEnNotas(
      cobranza.montoCentavos,
      notaIds,
      paraReparto,
    );
    const entidad = await this.escribir(
      reparto,
      cobranza.clienteId,
      {
        fechaPago: cobranza.fechaPago,
        metodoPago: cobranza.metodoPago,
        origen: 'cobro',
      },
      contexto,
      trx,
    );
    // repartirPagoEnNotas no admite montos <= 0: si llega aqui, algo se rompio arriba.
    if (entidad === null)
      throw new Error('registrarCobranza no escribio ninguna fila.');
    return entidad;
  }

  /**
   * La vista previa de un pago del portal (§3.3): mismas notas bloqueadas, mismas
   * comprobaciones y mismo reparto que `registrarPago`, sin escribir nada.
   *
   * @throws {PagoRechazado} `nota-ajena` o `nota-sin-saldo`.
   */
  async planearPago(
    pago: NotasAPagar,
    trx: Transaction<DB>,
  ): Promise<PlanDeCobro> {
    const notas = await this.bloquear(pago.clienteId, pago.notaIds, trx);
    this.exigirPalomeadas(pago.notaIds, notas);
    return this.plan(
      repartirPagoEnNotas(pago.montoCentavos, pago.notaIds, notas.paraReparto),
      notas.bloqueadas,
      pago.notaIds,
    );
  }

  /**
   * Registra un pago del portal sobre una o varias notas (T-21). A diferencia
   * de la tablet, una palomeada que ya no tiene saldo SI se rechaza: la oficina
   * tiene la pantalla enfrente y vuelve a cargar. Se decide sobre las filas
   * bloqueadas, nunca sobre lo que la pantalla leyo antes (lección de T-19).
   *
   * @throws {PagoRechazado} `nota-ajena`, `nota-sin-saldo` o `fecha-anterior`.
   * No escribe nada antes de lanzar.
   */
  async registrarPago(
    pago: PagoEnNotas,
    contexto: ContextoCobranza,
    trx: Transaction<DB>,
  ): Promise<PlanDeCobro> {
    const notas = await this.bloquear(pago.clienteId, pago.notaIds, trx);
    const palomeadas = this.exigirPalomeadas(pago.notaIds, notas);

    const masVieja = palomeadas.map((p) => p.nota.fecha).sort()[0];
    if (masVieja !== undefined && pago.fechaPago < masVieja) {
      throw new PagoRechazado('fecha-anterior', motivoFechaAnterior(masVieja));
    }

    const reparto = repartirPagoEnNotas(
      pago.montoCentavos,
      pago.notaIds,
      notas.paraReparto,
    );
    await this.escribir(
      reparto,
      pago.clienteId,
      { fechaPago: pago.fechaPago, metodoPago: pago.metodoPago, origen: 'cobro' },
      contexto,
      trx,
    );
    return this.plan(reparto, notas.bloqueadas, pago.notaIds);
  }

  /**
   * La vista previa de aplicar saldo a favor: mismas comprobaciones y mismo
   * reparto que `aplicarSaldoFavor`, sin escribir nada.
   *
   * @throws {PagoRechazado} `nota-ajena`, `nota-sin-saldo`,
   * `saldo-favor-insuficiente` o `excede-lo-que-deben`.
   */
  async planearSaldoFavor(
    pago: NotasAPagar,
    trx: Transaction<DB>,
  ): Promise<PlanDeCobro> {
    const { reparto, bloqueadas } = await this.repartirSaldoFavor(pago, trx);
    return this.plan(reparto, bloqueadas, pago.notaIds);
  }

  /**
   * Aplica saldo a favor a las palomeadas (§3.4). No es dinero nuevo: las filas
   * llevan metodo y origen `saldo_favor` y sin cobrador, el dia es el de hoy, y
   * el libro de saldo a favor gana un movimiento NEGATIVO `aplicacion`. Sin
   * excedente: lo que no deban las palomeadas no se mueve.
   *
   * @throws {PagoRechazado} como `planearSaldoFavor`. No escribe nada antes de lanzar.
   */
  async aplicarSaldoFavor(
    pago: NotasAPagar,
    contexto: ContextoCobranza,
    trx: Transaction<DB>,
  ): Promise<PlanDeCobro> {
    const { reparto, bloqueadas } = await this.repartirSaldoFavor(pago, trx);
    await this.escribir(
      reparto,
      pago.clienteId,
      {
        fechaPago: contexto.fechaOperacion,
        metodoPago: 'saldo_favor',
        origen: 'saldo_favor',
      },
      contexto,
      trx,
    );
    await this.repo.insertarSaldoFavor(
      {
        clienteId: pago.clienteId,
        vendedorId: null,
        monto: aPesos(-pago.montoCentavos),
        origen: 'aplicacion',
        fechaOperacion: contexto.fechaOperacion,
        capturoUsuarioId: contexto.usuarioId,
      },
      trx,
    );
    return this.plan(reparto, bloqueadas, pago.notaIds);
  }

  /* ---------------------------------------------------------------- */

  /** D13: primero el candado de las notas, despues lo abonado. */
  private async bloquear(
    clienteId: string,
    notaIds: readonly string[],
    trx: Transaction<DB>,
  ): Promise<NotasConSaldo> {
    const bloqueadas = await this.repo.bloquearNotasDelCliente(
      clienteId,
      notaIds,
      trx,
    );
    const abonado = await this.repo.abonadoPorNota(
      bloqueadas.map((n) => n.id),
      trx,
    );
    return {
      bloqueadas,
      paraReparto: bloqueadas.map((n) => ({
        id: n.id,
        fecha: n.fecha,
        folio: n.folio,
        cobrable: esCobrable(n.status, n.borrada),
        saldoCentavos: saldoDerivadoCentavos(
          aCentavos(n.montoTotal),
          aCentavos(abonado.get(n.id)),
        ),
      })),
    };
  }

  /** Cada palomeada tiene que estar entre las bloqueadas, cobrable y con saldo. */
  private exigirPalomeadas(
    notaIds: readonly string[],
    { bloqueadas, paraReparto }: NotasConSaldo,
  ): Palomeada[] {
    const porId = new Map(bloqueadas.map((n) => [n.id, n]));
    const saldos = new Map(paraReparto.map((n) => [n.id, n]));
    return notaIds.map((id) => {
      const nota = porId.get(id);
      const reparto = saldos.get(id);
      if (!nota || !reparto)
        throw new PagoRechazado('nota-ajena', MOTIVO_NOTA_AJENA);
      if (!reparto.cobrable || reparto.saldoCentavos <= 0)
        throw new PagoRechazado(
          'nota-sin-saldo',
          motivoNotaSinSaldo(nota.folio),
        );
      return { nota, saldoCentavos: reparto.saldoCentavos };
    });
  }

  /** Bloquea notas y saldo a favor (en ese orden), valida y reparte solo entre las palomeadas. */
  private async repartirSaldoFavor(
    pago: NotasAPagar,
    trx: Transaction<DB>,
  ): Promise<{ reparto: Reparto; bloqueadas: NotaBloqueada[] }> {
    const notas = await this.bloquear(pago.clienteId, pago.notaIds, trx);
    const palomeadas = this.exigirPalomeadas(pago.notaIds, notas);

    const disponible = (
      await this.repo.bloquearSaldoFavor(pago.clienteId, trx)
    ).reduce((total, monto) => total + aCentavos(monto), 0);
    if (pago.montoCentavos > disponible) {
      throw new PagoRechazado(
        'saldo-favor-insuficiente',
        motivoSaldoFavorInsuficiente(Math.max(0, disponible)),
      );
    }

    const deben = palomeadas.reduce((t, p) => t + p.saldoCentavos, 0);
    if (pago.montoCentavos > deben) {
      throw new PagoRechazado(
        'excede-lo-que-deben',
        motivoExcedeLoQueDeben(deben),
      );
    }

    const elegidas = new Set(pago.notaIds);
    const reparto = repartirPagoEnNotas(
      pago.montoCentavos,
      pago.notaIds,
      notas.paraReparto.filter((n) => elegidas.has(n.id)),
    );
    return { reparto, bloqueadas: notas.bloqueadas };
  }

  /**
   * Las filas `cobranza_abono` del reparto, el status de cada nota (se escribe
   * aunque no cambie: el trigger le toca `updated_at` y el pull la ve, D12) y,
   * si sobra, el excedente a saldo a favor. Devuelve la primera fila escrita.
   */
  private async escribir(
    reparto: Reparto,
    clienteId: string,
    forma: FormaDelAbono,
    contexto: ContextoCobranza,
    trx: Transaction<DB>,
  ): Promise<EntidadCobranza | null> {
    let primera: string | null = null;
    for (const a of reparto.aplicaciones) {
      const id = await this.repo.insertarAbono(
        {
          ventaNotaId: a.notaId,
          vendedorId: contexto.vendedorId,
          fechaPago: forma.fechaPago,
          fechaOperacion: contexto.fechaOperacion,
          monto: aPesos(a.montoCentavos),
          tipo: a.tipo,
          // La foto del saldo tras esta fila (D7); nunca se lee como fuente.
          saldoPendiente: aPesos(a.saldoDespuesCentavos),
          metodoPago: forma.metodoPago,
          origen: forma.origen,
          capturoUsuarioId: contexto.usuarioId,
        },
        trx,
      );
      primera ??= id;
      await this.repo.actualizarStatusNota(a.notaId, a.status, trx);
    }

    let movimiento: string | null = null;
    if (reparto.saldoFavorCentavos > 0) {
      movimiento = await this.repo.insertarSaldoFavor(
        {
          clienteId,
          vendedorId: contexto.vendedorId,
          monto: aPesos(reparto.saldoFavorCentavos),
          origen: 'excedente_cobro',
          fechaOperacion: contexto.fechaOperacion,
          capturoUsuarioId: contexto.usuarioId,
        },
        trx,
      );
    }

    if (primera !== null) return { tabla: 'cobranza_abono', id: primera };
    if (movimiento !== null)
      return { tabla: 'saldo_favor_movimiento', id: movimiento };
    return null;
  }

  /** El reparto con folio, # de nota y fecha de cada nota, para la pantalla. */
  private plan(
    reparto: Reparto,
    bloqueadas: NotaBloqueada[],
    notaIds: readonly string[],
  ): PlanDeCobro {
    const porId = new Map(bloqueadas.map((n) => [n.id, n]));
    const elegidas = new Set(notaIds);
    return {
      aplicaciones: reparto.aplicaciones.map((a) => {
        const nota = porId.get(a.notaId);
        return {
          notaId: a.notaId,
          folio: nota?.folio ?? a.notaId,
          numNota: nota?.numNota ?? null,
          fecha: nota?.fecha ?? '',
          montoCentavos: a.montoCentavos,
          saldoAntesCentavos: a.saldoAntesCentavos,
          saldoDespuesCentavos: a.saldoDespuesCentavos,
          status: a.status,
          palomeada: elegidas.has(a.notaId),
        };
      }),
      saldoFavorCentavos: reparto.saldoFavorCentavos,
    };
  }
}
```

Run: `npm test --workspace=apps/backend -- cobranzas.service reglas-cobranza pago-rechazado && npm run build --workspace=apps/backend`
Expected: PASS y compila (`sincronizacion.service.ts` sigue pasando `vendedorId: vendedor.id`, que es `string`).

- [ ] **Paso 8: Un abono de saldo a favor también bloquea la edición de la venta**

e2e primero. En `apps/backend/test/ventas-editar.e2e-spec.ts`, agrega un `describe` de nivel superior
(fuera de los demás) al final del archivo, antes del cierre del `describe` principal:

```ts
  describe('abono de saldo a favor (T-21)', () => {
    it('una venta con un abono de saldo a favor no se edita ni se elimina, como con cualquier cobro', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: v.id,
          vendedor_id: null,
          fecha_pago: FECHA_EDICION,
          fecha_operacion: FECHA_EDICION,
          monto: '70.00',
          tipo: 'abono',
          saldo_pendiente: '200.00',
          metodo_pago: 'saldo_favor',
          origen: 'saldo_favor',
          capturo_usuario_id: usuarioGeneralId,
        })
        .execute();
      await db
        .updateTable('venta_nota')
        .set({ status: 'abonado' })
        .where('id', '=', v.id)
        .execute();

      const venta = (await detalle(cookieGeneral, v.id).expect(200))
        .body as VentaDetalle;
      expect(venta).toMatchObject({
        editable: false,
        motivoNoEditable: MOTIVO_CON_COBROS,
      });
      const res = await request(app.getHttpServer())
        .delete(`/ventas/${v.id}`)
        .set('Cookie', cookieGeneral)
        .expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Tiene cobros registrados: no se puede eliminar.',
      );
    });
  });
```

Run: `npm run test:e2e --workspace=apps/backend -- ventas-editar`
Expected: FAIL en la prueba nueva (`editable: true` y `DELETE` 200: solo se cuenta `origen = 'cobro'`).

Ahora el código:

`ventas-edicion.repository.ts`, en `abonosDeCobroVivos`, cambia `.where('origen', '=', 'cobro')` por

```ts
      // T-21: un abono de saldo a favor tambien es un cobro: la venta no se edita.
      .where('origen', 'in', ['cobro', 'saldo_favor'])
```

`ventas-consulta.repository.ts`: en `CobroDeVenta`, `origen: 'cobro' | 'venta_contado';` pasa a
`origen: 'cobro' | 'venta_contado' | 'saldo_favor';`.

`ventas-consulta.service.ts`, en `completar`, cambia
`const deCobranza = cobros.filter((c) => c.origen === 'cobro').length;` por

```ts
    // El de contado lo reescribe la edicion; cobro y saldo a favor (T-21) no.
    const deCobranza = cobros.filter((c) => c.origen !== 'venta_contado').length;
```

`acciones-venta.ts`, en el comentario de `accionesDeVenta`, cambia
`@param abonosDeCobroVivos abonos vivos con \`origen = 'cobro'\`.` por
`@param abonosDeCobroVivos abonos vivos con \`origen\` \`cobro\` o \`saldo_favor\` (T-21).`

Run: `npm run test:e2e --workspace=apps/backend -- ventas-editar && npm test --workspace=apps/backend`
Expected: PASS.

- [ ] **Paso 9: Lint y commit**

Run: `npm run lint --workspace=apps/backend && npm run lint --workspace=apps/tablet`
Expected: sin errores.

```bash
git add apps/backend/src/modules/ventas-cobranza apps/backend/test/ventas-editar.e2e-spec.ts \
  apps/tablet/src/datos/cobranzas-reglas.ts
git commit -m "T-21: repartirPagoEnNotas y CobranzasService para el portal (pago y saldo a favor)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarea 5: Los endpoints `/cobranzas` del portal

**Archivos:**
- Crear: `apps/backend/src/modules/ventas-cobranza/dto/cobranzas.dto.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/cobranzas-portal.repository.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/cobranzas-portal.service.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/cobranzas-portal.service.spec.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/cobranzas.controller.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`
- Crear: `apps/backend/test/cobranzas-portal.e2e-spec.ts`

**Interfaces:**
- Consume: Tarea 4 (`CobranzasService.planearPago/registrarPago/planearSaldoFavor/aplicarSaldoFavor`,
  `PlanDeCobro`, `AplicacionDeCobro`, `PagoRechazado`, `RazonPagoRechazado`); `VentasPortalRepository`
  (`buscarSucursalUsuario`, `enTransaccion`, `esRepartidorActivo`); `exigirAlcanceSobre`; `resolverAlcance`,
  `normalizarSucursalPedida`; `esFechaReal` (`venta-portal.ts`); `hoyEnTijuana`; `esConflictoDeConcurrencia`;
  `MAX_CENTAVOS_COBRO`, `METODOS_PAGO` (`datos-cobranza.ts`); `LARGO_MAX_NUM_NOTA` (`datos-venta.ts`).
- Produce (los copia el portal en la Tarea 6):

```ts
// cobranzas-portal.repository.ts
export type OrigenAbono = 'cobro' | 'venta_contado' | 'saldo_favor';
export interface AbonoAnterior { fechaPago: string; montoCentavos: number; metodoPago: string; origen: OrigenAbono }
export interface NotaPorCobrar {
  id: string; folio: string; numNota: string | null; fecha: string;
  clienteId: string; cliente: string; sucursalCodigo: string;
  montoCentavos: number; saldoCentavos: number; status: 'pendiente' | 'abonado';
  abonos: AbonoAnterior[];
}
export interface ClienteParaCobro { id: string; nombre: string; sucursalId: string; sucursalCodigo: string }

// cobranzas-portal.service.ts
export interface ClientePorCobrar extends ClienteParaCobro { saldoFavorCentavos: number; notas: NotaPorCobrar[] }
export interface CobroRegistrado extends PlanDeCobro { cliente: string; montoCentavos: number }
```

- [ ] **Paso 1: Pruebas unitarias del servicio del portal (fallan)**

`apps/backend/src/modules/ventas-cobranza/cobranzas-portal.service.spec.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import type { CobranzasPortalRepository } from './cobranzas-portal.repository';
import {
  CobranzasPortalService,
  MOTIVO_COBRADOR_INVALIDO,
  MOTIVO_FECHA_FUTURA,
  MOTIVO_INTERBLOQUEO_COBRO,
  MOTIVO_UN_FILTRO,
} from './cobranzas-portal.service';
import type { CobranzasService, PlanDeCobro } from './cobranzas.service';
import type {
  PorCobrarDto,
  RegistrarCobroDto,
  VistaPreviaCobroDto,
} from './dto/cobranzas.dto';
import { PagoRechazado } from './pago-rechazado';
import type { VentasPortalRepository } from './ventas-portal.repository';

const trx = {} as Transaction<DB>;
const CLIENTE = {
  id: 'cliente-1',
  nombre: 'Cobach XXI',
  sucursalId: 'suc-tj',
  sucursalCodigo: 'TJ',
};
const PLAN: PlanDeCobro = { aplicaciones: [], saldoFavorCentavos: 0 };

function montar(
  opciones: {
    usuarioCodigo?: string | null;
    esRepartidor?: boolean;
    error?: unknown;
    cliente?: typeof CLIENTE | undefined;
  } = {},
) {
  const cobranzas = {
    planearPago: jest.fn().mockResolvedValue(PLAN),
    registrarPago:
      'error' in opciones
        ? jest.fn().mockRejectedValue(opciones.error)
        : jest.fn().mockResolvedValue(PLAN),
    planearSaldoFavor: jest.fn().mockResolvedValue(PLAN),
    aplicarSaldoFavor: jest.fn().mockResolvedValue(PLAN),
  };
  const repo = {
    clienteParaCobro: jest
      .fn()
      .mockResolvedValue('cliente' in opciones ? opciones.cliente : CLIENTE),
    notasPorCobrar: jest.fn().mockResolvedValue([]),
    saldoFavorCentavos: jest.fn().mockResolvedValue(1250),
  };
  const portal = {
    buscarSucursalUsuario: jest.fn().mockResolvedValue({
      id: null,
      codigo: opciones.usuarioCodigo ?? null,
    }),
    enTransaccion: jest
      .fn()
      .mockImplementation((tarea: (t: Transaction<DB>) => Promise<unknown>) =>
        tarea(trx),
      ),
    esRepartidorActivo: jest
      .fn()
      .mockResolvedValue(opciones.esRepartidor ?? true),
  };
  const servicio = new CobranzasPortalService(
    cobranzas as unknown as CobranzasService,
    repo as unknown as CobranzasPortalRepository,
    portal as unknown as VentasPortalRepository,
  );
  return { servicio, cobranzas, repo, portal };
}

const cuerpo = (extra: Partial<RegistrarCobroDto> = {}): RegistrarCobroDto =>
  ({
    clienteId: 'CLIENTE-1',
    notaIds: ['NOTA-B', 'nota-a', 'nota-b'],
    montoCentavos: 150000,
    fechaPago: '2026-10-01',
    metodoPago: 'transferencia',
    vendedorId: null,
    ...extra,
  }) as RegistrarCobroDto;

describe('CobranzasPortalService.registrar', () => {
  it('pasa ids en minusculas y sin repetir, Oficina, quien capturo y hoy en Tijuana', async () => {
    const { servicio, cobranzas } = montar();
    await expect(servicio.registrar('usuario-1', cuerpo())).resolves.toEqual({
      cliente: 'Cobach XXI',
      montoCentavos: 150000,
      ...PLAN,
    });
    expect(cobranzas.registrarPago).toHaveBeenCalledWith(
      {
        clienteId: 'cliente-1',
        notaIds: ['nota-b', 'nota-a'],
        montoCentavos: 150000,
        metodoPago: 'transferencia',
        fechaPago: '2026-10-01',
      },
      {
        sucursalId: 'suc-tj',
        fechaOperacion: hoyEnTijuana(),
        vendedorId: null,
        usuarioId: 'usuario-1',
      },
      trx,
    );
  });

  it('con un repartidor activo de la sucursal del cliente, el cobro es suyo', async () => {
    const { servicio, cobranzas, portal } = montar();
    await servicio.registrar('usuario-1', cuerpo({ vendedorId: 'VEN-1' }));
    expect(portal.esRepartidorActivo).toHaveBeenCalledWith('ven-1', 'suc-tj', trx);
    expect(cobranzas.registrarPago).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ vendedorId: 'ven-1' }),
      trx,
    );
  });

  it('un cobrador que no es repartidor activo de esa sucursal es 400 y no se cobra', async () => {
    const { servicio, cobranzas } = montar({ esRepartidor: false });
    const error: unknown = await servicio
      .registrar('usuario-1', cuerpo({ vendedorId: 'ven-x' }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toBe(MOTIVO_COBRADOR_INVALIDO);
    expect(cobranzas.registrarPago).not.toHaveBeenCalled();
  });

  it('Review Focus 2: una fecha futura es 400 antes de abrir la transaccion', async () => {
    const { servicio, portal } = montar();
    await expect(
      servicio.registrar('usuario-1', cuerpo({ fechaPago: '2999-12-31' })),
    ).rejects.toThrow(MOTIVO_FECHA_FUTURA);
    expect(portal.enTransaccion).not.toHaveBeenCalled();
  });

  it('una fecha que no existe es 400', async () => {
    const { servicio } = montar();
    await expect(
      servicio.registrar('usuario-1', cuerpo({ fechaPago: '2026-02-30' })),
    ).rejects.toThrow('Esa fecha no existe.');
  });

  it('un rechazo del dominio por la base sale como 409; uno por la fecha, como 400', async () => {
    const sinSaldo = montar({
      error: new PagoRechazado(
        'nota-sin-saldo',
        'La nota TJ261001AP03 ya no tiene saldo; vuelve a cargar.',
      ),
    });
    const e1: unknown = await sinSaldo.servicio
      .registrar('usuario-1', cuerpo())
      .catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ConflictException);
    expect((e1 as Error).message).toBe(
      'La nota TJ261001AP03 ya no tiene saldo; vuelve a cargar.',
    );

    const fecha = montar({
      error: new PagoRechazado('fecha-anterior', 'La fecha del pago …'),
    });
    await expect(
      fecha.servicio.registrar('usuario-1', cuerpo()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un interbloqueo (40P01) o una serializacion (40001) es 409 con su mensaje, nunca 500', async () => {
    for (const code of ['40P01', '40001']) {
      const { servicio } = montar({ error: Object.assign(new Error('x'), { code }) });
      const error: unknown = await servicio
        .registrar('usuario-1', cuerpo())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toBe(MOTIVO_INTERBLOQUEO_COBRO);
    }
  });

  it('un usuario de MX sobre un cliente de TJ es 403; un cliente que no existe, 404', async () => {
    await expect(
      montar({ usuarioCodigo: 'MX' }).servicio.registrar('usuario-1', cuerpo()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      montar({ cliente: undefined }).servicio.registrar('usuario-1', cuerpo()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CobranzasPortalService.vistaPrevia y aplicarSaldoFavor', () => {
  it('la vista previa elige la regla por modo', async () => {
    const { servicio, cobranzas } = montar();
    const base = { clienteId: 'cliente-1', notaIds: ['a'], montoCentavos: 100 };
    await servicio.vistaPrevia('u', { ...base, modo: 'pago' } as VistaPreviaCobroDto);
    await servicio.vistaPrevia('u', { ...base, modo: 'saldo_favor' } as VistaPreviaCobroDto);
    expect(cobranzas.planearPago).toHaveBeenCalledWith(base, trx);
    expect(cobranzas.planearSaldoFavor).toHaveBeenCalledWith(base, trx);
  });

  it('aplicar saldo a favor va sin cobrador, con quien capturo y hoy', async () => {
    const { servicio, cobranzas } = montar();
    await expect(
      servicio.aplicarSaldoFavor('usuario-1', {
        clienteId: 'cliente-1',
        notaIds: ['a', 'a'],
        montoCentavos: 500,
      }),
    ).resolves.toMatchObject({ cliente: 'Cobach XXI', montoCentavos: 500 });
    expect(cobranzas.aplicarSaldoFavor).toHaveBeenCalledWith(
      { clienteId: 'cliente-1', notaIds: ['a'], montoCentavos: 500 },
      {
        sucursalId: 'suc-tj',
        fechaOperacion: hoyEnTijuana(),
        vendedorId: null,
        usuarioId: 'usuario-1',
      },
      trx,
    );
  });
});

describe('CobranzasPortalService.porCobrar', () => {
  it('sin filtro, o con dos, es 400', async () => {
    const { servicio } = montar();
    await expect(servicio.porCobrar('u', {} as PorCobrarDto)).rejects.toThrow(
      MOTIVO_UN_FILTRO,
    );
    await expect(
      servicio.porCobrar('u', { fecha: '2026-10-01', numNota: '12' } as PorCobrarDto),
    ).rejects.toThrow(MOTIVO_UN_FILTRO);
  });

  it('por cliente devuelve el cliente, su saldo a favor y sus notas', async () => {
    const { servicio, repo } = montar();
    await expect(
      servicio.porCobrar('u', { clienteId: 'CLIENTE-1' } as PorCobrarDto),
    ).resolves.toEqual({ ...CLIENTE, saldoFavorCentavos: 1250, notas: [] });
    expect(repo.clienteParaCobro).toHaveBeenCalledWith('cliente-1');
  });

  it('por fecha respeta el alcance del usuario', async () => {
    const tj = montar({ usuarioCodigo: 'TJ' });
    await tj.servicio.porCobrar('u', { fecha: '2026-10-01' } as PorCobrarDto);
    expect(tj.repo.notasPorCobrar).toHaveBeenCalledWith({
      clienteId: null,
      fecha: '2026-10-01',
      numNota: null,
      sucursalCodigo: 'TJ',
    });

    const general = montar();
    await general.servicio.porCobrar('u', {
      numNota: 'A-12',
      sucursal: 'MX',
    } as PorCobrarDto);
    expect(general.repo.notasPorCobrar).toHaveBeenCalledWith({
      clienteId: null,
      fecha: null,
      numNota: 'A-12',
      sucursalCodigo: 'MX',
    });
  });
});
```

Run: `npm test --workspace=apps/backend -- cobranzas-portal`
Expected: FAIL (los módulos no existen).

- [ ] **Paso 2: DTOs**

`apps/backend/src/modules/ventas-cobranza/dto/cobranzas.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MAX_CENTAVOS_COBRO,
  METODOS_PAGO,
  type MetodoPago,
} from '../datos-cobranza';
import { LARGO_MAX_NUM_NOTA } from '../datos-venta';
import { recortar } from './registrar-venta.dto';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTAS = 200;

export const MENSAJE_MONTO =
  'El monto debe ser mayor a $0 y tener a lo más 2 decimales.';

/**
 * `GET /cobranzas/por-cobrar` (T-21, §4.3). Los tres filtros son opcionales
 * aqui; que venga **exactamente uno** lo exige el servicio.
 */
export class PorCobrarDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'El cliente no es válido.' })
  clienteId?: string;

  @IsOptional()
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUM_NOTA, {
    message: `El número de nota no puede pasar de ${LARGO_MAX_NUM_NOTA} caracteres.`,
  })
  numNota?: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}

/** Lo comun a la vista previa, el pago y el saldo a favor. */
export class NotasYMontoDto {
  @IsUUID(undefined, { message: 'Elige el cliente.' })
  clienteId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Marca al menos una nota.' })
  @ArrayMaxSize(MAX_NOTAS, { message: `No más de ${MAX_NOTAS} notas a la vez.` })
  @IsUUID(undefined, { each: true, message: 'Una de las notas no es válida.' })
  notaIds!: string[];

  // Centavos ENTEROS: el portal convierte sin punto flotante
  // (`leerMontoCentavos`). Un numero con decimales o un texto es 400, nunca un
  // centavo de mas o de menos.
  @IsInt({ message: MENSAJE_MONTO })
  @Min(1, { message: MENSAJE_MONTO })
  @Max(MAX_CENTAVOS_COBRO, { message: 'El monto es demasiado grande.' })
  montoCentavos!: number;
}

/** `POST /cobranzas/vista-previa`: el reparto sin grabar (§3.3). */
export class VistaPreviaCobroDto extends NotasYMontoDto {
  @IsIn(['pago', 'saldo_favor'], {
    message: 'El modo debe ser pago o saldo_favor.',
  })
  modo!: 'pago' | 'saldo_favor';
}

/** `POST /cobranzas`: un pago de una o varias notas (§3.3). */
export class RegistrarCobroDto extends NotasYMontoDto {
  @Matches(RE_FECHA, {
    message: 'La fecha del pago debe tener el formato AAAA-MM-DD.',
  })
  fechaPago!: string;

  @IsIn(METODOS_PAGO, {
    message: 'El método de pago debe ser transferencia, efectivo o cheque.',
  })
  metodoPago!: MetodoPago;

  // Obligatorio, pero puede ser `null`: null es "Oficina". Ausente no es lo
  // mismo que Oficina, y se rechaza (mismo trato que la venta del portal).
  @ValidateIf((o: RegistrarCobroDto) => o.vendedorId !== null)
  @IsUUID(undefined, { message: 'Elige quién cobró: Oficina o un repartidor.' })
  vendedorId!: string | null;
}

/** `POST /cobranzas/saldo-favor`: sin metodo ni cobrador, no entra dinero (§3.4). */
export class AplicarSaldoFavorDto extends NotasYMontoDto {}
```

- [ ] **Paso 3: Repositorio de lecturas**

`apps/backend/src/modules/ventas-cobranza/cobranzas-portal.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import { saldoDerivadoCentavos } from './reglas-cobranza';

export type OrigenAbono = 'cobro' | 'venta_contado' | 'saldo_favor';

/** Un abono vivo de una nota, para "abonos anteriores" (§3.2). */
export interface AbonoAnterior {
  fechaPago: string;
  montoCentavos: number;
  metodoPago: string;
  origen: OrigenAbono;
}

/** Una nota por cobrar: `pendiente`/`abonado` y viva (§3.1, §3.2). */
export interface NotaPorCobrar {
  id: string;
  folio: string;
  /** `null` si no hubo nota de papel. */
  numNota: string | null;
  /** `AAAA-MM-DD`. */
  fecha: string;
  clienteId: string;
  cliente: string;
  /** La sucursal del CLIENTE: la que define el alcance, como en el cobro. */
  sucursalCodigo: string;
  montoCentavos: number;
  /** Derivado (D7): monto menos abonos vivos, nunca negativo. */
  saldoCentavos: number;
  status: 'pendiente' | 'abonado';
  /** Por fecha de pago. */
  abonos: AbonoAnterior[];
}

export interface ClienteParaCobro {
  id: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
}

/** Ya resuelto por el servicio: un solo filtro y el alcance aplicado. */
export interface FiltroPorCobrar {
  clienteId: string | null;
  fecha: string | null;
  numNota: string | null;
  /** `null` = todas las sucursales. */
  sucursalCodigo: string | null;
}

/**
 * Lecturas de la pantalla de cobranza del portal (T-21). Las escrituras van
 * por `CobranzasService`, el mismo de la tablet. Fechas con `to_char`: un
 * `date` leido como `Date` se corre un dia segun el huso del proceso.
 */
@Injectable()
export class CobranzasPortalRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** El cliente, vivo, con su sucursal. Acepta la `trx` del cobro. */
  async clienteParaCobro(
    clienteId: string,
    conexion: Database = this.db,
  ): Promise<ClienteParaCobro | undefined> {
    const fila = await conexion
      .selectFrom('cliente')
      .innerJoin('sucursal', 'sucursal.id', 'cliente.sucursal_id')
      .select([
        'cliente.id as id',
        'cliente.nombre as nombre',
        'cliente.sucursal_id as sucursal_id',
        'sucursal.codigo as codigo',
      ])
      .where('cliente.id', '=', clienteId)
      .where('cliente.deleted_at', 'is', null)
      .executeTakeFirst();
    return fila
      ? {
          id: fila.id,
          nombre: fila.nombre,
          sucursalId: fila.sucursal_id,
          sucursalCodigo: fila.codigo,
        }
      : undefined;
  }

  /**
   * Notas por cobrar, de la mas vieja a la mas nueva. El # de nota se compara
   * como en la busqueda de ventas: `lower(btrim(...))`, exacto.
   */
  async notasPorCobrar(filtro: FiltroPorCobrar): Promise<NotaPorCobrar[]> {
    const condiciones = [
      sql`vn.deleted_at is null`,
      sql`vn.status in ('pendiente', 'abonado')`,
    ];
    if (filtro.clienteId !== null)
      condiciones.push(sql`vn.cliente_id = ${filtro.clienteId}::uuid`);
    if (filtro.fecha !== null)
      condiciones.push(sql`vn.fecha = ${filtro.fecha}::date`);
    if (filtro.numNota !== null)
      condiciones.push(
        sql`lower(btrim(vn.num_nota)) = lower(btrim(${filtro.numNota}))`,
      );
    if (filtro.sucursalCodigo !== null)
      condiciones.push(sql`s.codigo = ${filtro.sucursalCodigo}`);

    const filas = await sql<{
      id: string;
      folio: string;
      num_nota: string | null;
      fecha: string;
      cliente_id: string;
      cliente: string;
      sucursal_codigo: string;
      monto_total: string;
      status: string;
      abonado: string;
      abonos: {
        fecha_pago: string;
        monto: string;
        metodo_pago: string;
        origen: string;
      }[];
    }>`
      select vn.id, vn.folio, vn.num_nota,
             to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, c.nombre as cliente, s.codigo as sucursal_codigo,
             vn.monto_total, vn.status,
             coalesce(a.abonado, 0)::text as abonado,
             coalesce(a.abonos, '[]'::json) as abonos
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        join sucursal s on s.id = c.sucursal_id
        left join lateral (
          select sum(ca.monto) as abonado,
                 json_agg(
                   json_build_object(
                     'fecha_pago', to_char(ca.fecha_pago, 'YYYY-MM-DD'),
                     'monto', ca.monto::text,
                     'metodo_pago', ca.metodo_pago,
                     'origen', ca.origen
                   ) order by ca.fecha_pago, ca.created_at
                 ) as abonos
            from cobranza_abono ca
           where ca.venta_nota_id = vn.id
             and ca.deleted_at is null
        ) a on true
       where ${sql.join(condiciones, sql` and `)}
       order by vn.fecha, vn.folio
    `.execute(this.db);

    return filas.rows.map((f) => ({
      id: f.id,
      folio: f.folio,
      numNota: f.num_nota,
      fecha: f.fecha,
      clienteId: f.cliente_id,
      cliente: f.cliente,
      sucursalCodigo: f.sucursal_codigo,
      montoCentavos: aCentavos(f.monto_total),
      saldoCentavos: saldoDerivadoCentavos(
        aCentavos(f.monto_total),
        aCentavos(f.abonado),
      ),
      status: f.status as 'pendiente' | 'abonado',
      abonos: f.abonos.map((a) => ({
        fechaPago: a.fecha_pago,
        montoCentavos: aCentavos(a.monto),
        metodoPago: a.metodo_pago,
        origen: a.origen as OrigenAbono,
      })),
    }));
  }

  /** La suma de los movimientos vivos (D5), en centavos. Solo para pintar. */
  async saldoFavorCentavos(clienteId: string): Promise<number> {
    const fila = await this.db
      .selectFrom('saldo_favor_movimiento')
      .select(sql<string>`coalesce(sum(monto), 0)::text`.as('total'))
      .where('cliente_id', '=', clienteId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return aCentavos(fila.total);
  }
}
```

- [ ] **Paso 4: Servicio del portal**

`apps/backend/src/modules/ventas-cobranza/cobranzas-portal.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import { esConflictoDeConcurrencia } from '../../database/errores-postgres';
import type { DB } from '../../database/schema';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import { exigirAlcanceSobre } from './alcance-venta';
import {
  CobranzasPortalRepository,
  type ClienteParaCobro,
  type NotaPorCobrar,
} from './cobranzas-portal.repository';
import {
  CobranzasService,
  type NotasAPagar,
  type PlanDeCobro,
} from './cobranzas.service';
import type {
  AplicarSaldoFavorDto,
  PorCobrarDto,
  RegistrarCobroDto,
  VistaPreviaCobroDto,
} from './dto/cobranzas.dto';
import { PagoRechazado, type RazonPagoRechazado } from './pago-rechazado';
import { esFechaReal } from './venta-portal';
import { VentasPortalRepository } from './ventas-portal.repository';

export const MOTIVO_UN_FILTRO =
  'Busca por cliente, fecha o # de nota (uno solo).';
export const MOTIVO_FECHA_FUTURA = 'La fecha del pago no puede ser futura.';
export const MOTIVO_COBRADOR_INVALIDO =
  'El cobrador no es un repartidor activo de la sucursal del cliente.';
export const MOTIVO_INTERBLOQUEO_COBRO =
  'Otro usuario estaba modificando las notas de este cliente al mismo tiempo; vuelve a intentar.';

/**
 * El HTTP de cada rechazo del dominio. La fecha es un dato mal capturado
 * (400); lo demas es que la base cambio mientras la pantalla estaba abierta
 * (409).
 */
const HTTP_POR_RAZON: Record<RazonPagoRechazado, 400 | 409> = {
  'nota-ajena': 409,
  'nota-sin-saldo': 409,
  'fecha-anterior': 400,
  'saldo-favor-insuficiente': 409,
  'excede-lo-que-deben': 409,
};

/** `GET /cobranzas/por-cobrar?clienteId=` (§3.2). */
export interface ClientePorCobrar extends ClienteParaCobro {
  saldoFavorCentavos: number;
  notas: NotaPorCobrar[];
}

/** Lo que devuelven `POST /cobranzas` y `POST /cobranzas/saldo-favor`. */
export interface CobroRegistrado extends PlanDeCobro {
  /** Nombre del cliente, para el "Cobro registrado: $… a …". */
  cliente: string;
  montoCentavos: number;
}

type UsuarioConSucursal = Parameters<typeof exigirAlcanceSobre>[0];

const sinRepetir = (ids: string[]): string[] => [
  ...new Set(ids.map((id) => id.toLowerCase())),
];

/**
 * Cobranza desde el portal (T-21). Valida lo que no depende de la base, abre
 * UNA transaccion, exige el alcance sobre el cliente leido y llama a
 * `CobranzasService`, la misma regla que la tablet. **No emite folio**: la
 * cobranza no lleva folio (cliente, 2026-10-07).
 */
@Injectable()
export class CobranzasPortalService {
  constructor(
    private readonly cobranzas: CobranzasService,
    private readonly repo: CobranzasPortalRepository,
    private readonly portal: VentasPortalRepository,
  ) {}

  async porCobrar(
    usuarioId: string,
    dto: PorCobrarDto,
  ): Promise<ClientePorCobrar | NotaPorCobrar[]> {
    const clienteId = dto.clienteId ? dto.clienteId.toLowerCase() : null;
    const fecha = dto.fecha ? dto.fecha : null;
    const numNota = dto.numNota ? dto.numNota : null;
    if ([clienteId, fecha, numNota].filter((f) => f !== null).length !== 1)
      throw new BadRequestException(MOTIVO_UN_FILTRO);

    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);

    if (clienteId !== null) {
      const cliente = await this.repo.clienteParaCobro(clienteId);
      if (!cliente) throw new NotFoundException('No existe ese cliente.');
      exigirAlcanceSobre(usuario, cliente.sucursalCodigo);
      const [notas, saldoFavorCentavos] = await Promise.all([
        this.repo.notasPorCobrar({
          clienteId: cliente.id,
          fecha: null,
          numNota: null,
          sucursalCodigo: null,
        }),
        this.repo.saldoFavorCentavos(cliente.id),
      ]);
      return { ...cliente, saldoFavorCentavos, notas };
    }

    if (fecha !== null && !esFechaReal(fecha))
      throw new BadRequestException('Esa fecha no existe.');
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    // El query param es solo preferencia; pedir una sucursal ajena es 403.
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(dto.sucursal),
    );
    return this.repo.notasPorCobrar({
      clienteId: null,
      fecha,
      numNota,
      sucursalCodigo: alcance.tipo === 'una' ? alcance.codigo : null,
    });
  }

  /** §3.3: el reparto sin grabar, con las mismas comprobaciones que grabar. */
  async vistaPrevia(
    usuarioId: string,
    dto: VistaPreviaCobroDto,
  ): Promise<PlanDeCobro> {
    const pedido = this.pedido(dto);
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    return this.enTransaccion(async (trx) => {
      await this.clienteConAlcance(usuario, pedido.clienteId, trx);
      return dto.modo === 'saldo_favor'
        ? this.cobranzas.planearSaldoFavor(pedido, trx)
        : this.cobranzas.planearPago(pedido, trx);
    });
  }

  async registrar(
    usuarioId: string,
    dto: RegistrarCobroDto,
  ): Promise<CobroRegistrado> {
    if (!esFechaReal(dto.fechaPago))
      throw new BadRequestException('Esa fecha no existe.');
    const hoy = hoyEnTijuana();
    if (dto.fechaPago > hoy) throw new BadRequestException(MOTIVO_FECHA_FUTURA);

    const pedido = this.pedido(dto);
    const vendedorId = dto.vendedorId ? dto.vendedorId.toLowerCase() : null;
    // Fuera de la transaccion: dentro seria una segunda conexion abierta a la vez.
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);

    return this.enTransaccion(async (trx) => {
      const cliente = await this.clienteConAlcance(
        usuario,
        pedido.clienteId,
        trx,
      );
      if (
        vendedorId !== null &&
        !(await this.portal.esRepartidorActivo(
          vendedorId,
          cliente.sucursalId,
          trx,
        ))
      ) {
        throw new BadRequestException(MOTIVO_COBRADOR_INVALIDO);
      }
      const plan = await this.cobranzas.registrarPago(
        { ...pedido, metodoPago: dto.metodoPago, fechaPago: dto.fechaPago },
        {
          sucursalId: cliente.sucursalId,
          fechaOperacion: hoy,
          vendedorId,
          usuarioId,
        },
        trx,
      );
      return {
        cliente: cliente.nombre,
        montoCentavos: pedido.montoCentavos,
        ...plan,
      };
    });
  }

  /** §3.4: sin metodo ni cobrador; el dia es hoy en Tijuana. */
  async aplicarSaldoFavor(
    usuarioId: string,
    dto: AplicarSaldoFavorDto,
  ): Promise<CobroRegistrado> {
    const hoy = hoyEnTijuana();
    const pedido = this.pedido(dto);
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);

    return this.enTransaccion(async (trx) => {
      const cliente = await this.clienteConAlcance(
        usuario,
        pedido.clienteId,
        trx,
      );
      const plan = await this.cobranzas.aplicarSaldoFavor(
        pedido,
        {
          sucursalId: cliente.sucursalId,
          fechaOperacion: hoy,
          vendedorId: null,
          usuarioId,
        },
        trx,
      );
      return {
        cliente: cliente.nombre,
        montoCentavos: pedido.montoCentavos,
        ...plan,
      };
    });
  }

  /* ---------------------------------------------------------------- */

  private pedido(dto: {
    clienteId: string;
    notaIds: string[];
    montoCentavos: number;
  }): NotasAPagar {
    return {
      clienteId: dto.clienteId.toLowerCase(),
      notaIds: sinRepetir(dto.notaIds),
      montoCentavos: dto.montoCentavos,
    };
  }

  /** Se compara contra el cliente LEIDO, nunca contra un query param. */
  private async clienteConAlcance(
    usuario: UsuarioConSucursal,
    clienteId: string,
    trx: Transaction<DB>,
  ): Promise<ClienteParaCobro> {
    const cliente = await this.repo.clienteParaCobro(clienteId, trx);
    if (!cliente) throw new NotFoundException('No existe ese cliente.');
    exigirAlcanceSobre(usuario, cliente.sucursalCodigo);
    return cliente;
  }

  /**
   * UNA transaccion. Kysely ya hizo rollback cuando llega el `catch`: aqui solo
   * se traduce a HTTP. Un interbloqueo con un cobro de la tablet (o de otro
   * usuario) sale como 409, nunca como 500 (mismo trato que facturas).
   */
  private async enTransaccion<T>(
    tarea: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.portal.enTransaccion(tarea);
    } catch (error) {
      if (error instanceof PagoRechazado)
        throw HTTP_POR_RAZON[error.razon] === 400
          ? new BadRequestException(error.message)
          : new ConflictException(error.message);
      if (esConflictoDeConcurrencia(error))
        throw new ConflictException(MOTIVO_INTERBLOQUEO_COBRO);
      throw error;
    }
  }
}
```

- [ ] **Paso 5: Controller y módulo**

`apps/backend/src/modules/ventas-cobranza/cobranzas.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import type { NotaPorCobrar } from './cobranzas-portal.repository';
import {
  CobranzasPortalService,
  type ClientePorCobrar,
  type CobroRegistrado,
} from './cobranzas-portal.service';
import type { PlanDeCobro } from './cobranzas.service';
import {
  AplicarSaldoFavorDto,
  PorCobrarDto,
  RegistrarCobroDto,
  VistaPreviaCobroDto,
} from './dto/cobranzas.dto';

// T-21. Todo con `cobranza.registrar`, lectura incluida: es una pantalla de
// una sola tarea (mismo criterio que facturas). La cuenta perdida NO vive
// aqui: reusa `POST /ventas/:id/cuenta-perdida` con su permiso.
@Controller('cobranzas')
export class CobranzasController {
  constructor(private readonly cobranzas: CobranzasPortalService) {}

  @Get('por-cobrar')
  @RequierePermiso('cobranza.registrar')
  porCobrar(
    @UsuarioActual() usuarioId: string,
    @Query() q: PorCobrarDto,
  ): Promise<ClientePorCobrar | NotaPorCobrar[]> {
    return this.cobranzas.porCobrar(usuarioId, q);
  }

  @Post('vista-previa')
  @HttpCode(200)
  @RequierePermiso('cobranza.registrar')
  vistaPrevia(
    @UsuarioActual() usuarioId: string,
    @Body() dto: VistaPreviaCobroDto,
  ): Promise<PlanDeCobro> {
    return this.cobranzas.vistaPrevia(usuarioId, dto);
  }

  @Post()
  @RequierePermiso('cobranza.registrar')
  registrar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: RegistrarCobroDto,
  ): Promise<CobroRegistrado> {
    return this.cobranzas.registrar(usuarioId, dto);
  }

  @Post('saldo-favor')
  @RequierePermiso('cobranza.registrar')
  aplicarSaldoFavor(
    @UsuarioActual() usuarioId: string,
    @Body() dto: AplicarSaldoFavorDto,
  ): Promise<CobroRegistrado> {
    return this.cobranzas.aplicarSaldoFavor(usuarioId, dto);
  }
}
```

`apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`: importa `CobranzasController`,
`CobranzasPortalRepository` y `CobranzasPortalService`; `controllers` queda
`[VentasController, FacturasController, CobranzasController]`, y al final de `providers` agrega:

```ts
    // T-21: cobranza desde el portal
    CobranzasPortalService,
    CobranzasPortalRepository,
```

Run: `npm test --workspace=apps/backend -- cobranzas-portal && npm run build --workspace=apps/backend`
Expected: PASS y compila.

- [ ] **Paso 6: e2e de punta a punta**

`apps/backend/test/cobranzas-portal.e2e-spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
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
  type RespuestaPull,
} from './../src/modules/sincronizacion/contrato';
import { hoyEnTijuana } from './../src/modules/sincronizacion/operaciones';
import { MOTIVO_CON_COBROS } from './../src/modules/ventas-cobranza/acciones-venta';
import type { NotaPorCobrar } from './../src/modules/ventas-cobranza/cobranzas-portal.repository';
import type {
  ClientePorCobrar,
  CobroRegistrado,
} from './../src/modules/ventas-cobranza/cobranzas-portal.service';
import type { PlanDeCobro } from './../src/modules/ventas-cobranza/cobranzas.service';
import type { VentaDetalle } from './../src/modules/ventas-cobranza/ventas-consulta.service';

/**
 * Cobranza desde el portal (T-21): §6 del spec, de punta a punta.
 *
 * Fechas de MAYO DE 2023 exclusivas de este archivo. El cobro del portal se
 * registra con `fecha_operacion` = hoy en Tijuana: la pone el servidor.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-cob-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-cob-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-cob-sin-${SUFIJO}`;
const LOGIN_APP = `e2e-cob-app-${SUFIJO}`;

const F1 = '2023-05-01';
const F2 = '2023-05-02';
const F3 = '2023-05-03';
const F_BUSQUEDA = '2023-05-20';
const PAGO = '2023-05-10';

const ESPERA_MAX_BLOQUEO_MS = 3000;
const MENSAJE_MONTO =
  'El monto debe ser mayor a $0 y tener a lo más 2 decimales.';

/** Manana en Tijuana, armado del texto (nunca de un Date local). */
const mananaEnTijuana = () => {
  const [a, m, d] = hoyEnTijuana().split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
};

const mensaje = (res: request.Response) =>
  (res.body as { message: string }).message;

describe('Cobranza desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const vendedorIds: string[] = [];
  let usuarioGeneralId: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let repartidorTj: string;
  let repartidorTjInactivo: string;
  let repartidorMx: string;
  let vendedorApp: string;
  let bearerApp: string;

  let folios = 0;
  let clientes = 0;
  let vendedores = 0;

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

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio. */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ) => {
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
    return id;
  };

  const sembrarCliente = async (sucursalId: string): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `Cobranza ${++clientes} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  /** Una venta a credito de oficina; `pendiente` y viva salvo que se diga otra cosa. */
  const sembrarNota = async (
    clienteId: string,
    monto: string,
    fecha: string,
    extra: { status?: string; numNota?: string; borrada?: boolean } = {},
  ) => {
    const cliente = await db
      .selectFrom('cliente')
      .select('sucursal_id')
      .where('id', '=', clienteId)
      .executeTakeFirstOrThrow();
    return db
      .insertInto('venta_nota')
      .values({
        folio: `ZZC${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha,
        cliente_id: clienteId,
        vendedor_id: null,
        monto_total: monto,
        num_nota: extra.numNota ?? null,
        contado_credito: 'credito',
        semana: 18,
        mes: 5,
        status: extra.status ?? 'pendiente',
        sucursal_id: cliente.sucursal_id,
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
        deleted_at: extra.borrada ? new Date() : null,
      })
      .returning(['id', 'folio'])
      .executeTakeFirstOrThrow();
  };

  /** Un repartidor; `acceso` solo para el de la tablet, que entra por /auth/app/login. */
  const sembrarVendedor = async (
    sucursalId: string,
    activo = true,
    acceso: { login: string; passwordHash: string } | null = null,
  ): Promise<string> => {
    const n = ++vendedores;
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: acceso?.login ?? `e2e-cob-v${n}-${SUFIJO}`,
        nombre: `Repartidor ${n} ${SUFIJO}`,
        password_hash: acceso?.passwordHash ?? 'x',
        sucursal_id: sucursalId,
        activo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const darSaldoFavor = (clienteId: string, monto: string) =>
    db
      .insertInto('saldo_favor_movimiento')
      .values({
        cliente_id: clienteId,
        vendedor_id: null,
        monto,
        origen: 'excedente_cobro',
        fecha_operacion: F1,
      })
      .execute();

  const porCobrar = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/cobranzas/por-cobrar?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const cobrar = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/cobranzas')
      .set('Cookie', cookie)
      .send(cuerpo);

  const vistaPrevia = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/cobranzas/vista-previa')
      .set('Cookie', cookie)
      .send(cuerpo);

  const aplicarSaldo = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/cobranzas/saldo-favor')
      .set('Cookie', cookie)
      .send(cuerpo);

  /** Un pago valido; transferencia de Oficina por default, como la pantalla. */
  const pago = (
    clienteId: string,
    notaIds: string[],
    extra: Record<string, unknown> = {},
  ) => ({
    clienteId,
    notaIds,
    montoCentavos: 10000,
    fechaPago: PAGO,
    metodoPago: 'transferencia',
    vendedorId: null,
    ...extra,
  });

  const pull = (query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(
        `/sync/pull?${new URLSearchParams({ contrato: String(CONTRATO_ACTUAL), ...query }).toString()}`,
      )
      .set('Authorization', `Bearer ${bearerApp}`);

  /** Los abonos vivos de una nota, en el orden en que se escribieron. */
  const abonosDe = (notaId: string) =>
    db
      .selectFrom('cobranza_abono')
      .select([
        'monto',
        'tipo',
        'saldo_pendiente',
        'metodo_pago',
        'origen',
        'vendedor_id',
        'capturo_usuario_id',
        sql<string>`to_char(fecha_pago, 'YYYY-MM-DD')`.as('fecha_pago'),
        sql<string>`to_char(fecha_operacion, 'YYYY-MM-DD')`.as(
          'fecha_operacion',
        ),
      ])
      .where('venta_nota_id', '=', notaId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .execute();

  const statusDe = async (id: string) =>
    (
      await db
        .selectFrom('venta_nota')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;

  const movimientosDe = (clienteId: string) =>
    db
      .selectFrom('saldo_favor_movimiento')
      .select(['monto', 'origen', 'vendedor_id', 'capturo_usuario_id'])
      .where('cliente_id', '=', clienteId)
      .orderBy('created_at')
      .execute();

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
    mxId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    usuarioGeneralId = await crearUsuario(
      LOGIN_GENERAL,
      'Administrador General',
      null,
    );
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    repartidorTj = await sembrarVendedor(tjId);
    repartidorTjInactivo = await sembrarVendedor(tjId, false);
    repartidorMx = await sembrarVendedor(mxId);
    // El de la tablet: con contrasena, para entrar por /auth/app/login y hacer pull.
    vendedorApp = await sembrarVendedor(tjId, true, {
      login: LOGIN_APP,
      passwordHash: await app.get(PasswordService).hashear(PASSWORD),
    });
    bearerApp = (
      (
        await request(app.getHttpServer())
          .post('/auth/app/login')
          .send({ login: LOGIN_APP, password: PASSWORD })
          .expect(200)
      ).body as { tokenAcceso: string }
    ).tokenAcceso;
  });

  afterAll(async () => {
    if (clienteIds.length > 0) {
      const notas = db
        .selectFrom('venta_nota')
        .select('id')
        .where('cliente_id', 'in', clienteIds);
      await db
        .deleteFrom('cobranza_abono')
        .where('venta_nota_id', 'in', notas)
        .execute();
      await db
        .deleteFrom('saldo_favor_movimiento')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db
        .deleteFrom('venta_nota')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('permiso y alcance', () => {
    it('sin cobranza.registrar todo es 403, lectura incluida', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);
      await porCobrar(cookieSinPermiso, { clienteId: cli }).expect(403);
      await cobrar(cookieSinPermiso, pago(cli, [n.id])).expect(403);
      await aplicarSaldo(cookieSinPermiso, {
        clienteId: cli,
        notaIds: [n.id],
        montoCentavos: 100,
      }).expect(403);
      expect(await abonosDe(n.id)).toEqual([]);
    });

    it('un usuario de TJ no ve ni cobra a un cliente de MX', async () => {
      const cli = await sembrarCliente(mxId);
      const n = await sembrarNota(cli, '100.00', F1);
      await porCobrar(cookieTijuana, { clienteId: cli }).expect(403);
      await cobrar(cookieTijuana, pago(cli, [n.id])).expect(403);
      await aplicarSaldo(cookieTijuana, {
        clienteId: cli,
        notaIds: [n.id],
        montoCentavos: 100,
      }).expect(403);
      expect(await abonosDe(n.id)).toEqual([]);
    });

    it('por fecha, un usuario de TJ solo ve las notas de TJ; el General, las de las dos', async () => {
      const tj = await sembrarCliente(tjId);
      const mx = await sembrarCliente(mxId);
      const nTj = await sembrarNota(tj, '10.00', F_BUSQUEDA);
      const nMx = await sembrarNota(mx, '10.00', F_BUSQUEDA);

      const deTj = (
        (await porCobrar(cookieTijuana, { fecha: F_BUSQUEDA }).expect(200))
          .body as NotaPorCobrar[]
      ).map((n) => n.id);
      expect(deTj).toContain(nTj.id);
      expect(deTj).not.toContain(nMx.id);

      const todas = (
        (await porCobrar(cookieGeneral, { fecha: F_BUSQUEDA }).expect(200))
          .body as NotaPorCobrar[]
      ).map((n) => n.id);
      expect(todas).toEqual(expect.arrayContaining([nTj.id, nMx.id]));
    });
  });

  describe('por cobrar', () => {
    it('por cliente: sus notas por cobrar de la mas vieja a la mas nueva, con saldo, abonos y saldo a favor', async () => {
      const cli = await sembrarCliente(tjId);
      const nueva = await sembrarNota(cli, '80.00', F2);
      const vieja = await sembrarNota(cli, '100.00', F1, { status: 'abonado' });
      await sembrarNota(cli, '50.00', F1, { status: 'pagada' });
      await sembrarNota(cli, '50.00', F1, { status: 'cuenta_perdida' });
      await sembrarNota(cli, '50.00', F1, { borrada: true });
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: vieja.id,
          vendedor_id: null,
          fecha_pago: F2,
          fecha_operacion: F2,
          monto: '30.00',
          tipo: 'abono',
          saldo_pendiente: '70.00',
          metodo_pago: 'cheque',
          origen: 'cobro',
        })
        .execute();
      await darSaldoFavor(cli, '12.50');

      const cuerpo = (
        await porCobrar(cookieGeneral, { clienteId: cli }).expect(200)
      ).body as ClientePorCobrar;
      expect(cuerpo).toMatchObject({
        id: cli,
        sucursalId: tjId,
        sucursalCodigo: 'TJ',
        saldoFavorCentavos: 1250,
      });
      expect(cuerpo.notas.map((n) => n.id)).toEqual([vieja.id, nueva.id]);
      expect(cuerpo.notas[0]).toMatchObject({
        folio: vieja.folio,
        fecha: F1,
        montoCentavos: 10000,
        saldoCentavos: 7000,
        status: 'abonado',
        abonos: [
          {
            fechaPago: F2,
            montoCentavos: 3000,
            metodoPago: 'cheque',
            origen: 'cobro',
          },
        ],
      });
    });

    it('por # de nota: exacto, sin mayusculas ni espacios, de cualquier cliente del alcance', async () => {
      const a = await sembrarCliente(tjId);
      const b = await sembrarCliente(tjId);
      const numNota = `Nota-${SUFIJO}`.slice(0, 30);
      const na = await sembrarNota(a, '10.00', F3, { numNota });
      const nb = await sembrarNota(b, '20.00', F3, {
        numNota: numNota.toLowerCase(),
      });

      const res = (
        await porCobrar(cookieGeneral, {
          numNota: `  ${numNota.toUpperCase()} `,
        }).expect(200)
      ).body as NotaPorCobrar[];
      expect(res.map((n) => n.id).sort()).toEqual([na.id, nb.id].sort());
      expect(res.find((n) => n.id === nb.id)?.clienteId).toBe(b);
    });

    it('sin filtro, o con dos, es 400', async () => {
      const res = await porCobrar(cookieGeneral, {}).expect(400);
      expect(mensaje(res)).toBe(
        'Busca por cliente, fecha o # de nota (uno solo).',
      );
      await porCobrar(cookieGeneral, { fecha: F1, numNota: 'x' }).expect(400);
    });
  });

  describe('registrar pago', () => {
    it('varias palomeadas: primero la mas vieja, la ultima abonada; Oficina, quien capturo y hoy', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const n3 = await sembrarNota(cli, '50.00', F3);

      const cobro = (
        await cobrar(
          cookieGeneral,
          pago(cli, [n3.id, n2.id], { montoCentavos: 12000 }),
        ).expect(201)
      ).body as CobroRegistrado;

      expect(cobro).toMatchObject({ montoCentavos: 12000, saldoFavorCentavos: 0 });
      expect(cobro.cliente).toMatch(/^Cobranza /);
      expect(
        cobro.aplicaciones.map((a) => [
          a.folio,
          a.montoCentavos,
          a.saldoDespuesCentavos,
          a.palomeada,
        ]),
      ).toEqual([
        [n2.folio, 8000, 0, true],
        [n3.folio, 4000, 1000, true],
      ]);
      expect(await statusDe(n2.id)).toBe('pagada');
      expect(await statusDe(n3.id)).toBe('abonado');
      expect(await statusDe(n1.id)).toBe('pendiente');
      expect(await abonosDe(n1.id)).toEqual([]);
      expect(await abonosDe(n2.id)).toEqual([
        {
          monto: '80.00',
          tipo: 'cobranza',
          saldo_pendiente: '0.00',
          metodo_pago: 'transferencia',
          origen: 'cobro',
          vendedor_id: null,
          capturo_usuario_id: usuarioGeneralId,
          fecha_pago: PAGO,
          fecha_operacion: hoyEnTijuana(),
        },
      ]);
    });

    it('el excedente va a las demas notas (de la mas vieja) y lo que sobra a saldo a favor', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const n3 = await sembrarNota(cli, '50.00', F3);

      const cobro = (
        await cobrar(
          cookieGeneral,
          pago(cli, [n2.id], { montoCentavos: 30000 }),
        ).expect(201)
      ).body as CobroRegistrado;

      expect(
        cobro.aplicaciones.map((a) => [a.folio, a.montoCentavos, a.palomeada]),
      ).toEqual([
        [n2.folio, 8000, true],
        [n1.folio, 10000, false],
        [n3.folio, 5000, false],
      ]);
      expect(cobro.saldoFavorCentavos).toBe(7000);
      expect(await movimientosDe(cli)).toEqual([
        {
          monto: '70.00',
          origen: 'excedente_cobro',
          vendedor_id: null,
          capturo_usuario_id: usuarioGeneralId,
        },
      ]);
      const cuerpo = (
        await porCobrar(cookieGeneral, { clienteId: cli }).expect(200)
      ).body as ClientePorCobrar;
      expect(cuerpo).toMatchObject({ saldoFavorCentavos: 7000, notas: [] });
    });

    it('con un repartidor como cobrador el abono es suyo; uno inactivo o de otra sucursal es 400', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);

      await cobrar(
        cookieGeneral,
        pago(cli, [n.id], { montoCentavos: 1000, vendedorId: repartidorTj }),
      ).expect(201);
      expect((await abonosDe(n.id))[0]).toMatchObject({
        vendedor_id: repartidorTj,
      });

      for (const otro of [repartidorTjInactivo, repartidorMx]) {
        const res = await cobrar(
          cookieGeneral,
          pago(cli, [n.id], { montoCentavos: 1000, vendedorId: otro }),
        ).expect(400);
        expect(mensaje(res)).toBe(
          'El cobrador no es un repartidor activo de la sucursal del cliente.',
        );
      }
      expect(await abonosDe(n.id)).toHaveLength(1);
    });

    it('el cobro no lleva folio ni consume el contador OF', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);
      const contador = () =>
        db
          .selectFrom('folio_oficina_contador')
          .select('ultimo')
          .where('sucursal_id', '=', tjId)
          .where(sql<string>`to_char(fecha, 'YYYY-MM-DD')`, '=', hoyEnTijuana())
          .executeTakeFirst();

      const antes = await contador();
      await cobrar(cookieGeneral, pago(cli, [n.id])).expect(201);
      expect(await contador()).toEqual(antes);

      const columnas = await sql<{ column_name: string }>`
        select column_name from information_schema.columns
         where table_name = 'cobranza_abono'
      `.execute(db);
      expect(columnas.rows.map((c) => c.column_name)).not.toContain('folio');
      expect(
        await db
          .selectFrom('venta_nota')
          .select('id')
          .where('cliente_id', '=', cli)
          .execute(),
      ).toHaveLength(1);
    });

    it('Review Focus 1: una palomeada que se pago mientras la pantalla estaba abierta es 409 y no se graba nada', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      // Otro cobro (la tablet) la liquido despues de que la oficina cargo la lista.
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: n2.id,
          vendedor_id: vendedorApp,
          fecha_pago: F2,
          fecha_operacion: F2,
          monto: '80.00',
          tipo: 'cobranza',
          saldo_pendiente: '0.00',
          metodo_pago: 'efectivo',
          origen: 'cobro',
        })
        .execute();
      await db
        .updateTable('venta_nota')
        .set({ status: 'pagada' })
        .where('id', '=', n2.id)
        .execute();

      const res = await cobrar(
        cookieGeneral,
        pago(cli, [n1.id, n2.id], { montoCentavos: 18000 }),
      ).expect(409);
      expect(mensaje(res)).toBe(
        `La nota ${n2.folio} ya no tiene saldo; vuelve a cargar.`,
      );
      expect(await abonosDe(n1.id)).toEqual([]);
      expect(await statusDe(n1.id)).toBe('pendiente');
      expect(await movimientosDe(cli)).toEqual([]);
    });

    it('una nota de otro cliente es 409', async () => {
      const cli = await sembrarCliente(tjId);
      const otro = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);
      const ajena = await sembrarNota(otro, '100.00', F1);
      const res = await cobrar(cookieGeneral, pago(cli, [n.id, ajena.id])).expect(
        409,
      );
      expect(mensaje(res)).toBe(
        'Una de las notas marcadas no es de este cliente o ya no existe; vuelve a cargar.',
      );
      expect(await abonosDe(n.id)).toEqual([]);
      expect(await abonosDe(ajena.id)).toEqual([]);
    });

    it('Review Focus 2: una fecha anterior a la palomeada mas vieja, o futura, es 400', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F2);

      const anterior = await cobrar(
        cookieGeneral,
        pago(cli, [n.id], { fechaPago: F1 }),
      ).expect(400);
      expect(mensaje(anterior)).toBe(
        `La fecha del pago no puede ser anterior a la nota más vieja que marcaste (${F2}).`,
      );

      const futura = await cobrar(
        cookieGeneral,
        pago(cli, [n.id], { fechaPago: mananaEnTijuana() }),
      ).expect(400);
      expect(mensaje(futura)).toBe('La fecha del pago no puede ser futura.');
      expect(await abonosDe(n.id)).toEqual([]);
    });

    it('Review Focus 4: el monto viaja en centavos enteros; con decimales, como texto, en cero o negativo es 400', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);
      for (const montoCentavos of [150050.5, '15000', 0, -100]) {
        const res = await cobrar(
          cookieGeneral,
          pago(cli, [n.id], { montoCentavos }),
        ).expect(400);
        expect(res.body).toMatchObject({
          message: expect.arrayContaining([MENSAJE_MONTO]) as unknown,
        });
      }
      expect(await abonosDe(n.id)).toEqual([]);
    });

    it('la vista previa da el reparto y no escribe nada', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);

      const plan = (
        await vistaPrevia(cookieGeneral, {
          clienteId: cli,
          notaIds: [n2.id],
          montoCentavos: 20000,
          modo: 'pago',
        }).expect(200)
      ).body as PlanDeCobro;

      expect(plan.aplicaciones.map((a) => [a.folio, a.montoCentavos])).toEqual([
        [n2.folio, 8000],
        [n1.folio, 10000],
      ]);
      expect(plan.saldoFavorCentavos).toBe(2000);
      expect(await abonosDe(n1.id)).toEqual([]);
      expect(await abonosDe(n2.id)).toEqual([]);
      expect(await statusDe(n2.id)).toBe('pendiente');
      expect(await movimientosDe(cli)).toEqual([]);
    });
  });

  /**
   * Sincronizacion por bloqueos, no por tiempos (como facturas.e2e-spec.ts): la
   * transaccion A —lo que hace la tablet al proyectar— bloquea la nota, la paga
   * y NO confirma; la peticion del portal arranca y se espera hasta que
   * `pg_blocking_pids` diga que esta bloqueada por A; entonces A confirma.
   */
  describe('carrera con un cobro de la tablet en vuelo', () => {
    it('Review Focus 1: el cobro del portal espera el candado, ve la nota ya pagada y responde 409', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      let pendiente: Promise<request.Response> | undefined;

      await db
        .transaction()
        .execute(async (trx) => {
          await sql`select id from venta_nota where id = ${n2.id} for update`.execute(
            trx,
          );
          await trx
            .insertInto('cobranza_abono')
            .values({
              venta_nota_id: n2.id,
              vendedor_id: vendedorApp,
              fecha_pago: F2,
              fecha_operacion: F2,
              monto: '80.00',
              tipo: 'cobranza',
              saldo_pendiente: '0.00',
              metodo_pago: 'efectivo',
              origen: 'cobro',
            })
            .execute();
          await trx
            .updateTable('venta_nota')
            .set({ status: 'pagada' })
            .where('id', '=', n2.id)
            .execute();
          const pidA = (
            await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
              trx,
            )
          ).rows[0].pid;

          // `.then` dispara la peticion de supertest.
          pendiente = cobrar(
            cookieGeneral,
            pago(cli, [n1.id, n2.id], { montoCentavos: 18000 }),
          ).then((r) => r);
          // Tope menor que el timeout de Jest (5 s): si la peticion nunca se
          // bloquea, el error claro sale antes y el rollback libera al portal.
          const limite = Date.now() + ESPERA_MAX_BLOQUEO_MS;
          for (;;) {
            const { rows } = await sql<{ n: number }>`
              select count(*)::int as n from pg_stat_activity
               where ${pidA}::int = any(pg_blocking_pids(pid))
            `.execute(db);
            if (rows[0].n > 0) break;
            if (Date.now() > limite)
              throw new Error('el cobro del portal nunca se bloqueo');
            await new Promise((r) => setTimeout(r, 25));
          }
        })
        .catch(async (error: unknown) => {
          // El rollback ya solto la peticion: se espera para no dejarla colgada.
          await pendiente?.catch(() => undefined);
          throw error;
        });

      const res = await pendiente!;
      expect(res.status).toBe(409);
      expect(mensaje(res)).toBe(
        `La nota ${n2.folio} ya no tiene saldo; vuelve a cargar.`,
      );
      expect(await abonosDe(n1.id)).toEqual([]);
      expect(await abonosDe(n2.id)).toHaveLength(1);
    });
  });

  describe('aplicar saldo a favor', () => {
    it('lo reparte entre las palomeadas, sin cobrador ni dinero nuevo, y deja el movimiento negativo', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const n3 = await sembrarNota(cli, '50.00', F3);
      await darSaldoFavor(cli, '150.00');

      const r = (
        await aplicarSaldo(cookieGeneral, {
          clienteId: cli,
          notaIds: [n2.id, n1.id],
          montoCentavos: 12000,
        }).expect(201)
      ).body as CobroRegistrado;

      expect(
        r.aplicaciones.map((a) => [a.folio, a.montoCentavos, a.status]),
      ).toEqual([
        [n1.folio, 10000, 'pagada'],
        [n2.folio, 2000, 'abonado'],
      ]);
      expect(await abonosDe(n1.id)).toEqual([
        {
          monto: '100.00',
          tipo: 'cobranza',
          saldo_pendiente: '0.00',
          metodo_pago: 'saldo_favor',
          origen: 'saldo_favor',
          vendedor_id: null,
          capturo_usuario_id: usuarioGeneralId,
          fecha_pago: hoyEnTijuana(),
          fecha_operacion: hoyEnTijuana(),
        },
      ]);
      expect(await abonosDe(n3.id)).toEqual([]);
      expect(
        (await movimientosDe(cli)).map((m) => [m.monto, m.origen]),
      ).toEqual([
        ['150.00', 'excedente_cobro'],
        ['-120.00', 'aplicacion'],
      ]);
      const cuerpo = (
        await porCobrar(cookieGeneral, { clienteId: cli }).expect(200)
      ).body as ClientePorCobrar;
      expect(cuerpo.saldoFavorCentavos).toBe(3000);
    });

    it('Review Focus 3: mas del saldo a favor que hay, o mas de lo que deben las palomeadas, es 409 y no graba nada', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      await darSaldoFavor(cli, '150.00');

      const deMas = await aplicarSaldo(cookieGeneral, {
        clienteId: cli,
        notaIds: [n1.id, n2.id],
        montoCentavos: 16000,
      }).expect(409);
      expect(mensaje(deMas)).toBe(
        'El cliente solo tiene $150.00 de saldo a favor.',
      );

      const masQueLaDeuda = await aplicarSaldo(cookieGeneral, {
        clienteId: cli,
        notaIds: [n2.id],
        montoCentavos: 9000,
      }).expect(409);
      expect(mensaje(masQueLaDeuda)).toBe(
        'Las notas marcadas solo deben $80.00: no se puede aplicar más saldo a favor que eso.',
      );

      expect(await abonosDe(n1.id)).toEqual([]);
      expect(await abonosDe(n2.id)).toEqual([]);
      expect(await movimientosDe(cli)).toHaveLength(1);
    });

    it('la vista previa del saldo a favor da el reparto y tambien rechaza lo que excede', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      await darSaldoFavor(cli, '40.00');

      const plan = (
        await vistaPrevia(cookieGeneral, {
          clienteId: cli,
          notaIds: [n1.id],
          montoCentavos: 4000,
          modo: 'saldo_favor',
        }).expect(200)
      ).body as PlanDeCobro;
      expect(plan).toMatchObject({
        saldoFavorCentavos: 0,
        aplicaciones: [{ folio: n1.folio, montoCentavos: 4000, saldoDespuesCentavos: 6000 }],
      });

      await vistaPrevia(cookieGeneral, {
        clienteId: cli,
        notaIds: [n1.id],
        montoCentavos: 5000,
        modo: 'saldo_favor',
      }).expect(409);
      expect(await abonosDe(n1.id)).toEqual([]);
    });

    it('una venta pagada con saldo a favor ya no se edita ni se elimina', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '100.00', F1);
      await darSaldoFavor(cli, '100.00');
      await aplicarSaldo(cookieGeneral, {
        clienteId: cli,
        notaIds: [n.id],
        montoCentavos: 10000,
      }).expect(201);

      const detalle = (
        await request(app.getHttpServer())
          .get(`/ventas/${n.id}`)
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as VentaDetalle;
      expect(detalle).toMatchObject({
        status: 'pagada',
        editable: false,
        motivoNoEditable: MOTIVO_CON_COBROS,
      });
      expect(detalle.cobros).toEqual([
        expect.objectContaining({ metodoPago: 'saldo_favor', origen: 'saldo_favor' }),
      ]);

      const res = await request(app.getHttpServer())
        .delete(`/ventas/${n.id}`)
        .set('Cookie', cookieGeneral)
        .expect(409);
      expect(mensaje(res)).toBe('Tiene cobros registrados: no se puede eliminar.');
    });
  });

  describe('la tablet ve lo que cobro la oficina', () => {
    it('el pull baja la nota cobrada desde el portal, su abono y el saldo a favor nuevo', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const corte = ((await pull().expect(200)).body as RespuestaPull)
        .servidor_en;

      // 200 = 100 (n1) + 80 (n2) + 20 a saldo a favor.
      await cobrar(
        cookieGeneral,
        pago(cli, [n1.id], { montoCentavos: 20000 }),
      ).expect(201);

      const primero = (await pull({ desde: corte }).expect(200))
        .body as RespuestaPull;
      expect(
        primero.notas_pendientes.find((n) => n.id === n1.id),
      ).toMatchObject({
        activo: 0,
        saldo_centavos: 0,
        abonos: [
          {
            fecha_pago: PAGO,
            monto_centavos: 10000,
            metodo_pago: 'transferencia',
          },
        ],
      });
      expect(
        primero.notas_pendientes.find((n) => n.id === n2.id),
      ).toMatchObject({ activo: 0, saldo_centavos: 0 });
      expect(
        primero.catalogos.clientes.find((c) => c.id === cli)
          ?.saldo_favor_centavos,
      ).toBe(2000);

      // Y la aplicacion del saldo a favor baja como abono `saldo_favor`.
      const n3 = await sembrarNota(cli, '50.00', F3);
      const corte2 = ((await pull().expect(200)).body as RespuestaPull)
        .servidor_en;
      await aplicarSaldo(cookieGeneral, {
        clienteId: cli,
        notaIds: [n3.id],
        montoCentavos: 2000,
      }).expect(201);

      const segundo = (await pull({ desde: corte2 }).expect(200))
        .body as RespuestaPull;
      expect(
        segundo.notas_pendientes.find((n) => n.id === n3.id),
      ).toMatchObject({
        activo: 1,
        saldo_centavos: 3000,
        abonos: [
          {
            fecha_pago: hoyEnTijuana(),
            monto_centavos: 2000,
            metodo_pago: 'saldo_favor',
          },
        ],
      });
      expect(
        segundo.catalogos.clientes.find((c) => c.id === cli)
          ?.saldo_favor_centavos,
      ).toBe(0);
    });
  });
});
```

Run: `npm run test:e2e --workspace=apps/backend -- cobranzas-portal`
Expected: PASS. Si la prueba de la carrera tarda más de 5 s en tu máquina, sube **solo** su timeout con un
tercer argumento a `it` (`, 10_000`), no `ESPERA_MAX_BLOQUEO_MS`.

- [ ] **Paso 7: Suite del backend, lint y commit**

Run: `npm run lint --workspace=apps/backend && npm test --workspace=apps/backend && npm run test:e2e --workspace=apps/backend`
Expected: todo en verde.

```bash
git add apps/backend/src/modules/ventas-cobranza apps/backend/test/cobranzas-portal.e2e-spec.ts
git commit -m "T-21: endpoints /cobranzas del portal (por cobrar, vista previa, pago y saldo a favor)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarea 6: Portal — `lib/cobranzas.ts` y el detalle de venta con "Saldo a favor"

**Archivos:**
- Crear: `apps/portal/src/lib/cobranzas.ts`
- Crear: `apps/portal/src/lib/cobranzas.test.ts`
- Modificar: `apps/portal/src/lib/ventas.ts` (`CobroDeVenta.origen`)
- Modificar: `apps/portal/src/components/ventas/detalle-venta.tsx`
- Modificar: `apps/portal/src/components/ventas/detalle-venta.test.tsx`

**Interfaces:**
- Consume: las formas de la Tarea 5 (copiadas a mano, como `lib/facturas.ts`).
- Produce (los usan las Tareas 7 y 8):

```ts
export type MetodoPagoCobro = "transferencia" | "efectivo" | "cheque";
export type OrigenAbono = "cobro" | "venta_contado" | "saldo_favor";
export type ModoCobro = "pago" | "saldo_favor";
export interface AbonoAnterior { fechaPago: string; montoCentavos: number; metodoPago: string; origen: OrigenAbono }
export interface NotaPorCobrar { id; folio; numNota: string | null; fecha; clienteId; cliente; sucursalCodigo; montoCentavos; saldoCentavos; status: "pendiente" | "abonado"; abonos: AbonoAnterior[] }
export interface ClientePorCobrar { id; nombre; sucursalId; sucursalCodigo; saldoFavorCentavos; notas: NotaPorCobrar[] }
export interface AplicacionDeCobro { notaId; folio; numNota; fecha; montoCentavos; saldoAntesCentavos; saldoDespuesCentavos; status: "pagada" | "abonado"; palomeada: boolean }
export interface PlanDeCobro { aplicaciones: AplicacionDeCobro[]; saldoFavorCentavos: number }
export interface CobroRegistrado extends PlanDeCobro { cliente: string; montoCentavos: number }
export interface NuevoCobro { clienteId; notaIds: string[]; montoCentavos; fechaPago; metodoPago: MetodoPagoCobro; vendedorId: string | null }
export const METODOS_PAGO_COBRO: { valor: MetodoPagoCobro; texto: string }[];
export const ETIQUETA_METODO_PAGO: Record<string, string>;
export const MENSAJE_MONTO: string;
export function porCobrarDeCliente(clienteId: string): Promise<ClientePorCobrar>;
export function buscarPorCobrar(filtro: { fecha: string } | { numNota: string }, sucursal: string | null): Promise<NotaPorCobrar[]>;
export function vistaPreviaCobro(cuerpo: { clienteId: string; notaIds: string[]; montoCentavos: number; modo: ModoCobro }): Promise<PlanDeCobro>;
export function registrarCobro(cobro: NuevoCobro): Promise<CobroRegistrado>;
export function aplicarSaldoFavor(cuerpo: { clienteId: string; notaIds: string[]; montoCentavos: number }): Promise<CobroRegistrado>;
export function leerMontoCentavos(texto: string): number | null;
export function textoMonto(centavos: number): string;
export function describirAplicacion(a: AplicacionDeCobro): string;
```

- [ ] **Paso 1: Pruebas que fallan**

`apps/portal/src/lib/cobranzas.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  aplicarSaldoFavor,
  buscarPorCobrar,
  describirAplicacion,
  leerMontoCentavos,
  porCobrarDeCliente,
  registrarCobro,
  textoMonto,
  vistaPreviaCobro,
} from "./cobranzas";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

describe("lib/cobranzas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue({});
  });

  it("porCobrarDeCliente pide por clienteId", async () => {
    await porCobrarDeCliente("c1");
    expect(apiFetch).toHaveBeenCalledWith("/cobranzas/por-cobrar?clienteId=c1");
  });

  it("buscarPorCobrar manda la fecha o el # de nota, y la sucursal si hay", async () => {
    await buscarPorCobrar({ fecha: "2026-10-01" }, "TJ");
    expect(apiFetch).toHaveBeenLastCalledWith("/cobranzas/por-cobrar?fecha=2026-10-01&sucursal=TJ");
    await buscarPorCobrar({ numNota: " 77 " }, null);
    expect(apiFetch).toHaveBeenLastCalledWith("/cobranzas/por-cobrar?numNota=77");
  });

  it("vista previa, pago y saldo a favor hacen POST con el cuerpo", async () => {
    await vistaPreviaCobro({ clienteId: "c1", notaIds: ["n1"], montoCentavos: 100, modo: "pago" });
    expect(apiFetch).toHaveBeenLastCalledWith("/cobranzas/vista-previa", {
      method: "POST",
      body: JSON.stringify({ clienteId: "c1", notaIds: ["n1"], montoCentavos: 100, modo: "pago" }),
    });
    const cobro = {
      clienteId: "c1",
      notaIds: ["n1"],
      montoCentavos: 100,
      fechaPago: "2026-10-01",
      metodoPago: "transferencia" as const,
      vendedorId: null,
    };
    await registrarCobro(cobro);
    expect(apiFetch).toHaveBeenLastCalledWith("/cobranzas", { method: "POST", body: JSON.stringify(cobro) });
    await aplicarSaldoFavor({ clienteId: "c1", notaIds: ["n1"], montoCentavos: 100 });
    expect(apiFetch).toHaveBeenLastCalledWith("/cobranzas/saldo-favor", {
      method: "POST",
      body: JSON.stringify({ clienteId: "c1", notaIds: ["n1"], montoCentavos: 100 }),
    });
  });
});

describe("leerMontoCentavos (Review Focus 4)", () => {
  it.each<[string, number]>([
    ["1500", 150000],
    ["1,500.50", 150050],
    ["$200", 20000],
    ["$ 1,234,567.89", 123456789],
    ["10.5", 1050],
    [" 0.07 ", 7],
    // 19.99 * 100 da 1998.9999999999998 en coma flotante: aquí no.
    ["19.99", 1999],
  ])("%s son %d centavos", (texto, centavos) => {
    expect(leerMontoCentavos(texto)).toBe(centavos);
  });

  it.each(["", "0", "0.00", "10.005", "1,50", "12,34.00", "-5", "abc", "1.2.3", "1e3"])(
    "%j no es un monto",
    (texto) => {
      expect(leerMontoCentavos(texto)).toBeNull();
    },
  );
});

describe("textos del cobro", () => {
  it("textoMonto escribe los centavos sin coma flotante", () => {
    expect(textoMonto(150050)).toBe("1500.50");
    expect(textoMonto(7)).toBe("0.07");
  });

  it("describirAplicacion dice si queda pagada o lo que debe (§3.3)", () => {
    const base = {
      notaId: "n1",
      folio: "TJ261001AP03",
      numNota: null,
      fecha: "2026-10-01",
      saldoAntesCentavos: 70000,
      palomeada: true,
    };
    expect(
      describirAplicacion({ ...base, montoCentavos: 70000, saldoDespuesCentavos: 0, status: "pagada" }),
    ).toBe("TJ261001AP03 pagada");
    expect(
      describirAplicacion({ ...base, montoCentavos: 20000, saldoDespuesCentavos: 50000, status: "abonado" }),
    ).toBe("TJ261001AP03 abono $200.00, debe $500.00");
  });
});
```

En `apps/portal/src/components/ventas/detalle-venta.test.tsx`, dentro del `describe("DetalleVenta", …)`, agrega:

```tsx
  it("un abono de saldo a favor (T-21) se ve como Saldo a favor, en método y en origen", () => {
    renderizar({
      ...VENTA,
      cobros: [
        { id: "a2", fechaPago: "2024-03-06", metodoPago: "saldo_favor", montoCentavos: 5000, origen: "saldo_favor" },
      ],
    });
    expect(screen.getAllByText("Saldo a favor")).toHaveLength(2);
  });
```

Run: `npm test --workspace=apps/portal -- cobranzas detalle-venta`
Expected: FAIL (no existe `lib/cobranzas.ts`; `"saldo_favor"` no es un `origen` válido de `CobroDeVenta`).

- [ ] **Paso 2: Implementar `lib/cobranzas.ts`**

`apps/portal/src/lib/cobranzas.ts`:

```ts
import { apiFetch } from "./api";
import { formatearPesos } from "./ventas";

// Copia normativa de las formas de
// apps/backend/src/modules/ventas-cobranza/cobranzas-portal.repository.ts (`AbonoAnterior`,
// `NotaPorCobrar`), cobranzas-portal.service.ts (`ClientePorCobrar`, `CobroRegistrado`),
// cobranzas.service.ts (`AplicacionDeCobro`, `PlanDeCobro`) y dto/cobranzas.dto.ts. Mismo trato
// que lib/facturas.ts: un cambio de forma en un lado exige el equivalente en el otro.

export type MetodoPagoCobro = "transferencia" | "efectivo" | "cheque";
export type OrigenAbono = "cobro" | "venta_contado" | "saldo_favor";
export type ModoCobro = "pago" | "saldo_favor";

export interface AbonoAnterior {
  fechaPago: string;
  montoCentavos: number;
  metodoPago: string;
  origen: OrigenAbono;
}

/** Una nota por cobrar (`pendiente`/`abonado`, viva), de la más vieja a la más nueva. */
export interface NotaPorCobrar {
  id: string;
  folio: string;
  /** `null` = sin nota de papel. */
  numNota: string | null;
  fecha: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  montoCentavos: number;
  saldoCentavos: number;
  status: "pendiente" | "abonado";
  abonos: AbonoAnterior[];
}

export interface ClientePorCobrar {
  id: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
  saldoFavorCentavos: number;
  notas: NotaPorCobrar[];
}

export interface AplicacionDeCobro {
  notaId: string;
  folio: string;
  numNota: string | null;
  fecha: string;
  montoCentavos: number;
  saldoAntesCentavos: number;
  saldoDespuesCentavos: number;
  status: "pagada" | "abonado";
  /** `true` si la oficina la marcó; `false` si le tocó del excedente. */
  palomeada: boolean;
}

/** Lo calcula el servidor con la misma regla que la tablet: aquí no se reparte nada. */
export interface PlanDeCobro {
  aplicaciones: AplicacionDeCobro[];
  saldoFavorCentavos: number;
}

export interface CobroRegistrado extends PlanDeCobro {
  cliente: string;
  montoCentavos: number;
}

/** El cuerpo de `POST /cobranzas`. `vendedorId: null` = Oficina. */
export interface NuevoCobro {
  clienteId: string;
  notaIds: string[];
  montoCentavos: number;
  fechaPago: string;
  metodoPago: MetodoPagoCobro;
  vendedorId: string | null;
}

/** Transferencia primero: es el default de la oficina (§3.3). */
export const METODOS_PAGO_COBRO: { valor: MetodoPagoCobro; texto: string }[] = [
  { valor: "transferencia", texto: "Transferencia" },
  { valor: "efectivo", texto: "Efectivo" },
  { valor: "cheque", texto: "Cheque" },
];

/** Cómo se nombra el método de un abono. `saldo_favor` no es dinero nuevo (T-21). */
export const ETIQUETA_METODO_PAGO: Record<string, string> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  cheque: "Cheque",
  saldo_favor: "Saldo a favor",
};

export const MENSAJE_MONTO = "El monto debe ser mayor a $0 y tener a lo más 2 decimales.";

export function porCobrarDeCliente(clienteId: string): Promise<ClientePorCobrar> {
  return apiFetch<ClientePorCobrar>(`/cobranzas/por-cobrar?clienteId=${encodeURIComponent(clienteId)}`);
}

export function buscarPorCobrar(
  filtro: { fecha: string } | { numNota: string },
  sucursal: string | null,
): Promise<NotaPorCobrar[]> {
  const params = new URLSearchParams();
  if ("fecha" in filtro) params.set("fecha", filtro.fecha);
  else params.set("numNota", filtro.numNota.trim());
  if (sucursal) params.set("sucursal", sucursal);
  return apiFetch<NotaPorCobrar[]>(`/cobranzas/por-cobrar?${params.toString()}`);
}

export function vistaPreviaCobro(cuerpo: {
  clienteId: string;
  notaIds: string[];
  montoCentavos: number;
  modo: ModoCobro;
}): Promise<PlanDeCobro> {
  return apiFetch<PlanDeCobro>("/cobranzas/vista-previa", {
    method: "POST",
    body: JSON.stringify(cuerpo),
  });
}

export function registrarCobro(cobro: NuevoCobro): Promise<CobroRegistrado> {
  return apiFetch<CobroRegistrado>("/cobranzas", { method: "POST", body: JSON.stringify(cobro) });
}

export function aplicarSaldoFavor(cuerpo: {
  clienteId: string;
  notaIds: string[];
  montoCentavos: number;
}): Promise<CobroRegistrado> {
  return apiFetch<CobroRegistrado>("/cobranzas/saldo-favor", {
    method: "POST",
    body: JSON.stringify(cuerpo),
  });
}

/**
 * Lo tecleado a centavos **sin punto flotante** (`19.99 * 100` da
 * `1998.9999999999998`): se parte el texto en enteros y decimales. Acepta `$`
 * al inicio y comas de miles bien puestas (`1,500.50`); a lo más 2 decimales.
 * `null` si no se entiende o si no es mayor a 0.
 */
export function leerMontoCentavos(texto: string): number | null {
  const limpio = texto.trim().replace(/^\$/, "").trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(limpio)) return null;
  const [enteros, decimales = ""] = limpio.replace(/,/g, "").split(".");
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) && centavos > 0 ? centavos : null;
}

/** Centavos al texto del campo (`"1500.50"`), sin coma flotante. */
export function textoMonto(centavos: number): string {
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}

/** "TJ… pagada" o "TJ… abono $200.00, debe $500.00" (§3.3). */
export function describirAplicacion(a: AplicacionDeCobro): string {
  return a.saldoDespuesCentavos === 0
    ? `${a.folio} pagada`
    : `${a.folio} abono ${formatearPesos(a.montoCentavos)}, debe ${formatearPesos(a.saldoDespuesCentavos)}`;
}
```

- [ ] **Paso 3: El detalle de venta conoce el saldo a favor**

`apps/portal/src/lib/ventas.ts`: en `CobroDeVenta`, `origen: "cobro" | "venta_contado";` pasa a
`origen: "cobro" | "venta_contado" | "saldo_favor";`.

`apps/portal/src/components/ventas/detalle-venta.tsx`:
- agrega `import { ETIQUETA_METODO_PAGO } from "@/lib/cobranzas";`;
- en `ETIQUETA_COBRO` agrega `saldo_favor: "Saldo a favor",`;
- **borra** la constante local `ETIQUETA_METODO` y en la tabla de cobros cambia
  `{ETIQUETA_METODO[c.metodoPago] ?? c.metodoPago}` por `{ETIQUETA_METODO_PAGO[c.metodoPago] ?? c.metodoPago}`.

- [ ] **Paso 4: Correr pruebas, lint y tipos**

Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npx tsc --noEmit -p apps/portal`
Expected: todo en verde.

- [ ] **Paso 5: Commit**

```bash
git add apps/portal/src/lib/cobranzas.ts apps/portal/src/lib/cobranzas.test.ts apps/portal/src/lib/ventas.ts \
  apps/portal/src/components/ventas/detalle-venta.tsx apps/portal/src/components/ventas/detalle-venta.test.tsx
git commit -m "T-21: portal — lib de cobranzas y el detalle de venta muestra Saldo a favor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 7: Portal — *Operación → Cobranza*: buscar y ver las notas del cliente

**Archivos:**
- Crear: `apps/portal/src/app/(portal)/operacion/cobranza/page.tsx`
- Modificar: `apps/portal/src/components/layout/nav-config.ts`
- Crear: `apps/portal/src/components/cobranza/pantalla-cobranza.tsx` y `pantalla-cobranza.test.tsx`
- Crear: `apps/portal/src/components/cobranza/buscar-por-cobrar.tsx` y `buscar-por-cobrar.test.tsx`
- Crear: `apps/portal/src/components/cobranza/cobranza-cliente.tsx` y `cobranza-cliente.test.tsx`

**Interfaces:**
- Consume: Tarea 6 (`porCobrarDeCliente`, `buscarPorCobrar`, `ETIQUETA_METODO_PAGO`, tipos); `marcarCuentaPerdida`,
  `ETIQUETA_STATUS`, `formatearPesos`, `hoyEnTijuana` (`lib/ventas.ts`); `BuscadorCliente`; `listarClientes`; `useAuth`.
- Produce (la Tarea 8 inserta sus formularios en `CobranzaCliente`):
  - `PantallaCobranza({ sucursal }: { sucursal: string | null })`
  - `BuscarPorCobrar({ sucursal, onElegir }: { sucursal: string | null; onElegir: (clienteId: string, notaId: string | null) => void })`
  - `CobranzaCliente({ clienteId, notaInicial, onVolver }: { clienteId: string; notaInicial: string | null; onVolver: () => void })`,
    con `palomeadas: NotaPorCobrar[]` (las marcadas, en el orden de la tabla) y
    `recargar: (mensaje: string | null) => void` dentro del componente.

- [ ] **Paso 1: Pruebas que fallan**

`apps/portal/src/components/cobranza/buscar-por-cobrar.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as cobranzasLib from "@/lib/cobranzas";
import type { NotaPorCobrar } from "@/lib/cobranzas";
import { BuscarPorCobrar } from "./buscar-por-cobrar";

vi.mock("@/lib/clientes");
vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, buscarPorCobrar: vi.fn() };
});

const listarClientes = vi.mocked(clientesLib.listarClientes);
const buscarPorCobrar = vi.mocked(cobranzasLib.buscarPorCobrar);

const CLIENTE: ClienteResumen = {
  id: "c1", nombre: "Cobach XXI", telefono: "664", tipo: "cliente", tipoNegocio: null, sucursalCodigo: "TJ",
};
const NOTA: NotaPorCobrar = {
  id: "n1", folio: "TJ240401OF01", numNota: "77", fecha: "2024-04-01", clienteId: "c1", cliente: "Cobach XXI",
  sucursalCodigo: "TJ", montoCentavos: 10000, saldoCentavos: 4000, status: "abonado", abonos: [],
};

function renderizar(sucursal: string | null = "TJ") {
  const onElegir = vi.fn();
  render(<BuscarPorCobrar sucursal={sucursal} onElegir={onElegir} />);
  return { usuario: userEvent.setup(), onElegir };
}

describe("BuscarPorCobrar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarClientes.mockResolvedValue([CLIENTE]);
    buscarPorCobrar.mockResolvedValue([NOTA]);
  });

  it("por cliente entra directo a su cobranza", async () => {
    const { usuario, onElegir } = renderizar();
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(onElegir).toHaveBeenCalledWith("c1", null);
  });

  it("por fecha lista las notas por cobrar y un clic entra al cliente con esa nota", async () => {
    const { usuario, onElegir } = renderizar();
    fireEvent.change(screen.getByLabelText("Fecha de la venta"), { target: { value: "2024-04-01" } });
    await usuario.click(screen.getByRole("button", { name: "Buscar por fecha" }));
    expect(buscarPorCobrar).toHaveBeenCalledWith({ fecha: "2024-04-01" }, "TJ");
    expect(await screen.findByText("TJ240401OF01")).toBeInTheDocument();
    expect(screen.getByText("$40.00")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Cobrar TJ240401OF01" }));
    expect(onElegir).toHaveBeenCalledWith("c1", "n1");
  });

  it("por # de nota", async () => {
    const { usuario } = renderizar(null);
    await usuario.type(screen.getByLabelText("# de nota"), "77");
    await usuario.click(screen.getByRole("button", { name: "Buscar por # de nota" }));
    expect(buscarPorCobrar).toHaveBeenCalledWith({ numNota: "77" }, null);
  });

  it("sin resultados lo dice", async () => {
    buscarPorCobrar.mockResolvedValue([]);
    const { usuario } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Buscar por fecha" }));
    expect(await screen.findByText("No hay notas por cobrar con esa búsqueda.")).toBeInTheDocument();
  });

  it("muestra el mensaje del servidor", async () => {
    buscarPorCobrar.mockRejectedValue(new ErrorApi("x", 400, "Esa fecha no existe."));
    const { usuario } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Buscar por fecha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esa fecha no existe.");
  });
});
```

`apps/portal/src/components/cobranza/cobranza-cliente.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as cobranzasLib from "@/lib/cobranzas";
import type { ClientePorCobrar, NotaPorCobrar } from "@/lib/cobranzas";
import * as ventasLib from "@/lib/ventas";
import type { VentaDetalle } from "@/lib/ventas";
import { CobranzaCliente } from "./cobranza-cliente";

vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return {
    ...real,
    porCobrarDeCliente: vi.fn(),
    vistaPreviaCobro: vi.fn(),
    registrarCobro: vi.fn(),
    aplicarSaldoFavor: vi.fn(),
  };
});
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, marcarCuentaPerdida: vi.fn(), listarRepartidores: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const porCobrarDeCliente = vi.mocked(cobranzasLib.porCobrarDeCliente);
const marcarCuentaPerdida = vi.mocked(ventasLib.marcarCuentaPerdida);
const listarRepartidores = vi.mocked(ventasLib.listarRepartidores);

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

const N1: NotaPorCobrar = {
  id: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", clienteId: "c1", cliente: "Cobach XXI",
  sucursalCodigo: "TJ", montoCentavos: 10000, saldoCentavos: 10000, status: "pendiente", abonos: [],
};
const N2: NotaPorCobrar = {
  ...N1, id: "n2", folio: "TJ240402OF01", numNota: "77", fecha: "2024-04-02", montoCentavos: 8000, saldoCentavos: 5000,
  status: "abonado",
  abonos: [{ fechaPago: "2024-04-03", montoCentavos: 3000, metodoPago: "saldo_favor", origen: "saldo_favor" }],
};
const DATOS: ClientePorCobrar = {
  id: "c1", nombre: "Cobach XXI", sucursalId: "suc-tj", sucursalCodigo: "TJ", saldoFavorCentavos: 0, notas: [N1, N2],
};

function renderizar(notaInicial: string | null = null) {
  const onVolver = vi.fn();
  render(<CobranzaCliente clienteId="c1" notaInicial={notaInicial} onVolver={onVolver} />);
  return { usuario: userEvent.setup(), onVolver };
}

describe("CobranzaCliente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockAuth(() => true);
    porCobrarDeCliente.mockResolvedValue(DATOS);
    listarRepartidores.mockResolvedValue([]);
  });

  it("muestra sus notas por cobrar con su saldo; la nota con la que entró ya va marcada", async () => {
    renderizar("n2");
    expect(await screen.findByText("Cobranza · Cobach XXI")).toBeInTheDocument();
    expect(porCobrarDeCliente).toHaveBeenCalledWith("c1");
    expect(screen.getByLabelText("Marcar TJ240402OF01")).toBeChecked();
    expect(screen.getByLabelText("Marcar TJ240401OF01")).not.toBeChecked();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getByText("Abonado")).toBeInTheDocument();
  });

  it("los abonos anteriores dicen fecha, monto y método (Saldo a favor incluido)", async () => {
    renderizar();
    expect(await screen.findByText("1 abono")).toBeInTheDocument();
    expect(screen.getByText("2024-04-03 · $30.00 · Saldo a favor")).toBeInTheDocument();
  });

  it("el saldo a favor del cliente se ve solo si hay", async () => {
    porCobrarDeCliente.mockResolvedValue({ ...DATOS, saldoFavorCentavos: 2500 });
    renderizar();
    expect(await screen.findByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText(/Saldo a favor:/)).toBeInTheDocument();
  });

  it("sin notas por cobrar lo dice", async () => {
    porCobrarDeCliente.mockResolvedValue({ ...DATOS, notas: [] });
    renderizar();
    expect(await screen.findByText("Este cliente no tiene notas por cobrar.")).toBeInTheDocument();
  });

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

  it("sin venta.editar_eliminar no hay botón de cuenta perdida", async () => {
    mockAuth((clave) => clave !== "venta.editar_eliminar");
    renderizar();
    await screen.findByText("Cobranza · Cobach XXI");
    expect(screen.queryByRole("button", { name: /como cuenta perdida/ })).not.toBeInTheDocument();
  });

  it("Volver avisa al padre", async () => {
    const { usuario, onVolver } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "← Volver a buscar" }));
    expect(onVolver).toHaveBeenCalledTimes(1);
  });

  it("si falla la carga lo dice", async () => {
    porCobrarDeCliente.mockRejectedValue(new Error("red"));
    renderizar();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar la cobranza del cliente.");
  });
});
```

`apps/portal/src/components/cobranza/pantalla-cobranza.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as cobranzasLib from "@/lib/cobranzas";
import * as ventasLib from "@/lib/ventas";
import { PantallaCobranza } from "./pantalla-cobranza";

vi.mock("@/lib/clientes");
vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, buscarPorCobrar: vi.fn(), porCobrarDeCliente: vi.fn() };
});
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, listarRepartidores: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const listarClientes = vi.mocked(clientesLib.listarClientes);
const porCobrarDeCliente = vi.mocked(cobranzasLib.porCobrarDeCliente);

const CLIENTE: ClienteResumen = {
  id: "c1", nombre: "Cobach XXI", telefono: "664", tipo: "cliente", tipoNegocio: null, sucursalCodigo: "TJ",
};

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

describe("PantallaCobranza", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarClientes.mockResolvedValue([CLIENTE]);
    porCobrarDeCliente.mockResolvedValue({
      id: "c1", nombre: "Cobach XXI", sucursalId: "suc-tj", sucursalCodigo: "TJ", saldoFavorCentavos: 0, notas: [],
    });
    vi.mocked(ventasLib.listarRepartidores).mockResolvedValue([]);
  });

  it("sin cobranza.registrar lo dice y no pide nada", () => {
    mockAuth(() => false);
    render(<PantallaCobranza sucursal={null} />);
    expect(screen.getByText("No tienes permiso para registrar cobranza")).toBeInTheDocument();
    expect(listarClientes).not.toHaveBeenCalled();
  });

  it("de la búsqueda entra al cliente y vuelve", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaCobranza sucursal={null} />);
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(await screen.findByText("Cobranza · Cobach XXI")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "← Volver a buscar" }));
    expect(screen.getByLabelText("Fecha de la venta")).toBeInTheDocument();
  });
});
```

Run: `npm test --workspace=apps/portal -- cobranza`
Expected: FAIL (los componentes no existen).

- [ ] **Paso 2: Implementar `BuscarPorCobrar`**

`apps/portal/src/components/cobranza/buscar-por-cobrar.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import { buscarPorCobrar, type NotaPorCobrar } from "@/lib/cobranzas";
import { ETIQUETA_STATUS, formatearPesos, hoyEnTijuana } from "@/lib/ventas";

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

  async function buscar(filtro: { fecha: string } | { numNota: string }) {
    setBuscando(true);
    setError(null);
    try {
      setNotas(await buscarPorCobrar(filtro, sucursal));
    } catch (err) {
      setNotas(null);
      setError(mensajeDe(err, "No se pudieron buscar las notas por cobrar."));
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <BuscadorCliente clientes={clientes} cliente={null} onElegir={(c) => onElegir(c.id, null)} onQuitar={() => {}} />

      <div className="flex flex-wrap items-end gap-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void buscar({ fecha });
          }}
          className="flex items-end gap-2"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cobranza-fecha" className="text-sm font-medium">
              Fecha de la venta
            </label>
            <input
              id="cobranza-fecha"
              type="date"
              required
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cobranza-num-nota" className="text-sm font-medium">
              # de nota
            </label>
            <input
              id="cobranza-num-nota"
              maxLength={30}
              value={numNota}
              onChange={(e) => setNumNota(e.target.value)}
              className="w-40 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" variant="outline" disabled={buscando || numNota.trim() === ""}>
            Buscar por # de nota
          </Button>
        </form>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {notas !== null &&
        (notas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay notas por cobrar con esa búsqueda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-1.5">Cliente</th>
                <th className="py-1.5">Fecha</th>
                <th className="py-1.5">Folio</th>
                <th className="py-1.5"># de nota</th>
                <th className="py-1.5 text-right">Total</th>
                <th className="py-1.5 text-right">Saldo</th>
                <th className="py-1.5">Status</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {notas.map((n) => (
                <tr key={n.id} className="border-t">
                  <td className="py-1.5">
                    {n.cliente} · {n.sucursalCodigo}
                  </td>
                  <td className="py-1.5">{n.fecha}</td>
                  <td className="py-1.5 font-mono">{n.folio}</td>
                  <td className="py-1.5">{n.numNota ?? "—"}</td>
                  <td className="py-1.5 text-right">{formatearPesos(n.montoCentavos)}</td>
                  <td className="py-1.5 text-right font-semibold">{formatearPesos(n.saldoCentavos)}</td>
                  <td className="py-1.5">{ETIQUETA_STATUS[n.status]}</td>
                  <td className="py-1.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      aria-label={`Cobrar ${n.folio}`}
                      onClick={() => onElegir(n.clienteId, n.id)}
                    >
                      Cobrar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}
```

- [ ] **Paso 3: Implementar `CobranzaCliente`**

`apps/portal/src/components/cobranza/cobranza-cliente.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { ETIQUETA_METODO_PAGO, porCobrarDeCliente, type ClientePorCobrar } from "@/lib/cobranzas";
import { ETIQUETA_STATUS, formatearPesos, marcarCuentaPerdida } from "@/lib/ventas";

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
  const [datos, setDatos] = useState<ClientePorCobrar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set(notaInicial ? [notaInicial] : []));
  const [aviso, setAviso] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [marcando, setMarcando] = useState(false);

  useEffect(() => {
    let vigente = true;
    porCobrarDeCliente(clienteId)
      .then((d) => {
        if (!vigente) return;
        setDatos(d);
        setError(null);
        // Una nota que ya no está por cobrar (la pagó alguien) se desmarca sola.
        setSeleccion((actual) => new Set([...actual].filter((id) => d.notas.some((n) => n.id === id))));
      })
      .catch((err) => {
        if (vigente) setError(mensajeDe(err, "No se pudo cargar la cobranza del cliente."));
      });
    return () => {
      vigente = false;
    };
  }, [clienteId, recarga]);

  const recargar = useCallback((mensaje: string | null) => {
    setAviso(mensaje);
    setRecarga((n) => n + 1);
  }, []);

  function alternar(id: string) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  async function marcarPerdida(id: string, folio: string) {
    if (!window.confirm(`La venta ${folio} dejará de cobrarse. ¿Continuar?`)) return;
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{datos ? `Cobranza · ${datos.nombre}` : "Cobranza"}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <Button type="button" variant="outline" onClick={onVolver}>
            ← Volver a buscar
          </Button>
        </div>

        {datos && datos.saldoFavorCentavos > 0 && (
          <p className="text-sm">
            Saldo a favor: <span className="font-semibold">{formatearPesos(datos.saldoFavorCentavos)}</span>
          </p>
        )}

        {aviso && (
          <p role="status" className="rounded-md border p-3 text-sm">
            {aviso}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {datos &&
          (datos.notas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este cliente no tiene notas por cobrar.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-1.5" />
                  <th className="py-1.5">Fecha</th>
                  <th className="py-1.5">Folio</th>
                  <th className="py-1.5"># de nota</th>
                  <th className="py-1.5 text-right">Total</th>
                  <th className="py-1.5 text-right">Saldo</th>
                  <th className="py-1.5">Status</th>
                  <th className="py-1.5">Abonos anteriores</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {datos.notas.map((n) => (
                  <tr key={n.id} className="border-t align-top">
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Marcar ${n.folio}`}
                        checked={seleccion.has(n.id)}
                        onChange={() => alternar(n.id)}
                      />
                    </td>
                    <td className="py-1.5">{n.fecha}</td>
                    <td className="py-1.5 font-mono">{n.folio}</td>
                    <td className="py-1.5">{n.numNota ?? "—"}</td>
                    <td className="py-1.5 text-right">{formatearPesos(n.montoCentavos)}</td>
                    <td className="py-1.5 text-right font-semibold">{formatearPesos(n.saldoCentavos)}</td>
                    <td className="py-1.5">{ETIQUETA_STATUS[n.status]}</td>
                    <td className="py-1.5">
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
                                {`${a.fechaPago} · ${formatearPesos(a.montoCentavos)} · ${ETIQUETA_METODO_PAGO[a.metodoPago] ?? a.metodoPago}`}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {palomeadas.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {palomeadas.length} {palomeadas.length === 1 ? "nota marcada" : "notas marcadas"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Paso 4: La pantalla, la página y el menú**

`apps/portal/src/components/cobranza/pantalla-cobranza.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { BuscarPorCobrar } from "./buscar-por-cobrar";
import { CobranzaCliente } from "./cobranza-cliente";

type Vista = { tipo: "buscar" } | { tipo: "cliente"; clienteId: string; notaId: string | null };

/** Operación → Cobranza (T-21): buscar la cuenta por cobrar y registrar el pago. */
export function PantallaCobranza({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const [vista, setVista] = useState<Vista>({ tipo: "buscar" });

  if (!puede("cobranza.registrar")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cobranza</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para registrar cobranza</p>
        </CardContent>
      </Card>
    );
  }

  if (vista.tipo === "cliente") {
    return (
      <CobranzaCliente
        clienteId={vista.clienteId}
        notaInicial={vista.notaId}
        onVolver={() => setVista({ tipo: "buscar" })}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cobranza</CardTitle>
      </CardHeader>
      <CardContent>
        <BuscarPorCobrar
          sucursal={sucursal}
          onElegir={(clienteId, notaId) => setVista({ tipo: "cliente", clienteId, notaId })}
        />
      </CardContent>
    </Card>
  );
}
```

`apps/portal/src/app/(portal)/operacion/cobranza/page.tsx`:

```tsx
import { PantallaCobranza } from "@/components/cobranza/pantalla-cobranza";

// Server component delgado (mismo patron que /operacion/facturas).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaCobranza sucursal={sucursal ?? null} />;
}
```

`apps/portal/src/components/layout/nav-config.ts`: después de
`{ label: "Facturas", href: "/operacion/facturas" },` agrega
`{ label: "Cobranza", href: "/operacion/cobranza" },`.

- [ ] **Paso 5: Correr pruebas, lint, tipos y build**

Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npx tsc --noEmit -p apps/portal && npm run build --workspace=apps/portal`
Expected: todo en verde; el build lista la ruta `/operacion/cobranza`.

- [ ] **Paso 6: Commit**

```bash
git add apps/portal/src/components/cobranza "apps/portal/src/app/(portal)/operacion/cobranza" \
  apps/portal/src/components/layout/nav-config.ts
git commit -m "T-21: portal — Operacion > Cobranza: buscar y ver las notas por cobrar del cliente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 8: Portal — registrar el pago y aplicar el saldo a favor

**Archivos:**
- Crear: `apps/portal/src/components/cobranza/vista-previa-cobro.tsx`
- Crear: `apps/portal/src/components/cobranza/registrar-pago.tsx` y `registrar-pago.test.tsx`
- Crear: `apps/portal/src/components/cobranza/aplicar-saldo-favor.tsx` y `aplicar-saldo-favor.test.tsx`
- Modificar: `apps/portal/src/components/cobranza/cobranza-cliente.tsx` y `cobranza-cliente.test.tsx`

**Interfaces:**
- Consume: Tarea 6 (`vistaPreviaCobro`, `registrarCobro`, `aplicarSaldoFavor`, `leerMontoCentavos`, `textoMonto`,
  `describirAplicacion`, `METODOS_PAGO_COBRO`, `MENSAJE_MONTO`); Tarea 7 (`CobranzaCliente`: `palomeadas`,
  `recargar`); `listarRepartidores`, `REPARTIDOR_OFICINA`, `hoyEnTijuana`, `formatearPesos` (`lib/ventas.ts`);
  `useEnvioFormulario`.
- Produce:
  - `VistaPreviaCobro({ plan, palomeadas }: { plan: PlanDeCobro; palomeadas: NotaPorCobrar[] })`
  - `RegistrarPago({ cliente, palomeadas, onRegistrado }: { cliente: ClientePorCobrar; palomeadas: NotaPorCobrar[]; onRegistrado: (mensaje: string) => void })`
  - `AplicarSaldoFavor({ cliente, palomeadas, onAplicado }: { cliente: ClientePorCobrar; palomeadas: NotaPorCobrar[]; onAplicado: (mensaje: string) => void })`

- [ ] **Paso 1: Pruebas que fallan**

`apps/portal/src/components/cobranza/registrar-pago.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as cobranzasLib from "@/lib/cobranzas";
import type { ClientePorCobrar, NotaPorCobrar, PlanDeCobro } from "@/lib/cobranzas";
import * as ventasLib from "@/lib/ventas";
import { hoyEnTijuana } from "@/lib/ventas";
import { RegistrarPago } from "./registrar-pago";

vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, vistaPreviaCobro: vi.fn(), registrarCobro: vi.fn() };
});
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, listarRepartidores: vi.fn() };
});

const vistaPreviaCobro = vi.mocked(cobranzasLib.vistaPreviaCobro);
const registrarCobro = vi.mocked(cobranzasLib.registrarCobro);

const N1: NotaPorCobrar = {
  id: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", clienteId: "c1", cliente: "Cobach XXI",
  sucursalCodigo: "TJ", montoCentavos: 10000, saldoCentavos: 10000, status: "pendiente", abonos: [],
};
const N2: NotaPorCobrar = {
  ...N1, id: "n2", folio: "TJ240402OF01", fecha: "2024-04-02", montoCentavos: 8000, saldoCentavos: 6000, status: "abonado",
};
const CLIENTE: ClientePorCobrar = {
  id: "c1", nombre: "Cobach XXI", sucursalId: "suc-tj", sucursalCodigo: "TJ", saldoFavorCentavos: 0, notas: [N1, N2],
};
const PLAN: PlanDeCobro = {
  aplicaciones: [
    { notaId: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, status: "pagada", palomeada: true },
    { notaId: "n2", folio: "TJ240402OF01", numNota: null, fecha: "2024-04-02", montoCentavos: 5000, saldoAntesCentavos: 6000, saldoDespuesCentavos: 1000, status: "abonado", palomeada: true },
  ],
  saldoFavorCentavos: 0,
};

function renderizar() {
  const onRegistrado = vi.fn();
  render(<RegistrarPago cliente={CLIENTE} palomeadas={[N2, N1]} onRegistrado={onRegistrado} />);
  return { usuario: userEvent.setup(), onRegistrado };
}

describe("RegistrarPago", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ventasLib.listarRepartidores).mockResolvedValue([{ id: "v1", nombre: "Ana" }]);
    vistaPreviaCobro.mockResolvedValue(PLAN);
    registrarCobro.mockResolvedValue({ ...PLAN, cliente: "Cobach XXI", montoCentavos: 15000 });
  });

  it("Review Focus 4: un monto con 3 decimales no pide vista previa y lo dice", async () => {
    const { usuario } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150.005");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El monto debe ser mayor a $0 y tener a lo más 2 decimales.",
    );
    expect(vistaPreviaCobro).not.toHaveBeenCalled();
  });

  it("Review Focus 2: una fecha anterior a la nota más vieja, o futura, se avisa sin llamar al servidor", async () => {
    const { usuario } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150");
    fireEvent.change(screen.getByLabelText("Fecha del pago"), { target: { value: "2024-03-31" } });
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "La fecha del pago no puede ser anterior a la nota más vieja que marcaste (2024-04-01).",
    );
    fireEvent.change(screen.getByLabelText("Fecha del pago"), { target: { value: "2999-01-01" } });
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha del pago no puede ser futura.");
    expect(vistaPreviaCobro).not.toHaveBeenCalled();
  });

  it("Review Focus 4: la vista previa va en centavos exactos y dice cómo quedan las notas", async () => {
    const { usuario } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "1,500.50");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(vistaPreviaCobro).toHaveBeenCalledWith({
      clienteId: "c1",
      notaIds: ["n2", "n1"],
      montoCentavos: 150050,
      modo: "pago",
    });
    expect(await screen.findByText("TJ240401OF01 pagada")).toBeInTheDocument();
    expect(screen.getByText("TJ240402OF01 abono $50.00, debe $10.00")).toBeInTheDocument();
  });

  it("grabar manda Oficina, transferencia y hoy por default, y avisa con el mensaje del spec", async () => {
    const { usuario, onRegistrado } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    await usuario.click(await screen.findByRole("button", { name: "Grabar cobro" }));
    expect(registrarCobro).toHaveBeenCalledWith({
      clienteId: "c1",
      notaIds: ["n2", "n1"],
      montoCentavos: 15000,
      fechaPago: hoyEnTijuana(),
      metodoPago: "transferencia",
      vendedorId: null,
    });
    expect(onRegistrado).toHaveBeenCalledWith("Cobro registrado: $150.00 a Cobach XXI");
  });

  it("un repartidor y cheque viajan en el cuerpo", async () => {
    const { usuario } = renderizar();
    await screen.findByRole("option", { name: "Ana" });
    await usuario.selectOptions(screen.getByLabelText("Cobró"), "v1");
    await usuario.selectOptions(screen.getByLabelText("Método"), "cheque");
    await usuario.type(screen.getByLabelText("Monto"), "150");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    await usuario.click(await screen.findByRole("button", { name: "Grabar cobro" }));
    expect(registrarCobro).toHaveBeenCalledWith(
      expect.objectContaining({ vendedorId: "v1", metodoPago: "cheque" }),
    );
  });

  it("cambiar el monto después de la vista previa la quita: lo que se graba es lo que se vio", async () => {
    const { usuario } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    await screen.findByRole("button", { name: "Grabar cobro" });
    await usuario.type(screen.getByLabelText("Monto"), "0");
    expect(screen.queryByRole("button", { name: "Grabar cobro" })).not.toBeInTheDocument();
  });

  it("muestra el mensaje del servidor", async () => {
    registrarCobro.mockRejectedValue(
      new ErrorApi("x", 409, "La nota TJ240401OF01 ya no tiene saldo; vuelve a cargar."),
    );
    const { usuario, onRegistrado } = renderizar();
    await usuario.type(screen.getByLabelText("Monto"), "150");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    await usuario.click(await screen.findByRole("button", { name: "Grabar cobro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La nota TJ240401OF01 ya no tiene saldo; vuelve a cargar.",
    );
    expect(onRegistrado).not.toHaveBeenCalled();
  });
});
```

`apps/portal/src/components/cobranza/aplicar-saldo-favor.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as cobranzasLib from "@/lib/cobranzas";
import type { ClientePorCobrar, NotaPorCobrar, PlanDeCobro } from "@/lib/cobranzas";
import { AplicarSaldoFavor } from "./aplicar-saldo-favor";

vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, vistaPreviaCobro: vi.fn(), aplicarSaldoFavor: vi.fn() };
});

const vistaPreviaCobro = vi.mocked(cobranzasLib.vistaPreviaCobro);
const aplicarSaldoFavor = vi.mocked(cobranzasLib.aplicarSaldoFavor);

const N1: NotaPorCobrar = {
  id: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", clienteId: "c1", cliente: "Cobach XXI",
  sucursalCodigo: "TJ", montoCentavos: 10000, saldoCentavos: 10000, status: "pendiente", abonos: [],
};
const N2: NotaPorCobrar = { ...N1, id: "n2", folio: "TJ240402OF01", fecha: "2024-04-02", saldoCentavos: 6000 };
const CLIENTE: ClientePorCobrar = {
  id: "c1", nombre: "Cobach XXI", sucursalId: "suc-tj", sucursalCodigo: "TJ", saldoFavorCentavos: 30000, notas: [N1, N2],
};
const PLAN: PlanDeCobro = {
  aplicaciones: [
    { notaId: "n1", folio: "TJ240401OF01", numNota: null, fecha: "2024-04-01", montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, status: "pagada", palomeada: true },
    { notaId: "n2", folio: "TJ240402OF01", numNota: null, fecha: "2024-04-02", montoCentavos: 6000, saldoAntesCentavos: 6000, saldoDespuesCentavos: 0, status: "pagada", palomeada: true },
  ],
  saldoFavorCentavos: 0,
};

function renderizar() {
  const onAplicado = vi.fn();
  render(<AplicarSaldoFavor cliente={CLIENTE} palomeadas={[N1, N2]} onAplicado={onAplicado} />);
  return { usuario: userEvent.setup(), onAplicado };
}

describe("AplicarSaldoFavor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vistaPreviaCobro.mockResolvedValue(PLAN);
    aplicarSaldoFavor.mockResolvedValue({ ...PLAN, cliente: "Cobach XXI", montoCentavos: 16000 });
  });

  it("propone el menor entre el saldo a favor y lo que deben las marcadas", () => {
    renderizar();
    expect(screen.getByLabelText("Monto a aplicar")).toHaveValue("160.00");
  });

  it("Review Focus 3: no deja pasar más del saldo a favor", async () => {
    const { usuario } = renderizar();
    await usuario.clear(screen.getByLabelText("Monto a aplicar"));
    await usuario.type(screen.getByLabelText("Monto a aplicar"), "301");
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No puede ser mayor al saldo a favor ($300.00).");
    expect(vistaPreviaCobro).not.toHaveBeenCalled();
  });

  it("vista previa en modo saldo_favor; aplicar avisa con el mensaje", async () => {
    const { usuario, onAplicado } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(vistaPreviaCobro).toHaveBeenCalledWith({
      clienteId: "c1",
      notaIds: ["n1", "n2"],
      montoCentavos: 16000,
      modo: "saldo_favor",
    });
    await usuario.click(await screen.findByRole("button", { name: "Aplicar saldo a favor" }));
    expect(aplicarSaldoFavor).toHaveBeenCalledWith({ clienteId: "c1", notaIds: ["n1", "n2"], montoCentavos: 16000 });
    expect(onAplicado).toHaveBeenCalledWith("Saldo a favor aplicado: $160.00 a Cobach XXI");
  });

  it("muestra el 409 del servidor", async () => {
    vistaPreviaCobro.mockRejectedValue(
      new ErrorApi("x", 409, "Las notas marcadas solo deben $160.00: no se puede aplicar más saldo a favor que eso."),
    );
    const { usuario } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Vista previa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Las notas marcadas solo deben $160.00");
  });
});
```

En `apps/portal/src/components/cobranza/cobranza-cliente.test.tsx`, agrega `within` al import de
`@testing-library/react`, y dentro del `describe("CobranzaCliente", …)`:

```tsx
  it("con notas marcadas aparece Registrar pago; sin marcar, no", async () => {
    const { usuario } = renderizar();
    await screen.findByText("Cobranza · Cobach XXI");
    expect(screen.queryByRole("region", { name: "Registrar pago" })).not.toBeInTheDocument();
    await usuario.click(screen.getByLabelText("Marcar TJ240401OF01"));
    expect(screen.getByRole("region", { name: "Registrar pago" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Aplicar saldo a favor" })).not.toBeInTheDocument();
  });

  it("Aplicar saldo a favor aparece solo con saldo a favor y notas marcadas", async () => {
    porCobrarDeCliente.mockResolvedValue({ ...DATOS, saldoFavorCentavos: 2000 });
    renderizar("n1");
    expect(await screen.findByRole("region", { name: "Aplicar saldo a favor" })).toBeInTheDocument();
  });

  it("tras registrar el pago avisa y recarga la lista", async () => {
    vi.mocked(cobranzasLib.vistaPreviaCobro).mockResolvedValue({ aplicaciones: [], saldoFavorCentavos: 0 });
    vi.mocked(cobranzasLib.registrarCobro).mockResolvedValue({
      aplicaciones: [], saldoFavorCentavos: 0, cliente: "Cobach XXI", montoCentavos: 10000,
    });
    const { usuario } = renderizar("n1");
    const panel = await screen.findByRole("region", { name: "Registrar pago" });
    await usuario.type(within(panel).getByLabelText("Monto"), "100");
    await usuario.click(within(panel).getByRole("button", { name: "Vista previa" }));
    await usuario.click(await within(panel).findByRole("button", { name: "Grabar cobro" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Cobro registrado: $100.00 a Cobach XXI");
    await waitFor(() => expect(porCobrarDeCliente).toHaveBeenCalledTimes(2));
  });
```

Run: `npm test --workspace=apps/portal -- cobranza`
Expected: FAIL (los componentes nuevos no existen y `CobranzaCliente` todavía no los muestra).

- [ ] **Paso 2: Implementar la vista previa**

`apps/portal/src/components/cobranza/vista-previa-cobro.tsx`:

```tsx
import { describirAplicacion, type NotaPorCobrar, type PlanDeCobro } from "@/lib/cobranzas";
import { formatearPesos } from "@/lib/ventas";

/** El orden del servidor: fecha y luego folio, comparados como texto. */
function porFechaYFolio(a: NotaPorCobrar, b: NotaPorCobrar): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.folio !== b.folio) return a.folio < b.folio ? -1 : 1;
  return 0;
}

/**
 * §3.3: por nota marcada, cuánto recibe y cómo queda; luego lo que iría a otras
 * notas y a saldo a favor. Lo calculó el servidor con la misma regla que la
 * tablet: aquí solo se pinta.
 */
export function VistaPreviaCobro({ plan, palomeadas }: { plan: PlanDeCobro; palomeadas: NotaPorCobrar[] }) {
  const recibe = new Map(plan.aplicaciones.map((a) => [a.notaId, a]));
  const otras = plan.aplicaciones.filter((a) => !a.palomeada);
  return (
    <div role="region" aria-label="Vista previa" className="flex flex-col gap-1 rounded-md bg-muted p-3 text-sm">
      <p className="font-medium">Así quedaría:</p>
      <ul className="list-inside list-disc">
        {[...palomeadas].sort(porFechaYFolio).map((n) => {
          const a = recibe.get(n.id);
          return <li key={n.id}>{a ? describirAplicacion(a) : `${n.folio} sin pago`}</li>;
        })}
      </ul>
      {otras.length > 0 && (
        <>
          <p className="font-medium">A otras notas del cliente:</p>
          <ul className="list-inside list-disc">
            {otras.map((a) => (
              <li key={a.notaId}>{describirAplicacion(a)}</li>
            ))}
          </ul>
        </>
      )}
      {plan.saldoFavorCentavos > 0 && <p>A saldo a favor: {formatearPesos(plan.saldoFavorCentavos)}</p>}
    </div>
  );
}
```

- [ ] **Paso 3: Implementar `RegistrarPago`**

`apps/portal/src/components/cobranza/registrar-pago.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  MENSAJE_MONTO,
  METODOS_PAGO_COBRO,
  leerMontoCentavos,
  registrarCobro,
  vistaPreviaCobro,
  type ClientePorCobrar,
  type MetodoPagoCobro,
  type NotaPorCobrar,
  type PlanDeCobro,
} from "@/lib/cobranzas";
import { REPARTIDOR_OFICINA, formatearPesos, hoyEnTijuana, listarRepartidores, type Repartidor } from "@/lib/ventas";
import { VistaPreviaCobro } from "./vista-previa-cobro";

/**
 * §3.3: monto, fecha, método y cobrador → vista previa calculada en el servidor
 * → grabar. Cualquier cambio deja vieja la vista previa (y desaparece "Grabar
 * cobro"): lo que se graba es lo que se vio. Al grabar, el servidor vuelve a
 * decidir con las notas bloqueadas; si algo cambió, lo dice con un 409.
 */
export function RegistrarPago({
  cliente,
  palomeadas,
  onRegistrado,
}: {
  cliente: ClientePorCobrar;
  palomeadas: NotaPorCobrar[];
  onRegistrado: (mensaje: string) => void;
}) {
  const hoy = hoyEnTijuana();
  const masVieja = palomeadas.map((n) => n.fecha).sort()[0] ?? hoy;
  const deben = palomeadas.reduce((t, n) => t + n.saldoCentavos, 0);

  const [montoTexto, setMontoTexto] = useState("");
  const [fechaPago, setFechaPago] = useState(hoy);
  const [metodo, setMetodo] = useState<MetodoPagoCobro>("transferencia");
  const [cobrador, setCobrador] = useState(REPARTIDOR_OFICINA);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [vista, setVista] = useState<{ clave: string; plan: PlanDeCobro } | null>(null);
  const [avisoLocal, setAvisoLocal] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo registrar el cobro.");

  useEffect(() => {
    let vigente = true;
    listarRepartidores(cliente.sucursalId)
      .then((lista) => {
        if (vigente) setRepartidores(lista);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [cliente.sucursalId]);

  const notaIds = palomeadas.map((n) => n.id);
  const monto = leerMontoCentavos(montoTexto);
  const clave = [notaIds.join(","), monto, fechaPago, metodo, cobrador].join("|");
  const plan = vista?.clave === clave ? vista.plan : null;

  /** Lo mismo que rechazaría el servidor, dicho antes de pedir nada. */
  function problema(): string | null {
    if (monto === null) return MENSAJE_MONTO;
    if (fechaPago > hoy) return "La fecha del pago no puede ser futura.";
    if (fechaPago < masVieja)
      return `La fecha del pago no puede ser anterior a la nota más vieja que marcaste (${masVieja}).`;
    return null;
  }

  async function revisar() {
    const motivo = problema();
    setAvisoLocal(motivo);
    if (motivo !== null || monto === null) return;
    await enviar(
      async () => {
        const nuevo = await vistaPreviaCobro({ clienteId: cliente.id, notaIds, montoCentavos: monto, modo: "pago" });
        setVista({ clave, plan: nuevo });
      },
      () => {},
    );
  }

  async function grabar() {
    if (plan === null || monto === null) return;
    await enviar(
      async () => {
        const cobro = await registrarCobro({
          clienteId: cliente.id,
          notaIds,
          montoCentavos: monto,
          fechaPago,
          metodoPago: metodo,
          vendedorId: cobrador === REPARTIDOR_OFICINA ? null : cobrador,
        });
        setVista(null);
        setMontoTexto("");
        onRegistrado(`Cobro registrado: ${formatearPesos(cobro.montoCentavos)} a ${cobro.cliente}`);
      },
      () => {},
    );
  }

  return (
    <section aria-label="Registrar pago" className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Registrar pago</h3>
        <p className="text-sm text-muted-foreground">
          {palomeadas.length} {palomeadas.length === 1 ? "nota marcada" : "notas marcadas"} · deben{" "}
          {formatearPesos(deben)}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pago-monto" className="text-sm font-medium">
            Monto
          </label>
          <input
            id="pago-monto"
            inputMode="decimal"
            placeholder="0.00"
            value={montoTexto}
            onChange={(e) => setMontoTexto(e.target.value)}
            disabled={enviando}
            className="w-36 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pago-fecha" className="text-sm font-medium">
            Fecha del pago
          </label>
          <input
            id="pago-fecha"
            type="date"
            min={masVieja}
            max={hoy}
            value={fechaPago}
            onChange={(e) => setFechaPago(e.target.value)}
            disabled={enviando}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pago-metodo" className="text-sm font-medium">
            Método
          </label>
          <select
            id="pago-metodo"
            value={metodo}
            onChange={(e) => setMetodo(e.target.value as MetodoPagoCobro)}
            disabled={enviando}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {METODOS_PAGO_COBRO.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.texto}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pago-cobrador" className="text-sm font-medium">
            Cobró
          </label>
          <select
            id="pago-cobrador"
            value={cobrador}
            onChange={(e) => setCobrador(e.target.value)}
            disabled={enviando}
            className="w-56 rounded-md border px-3 py-2 text-sm"
          >
            <option value={REPARTIDOR_OFICINA}>Oficina</option>
            {repartidores.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" onClick={() => void revisar()} disabled={enviando}>
          Vista previa
        </Button>
      </div>

      {avisoLocal && (
        <p role="alert" className="text-sm text-destructive">
          {avisoLocal}
        </p>
      )}

      {plan && (
        <>
          <VistaPreviaCobro plan={plan} palomeadas={palomeadas} />
          <div>
            <Button type="button" onClick={() => void grabar()} disabled={enviando}>
              {enviando ? "Grabando…" : "Grabar cobro"}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
```

> El botón dice "Grabando…" mientras corre: la prueba busca "Grabar cobro" **antes** de hacer clic, así
> que no choca.

- [ ] **Paso 4: Implementar `AplicarSaldoFavor`**

`apps/portal/src/components/cobranza/aplicar-saldo-favor.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  MENSAJE_MONTO,
  aplicarSaldoFavor,
  leerMontoCentavos,
  textoMonto,
  vistaPreviaCobro,
  type ClientePorCobrar,
  type NotaPorCobrar,
  type PlanDeCobro,
} from "@/lib/cobranzas";
import { formatearPesos } from "@/lib/ventas";
import { VistaPreviaCobro } from "./vista-previa-cobro";

/**
 * §3.4: aplicar el saldo a favor del cliente a las notas marcadas. No entra
 * dinero: sin método ni cobrador. Por default, el menor entre el saldo a favor
 * y lo que deben las marcadas; nunca más que el saldo a favor. Lo que exceda lo
 * que deben lo rechaza el servidor (no se mueve saldo a favor a saldo a favor).
 *
 * El padre lo monta con `key` de la selección y el saldo, para que el monto
 * propuesto se recalcule al cambiar cualquiera de los dos.
 */
export function AplicarSaldoFavor({
  cliente,
  palomeadas,
  onAplicado,
}: {
  cliente: ClientePorCobrar;
  palomeadas: NotaPorCobrar[];
  onAplicado: (mensaje: string) => void;
}) {
  const deben = palomeadas.reduce((t, n) => t + n.saldoCentavos, 0);
  const [montoTexto, setMontoTexto] = useState(() => textoMonto(Math.min(cliente.saldoFavorCentavos, deben)));
  const [vista, setVista] = useState<{ clave: string; plan: PlanDeCobro } | null>(null);
  const [avisoLocal, setAvisoLocal] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo aplicar el saldo a favor.");

  const notaIds = palomeadas.map((n) => n.id);
  const monto = leerMontoCentavos(montoTexto);
  const clave = [notaIds.join(","), monto].join("|");
  const plan = vista?.clave === clave ? vista.plan : null;

  async function revisar() {
    const motivo =
      monto === null
        ? MENSAJE_MONTO
        : monto > cliente.saldoFavorCentavos
          ? `No puede ser mayor al saldo a favor (${formatearPesos(cliente.saldoFavorCentavos)}).`
          : null;
    setAvisoLocal(motivo);
    if (motivo !== null || monto === null) return;
    await enviar(
      async () => {
        const nuevo = await vistaPreviaCobro({
          clienteId: cliente.id,
          notaIds,
          montoCentavos: monto,
          modo: "saldo_favor",
        });
        setVista({ clave, plan: nuevo });
      },
      () => {},
    );
  }

  async function aplicar() {
    if (plan === null || monto === null) return;
    await enviar(
      async () => {
        const r = await aplicarSaldoFavor({ clienteId: cliente.id, notaIds, montoCentavos: monto });
        setVista(null);
        onAplicado(`Saldo a favor aplicado: ${formatearPesos(r.montoCentavos)} a ${r.cliente}`);
      },
      () => {},
    );
  }

  return (
    <section aria-label="Aplicar saldo a favor" className="flex flex-col gap-3 rounded-md border p-4">
      <h3 className="font-semibold">Aplicar saldo a favor</h3>
      <p className="text-sm text-muted-foreground">
        Tiene {formatearPesos(cliente.saldoFavorCentavos)} a favor; las notas marcadas deben {formatearPesos(deben)}.
        No entra dinero: no lleva método ni cobrador.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="saldo-monto" className="text-sm font-medium">
            Monto a aplicar
          </label>
          <input
            id="saldo-monto"
            inputMode="decimal"
            value={montoTexto}
            onChange={(e) => setMontoTexto(e.target.value)}
            disabled={enviando}
            className="w-36 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <Button type="button" variant="outline" onClick={() => void revisar()} disabled={enviando}>
          Vista previa
        </Button>
      </div>

      {avisoLocal && (
        <p role="alert" className="text-sm text-destructive">
          {avisoLocal}
        </p>
      )}

      {plan && (
        <>
          <VistaPreviaCobro plan={plan} palomeadas={palomeadas} />
          <div>
            <Button type="button" onClick={() => void aplicar()} disabled={enviando}>
              {enviando ? "Aplicando…" : "Aplicar saldo a favor"}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Paso 5: Mostrarlos en la cobranza del cliente**

En `apps/portal/src/components/cobranza/cobranza-cliente.tsx`:
- agrega `import { AplicarSaldoFavor } from "./aplicar-saldo-favor";` y `import { RegistrarPago } from "./registrar-pago";`;
- reemplaza el bloque

```tsx
        {palomeadas.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {palomeadas.length} {palomeadas.length === 1 ? "nota marcada" : "notas marcadas"}
          </p>
        )}
```

  por

```tsx
        {datos && palomeadas.length > 0 && (
          <RegistrarPago cliente={datos} palomeadas={palomeadas} onRegistrado={recargar} />
        )}

        {datos && datos.saldoFavorCentavos > 0 && palomeadas.length > 0 && (
          <AplicarSaldoFavor
            key={`${palomeadas.map((n) => n.id).join(",")}|${datos.saldoFavorCentavos}`}
            cliente={datos}
            palomeadas={palomeadas}
            onAplicado={recargar}
          />
        )}
```

  (`RegistrarPago` ya dice cuántas notas están marcadas).

- [ ] **Paso 6: Correr pruebas, lint, tipos y build**

Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npx tsc --noEmit -p apps/portal && npm run build --workspace=apps/portal`
Expected: todo en verde.

- [ ] **Paso 7: Commit**

```bash
git add apps/portal/src/components/cobranza
git commit -m "T-21: portal — registrar pago con vista previa y aplicar saldo a favor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 9: Verificación completa, prueba a mano contra la base LOCAL y documentación

**Archivos:**
- Modificar: `CLAUDE.md`
- (Sin tocar el vault ni GitHub: esta tarea deja los textos para quien coordina.)

- [ ] **Paso 1: Suite completa**

Run:
```
npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend
npm test --workspace=apps/backend && npm run test:e2e --workspace=apps/backend
npm run supabase -- test db
npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npx tsc --noEmit -p apps/portal
npm run typecheck --workspace=apps/tablet && npm run lint --workspace=apps/tablet && npm test --workspace=apps/tablet
npm run export --workspace=apps/tablet
```
Expected: todo en verde. Anota los conteos (pruebas por suite) para el PR. Comprueba también que
`git diff main -- apps/backend/src/modules/ventas-cobranza/reglas-cobranza.spec.ts apps/tablet/src/datos/cobranzas-reglas.spec.ts`
no muestra nada (las pruebas de `repartirPago` no cambiaron).

- [ ] **Paso 2: Prueba a mano contra el Postgres LOCAL**

`.env.development` apunta a la **nube**: no lo uses tal cual. Con el stack local arriba, toma `DATABASE_URL` de
`.env.test` para el backend (y para crear el usuario). En la Mac de Roberto el 3000 está ocupado:

```bash
export DATABASE_URL=$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)
PORT=3010 npm run backend                     # en una terminal
NEXT_PUBLIC_API_URL=http://localhost:3010 npm run portal   # en otra
```

Antes de arrancar, comprueba que el backend de verdad lee ese `DATABASE_URL` (si `.env.development` lo pisa,
cambia temporalmente su `DATABASE_URL` a la local y **restáuralo al terminar**; nunca lo subas). Crea un usuario
`Administrador General` con `npm run crear-usuario --workspace=apps/backend` **en esa misma terminal con el
`DATABASE_URL` local**.

Recorrido (con un cliente de TJ y tres ventas a crédito registradas desde *Registrar venta*, fechas distintas):
1. *Operación → Cobranza*: el menú muestra "Cobranza" después de "Facturas".
2. Buscar por cliente → aparecen las tres notas de la más vieja a la más nueva, con saldo.
3. Marcar la 2ª y la 3ª, monto que no alcance para las dos → *Vista previa*: la 2ª "pagada", la 3ª "abono …,
   debe …"; *Grabar cobro* → "Cobro registrado: $… a …" y la tabla se recarga.
4. Pagar de más sobre la 1ª → la vista previa muestra "A saldo a favor: $…"; al grabar, el encabezado muestra
   el saldo a favor.
5. Registrar otra venta a crédito, marcarla y *Aplicar saldo a favor* → baja el saldo a favor y la nota queda
   abonada; en *Ventas → detalle* el cobro dice "Saldo a favor" (método y origen) y no hay Editar/Eliminar.
6. Buscar por fecha y por # de nota (con mayúsculas y espacios) → la tabla de notas; "Cobrar" entra al cliente
   con esa nota marcada.
7. *Marcar como cuenta perdida* en una nota → desaparece de la lista.
8. Con un usuario sin `cobranza.registrar` (p. ej. `Auxiliar Administrativo`): "No tienes permiso para
   registrar cobranza".

Toma una captura de la vista previa del paso 3 para el PR. Al terminar, apaga el backend y el portal, y deja
`.env.development` como estaba.

- [ ] **Paso 3: `CLAUDE.md`**

a) En **Folios (T-14)**, cambia la viñeta

```markdown
- **Emite dentro de la transacción que guarda la operación.** `folios.emitir()` usa
  `savepoint`, no `begin`, para poder anidarse. T-16/T-20 **deben** llamarlo dentro de su
  propia transacción, o un fallo a media captura quema un número.
```

por

```markdown
- **Emite dentro de la transacción que guarda la operación.** `folios.emitir()` usa
  `savepoint`, no `begin`, para poder anidarse. La venta (T-16) **debe** llamarlo dentro de su
  propia transacción, o un fallo a media captura quema un número. La cobranza ya no lo llama (T-21).
```

b) En la viñeta de **Toda corrección de una venta va por el portal (T-17, parte 2)**, cambia
`- Una venta con abonos vivos de \`origen = 'cobro'\`, o en cuenta perdida, no se edita ni se elimina.` por
`- Una venta con abonos vivos de \`origen\` \`cobro\` o \`saldo_favor\` (T-21), o en cuenta perdida, no se edita ni se elimina.`

c) Después de la viñeta **Facturas (T-19)**, agrega:

```markdown
- **Cobranza desde el portal (T-21) — y la cobranza NO lleva folio.** El cliente lo dijo el 2026-10-07
  (*"Un solo folio"*, *"Porque la cobranza no lleva folio"*): solo las ventas se numeran. No hay
  `cobranza_abono.folio` ni `saldo_favor_movimiento.folio`, la tablet ya no emite folio al cobrar (migración
  local 010) y una tablet sin actualizar que todavía lo mande se registra igual: `normalizarOperacion` lo
  **ignora sin validarlo** y no llega a `sync_operacion.folio`. No subió `CONTRATO_ACTUAL` (revisar al publicar).
  - **Una regla para los dos**: `repartirPagoEnNotas` (palomeadas por fecha y folio → demás notas → saldo a
    favor) vive solo en el servidor; `repartirPago` es esa misma con una nota y su copia de la tablet no cambió.
  - Endpoints `/cobranzas` (`ventas-cobranza/cobranzas-portal.*`, `cobranzas.controller.ts`) con el permiso
    `cobranza.registrar`. Cobrador `null` = Oficina o un vendedor activo de la sucursal del cliente;
    `capturo_usuario_id` = quien capturó; `fecha_operacion` = hoy en Tijuana.
  - **El portal SÍ rechaza** una nota marcada que ya no tiene saldo (409) — la tablet no (D9). La decisión se
    toma sobre las notas bloqueadas `for update` (`bloquearNotasDelCliente`), nunca sobre lo que leyó la pantalla.
  - **Aplicar saldo a favor** no es dinero nuevo: abono con `metodo_pago = origen = 'saldo_favor'` (un check
    exige los dos o ninguno) y un movimiento **negativo** `aplicacion` en `saldo_favor_movimiento`. Flujo de
    Efectivo y Tesorería **no** deben contarlo como ingreso.
  - Un cobro del portal **no se deshace** todavía: eso es T-34. Por eso la vista previa.
```

- [ ] **Paso 4: Commit**

```bash
git add CLAUDE.md
git commit -m "T-21: CLAUDE.md anota la cobranza del portal y que la cobranza no lleva folio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**No hagas push ni abras el PR.** Entrega en tu reporte, tal cual, los textos de los pasos 5 y 6.

- [ ] **Paso 5: Textos para el vault (los aplica quien coordina en `../jawa-obsidian-memory`)**

- `10-Dominio/Entidades/Cobranza-Abono.md` (actualizar `actualizado:`): en el `[!important] La cobranza NO
  lleva folio — el cliente, 2026-10-07`, reemplazar las dos viñetas finales por:
  "- **Resuelto en T-21:** el servidor ignora el folio de una cobranza (no lo valida ni lo guarda), las columnas
  `folio` de `cobranza_abono` y `saldo_favor_movimiento` se borraron, y la app dejó de emitirlo (migración local
  010, con permiso de Mario para tocar la app solo en T-21)." Agregar un `[!success] Implementado en T-21
  (2026-10-07)`: varias notas por pago (palomeadas → demás → saldo a favor), cobrador Oficina o repartidor,
  aplicar saldo a favor (`saldo_favor` como método y origen, movimiento `aplicacion` negativo), y el portal
  rechaza una nota sin saldo (la tablet no). Enlace al spec.
- `10-Dominio/Modulos/Ventas y Cobranza.md`, sección de Cobranza: cómo funciona la pantalla *Operación →
  Cobranza* (buscar por cliente / fecha / # de nota; palomear; vista previa; grabar; aplicar saldo a favor;
  cuenta perdida) y que un cobro del portal no se deshace hasta T-34.
- `10-Dominio/Reglas/Status de venta.md`: caso límite "Una venta con un abono de saldo a favor no se edita ni se
  elimina, igual que con cualquier cobro (T-21)".
- `30-Decisiones/ADR-0012 La cobranza no lleva folio.md` (nuevo, con el frontmatter de `Plantilla ADR`):
  enmienda a ADR-0001/ADR-0007/ADR-0009 §2.2; contexto (respuesta textual del cliente del 2026-10-07; T-20
  foliaba los cobros), decisión (solo las ventas llevan folio; el servidor ignora el de una cobranza sin
  rechazarla; sin subir la versión del contrato porque la app no está publicada), consecuencias (la tablet sin
  actualizar sigue gastando un número de su serie hasta instalar la versión nueva; orden de despliegue:
  servidor → sincronizar la tablet → instalar la app).
- `00-Inicio/Estado del proyecto.md`: fila de T-21 con el PR.
- `40-Equipo/Bitácora/2026-10-07.md`: las decisiones de Roberto (palomear varias notas; cobrador Oficina por
  default o repartidor; aplicar saldo a favor desde la pantalla; una regla para tablet y portal) y la respuesta
  del cliente sobre el folio.

- [ ] **Paso 6: Texto para el PR (lo abre quien coordina)**

````markdown
## T-21 · Cobranza / Abono desde el Portal

Pantalla *Operación → Cobranza*: buscar la cuenta por cobrar (cliente, fecha o # de nota), palomear una o
varias notas, vista previa calculada en el servidor, grabar el pago (Oficina o repartidor; transferencia,
efectivo o cheque), aplicar saldo a favor y marcar cuenta perdida. Y **la cobranza ya no lleva folio** en
ningún lado (respuesta del cliente, 2026-10-07).

- Regla única: `repartirPagoEnNotas`; `repartirPago` (tablet y servidor) sin cambios de comportamiento.
- Decisiones sobre las notas bloqueadas `for update`; una nota que ya no tiene saldo es 409.
- App de tablet (solo TypeScript, con permiso de Mario): deja de emitir folio al cobrar (migración local 010),
  la vista final muestra el monto y cómo quedaron las notas, y "Saldo a favor" en los abonos.

### Migración `20261007160000_cobranza_portal` — pre-flight en `sinmex dev` (todas deben dar 0)

```sql
select count(*) from cobranza_abono where folio is not null;
select count(*) from saldo_favor_movimiento where folio is not null;
select count(*) from cobranza_abono where metodo_pago not in ('efectivo','transferencia','cheque','saldo_favor');
select count(*) from cobranza_abono where origen not in ('venta_contado','cobro','saldo_favor');
select count(*) from cobranza_abono where (origen = 'saldo_favor') <> (metodo_pago = 'saldo_favor');
select count(*) from saldo_favor_movimiento where origen not in ('excedente_cobro','aplicacion');
```

Si la primera no da 0, no empujar: borrar la columna perdería ese dato. Si `main` ya tiene una migración con
timestamp posterior a `20261007160000`, el `db push` necesitará `--include-all`: anotarlo aquí.

### Orden de despliegue

1. Servidor (acepta cobros sin folio e ignora el de los que lo traen).
2. **Sincronizar** la tablet de prueba de Mario para subir los cobros pendientes.
3. Instalar la app nueva.

### Para Mario

Los cambios de la app están en el §4.6 del spec. La copia de `repartirPago` sigue idéntica a la del servidor;
`repartirPagoEnNotas` es solo del servidor.

### Pruebas

(conteos del Paso 1) · captura de la vista previa · Closes #21

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

---

## Autorrevisión del plan (hecha al escribirlo)

- **Cobertura del spec:** §2 (palomear varias, cobrador, saldo a favor, una regla, sin folio, tablet) → Tareas
  1, 3, 4, 5, 8. §3.1–§3.4 → Tareas 7 y 8. §4.1 → Tarea 4. §4.2 → Tareas 4 y 5. §4.3 → Tarea 5. §4.4 → Tarea 2
  (con pre-flight). §4.5 (pull, `abonosDeCobroVivos`, `CobroDeVenta.origen`, concurrencia) → Tareas 4, 5 y 6.
  §4.6 → Tareas 1 y 3. §5 (fuera) respetado: no se deshacen cobros, no se toca Flujo/Tesorería. §6 → pruebas en
  cada tarea; §7 → texto del PR.
- **Sin huecos:** cada paso de código trae el código; los "reemplaza X por Y" citan el texto exacto.
- **Tipos consistentes:** `NotasAPagar`/`PagoEnNotas`/`PlanDeCobro`/`AplicacionDeCobro` (Tarea 4) son los que
  consume la Tarea 5 y copia la 6; `bloquearNotasDelCliente(clienteId, notaIds[], trx)` en repo, servicio y
  prueba; `crearRepositorioCobranzas(deps, { catalogos })` en todos sus llamadores.
- **Orden verde:** el servidor deja el folio (1) antes de que la migración lo borre (2); la app (3) depende
  del contrato de (1); el servicio (4) usa las columnas de (2); el portal (6–8) usa los endpoints de (5).
