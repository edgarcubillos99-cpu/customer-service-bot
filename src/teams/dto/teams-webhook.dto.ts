// DTO para el webhook de Microsoft Teams
// La estructura del webhook de Teams incluye un objeto 'value' con los datos del mensaje
import { IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class TeamsMessageFrom {
  application?: {
    displayName?: string;
  };
  user?: {
    displayName?: string;
    id?: string;
  };
}

class TeamsMessageBody {
  contentType?: string;
  content?: string;
}

class TeamsMessageValue {
  id?: string;
  replyToId?: string;
  messageType?: string;
  createdDateTime?: string;
  from?: TeamsMessageFrom;
  body?: TeamsMessageBody;
  channelIdentity?: {
    teamId?: string;
    channelId?: string;
  };
}

export class TeamsWebhookDto {
  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => TeamsMessageValue)
  value?: TeamsMessageValue;

  // Permitir otros campos que Teams pueda enviar
  [x: string]: any;
}
