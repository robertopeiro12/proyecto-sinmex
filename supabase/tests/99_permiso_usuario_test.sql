begin;
select plan(1);

select is(
  (select grupo from permiso where clave = 'usuario.gestionar' and deleted_at is null),
  'General',
  'usuario.gestionar existe y vive en el grupo General'
);

select * from finish();
rollback;
