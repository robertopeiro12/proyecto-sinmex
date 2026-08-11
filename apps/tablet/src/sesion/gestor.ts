/**
 * Gestor de la sesion del vendedor.
 *
 * Junta las cuatro piezas —almacenamiento cifrado, verificador local, politica
 * offline y API— detras de una sola operacion: **`entrar(login, password)`**.
 *
 * El vendedor teclea siempre lo mismo, haya red o no. Quien decide si esto es
 * un login en linea o una re-autenticacion local es el gestor, no el vendedor:
 * en ruta no tiene forma de saber si la tablet tiene senal, y obligarlo a
 * elegir "modo offline" en un menu es como se pierden jornadas enteras.
 *
 * Todo lo que hay aqui es probable en Node: recibe el almacen, el cliente de
 * API, el reloj y la fuente aleatoria por inyeccion. Ver `gestor.spec.ts`.
 */
import type { Reloj } from '@/datos/reloj';
import { derivarVerificador, verificarContrasena, type FuenteAleatoria } from '@/seguridad/verificador';

import { CLAVE_SESION, type AlmacenSeguro } from './almacen';
import {
  CredencialesInvalidasError,
  SinRedError,
  type ClienteAuthApp,
  type RespuestaAuthApp,
} from './api';
import {
  conIntentoFallido,
  evaluarSesion,
  intentosRestantes,
  type EstadoSesion,
  type MotivoRed,
  type SesionGuardada,
  type VendedorSesion,
} from './politica';

export interface DepsGestorSesion {
  almacen: AlmacenSeguro;
  api: ClienteAuthApp;
  reloj: Reloj;
  aleatorio: FuenteAleatoria;
}

export type MotivoFalloEntrada =
  | 'credenciales'
  /** Hay sesion local, pero de OTRO vendedor: cambiar de vendedor exige red. */
  | 'otro-vendedor'
  | MotivoRed;

export type ResultadoEntrada =
  | { ok: true; modo: 'linea' | 'local'; vendedor: VendedorSesion }
  | { ok: false; motivo: MotivoFalloEntrada; intentosRestantes?: number };

export type GestorSesion = ReturnType<typeof crearGestorSesion>;

export function crearGestorSesion({ almacen, api, reloj, aleatorio }: DepsGestorSesion) {
  function leer(): SesionGuardada | null {
    const crudo = almacen.leer(CLAVE_SESION);
    if (!crudo) return null;
    try {
      return JSON.parse(crudo) as SesionGuardada;
    } catch {
      // Entrada ilegible: no hay nada que salvar y arrastrarla solo produciria
      // fallos raros mas adelante.
      almacen.borrar(CLAVE_SESION);
      return null;
    }
  }

  function guardar(sesion: SesionGuardada): void {
    almacen.escribir(CLAVE_SESION, JSON.stringify(sesion));
  }

  /** Arma la sesion a partir de una respuesta del servidor. */
  function desdeRespuesta(
    respuesta: RespuestaAuthApp,
    verificador: string,
  ): SesionGuardada {
    return {
      vendedor: respuesta.vendedor,
      tokenAcceso: respuesta.tokenAcceso,
      accesoExpiraEn: respuesta.accesoExpiraEn,
      tokenRefresh: respuesta.tokenRefresh,
      sesionExpiraEn: respuesta.sesionExpiraEn,
      // El servidor acaba de confirmar la sesion: este es el instante que
      // arranca la ventana offline.
      ultimoContactoServidor: reloj.ahora(),
      politica: respuesta.politica,
      verificador,
      intentosFallidos: 0,
    };
  }

  const gestor = {
    /** La sesion guardada tal cual, sin interpretar. */
    sesionGuardada: leer,

    /** Que puede hacer la app con lo que hay guardado, ahora mismo. */
    estado(): EstadoSesion {
      return evaluarSesion(leer(), reloj.ahora());
    },

    /**
     * Entra a la app. Intenta el servidor y, si no lo alcanza, cae a la sesion
     * local.
     *
     * El orden importa: **primero el servidor**. Asi una baja de vendedor, un
     * cambio de contrasena o una sesion revocada surten efecto en cuanto hay
     * red, sin esperar a que venza la ventana offline. Si se intentara primero
     * lo local, una tablet con senal seguiria abriendose con credenciales
     * viejas hasta que caducara el verificador.
     */
    async entrar(login: string, password: string): Promise<ResultadoEntrada> {
      try {
        const respuesta = await api.login(login, password);
        // El verificador se deriva de la contrasena que el vendedor ACABA de
        // teclear y que el servidor ACABA de dar por buena. El backend no
        // manda ningun hash: ver `seguridad/verificador.ts`.
        const verificador = derivarVerificador(
          password,
          aleatorio,
          respuesta.politica.costeVerificador,
        );
        const sesion = desdeRespuesta(respuesta, verificador);
        guardar(sesion);
        return { ok: true, modo: 'linea', vendedor: sesion.vendedor };
      } catch (error) {
        if (error instanceof CredencialesInvalidasError) {
          // El servidor es la autoridad: no se cuenta como intento local
          // fallido ni se toca la sesion guardada.
          return { ok: false, motivo: 'credenciales' };
        }
        if (!(error instanceof SinRedError)) {
          throw error;
        }
      }

      return gestor.entrarLocalmente(login, password);
    },

    /**
     * Re-autenticacion **sin red** contra el verificador guardado.
     *
     * Publica por si hace falta forzarla (pruebas, o un futuro boton de
     * "trabajar sin conexion"), pero el camino normal es `entrar()`.
     */
    entrarLocalmente(login: string, password: string): ResultadoEntrada {
      const sesion = leer();
      const estado = evaluarSesion(sesion, reloj.ahora());

      if (estado.tipo === 'requiere-red') {
        if (estado.motivo === 'intentos-agotados') {
          // Ya no hay nada que proteger aqui: se borra el material local para
          // que ni siquiera quede el verificador contra el que seguir
          // probando. La sesion del servidor sigue viva y se recupera con un
          // login en linea.
          almacen.borrar(CLAVE_SESION);
        }
        return { ok: false, motivo: estado.motivo };
      }

      // `estado` es 'reautenticacion-local', asi que `sesion` no es null.
      const actual = sesion as SesionGuardada;

      if (actual.vendedor.login !== login) {
        // Cambiar de vendedor en la misma tablet exige red: el verificador
        // guardado es de otra persona y no hay forma de validar a esta sin
        // preguntarle al servidor. No cuenta como intento fallido (no es un
        // ataque a la contrasena, es un login de alguien mas).
        return { ok: false, motivo: 'otro-vendedor' };
      }

      if (verificarContrasena(password, actual.verificador)) {
        guardar({ ...actual, intentosFallidos: 0 });
        return { ok: true, modo: 'local', vendedor: actual.vendedor };
      }

      const conFallo = conIntentoFallido(actual);
      const restantes = intentosRestantes(conFallo);
      if (restantes === 0) {
        almacen.borrar(CLAVE_SESION);
        return { ok: false, motivo: 'intentos-agotados' };
      }

      guardar(conFallo);
      return { ok: false, motivo: 'credenciales', intentosRestantes: restantes };
    },

    /**
     * Cierra la sesion y **borra el material local**.
     *
     * Consecuencia deliberada, y la pantalla debe advertirla: tras esto no hay
     * re-autenticacion offline posible. Si el vendedor cierra sesion en ruta,
     * se queda fuera hasta volver a tener red. Es lo correcto — "cerrar
     * sesion" tiene que significar que la tablet ya no lleva credenciales
     * encima — pero es exactamente el boton que no debe apretar por error.
     *
     * Se intenta revocar en el servidor primero; si no hay red, se borra local
     * igual. Dejar el token vivo en el dispositivo por no poder avisar seria
     * lo peor de los dos mundos.
     */
    async salir(): Promise<void> {
      const sesion = leer();
      almacen.borrar(CLAVE_SESION);
      if (!sesion) return;
      try {
        await api.cerrarSesion(sesion.tokenRefresh);
      } catch {
        // Sin red no se puede revocar ahora. El refresh vence solo, y el
        // material local ya no esta.
      }
    },

    /**
     * Renueva la sesion contra el servidor cuando hay red.
     *
     * Es lo que **reinicia la ventana offline**: cada contacto exitoso corre
     * hacia adelante `ultimoContactoServidor`. Lo llamara tambien la
     * sincronizacion de T-07, que es cuando la tablet vuelve al WiFi del
     * negocio.
     *
     * Devuelve `false` sin romper nada si no hay red: renovar es oportunista.
     */
    async renovar(): Promise<boolean> {
      const sesion = leer();
      if (!sesion) return false;

      try {
        const respuesta = await api.refrescar(sesion.tokenRefresh);
        guardar({
          ...desdeRespuesta(respuesta, sesion.verificador),
          // El verificador NO se regenera: no tenemos la contrasena aqui. Se
          // conserva el que se derivo en el ultimo login.
          intentosFallidos: 0,
        });
        return true;
      } catch (error) {
        if (error instanceof CredencialesInvalidasError) {
          // El servidor rechazo el refresh (revocado, vencido, vendedor dado
          // de baja). La sesion local deja de valer: se borra. Es el unico
          // camino por el que una baja hecha en el portal llega a la tablet.
          almacen.borrar(CLAVE_SESION);
          return false;
        }
        if (error instanceof SinRedError) return false;
        throw error;
      }
    },
  };

  return gestor;
}
