import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FirmasVentaService } from './firmas-venta.service';

const VENTA = 'a1b2c3d4-0000-4000-8000-000000000073';
const ARCHIVO = `venta-${VENTA}-firma.jpg`;

function montar(
  opciones: {
    cabecera?: { sucursalCodigo: string } | undefined;
    codigoUsuario?: string | null;
    archivo?: string | null;
  } = {},
) {
  const repo = {
    estadoFirma: jest.fn().mockResolvedValue('espera'),
    anotarFirma: jest.fn().mockResolvedValue(true),
    archivoFirma: jest
      .fn()
      .mockResolvedValue('archivo' in opciones ? opciones.archivo : ARCHIVO),
  };
  const consulta = {
    cabecera: jest
      .fn()
      .mockResolvedValue(
        'cabecera' in opciones ? opciones.cabecera : { sucursalCodigo: 'TJ' },
      ),
  };
  const portal = {
    buscarSucursalUsuario: jest.fn().mockResolvedValue({
      codigo: 'codigoUsuario' in opciones ? opciones.codigoUsuario : null,
    }),
  };
  const fotos = {
    rutaDeArchivo: jest.fn().mockResolvedValue(`/fotos/${ARCHIVO}`),
  };
  const servicio = new FirmasVentaService(
    repo as never,
    consulta as never,
    portal as never,
    fotos as never,
  );
  return { servicio, repo, consulta, portal, fotos };
}

describe('FirmasVentaService (T-73)', () => {
  it('estadoFirma y anotarFirma son del repositorio de la venta', async () => {
    const { servicio, repo } = montar();
    const subida = new Date('2026-10-21T19:00:00.000Z');
    await expect(servicio.estadoFirma(VENTA)).resolves.toBe('espera');
    await expect(servicio.anotarFirma(VENTA, ARCHIVO, subida)).resolves.toBe(
      true,
    );
    expect(repo.anotarFirma).toHaveBeenCalledWith(VENTA, ARCHIVO, subida);
  });

  describe('rutaFirma (GET /ventas/:id/firma)', () => {
    it('con archivo devuelve la ruta del disco de fotos', async () => {
      const { servicio, fotos } = montar();
      await expect(servicio.rutaFirma('usuario-1', VENTA)).resolves.toBe(
        `/fotos/${ARCHIVO}`,
      );
      expect(fotos.rutaDeArchivo).toHaveBeenCalledWith(
        ARCHIVO,
        'Esa venta no tiene firma.',
      );
    });

    it('una venta que no existe o esta eliminada es 404', async () => {
      const { servicio, repo } = montar({ cabecera: undefined });
      await expect(
        servicio.rutaFirma('usuario-1', VENTA),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.archivoFirma).not.toHaveBeenCalled();
    });

    it('otra sucursal es 403, el mismo alcance que el detalle', async () => {
      const { servicio, repo } = montar({ codigoUsuario: 'MX' });
      await expect(
        servicio.rutaFirma('usuario-1', VENTA),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.archivoFirma).not.toHaveBeenCalled();
    });

    it('un usuario atado a la sucursal de la venta si la ve', async () => {
      const { servicio } = montar({ codigoUsuario: 'TJ' });
      await expect(servicio.rutaFirma('usuario-1', VENTA)).resolves.toBe(
        `/fotos/${ARCHIVO}`,
      );
    });

    it('sin archivo (pendiente o sin firma) es 404 y no mira el disco', async () => {
      const { servicio, fotos } = montar({ archivo: null });
      await expect(
        servicio.rutaFirma('usuario-1', VENTA),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fotos.rutaDeArchivo).not.toHaveBeenCalled();
    });
  });
});
