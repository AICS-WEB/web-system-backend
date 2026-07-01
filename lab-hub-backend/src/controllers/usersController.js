/**
 * @file usersController.js
 * @description 사용자 회원가입 및 로그인(JWT 발급) 비즈니스 로직을 제어하는 컨트롤러 레이어입니다.
 */

const jwt = require('jsonwebtoken'); // 토큰 발행을 위한 라이브러리를 로드합니다.
const UsersModel = require('../models/usersModel'); // 데이터 액세스 레이어 호출
const BcryptUtils = require('../utils/bcryptUtils'); // 암호화 보안 유틸 호출

// 친구가 만든 공통 응답 포맷 유틸을 가져옵니다. (CJS 규격)
// 예시: response.success(res, message, data, statusCode), response.error(res, message, statusCode)
const response = require('../utils/response'); 

const UsersController = {
  /**
   * @function registerUser
   * @description 신규 회원가입 신청을 처리합니다. (공통 응답 유틸 적용 버전)
   */
  registerUser: async (req, res) => {
    try {
      const {
        email, password, name, studentId, department,
        program, enrollmentYear, researchTopic, phone, bio, githubUrl, linkedinUrl
      } = req.body;

      // [유효성 검사] 필수 파라미터 확인
      if (!email || !password || !name || !studentId || !department || !program || !enrollmentYear) {
        return response.error(res, '필수 입력 항목이 누락되었습니다.', 400);
      }

      // [유효성 검사] 비밀번호 길이 제약
      if (password.length < 8) {
        return response.error(res, '비밀번호는 최소 8자 이상이어야 합니다.', 400);
      }

      // 이메일 중복 체크
      const existingUserByEmail = await UsersModel.findByEmail(email);
      if (existingUserByEmail) {
        return response.error(res, '이미 가입 신청되었거나 사용 중인 이메일 주소입니다.', 409);
      }

      // 학번 중복 체크
      const existingUserByStudentId = await UsersModel.findByStudentId(studentId);
      if (existingUserByStudentId) {
        return response.error(res, '이미 등록된 학번(사번)입니다.', 409);
      }

      // Bcrypt 암호화 수행
      const passwordHash = await BcryptUtils.hashPassword(password);

      // 데이터 삽입
      const newUser = await UsersModel.createPendingUser({
        email, passwordHash, name, studentId, department,
        program, enrollmentYear, researchTopic, phone, bio, githubUrl, linkedinUrl
      });

      // 친구의 공통 응답 포맷에 맞춰 리턴 (201 Created)
      return response.success(res, '회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인 가능합니다.', {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        account_status: newUser.account_status
      }, 201);

    } catch (error) {
      console.error('회원가입 비즈니스 에러:', error);
      return response.error(res, '서버 내부 오류로 회원가입에 실패했습니다.', 500);
    }
  },

  /**
   * @function loginUser
   * @description [3단계] 유저 이메일과 패스워드를 검증하고 계정 상태가 approved일 때 JWT Access Token을 발행합니다.
   */
  loginUser: async (req, res) => {
    try {
      const { email, password } = req.body;

      // 1. 필수 입력값 1차 필터링
      if (!email || !password) {
        return response.error(res, '이메일과 비밀번호를 모두 입력해주세요.', 400);
      }

      // 2. 이메일을 통해 DB에서 해당 사용자 정보 스캔
      const user = await UsersModel.findByEmail(email);
      if (!user) {
        return response.error(res, '이메일 또는 비밀번호가 일치하지 않습니다.', 401); // 보안을 위해 모호한 에러 메시지 처리
      }

      // 3. [보안 핵심] 입력된 평문 비번과 DB의 해시 암호문 대조 알고리즘 수행
      const isPasswordValid = await BcryptUtils.comparePassword(password, user.password_hash);
      if (!isPasswordValid) {
        return response.error(res, '이메일 또는 비밀번호가 일치하지 않습니다.', 401);
      }

      // 4. [비즈니스 제약] 승인 대기(pending), 반려(rejected), 비활성(deactivated) 상태 유저 로그인 통제
      if (user.account_status !== 'approved') {
        const statusMessages = {
          pending: '현재 가입 승인 대기 상태입니다. 랩장의 승인을 기다려주세요.',
          rejected: '가입 신청이 반려되었습니다. 연구실 행정실에 문의하세요.',
          deactivated: '비활성화된 계정입니다.'
        };
        return response.error(res, statusMessages[user.account_status] || '로그인이 불가능한 계정 상태입니다.', 403);
      }

      // 5. [인가 인프라] 유저 식별용 페이로드(Payload)를 품은 JWT 인증 토큰 생성
      const tokenPayload = {
        id: user.id,
        email: user.email,
        role: user.role // 'member', 'manager', 'admin' 등급 인가 처리용
      };

      // .env에 서명 키가 없다면 개발 편의를 위한 임시 키(Fallback)를 지정합니다.
      const secretKey = process.env.JWT_SECRET || 'aics_default_secret_key_2026';
      
      // 30분 동안 유효한 Access Token 서명 발행
      const accessToken = jwt.sign(tokenPayload, secretKey, { expiresIn: '30m' });

      // 최근 로그인 시각 기록 업데이트 로직은 추후 모델에 추가 예정

      // 6. 생성된 토큰과 유저 기본 프로필 반환 (200 OK)
      return response.success(res, '로그인에 성공했습니다.', {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          preferred_language: user.preferred_language
        }
      }, 200);

    } catch (error) {
      console.error('로그인 비즈니스 에러:', error);
      return response.error(res, '서버 내부 오류로 로그인에 실패했습니다.', 500);
    }
  }
};

module.exports = UsersController;

/**
   * @function getPendingUsers
   * @description [관리자 전용] 가입 승인 대기 상태인 유저 리스트를 반환합니다.
   */
  getPendingUsers: async (req, res) => {
    try {
      // 대기자 리스트를 Model 레이어에서 스캔해옵니다.
      const pendingUsers = await UsersModel.findPendingUsers();
      
      return response.success(res, '가입 승인 대기자 목록 조회 성공', { 
        count: pendingUsers.length,
        users: pendingUsers 
      }, 200);
    } catch (error) {
      console.error('대기자 목록 조회 중 서버 에러 발생:', error);
      return response.error(res, '서버 내부 오류로 대기자 목록을 가져오지 못했습니다.', 500);
    }
  },

  /**
   * @function approveUser
   * @description [관리자 전용] 사용자의 가입 신청을 최종 승인(approved) 처리합니다.
   */
  approveUser: async (req, res) => {
    try {
      const userId = req.params.id;

      // 1. 해당 유저가 실제로 존재하는지 무결성 체크
      const user = await UsersModel.findById(userId);
      if (!user) {
        return response.error(res, '존재하지 않는 사용자입니다.', 404);
      }

      // 2. 이미 승인된 유저인지 상태 필터링 알고리즘
      if (user.account_status === 'approved') {
        return response.error(res, '이미 가입 승인이 완료된 사용자입니다.', 400);
      }

      // 3. 상태를 'approved'로 원자적 업데이트(Atomic Update)
      const updatedUser = await UsersModel.updateUserStatus(userId, 'approved');

      // [추후 고도화]: 이 시점에 notifications 테이블에 "가입이 승인되었습니다" 알림을 생성하는 로직 연동 예정

      return response.success(res, `${updatedUser.name} 연구원의 가입 신청을 승인했습니다.`, {
        user: updatedUser
      }, 200);
    } catch (error) {
      console.error('가입 승인 중 에러 발생:', error);
      return response.error(res, '서버 오류로 가입 승인 처리에 실패했습니다.', 500);
    }
  },

  /**
   * @function rejectUser
   * @description [관리자 전용] 사용자의 가입 신청을 반려(rejected) 처리합니다.
   */
  rejectUser: async (req, res) => {
    try {
      const userId = req.params.id;

      const user = await UsersModel.findById(userId);
      if (!user) {
        return response.error(res, '존재하지 않는 사용자입니다.', 404);
      }

      if (user.account_status === 'rejected') {
        return response.error(res, '이미 반려 처리된 신청 건입니다.', 400);
      }

      // 상태를 'rejected'로 업데이트
      const updatedUser = await UsersModel.updateUserStatus(userId, 'rejected');

      return response.success(res, `${updatedUser.name} 연구원의 가입 신청을 반려했습니다.`, {
        user: updatedUser
      }, 200);
    } catch (error) {
      console.error('가입 반려 중 에러 발생:', error);
      return response.error(res, '서버 오류로 가입 반려 처리에 실패했습니다.', 500);
    }
  }