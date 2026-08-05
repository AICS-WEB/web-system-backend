/**
 * @file mailer.js
 * @description nodemailer 기반 SMTP 이메일 발송 유틸리티입니다.
 *              환경변수(SMTP_*)가 설정된 경우에만 실제 전송하며, 미설정 시 예외 없이 경고 로그만 남기고 스킵합니다.
 *              (개발 환경에서 SMTP 없이도 서버가 정상 동작하도록 graceful degradation을 적용합니다.)
 *
 * 필요 환경변수:
 *   SMTP_HOST      - SMTP 서버 호스트 (예: smtp.gmail.com)
 *   SMTP_PORT      - 포트 (예: 587[STARTTLS] / 465[SSL])
 *   SMTP_SECURE    - 'true'면 SSL(465), 아니면 STARTTLS. 미지정 시 포트 465일 때 자동 true.
 *   SMTP_USER      - 인증 계정
 *   SMTP_PASS      - 인증 비밀번호(앱 비밀번호 권장)
 *   SMTP_FROM      - 발신자 표기 (예: "AICS Lab <no-reply@aics.kr>"). 미지정 시 SMTP_USER 사용.
 *   FRONTEND_URL   - 재설정 링크 베이스 URL (예: http://localhost:5173). 미지정 시 CORS_ORIGIN → localhost 순으로 폴백.
 */

const nodemailer = require('nodemailer');

// SMTP 설정 완비 여부. HOST/USER/PASS 가 모두 있어야 실제 전송을 시도합니다.
const isConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

// 트랜스포터는 최초 필요 시 1회 생성하여 재사용합니다(커넥션 풀).
let transporter = null;
function getTransporter() {
  if (!isConfigured) return null;
  if (transporter) return transporter;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === 'true'
    : port === 465; // 465는 암묵적 SSL, 그 외(587 등)는 STARTTLS

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

// 재설정 링크의 프론트엔드 베이스 URL 결정(폴백 포함).
function frontendBaseUrl() {
  return (
    process.env.FRONTEND_URL ||
    (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*' ? process.env.CORS_ORIGIN : null) ||
    'http://localhost:5173'
  );
}

const Mailer = {
  /** SMTP 설정 여부를 노출합니다(컨트롤러가 개발용 토큰 노출 여부 판단 등에 활용). */
  isConfigured,

  /**
   * @function sendMail
   * @description 범용 메일 발송. SMTP 미설정 시 전송을 건너뛰고 { skipped: true }를 반환합니다(예외 없음).
   * @param {Object} p - { to, subject, html, text }
   * @returns {Promise<Object>} 발송 결과 요약
   */
  sendMail: async ({ to, subject, html, text }) => {
    const tx = getTransporter();
    if (!tx) {
      console.warn('[mailer] SMTP 미설정 — 이메일 전송을 건너뜁니다. (to=%s, subject=%s)', to, subject);
      return { skipped: true };
    }
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const info = await tx.sendMail({ from, to, subject, html, text });
    return { skipped: false, messageId: info.messageId };
  },

  /**
   * @function sendPasswordResetEmail
   * @description 비밀번호 재설정 링크를 이메일로 발송합니다. 링크는 프론트 재설정 페이지 + token 쿼리로 구성됩니다.
   * @param {string} to - 수신 이메일
   * @param {string} resetToken - 원문 재설정 토큰
   * @returns {Promise<Object>} 발송 결과
   */
  sendPasswordResetEmail: async (to, resetToken) => {
    const ttlMin = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60);
    const link = `${frontendBaseUrl()}/reset-password?token=${encodeURIComponent(resetToken)}`;
    const subject = '[AICS Lab] 비밀번호 재설정 안내';
    const text =
      `비밀번호 재설정을 요청하셨습니다.\n\n아래 링크에서 새 비밀번호를 설정하세요 (유효시간 ${ttlMin}분):\n${link}\n\n` +
      `본인이 요청하지 않았다면 이 메일을 무시하세요.`;
    const html =
      `<p>비밀번호 재설정을 요청하셨습니다.</p>` +
      `<p>아래 버튼(또는 링크)에서 새 비밀번호를 설정하세요. <b>유효시간 ${ttlMin}분</b>.</p>` +
      `<p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">비밀번호 재설정</a></p>` +
      `<p style="color:#666;font-size:12px;word-break:break-all">${link}</p>` +
      `<hr/><p style="color:#999;font-size:12px">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>`;

    return Mailer.sendMail({ to, subject, html, text });
  },
};

module.exports = Mailer;
