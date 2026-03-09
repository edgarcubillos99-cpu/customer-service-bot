import { Controller, Get, Post, Body, Query, HttpCode, HttpStatus, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { LeadsService } from './leads.service';

@Controller('webhooks/meta')
export class MetaWebhookController {
  constructor(private readonly leadsService: LeadsService) {}

  // 1. Verificación del Webhook (Requisito de Meta)
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN; // Configura esto en tu .env

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook de Meta verificado correctamente.');
      return challenge; // Meta espera que le devuelvas este exacto string
    }
    throw new UnauthorizedException('Token de verificación inválido');
  }

  // 2. Recepción de los Leads
  @Post()
  @HttpCode(HttpStatus.OK) // Forzamos el 200 OK inmediato
  handleLeadEvent(@Body() body: any) {
    // Validamos que sea un evento de página
    if (body.object === 'page') {
      this.leadsService.processLeadEvent(body);
      return 'EVENT_RECEIVED';
    }
    throw new NotFoundException('Objeto no soportado');
  }
}