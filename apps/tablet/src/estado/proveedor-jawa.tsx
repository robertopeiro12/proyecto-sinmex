import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

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
  /**
   * Sube cada vez que el `pull` escribe en los catalogos locales.
   *
   * > [!danger] Si consultas un catalogo, ponlo en las dependencias
   * > ```ts
   * > const clientes = useMemo(
   * >   () => datos.catalogos.listarClientes(sucursalId),
   * >   [datos, sucursalId, versionCatalogos],   // <-- sin esto, no se refresca
   * > );
   * > ```
   * > `datos` y `sucursalId` **no cambian** cuando el pull escribe en SQLite.
   * > Olvidar esta dependencia es exactamente el bloqueo del primer arranque
   * > que se encontro en dispositivo el 2026-08-23: la pantalla se queda con lo
   * > que leyo al montarse y el vendedor no puede abrir el dia.
   */
  versionCatalogos: number;
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
  const versionCatalogos = useVersionCatalogos(datos);
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
    versionCatalogos,
  };
}

/**
 * Conecta React a la senal de cambio del repositorio de catalogos.
 *
 * `useSyncExternalStore` es la herramienta exacta para esto: la fuente de la
 * verdad esta **fuera de React** (SQLite), y esta es la forma que React ofrece
 * para leerla sin quedarse con una copia vieja.
 *
 * No hay contexto ni proveedor nuevo, y no hace falta: el repositorio ya es un
 * unico objeto vivo durante todo el arranque (`inicializarCapaDatos()` corre una
 * sola vez), asi que `suscribir` y `version` son referencias estables y cada
 * componente puede conectarse por su cuenta.
 *
 * Va dentro de `useJawa()` y no como hook aparte para que **ninguna pantalla
 * tenga que acordarse de pedirlo**. Es la misma doctrina que el guardia del
 * kilometraje, que vive en la navegacion: lo que depende de que alguien se
 * acuerde, tarde o temprano deja de existir en silencio.
 */
function useVersionCatalogos(datos: CapaDatos): number {
  return useSyncExternalStore(datos.catalogos.suscribir, datos.catalogos.version);
}
