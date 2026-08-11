import {
  LARGO_FOLIO,
  explicarFolioInvalido,
  formarFolio,
  partirFolio,
  revisarFolio,
} from './folio';

/**
 * El formato del folio, contra los **ejemplos del propio ADR-0001**.
 *
 * No se inventa ningun caso: los dos folios que aparecen escritos en el vault
 * (`TJ220313AP05` en el cuerpo del ADR y de [[Folios]], `TJ260322AP05` en el
 * callout de confirmacion del cliente) son la prueba de aceptacion.
 */
describe('formato del folio (ADR-0001)', () => {
  it('el ejemplo del documento v2.0 se lee segmento a segmento', () => {
    // "Sucursal Tijuana, del 13 de marzo de 2022, lo hizo el vendedor Abraham
    // Perez y fue la operacion #05".
    const partes = partirFolio('TJ220313AP05');

    expect(partes).not.toBeNull();
    expect(partes).toMatchObject({
      sucursal: 'TJ',
      anio: '22',
      mes: '03',
      dia: '13',
      vendedor: 'AP',
      consecutivo: 5,
      fecha: '2022-03-13',
    });
  });

  it('el ejemplo confirmado por el cliente en julio 2026 tambien', () => {
    expect(partirFolio('TJ260322AP05')).toMatchObject({
      sucursal: 'TJ',
      fecha: '2026-03-22',
      vendedor: 'AP',
      consecutivo: 5,
    });
  });

  it('son 12 caracteres en 6 segmentos de 2', () => {
    for (const folio of ['TJ220313AP05', 'TJ260322AP05', 'MX261231ZZ99']) {
      expect(folio).toHaveLength(LARGO_FOLIO);
      expect(partirFolio(folio)).not.toBeNull();
    }
  });

  it('`formarFolio` es la inversa de `partirFolio`', () => {
    expect(formarFolio('TJ', '2026-03-22', 'AP', 5)).toBe('TJ260322AP05');
    // El consecutivo se rellena a 2 digitos: la operacion #1 es `01`, no `1`.
    expect(formarFolio('TJ', '2026-08-07', 'AP', 1)).toBe('TJ260807AP01');
    expect(formarFolio('MX', '2026-12-31', 'ZZ', 99)).toBe('MX261231ZZ99');
  });

  describe('lo que NO es un folio', () => {
    it.each([
      ['TJ260322AP5', 'once caracteres'],
      ['TJ260322AP005', 'trece caracteres'],
      ['tj260322ap05', 'minusculas'],
      ['T1260322AP05', 'digito en la sucursal'],
      ['TJ2603A2AP05', 'letra en la fecha'],
      ['TJ2603221P05', 'digito en el segmento de vendedor'],
      ['TJ260322APXX', 'letras en el consecutivo'],
      ['', 'vacio'],
    ])('rechaza %p (%s)', (folio) => {
      expect(partirFolio(folio)).toBeNull();
    });

    it('rechaza una fecha que no existe aunque los digitos encajen', () => {
      // El folio se va a cotejar contra una nota fisica fechada: `13/32` no es
      // un dia y dejarlo pasar produciria un folio que no se puede cuadrar.
      expect(partirFolio('TJ261332AP01')).toBeNull();
      expect(partirFolio('TJ260230AP01')).toBeNull(); // 30 de febrero
    });

    it('acepta el 29 de febrero de un ano bisiesto', () => {
      expect(partirFolio('TJ280229AP01')).toMatchObject({
        fecha: '2028-02-29',
      });
    });
  });

  it('el codigo de sucursal no esta codificado a TJ|MX', () => {
    // T-09 dejo el catalogo de sucursales **dinamico**: una sucursal nueva
    // tiene que poder foliar el dia que abra, sin tocar codigo.
    expect(partirFolio('GD260807AP01')).toMatchObject({ sucursal: 'GD' });
  });
});

/**
 * El folio **repite** informacion que la operacion ya trae por otro lado. Si
 * las dos versiones no coinciden, alguien miente o la tablet tiene un bug — y
 * un folio emitido no se corrige hacia atras.
 */
describe('coherencia del folio con su operacion', () => {
  const esperado = {
    sucursal: 'TJ',
    fechaOperacion: '2026-08-07',
    segmentoVendedor: 'AP',
  };

  it('acepta el folio que concuerda con la operacion', () => {
    expect(revisarFolio('TJ260807AP01', esperado)).toBeNull();
    expect(revisarFolio('TJ260807AP42', esperado)).toBeNull();
  });

  it('rechaza un folio de otra sucursal', () => {
    // La sucursal la decide el servidor desde el token (T-09), no el cuerpo.
    const motivo = revisarFolio('MX260807AP01', esperado);
    expect(motivo).toEqual({
      causa: 'sucursal',
      esperada: 'TJ',
      recibida: 'MX',
    });
    expect(explicarFolioInvalido(motivo!)).toContain('MX');
  });

  it('rechaza un folio cuya fecha contradice a `fecha_operacion`', () => {
    // El dia de trabajo lo calcula la tablet con su reloj local y el servidor
    // no lo re-deriva (T-07). Lo que si comprueba es que el folio diga lo
    // mismo que el campo: son dos copias del mismo dato.
    const motivo = revisarFolio('TJ260806AP01', esperado);
    expect(motivo).toEqual({
      causa: 'fecha',
      esperada: '2026-08-07',
      recibida: '2026-08-06',
    });
  });

  it('rechaza un folio con un segmento de vendedor que no es el suyo', () => {
    // Esto es lo que impide que una tablet se invente las iniciales por su
    // cuenta en vez de usar las que el servidor le mando en el `pull`. Sin
    // esta comprobacion, la ambiguedad de iniciales volveria en silencio.
    const motivo = revisarFolio('TJ260807XY01', esperado);
    expect(motivo).toEqual({
      causa: 'vendedor',
      esperada: 'AP',
      recibida: 'XY',
    });
  });

  it('un vendedor sin segmento asignado no puede foliar', () => {
    const motivo = revisarFolio('TJ260807AP01', {
      ...esperado,
      segmentoVendedor: null,
    });
    expect(motivo).toMatchObject({ causa: 'vendedor' });
    expect(explicarFolioInvalido(motivo!)).toContain('no tiene segmento');
  });

  it('un folio mal formado se reporta como formato, no como incoherencia', () => {
    expect(revisarFolio('nada', esperado)).toEqual({ causa: 'formato' });
  });
});
