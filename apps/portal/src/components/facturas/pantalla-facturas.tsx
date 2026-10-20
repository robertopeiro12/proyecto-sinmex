"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Pestanas } from "@/components/ui/pestanas";
import { AsignarFactura } from "./asignar-factura";
import { BuscarFacturas } from "./buscar-facturas";

/** Operación → Facturas (T-19): asignar, y buscar y corregir. */
export function PantallaFacturas({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando } = useAuth();

  // Sin esto, quien si tiene el permiso ve "No tienes permiso" un instante.
  if (cargando) return <EstadoPantalla titulo="Facturas" tipo="cargando" />;
  if (!puede("venta.asignar_factura")) return <EstadoPantalla titulo="Facturas" tipo="sin-permiso" />;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Facturas"
        descripcion="Anota el número de la factura del SAT en las ventas de un cliente, o corrige una factura ya anotada."
      />
      {/* conservarMontadas: cambiar de pestaña no debe borrar lo marcado. */}
      <Pestanas
        etiqueta="Facturas"
        conservarMontadas
        pestanas={[
          { valor: "asignar", etiqueta: "Asignar", contenido: <AsignarFactura sucursal={sucursal} /> },
          { valor: "buscar", etiqueta: "Buscar y corregir", contenido: <BuscarFacturas sucursal={sucursal} /> },
        ]}
      />
    </Pantalla>
  );
}
