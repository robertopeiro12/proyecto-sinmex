import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { PreciosRepository } from '../cartera-clientes/precios.repository';
import type { VentaNormalizada } from './datos-venta';
import { VentaRechazada } from './venta-rechazada';
import { VentasService, type ContextoVenta } from './ventas.service';

const CLIENTE = 'cliente-1';
const PRE_A = 'presentacion-a';
const PRE_B = 'presentacion-b';

/**
 * El servicio no usa la transaccion: solo la pasa a quien escribe. Un objeto
 * vacio basta para comprobar que la pasa siempre la misma, y que nunca abre otra.
 */
const trx = {} as Transaction<DB>;

const contexto = (extra: Partial<ContextoVenta> = {}): ContextoVenta => ({
  sucursalId: 'sucursal-tj',
  fechaOperacion: '2026-09-14',
  vendedorId: 'vendedor-1',
  folio: 'TJ260914AP03',
  usuarioId: null,
  ...extra,
});

const venta = (extra: Partial<VentaNormalizada> = {}): VentaNormalizada => ({
  clienteId: CLIENTE,
  numNota: '2346',
  contadoCredito: 'credito',
  factura: 'N/A',
  comentarios: null,
  lineas: [
    {
      presentacionId: PRE_A,
      cantidad: 24,
      cantidadPromocion: 2,
      precioCentavos: 1350,
    },
  ],
  ...extra,
});

function montar(
  opciones: {
    sinCliente?: boolean;
    pctComision?: string | null;
    precios?: Map<string, number | null>;
  } = {},
) {
  const repo = {
    clienteParaVenta: jest.fn().mockResolvedValue(
      opciones.sinCliente
        ? undefined
        : {
            pctComision:
              'pctComision' in opciones ? opciones.pctComision : '3.50',
          },
    ),
    insertarVenta: jest.fn().mockResolvedValue('venta-1'),
    insertarDetalle: jest.fn().mockResolvedValue(undefined),
  };
  const precios = {
    presentacionesConPrecio: jest.fn().mockResolvedValue(
      opciones.precios ??
        new Map<string, number | null>([
          [PRE_A, 1350],
          [PRE_B, null],
        ]),
    ),
  };
  const servicio = new VentasService(
    repo,
    precios as unknown as PreciosRepository,
  );
  return { servicio, repo, precios };
}

describe('VentasService.registrarVenta', () => {
  it('graba cabecera y detalle con monto, status, semana, mes y el % de comision congelado', async () => {
    const { servicio, repo, precios } = montar();

    await expect(
      servicio.registrarVenta(venta(), contexto(), trx),
    ).resolves.toEqual({ id: 'venta-1' });

    // Los precios se piden a la FECHA DE OPERACION, no a hoy (D6).
    expect(precios.presentacionesConPrecio).toHaveBeenCalledWith(
      CLIENTE,
      '2026-09-14',
      trx,
    );
    expect(repo.insertarVenta).toHaveBeenCalledWith(
      {
        folio: 'TJ260914AP03',
        fecha: '2026-09-14',
        clienteId: CLIENTE,
        vendedorId: 'vendedor-1',
        sucursalId: 'sucursal-tj',
        montoTotal: '324.00',
        numNota: '2346',
        contadoCredito: 'credito',
        factura: 'N/A',
        comentarios: null,
        semana: 38,
        mes: 9,
        status: 'pendiente',
        pctComision: '3.50',
      },
      trx,
    );
    expect(repo.insertarDetalle).toHaveBeenCalledWith(
      'venta-1',
      [
        {
          presentacionId: PRE_A,
          cantidad: 24,
          cantidadPromocion: 2,
          precio: '13.50',
        },
      ],
      trx,
    );
  });

  it('contado nace pagada', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarVenta(
      venta({ contadoCredito: 'contado' }),
      contexto(),
      trx,
    );
    expect(repo.insertarVenta).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pagada', montoTotal: '324.00' }),
      trx,
    );
  });

  it('solo piezas de promocion, sin precio: nace promocion con monto 0 y precio 0 (D13)', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarVenta(
      venta({
        contadoCredito: 'contado',
        lineas: [
          {
            presentacionId: PRE_B,
            cantidad: 0,
            cantidadPromocion: 3,
            precioCentavos: 0,
          },
        ],
      }),
      contexto(),
      trx,
    );
    expect(repo.insertarVenta).toHaveBeenCalledWith(
      expect.objectContaining({ montoTotal: '0.00', status: 'promocion' }),
      trx,
    );
    expect(repo.insertarDetalle).toHaveBeenCalledWith(
      'venta-1',
      [
        {
          presentacionId: PRE_B,
          cantidad: 0,
          cantidadPromocion: 3,
          precio: '0.00',
        },
      ],
      trx,
    );
  });

  it('guarda el precio de la nota firmada aunque el catalogo diga otro (D2)', async () => {
    // El catalogo del servidor dice 1350; la tablet vendio a 1200.
    const { servicio, repo } = montar();
    await servicio.registrarVenta(
      venta({
        lineas: [
          {
            presentacionId: PRE_A,
            cantidad: 24,
            cantidadPromocion: 0,
            precioCentavos: 1200,
          },
        ],
      }),
      contexto(),
      trx,
    );
    expect(repo.insertarVenta).toHaveBeenCalledWith(
      expect.objectContaining({ montoTotal: '288.00' }),
      trx,
    );
    expect(repo.insertarDetalle).toHaveBeenCalledWith(
      'venta-1',
      [
        {
          presentacionId: PRE_A,
          cantidad: 24,
          cantidadPromocion: 0,
          precio: '12.00',
        },
      ],
      trx,
    );
  });

  it('un cliente sin % de comision guarda null, no 0', async () => {
    const { servicio, repo } = montar({ pctComision: null });
    await servicio.registrarVenta(venta(), contexto(), trx);
    expect(repo.insertarVenta).toHaveBeenCalledWith(
      expect.objectContaining({ pctComision: null }),
      trx,
    );
  });

  it('un cliente que no es de la sucursal es cliente-fuera-de-alcance y no escribe nada', async () => {
    const { servicio, repo, precios } = montar({ sinCliente: true });
    await expect(
      servicio.registrarVenta(venta(), contexto(), trx),
    ).rejects.toMatchObject({ razon: 'cliente-fuera-de-alcance' });
    expect(precios.presentacionesConPrecio).not.toHaveBeenCalled();
    expect(repo.insertarVenta).not.toHaveBeenCalled();
  });

  it('una presentacion que no se vende es presentacion-inactiva y no escribe nada', async () => {
    const { servicio, repo } = montar();
    const rechazo = servicio.registrarVenta(
      venta({
        lineas: [
          {
            presentacionId: 'presentacion-borrada',
            cantidad: 1,
            cantidadPromocion: 0,
            precioCentavos: 900,
          },
        ],
      }),
      contexto(),
      trx,
    );
    await expect(rechazo).rejects.toBeInstanceOf(VentaRechazada);
    await expect(rechazo).rejects.toMatchObject({
      razon: 'presentacion-inactiva',
    });
    expect(repo.insertarVenta).not.toHaveBeenCalled();
    expect(repo.insertarDetalle).not.toHaveBeenCalled();
  });

  it('una linea con cantidad y sin precio es precio-no-asignado y no escribe nada', async () => {
    const { servicio, repo } = montar();
    await expect(
      servicio.registrarVenta(
        venta({
          lineas: [
            {
              presentacionId: PRE_B,
              cantidad: 1,
              cantidadPromocion: 0,
              precioCentavos: 500,
            },
          ],
        }),
        contexto(),
        trx,
      ),
    ).rejects.toMatchObject({ razon: 'precio-no-asignado' });
    expect(repo.insertarVenta).not.toHaveBeenCalled();
  });

  it('sin folio es un error de programacion, no un rechazo de negocio (lo decide T-17)', async () => {
    const { servicio, repo } = montar();
    const error: unknown = await servicio
      .registrarVenta(venta(), contexto({ folio: null }), trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(VentaRechazada);
    expect(repo.clienteParaVenta).not.toHaveBeenCalled();
  });
});
