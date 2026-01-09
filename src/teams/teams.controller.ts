import { Body, Controller, Post } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsWebhookDto } from './dto/teams-webhook.dto'; // Importa el DTO

@Controller('teams/webhook')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  // Recibe el body y lo convierte a nuestro DTO
  receive(@Body() body: TeamsWebhookDto) {
    return this.teamsService.processTeamsMessage(body);
  }
}
