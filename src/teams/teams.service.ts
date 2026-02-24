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
import { FileSecurityBlockedError } from '../security/file-security-blocked.error';
import { GraphService } from './graph.service';

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
    private readonly graphService: GraphService,
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

      // Notificar solo si había un archivo real (no text/html del cuerpo) y ninguno se pudo procesar
      const hasRealFileAttachment = activity.attachments?.some(
        (a: { contentType?: string }) => a.contentType !== 'text/html'
      ) ?? false;
      if (hasRealFileAttachment && attachments.length === 0) {
        await this.notifyErrorInTeams(threadId, 'archivo');
      }

      if (attachments.length > 0) {
        // Procesar cada adjunto
        for (const attachment of attachments) {
          this.logger.log(`📎 Procesando adjunto de Teams: ${attachment.name} (${attachment.contentType})`);

          let savedMedia;
          try {
            savedMedia = await this.mediaService.saveMedia({
              teamsAttachmentId: `${messageId}_${attachment.name}`,
              conversationId: conversation.id,
              mimetype: attachment.contentType,
              fileName: attachment.name,
              data: attachment.buffer,
              source: 'teams',
            });
          } catch (err: any) {
            if (err instanceof FileSecurityBlockedError) {
              this.logger.warn(`🚫 Archivo bloqueado: ${attachment.name} - ${err.reason}`);
              await this.whatsappService.sendMessage(
                conversation.waPhoneNumber,
                `[${senderName}] intentó enviar un archivo que fue bloqueado por seguridad. ${err.reason}`,
              );
              continue;
            }
            throw err;
          }

          // Enviar a WhatsApp
          const caption = text && text.trim() !== '' ? text : undefined;
          
          let sent = false;
          try {
            sent = await this.mediaService.sendMediaToWhatsApp(
              conversation.waPhoneNumber,
              savedMedia.id,
              caption
            );
          } catch (e: any) {
             this.logger.error(`Error crítico enviando media: ${e.message}`);
          }

          if (sent) {
            this.logger.log(`✅ Archivo enviado a WhatsApp: ${attachment.name}`);
          } else {
            // Si falla el envío del archivo, enviar al menos un mensaje de texto
            this.logger.warn(`⚠️ No se pudo enviar el archivo a WhatsApp, enviando texto`);
            await this.whatsappService.sendMessage(
              conversation.waPhoneNumber,
              `[${senderName}] te envió un archivo, pero no pudo ser entregado. Archivo: ${attachment.name}`,
            );
            await this.notifyErrorInTeams(threadId, 'archivo');
          }
        }

        // Si también hay texto además de los adjuntos, enviarlo por separado
        if (text && attachments.length === 1) {
          // Ya se envió como caption, no duplicar
        } else if (text && attachments.length > 1) {
          try {
            await this.whatsappService.sendMessage(conversation.waPhoneNumber, text);
          } catch (e: any) {
            this.logger.error(`Error enviando texto a WhatsApp: ${e.message}`);
            await this.notifyErrorInTeams(threadId, 'mensaje');
          }
        }
      } else if (text) {
        // Solo texto, sin adjuntos
        try {
          await this.whatsappService.sendMessage(conversation.waPhoneNumber, text);
          this.logger.log(`✅ Mensaje de texto enviado a WhatsApp: ${conversation.waPhoneNumber}`);
        } catch (e: any) {
          this.logger.error(`Error enviando mensaje a WhatsApp: ${e.message}`);
          await this.notifyErrorInTeams(threadId, 'mensaje');
        }
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
   * Notifica en el hilo de Teams que hubo un error al enviar a WhatsApp (para que el operador lo vea).
   */
  private async notifyErrorInTeams(threadId: string, tipo: 'archivo' | 'mensaje'): Promise<void> {
    try {
      const msg = tipo === 'archivo'
        ? '⚠️ Archivo no enviado a WhatsApp.'
        : '⚠️ Mensaje no enviado a WhatsApp.';
      await this.graphService.replyToThread(threadId, msg);
    } catch (e: any) {
      this.logger.warn(`No se pudo notificar error en Teams: ${e.message}`);
    }
  }

  /**
   * Limpia el texto que viene de Teams (quita etiquetas HTML como <at>Bot</at>)
   */
  private extractText(activity: any): string {
    if (!activity.text) return '';
    let text = activity.text

    // 1. Decodificar entidades HTML básicas que Teams suele inyectar
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    // 2. Quitar menciones al bot (soporta atributos dinámicos como <at id="0">)
    text = text.replace(/<at[^>]*>.*?<\/at>/gi, '');

    // 3. Quitar cualquier otra etiqueta HTML (<p>, <div>, <img>, etc)
    text = text.replace(/<[^>]*>?/gm, '');

    // 4. Quitar espacios extra y limpiar
    text = text.replace(/\s+/g, ' ');
    return text.trim();
  }
}
