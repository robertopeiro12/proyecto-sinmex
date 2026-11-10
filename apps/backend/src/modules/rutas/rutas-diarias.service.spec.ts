import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { RutaRechazada } from './ruta-rechazada';
import type { NotasRutaRepository } from './notas-ruta.repository';
import type { RutasDiariasRepository } from './rutas-diarias.repository';
import type { RutasSemanalesRepository } from './rutas-semanales.repository';
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
      {} as RutasSemanalesRepository,
      {} as NotasRutaRepository,
      () => new Date(),
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
    // La tablet pinta el motivo bajo la fila, que ya trae el nombre: sin uuid.
    expect((error as Error).message).not.toContain(CLIENTE);
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

describe('RutasDiariasService.reemplazarDiaria (Ruta Diaria ampliada)', () => {
  const VENDEDOR = '1b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
  const SEMANAL_GUARDADA = 'aaaaaaaa-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
  const SEMANAL_NUEVA = '0aaaaaaa-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
  // Martes 2099-01-06 a las 23:30 de Tijuana: en UTC ya es miercoles.
  const RELOJ = () => new Date('2099-01-07T07:30:00Z');

  function montarPut() {
    const guardada = {
      id: 'rd-1',
      rutaSemanalId: SEMANAL_GUARDADA,
      nombreRuta: 'Centro',
      vehiculoId: null,
      vehiculoNombre: null,
    };
    const repo = {
      buscarSucursalUsuario: jest
        .fn()
        .mockResolvedValue({ id: null, codigo: null }),
      vendedorDeRuta: jest.fn().mockResolvedValue({
        id: VENDEDOR,
        nombre: 'Ricardo',
        sucursalId: 'suc-tj',
        sucursalCodigo: 'TJ',
      }),
      enTransaccion: jest.fn((tarea: (t: unknown) => Promise<unknown>) =>
        tarea(trx),
      ),
      rutaDia: jest.fn().mockResolvedValue(guardada),
      bloquearVendedor: jest.fn().mockResolvedValue(undefined),
      quienTraeLaRuta: jest.fn().mockResolvedValue(undefined),
      vehiculoParaRuta: jest.fn().mockResolvedValue(true),
      filasVivas: jest.fn().mockResolvedValue([]),
      clientesParaRuta: jest.fn().mockResolvedValue(new Set()),
      nombresDeClientes: jest.fn().mockResolvedValue(new Map()),
      guardarRutaDia: jest.fn().mockResolvedValue(undefined),
      aplicarReemplazo: jest.fn().mockResolvedValue(undefined),
      quitarNotasAsignadas: jest.fn().mockResolvedValue(undefined),
      filasDelDia: jest.fn().mockResolvedValue([]),
    };
    const semanales = {
      buscar: jest.fn((id: string) =>
        Promise.resolve({
          id,
          diaSemana: 2,
          nombre: id === SEMANAL_NUEVA ? 'Norte' : 'Centro',
          sucursalId: 'suc-tj',
          sucursalCodigo: 'TJ',
        }),
      ),
      lista: jest.fn().mockResolvedValue([]),
    };
    const servicio = new RutasDiariasService(
      repo as unknown as RutasDiariasRepository,
      semanales as unknown as RutasSemanalesRepository,
      {} as NotasRutaRepository,
      RELOJ,
    );
    return { servicio, repo, semanales };
  }

  it('bloquea las rutas semanales (guardada y nueva, por id) ANTES que al vendedor', async () => {
    const { servicio, repo, semanales } = montarPut();

    await servicio.reemplazarDiaria('usuario-1', {
      vendedorId: VENDEDOR,
      fecha: '2099-01-06',
      rutaSemanalId: SEMANAL_NUEVA,
      vehiculoId: null,
      clientes: [],
    });

    expect(semanales.buscar.mock.calls.map((c) => c[0])).toEqual([
      SEMANAL_NUEVA,
      SEMANAL_GUARDADA,
    ]);
    const ultimaSemanal = Math.max(
      ...semanales.buscar.mock.invocationCallOrder,
    );
    expect(ultimaSemanal).toBeLessThan(
      repo.bloquearVendedor.mock.invocationCallOrder[0],
    );
  });

  it('a las 23:30 de Tijuana "hoy" sigue siendo de Tijuana: ayer es 400 y hoy se guarda', async () => {
    const { servicio, repo } = montarPut();
    const pedir = (fecha: string) =>
      servicio.reemplazarDiaria('usuario-1', {
        vendedorId: VENDEDOR,
        fecha,
        rutaSemanalId: null,
        vehiculoId: null,
        clientes: [],
      });

    await expect(pedir('2099-01-05')).rejects.toThrow(
      'Ese día ya pasó; solo se puede consultar.',
    );
    expect(repo.enTransaccion).not.toHaveBeenCalled();
    await expect(pedir('2099-01-06')).resolves.toMatchObject({
      editable: true,
    });
  });

  it('si otro guardado cambio la ruta del dia entre la lectura y el candado, 409 sin escribir', async () => {
    const { servicio, repo } = montarPut();
    repo.rutaDia
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 'rd-otra', rutaSemanalId: null });

    await expect(
      servicio.reemplazarDiaria('usuario-1', {
        vendedorId: VENDEDOR,
        fecha: '2099-01-06',
        rutaSemanalId: null,
        vehiculoId: null,
        clientes: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(repo.guardarRutaDia).not.toHaveBeenCalled();
  });
});
