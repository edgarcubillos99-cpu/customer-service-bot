/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { WhatsappResponse } from '../common/whatsapp-response.interface';
import { Observable } from 'rxjs';
import { GraphService } from 'src/teams/graph.service';
import { Conversation } from '../common/entities/conversation.entity';

@Injectable()
export class WhatsappService {
  private readonly token: string;
  private readonly phoneId: string;

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly graphService: GraphService,
  ) {
    this.token = this.configService.get<string>('whatsappToken') ?? '';
    this.phoneId = this.configService.get<string>('whatsappPhoneId') ?? '';
  }

  async handleIncomingMessage(
    from: string,
    name: string,
    text: string,
    messageId: string,
  ) {
    try {
      // 1. Buscamos si ya existe una conversación ACTIVA (estado OPEN)
      let conversation = await this.conversationsService.findByPhone(from);
      let teamsMessageId: string;

      if (conversation && conversation.teamsThreadId) {
        // CASO A: Conversación EXISTENTE -> Responder al hilo
        console.log(
          `🔄 Retomando hilo existente para ${from}: ${conversation.teamsThreadId}`,
        );

        // Enviamos como "Reply" al hilo existente
        await this.graphService.replyToThread(
          conversation.teamsThreadId,
          text,
          name,
          from,
        );

        await this.conversationsService.update(conversation.id, {
          updatedAt: new Date(),
        });

        // Mantenemos  el mismo ID de hilo para la respuesta
        teamsMessageId = conversation.teamsThreadId;
      } else {
        // CASO B: Conversación NUEVA -> Crear mensaje en el canal (Root Message)
        console.log(`🆕 Creando nueva conversación para ${from}`);

        // Esto usa Graph API para obtener un ID real, no un Webhook
        const result = (await this.graphService.sendMessageToChannel(
          name,
          from,
          text,
        )) as { id: string };
        teamsMessageId = result.id;

        // Guardamos la nueva conversación
        conversation = (await this.conversationsService.create({
          waPhoneNumber: from,
          waCustomerName: name,
          teamsThreadId: teamsMessageId,
        })) as Conversation;
      }

      // 2. Guardamos el mensaje en la base de datos
      if (!conversation) {
        throw new Error('No se pudo crear o encontrar la conversación');
      }

      await this.messagesService.saveMessage({
        conversationId: conversation.id,
        content: text,
        source: 'whatsapp',
        waMessageId: messageId,
        senderName: name,
      });
    } catch (error) {
      console.error('❌ Error manejando mensaje de WhatsApp:', error);
    }
  }

  async sendMessage(to: string, message: string): Promise<WhatsappResponse> {
    if (!this.token || !this.phoneId) {
      throw new InternalServerErrorException(
        'WhatsApp API credentials are missing.',
      );
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
      // Tipado seguro del Observable
      const observable: Observable<AxiosResponse<WhatsappResponse>> =
        this.http.post(url, payload, { headers });

      // Convertir a promesa con tipo seguro
      const response: AxiosResponse<WhatsappResponse> =
        await lastValueFrom(observable);

      // Retorno seguro (WhatsappResponse)
      return response.data satisfies WhatsappResponse;
    } catch (err: unknown) {
      // Manejo de error seguro: validación por tipo
      if (
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: unknown })?.response === 'object'
      ) {
        const axiosError = err as {
          response?: { data?: unknown };
          message?: string;
        };

        console.error(
          'Error enviando WhatsApp:',
          axiosError.response?.data ?? axiosError.message ?? err,
        );
      } else {
        console.error('Error desconocido enviando WhatsApp:', err);
      }

      throw new InternalServerErrorException('No se pudo enviar el mensaje.');
    }
  }
}
