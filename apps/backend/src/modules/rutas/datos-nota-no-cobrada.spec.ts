import { normalizarDatosNotaNoCobrada } from './datos-nota-no-cobrada';

const NOTA = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f60';

const datos = (extra: Record<string, unknown> = {}) => ({
  venta_nota_id: NOTA,
  comentario: 'No estaba el encargado',
  registrado_en: '2026-11-13T11:40:00-08:00',
  ...extra,
});

function motivoDe(entrada: unknown): string {
  const r = normalizarDatosNotaNoCobrada(entrada);
  if (r.ok) throw new Error('debia rechazarse');
  return r.motivo;
}

describe('normalizarDatosNotaNoCobrada', () => {
  it('normaliza: nota en minusculas, comentario recortado, instante en UTC', () => {
    expect(
      normalizarDatosNotaNoCobrada(
        datos({
          venta_nota_id: NOTA.toUpperCase(),
          comentario: '  No pagó  ',
        }),
      ),
    ).toEqual({
      ok: true,
      nota: {
        ventaNotaId: NOTA,
        comentario: 'No pagó',
        registradoEn: '2026-11-13T19:40:00.000Z',
      },
    });
  });

  it('un comentario de solo espacios es comentario:', () => {
    expect(motivoDe(datos({ comentario: '   ' }))).toMatch(/^comentario: /);
  });

  it('300 caracteres entran y 301 no', () => {
    expect(
      normalizarDatosNotaNoCobrada(datos({ comentario: 'a'.repeat(300) })).ok,
    ).toBe(true);
    expect(motivoDe(datos({ comentario: 'a'.repeat(301) }))).toMatch(
      /^comentario: /,
    );
  });

  it('el limite cuenta despues de recortar', () => {
    const r = normalizarDatosNotaNoCobrada(
      datos({ comentario: ` ${'a'.repeat(300)} ` }),
    );
    expect(r.ok).toBe(true);
  });

  it('un comentario que no es texto es comentario:', () => {
    expect(motivoDe(datos({ comentario: 5 }))).toMatch(/^comentario: /);
  });

  it('venta_nota_id que no es uuid es venta_nota_id:', () => {
    expect(motivoDe(datos({ venta_nota_id: 'nota-1' }))).toMatch(
      /^venta_nota_id: /,
    );
  });

  it('registrado_en sin zona es registrado_en:', () => {
    expect(motivoDe(datos({ registrado_en: '2026-11-13T11:40:00' }))).toMatch(
      /^registrado_en: /,
    );
  });

  it.each([[null], ['texto'], [[]], [undefined]])(
    'datos %p que no es objeto es datos:',
    (entrada) => {
      expect(motivoDe(entrada)).toMatch(/^datos: /);
    },
  );
});
