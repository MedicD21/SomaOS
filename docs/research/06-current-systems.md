# SomaOS Research 06: The Owner's Current Systems (Delaware County EMS)

Research date: 2026-11-27.

**Method and limits.** This was a read-only walk through the owner's logged-in browser sessions, using a **member-level account** (rank Lieutenant). Nothing that changes data was clicked or submitted. Some of the forms opened to show their field lists were closed again without saving. **No personal data was copied**: no names, member IDs, pay rates, balances, addresses or credential numbers. Admin screens were out of view: Aladtec scheduler/approval pages, NinthBrain admin rules, Front Line Back Office and the county payroll set-up tables. Anything learned only by inference is tagged **[U]**. **[O]** means seen directly on screen.

The draft template built from this is `packages/templates/src/drafts/delco-ems.ts`. It is deliberately not registered in `TEMPLATES` and is tested in `packages/templates/tests/delco-ems-draft.test.ts`.

| System | Vendor / product | Used for |
|---|---|---|
| "EMS Manager" | **Aladtec** (secure2.aladtec.com/delcoems) | Scheduling, time clock, time off, trades, open shifts, some forms, legacy storage |
| NinthBrain | **Ninth Brain Suite** (suite.ninthbrain.com, company 112068) | Credentials, training/courses, training calendar, SOG and document library (File Cabinet), required reading, checklists |
| Frontline | **Operative IQ Front Line** v1.57.0 | Unit inspections (questionnaires), cabinet/kit inventory with PAR, supply requisitions, service desk |
| Payroll | **CentralSquare Finance Enterprise** 24.1 "Employee Online" (county, behind VPN) | Check stubs, leave balances and ledgers |

Other systems named on screen: CrewForce (crew sign-in/out, referenced by both truck checks), Active911 (alarms on the Aladtec home page), ImageTrend (ePCR, NEMSIS 3.5 update memo), ExecuTime (an "ExecuTime Emp#" field in Aladtec, so likely the old timekeeping link) **[U]**.

---

## 1. Aladtec ("EMS Manager"): scheduling and time

### 1.1 Shift pattern and platoons [O]
- Three platoons, called **"1 Unit", "2 Unit", "3 Unit"**. Aladtec's "Duty Day" field also has "40 hrs" and "Part-Time". The monthly calendar prints the platoon number on each day.
- The pattern is **24 on / 48 off**, rotating daily: 2026-11-02 = 1, 11-03 = 2, 11-04 = 3, and so on. No Kelly day appears in a month of the owner's schedule.
- Medic units run **06:00–06:00**. The captain units (Capt. 461, Capt. 462) run **07:30–07:30**, which needs a second pattern.
- Payroll Verification uses the same platoon list for "Shift Assignment": 1 Unit, 2 Unit, 3 Unit, Part-time.

### 1.2 Schedules (units) and positions (seats) [O]
- Schedules: Capt. 461, Capt. 462, Medic 1 to Medic 11, Float, EMS Bike 461, Special Events, Paddock, Logistics, Training Classes, Orientation.
- Positions: Captain, Lieutenant, Paramedic, EMT, Bike Medic, Orientation.
- A medic unit has **three seats: 1 Lieutenant and 2 "Paramedic" seats**. EMTs are scheduled into the "Paramedic" seat (several third seats are filled by EMTs), so seat 3 behaves as "Paramedic or EMT". **[U]**: confirm the seat qualification rule.
- **Partial seats**: a 24 h seat can be split into 06–12 / 12–06 or 06–18 / 18–06. An uncovered part shows as "Open".
- Stations: M1–M10, EMS461, EMS462, Admin, Floater, Logistics, n/a. Station 11 exists in Front Line and in the time clock.

### 1.3 Ranks and member fields [O]
- Rank list: Chief, Asst. Chief, Tour Commander, Captain, Lieutenant, ESOM, Training Officer, Paramedic, Intermediate, Basic, Orientee, LEADS, Dispatcher, EMS Maintenance. **[U]**: the seniority order in the draft is assumed.
- Work Group (e.g. "Full-time employees"), Pay Period ("Default"), Pay Profile ("EMS"), Time Clock User, Employee Type (Full Time / Part-Time).
- **Pay Class: 300 (FTPM Medic), 320 (PTIN), 330 (FTPM Captains)**. These become the draft's pay groups.
- Custom fields include promotional dates, an emergency contact block, and a 911 (dispatch) certification block (LEADS, CPR, APCO EMD/PST/FEC/LEC/CCS/CTO and instructor variants). The tenant is shared with the communications centre (Del-Comm forms).

### 1.4 Time clock [O]
- Members clock in and out against a **location** (e.g. "Station 8"), with **"Early"** flags and notes. Each worked row carries a **Paycode** ("Regular time").

### 1.5 Time off types (38, exact Aladtec labels, in order) [O]
Sick Leave · Sick Leave - Administrative Use · Personal Leave · Vacation Leave · Compensatory Leave · DTU / MTU Leave · Training Leave · Instructor Leave · Peer Support Leave · Union Leave · Leave Without Pay · Military Leave · Jury Duty · Court Leave · Funeral Leave · Absence Without Leave (AWOL) · DMAT · Holiday Paid · Unexcused · Admin Leave · Honor Guard · FMLA · FMLA - Sick · FMLA - Vacation · FMLA - Comp · FMLA - LWOP · Tardy · Holiday Comped · Unpaid Admin Leave · Unpaid Military · Holiday not Worked Comped Captain · Holiday not Worked Paid Captain · Ohio Task Force One · Admin Leave - Covid · Instructor SCE Leave · Teaching Leave Non-Union · Admin · Other

- The request dialog shows **projected hours** for the range (24 h for one shift) and a per-year history.

### 1.6 Holidays (home page wording, transcribed) [O]
- To have holiday hours **paid**, a member submits a time-off request of type "Holiday Paid" on a day they are **not** scheduled, with times matching the holiday hours. **The date must fall in the same pay period as the holiday.**
- Members who want the holiday hours in their **comp bank do nothing**: comp is the default.
- Holidays are **8 h** each on the calendar (e.g. "Veterans Day-8HR Holiday", "Thanksgiving (8 HR Holiday)", "Day after Thanksgiving (8 HR Holiday)"). Holiday rows run 06:00–14:00 (8 h). One Holiday Paid row was 12 h **[U]**.

### 1.7 Open shifts and trades [O]
- Open shifts show in purple on My Schedule. The member picks a start and end time and clicks "Submit Request", and gets an email or text if awarded.
- **Full-time members cannot sign up for a full 24 h open shift.** They sign up for the AM and PM halves separately. Part-time members may request months ahead.
- Trades: "Request Trade" against a scheduled shift (the window covers 16 months ahead). A "Swap Shift" variant exists. Status values: Canceled by Member, Denied by \<member\>, Assigned to \<member\> by \<approver\> on \<date\>. Officers approve trades.
- The Daily view also has **Extra Hours** and **Events** (students, ride-alongs, public events) sections.

### 1.8 Pay periods and verification [O]
- **14-day pay periods starting Saturday 06:00**: Nov 7–21, Nov 21–Dec 5, Dec 5–19 2026.
- "Payroll Verification" is an Aladtec form. Each member reviews every time record in the period (Start, Stop, Schedule, Position, Time Type/Paycode/Time Off Type, **Time Category** (Time Worked / Time Off), Hours), confirms "Hours Verified" or enters different hours and notes, and signs. The supervisor and then the Director/Chief approve.
- "Compensatory Time Earned Payout Request" form: the member enters hours to pay out, request date and payout date. Payroll fills in the current-year and prior-year hours, the **overtime rate** and the amount. Approval goes Payroll Manager → Director → County Admin.

### 1.9 How the schedule views look (UI reference; the owner likes these) [O]
- **Daily Summary view** (Schedules): one block per schedule (Capt. 461 … Medic 11). Each block has one row per seat: Start, Stop, Position, Member, Clock In (time and location, flags), Clock Out, Paycode. Split seats show as extra rows, and an uncovered piece reads "Open". Below the unit blocks are sections for **Extra Hours, Trades, Time Off** (type, start, stop, member) and **Events**. The header has Day / Week / Custom / Month and a saved filter. A "Split Time of Day: 06:00" setting defines the operational day.
- **My Schedule month view**: a calendar with the **platoon number on every date**. Shift chips show unit / position / hours, approved time off shows as a chip, and events appear with their location. Left-hand toggles control what shows (Scheduled Time, Extra Hours, Time Off, Trades, Open Shifts, Events). Actions: Add Trade Request, Request Time Off, Share My Schedule (calendar feed).
- **Home dashboard**: upcoming shifts, events, available trades, discussions, recent alarms (Active911).
- **Out of view**: the captain/scheduler side (approvals, filling open seats, building the schedule). SomaOS should design that side fresh rather than copy it.

---

## 2. NinthBrain: credentials, training, documents

### 2.1 Credentials [O]
- **Required credentials are set per position.** The Lieutenant set is ACLS RQI, BLS RQI, PALS RQI, CADS, Death Notification, Driver's License (state), EVOC, Handtevy, HazMat First Responder Awareness, IS/ICS/NIMS-100/200/700/800, ITLS/PHTLS/BTLS, Ohio: Paramedic. "Field Training Officer" is a second position set (no requirements shown).
- Other credentials on the record: NREMT - Paramedic, PALS/PEPP/EPC, Rescue Task Force Awareness, Dementia Training for Ohio EMS.
- Validity observed (issue → expiry): NREMT 2-year 31 March cycle; Ohio Paramedic 3 years minus a day; RQI cards ~24 months, end of month; EVOC 1 year; HazMat ~1 year; ITLS 3 years; PALS/PEPP/EPC 4 years; Handtevy 2 years; NIMS / CADS / Death Notification no expiry. **[U]**: these are single-record readings and need confirming.
- Each credential has a "Maintained" yes/no flag, a document attachment, Select / Recertify actions, and **CE Credit Activity** tracked against the credentials that need CE (EVOC, Handtevy, NREMT, Ohio Paramedic).
- The member profile has a National EMS ID field.

### 2.2 Training [O]
- **Course catalog** filters: Sponsoring Organization (Delaware County EMS, Emergency Resilience, NAAC, NEMSMA, OAPFF, Ohio State University, Prehospital Care Board, Prevention Awareness Support Services, Prior Learning, VR Patients, Zoll); Tag (Core Comp, SCE, FTO, FTEP, Mandatory, Monthly, Medical Director Zoom, Handtevy, ACLS, BLS, CPR, ITLS, EPC, Pediatric, Peer Support, leadership, New Hire Employee, VR, Winter Conference, Zoll…); **Category: ARV, Cardiology, CISM, Geriatrics, Instructor, Medical, Operations, Pediatric, Special Considerations, Trauma**; Status: Draft, Active, Discontinued; online component yes/no.
- Columns: Title, Credit (hours), Online Component, Status, Expiration Date. Completed-course credits seen: 0, 0.5, 0.75, 1. Category on calendar events: "Training, Education, or Clinical".
- Program shapes: an annual **Core Competency Process** (2026 topics: Adult Poisoning, Difficult Airway, Geriatric Injury, Operations/HIPAA, Pediatric Seizures), **quarterly Sim Lab**, **quarterly ALS Protocol Exam** (course assignment with a due date), **monthly Medical Director Zoom**, Lunch & Learn, Zoll Zenix/NXT training, leadership training, an education retreat.
- **Shift Clinical Educator (SCE) sessions**: one topic is delivered on duty by an SCE to a list of units on a given shift day (e.g. "SCE \<name\> - Environmental Emergencies - M3, M10, 06:00–13:30"), repeated across several days until every unit and platoon has had it. This needs "session targets units, attendance taken per crew".
- **Central Calendar** has calendars (Company Meeting/Outing, Education/Training, My Upcoming Due Dates), registration and a wait list, an iCal feed, and due dates for reading and course assignments.
- **Assignment audiences**: positions (Director of EMS, Assistant Chief of Administration/Operations, Captain of Operation, CQI Captain, Training Captain, Lieutenant, Paramedic, AEMT, EMT, FTO, SCE, EMS Instructor, Logistics Coordinator, Peer Support Team Member, EMA, EMS Education and Compliance Coordinator); platoons (1/2/3 Unit, Admin, Part-Time); groups (All Officers, Chiefs, Command Staff, Core Comp Instructors, Fitness Team, Peer Support Team, Union E-Board, Human Resources, Medical Directors, and "Delaware County Employee (outside of EMS)").
- **[U]** Annual CE hour requirements by level were not visible. The draft leaves `requirements` empty.

### 2.3 Documents and SOGs (File Cabinet) [O]
- The folder tree is three to four levels deep. Top level under DCEMS: Admin, AHA Paperwork, Ballistic Care, Community Outreach, Documentation Downtime Forms, Employee Engagement Survey, Fitness, Forms (Narcotic/Medication, Ride-Along), FTEP, Human Resources, Infection Control, InMotion/Sierra Wireless, Instructions, Job Descriptions, Memos (CQI/Documentation, Medication, Promotional by year, Protocol Update, SOG, Training), Mental Health Resources, Newsletters, Nutrition, Paramedic School, Reports, Ride-Along Waivers, Shift Clinical Educator, **SOGs (100–600 Series)**, Teams and Committees, Training, Veterans Information. Root folders also include 2023–2026 CBA, DART, DCFC SOG's, Delaware County, Fair Plan, Meeting Notes (Bike Team, Command Staff, Community Relations, Fitness/Wellness, Honor Guard, Labor Relations, Safety Committee, Standardization Committee), Officer Promotion List, SCE (by year), Travel.
- **Required Reading Assignments**: a document with a due date and status (Required / Overdue), e.g. SOG 201, SOG 130, SOG 132, SOG 207, and a clinical memo.
- **SOG index** (exact titles):
  - **100 (Administration):** 100 Policy Access · 101 Attention to Duty, Outside Employment · 102 Chain of Command · 103 Uniform and Hair · 105 Duty, Rest, and OT · 106 Employee Discipline · 108 Employment relationship of Family Members · 109 Part-Time Employees · 110 Security · 111 HIPAA · 112 Incident Reporting · 113 Infection Control · 114 Change of Employee Data · 115 Patient Non-Discrimination Policy · 116 Personnel Station Transfers (listed twice) · 121 Records Retention & Maintenance · 122 Data Back-Up · 123 Line of Duty Death · 125 Release of Information to the Media · 126 EMS Observer Program · 127 Community Outreach Committee · 128 Flag Etiquette (two versions) · 130 Mandatory Overtime · 131 Fleet Fuel Cards · 132 Fitness and Wellness · 133 Light Duty · 134 Employee - Student Ride Time · 135 Ambulance Billing · 136 Ethics & Equipment · 137 Employee Promotions · 138 Fraternization and Personal Relationships
  - **200 (Operations):** 200 Daily Operations (+ Appendix A) · 201 Staffing, Scheduling, Scheduled Leave and Part-Time hours · 202 Response, Treatment, Transport & Response Time, Reporting & Monitoring · 203 Scene Safety, Personal Protective · 204 First Arriving DCEMS Unit · 205 Mutual Aid · 206 Emergency Vehicle Operation · 206.1 Trailers and Utility Vehicle Operations · 207 Radio Communications · 208 Emergency Vehicle Staging at Incidents · 209 Personnel Accountability Reporting · 210 Personnel Emergency Evacuation · 212 DOA Procedure · 213 Safe Lifting · 214 Crime Scene and Evidence Preservation · 215 Air Medical Transport · 217 Pharmacy Distribution and Control · 218 Equipment Failure · 219 Disposable, Single Patient Use Items · 220 Patient Property Handling · 221 Critical Incident Stress Management · 222 Durable Medical Equipment Maintenance · 223 Bed Bug Infestation Mitigation Plan · 224 Power Backup · 225 Mechanical Cylinder Lift System · 226 Spit Sock Hood · 230 ToxiRae 3 CO Detector · 231 Equipment Batteries · 232 Medical Care to Animals · 233 Third Party Drivers
  - **300 (Quality):** 300 Continuous Quality Assurance and Improvement · 301 Clinical Standards · 302 Patient Care Guideline Review · 303 Audio and Video Recording for Continuous QI · 304 Customer Service Survey
  - **400 (Education):** 400 Continuing Medical Education and Maintenance of Certification · 401 Maintenance and Verification of Required Certifications · 402 Cancellation of Training or Meetings · 404 DCEMS CPR Program · 405 CAPCE Data Management · 406 Education Committee · 407 Training Evaluations · 408 Conflict of Interest · 409 Training Equipment
  - **500 (Infection control / safety):** 501 Exposure Control Plan · 502 Exposure · 503 Tuberculosis Plan · 504 Respiratory Protection Program · 505 Hazard Communication Program · 506 HIV Plan
  - **600:** 600 HIPAA
- **Clean-up items for import**: titles carry file-name residue ("JBB edit", ".edited", "AIH Approved 1-10-24"), duplicates exist (116, 128), and folders mix SOGs with memos. A legacy Aladtec Storage area (DCFC SOGs, DCEMS, MSDS, 2018/2019 Emergency Response Plans, DART handbook) also holds documents.

---

## 3. Operative IQ Front Line: assets and inventory

### 3.1 Assets [O]
- A unit card shows location • asset type • status, for example "Station 3 • Ambulance - Gas • In-Service". Name format: "-Medic 8 (2024 Frazer, Letter)", "6x, Spare Truck (2016 Horton, Q)", "4X, Stocked Spare (2018 Horton, N)".
- Asset types seen: Ambulance - Diesel, Ambulance - Gas, Malibu (staff car). Statuses: In-Service, Reserve. Inspection status: Closed, In-Process, Expired. Spare trucks are tracked as stocked or unstocked.

### 3.2 Unit inspection [O]
- A unit inspection has four parts: **Cabinet Inventory** (13 cabinets on Medic 8), **Kit Inventory and Verification** (19 kits checked out to the unit), **Questionnaires** assigned to the unit type, and **Inspection Notes** that carry across inspections. Supply requests are raised from the inspection.
- **Questionnaires on Medic 8**: required daily are "Daily Vehicle Driver Inspection (Gas)" (34 items) and "Daily PRIMARY Rear Check" (57 items). Not required (on demand) are "Truck Switch Form (To/From an empty truck)", "Variance Report" and "Drug Expiration Form" (record the number of expired meds this month and on the 1st of next month; resealing is logged in the individual kit logs). Full item lists are transcribed in the draft template.
- Answer kinds: Yes/No (No requires a comment), **multiple choice** (fuel: Full / 3/4 / 1/2 (Refuel) / <1/2 (refuel, Captain notified); oil and transmission: Full / Added (<1 qt) / Critically Low (>1 qt) / N/A sealed; tires: Pass / Air added / Needs repair), free text (seal numbers), and numeric (mileage, O2 reading, temperatures, battery %). Each questionnaire has "Save In Process" and "Submit".
- **Medic 8 cabinets** (Frazer box), with item counts: Cabinet A (58 items: PPE, airway, suction, O2, NPAs, ET tubes, Air-Q, CPAP, BVM), B (3: AutoPulse band, C-collar, MCI bag), C (21: dressings, tape, tourniquet, gauze), D (12: splints, OB kits, hot/cold packs, burn sheet, arm boards), IV Restock (8), IV/IO Access (7), Syringes/Needles Drawer (13), Drug Drawer Medical Supplies (1), E (8: stethoscope, glucometer, BP cuffs), F (10: O2 wrench/adapter, lancets, probe covers, batteries, restraints), G (19: Zenix cables, pads, SpO2, electrodes, AutoPulse battery), H (4: AutoPulse, stat packs, Handtevy bag), I (4: blanket, property bags, narcotic sheet binder, security seals).
- **Each cabinet line has: part code + description (with unit of issue, e.g. EA, BX, Kit), PAR, last quantity, on hand, expiration date and lot #.** Part codes are letter+number, e.g. C70, J34, D40, B44, E34. Descriptions include restock hints such as "Order by 3's" and "Extra @ D65". Sample PARs (Cabinet A): N95 3, safety glasses 3, earplugs 3, saline bullets 4, adult NC 2, Zenix ETCO2 NC 10, NRB 2, lube 8, most airway items 1.
- **Kits on Medic 8** (19): Avulsion Kit, Bed Bug Kit/Bag, Eye Care Kit, Fire Rehab Bag, IV Roll ×3, Airway Bag (Green), C-Spine Bag, Drug Drawer Medical Supply Kit, Drug Drawer – Medications, First In Bag (Red), Handtevy Bag (Blue), RTF Bag ×3, Sterile Suction Kit, Zenix Monitor. A kit is inspected (contents) and verified (present). Kits can also be checked out to a person.
- Front Line home screen: Supply Management (Transfer, Issue, Cycle Counting), Unit Inspection, Submit Requisition, My Inventory, Service Desk Tickets.

---

## 4. County payroll (CentralSquare Employee Online)

Code names only. The owner notes this is **a partial list**: only codes that appeared on one member's recent stub and leave ledgers were seen.

### 4.1 Earnings codes [O]
| Code | Meaning (inferred **[U]** unless obvious) |
|---|---|
| EMS SREG | Regular hours. Exactly **80 h per pay period** on the stub. |
| EMS SOT | Overtime at **1.5× the SREG rate** (rate ratio observed). The hours above 80 in the period. |
| EMSHOLPD | Holiday paid (straight rate) |
| EMS VTKN | Vacation taken |
| EMSVTOVT | Vacation taken, overtime portion **[U]** |
| EMSSTKNO | Sick taken **[U]** |
| STKNOVT | Sick taken, overtime portion **[U]** |
| EMSST | Sick (unclear how it differs from EMSSTKNO) **[U]** |
| EMSPERS | Personal leave taken |
| EMS CTKN | Comp time taken |
| EMSVTOVT, STKNOVT | Suggest leave inside the overtime portion of a period is paid at the OT rate, i.e. leave counts toward the 80 h threshold **[U]** |

### 4.2 Leave ledger codes and accrual behaviour [O]
- Balances tracked: Vacation, Sick Leave, Personal Leave, Military Leave, Comp. Time, FMLA. The stub prints beginning / earned / used / adjust / ending per bank each period.
- Ledger period id format `YYNNNNN`, e.g. 2601024 = 2026, pay 24 (26 pays a year).
- Vacation: accrual code **VEMS**, the same amount every pay period (tiered by service; the county table was not visible). Taken: EMS VTKN, EMSVTOVT.
- Sick: accrual code **SEMS**. The amount **varies each period**, consistent with Ohio ORC 124.38 (4.6 h per 80 h in active pay status) **[U]**. Taken: EMSSTKNO, STKNOVT, EMSST.
- Personal: **48 h granted once a year (early December, code PADJ)**, used in 24 h blocks (EMSPERS).
- Comp: earned **EMSCE** (values seen: 0.5, 1, 12, 12.5, 17.5, 24), taken EMS CTKN, and **CPO 120P**, possibly a payout when the bank passes 120 h **[U]**.
- Paydays fall on Fridays (EFT), about 5 days after the period ends. The stub shows period 11/07–11/20.

---

## 5. What the SomaOS engines cannot express yet (do not hack around; plan these)

1. **Leave paid at the OT rate when it falls above the threshold** (EMSVTOVT / STKNOVT). The pay engine always pays leave at multiplier 1 under the leave code (`pay.ts`, `pay.leave`). Needs: per leave type, an "OT-portion code" and multiplier.
2. **Holiday default-to-comp with opt-in pay inside the same pay period.** There is no holiday calendar or per-holiday 8 h credit. `annual_front_load` (96 h on 1 Jan) does not match. Needs: a holiday calendar (hours per holiday, platoon rules), a default destination (comp bank), and a "paid" election bounded to the holiday's pay period. The captain variants ("Holiday not Worked Comped/Paid Captain") suggest different rules for the 330 group.
3. **Annual grant on a date other than 1 January** (personal 48 h in early December). `annual_front_load` is hard-wired to Jan 1.
4. **Accrual on hours in active pay status** (leave included) rather than hours worked. `per_hours_worked` uses `hoursWorked` only.
5. **More than one shift pattern per department** (medic units 06:00 vs captains 07:30). The template carries a single `schedulePattern`.
6. **Seat qualification "Paramedic or EMT"** and **split seats** (06–12/12–06, 06–18/18–06), plus the open-shift rule "full-time members may claim only half of a 24 h open seat". Check against Phase 1d before building.
7. **Multiple-choice checklist items** with per-choice pass/fail and "No requires a comment". The checklist item kinds are pass_fail / number / text only, so the draft flattens them.
8. **Cabinet/compartment PAR per unit and kits** (kit contents, kit checked out to unit or person, seal/expiry/lot per line). The inventory template's `items` has no location or PAR. Check the inventory module's stock-location model before adding.
9. **Training sessions targeted at units and platoons** (SCE delivery to M3, M10 on a given shift day) and **audiences by position, platoon or group** for assignments.
10. **Payroll verification**: member attests each time record per period, then supervisor and chief approve. Compare with payroll close (Phase 2).
11. **Credential validity "issue + N years − 1 day"** and **"end of month"** expiries. `months` lands a day late or early.

---

## 6. Export formats found (for importer planning)

| Source | What exists | Format |
|---|---|---|
| Aladtec | Reports → Individual Member (Day/Week/Custom/Month range; default range is a pay period); Share My Schedule (calendar feed); Print | Report output and export formats not opened **[U]**. Aladtec admin reports and exports need the owner's admin. |
| NinthBrain | Reports: My Reports (custom report builder, e.g. "VR 3/4"), Scheduled Reports, Predefined Reports (Calendar Attendance, Attendance Summary, Registration, Forms…); "Generate PDF of Attached Documents" on credentials; iCal subscription for the calendar; File Cabinet documents downloadable one by one | Report file formats not opened **[U]**; credentials → PDF bundle [O]; calendar → iCal [O] |
| Front Line | Print Supply Request; Knowledge Center user guide; Back Office (not visible) | Bulk export (parts, PAR, cabinets) needs Back Office access **[U]** |
| CentralSquare | Check stubs and leave ledgers on screen; W-2 / 1095-C pages | No bulk export for members. Payroll export layout must come from county payroll. |

Importer stub: `docs/superpowers/plans/2026-11-27-current-systems-importers.md`.

---

## 7. Questions for the owner

1. Is 80 h / 14 days overtime a contract rule or the FLSA election? Which leave types count toward it (vacation, sick, comp, holiday)?
2. What do EMSST, EMSSTKNO/STKNOVT, EMSVTOVT and CPO 120P mean exactly? Can county payroll send the full earnings code list?
3. Vacation accrual table by years of service, max carryover, and the comp bank cap and payout rule (120 h?).
4. Sick accrual: is it ORC 124.38 (4.6 / 80 h in pay status)? Cap? Conversion at retirement?
5. Holiday list and hours per holiday for 24 h staff vs captains vs 40 h staff.
6. Seat rules: can an EMT always fill the third seat? Minimum staffing per unit? Who may act as Lieutenant?
7. Which Aladtec time-off types are still in use (e.g. Admin Leave - Covid, Tardy)? Which need documentation, and what lead time?
8. CE requirements per level (Ohio and NREMT hours by category) and which NinthBrain categories map to NCCP national/local/individual.
9. Can someone with admin rights export: Aladtec schedules and time-off history, NinthBrain course catalog and credential records, Front Line part master with PAR by cabinet and kit templates?
10. Rank order and which titles (Tour Commander, ESOM, Training Officer, FTO, SCE) are ranks versus assignments.
