import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getRandomBytes } from 'expo-crypto';

import type { CapaDatos } from '@/datos/inicializar';
import { relojSistema } from '@/datos/reloj';
import { sembrarCatalogosDeDesarrollo } from '@/datos/semilla-dev';
import { crearClienteAuthApp } from '@/sesion/api';
import { almacenSecureStore } from '@/sesion/almacen-secure-store';
import { crearGestorSesion, type GestorSesion, type ResultadoEntrada } from '@/sesion/gestor';
import type { EstadoSesion, VendedorSesion } from '@/sesion/politica';

export interface ContextoSesion {
  /**
   * Vendedor con la sesion ABIERTA en este arranque de la app.
   *
   * `null` mientras no se haya tecleado la contrasena, aunque haya material
   * guardado. Es deliberado: si la sesion se reabriera sola al arrancar,
   * encontrar la tablet encendida seria encontrar la sesion abierta, y el
   * vendedor la deja en la camioneta. Ver `sesion/politica.ts`.
   */
  vendedor: VendedorSesion | null;
  /** Que se puede hacer con lo guardado: re-autenticar local o exigir red. */
  material: EstadoSesion;
  entrar: (login: string, password: string) => Promise<ResultadoEntrada>;
  salir: () => Promise<void>;
  /** Renueva contra el servidor si hay red. La usara tambien T-07. */
  renovar: () => Promise<boolean>;
}

const Contexto = createContext<ContextoSesion | null>(null);

/**
 * Sesion del vendedor en la app.
 *
 * Ensambla el gestor con sus dependencias reales (almacenamiento cifrado,
 * cliente HTTP, reloj del sistema, aleatoriedad de `expo-crypto`) y expone lo
 * que necesitan las pantallas. Toda la logica probable vive en
 * `src/sesion/gestor.ts`; aqui solo esta el pegamento de React y el efecto que
 * el gestor no puede tener: dejar al vendedor y su sucursal en el catalogo
 * local.
 */
export function ProveedorSesion({
  datos,
  children,
}: {
  datos: CapaDatos;
  children: ReactNode;
}) {
  const [gestor] = useState<GestorSesion>(() =>
    crearGestorSesion({
      almacen: almacenSecureStore(),
      api: crearClienteAuthApp(),
      reloj: relojSistema,
      // getRandomBytes de expo-crypto: aleatoriedad del sistema operativo.
      // Nunca Math.random() — ver `seguridad/verificador.ts`.
      aleatorio: getRandomBytes,
    }),
  );

  const [vendedor, setVendedor] = useState<VendedorSesion | null>(null);
  // Se lee UNA vez al montar, de forma sincrona: `expo-secure-store` expone
  // `getItem` sincrono desde el SDK 57, asi que la primera pasada de
  // `app/index.tsx` ya sabe si hay material. Con una lectura asincrona,
  // mandaria al login incluso teniendo sesion.
  const [material, setMaterial] = useState<EstadoSesion>(() => gestor.estado());

  /**
   * Deja al vendedor y su sucursal en el catalogo local.
   *
   * Hace falta porque `jornada` tiene llave foranea a `vendedor` y `sucursal`:
   * sin estas filas, el vendedor no podria abrir el dia offline. Se hace con el
   * mismo upsert del snapshot de T-07 (no un INSERT propio) para que cuando
   * llegue la sincronizacion real esto sea simplemente un snapshot mas pequeno.
   */
  const sembrarIdentidad = useCallback(
    (quien: VendedorSesion) => {
      datos.catalogos.guardarSnapshot({
        sucursales: [
          {
            id: quien.sucursalId,
            codigo: quien.sucursalCodigo,
            nombre: quien.sucursalNombre,
            activa: 1,
          },
        ],
        vendedores: [
          {
            id: quien.id,
            login: quien.login,
            nombre: quien.nombre,
            sucursal_id: quien.sucursalId,
            activo: 1,
          },
        ],
        vehiculos: [],
        productos: [],
        presentaciones: [],
        clientes: [],
        precios: [],
      });

      // TODO: T-07 — borrar junto con `semilla-dev.ts`. Mientras el `pull` no
      // exista, sin esto la tablet no tiene ni un vehiculo con el que abrir el
      // dia. Solo en desarrollo: una compilacion de produccion no debe inventar
      // clientes ni camionetas.
      if (__DEV__) {
        sembrarCatalogosDeDesarrollo(datos.catalogos, quien.sucursalId);
      }
    },
    [datos],
  );

  const entrar = useCallback(
    async (login: string, password: string): Promise<ResultadoEntrada> => {
      const resultado = await gestor.entrar(login, password);
      if (resultado.ok) {
        sembrarIdentidad(resultado.vendedor);
        setVendedor(resultado.vendedor);
      }
      setMaterial(gestor.estado());
      return resultado;
    },
    [gestor, sembrarIdentidad],
  );

  const salir = useCallback(async () => {
    // Se cierra en la UI antes de esperar al servidor: si la revocacion tarda
    // (o no hay red), el vendedor no debe quedarse mirando su sesion abierta.
    setVendedor(null);
    await gestor.salir();
    setMaterial(gestor.estado());
  }, [gestor]);

  const renovar = useCallback(async () => {
    const ok = await gestor.renovar();
    setMaterial(gestor.estado());
    if (!ok && gestor.sesionGuardada() === null) {
      // El servidor tumbo la sesion (vendedor dado de baja, sesion revocada).
      setVendedor(null);
    }
    return ok;
  }, [gestor]);

  const valor = useMemo<ContextoSesion>(
    () => ({ vendedor, material, entrar, salir, renovar }),
    [vendedor, material, entrar, salir, renovar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): ContextoSesion {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error('useSesion() debe usarse dentro de <ProveedorSesion>.');
  }
  return contexto;
}
