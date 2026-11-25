import { aCp850, ticketsAEscPos } from './escpos';
import { armarTicket, type DatosTicket } from './ticket';

describe('aCp850', () => {
  it('codifica acentos y ñ', () => {
    expect(aCp850('Té')).toEqual([0x54, 0x82]);
    expect(aCp850('Año')).toEqual([0x41, 0xa4, 0x6f]);
    expect(aCp850('·')).toEqual([0xfa]);
  });

  it('cubre toda la tabla del ticket', () => {
    const tabla: Record<string, number> = {
      á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3,
      Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9,
      ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a, '¿': 0xa8, '¡': 0xad, '°': 0xf8, '·': 0xfa,
    };
    for (const [c, b] of Object.entries(tabla)) expect(aCp850(c)).toEqual([b]);
  });

  it('deja el ASCII imprimible tal cual', () => {
    expect(aCp850('Folio TJ-1 $2.50')).toEqual(Array.from('Folio TJ-1 $2.50', (c) => c.charCodeAt(0)));
  });

  it('translitera sin acento lo que no está en la tabla y usa ? si no se puede', () => {
    expect(aCp850('ã')).toEqual([0x61]);
    expect(aCp850('€')).toEqual([0x3f]);
  });
});

describe('ticketsAEscPos', () => {
  const bytes = (t: string[][]) => Array.from(ticketsAEscPos(t));

  it('inicializa e indica CP850', () => {
    expect(bytes([['A']]).slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x02]);
  });

  it('cada renglón termina en LF y entre tickets y al final hay 4 LF', () => {
    expect(bytes([['A'], ['B']])).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 0x02,
      0x41, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a,
      0x42, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a,
    ]);
  });

  it('un ticket real a 32 columnas da renglones de 32 bytes o menos', () => {
    const d: DatosTicket = {
      sucursal: 'Sucursal Tijuana Centro', folio: 'TJ261118JP05',
      momento: new Date(2026, 10, 18, 11, 58).toISOString(),
      cliente: 'Tienda Doña Chuy', atendio: 'María de Jesús Ramos', vendedor: 'Juan Pérez',
      renglones: [{ cantidad: 12, etiqueta: 'Jamaica 500 ml', precioCentavos: 1800, importeCentavos: 21600 }],
      promociones: [], totalCentavos: 21600, abonos: [], saldoCentavos: 0,
      reimpresion: null, detalleDisponible: true,
    };
    const lineas = armarTicket(d, 32);
    const out = bytes([lineas]);
    const cuerpo = out.slice(5);
    const renglones: number[][] = [];
    let actual: number[] = [];
    for (const b of cuerpo) {
      if (b === 0x0a) { renglones.push(actual); actual = []; } else actual.push(b);
    }
    expect(renglones.length).toBeGreaterThanOrEqual(lineas.length);
    for (const r of renglones) expect(r.length).toBeLessThanOrEqual(32);
    expect(out.every((b) => b >= 0 && b <= 255)).toBe(true);
  });
});
