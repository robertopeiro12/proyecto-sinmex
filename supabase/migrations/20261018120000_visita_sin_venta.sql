-- T-39: visita sin venta y motivo de no surtido.
-- Spec: docs/superpowers/specs/2026-10-18-t-39-visita-sin-venta-design.md
--
-- Dos tablas nuevas y vacias (mas la semilla del catalogo): no hay filas que
-- violen nada, asi que no hace falta pre-flight contra la nube.
--
-- * `motivo_visita` es un catalogo GLOBAL, como `tipo_negocio` (D1): la oficina
--   lo administra en el portal y baja en el pull como `motivos_visita`.
-- * `visita` guarda cada visita sin venta que sube la tablet (D2). Su `id` es la
--   clave de la operacion del push (como el prospecto en T-75), asi que la foto
--   se liga a ella sin ambiguedad. Sin FK a `jornada`: vendedor + fecha bastan.

-- Gemelo de `set_updated_at()` para las tablas que nombran sus tiempos
-- `creado_en`/`actualizado_en` (el spec de T-39 lo fija asi). El pull
-- incremental corta por `actualizado_en`, y la baja logica tiene que moverlo.
create or replace function set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

create table motivo_visita (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null
    constraint ck_motivo_visita_nombre check (btrim(nombre) <> ''),
  exige_foto     boolean not null default false,
  exige_atendio  boolean not null default false,
  deleted_at     timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Mismo patron que `uq_tesoreria_cuenta_nombre`: "Cerrado", "cerrado" y
-- " Cerrado " son el mismo motivo, y dar uno de baja libera su nombre.
create unique index uq_motivo_visita_nombre
  on motivo_visita (lower(btrim(nombre))) where deleted_at is null;

create trigger trg_motivo_visita_actualizado before update on motivo_visita
  for each row execute function set_actualizado_en();

-- Semilla del cliente (respuesta 3 de Mario, 2026-10-18).
insert into motivo_visita (nombre, exige_foto, exige_atendio) values
  ('Tenía producto',         false, false),
  ('Sin dinero',             false, false),
  ('No estaba el encargado', true,  true),
  ('Competencia',            false, false),
  ('Cerrado',                true,  false)
on conflict do nothing;

create table visita (
  id               uuid primary key,             -- = clave de la operacion (D2)
  vendedor_id      uuid not null references vendedor(id),
  sucursal_id      uuid not null references sucursal(id),
  cliente_id       uuid not null references cliente(id),
  motivo_visita_id uuid not null references motivo_visita(id),
  fecha            date not null,                -- fecha_operacion del sobre
  visitada_en      timestamptz not null,         -- cuando el vendedor la guardo
  observaciones    text,
  atendio          text,
  lat              numeric(9,6),
  lng              numeric(9,6),
  precision_m      numeric,
  direccion_texto  text,
  foto_archivo     text,                         -- nombre dentro de FOTOS_DIR
  foto_subida_en   timestamptz,
  creado_en        timestamptz not null default now(),
  constraint ck_visita_coordenadas check (
    (lat is null and lng is null)
    or (lat is not null and lng is not null
        and lat between -90 and 90 and lng between -180 and 180)),
  -- Sin GPS, la visita exige una direccion escrita (respuesta 2 de Mario).
  constraint ck_visita_ubicacion check (
    (lat is not null) or (btrim(coalesce(direccion_texto, '')) <> '')),
  constraint ck_visita_precision check (precision_m is null or precision_m >= 0),
  -- Igual que `ck_cliente_foto_completa`: nombre y fecha se escriben juntos.
  constraint ck_visita_foto_completa check ((foto_archivo is null) = (foto_subida_en is null))
);

-- Visita-Venta (T-55) cuenta visitas por cliente y dia; los reportes, por vendedor y dia.
create index idx_visita_cliente_fecha on visita (cliente_id, fecha);
create index idx_visita_vendedor_fecha on visita (vendedor_id, fecha);

-- El perfil `Administrador General` lo recibe solo (PERFIL_MAESTRO). Leer el
-- catalogo solo pide sesion del portal (D5).
insert into permiso (clave, grupo, descripcion) values
  ('motivo_visita.gestionar', 'General', 'Motivos de visita: alta, edición y baja')
on conflict (clave) do nothing;
