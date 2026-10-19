import { depsDePrueba, FIRMA_DE_PRUEBA, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioFolios } from '@/datos/repositorios/folios';
import { crearRepositorioVentas } from '@/datos/repositorios/ventas';

import { fuenteVentas } from './fuente-ventas';

const REGALOS = [
  { promocionId: 'promo-general', presentacionId: 'pre-1', cantidad: 2, texto: 'Por cada 10 Jamaica, 1 Jamaica gratis' },
  { promocionId: 'promo-prospecto', presentacionId: 'pre-2', cantidad: 3, texto: 'Bienvenida' },
];

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const ventas = crearRepositorioVentas(deps, {
    catalogos,
    folios: crearRepositorioFolios(deps),
  });
  return { deps, ventas, fuente: fuenteVentas(ventas) };
}

describe('fuente de ventas (T-16)', () => {
  it('sin ventas no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('venta');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre exacto del contrato: cliente y folio en el sobre, lineas con su precio en datos', () => {
    const { ventas, fuente } = montar();
    const v = ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '2346',
      contadoCredito: 'credito',
      factura: 'pendiente',
      comentarios: 'Entregar atras',
      lineas: [
        { presentacionId: 'pre-1', cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: 'pre-2', cantidad: 0, cantidadPromocion: 3 },
      ],
      regalos: REGALOS,
      firma: { uri: 'file:///documentos/firmas/firma-v.jpg', nombre: 'Doña Lupe' },
    });

    expect(fuente.pendientes()).toEqual([
      {
        // La clave es el id de la fila: no cambia entre reintentos.
        clave: v.id,
        tipo: 'venta',
        // El dia de trabajo del reloj local, el mismo del folio.
        fecha_operacion: '2026-08-07',
        ocurrido_en: MOMENTO,
        cliente_id: 'cli-1',
        folio: 'TJ260807AP01',
        datos: {
          num_nota: '2346',
          contado_credito: 'credito',
          factura: 'pendiente',
          comentarios: 'Entregar atras',
          lineas: [
            { presentacion_id: 'pre-1', cantidad: 24, cantidad_promocion: 2, precio_centavos: 2800 },
            { presentacion_id: 'pre-2', cantidad: 0, cantidad_promocion: 3, precio_centavos: 0 },
          ],
          // T-74: solo viaja cuando la venta tiene filas.
          regalos: [
            { promocion_id: 'promo-general', presentacion_id: 'pre-1', cantidad: 2, texto: 'Por cada 10 Jamaica, 1 Jamaica gratis' },
            { promocion_id: 'promo-prospecto', presentacion_id: 'pre-2', cantidad: 3, texto: 'Bienvenida' },
          ],
          // T-73: toda venta nueva trae firma; solo viaja el nombre.
          firma: { nombre: 'Doña Lupe' },
        },
      },
    ]);
  });

  it('una venta sin regalos no manda la clave', () => {
    const { ventas, fuente } = montar();
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '2346',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      firma: FIRMA_DE_PRUEBA,
    });
    const op = fuente.pendientes()[0];
    expect(op?.datos).not.toHaveProperty('regalos');
  });

  it('una venta aceptada sale de la cola', () => {
    const { ventas, fuente } = montar();
    const v = ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '2346',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      firma: FIRMA_DE_PRUEBA,
    });

    fuente.marcarSincronizada(v.id);
    expect(fuente.pendientes()).toEqual([]);
  });

  it('una venta rechazada guarda el motivo y se vuelve a mandar en la siguiente sincronizacion (D19)', () => {
    const { ventas, fuente } = montar();
    const v = ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '2346',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      firma: FIRMA_DE_PRUEBA,
    });

    fuente.marcarError(v.id, 'precio-no-asignado: el cliente no tiene precio');
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([v.id]);
    expect(ventas.porId(v.id)?.sync_error).toBe('precio-no-asignado: el cliente no tiene precio');
  });

  it('una firma sin nombre viaja con nombre null', () => {
    const { ventas, fuente } = montar();
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      firma: FIRMA_DE_PRUEBA,
    });
    expect(fuente.pendientes()[0]?.datos.firma).toEqual({ nombre: null });
  });

  it('una venta anterior a la 016 (sin firma_local) no manda la clave: el servidor no espera imagen', () => {
    const { deps, ventas, fuente } = montar();
    const v = ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      firma: FIRMA_DE_PRUEBA,
    });
    deps.bd.runSync('update venta set firma_local = null where id = $id', { $id: v.id });
    expect(fuente.pendientes()[0]?.datos).not.toHaveProperty('firma');
  });
});
