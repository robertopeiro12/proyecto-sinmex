import { armarCorte, type MovimientoPresentacion } from './reglas-corte';
import { sumarVendedores } from './reglas-inventario-vendedor';

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const mov = (
  parcial: Partial<MovimientoPresentacion>,
): MovimientoPresentacion => ({
  presentacionId: A,
  nombre: 'Horchata 1 L',
  producto: 'Horchata',
  volumen: '1 L',
  cargadas: 0,
  vendidas: 0,
  regaladas: 0,
  buenas: 0,
  merma: 0,
  mermaEntregada: 0,
  mermaRecibida: 0,
  mermaAlmacen: 0,
  consumo: 0,
  cambiosEntregados: 0,
  cambiosRecibidos: 0,
  ...parcial,
});

const corte = (m: Partial<MovimientoPresentacion>, hecho: boolean) => {
  const c = armarCorte([mov(m)], hecho);
  return { lineas: c.lineas, totales: c.totales, hecho };
};

describe('sumarVendedores', () => {
  it('suma los resultados por linea con signo; el total de faltantes no compensa (2 y -1)', () => {
    // deberia 10, buenas 8 -> faltante 2; deberia 5, buenas 6 -> -1.
    const r = sumarVendedores([
      corte({ cargadas: 10, buenas: 8 }, true),
      corte({ cargadas: 5, buenas: 6 }, true),
    ]);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].cargadas).toBe(15);
    expect(r.lineas[0].deberiaRegresar).toBe(15);
    expect(r.lineas[0].buenas).toBe(14);
    expect(r.lineas[0].faltante).toBe(1);
    // Lo que le sobra a uno no compensa lo que le falta al otro.
    expect(r.totales.faltante).toBe(2);
    expect(r.vendedoresSinCorte).toBe(0);
  });

  it('un vendedor sin corte suma su operacion pero no entra a la validacion', () => {
    const r = sumarVendedores([
      corte({ cargadas: 10, buenas: 8, merma: 1, mermaRecibida: 2 }, true),
      corte({ cargadas: 7, mermaRecibida: 4 }, false),
    ]);
    expect(r.lineas[0].cargadas).toBe(17);
    // teoricas y reales solo del que tiene corte: cuadran con el resultado.
    expect(r.lineas[0].deberiaRegresar).toBe(10);
    expect(r.lineas[0].mermaTeorica).toBe(2);
    expect(r.lineas[0].buenas).toBe(8);
    expect(r.lineas[0].faltante).toBe(2);
    expect(r.lineas[0].resultadoMerma).toBe(1);
    expect(r.totales.faltante).toBe(2);
    expect(r.totales.faltanteMerma).toBe(1);
    expect(r.vendedoresSinCorte).toBe(1);
  });

  it('si ninguno tiene corte, los resultados y los totales son null', () => {
    const r = sumarVendedores([
      corte({ cargadas: 10 }, false),
      corte({ cargadas: 5 }, false),
    ]);
    expect(r.lineas[0].cargadas).toBe(15);
    expect(r.lineas[0].deberiaRegresar).toBeNull();
    expect(r.lineas[0].mermaTeorica).toBeNull();
    expect(r.lineas[0].buenas).toBeNull();
    expect(r.lineas[0].merma).toBeNull();
    expect(r.lineas[0].faltante).toBeNull();
    expect(r.lineas[0].resultadoMerma).toBeNull();
    expect(r.totales.faltante).toBeNull();
    expect(r.totales.faltanteMerma).toBeNull();
    expect(r.vendedoresSinCorte).toBe(2);
  });

  it('con teoricaSinCorte (un solo vendedor) la teorica sale aunque no haya corte', () => {
    const r = sumarVendedores(
      [corte({ cargadas: 10, mermaRecibida: 3 }, false)],
      {
        teoricaSinCorte: true,
      },
    );
    expect(r.lineas[0].deberiaRegresar).toBe(10);
    expect(r.lineas[0].mermaTeorica).toBe(3);
    expect(r.lineas[0].buenas).toBeNull();
    expect(r.lineas[0].faltante).toBeNull();
  });

  it('ordena por tamano y suma por presentacion distinta', () => {
    const litro = corte({ cargadas: 1 }, false);
    const medio = corte(
      {
        presentacionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
        volumen: '500 ml',
        cargadas: 2,
      },
      false,
    );
    const r = sumarVendedores([litro, medio]);
    expect(r.lineas.map((l) => l.volumen)).toEqual(['500 ml', '1 L']);
  });

  it('sin vendedores da todo vacio', () => {
    const r = sumarVendedores([]);
    expect(r.lineas).toEqual([]);
    expect(r.totales.faltante).toBeNull();
    expect(r.vendedoresSinCorte).toBe(0);
  });
});
