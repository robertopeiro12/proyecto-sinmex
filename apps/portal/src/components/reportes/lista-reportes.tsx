"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";

/** Información → Reportes (T-50): la lista. Kilometraje (T-50) y Clientes nuevos (T-51); los demas reportes se suman aqui. */
export function ListaReportes({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();
  const consulta = sucursal ? `?sucursal=${encodeURIComponent(sucursal)}` : "";

  if (cargandoSesion) return <EstadoPantalla titulo="Reportes" tipo="cargando" />;
  if (!puede("reportes.ver")) return <EstadoPantalla titulo="Reportes" tipo="sin-permiso" />;

  const reportes = [
    {
      nombre: "Kilometraje",
      href: `/informacion/reportes/kilometraje${consulta}`,
      explicacion: "Kilómetros por vehículo y día, con los saltos entre jornadas. Exportable a Excel.",
    },
    {
      nombre: "Clientes nuevos",
      href: `/informacion/reportes/clientes-nuevos${consulta}`,
      explicacion:
        "Clientes dados de alta (o convertidos de prospecto) en un rango, con el usuario que los dio de alta. Exportable a Excel.",
    },
  ];

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Reportes"
        descripcion="Los reportes del negocio que se pueden consultar y exportar a Excel."
      />
      <ul className="flex flex-col gap-3">
        {reportes.map((r) => (
          <li key={r.href} className="rounded-[10px] border px-4 py-3 transition-colors hover:bg-menu">
            <Link href={r.href} className="font-semibold underline">
              {r.nombre}
            </Link>
            <p className="mt-1 text-sm text-muted-foreground">{r.explicacion}</p>
          </li>
        ))}
      </ul>
    </Pantalla>
  );
}
