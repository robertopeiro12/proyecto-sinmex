begin;
select plan(8);

select has_table('sesion_refresh');
select col_is_pk('sesion_refresh', 'id');
select fk_ok('sesion_refresh', 'usuario_id', 'usuario', 'id');
select col_is_unique('sesion_refresh', 'token_hash');
select col_is_null('sesion_refresh', 'revocada_en', 'revocada_en es null mientras la sesion vive');
select col_is_null('sesion_refresh', 'reemplazada_por', 'reemplazada_por es null hasta que rota');
select has_index('sesion_refresh', 'idx_sesion_refresh_usuario');
select has_trigger('sesion_refresh', 'trg_sesion_refresh_updated');

select * from finish();
rollback;
