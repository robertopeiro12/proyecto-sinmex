import type { Migracion } from './motor';

/**
 * El estado de subida de la foto del prospecto (T-40).
 *
 * `foto_uri` ya existia desde 006, reservada y sin escribir. Lo que faltaba no
 * era donde guardar la ruta: era **como saber si esa foto ya esta arriba**, y
 * eso son tres datos que no se pueden derivar de nada de lo que ya hay.
 *
 * ## Por que no hay tabla nueva
 *
 * La foto es una propiedad del prospecto, una sola (el cliente dijo "foto del
 * lugar", singular), y su archivo vive fuera de SQLite. Una tabla aparte
 * obligaria a un join para pintar la fila de la pantalla y a un borrado en
 * cascada que hoy nadie necesita.
 *
 * ## Por que tres columnas y no un `foto_estado`
 *
 * El estado se **deriva** de los datos, en vez de vivir en una columna que
 * pueda contradecirlos:
 *
 * | `foto_uri` | `foto_subida_en` | `foto_descartada` | Estado |
 * |---|---|---|---|
 * | `null` | — | — | sin foto (un prospecto completo, ver el spec) |
 * | ruta | `null` | `0` | pendiente de subir |
 * | ruta | ISO | — | arriba |
 * | ruta | `null` | `1` | no recuperable, no se reintenta |
 *
 * Un `foto_estado = 'subida'` con `foto_subida_en` nulo seria representable y no
 * significaria nada; asi no.
 *
 * ## `foto_descartada` es lo que corta el bucle infinito
 *
 * > [!danger] Hay dos fallos de subida que NO se arreglan reintentando
 * > El servidor responde **413** si la foto pasa de 2 MB y **415** si el
 * > contenido no es un JPEG de verdad. Los dos son juicios sobre **estos
 * > bytes**: mandarlos otra vez da exactamente la misma respuesta. Sin esta
 * > bandera la tablet reintentaria esa foto en cada sincronizacion, para
 * > siempre, gastando la WiFi del negocio y sin que nadie se entere — el mismo
 * > patron que `MAX_BYTES_POR_LOTE` existe para cortar en el push.
 * >
 * > El tercer caso es el archivo local que desaparecio (la cache del sistema se
 * > limpio): tampoco vuelve, asi que tambien se descarta.
 *
 * Un fallo de red, en cambio, **si** se reintenta: solo deja `foto_error` y la
 * fila sigue en la cola.
 *
 * ## Lo que estas columnas NO pueden tocar
 *
 * Nada de aqui afecta `sync_estado` ni `sync_error`. Es el requisito que da
 * sentido a todo el diseno de T-40: **una foto que falla no puede llevarse el
 * prospecto**, porque el sintoma en produccion seria un cliente potencial
 * perdido en silencio. Ver `repositorios/prospectos.ts`.
 */
export const fotoProspecto: Migracion = {
  version: 7,
  nombre: 'foto-prospecto',
  sql: `
    -- Cuando la recibio el SERVIDOR, tal como lo devolvio en la respuesta. No
    -- es la hora de la tablet a proposito: es el unico dato que confirma que la
    -- foto esta del otro lado, y el reloj que lo dice tiene que ser el de alla.
    alter table prospecto add column foto_subida_en text;

    -- Ultimo motivo por el que no subio, para pintarlo en la fila. Se limpia al
    -- subir: un error viejo en pantalla junto a un "subida" es peor que nada.
    alter table prospecto add column foto_error text;

    -- No recuperable: 413, 415 o el archivo local desaparecido.
    alter table prospecto add column foto_descartada integer not null default 0
      check (foto_descartada in (0, 1));

    -- La cola del paso de fotos del motor. Parcial, igual que idx_prospecto_sync:
    -- el indice solo cubre las filas que el paso tiene que mirar, que son pocas
    -- y dejan de estar en cuanto la foto sube.
    --
    -- Lleva \`sync_estado\` como columna indexada (y no en el \`where\`) porque es la
    -- condicion que cambia con el push: la foto solo es elegible cuando el
    -- prospecto ya esta sincronizado, y antes de eso la fila sigue en el indice
    -- esperando su turno.
    create index idx_prospecto_foto_pendiente on prospecto (sync_estado)
      where foto_uri is not null and foto_subida_en is null and foto_descartada = 0;
  `,
};
