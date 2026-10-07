import {
  MOTIVO_CON_COBROS,
  MOTIVO_CUENTA_PERDIDA,
  accionesDeVenta,
  bloqueoDeEdicion,
  sePuedeMarcarPerdida,
  type AccionesVenta,
} from './acciones-venta';

describe('accionesDeVenta: lo que se puede hacer con una venta viva (T-17 parte 2, §3.2)', () => {
  const casos: [string, number, AccionesVenta][] = [
    [
      'pendiente',
      0,
      { editable: true, motivoNoEditable: null, puedeMarcarPerdida: true },
    ],
    [
      'pagada',
      0,
      { editable: true, motivoNoEditable: null, puedeMarcarPerdida: false },
    ],
    [
      'promocion',
      0,
      { editable: true, motivoNoEditable: null, puedeMarcarPerdida: false },
    ],
    [
      'abonado',
      1,
      {
        editable: false,
        motivoNoEditable: MOTIVO_CON_COBROS,
        puedeMarcarPerdida: true,
      },
    ],
    // Credito liquidada con cobros de la tablet: pagada, pero con abonos.
    [
      'pagada',
      2,
      {
        editable: false,
        motivoNoEditable: MOTIVO_CON_COBROS,
        puedeMarcarPerdida: false,
      },
    ],
    [
      'cuenta_perdida',
      0,
      {
        editable: false,
        motivoNoEditable: MOTIVO_CUENTA_PERDIDA,
        puedeMarcarPerdida: false,
      },
    ],
    [
      'cuenta_perdida',
      1,
      {
        editable: false,
        motivoNoEditable: MOTIVO_CON_COBROS,
        puedeMarcarPerdida: false,
      },
    ],
  ];

  it.each(casos)('%s con %i abonos de cobranza', (status, abonos, esperado) => {
    expect(accionesDeVenta(status, abonos, null)).toEqual(esperado);
  });

  it('el motivo con cobros es el texto que pide el spec', () => {
    expect(MOTIVO_CON_COBROS).toBe(
      'Esta venta tiene cobros registrados: no se puede editar ni eliminar. Para quitar un cobro, ver Peticiones.',
    );
  });
});

describe('bloqueoDeEdicion: el 409 de PATCH y DELETE', () => {
  it('viva y sin abonos de cobranza: se puede', () => {
    expect(bloqueoDeEdicion('pagada', 0, 'editar', null)).toBeNull();
    expect(bloqueoDeEdicion('pendiente', 0, 'eliminar', null)).toBeNull();
  });

  it('con abonos de cobranza: dice que accion no se puede', () => {
    expect(bloqueoDeEdicion('abonado', 1, 'editar', null)).toBe(
      'Tiene cobros registrados: no se puede editar.',
    );
    expect(bloqueoDeEdicion('abonado', 1, 'eliminar', null)).toBe(
      'Tiene cobros registrados: no se puede eliminar.',
    );
  });

  it('una cuenta perdida no se edita ni se elimina (no hay deshacer, §6)', () => {
    expect(bloqueoDeEdicion('cuenta_perdida', 0, 'editar', null)).toBe(
      'Está marcada como cuenta perdida: no se puede editar.',
    );
  });
});

describe('venta facturada (T-19)', () => {
  it('no se edita ni se elimina, y el motivo nombra la factura', () => {
    expect(accionesDeVenta('pendiente', 0, 'A780')).toEqual({
      editable: false,
      motivoNoEditable:
        'Esta venta está en la factura A780: quítala primero de la factura para editarla o eliminarla.',
      puedeMarcarPerdida: true,
    });
    expect(bloqueoDeEdicion('pendiente', 0, 'editar', 'A780')).toBe(
      'Está en la factura A780: quítala primero de la factura para editarla.',
    );
    expect(bloqueoDeEdicion('pagada', 0, 'eliminar', 'A780')).toBe(
      'Está en la factura A780: quítala primero de la factura.',
    );
  });

  it('los cobros mandan sobre la factura en el mensaje', () => {
    expect(bloqueoDeEdicion('abonado', 1, 'editar', 'A780')).toBe(
      'Tiene cobros registrados: no se puede editar.',
    );
  });

  it('sin factura, todo sigue igual', () => {
    expect(bloqueoDeEdicion('pendiente', 0, 'editar', null)).toBeNull();
  });
});

describe('sePuedeMarcarPerdida (§4.4)', () => {
  const casos: [string, boolean][] = [
    ['pendiente', true],
    ['abonado', true],
    ['pagada', false],
    ['promocion', false],
    ['cuenta_perdida', false],
  ];

  it.each(casos)('%s → %s', (status, esperado) => {
    expect(sePuedeMarcarPerdida(status)).toBe(esperado);
  });
});
