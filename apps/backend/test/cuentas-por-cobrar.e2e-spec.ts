import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { borrarCobrosDe, sembrarCobro } from './apoyo-cobros';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import type { CuentasPorCobrar } from './../src/modules/cuentas-cobrar-pagar/reglas-cuentas-por-cobrar';

const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
// Sucursal propia: los totales de QC son solo de esta suite.
const CODIGO = 'QC';

/** `AAAA-MM-DD` menos `dias`, sin zona horaria de por medio. */
function restarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
}

describe('Cuentas por Cobrar (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  let idQc: string;
  let idTijuana: string;
  let usuarioGeneralId: string;
  let cookieGeneral: string;
  let cookieQc: string;
  let cookieSinPermiso: string;
  let cookieConExcepcion: string;
  let hoy: string;
  let folios = 0;

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  /** `Auxiliar Administrativo` esta vacio de permisos. */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<string> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', perfil)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({
        login,
        nombre: login,
        password_hash: hash,
        perfil_id: perfilId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
    return id;
  };

  const sembrarCliente = async (
    nombre: string,
    plazo: number | null,
    sucursalId = idQc,
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${nombre} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
        plazo_credito_dias: plazo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  /** Venta a credito de oficina; `pendiente` y viva salvo que se diga otra cosa. */
  const sembrarNota = async (
    clienteId: string,
    monto: string,
    fecha: string,
    extra: { status?: string; borrada?: boolean } = {},
  ): Promise<string> => {
    const cliente = await db
      .selectFrom('cliente')
      .select('sucursal_id')
      .where('id', '=', clienteId)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZP${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha,
        cliente_id: clienteId,
        vendedor_id: null,
        monto_total: monto,
        num_nota: null,
        contado_credito: 'credito',
        semana: 1,
        mes: 1,
        status: extra.status ?? 'pendiente',
        sucursal_id: cliente.sucursal_id,
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
        deleted_at: extra.borrada ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  /** Un abono vivo (o borrado, con su pago borrado como lo deja T-34). */
  const sembrarAbono = async (
    notaId: string,
    clienteId: string,
    monto: string,
    opciones: { saldoFavor?: boolean; borrado?: boolean } = {},
  ): Promise<void> => {
    const cobroId = await sembrarCobro(db, {
      clienteId,
      vendedorId: null,
      monto,
      fecha: hoy,
      metodoPago: opciones.saldoFavor ? 'saldo_favor' : 'efectivo',
    });
    const borradoEn = opciones.borrado ? new Date() : null;
    if (borradoEn)
      await db
        .updateTable('cobro')
        .set({ deleted_at: borradoEn })
        .where('id', '=', cobroId)
        .execute();
    await db
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: notaId,
        vendedor_id: null,
        fecha_pago: hoy,
        fecha_operacion: hoy,
        monto,
        tipo: 'abono',
        saldo_pendiente: '0.00',
        metodo_pago: opciones.saldoFavor ? 'saldo_favor' : 'efectivo',
        origen: opciones.saldoFavor ? 'saldo_favor' : 'cobro',
        cobro_id: cobroId,
        deleted_at: borradoEn,
      })
      .execute();
  };

  const pedir = (cookie: string, query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(`/cuentas-por-cobrar?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const deQc = async (
    query: Record<string, string> = {},
  ): Promise<CuentasPorCobrar> =>
    (await pedir(cookieGeneral, { sucursal: CODIGO, ...query }).expect(200))
      .body as CuentasPorCobrar;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    // Una corrida que trono pudo dejar QC: se reusa.
    idQc = (
      await db
        .insertInto('sucursal')
        .values({ codigo: CODIGO, nombre: 'Prueba Cuentas por Cobrar' })
        .onConflict((oc) =>
          oc.column('codigo').doUpdateSet({ deleted_at: null }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    idTijuana = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;

    usuarioGeneralId = await crearUsuario(
      `e2e-cxc-gen-${SUFIJO}`,
      'Administrador General',
      null,
    );
    await crearUsuario(`e2e-cxc-qc-${SUFIJO}`, 'Administrador General', idQc);
    await crearUsuario(
      `e2e-cxc-sin-${SUFIJO}`,
      'Auxiliar Administrativo',
      null,
    );
    const conExcepcion = await crearUsuario(
      `e2e-cxc-exc-${SUFIJO}`,
      'Auxiliar Administrativo',
      null,
    );
    const { id: permisoId } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'cuentas_cobrar.ver')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({
        usuario_id: conExcepcion,
        permiso_id: permisoId,
        habilitado: true,
      })
      .execute();

    cookieGeneral = await iniciarSesion(`e2e-cxc-gen-${SUFIJO}`);
    cookieQc = await iniciarSesion(`e2e-cxc-qc-${SUFIJO}`);
    cookieSinPermiso = await iniciarSesion(`e2e-cxc-sin-${SUFIJO}`);
    cookieConExcepcion = await iniciarSesion(`e2e-cxc-exc-${SUFIJO}`);

    hoy = (await deQc()).hoy;
  });

  afterAll(async () => {
    if (clienteIds.length > 0) {
      const notas = db
        .selectFrom('venta_nota')
        .select('id')
        .where('cliente_id', 'in', clienteIds);
      await db
        .deleteFrom('cobranza_abono')
        .where('venta_nota_id', 'in', notas)
        .execute();
      await borrarCobrosDe(db, clienteIds);
      await db
        .deleteFrom('venta_nota')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db
      .deleteFrom('usuario_permiso')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  /* ================================================================ */

  it('hoy es una fecha AAAA-MM-DD (la de Tijuana, calculada en Postgres)', () => {
    expect(hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe('permiso y alcance', () => {
    it('sin sesion es 401', async () => {
      await request(app.getHttpServer()).get('/cuentas-por-cobrar').expect(401);
    });

    it('sin cuentas_cobrar.ver es 403; con la excepcion en usuario_permiso, 200', async () => {
      await pedir(cookieSinPermiso).expect(403);
      await pedir(cookieConExcepcion, { sucursal: CODIGO }).expect(200);
    });

    it('soloVencidas que no es true/false es 400', async () => {
      await pedir(cookieGeneral, { soloVencidas: 'quizas' }).expect(400);
    });

    it('atado a QC: "todas" o nada le da QC; pedir TJ es 403 (Review Focus 5)', async () => {
      const cli = await sembrarCliente('Alcance', 10);
      await sembrarNota(cli, '10.00', hoy);
      const cliTj = await sembrarCliente('Alcance TJ', 10, idTijuana);
      await sembrarNota(cliTj, '10.00', hoy);

      for (const query of [{}, { sucursal: 'todas' }, { sucursal: 'qc' }]) {
        const r = (await pedir(cookieQc, query).expect(200))
          .body as CuentasPorCobrar;
        const ids = r.clientes.map((c) => c.clienteId);
        expect(ids).toContain(cli);
        expect(ids).not.toContain(cliTj);
        expect(r.clientes.every((c) => c.sucursalCodigo === CODIGO)).toBe(true);
      }
      await pedir(cookieQc, { sucursal: 'TJ' }).expect(403);
    });
  });

  describe('universo, saldos y vencimiento', () => {
    let cliUniverso: string;
    let pendiente: string;
    let abonada: string;
    let conBorrado: string;
    let conSaldoFavor: string;

    beforeAll(async () => {
      cliUniverso = await sembrarCliente('Universo', null);
      pendiente = await sembrarNota(cliUniverso, '100.00', hoy);
      abonada = await sembrarNota(cliUniverso, '100.00', hoy, {
        status: 'abonado',
      });
      await sembrarAbono(abonada, cliUniverso, '30.00');
      conBorrado = await sembrarNota(cliUniverso, '100.00', hoy);
      await sembrarAbono(conBorrado, cliUniverso, '40.00', { borrado: true });
      conSaldoFavor = await sembrarNota(cliUniverso, '100.00', hoy, {
        status: 'abonado',
      });
      await sembrarAbono(conSaldoFavor, cliUniverso, '25.00', {
        saldoFavor: true,
      });
      await sembrarNota(cliUniverso, '100.00', hoy, { status: 'pagada' });
      await sembrarNota(cliUniverso, '0.00', hoy, { status: 'promocion' });
      await sembrarNota(cliUniverso, '100.00', hoy, {
        status: 'cuenta_perdida',
      });
      await sembrarNota(cliUniverso, '100.00', hoy, { borrada: true });
    });

    it('entran pendiente y abonado vivos; fuera pagada, promocion, cuenta perdida y borrada', async () => {
      const c = (await deQc()).clientes.find(
        (x) => x.clienteId === cliUniverso,
      );
      expect(c?.notas.map((n) => n.id).sort()).toEqual(
        [pendiente, abonada, conBorrado, conSaldoFavor].sort(),
      );
    });

    it('abono vivo resta; abono de un pago borrado no; saldo a favor si (Review Focus 3)', async () => {
      const c = (await deQc()).clientes.find(
        (x) => x.clienteId === cliUniverso,
      )!;
      const saldo = (id: string) =>
        c.notas.find((n) => n.id === id)!.saldoCentavos;
      expect(saldo(pendiente)).toBe(10000);
      expect(saldo(abonada)).toBe(7000);
      expect(saldo(conBorrado)).toBe(10000);
      expect(saldo(conSaldoFavor)).toBe(7500);
      expect(c.notas.find((n) => n.id === abonada)!.abonadoCentavos).toBe(3000);
      expect(c.saldoCentavos).toBe(10000 + 7000 + 10000 + 7500);
    });

    it('un cliente dado de baja que aun debe aparece, marcado clienteDadoDeBaja', async () => {
      const dadoDeBaja = await sembrarCliente('Dado de baja', null);
      await sembrarNota(dadoDeBaja, '100.00', hoy);
      await db
        .updateTable('cliente')
        .set({ deleted_at: new Date() })
        .where('id', '=', dadoDeBaja)
        .execute();
      const r = await deQc();
      expect(
        r.clientes.find((x) => x.clienteId === dadoDeBaja)?.clienteDadoDeBaja,
      ).toBe(true);
      expect(
        r.clientes.find((x) => x.clienteId === cliUniverso)?.clienteDadoDeBaja,
      ).toBe(false);
    });

    it('vencimiento contra el hoy de Tijuana (Review Focus 1 y 2)', async () => {
      const sinPlazo = await sembrarCliente('Sin plazo', null);
      const viejaSinPlazo = await sembrarNota(
        sinPlazo,
        '10.00',
        restarDias(hoy, 400),
      );
      const plazo0 = await sembrarCliente('Plazo 0', 0);
      const hoy0 = await sembrarNota(plazo0, '10.00', hoy);
      const ayer0 = await sembrarNota(plazo0, '10.00', restarDias(hoy, 1));
      const plazo15 = await sembrarCliente('Plazo 15', 15);
      const venceHoy = await sembrarNota(plazo15, '10.00', restarDias(hoy, 15));
      const vencida16 = await sembrarNota(
        plazo15,
        '10.00',
        restarDias(hoy, 31),
      );

      const r = await deQc();
      const nota = (id: string) =>
        r.clientes.flatMap((c) => c.notas).find((n) => n.id === id)!;
      expect(nota(viejaSinPlazo)).toMatchObject({ vence: null, diasAtraso: 0 });
      expect(nota(hoy0)).toMatchObject({ vence: hoy, diasAtraso: 0 });
      expect(nota(ayer0)).toMatchObject({
        vence: restarDias(hoy, 1),
        diasAtraso: 1,
      });
      expect(nota(venceHoy)).toMatchObject({ vence: hoy, diasAtraso: 0 });
      expect(nota(vencida16)).toMatchObject({
        vence: restarDias(hoy, 16),
        diasAtraso: 16,
      });

      const cli15 = r.clientes.find((c) => c.clienteId === plazo15)!;
      expect(cli15.vencidoCentavos).toBe(1000);
      expect(
        r.clientes.find((c) => c.clienteId === sinPlazo)!.vencidoCentavos,
      ).toBe(0);
    });

    it('totales de la sucursal = suma de sus clientes; soloVencidas los recalcula', async () => {
      const todo = await deQc();
      expect(todo.totalCentavos).toBe(
        todo.clientes.reduce((s, c) => s + c.saldoCentavos, 0),
      );
      expect(todo.vencidoCentavos).toBe(
        todo.clientes.reduce((s, c) => s + c.vencidoCentavos, 0),
      );
      expect(todo.notas).toBe(
        todo.clientes.reduce((s, c) => s + c.notas.length, 0),
      );

      const vencidas = await deQc({ soloVencidas: 'true' });
      expect(vencidas.totalCentavos).toBe(todo.vencidoCentavos);
      expect(vencidas.vencidoCentavos).toBe(todo.vencidoCentavos);
      expect(
        vencidas.clientes
          .flatMap((c) => c.notas)
          .every((n) => n.diasAtraso > 0),
      ).toBe(true);
      expect(vencidas.clientes.map((c) => c.clienteId)).not.toContain(
        cliUniverso,
      );
      // `soloVencidas=false` es lo mismo que no mandarlo.
      expect(await deQc({ soloVencidas: 'false' })).toEqual(todo);
    });
  });
});
