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
  const servicio = new FotoService(
    repo as never,
    fotos as never,
    visitas as never,
    gastos as never,
  );
  return { servicio, repo, fotos, visitas, gastos };
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

  it('una venta (o cualquier tipo sin foto) es 409', async () => {
    const { servicio } = montar([
      operacion({ tipo: 'venta', entidadTabla: 'venta_nota' }),
    ]);
    await expect(servicio.subir(VENDEDOR, CLAVE, JPEG)).rejects.toBeInstanceOf(
      ConflictException,
    );
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
