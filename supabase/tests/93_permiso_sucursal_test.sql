begin;
select plan(2);

select is(
  (select grupo from permiso where clave = 'sucursal.gestionar' and deleted_at is null),
  'General',
  'sucursal.gestionar existe y vive en el grupo General'
);

-- T-05 sembro 22 permisos desde el documento del cliente; este es el 23o y el
-- unico que NO sale de ahi (el cliente nunca menciono administrar sucursales).
select is(
  (select count(*)::int from permiso where deleted_at is null),
  23,
  'el catalogo de permisos tiene 23 claves'
);

select * from finish();
rollback;
