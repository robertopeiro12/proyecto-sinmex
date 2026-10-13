import { depsDePrueba, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioRutas } from '@/datos/repositorios/rutas';

import { fuenteRutas } from './fuente-rutas';

const CTX = { vendedorId: 'ven-1', sucursalId: 'suc-tj' };

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const rutas = crearRepositorioRutas(deps, { catalogos });
  return { rutas, fuente: fuenteRutas(rutas) };
}

describe('fuente de altas de ruta (T-37)', () => {
  it('sin altas no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('ruta-alta');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre del contrato: el cliente va en datos, sin cliente ni folio en el sobre', () => {
    const { rutas, fuente } = montar();
    const alta = rutas.agregar('cli-1', CTX);

    expect(fuente.pendientes()).toEqual([
      {
        clave: alta.id,
        tipo: 'ruta-alta',
        fecha_operacion: '2026-08-07',
        ocurrido_en: MOMENTO,
        datos: { cliente_id: 'cli-1' },
      },
    ]);
  });

  it('un alta aceptada sale de la cola', () => {
    const { rutas, fuente } = montar();
    const alta = rutas.agregar('cli-1', CTX);
    fuente.marcarSincronizada(alta.id);
    expect(fuente.pendientes()).toEqual([]);
  });

  it('ruta-duplicada NO es un error: la fila queda sincronizada y sin motivo (D13)', () => {
    const { rutas, fuente } = montar();
    const alta = rutas.agregar('cli-1', CTX);

    // Asi lo arma `aplicarResultado` del motor: "<codigo>: <motivo>".
    fuente.marcarError(alta.id, 'ruta-duplicada: El cliente ya está en tu ruta del 2026-08-07.');

    expect(rutas.porId(alta.id)).toMatchObject({ sync_estado: 'sincronizada', sync_error: null });
    expect(fuente.pendientes()).toEqual([]);
  });

  it('cliente-inexistente se queda en error con el motivo y se vuelve a mandar', () => {
    const { rutas, fuente } = montar();
    const alta = rutas.agregar('cli-1', CTX);

    fuente.marcarError(alta.id, 'cliente-inexistente: El cliente … no existe.');

    expect(rutas.porId(alta.id)).toMatchObject({
      sync_estado: 'error',
      sync_error: 'cliente-inexistente: El cliente … no existe.',
    });
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([alta.id]);
  });
});
