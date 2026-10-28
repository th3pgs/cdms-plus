// ============================================================================
// CDMS + (CUTTING DEPARTMENT MANAGEMENT SYSTEM PLUS) - MASTER ENGINE
// Pre-seeded with all spreadsheet data + Instant LocalStorage & Supabase Ready
// ============================================================================

const STORAGE_KEY = 'CDMS_PLUS_MASTER_DB_V1';
let vivaBypassUnlocked = false;
let currentLoggedInUser = null;
let currentMode = 'gateway'; // 'gateway', 'terminal', 'portal'
let idleSecondsRemaining = 300; // 5-Minute (300s) Unfinished Procedure Reset
let idleInterval = null;
let shiftTimerInterval = null;
let mutexPollInterval = null;
let selectedOperatorForAssign = null;
let currentScanAsset = null;

// ============================================================================
// 1. MASTER SEED DATA (EXACT MATCH WITH YOUR SPREADSHEET TABS 1 TO 5)
// ============================================================================
const INITIAL_DB = {
    Employees: [
        { Employee_ID: 'DH-01', Full_Name: 'Jackson Emmanuel', Department: 'Cutting', Role_Designation: 'Cutting Dpt. Head', Work_Location_Zone: 'CD Operations Office', Active_Checkout_Count: 0 },
        { Employee_ID: 'CSE-01', Full_Name: 'Aaron Emmanuel', Department: 'Cutting', Role_Designation: 'Cutting Senior Executive', Work_Location_Zone: 'CD Operations Office', Active_Checkout_Count: 0 },
        { Employee_ID: 'CS-L1-01', Full_Name: 'Nathaniel Perera', Department: 'Cutting', Role_Designation: 'Cutting Supervisors', Work_Location_Zone: 'Cutting Floor', Active_Checkout_Count: 0 },
        { Employee_ID: 'CS-L2-01', Full_Name: 'Rifa Mohamed', Department: 'Cutting', Role_Designation: 'Cutting Supervisors', Work_Location_Zone: 'Cutting Floor', Active_Checkout_Count: 0 },
        { Employee_ID: 'CS-L3-01', Full_Name: 'Oshani Wickramasinghe', Department: 'Cutting', Role_Designation: 'Cutting Supervisors', Work_Location_Zone: 'Cutting Floor', Active_Checkout_Count: 0 },
        { Employee_ID: 'CW-L1-FS-01', Full_Name: 'Nimal Perera', Department: 'Cutting', Role_Designation: 'Fabric Spreaders', Work_Location_Zone: 'Cutting Floor - Line 1', Active_Checkout_Count: 0 },
        { Employee_ID: 'CW-L2-FS-01', Full_Name: 'Kasun Wijesinghe', Department: 'Cutting', Role_Designation: 'Fabric Spreaders', Work_Location_Zone: 'Cutting Floor - Line 2', Active_Checkout_Count: 0 },
        { Employee_ID: 'CW-L3-FS-01', Full_Name: 'Tharindu Jayawardena', Department: 'Cutting', Role_Designation: 'Fabric Spreaders', Work_Location_Zone: 'Cutting Floor - Line 3', Active_Checkout_Count: 0 },
        { Employee_ID: 'CW-L1-CMO-01', Full_Name: 'Gayan Abeysekara', Department: 'Cutting', Role_Designation: 'Cutting Machine Operators', Work_Location_Zone: 'Cutting Floor - Line 1', Active_Checkout_Count: 1 },
        { Employee_ID: 'CW-L1-CMO-02', Full_Name: 'Dilshan Madushanka', Department: 'Cutting', Role_Designation: 'Cutting Machine Operators', Work_Location_Zone: 'Cutting Floor - Line 1', Active_Checkout_Count: 1 },
        { Employee_ID: 'CW-L2-CMO-01', Full_Name: 'Akila Senanayake', Department: 'Cutting', Role_Designation: 'Cutting Machine Operators', Work_Location_Zone: 'Cutting Floor - Line 2', Active_Checkout_Count: 1 },
        { Employee_ID: 'CW-L2-CMO-02', Full_Name: 'Mark Anthony', Department: 'Cutting', Role_Designation: 'Cutting Machine Operators', Work_Location_Zone: 'Cutting Floor - Line 2', Active_Checkout_Count: 0 },
        { Employee_ID: 'CW-L3-CMO-01', Full_Name: 'Supun Karunaratne', Department: 'Cutting', Role_Designation: 'Cutting Machine Operators', Work_Location_Zone: 'Cutting Floor - Line 3', Active_Checkout_Count: 1 },
        { Employee_ID: 'CW-L1-BU-01', Full_Name: 'Shehani Silva', Department: 'Cutting', Role_Designation: 'Bundling Unit', Work_Location_Zone: 'Cutting Floor - Line 1', Active_Checkout_Count: 0 },
        { Employee_ID: 'CW-L2-BU-01', Full_Name: 'Amila Perera', Department: 'Cutting', Role_Designation: 'Bundling Unit', Work_Location_Zone: 'Cutting Floor - Line 2', Active_Checkout_Count: 0 },
        { Employee_ID: 'CW-L3-BU-01', Full_Name: 'Sachini Peris', Department: 'Cutting', Role_Designation: 'Bundling Unit', Work_Location_Zone: 'Cutting Floor - Line 3', Active_Checkout_Count: 0 },
        { Employee_ID: 'SDC-C-01', Full_Name: 'Tharindu Perera', Department: 'Sewing - Cutting', Role_Designation: 'Sewing Dpt. Coordinator', Work_Location_Zone: 'Sewing Department', Active_Checkout_Count: 0 },
        { Employee_ID: 'SDC-C-02', Full_Name: 'Daniel Fernando', Department: 'Sewing - Cutting', Role_Designation: 'Sewing Dpt. Coordinator', Work_Location_Zone: 'Sewing Department', Active_Checkout_Count: 0 },
        { Employee_ID: 'CQCE-01', Full_Name: 'Imesha Fernando', Department: 'QC - Cutting', Role_Designation: 'Quality Control Executive', Work_Location_Zone: 'CD Operations Office', Active_Checkout_Count: 0 },
        { Employee_ID: 'QCI-C-01', Full_Name: 'Mohamed Faiz', Department: 'QC - Cutting', Role_Designation: 'Quality Control Inspectors', Work_Location_Zone: 'Cutting Floor', Active_Checkout_Count: 0 },
        { Employee_ID: 'QCI-C-02', Full_Name: 'Nadeesha Kumari', Department: 'QC - Cutting', Role_Designation: 'Quality Control Inspectors', Work_Location_Zone: 'Cutting Floor', Active_Checkout_Count: 0 },
        { Employee_ID: 'QCI-C-03', Full_Name: 'Ryan Matthews', Department: 'QC - Cutting', Role_Designation: 'Quality Control Inspectors', Work_Location_Zone: 'Cutting Floor', Active_Checkout_Count: 0 },
        { Employee_ID: 'RMWC-C-01', Full_Name: 'Ahamed Niyas', Department: 'RMW - Cutting', Role_Designation: 'RMW Coordinators', Work_Location_Zone: 'Raw Material Warehouse', Active_Checkout_Count: 0 },
        { Employee_ID: 'RMWC-C-02', Full_Name: 'Dineth Perera', Department: 'RMW - Cutting', Role_Designation: 'RMW Coordinators', Work_Location_Zone: 'Raw Material Warehouse', Active_Checkout_Count: 0 },
        { Employee_ID: 'RMWC-C-03', Full_Name: 'Sherine Daniel', Department: 'RMW - Cutting', Role_Designation: 'RMW Coordinators', Work_Location_Zone: 'Raw Material Warehouse', Active_Checkout_Count: 0 },
        { Employee_ID: 'DDC-C-01', Full_Name: 'Kavindi Perera', Department: 'Design - Cutting', Role_Designation: 'Design Dpt. Coordinators', Work_Location_Zone: 'Design Department', Active_Checkout_Count: 0 },
        { Employee_ID: 'DDC-C-02', Full_Name: 'Mohamed Irfan', Department: 'Design - Cutting', Role_Designation: 'Design Dpt. Coordinators', Work_Location_Zone: 'Design Department', Active_Checkout_Count: 0 },
        { Employee_ID: 'CADC-C-01', Full_Name: 'Oshadhi Perera', Department: 'Cutting - CAD', Role_Designation: 'CAD Coordinators', Work_Location_Zone: 'CAD Room', Active_Checkout_Count: 0 },
        { Employee_ID: 'CAD-C-MM-01', Full_Name: 'Ayesha Nazeer', Department: 'Cutting - CAD', Role_Designation: 'Marker Makers', Work_Location_Zone: 'CAD Room', Active_Checkout_Count: 0 },
        { Employee_ID: 'CAD-C-CPH-01', Full_Name: 'Rizwan Ashraff', Department: 'Cutting - CAD', Role_Designation: 'CAD Pattern Handlers', Work_Location_Zone: 'CAD Room', Active_Checkout_Count: 0 },
        { Employee_ID: 'CAD-C-CPH-02', Full_Name: 'Nethara Silva', Department: 'Cutting - CAD', Role_Designation: 'CAD Pattern Handlers', Work_Location_Zone: 'CAD Room', Active_Checkout_Count: 0 },
        { Employee_ID: 'PR-C-PC-01', Full_Name: 'Menaka Rathnayake', Department: 'Cutting - Pattern', Role_Designation: 'Pattern Coordinators', Work_Location_Zone: 'Pattern Room', Active_Checkout_Count: 0 },
        { Employee_ID: 'PR-C-PH-01', Full_Name: 'Daniel Joseph', Department: 'Cutting - Pattern', Role_Designation: 'Pattern Handlers', Work_Location_Zone: 'Pattern Room', Active_Checkout_Count: 0 },
        { Employee_ID: 'PR-C-PH-02', Full_Name: 'Piumi Fernando', Department: 'Cutting - Pattern', Role_Designation: 'Pattern Handlers', Work_Location_Zone: 'Pattern Room', Active_Checkout_Count: 0 },
        { Employee_ID: 'CDTE-01', Full_Name: 'Arjun Rajan', Department: 'Digital - Cutting', Role_Designation: 'Digital Team Executive', Work_Location_Zone: 'CD Operations Office', Active_Checkout_Count: 0 },
        { Employee_ID: 'DT-C-CST-01', Full_Name: 'Nadeeka Perera', Department: 'Digital - Cutting', Role_Designation: 'CDMS Support Team', Work_Location_Zone: 'CD Operations Office', Active_Checkout_Count: 0 },
        { Employee_ID: 'DT-C-CA-01', Full_Name: 'Ashan Mendis', Department: 'Digital - Cutting', Role_Designation: 'CDMS Admins', Work_Location_Zone: 'CD Operations Office', Active_Checkout_Count: 0 }
    ],
    Pattern_Assets: [
        { Asset_ID: 'TR-PB-01', Tooling_Type: 'Pattern Block', Model_Name: 'Triaction Control', Style_Code: 'TR-TAC-01', Brand_Buyer: 'Triumph', Size_Category: '34C', Storage_Location: 'Rack A-01', Operational_Status: 'Active on Line', Borrowed_By_ID: 'CW-L1-CMO-01', Shift_Checkout: 'Morning', Checkout_Time: new Date(Date.now() - 3600000).toISOString(), Last_Used_Date: '2026-10-28' },
        { Asset_ID: 'TR-PB-02', Tooling_Type: 'Pattern Block', Model_Name: 'Body Make-Up', Style_Code: 'TR-BMU-02', Brand_Buyer: 'Triumph', Size_Category: '36C', Storage_Location: 'Rack A-02', Operational_Status: 'Available in Room', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-10-25' },
        { Asset_ID: 'TR-PM-01', Tooling_Type: 'Pattern Mold', Model_Name: 'Amourette Charm', Style_Code: 'TR-AMC-01', Brand_Buyer: 'Triumph', Size_Category: '34D', Storage_Location: 'Mold Cabinet 01', Operational_Status: 'Active on Line', Borrowed_By_ID: 'CW-L1-CMO-02', Shift_Checkout: 'Morning', Checkout_Time: new Date(Date.now() - 7200000).toISOString(), Last_Used_Date: '2026-10-28' },
        { Asset_ID: 'TR-PM-02', Tooling_Type: 'Pattern Mold', Model_Name: 'Modal Triangle', Style_Code: 'TR-MTR-02', Brand_Buyer: 'Triumph', Size_Category: '38D', Storage_Location: 'Mold Cabinet 02', Operational_Status: 'Pending Removal', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-02-10' },
        { Asset_ID: 'VS-PB-01', Tooling_Type: 'Pattern Block', Model_Name: 'Body by Victoria', Style_Code: 'VS-BBV-10', Brand_Buyer: "Victoria's Secret", Size_Category: '34B', Storage_Location: 'Rack B-01', Operational_Status: 'Available in Room', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-10-27' },
        { Asset_ID: 'VS-PB-02', Tooling_Type: 'Pattern Block', Model_Name: 'Dream Angels Demi', Style_Code: 'VS-DAD-11', Brand_Buyer: "Victoria's Secret", Size_Category: '36D', Storage_Location: 'Rack B-02', Operational_Status: 'Active on Line', Borrowed_By_ID: 'CW-L2-CMO-01', Shift_Checkout: 'Morning', Checkout_Time: new Date(Date.now() - 5400000).toISOString(), Last_Used_Date: '2026-10-28' },
        { Asset_ID: 'VS-PM-01', Tooling_Type: 'Pattern Mold', Model_Name: 'Smooth Memory Contour', Style_Code: 'VS-SMC-20', Brand_Buyer: "Victoria's Secret", Size_Category: '36B', Storage_Location: 'Mold Cabinet 03', Operational_Status: 'Available in Room', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-10-28' },
        { Asset_ID: 'VS-PM-02', Tooling_Type: 'Pattern Mold', Model_Name: 'Bombshell Push-Up', Style_Code: 'VS-BSH-21', Brand_Buyer: "Victoria's Secret", Size_Category: '32C', Storage_Location: 'Mold Cabinet 04', Operational_Status: 'Inspection Flagged', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-10-26' },
        { Asset_ID: 'LL-PB-01', Tooling_Type: 'Pattern Block', Model_Name: 'Energy Longline', Style_Code: 'W2AS4S', Brand_Buyer: 'Lululemon', Size_Category: 'S', Storage_Location: 'Rack C-01', Operational_Status: 'Available in Room', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-10-24' },
        { Asset_ID: 'LL-PB-02', Tooling_Type: 'Pattern Block', Model_Name: 'Align Wirefree', Style_Code: 'W2BL8S', Brand_Buyer: 'Lululemon', Size_Category: 'M', Storage_Location: 'Rack C-02', Operational_Status: 'Active on Line', Borrowed_By_ID: 'CW-L3-CMO-01', Shift_Checkout: 'Morning', Checkout_Time: new Date(Date.now() - 3000000).toISOString(), Last_Used_Date: '2026-10-28' },
        { Asset_ID: 'LL-PM-01', Tooling_Type: 'Pattern Mold', Model_Name: 'Like a Cloud', Style_Code: 'W2CC1S', Brand_Buyer: 'Lululemon', Size_Category: 'M', Storage_Location: 'Mold Cabinet 01', Operational_Status: 'Available in Room', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-10-20' },
        { Asset_ID: 'LL-PM-02', Tooling_Type: 'Pattern Mold', Model_Name: 'Free to Be', Style_Code: 'W2DW3S', Brand_Buyer: 'Lululemon', Size_Category: 'L', Storage_Location: 'Mold Cabinet 02', Operational_Status: 'Available in Room', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-10-28' },
        { Asset_ID: 'NK-PB-01', Tooling_Type: 'Pattern Block', Model_Name: 'Swoosh Medium-Support', Style_Code: 'BV3636', Brand_Buyer: 'Nike', Size_Category: 'M', Storage_Location: 'Rack D-01', Operational_Status: 'Available in Room', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-10-28' },
        { Asset_ID: 'NK-PB-02', Tooling_Type: 'Pattern Block', Model_Name: 'Indy Light-Support', Style_Code: 'CZ4456', Brand_Buyer: 'Nike', Size_Category: 'S', Storage_Location: 'Rack D-02', Operational_Status: 'Available in Room', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-10-22' },
        { Asset_ID: 'NK-PM-01', Tooling_Type: 'Pattern Mold', Model_Name: 'Alpha High-Support', Style_Code: 'AJ0340', Brand_Buyer: 'Nike', Size_Category: 'L', Storage_Location: 'Mold Cabinet 03', Operational_Status: 'Available in Room', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2026-10-28' },
        { Asset_ID: 'NK-PM-02', Tooling_Type: 'Pattern Mold', Model_Name: 'Rival Molded Cup', Style_Code: 'AQ4184', Brand_Buyer: 'Nike', Size_Category: 'XL', Storage_Location: 'Mold Cabinet 04', Operational_Status: 'Decommissioned', Borrowed_By_ID: null, Shift_Checkout: null, Checkout_Time: null, Last_Used_Date: '2025-11-15' }
    ],
    CAD_Markers: [
        { CAD_Marker_ID: 'CAD-MK-01', Style_Code: 'TR-TAC-01', Brand_Buyer: 'Triumph', Model_Name: 'Triaction Control', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-01', CAD_Tooling_Material_Code: 'MAT-CRD-01', Cutting_Floor_Fabric_Code: 'FAB-TR-01' },
        { CAD_Marker_ID: 'CAD-MK-02', Style_Code: 'TR-BMU-02', Brand_Buyer: 'Triumph', Model_Name: 'Body Make-Up', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-02', CAD_Tooling_Material_Code: 'MAT-CRD-01', Cutting_Floor_Fabric_Code: 'FAB-TR-02' },
        { CAD_Marker_ID: 'CAD-MK-03', Style_Code: 'TR-AMC-01', Brand_Buyer: 'Triumph', Model_Name: 'Amourette Charm', Design_Coordinator_ID: 'DDC-C-02', CAD_Handler_ID: 'CAD-C-CPH-01', CAD_Tooling_Material_Code: 'MAT-PLS-01', Cutting_Floor_Fabric_Code: 'FAB-TR-01' },
        { CAD_Marker_ID: 'CAD-MK-04', Style_Code: 'TR-MTR-02', Brand_Buyer: 'Triumph', Model_Name: 'Modal Triangle', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-02', CAD_Tooling_Material_Code: 'MAT-PLS-01', Cutting_Floor_Fabric_Code: 'FAB-TR-02' },
        { CAD_Marker_ID: 'CAD-MK-05', Style_Code: 'VS-BBV-10', Brand_Buyer: "Victoria's Secret", Model_Name: 'Body by Victoria', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-02', CAD_Tooling_Material_Code: 'MAT-CRD-01', Cutting_Floor_Fabric_Code: 'FAB-VS-01' },
        { CAD_Marker_ID: 'CAD-MK-06', Style_Code: 'VS-DAD-11', Brand_Buyer: "Victoria's Secret", Model_Name: 'Dream Angels Demi', Design_Coordinator_ID: 'DDC-C-02', CAD_Handler_ID: 'CAD-C-CPH-01', CAD_Tooling_Material_Code: 'MAT-CRD-01', Cutting_Floor_Fabric_Code: 'FAB-VS-02' },
        { CAD_Marker_ID: 'CAD-MK-07', Style_Code: 'VS-SMC-20', Brand_Buyer: "Victoria's Secret", Model_Name: 'Smooth Memory Contour', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-01', CAD_Tooling_Material_Code: 'MAT-PLS-01', Cutting_Floor_Fabric_Code: 'FAB-VS-01' },
        { CAD_Marker_ID: 'CAD-MK-08', Style_Code: 'VS-BSH-21', Brand_Buyer: "Victoria's Secret", Model_Name: 'Bombshell Push-Up', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-02', CAD_Tooling_Material_Code: 'MAT-PLS-01', Cutting_Floor_Fabric_Code: 'FAB-VS-02' },
        { CAD_Marker_ID: 'CAD-MK-09', Style_Code: 'W2AS4S', Brand_Buyer: 'Lululemon', Model_Name: 'Energy Longline', Design_Coordinator_ID: 'DDC-C-02', CAD_Handler_ID: 'CAD-C-CPH-01', CAD_Tooling_Material_Code: 'MAT-CRD-01', Cutting_Floor_Fabric_Code: 'FAB-LL-01' },
        { CAD_Marker_ID: 'CAD-MK-10', Style_Code: 'W2BL8S', Brand_Buyer: 'Lululemon', Model_Name: 'Align Wirefree', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-01', CAD_Tooling_Material_Code: 'MAT-CRD-01', Cutting_Floor_Fabric_Code: 'FAB-LL-02' },
        { CAD_Marker_ID: 'CAD-MK-11', Style_Code: 'W2CC1S', Brand_Buyer: 'Lululemon', Model_Name: 'Like a Cloud', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-02', CAD_Tooling_Material_Code: 'MAT-PLS-01', Cutting_Floor_Fabric_Code: 'FAB-LL-01' },
        { CAD_Marker_ID: 'CAD-MK-12', Style_Code: 'W2DW3S', Brand_Buyer: 'Lululemon', Model_Name: 'Free to Be', Design_Coordinator_ID: 'DDC-C-02', CAD_Handler_ID: 'CAD-C-CPH-01', CAD_Tooling_Material_Code: 'MAT-PLS-01', Cutting_Floor_Fabric_Code: 'FAB-LL-02' },
        { CAD_Marker_ID: 'CAD-MK-13', Style_Code: 'BV3636', Brand_Buyer: 'Nike', Model_Name: 'Swoosh Medium-Support', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-01', CAD_Tooling_Material_Code: 'MAT-CRD-01', Cutting_Floor_Fabric_Code: 'FAB-NK-01' },
        { CAD_Marker_ID: 'CAD-MK-14', Style_Code: 'CZ4456', Brand_Buyer: 'Nike', Model_Name: 'Indy Light-Support', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-02', CAD_Tooling_Material_Code: 'MAT-CRD-01', Cutting_Floor_Fabric_Code: 'FAB-NK-02' },
        { CAD_Marker_ID: 'CAD-MK-15', Style_Code: 'AJ0340', Brand_Buyer: 'Nike', Model_Name: 'Alpha High-Support', Design_Coordinator_ID: 'DDC-C-02', CAD_Handler_ID: 'CAD-C-CPH-01', CAD_Tooling_Material_Code: 'MAT-PLS-01', Cutting_Floor_Fabric_Code: 'FAB-NK-01' },
        { CAD_Marker_ID: 'CAD-MK-16', Style_Code: 'AQ4184', Brand_Buyer: 'Nike', Model_Name: 'Rival Molded Cup', Design_Coordinator_ID: 'DDC-C-01', CAD_Handler_ID: 'CAD-C-CPH-01', CAD_Tooling_Material_Code: 'MAT-PLS-01', Cutting_Floor_Fabric_Code: 'FAB-NK-02' }
    ],
    RMW_Materials: [
        { Material_Code: 'MAT-CRD-01', Material_Category: 'CAD Tooling Material', Material_Name_Specs: 'Heavy Kraft Pattern Cardboard (350 GSM Calendered)', Target_Brand_Usage: 'CAD Pattern Blocks', RMW_Storage_Bay: 'RMW-Bay-T1', Managed_By_RMW_ID: 'RMWC-C-01', Lot_Status: 'Dispatched to CAD Room' },
        { Material_Code: 'MAT-PLS-01', Material_Category: 'CAD Tooling Material', Material_Name_Specs: 'ABS Thermo-Molding Plastic Resin (3.0mm Polymer)', Target_Brand_Usage: 'CAD 3D Molds', RMW_Storage_Bay: 'RMW-Bay-T2', Managed_By_RMW_ID: 'RMWC-C-02', Lot_Status: 'In Warehouse' },
        { Material_Code: 'FAB-TR-01', Material_Category: 'Cutting Floor Fabric', Material_Name_Specs: 'High-Elastane Microfiber Jersey (78% Polyamide, 22% Elastane)', Target_Brand_Usage: 'Triumph', RMW_Storage_Bay: 'RMW-Bay-F1', Managed_By_RMW_ID: 'RMWC-C-03', Lot_Status: 'Dispatched to Line 1' },
        { Material_Code: 'FAB-TR-02', Material_Category: 'Cutting Floor Fabric', Material_Name_Specs: 'Ultra-Fine Brushed Modal Knit (85% Micro-Modal, 15% Elastane)', Target_Brand_Usage: 'Triumph', RMW_Storage_Bay: 'RMW-Bay-F2', Managed_By_RMW_ID: 'RMWC-C-01', Lot_Status: 'In Warehouse' },
        { Material_Code: 'FAB-VS-01', Material_Category: 'Cutting Floor Fabric', Material_Name_Specs: 'Signature Soft-Touch Nylon Tricot (82% Polyamide, 18% Elastane)', Target_Brand_Usage: "Victoria's Secret", RMW_Storage_Bay: 'RMW-Bay-F3', Managed_By_RMW_ID: 'RMWC-C-02', Lot_Status: 'Dispatched to Line 2' },
        { Material_Code: 'FAB-VS-02', Material_Category: 'Cutting Floor Fabric', Material_Name_Specs: 'Engineered Stretch Galloon Lace (88% Nylon, 12% Spandex)', Target_Brand_Usage: "Victoria's Secret", RMW_Storage_Bay: 'RMW-Bay-F4', Managed_By_RMW_ID: 'RMWC-C-03', Lot_Status: 'In Warehouse' },
        { Material_Code: 'FAB-LL-01', Material_Category: 'Cutting Floor Fabric', Material_Name_Specs: 'Interlock Technical Compression (77% Nylon, 23% Lycra Elastane)', Target_Brand_Usage: 'Lululemon', RMW_Storage_Bay: 'RMW-Bay-F5', Managed_By_RMW_ID: 'RMWC-C-01', Lot_Status: 'Dispatched to Line 3' },
        { Material_Code: 'FAB-LL-02', Material_Category: 'Cutting Floor Fabric', Material_Name_Specs: 'Brushed Weightless Double-Knit (81% Nylon, 19% Lycra Elastane)', Target_Brand_Usage: 'Lululemon', RMW_Storage_Bay: 'RMW-Bay-F6', Managed_By_RMW_ID: 'RMWC-C-02', Lot_Status: 'In Warehouse' },
        { Material_Code: 'FAB-NK-01', Material_Category: 'Cutting Floor Fabric', Material_Name_Specs: 'Dri-FIT Compression Recycled Poly (82% Poly, 18% Spandex)', Target_Brand_Usage: 'Nike', RMW_Storage_Bay: 'RMW-Bay-F7', Managed_By_RMW_ID: 'RMWC-C-03', Lot_Status: 'Dispatched to Line 1' },
        { Material_Code: 'FAB-NK-02', Material_Category: 'Cutting Floor Fabric', Material_Name_Specs: 'Ultra-Lightweight AeroVent Mesh (88% Polyester, 12% Spandex)', Target_Brand_Usage: 'Nike', RMW_Storage_Bay: 'RMW-Bay-F8', Managed_By_RMW_ID: 'RMWC-C-01', Lot_Status: 'In Warehouse' }
    ],
    QC_Defect_Codes: [
        { Defect_Code: 'DEF-01', Defect_Name_Symptom: 'Frayed or Torn Cardboard Pattern Block Edge', Fault_Category: 'Pattern Block Fault', Severity_Level: 'High - Asset Lock', Target_Asset_Status: 'Inspection Flagged', Reported_By_Role_ID: 'QCI-C-01', Assigned_Resolver_Role_ID: 'PR-C-PH-01', Mandatory_System_Action: 'Auto-Lock Pattern QR, Flag Asset ID as Inspection Flagged & Request CAD Replacement' },
        { Defect_Code: 'DEF-02', Defect_Name_Symptom: 'Warped or Cracked 3D Plastic Pattern Mold', Fault_Category: '3D Mold Fault', Severity_Level: 'Critical - Halts Line', Target_Asset_Status: 'Pending Removal', Reported_By_Role_ID: 'QCI-C-02', Assigned_Resolver_Role_ID: 'CAD-C-CPH-01', Mandatory_System_Action: 'Auto-Lock Mold QR, Flag Asset ID as Pending Removal & Dispatch Tooling Request' },
        { Defect_Code: 'DEF-03', Defect_Name_Symptom: 'Lectra Cutter Blade Drift & Kerf Misalignment', Fault_Category: 'Lectra Machine Fault', Severity_Level: 'Critical - Halts Line', Target_Asset_Status: 'Active on Line (No Lock)', Reported_By_Role_ID: 'QCI-C-03', Assigned_Resolver_Role_ID: 'CS-L1-01', Mandatory_System_Action: 'Halt Lectra Cutting Head, Fire Re-Cut Ticket to Supervisor & Pause Auto-Conveyor' },
        { Defect_Code: 'DEF-04', Defect_Name_Symptom: 'Fabric Spreading Layer Tension Slippage & Distortion', Fault_Category: 'Spreading Fault', Severity_Level: 'Medium - Batch Re-Cut', Target_Asset_Status: 'Active on Line (No Lock)', Reported_By_Role_ID: 'QCI-C-01', Assigned_Resolver_Role_ID: 'CS-L2-01', Mandatory_System_Action: 'Fire Re-Cut Ticket to Supervisor, Log Ply Defect & Re-assign Fabric Spreader' },
        { Defect_Code: 'DEF-05', Defect_Name_Symptom: 'Fabric Roll End-to-End Shade Variation & Fiber Slubs', Fault_Category: 'RMW Fabric Fault', Severity_Level: 'High - Asset Lock', Target_Asset_Status: 'Active on Line (No Lock)', Reported_By_Role_ID: 'CQCE-01', Assigned_Resolver_Role_ID: 'RMWC-C-01', Mandatory_System_Action: 'Quarantine Fabric Lot, Request RMW Replacement Roll & Hold Cutting Order' },
        { Defect_Code: 'DEF-06', Defect_Name_Symptom: 'CAD Marker Grading Mismatch & Overlapping Cut Lines', Fault_Category: 'CAD Marker Fault', Severity_Level: 'Critical - Halts Line', Target_Asset_Status: 'Active on Line (No Lock)', Reported_By_Role_ID: 'QCI-C-02', Assigned_Resolver_Role_ID: 'CAD-C-MM-01', Mandatory_System_Action: 'Hold Style Code, Flag CAD Marker for Re-Grading & Alert CAD Coordinator' },
        { Defect_Code: 'DEF-07', Defect_Name_Symptom: 'Bundle Ticket Missing Ply Sequential Notch Numbering', Fault_Category: 'Bundling Fault', Severity_Level: 'Low - Warning Only', Target_Asset_Status: 'Active on Line (No Lock)', Reported_By_Role_ID: 'QCI-C-03', Assigned_Resolver_Role_ID: 'CS-L3-01', Mandatory_System_Action: 'Quarantine Cut Plies, Route Bundle for Hand Trimming & Alert Bundling Lead' },
        { Defect_Code: 'DEF-08', Defect_Name_Symptom: 'Delaminated Base Plate on High-Compression Contour Mold', Fault_Category: '3D Mold Fault', Severity_Level: 'High - Asset Lock', Target_Asset_Status: 'Decommissioned', Reported_By_Role_ID: 'QCI-C-01', Assigned_Resolver_Role_ID: 'CAD-C-CPH-02', Mandatory_System_Action: 'Lock Pattern QR in Tool Crib, Flag Asset ID as Decommissioned & Trigger Mold Recasting' },
        { Defect_Code: 'DEF-09', Defect_Name_Symptom: 'Vacuum Table Pressure Loss & Cut Ply Shifting', Fault_Category: 'Lectra Machine Fault', Severity_Level: 'Critical - Halts Line', Target_Asset_Status: 'Active on Line (No Lock)', Reported_By_Role_ID: 'CQCE-01', Assigned_Resolver_Role_ID: 'CS-L1-01', Mandatory_System_Action: 'Dispatch Emergency Maintenance Ticket, Lock Cutter ID & Alert Shift Lead' },
        { Defect_Code: 'DEF-10', Defect_Name_Symptom: 'Woven Selvage Bowing & Bias Distortions Across Spread', Fault_Category: 'RMW Fabric Fault', Severity_Level: 'Medium - Batch Re-Cut', Target_Asset_Status: 'Active on Line (No Lock)', Reported_By_Role_ID: 'QCI-C-02', Assigned_Resolver_Role_ID: 'RMWC-C-02', Mandatory_System_Action: 'Log Fabric Shading Ticket, Request Replacement Roll from RMW & Notify Lead Inspector' }
    ],
    Shift_Assignments: [
        { Assignment_ID: 101, Borrower_ID: 'CW-L1-CMO-01', Supervisor_ID: 'CS-L1-01', Assigned_Date: new Date().toISOString().split('T')[0], Shift_Type: 'Morning', Production_Line: 'Line 1' },
        { Assignment_ID: 102, Borrower_ID: 'CW-L1-CMO-02', Supervisor_ID: 'CS-L1-01', Assigned_Date: new Date().toISOString().split('T')[0], Shift_Type: 'Morning', Production_Line: 'Line 1' },
        { Assignment_ID: 103, Borrower_ID: 'CW-L2-CMO-01', Supervisor_ID: 'CS-L2-01', Assigned_Date: new Date().toISOString().split('T')[0], Shift_Type: 'Morning', Production_Line: 'Line 2' },
        { Assignment_ID: 104, Borrower_ID: 'CW-L3-CMO-01', Supervisor_ID: 'CS-L3-01', Assigned_Date: new Date().toISOString().split('T')[0], Shift_Type: 'Morning', Production_Line: 'Line 3' },
        { Assignment_ID: 105, Borrower_ID: 'CW-L1-FS-01', Supervisor_ID: 'CS-L1-01', Assigned_Date: new Date().toISOString().split('T')[0], Shift_Type: 'Afternoon', Production_Line: 'Line 1' }
    ],
    Pending_Requests: [
        { Request_ID: 201, Borrower_ID: 'CW-L2-CMO-02', Pattern_ID: 'VS-PB-01', Requested_Shift: 'Morning', Requested_Date: new Date().toISOString().split('T')[0], Request_Time: new Date().toLocaleTimeString(), Request_Status: 'Pending' }
    ],
    Cutting_Orders: [
        { Order_ID: 'ORD-101', Style_Code: 'TR-TAC-01', Sewing_Coordinator_ID: 'SDC-C-01', Approved_By_Exec_ID: 'CSE-01', Target_Size: '34C', Target_Bundle_Qty: 1400, Priority_Level: 'Urgent', Assigned_Line: 'Line 1', Order_Status: 'Active on Line' },
        { Order_ID: 'ORD-102', Style_Code: 'VS-BBV-10', Sewing_Coordinator_ID: 'SDC-C-02', Approved_By_Exec_ID: 'CSE-01', Target_Size: '34B', Target_Bundle_Qty: 1850, Priority_Level: 'Normal', Assigned_Line: 'Line 2', Order_Status: 'Queued' },
        { Order_ID: 'ORD-103', Style_Code: 'W2BL8S', Sewing_Coordinator_ID: 'SDC-C-01', Approved_By_Exec_ID: 'CSE-01', Target_Size: 'M', Target_Bundle_Qty: 950, Priority_Level: 'Urgent', Assigned_Line: 'Line 3', Order_Status: 'Active on Line' }
    ],
    QC_Inspection_Logs: [
        { QC_Log_ID: 'QCL-501', Asset_ID: 'VS-PM-02', Defect_Code: 'DEF-01', Inspector_ID: 'QCI-C-01', Resolver_ID: 'PR-C-PH-01', Production_Line: 'Line 2', Ruined_Ply_Count: 28, Logged_Timestamp: '2026-10-28 09:40:00', Resolution_Status: 'Open - Asset Locked' },
        { QC_Log_ID: 'QCL-502', Asset_ID: 'TR-PB-01', Defect_Code: 'DEF-03', Inspector_ID: 'QCI-C-03', Resolver_ID: 'CS-L1-01', Production_Line: 'Line 1', Ruined_Ply_Count: 42, Logged_Timestamp: '2026-10-28 10:15:00', Resolution_Status: 'Re-Cut Dispatched' },
        { QC_Log_ID: 'QCL-503', Asset_ID: 'NK-PM-02', Defect_Code: 'DEF-08', Inspector_ID: 'QCI-C-01', Resolver_ID: 'CAD-C-CPH-02', Production_Line: 'Line 3', Ruined_Ply_Count: 15, Logged_Timestamp: '2026-10-25 14:20:00', Resolution_Status: 'Decommissioned' }
    ],
    System_Settings_Audit: [
        { Record_ID: 1, Record_Type: 'PARAMETER', Category: 'Brand', Setting_Value: 'Triumph', Prefix_Data: 'TR', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 2, Record_Type: 'PARAMETER', Category: 'Brand', Setting_Value: "Victoria's Secret", Prefix_Data: 'VS', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 3, Record_Type: 'PARAMETER', Category: 'Brand', Setting_Value: 'Lululemon', Prefix_Data: 'LL', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 4, Record_Type: 'PARAMETER', Category: 'Brand', Setting_Value: 'Nike', Prefix_Data: 'NK', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 5, Record_Type: 'PARAMETER', Category: 'Size', Setting_Value: '32C', Prefix_Data: '', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 6, Record_Type: 'PARAMETER', Category: 'Size', Setting_Value: '34B', Prefix_Data: '', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 7, Record_Type: 'PARAMETER', Category: 'Size', Setting_Value: '34C', Prefix_Data: '', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 8, Record_Type: 'PARAMETER', Category: 'Size', Setting_Value: '36C', Prefix_Data: '', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 9, Record_Type: 'PARAMETER', Category: 'Size', Setting_Value: 'S', Prefix_Data: '', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 10, Record_Type: 'PARAMETER', Category: 'Size', Setting_Value: 'M', Prefix_Data: '', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 11, Record_Type: 'PARAMETER', Category: 'Size', Setting_Value: 'L', Prefix_Data: '', Requested_By_ID: 'DT-C-CA-01', Request_Status: 'Active', Created_At: '2026-10-01 08:00' },
        { Record_ID: 12, Record_Type: 'PARAM_REQUEST', Category: 'Brand', Setting_Value: 'Add Brand: Lindex (LDX) / Review Nike Hold', Prefix_Data: 'LDX', Requested_By_ID: 'DDC-C-01', Request_Status: 'Pending Admin Approval', Created_At: '2026-10-28 09:15' },
        { Record_ID: 13, Record_Type: 'AUDIT_LOG', Category: 'System', Setting_Value: 'CDMS+ Core Initialized with 85 Staff & 16 Tooling Assets', Prefix_Data: 'BOOT', Requested_By_ID: 'CDTE-01', Request_Status: 'Logged', Created_At: '2026-10-28 08:00' }
    ]
};

function getDB() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_DB));
        return JSON.parse(JSON.stringify(INITIAL_DB));
    }
    return JSON.parse(raw);
}

function saveDB(db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function logAudit(category, actionType, detail, userId = 'SYSTEM') {
    const db = getDB();
    db.System_Settings_Audit.unshift({
        Record_ID: Date.now(),
        Record_Type: 'AUDIT_LOG',
        Category: category,
        Setting_Value: `${actionType}: ${detail}`,
        Prefix_Data: actionType,
        Requested_By_ID: userId,
        Request_Status: 'Logged',
        Created_At: new Date().toLocaleString()
    });
    saveDB(db);
}

function resetDemoDatabase() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_DB));
    showToast('Demo Database Restored to Clean Factory Defaults!');
    renderAdminPortal();
}

// ============================================================================
// 2. BOOT, LIVE CLOCK & 5-MINUTE UNFINISHED PROCEDURE IDLE RESET
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    getDB();
    setInterval(() => {
        const el = document.getElementById('current-time-display');
        if (el) el.innerText = new Date().toLocaleTimeString('en-US', { hour12: false });
    }, 1000);

    // Reset 5-minute procedure idle timer whenever user clicks or types
    ['click', 'keydown', 'mousemove'].forEach(evt => {
        document.addEventListener(evt, () => { idleSecondsRemaining = 300; });
    });

    idleInterval = setInterval(() => {
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
            showToast('5-Minute Procedure Timeout: Unfinished action cleared. Please resubmit.', 'error');
        }
    }, 1000);
});

function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    const style = type === 'error'
        ? 'bg-rose-950 border-rose-500 text-rose-100'
        : 'bg-neutral-900 border-blue-500 text-blue-100';
    t.className = `fixed top-5 right-5 ${style} border px-5 py-3.5 rounded-xl shadow-2xl z-[120] fade-in font-mono text-xs flex items-center gap-3`;
    t.innerHTML = `<i class="ph-fill ${type === 'error' ? 'ph-warning-octagon text-rose-400' : 'ph-check-circle text-blue-400'} text-lg"></i> <span>${msg}</span>`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// ============================================================================
// 3. VIVA BYPASS PADLOCK & DYNAMIC ROLE ICON LOGIN
// ============================================================================
function toggleVivaPadlock() {
    vivaBypassUnlocked = !vivaBypassUnlocked;
    const btn = document.getElementById('viva-padlock-btn');
    const icon = document.getElementById('viva-padlock-icon');
    const txt = document.getElementById('viva-padlock-text');
    const helper = document.getElementById('viva-login-helper');

    if (vivaBypassUnlocked) {
        btn.className = 'flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-500 bg-amber-950/50 text-xs font-mono uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)]';
        icon.className = 'ph-fill ph-lock-key-open text-amber-400 text-base';
        txt.className = 'text-amber-300 font-bold';
        txt.innerText = 'Viva Bypass: Unlocked';
        if (helper) helper.classList.remove('hidden');
        showToast('Viva Testing Padlock UNLOCKED: 1-Click Role Simulator Enabled.');
    } else {
        btn.className = 'flex items-center gap-2 px-4 py-2 rounded-lg border border-neutral-800 bg-neutral-900 text-xs font-mono uppercase tracking-widest transition-all';
        icon.className = 'ph-fill ph-lock-key text-neutral-400 text-base';
        txt.className = 'text-neutral-400';
        txt.innerText = 'Viva Bypass: Locked';
        if (helper) helper.classList.add('hidden');
        showToast('Viva Testing Padlock LOCKED: Standard Password Auth Required.');
    }
}

function openUserLoginModal() {
    document.getElementById('user-login-modal').classList.remove('hidden');
    const helper = document.getElementById('viva-login-helper');
    if (vivaBypassUnlocked) {
        helper.classList.remove('hidden');
        onVivaRoleChange();
    } else {
        helper.classList.add('hidden');
    }
}

function onVivaRoleChange() {
    const val = document.getElementById('viva-role-dropdown').value;
    morphDepartmentIconOnType(val);
}

function vivaSimulateEnterId() {
    const val = document.getElementById('viva-role-dropdown').value;
    document.getElementById('login-emp-id').value = val;
    morphDepartmentIconOnType(val);
    showToast(`Simulated Employee ID Entry: ${val}`);
}

function vivaSimulateEnterPass() {
    document.getElementById('login-emp-pass').value = 'bodyline123';
    showToast('Simulated Password Verification.');
}

// DECORATIVE REQUIREMENT: MORPH SYSTEM ICON AS USER TYPES EMPLOYEE ID
function morphDepartmentIconOnType(rawId) {
    const code = (rawId || '').trim().toUpperCase();
    const box = document.getElementById('login-dept-icon-box');
    const icon = document.getElementById('login-dept-icon');
    const badge = document.getElementById('login-dept-badge');

    let cfg = { icon: 'ph-identification-badge', color: 'blue', label: 'Awaiting Valid Department Prefix...' };
    if (code.startsWith('DH') || code.startsWith('CSE')) {
        cfg = { icon: 'ph-crown', color: 'amber', label: 'Executive Leadership • CD Operations Office' };
    } else if (code.startsWith('CS-')) {
        cfg = { icon: 'ph-shield-star', color: 'amber', label: 'Cutting Floor Supervisor • Shift Command' };
    } else if (code.startsWith('DDC')) {
        cfg = { icon: 'ph-paint-brush-broad', color: 'purple', label: 'Design Department Coordinator' };
    } else if (code.startsWith('CAD')) {
        cfg = { icon: 'ph-compass-tool', color: 'purple', label: 'CAD Room • Markers & Tooling' };
    } else if (code.startsWith('PR-')) {
        cfg = { icon: 'ph-qr-code', color: 'emerald', label: 'Pattern Room • Block & Mold Library' };
    } else if (code.startsWith('SDC')) {
        cfg = { icon: 'ph-scissors', color: 'rose', label: 'Sewing Department Coordinator' };
    } else if (code.startsWith('RMW')) {
        cfg = { icon: 'ph-warehouse', color: 'cyan', label: 'Raw Material Warehouse (RMW)' };
    } else if (code.startsWith('CQC') || code.startsWith('QCI')) {
        cfg = { icon: 'ph-warning-octagon', color: 'rose', label: 'Quality Control (QC) Inspection' };
    } else if (code.startsWith('CDTE') || code.startsWith('DT-')) {
        cfg = { icon: 'ph-terminal-window', color: 'blue', label: 'Digital Team • Root CDMS+ Admin' };
    } else if (code.startsWith('CW-')) {
        cfg = { icon: 'ph-users-three', color: 'emerald', label: 'Cutting Floor Operator (Use Pattern Room Terminal)' };
    }

    icon.className = `ph-fill ${cfg.icon} text-3xl`;
    badge.innerText = cfg.label;
    box.className = `w-16 h-16 rounded-2xl bg-${cfg.color}-600/20 border-2 border-${cfg.color}-500 flex items-center justify-center text-${cfg.color}-400 mb-3 transition-all duration-300`;
}

function executeDepartmentLogin() {
    const db = getDB();
    let empId = document.getElementById('login-emp-id').value.trim().toUpperCase();
    const pass = document.getElementById('login-emp-pass').value;

    if (vivaBypassUnlocked && !empId) {
        empId = document.getElementById('viva-role-dropdown').value;
    }
    const emp = db.Employees.find(e => e.Employee_ID.toUpperCase() === empId);
    if (!emp) return showToast('Employee ID not found in Bodyline Roster.', 'error');
    if (!vivaBypassUnlocked && !pass) return showToast('Please enter your password (or unlock Viva Padlock).', 'error');

    currentLoggedInUser = emp;
    currentMode = 'portal';
    closeModal('user-login-modal');

    document.getElementById('view-gateway').classList.add('hidden');
    document.getElementById('main-header').classList.remove('hidden');
    document.getElementById('portal-nav-tabs').classList.remove('hidden');
    document.getElementById('active-user-badge').innerText = `${emp.Employee_ID} • ${emp.Full_Name} (${emp.Role_Designation})`;

    // Route straight to their primary department screen
    if (emp.Employee_ID.startsWith('CS-') || emp.Employee_ID === 'CSE-01') switchPortalView('supervisor');
    else if (emp.Employee_ID.startsWith('DDC') || emp.Employee_ID.startsWith('CAD') || emp.Employee_ID.startsWith('PR-')) switchPortalView('design-cad');
    else if (emp.Employee_ID.startsWith('SDC') || emp.Employee_ID.startsWith('RMW')) switchPortalView('supply');
    else if (emp.Employee_ID.startsWith('CQC') || emp.Employee_ID.startsWith('QCI')) switchPortalView('qc');
    else switchPortalView('admin');

    logAudit('Auth', 'USER_LOGIN', `${emp.Full_Name} (${emp.Employee_ID}) signed in`, emp.Employee_ID);
    showToast(`Welcome, ${emp.Full_Name} (${emp.Role_Designation})`);
}

// ============================================================================
// 4. DIGITAL PATTERN ROOM (GENERAL FLOOR TERMINAL - STRIPPED ADMIN)
// ============================================================================
function enterDigitalPatternRoom() {
    currentMode = 'terminal';
    currentLoggedInUser = { Employee_ID: 'PR-C-PC-01', Full_Name: 'Floor Pattern Terminal', Role_Designation: 'General Worker Kiosk' };
    document.getElementById('view-gateway').classList.add('hidden');
    document.getElementById('main-header').classList.remove('hidden');
    // Strip Admin & Portal tabs from public floor terminal
    document.getElementById('portal-nav-tabs').classList.add('hidden');
    document.getElementById('active-user-badge').innerText = 'DIGITAL PATTERN ROOM TERMINAL (SHIFT UNLOCKED BY PR-C-PC-01)';
    hideAllMainViews();
    document.getElementById('view-tracker').classList.remove('hidden');
    renderPatternGrid('ALL');
}

function hideAllMainViews() {
    ['view-tracker', 'view-supervisor', 'view-design-cad', 'view-supply', 'view-qc', 'view-admin', 'view-reports'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
}

function switchPortalView(viewKey) {
    hideAllMainViews();
    document.querySelectorAll('.portal-tab').forEach(b => b.classList.remove('active-tab'));
    const navBtn = document.getElementById(`nav-btn-${viewKey}`);
    if (navBtn) navBtn.classList.add('active-tab');

    document.getElementById(`view-${viewKey}`).classList.remove('hidden');
    if (viewKey === 'supervisor') renderSupervisorPortal();
    if (viewKey === 'design-cad') renderDesignCadPortal();
    if (viewKey === 'supply') renderSupplyPortal();
    if (viewKey === 'qc') renderQcPortal();
    if (viewKey === 'admin') renderAdminPortal();
    if (viewKey === 'reports') { switchReportMode('mgmt'); renderGroupedReport(1); }
}

function handleHeaderBack() {
    returnToWelcomeScreen();
}

function triggerCredentialedLogout() {
    if (currentMode === 'terminal' && !vivaBypassUnlocked) {
        const coordId = prompt('Mid-Shift Terminal Logout requires Pattern Coordinator ID (e.g. PR-C-PC-01):', 'PR-C-PC-01');
        if (!coordId) return;
    }
    returnToWelcomeScreen();
    showToast('Session Terminated. Returned to CDMS+ Welcome Screen.');
}

function returnToWelcomeScreen() {
    currentMode = 'gateway';
    currentLoggedInUser = null;
    hideAllMainViews();
    document.getElementById('main-header').classList.add('hidden');
    document.getElementById('view-gateway').classList.remove('hidden');
}

// ============================================================================
// 5. DIGITAL PATTERN ROOM CATALOG & 2-STEP QR CHECKOUT / 15-MIN MUTEX
// ============================================================================
let currentGridFilter = 'ALL';

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
    const db = getDB();
    let list = db.Pattern_Assets;
    if (statusFilter !== 'ALL') {
        list = list.filter(p => p.Operational_Status === statusFilter);
    }
    if (query) {
        list = list.filter(p =>
            p.Asset_ID.toLowerCase().includes(query) ||
            p.Model_Name.toLowerCase().includes(query) ||
            p.Brand_Buyer.toLowerCase().includes(query) ||
            p.Style_Code.toLowerCase().includes(query) ||
            p.Storage_Location.toLowerCase().includes(query)
        );
    }

    const badgeStyle = (st) => {
        if (st === 'Available in Room') return 'bg-emerald-950 text-emerald-300 border-emerald-700';
        if (st === 'Active on Line' || st === 'In Production') return 'bg-blue-950 text-blue-300 border-blue-700';
        if (st.includes('Locked')) return 'bg-amber-950 text-amber-300 border-amber-600 animate-pulse';
        return 'bg-rose-950 text-rose-300 border-rose-700';
    };

    document.getElementById('tracker-grid').innerHTML = list.map(p => `
        <div onclick="openScannerForAsset('${p.Asset_ID}')" class="asset-grid-card bg-neutral-900 rounded-xl p-5 cursor-pointer flex flex-col justify-between h-56">
            <div>
                <div class="flex justify-between items-start gap-2 mb-3">
                    <span class="px-2.5 py-0.5 rounded text-[10px] font-mono uppercase bg-neutral-950 text-neutral-300 border border-neutral-800">${p.Tooling_Type}</span>
                    <span class="px-2.5 py-0.5 rounded text-[10px] font-mono uppercase border ${badgeStyle(p.Operational_Status)}">${p.Operational_Status}</span>
                </div>
                <p class="text-[10px] font-mono uppercase tracking-widest text-emerald-400">${p.Brand_Buyer} • Style ${p.Style_Code}</p>
                <h3 class="font-bold text-base text-white mt-0.5">${p.Model_Name}</h3>
                <p class="font-mono text-xs text-neutral-400 mt-1">Asset ID: <strong class="text-white">${p.Asset_ID}</strong> • Size: <strong class="text-white">${p.Size_Category}</strong></p>
            </div>
            <div class="pt-3 border-t border-neutral-800 flex justify-between items-center font-mono text-xs">
                <span class="text-neutral-400"><i class="ph-fill ph-map-pin text-emerald-400"></i> ${p.Storage_Location}</span>
                <span class="text-emerald-400 font-bold uppercase text-[10px]">Tap to Scan QR &rarr;</span>
            </div>
        </div>
    `).join('');
}

function openQuickScan() {
    currentScanAsset = null;
    document.getElementById('verify-modal').classList.remove('hidden');
    renderScannerStep1();
}

function openScannerForAsset(assetId) {
    const db = getDB();
    currentScanAsset = db.Pattern_Assets.find(a => a.Asset_ID === assetId);
    document.getElementById('verify-modal').classList.remove('hidden');
    renderScannerStep1(assetId);
}

function closeVerifyModal() {
    document.getElementById('verify-modal').classList.add('hidden');
}

function renderScannerStep1(preselectedId = null) {
    const db = getDB();
    const area = document.getElementById('modal-dynamic-area');
    const simBtns = db.Pattern_Assets.map(p => `
        <button onclick="confirmStep1Asset('${p.Asset_ID}')" class="w-full text-left p-2.5 rounded-lg bg-neutral-950 hover:bg-neutral-800 border ${preselectedId === p.Asset_ID ? 'border-emerald-500' : 'border-neutral-800'} font-mono text-xs flex justify-between items-center">
            <span><strong class="text-white">${p.Asset_ID}</strong> • ${p.Model_Name} (${p.Size_Category})</span>
            <span class="text-[10px] text-neutral-400">${p.Operational_Status}</span>
        </button>
    `).join('');

    area.innerHTML = `
        <p class="font-mono text-xs text-emerald-400 uppercase tracking-widest mb-3 text-center">Step 1: Scan Pattern Block or 3D Mold QR Sticker</p>
        <div class="w-full space-y-1.5 max-h-72 overflow-y-auto custom-scroll pr-1">${simBtns}</div>
    `;
}

function confirmStep1Asset(assetId) {
    const db = getDB();
    const asset = db.Pattern_Assets.find(a => a.Asset_ID === assetId);
    currentScanAsset = asset;

    if (asset.Operational_Status === 'Inspection Flagged' || asset.Operational_Status === 'Decommissioned' || asset.Operational_Status === 'Pending Removal') {
        document.getElementById('modal-dynamic-area').innerHTML = `
            <div class="text-center py-6 font-mono">
                <i class="ph-fill ph-prohibit text-5xl text-rose-500 mb-3"></i>
                <h4 class="text-base font-bold text-white uppercase">Asset Locked by Quality Control / Pattern Room</h4>
                <p class="text-xs text-rose-300 mt-2 bg-rose-950/40 border border-rose-800 p-3 rounded">${asset.Asset_ID} (${asset.Model_Name}) is currently marked as "${asset.Operational_Status}" and cannot be checked out to the cutting floor.</p>
                <button onclick="closeVerifyModal()" class="mt-5 w-full bg-neutral-800 text-white py-2.5 rounded uppercase text-xs">Close</button>
            </div>
        `;
        return;
    }

    // If already Active on Line -> Offer 1-Click Return
    if (asset.Operational_Status === 'Active on Line') {
        document.getElementById('modal-dynamic-area').innerHTML = `
            <div class="w-full font-mono text-center py-4">
                <p class="text-xs text-blue-400 uppercase mb-2">Asset Currently Active on Cutting Floor</p>
                <p class="text-lg font-bold text-white">${asset.Asset_ID} • ${asset.Model_Name}</p>
                <p class="text-xs text-neutral-400 mt-1">Checked Out By: <strong class="text-white">${asset.Borrowed_By_ID || 'Floor Operator'}</strong></p>
                <button onclick="executeAssetReturn('${asset.Asset_ID}')" class="mt-6 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg uppercase text-xs tracking-widest">
                    Scan Operator Badge & Confirm Return to ${asset.Storage_Location}
                </button>
            </div>
        `;
        return;
    }

    // Otherwise Step 2: Select / Scan Operator Badge
    const floorOps = db.Employees.filter(e => e.Employee_ID.startsWith('CW-'));
    const todayStr = new Date().toISOString().split('T')[0];

    document.getElementById('modal-dynamic-area').innerHTML = `
        <div class="w-full font-mono">
            <div class="p-3 rounded-lg bg-neutral-950 border border-neutral-800 mb-3 flex justify-between items-center text-xs">
                <span>Target: <strong class="text-emerald-400">${asset.Asset_ID}</strong> (${asset.Model_Name})</span>
                <span class="text-neutral-400">${asset.Storage_Location}</span>
            </div>
            <label class="text-[10px] uppercase text-neutral-400 block mb-1">Target Shift</label>
            <select id="scan-shift-select" class="w-full p-2.5 bg-neutral-950 border border-neutral-800 rounded text-xs text-white mb-3">
                <option value="Morning">Morning [06:00 - 14:00]</option>
                <option value="Afternoon">Afternoon [14:00 - 22:00]</option>
                <option value="Night">Night [22:00 - 06:00]</option>
            </select>
            <p class="text-[10px] uppercase text-blue-400 mb-2">Step 2: Scan Floor Operator Green QR Badge (Click to Simulate):</p>
            <div class="space-y-1.5 max-h-52 overflow-y-auto custom-scroll pr-1">
                ${floorOps.map(op => {
                    const isSched = db.Shift_Assignments.some(s => s.Borrower_ID === op.Employee_ID && s.Assigned_Date === todayStr);
                    return `
                        <button onclick="executeAssetBorrow('${asset.Asset_ID}', '${op.Employee_ID}')" class="w-full text-left p-2.5 rounded bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs flex justify-between items-center">
                            <span><strong class="text-white">${op.Employee_ID}</strong> • ${op.Full_Name}</span>
                            <span class="px-2 py-0.5 rounded text-[9px] ${isSched ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-400 border border-amber-800'}">${isSched ? 'Scheduled Today' : 'Unscheduled (Triggers 15m Lock)'}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function executeAssetBorrow(assetId, operatorId) {
    const db = getDB();
    const asset = db.Pattern_Assets.find(a => a.Asset_ID === assetId);
    const shift = document.getElementById('scan-shift-select').value;
    const todayStr = new Date().toISOString().split('T')[0];

    const isScheduled = db.Shift_Assignments.some(
        s => s.Borrower_ID === operatorId && s.Assigned_Date === todayStr && s.Shift_Type === shift
    );

    if (!isScheduled) {
        // TRIGGER 15-MINUTE MUTEX LOCK & SEND CLEARANCE TICKET TO SUPERVISOR
        asset.Operational_Status = 'Locked_Pending (15m)';
        asset.Borrowed_By_ID = operatorId;
        db.Pending_Requests.unshift({
            Request_ID: Date.now(),
            Borrower_ID: operatorId,
            Pattern_ID: assetId,
            Requested_Shift: shift,
            Requested_Date: todayStr,
            Request_Time: new Date().toLocaleTimeString(),
            Request_Status: 'Pending'
        });
        saveDB(db);
        logAudit('Mutex_Lock', '15M_LOCK_ENGAGED', `Unscheduled operator ${operatorId} requested ${assetId}`, operatorId);
        closeVerifyModal();
        renderPatternGrid(currentGridFilter);
        startMutexBarCountdown(assetId, operatorId, shift);
        showToast(`Unscheduled Shift! ${assetId} locked for 15 mins. Clearance Ticket sent to Supervisor.`, 'error');
        return;
    }

    // AUTHORIZED CHECKOUT
    asset.Operational_Status = 'Active on Line';
    asset.Borrowed_By_ID = operatorId;
    asset.Shift_Checkout = shift;
    asset.Checkout_Time = new Date().toISOString();
    asset.Last_Used_Date = todayStr;
    saveDB(db);
    logAudit('Checkout', 'ASSET_BORROWED', `${assetId} checked out by ${operatorId} for ${shift} shift`, operatorId);
    closeVerifyModal();
    renderPatternGrid(currentGridFilter);
    showToast(`Checkout Approved: ${assetId} is now Active on Line with ${operatorId}.`);
}

function executeAssetReturn(assetId) {
    const db = getDB();
    const asset = db.Pattern_Assets.find(a => a.Asset_ID === assetId);
    const prevOp = asset.Borrowed_By_ID;
    asset.Operational_Status = 'Available in Room';
    asset.Borrowed_By_ID = null;
    asset.Shift_Checkout = null;
    asset.Checkout_Time = null;
    saveDB(db);
    logAudit('Return', 'ASSET_RETURNED', `${assetId} returned to ${asset.Storage_Location} by ${prevOp}`, prevOp);
    closeVerifyModal();
    renderPatternGrid(currentGridFilter);
    showToast(`Return Confirmed: ${assetId} is back in ${asset.Storage_Location}.`);
}

function startMutexBarCountdown(assetId, operatorId, shift) {
    const bar = document.getElementById('mutex-bar');
    const msg = document.getElementById('mutex-msg');
    const timer = document.getElementById('mutex-timer');
    const btn = document.getElementById('mutex-action-btn');

    bar.classList.remove('hidden');
    btn.classList.add('hidden');
    msg.innerText = `15-Min Mutex Lock on ${assetId} (Operator ${operatorId}) — Awaiting Supervisor Grant...`;

    let secs = 900;
    if (mutexPollInterval) clearInterval(mutexPollInterval);
    mutexPollInterval = setInterval(() => {
        secs--;
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        timer.innerText = `${m}:${s}`;

        const db = getDB();
        const req = db.Pending_Requests.find(r => r.Pattern_ID === assetId && r.Borrower_ID === operatorId);
        if (req && req.Request_Status === 'Approved') {
            clearInterval(mutexPollInterval);
            timer.innerText = 'CLEARED';
            msg.innerText = `Supervisor Granted Clearance for ${assetId}! Click Complete Checkout:`;
            btn.classList.remove('hidden');
            btn.onclick = () => {
                executeAssetBorrow(assetId, operatorId);
                bar.classList.add('hidden');
            };
        } else if (req && req.Request_Status === 'Declined') {
            clearInterval(mutexPollInterval);
            timer.innerText = 'DENIED';
            msg.innerText = `Supervisor Denied Request for ${assetId}. Lock Released.`;
            setTimeout(() => bar.classList.add('hidden'), 3000);
        }
    }, 1000);
}

function dismissMutexBar() {
    document.getElementById('mutex-bar').classList.add('hidden');
}

// ============================================================================
// 6. SUPERVISOR COMMAND & 7-DAY TAP-TO-DEPLOY SHIFT CALENDAR
// ============================================================================
function renderSupervisorPortal() {
    const db = getDB();
    const pending = db.Pending_Requests.filter(r => r.Request_Status === 'Pending');
    document.getElementById('ticket-count-badge').innerText = pending.length;

    document.getElementById('supervisor-queue-list').innerHTML = pending.map(r => `
        <div class="p-3 bg-neutral-950 rounded-lg border border-amber-800/60 font-mono text-xs flex flex-col gap-2">
            <div class="flex justify-between">
                <strong class="text-white">${r.Borrower_ID}</strong>
                <span class="text-amber-400">Target: ${r.Pattern_ID} (${r.Requested_Shift})</span>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <button onclick="resolveMutexTicket(${r.Request_ID}, 'Approve')" class="bg-emerald-600 hover:bg-emerald-500 text-white py-1.5 rounded text-[10px] uppercase font-bold">Grant & Schedule</button>
                <button onclick="resolveMutexTicket(${r.Request_ID}, 'Decline')" class="bg-neutral-800 hover:bg-rose-700 text-neutral-300 hover:text-white py-1.5 rounded text-[10px] uppercase font-bold">Deny & Unlock</button>
            </div>
        </div>
    `).join('') || '<p class="text-neutral-500 font-mono text-xs text-center py-8">No pending 15-minute lock tickets.</p>';

    // Active Deployments
    const active = db.Pattern_Assets.filter(p => p.Operational_Status === 'Active on Line');
    document.getElementById('active-deploy-badge').innerText = active.length;
    document.getElementById('supervisor-active-list').innerHTML = active.map(p => `
        <div class="p-3 bg-neutral-950 rounded-lg border border-neutral-800 font-mono text-xs flex justify-between items-center">
            <div>
                <p class="font-bold text-white">${p.Asset_ID} • ${p.Model_Name}</p>
                <p class="text-[10px] text-neutral-400">Operator: <span class="text-blue-400">${p.Borrowed_By_ID || 'CW-L1-CMO-01'}</span> • Shift: ${p.Shift_Checkout || 'Morning'}</p>
            </div>
            <span class="px-2.5 py-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold">04:12:00 Left</span>
        </div>
    `).join('');

    // Operator Pool
    const floorOps = db.Employees.filter(e => e.Employee_ID.startsWith('CW-'));
    document.getElementById('operator-pool').innerHTML = floorOps.map(op => {
        const locked = selectedOperatorForAssign === op.Employee_ID;
        return `
            <div onclick="lockOperatorForCalendar('${op.Employee_ID}')" class="p-2 rounded-lg bg-neutral-950 border ${locked ? 'border-blue-500 bg-blue-950/40' : 'border-neutral-800'} cursor-pointer font-mono text-[11px] hover:border-blue-400">
                <p class="font-bold text-white truncate">${op.Full_Name}</p>
                <p class="text-[10px] text-blue-400">${op.Employee_ID}</p>
            </div>
        `;
    }).join('');

    // 7-Day Calendar Grid
    const grid = document.getElementById('calendar-grid');
    const shifts = ['Morning', 'Afternoon', 'Night'];
    let colsHtml = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        colsHtml += `<div class="flex flex-col gap-2 bg-neutral-950 p-2.5 rounded-xl border border-neutral-800">
            <div class="text-center font-mono text-xs font-bold text-white border-b border-neutral-800 pb-1.5">${dayLabel}</div>
            ${shifts.map(sh => {
                const assigned = db.Shift_Assignments.filter(a => a.Assigned_Date === dateStr && a.Shift_Type === sh);
                return `
                    <div onclick="tapDeployShift('${dateStr}', '${sh}')" class="min-h-[84px] p-2 rounded-lg bg-neutral-900/90 border border-dashed border-neutral-700 hover:border-blue-500 cursor-pointer flex flex-col gap-1">
                        <span class="text-[9px] font-mono uppercase text-neutral-400">${sh} Shift</span>
                        ${assigned.map(a => `
                            <div class="px-2 py-1 rounded bg-blue-950/80 border border-blue-700/60 font-mono text-[10px] text-white flex justify-between items-center">
                                <span>${a.Borrower_ID}</span>
                                <button onclick="removeShiftSlot(${a.Assignment_ID}); event.stopPropagation();" class="text-neutral-400 hover:text-rose-400">&times;</button>
                            </div>
                        `).join('')}
                    </div>
                `;
            }).join('')}
        </div>`;
    }
    grid.innerHTML = colsHtml;
}

function lockOperatorForCalendar(empId) {
    selectedOperatorForAssign = selectedOperatorForAssign === empId ? null : empId;
    document.getElementById('selected-op-indicator').innerText = selectedOperatorForAssign ? `Locked: ${selectedOperatorForAssign}` : 'None Locked';
    renderSupervisorPortal();
}

function tapDeployShift(dateStr, shiftType) {
    if (!selectedOperatorForAssign) return showToast('Click an Operator in the Pool first to lock onto them!', 'error');
    const db = getDB();
    const exists = db.Shift_Assignments.some(a => a.Borrower_ID === selectedOperatorForAssign && a.Assigned_Date === dateStr && a.Shift_Type === shiftType);
    if (!exists) {
        db.Shift_Assignments.push({
            Assignment_ID: Date.now(),
            Borrower_ID: selectedOperatorForAssign,
            Supervisor_ID: currentLoggedInUser ? currentLoggedInUser.Employee_ID : 'CS-L1-01',
            Assigned_Date: dateStr,
            Shift_Type: shiftType,
            Production_Line: 'Line 1'
        });
        saveDB(db);
        logAudit('Shift', 'SHIFT_ASSIGNED', `${selectedOperatorForAssign} deployed to ${shiftType} on ${dateStr}`, 'CS-L1-01');
        renderSupervisorPortal();
        showToast(`Deployed ${selectedOperatorForAssign} to ${shiftType} (${dateStr})`);
    }
}

function removeShiftSlot(id) {
    const db = getDB();
    db.Shift_Assignments = db.Shift_Assignments.filter(a => a.Assignment_ID !== id);
    saveDB(db);
    renderSupervisorPortal();
}

function resolveMutexTicket(reqId, decision) {
    const db = getDB();
    const req = db.Pending_Requests.find(r => r.Request_ID === reqId);
    if (!req) return;
    const asset = db.Pattern_Assets.find(a => a.Asset_ID === req.Pattern_ID);

    if (decision === 'Approve') {
        req.Request_Status = 'Approved';
        db.Shift_Assignments.push({
            Assignment_ID: Date.now(),
            Borrower_ID: req.Borrower_ID,
            Supervisor_ID: 'CS-L1-01',
            Assigned_Date: req.Requested_Date,
            Shift_Type: req.Requested_Shift,
            Production_Line: 'Line 1'
        });
        if (asset) {
            asset.Operational_Status = 'Active on Line';
            asset.Borrowed_By_ID = req.Borrower_ID;
            asset.Shift_Checkout = req.Requested_Shift;
        }
        showToast(`Granted Clearance to ${req.Borrower_ID} for ${req.Pattern_ID}`);
    } else {
        req.Request_Status = 'Declined';
        if (asset) {
            asset.Operational_Status = 'Available in Room';
            asset.Borrowed_By_ID = null;
        }
        showToast(`Denied Clearance for ${req.Pattern_ID}. Asset Unlocked.`, 'error');
    }
    saveDB(db);
    renderSupervisorPortal();
}

// ============================================================================
// 7. DESIGN, CAD & PATTERN ROOM HUB
// ============================================================================
function renderDesignCadPortal() {
    const db = getDB();
    const brands = db.System_Settings_Audit.filter(s => s.Record_Type === 'PARAMETER' && s.Category === 'Brand');
    const sizes = db.System_Settings_Audit.filter(s => s.Record_Type === 'PARAMETER' && s.Category === 'Size');
    const fabrics = db.RMW_Materials.filter(m => m.Material_Category === 'Cutting Floor Fabric');

    document.getElementById('cad-brand-select').innerHTML = brands.map(b => `<option value="${b.Setting_Value}">${b.Setting_Value}</option>`).join('');
    document.getElementById('cad-fabric-select').innerHTML = fabrics.map(f => `<option value="${f.Material_Code}">${f.Material_Code} • ${f.Target_Brand_Usage}</option>`).join('');
    document.getElementById('pat-style-select').innerHTML = db.CAD_Markers.map(m => `<option value="${m.Style_Code}">${m.Style_Code} • ${m.Model_Name}</option>`).join('');
    document.getElementById('pat-size-select').innerHTML = sizes.map(s => `<option value="${s.Setting_Value}">${s.Setting_Value}</option>`).join('');

    document.getElementById('cad-markers-mini-list').innerHTML = db.CAD_Markers.map(m => `
        <div class="p-2 rounded bg-neutral-950 border border-neutral-800 flex justify-between items-center">
            <span><strong class="text-purple-400">${m.CAD_Marker_ID}</strong> • Style <strong class="text-white">${m.Style_Code}</strong> (${m.Model_Name})</span>
            <span class="text-neutral-400">${m.CAD_Tooling_Material_Code} + ${m.Cutting_Floor_Fabric_Code}</span>
        </div>
    `).join('');

    const dormant = db.Pattern_Assets.filter(p => p.Operational_Status === 'Pending Removal' || p.Operational_Status === 'Decommissioned');
    document.getElementById('inactive-patterns-alert-box').innerHTML = dormant.map(p => `
        <div class="p-2 rounded bg-rose-950/30 border border-rose-800/60 flex justify-between items-center">
            <span><strong class="text-white">${p.Asset_ID}</strong> (${p.Model_Name}) • Last Used: ${p.Last_Used_Date}</span>
            <span class="text-rose-400 font-bold">${p.Operational_Status}</span>
        </div>
    `).join('');
}

function createStyleAndMarker() {
    const db = getDB();
    const style = document.getElementById('cad-style-code').value.trim().toUpperCase();
    const brand = document.getElementById('cad-brand-select').value;
    const model = document.getElementById('cad-model-name').value.trim();
    const toolMat = document.getElementById('cad-tooling-mat').value;
    const fabCode = document.getElementById('cad-fabric-select').value;

    if (!style || !model) return showToast('Enter Style Code and Model Name.', 'error');
    const mkId = `CAD-MK-${(db.CAD_Markers.length + 1).toString().padStart(2, '0')}`;
    db.CAD_Markers.unshift({
        CAD_Marker_ID: mkId,
        Style_Code: style,
        Brand_Buyer: brand,
        Model_Name: model,
        Design_Coordinator_ID: 'DDC-C-01',
        CAD_Handler_ID: 'CAD-C-CPH-01',
        CAD_Tooling_Material_Code: toolMat,
        Cutting_Floor_Fabric_Code: fabCode
    });
    saveDB(db);
    logAudit('CAD_Design', 'NEW_STYLE_MARKER', `Created ${mkId} for Style ${style} (${model})`, 'DDC-C-01');
    renderDesignCadPortal();
    showToast(`Registered Style ${style} & CAD Marker ${mkId}`);
}

function designAddFabricDirect() {
    const db = getDB();
    const code = document.getElementById('new-fabric-code').value.trim().toUpperCase();
    const specs = document.getElementById('new-fabric-specs').value.trim();
    const brand = document.getElementById('cad-brand-select').value;
    if (!code || !specs) return showToast('Enter both Fabric Code and Composition Specs.', 'error');

    db.RMW_Materials.push({
        Material_Code: code,
        Material_Category: 'Cutting Floor Fabric',
        Material_Name_Specs: specs,
        Target_Brand_Usage: brand,
        RMW_Storage_Bay: `RMW-Bay-F${db.RMW_Materials.length}`,
        Managed_By_RMW_ID: 'RMWC-C-01',
        Lot_Status: 'In Warehouse'
    });
    saveDB(db);
    logAudit('Design_Fabric', 'ADDED_FABRIC_TYPE', `Design added cloth ${code} (${specs})`, 'DDC-C-01');
    renderDesignCadPortal();
    showToast(`Fabric ${code} added directly to RMW Catalog!`);
}

function sendParameterRequestToAdmin() {
    const val = document.getElementById('param-req-val').value.trim();
    if (!val) return showToast('Describe the Brand or Parameter change needed.', 'error');
    const db = getDB();
    db.System_Settings_Audit.unshift({
        Record_ID: Date.now(),
        Record_Type: 'PARAM_REQUEST',
        Category: 'Brand / Parameter',
        Setting_Value: val,
        Prefix_Data: 'REQ',
        Requested_By_ID: 'DDC-C-01',
        Request_Status: 'Pending Admin Approval',
        Created_At: new Date().toLocaleTimeString()
    });
    saveDB(db);
    document.getElementById('param-req-val').value = '';
    logAudit('Request', 'PARAM_REQ_SENT', `Design requested parameter change: ${val}`, 'DDC-C-01');
    showToast('Parameter Request routed to Digital Admin Console!');
}

function registerNewPatternAsset() {
    const db = getDB();
    const id = document.getElementById('pat-asset-id').value.trim().toUpperCase();
    const type = document.getElementById('pat-tooling-type').value;
    const styleCode = document.getElementById('pat-style-select').value;
    const size = document.getElementById('pat-size-select').value;
    const loc = document.getElementById('pat-rack-loc').value.trim() || 'Rack A-05';

    if (!id) return showToast('Enter a valid Asset ID (e.g. TR-PB-09).', 'error');
    const styleObj = db.CAD_Markers.find(m => m.Style_Code === styleCode) || { Model_Name: 'Custom Bra', Brand_Buyer: 'Triumph' };

    db.Pattern_Assets.unshift({
        Asset_ID: id,
        Tooling_Type: type,
        Model_Name: styleObj.Model_Name,
        Style_Code: styleCode,
        Brand_Buyer: styleObj.Brand_Buyer,
        Size_Category: size,
        Storage_Location: loc,
        Operational_Status: 'Available in Room',
        Borrowed_By_ID: null,
        Shift_Checkout: null,
        Checkout_Time: null,
        Last_Used_Date: new Date().toISOString().split('T')[0]
    });
    saveDB(db);
    logAudit('Pattern_Room', 'MINTED_ASSET_QR', `Minted ${type} ${id} at ${loc}`, 'PR-C-PH-01');

    const box = document.getElementById('pattern-qr-preview-box');
    const canvas = document.getElementById('pattern-qr-canvas');
    box.classList.remove('hidden');
    canvas.innerHTML = '';
    document.getElementById('pattern-qr-label-text').innerText = id;
    new QRCode(canvas, { text: id, width: 96, height: 96 });
    showToast(`Minted ${id} & Generated Printable QR Tag!`);
}

function requestCadToolingFromRMW() {
    const mat = document.getElementById('cad-req-mat-code').value;
    const qty = document.getElementById('cad-req-qty').value.trim() || '30 Sheets';
    logAudit('CAD_RMW_Req', 'TOOLING_MATERIAL_REQ', `CAD Handler requested ${qty} of ${mat} from RMW`, 'CAD-C-CPH-01');
    showToast(`Tooling Order for ${mat} (${qty}) sent to RMW Coordinator!`);
}

// ============================================================================
// 8. SEWING ORDERS & RMW WAREHOUSE DISPATCH
// ============================================================================
function renderSupplyPortal() {
    const db = getDB();
    document.getElementById('sew-style-select').innerHTML = db.CAD_Markers.map(m => `<option value="${m.Style_Code}">${m.Style_Code} • ${m.Model_Name}</option>`).join('');

    document.getElementById('sewing-orders-list').innerHTML = db.Cutting_Orders.map(o => `
        <div class="p-3 rounded-lg bg-neutral-950 border border-neutral-800 font-mono text-xs flex justify-between items-center">
            <div>
                <p class="font-bold text-white">${o.Order_ID} • Style ${o.Style_Code} (Size ${o.Target_Size})</p>
                <p class="text-[10px] text-neutral-400">Qty: ${o.Target_Bundle_Qty} bundles • Assigned: ${o.Assigned_Line} • By: ${o.Sewing_Coordinator_ID}</p>
            </div>
            <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-[10px] ${o.Priority_Level === 'Urgent' ? 'bg-rose-950 text-rose-400 border border-rose-800' : 'bg-neutral-800 text-neutral-300'}">${o.Priority_Level}</span>
                <span class="px-2 py-0.5 rounded text-[10px] bg-blue-950 text-blue-300 border border-blue-800">${o.Order_Status}</span>
            </div>
        </div>
    `).join('');

    document.getElementById('rmw-materials-list').innerHTML = db.RMW_Materials.map(m => `
        <div class="p-3 rounded-lg bg-neutral-950 border border-neutral-800 font-mono text-xs flex justify-between items-center gap-3">
            <div>
                <p class="font-bold text-white">${m.Material_Code} • <span class="text-cyan-400">${m.Material_Category}</span></p>
                <p class="text-[11px] text-neutral-300">${m.Material_Name_Specs}</p>
                <p class="text-[10px] text-neutral-500">Bay: ${m.RMW_Storage_Bay} • Usage: ${m.Target_Brand_Usage} • Status: <strong class="text-emerald-400">${m.Lot_Status}</strong></p>
            </div>
            <button onclick="dispatchRmwMaterial('${m.Material_Code}')" class="shrink-0 bg-cyan-600/20 hover:bg-cyan-600 text-cyan-300 hover:text-white border border-cyan-500/40 px-3 py-1.5 rounded text-[10px] uppercase font-bold">
                Dispatch
            </button>
        </div>
    `).join('');
}

function submitSewingOrder() {
    const db = getDB();
    const style = document.getElementById('sew-style-select').value;
    const size = document.getElementById('sew-size').value.trim() || '34B';
    const qty = parseInt(document.getElementById('sew-qty').value) || 1000;
    const prio = document.getElementById('sew-priority').value;

    const ordId = `ORD-${100 + db.Cutting_Orders.length + 1}`;
    db.Cutting_Orders.unshift({
        Order_ID: ordId,
        Style_Code: style,
        Sewing_Coordinator_ID: 'SDC-C-01',
        Approved_By_Exec_ID: 'CSE-01',
        Target_Size: size,
        Target_Bundle_Qty: qty,
        Priority_Level: prio,
        Assigned_Line: 'Line 1',
        Order_Status: 'Queued'
    });
    saveDB(db);
    logAudit('Sewing_Order', 'NEW_CUT_ORDER', `Sewing submitted ${ordId} for ${qty} pcs of ${style}`, 'SDC-C-01');
    renderSupplyPortal();
    showToast(`Cutting Requisition ${ordId} sent to Cutting Senior Executive!`);
}

function dispatchRmwMaterial(matCode) {
    const db = getDB();
    const mat = db.RMW_Materials.find(m => m.Material_Code === matCode);
    if (!mat) return;
    mat.Lot_Status = mat.Material_Category.includes('CAD') ? 'Dispatched to CAD Room' : 'Dispatched to Cutting Floor';
    saveDB(db);
    logAudit('RMW_Dispatch', 'MATERIAL_ISSUED', `${matCode} dispatched from ${mat.RMW_Storage_Bay}`, 'RMWC-C-01');
    renderSupplyPortal();
    showToast(`Dispatched ${matCode} (${mat.Lot_Status})`);
}

// ============================================================================
// 9. FLOOR QUALITY CONTROL (QC) DEFECT FLAGGING
// ============================================================================
function renderQcPortal() {
    const db = getDB();
    document.getElementById('qc-asset-select').innerHTML = db.Pattern_Assets.map(p => `<option value="${p.Asset_ID}">${p.Asset_ID} • ${p.Model_Name} (${p.Operational_Status})</option>`).join('');
    document.getElementById('qc-defect-select').innerHTML = db.QC_Defect_Codes.map(d => `<option value="${d.Defect_Code}">${d.Defect_Code} • ${d.Defect_Name_Symptom}</option>`).join('');
    previewDefectAction();

    document.getElementById('qc-logs-list').innerHTML = db.QC_Inspection_Logs.map(l => `
        <div class="p-3.5 rounded-lg bg-neutral-950 border border-neutral-800 font-mono text-xs flex justify-between items-center gap-4">
            <div>
                <p class="font-bold text-white">${l.QC_Log_ID} • Defect <span class="text-rose-400">${l.Defect_Code}</span> on Asset <span class="text-amber-400">${l.Asset_ID}</span> (${l.Production_Line})</p>
                <p class="text-[10px] text-neutral-400 mt-0.5">Inspector: ${l.Inspector_ID} &rarr; Assigned Resolver: <strong class="text-white">${l.Resolver_ID}</strong> • Ruined Plies: ${l.Ruined_Ply_Count}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <span class="px-2.5 py-1 rounded text-[10px] ${l.Resolution_Status === 'Resolved' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'}">${l.Resolution_Status}</span>
                ${l.Resolution_Status !== 'Resolved' ? `<button onclick="resolveQcLog('${l.QC_Log_ID}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded text-[10px] uppercase font-bold">Mark Fixed</button>` : ''}
            </div>
        </div>
    `).join('');
}

function previewDefectAction() {
    const db = getDB();
    const code = document.getElementById('qc-defect-select').value;
    const def = db.QC_Defect_Codes.find(d => d.Defect_Code === code);
    if (!def) return;
    document.getElementById('qc-action-preview').innerHTML = `
        <p><strong>Category:</strong> ${def.Fault_Category} (${def.Severity_Level})</p>
        <p class="mt-1"><strong>Status Triggered:</strong> ${def.Target_Asset_Status} • <strong>Resolver:</strong> ${def.Assigned_Resolver_Role_ID}</p>
        <p class="mt-1 text-amber-300"><strong>System Action:</strong> ${def.Mandatory_System_Action}</p>
    `;
}

function submitQcDefectFlag() {
    const db = getDB();
    const assetId = document.getElementById('qc-asset-select').value;
    const defCode = document.getElementById('qc-defect-select').value;
    const line = document.getElementById('qc-line-select').value;
    const plies = parseInt(document.getElementById('qc-ruined-plies').value) || 20;

    const def = db.QC_Defect_Codes.find(d => d.Defect_Code === defCode);
    const asset = db.Pattern_Assets.find(a => a.Asset_ID === assetId);

    if (asset && def.Target_Asset_Status !== 'Active on Line (No Lock)') {
        asset.Operational_Status = def.Target_Asset_Status;
    }

    const logId = `QCL-${500 + db.QC_Inspection_Logs.length + 1}`;
    db.QC_Inspection_Logs.unshift({
        QC_Log_ID: logId,
        Asset_ID: assetId,
        Defect_Code: defCode,
        Inspector_ID: def.Reported_By_Role_ID,
        Resolver_ID: def.Assigned_Resolver_Role_ID,
        Production_Line: line,
        Ruined_Ply_Count: plies,
        Logged_Timestamp: new Date().toLocaleString(),
        Resolution_Status: `Open - ${def.Target_Asset_Status}`
    });
    saveDB(db);
    logAudit('QC_Flag', defCode, `Flagged ${assetId} on ${line} (${def.Mandatory_System_Action})`, def.Reported_By_Role_ID);
    renderQcPortal();
    showToast(`Executed ${defCode}: ${assetId} routed to ${def.Assigned_Resolver_Role_ID}`, 'error');
}

function resolveQcLog(logId) {
    const db = getDB();
    const log = db.QC_Inspection_Logs.find(l => l.QC_Log_ID === logId);
    if (!log) return;
    log.Resolution_Status = 'Resolved';
    const asset = db.Pattern_Assets.find(a => a.Asset_ID === log.Asset_ID);
    if (asset && asset.Operational_Status !== 'Decommissioned') {
        asset.Operational_Status = 'Available in Room';
    }
    saveDB(db);
    logAudit('QC_Resolve', 'DEFECT_RESOLVED', `${logId} resolved by ${log.Resolver_ID}`, log.Resolver_ID);
    renderQcPortal();
    showToast(`QC Ticket ${logId} marked Resolved!`);
}

// ============================================================================
// 10. HIGHER-UP EXECUTIVE OVERSIGHT & ROOT ADMIN CONSOLE
// ============================================================================
function renderAdminPortal() {
    const db = getDB();
    document.getElementById('kpi-total-assets').innerText = db.Pattern_Assets.length;
    document.getElementById('kpi-avail-assets').innerText = db.Pattern_Assets.filter(p => p.Operational_Status === 'Available in Room').length;
    document.getElementById('kpi-active-assets').innerText = db.Pattern_Assets.filter(p => p.Operational_Status === 'Active on Line').length;
    document.getElementById('kpi-flagged-assets').innerText = db.Pattern_Assets.filter(p => ['Inspection Flagged', 'Pending Removal', 'Decommissioned'].includes(p.Operational_Status)).length;
    const openReqs = db.Pending_Requests.filter(r => r.Request_Status === 'Pending').length +
                     db.System_Settings_Audit.filter(s => s.Record_Type === 'PARAM_REQUEST' && s.Request_Status.includes('Pending')).length;
    document.getElementById('kpi-open-reqs').innerText = openReqs;

    // Parameter Requests from Design
    const paramReqs = db.System_Settings_Audit.filter(s => s.Record_Type === 'PARAM_REQUEST');
    document.getElementById('admin-param-requests-list').innerHTML = paramReqs.map(r => `
        <div class="p-2.5 rounded bg-neutral-900 border border-amber-800/50 font-mono text-xs flex justify-between items-center gap-2">
            <div>
                <p class="text-white font-bold">${r.Setting_Value}</p>
                <p class="text-[10px] text-neutral-400">From: ${r.Requested_By_ID} • Status: <span class="text-amber-400">${r.Request_Status}</span></p>
            </div>
            ${r.Request_Status.includes('Pending') ? `<button onclick="approveParamRequest(${r.Record_ID})" class="bg-emerald-600 text-white px-2.5 py-1 rounded text-[10px] uppercase font-bold">Approve</button>` : ''}
        </div>
    `).join('');

    // Active Parameters
    const params = db.System_Settings_Audit.filter(s => s.Record_Type === 'PARAMETER');
    document.getElementById('system-settings-list').innerHTML = params.map(p => `
        <li class="p-2 rounded bg-neutral-900 border border-neutral-800 flex justify-between items-center">
            <span><strong class="text-blue-400">${p.Category}:</strong> ${p.Setting_Value} ${p.Prefix_Data ? `(${p.Prefix_Data})` : ''}</span>
            <button onclick="deleteSystemParam(${p.Record_ID})" class="text-neutral-500 hover:text-rose-400"><i class="ph ph-trash"></i></button>
        </li>
    `).join('');

    // Roles dropdown
    const uniqueRoles = [...new Set(db.Employees.map(e => e.Role_Designation))];
    document.getElementById('reg-emp-role').innerHTML = uniqueRoles.map(r => `<option value="${r}">${r}</option>`).join('');

    // Audit Log Terminal
    const logs = db.System_Settings_Audit.filter(s => s.Record_Type === 'AUDIT_LOG');
    document.getElementById('audit-log-terminal').innerHTML = logs.map(l => `
        <div class="border-b border-neutral-800 pb-1.5">
            <span class="text-neutral-500">[${l.Created_At}]</span> <strong class="text-blue-400">${l.Category}</strong> • <span class="text-amber-300">${l.Requested_By_ID}</span><br>
            <span class="text-neutral-300">${l.Setting_Value}</span>
        </div>
    `).join('');

    loadAdminRecordsTable('patterns');
}

function switchAdminSubTab(tab) {
    ['params', 'emp', 'records'].forEach(t => {
        document.getElementById(`admin-panel-${t}`).classList.add('hidden');
        document.getElementById(`adm-sub-${t}`).className = 'px-4 py-2 rounded bg-neutral-950 text-neutral-400 hover:text-white border border-neutral-800';
    });
    document.getElementById(`admin-panel-${tab}`).classList.remove('hidden');
    document.getElementById(`adm-sub-${tab}`).className = 'px-4 py-2 rounded bg-blue-600 text-white font-bold';
}

function addSystemSetting() {
    const db = getDB();
    const cat = document.getElementById('sys-cat').value;
    const val = document.getElementById('sys-val').value.trim();
    const prefix = document.getElementById('sys-prefix').value.trim().toUpperCase();
    if (!val) return showToast('Enter a parameter value.', 'error');

    db.System_Settings_Audit.unshift({
        Record_ID: Date.now(),
        Record_Type: 'PARAMETER',
        Category: cat,
        Setting_Value: val,
        Prefix_Data: prefix,
        Requested_By_ID: 'DT-C-CA-01',
        Request_Status: 'Active',
        Created_At: new Date().toLocaleTimeString()
    });
    saveDB(db);
    logAudit('System', 'ADDED_PARAMETER', `Added ${cat}: ${val}`, 'DT-C-CA-01');
    document.getElementById('sys-val').value = '';
    renderAdminPortal();
    showToast(`Injected ${cat}: ${val}`);
}

function approveParamRequest(recId) {
    const db = getDB();
    const req = db.System_Settings_Audit.find(r => r.Record_ID === recId);
    if (!req) return;
    req.Request_Status = 'Approved & Injected';
    db.System_Settings_Audit.unshift({
        Record_ID: Date.now(),
        Record_Type: 'PARAMETER',
        Category: 'Brand',
        Setting_Value: req.Setting_Value.replace('Add Brand:', '').trim(),
        Prefix_Data: req.Prefix_Data || 'NEW',
        Requested_By_ID: 'DT-C-CA-01',
        Request_Status: 'Active',
        Created_At: new Date().toLocaleTimeString()
    });
    saveDB(db);
    logAudit('Admin', 'APPROVED_PARAM_REQ', `Approved ${req.Setting_Value}`, 'DT-C-CA-01');
    renderAdminPortal();
    showToast('Parameter Request Approved & Added to Dropdowns!');
}

function deleteSystemParam(recId) {
    const db = getDB();
    db.System_Settings_Audit = db.System_Settings_Audit.filter(s => s.Record_ID !== recId);
    saveDB(db);
    renderAdminPortal();
    showToast('Parameter removed.');
}

function registerNewEmployee() {
    const db = getDB();
    const id = document.getElementById('reg-emp-id').value.trim().toUpperCase();
    const name = document.getElementById('reg-emp-name').value.trim();
    const dept = document.getElementById('reg-emp-dept').value;
    const role = document.getElementById('reg-emp-role').value;
    const zone = document.getElementById('reg-emp-zone').value.trim() || 'Cutting Floor';

    if (!id || !name) return showToast('Enter Employee ID and Full Name.', 'error');
    db.Employees.unshift({
        Employee_ID: id,
        Full_Name: name,
        Department: dept,
        Role_Designation: role,
        Work_Location_Zone: zone,
        Active_Checkout_Count: 0
    });
    saveDB(db);
    logAudit('Register', 'NEW_OPERATOR', `Registered ${name} (${id}) in ${dept}`, 'DT-C-CA-01');

    const box = document.getElementById('emp-qr-preview-box');
    box.innerHTML = `
        <div class="p-4 bg-white text-black rounded-xl border-4 border-emerald-500 inline-block">
            <div id="emp-qr-canvas" class="flex justify-center"></div>
            <p class="font-bold text-sm mt-2">${name}</p>
            <p class="text-xs text-emerald-700 font-bold">${id} • ${role}</p>
        </div>
    `;
    new QRCode(document.getElementById('emp-qr-canvas'), { text: id, width: 110, height: 110, colorDark: '#065f46' });
    showToast(`Registered ${name} (${id}) & Generated Green QR Badge!`);
}

function loadAdminRecordsTable(type) {
    const db = getDB();
    const thead = document.getElementById('admin-records-thead');
    const tbody = document.getElementById('admin-records-tbody');

    if (type === 'patterns') {
        thead.innerHTML = `<th class="p-2.5">Asset ID</th><th class="p-2.5">Type</th><th class="p-2.5">Brand & Model</th><th class="p-2.5">Location</th><th class="p-2.5">Status</th><th class="p-2.5 text-right">Action</th>`;
        tbody.innerHTML = db.Pattern_Assets.map(p => `
            <tr class="hover:bg-neutral-900">
                <td class="p-2.5 font-bold text-white">${p.Asset_ID}</td>
                <td class="p-2.5">${p.Tooling_Type}</td>
                <td class="p-2.5">${p.Brand_Buyer} • ${p.Model_Name}</td>
                <td class="p-2.5">${p.Storage_Location}</td>
                <td class="p-2.5 text-emerald-400">${p.Operational_Status}</td>
                <td class="p-2.5 text-right">
                    <button onclick="purgeRecordWithBackup('pattern', '${p.Asset_ID}')" class="text-rose-400 hover:text-rose-300 text-[10px] uppercase border border-rose-800 px-2 py-0.5 rounded">Purge</button>
                </td>
            </tr>
        `).join('');
    } else {
        thead.innerHTML = `<th class="p-2.5">Employee ID</th><th class="p-2.5">Full Name</th><th class="p-2.5">Department</th><th class="p-2.5">Role</th><th class="p-2.5">Zone</th><th class="p-2.5 text-right">Action</th>`;
        tbody.innerHTML = db.Employees.map(e => `
            <tr class="hover:bg-neutral-900">
                <td class="p-2.5 font-bold text-white">${e.Employee_ID}</td>
                <td class="p-2.5">${e.Full_Name}</td>
                <td class="p-2.5">${e.Department}</td>
                <td class="p-2.5 text-blue-400">${e.Role_Designation}</td>
                <td class="p-2.5">${e.Work_Location_Zone}</td>
                <td class="p-2.5 text-right">
                    <button onclick="purgeRecordWithBackup('emp', '${e.Employee_ID}')" class="text-rose-400 hover:text-rose-300 text-[10px] uppercase border border-rose-800 px-2 py-0.5 rounded">Purge</button>
                </td>
            </tr>
        `).join('');
    }
}

function purgeRecordWithBackup(type, id) {
    const db = getDB();
    if (type === 'pattern') {
        const rec = db.Pattern_Assets.find(p => p.Asset_ID === id);
        db.Pattern_Assets = db.Pattern_Assets.filter(p => p.Asset_ID !== id);
        saveDB(db);
        logAudit('Delete', 'PURGED_ASSET_JSON', JSON.stringify(rec), 'DT-C-CA-01');
        loadAdminRecordsTable('patterns');
    } else {
        const rec = db.Employees.find(e => e.Employee_ID === id);
        db.Employees = db.Employees.filter(e => e.Employee_ID !== id);
        saveDB(db);
        logAudit('Delete', 'PURGED_OPERATOR_JSON', JSON.stringify(rec), 'DT-C-CA-01');
        loadAdminRecordsTable('employees');
    }
    renderAdminPortal();
    showToast(`Purged ${id} & Saved Immutable JSON Backup to Graveyard Log.`);
}

// ============================================================================
// 11. GROUPED MANAGEMENT REPORTS & VISUAL DATABASE EXPLORER (VIVA RULES #5, #9, #12, #16, #17)
// ============================================================================
function switchReportMode(mode) {
    document.getElementById('reports-mgmt-container').classList.toggle('hidden', mode !== 'mgmt');
    document.getElementById('reports-vdb-container').classList.toggle('hidden', mode !== 'vdb');
    document.getElementById('rep-mode-mgmt').className = mode === 'mgmt' ? 'px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold' : 'px-4 py-2 rounded-lg bg-neutral-900 text-neutral-300 border border-neutral-800';
    document.getElementById('rep-mode-vdb').className = mode === 'vdb' ? 'px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold' : 'px-4 py-2 rounded-lg bg-neutral-900 text-neutral-300 border border-neutral-800';
    if (mode === 'vdb') renderVisualDatabaseExplorer('Employees');
}

function renderGroupedReport(repNo) {
    const db = getDB();
    const canvas = document.getElementById('printable-report-canvas');
    const nowStr = new Date().toLocaleString();

    if (repNo === 1) {
        // REPORT 1: GROUPED BY BRAND (TRIUMPH, VICTORIA'S SECRET, LULULEMON, NIKE)
        const brands = [...new Set(db.Pattern_Assets.map(p => p.Brand_Buyer))];
        canvas.innerHTML = `
            <div class="border-b border-neutral-700 pb-4 mb-5 flex justify-between items-start font-mono">
                <div>
                    <p class="text-[10px] text-emerald-400 uppercase tracking-widest">CDMS+ Management Report • Layout REP-01</p>
                    <h3 class="text-xl font-black text-white uppercase mt-1">Pattern Blocks & 3D Molds Utilization Report (Grouped by Buyer Brand)</h3>
                    <p class="text-xs text-neutral-400 mt-1">Facility: Bodyline (Pvt) Ltd, Horana Plant 1 • Prepared for: Cutting Dept Head (DH-01) & Pattern Coordinator (PR-C-PC-01)</p>
                </div>
                <span class="text-xs text-neutral-400">Generated: ${nowStr}</span>
            </div>
            <div class="space-y-6 font-mono text-xs">
                ${brands.map(brand => {
                    const items = db.Pattern_Assets.filter(p => p.Brand_Buyer === brand);
                    const activeCnt = items.filter(i => i.Operational_Status === 'Active on Line').length;
                    const flaggedCnt = items.filter(i => ['Inspection Flagged', 'Pending Removal', 'Decommissioned'].includes(i.Operational_Status)).length;
                    return `
                        <div class="border border-neutral-800 rounded-lg overflow-hidden">
                            <div class="bg-neutral-950 px-4 py-2.5 border-b border-neutral-800 flex justify-between items-center">
                                <strong class="text-sm text-blue-400 uppercase">Buyer Brand Group: ${brand} (${items.length} Tooling Assets)</strong>
                                <span class="text-[11px] text-neutral-300">Active on Line: <strong>${activeCnt}</strong> • Flagged/Dormant: <strong class="text-rose-400">${flaggedCnt}</strong></span>
                            </div>
                            <table class="w-full text-left">
                                <thead class="bg-neutral-900/70 text-[10px] uppercase text-neutral-400 border-b border-neutral-800">
                                    <tr><th class="p-2.5">Asset ID</th><th class="p-2.5">Tooling Type</th><th class="p-2.5">Model & Style Code</th><th class="p-2.5">Size</th><th class="p-2.5">Storage Location</th><th class="p-2.5">Last Used</th><th class="p-2.5">Status</th></tr>
                                </thead>
                                <tbody class="divide-y divide-neutral-800/50">
                                    ${items.map(i => `
                                        <tr>
                                            <td class="p-2.5 font-bold text-white">${i.Asset_ID}</td>
                                            <td class="p-2.5">${i.Tooling_Type}</td>
                                            <td class="p-2.5">${i.Model_Name} (${i.Style_Code})</td>
                                            <td class="p-2.5">${i.Size_Category}</td>
                                            <td class="p-2.5">${i.Storage_Location}</td>
                                            <td class="p-2.5">${i.Last_Used_Date}</td>
                                            <td class="p-2.5 font-bold">${i.Operational_Status}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } else if (repNo === 2) {
        // REPORT 2: QC DEFECTS & RE-CUTS GROUPED BY FAULT CATEGORY
        const cats = [...new Set(db.QC_Defect_Codes.map(d => d.Fault_Category))];
        canvas.innerHTML = `
            <div class="border-b border-neutral-700 pb-4 mb-5 flex justify-between items-start font-mono">
                <div>
                    <p class="text-[10px] text-rose-400 uppercase tracking-widest">CDMS+ Management Report • Layout REP-02</p>
                    <h3 class="text-xl font-black text-white uppercase mt-1">Monthly Quality Control Defect & Re-Cut Root Cause Analysis (Grouped by Fault Category)</h3>
                    <p class="text-xs text-neutral-400 mt-1">Prepared for: Quality Control Executive (CQCE-01), Cutting Senior Executive (CSE-01) & CAD Coordinator (CADC-C-01)</p>
                </div>
                <span class="text-xs text-neutral-400">Generated: ${nowStr}</span>
            </div>
            <div class="space-y-5 font-mono text-xs">
                ${cats.map(cat => {
                    const codes = db.QC_Defect_Codes.filter(d => d.Fault_Category === cat);
                    return `
                        <div class="border border-neutral-800 rounded-lg overflow-hidden">
                            <div class="bg-neutral-950 px-4 py-2 border-b border-neutral-800 flex justify-between">
                                <strong class="text-rose-400 uppercase">Fault Group: ${cat} (${codes.length} Standard Protocols)</strong>
                                <span class="text-neutral-400">Assigned Resolver Role: ${codes[0].Assigned_Resolver_Role_ID}</span>
                            </div>
                            <table class="w-full text-left">
                                <thead class="bg-neutral-900/70 text-[10px] uppercase text-neutral-400 border-b border-neutral-800">
                                    <tr><th class="p-2.5">Code</th><th class="p-2.5">Floor Symptom</th><th class="p-2.5">Severity</th><th class="p-2.5">Status Triggered</th><th class="p-2.5">Mandatory System Action</th></tr>
                                </thead>
                                <tbody class="divide-y divide-neutral-800/50">
                                    ${codes.map(c => `
                                        <tr>
                                            <td class="p-2.5 font-bold text-white">${c.Defect_Code}</td>
                                            <td class="p-2.5">${c.Defect_Name_Symptom}</td>
                                            <td class="p-2.5">${c.Severity_Level}</td>
                                            <td class="p-2.5">${c.Target_Asset_Status}</td>
                                            <td class="p-2.5 text-neutral-300">${c.Mandatory_System_Action}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } else if (repNo === 3) {
        // REPORT 3: SHIFT DEPLOYMENTS GROUPED BY SHIFT
        const shifts = ['Morning', 'Afternoon', 'Night'];
        canvas.innerHTML = `
            <div class="border-b border-neutral-700 pb-4 mb-5 flex justify-between items-start font-mono">
                <div>
                    <p class="text-[10px] text-amber-400 uppercase tracking-widest">CDMS+ Management Report • Layout REP-03</p>
                    <h3 class="text-xl font-black text-white uppercase mt-1">Daily Shift Schedule & Operator Deployment Report (Grouped by Shift)</h3>
                    <p class="text-xs text-neutral-400 mt-1">Prepared for: Cutting Supervisors (CS-L1-01 to CS-L3-01) & HR / Operations</p>
                </div>
                <span class="text-xs text-neutral-400">Generated: ${nowStr}</span>
            </div>
            <div class="space-y-5 font-mono text-xs">
                ${shifts.map(sh => {
                    const rows = db.Shift_Assignments.filter(a => a.Shift_Type === sh);
                    return `
                        <div class="border border-neutral-800 rounded-lg overflow-hidden">
                            <div class="bg-neutral-950 px-4 py-2 border-b border-neutral-800 flex justify-between">
                                <strong class="text-amber-400 uppercase">Shift Group: ${sh} Shift (${rows.length} Operators Scheduled)</strong>
                            </div>
                            <table class="w-full text-left">
                                <thead class="bg-neutral-900/70 text-[10px] uppercase text-neutral-400 border-b border-neutral-800">
                                    <tr><th class="p-2.5">Assignment ID</th><th class="p-2.5">Operator ID</th><th class="p-2.5">Authorized By Supervisor</th><th class="p-2.5">Shift Date</th><th class="p-2.5">Production Line</th></tr>
                                </thead>
                                <tbody class="divide-y divide-neutral-800/50">
                                    ${rows.map(r => `
                                        <tr>
                                            <td class="p-2.5 font-bold text-white">ASG-${r.Assignment_ID}</td>
                                            <td class="p-2.5 text-blue-400">${r.Borrower_ID}</td>
                                            <td class="p-2.5">${r.Supervisor_ID}</td>
                                            <td class="p-2.5">${r.Assigned_Date}</td>
                                            <td class="p-2.5">${r.Production_Line}</td>
                                        </tr>
                                    `).join('') || `<tr><td colspan="5" class="p-3 text-neutral-500">No operators assigned for this shift.</td></tr>`}
                                </tbody>
                            </table>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } else {
        // REPORT 4: RMW MATERIALS GROUPED BY MATERIAL CATEGORY
        const matCats = ['CAD Tooling Material', 'Cutting Floor Fabric'];
        canvas.innerHTML = `
            <div class="border-b border-neutral-700 pb-4 mb-5 flex justify-between items-start font-mono">
                <div>
                    <p class="text-[10px] text-cyan-400 uppercase tracking-widest">CDMS+ Management Report • Layout REP-04</p>
                    <h3 class="text-xl font-black text-white uppercase mt-1">RMW Cardboard, Molding Plastic & Cutting Fabric Consumption Report (Grouped by Material Category)</h3>
                    <p class="text-xs text-neutral-400 mt-1">Prepared for: Raw Material Warehouse Coordinators (RMWC-C-01..03) & Cutting Senior Executive (CSE-01)</p>
                </div>
                <span class="text-xs text-neutral-400">Generated: ${nowStr}</span>
            </div>
            <div class="space-y-5 font-mono text-xs">
                ${matCats.map(cat => {
                    const items = db.RMW_Materials.filter(m => m.Material_Category === cat);
                    return `
                        <div class="border border-neutral-800 rounded-lg overflow-hidden">
                            <div class="bg-neutral-950 px-4 py-2 border-b border-neutral-800 flex justify-between">
                                <strong class="text-cyan-400 uppercase">Material Category Group: ${cat} (${items.length} Stock Lots)</strong>
                            </div>
                            <table class="w-full text-left">
                                <thead class="bg-neutral-900/70 text-[10px] uppercase text-neutral-400 border-b border-neutral-800">
                                    <tr><th class="p-2.5">Material Code</th><th class="p-2.5">Material Name & Composition</th><th class="p-2.5">Target Brand / Usage</th><th class="p-2.5">Storage Bay</th><th class="p-2.5">Managed By</th><th class="p-2.5">Dispatch Status</th></tr>
                                </thead>
                                <tbody class="divide-y divide-neutral-800/50">
                                    ${items.map(m => `
                                        <tr>
                                            <td class="p-2.5 font-bold text-white">${m.Material_Code}</td>
                                            <td class="p-2.5">${m.Material_Name_Specs}</td>
                                            <td class="p-2.5">${m.Target_Brand_Usage}</td>
                                            <td class="p-2.5">${m.RMW_Storage_Bay}</td>
                                            <td class="p-2.5">${m.Managed_By_RMW_ID}</td>
                                            <td class="p-2.5 text-emerald-400 font-bold">${m.Lot_Status}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }
}

// FILE DESIGN METADATA (EXACT MATCH FOR ER DIAGRAM & CHAPTER 4.3 FILE DESIGN)
const FILE_DESIGN_SPECS = {
    Employees: [
        { field: 'Employee_ID', type: 'VARCHAR', size: '20', key: 'PRIMARY KEY', sample: 'CW-L1-CMO-01' },
        { field: 'Full_Name', type: 'VARCHAR', size: '100', key: 'NOT NULL (Composite)', sample: 'Gayan Abeysekara' },
        { field: 'Department', type: 'VARCHAR', size: '50', key: 'NOT NULL', sample: 'Cutting' },
        { field: 'Role_Designation', type: 'VARCHAR', size: '60', key: 'NOT NULL', sample: 'Cutting Machine Operators' },
        { field: 'Work_Location_Zone', type: 'VARCHAR', size: '60', key: 'NOT NULL', sample: 'Cutting Floor - Line 1' },
        { field: 'Active_Checkout_Count', type: 'INT', size: '4', key: 'DEFAULT 0', sample: '1' }
    ],
    Pattern_Assets: [
        { field: 'Asset_ID', type: 'VARCHAR', size: '20', key: 'PRIMARY KEY', sample: 'TR-PB-01' },
        { field: 'Tooling_Type', type: 'VARCHAR', size: '30', key: 'NOT NULL', sample: 'Pattern Block' },
        { field: 'Model_Name', type: 'VARCHAR', size: '80', key: 'NOT NULL', sample: 'Triaction Control' },
        { field: 'Style_Code', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (CAD_Markers)', sample: 'TR-TAC-01' },
        { field: 'Brand_Buyer', type: 'VARCHAR', size: '40', key: 'NOT NULL', sample: 'Triumph' },
        { field: 'Size_Category', type: 'VARCHAR', size: '15', key: 'NOT NULL', sample: '34C' },
        { field: 'Storage_Location', type: 'VARCHAR', size: '40', key: 'NOT NULL', sample: 'Rack A-01' },
        { field: 'Operational_Status', type: 'VARCHAR', size: '35', key: 'DEFAULT Available', sample: 'Active on Line' },
        { field: 'Borrowed_By_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'CW-L1-CMO-01' },
        { field: 'Last_Used_Date', type: 'DATE', size: '10', key: 'NOT NULL', sample: '2026-10-28' }
    ],
    CAD_Markers: [
        { field: 'CAD_Marker_ID', type: 'VARCHAR', size: '20', key: 'PRIMARY KEY', sample: 'CAD-MK-01' },
        { field: 'Style_Code', type: 'VARCHAR', size: '20', key: 'UNIQUE KEY', sample: 'TR-TAC-01' },
        { field: 'Brand_Buyer', type: 'VARCHAR', size: '40', key: 'NOT NULL', sample: 'Triumph' },
        { field: 'Model_Name', type: 'VARCHAR', size: '80', key: 'NOT NULL', sample: 'Triaction Control' },
        { field: 'Design_Coordinator_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'DDC-C-01' },
        { field: 'CAD_Handler_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'CAD-C-CPH-01' },
        { field: 'CAD_Tooling_Material_Code', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (RMW_Materials)', sample: 'MAT-CRD-01' },
        { field: 'Cutting_Floor_Fabric_Code', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (RMW_Materials)', sample: 'FAB-TR-01' }
    ],
    RMW_Materials: [
        { field: 'Material_Code', type: 'VARCHAR', size: '20', key: 'PRIMARY KEY', sample: 'MAT-CRD-01' },
        { field: 'Material_Category', type: 'VARCHAR', size: '40', key: 'NOT NULL', sample: 'CAD Tooling Material' },
        { field: 'Material_Name_Specs', type: 'VARCHAR', size: '120', key: 'NOT NULL', sample: 'Heavy Kraft Cardboard' },
        { field: 'Target_Brand_Usage', type: 'VARCHAR', size: '50', key: 'NOT NULL', sample: 'CAD Pattern Blocks' },
        { field: 'RMW_Storage_Bay', type: 'VARCHAR', size: '30', key: 'NOT NULL', sample: 'RMW-Bay-T1' },
        { field: 'Managed_By_RMW_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'RMWC-C-01' },
        { field: 'Lot_Status', type: 'VARCHAR', size: '30', key: 'DEFAULT In Warehouse', sample: 'Dispatched to CAD' }
    ],
    QC_Defect_Codes: [
        { field: 'Defect_Code', type: 'VARCHAR', size: '15', key: 'PRIMARY KEY', sample: 'DEF-01' },
        { field: 'Defect_Name_Symptom', type: 'VARCHAR', size: '120', key: 'NOT NULL', sample: 'Frayed Cardboard Edge' },
        { field: 'Fault_Category', type: 'VARCHAR', size: '40', key: 'NOT NULL', sample: 'Pattern Block Fault' },
        { field: 'Severity_Level', type: 'VARCHAR', size: '35', key: 'NOT NULL', sample: 'High - Asset Lock' },
        { field: 'Target_Asset_Status', type: 'VARCHAR', size: '35', key: 'NOT NULL', sample: 'Inspection Flagged' },
        { field: 'Reported_By_Role_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'QCI-C-01' },
        { field: 'Assigned_Resolver_Role_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'PR-C-PH-01' },
        { field: 'Mandatory_System_Action', type: 'VARCHAR', size: '150', key: 'NOT NULL', sample: 'Auto-Lock Pattern QR' }
    ],
    Shift_Assignments: [
        { field: 'Assignment_ID', type: 'INT', size: '11', key: 'PRIMARY KEY (Auto)', sample: '101' },
        { field: 'Borrower_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'CW-L1-CMO-01' },
        { field: 'Supervisor_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'CS-L1-01' },
        { field: 'Assigned_Date', type: 'DATE', size: '10', key: 'NOT NULL', sample: '2026-10-28' },
        { field: 'Shift_Type', type: 'VARCHAR', size: '20', key: 'NOT NULL', sample: 'Morning' },
        { field: 'Production_Line', type: 'VARCHAR', size: '25', key: 'NOT NULL', sample: 'Line 1' }
    ],
    Pending_Requests: [
        { field: 'Request_ID', type: 'INT', size: '11', key: 'PRIMARY KEY (Auto)', sample: '201' },
        { field: 'Borrower_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'CW-L2-CMO-02' },
        { field: 'Pattern_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Pattern_Assets)', sample: 'VS-PB-01' },
        { field: 'Requested_Shift', type: 'VARCHAR', size: '20', key: 'NOT NULL', sample: 'Morning' },
        { field: 'Requested_Date', type: 'DATE', size: '10', key: 'NOT NULL', sample: '2026-10-28' },
        { field: 'Request_Status', type: 'VARCHAR', size: '20', key: 'DEFAULT Pending', sample: 'Pending' }
    ],
    Cutting_Orders: [
        { field: 'Order_ID', type: 'VARCHAR', size: '20', key: 'PRIMARY KEY', sample: 'ORD-101' },
        { field: 'Style_Code', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (CAD_Markers)', sample: 'TR-TAC-01' },
        { field: 'Sewing_Coordinator_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'SDC-C-01' },
        { field: 'Approved_By_Exec_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'CSE-01' },
        { field: 'Target_Size', type: 'VARCHAR', size: '15', key: 'NOT NULL', sample: '34C' },
        { field: 'Target_Bundle_Qty', type: 'INT', size: '11', key: 'NOT NULL', sample: '1400' },
        { field: 'Priority_Level', type: 'VARCHAR', size: '20', key: 'DEFAULT Normal', sample: 'Urgent' },
        { field: 'Order_Status', type: 'VARCHAR', size: '30', key: 'DEFAULT Queued', sample: 'Active on Line' }
    ],
    QC_Inspection_Logs: [
        { field: 'QC_Log_ID', type: 'VARCHAR', size: '20', key: 'PRIMARY KEY', sample: 'QCL-501' },
        { field: 'Asset_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Pattern_Assets)', sample: 'VS-PM-02' },
        { field: 'Defect_Code', type: 'VARCHAR', size: '15', key: 'FOREIGN KEY (QC_Defect_Codes)', sample: 'DEF-01' },
        { field: 'Inspector_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'QCI-C-01' },
        { field: 'Resolver_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'PR-C-PH-01' },
        { field: 'Ruined_Ply_Count', type: 'INT', size: '11', key: 'DEFAULT 0', sample: '28' },
        { field: 'Resolution_Status', type: 'VARCHAR', size: '25', key: 'DEFAULT Open', sample: 'Open - Asset Locked' }
    ],
    System_Settings_Audit: [
        { field: 'Record_ID', type: 'INT', size: '11', key: 'PRIMARY KEY (Auto)', sample: '1' },
        { field: 'Record_Type', type: 'VARCHAR', size: '30', key: 'NOT NULL', sample: 'PARAMETER / AUDIT_LOG' },
        { field: 'Category', type: 'VARCHAR', size: '40', key: 'NOT NULL', sample: 'Brand' },
        { field: 'Setting_Value', type: 'VARCHAR', size: '100', key: 'NOT NULL', sample: 'Triumph' },
        { field: 'Requested_By_ID', type: 'VARCHAR', size: '20', key: 'FOREIGN KEY (Employees)', sample: 'DT-C-CA-01' }
    ]
};

function renderVisualDatabaseExplorer(tableName) {
    const db = getDB();
    const tables = Object.keys(FILE_DESIGN_SPECS);
    document.getElementById('vdb-table-tabs').innerHTML = tables.map((t, idx) => `
        <button onclick="renderVisualDatabaseExplorer('${t}')" class="px-3 py-1.5 rounded ${t === tableName ? 'bg-blue-600 text-white font-bold' : 'bg-neutral-900 text-neutral-400 border border-neutral-800 hover:text-white'}">
            TBL-${(idx + 1).toString().padStart(2, '0')}: ${t} (${(db[t] || []).length})
        </button>
    `).join('');

    // Render File Design Spec
    const specs = FILE_DESIGN_SPECS[tableName] || [];
    document.getElementById('vdb-schema-spec').innerHTML = `
        <table class="w-full text-left">
            <thead class="bg-neutral-950 text-[10px] uppercase text-neutral-400 border-b border-neutral-800">
                <tr><th class="p-2">Field Name</th><th class="p-2">Type</th><th class="p-2">Size</th><th class="p-2">Key</th></tr>
            </thead>
            <tbody class="divide-y divide-neutral-800/50">
                ${specs.map(s => `
                    <tr>
                        <td class="p-2 font-bold text-white">${s.field}</td>
                        <td class="p-2 text-amber-400">${s.type}</td>
                        <td class="p-2">${s.size}</td>
                        <td class="p-2 text-blue-400 text-[10px]">${s.key}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // Render Live Rows
    const rows = db[tableName] || [];
    document.getElementById('vdb-table-title').innerText = `Live Database Table: ${tableName} (${rows.length} Rows Loaded)`;
    if (rows.length === 0) {
        document.getElementById('vdb-table-rows').innerHTML = '<p class="text-neutral-500">No rows in table.</p>';
        return;
    }
    const cols = Object.keys(rows[0]);
    document.getElementById('vdb-table-rows').innerHTML = `
        <table class="w-full text-left">
            <thead class="bg-neutral-950 text-[10px] uppercase text-neutral-400 border-b border-neutral-800">
                <tr>${cols.map(c => `<th class="p-2">${c}</th>`).join('')}</tr>
            </thead>
            <tbody class="divide-y divide-neutral-800/50">
                ${rows.map(r => `
                    <tr class="hover:bg-neutral-950/60">
                        ${cols.map(c => `<td class="p-2 text-neutral-200">${r[c] !== null && r[c] !== undefined ? r[c] : '<span class="text-neutral-600">NULL</span>'}</td>`).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}