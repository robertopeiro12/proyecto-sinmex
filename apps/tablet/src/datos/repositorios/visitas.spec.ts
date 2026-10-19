import { depsDePrueba, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioJornadas, ErrorJornada } from './jornadas';
import { crearRepositorioVisitas, ErrorVisita, type DatosRegistroVisita } from './visitas';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  return {
    deps,
    catalogos,
    jornadas: crearRepositorioJornadas(deps),
    visitas: crearRepositorioVisitas(deps, { catalogos }),
  };
}

const captura = (cambios: Partial<DatosRegistroVisita> = {}): DatosRegistroVisita => ({
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  motivoVisitaId: 'mot-cerrado',
  observaciones: null,
  atendio: null,
  lat: 32.5149,
  lng: -117.0382,
  precisionM: 15,
  direccionTexto: null,
  fotoUri: 'file:///cache/visita.jpg',
  ...cambios,
});

describe('repositorio de visitas (T-39, D6)', () => {
  it('registra la visita pendiente de subir, con el dia, la hora y el nombre del motivo', () => {
    const { visitas } = montar();
    const v = visitas.registrar(captura({ observaciones: '  Cortina abajo ' }));
    expect(v).toMatchObject({
      fecha: '2026-08-07',
      cliente_id: 'cli-1',
      vendedor_id: 'ven-1',
      sucursal_id: 'suc-tj',
      motivo_visita_id: 'mot-cerrado',
      motivo_nombre: 'Cerrado',
      visitada_en: MOMENTO,
      observaciones: 'Cortina abajo',
      lat: 32.5149,
      precision_m: 15,
      foto_local: 'file:///cache/visita.jpg',
      foto_subida_en: null,
      foto_descartada: 0,
      sync_estado: 'pendiente',
    });
  });

  it('sin GPS guarda la direccion; sin GPS ni direccion no guarda nada', () => {
    const { visitas } = montar();
    expect(
      visitas.registrar(captura({ lat: null, lng: null, precisionM: null, direccionTexto: ' Frente al parque ' }))
        .direccion_texto,
    ).toBe('Frente al parque');
    expect(() => visitas.registrar(captura({ lat: null, lng: null, direccionTexto: '   ' }))).toThrow(ErrorVisita);
  });

  it('media coordenada no se guarda', () => {
    const { visitas } = montar();
    expect(() => visitas.registrar(captura({ lng: null }))).toThrow(ErrorVisita);
  });

  it('un motivo dado de baja despues de elegirlo SI se guarda (Review Focus 1)', () => {
    const { visitas } = montar();
    expect(visitas.registrar(captura({ motivoVisitaId: 'mot-baja' })).motivo_nombre).toBe('Vacaciones');
  });

  it('un motivo que la tablet no conoce no se guarda', () => {
    const { visitas } = montar();
    expect(() => visitas.registrar(captura({ motivoVisitaId: 'no-existe' }))).toThrow(ErrorVisita);
  });

  it('se puede visitar a un prospecto', () => {
    const { visitas } = montar();
    expect(visitas.registrar(captura({ clienteId: 'cli-2' })).cliente_id).toBe('cli-2');
  });

  it('con el dia cerrado no se registra (T-38)', () => {
    const { visitas, jornadas } = montar();
    const j = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(j.id, 20);
    expect(() => visitas.registrar(captura())).toThrow(ErrorJornada);
  });

  it('textos de mas no se guardan', () => {
    const { visitas } = montar();
    expect(() => visitas.registrar(captura({ observaciones: 'x'.repeat(501) }))).toThrow(ErrorVisita);
    expect(() => visitas.registrar(captura({ atendio: 'x'.repeat(121) }))).toThrow(ErrorVisita);
    expect(() => visitas.registrar(captura({ direccionTexto: 'x'.repeat(301) }))).toThrow(ErrorVisita);
  });

  it('delDia y delDiaDelVendedor traen las visitas de hoy en orden de captura', () => {
    const { visitas } = montar();
    const a = visitas.registrar(captura());
    const b = visitas.registrar(captura({ motivoVisitaId: 'mot-tenia' }));
    visitas.registrar(captura({ clienteId: 'cli-2' }));
    expect(visitas.delDia('cli-1').map((v) => v.id)).toEqual([a.id, b.id]);
    expect(visitas.delDiaDelVendedor('ven-1')).toHaveLength(3);
    expect(visitas.delDia('cli-1', '2026-08-06')).toEqual([]);
  });

  it('la cola del push incluye las rechazadas y saca las sincronizadas', () => {
    const { visitas } = montar();
    const a = visitas.registrar(captura());
    const b = visitas.registrar(captura());
    visitas.marcarSincronizada(a.id);
    visitas.marcarError(b.id, 'motivo-visita-inexistente: El motivo no existe.');
    expect(visitas.pendientesDeSincronizar().map((v) => v.id)).toEqual([b.id]);
    expect(visitas.porId(b.id)).toMatchObject({ sync_estado: 'error', sync_error: 'motivo-visita-inexistente: El motivo no existe.' });
  });

  it('la foto solo se ofrece cuando la visita ya esta sincronizada, y su fallo no toca sync_estado', () => {
    const { visitas } = montar();
    const v = visitas.registrar(captura());
    expect(visitas.pendientesDeSubirFoto()).toEqual([]);
    visitas.marcarSincronizada(v.id);
    expect(visitas.pendientesDeSubirFoto().map((x) => x.id)).toEqual([v.id]);

    visitas.anotarErrorFoto(v.id, 'sin red');
    expect(visitas.porId(v.id)).toMatchObject({ sync_estado: 'sincronizado', foto_error: 'sin red' });
    visitas.marcarFotoSubida(v.id, '2026-08-07T16:00:00.000Z');
    expect(visitas.porId(v.id)).toMatchObject({ foto_subida_en: '2026-08-07T16:00:00.000Z', foto_error: null });
    expect(visitas.pendientesDeSubirFoto()).toEqual([]);
  });

  it('una foto descartada deja de ofrecerse y conserva la ruta local', () => {
    const { visitas } = montar();
    const v = visitas.registrar(captura());
    visitas.marcarSincronizada(v.id);
    visitas.descartarFoto(v.id, 'La foto pesa demasiado');
    expect(visitas.pendientesDeSubirFoto()).toEqual([]);
    expect(visitas.porId(v.id)).toMatchObject({ foto_descartada: 1, foto_local: 'file:///cache/visita.jpg' });
  });
});
