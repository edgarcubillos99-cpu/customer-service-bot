import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaAttachment } from '../common/entities/media-attachment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([MediaAttachment]),
    HttpModule,
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}

