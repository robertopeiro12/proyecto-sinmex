import {
  armarReporteClientesNuevos,
  type ClienteNuevo,
} from './reglas-clientes-nuevos';

const c = (extra: Partial<ClienteNuevo>): ClienteNuevo => ({
  id: 'c',
  fechaAlta: '2026-10-05',
  nombre: 'Cobach',
  sucursalCodigo: 'TJ',
  tipoNegocio: null,
  listaPrecio: 'Lista 1',
  telefono: '664',
  encargado: null,
  usuario: null,
  prospecto: null,
  dadoDeBaja: false,
  ...extra,
});

describe('armarReporteClientesNuevos', () => {
  it('vacío', () => {
    expect(armarReporteClientesNuevos('2026-10-01', '2026-10-14', [])).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-14',
      clientes: [],
      total: 0,
    });
  });

  it('ordena por fecha y luego por nombre en español; total', () => {
    const r = armarReporteClientesNuevos('2026-10-01', '2026-10-14', [
      c({ id: '3', fechaAlta: '2026-10-09', nombre: 'Zeta' }),
      c({ id: '2', fechaAlta: '2026-10-05', nombre: 'Beta' }),
      c({ id: '1', fechaAlta: '2026-10-05', nombre: 'Ámbar' }),
    ]);
    expect(r.clientes.map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(r.total).toBe(3);
  });

  it('no muta la entrada', () => {
    const filas = [c({ id: 'b', nombre: 'B' }), c({ id: 'a', nombre: 'A' })];
    armarReporteClientesNuevos('2026-10-01', '2026-10-14', filas);
    expect(filas.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
