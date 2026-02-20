/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { WhatsappResponse } from '../common/whatsapp-response.interface';
import { Observable } from 'rxjs';
import { Conversation } from '../common/entities/conversation.entity';
import { GraphService } from '../teams/graph.service';
import { MediaService } from '../media/media.service';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly token: string;
  private readonly phoneId: string;

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly graphService: GraphService,
    private readonly mediaService: MediaService,
  ) {
    this.token = this.configService.get<string>('whatsappToken') ?? '';
    this.phoneId = this.configService.get<string>('whatsappPhoneId') ?? '';
  }

  async handleIncomingMessage(
    from: string,
    name: string,
    text: string,
    messageId: string,
    mediaId: string,
    mimetype: string,
    fileName: string,
    caption?: string,
  ) {
    try {
      // 1. Verificar duplicados en BD antes de procesar
      const messageExists = await this.messagesService.messageExistsByWaId(messageId);
      if (messageExists) {
        this.logger.debug(`⏭️ Mensaje duplicado ignorado (BD): ${messageId}`);
        return;
      }

      // 2. Buscar o crear conversación
      let conversation = await this.conversationsService.findByPhone(from);
      
      // 3. Procesar media si existe
      let mediaResult: { id: number; publicUrl: string; mimetype: string; fileName: string; base64Data?: string } | null = null;
      
      if (mediaId) {
        this.logger.log(`📎 Procesando archivo: ${mimetype} - ${fileName || 'sin nombre'}`);
        
        const result = await this.mediaService.downloadAndSaveFromWhatsApp(
          mediaId,
          mimetype,
          fileName,
          caption,
          conversation?.id,
        );

        if (result) {
          mediaResult = {
            id: result.id,
            publicUrl: result.publicUrl,
            mimetype: result.mimetype,
            fileName: result.fileName,
            base64Data: result.base64Data, // Incluir base64 para Teams
          };
          this.logger.log(`✅ Archivo guardado: ID=${result.id}, URL=${result.publicUrl}, base64=${result.base64Data ? 'sí' : 'no'}`);
        } else {
          this.logger.warn(`⚠️ No se pudo descargar el archivo de WhatsApp`);
        }
      }

      // 4. Preparar contenido para Teams
      let teamsContent = `<b>${name}:</b> ${text || caption || ''}`;
      
      // Agregar indicador de tipo de media si aplica
      if (mediaResult && !text && !caption) {
        const mediaTypeLabel = this.getMediaTypeLabel(mimetype);
        teamsContent = `<b>${name}:</b> ${mediaTypeLabel}`;
      }

      // 5. Enviar a Teams
      if (conversation && conversation.teamsThreadId) {
        // Responder a un hilo existente
        await this.graphService.replyToThread(
          conversation.teamsThreadId,
          teamsContent,
          mediaResult?.publicUrl,
          mediaResult?.mimetype,
          mediaResult?.fileName,
          mediaResult?.base64Data, // Pasar base64 para mejor compatibilidad
        );
      } else {
        // Crear nuevo hilo
        const result = await this.graphService.sendMessageToChannel(
          name,
          from,
          text || caption || this.getMediaTypeLabel(mimetype),
          mediaResult?.publicUrl,
          mediaResult?.mimetype,
          mediaResult?.fileName,
          mediaResult?.base64Data, // Pasar base64 para mejor compatibilidad
        );

        // Guardar la nueva conversación
        conversation = (await this.conversationsService.create({
          waPhoneNumber: from,
          waCustomerName: name,
          teamsThreadId: result.id,
        })) as Conversation;
      }

      // 6. Guardar el mensaje en la base de datos
      if (!conversation) {
        throw new Error('No se pudo crear o encontrar la conversación');
      }

      await this.messagesService.saveMessage({
        conversationId: conversation.id,
        content: text || caption || this.getMediaTypeLabel(mimetype),
        source: 'whatsapp',
        waMessageId: messageId,
        senderName: name,
      });

      this.logger.log(`✅ Mensaje procesado: ${messageId}`);
    } catch (error: any) {
      this.logger.error(`❌ Error manejando mensaje de WhatsApp: ${error.message}`);
    }
  }

  /**
   * Obtiene una etiqueta descriptiva para el tipo de media
   */
  private getMediaTypeLabel(mimetype: string): string {
    if (mimetype.startsWith('image/webp')) return '🎨 [Sticker]';
    if (mimetype.startsWith('image/')) return '📷 [Imagen]';
    if (mimetype.startsWith('video/')) return '🎬 [Video]';
    if (mimetype.startsWith('audio/')) return '🎵 [Audio]';
    if (mimetype.includes('pdf')) return '📄 [PDF]';
    if (mimetype.startsWith('application/')) return '📎 [Documento]';
    return '📁 [Archivo]';
  }

  /**
   * Envía un mensaje de texto a WhatsApp
   */
  async sendMessage(to: string, message: string): Promise<WhatsappResponse> {
    if (!this.token || !this.phoneId) {
      throw new InternalServerErrorException('WhatsApp API credentials are missing.');
    }

    const url = `https://graph.facebook.com/v18.0/${this.phoneId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      text: { body: message },
    };

    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    try {
      const observable: Observable<AxiosResponse<WhatsappResponse>> =
        this.http.post(url, payload, { headers });

      const response: AxiosResponse<WhatsappResponse> = await lastValueFrom(observable);

      this.logger.log(`✅ Mensaje enviado a WhatsApp: ${to}`);
      return response.data satisfies WhatsappResponse;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: unknown })?.response === 'object'
      ) {
        const axiosError = err as { response?: { data?: unknown }; message?: string };
        this.logger.error('Error enviando WhatsApp:', axiosError.response?.data ?? axiosError.message ?? err);
      } else {
        this.logger.error('Error desconocido enviando WhatsApp:', err);
      }

      throw new InternalServerErrorException('No se pudo enviar el mensaje.');
    }
  }

  /**
   * Envía un archivo multimedia a WhatsApp
   */
  async sendMediaMessage(
    to: string,
    mediaId: number,
    caption?: string,
  ): Promise<boolean> {
    try {
      return await this.mediaService.sendMediaToWhatsApp(to, mediaId, caption);
    } catch (error: any) {
      this.logger.error(`Error enviando media a WhatsApp: ${error.message}`);
      return false;
    }
  }

  /**
   * Envía un mensaje a WhatsApp buscando la conversación por threadId de Teams
   */
  async sendMessageToWhatsappByThreadId(threadId: string, text: string): Promise<void> {
    const conversation = await this.conversationsService.findByThreadId(threadId);
    if (conversation) {
      await this.sendMessage(conversation.waPhoneNumber, text);
    } else {
      this.logger.error(`No se encontró conversación para el hilo: ${threadId}`);
    }
  }

  /**
   * Envía un archivo a WhatsApp buscando la conversación por threadId de Teams
   */
  async sendMediaToWhatsappByThreadId(
    threadId: string,
    mediaId: number,
    caption?: string,
  ): Promise<void> {
    const conversation = await this.conversationsService.findByThreadId(threadId);
    if (conversation) {
      await this.mediaService.sendMediaToWhatsApp(conversation.waPhoneNumber, mediaId, caption);
    } else {
      this.logger.error(`No se encontró conversación para el hilo: ${threadId}`);
    }
  }
}
