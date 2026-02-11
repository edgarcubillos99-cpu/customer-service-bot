import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { ConversationsService } from '../conversations/conversations.service';
import { Conversation } from '../common/entities/conversation.entity';
import { HttpModule } from '@nestjs/axios';
import { TeamsModule } from '../teams/teams.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => TeamsModule),
    MessagesModule,
    // Registramos la entidad para que TypeORM la reconozca
    TypeOrmModule.forFeature([Conversation]),
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService, ConversationsService],
  exports: [WhatsappService, ConversationsService],
})
export class WhatsappModule {}
