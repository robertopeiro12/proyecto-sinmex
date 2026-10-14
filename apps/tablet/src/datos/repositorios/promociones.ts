import { promocionesAplicables, type CatalogoPromociones, type PromocionAplicable } from '../promociones-reglas';
import type { Promocion } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';

export type RepositorioPromociones = ReturnType<typeof crearRepositorioPromociones>;

/**
 * Lectura de las promociones (T-74). La escritura la hace el pull en
 * `catalogos.guardarSnapshot`; aqui solo se decide cuales aplican hoy y como se
 * llaman. Recibe `catalogos` para leer el cliente con la misma instancia que
 * publica la version que observan las pantallas. Lee `venta` directo con `bd`
 * para no depender del repositorio de ventas.
 */
export function crearRepositorioPromociones({ bd }: DepsRepositorio, { catalogos }: { catalogos: RepositorioCatalogos }) {
  // Funcion interna y no `this.catalogo()`: no depender de `this` en el literal.
  // El orden (nombre, volumen) es el de `presentacionesParaVenta`, para que "la
  // primera en el orden del catalogo" (D16) coincida con la pantalla.
  function leerCatalogo(): CatalogoPromociones {
    const filas = bd.getAllSync<{ id: string; producto_id: string; producto_nombre: string; volumen: string }>(
      `select pr.id, pr.producto_id, p.nombre as producto_nombre, pr.volumen
         from presentacion pr join producto p on p.id = pr.producto_id
        where pr.activo = 1 and p.activo = 1
        order by p.nombre, pr.volumen`,
    );
    return {
      presentaciones: new Map(filas.map((f) => [f.id, { productoId: f.producto_id, etiqueta: `${f.producto_nombre} ${f.volumen}` }])),
      productos: new Map(filas.map((f) => [f.producto_id, f.producto_nombre])),
    };
  }

  return {
    /** Nombres y productos de las presentaciones activas, en el orden del catalogo. */
    catalogo: leerCatalogo,

    /** Las que le aplican hoy al cliente (D5, D7), con su frase. */
    aplicablesPara(clienteId: string): PromocionAplicable[] {
      const cliente = catalogos.obtenerCliente(clienteId);
      if (!cliente) return [];
      const promociones = bd.getAllSync<Promocion>(
        `select * from promocion where activo = 1 and (cliente_id is null or cliente_id = $cliente_id) order by rowid`,
        { $cliente_id: clienteId },
      );
      const tieneVentas =
        bd.getFirstSync<{ n: number }>('select count(*) as n from venta where cliente_id = $cliente_id', { $cliente_id: clienteId })?.n !== 0;
      return promocionesAplicables({ cliente, tieneVentas, promociones, catalogo: leerCatalogo() });
    },
  };
}
