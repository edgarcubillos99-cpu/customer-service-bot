import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { GraphService } from '../teams/graph.service';
import { ConversationsService } from '../conversations/conversations.service';
import { Conversation } from '../common/entities/conversation.entity';
import { HttpModule } from '@nestjs/axios';
import { TeamsModule } from '../teams/teams.module';

@Module({
  imports: [
    HttpModule,
    TeamsModule,
    // Registramos la entidad para que TypeORM la reconozca
    TypeOrmModule.forFeature([Conversation]),
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService, ConversationsService, GraphService],
})
export class WhatsappModule {}
