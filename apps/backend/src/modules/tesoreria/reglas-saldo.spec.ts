import {
  armarVista,
  esFechaValida,
  movimientosDeSaldo,
  ordenarCuentas,
  saldoDeCuenta,
  type BaseSaldo,
  type CuentaEnAlcance,
  type GastoDia,
  type MovimientoManual,
  type MovimientoSaldo,
  type SaldoFijado,
} from './reglas-saldo';
import type { CobranzaDia, DestinoCobranza } from './reglas-destino';

const base = (
  cuentaId: string,
  fecha: string,
  montoCentavos: number,
): BaseSaldo => ({
  cuentaId,
  fecha,
  montoCentavos,
});

const fijado = (
  id: string,
  cuentaId: string,
  fecha: string,
  montoCentavos: number,
  comentario: string | null = null,
): SaldoFijado => ({
  id,
  cuentaId,
  cuentaNombre: cuentaId === 'a' ? 'Efectivo TJ' : 'ScotiaFiscal',
  sucursalCodigo: cuentaId === 'a' ? 'TJ' : null,
  fecha,
  montoCentavos,
  comentario,
  capturo: 'Admin',
});

describe('esFechaValida', () => {
  it('acepta AAAA-MM-DD reales y rechaza lo demás', () => {
    expect(esFechaValida('2026-10-15')).toBe(true);
    expect(esFechaValida('2028-02-29')).toBe(true);
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('2026-1-5')).toBe(false);
    expect(esFechaValida('hoy')).toBe(false);
  });
});

describe('saldoDeCuenta', () => {
  const saldos = [
    base('a', '2026-10-01', 1_000_000),
    base('a', '2026-10-10', 950_000),
  ];

  it('sin saldo fijado en o antes de la fecha es null, no 0', () => {
    expect(saldoDeCuenta('a', '2026-09-30', 'inicio', saldos, [])).toBeNull();
    expect(saldoDeCuenta('a', '2026-09-30', 'final', saldos, [])).toBeNull();
    expect(saldoDeCuenta('otra', '2026-10-15', 'final', saldos, [])).toBeNull();
  });

  it('toma el saldo fijado más reciente con fecha <= D', () => {
    expect(saldoDeCuenta('a', '2026-10-05', 'inicio', saldos, [])).toBe(
      1_000_000,
    );
    expect(saldoDeCuenta('a', '2026-10-10', 'inicio', saldos, [])).toBe(
      950_000,
    );
    expect(saldoDeCuenta('a', '2026-10-12', 'final', saldos, [])).toBe(950_000);
  });

  it('el fijado vale al inicio de su día: los movimientos de ese día cuentan al final, no al inicio', () => {
    const movs: MovimientoSaldo[] = [
      { cuentaId: 'a', fecha: '2026-10-10', montoCentavos: 50_000 },
    ];
    expect(saldoDeCuenta('a', '2026-10-10', 'inicio', saldos, movs)).toBe(
      950_000,
    );
    expect(saldoDeCuenta('a', '2026-10-10', 'final', saldos, movs)).toBe(
      1_000_000,
    );
    expect(saldoDeCuenta('a', '2026-10-11', 'inicio', saldos, movs)).toBe(
      1_000_000,
    );
  });

  it('los movimientos anteriores al saldo fijado no cuentan (nuevo punto de partida)', () => {
    const movs: MovimientoSaldo[] = [
      { cuentaId: 'a', fecha: '2026-10-05', montoCentavos: -20_000 },
    ];
    expect(saldoDeCuenta('a', '2026-10-09', 'final', saldos, movs)).toBe(
      980_000,
    );
    expect(saldoDeCuenta('a', '2026-10-12', 'final', saldos, movs)).toBe(
      950_000,
    );
  });

  it('un saldo fijado el día siguiente no se cuela en el final de D', () => {
    const conManana = [...saldos, base('a', '2026-10-13', 1)];
    expect(saldoDeCuenta('a', '2026-10-12', 'final', conManana, [])).toBe(
      950_000,
    );
  });

  it('acepta montos negativos (sobregiro)', () => {
    expect(
      saldoDeCuenta(
        'b',
        '2026-10-02',
        'final',
        [base('b', '2026-10-01', -150_050)],
        [],
      ),
    ).toBe(-150_050);
  });
});

describe('ordenarCuentas', () => {
  it('generales primero, luego por código de sucursal y nombre sin importar mayúsculas', () => {
    const ordenadas = ordenarCuentas([
      { nombre: 'efectivo', sucursalCodigo: 'TJ' },
      { nombre: 'Caja Chica', sucursalCodigo: 'TJ' },
      { nombre: 'Efectivo', sucursalCodigo: 'MX' },
      { nombre: 'ScotiaFiscal', sucursalCodigo: null },
    ]);
    expect(
      ordenadas.map((c) => `${c.sucursalCodigo ?? '-'} ${c.nombre}`),
    ).toEqual([
      '- ScotiaFiscal',
      'MX Efectivo',
      'TJ Caja Chica',
      'TJ efectivo',
    ]);
  });
});

describe('armarVista', () => {
  const cuentas: CuentaEnAlcance[] = [
    {
      id: 'a',
      nombre: 'Efectivo TJ',
      sucursalId: 's-tj',
      sucursalCodigo: 'TJ',
    },
    { id: 'b', nombre: 'ScotiaFiscal', sucursalId: null, sucursalCodigo: null },
  ];

  it('el ejemplo del spec: inicio con el del 01, final con el del 10, eventos solo dentro del rango', () => {
    const v = armarVista('2026-10-05', '2026-10-12', cuentas, [
      fijado('s1', 'a', '2026-10-01', 1_000_000),
      fijado('s2', 'a', '2026-10-10', 950_000, 'Arqueo'),
    ]);
    expect(v.cuentas).toEqual([
      {
        id: 'b',
        nombre: 'ScotiaFiscal',
        sucursalCodigo: null,
        saldoInicioCentavos: null,
        saldoFinalCentavos: null,
        entradasCentavos: 0,
        salidasCentavos: 0,
        saldoFijadoEnRango: null,
      },
      {
        id: 'a',
        nombre: 'Efectivo TJ',
        sucursalCodigo: 'TJ',
        saldoInicioCentavos: 1_000_000,
        saldoFinalCentavos: 950_000,
        entradasCentavos: 0,
        salidasCentavos: 0,
        saldoFijadoEnRango: '2026-10-10',
      },
    ]);
    expect(v.total).toEqual({
      saldoInicioCentavos: 1_000_000,
      saldoFinalCentavos: 950_000,
      cuentasConSaldoInicio: 1,
      cuentasConSaldoFinal: 1,
      cuentas: 2,
      entradasCentavos: 0,
      salidasCentavos: 0,
    });
    expect(v.eventos).toEqual([
      {
        tipo: 'saldo-fijado',
        id: 's2',
        fecha: '2026-10-10',
        cuentaId: 'a',
        cuentaNombre: 'Efectivo TJ',
        montoCentavos: 950_000,
        comentario: 'Arqueo',
        capturo: 'Admin',
      },
    ]);
  });

  it('un fijado el mismo día que desde es evento y es el saldo al inicio', () => {
    const v = armarVista('2026-10-05', '2026-10-05', cuentas, [
      fijado('s1', 'b', '2026-10-05', 300_000),
    ]);
    expect(v.cuentas.find((c) => c.id === 'b')).toMatchObject({
      saldoInicioCentavos: 300_000,
      saldoFinalCentavos: 300_000,
    });
    expect(v.eventos.map((e) => e.id)).toEqual(['s1']);
  });

  it('el total cuenta por separado las cuentas con saldo al inicio y al final', () => {
    const v = armarVista('2026-10-01', '2026-10-31', cuentas, [
      fijado('s1', 'a', '2026-09-01', 10_000),
      fijado('s2', 'b', '2026-10-20', -2_500),
    ]);
    expect(v.total).toEqual({
      saldoInicioCentavos: 10_000,
      saldoFinalCentavos: 7_500,
      cuentasConSaldoInicio: 1,
      cuentasConSaldoFinal: 2,
      cuentas: 2,
      entradasCentavos: 0,
      salidasCentavos: 0,
    });
  });

  it('eventos por fecha y luego por nombre de cuenta', () => {
    const v = armarVista('2026-10-01', '2026-10-31', cuentas, [
      fijado('x', 'a', '2026-10-20', 1),
      fijado('y', 'b', '2026-10-03', 1),
      fijado('z', 'b', '2026-10-20', 1),
    ]);
    expect(v.eventos.map((e) => e.id)).toEqual(['y', 'x', 'z']);
  });

  it('sin cuentas, todo en cero', () => {
    expect(armarVista('2026-10-01', '2026-10-01', [], []).total).toEqual({
      saldoInicioCentavos: 0,
      saldoFinalCentavos: 0,
      cuentasConSaldoInicio: 0,
      cuentasConSaldoFinal: 0,
      cuentas: 0,
      entradasCentavos: 0,
      salidasCentavos: 0,
    });
  });
});

const manual = (
  id: string,
  tipo: MovimientoManual['tipo'],
  fecha: string,
  montoCentavos: number,
  cuentaId: string,
  cuentaDestinoId: string | null = null,
): MovimientoManual => ({
  id,
  tipo,
  fecha,
  montoCentavos,
  cuentaId,
  cuentaNombre:
    cuentaId === 'a'
      ? 'Efectivo TJ'
      : cuentaId === 'b'
        ? 'ScotiaFiscal'
        : cuentaId,
  cuentaDestinoId,
  cuentaDestinoNombre:
    cuentaDestinoId === 'b' ? 'ScotiaFiscal' : cuentaDestinoId,
  comentario: null,
  capturo: 'Ana',
});

const cobranza = (
  fecha: string,
  metodo: CobranzaDia['metodo'],
  montoCentavos: number,
  cantidad = 1,
  sucursal = 'tj',
): CobranzaDia => ({
  fecha,
  sucursalId: sucursal,
  sucursalCodigo: sucursal === 'tj' ? 'TJ' : 'MX',
  metodo,
  cantidad,
  montoCentavos,
});

const destino = (
  metodo: DestinoCobranza['metodo'],
  cuentaId: string,
  desde: string,
  sucursal = 'tj',
): DestinoCobranza => ({
  id: `${sucursal}-${metodo}-${desde}`,
  sucursalId: sucursal,
  sucursalCodigo: sucursal === 'tj' ? 'TJ' : 'MX',
  metodo,
  cuentaId,
  cuentaNombre: cuentaId === 'a' ? 'Efectivo TJ' : 'ScotiaFiscal',
  desde,
});

const gasto = (
  fecha: string,
  montoCentavos: number,
  cantidad = 1,
  sucursal = 'tj',
): GastoDia => ({
  fecha,
  sucursalId: sucursal,
  sucursalCodigo: sucursal === 'tj' ? 'TJ' : 'MX',
  cantidad,
  montoCentavos,
});

describe('movimientosDeSaldo', () => {
  it('depósito suma, retiro resta, traspaso resta en la de salida y suma en la de entrada', () => {
    const { movimientos } = movimientosDeSaldo(
      [
        manual('1', 'deposito', '2026-10-02', 500, 'a'),
        manual('2', 'retiro', '2026-10-03', 200, 'a'),
        manual('3', 'traspaso', '2026-10-04', 300, 'a', 'b'),
      ],
      [],
      [],
    );
    expect(movimientos).toEqual([
      { cuentaId: 'a', fecha: '2026-10-02', montoCentavos: 500 },
      { cuentaId: 'a', fecha: '2026-10-03', montoCentavos: -200 },
      { cuentaId: 'a', fecha: '2026-10-04', montoCentavos: -300 },
      { cuentaId: 'b', fecha: '2026-10-04', montoCentavos: 300 },
    ]);
  });

  it('la cobranza suma a la cuenta destino vigente en su fecha; sin destino va a sinDestino', () => {
    const { movimientos, sinDestino } = movimientosDeSaldo(
      [],
      [
        cobranza('2026-10-05', 'efectivo', 1000, 3),
        cobranza('2026-10-05', 'cheque', 700),
      ],
      [destino('efectivo', 'a', '2026-10-01')],
    );
    expect(movimientos).toEqual([
      { cuentaId: 'a', fecha: '2026-10-05', montoCentavos: 1000 },
    ]);
    expect(sinDestino).toEqual([cobranza('2026-10-05', 'cheque', 700)]);
  });

  it('un cambio de destino con desde no mueve la cobranza anterior', () => {
    const { movimientos } = movimientosDeSaldo(
      [],
      [
        cobranza('2026-10-14', 'efectivo', 100),
        cobranza('2026-10-15', 'efectivo', 200),
      ],
      [
        destino('efectivo', 'a', '2026-10-01'),
        destino('efectivo', 'b', '2026-10-15'),
      ],
    );
    expect(movimientos).toEqual([
      { cuentaId: 'a', fecha: '2026-10-14', montoCentavos: 100 },
      { cuentaId: 'b', fecha: '2026-10-15', montoCentavos: 200 },
    ]);
  });
});

describe('armarVista con movimientos (T-29)', () => {
  const cuentas: CuentaEnAlcance[] = [
    {
      id: 'a',
      nombre: 'Efectivo TJ',
      sucursalId: 's-tj',
      sucursalCodigo: 'TJ',
    },
    { id: 'b', nombre: 'ScotiaFiscal', sucursalId: null, sucursalCodigo: null },
  ];
  const saldosBase = [
    fijado('s1', 'a', '2026-10-01', 100_000),
    fijado('s2', 'b', '2026-10-01', 500_000),
  ];

  it('entradas, salidas y saldo final con depósito, retiro, traspaso y cobranza', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      manuales: [
        manual('m1', 'deposito', '2026-10-03', 5_000, 'a'),
        manual('m2', 'retiro', '2026-10-04', 2_000, 'a'),
        manual('m3', 'traspaso', '2026-10-05', 50_000, 'a', 'b'),
      ],
      cobranza: [cobranza('2026-10-06', 'efectivo', 30_000, 4)],
      destinos: [destino('efectivo', 'a', '2026-10-01')],
    });
    const a = v.cuentas.find((c) => c.id === 'a')!;
    expect(a).toMatchObject({
      saldoInicioCentavos: 100_000,
      entradasCentavos: 35_000,
      salidasCentavos: 52_000,
      saldoFinalCentavos: 83_000,
      saldoFijadoEnRango: null,
    });
    const b = v.cuentas.find((c) => c.id === 'b')!;
    expect(b).toMatchObject({
      entradasCentavos: 50_000,
      salidasCentavos: 0,
      saldoFinalCentavos: 550_000,
    });
    expect(v.total).toMatchObject({
      entradasCentavos: 85_000,
      salidasCentavos: 52_000,
    });
  });

  it('los eventos del rango: manuales y cobranza agrupada, ordenados por fecha', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      manuales: [manual('m3', 'traspaso', '2026-10-05', 50_000, 'a', 'b')],
      cobranza: [cobranza('2026-10-03', 'efectivo', 30_000, 4)],
      destinos: [destino('efectivo', 'a', '2026-10-01')],
    });
    expect(v.eventos.map((e) => e.tipo)).toEqual(['cobranza', 'traspaso']);
    expect(v.eventos[0]).toEqual({
      tipo: 'cobranza',
      id: 'cobranza:2026-10-03:a:tj:efectivo',
      fecha: '2026-10-03',
      cuentaId: 'a',
      cuentaNombre: 'Efectivo TJ',
      sucursalCodigo: 'TJ',
      metodo: 'efectivo',
      cantidad: 4,
      montoCentavos: 30_000,
    });
    expect(v.eventos[1]).toMatchObject({
      tipo: 'traspaso',
      cuentaNombre: 'Efectivo TJ',
      cuentaDestinoNombre: 'ScotiaFiscal',
    });
  });

  it('un saldo fijado dentro del rango: solo cuentan los movimientos desde él y la fila lo marca', () => {
    const v = armarVista(
      '2026-10-02',
      '2026-10-31',
      cuentas,
      [...saldosBase, fijado('s3', 'a', '2026-10-10', 70_000)],
      {
        manuales: [
          manual('m1', 'deposito', '2026-10-05', 9_000, 'a'),
          manual('m2', 'deposito', '2026-10-12', 1_000, 'a'),
        ],
      },
    );
    expect(v.cuentas.find((c) => c.id === 'a')).toMatchObject({
      saldoInicioCentavos: 100_000,
      entradasCentavos: 1_000,
      saldoFinalCentavos: 71_000,
      saldoFijadoEnRango: '2026-10-10',
    });
  });

  it('cobranza sin destino del rango y de sucursales en alcance va a sinCuenta, sumada por sucursal y método', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      cobranza: [
        cobranza('2026-10-03', 'cheque', 700, 1),
        cobranza('2026-10-04', 'cheque', 300, 1),
        cobranza('2026-09-30', 'cheque', 999, 1),
        cobranza('2026-10-04', 'efectivo', 50, 1, 'mx'),
      ],
      destinos: [],
      sucursalesEnAlcance: ['TJ'],
    });
    expect(v.sinCuenta).toEqual([
      { sucursalCodigo: 'TJ', metodo: 'cheque', montoCentavos: 1_000 },
    ]);
  });

  it('sin extras, los campos nuevos quedan en cero y vacíos', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase);
    expect(v.cuentas[0]).toMatchObject({
      entradasCentavos: 0,
      salidasCentavos: 0,
      saldoFijadoEnRango: null,
    });
    expect(v.sinCuenta).toEqual([]);
    expect(v.total).toMatchObject({ entradasCentavos: 0, salidasCentavos: 0 });
  });
});

describe('movimientosDeSaldo con gastos de la ruta (T-30/T-31, D7)', () => {
  it('el gasto resta de la cuenta destino del EFECTIVO de su sucursal; el destino de cheque no cuenta', () => {
    const { movimientos, gastosSinCuenta } = movimientosDeSaldo(
      [],
      [],
      [
        destino('efectivo', 'a', '2026-10-01'),
        destino('cheque', 'b', '2026-10-01'),
      ],
      [gasto('2026-10-05', 33_050, 2)],
    );
    expect(movimientos).toEqual([
      { cuentaId: 'a', fecha: '2026-10-05', montoCentavos: -33_050 },
    ]);
    expect(gastosSinCuenta).toEqual([]);
  });

  it('sin destino de efectivo vigente, el gasto va a gastosSinCuenta y no se pierde', () => {
    const { movimientos, gastosSinCuenta } = movimientosDeSaldo(
      [],
      [],
      [destino('efectivo', 'a', '2026-10-10')],
      [gasto('2026-10-05', 1_234), gasto('2026-10-05', 500, 1, 'mx')],
    );
    expect(movimientos).toEqual([]);
    expect(gastosSinCuenta).toEqual([
      gasto('2026-10-05', 1_234),
      gasto('2026-10-05', 500, 1, 'mx'),
    ]);
  });

  it('varios dias y un cambio de destino: cada dia va a la cuenta vigente en su fecha', () => {
    const { movimientos } = movimientosDeSaldo(
      [],
      [],
      [
        destino('efectivo', 'a', '2026-10-01'),
        destino('efectivo', 'b', '2026-10-15'),
      ],
      [gasto('2026-10-14', 100), gasto('2026-10-15', 200)],
    );
    expect(movimientos).toEqual([
      { cuentaId: 'a', fecha: '2026-10-14', montoCentavos: -100 },
      { cuentaId: 'b', fecha: '2026-10-15', montoCentavos: -200 },
    ]);
  });

  it('sin el cuarto argumento se comporta como T-29', () => {
    const r = movimientosDeSaldo([], [], []);
    expect(r).toEqual({ movimientos: [], sinDestino: [], gastosSinCuenta: [] });
  });
});

describe('armarVista con gastos de la ruta (T-30/T-31, D7)', () => {
  const cuentas: CuentaEnAlcance[] = [
    {
      id: 'a',
      nombre: 'Efectivo TJ',
      sucursalId: 's-tj',
      sucursalCodigo: 'TJ',
    },
    { id: 'b', nombre: 'ScotiaFiscal', sucursalId: null, sucursalCodigo: null },
  ];
  const saldosBase = [
    fijado('s1', 'a', '2026-10-01', 100_000),
    fijado('s2', 'b', '2026-10-01', 500_000),
  ];

  it('el gasto es salida de la cuenta de efectivo, resta del saldo final y la cobranza sigue sumando', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      cobranza: [cobranza('2026-10-05', 'efectivo', 50_000, 3)],
      destinos: [destino('efectivo', 'a', '2026-10-01')],
      gastos: [gasto('2026-10-05', 33_050, 2), gasto('2026-10-06', 1_000)],
    });
    expect(v.cuentas.find((c) => c.id === 'a')).toMatchObject({
      saldoInicioCentavos: 100_000,
      entradasCentavos: 50_000,
      salidasCentavos: 34_050,
      saldoFinalCentavos: 115_950,
    });
    expect(v.total).toMatchObject({
      entradasCentavos: 50_000,
      salidasCentavos: 34_050,
    });
    expect(v.gastosSinCuenta).toEqual([]);
  });

  it('un gasto anterior al rango cuenta en el saldo al inicio, no en las salidas', () => {
    const v = armarVista('2026-10-10', '2026-10-31', cuentas, saldosBase, {
      destinos: [destino('efectivo', 'a', '2026-10-01')],
      gastos: [gasto('2026-10-05', 20_000)],
    });
    expect(v.cuentas.find((c) => c.id === 'a')).toMatchObject({
      saldoInicioCentavos: 80_000,
      salidasCentavos: 0,
      saldoFinalCentavos: 80_000,
    });
    expect(v.eventos.some((e) => e.tipo === 'gasto-ruta')).toBe(false);
  });

  it('el evento "gasto-ruta" agrupa el dia y la sucursal, con monto positivo', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      destinos: [destino('efectivo', 'a', '2026-10-01')],
      gastos: [gasto('2026-10-05', 33_050, 2)],
    });
    expect(v.eventos).toEqual([
      {
        tipo: 'gasto-ruta',
        id: 'gasto-ruta:2026-10-05:a:tj',
        fecha: '2026-10-05',
        cuentaId: 'a',
        cuentaNombre: 'Efectivo TJ',
        sucursalCodigo: 'TJ',
        cantidad: 2,
        montoCentavos: 33_050,
      },
    ]);
  });

  it('si la cuenta destino no esta en alcance no hay evento, pero tampoco es "sin cuenta"', () => {
    const v = armarVista(
      '2026-10-02',
      '2026-10-31',
      [cuentas[1]],
      [saldosBase[1]],
      {
        destinos: [destino('efectivo', 'a', '2026-10-01')],
        gastos: [gasto('2026-10-05', 33_050, 2)],
      },
    );
    expect(v.eventos).toEqual([]);
    expect(v.gastosSinCuenta).toEqual([]);
  });

  it('gastos sin cuenta: solo del rango y de sucursales en alcance, sumados por sucursal', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      destinos: [],
      gastos: [
        gasto('2026-10-03', 25_050),
        gasto('2026-10-04', 8_000),
        gasto('2026-09-30', 999),
        gasto('2026-10-04', 1_234, 1, 'mx'),
      ],
      sucursalesEnAlcance: ['TJ'],
    });
    expect(v.gastosSinCuenta).toEqual([
      { sucursalCodigo: 'TJ', montoCentavos: 33_050 },
    ]);
    expect(v.cuentas.find((c) => c.id === 'a')?.salidasCentavos).toBe(0);
  });

  it('un General (sin filtro de sucursales) ve los gastos sin cuenta de todas, ordenados por codigo', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      gastos: [gasto('2026-10-04', 1_234, 1, 'mx'), gasto('2026-10-04', 100)],
    });
    expect(v.gastosSinCuenta).toEqual([
      { sucursalCodigo: 'MX', montoCentavos: 1_234 },
      { sucursalCodigo: 'TJ', montoCentavos: 100 },
    ]);
  });

  it('sin gastos, gastosSinCuenta es [] y no hay eventos de gasto', () => {
    const v = armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase, {
      cobranza: [cobranza('2026-10-05', 'efectivo', 1_000)],
      destinos: [destino('efectivo', 'a', '2026-10-01')],
    });
    expect(v.gastosSinCuenta).toEqual([]);
    expect(v.eventos.map((e) => e.tipo)).toEqual(['cobranza']);
    expect(
      armarVista('2026-10-02', '2026-10-31', cuentas, saldosBase)
        .gastosSinCuenta,
    ).toEqual([]);
  });
});
