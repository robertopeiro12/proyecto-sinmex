import { aBase64 } from './base64';
import { crearControladorBluetooth, elegirControlador, type PuenteImpresora } from './controlador';
import { ticketsAEscPos } from './escpos';

function puente(falla?: string): PuenteImpresora & { envios: [string, string][] } {
  const envios: [string, string][] = [];
  return {
    envios,
    imprimir: async (direccion, bytes) => {
      if (falla) throw Object.assign(new Error('nativo'), { code: falla });
      envios.push([direccion, bytes]);
    },
  };
}

const DIR = '66:22:32:A1:B2:C3';

describe('crearControladorBluetooth', () => {
  test('imprimirVarios manda un solo envío con todos los tickets', async () => {
    const p = puente();
    const tickets = [['UNO', 'a'], ['DOS']];
    expect(await crearControladorBluetooth(DIR, 'PT-210', p).imprimirVarios(tickets)).toEqual({ ok: true });
    expect(p.envios).toEqual([[DIR, aBase64(ticketsAEscPos(tickets))]]);
  });

  test('imprimir manda un ticket', async () => {
    const p = puente();
    await crearControladorBluetooth(DIR, 'PT-210', p).imprimir(['UNO']);
    expect(p.envios).toEqual([[DIR, aBase64(ticketsAEscPos([['UNO']]))]]);
  });

  test('un error del módulo sale como fallo con el texto para el vendedor', async () => {
    expect(await crearControladorBluetooth(DIR, 'PT-210', puente('bluetooth-apagado')).imprimir(['UNO'])).toEqual({
      ok: false,
      motivo: 'fallo',
      detalle: 'Prende el Bluetooth.',
    });
    expect(await crearControladorBluetooth(DIR, 'PT-210', puente('no-conecta')).imprimir(['UNO'])).toEqual({
      ok: false,
      motivo: 'fallo',
      detalle: 'No se pudo conectar con PT-210. ¿Está prendida?',
    });
  });
});

describe('elegirControlador', () => {
  test('sin impresora elegida no imprime y lo dice', async () => {
    const p = puente();
    expect(await elegirControlador(null, 58, p).imprimir(['UNO'])).toEqual({
      ok: false,
      motivo: 'fallo',
      detalle: 'Elige la impresora en Seleccionar impresora.',
    });
    expect(p.envios).toEqual([]);
  });

  test('la impresora Bluetooth elegida recibe los bytes', async () => {
    const p = puente();
    await elegirControlador({ tipo: 'bluetooth', nombre: 'PT-210', direccion: DIR }, 80, p).imprimirVarios([['UNO']]);
    expect(p.envios).toHaveLength(1);
    expect(p.envios[0]?.[0]).toBe(DIR);
  });

  test('el diálogo no usa el Bluetooth', () => {
    const p = puente();
    const c = elegirControlador({ tipo: 'dialogo' }, 58, p);
    expect(typeof c.imprimir).toBe('function');
    expect(p.envios).toEqual([]);
  });
});
