import {
  aCargaPull,
  aCargaRejilla,
  armarRejilla,
  decidirRespuesta,
  mililitros,
  MOTIVO_CARGA_ACEPTADA,
  MOTIVO_CARGA_CAMBIO,
  MOTIVO_CARGA_DE_OTRO_DIA,
  motivoNoEditable,
  normalizarLineas,
  normalizarRespuesta,
  ordenarPresentaciones,
  validarLineas,
  type FilaCarga,
  type PresentacionRejilla,
} from './reglas-carga';

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const C = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';

function fila(extra: Partial<FilaCarga> = {}): FilaCarga {
  return {
    id: 'c-1',
    vendedorId: 'v-1',
    sucursalId: 's-tj',
    fecha: '2026-10-22',
    numero: 1,
    estado: 'pendiente',
    motivoRechazo: null,
    version: 1,
    respondidaEn: null,
    eliminada: false,
    lineas: [{ presentacionId: A, piezas: 24, aceptada: null }],
    ...extra,
  };
}

describe('validarLineas (T-27, POST/PATCH)', () => {
  const activas = new Set([A, B]);

  it('lineas validas: null', () => {
    expect(
      validarLineas(
        [
          { presentacionId: A, piezas: 1 },
          { presentacionId: B, piezas: 99_999 },
        ],
        activas,
      ),
    ).toBeNull();
  });

  it('al menos una linea', () => {
    expect(validarLineas([], activas)).toBe(
      'La carga necesita al menos un producto.',
    );
  });

  it('piezas enteras de 1 a 99 999', () => {
    for (const piezas of [0, -1, 1.5, 100_000]) {
      expect(validarLineas([{ presentacionId: A, piezas }], activas)).toBe(
        'Las piezas son enteras, de 1 a 99 999.',
      );
    }
  });

  it('una presentacion no se repite (ni cambiando mayusculas)', () => {
    expect(
      validarLineas(
        normalizarLineas([
          { presentacionId: A, piezas: 1 },
          { presentacionId: A.toUpperCase(), piezas: 2 },
        ]),
        activas,
      ),
    ).toBe('Un producto viene dos veces en la carga.');
  });

  it('solo presentaciones activas', () => {
    expect(validarLineas([{ presentacionId: C, piezas: 3 }], activas)).toBe(
      'Uno de los productos no existe o está dado de baja.',
    );
  });
});

describe('motivoNoEditable (D5, D8)', () => {
  it('pendiente o rechazada de hoy con su version: se puede', () => {
    expect(motivoNoEditable(fila(), '2026-10-22', 1)).toBeNull();
    expect(
      motivoNoEditable(fila({ estado: 'rechazada' }), '2026-10-22', 1),
    ).toBeNull();
  });

  it('una aceptada nunca, aunque la version cuadre (D5)', () => {
    expect(
      motivoNoEditable(fila({ estado: 'aceptada' }), '2026-10-22', 1),
    ).toBe(MOTIVO_CARGA_ACEPTADA);
    expect(MOTIVO_CARGA_ACEPTADA).toContain(
      'Una carga aceptada no se modifica',
    );
  });

  it('una de otro dia no (D8: dias anteriores en solo lectura)', () => {
    expect(motivoNoEditable(fila(), '2026-10-23', 1)).toBe(
      MOTIVO_CARGA_DE_OTRO_DIA,
    );
  });

  it('con otra version: 409 de concurrencia', () => {
    expect(motivoNoEditable(fila({ version: 2 }), '2026-10-22', 1)).toBe(
      MOTIVO_CARGA_CAMBIO,
    );
  });
});

describe('orden de la rejilla (presentacion y luego sabor, criterio de T-10)', () => {
  it('mililitros entiende ml y L, con punto o coma', () => {
    expect(mililitros('500 ml')).toBe(500);
    expect(mililitros('1 L')).toBe(1000);
    expect(mililitros('1.5 L')).toBe(1500);
    expect(mililitros('1,5 l')).toBe(1500);
    expect(mililitros('20 Lts')).toBe(20000);
    expect(mililitros('Garrafa')).toBeNull();
  });

  it('por volumen de menor a mayor, luego por sabor; lo que no se entiende va al final', () => {
    const p = (
      id: string,
      productoNombre: string,
      volumen: string,
    ): PresentacionRejilla => ({
      id,
      productoNombre,
      volumen,
      activa: true,
    });
    const orden = ordenarPresentaciones([
      p('1', 'Jamaica', '1 L'),
      p('2', 'Horchata', '1 L'),
      p('3', 'Té de Jazmín', '500 ml'),
      p('4', 'Horchata', 'Garrafa'),
      p('5', 'Horchata', '500 ml'),
    ]);
    expect(orden.map((x) => x.id)).toEqual(['5', '3', '2', '1', '4']);
  });
});

describe('armarRejilla (GET /cargas)', () => {
  it('vendedores en orden alfabetico, cada uno con sus cargas vivas por numero', () => {
    const rejilla = armarRejilla({
      fecha: '2026-10-22',
      sucursal: { id: 's-tj', codigo: 'TJ', nombre: 'Tijuana' },
      presentaciones: [],
      vendedores: [
        { id: 'v-2', nombre: 'Zoila' },
        { id: 'v-1', nombre: 'Ángel' },
        { id: 'v-3', nombre: 'Berta' },
      ],
      cargas: [
        fila({ id: 'c-2', numero: 2 }),
        fila({ id: 'c-1', numero: 1 }),
        fila({ id: 'c-x', numero: 3, eliminada: true }),
        fila({ id: 'c-3', vendedorId: 'v-3', numero: 1 }),
      ],
    });
    expect(rejilla.vendedores.map((v) => v.nombre)).toEqual([
      'Ángel',
      'Berta',
      'Zoila',
    ]);
    expect(rejilla.vendedores[0].cargas.map((c) => c.id)).toEqual([
      'c-1',
      'c-2',
    ]);
    expect(rejilla.vendedores[1].cargas.map((c) => c.id)).toEqual(['c-3']);
    expect(rejilla.vendedores[2].cargas).toEqual([]);
  });

  it('aCargaRejilla: camelCase y respondidaEn en ISO', () => {
    expect(
      aCargaRejilla(
        fila({
          estado: 'rechazada',
          motivoRechazo: 'Faltan 2 cajas',
          respondidaEn: new Date('2026-10-22T15:00:00.000Z'),
        }),
      ),
    ).toEqual({
      id: 'c-1',
      numero: 1,
      estado: 'rechazada',
      motivoRechazo: 'Faltan 2 cajas',
      version: 1,
      respondidaEn: '2026-10-22T15:00:00.000Z',
      renglones: 1,
      renglonesAceptados: 0,
      lineas: [{ presentacionId: A, piezas: 24, aceptada: false }],
    });
  });

  it('aCargaRejilla: pendiente no tiene respuesta (null)', () => {
    const c = aCargaRejilla(fila());
    expect(c.renglonesAceptados).toBeNull();
    expect(c.renglones).toBe(1);
    expect(c.lineas[0].aceptada).toBeNull();
  });

  it('aCargaRejilla: parcial cuenta los renglones aceptados', () => {
    const c = aCargaRejilla(
      fila({
        estado: 'aceptada',
        lineas: [
          { presentacionId: A, piezas: 1, aceptada: true },
          { presentacionId: B, piezas: 2, aceptada: false },
          { presentacionId: C, piezas: 3, aceptada: true },
        ],
      }),
    );
    expect(c.renglones).toBe(3);
    expect(c.renglonesAceptados).toBe(2);
    expect(c.lineas.map((l) => l.aceptada)).toEqual([true, false, true]);
  });

  it('aCargaRejilla: una aceptada vieja (null) cuenta como toda aceptada', () => {
    const c = aCargaRejilla(
      fila({
        estado: 'aceptada',
        lineas: [
          { presentacionId: A, piezas: 1, aceptada: null },
          { presentacionId: B, piezas: 2, aceptada: null },
        ],
      }),
    );
    expect(c.renglonesAceptados).toBe(2);
    expect(c.lineas.every((l) => l.aceptada === true)).toBe(true);
  });
});

describe('normalizarRespuesta (POST /sync/cargas/:id/respuesta)', () => {
  const deLaCarga = [A, B, C];

  it('la lista vacía rechaza la carga, sin motivo', () => {
    expect(normalizarRespuesta({ aceptadas: [] }, deLaCarga)).toEqual({
      ok: true,
      respuesta: { estado: 'rechazada', aceptadas: new Set(), motivo: null },
    });
  });

  it('todos los renglones: aceptada con todo el conjunto', () => {
    expect(normalizarRespuesta({ aceptadas: [C, A, B] }, deLaCarga)).toEqual({
      ok: true,
      respuesta: {
        estado: 'aceptada',
        aceptadas: new Set([A, B, C]),
        motivo: null,
      },
    });
  });

  it('una parte: aceptada con ese conjunto (ids en minúsculas)', () => {
    expect(
      normalizarRespuesta({ aceptadas: [A.toUpperCase(), C] }, deLaCarga),
    ).toEqual({
      ok: true,
      respuesta: {
        estado: 'aceptada',
        aceptadas: new Set([A, C]),
        motivo: null,
      },
    });
  });

  it('Review Focus 3: una presentación ajena a la carga o repetida es 400', () => {
    const ajena = '3f2504e0-4f89-41d3-9a0c-0305e82c3399';
    expect(normalizarRespuesta({ aceptadas: [A, ajena] }, deLaCarga)).toEqual({
      ok: false,
      mensaje: 'Uno de los productos aceptados no viene en esta carga.',
    });
    expect(
      normalizarRespuesta({ aceptadas: [A, A.toUpperCase()] }, deLaCarga),
    ).toEqual({
      ok: false,
      mensaje: 'Un producto aceptado viene repetido.',
    });
  });

  it('la lista no lleva motivo ni acción; sin lista ni acción es 400', () => {
    expect(
      normalizarRespuesta({ aceptadas: [A], motivo: 'algo' }, deLaCarga),
    ).toEqual({ ok: false, mensaje: 'La lista de aceptados no lleva motivo.' });
    expect(
      normalizarRespuesta({ aceptadas: [A], accion: 'aceptar' }, deLaCarga),
    ).toEqual({
      ok: false,
      mensaje: 'Manda la lista de aceptados o la acción, no las dos.',
    });
    expect(normalizarRespuesta({}, deLaCarga)).toEqual({
      ok: false,
      mensaje: 'Falta la lista de productos aceptados.',
    });
  });

  it('Review Focus 2, forma vieja: aceptar = todos, sin motivo', () => {
    const todas = {
      ok: true,
      respuesta: {
        estado: 'aceptada',
        aceptadas: new Set([A, B, C]),
        motivo: null,
      },
    };
    expect(normalizarRespuesta({ accion: 'aceptar' }, deLaCarga)).toEqual(
      todas,
    );
    expect(
      normalizarRespuesta({ accion: 'aceptar', motivo: null }, deLaCarga),
    ).toEqual(todas);
    expect(
      normalizarRespuesta(
        { accion: 'aceptar', motivo: 'todo bien' },
        deLaCarga,
      ),
    ).toEqual({ ok: false, mensaje: 'Aceptar una carga no lleva motivo.' });
  });

  it('Review Focus 2, forma vieja: rechazar = ninguno, con motivo de 1 a 300 recortado', () => {
    expect(
      normalizarRespuesta(
        { accion: 'rechazar', motivo: '  Faltan 2 cajas  ' },
        deLaCarga,
      ),
    ).toEqual({
      ok: true,
      respuesta: {
        estado: 'rechazada',
        aceptadas: new Set(),
        motivo: 'Faltan 2 cajas',
      },
    });
    expect(
      normalizarRespuesta(
        { accion: 'rechazar', motivo: 'x'.repeat(300) },
        deLaCarga,
      ).ok,
    ).toBe(true);
    for (const motivo of [undefined, null, '', '   ', 'x'.repeat(301)]) {
      expect(
        normalizarRespuesta({ accion: 'rechazar', motivo }, deLaCarga),
      ).toEqual({
        ok: false,
        mensaje:
          'Para rechazar la carga escribe el motivo (hasta 300 caracteres).',
      });
    }
  });
});

describe('decidirRespuesta (D6, Review Focus 2 y 3)', () => {
  const tres = [
    { presentacionId: A, piezas: 24, aceptada: null },
    { presentacionId: B, piezas: 12, aceptada: null },
    { presentacionId: C, piezas: 6, aceptada: null },
  ];
  const respondida = (
    estado: 'aceptada' | 'rechazada',
    aceptadas: readonly string[],
    motivoRechazo: string | null = null,
  ) =>
    fila({
      estado,
      motivoRechazo,
      lineas: tres.map((l) => ({
        ...l,
        aceptada: aceptadas.includes(l.presentacionId),
      })),
    });
  const aceptar = (...ids: string[]) =>
    ({ estado: 'aceptada', aceptadas: new Set(ids), motivo: null }) as const;
  const rechazar = (motivo: string | null) =>
    ({ estado: 'rechazada', aceptadas: new Set<string>(), motivo }) as const;

  it('pendiente con su version: se escribe', () => {
    const pendiente = fila({ lineas: tres });
    expect(decidirRespuesta(pendiente, aceptar(A, B, C), 1)).toBe('escribir');
    expect(decidirRespuesta(pendiente, aceptar(A), 1)).toBe('escribir');
    expect(decidirRespuesta(pendiente, rechazar(null), 1)).toBe('escribir');
    expect(decidirRespuesta(pendiente, rechazar('Faltan cajas'), 1)).toBe(
      'escribir',
    );
  });

  it('la misma respuesta otra vez (reintento de red, doble toque): repetida', () => {
    expect(
      decidirRespuesta(respondida('aceptada', [A, B]), aceptar(B, A), 1),
    ).toBe('repetida');
    expect(
      decidirRespuesta(respondida('rechazada', []), rechazar(null), 1),
    ).toBe('repetida');
    expect(
      decidirRespuesta(
        respondida('rechazada', [], 'Faltan cajas'),
        rechazar('Faltan cajas'),
        1,
      ),
    ).toBe('repetida');
  });

  it('Review Focus 1: una aceptada de antes (renglones en null) cuenta como todo aceptado', () => {
    const vieja = fila({ estado: 'aceptada', lineas: tres });
    expect(decidirRespuesta(vieja, aceptar(A, B, C), 1)).toBe('repetida');
    expect(decidirRespuesta(vieja, aceptar(A), 1)).toBe('conflicto');
  });

  it('otra version, u otra respuesta ya escrita: conflicto (409)', () => {
    expect(
      decidirRespuesta(fila({ version: 2, lineas: tres }), aceptar(A), 1),
    ).toBe('conflicto');
    expect(
      decidirRespuesta(respondida('aceptada', [A, B]), aceptar(A), 1),
    ).toBe('conflicto');
    expect(
      decidirRespuesta(respondida('aceptada', [A, B]), aceptar(A, B, C), 1),
    ).toBe('conflicto');
    expect(
      decidirRespuesta(
        respondida('rechazada', [], 'Faltan cajas'),
        aceptar(A),
        1,
      ),
    ).toBe('conflicto');
    expect(
      decidirRespuesta(
        respondida('rechazada', [], 'Otra cosa'),
        rechazar('Faltan cajas'),
        1,
      ),
    ).toBe('conflicto');
  });
});

describe('aCargaPull (colección `cargas` del pull)', () => {
  it('snake_case, fecha tal cual, respondida en ISO y la baja como activo 0', () => {
    expect(
      aCargaPull(
        fila({
          estado: 'aceptada',
          respondidaEn: new Date('2026-10-22T15:00:00.000Z'),
          eliminada: true,
        }),
      ),
    ).toEqual({
      id: 'c-1',
      vendedor_id: 'v-1',
      fecha: '2026-10-22',
      numero: 1,
      estado: 'aceptada',
      motivo_rechazo: null,
      version: 1,
      respondida_en: '2026-10-22T15:00:00.000Z',
      activo: 0,
      lineas: [{ presentacion_id: A, piezas: 24, aceptada: null }],
    });
    expect(aCargaPull(fila()).activo).toBe(1);
  });

  it('cada renglón trae si se aceptó (null mientras está pendiente o en una carga de antes)', () => {
    expect(
      aCargaPull(
        fila({
          estado: 'aceptada',
          respondidaEn: new Date('2026-10-22T15:00:00.000Z'),
          lineas: [
            { presentacionId: A, piezas: 24, aceptada: true },
            { presentacionId: B, piezas: 12, aceptada: false },
          ],
        }),
      ).lineas,
    ).toEqual([
      { presentacion_id: A, piezas: 24, aceptada: true },
      { presentacion_id: B, piezas: 12, aceptada: false },
    ]);
  });
});
