import { Body, Controller, Post } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsResponse } from '../common/teams-response.interface';

@Controller('teams/webhook')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  receive(@Body() body: { text?: string }): Promise<TeamsResponse> {
    return this.teamsService.processTeamsMessage(body);
  }
}
