-- T-29: Tesoreria — depositos, retiros y traspasos (registrar operacion) y a que
-- cuenta entra la cobranza. Spec:
-- docs/superpowers/specs/2026-10-19-t29-tesoreria-movimientos-design.md
--
-- La cobranza NO se copia aqui: se lee al consultar de `cobro` y de los
-- `cobranza_abono` de contado. Esta migracion solo guarda los movimientos
-- manuales y la configuracion de destinos (sucursal + metodo -> cuenta, con
-- fecha "desde"). Tablas nuevas y vacias, sin permisos nuevos: sin pre-flight.

create table tesoreria_movimiento (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  tipo               text not null
    constraint ck_tesoreria_movimiento_tipo check (tipo in ('deposito', 'retiro', 'traspaso')),
  fecha              date not null,
  monto              numeric(14,2) not null
    constraint ck_tesoreria_movimiento_monto check (monto > 0),
  cuenta_id          uuid not null references tesoreria_cuenta(id),
  cuenta_destino_id  uuid references tesoreria_cuenta(id),
  comentario         text
    constraint ck_tesoreria_movimiento_comentario
      check (comentario is null or char_length(comentario) between 1 and 200),
  capturo_usuario_id uuid not null references usuario(id),
  constraint ck_tesoreria_movimiento_traspaso check (
    (tipo = 'traspaso') = (cuenta_destino_id is not null)
    and (cuenta_destino_id is null or cuenta_destino_id <> cuenta_id)
  )
);

create index ix_tesoreria_movimiento_fecha
  on tesoreria_movimiento (fecha) where deleted_at is null;

create trigger trg_tesoreria_movimiento_updated before update on tesoreria_movimiento
  for each row execute function set_updated_at();

create table tesoreria_destino_cobranza (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  sucursal_id        uuid not null references sucursal(id),
  metodo             text not null
    constraint ck_tesoreria_destino_metodo check (metodo in ('efectivo', 'transferencia', 'cheque')),
  cuenta_id          uuid not null references tesoreria_cuenta(id),
  desde              date not null,
  capturo_usuario_id uuid not null references usuario(id)
);

create unique index uq_tesoreria_destino_vigencia
  on tesoreria_destino_cobranza (sucursal_id, metodo, desde) where deleted_at is null;

create trigger trg_tesoreria_destino_updated before update on tesoreria_destino_cobranza
  for each row execute function set_updated_at();
