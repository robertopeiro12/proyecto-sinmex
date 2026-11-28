begin;
select plan(1);

-- Información de Producción: el permiso de la pantalla existe en el grupo correcto.
select is(
  (select grupo from permiso where clave = 'informacion_produccion.ver' and deleted_at is null),
  'Produccion/Almacen', 'existe informacion_produccion.ver en Produccion/Almacen');

select * from finish();
rollback;
