export class PerformanceReportError extends Error {
  status: 400 | 404 | 502;

  constructor(status: 400 | 404 | 502, message: string) {
    super(message);
    this.name = "PerformanceReportError";
    this.status = status;
  }
}
