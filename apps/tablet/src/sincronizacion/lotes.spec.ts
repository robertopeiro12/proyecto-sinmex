import type { OperacionSaliente } from './contrato';
import { trocearLotes } from './lotes';

/** Una operacion con `datos` del tamano que se pida, para medir en bytes. */
function op(clave: string, relleno = 0): OperacionSaliente {
  return {
    clave,
    tipo: 'venta',
    fecha_operacion: '2026-08-07',
    ocurrido_en: '2026-08-07T15:00:00.000Z',
    datos: relleno > 0 ? { comentarios: 'c'.repeat(relleno) } : {},
  };
}

const bytes = (o: OperacionSaliente) =>
  new TextEncoder().encode(JSON.stringify(o)).length;

describe('trocearLotes', () => {
  it('sin operaciones no hay lotes (y el motor no llama al servidor)', () => {
    expect(trocearLotes([], { maxOperaciones: 500, maxBytes: 1000 })).toEqual([]);
  });

  it('corta por cantidad cuando las operaciones son chicas', () => {
    const ops = Array.from({ length: 7 }, (_, i) => op(`op-${i}`));
    const lotes = trocearLotes(ops, { maxOperaciones: 3, maxBytes: 1_000_000 });

    expect(lotes.map((l) => l.length)).toEqual([3, 3, 1]);
  });

  it('corta por bytes antes que por cantidad', () => {
    // Cabrian 10 por cantidad, pero solo 2 por tamano: el tope de bytes es el
    // que decide. Es el caso de IMPORTANT-1: 500 ventas caben por cantidad y
    // pesan mas de lo que el servidor acepta.
    const ops = Array.from({ length: 6 }, (_, i) => op(`op-${i}`, 200));
    const maxBytes = bytes(op('op-0', 200)) * 2 + 1;

    const lotes = trocearLotes(ops, { maxOperaciones: 10, maxBytes });

    expect(lotes.map((l) => l.length)).toEqual([2, 2, 2]);
    for (const lote of lotes) {
      const peso = lote.reduce((suma, o) => suma + bytes(o), 0);
      expect(peso).toBeLessThanOrEqual(maxBytes);
    }
  });

  it('una operacion mas grande que el tope va sola, nunca se descarta', () => {
    // Descartarla seria perder una venta capturada. Va sola y que el servidor
    // decida: su limite es cinco veces mayor que el de la tablet.
    const ops = [op('chica-1', 10), op('gigante', 5_000), op('chica-2', 10)];

    const lotes = trocearLotes(ops, { maxOperaciones: 10, maxBytes: 500 });

    expect(lotes.map((l) => l.map((o) => o.clave))).toEqual([
      ['chica-1'],
      ['gigante'],
      ['chica-2'],
    ]);
  });

  it('conserva el orden y no pierde ni repite ninguna operacion', () => {
    const ops = Array.from({ length: 25 }, (_, i) => op(`op-${i}`, i * 40));

    const lotes = trocearLotes(ops, { maxOperaciones: 4, maxBytes: 900 });

    expect(lotes.flat()).toEqual(ops);
  });
});
