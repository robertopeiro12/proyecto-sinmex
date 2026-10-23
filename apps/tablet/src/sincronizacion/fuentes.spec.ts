import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioCobranzas } from '@/datos/repositorios/cobranzas';
import { crearRepositorioVisitas } from '@/datos/repositorios/visitas';
import { crearRepositorioGastos } from '@/datos/repositorios/gastos';
import { crearRepositorioFolios } from '@/datos/repositorios/folios';
import { crearRepositorioJornadas } from '@/datos/repositorios/jornadas';
import { crearRepositorioMovimientos } from '@/datos/repositorios/movimientos';
import { crearRepositorioProspectos } from '@/datos/repositorios/prospectos';
import { crearRepositorioRutas } from '@/datos/repositorios/rutas';
import { crearRepositorioVentas } from '@/datos/repositorios/ventas';

import { fuentesDelPush } from './fuentes';

// Copia tal cual la funcion `montar()` de `./pendientes.spec.ts` (arma los ocho repositorios).
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
    gastos: crearRepositorioGastos(deps, { catalogos }),
    movimientos: crearRepositorioMovimientos(deps, { catalogos }),
    rutas: crearRepositorioRutas(deps, { catalogos }),
  };
}

describe('fuentesDelPush (T-75, D3; T-30/T-31, D5; T-27 pieza 2)', () => {
  it('sube prospectos ANTES que ventas (T-75), visitas despues de cobranzas (T-39), gastos despues de visitas (T-30/T-31) y movimientos despues de gastos (T-27)', () => {
    const datos = montar();
    expect(fuentesDelPush(datos).map((f) => f.tipo)).toEqual([
      'jornada',
      'prospecto',
      'venta',
      'cobranza',
      'visita',
      'gasto',
      'movimiento',
      'ruta-alta',
    ]);
  });
});
