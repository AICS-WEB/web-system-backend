/**
 * @file app.js
 * @description Express 애플리케이션 인스턴스를 생성하고 미들웨어 및 전체 도메인 라우터를 순차적으로 등록하는 환경 설정 파일입니다.
 */

require('dotenv').config(); // .env 파일의 환경 변수를 process.env에 로드합니다.
const express = require('express'); // Express 프레임워크를 가져옵니다.
const cors = require('cors'); // 교차 출처 리소스 공유(CORS) 설정을 위한 미들웨어입니다.

// [라우터 모듈 로드 구역]
// 각 도메인 레이어별로 분리된 라우팅 테이블을 불러옵니다.
const authRoutes = require('./routes/authRoutes'); // [인증] 회원가입/로그인 등
const usersRoutes = require('./routes/usersRoutes'); // [사용자 관리] 대기자 조회/승인 등
const attendanceRoutes = require('./routes/attendanceRoutes'); // [출결] 출퇴근 통제

// Express 애플리케이션 인스턴스를 생성합니다.
const app = express();

// ==========================================
// ⚙️ 글로벌 공통 미들웨어 세팅 (Global Middlewares)
// ==========================================

// 요청 본문(JSON)을 파싱하여 req.body에 바인딩하기 위한 내장 미들웨어를 등록합니다.
app.use(express.json());

// CORS 미들웨어를 등록합니다. 허용 출처는 환경 변수(CORS_ORIGIN)로 제어합니다.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*', // Fallback으로 전체 개방 설정을 처리합니다.
  })
);

// ==========================================
// 🔗 도메인별 핵심 라우터 등록 (Domain Routers Binding)
// ==========================================

// 1. 인증(Auth) 도메인: 회원가입/로그인/토큰 갱신 등
app.use('/api/auth', authRoutes);

// 2. 사용자(Users) 도메인: 내 정보 조회, 관리자용 가입 대기자 승인/반려 등
app.use('/api/users', usersRoutes);

// 3. 출결(Attendance) 도메인: IP 검증 및 09시 지각 판별 기반 출퇴근 연동
app.use('/api/attendance', attendanceRoutes);

// ==========================================
// 🚨 라우터 하단 예외 및 에러 핸들러 미들웨어 (Error Handlers)
// ==========================================

/**
 * [주의] 라우터들보다 무조건 하단에 위치해야 합니다.
 * 상단에 정의된 모든 API 엔드포인트와 일치하지 않는 요청에 대한 404 예외 처리 미들웨어입니다.
 */
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    data: null,
    message: '요청하신 엔드포인트를 찾을 수 없습니다. (Not Found)',
  });
});

/**
 * 공통 에러 핸들러: 비즈니스 로직(Controller) 레이어 등에서 발생하여 
 * next(err)로 넘어온 모든 런타임 예외를 한 곳에서 중앙 집중식으로 방어합니다.
 */
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error Logged:', err);
  
  const status = err.status || 500;
  
  // 친구가 정의해준 표준 에러 응답 구조(success, data, message)의 무결성을 지켜 반환합니다.
  res.status(status).json({
    success: false,
    data: null,
    message: err.message || '서버 내부 오류가 발생했습니다. (Internal Server Error)',
  });
});

// 타 모듈(server.js 등)에서 app 인스턴스를 포트 바인딩하여 활성화할 수 있도록 내보냅니다.
module.exports = app;