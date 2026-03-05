import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UbersmithService } from './ubersmith.service';

@Module({
  imports: [ConfigModule],
  providers: [UbersmithService],
  exports: [UbersmithService], // Lo exportamos para usarlo en Graph/Teams
})
export class UbersmithModule {}