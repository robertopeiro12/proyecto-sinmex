import { COLUMNAS, renglonesAHtml } from './html';

describe('renglonesAHtml', () => {
  test('escapa < y & (y no escapa dos veces)', () => {
    const html = renglonesAHtml(['Jamaica <1 L> & Mango'], 58);
    expect(html).toContain('Jamaica &lt;1 L&gt; &amp; Mango');
    expect(html).not.toContain('<1 L>');
    expect(html).not.toContain('&amp;lt;');
  });

  test('respeta los espacios de la alineación y los renglones en blanco', () => {
    const renglones = ['              JAWA', '', 'Total            $804.00'];
    const html = renglonesAHtml(renglones, 58);
    expect(html).toContain(`<pre>${renglones.join('\n')}</pre>`);
    expect(html).toMatch(/white-space: pre;/);
  });

  test('deja pasar acentos y el punto medio tal cual, en UTF-8', () => {
    const html = renglonesAHtml(['Doña Chuy · CRÉDITO'], 80);
    expect(html).toContain('Doña Chuy · CRÉDITO');
    expect(html).toContain('<meta charset="utf-8">');
  });

  test('el ancho y la letra salen del papel', () => {
    const angosto = renglonesAHtml(['x'], 58);
    const ancho = renglonesAHtml(['x'], 80);
    expect(angosto).toContain('size: 58mm auto');
    expect(angosto).toContain('width: 48mm');
    expect(ancho).toContain('size: 80mm auto');
    expect(ancho).toContain('width: 72mm');
    // 32 o 48 columnas de 0.6 em llenan el área imprimible: 48 / 19.2 = 2.50 mm.
    expect(angosto).toContain('font-size: 2.50mm');
    expect(ancho).toContain('font-size: 2.50mm');
  });

  test('columnas por papel', () => {
    expect(COLUMNAS).toEqual({ 58: 32, 80: 48 });
  });
});
