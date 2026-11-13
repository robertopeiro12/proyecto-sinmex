-- Corte de mercancia (Produccion -> Corte): el almacenista cuenta lo que regresa
-- el vendedor, buenas y merma, y el portal lo compara contra lo que deberia
-- regresar (cargadas - vendidas - regaladas). Absorbe a Retorno.
-- Spec: docs/superpowers/specs/2026-11-12-corte-de-mercancia-design.md
--
-- PRE-FLIGHT contra la nube (solo lectura, antes del push):
--   * El check nuevo de `retorno` exige piezas >= 0, merma >= 0 y que sumen > 0.
--     Las filas viejas solo tienen buenas (> 0 por el check anterior) y la merma
--     nace en 0. Debe dar 0:
--       select count(*) from retorno where piezas <= 0;
--   * `corte_mercancia` es nueva. El relleno crea un encabezado por cada
--     (fecha, vendedor) con filas vivas en `retorno`; para el comentario del PR:
--       select count(distinct (fecha, vendedor_id)) from retorno where deleted_at is null;
--
-- * `retorno.piezas_merma`: la merma contada de esa presentacion. Una fila guarda
--   buenas y merma; ambas en 0 = sin fila (baja logica, como antes).
-- * `corte_mercancia`: el encabezado del corte de un vendedor y un dia. Existe
--   para distinguir "no se ha hecho el corte" de "se hizo y regreso 0 piezas"
--   (un vendedor que vendio todo no deja filas en `retorno`). Uno vivo por
--   vendedor y fecha; se crea al primer guardado y se actualiza en los demas.
--   `sucursal_id` es la del vendedor (la pone el servicio).
-- * El permiso `retorno.gestionar` ya existe; solo cambia su descripcion. No se
--   tocan perfiles (los asigna el cliente).

alter table retorno add column piezas_merma integer not null default 0;

alter table retorno drop constraint retorno_piezas_check;
alter table retorno add constraint ck_retorno_piezas
  check (piezas >= 0 and piezas_merma >= 0 and piezas::bigint + piezas_merma > 0);

create table corte_mercancia (
  id                         uuid primary key default gen_random_uuid(),
  fecha                      date not null,
  vendedor_id                uuid not null references vendedor(id),
  sucursal_id                uuid not null references sucursal(id),
  hecho_por_usuario_id       uuid not null references usuario(id),
  hecho_en                   timestamptz not null default now(),
  actualizado_por_usuario_id uuid references usuario(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz
);

-- Un corte vivo por vendedor y dia. Parcial, como todo lo de baja logica.
create unique index uq_corte_mercancia_fecha_vendedor
  on corte_mercancia (fecha, vendedor_id) where deleted_at is null;
-- La lista del dia lee por sucursal y fecha.
create index idx_corte_mercancia_sucursal_fecha
  on corte_mercancia (sucursal_id, fecha);

create trigger trg_corte_mercancia_updated before update on corte_mercancia
  for each row execute function set_updated_at();

-- Relleno: lo ya capturado en Retorno cuenta como corte hecho. Quien lo hizo y
-- cuando salen de la fila viva mas antigua de ese vendedor y dia. El `not
-- exists` lo hace repetible: la prueba e2e (cortes.e2e-spec.ts) corre esta misma
-- sentencia, leida de este archivo entre las marcas.
-- relleno:inicio
insert into corte_mercancia (fecha, vendedor_id, sucursal_id, hecho_por_usuario_id, hecho_en)
select distinct on (r.fecha, r.vendedor_id)
       r.fecha, r.vendedor_id, r.sucursal_id, r.capturo_usuario_id, r.created_at
  from retorno r
 where r.deleted_at is null
   and not exists (
     select 1 from corte_mercancia cm
      where cm.fecha = r.fecha and cm.vendedor_id = r.vendedor_id
        and cm.deleted_at is null)
 order by r.fecha, r.vendedor_id, r.created_at, r.id;
-- relleno:fin

update permiso
   set descripcion = 'Corte de mercancía: capturar lo que regresa el vendedor'
 where clave = 'retorno.gestionar';
