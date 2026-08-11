import { aCentavos, aNumero, aPesos } from './dinero';

describe('aCentavos', () => {
  it('convierte lo que de verdad manda `pg`: cadenas con 2 decimales', () => {
    expect(aCentavos('10.50')).toBe(1050);
    expect(aCentavos('0.01')).toBe(1);
    expect(aCentavos('0.00')).toBe(0);
    expect(aCentavos('12345678.99')).toBe(1234567899);
  });

  it('no acumula error de coma flotante', () => {
    // `10.10 * 100` da 1010.0000000000001 en coma flotante. Esta es la razon
    // de que la conversion trabaje sobre el TEXTO y no sobre el numero.
    expect(aCentavos('10.10')).toBe(1010);
    expect(aCentavos('1.15')).toBe(115);
    expect(aCentavos('29.29')).toBe(2929);
    expect(aCentavos('0.29')).toBe(29);
  });

  it('acepta enteros sin parte decimal', () => {
    expect(aCentavos('10')).toBe(1000);
    expect(aCentavos('0')).toBe(0);
  });

  it('acepta negativos (una nota corregida puede dejar saldo negativo)', () => {
    expect(aCentavos('-10.50')).toBe(-1050);
    expect(aCentavos('-0.01')).toBe(-1);
  });

  it('trata null y undefined como cero, que es lo que significa una columna vacia', () => {
    expect(aCentavos(null)).toBe(0);
    expect(aCentavos(undefined)).toBe(0);
    expect(aCentavos('')).toBe(0);
  });

  it('redondea al centavo si llegara mas escala de la esperada', () => {
    expect(aCentavos('1.005')).toBe(101);
    expect(aCentavos('1.004')).toBe(100);
  });

  it('acepta numeros por si alguien cambia el parser de `pg`', () => {
    expect(aCentavos(10.5)).toBe(1050);
    expect(aCentavos(0)).toBe(0);
  });

  it('grita ante algo que no es un importe, en vez de devolver NaN', () => {
    expect(() => aCentavos('diez pesos')).toThrow(TypeError);
    expect(() => aCentavos('1.2.3')).toThrow(TypeError);
  });
});

describe('aPesos', () => {
  it('es el inverso exacto de aCentavos', () => {
    for (const texto of ['0.00', '0.01', '10.10', '12345678.99', '-10.50']) {
      expect(aPesos(aCentavos(texto))).toBe(texto);
    }
  });

  it('rellena el decimal a dos digitos', () => {
    expect(aPesos(5)).toBe('0.05');
    expect(aPesos(50)).toBe('0.50');
    expect(aPesos(100)).toBe('1.00');
  });

  it('rechaza centavos fraccionarios: no existe medio centavo', () => {
    expect(() => aPesos(10.5)).toThrow(TypeError);
  });
});

describe('aNumero', () => {
  it('convierte porcentajes y coordenadas, que no son dinero', () => {
    expect(aNumero('3.50')).toBe(3.5);
    expect(aNumero('32.514900')).toBe(32.5149);
    expect(aNumero('-117.038200')).toBe(-117.0382);
  });

  it('conserva el null: "sin comision" no es "0% de comision"', () => {
    expect(aNumero(null)).toBeNull();
    expect(aNumero(undefined)).toBeNull();
  });
});
