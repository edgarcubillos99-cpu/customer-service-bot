/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  HttpStatus,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { WhatsappService } from './whatsapp.service';

/**
 * Interfaz para datos de media extraídos del webhook
 */
interface ExtractedMedia {
  mediaId: string;
  mimetype: string;
  fileName?: string;
  caption?: string;
}

/**
 * Cache en memoria para evitar procesar el mismo mensaje dos veces
 * WhatsApp puede enviar el mismo webhook múltiples veces
 */
const processedMessagesCache = new Set<string>();
const MAX_CACHE_SIZE = 1000;
const CACHE_CLEANUP_THRESHOLD = 800;

@Controller('whatsapp/webhook')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsappService: WhatsappService,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const verifyToken = this.configService.get<string>('whatsappverifyToken');
    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('✅ Webhook verificado con éxito!');
      return res.status(HttpStatus.OK).send(challenge);
    }
    return res.status(HttpStatus.FORBIDDEN).send('Error de verificación');
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receiveMessage(@Body() body: any, @Res() res: Response) {
    // Responder inmediatamente a WhatsApp para evitar reintentos
    res.status(HttpStatus.OK).send('OK');

    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      // FILTRO PARA IGNORAR EL NÚMERO DE PRUEBAS
      const incomingPhoneNumberId = value?.metadata?.phone_number_id;
      const productionPhoneId = this.configService.get<string>('whatsappPhoneId');

      if (incomingPhoneNumberId && productionPhoneId && incomingPhoneNumberId !== productionPhoneId) {
        this.logger.debug(`⏭️ Webhook ignorado: dirigido al número ${incomingPhoneNumberId} (Diferente al de producción)`);
        return; // Detenemos la ejecución aquí, no hacemos nada más
      }

      // Solo notificaciones de estado (sin mensaje entrante): delivered, read, etc.
      const hasIncomingMessages = Array.isArray(value?.messages) && value.messages.length > 0;
      if (value?.statuses && !hasIncomingMessages) {
        return;
      }

      const message = value?.messages?.[0];
      if (!message) {
        return;
      }

      const messageId = message.id;

      // Verificación rápida de duplicados en cache
      if (this.isMessageProcessed(messageId)) {
        this.logger.debug(`⏭️ Mensaje duplicado ignorado (cache): ${messageId}`);
        return;
      }

      // Marcar como procesado inmediatamente
      this.markMessageAsProcessed(messageId);

      const from = message.from;
      const name = value.contacts?.[0]?.profile?.name || from;
      const timestamp = message.timestamp;

      // Verificar que el mensaje no sea muy antiguo (más de 5 minutos)
      const messageTime = parseInt(timestamp) * 1000;
      const now = Date.now();
      const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000; // 5 minutos

      if (now - messageTime > MAX_MESSAGE_AGE_MS) {
        this.logger.warn(`⏭️ Mensaje antiguo ignorado: ${messageId} (${Math.round((now - messageTime) / 1000)}s de antigüedad)`);
        return;
      }

      // Extraer contenido del mensaje según su tipo
      const { text, media } = this.extractMessageContent(message);

      if (!text && !media) {
        this.logger.warn(`⚠️ Tipo de mensaje no soportado: ${message.type}`);
        return;
      }

      this.logger.log(`📥 Mensaje de ${name} (${from}): ${text?.substring(0, 50) || '[Media]'}...`);

      // Procesar el mensaje
      await this.whatsappService.handleIncomingMessage(
        from,
        name,
        text || '',
        messageId,
        media?.mediaId || '',
        media?.mimetype || '',
        media?.fileName || '',
        media?.caption,
      );
    } catch (error: any) {
      this.logger.error('❌ Error procesando mensaje de WhatsApp:', error.message);
    }
  }

  /**
   * Extrae el contenido del mensaje según su tipo
   */
  private extractMessageContent(message: any): { text?: string; media?: ExtractedMedia } {
    const type = message.type;

    switch (type) {
      case 'text':
        return {
          text: message.text?.body,
        };

      case 'image':
        return {
          text: message.image?.caption,
          media: {
            mediaId: message.image?.id,
            mimetype: message.image?.mimetype || 'image/jpeg',
            caption: message.image?.caption,
          },
        };

      case 'video':
        return {
          text: message.video?.caption,
          media: {
            mediaId: message.video?.id,
            mimetype: message.video?.mimetype || 'video/mp4',
            caption: message.video?.caption,
          },
        };

      case 'audio':
        return {
          text: '🎵 [Audio recibido]',
          media: {
            mediaId: message.audio?.id,
            mimetype: message.audio?.mimetype || 'audio/ogg',
          },
        };

      case 'voice':
        return {
          text: '🎤 [Nota de voz]',
          media: {
            mediaId: message.voice?.id,
            mimetype: message.voice?.mimetype || 'audio/ogg; codecs=opus',
          },
        };

      case 'document':
        return {
          text: message.document?.caption || `📄 [Documento: ${message.document?.filename || 'archivo'}]`,
          media: {
            mediaId: message.document?.id,
            mimetype: message.document?.mimetype || 'application/octet-stream',
            fileName: message.document?.filename,
            caption: message.document?.caption,
          },
        };

      case 'sticker':
        return {
          text: '🎨 [Sticker]',
          media: {
            mediaId: message.sticker?.id,
            mimetype: message.sticker?.mimetype || 'image/webp',
          },
        };

      case 'location':
        const lat = message.location?.latitude;
        const lng = message.location?.longitude;
        const locationName = message.location?.name || '';
        const address = message.location?.address || '';
        return {
          text: `📍 Ubicación: ${locationName} ${address}\nCoordenadas: ${lat}, ${lng}\nhttps://maps.google.com/?q=${lat},${lng}`,
        };

      case 'contacts':
        const contacts = message.contacts || [];
        const contactInfo = contacts
          .map((c: any) => `👤 ${c.name?.formatted_name || 'Contacto'}: ${c.phones?.[0]?.phone || 'Sin teléfono'}`)
          .join('\n');
        return {
          text: contactInfo || '👤 [Contacto compartido]',
        };

      case 'reaction':
        // Las reacciones no necesitan ser reenviadas
        return {};

      // Quick reply en templates (Meta): type "button", no "interactive"
      case 'button': {
        const btn = message.button;
        const label = btn?.text || btn?.payload;
        return label ? { text: String(label) } : {};
      }

      case 'interactive':
        // Respuestas a botones/listas (mensajes interactivos estándar)
        const interactiveType = message.interactive?.type;
        if (interactiveType === 'button_reply') {
          const br = message.interactive?.button_reply;
          const t = br?.title || br?.id;
          return t ? { text: String(t) } : { text: '[Botón]' };
        }
        if (interactiveType === 'list_reply') {
          const lr = message.interactive?.list_reply;
          const t = lr?.title || lr?.id;
          return t ? { text: String(t) } : { text: '[Lista]' };
        }
        return { text: '[Respuesta interactiva]' };

      default:
        this.logger.warn(`Tipo de mensaje desconocido: ${type}`);
        return {};
    }
  }

  /**
   * Verifica si un mensaje ya fue procesado
   */
  private isMessageProcessed(messageId: string): boolean {
    return processedMessagesCache.has(messageId);
  }

  /**
   * Marca un mensaje como procesado
   */
  private markMessageAsProcessed(messageId: string): void {
    // Limpiar cache si está muy lleno
    if (processedMessagesCache.size > CACHE_CLEANUP_THRESHOLD) {
      const entries = Array.from(processedMessagesCache);
      const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE / 2);
      toRemove.forEach((id) => processedMessagesCache.delete(id));
      this.logger.debug(`🧹 Cache de mensajes limpiado: ${toRemove.length} entradas eliminadas`);
    }

    processedMessagesCache.add(messageId);
  }
}
