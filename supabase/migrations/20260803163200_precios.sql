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
