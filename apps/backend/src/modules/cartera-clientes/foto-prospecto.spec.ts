import {
  TAMANO_MAX_FOTO_BYTES,
  claveNombrable,
  esJpeg,
  nombreArchivoFoto,
} from './foto-prospecto';

/**
 * Las reglas puras de la foto del prospecto (T-40).
 *
 * Lo que se prueba aqui es exactamente lo que no se puede ver en una prueba e2e
 * sin montar diez casos: que `esJpeg` mira el CONTENIDO (no el `Content-Type`) y
 * que el nombre del archivo no puede salirse de `FOTOS_DIR`.
 */

/** Un JPEG minimo valido: SOI + un byte de relleno + EOI. */
const jpeg = (relleno: number[] = [0x00]) =>
  Buffer.from([0xff, 0xd8, 0xff, ...relleno, 0xff, 0xd9]);

describe('TAMANO_MAX_FOTO_BYTES', () => {
  it('son 2 MB', () => {
    // El numero esta en el spec y la tablet comprime a ~300 KB. Si alguien lo
    // baja sin medir, las fotos buenas empiezan a rebotar con 413.
    expect(TAMANO_MAX_FOTO_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('esJpeg', () => {
  it('acepta un JPEG con SOI y EOI', () => {
    expect(esJpeg(jpeg())).toBe(true);
  });

  it('acepta un JPEG con ceros de relleno al final', () => {
    // Hay camaras que rellenan el archivo despues del EOI. Rechazarlas seria un
    // falso negativo caro: la tablet reintentaria esa foto para siempre.
    expect(esJpeg(Buffer.concat([jpeg(), Buffer.alloc(16)]))).toBe(true);
  });

  it('rechaza un PNG, aunque venga como image/jpeg', () => {
    // La firma de PNG. El `Content-Type` lo pone quien sube y no prueba nada:
    // sin esta comprobacion, esto quedaria guardado como `.jpg` y el portal
    // mostraria una imagen rota meses despues, sin ninguna pista.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(esJpeg(png)).toBe(false);
  });

  it('rechaza texto', () => {
    expect(esJpeg(Buffer.from('esto no es una foto', 'utf8'))).toBe(false);
  });

  it('rechaza un cuerpo vacio', () => {
    expect(esJpeg(Buffer.alloc(0))).toBe(false);
  });

  it('rechaza un JPEG cortado a medias (empieza bien y no acaba)', () => {
    // Es el sintoma de una subida que se quedo sin WiFi. Guardarla daria un
    // archivo que el portal nunca podra pintar, y la tablet lo daria por bueno.
    expect(esJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe(
      false,
    );
  });

  it('rechaza los dos primeros bytes por casualidad', () => {
    // `FF D8` solo no es la firma: el tercer byte tiene que abrir un marcador.
    expect(esJpeg(Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]))).toBe(false);
  });
});

describe('nombreArchivoFoto', () => {
  const clave = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  it('es <clave>.jpg, que es toda la idempotencia que hace falta', () => {
    // Reenviar escribe el MISMO nombre: no hay duplicado posible porque no hay
    // dos nombres posibles. Ni contador, ni tabla de control.
    expect(nombreArchivoFoto(clave)).toBe(`${clave}.jpg`);
    expect(nombreArchivoFoto(clave)).toBe(nombreArchivoFoto(clave));
  });

  it.each([
    ['../../etc/passwd', 'sale del directorio'],
    ['..%2F..%2Fx', 'escapado'],
    ['sub/carpeta', 'una barra'],
    ['', 'vacia'],
    ['no-es-un-uuid', 'no tiene la forma'],
    ['3F2504E0-4F89-41D3-9A0C-0305E82C3301', 'en mayusculas'],
  ])('lanza con una clave que %s', (mala) => {
    // `clave_idempotencia` es texto libre que escribe la TABLET: nada en la base
    // impide un `../..`. Como el nombre del archivo sale de la clave, esto es lo
    // que separa "escribo en FOTOS_DIR" de "escribo donde me digan".
    expect(() => nombreArchivoFoto(mala)).toThrow(/clave no utilizable/);
  });

  it('no sanea: una clave mala lanza en vez de convertirse en otra', () => {
    // Sanear significaria que dos claves distintas pueden acabar en el mismo
    // archivo, que es justo el duplicado silencioso que el nombre evita.
    expect(claveNombrable('../' + clave)).toBe(false);
  });
});
