/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TurnContext } from 'botbuilder';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { BotMediaService } from './bot-media.service';
import { MediaService } from '../media/media.service';

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);
  private readonly botName: string;

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly configService: ConfigService,
    private readonly botMediaService: BotMediaService,
    private readonly mediaService: MediaService,
  ) {
    this.botName = this.configService.get<string>('teamsBotName') ?? 'botito';
  }

  /**
   * Maneja los mensajes que entran desde Teams (vía Bot Handler)
   */
  async handleIncomingBotMessage(context: TurnContext) {
    const activity = context.activity;

    // 1. Ignorar mensajes del propio Bot
    if (activity.from.role === 'bot') {
      return;
    }

    // Ignorar actividades que no son mensajes
    if (activity.type !== 'message') {
      return;
    }

    const text = this.extractText(activity);
    const threadId = activity.conversation.id;
    const messageId = activity.id;

    // Si no hay texto ni adjuntos, ignorar
    if (!text && (!activity.attachments || activity.attachments.length === 0)) {
      return;
    }

    this.logger.log(`📥 Mensaje recibido de Teams en hilo: ${threadId}`);

    // 2. Buscar la conversación en nuestra BD
    const conversation = await this.conversationsService.findByThreadId(threadId);

    if (!conversation) {
      this.logger.warn(`⚠️ Conversación no encontrada para el hilo ${threadId}`);
      return;
    }

    // 3. Verificar duplicados
    if (!messageId) {
      this.logger.error('El mensaje recibido de Teams no tiene ID');
      return;
    }

    const exists = await this.messagesService.messageExistsByTeamsId(messageId);
    if (exists) {
      this.logger.debug(`⏭️ Mensaje duplicado ignorado: ${messageId}`);
      return;
    }

    try {
      const senderName = activity.from.name || 'Agente Teams';

      // 4. Procesar adjuntos si existen
      const attachments = await this.botMediaService.downloadAllAttachments(context);

      if (attachments.length > 0) {
        // Procesar cada adjunto
        for (const attachment of attachments) {
          this.logger.log(`📎 Procesando adjunto de Teams: ${attachment.name} (${attachment.contentType})`);

          // Guardar en nuestra BD
          const savedMedia = await this.mediaService.saveMedia({
            teamsAttachmentId: `${messageId}_${attachment.name}`,
            conversationId: conversation.id,
            mimetype: attachment.contentType,
            fileName: attachment.name,
            data: attachment.buffer,
            source: 'teams',
          });

          // Enviar a WhatsApp
          const sent = await this.mediaService.sendMediaToWhatsApp(
            conversation.waPhoneNumber,
            savedMedia.id,
            text || undefined, // Usar el texto como caption si existe
          );

          if (sent) {
            this.logger.log(`✅ Archivo enviado a WhatsApp: ${attachment.name}`);
          } else {
            // Si falla el envío del archivo, enviar al menos un mensaje de texto
            this.logger.warn(`⚠️ No se pudo enviar el archivo a WhatsApp, enviando texto`);
            await this.whatsappService.sendMessage(
              conversation.waPhoneNumber,
              `[${senderName}] envió un archivo: ${attachment.name}`,
            );
          }
        }

        // Si también hay texto además de los adjuntos, enviarlo por separado
        if (text && attachments.length === 1) {
          // Ya se envió como caption, no duplicar
        } else if (text && attachments.length > 1) {
          // Múltiples adjuntos, enviar texto por separado
          await this.whatsappService.sendMessage(conversation.waPhoneNumber, text);
        }
      } else if (text) {
        // Solo texto, sin adjuntos
        await this.whatsappService.sendMessage(conversation.waPhoneNumber, text);
        this.logger.log(`✅ Mensaje de texto enviado a WhatsApp: ${conversation.waPhoneNumber}`);
      }

      // 5. Guardar mensaje en BD
      await this.messagesService.saveMessage({
        conversationId: conversation.id,
        content: text || `[${attachments.length} archivo(s) adjunto(s)]`,
        source: 'teams',
        teamsMessageId: messageId,
        senderName: senderName,
      });
    } catch (error: any) {
      this.logger.error(`❌ Error procesando mensaje de Teams: ${error.message}`);
    }
  }

  /**
   * Limpia el texto que viene de Teams (quita etiquetas HTML como <at>Bot</at>)
   */
  private extractText(activity: any): string {
    let text = activity.text || '';

    // Quitar menciones al bot
    text = text.replace(/<at>.*?<\/at>/g, '');
    // Quitar HTML tags
    text = text.replace(/<[^>]*>?/gm, '');
    // Quitar espacios extra
    text = text.replace(/\s+/g, ' ');
    text = text.trim();

    return text;
  }
}
