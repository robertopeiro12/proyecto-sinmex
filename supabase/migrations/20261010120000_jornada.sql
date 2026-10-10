-- T-38: la jornada del vendedor en Postgres (vehiculo + kilometraje del dia).
--
-- Hasta aqui la tablet subia la jornada cerrada como operacion `tipo: 'jornada'`
-- y el servidor la dejaba en `sync_operacion` sin proyectarla: el kilometraje
-- llegaba y nadie lo guardaba. Esta tabla es su proyeccion (ADR-0009): la
-- escribe `rutas/JornadasService.cerrarJornada` dentro de la transaccion de la
-- operacion. Ver docs/superpowers/specs/2026-10-10-t-38-jornada-backend-design.md (D1).
--
-- Solo jornadas CERRADAS: el buzon es de solo escritura hasta T-43 y la tablet
-- no sube las abiertas. Por eso km_final y cerrada_en son obligatorios.
--
-- Sin `sync_operacion_id`: la trazabilidad va por sync_operacion.entidad_tabla /
-- entidad_id (ADR-0009, enmienda §2.4).
--
-- Sin grants ni RLS: ninguna tabla de este esquema los tiene (como el resto del
-- esquema: solo el backend se conecta a la base; ningun cliente usa la anon key). Se copia lo que
-- si es patron: columnas de auditoria, trigger set_updated_at, checks con nombre
-- e indices parciales por `deleted_at is null`.

create table jornada (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  vendedor_id  uuid not null references vendedor(id),
  vehiculo_id  uuid not null references vehiculo(id),
  sucursal_id  uuid not null references sucursal(id),
  -- El dia de trabajo tal cual lo mando la tablet (`fecha_operacion`). El
  -- servidor no lo re-deriva de UTC: a las 18:00 de Tijuana en UTC ya es manana.
  fecha        date not null,
  -- numeric(10,1): el odometro marca decimas; caben hasta 999,999,999.9 km.
  km_inicial   numeric(10,1) not null,
  km_final     numeric(10,1) not null,
  abierta_en   timestamptz not null,
  cerrada_en   timestamptz not null,
  constraint ck_jornada_km_inicial check (km_inicial >= 0),
  -- El odometro no retrocede. Defensa en profundidad: el push ya lo rechaza
  -- como `jornada-km-invalido` antes de abrir la transaccion.
  constraint ck_jornada_km_final check (km_final >= km_inicial)
);
create trigger trg_jornada_updated before update on jornada
  for each row execute function set_updated_at();

-- Una jornada viva por vendedor y dia: espejo del `unique (vendedor_id, fecha)`
-- del SQLite de la tablet. Parcial, como el resto del esquema: dar de baja una
-- jornada libera el dia. `JornadasService` lo usa con `on conflict ... do nothing`
-- para responder `jornada-duplicada` sin abortar la transaccion.
create unique index uq_jornada_vendedor_fecha
  on jornada (vendedor_id, fecha) where deleted_at is null;

-- El reporte de Kilometraje del portal busca por sucursal y rango de fechas (D5).
create index idx_jornada_sucursal_fecha
  on jornada (sucursal_id, fecha) where deleted_at is null;
