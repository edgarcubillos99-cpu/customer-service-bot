import { Module, forwardRef } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { GraphService } from './graph.service';
import { TeamsBotHandler } from './teams-bot.handler';
import { BotMediaService } from './bot-media.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MessagesModule } from '../messages/messages.module';
import { MediaModule } from '../media/media.module';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Conversation } from '../common/entities/conversation.entity';
import { BlockedNumber } from '../common/entities/blocked-number.entity';
import { Lead } from '../common/entities/leads.entity';
import { UbersmithModule } from '../ubersmith/ubersmith.module';
import { LeadsModule } from '../leads/leads.module';

@Module({
  imports: [
    forwardRef(() => WhatsappModule),
    MessagesModule,
    MediaModule,
    forwardRef(() => LeadsModule),
    UbersmithModule,
    ConfigModule,
    HttpModule,
    TypeOrmModule.forFeature([Conversation, BlockedNumber, Lead]),
  ],
  controllers: [TeamsController],
  providers: [
    TeamsService,
    GraphService,
    TeamsBotHandler,
    BotMediaService,
  ],
  exports: [GraphService, TeamsService, BotMediaService],
})
export class TeamsModule {}
