import { ConflictException } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { AsignarFacturaDto } from './dto/facturas.dto';
import { MOTIVO_CARRERA, MOTIVO_INTERBLOQUEO } from './facturas';
import type { FacturasRepository } from './facturas.repository';
import { FacturasService } from './facturas.service';
import type { VentasPortalRepository } from './ventas-portal.repository';

const trx = {} as Transaction<DB>;
const ID_VENTA = '11111111-1111-4111-8111-111111111111';
const ID_CLIENTE = '22222222-2222-4222-8222-222222222222';

const dto: AsignarFacturaDto = {
  clienteId: ID_CLIENTE,
  numero: 'A780',
  ventaIds: [ID_VENTA],
};

function servicio(
  errorAlAsignar: unknown,
  facturaDeLaVenta: string | null = null,
) {
  const repo = {
    bloquearVentas: jest.fn().mockResolvedValue([
      {
        id: ID_VENTA,
        folio: 'F1',
        clienteId: ID_CLIENTE,
        status: 'pendiente',
        facturaId: facturaDeLaVenta,
        facturaNumero: null,
      },
    ]),
    bloquearFacturaPorNumero: jest.fn().mockResolvedValue({
      id: 'f1',
      numero: 'A780',
      clienteId: ID_CLIENTE,
      cliente: 'X',
    }),
    asignarVentas: jest.fn().mockRejectedValue(errorAlAsignar),
    bloquearFactura: jest.fn().mockResolvedValue({
      id: 'f1',
      numero: 'A780',
      clienteId: ID_CLIENTE,
      sucursalCodigo: 'TJ',
    }),
    facturaPorNumero: jest.fn().mockResolvedValue(null),
    renombrar: jest.fn().mockRejectedValue(errorAlAsignar),
    quitarVentas: jest.fn().mockRejectedValue(errorAlAsignar),
  } as unknown as FacturasRepository;
  const portal = {
    clienteDeVenta: jest.fn().mockResolvedValue({
      id: ID_CLIENTE,
      sucursalId: 's',
      sucursalCodigo: 'TJ',
    }),
    buscarSucursalUsuario: jest.fn().mockResolvedValue({ codigo: null }),
    enTransaccion: jest.fn((tarea: (t: Transaction<DB>) => Promise<unknown>) =>
      tarea(trx),
    ),
  } as unknown as VentasPortalRepository;
  return new FacturasService(repo, portal);
}

describe('FacturasService.asignar: la factura desaparece a media asignacion', () => {
  it('un 23503 de fk_venta_nota_factura es 409 de carrera, no 500', async () => {
    const error = Object.assign(new Error('fk'), {
      code: '23503',
      constraint: 'fk_venta_nota_factura',
    });
    const caso = servicio(error).asignar('u1', dto);
    await expect(caso).rejects.toBeInstanceOf(ConflictException);
    await expect(caso).rejects.toMatchObject({ message: MOTIVO_CARRERA });
  });

  it('un 23503 de otra restriccion se propaga tal cual', async () => {
    const error = Object.assign(new Error('otra'), {
      code: '23503',
      constraint: 'otra_fk',
    });
    await expect(servicio(error).asignar('u1', dto)).rejects.toBe(error);
  });
});

describe('FacturasService: solo uq_factura_numero es choque de numero', () => {
  it('un 23505 de otra restriccion se propaga tal cual (asignar)', async () => {
    const error = Object.assign(new Error('otra'), {
      code: '23505',
      constraint: 'otra',
    });
    await expect(servicio(error).asignar('u1', dto)).rejects.toBe(error);
  });

  it('un 23505 de uq_factura_numero es 409 de carrera', async () => {
    const error = Object.assign(new Error('uq'), {
      code: '23505',
      constraint: 'uq_factura_numero',
    });
    const caso = servicio(error).asignar('u1', dto);
    await expect(caso).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('FacturasService: interbloqueo y fallo de serializacion son 409', () => {
  const interbloqueo = Object.assign(new Error('deadlock'), { code: '40P01' });
  const serializacion = Object.assign(new Error('ser'), { code: '40001' });

  it('asignar', async () => {
    const caso = servicio(interbloqueo).asignar('u1', dto);
    await expect(caso).rejects.toBeInstanceOf(ConflictException);
    await expect(caso).rejects.toMatchObject({ message: MOTIVO_INTERBLOQUEO });
  });

  it('renombrar', async () => {
    const caso = servicio(serializacion).renombrar('u1', 'f1', 'B1');
    await expect(caso).rejects.toBeInstanceOf(ConflictException);
    await expect(caso).rejects.toMatchObject({ message: MOTIVO_INTERBLOQUEO });
  });

  it('quitar', async () => {
    const caso = servicio(interbloqueo, 'f1').quitar('u1', 'f1', [ID_VENTA]);
    await expect(caso).rejects.toBeInstanceOf(ConflictException);
    await expect(caso).rejects.toMatchObject({ message: MOTIVO_INTERBLOQUEO });
  });
});

describe('FacturasService: la sucursal del usuario se lee fuera de la transaccion', () => {
  it('una sola vez y antes de abrirla', async () => {
    const orden: string[] = [];
    const repo = {
      bloquearVentas: jest.fn().mockResolvedValue([]),
    } as unknown as FacturasRepository;
    const portal = {
      clienteDeVenta: jest.fn().mockResolvedValue({
        id: ID_CLIENTE,
        sucursalId: 's',
        sucursalCodigo: 'TJ',
      }),
      buscarSucursalUsuario: jest.fn(() => {
        orden.push('usuario');
        return Promise.resolve({ codigo: null });
      }),
      enTransaccion: jest.fn((t: (x: Transaction<DB>) => Promise<unknown>) => {
        orden.push('trx');
        return t(trx);
      }),
    } as unknown as VentasPortalRepository;
    await new FacturasService(repo, portal)
      .asignar('u1', dto)
      .catch(() => undefined);
    expect(orden).toEqual(['usuario', 'trx']);
  });
});
