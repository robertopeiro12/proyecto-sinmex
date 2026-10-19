# T-29 · Tesorería: depósitos, retiros, traspasos y cobranza automática (Portal) — Diseño

**Issue:** [#29](https://github.com/robertopeiro12/proyecto-sinmex/issues/29) (depende de T-28, mergeado en #132).
**Fecha:** 2026-10-19 · **Estado:** propuesto, pendiente de revisión de Roberto
**Base:** `Tesorería.md`, `Cobranza-Abono.md`, `Status de venta.md` y `Corte de caja.md` del vault; T-28
(`modules/tesoreria/`, `reglas-saldo.ts`, pestañas del portal); T-21 (cobranza del portal), T-34 (tabla `cobro`,
borrado con petición), T-17 (edición de ventas), T-16/T-20 (venta y cobro de la tablet).

## 1. Para qué

Fuente (`Sistema Jawa (fuente)`, sección *Tesorería*, opción 3 "Registrar una operación"):

> Para realizar operaciones esporádicas de administración y contabilidad (movimientos bancarios) […] Registrar
> Depósito, Registrar Retiro, Modificar Depósito, Modificar Retiro y Traspaso entre cuentas. […] Al grabar, se
> actualiza el saldo: suma (depósito), resta (retiro), o suma y resta (traspaso).

Y de la misma nota: *"El saldo de los campos de Tesorería se actualiza **automáticamente** cuando se registra una
**cobranza** […] o una **compra**"*; *"las ventas cobradas en efectivo se graban automáticamente en el campo
Efectivo"*.

Issue #29:

- [ ] Registrar/modificar depósito y retiro con fecha y comentario.
- [ ] Traspaso entre cuentas (salida → entrada) recalcula saldos.
- [ ] Actualización automática del saldo por cobranza y compras.

**Las compras todavía no existen** (T-30/T-31): en T-29 entra solo la **cobranza**; las compras se conectan cuando
existan, con la misma mecánica (§3.5). El criterio 3 queda cubierto por la cobranza y el issue lo dice al cerrar.

**Reparto:** Portal = Roberto. **No se toca `apps/tablet`**, ni el contrato de sincronización, ni la pantalla de
Cobranza (T-21): la cobranza se **lee**, no se escribe.

## 2. Decisiones de producto (Roberto, 2026-10-19)

| Tema | Decisión |
|---|---|
| A qué cuenta entra la cobranza | **Cuenta fija por sucursal y método** (efectivo / transferencia / cheque), configurada en Tesorería, con fecha "desde" |
| Cobros de la tablet | **Sí suman** (es dinero que el vendedor cobró y entrega; el servidor ya los tiene). La tablet no cambia |
| Fecha con que cuenta un cobro | **Fecha del pago** (`fecha_pago`) |
| Ventas de contado | **Sí suman** |
| Traspaso | **De una cuenta a otra** (una salida, una entrada, un monto) |
| Movimientos con cuentas generales | **Cualquiera con `tesoreria.gestionar`** puede usar una cuenta general en un depósito, retiro o traspaso (p. ej. la auxiliar de TJ lleva el efectivo al banco). Dar de alta / renombrar / eliminar una general y fijarle saldo **sigue siendo solo de un General** (T-28) |
| Cobranza en la Tesorería | **Calculada al consultar**, no copiada a otra tabla (§3.4) |

## 3. Reglas

### 3.1 Movimientos manuales

- Tres tipos: **depósito** (entra a una cuenta), **retiro** (sale de una cuenta), **traspaso** (sale de la cuenta
  *de* y entra a la cuenta *a*; las dos distintas).
- Cada uno: `fecha`, `monto` **positivo** (el tipo dice si suma o resta), `comentario` opcional (1–200 o `null`),
  quién lo capturó. Tope del monto: `MAX_CENTAVOS_TESORERIA` de T-28.
- **Fecha:** no futura respecto de hoy en Tijuana (Postgres), igual que los saldos fijados.
- **Corregir:** cambia fecha, monto, comentario y cuenta(s); **no** el tipo. **Eliminar:** baja lógica con
  confirmación.
- **Alcance:** las cuentas del movimiento tienen que ser **visibles** para el usuario (las de su sucursal + las
  generales; un General, todas) y vivas. Cuenta de otra sucursal o borrada → 404. Para corregir o eliminar, el
  usuario tiene que ver **todas** las cuentas del movimiento.

### 3.2 Cobranza que suma

Se lee de las tablas que ya existen, al consultar:

| Origen | Filas | Monto | Fecha | Sucursal | Método |
|---|---|---|---|---|---|
| Cobro (tablet o portal) | `cobro` con `origen = 'cobro'` y `deleted_at is null` | `cobro.monto` (el dinero completo que entró, aunque parte haya ido a saldo a favor) | `cobro.fecha_pago` | la del **cliente** | `cobro.metodo_pago` |
| Venta de contado | `cobranza_abono` con `origen = 'venta_contado'`, vivo, de una `venta_nota` viva | `cobranza_abono.monto` | `cobranza_abono.fecha_pago` | la de la **venta** | `cobranza_abono.metodo_pago` |

- **No suma** la aplicación de saldo a favor (`origen = 'saldo_favor'`): no es dinero nuevo (CLAUDE.md, T-21/T-34).
- Un cobro **borrado con petición** (T-34) y una venta de contado **editada o eliminada** (T-17) dejan de sumar solos,
  porque se filtra `deleted_at` en cada consulta.

### 3.3 A qué cuenta va la cobranza (destinos)

- Tabla de configuración: por **sucursal + método** (`efectivo`, `transferencia`, `cheque`) → **cuenta**, con fecha
  **desde**. Para un cobro de la sucursal S, método M y fecha F se usa el destino vivo de (S, M) con la **`desde` más
  reciente ≤ F**.
- Cambiar el destino es **agregar** uno con otra `desde`: lo anterior no se mueve. Uno con la misma `desde` lo
  **corrige**. `desde` puede ser pasada (así se configura el mes en curso) y no puede ser futura.
- La cuenta destino tiene que ser **de esa sucursal o general**, y viva.
- **Sin destino** para (S, M, F): ese dinero **no se suma a ninguna cuenta** y la vista lo avisa: *"$3,250.00 de
  cobranza de MX (transferencia) sin cuenta asignada"*. Nunca se inventa una cuenta.
- **Eliminar una cuenta** que es el destino **vigente** de alguna sucursal y método → **409** *"Esta cuenta recibe la
  cobranza de TJ (efectivo). Cambia ese destino antes de eliminarla."* (Si solo fue destino en el pasado, se puede
  eliminar; como toda cuenta dada de baja, desaparece de la vista con su historia — regla de T-28.)
- **Alcance:** un General configura cualquier sucursal; un usuario atado, solo **la suya** (puede elegir una cuenta
  general como destino). Permiso `tesoreria.gestionar`.

### 3.4 El cálculo (sigue en un solo lugar)

- `reglas-saldo.ts` ya recibe `movimientos` (T-28). T-29 los arma:
  - depósito → `+monto` en la cuenta; retiro → `−monto`; traspaso → `−monto` en *de* y `+monto` en *a*;
  - cobranza → `+monto` en la cuenta destino resuelta (§3.3), agrupada por día, sucursal y método.
- La resolución del destino es una **función pura** (`destinoDe(sucursalId, metodo, fecha, destinos)`) con pruebas.
- Se mantiene la regla de T-28: el saldo fijado más reciente es la base y **lo anterior a esa fecha no cuenta**.

**Entradas y Salidas** de una cuenta en el rango = la suma de sus movimientos con fecha en `[desde, hasta]` **que
cuentan para el saldo final** (fecha ≥ la del saldo fijado que usa el final). Si hubo un saldo fijado **dentro** del
rango, `inicio + entradas − salidas` no tiene por qué dar el final: la fila lo marca (*"saldo fijado el 10/10"*) para
que no parezca un error.

### 3.5 Compras (para T-30/T-31, no se implementa aquí)

Cuando existan, una compra pagada con una cuenta de Tesorería será un movimiento de salida más en el mismo arreglo
`movimientos`, leído de su tabla como la cobranza. "Efectivo cobranza del día" no toca Tesorería directamente (va al
corte del repartidor). Se decide en su spec.

## 4. Backend (`modules/tesoreria/`)

### 4.1 Migración `20261019120000_tesoreria_movimientos.sql`

```sql
create table tesoreria_movimiento (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  tipo               text not null check (tipo in ('deposito','retiro','traspaso')),
  fecha              date not null,
  monto              numeric(14,2) not null check (monto > 0),
  cuenta_id          uuid not null references tesoreria_cuenta(id),
  cuenta_destino_id  uuid references tesoreria_cuenta(id),
  comentario         text check (comentario is null or char_length(comentario) between 1 and 200),
  capturo_usuario_id uuid not null references usuario(id),
  constraint ck_tesoreria_movimiento_traspaso check (
    (tipo = 'traspaso') = (cuenta_destino_id is not null)
    and (cuenta_destino_id is null or cuenta_destino_id <> cuenta_id))
);
create index ix_tesoreria_movimiento_fecha on tesoreria_movimiento (fecha) where deleted_at is null;

create table tesoreria_destino_cobranza (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  sucursal_id        uuid not null references sucursal(id),
  metodo             text not null check (metodo in ('efectivo','transferencia','cheque')),
  cuenta_id          uuid not null references tesoreria_cuenta(id),
  desde              date not null,
  capturo_usuario_id uuid not null references usuario(id)
);
create unique index uq_tesoreria_destino_vigencia
  on tesoreria_destino_cobranza (sucursal_id, metodo, desde) where deleted_at is null;
```

Más los triggers de `updated_at` (`set_updated_at()`), como en T-28. Tablas nuevas y vacías, **sin permisos nuevos**
(usa `tesoreria.ver` / `tesoreria.gestionar`): **sin pre-flight** contra la nube.

### 4.2 Endpoints (camelCase, centavos enteros)

| Método y ruta | Permiso | Qué hace |
|---|---|---|
| `GET /tesoreria/movimientos?sucursal=&desde=&hasta=` | `tesoreria.gestionar` | Movimientos manuales vivos del rango cuyas cuentas el usuario ve (más recientes primero) |
| `POST /tesoreria/movimientos` | `tesoreria.gestionar` | `{ tipo, fecha, montoCentavos, cuentaId, cuentaDestinoId?, comentario? }` |
| `PATCH /tesoreria/movimientos/:id` | `tesoreria.gestionar` | Corrige fecha, monto, comentario y cuenta(s) |
| `DELETE /tesoreria/movimientos/:id` | `tesoreria.gestionar` | Baja lógica |
| `GET /tesoreria/destinos?sucursal=` | `tesoreria.gestionar` | Por sucursal en alcance y método: el destino vigente hoy (cuenta + desde) y el historial |
| `PUT /tesoreria/destinos` | `tesoreria.gestionar` | `{ sucursalId, metodo, cuentaId, desde }`: agrega (o corrige si misma `desde`) una vigencia |
| `GET /tesoreria?sucursal=&desde=&hasta=` | `tesoreria.ver` | La vista de T-28, ampliada (abajo) |

Errores: fecha futura o inválida → 400; traspaso a la misma cuenta → 400; cuenta fuera de alcance o borrada → 404;
sucursal ajena en destinos → 403 (`resolverAlcance`); cuenta destino de otra sucursal → 400 *"La cuenta tiene que ser
de esa sucursal o general."*; eliminar cuenta destino vigente → 409 (§3.3).

**Vista ampliada** (se agregan campos; los de T-28 no cambian de nombre):

```json
{
  "cuentas": [{ "...": "lo de T-28",
    "entradasCentavos": 950000, "salidasCentavos": 300000,
    "saldoFijadoEnRango": "2026-10-10" }],
  "total": { "...": "lo de T-28", "entradasCentavos": 0, "salidasCentavos": 0 },
  "sinCuenta": [{ "sucursalCodigo": "MX", "metodo": "transferencia", "montoCentavos": 325000 }],
  "eventos": [
    { "tipo": "saldo-fijado", "...": "como T-28" },
    { "tipo": "deposito" | "retiro", "id": "…", "fecha": "…", "cuentaId": "…", "cuentaNombre": "…",
      "montoCentavos": 0, "comentario": null, "capturo": "…" },
    { "tipo": "traspaso", "...": "igual + cuentaDestinoId, cuentaDestinoNombre" },
    { "tipo": "cobranza", "fecha": "…", "cuentaId": "…", "cuentaNombre": "…", "sucursalCodigo": "TJ",
      "metodo": "efectivo", "cantidad": 12, "montoCentavos": 840000 }
  ]
}
```

- `saldoFijadoEnRango`: fecha del saldo fijado que usa el final si cae en `(desde, hasta]`; si no, `null`.
- `sinCuenta`: cobranza **del rango** sin destino, de las sucursales en alcance, agrupada por sucursal y método.
- `eventos`: por fecha; la cobranza agrupada por día, cuenta, sucursal y método (no cobro por cobro).
- Un traspaso se muestra si **cualquiera** de sus dos cuentas está en alcance, con los dos nombres (p. ej. un usuario
  de MX ve "Efectivo TJ → ScotiaFiscal" porque ve la cuenta general). Solo lo corrige o elimina quien ve **las dos**.

### 4.3 Pruebas

- **pgTAP:** checks de tipo, monto > 0, traspaso con destino distinto y solo traspaso lleva destino; método válido;
  unicidad de vigencia (y liberada al borrar).
- **Unitarias:** `destinoDe` (sin destino, cambio de `desde`, misma fecha), armado de movimientos (traspaso resta y
  suma), entradas/salidas con saldo fijado dentro del rango, cobranza agrupada.
- **e2e:** depósito/retiro/traspaso cambian la vista; corregir y eliminar; fecha futura 400; misma cuenta 400;
  usuario de TJ: traspaso de su efectivo a una general **sí**, cuenta de MX **404**; un **cobro borrado** (T-34) deja
  de sumar; **saldo a favor aplicado** no suma; **venta de contado** suma; cambio de destino con `desde` no mueve lo
  anterior; cobranza sin destino sale en `sinCuenta`; eliminar cuenta destino vigente → 409.

## 5. Portal

- **Pestaña nueva "Movimientos"** (`tesoreria.gestionar`), justo después de "Tesorería" (orden: Tesorería · Movimientos · Cuentas · Saldos):
  - Formulario: Tipo (Depósito / Retiro / Traspaso), Fecha (hoy por defecto, `max` hoy), Cuenta — o **De** y **A** en
    traspaso —, Monto (siempre positivo; se lee con `leerMontoCentavos` de T-21), Comentario. Aviso en gris hasta
    tocar un campo (patrón de Promociones).
  - Lista del rango (por defecto **este mes**) con Editar (reabre el formulario) y Eliminar (confirmación).
- **Pestaña Cuentas:** sección **"¿A qué cuenta entra la cobranza?"**: una fila por sucursal en alcance con tres
  selectores (Efectivo, Transferencia, Cheque; opciones = cuentas de esa sucursal + generales), la fecha "desde" y
  Guardar por fila; debajo, el historial de cambios. Un usuario atado ve solo su sucursal.
- **Pestaña Tesorería:** columnas Cuenta · Sucursal · Saldo al inicio · **Entradas** · **Salidas** · Saldo al final;
  marca "saldo fijado el dd/mm" cuando aplica; aviso de **cobranza sin cuenta** arriba de la tabla; la lista del rango
  pasa a llamarse **"Movimientos del rango"** con todos los tipos de evento. Excel con las mismas columnas y bloques.
- La tabla tiene que caber desde **1366 px**: medirla con nombres largos y montos de 9 cifras.

## 6. Vault (al terminar)

- `Tesorería.md`: "campos ↔ métodos de pago" resuelto (destinos por sucursal y método con vigencia); registrar
  operación implementado; cobranza automática y de qué tablas sale.
- `Cobranza-Abono.md`: cómo llega a Tesorería (y que el saldo a favor no). `Estado del proyecto.md` y bitácora.
- `CLAUDE.md` del repo: ampliar el bloque de Tesorería (cobranza calculada, destinos con vigencia, alcance de
  movimientos con cuentas generales).

## 7. Fuera de alcance

- Compras / egresos que restan de una cuenta (T-30/T-31), Flujo de Efectivo (T-32), Corte de caja (T-33).
- Traspasos de varias cuentas a varias (decisión: uno a uno).
- Elegir la cuenta en la pantalla de Cobranza o en la tablet.
- Ver la cobranza cobro por cobro desde la Tesorería (se ve agrupada; el detalle está en Cobranza / Cuentas por
  Cobrar).
