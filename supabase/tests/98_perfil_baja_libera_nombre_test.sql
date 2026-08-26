begin;
select plan(3);

-- Nombres desechables con prefijo reservado, para no chocar con los 6
-- perfiles sembrados ni con nada mas que pueda existir en la base.
insert into perfil (nombre) values ('ZZ-pgtap-Repartidor');

select throws_ok(
  $$insert into perfil (nombre) values ('ZZ-pgtap-Repartidor')$$,
  '23505',
  null,
  'rechaza el mismo nombre repetido entre perfiles activos'
);

-- 'lower()' en el indice: dos filas que solo difieren en mayusculas son el
-- mismo perfil.
select throws_ok(
  $$insert into perfil (nombre) values ('ZZ-PGTAP-REPARTIDOR')$$,
  '23505',
  null,
  'trata distinta capitalizacion como duplicado'
);

-- La baja es logica (DELETE /perfiles/:id pone deleted_at, no borra la
-- fila). Sin el filtro 'where deleted_at is null' del indice, esto seguiria
-- lanzando 23505 y el nombre quedaria reservado para siempre.
update perfil set deleted_at = now() where nombre = 'ZZ-pgtap-Repartidor';

select lives_ok(
  $$insert into perfil (nombre) values ('ZZ-pgtap-Repartidor')$$,
  'dar de baja un perfil libera su nombre para un perfil nuevo'
);

select * from finish();
rollback;
