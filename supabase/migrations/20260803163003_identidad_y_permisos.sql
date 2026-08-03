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
