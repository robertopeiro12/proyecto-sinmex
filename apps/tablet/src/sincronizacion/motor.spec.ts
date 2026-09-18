import { depsDePrueba, respuestaPullDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioJornadas } from '@/datos/repositorios/jornadas';
import { crearRepositorioProspectos } from '@/datos/repositorios/prospectos';
import { crearRepositorioSync } from '@/datos/repositorios/sync';
import { SinRedError } from '@/sesion/api';

import {
  ContratoIncompatibleError,
  FueraDeAlcanceError,
  LoteDemasiadoGrandeError,
  SesionRechazadaError,
  type ClienteSync,
} from './api';
import {
  FotoPermanenteError,
  FotoTemporalError,
  type ClienteFotos,
} from './api-foto';
import type {
  ClientePull,
  NotaPendientePull,
  OperacionSaliente,
  RespuestaPull,
  RespuestaPush,
} from './contrato';
import { fuenteFotosProspectos, type FuenteFotos } from './fuente-fotos';
import { fuenteJornadas } from './fuente-jornadas';
import { fuenteProspectos } from './fuente-prospectos';
import { aSnapshot, crearMotorSincronizacion, type FuenteOperaciones } from './motor';

/** Respuesta de push que acepta todo lo que le manden. */
function pushOk(operaciones: OperacionSaliente[]): RespuestaPush {
  return {
    contrato: 1,
    recibido_en: '2026-08-07T15:00:00.000Z',
    resumen: {
      recibidas: operaciones.length,
      aplicadas: operaciones.length,
      duplicadas: 0,
      rechazadas: 0,
    },
    resultados: operaciones.map((o) => ({
      clave: o.clave,
      tipo: o.tipo,
      estado: 'aplicada' as const,
      id_servidor: `srv-${o.clave}`,
    })),
  };
}

interface Escenario {
  pulls: { token: string; desde: string | null }[];
  pushes: { token: string; operaciones: OperacionSaliente[] }[];
  /** Cada `POST /sync/foto/:clave` que se intento (T-40). */
  fotos: { token: string; clave: string; uri: string }[];
  renovaciones: number;
  /** Orden de las llamadas, para poder afirmar que `renovar` va primero. */
  orden: string[];
}

/** Momento con el que el servidor confirma una foto. */
const FOTO_SUBIDA_EN = '2026-08-07T15:00:05.000Z';

/** Fuente de fotos vacia: el caso de los tests que no miran el paso 4. */
const SIN_FOTOS: FuenteFotos = {
  tipo: 'prospecto',
  pendientes: () => [],
  marcarSubida: jest.fn(),
  anotarError: jest.fn(),
  descartar: jest.fn(),
};

function montar(opciones: {
  pull?: (desde: string | null) => RespuestaPull | Promise<never>;
  push?: (ops: OperacionSaliente[]) => RespuestaPush | Promise<never>;
  renovar?: () => Promise<boolean>;
  token?: () => string | null;
  fuentes?: (
    jornadas: ReturnType<typeof crearRepositorioJornadas>,
    prospectos: ReturnType<typeof crearRepositorioProspectos>,
  ) => FuenteOperaciones[];
  /** Que hace el servidor con cada foto. Por defecto, la acepta. */
  subirFoto?: (clave: string, uri: string) => Promise<string>;
  /** Fuente de fotos. Por defecto {@link SIN_FOTOS}. */
  fotos?: (prospectos: ReturnType<typeof crearRepositorioProspectos>) => FuenteFotos;
}) {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  const jornadas = crearRepositorioJornadas(deps);
  const prospectos = crearRepositorioProspectos(deps, { catalogos });
  const sync = crearRepositorioSync(deps);

  const escenario: Escenario = {
    pulls: [],
    pushes: [],
    fotos: [],
    renovaciones: 0,
    orden: [],
  };

  const api: ClienteSync = {
    async pull(token, desde) {
      escenario.orden.push('pull');
      escenario.pulls.push({ token, desde });
      return (opciones.pull ?? (() => respuestaPullDePrueba()))(desde);
    },
    async push(token, operaciones) {
      escenario.orden.push('push');
      escenario.pushes.push({ token, operaciones });
      return (opciones.push ?? pushOk)(operaciones);
    },
  };

  const apiFotos: ClienteFotos = {
    async subir(token, clave, uri) {
      escenario.orden.push('foto');
      escenario.fotos.push({ token, clave, uri });
      return (opciones.subirFoto ?? (async () => FOTO_SUBIDA_EN))(clave, uri);
    },
  };

  const motor = crearMotorSincronizacion({
    api,
    catalogos,
    sync,
    fuentes: opciones.fuentes
      ? opciones.fuentes(jornadas, prospectos)
      : [fuenteJornadas(jornadas)],
    fotos: {
      fuente: opciones.fotos ? opciones.fotos(prospectos) : SIN_FOTOS,
      api: apiFotos,
    },
    sesion: {
      renovar: async () => {
        escenario.orden.push('renovar');
        escenario.renovaciones += 1;
        return (opciones.renovar ?? (async () => true))();
      },
      tokenAcceso: opciones.token ?? (() => 'token-vivo'),
    },
  });

  return { motor, catalogos, jornadas, prospectos, sync, deps, escenario };
}

/**
 * Motor con el canal de la foto cableado a los repositorios REALES.
 *
 * Sin dobles en la capa de datos a proposito: lo que estas pruebas tienen que
 * demostrar es que un fallo de la foto **no toca las columnas del prospecto**, y
 * con una fuente falsa eso no se demostraria, se supondria.
 */
function montarConFotos(opciones: Parameters<typeof montar>[0] = {}) {
  const montado = montar({
    ...opciones,
    fuentes: (jornadas, prospectos) => [
      fuenteJornadas(jornadas),
      fuenteProspectos(prospectos),
    ],
    fotos: (prospectos) => fuenteFotosProspectos(prospectos),
  });
  montado.catalogos.guardarSnapshot(snapshotDePrueba());
  return montado;
}

/** Captura un prospecto con foto, todavia sin subir nada. */
function conProspectoConFoto(
  prospectos: ReturnType<typeof crearRepositorioProspectos>,
  fotoUri: string | null = 'file:///cache/fachada.jpg',
) {
  return prospectos.registrar({
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
}

/** Deja una jornada CERRADA y pendiente de subir. */
function conJornadaCerrada(
  jornadas: ReturnType<typeof crearRepositorioJornadas>,
  catalogos: ReturnType<typeof crearRepositorioCatalogos>,
) {
  catalogos.guardarSnapshot(respuestaPullSnapshot());
  const jornada = jornadas.abrir({
    vendedorId: 'ven-1',
    vehiculoId: 'veh-1',
    kmInicial: 100,
  });
  return jornadas.cerrar(jornada.id, 240);
}

function respuestaPullSnapshot() {
  // T-20: la conversion de abonos a abonos_json vive en aSnapshot; se reusa.
  return aSnapshot(respuestaPullDePrueba());
}

describe('aSnapshot (T-20)', () => {
  it('guarda los abonos como JSON y tolera un servidor anterior a T-20', () => {
    const respuesta = respuestaPullDePrueba();
    expect(aSnapshot(respuesta).notas?.map((n) => n.abonos_json)).toEqual(
      respuesta.notas_pendientes.map((n) => JSON.stringify(n.abonos)),
    );

    // Un servidor viejo no manda `abonos` ni `saldo_favor_centavos`.
    const vieja = JSON.parse(JSON.stringify(respuesta)) as RespuestaPull;
    for (const n of vieja.notas_pendientes) delete (n as Partial<NotaPendientePull>).abonos;
    for (const c of vieja.catalogos.clientes) delete (c as Partial<ClientePull>).saldo_favor_centavos;

    const snapshot = aSnapshot(vieja);
    expect(snapshot.notas?.map((n) => n.abonos_json)).toEqual(['[]', '[]']);
    expect(snapshot.clientes?.map((c) => c.saldo_favor_centavos)).toEqual([0, 0]);
  });
});

describe('motor de sincronizacion', () => {
  describe('renovar la sesion es el PRIMER paso', () => {
    it('llama a renovar() antes que a pull o push', async () => {
      // No es cosmetico: es lo que corre hacia adelante la ventana offline de
      // 72 h (ADR-0005). Si se sincronizara sin renovar, el vendedor podria
      // bajar su dia correctamente y aun asi quedarse fuera de la app al dia
      // siguiente, sin ninguna pista de por que.
      const { motor, escenario, jornadas, catalogos } = montar({});
      conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();

      expect(r.ok).toBe(true);
      expect(r.sesionRenovada).toBe(true);
      expect(escenario.orden[0]).toBe('renovar');
      expect(escenario.orden).toEqual(['renovar', 'pull', 'push']);
    });

    it('si no hay sesion guardada, no se toca la red', async () => {
      const { motor, escenario } = montar({
        renovar: async () => false,
        token: () => null,
      });

      const r = await motor.sincronizar();

      expect(r).toMatchObject({ ok: false, motivo: 'sin-sesion' });
      expect(escenario.pulls).toHaveLength(0);
      expect(escenario.pushes).toHaveLength(0);
    });

    it('si hay sesion pero no hay red, se abandona sin intentar el pull', async () => {
      // Intentarlo fallaria igual, y ademas la ventana offline seguiria sin
      // correr, que era lo importante de este paso.
      const { motor, escenario } = montar({ renovar: async () => false });

      const r = await motor.sincronizar();

      expect(r).toMatchObject({ ok: false, motivo: 'sin-red', sesionRenovada: false });
      expect(escenario.pulls).toHaveLength(0);
    });

    it('el token que usa el pull es el que quedo TRAS renovar', async () => {
      // El refresh rota la sesion y emite un access nuevo. Usar el viejo daria
      // un 401 justo cuando la tablet acaba de reconectarse.
      let renovado = false;
      const { motor, escenario } = montar({
        renovar: async () => {
          renovado = true;
          return true;
        },
        token: () => (renovado ? 'token-nuevo' : 'token-viejo'),
      });

      await motor.sincronizar();
      expect(escenario.pulls[0]!.token).toBe('token-nuevo');
    });
  });

  describe('pull', () => {
    it('aplica el snapshot en la base local', async () => {
      const { motor, catalogos } = montar({});

      const r = await motor.sincronizar();

      expect(r.pull?.completo).toBe(true);
      expect(catalogos.listarClientes('suc-tj')).toHaveLength(1);
      expect(catalogos.listarVehiculos('suc-tj')).toHaveLength(1);
      expect(catalogos.precioVigente('cli-1', 'pre-1', '2026-08-07')).toBe(2800);
      expect(catalogos.notasPendientesDe('cli-1')).toHaveLength(2);
    });

    it('la primera vez pide sin cursor; la segunda, con el que devolvio el servidor', async () => {
      const { motor, escenario, sync } = montar({});

      await motor.sincronizar();
      expect(escenario.pulls[0]!.desde).toBeNull();
      expect(sync.leerCursor()).toBe('2026-08-07T14:59:55.000Z');

      await motor.sincronizar();
      expect(escenario.pulls[1]!.desde).toBe('2026-08-07T14:59:55.000Z');
    });

    it('el cursor NO se guarda si aplicar el snapshot falla', async () => {
      // Guardarlo antes dejaria a la tablet creyendo estar al dia sin estarlo,
      // y esos cambios no volverian a bajar nunca.
      const { motor, sync } = montar({
        pull: () =>
          respuestaPullDePrueba({
            catalogos: {
              ...respuestaPullDePrueba().catalogos,
              // Un vehiculo de una sucursal que no existe: revienta la llave
              // foranea al aplicar.
              vehiculos: [
                { id: 'veh-x', nombre: 'Fantasma', sucursal_id: 'no-existe', activo: 1 },
              ],
            },
          }),
      });

      await expect(motor.sincronizar()).rejects.toThrow();
      expect(sync.leerCursor()).toBeNull();
    });

    it('una baja llega como activo: 0 y deja de ofrecerse, sin borrar la fila', async () => {
      // Es la politica de purga de T-07: la fila NO se borra porque la
      // operacion local (una jornada, una venta) puede estar apuntandola. El
      // segundo pull trae al cliente dado de baja.
      let vuelta = 0;
      const { motor, catalogos, deps } = montar({
        pull: () => {
          vuelta += 1;
          if (vuelta === 1) return respuestaPullDePrueba();
          const base = respuestaPullDePrueba();
          return {
            ...base,
            completo: false,
            catalogos: {
              ...base.catalogos,
              clientes: base.catalogos.clientes.map((c) => ({ ...c, activo: 0 as const })),
            },
          };
        },
      });

      await motor.sincronizar();
      expect(catalogos.listarClientes('suc-tj')).toHaveLength(1);

      await motor.sincronizar();
      expect(catalogos.listarClientes('suc-tj')).toHaveLength(0);
      expect(catalogos.obtenerCliente('cli-1')).not.toBeNull();
      expect(deps.bd.getAllSync<{ id: string }>('select id from cliente')).toHaveLength(2);
    });
  });

  describe('push', () => {
    it('sube las jornadas cerradas y las marca como sincronizadas', async () => {
      const { motor, jornadas, catalogos, escenario } = montar({});
      const jornada = conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();

      expect(r.push).toEqual({
        enviadas: 1,
        aplicadas: 1,
        duplicadas: 0,
        rechazadas: 0,
      });
      // La clave de idempotencia es el id local de la fila.
      expect(escenario.pushes[0]!.operaciones[0]!.clave).toBe(jornada.id);
      expect(escenario.pushes[0]!.operaciones[0]!.fecha_operacion).toBe(jornada.fecha);
      expect(jornadas.pendientesDeSincronizar()).toHaveLength(0);
      expect(jornadas.porId(jornada.id)?.sync_estado).toBe('sincronizado');
    });

    it('NO sube una jornada abierta: el buzon del servidor es de solo escritura', async () => {
      // Subirla al abrirla congelaria su kilometraje inicial y el final no
      // llegaria nunca, porque un reenvio con la misma clave devuelve
      // `duplicada` sin modificar nada. Ver `fuente-jornadas.ts`.
      const { motor, jornadas, catalogos, escenario } = montar({});
      catalogos.guardarSnapshot(respuestaPullSnapshot());
      jornadas.abrir({ vendedorId: 'ven-1', vehiculoId: 'veh-1', kmInicial: 100 });

      const r = await motor.sincronizar();

      expect(escenario.pushes).toHaveLength(0);
      expect(r.push?.enviadas).toBe(0);
      // Y sigue contando como pendiente: la pantalla lo muestra honestamente.
      expect(jornadas.pendientesDeSincronizar()).toHaveLength(1);
    });

    it('`duplicada` cuenta como exito: es el punto de la idempotencia', async () => {
      // Reintentar tras una WiFi cortada devuelve `duplicada`. Tratarlo como
      // error obligaria a reintentar esa operacion para siempre.
      const { motor, jornadas, catalogos } = montar({
        push: (ops) => ({
          contrato: 1,
          recibido_en: '2026-08-07T15:00:00.000Z',
          resumen: { recibidas: ops.length, aplicadas: 0, duplicadas: ops.length, rechazadas: 0 },
          resultados: ops.map((o) => ({
            clave: o.clave,
            tipo: o.tipo,
            estado: 'duplicada' as const,
            id_servidor: `srv-${o.clave}`,
          })),
        }),
      });
      const jornada = conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();

      expect(r.ok).toBe(true);
      expect(r.push?.duplicadas).toBe(1);
      expect(jornadas.porId(jornada.id)?.sync_estado).toBe('sincronizado');
    });

    it('un rechazo guarda el motivo y deja la fila pendiente de reintento', async () => {
      const { motor, jornadas, catalogos } = montar({
        push: (ops) => ({
          contrato: 1,
          recibido_en: '2026-08-07T15:00:00.000Z',
          resumen: { recibidas: ops.length, aplicadas: 0, duplicadas: 0, rechazadas: ops.length },
          resultados: ops.map((o) => ({
            clave: o.clave,
            tipo: o.tipo,
            estado: 'rechazada' as const,
            codigo: 'fecha-futura',
            motivo: 'Revisa el reloj de la tablet.',
          })),
        }),
      });
      const jornada = conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();

      // El lote se recibio, asi que la sincronizacion NO fallo: fallo esa
      // operacion, y eso se reporta, no se esconde.
      expect(r.ok).toBe(true);
      expect(r.push?.rechazadas).toBe(1);

      const guardada = jornadas.porId(jornada.id);
      expect(guardada?.sync_estado).toBe('error');
      expect(guardada?.sync_error).toContain('fecha-futura');
      expect(guardada?.sync_error).toContain('Revisa el reloj');
      // Y se vuelve a intentar: el rechazo puede deberse a algo que el portal
      // corrija despues, y reintentar es seguro porque el push es idempotente.
      expect(jornadas.pendientesDeSincronizar()).toHaveLength(1);
    });

    it('no llama al servidor si no hay nada que subir', async () => {
      const { motor, escenario } = montar({});
      const r = await motor.sincronizar();
      expect(escenario.pushes).toHaveLength(0);
      expect(r.push?.enviadas).toBe(0);
    });

    it('trocea en lotes de 500: pasarse es un 400 que la tablet leeria como "sin red"', async () => {
      // Con un solo lote de 600, el servidor responde 400 (ArrayMaxSize), la
      // tablet lo traduce a SinRedError y reintentaria ese dia para siempre,
      // en silencio. Hoy no se llega ni de lejos —solo hay jornadas— pero el
      // dia que T-16 registre ventas por cliente, si.
      const muchas: OperacionSaliente[] = Array.from({ length: 600 }, (_, i) => ({
        clave: `op-${i}`,
        tipo: 'venta',
        fecha_operacion: '2026-08-07',
        ocurrido_en: '2026-08-07T15:00:00.000Z',
        datos: {},
      }));
      const sincronizadas: string[] = [];
      const masiva: FuenteOperaciones = {
        tipo: 'venta',
        pendientes: () => muchas,
        marcarSincronizada: (clave) => sincronizadas.push(clave),
        marcarError: jest.fn(),
      };

      const { motor, escenario } = montar({ fuentes: () => [masiva] });
      const r = await motor.sincronizar();

      expect(escenario.pushes.map((p) => p.operaciones.length)).toEqual([500, 100]);
      expect(r.push?.enviadas).toBe(600);
      expect(r.push?.aplicadas).toBe(600);
      expect(sincronizadas).toHaveLength(600);
    });

    it('cada fuente manda su propio lote', async () => {
      // Es como se enchufaran T-16/T-20/T-27/T-33/T-39 sin tocar el motor.
      const fantasma: FuenteOperaciones = {
        tipo: 'gasto',
        pendientes: () => [
          {
            clave: 'gasto-1',
            tipo: 'gasto',
            fecha_operacion: '2026-08-07',
            ocurrido_en: '2026-08-07T15:00:00.000Z',
            datos: { concepto: 'hielo' },
          },
        ],
        marcarSincronizada: jest.fn(),
        marcarError: jest.fn(),
      };

      const { motor, escenario, jornadas, catalogos } = montar({
        fuentes: (j) => [fuenteJornadas(j), fantasma],
      });
      conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();

      expect(escenario.pushes).toHaveLength(2);
      expect(r.push?.enviadas).toBe(2);
      expect(fantasma.marcarSincronizada).toHaveBeenCalledWith('gasto-1');
    });
  });

  describe('cuando algo sale mal', () => {
    it('sin red durante el pull: se reporta y no se pierde nada', async () => {
      const { motor, sync, jornadas, catalogos } = montar({
        pull: () => Promise.reject(new SinRedError()),
      });
      const jornada = conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();

      expect(r).toMatchObject({ ok: false, motivo: 'sin-red', sesionRenovada: true });
      expect(sync.leerCursor()).toBeNull();
      // Lo capturado sigue en la cola.
      expect(jornadas.pendientesDeSincronizar().map((j) => j.id)).toEqual([jornada.id]);
    });

    it('sin red durante el push: el pull ya aplicado se conserva', async () => {
      const { motor, catalogos, jornadas, sync } = montar({
        push: () => Promise.reject(new SinRedError()),
      });
      conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();

      expect(r).toMatchObject({ ok: false, motivo: 'sin-red' });
      // El pull va antes del push justamente por esto: si la conexion se corta
      // a la mitad, es preferible tener catalogos frescos y el dia sin subir
      // que al reves.
      expect(r.pull?.completo).toBe(true);
      expect(sync.leerCursor()).toBe('2026-08-07T14:59:55.000Z');
    });

    it('el servidor rechaza la sesion: se reporta como sin-sesion', async () => {
      const { motor } = montar({ pull: () => Promise.reject(new SesionRechazadaError()) });
      const r = await motor.sincronizar();
      expect(r).toMatchObject({ ok: false, motivo: 'sin-sesion' });
    });

    it('contrato incompatible: se distingue de la falta de red', async () => {
      // No se arregla reintentando. Si se colara como "sin red", la tablet
      // reintentaria para siempre sin que nadie supiera por que.
      const { motor } = montar({
        pull: () =>
          Promise.reject(new ContratoIncompatibleError('Actualiza la app.')),
      });
      const r = await motor.sincronizar();
      expect(r).toMatchObject({ ok: false, motivo: 'contrato' });
      expect(r.detalle).toContain('Actualiza la app');
    });

    it('alcance rechazado: se reporta como bug, no como condicion de campo', async () => {
      const { motor } = montar({
        pull: () => Promise.reject(new FueraDeAlcanceError('No tienes acceso a esa sucursal.')),
      });
      const r = await motor.sincronizar();
      expect(r).toMatchObject({ ok: false, motivo: 'alcance' });
    });

    it('un lote demasiado grande NO es falta de red: es un bug de troceo', async () => {
      // Un 413 leido como "sin red" es el bloqueo silencioso de IMPORTANT-1: la
      // tablet reenvia exactamente el mismo lote en cada sincronizacion, para
      // siempre, y en pantalla no se distingue de una WiFi caida.
      const { motor, catalogos, jornadas } = montar({
        push: () =>
          Promise.reject(new LoteDemasiadoGrandeError('El servidor respondio 413.')),
      });
      conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();
      expect(r).toMatchObject({ ok: false, motivo: 'lote-grande' });
    });

    it('un error que no reconoce se deja propagar en vez de tragarselo', async () => {
      const { motor } = montar({
        pull: () => Promise.reject(new TypeError('undefined is not a function')),
      });
      await expect(motor.sincronizar()).rejects.toThrow(TypeError);
    });
  });
  /**
   * El paso 4: las fotos de los prospectos (T-40).
   *
   * Corre **despues** del push y por un canal aparte del lote. Todo lo de aqui
   * usa los repositorios reales: lo que hay que demostrar es lo que queda escrito
   * en SQLite, y con una fuente falsa eso se supondria en vez de probarse.
   */
  describe('fotos de prospectos', () => {
    it('va DESPUES del push, y no antes', async () => {
      // No es una preferencia: antes de que el servidor acepte el alta no existe
      // la fila `cliente` a la que la foto pertenece, asi que subirla solo podria
      // dar 404.
      const { motor, prospectos, escenario } = montarConFotos();
      conProspectoConFoto(prospectos);

      await motor.sincronizar();

      expect(escenario.orden).toEqual(['renovar', 'pull', 'push', 'foto']);
    });

    it('un prospecto capturado hoy sube su foto en la MISMA pasada', async () => {
      // Consecuencia de que el paso 4 vaya despues del push: el push ya lo dejo
      // sincronizado, asi que su foto ya es elegible. El vendedor no tiene que
      // sincronizar dos veces.
      const { motor, prospectos, escenario } = montarConFotos();
      const p = conProspectoConFoto(prospectos);

      const r = await motor.sincronizar();

      expect(escenario.fotos).toEqual([
        { token: 'token-vivo', clave: p.id, uri: 'file:///cache/fachada.jpg' },
      ]);
      expect(r.fotos).toEqual({
        intentadas: 1,
        subidas: 1,
        pendientes: 0,
        descartadas: 0,
      });
      expect(prospectos.porId(p.id)).toMatchObject({
        foto_subida_en: FOTO_SUBIDA_EN,
        foto_error: null,
      });
    });

    it('un prospecto sin foto no genera ninguna peticion', async () => {
      // Un prospecto sin foto es un prospecto completo: no hay nada que esperar,
      // nada que reintentar y nada que avisar.
      const { motor, prospectos, escenario } = montarConFotos();
      conProspectoConFoto(prospectos, null);

      const r = await motor.sincronizar();

      expect(escenario.fotos).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.fotos?.intentadas).toBe(0);
    });

    it('si el push rechaza el prospecto, su foto NI SE INTENTA', async () => {
      // Sin fila en el servidor no hay `cliente` al que anotarle la foto. La foto
      // se queda en el equipo y se intenta cuando el prospecto entre.
      const { motor, prospectos, escenario } = montarConFotos({
        push: (ops) => ({
          contrato: 1,
          recibido_en: '2026-08-07T15:00:00.000Z',
          resumen: { recibidas: ops.length, aplicadas: 0, duplicadas: 0, rechazadas: ops.length },
          resultados: ops.map((o) => ({
            clave: o.clave,
            tipo: o.tipo,
            estado: 'rechazada' as const,
            codigo: 'tipo-negocio-inexistente',
            motivo: 'Ese giro ya no existe.',
          })),
        }),
      });
      const p = conProspectoConFoto(prospectos);

      await motor.sincronizar();

      expect(escenario.fotos).toEqual([]);
      // Y la foto sigue intacta, esperando: `foto_error` ni se toco, porque no
      // hubo fallo de foto que anotar.
      expect(prospectos.porId(p.id)).toMatchObject({
        sync_estado: 'error',
        foto_uri: 'file:///cache/fachada.jpg',
        foto_subida_en: null,
        foto_error: null,
        foto_descartada: 0,
      });
    });

    /**
     * > [!danger] ESTA es la prueba que da sentido a todo el diseno de T-40
     * > Si falla, una foto que no sube esta cambiando el estado de un alta que el
     * > servidor **ya acepto**. El sintoma en produccion no seria un error en
     * > pantalla: seria un prospecto marcado "rechazado" que nadie visita, es
     * > decir **un cliente potencial perdido en silencio**. Es el unico fallo de
     * > este ticket que el cliente pagaria.
     */
    describe('una foto que falla NO se lleva el prospecto', () => {
      /** Lo que el push dejo escrito en la fila, sin una columna de foto. */
      const estadoDelProspecto = (
        prospectos: ReturnType<typeof crearRepositorioProspectos>,
        id: string,
      ) => {
        const p = prospectos.porId(id);
        return {
          sync_estado: p?.sync_estado,
          sync_error: p?.sync_error,
          sincronizado_en: p?.sincronizado_en,
        };
      };

      it('con un 413 permanente, el prospecto sigue sincronizado y limpio', async () => {
        const { motor, prospectos } = montarConFotos({
          subirFoto: () =>
            Promise.reject(
              new FotoPermanenteError('La foto pesa 3145728 bytes y el maximo es 2097152.'),
            ),
        });
        const p = conProspectoConFoto(prospectos);

        const r = await motor.sincronizar();

        // 1. El prospecto, intacto y aceptado.
        expect(estadoDelProspecto(prospectos, p.id)).toEqual({
          sync_estado: 'sincronizado',
          sync_error: null,
          sincronizado_en: '2026-08-07T15:00:00.000Z',
        });
        // 2. No vuelve a la cola del push: reenviarlo daria `duplicada` y la fila
        //    se quedaria oscilando por una foto opcional.
        expect(prospectos.pendientesDeSincronizar()).toEqual([]);
        // 3. El fallo esta anotado donde le toca, y solo ahi.
        expect(prospectos.porId(p.id)).toMatchObject({
          foto_descartada: 1,
          foto_error: expect.stringContaining('3145728'),
        });
        // 4. Y la sincronizacion NO fallo: el dia del vendedor esta arriba.
        expect(r.ok).toBe(true);
        expect(r.push?.aplicadas).toBe(1);
        expect(r.fotos).toMatchObject({ descartadas: 1, subidas: 0 });
      });

      it('con un fallo temporal, el prospecto sigue sincronizado y limpio', async () => {
        const { motor, prospectos } = montarConFotos({
          subirFoto: () => Promise.reject(new FotoTemporalError('El servidor respondio 500.')),
        });
        const p = conProspectoConFoto(prospectos);

        const r = await motor.sincronizar();

        expect(estadoDelProspecto(prospectos, p.id)).toEqual({
          sync_estado: 'sincronizado',
          sync_error: null,
          sincronizado_en: '2026-08-07T15:00:00.000Z',
        });
        expect(prospectos.pendientesDeSincronizar()).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.fotos).toMatchObject({ pendientes: 1 });
      });

      it('con la WiFi caida a media foto, el prospecto sigue sincronizado y limpio', async () => {
        const { motor, prospectos } = montarConFotos({
          subirFoto: () => Promise.reject(new SinRedError()),
        });
        const p = conProspectoConFoto(prospectos);

        const r = await motor.sincronizar();

        expect(estadoDelProspecto(prospectos, p.id)).toEqual({
          sync_estado: 'sincronizado',
          sync_error: null,
          sincronizado_en: '2026-08-07T15:00:00.000Z',
        });
        // Y `ok` sigue en true: decirle al vendedor que la sincronizacion fallo
        // cuando su dia entero subio seria mentirle.
        expect(r.ok).toBe(true);
        expect(r.motivo).toBeUndefined();
      });
    });

    describe('permanente contra temporal', () => {
      it('un 413 NO se reintenta en la siguiente pasada', async () => {
        // Es lo que corta el bucle infinito: el servidor ya juzgo ESTOS bytes, y
        // mandarlos otra vez da la misma respuesta. Sin esto la tablet gastaria la
        // WiFi del negocio en cada sincronizacion, para siempre y en silencio.
        const { motor, prospectos, escenario } = montarConFotos({
          subirFoto: () => Promise.reject(new FotoPermanenteError('Pesa demasiado.')),
        });
        conProspectoConFoto(prospectos);

        await motor.sincronizar();
        expect(escenario.fotos).toHaveLength(1);

        await motor.sincronizar();
        // Cero peticiones nuevas: la segunda pasada no la vuelve a intentar.
        expect(escenario.fotos).toHaveLength(1);
      });

      it('un fallo temporal SI se reintenta, y acaba subiendo', async () => {
        let intentos = 0;
        const { motor, prospectos, escenario } = montarConFotos({
          subirFoto: async () => {
            intentos += 1;
            if (intentos === 1) throw new SinRedError();
            return FOTO_SUBIDA_EN;
          },
        });
        const p = conProspectoConFoto(prospectos);

        await motor.sincronizar();
        expect(prospectos.porId(p.id)?.foto_subida_en).toBeNull();

        await motor.sincronizar();

        expect(escenario.fotos).toHaveLength(2);
        expect(prospectos.porId(p.id)).toMatchObject({
          foto_subida_en: FOTO_SUBIDA_EN,
          // Y el error del primer intento se limpia: dejarlo en pantalla junto a
          // una foto ya subida se lee como un fallo que no existe.
          foto_error: null,
        });
      });

      it('una ya subida no se vuelve a mandar', async () => {
        const { motor, prospectos, escenario } = montarConFotos();
        conProspectoConFoto(prospectos);

        await motor.sincronizar();
        await motor.sincronizar();

        expect(escenario.fotos).toHaveLength(1);
      });
    });

    describe('una foto no arrastra a las demas', () => {
      it('un fallo permanente de una no impide que suba la siguiente', async () => {
        // Una por una y no en lote justamente por esto.
        const { motor, prospectos, escenario } = montarConFotos({
          subirFoto: async (_clave, uri) => {
            if (uri.includes('mala')) throw new FotoPermanenteError('No es un JPEG.');
            return FOTO_SUBIDA_EN;
          },
        });
        const mala = conProspectoConFoto(prospectos, 'file:///cache/mala.jpg');
        const buena = conProspectoConFoto(prospectos, 'file:///cache/buena.jpg');

        const r = await motor.sincronizar();

        expect(escenario.fotos).toHaveLength(2);
        expect(prospectos.porId(mala.id)?.foto_descartada).toBe(1);
        expect(prospectos.porId(buena.id)?.foto_subida_en).toBe(FOTO_SUBIDA_EN);
        expect(r.fotos).toEqual({
          intentadas: 2,
          subidas: 1,
          pendientes: 0,
          descartadas: 1,
        });
      });

      it('si se cae la red, se corta el paso y el resto queda en la cola', async () => {
        // Seguir intentando sin red solo gastaria tiempo con el vendedor
        // esperando. Lo que NO puede pasar es que las demas se pierdan.
        const { motor, prospectos, escenario } = montarConFotos({
          subirFoto: () => Promise.reject(new SinRedError()),
        });
        const primera = conProspectoConFoto(prospectos, 'file:///cache/1.jpg');
        const segunda = conProspectoConFoto(prospectos, 'file:///cache/2.jpg');

        const r = await motor.sincronizar();

        // Se intento una sola: la segunda ni se toco.
        expect(escenario.fotos).toHaveLength(1);
        expect(prospectos.porId(segunda.id)?.foto_error).toBeNull();
        // Y las dos siguen en la cola para la proxima.
        expect(prospectos.pendientesDeSubirFoto().map((x) => x.id)).toEqual([
          primera.id,
          segunda.id,
        ]);
        expect(r.fotos).toMatchObject({ intentadas: 1, pendientes: 1 });
      });

      it('una sesion rechazada tambien corta el paso', async () => {
        const { motor, prospectos, escenario } = montarConFotos({
          subirFoto: () => Promise.reject(new SesionRechazadaError()),
        });
        conProspectoConFoto(prospectos, 'file:///cache/1.jpg');
        conProspectoConFoto(prospectos, 'file:///cache/2.jpg');

        await motor.sincronizar();

        expect(escenario.fotos).toHaveLength(1);
      });
    });

    it('un error que no reconoce se deja propagar, igual que en el pull', async () => {
      // La doctrina del motor: tragarselo lo convertiria en "las fotos no suben y
      // no se sabe por que". El push ya esta confirmado en SQLite, asi que ni una
      // excepcion aqui puede perder el dia del vendedor.
      const { motor, prospectos } = montarConFotos({
        subirFoto: () => Promise.reject(new TypeError('undefined is not a function')),
      });
      const p = conProspectoConFoto(prospectos);

      await expect(motor.sincronizar()).rejects.toThrow(TypeError);

      expect(prospectos.porId(p.id)).toMatchObject({
        sync_estado: 'sincronizado',
        sync_error: null,
      });
    });
  });
});
