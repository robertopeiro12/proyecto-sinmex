import { SinRedError } from '@/sesion/api';

import { SesionRechazadaError } from './api';
import {
  crearClienteFotos,
  FotoPermanenteError,
  FotoTemporalError,
  type EnviarFoto,
  type RespuestaCruda,
} from './api-foto';

const BASE = 'http://servidor';
const CLAVE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const URI = 'file:///cache/foto.jpg';
const SUBIDA_EN = '2026-09-18T22:10:00.000Z';

/** Cliente cableado a una respuesta fija, anotando la URL que se pidio. */
function montar(respuesta: RespuestaCruda | (() => Promise<never>)) {
  const llamadas: { url: string; token: string; uri: string }[] = [];
  const enviar: EnviarFoto = async (url, token, uri) => {
    llamadas.push({ url, token, uri });
    if (typeof respuesta === 'function') return respuesta();
    return respuesta;
  };
  return { cliente: crearClienteFotos(enviar, BASE), llamadas };
}

const jsonNest = (status: number, message: string): RespuestaCruda => ({
  status,
  body: JSON.stringify({ statusCode: status, message, error: 'x' }),
});

const aceptado = (): RespuestaCruda => ({
  status: 200,
  body: JSON.stringify({ clave: CLAVE, subida_en: SUBIDA_EN }),
});

describe('cliente de la foto del prospecto', () => {
  describe('cuando el servidor la acepta', () => {
    it('pide la ruta de la clave y devuelve el momento del SERVIDOR', async () => {
      const { cliente, llamadas } = montar(aceptado());

      const subidaEn = await cliente.subir('token-vivo', CLAVE, URI);

      // El momento lo pone el servidor: es lo unico que confirma que la foto
      // llego al otro lado, asi que el reloj que lo dice tiene que ser el de alla.
      expect(subidaEn).toBe(SUBIDA_EN);
      expect(llamadas).toEqual([
        { url: `${BASE}/sync/foto/${CLAVE}`, token: 'token-vivo', uri: URI },
      ]);
    });

    it('la clave viaja en minusculas: el servidor la usa como nombre de archivo', async () => {
      // `clave_idempotencia` es `text` en Postgres y se compara distinguiendo
      // mayusculas. Una URL en mayusculas daria un 404 desconcertante.
      const { cliente, llamadas } = montar(aceptado());

      await cliente.subir('token-vivo', CLAVE.toUpperCase(), URI);

      expect(llamadas[0]?.url).toBe(`${BASE}/sync/foto/${CLAVE}`);
    });

    it('un 200 con una respuesta ilegible se reintenta, no se da por subida', async () => {
      // Marcarla como subida sin el momento del servidor seria inventarse el dato
      // que confirma la subida. Reintentar es gratis: el archivo se llama igual.
      const { cliente } = montar({ status: 200, body: '<html>portal cautivo</html>' });

      await expect(cliente.subir('token-vivo', CLAVE, URI)).rejects.toThrow(
        FotoTemporalError,
      );
    });
  });

  /**
   * > [!danger] Las dos pruebas de aqui son la razon de que este archivo exista
   * > Un **413 o un 415 tratados como temporales** son la tablet reintentando la
   * > misma foto en cada sincronizacion, **para siempre**, gastando la WiFi del
   * > negocio sin que nadie se entere. Es el mismo fallo que `MAX_BYTES_POR_LOTE`
   * > corto en el push, y el que este canal tiene que cortar por su cuenta.
   */
  describe('permanente: no se arregla reintentando', () => {
    it('413 (pasa de 2 MB) es permanente', async () => {
      const { cliente } = montar(
        jsonNest(413, 'La foto pesa 3145728 bytes y el maximo es 2097152.'),
      );

      const error = await cliente.subir('token-vivo', CLAVE, URI).catch((e) => e);

      expect(error).toBeInstanceOf(FotoPermanenteError);
      // Y NO de las clases temporales: el motor decide con el `instanceof`.
      expect(error).not.toBeInstanceOf(FotoTemporalError);
      expect(error).not.toBeInstanceOf(SinRedError);
      // El motivo del servidor llega intacto: es lo que se pinta en la fila.
      expect(error.message).toContain('3145728');
    });

    it('415 (el contenido no es JPEG) es permanente', async () => {
      const { cliente } = montar(
        jsonNest(415, 'El contenido no es un JPEG completo. Vuelve a tomar la foto.'),
      );

      const error = await cliente.subir('token-vivo', CLAVE, URI).catch((e) => e);

      expect(error).toBeInstanceOf(FotoPermanenteError);
      expect(error).not.toBeInstanceOf(FotoTemporalError);
      expect(error.message).toContain('Vuelve a tomar la foto');
    });
  });

  describe('temporal: la misma foto puede entrar en otra pasada', () => {
    it('404 (el servidor no conoce la clave) se reintenta', async () => {
      // El push del prospecto no ha pasado todavia, o su operacion fue rechazada
      // y por el contrato §7 no dejo fila. Las dos se arreglan solas.
      const { cliente } = montar(
        jsonNest(404, 'No hay ninguna operacion con esa clave.'),
      );

      const error = await cliente.subir('token-vivo', CLAVE, URI).catch((e) => e);

      expect(error).toBeInstanceOf(FotoTemporalError);
      expect(error).not.toBeInstanceOf(FotoPermanenteError);
    });

    it('409 (aun sin proyectar) se reintenta', async () => {
      // OJO: en el canal del PUSH un 409 es "contrato incompatible" y aborta la
      // sincronizacion. Aqui significa lo contrario, y por eso este cliente no
      // reusa el `pedir` de `api.ts`.
      const { cliente } = montar(
        jsonNest(409, 'Ese prospecto todavia no esta proyectado en la cartera.'),
      );

      await expect(cliente.subir('token-vivo', CLAVE, URI)).rejects.toBeInstanceOf(
        FotoTemporalError,
      );
    });

    /**
     * > [!danger] Un 403 permanente perderia fotos buenas en silencio
     * > La tablet puede compartirse. Si el equipo cambio de manos, el servidor
     * > rechaza la foto porque quien manda el token no es quien capturo el
     * > prospecto — pero esa foto **subiria perfectamente** el dia que su vendedor
     * > vuelva a entrar. Descartarla es perder la foto de un cliente potencial sin
     * > que nadie se entere, que es el fallo que todo T-40 existe para evitar.
     */
    it('403 (operacion de otro vendedor) se reintenta, NO se descarta', async () => {
      const { cliente } = montar(jsonNest(403, 'Esa operacion no es tuya.'));

      const error = await cliente.subir('token-vivo', CLAVE, URI).catch((e) => e);

      expect(error).toBeInstanceOf(FotoTemporalError);
      expect(error).not.toBeInstanceOf(FotoPermanenteError);
    });

    it('un 500 se reintenta: el backend se levanta', async () => {
      const { cliente } = montar({ status: 500, body: '' });

      const error = await cliente.subir('token-vivo', CLAVE, URI).catch((e) => e);

      expect(error).toBeInstanceOf(FotoTemporalError);
      expect(error.message).toContain('500');
    });
  });

  describe('lo que no es de esta foto sino del canal', () => {
    it('401 sale como sesion rechazada: hay que renovar, no descartar', async () => {
      const { cliente } = montar({ status: 401, body: '' });

      const error = await cliente.subir('token-vencido', CLAVE, URI).catch((e) => e);

      expect(error).toBeInstanceOf(SesionRechazadaError);
      expect(error).not.toBeInstanceOf(FotoPermanenteError);
    });

    it('sin respuesta sale como SinRedError, no como fallo de la foto', async () => {
      // Es la distincion que da sentido al resto: una WiFi caida NO puede parecer
      // un rechazo del servidor, porque entonces se descartaria una foto buena.
      const { cliente } = montar(() => Promise.reject(new SinRedError()));

      const error = await cliente.subir('token-vivo', CLAVE, URI).catch((e) => e);

      expect(error).toBeInstanceOf(SinRedError);
      expect(error).not.toBeInstanceOf(FotoPermanenteError);
      expect(error).not.toBeInstanceOf(FotoTemporalError);
    });

    it('un FotoPermanenteError del transporte (archivo perdido) pasa tal cual', async () => {
      // El archivo local desaparecio con una limpieza de cache: no vuelve, asi que
      // el transporte ya lo clasifica y el cliente no lo reinterpreta.
      const { cliente } = montar(() =>
        Promise.reject(new FotoPermanenteError('El archivo de la foto ya no esta.')),
      );

      await expect(cliente.subir('token-vivo', CLAVE, URI)).rejects.toBeInstanceOf(
        FotoPermanenteError,
      );
    });
  });
});
