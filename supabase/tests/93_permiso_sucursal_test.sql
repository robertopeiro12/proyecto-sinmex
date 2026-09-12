begin;
select plan(2);

select is(
  (select grupo from permiso where clave = 'sucursal.gestionar' and deleted_at is null),
  'General',
  'sucursal.gestionar existe y vive en el grupo General'
);

-- T-05 sembro 22 permisos desde el documento del cliente; T-08a agrego 23o
-- (sucursal.gestionar); T-18 agrego 24o (precio.gestionar); T-08b agrega 25o
-- (perfil.gestionar); T-13 agrega 26o (usuario.gestionar).
select is(
  (select count(*)::int from permiso where deleted_at is null),
  26,
  'el catalogo de permisos tiene 26 claves'
);

select * from finish();
rollback;
