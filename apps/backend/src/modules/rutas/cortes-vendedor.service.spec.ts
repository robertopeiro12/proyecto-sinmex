import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { CorteRechazado } from './corte-rechazado';
import {
  CortesVendedorService,
  type ContextoCorte,
} from './cortes-vendedor.service';
import type { CorteNormalizado } from './datos-corte';

const trx = {} as Transaction<DB>;
const PRE_A = '5d1c9a7e-3b2f-4c8d-9e0a-1b2c3d4e5f01';

const contexto: ContextoCorte = {
  id: 'c0ffee00-0000-4000-8000-000000000060',
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  fechaOperacion: '2026-11-25',
};

const corte: CorteNormalizado = {
  efectivo: { esperadoCentavos: 432500, traidoCentavos: 430000 },
  notas: [{ folio: 'TJ261125AP01', traida: true, saldoCentavos: 30000 }],
  inventario: [{ presentacionId: PRE_A, sistema: 8, contado: 7 }],
  merma: { sistema: 5, contado: 4 },
  enviadoEn: '2026-11-26T01:30:00.000Z',
};

function montar(
  opciones: { idInsertado?: string | null; hayVivo?: boolean } = {},
) {
  const repo = {
    insertar: jest
      .fn()
      .mockResolvedValue(
        'idInsertado' in opciones ? opciones.idInsertado : contexto.id,
      ),
    hayCorteVivo: jest.fn().mockResolvedValue(opciones.hayVivo ?? false),
  };
  return { servicio: new CortesVendedorService(repo), repo };
}

describe('CortesVendedorService.registrarCorte (rediseño pieza 6)', () => {
  it('inserta con el id de la clave, el dia del sobre y lo capturado en el formato del contrato', async () => {
    const { servicio, repo } = montar();
    await expect(
      servicio.registrarCorte(corte, contexto, trx),
    ).resolves.toEqual({
      tabla: 'corte_vendedor',
      id: contexto.id,
    });
    expect(repo.insertar).toHaveBeenCalledWith(
      {
        id: contexto.id,
        vendedorId: 'vendedor-1',
        sucursalId: 'sucursal-tj',
        fecha: '2026-11-25',
        efectivo: { esperado_centavos: 432500, traido_centavos: 430000 },
        notas: [{ folio: 'TJ261125AP01', traida: true, saldo_centavos: 30000 }],
        inventario: {
          renglones: [{ presentacion_id: PRE_A, sistema: 8, contado: 7 }],
          merma: { sistema: 5, contado: 4 },
        },
        enviadoEn: '2026-11-26T01:30:00.000Z',
      },
      trx,
    );
    expect(repo.hayCorteVivo).not.toHaveBeenCalled();
  });

  it('con otro corte vivo ese dia rechaza corte-duplicado', async () => {
    const { servicio, repo } = montar({ idInsertado: null, hayVivo: true });
    const error = await servicio
      .registrarCorte(corte, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CorteRechazado);
    expect(error).toMatchObject({ razon: 'corte-duplicado' });
    expect((error as Error).message).toContain('2026-11-25');
    expect(repo.hayCorteVivo).toHaveBeenCalledWith(
      'vendedor-1',
      '2026-11-25',
      trx,
    );
  });

  it('sin corte vivo ese dia, el id lo ocupa otro registro: id-ocupado con motivo neutro', async () => {
    const { servicio } = montar({ idInsertado: null, hayVivo: false });
    const error = await servicio
      .registrarCorte(corte, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CorteRechazado);
    expect(error).toMatchObject({ razon: 'id-ocupado' });
    expect((error as Error).message).toMatch(/^clave: /);
  });
});
