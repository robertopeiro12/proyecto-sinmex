import { depsDePrueba, FIRMA_DE_PRUEBA, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import type { Booleano, EstadoCarga } from '../tipos';
import { aplicarSnapshotCargas, crearRepositorioCargas, type FilaCargaPull } from './cargas';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioFolios } from './folios';
import { crearRepositorioVentas } from './ventas';

/**
 * Las cargas en la tablet (T-27): la mezcla del pull, el inventario del dia y la
 * casilla del vendedor. `MOMENTO` es el 2026-08-07.
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
    cargas: crearRepositorioCargas(deps, { catalogos }),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
  };
}

function fila(extra: Partial<FilaCargaPull> = {}): FilaCargaPull {
  const estado: EstadoCarga = extra.estado ?? 'pendiente';
  return {
    id: 'carga-1',
    vendedor_id: 'ven-1',
    fecha: HOY,
    numero: 1,
    estado,
    motivo_rechazo: estado === 'rechazada' ? 'Faltan cajas' : null,
    version: 1,
    respondida_en: estado === 'pendiente' ? null : MOMENTO,
    activo: 1 as Booleano,
    lineas: [
      { presentacion_id: 'pre-1', piezas: 24 },
      { presentacion_id: 'pre-2', piezas: 12 },
    ],
    ...extra,
  };
}

describe('aplicarSnapshotCargas (mezcla del pull)', () => {
  it('escribe la carga y sus lineas; la segunda vez reemplaza las lineas sin duplicar', () => {
    const { deps, cargas } = montar();
    expect(aplicarSnapshotCargas(deps.bd, [fila()], MOMENTO)).toBe(1);
    expect(cargas.porId('carga-1')).toMatchObject({
      estado: 'pendiente',
      version: 1,
      actualizado_en: MOMENTO,
      lineas: [
        { presentacion_id: 'pre-1', piezas: 24, etiqueta: 'Jamaica 1 L' },
        { presentacion_id: 'pre-2', piezas: 12, etiqueta: 'Jamaica 500 ml' },
      ],
    });

    aplicarSnapshotCargas(
      deps.bd,
      [fila({ version: 2, lineas: [{ presentacion_id: 'pre-2', piezas: 6 }] })],
      MOMENTO,
    );
    expect(cargas.porId('carga-1')?.lineas.map((l) => [l.presentacion_id, l.piezas])).toEqual([
      ['pre-2', 6],
    ]);
  });

  it('una presentacion que la tablet no conoce no tumba el pull', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila({ lineas: [{ presentacion_id: 'pre-nueva', piezas: 3 }] })], MOMENTO);
    expect(cargas.porId('carga-1')?.lineas[0]?.etiqueta).toBe('Producto fuera del catálogo');
  });

  it('un pull que salio antes de la respuesta no la deshace (misma version)', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila({ estado: 'aceptada' })], MOMENTO);
    expect(aplicarSnapshotCargas(deps.bd, [fila()], MOMENTO)).toBe(0);
    expect(cargas.porId('carga-1')?.estado).toBe('aceptada');
  });

  it('una version vieja no pisa a una nueva, y una baja es final', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila({ version: 2, lineas: [{ presentacion_id: 'pre-1', piezas: 30 }] })], MOMENTO);
    aplicarSnapshotCargas(deps.bd, [fila({ version: 1 })], MOMENTO);
    expect(cargas.porId('carga-1')?.version).toBe(2);

    aplicarSnapshotCargas(deps.bd, [fila({ version: 2, activo: 0 })], MOMENTO);
    aplicarSnapshotCargas(deps.bd, [fila({ version: 2 })], MOMENTO);
    expect(cargas.porId('carga-1')?.activo).toBe(0);
  });

  it('catalogos.guardarSnapshot aplica las cargas del pull y avisa del cambio', () => {
    const { catalogos, cargas } = montar();
    const antes = catalogos.version();
    catalogos.guardarSnapshot({ cargas: [fila()] });
    expect(catalogos.version()).toBe(antes + 1);
    expect(cargas.pendienteDeHoy('ven-1')?.id).toBe('carga-1');
  });
});

describe('el inventario del dia', () => {
  it('delDia: las vivas de hoy por numero; pendienteDeHoy: la de menor numero', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(
      deps.bd,
      [
        fila({ id: 'c-2', numero: 2 }),
        fila({ id: 'c-1', numero: 1, estado: 'aceptada' }),
        fila({ id: 'c-3', numero: 3 }),
        fila({ id: 'c-ayer', fecha: '2026-08-06' }),
      ],
      MOMENTO,
    );
    expect(cargas.delDia('ven-1').map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3']);
    expect(cargas.pendienteDeHoy('ven-1')?.id).toBe('c-2');
  });

  it('Review Focus 4: una carga dada de baja sale del inventario y del aviso', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila(), fila({ id: 'c-ok', numero: 2, estado: 'aceptada' })], MOMENTO);
    expect(cargas.pendienteDeHoy('ven-1')?.id).toBe('carga-1');

    aplicarSnapshotCargas(deps.bd, [fila({ activo: 0 }), fila({ id: 'c-ok', numero: 2, estado: 'aceptada', activo: 0 })], MOMENTO);
    expect(cargas.pendienteDeHoy('ven-1')).toBeNull();
    expect(cargas.delDia('ven-1')).toEqual([]);
    expect(cargas.filasInventario('ven-1')).toEqual([]);
  });

  it('filasInventario: cargado − vendido − regalado por presentacion, con su nombre', () => {
    const { deps, cargas, ventas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila({ estado: 'aceptada' })], MOMENTO);
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 10, cantidadPromocion: 1 }],
      regalos: [{ promocionId: 'promo-general', presentacionId: 'pre-1', cantidad: 1, texto: 'Por cada 10 Jamaica, 1 Jamaica gratis' }],
      firma: FIRMA_DE_PRUEBA,
    });
    expect(cargas.filasInventario('ven-1')).toEqual([
      {
        presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L', cargado: 24, vendido: 10, regalado: 1,
        mermaEntregada: 0, mermaTrayecto: 0, consumo: 0, mermaRecibida: 0, existencia: 13, mermaPorRegresar: 0,
      },
      {
        presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml', cargado: 12, vendido: 0, regalado: 0,
        mermaEntregada: 0, mermaTrayecto: 0, consumo: 0, mermaRecibida: 0, existencia: 12, mermaPorRegresar: 0,
      },
    ]);
  });

  it('paraVenta: control, bloqueo y existencias del momento', () => {
    const { deps, cargas } = montar();
    aplicarSnapshotCargas(deps.bd, [fila()], MOMENTO);
    expect(cargas.paraVenta('ven-1')).toEqual({ controlInventario: false, bloqueo: null, existencias: new Map() });

    deps.bd.runSync("update vendedor set control_inventario = 1 where id = 'ven-1'");
    expect(cargas.paraVenta('ven-1').bloqueo).toBe('Tienes una carga por aceptar');
  });

  it('aplicarRespuesta escribe la carga que contesto el servidor y avisa a las pantallas', () => {
    const { catalogos, cargas, deps } = montar();
    aplicarSnapshotCargas(deps.bd, [fila()], MOMENTO);
    const antes = catalogos.version();
    cargas.aplicarRespuesta(fila({ estado: 'aceptada' }));
    expect(cargas.porId('carga-1')?.estado).toBe('aceptada');
    expect(catalogos.version()).toBe(antes + 1);
  });

  it('si un oyente del refresco truena, la respuesta ya escrita no se reporta como fallida', () => {
    const { catalogos, cargas, deps } = montar();
    aplicarSnapshotCargas(deps.bd, [fila()], MOMENTO);
    catalogos.suscribir(() => {
      throw new Error('una pantalla abierta truena al refrescar');
    });
    expect(() => cargas.aplicarRespuesta(fila({ estado: 'aceptada' }))).not.toThrow();
    expect(cargas.porId('carga-1')?.estado).toBe('aceptada');
  });
});

describe('vendedor.control_inventario (D7)', () => {
  it('baja en el pull y un login sin red (sin el campo) no lo apaga', () => {
    const { catalogos, cargas } = montar();
    expect(cargas.controlInventario('ven-1')).toBe(false);

    const yo = snapshotDePrueba().vendedores?.[0];
    if (!yo) throw new Error('El snapshot de prueba trae a ven-1.');
    catalogos.guardarSnapshot({ vendedores: [{ ...yo, control_inventario: 1 }] });
    expect(cargas.controlInventario('ven-1')).toBe(true);

    // El upsert de identidad del login sin red no conoce la casilla.
    catalogos.guardarSnapshot({
      vendedores: [{ id: 'ven-1', login: 'aperez', nombre: 'Abraham Perez', sucursal_id: 'suc-tj', activo: 1, folio_segmento: null }],
    });
    expect(cargas.controlInventario('ven-1')).toBe(true);
  });

  it('un vendedor nuevo sin la casilla nace con el control apagado', () => {
    const { catalogos, cargas } = montar();
    catalogos.guardarSnapshot({
      vendedores: [{ id: 'ven-9', login: 'nuevo', nombre: 'Nuevo', sucursal_id: 'suc-tj', activo: 1, folio_segmento: null }],
    });
    expect(cargas.controlInventario('ven-9')).toBe(false);
  });
});
