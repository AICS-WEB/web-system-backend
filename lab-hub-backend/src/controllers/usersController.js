/**
 * @file usersController.js
 * @description 사용자 회원가입 및 로그인(JWT 발급) 비즈니스 로직을 제어하는 컨트롤러 레이어입니다.
 */

const jwt = require('jsonwebtoken'); // 토큰 발행을 위한 라이브러리를 로드합니다.
const UsersModel = require('../models/usersModel'); // 데이터 액세스 레이어 호출
const BcryptUtils = require('../utils/bcryptUtils'); // 암호화 보안 유틸 호출

// 팀 표준 공통 응답 유틸(success/fail)을 가져옵니다.
// 표준 스펙: { success, data, message }
//   success(res, data, message?, status?)
//   fail(res, status, message)
const { success, fail } = require('../utils/response');

// user_role / account_status ENUM 유효값 (관리자 변경 시 화이트리스트 검증)
const VALID_ROLES = ['member', 'manager', 'admin'];
const VALID_ACCOUNT_STATUSES = ['pending', 'approved', 'rejected', 'deactivated'];

// 비밀번호 최소 길이 정책
const MIN_PASSWORD_LENGTH = 8;

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
        return fail(res, 400, '필수 입력 항목이 누락되었습니다.');
      }

      // [유효성 검사] 비밀번호 길이 제약
      if (password.length < 8) {
        return fail(res, 400, '비밀번호는 최소 8자 이상이어야 합니다.');
      }

      // 이메일 중복 체크
      const existingUserByEmail = await UsersModel.findByEmail(email);
      if (existingUserByEmail) {
        return fail(res, 409, '이미 가입 신청되었거나 사용 중인 이메일 주소입니다.');
      }

      // 학번 중복 체크
      const existingUserByStudentId = await UsersModel.findByStudentId(studentId);
      if (existingUserByStudentId) {
        return fail(res, 409, '이미 등록된 학번(사번)입니다.');
      }

      // Bcrypt 암호화 수행
      const passwordHash = await BcryptUtils.hashPassword(password);

      // 데이터 삽입
      const newUser = await UsersModel.createPendingUser({
        email, passwordHash, name, studentId, department,
        program, enrollmentYear, researchTopic, phone, bio, githubUrl, linkedinUrl
      });

      // 팀 표준 응답 스펙에 맞춰 리턴 (201 Created)
      return success(
        res,
        {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          account_status: newUser.account_status,
        },
        '회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인 가능합니다.',
        201
      );

    } catch (error) {
      console.error('회원가입 비즈니스 에러:', error);
      return fail(res, 500, '서버 내부 오류로 회원가입에 실패했습니다.');
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
        return fail(res, 400, '이메일과 비밀번호를 모두 입력해주세요.');
      }

      // 2. 이메일을 통해 DB에서 해당 사용자 정보 스캔
      const user = await UsersModel.findByEmail(email);
      if (!user) {
        // 보안을 위해 모호한 에러 메시지 처리
        return fail(res, 401, '이메일 또는 비밀번호가 일치하지 않습니다.');
      }

      // 3. [보안 핵심] 입력된 평문 비번과 DB의 해시 암호문 대조 알고리즘 수행
      const isPasswordValid = await BcryptUtils.comparePassword(password, user.password_hash);
      if (!isPasswordValid) {
        return fail(res, 401, '이메일 또는 비밀번호가 일치하지 않습니다.');
      }

      // 4. [비즈니스 제약] 승인 대기(pending), 반려(rejected), 비활성(deactivated) 상태 유저 로그인 통제
      if (user.account_status !== 'approved') {
        const statusMessages = {
          pending: '현재 가입 승인 대기 상태입니다. 랩장의 승인을 기다려주세요.',
          rejected: '가입 신청이 반려되었습니다. 연구실 행정실에 문의하세요.',
          deactivated: '비활성화된 계정입니다.'
        };
        return fail(res, 403, statusMessages[user.account_status] || '로그인이 불가능한 계정 상태입니다.');
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
      return success(
        res,
        {
          accessToken,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            preferred_language: user.preferred_language,
          },
        },
        '로그인에 성공했습니다.'
      );

    } catch (error) {
      console.error('로그인 비즈니스 에러:', error);
      return fail(res, 500, '서버 내부 오류로 로그인에 실패했습니다.');
    }
  },

  /**
   * @function getPendingUsers
   * @description [관리자 전용] 가입 승인 대기 상태인 유저 리스트를 반환합니다.
   */
  getPendingUsers: async (req, res) => {
    try {
      // 대기자 리스트를 Model 레이어에서 스캔해옵니다.
      const pendingUsers = await UsersModel.findPendingUsers();

      return success(
        res,
        { count: pendingUsers.length, users: pendingUsers },
        '가입 승인 대기자 목록 조회 성공'
      );
    } catch (error) {
      console.error('대기자 목록 조회 중 서버 에러 발생:', error);
      return fail(res, 500, '서버 내부 오류로 대기자 목록을 가져오지 못했습니다.');
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
        return fail(res, 404, '존재하지 않는 사용자입니다.');
      }

      // 2. 이미 승인된 유저인지 상태 필터링 알고리즘
      if (user.account_status === 'approved') {
        return fail(res, 400, '이미 가입 승인이 완료된 사용자입니다.');
      }

      // 3. 상태를 'approved'로 원자적 업데이트(Atomic Update)
      const updatedUser = await UsersModel.updateUserStatus(userId, 'approved');

      // [추후 고도화]: 이 시점에 notifications 테이블에 "가입이 승인되었습니다" 알림을 생성하는 로직 연동 예정

      return success(
        res,
        { user: updatedUser },
        `${updatedUser.name} 연구원의 가입 신청을 승인했습니다.`
      );
    } catch (error) {
      console.error('가입 승인 중 에러 발생:', error);
      return fail(res, 500, '서버 오류로 가입 승인 처리에 실패했습니다.');
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
        return fail(res, 404, '존재하지 않는 사용자입니다.');
      }

      if (user.account_status === 'rejected') {
        return fail(res, 400, '이미 반려 처리된 신청 건입니다.');
      }

      // 상태를 'rejected'로 업데이트
      const updatedUser = await UsersModel.updateUserStatus(userId, 'rejected');

      return success(
        res,
        { user: updatedUser },
        `${updatedUser.name} 연구원의 가입 신청을 반려했습니다.`
      );
    } catch (error) {
      console.error('가입 반려 중 에러 발생:', error);
      return fail(res, 500, '서버 오류로 가입 반려 처리에 실패했습니다.');
    }
  },

  /**
   * @function listUsers
   * @description [관리자 전용] 전체 사용자 목록을 민감정보 제외하고 조회합니다.
   */
  listUsers: async (req, res) => {
    try {
      const users = await UsersModel.findAllUsers();
      return success(res, users, '전체 사용자 목록 조회 성공');
    } catch (error) {
      console.error('사용자 목록 조회 중 서버 에러:', error);
      return fail(res, 500, '서버 오류로 사용자 목록을 가져오지 못했습니다.');
    }
  },

  /**
   * @function changeRole
   * @description [관리자 전용] 특정 사용자의 역할(role)을 변경합니다. Body: { role }
   */
  changeRole: async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body || {};

      if (!role || !VALID_ROLES.includes(role)) {
        return fail(res, 400, `유효한 역할값(role)이 필요합니다. 허용 값: ${VALID_ROLES.join(', ')}.`);
      }

      const user = await UsersModel.findById(id);
      if (!user) {
        return fail(res, 404, '존재하지 않는 사용자입니다.');
      }

      // 관리자 본인이 자신의 역할을 강등/변경하여 시스템에서 권한을 잃는 사고를 방지합니다.
      if (String(id) === String(req.user.id)) {
        return fail(res, 400, '본인의 역할은 스스로 변경할 수 없습니다.');
      }

      const updated = await UsersModel.updateUserRole(id, role);
      return success(res, { user: updated }, `${updated.name} 사용자의 역할을 ${role}(으)로 변경했습니다.`);
    } catch (error) {
      console.error('사용자 역할 변경 중 서버 에러:', error);
      return fail(res, 500, '서버 오류로 역할 변경에 실패했습니다.');
    }
  },

  /**
   * @function changeStatus
   * @description [관리자 전용] 특정 사용자의 계정 상태(account_status)를 변경합니다. Body: { status }
   *              approve/reject 전용 엔드포인트와 달리 deactivated 포함 전 상태로의 전이를 허용합니다.
   */
  changeStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body || {};

      if (!status || !VALID_ACCOUNT_STATUSES.includes(status)) {
        return fail(res, 400, `유효한 계정 상태(status)가 필요합니다. 허용 값: ${VALID_ACCOUNT_STATUSES.join(', ')}.`);
      }

      const user = await UsersModel.findById(id);
      if (!user) {
        return fail(res, 404, '존재하지 않는 사용자입니다.');
      }

      // 관리자 본인 계정을 스스로 비활성화하여 잠기는 사고를 방지합니다.
      if (String(id) === String(req.user.id)) {
        return fail(res, 400, '본인의 계정 상태는 스스로 변경할 수 없습니다.');
      }

      const updated = await UsersModel.updateUserStatus(id, status);
      return success(res, { user: updated }, `${updated.name} 사용자의 계정 상태를 ${status}(으)로 변경했습니다.`);
    } catch (error) {
      console.error('사용자 계정 상태 변경 중 서버 에러:', error);
      return fail(res, 500, '서버 오류로 계정 상태 변경에 실패했습니다.');
    }
  },

  /**
   * @function getMyProfile
   * @description [본인] 토큰 주체의 전체 프로필을 DB에서 조회합니다. (마이페이지)
   */
  getMyProfile: async (req, res) => {
    try {
      const profile = await UsersModel.findProfileById(req.user.id);
      if (!profile) {
        return fail(res, 404, '사용자 정보를 찾을 수 없습니다.');
      }
      return success(res, profile);
    } catch (error) {
      console.error('내 프로필 조회 중 서버 에러:', error);
      return fail(res, 500, '서버 오류로 프로필 조회에 실패했습니다.');
    }
  },

  /**
   * @function updateMyProfile
   * @description [본인] 프로필 수정 가능 필드를 부분 업데이트합니다.
   *              보안상 email/studentId/role/account_status는 본 엔드포인트로 변경할 수 없습니다(관리자 전용/불변).
   *
   * Body (모두 선택, 최소 1개): name, department, program, enrollmentYear, researchTopic,
   *                              phone, bio, githubUrl, linkedinUrl, profileImage, isPublic, preferredLanguage
   */
  updateMyProfile: async (req, res) => {
    try {
      const b = req.body || {};

      // camelCase 입력을 DB 컬럼(snake_case)으로 매핑. 전달된 키만 반영합니다.
      const map = {
        name: 'name',
        department: 'department',
        program: 'program',
        enrollmentYear: 'enrollment_year',
        researchTopic: 'research_topic',
        phone: 'phone',
        bio: 'bio',
        githubUrl: 'github_url',
        linkedinUrl: 'linkedin_url',
        profileImage: 'profile_image',
        isPublic: 'is_public_profile',
        preferredLanguage: 'preferred_language',
      };

      const fields = {};
      for (const [inKey, col] of Object.entries(map)) {
        if (b[inKey] !== undefined) fields[col] = b[inKey];
      }

      // 값 검증: program/preferred_language enum, isPublic boolean, name 비어있지 않음
      if (fields.name !== undefined && !fields.name) {
        return fail(res, 400, '이름은 빈 값일 수 없습니다.');
      }
      if (fields.program !== undefined && !['undergrad', 'master', 'phd', 'professor', 'other'].includes(fields.program)) {
        return fail(res, 400, '유효하지 않은 과정(program)입니다.');
      }
      if (fields.preferred_language !== undefined && !['ko', 'en'].includes(fields.preferred_language)) {
        return fail(res, 400, '지원하지 않는 언어입니다. (ko/en)');
      }
      if (fields.is_public_profile !== undefined) {
        fields.is_public_profile = Boolean(fields.is_public_profile);
      }

      if (Object.keys(fields).length === 0) {
        return fail(res, 400, '수정할 프로필 항목을 최소 하나 이상 전달해야 합니다.');
      }

      const updated = await UsersModel.updateProfile(req.user.id, fields);
      return success(res, updated, '프로필이 수정되었습니다.');
    } catch (error) {
      console.error('내 프로필 수정 중 서버 에러:', error);
      return fail(res, 500, '서버 오류로 프로필 수정에 실패했습니다.');
    }
  },

  /**
   * @function changePassword
   * @description [본인] 로그인 상태에서 현재 비밀번호 검증 후 새 비밀번호로 변경합니다.
   *
   * Body: { currentPassword, newPassword }
   */
  changePassword: async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};

      if (!currentPassword || !newPassword) {
        return fail(res, 400, '현재 비밀번호와 새 비밀번호는 필수 입력 항목입니다.');
      }
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return fail(res, 400, `새 비밀번호는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
      }
      if (currentPassword === newPassword) {
        return fail(res, 400, '새 비밀번호가 현재 비밀번호와 동일합니다.');
      }

      const row = await UsersModel.findPasswordHashById(req.user.id);
      if (!row) {
        return fail(res, 404, '사용자 정보를 찾을 수 없습니다.');
      }

      // 현재 비밀번호 일치 검증
      const isMatch = await BcryptUtils.comparePassword(currentPassword, row.password_hash);
      if (!isMatch) {
        return fail(res, 401, '현재 비밀번호가 일치하지 않습니다.');
      }

      const newHash = await BcryptUtils.hashPassword(newPassword);
      await UsersModel.updatePassword(req.user.id, newHash);

      return success(res, null, '비밀번호가 성공적으로 변경되었습니다.');
    } catch (error) {
      console.error('비밀번호 변경 중 서버 에러:', error);
      return fail(res, 500, '서버 오류로 비밀번호 변경에 실패했습니다.');
    }
  }
};

// 모든 메서드가 수용된 유저 컨트롤러 객체를 최하단에서 일괄적으로 내보냅니다.
module.exports = UsersController;
