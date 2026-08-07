import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { inicializarCapaDatos, type CapaDatos } from '@/datos/inicializar';
import { SUCURSAL_DEV } from '@/datos/semilla-dev';
import type { Jornada, Vendedor } from '@/datos/tipos';

export interface EstadoJawa {
  datos: CapaDatos;
  /** Vendedor con la sesion abierta en la tablet. */
  vendedor: Vendedor | null;
  /** Sucursal a la que pertenece el vendedor. */
  sucursalId: string;
  /** Jornada de hoy, o `null` si aun no abrio el dia. */
  jornada: Jornada | null;
  /** Vuelve a leer la jornada de hoy desde SQLite. */
  refrescarJornada: () => void;
}

const ContextoJawa = createContext<EstadoJawa | null>(null);

/**
 * Abre la base local y expone la capa de datos + la jornada de hoy al arbol de
 * pantallas.
 *
 * La jornada se guarda en estado de React (y no se relee en cada pantalla)
 * porque de ella depende el **bloqueo de navegacion** del kilometraje inicial:
 * si cada pantalla consultara por su cuenta, el guardia parpadearia.
 */
export function ProveedorJawa({ children }: { children: ReactNode }) {
  // `useState` con inicializador perezoso: abre y migra la base UNA vez,
  // no en cada render.
  const [datos] = useState<CapaDatos>(() => inicializarCapaDatos());

  // TODO: T-06 — la sesion del vendedor (login con credenciales validas
  //       offline) no existe todavia. Mientras tanto se toma el primer
  //       vendedor activo del catalogo local para poder navegar el shell.
  const [vendedor] = useState<Vendedor | null>(() =>
    datos.catalogos.obtenerVendedorPorLogin('demo'),
  );

  const [jornada, setJornada] = useState<Jornada | null>(() =>
    vendedor ? datos.jornadas.deHoy(vendedor.id) : null,
  );

  const refrescarJornada = useCallback(() => {
    setJornada(vendedor ? datos.jornadas.deHoy(vendedor.id) : null);
  }, [datos, vendedor]);

  const valor = useMemo<EstadoJawa>(
    () => ({
      datos,
      vendedor,
      sucursalId: vendedor?.sucursal_id ?? SUCURSAL_DEV,
      jornada,
      refrescarJornada,
    }),
    [datos, vendedor, jornada, refrescarJornada],
  );

  return <ContextoJawa.Provider value={valor}>{children}</ContextoJawa.Provider>;
}

export function useJawa(): EstadoJawa {
  const contexto = useContext(ContextoJawa);
  if (!contexto) {
    throw new Error('useJawa() debe usarse dentro de <ProveedorJawa>.');
  }
  return contexto;
}
