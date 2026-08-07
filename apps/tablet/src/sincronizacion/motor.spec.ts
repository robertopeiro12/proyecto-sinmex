import { depsDePrueba, respuestaPullDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioJornadas } from '@/datos/repositorios/jornadas';
import { crearRepositorioSync } from '@/datos/repositorios/sync';
import { SinRedError } from '@/sesion/api';

import {
  ContratoIncompatibleError,
  FueraDeAlcanceError,
  SesionRechazadaError,
  type ClienteSync,
} from './api';
import type { OperacionSaliente, RespuestaPull, RespuestaPush } from './contrato';
import { fuenteJornadas } from './fuente-jornadas';
import { crearMotorSincronizacion, type FuenteOperaciones } from './motor';

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
  renovaciones: number;
  /** Orden de las llamadas, para poder afirmar que `renovar` va primero. */
  orden: string[];
}

function montar(opciones: {
  pull?: (desde: string | null) => RespuestaPull | Promise<never>;
  push?: (ops: OperacionSaliente[]) => RespuestaPush | Promise<never>;
  renovar?: () => Promise<boolean>;
  token?: () => string | null;
  fuentes?: (jornadas: ReturnType<typeof crearRepositorioJornadas>) => FuenteOperaciones[];
}) {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  const jornadas = crearRepositorioJornadas(deps);
  const sync = crearRepositorioSync(deps);

  const escenario: Escenario = {
    pulls: [],
    pushes: [],
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

  const motor = crearMotorSincronizacion({
    api,
    catalogos,
    sync,
    fuentes: opciones.fuentes
      ? opciones.fuentes(jornadas)
      : [fuenteJornadas(jornadas)],
    sesion: {
      renovar: async () => {
        escenario.orden.push('renovar');
        escenario.renovaciones += 1;
        return (opciones.renovar ?? (async () => true))();
      },
      tokenAcceso: opciones.token ?? (() => 'token-vivo'),
    },
  });

  return { motor, catalogos, jornadas, sync, deps, escenario };
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
  const r = respuestaPullDePrueba();
  return {
    sucursales: r.catalogos.sucursales.map(({ id, codigo, nombre, activo }) => ({
      id,
      codigo,
      nombre,
      activa: activo,
    })),
    vendedores: r.catalogos.vendedores,
    vehiculos: r.catalogos.vehiculos,
    productos: r.catalogos.productos,
    presentaciones: r.catalogos.presentaciones,
    clientes: r.catalogos.clientes,
    precios: r.catalogos.precios,
    notas: r.notas_pendientes,
  };
}

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

    it('un error que no reconoce se deja propagar en vez de tragarselo', async () => {
      const { motor } = montar({
        pull: () => Promise.reject(new TypeError('undefined is not a function')),
      });
      await expect(motor.sincronizar()).rejects.toThrow(TypeError);
    });
  });
});
