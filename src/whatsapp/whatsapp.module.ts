import { Module, forwardRef } from '@nestjs/common';
import { TeamsModule } from '../teams/teams.module';
import { WhatsappService } from './whatsapp.service';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { WhatsappController } from './whatsapp.controller';

@Module({
  imports: [ConfigModule, HttpModule, forwardRef(() => TeamsModule)],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
