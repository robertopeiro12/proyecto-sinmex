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
