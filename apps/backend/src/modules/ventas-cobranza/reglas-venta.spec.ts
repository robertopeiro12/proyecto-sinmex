import {
  mesDe,
  montoTotalCentavos,
  revisarLineas,
  semanaISO,
  statusInicial,
} from './reglas-venta';

describe('statusInicial (D4)', () => {
  it('contado nace pagada', () => {
    expect(statusInicial('contado', 32400)).toBe('pagada');
  });

  it('credito nace pendiente', () => {
    expect(statusInicial('credito', 32400)).toBe('pendiente');
  });

  it('una venta de $0 (solo piezas de promocion) es promocion, sea contado o credito', () => {
    expect(statusInicial('contado', 0)).toBe('promocion');
    expect(statusInicial('credito', 0)).toBe('promocion');
  });
});

describe('montoTotalCentavos (D14)', () => {
  it('suma cantidad x precio; las piezas de promocion no entran', () => {
    // La promocion ni siquiera se le pasa: la funcion no puede sumarla por error.
    expect(
      montoTotalCentavos([
        { cantidad: 24, precioCentavos: 1350 },
        { cantidad: 0, precioCentavos: 0 },
        { cantidad: 3, precioCentavos: 1010 },
      ]),
    ).toBe(35430);
  });

  it('sin lineas, el monto es 0', () => {
    expect(montoTotalCentavos([])).toBe(0);
  });
});

describe('semanaISO (D6)', () => {
  it.each<[string, number]>([
    ['2026-01-01', 1], // jueves: la semana 1 de 2026 lo contiene
    ['2026-01-04', 1], // domingo: todavia la semana 1
    ['2026-05-31', 22], // domingo, ultimo dia del mes
    ['2026-06-01', 23], // lunes: semana nueva y mes nuevo
    ['2026-08-01', 31], // el fixture `notaId` del e2e de sincronizacion
    ['2026-08-07', 32],
    ['2026-09-14', 38], // el ejemplo del contrato
    ['2027-01-01', 53], // viernes: ultima semana de 2026 (el caso del spec)
    ['2027-01-04', 1], // lunes: arranca la semana 1 de 2027
    ['2024-12-30', 1], // lunes de diciembre que ya es semana 1 del ano siguiente
    ['2021-01-03', 53], // domingo de enero que todavia es semana 53 de 2020
  ])('%s es la semana %i', (fecha, semana) => {
    expect(semanaISO(fecha)).toBe(semana);
  });
});

describe('mesDe', () => {
  it.each<[string, number]>([
    ['2026-09-14', 9],
    ['2026-12-31', 12],
    ['2027-01-01', 1],
  ])('%s es el mes %i', (fecha, mes) => {
    expect(mesDe(fecha)).toBe(mes);
  });
});

describe('revisarLineas (D12, D13)', () => {
  const precios = new Map<string, number | null>([
    ['pre-a', 1350],
    ['pre-sin-precio', null],
  ]);

  it('con presentaciones vendibles y precio donde hay cantidad, no hay rechazo', () => {
    expect(
      revisarLineas([{ presentacionId: 'pre-a', cantidad: 24 }], precios),
    ).toBeNull();
  });

  it('una presentacion fuera del catalogo vendible es presentacion-inactiva', () => {
    const r = revisarLineas(
      [
        { presentacionId: 'pre-a', cantidad: 1 },
        { presentacionId: 'pre-borrada', cantidad: 1 },
      ],
      precios,
    );
    expect(r?.razon).toBe('presentacion-inactiva');
    expect(r?.motivo).toContain('pre-borrada');
  });

  it('una linea con cantidad y sin precio para el cliente es precio-no-asignado', () => {
    const r = revisarLineas(
      [{ presentacionId: 'pre-sin-precio', cantidad: 2 }],
      precios,
    );
    expect(r?.razon).toBe('precio-no-asignado');
    expect(r?.motivo).toContain('pre-sin-precio');
  });

  it('regalar piezas de una presentacion sin precio si se puede (D13)', () => {
    expect(
      revisarLineas(
        [{ presentacionId: 'pre-sin-precio', cantidad: 0 }],
        precios,
      ),
    ).toBeNull();
  });

  it('la presentacion inactiva se reporta antes que un precio faltante en otra linea', () => {
    const r = revisarLineas(
      [
        { presentacionId: 'pre-sin-precio', cantidad: 2 },
        { presentacionId: 'pre-borrada', cantidad: 1 },
      ],
      precios,
    );
    expect(r?.razon).toBe('presentacion-inactiva');
  });
});
