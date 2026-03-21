-- Use the attendance_system database
USE attendance_system;

-- ============================================================
--  TABLE: departments (must exist before users FK)
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
  id              INT            AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100)   NOT NULL UNIQUE,
  description     TEXT,
  created_at      TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
--  TABLE: users (for both admin and employees)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              INT            AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100)   NOT NULL,
  email           VARCHAR(150)   NOT NULL UNIQUE,
  password        VARCHAR(255)   NOT NULL,
  role            ENUM('admin','employee') NOT NULL DEFAULT 'employee',
  department_id   INT,
  created_at      TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_department
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  INDEX idx_email (email),
  INDEX idx_role  (role)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS attendance (
  id                INT            AUTO_INCREMENT PRIMARY KEY,
  user_id           INT            NOT NULL,
  department_id     INT,

  -- Timestamps (DATETIME so NOW() and DATE() filtering both work correctly)
  check_in_time     DATETIME,
  check_out_time    DATETIME,

  -- Location
  check_in_lat      DECIMAL(10,7),
  check_in_lng      DECIMAL(10,7),
  check_out_lat     DECIMAL(10,7),
  check_out_lng     DECIMAL(10,7),

  -- Selfie / face
  selfie_path       VARCHAR(255),
  face_match_score  DECIMAL(5,2),

  -- Work context
  work_type         ENUM('office','wfh','field') DEFAULT 'office',
  ip_address        VARCHAR(45),

  -- Status — added 'wfh' which was missing from the original ENUM
  status            ENUM('present','absent','late','half-day','wfh') DEFAULT 'present',

  date              DATE           GENERATED ALWAYS AS (DATE(check_in_time)) STORED,

  created_at        TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_att_user   FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
  CONSTRAINT fk_att_dept   FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  UNIQUE KEY uq_user_date (user_id, date),
  INDEX idx_check_in (check_in_time),
  INDEX idx_status   (status)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS face_data (
  id                  INT            AUTO_INCREMENT PRIMARY KEY,
  employee_id         INT            NOT NULL UNIQUE,
  face_id_encrypted   TEXT           NOT NULL,
  iv                  VARCHAR(64)    NOT NULL,
  auth_tag            VARCHAR(64)    NOT NULL,
  avg_score           DECIMAL(5,2)   DEFAULT 0,
  verify_count        INT            DEFAULT 0,
  enrolled_at         TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  last_verified_at    DATETIME,

  CONSTRAINT fk_face_user FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_face_user (employee_id)
) ENGINE=InnoDB;

-- ============================================================
--  SEED DATA — Departments
-- ============================================================
INSERT INTO departments (name, description) VALUES
  ('Engineering',  'Software development and IT'),
  ('Marketing',    'Marketing and sales'),
  ('HR',           'Human resources'),
  ('Finance',      'Finance and accounting'),
  ('Operations',   'Operations and support')
ON DUPLICATE KEY UPDATE description = VALUES(description);


INSERT INTO users (name, email, password, role) VALUES
  ('Admin User', 'admin@company.com',
   '$2b$10$REPLACEME_RUN_THE_COMMAND_ABOVE_TO_GET_REAL_HASH', 'admin')
ON DUPLICATE KEY UPDATE name = VALUES(name);
