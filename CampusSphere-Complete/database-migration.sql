-- CampusSphere upgrade migration for the existing collegeeventdb database.
-- IMPORTANT: This script DOES NOT DROP, rename, or erase your existing tables/data.
-- Select collegeeventdb first, then execute this script once in MySQL Workbench.
USE collegeeventdb;

CREATE TABLE IF NOT EXISTS Clubs (
  club_id INT AUTO_INCREMENT PRIMARY KEY,
  club_name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500) NULL,
  contact_email VARCHAR(120) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS UserAccounts (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('student','admin','club_admin') NOT NULL DEFAULT 'student',
  student_id INT NULL UNIQUE,
  club_id INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_student FOREIGN KEY (student_id) REFERENCES Students(student_id) ON DELETE SET NULL,
  CONSTRAINT fk_user_club FOREIGN KEY (club_id) REFERENCES Clubs(club_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ClubMemberships (
  membership_id INT AUTO_INCREMENT PRIMARY KEY,
  club_id INT NOT NULL,
  student_id INT NOT NULL,
  membership_status ENUM('Active','Pending','Left') NOT NULL DEFAULT 'Active',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_club_student (club_id, student_id),
  CONSTRAINT fk_membership_club FOREIGN KEY (club_id) REFERENCES Clubs(club_id) ON DELETE CASCADE,
  CONSTRAINT fk_membership_student FOREIGN KEY (student_id) REFERENCES Students(student_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS EventSettings (
  event_id INT PRIMARY KEY,
  registration_deadline DATETIME NULL,
  max_participants INT NULL,
  audience ENUM('all_students','club_members') NOT NULL DEFAULT 'all_students',
  club_id INT NULL,
  created_by_user_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_event_settings_event FOREIGN KEY (event_id) REFERENCES Events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_event_settings_club FOREIGN KEY (club_id) REFERENCES Clubs(club_id) ON DELETE SET NULL,
  CONSTRAINT fk_event_settings_user FOREIGN KEY (created_by_user_id) REFERENCES UserAccounts(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS RegistrationReviews (
  registration_id INT PRIMARY KEY,
  review_status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Approved',
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  review_note VARCHAR(300) NULL,
  CONSTRAINT fk_review_registration FOREIGN KEY (registration_id) REFERENCES Registrations(registration_id) ON DELETE CASCADE,
  CONSTRAINT fk_review_user FOREIGN KEY (reviewed_by) REFERENCES UserAccounts(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS PaymentTransactions (
  transaction_id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  payment_method ENUM('UPI','DEBIT_CARD','CREDIT_CARD','DEMO_FREE') NOT NULL,
  gateway_reference VARCHAR(80) NOT NULL UNIQUE,
  transaction_status ENUM('Success','Failed') NOT NULL DEFAULT 'Success',
  note VARCHAR(200) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transaction_payment FOREIGN KEY (payment_id) REFERENCES Payments(payment_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Notifications (
  notification_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  message VARCHAR(500) NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES UserAccounts(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- New accounts are created by the application. The original Students, Events,
-- Registrations, Results, Payments, Organizers and Venues tables remain intact.
