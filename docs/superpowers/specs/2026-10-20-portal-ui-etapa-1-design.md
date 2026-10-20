# Portal · UI parejo y fácil de usar, Etapa 1 — Diseño

**Fecha:** 2026-10-20 · **Estado:** aprobado en conversación por Roberto
**Base:** auditoría de las 39 rutas del portal (2026-10-20). Sin ticket de GitHub: es trabajo de Roberto (Portal) mientras el
cliente contesta las preguntas de T-23/T-24/T-25.

## 1. Para qué

Que el portal se sienta **un solo sistema, sencillo de usar y siempre profesional**. Palabras de Roberto:

- *"Que se vea parejo."*
- *"Que se sepa en qué sucursal está para que no se confundan."*
- *"Que sea sencilla de usar la aplicación web, que el flujo que siga el usuario sea intuitivo."*
- *"Admin Local / Administrador General · General: lo que me genera estrés, y también el botón de salir y donde se escoge
  la sucursal."*
- *"Sencilla de usar pero siempre profesional."*
- *"Sidebar independiente al contenido, para no hacer scroll abajo y arriba. Sidebar desplegable."*

**Qué no cambia:** ninguna regla de negocio, ningún endpoint, el backend ni la app. Las pruebas de pantalla que existen deben
seguir pasando (solo se ajustan donde cambie un texto o un rol a propósito).

## 2. Decisiones (Roberto, 2026-10-20)

| Tema | Decisión |
|---|---|
| Objetivo | Parejo + fácil de usar, conservando el estilo actual (blanco y negro, limpio). |
| Color | Solo donde informa algo: verde = éxito o pagado, ámbar = aviso o pendiente, rojo = error, vencido o eliminar. **Más un color por sucursal** (§2.1), la única parte llamativa. Roberto dio luz verde el 2026-10-20 para ajustar el diseño siguiendo la guía de diseño. |
| Enfoque | **Por etapas**, PRs chicos. Esta es la Etapa 1. |
| Menú lateral | Fijo, con su propio desplazamiento; secciones que se abren y cierran; botón ☰ que lo esconde completo. |
| Sucursal y usuario | **Todo en el menú lateral**: la sucursal en grande arriba, el usuario abajo con "Cerrar sesión" en un menú. Se quita la barra de arriba. |
| Opción de todas | Se llama **"Todas las sucursales"**. |
| Pantallas de Mario | Recarga y Gastos **no se tocan** en esta etapa; nota en el PR. |

## 2.1 Identidad visual

Maqueta aprobada como referencia: https://claude.ai/artifact/PTs75Sx63RnyF5t8PwybbR (Ventas a 1366 px; botones para
cambiar de sucursal, abrir la lista, la ventana de confirmar y el menú escondido).

- **Una sola cosa llamativa: el color de la sucursal.** Llena el bloque de sucursal del menú, la pastilla del menú
  escondido, la marca de la opción activa y una línea de 3 px arriba del contenido. Sirve para saber dónde estás sin leer.
  - Tijuana `TJ` → azul pacífico `#1d5b79`; Mexicali `MX` → morado jamaica `#6b2d5c`; Todas las sucursales → tinta `#18211d`.
  - Una sucursal sin color asignado (por ejemplo Ensenada el próximo año) usa la tinta hasta que se le asigne uno. El mapa
    vive en un solo archivo (`lib/sucursal-color.ts`).
- **Base tranquila:** contenido en blanco; menú en gris muy claro con un toque verde (`#f2f4f1`); líneas `#dde2dd`; texto
  secundario `#5f6b65`; botón principal en tinta `#18211d`.
- **Colores que informan:** éxito `#1f7a4d` sobre `#e6f3ec`; aviso `#8a4f06` sobre `#fdf3e1`; error `#b42318` sobre
  `#fdecea`; información `#3d5566` sobre `#eaf0f4`. Con su versión oscura, como la maqueta.
- **Letra:** **Public Sans** para todo el texto (legible, números de ancho fijo para columnas de montos) y **Bricolage
  Grotesque** solo para el título de la pantalla y el nombre de la sucursal. Se cargan con `next/font/google` y reemplazan a
  Geist; la mono se queda solo donde ya se usa.
- **Lo que se evita a propósito:** etiquetas en mayúsculas, sombras en todas las cajas, degradados de adorno. Sombra solo en
  lo que flota (lista de sucursales, ventana de confirmar). Bordes redondeados por jerarquía: 10 px cajas, 7 px botones y
  campos, pastillas redondas.
- **Movimiento:** solo cuando el usuario actúa (abrir una sección, la ventana de confirmar); respeta
  `prefers-reduced-motion`.

## 3. Menú lateral (el marco de todas las pantallas)

### 3.1 Estructura

```
┌──────────────────────┐
│ JAWA             ☰   │  marca + botón para esconder el menú
│ ┌──────────────────┐ │
│ │ Sucursal         │ │  bloque de sucursal (§3.2)
│ │ Tijuana        ▾ │ │
│ └──────────────────┘ │
│ ▾ Operación          │  secciones que se abren y cierran (§3.3)
│     Ventas           │
│     Cobranza         │
│ ▸ Finanzas           │
│   …                  │  ← solo esta parte se desplaza si no cabe
│ ──────────────────── │
│ (AL) Admin Local   ▴ │  usuario (§3.4)
└──────────────────────┘
```

- El menú ocupa **el alto de la ventana** (`h-dvh`, `sticky top-0`). La lista de secciones tiene su propio desplazamiento.
  Al bajar por una tabla larga, el menú no se mueve.
- El contenido (`main`) lleva `min-w-0`, así una tabla ancha se desplaza dentro de su caja y no empuja la página. Con esto
  sobra el truco `w-0 min-w-full` que tienen hoy 4 tablas: se quita donde se toque.
- La barra de arriba (`BarraUsuario`) **desaparece**. El contenido empieza directo con el encabezado de la pantalla (§4.1).

### 3.2 Sucursal

- Bloque en el color de la sucursal, con la etiqueta pequeña "Sucursal" y el nombre en grande: **Tijuana**, **Mexicali** o **Todas las sucursales**.
- **Usuario que puede elegir** (General): el bloque es un botón que abre la lista (`Menu` de base-ui) con "Todas las
  sucursales" y cada sucursal activa; la elegida lleva palomita. Funciona igual que hoy por dentro (`?sucursal=` en la URL,
  sin parámetro = todas).
- **Usuario atado a una sucursal:** el mismo bloque, sin flecha y sin lista: solo dice su sucursal.
- La pestaña del navegador dice **"Ventas | JAWA Tijuana"** (o "Ventas | JAWA" con todas), para distinguir pestañas abiertas.

### 3.3 Secciones que se abren y cierran

- Cada sección (Operación, Finanzas, Producción, Información, Catálogo) es un `Collapsible` con flecha ▾/▸.
- La sección de la pantalla actual **siempre se abre sola** al entrar.
- Lo que el usuario abre o cierra se recuerda en esa computadora (`localStorage`, con `try/catch`; sin él, todo funciona y
  arranca con solo la sección actual abierta).
- La opción activa se marca con fondo y negritas (como hoy) y `aria-current="page"`.
- Las pantallas que todavía no existen (las 12 "Próximamente") se quedan en el menú pero con una etiqueta gris **"Pronto"**,
  para que nadie entre esperando algo. Ruling del diseño: quitarlas escondería lo que viene; marcarlas evita la sorpresa.

### 3.4 Usuario

- Abajo del menú: un círculo con las **iniciales**, el **nombre** y, en gris, el **perfil** (por ejemplo "Administrador
  General"). **No** se muestra el código "General" ni el de sucursal: la sucursal ya está arriba.
- Al picarle se abre un menú pequeño con **Cerrar sesión**. Salir deja de estar a la vista todo el tiempo.

### 3.5 Menú escondido (☰)

- El botón ☰ esconde el menú completo y deja una **franja delgada** (unos 60 px) con: el botón ☰ para volver a abrirlo, las
  siglas de la sucursal en una pastilla de su color (**TJ**, **MX** o **Todas**) y las iniciales del usuario. Así, aun escondido, se
  sabe en qué sucursal se está.
- El estado (abierto/escondido) se recuerda en esa computadora (`localStorage`, con `try/catch`).

## 4. Piezas comunes (`apps/portal/src/components/ui/`)

Todas con pruebas (Vitest + Testing Library). Se construyen sobre base-ui (`@base-ui/react` 1.6, ya instalado: `Dialog`,
`AlertDialog`, `Tabs`, `Menu`, `Collapsible`) y los colores del tema (`globals.css`).

### 4.1 Encabezado y estados de pantalla

- **`EncabezadoPantalla`**: título de la pantalla (`h1`, más grande que hoy), **una línea que explica qué es** y un espacio
  para el botón principal a la derecha. Ejemplo: *Ventas* — "Busca una venta por fecha o folio para verla, editarla o
  eliminarla." Esa línea es la principal ayuda de "intuitivo": cada pantalla dice para qué sirve.
- **`EstadoPantalla`**: un solo componente para *Cargando…*, *No tienes permiso para ver esta sección.* y *Elige una
  sucursal…*. Mismo texto, tamaño y lugar en todas. Reemplaza las 4 variantes y las 3 copias de `TarjetaMensaje`.

### 4.2 Tabla

`Tabla`, `Th`, `Td`, `TdMonto` (a la derecha, `tabular-nums`, sin cortar), `FilaVacia`, `FilaTotal`, `FilaGrupo` y
`CajaTabla` (desplazamiento propio y encabezado fijo). Base: el estilo de Reporte de Ventas y Tesorería (encabezados en gris,
filas separadas por línea), con densidad `normal` y `compacta`. Las filas tienen un tono suave al pasar el mouse cuando se
pueden picar.

### 4.3 Filtro de fechas

`FiltroFechas`: Desde, Hasta y los atajos **Hoy · Ayer · Esta semana · Este mes**, con la validación "La fecha inicial no
puede ser posterior a la final." El botón se llama siempre **Mostrar**. El de Excel es `BotonExcel` ("Exportar a Excel",
con su estado "Exportando…"). Los cálculos de rangos (`rangoSemana`, `rangoMes`, `diaAnterior`, `primerDiaDelMes`) se juntan
en `lib/fechas.ts`; los lugares que los importaban de otro archivo pasan a importarlos de ahí.

### 4.4 Confirmar

`Confirmar` (base-ui `AlertDialog`): título ("¿Eliminar la venta TJ261006AP05?"), una línea de qué pasa ("No se puede
deshacer."), botón rojo con el verbo exacto (**Eliminar**, **Marcar como perdida**) y **Cancelar**. Reemplaza a
`window.confirm` en las pantallas de esta etapa. Un hook `useConfirmar()` devuelve una promesa, así cada cambio en la pantalla
es de una línea.

### 4.5 Aviso, etiqueta, monto y fecha

- **`Aviso`** con cuatro tonos: `error` (`role="alert"`), `exito`, `advertencia` e `informacion` (`role="status"`). Colores
  nuevos en `globals.css`: `--success` y `--warning` (con su versión oscura, como los que ya hay).
- **`Etiqueta`** (pastilla) y **`EtiquetaStatusVenta`**: Pagada (verde), Pendiente (ámbar), Abonado (gris azulado), Promoción
  (gris), Cuenta perdida (rojo). Los textos salen de `ETIQUETA_STATUS` (`lib/ventas.ts`), que no cambia.
- **`Monto`** (usa `formatearPesos`; negativos en rojo) y **`Fecha`** (`dd/mm/aaaa`, y `dd/mm/aaaa hh:mm` con hora). Se
  juntan en `lib/formato.ts` `formatearPesos`, `formatearFecha`, `formatearFechaHora` y `plural`; los archivos de origen
  re-exportan para no romper importaciones.

### 4.6 Campos de formulario y pestañas

- **`Campo`** (etiqueta + control + ayuda + error, con `aria-invalid` y `aria-describedby`), **`Entrada`**, **`Lista`**
  (select nativo), **`AreaTexto`** y **`Casilla`**: mismo tamaño, borde visible al escribir, aspecto de deshabilitado y
  marca de opcional "(opcional)" cuando aplica.
- **`Pestanas`** (base-ui `Tabs`): reemplaza las pestañas hechas a mano de Facturas y los botones de Peticiones.

## 5. Pantallas de esta etapa

Además del menú (que cambia todas), se pasan a las piezas nuevas las 5 más disparejas. En cada una se revisa también el flujo:
qué ve el usuario al entrar, qué hace después y que el botón principal esté donde se espera.

| Pantalla | Cambios |
|---|---|
| **Ventas** (lista, detalle, editar) | encabezado con explicación; fechas `dd/mm/aaaa`; `EtiquetaStatusVenta`; precios a la derecha; `Confirmar` para Eliminar y Marcar como perdida; botón Buscar → Mostrar |
| **Cobranza** (buscar, cobrar al cliente) | tablas comunes con montos alineados; fechas; `Aviso` para éxito y error; `Confirmar` |
| **Facturas** (asignar, buscar) | `Pestanas`; tablas y fechas; "sin permiso" con `EstadoPantalla`; `Confirmar` |
| **Peticiones** | `Pestanas` en lugar de botones; fecha y hora legibles; `Aviso`; `Confirmar` |
| **Kilometraje** | `FiltroFechas` con atajos; tabla con espacio entre columnas y montos alineados; botón Consultar → Mostrar |

**Queda para después** (un PR por etapa): catálogos, Tesorería, Reporte de Ventas, Clientes nuevos, Flujo, Cuentas por
Cobrar, Registrar venta, Perfiles, Precios, Promociones, Ruta diaria y las demás llamadas a `window.confirm`. Recarga y Gastos
(de Mario) cuando él lo decida.

## 6. Pruebas y revisión

- Pruebas de cada pieza: roles y textos, atajos de fechas (incluido el cruce de mes y de semana), `Confirmar` acepta y
  cancela, `Etiqueta` por status, `Monto` negativo, `Fecha` con y sin hora, menú recuerda y falla sin `localStorage`.
- Las pruebas de las 5 pantallas siguen pasando; donde cambió el texto a propósito (Buscar → Mostrar, `window.confirm` →
  `Confirmar`) se ajustan en el mismo commit.
- `npm test --workspace=apps/portal`, `tsc --noEmit` y el lint del portal limpios.
- Navegador a **1366 y 1920 px**, menú abierto y escondido, usuario General y usuario atado a una sucursal: sin
  desplazamiento horizontal de la página; el menú no se mueve al bajar.

## 7. Fuera de alcance

Color de marca, modo oscuro completo, diseño para celular, cambiar textos de negocio o reglas, pantallas nuevas.
