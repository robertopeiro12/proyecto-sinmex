import type { Prospecto } from '@/datos/tipos';

import {
  accionMenu,
  agruparRutaEnCurso,
  anchoMenuLateral,
  atendidosFueraDeRuta,
  enlaceAFicha,
  estadoSubida,
  pastillaAlta,
  entradasMenu,
  clientesParaAgregar,
  listaProspectos,
  NOTA_SIN_JORNADA,
  motivoDeRechazo,
  primeraLineaDomicilio,
  resumenVisitado,
  sinRutaAsignada,
  textoAgregado,
  textoAvisoSinRuta,
  textoNotasQueTrae,
  urlMapa,
  urlTelefono,
} from './ruta-del-dia';

const fila = (cliente_id: string, activo: 0 | 1, visitado: boolean, visita_sin_venta = false) => ({
  cliente_id,
  activo,
  visitado,
  visita_sin_venta,
});

describe('agruparRutaEnCurso (spec §6, maqueta 6)', () => {
  it('por visitar, visitados (con o sin venta) y fuera de ruta', () => {
    const g = agruparRutaEnCurso([
      fila('a', 1, false), fila('b', 1, true), fila('c', 1, true, true), fila('d', 0, true), fila('e', 0, false),
    ]);
    expect(g.porVisitar.map((f) => f.cliente_id)).toEqual(['a']);
    expect(g.visitados.map((f) => f.cliente_id)).toEqual(['b', 'c']);
    expect(g.fueraDeRuta.map((f) => f.cliente_id)).toEqual(['d']);
  });

  it('respeta el orden en que llegan', () => {
    const g = agruparRutaEnCurso([fila('c', 1, true), fila('a', 1, false), fila('b', 1, true), fila('d', 1, false)]);
    expect(g.porVisitar.map((f) => f.cliente_id)).toEqual(['a', 'd']);
    expect(g.visitados.map((f) => f.cliente_id)).toEqual(['c', 'b']);
  });

  it('pieza 6 I-1: un cliente dado de baja sin actividad va a "Dados de baja", no a "Por visitar"', () => {
    const g = agruparRutaEnCurso([
      { ...fila('a', 1, true), cliente_activo: 1 as const },
      { ...fila('b', 1, false), cliente_activo: 0 as const },
      { ...fila('c', 1, true), cliente_activo: 0 as const },
    ]);
    expect(g.porVisitar).toEqual([]);
    expect(g.dadosDeBaja.map((f) => f.cliente_id)).toEqual(['b']);
    // Con algo hecho hoy sigue en Visitados.
    expect(g.visitados.map((f) => f.cliente_id)).toEqual(['a', 'c']);
    // Corte se abre con el resto visitado (antes: candado para siempre).
    const corte = entradasMenu({ porVisitar: g.porVisitar.length, candado: null, diaCerrado: false, sinJornada: false })
      .find((e) => e.clave === 'corte');
    expect(corte).toMatchObject({ deshabilitada: false, nota: null });
  });

  it('si el cliente quitado volvio a la ruta, no se pinta dos veces', () => {
    const g = agruparRutaEnCurso([fila('a', 1, true), fila('a', 0, true)]);
    expect(g.visitados).toHaveLength(1);
    expect(g.fueraDeRuta).toEqual([]);
  });
});

describe('resumenVisitado (spec §6)', () => {
  test('resumen de lo hecho', () => {
    const base = { venta_contado_centavos: 0, venta_credito_centavos: 0, venta_abono_centavos: 0, cobro_centavos: 0, con_merma: false, con_cambio: false, ultima_visita_motivo: null, visita_sin_venta: false };
    expect(resumenVisitado({ ...base, cobro_centavos: 85000, venta_credito_centavos: 124000 })).toBe('Cobro $850.00 · Venta a crédito $1,240.00');
    expect(resumenVisitado({ ...base, venta_contado_centavos: 50000, con_merma: true })).toBe('Venta $500.00 · Merma');
    expect(resumenVisitado({ ...base, visita_sin_venta: true, ultima_visita_motivo: 'Cerrado' })).toBe('Visita sin venta · cerrado');
    expect(resumenVisitado({ ...base, visita_sin_venta: true })).toBe('Visita sin venta');
    expect(resumenVisitado({ ...base, con_merma: true })).toBe('Merma');
  });

  test('venta a crédito con abono al vender dice cuánto abonó (pieza 2)', () => {
    const base = { venta_contado_centavos: 0, venta_credito_centavos: 0, venta_abono_centavos: 0, cobro_centavos: 0, con_merma: false, con_cambio: false, ultima_visita_motivo: null, visita_sin_venta: false };
    expect(resumenVisitado({ ...base, venta_credito_centavos: 72000, venta_abono_centavos: 30000 })).toBe(
      'Venta a crédito $720.00 · Abonó $300.00',
    );
    expect(resumenVisitado({ ...base, venta_credito_centavos: 72000 })).toBe('Venta a crédito $720.00');
    expect(
      resumenVisitado({ ...base, venta_credito_centavos: 72000, venta_abono_centavos: 30000, con_merma: true }),
    ).toBe('Venta a crédito $720.00 · Abonó $300.00 · Merma');
  });

  test('todo junto, en su orden; con algo hecho la visita no se menciona', () => {
    const base = { venta_contado_centavos: 0, venta_credito_centavos: 0, venta_abono_centavos: 0, cobro_centavos: 0, con_merma: false, con_cambio: false, ultima_visita_motivo: null, visita_sin_venta: false };
    expect(
      resumenVisitado({ ...base, cobro_centavos: 100, venta_contado_centavos: 200, venta_credito_centavos: 300, con_merma: true }),
    ).toBe('Cobro $1.00 · Venta $2.00 · Venta a crédito $3.00 · Merma');
    expect(resumenVisitado({ ...base, con_merma: true, visita_sin_venta: true, ultima_visita_motivo: 'Cerrado' })).toBe('Merma');
    // Rediseño pieza 4: el cambio va despues de la merma.
    expect(resumenVisitado({ ...base, con_cambio: true })).toBe('Cambio');
    expect(resumenVisitado({ ...base, venta_contado_centavos: 200, con_merma: true, con_cambio: true })).toBe(
      'Venta $2.00 · Merma · Cambio',
    );
    expect(resumenVisitado({ ...base, con_cambio: true, visita_sin_venta: true, ultima_visita_motivo: 'Cerrado' })).toBe(
      'Cambio',
    );
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

  it('el aviso al agregar y lo que se lee del contador de notas', () => {
    expect(textoAgregado('Abarrotes La Esquina')).toBe('Abarrotes La Esquina agregado al final');
    expect(textoNotasQueTrae(1)).toBe('Trae 1 nota por cobrar');
    expect(textoNotasQueTrae(3)).toBe('Trae 3 notas por cobrar');
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

describe('clientesParaAgregar ("Agregar a mi ruta")', () => {
  const c = (id: string, nombre: string, tipo: 'cliente' | 'prospecto' = 'cliente', activo: 0 | 1 = 1) => ({
    id,
    nombre,
    tipo,
    activo,
  });

  it('agregar a ruta muestra a todos con su marca "En ruta"', () => {
    const r = clientesParaAgregar(
      [
        c('1', 'Mini Súper Otay'),
        c('2', 'Abarrotes La Esperanza'),
        c('3', 'Prospecto X', 'prospecto'),
        c('4', 'Baja', 'cliente', 0),
      ],
      new Set(['1']),
      '',
    );
    expect(r.map((x) => [x.nombre, x.enRuta])).toEqual([
      ['Abarrotes La Esperanza', false],
      ['Mini Súper Otay', true],
    ]);
  });

  it('busca sin acentos', () => {
    expect(clientesParaAgregar([c('1', 'Mini Súper Otay')], new Set(), 'super').length).toBe(1);
    expect(clientesParaAgregar([c('1', 'Abarrotes Doña Lupe')], new Set(), 'DONA').length).toBe(1);
  });

  it('no recorta: 60 clientes sin busqueda salen todos, alfabeticos y con su marca', () => {
    const muchos = Array.from({ length: 60 }, (_, i) => c(String(i), `Cliente ${String(59 - i).padStart(2, '0')}`));
    const r = clientesParaAgregar(muchos, new Set(['0', '59']), '');
    expect(r).toHaveLength(60);
    expect(r.map((x) => x.nombre)).toEqual(
      Array.from({ length: 60 }, (_, i) => `Cliente ${String(i).padStart(2, '0')}`),
    );
    expect(
      r
        .filter((x) => x.enRuta)
        .map((x) => x.id)
        .sort(),
    ).toEqual(['0', '59']);
  });
});

describe('menu hamburguesa (spec §5, maqueta 3)', () => {
  const abierto = { porVisitar: 0, candado: null, diaCerrado: false, sinJornada: false };

  test('entradas del menú en el orden del spec', () => {
    expect(entradasMenu(abierto).map((e) => e.titulo)).toEqual([
      'Ruta', 'Inventario', 'Sugerido de carga', 'Ventas / Cobranza', 'Merma / Cambios',
      'Gastos', 'Corte', 'Prospectos', 'Seleccionar impresora', 'Cerrar sesión',
    ]);
  });

  test('destinos; Cerrar sesión no tiene (lo maneja la pantalla)', () => {
    expect(entradasMenu(abierto).map((e) => e.destino)).toEqual([
      '/(jornada)', '/(jornada)/inventario', '/(jornada)/sugerido-de-carga', '/(jornada)/registros',
      '/(jornada)/merma', '/(jornada)/gastos', '/(jornada)/corte', '/(jornada)/prospectos',
      '/(jornada)/impresora', null,
    ]);
    expect(entradasMenu(abierto).every((e) => !e.deshabilitada && e.nota === null)).toBe(true);
  });

  test('Corte con candado y "faltan N clientes" mientras haya por visitar', () => {
    const corte = (n: number) =>
      entradasMenu({ porVisitar: n, candado: null, diaCerrado: false, sinJornada: false }).find((e) => e.clave === 'corte')!;
    expect(corte(4)).toMatchObject({ deshabilitada: true, nota: 'faltan 4 clientes' });
    expect(corte(1)).toMatchObject({ deshabilitada: true, nota: 'falta 1 cliente' });
    expect(corte(0)).toMatchObject({ deshabilitada: false, nota: null });
  });

  test('con candado de inventario (sin carga aceptada) Corte queda abierto aunque falten clientes', () => {
    const corte = entradasMenu({ porVisitar: 3, candado: { tipo: 'sin-carga' }, diaCerrado: false, sinJornada: false })
      .find((e) => e.clave === 'corte')!;
    expect(corte).toMatchObject({ deshabilitada: false, nota: null });
  });

  test('con el día cerrado, Corte se abre (ya se hizo) y lo que captura se apaga', () => {
    const e = entradasMenu({ porVisitar: 3, candado: null, diaCerrado: true, sinJornada: false });
    expect(e.find((x) => x.clave === 'corte')!.deshabilitada).toBe(false);
    expect(e.filter((x) => x.deshabilitada).map((x) => x.clave).sort()).toEqual(['gastos', 'merma']);
  });

  test('ninguna entrada abre una pantalla "Próximamente" por sección', () => {
    expect(entradasMenu(abierto).some((e) => e.destino?.startsWith('/(jornada)/pendiente/'))).toBe(false);
  });

  test('sin jornada de hoy solo quedan Ruta y Cerrar sesión; lo demás dice "Empieza tu ruta"', () => {
    const e = entradasMenu({ porVisitar: 3, candado: { tipo: 'empezar' }, diaCerrado: false, sinJornada: true });
    expect(e.filter((x) => !x.deshabilitada).map((x) => x.clave)).toEqual(['ruta', 'salir']);
    expect(e.filter((x) => !x.deshabilitada).every((x) => x.nota === null)).toBe(true);
    const apagadas = e.filter((x) => x.deshabilitada);
    expect(apagadas).toHaveLength(8);
    // La nota de Corte ("faltan N") cede a la de empezar la ruta.
    expect(apagadas.every((x) => x.nota === NOTA_SIN_JORNADA)).toBe(true);
    expect(NOTA_SIN_JORNADA).toBe('Empieza tu ruta');
  });
});

describe('accionMenu (revisión final pieza 1, I2: el menú no apila pantallas)', () => {
  const entradas = entradasMenu({ porVisitar: 0, candado: null, diaCerrado: false, sinJornada: false });
  const de = (clave: string) => entradas.find((e) => e.clave === clave)!;

  test('a la Ruta: dismissTo desde cualquier pantalla del menú', () => {
    expect(accionMenu('gastos', de('ruta'))).toEqual({ tipo: 'dismissTo', destino: '/(jornada)' });
    expect(accionMenu('corte', de('ruta'))).toEqual({ tipo: 'dismissTo', destino: '/(jornada)' });
  });

  test('desde la Ruta las demás entradas hacen push', () => {
    expect(accionMenu('ruta', de('gastos'))).toEqual({ tipo: 'push', destino: '/(jornada)/gastos' });
    expect(accionMenu('ruta', de('prospectos'))).toEqual({ tipo: 'push', destino: '/(jornada)/prospectos' });
  });

  test('desde otra pantalla del menú, replace (encima de la Ruta hay a lo más una)', () => {
    expect(accionMenu('gastos', de('inventario'))).toEqual({ tipo: 'replace', destino: '/(jornada)/inventario' });
    expect(accionMenu('prospectos', de('corte'))).toEqual({ tipo: 'replace', destino: '/(jornada)/corte' });
  });

  test('la entrada de la pantalla actual no hace nada; Cerrar sesión sale', () => {
    expect(accionMenu('ruta', de('ruta'))).toEqual({ tipo: 'nada' });
    expect(accionMenu('gastos', de('gastos'))).toEqual({ tipo: 'nada' });
    expect(accionMenu('ruta', de('salir'))).toEqual({ tipo: 'salir' });
    expect(accionMenu('gastos', de('salir'))).toEqual({ tipo: 'salir' });
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

  it('T-39: una baja que solo fue visitada va a "Fuera de ruta"', () => {
    const r = agruparRutaEnCurso([fila('a', 0, true, true)]);
    expect(r.fueraDeRuta.map((f) => f.cliente_id)).toEqual(['a']);
    expect(r.visitados).toEqual([]);
  });
});

describe('sinRutaAsignada (T-39)', () => {
  it('solo sin ninguna fila en las tres secciones', () => {
    expect(sinRutaAsignada({ porVisitar: [], visitados: [], fueraDeRuta: [] })).toBe(true);
    // Todos visitados: hay ruta, aunque "Por visitar" quede vacia (Review Focus 3).
    expect(sinRutaAsignada({ porVisitar: [], visitados: [fila('a', 1, true, true)], fueraDeRuta: [] })).toBe(false);
    expect(sinRutaAsignada({ porVisitar: [], visitados: [], fueraDeRuta: [fila('b', 0, true)] })).toBe(false);
    expect(
      sinRutaAsignada({ porVisitar: [], visitados: [], fueraDeRuta: [], dadosDeBaja: [fila('c', 1, false)] }),
    ).toBe(false);
  });
});

describe('motivoDeRechazo (T-39)', () => {
  it('el motivo sin el codigo tecnico', () => {
    expect(motivoDeRechazo('visita-id-ocupado: El id de esta visita ya está ocupado.')).toBe(
      'El id de esta visita ya está ocupado.',
    );
    expect(motivoDeRechazo('texto sin codigo')).toBe('texto sin codigo');
    expect(motivoDeRechazo(null)).toBe('El servidor la rechazó.');
  });
});

describe('atendidosFueraDeRuta (T-75, D7; T-39)', () => {
  const cliente = (id: string) =>
    ({
      a: { nombre: 'Abarrotes', tipo: 'cliente' as const },
      p: { nombre: 'Prospecto Z', tipo: 'prospecto' as const },
      z: { nombre: 'Zapateria', tipo: 'cliente' as const },
    })[id] ?? null;
  type Sync = 'pendiente' | 'enviando' | 'sincronizado' | 'error';
  const venta = (cliente_id: string, sync_estado: Sync = 'pendiente') => ({ cliente_id, sync_estado });
  const visita = venta;

  it('una venta a un cliente que no esta en la ruta lo lista; el prospecto va marcado', () => {
    const r = atendidosFueraDeRuta([], [venta('z', 'sincronizado'), venta('p')], [], cliente);
    expect(r).toEqual([
      { cliente_id: 'p', nombre: 'Prospecto Z', esProspecto: true, estado: 'pendiente', soloVisita: false },
      { cliente_id: 'z', nombre: 'Zapateria', esProspecto: false, estado: 'listo', soloVisita: false },
    ]);
  });

  it('en la ruta viva, o quitado con visita, NO sale: ya lo pinta la ruta (Review Focus 5 de T-75)', () => {
    const r = atendidosFueraDeRuta(
      [fila('a', 1, false), fila('z', 0, true)],
      [venta('a'), venta('z')],
      [visita('a'), visita('z')],
      cliente,
    );
    expect(r).toEqual([]);
  });

  it('quitado SIN visita y con venta local: sale (la ruta no lo pinta)', () => {
    const r = atendidosFueraDeRuta([fila('a', 0, false)], [venta('a')], [], cliente);
    expect(r.map((x) => x.cliente_id)).toEqual(['a']);
  });

  it('dos ventas al mismo cliente: una fila con el estado mas grave (Review Focus 4 de T-75)', () => {
    const r = atendidosFueraDeRuta([], [venta('a', 'sincronizado'), venta('a', 'error')], [], cliente);
    expect(r).toEqual([
      { cliente_id: 'a', nombre: 'Abarrotes', esProspecto: false, estado: 'error', soloVisita: false },
    ]);
  });

  it('un cliente que ya no esta en el catalogo local se omite sin tronar', () => {
    expect(atendidosFueraDeRuta([], [venta('fantasma')], [visita('fantasma')], cliente)).toEqual([]);
  });

  it('T-39: solo visitado fuera de ruta sale con soloVisita (la etiqueta "visita")', () => {
    const r = atendidosFueraDeRuta([], [], [visita('p', 'sincronizado')], cliente);
    expect(r).toEqual([
      { cliente_id: 'p', nombre: 'Prospecto Z', esProspecto: true, estado: 'listo', soloVisita: true },
    ]);
  });

  it('T-39: con venta y visita es una fila, sin soloVisita, con el estado mas grave de las dos', () => {
    const r = atendidosFueraDeRuta([], [venta('a', 'sincronizado')], [visita('a', 'error')], cliente);
    expect(r).toEqual([
      { cliente_id: 'a', nombre: 'Abarrotes', esProspecto: false, estado: 'error', soloVisita: false },
    ]);
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
  });
  it('rechazo por tipo de negocio: motivo sin prefijo y a esperar a la oficina', () => {
    expect(
      pastillaAlta({ sync_estado: 'error', sync_error: 'tipo-negocio-inexistente: El tipo de negocio X ya no existe.' }),
    ).toEqual({
      texto: 'alta rechazada',
      estado: 'error',
      detalle:
        'El tipo de negocio X ya no existe. Su venta subirá cuando la oficina reactive el tipo de negocio. No lo vuelvas a capturar.',
    });
  });
  it('cualquier otro rechazo: avisar a la oficina, sin prometer la venta', () => {
    expect(pastillaAlta({ sync_estado: 'error', sync_error: 'datos-invalidos: La clave de este prospecto no es nueva; avisa a la oficina.' })).toEqual({
      texto: 'alta rechazada',
      estado: 'error',
      detalle: 'La clave de este prospecto no es nueva; avisa a la oficina. Avisa a la oficina; no lo vuelvas a capturar.',
    });
    expect(pastillaAlta({ sync_estado: 'error', sync_error: 'sin prefijo reconocible' })?.detalle).toBe(
      'sin prefijo reconocible Avisa a la oficina; no lo vuelvas a capturar.',
    );
  });
  it('sync_error null en error: texto genérico', () => {
    expect(pastillaAlta({ sync_estado: 'error', sync_error: null })).toEqual({
      texto: 'alta rechazada',
      estado: 'error',
      detalle: 'El servidor rechazó el alta. Avisa a la oficina; no lo vuelvas a capturar.',
    });
  });
});

describe('enlaceAFicha (T-75, D6; Review Focus 2)', () => {
  it('solo si existe el cliente local con ese id (prospectos de antes de T-75 no enlazan)', () => {
    expect(enlaceAFicha('p1', (id) => id === 'p1')).toBe('p1');
    expect(enlaceAFicha('viejo', () => false)).toBeNull();
  });
});

describe('listaProspectos (revisión final pieza 1, I1)', () => {
  const p = (id: string, nombre: string): Prospecto =>
    ({ id, nombre, domicilio: null, sync_estado: 'pendiente' }) as Prospecto;
  const cli = (id: string, nombre: string) => ({ id, nombre, domicilio: `Calle ${id}` });

  it('lo capturado hoy va primero, con su pastilla, y no se repite abajo', () => {
    const hoy = [p('h1', 'Tienda de hoy')];
    const r = listaProspectos(hoy, [cli('h1', 'Tienda de hoy'), cli('a', 'Abarrotes')], () => null, () => true);
    expect(r.capturadosHoy.map((f) => [f.id, f.local?.id, f.ficha])).toEqual([['h1', 'h1', 'h1']]);
    expect(r.otros.map((f) => f.id)).toEqual(['a']);
  });

  it('el prospecto de otro día o de otra tablet se lista y abre su ficha', () => {
    const ayer = p('ayer', 'Capturado ayer aquí');
    const r = listaProspectos(
      [],
      [cli('ayer', 'Capturado ayer aquí'), cli('otra', 'De otra tablet')],
      (id) => (id === 'ayer' ? ayer : null),
      () => true,
    );
    expect(r.otros.map((f) => [f.id, f.ficha, f.local])).toEqual([
      ['ayer', 'ayer', ayer],
      ['otra', 'otra', null],
    ]);
    expect(r.otros[1]!.domicilio).toBe('Calle otra');
  });

  it('una captura de hoy sin espejo en el catálogo se ve, pero no abre ficha', () => {
    const r = listaProspectos([p('rechazado', 'Rechazado')], [], () => null, () => false);
    expect(r.capturadosHoy).toMatchObject([{ id: 'rechazado', ficha: null }]);
    expect(r.otros).toEqual([]);
  });
});

describe('anchoMenuLateral (menu lateral, 2026-10-18)', () => {
  it('en el celular toma el 82% y deja una franja de la ruta para cerrar', () => {
    expect(anchoMenuLateral(360)).toBe(295);
    expect(anchoMenuLateral(360)).toBeLessThan(360);
  });
  it('en pantallas anchas no pasa de 320', () => {
    expect(anchoMenuLateral(412)).toBe(320);
    expect(anchoMenuLateral(1280)).toBe(320);
  });
  it('un ancho invalido no da negativo', () => {
    expect(anchoMenuLateral(-10)).toBe(0);
  });
});

