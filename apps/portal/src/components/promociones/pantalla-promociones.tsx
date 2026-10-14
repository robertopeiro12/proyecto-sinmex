"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { FormularioPromocion } from "./formulario-promocion";
import { listarPromociones, type Promocion } from "@/lib/promociones";

export function PantallaPromociones({ sucursal }: { sucursal: string | null }) {
  const { usuario, cargando } = useAuth();

  // Un General sin sucursal en el selector: la API contestaría 400. Se avisa aquí, sin llamarla,
  // porque useCatalogo solo sabe decir "no se pudieron cargar" y eso no explicaría nada.
  if (cargando || usuario === null || (usuario.sucursal === null && !sucursal)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Promociones</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            {cargando || usuario === null
              ? "Cargando…"
              : "Elige una sucursal en el selector de arriba para ver sus promociones."}
          </p>
        </CardContent>
      </Card>
    );
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
      columnas={[
        { encabezado: "Promoción", celda: (p) => p.texto },
        {
          encabezado: "Para quién",
          celda: (p) =>
            p.audiencia === "todos" ? "Todos los clientes" : "Prospectos (primera venta)",
        },
        { encabezado: "Sucursal", celda: (p) => p.sucursalCodigo, className: "font-mono" },
        {
          encabezado: "Estado",
          celda: (p) =>
            p.activo ? "Activa" : <span className="text-muted-foreground">Inactiva</span>,
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
