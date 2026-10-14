begin;
select plan(6);

select has_column('cliente', 'alta_cliente_en', 'cliente tiene alta_cliente_en (T-51)');
select has_column('cliente', 'alta_cliente_usuario_id', 'cliente tiene alta_cliente_usuario_id (T-51)');
select col_is_null('cliente', 'alta_cliente_en', 'alta_cliente_en es nulable (clientes viejos y prospectos)');

-- Datos minimos para probar el check y la FK.
insert into usuario (id, login, nombre, password_hash, perfil_id)
values ('00000000-0000-0000-0000-0000000000a1', 'pgtap-alta', 'pgtap alta', 'x',
        (select id from perfil where nombre = 'Administrador General'));
insert into cliente (id, nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id, encargado)
values ('00000000-0000-0000-0000-0000000000c1', 'pgtap cliente', 'Calle', '000', 'cliente',
        (select id from lista_precio where nombre = 'Lista 1'),
        (select id from sucursal where codigo = 'TJ'), 'Enc');

select throws_ok(
  $$update cliente set alta_cliente_usuario_id = '00000000-0000-0000-0000-0000000000a1'
     where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', null,
  'usuario de alta sin fecha de alta se rechaza (ck_cliente_alta_usuario_con_fecha)'
);

update cliente set alta_cliente_en = now(), alta_cliente_usuario_id = '00000000-0000-0000-0000-0000000000a1'
 where id = '00000000-0000-0000-0000-0000000000c1';
delete from usuario where id = '00000000-0000-0000-0000-0000000000a1';

select is(
  (select alta_cliente_usuario_id from cliente where id = '00000000-0000-0000-0000-0000000000c1'),
  null,
  'borrar al usuario deja el cliente sin usuario de alta (on delete set null)'
);
select isnt(
  (select alta_cliente_en from cliente where id = '00000000-0000-0000-0000-0000000000c1'),
  null,
  'la fecha de alta se conserva'
);

select * from finish();
rollback;
