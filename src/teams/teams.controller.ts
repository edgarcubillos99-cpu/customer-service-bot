import { Controller, Post, Req, Res } from '@nestjs/common';
import { GraphService } from './graph.service';
import { TeamsBotHandler } from './teams-bot.handler';

@Controller('teams/webhook')
export class TeamsController {
  constructor(
    private readonly graphService: GraphService,
    private readonly botHandler: TeamsBotHandler,
  ) {}

  /**
   * Endpoint ÚNICO para el Bot Framework.
   * Azure Bot Service enviará aquí todos los eventos (mensajes, miembros nuevos, etc.)
   */
  @Post('messages')
  async messages(@Req() req: any, @Res() res: any) {
    // El Adapter procesa la request (autenticación y parsing) y se la pasa al Handler
    await this.graphService.adapter.process(req, res, (context) =>
      this.botHandler.run(context),
    );
  }
}