begin;
select plan(3);

-- Nombres desechables con prefijo reservado, para no chocar con ningun
-- usuario real. `perfil_id` sale de un perfil sembrado real (T-05):
-- usuario.perfil_id es NOT NULL con referencia, no hay perfil desechable
-- como el 'ZZ-pgtap-Repartidor' de la prueba de perfil.
insert into usuario (login, password_hash, nombre, perfil_id)
  select 'zz-pgtap-jgarcia', 'x', 'Prueba', id
  from perfil where nombre = 'Auxiliar Administrativo';

select throws_ok(
  $$insert into usuario (login, password_hash, nombre, perfil_id)
    select 'zz-pgtap-jgarcia', 'x', 'Prueba 2', id
    from perfil where nombre = 'Auxiliar Administrativo'$$,
  '23505',
  null,
  'rechaza el mismo login repetido entre usuarios activos'
);

-- 'lower()' en el indice: dos filas que solo difieren en mayusculas son el
-- mismo login.
select throws_ok(
  $$insert into usuario (login, password_hash, nombre, perfil_id)
    select 'ZZ-PGTAP-JGARCIA', 'x', 'Prueba 3', id
    from perfil where nombre = 'Auxiliar Administrativo'$$,
  '23505',
  null,
  'trata distinta capitalizacion como duplicado'
);

-- La baja es logica (DELETE /usuarios/:id pone deleted_at, no borra la
-- fila). Sin el filtro 'where deleted_at is null' del indice, esto seguiria
-- lanzando 23505 y el login quedaria reservado para siempre.
update usuario set deleted_at = now() where login = 'zz-pgtap-jgarcia';

select lives_ok(
  $$insert into usuario (login, password_hash, nombre, perfil_id)
    select 'zz-pgtap-jgarcia', 'x', 'Prueba 4', id
    from perfil where nombre = 'Auxiliar Administrativo'$$,
  'dar de baja un usuario libera su login para uno nuevo'
);

select * from finish();
rollback;
