import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { inicializarCapaDatos, type CapaDatos } from '@/datos/inicializar';
import type { Jornada } from '@/datos/tipos';
import type { VendedorSesion } from '@/sesion/politica';

import { ProveedorSesion, useSesion } from './proveedor-sesion';

export interface EstadoJawa {
  datos: CapaDatos;
  /** Vendedor con la sesion abierta en la tablet, o `null` si no ha entrado. */
  vendedor: VendedorSesion | null;
  /** Sucursal del vendedor con sesion abierta, o `null`. */
  sucursalId: string | null;
  /** Jornada de hoy, o `null` si aun no abrio el dia (o no hay sesion). */
  jornada: Jornada | null;
  /** Vuelve a leer la jornada de hoy desde SQLite. */
  refrescarJornada: () => void;
}

const ContextoDatos = createContext<CapaDatos | null>(null);
const ContextoJornada = createContext<{
  jornada: Jornada | null;
  refrescarJornada: () => void;
} | null>(null);

/**
 * Raiz del estado de la app: capa de datos, sesion del vendedor y jornada.
 *
 * El orden del anidamiento no es casual:
 *
 * 1. **Datos** primero — abrir y migrar SQLite no depende de nadie.
 * 2. **Sesion** despues — necesita la capa de datos para dejar al vendedor y su
 *    sucursal en el catalogo local (la `jornada` les tiene llave foranea).
 * 3. **Jornada** al final — es "la jornada DE ESTE vendedor", asi que no puede
 *    existir antes que la sesion. Cuando no hay sesion abierta, es `null`, y el
 *    guardia del kilometraje sigue funcionando sin cambios.
 */
export function ProveedorJawa({ children }: { children: ReactNode }) {
  // `useState` con inicializador perezoso: abre y migra la base UNA vez,
  // no en cada render.
  const [datos] = useState<CapaDatos>(() => inicializarCapaDatos());

  return (
    <ContextoDatos.Provider value={datos}>
      <ProveedorSesion datos={datos}>
        <ProveedorJornada>{children}</ProveedorJornada>
      </ProveedorSesion>
    </ContextoDatos.Provider>
  );
}

/**
 * Jornada de hoy del vendedor con sesion abierta.
 *
 * Se guarda en estado de React (y no se relee en cada pantalla) porque de ella
 * depende el **bloqueo de navegacion** del kilometraje inicial: si cada
 * pantalla consultara por su cuenta, el guardia parpadearia.
 */
function ProveedorJornada({ children }: { children: ReactNode }) {
  const datos = useDatos();
  const { vendedor } = useSesion();
  const vendedorId = vendedor?.id ?? null;

  const [jornada, setJornada] = useState<Jornada | null>(null);
  // Al entrar (o salir), la jornada que corresponde cambia. Se recalcula
  // durante el render en vez de en un efecto para que no exista un instante en
  // el que el vendedor ya entro pero la jornada todavia dice `null`: en ese
  // hueco, el guardia del kilometraje lo mandaria a "abrir el dia" aunque ya lo
  // hubiera abierto.
  const [ultimoVendedor, setUltimoVendedor] = useState<string | null>(null);
  if (ultimoVendedor !== vendedorId) {
    setUltimoVendedor(vendedorId);
    setJornada(vendedorId ? datos.jornadas.deHoy(vendedorId) : null);
  }

  const refrescarJornada = useCallback(() => {
    setJornada(vendedorId ? datos.jornadas.deHoy(vendedorId) : null);
  }, [datos, vendedorId]);

  const valor = useMemo(() => ({ jornada, refrescarJornada }), [jornada, refrescarJornada]);

  return <ContextoJornada.Provider value={valor}>{children}</ContextoJornada.Provider>;
}

function useDatos(): CapaDatos {
  const datos = useContext(ContextoDatos);
  if (!datos) {
    throw new Error('Falta <ProveedorJawa> en el arbol.');
  }
  return datos;
}

/**
 * Todo lo que una pantalla de la jornada necesita, en una sola llamada.
 *
 * Compone los tres contextos para que las pantallas no tengan que saber que
 * son tres. La forma que devuelve es la misma que en T-04, salvo que `vendedor`
 * y `sucursalId` ahora salen de la **sesion real** y no del primer vendedor de
 * la semilla de desarrollo.
 */
export function useJawa(): EstadoJawa {
  const datos = useDatos();
  const { vendedor } = useSesion();
  const jornadaCtx = useContext(ContextoJornada);
  if (!jornadaCtx) {
    throw new Error('useJawa() debe usarse dentro de <ProveedorJawa>.');
  }

  return {
    datos,
    vendedor,
    sucursalId: vendedor?.sucursalId ?? null,
    jornada: jornadaCtx.jornada,
    refrescarJornada: jornadaCtx.refrescarJornada,
  };
}
