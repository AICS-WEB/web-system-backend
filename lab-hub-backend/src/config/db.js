/**
 * @file db.js
 * @description 데이터베이스 커넥션 풀을 설정하고 관리하는 환경 설정 파일입니다.
 */

require('dotenv').config(); // .env 파일의 환경 변수를 process.env에 로드합니다.
const { Pool } = require('pg'); // PostgreSQL 연결을 위한 pg 라이브러리에서 Pool 개체를 가져옵니다.

// .env에 정의된 인증 정보를 기반으로 데이터베이스 커넥션 풀 인스턴스를 생성합니다.
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  // Supabase 등 관리형 Postgres는 SSL 연결을 요구합니다.
  // 호스트에 'supabase'가 포함되면 SSL을 켜고(인증서 체인은 완화), 로컬이면 끕니다.
  // → .env 의 DB_HOST 만 바꿔 로컬/Supabase 를 오갈 수 있습니다.
  ssl: (process.env.DB_HOST || '').includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});


// 데이터베이스와 커넥션 풀이 최초 연결에 성공했을 때 발생하는 이벤트 리스너입니다.
pool.on('connect', () => {
  console.log('PostgreSQL Database Connection Pool Initialized Successfully.');
});

// 커넥션 풀 운영 중 예기치 못한 에러가 발생했을 때의 예외 처리 로직입니다.
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err);
  process.exit(-1); // 서버 시스템을 에러 코드와 함께 즉시 종료합니다.
});

// 타 모듈(Model 등)에서 쿼리를 안전하게 수행할 수 있도록 인터페이스를 모듈화하여 내보냅니다.
// - query(text, params): 단일 쿼리 (자동 커넥션 반환)
// - connect(): 트랜잭션(BEGIN/COMMIT/ROLLBACK) 처리용 raw client 대여. 사용 후 반드시 client.release() 호출.
module.exports = {
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect(),
};