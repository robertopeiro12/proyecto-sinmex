import {
  claveReportable,
  hoyEnTijuana,
  normalizarOperacion,
  tipoReportable,
} from './operaciones';

const VENDEDOR = '11111111-1111-1111-1111-111111111111';
const HOY = '2026-08-07';

/**
 * Lo que el servidor sabe del vendedor por su cuenta (T-14).
 *
 * Hace falta para poder comprobar el [[Folios|folio]] que trae la operacion:
 * el folio repite la sucursal, el dia y el vendedor, y si esas copias no
 * coinciden con lo que el servidor ya sabe, alguien miente o la tablet tiene
 * un bug.
 */
const CTX = { sucursal: 'TJ', segmentoFolio: 'AP' } as const;

const valida = (extra: Record<string, unknown> = {}) => ({
  clave: 'c0ffee00-0000-4000-8000-000000000001',
  tipo: 'jornada',
  fecha_operacion: HOY,
  ocurrido_en: '2026-08-07T14:03:22.000-07:00',
  datos: { km_inicial: 120345 },
  ...extra,
});

describe('normalizarOperacion', () => {
  it('acepta una operacion bien formada y normaliza el instante a UTC', () => {
    const r = normalizarOperacion(valida(), VENDEDOR, HOY, CTX);
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;

    expect(r.operacion.clave).toBe('c0ffee00-0000-4000-8000-000000000001');
    expect(r.operacion.tipo).toBe('jornada');
    // El instante se normaliza a UTC porque es dato de transporte...
    expect(r.operacion.ocurridoEn).toBe('2026-08-07T21:03:22.000Z');
    // ...pero el DIA DE TRABAJO se conserva tal cual lo mando la tablet. Si se
    // derivara del instante en UTC, esta operacion de las 14:03 de Tijuana
    // seguiria siendo del dia 7, pero una de las 18:00 pasaria al dia 8 y
    // partiria la jornada en dos.
    expect(r.operacion.fechaOperacion).toBe('2026-08-07');
  });

  it('deja `datos` sin interpretar: su forma la fija el ticket de cada modulo', () => {
    const r = normalizarOperacion(
      valida({ tipo: 'venta', datos: { lo_que_sea: [1, 2, 3] } }),
      VENDEDOR,
      HOY,
      CTX,
    );
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.operacion.datos).toEqual({ lo_que_sea: [1, 2, 3] });
  });

  it('acepta los seis tipos del contrato', () => {
    for (const tipo of [
      'jornada',
      'venta',
      'cobranza',
      'gasto',
      'merma',
      'ruta',
    ]) {
      expect(normalizarOperacion(valida({ tipo }), VENDEDOR, HOY, CTX).ok).toBe(
        true,
      );
    }
  });

  describe('alcance', () => {
    it('una operacion atribuida a OTRO vendedor no se rechaza: se marca como ajena', () => {
      // Distinguirlo importa: un dato malo es un rechazo parcial, pero escribir
      // en nombre de otro vendedor es un 403 para todo el lote.
      const r = normalizarOperacion(
        valida({ vendedor_id: '22222222-2222-2222-2222-222222222222' }),
        VENDEDOR,
        HOY,
        CTX,
      );
      expect(r.ok).toBe('ajena');
    });

    it('atribuirla a uno mismo es correcto y redundante', () => {
      const r = normalizarOperacion(
        valida({ vendedor_id: VENDEDOR }),
        VENDEDOR,
        HOY,
        CTX,
      );
      expect(r.ok).toBe(true);
    });

    it('el alcance se comprueba ANTES que la validez del resto', () => {
      // Si primero se validara el formato, un lote ajeno con datos malos
      // devolveria "fecha invalida" y ocultaria el intento de escribir fuera
      // de su alcance.
      const r = normalizarOperacion(
        { vendedor_id: 'otro-vendedor', tipo: 'nada', fecha_operacion: 'ayer' },
        VENDEDOR,
        HOY,
        CTX,
      );
      expect(r.ok).toBe('ajena');
    });
  });

  describe('rechazos', () => {
    const rechaza = (op: unknown, codigo: string) => {
      const r = normalizarOperacion(op, VENDEDOR, HOY, CTX);
      expect(r.ok).toBe(false);
      if (r.ok !== false) return;
      expect(r.codigo).toBe(codigo);
    };

    it('sin clave de idempotencia', () => {
      rechaza(valida({ clave: undefined }), 'clave-invalida');
      rechaza(valida({ clave: '   ' }), 'clave-invalida');
      rechaza(valida({ clave: 42 }), 'clave-invalida');
    });

    it('con una clave absurdamente larga', () => {
      rechaza(valida({ clave: 'x'.repeat(101) }), 'clave-invalida');
    });

    it('con un tipo que este servidor no conoce', () => {
      // Es el caso de una tablet mas nueva que el servidor. Se rechaza LA
      // OPERACION, no el lote: el resto de su dia si tiene que entrar.
      rechaza(valida({ tipo: 'consumo-personal' }), 'tipo-desconocido');
      rechaza(valida({ tipo: undefined }), 'tipo-desconocido');
    });

    it('con una fecha de operacion que no es AAAA-MM-DD', () => {
      rechaza(valida({ fecha_operacion: '07/08/2026' }), 'fecha-invalida');
      rechaza(valida({ fecha_operacion: '2026-13-45' }), 'fecha-invalida');
      rechaza(
        valida({ fecha_operacion: '2026-08-07T00:00:00Z' }),
        'fecha-invalida',
      );
    });

    it('con una fecha en el futuro (reloj de la tablet mal puesto)', () => {
      rechaza(valida({ fecha_operacion: '2026-08-20' }), 'fecha-futura');
    });

    it('con un instante que no es ISO-8601', () => {
      rechaza(valida({ ocurrido_en: 'esta manana' }), 'momento-invalido');
      rechaza(valida({ ocurrido_en: undefined }), 'momento-invalido');
    });

    it('con datos que no son un objeto', () => {
      rechaza(valida({ datos: 'nada' }), 'datos-invalidos');
      rechaza(valida({ datos: [1, 2] }), 'datos-invalidos');
      rechaza(valida({ datos: undefined }), 'datos-invalidos');
    });

    it('cuando la operacion entera no es un objeto', () => {
      rechaza('esto no es una operacion', 'datos-invalidos');
      rechaza(null, 'datos-invalidos');
      rechaza([], 'datos-invalidos');
    });

    it('con un cliente_id que no es un uuid', () => {
      // NO es cosmetico. Sin esta comprobacion, `where id in ('abc')` no
      // devuelve cero filas: hace que Postgres reviente con "invalid input
      // syntax for type uuid", y eso sale como 500 para TODO el lote — el
      // todo-o-nada que este contrato promete no hacer. Y la tablet traduce un
      // 5xx a "sin red", asi que reintentaria ese lote para siempre, callada.
      rechaza(
        valida({ tipo: 'venta', cliente_id: 'no-soy-uuid' }),
        'cliente-fuera-de-alcance',
      );
      rechaza(
        valida({ tipo: 'venta', cliente_id: '123' }),
        'cliente-fuera-de-alcance',
      );
      rechaza(
        valida({ tipo: 'venta', cliente_id: "' or 1=1 --" }),
        'cliente-fuera-de-alcance',
      );
    });
  });

  describe('cliente_id', () => {
    it('un uuid bien formado pasa (el alcance se comprueba luego, contra la base)', () => {
      const r = normalizarOperacion(
        valida({
          tipo: 'venta',
          cliente_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        }),
        VENDEDOR,
        HOY,
        CTX,
      );
      expect(r.ok).toBe(true);
      if (r.ok !== true) return;
      expect(r.operacion.clienteId).toBe(
        '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      );
    });

    it('acepta mayusculas: un uuid no distingue caja', () => {
      expect(
        normalizarOperacion(
          valida({ cliente_id: '3F2504E0-4F89-41D3-9A0C-0305E82C3301' }),
          VENDEDOR,
          HOY,
          CTX,
        ).ok,
      ).toBe(true);
    });

    it('sin cliente_id es correcto: una jornada o un gasto no tienen cliente', () => {
      const r = normalizarOperacion(valida(), VENDEDOR, HOY, CTX);
      expect(r.ok).toBe(true);
      if (r.ok !== true) return;
      expect(r.operacion.clienteId).toBeNull();
    });
  });

  describe('tolerancia del reloj', () => {
    it('acepta el dia siguiente: una jornada puede cerrarse pasada la medianoche', () => {
      expect(
        normalizarOperacion(
          valida({ fecha_operacion: '2026-08-08' }),
          VENDEDOR,
          HOY,
          CTX,
        ).ok,
      ).toBe(true);
    });

    it('acepta fechas viejas sin limite: una tablet puede pasar dos semanas sin WiFi', () => {
      expect(
        normalizarOperacion(
          valida({ fecha_operacion: '2026-07-20' }),
          VENDEDOR,
          HOY,
          CTX,
        ).ok,
      ).toBe(true);
    });

    it('rechaza dos dias adelante', () => {
      const r = normalizarOperacion(
        valida({ fecha_operacion: '2026-08-09' }),
        VENDEDOR,
        HOY,
        CTX,
      );
      expect(r.ok).toBe(false);
    });

    it('cruza bien el fin de mes al sumar la tolerancia', () => {
      expect(
        normalizarOperacion(
          valida({ fecha_operacion: '2026-09-01' }),
          VENDEDOR,
          '2026-08-31',
        ).ok,
      ).toBe(true);
      expect(
        normalizarOperacion(
          valida({ fecha_operacion: '2026-09-02' }),
          VENDEDOR,
          '2026-08-31',
        ).ok,
      ).toBe(false);
    });
  });
});

describe('hoyEnTijuana', () => {
  it('a las 18:00 de Tijuana el dia sigue siendo el 7, aunque en UTC ya sea el 8', () => {
    // 2026-08-08T01:00Z = 2026-08-07 18:00 en Tijuana (UTC-7 en verano).
    // Es EL caso que justifica todo el diseno: el "dia" del vendedor es un
    // concepto de negocio, no un dia UTC.
    const instante = new Date('2026-08-08T01:00:00.000Z');
    expect(hoyEnTijuana(instante)).toBe('2026-08-07');
    expect(instante.toISOString().slice(0, 10)).toBe('2026-08-08');
  });

  it('devuelve el formato AAAA-MM-DD que usa el resto del sistema', () => {
    expect(hoyEnTijuana(new Date('2026-01-05T20:00:00.000Z'))).toBe(
      '2026-01-05',
    );
  });
});

describe('reportar operaciones ilegibles', () => {
  it('usa la posicion cuando ni la clave se puede leer', () => {
    expect(claveReportable(null, 3)).toBe('#3');
    expect(claveReportable({ clave: 'abc' }, 3)).toBe('abc');
    expect(tipoReportable({ tipo: 'venta' })).toBe('venta');
    expect(tipoReportable(null)).toBe('');
  });
});
