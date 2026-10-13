-- T-34: el pago como entidad (`cobro`) y las peticiones de borrado.
--
-- 1. `cobro`: un renglon por pago recibido (tablet o portal) o por saldo a
--    favor aplicado (T-21). Hasta hoy un pago a varias notas eran filas
--    sueltas en `cobranza_abono` mas, si sobraba, un `saldo_favor_movimiento`,
--    sin nada que dijera "esto es un mismo pago". Borrar un pedazo dejaria las
--    cuentas chuecas: se borra el pago completo (decision de Roberto).
-- 2. `cobro_id` en `cobranza_abono` (null SOLO en el cobro automatico de una
--    venta de contado, que no es un pago aparte: se corrige editando la venta,
--    T-17) y en `saldo_favor_movimiento` (siempre sale de un pago).
-- 3. `rellenar_cobros_t34()` agrupa las filas que ya existen. Se queda creada:
--    la prueba pgTAP la corre sobre filas sembradas a proposito.
-- 4. `peticion`: la bandeja (Operacion -> Peticiones). Hoy un solo tipo,
--    `eliminar_cobro`; nace generica para sumar otros despues.
--
-- Ver docs/superpowers/specs/2026-10-13-t34-peticiones-borrar-cobro-design.md §4.1.

create table cobro (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  cliente_id               uuid not null references cliente(id),
  -- El cobrador: un vendedor, o null = Oficina (T-21). Una aplicacion de saldo
  -- a favor va siempre null: no entra dinero.
  vendedor_id              uuid references vendedor(id),
  -- Quien lo capturo en el portal; null = vino de la tablet.
  capturo_usuario_id       uuid references usuario(id),
  origen                   text not null,
  metodo_pago              text not null,
  -- Lo recibido (o lo aplicado), sobrante a saldo a favor incluido.
  monto                    numeric(12,2) not null,
  fecha_pago               date not null,
  fecha_operacion          date not null,
  eliminado_por_usuario_id uuid references usuario(id),
  constraint ck_cobro_origen check (origen in ('cobro', 'saldo_favor')),
  constraint ck_cobro_metodo
    check (metodo_pago in ('efectivo', 'transferencia', 'cheque', 'saldo_favor')),
  constraint ck_cobro_saldo_favor
    check ((origen = 'saldo_favor') = (metodo_pago = 'saldo_favor')),
  constraint ck_cobro_monto_positivo check (monto > 0),
  -- Quien lo borro solo en un pago borrado. Al reves no: el relleno puede
  -- encontrar filas de prueba ya borradas sin saber quien. El servicio de
  -- borrado (T-34) siempre pone los dos.
  constraint ck_cobro_borrado
    check (eliminado_por_usuario_id is null or deleted_at is not null)
);
create trigger trg_cobro_updated before update on cobro
  for each row execute function set_updated_at();
create index idx_cobro_cliente on cobro (cliente_id) where deleted_at is null;

alter table cobranza_abono add column cobro_id uuid references cobro(id);
alter table saldo_favor_movimiento add column cobro_id uuid references cobro(id);
create index idx_cobranza_abono_cobro on cobranza_abono (cobro_id);
create index idx_saldo_favor_cobro on saldo_favor_movimiento (cobro_id);

-- Un pago = las filas de cobro o de saldo a favor del mismo cliente que se
-- escribieron en la MISMA transaccion: `created_at` es now(), la hora de inicio
-- de la transaccion, identica para todas sus filas (la tablet y el portal
-- escriben cada cobro en su propia transaccion). Su movimiento de saldo a favor
-- es el del mismo cliente e instante. Solo toca filas sin `cobro_id`: volver a
-- llamarla no hace nada. Devuelve cuantos pagos creo.
create function rellenar_cobros_t34() returns integer
language plpgsql as $$
declare
  g record;
  nuevo uuid;
  creados integer := 0;
begin
  for g in
    select vn.cliente_id, ca.created_at, ca.origen, ca.vendedor_id,
           ca.capturo_usuario_id, ca.metodo_pago, ca.fecha_pago, ca.fecha_operacion,
           sum(ca.monto) as monto_filas,
           bool_and(ca.deleted_at is not null) as borrado,
           max(ca.deleted_at) as borrado_en
      from cobranza_abono ca
      join venta_nota vn on vn.id = ca.venta_nota_id
     where ca.cobro_id is null
       and ca.origen in ('cobro', 'saldo_favor')
     group by vn.cliente_id, ca.created_at, ca.origen, ca.vendedor_id,
              ca.capturo_usuario_id, ca.metodo_pago, ca.fecha_pago, ca.fecha_operacion
  loop
    insert into cobro (cliente_id, vendedor_id, capturo_usuario_id, origen, metodo_pago,
                       monto, fecha_pago, fecha_operacion, created_at, deleted_at)
    values (g.cliente_id, g.vendedor_id, g.capturo_usuario_id, g.origen, g.metodo_pago,
            g.monto_filas, g.fecha_pago, g.fecha_operacion, g.created_at,
            case when g.borrado then g.borrado_en end)
    returning id into nuevo;

    update cobranza_abono ca
       set cobro_id = nuevo
      from venta_nota vn
     where vn.id = ca.venta_nota_id
       and ca.cobro_id is null
       and vn.cliente_id = g.cliente_id
       and ca.created_at = g.created_at
       and ca.origen = g.origen
       and ca.vendedor_id is not distinct from g.vendedor_id
       and ca.capturo_usuario_id is not distinct from g.capturo_usuario_id
       and ca.metodo_pago = g.metodo_pago
       and ca.fecha_pago = g.fecha_pago
       and ca.fecha_operacion = g.fecha_operacion;

    update saldo_favor_movimiento sf
       set cobro_id = nuevo
     where sf.cobro_id is null
       and sf.cliente_id = g.cliente_id
       and sf.created_at = g.created_at
       and sf.origen = case when g.origen = 'saldo_favor'
                            then 'aplicacion' else 'excedente_cobro' end;

    -- El pago vale lo recibido: sus filas mas lo que sobro a saldo a favor.
    update cobro
       set monto = monto + coalesce((select sum(sf.monto)
                                       from saldo_favor_movimiento sf
                                      where sf.cobro_id = nuevo
                                        and sf.origen = 'excedente_cobro'), 0)
     where id = nuevo;

    creados := creados + 1;
  end loop;

  -- Un excedente sin filas en notas (todo el pago quedo a favor, T-20 D9). El
  -- movimiento no guarda metodo: se supone efectivo. Solo pasa con filas de
  -- prueba: en sinmex dev no habia cobros al migrar (2026-10-13).
  for g in
    select id, cliente_id, vendedor_id, capturo_usuario_id, monto,
           fecha_operacion, created_at, deleted_at
      from saldo_favor_movimiento
     where cobro_id is null and origen = 'excedente_cobro'
  loop
    insert into cobro (cliente_id, vendedor_id, capturo_usuario_id, origen, metodo_pago,
                       monto, fecha_pago, fecha_operacion, created_at, deleted_at)
    values (g.cliente_id, g.vendedor_id, g.capturo_usuario_id, 'cobro', 'efectivo',
            g.monto, g.fecha_operacion, g.fecha_operacion, g.created_at, g.deleted_at)
    returning id into nuevo;
    update saldo_favor_movimiento set cobro_id = nuevo where id = g.id;
    creados := creados + 1;
  end loop;

  return creados;
end;
$$;

select rellenar_cobros_t34();

-- Si algo quedo sin pago, la migracion falla ENTERA con un mensaje claro en vez
-- de que lo diga un check anonimo (o de dejar datos a medias).
do $$
begin
  if exists (select 1 from cobranza_abono
              where origen <> 'venta_contado' and cobro_id is null)
     or exists (select 1 from saldo_favor_movimiento where cobro_id is null) then
    raise exception 'T-34: quedaron cobros sin agrupar en cobranza_abono o saldo_favor_movimiento';
  end if;
end;
$$;

alter table cobranza_abono add constraint ck_cobranza_abono_cobro
  check ((origen = 'venta_contado') = (cobro_id is null));
alter table saldo_favor_movimiento alter column cobro_id set not null;

create table peticion (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  tipo                     text not null,
  status                   text not null default 'pendiente',
  cobro_id                 uuid references cobro(id),
  -- La sucursal del cliente al pedir: el filtro "Por sucursal" y el alcance.
  sucursal_id              uuid not null references sucursal(id),
  motivo                   text not null,
  solicito_usuario_id      uuid not null references usuario(id),
  resuelta_por_usuario_id  uuid references usuario(id),
  resuelta_en              timestamptz,
  comentario_resolucion    text,
  constraint ck_peticion_tipo check (tipo in ('eliminar_cobro')),
  constraint ck_peticion_status check (status in ('pendiente', 'autorizada', 'denegada')),
  constraint ck_peticion_objetivo check ((tipo = 'eliminar_cobro') = (cobro_id is not null)),
  constraint ck_peticion_motivo check (length(btrim(motivo)) between 1 and 500),
  constraint ck_peticion_resolucion check (
    (status = 'pendiente') = (resuelta_por_usuario_id is null)
    and (status = 'pendiente') = (resuelta_en is null)),
  constraint ck_peticion_comentario check (
    comentario_resolucion is null
    or (status = 'denegada' and length(comentario_resolucion) <= 500))
);
-- Sin deleted_at: una peticion no se borra, se resuelve.
create trigger trg_peticion_updated before update on peticion
  for each row execute function set_updated_at();
create unique index uq_peticion_cobro_pendiente on peticion (cobro_id)
  where status = 'pendiente';
create index idx_peticion_status_sucursal on peticion (status, sucursal_id, created_at);
