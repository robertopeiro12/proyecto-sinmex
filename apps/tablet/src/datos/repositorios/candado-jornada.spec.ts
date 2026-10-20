import { depsDePrueba, FIRMA_DE_PRUEBA, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { relojFijo } from '../reloj';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioCobranzas, type DatosRegistroCobranza } from './cobranzas';
import type { DepsRepositorio } from './deps';
import { crearRepositorioFolios } from './folios';
import {
  crearRepositorioJornadas,
  ErrorJornada,
  exigirJornadaAbierta,
  MENSAJE_DIA_CERRADO,
} from './jornadas';
import { crearRepositorioProspectos, type DatosRegistroProspecto } from './prospectos';
import { crearRepositorioVentas, type DatosRegistroVenta } from './ventas';

/**
 * T-38, D6 capa 3: cerrar el dia cierra las operaciones en la CAPA DE DATOS.
 *
 * Es el candado que vale aunque alguien llegue a una pantalla de captura por
 * una ruta profunda: la confirmacion y el menu deshabilitado (capas 1 y 2) son
 * de la interfaz y se pueden saltar; esto no.
 */

function montar(deps: DepsRepositorio = depsDePrueba()) {
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const folios = crearRepositorioFolios(deps);
  return {
    deps,
    jornadas: crearRepositorioJornadas(deps),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    cobranzas: crearRepositorioCobranzas(deps, { catalogos }),
    prospectos: crearRepositorioProspectos(deps, { catalogos }),
  };
}

const venta: DatosRegistroVenta = {
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  numNota: '1234',
  contadoCredito: 'credito',
  factura: 'N/A',
  comentarios: null,
  lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
  firma: FIRMA_DE_PRUEBA,
};

const cobro: DatosRegistroCobranza = {
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  ventaNotaId: 'nota-1',
  montoCentavos: 5000,
  metodoPago: 'efectivo',
  fechaPago: '2026-08-07',
};

const prospecto: DatosRegistroProspecto = {
  vendedorId: 'ven-1',
  sucursalId: 'suc-tj',
  nombre: 'Tacos Aaron',
  telefono: '6641112233',
  encargado: 'Don Aaron',
  tipoNegocioId: null,
  comentarios: null,
  lat: null,
  lng: null,
};

const cuantas = (
  deps: DepsRepositorio,
  tabla: 'venta' | 'cobranza' | 'prospecto' | 'folio_emitido',
) => deps.bd.getFirstSync<{ n: number }>(`select count(*) as n from ${tabla}`)?.n;

/** Abre y cierra el dia de hoy de `ven-1`. */
function cerrarElDia(jornadas: ReturnType<typeof crearRepositorioJornadas>) {
  const j = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });
  jornadas.cerrar(j.id, 180);
}

describe('candado del dia cerrado (T-38, D6 capa 3)', () => {
  it('con la jornada abierta se registra venta, cobranza y prospecto', () => {
    const m = montar();
    m.jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });

    expect(() => m.ventas.registrar(venta)).not.toThrow();
    expect(() => m.cobranzas.registrar(cobro)).not.toThrow();
    expect(() => m.prospectos.registrar(prospecto)).not.toThrow();
  });

  it('sin jornada no bloquea: el guardia de navegacion ya exige abrir el dia', () => {
    const m = montar();

    expect(() => m.ventas.registrar(venta)).not.toThrow();
    expect(() => m.cobranzas.registrar(cobro)).not.toThrow();
    expect(() => m.prospectos.registrar(prospecto)).not.toThrow();
  });

  it('con el dia cerrado, una venta lanza ErrorJornada y no graba ni quema folio', () => {
    const m = montar();
    cerrarElDia(m.jornadas);

    expect(() => m.ventas.registrar(venta)).toThrow(ErrorJornada);
    expect(() => m.ventas.registrar(venta)).toThrow(MENSAJE_DIA_CERRADO);
    expect(cuantas(m.deps, 'venta')).toBe(0);
    expect(cuantas(m.deps, 'folio_emitido')).toBe(0);
  });

  it('con el dia cerrado, una cobranza lanza ErrorJornada y no graba', () => {
    const m = montar();
    cerrarElDia(m.jornadas);

    expect(() => m.cobranzas.registrar(cobro)).toThrow(MENSAJE_DIA_CERRADO);
    expect(cuantas(m.deps, 'cobranza')).toBe(0);
  });

  it('con el dia cerrado, un prospecto lanza ErrorJornada y no graba', () => {
    const m = montar();
    cerrarElDia(m.jornadas);

    expect(() => m.prospectos.registrar(prospecto)).toThrow(MENSAJE_DIA_CERRADO);
    expect(cuantas(m.deps, 'prospecto')).toBe(0);
  });

  it('el candado gana a las demas validaciones: el vendedor ve el motivo real', () => {
    const m = montar();
    cerrarElDia(m.jornadas);

    // Un cliente que no existe daria "ya no está en el catálogo"; con el dia
    // cerrado, lo que el vendedor tiene que leer es que el dia esta cerrado.
    expect(() => m.ventas.registrar({ ...venta, clienteId: 'cli-fantasma' })).toThrow(
      MENSAJE_DIA_CERRADO,
    );
  });

  it('la jornada cerrada de AYER no bloquea hoy', () => {
    const ayer = montar(depsDePrueba('2026-08-06T15:00:00.000Z'));
    cerrarElDia(ayer.jornadas);

    // Misma base, reloj de hoy (MOMENTO = 2026-08-07).
    const hoy = montar({ ...ayer.deps, reloj: relojFijo(MOMENTO) });

    expect(() => hoy.ventas.registrar(venta)).not.toThrow();
  });

  it('la jornada cerrada de OTRO vendedor no bloquea a este', () => {
    const m = montar();
    const ajena = m.jornadas.abrir({ vendedorId: 'ven-2', vehiculoId: 'veh-1', kmInicial: 5 });
    m.jornadas.cerrar(ajena.id, 9);

    expect(() => exigirJornadaAbierta(m.deps, 'ven-1')).not.toThrow();
    expect(() => exigirJornadaAbierta(m.deps, 'ven-2')).toThrow(ErrorJornada);
  });
});
