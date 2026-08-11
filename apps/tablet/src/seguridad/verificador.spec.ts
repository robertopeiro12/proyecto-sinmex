import { randomBytes } from 'node:crypto';

import { COSTE_PBKDF2, derivarVerificador, verificarContrasena } from './verificador';

/** Fuente aleatoria de pruebas. En la app es `getRandomBytes` de expo-crypto. */
const aleatorio = (n: number) => new Uint8Array(randomBytes(n));

/** Sal fija: hace deterministas las pruebas que comparan dos derivaciones. */
const salFija = (relleno: number) => (n: number) => new Uint8Array(n).fill(relleno);

// Coste bajo a proposito en las pruebas: se ejercita la LOGICA del verificador,
// no el coste. El coste real (COSTE_PBKDF2) lo mide `pbkdf2.spec.ts`.
const COSTE_PRUEBA = 50;

describe('verificador local de la contrasena', () => {
  it('acepta la contrasena correcta', () => {
    const v = derivarVerificador('contrasena-real', aleatorio, COSTE_PRUEBA);
    expect(verificarContrasena('contrasena-real', v)).toBe(true);
  });

  it('rechaza una contrasena incorrecta, incluso si difiere en un solo caracter', () => {
    const v = derivarVerificador('contrasena-real', aleatorio, COSTE_PRUEBA);
    expect(verificarContrasena('contrasena-reai', v)).toBe(false);
    expect(verificarContrasena('Contrasena-real', v)).toBe(false);
    expect(verificarContrasena('', v)).toBe(false);
    expect(verificarContrasena('contrasena-real ', v)).toBe(false);
  });

  it('conserva acentos: la misma contrasena acentuada valida, otra no', () => {
    const v = derivarVerificador('camión-2026', aleatorio, COSTE_PRUEBA);
    expect(verificarContrasena('camión-2026', v)).toBe(true);
    expect(verificarContrasena('camion-2026', v)).toBe(false);
  });

  it('usa una sal distinta en cada derivacion', () => {
    // Sin sal por vendedor, dos vendedores con la misma contrasena tendrian el
    // mismo verificador y una sola tabla precalculada los abriria a todos.
    const a = derivarVerificador('igual', aleatorio, COSTE_PRUEBA);
    const b = derivarVerificador('igual', aleatorio, COSTE_PRUEBA);
    expect(a).not.toBe(b);
    expect(verificarContrasena('igual', a)).toBe(true);
    expect(verificarContrasena('igual', b)).toBe(true);
  });

  it('el verificador no contiene la contrasena en claro', () => {
    const v = derivarVerificador('secreto-del-vendedor', aleatorio, COSTE_PRUEBA);
    expect(v).not.toContain('secreto');
  });

  it('lleva el coste dentro, y un verificador viejo se sigue verificando con SU coste', () => {
    // Subir COSTE_PBKDF2 no debe invalidar lo que ya esta guardado en las
    // tablets que andan en la calle: cada verificador se comprueba con las
    // iteraciones con las que nacio.
    const viejo = derivarVerificador('x', salFija(1), 10);
    const nuevo = derivarVerificador('x', salFija(1), 20);

    expect(viejo.startsWith('pbkdf2-sha256$10$')).toBe(true);
    expect(nuevo.startsWith('pbkdf2-sha256$20$')).toBe(true);
    expect(viejo).not.toBe(nuevo);
    expect(verificarContrasena('x', viejo)).toBe(true);
    expect(verificarContrasena('x', nuevo)).toBe(true);
  });

  it('devuelve false (no lanza) ante un verificador corrupto o de otro formato', () => {
    // Si esto lanzara, quien llama tendria que acordarse de atraparlo, y el dia
    // que se olvide la pantalla de login reventaria en ruta en vez de pedir red.
    for (const basura of [
      '',
      'basura',
      'pbkdf2-sha256$100$solo-tres-partes',
      'pbkdf2-sha256$100$zz$zz',
      'pbkdf2-sha256$0$aabb$ccdd',
      'pbkdf2-sha256$abc$aabb$ccdd',
      'argon2id$v=19$m=19456,t=2,p=1$c2Fs$aGFzaA',
      'pbkdf2-sha512$100$aabb$ccdd',
    ]) {
      expect(verificarContrasena('lo-que-sea', basura)).toBe(false);
    }
  });

  it('rechaza una fuente aleatoria que no entrega los bytes pedidos', () => {
    // Una fuente que devuelva menos bytes de los pedidos (o ninguno) debilita
    // la sal sin que nada se vea raro. Mejor fallar el login en linea.
    expect(() => derivarVerificador('x', () => new Uint8Array(4), COSTE_PRUEBA)).toThrow();
  });

  it('el coste por defecto es el declarado', () => {
    const v = derivarVerificador('x', salFija(2));
    expect(v.startsWith(`pbkdf2-sha256$${COSTE_PBKDF2}$`)).toBe(true);
    expect(verificarContrasena('x', v)).toBe(true);
    expect(verificarContrasena('y', v)).toBe(false);
  });
});
