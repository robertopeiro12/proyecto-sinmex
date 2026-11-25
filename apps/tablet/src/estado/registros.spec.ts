import type { NotaQueTrae } from '@/datos/repositorios/notas-asignadas';
import { formatearHora } from '@/ui/momento';
import { armarRegistro, type EntradaRegistro, type FiltroRegistro } from './registros';

/**
 * El registro del dia (maqueta 17). Los momentos se escriben como hora local
 * para que la prueba no dependa de la zona del equipo.
 */
const en = (hhmm: string) => new Date(`2026-11-18T${hhmm}:00`).toISOString();

const CLIENTES: Record<string, string> = {
  florido: 'Depósito El Florido',
  chuy: 'Tienda Doña Chuy',
  esperanza: 'Abarrotes La Esperanza',
};

type VentaEntrada = EntradaRegistro['ventas'][number];
type CobroEntrada = EntradaRegistro['cobros'][number];

const venta = (c: Partial<VentaEntrada> & Pick<VentaEntrada, 'id'>): VentaEntrada => ({
  cliente_id: 'florido',
  folio: 'TJ261118JP01',
  contado_credito: 'contado',
  monto_total_centavos: 0,
  abono_centavos: null,
  grabada_en: en('12:00'),
  sync_estado: 'sincronizado',
  ...c,
});

const cobro = (c: Partial<CobroEntrada> & Pick<CobroEntrada, 'id'>): CobroEntrada => ({
  cliente_id: 'chuy',
  venta_nota_id: 'nota-x',
  monto_centavos: 0,
  grabada_en: en('12:00'),
  sync_estado: 'sincronizado',
  ...c,
});

const nota = (c: Partial<NotaQueTrae>): NotaQueTrae => ({
  origen: 'asignada',
  clienteId: 'chuy',
  folio: 'TJ261103JP07',
  ventaNotaId: 'nota-07',
  ventaId: null,
  saldoCentavos: 72000,
  fecha: '2026-11-03',
  ...c,
});

/**
 * El dia de la maqueta 17: 5 movimientos. La maqueta dice $3,474.00 arriba, pero
 * sus renglones suman $4,026.00; manda la decision 3 del plan: la suma de lo
 * que muestra el filtro.
 */
function entradaMaqueta(): EntradaRegistro {
  return {
    ventas: [
      venta({ id: 'v-esperanza', cliente_id: 'esperanza', contado_credito: 'credito', monto_total_centavos: 124000, abono_centavos: 30000, grabada_en: en('10:15'), folio: 'TJ261118JP02' }),
      venta({ id: 'v-chuy', cliente_id: 'chuy', contado_credito: 'credito', monto_total_centavos: 62400, grabada_en: en('11:58'), sync_estado: 'pendiente', folio: 'TJ261118JP05' }),
      venta({ id: 'v-florido', cliente_id: 'florido', monto_total_centavos: 91200, grabada_en: en('12:40'), sync_estado: 'error' }),
    ],
    cobros: [
      cobro({ id: 'c-esperanza', cliente_id: 'esperanza', venta_nota_id: 'nota-04', monto_centavos: 85000, grabada_en: en('10:09') }),
      cobro({ id: 'c-chuy', cliente_id: 'chuy', venta_nota_id: 'nota-07', monto_centavos: 40000, grabada_en: en('11:52') }),
    ],
    notas: [
      nota({}),
      nota({ origen: 'nueva', clienteId: 'esperanza', folio: 'TJ261118JP02', ventaNotaId: null, ventaId: 'v-esperanza', saldoCentavos: 94000, fecha: '2026-11-18' }),
    ],
    nombreCliente: (id) => CLIENTES[id] ?? 'Cliente',
    folioDeNota: (id) => ({ 'nota-04': 'TJ261030JP04', 'nota-07': 'TJ261103JP07' })[id] ?? null,
  };
}

describe('armarRegistro (maqueta 17)', () => {
  it('Todo: ventas y cobros, lo mas nuevo arriba, con los textos de la maqueta y el total', () => {
    const { renglones, total } = armarRegistro(entradaMaqueta(), 'todo');
    expect(renglones.map((r) => [r.hora, r.cliente, r.texto, r.montoCentavos])).toEqual([
      ['12:40', 'Depósito El Florido', 'Venta contado', 91200],
      ['11:58', 'Tienda Doña Chuy', 'Venta crédito', 62400],
      ['11:52', 'Tienda Doña Chuy', 'Cobro nota TJ261103JP07', 40000],
      ['10:15', 'Abarrotes La Esperanza', 'Venta abonó $300.00', 124000],
      ['10:09', 'Abarrotes La Esperanza', 'Cobro nota TJ261030JP04', 85000],
    ]);
    expect(total).toBe(402600);
  });

  it('cada renglon lleva su tipo, id, clave unica, cliente y la pastilla de subida', () => {
    const { renglones } = armarRegistro(entradaMaqueta(), 'todo');
    expect(renglones[0]).toEqual({
      clave: 'venta:v-florido',
      tipo: 'venta',
      id: 'v-florido',
      clienteId: 'florido',
      hora: formatearHora(en('12:40')),
      cliente: 'Depósito El Florido',
      texto: 'Venta contado',
      montoCentavos: 91200,
      estado: 'error',
    });
    expect(renglones.map((r) => r.estado)).toEqual(['error', 'pendiente', 'listo', 'listo', 'listo']);
    expect(renglones[2]).toMatchObject({ clave: 'cobro:c-chuy', tipo: 'cobro', id: 'c-chuy' });
    expect(new Set(renglones.map((r) => r.clave)).size).toBe(renglones.length);
  });

  it('Ventas del dia: solo ventas, con su total', () => {
    const { renglones, total } = armarRegistro(entradaMaqueta(), 'ventas');
    expect(renglones.map((r) => r.id)).toEqual(['v-florido', 'v-chuy', 'v-esperanza']);
    expect(total).toBe(91200 + 62400 + 124000);
  });

  it('Cobranza: solo cobros, con su total', () => {
    const { renglones, total } = armarRegistro(entradaMaqueta(), 'cobranza');
    expect(renglones.map((r) => r.id)).toEqual(['c-chuy', 'c-esperanza']);
    expect(total).toBe(125000);
  });

  it('Notas pendientes: las notas que trae, "Nota <folio>" por su saldo, sin hora ni pastilla', () => {
    const { renglones, total } = armarRegistro(entradaMaqueta(), 'pendientes');
    expect(renglones).toEqual([
      {
        clave: 'nota:nota-07',
        tipo: 'nota',
        id: 'nota-07',
        clienteId: 'chuy',
        hora: null,
        cliente: 'Tienda Doña Chuy',
        texto: 'Nota TJ261103JP07',
        montoCentavos: 72000,
        estado: null,
      },
      {
        // Venta de esta tablet todavia sin bajar: se abre por su venta.
        clave: 'nota:v-esperanza',
        tipo: 'nota',
        id: 'v-esperanza',
        clienteId: 'esperanza',
        hora: null,
        cliente: 'Abarrotes La Esperanza',
        texto: 'Nota TJ261118JP02',
        montoCentavos: 94000,
        estado: null,
      },
    ]);
    expect(total).toBe(166000);
  });

  it('una nota asignada que tambien es venta de esta tablet abre su venta', () => {
    const e = entradaMaqueta();
    const { renglones } = armarRegistro(
      { ...e, notas: [nota({ ventaNotaId: 'nota-f1', ventaId: 'v-esperanza', folio: 'TJ261118JP02' })] },
      'pendientes',
    );
    expect(renglones[0]).toMatchObject({ id: 'v-esperanza', clave: 'nota:v-esperanza' });
  });

  it('un cobro cuya nota ya no esta en la tablet dice "Cobro"', () => {
    const e = entradaMaqueta();
    const { renglones } = armarRegistro({ ...e, ventas: [], cobros: [cobro({ id: 'c1', venta_nota_id: 'ya-no' })] }, 'todo');
    expect(renglones[0]?.texto).toBe('Cobro');
  });

  it('con la misma hora, lo grabado despues va arriba', () => {
    const e = entradaMaqueta();
    const mismo = en('09:00');
    const { renglones } = armarRegistro(
      {
        ...e,
        ventas: [venta({ id: 'v1', grabada_en: mismo }), venta({ id: 'v2', grabada_en: mismo })],
        cobros: [],
      },
      'todo',
    );
    expect(renglones.map((r) => r.id)).toEqual(['v2', 'v1']);
  });

  it.each<FiltroRegistro>(['todo', 'ventas', 'cobranza', 'pendientes'])('un dia vacio da lista vacia y total 0 (%s)', (filtro) => {
    expect(
      armarRegistro({ ventas: [], cobros: [], notas: [], nombreCliente: () => 'x', folioDeNota: () => null }, filtro),
    ).toEqual({ renglones: [], total: 0 });
  });
});
