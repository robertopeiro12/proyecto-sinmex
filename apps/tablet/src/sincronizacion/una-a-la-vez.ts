/**
 * Envuelve una tarea asincrona para que nunca corra dos veces a la vez: quien
 * llama mientras ya corre recibe **la misma promesa** (el mismo resultado o el
 * mismo error); cuando termina, la siguiente llamada vuelve a correr.
 *
 * Existe por la sincronizacion (T-27, F1): su primer paso rota el refresh token
 * y el servidor trata un refresh reutilizado como robo (revoca todas las
 * sesiones del vendedor). Dos corridas en paralelo —la del login, el boton
 * "Sincronizar" o la respuesta a una carga tras un 401— mandarian el mismo
 * refresh dos veces.
 */
export function unaALaVez<T>(tarea: () => Promise<T>): () => Promise<T> {
  let enCurso: Promise<T> | null = null;
  return () => {
    if (enCurso) return enCurso;
    // `then` y no una llamada directa: aunque la tarea lance de forma sincrona,
    // `enCurso` ya esta puesto cuando el `finally` lo limpia.
    const corrida = Promise.resolve()
      .then(tarea)
      .finally(() => {
        enCurso = null;
      });
    enCurso = corrida;
    return corrida;
  };
}
