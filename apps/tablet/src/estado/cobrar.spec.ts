import type { NotaAsignadaDeHoy } from '@/datos/notas-asignadas-reglas';
import type { NotaPendiente } from '@/datos/tipos';

import { notaAlFrente, textoOtrasNotas, validarCobro } from './cobrar';

const nota = (id: string, fecha: string) => ({ id, fecha }) as unknown as NotaPendiente;
const notas = [nota('n2', '2026-11-10'), nota('n1', '2026-11-01'), nota('n3', '2026-11-20')];
const asignada = (ventaNotaId: string) =>
  ({
    asignacionId: 'as',
    ventaNotaId,
    clienteId: 'c',
    folio: 'f',
    fecha: '2026-11-10',
    saldoCentavos: 100,
    diasAtraso: 1,
    condicion: 'ninguna',
  }) as unknown as NotaAsignadaDeHoy;

describe('notaAlFrente', () => {
  it('la pedida', () => {
    expect(notaAlFrente(notas, [asignada('n3')], 'n2')?.id).toBe('n2');
  });
  it('la asignada si la pedida no está', () => {
    expect(notaAlFrente(notas, [asignada('n3')], null)?.id).toBe('n3');
    expect(notaAlFrente(notas, [asignada('n3')], 'nx')?.id).toBe('n3');
  });
  it('la primera por fecha', () => {
    expect(notaAlFrente(notas, [], null)?.id).toBe('n1');
    expect(notaAlFrente(notas, [asignada('fuera')], null)?.id).toBe('n1');
    expect(notaAlFrente([], [], null)).toBeNull();
  });
});

describe('validarCobro', () => {
  it('liquidar = saldo', () => {
    expect(validarCobro({ opcion: 'liquidar', montoTexto: '', saldoCentavos: 112000 })).toEqual({
      problemas: [],
      montoCentavos: 112000,
    });
  });
  it('abonar 400 sobre 1,120', () => {
    expect(validarCobro({ opcion: 'abonar', montoTexto: '400.00', saldoCentavos: 112000 })).toEqual({
      problemas: [],
      montoCentavos: 40000,
    });
  });
  it('abonar el saldo es problema', () => {
    const r = validarCobro({ opcion: 'abonar', montoTexto: '1120.00', saldoCentavos: 112000 });
    expect(r.problemas).toHaveLength(1);
    expect(r.montoCentavos).toBeNull();
  });
});

it('textoOtrasNotas', () => {
  expect(textoOtrasNotas(1)).toBe('Otras notas pendientes · 1');
});
