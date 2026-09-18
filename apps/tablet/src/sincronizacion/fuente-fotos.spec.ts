import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioProspectos } from '@/datos/repositorios/prospectos';

import { fuenteFotosProspectos } from './fuente-fotos';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const prospectos = crearRepositorioProspectos(deps, { catalogos });
  return { prospectos, fuente: fuenteFotosProspectos(prospectos) };
}

const captura = (fotoUri: string | null) => ({
  vendedorId: 'ven-1',
  sucursalId: 'suc-tj',
  nombre: 'Tacos Aaron',
  telefono: '6641112233',
  encargado: null,
  tipoNegocioId: null,
  comentarios: null,
  lat: null,
  lng: null,
  fotoUri,
});

describe('fuente de fotos de prospectos', () => {
  it('la clave es el `id` de la fila, la misma del push', () => {
    // Ahi esta toda la idempotencia de la foto: el servidor nombra el archivo
    // `<clave>.jpg`, asi que reenviar escribe el mismo nombre y no hay duplicados
    // posibles. Sin contador, sin identificador nuevo, sin tabla de control.
    const { prospectos, fuente } = montar();
    const p = prospectos.registrar(captura('file:///cache/a.jpg'));
    prospectos.marcarSincronizado(p.id);

    expect(fuente.pendientes()).toEqual([
      { clave: p.id, uri: 'file:///cache/a.jpg' },
    ]);
  });

  it('no ofrece nada mientras el prospecto no este sincronizado', () => {
    const { prospectos, fuente } = montar();
    prospectos.registrar(captura('file:///cache/a.jpg'));

    expect(fuente.pendientes()).toEqual([]);
  });

  it('un prospecto sin foto no aparece nunca', () => {
    const { prospectos, fuente } = montar();
    const p = prospectos.registrar(captura(null));
    prospectos.marcarSincronizado(p.id);

    expect(fuente.pendientes()).toEqual([]);
  });

  it('marcarSubida guarda el momento del servidor y limpia el error', () => {
    const { prospectos, fuente } = montar();
    const p = prospectos.registrar(captura('file:///cache/a.jpg'));
    prospectos.marcarSincronizado(p.id);
    fuente.anotarError(p.id, 'sin red');

    fuente.marcarSubida(p.id, '2026-08-07T17:30:00.000Z');

    expect(prospectos.porId(p.id)).toMatchObject({
      foto_subida_en: '2026-08-07T17:30:00.000Z',
      foto_error: null,
    });
    expect(fuente.pendientes()).toEqual([]);
  });

  it('descartar deja de ofrecerla; anotarError no', () => {
    const { prospectos, fuente } = montar();
    const temporal = prospectos.registrar(captura('file:///cache/temporal.jpg'));
    const permanente = prospectos.registrar(captura('file:///cache/gigante.jpg'));
    prospectos.marcarSincronizado(temporal.id);
    prospectos.marcarSincronizado(permanente.id);

    fuente.anotarError(temporal.id, 'El servidor respondio 500.');
    fuente.descartar(permanente.id, 'La foto pesa mas de lo que el servidor acepta.');

    expect(fuente.pendientes().map((f) => f.clave)).toEqual([temporal.id]);
  });
});
