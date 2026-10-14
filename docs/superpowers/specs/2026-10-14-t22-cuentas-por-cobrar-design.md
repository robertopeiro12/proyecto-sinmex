# T-22 · Cuentas por Cobrar (Portal) — Diseño

**Issue:** [#22](https://github.com/robertopeiro12/proyecto-sinmex/issues/22) (depende de T-19, mergeado).
**Fecha:** 2026-10-14 · **Estado:** propuesto, pendiente de revisión de Roberto
**Base:** `Cuentas por Cobrar y Pagar.md`, `Status de venta.md`, `Cliente.md` y `Cobranza-Abono.md` del vault;
T-21 (`cobranzas-portal.*`, pantalla Cobranza); T-34 (tabla `cobro`, abonos borrados); T-09 (`resolverAlcance`);
T-15 (`apps/portal/src/lib/excel/`).

## 1. Para qué

Fuentes del cliente (vault, `Cuentas por Cobrar y Pagar.md`):

> **Cuentas por Cobrar**: el universo de notas de venta con status **pendiente** y **abonado** (lo que los
> clientes nos deben). […] El universo de Cuentas por Cobrar = suma de notas con status pendiente + abonado
> (su saldo pendiente).

Issue #22: "Como administrador, quiero ver todas las notas con status pendiente y abonado con su saldo para
conocer lo que deben los clientes." Criterios:

- [ ] Listado del universo por cobrar con saldo por nota.
- [ ] Respeta filtro por sucursal.
- [ ] Enlaza con cobranza para su gestión.

Hoy Cobranza (T-21) ya calcula el saldo de cada nota, pero solo **busca** (por cliente, fecha de la venta o
# de nota). No hay una vista de todo lo que se debe ni un total.

**Reparto:** Portal = Roberto. **No se toca `apps/tablet`** ni el contrato de sincronización.

## 2. Decisiones de producto (Roberto, 2026-10-14)

| Tema | Decisión |
|---|---|
| Vista | **Por cliente**: una fila por cliente con su total; se abre y muestra sus notas con el saldo de cada una. Gran total arriba |
| Permiso | **Nuevo**: `cuentas_cobrar.ver` ("Ver Cuentas por Cobrar"). Quien ve no necesariamente cobra |
| Vencimiento | **Sí, con filtro**: vence = fecha de la venta + plazo de crédito del cliente; días de atraso; monto vencido por cliente; casilla "Solo vencidas". Sin plazo = "Sin plazo", nunca vencida |
| Excel | **Sí**, con la utilidad de T-15 |
| Lo que no entra | Notificaciones por vencer/vencida (T-54), correos de recordatorio (T-58), marcar cuenta perdida desde aquí (ya existe en la edición de la venta, T-17) |

## 3. Reglas

- **Universo:** `venta_nota` viva (`deleted_at is null`) con `status in ('pendiente', 'abonado')`. Fuera:
  `pagada`, `promocion`, `cuenta_perdida` y ventas eliminadas. Un cliente dado de baja con notas vivas por
  cobrar **sí** aparece (la deuda existe), igual que en Cobranza.
- **Abonado** = suma de `cobranza_abono.monto` **vivos** (`deleted_at is null`) de la nota, sin importar el
  origen (`cobro` o `saldo_favor`: aplicar saldo a favor sí reduce la deuda). Un pago borrado con petición
  autorizada (T-34) ya no cuenta y la nota vuelve a sumar.
- **Saldo** = `monto_total − abonado`. Todo en **centavos enteros** con `aCentavos` y `saldoDerivadoCentavos`,
  igual que Cobranza. Una nota con saldo 0 (datos viejos con abonos de más) no se lista.
- **Hoy** = fecha de **Tijuana**, calculada en Postgres: `(now() at time zone 'America/Tijuana')::date`.
  Nunca la del reloj del navegador ni la de UTC.
- **Vence** = `fecha + plazo_credito_dias` del cliente. `plazo_credito_dias` null → `vence` null ("Sin plazo")
  y la nota **nunca** cuenta como vencida. Plazo 0 = vence el mismo día de la venta.
- **Días de atraso** = `hoy − vence` cuando es > 0; si no, 0 ("Al corriente"). Una nota vence **el día
  siguiente** a `vence`: el mismo día de `vence` todavía está al corriente.
  Ejemplo: venta 13-sep, plazo 15 → vence 28-sep; el 14-oct lleva **16 días** vencida.
- **Vencido** (por cliente y total) = suma de saldos de las notas con días de atraso > 0.
- **Solo vencidas** filtra las **notas**; un cliente sin notas vencidas desaparece y los totales se calculan
  sobre lo filtrado.
- **Orden:** clientes por vencido (desc), luego saldo (desc), luego nombre; notas por fecha (asc), luego folio.
- **Alcance:** `resolverAlcance` de T-09, como todo el portal. Usuario de una sucursal → solo la suya; pedir
  otra → 403. Usuario sin sucursal → todas o la que pida.

## 4. Backend

### 4.1 Migración

`supabase/migrations/20261014120000_permiso_cuentas_cobrar.sql`: solo
`insert into permiso (clave, grupo, descripcion) values ('cuentas_cobrar.ver', 'Operacion Comercial',
'Ver Cuentas por Cobrar') on conflict (clave) do nothing;`. Ninguna tabla cambia. *Administrador General*
recibe el catálogo completo por la regla ya existente (`PERFIL_MAESTRO`, `auth/permisos.ts`). Pre-flight para la nube:
ninguno (no agrega `check`/`not null`/`unique`); `migration list` antes y después, como siempre. Prueba pgTAP:
el permiso existe.

### 4.2 Endpoint

`GET /cuentas-por-cobrar?sucursal=TJ&soloVencidas=true` en `modules/cuentas-cobrar-pagar/`
(`cuentas-por-cobrar.controller.ts`, `.service.ts`, `.repository.ts`, `dto/`), con
`@RequierePermiso('cuentas_cobrar.ver')`. Solo lee. Respuesta en camelCase:

```ts
type CuentasPorCobrar = {
  hoy: string;                    // 'YYYY-MM-DD', Tijuana (lo usa el nombre del Excel)
  totalCentavos: number;
  vencidoCentavos: number;
  notas: number;
  clientes: ClienteConDeuda[];
};
type ClienteConDeuda = {
  clienteId: string; cliente: string; sucursalCodigo: string;
  saldoCentavos: number; vencidoCentavos: number;
  notas: NotaPorCobrar[];
};
type NotaPorCobrar = {
  id: string; fecha: string; folio: string; numNota: string | null;
  montoCentavos: number; abonadoCentavos: number; saldoCentavos: number;
  status: 'pendiente' | 'abonado';
  vence: string | null;           // null = sin plazo
  diasAtraso: number;             // 0 = al corriente o sin plazo
};
```

- **Repositorio:** una sola consulta trae las notas planas (con `vence` y `dias_atraso` ya calculados en SQL
  y `hoy`), filtradas por alcance y por "solo vencidas".
- **Reglas puras** (`reglas-cuentas-por-cobrar.ts`): agrupar por cliente, sumar totales y ordenar. Sin base de
  datos, con su `.spec.ts`.
- **DTO:** `sucursal` opcional (mismo normalizado que los demás), `soloVencidas` opcional (`'true'`/`'false'`;
  cualquier otro valor → 400).

### 4.3 Pruebas

- Unitarias de `reglas-cuentas-por-cobrar.ts`: agrupado, totales, orden, lista vacía.
- e2e contra Postgres local:
  - pendiente y abonado entran; pagada, promoción, cuenta perdida y venta eliminada no;
  - un abono borrado (cobro borrado de T-34) no resta; uno de saldo a favor sí;
  - vencimiento: sin plazo, plazo 0, el día exacto de `vence` (al corriente) y el día siguiente (1 día);
  - "solo vencidas" filtra notas y totales;
  - alcance: usuario TJ no ve MX, pedir MX → 403;
  - sin `cuentas_cobrar.ver` → 403 y con la excepción en `usuario_permiso` → 200; sin sesión → 401. (El token
    de la app lo rechaza el guard global, ya probado en `auth-vendedor.e2e-spec.ts`.)
  - La fecha de Tijuana se prueba con ventas fechadas relativas a `hoy` que devuelve el propio endpoint, para
    no depender de la hora a la que corra la prueba.

## 5. Portal

### 5.1 Menú y ruta

"Cuentas por Cobrar" en **Operación**, justo debajo de "Cobranza": `/operacion/cuentas-por-cobrar`. Respeta el
filtro global `?sucursal=`. Server component delgado + `PantallaCuentasPorCobrar` (mismo patrón que Cobranza).
Cliente HTTP en `apps/portal/src/lib/cuentas-por-cobrar.ts`.

### 5.2 Pantalla

- **Sesión cargando:** "Cargando…" (sin el parpadeo de "No tienes permiso" que arregló T-50).
- **Sin `cuentas_cobrar.ver`:** "No tienes permiso para ver cuentas por cobrar".
- **Arriba:** *Total por cobrar*, *Vencido* (en rojo si > 0) y "N notas de M clientes".
- **Controles:** casilla **"Solo vencidas"** (vuelve a pedir al servidor) y **"Exportar a Excel"**
  (deshabilitado si no hay notas).
- **Tabla por cliente:** cliente · sucursal, # de notas, saldo, vencido. Clic (o Enter) en la fila abre o
  cierra sus notas (`aria-expanded`). Varias pueden estar abiertas a la vez.
- **Notas del cliente:**

  | Fecha | Folio | # nota | Total | Abonado | Saldo | Status | Vence | |
  |---|---|---|---|---|---|---|---|---|
  | 13/09/2026 | TJ260913AP05 | 2346 | $149.50 | $0.00 | $149.50 | Pendiente | 28/09/2026 · **16 días** | [Cobrar] |

  "Vence" muestra "Sin plazo" o "Al corriente" según el caso.
- **Vacío:** "No hay cuentas por cobrar." (o "No hay notas vencidas." con la casilla marcada).
- **Error:** el mensaje del servidor (`mensajeDe`) en un `role="alert"`.
- Cambiar de sucursal descarta la respuesta anterior (solo la última petición escribe, como Cobranza).

### 5.3 Enlace con Cobranza (criterio 3)

- **[Cobrar]** lleva a `/operacion/cobranza?cliente=<id>&nota=<id>` (más `&sucursal=` si hay filtro).
- `operacion/cobranza/page.tsx` lee `cliente` y `nota` y `PantallaCobranza` arranca en
  `{ tipo: 'cliente', clienteId, notaId }` en vez de "buscar". "Volver" regresa al buscador, como hoy.
  `CobranzaCliente` ya recibe `notaInicial`: no cambia.
- El botón **solo aparece con `cobranza.registrar`**. Sin él, la pantalla es de consulta.

### 5.4 Excel

`exportarExcel` de T-15, una fila por nota (respeta "Solo vencidas"): Cliente, Sucursal, Fecha, Folio, # nota,
Total, Abonado, Saldo, Status, Vence, Días de atraso; fila de totales (Total, Abonado, Saldo). Archivo
`cuentas-por-cobrar-<SUCURSAL|todas>-<hoy>.xlsx`, con `hoy` el que devolvió el servidor.

### 5.5 Pruebas de pantalla (T-65)

- Totales, agrupado y formato de vencimiento ("16 días", "Sin plazo", "Al corriente").
- Abrir y cerrar un cliente.
- "Solo vencidas" pide `soloVencidas=true`.
- [Cobrar] aparece o no según `cobranza.registrar` y arma el enlace correcto.
- Sin permiso → mensaje; sesión cargando → "Cargando…".
- `PantallaCobranza` con `clienteId` inicial abre directo al cliente.
- Excel: la definición que se pasa a `exportarExcel` (columnas y filas), sin generar el archivo.

## 6. Vault (al terminar)

- `Cuentas por Cobrar y Pagar.md`: cómo quedó la cara de *Cobrar* (reglas de §3) y su `actualizado:`.
- `Cliente.md`: el plazo de crédito ya se usa para el vencimiento.
- `Estado del proyecto.md`: fila T-22.
- Bitácora del día. Sin ADR: no hay decisión de arquitectura nueva.

## 7. Fuera de alcance

- Notificaciones Cobranza por Vencer / Vencida → T-54 (reusará las reglas de §3).
- Recordatorios por correo → T-58.
- Cuentas por **Pagar** → T-23.
- Marcar cuenta perdida desde esta pantalla (ya existe en la edición de la venta).
- Antigüedad por rangos (0–30, 31–60…): no se pidió.
