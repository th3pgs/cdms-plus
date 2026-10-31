-- ============================================================================
-- CDMS+ (Cutting Department Management System) - Supabase Schema & Seed Data
-- Run this script in Supabase -> SQL Editor -> New Query to initialize tables.
-- ============================================================================


-- 1. Employees Directory (TBL-01)
-- Stores floor workers, coordinators, supervisors, executives, and admins.
CREATE TABLE IF NOT EXISTS Employees (
    Employee_ID VARCHAR(20) PRIMARY KEY,
    Full_Name VARCHAR(100) NOT NULL,
    Department VARCHAR(50) NOT NULL,
    Role_Designation VARCHAR(60) NOT NULL,
    Work_Location_Zone VARCHAR(60) NOT NULL,
    Active_Checkout_Count INT DEFAULT 0,
    Password_Hash VARCHAR(100) DEFAULT 'bodyline123',
    Account_Password VARCHAR(100) DEFAULT 'bodyline123',
    Temp_Password VARCHAR(100),
    Must_Reset_Password BOOLEAN DEFAULT FALSE,
    Account_Status VARCHAR(40) DEFAULT 'Active',
    Suspension_Until DATE,
    Avatar_URL TEXT DEFAULT ''
);


-- 2. Raw Material Warehouse (RMW) Inventory (TBL-04)
-- Tracks CAD tooling materials (cardboard, plastic resin) and cutting floor fabrics.
CREATE TABLE IF NOT EXISTS RMW_Materials (
    Material_Code VARCHAR(20) PRIMARY KEY,
    Material_Category VARCHAR(40) NOT NULL,
    Material_Name_Specs VARCHAR(120) NOT NULL,
    Target_Brand_Usage VARCHAR(50) NOT NULL,
    RMW_Storage_Bay VARCHAR(30) NOT NULL,
    Managed_By_RMW_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Lot_Status VARCHAR(40) DEFAULT 'In Warehouse'
);


-- 3. CAD Markers & Garment Styles (TBL-03)
-- Links garment styles from Design to CAD plotting and RMW fabric requirements.
CREATE TABLE IF NOT EXISTS CAD_Markers (
    CAD_Marker_ID VARCHAR(20) PRIMARY KEY,
    Style_Code VARCHAR(20) UNIQUE NOT NULL,
    Brand_Buyer VARCHAR(40) NOT NULL,
    Model_Name VARCHAR(80) NOT NULL,
    Design_Coordinator_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    CAD_Handler_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    CAD_Tooling_Material_Code VARCHAR(20) REFERENCES RMW_Materials(Material_Code),
    Cutting_Floor_Fabric_Code VARCHAR(20) REFERENCES RMW_Materials(Material_Code),
    Marker_Status VARCHAR(35) DEFAULT 'Approved',
    Sketch_URL TEXT DEFAULT ''
);


-- 4. Pattern Room Assets - Blocks & 3D Molds (TBL-02)
-- Physical tooling assets tracked via QR codes at the Pattern Room kiosk.
CREATE TABLE IF NOT EXISTS Pattern_Assets (
    Asset_ID VARCHAR(20) PRIMARY KEY,
    Tooling_Type VARCHAR(30) NOT NULL,
    Model_Name VARCHAR(80) NOT NULL,
    Style_Code VARCHAR(20) REFERENCES CAD_Markers(Style_Code),
    Brand_Buyer VARCHAR(40) NOT NULL,
    Size_Category VARCHAR(15) NOT NULL,
    Storage_Location VARCHAR(40) NOT NULL,
    Operational_Status VARCHAR(35) DEFAULT 'Available in Room',
    Borrowed_By_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Shift_Checkout VARCHAR(20),
    Checkout_Time TIMESTAMPTZ,
    Lock_Expires_At TIMESTAMPTZ,
    Last_Used_Date DATE DEFAULT CURRENT_DATE,
    Image_URL TEXT DEFAULT ''
);


-- 5. Quality Control Defect Codes (TBL-05)
-- Standardized fault codes and automated lock rules for floor inspections.
CREATE TABLE IF NOT EXISTS QC_Defect_Codes (
    Defect_Code VARCHAR(15) PRIMARY KEY,
    Defect_Name_Symptom VARCHAR(120) NOT NULL,
    Fault_Category VARCHAR(40) NOT NULL,
    Severity_Level VARCHAR(35) NOT NULL,
    Target_Asset_Status VARCHAR(35) NOT NULL,
    Reported_By_Role_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Assigned_Resolver_Role_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Mandatory_System_Action VARCHAR(150) NOT NULL
);


-- 6. Shift Roster Assignments (TBL-06)
-- Weekly shift schedule managed by cutting supervisors; pre-clears operators for borrowing.
CREATE TABLE IF NOT EXISTS Shift_Assignments (
    Assignment_ID SERIAL PRIMARY KEY,
    Borrower_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Supervisor_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Assigned_Date DATE NOT NULL,
    Shift_Type VARCHAR(20) NOT NULL,
    Production_Line VARCHAR(25) DEFAULT 'Line 1'
);


-- 7. Pending Clearance Requests - 15-Minute Lock Queue (TBL-07)
-- Holds checkout requests when an unscheduled worker scans a pattern at the kiosk.
CREATE TABLE IF NOT EXISTS Pending_Requests (
    Request_ID SERIAL PRIMARY KEY,
    Borrower_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Pattern_ID VARCHAR(20) REFERENCES Pattern_Assets(Asset_ID),
    Requested_Shift VARCHAR(20) NOT NULL,
    Requested_Date DATE NOT NULL,
    Request_Time TIMESTAMPTZ DEFAULT NOW(),
    Request_Status VARCHAR(20) DEFAULT 'Pending'
);


-- 8. Sewing Department Cutting Orders (TBL-08)
-- Cut requests submitted by Sewing, verified by Senior Exec, and scheduled by Supervisors.
CREATE TABLE IF NOT EXISTS Cutting_Orders (
    Order_ID VARCHAR(20) PRIMARY KEY,
    Style_Code VARCHAR(20) REFERENCES CAD_Markers(Style_Code),
    Sewing_Coordinator_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Approved_By_Exec_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Target_Size VARCHAR(15) NOT NULL,
    Target_Bundle_Qty INT NOT NULL,
    Priority_Level VARCHAR(20) DEFAULT 'Normal',
    Assigned_Line VARCHAR(25) DEFAULT 'Unassigned',
    Order_Status VARCHAR(35) DEFAULT 'Queued',
    Order_Notes TEXT DEFAULT '',
    Scheduled_Date DATE,
    Scheduled_Shift VARCHAR(20),
    Assigned_Operator_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Pattern_Box_Cleared BOOLEAN DEFAULT FALSE
);


-- 9. Quality Control Inspection & Defect Logs (TBL-09)
-- Floor inspection incidents logged by QC inspectors and resolved by QC executives.
CREATE TABLE IF NOT EXISTS QC_Inspection_Logs (
    QC_Log_ID VARCHAR(20) PRIMARY KEY,
    Asset_ID VARCHAR(20) REFERENCES Pattern_Assets(Asset_ID),
    Defect_Code VARCHAR(15) REFERENCES QC_Defect_Codes(Defect_Code),
    Inspector_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Resolver_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Production_Line VARCHAR(25) DEFAULT 'Line 1',
    Ruined_Ply_Count INT DEFAULT 0,
    Logged_Timestamp TIMESTAMPTZ DEFAULT NOW(),
    Resolution_Status VARCHAR(35) DEFAULT 'Open',
    Severity_Tier VARCHAR(20) DEFAULT 'Medium',
    Involved_Employee_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Inspector_Notes TEXT DEFAULT '',
    Exec_Acknowledged BOOLEAN DEFAULT FALSE,
    Acknowledged_By_ID VARCHAR(20) REFERENCES Employees(Employee_ID)
);


-- 10. System Settings & Dropdown Parameters (TBL-10)
-- Configurable dropdown values (Brands, Sizes, Racks, Roles) managed by Digital Team Admins.
CREATE TABLE IF NOT EXISTS System_Settings_Audit (
    Record_ID SERIAL PRIMARY KEY,
    Record_Type VARCHAR(30) NOT NULL,
    Category VARCHAR(40) NOT NULL,
    Setting_Value VARCHAR(100) NOT NULL,
    Prefix_Data VARCHAR(20),
    Requested_By_ID VARCHAR(20) REFERENCES Employees(Employee_ID),
    Request_Status VARCHAR(25) DEFAULT 'Active',
    JSON_Backup_Data TEXT,
    Created_At TIMESTAMPTZ DEFAULT NOW()
);


-- 11. Inter-Department Communications & Directives (TBL-11)
-- Handles approval requests, password resets, photo approvals, and suspension directives.
CREATE TABLE IF NOT EXISTS Department_Communications (
    Comm_ID SERIAL PRIMARY KEY,
    Sender_ID VARCHAR(20),
    Sender_Name VARCHAR(100),
    Sender_Role VARCHAR(60),
    Receiver_ID VARCHAR(20),
    Receiver_Name VARCHAR(100),
    Receiver_Role VARCHAR(60),
    Protocol_Category VARCHAR(40) NOT NULL,
    Linked_Reference_ID VARCHAR(40),
    Subject_Line VARCHAR(150) NOT NULL,
    Message_Body TEXT,
    Comm_Status VARCHAR(40) DEFAULT 'Pending Approval',
    Resolution_Note TEXT,
    Logged_Timestamp TIMESTAMPTZ DEFAULT NOW()
);


-- 12. Immutable System Audit Logs (TBL-12)
-- Append-only trail of user sign-ins, asset movements, and administrative actions.
CREATE TABLE IF NOT EXISTS Immutable_Audit_Logs (
    Audit_ID SERIAL PRIMARY KEY,
    Actor_ID VARCHAR(20),
    Actor_Name VARCHAR(100),
    Actor_Role VARCHAR(60),
    Action_Verb VARCHAR(50) NOT NULL,
    Target_Entity VARCHAR(50) NOT NULL,
    Target_ID VARCHAR(40) NOT NULL,
    Immutable_Snapshot TEXT,
    Created_At TIMESTAMPTZ DEFAULT NOW()
);


-- 13. Discard Vault / Recoverable Archive (TBL-13)
-- Holds soft-deleted employee profiles and pattern assets so admins can restore them.
CREATE TABLE IF NOT EXISTS Discarded_Trash_Vault (
    Trash_ID SERIAL PRIMARY KEY,
    Original_Table VARCHAR(40) NOT NULL,
    Record_ID VARCHAR(30) NOT NULL,
    Item_Label VARCHAR(150),
    Deleted_By_ID VARCHAR(20),
    Deleted_By_Name VARCHAR(100),
    Deleted_By_Role VARCHAR(60),
    Full_Record_JSON TEXT NOT NULL,
    Deleted_At TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================================
-- INITIAL SEED DATA
-- ============================================================================

-- Seed Employees
INSERT INTO Employees (Employee_ID, Full_Name, Department, Role_Designation, Work_Location_Zone) VALUES
('DH-01', 'Jackson Emmanuel', 'Cutting', 'Cutting Dpt. Head', 'CD Operations Office'),
('CSE-01', 'Aaron Emmanuel', 'Cutting', 'Cutting Senior Executive', 'CD Operations Office'),
('CS-L1-01', 'Nathaniel Perera', 'Cutting', 'Cutting Supervisors', 'Cutting Floor'),
('CS-L2-01', 'Rifa Mohamed', 'Cutting', 'Cutting Supervisors', 'Cutting Floor'),
('CS-L3-01', 'Oshani Wickramasinghe', 'Cutting', 'Cutting Supervisors', 'Cutting Floor'),
('CW-L1-FS-01', 'Nimal Perera', 'Cutting', 'Fabric Spreaders', 'Cutting Floor - Line 1'),
('CW-L2-FS-01', 'Kasun Wijesinghe', 'Cutting', 'Fabric Spreaders', 'Cutting Floor - Line 2'),
('CW-L3-FS-01', 'Tharindu Jayawardena', 'Cutting', 'Fabric Spreaders', 'Cutting Floor - Line 3'),
('CW-L1-CMO-01', 'Gayan Abeysekara', 'Cutting', 'Cutting Machine Operators', 'Cutting Floor - Line 1'),
('CW-L1-CMO-02', 'Dilshan Madushanka', 'Cutting', 'Cutting Machine Operators', 'Cutting Floor - Line 1'),
('CW-L2-CMO-01', 'Akila Senanayake', 'Cutting', 'Cutting Machine Operators', 'Cutting Floor - Line 2'),
('CW-L2-CMO-02', 'Mark Anthony', 'Cutting', 'Cutting Machine Operators', 'Cutting Floor - Line 2'),
('CW-L3-CMO-01', 'Supun Karunaratne', 'Cutting', 'Cutting Machine Operators', 'Cutting Floor - Line 3'),
('CW-L1-BU-01', 'Shehani Silva', 'Cutting', 'Bundling Unit', 'Cutting Floor - Line 1'),
('CW-L2-BU-01', 'Amila Perera', 'Cutting', 'Bundling Unit', 'Cutting Floor - Line 2'),
('CW-L3-BU-01', 'Sachini Peris', 'Cutting', 'Bundling Unit', 'Cutting Floor - Line 3'),
('SDC-C-01', 'Tharindu Perera', 'Sewing - Cutting', 'Sewing Dpt. Coordinator', 'Sewing Department'),
('SDC-C-02', 'Daniel Fernando', 'Sewing - Cutting', 'Sewing Dpt. Coordinator', 'Sewing Department'),
('CQCE-01', 'Imesha Fernando', 'QC - Cutting', 'Quality Control Executive', 'CD Operations Office'),
('QCI-C-01', 'Mohamed Faiz', 'QC - Cutting', 'Quality Control Inspectors', 'Cutting Floor'),
('QCI-C-02', 'Nadeesha Kumari', 'QC - Cutting', 'Quality Control Inspectors', 'Cutting Floor'),
('QCI-C-03', 'Ryan Matthews', 'QC - Cutting', 'Quality Control Inspectors', 'Cutting Floor'),
('RMWC-C-01', 'Ahamed Niyas', 'RMW - Cutting', 'RMW Coordinators', 'Raw Material Warehouse'),
('RMWC-C-02', 'Dineth Perera', 'RMW - Cutting', 'RMW Coordinators', 'Raw Material Warehouse'),
('RMWC-C-03', 'Sherine Daniel', 'RMW - Cutting', 'RMW Coordinators', 'Raw Material Warehouse'),
('DDC-C-01', 'Kavindi Perera', 'Design - Cutting', 'Design Dpt. Coordinators', 'Design Department'),
('DDC-C-02', 'Mohamed Irfan', 'Design - Cutting', 'Design Dpt. Coordinators', 'Design Department'),
('DDC-C-03', 'Dilan Jayasuriya', 'Design - Cutting', 'Design Dpt. Coordinators', 'Design Department'),
('CADC-C-01', 'Oshadhi Perera', 'Cutting - CAD', 'CAD Coordinators', 'CAD Room'),
('CAD-C-MM-01', 'Ayesha Nazeer', 'Cutting - CAD', 'Marker Makers', 'CAD Room'),
('CAD-C-MM-02', 'Joshua Martin', 'Cutting - CAD', 'Marker Makers', 'CAD Room'),
('CAD-C-CPH-01', 'Rizwan Ashraff', 'Cutting - CAD', 'CAD Pattern Handlers', 'CAD Room'),
('CAD-C-CPH-02', 'Nethara Silva', 'Cutting - CAD', 'CAD Pattern Handlers', 'CAD Room'),
('CAD-C-CPH-03', 'Imran Hameed', 'Cutting - CAD', 'CAD Pattern Handlers', 'CAD Room'),
('PR-C-PC-01', 'Menaka Rathnayake', 'Cutting - Pattern', 'Pattern Coordinators', 'Pattern Room'),
('PR-C-PH-01', 'Daniel Joseph', 'Cutting - Pattern', 'Pattern Handlers', 'Pattern Room'),
('PR-C-PH-02', 'Piumi Fernando', 'Cutting - Pattern', 'Pattern Handlers', 'Pattern Room'),
('CDTE-01', 'Arjun Rajan', 'Digital - Cutting', 'Digital Team Executive', 'CD Operations Office'),
('DT-C-CST-01', 'Nadeeka Perera', 'Digital - Cutting', 'CDMS Support Team', 'CD Operations Office'),
('DT-C-CA-01', 'Ashan Mendis', 'Digital - Cutting', 'CDMS Admins', 'CD Operations Office'),
('DT-C-CA-02', 'Zainab Farook', 'Digital - Cutting', 'CDMS Admins', 'CD Operations Office')
ON CONFLICT (Employee_ID) DO NOTHING;


-- Seed RMW Materials
INSERT INTO RMW_Materials (Material_Code, Material_Category, Material_Name_Specs, Target_Brand_Usage, RMW_Storage_Bay, Managed_By_RMW_ID, Lot_Status) VALUES
('MAT-CRD-01', 'CAD Tooling Material', 'Heavy Kraft Pattern Cardboard (350 GSM Calendered)', 'CAD Pattern Blocks', 'RMW-Bay-T1', 'RMWC-C-01', 'Dispatched to CAD'),
('MAT-PLS-01', 'CAD Tooling Material', 'ABS Thermo-Molding Plastic Resin (3.0mm Polymer)', 'CAD 3D Molds', 'RMW-Bay-T2', 'RMWC-C-02', 'In Warehouse'),
('FAB-TR-01', 'Cutting Floor Fabric', 'High-Elastane Microfiber Jersey (78% Polyamide, 22% Elastane)', 'Triumph', 'RMW-Bay-F1', 'RMWC-C-03', 'Dispatched to Line 1'),
('FAB-TR-02', 'Cutting Floor Fabric', 'Ultra-Fine Brushed Modal Knit (85% Micro-Modal, 15% Elastane)', 'Triumph', 'RMW-Bay-F2', 'RMWC-C-01', 'In Warehouse'),
('FAB-VS-01', 'Cutting Floor Fabric', 'Signature Soft-Touch Nylon Tricot (82% Polyamide, 18% Elastane)', 'Victoria''s Secret', 'RMW-Bay-F3', 'RMWC-C-02', 'Dispatched to Line 2'),
('FAB-VS-02', 'Cutting Floor Fabric', 'Engineered Stretch Galloon Lace (88% Nylon, 12% Spandex)', 'Victoria''s Secret', 'RMW-Bay-F4', 'RMWC-C-03', 'In Warehouse'),
('FAB-LL-01', 'Cutting Floor Fabric', 'Interlock Technical Compression (77% Nylon, 23% Lycra Elastane)', 'Lululemon', 'RMW-Bay-F5', 'RMWC-C-01', 'Dispatched to Line 3'),
('FAB-LL-02', 'Cutting Floor Fabric', 'Brushed Weightless Double-Knit (81% Nylon, 19% Lycra Elastane)', 'Lululemon', 'RMW-Bay-F6', 'RMWC-C-02', 'In Warehouse'),
('FAB-NK-01', 'Cutting Floor Fabric', 'Dri-FIT Compression Recycled Poly (82% Poly, 18% Spandex)', 'Nike', 'RMW-Bay-F7', 'RMWC-C-03', 'Dispatched to Line 1'),
('FAB-NK-02', 'Cutting Floor Fabric', 'Ultra-Lightweight AeroVent Mesh (88% Polyester, 12% Spandex)', 'Nike', 'RMW-Bay-F8', 'RMWC-C-01', 'In Warehouse')
ON CONFLICT (Material_Code) DO NOTHING;


-- Seed CAD Markers & Garment Styles
INSERT INTO CAD_Markers (CAD_Marker_ID, Style_Code, Brand_Buyer, Model_Name, Design_Coordinator_ID, CAD_Handler_ID, CAD_Tooling_Material_Code, Cutting_Floor_Fabric_Code, Marker_Status) VALUES
('CAD-MK-01', 'TR-TAC-01', 'Triumph', 'Triaction Control', 'DDC-C-01', 'CAD-C-CPH-01', 'MAT-CRD-01', 'FAB-TR-01', 'Approved'),
('CAD-MK-02', 'TR-BMU-02', 'Triumph', 'Body Make-Up', 'DDC-C-01', 'CAD-C-CPH-02', 'MAT-CRD-01', 'FAB-TR-02', 'Approved'),
('CAD-MK-03', 'TR-AMC-01', 'Triumph', 'Amourette Charm', 'DDC-C-02', 'CAD-C-CPH-03', 'MAT-PLS-01', 'FAB-TR-01', 'Approved'),
('CAD-MK-04', 'TR-MTR-02', 'Triumph', 'Modal Triangle', 'DDC-C-03', 'CAD-C-CPH-01', 'MAT-PLS-01', 'FAB-TR-02', 'Approved'),
('CAD-MK-05', 'VS-BBV-10', 'Victoria''s Secret', 'Body by Victoria', 'DDC-C-01', 'CAD-C-CPH-02', 'MAT-CRD-01', 'FAB-VS-01', 'Approved'),
('CAD-MK-06', 'VS-DAD-11', 'Victoria''s Secret', 'Dream Angels Demi', 'DDC-C-02', 'CAD-C-CPH-03', 'MAT-CRD-01', 'FAB-VS-02', 'Approved'),
('CAD-MK-07', 'VS-SMC-20', 'Victoria''s Secret', 'Smooth Memory Contour', 'DDC-C-03', 'CAD-C-CPH-01', 'MAT-PLS-01', 'FAB-VS-01', 'Approved'),
('CAD-MK-08', 'VS-BSH-21', 'Victoria''s Secret', 'Bombshell Push-Up', 'DDC-C-01', 'CAD-C-CPH-02', 'MAT-PLS-01', 'FAB-VS-02', 'Hold - QC Flagged'),
('CAD-MK-09', 'W2AS4S', 'Lululemon', 'Energy Longline', 'DDC-C-02', 'CAD-C-CPH-03', 'MAT-CRD-01', 'FAB-LL-01', 'Approved'),
('CAD-MK-10', 'W2BL8S', 'Lululemon', 'Align Wirefree', 'DDC-C-03', 'CAD-C-CPH-01', 'MAT-CRD-01', 'FAB-LL-02', 'Approved'),
('CAD-MK-11', 'W2CC1S', 'Lululemon', 'Like a Cloud', 'DDC-C-01', 'CAD-C-CPH-02', 'MAT-PLS-01', 'FAB-LL-01', 'Approved'),
('CAD-MK-12', 'W2DW3S', 'Lululemon', 'Free to Be', 'DDC-C-02', 'CAD-C-CPH-03', 'MAT-PLS-01', 'FAB-LL-02', 'Approved'),
('CAD-MK-13', 'BV3636', 'Nike', 'Swoosh Medium-Support', 'DDC-C-03', 'CAD-C-CPH-01', 'MAT-CRD-01', 'FAB-NK-01', 'Approved'),
('CAD-MK-14', 'CZ4456', 'Nike', 'Indy Light-Support', 'DDC-C-01', 'CAD-C-CPH-02', 'MAT-CRD-01', 'FAB-NK-02', 'Approved'),
('CAD-MK-15', 'AJ0340', 'Nike', 'Alpha High-Support', 'DDC-C-02', 'CAD-C-CPH-03', 'MAT-PLS-01', 'FAB-NK-01', 'Approved'),
('CAD-MK-16', 'AQ4184', 'Nike', 'Rival Molded Cup', 'DDC-C-03', 'CAD-C-CPH-01', 'MAT-PLS-01', 'FAB-NK-02', 'Decommissioned')
ON CONFLICT (CAD_Marker_ID) DO NOTHING;


-- Seed Pattern Room Assets
INSERT INTO Pattern_Assets (Asset_ID, Tooling_Type, Model_Name, Style_Code, Brand_Buyer, Size_Category, Storage_Location, Operational_Status, Borrowed_By_ID, Shift_Checkout, Last_Used_Date) VALUES
('TR-PB-01', 'Pattern Block', 'Triaction Control', 'TR-TAC-01', 'Triumph', '34C', 'Rack A-01', 'Active on Line', 'CW-L1-CMO-01', 'Morning', '2026-10-28'),
('TR-PB-02', 'Pattern Block', 'Body Make-Up', 'TR-BMU-02', 'Triumph', '36C', 'Rack A-02', 'Available in Room', NULL, NULL, '2026-10-25'),
('TR-PM-01', 'Pattern Mold', 'Amourette Charm', 'TR-AMC-01', 'Triumph', '34D', 'Mold Cabinet 01', 'Available in Room', NULL, NULL, '2026-10-28'),
('TR-PM-02', 'Pattern Mold', 'Modal Triangle', 'TR-MTR-02', 'Triumph', '38D', 'Mold Cabinet 02', 'Pending Removal', NULL, NULL, '2026-02-10'),
('VS-PB-01', 'Pattern Block', 'Body by Victoria', 'VS-BBV-10', 'Victoria''s Secret', '34B', 'Rack B-01', 'Available in Room', NULL, NULL, '2026-10-27'),
('VS-PB-02', 'Pattern Block', 'Dream Angels Demi', 'VS-DAD-11', 'Victoria''s Secret', '36D', 'Rack B-02', 'Active on Line', 'CW-L2-CMO-01', 'Morning', '2026-10-28'),
('VS-PM-01', 'Pattern Mold', 'Smooth Memory Contour', 'VS-SMC-20', 'Victoria''s Secret', '36B', 'Mold Cabinet 03', 'Available in Room', NULL, NULL, '2026-10-28'),
('VS-PM-02', 'Pattern Mold', 'Bombshell Push-Up', 'VS-BSH-21', 'Victoria''s Secret', '32C', 'Mold Cabinet 04', 'Inspection Flagged', NULL, NULL, '2026-10-26'),
('LL-PB-01', 'Pattern Block', 'Energy Longline', 'W2AS4S', 'Lululemon', 'S', 'Rack C-01', 'Available in Room', NULL, NULL, '2026-10-24'),
('LL-PB-02', 'Pattern Block', 'Align Wirefree', 'W2BL8S', 'Lululemon', 'M', 'Rack C-02', 'Active on Line', 'CW-L3-CMO-01', 'Morning', '2026-10-28'),
('LL-PM-01', 'Pattern Mold', 'Like a Cloud', 'W2CC1S', 'Lululemon', 'M', 'Mold Cabinet 01', 'Available in Room', NULL, NULL, '2026-10-20'),
('LL-PM-02', 'Pattern Mold', 'Free to Be', 'W2DW3S', 'Lululemon', 'L', 'Mold Cabinet 02', 'Available in Room', NULL, NULL, '2026-10-28'),
('NK-PB-01', 'Pattern Block', 'Swoosh Medium-Support', 'BV3636', 'Nike', 'M', 'Rack D-01', 'Available in Room', NULL, NULL, '2026-10-28'),
('NK-PB-02', 'Pattern Block', 'Indy Light-Support', 'CZ4456', 'Nike', 'S', 'Rack D-02', 'Available in Room', NULL, NULL, '2026-10-22'),
('NK-PM-01', 'Pattern Mold', 'Alpha High-Support', 'AJ0340', 'Nike', 'L', 'Mold Cabinet 03', 'Available in Room', NULL, NULL, '2026-10-28'),
('NK-PM-02', 'Pattern Mold', 'Rival Molded Cup', 'AQ4184', 'Nike', 'XL', 'Mold Cabinet 04', 'Decommissioned', NULL, NULL, '2025-11-15')
ON CONFLICT (Asset_ID) DO NOTHING;


-- Seed QC Defect Codes
INSERT INTO QC_Defect_Codes (Defect_Code, Defect_Name_Symptom, Fault_Category, Severity_Level, Target_Asset_Status, Reported_By_Role_ID, Assigned_Resolver_Role_ID, Mandatory_System_Action) VALUES
('DEF-01', 'Frayed or Torn Cardboard Pattern Block Edge', 'Pattern Block Fault', 'High risk', 'Inspection Flagged', 'QCI-C-01', 'PR-C-PH-01', 'Lock Pattern QR, Flag Asset ID as Inspection Flagged & Alert Management'),
('DEF-02', 'Warped or Cracked 3D Plastic Pattern Mold', '3D Mold Fault', 'High risk', 'Pending Removal', 'QCI-C-02', 'CAD-C-CPH-01', 'Lock Mold QR, Flag Asset ID as Pending Removal & Alert Management'),
('DEF-03', 'Lectra Cutter Blade Drift & Kerf Misalignment', 'Lectra Machine Fault', 'High risk', 'Active on Line (No Lock)', 'QCI-C-03', 'CS-L1-01', 'Halt Cutting Head, Send Re-Cut Request to Supervisor & Alert Management'),
('DEF-04', 'Fabric Spreading Layer Tension Slippage & Distortion', 'Spreading Fault', 'Medium risk', 'Active on Line (No Lock)', 'QCI-C-01', 'CS-L2-01', 'Send Re-Cut Request to Supervisor & Log Ply Defect'),
('DEF-05', 'Fabric Roll End-to-End Shade Variation & Fiber Slubs', 'RMW Fabric Fault', 'High risk', 'Active on Line (No Lock)', 'CQCE-01', 'RMWC-C-01', 'Hold Fabric Lot, Request RMW Replacement Roll & Alert Management'),
('DEF-06', 'CAD Marker Grading Mismatch & Overlapping Cut Lines', 'CAD Marker Fault', 'High risk', 'Active on Line (No Lock)', 'QCI-C-02', 'CAD-C-MM-01', 'Hold Style Code, Flag CAD Marker for Re-Grading & Alert Management'),
('DEF-07', 'Bundle Ticket Missing Ply Sequential Notch Numbering', 'Bundling Fault', 'Low risk', 'Active on Line (No Lock)', 'QCI-C-03', 'CS-L3-01', 'Route Bundle for Hand Trimming & Notify Bundling Lead'),
('DEF-08', 'Delaminated Base Plate on High-Compression Contour Mold', '3D Mold Fault', 'High risk', 'Decommissioned', 'QCI-C-01', 'CAD-C-CPH-02', 'Lock Pattern QR, Flag Asset ID as Decommissioned & Alert Management'),
('DEF-09', 'Vacuum Table Pressure Loss & Cut Ply Shifting', 'Lectra Machine Fault', 'High risk', 'Active on Line (No Lock)', 'CQCE-01', 'CS-L1-01', 'Send Maintenance Request & Alert Management'),
('DEF-10', 'Woven Selvage Bowing & Bias Distortions Across Spread', 'RMW Fabric Fault', 'Medium risk', 'Active on Line (No Lock)', 'QCI-C-02', 'RMWC-C-02', 'Log Fabric Shading Issue & Request Replacement Roll from RMW')
ON CONFLICT (Defect_Code) DO NOTHING;
