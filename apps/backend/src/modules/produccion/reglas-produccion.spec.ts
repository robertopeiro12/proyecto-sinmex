import {
  planDelDia,
  validarDia,
  type FilaViva,
  type LineaPedida,
} from './reglas-produccion';

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const C = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';
const HOY = '2026-10-22';

function dia(fecha: string, lineas: LineaPedida[]) {
  return validarDia({ fecha, lineas }, HOY);
}

describe('validarDia', () => {
  it('acepta hoy, un dia anterior y lineas en 0', () => {
    expect(dia(HOY, [{ presentacionId: A, piezas: 10 }])).toEqual([]);
    expect(dia('2026-10-01', [{ presentacionId: A, piezas: 0 }])).toEqual([]);
  });

  it('acepta un dia sin lineas (borrar todo el dia)', () => {
    expect(dia(HOY, [])).toEqual([]);
  });

  it('rechaza una fecha mal formada o que no existe', () => {
    for (const f of [
      '22/10/2026',
      '2026-1-5',
      '',
      'hoy',
      '2026-02-30',
      '2026-13-01',
    ]) {
      expect(dia(f, [])).toEqual(['La fecha no es válida.']);
    }
  });

  it('rechaza el futuro: manana en Tijuana, aunque hoy sea tarde', () => {
    expect(dia('2026-10-23', [])).toEqual([
      'La fecha no puede ser posterior a hoy.',
    ]);
    expect(
      validarDia({ fecha: '2026-10-22', lineas: [] }, '2026-10-22'),
    ).toEqual([]);
  });

  it('rechaza piezas negativas, decimales o no numericas', () => {
    for (const p of [-1, 1.5, NaN, Infinity, '3' as unknown as number]) {
      expect(dia(HOY, [{ presentacionId: A, piezas: p }])).toEqual([
        'Las piezas deben ser un número entero mayor o igual a 0.',
      ]);
    }
  });

  it('rechaza una presentacion repetida', () => {
    expect(
      dia(HOY, [
        { presentacionId: A, piezas: 1 },
        { presentacionId: A, piezas: 2 },
      ]),
    ).toEqual(['Una presentación viene repetida.']);
  });
});

describe('planDelDia', () => {
  const viva = (
    id: string,
    presentacionId: string,
    piezas: number,
  ): FilaViva => ({
    id,
    presentacionId,
    piezas,
  });

  it('crea la presentacion nueva con piezas', () => {
    expect(planDelDia([], [{ presentacionId: A, piezas: 5 }])).toEqual({
      crear: [{ presentacionId: A, piezas: 5 }],
      actualizar: [],
      borrar: [],
    });
  });

  it('actualiza la existente con piezas distintas y no toca la igual', () => {
    const plan = planDelDia(
      [viva('f-a', A, 5), viva('f-b', B, 7)],
      [
        { presentacionId: A, piezas: 9 },
        { presentacionId: B, piezas: 7 },
      ],
    );
    expect(plan).toEqual({
      crear: [],
      actualizar: [{ id: 'f-a', piezas: 9 }],
      borrar: [],
    });
  });

  it('borra la existente puesta en 0 o ausente', () => {
    const plan = planDelDia(
      [viva('f-a', A, 5), viva('f-b', B, 7), viva('f-c', C, 1)],
      [
        { presentacionId: A, piezas: 0 },
        { presentacionId: C, piezas: 1 },
      ],
    );
    expect(plan).toEqual({ crear: [], actualizar: [], borrar: ['f-a', 'f-b'] });
  });

  it('un 0 sin fila no hace nada', () => {
    expect(planDelDia([], [{ presentacionId: A, piezas: 0 }])).toEqual({
      crear: [],
      actualizar: [],
      borrar: [],
    });
  });
});
