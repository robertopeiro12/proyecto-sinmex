import { depsDePrueba, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import type { NotaAsignada } from '../tipos';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioCobranzas, type DatosRegistroCobranza } from './cobranzas';
import { crearRepositorioJornadas, ErrorJornada } from './jornadas';
import { crearRepositorioNotasAsignadas, ErrorNotaNoCobrada } from './notas-asignadas';

// Hoy en las pruebas: 2026-08-07 (MOMENTO). nota-1 (2026-08-01, saldo 15000)
// y nota-2 (2026-08-02, saldo 10000) son de cli-1, con plazo de 7 dias.
const HOY = '2026-08-07';
const AYER = '2026-08-06';
const LIQUIDAR = 'Tiene una nota asignada que debe liquidar antes de venderle';
const ABONAR = 'Tiene una nota asignada que debe abonar antes de venderle';

type Asignacion = Omit<NotaAsignada, 'sincronizado_en'>;
const asignacion = (cambios: Partial<Asignacion> = {}): Asignacion => ({
  id: 'asg-1',
  venta_nota_id: 'nota-1',
  fecha: HOY,
  condicion_venta: 'abonar',
  activo: 1,
  ...cambios,
});

function montar(asignaciones: Asignacion[] = [asignacion()]) {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot({ ...snapshotDePrueba(), notasAsignadas: asignaciones });
  return {
    deps,
    catalogos,
    jornadas: crearRepositorioJornadas(deps),
    cobranzas: crearRepositorioCobranzas(deps, { catalogos }),
    notas: crearRepositorioNotasAsignadas(deps),
  };
}

const cobro = (cambios: Partial<DatosRegistroCobranza> = {}): DatosRegistroCobranza => ({
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  ventaNotaId: 'nota-1',
  montoCentavos: 5000,
  metodoPago: 'efectivo',
  fechaPago: HOY,
  ...cambios,
});

/** La nota-1 del snapshot, con otro saldo y abonos (lo que mandaria el pull). */
function notaUnoDelPull(saldo: number, abonos: unknown[]) {
  const nota = snapshotDePrueba().notas?.[0];
  if (!nota) throw new Error('falta nota-1 en el snapshot');
  return { ...nota, saldo_centavos: saldo, abonos_json: JSON.stringify(abonos) };
}

describe('repositorio de notas asignadas', () => {
  it('deHoyDelCliente arma la nota con folio, saldo, atraso y condicion', () => {
    const { notas } = montar();
    expect(notas.deHoyDelCliente('cli-1')).toEqual([
      {
        asignacionId: 'asg-1',
        ventaNotaId: 'nota-1',
        clienteId: 'cli-1',
        folio: 'TJ260801AP01',
        fecha: '2026-08-01',
        saldoCentavos: 15000,
        // Vence 2026-08-08 (plazo 7): todavia no tiene atraso.
        diasAtraso: 0,
        condicion: 'abonar',
        tocadaHoy: false,
        comentadaHoy: false,
      },
    ]);
    expect(notas.deHoyDelCliente('cli-2')).toEqual([]);
  });

  it('ordena por fecha de la nota y folio', () => {
    const { notas } = montar([
      asignacion({ id: 'asg-2', venta_nota_id: 'nota-2' }),
      asignacion({ id: 'asg-1', venta_nota_id: 'nota-1' }),
    ]);
    expect(notas.deHoyDelCliente('cli-1').map((n) => n.ventaNotaId)).toEqual(['nota-1', 'nota-2']);
  });

  it('una asignacion de ayer no aparece', () => {
    const { notas } = montar([asignacion({ fecha: AYER, condicion_venta: 'liquidar' })]);
    expect(notas.deHoyDelCliente('cli-1')).toEqual([]);
    expect(notas.bloqueoDeVenta('cli-1')).toBeNull();
  });

  it('Review Focus 3: una asignacion con activo = 0 no aparece ni bloquea', () => {
    const { notas } = montar([asignacion({ activo: 0, condicion_venta: 'liquidar' })]);
    expect(notas.deHoyDelCliente('cli-1')).toEqual([]);
    expect(notas.bloqueoDeVenta('cli-1')).toBeNull();
    expect(notas.conteoDeHoyPorCliente().get('cli-1') ?? 0).toBe(0);
  });

  it('una asignacion sin nota_pendiente viva no aparece', () => {
    const { notas, catalogos } = montar([
      asignacion({ condicion_venta: 'liquidar' }),
      asignacion({ id: 'asg-x', venta_nota_id: 'nota-que-no-bajo', condicion_venta: 'liquidar' }),
    ]);
    catalogos.guardarSnapshot({ notas: [{ ...notaUnoDelPull(15000, []), activo: 0 }] });
    expect(notas.deHoyDelCliente('cli-1')).toEqual([]);
    expect(notas.bloqueoDeVenta('cli-1')).toBeNull();
  });

  it('Review Focus 1: un cobro con fecha de hoy y fecha_pago de ayer cumple abonar', () => {
    const { notas, cobranzas } = montar();
    expect(notas.bloqueoDeVenta('cli-1')).toBe(ABONAR);
    cobranzas.registrar(cobro({ fechaPago: AYER }));
    expect(notas.deHoyDelCliente('cli-1')[0]?.tocadaHoy).toBe(true);
    expect(notas.bloqueoDeVenta('cli-1')).toBeNull();
    expect(notas.conteoDeHoyPorCliente().get('cli-1') ?? 0).toBe(0);
  });

  it('un cobro de ayer no cuenta como tocada hoy', () => {
    const { notas, deps } = montar();
    deps.bd.runSync(
      `insert into cobranza (id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id, monto_centavos,
         metodo_pago, fecha_pago, grabada_en, reparto_json)
       values ('cob-ayer', $ayer, 'cli-1', 'ven-1', 'suc-tj', 'nota-1', 1000, 'efectivo', $ayer, $en,
         '[{"venta_nota_id":"nota-1","monto_centavos":1000}]')`,
      { $ayer: AYER, $en: MOMENTO },
    );
    expect(notas.deHoyDelCliente('cli-1')[0]?.tocadaHoy).toBe(false);
    expect(notas.bloqueoDeVenta('cli-1')).toBe(ABONAR);
  });

  it('Review Focus 2: un abono de la oficina en abonos_json no cumple abonar; con saldo 0 no bloquea', () => {
    const { notas, catalogos } = montar();
    catalogos.guardarSnapshot({
      notas: [notaUnoDelPull(5000, [{ fecha_pago: HOY, monto_centavos: 10000, metodo_pago: 'efectivo' }])],
    });
    expect(notas.deHoyDelCliente('cli-1')[0]).toMatchObject({ saldoCentavos: 5000, tocadaHoy: false });
    expect(notas.bloqueoDeVenta('cli-1')).toBe(ABONAR);

    catalogos.guardarSnapshot({
      notas: [notaUnoDelPull(0, [{ fecha_pago: HOY, monto_centavos: 15000, metodo_pago: 'efectivo' }])],
    });
    // Sigue en la lista (con saldo 0) para que cumpleCondicion la vea; porAtender la saca.
    expect(notas.deHoyDelCliente('cli-1')[0]).toMatchObject({ saldoCentavos: 0, tocadaHoy: false });
    expect(notas.bloqueoDeVenta('cli-1')).toBeNull();
    expect(notas.conteoDeHoyPorCliente().get('cli-1') ?? 0).toBe(0);
  });

  it('Review Focus 4: tras un pull que reescribe el saldo viejo, el cobro local de hoy sigue cumpliendo abonar', () => {
    const { notas, cobranzas, catalogos } = montar();
    cobranzas.registrar(cobro());
    // El pull trae la nota como estaba antes del cobro (aun no se subio).
    catalogos.guardarSnapshot({ notas: [notaUnoDelPull(15000, [])] });
    expect(notas.deHoyDelCliente('cli-1')[0]).toMatchObject({ saldoCentavos: 15000, tocadaHoy: true });
    expect(notas.bloqueoDeVenta('cli-1')).toBeNull();
  });

  it('liquidar gana sobre abonar y un abono no la cumple', () => {
    const { notas, cobranzas } = montar([
      asignacion({ id: 'asg-1', venta_nota_id: 'nota-1', condicion_venta: 'abonar' }),
      asignacion({ id: 'asg-2', venta_nota_id: 'nota-2', condicion_venta: 'liquidar' }),
    ]);
    expect(notas.bloqueoDeVenta('cli-1')).toBe(LIQUIDAR);
    cobranzas.registrar(cobro({ ventaNotaId: 'nota-2', montoCentavos: 1000 }));
    expect(notas.bloqueoDeVenta('cli-1')).toBe(LIQUIDAR);
  });

  it('conteoDeHoyPorCliente cuenta las asignadas por atender; el comentario no la saca', () => {
    const { notas } = montar([
      asignacion({ id: 'asg-1', venta_nota_id: 'nota-1' }),
      asignacion({ id: 'asg-2', venta_nota_id: 'nota-2', condicion_venta: 'ninguna' }),
    ]);
    expect(notas.conteoDeHoyPorCliente()).toEqual(new Map([['cli-1', 2]]));
    notas.registrarNoCobrada({ vendedorId: 'ven-1', clienteId: 'cli-1', ventaNotaId: 'nota-1', comentario: 'No estaba' });
    expect(notas.conteoDeHoyPorCliente()).toEqual(new Map([['cli-1', 2]]));
    expect(notas.deHoyDelCliente('cli-1')[0]?.comentadaHoy).toBe(true);
    expect(notas.bloqueoDeVenta('cli-1')).toBe(ABONAR);
  });

  it('registrarNoCobrada graba el comentario recortado, pendiente de subir; cada vez una fila nueva', () => {
    const { notas } = montar();
    const datos = { vendedorId: 'ven-1', clienteId: 'cli-1', ventaNotaId: 'nota-1', comentario: '  No tenia efectivo ' };
    const n = notas.registrarNoCobrada(datos);
    expect(n).toEqual({
      id: 'id-1',
      venta_nota_id: 'nota-1',
      cliente_id: 'cli-1',
      vendedor_id: 'ven-1',
      fecha: HOY,
      comentario: 'No tenia efectivo',
      registrado_en: MOMENTO,
      sync_estado: 'pendiente',
      sync_error: null,
      sincronizado_en: null,
    });
    notas.registrarNoCobrada(datos);
    expect(notas.pendientesDeSincronizar().map((f) => f.id)).toEqual(['id-1', 'id-2']);
  });

  it('registrarNoCobrada exige comentario de 1 a 300 caracteres', () => {
    const { notas } = montar();
    const con = (comentario: string) => () =>
      notas.registrarNoCobrada({ vendedorId: 'ven-1', clienteId: 'cli-1', ventaNotaId: 'nota-1', comentario });
    expect(con('')).toThrow(new ErrorNotaNoCobrada('Escribe por qué no te pagó.'));
    expect(con('    ')).toThrow(ErrorNotaNoCobrada);
    expect(con('x'.repeat(301))).toThrow(new ErrorNotaNoCobrada('El comentario admite hasta 300 caracteres.'));
    expect(con(` ${'x'.repeat(300)} `)().comentario).toHaveLength(300);
  });

  it('registrarNoCobrada con el dia cerrado lanza el error de jornada y no deja fila', () => {
    const { notas, jornadas } = montar();
    const j = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(j.id, 20);
    expect(() =>
      notas.registrarNoCobrada({ vendedorId: 'ven-1', clienteId: 'cli-1', ventaNotaId: 'nota-1', comentario: '' }),
    ).toThrow(ErrorJornada);
    expect(notas.pendientesDeSincronizar()).toEqual([]);
  });

  it('la cola del push: pendientes y con error se reintentan; sincronizadas salen', () => {
    const { notas } = montar();
    const datos = { vendedorId: 'ven-1', clienteId: 'cli-1', ventaNotaId: 'nota-1', comentario: 'No estaba' };
    const a = notas.registrarNoCobrada(datos);
    const b = notas.registrarNoCobrada(datos);
    notas.marcarSincronizada(a.id);
    notas.marcarError(b.id, 'rechazada');
    expect(notas.pendientesDeSincronizar()).toEqual([
      expect.objectContaining({ id: b.id, sync_estado: 'error', sync_error: 'rechazada' }),
    ]);
    notas.marcarSincronizada(b.id);
    expect(notas.pendientesDeSincronizar()).toEqual([]);
  });
});
