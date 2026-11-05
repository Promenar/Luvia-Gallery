export class ScanLockedError extends Error {
  constructor() { super('媒体库正在全量扫描'); }
}
