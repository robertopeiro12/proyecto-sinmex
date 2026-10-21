"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import { FormularioVendedor } from "./formulario-vendedor";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";

export function PantallaVendedores({ sucursal }: { sucursal: string | null }) {
  return (
    <PantallaCatalogo<Vendedor>
      titulo="Vendedores"
      descripcion="Quién usa la app de la tablet, en qué sucursal y con qué contraseña."
      permiso="vendedor.gestionar"
      etiquetaAlta="Nuevo vendedor"
      tituloFormulario={(v) => (v ? `Editar ${v.nombre}` : "Nuevo vendedor")}
      vacio="No hay vendedores que mostrar."
      mensajeError="No se pudieron cargar los vendedores."
      cargar={() => listarVendedores(sucursal)}
      // Igual que Vehiculos (D2): un vendedor pertenece a una sucursal, asi
      // que el selector global SI filtra.
      deps={[sucursal]}
      columnas={[
        { encabezado: "Nombre", celda: (v) => v.nombre },
        { encabezado: "Login", celda: (v) => v.login, className: "font-mono" },
        {
          encabezado: "Sucursal",
          celda: (v) => v.sucursalCodigo,
          className: "font-mono",
        },
        {
          encabezado: "Segmento",
          celda: (v) => v.folioSegmento ?? "—",
          className: "font-mono",
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
        <FormularioVendedor
          vendedor={item}
          alGuardar={alGuardar}
          alCancelar={alCancelar}
        />
      )}
    />
  );
}
