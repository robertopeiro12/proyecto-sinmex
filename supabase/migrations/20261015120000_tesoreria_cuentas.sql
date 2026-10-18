-- T-28: Tesoreria — cuentas (los "campos" del cliente) y saldos fijados.
-- Spec: docs/superpowers/specs/2026-10-15-t28-tesoreria-cuentas-saldo-inicial-design.md
--
-- Una cuenta es de una sucursal o general (sucursal_id null). Un saldo fijado es
-- el saldo real de una cuenta al INICIO de un dia: el primero es el saldo inicial
-- y los siguientes son "modificar saldo" (nuevo punto de partida). Los
-- movimientos (depositos, retiros, traspasos, cobranza) llegan en T-29.
-- Tablas nuevas y vacias: sin pre-flight contra la nube.

create table tesoreria_cuenta (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  nombre      text not null
    constraint ck_tesoreria_cuenta_nombre check (char_length(btrim(nombre)) between 1 and 60),
  sucursal_id uuid references sucursal(id)
);

create unique index uq_tesoreria_cuenta_nombre
  on tesoreria_cuenta (lower(btrim(nombre))) where deleted_at is null;

create trigger trg_tesoreria_cuenta_updated before update on tesoreria_cuenta
  for each row execute function set_updated_at();

create table tesoreria_saldo (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  cuenta_id          uuid not null references tesoreria_cuenta(id),
  fecha              date not null,
  monto              numeric(14,2) not null,
  comentario         text
    constraint ck_tesoreria_saldo_comentario
      check (comentario is null or char_length(comentario) between 1 and 200),
  capturo_usuario_id uuid not null references usuario(id)
);

create unique index uq_tesoreria_saldo_cuenta_fecha
  on tesoreria_saldo (cuenta_id, fecha) where deleted_at is null;

create index ix_tesoreria_saldo_fecha
  on tesoreria_saldo (fecha) where deleted_at is null;

create trigger trg_tesoreria_saldo_updated before update on tesoreria_saldo
  for each row execute function set_updated_at();

-- El perfil `Administrador General` los recibe solo (PERFIL_MAESTRO,
-- apps/backend/src/modules/auth/permisos.ts). Grupo nuevo: Finanzas.
insert into permiso (clave, grupo, descripcion) values
  ('tesoreria.ver',       'Finanzas', 'Ver Tesorería'),
  ('tesoreria.gestionar', 'Finanzas', 'Tesorería: cuentas y saldos')
on conflict (clave) do nothing;
