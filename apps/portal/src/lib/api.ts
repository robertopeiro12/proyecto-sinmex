export interface UsuarioSesion {
  id: string;
  login: string;
  nombre: string;
  perfil: string;
  sucursal: { id: string; codigo: string; nombre: string } | null;
  /** Claves de permiso efectivas, ya resueltas por el backend (perfil + excepciones). */
  permisos: string[];
}

export class ErrorApi extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * El mensaje que mando la API, cuando trae uno legible. Existe porque hay
     * errores que SOLO el servidor sabe explicar — "ya existe una sucursal con
     * el codigo TJ" — y degradarlos a un texto generico obligaria al usuario a
     * adivinar que campo corregir.
     */
    readonly mensajeApi?: string,
  ) {
    super(message);
  }
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Rutas publicas de autenticacion: un 401 aqui no significa "sesion vencida",
// significa "credenciales invalidas" (login) o "no hay sesion que renovar"
// (refresh). Reintentar via /auth/refresh en estos casos no tiene sentido y
// solo genera una peticion de mas en el camino mas comun del formulario. Si
// mas adelante hay mas rutas publicas (p. ej. la app tablet), se agregan aqui.
const RUTAS_PUBLICAS_AUTH = ["/auth/login", "/auth/refresh"];

/**
 * Refresco en vuelo, compartido por todas las llamadas (single-flight).
 *
 * Sin esto, dos peticiones en paralelo que reciben 401 a la vez —lo normal en
 * cuanto una pantalla cargue dos recursos y hayan pasado los 15 min del access
 * token— mandan DOS POST /auth/refresh con el MISMO refresh token. El servidor
 * hace lo correcto: dos usos del mismo token es su definicion de reuso, asi
 * que revoca la cadena entera. El sintoma para el usuario no seria un refresco
 * de mas, seria quedar fuera de una sesion perfectamente valida sin haber
 * hecho nada raro.
 *
 * Se arregla en el cliente y no en el servidor a proposito: una ventana de
 * gracia en el backend (aceptar el mismo token dos veces durante N segundos)
 * debilitaria la deteccion de reuso, que es la mejor propiedad de seguridad
 * que tiene el sistema. El cliente es quien causa el problema y quien puede
 * resolverlo sin ceder nada a cambio.
 */
let refrescoEnVuelo: Promise<boolean> | null = null;

function refrescarSesion(): Promise<boolean> {
  if (refrescoEnVuelo) {
    return refrescoEnVuelo;
  }

  const enVuelo = fetch(`${API}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  }).then((res) => res.ok);

  refrescoEnVuelo = enVuelo;

  // El cache se limpia cuando la promesa se ASIENTA, con exito o sin el. Si
  // solo se limpiara en el camino feliz, un refresco fallido (la red se cayo)
  // quedaria cacheado como promesa rechazada y todos los intentos posteriores
  // reusarian ese mismo fallo para siempre, sin volver a llamar a la API.
  //
  // La comparacion de identidad evita pisar un refresco POSTERIOR: si este
  // limpiado corriera cuando ya hay otro en vuelo, lo dejaria fuera del cache
  // y volveriamos a tener dos rotaciones en paralelo, que es justo lo que se
  // esta intentando impedir.
  const limpiar = () => {
    if (refrescoEnVuelo === enVuelo) {
      refrescoEnVuelo = null;
    }
  };
  // Los dos callbacks en un .then(), no un .finally(): asi el rechazo queda
  // manejado en esta rama y no produce un unhandledrejection suelto. A quien
  // espera se le devuelve `enVuelo` tal cual, de modo que el error le sigue
  // llegando completo y todos los que esperaban ven el mismo fallo.
  enVuelo.then(limpiar, limpiar);

  return enVuelo;
}

/**
 * Saca el mensaje de error del cuerpo. Nest manda `message` como cadena (las
 * excepciones normales) o como arreglo de cadenas (el ValidationPipe, una por
 * campo que fallo). Nunca lanza: si el cuerpo no es JSON, quien llama todavia
 * tiene el status, y un fallo leyendo el error no debe tapar el error.
 */
async function leerMensajeDeError(res: Response): Promise<string | undefined> {
  try {
    const cuerpo: unknown = await res.json();
    if (typeof cuerpo === "object" && cuerpo !== null && "message" in cuerpo) {
      const mensaje = (cuerpo as { message: unknown }).message;
      if (typeof mensaje === "string") {
        return mensaje;
      }
      if (Array.isArray(mensaje)) {
        return mensaje.filter((m): m is string => typeof m === "string").join(" ");
      }
    }
  } catch {
    // Cuerpo vacio o no-JSON: no hay nada que mostrar y no es un fallo.
  }
  return undefined;
}

/**
 * Llama a la API con las cookies de sesion. Ante un 401 intenta refrescar
 * UNA vez y reintenta; si tampoco funciona, propaga el 401 para que quien
 * llame mande al login.
 */
export async function apiFetch<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  // new Headers() en vez de spread: `init.headers` puede ser un objeto Headers
  // o un array de pares, y esparcir cualquiera de los dos con `...` no copia
  // nada (un Headers no tiene propiedades enumerables propias), asi que las
  // cabeceras de quien llama se perderian en silencio. Hoy nadie pasa una,
  // pero el dia que alguien lo haga el fallo no daria ninguna senal.
  const cabeceras = new Headers(init.headers);
  if (!cabeceras.has("Content-Type")) {
    cabeceras.set("Content-Type", "application/json");
  }

  const enviar = () =>
    fetch(`${API}${ruta}`, {
      ...init,
      credentials: "include",
      headers: cabeceras,
    });

  let res = await enviar();

  if (res.status === 401 && !RUTAS_PUBLICAS_AUTH.includes(ruta)) {
    if (await refrescarSesion()) {
      res = await enviar();
    }
  }

  if (!res.ok) {
    throw new ErrorApi(
      `La peticion a ${ruta} fallo`,
      res.status,
      await leerMensajeDeError(res),
    );
  }

  return (await res.json()) as T;
}
