/**
 * El 5o segmento del [[Folios|folio]]: las 2 letras que identifican al
 * [[Vendedor]] (T-14).
 *
 * > [!warning] ESTRATEGIA PROVISIONAL — pendiente de confirmar con el cliente
 * > [[ADR-0001 Formato de folios]] dice "inicial del nombre + inicial del
 * > apellido" y deja **explicitamente abierto** que pasa cuando dos vendedores
 * > comparten iniciales (dos "A P"). [[Vendedor]] repite la misma duda. Las
 * > fuentes no lo aclaran y `AGENTS.md` prohibe inventar reglas de negocio.
 * >
 * > Lo que hay aqui es una estrategia **defendible pero provisional**, marcada
 * > como tal en el vault (ADR-0007): se respeta la regla del ADR siempre que se
 * > pueda, y cuando choca se cede de forma **determinista** conservando la
 * > inicial del nombre. Puede cambiar en cuanto el cliente responda.
 *
 * ## Por que lo decide el servidor y no la tablet
 *
 * Porque la tablet **no puede**. T-07 fijo que del `pull` "de `vendedores` baja
 * **solo su propia ficha**": la tablet no ve a sus companeros, asi que no tiene
 * forma de saber si sus iniciales chocan con las de alguien. Solo el servidor
 * tiene la visibilidad global. El segmento se asigna aqui, se guarda en
 * `vendedor.folio_segmento` y viaja en el `pull` para que la tablet lo use tal
 * cual.
 *
 * ## Por que se pina y no se recalcula
 *
 * Un folio emitido **no se corrige hacia atras** — esta escrito en una nota
 * fisica firmada. Si el segmento se recalculara, dar de alta a un companero con
 * las mismas iniciales cambiaria el segmento de alguien que ya tiene folios en
 * la calle. Se asigna una vez y no se toca, igual que el codigo de sucursal
 * (T-09), que es inmutable exactamente por lo mismo.
 *
 * > [!info] La misma estrategia esta duplicada en SQL
 * > El backfill de `supabase/migrations/20260807223000_folios.sql` hace esto
 * > mismo para los vendedores que ya existian. Si tocas una, toca la otra.
 */

/** Acentos y enes que el folio no puede llevar: el segmento es A-Z. */
const ACENTOS = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
const SIN_ACENTOS = 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';

/** El nombre reducido a palabras de A-Z, sin acentos ni signos. */
export function palabrasDelNombre(nombre: string): string[] {
  const plano = [...nombre]
    .map((c) => {
      const i = ACENTOS.indexOf(c);
      return i === -1 ? c : SIN_ACENTOS[i];
    })
    .join('')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ');

  return plano.split(' ').filter((p) => p !== '');
}

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Los candidatos a segmento, **en orden de preferencia**. El primero libre gana.
 *
 * 1. La regla del ADR: inicial del nombre + inicial del apellido.
 * 2. Si choca: se conserva la inicial del nombre —es lo que hace el folio
 *    legible de un vistazo— y la segunda letra camina por el resto del
 *    apellido. `Ana Ponce` con `AP` tomado da `AO`, que sigue leyendose como
 *    "Ana P**o**nce".
 * 3. Despues, A..Z con la misma inicial.
 * 4. Ultimo recurso, `AA..ZZ`.
 *
 * Un nombre de una sola palabra (sin apellido registrado) usa sus dos primeras
 * letras. Es uno de los huecos que el cliente tiene que cerrar.
 */
export function candidatosDeSegmento(nombre: string): string[] {
  const palabras = palabrasDelNombre(nombre);
  const candidatos: string[] = [];

  const inicial = palabras[0]?.[0];
  const apellido = palabras[1];

  if (inicial !== undefined && apellido !== undefined) {
    candidatos.push(inicial + apellido[0]);
    for (const letra of apellido.slice(1)) candidatos.push(inicial + letra);
  } else if (palabras[0] !== undefined && palabras[0].length >= 2) {
    candidatos.push(palabras[0].slice(0, 2));
  }

  if (inicial !== undefined) {
    for (const letra of LETRAS) candidatos.push(inicial + letra);
  }

  for (const a of LETRAS) {
    for (const b of LETRAS) candidatos.push(a + b);
  }

  // Sin duplicados, conservando el orden de preferencia.
  return [...new Set(candidatos)].filter((c) => /^[A-Z]{2}$/.test(c));
}

/**
 * El segmento que le toca a `nombre`, dado lo que ya esta ocupado.
 *
 * Devuelve `null` solo si las 676 combinaciones estan tomadas — que seria una
 * empresa con 676 vendedores vivos y un problema mayor que este.
 */
export function asignarSegmento(
  nombre: string,
  ocupados: ReadonlySet<string>,
): string | null {
  return candidatosDeSegmento(nombre).find((c) => !ocupados.has(c)) ?? null;
}
