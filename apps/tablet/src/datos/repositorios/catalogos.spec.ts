import { depsDePrueba, snapshotDePrueba, MOMENTO } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioJornadas } from './jornadas';

function conCatalogos() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  return { deps, catalogos };
}

describe('repositorio de catalogos', () => {
  it('guarda el snapshot completo y lo deja consultable offline', () => {
    const { catalogos } = conCatalogos();

    expect(catalogos.listarClientes('suc-tj').map((c) => c.id)).toEqual(['cli-1']);
    expect(catalogos.obtenerCliente('cli-1')?.nombre).toBe('Abarrotes La Esquina');
    expect(catalogos.obtenerVendedorPorLogin('aperez')?.nombre).toBe('Abraham Perez');
  });

  it('sella cada fila con el momento de la bajada', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.obtenerCliente('cli-1')?.sincronizado_en).toBe(MOMENTO);
    expect(catalogos.frescuraCatalogos()).toBe(MOMENTO);
  });

  it('no lista prospectos como clientes de ruta', () => {
    const { catalogos } = conCatalogos();
    const ids = catalogos.listarClientes('suc-tj').map((c) => c.id);
    expect(ids).not.toContain('cli-2');
  });

  it('no lista vehiculos dados de baja', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.listarVehiculos('suc-tj').map((v) => v.id)).toEqual(['veh-1']);
  });

  it('no mezcla sucursales', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.listarClientes('suc-mx')).toEqual([]);
    expect(catalogos.listarVehiculos('suc-mx')).toEqual([]);
  });

  it('toma el precio vigente mas reciente que no sea futuro', () => {
    const { catalogos } = conCatalogos();

    // Hay precios desde 2026-01-01 (2500), 2026-08-01 (2800) y 2026-12-01 (3000).
    expect(catalogos.precioVigente('cli-1', 'pre-1', '2026-08-07')).toBe(2800);
    expect(catalogos.precioVigente('cli-1', 'pre-1', '2026-03-15')).toBe(2500);
    expect(catalogos.precioVigente('cli-1', 'pre-1', '2027-01-01')).toBe(3000);
  });

  it('devuelve null si no hay precio vigente para esa fecha o presentacion', () => {
    const { catalogos } = conCatalogos();
    expect(catalogos.precioVigente('cli-1', 'pre-1', '2025-12-31')).toBeNull();
    expect(catalogos.precioVigente('cli-1', 'pre-2', '2026-08-07')).toBeNull();
  });

  it('el segundo snapshot actualiza en vez de duplicar', () => {
    const { deps, catalogos } = conCatalogos();

    const segundo = snapshotDePrueba();
    segundo.clientes = [{ ...segundo.clientes![0]!, nombre: 'Abarrotes La Esquina S.A.' }];
    segundo.precios![1] = { ...segundo.precios![1]!, precio_centavos: 2900 };
    catalogos.guardarSnapshot(segundo);

    expect(catalogos.listarClientes('suc-tj')).toHaveLength(1);
    expect(catalogos.obtenerCliente('cli-1')?.nombre).toBe('Abarrotes La Esquina S.A.');
    expect(catalogos.precioVigente('cli-1', 'pre-1', '2026-08-07')).toBe(2900);
    expect(deps.bd.getAllSync<{ id: string }>('select id from cliente_precio')).toHaveLength(3);
  });

  it('un snapshot vacio no borra lo que ya habia (no deja al vendedor sin catalogo)', () => {
    const { catalogos } = conCatalogos();

    catalogos.guardarSnapshot({
      sucursales: [],
      vendedores: [],
      vehiculos: [],
      productos: [],
      presentaciones: [],
      clientes: [],
      precios: [],
    });

    expect(catalogos.listarClientes('suc-tj')).toHaveLength(1);
    expect(catalogos.listarVehiculos('suc-tj')).toHaveLength(1);
  });

  it('refrescar catalogos con la jornada abierta no rompe la llave foranea', () => {
    // Este es el caso del refresco de las 11:00/14:00: el vendedor ya abrio el
    // dia y su jornada apunta a sucursal, vendedor y vehiculo.
    const { deps, catalogos } = conCatalogos();
    const jornadas = crearRepositorioJornadas(deps);
    jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });

    expect(() => catalogos.guardarSnapshot(snapshotDePrueba())).not.toThrow();
    expect(jornadas.deHoy('ven-1')).not.toBeNull();
  });

  it('un snapshot que viola una llave foranea no deja la base a medias', () => {
    const { catalogos } = conCatalogos();

    const invalido = snapshotDePrueba();
    invalido.vehiculos = [
      { id: 'veh-9', nombre: 'Fantasma', sucursal_id: 'suc-inexistente', activo: 1 },
    ];

    expect(() => catalogos.guardarSnapshot(invalido)).toThrow();
    // La transaccion se revirtio entera: no quedo el vehiculo huerfano.
    expect(catalogos.listarVehiculos('suc-tj').map((v) => v.id)).toEqual(['veh-1']);
    expect(catalogos.listarClientes('suc-tj')).toHaveLength(1);
  });

  // ---------------------------------------------------------------- T-07

  describe('la baja llega como bandera, no como ausencia (T-07)', () => {
    it('un cliente dado de baja deja de listarse pero NO se borra', () => {
      // No se puede borrar: la operacion local (una jornada, una venta) puede
      // estar apuntandolo, y el snapshot se aplica con upsert justamente por
      // eso. Ver la migracion 002 y el contrato de sincronizacion.
      const { deps, catalogos } = conCatalogos();

      catalogos.guardarSnapshot({
        clientes: [{ ...snapshotDePrueba().clientes![0]!, activo: 0 }],
      });

      expect(catalogos.listarClientes('suc-tj')).toHaveLength(0);
      expect(catalogos.obtenerCliente('cli-1')).not.toBeNull();
      expect(deps.bd.getAllSync('select id from cliente')).toHaveLength(2);
    });

    it('un precio dado de baja deja de aplicarse y descubre el anterior', () => {
      const { catalogos } = conCatalogos();
      expect(catalogos.precioVigente('cli-1', 'pre-1', '2026-08-07')).toBe(2800);

      catalogos.guardarSnapshot({
        precios: [{ ...snapshotDePrueba().precios![1]!, activo: 0 }],
      });

      // Vuelve a valer el de 2026-01-01, que sigue activo.
      expect(catalogos.precioVigente('cli-1', 'pre-1', '2026-08-07')).toBe(2500);
    });
  });

  describe('notas pendientes por cobrar (T-07)', () => {
    it('bajan con el snapshot y se listan por cliente, mas viejas primero', () => {
      const { catalogos } = conCatalogos();
      const notas = catalogos.notasPendientesDe('cli-1');

      expect(notas.map((n) => n.id)).toEqual(['nota-1', 'nota-2']);
      expect(notas[0]!.saldo_centavos).toBe(15000);
      expect(notas[0]!.monto_total_centavos).toBe(25000);
      expect(notas[0]!.status).toBe('abonado');
    });

    it('una nota cancelada en el portal deja de poder cobrarse', () => {
      const { catalogos } = conCatalogos();

      catalogos.guardarSnapshot({
        notas: [{ ...snapshotDePrueba().notas![0]!, activo: 0 }],
      });

      expect(catalogos.notasPendientesDe('cli-1').map((n) => n.id)).toEqual(['nota-2']);
    });

    it('un cliente sin notas devuelve lista vacia, no null', () => {
      const { catalogos } = conCatalogos();
      expect(catalogos.notasPendientesDe('cli-2')).toEqual([]);
    });
  });

  /**
   * El defecto bloqueante encontrado en dispositivo real el 2026-08-23: tras el
   * primer login de una instalacion nueva, "Abrir el dia" seguia diciendo "Sin
   * vehiculos en el catalogo local" aunque el `pull` ya habia escrito la fila.
   * Ver `40-Equipo/Bitacora/2026-08-23.md` en el vault.
   */
  describe('senal de cambio del catalogo', () => {
    it('la version arranca en cero y sube con cada snapshot con novedades', () => {
      const deps = depsDePrueba();
      const catalogos = crearRepositorioCatalogos(deps);

      expect(catalogos.version()).toBe(0);
      catalogos.guardarSnapshot(snapshotDePrueba());
      expect(catalogos.version()).toBe(1);
      catalogos.guardarSnapshot({ vehiculos: [snapshotDePrueba().vehiculos![0]!] });
      expect(catalogos.version()).toBe(2);
    });

    it('avisa a quien este suscrito, y deja de avisarle al darse de baja', () => {
      const { catalogos } = conCatalogos();
      const avisos: number[] = [];

      const dejarDeEscuchar = catalogos.suscribir(() => avisos.push(catalogos.version()));

      catalogos.guardarSnapshot({ vehiculos: [snapshotDePrueba().vehiculos![0]!] });
      catalogos.guardarSnapshot({ clientes: [snapshotDePrueba().clientes![0]!] });
      expect(avisos).toEqual([2, 3]);

      dejarDeEscuchar();
      catalogos.guardarSnapshot({ vehiculos: [snapshotDePrueba().vehiculos![0]!] });
      expect(avisos).toEqual([2, 3]);
    });

    it('un pull que no trae nada no despierta a nadie', () => {
      // El caso del refresco de media manana (T-44): lo normal es que no haya
      // novedades, y repintar todas las pantallas abiertas por nada seria peor
      // que no avisar.
      const { catalogos } = conCatalogos();
      const versionAntes = catalogos.version();
      let avisos = 0;
      catalogos.suscribir(() => (avisos += 1));

      catalogos.guardarSnapshot({});
      catalogos.guardarSnapshot({ vehiculos: [] });

      expect(avisos).toBe(0);
      expect(catalogos.version()).toBe(versionAntes);
    });

    /**
     * La reproduccion del defecto, sin dispositivo.
     *
     * `useMemo` en miniatura: recalcula solo si alguna dependencia cambio. Es
     * exactamente lo que hacia la pantalla, y basta para demostrar por que se
     * quedaba en blanco y por que la version lo arregla.
     */
    it('sin la version en las dependencias, la pantalla se queda con el catalogo vacio', () => {
      const deps = depsDePrueba();
      const catalogos = crearRepositorioCatalogos(deps);

      // Las dos pantallas hacen la MISMA consulta. Lo unico que las distingue
      // son las dependencias con las que la memorizan.
      const comoEstaba = memo(() => catalogos.listarVehiculos('suc-tj'));
      const conLaSenal = memo(() => catalogos.listarVehiculos('suc-tj'));

      const depsViejas = () => [catalogos, 'suc-tj'];
      const depsNuevas = () => [catalogos, 'suc-tj', catalogos.version()];

      // Primer render en una instalacion nueva: el pull todavia no ha bajado.
      expect(comoEstaba(depsViejas())).toEqual([]);
      expect(conLaSenal(depsNuevas())).toEqual([]);

      // El pull escribe el vehiculo en SQLite. La fila ya esta ahi...
      catalogos.guardarSnapshot(snapshotDePrueba());
      expect(catalogos.listarVehiculos('suc-tj').map((v) => v.id)).toEqual(['veh-1']);

      // ...pero con las dependencias de antes del arreglo —la capa de datos y
      // la sucursal, que no cambian nunca— la pantalla NO vuelve a consultar.
      // Este es el bloqueo: el vendedor no puede abrir el dia.
      expect(comoEstaba(depsViejas())).toEqual([]);

      // Con la version del catalogo en las dependencias, si.
      expect(conLaSenal(depsNuevas()).map((v) => v.id)).toEqual(['veh-1']);
    });
  });
});

/**
 * `useMemo` reducido a lo esencial, para poder probar en Node la regla de
 * invalidacion que en la app aplica React.
 *
 * No pretende imitar a React: solo su unica regla relevante aqui — el valor se
 * recalcula si y solo si alguna dependencia cambio de identidad.
 */
function memo<T>(calcular: () => T): (dependencias: unknown[]) => T {
  let anteriores: unknown[] | null = null;
  let valor: T;

  return (dependencias) => {
    const cambio =
      anteriores === null ||
      dependencias.length !== anteriores.length ||
      dependencias.some((d, i) => !Object.is(d, anteriores![i]));

    if (cambio) {
      anteriores = dependencias;
      valor = calcular();
    }
    return valor;
  };
}
