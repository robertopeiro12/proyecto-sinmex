import { ConflictException } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { AsignarFacturaDto } from './dto/facturas.dto';
import { MOTIVO_CARRERA } from './facturas';
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

function servicio(errorAlAsignar: unknown) {
  const repo = {
    bloquearVentas: jest.fn().mockResolvedValue([
      {
        id: ID_VENTA,
        folio: 'F1',
        clienteId: ID_CLIENTE,
        status: 'pendiente',
        facturaId: null,
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
