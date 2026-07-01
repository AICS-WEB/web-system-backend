/**
 * @file publicationsModel.js
 * @description 논문 성과 관리 도메인의 데이터 액세스 레이어.
 *              publications(마스터), publication_authors(우리 랩 멤버 저자 N:M),
 *              publication_attachments(첨부) 세 테이블의 쿼리를 담당합니다.
 *
 * 설계 원칙:
 *  - authors_text: 외부 공저자 포함 저자 원문 전체를 텍스트로 보존합니다(출판물 표기 그대로 재현하기 위한 원문).
 *  - publication_authors: 그 중 우리 랩 멤버(users)만 N:M으로 연결. author_order/is_corresponding 관리.
 *  - is_public: 비공개(false)가 기본. 외부 노출은 명시적 true 설정에 한합니다.
 *  - year: 집계용, published_date: 정렬용으로 병행 활용합니다.
 */

const db = require('../config/db'); // PostgreSQL 커넥션 풀 모듈.

const PublicationsModel = {
  // ============================================================
  //  Publication (마스터)
  // ============================================================

  /**
   * @function createPublication
   * @description 신규 논문 레코드를 삽입합니다.
   *              isPublic이 undefined/null이면 DB 기본값(false)이 적용되도록 COALESCE로 방어합니다.
   *              status가 undefined/null이면 DB 기본값('published')이 적용됩니다.
   * @param {Object} params
   * @returns {Object} 삽입된 논문 레코드 전체
   */
  createPublication: async ({
    title,
    authorsText,
    year,
    publishedDate,
    pubType,
    status,
    venue,
    doi,
    isPublic,
  }) => {
    const queryText = `
      INSERT INTO publications (
        title, authors_text, year, published_date, pub_type,
        status, venue, doi, is_public
      ) VALUES (
        $1, $2, $3, $4, $5,
        COALESCE($6::pub_status, 'published'::pub_status),
        $7, $8,
        COALESCE($9::boolean, false)
      )
      RETURNING *;
    `;
    const values = [
      title,
      authorsText,
      year,
      publishedDate || null,
      pubType,
      status === undefined || status === null ? null : status,
      venue || null,
      doi || null,
      isPublic === undefined || isPublic === null ? null : Boolean(isPublic),
    ];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function findById
   * @description 논문 단일 조회. 저자/첨부는 별도 함수로 결합합니다.
   */
  findById: async (id) => {
    const queryText = `SELECT * FROM publications WHERE id = $1;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function findAll
   * @description 목록 조회. year/pubType/status 필터를 조건부로 결합합니다.
   *              정렬은 (published_date DESC NULLS LAST) → year DESC → id DESC 순으로 실무 상 최신부터 노출합니다.
   *              is_public 조건은 걸지 않습니다. 조회는 인증된 랩 내부 사용자를 전제로 하며,
   *              외부 공개 여부(is_public)는 별도 공개 API/프론트 뷰에서 필터링합니다.
   * @param {Object} filters - { year, pubType, status } (모두 선택)
   * @returns {Array<Object>}
   */
  findAll: async ({ year, pubType, status } = {}) => {
    const conditions = [];
    const values = [];

    if (year !== undefined && year !== null && year !== '') {
      values.push(Number(year));
      conditions.push(`year = $${values.length}`);
    }
    if (pubType !== undefined && pubType !== null && pubType !== '') {
      values.push(pubType);
      conditions.push(`pub_type = $${values.length}`);
    }
    if (status !== undefined && status !== null && status !== '') {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const queryText = `
      SELECT *
        FROM publications
        ${whereClause}
       ORDER BY published_date DESC NULLS LAST, year DESC, id DESC;
    `;
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function updatePublication
   * @description 부분 업데이트(PATCH). patch 객체에 명시된 필드만 SET 절에 포함시켜 예상치 못한 컬럼 덮어쓰기를 방지합니다.
   */
  updatePublication: async (id, patch) => {
    const fieldMap = {
      title: 'title',
      authorsText: 'authors_text',
      year: 'year',
      publishedDate: 'published_date',
      pubType: 'pub_type',
      status: 'status',
      venue: 'venue',
      doi: 'doi',
      isPublic: 'is_public',
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

    if (sets.length === 0) {
      return await PublicationsModel.findById(id);
    }

    sets.push(`updated_at = now()`);
    values.push(id);
    const queryText = `
      UPDATE publications
         SET ${sets.join(', ')}
       WHERE id = $${i}
      RETURNING *;
    `;
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function deletePublication
   * @description 논문 삭제. publication_authors/publication_attachments는 ON DELETE CASCADE로 자동 정리됩니다.
   */
  deletePublication: async (id) => {
    const queryText = `DELETE FROM publications WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  // ============================================================
  //  Publication Authors (우리 랩 멤버만 연결)
  // ============================================================

  /**
   * @function addAuthors
   * @description 여러 명의 랩 멤버 저자를 한 번의 다중값 INSERT로 추가합니다.
   *              UNIQUE(publication_id, user_id) 제약을 활용해 중복 요청은 ON CONFLICT DO NOTHING으로 흡수합니다.
   * @param {number} publicationId
   * @param {Array<{ userId:number, authorOrder?:number, isCorresponding?:boolean }>} authors
   */
  addAuthors: async (publicationId, authors) => {
    if (!Array.isArray(authors) || authors.length === 0) return [];

    // (publication_id, user_id, author_order, is_corresponding) 다중값 INSERT용 플레이스홀더 조립.
    const placeholders = authors
      .map((_, idx) => {
        const base = 2 + idx * 3;
        return `($1, $${base}, $${base + 1}, $${base + 2})`;
      })
      .join(', ');

    const values = [publicationId];
    for (const a of authors) {
      values.push(
        a.userId,
        a.authorOrder === undefined || a.authorOrder === null ? null : Number(a.authorOrder),
        a.isCorresponding === true
      );
    }

    const queryText = `
      INSERT INTO publication_authors (publication_id, user_id, author_order, is_corresponding)
      VALUES ${placeholders}
      ON CONFLICT (publication_id, user_id) DO NOTHING
      RETURNING id, publication_id, user_id, author_order, is_corresponding, created_at;
    `;
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function removeAllAuthors
   * @description 논문의 모든 랩 멤버 저자 연결을 제거합니다. PATCH 시 "전체 교체" 전략에 사용합니다.
   */
  removeAllAuthors: async (publicationId) => {
    const queryText = `DELETE FROM publication_authors WHERE publication_id = $1;`;
    await db.query(queryText, [publicationId]);
  },

  /**
   * @function getAuthors
   * @description 단일 논문의 랩 멤버 저자 목록을 users JOIN으로 반환합니다.
   *              author_order 기준으로 정렬하되 NULL은 마지막에, 동순위는 id ASC로 안정 정렬합니다.
   */
  getAuthors: async (publicationId) => {
    const queryText = `
      SELECT a.id, a.user_id, a.author_order, a.is_corresponding, a.created_at,
             u.name, u.email
        FROM publication_authors a
        LEFT JOIN users u ON u.id = a.user_id
       WHERE a.publication_id = $1
       ORDER BY a.author_order ASC NULLS LAST, a.id ASC;
    `;
    const { rows } = await db.query(queryText, [publicationId]);
    return rows;
  },

  /**
   * @function getAuthorsForPublicationIds
   * @description 목록 조회 시 N+1 방지를 위해 여러 논문의 저자 정보를 한 번의 쿼리로 가져옵니다.
   */
  getAuthorsForPublicationIds: async (publicationIds) => {
    if (!Array.isArray(publicationIds) || publicationIds.length === 0) return [];
    const queryText = `
      SELECT a.id, a.publication_id, a.user_id, a.author_order, a.is_corresponding, a.created_at,
             u.name, u.email
        FROM publication_authors a
        LEFT JOIN users u ON u.id = a.user_id
       WHERE a.publication_id = ANY($1::int[])
       ORDER BY a.publication_id ASC, a.author_order ASC NULLS LAST, a.id ASC;
    `;
    const { rows } = await db.query(queryText, [publicationIds]);
    return rows;
  },

  // ============================================================
  //  Publication Attachments (읽기 전용 — 등록/삭제는 별도 도메인)
  // ============================================================

  /**
   * @function getAttachments
   * @description 단일 논문의 첨부 파일 목록을 반환합니다.
   *              storage_type(drive/nas)에 따라 file_url 또는 filepath 중 하나가 유효합니다(스키마 CHECK 제약).
   */
  getAttachments: async (publicationId) => {
    const queryText = `
      SELECT *
        FROM publication_attachments
       WHERE publication_id = $1
       ORDER BY id ASC;
    `;
    const { rows } = await db.query(queryText, [publicationId]);
    return rows;
  },
};

module.exports = PublicationsModel;
