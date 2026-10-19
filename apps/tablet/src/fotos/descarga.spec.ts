import { descargarFotoCliente, fotoParaFicha, uriFotoCliente, type BajarFoto } from './descarga';

const CACHE = 'file:///docs/fotos-clientes/cli-1.jpg';
const AYER = '2026-10-16T19:00:00.000Z';
const HOY = '2026-10-17T19:00:00.000Z';

describe('fotoParaFicha (T-39, D9)', () => {
  it('la foto que tomo ESTA tablet gana y no se baja nada', () => {
    expect(
      fotoParaFicha({ fotoLocal: 'file:///cache/a.jpg', fotoSubidaEn: HOY, cacheSubidaEn: null, uriCache: CACHE }),
    ).toEqual({ uri: 'file:///cache/a.jpg', descargar: false });
  });

  it('sin foto en el servidor: "sin foto", sin descarga', () => {
    expect(
      fotoParaFicha({ fotoLocal: null, fotoSubidaEn: null, cacheSubidaEn: null, uriCache: CACHE }),
    ).toEqual({ uri: null, descargar: false });
  });

  it('con foto en el servidor y nada en cache: se baja (mientras tanto, sin foto)', () => {
    expect(
      fotoParaFicha({ fotoLocal: null, fotoSubidaEn: HOY, cacheSubidaEn: null, uriCache: CACHE }),
    ).toEqual({ uri: null, descargar: true });
  });

  it('la cache al dia se pinta y no se vuelve a bajar', () => {
    expect(
      fotoParaFicha({ fotoLocal: null, fotoSubidaEn: HOY, cacheSubidaEn: HOY, uriCache: CACHE }),
    ).toEqual({ uri: CACHE, descargar: false });
  });

  it('la cache mas vieja que foto_subida_en se pinta mientras baja la nueva', () => {
    expect(
      fotoParaFicha({ fotoLocal: null, fotoSubidaEn: HOY, cacheSubidaEn: AYER, uriCache: CACHE }),
    ).toEqual({ uri: CACHE, descargar: true });
  });
});

describe('uriFotoCliente (T-39, D9)', () => {
  it('agrega la version para que Android no pinte la imagen vieja del mismo archivo', () => {
    expect(uriFotoCliente(CACHE, HOY)).toBe(`${CACHE}?v=${encodeURIComponent(HOY)}`);
    expect(uriFotoCliente(CACHE, HOY)).not.toBe(uriFotoCliente(CACHE, AYER));
  });
});

describe('descargarFotoCliente (T-39, D9)', () => {
  const pedir = (bajar: BajarFoto) =>
    descargarFotoCliente({ bajar, base: 'http://srv', tokenAcceso: 'tok', clienteId: 'CLI-1', destino: CACHE });

  it('pide la URL del canal con el token y el destino de la cache', async () => {
    const bajar = jest.fn<Promise<number>, Parameters<BajarFoto>>().mockResolvedValue(200);
    await expect(pedir(bajar)).resolves.toBe('ok');
    expect(bajar).toHaveBeenCalledWith('http://srv/sync/foto/cliente/cli-1', 'tok', CACHE);
  });

  it('404 es "sin-foto"; otro codigo es "fallo"', async () => {
    await expect(pedir(async () => 404)).resolves.toBe('sin-foto');
    await expect(pedir(async () => 401)).resolves.toBe('fallo');
    await expect(pedir(async () => 503)).resolves.toBe('fallo');
  });

  it('sin red no lanza: es "fallo" y la ficha sigue diciendo "sin foto"', async () => {
    await expect(
      pedir(async () => {
        throw new Error('Network request failed');
      }),
    ).resolves.toBe('fallo');
  });
});
