import { normalizarDatosGasto } from './datos-gasto';

const CAMPO = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f30';

const datos = (extra: Record<string, unknown> = {}) => ({
  campo_egreso_id: CAMPO,
  monto_centavos: 25050,
  registrado_en: '2026-10-20T11:40:00-07:00',
  comentario: null,
  ...extra,
});

describe('normalizarDatosGasto (T-30/T-31, D5)', () => {
  it('normaliza un gasto valido: uuid en minusculas e instante en UTC', () => {
    expect(
      normalizarDatosGasto(datos({ campo_egreso_id: CAMPO.toUpperCase() })),
    ).toEqual({
      ok: true,
      gasto: {
        campoEgresoId: CAMPO,
        montoCentavos: 25050,
        registradoEn: '2026-10-20T18:40:00.000Z',
        comentario: null,
      },
    });
  });

  it('recorta el comentario; vacio o ausente es null', () => {
    const r1 = normalizarDatosGasto(datos({ comentario: '  Ticket roto  ' }));
    expect(r1.ok && r1.gasto.comentario).toBe('Ticket roto');
    const r2 = normalizarDatosGasto(datos({ comentario: '   ' }));
    expect(r2.ok && r2.gasto.comentario).toBeNull();
    const sinComentario: Record<string, unknown> = datos();
    delete sinComentario.comentario;
    const r3 = normalizarDatosGasto(sinComentario);
    expect(r3.ok && r3.gasto.comentario).toBeNull();
  });

  it('acepta el monto maximo y el comentario de 200', () => {
    expect(
      normalizarDatosGasto(
        datos({ monto_centavos: 999_999_999_999, comentario: 'x'.repeat(200) }),
      ).ok,
    ).toBe(true);
  });

  it.each([
    [{ campo_egreso_id: 'hielo' }, /^campo_egreso_id: /],
    [{ campo_egreso_id: undefined }, /^campo_egreso_id: /],
    [{ monto_centavos: 0 }, /^monto_centavos: /],
    [{ monto_centavos: -100 }, /^monto_centavos: /],
    [{ monto_centavos: 1234.5 }, /^monto_centavos: /],
    [{ monto_centavos: 1_000_000_000_000 }, /^monto_centavos: /],
    [{ monto_centavos: '25050' }, /^monto_centavos: /],
    [{ monto_centavos: Number.NaN }, /^monto_centavos: /],
    [{ registrado_en: '2026-10-20T11:40:00' }, /^registrado_en: /],
    [{ registrado_en: '2026-02-30T11:40:00Z' }, /^registrado_en: /],
    [{ comentario: 5 }, /^comentario: /],
    [{ comentario: 'x'.repeat(201) }, /^comentario: /],
  ])('%j es invalido y el motivo nombra el campo', (extra, motivo) => {
    const r = normalizarDatosGasto(datos(extra));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(motivo);
  });
});
