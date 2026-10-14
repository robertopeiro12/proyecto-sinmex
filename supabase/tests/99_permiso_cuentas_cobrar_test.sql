begin;
select plan(2);

select is(
  (select grupo from permiso where clave = 'cuentas_cobrar.ver' and deleted_at is null),
  'Operacion Comercial',
  'existe el permiso cuentas_cobrar.ver (T-22)'
);

select is(
  (select descripcion from permiso where clave = 'cuentas_cobrar.ver'),
  'Ver Cuentas por Cobrar',
  'cuentas_cobrar.ver lleva su descripcion'
);

select * from finish();
rollback;
