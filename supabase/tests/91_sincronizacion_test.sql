begin;
select plan(12);

select has_table('sync_operacion');
select col_is_pk('sync_operacion', 'id');
select fk_ok('sync_operacion', 'vendedor_id', 'vendedor', 'id');
select fk_ok('sync_operacion', 'sucursal_id', 'sucursal', 'id');
select has_trigger('sync_operacion', 'trg_sync_operacion_updated');
select has_index('sync_operacion', 'idx_sync_operacion_vendedor_fecha');

-- El corazon del ticket: reenviar el mismo lote no puede duplicar operaciones.
-- La regla esta en la base y no solo en el servicio, porque entre un SELECT de
-- comprobacion y su INSERT cabe el segundo reintento del mismo lote.
select col_is_unique('sync_operacion', array['vendedor_id', 'clave_idempotencia'],
  'la clave de idempotencia es unica POR VENDEDOR');

select col_is_null('sync_operacion', 'entidad_id',
  'entidad_id es null hasta que el modulo de negocio proyecte la operacion');

-- La fecha del dia de trabajo se guarda aparte del instante. Si alguien las
-- fusionara en un solo timestamptz, el dia del vendedor pasaria a derivarse de
-- UTC y una jornada de Tijuana quedaria partida en dos dias.
select col_type_is('sync_operacion', 'fecha_operacion', 'date',
  'fecha_operacion es una fecha, no un timestamp');
select col_type_is('sync_operacion', 'ocurrido_en', 'timestamp with time zone',
  'ocurrido_en conserva la zona horaria');

select col_not_null('sync_operacion', 'datos',
  'el cuerpo de la operacion siempre viaja, aunque nadie lo interprete todavia');
select col_type_is('sync_operacion', 'datos', 'jsonb',
  'los datos se guardan sin interpretar: el modulo de negocio llega despues');

select * from finish();
rollback;
