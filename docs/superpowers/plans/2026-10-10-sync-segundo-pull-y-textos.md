# Tablet · segundo pull tras subir y tres textos que confunden — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que lo que el servidor deriva de lo recién subido (la nota a crédito de una venta, el saldo tras un cobro) baje en la **misma** sincronización, y que tres textos de la tablet dejen de confundir al vendedor (fecha ISO en UTC, error de kilometraje que no se borra, "Entre X y X").

**Architecture:** Solo `apps/tablet`. (1) `src/sincronizacion/motor.ts` gana un paso 5: si el push aplicó algo o subió alguna foto, vuelve a llamar a `bajar(token)` (incremental por cursor), suma sus filas al resumen y, si falla por una condición de campo, deja `ok` intacto y lo anota en `pullPosterior: 'fallo'`. (2) Helper puro `formatearMomento` en `src/ui/momento.ts`, usado en las dos pantallas que hoy pintan `frescuraCatalogos()` crudo. (3) Dos `onChangeText` que borran el error y una función pura `ayudaRangoFecha` en `src/datos/cobranzas-textos.ts` para la ayuda de *Fecha de pago*.

**Tech Stack:** Expo SDK 57 / React Native 0.86 · expo-router · SQLite (`expo-sqlite` en la tablet, `better-sqlite3` en pruebas) · Jest 29 + ts-jest en Node (tablet)

**Spec:** `docs/superpowers/specs/2026-10-10-sync-segundo-pull-y-textos-design.md` — decisiones D1…D4, vinculantes. Lo que el código obliga a precisar y el spec no dice va marcado **Precisión del plan** en cada tarea y resumido en "Conflictos para el controlador".

## Global Constraints

Del spec (copiadas tal cual):

- Código en español, identificadores sin acentos, mensajes al usuario con acentos. Comentarios que explican *por qué*.
- Solo `apps/tablet/`. Sin cambios de contrato ni de backend ni migraciones locales de SQLite.
- `npm run typecheck --workspace=apps/tablet`, `npm run lint --workspace=apps/tablet`, `npm test --workspace=apps/tablet` en verde; los conteos los mide el implementador contra la línea base, no se escriben en el plan.
- Los implementadores no despachan subagentes, no empujan, no mergean.

Del proceso (roadmap §4 y `CLAUDE.md` de la carpeta):

- **Worktree y rama:** todo se hace en `/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync`, rama `fix/sync-segundo-pull-y-textos`. **Nunca** se toca `JAWA ANDROID/proyecto-sinmex` (clon de demo, solo lectura) ni los demás clones hermanos.
- **Todo comando se corre desde la raíz del worktree** con `--workspace=apps/tablet`, nunca entrando a `apps/tablet`. La ruta tiene un espacio: va entre comillas.
- **Los conteos de pruebas se miden contra la línea base al inicio, no se escriben aquí.** Cada tarea dice qué pruebas agrega; el implementador comprueba que el total subió exactamente en ese número.
- **Sin pruebas de pantalla:** `jest.config.js` corre Node puro con ts-jest (`roots: ['<rootDir>/src']`, `testMatch: ['**/*.spec.ts']`, transform solo `^.+\.ts$`), no hay `*.spec.tsx` en el repo ni `@testing-library/react-native` en `package.json`. Las pantallas (`app/**/*.tsx`) se verifican con `typecheck` + `lint`; no se inventa infraestructura.
- **Commits:** mensaje que empieza con `Tablet:` y termina exactamente con la línea
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- Al terminar cada tarea, `git status --short` sale vacío (todo commiteado, nada extra).

## Review Focus

Entradas que el spec implica y que ninguna frase suya prueba; cada una tiene su prueba en la tarea dueña.

1. **El segundo pull es incremental y llega con `completo: false`.** El resumen no puede decir "incompleto" por eso: conserva el `completo` del primer pull. → Task 1, prueba "vuelve a bajar y SUMA las filas".
2. **Push que llegó al servidor pero no aplicó nada (solo `duplicada`/`rechazada`).** `aplicadas` es 0: no hay pull posterior. → Task 1, prueba "solo duplicadas".
3. **Solo subió una foto (push vacío).** También dispara el pull posterior (el spec lo dice: "o se subió al menos una foto"). → Task 1, prueba "una foto subida sin nada en el push".
4. **El pull posterior falla por un bug, no por la red.** Se propaga, igual que en los pasos 2-4 (doctrina del motor: tragarse un error desconocido lo vuelve "no se sabe por qué"); lo subido ya está confirmado en SQLite. → Task 1, prueba "un error que no reconoce en el pull posterior".
5. **`frescuraCatalogos()` con minutos/horas de un dígito, o con algo que no es fecha.** Se rellena con cero (`07:04`, no `7:4`) y una cadena inválida dice `nunca`, no `NaN-NaN-NaN`. → Task 2, pruebas de relleno y de cadena inválida.

Conocido y fuera de alcance (no se prueba ni se arregla aquí): si el reloj de la tablet va atrasado y `nota.fecha > hoy`, la ayuda sigue diciendo *"Entre {nota.fecha} y {hoy}."* como hoy; `problemasDeCobro` ya rechaza la fecha.

---

## Línea base (antes de la Task 1; no es una tarea)

Lo corre el implementador de la Task 1 (o el controlador) y **anota los números en su reporte**:

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
git branch --show-current                       # fix/sync-segundo-pull-y-textos
git status --short                              # vacío
npm run typecheck --workspace=apps/tablet       # sin errores
npm run lint --workspace=apps/tablet            # sin errores
npm test --workspace=apps/tablet                # anota "Test Suites: N passed" y "Tests: M passed"
```

Si `git status --short` no está vacío o algo de lo anterior no sale en verde, **detente** y avisa al controlador.

---

## Estructura de archivos

| Archivo | Tarea | Qué cambia |
|---|---|---|
| `apps/tablet/src/sincronizacion/motor.ts` | 1 | Cabecera (paso 5), campo `pullPosterior` en `ResultadoSincronizacion`, paso 5 en `sincronizar()` |
| `apps/tablet/src/sincronizacion/motor.spec.ts` | 1 | Dos aserciones de orden actualizadas + bloque `pull posterior (paso 5)` |
| `apps/tablet/src/ui/momento.ts` | 2 | **Nuevo**: `formatearMomento` |
| `apps/tablet/src/ui/momento.spec.ts` | 2 | **Nuevo**: sus pruebas |
| `apps/tablet/app/(jornada)/index.tsx` | 2 | "Catálogos bajados" con `formatearMomento` |
| `apps/tablet/app/(jornada)/operacion/index.tsx` | 2 | Ídem |
| `apps/tablet/src/datos/cobranzas-textos.ts` | 3 | `ayudaRangoFecha` |
| `apps/tablet/src/datos/cobranzas-textos.spec.ts` | 3 | Sus pruebas |
| `apps/tablet/src/datos/index.ts` | 3 | Re-exporta `ayudaRangoFecha` |
| `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx` | 3 | La ayuda de *Fecha de pago* usa `ayudaRangoFecha` |
| `apps/tablet/app/abrir-dia.tsx` | 3 | `onChangeText` del km borra el error |
| `apps/tablet/app/(jornada)/cerrar-dia.tsx` | 3 | Ídem |

Las tres tareas son independientes entre sí (no comparten archivos ni símbolos); el orden es el del spec.

---

### Task 1: Segundo pull al final de la sincronización (D1)

**Implementador:** `sonnet` · **Revisor:** `sonnet`

**Files:**
- Modify: `apps/tablet/src/sincronizacion/motor.ts` (cabecera líneas 1-39; `ResultadoSincronizacion` líneas 150-167; `sincronizar()` líneas 221-233)
- Test: `apps/tablet/src/sincronizacion/motor.spec.ts` (líneas 238 y 613; bloque nuevo antes de la línea 596)

**Interfaces:**
- Consumes: nada de otras tareas. Usa lo que ya existe en `motor.ts`: `bajar(token): Promise<ResumenPull>`, `traducir(error): { motivo; detalle? }` (relanza lo que no reconoce), `ResumenPull { completo; cursor; filas; notas }`.
- Produces: `ResultadoSincronizacion.pullPosterior?: 'fallo'` (campo opcional nuevo). Ninguna pantalla lo lee todavía (D1: "no se cambia ningún texto por eso ahora"). `resultado.pull.filas`, que `app/(jornada)/index.tsx` ya muestra como "Se bajaron N registro(s)", ahora incluye las filas del segundo pull.

**Precisión del plan** (el spec no lo dice y el código lo obliga):
- **Qué cuenta como "falla" del segundo pull.** Se atrapa con el `traducir()` que ya existe: sin red, sesión rechazada, contrato, alcance → `ok` sigue `true` y `pullPosterior: 'fallo'`. Un error que `traducir` no reconoce (un bug, p. ej. un `TypeError` o una llave foránea rota al aplicar el snapshot) **se propaga**, como en los pasos 2, 3 y 4 (`motor.ts:226-227`, `:372-374`). Lo subido ya está confirmado en SQLite, así que propagarlo no pierde nada.
- **Cómo se combinan los dos `ResumenPull`.** `filas` se suma (D1). `notas` también se suma (es el mismo tipo de conteo: lo que bajó en esta pasada). `cursor` es el del segundo (el más nuevo, el que quedó guardado). `completo` es el del primero: el segundo es incremental y siempre diría `false`, lo que se leería como "faltó algo". Si el segundo falla, el resumen y el cursor se quedan como los dejó el primero.
- **Dos pruebas existentes cambian** porque ahora hay un `pull` más al final cuando el push aplicó algo: `motor.spec.ts:238` (jornada cerrada → push aplica 1) y `motor.spec.ts:613` (prospecto aplicado + foto subida). Ninguna otra prueba existente asserta `pulls.length`, `pull.filas` u `orden` con un push que aplique algo (la de la línea 303 lee `pulls[1]` de una **segunda** `sincronizar()` sin push: no cambia). No "arregles" otra prueba: si falla otra, detente y avisa.

- [ ] **Step 1: Actualiza las dos aserciones de orden existentes**

En `apps/tablet/src/sincronizacion/motor.spec.ts`, línea 238, reemplaza:

```ts
      expect(escenario.orden).toEqual(['renovar', 'pull', 'push']);
```

por:

```ts
      // El ultimo `pull` es el paso 5: el push aplico la jornada, asi que se
      // vuelve a bajar para traer lo que el servidor derivo de ella.
      expect(escenario.orden).toEqual(['renovar', 'pull', 'push', 'pull']);
```

Línea 613, reemplaza:

```ts
      expect(escenario.orden).toEqual(['renovar', 'pull', 'push', 'foto']);
```

por:

```ts
      // El pull posterior (paso 5) va despues de las fotos, no entre el push y
      // ellas: asi tambien trae lo que cambio al subir la foto.
      expect(escenario.orden).toEqual(['renovar', 'pull', 'push', 'foto', 'pull']);
```

- [ ] **Step 2: Agrega el bloque de pruebas del paso 5**

En el mismo archivo, inserta el bloque siguiente **justo antes** del comentario que abre las pruebas de fotos (líneas 596-597; queda dentro del `describe('motor de sincronizacion', …)`, después del `});` que cierra `describe('cuando algo sale mal', …)`). Es decir, antes de estas líneas, que se quedan como están:

```ts
  /**
   * El paso 4: las fotos de los prospectos (T-40).
```

Bloque a insertar:

```ts
  /**
   * El paso 5 (2026-10-10): el pull posterior.
   *
   * El pull del paso 2 corre ANTES de subir, asi que no puede traer lo que el
   * servidor deriva de lo subido. Medido en el emulador: una venta a credito
   * recien subida no aparecia para cobrar hasta la SEGUNDA sincronizacion.
   */
  describe('pull posterior (paso 5)', () => {
    /** El cursor que devuelve el pull incremental de la segunda vuelta. */
    const CURSOR_POSTERIOR = '2026-08-07T15:00:10.000Z';

    /**
     * Lo que trae un pull incremental justo despues de subir: solo lo que
     * cambio. Aqui, las dos notas pendientes y ningun catalogo.
     */
    function pullIncremental(): RespuestaPull {
      const base = respuestaPullDePrueba();
      return {
        ...base,
        desde: base.cursor,
        completo: false,
        cursor: CURSOR_POSTERIOR,
        catalogos: {
          sucursales: [],
          vendedores: [],
          vehiculos: [],
          productos: [],
          presentaciones: [],
          clientes: [],
          tipos_negocio: [],
          precios: [],
        },
      };
    }

    /** Las filas que el motor cuenta para una respuesta (igual que `contarFilas`). */
    function filasDe(respuesta: RespuestaPull): number {
      return Object.values(aSnapshot(respuesta)).reduce(
        (total, filas) => total + (filas?.length ?? 0),
        0,
      );
    }

    it('con algo aplicado en el push, vuelve a bajar y SUMA las filas', async () => {
      let vuelta = 0;
      const { motor, escenario, jornadas, catalogos, sync } = montar({
        pull: () => {
          vuelta += 1;
          return vuelta === 1 ? respuestaPullDePrueba() : pullIncremental();
        },
      });
      conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();

      expect(r.ok).toBe(true);
      expect(escenario.orden).toEqual(['renovar', 'pull', 'push', 'pull']);
      // Incremental: el segundo pide desde el cursor que dejo el primero, no
      // desde cero. Por eso es barato.
      expect(escenario.pulls.map((p) => p.desde)).toEqual([null, '2026-08-07T14:59:55.000Z']);
      expect(r.pull).toEqual({
        // El del primer pull: el incremental siempre diria `false` y se leeria
        // como que falto algo.
        completo: true,
        cursor: CURSOR_POSTERIOR,
        filas: filasDe(respuestaPullDePrueba()) + filasDe(pullIncremental()),
        notas: 4,
      });
      expect(sync.leerCursor()).toBe(CURSOR_POSTERIOR);
      expect(r.pullPosterior).toBeUndefined();
    });

    it('sin nada que subir, baja UNA sola vez', async () => {
      const { motor, escenario } = montar({});

      const r = await motor.sincronizar();

      expect(r.ok).toBe(true);
      expect(escenario.pulls).toHaveLength(1);
      expect(escenario.orden).toEqual(['renovar', 'pull']);
      expect(r.pullPosterior).toBeUndefined();
    });

    it('si el push no aplico nada (solo duplicadas), tampoco vuelve a bajar', async () => {
      // `duplicada` quiere decir que el servidor ya lo tenia desde antes, asi
      // que el pull del paso 2 ya trajo lo que derivo de ello.
      const { motor, escenario, jornadas, catalogos } = montar({
        push: (ops) => ({
          contrato: 1,
          recibido_en: '2026-08-07T15:00:00.000Z',
          resumen: { recibidas: ops.length, aplicadas: 0, duplicadas: ops.length, rechazadas: 0 },
          resultados: ops.map((o) => ({
            clave: o.clave,
            tipo: o.tipo,
            estado: 'duplicada' as const,
            id_servidor: `srv-${o.clave}`,
          })),
        }),
      });
      conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();

      expect(r.ok).toBe(true);
      expect(r.push?.duplicadas).toBe(1);
      expect(escenario.pulls).toHaveLength(1);
    });

    it('una foto subida sin nada en el push tambien dispara el pull posterior', async () => {
      let intentos = 0;
      const { motor, prospectos, escenario } = montarConFotos({
        subirFoto: async () => {
          intentos += 1;
          if (intentos === 1) throw new SinRedError();
          return FOTO_SUBIDA_EN;
        },
      });
      conProspectoConFoto(prospectos);

      // 1a pasada: el push aplica el prospecto (pull posterior) y la foto falla.
      await motor.sincronizar();
      expect(escenario.pulls).toHaveLength(2);

      // 2a pasada: push vacio, pero la foto sube: tambien hay pull posterior.
      const r = await motor.sincronizar();

      expect(r.push?.aplicadas).toBe(0);
      expect(r.fotos?.subidas).toBe(1);
      expect(escenario.pulls).toHaveLength(4);
    });

    it('si el pull posterior falla por red, la sincronizacion sigue ok y lo anota', async () => {
      let vuelta = 0;
      const { motor, jornadas, catalogos, sync } = montar({
        pull: () => {
          vuelta += 1;
          return vuelta === 1 ? respuestaPullDePrueba() : Promise.reject(new SinRedError());
        },
      });
      const jornada = conJornadaCerrada(jornadas, catalogos);

      const r = await motor.sincronizar();

      // Lo subido ya esta a salvo y el siguiente pull lo trae: decirle al
      // vendedor que la sincronizacion fallo seria mentirle.
      expect(r.ok).toBe(true);
      expect(r.motivo).toBeUndefined();
      expect(r.pullPosterior).toBe('fallo');
      expect(r.push?.aplicadas).toBe(1);
      expect(jornadas.porId(jornada.id)?.sync_estado).toBe('sincronizado');
      // El resumen y el cursor son los del primer pull, intactos.
      expect(r.pull).toEqual({
        completo: true,
        cursor: '2026-08-07T14:59:55.000Z',
        filas: filasDe(respuestaPullDePrueba()),
        notas: 2,
      });
      expect(sync.leerCursor()).toBe('2026-08-07T14:59:55.000Z');
    });

    it('un error que no reconoce en el pull posterior se deja propagar', async () => {
      // La doctrina del motor: tragarse un bug lo convierte en "no se sabe por
      // que". El push ya esta confirmado en SQLite, asi que no se pierde nada.
      let vuelta = 0;
      const { motor, jornadas, catalogos } = montar({
        pull: () => {
          vuelta += 1;
          return vuelta === 1
            ? respuestaPullDePrueba()
            : Promise.reject(new TypeError('undefined is not a function'));
        },
      });
      const jornada = conJornadaCerrada(jornadas, catalogos);

      await expect(motor.sincronizar()).rejects.toThrow(TypeError);

      expect(jornadas.porId(jornada.id)?.sync_estado).toBe('sincronizado');
    });
  });

```

(Todo lo que usa ya está importado o definido en el archivo: `respuestaPullDePrueba`, `aSnapshot`, `RespuestaPull`, `SinRedError`, `montar`, `montarConFotos`, `conJornadaCerrada`, `conProspectoConFoto`, `FOTO_SUBIDA_EN`. No agregues imports.)

- [ ] **Step 3: Corre las pruebas del motor y comprueba que fallan por lo esperado**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
npm test --workspace=apps/tablet -- src/sincronizacion/motor.spec.ts
```

Expected: FAIL — **la suite entera no compila**: ts-jest (con sus diagnósticos por defecto) reporta `Property 'pullPosterior' does not exist on type 'ResultadoSincronizacion'` y no corre ninguna prueba del archivo. Ese es el rojo esperado. Si quieres ver los fallos de aserción, haz el Step 5 (el tipo) y vuelve a correr antes del Step 6: entonces fallan las dos aserciones de orden del Step 1 (reciben un `pull` menos), "vuelve a bajar y SUMA las filas", "una foto subida sin nada en el push", "si el pull posterior falla por red" (`pullPosterior` es `undefined`) y "un error que no reconoce en el pull posterior" (resuelve en vez de rechazar); pasan "sin nada que subir" y "solo duplicadas". Cualquier **otro** error o prueba que falle: detente.

- [ ] **Step 4: Reescribe la cabecera del motor**

En `apps/tablet/src/sincronizacion/motor.ts`, reemplaza el comentario de cabecera completo (líneas 1-39, desde `/**` hasta el `*/` que va antes de `import type { RepositorioCatalogos`) por:

```ts
/**
 * Motor de sincronizacion de la tablet (T-07).
 *
 * Cinco pasos, **en este orden**:
 *
 * 1. **Renovar la sesion.** No es un detalle de implementacion, es un requisito
 *    escrito: desde T-06 la tablet solo opera 72 h sin hablar con el servidor,
 *    y ese contador se reinicia con cada contacto exitoso. Si la
 *    sincronizacion bajara el dia sin renovar, el vendedor podria descargarlo
 *    todo correctamente y aun asi quedarse fuera de su app al dia siguiente,
 *    sin ninguna pista de por que. Ese mismo refresh es ademas **el unico
 *    camino** por el que una baja hecha en el portal llega a la tablet.
 *    Ver ADR-0005 y [[Sincronizacion offline]].
 * 2. **Pull.** Catalogos, precios ya resueltos y notas pendientes. Incremental
 *    si ya hay cursor guardado.
 * 3. **Push.** La operacion capturada offline, por lotes idempotentes.
 * 4. **Fotos de prospectos** (T-40). Un `POST` por foto, fuera del lote.
 * 5. **Pull posterior** (2026-10-10). Solo si el push aplico algo o subio
 *    alguna foto: otro pull incremental, por cursor.
 *
 * El pull va **antes** del push a proposito: si la conexion se corta a la
 * mitad, es preferible haber refrescado los catalogos (el vendedor puede seguir
 * trabajando) que haber subido el dia y quedarse con datos viejos. Y lo subido
 * no se pierde: sigue en la cola, y reenviarlo no duplica nada.
 *
 * Las fotos van **al final, despues del push, y eso es obligatorio**: antes de
 * que el servidor acepte el alta no existe la fila `cliente` a la que la foto
 * pertenece, asi que subirla solo podria dar 404. Un prospecto capturado en esta
 * misma pasada ya es elegible en esta misma pasada, porque el push corrio antes.
 *
 * > [!danger] El paso 4 no puede tocar el estado de ningun prospecto
 * > Es el fallo que todo el diseno de la foto existe para prevenir: si la foto se
 * > llevara el alta, se perderia un cliente potencial **en silencio**. Por eso el
 * > paso 4 escribe solo en las columnas de foto, y por eso un fallo aqui **no
 * > pone `ok: false`** — el negocio del dia ya subio, y decirle al vendedor que
 * > la sincronizacion fallo por una foto opcional seria mentirle. Lo que si hace
 * > es reportarlo en `fotos`. Ver `subirFotos` y `api-foto.ts`.
 *
 * El paso 5 existe porque el pull del paso 2, por ir antes, **no puede traer lo
 * que el servidor deriva de lo que se acaba de subir**. Medido en el emulador el
 * 2026-10-10: una venta a credito (`TJ261010DM01`) grabada y sincronizada dio
 * "se bajaron 0 y se subieron 1", y la pantalla de Cobranza decia que el
 * cliente no tenia notas pendientes; la nota (saldo $280.00) aparecio hasta la
 * SEGUNDA sincronizacion. Lo mismo con el saldo nuevo tras un cobro. El orden
 * pull → push → fotos se conserva (la razon de arriba sigue valiendo); lo que
 * faltaba era bajar otra vez al final. Va despues de las fotos para traer
 * tambien lo que cambio al subirlas. Si falla por red o sesion, **no pone
 * `ok: false`**: lo subido ya esta a salvo y el siguiente pull lo trae; se
 * anota en `pullPosterior`.
 *
 * Todo esto es probable en Node: recibe la API, la capa de datos, la sesion y
 * el reloj por inyeccion. Ver `motor.spec.ts`.
 */
```

- [ ] **Step 5: Agrega `pullPosterior` a `ResultadoSincronizacion`**

En el mismo archivo, dentro de `export interface ResultadoSincronizacion`, reemplaza:

```ts
  fotos?: ResumenFotos;
}
```

por:

```ts
  fotos?: ResumenFotos;
  /**
   * El paso 5. Presente solo si el pull posterior se intento y fallo por una
   * condicion de campo (sin red, sesion, contrato, alcance).
   *
   * Informativo: nunca cambia `ok`. Lo subido ya esta en el servidor y el
   * siguiente pull lo trae; la tarjeta puede decirlo algun dia, pero hoy ningun
   * texto lo lee. `pull` sigue siendo el resumen del primer pull.
   */
  pullPosterior?: 'fallo';
}
```

(El bloque `fotos?: ResumenFotos;` seguido de `}` aparece una sola vez: es el final de `ResultadoSincronizacion`.)

- [ ] **Step 6: Agrega el paso 5 a `sincronizar()`**

En el mismo archivo, reemplaza:

```ts
      resultado.fotos = await subirFotos(token);

      return resultado;
    },
```

por:

```ts
      resultado.fotos = await subirFotos(token);

      // --- 5. Pull posterior, solo si esta pasada subio algo.
      //
      // El pull del paso 2 corrio antes de subir, asi que no trae lo que el
      // servidor derivo de lo subido: la nota a credito de una venta, el saldo
      // tras un cobro. Sin esto el vendedor tenia que sincronizar dos veces
      // para poder cobrar la venta que acababa de hacer (ver la cabecera). Si no
      // se aplico nada (todo `duplicada` o `rechazada`) el servidor no cambio
      // por esta pasada, y el pull del paso 2 ya trajo lo que habia.
      if (resultado.push.aplicadas > 0 || resultado.fotos.subidas > 0) {
        const primerPull = resultado.pull;
        try {
          const posterior = await bajar(token);
          resultado.pull = {
            // El del primer pull: el posterior es incremental y siempre diria
            // `false`, que se leeria como que falto algo.
            completo: primerPull.completo,
            // El mas nuevo, que es el que `bajar` dejo guardado.
            cursor: posterior.cursor,
            filas: primerPull.filas + posterior.filas,
            notas: primerPull.notas + posterior.notas,
          };
        } catch (error) {
          // `traducir` relanza lo que no reconoce: un bug se propaga igual que
          // en los pasos 2 a 4. Una condicion de campo NO pone `ok: false` —
          // lo subido ya esta a salvo y el siguiente pull lo trae —, solo se
          // anota. El cursor y el snapshot del primer pull quedan como estaban.
          traducir(error);
          resultado.pullPosterior = 'fallo';
        }
      }

      return resultado;
    },
```

Nota de tipos: `resultado.pull`, `resultado.push` y `resultado.fotos` ya están estrechados a no-`undefined` en este punto (se asignaron arriba y los `catch` de los pasos 2 y 3 hacen `return`); compila sin `!` ni `?.`. Si `typecheck` dijera lo contrario, **no** agregues `!`: avisa al controlador.

- [ ] **Step 7: Corre las pruebas del motor**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
npm test --workspace=apps/tablet -- src/sincronizacion/motor.spec.ts
```

Expected: PASS, todas.

- [ ] **Step 8: Verificación completa**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
```

Expected: typecheck y lint sin errores; `npm test` en verde con **6 pruebas más** que la línea base y el mismo número de suites.

- [ ] **Step 9: Commit**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
git add apps/tablet/src/sincronizacion/motor.ts apps/tablet/src/sincronizacion/motor.spec.ts
git commit -m "$(cat <<'EOF'
Tablet: segundo pull al final de la sincronizacion si se subio algo

El pull corre antes del push a proposito, asi que no traia lo que el
servidor deriva de lo subido: una venta a credito no aparecia para cobrar
hasta la segunda sincronizacion. Ahora, si el push aplico algo o subio una
foto, se baja otra vez (incremental) al final; las filas se suman y un fallo
de campo no cambia ok, solo se anota en pullPosterior.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
git status --short   # vacío
```

---

### Task 2: Fecha y hora legibles en hora local (D2)

**Implementador:** `haiku` · **Revisor:** `sonnet`

**Files:**
- Create: `apps/tablet/src/ui/momento.ts`
- Test: `apps/tablet/src/ui/momento.spec.ts`
- Modify: `apps/tablet/app/(jornada)/index.tsx` (import + línea 154)
- Modify: `apps/tablet/app/(jornada)/operacion/index.tsx` (import + línea 42)

**Interfaces:**
- Consumes: `datos.catalogos.frescuraCatalogos(): string | null` (ya existe en `src/datos/repositorios/catalogos.ts:390`).
- Produces: `export function formatearMomento(iso: string | null): string` en `@/ui/momento`.

**Precisión del plan:**
- **Archivo propio `.ts`, no junto a `cifra.tsx`.** El spec dice "junto a `cifra.ts`", pero el archivo real es `src/ui/cifra.tsx` e importa `react-native`. Jest de la tablet corre en Node puro con ts-jest: `roots: ['<rootDir>/src']`, `testMatch: ['**/*.spec.ts']` y transform solo `^.+\.ts$`. Una prueba que importara de `cifra.tsx` no cargaría. Por eso el helper va en `src/ui/momento.ts` (misma carpeta, al lado de `cifra.tsx`) con su `momento.spec.ts`, igual que `src/ui/responsivo.ts` / `responsivo.spec.ts`, que ya se recogen. No hace falta tocar `jest.config.js`.
- **Firma `iso: string | null`.** El spec escribe `formatearMomento(iso: string)` y a la vez pide `null → 'nunca'`; `frescuraCatalogos()` devuelve `string | null`. Se ensancha a `string | null` para que las pantallas no tengan que hacer `?? ` antes.

- [ ] **Step 1: Escribe la prueba**

Crea `apps/tablet/src/ui/momento.spec.ts`:

```ts
import { formatearMomento } from './momento';

/**
 * Las fechas se construyen con componentes LOCALES (`new Date(2026, 9, 10, 11, 2)`)
 * y se pasan como ISO, que es lo que guarda `sincronizado_en`. Asi la prueba da
 * lo mismo con la zona de Tijuana que en UTC o en el CI: lo que se comprueba es
 * que la salida vuelve a la hora local, no una hora concreta.
 */
describe('formatearMomento', () => {
  it('escribe la hora LOCAL del dispositivo, no la UTC del ISO', () => {
    expect(formatearMomento(new Date(2026, 9, 10, 11, 2).toISOString())).toBe(
      '2026-10-10 11:02',
    );
  });

  it('rellena con cero el mes, el dia, la hora y el minuto', () => {
    expect(formatearMomento(new Date(2026, 0, 5, 7, 4).toISOString())).toBe('2026-01-05 07:04');
  });

  it('la medianoche es 00:00 del dia que empieza', () => {
    expect(formatearMomento(new Date(2026, 11, 31, 0, 0).toISOString())).toBe(
      '2026-12-31 00:00',
    );
  });

  it('sin catalogos todavia (null) dice "nunca"', () => {
    expect(formatearMomento(null)).toBe('nunca');
  });

  it('una cadena que no es fecha dice "nunca" y no "NaN-NaN-NaN"', () => {
    expect(formatearMomento('basura')).toBe('nunca');
  });
});
```

- [ ] **Step 2: Corre la prueba y comprueba que falla**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
npm test --workspace=apps/tablet -- src/ui/momento.spec.ts
```

Expected: FAIL con `Cannot find module './momento'`.

- [ ] **Step 3: Escribe el helper**

Crea `apps/tablet/src/ui/momento.ts`:

```ts
/**
 * Un momento ISO-8601 (como `sincronizado_en`) en la forma que lee el
 * vendedor: `AAAA-MM-DD HH:mm`, en la hora **local** de la tablet.
 *
 * Local y no UTC por la misma razon que `relojSistema.hoy()` en
 * `src/datos/reloj.ts`: el vendedor vive en la hora de Tijuana. Antes la
 * pantalla mostraba el ISO crudo, `2026-10-10T18:02:54.922Z`, que ademas de
 * ilegible esta en UTC: eran las 11:02 en la tienda.
 *
 * Sin `Intl` a proposito: con `getHours()` y compania no depende de los datos
 * de zona horaria que traiga el motor JS del equipo, y la prueba en Node es
 * determinista.
 *
 * `null` (todavia no se ha bajado nada) y una cadena que no es fecha dicen
 * `nunca`: pintar `NaN-NaN-NaN` seria peor que no decir nada.
 */
export function formatearMomento(iso: string | null): string {
  if (iso === null) return 'nunca';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'nunca';

  const dos = (n: number) => `${n}`.padStart(2, '0');
  const fecha = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  return `${fecha} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
```

- [ ] **Step 4: Corre la prueba en dos zonas horarias**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
TZ=America/Tijuana npm test --workspace=apps/tablet -- src/ui/momento.spec.ts
TZ=UTC npm test --workspace=apps/tablet -- src/ui/momento.spec.ts
```

Expected: PASS las 5 en las dos corridas (demuestra que la prueba no depende de la zona de la máquina).

- [ ] **Step 5: Úsalo en el menú de la jornada**

En `apps/tablet/app/(jornada)/index.tsx`, agrega el import después de `import { Cifra } from '@/ui/cifra';`:

```tsx
import { Cifra } from '@/ui/cifra';
import { formatearMomento } from '@/ui/momento';
```

y reemplaza (línea 154):

```tsx
          Catálogos bajados: {datos.catalogos.frescuraCatalogos() ?? 'nunca'}
```

por:

```tsx
          Catálogos bajados: {formatearMomento(datos.catalogos.frescuraCatalogos())}
```

- [ ] **Step 6: Úsalo en la lista de clientes**

En `apps/tablet/app/(jornada)/operacion/index.tsx`, agrega el import después de `import { Cifra } from '@/ui/cifra';`:

```tsx
import { Cifra } from '@/ui/cifra';
import { formatearMomento } from '@/ui/momento';
```

y reemplaza (línea 42):

```tsx
          bajados: {datos.catalogos.frescuraCatalogos() ?? 'nunca'}
```

por:

```tsx
          bajados: {formatearMomento(datos.catalogos.frescuraCatalogos())}
```

Comprueba que ya no queda ningún uso crudo:

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
grep -rn "frescuraCatalogos() ??" apps/tablet/app
```

Expected: sin salida.

- [ ] **Step 7: Verificación completa**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
```

Expected: typecheck y lint sin errores; `npm test` en verde con **1 suite y 5 pruebas más** que antes de esta tarea. Las dos pantallas no tienen prueba propia (no hay infraestructura de pruebas de pantalla): su verificación es `typecheck` + `lint`.

- [ ] **Step 8: Commit**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
git add apps/tablet/src/ui/momento.ts apps/tablet/src/ui/momento.spec.ts "apps/tablet/app/(jornada)/index.tsx" "apps/tablet/app/(jornada)/operacion/index.tsx"
git commit -m "$(cat <<'EOF'
Tablet: "Catalogos bajados" en fecha y hora local legibles

Las dos pantallas pintaban el ISO crudo en UTC (18:02Z eran las 11:02 en
Tijuana). formatearMomento devuelve AAAA-MM-DD HH:mm local, sin Intl.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
git status --short   # vacío
```

---

### Task 3: El error del km se borra al corregir y la ayuda de la fecha de pago (D3 + D4)

**Implementador:** `haiku` · **Revisor:** `sonnet`

**Files:**
- Modify: `apps/tablet/src/datos/cobranzas-textos.ts` (función nueva al final)
- Test: `apps/tablet/src/datos/cobranzas-textos.spec.ts` (import + `describe` nuevo al final)
- Modify: `apps/tablet/src/datos/index.ts:86` (re-export)
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx` (import de `@/datos` + línea 463)
- Modify: `apps/tablet/app/abrir-dia.tsx:151`
- Modify: `apps/tablet/app/(jornada)/cerrar-dia.tsx:103`

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces: `export function ayudaRangoFecha(desde: string, hasta: string): string`, re-exportada desde `@/datos`.

**Precisión del plan:**
- `ayudaRangoFecha` va en `src/datos/cobranzas-textos.ts`, que ya agrupa los textos puros de la cobranza (`NOMBRE_METODO`, `lineasDelCobro`) y tiene su `cobranzas-textos.spec.ts` (se recoge: `src/**/*.spec.ts`). `problemasDeCobro` vive en `cobranzas-reglas.ts`, que son reglas, no textos. `cobranza.tsx` importa de `'@/datos'`, así que **hay que** agregarla al re-export de `src/datos/index.ts`.
- **D3 sin prueba de pantalla.** No hay `*.spec.tsx` en el repo ni `@testing-library/react-native` en `apps/tablet/package.json`, y jest solo transforma `.ts`. La verificación de `abrir-dia.tsx` y `cerrar-dia.tsx` es `typecheck` + `lint`; se dice así en el reporte y no se crea infraestructura (D3 lo prevé).
- En *Abrir el día* el mismo `error` también muestra "Selecciona el vehículo…": escribir en el km lo borra también. Es lo que pide D3 ("`onChangeText` del kilometraje hace `setError(null)`") y el error vuelve a salir al pulsar *Abrir el día* si sigue faltando el vehículo.

- [ ] **Step 1: Escribe la prueba de `ayudaRangoFecha`**

En `apps/tablet/src/datos/cobranzas-textos.spec.ts`, reemplaza la línea de import:

```ts
import { lineasDelCobro, NOMBRE_METODO } from './cobranzas-textos';
```

por:

```ts
import { ayudaRangoFecha, lineasDelCobro, NOMBRE_METODO } from './cobranzas-textos';
```

y agrega al final del archivo:

```ts

describe('ayudaRangoFecha (2026-10-10)', () => {
  it('con una nota de hoy dice "Solo hoy", no "Entre X y X"', () => {
    expect(ayudaRangoFecha('2026-10-10', '2026-10-10')).toBe('Solo hoy (2026-10-10).');
  });

  it('con una nota de otro dia da el rango, de la nota a hoy', () => {
    expect(ayudaRangoFecha('2026-10-01', '2026-10-10')).toBe('Entre 2026-10-01 y 2026-10-10.');
  });
});
```

- [ ] **Step 2: Corre la prueba y comprueba que falla**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
npm test --workspace=apps/tablet -- src/datos/cobranzas-textos.spec.ts
```

Expected: FAIL; ts-jest reporta que `cobranzas-textos` no exporta `ayudaRangoFecha` (`has no exported member 'ayudaRangoFecha'`) o, si llega a ejecutar, `ayudaRangoFecha is not a function`.

- [ ] **Step 3: Escribe `ayudaRangoFecha`**

Al final de `apps/tablet/src/datos/cobranzas-textos.ts` agrega:

```ts

/**
 * La ayuda bajo *Fecha de pago* en la cobranza (2026-10-10).
 *
 * `desde` es la fecha de la nota y `hasta` es hoy: la fecha de pago no puede
 * ser anterior a la venta ni futura (eso lo valida `problemasDeCobro`). Con una
 * nota de hoy el rango tiene un solo dia, y "Entre 2026-10-10 y 2026-10-10." se
 * leia como un error de la pantalla; ahi se dice directamente.
 */
export function ayudaRangoFecha(desde: string, hasta: string): string {
  return desde === hasta ? `Solo hoy (${hasta}).` : `Entre ${desde} y ${hasta}.`;
}
```

- [ ] **Step 4: Corre la prueba**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
npm test --workspace=apps/tablet -- src/datos/cobranzas-textos.spec.ts
```

Expected: PASS, todas.

- [ ] **Step 5: Re-expórtala desde `@/datos`**

En `apps/tablet/src/datos/index.ts`, línea 86, reemplaza:

```ts
export { lineasDelCobro, NOMBRE_METODO } from './cobranzas-textos';
```

por:

```ts
export { ayudaRangoFecha, lineasDelCobro, NOMBRE_METODO } from './cobranzas-textos';
```

- [ ] **Step 6: Úsala en la pantalla de cobranza**

En `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx`, en el import de `'@/datos'` (líneas 5-17), reemplaza:

```tsx
import {
  ErrorCobranza,
```

por:

```tsx
import {
  ayudaRangoFecha,
  ErrorCobranza,
```

y en el `<Campo etiqueta="Fecha de pago" …>` (línea 463) reemplaza:

```tsx
              ayuda={`Entre ${nota.fecha} y ${hoy}.`}
```

por:

```tsx
              ayuda={ayudaRangoFecha(nota.fecha, hoy)}
```

- [ ] **Step 7: El error del kilometraje se borra al corregir (Abrir el día)**

En `apps/tablet/app/abrir-dia.tsx`, dentro del `<Campo etiqueta="Kilometraje inicial" …>` (línea 151), reemplaza:

```tsx
          value={km}
          onChangeText={setKm}
          placeholder="Ej. 128450"
```

por:

```tsx
          value={km}
          // El error se borra al corregir: dejar "debe ser un numero..." bajo un
          // valor ya valido se lee como que la tablet no acepto la correccion.
          onChangeText={(texto) => {
            setKm(texto);
            setError(null);
          }}
          placeholder="Ej. 128450"
```

- [ ] **Step 8: Lo mismo en Cerrar el día**

En `apps/tablet/app/(jornada)/cerrar-dia.tsx`, dentro del `<Campo etiqueta="Kilometraje final" …>` (línea 103), reemplaza:

```tsx
        value={km}
        onChangeText={setKm}
        placeholder={`Mayor o igual a ${jornada?.km_inicial ?? 0}`}
```

por:

```tsx
        value={km}
        // Ver la nota gemela en `abrir-dia.tsx`: el error se borra al corregir.
        onChangeText={(texto) => {
          setKm(texto);
          setError(null);
        }}
        placeholder={`Mayor o igual a ${jornada?.km_inicial ?? 0}`}
```

- [ ] **Step 9: Verificación completa**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
grep -rn 'Entre \${nota.fecha}' apps/tablet/app      # sin salida
grep -n "onChangeText={setKm}" apps/tablet/app/abrir-dia.tsx "apps/tablet/app/(jornada)/cerrar-dia.tsx"   # sin salida
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
```

Expected: los dos `grep` sin salida; typecheck y lint sin errores; `npm test` en verde con **2 pruebas más** que antes de esta tarea y el mismo número de suites. Las tres pantallas no tienen prueba propia (no hay infraestructura de pruebas de pantalla): su verificación es `typecheck` + `lint`, y el reporte lo dice explícitamente.

- [ ] **Step 10: Commit**

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-fix-sync"
git add apps/tablet/src/datos/cobranzas-textos.ts apps/tablet/src/datos/cobranzas-textos.spec.ts apps/tablet/src/datos/index.ts "apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx" apps/tablet/app/abrir-dia.tsx "apps/tablet/app/(jornada)/cerrar-dia.tsx"
git commit -m "$(cat <<'EOF'
Tablet: el error del km se borra al corregir y "Solo hoy" en la fecha de pago

En Abrir y Cerrar el dia el error de kilometraje se quedaba en pantalla con
el valor ya corregido. En Cobranza, una nota de hoy decia "Entre X y X";
ayudaRangoFecha dice "Solo hoy (X)." en ese caso.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
git status --short   # vacío
```

---

## Conflictos para el controlador

Ninguno bloquea; ninguna decisión D1…D4 se cambia. Son precisiones que el código obliga y que el plan ya resolvió a favor del spec:

1. **D1 · qué es "un fallo del segundo pull".** El spec dice que si falla, `ok` sigue `true`. El motor tiene una regla escrita: un error que no reconoce se propaga (`motor.ts:372-374`, y el paso 4 hace lo mismo). El plan atrapa con `traducir()`: red, sesión, contrato y alcance → `ok: true` + `pullPosterior: 'fallo'`; un bug (`TypeError`, llave foránea rota al aplicar) se propaga. La prueba (c) del spec usa `SinRedError` y pasa tal cual. Si el controlador quiere que **cualquier** excepción del segundo pull se trague, es quitar `traducir(error);` del `catch` y cambiar la última prueba del bloque.
2. **D1 · campos del resumen que el spec no fija.** Solo dice que `filas` se suma. El plan: `notas` también se suma, `cursor` es el del segundo pull y `completo` el del primero (justificado en la tarea). Ninguna pantalla lee `notas`, `cursor` ni `completo` hoy (`grep` en `app/` y `src/`).
3. **D2 · ubicación y firma.** El spec dice "junto a `cifra.ts`" con firma `formatearMomento(iso: string)`. El archivo real es `cifra.tsx` (importa `react-native` y jest solo transforma `.ts`), así que el helper va en su propio `src/ui/momento.ts`, en la misma carpeta. La firma se ensancha a `string | null` porque el spec pide `null → 'nunca'` y `frescuraCatalogos()` devuelve `string | null`.
4. **D3 · sin prueba de pantalla.** No hay infraestructura (`*.spec.tsx` ni `@testing-library/react-native`); D3 ya prevé este caso: se anota en el reporte y la verificación es `typecheck` + `lint`.
