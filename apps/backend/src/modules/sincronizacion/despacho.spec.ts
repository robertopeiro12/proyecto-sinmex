import { CODIGOS_RECHAZO } from './contrato';
import {
  CODIGO_POR_RAZON,
  esColisionDeFolio,
  prepararProyeccion,
} from './despacho';
import type { OperacionNormalizada } from './operaciones';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const PRE_A = '5f3c1a2b-7d8e-4f90-a1b2-c3d4e5f60718';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000001',
  tipo: 'venta',
  fechaOperacion: '2026-09-14',
  ocurridoEn: '2026-09-14T18:32:05.000Z',
  clienteId: CLIENTE,
  folio: 'TJ260914AP03',
  datos: {
    num_nota: '2346',
    contado_credito: 'credito',
    factura: 'N/A',
    comentarios: null,
    lineas: [
      {
        presentacion_id: PRE_A,
        cantidad: 24,
        cantidad_promocion: 2,
        precio_centavos: 1350,
      },
    ],
  },
  ...extra,
});

describe('prepararProyeccion', () => {
  it.each(['jornada', 'cobranza', 'gasto', 'merma', 'ruta'] as const)(
    '%s no tiene modulo que la proyecte todavia: va al buzon sin mirar datos',
    (tipo) => {
      expect(
        prepararProyeccion(
          op({ tipo, folio: null, clienteId: null, datos: { lo_que_sea: 1 } }),
        ),
      ).toEqual({ ok: true, proyeccion: null });
    },
  );

  it('una venta valida se prepara para VentasService', () => {
    expect(prepararProyeccion(op())).toEqual({
      ok: true,
      proyeccion: {
        tipo: 'venta',
        venta: {
          clienteId: CLIENTE,
          numNota: '2346',
          contadoCredito: 'credito',
          factura: 'N/A',
          comentarios: null,
          lineas: [
            {
              presentacionId: PRE_A,
              cantidad: 24,
              cantidadPromocion: 2,
              precioCentavos: 1350,
            },
          ],
        },
      },
    });
  });

  it.each<[string, Partial<OperacionNormalizada>, string]>([
    ['una venta sin folio', { folio: null }, 'folio: '],
    ['una venta sin cliente', { clienteId: null }, 'cliente_id: '],
    [
      'una venta con num_nota en blanco',
      {
        datos: {
          num_nota: '   ',
          contado_credito: 'credito',
          lineas: [
            {
              presentacion_id: PRE_A,
              cantidad: 1,
              cantidad_promocion: 0,
              precio_centavos: 100,
            },
          ],
        },
      },
      'num_nota: ',
    ],
  ])(
    '%s es datos-invalidos y el motivo dice el campo',
    (_caso, extra, prefijo) => {
      const r = prepararProyeccion(op(extra));
      if (r.ok) throw new Error('debia rechazarse');
      expect(r.codigo).toBe('datos-invalidos');
      expect(r.motivo.startsWith(prefijo)).toBe(true);
    },
  );
});

describe('CODIGO_POR_RAZON', () => {
  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
    expect(CODIGO_POR_RAZON['presentacion-inactiva']).toBe(
      'presentacion-inactiva',
    );
    expect(CODIGO_POR_RAZON['precio-no-asignado']).toBe('precio-no-asignado');
  });
});

describe('esColisionDeFolio', () => {
  it.each<[string, unknown, boolean]>([
    [
      'el unique del folio en el buzon',
      { code: '23505', constraint: 'uq_sync_operacion_folio' },
      true,
    ],
    [
      'el unique del folio en venta_nota',
      { code: '23505', constraint: 'venta_nota_folio_key' },
      true,
    ],
    [
      'otro unique (un bug, no una colision)',
      { code: '23505', constraint: 'uq_venta_detalle_presentacion' },
      false,
    ],
    [
      'un check violado',
      { code: '23514', constraint: 'ck_venta_detalle_precio' },
      false,
    ],
    ['algo que no es un error de Postgres', new Error('otra cosa'), false],
  ])('%s', (_caso, error, esperado) => {
    expect(esColisionDeFolio(error)).toBe(esperado);
  });
});
