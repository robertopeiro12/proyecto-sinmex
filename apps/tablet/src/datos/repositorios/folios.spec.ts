import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { relojFijo } from '../reloj';
import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';
import { crearRepositorioCatalogos } from './catalogos';
import {
  crearRepositorioFolios,
  ErrorFolio,
  formarFolio,
  MAX_OPERACIONES_POR_DIA,
  type RepositorioFolios,
} from './folios';

/**
 * Emision offline de [[Folios|folios]] (T-14).
 *
 * Es lo mas valioso que se puede verificar **sin una tablet**: el formato del
 * ADR, el reinicio diario (el bug que el ticket manda corregir), que no se
 * dupliquen ni se salten numeros, y que un reloj manipulado no rompa la
 * unicidad. Nada de esto necesita Android; todo esto se rompe en silencio si no
 * se prueba.
 */

const VENDEDOR = 'ven-1';

/**
 * Un reloj que se puede mover a mano, para poder cruzar la medianoche y
 * tambien para simular a un vendedor cambiando la fecha del dispositivo.
 */
function relojMovible(inicial: string) {
  let momento = inicial;
  return {
    reloj: {
      ahora: () => momento,
      hoy: () => momento.slice(0, 10),
    },
    mover(nuevo: string) {
      momento = nuevo;
    },
  };
}

/** Base migrada con el catalogo minimo cargado (1 sucursal TJ, vendedor AP). */
function montar(momento = '2026-08-07T15:00:00.000Z'): {
  deps: DepsRepositorio;
  folios: RepositorioFolios;
  mover: (m: string) => void;
} {
  const movible = relojMovible(momento);
  const base = depsDePrueba(momento);
  const deps: DepsRepositorio = { ...base, reloj: movible.reloj };

  // El snapshot trae la sucursal TJ y al vendedor `ven-1` con segmento `AP`,
  // que es el del ejemplo de ADR-0001.
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());

  return {
    deps,
    folios: crearRepositorioFolios(deps),
    mover: movible.mover,
  };
}

/* ================================================================== */

describe('formato del folio (ADR-0001)', () => {
  it('emite 12 caracteres en 6 segmentos, como el ejemplo del documento', () => {
    const { folios } = montar('2026-03-22T15:00:00.000Z');

    const emitido = folios.emitir({
      vendedorId: VENDEDOR,
      claveOperacion: 'op-1',
    });

    // El ejemplo literal del callout de ADR-0001: `TJ260322AP05` es
    // "sucursal Tijuana, del 22 de marzo de 2026, vendedor AP, operacion #05".
    // Esta es la #01.
    expect(emitido.folio).toBe('TJ260322AP01');
    expect(emitido.folio).toHaveLength(12);
    expect(emitido.folio).toMatch(/^[A-Z]{2}[0-9]{6}[A-Z]{2}[0-9]{2}$/);
  });

  it('los 6 segmentos dicen lo que ADR-0001 dice que dicen', () => {
    const { folios } = montar('2026-03-22T15:00:00.000Z');
    const { folio } = folios.emitir({
      vendedorId: VENDEDOR,
      claveOperacion: 'op-1',
    });

    expect(folio.slice(0, 2)).toBe('TJ'); // sucursal
    expect(folio.slice(2, 4)).toBe('26'); // ano
    expect(folio.slice(4, 6)).toBe('03'); // mes
    expect(folio.slice(6, 8)).toBe('22'); // dia
    expect(folio.slice(8, 10)).toBe('AP'); // vendedor
    expect(folio.slice(10, 12)).toBe('01'); // operacion del dia
  });

  it('el consecutivo va con dos digitos: la #1 es `01`, no `1`', () => {
    const { folios } = montar('2026-03-22T15:00:00.000Z');
    for (let i = 1; i <= 12; i++) {
      const { folio, consecutivo } = folios.emitir({
        vendedorId: VENDEDOR,
        claveOperacion: `op-${i}`,
      });
      expect(consecutivo).toBe(i);
      expect(folio.slice(10, 12)).toBe(`${i}`.padStart(2, '0'));
    }
  });

  it('`formarFolio` reproduce el ejemplo del documento v2.0', () => {
    // "TJ220313AP05": Tijuana, 13 de marzo de 2022, Abraham Perez, operacion 5.
    expect(formarFolio('TJ', '2022-03-13', 'AP', 5)).toBe('TJ220313AP05');
  });

  it('el segmento de vendedor sale del pull, no del nombre', () => {
    const { deps, folios } = montar();

    // El servidor le cambia el segmento (es lo unico que puede hacerlo). La
    // tablet lo refleja y folia con el nuevo, sin derivar nada de `nombre`.
    deps.bd.runSync(
      "update vendedor set folio_segmento = 'ZK' where id = $id",
      { $id: VENDEDOR },
    );

    expect(
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'op-1' }).folio,
    ).toBe('TJ260807ZK01');
  });

  it('sin segmento asignado NO folia, y lo dice en voz alta', () => {
    // Inventarse las iniciales aqui reintroduciria en silencio la ambiguedad
    // que sigue pendiente de confirmar con el cliente.
    const { deps, folios } = montar();
    deps.bd.runSync('update vendedor set folio_segmento = null where id = $id', {
      $id: VENDEDOR,
    });

    expect(() =>
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'op-1' }),
    ).toThrow(ErrorFolio);
    expect(() =>
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'op-1' }),
    ).toThrow(/Sincroniza con el servidor/);
  });
});

/* ================================================================== */

/**
 * **El bug que el ticket manda corregir.**
 *
 * En el sistema v1 "el vendedor empieza en la operacion que finalizo el dia
 * anterior". Si alguien quitara el arreglo —es decir, si el contador dejara de
 * colgar de la FECHA y pasara a leer "el ultimo folio emitido"— estas pruebas
 * se caen.
 */
describe('reinicio diario del contador', () => {
  it('al cambiar el dia, la primera operacion vuelve a 01', () => {
    const { folios, mover } = montar('2026-08-07T15:00:00.000Z');

    // Dia 1: tres operaciones.
    for (const clave of ['a1', 'a2', 'a3']) {
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: clave });
    }
    expect(folios.consecutivoDe(VENDEDOR, '2026-08-07')).toBe(3);

    // Dia 2.
    mover('2026-08-08T15:00:00.000Z');
    const primera = folios.emitir({
      vendedorId: VENDEDOR,
      claveOperacion: 'b1',
    });

    // NO hereda el 3 del dia anterior: arranca en 01.
    expect(primera.consecutivo).toBe(1);
    expect(primera.folio).toBe('TJ260808AP01');
    expect(primera.folio.slice(10, 12)).toBe('01');
  });

  it('reinicia cada dia durante una semana seguida', () => {
    const { folios, mover } = montar('2026-08-03T15:00:00.000Z');

    for (let dia = 3; dia <= 9; dia++) {
      const fecha = `2026-08-0${dia}`;
      mover(`${fecha}T15:00:00.000Z`);

      // Un numero distinto de operaciones cada dia, para que un contador que
      // arrastrara el valor anterior se note.
      for (let i = 1; i <= dia; i++) {
        folios.emitir({
          vendedorId: VENDEDOR,
          claveOperacion: `d${dia}-op${i}`,
        });
      }

      expect(folios.delDia(VENDEDOR, fecha)[0]?.consecutivo).toBe(1);
      expect(folios.consecutivoDe(VENDEDOR, fecha)).toBe(dia);
    }
  });

  it('el contador del dia anterior queda intacto', () => {
    // El reinicio no borra ni pisa nada: cada dia tiene su propia fila. Es lo
    // que hace que el corte del dia (T-38) siga cuadrando hacia atras.
    const { folios, mover } = montar('2026-08-07T15:00:00.000Z');
    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'a1' });
    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'a2' });

    mover('2026-08-08T15:00:00.000Z');
    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'b1' });

    expect(folios.consecutivoDe(VENDEDOR, '2026-08-07')).toBe(2);
    expect(folios.consecutivoDe(VENDEDOR, '2026-08-08')).toBe(1);
  });

  it('el dia es el LOCAL de la tablet, no el de UTC', () => {
    // A las 18:00 de Tijuana (UTC-7) en UTC ya es el dia siguiente. El folio
    // tiene que decir el dia de trabajo del vendedor, igual que
    // `fecha_operacion` (T-07). `relojFijo` corta el ISO, asi que aqui se
    // comprueba explicitamente que se usa `hoy()` y no una derivacion de UTC.
    const deps = depsDePrueba('2026-08-07T15:00:00.000Z');
    crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());

    const folios = crearRepositorioFolios({
      ...deps,
      reloj: relojFijo('2026-08-07T18:00:00.000-07:00'),
    });

    const { folio } = folios.emitir({
      vendedorId: VENDEDOR,
      claveOperacion: 'tarde',
    });
    expect(folio.slice(2, 8)).toBe('260807');
  });
});

/* ================================================================== */

describe('no duplica ni salta numeros', () => {
  it('100 emisiones seguidas dan 100 folios distintos y consecutivos', () => {
    const { folios } = montar();

    const emitidos = Array.from({ length: MAX_OPERACIONES_POR_DIA }, (_, i) =>
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: `op-${i}` }),
    );

    expect(new Set(emitidos.map((e) => e.folio)).size).toBe(
      MAX_OPERACIONES_POR_DIA,
    );
    // Sin huecos: 1..99, en orden.
    expect(emitidos.map((e) => e.consecutivo)).toEqual(
      Array.from({ length: MAX_OPERACIONES_POR_DIA }, (_, i) => i + 1),
    );
  });

  it('REENTRANTE: pedir folio dos veces para la misma operacion no quema un numero', () => {
    // El caso real: la app se cierra a media captura y al volver el usuario
    // reintenta la MISMA operacion. Si cada intento quemara un numero, la
    // numeracion del dia quedaria con huecos y el folio dejaria de significar
    // "la N-esima operacion de ese dia".
    const { folios } = montar();

    const primera = folios.emitir({
      vendedorId: VENDEDOR,
      claveOperacion: 'la-misma',
    });
    const segunda = folios.emitir({
      vendedorId: VENDEDOR,
      claveOperacion: 'la-misma',
    });
    const tercera = folios.emitir({
      vendedorId: VENDEDOR,
      claveOperacion: 'la-misma',
    });

    expect(segunda.folio).toBe(primera.folio);
    expect(tercera.folio).toBe(primera.folio);
    expect(folios.consecutivoDe(VENDEDOR)).toBe(1);
    expect(folios.delDia(VENDEDOR)).toHaveLength(1);

    // Y la siguiente operacion, que si es nueva, sigue en 02 y no en 04.
    expect(
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'otra' })
        .consecutivo,
    ).toBe(2);
  });

  it('intercalar operaciones nuevas y reintentos no descuadra la numeracion', () => {
    const { folios } = montar();

    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'a' }); // 01
    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'b' }); // 02
    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'a' }); // reintento
    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'c' }); // 03
    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'b' }); // reintento

    expect(folios.delDia(VENDEDOR).map((f) => f.consecutivo)).toEqual([
      1, 2, 3,
    ]);
    expect(folios.consecutivoDe(VENDEDOR)).toBe(3);
  });

  it('ATOMICO: si la transaccion de quien llama se revierte, el numero no se quema', () => {
    // Este es el contrato para T-16/T-20: emitir DENTRO de la transaccion que
    // guarda la operacion. Si la captura falla a medias, el folio se va con
    // ella y el numero vuelve a estar disponible — nada de huecos.
    const { deps, folios } = montar();

    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'primera' }); // 01

    expect(() =>
      enTransaccion(deps.bd, () => {
        folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'a-medias' });
        throw new Error('la captura de la venta fallo');
      }),
    ).toThrow('la captura de la venta fallo');

    // El contador volvio a 1 y no quedo folio emitido para esa operacion.
    expect(folios.consecutivoDe(VENDEDOR)).toBe(1);
    expect(folios.porOperacion('a-medias')).toBeNull();

    // Y la siguiente operacion se lleva el 02, que no se perdio.
    expect(
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'siguiente' })
        .consecutivo,
    ).toBe(2);
  });

  it('emite dentro de la transaccion de quien llama (savepoint anidado)', () => {
    // Si `emitir()` usara `begin` en vez de `savepoint`, esto reventaria con
    // "cannot start a transaction within a transaction".
    const { deps, folios } = montar();

    const dentro = enTransaccion(deps.bd, () =>
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'anidada' }),
    );

    expect(dentro.folio).toBe('TJ260807AP01');
    expect(folios.porOperacion('anidada')?.folio).toBe('TJ260807AP01');
  });

  it('se planta al llegar a 99: el consecutivo son 2 digitos', () => {
    // ADR-0001 acepta el limite ("suficiente hoy; vigilar a futuro"). Fallar es
    // lo unico honesto: dar la vuelta a 00 o crecer a 3 digitos romperia el
    // formato que el cliente confirmo, y el folio ya estaria escrito en papel.
    const { folios } = montar();

    for (let i = 1; i <= MAX_OPERACIONES_POR_DIA; i++) {
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: `op-${i}` });
    }
    expect(folios.consecutivoDe(VENDEDOR)).toBe(99);

    expect(() =>
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'la-100' }),
    ).toThrow(/99 operaciones/);

    // El intento fallido NO deja el contador en 100: el savepoint lo revirtio.
    expect(folios.consecutivoDe(VENDEDOR)).toBe(99);
  });
});

/* ================================================================== */

/**
 * El reloj del dispositivo lo puede cambiar el vendedor. ADR-0005 y ADR-0006 ya
 * aceptan esa superficie para la ventana offline y para `fecha_operacion`; aqui
 * se fija **que se garantiza y que no**.
 */
describe('reloj manipulado', () => {
  it('HACIA ATRAS: el contador de ese dia continua, no reinicia', () => {
    const { folios, mover } = montar('2026-08-07T15:00:00.000Z');

    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'a1' }); // 07 -> 01
    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'a2' }); // 07 -> 02

    mover('2026-08-08T15:00:00.000Z');
    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'b1' }); // 08 -> 01

    // El vendedor mueve la fecha atras, al dia 7.
    mover('2026-08-07T09:00:00.000Z');
    const vuelta = folios.emitir({
      vendedorId: VENDEDOR,
      claveOperacion: 'a3',
    });

    // NO reinicia en 01: esa fila ya existia y sigue donde iba. Es lo que
    // impide que se repita un folio ya emitido.
    expect(vuelta.consecutivo).toBe(3);
    expect(vuelta.folio).toBe('TJ260807AP03');
  });

  it('HACIA ADELANTE: abre el dia nuevo en 01 y al volver retoma el real', () => {
    const { folios, mover } = montar('2026-08-07T15:00:00.000Z');

    folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'a1' }); // 07 -> 01

    // Salto al futuro.
    mover('2027-01-01T15:00:00.000Z');
    const futuro = folios.emitir({
      vendedorId: VENDEDOR,
      claveOperacion: 'f1',
    });
    expect(futuro.folio).toBe('TJ270101AP01');

    // Y de vuelta al dia real.
    mover('2026-08-07T16:00:00.000Z');
    expect(
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'a2' }).consecutivo,
    ).toBe(2);
  });

  it('LO QUE SE GARANTIZA: pase lo que pase con el reloj, ningun folio se repite', () => {
    const { folios, mover } = montar('2026-08-07T15:00:00.000Z');

    const fechas = [
      '2026-08-07',
      '2026-08-08',
      '2026-08-07',
      '2025-01-01',
      '2026-08-08',
      '2027-12-31',
      '2026-08-07',
    ];

    const emitidos: string[] = [];
    fechas.forEach((fecha, i) => {
      mover(`${fecha}T15:00:00.000Z`);
      for (let n = 0; n < 3; n++) {
        emitidos.push(
          folios.emitir({
            vendedorId: VENDEDOR,
            claveOperacion: `op-${i}-${n}`,
          }).folio,
        );
      }
    });

    expect(new Set(emitidos).size).toBe(emitidos.length);
  });

  it('LO QUE NO SE GARANTIZA: la fecha del folio es la del reloj, sea cual sea', () => {
    // Queda documentado a proposito. Sin NTP no hay forma de saber la fecha
    // real, y el servidor solo corta lo que venga a mas de un dia en el futuro
    // (T-07). Un folio con fecha movida es un dato malo, pero es un dato malo
    // *detectable* y unico, no una colision.
    const { folios, mover } = montar();
    mover('2020-01-01T15:00:00.000Z');

    expect(
      folios.emitir({ vendedorId: VENDEDOR, claveOperacion: 'vieja' }).folio,
    ).toBe('TJ200101AP01');
  });
});
