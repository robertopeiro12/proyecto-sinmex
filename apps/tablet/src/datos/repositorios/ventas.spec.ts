import { depsDePrueba, FIRMA_DE_PRUEBA, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { relojFijo } from '../reloj';
import type { EstadoCarga } from '../tipos';
import { aplicarSnapshotCargas } from './cargas';
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

const TEXTO_GENERAL = 'Por cada 10 Jamaica, 1 Jamaica gratis';

const venta = (extra: Partial<DatosRegistroVenta> = {}): DatosRegistroVenta => ({
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  numNota: '2346',
  contadoCredito: 'credito',
  factura: 'N/A',
  comentarios: null,
  lineas: [{ presentacionId: 'pre-1', cantidad: 24, cantidadPromocion: 2 }],
  // T-74: las 2 piezas de promocion de la linea llegan como regalo aplicado.
  regalos: [{ promocionId: 'promo-general', presentacionId: 'pre-1', cantidad: 2, texto: TEXTO_GENERAL }],
  firma: FIRMA_DE_PRUEBA,
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
        venta({
          lineas: [{ presentacionId: 'pre-2', cantidad: 0, cantidadPromocion: 3 }],
          regalos: [{ promocionId: 'promo-prospecto', presentacionId: 'pre-2', cantidad: 3, texto: 'Bienvenida' }],
        }),
      );
      expect(v.monto_total_centavos).toBe(0);
      expect(ventas.lineasDe(v.id)).toEqual([
        { venta_id: v.id, presentacion_id: 'pre-2', cantidad: 0, cantidad_promocion: 3, precio_centavos: 0 },
      ]);
    });

    it('graba los regalos y regalosDe los devuelve', () => {
      const { deps, ventas } = montar();
      const v = ventas.registrar(
        venta({
          lineas: [{ presentacionId: 'pre-1', cantidad: 10, cantidadPromocion: 1 }],
          regalos: [{ promocionId: 'promo-general', presentacionId: 'pre-1', cantidad: 1, texto: `  ${TEXTO_GENERAL} ` }],
        }),
      );
      expect(ventas.regalosDe(v.id)).toEqual([
        {
          id: expect.any(String),
          venta_id: v.id,
          promocion_id: 'promo-general',
          presentacion_id: 'pre-1',
          cantidad: 1,
          texto: TEXTO_GENERAL,
        },
      ]);
      expect(deps.bd.getFirstSync<{ n: number }>('select count(*) as n from venta_promocion')?.n).toBe(1);
    });

    it('si los regalos no cuadran con las piezas de promocion, no graba ni quema folio', () => {
      const { deps, folios, ventas } = montar();
      const regalo = { promocionId: 'promo-general', presentacionId: 'pre-1', texto: TEXTO_GENERAL };
      // Falta uno, sobra uno, uno incompleto y uno de otra presentacion.
      for (const regalos of [
        [{ ...regalo, cantidad: 1 }],
        [{ ...regalo, cantidad: 3 }],
        [{ ...regalo, cantidad: 2, texto: '  ' }],
        [{ ...regalo, cantidad: 2, presentacionId: 'pre-2' }],
        [],
      ]) {
        expect(() => ventas.registrar(venta({ regalos }))).toThrow(ErrorVenta);
      }
      expect(folios.consecutivoDe('ven-1')).toBe(0);
      expect(cuantas(deps, 'folio_emitido')).toBe(0);
      expect(cuantas(deps, 'venta')).toBe(0);
      expect(deps.bd.getFirstSync<{ n: number }>('select count(*) as n from venta_promocion')?.n).toBe(0);
    });

    it('un regalo de una presentacion sin linea, o con texto de mas de 200 caracteres, no graba ni quema folio', () => {
      const { deps, folios, ventas } = montar();
      const bueno = { promocionId: 'promo-general', presentacionId: 'pre-1', cantidad: 2, texto: TEXTO_GENERAL };
      const intentos = [
        // Las sumas de la linea cuadran, pero sobra un regalo de una presentacion sin linea.
        [bueno, { ...bueno, presentacionId: 'pre-2', cantidad: 1 }],
        [{ ...bueno, texto: 'x'.repeat(201) }],
      ];
      for (const regalos of intentos) {
        expect(() => ventas.registrar(venta({ regalos }))).toThrow(ErrorVenta);
      }
      expect(folios.consecutivoDe('ven-1')).toBe(0);
      expect(cuantas(deps, 'folio_emitido')).toBe(0);
      expect(cuantas(deps, 'venta')).toBe(0);
      expect(deps.bd.getFirstSync<{ n: number }>('select count(*) as n from venta_promocion')?.n).toBe(0);
    });

    it('una venta sin regalos y sin piezas de promocion sigue entrando', () => {
      const { ventas } = montar();
      const v = ventas.registrar({
        vendedorId: 'ven-1',
        clienteId: 'cli-1',
        numNota: '2346',
        contadoCredito: 'contado',
        factura: 'N/A',
        comentarios: null,
        lineas: [{ presentacionId: 'pre-1', cantidad: 3, cantidadPromocion: 0 }],
        firma: FIRMA_DE_PRUEBA,
      });
      expect(ventas.regalosDe(v.id)).toEqual([]);
      expect(ventas.hayAlgunaDe('cli-1')).toBe(true);
      expect(ventas.hayAlgunaDe('cli-2')).toBe(false);
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

    it('sin numero de nota graba la venta con num_nota null', () => {
      const { ventas } = montar();
      const grabada = ventas.registrar(venta({ numNota: '  ' }));
      expect(grabada.num_nota).toBeNull();
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

  describe('delDiaDelVendedor (T-75, D7)', () => {
    it('las ventas del dia del vendedor, en orden de captura, sin las de otro dia', () => {
      const { ventas } = montar();
      const a = ventas.registrar(venta());
      const b = ventas.registrar(venta({ numNota: '2347' }));
      expect(ventas.delDiaDelVendedor(a.vendedor_id).map((v) => v.id)).toEqual([a.id, b.id]);
      expect(ventas.delDiaDelVendedor(a.vendedor_id, '2020-01-01')).toEqual([]);
    });

    it('no incluye las ventas de otro vendedor del mismo dia', () => {
      const { ventas, deps } = montar();
      const mia = ventas.registrar(venta());
      // Directo a la tabla: `registrar` exige jornada y segmento de folio del vendedor.
      deps.bd.runSync(
        `insert into venta (id, fecha, cliente_id, vendedor_id, sucursal_id, folio,
           contado_credito, monto_total_centavos, grabada_en)
         values ('venta-ajena', $fecha, 'cli-1', 'ven-2', 'suc-tj', 'F-AJENO',
           'contado', 0, '2026-08-07T15:00:00.000Z')`,
        { $fecha: mia.fecha },
      );
      expect(ventas.delDiaDelVendedor('ven-2').map((x) => x.id)).toEqual(['venta-ajena']);
      expect(ventas.delDiaDelVendedor(mia.vendedor_id).map((x) => x.id)).toEqual([mia.id]);
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

describe('firma del cliente (T-73)', () => {
  const FIRMA = { uri: 'file:///documentos/firmas/firma-x.jpg', nombre: 'Doña Lupe' };

  it('graba la firma en la misma venta: ruta y nombre, por subir y sin error', () => {
    const { ventas } = montar();
    const v = ventas.registrar(venta({ firma: FIRMA }));
    expect(v).toMatchObject({
      firma_local: 'file:///documentos/firmas/firma-x.jpg',
      firma_nombre: 'Doña Lupe',
      firma_subida_en: null,
      firma_error: null,
      firma_descartada: 0,
      sync_estado: 'pendiente',
    });
  });

  it('usa el id que le da la pantalla: el archivo de la firma ya se nombro con el', () => {
    const { folios, ventas } = montar();
    const v = ventas.registrar(venta({ id: 'venta-de-la-pantalla' }));
    expect(v.id).toBe('venta-de-la-pantalla');
    expect(folios.porOperacion('venta-de-la-pantalla')?.folio).toBe(v.folio);
  });

  it('sin firma no graba ni quema folio (D1)', () => {
    const { deps, folios, ventas } = montar();
    expect(() => ventas.registrar(venta({ firma: { uri: '   ', nombre: null } }))).toThrow(ErrorVenta);
    expect(folios.consecutivoDe('ven-1')).toBe(0);
    expect(cuantas(deps, 'venta')).toBe(0);
  });

  it('un nombre sin recortar o de mas de 80 caracteres no se graba', () => {
    const { deps, ventas } = montar();
    expect(() => ventas.registrar(venta({ firma: { uri: FIRMA.uri, nombre: 'x'.repeat(81) } }))).toThrow(
      ErrorVenta,
    );
    expect(() => ventas.registrar(venta({ firma: { uri: FIRMA.uri, nombre: ' Lupe ' } }))).toThrow(ErrorVenta);
    expect(cuantas(deps, 'venta')).toBe(0);
  });

  it('un fallo dentro de la transaccion no deja firma ni folio', () => {
    const { deps, folios, ventas } = montar();
    deps.bd.execSync('drop table venta_linea;');
    expect(() => ventas.registrar(venta({ firma: FIRMA }))).toThrow();
    expect(folios.consecutivoDe('ven-1')).toBe(0);
    expect(
      deps.bd.getFirstSync<{ n: number }>('select count(*) as n from venta where firma_local is not null')?.n,
    ).toBe(0);
  });

  describe('cola de firmas', () => {
    it('solo ofrece firmas de ventas ya sincronizadas: ni pendientes ni rechazadas (Review Focus 4)', () => {
      const { ventas } = montar();
      const aceptada = ventas.registrar(venta());
      const rechazada = ventas.registrar(venta({ numNota: '2347' }));
      ventas.marcarError(rechazada.id, 'precio-no-asignado: el cliente no tiene precio');
      expect(ventas.firmasPendientes()).toEqual([]);

      ventas.marcarSincronizada(aceptada.id);
      expect(ventas.firmasPendientes().map((v) => v.id)).toEqual([aceptada.id]);
    });

    it('una venta anterior a la 016 (sin firma_local) nunca entra a la cola', () => {
      const { deps, ventas } = montar();
      const v = ventas.registrar(venta());
      deps.bd.runSync('update venta set firma_local = null where id = $id', { $id: v.id });
      ventas.marcarSincronizada(v.id);
      expect(ventas.firmasPendientes()).toEqual([]);
    });

    it('marcarFirmaSubida la saca de la cola y limpia el error, sin tocar sync_estado', () => {
      const { ventas } = montar();
      const v = ventas.registrar(venta());
      ventas.marcarSincronizada(v.id);
      ventas.anotarErrorFirma(v.id, 'sin red');
      ventas.marcarFirmaSubida(v.id, '2026-08-07T16:00:00.000Z');
      expect(ventas.porId(v.id)).toMatchObject({
        firma_subida_en: '2026-08-07T16:00:00.000Z',
        firma_error: null,
        sync_estado: 'sincronizado',
      });
      expect(ventas.firmasPendientes()).toEqual([]);
    });

    it('anotarErrorFirma la deja en la cola; descartarFirma la saca; ninguna toca sync_estado', () => {
      const { ventas } = montar();
      const temporal = ventas.registrar(venta());
      const definitiva = ventas.registrar(venta({ numNota: '2347' }));
      ventas.marcarSincronizada(temporal.id);
      ventas.marcarSincronizada(definitiva.id);

      ventas.anotarErrorFirma(temporal.id, 'El servidor respondio 500.');
      ventas.descartarFirma(definitiva.id, 'Esa venta ya no existe.');

      expect(ventas.firmasPendientes().map((v) => v.id)).toEqual([temporal.id]);
      expect(ventas.porId(temporal.id)).toMatchObject({
        firma_error: 'El servidor respondio 500.',
        firma_descartada: 0,
        sync_estado: 'sincronizado',
      });
      expect(ventas.porId(definitiva.id)).toMatchObject({
        firma_error: 'Esa venta ya no existe.',
        firma_descartada: 1,
        sync_estado: 'sincronizado',
      });
    });
  });
});

describe('inventario del vendedor (T-27, D3, D4, D10)', () => {
  const HOY = '2026-08-07';

  function prenderControl(deps: DepsRepositorio) {
    deps.bd.runSync("update vendedor set control_inventario = 1 where id = 'ven-1'");
  }

  function cargar(
    deps: DepsRepositorio,
    id: string,
    numero: number,
    estado: EstadoCarga,
    lineas: { presentacion_id: string; piezas: number }[],
  ) {
    aplicarSnapshotCargas(
      deps.bd,
      [
        {
          id,
          vendedor_id: 'ven-1',
          fecha: HOY,
          numero,
          estado,
          motivo_rechazo: estado === 'rechazada' ? 'Faltan cajas' : null,
          version: 1,
          respondida_en: estado === 'pendiente' ? null : MOMENTO,
          activo: 1,
          lineas,
        },
      ],
      MOMENTO,
    );
  }

  it('Review Focus 5: con el control apagado vende aunque haya una carga pendiente', () => {
    const { deps, ventas } = montar();
    cargar(deps, 'carga-1', 1, 'pendiente', [{ presentacion_id: 'pre-1', piezas: 1 }]);
    expect(ventas.registrar(venta()).folio).toBe('TJ260807AP01');
  });

  it('con el control prendido y una carga pendiente no graba ni quema folio (D3)', () => {
    const { deps, ventas } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 100 }]);
    cargar(deps, 'carga-2', 2, 'pendiente', [{ presentacion_id: 'pre-1', piezas: 10 }]);
    expect(() => ventas.registrar(venta())).toThrow(ErrorVenta);
    expect(() => ventas.registrar(venta())).toThrow(
      'Tienes una carga por aceptar. Acéptala en Inventario antes de vender.',
    );
    expect(cuantas(deps, 'venta')).toBe(0);
    expect(cuantas(deps, 'folio_emitido')).toBe(0);
  });

  it('con el control prendido no vende mas de lo que trae, regalos incluidos, y no quema folio (D4)', () => {
    const { deps, ventas } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 20 }]);
    // 24 vendidas + 2 regaladas contra 20 cargadas.
    expect(() => ventas.registrar(venta())).toThrow(
      'No te alcanza el producto: Jamaica 1 L: faltan 6 piezas.',
    );
    expect(cuantas(deps, 'venta')).toBe(0);
    expect(cuantas(deps, 'folio_emitido')).toBe(0);
  });

  it('una venta de solo regalo tambien necesita piezas (D10)', () => {
    const { deps, ventas } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 20 }]);
    expect(() =>
      ventas.registrar(
        venta({
          lineas: [{ presentacionId: 'pre-2', cantidad: 0, cantidadPromocion: 3 }],
          regalos: [{ promocionId: 'promo-prospecto', presentacionId: 'pre-2', cantidad: 3, texto: 'Bienvenida' }],
        }),
      ),
    ).toThrow('Jamaica 500 ml: faltan 3 piezas');
  });

  it('Review Focus 1: valida con la existencia del momento de grabar', () => {
    const { deps, ventas } = montar();
    prenderControl(deps);
    cargar(deps, 'carga-1', 1, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 20 }]);
    // Al abrir la pantalla habia 20: la captura de 24 + 2 no alcanza.
    expect(() => ventas.registrar(venta())).toThrow('faltan 6 piezas');

    // A media captura se acepta una recarga (la escribe la respuesta o el pull)...
    cargar(deps, 'carga-2', 2, 'aceptada', [{ presentacion_id: 'pre-1', piezas: 10 }]);
    // ...y el MISMO registrar valida con lo que hay al grabar: 30 alcanzan para 26.
    expect(ventas.registrar(venta()).folio).toBe('TJ260807AP01');

    // Y al reves: la venta grabada se llevo 26; lo que queda (4) no alcanza para 5.
    expect(() =>
      ventas.registrar(
        venta({
          lineas: [{ presentacionId: 'pre-1', cantidad: 5, cantidadPromocion: 0 }],
          regalos: [],
        }),
      ),
    ).toThrow('Jamaica 1 L: falta 1 pieza');
    expect(cuantas(deps, 'folio_emitido')).toBe(1);
  });

  describe('F3: la venta grabada avisa a las pantallas (Inventario relee Vendido/Existencia)', () => {
    it('una venta grabada publica el cambio despues del commit', () => {
      const { catalogos, ventas } = montar();
      const antes = catalogos.version();
      ventas.registrar(venta());
      expect(catalogos.version()).toBe(antes + 1);
    });

    it('una venta rechazada no avisa de nada', () => {
      const { catalogos, deps, ventas } = montar();
      prenderControl(deps);
      cargar(deps, 'carga-1', 1, 'pendiente', [{ presentacion_id: 'pre-1', piezas: 100 }]);
      const antes = catalogos.version();
      expect(() => ventas.registrar(venta())).toThrow(ErrorVenta);
      expect(catalogos.version()).toBe(antes);
    });

    it('si un oyente del refresco truena, la venta ya grabada no se reporta como fallida', () => {
      const { catalogos, deps, ventas } = montar();
      catalogos.suscribir(() => {
        throw new Error('una pantalla abierta truena al refrescar');
      });
      expect(ventas.registrar(venta()).folio).toBe('TJ260807AP01');
      expect(cuantas(deps, 'venta')).toBe(1);
    });
  });
});
