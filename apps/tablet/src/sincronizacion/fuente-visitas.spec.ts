import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioVisitas } from '@/datos/repositorios/visitas';

import { fuenteVisitas } from './fuente-visitas';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const visitas = crearRepositorioVisitas(deps, { catalogos });
  return { visitas, fuente: fuenteVisitas(visitas) };
}

const captura = {
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  motivoVisitaId: 'mot-cerrado',
  observaciones: 'Cortina abajo',
  atendio: null,
  lat: null,
  lng: null,
  precisionM: null,
  direccionTexto: 'Frente al parque',
  fotoUri: 'file:///cache/v.jpg',
};

describe('fuente de visitas (T-39)', () => {
  it('sin visitas no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('visita');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre exacto del contrato: cliente en el sobre, sin folio, la foto NO viaja', () => {
    const { visitas, fuente } = montar();
    const v = visitas.registrar(captura);
    const [op] = fuente.pendientes();
    expect(op).toEqual({
      clave: v.id,
      tipo: 'visita',
      fecha_operacion: '2026-08-07',
      ocurrido_en: '2026-08-07T15:00:00.000Z',
      cliente_id: 'cli-1',
      datos: {
        motivo_visita_id: 'mot-cerrado',
        visitada_en: '2026-08-07T15:00:00.000Z',
        observaciones: 'Cortina abajo',
        atendio: null,
        lat: null,
        lng: null,
        precision_m: null,
        direccion_texto: 'Frente al parque',
      },
    });
    expect(op).not.toHaveProperty('folio');
  });

  it('aceptada sale de la cola; rechazada guarda el motivo y se reenvia', () => {
    const { visitas, fuente } = montar();
    const a = visitas.registrar(captura);
    const b = visitas.registrar(captura);
    fuente.marcarSincronizada(a.id);
    fuente.marcarError(b.id, 'visita-id-ocupado: El id de esta visita ya está ocupado.');
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([b.id]);
    expect(visitas.porId(b.id)?.sync_error).toContain('visita-id-ocupado');
  });
});
