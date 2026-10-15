# T-28 · Tesorería: cuentas y saldo inicial (Portal) — Diseño

**Issue:** [#28](https://github.com/robertopeiro12/proyecto-sinmex/issues/28) (depende de T-05 y T-03, ambos hechos).
**Fecha:** 2026-10-15 · **Estado:** propuesto, pendiente de revisión de Roberto
**Base:** `Tesorería.md`, `Flujo de Efectivo.md`, `Compras y Egresos.md` y `Corte de caja.md` del vault;
`Sistema Jawa (fuente)` (sección *Tesorería*); T-09 (`resolverAlcance`); T-15 (`apps/portal/src/lib/excel/`);
T-49 (atajos de rango); `TablaCatalogo` / `PantallaCatalogo` del portal.

## 1. Para qué

El cliente lo pidió por escrito (`Sistema Jawa (fuente)`, documento original del cliente):

> Al programa se debe ingresar con login y password por usuario y contendrá las siguientes secciones:
> Flujo de Efectivo, **Tesorería**, Compras / Egresos, […]
>
> **Tesorería:** Es el reflejo real de dinero que se tiene en las cuentas bancarias como en caja.
> La pantalla inicial debe tener opciones: 1. Mostrar Tesorería · 2. Agregar/Modificar/Eliminar Campos ·
> 3. Registrar una operación · 4. Ingresar saldo inicial · 5. Generar Corte

Hoy lo llevan en la pestaña **Flujo Diario** del Excel. Issue #28 cubre las opciones 1, 2 y 4:

- [ ] Agregar/modificar/eliminar campos de tesorería (con confirmación).
- [ ] Ingresar y modificar saldo inicial (recalcula desde esa base).
- [ ] Mostrar tesorería por día o rango con comentarios.

> [!note] Dos "tesorerías" distintas
> Las fuentes usan la palabra para dos cosas. **(a)** El dinero que entrega el repartidor al final del día
> (`Cobranza − Gastos = Tesorería`), que la auxiliar **cuenta en persona** frente al vendedor y él firma: eso
> **se queda en persona** y no es de T-28 (si algún día entra al sistema, es el Corte de caja, T-33).
> **(b)** La **sección del sistema** con las cuentas del negocio (Efectivo, Caja Chica, ScotiaFiscal…):
> eso es T-28. Roberto confirmó el 2026-10-15 que su tío pidió (b).

**Reparto:** Portal = Roberto. **No se toca `apps/tablet`** ni el contrato de sincronización.

## 2. Decisiones de producto (Roberto, 2026-10-15)

| Tema | Decisión |
|---|---|
| Sucursal de la cuenta | **Mixto**: una cuenta es de una sucursal ("Efectivo TJ") o **general** (sin sucursal, p. ej. el banco de toda la empresa) |
| Modificar saldo | **Nuevo punto de partida**: fijar el saldo real de una cuenta en una fecha; desde ese día se calcula a partir de ahí, lo anterior queda como historia (resuelve el pendiente de `Tesorería.md`) |
| Saldo fijado | Vale como saldo **al inicio** de su día: los movimientos de ese mismo día se suman encima |
| Eliminar cuenta | **Baja lógica** con confirmación; la historia se conserva |
| Montos negativos | **Sí** (un banco puede estar sobregirado) |
| Permisos | Dos nuevos: `tesoreria.ver` (consultar) y `tesoreria.gestionar` (cuentas y saldos) |
| Menú | Sección nueva **Finanzas → Tesorería** (ahí llegarán Compras y Egresos y Flujo de Efectivo) |
| Alcance | **Solo cuentas + saldos fijados + vista.** Depósitos, retiros, traspasos y que la cobranza sume sola: T-29 |

## 3. Reglas

### 3.1 Cuentas

- Una cuenta tiene **nombre** y **sucursal opcional** (`null` = general).
- **Nombre único** entre cuentas vivas, sin importar mayúsculas ni espacios de los extremos
  (`lower(btrim(nombre))`), en toda la empresa. "Efectivo TJ" y "Efectivo MX" conviven; dos "Efectivo" no.
  Al dar de baja una cuenta su nombre se libera.
- Nombre: 1 a 60 caracteres tras recortar espacios.
- La **sucursal se fija al dar de alta** y no se cambia (como el cliente). El `PATCH` solo cambia el nombre.
- **Baja lógica** (`deleted_at`). Una cuenta dada de baja desaparece de las listas, de la vista y del Total
  Tesorería; sus saldos fijados se quedan en la base. No hay reactivar (YAGNI): se da de alta otra.
- Una cuenta de una sucursal **desactivada** sigue siendo válida (el dinero existe).

### 3.2 Alcance por sucursal

Con `resolverAlcance` de T-09, como todo el portal:

- **Alcance `todas`** (General sin sucursal en el selector): todas las cuentas vivas.
- **Alcance `una` (sucursal X)**: las cuentas de X **más las generales**.
- **Alta**: un usuario atado a una sucursal solo crea cuentas **de su sucursal** (la sucursal la pone el
  servidor, no el cuerpo). Un General elige: una sucursal o "General (toda la empresa)".
- **Editar, dar de baja y fijar saldo**: una cuenta de otra sucursal → **404** (no se revela que existe). Una
  cuenta **general** la puede consultar cualquiera con `tesoreria.ver`, pero solo la **modifica** un General
  (un usuario atado recibe **403** "Las cuentas generales solo las administra un usuario General").

### 3.3 Saldos fijados

- Un saldo fijado = `(cuenta, fecha, monto, comentario opcional, quién lo capturó)`.
- **Uno vivo por cuenta y fecha** (índice único parcial). Capturar otra vez la misma cuenta y fecha **corrige**
  el existente (monto y comentario), no duplica.
- El primero de una cuenta es su **saldo inicial**; los siguientes son "modificar saldo". No hay diferencia en
  la base: es solo el más antiguo.
- Monto en pesos con 2 decimales (`numeric(14,2)`), puede ser negativo. En el servidor se opera en **centavos
  enteros** (`aCentavos` de `sincronizacion/dinero.ts`), nunca con flotantes.
- Comentario: opcional, hasta 200 caracteres; `null` si viene vacío (nunca `''`).
- La fecha **no** puede ser futura respecto de **hoy en Tijuana** (`(now() at time zone
  'America/Tijuana')::date`, calculado en Postgres). Una fecha pasada sí: así se arranca con el saldo de un día
  anterior.
- **Eliminar** un saldo fijado: baja lógica con confirmación. El cálculo vuelve a usar el anterior.
- No se fija saldo a una cuenta dada de baja (404).

### 3.4 El cálculo (un solo lugar)

Función pura `saldoAlInicioDe(fecha, saldosFijados, movimientos)` en el backend (`tesoreria/reglas-saldo.ts`):

- **Saldo al inicio del día D** = el saldo fijado vivo **más reciente con fecha ≤ D** + los movimientos con
  fecha en `[fecha_fijada, D)`.
- **Saldo al final del día D** = saldo al inicio de `D + 1`.
- Sin saldo fijado con fecha ≤ D → **`null`** ("Sin saldo inicial"), nunca $0.
- En T-28 **no hay movimientos** (lista vacía): la firma ya los recibe para que T-29 solo los alimente.

Ejemplo: fijo $10,000 en *Efectivo TJ* el 01-oct y $9,500 el 10-oct.
- Rango 05-oct → 12-oct: inicio = $10,000 (el del 01), final = $9,500 (el del 10).
- Rango 20-sep → 30-sep: inicio y final = "Sin saldo inicial".
- (En T-29: un cobro de $500 el 10-oct deja el final del 10 en $10,000, porque el fijado es al inicio del día.)

**Total Tesorería** (inicio y final) = suma de los saldos **no nulos** de las cuentas listadas. Si alguna
cuenta no tiene saldo, el total lo dice ("3 de 4 cuentas con saldo"), para que un total bajo no se lea como
dinero faltante. Este total es el que usará el Flujo de Efectivo (T-32).

### 3.5 Rango de la vista

- `desde` y `hasta` obligatorios (`YYYY-MM-DD`), `desde ≤ hasta`, como máximo **366 días** (igual que los
  reportes). Por defecto en el portal: **hoy** (Tijuana) en los dos.

## 4. Backend

### 4.1 Migración `20261015120000_tesoreria_cuentas.sql`

```sql
create table tesoreria_cuenta (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (char_length(btrim(nombre)) between 1 and 60),
  sucursal_id uuid references sucursal(id),          -- null = general
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index uq_tesoreria_cuenta_nombre
  on tesoreria_cuenta (lower(btrim(nombre))) where deleted_at is null;

create table tesoreria_saldo (
  id                 uuid primary key default gen_random_uuid(),
  cuenta_id          uuid not null references tesoreria_cuenta(id),
  fecha              date not null,
  monto              numeric(14,2) not null,
  comentario         text check (comentario is null or char_length(comentario) between 1 and 200),
  capturo_usuario_id uuid not null references usuario(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create unique index uq_tesoreria_saldo_cuenta_fecha
  on tesoreria_saldo (cuenta_id, fecha) where deleted_at is null;
create index ix_tesoreria_saldo_fecha on tesoreria_saldo (fecha) where deleted_at is null;

insert into permiso (clave, grupo, descripcion) values
  ('tesoreria.ver',       'Finanzas', 'Ver Tesorería'),
  ('tesoreria.gestionar', 'Finanzas', 'Tesorería: cuentas y saldos')
on conflict (clave) do nothing;
```

(Los nombres de columnas y triggers de `updated_at` siguen la convención de las migraciones existentes; el
plan los ajusta a lo que ya usa el repo.) Tablas nuevas y vacías: **sin pre-flight** contra la nube. El grupo
`Finanzas` es nuevo: comprobar que la matriz de *Perfiles y Permisos* lo muestra.

### 4.2 Endpoints (`modules/tesoreria/`, respuestas en camelCase)

| Método y ruta | Permiso | Qué hace |
|---|---|---|
| `GET /tesoreria/cuentas?sucursal=` | `tesoreria.ver` | Cuentas vivas en alcance, por nombre |
| `POST /tesoreria/cuentas` | `tesoreria.gestionar` | Alta. Cuerpo `{ nombre, sucursalId? }` (`sucursalId` solo lo usa un General; ausente = general) |
| `PATCH /tesoreria/cuentas/:id` | `tesoreria.gestionar` | Cambia el nombre |
| `DELETE /tesoreria/cuentas/:id` | `tesoreria.gestionar` | Baja lógica |
| `GET /tesoreria/saldos?sucursal=&fecha=` | `tesoreria.gestionar` | Para la pestaña Saldos: cada cuenta en alcance con su saldo fijado **en esa fecha** (o `null`), más la lista de saldos fijados vivos (más recientes primero) |
| `PUT /tesoreria/saldos` | `tesoreria.gestionar` | Lote de una fecha: `{ fecha, saldos: [{ cuentaId, monto, comentario? }] }`. Una transacción; `insert … on conflict (cuenta_id, fecha) where deleted_at is null do update`. Si una cuenta del lote está fuera de alcance o dada de baja, **todo** el lote se rechaza |
| `DELETE /tesoreria/saldos/:id` | `tesoreria.gestionar` | Baja lógica del saldo fijado |
| `GET /tesoreria?sucursal=&desde=&hasta=` | `tesoreria.ver` | La vista (abajo) |

Respuesta de la vista:

```json
{
  "desde": "2026-10-05", "hasta": "2026-10-12",
  "cuentas": [
    { "id": "…", "nombre": "Efectivo TJ", "sucursalCodigo": "TJ",
      "saldoInicio": 10000.00, "saldoFinal": 9500.00 }
  ],
  "total": { "saldoInicio": 10000.00, "saldoFinal": 9500.00, "cuentasConSaldo": 1, "cuentas": 1 },
  "eventos": [
    { "tipo": "saldo-fijado", "fecha": "2026-10-10", "cuentaNombre": "Efectivo TJ",
      "monto": 9500.00, "comentario": "Arqueo", "capturo": "Admin Local" }
  ]
}
```

- `sucursalCodigo` `null` = general. Cuentas generales primero, luego por sucursal y nombre.
- `eventos` = saldos fijados **dentro** del rango, por fecha y cuenta. `tipo` deja lugar a los movimientos de
  T-29 sin cambiar la forma.
- El servicio lee los saldos fijados de las cuentas en alcance con fecha `≤ hasta + 1` y aplica §3.4; nada de
  cálculo en SQL salvo filtrar.
- Errores: rango inválido / mayor a 366 días → 400; sucursal ajena → 403 (de `resolverAlcance`); fecha futura
  en `PUT` → 400; nombre repetido → 409 "Ya existe una cuenta con ese nombre."

### 4.3 Pruebas

- **pgTAP:** nombre único sin mayúsculas/espacios entre vivas (y liberado tras la baja); un saldo vivo por
  cuenta y fecha (y liberado tras la baja); checks de nombre y comentario.
- **Unitarias** (`reglas-saldo.spec.ts`): sin saldo → `null`; fijado a media semana; dos fijados en el rango;
  fijado el mismo día que `desde`; saldo eliminado vuelve al anterior; totales con cuentas sin saldo; montos
  negativos; centavos sin error de redondeo.
- **e2e:** alcance (usuario de TJ no ve ni toca cuentas de MX → 404; ve las generales pero no las modifica →
  403); el lote de `PUT` corrige en vez de duplicar y es todo o nada; fecha futura → 400; permisos
  (`tesoreria.ver` sin `gestionar` no puede escribir); la vista con el ejemplo de §3.4.

## 5. Portal

### 5.1 Menú y ruta

- `nav-config.ts`: sección nueva **Finanzas** con **Tesorería** → `/finanzas/tesoreria`.
- Una página con **tres pestañas**; se ven según permisos: *Tesorería* (`tesoreria.ver`), *Cuentas* y *Saldos*
  (`tesoreria.gestionar`). Sin ninguno de los dos, el aviso de "No tienes permiso" de siempre. La pestaña
  elegida va en la URL (`?vista=cuentas`) para poder mandar el enlace.
- Respeta el selector global de sucursal.

### 5.2 Pestaña Tesorería

- Rango con los atajos de T-49 (Hoy, Ayer, Esta semana, Este mes) y fechas a mano; por defecto **hoy**.
- Tabla: **Cuenta · Sucursal** ("General" si no tiene) **· Saldo al inicio · Saldo al final**; "Sin saldo
  inicial" en gris cuando es `null`; negativos en rojo con signo. Pie: **Total Tesorería**, y si faltan
  saldos, "3 de 4 cuentas con saldo".
- Debajo, **Saldos fijados en el rango**: Fecha · Cuenta · Monto · Comentario · Capturó. Vacío: "Sin
  movimientos en el rango."
- **Exportar a Excel** con `exportarExcel` (T-15): hoja "Tesorería" (cuentas + total) y hoja "Movimientos".
- La tabla tiene que caber desde **1366 px** (≈1012 px de caja): medirla en el navegador.

### 5.3 Pestaña Cuentas

- `PantallaCatalogo` / `TablaCatalogo`: columnas Nombre · Sucursal; alta, editar nombre, eliminar con
  confirmación ("¿Seguro que quieres eliminar la cuenta *X*? Su historia se conserva, pero ya no aparecerá en la
  Tesorería.").
- Alta: un General elige sucursal o "General (toda la empresa)"; un usuario atado no ve el selector.
- Las cuentas generales, para un usuario atado, se listan sin botones de editar/eliminar.

### 5.4 Pestaña Saldos

- Fecha (por defecto hoy, sin fechas futuras) y **una fila por cuenta** en alcance que el usuario puede
  modificar: Cuenta · Monto · Comentario. Si la cuenta ya tiene saldo fijado ese día, la fila viene llena.
- **Guardar** manda solo las filas con monto (las vacías se ignoran; para quitar un saldo se usa la lista de
  abajo). Mensaje: "Se guardaron 3 saldos del 15-oct-2026."
- Debajo, la lista de saldos fijados (más recientes primero) con **Eliminar** y confirmación.
- Validación en vivo como la de Promociones de hoy: el aviso de un monto inválido sale en rojo solo después de
  tocar el campo.

### 5.5 Pruebas de pantalla (T-65)

Pestañas según permisos; la tabla con "Sin saldo inicial" y el total parcial; el lote solo manda las filas
llenas; confirmaciones de eliminar; usuario atado sin selector de sucursal ni botones sobre cuentas generales.

## 6. Vault (al terminar)

- `Tesorería.md`: resolver el pendiente de "Modificar Saldo" con la decisión de §2; marcar como pendiente de
  T-29 el de "campos ↔ métodos de pago"; anotar las dos "tesorerías" (§1).
- `Estado del proyecto.md` y bitácora del día; `CLAUDE.md` del repo con un bloque corto de Tesorería
  (regla del saldo al inicio del día, alcance de cuentas generales, el cálculo en un solo lugar).

## 7. Fuera de alcance

- **T-29:** depósitos, retiros, traspasos, y que cobranza y compras muevan las cuentas (incluye decidir a qué
  cuenta va cada `efectivo` / `transferencia` / `cheque`).
- **T-30/T-31:** campos de gasto y método de pago "Efectivo cobranza del día".
- **T-32:** Flujo de Efectivo (usará el Total Tesorería).
- **T-33 / en persona:** el conteo del dinero del repartidor y el corte.
- Reactivar una cuenta dada de baja; mostrar en la vista cuentas dadas de baja dentro de rangos pasados.
