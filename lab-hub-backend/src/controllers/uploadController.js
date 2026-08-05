/**
 * @file uploadController.js
 * @description Supabase Storage 서명된 업로드 URL 발급 컨트롤러입니다. (공지 첨부·지출 영수증 등 파일 업로드용)
 *
 * 흐름(Signed Upload URL 패턴):
 *   1) 프론트가 { filename, folder } 로 서명 URL을 요청
 *   2) 백엔드가 고유 경로(path)를 생성하고 Supabase에서 서명 업로드 URL을 발급
 *   3) 프론트가 반환된 uploadUrl(또는 path+token)로 파일을 Supabase Storage에 직접 PUT 업로드
 *   4) 업로드 성공 후, 반환된 publicUrl(공개 버킷) 또는 path를 공지 attachments / 지출 receipt 메타로 저장
 */

const supa = require('../config/supabase');
const { success, fail } = require('../utils/response');

// 업로드 허용 폴더(경로 최상위 prefix) 화이트리스트 — 임의 경로 주입 방지
const ALLOWED_FOLDERS = ['notices', 'receipts', 'profiles', 'publications', 'misc'];

// 파일명 정규화: 경로 구분자/공백/특수문자를 안전 문자로 치환하여 경로 조작을 차단합니다.
function sanitizeFilename(name) {
  const base = String(name).split(/[\\/]/).pop(); // 디렉터리 성분 제거
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

const UploadController = {
  /**
   * @function createSignedUploadUrl
   * @description [인증 유저] Supabase Storage 서명 업로드 URL을 발급합니다.
   *
   * Body:
   *   - filename (필수) : 원본 파일명
   *   - folder   (선택) : 저장 폴더(prefix). 기본 'misc'. 화이트리스트 검증.
   */
  createSignedUploadUrl: async (req, res) => {
    try {
      // 스토리지 미설정 시, 서버는 살아있되 기능만 503으로 명확히 안내합니다.
      if (!supa.isConfigured) {
        return fail(res, 503, 'Supabase Storage가 설정되지 않았습니다. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수를 설정하세요.');
      }

      const { filename, folder } = req.body || {};
      if (!filename) {
        return fail(res, 400, '업로드할 파일명(filename)은 필수입니다.');
      }

      const folderKey = folder || 'misc';
      if (!ALLOWED_FOLDERS.includes(folderKey)) {
        return fail(res, 400, `허용되지 않은 folder입니다. 허용 값: ${ALLOWED_FOLDERS.join(', ')}.`);
      }

      // 고유 경로: folder/userId/타임스탬프-랜덤-파일명 (충돌 방지 + 소유자 구분)
      const safeName = sanitizeFilename(filename);
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const path = `${folderKey}/${req.user.id}/${unique}-${safeName}`;

      const { data, error } = await supa.client.storage
        .from(supa.bucket)
        .createSignedUploadUrl(path);

      if (error) {
        console.error('[upload] createSignedUploadUrl 실패:', error.message);
        return fail(res, 502, `스토리지 서명 URL 발급에 실패했습니다: ${error.message}`);
      }

      // 공개 버킷일 경우 접근 가능한 publicUrl을 함께 제공(첨부 메타 저장용).
      const publicUrl = `${supa.publicBaseUrl}/${path}`;

      return success(res, {
        bucket: supa.bucket,
        path,                       // 업로드 대상 경로
        uploadUrl: data.signedUrl,  // 프론트가 이 URL로 PUT 업로드 (또는 supabase-js uploadToSignedUrl)
        token: data.token,          // supabase-js uploadToSignedUrl(path, token, file) 사용 시 필요
        publicUrl,                  // 업로드 후 첨부/영수증 메타에 저장할 공개 URL(공개 버킷 기준)
      }, '서명된 업로드 URL이 발급되었습니다.');
    } catch (error) {
      console.error('[upload] 서명 URL 발급 중 서버 예외:', error);
      return fail(res, 500, '서버 오류로 업로드 URL 발급에 실패했습니다.');
    }
  },
};

module.exports = UploadController;
