import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import type {
  CorteVendedor,
  CortesDelDia,
  FilaCorte,
} from './../src/modules/produccion/cortes.service';
import {
  MENSAJE_FECHA_FUTURA,
  MOTIVO_PRESENTACION_INEXISTENTE,
} from './../src/modules/produccion/reglas-produccion';

/**
 * Corte de mercancia (absorbe a Retorno), de punta a punta: la lista del dia
 * (estado, sin carga, faltantes), el corte de un vendedor (cargadas solo de
 * cargas aceptadas, vendidas/regaladas de lineas vivas de ventas vivas),
 * guardar todo en 0 deja el corte hecho, corregir un dia pasado, fecha futura,
 * alcance, permiso, el relleno de la migracion y guardados simultaneos.
 *
 * Los vendedores, clientes y presentaciones son de esta corrida. Los dias son de
 * 1980–1987 (ninguna otra suite los usa) y se limpian en `beforeAll`.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-cor-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-cor-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-cor-sin-${SUFIJO}`;
const PRODUCTO = `ZZ-cor-${SUFIJO}`;

const DIAS_DE_LA_CORRIDA = 10;
const DIA_BASE = Date.now() % 2900;
function diaDeLaCorrida(desplazamiento: number): string {
  return new Date(
    Date.UTC(1980, 0, 1) + (DIA_BASE + desplazamiento) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}
const DIAS_PRUEBA = Array.from({ length: DIAS_DE_LA_CORRIDA }, (_, i) =>
  diaDeLaCorrida(i),
);

/** La sentencia de relleno de la migracion, tal cual (entre sus marcas). */
function sentenciaDeRelleno(): string {
  const archivo = readFileSync(
    join(
      __dirname,
      '../../../supabase/migrations/20261112120000_corte_mercancia.sql',
    ),
    'utf8',
  );
  const m = /-- relleno:inicio\n([\s\S]*?)-- relleno:fin/.exec(archivo);
  if (!m) throw new Error('La migracion no trae las marcas del relleno.');
  return m[1];
}

describe('Corte de mercancia desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let hoy: string;
  let manana: string;
  const usuarioIds: string[] = [];
  const productoIds: string[] = [];
  const vendedorIds: string[] = [];
  const clienteIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let generalId: string;
  let tjId: string;
  let mxId: string;
  let litro: string;
  let medio: string;
  let otra: string;
  let clienteTj: string;

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

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio. */
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

  const crearVendedor = async (
    nombre: string,
    sucursalId: string,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-cor-v${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  const crearCliente = async (sucursalId: string): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `Cliente corte ${clienteIds.length + 1} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  const crearPresentacion = async (
    producto: string,
    volumen: string,
  ): Promise<string> => {
    const { id: productoId } = await db
      .insertInto('producto')
      .values({ nombre: producto, activo: true })
      .returning('id')
      .executeTakeFirstOrThrow();
    productoIds.push(productoId);
    return (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  };

  /** Una carga escrita directo en la tabla (el servicio solo captura hoy). */
  let numeroCarga = 0;
  const crearCarga = async (opciones: {
    vendedorId: string;
    sucursalId: string;
    fecha: string;
    estado: 'pendiente' | 'aceptada' | 'rechazada';
    lineas: { presentacionId: string; piezas: number }[];
  }): Promise<void> => {
    numeroCarga++;
    const { id } = await db
      .insertInto('carga')
      .values({
        vendedor_id: opciones.vendedorId,
        sucursal_id: opciones.sucursalId,
        fecha: sql<Date>`${opciones.fecha}::date`,
        numero: numeroCarga,
        estado: opciones.estado,
        motivo_rechazo: opciones.estado === 'rechazada' ? 'No coincide' : null,
        respondida_en:
          opciones.estado === 'pendiente' ? null : sql<Date>`now()`,
        capturo_usuario_id: generalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('carga_detalle')
      .values(
        opciones.lineas.map((l) => ({
          carga_id: id,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
        })),
      )
      .execute();
  };

  /** Una venta escrita directo en la tabla, con lineas (vivas o borradas). */
  let folios = 0;
  const crearVenta = async (opciones: {
    vendedorId: string | null;
    clienteId: string;
    sucursalId: string;
    fecha: string;
    borrada?: boolean;
    lineas: {
      presentacionId: string;
      cantidad: number;
      promo?: number;
      borrada?: boolean;
    }[];
  }): Promise<void> => {
    const { id } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZC${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: sql<Date>`${opciones.fecha}::date`,
        cliente_id: opciones.clienteId,
        vendedor_id: opciones.vendedorId,
        monto_total: '10.00',
        contado_credito: 'contado',
        semana: 10,
        mes: 3,
        status: 'pagada',
        sucursal_id: opciones.sucursalId,
        origen: 'portal',
        capturo_usuario_id: generalId,
        deleted_at: opciones.borrada ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const l of opciones.lineas) {
      await db
        .insertInto('venta_nota_detalle')
        .values({
          venta_nota_id: id,
          presentacion_id: l.presentacionId,
          cantidad: l.cantidad,
          cantidad_promocion: l.promo ?? 0,
          precio: '1.00',
          deleted_at: l.borrada ? sql<Date>`now()` : null,
        })
        .execute();
    }
  };

  const lista = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/cortes?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const leer = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/cortes/vendedor?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const guardar = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .put('/cortes/vendedor')
      .set('Cookie', cookie)
      .send(cuerpo);

  const linea = (corte: CorteVendedor, presentacionId: string) =>
    corte.lineas.find((l) => l.presentacionId === presentacionId);

  const fila = (dia: CortesDelDia, vendedorId: string): FilaCorte | undefined =>
    dia.vendedores.find((v) => v.vendedor.id === vendedorId);

  /** Espera a que `n` conexiones esten detenidas en un candado con `fragmento` (sin `sleep`). */
  const esperarDetenidas = async (
    n: number,
    fragmento: string,
  ): Promise<void> => {
    for (let intento = 0; intento < 100; intento++) {
      const r = await sql<{ detenidas: number }>`
        select count(*)::int as detenidas
          from pg_stat_activity
         where wait_event_type = 'Lock'
           and pid <> pg_backend_pid()
           and position(${fragmento} in query) > 0
      `.execute(db);
      if (r.rows[0].detenidas >= n) return;
      await new Promise((listo) => setTimeout(listo, 50));
    }
    throw new Error(
      `Nunca hubo ${n} consultas detenidas en un candado con ${fragmento}.`,
    );
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    const sucursal = async (codigo: string) =>
      (
        await db
          .selectFrom('sucursal')
          .select('id')
          .where('codigo', '=', codigo)
          .executeTakeFirstOrThrow()
      ).id;
    tjId = await sucursal('TJ');
    mxId = await sucursal('MX');
    const fechas = (
      await sql<{ hoy: string; manana: string }>`
        select to_char((now() at time zone 'America/Tijuana')::date, 'YYYY-MM-DD') as hoy,
               to_char((now() at time zone 'America/Tijuana')::date + 1, 'YYYY-MM-DD') as manana
      `.execute(db)
    ).rows[0];
    hoy = fechas.hoy;
    manana = fechas.manana;

    await db
      .deleteFrom('retorno')
      .where(sql<boolean>`fecha = any(${DIAS_PRUEBA}::date[])`)
      .execute();
    await db
      .deleteFrom('corte_mercancia')
      .where(sql<boolean>`fecha = any(${DIAS_PRUEBA}::date[])`)
      .execute();

    generalId = await crearUsuario(
      LOGIN_GENERAL,
      'Administrador General',
      null,
    );
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    litro = await crearPresentacion(PRODUCTO, '1 L');
    medio = await crearPresentacion(`${PRODUCTO}-b`, '500 ml');
    otra = await crearPresentacion(`${PRODUCTO}-c`, '355 ml');
    clienteTj = await crearCliente(tjId);
  });

  afterAll(async () => {
    await db
      .deleteFrom('retorno')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    await db
      .deleteFrom('corte_mercancia')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    const cargas = db
      .selectFrom('carga')
      .select('id')
      .where('vendedor_id', 'in', vendedorIds);
    await db
      .deleteFrom('carga_detalle')
      .where('carga_id', 'in', cargas)
      .execute();
    await db
      .deleteFrom('carga')
      .where('vendedor_id', 'in', vendedorIds)
      .execute();
    const notas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('cliente_id', 'in', clienteIds);
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', notas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('cliente_id', 'in', clienteIds)
      .execute();
    await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('presentacion')
      .where('producto_id', 'in', productoIds)
      .execute();
    await db.deleteFrom('producto').where('id', 'in', productoIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  describe('permiso y alcance', () => {
    it('sin retorno.gestionar la lista, el GET y el PUT son 403', async () => {
      const v = await crearVendedor('Cor permiso', tjId);
      await lista(cookieSinPermiso, { fecha: hoy }).expect(403);
      await leer(cookieSinPermiso, { fecha: hoy, vendedor: v }).expect(403);
      await guardar(cookieSinPermiso, {
        fecha: hoy,
        vendedor: v,
        lineas: [],
      }).expect(403);
    });

    it('un usuario atado a TJ no alcanza a un vendedor de MX (404) ni pide la lista de MX (403)', async () => {
      const mx = await crearVendedor('Cor MX', mxId);
      await leer(cookieTijuana, { fecha: hoy, vendedor: mx }).expect(404);
      await guardar(cookieTijuana, {
        fecha: hoy,
        vendedor: mx,
        lineas: [],
      }).expect(404);
      await lista(cookieTijuana, { fecha: hoy, sucursal: 'MX' }).expect(403);
      // Un vendedor inexistente es el mismo 404.
      await leer(cookieGeneral, {
        fecha: hoy,
        vendedor: '3f2504e0-4f89-41d3-9a0c-0305e82c3399',
      }).expect(404);
      // Y no se escribio nada para el de MX.
      const cortes = await db
        .selectFrom('corte_mercancia')
        .select('id')
        .where('vendedor_id', '=', mx)
        .execute();
      expect(cortes).toHaveLength(0);
    });
  });

  describe('lista del dia', () => {
    it('sale quien tiene carga aceptada, venta o conteo, con su estado, sinCarga y faltantes', async () => {
      const dia = diaDeLaCorrida(0);
      const conCarga = await crearVendedor('Cor A con carga', tjId);
      const soloVenta = await crearVendedor('Cor B solo venta', tjId);
      const conFaltante = await crearVendedor('Cor C faltante', tjId);
      const vendioTodo = await crearVendedor('Cor D vendio todo', tjId);
      const sinNada = await crearVendedor('Cor E sin nada', tjId);
      const soloPendiente = await crearVendedor('Cor F pendiente', tjId);
      const deMx = await crearVendedor('Cor G MX', mxId);

      await crearCarga({
        vendedorId: conCarga,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 10 }],
      });
      await crearVenta({
        vendedorId: soloVenta,
        clienteId: clienteTj,
        sucursalId: tjId,
        fecha: dia,
        lineas: [{ presentacionId: litro, cantidad: 4 }],
      });
      await crearCarga({
        vendedorId: conFaltante,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [
          { presentacionId: litro, piezas: 68 },
          { presentacionId: medio, piezas: 5 },
        ],
      });
      await crearVenta({
        vendedorId: conFaltante,
        clienteId: clienteTj,
        sucursalId: tjId,
        fecha: dia,
        lineas: [{ presentacionId: litro, cantidad: 35 }],
      });
      await crearCarga({
        vendedorId: vendioTodo,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 6 }],
      });
      await crearVenta({
        vendedorId: vendioTodo,
        clienteId: clienteTj,
        sucursalId: tjId,
        fecha: dia,
        lineas: [{ presentacionId: litro, cantidad: 5, promo: 1 }],
      });
      await crearCarga({
        vendedorId: soloPendiente,
        sucursalId: tjId,
        fecha: dia,
        estado: 'pendiente',
        lineas: [{ presentacionId: litro, piezas: 9 }],
      });
      await crearCarga({
        vendedorId: deMx,
        sucursalId: mxId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 3 }],
      });

      // Faltante: 68 − 35 = 33 de litro, contaron 28 → faltan 5; medio 5 y 5.
      await guardar(cookieGeneral, {
        fecha: dia,
        vendedor: conFaltante,
        lineas: [
          { presentacionId: litro, buenas: 28, merma: 2 },
          { presentacionId: medio, buenas: 5, merma: 0 },
        ],
      }).expect(200);
      // Vendio todo: se guarda sin piezas.
      await guardar(cookieGeneral, {
        fecha: dia,
        vendedor: vendioTodo,
        lineas: [],
      }).expect(200);

      const tj = (
        await lista(cookieGeneral, { fecha: dia, sucursal: 'TJ' }).expect(200)
      ).body as CortesDelDia;
      expect(tj.fecha).toBe(dia);
      expect(tj.hoy).toBe(hoy);
      const mias = tj.vendedores.filter((v) =>
        vendedorIds.includes(v.vendedor.id),
      );
      expect(mias.map((v) => v.vendedor.id)).toEqual([
        conCarga,
        soloVenta,
        conFaltante,
        vendioTodo,
      ]);
      expect(fila(tj, sinNada)).toBeUndefined();
      expect(fila(tj, soloPendiente)).toBeUndefined();
      expect(fila(tj, deMx)).toBeUndefined();

      expect(fila(tj, conCarga)).toEqual({
        vendedor: { id: conCarga, nombre: `Cor A con carga ${SUFIJO}` },
        sucursal: { id: tjId, codigo: 'TJ' },
        piezasCargadas: 10,
        estado: 'sin_corte',
        sinCarga: false,
        piezasFaltantes: null,
        hechoEn: null,
      });
      expect(fila(tj, soloVenta)).toMatchObject({
        piezasCargadas: 0,
        estado: 'sin_corte',
        sinCarga: true,
      });
      expect(fila(tj, conFaltante)).toMatchObject({
        piezasCargadas: 73,
        estado: 'con_faltante',
        piezasFaltantes: 5,
      });
      expect(fila(tj, conFaltante)?.hechoEn).toEqual(expect.any(String));
      expect(fila(tj, vendioTodo)).toMatchObject({
        estado: 'hecho',
        piezasFaltantes: 0,
        sinCarga: false,
      });

      // Todas: TJ y MX, ordenadas por sucursal y nombre.
      const todas = (
        await lista(cookieGeneral, { fecha: dia, sucursal: 'todas' }).expect(
          200,
        )
      ).body as CortesDelDia;
      const codigos = todas.vendedores
        .filter((v) => vendedorIds.includes(v.vendedor.id))
        .map((v) => v.sucursal.codigo);
      expect(codigos).toEqual(['MX', 'TJ', 'TJ', 'TJ', 'TJ']);

      // El atado a TJ sin sucursal ve la suya.
      const atado = (await lista(cookieTijuana, { fecha: dia }).expect(200))
        .body as CortesDelDia;
      expect(fila(atado, deMx)).toBeUndefined();
      expect(fila(atado, conCarga)).toBeDefined();
    });
  });

  describe('corte de un vendedor', () => {
    it('vendidas y regaladas solo de lineas vivas de ventas vivas; mostrador y otros vendedores no cuentan', async () => {
      const dia = diaDeLaCorrida(1);
      const v = await crearVendedor('Cor ventas', tjId);
      const otro = await crearVendedor('Cor otro', tjId);
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 40 }],
      });
      await crearVenta({
        vendedorId: v,
        clienteId: clienteTj,
        sucursalId: tjId,
        fecha: dia,
        lineas: [
          { presentacionId: litro, cantidad: 10, promo: 2 },
          { presentacionId: medio, cantidad: 3, borrada: true },
        ],
      });
      // Eliminada (T-17): no cuenta.
      await crearVenta({
        vendedorId: v,
        clienteId: clienteTj,
        sucursalId: tjId,
        fecha: dia,
        borrada: true,
        lineas: [{ presentacionId: litro, cantidad: 7 }],
      });
      // De mostrador y de otro vendedor: no cuentan.
      await crearVenta({
        vendedorId: null,
        clienteId: clienteTj,
        sucursalId: tjId,
        fecha: dia,
        lineas: [{ presentacionId: litro, cantidad: 5 }],
      });
      await crearVenta({
        vendedorId: otro,
        clienteId: clienteTj,
        sucursalId: tjId,
        fecha: dia,
        lineas: [{ presentacionId: litro, cantidad: 8 }],
      });
      // Otro dia: no cuenta.
      await crearVenta({
        vendedorId: v,
        clienteId: clienteTj,
        sucursalId: tjId,
        fecha: diaDeLaCorrida(2),
        lineas: [{ presentacionId: litro, cantidad: 1 }],
      });

      const corte = (
        await leer(cookieGeneral, { fecha: dia, vendedor: v }).expect(200)
      ).body as CorteVendedor;
      expect(corte).toMatchObject({
        fecha: dia,
        hoy,
        vendedor: { id: v, nombre: `Cor ventas ${SUFIJO}` },
        sucursal: { id: tjId, codigo: 'TJ' },
        hecho: null,
      });
      // La linea borrada de medio no trae nada mas: medio no sale.
      expect(corte.lineas).toEqual([
        {
          presentacionId: litro,
          nombre: `${PRODUCTO} 1 L`,
          cargadas: 40,
          vendidas: 10,
          regaladas: 2,
          deberiaRegresar: 28,
          buenas: 0,
          merma: 0,
          faltante: null,
        },
      ]);
      expect(corte.totales).toEqual({
        cargadas: 40,
        vendidas: 10,
        regaladas: 2,
        deberiaRegresar: 28,
        buenas: 0,
        merma: 0,
        faltante: null,
      });
    });

    it('una recarga sin aceptar no cuenta: deberia regresar negativo, sin romper totales', async () => {
      const dia = diaDeLaCorrida(3);
      const v = await crearVendedor('Cor recarga', tjId);
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 10 }],
      });
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'pendiente',
        lineas: [{ presentacionId: medio, piezas: 10 }],
      });
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'rechazada',
        lineas: [{ presentacionId: litro, piezas: 50 }],
      });
      await crearVenta({
        vendedorId: v,
        clienteId: clienteTj,
        sucursalId: tjId,
        fecha: dia,
        lineas: [
          { presentacionId: litro, cantidad: 8 },
          { presentacionId: medio, cantidad: 6 },
        ],
      });

      const res = (
        await guardar(cookieGeneral, {
          fecha: dia,
          vendedor: v,
          lineas: [{ presentacionId: litro, buenas: 2, merma: 0 }],
        }).expect(200)
      ).body as CorteVendedor;
      expect(linea(res, litro)).toMatchObject({
        cargadas: 10,
        vendidas: 8,
        deberiaRegresar: 2,
        faltante: 0,
      });
      expect(linea(res, medio)).toMatchObject({
        cargadas: 0,
        vendidas: 6,
        deberiaRegresar: -6,
        buenas: 0,
        faltante: -6,
      });
      expect(res.totales).toMatchObject({
        cargadas: 10,
        deberiaRegresar: -4,
        buenas: 2,
        faltante: 0,
      });
      expect(res.hecho?.por).toBe(LOGIN_GENERAL);
      expect(typeof res.hecho?.en).toBe('string');
    });

    it('guardar todo en 0 deja el corte hecho, sin filas de retorno', async () => {
      const dia = diaDeLaCorrida(4);
      const v = await crearVendedor('Cor ceros', tjId);
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 3 }],
      });
      const res = (
        await guardar(cookieGeneral, {
          fecha: dia,
          vendedor: v,
          lineas: [{ presentacionId: litro, buenas: 0, merma: 0 }],
        }).expect(200)
      ).body as CorteVendedor;
      expect(res.hecho).not.toBeNull();
      expect(linea(res, litro)?.faltante).toBe(3);

      const filas = await db
        .selectFrom('retorno')
        .select('id')
        .where('vendedor_id', '=', v)
        .execute();
      expect(filas).toHaveLength(0);
      const cortes = await db
        .selectFrom('corte_mercancia')
        .select('id')
        .where('vendedor_id', '=', v)
        .where('deleted_at', 'is', null)
        .execute();
      expect(cortes).toHaveLength(1);

      const dia2 = (
        await lista(cookieGeneral, { fecha: dia, sucursal: 'TJ' }).expect(200)
      ).body as CortesDelDia;
      expect(fila(dia2, v)).toMatchObject({
        estado: 'con_faltante',
        piezasFaltantes: 3,
      });
    });

    it('corregir un dia pasado: actualiza, 0/0 da de baja, agrega una presentacion viva y conserva quien lo hizo', async () => {
      const dia = diaDeLaCorrida(5);
      const v = await crearVendedor('Cor corregir', tjId);
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [
          { presentacionId: litro, piezas: 10 },
          { presentacionId: medio, piezas: 4 },
        ],
      });
      const primero = (
        await guardar(cookieGeneral, {
          fecha: dia,
          vendedor: v,
          lineas: [
            { presentacionId: litro, buenas: 6, merma: 1 },
            { presentacionId: medio, buenas: 4, merma: 0 },
          ],
        }).expect(200)
      ).body as CorteVendedor;

      const segundo = (
        await guardar(cookieTijuana, {
          fecha: dia,
          vendedor: v,
          lineas: [
            { presentacionId: litro, buenas: 9, merma: 1 },
            { presentacionId: medio, buenas: 0, merma: 0 },
            { presentacionId: otra, buenas: 0, merma: 2 },
          ],
        }).expect(200)
      ).body as CorteVendedor;
      expect(linea(segundo, litro)).toMatchObject({
        buenas: 9,
        merma: 1,
        faltante: 1,
      });
      expect(linea(segundo, medio)).toMatchObject({
        buenas: 0,
        merma: 0,
        faltante: 4,
      });
      expect(linea(segundo, otra)).toMatchObject({
        cargadas: 0,
        deberiaRegresar: 0,
        buenas: 0,
        merma: 2,
        faltante: 0,
      });
      expect(segundo.hecho).toEqual(primero.hecho);

      const vivas = await db
        .selectFrom('retorno')
        .select(['presentacion_id', 'piezas', 'piezas_merma'])
        .where('vendedor_id', '=', v)
        .where('deleted_at', 'is', null)
        .orderBy('piezas', 'desc')
        .execute();
      expect(vivas).toEqual([
        { presentacion_id: litro, piezas: 9, piezas_merma: 1 },
        { presentacion_id: otra, piezas: 0, piezas_merma: 2 },
      ]);
      const encabezado = await db
        .selectFrom('corte_mercancia')
        .select(['actualizado_por_usuario_id', 'hecho_por_usuario_id'])
        .where('vendedor_id', '=', v)
        .executeTakeFirstOrThrow();
      expect(encabezado.hecho_por_usuario_id).toBe(generalId);
      expect(encabezado.actualizado_por_usuario_id).not.toBeNull();
    });

    it('una presentacion dada de baja sin movimiento ese dia es 400; con carga se puede contar', async () => {
      const dia = diaDeLaCorrida(6);
      const v = await crearVendedor('Cor baja', tjId);
      const conCarga = await crearPresentacion(`${PRODUCTO}-baja-c`, '1 L');
      const sinCarga = await crearPresentacion(`${PRODUCTO}-baja-s`, '1 L');
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: conCarga, piezas: 4 }],
      });
      await db
        .updateTable('presentacion')
        .set({ deleted_at: sql<Date>`now()` })
        .where('id', 'in', [conCarga, sinCarga])
        .execute();

      const res = await guardar(cookieGeneral, {
        fecha: dia,
        vendedor: v,
        lineas: [{ presentacionId: sinCarga, buenas: 1, merma: 0 }],
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain(
        MOTIVO_PRESENTACION_INEXISTENTE,
      );

      const ok = (
        await guardar(cookieGeneral, {
          fecha: dia,
          vendedor: v,
          lineas: [{ presentacionId: conCarga, buenas: 4, merma: 0 }],
        }).expect(200)
      ).body as CorteVendedor;
      expect(linea(ok, conCarga)).toMatchObject({
        cargadas: 4,
        buenas: 4,
        faltante: 0,
      });
    });
  });

  describe('relleno de la migracion', () => {
    it('un dia con filas de retorno previas sale como corte hecho con sus buenas', async () => {
      const dia = diaDeLaCorrida(7);
      const v = await crearVendedor('Cor relleno', tjId);
      await crearCarga({
        vendedorId: v,
        sucursalId: tjId,
        fecha: dia,
        estado: 'aceptada',
        lineas: [{ presentacionId: litro, piezas: 12 }],
      });
      // Como las dejaba Retorno: solo buenas, sin encabezado.
      await db
        .insertInto('retorno')
        .values([
          {
            fecha: sql<Date>`${dia}::date`,
            vendedor_id: v,
            sucursal_id: tjId,
            presentacion_id: litro,
            piezas: 9,
            capturo_usuario_id: generalId,
            created_at: sql<Date>`now() - interval '1 hour'`,
          },
          {
            fecha: sql<Date>`${dia}::date`,
            vendedor_id: v,
            sucursal_id: tjId,
            presentacion_id: medio,
            piezas: 2,
            capturo_usuario_id: generalId,
          },
        ])
        .execute();
      const antes = (
        await leer(cookieGeneral, { fecha: dia, vendedor: v }).expect(200)
      ).body as CorteVendedor;
      expect(antes.hecho).toBeNull();

      await sql.raw(sentenciaDeRelleno()).execute(db);
      // Repetible: correrla otra vez no duplica.
      await sql.raw(sentenciaDeRelleno()).execute(db);

      const corte = (
        await leer(cookieGeneral, { fecha: dia, vendedor: v }).expect(200)
      ).body as CorteVendedor;
      expect(corte.hecho?.por).toBe(LOGIN_GENERAL);
      expect(linea(corte, litro)).toMatchObject({
        buenas: 9,
        merma: 0,
        faltante: 3,
      });
      expect(linea(corte, medio)).toMatchObject({ buenas: 2, faltante: -2 });
      const cortes = await db
        .selectFrom('corte_mercancia')
        .select(['hecho_en'])
        .where('vendedor_id', '=', v)
        .execute();
      expect(cortes).toHaveLength(1);

      const listaDia = (
        await lista(cookieGeneral, { fecha: dia, sucursal: 'TJ' }).expect(200)
      ).body as CortesDelDia;
      expect(fila(listaDia, v)?.estado).toBe('con_faltante');
    });
  });

  describe('validacion', () => {
    it('fecha futura en Tijuana es 400 con el mensaje y hoyEnTijuana, en lectura y guardado', async () => {
      const v = await crearVendedor('Cor futura', tjId);
      const res = await guardar(cookieGeneral, {
        fecha: manana,
        vendedor: v,
        lineas: [],
      }).expect(400);
      expect(res.body).toMatchObject({
        message: [MENSAJE_FECHA_FUTURA],
        hoyEnTijuana: hoy,
      });
      await leer(cookieGeneral, { fecha: manana, vendedor: v }).expect(400);
      await lista(cookieGeneral, { fecha: manana }).expect(400);
      // Hoy si se puede.
      await guardar(cookieGeneral, {
        fecha: hoy,
        vendedor: v,
        lineas: [],
      }).expect(200);
    });

    it('fecha inexistente, conteo negativo o presentacion repetida es 400', async () => {
      const v = await crearVendedor('Cor validar', tjId);
      await leer(cookieGeneral, { fecha: '2026-02-30', vendedor: v }).expect(
        400,
      );
      await lista(cookieGeneral, { fecha: 'hoy' }).expect(400);
      await guardar(cookieGeneral, {
        fecha: diaDeLaCorrida(8),
        vendedor: v,
        lineas: [{ presentacionId: litro, buenas: -1, merma: 0 }],
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: diaDeLaCorrida(8),
        vendedor: v,
        lineas: [
          { presentacionId: litro, buenas: 1, merma: 0 },
          { presentacionId: litro, buenas: 2, merma: 0 },
        ],
      }).expect(400);
      await guardar(cookieGeneral, {
        fecha: diaDeLaCorrida(8),
        vendedor: v,
        lineas: [{ presentacionId: litro, buenas: 1 }],
      }).expect(400);
    });

    it('/retornos ya no existe', async () => {
      await request(app.getHttpServer())
        .get(`/retornos?fecha=${hoy}`)
        .set('Cookie', cookieGeneral)
        .expect(404);
    });
  });

  describe('guardados simultaneos', () => {
    it('dos PUT del mismo vendedor y dia se serializan: queda el ultimo, un solo encabezado, sin 500', async () => {
      const dia = diaDeLaCorrida(9);
      const v = await crearVendedor('Cor simultaneo', tjId);
      const cuerpoA = {
        fecha: dia,
        vendedor: v,
        lineas: [{ presentacionId: litro, buenas: 10, merma: 0 }],
      };
      const cuerpoB = {
        fecha: dia,
        vendedor: v,
        lineas: [{ presentacionId: medio, buenas: 20, merma: 1 }],
      };

      let pendientes!: Promise<request.Response[]>;
      await db.transaction().execute(async (trx) => {
        await sql`select id from vendedor where id = ${v} for no key update`.execute(
          trx,
        );
        pendientes = Promise.all([
          guardar(cookieGeneral, cuerpoA),
          guardar(cookieGeneral, cuerpoB),
        ]);
        await esperarDetenidas(2, 'from "vendedor"');
      });
      const [resA, resB] = await pendientes;
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const vivas = await db
        .selectFrom('retorno')
        .select('presentacion_id')
        .where('vendedor_id', '=', v)
        .where('deleted_at', 'is', null)
        .execute();
      expect(vivas).toHaveLength(1);
      const cortes = await db
        .selectFrom('corte_mercancia')
        .select('id')
        .where('vendedor_id', '=', v)
        .where('deleted_at', 'is', null)
        .execute();
      expect(cortes).toHaveLength(1);
    });
  });
});
