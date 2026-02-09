/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ConversationsService } from '../conversations/conversations.service';
import { TeamsWebhookDto } from './dto/teams-webhook.dto';
import { Conversation } from '../common/entities/conversation.entity';
import { GraphService } from './graph.service';

@Injectable()
export class TeamsService {
  private readonly botName: string;

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly conversationsService: ConversationsService,
    private readonly configService: ConfigService,
    private readonly graphService: GraphService,
  ) {
    this.botName = this.configService.get<string>('teamsBotName') ?? 'botito';
  }

  async handleWebhook(body: TeamsWebhookDto) {
    console.log('🔍 Procesando webhook de Teams...');
    console.log('📋 Body completo:', JSON.stringify(body, null, 2));

    const message = body.value;

    if (!message) {
      console.log('⚠️ Webhook de Teams recibido sin datos de mensaje');
      console.log('📋 Estructura del body:', Object.keys(body));
      return;
    }

    console.log('📨 Datos del mensaje:', {
      id: message.id,
      replyToId: message.replyToId,
      messageType: message.messageType,
      from: message.from,
      hasBody: !!message.body,
      bodyContent: message.body?.content?.substring(0, 100),
    });

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
    // 2. Si es un mensaje nuevo, buscar por el ID del mensaje mismo
    let conversation: Conversation | null = null;
    const threadId = message.replyToId || message.id;

    if (threadId) {
      conversation = await this.conversationsService.findByThreadId(threadId);
      console.log(
        `🔍 Búsqueda por threadId (${threadId}): ${conversation ? 'Encontrada' : 'No encontrada'}`,
      );
    }

    // Si no encontramos por threadId, intentar extraer el número de teléfono del contenido del mensaje
    // Los mensajes enviados vía webhook incluyen el teléfono en el formato: "Teléfono: 573100000000"
    if (!conversation) {
      console.log('🔍 Intentando extraer número de teléfono del mensaje...');
      const phoneMatch = message.body.content.match(
        /(?:Teléfono|Phone|Tel):\s*(\+?\d{10,15})/i,
      );
      if (phoneMatch && phoneMatch[1]) {
        const extractedPhone = phoneMatch[1].replace(/\D/g, ''); // Solo números
        console.log(`📞 Número extraído: ${extractedPhone}`);
        conversation =
          await this.conversationsService.findByPhone(extractedPhone);
        console.log(
          `🔍 Búsqueda por teléfono (${extractedPhone}): ${conversation ? 'Encontrada' : 'No encontrada'}`,
        );
      }
    }

    // Si aún no encontramos, buscar la conversación más reciente abierta
    // (útil cuando alguien responde directamente en el canal)
    if (!conversation) {
      console.log('🔍 Buscando conversación más reciente abierta...');
      // Necesitamos agregar un método para esto en ConversationsService
      // Por ahora, intentamos con el threadId original si existe
    }

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
        `⚠️ No se encontró conversación activa para el mensaje de Teams`,
      );
      console.log('📋 Detalles del mensaje:', {
        id: message.id,
        replyToId: message.replyToId,
        contentPreview: message.body.content.substring(0, 200),
      });
      console.log(
        '💡 Sugerencia: Asegúrate de que el mensaje sea una respuesta a un mensaje enviado desde WhatsApp, o que el número de teléfono esté visible en el contenido del mensaje.',
      );
    }
  }

  /**
   * Maneja notificaciones de Microsoft Graph API
   * Las notificaciones solo contienen el ID del mensaje, necesitamos obtenerlo completo
   */
  async handleGraphNotification(notification: any) {
    console.log('📨 Procesando notificación de Graph API...');
    console.log('📋 Notificación:', JSON.stringify(notification, null, 2));

    const teamId = this.configService.get<string>('teamsTeamId');
    const channelId = this.configService.get<string>('teamsChannelId');
    const messageId = notification.resourceData?.id;

    if (!teamId || !channelId || !messageId) {
      console.log('⚠️ Notificación incompleta, faltan datos');
      return;
    }

    try {
      // Obtener el mensaje completo usando Graph API
      const message = await this.graphService.getMessage(
        teamId,
        channelId,
        messageId,
      );

      console.log('📨 Mensaje obtenido de Graph API:', {
        id: message.id,
        replyToId: message.replyToId,
        from: message.from,
      });

      // Procesar el mensaje como si fuera un webhook normal
      const webhookBody: TeamsWebhookDto = {
        value: message,
      };

      await this.handleWebhook(webhookBody);
    } catch (error: any) {
      console.error('❌ Error procesando notificación de Graph API:', {
        message: error?.message,
        notification: notification,
      });
    }
  }
}
