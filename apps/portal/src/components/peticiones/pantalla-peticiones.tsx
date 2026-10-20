"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Pestanas } from "@/components/ui/pestanas";
import { BandejaPeticiones } from "./bandeja-peticiones";

/** Operación → Peticiones (T-34): autorizar o denegar el borrado de pagos. */
export function PantallaPeticiones({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();

  // Mientras /auth/me no contesta, `puede()` da false a todos: sin esto, quien
  // si tiene el permiso ve "No tienes permiso" un instante (como PantallaPerfiles).
  if (cargandoSesion) return <EstadoPantalla titulo="Peticiones" tipo="cargando" />;
  if (!puede("peticiones.gestionar")) return <EstadoPantalla titulo="Peticiones" tipo="sin-permiso" />;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Peticiones"
        descripcion="Autoriza o niega las peticiones para borrar un pago. Al autorizar se borra el pago completo."
      />
      {/* Sin conservarMontadas: cambiar de pestaña empieza limpio (sin avisos ni paneles de la otra). */}
      <Pestanas
        etiqueta="Peticiones"
        pestanas={[
          {
            valor: "pendiente",
            etiqueta: "Pendientes",
            contenido: <BandejaPeticiones status="pendiente" sucursal={sucursal} />,
          },
          {
            valor: "historial",
            etiqueta: "Historial",
            contenido: <BandejaPeticiones status="historial" sucursal={sucursal} />,
          },
        ]}
      />
    </Pantalla>
  );
}
