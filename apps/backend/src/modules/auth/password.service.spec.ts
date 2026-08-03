import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const servicio = new PasswordService();

  it('genera un hash distinto del texto plano', async () => {
    const hash = await servicio.hashear('contrasena-secreta');
    expect(hash).not.toContain('contrasena-secreta');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifica la contrasena correcta', async () => {
    const hash = await servicio.hashear('contrasena-secreta');
    await expect(servicio.verificar(hash, 'contrasena-secreta')).resolves.toBe(true);
  });

  it('rechaza la contrasena incorrecta', async () => {
    const hash = await servicio.hashear('contrasena-secreta');
    await expect(servicio.verificar(hash, 'otra-cosa')).resolves.toBe(false);
  });

  it('devuelve false ante un hash corrupto en vez de reventar', async () => {
    await expect(servicio.verificar('no-es-un-hash', 'lo-que-sea')).resolves.toBe(false);
  });

  it('produce hashes distintos para la misma contrasena (sal aleatoria)', async () => {
    const a = await servicio.hashear('igual');
    const b = await servicio.hashear('igual');
    expect(a).not.toBe(b);
  });
});
