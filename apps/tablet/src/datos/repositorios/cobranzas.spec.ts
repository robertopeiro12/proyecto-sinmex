import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import {
  crearRepositorioCobranzas,
  ErrorCobranza,
  type DatosRegistroCobranza,
} from './cobranzas';
import type { DepsRepositorio } from './deps';
import { crearRepositorioFolios } from './folios';
import { crearRepositorioVentas } from './ventas';

/**
 * Cobranza en la tablet (T-20).
 *
 * Catalogo de prueba: cli-1 con nota-1 (2026-08-01, saldo 15000, un abono
 * previo) y nota-2 (2026-08-02, saldo 10000). Hoy es 2026-08-07.
 */

function montar(opciones: { sinSegmento?: boolean } = {}) {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  const snapshot = snapshotDePrueba();
  if (opciones.sinSegmento) {
    snapshot.vendedores = (snapshot.vendedores ?? []).map((v) => ({
      ...v,
      folio_segmento: null,
    }));
  }
  catalogos.guardarSnapshot(snapshot);
  const folios = crearRepositorioFolios(deps);
  return {
    deps,
    catalogos,
    folios,
    cobranzas: crearRepositorioCobranzas(deps, { catalogos }),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
  };
}

const cobro = (extra: Partial<DatosRegistroCobranza> = {}): DatosRegistroCobranza => ({
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  ventaNotaId: 'nota-1',
  montoCentavos: 5000,
  metodoPago: 'efectivo',
  fechaPago: '2026-08-07',
  ...extra,
});

const cuantas = (deps: DepsRepositorio, tabla: 'cobranza' | 'folio_emitido') =>
  deps.bd.getFirstSync<{ n: number }>(`select count(*) as n from ${tabla}`)?.n;

const nota = (deps: DepsRepositorio, id: string) =>
  deps.bd.getFirstSync<{ saldo_centavos: number; status: string; activo: number; abonos_json: string }>(
    'select saldo_centavos, status, activo, abonos_json from nota_pendiente where id = $id',
    { $id: id },
  );

describe('repositorio de cobranzas (T-20; sin folio desde T-21)', () => {
  it('graba el cobro SIN folio y lo deja pendiente de subir (T-21)', () => {
    const { deps, cobranzas } = montar();
    const c = cobranzas.registrar(cobro({ metodoPago: 'transferencia', fechaPago: '2026-08-05' }));

    expect(c).toEqual({
      id: 'id-1',
      fecha: '2026-08-07',
      cliente_id: 'cli-1',
      vendedor_id: 'ven-1',
      sucursal_id: 'suc-tj',
      venta_nota_id: 'nota-1',
      monto_centavos: 5000,
      metodo_pago: 'transferencia',
      fecha_pago: '2026-08-05',
      grabada_en: '2026-08-07T15:00:00.000Z',
      sync_estado: 'pendiente',
      sync_error: null,
      sincronizado_en: null,
    });
    expect(cuantas(deps, 'folio_emitido')).toBe(0);
  });

  it('un abono parcial descuenta el saldo local y agrega el abono a la nota', () => {
    const { deps, cobranzas } = montar();
    cobranzas.registrar(cobro());

    const n = nota(deps, 'nota-1');
    expect(n).toMatchObject({ saldo_centavos: 10000, status: 'abonado', activo: 1 });
    expect(JSON.parse(n!.abonos_json)).toEqual([
      { fecha_pago: '2026-08-03', monto_centavos: 10000, metodo_pago: 'efectivo' },
      { fecha_pago: '2026-08-07', monto_centavos: 5000, metodo_pago: 'efectivo' },
    ]);
  });

  it('liquidar saca la nota de las pendientes (activo 0)', () => {
    const { deps, catalogos, cobranzas } = montar();
    cobranzas.registrar(cobro({ montoCentavos: 15000 }));

    expect(nota(deps, 'nota-1')).toMatchObject({ saldo_centavos: 0, activo: 0 });
    expect(catalogos.notasPendientesDe('cli-1').map((x) => x.id)).toEqual(['nota-2']);
  });

  it('el excedente va a la otra nota y lo que sobra al saldo a favor del cliente', () => {
    const { deps, catalogos, cobranzas } = montar();
    cobranzas.registrar(cobro({ montoCentavos: 30000 }));

    expect(nota(deps, 'nota-1')).toMatchObject({ saldo_centavos: 0, activo: 0 });
    expect(nota(deps, 'nota-2')).toMatchObject({ saldo_centavos: 0, activo: 0 });
    expect(catalogos.obtenerCliente('cli-1')?.saldo_favor_centavos).toBe(5000);
  });

  it('previsualizar da el reparto de registrar sin escribir nada', () => {
    const { deps, cobranzas } = montar();
    expect(cobranzas.previsualizar('cli-1', 'nota-2', 12000)).toEqual({
      aplicaciones: [
        { notaId: 'nota-2', montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'nota-1', montoCentavos: 2000, saldoAntesCentavos: 15000, saldoDespuesCentavos: 13000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    });
    expect(cuantas(deps, 'cobranza')).toBe(0);
    expect(nota(deps, 'nota-2')?.saldo_centavos).toBe(10000);
  });

  it('un vendedor sin segmento de folio tambien puede cobrar: la cobranza no lleva folio', () => {
    const { deps, cobranzas } = montar({ sinSegmento: true });
    expect(() => cobranzas.registrar(cobro())).not.toThrow();
    expect(cuantas(deps, 'cobranza')).toBe(1);
  });

  it('cobrar no consume numero de la serie: la venta despues de un cobro sigue el consecutivo de ventas', () => {
    const { folios, ventas, cobranzas } = montar();
    cobranzas.registrar(cobro());
    expect(folios.consecutivoDe('ven-1')).toBe(0);
    const v = ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '2346',
      contadoCredito: 'credito',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
    });
    expect(v.folio).toBe('TJ260807AP01');
  });

  it('un fallo a media grabacion no deja ni cobro ni saldo descontado (D15)', () => {
    const { deps, cobranzas } = montar();
    // Se rompe a proposito la siguiente escritura de la transaccion (el
    // reparto local), cuando la cabecera del cobro ya se inserto. Un trigger
    // que aborta el UPDATE logra el fallo tardio sin tocar la lectura previa
    // de `nota_pendiente`.
    deps.bd.execSync(`
      create trigger t20_bloquea_reparto
      before update on nota_pendiente
      begin
        select raise(abort, 'fallo forzado de prueba');
      end;
    `);
    expect(() => cobranzas.registrar(cobro())).toThrow();
    expect(cuantas(deps, 'cobranza')).toBe(0);
    expect(nota(deps, 'nota-1')?.saldo_centavos).toBe(15000);
  });

  it('un monto de $0 se rechaza y no graba nada', () => {
    const { deps, cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ montoCentavos: 0 }))).toThrow(ErrorCobranza);
    expect(cuantas(deps, 'cobranza')).toBe(0);
  });

  it('un vendedor que no esta en la tablet se rechaza', () => {
    const { cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ vendedorId: 'ven-x' }))).toThrow(
      'Este vendedor no está en la tablet. Sincroniza antes de cobrar.',
    );
  });

  it('una fecha de pago anterior a la nota se rechaza', () => {
    const { cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ fechaPago: '2026-07-31' }))).toThrow(
      'La fecha de pago no puede ser anterior a la fecha de la nota.',
    );
  });

  it('una nota que no es del cliente o ya no esta pendiente se rechaza', () => {
    const { cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ ventaNotaId: 'nota-x' }))).toThrow(ErrorCobranza);
    expect(() => cobranzas.registrar(cobro({ clienteId: 'cli-2' }))).toThrow(ErrorCobranza);
  });

  it('un cliente fuera del catalogo se rechaza', () => {
    const { cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ clienteId: 'cli-x' }))).toThrow(ErrorCobranza);
  });

  it('avisa a las pantallas que el catalogo cambio', () => {
    const { catalogos, cobranzas } = montar();
    const antes = catalogos.version();
    cobranzas.registrar(cobro());
    expect(catalogos.version()).toBe(antes + 1);
  });

  it('delDia devuelve los cobros del cliente de hoy, en el orden en que se grabaron', () => {
    const { cobranzas } = montar();
    const a = cobranzas.registrar(cobro());
    const b = cobranzas.registrar(cobro({ ventaNotaId: 'nota-2', montoCentavos: 1000 }));
    expect(cobranzas.delDia('cli-1').map((c) => c.id)).toEqual([a.id, b.id]);
    expect(cobranzas.delDia('cli-1', '2026-08-06')).toEqual([]);
  });

  it('un cobro rechazado sigue en la cola con su motivo; uno aceptado sale', () => {
    const { cobranzas } = montar();
    const c = cobranzas.registrar(cobro());

    cobranzas.marcarError(c.id, 'nota-no-encontrada: la nota no existe');
    expect(cobranzas.pendientesDeSincronizar()).toHaveLength(1);
    expect(cobranzas.porId(c.id)).toMatchObject({
      sync_estado: 'error',
      sync_error: 'nota-no-encontrada: la nota no existe',
    });

    cobranzas.marcarSincronizada(c.id);
    expect(cobranzas.pendientesDeSincronizar()).toEqual([]);
    expect(cobranzas.porId(c.id)).toMatchObject({
      sync_estado: 'sincronizado',
      sync_error: null,
      sincronizado_en: '2026-08-07T15:00:00.000Z',
    });
  });

  it('si un oyente del refresco truena, el cobro ya grabado no se reporta como fallido', () => {
    const { catalogos, cobranzas, deps } = montar();
    catalogos.suscribir(() => {
      throw new Error('una pantalla abierta truena al refrescar');
    });

    const grabada = cobranzas.registrar(cobro());

    // El cobro esta firme: propagar el error haria que la pantalla dijera "no
    // se guardo nada" e invitara a cobrar dos veces.
    expect(grabada.id).toBe('id-1');
    expect(cuantas(deps, 'cobranza')).toBe(1);
    expect(nota(deps, 'nota-1')?.saldo_centavos).toBe(10000);
  });
});
