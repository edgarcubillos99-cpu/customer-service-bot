import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsWebhookDto } from './dto/teams-webhook.dto';

@Controller('teams/webhook')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Body() body: TeamsWebhookDto) {
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
