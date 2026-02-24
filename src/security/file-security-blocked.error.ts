/**
 * Se lanza cuando un archivo no supera la validación de seguridad (blocklist o ClamAV).
 */
export class FileSecurityBlockedError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
    public readonly viruses?: string[],
  ) {
    super(message);
    this.name = 'FileSecurityBlockedError';
    Object.setPrototypeOf(this, FileSecurityBlockedError.prototype);
  }
}
