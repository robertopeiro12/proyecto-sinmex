import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 013 trae la visita sin venta (T-39): el catalogo de motivos que baja en el
 * pull, la visita local con su foto y la marca de la foto del cliente.
 */

const TS = "'2026-10-17T00:00:00.000Z'";

function baseAlDia(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones);
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${TS});
    insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
      values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', ${TS});
    insert into cliente (id, nombre, domicilio, telefono, tipo, sucursal_id, activo, sincronizado_en)
      values ('cli-1', 'Abarrotes La Esquina', 'Calle 5', '6641234567', 'cliente', 'suc-tj', 1, ${TS});
    insert into motivo_visita (id, nombre, exige_foto, exige_atendio, activo, sincronizado_en)
      values ('mot-1', 'Cerrado', 1, 0, 1, ${TS});
  `);
  return bd;
}

function insertarVisita(bd: BaseDatos, cambios: Record<string, string | number | null>) {
  const fila: Record<string, string | number | null> = {
    id: 'vis-1',
    fecha: '2026-10-17',
    cliente_id: 'cli-1',
    vendedor_id: 'ven-1',
    sucursal_id: 'suc-tj',
    motivo_visita_id: 'mot-1',
    motivo_nombre: 'Cerrado',
    visitada_en: '2026-10-17T18:40:00.000Z',
    lat: 32.5,
    lng: -117,
    direccion_texto: null,
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into visita (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 013: visitas (T-39)', () => {
  it('la 013 es visitas y deja de ser la ultima con la 014 (T-72)', () => {
    expect(migraciones[12]?.nombre).toBe('visitas');
    expect(migraciones[12]?.version).toBe(13);
    expect(versionEsquema(baseAlDia())).toBe(migraciones.length);
  });

  it('una visita con GPS entra pendiente, sin foto y no descartada', () => {
    const bd = baseAlDia();
    insertarVisita(bd, {});
    expect(
      bd.getFirstSync('select sync_estado, foto_local, foto_descartada from visita where id = $id', { $id: 'vis-1' }),
    ).toEqual({ sync_estado: 'pendiente', foto_local: null, foto_descartada: 0 });
  });

  it('sin GPS exige la direccion escrita', () => {
    const bd = baseAlDia();
    expect(() => insertarVisita(bd, { lat: null, lng: null, direccion_texto: '   ' })).toThrow(/CHECK/);
    expect(() => insertarVisita(bd, { lat: null, lng: null, direccion_texto: 'Frente al parque' })).not.toThrow();
  });

  it('lat y lng van juntas', () => {
    const bd = baseAlDia();
    expect(() => insertarVisita(bd, { lng: null, direccion_texto: 'x' })).toThrow(/CHECK/);
  });

  it('el cliente gana foto_subida_en y foto_cache_subida_en, nulas', () => {
    const bd = baseAlDia();
    expect(
      bd.getFirstSync('select foto_subida_en, foto_cache_subida_en from cliente where id = $id', { $id: 'cli-1' }),
    ).toEqual({ foto_subida_en: null, foto_cache_subida_en: null });
  });
});
