begin;
select plan(18);

-- T-38: la jornada cerrada que sube la tablet. Lo que la BASE garantiza aunque
-- alguien escriba por debajo del servicio. Prefijo `zz-pgtap-t38`.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t38', 'Vendedor pgTAP T-38', 'x', id
    from sucursal where codigo = 'TJ';
insert into vehiculo (nombre, sucursal_id, km_inicial)
  select 'ZZ-pgtap-T38 Camioneta', id, 1000
    from sucursal where codigo = 'TJ';

create temporary table _t38 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t38') as vendedor,
  (select id from vehiculo where nombre = 'ZZ-pgtap-T38 Camioneta') as vehiculo,
  (select id from sucursal where codigo = 'TJ') as sucursal;

select has_table('jornada');
select hasnt_column('jornada', 'sync_operacion_id',
  'sin sync_operacion_id: la trazabilidad va por entidad_tabla/entidad_id (ADR-0009 §2.4)');
select fk_ok('jornada', 'vendedor_id', 'vendedor', 'id',
  'la jornada es de un vendedor');
select fk_ok('jornada', 'vehiculo_id', 'vehiculo', 'id',
  'con el vehiculo que eligio al abrir el dia');
select fk_ok('jornada', 'sucursal_id', 'sucursal', 'id',
  'en la sucursal del vendedor (la usa el reporte de Kilometraje)');
select col_type_is('jornada', 'km_inicial', 'numeric(10,1)',
  'el odometro marca decimas');
select col_type_is('jornada', 'km_final', 'numeric(10,1)',
  'el km final tambien');
select col_not_null('jornada', 'km_final',
  'solo jornadas CERRADAS: el km final es obligatorio');
select col_not_null('jornada', 'cerrada_en',
  'solo jornadas CERRADAS: el cierre es obligatorio');
select has_trigger('jornada', 'trg_jornada_updated');
select has_index('jornada', 'uq_jornada_vendedor_fecha',
  'una jornada viva por vendedor y dia, espejo del SQLite de la tablet');
select has_index('jornada', 'idx_jornada_sucursal_fecha',
  'el reporte de Kilometraje busca por sucursal y rango de fechas');

select lives_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-10', 128450, 128512,
           '2026-10-10T08:03:53-07:00', '2026-10-10T18:19:55-07:00'
      from _t38$$,
  'una jornada cerrada entra'
);

select throws_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-10', 128600, 128700,
           '2026-10-10T08:00:00-07:00', '2026-10-10T18:00:00-07:00'
      from _t38$$,
  '23505', null,
  'una segunda jornada viva del mismo vendedor el mismo dia no entra'
);

select throws_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-11', 128512, 128500,
           '2026-10-11T08:00:00-07:00', '2026-10-11T18:00:00-07:00'
      from _t38$$,
  '23514', null,
  'el odometro no retrocede: km_final menor a km_inicial no entra'
);

select throws_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-12', -1, 0,
           '2026-10-12T08:00:00-07:00', '2026-10-12T18:00:00-07:00'
      from _t38$$,
  '23514', null,
  'un km inicial negativo no entra'
);

-- Baja logica de la primera: el indice es parcial, asi que el dia se libera.
update jornada set deleted_at = now()
 where vendedor_id = (select vendedor from _t38) and fecha = '2026-10-10';

select lives_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-10', 128450, 128512,
           '2026-10-10T08:03:53-07:00', '2026-10-10T18:19:55-07:00'
      from _t38$$,
  'dar de baja una jornada libera su dia'
);

select lives_ok(
  $$insert into jornada (vendedor_id, vehiculo_id, sucursal_id, fecha,
                         km_inicial, km_final, abierta_en, cerrada_en)
    select vendedor, vehiculo, sucursal, '2026-10-11', 128512, 128512,
           '2026-10-11T08:00:00-07:00', '2026-10-11T18:00:00-07:00'
      from _t38$$,
  'un dia sin moverse: km final igual al inicial entra'
);

select * from finish();
rollback;
