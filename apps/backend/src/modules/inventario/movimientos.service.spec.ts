import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { MovimientoNormalizado } from './datos-movimiento';
import { MovimientoRechazado } from './movimiento-rechazado';
import {
  MovimientosService,
  type ContextoMovimiento,
} from './movimientos.service';

const trx = {} as Transaction<DB>;

const contexto: ContextoMovimiento = {
  id: 'c0ffee00-0000-4000-8000-000000002700',
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  clienteId: 'cliente-1',
  fechaOperacion: '2026-10-23',
};

const movimiento: MovimientoNormalizado = {
  tipo: 'merma_cliente',
  comentario: 'Venían reventadas',
  registradoEn: '2026-10-24T01:30:00.000Z',
  lineas: [
    { presentacionId: 'litro', sentido: 'recibido', piezas: 3 },
    { presentacionId: 'medio', sentido: 'entregado', piezas: 2 },
    { presentacionId: 'litro', sentido: 'entregado', piezas: 1 },
  ],
};

function montar(
  opciones: { existentes?: string[]; idInsertado?: string | null } = {},
) {
  const repo = {
    presentacionesExistentes: jest
      .fn()
      .mockResolvedValue(new Set(opciones.existentes ?? ['litro', 'medio'])),
    insertar: jest
      .fn()
      .mockResolvedValue(
        'idInsertado' in opciones ? opciones.idInsertado : contexto.id,
      ),
    insertarLineas: jest.fn().mockResolvedValue(undefined),
  };
  return { servicio: new MovimientosService(repo), repo };
}

describe('MovimientosService.registrarMovimiento (T-27 pieza 2, D7)', () => {
  it('inserta con el id de la clave, el dia del sobre y las lineas', async () => {
    const { servicio, repo } = montar();
    await expect(
      servicio.registrarMovimiento(movimiento, contexto, trx),
    ).resolves.toEqual({ tabla: 'movimiento_inventario', id: contexto.id });
    // Sin repetir: la misma presentacion recibida y entregada se pregunta una vez.
    expect(repo.presentacionesExistentes).toHaveBeenCalledWith(
      ['litro', 'medio'],
      trx,
    );
    expect(repo.insertar).toHaveBeenCalledWith(
      {
        id: contexto.id,
        sucursalId: 'sucursal-tj',
        vendedorId: 'vendedor-1',
        clienteId: 'cliente-1',
        tipo: 'merma_cliente',
        // El dia del sobre tal cual, aunque en UTC `registradoEn` ya sea el 24.
        fecha: '2026-10-23',
        comentario: 'Venían reventadas',
        registradoEn: '2026-10-24T01:30:00.000Z',
      },
      trx,
    );
    expect(repo.insertarLineas).toHaveBeenCalledWith(
      contexto.id,
      movimiento.lineas,
      trx,
    );
  });

  it('una presentacion que no existe es presentacion-inexistente y no inserta nada', async () => {
    const { servicio, repo } = montar({ existentes: ['litro'] });
    const error = await servicio
      .registrarMovimiento(movimiento, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MovimientoRechazado);
    expect((error as MovimientoRechazado).razon).toBe(
      'presentacion-inexistente',
    );
    expect((error as Error).message).toMatch(/^lineas: .*medio/);
    expect(repo.insertar).not.toHaveBeenCalled();
    expect(repo.insertarLineas).not.toHaveBeenCalled();
  });

  it('un id ocupado es movimiento-id-ocupado con un motivo neutro y sin lineas', async () => {
    const { servicio, repo } = montar({ idInsertado: null });
    const error = await servicio
      .registrarMovimiento(movimiento, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MovimientoRechazado);
    expect((error as MovimientoRechazado).razon).toBe('movimiento-id-ocupado');
    expect((error as Error).message).toBe(
      'El id de este movimiento ya está ocupado. Avisa a la oficina.',
    );
    expect(repo.insertarLineas).not.toHaveBeenCalled();
  });
});
