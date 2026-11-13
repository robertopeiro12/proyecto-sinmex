import type { NotaAsignadaDeHoy } from '@/datos/notas-asignadas-reglas';
import { porAtender } from '@/datos/notas-asignadas-reglas';

import {
  agruparNotasParaCobrar,
  crearGuardiaComentario,
  despuesDeContinuar,
  destinoAlVender,
  etiquetaCondicionPendiente,
  notaParaCobrar,
  validarComentario,
  venderDesdeFicha,
} from './notas-asignadas';

const nota = (cambios: Partial<NotaAsignadaDeHoy> = {}): NotaAsignadaDeHoy => ({
  asignacionId: 'asg-1',
  ventaNotaId: 'nota-1',
  clienteId: 'cli-1',
  folio: 'TJ260801AP01',
  fecha: '2026-08-01',
  saldoCentavos: 15000,
  diasAtraso: 0,
  condicion: 'ninguna',
  tocadaHoy: false,
  liquidadaHoy: false,
  comentadaHoy: false,
  ...cambios,
});

describe('destinoAlVender', () => {
  it('con notas por atender y sin haberlas visto, pasa por las notas', () => {
    expect(destinoAlVender([nota()], false)).toEqual({ tipo: 'notas', siguiente: 'venta' });
  });
  it('si ya las vio en esta visita, va a la venta', () => {
    expect(destinoAlVender([nota()], true)).toEqual({ tipo: 'venta' });
  });
  it('sin notas por atender, va a la venta', () => {
    expect(destinoAlVender([], false)).toEqual({ tipo: 'venta' });
  });
  it('Review Focus 5: comentada sin cobrar sigue pidiendo notas; cobrada ya no', () => {
    const comentada = [nota({ comentadaHoy: true })];
    expect(destinoAlVender(porAtender(comentada), false)).toEqual({ tipo: 'notas', siguiente: 'venta' });
    const cobrada = [nota({ comentadaHoy: true, tocadaHoy: true, saldoCentavos: 5000 })];
    expect(destinoAlVender(porAtender(cobrada), false)).toEqual({ tipo: 'venta' });
  });
});

describe('despuesDeContinuar', () => {
  it('sin condicion pendiente y con siguiente venta, va a la venta', () => {
    expect(despuesDeContinuar([nota()], 'venta')).toEqual({ tipo: 'venta' });
  });
  it('con condicion pendiente, vuelve a la ficha con el motivo', () => {
    expect(despuesDeContinuar([nota({ condicion: 'liquidar' })], 'venta')).toEqual({
      tipo: 'ficha',
      motivo: 'Tiene una nota asignada que debe liquidar antes de venderle',
    });
  });
  it('sin siguiente, vuelve a la ficha sin motivo si no hay bloqueo', () => {
    expect(despuesDeContinuar([nota()], null)).toEqual({ tipo: 'ficha', motivo: null });
  });
  it('sin siguiente y con bloqueo, la ficha trae el motivo', () => {
    expect(despuesDeContinuar([nota({ condicion: 'abonar' })], null)).toEqual({
      tipo: 'ficha',
      motivo: 'Tiene una nota asignada que debe abonar antes de venderle',
    });
  });
});

describe('validarComentario', () => {
  it('vacio o solo espacios', () => {
    expect(validarComentario('   ')).toBe('Escribe por qué no te pagó.');
  });
  it('mas de 300 recortado', () => {
    expect(validarComentario('a'.repeat(301))).toBe('El comentario admite hasta 300 caracteres.');
    expect(validarComentario(` ${'a'.repeat(300)} `)).toBeNull();
  });
  it('valido', () => {
    expect(validarComentario('No estaba el dueño')).toBeNull();
  });
});

describe('crearGuardiaComentario', () => {
  it('ignora el segundo toque tras grabar', () => {
    const guardia = crearGuardiaComentario();
    expect(guardia.intentar(() => 1)).toBe(1);
    expect(guardia.intentar(() => 2)).toBeNull();
  });
});

describe('venderDesdeFicha', () => {
  it('sin asignadas: a la venta, sin bloqueo', () => {
    expect(venderDesdeFicha([])).toEqual({ destino: { tipo: 'venta' }, bloqueo: null });
  });
  it('con una por atender: primero las notas y Vender sigue habilitado (la pantalla de la nota decide)', () => {
    expect(venderDesdeFicha([nota({ condicion: 'liquidar' })])).toEqual({
      destino: { tipo: 'notas', siguiente: 'venta' },
      bloqueo: null,
    });
  });
  it('comentada sin cumplir la condicion: sigue por atender, no se deshabilita', () => {
    expect(venderDesdeFicha([nota({ condicion: 'abonar', comentadaHoy: true })]).bloqueo).toBeNull();
  });
  it('sin por atender pero con la condicion sin cumplir: Vender deshabilitado con el motivo', () => {
    // Abono parcial de hoy a una nota que debe liquidar: ya no se pide, pero bloquea.
    const abonada = nota({ condicion: 'liquidar', tocadaHoy: true, saldoCentavos: 5000 });
    expect(venderDesdeFicha([abonada])).toEqual({
      destino: { tipo: 'venta' },
      bloqueo: 'Tiene una nota asignada que debe liquidar antes de venderle',
    });
  });
  it('cumplida: a la venta sin bloqueo', () => {
    const abonada = nota({ condicion: 'abonar', tocadaHoy: true, saldoCentavos: 5000 });
    expect(venderDesdeFicha([abonada])).toEqual({ destino: { tipo: 'venta' }, bloqueo: null });
  });
});

describe('agruparNotasParaCobrar', () => {
  const pendiente = (id: string) => ({ id, folio: `F-${id}` });

  it('separa las asignadas (con su etiqueta) de las otras, en el orden de entrada', () => {
    const grupos = agruparNotasParaCobrar(
      [pendiente('n1'), pendiente('n2'), pendiente('n3')],
      [nota({ ventaNotaId: 'n3', condicion: 'liquidar' }), nota({ ventaNotaId: 'n1', condicion: 'ninguna' })],
    );
    expect(grupos.asignadas).toEqual([
      { nota: pendiente('n1'), etiqueta: null },
      { nota: pendiente('n3'), etiqueta: 'Debe liquidar' },
    ]);
    expect(grupos.otras).toEqual([pendiente('n2')]);
  });

  it('sin asignadas, todas son otras', () => {
    expect(agruparNotasParaCobrar([pendiente('n1')], [])).toEqual({ asignadas: [], otras: [pendiente('n1')] });
  });

  it('una asignada que ya no esta entre las pendientes no aparece', () => {
    expect(agruparNotasParaCobrar([pendiente('n1')], [nota({ ventaNotaId: 'n9' })]).asignadas).toEqual([]);
  });
});

describe('agruparNotasParaCobrar con saldo 0 (fix T8)', () => {
  it('una asignada ya en saldo 0 (liquidada sin red) va a las otras, sin etiqueta', () => {
    const grupos = agruparNotasParaCobrar(
      [{ id: 'n1' }, { id: 'n2' }],
      [
        nota({ ventaNotaId: 'n1', condicion: 'liquidar', saldoCentavos: 0, tocadaHoy: true, liquidadaHoy: true }),
        nota({ ventaNotaId: 'n2', condicion: 'abonar' }),
      ],
    );
    expect(grupos.asignadas).toEqual([{ nota: { id: 'n2' }, etiqueta: 'Debe abonar' }]);
    expect(grupos.otras).toEqual([{ id: 'n1' }]);
  });

  it('una asignada con la condicion ya cumplida hoy sigue en su grupo pero sin "Debe ..."', () => {
    const grupos = agruparNotasParaCobrar(
      [{ id: 'n1' }],
      [nota({ ventaNotaId: 'n1', condicion: 'abonar', tocadaHoy: true, saldoCentavos: 5000 })],
    );
    expect(grupos.asignadas).toEqual([{ nota: { id: 'n1' }, etiqueta: null }]);
  });
});

describe('etiquetaCondicionPendiente', () => {
  it('dice la condicion mientras no se cumpla', () => {
    expect(etiquetaCondicionPendiente(nota({ condicion: 'liquidar' }))).toBe('Debe liquidar');
    expect(etiquetaCondicionPendiente(nota({ condicion: 'abonar' }))).toBe('Debe abonar');
  });
  it('nada con ninguna ni con la condicion cumplida hoy', () => {
    expect(etiquetaCondicionPendiente(nota({ condicion: 'ninguna' }))).toBeNull();
    expect(etiquetaCondicionPendiente(nota({ condicion: 'abonar', tocadaHoy: true }))).toBeNull();
    expect(etiquetaCondicionPendiente(nota({ condicion: 'liquidar', liquidadaHoy: true, tocadaHoy: true }))).toBeNull();
  });
});

describe('notaParaCobrar', () => {
  it('la primera por atender', () => {
    const notas = [
      nota({ ventaNotaId: 'n1', tocadaHoy: true, condicion: 'abonar' }),
      nota({ ventaNotaId: 'n2' }),
    ];
    expect(notaParaCobrar(notas)).toBe('n2');
  });
  it('sin por atender, la primera que aun no cumple (abono parcial a una que debe liquidar)', () => {
    const notas = [
      nota({ ventaNotaId: 'n1', tocadaHoy: true, condicion: 'abonar' }),
      nota({ ventaNotaId: 'n2', tocadaHoy: true, condicion: 'liquidar', saldoCentavos: 5000 }),
    ];
    expect(notaParaCobrar(notas)).toBe('n2');
  });
  it('nada que cobrar: null', () => {
    expect(notaParaCobrar([])).toBeNull();
    expect(notaParaCobrar([nota({ tocadaHoy: true, condicion: 'abonar' })])).toBeNull();
  });
});
