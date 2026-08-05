/**
 * @file supabase.js
 * @description Supabase Storage 연동을 위한 클라이언트 설정 모듈입니다.
 *              서명된 업로드 URL 발급에는 service_role 키가 필요하므로, 서버 전용으로만 사용하고 절대 클라이언트에 노출하지 않습니다.
 *              환경변수 미설정 시 클라이언트를 생성하지 않고 isConfigured=false 로만 표시하여 서버가 정상 부팅되도록 합니다.
 *
 * 필요 환경변수:
 *   SUPABASE_URL               - 프로젝트 URL (예: https://xxxx.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY  - service_role 키 (서버 전용, 절대 커밋/노출 금지)
 *   SUPABASE_STORAGE_BUCKET    - 사용할 스토리지 버킷명 (미지정 시 'attachments')
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// URL과 service_role 키가 모두 있어야 스토리지 작업이 가능합니다.
const isConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

// 기본 버킷명
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'attachments';

// 설정된 경우에만 클라이언트를 생성합니다. (auth 세션 유지 불필요 → 옵션 최소화)
const client = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

module.exports = {
  isConfigured,
  bucket: BUCKET,
  client,
  publicBaseUrl: isConfigured ? `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}` : null,
};
