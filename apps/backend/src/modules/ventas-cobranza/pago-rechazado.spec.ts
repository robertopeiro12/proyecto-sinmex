import {
  MOTIVO_NOTA_AJENA,
  PagoRechazado,
  formatearPesos,
  motivoExcedeLoQueDeben,
  motivoFechaAnterior,
  motivoNotaSinSaldo,
  motivoSaldoFavorInsuficiente,
} from './pago-rechazado';

describe('formatearPesos', () => {
  it('pone signo de pesos, comas de miles y dos decimales, sin coma flotante', () => {
    expect(formatearPesos(150000)).toBe('$1,500.00');
    expect(formatearPesos(5)).toBe('$0.05');
    expect(formatearPesos(123456789)).toBe('$1,234,567.89');
    expect(formatearPesos(-3000)).toBe('-$30.00');
  });
});

describe('mensajes del pago (T-21)', () => {
  it('son los del spec, palabra por palabra', () => {
    expect(motivoNotaSinSaldo('TJ261001AP03')).toBe(
      'La nota TJ261001AP03 ya no tiene saldo; vuelve a cargar.',
    );
    expect(MOTIVO_NOTA_AJENA).toBe(
      'Una de las notas marcadas no es de este cliente o ya no existe; vuelve a cargar.',
    );
    expect(motivoFechaAnterior('2026-10-01')).toBe(
      'La fecha del pago no puede ser anterior a la nota más vieja que marcaste (2026-10-01).',
    );
    expect(motivoSaldoFavorInsuficiente(15000)).toBe(
      'El cliente solo tiene $150.00 de saldo a favor.',
    );
    expect(motivoExcedeLoQueDeben(8000)).toBe(
      'Las notas marcadas solo deben $80.00: no se puede aplicar más saldo a favor que eso.',
    );
  });

  it('PagoRechazado lleva su razon y el mensaje', () => {
    const e = new PagoRechazado('nota-ajena', MOTIVO_NOTA_AJENA);
    expect(e).toBeInstanceOf(Error);
    expect(e.razon).toBe('nota-ajena');
    expect(e.message).toBe(MOTIVO_NOTA_AJENA);
  });
});
