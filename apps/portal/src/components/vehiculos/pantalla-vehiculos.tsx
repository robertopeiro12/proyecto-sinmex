"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import { FormularioVehiculo } from "./formulario-vehiculo";
import { listarVehiculos, type Vehiculo } from "@/lib/vehiculos";

export function PantallaVehiculos({ sucursal }: { sucursal: string | null }) {
  return (
    <PantallaCatalogo<Vehiculo>
      titulo="Vehículos"
      permiso="vehiculo.gestionar"
      etiquetaAlta="Nuevo vehículo"
      vacio="No hay vehículos que mostrar."
      mensajeError="No se pudieron cargar los vehículos."
      cargar={() => listarVehiculos(sucursal)}
      // Vehiculos SI depende del selector global, como Sucursales y a diferencia
      // de Productos: un vehiculo pertenece fisicamente a una sucursal (D2).
      deps={[sucursal]}
      columnas={[
        { encabezado: "Nombre", celda: (v) => v.nombre },
        {
          encabezado: "Sucursal",
          celda: (v) => v.sucursalCodigo,
          className: "font-mono",
        },
        {
          encabezado: "Km al alta",
          // `toLocaleString` para que 145230.5 se lea "145,230.5" y no se
          // confunda con otro numero de un vistazo.
          celda: (v) => v.kmInicial?.toLocaleString("es-MX") ?? "—",
        },
        {
          encabezado: "Estado",
          celda: (v) =>
            v.activo ? (
              "Activo"
            ) : (
              <span className="text-muted-foreground">Inactivo</span>
            ),
        },
      ]}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioVehiculo
          vehiculo={item}
          alGuardar={alGuardar}
          alCancelar={alCancelar}
        />
      )}
    />
  );
}
