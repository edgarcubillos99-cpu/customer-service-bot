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

    if (message && message.type === 'text') {
      const from = message.from; // Número de WhatsApp del cliente
      const text = message.text.body; // Mensaje del cliente
      const name = value.contacts?.[0]?.profile?.name || from;

      // Delegamos TODO al servicio
      await this.whatsappService.handleIncomingMessage(
        from,
        name,
        text,
        message.id,
      );
    }
    return res.status(HttpStatus.OK).send('Mensaje recibido correctamente');
  }
}
