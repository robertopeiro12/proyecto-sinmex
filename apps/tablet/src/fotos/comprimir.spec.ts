import {
  comprimirParaSubir,
  ErrorCompresion,
  INTENTOS,
  OBJETIVO_BYTES,
  TOPE_SERVIDOR_BYTES,
  type Manipulador,
  type PeticionGuardado,
} from './comprimir';

const ORIGINAL = { uri: 'file:///cache/camara.jpg', ancho: 4000, alto: 3000 };
const VERTICAL = { uri: 'file:///cache/camara.jpg', ancho: 3000, alto: 4000 };

/**
 * Manipulador de prueba: en vez de comprimir de verdad, devuelve el tamano que
 * diga `tamanos` para cada intento, en orden.
 *
 * Es lo que hace probable en Node lo unico que importa de este modulo: **la
 * decision de cuando parar**. El JPEG real lo produce
 * `expo-image-manipulator` en la tablet, y ahi no hay nada que decidir.
 */
function manipuladorFalso(tamanos: number[]) {
  const peticiones: PeticionGuardado[] = [];
  let i = 0;
  const manipulador: Manipulador = {
    async guardar(peticion) {
      peticiones.push(peticion);
      const bytes = tamanos[i] ?? tamanos[tamanos.length - 1] ?? 0;
      i += 1;
      return { uri: `file:///cache/comprimida-${i}.jpg`, bytes };
    },
  };
  return { manipulador, peticiones };
}

const kB = (n: number) => n * 1024;

describe('comprimir la foto del prospecto', () => {
  it('se queda en el primer intento que baja de 300 kB', () => {
    // El objetivo es el numero, no la receta: en cuanto lo alcanza para de
    // comprimir. Seguir buscando algo mas pequeno seria tiempo del vendedor.
    const { manipulador, peticiones } = manipuladorFalso([kB(280)]);

    return comprimirParaSubir(ORIGINAL, manipulador).then((foto) => {
      expect(foto.bytes).toBe(kB(280));
      expect(foto.bytes).toBeLessThanOrEqual(OBJETIVO_BYTES);
      expect(foto.intentos).toBe(1);
      expect(foto.objetivoAlcanzado).toBe(true);
      expect(peticiones).toHaveLength(1);
      expect(peticiones[0]).toMatchObject({ ladoMayor: 1600, calidad: 0.5 });
    });
  });

  it('sigue bajando la calidad si el primer intento se pasa', async () => {
    // Una foto con mucho detalle (un estante lleno de botellas) pesa varias veces
    // lo que una fachada lisa a la misma calidad: por eso una calidad fija no
    // puede garantizar el numero y hace falta medir.
    const { manipulador, peticiones } = manipuladorFalso([kB(900), kB(420), kB(250)]);

    const foto = await comprimirParaSubir(ORIGINAL, manipulador);

    expect(foto.intentos).toBe(3);
    expect(foto.bytes).toBe(kB(250));
    expect(foto.objetivoAlcanzado).toBe(true);
    // Primero baja la calidad al mismo tamano, y solo despues la resolucion: a
    // 1600 px los artefactos casi no se ven, y lo que el administrador necesita
    // del lugar es reconocerlo.
    expect(peticiones.map((p) => `${p.ladoMayor}@${p.calidad}`)).toEqual([
      '1600@0.5',
      '1600@0.4',
      '1600@0.3',
    ]);
  });

  it('baja la resolucion cuando la calidad ya no alcanza', async () => {
    const tamanos = INTENTOS.map((_, i) => (i < 3 ? kB(900) : kB(200)));
    const { manipulador, peticiones } = manipuladorFalso(tamanos);

    const foto = await comprimirParaSubir(ORIGINAL, manipulador);

    expect(foto.ladoMayor).toBe(1200);
    expect(foto.objetivoAlcanzado).toBe(true);
    expect(peticiones[3]).toMatchObject({ ladoMayor: 1200 });
  });

  it('acepta una foto entre el objetivo y el tope del servidor, avisando', async () => {
    // 400 kB no es un fallo: el servidor la toma, y una foto de 400 kB vale mas
    // que ninguna. Lo que no puede es pasar en silencio.
    const { manipulador } = manipuladorFalso(INTENTOS.map(() => kB(400)));

    const foto = await comprimirParaSubir(ORIGINAL, manipulador);

    expect(foto.objetivoAlcanzado).toBe(false);
    expect(foto.bytes).toBe(kB(400));
    expect(foto.intentos).toBe(INTENTOS.length);
  });

  it('devuelve el intento MAS PEQUENO cuando ninguno llega al objetivo', async () => {
    // Si hay que entregar una foto por encima del objetivo, que sea la mas ligera
    // que se consiguio: es la que mejor pasa por la WiFi del negocio.
    const { manipulador } = manipuladorFalso([kB(900), kB(700), kB(500), kB(600)]);

    const foto = await comprimirParaSubir(ORIGINAL, manipulador);

    expect(foto.bytes).toBe(kB(500));
    expect(foto.objetivoAlcanzado).toBe(false);
  });

  /**
   * > [!danger] Esta es la prueba que evita un 413 garantizado
   * > El servidor responde **413 permanente** a una foto de mas de 2 MB. Si esto
   * > devolviera una ruta igualmente, el prospecto se guardaria con una foto que
   * > **tiene garantizado** el rechazo: se intentaria subir, se descartaria, y el
   * > vendedor habria tomado la foto para nada. Lanzar es lo que hace que el alta
   * > siga adelante **sin foto**, que es un prospecto completo.
   */
  it('lanza si ni el ultimo intento baja del tope de 2 MB del servidor', async () => {
    const { manipulador } = manipuladorFalso(INTENTOS.map(() => kB(3000)));

    await expect(comprimirParaSubir(ORIGINAL, manipulador)).rejects.toThrow(
      ErrorCompresion,
    );
    await expect(comprimirParaSubir(ORIGINAL, manipulador)).rejects.toThrow(
      new RegExp(String(TOPE_SERVIDOR_BYTES)),
    );
  });

  it('en una foto vertical limita el ALTO, no el ancho', async () => {
    // Pedirle `width: 1600` a una foto 3000x4000 la dejaria en 1600x2133: mas
    // grande que la horizontal que se queria limitar, y mas pesada.
    const { manipulador, peticiones } = manipuladorFalso([kB(250)]);

    await comprimirParaSubir(VERTICAL, manipulador);

    expect(peticiones[0]?.vertical).toBe(true);
  });

  it('nunca agranda una foto que ya es mas chica que el objetivo', async () => {
    // Interpolar a 1600 px una foto de 800 pesa mas y no anade un solo detalle.
    const { manipulador, peticiones } = manipuladorFalso([kB(100)]);

    const foto = await comprimirParaSubir(
      { uri: 'file:///cache/chica.jpg', ancho: 800, alto: 600 },
      manipulador,
    );

    expect(peticiones[0]?.ladoMayor).toBe(800);
    expect(foto.ladoMayor).toBe(800);
  });

  it('los intentos van de mas a menos, sin repetirse', () => {
    // Un intento que produjera un archivo MAS grande que el anterior seria una
    // pasada perdida con el vendedor esperando.
    //
    // El peso aproximado de un JPEG va con el **area** (los pixeles que hay que
    // codificar), no con el lado, y con la calidad. Con `lado x calidad` esta
    // prueba marcaba `1600@0.35` (560) como mas pesado que `1200@0.5` (600),
    // que es al reves de lo que pasa en el archivo: 1600x1200 a calidad 0.35
    // pesa menos que 1200x900 a 0.5. El modelo importa — con el equivocado,
    // esta prueba pediria reordenar una escalera que esta bien.
    const pesos = INTENTOS.map((i) => i.ladoMayor ** 2 * i.calidad);
    expect([...pesos].sort((a, b) => b - a)).toEqual(pesos);
    expect(new Set(INTENTOS.map((i) => `${i.ladoMayor}@${i.calidad}`)).size).toBe(
      INTENTOS.length,
    );
  });
});
