import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1, { message: 'El login es obligatorio.' })
  login!: string;

  @IsString()
  @MinLength(1, { message: 'La contrasena es obligatoria.' })
  password!: string;
}
