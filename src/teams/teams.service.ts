/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TurnContext } from 'botbuilder'; // Importante
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { GraphService } from './graph.service';

@Injectable()
export class TeamsService {
  private readonly botName: string;

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly configService: ConfigService,
    private readonly graphService: GraphService,
  ) {
    this.botName = this.configService.get<string>('teamsBotName') ?? 'botito';
  }

  //Maneja los mensajes que entran desde Teams (vía Bot Handler)
  async handleIncomingBotMessage(context: TurnContext) {
    const activity = context.activity;

    // 1. Ignorar mensajes del propio Bot (para evitar bucles infinitos)
    // El SDK ya filtra muchos, pero verificamos por si acaso
    if (activity.from.role === 'bot') {
      return;
    }

    const text = this.extractText(activity);
    if (!text) return;

    // 2. Identificar el hilo (Conversation ID)
    // En Bot Framework, conversation.id es el equivalente al Thread ID de Teams
    const threadId = activity.conversation.id;
    const messageId = activity.id;

    console.log(`📥 Mensaje recibido de Teams en hilo: ${threadId}`);

    // 3. Buscar la conversación en nuestra BD
    let conversation = await this.conversationsService.findByThreadId(threadId);

    // Fallback: Si no encontramos por hilo, intentar buscar si el hilo cambió
    // (A veces Teams cambia IDs en migraciones, pero es raro en hilos nuevos)
    if (!conversation) {
        // Aquí podría intentar buscar por texto si contiene un teléfono, 
        console.warn(`⚠️ Conversación no encontrada para el hilo ${threadId}`);
        return;
    }

    // 4. Guardar mensaje en BD y Enviar a WhatsApp
    try {
      const senderName = activity.from.name || 'Agente Teams';

      // Verificar duplicados (usando tu lógica de servicio existente)
      if (!messageId) {
        throw new Error('El mensaje recibido de Teams no tiene ID.');
      }
      const exists = await this.messagesService.messageExistsByTeamsId(messageId);
      if (exists) return;

      await this.messagesService.saveMessage({
        conversationId: conversation.id,
        content: text,
        source: 'teams',
        teamsMessageId: messageId,
        senderName: senderName,
      });

      // Enviar a WhatsApp
      await this.whatsappService.sendMessage(
        conversation.waPhoneNumber,
        text,
      );
      console.log(`✅ Reenviado a WhatsApp: ${conversation.waPhoneNumber}`);

    } catch (error: any) {
      console.error('❌ Error procesando mensaje de Teams:', error.message);
    }
  }

  /**
   * Utilidad para limpiar el texto que viene de Teams (quita etiquetas HTML como <at>Bot</at>)
   */
  private extractText(activity: any): string {
    let text = activity.text || '';
    
    // Quitar menciones al bot si las hay (ej: @Bot Hola)
    // Bot Framework suele traer una función removeRecipientMention, 
    // pero una limpieza básica de HTML funciona bien:
    text = text.replace(/<at>.*?<\/at>/g, ''); // Quitar menciones
    text = text.replace(/<[^>]*>?/gm, '');     // Quitar HTML tags
    text = text.trim();

    return text;
  }
}