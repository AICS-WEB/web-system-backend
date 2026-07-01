/**
 * @file app.js
 * @description Express 애플리케이션 인스턴스를 생성하고 미들웨어 및 전체 도메인 라우터를 순차적으로 등록하는 환경 설정 파일입니다.
 */

require('dotenv').config(); // .env 파일의 환경 변수를 process.env에 로드합니다.
const express = require('express'); // Express 프레임워크를 가져옵니다.
const cors = require('cors'); // 교차 출처 리소스 공유(CORS) 설정을 위한 미들웨어입니다.

// ==========================================
// 📦 1. 라우터 모듈 로드 구역 (Router Modules Load)
// ==========================================
// 各 도메인 레이어별로 분리된 라우팅 테이블을 불러옵니다.
const authRoutes = require('./routes/authRoutes'); // [인증] 회원가입/로그인/토큰 관리 등
const usersRoutes = require('./routes/usersRoutes'); // [사용자 관리] 대기자 조회 및 승인/반려 등
const attendanceRoutes = require('./routes/attendanceRoutes'); // [출결] IP/시각 검증 기반 출퇴근 통제
const leaveRoutes = require('./routes/leaveRoutes'); // [휴가] 연차 기안 및 결재/출결 동기화 연동
const calendarRoutes = require('./routes/calendarRoutes'); // [캘린더 관리] 일정 CRUD 및 반복 일정 처리
const noticeRoutes = require('./routes/noticeRoutes'); // [공지사항] 상단고정 및 하이브리드 첨부파일 통제
const budgetRoutes = require('./routes/budgetRoutes'); // [연구비 회계] 예산 검증 및 지출 정산 통제
const publicationsRoutes = require('./routes/publicationsRoutes'); // [논문 성과] 논문 기안 및 저자 매핑/증빙 통제
const procurementRoutes = require('./routes/procurementRoutes'); // [물품 구매] 자재·supplies 구매 기안 및 회계 심사 통제

// Express 애플리케이션 인스턴스를 생성합니다.
const app = express();

// ==========================================
// ⚙️ 2. 글로벌 공통 미들웨어 세팅 (Global Middlewares)
// ==========================================

// 요청 본문(JSON)을 파싱하여 req.body에 안전하게 바인딩하기 위한 내장 미들웨어입니다.
app.use(express.json());

// CORS 미들웨어를 등록합니다. 허용 출처는 환경 변수(CORS_ORIGIN)로 제어하며, 없을 시 전체 개방합니다.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
  })
);

// ==========================================
// 🔗 3. 도메인별 핵심 라우터 등록 (Domain Routers Binding)
// ==========================================

// [인증 도메인] /api/auth/register, /api/auth/login 등 처리
app.use('/api/auth', authRoutes);

// [사용자 관리 도메인] /api/users/pending, /api/users/:id/approve 등 처리
app.use('/api/users', usersRoutes);

// [출결 관리 도메인] /api/attendance/check-in, /api/attendance/check-out 처리
app.use('/api/attendance', attendanceRoutes);

// [휴가 관리 도메인] /api/leave/requests, /api/leave/requests/:id/review 처리
app.use('/api/leave', leaveRoutes);

// [캘린더 관리 도메인] /api/calendar/ 일정 CRUD 및 반복 일정 처리
app.use('/api/calendar', calendarRoutes);

// [공지사항 도메인] /api/notices/ 상단고정 및 하이브리드 첨부파일 통제 처리
app.use('/api/notices', noticeRoutes);

// [연구비 회계 도메인] /api/budget/expenses 지출 기안 및 회계 정산 심사 처리
app.use('/api/budget', budgetRoutes);

// [논문 성과 관리 도메인] /api/publications/ 논문 CRUD 및 멤버 저자(N:M) / 첨부 통제 처리
app.use('/api/publications', publicationsRoutes);

// [물품 구매 신청 도메인] /api/procurement/requests 자재 구매 기안 및 결재 심사 처리
app.use('/api/procurement', procurementRoutes);

// ==========================================
// 🚨 4. 라우터 하단 예외 및 에러 핸들러 미들웨어 (Error Handlers)
// ==========================================

/**
 * [⚠️ 중요] 상단에 정의된 라우터들의 주소와 매칭되지 않는 모든 요청을 가로채는 404 라우트입니다.
 * 반드시 모든 비즈니스 라우터들보다 최하단에 위치해야 정상적인 API 접근을 방해하지 않습니다.
 */
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    data: null,
    message: '요청하신 엔드포인트를 찾을 수 없습니다. (Not Found)',
  });
});

/**
 * 글로벌 공통 에러 핸들러 미들웨어입니다.
 * 컨트롤러나 다른 미들웨어 내부에서 예외가 발생하여 next(err)가 호출되었을 때 
 * 런타임 에러를 중앙 집중식으로 캐치하여 시스템 다운을 예방합니다.
 */
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error Logged:', err);
  
  const status = err.status || 500;
  
  // 팀 표준 공통 응답 규격(success, data, message)을 완벽히 준수하여 클라이언트에 에러를 반환합니다.
  res.status(status).json({
    success: false,
    data: null,
    message: err.message || '서버 내부 오류가 발생했습니다. (Internal Server Error)',
  });
});

// 타 모듈(server.js 등)에서 app 인스턴스를 가져가 포트를 바인딩할 수 있도록 모듈을 내보냅니다.
module.exports = app;