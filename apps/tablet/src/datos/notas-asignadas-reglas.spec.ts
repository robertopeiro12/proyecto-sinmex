import {
  cumpleCondicion,
  diasDeAtraso,
  ETIQUETA_CONDICION,
  motivoBloqueoVenta,
  porAtender,
  type NotaAsignadaDeHoy,
} from './notas-asignadas-reglas';

const nota = (cambios: Partial<NotaAsignadaDeHoy> = {}): NotaAsignadaDeHoy => ({
  asignacionId: 'asg-1',
  ventaNotaId: 'nota-1',
  clienteId: 'cli-1',
  folio: 'TJ260801AP01',
  fecha: '2026-08-01',
  saldoCentavos: 15000,
  diasAtraso: 0,
  condicion: 'ninguna',
  tocadaHoy: false,
  comentadaHoy: false,
  ...cambios,
});

const LIQUIDAR = 'Tiene una nota asignada que debe liquidar antes de venderle';
const ABONAR = 'Tiene una nota asignada que debe abonar antes de venderle';

describe('diasDeAtraso', () => {
  it('cuenta desde el vencimiento (fecha + plazo)', () => {
    expect(diasDeAtraso('2026-08-01', 7, '2026-08-13')).toBe(5);
    // Cruza de mes.
    expect(diasDeAtraso('2026-07-28', 3, '2026-08-02')).toBe(2);
  });

  it('sin plazo vence el mismo dia de la nota', () => {
    expect(diasDeAtraso('2026-08-01', null, '2026-08-07')).toBe(6);
    expect(diasDeAtraso('2026-08-07', null, '2026-08-07')).toBe(0);
  });

  it('nunca es negativo', () => {
    expect(diasDeAtraso('2026-08-05', 7, '2026-08-07')).toBe(0);
  });
});

describe('cumpleCondicion', () => {
  it('ninguna siempre cumple', () => {
    expect(cumpleCondicion(nota({ condicion: 'ninguna' }))).toBe(true);
  });

  it('liquidar solo con saldo 0; un abono de hoy no basta', () => {
    expect(cumpleCondicion(nota({ condicion: 'liquidar' }))).toBe(false);
    expect(cumpleCondicion(nota({ condicion: 'liquidar', tocadaHoy: true }))).toBe(false);
    expect(cumpleCondicion(nota({ condicion: 'liquidar', saldoCentavos: 0 }))).toBe(true);
  });

  it('abonar con un cobro de hoy o con saldo 0; el comentario no cumple', () => {
    expect(cumpleCondicion(nota({ condicion: 'abonar' }))).toBe(false);
    expect(cumpleCondicion(nota({ condicion: 'abonar', comentadaHoy: true }))).toBe(false);
    expect(cumpleCondicion(nota({ condicion: 'abonar', tocadaHoy: true }))).toBe(true);
    expect(cumpleCondicion(nota({ condicion: 'abonar', saldoCentavos: 0 }))).toBe(true);
  });
});

describe('porAtender', () => {
  it('deja la comentada sin cobrar y saca la tocada hoy y la de saldo 0', () => {
    const comentada = nota({ asignacionId: 'a', comentadaHoy: true });
    const tocada = nota({ asignacionId: 'b', tocadaHoy: true });
    const pagada = nota({ asignacionId: 'c', saldoCentavos: 0 });
    const intacta = nota({ asignacionId: 'd' });
    expect(porAtender([comentada, tocada, pagada, intacta]).map((n) => n.asignacionId)).toEqual(['a', 'd']);
  });
});

describe('motivoBloqueoVenta', () => {
  it('con liquidar y abonar sin cumplir gana el de liquidar', () => {
    expect(
      motivoBloqueoVenta([nota({ condicion: 'abonar' }), nota({ condicion: 'liquidar', ventaNotaId: 'nota-2' })]),
    ).toBe(LIQUIDAR);
  });

  it('solo abonar sin cumplir da el de abonar', () => {
    expect(motivoBloqueoVenta([nota({ condicion: 'abonar' }), nota({ condicion: 'ninguna' })])).toBe(ABONAR);
  });

  it('con todo cumplido (o sin notas) da null', () => {
    expect(
      motivoBloqueoVenta([
        nota({ condicion: 'liquidar', saldoCentavos: 0 }),
        nota({ condicion: 'abonar', tocadaHoy: true }),
        nota({ condicion: 'ninguna' }),
      ]),
    ).toBeNull();
    expect(motivoBloqueoVenta([])).toBeNull();
  });
});

describe('ETIQUETA_CONDICION', () => {
  it('nombra la condicion en pantalla; ninguna no dice nada', () => {
    expect(ETIQUETA_CONDICION).toEqual({ ninguna: null, liquidar: 'Debe liquidar', abonar: 'Debe abonar' });
  });
});
