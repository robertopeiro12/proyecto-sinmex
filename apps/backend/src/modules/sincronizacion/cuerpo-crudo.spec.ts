import { Readable } from 'node:stream';
import { PayloadTooLargeException } from '@nestjs/common';
import { leerCuerpoLimitado } from './cuerpo-crudo';

/**
 * El lector del cuerpo binario de la foto (T-40).
 *
 * Lo que de verdad hay que probar es que el tope **no** se fia de
 * `content-length`: esa cabecera la escribe el cliente y si fuera la unica
 * comprobacion, el limite seria una sugerencia.
 */
describe('leerCuerpoLimitado', () => {
  const flujo = (...trozos: Buffer[]) => Readable.from(trozos);

  it('devuelve el cuerpo completo cuando cabe', async () => {
    const cuerpo = await leerCuerpoLimitado(
      flujo(Buffer.from('ab'), Buffer.from('cd')),
      10,
      '4',
    );
    expect(cuerpo.toString()).toBe('abcd');
  });

  it('funciona sin content-length (transfer-encoding chunked)', async () => {
    const cuerpo = await leerCuerpoLimitado(flujo(Buffer.from('hola')), 10);
    expect(cuerpo.toString()).toBe('hola');
  });

  it('rechaza cuando content-length ya dice que no cabe', async () => {
    await expect(
      leerCuerpoLimitado(flujo(Buffer.alloc(20)), 10, '20'),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('rechaza por bytes leidos aunque content-length MIENTA', async () => {
    // Sin esto el tope no serviria de nada: basta declarar 5 y mandar 20.
    await expect(
      leerCuerpoLimitado(flujo(Buffer.alloc(20)), 10, '5'),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  /**
   * **Esta es la prueba que costo un bug real.**
   *
   * La primera version rechazaba en cuanto `content-length` decia que no cabia,
   * sin leer nada, y la prueba e2e de la foto de 3 MB fallaba con `write EPIPE`
   * en vez de con un 413: Node cierra el socket al responder sin consumir el
   * cuerpo, y el cliente que todavia escribia se llevaba un error de red.
   *
   * Para una tablet eso es "sin senal", asi que reintentaria la misma foto
   * gigante para siempre — el bucle que el limite existe para cortar, causado por
   * el limite. Consumir hasta el final es lo que garantiza que el 413 llegue.
   */
  it('drena el cuerpo hasta el final antes de rechazar, para que la respuesta llegue', async () => {
    const grande = flujo(Buffer.alloc(20), Buffer.alloc(20));

    await expect(leerCuerpoLimitado(grande, 10, '40')).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(grande.readableEnded).toBe(true);
  });

  it('no acumula en memoria lo que ya se paso del tope', async () => {
    // Se drena, pero no se guarda: la memoria queda acotada al tope y no al
    // tamano de lo que manden. Se comprueba por el mensaje, que reporta los
    // bytes CONTADOS (40) sin haberlos retenido.
    await expect(
      leerCuerpoLimitado(flujo(Buffer.alloc(20), Buffer.alloc(20)), 10),
    ).rejects.toThrow(/40 bytes y el maximo es 10/);
  });

  it('el mensaje del 413 dice cuanto pesaba y cuanto cabe', async () => {
    // La tablet guarda el motivo en su fila para que el vendedor no tenga que
    // adivinar por que su foto no subio.
    await expect(
      leerCuerpoLimitado(flujo(Buffer.alloc(20)), 10),
    ).rejects.toThrow(/20 bytes y el maximo es 10/);
  });

  it('acepta un cuerpo exactamente del tamano maximo', async () => {
    const cuerpo = await leerCuerpoLimitado(flujo(Buffer.alloc(10)), 10, '10');
    expect(cuerpo).toHaveLength(10);
  });

  it('propaga un error del flujo (la conexion se corto)', async () => {
    const roto = new Readable({
      read() {
        this.destroy(new Error('conexion perdida'));
      },
    });
    await expect(leerCuerpoLimitado(roto, 10)).rejects.toThrow(
      'conexion perdida',
    );
  });
});
