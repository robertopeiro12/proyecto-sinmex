import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { ClientesRepository } from './clientes.repository';
import { ClientesService, type ContextoProspecto } from './clientes.service';
import type { ProspectoNormalizado } from './datos-prospecto';
import type { UbicacionClientesService } from './ubicacion-clientes.service';
import { ProspectoRechazado } from './prospecto-rechazado';

const TIPO_NEGOCIO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/**
 * El servicio no usa la transaccion: solo la pasa a quien escribe. Un objeto
 * vacio basta para comprobar que la pasa siempre la misma, y que nunca abre otra
 * — que es justo lo que romperia la atomicidad con el buzon (ADR-0009 §2.3).
 */
const trx = {} as Transaction<DB>;

const contexto = (
  extra: Partial<ContextoProspecto> = {},
): ContextoProspecto => ({
  id: '7f2c0000-0000-4000-8000-000000000001',
  sucursalId: 'sucursal-tj',
  fechaOperacion: '2026-09-14',
  vendedorId: 'vendedor-1',
  // Un prospecto NO lleva folio: no es una nota que nadie firme.
  folio: null,
  // Nace de la app, no del portal.
  usuarioId: null,
  ...extra,
});

const prospecto = (
  extra: Partial<ProspectoNormalizado> = {},
): ProspectoNormalizado => ({
  nombre: 'Tacos Aaron',
  telefono: '6641112233',
  encargado: 'Don Aaron',
  tipoNegocioId: TIPO_NEGOCIO,
  comentarios: 'Quiere probar jamaica',
  domicilio: null,
  lat: 32.5149,
  lng: -117.0382,
  ...extra,
});

function montar(opciones: { tipoNegocioVigente?: boolean } = {}) {
  const repo = {
    tipoNegocioVigente: jest
      .fn()
      .mockResolvedValue(opciones.tipoNegocioVigente ?? true),
    insertarProspecto: jest.fn().mockResolvedValue({ id: 'cliente-nuevo' }),
  };
  const ubicacion = { geocodificarEnSegundoPlano: jest.fn() };
  const servicio = new ClientesService(
    repo as unknown as ClientesRepository,
    ubicacion as unknown as UbicacionClientesService,
  );
  return { servicio, repo };
}

describe('ClientesService.crearProspecto', () => {
  it('inserta el prospecto en la sucursal del vendedor y devuelve su id', async () => {
    const { servicio, repo } = montar();

    await expect(
      servicio.crearProspecto(prospecto(), contexto(), trx),
    ).resolves.toEqual({ id: 'cliente-nuevo' });

    expect(repo.insertarProspecto).toHaveBeenCalledTimes(1);
    expect(repo.insertarProspecto).toHaveBeenCalledWith(
      {
        id: '7f2c0000-0000-4000-8000-000000000001',
        nombre: 'Tacos Aaron',
        telefono: '6641112233',
        encargado: 'Don Aaron',
        tipoNegocioId: TIPO_NEGOCIO,
        comentarios: 'Quiere probar jamaica',
        domicilio: null,
        lat: 32.5149,
        lng: -117.0382,
        sucursalId: 'sucursal-tj',
      },
      trx,
    );
  });

  /**
   * La sucursal sale del **token**, no del cuerpo: el prospecto nace donde
   * trabaja quien lo capturo. Es la misma doctrina de `resolverAlcance` de T-09
   * que el `push` ya aplico antes de llegar aqui ("el cliente propone, el
   * servidor dispone").
   */
  it('la sucursal viene del contexto, no de los datos capturados', async () => {
    const { servicio, repo } = montar();

    await servicio.crearProspecto(
      prospecto(),
      contexto({ sucursalId: 'sucursal-mx' }),
      trx,
    );

    expect(repo.insertarProspecto).toHaveBeenCalledWith(
      expect.objectContaining({ sucursalId: 'sucursal-mx' }),
      trx,
    );
  });

  it('escribe con la transaccion que le dan y nunca abre otra', async () => {
    const { servicio, repo } = montar();
    const otra = {} as Transaction<DB>;

    await servicio.crearProspecto(prospecto(), contexto(), otra);

    expect(repo.tipoNegocioVigente).toHaveBeenCalledWith(TIPO_NEGOCIO, otra);
    expect(repo.insertarProspecto).toHaveBeenCalledWith(
      expect.anything(),
      otra,
    );
  });

  it('sin tipo de negocio no consulta el catalogo: es un campo opcional', async () => {
    const { servicio, repo } = montar();

    await servicio.crearProspecto(
      prospecto({ tipoNegocioId: null }),
      contexto(),
      trx,
    );

    expect(repo.tipoNegocioVigente).not.toHaveBeenCalled();
    expect(repo.insertarProspecto).toHaveBeenCalledWith(
      expect.objectContaining({ tipoNegocioId: null }),
      trx,
    );
  });

  it('sin ubicacion se guarda igual: negar el permiso no bloquea el alta', async () => {
    const { servicio, repo } = montar();

    await servicio.crearProspecto(
      prospecto({ lat: null, lng: null }),
      contexto(),
      trx,
    );

    expect(repo.insertarProspecto).toHaveBeenCalledWith(
      expect.objectContaining({ lat: null, lng: null }),
      trx,
    );
  });

  it('guarda la direccion que escribio el vendedor (T-72, D2)', async () => {
    const { servicio, repo } = montar();

    await servicio.crearProspecto(
      prospecto({ domicilio: 'Av. Revolución 1234', lat: null, lng: null }),
      contexto(),
      trx,
    );

    expect(repo.insertarProspecto).toHaveBeenCalledWith(
      expect.objectContaining({
        domicilio: 'Av. Revolución 1234',
        lat: null,
        lng: null,
      }),
      trx,
    );
  });

  describe('cuando el tipo de negocio ya no existe', () => {
    it('lanza ProspectoRechazado con su razon de dominio', async () => {
      const { servicio } = montar({ tipoNegocioVigente: false });

      await expect(
        servicio.crearProspecto(prospecto(), contexto(), trx),
      ).rejects.toBeInstanceOf(ProspectoRechazado);

      await expect(
        servicio.crearProspecto(prospecto(), contexto(), trx),
      ).rejects.toMatchObject({ razon: 'tipo-negocio-inexistente' });
    });

    /**
     * "No escribe nada antes de lanzar": si insertara y luego lanzara, el
     * rollback lo taparia, pero el buzon quedaria con una fila proyectada a
     * medias si algun dia el orden cambiara. Se comprueba explicitamente.
     */
    it('no inserta nada', async () => {
      const { servicio, repo } = montar({ tipoNegocioVigente: false });

      await expect(
        servicio.crearProspecto(prospecto(), contexto(), trx),
      ).rejects.toThrow();
      expect(repo.insertarProspecto).not.toHaveBeenCalled();
    });

    it('el motivo manda a la oficina a reactivar el tipo y no pide volver a capturar', async () => {
      const { servicio } = montar({ tipoNegocioVigente: false });

      await expect(
        servicio.crearProspecto(prospecto(), contexto(), trx),
      ).rejects.toThrow(/Pide a la oficina que lo reactive/);
      await expect(
        servicio.crearProspecto(prospecto(), contexto(), trx),
      ).rejects.not.toThrow(/vuelve a guardar|vuelve a capturar/);
    });
  });

  /** T-75 (D2): el insert lleva el id de la clave; si choca, se traduce. */
  describe('id ocupado', () => {
    const errorUnico = (constraint: string) =>
      Object.assign(new Error('duplicate key'), { code: '23505', constraint });

    it('un choque con cliente_pkey es id-ocupado, con motivo neutro', async () => {
      const { servicio, repo } = montar();
      repo.insertarProspecto.mockRejectedValue(errorUnico('cliente_pkey'));

      const r = servicio.crearProspecto(prospecto(), contexto(), trx);
      await expect(r).rejects.toBeInstanceOf(ProspectoRechazado);
      await expect(r).rejects.toMatchObject({ razon: 'id-ocupado' });
      await expect(r).rejects.toThrow(/no es nueva; avisa a la oficina/);
      await expect(r).rejects.not.toThrow(/vuelve a capturar/);
      await expect(r).rejects.not.toThrow(/7f2c0000/);
    });

    it('otro unique se relanza tal cual: seria otro bug', async () => {
      const { servicio, repo } = montar();
      const otro = errorUnico('uq_otra_cosa');
      repo.insertarProspecto.mockRejectedValue(otro);

      await expect(
        servicio.crearProspecto(prospecto(), contexto(), trx),
      ).rejects.toBe(otro);
    });
  });
});
