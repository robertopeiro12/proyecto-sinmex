-- Operacion -> Procesos (PR A): merma, cambios, consumos, promocion y descuentos
-- capturados por la oficina.
-- Spec: docs/superpowers/specs/2026-11-25-procesos-design.md (D2, D3)
--
-- * `proceso_oficina` es el encabezado (un proceso de un tipo, un dia, una sucursal);
--   `proceso_oficina_linea` lleva las piezas por presentacion y sentido.
-- * Los checks de fila son TOTALES (`case ... else false`): con una columna nula la
--   logica trivalente daria NULL y dejaria pasar una combinacion invalida.
-- * Lo que no cabe en un check de fila (que cada tipo solo lleve ciertos sentidos,
--   total entregado = recibido en merma de cliente y cambios, maximo 200 lineas,
--   cliente y vendedor vivos y de la sucursal) lo exige el servicio.
--
-- Pre-flight contra la nube: nada que contar (tablas nuevas y permisos nuevos).

create table proceso_oficina (
  id                         uuid primary key default gen_random_uuid(),
  tipo                       text not null,
  sucursal_id                uuid not null references sucursal(id),
  fecha                      date not null,
  cliente_id                 uuid references cliente(id),
  -- null = Oficina (no permitido en descuento).
  vendedor_id                uuid references vendedor(id),
  merma_de                   text,
  comentario                 text,
  capturo_usuario_id         uuid not null references usuario(id),
  actualizado_por_usuario_id uuid references usuario(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz,
  constraint ck_proceso_oficina_tipo
    check (tipo in ('merma', 'cambio', 'consumo', 'promocion', 'descuento')),
  constraint ck_proceso_oficina_merma_de check (
    case tipo
      when 'merma' then merma_de is not null and merma_de in ('cliente', 'almacen')
      else merma_de is null
    end),
  constraint ck_proceso_oficina_cliente check (
    case tipo
      when 'cambio' then cliente_id is not null
      when 'promocion' then cliente_id is not null
      when 'merma' then (merma_de = 'cliente') = (cliente_id is not null)
      else cliente_id is null
    end),
  constraint ck_proceso_oficina_vendedor check (
    case tipo
      when 'descuento' then vendedor_id is not null
      else true
    end),
  constraint ck_proceso_oficina_comentario check (
    comentario is null or (comentario = btrim(comentario) and char_length(comentario) between 1 and 300))
);

create index idx_proceso_oficina_sucursal_tipo_fecha on proceso_oficina (sucursal_id, tipo, fecha)
  where deleted_at is null;
create index idx_proceso_oficina_vendedor_fecha on proceso_oficina (vendedor_id, fecha)
  where deleted_at is null;

create trigger trg_proceso_oficina_updated before update on proceso_oficina
  for each row execute function set_updated_at();

create table proceso_oficina_linea (
  id              uuid primary key default gen_random_uuid(),
  proceso_id      uuid not null references proceso_oficina(id),
  presentacion_id uuid not null references presentacion(id),
  sentido         text not null
    constraint ck_proceso_oficina_linea_sentido check (sentido in ('recibido', 'entregado')),
  piezas          integer not null
    constraint ck_proceso_oficina_linea_piezas check (piezas between 1 and 100000),
  constraint uq_proceso_oficina_linea unique (proceso_id, presentacion_id, sentido)
);

insert into permiso (clave, grupo, descripcion) values
  ('proceso.merma',     'Operacion Comercial', 'Procesos: merma de clientes y almacén'),
  ('proceso.cambio',    'Operacion Comercial', 'Procesos: cambios de producto a clientes'),
  ('proceso.consumo',   'Operacion Comercial', 'Procesos: consumos'),
  ('proceso.promocion', 'Operacion Comercial', 'Procesos: promoción (producto regalado a un cliente)'),
  ('proceso.descuento', 'Operacion Comercial', 'Procesos: descuentos por faltante a vendedores')
on conflict (clave) do nothing;
