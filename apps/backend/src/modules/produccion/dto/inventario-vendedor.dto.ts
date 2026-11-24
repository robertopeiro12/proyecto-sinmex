import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * `GET /inventario-vendedor`. Que la fecha exista y no sea futura lo comprueba
 * el servicio; `vendedor` es un uuid o `todos` (lo interpreta el servicio).
 */
export class ConsultaInventarioVendedorDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  fecha!: string;

  /** Codigo de sucursal; con `todos` hay que elegir una. */
  @IsOptional()
  @IsString({ message: 'La sucursal no es válida.' })
  sucursal?: string;

  @IsString({ message: 'Elige un vendedor válido.' })
  vendedor!: string;
}
