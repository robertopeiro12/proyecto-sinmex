import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FotoService } from './foto.service';
import type { OperacionParaFoto } from './foto.repository';

const VENDEDOR = 'vendedor-1';
const CLAVE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
const SUBIDA = new Date('2026-10-17T19:00:00.000Z');

const operacion = (
  extra: Partial<OperacionParaFoto> = {},
): OperacionParaFoto => ({
  id: 'op-1',
  vendedorId: VENDEDOR,
  tipo: 'visita',
  entidadTabla: 'visita',
  entidadId: CLAVE,
  ...extra,
});

function montar(operaciones: OperacionParaFoto[] = [operacion()]) {
  const repo = {
    porClave: jest.fn().mockResolvedValue(operaciones),
    sucursalDeVendedor: jest.fn().mockResolvedValue('sucursal-tj'),
  };
  const fotos = {
    guardar: jest
      .fn()
      .mockResolvedValue({ archivo: `cliente-${CLAVE}.jpg`, subidaEn: SUBIDA }),
    validarFoto: jest.fn(),
    escribirArchivo: jest.fn().mockResolvedValue(undefined),
    rutaParaVendedor: jest.fn().mockResolvedValue('/fotos/cliente-x.jpg'),
  };
  const visitas = {
    existe: jest.fn().mockResolvedValue(true),
    anotarFoto: jest.fn().mockResolvedValue(true),
  };
  const gastos = {
    existe: jest.fn().mockResolvedValue(true),
    anotarFoto: jest.fn().mockResolvedValue(true),
  };
  const firmas = {
    estadoFirma: jest.fn().mockResolvedValue('espera'),
    anotarFirma: jest.fn().mockResolvedValue(true),
  };
  const servicio = new FotoService(
    repo as never,
    fotos as never,
    visitas as never,
    gastos as never,
    firmas as never,
  );
  return { servicio, repo, fotos, visitas, gastos, firmas };
}

describe('FotoService.subir (T-39, D9)', () => {
  it('una clave que nadie tiene es 404', async () => {
    const { servicio } = montar([]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('una clave de otro vendedor es 403', async () => {
    const { servicio } = montar([operacion({ vendedorId: 'otro' })]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('una cobranza (o cualquier tipo sin foto ni firma) es 409', async () => {
    const { servicio, fotos } = montar([
      operacion({ tipo: 'cobranza', entidadTabla: 'cobro' }),
    ]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('un prospecto se guarda en su cliente', async () => {
    const { servicio, fotos } = montar([
      operacion({ tipo: 'prospecto', entidadTabla: 'cliente' }),
    ]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).resolves.toEqual({
      clave: CLAVE,
      subida_en: SUBIDA.toISOString(),
    });
    expect(fotos.guardar).toHaveBeenCalledWith(CLAVE, JPEG);
  });

  it('un prospecto sin proyectar es 409', async () => {
    const { servicio } = montar([
      operacion({ tipo: 'prospecto', entidadTabla: null, entidadId: null }),
    ]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('una visita valida, escribe visita-<id>.jpg y anota la fila', async () => {
    const { servicio, fotos, visitas } = montar();
    const r = await servicio.subir(VENDEDOR, CLAVE, JPEG);
    expect(fotos.validarFoto).toHaveBeenCalledWith(JPEG);
    expect(fotos.escribirArchivo).toHaveBeenCalledWith(
      `visita-${CLAVE}.jpg`,
      JPEG,
    );
    expect(visitas.anotarFoto).toHaveBeenCalledWith(
      CLAVE,
      `visita-${CLAVE}.jpg`,
      expect.any(Date),
    );
    expect(r.clave).toBe(CLAVE);
  });

  it('una visita sin proyectar es 409 y no escribe nada', async () => {
    const { servicio, fotos } = montar([
      operacion({ entidadTabla: null, entidadId: null }),
    ]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('una visita que ya no existe es 404 y no escribe nada', async () => {
    const { servicio, fotos, visitas } = montar();
    visitas.existe.mockResolvedValue(false);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('una foto que no pasa la validacion no toca la visita', async () => {
    const { servicio, fotos, visitas } = montar();
    fotos.validarFoto.mockImplementation(() => {
      throw new Error('415');
    });
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toThrow('415');
    expect(visitas.existe).not.toHaveBeenCalled();
    expect(visitas.anotarFoto).not.toHaveBeenCalled();
  });
});

describe('FotoService.subir con gastos (T-30/T-31, D8)', () => {
  const deGasto = (extra: Partial<OperacionParaFoto> = {}) =>
    operacion({ tipo: 'gasto', entidadTabla: 'gasto', ...extra });

  it('un gasto valida, escribe gasto-<id>.jpg y anota la fila', async () => {
    const { servicio, fotos, gastos, visitas } = montar([deGasto()]);
    const r = await servicio.subir(VENDEDOR, CLAVE, JPEG);
    expect(fotos.validarFoto).toHaveBeenCalledWith(JPEG);
    expect(fotos.escribirArchivo).toHaveBeenCalledWith(
      `gasto-${CLAVE}.jpg`,
      JPEG,
    );
    expect(gastos.anotarFoto).toHaveBeenCalledWith(
      CLAVE,
      `gasto-${CLAVE}.jpg`,
      expect.any(Date),
    );
    expect(visitas.anotarFoto).not.toHaveBeenCalled();
    expect(r.clave).toBe(CLAVE);
  });

  it('un gasto sin proyectar es 409 y no escribe nada', async () => {
    const { servicio, fotos } = montar([
      deGasto({ entidadTabla: null, entidadId: null }),
    ]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('un gasto que ya no existe es 404 y no escribe nada', async () => {
    const { servicio, fotos, gastos } = montar([deGasto()]);
    gastos.existe.mockResolvedValue(false);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('si la fila desaparece entre escribir y anotar, 404', async () => {
    const { servicio, gastos } = montar([deGasto()]);
    gastos.anotarFoto.mockResolvedValue(false);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('una foto que no pasa la validacion no toca el gasto', async () => {
    const { servicio, fotos, gastos } = montar([deGasto()]);
    fotos.validarFoto.mockImplementation(() => {
      throw new Error('415');
    });
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toThrow('415');
    expect(gastos.existe).not.toHaveBeenCalled();
    expect(gastos.anotarFoto).not.toHaveBeenCalled();
  });
});

describe('FotoService.subir con la firma de una venta (T-73)', () => {
  // El id de la nota NO es la clave: la venta_nota la crea el servidor.
  const VENTA_ID = 'a1b2c3d4-0000-4000-8000-000000000073';
  const ARCHIVO = `venta-${VENTA_ID}-firma.jpg`;
  const deVenta = (extra: Partial<OperacionParaFoto> = {}) =>
    operacion({
      tipo: 'venta',
      entidadTabla: 'venta_nota',
      entidadId: VENTA_ID,
      ...extra,
    });

  it('una venta que espera firma valida, escribe venta-<id de la nota>-firma.jpg y anota', async () => {
    const { servicio, fotos, firmas, gastos } = montar([deVenta()]);
    const r = await servicio.subir(VENDEDOR, CLAVE, JPEG);
    expect(fotos.validarFoto).toHaveBeenCalledWith(JPEG);
    expect(firmas.estadoFirma).toHaveBeenCalledWith(VENTA_ID);
    expect(fotos.escribirArchivo).toHaveBeenCalledWith(ARCHIVO, JPEG);
    expect(firmas.anotarFirma).toHaveBeenCalledWith(
      VENTA_ID,
      ARCHIVO,
      expect.any(Date),
    );
    expect(gastos.anotarFoto).not.toHaveBeenCalled();
    expect(r.clave).toBe(CLAVE);
  });

  it('reenviar escribe el mismo nombre: un solo archivo', async () => {
    const { servicio, fotos } = montar([deVenta()]);
    await servicio.subir(VENDEDOR, CLAVE, JPEG);
    await servicio.subir(VENDEDOR, CLAVE, JPEG);
    expect(fotos.escribirArchivo).toHaveBeenNthCalledWith(1, ARCHIVO, JPEG);
    expect(fotos.escribirArchivo).toHaveBeenNthCalledWith(2, ARCHIVO, JPEG);
  });

  it('una venta sin proyectar es 409, no escribe ni pregunta por la nota (Review Focus 4)', async () => {
    for (const extra of [
      { entidadTabla: null, entidadId: null },
      { entidadTabla: 'venta_nota', entidadId: null },
    ]) {
      const { servicio, fotos, firmas } = montar([deVenta(extra)]);
      await expect(
        servicio.subir(VENDEDOR, CLAVE, JPEG),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(fotos.escribirArchivo).not.toHaveBeenCalled();
      expect(firmas.estadoFirma).not.toHaveBeenCalled();
    }
  });

  it('una venta eliminada o inexistente es 404 y no escribe nada (Review Focus 5)', async () => {
    const { servicio, fotos, firmas } = montar([deVenta()]);
    firmas.estadoFirma.mockResolvedValue('inexistente');
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('una venta que no espera firma es 409 "Esa venta no espera firma." y no escribe nada', async () => {
    const { servicio, fotos, firmas } = montar([deVenta()]);
    firmas.estadoFirma.mockResolvedValue('no-espera');
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toThrow(
      'Esa venta no espera firma.',
    );
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });

  it('si la nota se elimina entre escribir y anotar, 404', async () => {
    const { servicio, firmas } = montar([deVenta()]);
    firmas.anotarFirma.mockResolvedValue(false);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('una imagen que no pasa la validacion no toca la venta', async () => {
    const { servicio, fotos, firmas } = montar([deVenta()]);
    fotos.validarFoto.mockImplementation(() => {
      throw new Error('415');
    });
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toThrow('415');
    expect(firmas.estadoFirma).not.toHaveBeenCalled();
    expect(firmas.anotarFirma).not.toHaveBeenCalled();
  });

  it('la firma de la venta de otro vendedor es 403 y no escribe nada', async () => {
    const { servicio, fotos } = montar([deVenta({ vendedorId: 'otro' })]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(fotos.escribirArchivo).not.toHaveBeenCalled();
  });
});

describe('FotoService.rutaDeCliente (T-39, D9)', () => {
  it('resuelve con la sucursal del vendedor del token', async () => {
    const { servicio, fotos } = montar();
    await expect(servicio.rutaDeCliente(VENDEDOR, CLAVE)).resolves.toBe(
      '/fotos/cliente-x.jpg',
    );
    expect(fotos.rutaParaVendedor).toHaveBeenCalledWith('sucursal-tj', CLAVE);
  });

  it('un vendedor que ya no existe es 404', async () => {
    const { servicio, repo } = montar();
    repo.sucursalDeVendedor.mockResolvedValue(null);
    await expect(
      servicio.rutaDeCliente(VENDEDOR, CLAVE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
