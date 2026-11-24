import {
  retiroEditable,
  retiroResoluble,
  validarMotivoRechazo,
  diaAnterior,
  fechaPermitida,
  planLineas,
  validarOperacion,
  type EntradaOperacion,
} from './reglas-operacion';

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const C = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';
const M = '3f2504e0-4f89-41d3-9a0c-0305e82c3399';
const HOY = '2026-11-24';

function base(parcial: Partial<EntradaOperacion>): EntradaOperacion {
  return {
    tipo: 'consumo',
    fecha: HOY,
    sucursal: 'TJ',
    lineas: [{ presentacionId: A, piezas: 10 }],
    ...parcial,
  };
}
const errores = (p: Partial<EntradaOperacion>) =>
  validarOperacion(base(p), HOY);

describe('diaAnterior', () => {
  it('cruza mes y año', () => {
    expect(diaAnterior('2026-11-24')).toBe('2026-11-23');
    expect(diaAnterior('2026-12-01')).toBe('2026-11-30');
    expect(diaAnterior('2026-01-01')).toBe('2025-12-31');
  });
});

describe('fechaPermitida', () => {
  it('entrada, merma, consumo y descuento: cualquier dia hasta hoy', () => {
    for (const t of ['entrada', 'merma', 'consumo', 'descuento'] as const) {
      expect(fechaPermitida(t, HOY, HOY)).toBe(true);
      expect(fechaPermitida(t, '2020-01-01', HOY)).toBe(true);
      expect(fechaPermitida(t, '2026-11-25', HOY)).toBe(false);
    }
  });

  it('envio: solo hoy o ayer', () => {
    expect(fechaPermitida('envio', HOY, HOY)).toBe(true);
    expect(fechaPermitida('envio', '2026-11-23', HOY)).toBe(true);
    expect(fechaPermitida('envio', '2026-11-22', HOY)).toBe(false);
    expect(fechaPermitida('envio', '2026-11-25', HOY)).toBe(false);
  });
});

describe('validarOperacion', () => {
  it('acepta una captura valida de cada tipo', () => {
    expect(errores({ tipo: 'consumo' })).toEqual([]);
    expect(errores({ tipo: 'entrada', origen: 'compra' })).toEqual([]);
    expect(errores({ tipo: 'envio', destino: 'MX' })).toEqual([]);
    expect(errores({ tipo: 'merma', motivoId: M })).toEqual([]);
    expect(errores({ tipo: 'descuento', trabajador: ' Ana ' })).toEqual([]);
  });

  it('rechaza una fecha mal formada o que no existe', () => {
    expect(errores({ fecha: '2026-02-30' })).toEqual([
      'La fecha no es válida.',
    ]);
    expect(errores({ fecha: 'hoy' })).toEqual(['La fecha no es válida.']);
  });

  it('rechaza el futuro en todos los tipos', () => {
    expect(errores({ fecha: '2026-11-25' })).toEqual([
      'La fecha no puede ser posterior a hoy.',
    ]);
  });

  it('un envio de antier lo dice con su propio mensaje', () => {
    expect(
      errores({ tipo: 'envio', destino: 'MX', fecha: '2026-11-22' }),
    ).toEqual(['Un envío solo puede ser de hoy o de ayer.']);
    expect(
      errores({ tipo: 'envio', destino: 'MX', fecha: '2026-11-25' }),
    ).toEqual(['La fecha no puede ser posterior a hoy.']);
  });

  it('la entrada pide origen produccion o compra', () => {
    expect(errores({ tipo: 'entrada' })).toEqual([
      'Elige si la entrada es de producción o de compra.',
    ]);
    expect(errores({ tipo: 'entrada', origen: 'robo' })).toEqual([
      'Elige si la entrada es de producción o de compra.',
    ]);
  });

  it('el envio pide destino y distinto de la sucursal', () => {
    expect(errores({ tipo: 'envio' })).toEqual([
      'Elige la sucursal de destino.',
    ]);
    expect(errores({ tipo: 'envio', destino: 'tj' })).toEqual([
      'El destino tiene que ser otra sucursal.',
    ]);
  });

  it('la merma pide motivo', () => {
    expect(errores({ tipo: 'merma' })).toEqual([
      'Elige el motivo de la merma.',
    ]);
  });

  it('el descuento pide trabajador de 1 a 120 caracteres ya recortado', () => {
    expect(errores({ tipo: 'descuento' })).toEqual([
      'Escribe el nombre del trabajador.',
    ]);
    expect(errores({ tipo: 'descuento', trabajador: '   ' })).toEqual([
      'Escribe el nombre del trabajador.',
    ]);
    expect(errores({ tipo: 'descuento', trabajador: 'x'.repeat(121) })).toEqual(
      ['El nombre del trabajador no puede pasar de 120 caracteres.'],
    );
    expect(errores({ tipo: 'descuento', trabajador: 'x'.repeat(120) })).toEqual(
      [],
    );
  });

  it('el comentario pasa hasta 300', () => {
    expect(errores({ comentario: 'x'.repeat(300) })).toEqual([]);
    expect(errores({ comentario: 'x'.repeat(301) })).toEqual([
      'El comentario no puede pasar de 300 caracteres.',
    ]);
  });

  it('pide al menos una linea', () => {
    expect(errores({ lineas: [] })).toEqual([
      'Captura al menos una presentación.',
    ]);
  });

  it('rechaza piezas fuera de 1 a 100000, decimales o no numericas', () => {
    for (const p of [0, -1, 1.5, NaN, 100001, '3' as unknown as number]) {
      expect(errores({ lineas: [{ presentacionId: A, piezas: p }] })).toEqual([
        'Las piezas deben ser un número entero entre 1 y 100000.',
      ]);
    }
    expect(
      errores({ lineas: [{ presentacionId: A, piezas: 100000 }] }),
    ).toEqual([]);
  });

  it('rechaza una presentacion repetida', () => {
    expect(
      errores({
        lineas: [
          { presentacionId: A, piezas: 1 },
          { presentacionId: A, piezas: 2 },
        ],
      }),
    ).toEqual(['Una presentación viene repetida.']);
  });

  it('tope de 200 lineas', () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        presentacionId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        piezas: 1,
      }));
    expect(errores({ lineas: ids(200) })).toEqual([]);
    expect(errores({ lineas: ids(201) })).toEqual([
      'Una operación no puede llevar más de 200 presentaciones.',
    ]);
  });
});

describe('planLineas', () => {
  const vivas = [
    { id: 'l1', presentacionId: A, piezas: 5 },
    { id: 'l2', presentacionId: B, piezas: 7 },
  ];

  it('crea lo nuevo, corrige lo distinto, borra lo que ya no viene y deja lo igual', () => {
    const plan = planLineas(vivas, [
      { presentacionId: A, piezas: 5 },
      { presentacionId: C, piezas: 3 },
    ]);
    expect(plan.crear).toEqual([{ presentacionId: C, piezas: 3 }]);
    expect(plan.actualizar).toEqual([]);
    expect(plan.borrar).toEqual(['l2']);
    expect(
      planLineas(vivas, [
        { presentacionId: A, piezas: 9 },
        { presentacionId: B, piezas: 7 },
      ]),
    ).toEqual({
      crear: [],
      actualizar: [{ id: 'l1', piezas: 9 }],
      borrar: [],
    });
  });
});

describe('Retiro de merma', () => {
  it('admite hoy y cualquier dia anterior, no futuro', () => {
    expect(fechaPermitida('retiro_merma', HOY, HOY)).toBe(true);
    expect(fechaPermitida('retiro_merma', '2026-01-02', HOY)).toBe(true);
    expect(fechaPermitida('retiro_merma', '2026-11-25', HOY)).toBe(false);
  });

  it('se captura como cualquier operacion con lineas', () => {
    expect(errores({ tipo: 'retiro_merma' })).toEqual([]);
    expect(errores({ tipo: 'retiro_merma', lineas: [] })).not.toEqual([]);
  });

  it('transiciones: pendiente y rechazado se corrigen; autorizado es final', () => {
    expect(retiroEditable('pendiente')).toBe(true);
    expect(retiroEditable('rechazado')).toBe(true);
    expect(retiroEditable('autorizado')).toBe(false);
  });

  it('solo un pendiente se autoriza o rechaza', () => {
    expect(retiroResoluble('pendiente')).toBe(true);
    expect(retiroResoluble('autorizado')).toBe(false);
    expect(retiroResoluble('rechazado')).toBe(false);
    expect(retiroResoluble(null)).toBe(false);
  });

  it('el motivo del rechazo: obligatorio y de 300 como mucho', () => {
    expect(validarMotivoRechazo('No coincide')).toEqual([]);
    expect(validarMotivoRechazo('x'.repeat(300))).toEqual([]);
    expect(validarMotivoRechazo('   ')).toHaveLength(1);
    expect(validarMotivoRechazo(undefined)).toHaveLength(1);
    expect(validarMotivoRechazo('x'.repeat(301))).toHaveLength(1);
  });
});
