-- Sesiones de refresh del portal (T-06).
-- El token se guarda hasheado: robar la base no entrega sesiones usables.
-- Sin deleted_at a proposito: una sesion se revoca, no se da de baja logica.

create table sesion_refresh (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  usuario_id uuid not null references usuario(id),
  token_hash text not null unique,
  expira_en timestamptz not null,
  revocada_en timestamptz,
  reemplazada_por uuid references sesion_refresh(id)
);

create index idx_sesion_refresh_usuario on sesion_refresh (usuario_id);

create trigger trg_sesion_refresh_updated before update on sesion_refresh
  for each row execute function set_updated_at();
