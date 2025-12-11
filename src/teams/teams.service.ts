import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { TeamsResponse } from '../common/teams-response.interface';

@Injectable()
export class TeamsService {
  private readonly botName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsappService: WhatsappService,
  ) {
    this.botName = this.configService.get<string>('teamsBotName') ?? 'botito';
  }

  async processTeamsMessage(body: { text?: string }): Promise<TeamsResponse> {
    const text: string = body?.text ?? '';

    const regex = new RegExp(
      `@${this.botName}\\s+(\\d{6,15})\\s+([\\s\\S]+)`, //formato del mensaje a enviar al whatsapp: '@botname' 'numero del cliente' 'mensaje'
      'i',
    );
    const match = text.match(regex);

    if (!match) {
      return {
        ok: false,
        message: 'No es un comando válido para el bot.',
      };
    }

    const clientNumber = match[1];
    const messageToSend = match[2].trim();

    await this.whatsappService.sendMessage(clientNumber, messageToSend);

    return {
      ok: true,
      sentTo: clientNumber,
      message: messageToSend,
    };
  }
}
