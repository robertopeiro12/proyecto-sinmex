import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { GastosService } from './gastos.service';
import type { GastoListado } from './gastos.repository';

const VENDEDOR = '6F9619FF-8B86-4011-B42D-00C04FC964FF';
const CAMPO = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const GASTO = 'b6a1f3c2-0000-4000-8000-000000000030';

const fila = (montoCentavos: number): GastoListado => ({
  id: GASTO,
  fecha: '2026-10-20',
  registradoEn: '2026-10-20T18:00:00.000Z',
  sucursalCodigo: 'TJ',
  vendedorId: VENDEDOR.toLowerCase(),
  vendedorNombre: 'Abraham',
  campoEgresoId: CAMPO,
  campoNombre: 'Hielo',
  tipo: 'operacion',
  montoCentavos,
  comentario: null,
  tieneFoto: false,
});

function montar(
  usuario: { id: string | null; codigo: string | null } | undefined,
) {
  const repo = {
    buscarSucursalUsuario: jest.fn().mockResolvedValue(usuario),
    listar: jest.fn().mockResolvedValue([fila(25_050), fila(8_000)]),
    fotoEnAlcance: jest.fn().mockResolvedValue(`gasto-${GASTO}.jpg`),
  };
  const fotos = {
    rutaDeArchivo: jest.fn().mockResolvedValue(`/fotos/gasto-${GASTO}.jpg`),
  };
  return {
    servicio: new GastosService(repo as never, fotos as never),
    repo,
    fotos,
  };
}

const GENERAL = { id: null, codigo: null };
const TIJUANA = { id: 'suc-tj', codigo: 'TJ' };

describe('GastosService.listar (T-30/T-31, D10)', () => {
  it('un General sin filtros ve todas las sucursales; el total suma los montos', async () => {
    const { servicio, repo } = montar(GENERAL);
    const r = await servicio.listar('u1', {
      desde: '2026-10-01',
      hasta: '2026-10-20',
    });
    expect(repo.listar).toHaveBeenCalledWith({
      desde: '2026-10-01',
      hasta: '2026-10-20',
      codigoSucursal: null,
      vendedorId: null,
      campoEgresoId: null,
    });
    expect(r).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-20',
      gastos: [fila(25_050), fila(8_000)],
      totalCentavos: 33_050,
    });
  });

  it('vendedor y campo viajan en minusculas; la sucursal pedida pasa por el alcance', async () => {
    const { servicio, repo } = montar(GENERAL);
    await servicio.listar('u1', {
      desde: '2026-10-20',
      hasta: '2026-10-20',
      sucursal: 'mx',
      vendedor: VENDEDOR,
      campo: ` ${CAMPO} `,
    });
    expect(repo.listar).toHaveBeenCalledWith(
      expect.objectContaining({
        codigoSucursal: 'MX',
        vendedorId: VENDEDOR.toLowerCase(),
        campoEgresoId: CAMPO,
      }),
    );
  });

  it('un usuario atado a TJ ve solo TJ aunque pida "todas"', async () => {
    const { servicio, repo } = montar(TIJUANA);
    await servicio.listar('u1', {
      desde: '2026-10-20',
      hasta: '2026-10-20',
      sucursal: 'todas',
    });
    expect(repo.listar).toHaveBeenCalledWith(
      expect.objectContaining({ codigoSucursal: 'TJ' }),
    );
  });

  it('un usuario atado a TJ que pide MX es 403', async () => {
    const { servicio, repo } = montar(TIJUANA);
    await expect(
      servicio.listar('u1', {
        desde: '2026-10-20',
        hasta: '2026-10-20',
        sucursal: 'MX',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.listar).not.toHaveBeenCalled();
  });

  it('un rango de mas de un año, al reves o con un dia que no existe es 400 y no consulta', async () => {
    const { servicio, repo } = montar(GENERAL);
    for (const [desde, hasta] of [
      ['2025-01-01', '2026-10-20'],
      ['2026-10-20', '2026-10-01'],
      ['2026-02-30', '2026-03-01'],
    ]) {
      await expect(
        servicio.listar('u1', { desde, hasta }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(repo.listar).not.toHaveBeenCalled();
  });

  it('un vendedor o un campo que no son uuid es 400 con su mensaje', async () => {
    const { servicio } = montar(GENERAL);
    await expect(
      servicio.listar('u1', {
        desde: '2026-10-20',
        hasta: '2026-10-20',
        vendedor: 'oficina',
      }),
    ).rejects.toThrow('El vendedor no es válido.');
    await expect(
      servicio.listar('u1', {
        desde: '2026-10-20',
        hasta: '2026-10-20',
        campo: 'hielo',
      }),
    ).rejects.toThrow('El campo no es válido.');
  });

  it('un usuario que ya no existe es 401', async () => {
    const { servicio } = montar(undefined);
    await expect(
      servicio.listar('u1', { desde: '2026-10-20', hasta: '2026-10-20' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('GastosService.rutaFoto (T-30/T-31, D10)', () => {
  it('busca la foto con el alcance del usuario y resuelve la ruta en disco', async () => {
    const { servicio, repo, fotos } = montar(TIJUANA);
    await expect(servicio.rutaFoto('u1', GASTO)).resolves.toBe(
      `/fotos/gasto-${GASTO}.jpg`,
    );
    expect(repo.fotoEnAlcance).toHaveBeenCalledWith(GASTO, 'TJ');
    expect(fotos.rutaDeArchivo).toHaveBeenCalledWith(
      `gasto-${GASTO}.jpg`,
      'Ese gasto no tiene foto.',
    );
  });

  it('un General busca sin filtro de sucursal', async () => {
    const { servicio, repo } = montar(GENERAL);
    await servicio.rutaFoto('u1', GASTO);
    expect(repo.fotoEnAlcance).toHaveBeenCalledWith(GASTO, null);
  });

  it('sin foto, de otra sucursal o inexistente es 404', async () => {
    const { servicio, repo, fotos } = montar(TIJUANA);
    repo.fotoEnAlcance.mockResolvedValue(null);
    await expect(servicio.rutaFoto('u1', GASTO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fotos.rutaDeArchivo).not.toHaveBeenCalled();
  });
});
