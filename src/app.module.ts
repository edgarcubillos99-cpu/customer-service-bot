import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config'; // Añadimos ConfigService
import { Conversation } from './common/entities/conversation.entity';
import { Message } from './common/entities/message.entity';
import { MediaAttachment } from './common/entities/media-attachment.entity';
import { BlockedNumber } from './common/entities/blocked-number.entity';
import { TeamsModule } from './teams/teams.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { MediaModule } from './media/media.module';
import { SecurityModule } from './security/security.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { UbersmithModule } from './ubersmith/ubersmith.module';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    
    // Cambiamos forRoot por forRootAsync
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule], // Inyectamos el módulo de configuración
      inject: [ConfigService], // Usamos el servicio para leer las variables
      useFactory: (configService: ConfigService) => ({
        type: 'mysql', // El nuevo motor
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USER', 'root'),
        password: configService.get<string>('DB_PASSWORD', ''),
        database: configService.get<string>('DB_NAME', 'whatsapp_teams_bridge'),
        entities: [Conversation, Message, MediaAttachment, BlockedNumber], //entidades intactas
        synchronize: true, // Crea las tablas automáticamente
      }),
    }),
    
    TeamsModule,
    WhatsappModule,
    MediaModule,
    SecurityModule,
    UbersmithModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
