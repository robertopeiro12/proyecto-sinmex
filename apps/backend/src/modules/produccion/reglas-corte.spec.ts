import {
  armarCorte,
  claveTamano,
  compararTamano,
  deberiaRegresar,
  estadoCorte,
  existenciasPorPresentacion,
  faltante,
  faltanteDelDia,
  mermaTeorica,
  mililitros,
  MENSAJE_CONTEO_INVALIDO,
  planCorte,
  validarCorte,
  type MovimientoPresentacion,
} from './reglas-corte';
import {
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MENSAJE_PRESENTACION_REPETIDA,
} from './reglas-comunes';

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const C = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';
const HOY = '2026-11-12';

const mov = (
  parcial: Partial<MovimientoPresentacion> & { presentacionId: string },
): MovimientoPresentacion => ({
  nombre: 'Horchata 1 L',
  producto: 'Horchata',
  volumen: '1 L',
  cargadas: 0,
  vendidas: 0,
  regaladas: 0,
  buenas: 0,
  merma: 0,
  mermaEntregada: 0,
  mermaRecibida: 0,
  mermaAlmacen: 0,
  consumo: 0,
  cambiosEntregados: 0,
  cambiosRecibidos: 0,
  ...parcial,
});

const cero = {
  cargadas: 0,
  vendidas: 0,
  regaladas: 0,
  mermaEntregada: 0,
  mermaAlmacen: 0,
  consumo: 0,
  cambiosEntregados: 0,
  cambiosRecibidos: 0,
};

describe('deberiaRegresar', () => {
  it('ejemplo del cliente, 500 ml Horchata: 1000 − 800 − 10 − 5 − 1 = 184', () => {
    expect(
      deberiaRegresar({
        ...cero,
        cargadas: 1000,
        vendidas: 800,
        mermaEntregada: 10,
        cambiosEntregados: 5,
        consumo: 1,
      }),
    ).toBe(184);
  });

  it('ejemplo del cliente, Jamaica: 800 − 750 − 5 + 5 = 50', () => {
    expect(
      deberiaRegresar({
        ...cero,
        cargadas: 800,
        vendidas: 750,
        cambiosRecibidos: 5,
        regaladas: 5,
      }),
    ).toBe(50);
  });

  it('ejemplo del cliente, Tamarindo: 750 − 720 − 2 = 28', () => {
    expect(
      deberiaRegresar({
        ...cero,
        cargadas: 750,
        vendidas: 720,
        mermaEntregada: 2,
      }),
    ).toBe(28);
  });

  it.each([
    ['vendidas', -1],
    ['regaladas', -1],
    ['mermaEntregada', -1],
    ['mermaAlmacen', -1],
    ['consumo', -1],
    ['cambiosEntregados', -1],
    ['cambiosRecibidos', 1],
  ] as const)('%s mueve la teorica en %i', (campo, efecto) => {
    expect(deberiaRegresar({ ...cero, cargadas: 10, [campo]: 1 })).toBe(
      10 + efecto,
    );
  });

  it('no se recorta: vender mas de lo cargado da negativo', () => {
    expect(deberiaRegresar({ ...cero, vendidas: 5, regaladas: 1 })).toBe(-6);
  });
});

describe('mermaTeorica', () => {
  it('es merma recibida + merma de almacen', () => {
    expect(mermaTeorica({ mermaRecibida: 8, mermaAlmacen: 2 })).toBe(10);
  });
});

describe('claveTamano', () => {
  it('minusculas y sin espacios', () => {
    expect(claveTamano('500 ml')).toBe('500ml');
    expect(claveTamano('500ML')).toBe('500ml');
    expect(claveTamano(' 500ml ')).toBe('500ml');
  });
});

describe('mililitros', () => {
  it('lee ml y litros, con punto o coma decimal', () => {
    expect(mililitros('355 ml')).toBe(355);
    expect(mililitros('1 L')).toBe(1000);
    expect(mililitros('1.5 L')).toBe(1500);
    expect(mililitros('1,5 lt')).toBe(1500);
  });

  it('lo que no se lee es null', () => {
    expect(mililitros('Garrafón')).toBeNull();
  });
});

describe('compararTamano', () => {
  it('ordena por mililitros y deja al final lo ilegible', () => {
    expect(
      ['1 L', 'Garrafón', '355 ml', '600 ml', '500ml'].sort(compararTamano),
    ).toEqual(['355 ml', '500ml', '600 ml', '1 L', 'Garrafón']);
  });
});

describe('faltanteDelDia', () => {
  const l = (volumen: string, valor: number | null) => ({ volumen, valor });

  it('ejemplo del cliente 355 ml: −1 y +1 dan 0', () => {
    expect(faltanteDelDia([l('355 ml', -1), l('355 ml', 1)])).toBe(0);
  });

  it('500 ml: 0, 1, 0 dan 1', () => {
    expect(
      faltanteDelDia([l('500 ml', 0), l('500 ml', 1), l('500 ml', 0)]),
    ).toBe(1);
  });

  it('un tamano no tapa a otro (D1): 355 ml +2 y 500 ml −3 dan 2', () => {
    expect(faltanteDelDia([l('355 ml', 2), l('500 ml', -3)])).toBe(2);
  });

  it('el mismo tamano escrito distinto es un solo tamano', () => {
    expect(faltanteDelDia([l('500 ml', 2), l('500ML', -1)])).toBe(1);
  });

  it('null cuenta como 0', () => {
    expect(faltanteDelDia([l('355 ml', null), l('355 ml', 2)])).toBe(2);
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
    expect(estadoCorte(false, { faltante: null, faltanteMerma: null })).toBe(
      'sin_corte',
    );
  });

  it('hecho sin faltantes = hecho', () => {
    expect(estadoCorte(true, { faltante: 0, faltanteMerma: 0 })).toBe('hecho');
  });

  it('hecho con faltante de piezas o de merma = con_faltante', () => {
    expect(estadoCorte(true, { faltante: 1, faltanteMerma: 0 })).toBe(
      'con_faltante',
    );
    expect(estadoCorte(true, { faltante: 0, faltanteMerma: 1 })).toBe(
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
    expect(r.totales.faltanteMerma).toBe(0);
  });

  it('un tamano no tapa a otro en el total del dia (D1)', () => {
    const r = armarCorte(
      [
        mov({ presentacionId: A, volumen: '500 ml', cargadas: 10, buenas: 7 }),
        mov({ presentacionId: B, volumen: '355 ml', cargadas: 5, buenas: 9 }),
        mov({ presentacionId: C, volumen: '1 L', vendidas: 3 }),
      ],
      true,
    );
    // Orden por tamano: 355 ml, 500 ml, 1 L.
    expect(r.lineas.map((l) => l.presentacionId)).toEqual([B, A, C]);
    expect(r.lineas.map((l) => l.faltante)).toEqual([-4, 3, -3]);
    expect(r.totales.faltante).toBe(3);
  });

  it('ejemplo del Excel, 355 ml: piezas -1, +1, 0 dan faltante 0', () => {
    const r = armarCorte(
      [
        mov({
          presentacionId: A,
          producto: 'Horchata',
          volumen: '355 ml',
          cargadas: 1000,
          vendidas: 800,
          mermaEntregada: 10,
          cambiosEntregados: 5,
          consumo: 1,
          buenas: 185,
        }),
        mov({
          presentacionId: B,
          producto: 'Jamaica',
          volumen: '355 ml',
          cargadas: 800,
          vendidas: 750,
          regaladas: 5,
          cambiosRecibidos: 5,
          buenas: 49,
        }),
        mov({
          presentacionId: C,
          producto: 'Tamarindo',
          volumen: '355 ml',
          cargadas: 750,
          vendidas: 720,
          mermaEntregada: 2,
          buenas: 28,
        }),
      ],
      true,
    );
    expect(r.lineas.map((l) => l.deberiaRegresar)).toEqual([184, 50, 28]);
    expect(r.lineas.map((l) => l.faltante)).toEqual([-1, 1, 0]);
    expect(r.totales.faltante).toBe(0);
  });

  it('ejemplo del Excel, merma 355 ml: resultados 0, 1 y 0; faltan 1 de merma', () => {
    const r = armarCorte(
      [
        mov({
          presentacionId: A,
          producto: 'Horchata',
          volumen: '355 ml',
          mermaRecibida: 8,
          mermaAlmacen: 2,
          merma: 10,
        }),
        mov({
          presentacionId: B,
          producto: 'Jamaica',
          volumen: '355 ml',
          mermaRecibida: 2,
          merma: 1,
        }),
        mov({ presentacionId: C, producto: 'Tamarindo', volumen: '355 ml' }),
      ],
      true,
    );
    expect(r.lineas.map((l) => l.mermaTeorica)).toEqual([10, 2, 0]);
    expect(r.lineas.map((l) => l.resultadoMerma)).toEqual([0, 1, 0]);
    expect(r.totales.mermaTeorica).toBe(12);
    expect(r.totales.mermaAlmacen).toBe(2);
    expect(r.totales.mermaRecibida).toBe(10);
    expect(r.totales.faltanteMerma).toBe(1);
    expect(r.estado).toBe('con_faltante');
  });

  it('sin hacer: resultados y totales de faltante en null, estado sin_corte', () => {
    const r = armarCorte([mov({ presentacionId: A, cargadas: 10 })], false);
    expect(r.lineas[0].faltante).toBeNull();
    expect(r.lineas[0].resultadoMerma).toBeNull();
    expect(r.totales.faltante).toBeNull();
    expect(r.totales.faltanteMerma).toBeNull();
    expect(r.estado).toBe('sin_corte');
  });

  it('ordena por tamano, luego producto, luego presentacion', () => {
    const r = armarCorte(
      [
        mov({ presentacionId: C, producto: 'Jamaica', volumen: '1 L' }),
        mov({ presentacionId: B, producto: 'Tamarindo', volumen: '500ml' }),
        mov({ presentacionId: A, producto: 'Horchata', volumen: '500 ml' }),
        mov({ presentacionId: '4', producto: 'Agua', volumen: 'Garrafón' }),
      ],
      false,
    );
    expect(r.lineas.map((l) => l.presentacionId)).toEqual([A, B, C, '4']);
  });

  it('suma los conceptos nuevos en los totales', () => {
    const r = armarCorte(
      [
        mov({
          presentacionId: A,
          cargadas: 20,
          mermaEntregada: 1,
          mermaRecibida: 2,
          mermaAlmacen: 3,
          consumo: 4,
          cambiosEntregados: 1,
          cambiosRecibidos: 2,
        }),
        mov({
          presentacionId: B,
          mermaEntregada: 1,
          mermaRecibida: 1,
          mermaAlmacen: 1,
          consumo: 1,
          cambiosEntregados: 1,
          cambiosRecibidos: 1,
        }),
      ],
      true,
    );
    expect(r.totales).toMatchObject({
      mermaEntregada: 2,
      mermaRecibida: 3,
      mermaAlmacen: 4,
      consumo: 5,
      cambiosEntregados: 2,
      cambiosRecibidos: 3,
      mermaTeorica: 7,
    });
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

describe('existenciasPorPresentacion', () => {
  it('es deberia regresar por presentacion, sin recortar el negativo', () => {
    const mapa = existenciasPorPresentacion([
      mov({ presentacionId: A, cargadas: 20, vendidas: 5, regaladas: 2 }),
      mov({ presentacionId: B, vendidas: 3 }),
    ]);
    expect(mapa).toEqual(
      new Map([
        [A, 13],
        [B, -3],
      ]),
    );
  });

  it('descuenta merma entregada, de almacen y consumo; la recibida no suma', () => {
    const mapa = existenciasPorPresentacion([
      mov({
        presentacionId: A,
        cargadas: 20,
        vendidas: 5,
        regaladas: 2,
        mermaEntregada: 2,
        mermaAlmacen: 1,
        consumo: 1,
        mermaRecibida: 5,
      }),
    ]);
    expect(mapa.get(A)).toBe(20 - 5 - 2 - 4);
  });
});
