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

/**
 * El portal no deja venderle a un vendedor mas de lo que trae cargado
 * (corte de mercancia, Tarea 4): `POST /ventas` y `PATCH /ventas/:id` con
 * `sucursal.control_inventario` prendida.
 *
 * Sucursal propia (`ZI`): prender su casilla no toca las ventas de TJ/MX de las
 * demas suites, que corren en paralelo. Cada prueba usa su propia fecha y su
 * propio vendedor.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-vinv-gen-${SUFIJO}`;
const CODIGO = 'ZI';

interface VentaCreada {
  id: string;
  folio: string;
}

describe('Venta del portal contra el inventario del vendedor (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let sucursalId: string;
  let usuarioId: string;
  let cookie: string;
  let productoId: string;
  let litro: string; // "Horchata inv … 1 L", 10.00
  let medio: string; // "… 500 ml", 5.00
  let clienteId: string;
  const vendedorIds: string[] = [];
  const precioIds: string[] = [];

  const ponerControl = (prendido: boolean) =>
    db
      .updateTable('sucursal')
      .set({ control_inventario: prendido })
      .where('id', '=', sucursalId)
      .execute();

  const crearVendedor = async (nombre: string): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-vinv-${vendedorIds.length + 1}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorIds.push(id);
    return id;
  };

  let numeroCarga = 0;
  const crearCarga = async (
    vendedorId: string,
    fecha: string,
    estado: 'pendiente' | 'aceptada',
    lineas: { presentacionId: string; piezas: number }[],
  ) => {
    numeroCarga++;
    const { id } = await db
      .insertInto('carga')
      .values({
        vendedor_id: vendedorId,
        sucursal_id: sucursalId,
        fecha: sql<Date>`${fecha}::date`,
        numero: numeroCarga,
        estado,
        respondida_en: estado === 'pendiente' ? null : sql<Date>`now()`,
        capturo_usuario_id: usuarioId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('carga_detalle')
      .values(
        lineas.map((l) => ({
          carga_id: id,
          presentacion_id: l.presentacionId,
          piezas: l.piezas,
        })),
      )
      .execute();
  };

  const linea = (
    presentacionId: string,
    cantidad: number,
    cantidadPromocion = 0,
  ) => ({ presentacionId, cantidad, cantidadPromocion });

  const cuerpo = (
    fecha: string,
    vendedorId: string | null,
    lineas: ReturnType<typeof linea>[],
  ) => ({
    fecha,
    clienteId,
    vendedorId,
    contadoCredito: 'credito',
    factura: 'N/A',
    lineas,
  });

  const registrar = (
    fecha: string,
    vendedorId: string | null,
    lineas: ReturnType<typeof linea>[],
  ) =>
    request(app.getHttpServer())
      .post('/ventas')
      .set('Cookie', cookie)
      .send(cuerpo(fecha, vendedorId, lineas));

  const editar = (
    id: string,
    vendedorId: string | null,
    lineas: ReturnType<typeof linea>[],
  ) =>
    request(app.getHttpServer())
      .patch(`/ventas/${id}`)
      .set('Cookie', cookie)
      .send({
        vendedorId,
        contadoCredito: 'credito',
        factura: 'N/A',
        lineas,
      });

  const ventasDelDia = (fecha: string) =>
    db
      .selectFrom('venta_nota')
      .select('id')
      .where('cliente_id', '=', clienteId)
      .where(sql<boolean>`fecha = ${fecha}::date`)
      .execute();

  const contadorFolio = async (fecha: string) =>
    (
      await db
        .selectFrom('folio_oficina_contador')
        .select('ultimo')
        .where('sucursal_id', '=', sucursalId)
        .where(sql<boolean>`fecha = ${fecha}::date`)
        .executeTakeFirst()
    )?.ultimo ?? 0;

  const piezasVivas = (ventaId: string) =>
    db
      .selectFrom('venta_nota_detalle')
      .select(['presentacion_id', 'cantidad', 'cantidad_promocion'])
      .where('venta_nota_id', '=', ventaId)
      .where('deleted_at', 'is', null)
      .execute();

  const nombreVendedor = (nombre: string) => `${nombre} ${SUFIJO}`;
  const nombreLitro = () => `Horchata inv ${SUFIJO} 1 L`;
  const nombreMedio = () => `Horchata inv ${SUFIJO} 500 ml`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    sucursalId = (
      await db
        .insertInto('sucursal')
        .values({ codigo: CODIGO, nombre: `Inventario ${SUFIJO}` })
        .onConflict((oc) =>
          oc
            .column('codigo')
            .doUpdateSet({ deleted_at: null, control_inventario: true }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await ponerControl(true);

    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    usuarioId = (
      await db
        .insertInto('usuario')
        .values({
          login: LOGIN_GENERAL,
          nombre: LOGIN_GENERAL,
          password_hash: await app.get(PasswordService).hashear(PASSWORD),
          perfil_id: perfilId,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN_GENERAL, password: PASSWORD })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    cookie = cookies.find((c) => c.startsWith('jawa_access='))!.split(';')[0];

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `Horchata inv ${SUFIJO}` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const presentacion = async (volumen: string) =>
      (
        await db
          .insertInto('presentacion')
          .values({ producto_id: productoId, volumen })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    litro = await presentacion('1 L');
    medio = await presentacion('500 ml');

    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    for (const [presentacionId, precio] of [
      [litro, '10.00'],
      [medio, '5.00'],
    ]) {
      const { id } = await db
        .insertInto('precio')
        .values({
          presentacion_id: presentacionId,
          lista_precio_id: lista.id,
          sucursal_id: sucursalId,
          precio,
          vigente_desde: '2024-01-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      precioIds.push(id);
    }
    clienteId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `Abarrotes inv ${SUFIJO}`,
          domicilio: 'Calle 1',
          telefono: '6640000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          pct_comision: '3.50',
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    const ventas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('cliente_id', '=', clienteId);
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', 'in', ventas)
      .execute();
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', ventas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('cliente_id', '=', clienteId)
      .execute();
    await db
      .deleteFrom('folio_oficina_contador')
      .where('sucursal_id', '=', sucursalId)
      .execute();
    const cargas = db
      .selectFrom('carga')
      .select('id')
      .where('sucursal_id', '=', sucursalId);
    await db
      .deleteFrom('carga_detalle')
      .where('carga_id', 'in', cargas)
      .execute();
    await db
      .deleteFrom('carga')
      .where('sucursal_id', '=', sucursalId)
      .execute();
    await db.deleteFrom('cliente').where('id', '=', clienteId).execute();
    await db.deleteFrom('precio').where('id', 'in', precioIds).execute();
    await db
      .deleteFrom('presentacion')
      .where('producto_id', '=', productoId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db.deleteFrom('vendedor').where('id', 'in', vendedorIds).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await db.deleteFrom('sucursal').where('id', '=', sucursalId).execute();
    await app.close();
  });

  describe('POST /ventas', () => {
    it('con la casilla apagada, todo sigue como antes: vende sin carga', async () => {
      const fecha = '2024-05-01';
      const ana = await crearVendedor('Inv Apagada');
      await ponerControl(false);
      try {
        await registrar(fecha, ana, [linea(litro, 50)]).expect(201);
      } finally {
        await ponerControl(true);
      }
    });

    it('prendida y alcanza (vendidas + regaladas justo lo cargado): pasa', async () => {
      const fecha = '2024-05-02';
      const ana = await crearVendedor('Inv Alcanza');
      await crearCarga(ana, fecha, 'aceptada', [
        { presentacionId: litro, piezas: 10 },
        { presentacionId: medio, piezas: 4 },
      ]);
      await registrar(fecha, ana, [linea(litro, 6, 1)]).expect(201);
      await registrar(fecha, ana, [linea(litro, 3), linea(medio, 4)]).expect(
        201,
      );
    });

    it('no alcanza: 409 con el mensaje, sin venta y sin quemar folio', async () => {
      const fecha = '2024-05-03';
      const ana = await crearVendedor('Inv Falta');
      await crearCarga(ana, fecha, 'aceptada', [
        { presentacionId: litro, piezas: 5 },
      ]);
      await registrar(fecha, ana, [linea(litro, 2)]).expect(201);
      expect(await contadorFolio(fecha)).toBe(1);

      const res = await registrar(fecha, ana, [
        linea(litro, 3, 1),
        linea(medio, 1),
      ]).expect(409);
      expect((res.body as { message: string }).message).toBe(
        `No le alcanza el producto a ${nombreVendedor('Inv Falta')}: ` +
          `${nombreLitro()}, falta 1; ${nombreMedio()}, falta 1.`,
      );
      expect(await ventasDelDia(fecha)).toHaveLength(1);
      expect(await contadorFolio(fecha)).toBe(1);

      // La siguiente que si alcanza toma el folio 2: el 409 no lo quemo.
      const ok = await registrar(fecha, ana, [linea(litro, 3)]).expect(201);
      expect((ok.body as VentaCreada).folio).toMatch(/OF02$/);
    });

    it('una venta de Oficina (sin vendedor) nunca se revisa', async () => {
      await registrar('2024-05-04', null, [linea(litro, 99)]).expect(201);
    });

    it('una carga pendiente no cuenta (ni bloquea): solo la aceptada', async () => {
      const fecha = '2024-05-06';
      const ana = await crearVendedor('Inv Pendiente');
      await crearCarga(ana, fecha, 'aceptada', [
        { presentacionId: litro, piezas: 2 },
      ]);
      await crearCarga(ana, fecha, 'pendiente', [
        { presentacionId: litro, piezas: 20 },
      ]);
      await registrar(fecha, ana, [linea(litro, 2)]).expect(201);
      const res = await registrar(fecha, ana, [linea(litro, 1)]).expect(409);
      expect((res.body as { message: string }).message).toContain(
        `${nombreLitro()}, falta 1`,
      );
    });

    it('dos ventas a la vez que juntas no alcanzan: una pasa y la otra 409, sin 500', async () => {
      const fecha = '2024-05-07';
      const ana = await crearVendedor('Inv Carrera');
      await crearCarga(ana, fecha, 'aceptada', [
        { presentacionId: litro, piezas: 10 },
      ]);
      const [a, b] = await Promise.all([
        registrar(fecha, ana, [linea(litro, 6)]),
        registrar(fecha, ana, [linea(litro, 6)]),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await ventasDelDia(fecha)).toHaveLength(1);
      expect(await contadorFolio(fecha)).toBe(1);
    });
  });

  describe('PATCH /ventas/:id', () => {
    it('subir piezas por encima de lo que trae: 409 y la venta queda igual', async () => {
      const fecha = '2024-05-08';
      const ana = await crearVendedor('Inv Sube');
      await crearCarga(ana, fecha, 'aceptada', [
        { presentacionId: litro, piezas: 10 },
      ]);
      const v = (await registrar(fecha, ana, [linea(litro, 4)]).expect(201))
        .body as VentaCreada;
      await registrar(fecha, ana, [linea(litro, 3)]).expect(201);

      // Sin contar la propia venta hay 7: subir a 7 pasa, a 8 no.
      const res = await editar(v.id, ana, [linea(litro, 7, 1)]).expect(409);
      expect((res.body as { message: string }).message).toBe(
        `No le alcanza el producto a ${nombreVendedor('Inv Sube')}: ${nombreLitro()}, falta 1.`,
      );
      expect(await piezasVivas(v.id)).toEqual([
        { presentacion_id: litro, cantidad: 4, cantidad_promocion: 0 },
      ]);
      await editar(v.id, ana, [linea(litro, 7)]).expect(200);
    });

    it('bajar piezas pasa aunque el vendedor ya este en negativo', async () => {
      const fecha = '2024-05-09';
      const ana = await crearVendedor('Inv Baja');
      await crearCarga(ana, fecha, 'aceptada', [
        { presentacionId: litro, piezas: 2 },
      ]);
      // Vendio de mas con la casilla apagada.
      await ponerControl(false);
      let v: VentaCreada;
      try {
        v = (await registrar(fecha, ana, [linea(litro, 9)]).expect(201))
          .body as VentaCreada;
      } finally {
        await ponerControl(true);
      }
      await editar(v.id, ana, [linea(litro, 5)]).expect(200);
      // Cambiar a otra presentacion sin carga si cuenta.
      await editar(v.id, ana, [linea(litro, 5), linea(medio, 1)]).expect(409);
    });

    it('pasar la venta a otro vendedor revisa la existencia del nuevo', async () => {
      const fecha = '2024-05-10';
      const ana = await crearVendedor('Inv Origen');
      const beto = await crearVendedor('Inv Destino');
      await crearCarga(ana, fecha, 'aceptada', [
        { presentacionId: litro, piezas: 5 },
      ]);
      await crearCarga(beto, fecha, 'aceptada', [
        { presentacionId: litro, piezas: 2 },
      ]);
      const v = (await registrar(fecha, ana, [linea(litro, 5)]).expect(201))
        .body as VentaCreada;
      const res = await editar(v.id, beto, [linea(litro, 5)]).expect(409);
      expect((res.body as { message: string }).message).toBe(
        `No le alcanza el producto a ${nombreVendedor('Inv Destino')}: ${nombreLitro()}, faltan 3.`,
      );
      await editar(v.id, beto, [linea(litro, 2)]).expect(200);
      // A Oficina nunca se revisa.
      await editar(v.id, null, [linea(litro, 40)]).expect(200);
    });
  });
});
