import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../common/entities/leads.entity';
import { LeadsService } from './leads.service';
import { MetaWebhookController } from './leads.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Lead])],
  controllers: [MetaWebhookController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
