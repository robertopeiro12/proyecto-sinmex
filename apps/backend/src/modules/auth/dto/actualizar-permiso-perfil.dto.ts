import { IsBoolean, IsUUID } from 'class-validator';

export class ActualizarPermisoPerfilDto {
  @IsUUID()
  permisoId!: string;

  @IsBoolean()
  habilitado!: boolean;
}
