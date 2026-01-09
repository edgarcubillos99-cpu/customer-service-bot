// Aquí se blinda la entrada.
// Si recibimos algo que no sea texto, NestJS lo rechazará automáticamente antes de que toque TeamsService
import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class TeamsWebhookDto {
  @IsString({ message: 'El texto debe ser una cadena de caracteres' })
  @IsNotEmpty({ message: 'El cuerpo del mensaje no puede estar vacío' })
  @IsOptional() // Lo ponemos opcional porque a veces Teams envía notificaciones sin texto
  text?: string;
}
