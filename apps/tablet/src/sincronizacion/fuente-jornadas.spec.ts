import { depsDePrueba, snapshotDePrueba, MOMENTO } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioJornadas } from '@/datos/repositorios/jornadas';
import { relojFijo } from '@/datos/reloj';

import { fuenteJornadas } from './fuente-jornadas';

function montar(momento: string = MOMENTO) {
  const deps = depsDePrueba(momento);
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  const jornadas = crearRepositorioJornadas(deps);
  return { deps, jornadas, fuente: fuenteJornadas(jornadas) };
}

/**
 * El kilometraje del dia como operacion del push (T-38).
 *
 * El criterio del ticket no es "la pantalla pide el km": eso ya lo hacia T-04.
 * Es que **el km salga del equipo** para alimentar el reporte de Kilometraje del
 * portal. Entre la captura y el reporte hay un solo tramo que la tablet
 * controla, y es este: el sobre que arma la fuente. `motor.spec.ts` comprueba
 * que el sobre viaja y que una jornada abierta no viaja; lo que faltaba es
 * comprobar **que dentro van los dos kilometrajes**, que es lo que el reporte
 * necesita. Sin esto, un `km_final` mal escrito en `datos` pasaba typecheck
 * (`datos` es `Record<string, unknown>` en el contrato, §6) y la suite entera
 * seguia en verde con el reporte del portal vacio.
 */
describe('fuenteJornadas', () => {
  it('declara el tipo de operacion `jornada`', () => {
    expect(montar().fuente.tipo).toBe('jornada');
  });

  it('sin jornada abierta no manda nada', () => {
    expect(montar().fuente.pendientes()).toEqual([]);
  });

  /**
   * El sobre completo, campo por campo. Los dos kilometrajes van en `datos`
   * porque el contrato solo reserva sitio en el sobre para `cliente_id` y
   * `folio` (§6), y la jornada no lleva ninguno de los dos.
   */
  it('arma el sobre con el vehiculo y los dos kilometrajes', () => {
    const { deps, jornadas, fuente } = montar();
    const abierta = jornadas.abrir({
      vendedorId: 'ven-1',
      vehiculoId: 'veh-1',
      kmInicial: 128_450,
    });
    // Se cierra 8 h despues para que `cerrada_en` no coincida con `abierta_en`:
    // con el reloj fijo de `depsDePrueba` los dos momentos serian iguales y la
    // prueba no distinguiria cual de los dos viaja en `ocurrido_en`.
    const alCerrar = crearRepositorioJornadas({
      ...deps,
      reloj: relojFijo('2026-08-07T23:00:00.000Z'),
    });
    alCerrar.cerrar(abierta.id, 128_712.5);

    const ops = fuente.pendientes();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      // La clave de idempotencia es el `id` de la fila, generado al abrir el
      // dia: no cambia al cerrar, asi que reenviar el lote no puede duplicar la
      // jornada ni el kilometraje.
      clave: abierta.id,
      tipo: 'jornada',
      // Dia de trabajo con el reloj local de la tablet, no derivado de UTC: a
      // las 18:00 de Tijuana en UTC ya seria el 8 y la jornada se partiria en
      // dos. El `cerrada_en` de arriba es justo uno de esos momentos.
      fecha_operacion: '2026-08-07',
      // De los dos momentos de la jornada viaja el del **cierre**: es cuando el
      // hecho que se sube (el kilometraje del dia) quedo completo.
      ocurrido_en: '2026-08-07T23:00:00.000Z',
      datos: {
        vehiculo_id: 'veh-1',
        km_inicial: 128_450,
        km_final: 128_712.5,
        abierta_en: MOMENTO,
        cerrada_en: '2026-08-07T23:00:00.000Z',
      },
    });
  });

  /**
   * El km del dia = final - inicial es lo que alimenta el reporte, y lo deriva
   * **el servidor** con estos dos extremos: la tablet no manda el resultado.
   * Se comprueba aqui que los dos extremos llegan y que la resta da lo que la
   * pantalla de cierre le muestra al vendedor (`cerrar-dia.tsx`), para que el
   * reporte del portal no pueda decir otra cifra que la que el vendedor vio.
   */
  it('manda los dos extremos, no el km del dia ya restado', () => {
    const { jornadas, fuente } = montar();
    const abierta = jornadas.abrir({
      vendedorId: 'ven-1',
      vehiculoId: 'veh-1',
      kmInicial: 100,
    });
    jornadas.cerrar(abierta.id, 262.5);

    const datos = fuente.pendientes()[0]?.datos as {
      km_inicial: number;
      km_final: number;
    };
    expect(datos.km_final - datos.km_inicial).toBe(162.5);
  });

  /**
   * La jornada no es una nota que el cliente firme, asi que no consume un numero
   * del contador del dia (ADR-0001), y no se refiere a ningun cliente. Mandar un
   * folio aqui quemaria un numero del espacio global por nada.
   */
  it('no manda `cliente_id` ni `folio`', () => {
    const { jornadas, fuente } = montar();
    const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(abierta.id, 20);

    const [op] = fuente.pendientes();
    expect(op).toBeDefined();
    expect(op?.cliente_id).toBeUndefined();
    expect(op?.folio).toBeUndefined();
  });

  /**
   * > [!warning] El filtro que hace segura la idempotencia
   * > El buzon del servidor es de **solo escritura**: guarda una operacion una
   * > vez y un reenvio devuelve `duplicada` sin modificar nada. Subir la jornada
   * > al abrirla congelaria su `km_inicial` alla con `km_final: null`, y el km
   * > final **no llegaria nunca** — el reporte de Kilometraje quedaria vacio sin
   * > que nada fallara.
   * >
   * > `motor.spec.ts` lo comprueba de punta a punta; aqui se fija en la fuente,
   * > que es donde vive el filtro, para que quitarlo rompa la prueba del archivo
   * > que se esta editando.
   */
  it('NO manda una jornada abierta: solo tiene la mitad del kilometraje', () => {
    const { jornadas, fuente } = montar();
    const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });

    // Sigue en la cola del repositorio (es un dato sin subir, y lo estara toda
    // la jornada), pero la fuente no lo ofrece al push.
    expect(jornadas.pendientesDeSincronizar()).toHaveLength(1);
    expect(fuente.pendientes()).toEqual([]);

    // Y en cuanto se cierra, aparece. Es el mismo `id`: la jornada no se sube
    // dos veces, se sube una, cuando esta completa.
    jornadas.cerrar(abierta.id, 240);
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([abierta.id]);
  });

  /** La de ayer sin subir viaja con la de hoy, cada una con su propia fecha. */
  it('manda las jornadas cerradas de dias anteriores que quedaron sin subir', () => {
    const ayer = montar('2026-08-06T15:00:00.000Z');
    const deAyer = ayer.jornadas.abrir({
      vendedorId: 'ven-1',
      vehiculoId: 'veh-1',
      kmInicial: 10,
    });
    ayer.jornadas.cerrar(deAyer.id, 90);

    // Misma base, reloj de hoy: es lo que pasa cuando la tablet no vio WiFi.
    const hoy = crearRepositorioJornadas({ ...ayer.deps, reloj: relojFijo(MOMENTO) });
    const deHoy = hoy.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 90 });
    hoy.cerrar(deHoy.id, 210);

    expect(fuenteJornadas(hoy).pendientes().map((o) => [o.clave, o.fecha_operacion])).toEqual([
      [deAyer.id, '2026-08-06'],
      [deHoy.id, '2026-08-07'],
    ]);
  });

  it('marcarSincronizada y marcarError llegan al repositorio', () => {
    const { jornadas, fuente } = montar();
    const abierta = jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 10 });
    jornadas.cerrar(abierta.id, 80);

    fuente.marcarError(abierta.id, 'vehiculo-inexistente: el portal lo dio de baja');
    expect(jornadas.porId(abierta.id)).toMatchObject({
      sync_estado: 'error',
      sync_error: 'vehiculo-inexistente: el portal lo dio de baja',
    });
    // La rechazada sigue ofreciendose: el portal pudo reactivar el vehiculo, y
    // reintentar es seguro porque la clave no cambia.
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([abierta.id]);

    fuente.marcarSincronizada(abierta.id);
    expect(jornadas.porId(abierta.id)).toMatchObject({
      sync_estado: 'sincronizado',
      sync_error: null,
    });
    expect(fuente.pendientes()).toEqual([]);
  });
});
