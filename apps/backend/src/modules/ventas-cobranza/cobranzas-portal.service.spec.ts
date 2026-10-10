import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import type { CobranzasPortalRepository } from './cobranzas-portal.repository';
import {
  CobranzasPortalService,
  MOTIVO_COBRADOR_INVALIDO,
  MOTIVO_FECHA_FUTURA,
  MOTIVO_INTERBLOQUEO_COBRO,
  MOTIVO_UN_FILTRO,
} from './cobranzas-portal.service';
import type { CobranzasService, PlanDeCobro } from './cobranzas.service';
import type { RegistrarCobroDto } from './dto/cobranzas.dto';
import { PagoRechazado } from './pago-rechazado';
import type { VentasPortalRepository } from './ventas-portal.repository';

const trx = {} as Transaction<DB>;
const CLIENTE = {
  id: 'cliente-1',
  nombre: 'Cobach XXI',
  sucursalId: 'suc-tj',
  sucursalCodigo: 'TJ',
};
const PLAN: PlanDeCobro = { aplicaciones: [], saldoFavorCentavos: 0 };

function montar(
  opciones: {
    usuarioCodigo?: string | null;
    esRepartidor?: boolean;
    error?: unknown;
    cliente?: typeof CLIENTE | undefined;
  } = {},
) {
  const cobranzas = {
    planearPago: jest.fn().mockResolvedValue(PLAN),
    registrarPago:
      'error' in opciones
        ? jest.fn().mockRejectedValue(opciones.error)
        : jest.fn().mockResolvedValue(PLAN),
    planearSaldoFavor: jest.fn().mockResolvedValue(PLAN),
    aplicarSaldoFavor: jest.fn().mockResolvedValue(PLAN),
  };
  const repo = {
    clienteParaCobro: jest
      .fn()
      .mockResolvedValue('cliente' in opciones ? opciones.cliente : CLIENTE),
    notasPorCobrar: jest.fn().mockResolvedValue([]),
    saldoFavorCentavos: jest.fn().mockResolvedValue(1250),
  };
  const portal = {
    buscarSucursalUsuario: jest.fn().mockResolvedValue({
      id: null,
      codigo: opciones.usuarioCodigo ?? null,
    }),
    enTransaccion: jest
      .fn()
      .mockImplementation((tarea: (t: Transaction<DB>) => Promise<unknown>) =>
        tarea(trx),
      ),
    esRepartidorActivo: jest
      .fn()
      .mockResolvedValue(opciones.esRepartidor ?? true),
  };
  const servicio = new CobranzasPortalService(
    cobranzas as unknown as CobranzasService,
    repo as unknown as CobranzasPortalRepository,
    portal as unknown as VentasPortalRepository,
  );
  return { servicio, cobranzas, repo, portal };
}

const cuerpo = (extra: Partial<RegistrarCobroDto> = {}): RegistrarCobroDto => ({
  clienteId: 'CLIENTE-1',
  notaIds: ['NOTA-B', 'nota-a', 'nota-b'],
  montoCentavos: 150000,
  fechaPago: '2026-10-01',
  metodoPago: 'transferencia',
  vendedorId: null,
  ...extra,
});

describe('CobranzasPortalService.registrar', () => {
  it('pasa ids en minusculas y sin repetir, Oficina, quien capturo y hoy en Tijuana', async () => {
    const { servicio, cobranzas } = montar();
    await expect(servicio.registrar('usuario-1', cuerpo())).resolves.toEqual({
      cliente: 'Cobach XXI',
      montoCentavos: 150000,
      ...PLAN,
    });
    expect(cobranzas.registrarPago).toHaveBeenCalledWith(
      {
        clienteId: 'cliente-1',
        notaIds: ['nota-b', 'nota-a'],
        montoCentavos: 150000,
        metodoPago: 'transferencia',
        fechaPago: '2026-10-01',
      },
      {
        sucursalId: 'suc-tj',
        fechaOperacion: hoyEnTijuana(),
        vendedorId: null,
        usuarioId: 'usuario-1',
      },
      trx,
    );
  });

  it('con un repartidor activo de la sucursal del cliente, el cobro es suyo', async () => {
    const { servicio, cobranzas, portal } = montar();
    await servicio.registrar('usuario-1', cuerpo({ vendedorId: 'VEN-1' }));
    expect(portal.esRepartidorActivo).toHaveBeenCalledWith(
      'ven-1',
      'suc-tj',
      trx,
    );
    expect(cobranzas.registrarPago).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ vendedorId: 'ven-1' }),
      trx,
    );
  });

  it('un cobrador que no es repartidor activo de esa sucursal es 400 y no se cobra', async () => {
    const { servicio, cobranzas } = montar({ esRepartidor: false });
    const error: unknown = await servicio
      .registrar('usuario-1', cuerpo({ vendedorId: 'ven-x' }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toBe(MOTIVO_COBRADOR_INVALIDO);
    expect(cobranzas.registrarPago).not.toHaveBeenCalled();
  });

  it('Review Focus 2: una fecha futura es 400 antes de abrir la transaccion', async () => {
    const { servicio, portal } = montar();
    await expect(
      servicio.registrar('usuario-1', cuerpo({ fechaPago: '2999-12-31' })),
    ).rejects.toThrow(MOTIVO_FECHA_FUTURA);
    expect(portal.enTransaccion).not.toHaveBeenCalled();
  });

  it('una fecha que no existe es 400', async () => {
    const { servicio } = montar();
    await expect(
      servicio.registrar('usuario-1', cuerpo({ fechaPago: '2026-02-30' })),
    ).rejects.toThrow('Esa fecha no existe.');
  });

  it('un rechazo del dominio por la base sale como 409; uno por la fecha, como 400', async () => {
    const sinSaldo = montar({
      error: new PagoRechazado(
        'nota-sin-saldo',
        'La nota TJ261001AP03 ya no tiene saldo; vuelve a cargar.',
      ),
    });
    const e1: unknown = await sinSaldo.servicio
      .registrar('usuario-1', cuerpo())
      .catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ConflictException);
    expect((e1 as Error).message).toBe(
      'La nota TJ261001AP03 ya no tiene saldo; vuelve a cargar.',
    );

    const fecha = montar({
      error: new PagoRechazado('fecha-anterior', 'La fecha del pago …'),
    });
    await expect(
      fecha.servicio.registrar('usuario-1', cuerpo()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un interbloqueo (40P01) o una serializacion (40001) es 409 con su mensaje, nunca 500', async () => {
    for (const code of ['40P01', '40001']) {
      const { servicio } = montar({
        error: Object.assign(new Error('x'), { code }),
      });
      const error: unknown = await servicio
        .registrar('usuario-1', cuerpo())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toBe(MOTIVO_INTERBLOQUEO_COBRO);
    }
  });

  it('un usuario de MX sobre un cliente de TJ es 403; un cliente que no existe, 404', async () => {
    await expect(
      montar({ usuarioCodigo: 'MX' }).servicio.registrar('usuario-1', cuerpo()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      montar({ cliente: undefined }).servicio.registrar('usuario-1', cuerpo()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CobranzasPortalService.vistaPrevia y aplicarSaldoFavor', () => {
  it('la vista previa elige la regla por modo', async () => {
    const { servicio, cobranzas } = montar();
    const base = { clienteId: 'cliente-1', notaIds: ['a'], montoCentavos: 100 };
    await servicio.vistaPrevia('u', {
      ...base,
      modo: 'pago',
    });
    await servicio.vistaPrevia('u', {
      ...base,
      modo: 'saldo_favor',
    });
    expect(cobranzas.planearPago).toHaveBeenCalledWith(base, trx);
    expect(cobranzas.planearSaldoFavor).toHaveBeenCalledWith(base, trx);
  });

  it('aplicar saldo a favor va sin cobrador, con quien capturo y hoy', async () => {
    const { servicio, cobranzas } = montar();
    await expect(
      servicio.aplicarSaldoFavor('usuario-1', {
        clienteId: 'cliente-1',
        notaIds: ['a', 'a'],
        montoCentavos: 500,
      }),
    ).resolves.toMatchObject({ cliente: 'Cobach XXI', montoCentavos: 500 });
    expect(cobranzas.aplicarSaldoFavor).toHaveBeenCalledWith(
      { clienteId: 'cliente-1', notaIds: ['a'], montoCentavos: 500 },
      {
        sucursalId: 'suc-tj',
        fechaOperacion: hoyEnTijuana(),
        vendedorId: null,
        usuarioId: 'usuario-1',
      },
      trx,
    );
  });
});

describe('CobranzasPortalService.porCobrar', () => {
  it('sin filtro, o con dos, es 400', async () => {
    const { servicio } = montar();
    await expect(servicio.porCobrar('u', {})).rejects.toThrow(MOTIVO_UN_FILTRO);
    await expect(
      servicio.porCobrar('u', {
        fecha: '2026-10-01',
        numNota: '12',
      }),
    ).rejects.toThrow(MOTIVO_UN_FILTRO);
  });

  it('por cliente devuelve el cliente, su saldo a favor y sus notas', async () => {
    const { servicio, repo } = montar();
    await expect(
      servicio.porCobrar('u', { clienteId: 'CLIENTE-1' }),
    ).resolves.toEqual({ ...CLIENTE, saldoFavorCentavos: 1250, notas: [] });
    expect(repo.clienteParaCobro).toHaveBeenCalledWith('cliente-1');
  });

  it('por fecha respeta el alcance del usuario', async () => {
    const tj = montar({ usuarioCodigo: 'TJ' });
    await tj.servicio.porCobrar('u', { fecha: '2026-10-01' });
    expect(tj.repo.notasPorCobrar).toHaveBeenCalledWith({
      clienteId: null,
      fecha: '2026-10-01',
      numNota: null,
      sucursalCodigo: 'TJ',
    });

    const general = montar();
    await general.servicio.porCobrar('u', {
      numNota: 'A-12',
      sucursal: 'MX',
    });
    expect(general.repo.notasPorCobrar).toHaveBeenCalledWith({
      clienteId: null,
      fecha: null,
      numNota: 'A-12',
      sucursalCodigo: 'MX',
    });
  });
});
