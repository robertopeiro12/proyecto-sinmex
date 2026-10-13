import type { Database } from './../src/database/database.tokens';

/** Lo minimo de un pago sembrado a mano en una prueba. */
export interface CobroSembrado {
  clienteId: string;
  vendedorId: string | null;
  /** Texto `numeric`, como en la base. */
  monto: string;
  /** `AAAA-MM-DD`: fecha de pago y de operacion. */
  fecha: string;
  metodoPago?: 'efectivo' | 'transferencia' | 'cheque' | 'saldo_favor';
  capturoUsuarioId?: string | null;
}

/**
 * Un `cobro` (T-34) para filas que una prueba escribe por debajo del servicio.
 * Desde T-34 toda fila de `cobranza_abono` que no sea de contado y todo
 * `saldo_favor_movimiento` cuelgan de un pago (`ck_cobranza_abono_cobro`,
 * `cobro_id not null`). El metodo `saldo_favor` hace un pago de origen
 * `saldo_favor` y sin cobrador, como el que deja aplicar saldo a favor.
 */
export async function sembrarCobro(
  db: Database,
  datos: CobroSembrado,
): Promise<string> {
  const metodo = datos.metodoPago ?? 'efectivo';
  const saldoFavor = metodo === 'saldo_favor';
  const { id } = await db
    .insertInto('cobro')
    .values({
      cliente_id: datos.clienteId,
      vendedor_id: saldoFavor ? null : datos.vendedorId,
      capturo_usuario_id: datos.capturoUsuarioId ?? null,
      origen: saldoFavor ? 'saldo_favor' : 'cobro',
      metodo_pago: metodo,
      monto: datos.monto,
      fecha_pago: datos.fecha,
      fecha_operacion: datos.fecha,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** `sembrarCobro` para el cliente de una nota que la prueba ya tiene. */
export async function cobroParaNota(
  db: Database,
  ventaNotaId: string,
  datos: Omit<CobroSembrado, 'clienteId'>,
): Promise<string> {
  const { cliente_id } = await db
    .selectFrom('venta_nota')
    .select('cliente_id')
    .where('id', '=', ventaNotaId)
    .executeTakeFirstOrThrow();
  return sembrarCobro(db, { ...datos, clienteId: cliente_id });
}

/**
 * Limpieza en orden de llaves foraneas: las peticiones de esos pagos y los
 * pagos. Va DESPUES de borrar sus `cobranza_abono` y `saldo_favor_movimiento`,
 * y ANTES de sus notas, del cliente y de los usuarios que pidieron o
 * resolvieron.
 */
export async function borrarCobrosDe(
  db: Database,
  clienteIds: readonly string[],
): Promise<void> {
  if (clienteIds.length === 0) return;
  const cobros = db
    .selectFrom('cobro')
    .select('id')
    .where('cliente_id', 'in', [...clienteIds]);
  await db.deleteFrom('peticion').where('cobro_id', 'in', cobros).execute();
  await db
    .deleteFrom('cobro')
    .where('cliente_id', 'in', [...clienteIds])
    .execute();
}
