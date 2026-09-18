import { abrirBaseDatosNode } from '../driver-node';
import { esquemaInicial } from './001-esquema-inicial';
import { sincronizacion } from './002-sincronizacion';
import { folios } from './003-folios';
import { ventas } from './004-ventas';
import { prospectoCamposOpcionales } from './005-prospecto-campos-opcionales';
import { ejecutarMigraciones } from './motor';
import type { BaseDatos } from '../base-datos';

/**
 * La migracion 005 rehace `cliente` para que `domicilio` acepte nulos. Lo que
 * hay que demostrar no es solo que el nulo entre: es que **rehacer la tabla no
 * se lleve nada por delante**. Con las llaves foraneas encendidas (que es como
 * abren los dos drivers) el `drop table` es justo el paso que puede reventar,
 * y hay **tres** tablas que le apuntan: `cliente_precio` y `nota_pendiente`
 * (T-07) y `venta` (T-16).
 */

const HASTA_004 = [esquemaInicial, sincronizacion, folios, ventas] as const;
const TODAS = [...HASTA_004, prospectoCamposOpcionales] as const;

/** Base migrada hasta 004, con un cliente y las tres filas hijas que lo apuntan. */
function baseCon004(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, HASTA_004);

  bd.runSync(
    `insert into sucursal (id, codigo, nombre, sincronizado_en)
     values ('suc-tj', 'TJ', 'Tijuana', '2026-09-14T00:00:00.000Z')`,
  );
  bd.runSync(
    `insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
     values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', '2026-09-14T00:00:00.000Z')`,
  );
  bd.runSync(
    `insert into producto (id, nombre, sincronizado_en)
     values ('pro-1', 'Jamaica', '2026-09-14T00:00:00.000Z')`,
  );
  bd.runSync(
    `insert into presentacion (id, producto_id, volumen, sincronizado_en)
     values ('pre-1', 'pro-1', '1 L', '2026-09-14T00:00:00.000Z')`,
  );
  bd.runSync(
    `insert into cliente
       (id, nombre, domicilio, telefono, encargado, tipo, pct_comision, promocion,
        plazo_credito_dias, lat, lng, sucursal_id, activo, sincronizado_en)
     values
       ('cli-1', 'Abarrotes La Esquina', 'Calle 5 #12', '6641234567', 'Lupita',
        'cliente', 3.5, '10+1', 7, 32.5149, -117.0382, 'suc-tj', 1,
        '2026-09-14T00:00:00.000Z')`,
  );
  bd.runSync(
    `insert into cliente_precio
       (id, cliente_id, presentacion_id, precio_centavos, vigente_desde, activo, sincronizado_en)
     values ('pcl-1', 'cli-1', 'pre-1', 2800, '2026-08-01', 1, '2026-09-14T00:00:00.000Z')`,
  );
  bd.runSync(
    `insert into nota_pendiente
       (id, cliente_id, folio, num_nota, fecha, status, monto_total_centavos,
        saldo_centavos, activo, sincronizado_en)
     values ('nota-1', 'cli-1', 'TJ260801AP01', '1234', '2026-08-01', 'pendiente',
             10000, 10000, 1, '2026-09-14T00:00:00.000Z')`,
  );
  // La venta de T-16 tambien le apunta: es la tercera hija, y la que mas dolería
  // perder (es operacion del vendedor, no catalogo que vuelva a bajar).
  bd.runSync(
    `insert into venta
       (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
        contado_credito, monto_total_centavos, grabada_en)
     values ('vta-1', '2026-09-14', 'cli-1', 'ven-1', 'suc-tj', 'TJ260914AP01',
             '9001', 'contado', 5600, '2026-09-14T18:00:00.000Z')`,
  );
  return bd;
}

function insertarProspectoSinDomicilio(bd: BaseDatos): void {
  bd.runSync(
    `insert into cliente
       (id, nombre, domicilio, telefono, tipo, promocion, sucursal_id, activo, sincronizado_en)
     values ('cli-2', 'Tacos Aaron', null, '6649998877', 'prospecto', 'ninguna',
             'suc-tj', 1, '2026-09-14T00:00:00.000Z')`,
  );
}

describe('migracion 005 (domicilio opcional)', () => {
  it('sin la migracion, un prospecto sin domicilio no entra', () => {
    const bd = baseCon004();
    // Esta es la prueba que falla si alguien quita la migracion: hasta 004 la
    // columna es `not null`, y un snapshot con un prospecto de la app tumbaria
    // la transaccion entera de `guardarSnapshot` — la tablet dejaria de
    // sincronizar del todo, no solo se perderia ese prospecto.
    expect(() => insertarProspectoSinDomicilio(bd)).toThrow(/NOT NULL/i);
  });

  it('con la migracion, un prospecto sin domicilio entra', () => {
    const bd = abrirBaseDatosNode();
    ejecutarMigraciones(bd, TODAS);
    bd.runSync(
      `insert into sucursal (id, codigo, nombre, sincronizado_en)
       values ('suc-tj', 'TJ', 'Tijuana', '2026-09-14T00:00:00.000Z')`,
    );
    insertarProspectoSinDomicilio(bd);

    expect(
      bd.getFirstSync<{ domicilio: string | null }>(
        "select domicilio from cliente where id = 'cli-2'",
      ),
    ).toEqual({ domicilio: null });
  });

  it('rehacer la tabla conserva las filas y sus columnas', () => {
    const bd = baseCon004();
    ejecutarMigraciones(bd, TODAS);

    expect(
      bd.getFirstSync<Record<string, unknown>>("select * from cliente where id = 'cli-1'"),
    ).toEqual({
      id: 'cli-1',
      nombre: 'Abarrotes La Esquina',
      domicilio: 'Calle 5 #12',
      telefono: '6641234567',
      encargado: 'Lupita',
      tipo: 'cliente',
      pct_comision: 3.5,
      promocion: '10+1',
      plazo_credito_dias: 7,
      lat: 32.5149,
      lng: -117.0382,
      sucursal_id: 'suc-tj',
      activo: 1,
      sincronizado_en: '2026-09-14T00:00:00.000Z',
    });
  });

  it('no rompe las llaves foraneas de las tres tablas que apuntan a cliente', () => {
    const bd = baseCon004();
    ejecutarMigraciones(bd, TODAS);

    // 1. Las filas hijas siguen ahi. La venta sobre todo: es operacion del
    //    vendedor, no catalogo que vuelva a bajar en el siguiente pull.
    for (const tabla of ['cliente_precio', 'nota_pendiente', 'venta']) {
      expect(
        bd.getFirstSync<{ n: number }>(`select count(*) as n from ${tabla}`),
      ).toEqual({ n: 1 });
    }

    // 2. Y sus `references` siguen apuntando a `cliente`, no a `cliente_nueva`
    //    ni a un nombre intermedio. Es el fallo silencioso que un `rename` con
    //    las llaves encendidas habria producido (ver `motor.ts`).
    const esquemas = bd.getAllSync<{ name: string; sql: string }>(
      `select name, sql from sqlite_master
        where type = 'table' and name in ('cliente_precio', 'nota_pendiente', 'venta')`,
    );
    expect(esquemas).toHaveLength(3);
    for (const { sql } of esquemas) {
      expect(sql).toMatch(/references cliente\(id\)/);
      expect(sql).not.toMatch(/cliente_nueva/);
    }

    // 3. La llave sigue viva: un hijo huerfano se rechaza.
    expect(() =>
      bd.runSync(
        `insert into cliente_precio
           (id, cliente_id, presentacion_id, precio_centavos, vigente_desde, activo, sincronizado_en)
         values ('pcl-9', 'no-existe', 'pre-1', 100, '2026-08-01', 1, '2026-09-14T00:00:00.000Z')`,
      ),
    ).toThrow(/FOREIGN KEY/i);

    // 4. Y `pragma foreign_key_check` no encuentra nada suelto.
    expect(bd.getAllSync('pragma foreign_key_check;')).toEqual([]);
  });

  it('deja la conexion con las llaves foraneas encendidas otra vez', () => {
    const bd = baseCon004();
    ejecutarMigraciones(bd, TODAS);

    expect(bd.getFirstSync<{ foreign_keys: number }>('pragma foreign_keys;')).toEqual({
      foreign_keys: 1,
    });
  });
});
