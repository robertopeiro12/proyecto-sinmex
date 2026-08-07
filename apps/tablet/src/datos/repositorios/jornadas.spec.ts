import { depsDePrueba, snapshotDePrueba, MOMENTO } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioJornadas, ErrorJornada } from './jornadas';

function conJornadas(momento: string = MOMENTO) {
  const deps = depsDePrueba(momento);
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return { deps, jornadas: crearRepositorioJornadas(deps) };
}

describe('repositorio de jornadas', () => {
  describe('abrir el dia', () => {
    it('registra vehiculo y kilometraje inicial', () => {
      const { jornadas } = conJornadas();
      const jornada = jornadas.abrir({
        vendedorId: 'ven-1',
        vehiculoId: 'veh-1',
        kmInicial: 12_345.5,
      });

      expect(jornada).toMatchObject({
        fecha: '2026-08-07',
        vendedor_id: 'ven-1',
        vehiculo_id: 'veh-1',
        km_inicial: 12_345.5,
        km_final: null,
        estado: 'abierta',
        sync_estado: 'pendiente',
        actualizado_local_en: MOMENTO,
        sincronizado_en: null,
      });
    });

    it('antes de abrir, no hay jornada de hoy (es lo que bloquea la operacion)', () => {
      const { jornadas } = conJornadas();
      expect(jornadas.deHoy('ven-1')).toBeNull();
    });

    it('despues de abrir, deHoy la encuentra', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
      expect(jornadas.deHoy('ven-1')?.id).toBe(abierta.id);
    });

    it('no deja abrir dos veces el mismo dia', () => {
      const { jornadas } = conJornadas();
      jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      expect(() =>
        jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 999 }),
      ).toThrow(ErrorJornada);
      expect(jornadas.deHoy('ven-1')?.km_inicial).toBe(10);
    });

    it('rechaza un kilometraje inicial negativo o no numerico', () => {
      const { jornadas } = conJornadas();
      expect(() =>
        jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: -1 }),
      ).toThrow(ErrorJornada);
      expect(() =>
        jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: Number.NaN }),
      ).toThrow(ErrorJornada);
      expect(jornadas.deHoy('ven-1')).toBeNull();
    });

    it('la jornada de ayer no cuenta como la de hoy', () => {
      const ayer = conJornadas('2026-08-06T15:00:00.000Z');
      ayer.jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      // Misma base, reloj de hoy.
      const hoy = crearRepositorioJornadas({
        ...ayer.deps,
        reloj: { ahora: () => MOMENTO, hoy: () => '2026-08-07' },
      });
      expect(hoy.deHoy('ven-1')).toBeNull();
      expect(() =>
        hoy.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 40 }),
      ).not.toThrow();
    });

    it('no acepta un vehiculo que no existe en el catalogo', () => {
      const { jornadas } = conJornadas();
      expect(() =>
        jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-fantasma', kmInicial: 10 }),
      ).toThrow();
    });
  });

  describe('cerrar el dia', () => {
    it('registra el kilometraje final y marca la jornada cerrada', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });

      const cerrada = jornadas.cerrar(abierta.id, 260.5);
      expect(cerrada).toMatchObject({
        km_final: 260.5,
        estado: 'cerrada',
        cerrada_en: MOMENTO,
        sync_estado: 'pendiente',
      });
    });

    it('no acepta un kilometraje final menor al inicial', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });

      expect(() => jornadas.cerrar(abierta.id, 99)).toThrow(/no puede ser menor al inicial/);
      expect(jornadas.porId(abierta.id)?.estado).toBe('abierta');
    });

    it('acepta cerrar con el mismo kilometraje (el vehiculo no se movio)', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });
      expect(jornadas.cerrar(abierta.id, 100).km_final).toBe(100);
    });

    it('no deja cerrar dos veces', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });
      jornadas.cerrar(abierta.id, 200);

      expect(() => jornadas.cerrar(abierta.id, 300)).toThrow(/ya esta cerrada/);
      expect(jornadas.porId(abierta.id)?.km_final).toBe(200);
    });

    it('falla si la jornada no existe', () => {
      const { jornadas } = conJornadas();
      expect(() => jornadas.cerrar('no-existe', 10)).toThrow(ErrorJornada);
    });
  });

  describe('cola de sincronizacion', () => {
    it('lo capturado nace pendiente de subir', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      expect(jornadas.pendientesDeSincronizar().map((j) => j.id)).toEqual([abierta.id]);
    });

    it('marcarSincronizada la saca de la cola y sella el momento', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      jornadas.marcarSincronizada(abierta.id);

      expect(jornadas.pendientesDeSincronizar()).toEqual([]);
      expect(jornadas.porId(abierta.id)).toMatchObject({
        sync_estado: 'sincronizado',
        sincronizado_en: MOMENTO,
      });
    });

    it('cerrar el dia vuelve a marcar la jornada como pendiente de subir', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
      jornadas.marcarSincronizada(abierta.id);

      jornadas.cerrar(abierta.id, 80);

      expect(jornadas.pendientesDeSincronizar().map((j) => j.id)).toEqual([abierta.id]);
    });
  });
});
