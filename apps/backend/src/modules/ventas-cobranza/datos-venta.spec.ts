import { MAX_LINEAS_VENTA, normalizarDatosVenta } from './datos-venta';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const PRE_A = '5f3c1a2b-7d8e-4f90-a1b2-c3d4e5f60718';

/** Un uuid distinto por indice, para armar muchas lineas sin repetir presentacion. */
const presentacionN = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const linea = (
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  presentacion_id: PRE_A,
  cantidad: 24,
  cantidad_promocion: 2,
  precio_centavos: 1350,
  ...extra,
});

/** `datos` como los manda la tablet (contrato §6), con lo que se quiera cambiar encima. */
const datos = (
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  num_nota: '2346',
  contado_credito: 'credito',
  factura: 'N/A',
  comentarios: null,
  lineas: [linea()],
  ...extra,
});

describe('normalizarDatosVenta (D12)', () => {
  it('acepta la forma del contrato y la deja lista para el servicio', () => {
    expect(normalizarDatosVenta(CLIENTE, datos())).toEqual({
      ok: true,
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
    });
  });

  it('recorta num_nota y comentarios, y un comentario en blanco queda en null', () => {
    expect(
      normalizarDatosVenta(
        CLIENTE,
        datos({ num_nota: ' 2346 ', comentarios: '  entregar atras  ' }),
      ),
    ).toMatchObject({
      ok: true,
      venta: { numNota: '2346', comentarios: 'entregar atras' },
    });
    expect(
      normalizarDatosVenta(CLIENTE, datos({ comentarios: '   ' })),
    ).toMatchObject({ ok: true, venta: { comentarios: null } });
  });

  it('sin factura, es N/A (D9)', () => {
    expect(
      normalizarDatosVenta(CLIENTE, datos({ factura: undefined })),
    ).toMatchObject({ ok: true, venta: { factura: 'N/A' } });
  });

  it('pasa el uuid de la presentacion a minusculas', () => {
    expect(
      normalizarDatosVenta(
        CLIENTE,
        datos({ lineas: [linea({ presentacion_id: PRE_A.toUpperCase() })] }),
      ),
    ).toMatchObject({
      ok: true,
      venta: { lineas: [{ presentacionId: PRE_A }] },
    });
  });

  it('acepta una linea de pura promocion a precio 0 (D13)', () => {
    expect(
      normalizarDatosVenta(
        CLIENTE,
        datos({
          lineas: [
            linea({ cantidad: 0, cantidad_promocion: 3, precio_centavos: 0 }),
          ],
        }),
      ),
    ).toMatchObject({
      ok: true,
      venta: {
        lineas: [{ cantidad: 0, cantidadPromocion: 3, precioCentavos: 0 }],
      },
    });
  });

  it(`acepta hasta ${MAX_LINEAS_VENTA} lineas`, () => {
    const lineas = Array.from({ length: MAX_LINEAS_VENTA }, (_, i) =>
      linea({ presentacion_id: presentacionN(i) }),
    );
    expect(normalizarDatosVenta(CLIENTE, datos({ lineas })).ok).toBe(true);
  });

  describe('rechaza, y el motivo empieza por el campo que fallo', () => {
    it.each<[string, string | null, Record<string, unknown>, string]>([
      ['sin cliente_id', null, datos(), 'cliente_id'],
      ['num_nota ausente', CLIENTE, datos({ num_nota: undefined }), 'num_nota'],
      ['num_nota en blanco', CLIENTE, datos({ num_nota: '   ' }), 'num_nota'],
      [
        'num_nota de 31 caracteres',
        CLIENTE,
        datos({ num_nota: '1'.repeat(31) }),
        'num_nota',
      ],
      ['num_nota numerico', CLIENTE, datos({ num_nota: 2346 }), 'num_nota'],
      [
        'contado_credito fuera de sus valores',
        CLIENTE,
        datos({ contado_credito: 'fiado' }),
        'contado_credito',
      ],
      [
        'factura con numero (lo asigna el portal)',
        CLIENTE,
        datos({ factura: 'A780' }),
        'factura',
      ],
      [
        'comentarios de 501 caracteres',
        CLIENTE,
        datos({ comentarios: 'x'.repeat(501) }),
        'comentarios',
      ],
      [
        'comentarios que no son texto',
        CLIENTE,
        datos({ comentarios: 5 }),
        'comentarios',
      ],
      ['sin lineas', CLIENTE, datos({ lineas: undefined }), 'lineas'],
      ['lineas vacia', CLIENTE, datos({ lineas: [] }), 'lineas'],
      [
        `${MAX_LINEAS_VENTA + 1} lineas`,
        CLIENTE,
        datos({
          lineas: Array.from({ length: MAX_LINEAS_VENTA + 1 }, (_, i) =>
            linea({ presentacion_id: presentacionN(i) }),
          ),
        }),
        'lineas',
      ],
      [
        'una linea que no es objeto',
        CLIENTE,
        datos({ lineas: ['x'] }),
        'lineas[0]',
      ],
      [
        'presentacion_id que no es uuid',
        CLIENTE,
        datos({ lineas: [linea({ presentacion_id: 'pre-1' })] }),
        'lineas[0].presentacion_id',
      ],
      [
        'presentacion repetida aunque cambien las mayusculas',
        CLIENTE,
        datos({
          lineas: [linea(), linea({ presentacion_id: PRE_A.toUpperCase() })],
        }),
        'lineas[1].presentacion_id',
      ],
      [
        'cantidad negativa',
        CLIENTE,
        datos({ lineas: [linea({ cantidad: -1 })] }),
        'lineas[0].cantidad',
      ],
      [
        'cantidad con decimales',
        CLIENTE,
        datos({ lineas: [linea({ cantidad: 1.5 })] }),
        'lineas[0].cantidad',
      ],
      [
        'cantidad como texto',
        CLIENTE,
        datos({ lineas: [linea({ cantidad: '24' })] }),
        'lineas[0].cantidad',
      ],
      [
        'cantidad que no cabe en integer',
        CLIENTE,
        datos({ lineas: [linea({ cantidad: 2_147_483_648 })] }),
        'lineas[0].cantidad',
      ],
      [
        'cantidad_promocion ausente',
        CLIENTE,
        datos({ lineas: [linea({ cantidad_promocion: undefined })] }),
        'lineas[0].cantidad_promocion',
      ],
      [
        'cantidad y promocion en 0',
        CLIENTE,
        datos({ lineas: [linea({ cantidad: 0, cantidad_promocion: 0 })] }),
        'lineas[0]',
      ],
      [
        'precio ausente',
        CLIENTE,
        datos({ lineas: [linea({ precio_centavos: undefined })] }),
        'lineas[0].precio_centavos',
      ],
      [
        'precio negativo',
        CLIENTE,
        datos({ lineas: [linea({ precio_centavos: -1 })] }),
        'lineas[0].precio_centavos',
      ],
      [
        'precio con decimales',
        CLIENTE,
        datos({ lineas: [linea({ precio_centavos: 13.5 })] }),
        'lineas[0].precio_centavos',
      ],
      [
        'precio 0 en una linea con piezas vendidas',
        CLIENTE,
        datos({ lineas: [linea({ precio_centavos: 0 })] }),
        'lineas[0].precio_centavos',
      ],
      [
        'monto total que no cabe en numeric(12,2)',
        CLIENTE,
        datos({
          lineas: [
            linea({ cantidad: 2_000_000, precio_centavos: 999_999_999 }),
          ],
        }),
        'lineas',
      ],
    ])('%s', (_caso, clienteId, entrada, campo) => {
      const r = normalizarDatosVenta(clienteId, entrada);
      if (r.ok) throw new Error('debia rechazarse');
      expect(r.campo).toBe(campo);
      // Es lo que la tablet guarda en `sync_error` y le ensena al vendedor:
      // tiene que decir que campo fallo.
      expect(r.motivo.startsWith(`${campo}: `)).toBe(true);
    });
  });
});
