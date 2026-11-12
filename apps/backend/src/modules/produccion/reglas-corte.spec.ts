import {
  armarCorte,
  deberiaRegresar,
  estadoCorte,
  faltante,
  MENSAJE_CONTEO_INVALIDO,
  planCorte,
  validarCorte,
  type MovimientoPresentacion,
} from './reglas-corte';
import {
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MENSAJE_PRESENTACION_REPETIDA,
} from './reglas-produccion';

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const C = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';
const HOY = '2026-11-12';

const mov = (
  parcial: Partial<MovimientoPresentacion> & { presentacionId: string },
): MovimientoPresentacion => ({
  nombre: 'Horchata 1 L',
  cargadas: 0,
  vendidas: 0,
  regaladas: 0,
  buenas: 0,
  merma: 0,
  ...parcial,
});

describe('deberiaRegresar', () => {
  it('es cargadas − vendidas − regaladas (ejemplo del spec: 68 − 35 − 0 = 33)', () => {
    expect(deberiaRegresar({ cargadas: 68, vendidas: 35, regaladas: 0 })).toBe(
      33,
    );
    expect(deberiaRegresar({ cargadas: 10, vendidas: 4, regaladas: 2 })).toBe(
      4,
    );
  });

  it('no se recorta: vender mas de lo cargado da negativo', () => {
    expect(deberiaRegresar({ cargadas: 0, vendidas: 5, regaladas: 1 })).toBe(
      -6,
    );
  });
});

describe('faltante', () => {
  it('con el corte hecho es deberia − buenas (33 − 28 = 5)', () => {
    expect(faltante(33, 28, true)).toBe(5);
  });

  it('negativo es sobrante', () => {
    expect(faltante(10, 12, true)).toBe(-2);
  });

  it('sin corte hecho es null: lo no capturado no es faltante', () => {
    expect(faltante(33, 0, false)).toBeNull();
  });
});

describe('estadoCorte', () => {
  it('sin hacer = sin_corte, aunque haya cifras', () => {
    expect(estadoCorte(false, [{ faltante: null }])).toBe('sin_corte');
  });

  it('hecho sin faltantes (o con sobrante) = hecho', () => {
    expect(estadoCorte(true, [{ faltante: 0 }, { faltante: -3 }])).toBe(
      'hecho',
    );
    expect(estadoCorte(true, [])).toBe('hecho');
  });

  it('hecho con algo faltante = con_faltante', () => {
    expect(estadoCorte(true, [{ faltante: 0 }, { faltante: 1 }])).toBe(
      'con_faltante',
    );
  });
});

describe('armarCorte', () => {
  it('ejemplo del spec: 68 cargadas, 35 vendidas, 28 buenas → faltan 5', () => {
    const r = armarCorte(
      [mov({ presentacionId: A, cargadas: 68, vendidas: 35, buenas: 28 })],
      true,
    );
    expect(r.lineas[0].deberiaRegresar).toBe(33);
    expect(r.lineas[0].faltante).toBe(5);
    expect(r.estado).toBe('con_faltante');
    expect(r.totales.faltante).toBe(5);
  });

  it('vendio todo y no regreso nada: hecho, sin faltante', () => {
    const r = armarCorte(
      [mov({ presentacionId: A, cargadas: 20, vendidas: 18, regaladas: 2 })],
      true,
    );
    expect(r.lineas[0].faltante).toBe(0);
    expect(r.estado).toBe('hecho');
    expect(r.totales.faltante).toBe(0);
  });

  it('un sobrante no compensa el faltante de otra presentacion en el total', () => {
    const r = armarCorte(
      [
        mov({ presentacionId: A, cargadas: 10, buenas: 7, merma: 1 }),
        mov({ presentacionId: B, cargadas: 5, buenas: 9 }),
        mov({ presentacionId: C, vendidas: 3 }),
      ],
      true,
    );
    expect(r.lineas.map((l) => l.faltante)).toEqual([3, -4, -3]);
    expect(r.totales).toEqual({
      cargadas: 15,
      vendidas: 3,
      regaladas: 0,
      deberiaRegresar: 12,
      buenas: 16,
      merma: 1,
      faltante: 3,
    });
  });

  it('sin hacer: faltantes y total en null, estado sin_corte', () => {
    const r = armarCorte([mov({ presentacionId: A, cargadas: 10 })], false);
    expect(r.lineas[0].faltante).toBeNull();
    expect(r.totales.faltante).toBeNull();
    expect(r.estado).toBe('sin_corte');
  });
});

describe('validarCorte', () => {
  const v = (fecha: string, lineas: { buenas: number; merma: number }[]) =>
    validarCorte(
      {
        fecha,
        lineas: lineas.map((l, i) => ({ presentacionId: [A, B, C][i], ...l })),
      },
      HOY,
    );

  it('acepta hoy, un dia anterior, ceros y un dia vacio', () => {
    expect(v(HOY, [{ buenas: 3, merma: 1 }])).toEqual([]);
    expect(v('2026-10-01', [{ buenas: 0, merma: 0 }])).toEqual([]);
    expect(v(HOY, [])).toEqual([]);
  });

  it('rechaza fecha futura o que no existe', () => {
    expect(v('2026-11-13', [])).toEqual([MENSAJE_FECHA_FUTURA]);
    expect(v('2026-02-30', [])).toEqual([MENSAJE_FECHA_INVALIDA]);
  });

  it('rechaza negativos o fracciones en buenas o merma', () => {
    expect(v(HOY, [{ buenas: -1, merma: 0 }])).toEqual([
      MENSAJE_CONTEO_INVALIDO,
    ]);
    expect(v(HOY, [{ buenas: 1, merma: 0.5 }])).toEqual([
      MENSAJE_CONTEO_INVALIDO,
    ]);
  });

  it('rechaza una presentacion repetida', () => {
    expect(
      validarCorte(
        {
          fecha: HOY,
          lineas: [
            { presentacionId: A, buenas: 1, merma: 0 },
            { presentacionId: A, buenas: 2, merma: 0 },
          ],
        },
        HOY,
      ),
    ).toEqual([MENSAJE_PRESENTACION_REPETIDA]);
  });
});

describe('planCorte', () => {
  it('crea las nuevas con piezas, corrige las que cambian y da de baja las que quedan en 0/0 o no vienen', () => {
    const plan = planCorte(
      [
        { id: 'f1', presentacionId: A, buenas: 5, merma: 0 },
        { id: 'f2', presentacionId: B, buenas: 2, merma: 1 },
        { id: 'f3', presentacionId: C, buenas: 1, merma: 0 },
      ],
      [
        { presentacionId: A, buenas: 5, merma: 2 },
        { presentacionId: B, buenas: 0, merma: 0 },
        {
          presentacionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3304',
          buenas: 0,
          merma: 4,
        },
        {
          presentacionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3305',
          buenas: 0,
          merma: 0,
        },
      ],
    );
    expect(plan.crear).toEqual([
      {
        presentacionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3304',
        buenas: 0,
        merma: 4,
      },
    ]);
    expect(plan.actualizar).toEqual([{ id: 'f1', buenas: 5, merma: 2 }]);
    expect(plan.borrar).toEqual(['f2', 'f3']);
  });

  it('sin cambios no hace nada', () => {
    const plan = planCorte(
      [{ id: 'f1', presentacionId: A, buenas: 5, merma: 1 }],
      [{ presentacionId: A, buenas: 5, merma: 1 }],
    );
    expect(plan).toEqual({ crear: [], actualizar: [], borrar: [] });
  });
});
