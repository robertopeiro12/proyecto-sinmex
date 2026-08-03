insert into sucursal (codigo, nombre) values
  ('TJ', 'Tijuana'),
  ('MX', 'Mexicali')
on conflict (codigo) do nothing;

insert into lista_precio (nombre) values
  ('Lista 1'), ('Lista 2'), ('Lista 3'), ('Lista 4'), ('Especial')
on conflict (nombre) do nothing;

insert into perfil (nombre) values
  ('Administrador General'),
  ('Administrador'),
  ('Jefe de Ventas'),
  ('Jefe de producción'),
  ('Almacenista'),
  ('Auxiliar Administrativo')
on conflict (nombre) do nothing;

insert into permiso (clave, grupo, descripcion) values
  ('reporte_ventas.ver',        'General',              'Ver Reporte de Ventas'),
  ('producto.gestionar',        'General',              'Registrar/editar/eliminar productos'),
  ('peticiones.gestionar',      'Operacion Comercial',  'Autorizar/denegar eliminación de ventas y cobranzas'),
  ('venta.registrar',           'Operacion Comercial',  'Registrar venta'),
  ('venta.editar_eliminar',     'Operacion Comercial',  'Editar y eliminar venta'),
  ('cobranza.registrar',        'Operacion Comercial',  'Registrar cobranza/abono'),
  ('cobranza.editar_eliminar',  'Operacion Comercial',  'Editar y eliminar cobranza'),
  ('merma.gestionar',           'Operacion Comercial',  'Registrar/editar/eliminar merma'),
  ('promocion.gestionar',       'Operacion Comercial',  'Registrar/editar/eliminar promoción y consumo'),
  ('ruta_diaria.gestionar',     'Operacion Comercial',  'Ruta Diaria'),
  ('ruta_semanal.gestionar',    'Operacion Comercial',  'Ruta Semanal'),
  ('cliente.gestionar',         'Operacion Comercial',  'Registrar/editar/eliminar clientes'),
  ('prospecto.gestionar',       'Operacion Comercial',  'Registrar/editar/eliminar prospectos'),
  ('vendedor.gestionar',        'Operacion Comercial',  'Registrar/editar/eliminar vendedores'),
  ('vehiculo.gestionar',        'Operacion Comercial',  'Registrar/editar/eliminar vehículos'),
  ('carga.gestionar',           'Produccion/Almacen',   'Registrar/editar/eliminar carga'),
  ('retorno.gestionar',         'Produccion/Almacen',   'Registrar/editar retorno de mercancía'),
  ('inventario.ver',            'Produccion/Almacen',   'Información de inventario'),
  ('almacen_general.gestionar', 'Produccion/Almacen',   'Entradas/salidas del Almacén General'),
  ('almacen_sucursal.gestionar','Produccion/Almacen',   'Entradas/salidas del Almacén de Sucursal'),
  ('reportes.ver',              'Informacion',          'Acceso a reportes'),
  ('analisis_cliente.ver',      'Informacion',          'Análisis de Cliente')
on conflict (clave) do nothing;
