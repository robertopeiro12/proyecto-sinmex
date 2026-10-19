import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioCobranzas } from '@/datos/repositorios/cobranzas';
import { crearRepositorioVisitas } from '@/datos/repositorios/visitas';
import { crearRepositorioFolios } from '@/datos/repositorios/folios';
import { crearRepositorioJornadas } from '@/datos/repositorios/jornadas';
import { crearRepositorioProspectos } from '@/datos/repositorios/prospectos';
import { crearRepositorioRutas } from '@/datos/repositorios/rutas';
import { crearRepositorioVentas } from '@/datos/repositorios/ventas';

import { fuentesDelPush } from './fuentes';

// Copia tal cual la funcion `montar()` de `./pendientes.spec.ts` (arma los seis repositorios).
function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const folios = crearRepositorioFolios(deps);
  return {
    jornadas: crearRepositorioJornadas(deps),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    prospectos: crearRepositorioProspectos(deps, { catalogos }),
    cobranzas: crearRepositorioCobranzas(deps, { catalogos }),
    visitas: crearRepositorioVisitas(deps, { catalogos }),
    rutas: crearRepositorioRutas(deps, { catalogos }),
  };
}

describe('fuentesDelPush (T-75, D3)', () => {
  it('sube prospectos ANTES que ventas (T-75) y visitas despues de cobranzas (T-39)', () => {
    const datos = montar();
    expect(fuentesDelPush(datos).map((f) => f.tipo)).toEqual([
      'jornada',
      'prospecto',
      'venta',
      'cobranza',
      'visita',
      'ruta-alta',
    ]);
  });
});
