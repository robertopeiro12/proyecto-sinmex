# Corte de mercancía por tamaño, con merma teórica — diseño

Fecha: 2026-11-18 · Rama: `feature/corte-por-tamano` · Solo portal + backend (Roberto). La tablet no cambia.

Fuentes (vault, `90-Fuentes/`):
- **Módulo de Producción e Inventarios 2026-11-16 (fuente)**, secciones "Submódulo: Corte", "INVENTARIO" y "MERMA".
- **Respuestas del cliente 2026-11-18 Inventarios y Producción (fuente)**, preguntas 1, 5 y 6.

Parte de: spec anterior `2026-11-12-corte-de-mercancia-design.md` (D1–D13). Lo que aquí no se menciona sigue igual.

## Para qué

Es el primer paso del módulo de Producción e Inventarios del cliente. El almacenista hace el corte en la tarde, con el
vendedor enfrente y la hoja de papel firmada. Necesita ver **por tamaño** (355 ml, 500 ml, 600 ml…) cuántas piezas
buenas y cuánta merma **debería** traer el vendedor, anotar lo que contó y ver el **resultado**: positivo = falta y se
le descuenta al vendedor; negativo = error humano de conteo, sin restricción.

Hoy el corte ya existe (Producción → Corte, `#157`), pero: está en una sola lista sin separar por tamaño, la cuenta no
resta la merma ni el consumo que ya registra la tablet (`#150`), y la merma solo se anota, no se compara contra nada.

## Lo que dice el cliente (no se cambia sin preguntarle)

- **C1. Por tamaño.** Una sección por tamaño; en cada una, un renglón por producto y un renglón de **Total** del tamaño.
- **C2. Dos bloques por renglón.**
  - *Producto terminado*: **Piezas teóricas por regresar · Piezas reales retornadas · Resultado**.
  - *Merma*: **Merma teórica por regresar · Merma real validada · Resultado**.
- **C3. Piezas teóricas por regresar** = cargadas − ventas − promoción − merma entregada al cliente − merma de almacén
  − consumo − cambios físicos entregados + cambios físicos recibidos.
  ("Merma registrada en sistema" = piezas buenas entregadas al cliente + merma de almacén; las dos salen de lo bueno.)
- **C4. Merma teórica por regresar** = merma recibida del cliente + merma de almacén.
- **C5. Resultado** = teórica − real, en los dos bloques. **Positivo** = falta → rojo, se le descuenta. **Negativo** =
  error humano → se muestra, **no se bloquea** nada.
- **C6. Dentro de un tamaño, lo que sobra de un sabor tapa lo que falta de otro**: en el ejemplo de 355 ml (Horchata −1,
  Jamaica +1) el total es 0 y "es correcto". Lo mismo en la merma (Jamaica +1, Tamarindo −1 = 0).
- **C7. Ventas** = todas las ventas vivas del vendedor ese día: las de la app **y** las que la oficina captura a su
  nombre cuando la app falló todo el día (respuesta 1). Las de mostrador ("Oficina", sin vendedor) no cuentan. Es lo
  que ya cuenta hoy.
- **C8.** El almacenista llena las piezas reales y la merma validada; se puede guardar y editar (ya existe).
- **C9.** Un faltante **no** se registra solo como descuento: Administración lo registrará a mano en Procesos →
  Descuentos (respuesta 6, pieza futura). Este corte solo muestra el número.

## Mapeo a los datos que ya existen (sin migración)

| Concepto del cliente | De dónde sale |
|---|---|
| Cargadas | cargas **aceptadas** y vivas de ese día (igual que hoy) |
| Ventas · Promoción | `cantidad` · `cantidad_promocion` de líneas vivas de ventas vivas del vendedor con esa `fecha` (igual que hoy) |
| Merma entregada al cliente | `movimiento_inventario` vivo `tipo = 'merma_cliente'`, líneas `sentido = 'entregado'` |
| Merma recibida del cliente | `tipo = 'merma_cliente'`, líneas `sentido = 'recibido'` |
| Merma de almacén | `tipo = 'merma_trayecto'` (líneas `entregado`) |
| Consumo | `tipo = 'consumo'` (líneas `entregado`) |
| Cambios físicos entregados / recibidos | **No existen todavía** (T-33, app de Mario): valen 0 |
| Piezas reales · Merma real validada | `retorno.piezas` · `retorno.piezas_merma` (igual que hoy) |

Los movimientos se toman por `movimiento_inventario.fecha` (la `fecha_operacion` de la tablet) y `vendedor_id`, solo
`deleted_at is null`.

## Decisiones mías (el cliente no lo dijo; se pueden cambiar)

- **D1. Total del día por bloque.** "Faltan N piezas" = suma, por tamaño, de los totales de tamaño **positivos**. Un
  tamaño no compensa a otro (el cliente solo mostró compensación dentro de un tamaño, y los cambios físicos también son
  "misma presentación"). Igual para la merma: "Falta N de merma". Hoy la regla era por presentación (D9 viejo); cambia
  a por tamaño por C6.
- **D2. Estado del corte** (pastilla de la lista y de la pantalla): *Sin corte* / *Corte hecho* / *Faltan …* en rojo
  si cualquiera de los dos totales (piezas o merma) es > 0. La lista del día muestra los dos números
  ("Faltan 3 · Merma 1").
- **D3. Agrupar por tamaño** con `presentacion.volumen` normalizado (minúsculas, sin espacios: "500 ml" = "500ml").
  Título de la sección = el volumen tal cual de la primera presentación. Orden de menor a mayor leyendo el número
  (`L` = ×1000 ml); lo que no se pueda leer va al final, por nombre. Dentro del tamaño, por nombre de producto.
- **D4. El renglón dice solo el producto** ("Horchata"): el tamaño ya está en la sección.
- **D5. Desglose.** La tabla del corte lleva solo las columnas del cliente (C2). El desglose (cargadas, ventas, merma
  entregada, cambios…) es del siguiente submódulo, *Info de inventario por vendedor*. En el corte, un `Ayuda` (ⓘ) en
  el encabezado de cada teórica explica la fórmula.
- **D6. Campos vacíos**: siguen trayendo lo guardado o vacío, nunca el teórico (como hoy: es un conteo, no un
  "aceptar"). Sin corte hecho, el resultado solo se ve en los renglones tocados (D9 viejo).
- **D7. "Vendió más de lo cargado"** (teórica negativa) se sigue avisando bajo el producto, como hoy.
- **D8. Una sola cuenta.** `reglas-corte.ts` sigue siendo la única fuente de la teórica. La existencia que usa la
  venta del portal con "Control de inventario" (`existenciasPorPresentacion`) usa la teórica nueva: ahora también
  descuenta merma entregada, merma de almacén y consumo, igual que la existencia de la app (cierra el pendiente "el
  corte resta merma y consumo del #150"). La merma recibida **no** suma a lo vendible.
- **D9. Cambios físicos** quedan en la cuenta como campos en 0 (`cambiosEntregados`, `cambiosRecibidos`) para que T-33
  solo llene la consulta.
- **D10. Agregar presentación** sigue (algo que regresó sin movimiento ese día); cae en su sección de tamaño.
- **D11. Ancho**: la tabla cabe a 1366 px (7 columnas: producto + 6 números); medir en navegador.

## Contrato (`GET`/`PUT /cortes/vendedor`, `GET /cortes`)

Los tipos están duplicados en `apps/portal/src/lib/cortes.ts` y el backend; se cambian en el mismo commit.

- Línea: agrega `mermaEntregada`, `mermaRecibida`, `mermaAlmacen`, `consumo`, `cambiosEntregados`, `cambiosRecibidos`,
  `mermaTeorica`, `resultadoMerma`; `deberiaRegresar` pasa a ser la teórica de C3 y `faltante` su resultado; agrega
  `tamano` (texto de la sección) y `producto` (nombre sin tamaño). Se queda `nombre` ("Horchata 500 ml") para los
  mensajes.
- Corte: agrega `tamanos: { tamano, lineas: presentacionId[], totales }[]` en orden (D3), y en `totales` los nuevos
  `faltanteMerma`; `faltante` cambia de regla (D1).
- Lista: `FilaCorte` agrega `mermaFaltante`.
- Sin cambio del `PUT` (sigue mandando `buenas` y `merma` por presentación). Sin cambio del contrato de la tablet.

## Fuera de alcance

Info de inventario por vendedor (con la pestaña Merma), Registro de Operación, los dos inventarios de PT, Información
de Producción, Procesos → Descuentos, motivos de merma y cambios físicos en la app (Mario). Dashboard y Flujo diario no
cambian en este paso.

## Pruebas

- `reglas-corte.spec.ts`: la fórmula C3/C4 con cada concepto, los ejemplos del cliente (500 ml: total 1; 355 ml:
  −1 + 1 = 0; merma 355 ml), agrupación y orden de tamaños, D1 (un tamaño no tapa a otro), existencia del portal.
- e2e del corte: merma del cliente, de trayecto y consumo de la tablet bajan la teórica; un movimiento borrado no
  cuenta; venta del portal con control de inventario descuenta la merma.
- Portal: pantalla con secciones, totales por tamaño, resultados en rojo, lista con "Faltan N · Merma M".
- Prueba a mano en navegador a 1366 px con datos de la base local.
