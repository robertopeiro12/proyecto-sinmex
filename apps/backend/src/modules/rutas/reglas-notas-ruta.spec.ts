import { armarNotasDeRuta, type NotaDeRuta } from './reglas-notas-ruta';

const A = { vendedorId: 'va', nombre: 'Ana' };
const B = { vendedorId: 'vb', nombre: 'Beto' };

function nota(
  folio: string,
  clienteId: string,
  extra: Partial<NotaDeRuta> = {},
): NotaDeRuta {
  return {
    ventaNotaId: `id-${folio}`,
    folio,
    clienteId,
    cliente: `Cliente ${clienteId}`,
    fecha: '2026-10-01',
    saldoCentavos: 10_000,
    diasAtraso: 0,
    asignadaA: null,
    ...extra,
  };
}

describe('armarNotasDeRuta', () => {
  it('ordena las pendientes por el orden de la ruta, luego fecha y folio', () => {
    const notas = [
      nota('F3', 'c1', { fecha: '2026-10-05' }),
      nota('F2', 'c2'),
      nota('F1', 'c1', { fecha: '2026-10-05' }),
      nota('F0', 'c1', { fecha: '2026-10-01' }),
    ];
    const r = armarNotasDeRuta(['c2', 'c1'], notas, 'va');
    expect(r.pendientes.map((n) => n.folio)).toEqual(['F2', 'F0', 'F1', 'F3']);
  });

  it('una nota de un cliente fuera de la ruta no sale en pendientes', () => {
    const r = armarNotasDeRuta(['c1'], [nota('F1', 'c9')], 'va');
    expect(r.pendientes).toEqual([]);
  });

  it('una asignada sin saldo sale en asignadas y no en pendientes', () => {
    const pagada = nota('F1', 'c1', { saldoCentavos: 0, asignadaA: A });
    const r = armarNotasDeRuta(['c1'], [pagada], 'va');
    expect(r.pendientes).toEqual([]);
    expect(r.asignadas).toEqual([pagada]);
  });

  it('una asignada a otro sale en pendientes con asignadaA y no en asignadas', () => {
    const deBeto = nota('F1', 'c1', { asignadaA: B });
    const r = armarNotasDeRuta(['c1'], [deBeto], 'va');
    expect(r.pendientes).toEqual([deBeto]);
    expect(r.asignadas).toEqual([]);
  });

  it('una asignada a este vendedor con saldo sale en las dos listas', () => {
    const mia = nota('F1', 'c1', { asignadaA: A });
    const r = armarNotasDeRuta(['c1'], [mia], 'va');
    expect(r.pendientes).toEqual([mia]);
    expect(r.asignadas).toEqual([mia]);
  });

  it('las asignadas van por el orden de la ruta, luego fecha y folio; las de un cliente fuera de ruta al final', () => {
    const notas = [
      nota('F9', 'c9', { asignadaA: A, saldoCentavos: 0 }),
      nota('F2', 'c2', { asignadaA: A }),
      nota('F1', 'c1', { asignadaA: A }),
    ];
    const r = armarNotasDeRuta(['c1', 'c2'], notas, 'va');
    expect(r.asignadas.map((n) => n.folio)).toEqual(['F1', 'F2', 'F9']);
  });
});
