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
import type { Response } from 'express';
import { GraphService } from '../teams/graph.service';
import { ConversationsService } from '../conversations/conversations.service';

@Controller('whatsapp/webhook')
export class WhatsappController {
  constructor(
    private readonly graphService: GraphService,
    private readonly conversationsService: ConversationsService,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const MY_VERIFY_TOKEN = 'e8bf46bbbb8a54d4cce6520f43008a9f5943eb31c4cb343a';

    if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
      console.log('¡Webhook verificado con éxito!');
      return res.status(HttpStatus.OK).send(challenge);
    }

    return res.status(HttpStatus.FORBIDDEN).send('Error de verificación');
  }

  @Post()
  async receiveMessage(@Body() body: any) {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message && message.type === 'text') {
      const from = message.from; // Número de WhatsApp del cliente
      const text = message.text.body; // Mensaje del cliente
      const name = value.contacts?.[0]?.profile?.name || 'Usuario';

      try {
        // 1. Verificar si ya existe una conversación abierta para este número
        const conversation = await this.conversationsService.findByPhone(from);

        if (conversation) {
          // 2. Si existe, respondemos al hilo existente en Teams
          console.log(
            `🧵 Añadiendo mensaje al hilo existente: ${conversation.teamsThreadId}`,
          );
          await this.graphService.replyToThread(
            conversation.teamsThreadId,
            text,
          );
          console.log('✅ Mensaje añadido al hilo de Teams');
        } else {
          // 3. Si no existe, creamos un nuevo hilo principal en Teams
          console.log(`🆕 Creando nuevo hilo para: ${from}`);
          const result = await this.graphService.sendMessageToChannel(
            name,
            from,
            text,
          );

          // 4. Guardamos el ID del mensaje de Teams como el ID del hilo para futuras respuestas
          await this.conversationsService.create({
            waPhoneNumber: from,
            teamsThreadId: result.id,
            waCustomerName: name,
          });
          console.log('✅ Nuevo hilo registrado en BD y Teams');
        }
      } catch (error: any) {
        console.error('❌ Error en la orquestación:', error.message);
      }
    }

    return { status: 'RECEIVED' };
  }
}
