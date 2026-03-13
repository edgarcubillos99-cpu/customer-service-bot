import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../common/entities/leads.entity';
import { LeadsService } from './leads.service';
import { MetaWebhookController } from './leads.controller';
import { TeamsModule } from '../teams/teams.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead]),
    forwardRef(() => TeamsModule),
  ],
  controllers: [MetaWebhookController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
