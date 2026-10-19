import { depsDePrueba, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioGastos } from '@/datos/repositorios/gastos';

import { fuenteGastos } from './fuente-gastos';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const gastos = crearRepositorioGastos(deps, { catalogos });
  return { gastos, fuente: fuenteGastos(gastos) };
}

const captura = {
  vendedorId: 'ven-1',
  campoEgresoId: 'ce-hielo',
  montoCentavos: 8000,
  comentario: null,
  fotoUri: 'file:///cache/ticket.jpg',
};

describe('fuente de gastos (T-30/T-31, D5)', () => {
  it('sin gastos no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('gasto');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre exacto del contrato: sin cliente_id, sin folio, la foto NO viaja', () => {
    const { gastos, fuente } = montar();
    const g = gastos.registrar({ ...captura, comentario: 'Bolsa de 5 kg' });
    const [op] = fuente.pendientes();
    expect(op).toEqual({
      clave: g.id,
      tipo: 'gasto',
      fecha_operacion: '2026-08-07',
      ocurrido_en: MOMENTO,
      datos: {
        campo_egreso_id: 'ce-hielo',
        monto_centavos: 8000,
        registrado_en: MOMENTO,
        comentario: 'Bolsa de 5 kg',
      },
    });
    expect(op).not.toHaveProperty('cliente_id');
    expect(op).not.toHaveProperty('folio');
  });

  it('aceptado sale de la cola; rechazado guarda el motivo y se reenvia con la misma clave', () => {
    const { gastos, fuente } = montar();
    const a = gastos.registrar(captura);
    const b = gastos.registrar(captura);
    fuente.marcarSincronizada(a.id);
    fuente.marcarError(b.id, 'campo-egreso-inexistente: El campo de egreso no existe en el catálogo.');
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([b.id]);
    expect(gastos.porId(b.id)?.sync_estado).toBe('error');
  });
});
