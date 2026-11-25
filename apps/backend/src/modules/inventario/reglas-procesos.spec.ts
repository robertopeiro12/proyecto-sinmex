import {
  MAX_LINEAS_PROCESO,
  precargaPorTamano,
  validarProceso,
  type EntradaProceso,
} from './reglas-procesos';

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const CLIENTE = '3f2504e0-4f89-41d3-9a0c-0305e82c3388';
const VENDEDOR = '3f2504e0-4f89-41d3-9a0c-0305e82c3399';
const HOY = '2026-11-25';

/** Una captura valida de cada tipo; `parcial` la pisa. */
function base(
  tipo: EntradaProceso['tipo'],
  parcial: Partial<EntradaProceso> = {},
): EntradaProceso {
  const comun: EntradaProceso = {
    tipo,
    fecha: HOY,
    hoy: HOY,
    mermaDe: null,
    clienteId: null,
    vendedorId: null,
    comentario: null,
    lineas: [{ presentacionId: A, sentido: 'entregado', piezas: 5 }],
  };
  if (tipo === 'merma' || tipo === 'cambio') {
    comun.clienteId = CLIENTE;
    comun.lineas = [
      { presentacionId: A, sentido: 'recibido', piezas: 5 },
      { presentacionId: B, sentido: 'entregado', piezas: 5 },
    ];
    if (tipo === 'merma') comun.mermaDe = 'cliente';
  }
  if (tipo === 'promocion') comun.clienteId = CLIENTE;
  if (tipo === 'descuento') comun.vendedorId = VENDEDOR;
  return { ...comun, ...parcial };
}

function error(e: EntradaProceso): string {
  const r = validarProceso(e);
  if (r.ok) throw new Error('Se esperaba un error y paso.');
  return r.error;
}

describe('validarProceso', () => {
  it('acepta una captura valida de cada tipo', () => {
    for (const tipo of [
      'merma',
      'cambio',
      'consumo',
      'promocion',
      'descuento',
    ] as const)
      expect(validarProceso(base(tipo)).ok).toBe(true);
    expect(
      validarProceso(
        base('merma', {
          mermaDe: 'almacen',
          clienteId: null,
          lineas: [{ presentacionId: A, sentido: 'recibido', piezas: 2 }],
        }),
      ).ok,
    ).toBe(true);
  });

  it('devuelve la captura limpia', () => {
    const r = validarProceso(
      base('consumo', {
        vendedorId: VENDEDOR.toUpperCase(),
        lineas: [
          { presentacionId: A.toUpperCase(), sentido: 'entregado', piezas: 3 },
        ],
      }),
    );
    expect(r).toEqual({
      ok: true,
      valor: {
        tipo: 'consumo',
        fecha: HOY,
        mermaDe: null,
        clienteId: null,
        vendedorId: VENDEDOR,
        comentario: null,
        lineas: [{ presentacionId: A, sentido: 'entregado', piezas: 3 }],
      },
    });
  });

  it('lo que no es del tipo se ignora (cliente en consumo, mermaDe fuera de merma)', () => {
    const r = validarProceso(
      base('consumo', { clienteId: CLIENTE, mermaDe: 'cliente' }),
    );
    expect(r.ok && r.valor).toMatchObject({ clienteId: null, mermaDe: null });
    const d = validarProceso(base('descuento', { clienteId: CLIENTE }));
    expect(d.ok && d.valor.clienteId).toBeNull();
    const m = validarProceso(
      base('merma', {
        mermaDe: 'almacen',
        clienteId: CLIENTE,
        lineas: [{ presentacionId: A, sentido: 'recibido', piezas: 2 }],
      }),
    );
    expect(m.ok && m.valor.clienteId).toBeNull();
  });

  it('recorta el comentario; vacio o solo espacios = null; mas de 300 = error', () => {
    const r = validarProceso(base('consumo', { comentario: '  Hola \n' }));
    expect(r.ok && r.valor.comentario).toBe('Hola');
    const v = validarProceso(base('consumo', { comentario: '\n\n  ' }));
    expect(v.ok && v.valor.comentario).toBeNull();
    const t = validarProceso(base('consumo', { comentario: '' }));
    expect(t.ok && t.valor.comentario).toBeNull();
    expect(
      validarProceso(base('consumo', { comentario: ` ${'x'.repeat(300)} ` }))
        .ok,
    ).toBe(true);
    expect(error(base('consumo', { comentario: 'x'.repeat(301) }))).toBe(
      'El comentario no puede pasar de 300 caracteres.',
    );
  });

  it('tipo desconocido', () => {
    expect(
      error(base('consumo', { tipo: 'robo' as EntradaProceso['tipo'] })),
    ).toBe('Elige el tipo de proceso.');
  });

  it('fecha mal formada, inexistente o futura', () => {
    expect(error(base('consumo', { fecha: 'hoy' }))).toBe(
      'La fecha no es válida.',
    );
    expect(error(base('consumo', { fecha: '2026-02-30' }))).toBe(
      'La fecha no es válida.',
    );
    expect(error(base('consumo', { fecha: '2026-11-26' }))).toBe(
      'La fecha no puede ser posterior a hoy.',
    );
    expect(validarProceso(base('consumo', { fecha: '2020-01-01' })).ok).toBe(
      true,
    );
  });

  it('merma: hay que decir de quien', () => {
    expect(error(base('merma', { mermaDe: null }))).toBe(
      'Elige si la merma es de un cliente o del almacén.',
    );
    expect(
      error(base('merma', { mermaDe: 'camion' as EntradaProceso['mermaDe'] })),
    ).toBe('Elige si la merma es de un cliente o del almacén.');
  });

  it('cliente obligatorio en merma de cliente, cambio y promocion', () => {
    for (const tipo of ['merma', 'cambio', 'promocion'] as const)
      expect(error(base(tipo, { clienteId: null }))).toBe('Elige un cliente.');
  });

  it('descuento: vendedor obligatorio (sin Oficina)', () => {
    expect(error(base('descuento', { vendedorId: null }))).toBe(
      'Un descuento tiene que ser de un vendedor.',
    );
  });

  it('el vendedor es opcional (Oficina) en los demas tipos', () => {
    for (const tipo of ['merma', 'cambio', 'consumo', 'promocion'] as const)
      expect(validarProceso(base(tipo, { vendedorId: null })).ok).toBe(true);
  });

  it('sentidos por tipo', () => {
    const recibido = [{ presentacionId: A, sentido: 'recibido', piezas: 1 }];
    expect(error(base('consumo', { lineas: recibido }))).toBe(
      'Un consumo solo lleva piezas entregadas.',
    );
    expect(error(base('promocion', { lineas: recibido }))).toBe(
      'Una promoción solo lleva piezas entregadas.',
    );
    expect(error(base('descuento', { lineas: recibido }))).toBe(
      'Un descuento solo lleva piezas entregadas.',
    );
    expect(
      error(
        base('merma', {
          mermaDe: 'almacen',
          clienteId: null,
          lineas: [{ presentacionId: A, sentido: 'entregado', piezas: 1 }],
        }),
      ),
    ).toBe('Una merma de almacén solo lleva piezas recibidas.');
    expect(
      error(
        base('consumo', {
          lineas: [{ presentacionId: A, sentido: 'regalado', piezas: 1 }],
        }),
      ),
    ).toBe('Una de las líneas no dice si se recibió o se entregó.');
  });

  it('merma de cliente y cambio llevan recibido y entregado', () => {
    for (const tipo of ['merma', 'cambio'] as const) {
      expect(
        error(
          base(tipo, {
            lineas: [{ presentacionId: A, sentido: 'recibido', piezas: 5 }],
          }),
        ),
      ).toBe('Captura lo que recibiste y lo que entregaste.');
      expect(
        error(
          base(tipo, {
            lineas: [{ presentacionId: A, sentido: 'entregado', piezas: 5 }],
          }),
        ),
      ).toBe('Captura lo que recibiste y lo que entregaste.');
    }
  });

  it('cuadre: total entregado = total recibido (5/5 ok, 5/3 error)', () => {
    for (const tipo of ['merma', 'cambio'] as const) {
      expect(
        validarProceso(
          base(tipo, {
            lineas: [
              { presentacionId: A, sentido: 'recibido', piezas: 5 },
              { presentacionId: A, sentido: 'entregado', piezas: 2 },
              { presentacionId: B, sentido: 'entregado', piezas: 3 },
            ],
          }),
        ).ok,
      ).toBe(true);
      expect(
        error(
          base(tipo, {
            lineas: [
              { presentacionId: A, sentido: 'recibido', piezas: 5 },
              { presentacionId: B, sentido: 'entregado', piezas: 3 },
            ],
          }),
        ),
      ).toBe('Lo entregado (3) no cuadra con lo recibido (5).');
    }
  });

  it('lineas: al menos una, maximo 200', () => {
    expect(error(base('consumo', { lineas: [] }))).toBe(
      'Captura al menos una presentación.',
    );
    const muchas = Array.from({ length: MAX_LINEAS_PROCESO + 1 }, (_, i) => ({
      presentacionId: `3f2504e0-4f89-41d3-9a0c-${String(i).padStart(12, '0')}`,
      sentido: 'entregado',
      piezas: 1,
    }));
    expect(error(base('consumo', { lineas: muchas }))).toBe(
      'Un proceso no puede llevar más de 200 presentaciones.',
    );
    expect(
      validarProceso(base('consumo', { lineas: muchas.slice(0, 200) })).ok,
    ).toBe(true);
  });

  it('piezas enteras de 1 a 100000', () => {
    for (const piezas of [0, -1, 1.5, 100_001, Number.NaN])
      expect(
        error(
          base('consumo', {
            lineas: [{ presentacionId: A, sentido: 'entregado', piezas }],
          }),
        ),
      ).toBe('Las piezas deben ser un número entero entre 1 y 100000.');
  });

  it('una linea por presentacion y sentido', () => {
    expect(
      error(
        base('consumo', {
          lineas: [
            { presentacionId: A, sentido: 'entregado', piezas: 1 },
            {
              presentacionId: A.toUpperCase(),
              sentido: 'entregado',
              piezas: 2,
            },
          ],
        }),
      ),
    ).toBe('Una presentación viene repetida.');
    // La misma presentacion recibida y entregada si se vale (cambio de 5 por 5).
    expect(
      validarProceso(
        base('cambio', {
          lineas: [
            { presentacionId: A, sentido: 'recibido', piezas: 5 },
            { presentacionId: A, sentido: 'entregado', piezas: 5 },
          ],
        }),
      ).ok,
    ).toBe(true);
  });
});

describe('precargaPorTamano (D1 del corte: un tamano no compensa a otro)', () => {
  const l = (
    presentacionId: string,
    nombre: string,
    volumen: string,
    faltante: number | null,
  ) => ({ presentacionId, nombre, volumen, faltante });
  const H1 = l('h1', 'Horchata 1 L', '1 L', 3);
  const J1 = l('j1', 'Jamaica 1 L', '1 L', -3);

  it('lo que sobra de un sabor tapa lo que falta de otro del mismo tamano', () => {
    expect(precargaPorTamano([H1, J1])).toEqual([]);
  });

  it('neto positivo: se precarga solo el neto', () => {
    expect(
      precargaPorTamano([
        l('h1', 'Horchata 1 L', '1 L', 5),
        l('j1', 'Jamaica 1 L', '1 L', -3),
      ]),
    ).toEqual([{ presentacionId: 'h1', nombre: 'Horchata 1 L', piezas: 2 }]);
  });

  it('el neto se reparte de mayor faltante a menor hasta sumar exacto', () => {
    expect(
      precargaPorTamano([
        l('h1', 'Horchata 1 L', '1 L', 3),
        l('j1', 'Jamaica 1 L', '1 L', -1),
        l('l1', 'Limonada 1 L', '1 L', 2),
      ]),
    ).toEqual([
      { presentacionId: 'h1', nombre: 'Horchata 1 L', piezas: 3 },
      { presentacionId: 'l1', nombre: 'Limonada 1 L', piezas: 1 },
    ]);
  });

  it('empate de faltante: primero por nombre', () => {
    expect(
      precargaPorTamano([
        l('t1', 'Tamarindo 1 L', '1 L', 2),
        l('h1', 'Horchata 1 L', '1 L', 2),
        l('j1', 'Jamaica 1 L', '1 L', -1),
      ]),
    ).toEqual([
      { presentacionId: 't1', nombre: 'Tamarindo 1 L', piezas: 1 },
      { presentacionId: 'h1', nombre: 'Horchata 1 L', piezas: 2 },
    ]);
  });

  it('dos tamanos son independientes y la clave ignora mayusculas y espacios', () => {
    expect(
      precargaPorTamano([
        l('h5', 'Horchata 500 ml', '500 ml', 4),
        l('j5', 'Jamaica 500ML', '500ML', -1),
        l('h1', 'Horchata 1 L', '1 L', -2),
        l('j1', 'Jamaica 1 L', '1 L', 1),
      ]),
    ).toEqual([{ presentacionId: 'h5', nombre: 'Horchata 500 ml', piezas: 3 }]);
  });

  it('sin corte (faltante null) no precarga nada', () => {
    expect(precargaPorTamano([l('h1', 'Horchata 1 L', '1 L', null)])).toEqual(
      [],
    );
  });
});
