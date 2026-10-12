import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { RutaRechazada } from './ruta-rechazada';
import type { RutasDiariasRepository } from './rutas-diarias.repository';
import {
  RutasDiariasService,
  type ContextoRutaAlta,
} from './rutas-diarias.service';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';

/** El servicio no usa la transaccion: solo la pasa a quien escribe. */
const trx = {} as Transaction<DB>;

const contexto: ContextoRutaAlta = {
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  fechaOperacion: '2026-10-12',
};

function montar(
  opciones: {
    clienteValido?: boolean;
    siguiente?: number;
    idInsertado?: string | null;
  } = {},
) {
  const repo = {
    clienteParaRuta: jest
      .fn()
      .mockResolvedValue(opciones.clienteValido ?? true),
    bloquearVendedor: jest.fn().mockResolvedValue(undefined),
    siguienteOrden: jest.fn().mockResolvedValue(opciones.siguiente ?? 1),
    insertarSiNoExiste: jest
      .fn()
      .mockResolvedValue(
        'idInsertado' in opciones ? opciones.idInsertado : 'ruta-1',
      ),
  };
  return {
    servicio: new RutasDiariasService(
      repo as unknown as RutasDiariasRepository,
    ),
    repo,
  };
}

describe('RutasDiariasService.agregarAlDia (T-37)', () => {
  it('inserta al final de la ruta de ese dia, como del vendedor, y devuelve la fila para el buzon', async () => {
    const { servicio, repo } = montar({ siguiente: 6 });

    await expect(
      servicio.agregarAlDia({ clienteId: CLIENTE }, contexto, trx),
    ).resolves.toEqual({ tabla: 'ruta', id: 'ruta-1' });

    expect(repo.clienteParaRuta).toHaveBeenCalledWith(
      CLIENTE,
      'sucursal-tj',
      trx,
    );
    expect(repo.bloquearVendedor).toHaveBeenCalledWith('vendedor-1', trx);
    expect(repo.siguienteOrden).toHaveBeenCalledWith(
      'vendedor-1',
      '2026-10-12',
      trx,
    );
    expect(repo.insertarSiNoExiste).toHaveBeenCalledWith(
      {
        vendedorId: 'vendedor-1',
        clienteId: CLIENTE,
        fecha: '2026-10-12',
        orden: 6,
        origen: 'vendedor',
      },
      trx,
    );
  });

  it('el orden se calcula DESPUES de bloquear al vendedor', async () => {
    const { servicio, repo } = montar();
    await servicio.agregarAlDia({ clienteId: CLIENTE }, contexto, trx);

    const bloqueo = repo.bloquearVendedor.mock.invocationCallOrder[0];
    const orden = repo.siguienteOrden.mock.invocationCallOrder[0];
    expect(bloqueo).toBeLessThan(orden);
  });

  it('un cliente que no es de la sucursal, borrado o prospecto es cliente-inexistente y no escribe nada', async () => {
    const { servicio, repo } = montar({ clienteValido: false });

    const error = await servicio
      .agregarAlDia({ clienteId: CLIENTE }, contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RutaRechazada);
    expect(error).toMatchObject({ razon: 'cliente-inexistente' });
    expect(repo.insertarSiNoExiste).not.toHaveBeenCalled();
  });

  it('si ya habia una fila viva de ese cliente ese dia es ruta-duplicada', async () => {
    const { servicio } = montar({ idInsertado: null });

    const error = await servicio
      .agregarAlDia({ clienteId: CLIENTE }, contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RutaRechazada);
    expect(error).toMatchObject({ razon: 'ruta-duplicada' });
    expect((error as Error).message).toContain('2026-10-12');
  });
});
