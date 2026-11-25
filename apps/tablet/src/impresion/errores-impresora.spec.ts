import { codigoDeError, conPermiso, SIN_IMPRESORA, textoErrorImpresora } from './errores-impresora';

describe('textoErrorImpresora', () => {
  test('traduce cada código del módulo', () => {
    expect(textoErrorImpresora('bluetooth-apagado', 'PT-210')).toBe('Prende el Bluetooth.');
    expect(textoErrorImpresora('sin-permiso', 'PT-210')).toBe('Da permiso de Bluetooth a la app.');
    expect(textoErrorImpresora('no-conecta', 'PT-210')).toBe('No se pudo conectar con PT-210. ¿Está prendida?');
    expect(textoErrorImpresora('sin-bluetooth', 'PT-210')).toBe('Este equipo no tiene Bluetooth disponible.');
    expect(textoErrorImpresora('fallo-envio', 'PT-210')).toBe(
      'Se cortó la conexión con PT-210 al mandar la nota. Revisa el papel y vuelve a intentar.',
    );
  });

  test('un código desconocido da un texto general', () => {
    expect(textoErrorImpresora(null, 'PT-210')).toBe('No se pudo imprimir en PT-210.');
    expect(textoErrorImpresora('otro', 'PT-210')).toBe('No se pudo imprimir en PT-210.');
  });

  test('sin impresora elegida', () => {
    expect(SIN_IMPRESORA).toBe('Elige la impresora en Seleccionar impresora.');
  });
});

describe('codigoDeError', () => {
  test('lee el code de un error del módulo', () => {
    expect(codigoDeError(Object.assign(new Error('x'), { code: 'no-conecta' }))).toBe('no-conecta');
  });

  test('sin code reconocible es null', () => {
    expect(codigoDeError(new Error('x'))).toBeNull();
    expect(codigoDeError('texto')).toBeNull();
    expect(codigoDeError(null)).toBeNull();
    expect(codigoDeError(Object.assign(new Error('x'), { code: 'ERR_OTRO' }))).toBeNull();
  });
});

describe('conPermiso', () => {
  const conCodigo = (code: string) => Object.assign(new Error(code), { code });

  test('si la llamada sale bien no pide permiso', async () => {
    const pedir = jest.fn(async () => undefined);
    expect(await conPermiso(async () => 'ok', pedir)).toBe('ok');
    expect(pedir).not.toHaveBeenCalled();
  });

  test('con sin-permiso pide el permiso y reintenta una vez', async () => {
    const pedir = jest.fn(async () => undefined);
    const llamar = jest.fn().mockRejectedValueOnce(conCodigo('sin-permiso')).mockResolvedValueOnce('ok');
    expect(await conPermiso(llamar, pedir)).toBe('ok');
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(llamar).toHaveBeenCalledTimes(2);
  });

  test('otro error no pide permiso', async () => {
    const pedir = jest.fn(async () => undefined);
    await expect(conPermiso(async () => Promise.reject(conCodigo('sin-bluetooth')), pedir)).rejects.toMatchObject({
      code: 'sin-bluetooth',
    });
    expect(pedir).not.toHaveBeenCalled();
  });

  test('permiso negado sale sin-permiso sin reintentar', async () => {
    const llamar = jest.fn().mockRejectedValue(conCodigo('sin-permiso'));
    await expect(conPermiso(llamar, async () => Promise.reject(conCodigo('sin-permiso')))).rejects.toMatchObject({
      code: 'sin-permiso',
    });
    expect(llamar).toHaveBeenCalledTimes(1);
  });
});
