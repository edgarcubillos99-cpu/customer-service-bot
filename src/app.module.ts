import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Conversation } from './common/entities/conversation.entity';
import { Message } from './common/entities/message.entity';
import { TeamsModule } from './teams/teams.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
// ... otros imports

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'database.sqlite',
      entities: [Conversation, Message],
      synchronize: true, // Crea las tablas automáticamente (solo para desarrollo)
    }),
    TeamsModule,
    WhatsappModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
