/**
 * @file mailer.js
 * @description 이메일 발송 유틸리티입니다. Resend(HTTP API)를 우선 사용하고, 미설정 시 nodemailer(SMTP)로 폴백합니다.
 *              둘 다 미설정이면 예외 없이 경고 로그만 남기고 스킵합니다(개발 환경 graceful degradation).
 *
 *              Render 등 일부 호스팅은 아웃바운드 SMTP 포트(25/465/587)를 차단하므로,
 *              운영 환경에서는 HTTPS(443) 기반인 Resend API 사용을 권장합니다.
 *
 * 필요 환경변수:
 *   [Resend - 운영 권장]
 *   RESEND_API_KEY - Resend API 키 (https://resend.com/api-keys). 설정 시 이 경로를 우선 사용합니다.
 *   MAIL_FROM      - 발신자 표기 (예: "AICS Lab <no-reply@yourdomain.com>"). Resend는 인증된 도메인 주소만 허용.
 *                    미지정 시 SMTP_FROM → 'AICS Lab <onboarding@resend.dev>'(테스트용) 순으로 폴백.
 *
 *   [SMTP - 로컬/폴백]
 *   SMTP_HOST      - SMTP 서버 호스트 (예: smtp.gmail.com)
 *   SMTP_PORT      - 포트 (예: 587[STARTTLS] / 465[SSL])
 *   SMTP_SECURE    - 'true'면 SSL(465), 아니면 STARTTLS. 미지정 시 포트 465일 때 자동 true.
 *   SMTP_USER      - 인증 계정
 *   SMTP_PASS      - 인증 비밀번호(앱 비밀번호 권장)
 *   SMTP_FROM      - 발신자 표기. 미지정 시 SMTP_USER 사용.
 *
 *   FRONTEND_URL   - 재설정 링크 베이스 URL (예: https://your-app.vercel.app). 미지정 시 CORS_ORIGIN → localhost 순으로 폴백.
 */

const nodemailer = require('nodemailer');

// 발송 경로 판별: Resend 우선, 없으면 SMTP.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const useResend = Boolean(RESEND_API_KEY);
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
// 둘 중 하나라도 준비되면 발송 가능한 상태입니다.
const isConfigured = useResend || smtpConfigured;

// 발신자 표기 결정(폴백 포함).
function fromAddress() {
  return (
    process.env.MAIL_FROM ||
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    'AICS Lab <onboarding@resend.dev>'
  );
}

// SMTP 트랜스포터는 최초 필요 시 1회 생성하여 재사용합니다(커넥션 풀).
// 아웃바운드 SMTP가 막힌 환경에서 무한 대기하지 않도록 타임아웃을 명시합니다.
let transporter = null;
function getTransporter() {
  if (!smtpConfigured) return null;
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
    // 포트 차단 등으로 연결이 멈출 때 무한 대기하지 않도록 타임아웃(밀리초) 설정.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transporter;
}

// Resend HTTP API로 발송. 실패 시 에러를 throw합니다.
async function sendViaResend({ from, to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${payload.message || JSON.stringify(payload)}`);
  }
  return { skipped: false, messageId: payload.id };
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
  /** 발송 설정 여부(Resend 또는 SMTP)를 노출합니다. */
  isConfigured,

  /**
   * @function sendMail
   * @description 범용 메일 발송. Resend 우선, 없으면 SMTP. 둘 다 미설정 시 { skipped: true } 반환(예외 없음).
   * @param {Object} p - { to, subject, html, text }
   * @returns {Promise<Object>} 발송 결과 요약
   */
  sendMail: async ({ to, subject, html, text }) => {
    const from = fromAddress();

    if (useResend) {
      return sendViaResend({ from, to, subject, html, text });
    }

    const tx = getTransporter();
    if (!tx) {
      console.warn('[mailer] 발송 미설정(Resend/SMTP 없음) — 이메일 전송을 건너뜁니다. (to=%s, subject=%s)', to, subject);
      return { skipped: true };
    }
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
