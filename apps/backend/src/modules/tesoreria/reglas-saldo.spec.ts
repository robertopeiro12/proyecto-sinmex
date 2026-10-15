import {
  armarVista,
  esFechaValida,
  ordenarCuentas,
  saldoDeCuenta,
  type BaseSaldo,
  type CuentaEnAlcance,
  type MovimientoSaldo,
  type SaldoFijado,
} from './reglas-saldo';

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
      },
      {
        id: 'a',
        nombre: 'Efectivo TJ',
        sucursalCodigo: 'TJ',
        saldoInicioCentavos: 1_000_000,
        saldoFinalCentavos: 950_000,
      },
    ]);
    expect(v.total).toEqual({
      saldoInicioCentavos: 1_000_000,
      saldoFinalCentavos: 950_000,
      cuentasConSaldoInicio: 1,
      cuentasConSaldoFinal: 1,
      cuentas: 2,
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
    });
  });
});
