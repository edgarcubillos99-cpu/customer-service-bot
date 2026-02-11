/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Body,
  Controller,
  Post,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { TeamsService } from './teams.service';
import { TeamsWebhookDto } from './dto/teams-webhook.dto';
import { GraphService } from './graph.service';

@Controller('teams/webhook')
export class TeamsController {
  constructor(
    private readonly teamsService: TeamsService,
    private readonly graphService: GraphService,
  ) {}

  /**
   * Endpoint para recibir notificaciones de Microsoft Graph API
   * Graph API primero valida la URL enviando un validationToken
   */
  @Post('notification')
  @HttpCode(HttpStatus.OK)
  async receiveNotification(
    @Query('validationToken') validationToken: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    // Si hay validationToken, es la verificación inicial de Graph API
    if (validationToken) {
      console.log('✅ Validación de suscripción de Graph API recibida');
      // Graph API espera que devolvamos el token como texto plano
      return res.status(HttpStatus.OK).type('text/plain').send(validationToken);
    }

    // Si no hay validationToken, es una notificación real

    try {
      // Verificar si es una notificación de ciclo de vida de la suscripción
      if (body.lifecycleEvent) {
        console.log('🔄 Notificación de ciclo de vida de suscripción:', {
          lifecycleEvent: body.lifecycleEvent,
          subscriptionId: body.subscriptionId,
          subscriptionExpirationDateTime: body.subscriptionExpirationDateTime,
        });

        // Si la suscripción está por expirar, renovarla automáticamente
        if (body.lifecycleEvent === 'reauthorizationRequired') {
          console.log('⚠️ Suscripción requiere reautorización');
          // Intentar renovar la suscripción
          if (body.subscriptionId) {
            try {
              await this.graphService.renewSubscription(body.subscriptionId);
            } catch (error: any) {
              console.error(
                '❌ Error renovando suscripción automáticamente:',
                error?.message,
              );
            }
          }
        }

        return { status: 'OK' };
      }

      // Las notificaciones de mensajes vienen en body.value como un array de cambios
      const notifications = (
        body as { value?: Array<{ resourceData?: { id?: string } }> }
      ).value;
      if (notifications && Array.isArray(notifications)) {
        for (const notification of notifications) {
          // Cada notificación tiene resourceData con el ID del mensaje
          if (notification.resourceData) {
            await this.teamsService.handleGraphNotification(notification);
          }
        }
      }

      return { status: 'OK' };
    } catch (error: unknown) {
      console.error('❌ Error procesando notificación de Graph API:', error);
      // Retornar 200 para evitar reintentos
      return { status: 'ERROR' };
    }
  }

  /**
   * Endpoint para crear/renovar la suscripción de Graph API
   * Llama a este endpoint después de configurar PUBLIC_URL
   * GET /teams/webhook/subscribe
   */
  @Get('subscribe')
  async createSubscription() {
    try {
      const subscription = (await this.graphService.createSubscription()) as {
        id?: string;
        expirationDateTime?: string;
      };
      return {
        status: 'OK',
        message: 'Suscripción creada exitosamente',
        subscriptionId: subscription?.id,
        expirationDateTime: subscription?.expirationDateTime,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error desconocido';
      return {
        status: 'ERROR',
        message: errorMessage,
      };
    }
  }

  /**
   * Endpoint legacy para webhooks directos (si los usas)
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Body() body: TeamsWebhookDto) {
    // Logging para debugging
    console.log('📥 Webhook de Teams recibido:', JSON.stringify(body, null, 2));

    try {
      await this.teamsService.handleWebhook(body);
      return { status: 'OK', message: 'Webhook procesado correctamente' };
    } catch (error: unknown) {
      console.error('❌ Error procesando webhook de Teams:', error);
      // Retornar 200 para evitar que Teams reintente en caso de errores internos
      // que no se resolverán con reintentos
      const errorMessage =
        error instanceof Error ? error.message : 'Error procesando webhook';
      return {
        status: 'ERROR',
        message: errorMessage,
      };
    }
  }
}
