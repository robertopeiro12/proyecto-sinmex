-- T-27 pieza 2: merma y consumo en la tablet.
-- Spec: docs/superpowers/specs/2026-10-23-t-27-merma-y-consumo-design.md
--
-- Una columna con default y dos tablas nuevas y vacias: no hay filas que violen
-- nada, asi que el pre-flight contra la nube no tiene nada que contar.
--
-- * `sucursal.consumo_diario_max` (D4): piezas de consumo propio que cada
--   vendedor puede registrar en un dia; 1 por defecto, 0 lo apaga. Lo exige la
--   TABLET (el servidor no lo revisa: las piezas ya salieron). Cambiarlo toca
--   `vendedor.updated_at` de esa sucursal (lo hace el backend) para que el pull
--   incremental lo baje.
-- * `movimiento_inventario` (D7): una sola tabla para los tres tipos. `id` ES la
--   clave de la operacion del push (como visita y gasto), sin default. `fecha` es
--   la `fecha_operacion` del sobre, nunca re-derivada. Solo la merma del cliente
--   lleva cliente (`ck_movimiento_cliente`). No se edita en la app (D6); la
--   correccion sera de la oficina (T-35), por eso lleva updated_at y deleted_at.
-- * `movimiento_inventario_linea`: piezas por presentacion y sentido. `recibido`
--   = lo danado que devuelve el cliente (entra a la camioneta como merma);
--   `entregado` = sale de la camioneta (reposicion, merma del trayecto, consumo).

alter table sucursal add column consumo_diario_max smallint not null default 1
  check (consumo_diario_max >= 0 and consumo_diario_max <= 99);

create table movimiento_inventario (
  id            uuid primary key,
  sucursal_id   uuid not null references sucursal(id),
  vendedor_id   uuid not null references vendedor(id),
  cliente_id    uuid references cliente(id),
  tipo          text not null check (tipo in ('merma_cliente', 'merma_trayecto', 'consumo')),
  fecha         date not null,
  comentario    text check (comentario is null or char_length(comentario) between 1 and 300),
  registrado_en timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint ck_movimiento_cliente check ((tipo = 'merma_cliente') = (cliente_id is not null))
);

-- El corte de la pieza 3: los movimientos vivos del vendedor en un dia.
create index idx_movimiento_vendedor_fecha on movimiento_inventario (vendedor_id, fecha)
  where deleted_at is null;

create trigger trg_movimiento_inventario_updated before update on movimiento_inventario
  for each row execute function set_updated_at();

create table movimiento_inventario_linea (
  id              uuid primary key default gen_random_uuid(),
  movimiento_id   uuid not null references movimiento_inventario(id),
  presentacion_id uuid not null references presentacion(id),
  sentido         text not null check (sentido in ('recibido', 'entregado')),
  piezas          integer not null check (piezas > 0),
  constraint uq_movimiento_linea unique (movimiento_id, presentacion_id, sentido)
);
