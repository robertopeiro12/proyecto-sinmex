import { BadRequestException } from '@nestjs/common';

export const MOTIVO_FECHA_INEXISTENTE = 'Esa fecha no existe.';

/**
 * `AAAA-MM-DD` que existe en el calendario. El DTO ya comprobo el formato;
 * esto evita que un 30 de febrero llegue a Postgres y salga como 500.
 */
export function exigirFechaReal(fecha: string): void {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    f.getUTCFullYear() !== anio ||
    f.getUTCMonth() !== mes - 1 ||
    f.getUTCDate() !== dia
  ) {
    throw new BadRequestException(MOTIVO_FECHA_INEXISTENTE);
  }
}
