import { camposQueFaltanParaSerCliente } from './clientes.service';

/**
 * T-40. El reflejo en TypeScript de `ck_cliente_domicilio_obligatorio` y
 * `ck_cliente_lista_precio_obligatoria`, mas el encargado (T-70), que la base NO
 * exige. Existe para que el 409 pueda nombrar **todos** los campos que faltan:
 * el check de Postgres solo delata el primero.
 */
describe('camposQueFaltanParaSerCliente', () => {
  it('un prospecto de la app le falta todo lo que el administrador tiene que agregar', () => {
    expect(
      camposQueFaltanParaSerCliente({
        domicilio: null,
        listaPrecioId: null,
        encargado: null,
      }),
    ).toEqual(['el domicilio', 'la lista de precios', 'el encargado']);
  });

  it('no le falta nada si trae los tres', () => {
    expect(
      camposQueFaltanParaSerCliente({
        domicilio: 'Calle 5 #12',
        listaPrecioId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        encargado: 'Juan',
      }),
    ).toEqual([]);
  });

  it('nombra solo el domicilio cuando es lo unico que falta', () => {
    expect(
      camposQueFaltanParaSerCliente({
        domicilio: null,
        listaPrecioId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        encargado: 'Juan',
      }),
    ).toEqual(['el domicilio']);
  });

  it('nombra solo la lista cuando es lo unico que falta', () => {
    expect(
      camposQueFaltanParaSerCliente({
        domicilio: 'Calle 5 #12',
        listaPrecioId: null,
        encargado: 'Juan',
      }),
    ).toEqual(['la lista de precios']);
  });

  /**
   * Un domicilio de espacios pasaria el `not null` de la base pero no es un
   * domicilio. El check de Postgres no puede verlo (es `is not null`), asi que
   * lo cubre esta funcion: mas estricta que la base, nunca mas laxa.
   */
  it('un domicilio de puros espacios cuenta como ausente', () => {
    expect(
      camposQueFaltanParaSerCliente({
        domicilio: '   ',
        listaPrecioId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        encargado: 'Juan',
      }),
    ).toEqual(['el domicilio']);
  });

  it('nombra solo el encargado cuando es lo unico que falta', () => {
    expect(
      camposQueFaltanParaSerCliente({
        domicilio: 'Calle 5 #12',
        listaPrecioId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        encargado: null,
      }),
    ).toEqual(['el encargado']);
  });

  it('un encargado de puros espacios cuenta como ausente', () => {
    expect(
      camposQueFaltanParaSerCliente({
        domicilio: 'Calle 5 #12',
        listaPrecioId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        encargado: '   ',
      }),
    ).toEqual(['el encargado']);
  });
});
