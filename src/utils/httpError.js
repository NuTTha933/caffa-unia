class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.expose = true;
    Object.assign(this, extra);
  }
}

module.exports = {
  HttpError,
  badRequest: (message, extra) => new HttpError(400, message, extra),
  validation: (errors, message = 'กรุณาตรวจสอบข้อมูลที่กรอก') => new HttpError(422, message, { errors }),
  forbidden: (message = 'คุณไม่มีสิทธิ์ดำเนินการนี้', extra) => new HttpError(403, message, extra),
  notFound: (message = 'ไม่พบข้อมูลที่ต้องการ') => new HttpError(404, message),
  conflict: (message, extra) => new HttpError(409, message, extra),
};
