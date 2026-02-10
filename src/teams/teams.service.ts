/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ConversationsService } from '../conversations/conversations.service';
import { TeamsWebhookDto } from './dto/teams-webhook.dto';
import { Conversation } from '../common/entities/conversation.entity';
import { GraphService } from './graph.service';

@Injectable()
export class TeamsService implements OnModuleInit {
  private readonly botName: string;
  // Cache de mensajes procesados para evitar duplicados
  // Guarda: messageId -> timestamp
  private readonly processedMessages = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutos

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly conversationsService: ConversationsService,
    private readonly configService: ConfigService,
    private readonly graphService: GraphService,
  ) {
    this.botName = this.configService.get<string>('teamsBotName') ?? 'botito';
    
    // Limpiar mensajes antiguos del cache cada minuto
    setInterval(() => {
      this.cleanupProcessedMessages();
    }, 60 * 1000);
  }

  /**
   * Limpia mensajes antiguos del cache de deduplicación
   */
  private cleanupProcessedMessages() {
    const now = Date.now();
    for (const [messageId, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > this.DEDUP_WINDOW_MS) {
        this.processedMessages.delete(messageId);
      }
    }
  }

  /**
   * Verifica si un mensaje ya fue procesado recientemente
   */
  private isMessageProcessed(messageId: string): boolean {
    const timestamp = this.processedMessages.get(messageId);
    if (!timestamp) {
      return false;
    }
    
    // Si el mensaje fue procesado hace menos de 5 minutos, considerarlo duplicado
    const now = Date.now();
    if (now - timestamp < this.DEDUP_WINDOW_MS) {
      return true;
    }
    
    // Si es más antiguo, eliminarlo del cache
    this.processedMessages.delete(messageId);
    return false;
  }

  /**
   * Marca un mensaje como procesado
   */
  private markMessageAsProcessed(messageId: string) {
    this.processedMessages.set(messageId, Date.now());
  }

  /**
   * Se ejecuta automáticamente cuando el módulo se inicializa
   * Intenta crear o renovar la suscripción de Graph API para recibir mensajes de Teams
   */
  async onModuleInit() {
    // Esperar un poco para asegurar que la aplicación esté completamente iniciada
    setTimeout(async () => {
      try {
        console.log('🚀 Inicializando suscripción de Graph API...');
        await this.graphService.ensureSubscription();
      } catch (error: any) {
        console.error(
          '⚠️ No se pudo inicializar la suscripción automáticamente:',
          error?.message,
        );
        console.log(
          '💡 Puedes crear la suscripción manualmente llamando a: GET /teams/webhook/subscribe',
        );
      }
    }, 2000); // Esperar 2 segundos después del inicio
  }

  async handleWebhook(body: TeamsWebhookDto) {
    const message = body.value;

    if (!message || !message.id) {
      return;
    }

    // Verificar si el mensaje ya fue procesado (deduplicación)
    if (this.isMessageProcessed(message.id)) {
      console.log(`⏭️ Mensaje duplicado ignorado: ${message.id}`);
      return;
    }

    // Marcar como procesado antes de continuar
    this.markMessageAsProcessed(message.id);

    // Evitar que el bot se responda a sí mismo
    // Los mensajes del bot pueden venir de:
    // 1. applicationIdentityType: 'office365Connector' (Incoming Webhooks)
    // 2. displayName que coincida con botName
    const isFromBot =
      message.from?.application?.applicationIdentityType ===
        'office365Connector' ||
      message.from?.application?.displayName === this.botName ||
      message.from?.user?.displayName === this.botName;

    if (isFromBot) {
      // Si es un mensaje del bot, intentar actualizar el teamsThreadId de la conversación
      // El mensaje puede tener el número de teléfono en el attachment
      if (message.attachments && message.attachments.length > 0) {
        const attachment = message.attachments[0];
        if (
          attachment.contentType ===
            'application/vnd.microsoft.teams.card.o365connector' &&
          attachment.content
        ) {
          try {
            const cardContent = JSON.parse(attachment.content);
            const fullContent = JSON.stringify(cardContent);
            const phoneMatch = fullContent.match(
              /(?:Teléfono|Phone|Tel)[:\*\s]*(\+?\d{10,15})/i,
            );

            if (phoneMatch && phoneMatch[1] && message.id) {
              const extractedPhone = phoneMatch[1].replace(/\D/g, '');
              const conversation =
                await this.conversationsService.findByPhone(extractedPhone);
              if (conversation && conversation.teamsThreadId?.startsWith('webhook_')) {
                await this.conversationsService.updateThreadId(
                  conversation.id,
                  message.id,
                );
                console.log(
                  `✅ teamsThreadId actualizado para ${extractedPhone}: ${message.id}`,
                );
              }
            }
          } catch (e) {
            // Ignorar errores al procesar mensajes del bot
          }
        }
      }

      return;
    }

    // Extraer texto del mensaje
    // Los mensajes pueden tener el texto en:
    // 1. body.content (mensajes normales)
    // 2. attachments[0].content (mensajes enviados vía webhook como JSON)
    let text = '';

    // Primero intentar desde body.content
    if (message.body?.content) {
      text = message.body.content.replace(/<[^>]*>?/gm, '').trim();
    }

    // Si no hay texto y hay attachments, intentar extraer de attachments
    if (!text && message.attachments && message.attachments.length > 0) {
      const attachment = message.attachments[0];
      if (
        attachment.contentType ===
          'application/vnd.microsoft.teams.card.o365connector' &&
        attachment.content
      ) {
        try {
          const cardContent = JSON.parse(attachment.content);
          // El texto puede estar en 'text' o 'summary'
          text = (cardContent.text || cardContent.summary || '')
            .replace(/<[^>]*>?/gm, '')
            .trim();
        } catch (e) {
          console.log('⚠️ No se pudo parsear el contenido del attachment');
        }
      }
    }

    if (!text) {
      console.log('⚠️ Mensaje sin texto extraíble');
      return;
    }

    // Buscar conversación asociada
    // 1. Si es una respuesta (tiene replyToId), buscar por el ID del mensaje padre
    // 2. Si es un mensaje nuevo, buscar por el ID del mensaje mismo
    let conversation: Conversation | null = null;
    
    // Para replies, usar replyToId (ID del mensaje padre)
    // Para mensajes nuevos, usar el ID del mensaje mismo
    const threadId = message.replyToId || message.id;

    if (threadId) {
      conversation = await this.conversationsService.findByThreadId(threadId);
      
      // Si no encontramos y es una reply, también intentar buscar por el ID del mensaje actual
      if (
        !conversation &&
        message.replyToId &&
        message.id &&
        message.id !== message.replyToId
      ) {
        conversation = await this.conversationsService.findByThreadId(
          message.id,
        );
      }
    }

    // Si no encontramos por threadId, intentar extraer el número de teléfono del contenido del mensaje
    if (!conversation) {
      const contentToSearch = text || message.body?.content || '';
      const phoneMatch = contentToSearch.match(
        /(?:Teléfono|Phone|Tel):\s*(\+?\d{10,15})/i,
      );
      if (phoneMatch && phoneMatch[1]) {
        const extractedPhone = phoneMatch[1].replace(/\D/g, '');
        conversation =
          await this.conversationsService.findByPhone(extractedPhone);
      }
    }

    // Si aún no encontramos y es una reply, intentar obtener el mensaje padre
    if (!conversation && message.replyToId) {
      try {
        const teamId = this.configService.get<string>('teamsTeamId');
        const channelId = this.configService.get<string>('teamsChannelId');
        if (teamId && channelId) {
          const parentMessage = await this.graphService.getMessage(
            teamId,
            channelId,
            message.replyToId,
          );

          if (parentMessage.attachments && parentMessage.attachments.length > 0) {
            const attachment = parentMessage.attachments[0];
            if (
              attachment.contentType ===
                'application/vnd.microsoft.teams.card.o365connector' &&
              attachment.content
            ) {
              try {
                const cardContent = JSON.parse(attachment.content);
                const fullContent = JSON.stringify(cardContent);
                const phoneMatch = fullContent.match(
                  /(?:Teléfono|Phone|Tel)[:\*\s]*(\+?\d{10,15})/i,
                );

                if (phoneMatch && phoneMatch[1]) {
                  const extractedPhone = phoneMatch[1].replace(/\D/g, '');
                  conversation =
                    await this.conversationsService.findByPhone(extractedPhone);
                  if (conversation) {
                    // Actualizar el teamsThreadId con el ID real del mensaje padre
                    await this.conversationsService.updateThreadId(
                      conversation.id,
                      message.replyToId,
                    );
                  }
                }
              } catch (e) {
                // Ignorar errores de parsing
              }
            }
          }
        }
      } catch (error: any) {
        // Ignorar errores al obtener mensaje padre
      }
    }

    // Si aún no encontramos, buscar la conversación más reciente abierta
    if (!conversation) {
      conversation = await this.conversationsService.findMostRecentOpen();
    }

    if (conversation) {
      try {
        await this.whatsappService.sendMessage(
          conversation.waPhoneNumber,
          text,
        );
        console.log(
          `✅ Mensaje enviado a WhatsApp: ${conversation.waPhoneNumber}`,
        );
      } catch (error: any) {
        console.error(
          `❌ Error enviando a WhatsApp (${conversation.waPhoneNumber}):`,
          error.message,
        );
        throw error;
      }
    }
  }

  /**
   * Maneja notificaciones de Microsoft Graph API
   * Las notificaciones solo contienen el ID del mensaje, necesitamos obtenerlo completo
   */
  async handleGraphNotification(notification: any) {
    const teamId = this.configService.get<string>('teamsTeamId');
    const channelId = this.configService.get<string>('teamsChannelId');
    const messageId = notification.resourceData?.id;
    const resource = notification.resource || '';

    if (!teamId || !channelId || !messageId) {
      return;
    }

    try {
      // Detectar si es una reply (respuesta) desde el resource path
      const isReply = resource.includes('/replies(');
      let message;

      if (isReply) {
        // Extraer el ID del mensaje padre del resource path
        const parentMessageMatch = resource.match(/messages\('([^']+)'\)/);
        const parentMessageId = parentMessageMatch ? parentMessageMatch[1] : null;

        if (parentMessageId) {
          message = await this.graphService.getReply(
            teamId,
            channelId,
            parentMessageId,
            messageId,
          );
        } else {
          return;
        }
      } else {
        // Es un mensaje normal
        message = await this.graphService.getMessage(
          teamId,
          channelId,
          messageId,
        );
      }

      // Filtrar mensajes muy antiguos (más de 5 minutos)
      // Esto evita procesar mensajes antiguos cuando se crea la suscripción
      if (message.createdDateTime) {
        const messageDate = new Date(message.createdDateTime);
        const now = new Date();
        const minutesDiff = (now.getTime() - messageDate.getTime()) / (1000 * 60);
        
        if (minutesDiff > 5) {
          console.log(
            `⏭️ Mensaje ignorado: muy antiguo (${minutesDiff.toFixed(1)} minutos)`,
          );
          return;
        }
      }

      // Procesar el mensaje como si fuera un webhook normal
      // La deduplicación se hace en handleWebhook
      const webhookBody: TeamsWebhookDto = {
        value: message,
      };

      await this.handleWebhook(webhookBody);
    } catch (error: any) {
      console.error('❌ Error procesando notificación de Graph API:', {
        message: error?.message,
      });
    }
  }
}
