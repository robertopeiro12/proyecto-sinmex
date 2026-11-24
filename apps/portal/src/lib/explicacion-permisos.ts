/**
 * Explicación en lenguaje llano para quien no conoce la clave técnica
 * (ej. un dueño de negocio viendo el portal, no un desarrollador).
 * Puramente visual -- no cambia lo que el permiso hace, solo cómo se explica.
 * La leen Usuarios (debajo de cada permiso) y Perfiles y Permisos (en el ⓘ).
 * Si aparece una clave nueva que no está aquí, se muestra sin explicación.
 */
export const EXPLICACION_PERMISO: Record<string, string> = {
  "perfil.gestionar":
    "Puede crear perfiles nuevos y decidir qué permisos tiene cada uno. Es el control de acceso de todo el portal.",
  "precio.gestionar":
    "Puede cambiar los precios de cada producto, por lista y por sucursal, en la matriz de precios.",
  "producto.gestionar":
    "Puede agregar, editar o dar de baja los productos del catálogo (los sabores y sus presentaciones).",
  "dashboard.ver":
    "Puede ver el Dashboard: lo que llevan hoy los vendedores en ruta.",
  "nota_papel.revisar":
    "Puede marcar en el Dashboard si el vendedor entregó la nota de papel de cada venta a crédito.",
  "reporte_ventas.ver": "Puede consultar el reporte de ventas de la empresa.",
  "sucursal.gestionar":
    "Puede dar de alta o editar las sucursales (Tijuana, Mexicali, etc.).",
  "usuario.gestionar":
    "Puede crear, editar o dar de baja las cuentas de quienes usan el Portal Web.",
  "cliente.gestionar": "Puede dar de alta, editar o dar de baja clientes.",
  "cobranza.editar_eliminar": "Puede corregir o eliminar un cobro ya registrado.",
  "cobranza.registrar": "Puede registrar cuando un cliente paga o abona.",
  "merma.gestionar": "Puede registrar producto dañado o perdido (merma).",
  "peticiones.gestionar":
    "Puede aprobar o rechazar solicitudes para eliminar una venta o un cobro ya registrado, y autorizar o rechazar los retiros de merma.",
  "motivo_visita.gestionar":
    "Puede dar de alta, editar o dar de baja los motivos por los que un cliente no compró (visita sin venta).",
  "campo_egreso.gestionar":
    "Puede dar de alta, editar o dar de baja los campos de egreso (gasolina, hielo, envases…) y decidir cuáles usa el vendedor en la tablet.",
  "gasto.ver": "Puede consultar los gastos que registran los vendedores en la ruta, con su ticket.",
  "promocion.gestionar":
    "Puede crear, editar y desactivar las promociones (regalos por compra) para clientes, para todos o para prospectos.",
  "prospecto.gestionar":
    "Puede dar de alta o editar clientes potenciales (prospectos) antes de que se conviertan en clientes.",
  "ruta_diaria.gestionar":
    "Puede ver y gestionar la ruta diaria de reparto/venta de los vendedores.",
  "ruta_semanal.gestionar": "Puede ver y gestionar la ruta semanal de reparto/venta.",
  "vehiculo.gestionar":
    "Puede dar de alta, editar o dar de baja los vehículos de reparto.",
  "vendedor.gestionar":
    "Puede dar de alta, editar o dar de baja a los vendedores/repartidores y sus credenciales de la app.",
  "venta.editar_eliminar": "Puede corregir o eliminar una venta ya registrada.",
  "venta.asignar_factura":
    "Puede anotar el número de factura del SAT en las ventas, corregirlo o quitarlo.",
  "venta.registrar": "Puede registrar una venta nueva.",
  "almacen_general.gestionar":
    "Sin uso por ahora: las entradas pasaron a Producción → Registro de Operación (permiso Entradas/Compras).",
  "operacion.entrada":
    "Abre la pestaña Entradas/Compras del Registro de Operación: puede ver, registrar, corregir y eliminar lo que entra al almacén (producción o compras).",
  "operacion.envio":
    "Abre la pestaña Envíos del Registro de Operación: puede registrar, corregir y eliminar envíos de mercancía a otra sucursal (solo de hoy o ayer).",
  "operacion.merma":
    "Abre la pestaña Merma del Registro de Operación: puede registrar, corregir y eliminar la merma del almacén, con su motivo.",
  "operacion.consumo":
    "Abre la pestaña Consumo del Registro de Operación: puede registrar, corregir y eliminar el producto que se consumió.",
  "operacion.descuento":
    "Abre la pestaña Descuentos del Registro de Operación: puede registrar, corregir y eliminar el producto que se descuenta a un trabajador.",
  "operacion.retiro_merma":
    "Registro de Operación: Retiro de merma — pedir, corregir y eliminar retiros de merma; los autoriza quien gestiona Peticiones.",
  "motivo_merma.gestionar":
    "Puede dar de alta, editar o dar de baja los motivos de merma del catálogo.",
  "almacen_sucursal.gestionar":
    "Puede registrar entradas y salidas de mercancía en el almacén de una sucursal.",
  "carga.gestionar": "Puede registrar qué mercancía sale cargada en cada vehículo.",
  "inventario.ver": "Puede consultar cuánto inventario hay disponible.",
  "retorno.gestionar":
    "Puede hacer el corte de mercancía: contar lo que regresa cada vendedor (buenas y merma) y ver el faltante.",
  "analisis_cliente.ver":
    "Puede consultar el análisis e historial de compra de un cliente.",
  "reportes.ver": "Puede consultar los reportes generales del negocio.",
  "cuentas_cobrar.ver":
    "Puede ver cuánto debe cada cliente, con sus notas pendientes y vencidas (no puede cobrar).",
};
