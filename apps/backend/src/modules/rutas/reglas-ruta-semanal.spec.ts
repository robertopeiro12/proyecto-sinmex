import type { FilaViva } from './reemplazo-ruta';
import {
  diaSemanaDe,
  esFechaEditable,
  fechaLarga,
  nombreDia,
  planearPropagacion,
} from './reglas-ruta-semanal';

const fila = (
  id: string,
  orden: number,
  origen: FilaViva['origen'] = 'oficina',
): FilaViva => ({ id: `f-${id}`, clienteId: id, orden, origen, recado: null });

const set = (...xs: string[]) => new Set(xs);

describe('esFechaEditable', () => {
  it('hoy se puede editar y ayer no', () => {
    expect(esFechaEditable('2026-11-10', '2026-11-10')).toBe(true);
    expect(esFechaEditable('2026-11-11', '2026-11-10')).toBe(true);
    expect(esFechaEditable('2026-11-09', '2026-11-10')).toBe(false);
  });

  it('compara contra el "hoy" que se le da', () => {
    expect(esFechaEditable('2026-11-10', '2026-11-11')).toBe(false);
  });
});

describe('diaSemanaDe', () => {
  it('1 = lunes ... 6 = sabado, domingo = null', () => {
    expect(diaSemanaDe('2026-11-09')).toBe(1);
    expect(diaSemanaDe('2026-11-10')).toBe(2);
    expect(diaSemanaDe('2026-11-14')).toBe(6);
    expect(diaSemanaDe('2026-11-15')).toBeNull();
  });
});

describe('planearPropagacion', () => {
  it('agrega al final y respeta lo quitado a mano', () => {
    const plan = planearPropagacion(
      [fila('A', 1), fila('B', 2)],
      ['C', 'D'],
      set(),
      set('D'),
      set('A', 'B', 'C', 'D'),
    );
    expect(plan.insertar).toEqual([{ clienteId: 'C', orden: 3 }]);
    expect(plan.borrar).toEqual([]);
  });

  it('numera los agregados en el orden de la semanal', () => {
    const plan = planearPropagacion(
      [fila('A', 4)],
      ['C', 'D'],
      set(),
      set(),
      set('C', 'D'),
    );
    expect(plan.insertar).toEqual([
      { clienteId: 'C', orden: 5 },
      { clienteId: 'D', orden: 6 },
    ]);
  });

  it('no duplica lo que el vendedor ya agregó', () => {
    const plan = planearPropagacion(
      [fila('C', 1, 'vendedor')],
      ['C'],
      set(),
      set(),
      set('C'),
    );
    expect(plan.insertar).toEqual([]);
  });

  it('quita solo lo que vino de la semanal', () => {
    const plan = planearPropagacion(
      [fila('A', 1, 'semanal'), fila('B', 2, 'oficina')],
      [],
      set('A', 'B'),
      set(),
      set('A', 'B'),
    );
    expect(plan.borrar).toEqual([{ id: 'f-A', clienteId: 'A' }]);
  });

  it('un cliente quitado que ya no tiene fila viva no borra nada', () => {
    const plan = planearPropagacion([], [], set('A'), set(), set('A'));
    expect(plan.borrar).toEqual([]);
  });

  it('salta clientes no validos', () => {
    const plan = planearPropagacion([], ['X'], set(), set(), set());
    expect(plan.insertar).toEqual([]);
  });
});

describe('nombreDia y fechaLarga', () => {
  it('nombra el dia de la semana de 1 a 6', () => {
    expect(nombreDia(1)).toBe('lunes');
    expect(nombreDia(3)).toBe('miércoles');
    expect(nombreDia(6)).toBe('sábado');
  });

  it('escribe la fecha larga sin año', () => {
    expect(fechaLarga('2026-11-10')).toBe('martes 10 de noviembre');
    expect(fechaLarga('2099-01-05')).toBe('lunes 5 de enero');
    expect(fechaLarga('2026-11-15')).toBe('domingo 15 de noviembre');
  });
});
