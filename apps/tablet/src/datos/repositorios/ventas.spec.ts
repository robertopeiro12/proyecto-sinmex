import { depsDePrueba, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { relojFijo } from '../reloj';
import { crearRepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';
import { crearRepositorioFolios, ErrorFolio } from './folios';
import { crearRepositorioVentas, ErrorVenta, type DatosRegistroVenta } from './ventas';

/**
 * Ventas en la tablet (T-16).
 *
 * Lo mas valioso que se puede verificar sin una tablet: que el precio lo pone el
 * repositorio y no la pantalla, y que el folio se emite en la MISMA transaccion
 * que la venta — si algo falla, antes o despues de emitir, no se quema un numero.
 */

function montar(opciones: { sinSegmento?: boolean } = {}) {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  const snapshot = snapshotDePrueba();
  if (opciones.sinSegmento) {
    // Un vendedor que nunca sincronizo: el segmento lo asigna el servidor (T-14).
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
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
  };
}

const venta = (extra: Partial<DatosRegistroVenta> = {}): DatosRegistroVenta => ({
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  numNota: '2346',
  contadoCredito: 'credito',
  factura: 'N/A',
  comentarios: null,
  lineas: [{ presentacionId: 'pre-1', cantidad: 24, cantidadPromocion: 2 }],
  ...extra,
});

const cuantas = (deps: DepsRepositorio, tabla: 'venta' | 'folio_emitido') =>
  deps.bd.getFirstSync<{ n: number }>(`select count(*) as n from ${tabla}`)?.n;

describe('repositorio de ventas (T-16)', () => {
  describe('registrar', () => {
    it('graba la venta con el folio del dia y el precio del catalogo local', () => {
      const { folios, ventas } = montar();
      const v = ventas.registrar(venta());

      expect(v).toMatchObject({
        fecha: '2026-08-07',
        cliente_id: 'cli-1',
        vendedor_id: 'ven-1',
        sucursal_id: 'suc-tj',
        folio: 'TJ260807AP01',
        num_nota: '2346',
        contado_credito: 'credito',
        factura: 'N/A',
        comentarios: null,
        // 24 x 28.00 (vigente para cli-1 y pre-1 el 2026-08-07); la promocion no suma.
        monto_total_centavos: 67200,
        grabada_en: MOMENTO,
        sync_estado: 'pendiente',
        sync_error: null,
        sincronizado_en: null,
      });
      expect(ventas.lineasDe(v.id)).toEqual([
        { venta_id: v.id, presentacion_id: 'pre-1', cantidad: 24, cantidad_promocion: 2, precio_centavos: 2800 },
      ]);
      // El folio quedo a nombre de ESTA venta: su id es la clave de la operacion.
      expect(folios.porOperacion(v.id)?.folio).toBe(v.folio);
    });

    it('cada venta consume el siguiente folio del dia', () => {
      const { ventas } = montar();
      expect(ventas.registrar(venta()).folio).toBe('TJ260807AP01');
      expect(ventas.registrar(venta({ numNota: '2347' })).folio).toBe('TJ260807AP02');
    });

    it('regalar piezas de una presentacion sin precio se graba con precio 0 y monto 0 (D13)', () => {
      const { ventas } = montar();
      const v = ventas.registrar(
        venta({ lineas: [{ presentacionId: 'pre-2', cantidad: 0, cantidadPromocion: 3 }] }),
      );
      expect(v.monto_total_centavos).toBe(0);
      expect(ventas.lineasDe(v.id)).toEqual([
        { venta_id: v.id, presentacion_id: 'pre-2', cantidad: 0, cantidad_promocion: 3, precio_centavos: 0 },
      ]);
    });

    it('vender una presentacion sin precio no graba y NO consume folio (D15)', () => {
      const { deps, folios, ventas } = montar();
      expect(() =>
        ventas.registrar(
          venta({ lineas: [{ presentacionId: 'pre-2', cantidad: 1, cantidadPromocion: 0 }] }),
        ),
      ).toThrow(ErrorVenta);
      expect(folios.consecutivoDe('ven-1')).toBe(0);
      expect(cuantas(deps, 'venta')).toBe(0);
    });

    it('sin segmento de folio no graba y NO consume folio', () => {
      const { deps, folios, ventas } = montar({ sinSegmento: true });
      expect(() => ventas.registrar(venta())).toThrow(ErrorFolio);
      expect(folios.consecutivoDe('ven-1')).toBe(0);
      expect(cuantas(deps, 'venta')).toBe(0);
    });

    it('un fallo DESPUES de emitir el folio tambien lo deshace: no se quema un numero (D16)', () => {
      const { deps, folios, ventas } = montar();
      // Se rompe a proposito la ultima escritura de la transaccion: cuando las
      // lineas fallan, el folio ya se emitio y la cabecera ya se inserto.
      deps.bd.execSync('drop table venta_linea;');
      expect(() => ventas.registrar(venta())).toThrow();
      expect(folios.consecutivoDe('ven-1')).toBe(0);
      expect(cuantas(deps, 'folio_emitido')).toBe(0);
      expect(cuantas(deps, 'venta')).toBe(0);
    });

    it('una presentacion que ya no se vende no graba ni consume folio', () => {
      const { folios, ventas } = montar();
      expect(() =>
        ventas.registrar(
          venta({ lineas: [{ presentacionId: 'pre-fantasma', cantidad: 1, cantidadPromocion: 0 }] }),
        ),
      ).toThrow(ErrorVenta);
      expect(folios.consecutivoDe('ven-1')).toBe(0);
    });

    it('un cliente que no esta en el catalogo no graba', () => {
      const { ventas } = montar();
      expect(() => ventas.registrar(venta({ clienteId: 'cli-fantasma' }))).toThrow(ErrorVenta);
    });

    it('sin numero de nota no graba ni consume folio', () => {
      const { folios, ventas } = montar();
      expect(() => ventas.registrar(venta({ numNota: '  ' }))).toThrow(
        'Falta el número de la nota física.',
      );
      expect(folios.consecutivoDe('ven-1')).toBe(0);
    });

    it('la misma presentacion repetida en dos lineas no graba ni consume folio', () => {
      const { deps, folios, ventas } = montar();
      expect(() =>
        ventas.registrar(
          venta({
            lineas: [
              { presentacionId: 'pre-1', cantidad: 5, cantidadPromocion: 0 },
              { presentacionId: 'pre-1', cantidad: 3, cantidadPromocion: 0 },
            ],
          }),
        ),
      ).toThrow(ErrorVenta);
      expect(folios.consecutivoDe('ven-1')).toBe(0);
      expect(cuantas(deps, 'folio_emitido')).toBe(0);
      expect(cuantas(deps, 'venta')).toBe(0);
    });
  });

  describe('consultas y cola de sincronizacion', () => {
    it('delDia lista las ventas de ese cliente en ese dia, en el orden en que se grabaron', () => {
      const { deps, catalogos, ventas } = montar();
      const primera = ventas.registrar(venta());
      const segunda = ventas.registrar(venta({ numNota: '2347' }));

      // La misma base con el reloj de manana: esa venta no es "de hoy".
      const manana: DepsRepositorio = { ...deps, reloj: relojFijo('2026-08-08T15:00:00.000Z') };
      crearRepositorioVentas(manana, {
        catalogos,
        folios: crearRepositorioFolios(manana),
      }).registrar(venta());

      expect(ventas.delDia('cli-1').map((v) => v.id)).toEqual([primera.id, segunda.id]);
      expect(ventas.delDia('cli-1', '2026-08-08')).toHaveLength(1);
      expect(ventas.delDia('cli-2')).toEqual([]);
    });

    it('lo grabado nace pendiente, y una venta con error se vuelve a mandar (D19)', () => {
      const { ventas } = montar();
      const a = ventas.registrar(venta());
      const b = ventas.registrar(venta({ numNota: '2347' }));
      expect(ventas.pendientesDeSincronizar().map((v) => v.id)).toEqual([a.id, b.id]);

      ventas.marcarError(b.id, 'precio-no-asignado: el cliente no tiene precio');
      expect(ventas.pendientesDeSincronizar().map((v) => v.id)).toEqual([a.id, b.id]);
      expect(ventas.porId(b.id)).toMatchObject({
        sync_estado: 'error',
        sync_error: 'precio-no-asignado: el cliente no tiene precio',
      });
    });

    it('marcarSincronizada la saca de la cola, sella el momento y limpia el error previo', () => {
      const { ventas } = montar();
      const v = ventas.registrar(venta());
      ventas.marcarError(v.id, 'sin-red');
      ventas.marcarSincronizada(v.id);

      expect(ventas.pendientesDeSincronizar()).toEqual([]);
      expect(ventas.porId(v.id)).toMatchObject({
        sync_estado: 'sincronizado',
        sincronizado_en: MOMENTO,
        sync_error: null,
      });
    });
  });
});
