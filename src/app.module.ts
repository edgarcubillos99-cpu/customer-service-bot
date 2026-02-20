import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Conversation } from './common/entities/conversation.entity';
import { Message } from './common/entities/message.entity';
import { MediaAttachment } from './common/entities/media-attachment.entity';
import { TeamsModule } from './teams/teams.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { MediaModule } from './media/media.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'database.sqlite',
      entities: [Conversation, Message, MediaAttachment],
      synchronize: true, // Crea las tablas automáticamente (solo para desarrollo)
    }),
    TeamsModule,
    WhatsappModule,
    MediaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
