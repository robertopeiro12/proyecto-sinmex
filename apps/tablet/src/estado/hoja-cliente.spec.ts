import type { NotaAsignadaDeHoy } from '@/datos/notas-asignadas-reglas';

import { accionesCliente } from './hoja-cliente';

function asignada(cambios: Partial<NotaAsignadaDeHoy> = {}): NotaAsignadaDeHoy {
  return {
    asignacionId: 'a1',
    ventaNotaId: 'n1',
    clienteId: 'cli-1',
    folio: 'TJ261124JP01',
    fecha: '2026-11-20',
    saldoCentavos: 100000,
    diasAtraso: 0,
    condicion: 'ninguna',
    tocadaHoy: false,
    liquidadaHoy: false,
    comentadaHoy: false,
    ...cambios,
  };
}

test('sin notas no hay Cobrar', () => {
  expect(accionesCliente({ asignadas: [], notasConSaldo: 0, esProspecto: false, operacionesHabilitadas: true, candado: null }).cobrar).toBeNull();
});

test('con nota no asignada, Cobrar sin destacar', () => {
  expect(accionesCliente({ asignadas: [], notasConSaldo: 2, esProspecto: false, operacionesHabilitadas: true, candado: null }).cobrar)
    .toEqual({ visible: true, principal: false, nota: '2 notas pendientes' });
});

test('una sola nota no asignada: "1 nota pendiente"', () => {
  expect(accionesCliente({ asignadas: [], notasConSaldo: 1, esProspecto: false, operacionesHabilitadas: true, candado: null }).cobrar)
    .toEqual({ visible: true, principal: false, nota: '1 nota pendiente' });
});

test('nota asignada con condición: Cobrar principal y Vender apagado con "Cobra primero"', () => {
  const a = accionesCliente({ asignadas: [asignada({ saldoCentavos: 112000, condicion: 'liquidar' })], notasConSaldo: 1, esProspecto: false, operacionesHabilitadas: true, candado: null });
  expect(a.cobrar).toEqual({ visible: true, principal: true, nota: '1 nota asignada · $1,120.00' });
  expect(a.vender).toEqual({ habilitado: false, nota: 'Cobra primero' });
});

test('dos asignadas por atender: suma sus saldos', () => {
  const a = accionesCliente({
    asignadas: [asignada({ saldoCentavos: 120000 }), asignada({ asignacionId: 'a2', ventaNotaId: 'n2', saldoCentavos: 80000 })],
    notasConSaldo: 3,
    esProspecto: false,
    operacionesHabilitadas: true,
    candado: null,
  });
  expect(a.cobrar).toEqual({ visible: true, principal: true, nota: '2 notas asignadas · $2,000.00' });
  // Sin condicion no se apaga Vender (el destino sigue pasando por la nota).
  expect(a.vender).toEqual({ habilitado: true, nota: null });
});

test('abono parcial a una que debe liquidar: Vender sigue apagado aunque ya no esté por atender', () => {
  const a = accionesCliente({
    asignadas: [asignada({ saldoCentavos: 50000, condicion: 'liquidar', tocadaHoy: true })],
    notasConSaldo: 1,
    esProspecto: false,
    operacionesHabilitadas: true,
    candado: null,
  });
  expect(a.vender).toEqual({ habilitado: false, nota: 'Cobra primero' });
  expect(a.cobrar).toEqual({ visible: true, principal: false, nota: '1 nota pendiente' });
});

test('condición ya cumplida hoy: Vender se enciende y Cobrar deja de ser principal', () => {
  const a = accionesCliente({ asignadas: [asignada({ saldoCentavos: 0, condicion: 'liquidar', tocadaHoy: true, liquidadaHoy: true })], notasConSaldo: 0, esProspecto: false, operacionesHabilitadas: true, candado: null });
  expect(a.vender).toEqual({ habilitado: true, nota: null });
  expect(a.cobrar).toBeNull();
});

test('con candado de inventario nada se puede hacer', () => {
  const a = accionesCliente({ asignadas: [], notasConSaldo: 1, esProspecto: false, operacionesHabilitadas: true, candado: { tipo: 'sin-carga' } });
  expect([a.vender.habilitado, a.visita.habilitado, a.merma.habilitado]).toEqual([false, false, false]);
});

test('sin ruta empezada nada se puede hacer', () => {
  const a = accionesCliente({ asignadas: [], notasConSaldo: 0, esProspecto: false, operacionesHabilitadas: true, candado: { tipo: 'empezar' } });
  expect([a.vender.habilitado, a.visita.habilitado, a.merma.habilitado]).toEqual([false, false, false]);
});

test('día cerrado: nada se puede hacer', () => {
  const a = accionesCliente({ asignadas: [], notasConSaldo: 1, esProspecto: false, operacionesHabilitadas: false, candado: null });
  expect([a.vender.habilitado, a.visita.habilitado, a.merma.habilitado]).toEqual([false, false, false]);
});

test('prospecto: sin Cobrar y Vender con su nota', () => {
  const a = accionesCliente({ asignadas: [], notasConSaldo: 0, esProspecto: true, operacionesHabilitadas: true, candado: null });
  expect(a.cobrar).toBeNull();
  expect(a.vender).toEqual({ habilitado: true, nota: 'Solo regalo de bienvenida' });
});

test('sin bloqueo y sin candado: todo encendido', () => {
  const a = accionesCliente({ asignadas: [], notasConSaldo: 0, esProspecto: false, operacionesHabilitadas: true, candado: null });
  expect(a).toEqual({ vender: { habilitado: true, nota: null }, cobrar: null, visita: { habilitado: true }, merma: { habilitado: true } });
});
