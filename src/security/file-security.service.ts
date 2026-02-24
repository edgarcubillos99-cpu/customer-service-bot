import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

export interface FileCheckResult {
  allowed: boolean;
  reason?: string;
  /** Solo presente si ClamAV detectó malware */
  viruses?: string[];
}

/** Extensiones bloqueadas (ejecutables y scripts peligrosos) */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'scr', 'pif', 'vbs', 'vbe', 'js', 'jse', 'ws', 'wsh', 'ps1', 'psm1',
  'apk', 'app', 'deb', 'rpm', 'dmg', 'pkg', 'run', 'sh', 'bash', 'csh', 'out', 'elf', 'so', 'dll',
  'jar', 'class', 'pyc', 'pyo', 'scr', 'hta', 'cpl', 'msc', 'gadget', 'application', 'paf', 'reg',
  'inf', 'vb', 'vba', 'wsf', 'wsc', 'scf', 'lnk', 'url', 'library-ms', 'ade', 'adp', 'bas', 'chm',
  'hlp', 'jse', 'mst', 'sct', 'shb', 'vbscript', 'wsc', 'wsf',
]);

/** Tipos MIME bloqueados */
const BLOCKED_MIME_PATTERNS: (string | RegExp)[] = [
  'application/x-msdownload',           // .exe
  'application/x-msdos-program',
  'application/vnd.microsoft.portable-executable',
  'application/vnd.android.package-archive', // .apk
  'application/x-debian-package',      // .deb
  'application/x-rpm',                 // .rpm
  'application/x-executable',
  'application/x-sharedlib',           // .so
  'application/java-archive',          // .jar (ejecutable)
  'application/x-msi',
  'application/x-ms-shortcut',
  'text/vbscript',
  'text/x-vb',
  'application/x-javascript',
  'application/javascript',
  /^application\/x-executable/,
  /^application\/x-sharedlib/,
  /^application\/x-msdownload/,
  /^application\/vnd\.microsoft\.portable-executable/,
];

@Injectable()
export class FileSecurityService {
  private readonly logger = new Logger(FileSecurityService.name);
  private clamScan: any = null;
  private clamavEnabled = false;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.clamavEnabled = this.configService.get<string>('ENABLE_CLAMAV') === 'true';
  }

  /**
   * Verifica si un archivo es seguro: blocklist por extensión/MIME y opcionalmente ClamAV.
   * No afecta archivos permitidos (imágenes, PDF, Office, etc.).
   */
  async check(buffer: Buffer, mimetype: string, fileName?: string): Promise<FileCheckResult> {
    const ext = this.getExtension(fileName);
    const mime = (mimetype || '').toLowerCase().split(';')[0].trim();

    // 1) Blocklist por extensión
    if (ext && BLOCKED_EXTENSIONS.has(ext.toLowerCase())) {
      this.logger.warn(`🚫 Archivo bloqueado por extensión no permitida: .${ext}`);
      return { allowed: false, reason: `Tipo de archivo no permitido (.${ext}). Por seguridad no se aceptan ejecutables.` };
    }

    // 2) Blocklist por MIME
    for (const pattern of BLOCKED_MIME_PATTERNS) {
      const matches = typeof pattern === 'string'
        ? mime === pattern
        : pattern.test(mime);
      if (matches) {
        this.logger.warn(`🚫 Archivo bloqueado por tipo MIME no permitido: ${mimetype}`);
        return { allowed: false, reason: 'Tipo de archivo no permitido. Por seguridad no se aceptan ejecutables.' };
      }
    }

    // 3) Opcional: verificación con file-type de que el contenido coincida (evitar .exe renombrado a .pdf)
    const realMime = await this.detectMimeFromBuffer(buffer);
    if (realMime && this.isBlockedMime(realMime)) {
      this.logger.warn(`🚫 Archivo bloqueado: contenido real (${realMime}) no coincide con tipo declarado`);
      return { allowed: false, reason: 'El contenido del archivo no es permitido.' };
    }

    // 4) ClamAV (si está habilitado)
    if (this.clamavEnabled && buffer.length > 0) {
      const clamResult = await this.scanWithClamAv(buffer);
      if (!clamResult.allowed) {
        return clamResult;
      }
    }

    return { allowed: true };
  }

  private getExtension(fileName?: string): string | null {
    if (!fileName) return null;
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1 || lastDot === fileName.length - 1) return null;
    return fileName.slice(lastDot + 1);
  }

  private isBlockedMime(mime: string): boolean {
    const lower = mime.toLowerCase();
    for (const pattern of BLOCKED_MIME_PATTERNS) {
      if (typeof pattern === 'string' && lower === pattern) return true;
      if (pattern instanceof RegExp && pattern.test(lower)) return true;
    }
    return false;
  }

  /** Detecta MIME real del buffer (file-type) para evitar archivos renombrados */
  private async detectMimeFromBuffer(buffer: Buffer): Promise<string | null> {
    try {
      const fileType = await import('file-type');
      const result = await fileType.default.fromBuffer(buffer);
      return result?.mime ?? null;
    } catch {
      return null;
    }
  }

  private async getClamScan(): Promise<any> {
    if (this.clamScan) return this.clamScan;
    if (!this.initPromise) {
      this.initPromise = this.initClamAv();
    }
    await this.initPromise;
    return this.clamScan;
  }

  private async initClamAv(): Promise<void> {
    if (!this.clamavEnabled) return;
    try {
      const NodeClam = await import('clamscan');
      const useDaemon = this.configService.get<string>('CLAMAV_USE_DAEMON') === 'true';
      const options: any = {
        debugMode: false,
        removeInfected: false,
      };
      if (useDaemon) {
        options.clamdscan = {
          socket: this.configService.get<string>('CLAMAV_SOCKET') || undefined,
          host: this.configService.get<string>('CLAMAV_HOST') || '127.0.0.1',
          port: this.configService.get<number>('CLAMAV_PORT') ?? 3310,
          bypassTest: true,
        };
      } else {
        options.clamscan = {
          path: this.configService.get<string>('CLAMAV_PATH') || '/usr/bin/clamscan',
          scanArchives: true,
        };
      }
      const instance = await new NodeClam.default().init(options);
      this.clamScan = instance;
      this.logger.log('ClamAV inicializado correctamente');
    } catch (err: any) {
      this.logger.warn(`ClamAV no disponible (se usará solo blocklist): ${err.message}`);
      this.clamavEnabled = false;
    }
  }

  private async scanWithClamAv(buffer: Buffer): Promise<FileCheckResult> {
    const clam = await this.getClamScan();
    if (!clam) return { allowed: true };

    const useDaemon = this.configService.get<string>('CLAMAV_USE_DAEMON') === 'true';

    try {
      if (useDaemon) {
        const stream = Readable.from(buffer);
        const result = await clam.scanStream(stream);
        if (result.isInfected === true) {
          this.logger.warn(`🚫 ClamAV: archivo infectado - ${(result.viruses || []).join(', ')}`);
          return {
            allowed: false,
            reason: 'El archivo ha sido detectado como potencialmente malicioso.',
            viruses: result.viruses || [],
          };
        }
        if (result.isInfected === null) {
          this.logger.warn('ClamAV no pudo escanear el archivo, se permite por defecto');
        }
        return { allowed: true };
      }

      // Modo binario: escribir a temp y escanear
      const tmpFile = join(tmpdir(), `clam_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      await writeFile(tmpFile, buffer);
      try {
        const result = await clam.isInfected(tmpFile);
        if (result.isInfected === true) {
          this.logger.warn(`🚫 ClamAV: archivo infectado - ${(result.viruses || []).join(', ')}`);
          return {
            allowed: false,
            reason: 'El archivo ha sido detectado como potencialmente malicioso.',
            viruses: result.viruses || [],
          };
        }
        if (result.isInfected === null) {
          this.logger.warn('ClamAV no pudo escanear el archivo, se permite por defecto');
        }
        return { allowed: true };
      } finally {
        await unlink(tmpFile).catch(() => {});
      }
    } catch (err: any) {
      this.logger.warn(`Error al escanear con ClamAV: ${err.message}. Se permite el archivo.`);
      return { allowed: true };
    }
  }
}
