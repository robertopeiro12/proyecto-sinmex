begin;
select plan(10);

select has_table('sesion_vendedor');
select col_is_pk('sesion_vendedor', 'id');
select fk_ok('sesion_vendedor', 'vendedor_id', 'vendedor', 'id');
select col_is_unique('sesion_vendedor', 'token_hash');
select col_is_null('sesion_vendedor', 'revocada_en', 'revocada_en es null mientras la sesion vive');
select col_is_null('sesion_vendedor', 'reemplazada_por', 'reemplazada_por es null hasta que rota');
select has_index('sesion_vendedor', 'idx_sesion_vendedor_vendedor');
select has_trigger('sesion_vendedor', 'trg_sesion_vendedor_updated');

-- La sesion de la app NO puede colgar de un usuario del portal ni al reves.
-- Es la misma separacion que hay en el JWT (`tipo: 'usuario'` vs
-- `tipo: 'vendedor'`), pero comprobada en la base: si algun dia alguien
-- fusionara las dos tablas "para simplificar", esto lo detiene.
select hasnt_column('sesion_vendedor', 'usuario_id',
  'sesion_vendedor no referencia usuarios del portal');
select hasnt_column('sesion_refresh', 'vendedor_id',
  'sesion_refresh (portal) no referencia vendedores');

select * from finish();
rollback;
