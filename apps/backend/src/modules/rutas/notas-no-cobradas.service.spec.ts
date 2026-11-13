import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { NotaNoCobradaNormalizada } from './datos-nota-no-cobrada';
import { NotaNoCobradaRechazada } from './nota-no-cobrada-rechazada';
import {
  NotasNoCobradasService,
  type ContextoNotaNoCobrada,
} from './notas-no-cobradas.service';

const trx = {} as Transaction<DB>;

const ctx: ContextoNotaNoCobrada = {
  id: 'c0ffee00-0000-4000-8000-000000000113',
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  clienteId: 'cliente-1',
  fechaOperacion: '2026-11-13',
};

const nota: NotaNoCobradaNormalizada = {
  ventaNotaId: 'nota-1',
  comentario: 'No estaba el encargado',
  registradoEn: '2026-11-13T18:40:00.000Z',
};

function montar(
  opciones: {
    nota?: { clienteId: string; clienteSucursalId: string } | undefined;
    insertada?: boolean;
  } = {},
) {
  const repo = {
    notaDe: jest
      .fn()
      .mockResolvedValue(
        'nota' in opciones
          ? opciones.nota
          : { clienteId: ctx.clienteId, clienteSucursalId: ctx.sucursalId },
      ),
    insertar: jest.fn().mockResolvedValue(opciones.insertada ?? true),
  };
  return { servicio: new NotasNoCobradasService(repo), repo };
}

describe('NotasNoCobradasService.registrar', () => {
  it('caso feliz: inserta la fila con la clave como id y regresa la entidad', async () => {
    const { servicio, repo } = montar();
    await expect(servicio.registrar(nota, ctx, trx)).resolves.toEqual({
      tabla: 'nota_no_cobrada',
      id: ctx.id,
    });
    expect(repo.insertar).toHaveBeenCalledWith(
      {
        id: ctx.id,
        ventaNotaId: 'nota-1',
        vendedorId: 'vendedor-1',
        sucursalId: 'sucursal-tj',
        fecha: '2026-11-13',
        comentario: 'No estaba el encargado',
        registradoEn: '2026-11-13T18:40:00.000Z',
      },
      trx,
    );
  });

  it.each([
    ['inexistente', undefined],
    [
      'de otro cliente',
      { clienteId: 'otro', clienteSucursalId: ctx.sucursalId },
    ],
    [
      'de otra sucursal',
      { clienteId: ctx.clienteId, clienteSucursalId: 'otra' },
    ],
  ])('una nota %s es nota-no-encontrada y no inserta', async (_, fila) => {
    const { servicio, repo } = montar({ nota: fila });
    await expect(servicio.registrar(nota, ctx, trx)).rejects.toMatchObject({
      razon: 'nota-no-encontrada',
    });
    expect(repo.insertar).not.toHaveBeenCalled();
  });

  it('un id ocupado es nota-no-cobrada-id-ocupado', async () => {
    const { servicio } = montar({ insertada: false });
    const error: unknown = await servicio
      .registrar(nota, ctx, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotaNoCobradaRechazada);
    expect(error).toMatchObject({ razon: 'nota-no-cobrada-id-ocupado' });
  });
});
