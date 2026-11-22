const $$ = (s) => Array.from(document.querySelectorAll(s));
const $ = (s) => document.querySelector(s);
const esc = (v='') => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(v||0));
const dateFmt = v => { if(!v) return '—'; const d=new Date(String(v).replace(' ','T')); return isNaN(d)?String(v):d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); };
const initials = name => String(name||'U').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
let currentUser=null, currentPage='dashboard', theme=localStorage.getItem('campussphere-theme')||'light';
let cache={events:[],students:[],clubs:[],registrations:[],venues:[],organizers:[]};

async function api(url, options={}) {
  const opts={...options,credentials:'same-origin',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}};
  const response=await fetch(`/api${url}`,opts);
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.message||'Request failed.');
  return data;
}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200);}
function setMessage(id,message,type='error'){const el=$(id);if(!el)return;el.textContent=message;el.className=`form-message ${type}`;}
function setTheme(value){theme=value;document.documentElement.dataset.theme=value==='dark'?'dark':'light';localStorage.setItem('campussphere-theme',value);const b=$('#themeToggle');if(b)b.innerHTML=value==='dark'?'☀ <span>Light mode</span>':'☾ <span>Dark mode</span>';}
function showAuth(){ $('#authView').classList.remove('hidden');$('#appView').classList.add('hidden'); }
function showApp(){ $('#authView').classList.add('hidden');$('#appView').classList.remove('hidden'); }

function switchAuthTab(which){
  const login=which==='login';$('#loginTab').classList.toggle('active',login);$('#signupTab').classList.toggle('active',!login);
  $('#loginForm').classList.toggle('hidden',!login);$('#signupForm').classList.toggle('hidden',login);
  $('#authTitle').textContent=login?'Welcome back':'Create your student account';
  $('#authSubtitle').textContent=login?'Sign in to continue to your campus workspace.':'Join CampusSphere and discover what is happening on campus.';
  $('#authMessage').textContent='';
}
$('#loginTab').addEventListener('click',()=>switchAuthTab('login'));
$('#signupTab').addEventListener('click',()=>switchAuthTab('signup'));
$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();setMessage('#authMessage','Signing in…','');
  try{const result=await api('/auth/login',{method:'POST',body:JSON.stringify({email:$('#loginEmail').value,password:$('#loginPassword').value})});currentUser=result.user;await bootApp();}
  catch(err){setMessage('#authMessage',err.message);}
});
$('#signupForm').addEventListener('submit',async e=>{
  e.preventDefault();setMessage('#authMessage','Creating your account…','');
  try{const result=await api('/auth/signup',{method:'POST',body:JSON.stringify({name:$('#signupName').value,email:$('#signupEmail').value,department:$('#signupDepartment').value,semester:$('#signupSemester').value,password:$('#signupPassword').value})});currentUser=result.user;await bootApp();}
  catch(err){setMessage('#authMessage',err.message);}
});

const navByRole={
  student:[['dashboard','▦','My dashboard'],['events','◷','Discover events'],['registrations','▤','My registrations'],['clubs','♧','Clubs'],['attendance','✓','My attendance'],['results','🏆','Results'],['payments','₹','My payments']],
  admin:[['dashboard','▦','Dashboard'],['events','◷','Manage events'],['students','♙','Students'],['registrations','▤','Registrations'],['clubs','♧','Clubs & club admins'],['attendance','✓','Attendance'],['organizers','♟','Organizers'],['results','🏆','Results'],['payments','₹','Payments'],['reports','▤','Reports']],
  club_admin:[['dashboard','▦','Club dashboard'],['events','◷','Club events'],['registrations','▤','Participants'],['clubs','♧','My club'],['attendance','✓','Attendance'],['results','🏆','Results'],['reports','▤','Reports']]
};
function renderNav(){
  const items=navByRole[currentUser.role]||navByRole.student;
  $('#navMenu').innerHTML=items.map(([page,icon,label])=>`<button class="nav-item ${page===currentPage?'active':''}" data-page="${page}"><span class="nav-icon">${icon}</span>${label}</button>`).join('');
  $$('#navMenu [data-page]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));
}
function navigate(page){currentPage=page;renderNav();$('#breadcrumbTitle').textContent=(navByRole[currentUser.role]||[]).find(x=>x[0]===page)?.[2]||page;$('#sidebar').classList.remove('open');renderPage();}
async function bootApp(){
  showApp();setTheme(theme);$('#userName').textContent=currentUser.name;$('#userRole').textContent=currentUser.role.replace('_',' ');$('#userAvatar').textContent=initials(currentUser.name);$('#topAvatar').textContent=initials(currentUser.name);
  currentPage='dashboard';renderNav();
  try{const h=await api('/health');$('#systemStatus').textContent=`Connected · ${h.database}`;}catch{$('#systemStatus').textContent='Database unavailable';}
  renderPage();loadNotificationDot();
}
$('#logoutButton').addEventListener('click',async()=>{try{await api('/auth/logout',{method:'POST'});}catch{}currentUser=null;showAuth();$('#loginPassword').value='';switchAuthTab('login');});
$('#topLogoutButton').addEventListener('click',()=>$('#logoutButton').click());
$('#themeToggle').addEventListener('click',()=>setTheme(theme==='dark'?'light':'dark'));
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));

function pageHeading(eyebrow,title,subtitle,actions=''){return `<div class="page-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;}
function stat(label,value,foot,icon){return `<article class="stat-card"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-foot">${esc(foot)}</div></article>`;}
function badge(text){const t=String(text||'').toLowerCase();return `<span class="badge ${esc(t)}">${esc(text||'—')}</span>`;}
function empty(text){return `<div class="empty-state">${esc(text)}</div>`;}
async function renderPage(){
  const target=$('#appContent');target.innerHTML='<div class="panel loading">Loading workspace…</div>';
  try{
    if(currentPage==='dashboard') target.innerHTML=await dashboardPage();
    else if(currentPage==='events') target.innerHTML=await eventsPage();
    else if(currentPage==='students') target.innerHTML=await studentsPage();
    else if(currentPage==='registrations') target.innerHTML=await registrationsPage();
    else if(currentPage==='clubs') target.innerHTML=await clubsPage();
    else if(currentPage==='attendance') target.innerHTML=await attendancePage();
    else if(currentPage==='organizers') target.innerHTML=await organizersPage();
    else if(currentPage==='results') target.innerHTML=await resultsPage();
    else if(currentPage==='payments') target.innerHTML=await paymentsPage();
    else if(currentPage==='reports') target.innerHTML=reportsPage();
    else target.innerHTML=empty('Page not found.');
    bindPageEvents();
  }catch(err){target.innerHTML=`<section class="panel"><div class="empty-state">${esc(err.message)}</div></section>`;}
}

async function dashboardPage(){
  if(currentUser.role==='student'){
    const s=await api('/student/summary');const events=await api('/events');cache.events=events;
    return `${pageHeading('STUDENT SPACE',`Welcome, ${currentUser.name.split(' ')[0]}`, 'Discover events, join clubs and keep track of your campus journey.', '<button class="primary-btn" data-nav="events">Explore events →</button>')}
      <div class="stats-grid">${stat('My registrations',s.registrations,'Events you joined','▤')}${stat('My clubs',s.clubs,'Active memberships','♧')}${stat('Payments pending',s.pendingPayments,'Payments to complete','₹')}${stat('Paid so far',money(s.paid),'Demo payment records','✓')}</div>
      <div class="content-grid"><section class="panel"><div class="panel-heading"><div><h2>Discover something new</h2><p>Events available to your student account</p></div><button class="text-btn" data-nav="events">Browse all ↗</button></div>${eventMiniList(events.slice(0,5))}</section><section class="panel"><div class="panel-heading"><div><h2>Your campus checklist</h2><p>Get started with CampusSphere</p></div></div><button class="quick-link" data-nav="events"><span><strong>Find an event</strong><small>Browse technical, cultural and club events.</small></span><b>›</b></button><button class="quick-link" data-nav="clubs"><span><strong>Join a club</strong><small>Some events are limited to club members.</small></span><b>›</b></button><button class="quick-link" data-nav="registrations"><span><strong>Track your registration</strong><small>See your status and demo payment.</small></span><b>›</b></button></section></div>`;
  }
  const d=await api('/dashboard');const events=await api('/events');cache.events=events;
  const roleTitle=currentUser.role==='admin'?'Administrator':'Club admin';
  return `${pageHeading('CAMPUS OVERVIEW',`Welcome, ${roleTitle}`, 'Here is what is happening across your event workspace.', '<button class="primary-btn" data-action="new-event">＋ Create event</button>')}
    <div class="stats-grid">${stat('Total students',d.totalStudents,'Student records','♙')}${stat('Events',d.totalEvents,'Events in your workspace','◷')}${stat('Registrations',d.totalRegistrations,'Active participation','▤')}${stat('Payments collected',money(d.totalCollected),'Paid records','₹')}</div>
    <div class="content-grid"><section class="panel"><div class="panel-heading"><div><h2>Events at a glance</h2><p>Upcoming campus activity</p></div><button class="text-btn" data-nav="events">Manage events ↗</button></div>${eventMiniList(events.slice(0,5))}</section><section class="panel"><div class="panel-heading"><div><h2>Quick actions</h2><p>Common workspace tasks</p></div></div><button class="quick-link" data-action="new-event"><span><strong>Create an event</strong><small>Set fee, deadline and audience access.</small></span><b>＋</b></button><button class="quick-link" data-nav="registrations"><span><strong>Review participation</strong><small>Check registrations and decisions.</small></span><b>›</b></button><button class="quick-link" data-nav="reports"><span><strong>Export reports</strong><small>Download CSV for spreadsheet use.</small></span><b>›</b></button></section></div>`;
}
function eventMiniList(events){if(!events.length)return empty('No events available yet.');return `<div class="compact-list">${events.map(e=>{const d=new Date(String(e.event_date).replace(' ','T'));const day=isNaN(d)?'--':String(d.getDate()).padStart(2,'0');const month=isNaN(d)?'DATE':d.toLocaleString('en',{month:'short'}).toUpperCase();return `<div class="compact-row"><div class="date-box"><b>${day}</b><small>${month}</small></div><div class="compact-info"><strong>${esc(e.event_name)}</strong><small>${esc(e.category)} · ${esc(e.venue_name||'Venue TBA')}</small></div><span class="badge">${money(e.registration_fee)}</span></div>`;}).join('')}</div>`;}

async function eventsPage(){
  cache.events=await api('/events');const manage=currentUser.role!=='student';
  return `${pageHeading('CAMPUS ACTIVITIES',manage?'Event management':'DISCOVER & PARTICIPATE','Browse events by clubs, category, fee and audience.',manage?'<button class="primary-btn" data-action="new-event">＋ Create event</button>':'')}
    <div class="toolbar"><input id="eventSearch" class="search-input" placeholder="Search events, clubs, category or venue…"><span class="result-count">${cache.events.length} events</span></div>
    <div class="event-grid" id="eventGrid">${eventCards(cache.events)}</div>`;
}
function eventCards(events){if(!events.length)return empty('No matching events. Try another search or check again later.');return events.map(e=>{
  const registered=Number(e.total_registrations||0),cap=Number(e.effective_capacity||e.capacity||0),seats=Math.max(0,cap-registered);
  const actions=currentUser.role==='student'?`<button class="primary-btn" data-action="register" data-id="${e.event_id}" ${seats===0?'disabled':''}>${seats===0?'Full':'Register →'}</button>`:`<button class="tiny-btn" data-action="edit-event" data-id="${e.event_id}">Edit</button><button class="tiny-btn danger" data-action="delete-event" data-id="${e.event_id}">Delete</button>`;
  return `<article class="event-card"><div class="event-top"><span class="event-type">${esc(e.category)}</span>${badge(e.event_status)}</div><h3>${esc(e.event_name)}</h3><div class="event-meta"><span>▦ ${dateFmt(e.event_date)}</span><span>⌖ ${esc(e.venue_name)} · ${esc(e.venue_location)}</span><span>♧ ${esc(e.club_name||e.organizer_name||'College')}</span><span>◉ ${registered} / ${cap||'—'} participants</span><span>♙ ${e.audience==='club_members'?'Club members only':'Open to all students'}</span>${e.registration_deadline?`<span>⌛ Deadline: ${dateFmt(e.registration_deadline)}</span>`:''}</div><div class="event-bottom"><div><strong>${Number(e.registration_fee)===0?'Free':money(e.registration_fee)}</strong><small> Registration fee</small></div><small>${seats} seats left</small></div><div class="event-actions">${actions}</div></article>`;
}).join('');}

async function studentsPage(){cache.students=await api('/students');return `${pageHeading('PEOPLE DIRECTORY','Students','Add, search, update and manage student records.','<button class="primary-btn" data-action="new-student">＋ Add student</button>')}<div class="toolbar"><input id="studentSearch" class="search-input" placeholder="Search by name, email or department…"><span class="result-count">${cache.students.length} students</span></div><section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>STUDENT</th><th>EMAIL</th><th>DEPARTMENT</th><th>SEMESTER</th><th>ACTIONS</th></tr></thead><tbody id="studentsBody">${studentRows(cache.students)}</tbody></table></div></section>`;}
function studentRows(rows){if(!rows.length)return '<tr><td colspan="5" class="empty-state">No students found.</td></tr>';return rows.map(s=>`<tr><td><div class="student-cell"><span class="mini-avatar">${initials(s.student_name)}</span><strong>${esc(s.student_name)}</strong></div></td><td>${esc(s.email)}</td><td>${esc(s.department)}</td><td>Semester ${s.semester}</td><td><div class="table-actions"><button class="tiny-btn" data-action="edit-student" data-id="${s.student_id}">Edit</button><button class="tiny-btn danger" data-action="delete-student" data-id="${s.student_id}">Delete</button></div></td></tr>`).join('');}

async function registrationsPage(){
  if(currentUser.role==='student'){
    const rows=await api('/student/registrations');cache.registrations=rows;
    return `${pageHeading('MY PARTICIPATION','My registrations','Track your event registration, review and payment status.','<button class="outline-btn" data-nav="events">＋ Find events</button>')}
      <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>EVENT</th><th>EVENT DATE</th><th>REGISTERED ON</th><th>REVIEW</th><th>PAYMENT</th><th>ACTIONS</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td><strong>${esc(r.event_name)}</strong></td><td>${dateFmt(r.event_date)}</td><td>${dateFmt(r.registration_date)}</td><td>${badge(r.review_status)}</td><td>${badge(r.payment_status)} ${Number(r.amount)>0?money(r.amount):'Free'}</td><td><div class="table-actions">${r.payment_status==='Pending'&&r.registration_status!=='Cancelled'?`<button class="tiny-btn" data-action="pay" data-id="${r.payment_id}">Pay demo</button>`:''}${r.registration_status!=='Cancelled'?`<button class="tiny-btn danger" data-action="cancel-reg" data-id="${r.registration_id}">Cancel</button>`:''}</div></td></tr>`).join(''):'<tr><td colspan="6" class="empty-state">You have not registered for an event yet.</td></tr>'}</tbody></table></div></section>
      <div class="notice warning">Demo checkout only: UPI, debit-card and credit-card choices simulate a successful payment for this project. No real money is charged and no payment credentials are collected.</div>`;
  }
  const rows=await api('/registrations');cache.registrations=rows;
  return `${pageHeading('PARTICIPATION','Registrations','Review student participation and download a participant report.','<button class="outline-btn" data-action="download-regs">↓ Export CSV</button>')}
    <div class="toolbar"><input id="registrationSearch" class="search-input" placeholder="Search student, event or status…"><span class="result-count">${rows.length} registrations</span></div>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>STUDENT</th><th>EVENT</th><th>DATE</th><th>REVIEW</th><th>PAYMENT</th><th>ACTIONS</th></tr></thead><tbody id="registrationBody">${registrationRows(rows)}</tbody></table></div></section>`;
}
function registrationRows(rows){if(!rows.length)return '<tr><td colspan="6" class="empty-state">No registrations yet.</td></tr>';return rows.map(r=>`<tr><td><strong>${esc(r.student_name)}</strong><br>${esc(r.department)}</td><td>${esc(r.event_name)}</td><td>${dateFmt(r.registration_date)}</td><td>${badge(r.review_status)}</td><td>${badge(r.payment_status)} ${money(r.amount)}</td><td><div class="table-actions">${r.review_status==='Pending'?`<button class="tiny-btn" data-action="review" data-status="Approved" data-id="${r.registration_id}">Approve</button><button class="tiny-btn danger" data-action="review" data-status="Rejected" data-id="${r.registration_id}">Reject</button>`:''}</div></td></tr>`).join('');}

async function clubsPage(){cache.clubs=await api('/clubs');
  let heading='Clubs & communities',sub='Explore student clubs and the events they organise.',action='';
  if(currentUser.role==='admin')action='<button class="primary-btn" data-action="new-club">＋ Create club & admin</button>';
  if(currentUser.role==='club_admin')sub='Manage your club community and see active members.';
  const cards=cache.clubs.map(c=>`<article class="club-card"><span class="event-type">CAMPUS CLUB</span><h3>${esc(c.club_name)}</h3><p>${esc(c.description||'A student community at your college.')}</p><div class="club-foot"><small>♙ ${Number(c.member_count)} members</small>${currentUser.role==='student'?(c.is_member?badge('Member'):`<button class="primary-btn" data-action="join-club" data-id="${c.club_id}">Join club</button>`):(currentUser.role==='admin'||(currentUser.role==='club_admin'&&c.club_id===currentUser.clubId))?`<button class="tiny-btn" data-action="view-members" data-id="${c.club_id}">View members</button>`:badge('Community')}</div></article>`).join('');
  let members='';if(currentUser.role==='club_admin'){const rows=await api(`/clubs/${currentUser.clubId}/members`);members=`<section class="panel"><div class="panel-heading"><div><h2>Active members</h2><p>Students currently in your club</p></div><span class="result-count">${rows.length} members</span></div><div class="table-wrap"><table><thead><tr><th>STUDENT</th><th>EMAIL</th><th>DEPARTMENT</th><th>SEMESTER</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.student_name)}</strong></td><td>${esc(r.email)}</td><td>${esc(r.department)}</td><td>${r.semester}</td></tr>`).join('')||'<tr><td colspan="4" class="empty-state">No members joined yet.</td></tr>'}</tbody></table></div></section>`;}
  return `${pageHeading('CAMPUS COMMUNITIES',heading,sub,action)}<div class="club-grid">${cards||empty('No clubs have been created yet.')}</div>${members}`;
}

async function attendancePage(){
  if(currentUser.role==='student'){
    const rows=await api('/student/attendance');
    return `${pageHeading('PARTICIPATION RECORD','My attendance','See attendance recorded by the event administrator for events you registered in.')}<section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>EVENT</th><th>EVENT DATE</th><th>ATTENDANCE</th><th>LAST UPDATED</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.event_name)}</strong></td><td>${dateFmt(r.event_date)}</td><td>${badge(r.attendance_status)}</td><td>${dateFmt(r.marked_at)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty-state">No event registrations found yet.</td></tr>'}</tbody></table></div></section><div class="notice">Your attendance appears here after an administrator or club administrator marks it.</div>`;
  }
  const rows=await api('/attendance/events');
  return `${pageHeading('EVENT OPERATIONS','Attendance management','Choose an event and mark each registered participant as present or absent.')}<section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>EVENT</th><th>DATE</th><th>STATUS</th><th>REGISTERED</th><th>MARKED</th><th>PRESENT</th><th>ACTION</th></tr></thead><tbody>${rows.map(e=>`<tr><td><strong>${esc(e.event_name)}</strong></td><td>${dateFmt(e.event_date)}</td><td>${badge(e.event_status)}</td><td>${e.participants}</td><td>${e.marked}</td><td>${e.present_count||0}</td><td><button class="tiny-btn" data-action="manage-attendance" data-id="${e.event_id}">Mark attendance</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty-state">No events available.</td></tr>'}</tbody></table></div></section>`;
}
async function openAttendanceModal(eventId){
  const data=await api(`/attendance/event/${eventId}`);
  const rows=data.participants.map(p=>`<tr><td><strong>${esc(p.student_name)}</strong><br><small>${esc(p.email)} · ${esc(p.department)}</small></td><td><select class="form-control attendance-status" data-registration="${p.registration_id}"><option value="Present" ${p.attendance_status==='Present'?'selected':''}>Present</option><option value="Absent" ${p.attendance_status==='Absent'?'selected':''}>Absent</option></select></td></tr>`).join('');
  modal({title:`Attendance · ${esc(data.event.event_name)}`,body:`<p class="hint">Only registered participants are listed. Select Present or Absent for each student.</p><div class="table-wrap"><table><thead><tr><th>STUDENT</th><th>STATUS</th></tr></thead><tbody>${rows||'<tr><td colspan="2" class="empty-state">No registrations for this event.</td></tr>'}</tbody></table></div><div class="form-actions"><button class="outline-btn" data-close="1">Cancel</button><button class="primary-btn" id="saveAttendance">Save attendance</button></div><div id="attendanceMessage" class="form-message"></div>`});
  $('#saveAttendance').addEventListener('click',async()=>{try{const records=$$('.attendance-status').map(el=>({registration_id:Number(el.dataset.registration),status:el.value}));await api(`/attendance/event/${eventId}`,{method:'PUT',body:JSON.stringify({records})});closeModal();toast('Attendance saved.');await renderPage();}catch(e){$('#attendanceMessage').textContent=e.message;}});
}

async function organizersPage(){cache.organizers=await api('/organizers');return `${pageHeading('PEOPLE & TEAMS','Organizers','Manage the college contacts who host events.','<button class="primary-btn" data-action="new-organizer">＋ Add organizer</button>')}<section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>ORGANIZER</th><th>EMAIL</th><th>DEPARTMENT / TEAM</th></tr></thead><tbody>${cache.organizers.map(o=>`<tr><td><strong>${esc(o.organizer_name)}</strong></td><td>${esc(o.email)}</td><td>${esc(o.department)}</td></tr>`).join('')||'<tr><td colspan="3" class="empty-state">No organizers found.</td></tr>'}</tbody></table></div></section>`;}
async function resultsPage(){const rows=await api('/results');return `${pageHeading('ACHIEVEMENTS','Results & leaderboard','View student scores, event positions and winners.',currentUser.role==='student'?'':'<button class="primary-btn" data-action="new-result">＋ Add / update result</button>')}<section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>STUDENT</th><th>EVENT</th><th>SCORE</th><th>POSITION</th><th>REMARKS</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.student_name)}</strong></td><td>${esc(r.event_name)}</td><td>${Number(r.score).toFixed(2)}</td><td>${r.position?`#${r.position}`:'—'}</td><td>${esc(r.remarks||'—')}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-state">No results have been published yet.</td></tr>'}</tbody></table></div></section>`;}
async function paymentsPage(){const rows=currentUser.role==='student'?await api('/student/payments'):await api('/payments');return `${pageHeading(currentUser.role==='student'?'MY FINANCE':'FINANCE OVERVIEW',currentUser.role==='student'?'My payments':'Payments & revenue',currentUser.role==='student'?'Review your event payment records and complete demo checkout.':'Review payment status and download the payment report.',currentUser.role==='admin'?'<button class="outline-btn" data-action="download-payments">↓ Export CSV</button>':'')}<section class="panel table-panel"><div class="table-wrap"><table><thead><tr>${currentUser.role==='student'?'':'<th>STUDENT</th>'}<th>EVENT</th><th>AMOUNT</th><th>METHOD</th><th>DATE</th><th>STATUS</th>${currentUser.role==='student'?'<th>ACTION</th>':''}</tr></thead><tbody>${rows.map(p=>`<tr>${currentUser.role==='student'?'':`<td><strong>${esc(p.student_name)}</strong></td>`}<td>${esc(p.event_name)}</td><td>${money(p.amount)}</td><td>${esc((p.payment_method||'—').replaceAll('_',' '))}</td><td>${dateFmt(p.payment_date)}</td><td>${badge(p.payment_status)}</td>${currentUser.role==='student'?`<td>${p.payment_status==='Pending'?`<button class="tiny-btn" data-action="pay" data-id="${p.payment_id}">Pay demo</button>`:'—'}</td>`:''}</tr>`).join('')||`<tr><td colspan="${currentUser.role==='student'?6:6}" class="empty-state">No payments yet.</td></tr>`}</tbody></table></div></section>${currentUser.role==='student'?'<div class="notice warning">Demo payment choices only. No real UPI transfer or card charge takes place in this local project. Do not enter card number, CVV, UPI PIN or bank password.</div>':''}`;}
function reportsPage(){return `${pageHeading('DATA & INSIGHTS','Reports','Export registration and payment records for spreadsheet analysis.')}
  <div class="content-grid"><section class="panel"><div class="panel-heading"><div><h2>Registration report</h2><p>Student, event, registration and review status.</p></div><span class="stat-icon">▤</span></div><p class="hint">Downloads a CSV file that opens in Microsoft Excel or Google Sheets.</p><button class="primary-btn" data-action="download-regs">Download registrations CSV →</button></section>${currentUser.role==='admin'?`<section class="panel"><div class="panel-heading"><div><h2>Payment report</h2><p>Collected amount, payment date and status.</p></div><span class="stat-icon">₹</span></div><p class="hint">Download payment records for your project report and finance summary.</p><button class="primary-btn" data-action="download-payments">Download payments CSV →</button></section>`:''}</div><section class="panel"><div class="panel-heading"><div><h2>PDF export tip</h2><p>Use the browser's print option to save visible report pages as PDF.</p></div></div><p class="hint">Press Ctrl + P in Chrome and choose “Save as PDF”. This creates a PDF snapshot of the current page.</p></section>`;}

function modal(content){$('#modalRoot').innerHTML=`<div class="modal-backdrop" data-close="1"><section class="modal-card"><div class="modal-head"><h2>${content.title}</h2><button class="modal-close" data-close="1">×</button></div>${content.body}</section></div>`;$('#modalRoot').querySelector('.modal-backdrop').addEventListener('click',e=>{if(e.target.dataset.close)closeModal();});}
function closeModal(){$('#modalRoot').innerHTML='';}
function field(label,name,value='',type='text',required=true,extra=''){return `<div class="form-field"><label>${esc(label)}${required?' *':''}<input class="form-control" name="${esc(name)}" type="${type}" value="${esc(value)}" ${required?'required':''} ${extra}></label></div>`;}
function selectField(label,name,options,selected='',required=true){return `<div class="form-field"><label>${esc(label)}${required?' *':''}<select class="form-control" name="${esc(name)}" ${required?'required':''}><option value="">Choose…</option>${options.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(selected)?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label></div>`;}
function formButtons(label='Save'){return `<div class="form-actions"><button type="button" class="outline-btn" data-close="1">Cancel</button><button type="submit" class="primary-btn">${esc(label)}</button></div>`;}
function formModal(title,inner,submitLabel,handler){modal({title,body:`<form id="modalForm">${inner}${formButtons(submitLabel)}<div id="modalMessage" class="form-message"></div></form>`});$('#modalForm').addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget).entries());const submit=e.currentTarget.querySelector('[type="submit"]');submit.disabled=true;try{await handler(data);closeModal();toast('Saved successfully.');await renderPage();}catch(err){$('#modalMessage').textContent=err.message;$('#modalMessage').className='form-message error';}finally{submit.disabled=false;}});}

async function openStudentModal(student){const s=student||{};formModal(student?'Edit student':'Add student',`<div class="form-layout">${field('Student name','student_name',s.student_name||'')}${field('Email address','email',s.email||'','email')}${field('Department','department',s.department||'')}${selectField('Semester','semester',Array.from({length:12},(_,i)=>({value:i+1,label:`Semester ${i+1}`})),s.semester||'')}</div>`,student?'Update student':'Save student',async data=>{if(student)await api(`/students/${student.student_id}`,{method:'PUT',body:JSON.stringify(data)});else await api('/students',{method:'POST',body:JSON.stringify(data)});});}
async function openEventModal(event){const [venues,organizers,clubs]=await Promise.all([api('/venues'),currentUser.role==='admin'?api('/organizers'):Promise.resolve([]),api('/clubs')]);const e=event||{};const organizerOptions=organizers.map(o=>({value:o.organizer_id,label:o.organizer_name}));const venueOptions=venues.map(v=>({value:v.venue_id,label:`${v.venue_name} · ${v.capacity} capacity`}));const clubOptions=clubs.map(c=>({value:c.club_id,label:c.club_name}));
  let body=`<div class="form-layout">${field('Event name','event_name',e.event_name||'')}${field('Category','category',e.category||'Technical')}${field('Event date','event_date',String(e.event_date||'').slice(0,10),'date')}${field('Registration fee (₹)','registration_fee',e.registration_fee??'0','number',true,'min="0" step="0.01"')}${selectField('Venue','venue_id',venueOptions,e.venue_id||'')}${currentUser.role==='admin'?selectField('Organizer','organizer_id',organizerOptions,e.organizer_id||''):field('Organizer id (managed by your club)','organizer_id','1','hidden',false)}${field('Registration deadline','registration_deadline',e.registration_deadline?String(e.registration_deadline).replace(' ','T').slice(0,16):'','datetime-local',false)}${field('Maximum participants','max_participants',e.max_participants||'','number',false,'min="1"')}${selectField('Who can join?','audience',[{value:'all_students',label:'Open for all students'},{value:'club_members',label:'Only active club members'}],e.audience||'all_students')}${currentUser.role==='admin'?selectField('Hosting club (optional)','club_id',[{value:'',label:'College / no specific club'},...clubOptions],e.club_id||'',false):field('Club','club_id',String(currentUser.clubId),'hidden',false)}${selectField('Event status','event_status',[{value:'Upcoming',label:'Upcoming'},{value:'Completed',label:'Completed'},{value:'Cancelled',label:'Cancelled'}],e.event_status||'Upcoming')}</div><p class="hint">Club-admin accounts can create events only for their own club. They can choose whether the event is open to all students or club members only.</p>`;
  formModal(event?'Edit event':'Create event',body,event?'Update event':'Create event',async data=>{data.registration_deadline=data.registration_deadline?.replace('T',' ')||'';if(currentUser.role==='club_admin'){data.club_id=currentUser.clubId;data.organizer_id=1;}else if(!data.club_id)data.club_id='';await api(event?`/events/${event.event_id}`:'/events',{method:event?'PUT':'POST',body:JSON.stringify(data)});});
}
async function openClubModal(){formModal('Create club and club-admin account',`<div class="form-layout">${field('Club name','club_name')}${field('Club contact email','contact_email','','email')}${field('Club admin name','admin_name')}${field('Club admin login email','admin_email','','email')}${field('Club admin password','admin_password','','password',true,'minlength="8"') }<div class="form-field full"><label>Description<textarea class="form-control" name="description" rows="3" placeholder="What does this club do?"></textarea></label></div></div><div class="notice">A separate club-admin login will be created. Share the credentials with the authorised club representative securely.</div>`, 'Create club',async data=>{await api('/clubs',{method:'POST',body:JSON.stringify(data)});});}
async function openOrganizerModal(){formModal('Add organizer',`${field('Organizer name','name')}${field('Email','email','','email')}${field('Department / committee','department')}`,'Add organizer',async data=>{await api('/organizers',{method:'POST',body:JSON.stringify(data)});});}
async function openResultModal(){const regs=await api('/registrations');const options=regs.filter(r=>r.registration_status!=='Cancelled').map(r=>({value:r.registration_id,label:`${r.student_name} · ${r.event_name}`}));formModal('Add or update result',`<div class="form-layout">${selectField('Student registration','registration_id',options,'')}${field('Score','score','','number',true,'min="0" step="0.01"')}${field('Position / rank','position','','number',false,'min="1"')}${field('Remarks','remarks','') }</div>`,'Save result',async data=>{await api('/results',{method:'POST',body:JSON.stringify(data)});});}
async function openPaymentModal(paymentId){let chosen='UPI';modal({title:'Complete demo payment',body:`<div class="notice warning"><b>Project demonstration only.</b> This does not connect to a bank or payment gateway. Do not enter card numbers, CVV, UPI PIN or bank credentials.</div><p class="hint">Choose a payment type to simulate a successful checkout.</p><div class="method-options"><button type="button" class="method-option selected" data-method="UPI">▣<br>UPI</button><button type="button" class="method-option" data-method="DEBIT_CARD">▤<br>Debit card</button><button type="button" class="method-option" data-method="CREDIT_CARD">▤<br>Credit card</button></div><div class="form-actions"><button class="outline-btn" data-close="1" type="button">Cancel</button><button class="primary-btn" id="simulatePayment" type="button">Simulate payment</button></div><div id="modalMessage" class="form-message"></div>`});
  $$('[data-method]').forEach(b=>b.addEventListener('click',()=>{chosen=b.dataset.method;$$('[data-method]').forEach(x=>x.classList.toggle('selected',x===b));}));
  $('#simulatePayment').addEventListener('click',async()=>{try{const result=await api(`/payments/${paymentId}/demo-checkout`,{method:'POST',body:JSON.stringify({method:chosen})});closeModal();toast(`${result.message} Ref: ${result.reference}`);await renderPage();}catch(err){$('#modalMessage').textContent=err.message;}});
}
async function bindPageEvents(){
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
  $$('[data-action]').forEach(b=>b.addEventListener('click',async()=>{
    const action=b.dataset.action,id=Number(b.dataset.id);
    try{
      if(action==='new-student')await openStudentModal();
      else if(action==='edit-student')await openStudentModal(cache.students.find(s=>s.student_id===id));
      else if(action==='delete-student'){if(confirm('Delete this student record? Records with registration history cannot be deleted.')){await api(`/students/${id}`,{method:'DELETE'});toast('Student deleted.');await renderPage();}}
      else if(action==='new-event')await openEventModal();
      else if(action==='edit-event')await openEventModal(cache.events.find(e=>e.event_id===id));
      else if(action==='delete-event'){if(confirm('Delete or cancel this event? Events with registrations are marked Cancelled to preserve history.')){const r=await api(`/events/${id}`,{method:'DELETE'});toast(r.message);await renderPage();}}
      else if(action==='new-club')await openClubModal();
      else if(action==='new-organizer')await openOrganizerModal();
      else if(action==='manage-attendance')await openAttendanceModal(id);
      else if(action==='new-result')await openResultModal();
      else if(action==='register'){if(confirm('Register your student account for this event?')){const r=await api(`/events/${id}/register`,{method:'POST',body:JSON.stringify({})});toast(r.message);await renderPage();}}
      else if(action==='pay')await openPaymentModal(id);
      else if(action==='join-club'){await api(`/clubs/${id}/join`,{method:'POST',body:JSON.stringify({})});toast('You joined this club.');await renderPage();}
      else if(action==='review'){await api(`/registrations/${id}/review`,{method:'PATCH',body:JSON.stringify({status:b.dataset.status})});toast(`Registration ${b.dataset.status.toLowerCase()}.`);await renderPage();}
      else if(action==='cancel-reg'){if(confirm('Cancel this registration?')){const r=await api(`/registrations/${id}/cancel`,{method:'POST',body:JSON.stringify({})});toast(r.message);await renderPage();}}
      else if(action==='download-regs')window.location.href='/api/reports/registrations.csv';
      else if(action==='download-payments')window.location.href='/api/reports/payments.csv';
      else if(action==='view-members'){const rows=await api(`/clubs/${id}/members`);modal({title:'Club members',body:`<div class="table-wrap"><table><thead><tr><th>STUDENT</th><th>EMAIL</th><th>DEPARTMENT</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.student_name)}</td><td>${esc(x.email)}</td><td>${esc(x.department)}</td></tr>`).join('')||'<tr><td colspan="3">No members found.</td></tr>'}</tbody></table></div>`});}
    }catch(err){toast(err.message);}
  }));
  $('#eventSearch')?.addEventListener('input',e=>{const term=e.target.value.toLowerCase();$('#eventGrid').innerHTML=eventCards(cache.events.filter(x=>`${x.event_name} ${x.category} ${x.venue_name} ${x.club_name||''}`.toLowerCase().includes(term)));bindActionButtonsOnly();});
  $('#studentSearch')?.addEventListener('input',e=>{const t=e.target.value.toLowerCase();$('#studentsBody').innerHTML=studentRows(cache.students.filter(x=>`${x.student_name} ${x.email} ${x.department}`.toLowerCase().includes(t)));bindActionButtonsOnly();});
  $('#registrationSearch')?.addEventListener('input',e=>{const t=e.target.value.toLowerCase();$('#registrationBody').innerHTML=registrationRows(cache.registrations.filter(x=>`${x.student_name} ${x.event_name} ${x.review_status} ${x.payment_status}`.toLowerCase().includes(t)));bindActionButtonsOnly();});
}
function bindActionButtonsOnly(){ $$('[data-action]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',async()=>{const id=Number(b.dataset.id);try{if(b.dataset.action==='register'){const r=await api(`/events/${id}/register`,{method:'POST',body:'{}'});toast(r.message);await renderPage();}else if(b.dataset.action==='edit-event')await openEventModal(cache.events.find(x=>x.event_id===id));else if(b.dataset.action==='pay')await openPaymentModal(id);else if(b.dataset.action==='review'){await api(`/registrations/${id}/review`,{method:'PATCH',body:JSON.stringify({status:b.dataset.status})});await renderPage();}else if(b.dataset.action==='edit-student')await openStudentModal(cache.students.find(x=>x.student_id===id));else if(b.dataset.action==='delete-event'||b.dataset.action==='delete-student'){if(confirm('Are you sure?')){await api(`/${b.dataset.action==='delete-event'?'events':'students'}/${id}`,{method:'DELETE'});await renderPage();}}}catch(e){toast(e.message);}});}); }

async function loadNotificationDot(){try{const rows=await api('/notifications');$('#notificationDot').style.display=rows.some(x=>!x.is_read)?'block':'none';}catch{}}
$('#notificationButton').addEventListener('click',async()=>{try{const rows=await api('/notifications');modal({title:'Notifications',body:rows.length?rows.map(n=>`<div class="payment-card"><div><strong>${esc(n.title)}</strong><small>${esc(n.message)} · ${dateFmt(n.created_at)}</small></div>${n.is_read?'':`<button class="tiny-btn" data-notice-read="${n.notification_id}">Mark read</button>`}</div>`).join(''):'<div class="empty-state">No notifications yet.</div>'});$$('[data-notice-read]').forEach(b=>b.addEventListener('click',async()=>{await api(`/notifications/${b.dataset.noticeRead}/read`,{method:'POST',body:'{}'});closeModal();loadNotificationDot();}));}catch(e){toast(e.message);}});

(async function init(){
  setTheme(theme);
  try{const health=await api('/health');$('#authDbStatus').textContent=`Connected to ${health.database}`;}catch{$('#authDbStatus').textContent='Database connection unavailable. Start MySQL and check .env.';}
  try{const result=await api('/auth/me');if(result.user){currentUser=result.user;await bootApp();}else showAuth();}catch{showAuth();}
})();
