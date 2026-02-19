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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { GraphService } from '../teams/graph.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp/webhook')
export class WhatsappController {
  constructor(
    private readonly graphService: GraphService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
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
      console.log('¡Webhook verificado con éxito!');
      return res.status(HttpStatus.OK).send(challenge);
    }

    return res.status(HttpStatus.FORBIDDEN).send('Error de verificación');
  }

  @Post()
  async receiveMessage(@Body() body: any, @Res() res: Response) {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      const from = message.from; // Número de WhatsApp del cliente
      const messageId = message.id;
      const name = value.contacts?.[0]?.profile?.name || from;

      let text = '';
      let mediaId: string | undefined = undefined;
      let mimetype: string | undefined = undefined;
      let fileName: string | undefined = undefined;

      // 1. Clasificamos el tipo de mensaje entrante
      if (message.type === 'text') {
        text = message.text.body;
      } else if (message.type === 'image') {
        mediaId = message.image.id;
        mimetype = message.image.mimetype;
        // Si el cliente envía la foto con un texto al pie, lo capturamos
        text = message.image.caption || '📷 [Imagen enviada]'; 
      } else if (message.type === 'document') {
        mediaId = message.document.id;
        mimetype = message.document.mimetype;
        fileName = message.document.filename;
        text = message.document.caption || `📄 [Documento: ${fileName}]`;
      }

      // 2. Si hay texto o un archivo, se lo pasamos al servicio
      if (text || mediaId) {
        await this.whatsappService.handleIncomingMessage(
          from,
          name,
          text,
          messageId,
          mediaId ?? '',
          mimetype ?? '',
          fileName ?? ''
        ).catch(error => console.error('❌ Error procesando mensaje de WhatsApp:', error));
      }
    }
    return res.status(HttpStatus.OK).send('Mensaje procesado');
  }
}