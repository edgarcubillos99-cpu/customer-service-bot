import { Module, forwardRef } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { GraphService } from './graph.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Conversation } from '../common/entities/conversation.entity';

@Module({
  imports: [
    forwardRef(() => WhatsappModule),
    ConfigModule,
    HttpModule,
    // Necesario para ConversationsService
    TypeOrmModule.forFeature([Conversation]),
  ],
  controllers: [TeamsController],
  providers: [TeamsService, GraphService],
  exports: [GraphService],
})
export class TeamsModule {}
