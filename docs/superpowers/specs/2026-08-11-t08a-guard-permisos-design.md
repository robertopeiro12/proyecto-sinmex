# T-08a · Guard de permisos granulares (primera mitad de T-08)

- **Issue:** [#8](https://github.com/robertopeiro12/proyecto-sinmex/issues/8) — Sprint 3
- **Depende de:** T-06 (auth del portal, hecho) y T-05 (esquema RBAC, hecho)
- **Fecha:** 2026-08-11
- **Producto:** Backend + Portal Web

## Objetivo

Que la API pueda exigir un permiso concreto en un endpoint, y que el portal esconda lo que el
usuario no puede hacer. Deja el mecanismo listo para que los catálogos que vienen (T-10 Productos,
T-11 Vehículos, T-62 Vendedores, T-12 Clientes) nazcan protegidos, en vez de tener que ponerles el
candado a posteriori.

Cierra además la deuda que dejó T-09: hoy **cualquier usuario con sesión puede crear o editar
sucursales**, porque el permiso `sucursal.gestionar` ni siquiera existe en el catálogo sembrado.

Ver `10-Dominio/Entidades/Perfil.md` y `10-Dominio/Entidades/Usuario.md` en el vault.

## Por qué T-08 se parte en dos

T-08 mezcla dos cosas con urgencias distintas:

- **T-08a (este spec):** el mecanismo de permisos — resolutor, decorador, guard, y su aplicación a
  Sucursales. Es lo que bloquea la calidad de todo lo que viene después.
- **T-08b (después, junto con T-13):** la pantalla de perfiles y la matriz de permisos, incluido el
  alta de perfiles nuevos y la edición de excepciones por usuario.

La matriz es la parte más pesada de T-08 y no tiene consumidor hasta que exista la pantalla de
Usuarios (T-13). Construirla ahora sería dejarla meses sin usar; construir el guard ahora evita
retrofit en cuatro catálogos.

> [!warning] Acordar la partición con Mario
> T-08 lo escribió Mario (`brg8607`). Partir el issue debe hablarse con él antes de cerrar T-08a,
> para que los criterios de aceptación que quedan pendientes migren explícitamente a T-08b y no se
> pierdan al marcar el issue.

## Alcance

### Dentro

1. Sembrar el permiso `sucursal.gestionar` (grupo **General**).
2. Resolutor de permisos efectivos de un usuario (perfil + excepciones).
3. Decorador `@RequierePermiso(...)` y `PermisosGuard` global.
4. Aplicarlo al `POST` y al `PATCH` de `/sucursales`.
5. `GET /auth/me` devuelve `permisos: string[]`.
6. El portal esconde las acciones de alta/edición de Sucursales a quien no tenga el permiso.

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| Pantalla de perfiles y matriz de permisos | Es T-08b, pegada a T-13 (Usuarios). Sin esa pantalla la matriz no tiene consumidor. |
| Sembrar qué permisos lleva cada uno de los 6 perfiles | **El cliente nunca lo dijo.** Las fuentes listan los 6 perfiles y los 22 permisos, pero ninguna matriz que los cruce. Inventarla viola la regla "no inventes" del vault, y el cliente la va a configurar él mismo en T-08b. |
| Aplicar permisos a los demás catálogos | No existen todavía. Cada catálogo aplica el suyo (`producto.gestionar`, etc.) en su propio ticket; T-08a hace que sea una línea por endpoint. |
| Permisos para la app de tablet | El Vendedor es otra entidad, sin perfil ni permisos. Su autorización es `@SoloApp()` y se queda como está. |
| Pruebas automatizadas del portal | El portal sigue sin infraestructura de pruebas (igual que en T-09). Montarla es un ticket propio. |
| Caché del set de permisos | Optimización sin problema que resolver: son usuarios de oficina, no tráfico masivo. |

## Decisiones

### D1 — El "Administrador General manda siempre" vive en el resolutor, no en el guard

El perfil `Administrador General` (el "usuario maestro" del vault) obtiene **el catálogo completo de
permisos**, y esa regla se aplica dentro de la función que resuelve permisos — no dentro del guard.

Importa porque hay **dos** consumidores de esa respuesta: el guard, que decide si deja pasar la
petición, y `/auth/me`, que le dice al portal qué botones pintar. Si la excepción viviera en el
guard, `/auth/me` tendría que repetirla, y esas dos copias se separan tarde o temprano: el backend
te deja hacer algo que la interfaz te esconde, o al revés. Con la regla adentro del resolutor, la
inconsistencia es imposible por construcción.

**Alternativa descartada:** sembrar los 22 permisos al perfil Administrador General en una
migración, sin excepción en código. Es dato en vez de código, que suele ser preferible, pero crea
una trampa de mantenimiento: cada permiso nuevo (y van a ser muchos, uno o dos por catálogo) hay
que acordarse de sembrárselo también a ese perfil, o el administrador pierde acceso en silencio.

### D2 — Los permisos se resuelven contra la base en cada petición

El JWT sigue llevando solo `sub` y `tipo`. El guard consulta la base cada vez.

**Alternativa descartada:** calcular el set al hacer login y meterlo como claim del token. Ahorra
una consulta, pero un cambio de permisos tarda hasta 15 minutos en surtir efecto (lo que dura el
access token) — y ese rezago aparece justo en el escenario en que uno quita un permiso *porque hay
un problema en curso*. El costo evitado es una consulta indexada por petición, con un puñado de
usuarios de oficina.

### D3 — La excepción por usuario gana sobre el perfil, en los dos sentidos

`usuario_permiso.habilitado = true` concede un permiso que el perfil no da; `= false` quita uno que
el perfil sí da. Ambos casos ganan sobre `perfil_permiso`.

El esquema de T-05 ya está hecho para esto (`habilitado boolean not null`), y el vault documenta el
caso de negocio: *"a un usuario puntual se le puede agregar un permiso extra por excepción"*.
Soportar solo el sentido "conceder" dejaría a medias una tabla que ya existe completa.

Filas con `deleted_at` no nulo se ignoran en las tres tablas (`perfil_permiso`, `usuario_permiso`,
`permiso`), por la convención de baja lógica de T-05.

### D4 — `sucursal.gestionar` aplica a crear y editar, no a listar

`POST /sucursales` y `PATCH /sucursales/:id` exigen el permiso. `GET /sucursales` se queda solo
detrás de sesión válida.

El selector "Por sucursal" de T-09 vive en la barra lateral, o sea en **todas** las páginas del
portal, y se pinta llamando a `GET /sucursales`. Ponerle el permiso al GET rompería el filtro global
para todo el que no administre sucursales — que son casi todos los usuarios. El permiso se llama
`gestionar`, no `ver`, y la lista de sucursales no es información sensible.

Además el GET ya está acotado por otro lado: `alcance-sucursal.ts` (T-09) hace que un usuario atado
a una sucursal reciba solo la suya. No queda abierto de par en par.

**Alternativa descartada:** sembrar un `sucursal.ver` aparte. Es un permiso que el cliente no pidió
y que habría que concederle a todo el mundo para que el portal funcione. Un candado que siempre
está abierto no es un candado.

### D5 — Falta de permiso responde 403, no 401

El usuario está identificado; simplemente no le toca. Mezclarlo con el 401 haría que el portal
intentara refrescar la sesión y mandara al login a alguien que sí tiene sesión válida.

### D6 — `@SoloApp()` + `@RequierePermiso()` es un error de programación, y truena

Un Vendedor no tiene perfil ni permisos: esa combinación solo puede ser una equivocación
nuestra. El guard lanza un error explícito en vez de negar el acceso en silencio, que dejaría un
endpoint de la tablet colgado de un permiso que nunca se cumple.

## Diseño

### Backend

**`permisos.repository.ts`** — `permisosDe(usuarioId): Promise<Set<string>>`

1. Lee el usuario con el nombre de su perfil.
2. Si el perfil es `Administrador General` → devuelve todas las `permiso.clave` vigentes (D1).
3. Si no: `perfil_permiso` del perfil, más las excepciones con `habilitado = true`, menos las que
   tengan `habilitado = false` (D3).
4. Ignora filas con `deleted_at` no nulo.

**`requiere-permiso.decorator.ts`** — `@RequierePermiso('sucursal.gestionar')`, mismo molde que los
`@Publico()` y `@SoloApp()` existentes, para que se lea igual que el resto del código.

**`permisos.guard.ts`** — guard global, registrado **después** de `JwtAuthGuard` (necesita el
`req.usuarioId` que aquel deja puesto):

| Situación | Resultado |
|---|---|
| Endpoint sin `@RequierePermiso` | Pasa. Todo lo que hoy solo exige login sigue igual. |
| Tiene el permiso | Pasa. |
| No lo tiene | `403 Forbidden`. |
| `@SoloApp()` + `@RequierePermiso` | Error explícito (D6). |

**Migración** — siembra `sucursal.gestionar` en el grupo `General`, descripción
"Administrar el catálogo de sucursales".

**`GET /auth/me`** — agrega `permisos: string[]`, del mismo resolutor (D1).

### Portal

- `auth-provider.tsx` guarda los `permisos` que llegan de `/auth/me` y expone `puede(clave)`.
- `pantalla-sucursales.tsx` esconde el botón "Nueva sucursal" y el de editar según `puede`.

Para el Administrador General el resolutor devuelve el catálogo completo, así que el portal no
necesita ningún caso especial — es la ganancia directa de D1.

## Pruebas

**Del resolutor** (unitarias) — es donde está la lógica sutil:

- perfil sin excepciones
- excepción que **concede** un permiso que el perfil no da
- excepción que **niega** uno que el perfil sí da (la excepción gana)
- `Administrador General` devuelve el catálogo completo
- filas con `deleted_at` se ignoran

**Del guard** (unitarias): sin decorador pasa · con permiso pasa · sin permiso 403 ·
`@SoloApp()` + `@RequierePermiso` truena.

**End-to-end** (Postgres real):

- `POST /sucursales` sin el permiso → 403
- `POST /sucursales` con el permiso → 201
- **`GET /sucursales` → 200 aun sin el permiso**

La última prueba es la que defiende D4: si alguien le pone el candado al GET por descuido, se cae
antes de que se rompa el filtro global de toda la barra lateral.

## Riesgos y verificación al cerrar

| Riesgo | Mitigación |
|---|---|
| Quedarse fuera del propio portal | El bypass del Administrador General (D1) lo hace imposible mientras el usuario tenga ese perfil. **Verificar con una consulta** el perfil del usuario de Roberto en `sinmex dev` antes de dar por cerrado el ticket, no de memoria. |
| La migración no llega a `sinmex dev` | Aplicarla con `supabase db push` y confirmar con `supabase migration list` — el vault deja anotado que esa es la única fuente confiable del estado remoto. |
| Endpoints existentes que se rompan | El guard deja pasar todo lo que no declare permiso; el único cambio de comportamiento es en `POST`/`PATCH` de sucursales. |

Al cerrar: lint + build + test + test:e2e, actualizar `Estado del proyecto.md` y `Perfil.md` en el
vault (el aviso de `sucursal.gestionar` pendiente deja de aplicar), y anotar la partición T-08a /
T-08b en el issue #8.
