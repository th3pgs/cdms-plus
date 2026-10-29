// ============================================================================
// CDMS+ ENTERPRISE ENGINE — 100% LIVE SUPABASE POSTGRESQL (NO LOCALSTORAGE DB)
// ============================================================================
const SUPABASE_URL = 'https://uvfmircbplfqkgkmzssb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NZNswR7y9y-oSJIC-unRvw_wioNx760';
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// LIVE IN-MEMORY CACHE POPULATED STRICTLY FROM SUPABASE POSTGRESQL
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
let currentMode = 'gateway';
let idleSecondsRemaining = 300; // 5-Minute Unfinished Procedure Reset
let selectedOperatorForAssign = null;
let currentGridFilter = 'ALL';
let activeCommTab = 'inbox';
let editingDraftId = null;
let mutexPollInterval = null;

// ============================================================================
// 1. SUPABASE LIVE SYNC & IMMUTABLE AUDIT ENGINE
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

        applyCustomLogosFromDB();
        updateCommUnreadBadge();
    } catch (err) {
        console.error('Supabase Sync Error:', err);
        showToast('Database sync warning: check network connection.', 'error');
    }
}

async function writeImmutableAudit(actionVerb, targetEntity, targetId, snapshotObj) {
    const actorId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'TERMINAL';
    const actorName = currentLoggedInUser ? currentLoggedInUser.full_name : 'Floor Pattern Terminal';
    const actorRole = currentLoggedInUser ? currentLoggedInUser.role_designation : 'General Kiosk';

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
// 2. BOOT & 5-MINUTE UNFINISHED PROCEDURE TIMEOUT
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    await syncFromSupabase();

    ['click', 'keydown', 'Touchstart'].forEach(evt => {
        document.addEventListener(evt, () => { idleSecondsRemaining = 300; });
    });

    setInterval(() => {
        if (currentMode === 'gateway') return;
        idleSecondsRemaining--;
        const m = Math.floor(idleSecondsRemaining / 60).toString().padStart(2, '0');
        const s = (idleSecondsRemaining % 60).toString().padStart(2, '0');
        const disp = document.getElementById('idle-countdown-display');
        if (disp) disp.innerText = `${m}:${s}`;

        if (idleSecondsRemaining <= 0) {
            idleSecondsRemaining = 300;
            closeVerifyModal();
            returnToWelcomeScreen();
            showToast('5-Minute Procedure Timeout: Unfinished session reset to Welcome Screen.', 'error');
        }
    }, 1000);
});

// BOTTOM-LEFT TOAST NOTIFICATIONS (NEVER BLOCKS TOP-RIGHT HEADER)
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    const style = type === 'error'
        ? 'bg-rose-900 border-rose-700 text-white'
        : 'bg-slate-900 border-slate-700 text-white';
    t.className = `${style} border px-4 py-3 rounded-xl shadow-xl text-xs font-medium flex items-center gap-2.5 fade-in pointer-events-auto`;
    t.innerHTML = `<i class="ph-fill ${type === 'error' ? 'ph-warning-octagon text-rose-400' : 'ph-check-circle text-emerald-400'} text-lg shrink-0"></i> <span>${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3800);
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// IMAGE FILE COMPRESSOR (STORES REAL PHOTOS DIRECTLY IN SUPABASE TEXT COLUMNS)
function readAndCompressImage(fileInput, maxWidth = 360) {
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
                resolve(canvas.toDataURL('image/jpeg', 0.78));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(fileInput.files[0]);
    });
}

// ============================================================================
// 3. STEALTH VIVA BYPASS PADLOCK & ROLE-ISOLATED LOGIN
// ============================================================================
function toggleVivaPadlock() {
    vivaBypassUnlocked = !vivaBypassUnlocked;
    const icon = document.getElementById('viva-padlock-icon');
    const txt = document.getElementById('viva-padlock-text');

    if (vivaBypassUnlocked) {
        icon.className = 'ph-fill ph-lock-key-open text-blue-600 text-sm';
        txt.innerText = 'Quick Role Select';
        showToast('Quick Role Selection enabled in Login box.');
    } else {
        icon.className = 'ph-fill ph-lock-key text-slate-500 text-sm';
        txt.innerText = 'Standard Auth';
        showToast('Standard Password Auth enabled.');
    }
}

function openUserLoginModal() {
    document.getElementById('user-login-modal').classList.remove('hidden');
    const helper = document.getElementById('viva-login-helper');
    const stdInputs = document.getElementById('standard-login-inputs');

    // When unlocked, hide raw ID/Password boxes so no fake passwords are shown!
    if (vivaBypassUnlocked) {
        helper.classList.remove('hidden');
        stdInputs.classList.add('hidden');
        onVivaRoleChange();
    } else {
        helper.classList.add('hidden');
        stdInputs.classList.remove('hidden');
    }
}

function onVivaRoleChange() {
    const val = document.getElementById('viva-role-dropdown').value;
    morphDepartmentIconOnType(val);
}

function morphDepartmentIconOnType(rawId) {
    const code = (rawId || '').trim().toUpperCase();
    const box = document.getElementById('login-dept-icon-box');
    const icon = document.getElementById('login-dept-icon');
    const badge = document.getElementById('login-dept-badge');

    let cfg = { icon: 'ph-identification-badge', label: 'Enter Staff Employee ID' };
    if (code.startsWith('DH')) cfg = { icon: 'ph-buildings', label: 'Cutting Department Head • Executive Oversight' };
    else if (code.startsWith('CSE')) cfg = { icon: 'ph-briefcase', label: 'Cutting Senior Executive • Operations' };
    else if (code.startsWith('CS-')) cfg = { icon: 'ph-calendar-check', label: 'Cutting Floor Supervisor • Shift Command' };
    else if (code.startsWith('DDC')) cfg = { icon: 'ph-paint-brush-broad', label: 'Design Department Coordinator' };
    else if (code.startsWith('CAD')) cfg = { icon: 'ph-compass-tool', label: 'CAD Room • Markers & Tooling' };
    else if (code.startsWith('PR-')) cfg = { icon: 'ph-barcode', label: 'Pattern Room • Block & Mold Library' };
    else if (code.startsWith('SDC')) cfg = { icon: 'ph-scissors', label: 'Sewing Department Coordinator' };
    else if (code.startsWith('RMW')) cfg = { icon: 'ph-warehouse', label: 'Raw Material Warehouse (RMW)' };
    else if (code.startsWith('CQC') || code.startsWith('QCI')) cfg = { icon: 'ph-warning-octagon', label: 'Quality Control (QC) Inspection' };
    else if (code.startsWith('CDTE') || code.startsWith('DT-')) cfg = { icon: 'ph-terminal-window', label: 'Digital Team • Root System Admin' };

    icon.className = `ph-duotone ${cfg.icon} text-3xl`;
    badge.innerText = cfg.label;
    box.className = 'w-16 h-16 rounded-2xl bg-blue-50 border-2 border-blue-600 flex items-center justify-center text-blue-600 mb-3 transition-all duration-300';
}

async function executeDepartmentLogin() {
    await syncFromSupabase();
    let empId = vivaBypassUnlocked
        ? document.getElementById('viva-role-dropdown').value
        : document.getElementById('login-emp-id').value.trim().toUpperCase();
    const pass = document.getElementById('login-emp-pass').value;

    const emp = DB.employees.find(e => e.employee_id.toUpperCase() === empId);
    if (!emp) return showToast('Employee ID not found in Supabase database.', 'error');
    if (!vivaBypassUnlocked && !pass) return showToast('Please enter your password.', 'error');

    currentLoggedInUser = emp;
    currentMode = 'portal';
    closeModal('user-login-modal');

    // Update Header Profile (Full Name + Role below, NO Employee ID shown)
    document.getElementById('view-gateway').classList.add('hidden');
    document.getElementById('main-header').classList.remove('hidden');
    document.getElementById('comm-floating-Dock').classList.remove('hidden');
    document.getElementById('header-user-name').innerText = emp.full_name;
    document.getElementById('header-user-role').innerText = emp.role_designation;
    document.getElementById('header-user-avatar').src = emp.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80';

    buildRoleIsolatedTabs(emp);
    await writeImmutableAudit('USER_LOGIN', 'Employees', emp.employee_id, { name: emp.full_name, role: emp.role_designation });
    showToast(`Signed in as ${emp.full_name}`);
}

// ============================================================================
// 4. STRICT ROLE-ISOLATED WORKSPACES (USERS ONLY SEE THEIR OWN TOOLS)
// ============================================================================
function buildRoleIsolatedTabs(emp) {
    const id = emp.employee_id.toUpperCase();
    const nav = document.getElementById('role-workspace-tabs');
    const pill = document.getElementById('workspace-title-pill');
    let tabs = [];

    if (id.startsWith('DH')) {
        pill.innerText = 'Executive Oversight';
        tabs = [
            { key: 'dept-head', label: 'Live Department Oversight', icon: 'ph-chart-pie-slice' },
            { key: 'reports', label: 'System Reports', icon: 'ph-file-text' },
            { key: 'tracker', label: 'Pattern Catalog (View)', icon: 'ph-package' }
        ];
    } else if (id.startsWith('CSE') || id.startsWith('CS-')) {
        pill.innerText = 'Supervisor Shift Command';
        tabs = [
            { key: 'supervisor', label: 'Shift Matrix & Clearances', icon: 'ph-calendar-check' },
            { key: 'supply', label: 'Cutting Orders & RMW', icon: 'ph-truck' },
            { key: 'reports', label: 'System Reports', icon: 'ph-file-text' }
        ];
    } else if (id.startsWith('DDC') || id.startsWith('CAD')) {
        pill.innerText = 'Design & CAD Workspace';
        tabs = [
            { key: 'design-cad', label: 'Styles & CAD Markers', icon: 'ph-compass-tool' },
            { key: 'tracker', label: 'Pattern Catalog', icon: 'ph-package' }
        ];
    } else if (id.startsWith('PR-')) {
        pill.innerText = 'Pattern Room Library';
        tabs = [
            { key: 'design-cad', label: 'Register Blocks & 3D Molds', icon: 'ph-qr-code' },
            { key: 'tracker', label: 'Digital Pattern Room', icon: 'ph-package' },
            { key: 'reports', label: 'Inventory Reports', icon: 'ph-file-text' }
        ];
    } else if (id.startsWith('SDC') || id.startsWith('RMW')) {
        pill.innerText = 'Supply & Requisition Hub';
        tabs = [
            { key: 'supply', label: 'Orders & Material Dispatch', icon: 'ph-warehouse' },
            { key: 'reports', label: 'Consumption Reports', icon: 'ph-file-text' }
        ];
    } else if (id.startsWith('CQC') || id.startsWith('QCI')) {
        pill.innerText = 'Quality Control Center';
        tabs = [
            { key: 'qc', label: 'Floor Defect Flagging', icon: 'ph-warning-octagon' },
            { key: 'reports', label: 'QC Defect Reports', icon: 'ph-file-text' }
        ];
    } else {
        pill.innerText = 'Digital Team Root Admin';
        tabs = [
            { key: 'admin', label: 'Admin & Immutable Audit', icon: 'ph-terminal-window' },
            { key: 'reports', label: 'Visual Database & Reports', icon: 'ph-database' }
        ];
    }

    nav.innerHTML = tabs.map(t => `
        <button onclick="switchPortalView('${t.key}')" id="nav-btn-${t.key}" class="role-tab px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 transition-all">
            <i class="ph-bold ${t.icon}"></i> <span>${t.label}</span>
        </button>
    `).join('');

    switchPortalView(tabs[0].key);
}

async function enterDigitalPatternRoom() {
    await syncFromSupabase();
    currentMode = 'terminal';
    currentLoggedInUser = null;
    document.getElementById('view-gateway').classList.add('hidden');
    document.getElementById('main-header').classList.remove('hidden');
    document.getElementById('comm-floating-Dock').classList.add('hidden');
    document.getElementById('role-workspace-tabs').innerHTML = '';
    document.getElementById('workspace-title-pill').innerText = 'General Floor Terminal';
    document.getElementById('header-user-name').innerText = 'Digital Pattern Room';
    document.getElementById('header-user-role').innerText = 'Floor Checkout Terminal';

    hideAllMainViews();
    document.getElementById('view-tracker').classList.remove('hidden');
    renderPatternGrid('ALL');
}

function hideAllMainViews() {
    ['view-tracker', 'view-dept-head', 'view-supervisor', 'view-design-cad', 'view-supply', 'view-qc', 'view-admin', 'view-reports'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
}

async function switchPortalView(viewKey) {
    hideAllMainViews();
    document.querySelectorAll('.role-tab').forEach(b => {
        b.className = 'role-tab px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 transition-all';
    });
    const activeBtn = document.getElementById(`nav-btn-${viewKey}`);
    if (activeBtn) {
        activeBtn.className = 'role-tab px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white flex items-center gap-1.5 shadow-sm transition-all';
    }

    document.getElementById(`view-${viewKey}`).classList.remove('hidden');
    if (viewKey === 'tracker') renderPatternGrid('ALL');
    if (viewKey === 'dept-head') renderDeptHeadPortal();
    if (viewKey === 'supervisor') renderSupervisorPortal();
    if (viewKey === 'design-cad') renderDesignCadPortal();
    if (viewKey === 'supply') renderSupplyPortal();
    if (viewKey === 'qc') renderQcPortal();
    if (viewKey === 'admin') renderAdminPortal();
    if (viewKey === 'reports') { populateReportGroupFilter(); renderGroupedReport(); }
}

function triggerCredentialedLogout() {
    if (currentMode === 'terminal' && !vivaBypassUnlocked) {
        const pin = prompt('Mid-Shift Terminal Sign-Out: Enter Pattern Coordinator ID (PR-C-PC-01):', 'PR-C-PC-01');
        if (!pin) return;
    }
    returnToWelcomeScreen();
    showToast('Signed out to Welcome Screen.');
}

function returnToWelcomeScreen() {
    currentMode = 'gateway';
    currentLoggedInUser = null;
    hideAllMainViews();
    document.getElementById('main-header').classList.add('hidden');
    document.getElementById('comm-floating-Dock').classList.add('hidden');
    document.getElementById('comm-drawer-window').classList.add('hidden');
    document.getElementById('view-gateway').classList.remove('hidden');
}

// ============================================================================
// 5. E-COMMERCE VISUAL PATTERN ROOM & 2-STEP QR CHECKOUT
// ============================================================================
function filterPatternGrid(statusFilter) {
    currentGridFilter = statusFilter;
    renderPatternGrid(statusFilter);
}

function handlePatternSearch() {
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    document.getElementById('clearBtn').classList.toggle('hidden', q.length === 0);
    renderPatternGrid(currentGridFilter, q);
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    handlePatternSearch();
}

function renderPatternGrid(statusFilter = 'ALL', query = '') {
    let list = DB.pattern_assets;
    if (statusFilter !== 'ALL') list = list.filter(p => p.operational_status === statusFilter);
    if (query) {
        list = list.filter(p =>
            p.asset_id.toLowerCase().includes(query) ||
            p.model_name.toLowerCase().includes(query) ||
            p.brand_buyer.toLowerCase().includes(query) ||
            p.style_code.toLowerCase().includes(query) ||
            p.storage_location.toLowerCase().includes(query)
        );
    }

    const badgeStyle = (st) => {
        if (st === 'Available in Room') return 'bg-emerald-100 text-emerald-800 border-emerald-300';
        if (st === 'Active on Line') return 'bg-blue-100 text-blue-800 border-blue-300';
        if (st.includes('Locked')) return 'bg-amber-100 text-amber-800 border-amber-300';
        return 'bg-rose-100 text-rose-800 border-rose-300';
    };

    document.getElementById('tracker-grid').innerHTML = list.map(p => `
        <div onclick="openScannerForAsset('${p.asset_id}')" class="product-card bg-white rounded-2xl border border-slate-200 overflow-hidden cursor-pointer flex flex-col justify-between">
            <div>
                <div class="h-44 w-full bg-slate-100 relative overflow-hidden border-b border-slate-100">
                    <img src="${p.image_url || 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400&auto=format&fit=crop&q=80'}" class="w-full h-full object-cover" alt="${p.model_name}">
                    <span class="absolute top-3 left-3 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase bg-white/95 text-slate-800 shadow-sm">${p.tooling_type}</span>
                    <span class="absolute top-3 right-3 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border ${badgeStyle(p.operational_status)} shadow-sm">${p.operational_status}</span>
                </div>
                <div class="p-4">
                    <div class="flex justify-between items-center text-[11px] font-semibold text-blue-600 mb-1">
                        <span>${p.brand_buyer}</span>
                        <span class="text-slate-400">Style ${p.style_code}</span>
                    </div>
                    <h3 class="font-bold text-base text-slate-900">${p.model_name}</h3>
                    <div class="mt-2 flex items-center gap-2 text-xs text-slate-600">
                        <span class="px-2 py-0.5 rounded bg-slate-100 font-mono font-semibold text-slate-800">${p.asset_id}</span>
                        <span class="px-2 py-0.5 rounded bg-slate-100 font-semibold">Size: ${p.size_category}</span>
                    </div>
                </div>
            </div>
            <div class="px-4 py-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-xs">
                <span class="font-medium text-slate-600"><i class="ph-fill ph-map-pin text-blue-600"></i> ${p.storage_location}</span>
                <span class="font-bold text-blue-600">Select &rarr;</span>
            </div>
        </div>
    `).join('');
}

function openScannerForAsset(assetId) {
    const asset = DB.pattern_assets.find(a => a.asset_id === assetId);
    if (!asset) return;
    document.getElementById('verify-modal').classList.remove('hidden');
    const area = document.getElementById('modal-dynamic-area');

    // Read-Only if Department Head
    if (currentLoggedInUser && currentLoggedInUser.employee_id.startsWith('DH')) {
        area.innerHTML = `
            <div class="space-y-4">
                <img src="${asset.image_url}" class="w-full h-48 object-cover rounded-xl border border-slate-200">
                <div>
                    <span class="text-xs font-bold text-blue-600 uppercase">${asset.brand_buyer} • ${asset.tooling_type}</span>
                    <h4 class="text-xl font-bold text-slate-900">${asset.model_name} (${asset.asset_id})</h4>
                    <p class="text-xs text-slate-500 mt-1">Storage: ${asset.storage_location} • Size: ${asset.size_category} • Status: <strong>${asset.operational_status}</strong></p>
                </div>
                <div class="p-3 rounded-xl bg-slate-100 text-xs text-slate-600">Department Head View is Read-Only. Physical checkouts are performed at the Pattern Room terminal.</div>
            </div>
        `;
        return;
    }

    if (['Inspection Flagged', 'Decommissioned', 'Pending Removal'].includes(asset.operational_status)) {
        area.innerHTML = `
            <div class="text-center py-6 space-y-3">
                <img src="${asset.image_url}" class="w-32 h-32 object-cover rounded-xl mx-auto border">
                <h4 class="text-base font-bold text-rose-600 uppercase">Item Locked (${asset.operational_status})</h4>
                <p class="text-xs text-slate-600">${asset.asset_id} (${asset.model_name}) is currently restricted from floor checkout.</p>
            </div>
        `;
        return;
    }

    if (asset.operational_status === 'Active on Line') {
        area.innerHTML = `
            <div class="space-y-4 text-center">
                <img src="${asset.image_url}" class="w-full h-44 object-cover rounded-xl border">
                <h4 class="text-lg font-bold text-slate-900">${asset.asset_id} • ${asset.model_name}</h4>
                <p class="text-xs text-slate-600">Currently Active on Line with Operator: <strong>${asset.borrowed_by_id || 'Floor Staff'}</strong></p>
                <button onclick="executeAssetReturn('${asset.asset_id}')" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider">
                    Confirm QR Return to ${asset.storage_location}
                </button>
            </div>
        `;
        return;
    }

    const floorOps = DB.employees.filter(e => e.employee_id.startsWith('CW-'));
    const todayStr = new Date().toISOString().split('T')[0];

    area.innerHTML = `
        <div class="space-y-4">
            <div class="flex gap-3 items-center p-3 rounded-xl bg-slate-50 border border-slate-200">
                <img src="${asset.image_url}" class="w-16 h-16 rounded-lg object-cover border">
                <div>
                    <p class="text-xs font-bold text-blue-600">${asset.brand_buyer} • ${asset.style_code}</p>
                    <h4 class="text-base font-bold text-slate-900">${asset.model_name} (${asset.asset_id})</h4>
                    <p class="text-xs text-slate-500">Size: ${asset.size_category} • Location: ${asset.storage_location}</p>
                </div>
            </div>
            <div>
                <label class="text-xs font-semibold text-slate-600 block mb-1">1. Select Target Shift</label>
                <select id="scan-shift-select" class="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold">
                    <option value="Morning">Morning Shift [06:00 - 14:00]</option>
                    <option value="Afternoon">Afternoon Shift [14:00 - 22:00]</option>
                    <option value="Night">Night Shift [22:00 - 06:00]</option>
                </select>
            </div>
            <div>
                <label class="text-xs font-semibold text-slate-600 block mb-1.5">2. Scan or Select Floor Operator Badge</label>
                <div class="space-y-1.5 max-h-56 overflow-y-auto custom-scroll pr-1">
                    ${floorOps.map(op => {
                        const isSched = DB.shift_assignments.some(s => s.borrower_id === op.employee_id && s.assigned_date === todayStr);
                        return `
                            <button onclick="executeAssetBorrow('${asset.asset_id}', '${op.employee_id}')" class="w-full text-left p-2.5 rounded-xl bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-400 text-xs flex justify-between items-center transition-colors">
                                <span class="flex items-center gap-2">
                                    <img src="${op.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}" class="w-7 h-7 rounded-full object-cover">
                                    <span><strong class="text-slate-900">${op.full_name}</strong> <span class="text-slate-400">(${op.employee_id})</span></span>
                                </span>
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${isSched ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${isSched ? 'Scheduled' : 'Unscheduled (15m Lock)'}</span>
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
        renderPatternGrid(currentGridFilter);
        startMutexBarCountdown(assetId, operatorId, shift);
        showToast(`Unscheduled worker: ${assetId} locked for 15 mins & sent to Supervisor queue.`, 'error');
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
    renderPatternGrid(currentGridFilter);
    showToast(`Checkout complete: ${assetId} issued to ${operatorId}.`);
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
    renderPatternGrid(currentGridFilter);
    showToast(`${assetId} returned to Pattern Room.`);
}

function startMutexBarCountdown(assetId, operatorId, shift) {
    const bar = document.getElementById('mutex-bar');
    const msg = document.getElementById('mutex-msg');
    const timer = document.getElementById('mutex-timer');
    const btn = document.getElementById('mutex-action-btn');

    bar.classList.remove('hidden');
    btn.classList.add('hidden');
    msg.innerText = `15-Min Mutex Lock on ${assetId} (${operatorId}) — Awaiting Supervisor Approval...`;

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
                msg.innerText = `Supervisor Approved ${assetId}! Click Complete Checkout:`;
                btn.classList.remove('hidden');
                btn.onclick = () => { bar.classList.add('hidden'); renderPatternGrid(currentGridFilter); };
            } else if (req && req.request_status === 'Declined') {
                clearInterval(mutexPollInterval);
                timer.innerText = 'DENIED';
                setTimeout(() => bar.classList.add('hidden'), 3000);
            }
        }
    }, 1000);
}

function dismissMutexBar() {
    document.getElementById('mutex-bar').classList.add('hidden');
}

// ============================================================================
// 6. DEPARTMENT HEAD READ-ONLY OVERSIGHT PORTAL
// ============================================================================
async function renderDeptHeadPortal() {
    await syncFromSupabase();
    document.getElementById('dh-kpi-total').innerText = DB.pattern_assets.length;
    document.getElementById('dh-kpi-avail').innerText = DB.pattern_assets.filter(p => p.operational_status === 'Available in Room').length;
    document.getElementById('dh-kpi-active').innerText = DB.pattern_assets.filter(p => p.operational_status === 'Active on Line').length;
    document.getElementById('dh-kpi-flagged').innerText = DB.pattern_assets.filter(p => ['Inspection Flagged', 'Pending Removal', 'Decommissioned'].includes(p.operational_status)).length;

    const dhReqs = DB.department_communications.filter(c => c.receiver_id === 'DH-01' && c.comm_status === 'Pending Approval');
    document.getElementById('dh-kpi-approvals').innerText = dhReqs.length;

    // Col 1: Approvals addressed to Dept Head
    document.getElementById('dh-approvals-list').innerHTML = dhReqs.map(c => `
        <div class="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2 text-xs">
            <div class="flex justify-between items-start">
                <span class="px-2 py-0.5 rounded bg-amber-200/80 text-amber-900 font-bold text-[10px] uppercase">${c.protocol_category}</span>
                <span class="font-mono text-[11px] text-slate-500">Ref: ${c.linked_reference_id}</span>
            </div>
            <p class="font-bold text-slate-900">${c.subject_line}</p>
            <p class="text-slate-600 leading-relaxed">${c.message_body}</p>
            <p class="text-[11px] text-slate-500">From: <strong>${c.sender_name}</strong> (${c.sender_role})</p>
            <div class="grid grid-cols-2 gap-2 pt-1">
                <button onclick="resolveCommItem(${c.comm_id}, 'Approved')" class="bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded-lg font-bold">Approve</button>
                <button onclick="resolveCommItem(${c.comm_id}, 'Rejected')" class="bg-rose-600 hover:bg-rose-700 text-white py-1.5 rounded-lg font-bold">Reject</button>
            </div>
        </div>
    `).join('') || '<p class="text-xs text-slate-400 py-6 text-center">No pending requests awaiting Department Head sign-off.</p>';

    // Col 2: Active Production & Staff
    const activeAssets = DB.pattern_assets.filter(p => p.operational_status === 'Active on Line');
    document.getElementById('dh-active-processes').innerHTML = activeAssets.map(a => {
        const worker = DB.employees.find(e => e.employee_id === a.borrowed_by_id);
        return `
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-3 text-xs">
                <img src="${a.image_url}" class="w-11 h-11 rounded-lg object-cover border">
                <div class="flex-1">
                    <p class="font-bold text-slate-900">${a.model_name} (${a.asset_id})</p>
                    <p class="text-slate-500">Operator: <strong>${worker ? worker.full_name : (a.borrowed_by_id || 'Assigned')}</strong> • ${a.shift_checkout || 'Morning'} Shift</p>
                </div>
                <span class="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold text-[10px]">Active</span>
            </div>
        `;
    }).join('');

    // Col 3: QC Defect Oversight
    document.getElementById('dh-qc-oversight').innerHTML = DB.qc_inspection_logs.map(l => `
        <div class="p-3 rounded-xl bg-rose-50/50 border border-rose-200 text-xs space-y-1">
            <div class="flex justify-between font-bold text-slate-900">
                <span>${l.qc_log_id} • Defect ${l.defect_code}</span>
                <span class="text-rose-600">Asset ${l.asset_id}</span>
            </div>
            <p class="text-slate-600">Line: ${l.production_line} • Ruined Plies: ${l.ruined_ply_count} • Resolver: ${l.resolver_id}</p>
            <span class="inline-block px-2 py-0.5 rounded bg-white border border-rose-200 text-rose-700 text-[10px] font-semibold">${l.resolution_status}</span>
        </div>
    `).join('');
}

// ============================================================================
// 7. SUPERVISOR COMMAND & 7-DAY SHIFT MATRIX
// ============================================================================
async function renderSupervisorPortal() {
    await syncFromSupabase();
    const pending = DB.pending_requests.filter(r => r.request_status === 'Pending');
    document.getElementById('ticket-count-badge').innerText = pending.length;

    document.getElementById('supervisor-queue-list').innerHTML = pending.map(r => {
        const emp = DB.employees.find(e => e.employee_id === r.borrower_id);
        return `
            <div class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs space-y-2">
                <div class="flex justify-between">
                    <strong class="text-slate-900">${emp ? emp.full_name : r.borrower_id}</strong>
                    <span class="font-bold text-amber-800">${r.pattern_id} (${r.requested_shift})</span>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <button onclick="resolveMutexTicket(${r.request_id}, 'Approve')" class="bg-emerald-600 text-white py-1.5 rounded-lg font-bold">Grant</button>
                    <button onclick="resolveMutexTicket(${r.request_id}, 'Decline')" class="bg-slate-200 text-slate-700 py-1.5 rounded-lg font-bold">Deny</button>
                </div>
            </div>
        `;
    }).join('') || '<p class="text-xs text-slate-400 text-center py-8">No pending 15-minute lock tickets.</p>';

    const active = DB.pattern_assets.filter(p => p.operational_status === 'Active on Line');
    document.getElementById('active-deploy-badge').innerText = active.length;
    document.getElementById('supervisor-active-list').innerHTML = active.map(p => {
        const emp = DB.employees.find(e => e.employee_id === p.borrowed_by_id);
        return `
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex justify-between items-center">
                <div>
                    <p class="font-bold text-slate-900">${p.asset_id} • ${p.model_name}</p>
                    <p class="text-[11px] text-slate-500">${emp ? emp.full_name : p.borrowed_by_id} (${p.shift_checkout || 'Morning'})</p>
                </div>
                <span class="px-2 py-1 rounded bg-emerald-100 text-emerald-800 font-mono font-bold text-[11px]">Active</span>
            </div>
        `;
    }).join('');

    const floorOps = DB.employees.filter(e => e.employee_id.startsWith('CW-'));
    document.getElementById('operator-pool').innerHTML = floorOps.map(op => {
        const locked = selectedOperatorForAssign === op.employee_id;
        return `
            <div onclick="lockOperatorForCalendar('${op.employee_id}')" class="p-2 rounded-xl border ${locked ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-slate-50'} cursor-pointer flex items-center gap-2 text-xs">
                <img src="${op.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80'}" class="w-7 h-7 rounded-full object-cover shrink-0">
                <div class="truncate">
                    <p class="font-bold text-slate-900 truncate">${op.full_name}</p>
                    <p class="text-[10px] text-slate-500">${op.work_location_zone}</p>
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
            <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex flex-col gap-2">
                <div class="text-center font-bold text-xs text-slate-800 border-b border-slate-200 pb-1.5">${dayLabel}</div>
                ${shifts.map(sh => {
                    const assigned = DB.shift_assignments.filter(a => a.assigned_date === dateStr && a.shift_type === sh);
                    return `
                        <div onclick="tapDeployShift('${dateStr}', '${sh}')" class="min-h-[78px] p-2 rounded-lg bg-white border border-dashed border-slate-300 hover:border-blue-500 cursor-pointer flex flex-col gap-1">
                            <span class="text-[10px] font-semibold text-slate-400 uppercase">${sh}</span>
                            ${assigned.map(a => {
                                const w = DB.employees.find(e => e.employee_id === a.borrower_id);
                                return `
                                    <div class="px-2 py-1 rounded bg-blue-50 border border-blue-200 text-[11px] font-semibold text-blue-900 flex justify-between items-center">
                                        <span class="truncate">${w ? w.full_name.split(' ')[0] : a.borrower_id}</span>
                                        <button onclick="removeShiftSlot(${a.assignment_id}); event.stopPropagation();" class="text-slate-400 hover:text-rose-600 ml-1">&times;</button>
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
    showToast(`Assigned ${selectedOperatorForAssign} to ${shiftType} (${dateStr}).`);
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
        showToast(`Approved ${req.pattern_id} for ${req.borrower_id}.`);
    } else {
        await supa.from('pending_requests').update({ request_status: 'Declined' }).eq('request_id', reqId);
        await supa.from('pattern_assets').update({
            operational_status: 'Available in Room',
            borrowed_by_id: null
        }).eq('asset_id', req.pattern_id);
        showToast(`Denied request for ${req.pattern_id}.`, 'error');
    }
    await writeImmutableAudit(`MUTEX_${decision.toUpperCase()}`, 'Pending_Requests', reqId, req);
    await renderSupervisorPortal();
}

// ============================================================================
// 8. DESIGN, CAD & PATTERN ROOM HUB (WITH PHOTO UPLOADS)
// ============================================================================
async function renderDesignCadPortal() {
    await syncFromSupabase();
    const brands = DB.system_settings_audit.filter(s => s.record_type === 'PARAMETER' && s.category === 'Brand');
    const sizes = DB.system_settings_audit.filter(s => s.record_type === 'PARAMETER' && s.category === 'Size');
    const fabrics = DB.rmw_materials.filter(m => m.material_category === 'Cutting Floor Fabric');

    document.getElementById('cad-brand-select').innerHTML = brands.map(b => `<option value="${b.setting_value}">${b.setting_value}</option>`).join('');
    document.getElementById('cad-fabric-select').innerHTML = fabrics.map(f => `<option value="${f.material_code}">${f.material_code} • ${f.target_brand_usage}</option>`).join('');
    document.getElementById('pat-style-select').innerHTML = DB.cad_markers.map(m => `<option value="${m.style_code}">${m.style_code} • ${m.model_name}</option>`).join('');
    document.getElementById('pat-size-select').innerHTML = sizes.map(s => `<option value="${s.setting_value}">${s.setting_value}</option>`).join('');

    document.getElementById('cad-markers-mini-list').innerHTML = DB.cad_markers.map(m => `
        <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-3 text-xs">
            <img src="${m.sketch_url || 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=120'}" class="w-12 h-12 rounded-lg object-cover border">
            <div class="flex-1">
                <p class="font-bold text-slate-900">${m.model_name} <span class="text-purple-600">(${m.style_code})</span></p>
                <p class="text-[11px] text-slate-500">${m.brand_buyer} • Marker: ${m.cad_marker_id} • Fabric: ${m.cutting_floor_fabric_code}</p>
            </div>
        </div>
    `).join('');

    const dormant = DB.pattern_assets.filter(p => ['Pending Removal', 'Decommissioned'].includes(p.operational_status));
    document.getElementById('inactive-patterns-alert-box').innerHTML = dormant.map(p => `
        <div class="p-2 rounded-lg bg-rose-50 border border-rose-200 flex justify-between items-center">
            <span><strong>${p.asset_id}</strong> (${p.model_name})</span>
            <span class="text-rose-700 font-bold text-[10px]">${p.operational_status}</span>
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
        sketch_url: uploadedImg || 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=400&auto=format&fit=crop&q=80'
    };

    const { error } = await supa.from('cad_markers').insert([newRow]);
    if (error) return showToast(error.message, 'error');
    await writeImmutableAudit('CREATE_STYLE_MARKER', 'CAD_Markers', mkId, newRow);
    await renderDesignCadPortal();
    showToast(`Saved Style ${style} & Marker ${mkId} to Supabase.`);
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
    showToast(`Added cloth ${code} to RMW Catalog.`);
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
        image_url: uploadedImg || (type === 'Pattern Mold'
            ? 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&auto=format&fit=crop&q=80'
            : 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400&auto=format&fit=crop&q=80')
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
    showToast(`Registered ${id} with photo in Supabase!`);
}

// ============================================================================
// 9. SEWING ORDERS & RMW WAREHOUSE DISPATCH
// ============================================================================
async function renderSupplyPortal() {
    await syncFromSupabase();
    document.getElementById('sew-style-select').innerHTML = DB.cad_markers.map(m => `<option value="${m.style_code}">${m.style_code} • ${m.model_name}</option>`).join('');

    document.getElementById('sewing-orders-list').innerHTML = DB.cutting_orders.map(o => `
        <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex justify-between items-center text-xs">
            <div>
                <p class="font-bold text-slate-900">${o.order_id} • Style ${o.style_code} (Size ${o.target_size})</p>
                <p class="text-slate-500 mt-0.5">Bundle Qty: ${o.target_bundle_qty} • Line: ${o.assigned_line}</p>
            </div>
            <span class="px-2.5 py-1 rounded-full font-bold text-[10px] ${o.priority_level === 'Urgent' ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'}">${o.priority_level} • ${o.order_status}</span>
        </div>
    `).join('');

    document.getElementById('rmw-materials-list').innerHTML = DB.rmw_materials.map(m => `
        <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex justify-between items-center gap-3 text-xs">
            <div>
                <p class="font-bold text-slate-900">${m.material_code} • <span class="text-cyan-700">${m.material_category}</span></p>
                <p class="text-slate-600">${m.material_name_specs}</p>
                <p class="text-[11px] text-slate-400">Bay: ${m.rmw_storage_bay} • Status: <strong class="text-emerald-700">${m.lot_status}</strong></p>
            </div>
            <button onclick="dispatchRmwMaterial('${m.material_code}')" class="bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1.5 rounded-lg font-bold text-[11px] shrink-0">
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
    showToast(`Dispatched ${matCode} (${newStatus}).`);
}

// ============================================================================
// 10. FLOOR QUALITY CONTROL (QC) DEFECT FLAGGING
// ============================================================================
async function renderQcPortal() {
    await syncFromSupabase();
    document.getElementById('qc-asset-select').innerHTML = DB.pattern_assets.map(p => `<option value="${p.asset_id}">${p.asset_id} • ${p.model_name} (${p.operational_status})</option>`).join('');
    document.getElementById('qc-defect-select').innerHTML = DB.qc_defect_codes.map(d => `<option value="${d.defect_code}">${d.defect_code} • ${d.defect_name_symptom}</option>`).join('');
    previewDefectAction();

    document.getElementById('qc-logs-list').innerHTML = DB.qc_inspection_logs.map(l => `
        <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex justify-between items-center gap-3 text-xs">
            <div>
                <p class="font-bold text-slate-900">${l.qc_log_id} • Defect <span class="text-rose-600">${l.defect_code}</span> on Asset <span class="text-blue-600">${l.asset_id}</span> (${l.production_line})</p>
                <p class="text-slate-500 mt-0.5">Inspector: ${l.inspector_id} &rarr; Resolver: <strong>${l.resolver_id}</strong> • Ruined Plies: ${l.ruined_ply_count}</p>
            </div>
            <div class="flex items-center gap-2">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${l.resolution_status === 'Resolved' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${l.resolution_status}</span>
                ${l.resolution_status !== 'Resolved' ? `<button onclick="resolveQcLog('${l.qc_log_id}', '${l.asset_id}')" class="bg-emerald-600 text-white px-3 py-1 rounded-lg font-bold text-[11px]">Mark Fixed</button>` : ''}
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
        <p><strong>Target Asset Status:</strong> ${def.target_asset_status} • <strong>Resolver:</strong> ${def.assigned_resolver_role_id}</p>
        <p class="font-semibold"><strong>Action:</strong> ${def.mandatory_system_action}</p>
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
        resolution_status: `Open - ${def.target_asset_status}`
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
    showToast(`Resolved ${logId} & restored ${assetId}.`);
}

// ============================================================================
// 11. DIGITAL TEAM ROOT ADMIN, PROFILE PHOTOS & IMMUTABLE AUDIT LOG
// ============================================================================
async function renderAdminPortal() {
    await syncFromSupabase();
    const uniqueRoles = [...new Set(DB.employees.map(e => e.role_designation))];
    document.getElementById('reg-emp-role').innerHTML = uniqueRoles.map(r => `<option value="${r}">${r}</option>`).join('');

    document.getElementById('admin-emp-tbody').innerHTML = DB.employees.map(e => `
        <tr class="hover:bg-slate-50">
            <td class="p-2.5 flex items-center gap-2.5">
                <img src="${e.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80'}" class="w-7 h-7 rounded-full object-cover border">
                <div>
                    <p class="font-bold text-slate-900">${e.full_name}</p>
                    <p class="text-[10px] text-slate-500">${e.role_designation}</p>
                </div>
            </td>
            <td class="p-2.5 font-mono text-slate-600">${e.employee_id}</td>
            <td class="p-2.5">${e.department}</td>
            <td class="p-2.5">${e.work_location_zone}</td>
            <td class="p-2.5 text-right">
                <button onclick="removeEmployeeWithImmutableLog('${e.employee_id}')" class="text-rose-600 hover:underline text-[11px] font-semibold">Remove</button>
            </td>
        </tr>
    `).join('');

    const params = DB.system_settings_audit.filter(s => s.record_type === 'PARAMETER');
    document.getElementById('system-settings-list').innerHTML = params.map(p => `
        <li class="p-2.5 rounded-xl bg-white border border-slate-200 flex justify-between items-center">
            <span><strong class="text-blue-600">${p.category}:</strong> ${p.setting_value} ${p.prefix_data ? `(${p.prefix_data})` : ''}</span>
            <button onclick="deleteSystemParam(${p.record_id})" class="text-slate-400 hover:text-rose-600"><i class="ph-bold ph-trash"></i></button>
        </li>
    `).join('');

    document.getElementById('audit-count-pill').innerText = `${DB.immutable_audit_logs.length} Immutable Rows`;
    document.getElementById('immutable-audit-tbody').innerHTML = DB.immutable_audit_logs.map(a => `
        <tr class="hover:bg-slate-50">
            <td class="p-2.5 font-bold text-slate-900">#${a.audit_id}</td>
            <td class="p-2.5 text-slate-500">${new Date(a.created_at).toLocaleString()}</td>
            <td class="p-2.5"><strong>${a.actor_name}</strong> <span class="text-slate-400">(${a.actor_role})</span></td>
            <td class="p-2.5"><span class="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">${a.action_verb}</span></td>
            <td class="p-2.5">${a.target_entity} (${a.target_id})</td>
            <td class="p-2.5 text-slate-500 truncate max-w-xs">${a.immutable_snapshot}</td>
        </tr>
    `).join('');
}

function switchAdminSubTab(tab) {
    ['emp', 'params', 'records'].forEach(t => {
        document.getElementById(`admin-panel-${t}`).classList.add('hidden');
        document.getElementById(`adm-sub-${t}`).className = 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200';
    });
    document.getElementById(`admin-panel-${tab}`).classList.remove('hidden');
    document.getElementById(`adm-sub-${tab}`).className = 'px-4 py-2 rounded-xl bg-blue-600 text-white';
}

async function registerNewEmployee() {
    const id = document.getElementById('reg-emp-id').value.trim().toUpperCase();
    const name = document.getElementById('reg-emp-name').value.trim();
    const dept = document.getElementById('reg-emp-dept').value;
    const role = document.getElementById('reg-emp-role').value;
    const zone = document.getElementById('reg-emp-zone').value.trim() || 'Cutting Floor';
    const photoInput = document.getElementById('reg-emp-photo');

    if (!id || !name) return showToast('Enter Employee ID and Full Name.', 'error');
    const avatarData = await readAndCompressImage(photoInput, 200);

    const newEmp = {
        employee_id: id,
        full_name: name,
        department: dept,
        role_designation: role,
        work_location_zone: zone,
        active_checkout_count: 0,
        avatar_url: avatarData || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'
    };

    const { error } = await supa.from('employees').insert([newEmp]);
    if (error) return showToast(error.message, 'error');
    await writeImmutableAudit('REGISTER_EMPLOYEE', 'Employees', id, { id, name, dept, role, zone });

    const box = document.getElementById('emp-qr-preview-box');
    box.innerHTML = `<div class="p-3 bg-white rounded-xl border-2 border-emerald-600 inline-block"><div id="emp-qr-canvas"></div><p class="text-xs font-bold mt-1">${name}</p></div>`;
    new QRCode(document.getElementById('emp-qr-canvas'), { text: id, width: 84, height: 84, colorDark: '#065f46' });

    await renderAdminPortal();
    showToast(`Registered ${name} in Supabase.`);
}

async function removeEmployeeWithImmutableLog(empId) {
    const target = DB.employees.find(e => e.employee_id === empId);
    if (!target) return;
    await writeImmutableAudit('PURGE_EMPLOYEE_BACKUP', 'Employees', empId, target);
    await supa.from('employees').delete().eq('employee_id', empId);
    await renderAdminPortal();
    showToast(`Removed ${empId}. Full backup snapshot preserved in Immutable Audit Log.`);
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
    showToast(`Added ${cat}: ${val}`);
}

async function deleteSystemParam(recId) {
    const target = DB.system_settings_audit.find(s => s.record_id === recId);
    await writeImmutableAudit('REMOVE_PARAMETER', 'System_Settings_Audit', recId, target || {});
    await supa.from('system_settings_audit').delete().eq('record_id', recId);
    await renderAdminPortal();
}

async function uploadBrandLogo(inputEl, brandKey) {
    const dataUrl = await readAndCompressImage(inputEl, 300);
    if (!dataUrl) return;
    await supa.from('system_settings_audit').insert([{
        record_type: 'LOGO_CONFIG',
        category: brandKey,
        setting_value: dataUrl,
        prefix_data: 'LOGO',
        requested_by_id: 'DT-C-CA-01',
        request_status: 'Active'
    }]);
    await syncFromSupabase();
    showToast(`Updated ${brandKey} logo across headers & reports!`);
}

function applyCustomLogosFromDB() {
    const masLogo = DB.system_settings_audit.find(s => s.record_type === 'LOGO_CONFIG' && s.category === 'MAS');
    const bodyLogo = DB.system_settings_audit.find(s => s.record_type === 'LOGO_CONFIG' && s.category === 'BODYLINE');
    if (masLogo) {
        const el = document.getElementById('gw-mas-logo');
        if (el) { el.src = masLogo.setting_value; el.classList.remove('hidden'); }
    }
    if (bodyLogo) {
        const el = document.getElementById('gw-bodyline-logo');
        if (el) { el.src = bodyLogo.setting_value; el.classList.remove('hidden'); }
    }
}

// ============================================================================
// 12. PROTOCOL COMMUNICATOR & APPROVAL ENGINE (WITH SUPABASE DRAFTS & ANTI-SPAM)
// ============================================================================
function updateCommUnreadBadge() {
    if (!currentLoggedInUser) return;
    const myId = currentLoggedInUser.employee_id;
    const pendingForMe = DB.department_communications.filter(
        c => c.receiver_id === myId && c.comm_status === 'Pending Approval'
    ).length;
    document.getElementById('comm-unread-badge').innerText = pendingForMe;
}

function toggleCommDrawer() {
    const win = document.getElementById('comm-drawer-window');
    win.classList.toggle('hidden');
    if (!win.classList.contains('hidden')) {
        switchCommTab('inbox');
    }
}

function openCommDrawer(tab = 'compose', preReceiver = null, preCategory = null) {
    document.getElementById('comm-drawer-window').classList.remove('hidden');
    switchCommTab(tab, preReceiver, preCategory);
}

// HIERARCHY PROTOCOL RULE: WHO CAN MESSAGE WHOM (BLOCKS RANDOM SPAM TO DEPT HEAD)
function getPermittedRecipientsForUser(user) {
    if (!user) return [];
    const id = user.employee_id.toUpperCase();
    // Tier-2 Leaders allowed to contact Department Head (DH-01) directly
    const canContactDeptHead = ['CSE-01', 'CQCE-01', 'PR-C-PC-01', 'CADC-C-01', 'CDTE-01', 'DT-C-CA-01'].includes(id);

    return DB.employees.filter(e => {
        if (e.employee_id === user.employee_id) return false;
        if (e.employee_id === 'DH-01' && !canContactDeptHead) return false;
        // Show Department Head, Executives, Coordinators, Supervisors, and Admins
        return !e.employee_id.startsWith('CW-');
    });
}

function switchCommTab(tab, preReceiver = null, preCategory = null) {
    activeCommTab = tab;
    ['inbox', 'compose', 'drafts', 'history'].forEach(t => {
        const btn = document.getElementById(`comm-tab-${t}`);
        btn.className = t === tab
            ? 'py-2.5 border-b-2 border-blue-600 text-blue-600 bg-white'
            : 'py-2.5 border-b-2 border-transparent hover:text-slate-900';
    });

    const body = document.getElementById('comm-body-content');
    const myId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'DH-01';

    if (tab === 'inbox') {
        const inbox = DB.department_communications.filter(c => c.receiver_id === myId && c.comm_status !== 'Draft');
        body.innerHTML = inbox.map(c => `
            <div class="p-3.5 rounded-xl bg-white border border-slate-200 shadow-sm mb-2.5 space-y-2">
                <div class="flex justify-between items-center">
                    <span class="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[10px] uppercase">${c.protocol_category}</span>
                    <span class="font-mono text-[10px] text-slate-400">Ref: ${c.linked_reference_id}</span>
                </div>
                <p class="font-bold text-slate-900">${c.subject_line}</p>
                <p class="text-slate-600">${c.message_body}</p>
                <p class="text-[10px] text-slate-400">From: <strong>${c.sender_name}</strong> (${c.sender_role})</p>
                ${c.comm_status === 'Pending Approval' ? `
                    <div class="grid grid-cols-2 gap-2 pt-1">
                        <button onclick="resolveCommItem(${c.comm_id}, 'Approved')" class="bg-emerald-600 text-white py-1.5 rounded-lg font-bold">Approve</button>
                        <button onclick="resolveCommItem(${c.comm_id}, 'Rejected')" class="bg-rose-600 text-white py-1.5 rounded-lg font-bold">Reject</button>
                    </div>
                ` : `<span class="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[10px]">Status: ${c.comm_status}</span>`}
            </div>
        `).join('') || '<p class="text-center text-slate-400 py-10">No incoming protocol requests in your inbox.</p>';
    } else if (tab === 'compose') {
        const recipients = getPermittedRecipientsForUser(currentLoggedInUser);
        const refOptions = [
            ...DB.pattern_assets.map(p => `${p.asset_id} (${p.model_name})`),
            ...DB.cutting_orders.map(o => `${o.order_id} (Style ${o.style_code})`),
            ...DB.cad_markers.map(m => `${m.style_code} (${m.brand_buyer})`),
            'Brand Parameter: Add New Brand',
            'Brand Parameter: Put Brand on Hold'
        ];

        body.innerHTML = `
            <div class="space-y-3 bg-white p-3.5 rounded-xl border border-slate-200">
                <div>
                    <label class="text-[11px] font-bold text-slate-600 block mb-1">1. Target Recipient (Hierarchy Filtered)</label>
                    <select id="comm-receiver" class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg">
                        ${recipients.map(r => `<option value="${r.employee_id}" ${preReceiver === r.employee_id ? 'selected' : ''}>${r.full_name} — ${r.role_designation}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="text-[11px] font-bold text-slate-600 block mb-1">2. Mandatory Protocol Reason</label>
                    <select id="comm-category" class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg">
                        <option value="Executive Approval" ${preCategory === 'Executive Approval' ? 'selected' : ''}>Executive Approval Request</option>
                        <option value="Parameter Request" ${preCategory === 'Parameter Request' ? 'selected' : ''}>System Parameter / Brand Change Request</option>
                        <option value="QC Escalation">Quality Control Defect Escalation</option>
                        <option value="Line Directive">Production Line & Shift Directive</option>
                    </select>
                </div>
                <div>
                    <label class="text-[11px] font-bold text-slate-600 block mb-1">3. Linked System Reference ID (Anti-Spam Lock)</label>
                    <select id="comm-ref-id" class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg">
                        ${refOptions.map(ref => `<option value="${ref.split(' ')[0]}">${ref}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="text-[11px] font-bold text-slate-600 block mb-1">4. Official Subject Line</label>
                    <input id="comm-subject" type="text" placeholder="Short actionable title..." class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg">
                </div>
                <div>
                    <label class="text-[11px] font-bold text-slate-600 block mb-1">5. Request Details & Justification</label>
                    <textarea id="comm-message" rows="3" placeholder="Provide operational context for approval..." class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"></textarea>
                </div>
                <div class="grid grid-cols-2 gap-2 pt-1">
                    <button onclick="saveOrSendComm('Draft')" class="bg-slate-200 hover:bg-slate-300 text-slate-800 py-2 rounded-lg font-bold">Save as Draft</button>
                    <button onclick="saveOrSendComm('Pending Approval')" class="bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-bold">Transmit Request</button>
                </div>
            </div>
        `;
    } else if (tab === 'drafts') {
        const drafts = DB.department_communications.filter(c => c.sender_id === myId && c.comm_status === 'Draft');
        body.innerHTML = drafts.map(d => `
            <div class="p-3.5 rounded-xl bg-white border border-slate-200 mb-2.5 space-y-2">
                <div class="flex justify-between">
                    <span class="font-bold text-amber-700">[DRAFT] To: ${d.receiver_name}</span>
                    <span class="font-mono text-[10px] text-slate-400">Ref: ${d.linked_reference_id}</span>
                </div>
                <p class="font-bold text-slate-900">${d.subject_line}</p>
                <p class="text-slate-600">${d.message_body}</p>
                <div class="grid grid-cols-2 gap-2 pt-1">
                    <button onclick="transmitSavedDraft(${d.comm_id})" class="bg-blue-600 text-white py-1.5 rounded-lg font-bold">Transmit Now</button>
                    <button onclick="deleteSavedDraft(${d.comm_id})" class="bg-slate-100 text-rose-600 py-1.5 rounded-lg font-bold">Delete Draft</button>
                </div>
            </div>
        `).join('') || '<p class="text-center text-slate-400 py-10">No saved drafts in Supabase.</p>';
    } else {
        const hist = DB.department_communications.filter(c => (c.sender_id === myId || c.receiver_id === myId) && c.comm_status !== 'Draft');
        body.innerHTML = hist.map(c => `
            <div class="p-3 rounded-xl bg-white border border-slate-200 mb-2 space-y-1">
                <div class="flex justify-between text-[10px] text-slate-400">
                    <span>${c.sender_name} &rarr; ${c.receiver_name}</span>
                    <span class="font-bold ${c.comm_status === 'Approved' ? 'text-emerald-600' : c.comm_status === 'Rejected' ? 'text-rose-600' : 'text-amber-600'}">${c.comm_status}</span>
                </div>
                <p class="font-bold text-slate-900">${c.subject_line} (${c.linked_reference_id})</p>
                <p class="text-slate-600">${c.message_body}</p>
            </div>
        `).join('') || '<p class="text-center text-slate-400 py-10">No transmission history yet.</p>';
    }
}

async function saveOrSendComm(targetStatus) {
    const recId = document.getElementById('comm-receiver').value;
    const cat = document.getElementById('comm-category').value;
    const refId = document.getElementById('comm-ref-id').value;
    const subj = document.getElementById('comm-subject').value.trim();
    const msg = document.getElementById('comm-message').value.trim();

    if (!subj || !msg) return showToast('Enter both Subject Line and Request Details.', 'error');

    // Anti-Spam Protocol: Block duplicate pending requests for the same Reference ID & Recipient
    if (targetStatus === 'Pending Approval') {
        const duplicate = DB.department_communications.some(
            c => c.receiver_id === recId && c.linked_reference_id === refId && c.comm_status === 'Pending Approval'
        );
        if (duplicate) {
            return showToast(`Anti-Spam Protocol: An active request for ${refId} is already Pending with this recipient.`, 'error');
        }
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
    await writeImmutableAudit(targetStatus === 'Draft' ? 'SAVE_COMM_DRAFT' : 'TRANSMIT_COMM_REQ', 'Department_Communications', refId, payload);
    await syncFromSupabase();
    switchCommTab(targetStatus === 'Draft' ? 'drafts' : 'history');
    showToast(targetStatus === 'Draft' ? 'Draft saved to Supabase.' : `Official Request transmitted to ${recObj.full_name}.`);
}

async function transmitSavedDraft(commId) {
    await supa.from('department_communications').update({ comm_status: 'Pending Approval' }).eq('comm_id', commId);
    await writeImmutableAudit('TRANSMIT_DRAFT', 'Department_Communications', commId, { status: 'Pending Approval' });
    await syncFromSupabase();
    switchCommTab('history');
    showToast('Draft transmitted for approval!');
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
    showToast(`Request marked as ${decision}.`);
}

// ============================================================================
// 13. SYSTEM-GENERATED FORMAL A4 REPORTS (NO SIGN-OFF LINES) & VISUAL DB
// ============================================================================
function switchReportMode(mode) {
    document.getElementById('reports-mgmt-container').classList.toggle('hidden', mode !== 'mgmt');
    document.getElementById('reports-vdb-container').classList.toggle('hidden', mode !== 'vdb');
    document.getElementById('rep-mode-mgmt').className = mode === 'mgmt' ? 'px-4 py-2 rounded-xl bg-blue-600 text-white' : 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700';
    document.getElementById('rep-mode-vdb').className = mode === 'vdb' ? 'px-4 py-2 rounded-xl bg-blue-600 text-white' : 'px-4 py-2 rounded-xl bg-slate-100 text-slate-700';
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

    sel.innerHTML = `<option value="ALL">Show All Groups (${groups.length})</option>` +
        groups.map(g => `<option value="${g}">Filter: ${g}</option>`).join('');
}

function renderGroupedReport() {
    const repNo = parseInt(document.getElementById('rep-type-select').value);
    const filterVal = document.getElementById('rep-group-filter').value;
    const customTitle = document.getElementById('rep-custom-title').value.trim();
    const customNote = document.getElementById('rep-custom-note').value.trim();
    const canvas = document.getElementById('printable-report-canvas');
    const nowStr = new Date().toLocaleString();
    const roleFor = currentLoggedInUser ? `${currentLoggedInUser.full_name} (${currentLoggedInUser.role_designation})` : 'Cutting Department Operations';

    const defaultTitles = {
        1: 'PATTERN BLOCKS & 3D MOLDS UTILIZATION TELEMETRY REPORT',
        2: 'QUALITY CONTROL DEFECT & RE-CUT ROOT CAUSE ANALYSIS REPORT',
        3: 'DAILY SHIFT SCHEDULE & LINE OPERATOR DEPLOYMENT REPORT',
        4: 'RAW MATERIAL WAREHOUSE (RMW) SUBSTRATE & FABRIC DISPATCH REPORT'
    };

    let bodyGroupsHtml = '';
    let summaryStripHtml = '';

    if (repNo === 1) {
        let brands = [...new Set(DB.pattern_assets.map(p => p.brand_buyer))];
        if (filterVal !== 'ALL') brands = brands.filter(b => b === filterVal);
        const total = DB.pattern_assets.length;
        const active = DB.pattern_assets.filter(p => p.operational_status === 'Active on Line').length;
        const avail = DB.pattern_assets.filter(p => p.operational_status === 'Available in Room').length;
        const flagged = total - active - avail;

        summaryStripHtml = `
            <div class="grid grid-cols-4 gap-3 mb-6 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                <div><span class="text-slate-500 block">Total Tooling Assets</span><strong class="text-base text-slate-900">${total} Units</strong></div>
                <div><span class="text-slate-500 block">Active on Cutting Lines</span><strong class="text-base text-blue-700">${active} Units (${Math.round(active/total*100)}%)</strong></div>
                <div><span class="text-slate-500 block">Available in Room</span><strong class="text-base text-emerald-700">${avail} Units</strong></div>
                <div><span class="text-slate-500 block">Flagged / Dormant</span><strong class="text-base text-rose-700">${flagged} Units</strong></div>
            </div>
        `;

        bodyGroupsHtml = brands.map(brand => {
            const items = DB.pattern_assets.filter(p => p.brand_buyer === brand);
            return `
                <div class="mb-5 border border-slate-300 rounded-lg overflow-hidden">
                    <div class="bg-slate-100 px-4 py-2 border-b border-slate-300 flex justify-between items-center text-xs font-bold text-slate-900">
                        <span>BUYER BRAND GROUP: ${brand.toUpperCase()}</span>
                        <span>Group Subtotal: ${items.length} Tooling Assets</span>
                    </div>
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-50 text-[10px] uppercase text-slate-600 border-b border-slate-200">
                            <tr><th class="p-2">Asset ID</th><th class="p-2">Type</th><th class="p-2">Model & Style</th><th class="p-2">Size</th><th class="p-2">Rack / Cabinet</th><th class="p-2">Last Used</th><th class="p-2">Current State</th></tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                            ${items.map(i => `
                                <tr>
                                    <td class="p-2 font-mono font-bold">${i.asset_id}</td>
                                    <td class="p-2">${i.tooling_type}</td>
                                    <td class="p-2">${i.model_name} (${i.style_code})</td>
                                    <td class="p-2">${i.size_category}</td>
                                    <td class="p-2">${i.storage_location}</td>
                                    <td class="p-2">${i.last_used_date}</td>
                                    <td class="p-2 font-semibold">${i.operational_status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');
    } else if (repNo === 2) {
        let cats = [...new Set(DB.qc_defect_codes.map(d => d.fault_category))];
        if (filterVal !== 'ALL') cats = cats.filter(c => c === filterVal);
        summaryStripHtml = `
            <div class="grid grid-cols-3 gap-3 mb-6 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                <div><span class="text-slate-500 block">Standard QC Protocols</span><strong class="text-base text-slate-900">${DB.qc_defect_codes.length} Codes</strong></div>
                <div><span class="text-slate-500 block">Logged Floor Incidents</span><strong class="text-base text-rose-700">${DB.qc_inspection_logs.length} Incidents</strong></div>
                <div><span class="text-slate-500 block">Total Ruined Plies</span><strong class="text-base text-slate-900">${DB.qc_inspection_logs.reduce((s, x) => s + (x.ruined_ply_count || 0), 0)} Plies</strong></div>
            </div>
        `;
        bodyGroupsHtml = cats.map(cat => {
            const codes = DB.qc_defect_codes.filter(d => d.fault_category === cat);
            return `
                <div class="mb-5 border border-slate-300 rounded-lg overflow-hidden">
                    <div class="bg-slate-100 px-4 py-2 border-b border-slate-300 flex justify-between text-xs font-bold">
                        <span>FAULT CATEGORY GROUP: ${cat.toUpperCase()}</span>
                        <span>Subtotal: ${codes.length} Protocols</span>
                    </div>
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-50 text-[10px] uppercase text-slate-600 border-b border-slate-200">
                            <tr><th class="p-2">Code</th><th class="p-2">Symptom</th><th class="p-2">Severity</th><th class="p-2">Resolver</th><th class="p-2">Automated System Action</th></tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
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
                <div class="mb-5 border border-slate-300 rounded-lg overflow-hidden">
                    <div class="bg-slate-100 px-4 py-2 border-b border-slate-300 flex justify-between text-xs font-bold">
                        <span>SHIFT GROUP: ${sh.toUpperCase()} SHIFT</span>
                        <span>Subtotal: ${rows.length} Operators Assigned</span>
                    </div>
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-50 text-[10px] uppercase text-slate-600 border-b border-slate-200">
                            <tr><th class="p-2">Ref ID</th><th class="p-2">Operator</th><th class="p-2">Supervisor</th><th class="p-2">Date</th><th class="p-2">Line</th></tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                            ${rows.map(r => `<tr><td class="p-2 font-mono">#${r.assignment_id}</td><td class="p-2 font-bold">${r.borrower_id}</td><td class="p-2">${r.supervisor_id}</td><td class="p-2">${r.assigned_date}</td><td class="p-2">${r.production_line}</td></tr>`).join('') || '<tr><td colspan="5" class="p-3 text-slate-400">No assignments recorded.</td></tr>'}
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
                <div class="mb-5 border border-slate-300 rounded-lg overflow-hidden">
                    <div class="bg-slate-100 px-4 py-2 border-b border-slate-300 flex justify-between text-xs font-bold">
                        <span>MATERIAL GROUP: ${cat.toUpperCase()}</span>
                        <span>Subtotal: ${items.length} Stock Lots</span>
                    </div>
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-50 text-[10px] uppercase text-slate-600 border-b border-slate-200">
                            <tr><th class="p-2">Code</th><th class="p-2">Material Specs</th><th class="p-2">Target Usage</th><th class="p-2">Bay</th><th class="p-2">Status</th></tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                            ${items.map(m => `<tr><td class="p-2 font-mono font-bold">${m.material_code}</td><td class="p-2">${m.material_name_specs}</td><td class="p-2">${m.target_brand_usage}</td><td class="p-2">${m.rmw_storage_bay}</td><td class="p-2 font-semibold">${m.lot_status}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');
    }

    // RENDER FORMAL A4 LETTERHEAD WITH MAS (LEFT), CDMS+ (CENTER), BODYLINE (RIGHT) & NO SIGN-OFF LINES
    canvas.innerHTML = `
        <div class="border-b-2 border-slate-900 pb-4 mb-5 flex justify-between items-center">
            <div class="flex items-center gap-2">
                <span class="bg-red-700 text-white font-black px-2.5 py-1 rounded text-xs">MAS</span>
                <span class="text-xs font-bold text-slate-700 uppercase">MAS Intimates</span>
            </div>
            <div class="text-center">
                <p class="text-[10px] font-mono uppercase tracking-widest text-slate-500">CDMS+ Automated System Report • REP-0${repNo}</p>
                <h2 class="text-lg font-black text-slate-900 uppercase">${customTitle || defaultTitles[repNo]}</h2>
                <p class="text-[11px] text-slate-600">Bodyline (Pvt) Ltd • Gurugoda, Horana Plant 1</p>
            </div>
            <div class="text-right">
                <span class="bg-slate-900 text-white font-extrabold px-2.5 py-1 rounded text-xs uppercase">BODYLINE</span>
            </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5 text-[11px] bg-slate-100 p-3 rounded-lg border border-slate-200">
            <div><span class="text-slate-500 block">System Timestamp:</span><strong>${nowStr}</strong></div>
            <div><span class="text-slate-500 block">Generated For:</span><strong>${roleFor}</strong></div>
            <div><span class="text-slate-500 block">Group Filter:</span><strong>${filterVal}</strong></div>
            <div><span class="text-slate-500 block">Operational Note:</span><strong>${customNote || 'Live Database Snapshot'}</strong></div>
        </div>

        ${summaryStripHtml}
        ${bodyGroupsHtml}

        <div class="mt-6 pt-3 border-t border-slate-300 flex justify-between items-center text-[10px] font-mono text-slate-500">
            <span>SYSTEM-GENERATED TELEMETRY REPORT • CDMS+ POSTGRESQL ENGINE</span>
            <span>NO MANUAL SIGN-OFF REQUIRED • VERIFIED BY SYSTEM AUDIT</span>
        </div>
    `;
}

// VISUAL DATABASE & FILE DESIGN EXPLORER
const VDB_TABLES = [
    'employees', 'pattern_assets', 'cad_markers', 'rmw_materials', 'qc_defect_codes',
    'shift_assignments', 'pending_requests', 'cutting_orders', 'qc_inspection_logs',
    'system_settings_audit', 'department_communications', 'immutable_audit_logs'
];

function renderVisualDatabaseExplorer(tableName) {
    document.getElementById('vdb-table-tabs').innerHTML = VDB_TABLES.map((t, idx) => `
        <button onclick="renderVisualDatabaseExplorer('${t}')" class="px-3 py-1.5 rounded-lg ${t === tableName ? 'bg-blue-600 text-white font-bold' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}">
            TBL-${(idx + 1).toString().padStart(2, '0')}: ${t} (${(DB[t] || []).length})
        </button>
    `).join('');

    const rows = DB[tableName] || [];
    document.getElementById('vdb-table-title').innerText = `Live Supabase Table: ${tableName} (${rows.length} Rows)`;
    if (rows.length === 0) {
        document.getElementById('vdb-table-rows').innerHTML = '<p class="text-slate-400 py-6">No rows in table.</p>';
        return;
    }
    const cols = Object.keys(rows[0]);
    document.getElementById('vdb-schema-spec').innerHTML = `
        <table class="w-full text-left">
            <thead class="bg-slate-100 text-[10px] uppercase text-slate-600 border-b border-slate-200">
                <tr><th class="p-2">Field Name</th><th class="p-2">Key / Type</th></tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                ${cols.map((c, i) => `<tr><td class="p-2 font-mono font-bold text-slate-900">${c}</td><td class="p-2 text-blue-600">${i === 0 ? 'PRIMARY KEY' : 'ATTRIBUTE'}</td></tr>`).join('')}
            </tbody>
        </table>
    `;

    document.getElementById('vdb-table-rows').innerHTML = `
        <table class="w-full text-left">
            <thead class="bg-slate-100 text-[10px] uppercase text-slate-600 border-b border-slate-200">
                <tr>${cols.map(c => `<th class="p-2">${c}</th>`).join('')}</tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-mono text-[11px]">
                ${rows.map(r => `<tr class="hover:bg-slate-50">${cols.map(c => `<td class="p-2 truncate max-w-[180px]">${r[c] !== null ? String(r[c]) : '-'}</td>`).join('')}</tr>`).join('')}
            </tbody>
        </table>
    `;
}