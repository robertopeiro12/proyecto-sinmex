import { randomBytes } from 'node:crypto';

import type { Reloj } from '@/datos/reloj';

import { CLAVE_SESION, almacenMemoria, type AlmacenSeguro } from './almacen';
import {
  CredencialesInvalidasError,
  SinRedError,
  type ClienteAuthApp,
  type RespuestaAuthApp,
} from './api';
import { crearGestorSesion } from './gestor';
import { INTENTOS_LOCALES_MAX, type SesionGuardada } from './politica';

const SALIDA = '2026-08-07T15:00:00.000Z';
const HORA = 60 * 60 * 1000;
const PASSWORD = 'ruta-2026';

function mas(momento: string, ms: number): string {
  return new Date(Date.parse(momento) + ms).toISOString();
}

/** Reloj que se puede mover a mano durante la prueba. */
function relojMovil(inicial: string) {
  let momento = inicial;
  const reloj: Reloj = {
    ahora: () => momento,
    hoy: () => momento.slice(0, 10),
  };
  return {
    reloj,
    avanzar(ms: number) {
      momento = mas(momento, ms);
    },
    fijar(nuevo: string) {
      momento = nuevo;
    },
  };
}

const VENDEDOR = {
  id: 'ven-1',
  login: 'aperez',
  nombre: 'Abraham Perez',
  sucursalId: 'suc-tj',
  sucursalCodigo: 'TJ',
  sucursalNombre: 'Tijuana',
};

function respuesta(ahora: string): RespuestaAuthApp {
  return {
    vendedor: VENDEDOR,
    tokenAcceso: 'jwt-acceso',
    accesoExpiraEn: mas(ahora, 12 * HORA),
    tokenRefresh: `refresh-${Math.random()}`,
    sesionExpiraEn: mas(ahora, 7 * 24 * HORA),
    // Coste bajo: aqui se prueba la LOGICA, no el KDF (eso es verificador.spec).
    politica: { ventanaOfflineHoras: 72, costeVerificador: 30 },
  };
}

/** Servidor de mentira, con un interruptor de red. */
function apiFalsa(reloj: Reloj) {
  const estado = {
    hayRed: true,
    credencialesValidas: true,
    refreshAceptado: true,
    logouts: [] as string[],
    refrescos: 0,
  };

  const api: ClienteAuthApp = {
    async login(login, password) {
      if (!estado.hayRed) throw new SinRedError();
      if (!estado.credencialesValidas || login !== VENDEDOR.login || password !== PASSWORD) {
        throw new CredencialesInvalidasError();
      }
      return respuesta(reloj.ahora());
    },
    async refrescar() {
      if (!estado.hayRed) throw new SinRedError();
      if (!estado.refreshAceptado) throw new CredencialesInvalidasError();
      estado.refrescos += 1;
      return respuesta(reloj.ahora());
    },
    async cerrarSesion(token) {
      if (!estado.hayRed) throw new SinRedError();
      estado.logouts.push(token);
    },
  };

  return { api, estado };
}

function montar(inicial = SALIDA) {
  const tiempo = relojMovil(inicial);
  const { api, estado } = apiFalsa(tiempo.reloj);
  const almacen: AlmacenSeguro = almacenMemoria();
  const gestor = crearGestorSesion({
    almacen,
    api,
    reloj: tiempo.reloj,
    aleatorio: (n) => new Uint8Array(randomBytes(n)),
  });
  return { gestor, almacen, api: estado, tiempo };
}

function guardada(almacen: AlmacenSeguro): SesionGuardada {
  const crudo = almacen.leer(CLAVE_SESION);
  if (!crudo) throw new Error('No hay sesion guardada.');
  return JSON.parse(crudo) as SesionGuardada;
}

describe('login en linea', () => {
  it('guarda la sesion y deriva el verificador de la contrasena tecleada', async () => {
    const { gestor, almacen } = montar();

    const r = await gestor.entrar('aperez', PASSWORD);

    expect(r).toMatchObject({ ok: true, modo: 'linea' });
    const s = guardada(almacen);
    expect(s.vendedor.login).toBe('aperez');
    expect(s.verificador.startsWith('pbkdf2-sha256$30$')).toBe(true);
    expect(s.ultimoContactoServidor).toBe(SALIDA);
    expect(s.intentosFallidos).toBe(0);
  });

  it('la contrasena NO queda guardada en ninguna parte del almacen', async () => {
    const { gestor, almacen } = montar();
    await gestor.entrar('aperez', PASSWORD);
    expect(almacen.leer(CLAVE_SESION)).not.toContain(PASSWORD);
  });

  it('unas credenciales que el servidor rechaza no tocan la sesion guardada', async () => {
    const { gestor, almacen, api } = montar();
    await gestor.entrar('aperez', PASSWORD);
    const antes = almacen.leer(CLAVE_SESION);

    api.credencialesValidas = false;
    const r = await gestor.entrar('aperez', 'otra-cosa');

    expect(r).toEqual({ ok: false, motivo: 'credenciales' });
    // Un 401 del servidor no debe borrarle al vendedor su sesion offline: si
    // se equivoca al teclear con red, no puede quedarse sin poder trabajar sin
    // ella.
    expect(almacen.leer(CLAVE_SESION)).toBe(antes);
  });

  it('un rechazo del servidor NO consume intentos locales', async () => {
    const { gestor, almacen, api } = montar();
    await gestor.entrar('aperez', PASSWORD);

    api.credencialesValidas = false;
    for (let i = 0; i < INTENTOS_LOCALES_MAX + 5; i++) {
      await gestor.entrar('aperez', 'mala');
    }

    expect(guardada(almacen).intentosFallidos).toBe(0);
  });
});

describe('re-autenticacion local (sin red)', () => {
  it('acepta la contrasena correcta y abre la sesion sin servidor', async () => {
    const { gestor, api, tiempo } = montar();
    await gestor.entrar('aperez', PASSWORD);

    api.hayRed = false;
    tiempo.avanzar(10 * HORA);

    const r = await gestor.entrar('aperez', PASSWORD);
    expect(r).toMatchObject({ ok: true, modo: 'local', vendedor: { login: 'aperez' } });
  });

  it('rechaza la contrasena incorrecta y descuenta un intento', async () => {
    const { gestor, almacen, api } = montar();
    await gestor.entrar('aperez', PASSWORD);
    api.hayRed = false;

    const r = await gestor.entrar('aperez', 'no-es-esa');

    expect(r).toEqual({
      ok: false,
      motivo: 'credenciales',
      intentosRestantes: INTENTOS_LOCALES_MAX - 1,
    });
    expect(guardada(almacen).intentosFallidos).toBe(1);
  });

  it('un acierto tras varios fallos reinicia el contador', async () => {
    const { gestor, almacen, api } = montar();
    await gestor.entrar('aperez', PASSWORD);
    api.hayRed = false;

    await gestor.entrar('aperez', 'mala');
    await gestor.entrar('aperez', 'mala');
    expect(guardada(almacen).intentosFallidos).toBe(2);

    await gestor.entrar('aperez', PASSWORD);
    expect(guardada(almacen).intentosFallidos).toBe(0);
  });

  it('agotados los intentos BORRA el material local, no solo bloquea', async () => {
    const { gestor, almacen, api } = montar();
    await gestor.entrar('aperez', PASSWORD);
    api.hayRed = false;

    for (let i = 0; i < INTENTOS_LOCALES_MAX - 1; i++) {
      expect(await gestor.entrar('aperez', 'mala')).toMatchObject({ motivo: 'credenciales' });
    }

    const ultimo = await gestor.entrar('aperez', 'mala');
    expect(ultimo).toEqual({ ok: false, motivo: 'intentos-agotados' });

    // Bloquear sin borrar dejaria el verificador ahi para que alguien con la
    // tablet siguiera atacandolo con calma desde fuera de la app.
    expect(almacen.leer(CLAVE_SESION)).toBeNull();

    // Y ni la contrasena buena sirve ya sin red.
    expect(await gestor.entrar('aperez', PASSWORD)).toEqual({
      ok: false,
      motivo: 'sin-credenciales',
    });
  });

  it('otro vendedor no puede entrar con la sesion local del primero', async () => {
    const { gestor, almacen, api } = montar();
    await gestor.entrar('aperez', PASSWORD);
    api.hayRed = false;

    const r = await gestor.entrar('bruiz', PASSWORD);

    expect(r).toEqual({ ok: false, motivo: 'otro-vendedor' });
    // Tampoco consume intentos del titular: no es un ataque a SU contrasena.
    expect(guardada(almacen).intentosFallidos).toBe(0);
  });

  it('pasada la ventana offline exige red, aunque la contrasena sea correcta', async () => {
    const { gestor, api, tiempo } = montar();
    await gestor.entrar('aperez', PASSWORD);

    api.hayRed = false;
    tiempo.avanzar(73 * HORA);

    expect(await gestor.entrar('aperez', PASSWORD)).toEqual({
      ok: false,
      motivo: 'ventana-vencida',
    });
  });

  it('sin sesion previa y sin red no hay nada que hacer', async () => {
    const { gestor, api } = montar();
    api.hayRed = false;
    expect(await gestor.entrar('aperez', PASSWORD)).toEqual({
      ok: false,
      motivo: 'sin-credenciales',
    });
  });

  it('una sesion guardada ilegible se descarta en vez de reventar', async () => {
    const { gestor, almacen, api } = montar();
    almacen.escribir(CLAVE_SESION, '{esto no es json');
    api.hayRed = false;

    expect(await gestor.entrar('aperez', PASSWORD)).toEqual({
      ok: false,
      motivo: 'sin-credenciales',
    });
  });
});

describe('el servidor manda cuando hay red', () => {
  it('con red se intenta SIEMPRE el servidor primero, aunque haya sesion local', async () => {
    // Es lo que hace que una baja de vendedor o un cambio de contrasena surtan
    // efecto en cuanto hay senal, sin esperar a que caduque la ventana.
    const { gestor, api } = montar();
    await gestor.entrar('aperez', PASSWORD);

    api.credencialesValidas = false;
    const r = await gestor.entrar('aperez', PASSWORD);

    expect(r).toEqual({ ok: false, motivo: 'credenciales' });
  });
});

describe('renovar', () => {
  it('corre la ventana offline hacia adelante', async () => {
    const { gestor, almacen, tiempo } = montar();
    await gestor.entrar('aperez', PASSWORD);

    tiempo.avanzar(48 * HORA);
    expect(await gestor.renovar()).toBe(true);

    expect(guardada(almacen).ultimoContactoServidor).toBe(mas(SALIDA, 48 * HORA));
    // Con la ventana corrida, otras 48 h offline siguen siendo validas.
    tiempo.avanzar(48 * HORA);
    expect(gestor.estado().tipo).toBe('reautenticacion-local');
  });

  it('conserva el verificador: renovar no puede regenerarlo (no hay contrasena)', async () => {
    const { gestor, almacen } = montar();
    await gestor.entrar('aperez', PASSWORD);
    const antes = guardada(almacen).verificador;

    await gestor.renovar();

    expect(guardada(almacen).verificador).toBe(antes);
  });

  it('sin red no rompe nada ni toca la sesion', async () => {
    const { gestor, almacen, api } = montar();
    await gestor.entrar('aperez', PASSWORD);
    const antes = almacen.leer(CLAVE_SESION);

    api.hayRed = false;
    expect(await gestor.renovar()).toBe(false);
    expect(almacen.leer(CLAVE_SESION)).toBe(antes);
  });

  it('si el servidor rechaza el refresh, borra la sesion local', async () => {
    // Este es el UNICO camino por el que una baja hecha en el portal llega a la
    // tablet. Si el rechazo se ignorara, un vendedor dado de baja seguiria
    // abriendo su app localmente hasta que venciera la ventana.
    const { gestor, almacen, api } = montar();
    await gestor.entrar('aperez', PASSWORD);

    api.refreshAceptado = false;
    expect(await gestor.renovar()).toBe(false);
    expect(almacen.leer(CLAVE_SESION)).toBeNull();
  });

  it('sin sesion no hace nada', async () => {
    const { gestor } = montar();
    expect(await gestor.renovar()).toBe(false);
  });
});

describe('salir', () => {
  it('revoca en el servidor y borra el material local', async () => {
    const { gestor, almacen, api } = montar();
    await gestor.entrar('aperez', PASSWORD);
    const refresh = guardada(almacen).tokenRefresh;

    await gestor.salir();

    expect(api.logouts).toEqual([refresh]);
    expect(almacen.leer(CLAVE_SESION)).toBeNull();
  });

  it('sin red borra igual: no se deja un token vivo en el dispositivo', async () => {
    const { gestor, almacen, api } = montar();
    await gestor.entrar('aperez', PASSWORD);

    api.hayRed = false;
    await gestor.salir();

    expect(almacen.leer(CLAVE_SESION)).toBeNull();
  });

  it('tras salir ya no hay sesion offline (consecuencia deliberada)', async () => {
    const { gestor, api } = montar();
    await gestor.entrar('aperez', PASSWORD);
    await gestor.salir();

    api.hayRed = false;
    expect(await gestor.entrar('aperez', PASSWORD)).toEqual({
      ok: false,
      motivo: 'sin-credenciales',
    });
  });
});

describe('estado', () => {
  it('refleja lo guardado sin abrir sesion por su cuenta', async () => {
    const { gestor, tiempo } = montar();
    expect(gestor.estado()).toMatchObject({ motivo: 'sin-credenciales' });

    await gestor.entrar('aperez', PASSWORD);
    // Tras un login sigue diciendo 'reautenticacion-local': el estado describe
    // el MATERIAL guardado, no si la app esta abierta ahora. Quien decide eso
    // es el proveedor de React, que exige contrasena en cada arranque.
    expect(gestor.estado().tipo).toBe('reautenticacion-local');

    tiempo.avanzar(80 * HORA);
    expect(gestor.estado()).toMatchObject({ motivo: 'ventana-vencida' });
  });
});
