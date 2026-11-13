import { depsDePrueba, FIRMA_DE_PRUEBA, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import type { EstadoCarga } from '../tipos';
import { aplicarSnapshotCargas, crearRepositorioCargas } from './cargas';
import { crearRepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';
import { crearRepositorioFolios } from './folios';
import { crearRepositorioJornadas, ErrorJornada } from './jornadas';
import { crearRepositorioMovimientos, ErrorMovimiento, type DatosRegistroMovimiento } from './movimientos';
import { crearRepositorioVentas } from './ventas';

/**
 * Los movimientos de inventario en la tablet (T-27 pieza 2): forma, limite de
 * consumo, bloqueo por carga pendiente y faltantes, calculados DENTRO de la
 * transaccion de `registrar`. `MOMENTO` es el 2026-08-07.
 */

const HOY = '2026-08-07';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const folios = crearRepositorioFolios(deps);
  return {
    deps,
    catalogos,
    jornadas: crearRepositorioJornadas(deps),
    cargas: crearRepositorioCargas(deps, { catalogos }),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    movimientos: crearRepositorioMovimientos(deps, { catalogos }),
  };
}

/** Merma del cliente: 3 Jamaica 1 L danadas; le repone 2 Jamaica 500 ml. */
const mermaCliente = (extra: Partial<DatosRegistroMovimiento> = {}): DatosRegistroMovimiento => ({
  vendedorId: 'ven-1',
  tipo: 'merma_cliente',
  clienteId: 'cli-1',
  comentario: null,
  lineas: [
    { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
    { presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 },
  ],
  ...extra,
});

/** Merma del trayecto o consumo: solo piezas que salen. */
const sale = (
  tipo: 'merma_trayecto' | 'consumo',
  piezas = 1,
  presentacionId = 'pre-1',
): DatosRegistroMovimiento => ({
  vendedorId: 'ven-1',
  tipo,
  clienteId: null,
  comentario: null,
  lineas: [{ presentacionId, sentido: 'entregado', piezas }],
});

const cuantos = (deps: DepsRepositorio) => ({
  movimientos: deps.bd.getFirstSync<{ n: number }>('select count(*) as n from movimiento')?.n,
  lineas: deps.bd.getFirstSync<{ n: number }>('select count(*) as n from movimiento_linea')?.n,
});

function prenderControl(deps: DepsRepositorio) {
  deps.bd.runSync("update vendedor set control_inventario = 1 where id = 'ven-1'");
}

function limite(deps: DepsRepositorio, n: number) {
  deps.bd.runSync('update vendedor set consumo_diario_max = $n where id = $id', { $n: n, $id: 'ven-1' });
}

function cargar(
  deps: DepsRepositorio,
  id: string,
  numero: number,
  estado: EstadoCarga,
  lineas: { presentacion_id: string; piezas: number }[],
) {
  aplicarSnapshotCargas(
    deps.bd,
    [
      {
        id,
        vendedor_id: 'ven-1',
        fecha: HOY,
        numero,
        estado,
        motivo_rechazo: estado === 'rechazada' ? 'Faltan cajas' : null,
        version: 1,
        respondida_en: estado === 'pendiente' ? null : MOMENTO,
        activo: 1,
        lineas,
      },
    ],
    MOMENTO,
  );
}

describe('movimientos.registrar (T-27 pieza 2)', () => {
  it('graba la merma del cliente con sus lineas, pendiente de subir, en el dia de hoy', () => {
    const { movimientos } = montar();
    const m = movimientos.registrar(mermaCliente({ comentario: '  Venían reventadas  ' }));
    expect(m).toMatchObject({
      fecha: HOY,
      vendedor_id: 'ven-1',
      cliente_id: 'cli-1',
      tipo: 'merma_cliente',
      comentario: 'Venían reventadas',
      registrado_en: MOMENTO,
      sync_estado: 'pendiente',
      sync_error: null,
    });
    expect(m.lineas.map((l) => [l.etiqueta, l.sentido, l.piezas])).toEqual([
      ['Jamaica 1 L', 'recibido', 3],
      ['Jamaica 500 ml', 'entregado', 2],
    ]);
  });

  it('publica el cambio despues del commit; un oyente que truena no lo convierte en fallo', () => {
    const { catalogos, movimientos, deps } = montar();
    const antes = catalogos.version();
    movimientos.registrar(sale('merma_trayecto'));
    expect(catalogos.version()).toBe(antes + 1);
    catalogos.suscribir(() => {
      throw new Error('una pantalla abierta truena al refrescar');
    });
    expect(() => movimientos.registrar(sale('merma_trayecto'))).not.toThrow();
    expect(cuantos(deps).movimientos).toBe(2);
  });

  it('Review Focus 3: merma del cliente solo con Le entregué no se graba', () => {
    const { movimientos, deps } = montar();
    expect(() =>
      movimientos.registrar(
        mermaCliente({ lineas: [{ presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 }] }),
      ),
    ).toThrow(new ErrorMovimiento('Captura al menos una pieza en «Recibí dañado».'));
    expect(cuantos(deps)).toEqual({ movimientos: 0, lineas: 0 });
  });

  it('Review Focus 1: con límite 1 y 1 registrada, el siguiente consumo no se graba', () => {
    const { movimientos, deps } = montar();
    movimientos.registrar(sale('consumo'));
    expect(movimientos.consumoDeHoy('ven-1')).toBe(1);
    expect(() => movimientos.registrar(sale('consumo'))).toThrow('Ya registraste tu consumo de hoy.');
    expect(cuantos(deps)).toEqual({ movimientos: 1, lineas: 1 });
  });

  it('Review Focus 1: con límite 0 no se graba consumo', () => {
    const { movimientos, deps } = montar();
    limite(deps, 0);
    expect(() => movimientos.registrar(sale('consumo'))).toThrow('Tu sucursal no tiene consumo propio.');
    expect(cuantos(deps)).toEqual({ movimientos: 0, lineas: 0 });
  });

  it('con límite 3 y 2 registradas, 2 más no caben y dice cuánto queda', () => {
    const { movimientos, deps } = montar();
    limite(deps, 3);
    movimientos.registrar(sale('consumo', 2));
    expect(() => movimientos.registrar(sale('consumo', 2, 'pre-2'))).toThrow(
      'Te quedan 1 de consumo hoy; no puedes registrar 2.',
    );
    expect(movimientos.registrar(sale('consumo', 1, 'pre-2')).tipo).toBe('consumo');
  });

  it('Review Focus 2: con el control prendido una reposición que deja negativo no se graba y dice cuántas faltan', () => {
    const { movimientos, deps } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-2', piezas: 2 }]);
    expect(() =>
      movimientos.registrar(
        mermaCliente({
          lineas: [
            { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
            { presentacionId: 'pre-2', sentido: 'entregado', piezas: 3 },
          ],
        }),
      ),
    ).toThrow('No te alcanza el producto: Jamaica 500 ml: falta 1 pieza.');
    expect(cuantos(deps)).toEqual({ movimientos: 0, lineas: 0 });
  });

  it('Review Focus 2: con el control apagado la misma reposición sí se graba', () => {
    const { movimientos, deps, cargas } = montar();
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-2', piezas: 2 }]);
    movimientos.registrar(
      mermaCliente({
        lineas: [
          { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
          { presentacionId: 'pre-2', sentido: 'entregado', piezas: 3 },
        ],
      }),
    );
    expect(cargas.filasInventario('ven-1').find((f) => f.presentacionId === 'pre-2')?.existencia).toBe(-1);
  });

  it('con el control prendido y una carga pendiente no saca piezas; lo solo recibido sí entra (D5)', () => {
    const { movimientos, deps } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 50 }]);
    cargar(deps, 'carga-2', 2, 'pendiente', [{ presentacion_id: 'pre-1', piezas: 10 }]);
    expect(() => movimientos.registrar(sale('merma_trayecto'))).toThrow(
      'Tienes una carga por aceptar. Acéptala en Inventario antes de sacar piezas de la camioneta.',
    );
    expect(
      movimientos.registrar(mermaCliente({ lineas: [{ presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 }] }))
        .tipo,
    ).toBe('merma_cliente');
    expect(cuantos(deps)).toEqual({ movimientos: 1, lineas: 1 });
  });

  it('valida con la existencia del momento de grabar (dentro de la transaccion)', () => {
    const { movimientos, deps } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 2 }]);
    expect(() => movimientos.registrar(sale('merma_trayecto', 3))).toThrow('Jamaica 1 L: falta 1 pieza');
    // A media captura se acepta una recarga (la escribe la respuesta o el pull)...
    cargar(deps, 'carga-2', 2, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 5 }]);
    // ...y el MISMO registrar valida con lo que hay al grabar.
    expect(movimientos.registrar(sale('merma_trayecto', 3)).tipo).toBe('merma_trayecto');
  });

  it('la venta tambien resta los movimientos (D5)', () => {
    const { movimientos, ventas, deps } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 20 }]);
    movimientos.registrar(sale('merma_trayecto', 18));
    expect(() =>
      ventas.registrar({
        vendedorId: 'ven-1',
        clienteId: 'cli-1',
        numNota: '',
        contadoCredito: 'contado',
        factura: 'N/A',
        comentarios: null,
        lineas: [{ presentacionId: 'pre-1', cantidad: 3, cantidadPromocion: 0 }],
        regalos: [],
        firma: FIRMA_DE_PRUEBA,
      }),
    ).toThrow('Jamaica 1 L: falta 1 pieza');
  });

  it('con el dia cerrado no se registra (T-38) y no deja fila', () => {
    const { movimientos, jornadas, deps } = montar();
    const j = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(j.id, 20);
    expect(() => movimientos.registrar(sale('merma_trayecto'))).toThrow(ErrorJornada);
    expect(cuantos(deps)).toEqual({ movimientos: 0, lineas: 0 });
  });

  it('un cliente o un producto que la tablet no conoce no se graba', () => {
    const { movimientos, deps } = montar();
    expect(() => movimientos.registrar(mermaCliente({ clienteId: 'no-existe' }))).toThrow(ErrorMovimiento);
    expect(() => movimientos.registrar(sale('merma_trayecto', 1, 'pre-nueva'))).toThrow(
      'Un producto no está en el catálogo de la tablet. Sincroniza y vuelve a capturar.',
    );
    expect(cuantos(deps)).toEqual({ movimientos: 0, lineas: 0 });
  });

  it('a un prospecto si se le puede registrar merma (Review Focus 4 del lado de la tablet)', () => {
    const { movimientos } = montar();
    expect(movimientos.registrar(mermaCliente({ clienteId: 'cli-2' })).cliente_id).toBe('cli-2');
  });
});

describe('consultas y cola de movimientos', () => {
  it('delDia y delDiaDelCliente, en orden de captura', () => {
    const { movimientos } = montar();
    const a = movimientos.registrar(sale('merma_trayecto'));
    const b = movimientos.registrar(mermaCliente());
    const c = movimientos.registrar(sale('consumo'));
    expect(movimientos.delDia('ven-1').map((m) => m.id)).toEqual([a.id, b.id, c.id]);
    expect(movimientos.delDiaDelCliente('cli-1').map((m) => m.id)).toEqual([b.id]);
    expect(movimientos.delDiaDelCliente('cli-2')).toEqual([]);
    expect(movimientos.delDia('ven-1', '2026-08-06')).toEqual([]);
  });

  it('pendientes, sincronizada y error (se reenvia con la misma clave)', () => {
    const { movimientos } = montar();
    const a = movimientos.registrar(sale('merma_trayecto'));
    const b = movimientos.registrar(mermaCliente());
    movimientos.marcarSincronizada(a.id);
    movimientos.marcarError(b.id, 'cliente-fuera-de-alcance: El cliente no existe o no es de tu sucursal.');
    expect(movimientos.pendientesDeSincronizar().map((m) => m.id)).toEqual([b.id]);
    expect(movimientos.porId(a.id)).toMatchObject({ sync_estado: 'sincronizado', sync_error: null });
    expect(movimientos.porId(b.id)?.sync_estado).toBe('error');
  });

  it('presentaciones: las activas del catalogo, con su nombre', () => {
    const { movimientos } = montar();
    expect(movimientos.presentaciones()).toEqual([
      { presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L' },
      { presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml' },
    ]);
  });

  it('Inventario: las columnas nuevas y lo que regresa a la planta', () => {
    const { deps, cargas, movimientos } = montar();
    cargar(deps, 'carga-1', 1, 'aceptada', [
      { presentacion_id: 'pre-1', piezas: 24 },
      { presentacion_id: 'pre-2', piezas: 12 },
    ]);
    movimientos.registrar(mermaCliente());
    movimientos.registrar(sale('merma_trayecto', 1, 'pre-1'));
    movimientos.registrar(sale('consumo', 1, 'pre-2'));
    expect(cargas.filasInventario('ven-1')).toEqual([
      {
        presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L',
        cargado: 24, vendido: 0, regalado: 0,
        mermaEntregada: 0, mermaTrayecto: 1, consumo: 0, mermaRecibida: 3,
        existencia: 23, mermaPorRegresar: 4,
      },
      {
        presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml',
        cargado: 12, vendido: 0, regalado: 0,
        mermaEntregada: 2, mermaTrayecto: 0, consumo: 1, mermaRecibida: 0,
        existencia: 9, mermaPorRegresar: 0,
      },
    ]);
  });

  it('Review Focus 5: consumo_diario_max baja en el pull y un login sin red no lo pisa', () => {
    const { catalogos, movimientos } = montar();
    expect(movimientos.consumoDiarioMax('ven-1')).toBe(1);

    const yo = snapshotDePrueba().vendedores?.[0];
    if (!yo) throw new Error('El snapshot de prueba trae a ven-1.');
    catalogos.guardarSnapshot({ vendedores: [{ ...yo, consumo_diario_max: 3 }] });
    expect(movimientos.consumoDiarioMax('ven-1')).toBe(3);

    // El upsert de identidad del login sin red no conoce el limite.
    catalogos.guardarSnapshot({
      vendedores: [{ id: 'ven-1', login: 'aperez', nombre: 'Abraham Perez', sucursal_id: 'suc-tj', activo: 1, folio_segmento: null }],
    });
    expect(movimientos.consumoDiarioMax('ven-1')).toBe(3);

    // Un 0 de verdad si gana (apaga el consumo).
    catalogos.guardarSnapshot({ vendedores: [{ ...yo, consumo_diario_max: 0 }] });
    expect(movimientos.consumoDiarioMax('ven-1')).toBe(0);
  });
});
