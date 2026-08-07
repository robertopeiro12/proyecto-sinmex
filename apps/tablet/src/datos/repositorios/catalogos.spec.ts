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
});
