import { EncabezadoPantalla, Pantalla } from "./encabezado-pantalla";

export type TipoEstadoPantalla = "cargando" | "sin-permiso" | "elige-sucursal";

/** Mismo texto, tamaño y lugar en todas las pantallas (UI Etapa 1, spec §4.1). */
export const TEXTO_ESTADO_PANTALLA: Record<TipoEstadoPantalla, string> = {
  cargando: "Cargando…",
  "sin-permiso": "No tienes permiso para ver esta sección.",
  "elige-sucursal": "Elige una sucursal en el menú lateral para ver esta sección.",
};

/**
 * Lo que se ve en lugar de la pantalla mientras carga la sesión, sin permiso, o cuando
 * hace falta elegir una sucursal. Sin `titulo` pinta solo el texto (dentro de un panel).
 */
export function EstadoPantalla({ tipo, titulo }: { tipo: TipoEstadoPantalla; titulo?: string }) {
  const texto = <p className="text-sm text-muted-foreground">{TEXTO_ESTADO_PANTALLA[tipo]}</p>;
  if (!titulo) return texto;
  return (
    <Pantalla>
      <EncabezadoPantalla titulo={titulo} />
      {texto}
    </Pantalla>
  );
}
