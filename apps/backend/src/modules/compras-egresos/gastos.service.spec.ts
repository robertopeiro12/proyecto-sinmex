import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { GastoNormalizado } from './datos-gasto';
import { GastoRechazado } from './gasto-rechazado';
import { GastosService, type ContextoGasto } from './gastos.service';

const trx = {} as Transaction<DB>;

const contexto: ContextoGasto = {
  id: 'c0ffee00-0000-4000-8000-000000000030',
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  fechaOperacion: '2026-10-20',
};

const gasto: GastoNormalizado = {
  campoEgresoId: 'campo-hielo',
  montoCentavos: 8050,
  registradoEn: '2026-10-21T01:30:00.000Z',
  comentario: 'Dos bolsas',
};

function montar(
  opciones: {
    campo?: { nombre: string; tipo: 'operacion' } | undefined;
    idInsertado?: string | null;
  } = {},
) {
  const repo = {
    campoParaGasto: jest
      .fn()
      .mockResolvedValue(
        'campo' in opciones
          ? opciones.campo
          : { nombre: 'Hielo', tipo: 'operacion' },
      ),
    nombreVendedor: jest.fn().mockResolvedValue('Juan Pérez'),
    insertar: jest
      .fn()
      .mockResolvedValue(
        'idInsertado' in opciones ? opciones.idInsertado : contexto.id,
      ),
  };
  return { servicio: new GastosService(repo as never), repo };
}

describe('GastosService.registrarGasto (T-30/T-31, D4/D5)', () => {
  it('inserta con el id de la clave, el dia del sobre, la copia del campo y el metodo fijo', async () => {
    const { servicio, repo } = montar();
    await expect(
      servicio.registrarGasto(gasto, contexto, trx),
    ).resolves.toEqual({
      tabla: 'gasto',
      id: contexto.id,
    });
    expect(repo.campoParaGasto).toHaveBeenCalledWith('campo-hielo', trx);
    expect(repo.nombreVendedor).toHaveBeenCalledWith('vendedor-1', trx);
    expect(repo.insertar).toHaveBeenCalledWith(
      {
        id: contexto.id,
        sucursalId: 'sucursal-tj',
        vendedorId: 'vendedor-1',
        campoEgresoId: 'campo-hielo',
        campoNombre: 'Hielo',
        tipo: 'operacion',
        // El dia del sobre tal cual, aunque en UTC `registradoEn` ya sea el 21.
        fecha: '2026-10-20',
        registradoEn: '2026-10-21T01:30:00.000Z',
        montoCentavos: 8050,
        metodo: 'efectivo_cobranza_dia',
        origen: 'app',
        quien: 'Juan Pérez',
        comentario: 'Dos bolsas',
      },
      trx,
    );
  });

  it('un campo que no existe es campo-egreso-inexistente y no inserta', async () => {
    const { servicio, repo } = montar({ campo: undefined });
    const error = await servicio
      .registrarGasto(gasto, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GastoRechazado);
    expect((error as GastoRechazado).razon).toBe('campo-egreso-inexistente');
    expect(repo.insertar).not.toHaveBeenCalled();
  });

  it('un id ocupado es gasto-id-ocupado con un motivo neutro', async () => {
    const { servicio } = montar({ idInsertado: null });
    const error = await servicio
      .registrarGasto(gasto, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GastoRechazado);
    expect((error as GastoRechazado).razon).toBe('gasto-id-ocupado');
    expect((error as Error).message).toBe(
      'El id de este gasto ya está ocupado. Avisa a la oficina.',
    );
  });
});
