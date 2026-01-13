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

@Controller('whatsapp/webhook')
export class WhatsappController {
  constructor(private readonly graphService: GraphService) {}
  // ESTO VALIDA EL WEBHOOK (Solo se ejecuta cuando das clic en "Verificar" en Meta)
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    // Esta clave DEBE ser la misma de el panel de Meta
    const MY_VERIFY_TOKEN = 'clave';

    if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
      console.log('¡Webhook verificado con éxito!');
      return res.status(HttpStatus.OK).send(challenge);
    }

    console.log('Fallo en la verificación del webhook');
    return res.status(HttpStatus.FORBIDDEN).send('Error de verificación');
  }

  // ESTO RECIBE LOS MENSAJES (Se ejecuta cuando envías un mensaje desde un celular)
  @Post()
  async receiveMessage(@Body() body: any) {
    // 1. Verificamos que sea un mensaje de texto real para evitar errores
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message && message.type === 'text') {
      const from = message.from;      // El número de WhatsApp del cliente
      const text = message.text.body; // Lo que escribió (ej: "Hola")
      const name = value.contacts?.[0]?.profile?.name || 'Usuario'; // Su nombre de perfil

      console.log(`📩 Enviando a Teams: ${text}`);

      // ENVIAR A TEAMS
      try {
        await this.graphService.sendMessageToChannel(name, from, text);
        console.log('✅ Mensaje entregado en Teams');
      } catch (error: any) {
        const errorMessage =
          error?.body?.error?.message ||
          error?.message ||
          error?.body ||
          JSON.stringify(error);
        console.error('❌ Error enviando a Teams:', errorMessage);
        if (error?.body?.error) {
          console.error('Detalles del error:', error.body.error);
        }
      }
    }

    // Siempre respondemos 200 OK a Meta para que no reintente enviar el mismo mensaje
    return { status: 'RECEIVED' };
  }
}
