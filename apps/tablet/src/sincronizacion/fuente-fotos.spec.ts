import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioProspectos } from '@/datos/repositorios/prospectos';
import { crearRepositorioVisitas } from '@/datos/repositorios/visitas';
import { crearRepositorioGastos } from '@/datos/repositorios/gastos';
import { crearRepositorioFolios } from '@/datos/repositorios/folios';
import { crearRepositorioVentas } from '@/datos/repositorios/ventas';

import {
  combinarFuentesFotos,
  fuenteFirmasVentas,
  fuenteFotosGastos,
  fuenteFotosProspectos,
  fuenteFotosVisitas,
} from './fuente-fotos';

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
  encargado: 'Don Aaron',
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

describe('fotos de visitas y cola combinada (T-39, D9)', () => {
  function montarAmbas() {
    const deps = depsDePrueba();
    const catalogos = crearRepositorioCatalogos(deps);
    catalogos.guardarSnapshot(snapshotDePrueba());
    const prospectos = crearRepositorioProspectos(deps, { catalogos });
    const visitas = crearRepositorioVisitas(deps, { catalogos });
    const fuente = combinarFuentesFotos([fuenteFotosProspectos(prospectos), fuenteFotosVisitas(visitas)]);
    return { prospectos, visitas, fuente };
  }

  const visitaCon = (fotoUri: string | null) => ({
    vendedorId: 'ven-1',
    clienteId: 'cli-1',
    motivoVisitaId: 'mot-cerrado',
    observaciones: null,
    atendio: null,
    lat: 32.5,
    lng: -117,
    precisionM: null,
    direccionTexto: null,
    fotoUri,
  });

  it('la foto de una visita sale solo cuando la visita ya esta sincronizada', () => {
    const { visitas, fuente } = montarAmbas();
    const v = visitas.registrar(visitaCon('file:///cache/v.jpg'));
    expect(fuente.pendientes()).toEqual([]);
    visitas.marcarSincronizada(v.id);
    expect(fuente.pendientes()).toEqual([{ clave: v.id, uri: 'file:///cache/v.jpg' }]);
  });

  it('prospectos primero, visitas despues, y cada resultado vuelve a SU repositorio', () => {
    const { prospectos, visitas, fuente } = montarAmbas();
    const p = prospectos.registrar(captura('file:///cache/p.jpg'));
    prospectos.marcarSincronizado(p.id);
    const v = visitas.registrar(visitaCon('file:///cache/v.jpg'));
    visitas.marcarSincronizada(v.id);

    expect(fuente.pendientes().map((f) => f.clave)).toEqual([p.id, v.id]);
    fuente.marcarSubida(v.id, '2026-08-07T16:00:00.000Z');
    fuente.descartar(p.id, 'La foto pesa demasiado');

    expect(visitas.porId(v.id)?.foto_subida_en).toBe('2026-08-07T16:00:00.000Z');
    expect(prospectos.porId(p.id)).toMatchObject({ foto_descartada: 1, foto_subida_en: null });
    expect(visitas.porId(v.id)?.foto_descartada).toBe(0);
  });

  it('un resultado de una clave que no salio de pendientes() es un bug y truena', () => {
    const { fuente } = montarAmbas();
    expect(() => fuente.anotarError('nadie', 'x')).toThrow(/no salio de pendientes/);
  });
});

describe('fotos de gastos en la cola combinada (T-30/T-31, D8)', () => {
  function montarTres() {
    const deps = depsDePrueba();
    const catalogos = crearRepositorioCatalogos(deps);
    catalogos.guardarSnapshot(snapshotDePrueba());
    const visitas = crearRepositorioVisitas(deps, { catalogos });
    const gastos = crearRepositorioGastos(deps, { catalogos });
    const fuente = combinarFuentesFotos([
      fuenteFotosProspectos(crearRepositorioProspectos(deps, { catalogos })),
      fuenteFotosVisitas(visitas),
      fuenteFotosGastos(gastos),
    ]);
    return { visitas, gastos, fuente };
  }

  const gastoCon = (fotoUri: string | null) => ({
    vendedorId: 'ven-1',
    campoEgresoId: 'ce-gasolina',
    montoCentavos: 25050,
    comentario: null,
    fotoUri,
  });

  it('la foto del ticket sale solo cuando el gasto ya esta sincronizado; sin foto no aparece', () => {
    const { gastos, fuente } = montarTres();
    const g = gastos.registrar(gastoCon('file:///cache/ticket.jpg'));
    const sinFoto = gastos.registrar(gastoCon(null));
    expect(fuente.pendientes()).toEqual([]);
    gastos.marcarSincronizada(g.id);
    gastos.marcarSincronizada(sinFoto.id);
    expect(fuente.pendientes()).toEqual([{ clave: g.id, uri: 'file:///cache/ticket.jpg' }]);
  });

  it('visitas antes que gastos, y cada resultado vuelve a SU repositorio', () => {
    const { visitas, gastos, fuente } = montarTres();
    const v = visitas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      motivoVisitaId: 'mot-cerrado',
      observaciones: null,
      atendio: null,
      lat: 32.5,
      lng: -117,
      precisionM: null,
      direccionTexto: null,
      fotoUri: 'file:///cache/v.jpg',
    });
    visitas.marcarSincronizada(v.id);
    const g = gastos.registrar(gastoCon('file:///cache/ticket.jpg'));
    gastos.marcarSincronizada(g.id);

    expect(fuente.pendientes().map((f) => f.clave)).toEqual([v.id, g.id]);
    fuente.marcarSubida(g.id, '2026-08-07T16:00:00.000Z');
    fuente.anotarError(v.id, 'sin red');

    expect(gastos.porId(g.id)).toMatchObject({ foto_subida_en: '2026-08-07T16:00:00.000Z', sync_estado: 'sincronizado' });
    expect(visitas.porId(v.id)).toMatchObject({ foto_error: 'sin red', foto_subida_en: null });
    expect(gastos.porId(g.id)?.foto_error).toBeNull();
  });
});

describe('firmas de ventas en la cola combinada (T-73)', () => {
  function montarConVentas() {
    const deps = depsDePrueba();
    const catalogos = crearRepositorioCatalogos(deps);
    catalogos.guardarSnapshot(snapshotDePrueba());
    const gastos = crearRepositorioGastos(deps, { catalogos });
    const ventas = crearRepositorioVentas(deps, { catalogos, folios: crearRepositorioFolios(deps) });
    const fuente = combinarFuentesFotos([
      fuenteFotosProspectos(crearRepositorioProspectos(deps, { catalogos })),
      fuenteFotosVisitas(crearRepositorioVisitas(deps, { catalogos })),
      fuenteFotosGastos(gastos),
      fuenteFirmasVentas(ventas),
    ]);
    return { gastos, ventas, fuente };
  }

  const ventaFirmada = (
    ventas: ReturnType<typeof montarConVentas>['ventas'],
    uri = 'file:///documentos/firmas/firma-v.jpg',
  ) =>
    ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '',
      contadoCredito: 'contado',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
      firma: { uri, nombre: 'Doña Lupe' },
    });

  it('la firma sale solo cuando la venta ya esta sincronizada; una rechazada no (Review Focus 4)', () => {
    const { ventas, fuente } = montarConVentas();
    const v = ventaFirmada(ventas);
    const rechazada = ventaFirmada(ventas, 'file:///documentos/firmas/firma-r.jpg');
    ventas.marcarError(rechazada.id, 'precio-no-asignado: sin precio');
    expect(fuente.pendientes()).toEqual([]);

    ventas.marcarSincronizada(v.id);
    expect(fuente.pendientes()).toEqual([{ clave: v.id, uri: 'file:///documentos/firmas/firma-v.jpg' }]);
  });

  it('gastos antes que ventas, y cada resultado vuelve a SU repositorio', () => {
    const { gastos, ventas, fuente } = montarConVentas();
    const v = ventaFirmada(ventas);
    ventas.marcarSincronizada(v.id);
    const g = gastos.registrar({
      vendedorId: 'ven-1',
      campoEgresoId: 'ce-gasolina',
      montoCentavos: 25050,
      comentario: null,
      fotoUri: 'file:///cache/ticket.jpg',
    });
    gastos.marcarSincronizada(g.id);

    expect(fuente.pendientes().map((f) => f.clave)).toEqual([g.id, v.id]);
    fuente.marcarSubida(v.id, '2026-08-07T16:00:00.000Z');
    expect(ventas.porId(v.id)?.firma_subida_en).toBe('2026-08-07T16:00:00.000Z');
    expect(gastos.porId(g.id)?.foto_subida_en).toBeNull();
  });

  it('un 404 es definitivo solo para la firma; un 409 no (Review Focus 5)', () => {
    const { gastos, ventas, fuente } = montarConVentas();
    const v = ventaFirmada(ventas);
    ventas.marcarSincronizada(v.id);
    const g = gastos.registrar({
      vendedorId: 'ven-1',
      campoEgresoId: 'ce-gasolina',
      montoCentavos: 8000,
      comentario: null,
      fotoUri: 'file:///cache/ticket.jpg',
    });
    gastos.marcarSincronizada(g.id);
    fuente.pendientes();

    expect(fuente.fallaDefinitiva?.(v.id, 404)).toBe(true);
    expect(fuente.fallaDefinitiva?.(v.id, 409)).toBe(false);
    expect(fuente.fallaDefinitiva?.(g.id, 404)).toBe(false);
  });

  it('descartar la firma la saca de la cola sin tocar la venta', () => {
    const { ventas, fuente } = montarConVentas();
    const v = ventaFirmada(ventas);
    ventas.marcarSincronizada(v.id);
    fuente.pendientes();
    fuente.descartar(v.id, 'Esa venta ya no existe.');
    expect(fuente.pendientes()).toEqual([]);
    expect(ventas.porId(v.id)).toMatchObject({ firma_descartada: 1, sync_estado: 'sincronizado' });
  });
});
