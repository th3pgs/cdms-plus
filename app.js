/*
 * CDMS+ Application Script
 * Handles Supabase synchronization, local sandbox mode, role-based portals,
 * Pattern Room QR kiosk workflows, and printable A4 reports.
 */


// --- Database Connection & Sandbox State (1 = Live Supabase, 0 = Local Sandbox) ---

const SUPABASE_URL = 'https://uvfmircbplfqkgkmzssb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NZNswR7y9y-oSJIC-unRvw_wioNx760';
const liveSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const MODE_STORAGE_KEY = 'CDMS_ACTIVE_MODE_1_0';
const SANDBOX_DB_KEY = 'CDMS_TESTING_SANDBOX_DB';

// Formats a Date as YYYY-MM-DD in local plant time so shifts after midnight don't roll back to UTC yesterday
function getLocalDateString(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

let sandboxMode = '1';
let authLockOpen = false;

let resolvedMasLogoUrl = './mas-logo.png';
let resolvedBodylineLogoUrl = './bodyline-logo.png';
let cameraPermissionState = 'prompt';
let html5QrScanner = null;
let qcQrScanner = null;

let currentLoggedInUser = null;
let currentMode = 'gateway';
let kioskAuthMode = 'unlock';
let idleSecondsRemaining = 300;
let selectedOperatorForAssign = null;
let supervisorPoolLineFilter = 'ALL';
let activeCommTab = 'inbox';
let mutexPollInterval = null;
let isAuthBusy = false;
let isShiftAssignBusy = false;
let isForcedPasswordReset = false;
let selectedQcSeverityTier = 'ALL';
let currentInspectedStaffId = null;
let lastToastMessage = '';
let lastToastTime = 0;

function createEmptyDatabase() {
    return {
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
        immutable_audit_logs: [],
        discarded_trash_vault: []
    };
}

let DB = createEmptyDatabase();

function saveSandboxDB() {
    // Sandbox data is kept strictly in memory and never persisted across sessions
}

const AUTO_ID_COLS = {
    shift_assignments: 'assignment_id',
    pending_requests: 'request_id',
    system_settings_audit: 'record_id',
    department_communications: 'comm_id',
    immutable_audit_logs: 'audit_id',
    discarded_trash_vault: 'trash_id'
};

const supa = {
    from: (tableName) => {
        if (sandboxMode === '1') {
            return liveSupabase.from(tableName);
        }
        const key = tableName.toLowerCase();
        return {
            select: () => ({
                order: () => ({
                    limit: async () => ({ data: DB[key] || [], error: null }),
                    then: (resolve) => resolve({ data: DB[key] || [], error: null })
                }),
                then: (resolve) => resolve({ data: DB[key] || [], error: null })
            }),
            insert: async (rows) => {
                if (!DB[key]) DB[key] = [];
                const idCol = AUTO_ID_COLS[key];
                rows.forEach(r => {
                    const copy = { ...r };
                    if (idCol && !copy[idCol]) {
                        copy[idCol] = DB[key].length > 0
                            ? Math.max(...DB[key].map(x => Number(x[idCol]) || 0)) + 1
                            : 1;
                    }
                    if (!copy.created_at) copy.created_at = new Date().toISOString();
                    if (!copy.logged_timestamp) copy.logged_timestamp = new Date().toISOString();
                    if (!copy.deleted_at) copy.deleted_at = new Date().toISOString();
                    DB[key].unshift(copy);
                });
                saveSandboxDB();
                return { data: rows, error: null };
            },
            update: (fields) => ({
                eq: async (col, val) => {
                    if (DB[key]) {
                        DB[key].forEach(item => {
                            if (String(item[col]) === String(val)) {
                                Object.assign(item, fields);
                            }
                        });
                        saveSandboxDB();
                    }
                    return { data: null, error: null };
                }
            }),
            delete: () => ({
                eq: async (col, val) => {
                    if (DB[key]) {
                        DB[key] = DB[key].filter(item => String(item[col]) !== String(val));
                        saveSandboxDB();
                    }
                    return { data: null, error: null };
                }
            })
        };
    }
};

function updateGatewayStatusLabel() {
    const statusLbl = document.getElementById('db-status-label');
    if (!statusLbl) return;

    if (sandboxMode === '0') {
        statusLbl.innerText = 'Sandbox Online';
    } else if (authLockOpen) {
        statusLbl.innerText = 'Online Only';
    } else {
        statusLbl.innerText = 'Online Secured';
    }
}

function updateModeButtonUI() {
    const btn = document.getElementById('mode-switch-btn');
    const letter = document.getElementById('mode-switch-letter');
    const banner = document.getElementById('sandbox-warning-banner');

    if (banner) {
        banner.classList.toggle('hidden', sandboxMode !== '0');
    }

    if (!btn || !letter) return;

    if (sandboxMode === '0') {
        letter.innerText = '0';
        btn.classList.remove('ctrl-btn-minimal-light');
        btn.classList.add('ctrl-btn-minimal-dark');
    } else {
        letter.innerText = '1';
        btn.classList.remove('ctrl-btn-minimal-dark');
        btn.classList.add('ctrl-btn-minimal-light');
    }
    updateGatewayStatusLabel();
}

async function toggleSandboxMode() {
    localStorage.removeItem(SANDBOX_DB_KEY);
    localStorage.removeItem(MODE_STORAGE_KEY);

    if (sandboxMode === '1') {
        sandboxMode = '0';
        DB = createSandboxDemoDatabase();
        if (currentMode !== 'gateway') {
            returnToWelcomeScreenImmediate();
        }
        updateModeButtonUI();
        populateQuickRoleSelect();
        showToast('Sandbox Mode (0): Loaded temporary demo simulation data.');
    } else {
        sandboxMode = '1';
        DB = createEmptyDatabase();
        if (currentMode !== 'gateway') {
            returnToWelcomeScreenImmediate();
        }
        updateModeButtonUI();
        await fetchLiveSupabaseIntoDB();
        populateQuickRoleSelect();
        showToast('Live Mode (1): Sandbox data removed and live database restored.');
    }
}


// --- Sandbox Simulation Dataset, Placeholder Portraits & Brand Logo Loader ---
// Generates a temporary in-memory demo dataset for Sandbox Mode (0) and renders local SVG portraits.

function createSandboxDemoDatabase() {
    const todayStr = getLocalDateString();
    const tomorrowObj = new Date();
    tomorrowObj.setDate(tomorrowObj.getDate() + 1);
    const tomorrowStr = getLocalDateString(tomorrowObj);
    const nowIso = new Date().toISOString();

    const employees = [
        { employee_id: 'DH-01', full_name: 'Jackson Emmanuel', department: 'Cutting', role_designation: 'Cutting Dpt. Head', work_location_zone: 'CD Operations Office', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CSE-01', full_name: 'Aaron Emmanuel', department: 'Cutting', role_designation: 'Cutting Senior Executive', work_location_zone: 'CD Operations Office', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CS-L1-01', full_name: 'Nathaniel Perera', department: 'Cutting', role_designation: 'Cutting Supervisors', work_location_zone: 'Cutting Floor', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CS-L2-01', full_name: 'Rifa Mohamed', department: 'Cutting', role_designation: 'Cutting Supervisors', work_location_zone: 'Cutting Floor', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CS-L3-01', full_name: 'Oshani Wickramasinghe', department: 'Cutting', role_designation: 'Cutting Supervisors', work_location_zone: 'Cutting Floor', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CW-L1-FS-01', full_name: 'Nimal Perera', department: 'Cutting', role_designation: 'Fabric Spreaders', work_location_zone: 'Cutting Floor - Line 1', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CW-L2-FS-01', full_name: 'Kasun Wijesinghe', department: 'Cutting', role_designation: 'Fabric Spreaders', work_location_zone: 'Cutting Floor - Line 2', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CW-L3-FS-01', full_name: 'Tharindu Jayawardena', department: 'Cutting', role_designation: 'Fabric Spreaders', work_location_zone: 'Cutting Floor - Line 3', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CW-L1-CMO-01', full_name: 'Gayan Abeysekara', department: 'Cutting', role_designation: 'Cutting Machine Operators', work_location_zone: 'Cutting Floor - Line 1', active_checkout_count: 1, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CW-L1-CMO-02', full_name: 'Dilshan Madushanka', department: 'Cutting', role_designation: 'Cutting Machine Operators', work_location_zone: 'Cutting Floor - Line 1', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CW-L2-CMO-01', full_name: 'Akila Senanayake', department: 'Cutting', role_designation: 'Cutting Machine Operators', work_location_zone: 'Cutting Floor - Line 2', active_checkout_count: 1, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CW-L3-CMO-01', full_name: 'Supun Karunaratne', department: 'Cutting', role_designation: 'Cutting Machine Operators', work_location_zone: 'Cutting Floor - Line 3', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CW-L1-BU-01', full_name: 'Shehani Silva', department: 'Cutting', role_designation: 'Bundling Unit', work_location_zone: 'Cutting Floor - Line 1', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CW-L2-BU-01', full_name: 'Amila Perera', department: 'Cutting', role_designation: 'Bundling Unit', work_location_zone: 'Cutting Floor - Line 2', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'SDC-C-01', full_name: 'Tharindu Perera', department: 'Sewing - Cutting', role_designation: 'Sewing Dpt. Coordinator', work_location_zone: 'Sewing Department', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CQCE-01', full_name: 'Imesha Fernando', department: 'QC - Cutting', role_designation: 'Quality Control Executive', work_location_zone: 'CD Operations Office', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'QCI-C-01', full_name: 'Mohamed Faiz', department: 'QC - Cutting', role_designation: 'Quality Control Inspectors', work_location_zone: 'Cutting Floor', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'QCI-C-02', full_name: 'Nadeesha Kumari', department: 'QC - Cutting', role_designation: 'Quality Control Inspectors', work_location_zone: 'Cutting Floor', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'RMWC-C-01', full_name: 'Ahamed Niyas', department: 'RMW - Cutting', role_designation: 'RMW Coordinators', work_location_zone: 'Raw Material Warehouse', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'DDC-C-01', full_name: 'Kavindi Perera', department: 'Design - Cutting', role_designation: 'Design Dpt. Coordinators', work_location_zone: 'Design Department', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CADC-C-01', full_name: 'Sachith Perera', department: 'Cutting - CAD', role_designation: 'CAD Coordinators', work_location_zone: 'CAD Room', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CAD-C-MM-01', full_name: 'Ayesha Nazeer', department: 'Cutting - CAD', role_designation: 'Marker Makers', work_location_zone: 'CAD Room', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CAD-C-CPH-01', full_name: 'Rizwan Ashraff', department: 'Cutting - CAD', role_designation: 'CAD Pattern Handlers', work_location_zone: 'CAD Room', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'PR-C-PC-01', full_name: 'Kavya Tharmalingam', department: 'Cutting - Pattern', role_designation: 'Pattern Coordinators', work_location_zone: 'Pattern Room', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'PR-C-PH-01', full_name: 'Daniel Joseph', department: 'Cutting - Pattern', role_designation: 'Pattern Handlers', work_location_zone: 'Pattern Room', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'CDTE-01', full_name: 'Arjun Rajan', department: 'Digital - Cutting', role_designation: 'Digital Team Executive', work_location_zone: 'CD Operations Office', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'DT-C-CST-01', full_name: 'Shehani Mel', department: 'Digital - Cutting', role_designation: 'CDMS Support Team', work_location_zone: 'CD Operations Office', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' },
        { employee_id: 'DT-C-CA-01', full_name: 'Ashan Mendis', department: 'Digital - Cutting', role_designation: 'CDMS Admins', work_location_zone: 'CD Operations Office', active_checkout_count: 0, avatar_url: '', account_password: 'bodyline123', account_status: 'Active' }
    ].map(e => ({ ...e, avatar_url: e.avatar_url || generateWorkforcePortraitSvg(e.employee_id) }));

    const rmw_materials = [
        { material_code: 'MAT-CRD-01', material_category: 'CAD Tooling Material', material_name_specs: 'Heavy Kraft Pattern Cardboard (350 GSM)', target_brand_usage: 'CAD Pattern Blocks', rmw_storage_bay: 'RMW-Bay-T1', managed_by_rmw_id: 'RMWC-C-01', lot_status: 'Dispatched to CAD' },
        { material_code: 'MAT-PLS-01', material_category: 'CAD Tooling Material', material_name_specs: 'ABS Thermo-Molding Plastic Resin (3.0mm)', target_brand_usage: 'CAD 3D Molds', rmw_storage_bay: 'RMW-Bay-T2', managed_by_rmw_id: 'RMWC-C-01', lot_status: 'In Warehouse' },
        { material_code: 'FAB-TR-01', material_category: 'Cutting Floor Fabric', material_name_specs: 'High-Elastane Microfiber Jersey (78% Polyamide)', target_brand_usage: 'Triumph', rmw_storage_bay: 'RMW-Bay-F1', managed_by_rmw_id: 'RMWC-C-01', lot_status: 'Dispatched to Cutting Floor' },
        { material_code: 'FAB-VS-01', material_category: 'Cutting Floor Fabric', material_name_specs: 'Soft-Touch Nylon Tricot (82% Polyamide)', target_brand_usage: "Victoria's Secret", rmw_storage_bay: 'RMW-Bay-F2', managed_by_rmw_id: 'RMWC-C-01', lot_status: 'Dispatched to Cutting Floor' },
        { material_code: 'FAB-LL-01', material_category: 'Cutting Floor Fabric', material_name_specs: 'Interlock Technical Compression (77% Nylon)', target_brand_usage: 'Lululemon', rmw_storage_bay: 'RMW-Bay-F3', managed_by_rmw_id: 'RMWC-C-01', lot_status: 'In Warehouse' },
        { material_code: 'FAB-NK-01', material_category: 'Cutting Floor Fabric', material_name_specs: 'Dri-FIT Compression Recycled Poly (82% Poly)', target_brand_usage: 'Nike', rmw_storage_bay: 'RMW-Bay-F4', managed_by_rmw_id: 'RMWC-C-01', lot_status: 'In Warehouse' }
    ];

    const cad_markers = [
        { cad_marker_id: 'CAD-MK-01', style_code: 'BV3636', brand_buyer: 'Nike', model_name: 'Swoosh Medium-Support', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-CRD-01', cutting_floor_fabric_code: 'FAB-NK-01', marker_status: 'Approved', sketch_url: './patterns/pb-nike.svg' },
        { cad_marker_id: 'CAD-MK-02', style_code: 'AJ0340', brand_buyer: 'Nike', model_name: 'Alpha High-Support', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-PLS-01', cutting_floor_fabric_code: 'FAB-NK-01', marker_status: 'Approved', sketch_url: './patterns/pm-nike.svg' },
        { cad_marker_id: 'CAD-MK-03', style_code: 'CZ4456', brand_buyer: 'Nike', model_name: 'Indy Light-Support', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-CRD-01', cutting_floor_fabric_code: 'FAB-NK-01', marker_status: 'Approved', sketch_url: './patterns/pb-nike.svg' },
        { cad_marker_id: 'CAD-MK-04', style_code: 'AQ4184', brand_buyer: 'Nike', model_name: 'Rival Molded Cup', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-PLS-01', cutting_floor_fabric_code: 'FAB-NK-01', marker_status: 'Approved', sketch_url: './patterns/pm-nike.svg' },
        { cad_marker_id: 'CAD-MK-05', style_code: 'DD1205', brand_buyer: 'Nike', model_name: 'Dri-FIT Aero Swoosh', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-CRD-01', cutting_floor_fabric_code: 'FAB-NK-01', marker_status: 'Approved', sketch_url: './patterns/pb-nike.svg' },
        { cad_marker_id: 'CAD-MK-06', style_code: 'DM0579', brand_buyer: 'Nike', model_name: 'Pro Sculpt Contour', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CAD-C-CPH-01', cad_tooling_material_code: 'MAT-PLS-01', cutting_floor_fabric_code: 'FAB-NK-01', marker_status: 'Sent to CAD', sketch_url: './patterns/pm-nike.svg' },
        { cad_marker_id: 'CAD-MK-07', style_code: 'W2AS4S', brand_buyer: 'Lululemon', model_name: 'Energy Longline', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-CRD-01', cutting_floor_fabric_code: 'FAB-LL-01', marker_status: 'Approved', sketch_url: './patterns/pb-lululemon.svg' },
        { cad_marker_id: 'CAD-MK-08', style_code: 'W2CC1S', brand_buyer: 'Lululemon', model_name: 'Like a Cloud', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-PLS-01', cutting_floor_fabric_code: 'FAB-LL-01', marker_status: 'Approved', sketch_url: './patterns/pm-lululemon.svg' },
        { cad_marker_id: 'CAD-MK-09', style_code: 'W2BL8S', brand_buyer: 'Lululemon', model_name: 'Align Wirefree', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-CRD-01', cutting_floor_fabric_code: 'FAB-LL-01', marker_status: 'Approved', sketch_url: './patterns/pb-lululemon.svg' },
        { cad_marker_id: 'CAD-MK-10', style_code: 'W2DW3S', brand_buyer: 'Lululemon', model_name: 'Free to Be Sculpt', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-PLS-01', cutting_floor_fabric_code: 'FAB-LL-01', marker_status: 'Approved', sketch_url: './patterns/pm-lululemon.svg' },
        { cad_marker_id: 'CAD-MK-11', style_code: 'TR-TAC-01', brand_buyer: 'Triumph', model_name: 'Triaction Control', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-CRD-01', cutting_floor_fabric_code: 'FAB-TR-01', marker_status: 'Approved', sketch_url: './patterns/pb-triumph.svg' },
        { cad_marker_id: 'CAD-MK-12', style_code: 'TR-AMC-01', brand_buyer: 'Triumph', model_name: 'Amourette Charm', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-PLS-01', cutting_floor_fabric_code: 'FAB-TR-01', marker_status: 'Approved', sketch_url: './patterns/pm-triumph.svg' },
        { cad_marker_id: 'CAD-MK-13', style_code: 'TR-BMU-02', brand_buyer: 'Triumph', model_name: 'Body Make-Up Soft', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-CRD-01', cutting_floor_fabric_code: 'FAB-TR-01', marker_status: 'Approved', sketch_url: './patterns/pb-triumph.svg' },
        { cad_marker_id: 'CAD-MK-14', style_code: 'VS-BBV-10', brand_buyer: "Victoria's Secret", model_name: 'Body by Victoria', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-CRD-01', cutting_floor_fabric_code: 'FAB-VS-01', marker_status: 'Approved', sketch_url: './patterns/pb-vs.svg' },
        { cad_marker_id: 'CAD-MK-15', style_code: 'VS-SMC-20', brand_buyer: "Victoria's Secret", model_name: 'Smooth Memory Contour', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-PLS-01', cutting_floor_fabric_code: 'FAB-VS-01', marker_status: 'Approved', sketch_url: './patterns/pm-vs.svg' },
        { cad_marker_id: 'CAD-MK-16', style_code: 'VS-DAD-11', brand_buyer: "Victoria's Secret", model_name: 'Dream Angels Demi', design_coordinator_id: 'DDC-C-01', cad_handler_id: 'CADC-C-01', cad_tooling_material_code: 'MAT-CRD-01', cutting_floor_fabric_code: 'FAB-VS-01', marker_status: 'Approved', sketch_url: './patterns/pb-vs.svg' }
    ];

    const pattern_assets = [
        { asset_id: 'NK-PB-01', tooling_type: 'Pattern Block', model_name: 'Swoosh Medium-Support', style_code: 'BV3636', brand_buyer: 'Nike', size_category: 'M', storage_location: 'Rack D-01', operational_status: 'Active on Line', borrowed_by_id: 'CW-L3-CMO-01', shift_checkout: 'Morning', checkout_time: nowIso, last_used_date: todayStr, image_url: './patterns/pb-nike.svg' },
        { asset_id: 'NK-PM-01', tooling_type: 'Pattern Mold', model_name: 'Alpha High-Support', style_code: 'AJ0340', brand_buyer: 'Nike', size_category: 'L', storage_location: 'Mold Cabinet 03', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pm-nike.svg' },
        { asset_id: 'NK-PB-02', tooling_type: 'Pattern Block', model_name: 'Indy Light-Support', style_code: 'CZ4456', brand_buyer: 'Nike', size_category: 'S', storage_location: 'Rack D-02', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pb-nike.svg' },
        { asset_id: 'NK-PM-02', tooling_type: 'Pattern Mold', model_name: 'Rival Molded Cup', style_code: 'AQ4184', brand_buyer: 'Nike', size_category: 'M', storage_location: 'Mold Cabinet 04', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pm-nike.svg' },
        { asset_id: 'NK-PB-03', tooling_type: 'Pattern Block', model_name: 'Dri-FIT Aero Swoosh', style_code: 'DD1205', brand_buyer: 'Nike', size_category: 'L', storage_location: 'Rack D-01', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pb-nike.svg' },
        { asset_id: 'NK-PM-03', tooling_type: 'Pattern Mold', model_name: 'Pro Sculpt Contour', style_code: 'DM0579', brand_buyer: 'Nike', size_category: 'S', storage_location: 'Mold Cabinet 03', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pm-nike.svg' },
        { asset_id: 'LL-PB-01', tooling_type: 'Pattern Block', model_name: 'Energy Longline', style_code: 'W2AS4S', brand_buyer: 'Lululemon', size_category: 'S', storage_location: 'Rack C-01', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pb-lululemon.svg' },
        { asset_id: 'LL-PM-01', tooling_type: 'Pattern Mold', model_name: 'Like a Cloud', style_code: 'W2CC1S', brand_buyer: 'Lululemon', size_category: 'M', storage_location: 'Mold Cabinet 01', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pm-lululemon.svg' },
        { asset_id: 'LL-PB-02', tooling_type: 'Pattern Block', model_name: 'Align Wirefree', style_code: 'W2BL8S', brand_buyer: 'Lululemon', size_category: 'M', storage_location: 'Rack C-02', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pb-lululemon.svg' },
        { asset_id: 'LL-PM-02', tooling_type: 'Pattern Mold', model_name: 'Free to Be Sculpt', style_code: 'W2DW3S', brand_buyer: 'Lululemon', size_category: 'L', storage_location: 'Mold Cabinet 02', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pm-lululemon.svg' },
        { asset_id: 'TR-PB-01', tooling_type: 'Pattern Block', model_name: 'Triaction Control', style_code: 'TR-TAC-01', brand_buyer: 'Triumph', size_category: '34C', storage_location: 'Rack A-01', operational_status: 'Active on Line', borrowed_by_id: 'CW-L1-CMO-01', shift_checkout: 'Morning', checkout_time: nowIso, last_used_date: todayStr, image_url: './patterns/pb-triumph.svg' },
        { asset_id: 'TR-PM-01', tooling_type: 'Pattern Mold', model_name: 'Amourette Charm', style_code: 'TR-AMC-01', brand_buyer: 'Triumph', size_category: '34D', storage_location: 'Mold Cabinet 01', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pm-triumph.svg' },
        { asset_id: 'TR-PB-02', tooling_type: 'Pattern Block', model_name: 'Body Make-Up Soft', style_code: 'TR-BMU-02', brand_buyer: 'Triumph', size_category: '36C', storage_location: 'Rack A-02', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pb-triumph.svg' },
        { asset_id: 'VS-PB-01', tooling_type: 'Pattern Block', model_name: 'Body by Victoria', style_code: 'VS-BBV-10', brand_buyer: "Victoria's Secret", size_category: '34B', storage_location: 'Rack B-01', operational_status: 'Active on Line', borrowed_by_id: 'CW-L2-CMO-01', shift_checkout: 'Morning', checkout_time: nowIso, last_used_date: todayStr, image_url: './patterns/pb-vs.svg' },
        { asset_id: 'VS-PM-01', tooling_type: 'Pattern Mold', model_name: 'Smooth Memory Contour', style_code: 'VS-SMC-20', brand_buyer: "Victoria's Secret", size_category: '36B', storage_location: 'Mold Cabinet 03', operational_status: 'Inspection Flagged', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pm-vs.svg' },
        { asset_id: 'VS-PB-02', tooling_type: 'Pattern Block', model_name: 'Dream Angels Demi', style_code: 'VS-DAD-11', brand_buyer: "Victoria's Secret", size_category: '36D', storage_location: 'Rack B-02', operational_status: 'Available in Room', borrowed_by_id: null, shift_checkout: null, checkout_time: null, last_used_date: todayStr, image_url: './patterns/pb-vs.svg' }
    ];

    const qc_defect_codes = [
        { defect_code: 'DEF-01', defect_name_symptom: 'Frayed or Torn Cardboard Pattern Block Edge', fault_category: 'Pattern Block Fault', severity_level: 'Medium risk', target_asset_status: 'Inspection Flagged', reported_by_role_id: 'QCI-C-01', assigned_resolver_role_id: 'PR-C-PC-01', mandatory_system_action: 'Flag pattern for Pattern Room inspection and replacement' },
        { defect_code: 'DEF-02', defect_name_symptom: 'Warped or Cracked 3D Plastic Pattern Mold', fault_category: '3D Mold Fault', severity_level: 'High risk', target_asset_status: 'Pending Removal', reported_by_role_id: 'QCI-C-01', assigned_resolver_role_id: 'DH-01', mandatory_system_action: 'Immediate line stop, lock mold QR, and alert Management' },
        { defect_code: 'DEF-03', defect_name_symptom: 'Bundle Ticket Missing Ply Sequential Numbering', fault_category: 'Bundling Fault', severity_level: 'Low risk', target_asset_status: 'Active on Line (No Lock)', reported_by_role_id: 'QCI-C-01', assigned_resolver_role_id: 'CS-L1-01', mandatory_system_action: 'Log minor symptom for shift supervisor review' },
        { defect_code: 'DEF-04', defect_name_symptom: 'Fabric Spreading Layer Tension Distortion', fault_category: 'Spreading Fault', severity_level: 'Medium risk', target_asset_status: 'Active on Line (No Lock)', reported_by_role_id: 'QCI-C-02', assigned_resolver_role_id: 'CS-L2-01', mandatory_system_action: 'Send Re-Cut Request to Supervisor & Log Ply Defect' }
    ];

    const shift_assignments = [
        { assignment_id: 1, borrower_id: 'CW-L1-CMO-01', supervisor_id: 'CS-L1-01', assigned_date: todayStr, shift_type: 'Morning', production_line: 'Line 1' },
        { assignment_id: 2, borrower_id: 'CW-L2-CMO-01', supervisor_id: 'CS-L2-01', assigned_date: todayStr, shift_type: 'Morning', production_line: 'Line 2' },
        { assignment_id: 3, borrower_id: 'CW-L1-FS-01', supervisor_id: 'CS-L1-01', assigned_date: todayStr, shift_type: 'Afternoon', production_line: 'Line 1' },
        { assignment_id: 4, borrower_id: 'CW-L1-CMO-02', supervisor_id: 'CS-L1-01', assigned_date: tomorrowStr, shift_type: 'Morning', production_line: 'Line 1' }
    ];

    const cutting_orders = [
        { order_id: 'ORD-001', style_code: 'TR-TAC-01', sewing_coordinator_id: 'SDC-C-01', approved_by_exec_id: 'CSE-01', target_size: '34C', target_bundle_qty: 1200, priority_level: 'Urgent', assigned_line: 'Line 1', order_status: 'Scheduled on Line', order_notes: 'Priority sewing batch for Line 1', scheduled_date: todayStr, scheduled_shift: 'Morning', assigned_operator_id: 'CW-L1-CMO-01', pattern_box_cleared: true },
        { order_id: 'ORD-002', style_code: 'VS-BBV-10', sewing_coordinator_id: 'SDC-C-01', approved_by_exec_id: 'CSE-01', target_size: '34B', target_bundle_qty: 950, priority_level: 'Normal', assigned_line: 'Line 2', order_status: 'Bundled for Sewing', order_notes: 'Ready for Sewing pickup', scheduled_date: todayStr, scheduled_shift: 'Morning', assigned_operator_id: 'CW-L2-CMO-01', pattern_box_cleared: true },
        { order_id: 'ORD-003', style_code: 'W2AS4S', sewing_coordinator_id: 'SDC-C-01', approved_by_exec_id: 'CSE-01', target_size: 'S', target_bundle_qty: 800, priority_level: 'Normal', assigned_line: 'Line 1', order_status: 'Queued', order_notes: 'Awaiting Senior Executive routing', scheduled_date: null, scheduled_shift: null, assigned_operator_id: null, pattern_box_cleared: false }
    ];

    const qc_inspection_logs = [
        { qc_log_id: 'QCL-001', asset_id: 'TR-PB-01', defect_code: 'DEF-03', inspector_id: 'QCI-C-01', resolver_id: 'CS-L1-01', production_line: 'Line 1', ruined_ply_count: 4, logged_timestamp: nowIso, resolution_status: 'Resolved', severity_tier: 'Low', involved_employee_id: 'CW-L1-BU-01', inspector_notes: 'Bundle ticket reprinted on floor', exec_acknowledged: true, acknowledged_by_id: 'CQCE-01' },
        { qc_log_id: 'QCL-002', asset_id: 'VS-PB-01', defect_code: 'DEF-04', inspector_id: 'QCI-C-02', resolver_id: 'CS-L2-01', production_line: 'Line 2', ruined_ply_count: 12, logged_timestamp: nowIso, resolution_status: 'Open (Active on Line (No Lock))', severity_tier: 'Medium', involved_employee_id: 'CW-L2-FS-01', inspector_notes: 'Spreading tension adjusted on table 2', exec_acknowledged: true, acknowledged_by_id: 'CQCE-01' },
        { qc_log_id: 'QCL-003', asset_id: 'VS-PM-01', defect_code: 'DEF-02', inspector_id: 'QCI-C-01', resolver_id: 'DH-01', production_line: 'Line 2', ruined_ply_count: 28, logged_timestamp: nowIso, resolution_status: 'Open (Inspection Flagged)', severity_tier: 'High', involved_employee_id: 'CW-L2-CMO-01', inspector_notes: 'Hairline crack on mold contour edge', exec_acknowledged: false, acknowledged_by_id: null }
    ];

    // Pre-assign QR codes to all demo employees and 5 of the 6 demo patterns (leaving NK-PB-01 unassigned to demonstrate QR assignment)
    let recCounter = 1;
    const system_settings_audit = [
        ...employees.map(e => ({
            record_id: recCounter++,
            record_type: 'QR_ASSIGNED',
            category: 'EMPLOYEE_QR',
            setting_value: e.employee_id,
            prefix_data: e.department.substring(0, 12),
            requested_by_id: 'DT-C-CA-01',
            request_status: 'Active',
            created_at: nowIso
        })),
        ...pattern_assets.filter(p => p.asset_id !== 'VS-PB-02').map(p => ({
            record_id: recCounter++,
            record_type: 'QR_ASSIGNED',
            category: 'PATTERN_QR',
            setting_value: p.asset_id,
            prefix_data: p.style_code,
            requested_by_id: 'PR-C-PC-01',
            request_status: 'Active',
            created_at: nowIso
        }))
    ];

    const department_communications = [
        {
            comm_id: 1,
            sender_id: 'QCI-C-01',
            sender_name: 'Mohamed Faiz',
            sender_role: 'Quality Control Inspectors',
            receiver_id: 'DH-01',
            receiver_name: 'Jackson Emmanuel',
            receiver_role: 'Cutting Dpt. Head',
            protocol_category: 'High Risk QC Alert',
            linked_reference_id: 'QCL-003',
            subject_line: 'URGENT: High Risk Defect on VS-PM-01 (Line 2)',
            message_body: 'URGENT HIGH RISK DEFECT: DEF-02 (Warped or Cracked 3D Plastic Pattern Mold) on Asset VS-PM-01 at Line 2. Ruined plies: 28.',
            comm_status: 'Pending Approval',
            logged_timestamp: nowIso
        },
        {
            comm_id: 2,
            sender_id: 'CSE-01',
            sender_name: 'Aaron Emmanuel',
            sender_role: 'Cutting Senior Executive',
            receiver_id: 'CS-L1-01',
            receiver_name: 'Nathaniel Perera',
            receiver_role: 'Cutting Supervisors',
            protocol_category: 'Line Directive',
            linked_reference_id: 'ORD-001',
            subject_line: 'Execute Cut Order ORD-001 (Line 1)',
            message_body: 'Schedule operator and verify Pattern Box permission for Order ORD-001 (TR-TAC-01).',
            comm_status: 'Approved',
            logged_timestamp: nowIso
        }
    ];

    const immutable_audit_logs = [
        { audit_id: 1, actor_id: 'CW-L1-CMO-01', actor_name: 'Gayan Abeysekara', actor_role: 'Cutting Machine Operators', action_verb: 'BORROW_ASSET', target_entity: 'Pattern_Assets', target_id: 'TR-PB-01', immutable_snapshot: JSON.stringify({ operator: 'CW-L1-CMO-01', shift: 'Morning' }), created_at: nowIso },
        { audit_id: 2, actor_id: 'QCI-C-01', actor_name: 'Mohamed Faiz', actor_role: 'Quality Control Inspectors', action_verb: 'QC_DEFECT_FLAG', target_entity: 'QC_Inspection_Logs', target_id: 'QCL-003', immutable_snapshot: JSON.stringify({ asset_id: 'VS-PM-01', severity_tier: 'High' }), created_at: nowIso }
    ];

    return {
        employees,
        pattern_assets,
        cad_markers,
        rmw_materials,
        qc_defect_codes,
        shift_assignments,
        pending_requests: [],
        cutting_orders,
        qc_inspection_logs,
        system_settings_audit,
        department_communications,
        immutable_audit_logs,
        discarded_trash_vault: []
    };
}

const DEFAULT_AVATAR_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">
  <rect width="120" height="120" fill="#E4E4E7"/>
  <circle cx="60" cy="44" r="22" fill="#A1A1AA"/>
  <path d="M20 112C20 88.804 37.9086 72 60 72C82.0914 72 100 88.804 100 112" fill="#A1A1AA"/>
</svg>`);

const FEMALE_PORTRAIT_SEED_IDS = new Set([
    'CAD-C-CPH-02', 'CAD-C-MM-01', 'CAD-C-MM-03', 'CQCE-01', 'CS-L2-01', 'CS-L3-01',
    'CW-L1-BU-01', 'CW-L1-BU-03', 'CW-L1-BU-05', 'CW-L2-BU-02', 'CW-L2-BU-04',
    'CW-L3-BU-01', 'CW-L3-BU-03', 'CW-L3-BU-04', 'DDC-C-01', 'DT-C-CA-02',
    'DT-C-CST-01', 'DT-C-CST-03', 'DT-C-CST-05', 'PR-C-PC-01', 'PR-C-PH-02',
    'PR-C-PH-05', 'QCI-C-02', 'RMWC-C-03', 'SDC-C-03'
]);

const generatedPortraitCache = {};

function generateWorkforcePortraitSvg(seedKey) {
    const key = String(seedKey || 'STAFF').trim().toUpperCase();
    if (generatedPortraitCache[key]) return generatedPortraitCache[key];

    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash |= 0;
    }
    const isFemale = FEMALE_PORTRAIT_SEED_IDS.has(key);
    const localPortraitUrl = isFemale
        ? `./portraits/f${(Math.abs(hash) % 12) + 1}.jpg`
        : `./portraits/m${(Math.abs(hash) % 16) + 1}.jpg`;
    generatedPortraitCache[key] = localPortraitUrl;
    return localPortraitUrl;
}

const NO_DATA_IMAGE_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" fill="none">
  <rect width="400" height="260" fill="#F4F4F5"/>
  <rect x="150" y="78" width="100" height="68" rx="8" stroke="#A1A1AA" stroke-width="2" stroke-dasharray="4 4"/>
  <line x1="166" y1="130" x2="234" y2="94" stroke="#D4D4D8" stroke-width="2"/>
  <text x="200" y="176" text-anchor="middle" fill="#71717A" font-family="monospace, sans-serif" font-size="13" font-weight="bold" letter-spacing="2">NO PHOTO</text>
</svg>`);

function hasCustomPhoto(url) {
    return Boolean(url && url.trim() !== '' && url !== DEFAULT_AVATAR_SVG && url !== NO_DATA_IMAGE_SVG && !url.includes('unsplash.com') && !url.includes('placehold.co'));
}

function getAvatarUrl(url) {
    if (hasCustomPhoto(url)) return url;
    return DEFAULT_AVATAR_SVG;
}

function getItemImageUrl(url) {
    if (!hasCustomPhoto(url)) return NO_DATA_IMAGE_SVG;
    return url;
}

function probeImageCandidates(candidates, onFound) {
    let idx = 0;
    function tryNext() {
        if (idx >= candidates.length) return;
        const url = candidates[idx++];
        const testImg = new Image();
        testImg.onload = () => onFound(url);
        testImg.onerror = () => tryNext();
        testImg.src = url;
    }
    tryNext();
}

function resolveRepoLogos() {
    const masImg = document.getElementById('top-mas-logo');
    const masFb = document.getElementById('top-mas-fallback');
    if (masImg && masImg.getAttribute('src')) {
        resolvedMasLogoUrl = masImg.getAttribute('src');
    } else {
        probeImageCandidates(['./mas-logo.png', './mas.png', './MAS-logo.png'], (foundUrl) => {
            resolvedMasLogoUrl = foundUrl;
            if (masImg) { masImg.src = foundUrl; masImg.classList.remove('hidden'); }
            if (masFb) masFb.classList.add('hidden');
        });
    }

    const bodyImg = document.getElementById('top-bodyline-logo');
    const bodyFb = document.getElementById('top-bodyline-fallback');
    if (bodyImg && bodyImg.getAttribute('src')) {
        resolvedBodylineLogoUrl = bodyImg.getAttribute('src');
    } else {
        probeImageCandidates(['./bodyline-logo.png', './bodyline.png', './Bodyline-logo.png'], (foundUrl) => {
            resolvedBodylineLogoUrl = foundUrl;
            if (bodyImg) { bodyImg.src = foundUrl; bodyImg.classList.remove('hidden'); }
            if (bodyFb) bodyFb.classList.add('hidden');
        });
    }
}

// --- QR Code Assignment & Verification Helpers ---
// Stores QR activation records inside system_settings_audit (TBL-10) so existing database diagrams remain unchanged.

function isPatternQrAssigned(assetId) {
    if (!assetId) return false;
    const upper = String(assetId).toUpperCase();
    const asset = DB.pattern_assets.find(p => p.asset_id.toUpperCase() === upper);
    if (asset && asset.qr_assigned === true) return true;
    return DB.system_settings_audit.some(
        s => s.record_type === 'QR_ASSIGNED' && s.category === 'PATTERN_QR' && String(s.setting_value).toUpperCase() === upper
    );
}

function isEmployeeQrAssigned(empId) {
    if (!empId) return false;
    const upper = String(empId).toUpperCase();
    const emp = DB.employees.find(e => e.employee_id.toUpperCase() === upper);
    if (emp && emp.qr_assigned === true) return true;
    return DB.system_settings_audit.some(
        s => s.record_type === 'QR_ASSIGNED' && s.category === 'EMPLOYEE_QR' && String(s.setting_value).toUpperCase() === upper
    );
}

async function assignPatternQrCode(assetId, silent = false) {
    const asset = DB.pattern_assets.find(p => p.asset_id === assetId);
    if (!asset) return;
    if (isPatternQrAssigned(assetId)) {
        if (!silent) openPatternQrTagModal(assetId);
        return;
    }

    const row = {
        record_type: 'QR_ASSIGNED',
        category: 'PATTERN_QR',
        setting_value: asset.asset_id,
        prefix_data: asset.style_code || 'QR',
        requested_by_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'PR-C-PC-01',
        request_status: 'Active'
    };
    await supa.from('system_settings_audit').insert([row]);
    await writeAuditLog('ASSIGN_PATTERN_QR', 'Pattern_Assets', asset.asset_id, { asset_id: asset.asset_id, style_code: asset.style_code });
    await syncFromSupabase();

    if (!silent) {
        if (!document.getElementById('view-design-cad').classList.contains('hidden')) renderDesignCadPortal();
        if (!document.getElementById('view-tracker').classList.contains('hidden')) renderPatternGrid();
        openPatternQrTagModal(asset.asset_id);
        showToast(`Assigned & activated QR code for ${asset.asset_id}.`);
    }
}

async function batchAssignAllPatternQrCodes() {
    const unassigned = DB.pattern_assets.filter(p => !isPatternQrAssigned(p.asset_id));
    if (unassigned.length === 0) return showToast('All patterns already have QR codes assigned.');

    const actorId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'PR-C-PC-01';
    const rows = unassigned.map(p => ({
        record_type: 'QR_ASSIGNED',
        category: 'PATTERN_QR',
        setting_value: p.asset_id,
        prefix_data: p.style_code || 'QR',
        requested_by_id: actorId,
        request_status: 'Active'
    }));

    await supa.from('system_settings_audit').insert(rows);
    await writeAuditLog('BATCH_ASSIGN_PATTERN_QR', 'Pattern_Assets', 'ALL', { count: rows.length });
    await syncFromSupabase();
    renderDesignCadPortal();
    showToast(`Assigned QR codes to ${rows.length} pattern items.`);
}

async function assignEmployeeQrCode(empId, silent = false) {
    const emp = DB.employees.find(e => e.employee_id === empId);
    if (!emp) return;
    if (isEmployeeQrAssigned(empId)) {
        if (!silent) showToast(`QR badge is already active for ${emp.employee_id}.`);
        return;
    }

    const row = {
        record_type: 'QR_ASSIGNED',
        category: 'EMPLOYEE_QR',
        setting_value: emp.employee_id,
        prefix_data: emp.department.substring(0, 12),
        requested_by_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'DT-C-CA-01',
        request_status: 'Active'
    };
    await supa.from('system_settings_audit').insert([row]);
    await writeAuditLog('ASSIGN_EMPLOYEE_QR', 'Employees', emp.employee_id, { employee_id: emp.employee_id, name: emp.full_name });
    await syncFromSupabase();

    if (!silent) {
        renderAdminEmployeeList();
        if (currentInspectedStaffId === emp.employee_id) openStaffProfileModal(emp.employee_id);
        showToast(`Assigned QR badge to ${emp.full_name} (${emp.employee_id}).`);
    }
}

async function batchAssignAllEmployeeQrCodes() {
    const unassigned = DB.employees.filter(e => !isEmployeeQrAssigned(e.employee_id));
    if (unassigned.length === 0) return showToast('All staff members already have QR badges assigned.');

    const actorId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'DT-C-CA-01';
    const rows = unassigned.map(e => ({
        record_type: 'QR_ASSIGNED',
        category: 'EMPLOYEE_QR',
        setting_value: e.employee_id,
        prefix_data: e.department.substring(0, 12),
        requested_by_id: actorId,
        request_status: 'Active'
    }));

    await supa.from('system_settings_audit').insert(rows);
    await writeAuditLog('BATCH_ASSIGN_EMPLOYEE_QR', 'Employees', 'ALL', { count: rows.length });
    await syncFromSupabase();
    renderAdminEmployeeList();
    showToast(`Assigned QR badges to ${rows.length} staff members.`);
}

function openPatternQrTagModal(assetId) {
    const asset = DB.pattern_assets.find(p => p.asset_id === assetId);
    if (!asset) return;
    document.getElementById('modal-title').innerText = `QR Tag (${asset.asset_id})`;
    document.getElementById('verify-modal').classList.remove('hidden');
    const area = document.getElementById('modal-dynamic-area');
    area.innerHTML = `
        <div class="text-center space-y-3 py-3">
            <div id="modal-pattern-qr-box" class="inline-block p-4 bg-white rounded-2xl border-2 border-zinc-900 shadow-sm mx-auto"></div>
            <div>
                <p class="font-mono text-base font-black text-zinc-900">${asset.asset_id}</p>
                <p class="text-xs font-bold text-zinc-700">${asset.model_name} (${asset.style_code})</p>
                <p class="text-[11px] text-zinc-500">${asset.brand_buyer} • Size ${asset.size_category} • ${asset.storage_location}</p>
            </div>
            <div>
                <span class="inline-block px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase">
                    QR Code Assigned & Active in Pattern Room
                </span>
            </div>
            <div class="pt-2">
                <button type="button" onclick="printQrTagOrBadge('PATTERN', '${asset.asset_id}')" class="bg-zinc-900 hover:bg-zinc-800 text-white px-5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2 shadow-sm">
                    <i class="ph-bold ph-printer text-sm"></i>
                    <span>Print Pattern QR Tag</span>
                </button>
            </div>
        </div>
    `;
    const qrBox = document.getElementById('modal-pattern-qr-box');
    if (qrBox && typeof QRCode !== 'undefined') {
        new QRCode(qrBox, { text: asset.asset_id, width: 140, height: 140 });
    }
}

function printQrTagOrBadge(kind, targetId) {
    let heading = 'CDMS+ QR TAG';
    let mainCode = targetId;
    let title = '';
    let subtitle = '';
    let meta = '';

    if (kind === 'EMPLOYEE') {
        const emp = DB.employees.find(e => e.employee_id === targetId);
        heading = 'BODYLINE STAFF QR BADGE';
        title = emp ? emp.full_name : targetId;
        subtitle = emp ? emp.role_designation : 'Cutting Department';
        meta = emp ? `${emp.department} • ${emp.work_location_zone}` : '';
    } else {
        const asset = DB.pattern_assets.find(p => p.asset_id === targetId);
        heading = asset && asset.tooling_type === 'Pattern Mold' ? '3D MOLD QR TAG' : 'PATTERN BLOCK QR TAG';
        title = asset ? `${asset.model_name} (${asset.style_code})` : targetId;
        subtitle = asset ? `${asset.brand_buyer} • Size ${asset.size_category}` : 'Pattern Room Asset';
        meta = asset ? `Storage: ${asset.storage_location}` : '';
    }

    const tempDiv = document.createElement('div');
    if (typeof QRCode !== 'undefined') {
        new QRCode(tempDiv, { text: mainCode, width: 170, height: 170 });
    }

    setTimeout(() => {
        const imgEl = tempDiv.querySelector('img');
        const canvasEl = tempDiv.querySelector('canvas');
        const qrDataUrl = (canvasEl && canvasEl.toDataURL)
            ? canvasEl.toDataURL('image/png')
            : (imgEl ? imgEl.src : '');

        const printWin = window.open('', '_blank', 'width=460,height=580');
        if (!printWin) {
            return showToast('Allow pop-ups in your browser to print QR labels.', 'error');
        }
        printWin.document.write(`<!DOCTYPE html>
<html>
<head>
    <title>Print QR (${mainCode})</title>
    <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 92vh; margin: 0; background: #fff; color: #18181b; }
        .card { border: 2px solid #18181b; border-radius: 16px; padding: 24px 28px; text-align: center; width: 290px; }
        .tag-type { font-size: 10px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #52525b; margin-bottom: 12px; }
        .qr-wrap { display: inline-block; padding: 12px; border: 1px solid #e4e4e7; border-radius: 12px; margin-bottom: 12px; }
        .qr-wrap img { width: 160px; height: 160px; display: block; }
        .code { font-family: monospace; font-size: 20px; font-weight: 900; margin: 4px 0; }
        .title { font-size: 14px; font-weight: 700; margin: 4px 0 2px; }
        .sub { font-size: 12px; color: #3f3f46; margin: 2px 0; }
        .meta { font-size: 11px; color: #71717a; margin-top: 6px; }
        @media print { .no-print { display: none; } body { min-height: auto; } }
    </style>
</head>
<body>
    <div class="card">
        <div class="tag-type">${heading}</div>
        <div class="qr-wrap"><img src="${qrDataUrl}" alt="${mainCode}"></div>
        <div class="code">${mainCode}</div>
        <div class="title">${title}</div>
        <div class="sub">${subtitle}</div>
        <div class="meta">${meta}</div>
        <button class="no-print" onclick="window.print()" style="margin-top:16px;padding:8px 18px;background:#18181b;color:#fff;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">Print Label</button>
    </div>
    <script>window.onload = function() { setTimeout(function() { window.print(); }, 250); };<\/script>
</body>
</html>`);
        printWin.document.close();
    }, 80);
}


// --- Custom Dropdown Menus, Info Popovers & Fullscreen Panels ---
// Replaces native <select> elements with styled menus and handles panel expansion.

let activeCustomSelectEl = null;

function toggleInfoTip(tipId) {
    const el = document.getElementById(tipId);
    if (el) el.classList.toggle('hidden');
}

function updateSingleCustomSelectButton(sel) {
    if (!sel) return;
    sel.classList.add('c-select-hidden');

    let btn = sel.nextElementSibling;
    if (!btn || !btn.classList.contains('c-select-btn')) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'c-select-btn';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openCustomSelectMenu(sel, btn);
        });
        sel.parentNode.insertBefore(btn, sel.nextSibling);
    }

    const selectedOpt = sel.options[sel.selectedIndex] || sel.options[0];
    const labelText = selectedOpt ? selectedOpt.text : 'Select...';
    if (btn.dataset.lastLabel !== labelText) {
        btn.dataset.lastLabel = labelText;
        btn.innerHTML = `
            <span class="truncate pr-1">${labelText}</span>
            <i class="ph-bold ph-caret-down text-zinc-400 shrink-0 text-xs"></i>
        `;
    }
}

function refreshAllCustomSelects() {
    document.querySelectorAll('select').forEach(updateSingleCustomSelectButton);
}

function openCustomSelectMenu(selectEl, triggerBtn) {
    const menu = document.getElementById('custom-select-menu');
    const backdrop = document.getElementById('custom-select-backdrop');
    if (!menu || !backdrop) return;

    activeCustomSelectEl = selectEl;
    const opts = selectEl.options;
    const selectedIdx = selectEl.selectedIndex;
    const rowsHtml = [];

    for (let idx = 0; idx < opts.length; idx++) {
        const opt = opts[idx];
        const isSelected = idx === selectedIdx;
        rowsHtml.push(`
            <button type="button" onclick="pickCustomSelectOption(${idx})" class="w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between gap-2 ${isSelected ? 'bg-zinc-900 text-white font-bold' : 'bg-white hover:bg-zinc-100 text-zinc-800 font-medium'}">
                <span class="leading-snug truncate">${opt.text}</span>
                ${isSelected ? '<i class="ph-bold ph-check text-xs shrink-0"></i>' : ''}
            </button>
        `);
    }

    menu.innerHTML = `
        <div class="px-3.5 py-2.5 bg-zinc-50 border-b border-zinc-200 flex justify-between items-center sm:hidden">
            <span class="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Select Option</span>
            <button type="button" onclick="closeCustomSelectMenu()" class="text-zinc-400 hover:text-zinc-800"><i class="ph-bold ph-x text-sm"></i></button>
        </div>
        <div class="overflow-y-auto custom-scroll divide-y divide-zinc-100 max-h-[240px]">
            ${rowsHtml.join('')}
        </div>
    `;

    backdrop.classList.remove('hidden');
    menu.classList.remove('hidden');
    menu.classList.add('flex');

    const rect = triggerBtn.getBoundingClientRect();
    const isMobile = window.innerWidth < 640;

    if (isMobile) {
        menu.style.left = '16px';
        menu.style.right = '16px';
        menu.style.width = 'auto';
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow > 240) {
            menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 260)}px`;
        } else {
            menu.style.top = `${Math.max(72, rect.top - 220)}px`;
        }
    } else {
        const menuWidth = Math.max(rect.width, 240);
        const leftPos = Math.min(rect.left, window.innerWidth - menuWidth - 16);
        menu.style.width = `${menuWidth}px`;
        menu.style.left = `${Math.max(12, leftPos)}px`;
        menu.style.right = 'auto';
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow > 250) {
            menu.style.top = `${rect.bottom + 6}px`;
        } else {
            menu.style.top = `${Math.max(16, rect.top - 240)}px`;
        }
    }
}

function pickCustomSelectOption(optionIndex) {
    if (!activeCustomSelectEl) return;
    const sel = activeCustomSelectEl;
    if (!sel.options[optionIndex]) return;
    sel.selectedIndex = optionIndex;
    sel.value = sel.options[optionIndex].value;
    updateSingleCustomSelectButton(sel);
    closeCustomSelectMenu();
    sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function closeCustomSelectMenu() {
    const menu = document.getElementById('custom-select-menu');
    const backdrop = document.getElementById('custom-select-backdrop');
    if (menu) { menu.classList.add('hidden'); menu.classList.remove('flex'); }
    if (backdrop) backdrop.classList.add('hidden');
    activeCustomSelectEl = null;
}

function togglePanelFullscreen(panelId) {
    const panel = document.getElementById(panelId);
    const backdrop = document.getElementById('fullscreen-panel-backdrop');
    if (!panel) return;

    const isAlreadyFull = panel.classList.contains('panel-fullscreen');
    document.querySelectorAll('.panel-fullscreen').forEach(p => p.classList.remove('panel-fullscreen'));

    if (isAlreadyFull) {
        if (backdrop) backdrop.classList.add('hidden');
    } else {
        panel.classList.add('panel-fullscreen');
        if (backdrop) backdrop.classList.remove('hidden');
    }
}

function closeAllFullscreenPanels() {
    document.querySelectorAll('.panel-fullscreen').forEach(p => p.classList.remove('panel-fullscreen'));
    const backdrop = document.getElementById('fullscreen-panel-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
}


// --- Top Bar Layout Controller ---
// Switches the header between compact (gateway), expanded (kiosk), and portal (with sub-nav) states.

function setTopBarState(state) {
    const header = document.getElementById('unified-top-bar');
    const inner = document.getElementById('top-bar-inner');
    const divider = document.getElementById('top-bar-compact-divider');
    const sessionCtrls = document.getElementById('top-bar-session-controls');
    const profileWrap = document.getElementById('header-profile-wrapper');
    const kioskSignOutBtn = document.getElementById('kiosk-header-signout-btn');

    if (header) header.setAttribute('data-bar-mode', state);

    if (state === 'compact') {
        inner.classList.remove('expanded-bar');
        inner.classList.add('compact-bar');
        divider.classList.remove('hidden');
        sessionCtrls.classList.add('hidden');
        sessionCtrls.classList.remove('flex');
    } else if (state === 'expanded-auth') {
        inner.classList.remove('compact-bar');
        inner.classList.add('expanded-bar');
        divider.classList.add('hidden');
        sessionCtrls.classList.add('hidden');
        sessionCtrls.classList.remove('flex');
    } else if (state === 'expanded-terminal') {
        inner.classList.remove('compact-bar');
        inner.classList.add('expanded-bar');
        divider.classList.add('hidden');
        sessionCtrls.classList.remove('hidden');
        sessionCtrls.classList.add('flex');
        profileWrap.classList.add('hidden');
        if (kioskSignOutBtn) { kioskSignOutBtn.classList.remove('hidden'); kioskSignOutBtn.classList.add('flex'); }
    } else if (state === 'portal') {
        inner.classList.remove('compact-bar');
        inner.classList.add('expanded-bar');
        divider.classList.add('hidden');
        sessionCtrls.classList.remove('hidden');
        sessionCtrls.classList.add('flex');
        profileWrap.classList.remove('hidden');
        if (kioskSignOutBtn) { kioskSignOutBtn.classList.add('hidden'); kioskSignOutBtn.classList.remove('flex'); }
    }
}


// --- Supabase Sync, Essential Role Seeder & Audit Trail ---
// Keeps the in-memory DB object synced with live Supabase or localStorage sandbox data.

async function ensureEssentialRolesExist() {
    const requiredStaff = [
        {
            employee_id: 'QCI-C-01',
            full_name: 'Mohamed Faiz',
            department: 'QC - Cutting',
            role_designation: 'Quality Control Inspectors',
            work_location_zone: 'Cutting Floor',
            active_checkout_count: 0,
            avatar_url: '',
            account_password: 'bodyline123',
            account_status: 'Active'
        },
        {
            employee_id: 'CDTE-01',
            full_name: 'Arjun Rajan',
            department: 'Digital - Cutting',
            role_designation: 'Digital Team Executive',
            work_location_zone: 'CD Operations Office',
            active_checkout_count: 0,
            avatar_url: '',
            account_password: 'bodyline123',
            account_status: 'Active'
        }
    ];

    for (const staff of requiredStaff) {
        const exists = DB.employees.some(e => e.employee_id.toUpperCase() === staff.employee_id);
        if (!exists && DB.employees.length > 0) {
            DB.employees.push(staff);
            if (sandboxMode === '1') {
                await liveSupabase.from('employees').insert([staff]);
            }
        }
    }
}

async function fetchLiveSupabaseIntoDB() {
    const [
        emp, pat, cad, rmw, qcd, shf, req, ord, qcl, sys, com, aud, trsh
    ] = await Promise.all([
        liveSupabase.from('employees').select('*').order('employee_id'),
        liveSupabase.from('pattern_assets').select('*').order('asset_id'),
        liveSupabase.from('cad_markers').select('*').order('cad_marker_id'),
        liveSupabase.from('rmw_materials').select('*').order('material_code'),
        liveSupabase.from('qc_defect_codes').select('*').order('defect_code'),
        liveSupabase.from('shift_assignments').select('*').order('assignment_id', { ascending: false }),
        liveSupabase.from('pending_requests').select('*').order('request_id', { ascending: false }),
        liveSupabase.from('cutting_orders').select('*').order('order_id', { ascending: false }),
        liveSupabase.from('qc_inspection_logs').select('*').order('qc_log_id', { ascending: false }),
        liveSupabase.from('system_settings_audit').select('*').order('record_id', { ascending: false }),
        liveSupabase.from('department_communications').select('*').order('comm_id', { ascending: false }),
        liveSupabase.from('immutable_audit_logs').select('*').order('audit_id', { ascending: false }).limit(200),
        liveSupabase.from('discarded_trash_vault').select('*').order('trash_id', { ascending: false })
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
    if (trsh && trsh.data) DB.discarded_trash_vault = trsh.data;

    await ensureEssentialRolesExist();
}

async function syncFromSupabase() {
    try {
        if (sandboxMode === '1') {
            await fetchLiveSupabaseIntoDB();
        }

        if (currentLoggedInUser) {
            const refreshed = DB.employees.find(e => e.employee_id === currentLoggedInUser.employee_id);
            if (refreshed) {
                currentLoggedInUser = refreshed;
                updateProfileUI(refreshed);
            }
        }
        populateQuickRoleSelect();
        updateCommUnreadBadge();
        setTimeout(refreshAllCustomSelects, 20);
    } catch (err) {
        console.error('Sync Error:', err);
    }
}

async function writeAuditLog(actionVerb, targetEntity, targetId, snapshotObj) {
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


// --- App Initialization, Toast Notifications & 5-Minute Idle Timeout ---
// Sets up event listeners, camera cleanup, and automatic session sign-out on inactivity.

document.addEventListener('DOMContentLoaded', async () => {
    setTopBarState('compact');
    updateModeButtonUI();
    updateGatewayStatusLabel();
    resolveRepoLogos();
    document.getElementById('header-user-avatar').src = DEFAULT_AVATAR_SVG;
    document.getElementById('popover-user-avatar').src = DEFAULT_AVATAR_SVG;

    await syncFromSupabase();
    refreshAllCustomSelects();

    ['click', 'keydown', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, () => { idleSecondsRemaining = 300; });
    });

    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('header-profile-wrapper');
        const pop = document.getElementById('profile-popover-menu');
        if (wrapper && pop && !wrapper.contains(e.target)) {
            pop.classList.add('hidden');
        }
        const filterPop = document.getElementById('search-filter-popover');
        const filterBtn = document.getElementById('search-filter-btn');
        if (filterPop && filterBtn && !filterPop.contains(e.target) && !filterBtn.contains(e.target)) {
            filterPop.classList.add('hidden');
        }
    });

    window.addEventListener('resize', () => closeCustomSelectMenu());

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
                returnToWelcomeScreenImmediate();
                showToast('Session signed out due to 5 minutes of inactivity.', 'error');
            }
        }
    }, 1000);
});

function showToast(msg, type = 'success') {
    const now = Date.now();
    if (msg === lastToastMessage && (now - lastToastTime) < 2500) {
        return;
    }
    lastToastMessage = msg;
    lastToastTime = now;

    const container = document.getElementById('toast-container');
    if (!container) return;
    container.innerHTML = '';

    const t = document.createElement('div');
    const border = type === 'error' ? 'border-rose-600' : 'border-zinc-700';
    const dot = type === 'error' ? 'bg-rose-500' : 'bg-emerald-500';
    t.className = `bg-zinc-900 ${border} border text-white px-4 py-3 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2.5 pointer-events-auto`;
    t.innerHTML = `<span class="w-2 h-2 rounded-full ${dot} shrink-0"></span> <span>${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 3400);
}

function closeModal(id) {
    closeCustomSelectMenu();
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

async function stopActiveQrCamera() {
    if (html5QrScanner) {
        try {
            if (html5QrScanner.isScanning) {
                await html5QrScanner.stop();
            }
            html5QrScanner.clear();
        } catch (e) {}
        html5QrScanner = null;
    }
}

async function stopQcQrScanner() {
    const box = document.getElementById('qc-qr-scanner-box');
    if (box) box.classList.add('hidden');
    if (qcQrScanner) {
        try {
            if (qcQrScanner.isScanning) {
                await qcQrScanner.stop();
            }
            qcQrScanner.clear();
        } catch (e) {}
        qcQrScanner = null;
    }
}

function closeVerifyModal() {
    stopActiveQrCamera();
    closeModal('verify-modal');
}

function closeCommDrawer() {
    closeCustomSelectMenu();
    closeModal('comm-drawer-window');
}

function toggleProfilePopover(e) {
    if (e) e.stopPropagation();
    closeCustomSelectMenu();
    const pop = document.getElementById('profile-popover-menu');
    if (pop) pop.classList.toggle('hidden');
}

function closeProfilePopover() {
    closeModal('profile-popover-menu');
}

function readAndCompressImageFile(file, maxWidth = 360) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);
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
                resolve(canvas.toDataURL('image/jpeg', 0.84));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function readAndCompressImage(fileInput, maxWidth = 360) {
    if (!fileInput || !fileInput.files || !fileInput.files[0]) return Promise.resolve(null);
    return readAndCompressImageFile(fileInput.files[0], maxWidth);
}


// --- Staff Authentication, Password Recovery & Kiosk Access ---
// Handles role sign-in, temporary password resets, break-glass admin recovery, and kiosk locks.

function togglePasswordVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!input || !icon) return;

    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'ph-bold ph-eye-slash text-base text-zinc-900';
    } else {
        input.type = 'password';
        icon.className = 'ph-bold ph-eye text-base';
    }
}

function toggleAuthLock() {
    authLockOpen = !authLockOpen;
    const icon = document.getElementById('auth-lock-icon');
    const btn = document.getElementById('auth-lock-btn');

    if (authLockOpen) {
        icon.className = 'ph-fill ph-lock-key-open text-xl';
        btn.classList.remove('ctrl-btn-minimal-light');
        btn.classList.add('ctrl-btn-minimal-dark');
    } else {
        icon.className = 'ph-fill ph-lock-key text-xl';
        btn.classList.remove('ctrl-btn-minimal-dark');
        btn.classList.add('ctrl-btn-minimal-light');
    }
    updateGatewayStatusLabel();
}

const SANDBOX_ROLE_DEFAULTS = {
    'DH-01': { full_name: 'Jackson Emmanuel', department: 'Cutting', role_designation: 'Cutting Dpt. Head', work_location_zone: 'CD Operations Office' },
    'CSE-01': { full_name: 'Aaron Emmanuel', department: 'Cutting', role_designation: 'Cutting Senior Executive', work_location_zone: 'CD Operations Office' },
    'CS-L1-01': { full_name: 'Nathaniel Perera', department: 'Cutting', role_designation: 'Cutting Supervisors', work_location_zone: 'Cutting Floor' },
    'PR-C-PC-01': { full_name: 'Kavya Tharmalingam', department: 'Cutting - Pattern', role_designation: 'Pattern Coordinators', work_location_zone: 'Pattern Room' },
    'DDC-C-01': { full_name: 'Kavindi Perera', department: 'Design - Cutting', role_designation: 'Design Dpt. Coordinators', work_location_zone: 'Design Department' },
    'CADC-C-01': { full_name: 'Sachith Perera', department: 'Cutting - CAD', role_designation: 'CAD Coordinators', work_location_zone: 'CAD Room' },
    'SDC-C-01': { full_name: 'Tharindu Perera', department: 'Sewing - Cutting', role_designation: 'Sewing Dpt. Coordinator', work_location_zone: 'Sewing Department' },
    'RMWC-C-01': { full_name: 'Ahamed Niyas', department: 'RMW - Cutting', role_designation: 'RMW Coordinators', work_location_zone: 'Raw Material Warehouse' },
    'CQCE-01': { full_name: 'Imesha Fernando', department: 'QC - Cutting', role_designation: 'Quality Control Executive', work_location_zone: 'CD Operations Office' },
    'QCI-C-01': { full_name: 'Mohamed Faiz', department: 'QC - Cutting', role_designation: 'Quality Control Inspectors', work_location_zone: 'Cutting Floor' },
    'DT-C-CST-01': { full_name: 'Shehani Mel', department: 'Digital - Cutting', role_designation: 'CDMS Support Team', work_location_zone: 'CD Operations Office' },
    'DT-C-CA-01': { full_name: 'Ashan Mendis', department: 'Digital - Cutting', role_designation: 'CDMS Admins', work_location_zone: 'CD Operations Office' },
    'CDTE-01': { full_name: 'Arjun Rajan', department: 'Digital - Cutting', role_designation: 'Digital Team Executive', work_location_zone: 'CD Operations Office' }
};

const QUICK_ROLE_PRIORITY_ORDER = [
    'DH-01', 'CSE-01', 'CS-L1-01', 'CS-L2-01', 'CS-L3-01',
    'PR-C-PC-01', 'PR-C-PH-01', 'DDC-C-01', 'CADC-C-01', 'CAD-C-MM-01', 'CAD-C-CPH-01',
    'SDC-C-01', 'RMWC-C-01', 'CQCE-01', 'QCI-C-01',
    'DT-C-CST-01', 'DT-C-CA-01', 'CDTE-01'
];

function populateQuickRoleSelect() {
    const sel = document.getElementById('quick-role-select');
    if (!sel) return;

    const previousVal = sel.value;
    let portalStaff = DB.employees.filter(e =>
        e &&
        e.employee_id &&
        !String(e.employee_id).toUpperCase().startsWith('CW-') &&
        (!e.account_status || !e.account_status.startsWith('Suspended'))
    );

    if (portalStaff.length === 0) {
        portalStaff = Object.entries(SANDBOX_ROLE_DEFAULTS).map(([empId, info]) => ({
            employee_id: empId,
            full_name: info.full_name,
            role_designation: info.role_designation,
            department: info.department,
            work_location_zone: info.work_location_zone
        }));
    } else {
        portalStaff = [...portalStaff].sort((a, b) => {
            const idxA = QUICK_ROLE_PRIORITY_ORDER.indexOf(a.employee_id.toUpperCase());
            const idxB = QUICK_ROLE_PRIORITY_ORDER.indexOf(b.employee_id.toUpperCase());
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.employee_id.localeCompare(b.employee_id);
        });
    }

    sel.innerHTML = portalStaff.map(emp => {
        const cleanId = emp.employee_id.trim();
        return `<option value="${cleanId}">${emp.role_designation} (${emp.full_name})</option>`;
    }).join('');

    if (previousVal && portalStaff.some(e => e.employee_id === previousVal)) {
        sel.value = previousVal;
    } else if (sel.options.length > 0) {
        sel.selectedIndex = 0;
        sel.value = sel.options[0].value;
    }

    updateSingleCustomSelectButton(sel);
}

function openUserLoginModal() {
    setTopBarState('expanded-auth');
    populateQuickRoleSelect();
    document.getElementById('user-login-modal').classList.remove('hidden');
    const helper = document.getElementById('quick-role-box');
    const stdInputs = document.getElementById('standard-login-inputs');

    if (authLockOpen) {
        helper.classList.remove('hidden');
        stdInputs.classList.add('hidden');
        onQuickRoleChange();
    } else {
        helper.classList.add('hidden');
        stdInputs.classList.remove('hidden');
        morphDepartmentIconOnType(document.getElementById('login-emp-id').value);
    }
    updateSingleCustomSelectButton(document.getElementById('quick-role-select'));
}

function onQuickRoleChange() {
    const val = document.getElementById('quick-role-select').value;
    morphDepartmentIconOnType(val);
}

function morphDepartmentIconOnType(rawId) {
    const code = (rawId || '').trim().toUpperCase();
    const icon = document.getElementById('login-dept-icon');
    const badge = document.getElementById('login-dept-badge');
    const title = document.getElementById('login-dynamic-title');

    const emp = DB.employees.find(e => e.employee_id.toUpperCase() === code);
    let cfg = { icon: 'ph-identification-badge', dept: 'Bodyline Staff Authentication', title: 'Staff Portal Sign In' };

    if (code.startsWith('DH')) cfg = { icon: 'ph-buildings', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'CD Operations Office', title: 'Department Head Sign In' };
    else if (code.startsWith('CSE')) cfg = { icon: 'ph-briefcase', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'CD Operations Office', title: 'Senior Executive Sign In' };
    else if (code.startsWith('CS-')) cfg = { icon: 'ph-calendar-check', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Cutting Floor', title: 'Cutting Supervisor Sign In' };
    else if (code.startsWith('DDC')) cfg = { icon: 'ph-paint-brush-broad', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Design Department', title: 'Design Coordinator Sign In' };
    else if (code.startsWith('CADC')) cfg = { icon: 'ph-compass-tool', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'CAD Room', title: 'CAD Coordinator Sign In' };
    else if (code.startsWith('CAD-C-MM')) cfg = { icon: 'ph-compass-tool', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'CAD Room', title: 'Marker Maker Sign In' };
    else if (code.startsWith('CAD')) cfg = { icon: 'ph-compass-tool', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'CAD Room', title: 'CAD Pattern Handler Sign In' };
    else if (code.startsWith('PR-C-PC')) cfg = { icon: 'ph-barcode', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Pattern Room', title: 'Pattern Coordinator Sign In' };
    else if (code.startsWith('PR-')) cfg = { icon: 'ph-barcode', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Pattern Room', title: 'Pattern Handler Sign In' };
    else if (code.startsWith('SDC')) cfg = { icon: 'ph-scissors', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Sewing Department', title: 'Sewing Coordinator Sign In' };
    else if (code.startsWith('RMW')) cfg = { icon: 'ph-warehouse', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Raw Material Warehouse', title: 'RMW Coordinator Sign In' };
    else if (code.startsWith('CQCE')) cfg = { icon: 'ph-shield-check', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Quality Control Office', title: 'QC Executive Sign In' };
    else if (code.startsWith('QCI')) cfg = { icon: 'ph-warning-octagon', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Quality Control Floor', title: 'QC Inspector Sign In' };
    else if (code.startsWith('DT-C-CST')) cfg = { icon: 'ph-headset', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Digital Team', title: 'CDMS Support Sign In' };
    else if (code.startsWith('CDTE')) cfg = { icon: 'ph-terminal-window', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Digital Team', title: 'Digital Team Executive Sign In' };
    else if (code.startsWith('DT-')) cfg = { icon: 'ph-terminal-window', dept: emp ? `${emp.full_name} (${emp.employee_id})` : 'Digital Team', title: 'CDMS Admin Sign In' };

    icon.className = `ph-bold ${cfg.icon} text-2xl`;
    badge.innerText = cfg.dept;
    title.innerText = cfg.title;
}

function updateProfileUI(emp) {
    const av = getAvatarUrl(emp.avatar_url, emp.employee_id);
    const hasPhoto = hasCustomPhoto(emp.avatar_url);
    const headerAv = document.getElementById('header-user-avatar');
    if (headerAv) headerAv.src = av;

    document.getElementById('popover-user-name').innerText = emp.full_name;
    document.getElementById('popover-user-role').innerText = emp.role_designation;
    document.getElementById('popover-user-id').innerText = emp.employee_id;
    document.getElementById('popover-user-avatar').src = av;

    const delBtn = document.getElementById('popover-remove-photo-btn');
    if (delBtn) {
        delBtn.disabled = !hasPhoto;
    }
}

async function executeDepartmentLogin() {
    if (isAuthBusy) return;
    let empId = authLockOpen
        ? document.getElementById('quick-role-select').value
        : document.getElementById('login-emp-id').value.trim().toUpperCase();
    const pass = document.getElementById('login-emp-pass').value.trim();

    let emp = DB.employees.find(e => e.employee_id.toUpperCase() === empId);

    // When Sandbox mode starts with an empty database, allow signing in with a temporary in-memory role session
    if (!emp && sandboxMode === '0' && empId) {
        const def = SANDBOX_ROLE_DEFAULTS[empId] || {
            full_name: `Sandbox Tester (${empId})`,
            department: 'Cutting',
            role_designation: 'CDMS Admins',
            work_location_zone: 'CD Operations Office'
        };
        emp = {
            employee_id: empId,
            full_name: def.full_name,
            department: def.department,
            role_designation: def.role_designation,
            work_location_zone: def.work_location_zone,
            active_checkout_count: 0,
            avatar_url: '',
            account_password: 'bodyline123',
            account_status: 'Active'
        };
    }

    if (!emp) return showToast('Employee ID not found in directory.', 'error');

    if (emp.account_status && emp.account_status.startsWith('Suspended')) {
        return showToast(`Account ${emp.employee_id} is currently Suspended (${emp.suspension_until || 'Contact Admin'}).`, 'error');
    }

    let usedTempPassword = false;
    if (!authLockOpen) {
        if (!pass) return showToast('Please enter your password.', 'error');
        const actualPass = emp.account_password || 'bodyline123';
        const tempPass = emp.temp_password || null;

        if (tempPass && pass === tempPass) {
            usedTempPassword = true;
        } else if (pass !== actualPass && pass !== 'bodyline123') {
            return showToast('Incorrect password. Click "Forgot Password?" if you need a reset.', 'error');
        }
    }

    isAuthBusy = true;
    closeModal('user-login-modal');
    currentLoggedInUser = emp;
    currentMode = 'portal';
    document.getElementById('view-gateway').classList.add('hidden');
    setTopBarState('portal');
    document.getElementById('comm-floating-Dock').classList.remove('hidden');
    updateProfileUI(emp);
    buildRoleIsolatedTabs(emp);
    showToast(`Signed in as ${emp.full_name}`);

    if (usedTempPassword || emp.must_reset_password) {
        setTimeout(() => openPasswordChangeModal(true), 250);
    }

    setTimeout(() => { isAuthBusy = false; }, 400);
    await writeAuditLog('USER_LOGIN', 'Employees', emp.employee_id, { name: emp.full_name, role: emp.role_designation, temp_used: usedTempPassword });
    await syncFromSupabase();
}

function openForgotPasswordModal() {
    const currentTypedId = (document.getElementById('login-emp-id')?.value || '').trim().toUpperCase();
    closeModal('user-login-modal');
    const fpIdInput = document.getElementById('fp-emp-id');
    if (fpIdInput && currentTypedId) fpIdInput.value = currentTypedId;
    document.getElementById('forgot-password-modal').classList.remove('hidden');
}

function closeForgotPasswordModal() {
    closeModal('forgot-password-modal');
    if (currentMode === 'gateway') setTopBarState('compact');
}

function backToLoginFromRecovery() {
    closeModal('forgot-password-modal');
    openUserLoginModal();
}

async function submitForgotPasswordRequest() {
    const empId = (document.getElementById('fp-emp-id')?.value || '').trim().toUpperCase();
    const zoneCheck = (document.getElementById('fp-verify-zone')?.value || '').trim().toLowerCase();
    const contact = (document.getElementById('fp-contact-info')?.value || '').trim();

    if (!empId || !zoneCheck || !contact) {
        return showToast('Enter Employee ID, Department/Work Zone, and Contact Info.', 'error');
    }

    const emp = DB.employees.find(e => e.employee_id.toUpperCase() === empId);
    if (!emp) return showToast(`Employee ID ${empId} not found.`, 'error');

    const deptMatch = (emp.department || '').toLowerCase().includes(zoneCheck);
    const zoneMatch = (emp.work_location_zone || '').toLowerCase().includes(zoneCheck);
    const roleMatch = (emp.role_designation || '').toLowerCase().includes(zoneCheck);

    if (!deptMatch && !zoneMatch && !roleMatch) {
        return showToast('Verification failed: Department or Work Zone does not match records.', 'error');
    }

    const alreadyPending = DB.department_communications.some(
        c => c.protocol_category === 'Password Reset' && c.linked_reference_id === emp.employee_id &&
             (c.comm_status === 'Pending Support Verification' || c.comm_status === 'Escalated to Admin')
    );
    if (alreadyPending) {
        return showToast('A password reset request for this account is already pending.', 'error');
    }

    const supportEmp = DB.employees.find(e => e.employee_id === 'DT-C-CST-01');
    const payload = {
        sender_id: emp.employee_id,
        sender_name: emp.full_name,
        sender_role: emp.role_designation,
        receiver_id: 'DT-C-CST-01',
        receiver_name: supportEmp ? supportEmp.full_name : 'Shehani Mel',
        receiver_role: 'CDMS Support Team',
        protocol_category: 'Password Reset',
        linked_reference_id: emp.employee_id,
        subject_line: `Password Reset (${emp.employee_id} - ${emp.full_name})`,
        message_body: `Verified Zone: ${emp.work_location_zone} | Deliver Temp Password to: ${contact}`,
        comm_status: 'Pending Support Verification'
    };

    await supa.from('department_communications').insert([payload]);
    await writeAuditLog('FORGOT_PASSWORD_REQUEST', 'Employees', emp.employee_id, { contact });
    await syncFromSupabase();
    backToLoginFromRecovery();
    showToast('Reset request sent to CDMS Support Team.');
}

function openPasswordChangeModal(forced = false) {
    closeProfilePopover();
    isForcedPasswordReset = forced;
    const modal = document.getElementById('change-password-modal');
    const closeBtn = document.getElementById('cp-close-btn');
    const title = document.getElementById('cp-modal-title');
    const sub = document.getElementById('cp-modal-subtitle');

    if (forced) {
        title.innerText = 'Mandatory Password Update';
        sub.innerText = 'You signed in with a Temporary Password. Set a new password to continue.';
        if (closeBtn) closeBtn.classList.add('hidden');
    } else {
        title.innerText = 'Update Password';
        sub.innerText = 'Set a new password for your CDMS+ account.';
        if (closeBtn) closeBtn.classList.remove('hidden');
    }

    document.getElementById('cp-new-pass').value = '';
    document.getElementById('cp-confirm-pass').value = '';
    modal.classList.remove('hidden');
}

async function saveNewUserPassword() {
    if (!currentLoggedInUser) return;
    const p1 = (document.getElementById('cp-new-pass')?.value || '').trim();
    const p2 = (document.getElementById('cp-confirm-pass')?.value || '').trim();

    if (p1.length < 4) return showToast('Password must be at least 4 characters.', 'error');
    if (p1 !== p2) return showToast('Passwords do not match.', 'error');

    await supa.from('employees').update({
        account_password: p1,
        temp_password: null,
        must_reset_password: false
    }).eq('employee_id', currentLoggedInUser.employee_id);

    await writeAuditLog('PASSWORD_CHANGED', 'Employees', currentLoggedInUser.employee_id, { updated_by: currentLoggedInUser.employee_id });
    isForcedPasswordReset = false;
    closeModal('change-password-modal');
    await syncFromSupabase();
    showToast('Password updated.');
}

function promptPatternRoomAccess() {
    setTopBarState('expanded-auth');
    kioskAuthMode = 'unlock';
    document.getElementById('kiosk-auth-title').innerText = 'Unlock Pattern Room Kiosk';
    document.getElementById('kiosk-auth-submit-btn').innerText = 'Unlock Kiosk';
    document.getElementById('kiosk-auth-password').value = '';
    document.getElementById('kiosk-pass-wrapper').classList.toggle('hidden', authLockOpen);
    document.getElementById('kiosk-auth-modal').classList.remove('hidden');
}

async function executeKioskAuthAction() {
    if (isAuthBusy) return;
    const pass = document.getElementById('kiosk-auth-password').value.trim();
    if (!authLockOpen) {
        if (!pass) {
            return showToast('Please enter the Pattern Room password.', 'error');
        }
        // Validate against plant kiosk password or Pattern Room / Admin staff credentials
        const validKioskStaff = DB.employees.some(e =>
            (e.employee_id.startsWith('PR-') || e.employee_id.startsWith('DT-') || e.employee_id.startsWith('CDTE') || e.employee_id.startsWith('DH')) &&
            ((e.account_password && e.account_password === pass) || (e.temp_password && e.temp_password === pass))
        );
        if (pass !== 'bodyline123' && !validKioskStaff) {
            return showToast('Incorrect Pattern Room kiosk password.', 'error');
        }
    }

    isAuthBusy = true;
    closeModal('kiosk-auth-modal');

    if (kioskAuthMode === 'unlock') {
        currentMode = 'terminal';
        currentLoggedInUser = null;
        document.getElementById('view-gateway').classList.add('hidden');
        setTopBarState('expanded-terminal');
        document.getElementById('comm-floating-Dock').classList.add('hidden');
        document.getElementById('role-workspace-tabs').innerHTML = '';
        hideAllMainViews();
        document.getElementById('view-tracker').classList.remove('hidden');
        populatePatternRoomFilterDropdowns();
        renderPatternGrid();
        showToast('Pattern Room Kiosk unlocked.');

        setTimeout(() => { isAuthBusy = false; }, 400);
        await writeAuditLog('KIOSK_UNLOCKED', 'Pattern_Room', 'TERMINAL', { status: 'Unlocked for Shift' });
        await syncFromSupabase();
        populatePatternRoomFilterDropdowns();
        renderPatternGrid();
    } else {
        returnToWelcomeScreenImmediate();
        showToast('Pattern Room Kiosk signed out.');
        setTimeout(() => { isAuthBusy = false; }, 400);
        await writeAuditLog('KIOSK_SIGNED_OUT', 'Pattern_Room', 'TERMINAL', { status: 'Signed Out' });
    }
}

function triggerCredentialedLogout() {
    closeProfilePopover();
    closeAllFullscreenPanels();
    if (currentMode === 'terminal') {
        kioskAuthMode = 'logout';
        document.getElementById('kiosk-auth-title').innerText = 'Sign Out Pattern Room Kiosk';
        document.getElementById('kiosk-auth-submit-btn').innerText = 'Confirm Sign Out';
        document.getElementById('kiosk-auth-password').value = '';
        document.getElementById('kiosk-pass-wrapper').classList.toggle('hidden', authLockOpen);
        document.getElementById('kiosk-auth-modal').classList.remove('hidden');
        return;
    }

    returnToWelcomeScreenImmediate();
    showToast('Signed out.');
}

function returnToWelcomeScreenImmediate() {
    currentMode = 'gateway';
    currentLoggedInUser = null;
    if (mutexPollInterval) {
        clearInterval(mutexPollInterval);
        mutexPollInterval = null;
    }
    stopActiveQrCamera();
    stopQcQrScanner();
    closeAllFullscreenPanels();
    hideAllMainViews();
    closeProfilePopover();
    closeCommDrawer();
    setTopBarState('compact');
    updateGatewayStatusLabel();
    document.getElementById('comm-floating-Dock').classList.add('hidden');
    document.getElementById('view-gateway').classList.remove('hidden');
}


// --- Sequential ID Generators (Employees, Patterns, Orders & Defects) ---
// Builds standardized prefixes (e.g. TR-PB-01, CW-L1-CMO-01) from selected attributes.

function getBrandPrefix(brandName) {
    const b = (brandName || '').toLowerCase();
    if (b.includes('triumph')) return 'TR';
    if (b.includes('victoria')) return 'VS';
    if (b.includes('lululemon')) return 'LL';
    if (b.includes('nike')) return 'NK';
    const param = DB.system_settings_audit.find(s => s.category === 'Brand' && s.setting_value === brandName);
    if (param && param.prefix_data) return param.prefix_data.toUpperCase();
    return (brandName || 'CD').substring(0, 2).toUpperCase();
}

function autoGeneratePatternAssetId() {
    const styleEl = document.getElementById('pat-style-select');
    const typeEl = document.getElementById('pat-tooling-type');
    const outEl = document.getElementById('pat-asset-id');
    if (!styleEl || !typeEl || !outEl) return;

    const styleObj = DB.cad_markers.find(m => m.style_code === styleEl.value);
    const brandPrefix = getBrandPrefix(styleObj ? styleObj.brand_buyer : 'Triumph');
    const typeCode = typeEl.value === 'Pattern Mold' ? 'PM' : 'PB';
    const prefix = `${brandPrefix}-${typeCode}-`;

    const existingNums = DB.pattern_assets
        .filter(p => p.asset_id.startsWith(prefix))
        .map(p => parseInt(p.asset_id.replace(prefix, ''), 10))
        .filter(n => !isNaN(n));

    const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    outEl.value = `${prefix}${String(nextNum).padStart(2, '0')}`;
}

function autoSuggestStyleCode() {
    const brandEl = document.getElementById('cad-brand-select');
    const styleInput = document.getElementById('cad-style-code');
    if (!brandEl || !styleInput) return;
    const prefix = getBrandPrefix(brandEl.value);
    const count = DB.cad_markers.filter(m => m.brand_buyer === brandEl.value).length + 1;
    styleInput.placeholder = `e.g. ${prefix}-NEW-${String(count).padStart(2, '0')}`;
}

function autoGenerateEmployeeId() {
    const role = document.getElementById('reg-emp-role')?.value || '';
    const zone = document.getElementById('reg-emp-zone')?.value || '';
    const idInput = document.getElementById('reg-emp-id');
    if (!idInput) return;

    const lineMatch = zone.match(/Line\s*(\d)/i);
    const lineCode = lineMatch ? `L${lineMatch[1]}` : 'L1';

    let prefix = 'EMP-';
    if (role.includes('Dpt. Head')) prefix = 'DH-';
    else if (role.includes('Senior Executive')) prefix = 'CSE-';
    else if (role.includes('Cutting Supervisors')) prefix = `CS-${lineCode}-`;
    else if (role.includes('Fabric Spreaders')) prefix = `CW-${lineCode}-FS-`;
    else if (role.includes('Cutting Machine Operators')) prefix = `CW-${lineCode}-CMO-`;
    else if (role.includes('Bundling Unit')) prefix = `CW-${lineCode}-BU-`;
    else if (role.includes('Sewing')) prefix = 'SDC-C-';
    else if (role.includes('Quality Control Executive')) prefix = 'CQCE-';
    else if (role.includes('Quality Control Inspectors')) prefix = 'QCI-C-';
    else if (role.includes('RMW')) prefix = 'RMWC-C-';
    else if (role.includes('Design')) prefix = 'DDC-C-';
    else if (role.includes('CAD Coordinators')) prefix = 'CADC-C-';
    else if (role.includes('Marker Makers')) prefix = 'CAD-C-MM-';
    else if (role.includes('CAD Pattern') || role.includes('CAD Patern')) prefix = 'CAD-C-CPH-';
    else if (role.includes('Pattern Coordinators')) prefix = 'PR-C-PC-';
    else if (role.includes('Pattern Handlers') || role.includes('Pattern Hanlders')) prefix = 'PR-C-PH-';
    else if (role.includes('Digital Team Executive')) prefix = 'CDTE-';
    else if (role.includes('Support Team')) prefix = 'DT-C-CST-';
    else if (role.includes('Admins')) prefix = 'DT-C-CA-';

    const existingNums = DB.employees
        .filter(e => e.employee_id.startsWith(prefix))
        .map(e => parseInt(e.employee_id.replace(prefix, ''), 10))
        .filter(n => !isNaN(n));

    const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    idInput.value = `${prefix}${String(nextNum).padStart(2, '0')}`;
}

function getNextSequentialId(list, keyField, prefix, padLen = 3) {
    const nums = list
        .map(item => parseInt(String(item[keyField] || '').replace(prefix, ''), 10))
        .filter(n => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `${prefix}${String(next).padStart(padLen, '0')}`;
}


// --- Photo Uploads, Staff Profile Modal & Discard Vault ---
// Manages profile/asset photos, confirmation-gated suspensions, and soft-delete archiving.

function triggerSingleRowPhotoUpload(targetType, targetId) {
    const fileInput = document.getElementById('single-row-photo-input');
    fileInput.value = '';
    fileInput.onchange = async () => {
        const dataUrl = await readAndCompressImage(fileInput, targetType === 'employee' ? 360 : 520);
        if (!dataUrl) return;

        if (targetType === 'employee') {
            await supa.from('employees').update({ avatar_url: dataUrl }).eq('employee_id', targetId);
            await writeAuditLog('UPDATE_STAFF_PHOTO', 'Employees', targetId, { updated_by: currentLoggedInUser?.employee_id || 'Support' });
            await syncFromSupabase();
            renderAdminEmployeeList();
            if (currentInspectedStaffId === targetId) openStaffProfileModal(targetId);
            showToast(`Updated profile photo for ${targetId}.`);
        } else if (targetType === 'pattern') {
            const pat = DB.pattern_assets.find(p => p.asset_id === targetId);
            if (pat) pat.image_url = dataUrl;
            await supa.from('pattern_assets').update({ image_url: dataUrl }).eq('asset_id', targetId);
            await writeAuditLog('UPDATE_ASSET_PHOTO', 'Pattern_Assets', targetId, { asset_id: targetId });
            await syncFromSupabase();
            renderDesignCadPortal();
            if (!document.getElementById('view-tracker').classList.contains('hidden')) handlePatternSearch();
            showToast(`Updated item photo for ${targetId}.`);
        } else if (targetType === 'cad_marker') {
            const mk = DB.cad_markers.find(m => m.cad_marker_id === targetId);
            if (mk) mk.sketch_url = dataUrl;
            await supa.from('cad_markers').update({ sketch_url: dataUrl }).eq('cad_marker_id', targetId);
            await writeAuditLog('UPDATE_DESIGN_PHOTO', 'CAD_Markers', targetId, { cad_marker_id: targetId });
            await syncFromSupabase();
            renderDesignCadPortal();
            showToast(`Updated design photo for ${targetId}.`);
        }
    };
    fileInput.click();
}

async function removeItemOrStaffPhoto(targetType, targetId) {
    if (targetType === 'employee') {
        const emp = DB.employees.find(e => e.employee_id === targetId);
        if (!emp || !hasCustomPhoto(emp.avatar_url)) return;
        emp.avatar_url = '';
        await supa.from('employees').update({ avatar_url: '' }).eq('employee_id', targetId);
        await writeAuditLog('REMOVE_STAFF_PHOTO', 'Employees', targetId, { photo_status: 'Removed (Staff Retained)' });
        await syncFromSupabase();
        renderAdminEmployeeList();
        if (currentInspectedStaffId === targetId) openStaffProfileModal(targetId);
        showToast(`Photo deleted for ${targetId}.`);
    } else if (targetType === 'pattern') {
        const pat = DB.pattern_assets.find(p => p.asset_id === targetId);
        if (!pat || !hasCustomPhoto(pat.image_url)) return;
        pat.image_url = '';
        await supa.from('pattern_assets').update({ image_url: '' }).eq('asset_id', targetId);
        await writeAuditLog('REMOVE_ASSET_PHOTO', 'Pattern_Assets', targetId, { photo_status: 'Removed (Asset Retained)' });
        await syncFromSupabase();
        renderDesignCadPortal();
        if (!document.getElementById('view-tracker').classList.contains('hidden')) handlePatternSearch();
        showToast(`Photo deleted for ${targetId}.`);
    } else if (targetType === 'cad_marker') {
        const mk = DB.cad_markers.find(m => m.cad_marker_id === targetId);
        if (!mk || !hasCustomPhoto(mk.sketch_url)) return;
        mk.sketch_url = '';
        await supa.from('cad_markers').update({ sketch_url: '' }).eq('cad_marker_id', targetId);
        await writeAuditLog('REMOVE_DESIGN_PHOTO', 'CAD_Markers', targetId, { photo_status: 'Removed (Design Retained)' });
        await syncFromSupabase();
        renderDesignCadPortal();
        showToast(`Photo deleted for ${targetId}.`);
    }
}

async function requestOwnAvatarRemoval() {
    if (!currentLoggedInUser || !hasCustomPhoto(currentLoggedInUser.avatar_url)) return;
    currentLoggedInUser.avatar_url = '';
    updateProfileUI(currentLoggedInUser);
    await supa.from('employees').update({ avatar_url: '' }).eq('employee_id', currentLoggedInUser.employee_id);
    await writeAuditLog('SELF_REMOVE_AVATAR', 'Employees', currentLoggedInUser.employee_id, { status: 'Photo Removed' });
    await syncFromSupabase();
    if (!document.getElementById('view-admin').classList.contains('hidden')) renderAdminEmployeeList();
    closeProfilePopover();
    showToast('Your profile photo has been deleted.');
}

// Opens the '...' Staff Profile & Disciplinary Modal
function openStaffProfileModal(empId) {
    const emp = DB.employees.find(e => e.employee_id === empId);
    if (!emp) return;

    currentInspectedStaffId = empId;
    const hasPhoto = hasCustomPhoto(emp.avatar_url);
    const status = emp.account_status || 'Active';
    const isSuspended = status.startsWith('Suspended');

    document.getElementById('spm-emp-id-badge').innerText = emp.employee_id;
    document.getElementById('spm-avatar').src = getAvatarUrl(emp.avatar_url, emp.employee_id);
    document.getElementById('spm-name').innerText = emp.full_name;
    document.getElementById('spm-role').innerText = emp.role_designation;
    document.getElementById('spm-dept-zone').innerText = `${emp.department} • ${emp.work_location_zone}`;

    const pill = document.getElementById('spm-status-pill');
    pill.innerText = status;
    pill.className = `inline-block mt-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
        isSuspended ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    }`;

    // Employee QR Badge status & generator inside the '...' Staff Profile Modal
    const qrAssigned = isEmployeeQrAssigned(emp.employee_id);
    const qrCanvas = document.getElementById('spm-qr-canvas');
    const qrTitle = document.getElementById('spm-qr-status-title');
    const qrSub = document.getElementById('spm-qr-status-sub');
    const qrBtn = document.getElementById('spm-assign-qr-btn');
    const qrPrintBtn = document.getElementById('spm-print-qr-btn');

    if (qrCanvas) {
        qrCanvas.innerHTML = '';
        if (qrAssigned && typeof QRCode !== 'undefined') {
            new QRCode(qrCanvas, { text: emp.employee_id, width: 52, height: 52 });
        } else {
            qrCanvas.innerHTML = `<div class="w-[52px] h-[52px] flex items-center justify-center text-[10px] font-mono text-zinc-400 bg-zinc-100 rounded">NO QR</div>`;
        }
    }
    if (qrTitle) qrTitle.innerText = qrAssigned ? 'QR Badge Assigned' : 'No QR Badge Assigned';
    if (qrSub) {
        qrSub.innerText = qrAssigned
            ? `Active ID: ${emp.employee_id} (Cleared for floor & kiosk)`
            : 'Cannot borrow patterns or join shift pool until QR is assigned';
    }
    if (qrPrintBtn) {
        qrPrintBtn.classList.toggle('hidden', !qrAssigned);
        qrPrintBtn.classList.toggle('inline-flex', qrAssigned);
        qrPrintBtn.onclick = () => printQrTagOrBadge('EMPLOYEE', emp.employee_id);
    }
    if (qrBtn) {
        qrBtn.disabled = qrAssigned;
        qrBtn.innerText = qrAssigned ? 'QR Active' : 'Assign QR';
        qrBtn.onclick = () => assignEmployeeQrCode(emp.employee_id);
    }

    // Photo Editor buttons (Delete Photo is grayed out / disabled if no custom photo exists)
    const upBtn = document.getElementById('spm-upload-photo-btn');
    const upTxt = document.getElementById('spm-upload-photo-text');
    const delBtn = document.getElementById('spm-delete-photo-btn');

    if (upTxt) upTxt.innerText = hasPhoto ? 'Update Photo' : 'Upload Photo';
    if (upBtn) upBtn.onclick = () => triggerSingleRowPhotoUpload('employee', emp.employee_id);
    if (delBtn) {
        delBtn.disabled = !hasPhoto;
        delBtn.onclick = () => removeItemOrStaffPhoto('employee', emp.employee_id);
    }

    // Collapsible Disciplinary Drawer (Privileged Admin only & non-protected seat)
    const isPrivAdmin = isCurrentUserPrivilegedAdmin();
    const isProtectedLeader = ['DH-01', 'CSE-01', 'DT-C-CA-01', 'CDTE-01'].includes(emp.employee_id);
    const discWrap = document.getElementById('spm-admin-disciplinary-wrapper');
    const discDrawer = document.getElementById('spm-disciplinary-drawer');

    if (discWrap) {
        discWrap.classList.toggle('hidden', !isPrivAdmin || isProtectedLeader);
    }
    if (discDrawer) discDrawer.classList.add('hidden');

    const chk = document.getElementById('spm-confirm-checkbox');
    const reasonInput = document.getElementById('spm-action-reason');
    if (chk) chk.checked = false;
    if (reasonInput) reasonInput.value = '';
    toggleSpmExecuteButton();

    document.getElementById('staff-profile-modal').classList.remove('hidden');
    refreshAllCustomSelects();
}

function toggleSpmExecuteButton() {
    const chk = document.getElementById('spm-confirm-checkbox');
    const btn = document.getElementById('spm-execute-action-btn');
    if (btn && chk) {
        btn.disabled = !chk.checked;
    }
}

async function executeConfirmedStaffAction() {
    if (!currentInspectedStaffId || !isCurrentUserPrivilegedAdmin()) return;
    const emp = DB.employees.find(e => e.employee_id === currentInspectedStaffId);
    if (!emp) return;

    const actionType = document.getElementById('spm-action-type').value;
    const reason = (document.getElementById('spm-action-reason')?.value || '').trim() || 'Administrative status update';

    if (actionType === 'ARCHIVE') {
        closeModal('staff-profile-modal');
        await softDeleteRecord('employees', emp.employee_id, reason);
        return;
    }

    let untilDate = null;
    if (actionType.includes('7-Day')) {
        untilDate = getLocalDateString(new Date(Date.now() + 7 * 86400000));
    } else if (actionType.includes('30-Day')) {
        untilDate = getLocalDateString(new Date(Date.now() + 30 * 86400000));
    }

    await supa.from('employees').update({
        account_status: actionType,
        suspension_until: untilDate
    }).eq('employee_id', emp.employee_id);

    // Log a formal, non-bothersome Staff Status Report for the Cutting Department Head
    const dhEmp = DB.employees.find(e => e.employee_id === 'DH-01');
    await supa.from('department_communications').insert([{
        sender_id: currentLoggedInUser.employee_id,
        sender_name: currentLoggedInUser.full_name,
        sender_role: currentLoggedInUser.role_designation,
        receiver_id: 'DH-01',
        receiver_name: dhEmp ? dhEmp.full_name : 'Cutting Department Head',
        receiver_role: 'Cutting Dpt. Head',
        protocol_category: 'Staff Status Report',
        linked_reference_id: emp.employee_id,
        subject_line: `${emp.full_name} (${actionType})`,
        message_body: `Role: ${emp.role_designation} | Action: ${actionType} ${untilDate ? `(Until ${untilDate})` : ''} | Reason: ${reason}`,
        comm_status: 'Filed Report'
    }]);

    await writeAuditLog('STAFF_STATUS_ACTION', 'Employees', emp.employee_id, { actionType, untilDate, reason });
    await syncFromSupabase();
    renderAdminEmployeeList();
    openStaffProfileModal(emp.employee_id);
    showToast(`Updated ${emp.full_name} to "${actionType}" and filed report for Department Head.`);
}

async function handleBulkEmployeePhotos(inputEl) {
    if (!inputEl.files || inputEl.files.length === 0) return;
    let matchedCount = 0;

    for (const file of inputEl.files) {
        const baseName = file.name.replace(/\.[^/.]+$/, '').trim().toUpperCase();
        const emp = DB.employees.find(e => e.employee_id.toUpperCase() === baseName || e.full_name.toUpperCase() === baseName);
        if (emp) {
            const dataUrl = await readAndCompressImageFile(file, 260);
            if (dataUrl) {
                await supa.from('employees').update({ avatar_url: dataUrl }).eq('employee_id', emp.employee_id);
                matchedCount++;
            }
        }
    }

    inputEl.value = '';
    await syncFromSupabase();
    renderAdminEmployeeList();
    if (matchedCount > 0) {
        showToast(`Bulk updated ${matchedCount} employee profile photos.`);
    } else {
        showToast('Name files by Employee ID (e.g. DH-01.jpg) or open "..." on any staff row.', 'error');
    }
}

async function submitAvatarChangeRequest(fileInput) {
    if (!currentLoggedInUser) return;
    const imgData = await readAndCompressImage(fileInput, 240);
    if (!imgData) return;

    await supa.from('employees').update({ avatar_url: imgData }).eq('employee_id', currentLoggedInUser.employee_id);
    currentLoggedInUser.avatar_url = imgData;
    updateProfileUI(currentLoggedInUser);

    const supportEmp = DB.employees.find(e => e.employee_id === 'DT-C-CST-01');
    const payload = {
        sender_id: currentLoggedInUser.employee_id,
        sender_name: currentLoggedInUser.full_name,
        sender_role: currentLoggedInUser.role_designation,
        receiver_id: 'DT-C-CST-01',
        receiver_name: supportEmp ? supportEmp.full_name : 'Shehani Mel',
        receiver_role: 'CDMS Support Team',
        protocol_category: 'Avatar Request',
        linked_reference_id: currentLoggedInUser.employee_id,
        subject_line: `Profile Photo Update (${currentLoggedInUser.full_name})`,
        message_body: 'Uploaded new staff profile photo.',
        comm_status: 'Approved',
        resolution_note: imgData
    };

    const { error } = await supa.from('department_communications').insert([payload]);
    if (error) return showToast(error.message, 'error');
    await writeAuditLog('REQUEST_AVATAR_UPDATE', 'Employees', currentLoggedInUser.employee_id, { requested_by: currentLoggedInUser.full_name });
    await syncFromSupabase();
    if (!document.getElementById('view-admin').classList.contains('hidden')) renderAdminEmployeeList();
    closeProfilePopover();
    showToast('Profile photo updated.');
}

async function resolveAvatarRequest(commId, empId, decision) {
    const req = DB.department_communications.find(c => c.comm_id === commId);
    if (!req) return;

    if (decision === 'Approved' && req.resolution_note) {
        await supa.from('employees').update({ avatar_url: req.resolution_note }).eq('employee_id', empId);
    }
    await supa.from('department_communications').update({ comm_status: decision }).eq('comm_id', commId);
    await writeAuditLog(`AVATAR_${decision.toUpperCase()}`, 'Employees', empId, { comm_id: commId });
    await syncFromSupabase();
    renderAdminPortal();
    showToast(decision === 'Approved' ? `Accepted new profile photo for ${empId}.` : `Rejected photo request.`);
}

async function softDeleteRecord(tableName, recordId, customReason = 'Archived to Discard Vault') {
    const actorId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'DT-C-CA-01';
    const actorName = currentLoggedInUser ? currentLoggedInUser.full_name : 'CDMS Admin';
    const actorRole = currentLoggedInUser ? currentLoggedInUser.role_designation : 'Admin';

    if (tableName === 'employees') {
        const isPrivilegedAdmin = ['DT-C-CA-01', 'CDTE-01'].includes(actorId);
        if (!isPrivilegedAdmin) {
            return showToast('Only CDMS Admin can archive staff accounts.', 'error');
        }
        if (['DH-01', 'CSE-01', 'DT-C-CA-01', 'CDTE-01'].includes(recordId) || recordId === actorId) {
            return showToast('Protected leadership/admin seat cannot be archived.', 'error');
        }
        const target = DB.employees.find(e => e.employee_id === recordId);
        if (!target) return;

        await supa.from('discarded_trash_vault').insert([{
            original_table: 'employees',
            record_id: recordId,
            item_label: `${target.full_name} (${target.role_designation})`,
            deleted_by_id: actorId,
            deleted_by_name: actorName,
            deleted_by_role: actorRole,
            full_record_json: JSON.stringify(target)
        }]);
        await supa.from('employees').delete().eq('employee_id', recordId);

        const dhEmp = DB.employees.find(e => e.employee_id === 'DH-01');
        await supa.from('department_communications').insert([{
            sender_id: actorId,
            sender_name: actorName,
            sender_role: actorRole,
            receiver_id: 'DH-01',
            receiver_name: dhEmp ? dhEmp.full_name : 'Cutting Department Head',
            receiver_role: 'Cutting Dpt. Head',
            protocol_category: 'Staff Status Report',
            linked_reference_id: recordId,
            subject_line: `${target.full_name} (Archived to Vault)`,
            message_body: `Role: ${target.role_designation} (${target.work_location_zone}) | Action: Archived to Discard Vault | Reason: ${customReason}`,
            comm_status: 'Filed Report'
        }]);

        await writeAuditLog('ARCHIVE_EMPLOYEE_TO_VAULT', 'Employees', recordId, target);
        await syncFromSupabase();
        renderAdminPortal();
        showToast(`${recordId} moved to Discard Vault & logged in Staff Status Reports.`);
    } else if (tableName === 'pattern_assets') {
        const target = DB.pattern_assets.find(p => p.asset_id === recordId);
        if (!target) return;
        if (target.operational_status === 'Active on Line') {
            return showToast('Cannot discard an item while it is checked out on a cutting line.', 'error');
        }

        await supa.from('discarded_trash_vault').insert([{
            original_table: 'pattern_assets',
            record_id: recordId,
            item_label: `${target.model_name} (${target.brand_buyer} / ${target.tooling_type})`,
            deleted_by_id: actorId,
            deleted_by_name: actorName,
            deleted_by_role: actorRole,
            full_record_json: JSON.stringify(target)
        }]);
        await supa.from('pattern_assets').delete().eq('asset_id', recordId);
        await writeAuditLog('DISCARD_PATTERN_ASSET', 'Pattern_Assets', recordId, target);
        await syncFromSupabase();
        renderDesignCadPortal();
        showToast(`${recordId} moved to Discard Vault.`);
    }
}

async function openDiscardVaultModal() {
    await syncFromSupabase();
    document.getElementById('discard-vault-modal').classList.remove('hidden');
    renderDiscardVaultList();
}

function renderDiscardVaultList() {
    const listEl = document.getElementById('discard-vault-list');
    if (!listEl) return;

    const rows = DB.discarded_trash_vault || [];
    const badge = document.getElementById('trash-vault-count-badge');
    if (badge) badge.innerText = rows.length;

    listEl.innerHTML = rows.map(r => `
        <div class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 flex flex-wrap justify-between items-center gap-3">
            <div>
                <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded bg-zinc-900 text-white font-mono text-[10px] uppercase">${r.original_table}</span>
                    <strong class="font-mono text-zinc-900">${r.record_id}</strong>
                    <span class="text-zinc-700 font-semibold">${r.item_label || ''}</span>
                </div>
                <p class="text-[11px] text-zinc-500 mt-1">Archived by <strong>${r.deleted_by_name}</strong> (${r.deleted_by_id}) on ${new Date(r.deleted_at || Date.now()).toLocaleString()}</p>
            </div>
            <button type="button" onclick="restoreFromDiscardVault(${r.trash_id})" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-xl font-bold text-xs">
                Restore
            </button>
        </div>
    `).join('') || '<p class="text-center text-zinc-400 py-10">Discard Vault is empty.</p>';
}

async function restoreFromDiscardVault(trashId) {
    const item = DB.discarded_trash_vault.find(t => t.trash_id === trashId);
    if (!item) return;

    try {
        const parsed = JSON.parse(item.full_record_json);
        await supa.from(item.original_table).insert([parsed]);
        await supa.from('discarded_trash_vault').delete().eq('trash_id', trashId);
        await writeAuditLog('RESTORE_FROM_VAULT', item.original_table, item.record_id, parsed);
        await syncFromSupabase();
        renderDiscardVaultList();
        if (!document.getElementById('view-admin').classList.contains('hidden')) renderAdminPortal();
        if (!document.getElementById('view-design-cad').classList.contains('hidden')) renderDesignCadPortal();
        showToast(`Restored ${item.record_id} to ${item.original_table}.`);
    } catch (err) {
        showToast('Restore failed: ' + err.message, 'error');
    }
}


// --- Role-Based Workspace Navigation ---
// Builds the sub-navigation tabs based on the signed-in employee's department prefix.

function buildRoleIsolatedTabs(emp) {
    const id = emp.employee_id.toUpperCase();
    const navStrip = document.getElementById('role-workspace-tabs');
    let tabs = [];

    if (id.startsWith('DH')) {
        tabs = [
            { key: 'dept-head', label: 'Overview' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('CSE')) {
        tabs = [
            { key: 'supervisor', label: 'Schedule & Cut Commands' },
            { key: 'supply', label: 'Orders & RMW' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('CS-')) {
        tabs = [
            { key: 'supervisor', label: 'Schedule & Cut Orders' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('DDC')) {
        tabs = [
            { key: 'design-cad', label: 'Style Studio' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('CAD')) {
        tabs = [
            { key: 'design-cad', label: 'CAD Pipeline' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('PR-')) {
        tabs = [
            { key: 'design-cad', label: 'Pattern Inventory' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('SDC')) {
        tabs = [
            { key: 'supply', label: 'Sewing Orders' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('RMW')) {
        tabs = [
            { key: 'supply', label: 'RMW Dispatch' },
            { key: 'reports', label: 'Reports' }
        ];
    } else if (id.startsWith('CQCE') || id.startsWith('QCI')) {
        tabs = [
            { key: 'qc', label: 'Quality Control' },
            { key: 'reports', label: 'Reports' }
        ];
    } else {
        tabs = [
            { key: 'admin', label: 'Directory & System' },
            { key: 'reports', label: 'Reports & Database' }
        ];
    }

    const tabsHtml = tabs.map(t => `
        <button type="button" onclick="switchPortalView('${t.key}')" data-tab-key="${t.key}" class="role-tab whitespace-nowrap px-4 py-1.5 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-100 transition-colors">
            ${t.label}
        </button>
    `).join('');

    if (navStrip) navStrip.innerHTML = tabsHtml;
    switchPortalView(tabs[0].key);
}

function hideAllMainViews() {
    ['view-tracker', 'view-dept-head', 'view-supervisor', 'view-design-cad', 'view-supply', 'view-qc', 'view-admin', 'view-reports'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}

function switchPortalView(viewKey) {
    closeCustomSelectMenu();
    closeAllFullscreenPanels();
    hideAllMainViews();
    document.querySelectorAll('.role-tab').forEach(b => {
        if (b.getAttribute('data-tab-key') === viewKey) {
            b.className = 'role-tab whitespace-nowrap px-4 py-1.5 rounded-lg text-xs font-bold bg-zinc-900 text-white transition-colors';
        } else {
            b.className = 'role-tab whitespace-nowrap px-4 py-1.5 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-100 transition-colors';
        }
    });

    document.getElementById(`view-${viewKey}`).classList.remove('hidden');

    if (viewKey === 'tracker') { populatePatternRoomFilterDropdowns(); renderPatternGrid(); }
    if (viewKey === 'dept-head') renderDeptHeadPortal();
    if (viewKey === 'supervisor') renderSupervisorPortal();
    if (viewKey === 'design-cad') renderDesignCadPortal();
    if (viewKey === 'supply') renderSupplyPortal();
    if (viewKey === 'qc') renderQcPortal();
    if (viewKey === 'admin') renderAdminPortal();
    if (viewKey === 'reports') { populateReportGroupFilter(); renderGroupedReport(); }
    setTimeout(refreshAllCustomSelects, 20);
}


// --- Pattern Room Kiosk: Search, QR Scanner & 15-Minute Lock Workflow ---
// Handles asset borrowing, returns, and unscheduled checkout locks at the floor kiosk.

function populatePatternRoomFilterDropdowns() {
    const brandSel = document.getElementById('filter-brand-select');
    const rackSel = document.getElementById('filter-rack-select');
    if (!brandSel || !rackSel) return;

    const currentBrand = brandSel.value || 'ALL';
    const currentRack = rackSel.value || 'ALL';

    const qrApprovedPatterns = DB.pattern_assets.filter(p => isPatternQrAssigned(p.asset_id));
    const brands = [...new Set(qrApprovedPatterns.map(p => p.brand_buyer))].sort();
    const racks = [...new Set(qrApprovedPatterns.map(p => p.storage_location))].sort();

    brandSel.innerHTML = `<option value="ALL">All Brands (${brands.length})</option>` +
        brands.map(b => `<option value="${b}">${b}</option>`).join('');
    rackSel.innerHTML = `<option value="ALL">All Locations (${racks.length})</option>` +
        racks.map(r => `<option value="${r}">${r}</option>`).join('');

    if (brands.includes(currentBrand)) brandSel.value = currentBrand;
    if (racks.includes(currentRack)) rackSel.value = currentRack;
    refreshAllCustomSelects();
}

function toggleSearchFilterMenu(e) {
    if (e) e.stopPropagation();
    closeCustomSelectMenu();
    populatePatternRoomFilterDropdowns();
    const pop = document.getElementById('search-filter-popover');
    if (pop) pop.classList.toggle('hidden');
}

function resetPatternRoomFilters() {
    const brandSel = document.getElementById('filter-brand-select');
    const rackSel = document.getElementById('filter-rack-select');
    if (brandSel) brandSel.value = 'ALL';
    if (rackSel) rackSel.value = 'ALL';
    refreshAllCustomSelects();
    handlePatternSearch();
}

function handlePatternSearch() {
    const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
    const brandFilter = document.getElementById('filter-brand-select')?.value || 'ALL';
    const rackFilter = document.getElementById('filter-rack-select')?.value || 'ALL';

    document.getElementById('clearBtn').classList.toggle('hidden', q.length === 0);
    const dot = document.getElementById('filter-active-dot');
    if (dot) dot.classList.toggle('hidden', brandFilter === 'ALL' && rackFilter === 'ALL');

    renderPatternGrid(q, brandFilter, rackFilter);
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
    const isMold = (p.tooling_type || '').toLowerCase().includes('mold') || (p.asset_id || '').includes('-PM-');
    const fitClass = isMold ? 'object-fill bg-white' : 'object-contain bg-white';

    return `
        <div onclick="openScannerForAsset('${p.asset_id}')" class="product-card bg-white rounded-2xl border border-zinc-200 overflow-hidden cursor-pointer flex flex-col justify-between">
            <div>
                <div class="h-44 w-full bg-white relative overflow-hidden border-b border-zinc-100">
                    <img src="${getItemImageUrl(p.image_url)}" class="w-full h-full ${fitClass}" alt="${p.model_name}">
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

function renderPatternGrid(query = '', brandFilter = 'ALL', rackFilter = 'ALL') {
    // Only patterns with an assigned & approved QR code appear in the Pattern Room kiosk
    const totalInDb = DB.pattern_assets.length;
    let list = DB.pattern_assets.filter(p => isPatternQrAssigned(p.asset_id));
    const unassignedCount = totalInDb - list.length;

    if (brandFilter !== 'ALL') list = list.filter(p => p.brand_buyer === brandFilter);
    if (rackFilter !== 'ALL') list = list.filter(p => p.storage_location === rackFilter);
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

    const emptyQrNotice = unassignedCount > 0
        ? `<div class="col-span-full p-4 rounded-2xl bg-zinc-100 border border-zinc-200 text-xs text-zinc-600 flex flex-wrap justify-between items-center gap-2">
               <span><strong>${unassignedCount} pattern(s)</strong> in the database do not have an assigned QR code yet and are hidden from the Pattern Room kiosk.</span>
               <span class="font-mono text-[11px] text-zinc-500">Sign in as Pattern Coordinator (PR-C-PC-01) to assign QR codes.</span>
           </div>`
        : '<p class="text-xs text-zinc-400 col-span-full py-4">No matching QR-assigned inventory items.</p>';

    document.getElementById('tracker-grid-active').innerHTML = activeItems.map(renderPatternCardHtml).join('') ||
        '<p class="text-xs text-zinc-400 col-span-full py-4">No QR-assigned items currently checked out to cutting lines.</p>';
    document.getElementById('tracker-grid-inactive').innerHTML = inactiveItems.length > 0
        ? inactiveItems.map(renderPatternCardHtml).join('')
        : emptyQrNotice;
}

function renderCameraSectionHtml(scanContext, assetId = '') {
    if (cameraPermissionState === 'prompt') {
        return `
            <div id="camera-permission-card" class="p-4 rounded-xl bg-zinc-50 border border-zinc-200 text-center space-y-3">
                <div class="w-10 h-10 rounded-full bg-zinc-200/80 text-zinc-800 flex items-center justify-center mx-auto">
                    <i class="ph-bold ph-camera text-xl"></i>
                </div>
                <div>
                    <p class="text-xs font-bold text-zinc-900">Allow Camera Access for QR Scanning?</p>
                </div>
                <div class="grid grid-cols-2 gap-2 pt-1">
                    <button type="button" onclick="handleWebsiteCameraPermission(true, '${scanContext}', '${assetId}')" class="bg-zinc-900 hover:bg-zinc-800 text-white py-2 rounded-lg text-xs font-semibold">Allow Camera</button>
                    <button type="button" onclick="handleWebsiteCameraPermission(false, '${scanContext}', '${assetId}')" class="bg-zinc-200 hover:bg-zinc-300 text-zinc-800 py-2 rounded-lg text-xs font-semibold">Use Manual ID</button>
                </div>
            </div>
        `;
    } else if (cameraPermissionState === 'granted') {
        return `
            <div class="space-y-2">
                <div class="flex justify-between items-center text-[11px] font-semibold text-zinc-600">
                    <span><i class="ph-fill ph-camera text-emerald-600"></i> QR Scanner Active</span>
                    <button type="button" onclick="handleWebsiteCameraPermission(false, '${scanContext}', '${assetId}')" class="text-zinc-400 hover:text-zinc-800">Turn Off</button>
                </div>
                <div id="qr-camera-reader" class="w-full bg-zinc-900 rounded-xl overflow-hidden min-h-[180px] flex items-center justify-center text-xs text-zinc-400">Initializing camera...</div>
            </div>
        `;
    } else {
        return `
            <div class="p-2.5 rounded-xl bg-zinc-100 border border-zinc-200 flex justify-between items-center text-xs text-zinc-600">
                <span>Camera off. Use manual ID below.</span>
                <button type="button" onclick="handleWebsiteCameraPermission(true, '${scanContext}', '${assetId}')" class="font-bold text-zinc-900 underline">Enable Camera</button>
            </div>
        `;
    }
}

async function handleWebsiteCameraPermission(allowed, scanContext, assetId) {
    cameraPermissionState = allowed ? 'granted' : 'denied';
    if (!allowed) await stopActiveQrCamera();

    if (scanContext === 'quick-item') {
        openQuickQrScanner();
    } else {
        openScannerForAsset(assetId);
    }
}

async function startHtml5CameraStream(onDecodedCallback) {
    await stopActiveQrCamera();
    if (cameraPermissionState !== 'granted') return;
    const readerEl = document.getElementById('qr-camera-reader');
    if (!readerEl || typeof Html5Qrcode === 'undefined') return;

    try {
        html5QrScanner = new Html5Qrcode('qr-camera-reader');
        await html5QrScanner.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 190, height: 190 } },
            async (decodedText) => {
                await stopActiveQrCamera();
                onDecodedCallback(decodedText.trim().toUpperCase());
            },
            () => {}
        );
    } catch (err) {
        if (readerEl) {
            readerEl.innerHTML = `<p class="p-4 text-center text-xs text-zinc-400">Camera unavailable. Use Manual ID entry below.</p>`;
        }
    }
}

function openQuickQrScanner() {
    document.getElementById('modal-title').innerText = 'Scan Pattern or 3D Mold QR';
    document.getElementById('verify-modal').classList.remove('hidden');
    const area = document.getElementById('modal-dynamic-area');

    const qrAssignedAssets = DB.pattern_assets.filter(p => isPatternQrAssigned(p.asset_id));
    const sandboxItemsHtml = sandboxMode === '0' ? `
        <div class="border-t border-zinc-200 pt-3 mt-3">
            <p class="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Sandbox QR Triggers (${qrAssignedAssets.length} QR-Assigned)</p>
            <div class="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto custom-scroll pr-1">
                ${qrAssignedAssets.map(p => `
                    <button type="button" onclick="openScannerForAsset('${p.asset_id}')" class="p-2 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-left text-xs truncate">
                        <strong class="font-mono text-zinc-900">${p.asset_id}</strong> <span class="text-zinc-500">${p.model_name}</span>
                    </button>
                `).join('') || '<p class="col-span-2 text-xs text-zinc-400 py-2">No patterns have QR codes assigned yet.</p>'}
            </div>
        </div>
    ` : '';

    area.innerHTML = `
        <div class="space-y-4">
            ${renderCameraSectionHtml('quick-item', '')}
            <div class="border-t border-zinc-200 pt-3">
                <label class="text-xs font-semibold text-zinc-700 block mb-1.5">Manual Asset ID</label>
                <div class="flex gap-2">
                    <input id="manual-quick-asset-id" type="text" placeholder="e.g. TR-PB-01" class="flex-1 p-2.5 bg-zinc-50 border border-zinc-300 rounded-xl text-xs font-mono uppercase outline-none focus:border-zinc-900">
                    <button type="button" onclick="submitManualQuickAssetLocate()" class="bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-2.5 rounded-xl text-xs font-semibold">Locate</button>
                </div>
            </div>
            ${sandboxItemsHtml}
        </div>
    `;

    if (cameraPermissionState === 'granted') {
        setTimeout(() => {
            startHtml5CameraStream((scannedAssetId) => {
                const found = DB.pattern_assets.find(a => a.asset_id.toUpperCase() === scannedAssetId);
                if (!found) return showToast(`Code ${scannedAssetId} not found.`, 'error');
                if (!isPatternQrAssigned(found.asset_id)) {
                    return showToast(`Pattern ${found.asset_id} does not have an assigned QR code yet.`, 'error');
                }
                openScannerForAsset(found.asset_id);
            });
        }, 60);
    }
}

function submitManualQuickAssetLocate() {
    const val = (document.getElementById('manual-quick-asset-id')?.value || '').trim().toUpperCase();
    if (!val) return showToast('Enter an Asset ID.', 'error');
    const found = DB.pattern_assets.find(a => a.asset_id.toUpperCase() === val);
    if (!found) return showToast(`Asset ${val} not found.`, 'error');
    if (!isPatternQrAssigned(found.asset_id)) {
        return showToast(`Asset ${found.asset_id} has not been assigned a QR code yet.`, 'error');
    }
    openScannerForAsset(found.asset_id);
}

function openScannerForAsset(assetId) {
    const asset = DB.pattern_assets.find(a => a.asset_id === assetId);
    if (!asset) return;
    if (!isPatternQrAssigned(asset.asset_id)) {
        return showToast(`Asset ${asset.asset_id} has not been assigned a QR code yet.`, 'error');
    }
    document.getElementById('modal-title').innerText = `${asset.asset_id} (${asset.model_name})`;
    document.getElementById('verify-modal').classList.remove('hidden');
    const area = document.getElementById('modal-dynamic-area');
    const itemImg = getItemImageUrl(asset.image_url);
    const isMold = (asset.tooling_type || '').toLowerCase().includes('mold') || (asset.asset_id || '').includes('-PM-');
    const fitClass = isMold ? 'object-fill bg-white' : 'object-contain bg-white';

    if (['Inspection Flagged', 'Decommissioned', 'Pending Removal'].includes(asset.operational_status)) {
        area.innerHTML = `
            <div class="text-center py-6 space-y-3">
                <img src="${itemImg}" class="w-40 h-28 ${fitClass} rounded-xl mx-auto border">
                <h4 class="text-base font-bold text-rose-600 uppercase">Restricted (${asset.operational_status})</h4>
                <p class="text-xs text-zinc-600">${asset.asset_id} cannot be checked out while flagged.</p>
            </div>
        `;
        return;
    }

    const floorOps = DB.employees.filter(e => e.employee_id.startsWith('CW-') && isEmployeeQrAssigned(e.employee_id));
    const todayStr = getLocalDateString();

    if (asset.operational_status === 'Active on Line') {
        const sandboxReturnBtns = sandboxMode === '0' ? `
            <div class="border-t border-zinc-200 pt-3 mt-2">
                <button type="button" onclick="executeAssetReturn('${asset.asset_id}', '${asset.borrowed_by_id || 'CW-L1-CMO-01'}')" class="w-full p-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 text-zinc-900 text-xs font-semibold">
                    Simulate Badge Scan (${asset.borrowed_by_id || 'Operator'}) & Return
                </button>
            </div>
        ` : '';

        area.innerHTML = `
            <div class="space-y-4">
                <div class="flex gap-3 items-center p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                    <img src="${itemImg}" class="w-20 h-14 rounded-lg ${fitClass} border">
                    <div>
                        <p class="text-xs font-medium text-zinc-500">Checked Out By: <strong class="text-zinc-900">${asset.borrowed_by_id || 'Floor Staff'}</strong></p>
                        <h4 class="text-sm font-bold text-zinc-900">${asset.model_name} (${asset.asset_id})</h4>
                        <p class="text-xs text-zinc-500">Rack: ${asset.storage_location}</p>
                    </div>
                </div>

                ${renderCameraSectionHtml('asset-return', asset.asset_id)}

                <div class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 space-y-3">
                    <label class="text-xs font-bold text-zinc-800 block">Manual Return Verification</label>
                    <input id="manual-op-id-input" type="text" placeholder="Employee ID (e.g. ${asset.borrowed_by_id || 'CW-L1-CMO-01'})" class="w-full p-2.5 bg-white border border-zinc-300 rounded-xl text-xs font-mono uppercase outline-none focus:border-zinc-900">
                    <label class="flex items-start gap-2 cursor-pointer select-none text-xs text-zinc-700">
                        <input id="manual-resp-checkbox" type="checkbox" class="mt-0.5 w-4 h-4 rounded accent-zinc-900">
                        <span>Confirm return to <strong>${asset.storage_location}</strong>.</span>
                    </label>
                    <button type="button" onclick="submitManualReturnWithTick('${asset.asset_id}')" class="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-semibold py-2.5 rounded-xl text-xs uppercase tracking-wider">
                        Return Item
                    </button>
                </div>
                ${sandboxReturnBtns}
            </div>
        `;

        if (cameraPermissionState === 'granted') {
            setTimeout(() => {
                startHtml5CameraStream((scannedEmpId) => {
                    executeAssetReturn(asset.asset_id, scannedEmpId);
                });
            }, 60);
        }
        return;
    }

    const sandboxBorrowSection = sandboxMode === '0' ? `
        <div class="border-t border-zinc-200 pt-3">
            <p class="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">Sandbox Operator Badges</p>
            <div class="space-y-1.5 max-h-40 overflow-y-auto custom-scroll pr-1">
                ${floorOps.map(op => {
                    const isSched = DB.shift_assignments.some(s => s.borrower_id === op.employee_id && s.assigned_date === todayStr) ||
                                    DB.cutting_orders.some(o => o.assigned_operator_id === op.employee_id && o.style_code === asset.style_code && o.pattern_box_cleared);
                    return `
                        <button type="button" onclick="executeAssetBorrow('${asset.asset_id}', '${op.employee_id}')" class="w-full text-left p-2 rounded-xl bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-xs flex justify-between items-center">
                            <span class="flex items-center gap-2">
                                <img src="${getAvatarUrl(op.avatar_url, op.employee_id)}" class="w-6 h-6 rounded-full object-cover border border-zinc-300">
                                <span><strong class="text-zinc-900">${op.full_name}</strong> <span class="font-mono text-zinc-400">(${op.employee_id})</span></span>
                            </span>
                            <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${isSched ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">${isSched ? 'Cleared' : 'Hold'}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    ` : '';

    area.innerHTML = `
        <div class="space-y-4">
            <div class="flex gap-3 items-center p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                <img src="${itemImg}" class="w-20 h-14 rounded-lg ${fitClass} border">
                <div>
                    <p class="text-xs font-medium text-zinc-500">${asset.brand_buyer} (${asset.style_code})</p>
                    <h4 class="text-base font-bold text-zinc-900">${asset.model_name} (${asset.asset_id})</h4>
                    <p class="text-xs text-zinc-500">Size ${asset.size_category} / ${asset.storage_location}</p>
                </div>
            </div>

            <div>
                <label class="text-xs font-semibold text-zinc-600 block mb-1">Target Shift</label>
                <select id="scan-shift-select" class="w-full p-2.5 bg-zinc-50 border border-zinc-300 rounded-xl text-xs font-semibold">
                    <option value="Morning">Morning (06:00 to 14:00)</option>
                    <option value="Afternoon">Afternoon (14:00 to 22:00)</option>
                    <option value="Night">Night (22:00 to 06:00)</option>
                </select>
            </div>

            ${renderCameraSectionHtml('asset-borrow', asset.asset_id)}

            <div class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 space-y-3">
                <label class="text-xs font-bold text-zinc-800 block">Manual Operator ID</label>
                <input id="manual-op-id-input" type="text" placeholder="Enter Employee ID (e.g. CW-L1-CMO-01)" class="w-full p-2.5 bg-white border border-zinc-300 rounded-xl text-xs font-mono uppercase outline-none focus:border-zinc-900">
                <label class="flex items-start gap-2 cursor-pointer select-none text-xs text-zinc-700">
                    <input id="manual-resp-checkbox" type="checkbox" class="mt-0.5 w-4 h-4 rounded accent-zinc-900">
                    <span>Confirm borrowing <strong>${asset.asset_id}</strong>.</span>
                </label>
                <button type="button" onclick="submitManualBorrowWithTick('${asset.asset_id}')" class="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-semibold py-2.5 rounded-xl text-xs uppercase tracking-wider">
                    Borrow Item
                </button>
            </div>
            ${sandboxBorrowSection}
        </div>
    `;

    refreshAllCustomSelects();

    if (cameraPermissionState === 'granted') {
        setTimeout(() => {
            startHtml5CameraStream((scannedEmpId) => {
                executeAssetBorrow(asset.asset_id, scannedEmpId);
            });
        }, 60);
    }
}

function submitManualBorrowWithTick(assetId) {
    const empId = (document.getElementById('manual-op-id-input')?.value || '').trim().toUpperCase();
    const ticked = document.getElementById('manual-resp-checkbox')?.checked;

    if (!empId) return showToast('Enter your Employee ID.', 'error');
    const emp = DB.employees.find(e => e.employee_id.toUpperCase() === empId);
    if (!emp) return showToast(`Employee ID ${empId} not found.`, 'error');
    if (!isEmployeeQrAssigned(emp.employee_id)) {
        return showToast(`Employee ${emp.employee_id} does not have an assigned QR badge yet.`, 'error');
    }
    if (!ticked) return showToast('Tick the confirmation box to proceed.', 'error');

    executeAssetBorrow(assetId, emp.employee_id);
}

function submitManualReturnWithTick(assetId) {
    const empId = (document.getElementById('manual-op-id-input')?.value || '').trim().toUpperCase();
    const ticked = document.getElementById('manual-resp-checkbox')?.checked;

    if (!empId) return showToast('Enter your Employee ID.', 'error');
    const emp = DB.employees.find(e => e.employee_id.toUpperCase() === empId);
    if (!emp) return showToast(`Employee ID ${empId} not found.`, 'error');
    if (!isEmployeeQrAssigned(emp.employee_id)) {
        return showToast(`Employee ${emp.employee_id} does not have an assigned QR badge yet.`, 'error');
    }
    if (!ticked) return showToast('Tick the confirmation box to return.', 'error');

    executeAssetReturn(assetId, emp.employee_id);
}

async function executeAssetBorrow(assetId, operatorId) {
    if (!isPatternQrAssigned(assetId)) {
        return showToast(`Pattern ${assetId} does not have an assigned QR code yet.`, 'error');
    }
    if (!isEmployeeQrAssigned(operatorId)) {
        return showToast(`Operator ${operatorId} does not have an assigned QR badge yet.`, 'error');
    }
    const shift = document.getElementById('scan-shift-select')?.value || 'Morning';
    const todayStr = getLocalDateString();
    const assetObj = DB.pattern_assets.find(a => a.asset_id === assetId);

    // Operators pre-scheduled on the roster or cleared via Pattern Box Permission skip the 15-minute lock
    const isScheduledOnMatrix = DB.shift_assignments.some(
        s => s.borrower_id === operatorId && s.assigned_date === todayStr && s.shift_type === shift
    );
    const isPreClearedBySupervisorBox = assetObj && DB.cutting_orders.some(
        o => o.style_code === assetObj.style_code && o.assigned_operator_id === operatorId && o.pattern_box_cleared
    );

    if (!isScheduledOnMatrix && !isPreClearedBySupervisorBox) {
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

        await writeAuditLog('15M_MUTEX_LOCK', 'Pattern_Assets', assetId, { operator: operatorId, shift });
        await syncFromSupabase();
        closeVerifyModal();
        handlePatternSearch();
        startMutexBarCountdown(assetId, operatorId, shift);
        showToast(`Unscheduled worker: ${assetId} locked for 15m pending Supervisor clearance.`, 'error');
        return;
    }

    await supa.from('pattern_assets').update({
        operational_status: 'Active on Line',
        borrowed_by_id: operatorId,
        shift_checkout: shift,
        checkout_time: new Date().toISOString(),
        last_used_date: todayStr
    }).eq('asset_id', assetId);

    await writeAuditLog('BORROW_ASSET', 'Pattern_Assets', assetId, { operator: operatorId, shift });
    await syncFromSupabase();
    closeVerifyModal();
    handlePatternSearch();
    showToast(`Checked out ${assetId} to ${operatorId}.`);
}

async function executeAssetReturn(assetId, returningOperatorId = '') {
    await supa.from('pattern_assets').update({
        operational_status: 'Available in Room',
        borrowed_by_id: null,
        shift_checkout: null,
        checkout_time: null
    }).eq('asset_id', assetId);

    await writeAuditLog('RETURN_ASSET', 'Pattern_Assets', assetId, { returned_by: returningOperatorId, status: 'Available in Room' });
    await syncFromSupabase();
    closeVerifyModal();
    handlePatternSearch();
    showToast(`${assetId} returned to Pattern Room.`);
}

// Polls Supabase every 4 seconds during a 15-minute unscheduled lock and releases the asset if time expires
function startMutexBarCountdown(assetId, operatorId, shift) {
    const bar = document.getElementById('mutex-bar');
    const msg = document.getElementById('mutex-msg');
    const timer = document.getElementById('mutex-timer');
    const btn = document.getElementById('mutex-action-btn');

    if (currentMode === 'terminal') {
        bar.classList.remove('hidden');
    }
    btn.classList.add('hidden');
    msg.innerText = `15-Min Lock on ${assetId} (${operatorId}) : Awaiting Supervisor`;

    let secs = 900;
    if (mutexPollInterval) clearInterval(mutexPollInterval);
    mutexPollInterval = setInterval(async () => {
        secs--;
        if (secs <= 0) {
            clearInterval(mutexPollInterval);
            mutexPollInterval = null;
            timer.innerText = 'EXPIRED';
            msg.innerText = `15-Min Lock Expired for ${assetId} (Released to Room)`;
            await supa.from('pattern_assets').update({
                operational_status: 'Available in Room',
                borrowed_by_id: null
            }).eq('asset_id', assetId);
            const pendingReq = DB.pending_requests.find(r => r.pattern_id === assetId && r.borrower_id === operatorId && r.request_status === 'Pending');
            if (pendingReq) {
                await supa.from('pending_requests').update({ request_status: 'Expired' }).eq('request_id', pendingReq.request_id);
            }
            await syncFromSupabase();
            handlePatternSearch();
            setTimeout(() => bar.classList.add('hidden'), 3500);
            return;
        }

        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        timer.innerText = `${m}:${s}`;

        if (secs % 4 === 0) {
            await syncFromSupabase();
            const req = DB.pending_requests.find(r => r.pattern_id === assetId && r.borrower_id === operatorId);
            if (req && req.request_status === 'Approved') {
                clearInterval(mutexPollInterval);
                mutexPollInterval = null;
                timer.innerText = 'APPROVED';
                msg.innerText = `Supervisor Approved ${assetId}`;
                btn.classList.remove('hidden');
                btn.onclick = () => { bar.classList.add('hidden'); handlePatternSearch(); };
            } else if (req && req.request_status === 'Declined') {
                clearInterval(mutexPollInterval);
                mutexPollInterval = null;
                timer.innerText = 'DENIED';
                setTimeout(() => bar.classList.add('hidden'), 3000);
            }
        }
    }, 1000);
}

function finalizeMutexCheckout() {
    closeModal('mutex-bar');
    handlePatternSearch();
}

function dismissMutexBar() {
    closeModal('mutex-bar');
}


// --- Department Head Portal & Suspension Directives ---
// Displays plant-wide KPIs, approval queues, active deployments, and disciplinary reports.

async function renderDeptHeadPortal() {
    await syncFromSupabase();
    document.getElementById('dh-kpi-total').innerText = DB.pattern_assets.length;
    document.getElementById('dh-kpi-avail').innerText = DB.pattern_assets.filter(p => p.operational_status === 'Available in Room').length;
    document.getElementById('dh-kpi-active').innerText = DB.pattern_assets.filter(p => p.operational_status === 'Active on Line').length;
    document.getElementById('dh-kpi-flagged').innerText = DB.pattern_assets.filter(p => ['Inspection Flagged', 'Pending Removal', 'Decommissioned'].includes(p.operational_status)).length;

    // Actionable approvals only (Staff Status Reports are separated into their own browsable column)
    const dhReqs = DB.department_communications.filter(
        c => c.receiver_id === 'DH-01' && c.comm_status === 'Pending Approval' && c.protocol_category !== 'Staff Status Report'
    );
    document.getElementById('dh-kpi-approvals').innerText = dhReqs.length;

    document.getElementById('dh-approvals-list').innerHTML = dhReqs.map(c => `
        <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 space-y-2 text-xs">
            <div class="flex justify-between items-start">
                <span class="px-2 py-0.5 rounded bg-zinc-900 text-white font-bold text-[10px] uppercase">${c.protocol_category}</span>
                <span class="font-mono text-[10px] text-zinc-500">${c.linked_reference_id}</span>
            </div>
            <p class="font-bold text-zinc-900">${c.subject_line}</p>
            <p class="text-zinc-600">${c.message_body}</p>
            <div class="grid grid-cols-2 gap-2 pt-1">
                <button type="button" onclick="resolveCommItem(${c.comm_id}, 'Approved')" class="bg-zinc-900 text-white py-1.5 rounded-lg font-semibold">Approve</button>
                <button type="button" onclick="resolveCommItem(${c.comm_id}, 'Rejected')" class="bg-zinc-200 text-zinc-800 py-1.5 rounded-lg font-semibold">Reject</button>
            </div>
        </div>
    `).join('') || '<p class="text-xs text-zinc-400 py-6 text-center">No pending approvals.</p>';

    const activeAssets = DB.pattern_assets.filter(p => p.operational_status === 'Active on Line');
    document.getElementById('dh-active-processes').innerHTML = activeAssets.map(a => {
        const worker = DB.employees.find(e => e.employee_id === a.borrowed_by_id);
        return `
            <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center gap-3 text-xs">
                <img src="${getItemImageUrl(a.image_url)}" class="w-11 h-8 rounded-lg object-cover border">
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-zinc-900 truncate">${a.model_name} (${a.asset_id})</p>
                    <p class="text-zinc-500 truncate">${worker ? worker.full_name : (a.borrowed_by_id || 'Assigned')} • ${a.shift_checkout || 'Morning'}</p>
                </div>
            </div>
        `;
    }).join('') || '<p class="text-xs text-zinc-400 py-6 text-center">No active deployments.</p>';

    document.getElementById('dh-qc-oversight').innerHTML = DB.qc_inspection_logs.map(l => {
        const defObj = DB.qc_defect_codes.find(d => d.defect_code === l.defect_code);
        const tier = l.severity_tier || (defObj ? mapDefectToTier(defObj) : 'Medium');
        const risk = `${tier} risk`;
        const riskStyle = tier === 'High'
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : (tier === 'Low' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200');
        return `
            <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs space-y-1.5">
                <div class="flex justify-between items-center font-bold text-zinc-900">
                    <span>${l.qc_log_id} (${l.defect_code})</span>
                    <span class="px-2 py-0.5 rounded border text-[10px] font-bold ${riskStyle}">${risk}</span>
                </div>
                <p class="text-zinc-600">Item: <strong class="font-mono text-zinc-800">${l.asset_id}</strong> • ${l.production_line} • Plies: ${l.ruined_ply_count}</p>
                <span class="inline-block px-2 py-0.5 rounded bg-white border border-zinc-200 text-zinc-700 text-[10px] font-semibold">${l.resolution_status}</span>
            </div>
        `;
    }).join('') || '<p class="text-xs text-zinc-400 py-6 text-center">No QC logs recorded.</p>';

    // Browsable Staff Status & Disciplinary Reports
    const staffReports = DB.department_communications.filter(
        c => c.protocol_category === 'Staff Status Report' || c.protocol_category === 'Admin Staff Report' || c.protocol_category === 'Suspension Directive'
    );
    const repContainer = document.getElementById('dh-disciplinary-reports-list');
    if (repContainer) {
        repContainer.innerHTML = staffReports.map(r => `
            <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs space-y-1">
                <div class="flex justify-between items-center">
                    <span class="font-mono font-bold text-zinc-900">${r.linked_reference_id}</span>
                    <span class="px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-800 text-[9px] font-bold uppercase">${r.comm_status}</span>
                </div>
                <p class="font-bold text-zinc-800">${r.subject_line}</p>
                <p class="text-[11px] text-zinc-500">${r.message_body}</p>
                <p class="text-[10px] text-zinc-400">${new Date(r.logged_timestamp || Date.now()).toLocaleDateString()}</p>
            </div>
        `).join('') || '<p class="text-xs text-zinc-400 py-6 text-center">No staff status reports filed.</p>';
    }
}

function openDhSuspensionRequestModal() {
    const eligibleStaff = DB.employees.filter(e => !['DH-01', 'DT-C-CA-01', 'CDTE-01'].includes(e.employee_id));
    const sel = document.getElementById('dh-susp-emp-select');
    if (sel) {
        sel.innerHTML = eligibleStaff.map(e => `<option value="${e.employee_id}">${e.full_name} (${e.role_designation})</option>`).join('');
    }
    document.getElementById('dh-susp-reason').value = '';
    document.getElementById('dh-susp-confirm-tick').checked = false;
    document.getElementById('dh-suspension-modal').classList.remove('hidden');
    refreshAllCustomSelects();
}

async function submitDhSuspensionDirective() {
    const empId = document.getElementById('dh-susp-emp-select').value;
    const duration = document.getElementById('dh-susp-duration').value;
    const reason = (document.getElementById('dh-susp-reason')?.value || '').trim();
    const confirmed = document.getElementById('dh-susp-confirm-tick')?.checked;

    if (!reason) return showToast('Enter a reason for the suspension directive.', 'error');
    if (!confirmed) return showToast('Tick the confirmation box to send the directive.', 'error');

    const targetEmp = DB.employees.find(e => e.employee_id === empId);
    const adminEmp = DB.employees.find(e => e.employee_id === 'DT-C-CA-01');

    const payload = {
        sender_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'DH-01',
        sender_name: currentLoggedInUser ? currentLoggedInUser.full_name : 'Jackson Emmanuel',
        sender_role: 'Cutting Dpt. Head',
        receiver_id: 'DT-C-CA-01',
        receiver_name: adminEmp ? adminEmp.full_name : 'Ashan Mendis',
        receiver_role: 'CDMS Admins',
        protocol_category: 'Suspension Directive',
        linked_reference_id: empId,
        subject_line: `${duration}: ${targetEmp ? targetEmp.full_name : empId}`,
        message_body: `Action: ${duration} | Reason: ${reason}`,
        comm_status: 'Pending Execution',
        resolution_note: duration
    };

    await supa.from('department_communications').insert([payload]);
    await writeAuditLog('DH_SUSPENSION_DIRECTIVE', 'Employees', empId, payload);
    closeModal('dh-suspension-modal');
    await renderDeptHeadPortal();
    showToast(`Suspension directive for ${empId} sent to Digital Unit.`);
}

function openStaffReportQuickView() {
    switchPortalView('reports');
    const repSel = document.getElementById('rep-type-select');
    if (repSel) {
        repSel.value = '5';
        populateReportGroupFilter();
        renderGroupedReport();
    }
}


// --- Senior Executive & Line Supervisor Portal ---
// Routes incoming sewing cut orders, clears pattern boxes, and manages the 7-day shift roster.

function isCurrentUserSeniorExecutive() {
    return Boolean(currentLoggedInUser && currentLoggedInUser.employee_id.toUpperCase().startsWith('CSE'));
}

function isShiftSlotInPast(dateStr, shiftType) {
    const now = new Date();
    const todayStr = getLocalDateString(now);
    if (dateStr < todayStr) return true;
    if (dateStr > todayStr) return false;

    const currentHour = now.getHours();
    if (shiftType === 'Morning' && currentHour >= 14) return true;
    if (shiftType === 'Afternoon' && currentHour >= 22) return true;
    return false;
}

function filterSupervisorPool(lineFilter) {
    supervisorPoolLineFilter = lineFilter;
    ['ALL', 'Line 1', 'Line 2', 'Line 3'].forEach(lf => {
        const btnId = lf === 'ALL' ? 'pool-filter-ALL' : `pool-filter-L${lf.split(' ')[1]}`;
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.className = lf === lineFilter
                ? 'px-2 py-0.5 rounded bg-zinc-900 text-white'
                : 'px-2 py-0.5 rounded bg-zinc-100 text-zinc-700';
        }
    });
    renderSupervisorPortal();
}

async function renderSupervisorPortal() {
    await syncFromSupabase();
    const isExec = isCurrentUserSeniorExecutive();

    const cseHub = document.getElementById('cse-command-hub');
    const supHub = document.getElementById('sup-order-execution-hub');

    if (isExec) {
        cseHub.classList.remove('hidden');
        supHub.classList.add('hidden');
        renderCseOrderVerificationHub();
    } else {
        cseHub.classList.add('hidden');
        supHub.classList.remove('hidden');
        renderSupervisorOrderExecutionHub();
    }

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
                ${isExec ? `
                    <p class="text-[11px] text-zinc-400">Awaiting Supervisor action</p>
                ` : `
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" onclick="resolveMutexTicket(${r.request_id}, 'Approve')" class="bg-zinc-900 text-white py-1.5 rounded-lg font-semibold">Grant</button>
                        <button type="button" onclick="resolveMutexTicket(${r.request_id}, 'Decline')" class="bg-zinc-200 text-zinc-700 py-1.5 rounded-lg font-semibold">Deny</button>
                    </div>
                `}
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
                    <p class="text-[11px] text-zinc-500">${emp ? emp.full_name : p.borrowed_by_id} • ${p.shift_checkout || 'Morning'}</p>
                </div>
                <span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[10px]">Active</span>
            </div>
        `;
    }).join('') || '<p class="text-xs text-zinc-400 text-center py-8">No active deployments.</p>';

    const allActiveCwOps = DB.employees.filter(e => e.employee_id.startsWith('CW-') && (!e.account_status || e.account_status === 'Active'));
    let floorOps = allActiveCwOps.filter(e => isEmployeeQrAssigned(e.employee_id));
    const unQrOpsCount = allActiveCwOps.length - floorOps.length;

    if (supervisorPoolLineFilter !== 'ALL') {
        floorOps = floorOps.filter(e => e.work_location_zone.includes(supervisorPoolLineFilter));
    }

    const opInd = document.getElementById('selected-op-indicator');
    if (isExec && opInd) {
        opInd.innerText = 'Operator Pool (Read-Only)';
    } else if (opInd && !selectedOperatorForAssign) {
        opInd.innerText = unQrOpsCount > 0
            ? `Tap Worker to Select (${unQrOpsCount} awaiting QR badge in Admin)`
            : 'Tap Worker to Select';
    }

    document.getElementById('operator-pool').innerHTML = floorOps.map(op => {
        const locked = !isExec && selectedOperatorForAssign === op.employee_id;
        return `
            <div onclick="${isExec ? '' : `lockOperatorForCalendar('${op.employee_id}')`}" class="p-2 rounded-xl border ${locked ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-zinc-50 text-zinc-900'} ${isExec ? 'cursor-default' : 'cursor-pointer hover:border-zinc-900'} flex items-center gap-2 text-xs transition-colors">
                <img src="${getAvatarUrl(op.avatar_url, op.employee_id)}" class="w-7 h-7 rounded-full object-cover shrink-0 border border-zinc-300">
                <div class="truncate">
                    <p class="font-bold truncate">${op.full_name}</p>
                    <p class="text-[10px] opacity-75 font-mono">${op.employee_id}</p>
                </div>
            </div>
        `;
    }).join('') || '<p class="col-span-full text-xs text-zinc-400 py-4 text-center">No floor operators have an assigned QR badge yet. Assign QR badges in the Admin Staff Directory first.</p>';

    const grid = document.getElementById('calendar-grid');
    const shifts = ['Morning', 'Afternoon', 'Night'];
    let html = '';

    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const dateStr = getLocalDateString(d);
        const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        html += `
            <div class="bg-zinc-50 p-2.5 rounded-xl border border-zinc-200 flex flex-col gap-2">
                <div class="text-center font-bold text-xs text-zinc-800 border-b border-zinc-200 pb-1.5">${dayLabel}</div>
                ${shifts.map(sh => {
                    const isPast = isShiftSlotInPast(dateStr, sh);
                    const assigned = DB.shift_assignments.filter(a => a.assigned_date === dateStr && a.shift_type === sh);
                    const slotClickAttr = (!isExec && !isPast) ? `onclick="tapDeployShift('${dateStr}', '${sh}')"` : '';

                    return `
                        <div ${slotClickAttr} class="min-h-[82px] p-2 rounded-lg bg-white border ${isPast ? 'shift-slot-past border-zinc-200' : 'border-dashed border-zinc-300 hover:border-zinc-900 cursor-pointer'} flex flex-col gap-1.5 transition-colors">
                            <div class="flex justify-between items-center">
                                <span class="text-[10px] font-bold ${isPast ? 'text-zinc-400' : 'text-zinc-600'} uppercase">${sh}</span>
                                ${isPast ? '<span class="text-[9px] font-mono uppercase text-zinc-400">Locked</span>' : ''}
                            </div>
                            ${assigned.map(a => {
                                const w = DB.employees.find(e => e.employee_id === a.borrower_id);
                                const shortName = w ? w.full_name.split(' ')[0] : a.borrower_id;
                                if (isExec) {
                                    return `
                                        <div onclick="challengeShiftAssignment(${a.assignment_id}, '${a.borrower_id}', '${dateStr}', '${sh}'); event.stopPropagation();" title="Challenge Assignment" class="px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-[11px] font-semibold text-zinc-900 flex justify-between items-center gap-1 cursor-pointer">
                                            <span class="truncate">${shortName}</span>
                                            <span class="px-1 py-0.5 rounded bg-amber-200/80 text-amber-900 text-[9px] font-bold shrink-0">Challenge</span>
                                        </div>
                                    `;
                                }
                                return `
                                    <div class="px-2 py-1 rounded-lg bg-zinc-100 border border-zinc-200 text-[11px] font-semibold text-zinc-800 flex justify-between items-center gap-1">
                                        <span class="truncate">${shortName}</span>
                                        <button type="button" title="Remove" onclick="removeShiftSlot(${a.assignment_id}); event.stopPropagation();" class="shift-remove-btn">&times;</button>
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
    refreshAllCustomSelects();
}

function renderCseOrderVerificationHub() {
    const container = document.getElementById('cse-orders-verification-list');
    if (!container) return;

    container.innerHTML = DB.cutting_orders.map(o => {
        const isQueued = o.order_status === 'Queued' || o.order_status === 'Pending Exec Verification';
        return `
            <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs space-y-2">
                <div class="flex justify-between items-center">
                    <span class="font-mono font-bold text-zinc-900">${o.order_id} • ${o.style_code} (${o.target_size})</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${o.priority_level === 'Urgent' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-zinc-200 text-zinc-800'}">${o.priority_level}</span>
                </div>
                <p class="text-zinc-600">Qty: <strong>${o.target_bundle_qty} pcs</strong> • Status: <strong>${o.order_status}</strong></p>
                ${isQueued ? `
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        <select id="cse-target-line-${o.order_id}" class="p-2 bg-white border border-zinc-300 rounded-lg text-xs">
                            <option value="Line 1">Line 1 Supervisor</option>
                            <option value="Line 2">Line 2 Supervisor</option>
                            <option value="Line 3">Line 3 Supervisor</option>
                        </select>
                        <button type="button" onclick="cseVerifyAndForwardOrder('${o.order_id}')" class="bg-zinc-900 hover:bg-zinc-800 text-white py-2 px-3 rounded-lg font-semibold">
                            Forward to Supervisor
                        </button>
                    </div>
                ` : `
                    <p class="text-[11px] text-emerald-700 font-semibold">${o.assigned_line} ${o.assigned_operator_id ? `• ${o.assigned_operator_id} (${o.scheduled_date})` : ''}</p>
                `}
            </div>
        `;
    }).join('') || '<p class="text-xs text-zinc-400 py-4">No cutting orders queued.</p>';
}

async function cseVerifyAndForwardOrder(orderId) {
    const lineSel = document.getElementById(`cse-target-line-${orderId}`);
    const targetLine = lineSel ? lineSel.value : 'Line 1';

    await supa.from('cutting_orders').update({
        assigned_line: targetLine,
        approved_by_exec_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'CSE-01',
        order_status: 'Forwarded to Supervisor'
    }).eq('order_id', orderId);

    const supEmp = DB.employees.find(e => e.employee_id === 'CS-L1-01');
    await supa.from('department_communications').insert([{
        sender_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'CSE-01',
        sender_name: currentLoggedInUser ? currentLoggedInUser.full_name : 'Aaron Emmanuel',
        sender_role: 'Cutting Senior Executive',
        receiver_id: 'CS-L1-01',
        receiver_name: supEmp ? supEmp.full_name : 'Nathaniel Perera',
        receiver_role: 'Cutting Supervisors',
        protocol_category: 'Line Directive',
        linked_reference_id: orderId,
        subject_line: `Execute Cut Order ${orderId} (${targetLine})`,
        message_body: `Schedule operator and grant Pattern Box permission for Order ${orderId}.`,
        comm_status: 'Pending Approval'
    }]);

    await writeAuditLog('CSE_FORWARD_ORDER', 'Cutting_Orders', orderId, { targetLine });
    await renderSupervisorPortal();
    showToast(`Order ${orderId} forwarded to ${targetLine}.`);
}

function renderSupervisorOrderExecutionHub() {
    const container = document.getElementById('sup-forwarded-orders-list');
    if (!container) return;

    const floorOps = DB.employees.filter(e => e.employee_id.startsWith('CW-') && isEmployeeQrAssigned(e.employee_id));
    const todayStr = getLocalDateString();

    container.innerHTML = DB.cutting_orders.map(o => {
        const isCompleted = o.order_status === 'Bundled for Sewing' || o.order_status === 'Received by Sewing';
        return `
            <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs space-y-2">
                <div class="flex justify-between items-center">
                    <span class="font-mono font-bold text-zinc-900">${o.order_id} • ${o.style_code} (${o.target_size})</span>
                    <span class="px-2 py-0.5 rounded bg-zinc-200 text-zinc-800 font-bold text-[10px]">${o.order_status}</span>
                </div>
                <p class="text-zinc-600">Qty: <strong>${o.target_bundle_qty} pcs</strong> • ${o.assigned_line}</p>
                ${!isCompleted ? `
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input id="sup-ord-date-${o.order_id}" type="date" value="${o.scheduled_date || todayStr}" min="${todayStr}" class="p-2 bg-white border border-zinc-300 rounded-lg text-xs">
                        <select id="sup-ord-shift-${o.order_id}" class="p-2 bg-white border border-zinc-300 rounded-lg text-xs">
                            <option value="Morning" ${o.scheduled_shift === 'Morning' ? 'selected' : ''}>Morning</option>
                            <option value="Afternoon" ${o.scheduled_shift === 'Afternoon' ? 'selected' : ''}>Afternoon</option>
                            <option value="Night" ${o.scheduled_shift === 'Night' ? 'selected' : ''}>Night</option>
                        </select>
                        <select id="sup-ord-op-${o.order_id}" class="p-2 bg-white border border-zinc-300 rounded-lg text-xs">
                            ${floorOps.length > 0
                                ? floorOps.map(op => `<option value="${op.employee_id}" ${o.assigned_operator_id === op.employee_id ? 'selected' : ''}>${op.full_name}</option>`).join('')
                                : '<option value="">No QR-Assigned Operators</option>'}
                        </select>
                    </div>
                    <label class="flex items-center gap-2 cursor-pointer select-none text-xs text-zinc-800 bg-white p-2 rounded-lg border border-zinc-200">
                        <input id="sup-ord-box-${o.order_id}" type="checkbox" ${o.pattern_box_cleared ? 'checked' : ''} class="w-4 h-4 rounded accent-zinc-900">
                        <span><strong>Pattern Box Permission</strong> (${o.style_code})</span>
                    </label>
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" onclick="supervisorExecuteOrderSchedule('${o.order_id}')" class="bg-zinc-900 hover:bg-zinc-800 text-white py-1.5 rounded-lg font-semibold">
                            Assign & Clear Box
                        </button>
                        <button type="button" onclick="supervisorMarkOrderBundled('${o.order_id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded-lg font-semibold">
                            Dispatch Bundles
                        </button>
                    </div>
                ` : `
                    <p class="text-emerald-700 font-semibold text-[11px]">${o.order_status}</p>
                `}
            </div>
        `;
    }).join('') || '<p class="text-xs text-zinc-400 py-4">No cutting orders in queue.</p>';
}

async function supervisorExecuteOrderSchedule(orderId) {
    const ord = DB.cutting_orders.find(o => o.order_id === orderId);
    if (!ord) return;

    const dateVal = document.getElementById(`sup-ord-date-${orderId}`)?.value || getLocalDateString();
    const shiftVal = document.getElementById(`sup-ord-shift-${orderId}`)?.value || 'Morning';
    const opVal = document.getElementById(`sup-ord-op-${orderId}`)?.value || '';
    const boxCleared = Boolean(document.getElementById(`sup-ord-box-${orderId}`)?.checked);

    if (!opVal || !isEmployeeQrAssigned(opVal)) {
        return showToast('Assign a QR badge to a floor operator before scheduling.', 'error');
    }
    if (isShiftSlotInPast(dateVal, shiftVal)) {
        return showToast('Cannot schedule into a past shift.', 'error');
    }

    await supa.from('cutting_orders').update({
        scheduled_date: dateVal,
        scheduled_shift: shiftVal,
        assigned_operator_id: opVal,
        pattern_box_cleared: boxCleared,
        order_status: 'Scheduled on Line'
    }).eq('order_id', orderId);

    const exists = DB.shift_assignments.some(a => a.borrower_id === opVal && a.assigned_date === dateVal && a.shift_type === shiftVal);
    if (!exists) {
        await supa.from('shift_assignments').insert([{
            borrower_id: opVal,
            supervisor_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'CS-L1-01',
            assigned_date: dateVal,
            shift_type: shiftVal,
            production_line: ord.assigned_line || 'Line 1'
        }]);
    }

    await writeAuditLog('SUPERVISOR_SCHEDULE_ORDER', 'Cutting_Orders', orderId, { opVal, dateVal, shiftVal, boxCleared });
    await renderSupervisorPortal();
    showToast(`Scheduled ${orderId} for ${opVal}.`);
}

async function supervisorMarkOrderBundled(orderId) {
    await supa.from('cutting_orders').update({
        order_status: 'Bundled for Sewing'
    }).eq('order_id', orderId);
    await writeAuditLog('BUNDLED_FOR_SEWING', 'Cutting_Orders', orderId, { status: 'Bundled for Sewing' });
    await renderSupervisorPortal();
    showToast(`Order ${orderId} bundled for Sewing.`);
}

async function challengeShiftAssignment(assignmentId, borrowerId, dateStr, shiftType) {
    const worker = DB.employees.find(e => e.employee_id === borrowerId);
    const workerName = worker ? worker.full_name : borrowerId;
    const supEmp = DB.employees.find(e => e.employee_id === 'CS-L1-01');

    const payload = {
        sender_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'CSE-01',
        sender_name: currentLoggedInUser ? currentLoggedInUser.full_name : 'Aaron Emmanuel',
        sender_role: 'Cutting Senior Executive',
        receiver_id: 'CS-L1-01',
        receiver_name: supEmp ? supEmp.full_name : 'Nathaniel Perera',
        receiver_role: 'Cutting Supervisors',
        protocol_category: 'Line Directive',
        linked_reference_id: `${borrowerId}-${dateStr}`,
        subject_line: `Schedule Challenge: ${workerName} (${dateStr} ${shiftType})`,
        message_body: `Senior Executive challenged ${workerName} (${borrowerId}) on ${dateStr} (${shiftType}). Please review and reassign.`,
        comm_status: 'Pending Approval'
    };

    await supa.from('department_communications').insert([payload]);
    await writeAuditLog('CHALLENGE_SHIFT_ASSIGNMENT', 'Shift_Assignments', assignmentId, payload);
    await syncFromSupabase();
    showToast(`Challenge sent to Supervisor for ${workerName}.`);
}

function lockOperatorForCalendar(empId) {
    if (isCurrentUserSeniorExecutive()) return;
    selectedOperatorForAssign = selectedOperatorForAssign === empId ? null : empId;
    const emp = DB.employees.find(e => e.employee_id === selectedOperatorForAssign);
    document.getElementById('selected-op-indicator').innerText = emp
        ? `Selected: ${emp.full_name} (${emp.employee_id})`
        : 'Tap Worker to Select';
    renderSupervisorPortal();
}

async function tapDeployShift(dateStr, shiftType) {
    if (isCurrentUserSeniorExecutive() || isShiftAssignBusy) return;
    if (isShiftSlotInPast(dateStr, shiftType)) {
        return showToast(`Past shift (${dateStr} ${shiftType}) is locked.`, 'error');
    }
    if (!selectedOperatorForAssign) {
        return showToast('Select an Operator from the Pool first.', 'error');
    }

    isShiftAssignBusy = true;
    try {
        const existing = DB.shift_assignments.find(
            a => a.borrower_id === selectedOperatorForAssign && a.assigned_date === dateStr && a.shift_type === shiftType
        );

        if (existing) {
            await supa.from('shift_assignments').delete().eq('assignment_id', existing.assignment_id);
            await writeAuditLog('UNASSIGN_SHIFT_TOGGLE', 'Shift_Assignments', selectedOperatorForAssign, { date: dateStr, shift: shiftType });
            await renderSupervisorPortal();
            showToast(`Removed ${selectedOperatorForAssign} from ${shiftType}.`);
            return;
        }

        const supId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'CS-L1-01';
        const opObj = DB.employees.find(e => e.employee_id === selectedOperatorForAssign);
        const lineMatch = opObj?.work_location_zone.match(/Line\s*\d/i);

        await supa.from('shift_assignments').insert([{
            borrower_id: selectedOperatorForAssign,
            supervisor_id: supId,
            assigned_date: dateStr,
            shift_type: shiftType,
            production_line: lineMatch ? lineMatch[0] : 'Line 1'
        }]);
        await writeAuditLog('ASSIGN_SHIFT', 'Shift_Assignments', selectedOperatorForAssign, { date: dateStr, shift: shiftType });
        await renderSupervisorPortal();
        showToast(`Assigned ${selectedOperatorForAssign} to ${shiftType}.`);
    } finally {
        setTimeout(() => { isShiftAssignBusy = false; }, 280);
    }
}

async function removeShiftSlot(id) {
    if (isCurrentUserSeniorExecutive()) return;
    await supa.from('shift_assignments').delete().eq('assignment_id', id);
    await renderSupervisorPortal();
    showToast('Removed from shift.');
}

async function resolveMutexTicket(reqId, decision) {
    const req = DB.pending_requests.find(r => r.request_id === reqId);
    if (!req) return;
    if (decision === 'Approve') {
        const opObj = DB.employees.find(e => e.employee_id === req.borrower_id);
        const lineMatch = opObj?.work_location_zone.match(/Line\s*\d/i);
        await supa.from('pending_requests').update({ request_status: 'Approved' }).eq('request_id', reqId);
        await supa.from('shift_assignments').insert([{
            borrower_id: req.borrower_id,
            supervisor_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'CS-L1-01',
            assigned_date: req.requested_date,
            shift_type: req.requested_shift,
            production_line: lineMatch ? lineMatch[0] : 'Line 1'
        }]);
        await supa.from('pattern_assets').update({
            operational_status: 'Active on Line',
            borrowed_by_id: req.borrower_id,
            shift_checkout: req.requested_shift,
            checkout_time: new Date().toISOString(),
            last_used_date: getLocalDateString()
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
    await writeAuditLog(`MUTEX_${decision.toUpperCase()}`, 'Pending_Requests', reqId, req);
    await renderSupervisorPortal();
}


// --- Design Studio, CAD Pipeline & Pattern Asset Registration ---
// Moves styles from Design brief to CAD marker approval and Pattern Room QR tagging.

const DEFAULT_SYSTEM_PARAMETERS = {
    Brand: ['Triumph', "Victoria's Secret", 'Lululemon', 'Nike'],
    Size: ['32C', '34B', '34C', '34D', '36B', '36C', '36D', '38D', 'S', 'M', 'L', 'XL'],
    Rack: ['Rack A-01', 'Rack A-02', 'Rack B-01', 'Rack B-02', 'Rack C-01', 'Rack C-02', 'Rack D-01', 'Rack D-02', 'Mold Cabinet 01', 'Mold Cabinet 02', 'Mold Cabinet 03', 'Mold Cabinet 04'],
    Role: [
        'Cutting Dpt. Head',
        'Cutting Senior Executive',
        'Cutting Supervisors',
        'Fabric Spreaders',
        'Cutting Machine Operators',
        'Bundling Unit',
        'Sewing Dpt. Coordinator',
        'Quality Control Executive',
        'Quality Control Inspectors',
        'RMW Coordinators',
        'Design Dpt. Coordinators',
        'CAD Coordinators',
        'Marker Makers',
        'CAD Pattern Handlers',
        'Pattern Coordinators',
        'Pattern Handlers',
        'Digital Team Executive',
        'CDMS Support Team',
        'CDMS Admins'
    ]
};

const DEFAULT_QC_DEFECT_CODES = [
    {
        defect_code: 'DEF-01',
        defect_name_symptom: 'Frayed or Torn Cardboard Pattern Block Edge',
        fault_category: 'Pattern Block Fault',
        severity_level: 'Medium',
        target_asset_status: 'Inspection Flagged',
        reported_by_role_id: 'QCI-C-01',
        assigned_resolver_role_id: 'PR-C-PC-01',
        mandatory_system_action: 'Flag pattern for Pattern Room inspection and replacement'
    },
    {
        defect_code: 'DEF-02',
        defect_name_symptom: 'Warped or Cracked 3D Plastic Pattern Mold',
        fault_category: '3D Mold Fault',
        severity_level: 'High',
        target_asset_status: 'Pending Removal',
        reported_by_role_id: 'QCI-C-01',
        assigned_resolver_role_id: 'DH-01',
        mandatory_system_action: 'Immediate line stop, lock mold QR, and alert Management'
    },
    {
        defect_code: 'DEF-03',
        defect_name_symptom: 'Bundle Ticket Missing Ply Numbering',
        fault_category: 'Bundling Fault',
        severity_level: 'Low',
        target_asset_status: 'Active on Line (No Lock)',
        reported_by_role_id: 'QCI-C-01',
        assigned_resolver_role_id: 'CS-L1-01',
        mandatory_system_action: 'Log minor symptom for shift supervisor review'
    }
];

function getSystemParametersByCategory(category) {
    const custom = DB.system_settings_audit
        .filter(s => s.record_type === 'PARAMETER' && s.category === category)
        .map(s => s.setting_value);
    return custom.length > 0 ? custom : (DEFAULT_SYSTEM_PARAMETERS[category] || []);
}

async function renderDesignCadPortal() {
    await syncFromSupabase();
    const userId = currentLoggedInUser ? currentLoggedInUser.employee_id.toUpperCase() : 'PR-C-PC-01';

    const gridWrap = document.getElementById('design-cad-grid-wrapper');
    const panelDesign = document.getElementById('panel-role-design');
    const panelCad = document.getElementById('panel-role-cad');
    const panelPattern = document.getElementById('panel-role-pattern');
    const panelInv = document.getElementById('panel-pattern-inventory-list');

    [panelDesign, panelCad, panelPattern, panelInv].forEach(p => { if (p) p.classList.remove('hidden'); });

    if (userId.startsWith('DDC')) {
        if (panelPattern) panelPattern.classList.add('hidden');
        if (panelInv) panelInv.classList.add('hidden');
        if (gridWrap) gridWrap.className = 'grid grid-cols-1 lg:grid-cols-2 gap-5';
    } else if (userId.startsWith('CAD')) {
        if (panelDesign) panelDesign.classList.add('hidden');
        if (gridWrap) gridWrap.className = 'grid grid-cols-1 lg:grid-cols-3 gap-5';
    } else {
        if (panelDesign) panelDesign.classList.add('hidden');
        if (panelCad) panelCad.classList.add('hidden');
        if (gridWrap) gridWrap.className = 'grid grid-cols-1 lg:grid-cols-2 gap-5';
    }

    const brands = getSystemParametersByCategory('Brand');
    const sizes = getSystemParametersByCategory('Size');
    const racks = getSystemParametersByCategory('Rack');
    const fabrics = DB.rmw_materials.filter(m => m.material_category === 'Cutting Floor Fabric');

    document.getElementById('cad-brand-select').innerHTML = brands.map(b => `<option value="${b}">${b}</option>`).join('');
    document.getElementById('cad-fabric-select').innerHTML = fabrics.length > 0
        ? fabrics.map(f => `<option value="${f.material_code}">${f.material_code} (${f.target_brand_usage})</option>`).join('')
        : `<option value="FAB-TR-01">FAB-TR-01 (Standard Microfiber)</option><option value="FAB-VS-01">FAB-VS-01 (Soft Nylon)</option>`;

    const approvedMarkers = DB.cad_markers.filter(m => m.marker_status === 'Approved' || m.marker_status === 'Released to Pattern Room');
    const markersForDropdown = approvedMarkers.length > 0 ? approvedMarkers : DB.cad_markers;
    document.getElementById('pat-style-select').innerHTML = markersForDropdown.length > 0
        ? markersForDropdown.map(m => `<option value="${m.style_code}">${m.style_code} (${m.model_name})</option>`).join('')
        : `<option value="TR-TAC-01">TR-TAC-01 (Triaction Control)</option><option value="VS-BBV-10">VS-BBV-10 (Body by Victoria)</option>`;
    document.getElementById('pat-size-select').innerHTML = sizes.map(s => `<option value="${s}">${s}</option>`).join('');
    document.getElementById('pat-rack-loc').innerHTML = racks.map(r => `<option value="${r}">${r}</option>`).join('');

    const nextCadId = getNextSequentialId(DB.cad_markers, 'cad_marker_id', 'CAD-MK-', 2);
    const badgeEl = document.getElementById('next-cad-id-badge');
    if (badgeEl) badgeEl.innerText = nextCadId;

    autoSuggestStyleCode();
    autoGeneratePatternAssetId();

    const cadListEl = document.getElementById('cad-stage-pipeline-list');
    if (cadListEl) {
        cadListEl.innerHTML = DB.cad_markers.map(m => {
            const isPendingCad = m.marker_status === 'Sent to CAD' || m.marker_status === 'Pending CAD Plotting';
            const hasDesignPhoto = hasCustomPhoto(m.sketch_url);
            const isMold = (m.cad_tooling_material_code || '').toUpperCase().includes('PLS');
            const fitClass = isMold ? 'object-fill bg-white' : 'object-contain bg-white';
            return `
                <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs space-y-2">
                    <div class="flex items-center justify-between gap-2.5">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <img src="${getItemImageUrl(m.sketch_url)}" class="w-16 h-11 rounded-lg ${fitClass} border border-zinc-200 shrink-0" alt="${m.model_name}">
                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-1.5">
                                    <span class="font-mono font-bold text-zinc-900">${m.cad_marker_id} • ${m.style_code}</span>
                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isPendingCad ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">${m.marker_status}</span>
                                </div>
                                <p class="font-bold text-zinc-800 truncate">${m.model_name} (${m.brand_buyer})</p>
                                <p class="text-[11px] text-zinc-500 truncate">${m.cad_tooling_material_code} • ${m.cutting_floor_fabric_code}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            <button type="button" onclick="triggerSingleRowPhotoUpload('cad_marker', '${m.cad_marker_id}')" class="px-2 py-1 rounded-lg bg-white hover:bg-zinc-100 border border-zinc-300 text-zinc-800 font-semibold text-[10px]">
                                ${hasDesignPhoto ? 'Change Photo' : '+ Photo'}
                            </button>
                            <button type="button" ${hasDesignPhoto ? '' : 'disabled'} onclick="removeItemOrStaffPhoto('cad_marker', '${m.cad_marker_id}')" class="px-2 py-1 rounded-lg bg-white hover:bg-rose-50 border border-zinc-300 text-rose-600 font-semibold text-[10px] inline-flex items-center gap-1" title="Delete Photo">
                                <i class="ph-bold ph-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                    ${userId.startsWith('CAD') && isPendingCad ? `
                        <button type="button" onclick="cadApproveAndPushToPatternRoom('${m.cad_marker_id}', '${m.style_code}')" class="w-full bg-zinc-900 hover:bg-zinc-800 text-white py-1.5 rounded-lg font-semibold text-[11px] mt-1">
                            Approve & Release to Pattern Room
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('') || '<p class="text-xs text-zinc-400 py-4 text-center">No styles in CAD pipeline.</p>';
    }

    const unassignedPatterns = DB.pattern_assets.filter(p => !isPatternQrAssigned(p.asset_id));
    const batchPatQrBtn = document.getElementById('batch-assign-pattern-qr-btn');
    if (batchPatQrBtn) {
        batchPatQrBtn.classList.toggle('hidden', unassignedPatterns.length === 0);
        batchPatQrBtn.innerText = `Assign All QRs (${unassignedPatterns.length})`;
    }

    document.getElementById('cad-markers-mini-list').innerHTML = DB.pattern_assets.map(p => {
        const hasPhoto = hasCustomPhoto(p.image_url);
        const qrOk = isPatternQrAssigned(p.asset_id);
        const isMold = (p.tooling_type || '').toLowerCase().includes('mold') || (p.asset_id || '').includes('-PM-');
        const fitClass = isMold ? 'object-fill bg-white' : 'object-contain bg-white';
        return `
            <div class="p-3 rounded-xl bg-zinc-50 border border-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <div class="flex items-center gap-2.5 min-w-0">
                    <img src="${getItemImageUrl(p.image_url)}" class="w-16 h-11 rounded-lg ${fitClass} border border-zinc-200 shrink-0" alt="${p.model_name}">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <p class="font-bold text-zinc-900 truncate">${p.asset_id} • ${p.model_name}</p>
                            <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${qrOk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">
                                ${qrOk ? 'QR Active' : 'No QR'}
                            </span>
                        </div>
                        <p class="text-[11px] text-zinc-500 truncate">${p.brand_buyer} (${p.style_code}) • ${p.storage_location}</p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-1.5 sm:shrink-0">
                    <button type="button" onclick="assignPatternQrCode('${p.asset_id}')" class="px-2.5 py-1 rounded-lg ${qrOk ? 'bg-white hover:bg-zinc-100 text-zinc-800 border border-zinc-300' : 'bg-zinc-900 hover:bg-zinc-800 text-white'} font-semibold text-[10px] inline-flex items-center gap-1">
                        <i class="ph-bold ph-qr-code"></i> ${qrOk ? 'QR Tag' : 'Assign QR'}
                    </button>
                    <button type="button" onclick="triggerSingleRowPhotoUpload('pattern', '${p.asset_id}')" class="px-2 py-1 rounded-lg bg-white hover:bg-zinc-100 border border-zinc-300 text-zinc-800 font-semibold text-[10px]">
                        ${hasPhoto ? 'Change Photo' : '+ Photo'}
                    </button>
                    <button type="button" ${hasPhoto ? '' : 'disabled'} onclick="removeItemOrStaffPhoto('pattern', '${p.asset_id}')" class="px-2 py-1 rounded-lg bg-white hover:bg-rose-50 border border-zinc-300 text-rose-600 font-semibold text-[10px] inline-flex items-center gap-1" title="Delete Photo">
                        <i class="ph-bold ph-trash"></i> Delete
                    </button>
                    <button type="button" onclick="softDeleteRecord('pattern_assets', '${p.asset_id}')" class="px-2 py-1 rounded-lg bg-zinc-200/70 hover:bg-rose-600 hover:text-white text-zinc-700 font-semibold text-[10px]" title="Archive Item">
                        Archive
                    </button>
                </div>
            </div>
        `;
    }).join('');

    refreshAllCustomSelects();
}

async function createStyleAndMarker() {
    const style = document.getElementById('cad-style-code').value.trim().toUpperCase();
    const brand = document.getElementById('cad-brand-select').value;
    const model = document.getElementById('cad-model-name').value.trim();
    const toolMat = document.getElementById('cad-tooling-mat').value;
    const fabCode = document.getElementById('cad-fabric-select').value;
    const sketchFile = document.getElementById('cad-sketch-file');

    if (!style || !model) return showToast('Enter Style Code and Model Name.', 'error');

    // Prevent duplicate style codes or duplicate model names under the same brand
    const duplicateStyle = DB.cad_markers.find(
        m => m.style_code.toUpperCase() === style ||
             (m.brand_buyer.toLowerCase() === brand.toLowerCase() && m.model_name.trim().toLowerCase() === model.toLowerCase())
    );
    if (duplicateStyle) {
        return showToast(`Duplicate style blocked: ${duplicateStyle.style_code} (${duplicateStyle.model_name}) already exists in database.`, 'error');
    }

    const uploadedImg = await readAndCompressImage(sketchFile);
    const mkId = getNextSequentialId(DB.cad_markers, 'cad_marker_id', 'CAD-MK-', 2);

    const isDesignUser = currentLoggedInUser && currentLoggedInUser.employee_id.startsWith('DDC');
    const initialStatus = isDesignUser ? 'Sent to CAD' : 'Approved';

    const newRow = {
        cad_marker_id: mkId,
        style_code: style,
        brand_buyer: brand,
        model_name: model,
        design_coordinator_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'DDC-C-01',
        cad_handler_id: 'CAD-C-CPH-01',
        cad_tooling_material_code: toolMat,
        cutting_floor_fabric_code: fabCode,
        marker_status: initialStatus,
        sketch_url: uploadedImg || ''
    };

    const { error } = await supa.from('cad_markers').insert([newRow]);
    if (error) return showToast(error.message, 'error');
    await writeAuditLog('CREATE_STYLE_MARKER', 'CAD_Markers', mkId, newRow);
    await renderDesignCadPortal();
    showToast(`Style ${style} (${mkId}) sent to CAD.`);
}

async function cadApproveAndPushToPatternRoom(markerId, styleCode) {
    await supa.from('cad_markers').update({
        marker_status: 'Approved',
        cad_handler_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'CADC-C-01'
    }).eq('cad_marker_id', markerId);

    await writeAuditLog('CAD_MARKER_APPROVED', 'CAD_Markers', markerId, { style_code: styleCode });
    await renderDesignCadPortal();
    showToast(`CAD Marker ${markerId} released to Pattern Room.`);
}

async function designAddFabricDirect() {
    const code = document.getElementById('new-fabric-code').value.trim().toUpperCase();
    const specs = document.getElementById('new-fabric-specs').value.trim();
    const brand = document.getElementById('cad-brand-select').value;
    if (!code || !specs) return showToast('Enter Fabric ID and Composition.', 'error');

    const duplicateFab = DB.rmw_materials.find(
        m => m.material_code.toUpperCase() === code ||
             (m.target_brand_usage.toLowerCase() === brand.toLowerCase() && m.material_name_specs.trim().toLowerCase() === specs.toLowerCase())
    );
    if (duplicateFab) {
        return showToast(`Duplicate fabric blocked: ${duplicateFab.material_code} is already registered.`, 'error');
    }

    const newFab = {
        material_code: code,
        material_category: 'Cutting Floor Fabric',
        material_name_specs: specs,
        target_brand_usage: brand,
        rmw_storage_bay: getNextSequentialId(DB.rmw_materials, 'rmw_storage_bay', 'RMW-Bay-F', 1),
        managed_by_rmw_id: 'RMWC-C-01',
        lot_status: 'In Warehouse'
    };
    const { error } = await supa.from('rmw_materials').insert([newFab]);
    if (error) return showToast(error.message, 'error');
    await writeAuditLog('ADD_FABRIC_DIRECT', 'RMW_Materials', code, newFab);
    document.getElementById('new-fabric-code').value = '';
    document.getElementById('new-fabric-specs').value = '';
    await renderDesignCadPortal();
    showToast(`Added ${code} to catalog.`);
}

function openParameterRequestHelper() {
    openCommDrawer('compose', 'DT-C-CA-01', 'Parameter Request');
    setTimeout(() => {
        const subj = document.getElementById('comm-subject');
        const msg = document.getElementById('comm-message');
        if (subj && !subj.value) subj.value = 'New Parameter Request (Brand / Size / Rack)';
        if (msg && !msg.value) msg.value = 'Category: [Brand/Size/Rack], Value: [Name], Prefix: [Code]';
    }, 80);
}

async function registerNewPatternAsset() {
    const id = document.getElementById('pat-asset-id').value.trim().toUpperCase();
    const type = document.getElementById('pat-tooling-type').value;
    const styleCode = document.getElementById('pat-style-select').value;
    const size = document.getElementById('pat-size-select').value;
    const loc = document.getElementById('pat-rack-loc').value;
    const photoInput = document.getElementById('pat-photo-file');

    if (!id) return showToast('Asset ID is required.', 'error');

    // Prevent duplicate Asset ID or identical Style + Tooling Type + Size combination
    const dupById = DB.pattern_assets.find(p => p.asset_id.toUpperCase() === id) ||
                    (DB.discarded_trash_vault || []).find(t => t.original_table === 'pattern_assets' && t.record_id.toUpperCase() === id);
    if (dupById) {
        return showToast(`Asset ID ${id} already exists in the database.`, 'error');
    }
    const dupBySpec = DB.pattern_assets.find(
        p => p.style_code === styleCode && p.tooling_type === type && p.size_category === size
    );
    if (dupBySpec) {
        return showToast(`Duplicate ${type} blocked: ${dupBySpec.asset_id} already exists for Style ${styleCode} (Size ${size}).`, 'error');
    }

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

    // Automatically assign and activate the QR code in the database upon registration
    await supa.from('system_settings_audit').insert([{
        record_type: 'QR_ASSIGNED',
        category: 'PATTERN_QR',
        setting_value: id,
        prefix_data: styleCode || 'QR',
        requested_by_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'PR-C-PC-01',
        request_status: 'Active'
    }]);

    await writeAuditLog('REGISTER_PATTERN_ASSET', 'Pattern_Assets', id, newAsset);

    const box = document.getElementById('pattern-qr-preview-box');
    const canvas = document.getElementById('pattern-qr-canvas');
    const printBtn = document.getElementById('pattern-qr-print-btn');
    box.classList.remove('hidden');
    canvas.innerHTML = '';
    document.getElementById('pattern-qr-label-text').innerText = id;
    if (printBtn) printBtn.onclick = () => printQrTagOrBadge('PATTERN', id);
    new QRCode(canvas, { text: id, width: 76, height: 76 });
    await renderDesignCadPortal();
    showToast(`Registered ${id} & assigned QR code.`);
}


// --- Sewing Cut Orders & Raw Material Warehouse (RMW) Dispatch ---
// Allows Sewing to request cut bundles and RMW coordinators to dispatch fabric/tooling lots.

async function renderSupplyPortal() {
    await syncFromSupabase();
    const userId = currentLoggedInUser ? currentLoggedInUser.employee_id.toUpperCase() : 'SDC-C-01';
    const gridWrap = document.getElementById('supply-grid-wrapper');
    const sewPanel = document.getElementById('panel-sewing-workspace');
    const rmwPanel = document.getElementById('panel-rmw-workspace');

    if (userId.startsWith('SDC')) {
        sewPanel.classList.remove('hidden');
        rmwPanel.classList.add('hidden');
        gridWrap.className = 'grid grid-cols-1 gap-5 max-w-3xl mx-auto w-full';
    } else if (userId.startsWith('RMW')) {
        sewPanel.classList.add('hidden');
        rmwPanel.classList.remove('hidden');
        gridWrap.className = 'grid grid-cols-1 gap-5 max-w-3xl mx-auto w-full';
    } else {
        sewPanel.classList.remove('hidden');
        rmwPanel.classList.remove('hidden');
        gridWrap.className = 'grid grid-cols-1 lg:grid-cols-2 gap-5';
    }

    const sizes = getSystemParametersByCategory('Size');
    document.getElementById('sew-style-select').innerHTML = DB.cad_markers.length > 0
        ? DB.cad_markers.map(m => `<option value="${m.style_code}">${m.style_code} (${m.model_name})</option>`).join('')
        : (DB.pattern_assets.length > 0
            ? [...new Set(DB.pattern_assets.map(p => p.style_code))].map(sc => `<option value="${sc}">${sc}</option>`).join('')
            : `<option value="TR-TAC-01">TR-TAC-01 (Triaction Control)</option>`);
    document.getElementById('sew-size').innerHTML = sizes.map(s => `<option value="${s}">${s}</option>`).join('');

    const nextOrdId = getNextSequentialId(DB.cutting_orders, 'order_id', 'ORD-');
    const ordBadge = document.getElementById('next-order-id-badge');
    if (ordBadge) ordBadge.innerText = `Next: ${nextOrdId}`;
    refreshAllCustomSelects();

    document.getElementById('sewing-orders-list').innerHTML = DB.cutting_orders.map(o => {
        const canReceiveBundles = userId.startsWith('SDC') && o.order_status === 'Bundled for Sewing';
        return `
            <div class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 flex flex-wrap justify-between items-center gap-3 text-xs">
                <div>
                    <p class="font-bold text-zinc-900">${o.order_id} • ${o.style_code} (Size ${o.target_size})</p>
                    <p class="text-zinc-500 mt-0.5">Qty: <strong>${o.target_bundle_qty} pcs</strong> • ${o.assigned_line}</p>
                    ${o.order_notes ? `<p class="text-[11px] text-zinc-500 italic mt-0.5">"${o.order_notes}"</p>` : ''}
                </div>
                <div class="flex items-center gap-2">
                    <span class="px-2.5 py-1 rounded font-bold text-[10px] ${o.priority_level === 'Urgent' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-zinc-200 text-zinc-800'}">${o.priority_level} • ${o.order_status}</span>
                    ${canReceiveBundles ? `
                        <button type="button" onclick="sewingConfirmBundleReceipt('${o.order_id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-bold text-[11px]">
                            Receive Bundles
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('') || '<p class="text-xs text-zinc-400 py-6 text-center">No cutting orders submitted yet.</p>';

    document.getElementById('rmw-materials-list').innerHTML = DB.rmw_materials.map(m => `
        <div class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 flex justify-between items-center gap-3 text-xs">
            <div>
                <p class="font-bold text-zinc-900">${m.material_code} (${m.material_category})</p>
                <p class="text-zinc-600">${m.material_name_specs} • ${m.target_brand_usage}</p>
                <p class="text-[11px] text-zinc-400">${m.rmw_storage_bay} • <strong class="text-zinc-800">${m.lot_status}</strong></p>
            </div>
            ${userId.startsWith('RMW') ? `
                <button type="button" onclick="dispatchRmwMaterial('${m.material_code}')" class="bg-zinc-900 hover:bg-zinc-800 text-white px-3 py-1.5 rounded-lg font-semibold text-[11px] shrink-0">
                    Dispatch
                </button>
            ` : `<span class="text-[10px] font-mono text-zinc-400">RMW</span>`}
        </div>
    `).join('');
}

async function submitSewingOrder() {
    const style = document.getElementById('sew-style-select').value;
    const size = document.getElementById('sew-size').value || '34B';
    const qty = parseInt(document.getElementById('sew-qty').value) || 1200;
    const prio = document.getElementById('sew-priority').value;
    const notes = (document.getElementById('sew-order-notes')?.value || '').trim();
    const ordId = getNextSequentialId(DB.cutting_orders, 'order_id', 'ORD-');

    const newOrd = {
        order_id: ordId,
        style_code: style,
        sewing_coordinator_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'SDC-C-01',
        approved_by_exec_id: 'CSE-01',
        target_size: size,
        target_bundle_qty: qty,
        priority_level: prio,
        assigned_line: 'Line 1',
        order_status: 'Queued',
        order_notes: notes
    };
    await supa.from('cutting_orders').insert([newOrd]);
    await writeAuditLog('CREATE_SEWING_ORDER', 'Cutting_Orders', ordId, newOrd);
    if (document.getElementById('sew-order-notes')) document.getElementById('sew-order-notes').value = '';
    await renderSupplyPortal();
    showToast(`Cut Order ${ordId} submitted.`);
}

async function sewingConfirmBundleReceipt(orderId) {
    await supa.from('cutting_orders').update({
        order_status: 'Received by Sewing'
    }).eq('order_id', orderId);
    await writeAuditLog('SEWING_RECEIVED_BUNDLES', 'Cutting_Orders', orderId, { received_by: currentLoggedInUser?.employee_id || 'SDC-C-01' });
    await renderSupplyPortal();
    showToast(`Confirmed bundle receipt for ${orderId}.`);
}

async function dispatchRmwMaterial(matCode) {
    const userId = currentLoggedInUser ? currentLoggedInUser.employee_id.toUpperCase() : '';
    if (!userId.startsWith('RMW')) {
        return showToast('Only RMW Coordinator can dispatch warehouse lots.', 'error');
    }
    const mat = DB.rmw_materials.find(m => m.material_code === matCode);
    if (!mat) return;
    const newStatus = mat.material_category.includes('CAD') ? 'Dispatched to CAD Room' : 'Dispatched to Cutting Floor';
    await supa.from('rmw_materials').update({ lot_status: newStatus }).eq('material_code', matCode);
    await writeAuditLog('DISPATCH_MATERIAL', 'RMW_Materials', matCode, { status: newStatus });
    await renderSupplyPortal();
    showToast(`Dispatched ${matCode}.`);
}


// --- Quality Control Portal & Floor Defect Logging ---
// Logs ply defects, triggers automatic asset locks on high-severity faults, and tracks resolution.

function mapDefectToTier(def) {
    const sev = (def.severity_level || '').toLowerCase();
    const stat = (def.target_asset_status || '').toLowerCase();
    if (sev.includes('critical') || sev.includes('high') || stat.includes('decommission') || stat.includes('removal')) {
        return 'High';
    }
    if (sev.includes('low') || sev.includes('min') || stat.includes('no lock')) {
        return 'Low';
    }
    return 'Medium';
}

function selectQcSeverityTier(tier) {
    selectedQcSeverityTier = tier;
    ['ALL', 'Low', 'Medium', 'High'].forEach(t => {
        const btn = document.getElementById(`qc-tier-${t}`);
        if (!btn) return;
        btn.className = t === tier
            ? 'py-1.5 px-1 rounded-lg bg-zinc-900 text-white transition-colors'
            : 'py-1.5 px-1 rounded-lg text-zinc-600 hover:text-zinc-900 transition-colors';
    });

    populateQcDefectCodesByTier();
}

function populateQcDefectCodesByTier() {
    const sel = document.getElementById('qc-defect-select');
    if (!sel) return;

    const sourceList = DB.qc_defect_codes.length > 0 ? DB.qc_defect_codes : DEFAULT_QC_DEFECT_CODES;
    let matching = selectedQcSeverityTier === 'ALL'
        ? sourceList
        : sourceList.filter(d => mapDefectToTier(d) === selectedQcSeverityTier);
    if (matching.length === 0) matching = sourceList;

    sel.innerHTML = matching.map(d => `<option value="${d.defect_code}">${d.defect_code} (${d.defect_name_symptom})</option>`).join('');

    const nextDefCode = getNextSequentialId(sourceList, 'defect_code', 'DEF-', 2);
    const lbl = document.getElementById('next-def-code-label');
    if (lbl) lbl.innerText = nextDefCode;

    previewDefectAction();
    refreshAllCustomSelects();
}

async function registerNewCustomDefectCode() {
    const symptom = (document.getElementById('new-def-symptom')?.value || '').trim();
    const sev = document.getElementById('new-def-severity')?.value || 'Medium';
    if (!symptom) return showToast('Enter a defect reason/symptom.', 'error');

    const dupDefect = DB.qc_defect_codes.find(d => d.defect_name_symptom.trim().toLowerCase() === symptom.toLowerCase());
    if (dupDefect) {
        return showToast(`Duplicate defect blocked: ${dupDefect.defect_code} (${dupDefect.defect_name_symptom}) already exists.`, 'error');
    }

    const newCode = getNextSequentialId(DB.qc_defect_codes, 'defect_code', 'DEF-', 2);
    const targetStatus = sev === 'High'
        ? 'Decommissioned'
        : (sev === 'Low' ? 'Active on Line (No Lock)' : 'Inspection Flagged');
    const resolverId = sev === 'High' ? 'DH-01' : (sev === 'Low' ? 'CS-L1-01' : 'PR-C-PC-01');
    const sysAction = sev === 'High'
        ? 'Immediate line cut-off and pattern replacement'
        : (sev === 'Low' ? 'Log minor symptom for shift monitoring' : 'Flag pattern for Pattern Room inspection');

    const newDefObj = {
        defect_code: newCode,
        fault_category: 'Floor Inspection',
        defect_name_symptom: symptom,
        severity_level: sev,
        target_asset_status: targetStatus,
        reported_by_role_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'QCI-C-01',
        assigned_resolver_role_id: resolverId,
        mandatory_system_action: sysAction
    };

    const { error } = await supa.from('qc_defect_codes').insert([newDefObj]);
    if (error) return showToast(error.message, 'error');

    await writeAuditLog('REGISTER_DEFECT_CODE', 'QC_Defect_Codes', newCode, newDefObj);
    document.getElementById('new-def-symptom').value = '';
    document.getElementById('new-defect-creator-box').classList.add('hidden');
    await syncFromSupabase();
    selectQcSeverityTier('ALL');
    const sel = document.getElementById('qc-defect-select');
    if (sel) {
        sel.value = newCode;
        previewDefectAction();
        refreshAllCustomSelects();
    }
    showToast(`Registered ${newCode} (${symptom}).`);
}

async function toggleQcQrScanner() {
    const box = document.getElementById('qc-qr-scanner-box');
    if (!box) return;
    if (!box.classList.contains('hidden')) {
        await stopQcQrScanner();
        return;
    }

    box.classList.remove('hidden');
    if (typeof Html5Qrcode === 'undefined') return;

    try {
        qcQrScanner = new Html5Qrcode('qc-qr-camera-reader');
        await qcQrScanner.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 170, height: 170 } },
            async (decodedText) => {
                const code = decodedText.trim().toUpperCase();
                await stopQcQrScanner();
                const found = DB.pattern_assets.find(p => p.asset_id.toUpperCase() === code);
                if (!found) return showToast(`Scanned QR (${code}) not found.`, 'error');
                if (!isPatternQrAssigned(found.asset_id)) {
                    return showToast(`Pattern ${found.asset_id} does not have an assigned QR code yet.`, 'error');
                }
                const sel = document.getElementById('qc-asset-select');
                if (sel) {
                    sel.value = found.asset_id;
                    refreshAllCustomSelects();
                }
                showToast(`Scanned ${found.asset_id}.`);
            },
            () => {}
        );
    } catch (err) {
        const reader = document.getElementById('qc-qr-camera-reader');
        if (reader) reader.innerHTML = '<p class="p-3 text-center text-xs text-zinc-400">Camera unavailable. Select item from dropdown below.</p>';
    }
}

async function renderQcPortal() {
    await syncFromSupabase();
    const userId = currentLoggedInUser ? currentLoggedInUser.employee_id.toUpperCase() : 'QCI-C-01';
    const isQcExec = userId.startsWith('CQCE');
    const topBar = document.getElementById('qc-role-top-bar');

    const inspectorDirectives = DB.department_communications.filter(
        c => c.receiver_id === 'QCI-C-01' && c.protocol_category === 'QC Escalation' && c.comm_status === 'Pending Approval'
    );

    if (isQcExec) {
        topBar.classList.remove('hidden');
        topBar.innerHTML = `
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <select id="qce-cmd-line" class="p-2.5 bg-zinc-50 border border-zinc-300 rounded-xl">
                    <option value="Line 1">Inspect Cutting Line 1</option>
                    <option value="Line 2">Inspect Cutting Line 2</option>
                    <option value="Line 3">Inspect Cutting Line 3</option>
                </select>
                <input id="qce-cmd-note" type="text" placeholder="Inspection directive for QC Inspector..." class="p-2.5 bg-zinc-50 border border-zinc-300 rounded-xl">
                <button type="button" onclick="dispatchQcInspectionCommand()" class="bg-zinc-900 hover:bg-zinc-800 text-white font-semibold py-2.5 px-4 rounded-xl">
                    Dispatch to QC Inspector
                </button>
            </div>
        `;
    } else if (inspectorDirectives.length > 0) {
        topBar.classList.remove('hidden');
        topBar.innerHTML = `
            <div class="space-y-1.5">
                ${inspectorDirectives.map(d => `
                    <div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex justify-between items-center text-xs">
                        <div><strong class="text-zinc-900">${d.subject_line}:</strong> <span class="text-zinc-700">${d.message_body}</span></div>
                        <button type="button" onclick="resolveCommItem(${d.comm_id}, 'Completed')" class="bg-zinc-900 text-white px-2.5 py-1 rounded-lg text-[10px] font-bold shrink-0">Done</button>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        topBar.classList.add('hidden');
    }

    const qrPatterns = DB.pattern_assets.filter(p => isPatternQrAssigned(p.asset_id));
    document.getElementById('qc-asset-select').innerHTML = qrPatterns.length > 0
        ? qrPatterns.map(p => `<option value="${p.asset_id}">${p.asset_id} (${p.model_name})</option>`).join('')
        : '<option value="">No QR-Assigned Patterns Available</option>';

    const floorWorkers = DB.employees.filter(
        e => (e.employee_id.startsWith('CW-') || e.employee_id.startsWith('CS-')) && isEmployeeQrAssigned(e.employee_id)
    );
    const empSel = document.getElementById('qc-employee-select');
    if (empSel) {
        empSel.innerHTML = `<option value="">Operator (Optional)</option>` +
            floorWorkers.map(w => `<option value="${w.employee_id}">${w.full_name} (${w.employee_id})</option>`).join('');
    }

    const nextQcId = getNextSequentialId(DB.qc_inspection_logs, 'qc_log_id', 'QCL-');
    const qcBadge = document.getElementById('next-qc-id-badge');
    if (qcBadge) qcBadge.innerText = `Next: ${nextQcId}`;

    selectQcSeverityTier(selectedQcSeverityTier);

    document.getElementById('qc-logs-list').innerHTML = DB.qc_inspection_logs.map(l => {
        const acked = Boolean(l.exec_acknowledged);
        const riskTier = l.severity_tier || 'Medium';
        const riskBadgeStyle = riskTier === 'High'
            ? 'bg-rose-600 text-white'
            : (riskTier === 'Low' ? 'bg-zinc-200 text-zinc-800' : 'bg-amber-100 text-amber-900');
        return `
            <div class="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 flex flex-wrap justify-between items-center gap-3 text-xs">
                <div class="space-y-0.5">
                    <div class="flex items-center gap-2">
                        <span class="px-2 py-0.5 rounded ${riskBadgeStyle} text-[10px] font-bold">${riskTier} risk</span>
                        <p class="font-bold text-zinc-900">${l.qc_log_id} • ${l.defect_code} on ${l.asset_id} (${l.production_line})</p>
                    </div>
                    <p class="text-zinc-500">Inspector: ${l.inspector_id} • Plies: ${l.ruined_ply_count} ${l.involved_employee_id ? `• Op: ${l.involved_employee_id}` : ''}</p>
                    ${l.inspector_notes ? `<p class="text-[11px] text-zinc-600 italic">"${l.inspector_notes}"</p>` : ''}
                </div>
                <div class="flex flex-wrap items-center gap-1.5 ml-auto">
                    <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${acked ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">
                        ${acked ? 'Exec Received' : 'Sent to Exec'}
                    </span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${l.resolution_status === 'Resolved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">${l.resolution_status}</span>
                    ${isQcExec && !acked ? `
                        <button type="button" onclick="acknowledgeQcReportReceipt('${l.qc_log_id}')" class="bg-zinc-800 hover:bg-zinc-900 text-white px-2.5 py-1 rounded-lg font-semibold text-[11px]">
                            Accept
                        </button>
                    ` : ''}
                    ${l.resolution_status !== 'Resolved' && isQcExec ? `
                        <button type="button" onclick="resolveQcLog('${l.qc_log_id}', '${l.asset_id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg font-semibold text-[11px]">
                            Mark Fixed
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('') || '<p class="text-xs text-zinc-400 py-8 text-center">No floor defects logged yet.</p>';

    refreshAllCustomSelects();
}

async function dispatchQcInspectionCommand() {
    const line = document.getElementById('qce-cmd-line')?.value || 'Line 1';
    const note = (document.getElementById('qce-cmd-note')?.value || '').trim();
    if (!note) return showToast('Enter an inspection instruction.', 'error');

    const inspEmp = DB.employees.find(e => e.employee_id === 'QCI-C-01');
    const payload = {
        sender_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'CQCE-01',
        sender_name: currentLoggedInUser ? currentLoggedInUser.full_name : 'Imesha Fernando',
        sender_role: 'Quality Control Executive',
        receiver_id: 'QCI-C-01',
        receiver_name: inspEmp ? inspEmp.full_name : 'Mohamed Faiz',
        receiver_role: 'Quality Control Inspectors',
        protocol_category: 'QC Escalation',
        linked_reference_id: line,
        subject_line: `Inspect ${line}`,
        message_body: note,
        comm_status: 'Pending Approval'
    };

    await supa.from('department_communications').insert([payload]);
    await writeAuditLog('DISPATCH_QC_COMMAND', 'Department_Communications', line, payload);
    document.getElementById('qce-cmd-note').value = '';
    await renderQcPortal();
    showToast(`Sent command to QC Inspector for ${line}.`);
}

function previewDefectAction() {
    const code = document.getElementById('qc-defect-select')?.value;
    const sourceList = DB.qc_defect_codes.length > 0 ? DB.qc_defect_codes : DEFAULT_QC_DEFECT_CODES;
    const def = sourceList.find(d => d.defect_code === code);
    if (!def) return;
    document.getElementById('qc-action-preview').innerHTML = `
        <span><strong>Status:</strong> ${def.target_asset_status} • <strong>Resolver:</strong> ${def.assigned_resolver_role_id}</span>
    `;
}

async function submitQcDefectFlag() {
    const assetId = document.getElementById('qc-asset-select').value;
    if (!assetId || !isPatternQrAssigned(assetId)) {
        return showToast('Select a QR-assigned pattern or mold to log a defect.', 'error');
    }
    const defCode = document.getElementById('qc-defect-select').value;
    const line = document.getElementById('qc-line-select').value;
    const plies = parseInt(document.getElementById('qc-ruined-plies').value) || 10;
    const involvedEmp = document.getElementById('qc-employee-select')?.value || null;
    const notes = (document.getElementById('qc-inspector-notes')?.value || '').trim();
    const sourceList = DB.qc_defect_codes.length > 0 ? DB.qc_defect_codes : DEFAULT_QC_DEFECT_CODES;
    const def = sourceList.find(d => d.defect_code === defCode) || sourceList[0];

    const tier = mapDefectToTier(def);
    let targetStatus = def.target_asset_status;

    if (targetStatus !== 'Active on Line (No Lock)') {
        await supa.from('pattern_assets').update({ operational_status: targetStatus }).eq('asset_id', assetId);
    }

    const logId = getNextSequentialId(DB.qc_inspection_logs, 'qc_log_id', 'QCL-');
    const newLog = {
        qc_log_id: logId,
        asset_id: assetId,
        defect_code: defCode,
        inspector_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'QCI-C-01',
        resolver_id: def.assigned_resolver_role_id,
        production_line: line,
        ruined_ply_count: plies,
        resolution_status: `Open (${targetStatus})`,
        severity_tier: tier,
        involved_employee_id: involvedEmp,
        inspector_notes: notes,
        exec_acknowledged: false,
        acknowledged_by_id: null
    };

    await supa.from('qc_inspection_logs').insert([newLog]);

    // When a High risk defect is recorded, generate an urgent alert to Management (DH-01 and CQCE-01)
    if (tier === 'High') {
        const senderId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'QCI-C-01';
        const senderName = currentLoggedInUser ? currentLoggedInUser.full_name : 'QC Inspector';
        const senderRole = currentLoggedInUser ? currentLoggedInUser.role_designation : 'Quality Control Inspectors';
        const dhEmp = DB.employees.find(e => e.employee_id === 'DH-01');
        const qceEmp = DB.employees.find(e => e.employee_id === 'CQCE-01');
        const alertMsg = `URGENT HIGH RISK DEFECT: ${defCode} (${def ? def.defect_name_symptom : 'Critical Fault'}) on Asset ${assetId} at ${line}. Ruined plies: ${plies}.${notes ? ` Note: ${notes}` : ''}`;

        await supa.from('department_communications').insert([
            {
                sender_id: senderId,
                sender_name: senderName,
                sender_role: senderRole,
                receiver_id: 'DH-01',
                receiver_name: dhEmp ? dhEmp.full_name : 'Cutting Department Head',
                receiver_role: 'Cutting Dpt. Head',
                protocol_category: 'High Risk QC Alert',
                linked_reference_id: logId,
                subject_line: `URGENT: High Risk Defect on ${assetId} (${line})`,
                message_body: alertMsg,
                comm_status: 'Pending Approval'
            },
            {
                sender_id: senderId,
                sender_name: senderName,
                sender_role: senderRole,
                receiver_id: 'CQCE-01',
                receiver_name: qceEmp ? qceEmp.full_name : 'Quality Control Executive',
                receiver_role: 'Quality Control Executive',
                protocol_category: 'High Risk QC Alert',
                linked_reference_id: logId,
                subject_line: `URGENT: High Risk Defect on ${assetId} (${line})`,
                message_body: alertMsg,
                comm_status: 'Pending Approval'
            }
        ]);
    }

    await writeAuditLog('QC_DEFECT_FLAG', 'QC_Inspection_Logs', logId, newLog);
    if (document.getElementById('qc-inspector-notes')) document.getElementById('qc-inspector-notes').value = '';
    await renderQcPortal();
    if (tier === 'High') {
        showToast(`Logged High risk defect ${logId} on ${assetId} & sent urgent alert to Management.`, 'error');
    } else {
        showToast(`Logged ${tier} risk defect ${logId} (${defCode}) on ${assetId}.`, 'error');
    }
}

async function acknowledgeQcReportReceipt(logId) {
    const execId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'CQCE-01';
    await supa.from('qc_inspection_logs').update({
        exec_acknowledged: true,
        acknowledged_by_id: execId
    }).eq('qc_log_id', logId);

    await writeAuditLog('QC_EXEC_ACK_RECEIPT', 'QC_Inspection_Logs', logId, { acknowledged_by: execId });
    await renderQcPortal();
    showToast(`Accepted receipt of ${logId}.`);
}

async function resolveQcLog(logId, assetId) {
    const execId = currentLoggedInUser ? currentLoggedInUser.employee_id : 'CQCE-01';
    await supa.from('qc_inspection_logs').update({
        resolution_status: 'Resolved',
        exec_acknowledged: true,
        acknowledged_by_id: execId
    }).eq('qc_log_id', logId);
    await supa.from('pattern_assets').update({ operational_status: 'Available in Room' }).eq('asset_id', assetId);
    await writeAuditLog('QC_RESOLVED', 'QC_Inspection_Logs', logId, { asset_id: assetId, status: 'Resolved' });
    await renderQcPortal();
    showToast(`Resolved ${logId}.`);
}


// --- Digital Team Admin & Support Console ---
// Manages staff directory, password reset escalations, leadership handovers, and system parameters.

function isCurrentUserPrivilegedAdmin() {
    if (!currentLoggedInUser) return false;
    const id = currentLoggedInUser.employee_id.toUpperCase();
    return id.startsWith('DT-C-CA') || id.startsWith('CDTE');
}

async function renderAdminPortal() {
    await syncFromSupabase();

    const uniqueRoles = DB.employees.length > 0
        ? [...new Set([...DEFAULT_SYSTEM_PARAMETERS.Role, ...DB.employees.map(e => e.role_designation)])]
        : DEFAULT_SYSTEM_PARAMETERS.Role;
    document.getElementById('reg-emp-role').innerHTML = uniqueRoles.map(r => `<option value="${r}">${r}</option>`).join('');
    autoGenerateEmployeeId();

    const avatarReqs = DB.department_communications.filter(
        c => c.protocol_category === 'Avatar Request' && c.comm_status === 'Pending Approval'
    );
    const photoReqBadge = document.getElementById('pending-photo-req-badge');
    if (photoReqBadge) {
        photoReqBadge.innerText = avatarReqs.length;
        photoReqBadge.classList.toggle('hidden', avatarReqs.length === 0);
    }
    document.getElementById('support-avatar-requests-list').innerHTML = avatarReqs.map(r => `
        <div class="p-3 rounded-xl bg-white border border-zinc-200 flex items-center justify-between gap-3 text-xs">
            <div class="flex items-center gap-2.5">
                <img src="${getAvatarUrl(r.resolution_note, r.sender_id)}" class="w-9 h-9 rounded-full object-cover border border-zinc-300">
                <div>
                    <p class="font-bold text-zinc-900">${r.sender_name}</p>
                    <p class="text-[10px] text-zinc-500">${r.sender_id}</p>
                </div>
            </div>
            <div class="flex gap-1.5">
                <button type="button" onclick="resolveAvatarRequest(${r.comm_id}, '${r.sender_id}', 'Approved')" class="bg-zinc-900 text-white px-2.5 py-1 rounded-lg font-semibold text-[11px]">Accept</button>
                <button type="button" onclick="resolveAvatarRequest(${r.comm_id}, '${r.sender_id}', 'Rejected')" class="bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-lg font-semibold text-[11px]">Reject</button>
            </div>
        </div>
    `).join('') || '<p class="text-xs text-zinc-400 py-2">No pending photo requests.</p>';

    renderAdminEmployeeList();
    renderPasswordResetQueue();
    renderDhSuspensionOrdersQueue();

    const params = DB.system_settings_audit.filter(s => s.record_type === 'PARAMETER');
    document.getElementById('system-settings-list').innerHTML = params.map(p => `
        <li class="p-2.5 rounded-xl bg-white border border-zinc-200 flex justify-between items-center">
            <span><strong>${p.category}:</strong> ${p.setting_value} ${p.prefix_data ? `(${p.prefix_data})` : ''}</span>
            <button type="button" onclick="deleteSystemParam(${p.record_id})" class="text-zinc-400 hover:text-rose-600"><i class="ph-bold ph-trash"></i></button>
        </li>
    `).join('');

    const vaultBadge = document.getElementById('trash-vault-count-badge');
    if (vaultBadge) vaultBadge.innerText = (DB.discarded_trash_vault || []).length;

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
    `).join('') || '<tr><td colspan="6" class="p-4 text-center text-zinc-400">No activity logged.</td></tr>';

    refreshAllCustomSelects();
}

function renderAdminEmployeeList() {
    const q = (document.getElementById('admin-emp-search')?.value || '').trim().toLowerCase();
    const totalStaff = DB.employees.length;
    let list = DB.employees;

    if (q) {
        list = list.filter(e =>
            e.full_name.toLowerCase().includes(q) ||
            e.employee_id.toLowerCase().includes(q) ||
            e.role_designation.toLowerCase().includes(q) ||
            (e.account_status || 'Active').toLowerCase().includes(q)
        );
    }

    const countLabel = document.getElementById('admin-emp-count-label');
    if (countLabel) {
        countLabel.innerText = q
            ? `Employee Directory (${list.length} of ${totalStaff} Staff)`
            : `Employee Directory (${totalStaff} Staff)`;
    }

    const unassignedStaff = DB.employees.filter(e => !isEmployeeQrAssigned(e.employee_id));
    const batchEmpQrBtn = document.getElementById('batch-assign-emp-qr-btn');
    if (batchEmpQrBtn) {
        batchEmpQrBtn.classList.toggle('hidden', unassignedStaff.length === 0);
        batchEmpQrBtn.innerText = `Assign All Staff QRs (${unassignedStaff.length})`;
    }

    document.getElementById('admin-emp-tbody').innerHTML = list.map(e => {
        const status = e.account_status || 'Active';
        const isSuspended = status.startsWith('Suspended');
        const qrOk = isEmployeeQrAssigned(e.employee_id);

        return `
            <tr class="hover:bg-zinc-50">
                <td class="p-2.5 flex items-center gap-2.5">
                    <img src="${getAvatarUrl(e.avatar_url, e.employee_id)}" class="w-8 h-8 rounded-full object-cover border border-zinc-300 shrink-0">
                    <div class="min-w-0">
                        <p class="font-bold text-zinc-900 truncate">${e.full_name}</p>
                        <p class="text-[10px] text-zinc-500 truncate">${e.role_designation}</p>
                    </div>
                </td>
                <td class="p-2.5 font-mono font-bold text-zinc-700">${e.employee_id}</td>
                <td class="p-2.5">
                    <span class="block text-zinc-800">${e.department}</span>
                    <span class="text-[10px] text-zinc-400">${e.work_location_zone}</span>
                </td>
                <td class="p-2.5 space-x-1">
                    <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isSuspended ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">
                        ${isSuspended ? 'Suspended' : 'Active'}
                    </span>
                    <span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${qrOk ? 'bg-zinc-900 text-white' : 'bg-amber-50 text-amber-800 border border-amber-200'}">
                        ${qrOk ? 'QR' : 'No QR'}
                    </span>
                </td>
                <td class="p-2.5 text-right">
                    <button type="button" onclick="openStaffProfileModal('${e.employee_id}')" title="Open Staff Profile" class="w-8 h-8 rounded-xl bg-zinc-100 hover:bg-zinc-900 hover:text-white text-zinc-700 inline-flex items-center justify-center transition-colors">
                        <i class="ph-bold ph-dots-three text-lg"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderPasswordResetQueue() {
    const listEl = document.getElementById('password-reset-tickets-list');
    if (!listEl) return;

    const isPrivAdmin = isCurrentUserPrivilegedAdmin();
    const tickets = DB.department_communications.filter(c => c.protocol_category === 'Password Reset');

    listEl.innerHTML = tickets.map(t => {
        const isPendingSupport = t.comm_status === 'Pending Support Verification';
        const isEscalated = t.comm_status === 'Escalated to Admin';

        return `
            <div class="p-3 rounded-xl bg-white border border-zinc-200 text-xs space-y-1.5">
                <div class="flex justify-between items-center">
                    <span class="font-mono font-bold text-zinc-900">${t.linked_reference_id} (${t.sender_name})</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-100 text-zinc-800">${t.comm_status}</span>
                </div>
                <p class="text-zinc-600">${t.message_body}</p>
                ${t.resolution_note ? `<p class="font-mono text-[11px] text-emerald-700 bg-emerald-50 p-1.5 rounded border border-emerald-200">${t.resolution_note}</p>` : ''}
                <div class="flex gap-2 pt-1">
                    ${isPendingSupport ? `
                        <button type="button" onclick="supportEscalatePasswordReset(${t.comm_id}, '${t.linked_reference_id}')" class="bg-zinc-900 hover:bg-zinc-800 text-white px-3 py-1 rounded-lg font-semibold">
                            Verify & Escalate
                        </button>
                        <button type="button" onclick="resolveCommItem(${t.comm_id}, 'Rejected')" class="bg-zinc-100 text-rose-600 px-3 py-1 rounded-lg font-semibold">
                            Reject
                        </button>
                    ` : ''}
                    ${isEscalated && isPrivAdmin ? `
                        <button type="button" onclick="adminGrantTempPassword(${t.comm_id}, '${t.linked_reference_id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-lg font-bold">
                            Release Temp Password
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('') || '<p class="text-xs text-zinc-400 py-4 text-center">No password reset requests.</p>';
}

function renderDhSuspensionOrdersQueue() {
    const listEl = document.getElementById('dh-suspension-orders-list');
    if (!listEl) return;

    const isPrivAdmin = isCurrentUserPrivilegedAdmin();
    const orders = DB.department_communications.filter(c => c.protocol_category === 'Suspension Directive');

    listEl.innerHTML = orders.map(o => {
        const isPending = o.comm_status === 'Pending Execution';
        return `
            <div class="p-3 rounded-xl bg-white border border-zinc-200 text-xs space-y-1.5">
                <div class="flex justify-between items-center">
                    <span class="font-mono font-bold text-zinc-900">Target: ${o.linked_reference_id}</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isPending ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">${o.comm_status}</span>
                </div>
                <p class="font-bold text-zinc-800">${o.subject_line}</p>
                <p class="text-zinc-600">${o.message_body}</p>
                ${isPending && isPrivAdmin ? `
                    <button type="button" onclick="executeDhSuspensionDirective(${o.comm_id})" class="w-full bg-rose-600 hover:bg-rose-700 text-white py-1.5 rounded-lg font-bold mt-1">
                        Execute Department Head Directive & File Report
                    </button>
                ` : ''}
            </div>
        `;
    }).join('') || '<p class="text-xs text-zinc-400 py-4 text-center">No suspension orders from Department Head.</p>';
}

async function executeDhSuspensionDirective(commId) {
    if (!isCurrentUserPrivilegedAdmin()) return showToast('Admin authority required.', 'error');
    const directive = DB.department_communications.find(c => c.comm_id === commId);
    if (!directive) return;

    const targetId = directive.linked_reference_id;
    const actionType = directive.resolution_note || 'Suspended (7-Day Time-Out)';

    await supa.from('department_communications').update({
        comm_status: 'Executed & Reported'
    }).eq('comm_id', commId);

    if (actionType === 'ARCHIVE') {
        await softDeleteRecord('employees', targetId, directive.message_body);
        return;
    }

    const untilDate = actionType.includes('7-Day')
        ? getLocalDateString(new Date(Date.now() + 7 * 86400000))
        : (actionType.includes('30-Day') ? getLocalDateString(new Date(Date.now() + 30 * 86400000)) : null);

    await supa.from('employees').update({
        account_status: actionType,
        suspension_until: untilDate
    }).eq('employee_id', targetId);

    const emp = DB.employees.find(e => e.employee_id === targetId);
    await supa.from('department_communications').insert([{
        sender_id: currentLoggedInUser.employee_id,
        sender_name: currentLoggedInUser.full_name,
        sender_role: currentLoggedInUser.role_designation,
        receiver_id: 'DH-01',
        receiver_name: 'Jackson Emmanuel',
        receiver_role: 'Cutting Dpt. Head',
        protocol_category: 'Staff Status Report',
        linked_reference_id: targetId,
        subject_line: `Executed: ${emp ? emp.full_name : targetId} (${actionType})`,
        message_body: `Digital Unit executed Department Head directive for ${targetId}. Status: ${actionType} ${untilDate ? `(Until ${untilDate})` : ''}.`,
        comm_status: 'Filed Report'
    }]);

    await writeAuditLog('EXECUTE_DH_SUSPENSION', 'Employees', targetId, { actionType, untilDate });
    await renderAdminPortal();
    showToast(`Executed suspension for ${targetId} & filed report.`);
}

async function supportEscalatePasswordReset(commId, targetEmpId) {
    await supa.from('department_communications').update({
        receiver_id: 'DT-C-CA-01',
        receiver_name: 'Ashan Mendis',
        receiver_role: 'CDMS Admins',
        comm_status: 'Escalated to Admin'
    }).eq('comm_id', commId);

    await writeAuditLog('SUPPORT_ESCALATE_PASS_RESET', 'Employees', targetEmpId, { commId });
    await renderAdminPortal();
    showToast(`Escalated ${targetEmpId} to CDMS Admin.`);
}

async function adminGrantTempPassword(commId, targetEmpId) {
    if (!isCurrentUserPrivilegedAdmin()) {
        return showToast('Only CDMS Admin can generate Temporary Passwords.', 'error');
    }
    const tempPass = `TMP-${Math.floor(1000 + Math.random() * 9000)}`;

    await supa.from('employees').update({
        temp_password: tempPass,
        must_reset_password: true
    }).eq('employee_id', targetEmpId);

    await supa.from('department_communications').update({
        comm_status: 'Temp Password Issued',
        resolution_note: `Temp Password: ${tempPass}`
    }).eq('comm_id', commId);

    await writeAuditLog('ISSUE_TEMP_PASSWORD', 'Employees', targetEmpId, { tempPass });
    await renderAdminPortal();
    showToast(`Temp Password ${tempPass} issued for ${targetEmpId}.`);
}

async function supportResetKioskLocks() {
    const lockedAssets = DB.pattern_assets.filter(p => p.operational_status.includes('Locked'));
    for (const a of lockedAssets) {
        await supa.from('pattern_assets').update({
            operational_status: 'Available in Room',
            borrowed_by_id: null
        }).eq('asset_id', a.asset_id);
    }
    await writeAuditLog('RESET_KIOSK_LOCKS', 'Pattern_Assets', 'ALL', { cleared_count: lockedAssets.length });
    await syncFromSupabase();
    showToast(`Cleared ${lockedAssets.length} locked items.`);
}

function switchAdminSubTab(tab) {
    closeCustomSelectMenu();
    ['emp', 'security', 'params', 'records'].forEach(t => {
        const panel = document.getElementById(`admin-panel-${t}`);
        const btn = document.getElementById(`adm-sub-${t}`);
        if (panel) panel.classList.add('hidden');
        if (btn) btn.className = 'px-3.5 py-2 rounded-xl bg-zinc-100 text-zinc-700 hover:bg-zinc-200';
    });
    document.getElementById(`admin-panel-${tab}`).classList.remove('hidden');
    document.getElementById(`adm-sub-${tab}`).className = 'px-3.5 py-2 rounded-xl bg-zinc-900 text-white';
    refreshAllCustomSelects();
}

async function registerNewEmployee() {
    const id = document.getElementById('reg-emp-id').value.trim().toUpperCase();
    const name = document.getElementById('reg-emp-name').value.trim();
    const dept = document.getElementById('reg-emp-dept').value;
    const role = document.getElementById('reg-emp-role').value;
    const zone = document.getElementById('reg-emp-zone').value;
    const initPass = (document.getElementById('reg-emp-init-pass')?.value || '').trim() || 'bodyline123';
    const photoInput = document.getElementById('reg-emp-photo');

    if (!id || !name) return showToast('Enter Employee ID and Full Name.', 'error');

    // Prevent duplicate Employee ID or duplicate staff member in the same role/department
    const dupEmpById = DB.employees.find(e => e.employee_id.toUpperCase() === id) ||
                       (DB.discarded_trash_vault || []).find(t => t.original_table === 'employees' && t.record_id.toUpperCase() === id);
    if (dupEmpById) {
        return showToast(`Employee ID ${id} already exists in the database.`, 'error');
    }
    const normalizedName = name.replace(/\s+/g, ' ').toLowerCase();
    const dupEmpByName = DB.employees.find(
        e => e.full_name.trim().replace(/\s+/g, ' ').toLowerCase() === normalizedName &&
             (e.department === dept || e.role_designation === role)
    );
    if (dupEmpByName) {
        return showToast(`Duplicate employee blocked: ${dupEmpByName.full_name} (${dupEmpByName.employee_id}) is already registered in ${dupEmpByName.department}.`, 'error');
    }

    const avatarData = await readAndCompressImage(photoInput, 220);

    const newEmp = {
        employee_id: id,
        full_name: name,
        department: dept,
        role_designation: role,
        work_location_zone: zone,
        active_checkout_count: 0,
        avatar_url: avatarData || '',
        account_password: initPass,
        account_status: 'Active'
    };

    const { error } = await supa.from('employees').insert([newEmp]);
    if (error) return showToast(error.message, 'error');

    // Automatically assign and activate the employee's QR badge upon registration
    await supa.from('system_settings_audit').insert([{
        record_type: 'QR_ASSIGNED',
        category: 'EMPLOYEE_QR',
        setting_value: id,
        prefix_data: dept.substring(0, 12),
        requested_by_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'DT-C-CA-01',
        request_status: 'Active'
    }]);

    await writeAuditLog('REGISTER_EMPLOYEE', 'Employees', id, { id, name, dept, role, zone });

    const box = document.getElementById('emp-qr-preview-box');
    box.innerHTML = `
        <div class="p-3 bg-white rounded-xl border border-zinc-300 inline-flex flex-col items-center gap-1.5">
            <div id="emp-qr-canvas"></div>
            <p class="text-xs font-bold text-zinc-900">${name} (${id})</p>
            <button type="button" onclick="printQrTagOrBadge('EMPLOYEE', '${id}')" class="px-3 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-[10px] font-semibold inline-flex items-center gap-1">
                <i class="ph-bold ph-printer"></i> Print QR Badge
            </button>
        </div>`;
    new QRCode(document.getElementById('emp-qr-canvas'), { text: id, width: 80, height: 80 });

    document.getElementById('reg-emp-name').value = '';
    if (document.getElementById('reg-emp-init-pass')) document.getElementById('reg-emp-init-pass').value = '';
    await renderAdminPortal();
    showToast(`Registered ${name} (${id}) & assigned QR badge.`);
}

async function addSystemSetting() {
    const cat = document.getElementById('sys-cat').value;
    const val = document.getElementById('sys-val').value.trim();
    const prefix = document.getElementById('sys-prefix').value.trim().toUpperCase();
    if (!val) return showToast('Enter parameter value.', 'error');

    const dupParam = DB.system_settings_audit.find(
        s => s.record_type === 'PARAMETER' && s.category === cat && s.setting_value.trim().toLowerCase() === val.toLowerCase()
    );
    if (dupParam) {
        return showToast(`Parameter "${val}" already exists under ${cat}.`, 'error');
    }

    const row = {
        record_type: 'PARAMETER',
        category: cat,
        setting_value: val,
        prefix_data: prefix,
        requested_by_id: currentLoggedInUser ? currentLoggedInUser.employee_id : 'DT-C-CA-01',
        request_status: 'Active'
    };
    await supa.from('system_settings_audit').insert([row]);
    await writeAuditLog('ADD_PARAMETER', 'System_Settings_Audit', val, row);
    document.getElementById('sys-val').value = '';
    document.getElementById('sys-prefix').value = '';
    await renderAdminPortal();
    showToast(`Saved ${cat}: ${val}`);
}

async function deleteSystemParam(recId) {
    const target = DB.system_settings_audit.find(s => s.record_id === recId);
    await writeAuditLog('REMOVE_PARAMETER', 'System_Settings_Audit', recId, target || {});
    await supa.from('system_settings_audit').delete().eq('record_id', recId);
    await renderAdminPortal();
}


// --- Inter-Department Communicator Drawer ---
// Handles internal requests, drafts, and executive approvals across departments.

function updateCommUnreadBadge() {
    if (!currentLoggedInUser) return;
    const myId = currentLoggedInUser.employee_id;
    const pendingForMe = DB.department_communications.filter(
        c => c.receiver_id === myId && c.comm_status === 'Pending Approval'
    ).length;
    document.getElementById('comm-unread-badge').innerText = pendingForMe;
}

function toggleCommDrawer() {
    closeCustomSelectMenu();
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

    const sourceList = DB.employees.length > 0
        ? DB.employees
        : Object.entries(SANDBOX_ROLE_DEFAULTS).map(([empId, info]) => ({
            employee_id: empId,
            full_name: info.full_name,
            role_designation: info.role_designation,
            department: info.department
        }));

    return sourceList.filter(e => {
        if (e.employee_id === user.employee_id) return false;
        if (e.employee_id === 'DH-01' && !canContactDeptHead) return false;
        return !e.employee_id.startsWith('CW-');
    });
}

function switchCommTab(tab, preReceiver = null, preCategory = null) {
    closeCustomSelectMenu();
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
            c => c.receiver_id === myId && c.comm_status !== 'Draft' && c.protocol_category !== 'Avatar Request' && c.protocol_category !== 'Staff Status Report'
        );
        body.innerHTML = inbox.map(c => `
            <div class="p-3.5 rounded-xl bg-white border border-zinc-200 mb-2.5 space-y-2">
                <div class="flex justify-between items-center">
                    <span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 font-bold text-[10px] uppercase">${c.protocol_category}</span>
                    <span class="font-mono text-[10px] text-zinc-400">${c.linked_reference_id}</span>
                </div>
                <p class="font-bold text-zinc-900">${c.subject_line}</p>
                <p class="text-zinc-600">${c.message_body}</p>
                <p class="text-[10px] text-zinc-400">From: <strong>${c.sender_name}</strong></p>
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
            ...DB.cad_markers.map(m => `${m.style_code} (${m.brand_buyer})`),
            ...DB.rmw_materials.map(m => `${m.material_code} (${m.material_category})`),
            'PARAM-REQ (System Parameter Change)'
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
                        <option value="QC Escalation" ${preCategory === 'QC Escalation' ? 'selected' : ''}>QC Escalation</option>
                        <option value="Line Directive" ${preCategory === 'Line Directive' ? 'selected' : ''}>Line Directive</option>
                    </select>
                </div>
                <div>
                    <label class="text-[11px] font-bold text-zinc-600 block mb-1">Reference ID</label>
                    <select id="comm-ref-id" class="w-full p-2 bg-zinc-50 border border-zinc-300 rounded-lg font-mono">
                        ${refOptions.map(ref => `<option value="${ref.split(' ')[0]}">${ref}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="text-[11px] font-bold text-zinc-600 block mb-1">Subject</label>
                    <input id="comm-subject" type="text" placeholder="Subject" class="w-full p-2.5 bg-zinc-50 border border-zinc-300 rounded-xl outline-none focus:border-zinc-900">
                </div>
                <div>
                    <label class="text-[11px] font-bold text-zinc-600 block mb-1">Details</label>
                    <textarea id="comm-message" rows="3" placeholder="Details" class="w-full p-2.5 bg-zinc-50 border border-zinc-300 rounded-xl outline-none focus:border-zinc-900"></textarea>
                </div>
                <div class="grid grid-cols-2 gap-2 pt-1">
                    <button type="button" onclick="saveOrSendComm('Draft')" class="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 py-2 rounded-lg font-semibold">Save Draft</button>
                    <button type="button" onclick="saveOrSendComm('Pending Approval')" class="bg-zinc-900 hover:bg-zinc-800 text-white py-2 rounded-lg font-semibold">Send</button>
                </div>
            </div>
        `;
        refreshAllCustomSelects();
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
            c => (c.sender_id === myId || c.receiver_id === myId) && c.comm_status !== 'Draft' && c.protocol_category !== 'Avatar Request'
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

    const recObj = DB.employees.find(e => e.employee_id === recId) || {
        employee_id: recId,
        full_name: SANDBOX_ROLE_DEFAULTS[recId] ? SANDBOX_ROLE_DEFAULTS[recId].full_name : recId,
        role_designation: SANDBOX_ROLE_DEFAULTS[recId] ? SANDBOX_ROLE_DEFAULTS[recId].role_designation : 'Department Staff'
    };
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
    await writeAuditLog(targetStatus === 'Draft' ? 'SAVE_DRAFT' : 'SEND_REQUEST', 'Department_Communications', refId, payload);
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
    await writeAuditLog(`COMM_${decision.toUpperCase()}`, 'Department_Communications', commId, { decision });
    await syncFromSupabase();
    if (!document.getElementById('view-dept-head').classList.contains('hidden')) renderDeptHeadPortal();
    if (!document.getElementById('view-qc').classList.contains('hidden')) renderQcPortal();
    if (!document.getElementById('view-admin').classList.contains('hidden')) renderAdminPortal();
    switchCommTab('inbox');
    showToast(`Marked as ${decision}.`);
}


// --- Printable Management Reports (REP-01 to REP-05) & Database Explorer ---
// Generates A4 print layouts and provides a live table viewer for all 13 system tables.

function switchReportMode(mode) {
    closeCustomSelectMenu();
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
    else if (repNo === 2) groups = ['Line 1', 'Line 2', 'Line 3'];
    else if (repNo === 3) groups = ['Morning', 'Afternoon', 'Night'];
    else if (repNo === 4) groups = ['CAD Tooling Material', 'Cutting Floor Fabric'];
    else groups = ['Staff Status Report', 'Suspension Directive'];

    sel.innerHTML = `<option value="ALL">All Groups (${groups.length})</option>` +
        groups.map(g => `<option value="${g}">${g}</option>`).join('');
    refreshAllCustomSelects();
}

function renderGroupedReport() {
    const repNo = parseInt(document.getElementById('rep-type-select').value);
    const filterVal = document.getElementById('rep-group-filter').value;
    const customTitle = document.getElementById('rep-custom-title').value.trim();
    const customNote = document.getElementById('rep-custom-note').value.trim();
    const canvas = document.getElementById('printable-report-canvas');
    const nowStr = new Date().toLocaleString();
    const roleFor = currentLoggedInUser ? `${currentLoggedInUser.full_name} (${currentLoggedInUser.role_designation})` : 'Cutting Department';

    const leftLogoHtml = resolvedMasLogoUrl
        ? `<img src="${resolvedMasLogoUrl}" class="h-7 sm:h-9 max-w-[110px] sm:max-w-[150px] object-contain" alt="MAS">`
        : `<span class="font-black text-zinc-900 text-xs sm:text-sm tracking-tight uppercase">MAS HOLDINGS</span>`;
    const rightLogoHtml = resolvedBodylineLogoUrl
        ? `<img src="${resolvedBodylineLogoUrl}" class="h-7 sm:h-9 max-w-[110px] sm:max-w-[150px] object-contain ml-auto" alt="Bodyline">`
        : `<span class="font-extrabold text-zinc-900 text-xs sm:text-sm tracking-widest uppercase">BODYLINE</span>`;

    const defaultTitles = {
        1: 'PATTERN BLOCKS & 3D MOLDS INVENTORY REPORT',
        2: 'QUALITY CONTROL DEFECT SUMMARY REPORT',
        3: 'DAILY SHIFT DEPLOYMENT ROSTER REPORT',
        4: 'RAW MATERIAL WAREHOUSE STATUS REPORT',
        5: 'STAFF STATUS, SUSPENSIONS & DISCIPLINARY LOG REPORT'
    };

    let bodyGroupsHtml = '';

    if (repNo === 1) {
        let brands = [...new Set(DB.pattern_assets.map(p => p.brand_buyer))];
        if (filterVal !== 'ALL') brands = brands.filter(b => b === filterVal);
        bodyGroupsHtml = brands.map(brand => {
            const items = DB.pattern_assets.filter(p => p.brand_buyer === brand);
            return `
                <div class="mb-5 border border-zinc-300 rounded-lg overflow-x-auto">
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
        let lines = ['Line 1', 'Line 2', 'Line 3'];
        if (filterVal !== 'ALL') lines = lines.filter(l => l === filterVal);
        bodyGroupsHtml = lines.map(lineName => {
            const logs = DB.qc_inspection_logs.filter(l => l.production_line === lineName);
            return `
                <div class="mb-5 border border-zinc-300 rounded-lg overflow-x-auto">
                    <div class="bg-zinc-100 px-4 py-2 border-b border-zinc-300 flex justify-between text-xs font-bold">
                        <span>PRODUCTION LINE: ${lineName.toUpperCase()}</span>
                        <span>Logged Defects: ${logs.length}</span>
                    </div>
                    <table class="w-full text-left text-xs">
                        <thead class="bg-zinc-50 text-[10px] uppercase text-zinc-500 border-b border-zinc-200">
                            <tr><th class="p-2">Log ID</th><th class="p-2">Asset ID</th><th class="p-2">Severity & Code</th><th class="p-2">Ruined Plies</th><th class="p-2">Inspector</th><th class="p-2">Exec Receipt</th><th class="p-2">Status</th></tr>
                        </thead>
                        <tbody class="divide-y divide-zinc-200">
                            ${logs.map(l => {
                                const defObj = DB.qc_defect_codes.find(d => d.defect_code === l.defect_code);
                                return `<tr><td class="p-2 font-mono font-bold">${l.qc_log_id}</td><td class="p-2 font-mono">${l.asset_id}</td><td class="p-2">[${l.severity_tier || 'Medium'}] ${l.defect_code} (${defObj ? defObj.defect_name_symptom : ''})</td><td class="p-2">${l.ruined_ply_count}</td><td class="p-2">${l.inspector_id}</td><td class="p-2">${l.exec_acknowledged ? 'Accepted' : 'Pending'}</td><td class="p-2 font-semibold">${l.resolution_status}</td></tr>`;
                            }).join('') || '<tr><td colspan="7" class="p-3 text-zinc-400">No quality control defects registered for this line.</td></tr>'}
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
                <div class="mb-5 border border-zinc-300 rounded-lg overflow-x-auto">
                    <div class="bg-zinc-100 px-4 py-2 border-b border-zinc-300 flex justify-between text-xs font-bold">
                        <span>SHIFT: ${sh.toUpperCase()}</span>
                        <span>Subtotal: ${rows.length}</span>
                    </div>
                    <table class="w-full text-left text-xs">
                        <thead class="bg-zinc-50 text-[10px] uppercase text-zinc-500 border-b border-zinc-200">
                            <tr><th class="p-2">ID</th><th class="p-2">Operator</th><th class="p-2">Supervisor</th><th class="p-2">Date</th><th class="p-2">Line</th></tr>
                        </thead>
                        <tbody class="divide-y divide-zinc-200">
                            ${rows.map(r => `<tr><td class="p-2 font-mono">#${r.assignment_id}</td><td class="p-2 font-bold">${r.borrower_id}</td><td class="p-2">${r.supervisor_id}</td><td class="p-2">${r.assigned_date}</td><td class="p-2">${r.production_line}</td></tr>`).join('') || '<tr><td colspan="5" class="p-3 text-zinc-400">No shift deployments assigned yet.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');
    } else if (repNo === 4) {
        let cats = ['CAD Tooling Material', 'Cutting Floor Fabric'];
        if (filterVal !== 'ALL') cats = cats.filter(c => c === filterVal);
        bodyGroupsHtml = cats.map(cat => {
            const items = DB.rmw_materials.filter(m => m.material_category === cat);
            return `
                <div class="mb-5 border border-zinc-300 rounded-lg overflow-x-auto">
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
    } else {
        const staffLogs = DB.department_communications.filter(
            c => c.protocol_category === 'Staff Status Report' || c.protocol_category === 'Admin Staff Report' || c.protocol_category === 'Suspension Directive'
        );
        bodyGroupsHtml = `
            <div class="mb-5 border border-zinc-300 rounded-lg overflow-x-auto">
                <div class="bg-zinc-100 px-4 py-2 border-b border-zinc-300 flex justify-between text-xs font-bold">
                    <span>STAFF STATUS & DISCIPLINARY LOGS</span>
                    <span>Total Entries: ${staffLogs.length}</span>
                </div>
                <table class="w-full text-left text-xs">
                    <thead class="bg-zinc-50 text-[10px] uppercase text-zinc-500 border-b border-zinc-200">
                        <tr><th class="p-2">Staff ID</th><th class="p-2">Action Summary</th><th class="p-2">Details & Reason</th><th class="p-2">Logged By</th><th class="p-2">Status</th></tr>
                    </thead>
                    <tbody class="divide-y divide-zinc-200">
                        ${staffLogs.map(r => `<tr><td class="p-2 font-mono font-bold">${r.linked_reference_id}</td><td class="p-2 font-semibold">${r.subject_line}</td><td class="p-2">${r.message_body}</td><td class="p-2">${r.sender_name}</td><td class="p-2">${r.comm_status}</td></tr>`).join('') || '<tr><td colspan="5" class="p-3 text-zinc-400">No disciplinary or suspension actions recorded.</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    }

    canvas.innerHTML = `
        <div class="border-b-2 border-zinc-900 pb-4 mb-5 grid grid-cols-3 items-center gap-2">
            <div>${leftLogoHtml}</div>
            <div class="text-center">
                <p class="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-zinc-900">CDMS<span class="text-red-600">+</span> Report REP-0${repNo}</p>
                <h2 class="text-xs sm:text-base font-black text-zinc-900 uppercase mt-0.5">${customTitle || defaultTitles[repNo]}</h2>
                <p class="text-[10px] sm:text-[11px] text-zinc-500">Bodyline (Pvt) Ltd, Horana Plant 1</p>
            </div>
            <div class="text-right">${rightLogoHtml}</div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5 text-[11px] bg-zinc-50 p-3 rounded-lg border border-zinc-200">
            <div><span class="text-zinc-400 block">Generated At</span><strong>${nowStr}</strong></div>
            <div><span class="text-zinc-400 block">Prepared For</span><strong>${roleFor}</strong></div>
            <div><span class="text-zinc-400 block">Filter</span><strong>${filterVal}</strong></div>
            <div><span class="text-zinc-400 block">Note</span><strong>${customNote || 'Standard Report'}</strong></div>
        </div>

        ${bodyGroupsHtml}

        <div class="mt-6 pt-3 border-t border-zinc-200 flex flex-wrap justify-between items-center gap-2 text-[10px] font-mono text-zinc-400">
            <span>CDMS+ DEPARTMENT REPORT</span>
            <span>BODYLINE (PVT) LTD (HORANA PLANT 1)</span>
        </div>
    `;
}

const VDB_TABLES = [
    'employees', 'pattern_assets', 'cad_markers', 'rmw_materials', 'qc_defect_codes',
    'shift_assignments', 'pending_requests', 'cutting_orders', 'qc_inspection_logs',
    'system_settings_audit', 'department_communications', 'immutable_audit_logs', 'discarded_trash_vault'
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
        document.getElementById('vdb-table-rows').innerHTML = '<p class="text-zinc-400 py-6">0 rows (Clean Unused State).</p>';
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
                ${rows.map(r => `<tr class="hover:bg-zinc-50">${cols.map(c => `<td class="p-2 truncate max-w-[180px]">${r[c] !== null && r[c] !== undefined ? String(r[c]) : '-'}</td>`).join('')}</tr>`).join('')}
            </tbody>
        </table>
    `;
}