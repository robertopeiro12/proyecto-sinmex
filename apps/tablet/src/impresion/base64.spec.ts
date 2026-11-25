import { aBase64 } from './base64';

describe('aBase64', () => {
  it('vacío da cadena vacía', () => {
    expect(aBase64(new Uint8Array([]))).toBe('');
  });

  it('rellena con = según el residuo', () => {
    expect(aBase64(new Uint8Array([0x66]))).toBe('Zg==');
    expect(aBase64(new Uint8Array([0x66, 0x6f]))).toBe('Zm8=');
    expect(aBase64(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe('Zm9v');
  });

  it('coincide con Buffer en todos los valores de byte', () => {
    const todos = new Uint8Array(256 * 3 + 1);
    for (let i = 0; i < todos.length; i++) todos[i] = (i * 7) % 256;
    expect(aBase64(todos)).toBe(Buffer.from(todos).toString('base64'));
  });
});
