-- T-25: registro de produccion por dia.
-- Spec: docs/superpowers/specs/2026-10-21-t25-produccion-por-dia-design.md
--
-- Una tabla nueva y vacia: no hay filas que violen nada, asi que el pre-flight
-- contra la nube no tiene nada que contar.
--
-- * `produccion`: piezas producidas por dia, sucursal y presentacion. Una fila
--   viva por combinacion (indice unico parcial): corregir el dia actualiza la
--   fila, y una baja logica (poner la presentacion en 0) libera el lugar para
--   volver a capturarla. 0 piezas no se guarda: es "sin registro".
--
-- El permiso `almacen_general.gestionar` ya existe: aqui no se inserta ninguno.

create table produccion (
  id                         uuid primary key default gen_random_uuid(),
  fecha                      date not null,
  sucursal_id                uuid not null references sucursal(id),
  presentacion_id            uuid not null references presentacion(id),
  piezas                     integer not null check (piezas > 0),
  capturo_usuario_id         uuid not null references usuario(id),
  actualizado_por_usuario_id uuid references usuario(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz
);

-- La red de "una sola viva por dia": el servicio actualiza la fila existente,
-- y si dos capturas chocaran, esto lo impide. Parcial para poder recapturar.
create unique index uq_produccion_dia_sucursal_presentacion
  on produccion (fecha, sucursal_id, presentacion_id) where deleted_at is null;
-- La pantalla lee el dia de una sucursal.
create index idx_produccion_sucursal_fecha on produccion (sucursal_id, fecha);

create trigger trg_produccion_updated before update on produccion
  for each row execute function set_updated_at();
