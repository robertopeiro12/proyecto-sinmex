import {
  MAX_DIAS_RANGO,
  armarReporte,
  validarRango,
  type FilaJornada,
} from './reglas-kilometraje';

const fila = (extra: Partial<FilaJornada>): FilaJornada => ({
  jornadaId: 'j',
  vehiculoId: 'v-a',
  vehiculoNombre: 'Nissan-01',
  placas: 'ABC-123',
  vehiculoActivo: true,
  fecha: '2026-10-01',
  vendedor: 'Juan Pérez',
  kmInicialDecimas: 100000,
  kmFinalDecimas: 102500,
  kmFinalAnteriorDecimas: null,
  fechaAnterior: null,
  ...extra,
});

describe('validarRango', () => {
  it('acepta un rango normal', () => {
    expect(validarRango('2026-10-01', '2026-10-13')).toBeNull();
  });

  it('rechaza fechas que no existen', () => {
    expect(validarRango('2026-02-30', '2026-03-01')).toBe(
      'La fecha "desde" no es una fecha válida.',
    );
    expect(validarRango('2026-03-01', '2026-13-01')).toBe(
      'La fecha "hasta" no es una fecha válida.',
    );
  });

  it('rechaza años anteriores a 1900 (Postgres truena con el año 0000)', () => {
    expect(validarRango('0000-01-01', '2026-03-01')).toBe(
      'La fecha "desde" no es una fecha válida.',
    );
    expect(validarRango('1899-12-31', '2026-03-01')).toBe(
      'La fecha "desde" no es una fecha válida.',
    );
    expect(validarRango('2026-03-01', '0001-01-01')).toBe(
      'La fecha "hasta" no es una fecha válida.',
    );
    expect(validarRango('1900-01-01', '1900-01-31')).toBeNull();
  });

  it('rechaza desde posterior a hasta', () => {
    expect(validarRango('2026-10-13', '2026-10-01')).toBe(
      'La fecha "desde" no puede ser posterior a "hasta".',
    );
  });

  it(`acepta ${MAX_DIAS_RANGO} días contando ambos extremos (con bisiesto) y rechaza uno más`, () => {
    // 2024 es bisiesto: del 1 de enero al 31 de diciembre son 366 días.
    expect(validarRango('2024-01-01', '2024-12-31')).toBeNull();
    expect(validarRango('2024-01-01', '2025-01-01')).toBe(
      'El rango no puede pasar de un año.',
    );
  });
});

describe('armarReporte', () => {
  it('sin filas da un reporte vacío con totales en 0', () => {
    expect(armarReporte('2026-10-01', '2026-10-13', [])).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-13',
      vehiculos: [],
      totalKilometrosDecimas: 0,
      totalSaltoDecimas: 0,
    });
  });

  it('calcula kilómetros y el salto contra la anterior (Review Focus 1: aunque sea de antes del rango)', () => {
    const reporte = armarReporte('2026-10-02', '2026-10-13', [
      fila({
        jornadaId: 'j1',
        fecha: '2026-10-02',
        kmInicialDecimas: 104000,
        kmFinalDecimas: 105200,
        // La anterior (01/10) quedó fuera del rango: el SQL la trae igual.
        kmFinalAnteriorDecimas: 102505,
        fechaAnterior: '2026-10-01',
      }),
      fila({
        jornadaId: 'j2',
        fecha: '2026-10-03',
        vendedor: 'Pedro López',
        kmInicialDecimas: 105200,
        kmFinalDecimas: 106000,
        kmFinalAnteriorDecimas: 105200,
        fechaAnterior: '2026-10-02',
      }),
    ]);

    expect(reporte.vehiculos).toHaveLength(1);
    const [v] = reporte.vehiculos;
    expect(v.jornadas).toEqual([
      {
        jornadaId: 'j1',
        fecha: '2026-10-02',
        vendedor: 'Juan Pérez',
        kmInicialDecimas: 104000,
        kmFinalDecimas: 105200,
        kilometrosDecimas: 1200,
        saltoDecimas: 1495,
        fechaAnterior: '2026-10-01',
      },
      {
        jornadaId: 'j2',
        fecha: '2026-10-03',
        vendedor: 'Pedro López',
        kmInicialDecimas: 105200,
        kmFinalDecimas: 106000,
        kilometrosDecimas: 800,
        saltoDecimas: 0,
        fechaAnterior: '2026-10-02',
      },
    ]);
    expect(v.totalKilometrosDecimas).toBe(2000);
    expect(v.totalSaltoDecimas).toBe(1495);
    expect(reporte.totalKilometrosDecimas).toBe(2000);
    expect(reporte.totalSaltoDecimas).toBe(1495);
  });

  it('sin jornada anterior el salto es null y no suma; un salto negativo resta', () => {
    const reporte = armarReporte('2026-10-01', '2026-10-13', [
      fila({ jornadaId: 'j1' }),
      fila({
        jornadaId: 'j2',
        fecha: '2026-10-02',
        kmInicialDecimas: 102200,
        kmFinalDecimas: 102800,
        kmFinalAnteriorDecimas: 102500,
        fechaAnterior: '2026-10-01',
      }),
    ]);
    const [v] = reporte.vehiculos;
    expect(v.jornadas.map((j) => j.saltoDecimas)).toEqual([null, -300]);
    expect(v.totalSaltoDecimas).toBe(-300);
  });

  it('agrupa por vehículo, ordena por nombre y luego placas, y conserva el orden de las jornadas', () => {
    const reporte = armarReporte('2026-10-01', '2026-10-13', [
      fila({
        jornadaId: 'z1',
        vehiculoId: 'v-z',
        vehiculoNombre: 'Zeta',
        placas: null,
      }),
      fila({
        jornadaId: 'a2',
        vehiculoId: 'v-a2',
        vehiculoNombre: 'Alfa',
        placas: 'BBB-2',
      }),
      fila({
        jornadaId: 'a1',
        vehiculoId: 'v-a1',
        vehiculoNombre: 'Alfa',
        placas: 'AAA-1',
        vehiculoActivo: false,
      }),
      fila({
        jornadaId: 'a1b',
        vehiculoId: 'v-a1',
        vehiculoNombre: 'Alfa',
        placas: 'AAA-1',
        vehiculoActivo: false,
        fecha: '2026-10-02',
      }),
    ]);
    expect(reporte.vehiculos.map((v) => [v.vehiculoId, v.activo])).toEqual([
      ['v-a1', false],
      ['v-a2', true],
      ['v-z', true],
    ]);
    expect(reporte.vehiculos[0].jornadas.map((j) => j.jornadaId)).toEqual([
      'a1',
      'a1b',
    ]);
    expect(reporte.vehiculos[0]).toMatchObject({
      nombre: 'Alfa',
      placas: 'AAA-1',
    });
  });
});
