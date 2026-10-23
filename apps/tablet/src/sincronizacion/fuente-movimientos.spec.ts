import { depsDePrueba, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioMovimientos } from '@/datos/repositorios/movimientos';

import { fuenteMovimientos } from './fuente-movimientos';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const movimientos = crearRepositorioMovimientos(deps, { catalogos });
  return { movimientos, fuente: fuenteMovimientos(movimientos) };
}

describe('fuente de movimientos (T-27 pieza 2)', () => {
  it('sin movimientos no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('movimiento');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('la merma del cliente lleva cliente_id en el sobre, sin folio, con sus lineas', () => {
    const { movimientos, fuente } = montar();
    const m = movimientos.registrar({
      vendedorId: 'ven-1',
      tipo: 'merma_cliente',
      clienteId: 'cli-1',
      comentario: 'Reventadas',
      lineas: [
        { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
        { presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 },
      ],
    });
    const [op] = fuente.pendientes();
    expect(op).toEqual({
      clave: m.id,
      tipo: 'movimiento',
      fecha_operacion: '2026-08-07',
      ocurrido_en: MOMENTO,
      cliente_id: 'cli-1',
      datos: {
        tipo: 'merma_cliente',
        comentario: 'Reventadas',
        registrado_en: MOMENTO,
        lineas: [
          { presentacion_id: 'pre-1', sentido: 'recibido', piezas: 3 },
          { presentacion_id: 'pre-2', sentido: 'entregado', piezas: 2 },
        ],
      },
    });
    expect(op).not.toHaveProperty('folio');
  });

  it('la merma del trayecto y el consumo no llevan cliente_id', () => {
    const { movimientos, fuente } = montar();
    movimientos.registrar({
      vendedorId: 'ven-1',
      tipo: 'merma_trayecto',
      clienteId: null,
      comentario: null,
      lineas: [{ presentacionId: 'pre-1', sentido: 'entregado', piezas: 1 }],
    });
    const [op] = fuente.pendientes();
    expect(op).not.toHaveProperty('cliente_id');
    expect(op?.datos).toMatchObject({ tipo: 'merma_trayecto', comentario: null });
  });

  it('Review Focus 4: un rechazo por alcance se queda en la cola con la misma clave', () => {
    const { movimientos, fuente } = montar();
    // cli-2 es un prospecto capturado sin red: su alta todavia no esta arriba.
    const m = movimientos.registrar({
      vendedorId: 'ven-1',
      tipo: 'merma_cliente',
      clienteId: 'cli-2',
      comentario: null,
      lineas: [{ presentacionId: 'pre-1', sentido: 'recibido', piezas: 1 }],
    });
    fuente.marcarError(m.id, 'cliente-fuera-de-alcance: El cliente cli-2 no existe o no es de tu sucursal.');
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([m.id]);
    fuente.marcarSincronizada(m.id);
    expect(fuente.pendientes()).toEqual([]);
  });
});
