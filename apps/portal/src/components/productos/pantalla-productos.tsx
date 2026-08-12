"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import { FormularioProducto } from "./formulario-producto";
import { listarProductos, type Producto } from "@/lib/productos";

export function PantallaProductos() {
  return (
    <PantallaCatalogo<Producto>
      titulo="Productos"
      permiso="producto.gestionar"
      etiquetaAlta="Nuevo producto"
      vacio="No hay productos que mostrar."
      mensajeError="No se pudieron cargar los productos."
      cargar={listarProductos}
      columnas={[
        { encabezado: "Nombre del producto", celda: (p) => p.nombre },
        {
          encabezado: "Presentaciones",
          celda: (p) => p.presentaciones.map((x) => x.volumen).join(", "),
        },
        {
          encabezado: "Estado",
          celda: (p) =>
            p.activo ? (
              "Activo"
            ) : (
              <span className="text-muted-foreground">Inactivo</span>
            ),
        },
      ]}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioProducto
          producto={item}
          alGuardar={alGuardar}
          alCancelar={alCancelar}
        />
      )}
    />
  );
}
