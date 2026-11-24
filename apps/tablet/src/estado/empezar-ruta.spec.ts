import type { EstadoCarga } from '@/datos/tipos';

import { candadoDeClientes, TEXTO_CANDADO, vehiculoPorOmision } from './empezar-ruta';

/**
 * Empezar ruta desde la Ruta (rediseño, pieza 1): el candado de los clientes y
 * el vehiculo que viene elegido. Spec §4 y §16-bis.
 */

const HOY = '2026-11-24';
const carga = (estado: EstadoCarga, id = 'c1', fecha = HOY) => ({ id, fecha, estado, activo: 1 as const });

test('sin jornada de hoy hay que empezar ruta (también con la de ayer abierta)', () => {
  expect(candadoDeClientes({ jornada: null, hoy: HOY, controlInventario: true, cargas: [] })).toEqual({ tipo: 'empezar' });
  expect(candadoDeClientes({ jornada: { fecha: '2026-11-23' }, hoy: HOY, controlInventario: false, cargas: [] })).toEqual({ tipo: 'empezar' });
});

test('control apagado: clientes abiertos aunque haya carga pendiente', () => {
  expect(candadoDeClientes({ jornada: { fecha: HOY }, hoy: HOY, controlInventario: false, cargas: [carga('pendiente')] })).toBeNull();
});

test('control prendido', () => {
  const j = { fecha: HOY };
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [] })).toEqual({ tipo: 'sin-carga' });
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [carga('pendiente')] })).toEqual({ tipo: 'carga-pendiente', cargaId: 'c1' });
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [carga('rechazada')] })).toEqual({ tipo: 'rechazada' });
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [carga('aceptada'), carga('pendiente', 'c2')] })).toBeNull();
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [{ ...carga('aceptada'), activo: 0 }] })).toEqual({ tipo: 'sin-carga' });
  expect(candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [carga('aceptada', 'c1', '2026-11-23')] })).toEqual({ tipo: 'sin-carga' });
});

test('control prendido: la pendiente gana a la rechazada', () => {
  const j = { fecha: HOY };
  expect(
    candadoDeClientes({ jornada: j, hoy: HOY, controlInventario: true, cargas: [carga('rechazada'), carga('pendiente', 'c2')] }),
  ).toEqual({ tipo: 'carga-pendiente', cargaId: 'c2' });
});

test('vehículo por omisión', () => {
  const lista = [{ id: 'v1' }, { id: 'v2' }];
  expect(vehiculoPorOmision(lista, 'v2', null)).toBe('v2');
  expect(vehiculoPorOmision(lista, 'v9', null)).toBe('v1'); // asignado dado de baja u otra sucursal
  expect(vehiculoPorOmision(lista, 'v2', 'v1')).toBe('v1'); // lo cambió el vendedor
  expect(vehiculoPorOmision(lista, null, 'v9')).toBe('v1');
  expect(vehiculoPorOmision([], 'v2', null)).toBeNull();
});

test('textos del aviso', () => {
  expect(TEXTO_CANDADO).toEqual({
    'carga-pendiente': { titulo: 'Falta aceptar tu inventario', texto: 'Tienes una carga esperando. Acéptala para poder vender.' },
    'sin-carga': { titulo: 'Aún no te cargan', texto: 'Cuando el almacén capture tu carga, aquí te avisamos para aceptarla.' },
    rechazada: { titulo: 'Rechazaste la carga', texto: 'Espera a que el almacén te mande una carga nueva para poder vender.' },
  });
});
