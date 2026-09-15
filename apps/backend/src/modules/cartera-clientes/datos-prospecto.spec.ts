import { normalizarDatosProspecto } from './datos-prospecto';

/** Lo minimo que el contrato manda para un prospecto. */
const minimo = { nombre: 'Tacos Aaron', telefono: '6641112233' };

function bueno(datos: Record<string, unknown>) {
  const r = normalizarDatosProspecto(datos);
  if (!r.ok) throw new Error(`se esperaba ok, llego: ${r.motivo}`);
  return r.prospecto;
}

function malo(datos: Record<string, unknown>, campo: string) {
  const r = normalizarDatosProspecto(datos);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.campo).toBe(campo);
  // El motivo empieza por el campo: es lo que la tablet guarda en `sync_error` y
  // lo que el vendedor acaba leyendo.
  expect(r.motivo.startsWith(`${campo}:`)).toBe(true);
}

describe('normalizarDatosProspecto', () => {
  it('lo minimo: nombre del negocio y telefono', () => {
    expect(bueno(minimo)).toEqual({
      nombre: 'Tacos Aaron',
      telefono: '6641112233',
      encargado: null,
      tipoNegocioId: null,
      comentarios: null,
      lat: null,
      lng: null,
    });
  });

  it('normaliza los siete campos que dicto el cliente (menos la foto)', () => {
    expect(
      bueno({
        nombre: '  Tacos Aaron  ',
        telefono: ' 664-111-2233 ',
        encargado: ' Don Aaron ',
        tipo_negocio_id: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        comentarios: '  Quiere probar jamaica  ',
        lat: 32.5149,
        lng: -117.0382,
      }),
    ).toEqual({
      nombre: 'Tacos Aaron',
      telefono: '664-111-2233',
      encargado: 'Don Aaron',
      // En minusculas: Postgres compara uuid sin importar mayusculas.
      tipoNegocioId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      comentarios: 'Quiere probar jamaica',
      lat: 32.5149,
      lng: -117.0382,
    });
  });

  it('la foto que manda la tablet se ignora: todavia no se guarda en ningun lado', () => {
    // El contrato reserva `foto: null` para no tener que cambiar el sobre el dia
    // que se decida donde vive el archivo. Mandarla no es un error.
    expect(bueno({ ...minimo, foto: null }).nombre).toBe('Tacos Aaron');
    expect(bueno({ ...minimo, foto: 'file:///tmp/x.jpg' }).nombre).toBe(
      'Tacos Aaron',
    );
  });

  describe('nombre del negocio', () => {
    it('es obligatorio', () => {
      malo({ telefono: '664' }, 'nombre');
      malo({ nombre: '   ', telefono: '664' }, 'nombre');
      malo({ nombre: 42, telefono: '664' }, 'nombre');
    });

    it('tiene tope de largo', () => {
      malo({ nombre: 'x'.repeat(201), telefono: '664' }, 'nombre');
      expect(
        bueno({ nombre: 'x'.repeat(200), telefono: '664' }).nombre,
      ).toHaveLength(200);
    });
  });

  describe('telefono', () => {
    it('es obligatorio: `cliente.telefono` sigue siendo not null', () => {
      malo({ nombre: 'Tacos' }, 'telefono');
      malo({ nombre: 'Tacos', telefono: '  ' }, 'telefono');
    });

    it('tiene tope de largo', () => {
      malo({ nombre: 'Tacos', telefono: '6'.repeat(31) }, 'telefono');
    });
  });

  describe('campos opcionales de texto', () => {
    it('ausente, null y vacio se guardan como null', () => {
      for (const valor of [undefined, null, '', '   ']) {
        const p = bueno({ ...minimo, encargado: valor, comentarios: valor });
        expect(p.encargado).toBeNull();
        expect(p.comentarios).toBeNull();
      }
    });

    it('un tipo que no es texto se rechaza en vez de convertirse', () => {
      malo({ ...minimo, encargado: 7 }, 'encargado');
      malo({ ...minimo, comentarios: { a: 1 } }, 'comentarios');
    });

    it('tienen tope de largo', () => {
      malo({ ...minimo, encargado: 'x'.repeat(121) }, 'encargado');
      malo({ ...minimo, comentarios: 'x'.repeat(501) }, 'comentarios');
    });
  });

  describe('tipo_negocio_id', () => {
    it('es opcional: [[Cliente]] no lo hace obligatorio', () => {
      expect(bueno(minimo).tipoNegocioId).toBeNull();
      expect(
        bueno({ ...minimo, tipo_negocio_id: null }).tipoNegocioId,
      ).toBeNull();
    });

    /**
     * Sin esta comprobacion, `where id = 'abc'` no devuelve cero filas: hace que
     * Postgres reviente con 22P02, y eso seria un **500 para todo el lote** — el
     * todo-o-nada que el contrato promete no hacer. La tablet ademas traduce un
     * 5xx a "sin red" y reintentaria para siempre en silencio.
     */
    it('un uuid mal formado se rechaza ANTES de llegar a Postgres', () => {
      malo({ ...minimo, tipo_negocio_id: 'abc' }, 'tipo_negocio_id');
      malo({ ...minimo, tipo_negocio_id: '' }, 'tipo_negocio_id');
      malo({ ...minimo, tipo_negocio_id: 12 }, 'tipo_negocio_id');
      malo(
        { ...minimo, tipo_negocio_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeeg' },
        'tipo_negocio_id',
      );
    });
  });

  describe('ubicacion', () => {
    it('sin ubicacion es un caso normal: el vendedor pudo negar el permiso', () => {
      expect(bueno(minimo)).toMatchObject({ lat: null, lng: null });
      expect(bueno({ ...minimo, lat: null, lng: null })).toMatchObject({
        lat: null,
        lng: null,
      });
    });

    it('media coordenada se rechaza: no ubica nada y parece un dato bueno', () => {
      malo({ ...minimo, lat: 32.5 }, 'lat/lng');
      malo({ ...minimo, lng: -117 }, 'lat/lng');
      malo({ ...minimo, lat: 32.5, lng: null }, 'lat/lng');
    });

    it('acepta el 0 en las dos (isla Null, pero es una coordenada valida)', () => {
      expect(bueno({ ...minimo, lat: 0, lng: 0 })).toMatchObject({
        lat: 0,
        lng: 0,
      });
    });

    /**
     * `numeric(9,6)` de Postgres desborda con 22003, que seria otro 500 para
     * todo el lote. Se cortan en los rangos reales de la Tierra, que son mas
     * estrictos: una latitud de 200 no es una coordenada.
     */
    it('rechaza lo que no cabe en numeric(9,6) ni en la Tierra', () => {
      malo({ ...minimo, lat: 91, lng: 0 }, 'lat');
      malo({ ...minimo, lat: -91, lng: 0 }, 'lat');
      malo({ ...minimo, lat: 0, lng: 181 }, 'lng');
      malo({ ...minimo, lat: 0, lng: -181 }, 'lng');
      expect(bueno({ ...minimo, lat: 90, lng: -180 })).toMatchObject({
        lat: 90,
        lng: -180,
      });
    });

    it('rechaza NaN e Infinity, que Postgres aceptaria en un numeric', () => {
      malo({ ...minimo, lat: Number.NaN, lng: 0 }, 'lat');
      malo({ ...minimo, lat: 0, lng: Number.POSITIVE_INFINITY }, 'lng');
    });

    it('rechaza una coordenada que viaja como texto: el contrato manda numeros', () => {
      malo({ ...minimo, lat: '32.5149', lng: '-117.0382' }, 'lat');
    });
  });
});
