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
