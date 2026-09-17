import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioFolios } from '@/datos/repositorios/folios';
import { crearRepositorioJornadas } from '@/datos/repositorios/jornadas';
import { crearRepositorioProspectos } from '@/datos/repositorios/prospectos';
import { crearRepositorioVentas } from '@/datos/repositorios/ventas';

import { contarPendientesDeSubir } from './pendientes';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const folios = crearRepositorioFolios(deps);
  return {
    jornadas: crearRepositorioJornadas(deps),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    prospectos: crearRepositorioProspectos(deps, { catalogos }),
  };
}

describe('contarPendientesDeSubir', () => {
  it('sin nada capturado no hay pendientes', () => {
    const { jornadas, ventas, prospectos } = montar();
    expect(contarPendientesDeSubir({ jornadas, ventas, prospectos })).toBe(0);
  });

  /**
   * Las 3 fuentes del push de hoy (T-07, T-16, T-40). Si se olvida una aqui, el
   * menu de la jornada y "cerrar el dia" dicen "listo" con datos sin subir
   * (I-1, PR #90).
   */
  it('suma jornada, venta y prospecto pendientes', () => {
    const { jornadas, ventas, prospectos } = montar();

    jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '1234',
      contadoCredito: 'credito',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
    });
    prospectos.registrar({
      vendedorId: 'ven-1',
      sucursalId: 'suc-tj',
      nombre: 'Tacos Aaron',
      telefono: '6641112233',
      encargado: null,
      tipoNegocioId: null,
      comentarios: null,
      lat: null,
      lng: null,
    });

    expect(contarPendientesDeSubir({ jornadas, ventas, prospectos })).toBe(3);
  });
});
