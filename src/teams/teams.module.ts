import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [WhatsappModule, ConfigModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
