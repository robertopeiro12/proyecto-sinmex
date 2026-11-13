import type { NotaAsignadaDeHoy } from '@/datos/notas-asignadas-reglas';
import { porAtender } from '@/datos/notas-asignadas-reglas';

import {
  crearGuardiaComentario,
  despuesDeContinuar,
  destinoAlVender,
  validarComentario,
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
