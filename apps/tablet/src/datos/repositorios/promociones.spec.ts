import { depsDePrueba, FIRMA_DE_PRUEBA, snapshotDePrueba } from '../pruebas-apoyo';
import type { SnapshotCatalogos } from './catalogos';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioFolios } from './folios';
import { crearRepositorioPromociones } from './promociones';
import { crearRepositorioVentas } from './ventas';

/** Promociones de la tablet (T-74): que aplica hoy a quien, y que catalogo usa su frase. */

function montar(ajustar: (s: SnapshotCatalogos) => void = () => {}) {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  const snapshot = snapshotDePrueba();
  ajustar(snapshot);
  catalogos.guardarSnapshot(snapshot);
  const folios = crearRepositorioFolios(deps);
  return {
    catalogos,
    folios,
    deps,
    promociones: crearRepositorioPromociones(deps, { catalogos }),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
  };
}

const ids = (l: { id: string }[]) => l.map((p) => p.id);

describe('repositorio de promociones (T-74)', () => {
  it('catalogo() trae las presentaciones activas con su producto y etiqueta, en orden', () => {
    const { promociones } = montar();
    const c = promociones.catalogo();
    expect(c.presentaciones.get('pre-1')).toEqual({ productoId: 'pro-1', etiqueta: 'Jamaica 1 L' });
    expect(c.productos.get('pro-1')).toBe('Jamaica');
    // "1 L" antes que "500 ml": el mismo orden que presentacionesParaVenta.
    expect([...c.presentaciones.keys()]).toEqual(['pre-1', 'pre-2']);
  });

  it('a un cliente le aplica la general con su frase y no la de prospecto', () => {
    const { promociones } = montar();
    const a = promociones.aplicablesPara('cli-1');
    expect(ids(a)).toEqual(['promo-general']);
    expect(a[0]?.texto).toBe('Por cada 10 Jamaica, 1 Jamaica gratis');
  });

  it('a un prospecto sin ventas le aplica la bienvenida', () => {
    const { promociones } = montar((s) => {
      const base = (s.clientes ?? []).find((c) => c.id === 'cli-2');
      if (!base) throw new Error('falta cli-2 en el snapshot de prueba');
      s.clientes = [...(s.clientes ?? []), { ...base, id: 'cli-p', tipo: 'prospecto', primera_venta_en: null }];
    });
    expect(ids(promociones.aplicablesPara('cli-p'))).toEqual(['promo-general', 'promo-prospecto']);
  });

  it('con una venta local del prospecto ya no', () => {
    const { promociones, ventas } = montar((s) => {
      // El prospecto necesita precio para poder venderle (D15).
      s.precios = [
        ...(s.precios ?? []),
        { id: 'pcl-p', cliente_id: 'cli-2', presentacion_id: 'pre-1', precio_centavos: 2500, vigente_desde: '2026-01-01', activo: 1 },
      ];
    });
    expect(ids(promociones.aplicablesPara('cli-2'))).toContain('promo-prospecto');
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-2',
      numNota: '',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      firma: FIRMA_DE_PRUEBA,
    });
    expect(ids(promociones.aplicablesPara('cli-2'))).toEqual(['promo-general']);
  });

  it('con primera_venta_en del servidor tampoco', () => {
    const { promociones } = montar((s) => {
      s.clientes = (s.clientes ?? []).map((c) =>
        c.id === 'cli-2' ? { ...c, primera_venta_en: '2026-08-01' } : c,
      );
    });
    expect(ids(promociones.aplicablesPara('cli-2'))).toEqual(['promo-general']);
  });

  it('una propia del cliente desplaza a la general', () => {
    const { promociones } = montar((s) => {
      s.promociones = [
        ...(s.promociones ?? []),
        {
          id: 'promo-propia', audiencia: 'cliente', cliente_id: 'cli-1',
          compra_tipo: 'producto', compra_producto_id: 'pro-1', compra_presentacion_id: null, compra_cantidad: 5,
          regalo_tipo: 'mismo', regalo_producto_id: null, regalo_presentacion_id: null, regalo_cantidad: 1,
          se_repite: 1, activo: 1,
        },
      ];
    });
    expect(ids(promociones.aplicablesPara('cli-1'))).toEqual(['promo-propia']);
  });
});
