import {
  armarCuentasPorCobrar,
  type FilaNotaPorCobrar,
} from './reglas-cuentas-por-cobrar';

const HOY = '2026-10-14';

const fila = (extra: Partial<FilaNotaPorCobrar>): FilaNotaPorCobrar => ({
  id: 'n1',
  clienteId: 'c1',
  cliente: 'Cobach XXI',
  sucursalCodigo: 'TJ',
  fecha: '2026-10-01',
  folio: 'TJ261001AP01',
  numNota: null,
  montoCentavos: 10000,
  abonadoCentavos: 0,
  status: 'pendiente',
  vence: null,
  diasAtraso: 0,
  ...extra,
});

describe('armarCuentasPorCobrar', () => {
  it('sin filas: todo en cero y sin clientes', () => {
    expect(armarCuentasPorCobrar(HOY, [], { soloVencidas: false })).toEqual({
      hoy: HOY,
      totalCentavos: 0,
      vencidoCentavos: 0,
      notas: 0,
      clientes: [],
    });
  });

  it('saldo = monto − abonado; vencido solo con dias de atraso', () => {
    const r = armarCuentasPorCobrar(
      HOY,
      [
        fila({
          id: 'a',
          abonadoCentavos: 3000,
          status: 'abonado',
          vence: '2026-09-28',
          diasAtraso: 16,
        }),
        fila({
          id: 'b',
          fecha: '2026-10-10',
          folio: 'TJ261010AP01',
          vence: '2026-10-25',
          diasAtraso: 0,
        }),
      ],
      { soloVencidas: false },
    );
    expect(r.totalCentavos).toBe(7000 + 10000);
    expect(r.vencidoCentavos).toBe(7000);
    expect(r.notas).toBe(2);
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0]).toMatchObject({
      clienteId: 'c1',
      cliente: 'Cobach XXI',
      sucursalCodigo: 'TJ',
      saldoCentavos: 17000,
      vencidoCentavos: 7000,
    });
    expect(r.clientes[0].notas.map((n) => [n.id, n.saldoCentavos])).toEqual([
      ['a', 7000],
      ['b', 10000],
    ]);
    // No viajan de mas: la nota no repite los datos del cliente.
    expect(Object.keys(r.clientes[0].notas[0]).sort()).toEqual(
      [
        'abonadoCentavos',
        'diasAtraso',
        'fecha',
        'folio',
        'id',
        'montoCentavos',
        'numNota',
        'saldoCentavos',
        'status',
        'vence',
      ].sort(),
    );
  });

  it('sin plazo nunca cuenta como vencida (Review Focus 1)', () => {
    const r = armarCuentasPorCobrar(
      HOY,
      [fila({ fecha: '2025-01-01', vence: null, diasAtraso: 0 })],
      { soloVencidas: false },
    );
    expect(r.vencidoCentavos).toBe(0);
    expect(
      armarCuentasPorCobrar(HOY, [fila({ vence: null })], {
        soloVencidas: true,
      }).clientes,
    ).toEqual([]);
  });

  it('una nota sin saldo (datos viejos con abonos de mas) no se lista', () => {
    const r = armarCuentasPorCobrar(
      HOY,
      [fila({ abonadoCentavos: 12000, status: 'abonado' })],
      { soloVencidas: false },
    );
    expect(r.notas).toBe(0);
    expect(r.clientes).toEqual([]);
  });

  it('soloVencidas filtra notas, quita al cliente sin vencidas y recalcula totales', () => {
    const r = armarCuentasPorCobrar(
      HOY,
      [
        fila({ id: 'a', vence: '2026-09-28', diasAtraso: 16 }),
        fila({
          id: 'b',
          fecha: '2026-10-10',
          vence: '2026-10-25',
          diasAtraso: 0,
        }),
        fila({
          id: 'c',
          clienteId: 'c2',
          cliente: 'El Moreno',
          vence: '2026-10-20',
          diasAtraso: 0,
        }),
      ],
      { soloVencidas: true },
    );
    expect(r.notas).toBe(1);
    expect(r.totalCentavos).toBe(10000);
    expect(r.vencidoCentavos).toBe(10000);
    expect(r.clientes.map((c) => c.clienteId)).toEqual(['c1']);
    expect(r.clientes[0].notas.map((n) => n.id)).toEqual(['a']);
  });

  it('ordena clientes por vencido, saldo y nombre; notas por fecha y folio', () => {
    const r = armarCuentasPorCobrar(
      HOY,
      [
        fila({
          id: 'x1',
          clienteId: 'x',
          cliente: 'Zeta',
          montoCentavos: 90000,
        }),
        fila({
          id: 'y1',
          clienteId: 'y',
          cliente: 'Ámbar',
          montoCentavos: 5000,
        }),
        fila({
          id: 'w1',
          clienteId: 'w',
          cliente: 'Beta',
          montoCentavos: 5000,
        }),
        fila({
          id: 'v2',
          clienteId: 'v',
          cliente: 'Vencido',
          fecha: '2026-09-02',
          folio: 'B',
          vence: '2026-09-02',
          diasAtraso: 42,
          montoCentavos: 100,
        }),
        fila({
          id: 'v1',
          clienteId: 'v',
          cliente: 'Vencido',
          fecha: '2026-09-02',
          folio: 'A',
          vence: '2026-09-02',
          diasAtraso: 42,
          montoCentavos: 100,
        }),
        fila({
          id: 'v0',
          clienteId: 'v',
          cliente: 'Vencido',
          fecha: '2026-09-01',
          folio: 'C',
          vence: '2026-09-01',
          diasAtraso: 43,
          montoCentavos: 100,
        }),
      ],
      { soloVencidas: false },
    );
    // Vencido primero aunque deba menos; luego por saldo; empate de saldo -> nombre (Á antes de B).
    expect(r.clientes.map((c) => c.cliente)).toEqual([
      'Vencido',
      'Zeta',
      'Ámbar',
      'Beta',
    ]);
    expect(r.clientes[0].notas.map((n) => n.id)).toEqual(['v0', 'v1', 'v2']);
  });
});
