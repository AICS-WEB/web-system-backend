/**
 * @file apply-migration.js
 * @description 지정한 SQL 마이그레이션 파일을 aics_lab DB에 트랜잭션 단위로 적용하는 스크립트입니다.
 *              config/db.js 의 pg Pool 인스턴스를 재활용하여 .env 커넥션 정보를 그대로 사용합니다.
 *
 * 사용 예:
 *   node db/apply-migration.js db/migrations/002_public_site_tables.sql
 *
 * 특징:
 *   - SQL 파일 내부에 BEGIN/COMMIT 이 있으면 그것에 위임하고, 없으면 이 스크립트가 트랜잭션을 감쌉니다.
 *   - 실패 시 자동 ROLLBACK 후 에러 메시지와 exit code 1 로 종료.
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/config/db'); // 기존 pg Pool 인스턴스 재사용 (.env 자동 로드).

// CLI 인자 파싱: 첫 번째 인자를 마이그레이션 SQL 파일 경로로 사용합니다.
const relativeInputPath = process.argv[2];
if (!relativeInputPath) {
  console.error('[apply-migration] 사용법: node db/apply-migration.js <sql 경로>');
  console.error('  예) node db/apply-migration.js db/migrations/002_public_site_tables.sql');
  process.exit(1);
}

// 절대 경로 정규화 (프로세스 CWD 기준). 파일이 없으면 즉시 실패시켜 원인을 명확히 노출합니다.
const sqlPath = path.resolve(process.cwd(), relativeInputPath);
if (!fs.existsSync(sqlPath)) {
  console.error(`[apply-migration] 파일을 찾을 수 없습니다: ${sqlPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');

// SQL 파일 내부에 이미 BEGIN 이 명시적으로 있다면 이중 트랜잭션을 피하기 위해 그대로 실행합니다.
// (Postgres는 트랜잭션 중첩을 지원하지 않으며 SAVEPOINT 방식은 필요 시 SQL 파일 내에서 관리)
const hasExplicitBegin = /\bBEGIN\s*;?/i.test(sql);

(async () => {
  const client = await db.connect(); // 단일 커넥션 대여 (트랜잭션 무결성 확보)
  try {
    console.log(`[apply-migration] 실행 대상: ${sqlPath}`);

    if (!hasExplicitBegin) {
      await client.query('BEGIN');
    }

    await client.query(sql);

    if (!hasExplicitBegin) {
      await client.query('COMMIT');
    }

    console.log('[apply-migration] ✅ 성공: 마이그레이션이 정상 적용되었습니다.');
  } catch (err) {
    // SQL 파일이 자체 BEGIN 을 갖고 있어도 오류가 나면 Postgres 가 트랜잭션을 aborted 상태로 유지하므로
    // 명시적으로 ROLLBACK 을 시도해 커넥션을 회수 가능한 상태로 되돌립니다.
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('[apply-migration] ❌ 실패:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    // Pool 을 닫아야 스크립트가 매달리지 않고 종료됩니다.
    // (config/db 는 module.exports 에 pool 원본을 노출하지 않으므로 setImmediate 로 프로세스 자연 종료 유도)
    setImmediate(() => process.exit(process.exitCode || 0));
  }
})();
