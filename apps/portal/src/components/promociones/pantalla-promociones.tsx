"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { useAuth } from "@/components/auth/auth-provider";
import { FormularioPromocion } from "./formulario-promocion";
import { listarPromociones, type Promocion } from "@/lib/promociones";

export function PantallaPromociones({ sucursal }: { sucursal: string | null }) {
  const { usuario, cargando } = useAuth();

  // Un General sin sucursal en el selector: la API contestaría 400. Se avisa aquí, sin llamarla,
  // porque useCatalogo solo sabe decir "no se pudieron cargar" y eso no explicaría nada.
  if (cargando || usuario === null || (usuario.sucursal === null && !sucursal)) {
    // El selector de sucursal ya no está arriba: vive en el menú lateral (UI Etapa 1).
    return <EstadoPantalla titulo="Promociones" tipo={cargando || usuario === null ? "cargando" : "elige-sucursal"} />;
  }

  return (
    <PantallaCatalogo<Promocion>
      titulo="Promociones"
      permiso="promocion.gestionar"
      etiquetaAlta="Nueva promoción"
      vacio="No hay promociones en esta sucursal."
      mensajeError="No se pudieron cargar las promociones."
      cargar={() => listarPromociones({ sucursal })}
      // La lista es de una sucursal: cambia con el selector global.
      deps={[sucursal]}
      // La frase llega a 200 caracteres: sin `whitespace-nowrap` una frase larga parte
      // "Para quién" en dos renglones. Medido a 1366 px.
      columnas={[
        { encabezado: "Promoción", celda: (p) => p.texto },
        {
          encabezado: "Para quién",
          celda: (p) =>
            p.audiencia === "todos" ? "Todos los clientes" : "Prospectos (primera venta)",
          className: "whitespace-nowrap",
        },
        {
          encabezado: "Sucursal",
          celda: (p) => p.sucursalCodigo,
          className: "whitespace-nowrap font-mono",
        },
        {
          encabezado: "Estado",
          celda: (p) =>
            p.activo ? "Activa" : <span className="text-muted-foreground">Inactiva</span>,
          className: "whitespace-nowrap",
        },
      ]}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioPromocion
          promocion={item}
          contexto={{ tipo: "sucursal", sucursal }}
          alGuardar={alGuardar}
          alCancelar={alCancelar}
        />
      )}
    />
  );
}
