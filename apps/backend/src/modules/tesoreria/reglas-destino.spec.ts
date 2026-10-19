import { destinoDe, type DestinoCobranza } from './reglas-destino';

const d = (
  id: string,
  sucursalId: string,
  metodo: DestinoCobranza['metodo'],
  cuentaId: string,
  desde: string,
): DestinoCobranza => ({
  id,
  sucursalId,
  sucursalCodigo: sucursalId === 'tj' ? 'TJ' : 'MX',
  metodo,
  cuentaId,
  cuentaNombre: cuentaId,
  desde,
});

describe('destinoDe', () => {
  const destinos = [
    d('1', 'tj', 'efectivo', 'efectivo-tj', '2026-10-01'),
    d('2', 'tj', 'efectivo', 'caja-tj', '2026-10-15'),
    d('3', 'tj', 'transferencia', 'scotia', '2026-10-01'),
    d('4', 'mx', 'efectivo', 'efectivo-mx', '2026-10-01'),
  ];

  it('sin destino para la sucursal y método, o antes de la primera vigencia, es null', () => {
    expect(destinoDe('tj', 'cheque', '2026-10-20', destinos)).toBeNull();
    expect(destinoDe('tj', 'efectivo', '2026-09-30', destinos)).toBeNull();
  });

  it('toma la vigencia más reciente con desde <= fecha', () => {
    expect(destinoDe('tj', 'efectivo', '2026-10-14', destinos)?.cuentaId).toBe(
      'efectivo-tj',
    );
    expect(destinoDe('tj', 'efectivo', '2026-10-15', destinos)?.cuentaId).toBe(
      'caja-tj',
    );
    expect(destinoDe('tj', 'efectivo', '2026-12-01', destinos)?.cuentaId).toBe(
      'caja-tj',
    );
  });

  it('no mezcla sucursales ni métodos', () => {
    expect(destinoDe('mx', 'efectivo', '2026-10-20', destinos)?.cuentaId).toBe(
      'efectivo-mx',
    );
    expect(
      destinoDe('tj', 'transferencia', '2026-10-20', destinos)?.cuentaId,
    ).toBe('scotia');
  });
});
