-- T-74: promociones por regla (spec 2026-10-14, D1, D10, D12, D14, D19).
--
-- Sustituye al enum `cliente.promocion` (10+1 / 20+1) y a `cliente_promocion_producto`
-- por una tabla de reglas. No hay migracion de datos: medido el 2026-10-14,
-- cero clientes con promocion capturada en la nube y en local. La guardia de
-- abajo convierte "en blanco" en una decision explicita: si algun dia hay
-- datos, la migracion se niega y alguien los recaptura en Promociones.

do $$
begin
  if exists (select 1 from cliente where promocion <> 'ninguna')
     or exists (select 1 from cliente_promocion_producto) then
    raise exception 'T-74: hay promociones capturadas con el modelo viejo; recapturalas en Promociones antes de migrar';
  end if;
end $$;

create table promocion (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sucursal_id uuid not null references sucursal(id),
  activo boolean not null default true,
  audiencia text not null check (audiencia in ('todos','cliente','prospecto')),
  cliente_id uuid references cliente(id),
  compra_tipo text not null check (compra_tipo in ('cualquiera','producto','presentacion')),
  compra_producto_id uuid references producto(id),
  compra_presentacion_id uuid references presentacion(id),
  compra_cantidad integer not null check (compra_cantidad >= 0),
  regalo_tipo text not null check (regalo_tipo in ('mismo','producto','presentacion')),
  regalo_producto_id uuid references producto(id),
  regalo_presentacion_id uuid references presentacion(id),
  regalo_cantidad integer not null check (regalo_cantidad >= 1),
  se_repite boolean not null default true,
  constraint ck_promocion_audiencia check (
    (audiencia = 'cliente') = (cliente_id is not null)),
  constraint ck_promocion_compra check (
    (compra_tipo = 'cualquiera' and compra_producto_id is null and compra_presentacion_id is null) or
    (compra_tipo = 'producto' and compra_producto_id is not null and compra_presentacion_id is null) or
    (compra_tipo = 'presentacion' and compra_presentacion_id is not null and compra_producto_id is null)),
  constraint ck_promocion_regalo check (
    (regalo_tipo = 'mismo' and regalo_producto_id is null and regalo_presentacion_id is null and compra_tipo <> 'cualquiera') or
    (regalo_tipo = 'producto' and regalo_producto_id is not null and regalo_presentacion_id is null) or
    (regalo_tipo = 'presentacion' and regalo_presentacion_id is not null and regalo_producto_id is null)),
  -- Comprar 0 solo tiene sentido en el regalo de bienvenida al prospecto (D7).
  constraint ck_promocion_compra_cero check (compra_cantidad > 0 or audiencia = 'prospecto')
);
create trigger trg_promocion_updated before update on promocion
  for each row execute function set_updated_at();
create index idx_promocion_sucursal on promocion (sucursal_id) where deleted_at is null;
create index idx_promocion_cliente on promocion (cliente_id) where deleted_at is null and cliente_id is not null;

-- Trazabilidad por nota (D12). Sin `deleted_at`: cuando la oficina edita la
-- nota, las filas se BORRAN (D15); nunca se tocan por otra via.
create table venta_nota_promocion (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  venta_nota_id uuid not null references venta_nota(id),
  promocion_id uuid references promocion(id),          -- nulo si llego un id desconocido (D13)
  presentacion_id uuid not null references presentacion(id),
  cantidad integer not null check (cantidad >= 1),
  promocion_texto text not null                         -- la frase, congelada al vender
);
create index idx_venta_nota_promocion_nota on venta_nota_promocion (venta_nota_id);

-- D14: lo fija el servidor al proyectar la primera nota viva del cliente.
alter table cliente add column primera_venta_en timestamptz;
update cliente c set primera_venta_en = v.primera
  from (select cliente_id, min(created_at) as primera
          from venta_nota where deleted_at is null group by cliente_id) v
  where v.cliente_id = c.id;

drop table cliente_promocion_producto;
alter table cliente drop column promocion;

-- D19: el permiso ya sembrado cambia de descripcion; el consumo llegara con T-27.
update permiso set descripcion = 'Promociones: crear, editar y desactivar'
  where clave = 'promocion.gestionar';
