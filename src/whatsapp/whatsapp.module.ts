import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [ConfigModule, HttpModule],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
