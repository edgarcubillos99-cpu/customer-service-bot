import { ActivityHandler, TurnContext } from 'botbuilder';
import { Injectable } from '@nestjs/common';
import { TeamsService } from './teams.service';

@Injectable()
export class TeamsBotHandler extends ActivityHandler {
  constructor(private readonly teamsService: TeamsService) {
    super();

    // Escuchar mensajes (cuando alguien escribe en Teams)
    this.onMessage(async (context, next) => {
      // Pasamos el contexto completo al servicio
      await this.teamsService.handleIncomingBotMessage(context);
      await next();
    });

    this.onMembersAdded(async (context, next) => {
        // Aquí se podría saludar si  se quisiera, por ahora lo ignoramos
        await next();
    });
  }
}