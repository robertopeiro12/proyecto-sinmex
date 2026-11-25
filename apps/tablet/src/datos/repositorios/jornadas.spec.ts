import { CORTE_DE_PRUEBA, depsDePrueba, snapshotDePrueba, MOMENTO } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioCortes, ErrorCorte } from './cortes';
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

  describe('cerrar el dia con el corte (rediseño pieza 6)', () => {
    function abierta() {
      const { deps, jornadas } = conJornadas();
      const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });
      return { deps, jornadas, jornada, cortes: crearRepositorioCortes(deps) };
    }

    it('con km valido guarda el corte enviado y cierra la jornada', () => {
      const { jornadas, jornada, cortes } = abierta();
      const { jornada: cerrada, corte } = jornadas.cerrarConCorte(jornada.id, 150, CORTE_DE_PRUEBA);

      expect(cerrada).toMatchObject({ estado: 'cerrada', km_final: 150, cerrada_en: MOMENTO });
      expect(jornadas.porId(jornada.id)?.estado).toBe('cerrada');
      expect(corte).toMatchObject({ jornadaId: jornada.id, enviadoEn: MOMENTO, captura: CORTE_DE_PRUEBA.captura });
      expect(cortes.deHoy('ven-1')).toEqual(corte);
    });

    it('reutiliza el borrador (mismo id) y lo vuelve enviado', () => {
      const { jornadas, jornada, cortes } = abierta();
      const borrador = cortes.guardarBorrador(jornada.id, { efectivoTraidoCentavos: 1 });
      const { corte } = jornadas.cerrarConCorte(jornada.id, 150, CORTE_DE_PRUEBA);
      expect(corte.id).toBe(borrador.id);
      expect(corte.captura.efectivoTraidoCentavos).toBe(75000);
    });

    it('con km invalido no guarda el corte ni cierra el dia, y el borrador sigue intacto', () => {
      const { deps, jornadas, jornada, cortes } = abierta();
      cortes.guardarBorrador(jornada.id, { mermaContada: 3, cerrados: ['efectivo'] });
      const antes = cortes.borrador(jornada.id);

      expect(() => jornadas.cerrarConCorte(jornada.id, 99, CORTE_DE_PRUEBA)).toThrow(ErrorJornada);
      expect(() => jornadas.cerrarConCorte(jornada.id, Number.NaN, CORTE_DE_PRUEBA)).toThrow(ErrorJornada);

      expect(jornadas.porId(jornada.id)).toMatchObject({ estado: 'abierta', km_final: null });
      expect(cortes.borrador(jornada.id)).toEqual(antes);
      expect(deps.bd.getFirstSync('select enviado_en from corte')).toEqual({ enviado_en: null });
    });

    it('sin un corte nuevo no hay jornada: sin corte previo, no queda fila', () => {
      const { deps, jornadas, jornada } = abierta();
      expect(() => jornadas.cerrarConCorte(jornada.id, 99, CORTE_DE_PRUEBA)).toThrow(ErrorJornada);
      expect(deps.bd.getFirstSync('select count(*) as n from corte')).toEqual({ n: 0 });
    });

    it('si guardar el corte falla despues de cerrar, se deshace tambien el cierre', () => {
      const { deps, jornadas, jornada, cortes } = abierta();
      cortes.guardarBorrador(jornada.id, { mermaContada: 3 });
      deps.bd.execSync(`
        create trigger corte_falla before update on corte
        begin select raise(abort, 'falla simulada'); end;
      `);

      expect(() => jornadas.cerrarConCorte(jornada.id, 150, CORTE_DE_PRUEBA)).toThrow(/falla simulada/);
      expect(jornadas.porId(jornada.id)).toMatchObject({ estado: 'abierta', km_final: null, cerrada_en: null });
      expect(cortes.borrador(jornada.id)?.mermaContada).toBe(3);
    });

    it('exige los tres apartados cerrados y no cierra si falta uno', () => {
      const { jornadas, jornada, cortes } = abierta();
      expect(() =>
        jornadas.cerrarConCorte(jornada.id, 150, {
          ...CORTE_DE_PRUEBA,
          captura: { ...CORTE_DE_PRUEBA.captura, cerrados: ['efectivo', 'notas'] },
        }),
      ).toThrow(ErrorCorte);
      expect(jornadas.porId(jornada.id)?.estado).toBe('abierta');
      expect(cortes.deHoy('ven-1')).toBeNull();
    });

    it('una jornada ya cerrada no se vuelve a cerrar con corte', () => {
      const { jornadas, jornada, cortes } = abierta();
      jornadas.cerrar(jornada.id, 150);
      expect(() => jornadas.cerrarConCorte(jornada.id, 160, CORTE_DE_PRUEBA)).toThrow(/ya esta cerrada/);
      expect(cortes.deHoy('ven-1')).toBeNull();
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
    it('una jornada abierta NO esta en la cola: todavia no viaja (T-38, D7)', () => {
      // `fuente-jornadas.ts` solo sube las cerradas (el buzon es de solo
      // escritura hasta T-43). Contarla como pendiente dejaba la pantalla en
      // "1 registro por subir" todo el dia y "se subieron 0" al sincronizar.
      const { jornadas } = conJornadas();
      jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      expect(jornadas.pendientesDeSincronizar()).toEqual([]);
    });

    it('al cerrarla entra a la cola de subida', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });

      jornadas.cerrar(abierta.id, 80);

      expect(jornadas.pendientesDeSincronizar().map((j) => j.id)).toEqual([abierta.id]);
    });

    it('marcarSincronizada la saca de la cola y sella el momento', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
      jornadas.cerrar(abierta.id, 80);

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

    it('marcarError guarda el motivo y la deja para reintentar (T-07)', () => {
      // Sin el motivo, una fila en 'error' seria un callejon sin salida: nadie
      // sabria por que ni podria decirselo al vendedor. Y sigue en la cola
      // porque reintentar es seguro: el push es idempotente.
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
      // Solo una cerrada viaja, asi que solo una cerrada puede volver rechazada.
      jornadas.cerrar(abierta.id, 80);

      jornadas.marcarError(abierta.id, 'fecha-futura: revisa el reloj de la tablet.');

      expect(jornadas.porId(abierta.id)).toMatchObject({
        sync_estado: 'error',
        sync_error: 'fecha-futura: revisa el reloj de la tablet.',
      });
      expect(jornadas.pendientesDeSincronizar().map((j) => j.id)).toEqual([abierta.id]);
    });

    it('sincronizar despues de un error limpia el motivo', () => {
      const { jornadas } = conJornadas();
      const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
      jornadas.marcarError(abierta.id, 'algo salio mal');

      jornadas.marcarSincronizada(abierta.id);

      expect(jornadas.porId(abierta.id)).toMatchObject({
        sync_estado: 'sincronizado',
        sync_error: null,
      });
    });
  });
});
