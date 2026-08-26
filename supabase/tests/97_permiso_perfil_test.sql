begin;
select plan(1);

select is(
  (select grupo from permiso where clave = 'perfil.gestionar' and deleted_at is null),
  'General',
  'perfil.gestionar existe y vive en el grupo General'
);

select * from finish();
rollback;
