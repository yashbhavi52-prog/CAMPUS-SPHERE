require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'collegeeventdb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true
});

app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: 'campussphere.sid',
  secret: process.env.SESSION_SECRET || 'replace-this-session-secret-before-deployment',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = value => String(value ?? '').trim();
const int = value => Number.isInteger(Number(value)) ? Number(value) : NaN;
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
const isRole = (...roles) => (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ message: 'Please log in first.' });
  if (!roles.includes(req.session.user.role)) return res.status(403).json({ message: 'You do not have permission for this action.' });
  next();
};
const signedIn = (req, res, next) => req.session.user ? next() : res.status(401).json({ message: 'Please log in first.' });

async function ensureExtensionTables() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS Clubs (
      club_id INT AUTO_INCREMENT PRIMARY KEY,
      club_name VARCHAR(100) NOT NULL UNIQUE,
      description VARCHAR(500) NULL,
      contact_email VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS UserAccounts (
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
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ClubMemberships (
      membership_id INT AUTO_INCREMENT PRIMARY KEY,
      club_id INT NOT NULL,
      student_id INT NOT NULL,
      membership_status ENUM('Active','Pending','Left') NOT NULL DEFAULT 'Active',
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_club_student (club_id, student_id),
      CONSTRAINT fk_membership_club FOREIGN KEY (club_id) REFERENCES Clubs(club_id) ON DELETE CASCADE,
      CONSTRAINT fk_membership_student FOREIGN KEY (student_id) REFERENCES Students(student_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS EventSettings (
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
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS RegistrationReviews (
      registration_id INT PRIMARY KEY,
      review_status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Approved',
      reviewed_by INT NULL,
      reviewed_at DATETIME NULL,
      review_note VARCHAR(300) NULL,
      CONSTRAINT fk_review_registration FOREIGN KEY (registration_id) REFERENCES Registrations(registration_id) ON DELETE CASCADE,
      CONSTRAINT fk_review_user FOREIGN KEY (reviewed_by) REFERENCES UserAccounts(user_id) ON DELETE SET NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS PaymentTransactions (
      transaction_id INT AUTO_INCREMENT PRIMARY KEY,
      payment_id INT NOT NULL,
      payment_method ENUM('UPI','DEBIT_CARD','CREDIT_CARD','DEMO_FREE') NOT NULL,
      gateway_reference VARCHAR(80) NOT NULL UNIQUE,
      transaction_status ENUM('Success','Failed') NOT NULL DEFAULT 'Success',
      note VARCHAR(200) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_transaction_payment FOREIGN KEY (payment_id) REFERENCES Payments(payment_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS Notifications (
      notification_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(150) NOT NULL,
      message VARCHAR(500) NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES UserAccounts(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS AttendanceRecords (
      attendance_id INT AUTO_INCREMENT PRIMARY KEY,
      registration_id INT NOT NULL UNIQUE,
      attendance_status ENUM('Present','Absent') NOT NULL DEFAULT 'Absent',
      marked_by INT NULL,
      marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_attendance_registration FOREIGN KEY (registration_id) REFERENCES Registrations(registration_id) ON DELETE CASCADE,
      CONSTRAINT fk_attendance_user FOREIGN KEY (marked_by) REFERENCES UserAccounts(user_id) ON DELETE SET NULL
    ) ENGINE=InnoDB`
  ];
  for (const sql of statements) await pool.query(sql);
}

async function ensureDefaultAdmin() {
  const email = clean(process.env.ADMIN_EMAIL || 'admin@campussphere.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe@12345';
  const [[row]] = await pool.query("SELECT user_id FROM UserAccounts WHERE role='admin' LIMIT 1");
  if (!row) {
    const hash = await bcrypt.hash(password, 12);
    await pool.execute(
      "INSERT INTO UserAccounts (email,password_hash,full_name,role) VALUES (?,?,?,'admin')",
      [email, hash, process.env.ADMIN_NAME || 'System Administrator']
    );
    console.log(`Default admin created: ${email}. Change the password before using this beyond a local demo.`);
  }
}

function publicUser(user) {
  return { userId: user.user_id, email: user.email, name: user.full_name, role: user.role, studentId: user.student_id, clubId: user.club_id };
}

// Health/status is intentionally public so the sign-in page can show database status.
app.get('/api/health', asyncRoute(async (req, res) => {
  const [[row]] = await pool.query('SELECT DATABASE() AS databaseName');
  res.json({ status: 'ok', database: row.databaseName });
}));

// AUTHENTICATION -------------------------------------------------------------
app.get('/api/auth/me', (req, res) => res.json({ user: req.session.user || null }));
app.post('/api/auth/signup', asyncRoute(async (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  const department = clean(req.body.department);
  const semester = int(req.body.semester);
  const password = String(req.body.password || '');
  if (name.length < 2 || !validEmail(email) || department.length < 2 || !Number.isInteger(semester) || semester < 1 || semester > 12 || password.length < 8) {
    return res.status(400).json({ message: 'Enter a valid name, email, department, semester (1–12), and password of at least 8 characters.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT student_id FROM Students WHERE email=? FOR UPDATE', [email]);
    let studentId;
    if (existing.length) {
      // Existing sample student rows can be claimed only once; demo setup has no email verification.
      const [account] = await connection.execute('SELECT user_id FROM UserAccounts WHERE email=?', [email]);
      if (account.length) throw Object.assign(new Error('An account already exists for this email. Please log in.'), { status: 409 });
      studentId = existing[0].student_id;
      await connection.execute('UPDATE Students SET student_name=?, department=?, semester=? WHERE student_id=?', [name, department, semester, studentId]);
    } else {
      const [insert] = await connection.execute('INSERT INTO Students (student_name,email,department,semester) VALUES (?,?,?,?)', [name,email,department,semester]);
      studentId = insert.insertId;
    }
    const hash = await bcrypt.hash(password, 12);
    const [userInsert] = await connection.execute("INSERT INTO UserAccounts (email,password_hash,full_name,role,student_id) VALUES (?,?,?,'student',?)", [email,hash,name,studentId]);
    await connection.commit();
    const user = { user_id: userInsert.insertId, email, full_name: name, role: 'student', student_id: studentId, club_id: null };
    req.session.user = publicUser(user);
    res.status(201).json({ message: 'Student account created. Welcome to CampusSphere!', user: req.session.user });
  } catch (error) {
    await connection.rollback();
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This email is already registered.' });
    throw error;
  } finally { connection.release(); }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  const [rows] = await pool.execute('SELECT * FROM UserAccounts WHERE email=? AND is_active=1 LIMIT 1', [email]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) return res.status(401).json({ message: 'Email or password is incorrect.' });
  req.session.user = publicUser(rows[0]);
  res.json({ message: 'Login successful.', user: req.session.user });
}));
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ message: 'Logged out.' })));

// DASHBOARDS -----------------------------------------------------------------
app.get('/api/dashboard', isRole('admin','club_admin'), asyncRoute(async (req, res) => {
  const user = req.session.user;
  const where = user.role === 'club_admin' ? ' AND es.club_id=?' : '';
  const params = user.role === 'club_admin' ? [user.clubId] : [];
  const [[students]] = await pool.query('SELECT COUNT(*) total FROM Students');
  const [[events]] = await pool.query(`SELECT COUNT(*) total FROM Events e LEFT JOIN EventSettings es ON es.event_id=e.event_id WHERE e.event_status<>'Cancelled'${where}`, params);
  const [[registrations]] = await pool.query(`SELECT COUNT(*) total FROM Registrations r JOIN Events e ON e.event_id=r.event_id LEFT JOIN EventSettings es ON es.event_id=e.event_id WHERE r.registration_status<>'Cancelled'${where}`, params);
  const [[payments]] = await pool.query(`SELECT COALESCE(SUM(p.amount),0) total FROM Payments p JOIN Registrations r ON r.registration_id=p.registration_id JOIN Events e ON e.event_id=r.event_id LEFT JOIN EventSettings es ON es.event_id=e.event_id WHERE p.payment_status='Paid'${where}`, params);
  res.json({ totalStudents: students.total, totalEvents: events.total, totalRegistrations: registrations.total, totalCollected: payments.total });
}));
app.get('/api/student/summary', isRole('student'), asyncRoute(async (req,res) => {
  const id=req.session.user.studentId;
  const [[registrations]]=await pool.execute("SELECT COUNT(*) total FROM Registrations WHERE student_id=? AND registration_status<>'Cancelled'",[id]);
  const [[clubs]]=await pool.execute("SELECT COUNT(*) total FROM ClubMemberships WHERE student_id=? AND membership_status='Active'",[id]);
  const [[pending]]=await pool.execute("SELECT COUNT(*) total FROM Registrations r JOIN Payments p ON p.registration_id=r.registration_id WHERE r.student_id=? AND p.payment_status='Pending' AND p.amount>0",[id]);
  const [[paid]]=await pool.execute("SELECT COALESCE(SUM(p.amount),0) total FROM Payments p JOIN Registrations r ON r.registration_id=p.registration_id WHERE r.student_id=? AND p.payment_status='Paid'",[id]);
  res.json({registrations:registrations.total, clubs:clubs.total, pendingPayments:pending.total, paid:paid.total});
}));

// EVENTS ---------------------------------------------------------------------
const eventSelect = `SELECT e.event_id,e.event_name,e.category,e.event_date,e.registration_fee,e.event_status,
  e.venue_id,e.organizer_id,v.venue_name,v.location venue_location,v.capacity,o.organizer_name,
  COUNT(CASE WHEN r.registration_status<>'Cancelled' THEN r.registration_id END) total_registrations,
  es.registration_deadline,es.max_participants,COALESCE(es.audience,'all_students') audience,es.club_id,c.club_name,
  COALESCE(es.max_participants,v.capacity) effective_capacity
  FROM Events e JOIN Venues v ON v.venue_id=e.venue_id JOIN Organizers o ON o.organizer_id=e.organizer_id
  LEFT JOIN Registrations r ON r.event_id=e.event_id LEFT JOIN EventSettings es ON es.event_id=e.event_id LEFT JOIN Clubs c ON c.club_id=es.club_id`;
app.get('/api/events', signedIn, asyncRoute(async (req,res) => {
  const user=req.session.user;
  let where=''; const params=[];
  if(user.role==='student') {
    where=` WHERE e.event_status<>'Cancelled' AND (
      COALESCE(es.audience,'all_students')='all_students' OR EXISTS (
        SELECT 1 FROM ClubMemberships cm WHERE cm.club_id=es.club_id AND cm.student_id=? AND cm.membership_status='Active'
      ))`;
    params.push(user.studentId);
  } else if(user.role==='club_admin') { where=' WHERE es.club_id=?'; params.push(user.clubId); }
  const [rows]=await pool.execute(`${eventSelect}${where} GROUP BY e.event_id,e.event_name,e.category,e.event_date,e.registration_fee,e.event_status,e.venue_id,e.organizer_id,v.venue_name,v.location,v.capacity,o.organizer_name,es.registration_deadline,es.max_participants,es.audience,es.club_id,c.club_name ORDER BY e.event_date,e.event_name`,params);
  res.json(rows);
}));
app.get('/api/venues', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{const [rows]=await pool.query('SELECT venue_id,venue_name,location,capacity FROM Venues ORDER BY venue_name');res.json(rows);}));
app.get('/api/organizers', isRole('admin'), asyncRoute(async(req,res)=>{const [rows]=await pool.query('SELECT organizer_id,organizer_name,email,department FROM Organizers ORDER BY organizer_name');res.json(rows);}));
app.post('/api/organizers', isRole('admin'), asyncRoute(async(req,res)=>{
  const {name,email,department}=req.body;
  if(clean(name).length<2||!validEmail(email)||clean(department).length<2)return res.status(400).json({message:'Enter organizer name, valid email and department.'});
  const [r]=await pool.execute('INSERT INTO Organizers (organizer_name,email,department) VALUES (?,?,?)',[clean(name),clean(email).toLowerCase(),clean(department)]);
  res.status(201).json({organizerId:r.insertId,message:'Organizer added.'});
}));

async function getOrganizerForClub(clubId) {
  const [[club]]=await pool.execute('SELECT club_name,contact_email FROM Clubs WHERE club_id=?',[clubId]);
  if(!club) throw Object.assign(new Error('Club not found.'),{status:404});
  const email=club.contact_email || `club-${clubId}@campussphere.local`;
  const [found]=await pool.execute('SELECT organizer_id FROM Organizers WHERE email=?',[email]);
  if(found.length)return found[0].organizer_id;
  const [insert]=await pool.execute('INSERT INTO Organizers (organizer_name,email,department) VALUES (?,?,?)',[club.club_name,email,'Club']);
  return insert.insertId;
}
function validateEvent(body) {
  const fee=Number(body.registration_fee), max=body.max_participants===''||body.max_participants==null?null:int(body.max_participants);
  if(clean(body.event_name).length<2||clean(body.category).length<2||!/^\d{4}-\d{2}-\d{2}$/.test(clean(body.event_date))||!Number.isFinite(fee)||fee<0||!int(body.venue_id)||!int(body.organizer_id)||!(body.audience==='all_students'||body.audience==='club_members')||(max!==null&&(!Number.isInteger(max)||max<1))) return null;
  return {name:clean(body.event_name),category:clean(body.category),date:body.event_date,fee,venueId:int(body.venue_id),organizerId:int(body.organizer_id),status:body.event_status||'Upcoming',deadline:clean(body.registration_deadline)||null,max,audience:body.audience,clubId:body.club_id?int(body.club_id):null};
}
app.post('/api/events', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const data=validateEvent(req.body); if(!data)return res.status(400).json({message:'Please complete all required event fields. Fee must be zero or more.'});
  const user=req.session.user;
  if(user.role==='club_admin') { data.clubId=user.clubId; data.organizerId=await getOrganizerForClub(user.clubId); }
  if(data.audience==='club_members'&&!data.clubId)return res.status(400).json({message:'Choose a club for a club-members-only event.'});
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [r]=await connection.execute('INSERT INTO Events (event_name,category,event_date,registration_fee,venue_id,organizer_id,event_status) VALUES (?,?,?,?,?,?,?)',[data.name,data.category,data.date,data.fee,data.venueId,data.organizerId,data.status]);
    await connection.execute('INSERT INTO EventSettings (event_id,registration_deadline,max_participants,audience,club_id,created_by_user_id) VALUES (?,?,?,?,?,?)',[r.insertId,data.deadline,data.max,data.audience,data.clubId,user.userId]);
    await connection.commit(); res.status(201).json({message:'Event created successfully.',eventId:r.insertId});
  }catch(e){await connection.rollback();throw e;}finally{connection.release();}
}));
app.put('/api/events/:id', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const id=int(req.params.id), data=validateEvent(req.body); if(!data)return res.status(400).json({message:'Please complete all required event fields.'});
  const user=req.session.user;
  const [[existing]]=await pool.execute('SELECT es.club_id FROM Events e LEFT JOIN EventSettings es ON es.event_id=e.event_id WHERE e.event_id=?',[id]);
  if(!existing)return res.status(404).json({message:'Event not found.'});
  if(user.role==='club_admin'&&existing.club_id!==user.clubId)return res.status(403).json({message:'You can edit only your club events.'});
  if(user.role==='club_admin'){data.clubId=user.clubId;data.organizerId=await getOrganizerForClub(user.clubId);}
  await pool.execute('UPDATE Events SET event_name=?,category=?,event_date=?,registration_fee=?,venue_id=?,organizer_id=?,event_status=? WHERE event_id=?',[data.name,data.category,data.date,data.fee,data.venueId,data.organizerId,data.status,id]);
  await pool.execute('INSERT INTO EventSettings (event_id,registration_deadline,max_participants,audience,club_id,created_by_user_id) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE registration_deadline=VALUES(registration_deadline),max_participants=VALUES(max_participants),audience=VALUES(audience),club_id=VALUES(club_id)',[id,data.deadline,data.max,data.audience,data.clubId,user.userId]);
  res.json({message:'Event updated.'});
}));
app.delete('/api/events/:id', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const id=int(req.params.id),user=req.session.user;
  const [[ev]]=await pool.execute('SELECT es.club_id FROM Events e LEFT JOIN EventSettings es ON es.event_id=e.event_id WHERE e.event_id=?',[id]);
  if(!ev)return res.status(404).json({message:'Event not found.'});
  if(user.role==='club_admin'&&ev.club_id!==user.clubId)return res.status(403).json({message:'You can manage only your club events.'});
  const [[count]]=await pool.execute('SELECT COUNT(*) total FROM Registrations WHERE event_id=?',[id]);
  if(count.total>0){await pool.execute("UPDATE Events SET event_status='Cancelled' WHERE event_id=?",[id]);return res.json({message:'Event has registrations, so it was marked Cancelled to preserve history.'});}
  await pool.execute('DELETE FROM Events WHERE event_id=?',[id]);res.json({message:'Event deleted.'});
}));

// STUDENT DIRECTORY ----------------------------------------------------------
app.get('/api/students', isRole('admin'), asyncRoute(async(req,res)=>{const [rows]=await pool.query('SELECT student_id,student_name,email,department,semester FROM Students ORDER BY student_name');res.json(rows);}));
app.post('/api/students', isRole('admin'), asyncRoute(async(req,res)=>{
  const name=clean(req.body.student_name),email=clean(req.body.email).toLowerCase(),department=clean(req.body.department),semester=int(req.body.semester);
  if(name.length<2||!validEmail(email)||department.length<2||!Number.isInteger(semester)||semester<1||semester>12)return res.status(400).json({message:'Enter valid student details.'});
  const [r]=await pool.execute('INSERT INTO Students (student_name,email,department,semester) VALUES (?,?,?,?)',[name,email,department,semester]);res.status(201).json({studentId:r.insertId,message:'Student added.'});
}));
app.put('/api/students/:id', isRole('admin'), asyncRoute(async(req,res)=>{
  const id=int(req.params.id),name=clean(req.body.student_name),email=clean(req.body.email).toLowerCase(),department=clean(req.body.department),semester=int(req.body.semester);
  if(name.length<2||!validEmail(email)||department.length<2||!Number.isInteger(semester)||semester<1||semester>12)return res.status(400).json({message:'Enter valid student details.'});
  await pool.execute('UPDATE Students SET student_name=?,email=?,department=?,semester=? WHERE student_id=?',[name,email,department,semester,id]);
  await pool.execute('UPDATE UserAccounts SET full_name=?,email=? WHERE student_id=?',[name,email,id]);res.json({message:'Student updated.'});
}));
app.delete('/api/students/:id', isRole('admin'), asyncRoute(async(req,res)=>{
  const id=int(req.params.id);const [[count]]=await pool.execute('SELECT COUNT(*) total FROM Registrations WHERE student_id=?',[id]);
  if(count.total>0)return res.status(409).json({message:'This student has registration history. Keep the record to preserve event history; you can disable the login instead.'});
  await pool.execute('DELETE FROM Students WHERE student_id=?',[id]);res.json({message:'Student deleted.'});
}));

// CLUBS ----------------------------------------------------------------------
app.get('/api/clubs', signedIn, asyncRoute(async(req,res)=>{
  const user=req.session.user;
  const [rows]=await pool.execute(`SELECT c.club_id,c.club_name,c.description,c.contact_email,
    COUNT(CASE WHEN cm.membership_status='Active' THEN cm.student_id END) member_count,
    MAX(CASE WHEN cm.student_id=? AND cm.membership_status='Active' THEN 1 ELSE 0 END) is_member
    FROM Clubs c LEFT JOIN ClubMemberships cm ON cm.club_id=c.club_id GROUP BY c.club_id ORDER BY c.club_name`,[user.studentId||0]);
  res.json(rows);
}));
app.post('/api/clubs', isRole('admin'), asyncRoute(async(req,res)=>{
  const name=clean(req.body.club_name),email=clean(req.body.contact_email).toLowerCase(),description=clean(req.body.description),adminName=clean(req.body.admin_name),adminEmail=clean(req.body.admin_email).toLowerCase(),password=String(req.body.admin_password||'');
  if(name.length<2||!validEmail(email)||adminName.length<2||!validEmail(adminEmail)||password.length<8)return res.status(400).json({message:'Enter club details and a club-admin password of at least 8 characters.'});
  const conn=await pool.getConnection();try{
    await conn.beginTransaction();
    const [c]=await conn.execute('INSERT INTO Clubs (club_name,description,contact_email) VALUES (?,?,?)',[name,description,email]);
    const hash=await bcrypt.hash(password,12);
    await conn.execute("INSERT INTO UserAccounts (email,password_hash,full_name,role,club_id) VALUES (?,?,?,'club_admin',?)",[adminEmail,hash,adminName,c.insertId]);
    await conn.commit();res.status(201).json({message:'Club and club-admin account created.'});
  }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')return res.status(409).json({message:'Club name or admin email already exists.'});throw e;}finally{conn.release();}
}));
app.post('/api/clubs/:id/join', isRole('student'), asyncRoute(async(req,res)=>{
  const clubId=int(req.params.id),studentId=req.session.user.studentId;
  await pool.execute("INSERT INTO ClubMemberships (club_id,student_id,membership_status) VALUES (?,?, 'Active') ON DUPLICATE KEY UPDATE membership_status='Active'",[clubId,studentId]);
  res.json({message:'You joined the club.'});
}));
app.get('/api/clubs/:id/members', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const id=int(req.params.id),user=req.session.user;if(user.role==='club_admin'&&user.clubId!==id)return res.status(403).json({message:'You can view only your club members.'});
  const [rows]=await pool.execute("SELECT s.student_id,s.student_name,s.email,s.department,s.semester,cm.joined_at FROM ClubMemberships cm JOIN Students s ON s.student_id=cm.student_id WHERE cm.club_id=? AND cm.membership_status='Active' ORDER BY s.student_name",[id]);res.json(rows);
}));

// REGISTRATIONS --------------------------------------------------------------
async function createRegistration(studentId,eventId){
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [events]=await conn.execute(`SELECT e.event_id,e.registration_fee,e.event_status,es.registration_deadline,es.max_participants,
      COALESCE(es.audience,'all_students') audience,es.club_id,v.capacity
      FROM Events e JOIN Venues v ON v.venue_id=e.venue_id LEFT JOIN EventSettings es ON es.event_id=e.event_id WHERE e.event_id=? FOR UPDATE`,[eventId]);
    if(!events.length)throw Object.assign(new Error('Event not found.'),{status:404});
    const event=events[0];
    if(event.event_status!=='Upcoming')throw Object.assign(new Error('This event is not open for registration.'),{status:409});
    if(event.registration_deadline&&new Date(event.registration_deadline).getTime()<Date.now())throw Object.assign(new Error('Registration deadline has passed.'),{status:409});
    if(event.audience==='club_members'){
      const [[member]]=await conn.execute("SELECT membership_id FROM ClubMemberships WHERE club_id=? AND student_id=? AND membership_status='Active'",[event.club_id,studentId]);
      if(!member)throw Object.assign(new Error('This event is only for active members of its club.'),{status:403});
    }
    const [[count]]=await conn.execute("SELECT COUNT(*) total FROM Registrations WHERE event_id=? AND registration_status<>'Cancelled'",[eventId]);
    const cap=event.max_participants||event.capacity;
    if(count.total>=cap)throw Object.assign(new Error('Registration is closed because the participant limit has been reached.'),{status:409});
    const [r]=await conn.execute("INSERT INTO Registrations (student_id,event_id,registration_status) VALUES (?,?,'Registered')",[studentId,eventId]);
    const [p]=await conn.execute("INSERT INTO Payments (registration_id,amount,payment_status) VALUES (?,?,?)",[r.insertId,event.registration_fee,event.registration_fee===0?'Paid':'Pending']);
    await conn.execute("INSERT INTO RegistrationReviews (registration_id,review_status) VALUES (?,'Pending')",[r.insertId]);
    const [studentUsers]=await conn.execute("SELECT user_id FROM UserAccounts WHERE student_id=?",[studentId]);
    if(studentUsers.length) await conn.execute('INSERT INTO Notifications (user_id,title,message) VALUES (?,?,?)',[studentUsers[0].user_id,'Registration received','Your event registration has been received and is awaiting review.']);
    const [clubAdmins]=event.club_id?await conn.execute("SELECT user_id FROM UserAccounts WHERE role='club_admin' AND club_id=?",[event.club_id]):[[]];
    for(const admin of clubAdmins) await conn.execute('INSERT INTO Notifications (user_id,title,message) VALUES (?,?,?)',[admin.user_id,'New event registration',`A student registered for event #${eventId}. Please review the registration.`]);
    const [admins]=await conn.execute("SELECT user_id FROM UserAccounts WHERE role='admin'");
    for(const admin of admins) await conn.execute('INSERT INTO Notifications (user_id,title,message) VALUES (?,?,?)',[admin.user_id,'New event registration',`A student registered for event #${eventId}.`]);
    if(event.registration_fee===0){await conn.execute("INSERT INTO PaymentTransactions (payment_id,payment_method,gateway_reference,transaction_status,note) VALUES (?,'DEMO_FREE',?,'Success','No fee for this event')",[p.insertId,`FREE-${crypto.randomBytes(5).toString('hex')}`]);}
    await conn.commit();return {registrationId:r.insertId,paymentId:p.insertId,amount:event.registration_fee};
  }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')throw Object.assign(new Error('You are already registered for this event.'),{status:409});if(e.sqlState==='45000')throw Object.assign(new Error(e.message),{status:409});throw e;}finally{conn.release();}
}
app.post('/api/events/:id/register', isRole('student'), asyncRoute(async(req,res)=>{
  const eventId=int(req.params.id);if(!Number.isInteger(eventId)||eventId<1)return res.status(400).json({message:'Invalid event.'});
  const result=await createRegistration(req.session.user.studentId,eventId);res.status(201).json({message:result.amount>0?'Registration created. Complete the demo checkout from My Registrations.':'You are registered. This is a free event.',...result});
}));
app.get('/api/student/registrations', isRole('student'), asyncRoute(async(req,res)=>{
  const [rows]=await pool.execute(`SELECT r.registration_id,r.event_id,r.registration_date,r.registration_status,e.event_name,e.event_date,e.registration_fee,
    COALESCE(rv.review_status,'Approved') review_status,p.payment_id,p.amount,p.payment_status,
    (SELECT pt.payment_method FROM PaymentTransactions pt WHERE pt.payment_id=p.payment_id ORDER BY pt.transaction_id DESC LIMIT 1) payment_method
    FROM Registrations r JOIN Events e ON e.event_id=r.event_id LEFT JOIN RegistrationReviews rv ON rv.registration_id=r.registration_id
    LEFT JOIN Payments p ON p.registration_id=r.registration_id WHERE r.student_id=? ORDER BY r.registration_date DESC`,[req.session.user.studentId]);res.json(rows);
}));
app.get('/api/registrations', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const user=req.session.user;const params=[];let where='';if(user.role==='club_admin'){where=' WHERE es.club_id=?';params.push(user.clubId);}
  const [rows]=await pool.execute(`SELECT r.registration_id,r.registration_date,r.registration_status,s.student_id,s.student_name,s.department,e.event_id,e.event_name,
    COALESCE(rv.review_status,'Approved') review_status,p.payment_status,p.amount,es.club_id
    FROM Registrations r JOIN Students s ON s.student_id=r.student_id JOIN Events e ON e.event_id=r.event_id
    LEFT JOIN EventSettings es ON es.event_id=e.event_id LEFT JOIN RegistrationReviews rv ON rv.registration_id=r.registration_id
    LEFT JOIN Payments p ON p.registration_id=r.registration_id${where} ORDER BY r.registration_date DESC`,params);res.json(rows);
}));
app.patch('/api/registrations/:id/review', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const id=int(req.params.id),status=req.body.status;if(!['Approved','Rejected'].includes(status))return res.status(400).json({message:'Status must be Approved or Rejected.'});
  const user=req.session.user;
  const [[row]]=await pool.execute('SELECT es.club_id FROM Registrations r JOIN Events e ON e.event_id=r.event_id LEFT JOIN EventSettings es ON es.event_id=e.event_id WHERE r.registration_id=?',[id]);
  if(!row)return res.status(404).json({message:'Registration not found.'});if(user.role==='club_admin'&&row.club_id!==user.clubId)return res.status(403).json({message:'You can review only your club registrations.'});
  await pool.execute('INSERT INTO RegistrationReviews (registration_id,review_status,reviewed_by,reviewed_at) VALUES (?,?,?,NOW()) ON DUPLICATE KEY UPDATE review_status=VALUES(review_status),reviewed_by=VALUES(reviewed_by),reviewed_at=NOW()',[id,status,user.userId]);
  if(status==='Rejected')await pool.execute("UPDATE Registrations SET registration_status='Cancelled' WHERE registration_id=?",[id]);
  res.json({message:`Registration ${status.toLowerCase()}.`});
}));
app.post('/api/registrations/:id/cancel', isRole('student','admin'), asyncRoute(async(req,res)=>{
  const id=int(req.params.id),user=req.session.user;
  const [[row]]=await pool.execute('SELECT student_id FROM Registrations WHERE registration_id=?',[id]);
  if(!row)return res.status(404).json({message:'Registration not found.'});if(user.role==='student'&&row.student_id!==user.studentId)return res.status(403).json({message:'This is not your registration.'});
  await pool.execute("UPDATE Registrations SET registration_status='Cancelled' WHERE registration_id=?",[id]);res.json({message:'Registration cancelled. Any paid amount must be refunded through the college payment provider process.'});
}));

// PAYMENTS: demo checkout only. Never collect/store actual card numbers, CVV, UPI PIN or bank credentials here.
app.get('/api/student/payments', isRole('student'), asyncRoute(async(req,res)=>{
  const [rows]=await pool.execute(`SELECT p.payment_id,p.amount,p.payment_status,p.payment_date,e.event_name,
    (SELECT pt.payment_method FROM PaymentTransactions pt WHERE pt.payment_id=p.payment_id ORDER BY pt.transaction_id DESC LIMIT 1) payment_method,
    (SELECT pt.gateway_reference FROM PaymentTransactions pt WHERE pt.payment_id=p.payment_id ORDER BY pt.transaction_id DESC LIMIT 1) reference
    FROM Payments p JOIN Registrations r ON r.registration_id=p.registration_id JOIN Events e ON e.event_id=r.event_id WHERE r.student_id=? ORDER BY p.payment_id DESC`,[req.session.user.studentId]);res.json(rows);
}));
app.get('/api/payments', isRole('admin'), asyncRoute(async(req,res)=>{
  const [rows]=await pool.query(`SELECT p.payment_id,p.amount,p.payment_status,p.payment_date,s.student_name,e.event_name,
    (SELECT pt.payment_method FROM PaymentTransactions pt WHERE pt.payment_id=p.payment_id ORDER BY pt.transaction_id DESC LIMIT 1) payment_method,
    (SELECT pt.gateway_reference FROM PaymentTransactions pt WHERE pt.payment_id=p.payment_id ORDER BY pt.transaction_id DESC LIMIT 1) reference
    FROM Payments p JOIN Registrations r ON r.registration_id=p.registration_id JOIN Students s ON s.student_id=r.student_id JOIN Events e ON e.event_id=r.event_id ORDER BY p.payment_id DESC`);res.json(rows);
}));
app.post('/api/payments/:id/demo-checkout', isRole('student'), asyncRoute(async(req,res)=>{
  const paymentId=int(req.params.id),method=req.body.method;
  if(!['UPI','DEBIT_CARD','CREDIT_CARD'].includes(method))return res.status(400).json({message:'Choose UPI, debit card or credit card.'});
  const [[row]]=await pool.execute('SELECT p.payment_id,p.amount,p.payment_status,r.student_id FROM Payments p JOIN Registrations r ON r.registration_id=p.registration_id WHERE p.payment_id=?',[paymentId]);
  if(!row)return res.status(404).json({message:'Payment not found.'});if(row.student_id!==req.session.user.studentId)return res.status(403).json({message:'This payment does not belong to your account.'});if(row.payment_status==='Paid')return res.status(409).json({message:'This payment is already marked as paid.'});
  const ref=`DEMO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  await pool.execute("UPDATE Payments SET payment_status='Paid',payment_date=NOW() WHERE payment_id=?",[paymentId]);
  await pool.execute("INSERT INTO PaymentTransactions (payment_id,payment_method,gateway_reference,transaction_status,note) VALUES (?,?,?,'Success','Simulated checkout for project demonstration')",[paymentId,method,ref]);
  await pool.execute('INSERT INTO Notifications (user_id,title,message) VALUES (?,?,?)',[req.session.user.userId,'Demo payment successful',`Your demo payment for ${row.amount} has been marked Paid.`]);
  res.json({message:`Demo ${method.replace('_',' ').toLowerCase()} payment marked successful. No real money was charged.`,reference:ref});
}));

// ATTENDANCE ------------------------------------------------------------------
// Attendance is recorded against an event registration, so only registered participants can be marked.
app.get('/api/attendance/events', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const user=req.session.user, params=[]; let where='';
  if(user.role==='club_admin'){where=' WHERE es.club_id=?';params.push(user.clubId);}
  const [rows]=await pool.execute(`SELECT e.event_id,e.event_name,e.event_date,e.event_status,COALESCE(es.club_id,0) club_id,
    COUNT(r.registration_id) participants,
    COUNT(ar.attendance_id) marked,
    SUM(CASE WHEN ar.attendance_status='Present' THEN 1 ELSE 0 END) present_count
    FROM Events e LEFT JOIN EventSettings es ON es.event_id=e.event_id
    LEFT JOIN Registrations r ON r.event_id=e.event_id AND r.registration_status<>'Cancelled'
    LEFT JOIN AttendanceRecords ar ON ar.registration_id=r.registration_id${where}
    GROUP BY e.event_id,e.event_name,e.event_date,e.event_status,es.club_id ORDER BY e.event_date DESC`,params);
  res.json(rows);
}));
app.get('/api/attendance/event/:id', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const id=int(req.params.id), user=req.session.user;
  const [[event]]=await pool.execute('SELECT e.event_id,e.event_name,es.club_id FROM Events e LEFT JOIN EventSettings es ON es.event_id=e.event_id WHERE e.event_id=?',[id]);
  if(!event)return res.status(404).json({message:'Event not found.'});
  if(user.role==='club_admin'&&event.club_id!==user.clubId)return res.status(403).json({message:'You can manage attendance only for your club events.'});
  const [rows]=await pool.execute(`SELECT r.registration_id,s.student_id,s.student_name,s.email,s.department,
    COALESCE(ar.attendance_status,'Absent') attendance_status
    FROM Registrations r JOIN Students s ON s.student_id=r.student_id
    LEFT JOIN AttendanceRecords ar ON ar.registration_id=r.registration_id
    WHERE r.event_id=? AND r.registration_status<>'Cancelled' ORDER BY s.student_name`,[id]);
  res.json({event,participants:rows});
}));
app.put('/api/attendance/event/:id', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const id=int(req.params.id), user=req.session.user, records=Array.isArray(req.body.records)?req.body.records:[];
  const [[event]]=await pool.execute('SELECT event_id, (SELECT club_id FROM EventSettings WHERE event_id=Events.event_id) club_id FROM Events WHERE event_id=?',[id]);
  if(!event)return res.status(404).json({message:'Event not found.'});
  if(user.role==='club_admin'&&event.club_id!==user.clubId)return res.status(403).json({message:'You can manage attendance only for your club events.'});
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    for(const item of records){
      const registrationId=int(item.registration_id), status=item.status==='Present'?'Present':'Absent';
      const [[reg]]=await conn.execute('SELECT registration_id FROM Registrations WHERE registration_id=? AND event_id=? AND registration_status<>\'Cancelled\'', [registrationId,id]);
      if(!reg)continue;
      await conn.execute(`INSERT INTO AttendanceRecords (registration_id,attendance_status,marked_by) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE attendance_status=VALUES(attendance_status),marked_by=VALUES(marked_by)`,[registrationId,status,user.userId]);
    }
    await conn.commit();res.json({message:'Attendance saved successfully.'});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));
app.get('/api/student/attendance', isRole('student'), asyncRoute(async(req,res)=>{
  const [rows]=await pool.execute(`SELECT e.event_name,e.event_date,COALESCE(ar.attendance_status,'Not marked') attendance_status,
    ar.marked_at FROM Registrations r JOIN Events e ON e.event_id=r.event_id
    LEFT JOIN AttendanceRecords ar ON ar.registration_id=r.registration_id
    WHERE r.student_id=? AND r.registration_status<>'Cancelled' ORDER BY e.event_date DESC`,[req.session.user.studentId]);
  res.json(rows);
}));

// RESULTS --------------------------------------------------------------------
app.get('/api/results', signedIn, asyncRoute(async(req,res)=>{
  const user=req.session.user;let sql=`SELECT rs.result_id,rs.score,rs.position,rs.remarks,s.student_name,e.event_name,e.event_id FROM Results rs JOIN Registrations r ON r.registration_id=rs.registration_id JOIN Students s ON s.student_id=r.student_id JOIN Events e ON e.event_id=r.event_id`;let params=[];
  if(user.role==='student'){sql+=' WHERE r.student_id=?';params.push(user.studentId);}else if(user.role==='club_admin'){sql+=' JOIN EventSettings es ON es.event_id=e.event_id WHERE es.club_id=?';params.push(user.clubId);}
  sql+=' ORDER BY e.event_name,rs.position';const [rows]=await pool.execute(sql,params);res.json(rows);
}));
app.post('/api/results', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const registrationId=int(req.body.registration_id),score=Number(req.body.score),position=req.body.position?int(req.body.position):null,remarks=clean(req.body.remarks);
  if(!Number.isInteger(registrationId)||!Number.isFinite(score)||score<0||(position!==null&&(!Number.isInteger(position)||position<1)))return res.status(400).json({message:'Enter valid registration, score and position.'});
  const user=req.session.user;const [[row]]=await pool.execute('SELECT es.club_id FROM Registrations r JOIN Events e ON e.event_id=r.event_id LEFT JOIN EventSettings es ON es.event_id=e.event_id WHERE r.registration_id=?',[registrationId]);
  if(!row)return res.status(404).json({message:'Registration not found.'});if(user.role==='club_admin'&&row.club_id!==user.clubId)return res.status(403).json({message:'You can add results only for your club events.'});
  await pool.execute('INSERT INTO Results (registration_id,score,position,remarks) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE score=VALUES(score),position=VALUES(position),remarks=VALUES(remarks)',[registrationId,score,position,remarks||null]);res.status(201).json({message:'Result saved.'});
}));

// REPORTS --------------------------------------------------------------------
function csvEscape(v){const s=String(v??'');return `"${s.replace(/"/g,'""')}"`;}
app.get('/api/reports/registrations.csv', isRole('admin','club_admin'), asyncRoute(async(req,res)=>{
  const user=req.session.user,params=[];let where='';if(user.role==='club_admin'){where=' WHERE es.club_id=?';params.push(user.clubId);}
  const [rows]=await pool.execute(`SELECT s.student_name,s.email,s.department,e.event_name,e.event_date,r.registration_date,r.registration_status,COALESCE(rv.review_status,'Approved') review_status,p.amount,p.payment_status FROM Registrations r JOIN Students s ON s.student_id=r.student_id JOIN Events e ON e.event_id=r.event_id LEFT JOIN EventSettings es ON es.event_id=e.event_id LEFT JOIN RegistrationReviews rv ON rv.registration_id=r.registration_id LEFT JOIN Payments p ON p.registration_id=r.registration_id${where} ORDER BY r.registration_date DESC`,params);
  const headers=Object.keys(rows[0]||{student_name:'',email:'',department:'',event_name:'',event_date:'',registration_date:'',registration_status:'',review_status:'',amount:'',payment_status:''});
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="campussphere-registrations.csv"');res.send('\uFEFF'+[headers.map(csvEscape).join(','),...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))].join('\r\n'));
}));
app.get('/api/reports/payments.csv', isRole('admin'), asyncRoute(async(req,res)=>{
  const [rows]=await pool.query('SELECT s.student_name,s.email,e.event_name,p.amount,p.payment_status,p.payment_date FROM Payments p JOIN Registrations r ON r.registration_id=p.registration_id JOIN Students s ON s.student_id=r.student_id JOIN Events e ON e.event_id=r.event_id ORDER BY p.payment_id DESC');
  const headers=['student_name','email','event_name','amount','payment_status','payment_date'];res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="campussphere-payments.csv"');res.send('\uFEFF'+[headers.map(csvEscape).join(','),...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))].join('\r\n'));
}));

// Notifications --------------------------------------------------------------
app.get('/api/notifications', signedIn, asyncRoute(async(req,res)=>{const [rows]=await pool.execute('SELECT notification_id,title,message,is_read,created_at FROM Notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30',[req.session.user.userId]);res.json(rows);}));
app.post('/api/notifications/:id/read', signedIn, asyncRoute(async(req,res)=>{await pool.execute('UPDATE Notifications SET is_read=1 WHERE notification_id=? AND user_id=?',[int(req.params.id),req.session.user.userId]);res.json({message:'Marked as read.'});}));

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((error,req,res,next)=>{
  console.error('API error:',error.code||error.message);
  if(res.headersSent)return next(error);
  if(error.status)return res.status(error.status).json({message:error.message});
  if(error.code==='ER_DUP_ENTRY')return res.status(409).json({message:'A record with these details already exists.'});
  if(error.code==='ER_NO_REFERENCED_ROW_2'||error.code==='ER_ROW_IS_REFERENCED_2')return res.status(409).json({message:'This record is linked to other records and cannot be changed this way.'});
  res.status(500).json({message:'Something went wrong. Check the VS Code terminal for details.'});
});

async function start(){
  try{
    await pool.query('SELECT 1');
    await ensureExtensionTables();
    await ensureDefaultAdmin();
    app.listen(PORT,()=>console.log(`CampusSphere is running at http://localhost:${PORT}\nMySQL database: ${process.env.DB_NAME||'collegeeventdb'}`));
  }catch(error){
    console.error('Startup failed:',error.code||error.message);
    console.error('Check MySQL Server, .env credentials, and the original CollegeEventDB tables.');
    process.exit(1);
  }
}
start();
