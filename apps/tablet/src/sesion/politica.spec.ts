import {
  INTENTOS_LOCALES_MAX,
  TOLERANCIA_RELOJ_MS,
  accesoVigente,
  conIntentoFallido,
  conIntentosLimpios,
  evaluarSesion,
  intentosRestantes,
  restanteOfflineMs,
  type SesionGuardada,
} from './politica';

/** Momento de referencia: 08:00 en Tijuana (UTC-7), el vendedor sale a ruta. */
const SALIDA = '2026-08-07T15:00:00.000Z';

const HORA = 60 * 60 * 1000;

function mas(momento: string, ms: number): string {
  return new Date(Date.parse(momento) + ms).toISOString();
}

function sesion(cambios: Partial<SesionGuardada> = {}): SesionGuardada {
  return {
    vendedor: {
      id: 'ven-1',
      login: 'aperez',
      nombre: 'Abraham Perez',
      sucursalId: 'suc-tj',
      sucursalCodigo: 'TJ',
      sucursalNombre: 'Tijuana',
    },
    tokenAcceso: 'jwt-de-acceso',
    accesoExpiraEn: mas(SALIDA, 12 * HORA),
    tokenRefresh: 'refresh-opaco',
    sesionExpiraEn: mas(SALIDA, 7 * 24 * HORA),
    ultimoContactoServidor: SALIDA,
    politica: { ventanaOfflineHoras: 72, costeVerificador: 60_000 },
    verificador: 'pbkdf2-sha256$60000$aabb$ccdd',
    intentosFallidos: 0,
    ...cambios,
  };
}

describe('evaluarSesion — sin material local', () => {
  it('sin sesion guardada exige red', () => {
    expect(evaluarSesion(null, SALIDA)).toEqual({
      tipo: 'requiere-red',
      motivo: 'sin-credenciales',
      vendedor: null,
    });
  });

  it('una sesion con fechas ilegibles se trata como inexistente, no como valida', () => {
    // Una entrada corrupta que se colara como valida abriria la app sin haber
    // comprobado ninguno de los tres limites.
    const rota = evaluarSesion(sesion({ sesionExpiraEn: 'no-es-una-fecha' }), SALIDA);
    expect(rota).toMatchObject({ tipo: 'requiere-red', motivo: 'sin-credenciales' });
  });
});

describe('evaluarSesion — la jornada normal', () => {
  it('permite re-autenticar localmente al salir a ruta', () => {
    const estado = evaluarSesion(sesion(), mas(SALIDA, 1000));
    expect(estado.tipo).toBe('reautenticacion-local');
  });

  it('sigue permitiendolo 12 horas despues, con el access token YA VENCIDO', () => {
    // Este es el caso que define el ticket: el vendedor lleva todo el dia sin
    // red, el JWT de acceso caduco hace rato, y aun asi tiene que poder
    // reabrir su app. El vencimiento del acceso NO decide la sesion offline.
    const s = sesion({ accesoExpiraEn: mas(SALIDA, 2 * HORA) });
    const alCierre = mas(SALIDA, 12 * HORA);

    expect(accesoVigente(s, alCierre)).toBe(false);
    expect(evaluarSesion(s, alCierre).tipo).toBe('reautenticacion-local');
  });

  it('reiniciar la tablet a media manana no cambia nada (la decision no usa memoria)', () => {
    // evaluarSesion es pura sobre lo guardado: un reinicio no le quita nada.
    const s = sesion();
    expect(evaluarSesion(s, mas(SALIDA, 4 * HORA)).tipo).toBe('reautenticacion-local');
    expect(evaluarSesion(s, mas(SALIDA, 4 * HORA)).tipo).toBe('reautenticacion-local');
  });
});

describe('evaluarSesion — ventana maxima sin contacto con el servidor', () => {
  it('aguanta justo hasta el limite de la ventana', () => {
    const s = sesion({ politica: { ventanaOfflineHoras: 72, costeVerificador: 1 } });
    expect(evaluarSesion(s, mas(SALIDA, 72 * HORA - 1)).tipo).toBe('reautenticacion-local');
  });

  it('exige red en el instante EXACTO en que se cumple la ventana', () => {
    const s = sesion({ politica: { ventanaOfflineHoras: 72, costeVerificador: 1 } });
    expect(evaluarSesion(s, mas(SALIDA, 72 * HORA))).toMatchObject({
      tipo: 'requiere-red',
      motivo: 'ventana-vencida',
    });
  });

  it('la ventana se mide desde el ULTIMO contacto, no desde el login', () => {
    // Sincronizar a media jornada (T-07) tiene que correr la ventana hacia
    // adelante; si se midiera desde el login, sincronizar no serviria de nada.
    const s = sesion({ ultimoContactoServidor: mas(SALIDA, 48 * HORA) });
    expect(evaluarSesion(s, mas(SALIDA, 100 * HORA)).tipo).toBe('reautenticacion-local');
  });

  it('una ventana mas corta la acorta de verdad (el numero lo manda el servidor)', () => {
    const s = sesion({ politica: { ventanaOfflineHoras: 24, costeVerificador: 1 } });
    expect(evaluarSesion(s, mas(SALIDA, 23 * HORA)).tipo).toBe('reautenticacion-local');
    expect(evaluarSesion(s, mas(SALIDA, 25 * HORA))).toMatchObject({
      motivo: 'ventana-vencida',
    });
  });
});

describe('evaluarSesion — vencimiento de la sesion del servidor', () => {
  it('una sesion vencida en el servidor exige red aunque la ventana siga abierta', () => {
    // Manda el mas estricto de los dos limites.
    const s = sesion({
      sesionExpiraEn: mas(SALIDA, 2 * HORA),
      politica: { ventanaOfflineHoras: 72, costeVerificador: 1 },
    });
    expect(evaluarSesion(s, mas(SALIDA, 3 * HORA))).toMatchObject({
      tipo: 'requiere-red',
      motivo: 'sesion-vencida',
    });
  });

  it('`validaHasta` reporta el mas estricto de los dos limites', () => {
    const cortaPorSesion = evaluarSesion(
      sesion({
        sesionExpiraEn: mas(SALIDA, 5 * HORA),
        politica: { ventanaOfflineHoras: 72, costeVerificador: 1 },
      }),
      SALIDA,
    );
    expect(cortaPorSesion).toMatchObject({ validaHasta: mas(SALIDA, 5 * HORA) });

    const cortaPorVentana = evaluarSesion(
      sesion({
        sesionExpiraEn: mas(SALIDA, 7 * 24 * HORA),
        politica: { ventanaOfflineHoras: 10, costeVerificador: 1 },
      }),
      SALIDA,
    );
    expect(cortaPorVentana).toMatchObject({ validaHasta: mas(SALIDA, 10 * HORA) });
  });
});

describe('evaluarSesion — reloj del dispositivo', () => {
  it('tolera un desfase pequeno hacia atras (correccion de NTP)', () => {
    const antes = mas(SALIDA, -(TOLERANCIA_RELOJ_MS - 1000));
    expect(evaluarSesion(sesion(), antes).tipo).toBe('reautenticacion-local');
  });

  it('exige red si el reloj se atraso mucho: es como se estiraria la ventana offline', () => {
    // Atrasar la fecha del dispositivo es la forma trivial de hacer eterna la
    // ventana sin contacto. No se puede impedir (no hay reloj monotono), pero
    // si se puede detectar que el reloj quedo ANTES del ultimo contacto real.
    const muyAntes = mas(SALIDA, -30 * 24 * HORA);
    expect(evaluarSesion(sesion(), muyAntes)).toMatchObject({
      tipo: 'requiere-red',
      motivo: 'reloj-inconsistente',
    });
  });
});

describe('evaluarSesion — intentos locales', () => {
  it('agotados los intentos, exige red', () => {
    const s = sesion({ intentosFallidos: INTENTOS_LOCALES_MAX });
    expect(evaluarSesion(s, SALIDA)).toMatchObject({
      tipo: 'requiere-red',
      motivo: 'intentos-agotados',
    });
  });

  it('con un intento menos todavia deja probar', () => {
    const s = sesion({ intentosFallidos: INTENTOS_LOCALES_MAX - 1 });
    expect(evaluarSesion(s, SALIDA).tipo).toBe('reautenticacion-local');
    expect(intentosRestantes(s)).toBe(1);
  });

  it('los intentos se cuentan y se limpian', () => {
    const s = sesion();
    expect(conIntentoFallido(s).intentosFallidos).toBe(1);
    expect(conIntentosLimpios(conIntentoFallido(s)).intentosFallidos).toBe(0);
    // Sin cambios, devuelve el mismo objeto: evita renders inutiles en React.
    expect(conIntentosLimpios(s)).toBe(s);
  });

  it('los intentos pesan MAS que el resto: se comprueban primero', () => {
    // Si el orden fuera al reves, alguien con la tablet podria esperar a que
    // venciera la ventana y volver a tener intentos frescos tras un login.
    const s = sesion({ intentosFallidos: INTENTOS_LOCALES_MAX, sesionExpiraEn: SALIDA });
    expect(evaluarSesion(s, mas(SALIDA, HORA))).toMatchObject({ motivo: 'intentos-agotados' });
  });
});

describe('restanteOfflineMs', () => {
  it('cuenta lo que falta y llega a cero al vencer', () => {
    const s = sesion({ politica: { ventanaOfflineHoras: 10, costeVerificador: 1 } });
    expect(restanteOfflineMs(s, SALIDA)).toBe(10 * HORA);
    expect(restanteOfflineMs(s, mas(SALIDA, 9 * HORA))).toBe(HORA);
    expect(restanteOfflineMs(s, mas(SALIDA, 10 * HORA))).toBe(0);
    expect(restanteOfflineMs(null, SALIDA)).toBe(0);
  });
});

describe('accesoVigente', () => {
  it('descuenta un margen para no salir con un token que vence en el camino', () => {
    const s = sesion({ accesoExpiraEn: mas(SALIDA, 60_000) });
    expect(accesoVigente(s, SALIDA)).toBe(true);
    // A 20 s del vencimiento ya se considera no vigente (margen de 30 s).
    expect(accesoVigente(s, mas(SALIDA, 40_000))).toBe(false);
  });
});
