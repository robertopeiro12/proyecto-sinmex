-- Sesiones de refresh de la APP del vendedor (T-06, segunda mitad).
--
-- Es una tabla aparte de `sesion_refresh` (la del portal) a proposito, y no un
-- `vendedor_id` nullable en aquella:
--
--   * `sesion_refresh.usuario_id` es NOT NULL con FK a `usuario`. Para meter
--     vendedores ahi habria que hacerlo nullable y agregar `vendedor_id`
--     tambien nullable, con un check de "uno y solo uno". Eso cambia una
--     restriccion que hoy la base garantiza sola por una que depende de que el
--     check este bien escrito.
--   * Usuario y Vendedor son entidades separadas por decision de dominio (ver
--     [[Usuario]] y [[Vendedor]] en el vault): distinto proposito, distinto
--     ciclo de vida (los vendedores son rotativos). Sus sesiones tampoco tienen
--     por que compartir tabla.
--   * Y lo practico: la auth del portal ya funciona y esta probada. Tocar su
--     tabla para agregar la app es arriesgar lo que ya sirve.
--
-- Mismo diseno que `sesion_refresh`: el token se guarda hasheado (robar la base
-- no entrega sesiones usables), sin deleted_at (una sesion se revoca, no se da
-- de baja logica) y con `reemplazada_por` para encadenar las rotaciones.

create table sesion_vendedor (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vendedor_id uuid not null references vendedor(id),
  token_hash text not null unique,
  expira_en timestamptz not null,
  revocada_en timestamptz,
  reemplazada_por uuid references sesion_vendedor(id)
);

create index idx_sesion_vendedor_vendedor on sesion_vendedor (vendedor_id);

create trigger trg_sesion_vendedor_updated before update on sesion_vendedor
  for each row execute function set_updated_at();
