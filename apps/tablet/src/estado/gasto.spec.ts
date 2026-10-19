import type { CampoEgreso } from '@/datos/tipos';

import {
  camposParaGasto,
  faltantesVisiblesGasto,
  montoACentavos,
  pastillaGasto,
  puedeRegistrarGasto,
  TEXTO_METODO_GASTO,
  validarGasto,
  type EntradaGasto,
} from './gasto';

describe('montoACentavos (T-30/T-31, D9; Review Focus)', () => {
  it.each<[string, number | null]>([
    ['12.5', 1250],
    ['12.50', 1250],
    ['250.50', 25050],
    ['80', 8000],
    [' 80 ', 8000],
    ['0.29', 29],
    ['1.10', 110],
    ['0.01', 1],
    ['9999999999.99', 999_999_999_999],
    ['10000000000', null],
    ['12.345', null],
    ['0', null],
    ['0.00', null],
    ['-5', null],
    ['abc', null],
    ['', null],
    ['   ', null],
    ['.5', null],
    ['12.', null],
    ['1e3', null],
    ['1,250.50', null],
    ['12,5', null],
    ['$80', null],
  ])('%p son %p centavos', (texto, esperado) => {
    expect(montoACentavos(texto)).toBe(esperado);
  });
});

const campo = (id: string, nombre: string, se_usa_en_app: 0 | 1, activo: 0 | 1 = 1): CampoEgreso => ({
  id,
  nombre,
  tipo: 'operacion',
  se_usa_en_app,
  activo,
  sincronizado_en: '2026-10-20T00:00:00.000Z',
});

describe('camposParaGasto (D9)', () => {
  it('solo los activos con "Se usa en la app", por nombre en español', () => {
    const lista = [
      campo('r', 'Reparación del vehículo', 1),
      campo('e', 'Envases', 0),
      campo('h', 'Hielo', 1),
      campo('c', 'Celular', 1, 0),
      campo('a', 'Adelanto de sueldo', 1),
      campo('g', 'gasolina', 1),
    ];
    expect(camposParaGasto(lista).map((c) => c.id)).toEqual(['a', 'g', 'h', 'r']);
  });

  it('sin campos con la casilla, la lista queda vacia (la pantalla dice que no hay catalogo)', () => {
    expect(camposParaGasto([campo('e', 'Envases', 0)])).toEqual([]);
  });
});

const entrada = (cambios: Partial<EntradaGasto> = {}): EntradaGasto => ({
  campo: { id: 'ce-hielo' },
  monto: '80',
  comentario: '',
  fotoUri: null,
  diaCerrado: false,
  ...cambios,
});

describe('validarGasto (D9)', () => {
  it('campo y monto bastan: la foto y las observaciones son opcionales', () => {
    const r = validarGasto(entrada({ comentario: '   ' }));
    expect(r.faltantes).toEqual([]);
    expect(r.montoCentavos).toBe(8000);
    expect(r.gasto).toEqual({ campoEgresoId: 'ce-hielo', montoCentavos: 8000, comentario: null, fotoUri: null });
  });

  it('recorta las observaciones y pasa la foto tal cual', () => {
    const r = validarGasto(entrada({ comentario: ' Bolsa de 5 kg ', fotoUri: 'file:///t.jpg' }));
    expect(r.gasto).toEqual({
      campoEgresoId: 'ce-hielo',
      montoCentavos: 8000,
      comentario: 'Bolsa de 5 kg',
      fotoUri: 'file:///t.jpg',
    });
  });

  it('sin campo no se guarda', () => {
    const r = validarGasto(entrada({ campo: null }));
    expect(r.gasto).toBeNull();
    expect(r.faltantes).toEqual(['Elige el campo del gasto.']);
  });

  it('sin monto lo pide; un monto invalido dice por que', () => {
    expect(validarGasto(entrada({ monto: '  ' })).faltantes).toEqual(['Escribe el monto en pesos.']);
    for (const malo of ['0', '12.345', '-5', 'abc']) {
      const r = validarGasto(entrada({ monto: malo }));
      expect(r.gasto).toBeNull();
      expect(r.montoCentavos).toBeNull();
      expect(r.faltantes).toEqual(['El monto tiene que ser mayor que $0, con dos decimales a lo más.']);
    }
  });

  it('observaciones de 200 caracteres pasan; de 201 no', () => {
    expect(validarGasto(entrada({ comentario: 'x'.repeat(200) })).gasto?.comentario).toHaveLength(200);
    expect(validarGasto(entrada({ comentario: 'x'.repeat(201) })).faltantes).toEqual([
      'Las observaciones no pueden pasar de 200 caracteres.',
    ]);
  });

  it('con el dia cerrado no se guarda aunque todo este bien', () => {
    const r = validarGasto(entrada({ diaCerrado: true }));
    expect(r.gasto).toBeNull();
    expect(r.faltantes).toEqual(['El día ya está cerrado: no se pueden registrar gastos.']);
  });

  it('junta todo lo que falta, en el orden de la pantalla', () => {
    expect(validarGasto(entrada({ campo: null, monto: '', comentario: 'x'.repeat(201) })).faltantes).toEqual([
      'Elige el campo del gasto.',
      'Escribe el monto en pesos.',
      'Las observaciones no pueden pasar de 200 caracteres.',
    ]);
  });

  it('el metodo que se muestra es fijo', () => {
    expect(TEXTO_METODO_GASTO).toBe('Efectivo cobranza del día');
  });
});

describe('pastillaGasto (D9)', () => {
  it('por subir, subido y rechazado con su motivo sin el prefijo del codigo', () => {
    expect(pastillaGasto({ sync_estado: 'pendiente', sync_error: null })).toEqual({
      texto: 'por subir',
      estado: 'pendiente',
      detalle: null,
    });
    expect(pastillaGasto({ sync_estado: 'enviando', sync_error: null }).texto).toBe('por subir');
    expect(pastillaGasto({ sync_estado: 'sincronizado', sync_error: null })).toEqual({
      texto: 'subido',
      estado: 'listo',
      detalle: null,
    });
    expect(
      pastillaGasto({
        sync_estado: 'error',
        sync_error: 'campo-egreso-inexistente: El campo de egreso x no existe en el catálogo.',
      }),
    ).toEqual({
      texto: 'rechazado',
      estado: 'error',
      detalle: 'El campo de egreso x no existe en el catálogo.',
    });
  });
});

describe('faltantesVisiblesGasto (D9)', () => {
  const vacia = entrada({ campo: null, monto: '', comentario: '' });

  it('al abrir el formulario vacio no regaña', () => {
    expect(faltantesVisiblesGasto(vacia, validarGasto(vacia))).toEqual([]);
  });

  it('en cuanto empieza a capturar (campo, monto u observaciones) lista lo que falta', () => {
    for (const e of [
      entrada({ monto: '' }),
      entrada({ campo: null, monto: '12.345' }),
      entrada({ campo: null, monto: '', comentario: 'hielo' }),
    ]) {
      expect(faltantesVisiblesGasto(e, validarGasto(e))).toEqual(validarGasto(e).faltantes);
      expect(validarGasto(e).faltantes.length).toBeGreaterThan(0);
    }
  });

  it('completo no muestra nada', () => {
    const e = entrada();
    expect(faltantesVisiblesGasto(e, validarGasto(e))).toEqual([]);
  });
});

describe('puedeRegistrarGasto (D9)', () => {
  it('con catalogo y el dia abierto deja abrir el formulario', () => {
    expect(puedeRegistrarGasto({ camposDisponibles: 3, diaCerrado: false })).toBe(true);
  });

  it('sin catalogo o con el dia cerrado no (como la entrada del menu)', () => {
    expect(puedeRegistrarGasto({ camposDisponibles: 0, diaCerrado: false })).toBe(false);
    expect(puedeRegistrarGasto({ camposDisponibles: 3, diaCerrado: true })).toBe(false);
  });
});
