/**
 * @file filesModel.js
 * @description 파일 공유(shared_files) 도메인의 데이터 액세스 레이어.
 *              이번 범위에서는 storage_type='drive'만 지원하며, file_url(외부 링크)로 파일을 참조합니다.
 *              filepath(NAS) 저장 흐름은 스키마에는 존재하지만 컨트롤러/모델 진입점을 열지 않았습니다.
 *
 * 컬럼 취급 규칙:
 *  - min_role: 파일별 열람 최소 권한. DB 기본값 'member'.
 *  - version: 파일 내용 갱신 시 컨트롤러 판단에 따라 UPDATE 절에서 version = version + 1 로 원자적으로 증가시킵니다.
 *  - download_count: 다운로드 요청 시마다 원자적으로 +1 증가시킵니다.
 *  - uploaded_by: users(id) SET NULL 정책이므로 NULL 허용.
 */

const db = require('../config/db'); // PostgreSQL 커넥션 풀 모듈.

const FilesModel = {
  /**
   * @function createFile
   * @description 신규 파일 메타데이터를 삽입합니다.
   *              storage_type은 'drive'로 강제 고정하고 file_url을 필수로 요구합니다.
   *              min_role이 undefined/null이면 DB 기본값('member')이 적용되도록 COALESCE로 방어합니다.
   */
  createFile: async ({
    uploadedBy,
    title,
    description,
    category,
    minRole,
    filename,
    mimeType,
    fileUrl,
    filesize,
  }) => {
    const queryText = `
      INSERT INTO shared_files (
        uploaded_by, title, description, category, min_role,
        filename, mime_type, storage_type, file_url, filesize
      ) VALUES (
        $1, $2, $3, $4, COALESCE($5::user_role, 'member'::user_role),
        $6, $7, 'drive'::storage_type, $8, $9
      )
      RETURNING *;
    `;
    const values = [
      uploadedBy || null,
      title,
      description || null,
      category,
      minRole === undefined || minRole === null ? null : minRole,
      filename,
      mimeType || null,
      fileUrl,
      filesize === undefined || filesize === null ? null : filesize,
    ];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function findAll
   * @description 목록 조회. category 필터와 함께 min_role 화이트리스트(요청자 권한으로 접근 가능한 값들)를 함께 적용합니다.
   *              WHERE 절에서 min_role 필터를 DB 레벨에서 걸어 응용 계층 필터링(누락 위험)을 배제합니다.
   * @param {Object} filters
   * @param {string} [filters.category]
   * @param {Array<string>} [filters.allowedMinRoles] - user_role 배열. 이 목록에 포함된 min_role만 노출합니다.
   */
  findAll: async ({ category, allowedMinRoles } = {}) => {
    const conditions = [];
    const values = [];

    // min_role 화이트리스트: 요청자 권한으로 접근 가능한 등급 목록만 노출합니다.
    // 빈 배열이면 결과가 반드시 0건이 되도록 안전하게 처리합니다.
    if (Array.isArray(allowedMinRoles)) {
      if (allowedMinRoles.length === 0) {
        return [];
      }
      values.push(allowedMinRoles);
      conditions.push(`min_role = ANY($${values.length}::user_role[])`);
    }

    if (category !== undefined && category !== null && category !== '') {
      values.push(category);
      conditions.push(`category = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const queryText = `
      SELECT *
        FROM shared_files
        ${whereClause}
       ORDER BY created_at DESC, id DESC;
    `;
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function findById
   * @description 파일 단일 조회. 인가(min_role) 판정은 컨트롤러 계층에서 수행합니다.
   */
  findById: async (id) => {
    const queryText = `SELECT * FROM shared_files WHERE id = $1;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function updateFile
   * @description 부분 업데이트(PATCH). patch에 명시된 필드만 SET 절에 포함시켜 안전한 부분 수정을 수행합니다.
   *              options.bumpVersion=true인 경우 version 컬럼을 원자적으로 +1 증가시킵니다.
   *              (파일 내용 자체가 갱신된 경우 컨트롤러가 이 플래그를 True로 전달합니다.)
   */
  updateFile: async (id, patch, { bumpVersion = false } = {}) => {
    const fieldMap = {
      title: 'title',
      description: 'description',
      category: 'category',
      minRole: 'min_role',
      filename: 'filename',
      mimeType: 'mime_type',
      fileUrl: 'file_url',
      filesize: 'filesize',
    };

    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, column] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        sets.push(`${column} = $${i}`);
        values.push(patch[key]);
        i += 1;
      }
    }

    // 변경 컬럼도 없고 버전 증가도 없으면 no-op 처리하여 불필요한 UPDATE를 피합니다.
    if (sets.length === 0 && !bumpVersion) {
      return await FilesModel.findById(id);
    }

    if (bumpVersion) {
      sets.push(`version = version + 1`);
    }
    sets.push(`updated_at = now()`);

    values.push(id);
    const queryText = `
      UPDATE shared_files
         SET ${sets.join(', ')}
       WHERE id = $${i}
      RETURNING *;
    `;
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function incrementDownloadCount
   * @description 다운로드 요청 시 카운터를 원자적으로 +1 증가시키고 갱신 후 값을 반환합니다.
   *              동시 요청 시에도 race condition 없이 정확한 집계를 보장합니다(DB 레벨 산술 업데이트).
   */
  incrementDownloadCount: async (id) => {
    const queryText = `
      UPDATE shared_files
         SET download_count = download_count + 1
       WHERE id = $1
      RETURNING id, download_count, file_url, filename, storage_type;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function deleteFile
   * @description 파일 레코드를 즉시 완전 삭제합니다(soft delete 없음).
   */
  deleteFile: async (id) => {
    const queryText = `DELETE FROM shared_files WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },
};

module.exports = FilesModel;
