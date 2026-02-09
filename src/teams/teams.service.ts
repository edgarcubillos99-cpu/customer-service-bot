/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ConversationsService } from '../conversations/conversations.service';
import { TeamsWebhookDto } from './dto/teams-webhook.dto';

@Injectable()
export class TeamsService {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly conversationsService: ConversationsService, // Inyectamos la DB
  ) {}

  async handleWebhook(body: TeamsWebhookDto) {
    const message = body.value;

    // Evitar que el bot se responda a sí mismo
    if (message.from?.application?.displayName === 'TuNombreDeBot') {
      return;
    }

    // 1. Obtener el ID del mensaje padre (Thread ID)
    // En Teams, si es una respuesta, el replyToId nos indica el mensaje raíz
    const threadId = message.replyToId;

    if (threadId) {
      // 2. Buscar en la base de datos a quién pertenece ese hilo
      const conversation =
        await this.conversationsService.findByThreadId(threadId);

      if (conversation) {
        const text = message.body.content.replace(/<[^>]*>?/gm, ''); // Limpiar HTML de Teams

        // 3. Enviar a WhatsApp usando el número guardado
        await this.whatsappService.sendMessage(
          conversation.waPhoneNumber,
          text,
        );
        console.log(
          `✅ Respuesta enviada a WhatsApp: ${conversation.waPhoneNumber}`,
        );
      } else {
        console.log(
          '⚠️ No se encontró una conversación activa para este hilo.',
        );
      }
    }
  }
}
