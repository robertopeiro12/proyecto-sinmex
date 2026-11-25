import {
  MAX_LINEAS_MOVIMIENTO,
  normalizarDatosMovimiento,
} from './datos-movimiento';

const LITRO = '5f3c1a2b-7d8e-4f90-a1b2-c3d4e5f60718';
const MEDIO = '6a4d2b3c-8e9f-4a01-b2c3-d4e5f6071829';

const datos = (extra: Record<string, unknown> = {}) => ({
  tipo: 'merma_cliente',
  comentario: null,
  registrado_en: '2026-10-23T18:40:00.000Z',
  lineas: [
    { presentacion_id: LITRO, sentido: 'recibido', piezas: 3 },
    { presentacion_id: MEDIO, sentido: 'entregado', piezas: 2 },
  ],
  ...extra,
});

describe('normalizarDatosMovimiento (T-27 pieza 2)', () => {
  it('una merma del cliente valida sale normalizada', () => {
    expect(
      normalizarDatosMovimiento(
        datos({
          comentario: '  Venían reventadas  ',
          registrado_en: '2026-10-23T11:40:00-07:00',
          lineas: [
            {
              presentacion_id: LITRO.toUpperCase(),
              sentido: 'recibido',
              piezas: 3,
            },
          ],
        }),
      ),
    ).toEqual({
      ok: true,
      movimiento: {
        tipo: 'merma_cliente',
        comentario: 'Venían reventadas',
        motivoMermaId: null,
        registradoEn: '2026-10-23T18:40:00.000Z',
        lineas: [{ presentacionId: LITRO, sentido: 'recibido', piezas: 3 }],
      },
    });
  });

  it('la merma del trayecto y el consumo llevan solo lineas entregado', () => {
    for (const tipo of ['merma_trayecto', 'consumo']) {
      expect(
        normalizarDatosMovimiento(
          datos({
            tipo,
            lineas: [
              { presentacion_id: LITRO, sentido: 'entregado', piezas: 1 },
            ],
          }),
        ),
      ).toMatchObject({ ok: true, movimiento: { tipo } });
    }
  });

  it('un comentario vacio o ausente es null', () => {
    expect(
      normalizarDatosMovimiento(datos({ comentario: '   ' })),
    ).toMatchObject({
      ok: true,
      movimiento: { comentario: null },
    });
    const { comentario: _c, ...sin } = datos();
    void _c;
    expect(normalizarDatosMovimiento(sin)).toMatchObject({
      ok: true,
      movimiento: { comentario: null },
    });
  });

  it('Review Focus 3: una merma del cliente sin linea recibido es invalida', () => {
    const r = normalizarDatosMovimiento(
      datos({
        lineas: [{ presentacion_id: MEDIO, sentido: 'entregado', piezas: 2 }],
      }),
    );
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.motivo).toMatch(/^lineas: .*recibido/);
  });

  it.each([
    [{ tipo: 'devolucion' }, /^tipo: /],
    [{ tipo: undefined }, /^tipo: /],
    [{ registrado_en: '2026-10-23' }, /^registrado_en: /],
    [{ comentario: 5 }, /^comentario: /],
    [{ comentario: 'x'.repeat(301) }, /^comentario: .*300/],
    [{ lineas: [] }, /^lineas: /],
    [{ lineas: 'muchas' }, /^lineas: /],
    [
      {
        lineas: Array.from({ length: MAX_LINEAS_MOVIMIENTO + 1 }, () => ({
          presentacion_id: LITRO,
          sentido: 'recibido',
          piezas: 1,
        })),
      },
      /^lineas: /,
    ],
    [{ lineas: [7] }, /^lineas\[0\]: /],
    [
      { lineas: [{ presentacion_id: 'abc', sentido: 'recibido', piezas: 1 }] },
      /^lineas\[0\]\.presentacion_id: /,
    ],
    [
      { lineas: [{ presentacion_id: LITRO, sentido: 'perdido', piezas: 1 }] },
      /^lineas\[0\]\.sentido: /,
    ],
    [
      { lineas: [{ presentacion_id: LITRO, sentido: 'recibido', piezas: 0 }] },
      /^lineas\[0\]\.piezas: /,
    ],
    [
      {
        lineas: [
          { presentacion_id: LITRO, sentido: 'recibido', piezas: 100_000 },
        ],
      },
      /^lineas\[0\]\.piezas: /,
    ],
    [
      {
        lineas: [{ presentacion_id: LITRO, sentido: 'recibido', piezas: 1.5 }],
      },
      /^lineas\[0\]\.piezas: /,
    ],
    [
      {
        lineas: [
          { presentacion_id: LITRO, sentido: 'recibido', piezas: 1 },
          {
            presentacion_id: LITRO.toUpperCase(),
            sentido: 'recibido',
            piezas: 2,
          },
        ],
      },
      /^lineas\[1\]\.presentacion_id: /,
    ],
    [
      {
        tipo: 'consumo',
        lineas: [{ presentacion_id: LITRO, sentido: 'recibido', piezas: 1 }],
      },
      /^lineas\[0\]\.sentido: .*entregado/,
    ],
  ])('%j es invalido con un motivo que nombra el campo', (extra, motivo) => {
    const r = normalizarDatosMovimiento(datos(extra));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.motivo).toMatch(motivo);
  });

  it('la misma presentacion recibida y entregada si se puede (la reposicion)', () => {
    expect(
      normalizarDatosMovimiento(
        datos({
          lineas: [
            { presentacion_id: LITRO, sentido: 'recibido', piezas: 3 },
            { presentacion_id: LITRO, sentido: 'entregado', piezas: 3 },
          ],
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  describe('cambio (rediseño pieza 4)', () => {
    it('un cambio con lo recibido y lo entregado sale normalizado', () => {
      expect(normalizarDatosMovimiento(datos({ tipo: 'cambio' }))).toEqual({
        ok: true,
        movimiento: {
          tipo: 'cambio',
          comentario: null,
          motivoMermaId: null,
          registradoEn: '2026-10-23T18:40:00.000Z',
          lineas: [
            { presentacionId: LITRO, sentido: 'recibido', piezas: 3 },
            { presentacionId: MEDIO, sentido: 'entregado', piezas: 2 },
          ],
        },
      });
    });

    it.each([
      [
        'sin entregado',
        [{ presentacion_id: LITRO, sentido: 'recibido', piezas: 3 }],
        /^lineas: .*entregado/,
      ],
      [
        'sin recibido',
        [{ presentacion_id: MEDIO, sentido: 'entregado', piezas: 2 }],
        /^lineas: .*recibido/,
      ],
    ])('un cambio %s es invalido', (_caso, lineas, motivo) => {
      const r = normalizarDatosMovimiento(datos({ tipo: 'cambio', lineas }));
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.motivo).toMatch(motivo);
    });
  });

  describe('motivo_merma_id (rediseño pieza 4)', () => {
    const MOTIVO = '7b5e3c4d-9f0a-4b12-c3d4-e5f607182930';

    it.each(['merma_cliente', 'merma_trayecto'])(
      'una %s lleva su motivo, en minusculas',
      (tipo) => {
        const lineas =
          tipo === 'merma_trayecto'
            ? [{ presentacion_id: LITRO, sentido: 'entregado', piezas: 1 }]
            : undefined;
        expect(
          normalizarDatosMovimiento(
            datos({
              tipo,
              motivo_merma_id: MOTIVO.toUpperCase(),
              ...(lineas ? { lineas } : {}),
            }),
          ),
        ).toMatchObject({ ok: true, movimiento: { motivoMermaId: MOTIVO } });
      },
    );

    it('Review Focus 1: una merma sin motivo (tablet vieja) entra con null', () => {
      expect(normalizarDatosMovimiento(datos())).toMatchObject({
        ok: true,
        movimiento: { motivoMermaId: null },
      });
      expect(
        normalizarDatosMovimiento(datos({ motivo_merma_id: null })),
      ).toMatchObject({ ok: true, movimiento: { motivoMermaId: null } });
    });

    it.each([
      [{ motivo_merma_id: 'abc' }],
      [{ motivo_merma_id: 5 }],
      [{ tipo: 'cambio', motivo_merma_id: MOTIVO }],
      [
        {
          tipo: 'consumo',
          motivo_merma_id: MOTIVO,
          lineas: [{ presentacion_id: LITRO, sentido: 'entregado', piezas: 1 }],
        },
      ],
    ])('%j es invalido y nombra motivo_merma_id', (extra) => {
      const r = normalizarDatosMovimiento(datos(extra));
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.motivo).toMatch(/^motivo_merma_id: /);
    });
  });
});
