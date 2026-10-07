"use client";

import type { Permiso } from "@/lib/usuarios";

/**
 * Explicación en lenguaje llano para quien no conoce la clave técnica
 * (ej. un dueño de negocio viendo el portal, no un desarrollador).
 * Puramente visual -- no cambia lo que el permiso hace, solo cómo se explica.
 * Si aparece una clave nueva que no está aquí, se usa `descripcion` sola.
 */
const EXPLICACION_PERMISO: Record<string, string> = {
  "perfil.gestionar":
    "Puede crear perfiles nuevos y decidir qué permisos tiene cada uno. Es el control de acceso de todo el portal.",
  "precio.gestionar":
    "Puede cambiar los precios de cada producto, por lista y por sucursal, en la matriz de precios.",
  "producto.gestionar":
    "Puede agregar, editar o dar de baja los productos del catálogo (los sabores y sus presentaciones).",
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
    "Puede aprobar o rechazar solicitudes para eliminar una venta o un cobro ya registrado.",
  "promocion.gestionar":
    "Puede registrar promociones (como 10+1) y el consumo interno de producto.",
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
    "Puede registrar entradas y salidas de mercancía en el almacén general (planta).",
  "almacen_sucursal.gestionar":
    "Puede registrar entradas y salidas de mercancía en el almacén de una sucursal.",
  "carga.gestionar": "Puede registrar qué mercancía sale cargada en cada vehículo.",
  "inventario.ver": "Puede consultar cuánto inventario hay disponible.",
  "retorno.gestionar":
    "Puede registrar la mercancía que regresa sin vender al final del día.",
  "analisis_cliente.ver":
    "Puede consultar el análisis e historial de compra de un cliente.",
  "reportes.ver": "Puede consultar los reportes generales del negocio.",
};

interface Props {
  /** Ya viene ordenado por grupo desde el backend (PerfilesRepository.catalogoPermisos, T-08b). */
  catalogo: Permiso[];
  marcados: Set<string>;
  onCambiar: (clave: string, marcado: boolean) => void;
  /** D4: perfil maestro elegido -- todo aparece marcado y sin poder tocarse. */
  disabled: boolean;
}

/**
 * D3 del spec: cada checkbox nace precargado con lo que da el perfil
 * elegido (el padre inicializa `marcados` así) y el administrador lo
 * cambia como cualquier checkbox normal -- sin un tercer estado "Hereda"
 * visible (decisión explícita de Roberto: un tercer estado confundiría).
 *
 * Etiqueta = clave (compacta -- unas ~25 filas en una lista dentro de un
 * formulario no tienen el espacio de columnas que sí tiene la tabla de
 * Perfiles y Permisos, T-08b) + ícono (i) con `descripcion` en el atributo
 * `title` nativo del navegador (D9): sin dependencia nueva de tooltip.
 */
export function MatrizPermisosUsuario({ catalogo, marcados, onCambiar, disabled }: Props) {
  // Set preserva el orden de insercion: como `catalogo` ya viene agrupado
  // por `grupo` desde el backend, esto no reordena nada, solo enumera los
  // grupos una vez cada uno.
  const grupos = [...new Set(catalogo.map((p) => p.grupo))];

  return (
    <div className="flex flex-col gap-4">
      {grupos.map((grupo) => (
        <div key={grupo}>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{grupo}</p>
          <div className="flex flex-col gap-1">
            {catalogo
              .filter((p) => p.grupo === grupo)
              .map((permiso) => (
                <label key={permiso.id} className="flex items-start gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={disabled ? true : marcados.has(permiso.clave)}
                    onChange={(e) => onCambiar(permiso.clave, e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col">
                    <span>{permiso.descripcion || permiso.clave}</span>
                    {EXPLICACION_PERMISO[permiso.clave] && (
                      <span className="text-xs text-muted-foreground">
                        {EXPLICACION_PERMISO[permiso.clave]}
                      </span>
                    )}
                  </span>
                </label>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
