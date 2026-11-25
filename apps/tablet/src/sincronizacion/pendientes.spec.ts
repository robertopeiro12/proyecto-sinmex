import { depsDePrueba, ATENDIO_DE_PRUEBA, CORTE_DE_PRUEBA, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioCobranzas } from '@/datos/repositorios/cobranzas';
import { crearRepositorioCortes } from '@/datos/repositorios/cortes';
import { crearRepositorioVisitas } from '@/datos/repositorios/visitas';
import { crearRepositorioGastos } from '@/datos/repositorios/gastos';
import { crearRepositorioFolios } from '@/datos/repositorios/folios';
import { crearRepositorioJornadas } from '@/datos/repositorios/jornadas';
import { crearRepositorioMovimientos } from '@/datos/repositorios/movimientos';
import { crearRepositorioNotasAsignadas } from '@/datos/repositorios/notas-asignadas';
import { crearRepositorioProspectos } from '@/datos/repositorios/prospectos';
import { crearRepositorioRutas } from '@/datos/repositorios/rutas';
import { crearRepositorioVentas } from '@/datos/repositorios/ventas';

import { fuenteCortes } from './fuente-cortes';
import { contarPendientesDeSubir } from './pendientes';

function montar(deps = depsDePrueba()) {
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const folios = crearRepositorioFolios(deps);
  return {
    jornadas: crearRepositorioJornadas(deps),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    prospectos: crearRepositorioProspectos(deps, { catalogos }),
    cobranzas: crearRepositorioCobranzas(deps, { catalogos }),
    notasAsignadas: crearRepositorioNotasAsignadas(deps),
    visitas: crearRepositorioVisitas(deps, { catalogos }),
    gastos: crearRepositorioGastos(deps, { catalogos }),
    movimientos: crearRepositorioMovimientos(deps, { catalogos }),
    cortes: crearRepositorioCortes(deps),
    rutas: crearRepositorioRutas(deps, { catalogos }),
  };
}

describe('contarPendientesDeSubir', () => {
  it('sin nada capturado no hay pendientes', () => {
    const fuentes = montar();
    expect(contarPendientesDeSubir(fuentes)).toBe(0);
  });

  /**
   * Las 10 fuentes del push de hoy (T-07, T-16, T-40, T-20, T-39, T-30/T-31, T-37,
   * T-27 pieza 2, rediseño pieza 6). Si se olvida una aqui, el menu de la jornada y "cerrar el
   * dia" dicen "listo" con datos sin subir (I-1, PR #90).
   */
  it('suma jornada, venta, prospecto, cobranza, nota no cobrada, visita, gasto, movimiento, corte y alta de ruta pendientes', () => {
    const fuentes = montar();
    const { jornadas, ventas, prospectos, cobranzas, notasAsignadas, visitas, gastos, movimientos, rutas } = fuentes;

    const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '1234',
      contadoCredito: 'credito',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      atendio: ATENDIO_DE_PRUEBA,
    });
    prospectos.registrar({
      vendedorId: 'ven-1',
      sucursalId: 'suc-tj',
      nombre: 'Tacos Aaron',
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipoNegocioId: null,
      comentarios: null,
      lat: null,
      lng: null,
    });

    cobranzas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      ventaNotaId: 'nota-1',
      montoCentavos: 5000,
      metodoPago: 'efectivo',
      fechaPago: '2026-08-07',
    });
    notasAsignadas.registrarNoCobrada({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      ventaNotaId: 'nota-1',
      comentario: 'No tenia efectivo',
    });
    visitas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      motivoVisitaId: 'mot-tenia',
      observaciones: null,
      atendio: null,
      lat: 32.5,
      lng: -117,
      precisionM: null,
      direccionTexto: null,
      fotoUri: null,
    });
    gastos.registrar({
      vendedorId: 'ven-1',
      campoEgresoId: 'ce-gasolina',
      montoCentavos: 25050,
      comentario: null,
      fotoUri: null,
    });
    movimientos.registrar({
      vendedorId: 'ven-1',
      tipo: 'merma_trayecto',
      clienteId: null,
      motivoMermaId: 'mm-golpe',
      comentario: null,
      lineas: [{ presentacionId: 'pre-1', sentido: 'entregado', piezas: 1 }],
    });
    rutas.agregar('cli-1', { vendedorId: 'ven-1', sucursalId: 'suc-tj' });

    // La jornada cuenta solo cerrada (D7). Se cierra al final: con el dia
    // cerrado ya no se puede registrar nada (D6). Rediseño pieza 6: se cierra
    // con el corte, que tambien cuenta.
    jornadas.cerrarConCorte(jornada.id, 20, CORTE_DE_PRUEBA);

    expect(contarPendientesDeSubir(fuentes)).toBe(10);
  });

  it('una jornada abierta no cuenta; al cerrarla, si (T-38, D7)', () => {
    const fuentes = montar();
    const jornada = fuentes.jornadas.abrir({
      vendedorId: 'ven-1',
      vehiculoId: 'veh-1',
      kmInicial: 10,
    });

    expect(contarPendientesDeSubir(fuentes)).toBe(0);

    fuentes.jornadas.cerrar(jornada.id, 20);

    expect(contarPendientesDeSubir(fuentes)).toBe(1);
  });

  it('cuenta solo los cortes que la fuente del push puede mandar (uno con el JSON roto, ninguno de los dos)', () => {
    const deps = depsDePrueba();
    const fuentes = montar(deps);
    const jornada = fuentes.jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    fuentes.jornadas.cerrarConCorte(jornada.id, 20, CORTE_DE_PRUEBA);
    fuentes.jornadas.marcarSincronizada(jornada.id);
    expect(contarPendientesDeSubir(fuentes)).toBe(1);
    expect(fuenteCortes(fuentes.cortes).pendientes()).toHaveLength(1);

    deps.bd.runSync(`update corte set inventario_json = 'no es json'`);
    expect(fuenteCortes(fuentes.cortes).pendientes()).toHaveLength(0);
    expect(contarPendientesDeSubir(fuentes)).toBe(0);
  });
});
