import { depsDePrueba, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioCobranzas } from './cobranzas';
import { crearRepositorioFolios } from './folios';
import { crearRepositorioJornadas, ErrorJornada, MENSAJE_DIA_CERRADO } from './jornadas';
import { crearRepositorioRutas, ErrorRuta, type FilaRutaPull } from './rutas';
import { crearRepositorioVentas } from './ventas';
import { crearRepositorioVisitas } from './visitas';

/**
 * La ruta del dia en la tablet (T-37, D15). Lo que hay que fijar: la regla de
 * fusion al refrescar (la tabla del spec, fila por fila), que el orden del
 * vendedor sobrevive a cualquier pull, y que "visitado" y la burbuja salen de
 * lo que paso HOY en esta tablet.
 */

const HOY = '2026-08-07';
const MANANA = '2026-08-08';
const CTX = { vendedorId: 'ven-1', sucursalId: 'suc-tj' };

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  const base = snapshotDePrueba();
  const plantilla = base.clientes![0]!;
  const cliente = (id: string, cambios: Partial<typeof plantilla> = {}) => ({
    ...plantilla,
    id,
    nombre: `Cliente ${id}`,
    ...cambios,
  }) as typeof plantilla;
  catalogos.guardarSnapshot({
    ...base,
    sucursales: [
      ...(base.sucursales ?? []),
      { id: 'suc-mx', codigo: 'MX', nombre: 'Mexicali', activa: 1 },
    ],
    clientes: [
      ...(base.clientes ?? []),
      cliente('cli-3'),
      cliente('cli-4', { domicilio: 'Av. Siempre Viva 742' }),
      cliente('cli-5', { activo: 0 }),
      cliente('cli-6', { sucursal_id: 'suc-mx' }),
    ],
  });
  return {
    deps,
    catalogos,
    rutas: crearRepositorioRutas(deps, { catalogos }),
    jornadas: crearRepositorioJornadas(deps),
    ventas: crearRepositorioVentas(deps, { catalogos, folios: crearRepositorioFolios(deps) }),
    cobranzas: crearRepositorioCobranzas(deps, { catalogos }),
    visitas: crearRepositorioVisitas(deps, { catalogos }),
  };
}

/** Una fila como la baja el pull. */
const delServidor = (extra: Partial<FilaRutaPull> = {}): FilaRutaPull => ({
  id: 'srv-1',
  cliente_id: 'cli-1',
  fecha: HOY,
  orden: 1,
  origen: 'oficina',
  activo: 1,
  ...extra,
});

function venderA(ventas: ReturnType<typeof montar>['ventas']) {
  return ventas.registrar({
    vendedorId: 'ven-1',
    clienteId: 'cli-1',
    numNota: '2346',
    contadoCredito: 'contado',
    factura: 'N/A',
    comentarios: null,
    lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
  });
}

const clientesDelDia = (rutas: ReturnType<typeof montar>['rutas'], fecha = HOY) =>
  rutas.delDia(fecha).map((f) => f.cliente_id);

describe('aplicarSnapshot: la regla de fusion al refrescar (D15)', () => {
  it('una fila nueva viva aparece al final, sin posicion local', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 1 }),
      delServidor({ id: 'srv-3', cliente_id: 'cli-3', orden: 2 }),
    ]);
    rutas.reordenar(HOY, ['cli-3', 'cli-1']);

    rutas.aplicarSnapshot([delServidor({ id: 'srv-4', cliente_id: 'cli-4', orden: 3 })]);

    expect(clientesDelDia(rutas)).toEqual(['cli-3', 'cli-1', 'cli-4']);
    expect(rutas.delDia().map((f) => f.posicion)).toEqual([1, 2, null]);
  });

  it('una fila conocida con otro orden se actualiza; sin posicion local manda el del servidor', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 1 }),
      delServidor({ id: 'srv-3', cliente_id: 'cli-3', orden: 2 }),
    ]);

    rutas.aplicarSnapshot([delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 3 })]);

    expect(rutas.porId('srv-1')?.orden).toBe(3);
    expect(clientesDelDia(rutas)).toEqual(['cli-3', 'cli-1']);
  });

  it('una fila conocida con otro orden, con posicion local: manda la local', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 1 }),
      delServidor({ id: 'srv-3', cliente_id: 'cli-3', orden: 2 }),
    ]);
    rutas.reordenar(HOY, ['cli-1', 'cli-3']);

    rutas.aplicarSnapshot([delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 5 })]);

    expect(rutas.porId('srv-1')?.orden).toBe(5);
    expect(clientesDelDia(rutas)).toEqual(['cli-1', 'cli-3']);
  });

  it('una baja de un cliente SIN actividad hoy queda con la bandera y sin visitar (la pantalla la oculta)', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor()]);

    rutas.aplicarSnapshot([delServidor({ activo: 0 })]);

    expect(rutas.delDia()).toMatchObject([{ id: 'srv-1', activo: 0, visitado: false }]);
  });

  it('una baja de un cliente CON actividad hoy se queda, visitada (fuera de ruta)', () => {
    const { rutas, ventas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    venderA(ventas);

    rutas.aplicarSnapshot([delServidor({ activo: 0 })]);

    expect(rutas.delDia()).toMatchObject([{ id: 'srv-1', activo: 0, visitado: true }]);
  });

  it('una fila viva del servidor funde el alta local del mismo cliente: queda la del servidor y la posicion sobrevive', () => {
    const { rutas } = montar();
    const alta = rutas.agregar('cli-3', CTX);
    rutas.reordenar(HOY, ['cli-3']);

    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-9', cliente_id: 'cli-3', orden: 4, origen: 'vendedor' }),
    ]);

    expect(rutas.porId(alta.id)).toBeNull();
    expect(rutas.delDia()).toMatchObject([
      { id: 'srv-9', cliente_id: 'cli-3', posicion: 1, sync_estado: 'sincronizada' },
    ]);
    // Ya no hay nada que subir: si la operacion seguia pendiente, el servidor
    // la habria respondido `ruta-duplicada`.
    expect(rutas.pendientesDeSincronizar()).toEqual([]);
  });

  it('una fila viva del servidor borra la baja vieja del mismo cliente (la oficina lo quito y lo volvio a poner)', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor({ id: 'srv-1' })]);
    rutas.aplicarSnapshot([delServidor({ id: 'srv-1', activo: 0 })]);

    rutas.aplicarSnapshot([delServidor({ id: 'srv-2', orden: 2 })]);

    expect(rutas.porId('srv-1')).toBeNull();
    expect(rutas.delDia().map((f) => [f.id, f.activo])).toEqual([['srv-2', 1]]);
  });

  it('una baja vieja que llega en el mismo lote DESPUES de la viva nueva no se escribe', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor({ id: 'srv-1', orden: 5 })]);

    // El servidor ordena por (fecha, orden): la viva nueva (orden 1) va antes.
    const escritas = rutas.aplicarSnapshot([
      delServidor({ id: 'srv-2', orden: 1 }),
      delServidor({ id: 'srv-1', orden: 5, activo: 0 }),
    ]);

    expect(escritas).toBe(1);
    expect(rutas.porId('srv-1')).toBeNull();
    expect(rutas.delDia().map((f) => [f.id, f.activo])).toEqual([['srv-2', 1]]);
  });

  it('una fila cuyo cliente no esta en la tablet se omite y las demas entran (Review Focus 1)', () => {
    const { rutas } = montar();

    const escritas = rutas.aplicarSnapshot([
      delServidor({ id: 'srv-x', cliente_id: 'cli-que-no-bajo' }),
      delServidor({ id: 'srv-1', cliente_id: 'cli-1' }),
    ]);

    expect(escritas).toBe(1);
    expect(rutas.delDia().map((f) => f.id)).toEqual(['srv-1']);
  });

  it('un pull nunca toca el orden local', () => {
    const { rutas, deps } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    rutas.reordenar(HOY, ['cli-1']);

    rutas.aplicarSnapshot([delServidor({ orden: 7 }), delServidor({ activo: 0 })]);

    expect(
      deps.bd.getAllSync('select fecha, cliente_id, posicion from ruta_orden_local'),
    ).toEqual([{ fecha: HOY, cliente_id: 'cli-1', posicion: 1 }]);
  });
});

describe('delDia', () => {
  it('ordena por la posicion local y despues por el orden del servidor', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 1 }),
      delServidor({ id: 'srv-3', cliente_id: 'cli-3', orden: 2 }),
      delServidor({ id: 'srv-4', cliente_id: 'cli-4', orden: 3 }),
    ]);

    rutas.reordenar(HOY, ['cli-4']);

    expect(clientesDelDia(rutas)).toEqual(['cli-4', 'cli-1', 'cli-3']);
  });

  it('trae nombre y domicilio del cliente, y solo las filas de esa fecha', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-4', cliente_id: 'cli-4' }),
      delServidor({ id: 'srv-m', cliente_id: 'cli-3', fecha: MANANA }),
    ]);

    expect(rutas.delDia()).toMatchObject([
      { id: 'srv-4', nombre: 'Cliente cli-4', domicilio: 'Av. Siempre Viva 742' },
    ]);
    expect(rutas.delDia(MANANA).map((f) => f.id)).toEqual(['srv-m']);
  });

  it('visitado sale de una venta de hoy y de un cobro de hoy', () => {
    const { rutas, ventas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    expect(rutas.delDia()[0]!.visitado).toBe(false);

    venderA(ventas);
    expect(rutas.delDia()[0]!.visitado).toBe(true);

    const otra = montar();
    otra.rutas.aplicarSnapshot([delServidor()]);
    otra.cobranzas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      ventaNotaId: 'nota-1',
      montoCentavos: 5000,
      metodoPago: 'efectivo',
      fechaPago: HOY,
    });
    expect(otra.rutas.delDia()[0]!.visitado).toBe(true);
  });

  it('una venta de AYER no marca visitado hoy (Review Focus 3)', () => {
    const { rutas, deps } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    deps.bd.runSync(
      `insert into venta (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
         contado_credito, factura, comentarios, monto_total_centavos, grabada_en)
       values ('v-ayer', '2026-08-06', 'cli-1', 'ven-1', 'suc-tj', 'TJ260806AP01', null,
         'contado', 'N/A', null, 2800, '2026-08-06T20:00:00.000Z')`,
    );

    expect(rutas.delDia()[0]!.visitado).toBe(false);
  });

  it('la burbuja cuenta las notas con saldo y baja al cobrar sin red', () => {
    const { rutas, cobranzas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    expect(rutas.delDia()[0]!.notas_pendientes).toBe(2);

    // Liquidar la nota-2 (saldo 10000) la saca de las pendientes en la tablet.
    cobranzas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      ventaNotaId: 'nota-2',
      montoCentavos: 10000,
      metodoPago: 'efectivo',
      fechaPago: HOY,
    });

    expect(rutas.delDia()[0]).toMatchObject({ notas_pendientes: 1, visitado: true });
  });
});

describe('agregar', () => {
  it('agrega al final como alta pendiente del vendedor, con su clave', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor({ orden: 4 })]);

    const alta = rutas.agregar('cli-3', CTX);

    expect(alta).toEqual({
      id: 'id-1',
      cliente_id: 'cli-3',
      fecha: HOY,
      orden: 5,
      origen: 'vendedor',
      activo: 1,
      sync_estado: 'pendiente',
      sync_error: null,
      clave: 'id-1',
      sincronizado_en: MOMENTO,
    });
    expect(clientesDelDia(rutas)).toEqual(['cli-1', 'cli-3']);
  });

  it('rechaza un prospecto: a un prospecto no se le vende (D7)', () => {
    const { rutas } = montar();
    expect(() => rutas.agregar('cli-2', CTX)).toThrow(ErrorRuta);
    expect(() => rutas.agregar('cli-2', CTX)).toThrow(/prospecto/);
  });

  it('rechaza un cliente dado de baja, de otra sucursal o que no esta en la tablet', () => {
    const { rutas } = montar();
    expect(() => rutas.agregar('cli-5', CTX)).toThrow(ErrorRuta);
    expect(() => rutas.agregar('cli-6', CTX)).toThrow(ErrorRuta);
    expect(() => rutas.agregar('no-existe', CTX)).toThrow(ErrorRuta);
    expect(rutas.delDia()).toEqual([]);
  });

  it('rechaza un cliente que ya esta vivo en la ruta de ese dia', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    expect(() => rutas.agregar('cli-1', CTX)).toThrow('Ese cliente ya está en la ruta de hoy.');
  });

  it('con el dia cerrado lanza ErrorJornada y no escribe nada', () => {
    const { rutas, jornadas } = montar();
    const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(jornada.id, 20);

    expect(() => rutas.agregar('cli-3', CTX)).toThrow(ErrorJornada);
    expect(() => rutas.agregar('cli-3', CTX)).toThrow(MENSAJE_DIA_CERRADO);
    expect(rutas.delDia()).toEqual([]);
  });

  it('avisa a las pantallas que la ruta cambio', () => {
    const { rutas, catalogos } = montar();
    const antes = catalogos.version();
    rutas.agregar('cli-3', CTX);
    expect(catalogos.version()).toBeGreaterThan(antes);
  });
});

describe('reordenar', () => {
  it('reescribe el orden local de esa fecha y no toca las demas', () => {
    const { rutas, deps } = montar();
    rutas.reordenar(MANANA, ['cli-4']);
    rutas.reordenar(HOY, ['cli-3', 'cli-1']);
    rutas.reordenar(HOY, ['cli-1']);

    expect(
      deps.bd.getAllSync(
        'select fecha, cliente_id, posicion from ruta_orden_local order by fecha, posicion',
      ),
    ).toEqual([
      { fecha: HOY, cliente_id: 'cli-1', posicion: 1 },
      { fecha: MANANA, cliente_id: 'cli-4', posicion: 1 },
    ]);
  });

  it('es transaccional: si falla a la mitad, se queda el orden anterior', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-1', cliente_id: 'cli-1', orden: 1 }),
      delServidor({ id: 'srv-3', cliente_id: 'cli-3', orden: 2 }),
    ]);
    rutas.reordenar(HOY, ['cli-3', 'cli-1']);

    // Un id repetido viola la llave primaria en el segundo insert.
    expect(() => rutas.reordenar(HOY, ['cli-1', 'cli-1'])).toThrow();

    expect(clientesDelDia(rutas)).toEqual(['cli-3', 'cli-1']);
  });
});

describe('la cola del push', () => {
  it('pendientesDeSincronizar trae las altas pendientes y con error, nunca las filas del servidor', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    const a = rutas.agregar('cli-3', CTX);
    const b = rutas.agregar('cli-4', CTX);
    rutas.marcarError(b.id, 'cliente-inexistente: x');

    expect(rutas.pendientesDeSincronizar().map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it('marcarSincronizada la saca de la cola y limpia el error', () => {
    const { rutas } = montar();
    const a = rutas.agregar('cli-3', CTX);
    rutas.marcarError(a.id, 'cliente-inexistente: x');

    rutas.marcarSincronizada(a.id);

    expect(rutas.porId(a.id)).toMatchObject({ sync_estado: 'sincronizada', sync_error: null });
    expect(rutas.pendientesDeSincronizar()).toEqual([]);
  });

  it('quitarRechazada borra solo un alta del vendedor que el servidor rechazo', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    const a = rutas.agregar('cli-3', CTX);

    expect(() => rutas.quitarRechazada(a.id)).toThrow(ErrorRuta);
    expect(() => rutas.quitarRechazada('srv-1')).toThrow(ErrorRuta);

    rutas.marcarError(a.id, 'cliente-inexistente: x');
    rutas.quitarRechazada(a.id);

    expect(rutas.porId(a.id)).toBeNull();
    expect(clientesDelDia(rutas)).toEqual(['cli-1']);
  });
});

describe('purgar', () => {
  it('borra filas y orden local de antes de hoy - 7, pero conserva un alta vieja pendiente', () => {
    const { rutas, deps } = montar();
    rutas.aplicarSnapshot([
      delServidor({ id: 'srv-viejo', fecha: '2026-07-30' }),
      delServidor({ id: 'srv-limite', fecha: '2026-07-31' }),
    ]);
    rutas.reordenar('2026-07-30', ['cli-1']);
    const altaVieja = rutas.agregar('cli-3', CTX, '2026-07-01');

    rutas.purgar();

    expect(rutas.porId('srv-viejo')).toBeNull();
    expect(rutas.porId('srv-limite')).not.toBeNull();
    expect(rutas.porId(altaVieja.id)).not.toBeNull();
    expect(deps.bd.getAllSync('select * from ruta_orden_local')).toEqual([]);
  });

  it('borra un alta vieja en error: ya la rechazo el servidor y no se reintenta para siempre', () => {
    const { rutas } = montar();
    const rechazada = rutas.agregar('cli-3', CTX, '2026-07-01');
    rutas.marcarError(rechazada.id, 'cliente-inexistente: x');

    rutas.purgar();

    expect(rutas.porId(rechazada.id)).toBeNull();
    expect(rutas.pendientesDeSincronizar()).toEqual([]);
  });
});

function visitarA(
  visitas: ReturnType<typeof montar>['visitas'],
  motivoVisitaId = 'mot-tenia',
  clienteId = 'cli-1',
) {
  return visitas.registrar({
    vendedorId: 'ven-1',
    clienteId,
    motivoVisitaId,
    observaciones: null,
    atendio: null,
    lat: 32.5,
    lng: -117,
    precisionM: null,
    direccionTexto: null,
    fotoUri: null,
  });
}

describe('delDia con visitas (T-39, D8)', () => {
  it('una visita sin venta marca visitado y visita_sin_venta, con la ultima visita (Review Focus 4)', () => {
    const { rutas, visitas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    visitarA(visitas, 'mot-tenia');
    visitarA(visitas, 'mot-cerrado');

    expect(rutas.delDia()[0]).toMatchObject({
      visitado: true,
      visita_sin_venta: true,
      ultima_visita_motivo: 'Cerrado',
      ultima_visita_en: MOMENTO,
      visitas_estado: 'pendiente',
      visita_error: null,
    });
  });

  it('visita y venta el mismo dia: atendido gana, no es visita_sin_venta (Review Focus 3)', () => {
    const { rutas, visitas, ventas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    visitarA(visitas);
    venderA(ventas);
    expect(rutas.delDia()[0]).toMatchObject({ visitado: true, visita_sin_venta: false });
  });

  it('el estado de las visitas es el mas grave: error > pendiente > listo, con el motivo del error', () => {
    const { rutas, visitas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    const a = visitarA(visitas);
    const b = visitarA(visitas);
    visitas.marcarSincronizada(a.id);
    visitas.marcarSincronizada(b.id);
    expect(rutas.delDia()[0]!.visitas_estado).toBe('listo');

    visitas.marcarError(b.id, 'motivo-visita-inexistente: El motivo no existe.');
    expect(rutas.delDia()[0]).toMatchObject({
      visitas_estado: 'error',
      visita_error: 'motivo-visita-inexistente: El motivo no existe.',
    });
  });

  it('sin visitas: todo en null y false', () => {
    const { rutas } = montar();
    rutas.aplicarSnapshot([delServidor()]);
    expect(rutas.delDia()[0]).toMatchObject({
      visita_sin_venta: false,
      ultima_visita_motivo: null,
      ultima_visita_en: null,
      visitas_estado: null,
    });
  });

  it('una baja de la oficina que solo fue visitada cuenta como visitado (va a "Fuera de ruta")', () => {
    const { rutas, visitas } = montar();
    rutas.aplicarSnapshot([delServidor({ activo: 0 })]);
    visitarA(visitas);
    expect(rutas.delDia()).toMatchObject([{ activo: 0, visitado: true }]);
  });
});
