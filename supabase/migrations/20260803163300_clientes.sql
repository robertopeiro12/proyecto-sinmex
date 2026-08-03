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
