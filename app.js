const SUPABASE_URL = 'https://qppkqopbtaswfwspjxsc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_VpqWrjBfc0XoawJ8CGYrcw_GdGL4bPy';
// Cloudflare Turnstile public Site Key only. Never place the Turnstile Secret Key in this file.
const TURNSTILE_SITE_KEY = '0x4AAAAAAEv94I2iOlANwtYM';

// Keep the original page URL before Supabase processes the auth callback.
// Password-reset links normally include type=recovery in the URL.
const INITIAL_PAGE_URL = window.location.href;
const INITIAL_IS_PASSWORD_RECOVERY =
  /(?:[?#&])type=recovery(?:&|$)/i.test(INITIAL_PAGE_URL);

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $=id=>document.getElementById(id);
let currentUser=null,residents=[],items=[],allItems=[],editingItemId=null,entries=[],recurring=[],currentUserRole='staff',currentUserDisplayName='',currentCycleLocked=false,saveTimer=null;
let currentUserBranchId=null,currentBranchId=null,branches=[];
let recurringOverrides = [];
let recurringPriceHistory = [];
let dailySelectedDate = formatDateISO(new Date());
let dailyEntries = [];
let dailyItemSearchText = '';
let chargesDisplayMode = 'calendar';

// Master Calendar display preferences only (no billing/export impact)
let calendarItemSearchText = '';
const collapsedCalendarCategories = new Set();
let turnstileWidgetId = null;
let captchaToken = null;
let passwordRecoveryMode = false;

// ---------- v38 polished dialog + layout helpers ----------

function showAuthTransition(title, message='', options={}){
  const overlay=$('authTransition');
  if(!overlay)return;
  const spinner=$('authTransitionSpinner');
  const check=$('authTransitionCheck');
  overlay.classList.remove('hidden','fade-out');
  overlay.setAttribute('aria-busy', options.complete ? 'false' : 'true');
  if($('authTransitionTitle')) $('authTransitionTitle').textContent=title || 'Please wait…';
  if($('authTransitionMessage')) $('authTransitionMessage').textContent=message || '';
  if(spinner) spinner.classList.toggle('hidden', !!options.complete);
  if(check) check.classList.toggle('hidden', !options.complete);
}

function hideAuthTransition(immediate=false){
  const overlay=$('authTransition');
  if(!overlay)return;
  if(immediate){
    overlay.classList.add('hidden');
    overlay.classList.remove('fade-out');
    return;
  }
  overlay.classList.add('fade-out');
  setTimeout(()=>{
    overlay.classList.add('hidden');
    overlay.classList.remove('fade-out');
  },240);
}

function queueAuthTransition(type){
  try{sessionStorage.setItem('mintygreenAuthTransition',type)}catch(e){}
}
function readAuthTransition(){
  try{return sessionStorage.getItem('mintygreenAuthTransition')||''}catch(e){return ''}
}
function clearAuthTransition(){
  try{sessionStorage.removeItem('mintygreenAuthTransition')}catch(e){}
}

function initialsForName(name, email=''){
  const source = (name || fallbackDisplayName(email || '') || 'MG').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || 'M') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] || '') : '')).toUpperCase();
}

function splitDialogMessage(message){
  const raw = String(message || '').trim();
  const parts = raw.split(/\n+/);
  if(parts.length > 1 && parts[0].length <= 55){
    return { title: parts[0].replace(/:$/, ''), body: parts.slice(1).join('\n').trim() };
  }
  if(parts.length === 1 && raw.length <= 55){
    return { title: raw.replace(/:$/, ''), body: '' };
  }
  return { title: 'Please confirm', body: raw };
}

function openAppModal({title='Please confirm', message='', confirmText='Confirm', cancelText='Cancel', danger=false, input=false, value='', inputType='text', customHtml='' } = {}){
  const backdrop = $('appModalBackdrop');
  const modal = $('appModal');
  const titleEl = $('appModalTitle');
  const messageEl = $('appModalMessage');
  const customEl = $('appModalCustom');
  const cancelBtn = $('appModalCancel');
  const confirmBtn = $('appModalConfirm');

  titleEl.textContent = title;
  messageEl.textContent = message || '';
  messageEl.style.display = message ? '' : 'none';
  cancelBtn.textContent = cancelText;
  confirmBtn.textContent = confirmText;
  confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
  modal.classList.toggle('app-modal-danger', !!danger);
  customEl.innerHTML = customHtml || (input ? `<input id="appModalInput" class="app-modal-input" type="${esc(inputType)}">` : '');

  const inputEl = $('appModalInput');
  if(inputEl) inputEl.value = value ?? '';

  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden','false');

  return new Promise(resolve => {
    let finished = false;
    const close = result => {
      if(finished) return;
      finished = true;
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden','true');
      document.removeEventListener('keydown', onKey);
      backdrop.onclick = null;
      cancelBtn.onclick = null;
      confirmBtn.onclick = null;
      resolve(result);
    };
    const onKey = e => {
      if(e.key === 'Escape') close({confirmed:false, value:null});
      if(e.key === 'Enter' && inputEl && document.activeElement === inputEl){
        e.preventDefault();
        close({confirmed:true, value:inputEl.value});
      }
    };
    document.addEventListener('keydown', onKey);
    backdrop.onclick = e => { if(e.target === backdrop) close({confirmed:false, value:null}); };
    cancelBtn.onclick = () => close({confirmed:false, value:null});
    confirmBtn.onclick = () => close({confirmed:true, value:inputEl ? inputEl.value : true});
    setTimeout(() => (inputEl || confirmBtn)?.focus(), 20);
  });
}

async function appConfirm(message, options={}){
  const parsed = splitDialogMessage(message);
  const result = await openAppModal({
    title: options.title || parsed.title,
    message: options.message ?? parsed.body,
    confirmText: options.confirmText || (options.danger ? 'Yes, continue' : 'Confirm'),
    cancelText: options.cancelText || 'Cancel',
    danger: !!options.danger
  });
  return !!result.confirmed;
}

async function appPrompt(message, defaultValue='', options={}){
  const parsed = splitDialogMessage(message);
  const result = await openAppModal({
    title: options.title || parsed.title,
    message: options.message ?? parsed.body,
    confirmText: options.confirmText || 'Save',
    cancelText: options.cancelText || 'Cancel',
    danger: !!options.danger,
    input: true,
    value: defaultValue ?? '',
    inputType: options.inputType || 'text'
  });
  return result.confirmed ? String(result.value ?? '') : null;
}

async function appAccessDialog(staff){
  const branchOptions = branches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  const role = staff.role === 'admin' ? 'admin' : 'staff';
  const html = `
    <div class="app-modal-select-grid">
      <div class="app-modal-field">
        <label>Staff</label>
        <div><strong>${esc((staff.display_name || '').trim() || fallbackDisplayName(staff.email || ''))}</strong><br><small>${esc(staff.email || '')}</small></div>
      </div>
      <div class="app-modal-field">
        <label>Branch</label>
        <select id="accessModalBranch">${branchOptions}</select>
      </div>
      <div class="app-modal-field">
        <label>Role</label>
        <select id="accessModalRole">
          <option value="staff">Staff</option>
          <option value="admin">Branch Admin</option>
        </select>
      </div>
    </div>`;
  const promise = openAppModal({
    title:'Edit Staff Access',
    message:'Update access only. The staff display name and login email will not be changed.',
    confirmText:'Save Access',
    customHtml:html
  });
  setTimeout(() => {
    if($('accessModalBranch')) $('accessModalBranch').value = staff.branch_id || currentBranchId || '';
    if($('accessModalRole')) $('accessModalRole').value = role;
  }, 0);
  const result = await promise;
  if(!result.confirmed) return null;
  return {
    branchId: $('accessModalBranch')?.value || '',
    role: $('accessModalRole')?.value || 'staff'
  };
}

function addProfessionalPageHeadings(){
  const config = {
    charges:['Billing Workspace','Monthly Charges','Record, review and export resident charges for the selected billing cycle.'],
    recurring:['Recurring Billing','Monthly Packages','Manage repeat packages, services and rentals with clear effective dates.'],
    setup:['Resident Management','Residents','Maintain the active resident list used throughout billing.'],
    items:['Charge Catalogue','Items','Manage stock, package, service and rental items with future pricing.'],
    staff:['Account Management','Staff','Create staff accounts and manage names, access and password recovery.'],
    branches:['Organisation','Branches','Manage branch workspaces while keeping billing data separated.'],
    audit:['Governance','Audit History','Review who changed billing information and when.'],
    loginActivity:['Security','Login Activity','Review successful and failed sign-in activity across the system.'],
    backups:['Data Protection','Backups','Create and restore protected billing snapshots when required.'],
    settings:['Account','Settings','Manage your profile, sign-in email, password and personal account settings.']
  };
  Object.entries(config).forEach(([key,parts]) => {
    const section = $(`${key}Tab`);
    if(!section || section.querySelector('.page-heading')) return;
    const heading = document.createElement('div');
    heading.className='page-heading';
    heading.innerHTML=`<div class="page-heading-copy"><div class="page-heading-kicker">${esc(parts[0])}</div><h1>${esc(parts[1])}</h1><p>${esc(parts[2])}</p></div>`;
    section.prepend(heading);
  });
}

function addSidebarGroups(){
  const tabs = document.querySelector('.tabs');
  if(!tabs || tabs.dataset.grouped === '1') return;
  tabs.dataset.grouped='1';
  const labels = [
    ['charges','Operations'],
    ['setup','Management'],
    ['audit','System']
  ];
  labels.forEach(([before,label]) => {
    const btn = tabs.querySelector(`[data-tab="${before}"]`);
    if(btn){
      const el=document.createElement('div');
      el.className='nav-group-label';
      el.textContent=label;
      tabs.insertBefore(el,btn);
    }
  });
  refreshSidebarGroupVisibility();
}

function setupAccountMenu(){
  const btn=$('accountMenuBtn'), menu=$('accountMenu');
  if(!btn || !menu || btn.dataset.ready==='1') return;
  btn.dataset.ready='1';
  btn.addEventListener('click',e=>{
    e.stopPropagation();
    const opening=menu.classList.contains('hidden');
    menu.classList.toggle('hidden',!opening);
    btn.setAttribute('aria-expanded',opening?'true':'false');
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('.app-account')){
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded','false');
    }
  });
  $('accountSettingsBtn')?.addEventListener('click',()=>{
    menu.classList.add('hidden');
    const tab=document.querySelector('.tab[data-tab="settings"]');
    tab?.click();
  });
}

function upgradePolishedEmptyStates(){
  const replacements = [
    ['No residents yet.','No residents yet','Add your first resident to start recording monthly charges.','♙'],
    ['No items yet.','No items yet','Add a charge item to build your branch catalogue.','＋'],
    ['No staff accounts found.','No staff accounts found','Create a staff account to give your team secure access.','♟'],
    ['No recurring charges yet.','No monthly packages yet','Add a repeat charge and it will flow into eligible billing cycles automatically.','↻']
  ];
  document.querySelectorAll('.row').forEach(row=>{
    const txt=(row.textContent||'').trim();
    const match=replacements.find(r=>txt===r[0]);
    if(match){
      row.classList.add('polished-empty');
      row.innerHTML=`<div><div class="empty-icon">${match[3]}</div><div class="empty-title">${match[1]}</div><div class="empty-copy">${match[2]}</div></div>`;
    }
  });
}



const pendingAuthTransition=readAuthTransition();
if(pendingAuthTransition==='login'){
  showAuthTransition('Signing you in…','Loading your Mintygreen workspace.');
}else if(pendingAuthTransition==='logout'){
  showAuthTransition('Signing you out…','Closing your session securely.');
}

const money=n=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(Number(n||0)).replace('MYR','RM');
const todayMonth = () => {
  const today = new Date();

  let year = today.getFullYear();
  let month = today.getMonth() + 1;

  // Billing cycle:
  // 1st–24th = current month's billing cycle
  // 25th onwards = following month's billing cycle
  if (today.getDate() >= 25) {
    month++;

    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return `${year}-${String(month).padStart(2, '0')}`;
};const daysInMonth=m=>{const [y,mo]=m.split('-').map(Number);return new Date(y,mo,0).getDate()};
function getBillingCycle(monthValue) {
  if (!monthValue) return null;

  const [year, month] = monthValue.split('-').map(Number);

  // Billing cycle selected as Aug 2026:
  // Start = 25 Jul 2026
  // End   = 24 Aug 2026

  const startDate = new Date(year, month - 2, 25);
  const endDate = new Date(year, month - 1, 24);

  return {
    startDate,
    endDate,
    start: formatDateISO(startDate),
    end: formatDateISO(endDate)
  };
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function getBillingDates(monthValue) {
  const cycle = getBillingCycle(monthValue);

  if (!cycle) return [];

  const dates = [];
  const current = new Date(cycle.startDate);

  while (current <= cycle.endDate) {
    dates.push({
      date: formatDateISO(current),
      day: current.getDate(),
      month: current.getMonth() + 1,
      year: current.getFullYear()
    });

    current.setDate(current.getDate() + 1);
  }

  return dates;
}
const THEMES={
  mint:{'--green':'#176b5b','--green2':'#0f5548','--mint':'#eaf6f3','--bg':'#f4f7f6','--border':'#dbe4e1'},
  ocean:{'--green':'#1a6fa8','--green2':'#0e4d78','--mint':'#e8f3fa','--bg':'#f4f8fb','--border':'#d6e3ec'},
  slate:{'--green':'#4b5563','--green2':'#374151','--mint':'#f1f2f4','--bg':'#f6f7f8','--border':'#dfe1e4'},
  amber:{'--green':'#b06a17','--green2':'#8a4f0f','--mint':'#fdf1e0','--bg':'#faf7f2','--border':'#ecdcc3'}
};
function applyTheme(name){
  const theme=THEMES[name]||THEMES.mint;
  const root=document.documentElement.style;
  Object.entries(theme).forEach(([k,v])=>root.setProperty(k,v));
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',theme['--green2']);
  localStorage.setItem('mgbl_theme',name);
  document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.classList.toggle('active',btn.dataset.themeChoice===name));
  if($('themeTriggerDot')) $('themeTriggerDot').style.background=theme['--green'];
}
function setupThemeMenu(){
  const btn=$('themeMenuBtn'), menu=$('themeMenu');
  if(!btn || !menu || btn.dataset.ready==='1') return;
  btn.dataset.ready='1';
  btn.addEventListener('click',e=>{
    e.stopPropagation();
    const opening=menu.classList.contains('hidden');
    menu.classList.toggle('hidden',!opening);
    btn.setAttribute('aria-expanded',opening?'true':'false');
  });
  document.querySelectorAll('[data-theme-choice]').forEach(option=>{
    option.addEventListener('click',()=>{
      applyTheme(option.dataset.themeChoice);
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded','false');
    });
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('.theme-picker')){
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded','false');
    }
  });
}
applyTheme(localStorage.getItem('mgbl_theme')||'mint');
setupThemeMenu();
const toast=m=>{$('toast').textContent=m;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),2200)};
function setStatus(m,type=''){ $('saveStatus').textContent=m;$('saveStatus').className='status '+type; }
function validateConfig(){return !SUPABASE_URL.includes('PASTE_')&&!SUPABASE_ANON_KEY.includes('PASTE_')}
function turnstileConfigured(){return !!TURNSTILE_SITE_KEY && !TURNSTILE_SITE_KEY.includes('PASTE_')}
function renderTurnstile(){
  if(!turnstileConfigured()){
    if($('turnstileWrap')) $('turnstileWrap').innerHTML='<p class="note" style="text-align:center">Security verification will appear after the Turnstile Site Key is configured.</p>';
    return;
  }
  if(!window.turnstile){setTimeout(renderTurnstile,250);return;}
  if(turnstileWidgetId!==null) return;
  turnstileWidgetId=window.turnstile.render('#turnstileWidget',{
    sitekey:TURNSTILE_SITE_KEY,
    callback:(token)=>{captchaToken=token;},
    'expired-callback':()=>{captchaToken=null;},
    'error-callback':()=>{captchaToken=null;}
  });
}
function resetTurnstile(){
  captchaToken=null;
  if(window.turnstile && turnstileWidgetId!==null){try{window.turnstile.reset(turnstileWidgetId)}catch(e){console.warn('Turnstile reset failed',e)}}
}
function getAuthOptionsWithCaptcha(){
  return turnstileConfigured() ? {captchaToken} : {};
}
function requireCaptcha(messageEl){
  if(turnstileConfigured() && !captchaToken){
    if(messageEl) messageEl.textContent='Please complete the security verification first.';
    return false;
  }
  return true;
}
function setSettingsMessage(id,message,ok=false){
  const el=$(id); if(!el)return; el.textContent=message; el.className=ok?'success-note':'error-note';
}
function showPasswordRecoveryScreen(){
  passwordRecoveryMode=true;
  $('loginView').classList.remove('hidden');
  $('appView').classList.add('hidden');
  $('passwordSetupBox').style.display='none';

  const emailField=$('email')?.closest('.field');
  const passwordField=$('password')?.closest('.field');
  if(emailField) emailField.style.display='none';
  if(passwordField) passwordField.style.display='none';

  $('loginBtn').style.display='none';
  $('forgotPasswordBtn').style.display='none';
  $('turnstileWrap').style.display='none';
  $('forgotPasswordBox').classList.add('hidden');
  $('recoveryBox').classList.remove('hidden');
  $('loginMsg').textContent='Password recovery verified. Create your new password below.';
}

async function init(){

  // A password-reset link must stay on the recovery form rather than being
  // treated as an ordinary signed-in session.
  if (INITIAL_IS_PASSWORD_RECOVERY) {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      showPasswordRecoveryScreen();
      return;
    }
    // If Supabase is still processing the callback, the PASSWORD_RECOVERY
    // auth event below will display the form as soon as the session is ready.
  }

  renderTurnstile();
  $('monthPicker').value = todayMonth();

  if ($('auditMonth')) {
    $('auditMonth').value = todayMonth();
  }

  updateBillingPeriodText();
  $('recStart').value=new Date().toISOString().slice(0,10); if(!validateConfig()){$('loginMsg').textContent='Setup needed: open index.html and paste your Supabase Project URL and anon key. See README.md.';return} 

async function needsPasswordSetup(user) {
  const { data, error } = await sb
    .from('profiles')
    .select('password_setup_complete')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('Could not check password setup:', error);
    return false;
  }

  return data.password_setup_complete !== true;
}

function showPasswordSetup(user) {
  $('passwordSetupBox').style.display = 'block';
  $('loginBtn').style.display = 'none';

  $('email').value = user.email || '';
  $('email').disabled = true;

  $('password').style.display = 'none';
}

const { data: { session } } = await sb.auth.getSession();

if (session) {
  const needsSetup = await needsPasswordSetup(session.user);

  if (needsSetup) {
    showPasswordSetup(session.user);
  } else {
    await enterApp(session.user);
  }

  if(readAuthTransition()==='login'){
    showAuthTransition('Welcome back','Your workspace is ready.',{complete:true});
    clearAuthTransition();
    setTimeout(()=>hideAuthTransition(),420);
  }else{
    clearAuthTransition();
    hideAuthTransition();
  }
}else{
  if(readAuthTransition()==='logout'){
    showAuthTransition('Signed out','Your session has been closed securely.',{complete:true});
    clearAuthTransition();
    setTimeout(()=>hideAuthTransition(),360);
  }else{
    clearAuthTransition();
    hideAuthTransition();
  }
}  
 }
$('loginBtn').onclick=async()=>{
  const btn=$('loginBtn');
  $('loginMsg').textContent='';
  if(!requireCaptcha($('loginMsg'))) return;

  const email=$('email').value.trim();
  const password=$('password').value;
  if(!email || !password){
    $('loginMsg').textContent='Please enter your email and password.';
    return;
  }

  btn.disabled=true;
  const originalText=btn.textContent;
  btn.textContent='Logging in…';

  const credentials={email,password};
  if(turnstileConfigured()) credentials.options={captchaToken};

  const {data,error}=await sb.auth.signInWithPassword(credentials);
  if(error){
    $('loginMsg').textContent=error.message;

    // Restore the login form immediately so the UI never gets stuck waiting
    // for the audit logger. The audit is best-effort and runs independently.
    resetTurnstile();
    btn.disabled=false;
    btn.textContent=originalText;

    try {
      const safeReason = String(error.message || 'Authentication failed')
        .replace(/captcha[^.]*\.?/gi, 'Authentication verification failed.')
        .slice(0, 180);

      sb.functions.invoke('log-failed-login', {
        body: {
          email,
          reason: safeReason
        }
      }).then(({ error: auditError }) => {
        if (auditError) {
          console.warn('Could not record failed login activity:', auditError);
        }
      }).catch(auditErr => {
        console.warn('Could not record failed login activity:', auditErr);
      });
    } catch (auditErr) {
      console.warn('Could not record failed login activity:', auditErr);
    }

    return;
  }

  resetTurnstile();
  $('loginMsg').textContent='';
  showAuthTransition('Signing you in…','Loading your Mintygreen workspace.');
  queueAuthTransition('login');

  // Record this successful login only after the clean page reload.
  // This preserves the existing reliable login flow and avoids doing extra
  // database work inside signInWithPassword itself.
  try {
    sessionStorage.setItem('mintygreenPendingLoginSuccess', JSON.stringify({
      userId: data?.user?.id || '',
      email: data?.user?.email || email,
      at: Date.now()
    }));
  } catch (e) {
    console.warn('Could not queue login activity:', e);
  }

  // Do not run profile/database queries in the same sign-in flow.
  // Supabase has already persisted the new session at this point, so reload
  // immediately and let init() read the session cleanly on the fresh page.
  // This prevents the login button getting stuck on "Logging in…".
  window.location.replace(window.location.href);
};
$('forgotPasswordBtn').onclick=()=>{
  const box=$('forgotPasswordBox');
  box.classList.toggle('hidden');
  $('resetEmail').value=$('email').value.trim();
  $('resetMsg').textContent='';
};
$('sendResetBtn').onclick=async()=>{
  const email=$('resetEmail').value.trim();
  $('resetMsg').textContent='';
  if(!email){$('resetMsg').textContent='Please enter your account email.';return}
  if(!requireCaptcha($('resetMsg'))) return;
  const options={redirectTo:window.location.origin+window.location.pathname};
  if(turnstileConfigured()) options.captchaToken=captchaToken;
  const {error}=await sb.auth.resetPasswordForEmail(email,options);
  resetTurnstile();
  if(error){$('resetMsg').textContent=error.message;return}
  $('resetMsg').textContent='If this account exists, a password reset link has been sent. Please check your email.';
};
$('completeRecoveryBtn').onclick=async()=>{
  const password=$('recoveryPassword').value;
  const confirm=$('recoveryPasswordConfirm').value;
  $('recoveryMsg').textContent='';
  if(!password || !confirm){$('recoveryMsg').textContent='Please enter and confirm your new password.';return}
  if(password!==confirm){$('recoveryMsg').textContent='Passwords do not match.';return}
  if(password.length<8){$('recoveryMsg').textContent='Password must be at least 8 characters.';return}
  const {error}=await sb.auth.updateUser({password});
  if(error){$('recoveryMsg').textContent=error.message;return}
  passwordRecoveryMode=false;
  $('recoveryMsg').textContent='Password updated successfully. You can now continue.';
  const {data:{user}}=await sb.auth.getUser();
  if(user) await enterApp(user);
};
$('logoutBtn').onclick=async()=>{
  const menu=$('accountMenu');
  menu?.classList.add('hidden');
  showAuthTransition('Signing you out…','Closing your session securely.');
  queueAuthTransition('logout');

  const {error}=await sb.auth.signOut();
  if(error){
    clearAuthTransition();
    hideAuthTransition();
    toast(error.message || 'Could not sign out');
    return;
  }

  showAuthTransition('Signed out','See you again soon.',{complete:true});
  setTimeout(()=>location.replace(window.location.origin+window.location.pathname),420);
};
$('setPasswordBtn').onclick = async () => {
  const newPassword = $('newPassword').value;
  const confirmPassword = $('confirmPassword').value;

  if (!newPassword || !confirmPassword) {
    $('loginMsg').textContent = 'Please enter and confirm your new password.';
    return;
  }

  if (newPassword !== confirmPassword) {
    $('loginMsg').textContent = 'Passwords do not match.';
    return;
  }

  if (newPassword.length < 6) {
    $('loginMsg').textContent = 'Password must be at least 6 characters.';
    return;
  }

 const { data, error } = await sb.auth.updateUser({
  password: newPassword
});

if (error) {
  $('loginMsg').textContent = error.message;
  return;
}

const { error: profileError } = await sb.rpc('complete_password_setup');

if (profileError) {
  $('loginMsg').textContent =
    'Password was created, but account setup could not be completed. Please contact Admin.';
  return;
}

$('loginMsg').textContent = 'Password created successfully.';

await enterApp(data.user);
};


$('changeDisplayNameBtn').onclick=async()=>{
  const btn=$('changeDisplayNameBtn');
  const newName=($('settingsDisplayName')?.value||'').trim();
  setSettingsMessage('changeDisplayNameMsg','');

  if(!newName){
    setSettingsMessage('changeDisplayNameMsg','Please enter a display name.');
    return;
  }

  if(newName.length>80){
    setSettingsMessage('changeDisplayNameMsg','Display name must be 80 characters or fewer.');
    return;
  }

  const originalText=btn.textContent;
  btn.disabled=true;
  btn.textContent='Saving…';

  const {error}=await sb.rpc('set_my_display_name',{
    new_display_name:newName
  });

  btn.disabled=false;
  btn.textContent=originalText;

  if(error){
    setSettingsMessage('changeDisplayNameMsg',error.message);
    return;
  }

  currentUserDisplayName=newName;
  updateCurrentUserIdentityUI();
  setSettingsMessage('changeDisplayNameMsg','✓ Display name updated successfully.',true);
  toast('Display name updated');

  // Refresh any identity-based admin view that is currently open.
  if(!$('staffTab')?.classList.contains('hidden')) loadStaffList();
  if(!$('backupsTab')?.classList.contains('hidden')) loadBackupsList();
};

$('changeEmailBtn').onclick=async()=>{
  const newEmail=$('settingsNewEmail').value.trim();
  const btn=$('changeEmailBtn');
  setSettingsMessage('changeEmailMsg','');

  if(!newEmail){
    setSettingsMessage('changeEmailMsg','Please enter a new email address.');
    return;
  }

  if(currentUser && newEmail.toLowerCase()===(currentUser.email||'').toLowerCase()){
    setSettingsMessage('changeEmailMsg','This is already your current email address.');
    return;
  }

  // Email confirmation can invalidate/replace an older browser session.
  // Verify that this tab still has a live Supabase session before updating.
  const {data:{session},error:sessionError}=await sb.auth.getSession();

  if(sessionError || !session){
    setSettingsMessage(
      'changeEmailMsg',
      'Your login session has expired after the previous email confirmation. Please log out and sign in again with your current email, then try again.'
    );
    return;
  }

  btn.disabled=true;
  const originalText=btn.textContent;
  btn.textContent='Changing…';

  // Use the standard Supabase email update flow.
  const {data,error}=await sb.auth.updateUser(
    {email:newEmail},
    {emailRedirectTo:'https://minty-green.github.io/Charges/email-change-success.html'}
  );

  btn.disabled=false;
  btn.textContent=originalText;

  if(error){
    if(/auth session missing/i.test(error.message||'')){
      setSettingsMessage(
        'changeEmailMsg',
        'Your login session is no longer valid. Please log out and sign in again, then retry the email change.'
      );
    }else{
      setSettingsMessage('changeEmailMsg',error.message);
    }
    return;
  }

  if(data?.user) currentUser=data.user;
  $('settingsNewEmail').value='';
  setSettingsMessage(
    'changeEmailMsg',
    '✓ Email change requested. Complete the confirmation email(s). After confirmation, sign in again using the new email address.',
    true
  );
  toast('Email confirmation sent');
};
$('changePasswordBtn').onclick=async()=>{
  const btn=$('changePasswordBtn');
  const currentPassword=$('settingsCurrentPassword').value;
  const newPassword=$('settingsNewPassword').value;
  const confirmPassword=$('settingsConfirmPassword').value;
  setSettingsMessage('changePasswordMsg','');

  if(!currentPassword){setSettingsMessage('changePasswordMsg','Please enter your current password.');return}
  if(!newPassword || !confirmPassword){setSettingsMessage('changePasswordMsg','Please enter and confirm your new password.');return}
  if(newPassword!==confirmPassword){setSettingsMessage('changePasswordMsg','New passwords do not match.');return}
  if(newPassword.length<8){setSettingsMessage('changePasswordMsg','New password must be at least 8 characters.');return}

  const originalText=btn.textContent;
  btn.disabled=true;
  btn.textContent='Changing…';

  const {error}=await sb.auth.updateUser({
    password:newPassword,
    current_password:currentPassword
  });

  btn.disabled=false;
  btn.textContent=originalText;

  if(error){
    setSettingsMessage('changePasswordMsg',error.message);
    return;
  }

  $('settingsCurrentPassword').value='';
  $('settingsNewPassword').value='';
  $('settingsConfirmPassword').value='';
  setSettingsMessage('changePasswordMsg','✓ Password changed successfully. Use the new password the next time you log in.',true);
  toast('Password changed successfully');

  // Keep a very clear confirmation visible in the Settings panel.
  const msgEl=$('changePasswordMsg');
  if(msgEl){
    msgEl.style.fontWeight='700';
    msgEl.style.padding='10px 12px';
    msgEl.style.border='1px solid var(--border)';
    msgEl.style.borderRadius='8px';
    msgEl.style.background='var(--mint)';
    msgEl.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
};

async function recordPendingLoginSuccess(user){
  let pending = null;

  try {
    const raw = sessionStorage.getItem('mintygreenPendingLoginSuccess');
    if (!raw) return;

    pending = JSON.parse(raw);

    // Clear first so a network/database error cannot create repeated records
    // on every reload.
    sessionStorage.removeItem('mintygreenPendingLoginSuccess');
  } catch (e) {
    console.warn('Could not read queued login activity:', e);
    try { sessionStorage.removeItem('mintygreenPendingLoginSuccess'); } catch (_) {}
    return;
  }

  if (!pending || pending.userId !== user?.id) return;

  // Ignore stale queued markers (for example, a tab left open overnight).
  if (pending.at && Date.now() - Number(pending.at) > 10 * 60 * 1000) return;

  const { error } = await sb.from('login_activity').insert({
    attempted_email: user?.email || pending.email || null,
    user_id: user.id,
    result: 'SUCCESS',
    failure_reason: null
  });

  if (error) {
    console.warn('Could not record successful login activity:', error);
  }
}

async function enterApp(user){
  currentUser=user;
  await recordPendingLoginSuccess(user);
  await loadCurrentUserRole();
  await loadBranchContext();
  updateCurrentUserIdentityUI();$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');await Promise.all([loadResidents(),loadItems()]);renderSelectors();renderResidentList();renderBranchList();await loadRecurring();renderCalendar();

  if (window.matchMedia('(max-width: 700px)').matches) {
    chargesDisplayMode='daily';
    setChargesDisplayMode('daily');
  } else {
    setChargesDisplayMode('calendar');
  }

  setTimeout(maybeShowMobileInstallPopup,850);
  setTimeout(maybeShowWhatsNew, isPhoneViewport() ? 2200 : 900);
}
async function loadResidents(){const {data,error}=await sb.from('residents').select('*').eq('active',true).eq('branch_id',currentBranchId).order('name');if(error)throw error;residents=data||[]}
async function loadItems(){const {data,error}=await sb.from('items').select('*').eq('active',true).eq('branch_id',currentBranchId).order('sort_order').order('name');if(error)throw error;items=data||[]}
async function loadAllItems(){const {data,error}=await sb.from('items').select('*').eq('branch_id',currentBranchId).order('category').order('name');if(error)return toast(error.message);allItems=data||[];renderItemList()}

function getCurrentBillingBounds(){
  const month = $('monthPicker')?.value || todayMonth();
  return getBillingCycle(month);
}
function clampDailyDateToCycle(dateStr){
  const cycle = getCurrentBillingBounds();
  if(!cycle) return dateStr;
  if(dateStr < cycle.start) return cycle.start;
  if(dateStr > cycle.end) return cycle.end;
  return dateStr;
}
function formatDailyDisplayDate(dateStr){
  if(!dateStr) return '-';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-MY',{
    day:'2-digit',month:'short',year:'numeric'
  });
}
function setChargesDisplayMode(mode){
  chargesDisplayMode = mode === 'daily' ? 'daily' : 'calendar';
  const daily = $('dailyEntryView');
  const tableCard = $('chargesTab')?.querySelector('.table-card');
  const summary = $('chargesTab')?.querySelector('.summary');
  const actions = $('chargesTab')?.querySelector('.toolbar-actions');

  if($('dailyViewBtn')) $('dailyViewBtn').classList.toggle('active', chargesDisplayMode==='daily');
  if($('calendarViewBtn')) $('calendarViewBtn').classList.toggle('active', chargesDisplayMode==='calendar');

  if(daily){
    daily.classList.toggle('hidden-desktop', chargesDisplayMode!=='daily');
    daily.style.display = chargesDisplayMode==='daily' ? 'block' : 'none';
  }
  if(tableCard) tableCard.style.display = chargesDisplayMode==='calendar' ? 'block' : 'none';
  if(summary) summary.style.display = chargesDisplayMode==='calendar' ? 'grid' : 'none';
  if(actions) actions.style.display = chargesDisplayMode==='calendar' ? 'flex' : 'none';

  if(chargesDisplayMode==='daily'){
    loadDailyEntry();
  } else {
    renderCalendar();
    applyBillingCycleStatus();
  }
}
function setDailySaveStatus(message, state=''){
  const el = $('dailySaveStatus');
  if(!el) return;
  el.textContent = message || '';
  el.classList.remove('saving','saved','error','locked');
  if(state) el.classList.add(state);
}
let dailySaveToastTimer=null;
function showDailySaveToast(message,state='saved'){
  const el=$('dailySaveToast');
  if(!el)return;
  clearTimeout(dailySaveToastTimer);
  el.textContent=message||'';
  el.classList.remove('saved','error','show');
  el.classList.add(state==='error'?'error':'saved');
  requestAnimationFrame(()=>el.classList.add('show'));
  dailySaveToastTimer=setTimeout(()=>el.classList.remove('show'), state==='error'?3200:1600);
}

async function loadDailyEntry(){
  const rid = $('dailyResidentSelect')?.value || $('residentSelect')?.value || '';
  await loadBillingCycleStatus(rid);
  dailySelectedDate = clampDailyDateToCycle(dailySelectedDate || formatDateISO(new Date()));
  if($('dailyDateDisplay')) $('dailyDateDisplay').textContent = formatDailyDisplayDate(dailySelectedDate);

  if(!rid){
    dailyEntries = [];
    renderDailyEntry();
    return;
  }

  setDailySaveStatus('Loading charges…','saving');

  const {data,error} = await sb
    .from('charge_entries')
    .select('*')
    .eq('resident_id', rid)
    .eq('charge_date', dailySelectedDate);

  if(error){
    setDailySaveStatus(error.message,'error');
    return;
  }

  dailyEntries = data || [];
  renderDailyEntry();
}

function applyDailyEntrySearch(){
  const search = dailyItemSearchText.trim().toLowerCase();
  const categories = Array.from(document.querySelectorAll('#dailyEntryList .daily-category'));
  let visibleCount = 0;

  categories.forEach(category => {
    const rows = Array.from(category.querySelectorAll('.daily-item'));
    let visibleInCategory = 0;

    rows.forEach(row => {
      const itemName = (row.dataset.itemName || '').toLowerCase();
      const matches = !search || itemName.includes(search);
      row.classList.toggle('daily-search-hidden', !matches);
      if(matches){
        visibleCount++;
        visibleInCategory++;
      }
    });

    category.classList.toggle('daily-search-hidden', visibleInCategory === 0);
  });

  const status = $('dailySearchStatus');
  if(status){
    if(search){
      status.textContent = `${visibleCount} item${visibleCount===1?'':'s'} matching “${dailyItemSearchText.trim()}”`;
      status.classList.remove('hidden');
    }else{
      status.textContent = '';
      status.classList.add('hidden');
    }
  }
}

function jumpToDailyItem(itemId){
  let row = document.querySelector(`#dailyEntryList .daily-item[data-item-id="${itemId}"]`);
  if(!row) return;

  if(row.classList.contains('daily-search-hidden')){
    dailyItemSearchText = '';
    if($('dailyItemSearch')) $('dailyItemSearch').value = '';
    applyDailyEntrySearch();
    row = document.querySelector(`#dailyEntryList .daily-item[data-item-id="${itemId}"]`);
  }

  row.scrollIntoView({behavior:'smooth', block:'center'});
  row.classList.remove('daily-jump-highlight');
  requestAnimationFrame(() => {
    row.classList.add('daily-jump-highlight');
    setTimeout(() => row.classList.remove('daily-jump-highlight'), 1400);
  });
}

function renderDailyEntry(){
  const list = $('dailyEntryList');
  if(!list) return;

  const rid = $('dailyResidentSelect')?.value || '';
  if(!rid){
    list.innerHTML = '<div class="daily-no-resident"><strong>Select a resident</strong>Choose a resident above to start entering charges for the selected date.</div>';
    if($('dailyExisting')) $('dailyExisting').classList.add('hidden');
    if($('dailyEntryCount')) $('dailyEntryCount').textContent = '0 entries';
    if($('dailyEntryTotal')) $('dailyEntryTotal').textContent = money(0);
    setDailySaveStatus('Select a resident to begin.');
    return;
  }

  const existingLines = [];
  let total = 0;
  let count = 0;

  const html = groupItems().map(([cat, listItems]) => {
    const rows = listItems.map(it => {
      const en = dailyEntries.find(e => e.item_id === it.id);
      const qty = en ? Number(en.quantity) : 0;
      const amount = qty * Number(en?.unit_price ?? it.price ?? 0);
      if(qty > 0){
        count++;
        total += amount;
        existingLines.push({
          itemId: it.id,
          name: it.name,
          qty
        });
      }
      const isReadOnlyRecurring = isRecurringReadOnlyItem(it, rid);
      return `
        <div
          class="daily-item${qty > 0 ? ' has-quantity' : ''}${isReadOnlyRecurring ? ' daily-readonly' : ''}"
          data-item-id="${it.id}"
          data-item-name="${esc(it.name)}"
        >
          <div class="daily-item-info">
            <strong>${esc(it.name)}</strong>
            <small>${esc(it.unit || '')}${it.price == null ? '' : ' · ' + money(it.price)}${isReadOnlyRecurring ? ' · Monthly Package / Service · Read only' : ''}</small>
          </div>
          ${isReadOnlyRecurring ? `
            <div class="daily-readonly-badge" title="Managed in Monthly Packages">Read only</div>
          ` : `
            <div class="daily-stepper">
              <button type="button" onclick="changeDailyQty('${it.id}',-1)" aria-label="Decrease ${esc(it.name)}" title="Decrease">−</button>
              <input type="number" min="0" step="1" inputmode="numeric" value="${qty || ''}" data-daily-item="${it.id}" onchange="setDailyQtyFromInput(this)" aria-label="Quantity for ${esc(it.name)}">
              <button type="button" onclick="changeDailyQty('${it.id}',1)" aria-label="Increase ${esc(it.name)}" title="Increase">+</button>
            </div>
          `}
        </div>
      `;
    }).join('');

    return `<div class="daily-category"><h4>${esc(cat)}</h4>${rows}</div>`;
  }).join('');

  list.innerHTML = html || '<p class="note">No active items available.</p>';

  if($('dailyExisting')){
    $('dailyExisting').classList.toggle('hidden', existingLines.length===0);
    if($('dailyExistingList')) $('dailyExistingList').innerHTML = existingLines.map(x=>`
      <button
        class="daily-existing-entry"
        type="button"
        onclick="jumpToDailyItem('${x.itemId}')"
        title="Jump to ${esc(x.name)}"
      >
        <span class="daily-existing-name">${esc(x.name)}</span>
        <span class="daily-existing-qty">× ${Number(x.qty)}</span>
      </button>
    `).join('');
  }

  if($('dailyEntryCount')) $('dailyEntryCount').textContent = `${count} ${count===1?'entry':'entries'}`;
  if($('dailyEntryTotal')) $('dailyEntryTotal').textContent = money(total);
  setDailySaveStatus(currentCycleLocked ? 'Billing cycle is locked.' : 'Ready · changes save automatically', currentCycleLocked ? 'locked' : '');

  document.querySelectorAll('[data-daily-item]').forEach(inp => {
    inp.disabled = currentCycleLocked;
  });
  document.querySelectorAll('.daily-stepper button').forEach(btn => {
    btn.disabled = currentCycleLocked;
  });

  applyDailyEntrySearch();
}
async function saveDailyQty(itemId, qty){
  const rid = $('dailyResidentSelect')?.value;
  if(!rid) return toast('Select a resident first');
  if(currentCycleLocked) return toast('Billing cycle is locked');

  const item = items.find(i => i.id === itemId);
  if(!item) return;
  if(isRecurringReadOnlyItem(item, rid)){
    showDailySaveToast('Monthly packages and services are read only here.','error');
    return;
  }

  qty = Math.max(0, Number(qty || 0));
  const existing = dailyEntries.find(e => e.item_id === itemId);

  setDailySaveStatus('Saving…','saving');

  let error = null;

  if(qty <= 0 && existing){
    ({error} = await sb.from('charge_entries').delete().eq('id', existing.id));
  }else if(qty > 0){
    const payload = {
      resident_id: rid,
      item_id: item.id,
      charge_date: dailySelectedDate,
      quantity: qty,
      unit_price: Number(item.price || 0),
      updated_by: currentUser.id,
      branch_id: currentBranchId
    };

    if(existing){
      ({error} = await sb.from('charge_entries').update(payload).eq('id', existing.id));
    }else{
      const res = await sb.from('charge_entries')
        .insert({...payload, created_by: currentUser.id})
        .select()
        .single();
      error = res.error;
    }
  }

  if(error){
    setDailySaveStatus(error.message,'error');
    showDailySaveToast(`Save failed — ${error.message}`,'error');
    return toast(error.message);
  }

  await loadDailyEntry();
  showDailySaveToast(`✓ Saved — ${item.name} · Qty ${qty}`,'saved');

  if($('residentSelect')?.value === rid){
    await loadMonth();
  }

  setDailySaveStatus('Saved','saved');
  clearTimeout(window.__dailySavedTimer);
  window.__dailySavedTimer = setTimeout(() => {
    if(!currentCycleLocked) setDailySaveStatus('Ready · changes save automatically');
  }, 1800);
}
window.changeDailyQty = async (itemId, delta) => {
  const existing = dailyEntries.find(e => e.item_id === itemId);
  const current = existing ? Number(existing.quantity) : 0;
  await saveDailyQty(itemId, current + delta);
};
window.setDailyQtyFromInput = async input => {
  await saveDailyQty(input.dataset.dailyItem, Number(input.value || 0));
};
function shiftDailyDate(days){
  const d = new Date(dailySelectedDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  dailySelectedDate = clampDailyDateToCycle(formatDateISO(d));
  loadDailyEntry();
}

function renderSelectors() {

  const opts =
    '<option value="">Select resident...</option>' +
    residents
      .map(
        r =>
          `<option value="${r.id}">${esc(r.name)}</option>`
      )
      .join('');

  $('residentSelect').innerHTML = opts;

  if ($('dailyResidentSelect')) {
    const currentDaily = $('dailyResidentSelect').value;
    $('dailyResidentSelect').innerHTML = opts;
    if (residents.some(r => r.id === currentDaily)) {
      $('dailyResidentSelect').value = currentDaily;
    } else if ($('residentSelect').value) {
      $('dailyResidentSelect').value = $('residentSelect').value;
    }
  }

  if ($('recResident')) {
    $('recResident').innerHTML = opts;
  }

  if ($('auditResident')) {

    $('auditResident').innerHTML =
      '<option value="">All Residents</option>' +
      residents
        .map(
          r =>
            `<option value="${r.id}">${esc(r.name)}</option>`
        )
        .join('');
  }
const recurringItems = items.filter(item =>
  [
    'machine rental',
    'packages',
    'package',
    'services',
    'service'
  ].includes(
    String(item.category || '').trim().toLowerCase()
  )
);

$('recItem').innerHTML =
  '<option value="">Select package / item...</option>' +
  recurringItems
    .map(
      item =>
        `<option
          value="${item.id}"
          data-price="${Number(item.price || 0)}"
        >
          ${esc(item.name)}
        </option>`
    )
    .join('');
  
$('recResident').onchange = loadRecurring;
}$('recItem').onchange=()=>{
  const o=$('recItem').selectedOptions[0];
  if(o?.dataset.price){
    $('recAmount').value=Number(o.dataset.price).toFixed(2);
  }
  loadRecurring();
};
$('reloadBtn').onclick=loadMonth;
$('residentSelect').onchange=()=>{
  loadMonth();
  if($('dailyResidentSelect')) {
    $('dailyResidentSelect').value = $('residentSelect').value;
    loadDailyEntry();
  }
};
if($('dailyResidentSelect')) $('dailyResidentSelect').onchange=()=>{
  if($('residentSelect')) $('residentSelect').value = $('dailyResidentSelect').value;
  loadDailyEntry();
};
if($('dailyPrevBtn')) $('dailyPrevBtn').onclick=()=>shiftDailyDate(-1);
if($('dailyNextBtn')) $('dailyNextBtn').onclick=()=>shiftDailyDate(1);
if($('dailyTodayBtn')) $('dailyTodayBtn').onclick=()=>{
  dailySelectedDate = clampDailyDateToCycle(formatDateISO(new Date()));
  loadDailyEntry();
};
if($('dailyViewBtn')) $('dailyViewBtn').onclick=()=>setChargesDisplayMode('daily');
if($('calendarViewBtn')) $('calendarViewBtn').onclick=()=>setChargesDisplayMode('calendar');
$('monthPicker').onchange = () => {
  updateBillingPeriodText();
  dailySelectedDate = clampDailyDateToCycle(dailySelectedDate);
  loadMonth();
  if(chargesDisplayMode==='daily') loadDailyEntry();
};
function updateBillingPeriodText() {

  const month =
    $('monthPicker').value;

  const cycle =
    getBillingCycle(month);

  if (!cycle) {

    $('billingPeriodText').textContent = '';

    return;
  }

  $('billingPeriodText').textContent =
    `${formatShortDate(cycle.startDate)} – ` +
    `${formatShortDate(cycle.endDate)}`;
}
async function loadMonth() {
  const resident_id = $('residentSelect').value;
  const month = $('monthPicker').value;

  if (!resident_id || !month) {
    entries = [];
    recurring = [];
    renderCalendar();
    return;
  }

  setStatus('Loading…');

  const cycle = getBillingCycle(month);

  if (!cycle) {
    setStatus('Invalid billing cycle', 'err');
    return;
  }

  const start = cycle.start;
  const end = cycle.end;

  const [e, r] = await Promise.all([
    sb
      .from('charge_entries')
      .select('*')
      .eq('resident_id', resident_id)
      .gte('charge_date', start)
      .lte('charge_date', end),

    sb
      .from('recurring_charges')
      .select('*, items(name,unit)')
      .eq('resident_id', resident_id)
      .lte('start_date', end)
      .or(`end_date.is.null,end_date.gte.${start}`)
  ]);

  if (e.error || r.error) {
    setStatus((e.error || r.error).message, 'err');
    return;
  }

entries = e.data || [];

recurring = r.data || [];

await loadRecurringPricingData();

await loadBillingCycleStatus();

renderCalendar();

applyBillingCycleStatus();

setStatus(
    `Loaded ${formatShortDate(cycle.startDate)} – ${formatShortDate(cycle.endDate)}. Changes save automatically.`,
    'ok'
  );
}function groupItems(){const order=['Stock','Machine Rental','Package','Service'];return order.map(c=>[c,items.filter(i=>i.category===c)]).filter(x=>x[1].length)}
function isRecurringReadOnlyItem(item){
  if(!item) return false;

  // Prevent accidental double charging:
  // Machine Rental, Package and Service items are always managed through
  // Monthly Packages and are read-only in both Daily Entry and Master Calendar.
  const recurringCategory = ['Machine Rental','Package','Service'].includes(
    String(item.category || '').trim()
  );

  const hasRecurringRecord = recurring.some(r =>
    r.item_id === item.id
  );

  return recurringCategory || hasRecurringRecord;
}

function getCalendarCategoryNames() {
  return groupItems().map(([cat]) => cat);
}

function updateCalendarCategoryToggleIcons() {
  document.querySelectorAll('#calendarTable .section-row').forEach(row => {
    const cat = row.dataset.category || '';
    const btn = row.querySelector('.calendar-category-toggle');
    if (!btn) return;

    const collapsed = collapsedCalendarCategories.has(cat);
    btn.textContent = collapsed ? '▶' : '▼';
    btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${cat}`);
    btn.title = `${collapsed ? 'Expand' : 'Collapse'} ${cat}`;
  });
}

function applyCalendarViewFilters() {
  const table = $('calendarTable');
  if (!table) return;

  const search = calendarItemSearchText.trim().toLowerCase();
  const itemRows = Array.from(
    table.querySelectorAll('tbody tr.calendar-item-row')
  );
  const sectionRows = Array.from(
    table.querySelectorAll('tbody tr.section-row')
  );

  let visibleItems = 0;

  sectionRows.forEach(sectionRow => {
    const category = sectionRow.dataset.category || '';
    const categoryRows = itemRows.filter(
      row => (row.dataset.category || '') === category
    );

    let categoryVisibleCount = 0;

    categoryRows.forEach(row => {
      const itemName = (row.dataset.itemName || '').toLowerCase();
      const matchesSearch = !search || itemName.includes(search);

      // Search temporarily reveals matching items even if their category
      // was collapsed. Clearing the search restores the collapsed state.
      const hiddenByCollapse =
        !search && collapsedCalendarCategories.has(category);

      const shouldShow = matchesSearch && !hiddenByCollapse;
      row.classList.toggle('hidden', !shouldShow);

      if (shouldShow) {
        categoryVisibleCount++;
        visibleItems++;
      }
    });

    sectionRow.classList.toggle(
      'hidden',
      search ? categoryVisibleCount === 0 : false
    );
  });

  const oldNoResults =
    table.querySelector('tbody tr.calendar-no-results');

  if (oldNoResults) oldNoResults.remove();

  if (search && visibleItems === 0) {
    const tbody = table.querySelector('tbody');
    const columnCount =
      table.querySelectorAll('thead th').length || 1;

    if (tbody) {
      const row = document.createElement('tr');
      row.className = 'calendar-no-results';
      row.innerHTML =
        `<td colspan="${columnCount}">No items found for “${esc(calendarItemSearchText.trim())}”.</td>`;
      tbody.appendChild(row);
    }
  }

  const status = $('calendarFilterStatus');
  if (status) {
    if (search) {
      status.textContent =
        `${visibleItems} item${visibleItems === 1 ? '' : 's'} matching “${calendarItemSearchText.trim()}”`;
      status.classList.remove('hidden');
    } else {
      status.textContent = '';
      status.classList.add('hidden');
    }
  }

  updateCalendarCategoryToggleIcons();
}

function toggleCalendarCategory(category) {
  if (!category) return;

  if (collapsedCalendarCategories.has(category)) {
    collapsedCalendarCategories.delete(category);
  } else {
    collapsedCalendarCategories.add(category);
  }

  applyCalendarViewFilters();
}

function expandAllCalendarCategories() {
  collapsedCalendarCategories.clear();
  applyCalendarViewFilters();
}

function collapseAllCalendarCategories() {
  getCalendarCategoryNames().forEach(cat =>
    collapsedCalendarCategories.add(cat)
  );
  applyCalendarViewFilters();
}

function renderCalendar() {
  const month = $('monthPicker').value || todayMonth();
  const billingDates = getBillingDates(month);
  const cycle = getBillingCycle(month);
  const todayIso = formatDateISO(new Date());
  const rid = $('residentSelect').value;

  let h = `
    <thead>
      <tr>
        <th class="item-col">Item</th>
        <th class="unit-col">Unit</th>
        <th class="price-col">Price</th>
  `;

  for (const d of billingDates) {
    const isToday = d.date === todayIso;
    h += `<th class="${isToday ? 'today-column' : ''}" title="${d.date}${isToday ? ' · Today' : ''}">${d.day}</th>`;
  }

  h += `
        <th class="total-col">Total</th>
      </tr>
    </thead>
    <tbody>
  `;

  for (const [cat, list] of groupItems()) {

    h += `
      <tr
        class="section-row"
        data-category="${esc(cat)}"
        title="Click to expand or collapse ${esc(cat)}"
      >
        <td class="item-col"><button class="calendar-category-toggle" type="button" tabindex="-1" aria-hidden="true">▼</button>${esc(cat)}</td>
        <td class="unit-col"></td>
        <td class="price-col"></td>
        ${billingDates.map(d => `<td class="${d.date === todayIso ? 'today-column' : ''}"></td>`).join('')}
        <td class="total-col"></td>
      </tr>
    `;

    for (const it of list) {

      let rowTotal = 0;
      const isRecurringCategory = isRecurringReadOnlyItem(it, rid);

      // Machine Rental / Package / Service rows are always read-only here to
      // prevent accidental double charging. Actual recurring amounts are still
      // calculated only from recurring records assigned to the selected resident.
      const itemRecurringCharges = isRecurringCategory
        ? recurring.filter(r => r.item_id === it.id && r.resident_id === rid)
        : [];

      let recurringProrateNote = '';
      let recurringTotalTooltip = '';

      if (isRecurringCategory) {
        const recurringDetails =
          itemRecurringCharges.map(r =>
            getRecurringBillingDetails(r, month)
          );

        rowTotal = recurringDetails.reduce(
          (sum, detail) =>
            sum + Number(detail.amount || 0),
          0
        );

        const partialDetails =
          recurringDetails.filter(
            detail => detail.isProrated
          );

        if (partialDetails.length === 1) {
          recurringProrateNote =
            `${partialDetails[0].activeDays} / ${partialDetails[0].cycleDays} days`;
        } else if (partialDetails.length > 1) {
          recurringProrateNote = 'Prorated';
        }

        recurringTotalTooltip =
          itemRecurringCharges
            .map(r => getRecurringProrateTooltip(r, month))
            .filter(Boolean)
            .join(' · ');
      }

      h += `
        <tr
          class="calendar-item-row"
          data-category="${esc(cat)}"
          data-item-name="${esc(it.name)}"
        >
          <td class="item-col">${esc(it.name)}</td>
          <td class="unit-col">${esc(it.unit || '')}</td>
          <td class="price-col">
            ${it.price == null ? '—' : money(it.price)}
          </td>
      `;

      for (const d of billingDates) {

        const date = d.date;

        if (isRecurringCategory) {
          // "S" = the actual subscription commencement date.
          const subscriptionStartsToday = itemRecurringCharges.some(
            r => r.start_date === date
          );

          // "✓" = first date this recurring charge is applicable
          // inside the currently displayed 25 -> 24 billing cycle.
          const activeFromToday = itemRecurringCharges.some(r => {
            if (!cycle) return false;
            const effectiveStart =
              r.start_date > cycle.start
                ? r.start_date
                : cycle.start;

            return effectiveStart === date;
          });

          // "■" = actual recurring subscription stop/end date.
          const subscriptionStopsToday = itemRecurringCharges.some(
            r => r.end_date && r.end_date === date
          );

          const markers = [
            subscriptionStartsToday
              ? '<span class="subscription-start-badge">S</span>'
              : '',
            activeFromToday
              ? '<span class="recurring-start-tick">✓</span>'
              : '',
            subscriptionStopsToday
              ? '<span class="subscription-stop-badge">■</span>'
              : ''
          ].join('');

          let markerTitle = 'Managed in Monthly Packages';
          const markerDescriptions = [];
          if (subscriptionStartsToday) markerDescriptions.push(`Actual subscription start date: ${date}`);
          if (activeFromToday) markerDescriptions.push(`Active from this billing-cycle date: ${date}`);
          if (subscriptionStopsToday) markerDescriptions.push(`Subscription stop/end date: ${date}`);
          if (markerDescriptions.length) markerTitle = markerDescriptions.join(' · ');

          h += `
            <td
              class="recurring-date-cell ${date === todayIso ? 'today-column' : ''}"
              title="${markerTitle}"
              aria-label="${esc(it.name)} ${date} read only${subscriptionStartsToday ? ', subscription starts today' : ''}${activeFromToday ? ', active from today in this billing cycle' : ''}${subscriptionStopsToday ? ', subscription stops today' : ''}"
            >
              ${markers}
            </td>
          `;
          continue;
        }

        const en = entries.find(
          x =>
            x.item_id === it.id &&
            x.charge_date === date
        );

        const q = en ? Number(en.quantity) : 0;

        rowTotal +=
          q *
          Number(
            en?.unit_price ??
            it.price ??
            0
          );

        h += `
          <td class="${date === todayIso ? 'today-column' : ''}">
            <input
              class="qty ${q ? 'nonzero' : ''}"
              type="number"
              min="0"
              step="1"
              value="${q || ''}"
              data-item="${it.id}"
              data-date="${date}"
              data-entry="${en?.id || ''}"
              aria-label="${esc(it.name)} ${date}"
              title="${date}"
            >
          </td>
        `;
      }

      h += `
          <td
            class="total-col ${isRecurringCategory ? 'recurring-total' : ''}"
            ${recurringTotalTooltip ? `title="${esc(recurringTotalTooltip)}"` : ''}
          >
            ${money(rowTotal)}
            ${
              recurringProrateNote
                ? `<span class="recurring-prorate-note">${recurringProrateNote}</span>`
                : ''
            }
          </td>
        </tr>
      `;
    }
  }

  h += '</tbody>';

  $('calendarTable').innerHTML = h;

  if (rid && cycle) {

    const resident =
      residents.find(r => r.id === rid);

    $('calendarTitle').textContent =
      `${resident?.name || ''} · ` +
      `${formatShortDate(cycle.startDate)} – ` +
      `${formatShortDate(cycle.endDate)}`;

  } else {

    $('calendarTitle').textContent =
      'Calendar Charges';
  }

  document
    .querySelectorAll('.qty')
    .forEach(i =>
      i.addEventListener('change', saveQty)
    );

  document
    .querySelectorAll('#calendarTable .section-row')
    .forEach(row => {
      row.addEventListener('click', () =>
        toggleCalendarCategory(row.dataset.category || '')
      );
    });

  applyCalendarViewFilters();

  renderMonthlyRecurringDisplay();
  updateSummary();
}async function saveQty(ev){const input=ev.target,rid=$('residentSelect').value;if(!rid)return;if(!currentBranchId){setStatus('No active branch selected — reselect a branch and retry','err');return}const qty=Number(input.value||0),item=items.find(i=>i.id===input.dataset.item);if(!item)return;setStatus('Saving…');let error;if(qty<=0&&input.dataset.entry){({error}=await sb.from('charge_entries').delete().eq('id',input.dataset.entry))}else if(qty>0){const payload={resident_id:rid,item_id:item.id,charge_date:input.dataset.date,quantity:qty,unit_price:Number(item.price||0),updated_by:currentUser.id,branch_id:currentBranchId};if(input.dataset.entry)({error}=await sb.from('charge_entries').update(payload).eq('id',input.dataset.entry));else {const res=await sb.from('charge_entries').insert({...payload,created_by:currentUser.id}).select().single();error=res.error;if(res.data)input.dataset.entry=res.data.id}}if(error){setStatus(error.message,'err');return}input.classList.toggle('nonzero',qty>0);await loadMonth();setStatus('Saved','ok')}
function daysInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  ) {
    return 0;
  }

  return (
    Math.floor(
      (end.getTime() - start.getTime()) /
      86400000
    ) + 1
  );
}

function getRecurringBillingDetails(recurringCharge, billingMonth) {
  const cycle = getBillingCycle(billingMonth);

  if (!cycle) {
    return {
      amount: 0,
      normalAmount: 0,
      isProrated: false,
      activeDays: 0,
      cycleDays: 0,
      effectiveStart: null,
      effectiveEnd: null,
      hasSpecialOverride: false
    };
  }

  const originalAmount =
    Number(recurringCharge.amount) || 0;

  // 1. Find the normal monthly price, including any
  // permanent price change effective for this billing month.
  const permanentPrices = recurringPriceHistory
    .filter(
      p =>
        p.recurring_charge_id === recurringCharge.id &&
        p.effective_billing_month <= billingMonth
    )
    .sort((a, b) =>
      b.effective_billing_month.localeCompare(
        a.effective_billing_month
      )
    );

  let normalAmount = originalAmount;

  if (permanentPrices.length) {
    normalAmount =
      Number(permanentPrices[0].amount) || 0;
  }

  // 2. Special Month is always the highest-priority amount.
  // It is intentionally NOT prorated.
  const specialPrice = recurringOverrides.find(
    o =>
      o.recurring_charge_id === recurringCharge.id &&
      o.billing_month === billingMonth
  );

  const cycleStart = cycle.start;
  const cycleEnd = cycle.end;

  const effectiveStart =
    recurringCharge.start_date > cycleStart
      ? recurringCharge.start_date
      : cycleStart;

  const effectiveEnd =
    recurringCharge.end_date &&
    recurringCharge.end_date < cycleEnd
      ? recurringCharge.end_date
      : cycleEnd;

  const cycleDays =
    daysInclusive(cycleStart, cycleEnd);

  const activeDays =
    effectiveStart <= effectiveEnd
      ? daysInclusive(effectiveStart, effectiveEnd)
      : 0;

  const isPartialCycle =
    activeDays > 0 &&
    activeDays < cycleDays;

  if (specialPrice) {
    return {
      amount:
        Number(specialPrice.special_amount) || 0,
      normalAmount,
      isProrated: false,
      activeDays,
      cycleDays,
      effectiveStart,
      effectiveEnd,
      hasSpecialOverride: true
    };
  }

  // 3. Full billing cycle = full package price,
  // regardless of whether that cycle has 28, 29, 30 or 31 days.
  if (!isPartialCycle) {
    return {
      amount:
        activeDays > 0
          ? normalAmount
          : 0,
      normalAmount,
      isProrated: false,
      activeDays,
      cycleDays,
      effectiveStart,
      effectiveEnd,
      hasSpecialOverride: false
    };
  }

  // 4. Partial billing cycle = monthly price / cycle days
  // × active days. Start and end dates are both chargeable.
  const proratedAmount =
    cycleDays > 0
      ? normalAmount / cycleDays * activeDays
      : 0;

  return {
    amount:
      Math.round(
        (proratedAmount + Number.EPSILON) * 100
      ) / 100,
    normalAmount,
    isProrated: true,
    activeDays,
    cycleDays,
    effectiveStart,
    effectiveEnd,
    hasSpecialOverride: false
  };
}

function getRecurringAmountForMonth(recurringCharge, billingMonth) {
  return getRecurringBillingDetails(
    recurringCharge,
    billingMonth
  ).amount;
}

function getRecurringChargeNote(recurringCharge, billingMonth) {
  const details =
    getRecurringBillingDetails(
      recurringCharge,
      billingMonth
    );

  if (details.hasSpecialOverride) {
    return 'Special Month';
  }

  if (details.isProrated) {
    return `Prorated ${details.activeDays}/${details.cycleDays} days`;
  }

  return '';
}

function getRecurringProrateTooltip(recurringCharge, billingMonth) {
  const details =
    getRecurringBillingDetails(
      recurringCharge,
      billingMonth
    );

  if (details.hasSpecialOverride) {
    return `Special Month override: ${money(details.amount)}`;
  }

  if (!details.isProrated) {
    return '';
  }

  const dailyRate =
    details.cycleDays > 0
      ? details.normalAmount / details.cycleDays
      : 0;

  return `${money(details.normalAmount)} ÷ ${details.cycleDays} days × ${details.activeDays} active days = ${money(details.amount)} (daily rate ${money(dailyRate)})`;
}


function pdfNumericValue(value) {
  if (value == null) return 0;
  const cleaned = String(value)
    .replace(/RM\s*/gi, '')
    .replace(/,/g, '')
    .replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function getRecurringFinanceNote(recurringCharge, billingMonth) {
  const details =
    getRecurringBillingDetails(
      recurringCharge,
      billingMonth
    );

  if (details.hasSpecialOverride) {
    return `Special Month: ${money(details.amount)}`;
  }

  if (!details.isProrated) {
    return '';
  }

  return `Prorated: ${money(details.normalAmount)} ÷ ${details.cycleDays} × ${details.activeDays} days`;
}

function renderMonthlyRecurringDisplay() {
  const display = $('monthlyRecurringDisplay');

  if (!display) return;

  const billingMonth =
    $('monthPicker').value || todayMonth();

  if (!recurring.length) {
    display.innerHTML = '';
    return;
  }

  const [year, monthNum] =
    billingMonth.split('-');

  const monthText =
    new Date(
      Number(year),
      Number(monthNum) - 1,
      1
    ).toLocaleDateString(
      'en-MY',
      {
        month: 'short',
        year: 'numeric'
      }
    );

  let recurringTotal = 0;

  const rows = recurring
    .map(r => {

      const details =
        getRecurringBillingDetails(
          r,
          billingMonth
        );

      const amount =
        Number(details.amount) || 0;

      recurringTotal += amount;

      return `
        <tr>
          <td>${esc(r.items?.name || 'Recurring charge')}</td>
          <td>${esc(r.items?.unit || 'Monthly')}</td>
          <td>${monthText}</td>
          <td
            class="total-col"
            ${getRecurringProrateTooltip(r, billingMonth) ? `title="${esc(getRecurringProrateTooltip(r, billingMonth))}"` : ''}
          >
            ${money(amount)}
            ${
              details.isProrated
                ? `<span class="recurring-prorate-note">${details.activeDays} / ${details.cycleDays} days</span>`
                : details.hasSpecialOverride
                  ? '<span class="recurring-prorate-note">Special Month</span>'
                  : ''
            }
          </td>
        </tr>
      `;
    })
    .join('');

  display.innerHTML = `
    <div style="
      margin-top:18px;
      padding-top:16px;
      border-top:1px solid var(--border);
    ">
      <div class="table-head">
        <h3>Recurring Monthly Charges</h3>
        <small>
          Actual recurring charges applied for ${monthText}
        </small>
      </div>

      <div class="scroll">
        <table class="calendar">
          <thead>
            <tr>
              <th>Item</th>
              <th>Unit</th>
              <th>Billing Month</th>
              <th class="total-col">Amount</th>
            </tr>
          </thead>

          <tbody>
            ${rows}

            <tr>
              <td colspan="3">
                <strong>Recurring Packages Total</strong>
              </td>
              <td class="total-col">
                <strong>${money(recurringTotal)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function updateSummary() {
  let usage = 0;
  let count = 0;

  for (const e of entries) {
    usage +=
      Number(e.quantity) *
      Number(e.unit_price);

    if (Number(e.quantity) > 0) {
      count++;
    }
  }

  const billingMonth =
    $('monthPicker')?.value || todayMonth();

  const rec = recurring.reduce(
    (sum, recurringCharge) =>
      sum +
      getRecurringAmountForMonth(
        recurringCharge,
        billingMonth
      ),
    0
  );

  $('usageTotal').textContent =
    money(usage);

  $('recurringTotal').textContent =
    money(rec);

  $('grandTotal').textContent =
    money(usage + rec);

  $('entryCount').textContent =
    count + recurring.length;
}

 $('addRecurringBtn').onclick = async () => {
  const resident_id = $('recResident').value;
  const item_id = $('recItem').value;
  const amount = Number($('recAmount').value);
  const start_date = $('recStart').value;
  const end_date = $('recEnd').value || null;

  if (!resident_id || !item_id || !amount || !start_date) {
    return toast('Complete all monthly charge fields');
  }

  if (end_date && end_date < start_date) {
    return toast('End Date cannot be earlier than Start Date');
  }

  const { error } = await sb
    .from('recurring_charges')
    .insert({
      resident_id,
      item_id,
      amount,
      start_date,
      end_date,
      active: true,
      created_by: currentUser.id,
      branch_id: currentBranchId
    });

  if (error) {
    return toast(error.message);
  }

  toast('Monthly charge added');

  await loadRecurring();

  if ($('residentSelect').value === resident_id) {
    await loadMonth();
  }
};
async function loadRecurring() {
  const { data, error } = await sb
    .from('recurring_charges')
    .select('*, residents(name), items(name,unit)')
    .eq('branch_id', currentBranchId)
    .order('created_at', { ascending: false });

  if (error) {
    toast(error.message);
    return;
  }

const selectedResidentId = $('recResident').value;
const selectedItemId = $('recItem').value;

const list = (data || []).filter(x =>
  (
    !selectedResidentId ||
    x.resident_id === selectedResidentId
  ) &&
  (
    !selectedItemId ||
    x.item_id === selectedItemId
  )
);

  $('recurringList').innerHTML = list.length
    ? list
        .map(
          x => `
            <div class="row">
              <div>
                <strong>${esc(x.residents?.name || '')}</strong><br>
                <small>
                  ${esc(x.items?.name || '')}
                  · ${money(x.amount)} / month
                  · from ${x.start_date}
                  ${x.end_date ? ' to ' + x.end_date : ''}
                </small>
              </div>

<div style="display:flex; align-items:center; gap:8px; flex-wrap:nowrap;">
  <span class="badge">
    ${x.active ? 'ACTIVE' : 'STOPPED'}
  </span>

  ${
    x.active
      ? `
        <button
          class="btn btn-light admin-only"
          onclick="editRecurringPrice('${x.id}')"
        >
          Edit Price
        </button>

        <button
          class="btn btn-light admin-only"
          onclick="setRecurringSpecialMonth('${x.id}')"
        >
          Special Month
        </button>

        <button
          class="btn btn-danger"
          onclick="stopRecurring('${x.id}')"
        >
          Stop
        </button>
      `
      : ''
  }
</div>

            </div>
          `
        )
        .join('')
    : `
        <div class="row">
          <div>
            <small>
              ${
                selectedResidentId || selectedItemId
                  ? 'No matching recurring charges for the selected filter.'
                  : 'No recurring charges yet.'
              }
            </small>
          </div>
        </div>
      `;
}
window.editRecurringPrice = async id => {
  if (currentUserRole !== 'admin' && currentUserRole !== 'super_admin') {
    toast('Admin access only');
    return;
  }

  const { data: recurringCharge, error } = await sb
    .from('recurring_charges')
    .select('id, amount, resident_id, item_id, residents(name), items(name)')
    .eq('id', id)
    .single();

  if (error) {
    toast(error.message);
    return;
  }

  const billingMonth =
    $('monthPicker')?.value || todayMonth();

  const newAmountText = await appPrompt(
    `Permanent price change\n\n` +
    `Resident: ${recurringCharge.residents?.name || ''}\n` +
    `Package: ${recurringCharge.items?.name || ''}\n` +
    `Current amount: ${money(recurringCharge.amount)}\n\n` +
    `Enter the new permanent monthly amount (RM):`,
    Number(recurringCharge.amount).toFixed(2)
  );

  if (newAmountText === null) {
    return;
  }

  const newAmount = Number(newAmountText);

  if (
    !Number.isFinite(newAmount) ||
    newAmount < 0
  ) {
    toast('Enter a valid amount');
    return;
  }

  const effectiveMonth = await appPrompt(
    'Effective billing cycle (YYYY-MM):',
    billingMonth
  );

  if (effectiveMonth === null) {
    return;
  }

  if (!/^\d{4}-\d{2}$/.test(effectiveMonth)) {
    toast('Use billing cycle format YYYY-MM');
    return;
  }

  const reason = await appPrompt(
    'Reason for permanent price change:',
    ''
  );

  if (reason === null) {
    return;
  }

  const { error: saveError } = await sb
    .from('recurring_charge_price_history')
    .upsert(
      {
        recurring_charge_id: id,
        amount: newAmount,
        effective_billing_month: effectiveMonth,
        reason: reason.trim() || null,
        created_by: currentUser.id,
        branch_id: currentBranchId
      },
      {
        onConflict:
          'recurring_charge_id,effective_billing_month'
      }
    );

  if (saveError) {
    toast(saveError.message);
    return;
  }

  toast('Permanent price saved');

  await loadRecurringPricingData();
  await loadRecurring();
  await loadMonth();
};

window.setRecurringSpecialMonth = async id => {
  if (currentUserRole !== 'admin' && currentUserRole !== 'super_admin') {
    toast('Admin access only');
    return;
  }

  const { data: recurringCharge, error } = await sb
    .from('recurring_charges')
    .select('id, amount, resident_id, item_id, residents(name), items(name)')
    .eq('id', id)
    .single();

  if (error) {
    toast(error.message);
    return;
  }

  const billingMonth =
    $('monthPicker')?.value || todayMonth();

  const specialMonth = await appPrompt(
    'Special billing cycle (YYYY-MM):',
    billingMonth
  );

  if (specialMonth === null) {
    return;
  }

  if (!/^\d{4}-\d{2}$/.test(specialMonth)) {
    toast('Use billing cycle format YYYY-MM');
    return;
  }

  const specialAmountText = await appPrompt(
    `Special month price\n\n` +
    `Resident: ${recurringCharge.residents?.name || ''}\n` +
    `Package: ${recurringCharge.items?.name || ''}\n` +
    `Normal amount: ${money(recurringCharge.amount)}\n\n` +
    `Enter special amount for ${specialMonth}:`,
    Number(recurringCharge.amount).toFixed(2)
  );

  if (specialAmountText === null) {
    return;
  }

  const specialAmount = Number(specialAmountText);

  if (
    !Number.isFinite(specialAmount) ||
    specialAmount < 0
  ) {
    toast('Enter a valid amount');
    return;
  }

  const reason = await appPrompt(
    'Reason for special month price:',
    ''
  );

  if (reason === null) {
    return;
  }

  const { error: saveError } = await sb
    .from('recurring_charge_overrides')
    .upsert(
      {
        recurring_charge_id: id,
        billing_month: specialMonth,
        special_amount: specialAmount,
        reason: reason.trim() || null,
        created_by: currentUser.id,
        branch_id: currentBranchId
      },
      {
        onConflict:
          'recurring_charge_id,billing_month'
      }
    );

  if (saveError) {
    toast(saveError.message);
    return;
  }

  toast('Special month price saved');

  await loadRecurringPricingData();
  await loadRecurring();
  await loadMonth();
};



window.stopRecurring = async id => {

  // First get the recurring charge
  const { data, error: fetchError } = await sb
    .from('recurring_charges')
    .select('start_date')
    .eq('id', id)
    .single();

  if (fetchError) {
    return toast(fetchError.message);
  }

  const today = new Date().toISOString().slice(0, 10);

const enteredDate = await appPrompt(
  'Enter the last charge date (YYYY-MM-DD):',
  today
);

// Cancel was clicked
if (enteredDate === null) {
  return;
}

const endDate = enteredDate.trim();

// Check date format
if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
  return toast(
    'Please enter the stop date as YYYY-MM-DD.'
  );
}

// Stop date cannot be earlier than package start date
if (endDate < data.start_date) {
  return toast(
    `Stop date cannot be before the start date (${data.start_date}).`
  );
}

  const { error } = await sb
    .from('recurring_charges')
    .update({
      active: false,
      end_date: endDate
    })
    .eq('id', id);

  if (error) {
    return toast(error.message);
  }

  toast('Recurring charge stopped');

  await loadRecurring();
  await loadMonth();
};$('addResidentBtn').onclick=async()=>{const name=$('newResidentName').value.trim(),room_ref=$('newResidentRoom').value.trim();if(!name)return toast('Enter resident name');if(!currentBranchId)return toast('No active branch selected');const {error}=await sb.from('residents').insert({name,room_ref,active:true,branch_id:currentBranchId});if(error)return toast(error.message);$('newResidentName').value='';$('newResidentRoom').value='';await loadResidents();renderSelectors();renderResidentList();toast('Resident added')};

async function loadRecurringPricingData() {
  const overrideResult = await sb
    .from('recurring_charge_overrides')
    .select('*');

  const priceHistoryResult = await sb
    .from('recurring_charge_price_history')
    .select('*');

  if (overrideResult.error) {
    console.error(
      'Could not load recurring overrides:',
      overrideResult.error
    );
    recurringOverrides = [];
  } else {
    recurringOverrides = overrideResult.data || [];
  }

  if (priceHistoryResult.error) {
    console.error(
      'Could not load recurring price history:',
      priceHistoryResult.error
    );
    recurringPriceHistory = [];
  } else {
    recurringPriceHistory =
      priceHistoryResult.data || [];
  }
}
function renderResidentList(){
  const list=$('residentList');
  if(!list)return;
  if($('residentCount')) $('residentCount').textContent=String(residents.length);
  list.innerHTML=residents.length?residents.map(r=>`
    <div class="row" data-resident-search="${esc(((r.name||'')+' '+(r.room_ref||'')).toLowerCase())}">
      <div class="entity-main"><div class="entity-title">${esc(r.name)}</div><div class="entity-sub">${esc(r.room_ref||'No room reference')}</div></div>
      <span class="badge status-badge-success">ACTIVE</span>
      <div class="entity-actions"><button class="btn btn-danger btn-compact" onclick="deactivateResident('${r.id}')">Deactivate</button></div>
    </div>`).join(''):'<div class="row polished-empty"><div><div class="empty-icon">♙</div><div class="empty-title">No residents yet</div><div class="empty-copy">Add your first resident to start recording monthly charges.</div></div></div>';
  applyResidentListSearch();
}
function applyResidentListSearch(){
  const q=($('residentListSearch')?.value||'').trim().toLowerCase();
  document.querySelectorAll('#residentList [data-resident-search]').forEach(row=>{
    row.classList.toggle('entity-row-hidden',!!q && !row.dataset.residentSearch.includes(q));
  });
}

window.deactivateResident=async id=>{if(!await appConfirm('Deactivate resident?\n\nExisting billing records will remain.', {danger:true, confirmText:'Deactivate'}))return;const {error}=await sb.from('residents').update({active:false}).eq('id',id);if(error)return toast(error.message);await loadResidents();renderSelectors();renderResidentList();toast('Resident deactivated')};
$('addItemBtn').onclick=async()=>{const name=$('newItemName').value.trim(),unit=$('newItemUnit').value.trim(),price=$('newItemPrice').value===''?null:Number($('newItemPrice').value),category=$('newItemCategory').value;if(!name)return toast('Enter item name');if(!currentBranchId)return toast('No active branch selected');if(editingItemId){const {error}=await sb.from('items').update({name,unit,price,category}).eq('id',editingItemId);if(error)return toast(error.message);toast('Item updated');cancelEditItem()}else{const {error}=await sb.from('items').insert({name,unit,price,category,active:true,sort_order:999,branch_id:currentBranchId});if(error)return toast(error.message);toast('Item added');$('newItemName').value='';$('newItemUnit').value='';$('newItemPrice').value='';$('newItemCategory').selectedIndex=0}await loadItems();await loadAllItems();renderSelectors();renderCalendar()};
$('cancelEditItemBtn').onclick=cancelEditItem;
function cancelEditItem(){editingItemId=null;$('newItemName').value='';$('newItemUnit').value='';$('newItemPrice').value='';$('newItemCategory').selectedIndex=0;$('itemFormTitle').textContent='Add Item';$('addItemBtn').textContent='Add Item';$('cancelEditItemBtn').classList.add('hidden')}
window.editItem=id=>{const it=allItems.find(i=>i.id===id);if(!it)return;editingItemId=id;$('newItemName').value=it.name||'';$('newItemUnit').value=it.unit||'';$('newItemPrice').value=it.price??'';$('newItemCategory').value=it.category||'Stock';$('itemFormTitle').textContent='Edit Item';$('addItemBtn').textContent='Save Changes';$('cancelEditItemBtn').classList.remove('hidden');$('newItemName').scrollIntoView({behavior:'smooth',block:'center'})};
window.deactivateItem=async id=>{if(!await appConfirm('Deactivate item?\n\nIt will disappear from new entries, while existing charge records remain untouched.', {danger:true, confirmText:'Deactivate'}))return;const {error}=await sb.from('items').update({active:false}).eq('id',id);if(error)return toast(error.message);await loadItems();await loadAllItems();renderSelectors();renderCalendar();toast('Item deactivated')};
window.reactivateItem=async id=>{const {error}=await sb.from('items').update({active:true}).eq('id',id);if(error)return toast(error.message);await loadItems();await loadAllItems();renderSelectors();renderCalendar();toast('Item reactivated')};
function renderItemList(){
  const list=$('itemList');
  if(!list)return;
  if($('itemCount')) $('itemCount').textContent=String(allItems.length);
  list.innerHTML=allItems.length?allItems.map(i=>`
    <div class="row" data-item-list-search="${esc(((i.name||'')+' '+(i.category||'')+' '+(i.unit||'')).toLowerCase())}">
      <div class="entity-main"><div class="entity-title">${esc(i.name)}</div><div class="entity-sub">${esc(i.category||'')} · ${esc(i.unit||'—')} · RM ${Number(i.price||0).toFixed(2)}</div></div>
      <span class="badge ${i.active?'status-badge-success':'status-badge-danger'}">${i.active?'ACTIVE':'INACTIVE'}</span>
      <div class="entity-actions">
        <button class="btn btn-subtle btn-compact" onclick="editItem('${i.id}')">Edit</button>
        ${i.active?`<button class="btn btn-danger btn-compact" onclick="deactivateItem('${i.id}')">Deactivate</button>`:`<button class="btn btn-primary btn-compact" onclick="reactivateItem('${i.id}')">Reactivate</button>`}
      </div>
    </div>`).join(''):'<div class="row polished-empty"><div><div class="empty-icon">＋</div><div class="empty-title">No items yet</div><div class="empty-copy">Add a charge item to build your branch catalogue.</div></div></div>';
  applyItemListSearch();
}
function applyItemListSearch(){
  const q=($('itemListSearch')?.value||'').trim().toLowerCase();
  document.querySelectorAll('#itemList [data-item-list-search]').forEach(row=>{
    row.classList.toggle('entity-row-hidden',!!q && !row.dataset.itemListSearch.includes(q));
  });
}




const dailyItemSearchEl = $('dailyItemSearch');

if(dailyItemSearchEl){
  dailyItemSearchEl.addEventListener('input', () => {
    dailyItemSearchText = dailyItemSearchEl.value || '';
    applyDailyEntrySearch();
  });
}

$('dailySearchClearBtn')?.addEventListener('click', () => {
  dailyItemSearchText = '';
  if(dailyItemSearchEl){
    dailyItemSearchEl.value = '';
    dailyItemSearchEl.focus();
  }
  applyDailyEntrySearch();
});

window.jumpToDailyItem = jumpToDailyItem;

const calendarItemSearchEl = $('calendarItemSearch');

if (calendarItemSearchEl) {
  calendarItemSearchEl.addEventListener('input', () => {
    calendarItemSearchText = calendarItemSearchEl.value || '';
    applyCalendarViewFilters();
  });
}

$('calendarSearchClearBtn')?.addEventListener('click', () => {
  calendarItemSearchText = '';

  if (calendarItemSearchEl) {
    calendarItemSearchEl.value = '';
    calendarItemSearchEl.focus();
  }

  applyCalendarViewFilters();
});

$('calendarExpandAllBtn')?.addEventListener(
  'click',
  expandAllCalendarCategories
);

$('calendarCollapseAllBtn')?.addEventListener(
  'click',
  collapseAllCalendarCategories
);

$('exportBtn').onclick = () => {

  const rid = $('residentSelect').value;
  const month = $('monthPicker').value;

  if (!rid) {
    return toast('Select a resident first');
  }

  const resident =
    residents.find(r => r.id === rid);

  const cycle = getBillingCycle(month);
  const billingDates = getBillingDates(month);

  const periodText =
    `${formatShortDate(cycle.startDate)} - ` +
    `${formatShortDate(cycle.endDate)}`;

  const aoa = [

    [`MG Bayan Lepas — ${getActiveBranchExportLabel()}`],

    ['Resident', resident.name],

    [
      'Room / Ref',
      resident.room_ref || ''
    ],

    [
      'Billing Cycle',
      month
    ],

    [
      'Period',
      periodText
    ],

    [],

    [
      'Item',
      'Unit',
      'Price',
      ...billingDates.map(d => d.day),
      'Total'
    ]
  ];

  for (const [cat, list] of groupItems()) {

    aoa.push([cat]);

    for (const it of list) {

      let total = 0;

      const row = [
        it.name,
        it.unit || '',
        it.price ?? ''
      ];

      for (const d of billingDates) {

        const e = entries.find(
          x =>
            x.item_id === it.id &&
            x.charge_date === d.date
        );

        const q =
          e ?
          Number(e.quantity) :
          0;

        row.push(q || '');

        total +=
          q *
          Number(
            e?.unit_price ??
            it.price ??
            0
          );
      }

      row.push(total);

      aoa.push(row);
    }
  }

  aoa.push([]);

  aoa.push([
    'RECURRING MONTHLY CHARGES'
  ]);

  for (const r of recurring) {

  const recurringAmount =
    getRecurringAmountForMonth(r, month);

  const recurringNote =
    getRecurringChargeNote(r, month);

  aoa.push([
    recurringNote
      ? `${r.items?.name || 'Recurring charge'} — ${recurringNote}`
      : (r.items?.name || 'Recurring charge'),
    r.items?.unit || 'monthly',
    recurringAmount,
    ...Array(billingDates.length).fill(''),
    recurringAmount
  ]);
}

  const usage =
    entries.reduce(
      (s, e) =>
        s +
        Number(e.quantity) *
        Number(e.unit_price),
      0
    );

  const rec =
  recurring.reduce(
    (s, r) =>
      s + Number(
        getRecurringAmountForMonth(r, month)
      ),
    0
  );

  aoa.push([]);

  aoa.push([
    'GRAND TOTAL',
    ...Array(billingDates.length + 2).fill(''),
    usage + rec
  ]);

  const ws =
    XLSX.utils.aoa_to_sheet(aoa);

  const lastColIndex = billingDates.length + 3;
  const tableHeaderRow = 6; // zero-based; Excel row 7

  ws['!cols'] = [
    { wch: 36 },
    { wch: 12 },
    { wch: 14 },
    ...Array.from({ length: billingDates.length }, () => ({ wch: 5 })),
    { wch: 16 }
  ];

  ws['!rows'] = aoa.map((row, idx) => {
    if (idx === 0) return { hpt: 26 };
    if (idx === tableHeaderRow) return { hpt: 24 };
    if (!row || row.length === 0 || row.every(v => v === '' || v == null)) return { hpt: 8 };
    return { hpt: 20 };
  });

  // Freeze top information/header area and Item / Unit / Price columns.
  ws['!freeze'] = {
    xSplit: 3,
    ySplit: 7,
    topLeftCell: 'D8',
    activePane: 'bottomRight',
    state: 'frozen'
  };

  const border = {
    top: { style: 'thin', color: { rgb: 'D9E2E1' } },
    bottom: { style: 'thin', color: { rgb: 'D9E2E1' } },
    left: { style: 'thin', color: { rgb: 'D9E2E1' } },
    right: { style: 'thin', color: { rgb: 'D9E2E1' } }
  };

  const titleStyle = {
    font: { bold: true, sz: 16, color: { rgb: '1F5A4B' } },
    alignment: { horizontal: 'left', vertical: 'center' }
  };

  const infoLabelStyle = {
    font: { bold: true, color: { rgb: '355B52' } },
    fill: { fgColor: { rgb: 'EEF5F3' } },
    alignment: { vertical: 'center' },
    border
  };

  const infoValueStyle = {
    alignment: { vertical: 'center' },
    border
  };

  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '2E6A5B' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border
  };

  const categoryStyle = {
    font: { bold: true, color: { rgb: '244D43' } },
    fill: { fgColor: { rgb: 'DDEDE8' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border
  };

  const recurringHeaderStyle = {
    font: { bold: true, color: { rgb: '244D43' } },
    fill: { fgColor: { rgb: 'E1EEEB' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border
  };

  const grandTotalStyle = {
    font: { bold: true, sz: 11, color: { rgb: '173F35' } },
    fill: { fgColor: { rgb: 'D6EAE4' } },
    alignment: { vertical: 'center' },
    border
  };

  const bandFillA = 'FFFFFF';
  const bandFillB = 'F6FAF9';
  let dataBandIndex = 0;

  function getExportCell(r, c) {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (!ws[addr]) ws[addr] = { t: 's', v: '' };
    return ws[addr];
  }

  function styleExportRow(r, style) {
    for (let c = 0; c <= lastColIndex; c++) {
      getExportCell(r, c).s = style;
    }
  }

  // Workbook title
  getExportCell(0, 0).s = titleStyle;
  ws['!merges'] = ws['!merges'] || [];
  ws['!merges'].push({
    s: { r: 0, c: 0 },
    e: { r: 0, c: lastColIndex }
  });

  // Resident information
  for (let r = 1; r <= 4; r++) {
    getExportCell(r, 0).s = infoLabelStyle;
    getExportCell(r, 1).s = infoValueStyle;
  }

  // Table header
  for (let c = 0; c <= lastColIndex; c++) {
    getExportCell(tableHeaderRow, c).s = headerStyle;
  }
  getExportCell(tableHeaderRow, 0).s = {
    ...headerStyle,
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true }
  };

  // Body, category bands and recurring rows
  for (let r = tableHeaderRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const first = row[0];
    const isBlank = row.length === 0 || row.every(v => v === '' || v == null);
    const isRecurringHeader = first === 'RECURRING MONTHLY CHARGES';
    const isGrandTotal = first === 'GRAND TOTAL';
    const isSectionHeader =
      !isBlank &&
      !isRecurringHeader &&
      !isGrandTotal &&
      row.slice(1).every(v => v === '' || v == null);

    if (isBlank) continue;

    if (isRecurringHeader || isSectionHeader) {
      styleExportRow(r, isRecurringHeader ? recurringHeaderStyle : categoryStyle);
      ws['!merges'].push({
        s: { r, c: 0 },
        e: { r, c: lastColIndex }
      });
      dataBandIndex = 0;
      continue;
    }

    if (isGrandTotal) {
      styleExportRow(r, grandTotalStyle);
      const totalCell = getExportCell(r, lastColIndex);
      totalCell.z = '"RM" #,##0.00';
      totalCell.s = {
        ...grandTotalStyle,
        alignment: { horizontal: 'right', vertical: 'center' }
      };
      continue;
    }

    const fillRgb = dataBandIndex % 2 === 0 ? bandFillA : bandFillB;
    dataBandIndex++;

    for (let c = 0; c <= lastColIndex; c++) {
      const cell = getExportCell(r, c);

      cell.s = {
        font: { color: { rgb: '24332F' } },
        fill: { fgColor: { rgb: fillRgb } },
        alignment: {
          horizontal:
            c === 0 ? 'left' :
            (c === 1 || (c >= 3 && c < lastColIndex)) ? 'center' :
            'right',
          vertical: 'center',
          wrapText: c === 0
        },
        border
      };

      if (c === 2 || c === lastColIndex) {
        cell.z = '"RM" #,##0.00';
      }
    }
  }

  // Emphasize Total column
  for (let r = tableHeaderRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const first = row[0];
    const isBlank = row.length === 0 || row.every(v => v === '' || v == null);
    const isSection =
      !isBlank &&
      first !== 'GRAND TOTAL' &&
      row.slice(1).every(v => v === '' || v == null);

    if (!isBlank && !isSection && first !== 'GRAND TOTAL') {
      const cell = getExportCell(r, lastColIndex);
      const totalAmount = Number(cell.v) || 0;
      cell.s = {
        ...cell.s,
        font: { bold: totalAmount !== 0, color: { rgb: '244D43' } },
        fill: { fgColor: { rgb: 'EEF5F3' } },
        alignment: { horizontal: 'right', vertical: 'center' },
        border
      };
      cell.z = '"RM" #,##0.00';
    }
  }

  // Make actual daily charge quantities bold; blank/zero entries stay normal.
  for (let r = tableHeaderRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const first = row[0];
    const isBlank = row.length === 0 || row.every(v => v === '' || v == null);
    const isSection =
      !isBlank &&
      first !== 'GRAND TOTAL' &&
      row.slice(1).every(v => v === '' || v == null);

    if (isBlank || isSection || first === 'GRAND TOTAL') continue;

    for (let c = 3; c < lastColIndex; c++) {
      const cell = getExportCell(r, c);
      const qty = Number(cell.v) || 0;

      if (qty !== 0) {
        cell.s = {
          ...cell.s,
          font: { ...(cell.s?.font || {}), bold: true, color: { rgb: '173F35' } },
          alignment: { horizontal: 'center', vertical: 'center' },
          border
        };
      }
    }
  }

  const wb =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    ws,
    'Monthly Charges'
  );

  XLSX.writeFile(
    wb,
    `${resident.name.replace(/[^a-z0-9]/gi, '_')}_${month}_charges.xlsx`
  );
};

$('exportPdfBtn').onclick = () => {

  const rid = $('residentSelect').value;
  const month = $('monthPicker').value;

  if (!rid) {
    return toast('Select a resident first');
  }

  if (!month) {
    return toast('Select a billing cycle first');
  }

  const resident = residents.find(r => r.id === rid);

  if (!resident) {
    return toast('Resident not found');
  }

  const cycle = getBillingCycle(month);
  const billingDates = getBillingDates(month);

  if (!cycle) {
    return toast('Invalid billing cycle');
  }

  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  const periodText =
    `${formatShortDate(cycle.startDate)} - ` +
    `${formatShortDate(cycle.endDate)}`;

  // -------------------------
  // HEADER
  // -------------------------

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);

  doc.text(
    'MG Bayan Lepas',
    10,
    10
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  doc.text(
    getActiveBranchExportLabel(),
    10,
    15
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);

  doc.text(
    'Monthly Charges',
    pageWidth - 10,
    10,
    { align: 'right' }
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  doc.text(
    `Resident: ${resident.name}`,
    10,
    22
  );

  doc.text(
    `Room / Ref: ${resident.room_ref || '-'}`,
    10,
    27
  );

  doc.text(
    `Billing Cycle: ${month}`,
    90,
    22
  );

  doc.text(
    `Period: ${periodText}`,
    90,
    27
  );

  // -------------------------
  // TABLE HEADER
  // -------------------------

  const headRow = [
    'Item',
    'Unit',
    'Price',
    ...billingDates.map(d => String(d.day)),
    'Total'
  ];

  const bodyRows = [];

  // -------------------------
  // NORMAL USAGE ITEMS
  // -------------------------

  for (const [cat, list] of groupItems()) {

    bodyRows.push([
      {
        content: cat,
        colSpan: billingDates.length + 4,
        styles: {
          fontStyle: 'bold',
          fillColor: [235, 243, 241]
        }
      }
    ]);

    for (const it of list) {

      let rowTotal = 0;

      const row = [
        it.name,
        it.unit || '',
        it.price == null
          ? ''
          : Number(it.price).toFixed(2)
      ];

      for (const d of billingDates) {

        const e = entries.find(
          x =>
            x.item_id === it.id &&
            x.charge_date === d.date
        );

        const qty = e
          ? Number(e.quantity)
          : 0;

        row.push(
          qty ? String(qty) : ''
        );

        rowTotal +=
          qty *
          Number(
            e?.unit_price ??
            it.price ??
            0
          );
      }

      row.push(
        rowTotal
          ? rowTotal.toFixed(2)
          : ''
      );

      bodyRows.push(row);
    }
  }

  // -------------------------
  // RECURRING CHARGES
  // -------------------------

  if (recurring.length) {

    bodyRows.push([
      {
        content: 'MONTHLY / RECURRING CHARGES',
        colSpan: billingDates.length + 4,
        styles: {
          fontStyle: 'bold',
          fillColor: [225, 238, 235]
        }
      }
      ]);

  for (const r of recurring) {

    const recurringAmount =
      getRecurringAmountForMonth(r, month);

    const recurringNote =
      getRecurringChargeNote(r, month);

    bodyRows.push([
      recurringNote
        ? `${r.items?.name || 'Recurring charge'}\n${recurringNote}`
        : (r.items?.name || 'Recurring charge'),
      r.items?.unit || 'monthly',
      Number(recurringAmount).toFixed(2),
      ...Array(billingDates.length).fill(''),
      Number(recurringAmount).toFixed(2)
    ]);
  }
  }

    // -------------------------
  // GRAND TOTAL
  // -------------------------

  const usageTotal = entries.reduce(
    (sum, e) =>
      sum +
      Number(e.quantity) *
      Number(e.unit_price),
    0
  );

const recurringTotal = recurring.reduce(
  (sum, r) =>
    sum + Number(
      getRecurringAmountForMonth(r, month)
    ),
  0
);

  const grandTotal =
    usageTotal + recurringTotal;

  // -------------------------
  // CREATE TABLE
  // -------------------------

  doc.autoTable({
    startY: 32,

    head: [headRow],

    body: bodyRows,

    theme: 'grid',

    styles: {
      font: 'helvetica',
      fontSize: 5,
      cellPadding: 0.8,
      halign: 'center',
      valign: 'middle',
      lineWidth: 0.1,
      overflow: 'linebreak'
    },

    headStyles: {
      fillColor: [46, 106, 91],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 5
    },

    alternateRowStyles: {
      fillColor: [247, 250, 249]
    },

    columnStyles: {
      0: {
        cellWidth: 31,
        halign: 'left'
      },

      1: {
        cellWidth: 10
      },

      2: {
        cellWidth: 11
      },

      [billingDates.length + 3]: {
        cellWidth: 14
      }
    },

    didParseCell: function(data) {

      // Make item names left aligned
      if (
        data.section === 'body' &&
        data.column.index === 0
      ) {
        data.cell.styles.halign = 'left';
      }

      if (data.section === 'body') {
        const lastCol = data.table.columns.length - 1;

        // Daily quantity columns: bold only when there is an actual entry.
        if (
          data.column.index >= 3 &&
          data.column.index < lastCol &&
          pdfNumericValue(data.cell.raw) !== 0
        ) {
          data.cell.styles.fontStyle = 'bold';
        }

        // Total column: bold only when amount is non-zero.
        if (
          data.column.index === lastCol &&
          pdfNumericValue(data.cell.raw) !== 0
        ) {
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },

    margin: {
      left: 6,
      right: 6
    }
  });

  // -------------------------
  // TOTAL
  // -------------------------

  let finalY = doc.lastAutoTable.finalY + 6;

  // If table is close to bottom,
  // create another page for total.
  if (finalY > 190) {

    doc.addPage();

    finalY = 15;
  }

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(11);

  doc.text(
    `Grand Total: RM ${grandTotal.toFixed(2)}`,
    pageWidth - 10,
    finalY,
    { align: 'right' }
  );

  doc.setFont(
    'helvetica',
    'normal'
  );

  doc.setFontSize(7);

  doc.text(
    `Usage Charges: RM ${usageTotal.toFixed(2)}`,
    pageWidth - 10,
    finalY + 5,
    { align: 'right' }
  );

  doc.text(
    `Recurring Charges: RM ${recurringTotal.toFixed(2)}`,
    pageWidth - 10,
    finalY + 10,
    { align: 'right' }
  );

  // -------------------------
  // FOOTER / PAGE NUMBERS
  // -------------------------

  const pages =
    doc.internal.getNumberOfPages();

  for (
    let i = 1;
    i <= pages;
    i++
  ) {

    doc.setPage(i);

    doc.setFontSize(6);
    doc.setTextColor(100);

    doc.text(
      `MG Bayan Lepas - Monthly Charges`,
      8,
      205
    );

    doc.text(
      `Page ${i} of ${pages}`,
      pageWidth - 8,
      205,
      { align: 'right' }
    );
  }

  // -------------------------
  // DOWNLOAD
  // -------------------------

  const safeName =
    resident.name
      .replace(/[^a-z0-9]/gi, '_');

  doc.save(
    `${safeName}_${month}_charges.pdf`
  );
};
// ==========================================
// FINANCE-FRIENDLY PDF
// ==========================================

$('exportFinancePdfBtn').onclick = () => {

  const rid = $('residentSelect').value;
  const month = $('monthPicker').value;

  if (!rid) {
    return toast('Select a resident first');
  }

  if (!month) {
    return toast('Select a billing cycle first');
  }

  const resident = residents.find(
    r => r.id === rid
  );

  if (!resident) {
    return toast('Resident not found');
  }

  const cycle = getBillingCycle(month);

  if (!cycle) {
    return toast('Invalid billing cycle');
  }

  const { jsPDF } = window.jspdf;

  // Finance version uses portrait A4
  // because it does not need 31 date columns.
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth =
    doc.internal.pageSize.getWidth();

  const periodText =
    `${formatShortDate(cycle.startDate)} - ` +
    `${formatShortDate(cycle.endDate)}`;

  // ==========================================
  // HEADER
  // ==========================================

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);

  doc.text(
    'MG Bayan Lepas',
    14,
    15
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  doc.text(
    getActiveBranchExportLabel(),
    14,
    21
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);

  doc.text(
    'Monthly Charges Summary',
    pageWidth - 14,
    15,
    {
      align: 'right'
    }
  );

  // ==========================================
  // RESIDENT INFORMATION
  // ==========================================

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  doc.text(
    `Resident: ${resident.name}`,
    14,
    32
  );

  doc.text(
    `Room / Ref: ${resident.room_ref || '-'}`,
    14,
    38
  );

  doc.text(
    `Billing Cycle: ${month}`,
    110,
    32
  );

  doc.text(
    `Period: ${periodText}`,
    110,
    38
  );

  // ==========================================
  // BUILD USAGE CHARGE LIST
  // ==========================================

  const usageRows = [];

  let usageTotal = 0;

  for (const e of entries) {

    const item = items.find(
      i => i.id === e.item_id
    );

    if (!item) {
      continue;
    }

    const qty =
      Number(e.quantity) || 0;

    if (qty <= 0) {
      continue;
    }

    const unitPrice =
      Number(e.unit_price) || 0;

    const amount =
      qty * unitPrice;

    usageTotal += amount;

    const chargeDate =
      new Date(
        e.charge_date + 'T00:00:00'
      );

    const displayDate =
      new Intl.DateTimeFormat(
        'en-MY',
        {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }
      ).format(chargeDate);

    usageRows.push([
      item.name,
      displayDate,
      qty,
      `RM ${unitPrice.toFixed(2)}`,
      `RM ${amount.toFixed(2)}`
    ]);
  }

  // Sort by date
  usageRows.sort((a, b) => {

    const da =
      new Date(a[1]);

    const db =
      new Date(b[1]);

    return da - db;
  });

  // ==========================================
  // USAGE CHARGES TABLE
  // ==========================================

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(10);

  doc.text(
    'Usage Charges',
    14,
    50
  );

  if (usageRows.length > 0) {

    doc.autoTable({

      startY: 54,

      head: [[
        'Item',
        'Date',
        'Qty',
        'Unit Price',
        'Amount'
      ]],

      body: usageRows,

      theme: 'grid',

      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 2,
        valign: 'middle'
      },

      headStyles: {
        fillColor: [46, 106, 91],
        textColor: [255, 255, 255],
        fontStyle: 'bold'
      },

      alternateRowStyles: {
        fillColor: [247, 250, 249]
      },

      columnStyles: {

        0: {
          cellWidth: 70
        },

        1: {
          cellWidth: 30,
          halign: 'center'
        },

        2: {
          cellWidth: 15,
          halign: 'center'
        },

        3: {
          cellWidth: 28,
          halign: 'right'
        },

        4: {
          cellWidth: 30,
          halign: 'right'
        }

      },

      didParseCell: function(data) {
        if (
          data.section === 'body' &&
          (data.column.index === 2 || data.column.index === 4) &&
          pdfNumericValue(data.cell.raw) !== 0
        ) {
          data.cell.styles.fontStyle = 'bold';
        }
      },

      margin: {
        left: 14,
        right: 14
      }

    });

  } else {

    doc.setFont(
      'helvetica',
      'normal'
    );

    doc.setFontSize(8);

    doc.text(
      'No usage charges recorded for this billing cycle.',
      14,
      58
    );
  }

  // ==========================================
  // DETERMINE NEXT POSITION
  // ==========================================

  let nextY;

  if (
    usageRows.length > 0 &&
    doc.lastAutoTable
  ) {

    nextY =
      doc.lastAutoTable.finalY + 10;

  } else {

    nextY = 68;
  }

  // ==========================================
  // RECURRING CHARGES
  // ==========================================

  const recurringRows = [];

  let recurringTotal = 0;

for (const r of recurring) {

  const amount =
    Number(
      getRecurringAmountForMonth(r, month)
    ) || 0;

  const recurringNote =
    getRecurringFinanceNote(r, month);

  recurringTotal += amount;

    recurringRows.push([

      recurringNote
        ? `${r.items?.name || 'Recurring charge'}\n${recurringNote}`
        : (r.items?.name || 'Recurring charge'),

      r.items?.unit ||
        'Monthly',

      `RM ${amount.toFixed(2)}`
    ]);
  }

  // Check if enough room remains
  if (nextY > 230) {

    doc.addPage();

    nextY = 20;
  }

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(10);

  doc.text(
    'Monthly / Recurring Charges',
    14,
    nextY
  );

  if (recurringRows.length > 0) {

    doc.autoTable({

      startY: nextY + 4,

      head: [[
        'Description',
        'Type',
        'Amount'
      ]],

      body: recurringRows,

      theme: 'grid',

      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 2
      },

      headStyles: {
        fillColor: [46, 106, 91],
        textColor: [255, 255, 255],
        fontStyle: 'bold'
      },

      alternateRowStyles: {
        fillColor: [247, 250, 249]
      },

      columnStyles: {

        0: {
          cellWidth: 105
        },

        1: {
          cellWidth: 35
        },

        2: {
          cellWidth: 35,
          halign: 'right'
        }

      },

      margin: {
        left: 14,
        right: 14
      }

    });

    nextY =
      doc.lastAutoTable.finalY + 10;

  } else {

    doc.setFont(
      'helvetica',
      'normal'
    );

    doc.setFontSize(8);

    doc.text(
      'No recurring charges for this billing cycle.',
      14,
      nextY + 6
    );

    nextY += 18;
  }

  // ==========================================
  // TOTALS
  // ==========================================

  const grandTotal =
    usageTotal +
    recurringTotal;

  if (nextY > 245) {

    doc.addPage();

    nextY = 25;
  }

  doc.setDrawColor(180);

  doc.line(
    110,
    nextY,
    pageWidth - 14,
    nextY
  );

  nextY += 7;

  doc.setFont(
    'helvetica',
    'normal'
  );

  doc.setFontSize(9);

  doc.text(
    'Usage Charges:',
    115,
    nextY
  );

  doc.text(
    `RM ${usageTotal.toFixed(2)}`,
    pageWidth - 14,
    nextY,
    {
      align: 'right'
    }
  );

  nextY += 6;

  doc.text(
    'Recurring Charges:',
    115,
    nextY
  );

  doc.text(
    `RM ${recurringTotal.toFixed(2)}`,
    pageWidth - 14,
    nextY,
    {
      align: 'right'
    }
  );

  nextY += 8;

  doc.setDrawColor(100);

  doc.line(
    110,
    nextY - 3,
    pageWidth - 14,
    nextY - 3
  );

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(12);

  doc.text(
    'GRAND TOTAL:',
    115,
    nextY + 3
  );

  doc.text(
    `RM ${grandTotal.toFixed(2)}`,
    pageWidth - 14,
    nextY + 3,
    {
      align: 'right'
    }
  );

  // ==========================================
  // FOOTER
  // ==========================================

  const pages =
    doc.internal.getNumberOfPages();

  for (
    let p = 1;
    p <= pages;
    p++
  ) {

    doc.setPage(p);

    const pageHeight =
      doc.internal.pageSize.getHeight();

    doc.setFont(
      'helvetica',
      'normal'
    );

    doc.setFontSize(7);

    doc.setTextColor(100);

    doc.text(
      'MG Bayan Lepas - Monthly Charges Summary',
      14,
      pageHeight - 10
    );

    doc.text(
      `Page ${p} of ${pages}`,
      pageWidth - 14,
      pageHeight - 10,
      {
        align: 'right'
      }
    );
  }

  // ==========================================
  // SAVE PDF
  // ==========================================

  const safeName =
    resident.name
      .replace(
        /[^a-z0-9]/gi,
        '_'
      );

  doc.save(
    `${safeName}_${month}_Finance_Summary.pdf`
  );
};
$('printBtn').onclick=()=>{if(!$('residentSelect').value)return toast('Select a resident first');window.print()};

// ==========================================
// BULK EXPORT — ALL RESIDENTS IN ONE PDF
// ==========================================
// These reuse the same layout as the single-resident
// "Export PDF" / "Finance PDF" buttons above, but loop
// through every active resident and place each one on
// their own page(s) inside a single combined PDF file.

async function fetchResidentMonthData(residentId, cycle) {
  const [e, r] = await Promise.all([
    sb
      .from('charge_entries')
      .select('*')
      .eq('resident_id', residentId)
      .gte('charge_date', cycle.start)
      .lte('charge_date', cycle.end),

    sb
      .from('recurring_charges')
      .select('*, items(name,unit)')
      .eq('resident_id', residentId)
      .lte('start_date', cycle.end)
      .or(`end_date.is.null,end_date.gte.${cycle.start}`)
  ]);

  if (e.error || r.error) {
    throw (e.error || r.error);
  }

  return {
    entriesForResident: e.data || [],
    recurringForResident: r.data || []
  };
}

// Calendar-style page for one resident (mirrors exportPdfBtn above)
function renderCalendarPdfPage(doc, resident, month, cycle, billingDates, periodText, entriesForResident, recurringForResident) {

  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('MG Bayan Lepas', 10, 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(getActiveBranchExportLabel(), 10, 15);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Monthly Charges', pageWidth - 10, 10, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Resident: ${resident.name}`, 10, 22);
  doc.text(`Room / Ref: ${resident.room_ref || '-'}`, 10, 27);
  doc.text(`Billing Cycle: ${month}`, 90, 22);
  doc.text(`Period: ${periodText}`, 90, 27);

  const headRow = [
    'Item', 'Unit', 'Price',
    ...billingDates.map(d => String(d.day)),
    'Total'
  ];

  const bodyRows = [];

  for (const [cat, list] of groupItems()) {

    bodyRows.push([{
      content: cat,
      colSpan: billingDates.length + 4,
      styles: { fontStyle: 'bold', fillColor: [235, 243, 241] }
    }]);

    for (const it of list) {

      let rowTotal = 0;

      const row = [
        it.name,
        it.unit || '',
        it.price == null ? '' : Number(it.price).toFixed(2)
      ];

      for (const d of billingDates) {

        const e = entriesForResident.find(
          x => x.item_id === it.id && x.charge_date === d.date
        );

        const qty = e ? Number(e.quantity) : 0;

        row.push(qty ? String(qty) : '');

        rowTotal += qty * Number(e?.unit_price ?? it.price ?? 0);
      }

      row.push(rowTotal ? rowTotal.toFixed(2) : '');

      bodyRows.push(row);
    }
  }

  if (recurringForResident.length) {

    bodyRows.push([{
      content: 'MONTHLY / RECURRING CHARGES',
      colSpan: billingDates.length + 4,
      styles: { fontStyle: 'bold', fillColor: [225, 238, 235] }
    }]);

    for (const r of recurringForResident) {

      const recurringAmount =
        getRecurringAmountForMonth(r, month);

      const recurringNote =
        getRecurringChargeNote(r, month);

      bodyRows.push([
        recurringNote
          ? `${r.items?.name || 'Recurring charge'}\n${recurringNote}`
          : (r.items?.name || 'Recurring charge'),
        r.items?.unit || 'monthly',
        Number(recurringAmount).toFixed(2),
        ...Array(billingDates.length).fill(''),
        Number(recurringAmount).toFixed(2)
      ]);
    }
  }

  const usageTotal = entriesForResident.reduce(
    (sum, e) => sum + Number(e.quantity) * Number(e.unit_price), 0
  );

  const recurringTotal = recurringForResident.reduce(
    (sum, r) => sum + Number(getRecurringAmountForMonth(r, month)), 0
  );

  const grandTotal = usageTotal + recurringTotal;

  doc.autoTable({
    startY: 32,
    head: [headRow],
    body: bodyRows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 5,
      cellPadding: 0.8,
      halign: 'center',
      valign: 'middle',
      lineWidth: 0.1,
      overflow: 'linebreak'
    },
    headStyles: {
      fillColor: [46, 106, 91],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 5
    },

    alternateRowStyles: {
      fillColor: [247, 250, 249]
    },
    columnStyles: {
      0: { cellWidth: 31, halign: 'left' },
      1: { cellWidth: 10 },
      2: { cellWidth: 11 },
      [billingDates.length + 3]: { cellWidth: 14 }
    },
    didParseCell: function(data) {
      if (data.section === 'body' && data.column.index === 0) {
        data.cell.styles.halign = 'left';
      }

      if (data.section === 'body') {
        const lastCol = data.table.columns.length - 1;

        if (
          data.column.index >= 3 &&
          data.column.index < lastCol &&
          pdfNumericValue(data.cell.raw) !== 0
        ) {
          data.cell.styles.fontStyle = 'bold';
        }

        if (
          data.column.index === lastCol &&
          pdfNumericValue(data.cell.raw) !== 0
        ) {
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
    margin: { left: 6, right: 6 }
  });

  let finalY = doc.lastAutoTable.finalY + 6;

  if (finalY > 190) {
    doc.addPage();
    finalY = 15;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Grand Total: RM ${grandTotal.toFixed(2)}`, pageWidth - 10, finalY, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`Usage Charges: RM ${usageTotal.toFixed(2)}`, pageWidth - 10, finalY + 5, { align: 'right' });
  doc.text(`Recurring Charges: RM ${recurringTotal.toFixed(2)}`, pageWidth - 10, finalY + 10, { align: 'right' });
}

// Finance-style page for one resident (mirrors exportFinancePdfBtn above)
function renderFinancePdfPage(doc, resident, month, cycle, periodText, entriesForResident, recurringForResident) {

  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('MG Bayan Lepas', 14, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(getActiveBranchExportLabel(), 14, 21);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Monthly Charges Summary', pageWidth - 14, 15, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Resident: ${resident.name}`, 14, 32);
  doc.text(`Room / Ref: ${resident.room_ref || '-'}`, 14, 38);
  doc.text(`Billing Cycle: ${month}`, 110, 32);
  doc.text(`Period: ${periodText}`, 110, 38);

  const usageRows = [];
  let usageTotal = 0;

  for (const e of entriesForResident) {

    const item = items.find(i => i.id === e.item_id);

    if (!item) continue;

    const qty = Number(e.quantity) || 0;

    if (qty <= 0) continue;

    const unitPrice = Number(e.unit_price) || 0;
    const amount = qty * unitPrice;

    usageTotal += amount;

    const chargeDate = new Date(e.charge_date + 'T00:00:00');

    const displayDate = new Intl.DateTimeFormat('en-MY', {
      day: '2-digit', month: 'short', year: 'numeric'
    }).format(chargeDate);

    usageRows.push([
      item.name,
      displayDate,
      qty,
      `RM ${unitPrice.toFixed(2)}`,
      `RM ${amount.toFixed(2)}`
    ]);
  }

  usageRows.sort((a, b) => new Date(a[1]) - new Date(b[1]));

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Usage Charges', 14, 50);

  if (usageRows.length > 0) {

    doc.autoTable({
      startY: 54,
      head: [['Item', 'Date', 'Qty', 'Unit Price', 'Amount']],
      body: usageRows,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, valign: 'middle' },
      headStyles: { fillColor: [46, 106, 91], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 250, 249] },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 30, halign: 'center' },
        2: { cellWidth: 15, halign: 'center' },
        3: { cellWidth: 28, halign: 'right' },
        4: { cellWidth: 30, halign: 'right' }
      },
      didParseCell: function(data) {
        if (
          data.section === 'body' &&
          (data.column.index === 2 || data.column.index === 4) &&
          pdfNumericValue(data.cell.raw) !== 0
        ) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: 14, right: 14 }
    });

  } else {

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('No usage charges recorded for this billing cycle.', 14, 58);
  }

  let nextY;

  if (usageRows.length > 0 && doc.lastAutoTable) {
    nextY = doc.lastAutoTable.finalY + 10;
  } else {
    nextY = 68;
  }

  const recurringRows = [];
  let recurringTotal = 0;

  for (const r of recurringForResident) {

    const amount =
      Number(
        getRecurringAmountForMonth(r, month)
      ) || 0;

    const recurringNote =
      getRecurringFinanceNote(r, month);

    recurringTotal += amount;

    recurringRows.push([
      recurringNote
        ? `${r.items?.name || 'Recurring charge'}\n${recurringNote}`
        : (r.items?.name || 'Recurring charge'),
      r.items?.unit || 'Monthly',
      `RM ${amount.toFixed(2)}`
    ]);
  }

  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Monthly / Recurring Charges', 14, nextY);

  if (recurringRows.length > 0) {

    doc.autoTable({
      startY: nextY + 4,
      head: [['Description', 'Type', 'Amount']],
      body: recurringRows,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [46, 106, 91], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 250, 249] },
      columnStyles: {
        0: { cellWidth: 105 },
        1: { cellWidth: 35 },
        2: { cellWidth: 35, halign: 'right' }
      },
      margin: { left: 14, right: 14 }
    });

    nextY = doc.lastAutoTable.finalY + 10;

  } else {

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('No recurring charges for this billing cycle.', 14, nextY + 6);

    nextY += 18;
  }

  const grandTotal = usageTotal + recurringTotal;

  if (nextY > 245) {
    doc.addPage();
    nextY = 25;
  }

  doc.setDrawColor(180);
  doc.line(110, nextY, pageWidth - 14, nextY);

  nextY += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Usage Charges:', 115, nextY);
  doc.text(`RM ${usageTotal.toFixed(2)}`, pageWidth - 14, nextY, { align: 'right' });

  nextY += 6;

  doc.text('Recurring Charges:', 115, nextY);
  doc.text(`RM ${recurringTotal.toFixed(2)}`, pageWidth - 14, nextY, { align: 'right' });

  nextY += 8;

  doc.setDrawColor(100);
  doc.line(110, nextY - 3, pageWidth - 14, nextY - 3);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('GRAND TOTAL:', 115, nextY + 3);
  doc.text(`RM ${grandTotal.toFixed(2)}`, pageWidth - 14, nextY + 3, { align: 'right' });
}

async function exportAllResidents(mode) {

  const month = $('monthPicker').value;

  if (!month) {
    return toast('Select a billing cycle first');
  }

  if (!residents.length) {
    return toast('No active residents found');
  }

  const cycle = getBillingCycle(month);

  if (!cycle) {
    return toast('Invalid billing cycle');
  }

  const btn = mode === 'calendar' ? $('exportAllPdfBtn') : $('exportAllFinancePdfBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generating…';
  toast(`Generating PDF for ${residents.length} resident(s)…`);

  try {

    // Make sure permanent price changes / one-off overrides
    // for recurring charges are up to date before totalling.
    await loadRecurringPricingData();

    const { jsPDF } = window.jspdf;
    const billingDates = getBillingDates(month);
    const periodText = `${formatShortDate(cycle.startDate)} - ${formatShortDate(cycle.endDate)}`;

    const doc = new jsPDF({
      orientation: mode === 'calendar' ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    let firstPage = true;
    let skipped = 0;

    for (const resident of residents) {

      let data;

      try {
        data = await fetchResidentMonthData(resident.id, cycle);
      } catch (err) {
        console.error(`Could not load data for ${resident.name}:`, err);
        skipped++;
        continue;
      }

      if (!firstPage) {
        doc.addPage();
      }
      firstPage = false;

      if (mode === 'calendar') {
        renderCalendarPdfPage(doc, resident, month, cycle, billingDates, periodText, data.entriesForResident, data.recurringForResident);
      } else {
        renderFinancePdfPage(doc, resident, month, cycle, periodText, data.entriesForResident, data.recurringForResident);
      }
    }

    // Footer / page numbers across the whole combined document
    const pages = doc.internal.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const footerLabel = mode === 'calendar' ? 'MG Bayan Lepas - Monthly Charges' : 'MG Bayan Lepas - Monthly Charges Summary';

    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(mode === 'calendar' ? 6 : 7);
      doc.setTextColor(100);

      if (mode === 'calendar') {
        doc.text(footerLabel, 8, 205);
        doc.text(`Page ${i} of ${pages}`, pageWidth - 8, 205, { align: 'right' });
      } else {
        doc.text(footerLabel, 14, pageHeight - 10);
        doc.text(`Page ${i} of ${pages}`, pageWidth - 14, pageHeight - 10, { align: 'right' });
      }
    }

    const safeMonth = month.replace(/[^a-z0-9]/gi, '_');

    doc.save(
      mode === 'calendar'
        ? `All_Residents_${safeMonth}_charges.pdf`
        : `All_Residents_${safeMonth}_Finance_Summary.pdf`
    );

    toast(
      skipped
        ? `Done, but skipped ${skipped} resident(s) due to errors (see console)`
        : 'PDF generated for all residents'
    );

  } catch (err) {
    console.error('Bulk export failed:', err);
    toast(err.message || 'Bulk export failed');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

$('exportAllPdfBtn').onclick = () => exportAllResidents('calendar');
$('exportAllFinancePdfBtn').onclick = () => exportAllResidents('finance');

// ==========================================
// BACKUP & RESTORE — LIVE DATABASE SNAPSHOTS
// ==========================================
// Snapshots (and restores) charge_entries, recurring_charges,
// recurring_charge_overrides and recurring_charge_price_history
// directly in Supabase, via the create_data_backup /
// restore_data_backup functions (see backup_restore_setup.sql —
// run once in the Supabase SQL editor). This is for undoing
// accidental changes to charges — it's not a downloadable file.

async function createBackup(label, { silent } = {}) {

  if (!silent) {
    toast('Creating backup…');
  }

  const { data, error } = await sb.rpc('create_data_backup', {
    backup_label: label || null,
    target_branch_id: currentBranchId
  });

  if (error) {
    console.error('Backup failed:', error);
    toast(error.message || 'Backup failed');
    return null;
  }

  if (!silent) {
    toast('Backup created');
  }

  return data; // new backup id
}

let backupsById = {};

async function loadBackupsList() {

  const list = $('backupsList');

  if (!list) return;

  list.innerHTML = '<div class="row"><small>Loading backups…</small></div>';

  const { data: backups, error } = await sb
    .from('data_backups')
    .select('id,label,created_at,created_by')
    .eq('branch_id', currentBranchId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Could not load backups:', error);
    list.innerHTML = `<div class="row"><small>Could not load backups: ${esc(error.message)}</small></div>`;
    return;
  }

  if (!backups || !backups.length) {
    list.innerHTML = '<div class="row"><small>No backups yet. Click "Create Backup Now" to make one.</small></div>';
    return;
  }

  const userIds = [...new Set(backups.map(b => b.created_by).filter(Boolean))];
  const profileById = {};

  if (userIds.length) {

    const { data: profileData, error: profileError } = await sb
      .from('profiles')
      .select('id,email,display_name')
      .in('id', userIds);

    if (profileError) {
      console.error('Could not load staff identities:', profileError);
    } else {
      (profileData || []).forEach(p => { profileById[p.id] = p; });
    }
  }

  list.innerHTML = backups.map(b => {

    backupsById[b.id] = b;

    const when = new Date(b.created_at).toLocaleString('en-MY', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const who = profileById[b.created_by] || null;

    return `
      <div class="row">
        <div>
          <strong>${esc(b.label)}</strong>
          <br>
          <small>${esc(when)}</small>
          <div style="margin-top:4px">${who ? renderUserIdentity(who.display_name, who.email, who.id) : '<small>Created by: Unknown user</small>'}</div>
        </div>
        <button class="btn btn-light" style="border:1px solid var(--border)" onclick="window.restoreBackupFlow('${b.id}')">Restore</button>
      </div>
    `;
  }).join('');
}

window.restoreBackupFlow = async function(backupId) {

  const backupLabel = backupsById[backupId]?.label || 'this backup';

  const confirmed = await appConfirm(
    `Restore backup: ${backupLabel}\n\n` +
    `This will REPLACE all current charge entries, monthly packages, ` +
    `overrides and price history with what they were at that backup. ` +
    `A safety backup of the CURRENT data will be created automatically ` +
    `first, so this can itself be undone.`,
    { danger:true, confirmText:'Restore Backup' }
  );

  if (!confirmed) return;

  setStatus('Restoring backup…');
  toast('Restoring backup — please wait…');

  const { error } = await sb.rpc('restore_data_backup', {
    target_backup_id: backupId
  });

  if (error) {
    console.error('Restore failed:', error);
    toast(error.message || 'Restore failed');
    setStatus('Restore failed', 'err');
    return;
  }

  toast('Backup restored');
  setStatus('Backup restored. Reloading data…', 'ok');

  // Refresh whatever is currently on screen so it reflects the restore
  await loadRecurringPricingData();

  if ($('residentSelect').value && $('monthPicker').value) {
    await loadMonth();
  }

  if ($('recurringTab') && !$('recurringTab').classList.contains('hidden')) {
    await loadRecurring();
  }

  await loadBackupsList();
};

$('createBackupBtn').onclick = async () => {

  const btn = $('createBackupBtn');
  const label = $('newBackupLabel').value.trim();
  const originalLabel = btn.textContent;

  btn.disabled = true;
  btn.textContent = 'Creating…';

  const id = await createBackup(label);

  btn.disabled = false;
  btn.textContent = originalLabel;

  if (id) {
    $('newBackupLabel').value = '';
    await loadBackupsList();
  }
};

$('backupDataBtn').onclick = async () => {

  const btn = $('backupDataBtn');
  const originalLabel = btn.textContent;

  btn.disabled = true;
  btn.textContent = 'Backing up…';

  await createBackup(null);

  btn.disabled = false;
  btn.textContent = originalLabel;

  if ($('backupsTab') && !$('backupsTab').classList.contains('hidden')) {
    await loadBackupsList();
  }
};

document
  .querySelectorAll('.tab')
  .forEach(b => {

    b.onclick = () => {

      const requestedTab =
        b.dataset.tab;

      // Staff cannot open Admin-only tabs
      if (
        currentUserRole !== 'admin' && currentUserRole !== 'super_admin' &&
        (
          requestedTab === 'recurring' ||
          requestedTab === 'setup' ||
          requestedTab === 'items' ||
          requestedTab === 'staff' ||
          requestedTab === 'branches' ||
          requestedTab === 'audit' ||
          requestedTab === 'loginActivity' ||
          requestedTab === 'backups'
        )
      ) {

        toast('Admin access required');
        return;
      }

      // Branches and Login Activity are super-admin only
      if (
        (requestedTab === 'branches' || requestedTab === 'loginActivity') &&
        currentUserRole !== 'super_admin'
      ) {
        toast('Super admin access required');
        return;
      }

      // Remove active state from all tabs
      document
        .querySelectorAll('.tab')
        .forEach(x =>
          x.classList.remove('active')
        );

      // Activate clicked tab
      b.classList.add('active');

      // Show selected section
      [
        'charges',
        'recurring',
        'setup',
        'items',
        'staff',
        'branches',
        'audit',
        'loginActivity',
        'backups',
        'settings'
      ].forEach(t => {

        const section =
          $(t + 'Tab');

        if (section) {
          section.classList.toggle(
            'hidden',
            t !== requestedTab
          );
        }

      });

      // Existing recurring-tab behavior
      if (
        requestedTab === 'recurring'
      ) {
        loadRecurring();
      }

      // Audit History behavior
      if (
        requestedTab === 'audit'
      ) {

        if (
          $('auditMonth') &&
          !$('auditMonth').value
        ) {
          $('auditMonth').value =
            $('monthPicker').value ||
            todayMonth();
        }

        loadAuditHistory();
      }

      // Login Activity behavior
      if (
        requestedTab === 'loginActivity'
      ) {
        loadLoginActivity();
      }

      // Backups behavior
      if (
        requestedTab === 'backups'
      ) {
        loadBackupsList();
      }

      // Staff management behavior
      if (
        requestedTab === 'staff'
      ) {
        loadStaffList();
      }

      // Settings behavior
      if (requestedTab === 'settings' && currentUser) {
        updateCurrentUserIdentityUI();
        $('settingsNewEmail').value = '';
        $('changeDisplayNameMsg').textContent = '';
        $('changeEmailMsg').textContent = '';
        $('changePasswordMsg').textContent = '';
      }

      // Items behavior
      if (requestedTab === 'items') {
        loadAllItems();
      }

    };

  });
  function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function fallbackDisplayName(email=''){
  const local = String(email || '').split('@')[0].replace(/[._-]+/g,' ').trim();
  return local
    ? local.replace(/\b\w/g, c => c.toUpperCase())
    : 'Unknown user';
}

function renderUserIdentity(displayName, email, userId='', {showId=false} = {}){
  const cleanEmail = String(email || '').trim();
  const cleanName = String(displayName || '').trim() || (cleanEmail ? fallbackDisplayName(cleanEmail) : 'Unknown user');
  const emailLine = cleanEmail
    ? `<a href="mailto:${esc(cleanEmail)}">${esc(cleanEmail)}</a>`
    : '<span style="font-size:11px;color:var(--muted)">No linked email</span>';
  const idLine = showId && userId
    ? `<span class="user-id">${esc(userId)}</span>`
    : '';

  return `<div class="user-identity"><strong>${esc(cleanName)}</strong>${emailLine}${idLine}</div>`;
}

function updateCurrentUserIdentityUI(){
  if(!currentUser) return;
  const name = currentUserDisplayName || fallbackDisplayName(currentUser.email || '');
  const chip = $('userEmail');
  if(chip){
    chip.innerHTML = `<strong>${esc(name)}</strong><small>${esc(currentUser.email || '')}</small>`;
    chip.title = currentUser.email || '';
  }
  if($('accountButtonName')) $('accountButtonName').textContent = name;
  if($('accountAvatar')) $('accountAvatar').textContent = initialsForName(name, currentUser.email || '');
  if($('settingsDisplayName')) $('settingsDisplayName').value = name;
  if($('settingsProfileEmail')) $('settingsProfileEmail').value = currentUser.email || '';
  if($('settingsCurrentEmail')) $('settingsCurrentEmail').value = currentUser.email || '';
  if(window.innerWidth<=850) syncMobileNav();
}

async function loadCurrentUserRole() {

  if (!currentUser) {
    currentUserRole = 'staff';
    return;
  }

  const { data, error } = await sb
    .from('profiles')
    .select('role, branch_id, display_name, email')
    .eq('id', currentUser.id)
    .single();

  if (error) {
    console.error('Could not load user role:', error);
    currentUserRole = 'staff';
    return;
  }

  currentUserRole = data?.role || 'staff';
  currentUserBranchId = data?.branch_id || null;
  currentUserDisplayName =
    (data?.display_name || '').trim() ||
    fallbackDisplayName(data?.email || currentUser?.email || '');

  updateCurrentUserIdentityUI();
  applyRoleAccess();
}
async function loadBranchContext() {
  const { data, error } = await sb.from('branches').select('*').order('name');
  if (error) { console.error('Could not load branches:', error); branches = []; }
  else branches = data || [];

  if (currentUserRole === 'super_admin') {
    const saved = localStorage.getItem('mgbl_active_branch');
    currentBranchId = branches.find(b => b.id === saved)?.id
      || branches[0]?.id
      || null;
  } else {
    currentBranchId = currentUserBranchId;
  }

  if (!currentBranchId) {
    console.error('No active branch resolved.', { role: currentUserRole, currentUserBranchId, branches });
  }

  renderBranchSwitcher();
  updateBranchChip();
}
function updateBranchChip() {
  const chip = $('activeBranchChip');
  const name = branches.find(b => b.id === currentBranchId)?.name;
  if (chip) {
    chip.textContent = name ? `Branch: ${name}` : 'No branch selected';
    chip.style.background = name ? 'rgba(255,255,255,.15)' : '#c0392b';
  }
  const subtitle = $('brandSubtitle');
  if (subtitle) subtitle.textContent = name ? `${name} · Mintygreen` : 'Mintygreen';
}
function getActiveBranchName(){
  return branches.find(b => b.id === currentBranchId)?.name || 'Branch';
}
function getActiveBranchExportLabel(){
  return `${getActiveBranchName()} · Mintygreen`;
}
async function switchActiveBranch(branchId) {
  if (!branchId || branchId === currentBranchId) {
    closeBranchSwitcher();
    return;
  }

  currentBranchId = branchId;
  localStorage.setItem('mgbl_active_branch', currentBranchId);

  // Clear resident/branch-specific state immediately so information from the
  // previous branch can never remain visible while the new branch is loading.
  entries = [];
  recurring = [];
  recurringOverrides = [];
  recurringPriceHistory = [];
  dailyEntries = [];
  allItems = [];
  editingItemId = null;
  currentCycleLocked = false;

  const hiddenSelect = $('branchSwitcher');
  if (hiddenSelect) hiddenSelect.value = currentBranchId;

  updateBranchChip();
  renderBranchSwitcher();

  await Promise.all([loadResidents(), loadItems()]);
  renderSelectors();
  renderResidentList();
  renderBranchList();
  await loadRecurring();
  renderCalendar();
  applyBillingCycleStatus();

  if (chargesDisplayMode === 'daily') {
    await loadDailyEntry();
  }

  // Refresh whichever branch-specific management view is currently open.
  if (!$('itemsTab')?.classList.contains('hidden')) await loadAllItems();
  if (!$('staffTab')?.classList.contains('hidden')) await loadStaffList();
  if (!$('backupsTab')?.classList.contains('hidden')) await loadBackupsList();
  if (!$('auditTab')?.classList.contains('hidden') && $('auditMonth')?.value) await loadAuditHistory();

  toast(`Switched to ${branches.find(b => b.id === currentBranchId)?.name || 'branch'}`);
}

function closeBranchSwitcher() {
  const menu = $('branchSwitcherMenu');
  const btn = $('branchSwitcherBtn');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function renderBranchSwitcher() {
  const wrap = $('branchSwitcherWrap');
  const btn = $('branchSwitcherBtn');
  const label = $('branchSwitcherLabel');
  const menu = $('branchSwitcherMenu');
  const hiddenSelect = $('branchSwitcher');

  if (!wrap || !btn || !label || !menu) return;

  const activeBranch = branches.find(b => b.id === currentBranchId);
  label.textContent = activeBranch?.name || 'Select Branch';
  btn.title = activeBranch?.name ? `Current branch: ${activeBranch.name}` : 'Switch branch';

  menu.innerHTML = `
    <div class="branch-switcher-menu-title">Switch Branch</div>
    ${branches.map(b => `
      <button
        type="button"
        class="branch-switcher-option${b.id === currentBranchId ? ' active' : ''}"
        data-branch-id="${b.id}"
        role="menuitem"
        aria-current="${b.id === currentBranchId ? 'true' : 'false'}"
        title="${esc(b.name)}"
      >
        <span class="branch-switcher-option-mark">${esc((b.name || 'B').trim().charAt(0).toUpperCase())}</span>
        <span class="branch-switcher-option-name">${esc(b.name)}</span>
        <span class="branch-switcher-check" aria-hidden="true">✓</span>
      </button>
    `).join('')}
  `;

  // Keep the old select silently in sync in case any older code still reads it.
  if (hiddenSelect) {
    hiddenSelect.innerHTML = branches.map(b =>
      `<option value="${b.id}">${esc(b.name)}</option>`
    ).join('');
    if (currentBranchId) hiddenSelect.value = currentBranchId;
  }

  menu.querySelectorAll('[data-branch-id]').forEach(option => {
    option.addEventListener('click', async e => {
      e.stopPropagation();
      const branchId = option.dataset.branchId;
      closeBranchSwitcher();
      await switchActiveBranch(branchId);
    });
  });

  if (btn.dataset.ready !== '1') {
    btn.dataset.ready = '1';

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const opening = menu.classList.contains('hidden');
      menu.classList.toggle('hidden', !opening);
      btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.branch-switcher')) {
        closeBranchSwitcher();
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeBranchSwitcher();
    });
  }
}
function renderBranchList() {
  const el = $('branchList');
  if (el) {
    if($('branchCount')) $('branchCount').textContent=String(branches.length);
    el.innerHTML = branches.map(b =>
      `<div class="row">
        <div class="entity-main"><div class="entity-title">${esc(b.name)}</div><div class="entity-sub">${b.id===currentBranchId?'Currently selected branch':'Separate billing workspace'}</div></div>
        ${b.id===currentBranchId?'<span class="badge status-badge-info">CURRENT</span>':'<span></span>'}
        <div class="entity-actions">
          <button class="btn btn-subtle btn-compact" onclick="editBranch('${b.id}')">Rename</button>
          <button class="btn btn-danger btn-compact" onclick="deleteBranch('${b.id}')">Delete</button>
        </div>
      </div>`
    ).join('') || '<div class="row polished-empty"><div><div class="empty-icon">⌂</div><div class="empty-title">No branches yet</div><div class="empty-copy">Create a branch workspace to begin.</div></div></div>';
  }
  const copyFrom = $('newBranchCopyFrom');
  if (copyFrom) {
    copyFrom.innerHTML = '<option value="">Start empty</option>' +
      branches.map(b => `<option value="${b.id}">Copy items from ${esc(b.name)}</option>`).join('');
  }
  const staffBranch = $('newStaffBranch');
  if (staffBranch) {
    staffBranch.innerHTML = branches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    if (currentBranchId) staffBranch.value = currentBranchId;
  }
}
window.editBranch = async id => {
  const branch = branches.find(b => b.id === id);
  if (!branch) return;
  const newName = await appPrompt('Rename branch:', branch.name);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) return toast('Branch name cannot be empty');
  const { error } = await sb.from('branches').update({ name: trimmed }).eq('id', id);
  if (error) return toast(error.message);
  await loadBranchContext();
  renderBranchList();
  toast('Branch renamed');
};
window.deleteBranch = async id => {
  const branch = branches.find(b => b.id === id);
  if (!branch) return;
  if (branches.length <= 1) return toast("Can't delete your only branch");

  const ok = await appConfirm(
    `Delete branch: ${branch.name}\n\nThis only works cleanly if the branch has no residents, items, charges or history. If data still exists, a separate guarded purge step will be required.`,
    { danger:true, confirmText:'Delete Branch' }
  );
  if (!ok) return;

  const { error } = await sb.from('branches').delete().eq('id', id);
  if (!error) {
    if (currentBranchId === id) localStorage.removeItem('mgbl_active_branch');
    await loadBranchContext();
    renderBranchList();
    if (currentBranchId !== id) {
      await Promise.all([loadResidents(), loadItems()]);
      renderSelectors(); renderResidentList();
      await loadRecurring(); renderCalendar();
    }
    return toast('Branch deleted');
  }

  // Blocked because the branch still has data — offer a guarded force-purge.
  const typed = await appPrompt(
    `"${branch.name}" still has data attached (residents, items, charges, or history).\n\nTo permanently delete EVERYTHING in this branch and the branch itself, type its exact name below. This cannot be undone.`
  );
  if (typed !== branch.name) {
    if (typed !== null) toast('Name did not match — nothing was deleted');
    return;
  }

  toast('Purging branch data…');
  const tablesInOrder = [
    'recurring_charge_overrides',
    'recurring_charge_price_history',
    'recurring_charge_audit_log',
    'charge_audit_log',
    'charge_entries',
    'recurring_charges',
    'billing_cycles',
    'data_backups',
    'items',
    'residents'
  ];
  for (const table of tablesInOrder) {
    const { error: purgeErr } = await sb.from(table).delete().eq('branch_id', id);
    if (purgeErr) {
      return toast(`Purge failed at ${table}: ${purgeErr.message}`);
    }
  }
  const { error: finalErr } = await sb.from('branches').delete().eq('id', id);
  if (finalErr) {
    return toast(`Data purged, but branch row still failed to delete: ${finalErr.message}`);
  }

  if (currentBranchId === id) localStorage.removeItem('mgbl_active_branch');
  await loadBranchContext();
  renderBranchList();
  if (currentBranchId !== id) {
    await Promise.all([loadResidents(), loadItems()]);
    renderSelectors(); renderResidentList();
    await loadRecurring(); renderCalendar();
  }
  toast(`"${branch.name}" and all its data were permanently deleted`);
};
if ($('addBranchBtn')) $('addBranchBtn').onclick = async () => {
  const name = $('newBranchName').value.trim();
  if (!name) return toast('Enter a branch name');
  const copyFromId = $('newBranchCopyFrom')?.value || '';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const { data: newBranch, error } = await sb.from('branches').insert({ name, slug }).select().single();
  if (error) return toast(error.message);

  if (copyFromId) {
    const { data: sourceItems, error: itemsErr } = await sb
      .from('items')
      .select('name,unit,price,category,active,sort_order')
      .eq('branch_id', copyFromId);
    if (itemsErr) {
      toast(`Branch created, but copying items failed: ${itemsErr.message}`);
    } else if (sourceItems?.length) {
      const copies = sourceItems.map(i => ({ ...i, branch_id: newBranch.id }));
      const { error: insertErr } = await sb.from('items').insert(copies);
      if (insertErr) toast(`Branch created, but copying items failed: ${insertErr.message}`);
      else toast(`Branch added with ${copies.length} item(s) copied`);
    } else {
      toast('Branch added (source branch had no items to copy)');
    }
  } else {
    toast('Branch added');
  }

  $('newBranchName').value = '';
  await loadBranchContext();
  renderBranchList();
};
if ($('addStaffBtn')) $('addStaffBtn').onclick = async () => {
  const full_name = $('newStaffName').value.trim();
  const email = $('newStaffEmail').value.trim();
  const password = $('newStaffPassword').value;
  if (!full_name) return toast('Enter their full name');
  if (!email) return toast('Enter an email');
  if (!password || password.length < 6) return toast('Password must be at least 6 characters');

  const body = { email, password, full_name };
  if (currentUserRole === 'super_admin') {
    const branchId = $('newStaffBranch')?.value;
    if (!branchId) return toast('Select a branch');
    body.branch_id = branchId;
    body.role = $('newStaffRole')?.value || 'staff';
  }

  toast('Creating staff account…');
  const { data, error } = await sb.functions.invoke('create-staff-user', { body });
  if (error) return toast(error.message || 'Could not create staff account');
  if (data?.error) return toast(data.error);

  $('newStaffName').value = '';
  $('newStaffEmail').value = '';
  $('newStaffPassword').value = '';
  toast(`Staff account created for ${email}`);
  await loadStaffList();
};

let staffProfiles = [];

async function loadStaffList() {
  const list = $('staffList');
  const status = $('staffListStatus');
  if (!list) return;

  list.innerHTML = '<div class="loading-skeleton"></div><div class="loading-skeleton" style="margin-top:8px"></div><div class="loading-skeleton" style="margin-top:8px"></div>';
  if (status) status.textContent = '';

  let query = sb
    .from('profiles')
    .select('id,email,display_name,role,branch_id,password_setup_complete')
    .order('email', { ascending: true });

  if (currentUserRole === 'admin' && currentBranchId) {
    query = query.eq('branch_id', currentBranchId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Could not load staff list:', error);
    list.innerHTML = `<div class="row"><small>${esc(error.message)}</small></div>`;
    if (status) status.textContent = 'Could not load staff accounts.';
    return;
  }

  staffProfiles = data || [];

  if (status) {
    status.textContent = `${staffProfiles.length} account${staffProfiles.length === 1 ? '' : 's'} loaded.`;
  }

  if (!staffProfiles.length) {
    list.innerHTML = '<div class="row staff-empty"><div><div class="empty-icon">♟</div><div class="empty-title">No staff accounts found</div><div class="empty-copy">Create a staff account to give your team secure access.</div></div></div>';
    return;
  }

  list.innerHTML = staffProfiles.map(p => {
    const branchName = branches.find(b => b.id === p.branch_id)?.name || (p.role === 'super_admin' ? 'All branches' : 'Not assigned');
    const roleLabel =
      p.role === 'super_admin' ? 'SUPER ADMIN' :
      p.role === 'admin' ? 'BRANCH ADMIN' :
      'STAFF';

    const setupBadge = p.password_setup_complete === true
      ? '<span class="badge status-badge-success">READY</span>'
      : '<span class="badge status-badge-warning">SETUP PENDING</span>';

    const canManage = currentUserRole === 'super_admin' && p.id !== currentUser?.id && p.role !== 'super_admin';

    const displayName = (p.display_name || '').trim() || fallbackDisplayName(p.email || '');
    const avatar = initialsForName(displayName, p.email || '');

    return `
      <div class="row staff-card">
        <div class="staff-profile">
          <div class="staff-avatar">${esc(avatar)}</div>
          <div class="staff-profile-main">
            <div class="staff-name">${esc(displayName)}</div>
            <div class="staff-email">${esc(p.email || '')}</div>
            <div class="staff-meta">
              <span>${esc(branchName)}</span><span class="staff-meta-dot">•</span><span>${esc(roleLabel)}</span>
              ${p.id === currentUser?.id ? '<span class="badge status-badge-info">YOU</span>' : ''}
            </div>
          </div>
        </div>
        <div class="staff-actions">
          ${setupBadge}
          ${canManage ? `
            <button class="btn btn-subtle btn-compact" onclick="editStaffDisplayName('${p.id}')">Edit Name</button>
            <button class="btn btn-subtle btn-compact" onclick="editStaffAccess('${p.id}')">Edit Access</button>
            <button class="btn btn-subtle btn-compact" onclick="sendStaffPasswordReset('${p.id}',this)">Reset Password</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.editStaffDisplayName = async id => {
  if (currentUserRole !== 'super_admin') {
    toast('Super admin access required');
    return;
  }

  const staff = staffProfiles.find(p => p.id === id);
  if (!staff) return;

  if (staff.id === currentUser?.id) {
    toast('Use Settings → Account Profile to change your own display name');
    return;
  }

  const currentDisplayName = (staff.display_name || '').trim() || fallbackDisplayName(staff.email || '');
  const answer = await appPrompt(
    `Edit Display Name\n\nLinked email (read only): ${staff.email || '-'}\n\nDisplay Name:`,
    currentDisplayName
  );

  if (answer === null) return;

  const newDisplayName = answer.trim();
  if (!newDisplayName) {
    toast('Display name cannot be empty');
    return;
  }
  if (newDisplayName.length > 80) {
    toast('Display name must be 80 characters or fewer');
    return;
  }

  const { error } = await sb.rpc('set_profile_display_name', {
    target_user_id: id,
    new_display_name: newDisplayName
  });

  if (error) {
    toast(error.message);
    return;
  }

  toast('Display name updated');
  await loadStaffList();
};

window.editStaffAccess = async id => {
  if (currentUserRole !== 'super_admin') {
    toast('Super admin access required');
    return;
  }

  const staff = staffProfiles.find(p => p.id === id);
  if (!staff) return;

  if (staff.id === currentUser?.id) {
    toast('Use your own account settings for this account');
    return;
  }

  const access = await appAccessDialog(staff);
  if (!access) return;

  const selectedBranch = branches.find(b => b.id === access.branchId);
  if (!selectedBranch) {
    toast('Please select a valid branch');
    return;
  }

  const unchangedDisplayName = (staff.display_name || '').trim() || fallbackDisplayName(staff.email || '');

  const { error } = await sb.rpc('update_staff_profile_admin', {
    target_user_id: id,
    new_display_name: unchangedDisplayName,
    new_branch_id: selectedBranch.id,
    new_role: access.role
  });

  if (error) {
    toast(error.message);
    return;
  }

  toast('Staff access updated');
  await loadStaffList();
};

window.sendStaffPasswordReset = async (id, triggerButton=null) => {
  if (currentUserRole !== 'super_admin') {
    toast('Super admin access required');
    return;
  }

  const staff = staffProfiles.find(p => p.id === id);
  if (!staff?.email) {
    toast('This account has no email address');
    return;
  }

  const ok = await appConfirm(`Reset staff password\n\nSend a secure password reset email to ${staff.email}?`, {confirmText:'Send Reset Email'});
  if (!ok) return;

  const btn = triggerButton instanceof HTMLElement ? triggerButton : null;
  const originalText = btn?.textContent || 'Reset Password';
  if(btn){
    btn.disabled=true;
    btn.textContent='Sending password reset…';
  }

  try{
    const { error } = await sb.auth.resetPasswordForEmail(staff.email, {
      redirectTo: window.location.origin + window.location.pathname
    });

    if (error) {
      if(btn) btn.textContent='Reset failed';
      toast(error.message);
      return;
    }

    if(btn) btn.textContent='Reset email sent ✓';
    toast('Reset email sent');
  } finally {
    if(btn){
      setTimeout(()=>{btn.disabled=false;btn.textContent=originalText;},1400);
    }
  }
};

if ($('refreshStaffBtn')) {
  $('refreshStaffBtn').onclick = loadStaffList;
}

function refreshSidebarGroupVisibility(){
  const tabs=document.querySelector('.tabs');
  if(!tabs)return;
  const children=[...tabs.children];
  children.forEach((el,index)=>{
    if(!el.classList.contains('nav-group-label'))return;
    let hasVisibleButton=false;
    for(let i=index+1;i<children.length;i++){
      const next=children[i];
      if(next.classList.contains('nav-group-label'))break;
      if(next.classList.contains('tab') && !next.classList.contains('hidden') && getComputedStyle(next).display!=='none'){
        hasVisibleButton=true;break;
      }
    }
    el.classList.toggle('hidden',!hasVisibleButton);
  });
}

function applyRoleAccess() {

  const isAdmin =
    currentUserRole === 'admin' || currentUserRole === 'super_admin';
  const isSuperAdmin = currentUserRole === 'super_admin';

  document
    .querySelectorAll('.admin-only')
    .forEach(el => {

      el.classList.toggle(
        'hidden',
        !isAdmin
      );

    });

  document
    .querySelectorAll('.superadmin-only')
    .forEach(el => {
      el.classList.toggle('hidden', !isSuperAdmin);
    });

  if($('staffListDescription')){
    $('staffListDescription').textContent = isSuperAdmin
      ? 'View staff accounts across branches. Edit names and access separately when needed.'
      : isAdmin
        ? 'View staff accounts for your branch. Super Admin controls cross-branch access and role changes.'
        : 'Your account access is managed by an administrator.';
  }

  refreshSidebarGroupVisibility();
  if(window.innerWidth<=850) syncMobileNav();

  if ($('userRole')) {

    $('userRole').textContent =
      currentUserRole === 'super_admin'
        ? 'SUPER ADMIN'
        : isAdmin
          ? 'ADMIN'
          : 'STAFF';

    if ($('accountButtonRole')) {
      $('accountButtonRole').textContent =
        currentUserRole === 'super_admin'
          ? 'Super Admin'
          : isAdmin
            ? 'Branch Admin'
            : 'Staff';
    }
  }
}
async function loadBillingCycleStatus(residentId = null) {

  const month = $('monthPicker').value;
  const rid = residentId || $('residentSelect')?.value || '';

  if (!month || !rid) {
    currentCycleLocked = false;
    applyBillingCycleStatus();
    return;
  }

  const { data, error } = await sb
    .from('billing_cycles')
    .select('is_locked')
    .eq('billing_month', month)
    .eq('branch_id', currentBranchId)
    .eq('resident_id', rid)
    .maybeSingle();

  if (error) {
    console.error('Could not load billing cycle status:', error);
    currentCycleLocked = false;
    applyBillingCycleStatus();
    return;
  }

  currentCycleLocked =
    data?.is_locked === true;

  applyBillingCycleStatus();
}
function applyBillingCycleStatus() {

  const status = $('cycleStatus');
  const button = $('cycleLockBtn');

  if (status) {

    status.textContent =
      currentCycleLocked
        ? 'LOCKED 🔒'
        : 'OPEN';

  }

  if (button) {

    button.textContent =
      currentCycleLocked
        ? 'Unlock Billing Cycle'
        : 'Close Billing Cycle';

  }

  document
    .querySelectorAll('.qty')
    .forEach(input => {

      input.disabled =
        currentCycleLocked;

    });

  document.querySelectorAll('[data-daily-item]').forEach(input => {
    input.disabled = currentCycleLocked;
  });
  document.querySelectorAll('.daily-stepper button').forEach(button => {
    button.disabled = currentCycleLocked;
  });
}
$('cycleLockBtn').onclick = async () => {

  if (currentUserRole !== 'admin' && currentUserRole !== 'super_admin') {
    return toast('Admin access required');
  }

  const month =
    $('monthPicker').value;

  if (!month) {
    return toast('Select a billing cycle first');
  }

  const residentId = $('residentSelect')?.value || '';
  if (!residentId) return toast('Select a resident first');
  const residentName = residents.find(r => r.id === residentId)?.name || 'this resident';

  const cycle =
    getBillingCycle(month);

  if (!cycle) {
    return toast('Invalid billing cycle');
  }

  // -------------------------
  // UNLOCK
  // -------------------------

  if (currentCycleLocked) {

    const ok = await appConfirm(
      `Unlock ${month} billing cycle for ${residentName}?\n\n` +
      `${formatShortDate(cycle.startDate)} – ` +
      `${formatShortDate(cycle.endDate)}\n\n` +
      `Charges can be edited again after unlocking.`
    );

    if (!ok) {
      return;
    }

    const { error } = await sb
      .from('billing_cycles')
      .update({
        is_locked: false,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString()
      })
      .eq('billing_month', month)
      .eq('branch_id', currentBranchId)
      .eq('resident_id', residentId);

    if (error) {
      return toast(error.message);
    }

    toast(`Billing cycle unlocked for ${residentName}`);

  }

  // -------------------------
  // LOCK
  // -------------------------

  else {

    const ok = await appConfirm(
      `Close ${month} billing cycle for ${residentName}?\n\n` +
      `${formatShortDate(cycle.startDate)} – ` +
      `${formatShortDate(cycle.endDate)}\n\n` +
      `Once closed, nobody can change charges until an Admin unlocks it.`
    );

    if (!ok) {
      return;
    }

    const { error } = await sb
      .from('billing_cycles')
      .upsert({
        billing_month: month,
        branch_id: currentBranchId,
        resident_id: residentId,
        cycle_start: cycle.start,
        cycle_end: cycle.end,
        is_locked: true,
        locked_at: new Date().toISOString(),
        locked_by: currentUser.id,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'billing_month,branch_id,resident_id'
      });

    if (error) {
      return toast(error.message);
    }

    toast(`Billing cycle closed for ${residentName}`);
  }

  await loadBillingCycleStatus();

  renderCalendar();

  applyBillingCycleStatus();
};

async function loadLoginActivity() {
  if (currentUserRole !== 'super_admin') {
    toast('Super admin access required');
    return;
  }

  const body = $('loginActivityTableBody');
  const status = $('loginActivityStatus');

  if (!body) return;

  body.innerHTML = '<tr><td colspan="4">Loading…</td></tr>';
  if (status) status.textContent = '';

  let query = sb
    .from('login_activity')
    .select('id, attempted_email, user_id, result, failure_reason, created_at')
    .order('created_at', { ascending: false })
    .limit(250);

  const resultFilter = $('loginActivityResult')?.value || '';
  const emailFilter = ($('loginActivityEmail')?.value || '').trim();

  if (resultFilter) {
    query = query.eq('result', resultFilter);
  }

  if (emailFilter) {
    query = query.ilike('attempted_email', `%${emailFilter}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Could not load login activity:', error);
    body.innerHTML = `<tr><td colspan="4">${esc(error.message)}</td></tr>`;
    if (status) status.textContent = 'Could not load login activity.';
    return;
  }

  const rows = data || [];

  const loginUserIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  const loginEmails = [...new Set(
    rows.map(r => (r.attempted_email || '').trim().toLowerCase()).filter(Boolean)
  )];

  const loginProfileById = {};
  const loginProfileByEmail = {};

  if (loginUserIds.length || loginEmails.length) {
    let profilesQuery = sb
      .from('profiles')
      .select('id,email,display_name');

    if (loginUserIds.length && loginEmails.length) {
      const idList = loginUserIds.map(id => `"${id}"`).join(',');
      const emailList = loginEmails.map(email => `"${email.replace(/"/g,'')}"`).join(',');
      profilesQuery = profilesQuery.or(`id.in.(${idList}),email.in.(${emailList})`);
    } else if (loginUserIds.length) {
      profilesQuery = profilesQuery.in('id', loginUserIds);
    } else {
      profilesQuery = profilesQuery.in('email', loginEmails);
    }

    const {data: loginProfiles, error: loginProfilesError} = await profilesQuery;

    if(loginProfilesError){
      console.error('Could not load login user identities:', loginProfilesError);
    }else{
      (loginProfiles || []).forEach(p => {
        loginProfileById[p.id] = p;
        if(p.email) loginProfileByEmail[p.email.toLowerCase()] = p;
      });
    }
  }

  if (status) {
    status.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'} loaded.`;
  }

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4">No matching login activity found.</td></tr>';
    return;
  }

  body.innerHTML = rows.map(row => {
    const dt = row.created_at
      ? new Date(row.created_at).toLocaleString()
      : '-';

    const resultBadge = row.result === 'SUCCESS'
      ? '<span class="badge" style="background:#dcfce7;color:#166534">SUCCESS</span>'
      : '<span class="badge" style="background:#fee2e2;color:#991b1b">FAILED</span>';

    const emailKey = (row.attempted_email || '').trim().toLowerCase();
    const profile =
      (row.user_id && loginProfileById[row.user_id]) ||
      loginProfileByEmail[emailKey] ||
      null;

    const identityHtml = profile
      ? renderUserIdentity(
          profile.display_name,
          profile.email || row.attempted_email,
          row.user_id || profile.id,
          {showId:false}
        )
      : renderUserIdentity(
          'Unknown user',
          row.attempted_email || '',
          row.user_id || '',
          {showId:false}
        );

    return `
      <tr>
        <td>${esc(dt)}</td>
        <td>${identityHtml}</td>
        <td>${resultBadge}</td>
        <td>${esc(row.failure_reason || '-')}</td>
      </tr>
    `;
  }).join('');
}

async function loadAuditHistory() {

  if (currentUserRole !== 'admin' && currentUserRole !== 'super_admin') {
    return toast('Admin access required');
  }

  const month = $('auditMonth').value;
  const residentId = $('auditResident').value;

  if (!month) {
    return toast('Select a billing cycle first');
  }

  const cycle = getBillingCycle(month);

  if (!cycle) {
    return toast('Invalid billing cycle');
  }

  let query = sb
    .from('charge_audit_log')
    .select(`
      id,
      charge_entry_id,
      resident_id,
      item_id,
      charge_date,
      action,
      old_quantity,
      new_quantity,
      changed_by,
      changed_at,
      residents(name),
      items(name)
    `)
    .eq('branch_id', currentBranchId)
    .gte('charge_date', cycle.start)
    .lte('charge_date', cycle.end)
    .order('changed_at', {
      ascending: false
    });

  if (residentId) {
    query = query.eq(
      'resident_id',
      residentId
    );
  }

  const { data, error } =
    await query;

  if (error) {
    console.error(
      'Could not load audit history:',
      error
    );

    $('auditTableBody').innerHTML = `
      <tr>
        <td colspan="9">
          ${esc(error.message)}
        </td>
      </tr>
    `;

    return;
  }

const normalLogs = data || [];

let recurringAuditQuery = sb
  .from('recurring_charge_audit_log')
  .select(`
    id,
    resident_id,
    item_id,
    action,
    old_amount,
    new_amount,
    billing_month,
    effective_date,
    reason,
    changed_by,
    changed_at
  `)
  .eq('billing_month', month)
  .eq('branch_id', currentBranchId)
  .order('changed_at', {
    ascending: false
  });

if (residentId) {
  recurringAuditQuery =
    recurringAuditQuery.eq(
      'resident_id',
      residentId
    );
}

const {
  data: recurringAuditData,
  error: recurringAuditError
} = await recurringAuditQuery;

if (recurringAuditError) {
  console.error(
    'Could not load recurring audit history:',
    recurringAuditError
  );
}

const recurringLogs =
  (recurringAuditData || []).map(log => {
    const resident =
      residents.find(
        r => r.id === log.resident_id
      );

    const item =
      items.find(
        i => i.id === log.item_id
      );

    return {
      ...log,

      residents: {
        name: resident?.name || ''
      },

      items: {
        name: item?.name || ''
      },

      old_quantity: log.old_amount,
      new_quantity: log.new_amount,

      isRecurringAudit: true
    };
  });

const logs = [
  ...normalLogs,
  ...recurringLogs
].sort(
  (a, b) =>
    new Date(b.changed_at) -
    new Date(a.changed_at)
);

  // Get the users who made these changes
const userIds = [
  ...new Set(
    logs
      .map(log => log.changed_by)
      .filter(Boolean)
  )
];

const profileByChangedUserId = {};

if (userIds.length) {

  const {
    data: profileData,
    error: profileError
  } = await sb
    .from('profiles')
    .select('id,email,display_name')
    .in('id', userIds);

  if (profileError) {

    console.error(
      'Could not load staff identities:',
      profileError
    );

  } else {

    (profileData || []).forEach(profile => {
      profileByChangedUserId[profile.id] = profile;
    });

  }
}

  if (!logs.length) {

    $('auditTableBody').innerHTML = `
      <tr>
        <td colspan="9">
          No audit history found for this billing cycle.
        </td>
      </tr>
    `;

    return;
  }

  $('auditTableBody').innerHTML =
    logs.map(log => {

      const changedDate =
        new Date(log.changed_at);

      const changedText =
        changedDate.toLocaleString(
          'en-MY',
          {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }
        );

let chargeDateText = '-';

if (log.isRecurringAudit) {

  if (log.effective_date) {

    const effectiveDate =
      new Date(log.effective_date + 'T00:00:00');

    chargeDateText =
      effectiveDate.toLocaleDateString(
        'en-MY',
        {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }
      );

  } else if (log.billing_month) {

    const [year, monthNum] =
      log.billing_month.split('-');

    const billingDate =
      new Date(
        Number(year),
        Number(monthNum) - 1,
        1
      );

    chargeDateText =
      billingDate.toLocaleDateString(
        'en-MY',
        {
          month: 'short',
          year: 'numeric'
        }
      );
  }
} 

else if (log.charge_date) {
  const chargeDate =
    new Date(
      log.charge_date +
      'T00:00:00'
    );

  chargeDateText =
    chargeDate.toLocaleDateString(
      'en-MY',
      {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }
    );
}
      return `
        <tr>

          <td>
            ${esc(changedText)}
          </td>

          <td>
            ${esc(
              log.residents?.name ||
              '-'
            )}
          </td>

          <td>
            ${esc(
              log.items?.name ||
              '-'
            )}
          </td>

          <td>
            ${esc(chargeDateText)}
          </td>

<td>
  <span
    class="audit-action ${
log.action.includes('CREATED')
  ? 'audit-created'
  : log.action.includes('UPDATED')
  ? 'audit-updated'
  : 'audit-deleted'
    }"
  >
    ${esc(log.action)}
  </span>
</td>

          <td>
            ${
              log.old_quantity == null
                ? '-'
                : esc(log.old_quantity)
            }
          </td>

          <td>
            ${
              log.new_quantity == null
                ? '-'
                : esc(log.new_quantity)
            }
          </td>

          <td>
            ${esc(log.reason || '-')}
          </td>

          <td>
            ${
              profileByChangedUserId[log.changed_by]
                ? renderUserIdentity(
                    profileByChangedUserId[log.changed_by].display_name,
                    profileByChangedUserId[log.changed_by].email,
                    log.changed_by
                  )
                : renderUserIdentity(
                    'Unknown user',
                    '',
                    log.changed_by || ''
                  )
            }
          </td>

        </tr>
      `;

    }).join('');
}
$('loadAuditBtn').onclick = loadAuditHistory;

if ($('loadLoginActivityBtn')) {
  $('loadLoginActivityBtn').onclick = loadLoginActivity;
}
if ($('loginActivityEmail')) {
  $('loginActivityEmail').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadLoginActivity();
  });
}
if ($('loginActivityResult')) {
  $('loginActivityResult').onchange = loadLoginActivity;
}

sb.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY'){
    showPasswordRecoveryScreen();
  }
  if(event==='USER_UPDATED' && session?.user && currentUser){
    currentUser=session.user;
    updateCurrentUserIdentityUI();
  }
});

init();



$('residentListSearch')?.addEventListener('input', applyResidentListSearch);
$('itemListSearch')?.addEventListener('input', applyItemListSearch);



// ---------- v50 one-time What's New notice ----------
const WHATS_NEW_RELEASE='v50';
const WHATS_NEW_KEY=`mintygreenWhatsNewSeen:${WHATS_NEW_RELEASE}`;
let whatsNewInProgress=false;

function hasSeenWhatsNew(){
  try{return localStorage.getItem(WHATS_NEW_KEY)==='1'}catch(e){return false}
}
function markWhatsNewSeen(){
  try{localStorage.setItem(WHATS_NEW_KEY,'1')}catch(e){}
}

function whatsNewHtmlForRole(){
  const isManagement=currentUserRole==='admin' || currentUserRole==='super_admin';

  if(isManagement){
    return `
      <div class="whats-new-version">Mintygreen Charges · ${WHATS_NEW_RELEASE}</div>
      <div class="whats-new-list">
        <div class="whats-new-item"><span>✓</span><div><strong>One unified system</strong><br>The same Mintygreen Charges app is now optimized for desktop and phone.</div></div>
        <div class="whats-new-item"><span>✓</span><div><strong>Full mobile management</strong><br>Admin and Super Admin navigation is available from the mobile Menu according to account permissions.</div></div>
        <div class="whats-new-item"><span>✓</span><div><strong>Installable phone app</strong><br>The main system can be installed to the Home Screen for an app-style experience.</div></div>
        <div class="whats-new-item"><span>✓</span><div><strong>Smoother account experience</strong><br>Login, logout, Settings and mobile navigation have been polished while keeping the existing security controls.</div></div>
      </div>`;
  }

  return `
    <div class="whats-new-version">Mintygreen Charges · ${WHATS_NEW_RELEASE}</div>
    <div class="whats-new-list">
      <div class="whats-new-item"><span>✓</span><div><strong>Better on phone</strong><br>Daily Entry and navigation are now easier to use on mobile.</div></div>
      <div class="whats-new-item"><span>✓</span><div><strong>Install to Home Screen</strong><br>You can install Mintygreen Charges on your phone for quicker access.</div></div>
      <div class="whats-new-item"><span>✓</span><div><strong>Smoother sign in and out</strong><br>The account experience has been polished without changing how you enter charges.</div></div>
    </div>`;
}

async function maybeShowWhatsNew(){
  if(whatsNewInProgress || hasSeenWhatsNew()) return;
  if(!currentUser) return;
  if($('appView')?.classList.contains('hidden')) return;

  // Avoid stacking this on top of the first-time mobile install prompt.
  if(installPopupInProgress) return;

  whatsNewInProgress=true;
  await openAppModal({
    title:"What's New",
    message: currentUserRole==='admin' || currentUserRole==='super_admin'
      ? 'The unified Mintygreen Charges experience is now live.'
      : 'Mintygreen Charges has been improved for easier daily use.',
    confirmText:'Got it',
    cancelText:'Close',
    customHtml:whatsNewHtmlForRole()
  });
  markWhatsNewSeen();
  whatsNewInProgress=false;
}

// ---------- v48 unified mobile navigation + install ----------
let deferredInstallPrompt = null;
const INSTALL_POPUP_SEEN_KEY='mintygreenInstallPopupSeenV49';
let installPopupInProgress=false;

function isPhoneViewport(){
  return window.matchMedia('(max-width: 850px)').matches;
}

function hasSeenInstallPopup(){
  try{return localStorage.getItem(INSTALL_POPUP_SEEN_KEY)==='1'}catch(e){return false}
}

function markInstallPopupSeen(){
  try{localStorage.setItem(INSTALL_POPUP_SEEN_KEY,'1')}catch(e){}
}

async function maybeShowMobileInstallPopup(){
  if(installPopupInProgress) return;
  if(!isPhoneViewport()) return;
  if(isStandaloneApp()) return;
  if(hasSeenInstallPopup()) return;
  if(!currentUser) return;
  if($('appView')?.classList.contains('hidden')) return;

  // On Chromium/Android, wait for the browser's install event so the
  // Install button can launch the native install sheet immediately.
  if(!deferredInstallPrompt){
    // iPhone/iPad browsers do not expose beforeinstallprompt.
    const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
    if(!isiOS) return;

    installPopupInProgress=true;
    const result=await openAppModal({
      title:'Install Mintygreen Charges',
      message:'Add Mintygreen Charges to your Home Screen for faster access and a full-screen app experience.\n\nOn iPhone/iPad: tap the browser Share button, then choose “Add to Home Screen”.',
      confirmText:'Got it',
      cancelText:'Not now'
    });
    markInstallPopupSeen();
    installPopupInProgress=false;
    return;
  }

  installPopupInProgress=true;

  const result=await openAppModal({
    title:'Install Mintygreen Charges',
    message:'Would you like to install Mintygreen Charges on this phone? It will open like an app while using the same secure account and billing system.',
    confirmText:'Install App',
    cancelText:'Not now',
    customHtml:`
      <div class="install-prompt-benefits">
        <div class="install-prompt-benefit"><span>✓</span><div><strong>Faster access</strong><br>Open directly from your Home Screen.</div></div>
        <div class="install-prompt-benefit"><span>✓</span><div><strong>App-style view</strong><br>No browser address bar while using the system.</div></div>
        <div class="install-prompt-benefit"><span>✓</span><div><strong>Same secure system</strong><br>Your login, permissions and billing data remain unchanged.</div></div>
      </div>`
  });

  // Show only once automatically on this browser. The user can still
  // install later from Account → Install App.
  markInstallPopupSeen();
  installPopupInProgress=false;

  if(!result.confirmed) return;
  if(!deferredInstallPrompt) return;

  deferredInstallPrompt.prompt();
  const choice=await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;
  refreshInstallAppAction();

  if(choice?.outcome==='accepted'){
    toast('Installing Mintygreen Charges…');
  }
  setTimeout(maybeShowWhatsNew,900);
}


function isStandaloneApp(){
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

function mobileNavGroupForTab(tabName){
  if(['charges','recurring'].includes(tabName)) return 'Operations';
  if(['setup','items','staff','branches'].includes(tabName)) return 'Management';
  return 'System';
}

function syncMobileNav(){
  const list=$('mobileNavList');
  if(!list)return;

  const originalTabs=[...document.querySelectorAll('.wrap > .tabs .tab')];
  const visibleTabs=originalTabs.filter(btn=>{
    if(btn.classList.contains('hidden')) return false;
    return getComputedStyle(btn).display !== 'none';
  });

  let lastGroup='';
  const activeTab=originalTabs.find(btn=>btn.classList.contains('active'))?.dataset.tab || '';

  list.innerHTML=visibleTabs.map(btn=>{
    const tabName=btn.dataset.tab||'';
    const group=mobileNavGroupForTab(tabName);
    const groupHtml=group!==lastGroup ? `<div class="mobile-nav-group">${esc(group)}</div>` : '';
    lastGroup=group;
    return `${groupHtml}<button type="button" class="mobile-nav-item${activeTab===tabName?' active':''}" data-mobile-tab="${esc(tabName)}">
      <span>${esc((btn.textContent||'').trim())}</span><span class="mobile-nav-item-arrow">›</span>
    </button>`;
  }).join('');

  list.querySelectorAll('[data-mobile-tab]').forEach(item=>{
    item.addEventListener('click',()=>{
      const tabName=item.dataset.mobileTab;
      document.querySelector(`.wrap > .tabs .tab[data-tab="${tabName}"]`)?.click();
      closeMobileNav();
      setTimeout(syncMobileNav,20);
    });
  });

  const name=(currentUserDisplayName||fallbackDisplayName(currentUser?.email||'')||'Account').trim();
  const role=currentUserRole==='super_admin'?'Super Admin':currentUserRole==='admin'?'Branch Admin':'Staff';
  if($('mobileNavProfile')) $('mobileNavProfile').innerHTML=`<strong>${esc(name)}</strong><br>${esc(role)}`;
  const branchName=branches.find(b=>b.id===currentBranchId)?.name || $('brandSubtitle')?.textContent || 'Monthly Charges';
  if($('mobileNavBranch')) $('mobileNavBranch').textContent=branchName;
}

function openMobileNav(){
  syncMobileNav();
  $('mobileNavBackdrop')?.classList.remove('hidden');
  $('mobileNavDrawer')?.classList.remove('hidden');
  $('mobileNavBackdrop')?.setAttribute('aria-hidden','false');
  $('mobileNavDrawer')?.setAttribute('aria-hidden','false');
  $('mobileNavBtn')?.setAttribute('aria-expanded','true');
  document.body.style.overflow='hidden';
}

function closeMobileNav(){
  $('mobileNavBackdrop')?.classList.add('hidden');
  $('mobileNavDrawer')?.classList.add('hidden');
  $('mobileNavBackdrop')?.setAttribute('aria-hidden','true');
  $('mobileNavDrawer')?.setAttribute('aria-hidden','true');
  $('mobileNavBtn')?.setAttribute('aria-expanded','false');
  document.body.style.overflow='';
}

function refreshInstallAppAction(){
  const btn=$('installAppBtn');
  if(!btn)return;
  const shouldShow=!isStandaloneApp() && !!deferredInstallPrompt;
  btn.classList.toggle('hidden',!shouldShow);
}

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredInstallPrompt=e;
  refreshInstallAppAction();
  setTimeout(maybeShowMobileInstallPopup,650);
});

window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  markInstallPopupSeen();
  refreshInstallAppAction();
  toast('Mintygreen Charges installed');
});

$('mobileNavBtn')?.addEventListener('click',openMobileNav);
$('mobileNavCloseBtn')?.addEventListener('click',closeMobileNav);
$('mobileNavBackdrop')?.addEventListener('click',closeMobileNav);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && !$('mobileNavDrawer')?.classList.contains('hidden')) closeMobileNav();
});

$('installAppBtn')?.addEventListener('click',async()=>{
  $('accountMenu')?.classList.add('hidden');

  if(isStandaloneApp()){
    deferredInstallPrompt=null;
    refreshInstallAppAction();
    return;
  }

  if(!deferredInstallPrompt){
    await openAppModal({
      title:'Install Mintygreen Charges',
      message:'Open this website in your phone browser and choose “Add to Home screen” or “Install app” from the browser menu.',
      confirmText:'Got it',
      cancelText:'Close'
    });
    return;
  }

  deferredInstallPrompt.prompt();
  const result=await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;
  refreshInstallAppAction();
  if(result?.outcome==='accepted') toast('Installing Mintygreen Charges…');
});

// Keep mobile navigation in sync whenever desktop role visibility changes.
const mobileNavObserver=new MutationObserver(()=>{
  if(window.innerWidth<=850 && !$('mobileNavDrawer')?.classList.contains('hidden')) syncMobileNav();
});
document.querySelectorAll('.wrap > .tabs .tab').forEach(tab=>{
  mobileNavObserver.observe(tab,{attributes:true,attributeFilter:['class','style']});
});

window.addEventListener('resize',()=>{
  if(window.innerWidth>850) closeMobileNav();
  refreshInstallAppAction();
});

refreshInstallAppAction();

// v38 UI initialization
addSidebarGroups();
addProfessionalPageHeadings();
setupAccountMenu();
setTimeout(upgradePolishedEmptyStates, 100);

const uiObserver = new MutationObserver(() => {
  clearTimeout(window.__mintyUiPolishTimer);
  window.__mintyUiPolishTimer = setTimeout(upgradePolishedEmptyStates, 50);
});
if($('appView')) uiObserver.observe($('appView'), {childList:true, subtree:true});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
  });
}
