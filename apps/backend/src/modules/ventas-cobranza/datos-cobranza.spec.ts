import {
  normalizarDatosCobranza,
  type ResultadoDatosCobranza,
} from './datos-cobranza';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const NOTA = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const FECHA_OPERACION = '2026-09-14';

const datos = (
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  venta_nota_id: NOTA,
  monto_centavos: 15000,
  metodo_pago: 'efectivo',
  fecha_pago: '2026-09-12',
  ...extra,
});

/** El motivo de un rechazo, o falla la prueba si no hubo rechazo. */
function motivo(r: ResultadoDatosCobranza): string {
  if (r.ok) throw new Error('se esperaba un rechazo');
  return r.motivo;
}

describe('normalizarDatosCobranza (D14)', () => {
  it('normaliza una cobranza valida, con los uuid en minusculas', () => {
    expect(
      normalizarDatosCobranza(
        CLIENTE.toUpperCase(),
        FECHA_OPERACION,
        datos({ venta_nota_id: NOTA.toUpperCase() }),
      ),
    ).toEqual({
      ok: true,
      cobranza: {
        clienteId: CLIENTE,
        ventaNotaId: NOTA,
        montoCentavos: 15000,
        metodoPago: 'efectivo',
        fechaPago: '2026-09-12',
      },
    });
  });

  it('sin cliente en el sobre no hay cobranza', () => {
    expect(
      motivo(normalizarDatosCobranza(null, FECHA_OPERACION, datos())),
    ).toMatch(/^cliente_id: /);
  });

  it.each([undefined, 'no-soy-uuid', 123])(
    'venta_nota_id %p no es un uuid',
    (valor) => {
      expect(
        motivo(
          normalizarDatosCobranza(
            CLIENTE,
            FECHA_OPERACION,
            datos({ venta_nota_id: valor }),
          ),
        ),
      ).toMatch(/^venta_nota_id: /);
    },
  );

  it.each([0, -1, 15.5, '15000', 1_000_000_000_000, undefined])(
    'monto_centavos %p no es un cobro',
    (valor) => {
      expect(
        motivo(
          normalizarDatosCobranza(
            CLIENTE,
            FECHA_OPERACION,
            datos({ monto_centavos: valor }),
          ),
        ),
      ).toMatch(/^monto_centavos: /);
    },
  );

  it('acepta el tope de numeric(12,2)', () => {
    const r = normalizarDatosCobranza(
      CLIENTE,
      FECHA_OPERACION,
      datos({ monto_centavos: 999_999_999_999 }),
    );
    expect(r.ok).toBe(true);
  });

  it.each(['EFECTIVO', 'tarjeta', undefined])(
    'metodo_pago %p no esta en el catalogo',
    (valor) => {
      expect(
        motivo(
          normalizarDatosCobranza(
            CLIENTE,
            FECHA_OPERACION,
            datos({ metodo_pago: valor }),
          ),
        ),
      ).toMatch(/^metodo_pago: /);
    },
  );

  it.each(['efectivo', 'transferencia', 'cheque'])(
    'acepta el metodo %s',
    (valor) => {
      const r = normalizarDatosCobranza(
        CLIENTE,
        FECHA_OPERACION,
        datos({ metodo_pago: valor }),
      );
      expect(r.ok && r.cobranza.metodoPago).toBe(valor);
    },
  );

  it.each(['2026-02-30', '14/09/2026', '2026-9-14', undefined])(
    'fecha_pago %p no es una fecha que exista',
    (valor) => {
      expect(
        motivo(
          normalizarDatosCobranza(
            CLIENTE,
            FECHA_OPERACION,
            datos({ fecha_pago: valor }),
          ),
        ),
      ).toMatch(/^fecha_pago: /);
    },
  );

  it('una fecha de pago posterior a la fecha de operacion es invalida', () => {
    expect(
      motivo(
        normalizarDatosCobranza(
          CLIENTE,
          FECHA_OPERACION,
          datos({ fecha_pago: '2026-09-15' }),
        ),
      ),
    ).toMatch(/^fecha_pago: /);
  });

  it('la fecha de pago puede ser el mismo dia de la operacion', () => {
    const r = normalizarDatosCobranza(
      CLIENTE,
      FECHA_OPERACION,
      datos({ fecha_pago: FECHA_OPERACION }),
    );
    expect(r.ok).toBe(true);
  });
});
