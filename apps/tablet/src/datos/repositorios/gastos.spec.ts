import { depsDePrueba, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import {
  crearRepositorioGastos,
  ErrorGasto,
  MAX_MONTO_GASTO_CENTAVOS,
  type DatosRegistroGasto,
} from './gastos';
import { crearRepositorioJornadas, ErrorJornada } from './jornadas';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  return {
    deps,
    catalogos,
    jornadas: crearRepositorioJornadas(deps),
    gastos: crearRepositorioGastos(deps, { catalogos }),
  };
}

const captura = (cambios: Partial<DatosRegistroGasto> = {}): DatosRegistroGasto => ({
  vendedorId: 'ven-1',
  campoEgresoId: 'ce-gasolina',
  montoCentavos: 25050,
  comentario: null,
  fotoUri: 'file:///cache/ticket.jpg',
  ...cambios,
});

describe('repositorio de gastos (T-30/T-31, D8)', () => {
  it('registra el gasto pendiente de subir, con el dia, la hora, la sucursal y el nombre del campo', () => {
    const { gastos } = montar();
    const g = gastos.registrar(captura({ comentario: '  Pemex de la 5 ' }));
    expect(g).toMatchObject({
      fecha: '2026-08-07',
      vendedor_id: 'ven-1',
      sucursal_id: 'suc-tj',
      campo_egreso_id: 'ce-gasolina',
      campo_nombre: 'Gasolina',
      monto_centavos: 25050,
      comentario: 'Pemex de la 5',
      registrado_en: MOMENTO,
      foto_local: 'file:///cache/ticket.jpg',
      foto_subida_en: null,
      foto_descartada: 0,
      sync_estado: 'pendiente',
      sync_error: null,
    });
  });

  it('un comentario en blanco se guarda como null; uno de mas de 200 no se guarda', () => {
    const { gastos } = montar();
    expect(gastos.registrar(captura({ comentario: '   ' })).comentario).toBeNull();
    expect(gastos.registrar(captura({ comentario: 'x'.repeat(200) })).comentario).toHaveLength(200);
    expect(() => gastos.registrar(captura({ comentario: 'x'.repeat(201) }))).toThrow(ErrorGasto);
  });

  it('el monto es un entero de centavos mayor que 0 y dentro del tope', () => {
    const { gastos } = montar();
    expect(() => gastos.registrar(captura({ montoCentavos: 0 }))).toThrow(ErrorGasto);
    expect(() => gastos.registrar(captura({ montoCentavos: -500 }))).toThrow(ErrorGasto);
    expect(() => gastos.registrar(captura({ montoCentavos: 12.5 }))).toThrow(ErrorGasto);
    expect(() => gastos.registrar(captura({ montoCentavos: MAX_MONTO_GASTO_CENTAVOS + 1 }))).toThrow(ErrorGasto);
    expect(gastos.registrar(captura({ montoCentavos: MAX_MONTO_GASTO_CENTAVOS })).monto_centavos).toBe(
      MAX_MONTO_GASTO_CENTAVOS,
    );
  });

  it('un campo que el pull dio de baja o le quito la casilla con el formulario abierto SI se guarda (Review Focus)', () => {
    const { gastos, catalogos } = montar();
    // El vendedor eligio Hielo y Gasolina; mientras escribia el monto, el pull
    // le quito la casilla a Hielo y dio de baja Gasolina.
    catalogos.guardarSnapshot({
      camposEgreso: [
        { id: 'ce-hielo', nombre: 'Hielo', tipo: 'operacion', se_usa_en_app: 0, activo: 1 },
        { id: 'ce-gasolina', nombre: 'Gasolina', tipo: 'operacion', se_usa_en_app: 1, activo: 0 },
      ],
    });
    expect(gastos.registrar(captura({ campoEgresoId: 'ce-hielo' })).campo_nombre).toBe('Hielo');
    expect(gastos.registrar(captura({ campoEgresoId: 'ce-gasolina' })).campo_nombre).toBe('Gasolina');
    expect(gastos.registrar(captura({ campoEgresoId: 'ce-baja' })).campo_nombre).toBe('Celular');
  });

  it('un campo que la tablet no conoce no se guarda', () => {
    const { gastos } = montar();
    expect(() => gastos.registrar(captura({ campoEgresoId: 'no-existe' }))).toThrow(ErrorGasto);
  });

  it('con el dia cerrado no se registra (T-38) y no deja fila', () => {
    const { gastos, jornadas } = montar();
    const j = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(j.id, 20);
    expect(() => gastos.registrar(captura())).toThrow(ErrorJornada);
    expect(gastos.delDia('ven-1')).toEqual([]);
  });

  it('delDia trae los gastos del vendedor de ese dia en orden de captura', () => {
    const { gastos } = montar();
    const a = gastos.registrar(captura());
    const b = gastos.registrar(captura({ campoEgresoId: 'ce-hielo', montoCentavos: 8000 }));
    expect(gastos.delDia('ven-1').map((g) => g.id)).toEqual([a.id, b.id]);
    expect(gastos.delDia('ven-1', '2026-08-06')).toEqual([]);
    expect(gastos.delDia('ven-2')).toEqual([]);
  });

  it('totalDelDia suma TODOS los gastos del dia, subidos, por subir o rechazados (el efectivo ya salio)', () => {
    const { gastos } = montar();
    expect(gastos.totalDelDia('ven-1')).toBe(0);
    const a = gastos.registrar(captura({ montoCentavos: 25050 }));
    const b = gastos.registrar(captura({ campoEgresoId: 'ce-hielo', montoCentavos: 8000 }));
    gastos.registrar(captura({ montoCentavos: 1 }));
    gastos.marcarSincronizada(a.id);
    gastos.marcarError(b.id, 'campo-egreso-inexistente: El campo no existe.');
    expect(gastos.totalDelDia('ven-1')).toBe(33051);
    expect(gastos.totalDelDia('ven-1', '2026-08-06')).toBe(0);
  });

  it('la cola del push incluye los rechazados y saca los sincronizados', () => {
    const { gastos } = montar();
    const a = gastos.registrar(captura());
    const b = gastos.registrar(captura());
    gastos.marcarSincronizada(a.id);
    gastos.marcarError(b.id, 'gasto-id-ocupado: El id de este gasto ya está ocupado.');
    expect(gastos.pendientesDeSincronizar().map((g) => g.id)).toEqual([b.id]);
    expect(gastos.porId(b.id)).toMatchObject({
      sync_estado: 'error',
      sync_error: 'gasto-id-ocupado: El id de este gasto ya está ocupado.',
    });
    expect(gastos.porId(a.id)).toMatchObject({ sync_estado: 'sincronizado', sync_error: null, sincronizado_en: MOMENTO });
  });

  it('la foto solo se ofrece con el gasto ya sincronizado, y su fallo no toca sync_estado', () => {
    const { gastos } = montar();
    const g = gastos.registrar(captura());
    gastos.registrar(captura({ fotoUri: null }));
    expect(gastos.pendientesDeSubirFoto()).toEqual([]);
    gastos.marcarSincronizada(g.id);
    expect(gastos.pendientesDeSubirFoto().map((x) => x.id)).toEqual([g.id]);

    gastos.anotarErrorFoto(g.id, 'sin red');
    expect(gastos.porId(g.id)).toMatchObject({ sync_estado: 'sincronizado', foto_error: 'sin red' });
    gastos.marcarFotoSubida(g.id, '2026-08-07T16:00:00.000Z');
    expect(gastos.porId(g.id)).toMatchObject({ foto_subida_en: '2026-08-07T16:00:00.000Z', foto_error: null });
    expect(gastos.pendientesDeSubirFoto()).toEqual([]);
  });

  it('una foto descartada deja de ofrecerse y conserva la ruta local', () => {
    const { gastos } = montar();
    const g = gastos.registrar(captura());
    gastos.marcarSincronizada(g.id);
    gastos.descartarFoto(g.id, 'La foto pesa demasiado');
    expect(gastos.pendientesDeSubirFoto()).toEqual([]);
    expect(gastos.porId(g.id)).toMatchObject({ foto_descartada: 1, foto_local: 'file:///cache/ticket.jpg' });
  });

  it('grabar publica el cambio para que la lista se relea', () => {
    const { gastos, catalogos } = montar();
    const antes = catalogos.version();
    gastos.registrar(captura());
    expect(catalogos.version()).toBeGreaterThan(antes);
  });
});
