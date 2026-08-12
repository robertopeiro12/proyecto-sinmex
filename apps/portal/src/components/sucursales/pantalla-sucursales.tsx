"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import { FormularioSucursal } from "./formulario-sucursal";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";

export function PantallaSucursales({ sucursal }: { sucursal: string | null }) {
  return (
    <PantallaCatalogo<Sucursal>
      titulo="Sucursales"
      permiso="sucursal.gestionar"
      etiquetaAlta="Nueva sucursal"
      vacio="No hay sucursales que mostrar."
      mensajeError="No se pudieron cargar las sucursales."
      cargar={() => listarSucursales(sucursal)}
      // Sucursales SI depende del selector global; Productos no lo usara (D4).
      deps={[sucursal]}
      columnas={[
        { encabezado: "Código", celda: (s) => s.codigo, className: "font-mono" },
        { encabezado: "Nombre", celda: (s) => s.nombre },
        {
          encabezado: "Estado",
          celda: (s) =>
            s.activa ? (
              "Activa"
            ) : (
              <span className="text-muted-foreground">Inactiva</span>
            ),
        },
      ]}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioSucursal
          sucursal={item}
          alGuardar={alGuardar}
          alCancelar={alCancelar}
        />
      )}
    />
  );
}
