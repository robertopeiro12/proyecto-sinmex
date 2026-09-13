import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { ClientesRepository } from './clientes.repository';
import { ClientesService, type ContextoProspecto } from './clientes.service';
import type { ProspectoNormalizado } from './datos-prospecto';
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
  const servicio = new ClientesService(repo as unknown as ClientesRepository);
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
        nombre: 'Tacos Aaron',
        telefono: '6641112233',
        encargado: 'Don Aaron',
        tipoNegocioId: TIPO_NEGOCIO,
        comentarios: 'Quiere probar jamaica',
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

    it('el motivo le dice al vendedor que sincronice, porque se recupera solo', async () => {
      const { servicio } = montar({ tipoNegocioVigente: false });

      await expect(
        servicio.crearProspecto(prospecto(), contexto(), trx),
      ).rejects.toThrow(/[Ss]incroniza/);
    });
  });
});
