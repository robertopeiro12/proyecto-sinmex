import {
  asignarSegmento,
  candidatosDeSegmento,
  palabrasDelNombre,
} from './segmento-vendedor';

/**
 * La desambiguacion del segmento de vendedor es **PROVISIONAL**.
 *
 * ADR-0001 y [[Vendedor]] dejan abierto que hacer cuando dos vendedores
 * comparten iniciales, y las fuentes no lo dicen. Estas pruebas fijan el
 * comportamiento que se implemento para que el cambio, cuando el cliente
 * responda, sea visible y no silencioso. Ver ADR-0007.
 */
describe('segmento de vendedor del folio', () => {
  describe('la regla del ADR: inicial del nombre + inicial del apellido', () => {
    it('Abraham Perez da AP, que es el ejemplo del documento', () => {
      expect(asignarSegmento('Abraham Perez', new Set())).toBe('AP');
    });

    it('ignora los nombres de mas de dos palabras', () => {
      // "inicial del nombre + inicial del apellido": el segundo apellido no
      // entra en el folio.
      expect(asignarSegmento('Juan Carlos Ramirez Soto', new Set())).toBe('JC');
    });

    it('quita acentos y enes: el folio es A-Z', () => {
      expect(palabrasDelNombre('Ángela Ñáñez')).toEqual(['ANGELA', 'NANEZ']);
      expect(asignarSegmento('Ángela Ñáñez', new Set())).toBe('AN');
      expect(asignarSegmento('José Ñuño', new Set())).toBe('JN');
    });

    it('los signos separan palabras, no se cuelan en el segmento', () => {
      // "Ma." y "Jose" son dos palabras: inicial del nombre (M) + inicial de
      // la siguiente (J). El punto y el apostrofo desaparecen.
      expect(palabrasDelNombre("Ma. Jose O'Brien")).toEqual([
        'MA',
        'JOSE',
        'O',
        'BRIEN',
      ]);
      expect(asignarSegmento("Ma. Jose O'Brien", new Set())).toBe('MJ');
    });
  });

  describe('cuando las iniciales chocan (la duda abierta con el cliente)', () => {
    it('el segundo vendedor cede, conservando la inicial de su nombre', () => {
      // `AP` ya es de Abraham Perez. Ana Ponce se lleva `AO`, que se sigue
      // leyendo como "Ana P-o-nce": el folio no deja de ser legible.
      expect(asignarSegmento('Ana Ponce', new Set(['AP']))).toBe('AO');
    });

    it('camina el apellido en orden y de forma determinista', () => {
      expect(asignarSegmento('Alonso Prieto', new Set(['AP']))).toBe('AR');
      expect(asignarSegmento('Alonso Prieto', new Set(['AP', 'AR']))).toBe(
        'AI',
      );
    });

    it('el mismo nombre y los mismos ocupados dan siempre el mismo segmento', () => {
      const ocupados = new Set(['AP', 'AO', 'AN']);
      const primero = asignarSegmento('Ana Ponce', ocupados);
      for (let i = 0; i < 20; i++) {
        expect(asignarSegmento('Ana Ponce', ocupados)).toBe(primero);
      }
    });

    it('agotado el apellido, camina A..Z con la misma inicial', () => {
      // Se ocupan todas las combinaciones que salen de "Ponce".
      const ocupados = new Set(['AP', 'AO', 'AN', 'AC', 'AE']);
      const segmento = asignarSegmento('Ana Ponce', ocupados);
      expect(segmento).toMatch(/^A[A-Z]$/);
      expect(ocupados.has(segmento!)).toBe(false);
    });

    it('cede la inicial del nombre solo cuando ya no queda ninguna A?', () => {
      const todasConA = new Set(
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `A${l}`),
      );
      const segmento = asignarSegmento('Ana Ponce', todasConA);
      expect(segmento).not.toBeNull();
      expect(segmento![0]).not.toBe('A');
    });
  });

  describe('los huecos que el cliente tiene que cerrar', () => {
    it('un nombre de una sola palabra usa sus dos primeras letras', () => {
      // No hay apellido del que sacar la segunda letra. Es una eleccion
      // nuestra, no una regla confirmada.
      expect(asignarSegmento('Madonna', new Set())).toBe('MA');
    });

    it('un nombre sin letras latinas cae al ultimo recurso AA..ZZ', () => {
      expect(asignarSegmento('123 456', new Set())).toBe('AA');
      expect(asignarSegmento('123 456', new Set(['AA']))).toBe('AB');
    });

    it('devuelve null solo si las 676 combinaciones estan tomadas', () => {
      const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const todas = new Set(letras.flatMap((a) => letras.map((b) => a + b)));
      expect(todas.size).toBe(676);
      expect(asignarSegmento('Abraham Perez', todas)).toBeNull();
    });
  });

  it('todos los candidatos son 2 letras mayusculas y sin repetir', () => {
    const candidatos = candidatosDeSegmento('Abraham Perez');
    expect(candidatos.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(new Set(candidatos).size).toBe(candidatos.length);
    expect(candidatos[0]).toBe('AP');
  });
});
