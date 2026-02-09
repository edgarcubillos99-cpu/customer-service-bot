/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ConversationsService } from '../conversations/conversations.service';
import { TeamsWebhookDto } from './dto/teams-webhook.dto';

@Injectable()
export class TeamsService {
  private readonly botName: string;

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly conversationsService: ConversationsService,
    private readonly configService: ConfigService,
  ) {
    this.botName = this.configService.get<string>('teamsBotName') ?? 'botito';
  }

  async handleWebhook(body: TeamsWebhookDto) {
    const message = body.value;

    if (!message) {
      console.log('⚠️ Webhook de Teams recibido sin datos de mensaje');
      return;
    }

    // Evitar que el bot se responda a sí mismo
    const senderName =
      message.from?.application?.displayName || message.from?.user?.displayName;
    if (senderName === this.botName) {
      console.log('⏭️ Mensaje ignorado: proviene del bot mismo');
      return;
    }

    // Validar que el mensaje tenga contenido
    if (!message.body?.content) {
      console.log('⚠️ Mensaje sin contenido, ignorando');
      return;
    }

    // Limpiar HTML del contenido de Teams
    const text = message.body.content.replace(/<[^>]*>?/gm, '').trim();

    if (!text) {
      console.log('⚠️ Mensaje sin texto después de limpiar HTML');
      return;
    }

    // Buscar conversación asociada
    // 1. Si es una respuesta (tiene replyToId), buscar por el ID del mensaje padre
    // 2. Si es un mensaje nuevo, buscar por el ID del mensaje mismo (puede ser un mensaje en un hilo existente)
    const threadId = message.replyToId || message.id;

    if (!threadId) {
      console.log('⚠️ Mensaje sin ID de hilo, ignorando');
      return;
    }

    const conversation =
      await this.conversationsService.findByThreadId(threadId);

    if (conversation) {
      try {
        // Enviar mensaje a WhatsApp
        await this.whatsappService.sendMessage(
          conversation.waPhoneNumber,
          text,
        );
        console.log(
          `✅ Mensaje de Teams enviado a WhatsApp: ${conversation.waPhoneNumber}`,
        );
      } catch (error: any) {
        console.error(
          `❌ Error al enviar mensaje a WhatsApp (${conversation.waPhoneNumber}):`,
          error.message,
        );
        throw error;
      }
    } else {
      console.log(
        `⚠️ No se encontró conversación activa para el mensaje de Teams (ID: ${message.id}, replyToId: ${message.replyToId})`,
      );
      // En un sistema como Roger 365, podrías querer crear una nueva conversación aquí
      // o simplemente ignorar mensajes que no están asociados a conversaciones de WhatsApp
    }
  }
}
