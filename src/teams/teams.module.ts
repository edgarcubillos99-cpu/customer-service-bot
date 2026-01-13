import { Module, forwardRef } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { GraphService } from './graph.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [forwardRef(() => WhatsappModule), ConfigModule],
  controllers: [TeamsController],
  providers: [TeamsService, GraphService],
  exports: [GraphService],
})
export class TeamsModule {}
