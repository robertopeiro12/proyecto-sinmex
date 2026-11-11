import {
  armarDashboard,
  armarFlujoDiario,
  contarNotasNoEntregadas,
  fechaValidaDashboard,
  resumir,
  sumar,
  type FilaVendedorDia,
} from './reglas-flujo-diario';

const fila = (extra: Partial<FilaVendedorDia>): FilaVendedorDia => ({
  fecha: '2026-11-07',
  vendedorId: 'v1',
  vendedor: 'Vendedor',
  sucursalCodigo: 'TJ',
  clientesEnRuta: 0,
  atendidosEnRuta: 0,
  piezas: 0,
  montoCentavos: 0,
  contadoCentavos: 0,
  anterioresCentavos: 0,
  aFavorCentavos: 0,
  gastoCentavos: 0,
  jornadaCerrada: true,
  vehiculo: null,
  rutaNombre: null,
  vehiculoAsignado: null,
  notasNoEntregadas: null,
  ...extra,
});

describe('resumir', () => {
  it('suma contado, anteriores y a favor, y resta el gasto', () => {
    const r = resumir(
      fila({
        contadoCentavos: 64750,
        anterioresCentavos: 92250,
        gastoCentavos: 1000,
      }),
    );
    expect(r.cobranzaCentavos).toBe(157000);
    expect(r.tesoreriaCentavos).toBe(156000);
    expect(
      resumir(
        fila({
          contadoCentavos: 64750,
          anterioresCentavos: 92250,
          aFavorCentavos: 5000,
          gastoCentavos: 1000,
        }),
      ).cobranzaCentavos,
    ).toBe(162000);
  });

  it('el estatus depende solo de la jornada', () => {
    expect(resumir(fila({ jornadaCerrada: false })).estatus).toBe('en_ruta');
    expect(resumir(fila({ jornadaCerrada: true })).estatus).toBe('terminado');
  });
});

describe('sumar', () => {
  it('cuenta renglones (también los de ceros) y suma la oficina a cobranza y tesorería, no a gasto', () => {
    const rs = [
      resumir(fila({ contadoCentavos: 1000, gastoCentavos: 200, piezas: 3 })),
      resumir(fila({ vendedorId: 'v2' })),
    ];
    const t = sumar(rs, 500);
    expect(t.rutas).toBe(2);
    expect(t.piezas).toBe(3);
    expect(t.cobranzaCentavos).toBe(1500);
    expect(t.tesoreriaCentavos).toBe(1300);
    expect(t.gastoCentavos).toBe(200);
  });
});

const tj = [
  fila({
    vendedorId: 'a',
    vendedor: 'MJuan',
    piezas: 926,
    montoCentavos: 953450,
    contadoCentavos: 206000,
    anterioresCentavos: 100000,
    gastoCentavos: 0,
  }),
  fila({
    vendedorId: 'b',
    vendedor: 'HAntonio',
    piezas: 752,
    montoCentavos: 968400,
    contadoCentavos: 129200,
    gastoCentavos: 0,
  }),
  fila({
    vendedorId: 'c',
    vendedor: 'Ricardo',
    piezas: 1237,
    montoCentavos: 1777600,
    contadoCentavos: 157000,
    gastoCentavos: 0,
  }),
  fila({ vendedorId: 'd', vendedor: 'Cero', jornadaCerrada: false }),
];

describe('armarFlujoDiario', () => {
  it('reproduce los datos reales del 07/11 en Tijuana', () => {
    const f = armarFlujoDiario('2026-11-07', '2026-11-07', tj, [
      { fecha: '2026-11-07', sucursalCodigo: 'TJ', montoCentavos: 43750 },
    ]);
    expect(f.totalPorVendedor.cobranzaCentavos).toBe(592200);
    expect(f.totalPorVendedor.montoCentavos).toBe(3699450);
    expect(f.porDia[0].totales.cobranzaCentavos).toBe(635950);
    expect(f.porDia[0].totales.rutas).toBe(4);
    expect(f.porDia[0].oficinaCentavos).toBe(43750);
    expect(f.totalPorDia.cobranzaCentavos).toBe(635950);
  });

  it('arma un bloque por sucursal y el total del día suma ambos', () => {
    const mx = fila({
      sucursalCodigo: 'MX',
      vendedorId: 'm',
      vendedor: 'Mex',
      contadoCentavos: 1000,
      piezas: 5,
    });
    const f = armarFlujoDiario(
      '2026-11-07',
      '2026-11-07',
      [mx, ...tj],
      [{ fecha: '2026-11-07', sucursalCodigo: 'MX', montoCentavos: 200 }],
    );
    expect(f.bloques.map((b) => b.sucursalCodigo)).toEqual(['MX', 'TJ']);
    const [bmx, btj] = f.bloques;
    expect(bmx.porVendedor.cobranzaCentavos).toBe(1000);
    expect(bmx.porDia.cobranzaCentavos).toBe(1200);
    expect(btj.porVendedor.cobranzaCentavos).toBe(592200);
    expect(f.totalPorDia.cobranzaCentavos).toBe(
      bmx.porDia.cobranzaCentavos + btj.porDia.cobranzaCentavos,
    );
    expect(f.totalPorDia.rutas).toBe(5);
  });

  it('un día con solo cobranza de oficina produce un resumen con rutas 0', () => {
    const f = armarFlujoDiario('2026-11-06', '2026-11-07', tj, [
      { fecha: '2026-11-06', sucursalCodigo: 'TJ', montoCentavos: 900 },
    ]);
    const d = f.porDia.find((x) => x.fecha === '2026-11-06')!;
    expect(d.totales.rutas).toBe(0);
    expect(d.totales.cobranzaCentavos).toBe(900);
    expect(d.totales.montoCentavos).toBe(0);
    expect(f.totalPorVendedor.rutas).toBe(4);
  });

  it('ordena por sucursal, fecha descendente y vendedor', () => {
    const f = armarFlujoDiario(
      '2026-11-05',
      '2026-11-07',
      [
        fila({ fecha: '2026-11-05', vendedorId: 'a', vendedor: 'Ana' }),
        fila({ fecha: '2026-11-07', vendedorId: 'b', vendedor: 'Beto' }),
        fila({ fecha: '2026-11-07', vendedorId: 'a', vendedor: 'Ana' }),
      ],
      [],
    );
    expect(f.porVendedor.map((r) => `${r.fecha}${r.vendedor}`)).toEqual([
      '2026-11-07Ana',
      '2026-11-07Beto',
      '2026-11-05Ana',
    ]);
    expect(f.porDia.map((r) => r.fecha)).toEqual(['2026-11-07', '2026-11-05']);
  });
});

describe('armarDashboard', () => {
  it('cuenta en ruta y terminaron por bloque y en total; ruta con ceros es en ruta', () => {
    const d = armarDashboard('2026-11-09', [
      fila({
        fecha: '2026-11-09',
        vendedorId: 'b',
        vendedor: 'Beto',
        sucursalCodigo: 'TJ',
        jornadaCerrada: false,
        clientesEnRuta: 4,
      }),
      fila({
        fecha: '2026-11-09',
        vendedorId: 'a',
        vendedor: 'Ana',
        sucursalCodigo: 'TJ',
        jornadaCerrada: true,
        montoCentavos: 500,
        contadoCentavos: 500,
      }),
      fila({
        fecha: '2026-11-09',
        vendedorId: 'c',
        vendedor: 'Carla',
        sucursalCodigo: 'MX',
        jornadaCerrada: true,
      }),
    ]);
    expect(d.fecha).toBe('2026-11-09');
    expect(d.vendedores.map((v) => v.vendedor)).toEqual([
      'Carla',
      'Ana',
      'Beto',
    ]);
    expect(
      d.bloques.map((b) => [b.sucursalCodigo, b.enRuta, b.terminaron]),
    ).toEqual([
      ['MX', 0, 1],
      ['TJ', 1, 1],
    ]);
    expect(d.bloques[1].totales.cobranzaCentavos).toBe(500);
    expect(d.total).toMatchObject({
      rutas: 3,
      enRuta: 1,
      terminaron: 2,
      montoCentavos: 500,
    });
  });

  it('sin filas: total en ceros y sin bloques', () => {
    const d = armarDashboard('2026-11-09', []);
    expect(d.bloques).toEqual([]);
    expect(d.total).toMatchObject({ rutas: 0, enRuta: 0, terminaron: 0 });
  });
});

describe('fechaValidaDashboard', () => {
  it('hoy y ayer valen; otro dia, un formato raro o mañana no', () => {
    expect(fechaValidaDashboard('2026-11-09', '2026-11-09')).toBe(true);
    expect(fechaValidaDashboard('2026-11-08', '2026-11-09')).toBe(true);
    expect(fechaValidaDashboard('2026-11-07', '2026-11-09')).toBe(false);
    expect(fechaValidaDashboard('2026-11-10', '2026-11-09')).toBe(false);
    expect(fechaValidaDashboard('2026-11-9', '2026-11-09')).toBe(false);
  });

  it('ayer cruza mes y año', () => {
    expect(fechaValidaDashboard('2026-02-28', '2026-03-01')).toBe(true);
    expect(fechaValidaDashboard('2025-12-31', '2026-01-01')).toBe(true);
  });
});

describe('contarNotasNoEntregadas', () => {
  it('con notas por revisar y ninguna revisada: null (el dia no se ha revisado)', () => {
    expect(
      contarNotasNoEntregadas({ porRevisar: 3, revisadas: 0, noEntregadas: 0 }),
    ).toBeNull();
  });

  it('sin notas por revisar: 0', () => {
    expect(
      contarNotasNoEntregadas({ porRevisar: 0, revisadas: 0, noEntregadas: 0 }),
    ).toBe(0);
  });

  it('revisado y todo llego: 0', () => {
    expect(
      contarNotasNoEntregadas({ porRevisar: 2, revisadas: 2, noEntregadas: 0 }),
    ).toBe(0);
  });

  it('revisado con notas sin palomita: cuantas', () => {
    expect(
      contarNotasNoEntregadas({ porRevisar: 4, revisadas: 3, noEntregadas: 2 }),
    ).toBe(2);
  });
});
