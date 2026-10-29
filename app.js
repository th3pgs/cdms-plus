// ============================================================================
// CDMS+ ENTERPRISE ENGINE (NO-DATA PLACEHOLDERS + EMPTY HEAD + DIRECT TRANSITION)
// ============================================================================
const SUPABASE_URL = 'https://uvfmircbplfqkgkmzssb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NZNswR7y9y-oSJIC-unRvw_wioNx760';
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// CLEAN SVG PLACEHOLDERS (EMPTY HEAD AVATAR & "NO DATA" ITEM PLACEHOLDER)
const DEFAULT_AVATAR_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">
  <rect width="120" height="120" fill="#E4E4E7"/>
  <circle cx="60" cy="44" r="22" fill="#A1A1AA"/>
  <path d="M20 112C20 88.804 37.9086 72 60 72C82.0914 72 100 88.804 100 112" fill="#A1A1AA"/>
</svg>`);

const NO_DATA_IMAGE_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" fill="none">
  <rect width="400" height="260" fill="#F4F4F5"/>
  <rect x="150" y="78" width="100" height="68" rx="8" stroke="#A1A1AA" stroke-width="2" stroke-dasharray="4 4"/>
  <line x1="166" y1="130" x2="234" y2="94" stroke="#D4D4D8" stroke-width="2"/>
  <text x="200" y="176" text-anchor="middle" fill="#71717A" font-family="monospace, sans-serif" font-size="13" font-weight="bold" letter-spacing="2">NO DATA</text>
</svg>`);

function getAvatarUrl(url) {
    if (!url || url.includes('unsplash.com') || url.includes('placehold.co')) {
        return DEFAULT_AVATAR_SVG;
    }
    return url;
}

function getItemImageUrl(url) {
    if (!url || url.includes('unsplash.com') || url.includes('placehold.co')) {
        return NO_DATA_IMAGE_SVG;
    }
    return url;
}

let DB = {
    employees: [],
    pattern_assets: [],
    cad_markers: [],
    rmw_materials: [],
    qc_defect_codes: [],
    shift_assignments: [],
    pending_requests: [],
    cutting_orders: [],
    qc_inspection_logs: [],
    system_settings_audit: [],
    department_communications: [],
    immutable_audit_logs: []
};

let vivaBypassUnlocked = false;
let currentLoggedInUser = null;
let currentMode = 'gateway'; // 'gateway', 'terminal', 'portal'
let kioskAuthMode = 'unlock'; // 'unlock' or 'logout'
let idleSecondsRemaining = 300;
let selectedOperatorForAssign = null;
let activeCommTab = 'inbox';
let mutexPollInterval = null;

// ============================================================================
// 1. TOP BAR & DIRECT MODAL-TO-VIEW TRANSITION CONTROLLERS
// ============================================================================
function setTopBarState(state) {
    const inner = document.getElementById('top-bar-inner');
    const divider = document.getElementById('top-bar-compact-divider');
    const sessionCtrls = document.getElementById('top-bar-session-controls');
    const profileWrap = document.getElementById('header-profile-wrapper');
    const subnav = document.getElementById('portal-subnav-bar');

    if (state === 'compact') {
        inner.classList.remove('expanded-bar');
        inner.classList.add('compact-bar');
        divider.classList.remove('hidden');
        sessionCtrls.classList.add('hidden');
        sessionCtrls.classList.remove('flex');
        subnav.classList.add('hidden');
    } else if (state === 'expanded-auth') {
        inner.classList.remove('compact-bar');
        inner.classList.add('expanded-bar');
        divider.classList.add('hidden');
        sessionCtrls.classList.add('hidden');
        sessionCtrls.classList.remove('flex');
        subnav.classList.add('hidden');
    } else if (state === 'expanded-terminal') {
        inner.classList.remove('compact-bar');
        inner.classList.add('expanded-bar');
        divider.classList.add('hidden');
        sessionCtrls.classList.remove('hidden');
        sessionCtrls.classList.add('flex');
        profileWrap.classList.add('hidden');
        subnav.classList.add('hidden');
    } else if (state === 'expanded-portal') {
        inner.classList.remove('compact-bar');
        inner.classList.add('expanded-bar');
        divider.classList.add('hidden');
        sessionCtrls.classList.remove('hidden');
        sessionCtrls.classList.add('flex');
        profileWrap.classList.remove('hidden');
        subnav.classList.remove('hidden');
    }
}

// Swaps the underlying view FIRST, then smoothly dissolves the modal over the new screen
function dissolveModalIntoView(modalId, setupNewViewFn) {
    const modal = document.getElementById(modalId);
    const stage = document.getElementById('stage-wrapper');

    // 1. Prepare and display the new destination view behind the modal immediately
    if (stage) {
        stage.classList.remove('view-stage-ready');
        stage.classList.add('view-stage-switching');
    }
    setupNewViewFn();

    // 2. Dissolve the modal out while bringing the new view into focus
    if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('modal-fade-out');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('modal-fade-out');
        }, 140);
    }

    requestAnimationFrame(() => {
        if (stage) {
            stage.classList.remove('view-stage-switching');
            stage.classList.add('view-stage-ready');
        }
    });
}

function animateStageTransition(callback) {
    const stage = document.getElementById('stage-wrapper');
    if (!stage) { callback(); return; }
    stage.classList.remove('view-stage-ready');
    stage.classList.add('view-stage-switching');
    setTimeout(() => {
        callback();
        stage.classList.remove('view-stage-switching');
        stage.classList.add('view-stage-ready');
    }, 140);
}

// ============================================================================
// 2. SUPABASE LIVE SYNC & IMMUTABLE AUDIT
// ============================================================================
async function syncFromSupabase() {
    try {
        const [
            emp, pat, cad, rmw, qcd, shf, req, ord, qcl, sys, com, aud
        ] = await Promise.all([
            supa.from('employees').select('*').order('employee_id'),
            supa.from('pattern_assets').select('*').order('asset_id'),
            supa.from('cad_markers').select('*').order('cad_marker_id'),
            supa.from('rmw_materials').select('*').order('material_code'),
            supa.from('qc_defect_codes').select('*').order('defect_code'),
            supa.from('shift_assignments').select('*').order('assignment_id', { ascending: false }),
            supa.from('pending_requests').select('*').order('request_id', { ascending: false }),
            supa.from('cutting_orders').select('*').order('order_id', { ascending: false }),
            supa.from('qc_inspection_logs').select('*').order('qc_log_id', { ascending: false }),
            supa.from('system_settings_audit').select('*').order('record_id', { ascending: false }),
            supa.from('department_communications').select('*').order('comm_id', { ascending: false }),
            supa.from('immutable_audit_logs').select('*').order('audit_id', { ascending: false }).limit(200)
        ]);

        if (emp.data) DB.employees = emp.data;
        if (pat.data) DB.pattern_assets = pat.data;
        if (cad.data) DB.cad_markers = cad.data;
        if (rmw.data) DB.rmw_materials = rmw.data;
        if (qcd.data) DB.qc_defect_codes = qcd.data;
        if (shf.data) DB.shift_assignments = shf.data;
        if (req.data) DB.pending_requests = req.data;
        if (ord.data) DB.cutting_orders = ord.data;
        if (qcl.data) DB.qc_inspection_logs = qcl.data;
        if (sys.data) DB.system_settings_audit = sys.data;
        if (com.data) DB.department_communications = com.data;
        if (aud.data) DB.immutable_audit_logs = aud.data;

        if (currentLoggedInUser) {
            const refreshed = DB.employees.find(e => e.employee_id === currentLoggedInUser.employee_id);
            if (refreshed) {
                currentLoggedInUser = refreshed;
                updateProfileUI(refreshed);
            }
        }
        applyCustomLogosFromDB();
        updateCommUnreadBadge();
    } catch (err) {
        console.error('Supabase Sync Error:', err);
    }
}

async function writeImmutableAudit(actionVerb, targetEntity, targetId, snapshotObj) {
    const actorId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'TERMINAL';
    const actorName = currentLoggedInUser ? currentLoggedInUser.full_name : 'Pattern Room Terminal';
    const actorRole = currentLoggedInUser ? currentLoggedInUser.role_designation : 'Floor Terminal';

    await supa.from('immutable_audit_logs').insert([{
        actor_id: actorId,
        actor_name: actorName,
        actor_role: actorRole,
        action_verb: actionVerb,
        target_entity: targetEntity,
        target_id: String(targetId),
        immutable_snapshot: typeof snapshotObj === 'string' ? snapshotObj : JSON.stringify(snapshotObj)
    }]);
}

// ============================================================================
// 3. BOOT & IDLE TIMEOUT RULES (KIOSK NEVER LOGS OUT ON IDLE)
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    setTopBarState('compact');
    document.getElementById('header-user-avatar').src = DEFAULT_AVATAR_SVG;
    document.getElementById('popover-user-avatar').src = DEFAULT_AVATAR_SVG;
    await syncFromSupabase();

    ['click', 'keydown', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, () => { idleSecondsRemaining = 300; });
    });

    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('header-profile-wrapper');
        const pop = document.getElementById('profile-popover-menu');
        if (wrapper && pop && !wrapper.contains(e.target)) {
            pop.classList.add('hidden');
        }
    });

    setInterval(() => {
        if (currentMode === 'gateway') return;
        idleSecondsRemaining--;

        if (idleSecondsRemaining <= 0) {
            idleSecondsRemaining = 300;

            if (currentMode === 'terminal') {
                const verifyOpen = !document.getElementById('verify-modal').classList.contains('hidden');
                if (verifyOpen) {
                    closeVerifyModal();
                    clearSearch();
                    showToast('Unfinished checkout procedure reset due to inactivity.', 'error');
                }
            } else if (currentMode === 'portal') {
                closeVerifyModal();
                returnToWelcomeScreen();
                showToast('Session signed out due to 5 minutes of inactivity.', 'error');
            }
        }
    }, 1000);
});

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    const border = type === 'error' ? 'border-rose-600' : 'border-zinc-700';
    const dot = type === 'error' ? 'bg-rose-500' : 'bg-emerald-500';
    t.className = `bg-zinc-900 ${border} border text-white px-4 py-3 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2.5 fade-in pointer-events-auto`;
    t.innerHTML = `<span class="w-2 h-2 rounded-full ${dot} shrink-0"></span> <span>${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function closeLoginModal() {
    closeModal('user-login-modal');
    if (currentMode === 'gateway') setTopBarState('compact');
}

function closeKioskAuthModal() {
    closeModal('kiosk-auth-modal');
    if (currentMode === 'gateway') setTopBarState('compact');
}

function closeVerifyModal() {
    closeModal('verify-modal');
}

function closeCommDrawer() {
    closeModal('comm-drawer-window');
}

function toggleProfilePopover(e) {
    if (e) e.stopPropagation();
    const pop = document.getElementById('profile-popover-menu');
    if (pop) pop.classList.toggle('hidden');
}

function closeProfilePopover() {
    closeModal('profile-popover-menu');
}

function readAndCompressImage(fileInput, maxWidth = 400) {
    return new Promise((resolve) => {
        if (!fileInput || !fileInput.files || !fileInput.files[0]) return resolve(null);
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = Math.min(1, maxWidth / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/png', 0.9));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(fileInput.files[0]);
    });
}

// ============================================================================
// 4. BIG ICON-ONLY PADLOCK, STAFF LOGIN & PATTERN ROOM KIOSK PASSWORD MODAL
// ============================================================================
function toggleVivaPadlock() {
    vivaBypassUnlocked = !vivaBypassUnlocked;
    const icon = document.getElementById('viva-padlock-icon');
    const btn = document.getElementById('viva-padlock-btn');

    if (vivaBypassUnlocked) {
        icon.className = 'ph-fill ph-lock-key-open text-2xl text-zinc-900';
        btn.className = 'w-12 h-12 rounded-xl border-2 border-zinc-900 bg-white text-zinc-900 flex items-center justify-center transition-all shadow-md';
    } else {
        icon.className = 'ph-fill ph-lock-key text-2xl text-zinc-500';
        btn.className = 'w-12 h-12 rounded-xl border border-zinc-200 bg-white text-zinc-500 flex items-center justify-center transition-all shadow-sm';
    }
}

function openUserLoginModal() {
    setTopBarState('expanded-auth');
    document.getElementById('user-login-modal').classList.remove('hidden');
    const helper = document.getElementById('viva-login-helper');
    const stdInputs = document.getElementById('standard-login-inputs');

    if (vivaBypassUnlocked) {
        helper.classList.remove('hidden');
        stdInputs.classList.add('hidden');
        onVivaRoleChange();
    } else {
        helper.classList.add('hidden');
        stdInputs.classList.remove('hidden');
        morphDepartmentIconOnType(document.getElementById('login-emp-id').value);
    }
}

function onVivaRoleChange() {
    const val = document.getElementById('viva-role-dropdown').value;
    morphDepartmentIconOnType(val);
}

function morphDepartmentIconOnType(rawId) {
    const code = (rawId || '').trim().toUpperCase();
    const icon = document.getElementById('login-dept-icon');
    const badge = document.getElementById('login-dept-badge');
    const title = document.getElementById('login-dynamic-title');

    const emp = DB.employees.find(e => e.employee_id.toUpperCase() === code);
    let cfg = { icon: 'ph-identification-badge', dept: 'Bodyline Staff Authentication', title: 'Staff Portal Sign In' };

    if (code.startsWith('DH')) {
        cfg = { icon: 'ph-buildings', dept: emp ? emp.full_name : 'CD Operations Office', title: 'Cutting Department Head Sign In' };
    } else if (code.startsWith('CSE')) {
        cfg = { icon: 'ph-briefcase', dept: emp ? emp.full_name : 'CD Operations Office', title: 'Cutting Senior Executive Sign In' };
    } else if (code.startsWith('CS-')) {
        cfg = { icon: 'ph-calendar-check', dept: emp ? emp.full_name : 'Cutting Floor', title: 'Cutting Supervisor Sign In' };
    } else if (code.startsWith('DDC')) {
        cfg = { icon: 'ph-paint-brush-broad', dept: emp ? emp.full_name : 'Design Department', title: 'Design Coordinator Sign In' };
    } else if (code.startsWith('CAD')) {
        cfg = { icon: 'ph-compass-tool', dept: emp ? emp.full_name : 'CAD Room', title: 'CAD Room Sign In' };
    } else if (code.startsWith('PR-')) {
        cfg = { icon: 'ph-barcode', dept: emp ? emp.full_name : 'Pattern Room', title: 'Pattern Coordinator Sign In' };
    } else if (code.startsWith('SDC')) {
        cfg = { icon: 'ph-scissors', dept: emp ? emp.full_name : 'Sewing Department', title: 'Sewing Coordinator Sign In' };
    } else if (code.startsWith('RMW')) {
        cfg = { icon: 'ph-warehouse', dept: emp ? emp.full_name : 'Raw Material Warehouse', title: 'RMW Coordinator Sign In' };
    } else if (code.startsWith('CQC') || code.startsWith('QCI')) {
        cfg = { icon: 'ph-warning-octagon', dept: emp ? emp.full_name : 'Quality Control', title: 'Quality Control Sign In' };
    } else if (code.startsWith('DT-C-CST')) {
        cfg = { icon: 'ph-headset', dept: emp ? emp.full_name : 'Digital Team', title: 'CDMS Support Team Sign In' };
    } else if (code.startsWith('CDTE') || code.startsWith('DT-')) {
        cfg = { icon: 'ph-terminal-window', dept: emp ? emp.full_name : 'Digital Team', title: 'CDMS Admin Sign In' };
    }

    icon.className = `ph-bold ${cfg.icon} text-2xl`;
    badge.innerText = cfg.dept;
    title.innerText = cfg.title;
}

function updateProfileUI(emp) {
    const av = getAvatarUrl(emp.avatar_url);
    document.getElementById('header-user-name').innerText = emp.full_name;
    document.getElementById('header-user-role').innerText = emp.role_designation;
    document.getElementById('header-user-avatar').src = av;

    document.getElementById('popover-user-name').innerText = emp.full_name;
    document.getElementById('popover-user-role').innerText = emp.role_designation;
    document.getElementById('popover-user-id').innerText = emp.employee_id;
    document.getElementById('popover-user-avatar').src = av;
}

async function executeDepartmentLogin() {
    await syncFromSupabase();
    let empId = vivaBypassUnlocked
        ? document.getElementById('viva-role-dropdown').value
        : document.getElementById('login-emp-id').value.trim().toUpperCase();
    const pass = document.getElementById('login-emp-pass').value;

    const emp = DB.employees.find(e => e.employee_id.toUpperCase() === empId);
    if (!emp) return showToast('Employee ID not found.', 'error');
    if (!vivaBypassUnlocked && !pass) return showToast('Please enter your password.', 'error');

    // Swap view behind the modal FIRST, then dissolve modal directly into workspace
    dissolveModalIntoView('user-login-modal', () => {
        currentLoggedInUser = emp;
        currentMode = 'portal';
        document.getElementById('view-gateway').classList.add('hidden');
        setTopBarState('expanded-portal');
        document.getElementById('comm-floating-Dock').classList.remove('hidden');
        updateProfileUI(emp);
        buildRoleIsolatedTabs(emp);
    });

    await writeImmutableAudit('USER_LOGIN', 'Employees', emp.employee_id, { name: emp.full_name, role: emp.role_designation });
    showToast(`Signed in as ${emp.full_name}`);
}

// ============================================================================
// 5. PATTERN ROOM KIOSK PASSWORD LOCK / UNLOCK (DIRECT TRANSITION)
// ============================================================================
function promptPatternRoomAccess() {
    setTopBarState('expanded-auth');
    kioskAuthMode = 'unlock';
    document.getElementById('kiosk-auth-title').innerText = 'Unlock Pattern Room Kiosk';
    document.getElementById('kiosk-auth-submit-btn').innerText = 'Unlock Kiosk';
    document.getElementById('kiosk-auth-password').value = '';
    document.getElementById('kiosk-pass-wrapper').classList.toggle('hidden', vivaBypassUnlocked);
    document.getElementById('kiosk-auth-modal').classList.remove('hidden');
}

async function executeKioskAuthAction() {
    const pass = document.getElementById('kiosk-auth-password').value.trim();
    if (!vivaBypassUnlocked && !pass) {
        return showToast('Please enter the Pattern Room password.', 'error');
    }

    if (kioskAuthMode === 'unlock') {
        await syncFromSupabase();
        dissolveModalIntoView('kiosk-auth-modal', () => {
            currentMode = 'terminal';
            currentLoggedInUser = null;
            document.getElementById('view-gateway').classList.add('hidden');
            setTopBarState('expanded-terminal');
            document.getElementById('comm-floating-Dock').classList.add('hidden');
            document.getElementById('role-workspace-tabs').innerHTML = '';
            hideAllMainViews();
            document.getElementById('view-tracker').classList.remove('hidden');
            renderPatternGrid();
        });
        await writeImmutableAudit('KIOSK_UNLOCKED', 'Pattern_Room', 'TERMINAL', { status: 'Unlocked for Shift' });
        showToast('Pattern Room Kiosk unlocked.');
    } else {
        dissolveModalIntoView('kiosk-auth-modal', () => {
            returnToWelcomeScreenImmediate();
        });
        await writeImmutableAudit('KIOSK_SIGNED_OUT', 'Pattern_Room', 'TERMINAL', { status: 'Signed Out' });
        showToast('Pattern Room Kiosk signed out.');
    }
}

function triggerCredentialedLogout() {
    if (currentMode === 'terminal') {
        kioskAuthMode = 'logout';
        document.getElementById('kiosk-auth-title').innerText = 'Sign Out Pattern Room Kiosk';
        document.getElementById('kiosk-auth-submit-btn').innerText = 'Confirm Sign Out';
        document.getElementById('kiosk-auth-password').value = '';
        document.getElementById('kiosk-pass-wrapper').classList.toggle('hidden', vivaBypassUnlocked);
        document.getElementById('kiosk-auth-modal').classList.remove('hidden');
        return;
    }

    animateStageTransition(() => {
        returnToWelcomeScreenImmediate();
        showToast('Signed out.');
    });
}

function returnToWelcomeScreen() {
    animateStageTransition(() => {
        returnToWelcomeScreenImmediate();
    });
}

function returnToWelcomeScreenImmediate() {
    currentMode = 'gateway';
    currentLoggedInUser = null;
    hideAllMainViews();
    closeProfilePopover();
    closeCommDrawer();
    setTopBarState('compact');
    document.getElementById('comm-floating-Dock').classList.add('hidden');
    document.getElementById('view-gateway').classList.remove('hidden');
}

// ============================================================================
// 6. PROFILE PICTURE CHANGE REQUEST (PENCIL ICON -> SUPPORT TEAM APPROVAL)
// ============================================================================
async function submitAvatarChangeRequest(fileInput) {
    if (!currentLoggedInUser) return;
    const imgData = await readAndCompressImage(fileInput, 240);
    if (!imgData) return;

    const payload = {
        sender_id: currentLoggedInUser.employee_id,
        sender_name: currentLoggedInUser.full_name,
        sender_role: currentLoggedInUser.role_designation,
        receiver_id: 'DT-C-CST-01',
        receiver_name: 'Shehani Mel',
        receiver_role: 'CDMS Support Team',
        protocol_category: 'Avatar Request',
        linked_reference_id: currentLoggedInUser.employee_id,
        subject_line: `Profile Photo Update Request (${currentLoggedInUser.full_name})`,
        message_body: 'Uploaded new staff profile photo for Support Team verification.',
        comm_status: 'Pending Approval',
        resolution_note: imgData
    };

    const { error } = await supa.from('department_communications').insert([payload]);
    if (error) return showToast(error.message, 'error');
    await writeImmutableAudit('REQUEST_AVATAR_UPDATE', 'Employees', currentLoggedInUser.employee_id, { requested_by: currentLoggedInUser.full_name });
    await syncFromSupabase();
    closeProfilePopover();
    showToast('Profile picture request sent to CDMS Support Team.');
}

async function resolveAvatarRequest(commId, empId, decision) {
    const req = DB.department_communications.find(c => c.comm_id === commId);
    if (!req) return;

    if (decision === 'Approved' && req.resolution_note) {
        await supa.from('employees').update({ avatar_url: req.resolution_note }).eq('employee_id', empId);
    }
    await supa.from('department_communications').update({ comm_status: decision }).eq('comm_id', commId);
    await writeImmutableAudit(`AVATAR_${decision.toUpperCase()}`, 'Employees', empId, { comm_id: commId });
    await syncFromSupabase();
    renderAdminPortal();
    showToast(decision === 'Approved' ? `Accepted new profile photo for ${empId}.` : `Rejected photo request.`);
}

// ============================================================================
// 7. ROLE-ISOLATED WORKSPACE NAVIGATION
// ============================================================================
function buildRoleIsolatedTabs(emp) {
    const id = emp.employee_id.toUpperCase();
    const nav = document.getElementById('role-workspace-tabs');
    let tabs = [];

    if (id.startsWith('DH')) {
        tabs = [
            { key: 'dept-head', label: 'Overview' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('CSE') || id.startsWith('CS-')) {
        tabs = [
            { key: 'supervisor', label: 'Shift Matrix' },
            { key: 'supply', label: 'Orders & RMW' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('DDC') || id.startsWith('CAD')) {
        tabs = [
            { key: 'design-cad', label: 'Styles & CAD' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('PR-')) {
        tabs = [
            { key: 'design-cad', label: 'Register Items' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('SDC') || id.startsWith('RMW')) {
        tabs = [
            { key: 'supply', label: 'Orders & Dispatch' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('CQC') || id.startsWith('QCI')) {
        tabs = [
            { key: 'qc', label: 'Quality Control' },
            { key: 'reports', label: 'Reports' }
        ];
    } else {
        tabs = [
            { key: 'admin', label: 'Admin & Support' },
            { key: 'reports', label: 'Reports & Database' }
        ];
    }

    nav.innerHTML = tabs.map(t => `
        <button type="button" onclick="switchPortalView('${t.key}')" id="nav-btn-${t.key}" class="role-tab px-3.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-100 transition-all">
            ${t.label}
        </button>
    `).join('');

    switchPortalView(tabs[0].key);
}

function hideAllMainViews() {
    ['view-tracker', 'view-dept-head', 'view-supervisor', 'view-design-cad', 'view-supply', 'view-qc', 'view-admin', 'view-reports'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
}

async function switchPortalView(viewKey) {
    hideAllMainViews();
    document.querySelectorAll('.role-tab').forEach(b => {
        b.className = 'role-tab px-3.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-100 transition-all';
    });
    const activeBtn = document.getElementById(`nav-btn-${viewKey}`);
    if (activeBtn) {
        activeBtn.className = 'role-tab px-3.5 py-1.5 rounded-lg text-xs font-bold bg-zinc-900 text-white transition-all';
    }

    const targetEl = document.getElementById(`view-${viewKey}`);
    targetEl.classList.remove('hidden');
    targetEl.classList.add('fade-in');

    if (viewKey === 'tracker') renderPatternGrid();
    if (viewKey === 'dept-head') renderDeptHeadPortal();
    if (viewKey === 'supervisor') renderSupervisorPortal();
    if (viewKey === 'design-cad') renderDesignCadPortal();
    if (viewKey === 'supply') renderSupplyPortal();
    if (viewKey === 'qc') renderQcPortal();
    if (viewKey === 'admin') renderAdminPortal();
    if (viewKey === 'reports') { populateReportGroupFilter(); renderGroupedReport(); }
}

// ============================================================================
// 8. GOOGLE-STYLE PATTERN ROOM (NO-DATA PLACEHOLDERS UNLESS UPLOADED)
// ============================================================================
function handlePatternSearch() {
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    document.getElementById('clearBtn').classList.toggle('hidden', q.length === 0);
    renderPatternGrid(q);
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    handlePatternSearch();
}

function renderPatternCardHtml(p) {
    const badgeStyle = (st) => {
        if (st === 'Available in Room') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        if (st === 'Active on Line') return 'bg-blue-50 text-blue-700 border-blue-200';
        if (st.includes('Locked')) return 'bg-amber-50 text-amber-700 border-amber-200';
        return 'bg-rose-50 text-rose-700 border-rose-200';
    };

    return `
        <div onclick="openScannerForAsset('${p.asset_id}')" class="product-card bg-white rounded-2xl border border-zinc-200 overflow-hidden cursor-pointer flex flex-col justify-between">
            <div>
                <div class="h-40 w-full bg-zinc-100 relative overflow-hidden border-b border-zinc-100">
                    <img src="${getItemImageUrl(p.image_url)}" class="w-full h-full object-cover" alt="${p.model_name}">
                    <span class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-white/95 text-zinc-800 border border-zinc-200">${p.tooling_type}</span>
                    <span class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${badgeStyle(p.operational_status)}">${p.operational_status}</span>
                </div>
                <div class="p-4">
                    <div class="flex justify-between items-center text-[11px] font-medium text-zinc-500 mb-0.5">
                        <span>${p.brand_buyer}</span>
                        <span>${p.style_code}</span>
                    </div>
                    <h3 class="font-bold text-sm text-zinc-900">${p.model_name}</h3>
                    <div class="mt-2 flex items-center gap-2 text-xs text-zinc-600">
                        <span class="px-2 py-0.5 rounded bg-zinc-100 font-mono font-semibold text-zinc-800">${p.asset_id}</span>
                        <span class="px-2 py-0.5 rounded bg-zinc-100 font-medium">Size ${p.size_category}</span>
                    </div>
                </div>
            </div>
            <div class="px-4 py-2.5 bg-zinc-50 border-t border-zinc-100 flex justify-between items-center text-xs text-zinc-600">
                <span>${p.storage_location}</span>
                <span class="font-semibold text-zinc-900">Select</span>
            </div>
        </div>
    `;
}

function renderPatternGrid(query = '') {
    let list = DB.pattern_assets;
    if (query) {
        list = list.filter(p =>
            p.asset_id.toLowerCase().includes(query) ||
            p.model_name.toLowerCase().includes(query) ||
            p.brand_buyer.toLowerCase().includes(query) ||
            p.style_code.toLowerCase().includes(query) ||
            p.storage_location.toLowerCase().includes(query)
        );
    }

    const activeItems = list.filter(p => p.operational_status === 'Active on Line');
    const inactiveItems = list.filter(p => p.operational_status !== 'Active on Line');

    document.getElementById('count-active-patterns').innerText = `${activeItems.length} items`;
    document.getElementById('count-inactive-patterns').innerText = `${inactiveItems.length} items`;

    document.getElementById('tracker-grid-active').innerHTML = activeItems.map(renderPatternCardHtml).join('') ||
        '<p class="text-xs text-zinc-400 col-span-full py-4">No matching active items.</p>';
    document.getElementById('tracker-grid-inactive').innerHTML = inactiveItems.map(renderPatternCardHtml).join('') ||
        '<p class="text-xs text-zinc-400 col-span-full py-4">No matching inventory items.</p>';
}

function openScannerForAsset(assetId) {
    const asset = DB.pattern_assets.find(a => a.asset_id === assetId);
    if (!asset) return;
    document.getElementById('verify-modal').classList.remove('hidden');
    const area = document.getElementById('modal-dynamic-area');
    const itemImg = getItemImageUrl(asset.image_url);

    if (['Inspection Flagged', 'Decommissioned', 'Pending Removal'].includes(asset.operational_status)) {
        area.innerHTML = `
            <div class="text-center py-6 space-y-3">
                <img src="${itemImg}" class="w-40 h-28 object-cover rounded-xl mx-auto border">
                <h4 class="text-base font-bold text-rose-600 uppercase">Item Restricted (${asset.operational_status})</h4>
                <p class="text-xs text-zinc-600">${asset.asset_id} (${asset.model_name}) cannot be checked out.</p>
            </div>
        `;
        return;
    }

    if (asset.operational_status === 'Active on Line') {
        area.innerHTML = `
            <div class="space-y-4 text-center">
                <img src="${itemImg}" class="w-full h-44 object-cover rounded-xl border">
                <h4 class="text-lg font-bold text-zinc-900">${asset.asset_id} (${asset.model_name})</h4>
                <p class="text-xs text-zinc-600">Checked out by: <strong>${asset.borrowed_by_id || 'Floor Staff'}</strong></p>
                <button type="button" onclick="executeAssetReturn('${asset.asset_id}')" class="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-semibold py-3 rounded-xl text-xs uppercase tracking-wider">
                    Confirm Return to ${asset.storage_location}
                </button>
            </div>
        `;
        return;
    }

    const floorOps = DB.employees.filter(e => e.employee_id.startsWith('CW-'));
    const todayStr = new Date().toISOString().split('T')[0];

    area.innerHTML = `
        <div class="space-y-4">
            <div class="flex gap-3 items-center p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                <img src="${itemImg}" class="w-20 h-14 rounded-lg object-cover border">
                <div>
                    <p class="text-xs font-medium text-zinc-500">${asset.brand_buyer} (${asset.style_code})</p>
                    <h4 class="text-base font-bold text-zinc-900">${asset.model_name} (${asset.asset_id})</h4>
                    <p class="text-xs text-zinc-500">Size ${asset.size_category} / ${asset.storage_location}</p>
                </div>
            </div>
            <div>
                <label class="text-xs font-semibold text-zinc-600 block mb-1">Shift</label>
                <select id="scan-shift-select" class="w-full p-2.5 bg-zinc-50 border border-zinc-300 rounded-xl text-xs font-semibold">
                    <option value="Morning">Morning (06:00 to 14:00)</option>
                    <option value="Afternoon">Afternoon (14:00 to 22:00)</option>
                    <option value="Night">Night (22:00 to 06:00)</option>
                </select>
            </div>
            <div>
                <label class="text-xs font-semibold text-zinc-600 block mb-1.5">Operator Badge</label>
                <div class="space-y-1.5 max-h-56 overflow-y-auto custom-scroll pr-1">
                    ${floorOps.map(op => {
                        const isSched = DB.shift_assignments.some(s => s.borrower_id === op.employee_id && s.assigned_date === todayStr);
                        return `
                            <button type="button" onclick="executeAssetBorrow('${asset.asset_id}', '${op.employee_id}')" class="w-full text-left p-2.5 rounded-xl bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-xs flex justify-between items-center transition-colors">
                                <span class="flex items-center gap-2">
                                    <img src="${getAvatarUrl(op.avatar_url)}" class="w-7 h-7 rounded-full object-cover border border-zinc-300">
                                    <span><strong class="text-zinc-900">${op.full_name}</strong> <span class="text-zinc-400">(${op.employee_id})</span></span>
                                </span>
                                <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${isSched ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">${isSched ? 'Scheduled' : '15m Lock'}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

async function executeAssetBorrow(assetId, operatorId) {
    const shift = document.getElementById('scan-shift-select').value;
    const todayStr = new Date().toISOString().split('T')[0];
    const isScheduled = DB.shift_assignments.some(
        s => s.borrower_id === operatorId && s.assigned_date === todayStr && s.shift_type === shift
    );

    if (!isScheduled) {
        await supa.from('pattern_assets').update({
            operational_status: 'Locked_Pending (15m)',
            borrowed_by_id: operatorId
        }).eq('asset_id', assetId);

        await supa.from('pending_requests').insert([{
            borrower_id: operatorId,
            pattern_id: assetId,
            requested_shift: shift,
            requested_date: todayStr,
            request_status: 'Pending'
        }]);

        await writeImmutableAudit('15M_MUTEX_LOCK', 'Pattern_Assets', assetId, { operator: operatorId, shift });
        await syncFromSupabase();
        closeVerifyModal();
        handlePatternSearch();
        startMutexBarCountdown(assetId, operatorId, shift);
        showToast(`Unscheduled worker: ${assetId} locked for 15 mins.`, 'error');
        return;
    }

    await supa.from('pattern_assets').update({
        operational_status: 'Active on Line',
        borrowed_by_id: operatorId,
        shift_checkout: shift,
        checkout_time: new Date().toISOString(),
        last_used_date: todayStr
    }).eq('asset_id', assetId);

    await writeImmutableAudit('BORROW_ASSET', 'Pattern_Assets', assetId, { operator: operatorId, shift });
    await syncFromSupabase();
    closeVerifyModal();
    handlePatternSearch();
    showToast(`Checked out ${assetId} to ${operatorId}.`);
}

async function executeAssetReturn(assetId) {
    await supa.from('pattern_assets').update({
        operational_status: 'Available in Room',
        borrowed_by_id: null,
        shift_checkout: null,
        checkout_time: null
    }).eq('asset_id', assetId);

    await writeImmutableAudit('RETURN_ASSET', 'Pattern_Assets', assetId, { status: 'Available in Room' });
    await syncFromSupabase();
    closeVerifyModal();
    handlePatternSearch();
    showToast(`${assetId} returned to Pattern Room.`);
}

function startMutexBarCountdown(assetId, operatorId, shift) {
    const bar = document.getElementById('mutex-bar');
    const msg = document.getElementById('mutex-msg');
    const timer = document.getElementById('mutex-timer');
    const btn = document.getElementById('mutex-action-btn');

    bar.classList.remove('hidden');
    btn.classList.add('hidden');
    msg.innerText = `15-Min Lock on ${assetId} (${operatorId}) : Awaiting Supervisor Approval`;

    let secs = 900;
    if (mutexPollInterval) clearInterval(mutexPollInterval);
    mutexPollInterval = setInterval(async () => {
        secs--;
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        timer.innerText = `${m}:${s}`;

        if (secs % 4 === 0) {
            await syncFromSupabase();
            const req = DB.pending_requests.find(r => r.pattern_id === assetId && r.borrower_id === operatorId);
            if (req && req.request_status === 'Approved') {
                clearInterval(mutexPollInterval);
                timer.innerText = 'APPROVED';
                msg.innerText = `Supervisor Approved ${assetId}`;
                btn.classList.remove('hidden');
                btn.onclick = () => { bar.classList.add('hidden'); handlePatternSearch(); };
            } else if (req && req.request_status === 'Declined') {
                clearInterval(mutexPollInterval);
                timer.innerText = 'DENIED';
                setTimeout(() => bar.classList.add('hidden'), 3000);
            }
        }
    }, 1000);
}

function dismissMutexBar() {
    closeModal('mutex-bar');
}

// ============================================================================
// 9. DEPARTMENT HEAD READ-ONLY OVERSIGHT PORTAL
// ============================================================================
async function renderDeptHeadPortal() {
    await syncFromSupabase();
    document.getElementById('dh-kpi-total').innerText = DB.pattern_assets.length;
    document.getElementById('dh-kpi-avail').innerText = DB.pattern_assets.filter(p => p.operational_status === 'Available in Room').length;
    document.getElementById('dh-kpi-active').innerText = DB.pattern_assets.filter(p => p.operational_status === 'Active on Line').length;
    document.getElementById('dh-kpi-flagged').innerText = DB.pattern_assets.filter(p => ['Inspection Flagged', 'Pending Removal', 'Decommissioned'].includes(p.operational_status)).length;

    const dhReqs = DB.department_communications.filter(c => c.receiver_id === 'DH-01' && c.comm_status === 'Pending Approval');
    document.getElementById('dh-kpi-approvals').innerText = dhReqs.length;

    document.getElementById('dh-approvals-list').innerHTML = dhReqs.map(c => `
        <div class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 space-y-2 text-xs">
            <div class="flex justify-between items-start">
                <span class="px-2 py-0.5 rounded bg-zinc-200 text-zinc-800 font-bold text-[10px] uppercase">${c.protocol_category}</span>
                <span class="font-mono text-[11px] text-zinc-500">Ref: ${c.linked_reference_id}</span>
            </div>
            <p class="font-bold text-zinc-900">${c.subject_line}</p>
            <p class="text-zinc-600">${c.message_body}</p>
            <p class="text-[11px] text-zinc-500">From: <strong>${c.sender_name}</strong> (${c.sender_role})</p>
            <div class="grid grid-cols-2 gap-2 pt-1">
                <button type="button" onclick="resolveCommItem(${c.comm_id}, 'Approved')" class="bg-zinc-900 text-white py-1.5 rounded-lg font-semibold">Approve</button>
                <button type="button" onclick="resolveCommItem(${c.comm_id}, 'Rejected')" class="bg-zinc-200 text-zinc-800 py-1.5 rounded-lg font-semibold">Reject</button>
            </div>
        </div>
    `).join('') || '<p class="text-xs text-zinc-400 py-6 text-center">No pending requests.</p>';

    const activeAssets = DB.pattern_assets.filter(p => p.operational_status === 'Active on Line');
    document.getElementById('dh-active-processes').innerHTML = activeAssets.map(a => {
        const worker = DB.employees.find(e => e.employee_id === a.borrowed_by_id);
        return `
            <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center gap-3 text-xs">
                <img src="${getItemImageUrl(a.image_url)}" class="w-12 h-9 rounded-lg object-cover border">
                <div class="flex-1">
                    <p class="font-bold text-zinc-900">${a.model_name} (${a.asset_id})</p>
                    <p class="text-zinc-500">${worker ? worker.full_name : (a.borrowed_by_id || 'Assigned')} / ${a.shift_checkout || 'Morning'}</p>
                </div>
                <span class="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold text-[10px]">Active</span>
            </div>
        `;
    }).join('');

    document.getElementById('dh-qc-oversight').innerHTML = DB.qc_inspection_logs.map(l => `
        <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs space-y-1">
            <div class="flex justify-between font-bold text-zinc-900">
                <span>${l.qc_log_id} (${l.defect_code})</span>
                <span class="text-rose-600">${l.asset_id}</span>
            </div>
            <p class="text-zinc-600">${l.production_line} / Plies: ${l.ruined_ply_count} / Resolver: ${l.resolver_id}</p>
            <span class="inline-block px-2 py-0.5 rounded bg-white border border-zinc-200 text-zinc-700 text-[10px] font-semibold">${l.resolution_status}</span>
        </div>
    `).join('');
}

// ============================================================================
// 10. SUPERVISOR COMMAND & 7-DAY SHIFT MATRIX
// ============================================================================
async function renderSupervisorPortal() {
    await syncFromSupabase();
    const pending = DB.pending_requests.filter(r => r.request_status === 'Pending');
    document.getElementById('ticket-count-badge').innerText = pending.length;

    document.getElementById('supervisor-queue-list').innerHTML = pending.map(r => {
        const emp = DB.employees.find(e => e.employee_id === r.borrower_id);
        return `
            <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs space-y-2">
                <div class="flex justify-between">
                    <strong class="text-zinc-900">${emp ? emp.full_name : r.borrower_id}</strong>
                    <span class="font-semibold text-zinc-700">${r.pattern_id} (${r.requested_shift})</span>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <button type="button" onclick="resolveMutexTicket(${r.request_id}, 'Approve')" class="bg-zinc-900 text-white py-1.5 rounded-lg font-semibold">Grant</button>
                    <button type="button" onclick="resolveMutexTicket(${r.request_id}, 'Decline')" class="bg-zinc-200 text-zinc-700 py-1.5 rounded-lg font-semibold">Deny</button>
                </div>
            </div>
        `;
    }).join('') || '<p class="text-xs text-zinc-400 text-center py-8">No pending tickets.</p>';

    const active = DB.pattern_assets.filter(p => p.operational_status === 'Active on Line');
    document.getElementById('active-deploy-badge').innerText = active.length;
    document.getElementById('supervisor-active-list').innerHTML = active.map(p => {
        const emp = DB.employees.find(e => e.employee_id === p.borrowed_by_id);
        return `
            <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs flex justify-between items-center">
                <div>
                    <p class="font-bold text-zinc-900">${p.asset_id} (${p.model_name})</p>
                    <p class="text-[11px] text-zinc-500">${emp ? emp.full_name : p.borrowed_by_id} / ${p.shift_checkout || 'Morning'}</p>
                </div>
                <span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[10px]">Active</span>
            </div>
        `;
    }).join('');

    const floorOps = DB.employees.filter(e => e.employee_id.startsWith('CW-'));
    document.getElementById('operator-pool').innerHTML = floorOps.map(op => {
        const locked = selectedOperatorForAssign === op.employee_id;
        return `
            <div onclick="lockOperatorForCalendar('${op.employee_id}')" class="p-2 rounded-xl border ${locked ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-zinc-50 text-zinc-900'} cursor-pointer flex items-center gap-2 text-xs">
                <img src="${getAvatarUrl(op.avatar_url)}" class="w-7 h-7 rounded-full object-cover shrink-0 border border-zinc-300">
                <div class="truncate">
                    <p class="font-bold truncate">${op.full_name}</p>
                    <p class="text-[10px] opacity-70">${op.work_location_zone}</p>
                </div>
            </div>
        `;
    }).join('');

    const grid = document.getElementById('calendar-grid');
    const shifts = ['Morning', 'Afternoon', 'Night'];
    let html = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        html += `
            <div class="bg-zinc-50 p-2.5 rounded-xl border border-zinc-200 flex flex-col gap-2">
                <div class="text-center font-bold text-xs text-zinc-800 border-b border-zinc-200 pb-1.5">${dayLabel}</div>
                ${shifts.map(sh => {
                    const assigned = DB.shift_assignments.filter(a => a.assigned_date === dateStr && a.shift_type === sh);
                    return `
                        <div onclick="tapDeployShift('${dateStr}', '${sh}')" class="min-h-[78px] p-2 rounded-lg bg-white border border-dashed border-zinc-300 hover:border-zinc-900 cursor-pointer flex flex-col gap-1">
                            <span class="text-[10px] font-semibold text-zinc-400 uppercase">${sh}</span>
                            ${assigned.map(a => {
                                const w = DB.employees.find(e => e.employee_id === a.borrower_id);
                                return `
                                    <div class="px-2 py-1 rounded bg-zinc-100 border border-zinc-200 text-[11px] font-semibold text-zinc-800 flex justify-between items-center">
                                        <span class="truncate">${w ? w.full_name.split(' ')[0] : a.borrower_id}</span>
                                        <button type="button" onclick="removeShiftSlot(${a.assignment_id}); event.stopPropagation();" class="text-zinc-400 hover:text-rose-600 ml-1">&times;</button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }
    grid.innerHTML = html;
}

function lockOperatorForCalendar(empId) {
    selectedOperatorForAssign = selectedOperatorForAssign === empId ? null : empId;
    const emp = DB.employees.find(e => e.employee_id === selectedOperatorForAssign);
    document.getElementById('selected-op-indicator').innerText = emp ? `Selected: ${emp.full_name}` : 'Tap Worker to Select';
    renderSupervisorPortal();
}

async function tapDeployShift(dateStr, shiftType) {
    if (!selectedOperatorForAssign) return showToast('Select an Operator from the Pool first.', 'error');
    const supId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'CS-L1-01';
    await supa.from('shift_assignments').insert([{
        borrower_id: selectedOperatorForAssign,
        supervisor_id: supId,
        assigned_date: dateStr,
        shift_type: shiftType,
        production_line: 'Line 1'
    }]);
    await writeImmutableAudit('ASSIGN_SHIFT', 'Shift_Assignments', selectedOperatorForAssign, { date: dateStr, shift: shiftType });
    await renderSupervisorPortal();
}

async function removeShiftSlot(id) {
    await supa.from('shift_assignments').delete().eq('assignment_id', id);
    await renderSupervisorPortal();
}

async function resolveMutexTicket(reqId, decision) {
    const req = DB.pending_requests.find(r => r.request_id === reqId);
    if (!req) return;
    if (decision === 'Approve') {
        await supa.from('pending_requests').update({ request_status: 'Approved' }).eq('request_id', reqId);
        await supa.from('shift_assignments').insert([{
            borrower_id: req.borrower_id,
            supervisor_id: 'CS-L1-01',
            assigned_date: req.requested_date,
            shift_type: req.requested_shift,
            production_line: 'Line 1'
        }]);
        await supa.from('pattern_assets').update({
            operational_status: 'Active on Line',
            borrowed_by_id: req.borrower_id,
            shift_checkout: req.requested_shift
        }).eq('asset_id', req.pattern_id);
        showToast(`Approved ${req.pattern_id}.`);
    } else {
        await supa.from('pending_requests').update({ request_status: 'Declined' }).eq('request_id', reqId);
        await supa.from('pattern_assets').update({
            operational_status: 'Available in Room',
            borrowed_by_id: null
        }).eq('asset_id', req.pattern_id);
        showToast(`Denied ${req.pattern_id}.`, 'error');
    }
    await writeImmutableAudit(`MUTEX_${decision.toUpperCase()}`, 'Pending_Requests', reqId, req);
    await renderSupervisorPortal();
}

// ============================================================================
// 11. DESIGN, CAD & PATTERN ROOM HUB (NO-DATA PLACEHOLDERS UNLESS UPLOADED)
// ============================================================================
async function renderDesignCadPortal() {
    await syncFromSupabase();
    const brands = DB.system_settings_audit.filter(s => s.record_type === 'PARAMETER' && s.category === 'Brand');
    const sizes = DB.system_settings_audit.filter(s => s.record_type === 'PARAMETER' && s.category === 'Size');
    const fabrics = DB.rmw_materials.filter(m => m.material_category === 'Cutting Floor Fabric');

    document.getElementById('cad-brand-select').innerHTML = brands.map(b => `<option value="${b.setting_value}">${b.setting_value}</option>`).join('');
    document.getElementById('cad-fabric-select').innerHTML = fabrics.map(f => `<option value="${f.material_code}">${f.material_code} (${f.target_brand_usage})</option>`).join('');
    document.getElementById('pat-style-select').innerHTML = DB.cad_markers.map(m => `<option value="${m.style_code}">${m.style_code} (${m.model_name})</option>`).join('');
    document.getElementById('pat-size-select').innerHTML = sizes.map(s => `<option value="${s.setting_value}">${s.setting_value}</option>`).join('');

    document.getElementById('cad-markers-mini-list').innerHTML = DB.cad_markers.map(m => `
        <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center gap-3 text-xs">
            <img src="${getItemImageUrl(m.sketch_url)}" class="w-14 h-10 rounded-lg object-cover border">
            <div class="flex-1">
                <p class="font-bold text-zinc-900">${m.model_name} (${m.style_code})</p>
                <p class="text-[11px] text-zinc-500">${m.brand_buyer} / ${m.cad_marker_id} / ${m.cutting_floor_fabric_code}</p>
            </div>
        </div>
    `).join('');

    const dormant = DB.pattern_assets.filter(p => ['Pending Removal', 'Decommissioned'].includes(p.operational_status));
    document.getElementById('inactive-patterns-alert-box').innerHTML = dormant.map(p => `
        <div class="p-2 rounded-lg bg-zinc-50 border border-zinc-200 flex justify-between items-center">
            <span><strong>${p.asset_id}</strong> (${p.model_name})</span>
            <span class="text-rose-600 font-bold text-[10px]">${p.operational_status}</span>
        </div>
    `).join('');
}

async function createStyleAndMarker() {
    const style = document.getElementById('cad-style-code').value.trim().toUpperCase();
    const brand = document.getElementById('cad-brand-select').value;
    const model = document.getElementById('cad-model-name').value.trim();
    const toolMat = document.getElementById('cad-tooling-mat').value;
    const fabCode = document.getElementById('cad-fabric-select').value;
    const sketchFile = document.getElementById('cad-sketch-file');

    if (!style || !model) return showToast('Enter Style Code and Model Name.', 'error');
    const uploadedImg = await readAndCompressImage(sketchFile);
    const mkId = `CAD-MK-${(DB.cad_markers.length + 1).toString().padStart(2, '0')}`;

    const newRow = {
        cad_marker_id: mkId,
        style_code: style,
        brand_buyer: brand,
        model_name: model,
        design_coordinator_id: 'DDC-C-01',
        cad_handler_id: 'CAD-C-CPH-01',
        cad_tooling_material_code: toolMat,
        cutting_floor_fabric_code: fabCode,
        marker_status: 'Approved',
        sketch_url: uploadedImg || ''
    };

    const { error } = await supa.from('cad_markers').insert([newRow]);
    if (error) return showToast(error.message, 'error');
    await writeImmutableAudit('CREATE_STYLE_MARKER', 'CAD_Markers', mkId, newRow);
    await renderDesignCadPortal();
    showToast(`Saved Style ${style} (${mkId}).`);
}

async function designAddFabricDirect() {
    const code = document.getElementById('new-fabric-code').value.trim().toUpperCase();
    const specs = document.getElementById('new-fabric-specs').value.trim();
    const brand = document.getElementById('cad-brand-select').value;
    if (!code || !specs) return showToast('Enter Fabric Code and Composition.', 'error');

    const newFab = {
        material_code: code,
        material_category: 'Cutting Floor Fabric',
        material_name_specs: specs,
        target_brand_usage: brand,
        rmw_storage_bay: `RMW-Bay-F${DB.rmw_materials.length + 1}`,
        managed_by_rmw_id: 'RMWC-C-01',
        lot_status: 'In Warehouse'
    };
    const { error } = await supa.from('rmw_materials').insert([newFab]);
    if (error) return showToast(error.message, 'error');
    await writeImmutableAudit('ADD_FABRIC_DIRECT', 'RMW_Materials', code, newFab);
    await renderDesignCadPortal();
    showToast(`Added ${code} to catalog.`);
}

async function registerNewPatternAsset() {
    const id = document.getElementById('pat-asset-id').value.trim().toUpperCase();
    const type = document.getElementById('pat-tooling-type').value;
    const styleCode = document.getElementById('pat-style-select').value;
    const size = document.getElementById('pat-size-select').value;
    const loc = document.getElementById('pat-rack-loc').value.trim() || 'Rack A-05';
    const photoInput = document.getElementById('pat-photo-file');

    if (!id) return showToast('Enter Asset ID.', 'error');
    const uploadedImg = await readAndCompressImage(photoInput);
    const styleObj = DB.cad_markers.find(m => m.style_code === styleCode) || { model_name: 'Custom Style', brand_buyer: 'Triumph' };

    const newAsset = {
        asset_id: id,
        tooling_type: type,
        model_name: styleObj.model_name,
        style_code: styleCode,
        brand_buyer: styleObj.brand_buyer,
        size_category: size,
        storage_location: loc,
        operational_status: 'Available in Room',
        image_url: uploadedImg || ''
    };

    const { error } = await supa.from('pattern_assets').insert([newAsset]);
    if (error) return showToast(error.message, 'error');
    await writeImmutableAudit('REGISTER_PATTERN_ASSET', 'Pattern_Assets', id, newAsset);

    const box = document.getElementById('pattern-qr-preview-box');
    const canvas = document.getElementById('pattern-qr-canvas');
    box.classList.remove('hidden');
    canvas.innerHTML = '';
    document.getElementById('pattern-qr-label-text').innerText = id;
    new QRCode(canvas, { text: id, width: 76, height: 76 });
    await renderDesignCadPortal();
    showToast(`Registered ${id}.`);
}

// ============================================================================
// 12. SEWING ORDERS & RMW WAREHOUSE DISPATCH
// ============================================================================
async function renderSupplyPortal() {
    await syncFromSupabase();
    document.getElementById('sew-style-select').innerHTML = DB.cad_markers.map(m => `<option value="${m.style_code}">${m.style_code} (${m.model_name})</option>`).join('');

    document.getElementById('sewing-orders-list').innerHTML = DB.cutting_orders.map(o => `
        <div class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 flex justify-between items-center text-xs">
            <div>
                <p class="font-bold text-zinc-900">${o.order_id} / Style ${o.style_code} (Size ${o.target_size})</p>
                <p class="text-zinc-500 mt-0.5">Qty: ${o.target_bundle_qty} / ${o.assigned_line}</p>
            </div>
            <span class="px-2.5 py-1 rounded font-bold text-[10px] ${o.priority_level === 'Urgent' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-zinc-200 text-zinc-800'}">${o.priority_level} / ${o.order_status}</span>
        </div>
    `).join('');

    document.getElementById('rmw-materials-list').innerHTML = DB.rmw_materials.map(m => `
        <div class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 flex justify-between items-center gap-3 text-xs">
            <div>
                <p class="font-bold text-zinc-900">${m.material_code} (${m.material_category})</p>
                <p class="text-zinc-600">${m.material_name_specs}</p>
                <p class="text-[11px] text-zinc-400">Bay: ${m.rmw_storage_bay} / Status: <strong class="text-zinc-800">${m.lot_status}</strong></p>
            </div>
            <button type="button" onclick="dispatchRmwMaterial('${m.material_code}')" class="bg-zinc-900 hover:bg-zinc-800 text-white px-3 py-1.5 rounded-lg font-semibold text-[11px] shrink-0">
                Dispatch
            </button>
        </div>
    `).join('');
}

async function submitSewingOrder() {
    const style = document.getElementById('sew-style-select').value;
    const size = document.getElementById('sew-size').value.trim() || '34B';
    const qty = parseInt(document.getElementById('sew-qty').value) || 1200;
    const prio = document.getElementById('sew-priority').value;
    const ordId = `ORD-${100 + DB.cutting_orders.length + 1}`;

    const newOrd = {
        order_id: ordId,
        style_code: style,
        sewing_coordinator_id: 'SDC-C-01',
        approved_by_exec_id: 'CSE-01',
        target_size: size,
        target_bundle_qty: qty,
        priority_level: prio,
        assigned_line: 'Line 1',
        order_status: 'Queued'
    };
    await supa.from('cutting_orders').insert([newOrd]);
    await writeImmutableAudit('CREATE_SEWING_ORDER', 'Cutting_Orders', ordId, newOrd);
    await renderSupplyPortal();
    showToast(`Submitted Cutting Order ${ordId}.`);
}

async function dispatchRmwMaterial(matCode) {
    const mat = DB.rmw_materials.find(m => m.material_code === matCode);
    if (!mat) return;
    const newStatus = mat.material_category.includes('CAD') ? 'Dispatched to CAD Room' : 'Dispatched to Cutting Floor';
    await supa.from('rmw_materials').update({ lot_status: newStatus }).eq('material_code', matCode);
    await writeImmutableAudit('DISPATCH_MATERIAL', 'RMW_Materials', matCode, { status: newStatus });
    await renderSupplyPortal();
    showToast(`Dispatched ${matCode}.`);
}

// ============================================================================
// 13. FLOOR QUALITY CONTROL (QC)
// ============================================================================
async function renderQcPortal() {
    await syncFromSupabase();
    document.getElementById('qc-asset-select').innerHTML = DB.pattern_assets.map(p => `<option value="${p.asset_id}">${p.asset_id} (${p.model_name})</option>`).join('');
    document.getElementById('qc-defect-select').innerHTML = DB.qc_defect_codes.map(d => `<option value="${d.defect_code}">${d.defect_code} (${d.defect_name_symptom})</option>`).join('');
    previewDefectAction();

    document.getElementById('qc-logs-list').innerHTML = DB.qc_inspection_logs.map(l => `
        <div class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 flex justify-between items-center gap-3 text-xs">
            <div>
                <p class="font-bold text-zinc-900">${l.qc_log_id} / ${l.defect_code} on ${l.asset_id} (${l.production_line})</p>
                <p class="text-zinc-500 mt-0.5">Inspector: ${l.inspector_id} / Resolver: <strong>${l.resolver_id}</strong> / Plies: ${l.ruined_ply_count}</p>
            </div>
            <div class="flex items-center gap-2">
                <span class="px-2.5 py-1 rounded text-[10px] font-bold ${l.resolution_status === 'Resolved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">${l.resolution_status}</span>
                ${l.resolution_status !== 'Resolved' ? `<button type="button" onclick="resolveQcLog('${l.qc_log_id}', '${l.asset_id}')" class="bg-zinc-900 text-white px-3 py-1 rounded-lg font-semibold text-[11px]">Mark Fixed</button>` : ''}
            </div>
        </div>
    `).join('');
}

function previewDefectAction() {
    const code = document.getElementById('qc-defect-select').value;
    const def = DB.qc_defect_codes.find(d => d.defect_code === code);
    if (!def) return;
    document.getElementById('qc-action-preview').innerHTML = `
        <p><strong>Category:</strong> ${def.fault_category} (${def.severity_level})</p>
        <p><strong>Status:</strong> ${def.target_asset_status} / <strong>Resolver:</strong> ${def.assigned_resolver_role_id}</p>
        <p><strong>Action:</strong> ${def.mandatory_system_action}</p>
    `;
}

async function submitQcDefectFlag() {
    const assetId = document.getElementById('qc-asset-select').value;
    const defCode = document.getElementById('qc-defect-select').value;
    const line = document.getElementById('qc-line-select').value;
    const plies = parseInt(document.getElementById('qc-ruined-plies').value) || 25;
    const def = DB.qc_defect_codes.find(d => d.defect_code === defCode);

    if (def.target_asset_status !== 'Active on Line (No Lock)') {
        await supa.from('pattern_assets').update({ operational_status: def.target_asset_status }).eq('asset_id', assetId);
    }

    const logId = `QCL-${500 + DB.qc_inspection_logs.length + 1}`;
    const newLog = {
        qc_log_id: logId,
        asset_id: assetId,
        defect_code: defCode,
        inspector_id: def.reported_by_role_id,
        resolver_id: def.assigned_resolver_role_id,
        production_line: line,
        ruined_ply_count: plies,
        resolution_status: `Open (${def.target_asset_status})`
    };

    await supa.from('qc_inspection_logs').insert([newLog]);
    await writeImmutableAudit('QC_DEFECT_FLAG', 'QC_Inspection_Logs', logId, newLog);
    await renderQcPortal();
    showToast(`Logged ${defCode} on ${assetId}.`, 'error');
}

async function resolveQcLog(logId, assetId) {
    await supa.from('qc_inspection_logs').update({ resolution_status: 'Resolved' }).eq('qc_log_id', logId);
    await supa.from('pattern_assets').update({ operational_status: 'Available in Room' }).eq('asset_id', assetId);
    await writeImmutableAudit('QC_RESOLVED', 'QC_Inspection_Logs', logId, { asset_id: assetId, status: 'Resolved' });
    await renderQcPortal();
    showToast(`Resolved ${logId}.`);
}

// ============================================================================
// 14. DIGITAL TEAM ADMIN, SUPPORT PHOTO APPROVALS & 400x100 LOGOS
// ============================================================================
async function renderAdminPortal() {
    await syncFromSupabase();
    const uniqueRoles = [...new Set(DB.employees.map(e => e.role_designation))];
    document.getElementById('reg-emp-role').innerHTML = uniqueRoles.map(r => `<option value="${r}">${r}</option>`).join('');

    const avatarReqs = DB.department_communications.filter(
        c => c.protocol_category === 'Avatar Request' && c.comm_status === 'Pending Approval'
    );
    document.getElementById('support-avatar-requests-list').innerHTML = avatarReqs.map(r => `
        <div class="p-3 rounded-xl bg-white border border-zinc-200 flex items-center justify-between gap-3 text-xs">
            <div class="flex items-center gap-2.5">
                <img src="${getAvatarUrl(r.resolution_note)}" class="w-10 h-10 rounded-full object-cover border border-zinc-300">
                <div>
                    <p class="font-bold text-zinc-900">${r.sender_name}</p>
                    <p class="text-[10px] text-zinc-500">${r.sender_id} / ${r.sender_role}</p>
                </div>
            </div>
            <div class="flex gap-1.5">
                <button type="button" onclick="resolveAvatarRequest(${r.comm_id}, '${r.sender_id}', 'Approved')" class="bg-zinc-900 text-white px-2.5 py-1 rounded-lg font-semibold text-[11px]">Accept</button>
                <button type="button" onclick="resolveAvatarRequest(${r.comm_id}, '${r.sender_id}', 'Rejected')" class="bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-lg font-semibold text-[11px]">Reject</button>
            </div>
        </div>
    `).join('') || '<p class="text-xs text-zinc-400 py-3">No pending profile photo requests.</p>';

    document.getElementById('admin-emp-tbody').innerHTML = DB.employees.map(e => `
        <tr class="hover:bg-zinc-50">
            <td class="p-2.5 flex items-center gap-2.5">
                <img src="${getAvatarUrl(e.avatar_url)}" class="w-7 h-7 rounded-full object-cover border border-zinc-300">
                <div>
                    <p class="font-bold text-zinc-900">${e.full_name}</p>
                    <p class="text-[10px] text-zinc-500">${e.role_designation}</p>
                </div>
            </td>
            <td class="p-2.5 font-mono text-zinc-600">${e.employee_id}</td>
            <td class="p-2.5">${e.department}</td>
            <td class="p-2.5">${e.work_location_zone}</td>
            <td class="p-2.5 text-right">
                <button type="button" onclick="removeEmployeeWithImmutableLog('${e.employee_id}')" class="text-zinc-500 hover:text-rose-600 text-[11px] font-semibold">Remove</button>
            </td>
        </tr>
    `).join('');

    const params = DB.system_settings_audit.filter(s => s.record_type === 'PARAMETER');
    document.getElementById('system-settings-list').innerHTML = params.map(p => `
        <li class="p-2.5 rounded-xl bg-white border border-zinc-200 flex justify-between items-center">
            <span><strong>${p.category}:</strong> ${p.setting_value} ${p.prefix_data ? `(${p.prefix_data})` : ''}</span>
            <button type="button" onclick="deleteSystemParam(${p.record_id})" class="text-zinc-400 hover:text-rose-600"><i class="ph-bold ph-trash"></i></button>
        </li>
    `).join('');

    document.getElementById('audit-count-pill').innerText = `${DB.immutable_audit_logs.length} Rows`;
    document.getElementById('immutable-audit-tbody').innerHTML = DB.immutable_audit_logs.map(a => `
        <tr class="hover:bg-zinc-50">
            <td class="p-2.5 font-bold text-zinc-900">#${a.audit_id}</td>
            <td class="p-2.5 text-zinc-500">${new Date(a.created_at).toLocaleString()}</td>
            <td class="p-2.5"><strong>${a.actor_name}</strong> (${a.actor_role})</td>
            <td class="p-2.5"><span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 font-bold">${a.action_verb}</span></td>
            <td class="p-2.5">${a.target_entity} (${a.target_id})</td>
            <td class="p-2.5 text-zinc-500 truncate max-w-xs">${a.immutable_snapshot}</td>
        </tr>
    `).join('');
}

function switchAdminSubTab(tab) {
    ['emp', 'params', 'records'].forEach(t => {
        document.getElementById(`admin-panel-${t}`).classList.add('hidden');
        document.getElementById(`adm-sub-${t}`).className = 'px-4 py-2 rounded-xl bg-zinc-100 text-zinc-700 hover:bg-zinc-200';
    });
    document.getElementById(`admin-panel-${tab}`).classList.remove('hidden');
    document.getElementById(`adm-sub-${tab}`).className = 'px-4 py-2 rounded-xl bg-zinc-900 text-white';
}

async function registerNewEmployee() {
    const id = document.getElementById('reg-emp-id').value.trim().toUpperCase();
    const name = document.getElementById('reg-emp-name').value.trim();
    const dept = document.getElementById('reg-emp-dept').value;
    const role = document.getElementById('reg-emp-role').value;
    const zone = document.getElementById('reg-emp-zone').value.trim() || 'Cutting Floor';
    const photoInput = document.getElementById('reg-emp-photo');

    if (!id || !name) return showToast('Enter Employee ID and Full Name.', 'error');
    const avatarData = await readAndCompressImage(photoInput, 220);

    const newEmp = {
        employee_id: id,
        full_name: name,
        department: dept,
        role_designation: role,
        work_location_zone: zone,
        active_checkout_count: 0,
        avatar_url: avatarData || ''
    };

    const { error } = await supa.from('employees').insert([newEmp]);
    if (error) return showToast(error.message, 'error');
    await writeImmutableAudit('REGISTER_EMPLOYEE', 'Employees', id, { id, name, dept, role, zone });

    const box = document.getElementById('emp-qr-preview-box');
    box.innerHTML = `<div class="p-3 bg-white rounded-xl border border-zinc-300 inline-block"><div id="emp-qr-canvas"></div><p class="text-xs font-bold mt-1">${name}</p></div>`;
    new QRCode(document.getElementById('emp-qr-canvas'), { text: id, width: 80, height: 80 });

    await renderAdminPortal();
    showToast(`Registered ${name}.`);
}

async function removeEmployeeWithImmutableLog(empId) {
    const target = DB.employees.find(e => e.employee_id === empId);
    if (!target) return;
    await writeImmutableAudit('PURGE_EMPLOYEE_BACKUP', 'Employees', empId, target);
    await supa.from('employees').delete().eq('employee_id', empId);
    await renderAdminPortal();
    showToast(`Removed ${empId} and logged backup.`);
}

async function addSystemSetting() {
    const cat = document.getElementById('sys-cat').value;
    const val = document.getElementById('sys-val').value.trim();
    const prefix = document.getElementById('sys-prefix').value.trim().toUpperCase();
    if (!val) return showToast('Enter parameter value.', 'error');

    const row = {
        record_type: 'PARAMETER',
        category: cat,
        setting_value: val,
        prefix_data: prefix,
        requested_by_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'DT-C-CA-01',
        request_status: 'Active'
    };
    await supa.from('system_settings_audit').insert([row]);
    await writeImmutableAudit('ADD_PARAMETER', 'System_Settings_Audit', val, row);
    document.getElementById('sys-val').value = '';
    await renderAdminPortal();
    showToast(`Saved ${cat}: ${val}`);
}

async function deleteSystemParam(recId) {
    const target = DB.system_settings_audit.find(s => s.record_id === recId);
    await writeImmutableAudit('REMOVE_PARAMETER', 'System_Settings_Audit', recId, target || {});
    await supa.from('system_settings_audit').delete().eq('record_id', recId);
    await renderAdminPortal();
}

async function uploadBrandLogo(inputEl, logoRefKey) {
    const dataUrl = await readAndCompressImage(inputEl, 400);
    if (!dataUrl) return;

    await supa.from('department_communications').delete().eq('linked_reference_id', logoRefKey);
    const { error } = await supa.from('department_communications').insert([{
        sender_id: 'DT-C-CA-01',
        sender_name: 'Ashan Mendis',
        sender_role: 'CDMS Admins',
        receiver_id: 'DT-C-CA-01',
        receiver_name: 'System Header',
        receiver_role: 'CDMS Admins',
        protocol_category: 'System Logo',
        linked_reference_id: logoRefKey,
        subject_line: logoRefKey,
        message_body: 'Brand Logo Asset (400x100)',
        comm_status: 'Active',
        resolution_note: dataUrl
    }]);

    if (error) return showToast(error.message, 'error');
    await syncFromSupabase();
    showToast('Logo updated on top bar and reports.');
}

function applyCustomLogosFromDB() {
    const masRec = DB.department_communications.find(c => c.linked_reference_id === 'LOGO_MAS' && c.resolution_note);
    const bodyRec = DB.department_communications.find(c => c.linked_reference_id === 'LOGO_BODYLINE' && c.resolution_note);

    if (masRec) {
        const img = document.getElementById('top-mas-logo');
        const fb = document.getElementById('top-mas-fallback');
        if (img) { img.src = masRec.resolution_note; img.classList.remove('hidden'); }
        if (fb) fb.classList.add('hidden');
    }
    if (bodyRec) {
        const img = document.getElementById('top-bodyline-logo');
        const fb = document.getElementById('top-bodyline-fallback');
        if (img) { img.src = bodyRec.resolution_note; img.classList.remove('hidden'); }
        if (fb) fb.classList.add('hidden');
    }
}

// ============================================================================
// 15. PROTOCOL COMMUNICATOR & APPROVAL ENGINE
// ============================================================================
function updateCommUnreadBadge() {
    if (!currentLoggedInUser) return;
    const myId = currentLoggedInUser.employee_id;
    const pendingForMe = DB.department_communications.filter(
        c => c.receiver_id === myId && c.comm_status === 'Pending Approval' && c.protocol_category !== 'System Logo'
    ).length;
    document.getElementById('comm-unread-badge').innerText = pendingForMe;
}

function toggleCommDrawer() {
    const win = document.getElementById('comm-drawer-window');
    win.classList.toggle('hidden');
    if (!win.classList.contains('hidden')) switchCommTab('inbox');
}

function openCommDrawer(tab = 'compose', preReceiver = null, preCategory = null) {
    document.getElementById('comm-drawer-window').classList.remove('hidden');
    switchCommTab(tab, preReceiver, preCategory);
}

function getPermittedRecipientsForUser(user) {
    if (!user) return [];
    const id = user.employee_id.toUpperCase();
    const canContactDeptHead = ['CSE-01', 'CQCE-01', 'PR-C-PC-01', 'CADC-C-01', 'CDTE-01', 'DT-C-CA-01'].includes(id);

    return DB.employees.filter(e => {
        if (e.employee_id === user.employee_id) return false;
        if (e.employee_id === 'DH-01' && !canContactDeptHead) return false;
        return !e.employee_id.startsWith('CW-');
    });
}

function switchCommTab(tab, preReceiver = null, preCategory = null) {
    activeCommTab = tab;
    ['inbox', 'compose', 'drafts', 'history'].forEach(t => {
        const btn = document.getElementById(`comm-tab-${t}`);
        btn.className = t === tab
            ? 'py-2.5 border-b-2 border-zinc-900 text-zinc-900 bg-white'
            : 'py-2.5 border-b-2 border-transparent hover:text-zinc-900';
    });

    const body = document.getElementById('comm-body-content');
    const myId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'DH-01';

    if (tab === 'inbox') {
        const inbox = DB.department_communications.filter(
            c => c.receiver_id === myId && c.comm_status !== 'Draft' && c.protocol_category !== 'System Logo'
        );
        body.innerHTML = inbox.map(c => `
            <div class="p-3.5 rounded-xl bg-white border border-zinc-200 mb-2.5 space-y-2">
                <div class="flex justify-between items-center">
                    <span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 font-bold text-[10px] uppercase">${c.protocol_category}</span>
                    <span class="font-mono text-[10px] text-zinc-400">Ref: ${c.linked_reference_id}</span>
                </div>
                <p class="font-bold text-zinc-900">${c.subject_line}</p>
                <p class="text-zinc-600">${c.message_body}</p>
                <p class="text-[10px] text-zinc-400">From: <strong>${c.sender_name}</strong> (${c.sender_role})</p>
                ${c.comm_status === 'Pending Approval' ? `
                    <div class="grid grid-cols-2 gap-2 pt-1">
                        <button type="button" onclick="resolveCommItem(${c.comm_id}, 'Approved')" class="bg-zinc-900 text-white py-1.5 rounded-lg font-semibold">Approve</button>
                        <button type="button" onclick="resolveCommItem(${c.comm_id}, 'Rejected')" class="bg-zinc-200 text-zinc-800 py-1.5 rounded-lg font-semibold">Reject</button>
                    </div>
                ` : `<span class="inline-block px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 font-bold text-[10px]">${c.comm_status}</span>`}
            </div>
        `).join('') || '<p class="text-center text-zinc-400 py-10">Inbox is empty.</p>';
    } else if (tab === 'compose') {
        const recipients = getPermittedRecipientsForUser(currentLoggedInUser);
        const refOptions = [
            ...DB.pattern_assets.map(p => `${p.asset_id} (${p.model_name})`),
            ...DB.cutting_orders.map(o => `${o.order_id} (${o.style_code})`),
            ...DB.cad_markers.map(m => `${m.style_code} (${m.brand_buyer})`),
            'Brand Parameter Request'
        ];

        body.innerHTML = `
            <div class="space-y-3 bg-white p-3.5 rounded-xl border border-zinc-200">
                <div>
                    <label class="text-[11px] font-bold text-zinc-600 block mb-1">Recipient</label>
                    <select id="comm-receiver" class="w-full p-2 bg-zinc-50 border border-zinc-300 rounded-lg">
                        ${recipients.map(r => `<option value="${r.employee_id}" ${preReceiver === r.employee_id ? 'selected' : ''}>${r.role_designation} (${r.full_name})</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="text-[11px] font-bold text-zinc-600 block mb-1">Category</label>
                    <select id="comm-category" class="w-full p-2 bg-zinc-50 border border-zinc-300 rounded-lg">
                        <option value="Executive Approval" ${preCategory === 'Executive Approval' ? 'selected' : ''}>Executive Approval</option>
                        <option value="Parameter Request" ${preCategory === 'Parameter Request' ? 'selected' : ''}>Parameter Request</option>
                        <option value="QC Escalation">QC Escalation</option>
                        <option value="Line Directive">Line Directive</option>
                    </select>
                </div>
                <div>
                    <label class="text-[11px] font-bold text-zinc-600 block mb-1">Reference ID</label>
                    <select id="comm-ref-id" class="w-full p-2 bg-zinc-50 border border-zinc-300 rounded-lg">
                        ${refOptions.map(ref => `<option value="${ref.split(' ')[0]}">${ref}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="text-[11px] font-bold text-zinc-600 block mb-1">Subject</label>
                    <input id="comm-subject" type="text" placeholder="Subject" class="w-full p-2 bg-zinc-50 border border-zinc-300 rounded-lg">
                </div>
                <div>
                    <label class="text-[11px] font-bold text-zinc-600 block mb-1">Details</label>
                    <textarea id="comm-message" rows="3" placeholder="Details" class="w-full p-2 bg-zinc-50 border border-zinc-300 rounded-lg"></textarea>
                </div>
                <div class="grid grid-cols-2 gap-2 pt-1">
                    <button type="button" onclick="saveOrSendComm('Draft')" class="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 py-2 rounded-lg font-semibold">Save Draft</button>
                    <button type="button" onclick="saveOrSendComm('Pending Approval')" class="bg-zinc-900 hover:bg-zinc-800 text-white py-2 rounded-lg font-semibold">Send</button>
                </div>
            </div>
        `;
    } else if (tab === 'drafts') {
        const drafts = DB.department_communications.filter(c => c.sender_id === myId && c.comm_status === 'Draft');
        body.innerHTML = drafts.map(d => `
            <div class="p-3.5 rounded-xl bg-white border border-zinc-200 mb-2.5 space-y-2">
                <div class="flex justify-between">
                    <span class="font-bold text-zinc-700">To: ${d.receiver_name}</span>
                    <span class="font-mono text-[10px] text-zinc-400">${d.linked_reference_id}</span>
                </div>
                <p class="font-bold text-zinc-900">${d.subject_line}</p>
                <p class="text-zinc-600">${d.message_body}</p>
                <div class="grid grid-cols-2 gap-2 pt-1">
                    <button type="button" onclick="transmitSavedDraft(${d.comm_id})" class="bg-zinc-900 text-white py-1.5 rounded-lg font-semibold">Send Now</button>
                    <button type="button" onclick="deleteSavedDraft(${d.comm_id})" class="bg-zinc-100 text-rose-600 py-1.5 rounded-lg font-semibold">Delete</button>
                </div>
            </div>
        `).join('') || '<p class="text-center text-zinc-400 py-10">No saved drafts.</p>';
    } else {
        const hist = DB.department_communications.filter(
            c => (c.sender_id === myId || c.receiver_id === myId) && c.comm_status !== 'Draft' && c.protocol_category !== 'System Logo'
        );
        body.innerHTML = hist.map(c => `
            <div class="p-3 rounded-xl bg-white border border-zinc-200 mb-2 space-y-1">
                <div class="flex justify-between text-[10px] text-zinc-400">
                    <span>${c.sender_name} to ${c.receiver_name}</span>
                    <span class="font-bold text-zinc-800">${c.comm_status}</span>
                </div>
                <p class="font-bold text-zinc-900">${c.subject_line} (${c.linked_reference_id})</p>
                <p class="text-zinc-600">${c.message_body}</p>
            </div>
        `).join('') || '<p class="text-center text-zinc-400 py-10">No history.</p>';
    }
}

async function saveOrSendComm(targetStatus) {
    const recId = document.getElementById('comm-receiver').value;
    const cat = document.getElementById('comm-category').value;
    const refId = document.getElementById('comm-ref-id').value;
    const subj = document.getElementById('comm-subject').value.trim();
    const msg = document.getElementById('comm-message').value.trim();

    if (!subj || !msg) return showToast('Enter Subject and Details.', 'error');

    if (targetStatus === 'Pending Approval') {
        const duplicate = DB.department_communications.some(
            c => c.receiver_id === recId && c.linked_reference_id === refId && c.comm_status === 'Pending Approval'
        );
        if (duplicate) return showToast(`An active request for ${refId} is already pending.`, 'error');
    }

    const recObj = DB.employees.find(e => e.employee_id === recId);
    const payload = {
        sender_id: currentLoggedInUser.employee_id,
        sender_name: currentLoggedInUser.full_name,
        sender_role: currentLoggedInUser.role_designation,
        receiver_id: recObj.employee_id,
        receiver_name: recObj.full_name,
        receiver_role: recObj.role_designation,
        protocol_category: cat,
        linked_reference_id: refId,
        subject_line: subj,
        message_body: msg,
        comm_status: targetStatus
    };

    await supa.from('department_communications').insert([payload]);
    await writeImmutableAudit(targetStatus === 'Draft' ? 'SAVE_DRAFT' : 'SEND_REQUEST', 'Department_Communications', refId, payload);
    await syncFromSupabase();
    switchCommTab(targetStatus === 'Draft' ? 'drafts' : 'history');
    showToast(targetStatus === 'Draft' ? 'Draft saved.' : `Sent to ${recObj.full_name}.`);
}

async function transmitSavedDraft(commId) {
    await supa.from('department_communications').update({ comm_status: 'Pending Approval' }).eq('comm_id', commId);
    await syncFromSupabase();
    switchCommTab('history');
    showToast('Draft sent.');
}

async function deleteSavedDraft(commId) {
    await supa.from('department_communications').delete().eq('comm_id', commId);
    await syncFromSupabase();
    switchCommTab('drafts');
}

async function resolveCommItem(commId, decision) {
    await supa.from('department_communications').update({ comm_status: decision }).eq('comm_id', commId);
    await writeImmutableAudit(`COMM_${decision.toUpperCase()}`, 'Department_Communications', commId, { decision });
    await syncFromSupabase();
    if (!document.getElementById('view-dept-head').classList.contains('hidden')) renderDeptHeadPortal();
    switchCommTab('inbox');
    showToast(`Marked as ${decision}.`);
}

// ============================================================================
// 16. SYSTEM-GENERATED FORMAL A4 REPORTS & VISUAL DATABASE
// ============================================================================
function switchReportMode(mode) {
    document.getElementById('reports-mgmt-container').classList.toggle('hidden', mode !== 'mgmt');
    document.getElementById('reports-vdb-container').classList.toggle('hidden', mode !== 'vdb');
    document.getElementById('rep-mode-mgmt').className = mode === 'mgmt' ? 'px-4 py-2 rounded-xl bg-zinc-900 text-white' : 'px-4 py-2 rounded-xl bg-zinc-100 text-zinc-700';
    document.getElementById('rep-mode-vdb').className = mode === 'vdb' ? 'px-4 py-2 rounded-xl bg-zinc-900 text-white' : 'px-4 py-2 rounded-xl bg-zinc-100 text-zinc-700';
    if (mode === 'vdb') renderVisualDatabaseExplorer('employees');
}

function populateReportGroupFilter() {
    const repNo = parseInt(document.getElementById('rep-type-select').value);
    const sel = document.getElementById('rep-group-filter');
    let groups = [];
    if (repNo === 1) groups = [...new Set(DB.pattern_assets.map(p => p.brand_buyer))];
    else if (repNo === 2) groups = [...new Set(DB.qc_defect_codes.map(d => d.fault_category))];
    else if (repNo === 3) groups = ['Morning', 'Afternoon', 'Night'];
    else groups = ['CAD Tooling Material', 'Cutting Floor Fabric'];

    sel.innerHTML = `<option value="ALL">All Groups (${groups.length})</option>` +
        groups.map(g => `<option value="${g}">${g}</option>`).join('');
}

function renderGroupedReport() {
    const repNo = parseInt(document.getElementById('rep-type-select').value);
    const filterVal = document.getElementById('rep-group-filter').value;
    const customTitle = document.getElementById('rep-custom-title').value.trim();
    const customNote = document.getElementById('rep-custom-note').value.trim();
    const canvas = document.getElementById('printable-report-canvas');
    const nowStr = new Date().toLocaleString();
    const roleFor = currentLoggedInUser ? `${currentLoggedInUser.full_name} (${currentLoggedInUser.role_designation})` : 'Cutting Department';

    const masRec = DB.department_communications.find(c => c.linked_reference_id === 'LOGO_MAS' && c.resolution_note);
    const bodyRec = DB.department_communications.find(c => c.linked_reference_id === 'LOGO_BODYLINE' && c.resolution_note);

    const leftLogoHtml = masRec
        ? `<img src="${masRec.resolution_note}" class="h-9 max-w-[144px] object-contain">`
        : `<span class="font-black text-zinc-900 text-sm tracking-tight uppercase">MAS HOLDINGS</span>`;
    const rightLogoHtml = bodyRec
        ? `<img src="${bodyRec.resolution_note}" class="h-9 max-w-[144px] object-contain ml-auto">`
        : `<span class="font-extrabold text-zinc-900 text-sm tracking-widest uppercase">BODYLINE</span>`;

    const defaultTitles = {
        1: 'PATTERN BLOCKS & 3D MOLDS INVENTORY REPORT',
        2: 'QUALITY CONTROL DEFECT SUMMARY REPORT',
        3: 'DAILY SHIFT DEPLOYMENT ROSTER REPORT',
        4: 'RAW MATERIAL WAREHOUSE STATUS REPORT'
    };

    let bodyGroupsHtml = '';

    if (repNo === 1) {
        let brands = [...new Set(DB.pattern_assets.map(p => p.brand_buyer))];
        if (filterVal !== 'ALL') brands = brands.filter(b => b === filterVal);
        bodyGroupsHtml = brands.map(brand => {
            const items = DB.pattern_assets.filter(p => p.brand_buyer === brand);
            return `
                <div class="mb-5 border border-zinc-300 rounded-lg overflow-hidden">
                    <div class="bg-zinc-100 px-4 py-2 border-b border-zinc-300 flex justify-between items-center text-xs font-bold text-zinc-900">
                        <span>BRAND GROUP: ${brand.toUpperCase()}</span>
                        <span>Subtotal: ${items.length}</span>
                    </div>
                    <table class="w-full text-left text-xs">
                        <thead class="bg-zinc-50 text-[10px] uppercase text-zinc-500 border-b border-zinc-200">
                            <tr><th class="p-2">Asset ID</th><th class="p-2">Type</th><th class="p-2">Model & Style</th><th class="p-2">Size</th><th class="p-2">Location</th><th class="p-2">Status</th></tr>
                        </thead>
                        <tbody class="divide-y divide-zinc-200">
                            ${items.map(i => `<tr><td class="p-2 font-mono font-bold">${i.asset_id}</td><td class="p-2">${i.tooling_type}</td><td class="p-2">${i.model_name} (${i.style_code})</td><td class="p-2">${i.size_category}</td><td class="p-2">${i.storage_location}</td><td class="p-2 font-semibold">${i.operational_status}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');
    } else if (repNo === 2) {
        let cats = [...new Set(DB.qc_defect_codes.map(d => d.fault_category))];
        if (filterVal !== 'ALL') cats = cats.filter(c => c === filterVal);
        bodyGroupsHtml = cats.map(cat => {
            const codes = DB.qc_defect_codes.filter(d => d.fault_category === cat);
            return `
                <div class="mb-5 border border-zinc-300 rounded-lg overflow-hidden">
                    <div class="bg-zinc-100 px-4 py-2 border-b border-zinc-300 flex justify-between text-xs font-bold">
                        <span>FAULT CATEGORY: ${cat.toUpperCase()}</span>
                        <span>Subtotal: ${codes.length}</span>
                    </div>
                    <table class="w-full text-left text-xs">
                        <thead class="bg-zinc-50 text-[10px] uppercase text-zinc-500 border-b border-zinc-200">
                            <tr><th class="p-2">Code</th><th class="p-2">Symptom</th><th class="p-2">Severity</th><th class="p-2">Resolver</th><th class="p-2">Action</th></tr>
                        </thead>
                        <tbody class="divide-y divide-zinc-200">
                            ${codes.map(c => `<tr><td class="p-2 font-mono font-bold">${c.defect_code}</td><td class="p-2">${c.defect_name_symptom}</td><td class="p-2">${c.severity_level}</td><td class="p-2">${c.assigned_resolver_role_id}</td><td class="p-2">${c.mandatory_system_action}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');
    } else if (repNo === 3) {
        let shifts = ['Morning', 'Afternoon', 'Night'];
        if (filterVal !== 'ALL') shifts = shifts.filter(s => s === filterVal);
        bodyGroupsHtml = shifts.map(sh => {
            const rows = DB.shift_assignments.filter(a => a.shift_type === sh);
            return `
                <div class="mb-5 border border-zinc-300 rounded-lg overflow-hidden">
                    <div class="bg-zinc-100 px-4 py-2 border-b border-zinc-300 flex justify-between text-xs font-bold">
                        <span>SHIFT: ${sh.toUpperCase()}</span>
                        <span>Subtotal: ${rows.length}</span>
                    </div>
                    <table class="w-full text-left text-xs">
                        <thead class="bg-zinc-50 text-[10px] uppercase text-zinc-500 border-b border-zinc-200">
                            <tr><th class="p-2">ID</th><th class="p-2">Operator</th><th class="p-2">Supervisor</th><th class="p-2">Date</th><th class="p-2">Line</th></tr>
                        </thead>
                        <tbody class="divide-y divide-zinc-200">
                            ${rows.map(r => `<tr><td class="p-2 font-mono">#${r.assignment_id}</td><td class="p-2 font-bold">${r.borrower_id}</td><td class="p-2">${r.supervisor_id}</td><td class="p-2">${r.assigned_date}</td><td class="p-2">${r.production_line}</td></tr>`).join('') || '<tr><td colspan="5" class="p-3 text-zinc-400">None</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');
    } else {
        let cats = ['CAD Tooling Material', 'Cutting Floor Fabric'];
        if (filterVal !== 'ALL') cats = cats.filter(c => c === filterVal);
        bodyGroupsHtml = cats.map(cat => {
            const items = DB.rmw_materials.filter(m => m.material_category === cat);
            return `
                <div class="mb-5 border border-zinc-300 rounded-lg overflow-hidden">
                    <div class="bg-zinc-100 px-4 py-2 border-b border-zinc-300 flex justify-between text-xs font-bold">
                        <span>CATEGORY: ${cat.toUpperCase()}</span>
                        <span>Subtotal: ${items.length}</span>
                    </div>
                    <table class="w-full text-left text-xs">
                        <thead class="bg-zinc-50 text-[10px] uppercase text-zinc-500 border-b border-zinc-200">
                            <tr><th class="p-2">Code</th><th class="p-2">Specs</th><th class="p-2">Target</th><th class="p-2">Bay</th><th class="p-2">Status</th></tr>
                        </thead>
                        <tbody class="divide-y divide-zinc-200">
                            ${items.map(m => `<tr><td class="p-2 font-mono font-bold">${m.material_code}</td><td class="p-2">${m.material_name_specs}</td><td class="p-2">${m.target_brand_usage}</td><td class="p-2">${m.rmw_storage_bay}</td><td class="p-2 font-semibold">${m.lot_status}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');
    }

    canvas.innerHTML = `
        <div class="border-b-2 border-zinc-900 pb-4 mb-5 grid grid-cols-3 items-center">
            <div>${leftLogoHtml}</div>
            <div class="text-center">
                <p class="text-[11px] font-black uppercase tracking-widest text-zinc-900">CDMS<span class="text-red-600">+</span> Report REP-0${repNo}</p>
                <h2 class="text-base font-black text-zinc-900 uppercase mt-0.5">${customTitle || defaultTitles[repNo]}</h2>
                <p class="text-[11px] text-zinc-500">Bodyline (Pvt) Ltd, Horana Plant 1</p>
            </div>
            <div class="text-right">${rightLogoHtml}</div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5 text-[11px] bg-zinc-50 p-3 rounded-lg border border-zinc-200">
            <div><span class="text-zinc-400 block">Generated At</span><strong>${nowStr}</strong></div>
            <div><span class="text-zinc-400 block">Recipient</span><strong>${roleFor}</strong></div>
            <div><span class="text-zinc-400 block">Filter</span><strong>${filterVal}</strong></div>
            <div><span class="text-zinc-400 block">Note</span><strong>${customNote || 'System Telemetry'}</strong></div>
        </div>

        ${bodyGroupsHtml}

        <div class="mt-6 pt-3 border-t border-zinc-200 flex justify-between items-center text-[10px] font-mono text-zinc-400">
            <span>CDMS+ AUTOMATED SYSTEM REPORT</span>
            <span>GENERATED FROM POSTGRESQL DATABASE</span>
        </div>
    `;
}

const VDB_TABLES = [
    'employees', 'pattern_assets', 'cad_markers', 'rmw_materials', 'qc_defect_codes',
    'shift_assignments', 'pending_requests', 'cutting_orders', 'qc_inspection_logs',
    'system_settings_audit', 'department_communications', 'immutable_audit_logs'
];

function renderVisualDatabaseExplorer(tableName) {
    document.getElementById('vdb-table-tabs').innerHTML = VDB_TABLES.map((t, idx) => `
        <button type="button" onclick="renderVisualDatabaseExplorer('${t}')" class="px-3 py-1.5 rounded-lg ${t === tableName ? 'bg-zinc-900 text-white font-bold' : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-100'}">
            TBL-${(idx + 1).toString().padStart(2, '0')}: ${t} (${(DB[t] || []).length})
        </button>
    `).join('');

    const rows = DB[tableName] || [];
    document.getElementById('vdb-table-title').innerText = `Table: ${tableName} (${rows.length} Rows)`;
    if (rows.length === 0) {
        document.getElementById('vdb-table-rows').innerHTML = '<p class="text-zinc-400 py-6">No rows.</p>';
        return;
    }
    const cols = Object.keys(rows[0]);
    document.getElementById('vdb-schema-spec').innerHTML = `
        <table class="w-full text-left">
            <thead class="bg-zinc-100 text-[10px] uppercase text-zinc-500 border-b border-zinc-200">
                <tr><th class="p-2">Field</th><th class="p-2">Key</th></tr>
            </thead>
            <tbody class="divide-y divide-zinc-100">
                ${cols.map((c, i) => `<tr><td class="p-2 font-mono font-bold text-zinc-900">${c}</td><td class="p-2 text-zinc-500">${i === 0 ? 'PRIMARY KEY' : 'ATTRIBUTE'}</td></tr>`).join('')}
            </tbody>
        </table>
    `;

    document.getElementById('vdb-table-rows').innerHTML = `
        <table class="w-full text-left">
            <thead class="bg-zinc-100 text-[10px] uppercase text-zinc-500 border-b border-zinc-200">
                <tr>${cols.map(c => `<th class="p-2">${c}</th>`).join('')}</tr>
            </thead>
            <tbody class="divide-y divide-zinc-100 font-mono text-[11px]">
                ${rows.map(r => `<tr class="hover:bg-zinc-50">${cols.map(c => `<td class="p-2 truncate max-w-[180px]">${r[c] !== null ? String(r[c]) : '-'}</td>`).join('')}</tr>`).join('')}
            </tbody>
        </table>
    `;
}