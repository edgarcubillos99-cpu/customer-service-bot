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
import { Conversation } from '../common/entities/conversation.entity';
import { GraphService } from '../teams/graph.service';

@Injectable()
export class WhatsappService {
  private readonly token: string;
  private readonly phoneId: string;

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly botService: GraphService,
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

      // Variable para el contenido final a enviar a Teams
      const finalContent = `<b>${name}:</b> ${text}`;
      const attachmentUrl = undefined;

      if (conversation && conversation.teamsThreadId) {
        // Responder a un hilo existente
        await this.botService.replyToThread(
          conversation.teamsThreadId,
          finalContent,
        );
      } else {
        // Crear nuevo hilo
        const result = await this.botService.sendMessageToChannel(
          name,         // Nombre del cliente
          from,         // Número de teléfono
          text          // El mensaje "Hola hola"
        );

        // Guardamos la nueva conversación
        conversation = (await this.conversationsService.create({
          waPhoneNumber: from,
          waCustomerName: name,
          teamsThreadId: result.id,
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

  // Método nuevo para que TeamsHandler lo llame
  async sendMessageToWhatsappByThreadId(threadId: string, text: string) {
    const conversation =
      await this.conversationsService.findByThreadId(threadId); // Necesitas crear este método
    if (conversation) {
      await this.sendMessage(conversation.waPhoneNumber, text);
    } else {
      console.error('No se encontró conversación para el hilo', threadId);
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
