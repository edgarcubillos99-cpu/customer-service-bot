// DTO para el webhook de Microsoft Teams
// La estructura del webhook de Teams incluye un objeto 'value' con los datos del mensaje
import { IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class TeamsMessageFrom {
  application?: {
    displayName?: string;
    applicationIdentityType?: string;
    id?: string;
    '@odata.type'?: string;
  };
  user?: {
    displayName?: string;
    id?: string;
  };
  device?: any;
}

class TeamsMessageBody {
  contentType?: string;
  content?: string;
}

class TeamsAttachment {
  id?: string;
  contentType?: string;
  content?: string;
  contentUrl?: string;
  name?: string;
  thumbnailUrl?: string;
}

class TeamsMessageValue {
  id?: string;
  replyToId?: string;
  messageType?: string;
  createdDateTime?: string;
  from?: TeamsMessageFrom;
  body?: TeamsMessageBody;
  attachments?: TeamsAttachment[];
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
