import { CORTE_DE_PRUEBA, depsDePrueba, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioCortes } from '@/datos/repositorios/cortes';
import { crearRepositorioJornadas } from '@/datos/repositorios/jornadas';

import { fuenteCortes } from './fuente-cortes';

function montar() {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  const cortes = crearRepositorioCortes(deps);
  const jornadas = crearRepositorioJornadas(deps);
  return { cortes, jornadas, fuente: fuenteCortes(cortes) };
}

describe('fuente de cortes (rediseño pieza 6)', () => {
  it('sin corte enviado no hay nada que subir; un borrador no sale', () => {
    const { cortes, jornadas, fuente } = montar();
    expect(fuente.tipo).toBe('corte');
    const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    cortes.guardarBorrador(jornada.id, { efectivoTraidoCentavos: 100 });
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma la operacion: clave = id, dia de la jornada, sin folio ni cliente, datos del contrato', () => {
    const { jornadas, fuente } = montar();
    const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    const { corte } = jornadas.cerrarConCorte(jornada.id, 150, CORTE_DE_PRUEBA);

    const [op] = fuente.pendientes();
    expect(op).toEqual({
      clave: corte.id,
      tipo: 'corte',
      fecha_operacion: '2026-08-07',
      ocurrido_en: MOMENTO,
      datos: {
        efectivo: { esperado_centavos: 75000, traido_centavos: 75000 },
        notas: [{ folio: 'TJ260807AP01', traida: true, saldo_centavos: 30000 }],
        inventario: [{ presentacion_id: 'pre-1', sistema: 12, contado: 12 }],
        merma: { sistema: 2, contado: 2 },
        enviado_en: MOMENTO,
      },
    });
    expect(op).not.toHaveProperty('folio');
    expect(op).not.toHaveProperty('cliente_id');
  });

  it('una nota no palomeada va traida: false; lo no capturado sube como 0 y lo contado fuera del sistema con sistema 0', () => {
    const { jornadas, fuente } = montar();
    const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrarConCorte(jornada.id, 150, {
      ...CORTE_DE_PRUEBA,
      captura: {
        efectivoTraidoCentavos: null,
        notasTraidas: [],
        inventarioContado: { 'pre-9': 3 },
        mermaContada: null,
        cerrados: ['efectivo', 'notas', 'inventario'],
      },
    });

    const [op] = fuente.pendientes();
    expect(op?.datos).toEqual({
      efectivo: { esperado_centavos: 75000, traido_centavos: 0 },
      notas: [{ folio: 'TJ260807AP01', traida: false, saldo_centavos: 30000 }],
      inventario: [
        { presentacion_id: 'pre-1', sistema: 12, contado: 0 },
        { presentacion_id: 'pre-9', sistema: 0, contado: 3 },
      ],
      merma: { sistema: 2, contado: 0 },
      enviado_en: MOMENTO,
    });
  });

  it('un saldo negativo ya guardado sube como 0', () => {
    const { jornadas, fuente } = montar();
    const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrarConCorte(jornada.id, 150, {
      ...CORTE_DE_PRUEBA,
      sistema: {
        ...CORTE_DE_PRUEBA.sistema,
        notas: CORTE_DE_PRUEBA.sistema.notas.map((n) => ({ ...n, saldoCentavos: -500 })),
      },
    });
    expect(fuente.pendientes()[0]?.datos).toMatchObject({
      notas: [{ folio: 'TJ260807AP01', traida: true, saldo_centavos: 0 }],
    });
  });

  it('marca sincronizado y error sobre el repositorio de cortes', () => {
    const { jornadas, cortes, fuente } = montar();
    const jornada = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    const { corte } = jornadas.cerrarConCorte(jornada.id, 150, CORTE_DE_PRUEBA);

    fuente.marcarError(corte.id, 'corte-duplicado: ya hay otro');
    expect(cortes.pendientesDeSincronizar()[0]).toMatchObject({
      syncEstado: 'error',
      syncError: 'corte-duplicado: ya hay otro',
    });
    fuente.marcarSincronizada(corte.id);
    expect(fuente.pendientes()).toEqual([]);
  });
});
