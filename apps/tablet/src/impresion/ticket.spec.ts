import { armarTicket, estadoTicket, type DatosTicket } from './ticket';

/**
 * Los momentos se arman con componentes LOCALES (como en `momento.spec.ts`) para
 * que "11:58" salga igual en Tijuana, en UTC o en el CI.
 */
const VENDIDA = new Date(2026, 10, 18, 11, 58).toISOString();
const REIMPRESA = new Date(2026, 10, 25, 10, 20).toISOString();

/** La nota de las maquetas 25-27. */
function nota(cambios: Partial<DatosTicket> = {}): DatosTicket {
  return {
    sucursal: 'Sucursal Tijuana Centro',
    folio: 'TJ261118JP05',
    momento: VENDIDA,
    cliente: 'Tienda Doña Chuy',
    atendio: 'María de Jesús Ramos',
    vendedor: 'Juan Pérez',
    renglones: [
      { cantidad: 12, etiqueta: 'Jamaica 500 ml', precioCentavos: 1800, importeCentavos: 21600 },
      { cantidad: 6, etiqueta: 'Jamaica 1 L', precioCentavos: 3200, importeCentavos: 19200 },
      { cantidad: 6, etiqueta: 'Horchata 500 ml', precioCentavos: 1800, importeCentavos: 10800 },
      { cantidad: 12, etiqueta: 'Mango 500 ml', precioCentavos: 2400, importeCentavos: 28800 },
    ],
    promociones: [
      { cantidad: 4, etiqueta: 'Mango 500 ml', texto: 'Por cada 6 Mango 500 ml, 2 Mango 500 ml gratis' },
    ],
    totalCentavos: 80400,
    abonos: [],
    saldoCentavos: 0,
    reimpresion: null,
    detalleDisponible: true,
    ...cambios,
  };
}

// Escrito a mano, una vez: es el contrato que consume el controlador de la impresora.
const ENCABEZADO_32 = [
  '              JAWA',
  '    Sucursal Tijuana Centro',
  '         NOTA DE VENTA',
  'Folio               TJ261118JP05',
  'Fecha        18 nov 2026 · 11:58',
  '--------------------------------',
  'Cliente         Tienda Doña Chuy',
  'Atendió     María de Jesús Ramos',
  'Vendedor              Juan Pérez',
  '--------------------------------',
];

const TABLA_32 = [
  'Cant Producto       P.U. Importe',
  '  12 Jamaica 500   18.00  216.00',
  '     ml',
  '   6 Jamaica 1 L   32.00  192.00',
  '   6 Horchata 500  18.00  108.00',
  '     ml',
  '  12 Mango 500 ml  24.00  288.00',
  '   4 Mango 500 ml  PROMO    0.00',
  '     Por cada 6 Mango 500 ml, 2',
  '     Mango 500 ml gratis',
  '--------------------------------',
  'Piezas                        40',
  'TOTAL                    $804.00',
];

const FIRMA_32 = [
  '--------------------------------',
  '',
  '',
  '',
  '    ________________________',
  '     Firma de quien recibe',
  '',
  '     Gracias por su compra',
];

describe('estadoTicket', () => {
  it('saldo 0 es LIQUIDADA', () => {
    expect(estadoTicket(nota())).toBe('LIQUIDADA');
  });

  it('con abonos y saldo es ABONADO', () => {
    expect(estadoTicket(nota({ abonos: [{ fecha: '2026-11-18', montoCentavos: 30000 }], saldoCentavos: 50400 }))).toBe(
      'ABONADO',
    );
  });

  it('sin abonos y con todo el total como saldo es CRÉDITO', () => {
    expect(estadoTicket(nota({ saldoCentavos: 80400 }))).toBe('CRÉDITO');
  });

  it('una venta solo de promoción (total 0) es LIQUIDADA, no CRÉDITO', () => {
    expect(estadoTicket(nota({ renglones: [], totalCentavos: 0, saldoCentavos: 0 }))).toBe('LIQUIDADA');
  });
});

describe('armarTicket a 32 columnas (maquetas 25-27)', () => {
  it('25 · Venta liquidada: Pagó, saldo $0.00 y sin espacio de firma', () => {
    expect(armarTicket(nota(), 32)).toEqual([
      ...ENCABEZADO_32,
      ...TABLA_32,
      'Pagó                     $804.00',
      'Saldo pendiente            $0.00',
      '',
      '       *** LIQUIDADA ***',
      '',
      '     Gracias por su compra',
    ]);
  });

  it('nota de la oficina (momento sin hora): la Fecha es solo el dia de la nota', () => {
    expect(armarTicket(nota({ momento: '2026-10-25' }), 32)).toContain('Fecha                25 oct 2026');
  });

  it('26 · Venta con abono: lista de abonos, SALDO PENDIENTE, ABONADO y firma', () => {
    const d = nota({ abonos: [{ fecha: '2026-11-18', montoCentavos: 30000 }], saldoCentavos: 50400 });
    expect(armarTicket(d, 32)).toEqual([
      ...ENCABEZADO_32,
      ...TABLA_32,
      '--------------------------------',
      'Abonos',
      '18 nov 2026              $300.00',
      'SALDO PENDIENTE          $504.00',
      '',
      '        *** ABONADO ***',
      '',
      ...FIRMA_32,
    ]);
  });

  it('27 · Reimpresión al abonar después: los dos abonos, la fecha de reimpresión y quién cobró', () => {
    const d = nota({
      abonos: [
        { fecha: '2026-11-18', montoCentavos: 30000 },
        { fecha: '2026-11-25', montoCentavos: 20000 },
      ],
      saldoCentavos: 30400,
      reimpresion: { momento: REIMPRESA, cobro: 'Juan Pérez' },
    });
    expect(armarTicket(d, 32)).toEqual([
      ...ENCABEZADO_32,
      ...TABLA_32,
      '--------------------------------',
      'Abonos',
      '18 nov 2026              $300.00',
      '25 nov 2026              $200.00',
      'SALDO PENDIENTE          $304.00',
      '',
      '        *** ABONADO ***',
      '',
      'Reimpresión  25 nov 2026 · 10:20',
      'Cobró                 Juan Pérez',
      ...FIRMA_32,
    ]);
  });

  it('CRÉDITO: sin renglón "Abonos", todo el total como saldo y con firma', () => {
    expect(armarTicket(nota({ saldoCentavos: 80400 }), 32)).toEqual([
      ...ENCABEZADO_32,
      ...TABLA_32,
      '--------------------------------',
      'SALDO PENDIENTE          $804.00',
      '',
      '        *** CRÉDITO ***',
      '',
      ...FIRMA_32,
    ]);
  });

  it('LIQUIDADA al reimprimir por el último cobro: Reimpresión y Cobró, sin firma', () => {
    const d = nota({
      abonos: [{ fecha: '2026-11-18', montoCentavos: 80400 }],
      reimpresion: { momento: REIMPRESA, cobro: 'Juan Pérez' },
    });
    expect(armarTicket(d, 32)).toEqual([
      ...ENCABEZADO_32,
      ...TABLA_32,
      'Pagó                     $804.00',
      'Saldo pendiente            $0.00',
      '',
      '       *** LIQUIDADA ***',
      '',
      'Reimpresión  25 nov 2026 · 10:20',
      'Cobró                 Juan Pérez',
      '',
      '     Gracias por su compra',
    ]);
  });

  it('sin quien atendió no imprime el renglón Atendió', () => {
    expect(armarTicket(nota({ atendio: null }), 32).some((l) => l.startsWith('Atendió'))).toBe(false);
  });

  it('sin detalle en esta tablet: un aviso (cortado por palabras) en lugar de la tabla, sin Piezas', () => {
    const d = nota({ renglones: [], promociones: [], detalleDisponible: false });
    expect(armarTicket(d, 32)).toEqual([
      ...ENCABEZADO_32,
      'Detalle no disponible en esta',
      'tablet',
      '--------------------------------',
      'TOTAL                    $804.00',
      'Pagó                     $804.00',
      'Saldo pendiente            $0.00',
      '',
      '       *** LIQUIDADA ***',
      '',
      '     Gracias por su compra',
    ]);
  });

  it('venta solo de promoción: LIQUIDADA con Pagó $0.00', () => {
    const d = nota({ renglones: [], totalCentavos: 0 });
    const t = armarTicket(d, 32);
    expect(t).toContain('Pagó                       $0.00');
    expect(t).toContain('       *** LIQUIDADA ***');
    expect(t).toContain('Piezas                         4');
  });
});

describe('armarTicket: nada se sale del papel', () => {
  const LARGO = 'Distribuidoras de Abarrotes y Bebidas La Esperanza del Norte'; // 60
  const largos = nota({
    sucursal: LARGO,
    cliente: LARGO,
    atendio: LARGO,
    vendedor: LARGO,
    renglones: [{ cantidad: 120, etiqueta: LARGO, precioCentavos: 123456, importeCentavos: 14814720 }],
    promociones: [{ cantidad: 4, etiqueta: LARGO, texto: `${LARGO} ${LARGO}` }],
    totalCentavos: 14814720,
    abonos: [{ fecha: '2026-11-18', montoCentavos: 100000 }],
    saldoCentavos: 14714720,
    reimpresion: { momento: REIMPRESA, cobro: LARGO },
  });

  it.each([32, 48] as const)('a %i columnas ningún renglón pasa del ancho ni deja espacios al final', (columnas) => {
    for (const d of [nota(), largos]) {
      for (const l of armarTicket(d, columnas)) {
        expect(l.length).toBeLessThanOrEqual(columnas);
        expect(l).toBe(l.trimEnd());
      }
    }
  });

  it('el cliente de 60 caracteres se corta; el producto pasa al renglón de abajo; el dinero nunca', () => {
    expect(LARGO).toHaveLength(60);
    const t = armarTicket(largos, 32);
    expect(t).toContain('Cliente Distribuidoras de Abarro');
    const i = t.indexOf(' 120 Distrib 1,234.56 148,147.20');
    expect(i).toBeGreaterThan(-1);
    // El nombre del producto nunca se pierde: sigue en renglones sangrados, sin montos.
    expect(t.slice(i + 1, i + 4)).toEqual([
      '     uidoras de Abarrotes y',
      '     Bebidas La Esperanza del',
      '     Norte',
    ]);
    expect(t).toContain('TOTAL                $148,147.20');
  });

  it('una promoción de nombre largo también sigue abajo, antes de su frase', () => {
    const d = nota({
      renglones: [],
      promociones: [{ cantidad: 2, etiqueta: 'Tamarindo natural 500 ml', texto: 'Regalo de bienvenida' }],
      totalCentavos: 0,
    });
    const t = armarTicket(d, 32);
    const i = t.indexOf('   2 Tamarindo     PROMO    0.00');
    expect(t.slice(i, i + 4)).toEqual([
      '   2 Tamarindo     PROMO    0.00',
      '     natural 500 ml',
      '     Regalo de bienvenida',
      '--------------------------------',
    ]);
  });

  it('a 48 columnas los nombres de la maqueta caben completos', () => {
    const t = armarTicket(nota(), 48);
    expect(t).toContain('  12 Jamaica 500 ml'+' '.repeat(16)+'18.00  216.00');
    expect(t).toContain('   6 Horchata 500 ml'+' '.repeat(15)+'18.00  108.00');
    expect(t).toContain('Cant Producto'+' '.repeat(23)+'P.U. Importe');
  });
});
