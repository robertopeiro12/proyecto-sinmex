# Portal · UI parejo, Etapa 2 (Catálogos) — Diseño

**Fecha:** 2026-10-21 · **Estado:** aprobado en conversación por Roberto
**Base:** [Etapa 1](2026-10-20-portal-ui-etapa-1-design.md) (PR #144): marco, piezas comunes de `components/ui/` e
identidad visual. Sin ticket de GitHub, como la Etapa 1.

## 1. Para qué y alcance

Pasar los **10 catálogos** a las piezas comunes, para que se vean y se usen igual que Ventas, Cobranza y el resto de la
Etapa 1. Roberto partió lo que faltaba en tres PRs (2026-10-21):

| Etapa | Pantallas |
|---|---|
| **2 (esta)** | Productos, Vehículos, Sucursales, Vendedores, Campos de egreso, Motivos de visita, Clientes, Usuarios, Perfiles y Permisos, Listas de Precios, más sus 6 `window.confirm` |
| 3 | Tesorería, Flujo de Efectivo, Cuentas por Cobrar, Reporte de Ventas, Clientes nuevos (y los 3 `window.confirm` de Tesorería) |
| 4 | Registrar venta, Promociones, Ruta diaria (y los 2 `window.confirm` de Ruta diaria) |

Recarga y Gastos son de Mario y no se tocan (el `window.confirm` de Recarga se queda).

**Qué no cambia:** ninguna regla de negocio, ningún endpoint, el backend ni la app. Ningún texto de negocio de los
formularios (etiquetas, validaciones, mensajes del servidor).

## 2. Decisiones (Roberto, 2026-10-21)

| Tema | Decisión |
|---|---|
| Partición | 3 PRs; esta es la de Catálogos. |
| Formulario de alta/edición en catálogos | **Ventana encima** (base-ui `Dialog`), la tabla queda atrás oscurecida. Hoy sale arriba de la tabla y la recorre. |
| Formularios largos (Clientes, Usuarios) | **Pantalla completa, como editar una venta**: la lista se cambia por el formulario, con "← Volver a …". |
| Regla para pantallas futuras | Formulario corto → ventana. Formulario de varios bloques → pantalla completa. |

## 3. Pieza nueva: `Ventana` (`components/ui/ventana.tsx`)

Sobre base-ui `Dialog` (1.6, ya instalado), con el aspecto de `Confirmar` (10 px de radio, sombra solo aquí por flotar,
fondo oscurecido, movimiento que respeta `prefers-reduced-motion`).

- Props: `abierta`, `alCerrar`, `titulo` (el `h2` de la ventana, p. ej. "Editar producto"), `children`, y ancho
  `normal` (unos 32 rem) o `ancho` (unos 44 rem).
- El foco entra al primer campo; **Esc** y el clic fuera llaman a `alCerrar`; el foco regresa al botón que la abrió.
- El contenido se desplaza **dentro** de la ventana si no cabe a lo alto (máximo `90dvh`), nunca la página.
- Mientras se guarda, el formulario sigue mandando: `Ventana` no sabe de guardar. Un formulario que está guardando
  deshabilita sus botones; cerrar con Esc a media petición solo cierra (la respuesta que llegue después ya no pinta nada,
  porque el formulario se desmontó).

Con pruebas: abre con el título, Esc y "Cancelar" cierran, el foco entra y regresa.

## 4. La pantalla de catálogo compartida (`components/catalogo/`)

`PantallaCatalogo` se rehace con las piezas comunes y la usan **Productos, Vehículos, Sucursales, Vendedores, Campos de
egreso y Motivos de visita** (hoy los dos últimos tienen pantalla propia solo por "Dar de baja").

- **`EncabezadoPantalla`** con `titulo`, una prop nueva **`descripcion`** (la línea de para qué sirve, §4.1) y el botón
  de alta a la derecha. Se quitan `Card`/`CardHeader`.
- **Tabla común**: `TablaCatalogo` pasa a construirse con `Tabla`/`Th`/`Td`/`FilaVacia` dentro de `CajaTabla`. Su API
  (`columnas`, `vacio`, `acciones`) no cambia.
- **Estados**: "Cargando…" con `EstadoPantalla`; el error de carga con `Aviso tono="error"`.
- **Alta y edición en `Ventana`**. El título es el mismo texto que hoy pone el `h2` de cada formulario ("Nuevo
  producto" / "Editar Jamaica", "Editar TJ" en Sucursales), que pasa a la pantalla con una prop nueva
  `tituloFormulario: (item: T | null) => string`. Se conserva el `key` por item que ya documenta el archivo (T-09).
- **Modo de formulario**: prop `formularioEn: "ventana" | "pantalla"`, `"ventana"` por omisión. **Promociones** (que
  también usa esta pantalla y es de la Etapa 4) pasa `"pantalla"`: su formulario es largo (515 líneas) y así no cambia de
  forma hasta su etapa; recibe el encabezado y la tabla comunes de rebote, nada más.
- **Dar de baja opcional**: prop `baja?: { etiqueta?: string; confirmar: (item) => OpcionesConfirmar; ejecutar: (item) =>
  Promise<void>; mostrar?: (item) => boolean }`. Pinta un botón junto a "Editar" (texto `etiqueta`, por omisión "Dar de baja"; Campos de egreso y Motivos de visita
  conservan su "Eliminar" de hoy), pregunta con
  `useConfirmar()` (botón rojo) y, si `ejecutar` falla, muestra el mensaje del servidor en un `Aviso` arriba de la tabla
  (así sigue saliendo el 409 de Campos de egreso, "podrás darlo de baja el próximo año"). Si funciona, recarga.
- Los formularios internos (los 6) pasan a `Campo` + `Entrada`/`Lista`/`AreaTexto`/`Casilla`, con "(opcional)" donde el
  campo lo es. Los botones Guardar/Cancelar van abajo a la derecha de la ventana. Sus `h2` propios se quitan (el título
  ya lo pone la ventana).

### 4.1 Líneas de descripción

Revisables por Roberto en el PR. Ninguna inventa reglas: describen lo que la pantalla ya hace.

| Pantalla | Descripción |
|---|---|
| Productos | Los sabores y sus presentaciones que se venden. |
| Vehículos | Las camionetas de cada sucursal, con sus placas y kilometraje. |
| Sucursales | Las sucursales de la empresa y su control de inventario en la app. |
| Vendedores | Quién usa la app de la tablet, en qué sucursal y con qué contraseña. |
| Campos de egreso | Los conceptos de gasto, de qué tipo son y si salen en la app. |
| Motivos de visita | Por qué un cliente no compró; lo elige el vendedor en la app. |
| Clientes | Los clientes y prospectos de la sucursal: datos, ubicación, precios y promociones. |
| Usuarios | Quién entra al portal, con qué perfil y en qué sucursal. |
| Perfiles y Permisos | Qué puede hacer cada perfil en el portal. |
| Listas de Precios | El precio de cada presentación en cada lista de la sucursal. |

## 5. Formularios largos: Clientes y Usuarios

Ninguno usa `PantallaCatalogo` (Clientes carga el detalle completo al editar, D3 de T-12) y se quedan así; lo que cambia es
cómo se ven.

- **Lista**: `EncabezadoPantalla` (con su descripción) + tabla común + estados comunes. En Clientes, el filtro
  Clientes/Prospectos va en la fila del encabezado, junto al botón "Nuevo cliente".
- **Al picar Nuevo/Editar, la lista se cambia por el formulario a todo lo ancho**, como `pantalla-ventas.tsx` con
  `FormularioEditarVenta`: arriba un enlace-botón "← Volver a clientes" / "← Volver a usuarios" y el encabezado con el
  título ("Editar cliente: Abarrotes Lupita"). Guardar regresa a la lista y la recarga; Cancelar y "← Volver" regresan sin
  cambios.
- Sus bloques (`fieldset` con `legend`) se quedan como secciones del formulario, con los campos comunes.
- **Confirmar** en lugar de `window.confirm`: Clientes "Dar de baja" (*"Se conserva su historial."*) y "Convertir en
  cliente" (*"No se puede deshacer."*); Usuarios "Dar de baja". Los textos de hoy se reparten en título y línea.

## 6. Rejillas: Perfiles y Permisos, Listas de Precios

Son matrices que se editan en su lugar; su manera de funcionar no cambia.

- Encabezado común con descripción y estados comunes (ya usan `EstadoPantalla`; se quita la `Card` que envuelve).
- La matriz se queda como tabla propia (sus celdas son controles), pero dentro de `CajaTabla` para que una rejilla ancha
  se desplace en su caja y no empuje la página.
- Perfiles: "Dar de baja el perfil" con `useConfirmar()` (botón rojo).
- Revisión a 1366 px con todos los perfiles / todas las listas.

## 7. Pruebas y revisión

- Las pruebas de pantalla existentes siguen pasando. Donde cambia algo a propósito se ajustan en el mismo commit: el
  formulario ahora vive en un `dialog` (las consultas por `heading` "Nueva sucursal" pasan a buscar dentro de la ventana),
  y `window.confirm` → `Confirmar` (se pica el botón de la ventana en lugar de simular `window.confirm`).
- Pruebas nuevas: `Ventana` (§3); `PantallaCatalogo` en modo ventana y pantalla, con y sin permiso, con baja que funciona
  y baja rechazada (el `Aviso` muestra el mensaje); Clientes y Usuarios regresan a la lista con "← Volver".
- `npm test --workspace=apps/portal`, `tsc --noEmit` y el lint del portal limpios.
- Navegador a **1366 y 1920 px**, con usuario General y con usuario atado a una sucursal: cada catálogo abre, edita y
  cancela; sin desplazamiento horizontal de la página. Antes de depurar algo raro, reiniciar el servidor con `.next`
  limpio (trampa de la Etapa 1).
- Al terminar: CLAUDE.md (bloque "Portal UI") con `Ventana` y la regla de §2, y nota en el vault ([[Portal Web]]).

## 8. Fuera de alcance

Buscador o filtros nuevos en catálogos, cambiar campos o validaciones, la página índice de Catálogo (sigue "Pronto"),
Promociones más allá de lo que recibe de rebote, y todo lo de las Etapas 3 y 4.
