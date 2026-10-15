import {
  agruparRuta,
  atendidosFueraDeRuta,
  enlaceAFicha,
  estadoSubida,
  pastillaAlta,
  entradasMenu,
  esSeccionPendiente,
  filtrarParaAgregar,
  indiceDestino,
  moverElemento,
  primeraLineaDomicilio,
  SECCIONES_PENDIENTES,
  textoAgregado,
  textoAvisoSinRuta,
  textoBurbuja,
  urlMapa,
  urlTelefono,
} from './ruta-del-dia';

const fila = (cliente_id: string, activo: 0 | 1, visitado: boolean) => ({
  cliente_id,
  activo,
  visitado,
});

describe('agruparRuta (D5, D16)', () => {
  it('las vivas van a la ruta, visitadas o no, en el orden que llegan', () => {
    const r = agruparRuta([fila('a', 1, true), fila('b', 1, false)]);
    expect(r.enRuta.map((f) => f.cliente_id)).toEqual(['a', 'b']);
    expect(r.fueraDeRuta).toEqual([]);
  });

  it('una baja SIN actividad hoy desaparece', () => {
    expect(agruparRuta([fila('a', 0, false)])).toEqual({ enRuta: [], fueraDeRuta: [] });
  });

  it('una baja CON actividad hoy va a "Fuera de ruta"', () => {
    const r = agruparRuta([fila('a', 1, false), fila('b', 0, true)]);
    expect(r.enRuta.map((f) => f.cliente_id)).toEqual(['a']);
    expect(r.fueraDeRuta.map((f) => f.cliente_id)).toEqual(['b']);
  });

  it('si el cliente quitado volvio a la ruta, no se pinta dos veces', () => {
    const r = agruparRuta([fila('a', 1, true), fila('a', 0, true)]);
    expect(r.enRuta).toHaveLength(1);
    expect(r.fueraDeRuta).toEqual([]);
  });
});

describe('textos', () => {
  it('el aviso sin ruta dice cuando fue la ultima sincronizacion (D3)', () => {
    expect(textoAvisoSinRuta(null)).toBe(
      'La oficina no ha asignado ruta para hoy. Última sincronización: nunca.',
    );
    expect(textoAvisoSinRuta('2026-10-12T18:02:54.922Z')).toMatch(
      /^La oficina no ha asignado ruta para hoy\. Última sincronización: 2026-10-1[123] \d{2}:\d{2}\.$/,
    );
  });

  it('la primera linea del domicilio, o "sin domicilio"', () => {
    expect(primeraLineaDomicilio('Calle 5 #12\nCol. Centro')).toBe('Calle 5 #12');
    expect(primeraLineaDomicilio('  \n  Av. Reforma 9 ')).toBe('Av. Reforma 9');
    expect(primeraLineaDomicilio(null)).toBe('sin domicilio');
    expect(primeraLineaDomicilio('   ')).toBe('sin domicilio');
  });

  it('el aviso al agregar y la etiqueta de la burbuja', () => {
    expect(textoAgregado('Abarrotes La Esquina')).toBe('Abarrotes La Esquina agregado al final');
    expect(textoBurbuja(1)).toBe('1 nota pendiente');
    expect(textoBurbuja(3)).toBe('3 notas pendientes');
  });
});

describe('urlMapa y urlTelefono (ficha del cliente)', () => {
  it('con coordenada, busca la coordenada', () => {
    expect(urlMapa({ lat: 32.5149, lng: -117.0382, domicilio: 'Calle 5' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=32.5149,-117.0382',
    );
  });

  it('sin coordenada, busca el domicilio codificado', () => {
    expect(urlMapa({ lat: null, lng: null, domicilio: 'Calle 5 #12, Tijuana' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Calle%205%20%2312%2C%20Tijuana',
    );
  });

  it('media coordenada no ubica nada: usa el domicilio; sin nada, null', () => {
    expect(urlMapa({ lat: 32.5, lng: null, domicilio: 'Calle 5' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Calle%205',
    );
    expect(urlMapa({ lat: null, lng: null, domicilio: null })).toBeNull();
  });

  it('el telefono se marca solo con digitos y +', () => {
    expect(urlTelefono('(664) 123-4567')).toBe('tel:6641234567');
    expect(urlTelefono('+52 664 123 4567')).toBe('tel:+526641234567');
    expect(urlTelefono('')).toBeNull();
    expect(urlTelefono(null)).toBeNull();
  });
});

describe('reordenar con el dedo (D10)', () => {
  it('moverElemento saca y vuelve a meter, sin mutar la lista', () => {
    const lista = ['a', 'b', 'c', 'd'];
    expect(moverElemento(lista, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moverElemento(lista, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moverElemento(lista, 1, 1)).toEqual(lista);
    expect(lista).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moverElemento fuera de rango devuelve una copia igual', () => {
    expect(moverElemento(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    expect(moverElemento(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });

  it('indiceDestino redondea el desplazamiento a filas y no se sale de la lista', () => {
    expect(indiceDestino(1, 0, 96, 5)).toBe(1);
    expect(indiceDestino(1, 50, 96, 5)).toBe(2);
    expect(indiceDestino(1, 40, 96, 5)).toBe(1);
    expect(indiceDestino(1, -100, 96, 5)).toBe(0);
    expect(indiceDestino(1, 1000, 96, 5)).toBe(4);
    expect(indiceDestino(0, 300, 0, 5)).toBe(0);
  });
});

describe('filtrarParaAgregar ("Agregar a mi ruta")', () => {
  const c = (id: string, nombre: string, extra: { tipo?: 'cliente' | 'prospecto'; activo?: 0 | 1 } = {}) => ({
    id,
    nombre,
    tipo: extra.tipo ?? ('cliente' as const),
    activo: extra.activo ?? (1 as const),
  });

  it('ofrece clientes activos que no estan en la ruta de hoy, buscando sin acentos ni mayusculas', () => {
    const clientes = [
      c('1', 'Abarrotes Doña Lupe'),
      c('2', 'Tienda La Esquina'),
      c('3', 'Abarrotes El Güero'),
      c('4', 'Abarrotes Prospecto', { tipo: 'prospecto' }),
      c('5', 'Abarrotes de baja', { activo: 0 }),
    ];
    expect(filtrarParaAgregar(clientes, new Set(['3']), 'abarrotes dona').map((x) => x.id)).toEqual([
      '1',
    ]);
    expect(filtrarParaAgregar(clientes, new Set(['3']), '').map((x) => x.id)).toEqual(['1', '2']);
  });

  it('corta en el limite', () => {
    const muchos = Array.from({ length: 80 }, (_, i) => c(String(i), `Cliente ${i}`));
    expect(filtrarParaAgregar(muchos, new Set(), '')).toHaveLength(50);
  });
});

describe('menu hamburguesa (D9, D16)', () => {
  it('las entradas del spec, en su orden, con destino', () => {
    expect(entradasMenu(false).map((e) => [e.titulo, e.destino])).toEqual([
      ['Todos los clientes', '/(jornada)/operacion'],
      ['Prospectos capturados', '/(jornada)/prospectos'],
      ['Gastos', '/(jornada)/pendiente/gastos'],
      ['Inventario', '/(jornada)/pendiente/inventario'],
      ['Merma, promoción y consumo', '/(jornada)/pendiente/merma'],
      ['Ruta y GPS', '/(jornada)/ruta'],
      ['Cerrar el día', '/(jornada)/cerrar-dia'],
    ]);
    expect(entradasMenu(false).every((e) => !e.deshabilitada)).toBe(true);
  });

  it('con el dia cerrado se deshabilita solo lo que captura', () => {
    const deshabilitadas = entradasMenu(true)
      .filter((e) => e.deshabilitada)
      .map((e) => e.clave);
    expect(deshabilitadas).toEqual(['gastos', 'inventario', 'merma']);
  });

  it('cada pendiente del menu tiene su seccion con ticket', () => {
    for (const e of entradasMenu(false)) {
      const seccion = e.destino.replace('/(jornada)/pendiente/', '');
      if (e.destino.startsWith('/(jornada)/pendiente/')) {
        expect(esSeccionPendiente(seccion)).toBe(true);
        expect(SECCIONES_PENDIENTES[seccion as keyof typeof SECCIONES_PENDIENTES].ticket).not.toBe('');
      }
    }
    expect(esSeccionPendiente('otra')).toBe(false);
  });
});

describe('estadoSubida (T-75)', () => {
  it('lo mas grave manda: error > pendiente > listo; vacio es null', () => {
    expect(estadoSubida([])).toBeNull();
    expect(estadoSubida(['sincronizado'])).toBe('listo');
    expect(estadoSubida(['sincronizado', 'pendiente'])).toBe('pendiente');
    expect(estadoSubida(['enviando'])).toBe('pendiente');
    expect(estadoSubida(['pendiente', 'error', 'sincronizado'])).toBe('error');
  });
});

describe('atendidosFueraDeRuta (T-75, D7)', () => {
  const cliente = (id: string) =>
    ({
      a: { nombre: 'Abarrotes', tipo: 'cliente' as const },
      p: { nombre: 'Prospecto Z', tipo: 'prospecto' as const },
      z: { nombre: 'Zapateria', tipo: 'cliente' as const },
    })[id] ?? null;
  const venta = (cliente_id: string, sync_estado: 'pendiente' | 'enviando' | 'sincronizado' | 'error' = 'pendiente') => ({ cliente_id, sync_estado });

  it('una venta a un cliente que no esta en la ruta lo lista; el prospecto va marcado', () => {
    const r = atendidosFueraDeRuta([], [venta('z', 'sincronizado'), venta('p')], cliente);
    expect(r).toEqual([
      { cliente_id: 'p', nombre: 'Prospecto Z', esProspecto: true, estado: 'pendiente' },
      { cliente_id: 'z', nombre: 'Zapateria', esProspecto: false, estado: 'listo' },
    ]);
  });

  it('en la ruta viva, o quitado con visita, NO sale: ya lo pinta la ruta (Review Focus 5)', () => {
    const r = atendidosFueraDeRuta(
      [fila('a', 1, false), fila('z', 0, true)],
      [venta('a'), venta('z')],
      cliente,
    );
    expect(r).toEqual([]);
  });

  it('quitado SIN visita y con venta local: sale (la ruta no lo pinta)', () => {
    const r = atendidosFueraDeRuta([fila('a', 0, false)], [venta('a')], cliente);
    expect(r.map((x) => x.cliente_id)).toEqual(['a']);
  });

  it('dos ventas al mismo cliente: una fila con el estado mas grave (Review Focus 4)', () => {
    const r = atendidosFueraDeRuta([], [venta('a', 'sincronizado'), venta('a', 'error')], cliente);
    expect(r).toEqual([{ cliente_id: 'a', nombre: 'Abarrotes', esProspecto: false, estado: 'error' }]);
  });

  it('un cliente que ya no esta en el catalogo local se omite sin tronar', () => {
    expect(atendidosFueraDeRuta([], [venta('fantasma')], cliente)).toEqual([]);
  });
});

describe('pastillaAlta (T-75, D4)', () => {
  it('sin fila de prospecto (bajo de otra tablet) no hay pastilla', () => {
    expect(pastillaAlta(null)).toBeNull();
  });
  it('por subir / subiendo / subido / rechazado con motivo', () => {
    expect(pastillaAlta({ sync_estado: 'pendiente', sync_error: null })).toEqual({ texto: 'alta por subir', estado: 'pendiente', detalle: null });
    expect(pastillaAlta({ sync_estado: 'enviando', sync_error: null })).toEqual({ texto: 'alta subiendo', estado: 'pendiente', detalle: null });
    expect(pastillaAlta({ sync_estado: 'sincronizado', sync_error: null })).toEqual({ texto: 'alta subida', estado: 'listo', detalle: null });
    expect(pastillaAlta({ sync_estado: 'error', sync_error: 'Ese tipo de negocio ya no existe.' })).toEqual({
      texto: 'alta rechazada',
      estado: 'error',
      detalle: 'Ese tipo de negocio ya no existe. Su venta subirá cuando el alta entre.',
    });
  });
});

describe('enlaceAFicha (T-75, D6; Review Focus 2)', () => {
  it('solo si existe el cliente local con ese id (prospectos de antes de T-75 no enlazan)', () => {
    expect(enlaceAFicha('p1', (id) => id === 'p1')).toBe('p1');
    expect(enlaceAFicha('viejo', () => false)).toBeNull();
  });
});
