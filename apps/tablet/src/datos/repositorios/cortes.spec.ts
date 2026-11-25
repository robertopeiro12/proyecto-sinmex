import { efectivoEsperado, inventarioDelCorte, notasDelCorte } from '@/estado/corte';

import { CORTE_DE_PRUEBA, depsDePrueba, snapshotDePrueba, MOMENTO, SISTEMA_DE_PRUEBA } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioCortes, ErrorCorte, type SistemaCorte } from './cortes';
import { crearRepositorioJornadas } from './jornadas';

function conCortes(momento: string = MOMENTO) {
  const deps = depsDePrueba(momento);
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  const jornadas = crearRepositorioJornadas(deps);
  const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });
  return { deps, jornadas, jornada, cortes: crearRepositorioCortes(deps) };
}

describe('repositorio de cortes', () => {
  it('lo que calculan las reglas del corte (Task 1) cabe tal cual en SistemaCorte', () => {
    // Prueba de tipos: si las reglas cambian de forma, tsc truena aqui.
    const sistema: SistemaCorte = {
      efectivo: efectivoEsperado({ ventas: [], cobros: [], gastos: [] }),
      notas: notasDelCorte({ asignadas: [], queTrae: [], cobros: [], nombres: new Map() }),
      inventario: inventarioDelCorte([]),
    };
    expect(sistema.notas).toEqual([]);
  });

  describe('borrador', () => {
    it('sin nada capturado no hay borrador', () => {
      const { cortes, jornada } = conCortes();
      expect(cortes.borrador(jornada.id)).toBeNull();
      expect(cortes.deHoy('ven-1')).toBeNull();
    });

    it('se conserva entre lecturas y entre instancias del repositorio', () => {
      const { deps, cortes, jornada } = conCortes();
      cortes.guardarBorrador(jornada.id, {
        efectivoTraidoCentavos: 12345,
        cerrados: ['efectivo'],
        huellas: { efectivo: '75000' },
      });

      const otra = crearRepositorioCortes(deps);
      expect(otra.borrador(jornada.id)).toEqual({
        id: 'id-2',
        jornadaId: jornada.id,
        efectivoTraidoCentavos: 12345,
        notasTraidas: [],
        inventarioContado: {},
        mermaContada: null,
        cerrados: ['efectivo'],
        huellas: { efectivo: '75000' },
      });
      expect(otra.borrador(jornada.id)).toEqual(cortes.borrador(jornada.id));
    });

    it('guardar otra vez solo cambia lo que se manda, y conserva el id', () => {
      const { cortes, jornada } = conCortes();
      cortes.guardarBorrador(jornada.id, { efectivoTraidoCentavos: 100, notasTraidas: ['nota:A'] });
      cortes.guardarBorrador(jornada.id, { inventarioContado: { 'pre-1': 3 }, mermaContada: 1 });
      cortes.guardarBorrador(jornada.id, { efectivoTraidoCentavos: null });

      expect(cortes.borrador(jornada.id)).toEqual({
        id: 'id-2',
        jornadaId: jornada.id,
        efectivoTraidoCentavos: null,
        notasTraidas: ['nota:A'],
        inventarioContado: { 'pre-1': 3 },
        mermaContada: 1,
        cerrados: [],
        huellas: {},
      });
    });

    it('copia la fecha y el vendedor de la jornada, no del reloj', () => {
      const ayer = conCortes('2026-08-06T15:00:00.000Z');
      const hoy = crearRepositorioCortes({
        ...ayer.deps,
        reloj: { ahora: () => MOMENTO, hoy: () => '2026-08-07' },
      });
      hoy.guardarBorrador(ayer.jornada.id, { mermaContada: 0 });

      expect(
        ayer.deps.bd.getFirstSync('select fecha, vendedor_id from corte'),
      ).toEqual({ fecha: '2026-08-06', vendedor_id: 'ven-1' });
      expect(hoy.deHoy('ven-1')).toBeNull();
    });

    it('deHoy regresa el borrador de hoy, sin sistema y sin enviar', () => {
      const { cortes, jornada } = conCortes();
      cortes.guardarBorrador(jornada.id, { cerrados: ['notas'] });
      expect(cortes.deHoy('ven-1')).toMatchObject({
        jornadaId: jornada.id,
        fecha: '2026-08-07',
        vendedorId: 'ven-1',
        enviadoEn: null,
        sistema: null,
        captura: { cerrados: ['notas'] },
      });
    });

    it('quita repetidos de los apartados cerrados y de las notas traidas', () => {
      const { cortes, jornada } = conCortes();
      cortes.guardarBorrador(jornada.id, {
        cerrados: ['notas', 'notas', 'efectivo'],
        notasTraidas: ['nota:A', 'nota:A'],
      });
      expect(cortes.borrador(jornada.id)).toMatchObject({
        cerrados: ['notas', 'efectivo'],
        notasTraidas: ['nota:A'],
      });
    });

    it('rechaza cantidades que no son enteros mayores o iguales a cero', () => {
      const { cortes, jornada } = conCortes();
      expect(() => cortes.guardarBorrador(jornada.id, { efectivoTraidoCentavos: -1 })).toThrow(ErrorCorte);
      expect(() => cortes.guardarBorrador(jornada.id, { efectivoTraidoCentavos: 1.5 })).toThrow(ErrorCorte);
      expect(() => cortes.guardarBorrador(jornada.id, { mermaContada: Number.NaN })).toThrow(ErrorCorte);
      expect(() => cortes.guardarBorrador(jornada.id, { inventarioContado: { 'pre-1': -2 } })).toThrow(
        ErrorCorte,
      );
      expect(() =>
        cortes.guardarBorrador(jornada.id, { cerrados: ['otro' as never] }),
      ).toThrow(ErrorCorte);
      expect(cortes.borrador(jornada.id)).toBeNull();
    });

    it('sin jornada, o con el dia ya cerrado, no hay borrador que guardar', () => {
      const { cortes, jornadas, jornada } = conCortes();
      expect(() => cortes.guardarBorrador('no-existe', { mermaContada: 0 })).toThrow(ErrorCorte);
      jornadas.cerrar(jornada.id, 150);
      expect(() => cortes.guardarBorrador(jornada.id, { mermaContada: 0 })).toThrow(ErrorCorte);
    });

    it('lee con tolerancia un JSON roto (como leerReparto)', () => {
      const { deps, cortes, jornada } = conCortes();
      cortes.guardarBorrador(jornada.id, { mermaContada: 4 });
      deps.bd.runSync(`update corte set efectivo_json = 'no es json', cerrados_json = '{"a":1}'`);
      expect(cortes.borrador(jornada.id)).toMatchObject({
        efectivoTraidoCentavos: null,
        mermaContada: 4,
        cerrados: [],
      });
    });
  });

  describe('enviado (cerrarConCorte) y sincronizacion', () => {
    it('ya enviado, deja de ser borrador y no se puede cambiar', () => {
      const { cortes, jornadas, jornada } = conCortes();
      jornadas.cerrarConCorte(jornada.id, 150, CORTE_DE_PRUEBA);

      expect(cortes.borrador(jornada.id)).toBeNull();
      expect(() => cortes.guardarBorrador(jornada.id, { mermaContada: 9 })).toThrow(ErrorCorte);
      expect(cortes.deHoy('ven-1')).toMatchObject({
        enviadoEn: MOMENTO,
        captura: CORTE_DE_PRUEBA.captura,
        sistema: SISTEMA_DE_PRUEBA,
        syncEstado: 'pendiente',
      });
    });

    it('un borrador no sale a subir; el enviado si', () => {
      const { cortes, jornadas, jornada } = conCortes();
      cortes.guardarBorrador(jornada.id, { mermaContada: 1 });
      expect(cortes.pendientesDeSincronizar()).toEqual([]);

      jornadas.cerrarConCorte(jornada.id, 150, CORTE_DE_PRUEBA);
      expect(cortes.pendientesDeSincronizar().map((c) => c.jornadaId)).toEqual([jornada.id]);
    });

    it('un enviado con el JSON roto no sale a subir (no hay corte que mandar)', () => {
      const { deps, cortes, jornadas, jornada } = conCortes();
      jornadas.cerrarConCorte(jornada.id, 150, CORTE_DE_PRUEBA);
      deps.bd.runSync(`update corte set notas_json = 'no es json'`);
      expect(cortes.pendientesDeSincronizar()).toEqual([]);
    });

    it('marcarError lo deja en la cola con su motivo; marcarSincronizada lo saca y limpia el motivo', () => {
      const { cortes, jornadas, jornada } = conCortes();
      const { corte } = jornadas.cerrarConCorte(jornada.id, 150, CORTE_DE_PRUEBA);

      cortes.marcarError(corte.id, 'datos-invalidos: x');
      expect(cortes.pendientesDeSincronizar()).toEqual([
        expect.objectContaining({ id: corte.id, syncEstado: 'error', syncError: 'datos-invalidos: x' }),
      ]);

      cortes.marcarSincronizada(corte.id);
      expect(cortes.pendientesDeSincronizar()).toEqual([]);
      expect(cortes.deHoy('ven-1')).toMatchObject({
        syncEstado: 'sincronizado',
        syncError: null,
        sincronizadoEn: MOMENTO,
      });
    });
  });
});
