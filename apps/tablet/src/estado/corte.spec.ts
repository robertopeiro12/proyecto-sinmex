import type { NotaAsignadaDeHoy } from '@/datos/notas-asignadas-reglas';
import type { NotaQueTrae } from '@/datos/repositorios/notas-asignadas';
import type { SistemaCorte } from '@/datos/repositorios/cortes';

import {
  apartadosDesactualizados,
  capturaParaEnviar,
  corteDisponible,
  efectivoEsperado,
  huellaApartado,
  inventarioCapturado,
  inventarioDelCorte,
  leerPiezas,
  notasDelCorte,
  puedeEnviarCorte,
  resumenDelDia,
  textoApartadoCambio,
  textoFaltanPorVisitar,
  textoMontoCaptura,
  textoNotasQueTraes,
  textoResumenVisitados,
  type Apartado,
} from './corte';

// Maqueta 22: contado 3,360 + abonos y cobros 1,550 (abono al vender 300 +
// cobros en efectivo 1,250) − gastos 585 = debe traer 4,325. Ventas 5,930.
const VENTAS = [
  { contado_credito: 'contado' as const, monto_total_centavos: 200000, abono_centavos: null },
  { contado_credito: 'contado' as const, monto_total_centavos: 136000, abono_centavos: null },
  { contado_credito: 'credito' as const, monto_total_centavos: 124000, abono_centavos: 30000 },
  { contado_credito: 'credito' as const, monto_total_centavos: 62400, abono_centavos: null },
  { contado_credito: 'credito' as const, monto_total_centavos: 70600, abono_centavos: null },
];
const COBROS = [
  { metodo_pago: 'efectivo' as const, monto_centavos: 85000 },
  { metodo_pago: 'efectivo' as const, monto_centavos: 40000 },
];
const GASTOS = [{ monto_centavos: 50000 }, { monto_centavos: 8500 }];

describe('efectivoEsperado (maqueta 22)', () => {
  it('contado + abonos al vender + cobros en efectivo − gastos', () => {
    expect(efectivoEsperado({ ventas: VENTAS, cobros: COBROS, gastos: GASTOS })).toEqual({
      contadoCentavos: 336000,
      abonosCentavos: 30000,
      cobrosEfectivoCentavos: 125000,
      abonosYCobrosCentavos: 155000,
      gastosCentavos: 58500,
      debeTraerCentavos: 432500,
      otrosMetodosCentavos: 0,
    });
  });

  it('transferencia y cheque van aparte: no suman a lo que debe traer', () => {
    const r = efectivoEsperado({
      ventas: VENTAS,
      cobros: [
        ...COBROS,
        { metodo_pago: 'transferencia', monto_centavos: 20000 },
        { metodo_pago: 'cheque', monto_centavos: 15000 },
      ],
      gastos: GASTOS,
    });
    expect(r.debeTraerCentavos).toBe(432500);
    expect(r.otrosMetodosCentavos).toBe(35000);
  });

  it('un abono en una venta de contado no cuenta dos veces', () => {
    const r = efectivoEsperado({
      ventas: [{ contado_credito: 'contado', monto_total_centavos: 10000, abono_centavos: 10000 }],
      cobros: [],
      gastos: [],
    });
    expect(r).toMatchObject({ contadoCentavos: 10000, abonosCentavos: 0, debeTraerCentavos: 10000 });
  });

  it('sin nada, debe traer 0; con solo gastos, negativo', () => {
    expect(efectivoEsperado({ ventas: [], cobros: [], gastos: [] }).debeTraerCentavos).toBe(0);
    expect(efectivoEsperado({ ventas: [], cobros: [], gastos: GASTOS }).debeTraerCentavos).toBe(-58500);
  });
});

describe('resumenDelDia (maqueta 22)', () => {
  it('ventas de todo tipo, cobranza de todos los métodos, gastos y visitados', () => {
    expect(
      resumenDelDia({
        ventas: VENTAS,
        cobros: [...COBROS],
        gastos: GASTOS,
        porVisitar: [],
        visitados: [1, 2, 3, 4, 5, 6],
      }),
    ).toEqual({ ventasCentavos: 593000, cobranzaCentavos: 125000, gastosCentavos: 58500, visitados: 6, total: 6 });
  });

  it('cuenta los por visitar en el total', () => {
    const r = resumenDelDia({ ventas: [], cobros: [], gastos: [], porVisitar: [1, 2], visitados: [3] });
    expect(r).toMatchObject({ visitados: 1, total: 3 });
    expect(textoResumenVisitados(r)).toBe('Resumen del día · 1 de 3 visitados');
  });
});

// Maqueta 23: cuatro notas, tres palomeadas.
const asignada = (cambios: Partial<NotaAsignadaDeHoy>): NotaAsignadaDeHoy => ({
  asignacionId: 'asg',
  ventaNotaId: 'nota',
  clienteId: 'cli-esperanza',
  folio: 'F',
  fecha: '2026-10-30',
  saldoCentavos: 0,
  diasAtraso: 0,
  condicion: 'ninguna',
  tocadaHoy: false,
  liquidadaHoy: false,
  comentadaHoy: false,
  ...cambios,
});
const NOMBRES = new Map([
  ['cli-esperanza', 'Abarrotes La Esperanza'],
  ['cli-chuy', 'Tienda Doña Chuy'],
]);

describe('notasDelCorte (maqueta 23)', () => {
  const asignadas = [
    // Liquidada hoy; el pull todavia trae su saldo viejo.
    asignada({ asignacionId: 'a1', ventaNotaId: 'n1', folio: 'TJ261030JP04', saldoCentavos: 85000, tocadaHoy: true, liquidadaHoy: true }),
    // Abono 400; el pull aun no lo refleja (saldo 1,120).
    asignada({ asignacionId: 'a2', ventaNotaId: 'n2', clienteId: 'cli-chuy', folio: 'TJ261103JP07', fecha: '2026-11-03', saldoCentavos: 112000, tocadaHoy: true }),
  ];
  const queTrae: NotaQueTrae[] = [
    { origen: 'asignada', clienteId: 'cli-chuy', folio: 'TJ261103JP07', ventaNotaId: 'n2', ventaId: null, saldoCentavos: 112000, fecha: '2026-11-03' },
    { origen: 'nueva', clienteId: 'cli-esperanza', folio: 'TJ261118JP02', ventaNotaId: null, ventaId: 'v1', saldoCentavos: 94000, fecha: '2026-11-18' },
    { origen: 'nueva', clienteId: 'cli-chuy', folio: 'TJ261118JP05', ventaNotaId: null, ventaId: 'v2', saldoCentavos: 62400, fecha: '2026-11-18' },
  ];
  const cobros = [
    { reparto_json: JSON.stringify([{ venta_nota_id: 'n1', monto_centavos: 85000, saldo_despues_centavos: 0 }]) },
    { reparto_json: JSON.stringify([{ venta_nota_id: 'n2', monto_centavos: 40000, saldo_despues_centavos: 72000 }]) },
  ];

  it('asignadas (liquidada incluida) y luego las nuevas, con estado y saldo', () => {
    const renglones = notasDelCorte({ asignadas, queTrae, cobros, nombres: NOMBRES });
    expect(renglones).toEqual([
      {
        clave: 'nota:TJ261030JP04',
        folio: 'TJ261030JP04',
        cliente: 'Abarrotes La Esperanza',
        estado: 'liquidada',
        detalle: 'liquidada',
        montoTexto: '$0.00',
        saldoCentavos: 0,
      },
      {
        clave: 'nota:TJ261103JP07',
        folio: 'TJ261103JP07',
        cliente: 'Tienda Doña Chuy',
        estado: 'abonó',
        detalle: 'abonó $400.00',
        montoTexto: '$720.00',
        saldoCentavos: 72000,
      },
      {
        clave: 'nota:TJ261118JP02',
        folio: 'TJ261118JP02',
        cliente: 'Abarrotes La Esperanza',
        estado: 'nueva',
        detalle: 'nueva',
        montoTexto: '$940.00',
        saldoCentavos: 94000,
      },
      {
        clave: 'nota:TJ261118JP05',
        folio: 'TJ261118JP05',
        cliente: 'Tienda Doña Chuy',
        estado: 'nueva',
        detalle: 'nueva',
        montoTexto: '$624.00',
        saldoCentavos: 62400,
      },
    ]);
    const palomeadas = new Set(['nota:TJ261030JP04', 'nota:TJ261103JP07', 'nota:TJ261118JP02']);
    expect(textoNotasQueTraes(renglones, palomeadas)).toBe('3 de 4');
  });

  it('una asignada sin tocar con saldo es pendiente', () => {
    const [r] = notasDelCorte({
      asignadas: [asignada({ ventaNotaId: 'n3', folio: 'F3', saldoCentavos: 50000 })],
      queTrae: [{ origen: 'asignada', clienteId: 'cli-esperanza', folio: 'F3', ventaNotaId: 'n3', ventaId: null, saldoCentavos: 50000, fecha: '2026-10-30' }],
      cobros: [],
      nombres: NOMBRES,
    });
    expect(r).toMatchObject({ estado: 'pendiente', detalle: 'pendiente', saldoCentavos: 50000, montoTexto: '$500.00' });
  });

  it('una asignada en 0 que no salió en lo que trae (la pagó la oficina) es liquidada', () => {
    const [r] = notasDelCorte({
      asignadas: [asignada({ ventaNotaId: 'n4', folio: 'F4', saldoCentavos: 0 })],
      queTrae: [],
      cobros: [],
      nombres: new Map(),
    });
    expect(r).toMatchObject({ estado: 'liquidada', saldoCentavos: 0, cliente: '' });
  });

  it('un sobrepago no deja saldo negativo (el servidor lo rechazaría para siempre)', () => {
    const [abonada, nueva] = notasDelCorte({
      asignadas: [asignada({ ventaNotaId: 'n5', folio: 'F5', saldoCentavos: 30000 })],
      queTrae: [
        { origen: 'asignada', clienteId: 'cli-esperanza', folio: 'F5', ventaNotaId: 'n5', ventaId: null, saldoCentavos: 30000, fecha: '2026-10-30' },
        { origen: 'nueva', clienteId: 'cli-chuy', folio: 'F6', ventaNotaId: null, ventaId: 'v6', saldoCentavos: -500, fecha: '2026-11-18' },
      ],
      cobros: [{ reparto_json: JSON.stringify([{ venta_nota_id: 'n5', monto_centavos: 31000, saldo_despues_centavos: -1000 }]) }],
      nombres: NOMBRES,
    });
    expect(abonada).toMatchObject({ estado: 'abonó', saldoCentavos: 0, montoTexto: '$0.00' });
    expect(nueva).toMatchObject({ estado: 'nueva', saldoCentavos: 0, montoTexto: '$0.00' });
  });

  it('textoNotasQueTraes ignora claves que ya no están en la lista', () => {
    expect(textoNotasQueTraes([], new Set(['nota:X']))).toBe('0 de 0');
  });
});

describe('inventarioDelCorte (maqueta 24)', () => {
  it('un renglón por producto con buenas y la merma en un solo total', () => {
    const r = inventarioDelCorte([
      { presentacionId: 'p1', etiqueta: 'Jamaica · 500 ml', buenas: 8, merma: 2 },
      { presentacionId: 'p2', etiqueta: 'Jamaica · 1 L', buenas: 6, merma: 0 },
      { presentacionId: 'p3', etiqueta: 'Horchata · 500 ml', buenas: 12, merma: 0 },
      { presentacionId: 'p4', etiqueta: 'Mango · 500 ml', buenas: 4, merma: 1 },
      { presentacionId: 'p5', etiqueta: 'Tamarindo · 1 L', buenas: 0, merma: 2 },
    ]);
    expect(r).toEqual({
      renglones: [
        { presentacionId: 'p1', etiqueta: 'Jamaica · 500 ml', sistema: 8 },
        { presentacionId: 'p2', etiqueta: 'Jamaica · 1 L', sistema: 6 },
        { presentacionId: 'p3', etiqueta: 'Horchata · 500 ml', sistema: 12 },
        { presentacionId: 'p4', etiqueta: 'Mango · 500 ml', sistema: 4 },
      ],
      mermaSistema: 5,
    });
  });

  it('sin nada que regresar', () => {
    expect(inventarioDelCorte([])).toEqual({ renglones: [], mermaSistema: 0 });
  });

  it('una merma negativa no baja el total', () => {
    expect(inventarioDelCorte([{ presentacionId: 'p1', etiqueta: 'J', buenas: 1, merma: -3 }]).mermaSistema).toBe(0);
  });
});

const INVENTARIO = {
  renglones: [
    { presentacionId: 'p1', etiqueta: 'Jamaica · 500 ml', sistema: 8 },
    { presentacionId: 'p2', etiqueta: 'Jamaica · 1 L', sistema: 6 },
  ],
  mermaSistema: 5,
};

describe('inventarioCapturado (cerrar Inventario)', () => {
  it('sin tocar nada no congela nada: lo no tocado sigue al sistema', () => {
    expect(inventarioCapturado(INVENTARIO, {}, undefined)).toEqual({ inventarioContado: {}, mermaContada: null });
  });

  it('guarda solo lo corregido; un renglón que ya no está en el sistema se descarta', () => {
    expect(inventarioCapturado(INVENTARIO, { p1: '7', viejo: '3' }, '4')).toEqual({
      inventarioContado: { p1: 7 },
      mermaContada: 4,
    });
  });

  it('un campo vacío o que no es entero no deja cerrar', () => {
    expect(inventarioCapturado(INVENTARIO, { p1: '' }, undefined)).toBeNull();
    expect(inventarioCapturado(INVENTARIO, { p2: '1.5' }, undefined)).toBeNull();
    expect(inventarioCapturado(INVENTARIO, {}, '-1')).toBeNull();
  });
});

const SISTEMA: SistemaCorte = {
  efectivo: efectivoEsperado({ ventas: VENTAS, cobros: COBROS, gastos: GASTOS }),
  notas: [
    { clave: 'nota:F1', folio: 'F1', cliente: 'A', estado: 'pendiente', detalle: 'pendiente', montoTexto: '$500.00', saldoCentavos: 50000 },
  ],
  inventario: INVENTARIO,
};
const huellas = (sistema: SistemaCorte) => ({
  efectivo: huellaApartado('efectivo', sistema),
  notas: huellaApartado('notas', sistema),
  inventario: huellaApartado('inventario', sistema),
});

describe('apartados cerrados que cambiaron (huellas)', () => {
  const cerrados = ['efectivo' as const, 'notas' as const, 'inventario' as const];

  it('con el sistema igual, ninguno', () => {
    expect(apartadosDesactualizados({ cerrados, huellas: huellas(SISTEMA) }, SISTEMA)).toEqual([]);
  });

  it('una venta de contado cambia lo que debe traer: se reabre Efectivo', () => {
    const despues = {
      ...SISTEMA,
      efectivo: efectivoEsperado({
        ventas: [...VENTAS, { contado_credito: 'contado' as const, monto_total_centavos: 1000, abono_centavos: null }],
        cobros: COBROS,
        gastos: GASTOS,
      }),
    };
    expect(apartadosDesactualizados({ cerrados, huellas: huellas(SISTEMA) }, despues)).toEqual(['efectivo']);
  });

  it('una nota nueva o un saldo distinto reabre Notas', () => {
    const nueva = { ...SISTEMA.notas[0]!, clave: 'nota:F2', folio: 'F2' };
    expect(
      apartadosDesactualizados({ cerrados, huellas: huellas(SISTEMA) }, { ...SISTEMA, notas: [...SISTEMA.notas, nueva] }),
    ).toEqual(['notas']);
    const abonada = [{ ...SISTEMA.notas[0]!, saldoCentavos: 10000 }];
    expect(apartadosDesactualizados({ cerrados, huellas: huellas(SISTEMA) }, { ...SISTEMA, notas: abonada })).toEqual([
      'notas',
    ]);
  });

  it('un renglón que baja, sale o aparece, o la merma, reabre Inventario', () => {
    const conInventario = (inventario: SistemaCorte['inventario']) =>
      apartadosDesactualizados({ cerrados, huellas: huellas(SISTEMA) }, { ...SISTEMA, inventario });
    const [p1, p2] = INVENTARIO.renglones;
    expect(conInventario({ ...INVENTARIO, renglones: [{ ...p1!, sistema: 6 }, p2!] })).toEqual(['inventario']);
    expect(conInventario({ ...INVENTARIO, renglones: [p2!] })).toEqual(['inventario']);
    expect(conInventario({ ...INVENTARIO, mermaSistema: 6 })).toEqual(['inventario']);
    // El orden de los renglones no cuenta.
    expect(conInventario({ ...INVENTARIO, renglones: [p2!, p1!] })).toEqual([]);
  });

  it('solo los cerrados; uno cerrado sin huella se reabre', () => {
    expect(apartadosDesactualizados({ cerrados: [], huellas: {} }, SISTEMA)).toEqual([]);
    expect(apartadosDesactualizados({ cerrados: ['notas'], huellas: {} }, SISTEMA)).toEqual(['notas']);
    expect(apartadosDesactualizados({ cerrados: ['notas'] }, SISTEMA)).toEqual(['notas']);
  });

  it('textoApartadoCambio', () => {
    expect(textoApartadoCambio('inventario')).toBe(
      'Cambió Inventario desde que lo cerraste. Revísalo y ciérralo otra vez.',
    );
  });
});

describe('capturaParaEnviar', () => {
  const captura = {
    efectivoTraidoCentavos: 432500,
    notasTraidas: ['nota:F1'],
    inventarioContado: { p1: 7, extra: 2 },
    mermaContada: null,
    cerrados: ['efectivo' as const, 'notas' as const, 'inventario' as const],
  };

  it('lo no corregido sale con lo del sistema al enviar; lo corregido y lo de fuera del sistema se conservan', () => {
    expect(capturaParaEnviar(captura, INVENTARIO)).toEqual({
      ...captura,
      inventarioContado: { p1: 7, p2: 6, extra: 2 },
      mermaContada: 5,
    });
  });

  it('respeta la merma contada', () => {
    expect(capturaParaEnviar({ ...captura, mermaContada: 0 }, INVENTARIO).mermaContada).toBe(0);
  });
});

describe('textos y lectura de campos', () => {
  it('textoFaltanPorVisitar', () => {
    expect(textoFaltanPorVisitar(1)).toBe('Falta 1 cliente por visitar');
    expect(textoFaltanPorVisitar(3)).toBe('Faltan 3 clientes por visitar');
  });

  it('leerPiezas: solo enteros >= 0', () => {
    expect(leerPiezas(' 12 ')).toBe(12);
    expect(leerPiezas('0')).toBe(0);
    expect(leerPiezas('')).toBeNull();
    expect(leerPiezas('-2')).toBeNull();
    expect(leerPiezas('1,5')).toBeNull();
  });

  it('textoMontoCaptura', () => {
    expect(textoMontoCaptura(null)).toBe('');
    expect(textoMontoCaptura(432500)).toBe('4325.00');
    expect(textoMontoCaptura(5)).toBe('0.05');
  });
});

describe('puedeEnviarCorte', () => {
  it('solo con los tres apartados cerrados', () => {
    expect(puedeEnviarCorte(new Set<Apartado>())).toBe(false);
    expect(puedeEnviarCorte(new Set<Apartado>(['efectivo', 'notas']))).toBe(false);
    expect(puedeEnviarCorte(new Set<Apartado>(['efectivo', 'notas', 'inventario']))).toBe(true);
  });
});

describe('corteDisponible', () => {
  it('con clientes por visitar y los clientes abiertos, no', () => {
    expect(corteDisponible({ porVisitar: 2, candado: null, diaCerrado: false })).toBe(false);
  });

  it('con todos visitados, sí', () => {
    expect(corteDisponible({ porVisitar: 0, candado: null, diaCerrado: false })).toBe(true);
  });

  it('con candado de inventario (sin carga aceptada) queda disponible para cerrar el día', () => {
    expect(corteDisponible({ porVisitar: 2, candado: { tipo: 'sin-carga' }, diaCerrado: false })).toBe(true);
    expect(corteDisponible({ porVisitar: 2, candado: { tipo: 'rechazada' }, diaCerrado: false })).toBe(true);
    expect(
      corteDisponible({ porVisitar: 2, candado: { tipo: 'carga-pendiente', cargaId: 'c1' }, diaCerrado: false }),
    ).toBe(true);
  });

  it('con el día cerrado, sí', () => {
    expect(corteDisponible({ porVisitar: 2, candado: null, diaCerrado: true })).toBe(true);
  });
});
