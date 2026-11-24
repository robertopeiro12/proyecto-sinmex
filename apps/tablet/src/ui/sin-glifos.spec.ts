import * as fs from 'node:fs';
import * as path from 'node:path';

// Los iconos son SVG (`Icono`), nunca glifos Unicode ni emojis. `×`, `−`, `→` y
// `=` no van aqui: son texto en algunas pantallas.
const SOLO_ICONO = /[☰↻✓←◉⌖⬤]|\p{Extended_Pictographic}/u;
const RAIZ = path.resolve(__dirname, '../..');

function archivos(): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.tsx?$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) salida.push(ruta);
    }
  };
  for (const sub of ['app', 'src']) recorrer(path.join(RAIZ, sub));
  return salida;
}

const leer = (f: string) => fs.readFileSync(f, 'utf8');
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('nadie pasa glifo= a un botón', () => {
  expect(archivos().filter((f) => /\bglifo=/.test(leer(f)))).toEqual([]);
});

test('ningún archivo usa glifos de icono ni emojis fuera de comentarios', () => {
  expect(archivos().filter((f) => SOLO_ICONO.test(sinComentarios(leer(f))))).toEqual([]);
});
