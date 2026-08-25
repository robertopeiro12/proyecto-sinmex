-- El vault confirmo el 2026-08-23 que 'Especial' NO es una lista de precio:
-- es el override manual por cliente (tabla `cliente_precio`, ya existe desde
-- T-05). La semilla original de T-05 sembro 5 filas por error, contradiciendo
-- esa decision. Baja logica y no `delete`: si algun dia algo llegara a
-- referenciar esta fila no se rompe una referencia (hoy nada la usa -- no hay
-- pantalla de cliente todavia).
update lista_precio set deleted_at = now() where nombre = 'Especial';
