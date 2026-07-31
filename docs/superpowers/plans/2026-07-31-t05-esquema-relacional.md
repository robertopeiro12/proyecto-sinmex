# T-05 · Esquema relacional base — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear el esquema relacional base de JAWA en PostgreSQL (Supabase) mediante migraciones SQL versionadas, con historización de precios por fecha y baja lógica.

**Architecture:** Migraciones SQL a mano en `supabase/migrations/` (sin ORM), aplicadas con la CLI de Supabase. Cada tabla lleva columnas comunes (`id` UUID, `created_at`, `updated_at`, `deleted_at`). Los tests son pgTAP (`supabase test db`) que verifican estructura y comportamiento contra un stack local.

**Tech Stack:** PostgreSQL 17 (Supabase), Supabase CLI (ya devDependency del repo, enlazada a `sinmex dev` en T-01), pgTAP para tests, Docker (para el stack local).

## Global Constraints

- **Motor:** PostgreSQL **17** (ver `supabase/config.toml` → `[db] major_version = 17`).
- **Migraciones:** archivos en `supabase/migrations/`, creados con `supabase migration new <nombre>` (genera nombre con timestamp). Nunca editar migraciones ya aplicadas en `main`; agregar nuevas.
- **PK:** `id uuid primary key default gen_random_uuid()` en toda tabla (`gen_random_uuid()` es core en PG13+, no requiere extensión).
- **Columnas comunes obligatorias en TODA tabla** (en este orden, justo después de `id`):
  ```sql
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  ```
- **`updated_at`** se mantiene con el trigger `set_updated_at()` (Task 1) en cada tabla.
- **Enums** como `text` + `check (col in (...))`, no tipos `enum` de Postgres.
- **Dinero:** `numeric(12,2)`. **Coordenadas:** `numeric(9,6)`. **Fechas de negocio:** `date`.
- **Baja lógica:** nunca `DELETE` físico en tablas con histórico; se usa `deleted_at`.
- **Tests:** pgTAP vía `supabase test db` (archivos en `supabase/tests/`). Requiere stack local: `supabase start` (necesita Docker corriendo). Cada test empieza con `begin; select plan(n);` y termina con `select * from finish(); rollback;`.
- **Prerrequisito de entorno:** Docker corriendo. Si no hay Docker, no se pueden correr `supabase start` / `supabase db reset` / `supabase test db` localmente (fallback: Supabase branch en el plan Pro — fuera de alcance de este plan).

---

### Task 1: Stack local + función `set_updated_at()`

**Files:**
- Create: `supabase/migrations/<ts>_extensiones_y_triggers.sql`
- Test: `supabase/tests/00_setup_test.sql`

**Interfaces:**
- Produces: función `set_updated_at() returns trigger` — usada por los triggers `trg_<tabla>_updated` de todas las tareas siguientes.

- [ ] **Step 1: Verificar que el stack local levanta**

Run: `supabase start`
Expected: arranca los contenedores y muestra las URLs locales (API, DB, Studio). Si falla por Docker, detenerse y avisar al usuario.

- [ ] **Step 2: Crear el archivo de test pgTAP**

Create `supabase/tests/00_setup_test.sql`:
```sql
begin;
select plan(1);

select has_function('set_updated_at', 'existe la función set_updated_at');

select * from finish();
rollback;
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `supabase test db`
Expected: FAIL — `set_updated_at` no existe todavía.

- [ ] **Step 4: Crear la migración**

Run: `supabase migration new extensiones_y_triggers`
Escribir en el archivo generado:
```sql
-- gen_random_uuid() es parte del core de Postgres 13+, no requiere extensión.

-- Función reutilizable para mantener updated_at en cada UPDATE.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

- [ ] **Step 5: Aplicar y correr el test**

Run: `supabase db reset && supabase test db`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests/00_setup_test.sql
git commit -m "T-05: función set_updated_at + harness pgTAP"
```

---

### Task 2: Identidad y permisos (RBAC)

**Files:**
- Create: `supabase/migrations/<ts>_identidad_y_permisos.sql`
- Test: `supabase/tests/10_identidad_test.sql`

**Interfaces:**
- Consumes: `set_updated_at()` (Task 1).
- Produces: tablas `sucursal`, `perfil`, `permiso`, `perfil_permiso`, `usuario`, `usuario_permiso`, `vendedor`. Otras tareas referencian `sucursal(id)`, `perfil(id)`, `permiso(id)`, `vendedor(id)`.

- [ ] **Step 1: Crear el archivo de test pgTAP**

Create `supabase/tests/10_identidad_test.sql`:
```sql
begin;
select plan(9);

select has_table('sucursal');
select has_table('perfil');
select has_table('permiso');
select has_table('perfil_permiso');
select has_table('usuario');
select has_table('usuario_permiso');
select has_table('vendedor');

-- usuario.sucursal_id es nullable (null = General)
select col_is_null('usuario', 'sucursal_id', 'usuario.sucursal_id permite null (General)');

-- perfil_permiso no permite duplicados (perfil, permiso)
select has_index('perfil_permiso', 'perfil_permiso_perfil_id_permiso_id_key');

select * from finish();
rollback;
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `supabase test db`
Expected: FAIL — las tablas de identidad no existen.

- [ ] **Step 3: Crear la migración**

Run: `supabase migration new identidad_y_permisos`
Escribir:
```sql
create table sucursal (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  codigo text not null unique,
  nombre text not null,
  activa boolean not null default true
);
create trigger trg_sucursal_updated before update on sucursal
  for each row execute function set_updated_at();

create table perfil (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null unique
);
create trigger trg_perfil_updated before update on perfil
  for each row execute function set_updated_at();

create table permiso (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  clave text not null unique,
  grupo text not null,
  descripcion text
);
create trigger trg_permiso_updated before update on permiso
  for each row execute function set_updated_at();

create table perfil_permiso (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  perfil_id uuid not null references perfil(id),
  permiso_id uuid not null references permiso(id),
  unique (perfil_id, permiso_id)
);
create trigger trg_perfil_permiso_updated before update on perfil_permiso
  for each row execute function set_updated_at();

create table usuario (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  login text not null unique,
  password_hash text not null,
  nombre text not null,
  perfil_id uuid not null references perfil(id),
  sucursal_id uuid references sucursal(id)  -- null = General (todas las sucursales)
);
create trigger trg_usuario_updated before update on usuario
  for each row execute function set_updated_at();

create table usuario_permiso (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  usuario_id uuid not null references usuario(id),
  permiso_id uuid not null references permiso(id),
  habilitado boolean not null,
  unique (usuario_id, permiso_id)
);
create trigger trg_usuario_permiso_updated before update on usuario_permiso
  for each row execute function set_updated_at();

create table vendedor (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  login text not null unique,
  password_hash text not null,
  nombre text not null,
  sucursal_id uuid not null references sucursal(id),
  activo boolean not null default true
);
create trigger trg_vendedor_updated before update on vendedor
  for each row execute function set_updated_at();
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `supabase db reset && supabase test db`
Expected: PASS (9 tests en 10_identidad, más los previos).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/10_identidad_test.sql
git commit -m "T-05: identidad y permisos (sucursal, usuario, vendedor, RBAC)"
```

---

### Task 3: Catálogos (producto, presentación, vehículo, tipo de negocio)

**Files:**
- Create: `supabase/migrations/<ts>_catalogos.sql`
- Test: `supabase/tests/20_catalogos_test.sql`

**Interfaces:**
- Consumes: `set_updated_at()` (Task 1), `sucursal(id)` (Task 2).
- Produces: `producto`, `presentacion`, `vehiculo`, `tipo_negocio`. Otras tareas referencian `producto(id)`, `presentacion(id)`, `tipo_negocio(id)`.

- [ ] **Step 1: Crear el archivo de test pgTAP**

Create `supabase/tests/20_catalogos_test.sql`:
```sql
begin;
select plan(5);

select has_table('producto');
select has_table('presentacion');
select has_table('vehiculo');
select has_table('tipo_negocio');

-- presentacion referencia producto
select fk_ok('presentacion', 'producto_id', 'producto', 'id');

select * from finish();
rollback;
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `supabase test db`
Expected: FAIL — tablas de catálogos no existen.

- [ ] **Step 3: Crear la migración**

Run: `supabase migration new catalogos`
Escribir:
```sql
create table producto (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null,
  activo boolean not null default true
);
create trigger trg_producto_updated before update on producto
  for each row execute function set_updated_at();

create table presentacion (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  producto_id uuid not null references producto(id),
  volumen text not null
);
create trigger trg_presentacion_updated before update on presentacion
  for each row execute function set_updated_at();

create table vehiculo (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null,
  km_inicial numeric(10,2),
  sucursal_id uuid not null references sucursal(id),
  activo boolean not null default true
);
create trigger trg_vehiculo_updated before update on vehiculo
  for each row execute function set_updated_at();

create table tipo_negocio (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null unique
);
create trigger trg_tipo_negocio_updated before update on tipo_negocio
  for each row execute function set_updated_at();
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `supabase db reset && supabase test db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/20_catalogos_test.sql
git commit -m "T-05: catálogos (producto, presentacion, vehiculo, tipo_negocio)"
```

---

### Task 4: Precios historizados

**Files:**
- Create: `supabase/migrations/<ts>_precios.sql`
- Test: `supabase/tests/30_precios_test.sql`

**Interfaces:**
- Consumes: `set_updated_at()` (Task 1), `sucursal(id)` (Task 2), `presentacion(id)` (Task 3).
- Produces: `lista_precio`, `precio`. Otras tareas referencian `lista_precio(id)`.

- [ ] **Step 1: Crear el archivo de test pgTAP (estructura + comportamiento de historización)**

Create `supabase/tests/30_precios_test.sql`:
```sql
begin;
select plan(3);

select has_table('lista_precio');
select has_table('precio');

-- Comportamiento: el precio vigente a una fecha es el de mayor vigente_desde <= fecha.
-- Preparar datos mínimos.
with s as (
  insert into sucursal (codigo, nombre) values ('TT', 'Test') returning id
), pr as (
  insert into producto (nombre) values ('Jamaica Test') returning id
), pre as (
  insert into presentacion (producto_id, volumen) select id, '500 ml' from pr returning id
), lp as (
  insert into lista_precio (nombre) values ('Lista Test') returning id
)
insert into precio (presentacion_id, lista_precio_id, sucursal_id, precio, vigente_desde)
select pre.id, lp.id, s.id, v.precio, v.vigente_desde
from pre, lp, s,
     (values (13.00, date '2026-01-01'), (14.00, date '2026-07-01')) as v(precio, vigente_desde);

select is(
  (select precio
     from precio
    where vigente_desde <= date '2026-05-15'
    order by vigente_desde desc
    limit 1),
  13.00::numeric,
  'a mayo aplica el precio de enero ($13)'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `supabase test db`
Expected: FAIL/ERROR — `lista_precio`/`precio` no existen.

- [ ] **Step 3: Crear la migración**

Run: `supabase migration new precios`
Escribir:
```sql
create table lista_precio (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null unique
);
create trigger trg_lista_precio_updated before update on lista_precio
  for each row execute function set_updated_at();

create table precio (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  presentacion_id uuid not null references presentacion(id),
  lista_precio_id uuid not null references lista_precio(id),
  sucursal_id uuid not null references sucursal(id),
  precio numeric(12,2) not null,
  vigente_desde date not null
);
create trigger trg_precio_updated before update on precio
  for each row execute function set_updated_at();

create index idx_precio_lookup
  on precio (presentacion_id, lista_precio_id, sucursal_id, vigente_desde desc);
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `supabase db reset && supabase test db`
Expected: PASS (incluida la prueba de historización).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/30_precios_test.sql
git commit -m "T-05: precios por listas historizados"
```

---

### Task 5: Clientes

**Files:**
- Create: `supabase/migrations/<ts>_clientes.sql`
- Test: `supabase/tests/40_clientes_test.sql`

**Interfaces:**
- Consumes: `set_updated_at()` (Task 1), `sucursal(id)` (Task 2), `producto(id)`/`presentacion(id)`/`tipo_negocio(id)` (Task 3), `lista_precio(id)` (Task 4).
- Produces: `cliente`, `cliente_precio`, `cliente_promocion_producto`. Otras tareas referencian `cliente(id)`.

- [ ] **Step 1: Crear el archivo de test pgTAP**

Create `supabase/tests/40_clientes_test.sql`:
```sql
begin;
select plan(4);

select has_table('cliente');
select has_table('cliente_precio');
select has_table('cliente_promocion_producto');

-- Prerrequisitos autocontenidos (se revierten con el rollback), para no depender de semillas.
insert into sucursal (codigo, nombre) values ('TT', 'Test');
insert into lista_precio (nombre) values ('Lista Test');

-- promocion solo acepta los valores permitidos
select throws_ok(
  $$ insert into cliente
       (nombre, domicilio, telefono, factura, tipo, lista_precio_id, promocion, sucursal_id)
     values
       ('X','Y','000', false, 'cliente',
        (select id from lista_precio where nombre = 'Lista Test'),
        'invalida',
        (select id from sucursal where codigo = 'TT')) $$,
  '23514',
  null,
  'promocion rechaza valores fuera del check'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `supabase test db`
Expected: FAIL — tablas de cliente no existen.

- [ ] **Step 3: Crear la migración**

Run: `supabase migration new clientes`
Escribir:
```sql
create table cliente (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null,
  domicilio text not null,
  telefono text not null,
  encargado text,
  factura boolean not null default false,
  tipo text not null check (tipo in ('cliente','prospecto')),
  tipo_negocio_id uuid references tipo_negocio(id),
  lista_precio_id uuid not null references lista_precio(id),
  pct_comision numeric(5,2),
  promocion text not null default 'ninguna' check (promocion in ('ninguna','10+1','20+1')),
  plazo_credito_dias integer,
  lat numeric(9,6),
  lng numeric(9,6),
  comentarios text,
  sucursal_id uuid not null references sucursal(id)
);
create trigger trg_cliente_updated before update on cliente
  for each row execute function set_updated_at();

create table cliente_precio (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  cliente_id uuid not null references cliente(id),
  presentacion_id uuid not null references presentacion(id),
  precio numeric(12,2) not null,
  vigente_desde date not null
);
create trigger trg_cliente_precio_updated before update on cliente_precio
  for each row execute function set_updated_at();

create table cliente_promocion_producto (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  cliente_id uuid not null references cliente(id),
  producto_id uuid not null references producto(id),
  unique (cliente_id, producto_id)
);
create trigger trg_cliente_promocion_producto_updated before update on cliente_promocion_producto
  for each row execute function set_updated_at();
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `supabase db reset && supabase test db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/40_clientes_test.sql
git commit -m "T-05: clientes (cliente, override de precio, promo por producto)"
```

---

### Task 6: Transaccional (ventas, cobranza, rutas)

**Files:**
- Create: `supabase/migrations/<ts>_transaccional.sql`
- Test: `supabase/tests/50_transaccional_test.sql`

**Interfaces:**
- Consumes: `set_updated_at()` (Task 1), `sucursal(id)`/`vendedor(id)` (Task 2), `presentacion(id)` (Task 3), `cliente(id)` (Task 5).
- Produces: `venta_nota`, `venta_nota_detalle`, `cobranza_abono`, `ruta`.

- [ ] **Step 1: Crear el archivo de test pgTAP**

Create `supabase/tests/50_transaccional_test.sql`:
```sql
begin;
select plan(6);

select has_table('venta_nota');
select has_table('venta_nota_detalle');
select has_table('cobranza_abono');
select has_table('ruta');

-- folio es único
select col_is_unique('venta_nota', 'folio');

-- el detalle referencia presentacion (no producto)
select fk_ok('venta_nota_detalle', 'presentacion_id', 'presentacion', 'id');

select * from finish();
rollback;
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `supabase test db`
Expected: FAIL — tablas transaccionales no existen.

- [ ] **Step 3: Crear la migración**

Run: `supabase migration new transaccional`
Escribir:
```sql
create table venta_nota (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  folio text not null unique,
  fecha date not null,
  cliente_id uuid not null references cliente(id),
  vendedor_id uuid not null references vendedor(id),
  monto_total numeric(12,2) not null default 0,
  num_nota text not null,
  contado_credito text not null check (contado_credito in ('contado','credito')),
  factura text,
  semana integer not null,
  mes integer not null,
  status text not null check (status in ('pagada','pendiente','abonado','cuenta_perdida','promocion')),
  sucursal_id uuid not null references sucursal(id)
);
create trigger trg_venta_nota_updated before update on venta_nota
  for each row execute function set_updated_at();

create table venta_nota_detalle (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  venta_nota_id uuid not null references venta_nota(id),
  presentacion_id uuid not null references presentacion(id),
  cantidad integer not null,
  precio numeric(12,2) not null,
  cantidad_promocion integer not null default 0
);
create trigger trg_venta_nota_detalle_updated before update on venta_nota_detalle
  for each row execute function set_updated_at();

create table cobranza_abono (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  venta_nota_id uuid not null references venta_nota(id),
  fecha_pago date not null,
  vendedor_id uuid not null references vendedor(id),
  monto numeric(12,2) not null,
  tipo text not null check (tipo in ('cobranza','abono')),
  saldo_pendiente numeric(12,2) not null,
  metodo_pago text not null check (metodo_pago in ('efectivo','transferencia','cheque'))
);
create trigger trg_cobranza_abono_updated before update on cobranza_abono
  for each row execute function set_updated_at();

create table ruta (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  cliente_id uuid not null references cliente(id),
  vendedor_id uuid not null references vendedor(id),
  fecha date not null,
  orden integer not null,
  tipo text not null check (tipo in ('diaria','semanal'))
);
create trigger trg_ruta_updated before update on ruta
  for each row execute function set_updated_at();
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `supabase db reset && supabase test db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/50_transaccional_test.sql
git commit -m "T-05: transaccional (venta_nota, detalle, cobranza_abono, ruta)"
```

---

### Task 7: Semillas de catálogos

**Files:**
- Create: `supabase/migrations/<ts>_semillas.sql`
- Test: `supabase/tests/60_semillas_test.sql`

**Interfaces:**
- Consumes: `sucursal` (Task 2), `lista_precio` (Task 4), `perfil`/`permiso` (Task 2).
- Produces: filas semilla (idempotentes) de sucursales, listas, perfiles y permisos.

- [ ] **Step 1: Crear el archivo de test pgTAP**

Create `supabase/tests/60_semillas_test.sql`:
```sql
begin;
select plan(3);

select is(
  (select count(*) from sucursal where codigo in ('TJ','MX')),
  2::bigint,
  'se sembraron Tijuana y Mexicali'
);

select is(
  (select count(*) from lista_precio),
  5::bigint,
  'se sembraron 5 listas (Lista 1-4 + Especial)'
);

select is(
  (select count(*) from perfil),
  6::bigint,
  'se sembraron los 6 perfiles semilla'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `supabase test db`
Expected: FAIL — no hay semillas todavía.

- [ ] **Step 3: Crear la migración**

Run: `supabase migration new semillas`
Escribir:
```sql
insert into sucursal (codigo, nombre) values
  ('TJ', 'Tijuana'),
  ('MX', 'Mexicali')
on conflict (codigo) do nothing;

insert into lista_precio (nombre) values
  ('Lista 1'), ('Lista 2'), ('Lista 3'), ('Lista 4'), ('Especial')
on conflict (nombre) do nothing;

insert into perfil (nombre) values
  ('Administrador General'),
  ('Administrador'),
  ('Jefe de Ventas'),
  ('Jefe de producción'),
  ('Almacenista'),
  ('Auxiliar Administrativo')
on conflict (nombre) do nothing;

insert into permiso (clave, grupo, descripcion) values
  ('reporte_ventas.ver',    'General',              'Ver Reporte de Ventas'),
  ('producto.gestionar',    'General',              'Registrar/editar/eliminar productos'),
  ('peticiones.gestionar',  'Operacion Comercial',  'Autorizar/denegar eliminación de ventas y cobranzas'),
  ('venta.registrar',       'Operacion Comercial',  'Registrar venta'),
  ('venta.editar_eliminar', 'Operacion Comercial',  'Editar y eliminar venta'),
  ('cobranza.registrar',    'Operacion Comercial',  'Registrar cobranza/abono'),
  ('cobranza.editar_eliminar','Operacion Comercial','Editar y eliminar cobranza'),
  ('merma.gestionar',       'Operacion Comercial',  'Registrar/editar/eliminar merma'),
  ('promocion.gestionar',   'Operacion Comercial',  'Registrar/editar/eliminar promoción y consumo'),
  ('ruta_diaria.gestionar', 'Operacion Comercial',  'Ruta Diaria'),
  ('ruta_semanal.gestionar','Operacion Comercial',  'Ruta Semanal'),
  ('cliente.gestionar',     'Operacion Comercial',  'Registrar/editar/eliminar clientes'),
  ('prospecto.gestionar',   'Operacion Comercial',  'Registrar/editar/eliminar prospectos'),
  ('vendedor.gestionar',    'Operacion Comercial',  'Registrar/editar/eliminar vendedores'),
  ('vehiculo.gestionar',    'Operacion Comercial',  'Registrar/editar/eliminar vehículos'),
  ('carga.gestionar',       'Produccion/Almacen',   'Registrar/editar/eliminar carga'),
  ('retorno.gestionar',     'Produccion/Almacen',   'Registrar/editar retorno de mercancía'),
  ('inventario.ver',        'Produccion/Almacen',   'Información de inventario'),
  ('almacen_general.gestionar','Produccion/Almacen','Entradas/salidas del Almacén General'),
  ('almacen_sucursal.gestionar','Produccion/Almacen','Entradas/salidas del Almacén de Sucursal'),
  ('reportes.ver',          'Informacion',          'Acceso a reportes'),
  ('analisis_cliente.ver',  'Informacion',          'Análisis de Cliente')
on conflict (clave) do nothing;
```

- [ ] **Step 4: Aplicar y correr el test**

Run: `supabase db reset && supabase test db`
Expected: PASS (todos los archivos de test verdes).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/60_semillas_test.sql
git commit -m "T-05: semillas (sucursales, listas, perfiles, permisos)"
```

---

### Task 8: Cierre — verificación completa y PR

**Files:**
- (ninguno nuevo)

- [ ] **Step 1: Reset limpio de extremo a extremo**

Run: `supabase db reset`
Expected: aplica las 7 migraciones en orden, sin error.

- [ ] **Step 2: Correr toda la suite de tests**

Run: `supabase test db`
Expected: todos los archivos de `supabase/tests/` en PASS.

- [ ] **Step 3: Verificar que la CLI reconoce las migraciones**

Run: `supabase migration list`
Expected: lista las 7 migraciones nuevas como locales (Local) pendientes de aplicar en remoto — **no** aplicar a `sinmex dev` en este ticket (eso es despliegue, fuera de alcance).

- [ ] **Step 4: Push de la rama y abrir PR**

```bash
git push -u origin feature/t-05-esquema
gh pr create --title "T-05 · Esquema relacional base" \
  --body "Implementa el esquema relacional base (T-05). Migraciones SQL + tests pgTAP. Cierra #5."
```
Expected: el PR dispara CI; revisar que quede en verde antes de mergear.

---

## Notas de ejecución

- **`db reset` corre TODOS los tests de `supabase/tests/`** después de aplicar migraciones. Por eso, al escribir el test de una tarea *antes* de su migración, ese test falla mientras los previos siguen verdes — es el "rojo" esperado del TDD.
- **No aplicar a `sinmex dev`** (`supabase db push`) en este ticket: T-05 entrega esquema + migraciones versionadas; el despliegue a un entorno remoto es otro paso.
- Si Docker no está disponible y `supabase start` falla, detenerse y coordinar con el usuario (no hay forma local de correr los tests sin el stack).
