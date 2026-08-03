begin;
select plan(9);

select has_table('sucursal');
select has_table('perfil');
select has_table('permiso');
select has_table('perfil_permiso');
select has_table('usuario');
select has_table('usuario_permiso');
select has_table('vendedor');

-- usuario.sucursal_id es nullable (null = General)
select col_is_null('usuario', 'sucursal_id', 'usuario.sucursal_id permite null (General)');

-- perfil_permiso no permite duplicados (perfil, permiso)
select has_index('perfil_permiso', 'perfil_permiso_perfil_id_permiso_id_key');

select * from finish();
rollback;
