import { depsDePrueba, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioNotasAsignadas } from '@/datos/repositorios/notas-asignadas';

import { fuenteNotasNoCobradas } from './fuente-notas-no-cobradas';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const notas = crearRepositorioNotasAsignadas(deps);
  return { notas, fuente: fuenteNotasNoCobradas(notas) };
}

const captura = { vendedorId: 'ven-1', clienteId: 'cli-1', ventaNotaId: 'nota-1', comentario: 'No tenia efectivo' };

describe('fuente de notas no cobradas', () => {
  it('sin comentarios no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('nota-no-cobrada');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre del contrato: cliente_id en el sobre, sin folio', () => {
    const { notas, fuente } = montar();
    const n = notas.registrarNoCobrada(captura);
    const [op] = fuente.pendientes();
    expect(op).toEqual({
      clave: n.id,
      tipo: 'nota-no-cobrada',
      cliente_id: 'cli-1',
      fecha_operacion: '2026-08-07',
      ocurrido_en: MOMENTO,
      datos: { venta_nota_id: 'nota-1', comentario: 'No tenia efectivo', registrado_en: MOMENTO },
    });
    expect(op).not.toHaveProperty('folio');
  });

  it('aceptado sale de la cola; rechazado guarda el motivo', () => {
    const { notas, fuente } = montar();
    const a = notas.registrarNoCobrada(captura);
    const b = notas.registrarNoCobrada(captura);
    fuente.marcarSincronizada(a.id);
    fuente.marcarError(b.id, 'nota-no-encontrada: La nota no existe.');
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([b.id]);
  });
});
