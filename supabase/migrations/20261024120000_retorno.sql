-- Retorno del vendedor: piezas buenas que el almacenista recibe de vuelta.
-- Spec: docs/superpowers/specs/2026-10-22-retorno-del-vendedor-design.md
--
-- Una tabla nueva y vacia: no hay filas que violen nada, asi que el pre-flight
-- contra la nube no tiene nada que contar.
--
-- * `retorno`: piezas buenas retornadas por dia, vendedor y presentacion. Una
--   fila viva por combinacion (indice unico parcial): corregir el dia actualiza
--   la fila, y una baja logica (poner la presentacion en 0) libera el lugar para
--   volver a capturarla. 0 piezas no se guarda: es "sin registro". La merma no
--   entra aqui. `sucursal_id` es la del vendedor (la llena el servicio).
--
-- El permiso `retorno.gestionar` ya existe: aqui no se inserta ninguno.

create table retorno (
  id                         uuid primary key default gen_random_uuid(),
  fecha                      date not null,
  vendedor_id                uuid not null references vendedor(id),
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
create unique index uq_retorno_dia_vendedor_presentacion
  on retorno (fecha, vendedor_id, presentacion_id) where deleted_at is null;
-- La pantalla no lo usa (lee por vendedor y fecha con el indice unico de arriba);
-- sirve a lectores por sucursal y dia, como T-24 y el corte.
create index idx_retorno_sucursal_fecha on retorno (sucursal_id, fecha);

create trigger trg_retorno_updated before update on retorno
  for each row execute function set_updated_at();
