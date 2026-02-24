import { Global, Module } from '@nestjs/common';
import { FileSecurityService } from './file-security.service';

@Global()
@Module({
  providers: [FileSecurityService],
  exports: [FileSecurityService],
})
export class SecurityModule {}
