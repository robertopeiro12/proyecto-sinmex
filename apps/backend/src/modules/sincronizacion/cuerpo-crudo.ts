import { PayloadTooLargeException } from '@nestjs/common';
import type { Readable } from 'node:stream';

/**
 * Lee el cuerpo BINARIO de una peticion con un tope de bytes (T-40).
 *
 * Hace falta porque el unico parser que el backend registra es `express.json`
 * (ver `configurar-app.ts`, donde esta el porque: es la defensa contra el CSRF
 * de login). Un `image/jpeg` no lo toca ningun parser, asi que llega intacto al
 * handler y hay que leerlo a mano — que es justo lo que se queria, porque asi el
 * 413 lo decide Nest y sale como JSON con un motivo, en vez de un HTML de
 * body-parser antes de que Nest se enterara.
 *
 * > [!danger] Al pasarse el tope se SIGUE consumiendo el cuerpo hasta el final
 * > Lo primero que se escribio aqui fue lo contrario —rechazar en cuanto
 * > `content-length` decia que no cabia, sin leer un byte— y la prueba e2e de
 * > la foto de 3 MB fallo con `write EPIPE` en vez de con un 413.
 * >
 * > El motivo: si el servidor responde y **no** consume el cuerpo, Node cierra
 * > el socket al terminar la respuesta, y el cliente —que todavia estaba
 * > escribiendo sus 3 MB— se lleva un error de red en vez del 413. Una tablet
 * > lee cualquier error de red como "sin senal" y **reintenta la misma foto
 * > gigante para siempre**: exactamente el bucle que este limite existe para
 * > cortar, causado por el limite.
 * >
 * > Por eso, al pasarse: se **dejan de guardar** los trozos (la memoria queda
 * > acotada al tope, no al tamano de lo que manden) pero se siguen leyendo hasta
 * > `end`, y el 413 se lanza entonces. Se gasta ancho de banda de una peticion
 * > que ya estaba en vuelo, y a cambio la respuesta llega siempre.
 *
 * El tope se evalua con dos senales y ninguna sobra:
 *
 * 1. `content-length`, que permite decidir el rechazo desde el primer instante.
 * 2. Los bytes realmente leidos. **La cabecera la escribe el cliente y puede
 *    mentir** — o no venir (transfer-encoding chunked). Sin esto el tope seria
 *    una sugerencia.
 */
export async function leerCuerpoLimitado(
  flujo: Readable,
  maximo: number,
  contentLength?: string | string[],
): Promise<Buffer> {
  const declarado = Number(
    Array.isArray(contentLength) ? contentLength[0] : contentLength,
  );

  return new Promise<Buffer>((resolver, rechazar) => {
    // `excedido` puede nacer en `true` por la cabecera: entonces no se guarda ni
    // un trozo, solo se drena.
    let excedido = Number.isFinite(declarado) && declarado > maximo;
    let trozos: Buffer[] | null = excedido ? null : [];
    let total = 0;
    let terminado = false;

    const acabar = (fin: () => void) => {
      if (terminado) return;
      terminado = true;
      fin();
    };

    flujo.on('data', (trozo: Buffer) => {
      total += trozo.length;
      if (excedido) return; // drenando: se descarta

      if (total > maximo) {
        excedido = true;
        // Liberar lo acumulado: a partir de aqui esto se va a tirar igual, y
        // retenerlo seria pagar memoria por un cuerpo que ya se rechazo.
        trozos = null;
        return;
      }
      trozos?.push(trozo);
    });

    flujo.on('end', () =>
      acabar(() => {
        if (excedido) {
          // `total` es lo que de verdad llego, tambien cuando la cabecera fue la
          // que delato el tamano: es el numero honesto para el mensaje.
          rechazar(demasiadoGrande(total, maximo));
          return;
        }
        resolver(Buffer.concat(trozos ?? []));
      }),
    );

    flujo.on('error', (error) => acabar(() => rechazar(error)));
  });
}

function demasiadoGrande(
  bytes: number,
  maximo: number,
): PayloadTooLargeException {
  return new PayloadTooLargeException(
    `La foto pesa ${bytes} bytes y el maximo es ${maximo}. Comprimela mas en el equipo antes de subirla.`,
  );
}
