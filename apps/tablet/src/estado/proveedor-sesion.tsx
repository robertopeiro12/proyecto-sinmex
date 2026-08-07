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
import { crearClienteAuthApp } from '@/sesion/api';
import { almacenSecureStore } from '@/sesion/almacen-secure-store';
import { crearGestorSesion, type GestorSesion, type ResultadoEntrada } from '@/sesion/gestor';
import type { EstadoSesion, VendedorSesion } from '@/sesion/politica';
import { crearClienteSync } from '@/sincronizacion/api';
import { fuenteJornadas } from '@/sincronizacion/fuente-jornadas';
import {
  crearMotorSincronizacion,
  type MotorSincronizacion,
  type ResultadoSincronizacion,
} from '@/sincronizacion/motor';

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
  /** Renueva contra el servidor si hay red. La usa tambien el motor de T-07. */
  renovar: () => Promise<boolean>;
  /**
   * Pull + push contra el servidor. Renueva la sesion como primer paso, asi que
   * ademas corre hacia adelante la ventana offline de 72 h.
   */
  sincronizar: () => Promise<ResultadoSincronizacion>;
  /** Resultado de la ultima sincronizacion, para poder mostrarlo. */
  ultimaSincronizacion: ResultadoSincronizacion | null;
}

const Contexto = createContext<ContextoSesion | null>(null);

/**
 * Sesion del vendedor en la app + sincronizacion.
 *
 * Ensambla el gestor con sus dependencias reales (almacenamiento cifrado,
 * cliente HTTP, reloj del sistema, aleatoriedad de `expo-crypto`) y expone lo
 * que necesitan las pantallas. Toda la logica probable vive en
 * `src/sesion/gestor.ts` y `src/sincronizacion/motor.ts`; aqui solo esta el
 * pegamento de React.
 *
 * La sincronizacion vive junto a la sesion, y no en su propio proveedor, porque
 * **depende de ella de forma inseparable**: el primer paso del motor es
 * `gestor.renovar()`, que es lo que corre la ventana offline (ADR-0005).
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

  const [motor] = useState<MotorSincronizacion>(() =>
    crearMotorSincronizacion({
      api: crearClienteSync(),
      catalogos: datos.catalogos,
      sync: datos.sync,
      fuentes: [fuenteJornadas(datos.jornadas)],
      sesion: {
        renovar: () => gestor.renovar(),
        tokenAcceso: () => gestor.sesionGuardada()?.tokenAcceso ?? null,
      },
    }),
  );

  const [vendedor, setVendedor] = useState<VendedorSesion | null>(null);
  // Se lee UNA vez al montar, de forma sincrona: `expo-secure-store` expone
  // `getItem` sincrono desde el SDK 57, asi que la primera pasada de
  // `app/index.tsx` ya sabe si hay material. Con una lectura asincrona,
  // mandaria al login incluso teniendo sesion.
  const [material, setMaterial] = useState<EstadoSesion>(() => gestor.estado());
  const [ultimaSincronizacion, setUltimaSincronizacion] =
    useState<ResultadoSincronizacion | null>(null);

  /**
   * Deja al vendedor y su sucursal en el catalogo local.
   *
   * Hace falta porque `jornada` tiene llave foranea a `vendedor` y `sucursal`:
   * sin estas filas, el vendedor no podria abrir el dia offline. Se hace con el
   * mismo upsert del snapshot del pull (no un INSERT propio), asi que es
   * simplemente un snapshot mas pequeno que el que baja despues.
   *
   * Sigue haciendo falta aunque ya exista el `pull`: en un login **sin red**
   * (re-autenticacion local) no hay pull que valga, y aun asi el vendedor tiene
   * que poder abrir su dia.
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
      });
    },
    [datos],
  );

  const sincronizar = useCallback(async (): Promise<ResultadoSincronizacion> => {
    const resultado = await motor.sincronizar();
    setMaterial(gestor.estado());
    if (resultado.motivo === 'sin-sesion' && gestor.sesionGuardada() === null) {
      // El servidor tumbo la sesion (vendedor dado de baja, sesion revocada) y
      // el gestor ya borro el material local.
      setVendedor(null);
    }
    setUltimaSincronizacion(resultado);
    return resultado;
  }, [motor, gestor]);

  const entrar = useCallback(
    async (login: string, password: string): Promise<ResultadoEntrada> => {
      const resultado = await gestor.entrar(login, password);
      if (resultado.ok) {
        sembrarIdentidad(resultado.vendedor);
        setVendedor(resultado.vendedor);

        // Solo tras un login EN LINEA: es el momento en que la tablet esta en
        // el WiFi del negocio, justo antes de salir a ruta, que es cuando el
        // modelo del negocio dice que se descarga la informacion
        // ([[Sincronizacion offline]]). Un login local (sin red) no tiene con
        // quien sincronizar.
        //
        // No se espera al resultado ni se propaga su fallo: si el pull no sale,
        // el vendedor entra igual y trabaja con lo que ya tiene. Dejarlo fuera
        // de su jornada porque no bajaron los catalogos seria peor que unos
        // catalogos viejos.
        if (resultado.modo === 'linea') {
          void sincronizar();
        }
      }
      setMaterial(gestor.estado());
      return resultado;
    },
    [gestor, sembrarIdentidad, sincronizar],
  );

  const salir = useCallback(async () => {
    // Se cierra en la UI antes de esperar al servidor: si la revocacion tarda
    // (o no hay red), el vendedor no debe quedarse mirando su sesion abierta.
    setVendedor(null);
    await gestor.salir();
    setMaterial(gestor.estado());
    setUltimaSincronizacion(null);
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
    () => ({
      vendedor,
      material,
      entrar,
      salir,
      renovar,
      sincronizar,
      ultimaSincronizacion,
    }),
    [vendedor, material, entrar, salir, renovar, sincronizar, ultimaSincronizacion],
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
