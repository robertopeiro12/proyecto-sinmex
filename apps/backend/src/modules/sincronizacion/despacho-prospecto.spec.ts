import {
  CODIGO_POR_RAZON_PROSPECTO,
  pideGeocodificacion,
  prepararProspecto,
} from './despacho-prospecto';
import type { OperacionNormalizada } from './operaciones';

const operacion = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: '7f2c0000-0000-4000-8000-000000000001',
  tipo: 'prospecto',
  fechaOperacion: '2026-09-14',
  ocurridoEn: '2026-09-14T18:03:22.000Z',
  clienteId: null,
  folio: null,
  datos: {
    nombre: 'Tacos Aaron',
    telefono: '6641112233',
    encargado: 'Don Aaron',
  },
  ...extra,
});

describe('prepararProspecto', () => {
  it('normaliza los datos de un alta valida', () => {
    const r = prepararProspecto(operacion());

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prospecto).toMatchObject({
      nombre: 'Tacos Aaron',
      telefono: '6641112233',
      encargado: 'Don Aaron',
      lat: null,
      lng: null,
    });
  });

  /**
   * El espejo de la regla de la venta (que sin folio se rechaza), y no es
   * cosmetico: `sync_operacion.folio` tiene un `unique` **global**. Un folio
   * pegado a un prospecto consumiria un numero del espacio de las ventas, y una
   * venta legitima con ese numero se rechazaria despues como `folio-duplicado`
   * — un fallo que aparece en OTRA operacion, dias despues, y que nadie
   * relacionaria con esto.
   */
  it('rechaza un prospecto que llega con folio', () => {
    const r = prepararProspecto(operacion({ folio: 'TJ260914AP03' }));

    expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
    if (r.ok) return;
    expect(r.motivo).toMatch(/folio/);
    expect(r.motivo).toMatch(/no lleva folio/);
  });

  it('rechaza un prospecto que llega con cliente_id: lo esta creando', () => {
    const r = prepararProspecto(
      operacion({ clienteId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
    );

    expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
    if (r.ok) return;
    expect(r.motivo).toMatch(/cliente_id/);
  });

  /**
   * T-75 (D2): la clave del prospecto pasa a ser el `id` del `cliente` que se
   * crea (la tablet ya lo registro localmente con ese id). `cliente.id` es
   * `uuid`, asi que una clave que no lo sea no puede entrar — y es un bug de la
   * tablet, no un catalogo viejo: `datos-invalidos`.
   */
  it('rechaza un prospecto cuya clave no es un uuid: es el id del cliente', () => {
    const r = prepararProspecto(operacion({ clave: 'prosp-123-abc' }));

    expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
    if (r.ok) return;
    expect(r.motivo).toMatch(/clave/);
    expect(r.motivo).toMatch(/uuid/i);
  });

  it('acepta la clave en mayusculas: Postgres compara uuid sin importar mayusculas', () => {
    const r = prepararProspecto(
      operacion({ clave: '7F2C0000-0000-4000-8000-000000000001' }),
    );
    expect(r.ok).toBe(true);
  });

  it('traduce un problema de forma a datos-invalidos, nombrando el campo', () => {
    const r = prepararProspecto(operacion({ datos: { telefono: '664' } }));

    expect(r).toMatchObject({ ok: false, codigo: 'datos-invalidos' });
    if (r.ok) return;
    expect(r.motivo).toMatch(/^nombre:/);
  });

  it('el folio se comprueba antes que la forma de `datos`', () => {
    // Con las dos cosas mal, el motivo que gana es el del folio: es un bug de la
    // tablet (armo mal el sobre) y es la pista mas util para arreglarlo.
    const r = prepararProspecto(
      operacion({ folio: 'TJ260914AP03', datos: {} }),
    );

    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.motivo).toMatch(/folio/);
  });
});

describe('CODIGO_POR_RAZON_PROSPECTO', () => {
  it('traduce cada razon de dominio a un codigo del contrato', () => {
    expect(CODIGO_POR_RAZON_PROSPECTO).toEqual({
      'tipo-negocio-inexistente': 'tipo-negocio-inexistente',
      'id-ocupado': 'datos-invalidos',
    });
  });

  /**
   * Es un `Record` sobre `RazonRechazoProspecto` a proposito: si
   * `cartera-clientes` agrega una razon, TypeScript no compila hasta que alguien
   * le asigne su codigo. Nunca un generico `proyeccion-fallida` (ADR-0009 §2.3):
   * la tablet tiene que poder decidir sin leer espanol.
   */
  it('no tiene codigos genericos', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_PROSPECTO)) {
      expect(codigo).not.toMatch(/fallida|generico|desconocido/);
    }
  });
});

describe('pideGeocodificacion (T-72, D5)', () => {
  const normalizado = (datos: Record<string, unknown>) => {
    const r = prepararProspecto(
      operacion({
        datos: {
          nombre: 'Tacos Aaron',
          telefono: '6641112233',
          encargado: 'Don Aaron',
          ...datos,
        },
      }),
    );
    if (!r.ok) throw new Error(r.motivo);
    return r.prospecto;
  };

  it('con direccion y sin GPS si', () => {
    expect(
      pideGeocodificacion(
        normalizado({ domicilio: 'Av. Revolución 1234', lat: null, lng: null }),
      ),
    ).toBe(true);
  });

  it('con GPS no, aunque traiga direccion: gana la coordenada del GPS', () => {
    expect(
      pideGeocodificacion(
        normalizado({
          domicilio: 'Av. Revolución 1234',
          lat: 32.5149,
          lng: -117.0382,
        }),
      ),
    ).toBe(false);
  });

  it('sin direccion no (una tablet anterior)', () => {
    expect(pideGeocodificacion(normalizado({ lat: null, lng: null }))).toBe(
      false,
    );
  });
});
