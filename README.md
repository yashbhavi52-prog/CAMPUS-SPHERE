# CampusSphere — College Event Management System

A local college DBMS project with three role-based workspaces: Student, Administrator, and Club Admin.
It reuses the existing MySQL database (`collegeeventdb`) and does not drop or recreate it.

## Included features

- Student sign up, login, and logout.
- Admin and club-admin login with role-based workspaces.
- Admin student directory: add, edit, search, and delete students where no registration history exists.
- Event creation and editing with fee, venue, registration deadline, maximum participants, and audience controls.
- Club directory; admin creates clubs and a club-admin login for each club.
- Club admin can create events for their club and choose **Open for all students** or **Club members only**.
- Students can join clubs, discover available events, register, cancel, and view their registrations.
- Duplicate registration and venue/participant capacity protection.
- Registration review controls for administrator and club admin.
- Results / leaderboard records.
- Payment history and demo payment choices: UPI, debit card, credit card.
- CSV reports for registrations and payments; browser print can save a page as PDF.
- Dark / light theme toggle, search, responsive layout.

## Important payment note

The payment screen is a **simulation for a college project demonstration**. It records a demo transaction reference and marks the payment as Paid. It does not connect to UPI apps, banks, card networks, or charge real money. It never asks for or stores a card number, CVV, UPI PIN, or bank password.

To accept real payments, a college-owned merchant account and a supported payment gateway (in its test mode first) must be configured by an authorised adult/college representative. Do not collect card or UPI credentials in this app.

## Requirements

- Node.js and npm
- MySQL Server running locally
- Existing project database with the original tables: `Students`, `Organizers`, `Venues`, `Events`, `Registrations`, `Results`, `Payments`

## Setup

1. Keep your current `.env` file backed up. Create a `.env` file in this project folder by copying `.env.example`.
2. Put your local MySQL password in `DB_PASSWORD`. Keep `DB_NAME=collegeeventdb` (the schema shown in Workbench). Do not use the Workbench connection label `CAPSTONE PROJECT` as the database name.
3. Install dependencies:

   ```bash
   npm install
   ```

4. The app creates only its extra tables (`Clubs`, `UserAccounts`, `ClubMemberships`, `EventSettings`, `RegistrationReviews`, `PaymentTransactions`, `Notifications`) at startup. It does not drop or erase existing tables.
5. Start the app:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000`.

The same extension tables are also defined in `database-migration.sql` if you prefer to run the migration manually in MySQL Workbench first. The application will safely skip tables that already exist.

## First administrator login

On the first run, the app creates an administrator if no administrator account exists:

- Email: `admin@campussphere.local`
- Password: `ChangeMe@12345`

Change `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` before using the application beyond a local classroom demonstration. If your default admin account has already been created, changing these variables does not change that existing account's password.

## Student sign up

Students can use the Student sign up tab with their name, college email, department, semester, and a password of at least 8 characters. For this local demo, no email verification is configured. Use test/student data only.

## Club admin workflow

1. Sign in as the administrator.
2. Open **Clubs & club admins**.
3. Create a club and set a club-admin name, email, and password.
4. Sign out and sign in using that club-admin account.
5. Open **Club events** and create an event. Choose whether it is open to all students or only club members.

## Existing database safety

Do not run the original starter SQL script again, because it begins with `DROP DATABASE`. This upgraded app only adds extension tables and leaves existing college event records in place.

## Notes / production limitations

- Sessions use Express's in-memory session store for this local project. Replace it with a persistent session store before deployment.
- Local demo signup does not include email verification or password reset.
- Real payment gateway integration, refunds, email/SMS notifications, and production hardening are not enabled in this project package.


## Admin and attendance features
- The administrator signs in using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the local `.env` file. These are separate from a student login.
- Admin navigation includes Students, Clubs & club admins, Registrations, Events, and Attendance.
- Admins and club admins can mark Present/Absent for registered event participants. Students can see their own records in My attendance.
- The server creates the `AttendanceRecords` table automatically at startup; existing database records are not dropped.


## If the administrator login does not open the Admin Dashboard

The Admin Dashboard and admin navigation are included in `public/app.js`. The menu is shown only when the logged-in account has the `admin` role.

If the admin email/password in `.env` were changed after an administrator account had already been created, the old password hash may still be stored in MySQL. To explicitly create/reset the configured administrator account:

1. Start the app once with `npm run dev` so the extension tables are created, then stop it with Ctrl+C.
2. Run `npm run reset-admin` once from this project folder.
3. Start the app again with `npm run dev`.
4. Log in using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from your local `.env`.

This command only creates/updates the administrator account matching `ADMIN_EMAIL`. It does not drop or modify the Students, Events, Registrations, Payments, or other event data tables. If that email belonged to a student account, that account is converted to the administrator account and detached from its student profile.
