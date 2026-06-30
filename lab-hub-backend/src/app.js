/**
 * @file app.js
 * @description Express 애플리케이션 인스턴스를 생성하고 미들웨어 및 라우터를 등록하는 진입점 파일입니다.
 */

require('dotenv').config(); // .env 파일의 환경 변수를 process.env에 로드합니다.
const express = require('express'); // Express 프레임워크를 가져옵니다.
const cors = require('cors'); // 교차 출처 리소스 공유(CORS) 설정을 위한 미들웨어입니다.

// Express 애플리케이션 인스턴스를 생성합니다.
const app = express();

// 요청 본문(JSON)을 파싱하기 위한 내장 미들웨어를 등록합니다.
app.use(express.json());

// CORS 미들웨어를 등록합니다. 허용 출처는 환경 변수(CORS_ORIGIN)로 제어합니다.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
  })
);

// ===== 라우터 등록 자리 =====
// 예: app.use('/api/users', require('./routes/userRoutes'));
// 예: app.use('/api/auth', require('./routes/authRoutes'));
// ============================

// 등록된 라우트와 일치하지 않는 요청에 대한 404 처리 미들웨어입니다.
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    data: null,
    message: 'Not Found',
  });
});

// 공통 에러 핸들러: 라우터/미들웨어에서 발생한 예외를 한 곳에서 처리합니다.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    data: null,
    message: err.message || 'Internal Server Error',
  });
});

// 타 모듈(server.js 등)에서 app 인스턴스를 사용할 수 있도록 내보냅니다.
module.exports = app;
