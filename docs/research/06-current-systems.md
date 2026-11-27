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
- Aladtec rank list: Chief, Asst. Chief, Tour Commander, Captain, Lieutenant, ESOM, Training Officer, Paramedic, Intermediate, Basic, Orientee, LEADS, Dispatcher, EMS Maintenance. The owner's rank order is in §8.1.
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
| EMSST | Sick taken at straight time (owner) |
| EMSSTKNO | Sick taken, built-in overtime portion? (owner unsure) **[U]** |
| STKNOVT | Possibly FMLA-related; first appeared in an FMLA pay period (owner) **[U]** |
| EMSPERS | Personal leave taken |
| EMS CTKN | Comp time taken |
| CPO 120P | Comp bank payout elected by the employee (owner) |

The "OVT" codes exist because vacation and sick count toward the **built-in** overtime of the regular schedule (CBA 20.1, 22.3). Leave falling in the overtime hours of a week is paid at 1.5×. The owner is getting the full code list from payroll.

### 4.2 Leave ledger codes and accrual behaviour [O]
- Balances tracked: Vacation, Sick Leave, Personal Leave, Military Leave, Comp. Time, FMLA. The stub prints beginning / earned / used / adjust / ending per bank each period.
- Ledger period id format `YYNNNNN`, e.g. 2601024 = 2026, pay 24 (26 pays a year).
- Vacation: accrual code **VEMS**, the same amount every pay period (tiered by service; the county table was not visible). Taken: EMS VTKN, EMSVTOVT.
- Sick: accrual code **SEMS**. The amount **varies each period** because it is 0.0656 h per hour of regular work (CBA 20.1). Taken: EMSST, EMSSTKNO, STKNOVT.
- Personal: **48 h granted once a year (code PADJ)**, used in 24 h blocks (EMSPERS). The CBA limits it to two uses a year.
- Comp: earned **EMSCE** (values seen: 0.5, 1, 12, 12.5, 17.5, 24), taken EMS CTKN, and **CPO 120P** for an elected payout.
- Paydays fall on Fridays (EFT), about 5 days after the period ends. The stub shows period 11/07–11/20.

---

## 5. What the SomaOS engines cannot express yet (do not hack around; plan these)

Updated 2026-11-27 with the CBA and the owner's answers (§8).

**Pay and leave**
1. **Leave that counts toward overtime only for the built-in hours** (CBA 20.1, 22.3: sick, funeral and vacation count toward the 8 h / 32 h of scheduled overtime, but not toward any extra overtime). The engine has one `countsAsWorked` flag and pays leave at multiplier 1 under its own code. The draft sets `countsAsWorked: true`, which over-counts in weeks with extra hours, and the OT-portion codes (EMSVTOVT) are not produced. Needs: per leave type, "counts toward scheduled-hours overtime only", plus an OT-portion export code.
2. **Holiday calendar with a pay-or-comp election** (CBA 23): 8 h straight pay or 5.34 h comp per holiday (4 h / 2.67 h for Little Brown Jug Day and Christmas Eve), on the county's observed dates. Comp is the default, and paid holiday must be taken in the holiday's pay period. Nothing models a holiday calendar today; `annual_front_load` does not fit. The 2027 list is in the draft as `DELCO_HOLIDAYS_2027`.
3. **Comp time paid at 1.5× when used, with a 180-day use-by** (CBA 21.2): it accrues 1:1, caps at 160 h, and an elected payout (CPO 120P) is paid at the overtime rate. The engine has a cap, but no expiry and no "multiplier on use".
4. **Vacation earned as a lump at the first anniversary** ("two weeks" after one year, then pro rata per pay), and **carryover limited to three years with Director approval**. Accrual tiers cannot grant on an anniversary, and carryover is a balance cap, not an age limit.
5. **Personal leave limited by number of uses** (two per calendar year, minimum 2 h each, CBA 20.5), not hours.
6. **Flat hourly adders and annual supplements** (CBA 26.6–26.9): acting Lieutenant +$2.00/h after 6 consecutive hours, FTO +$2.00/h, SCE +$1.50/h on all hours (included in the overtime rate), instructor +$3.00/h, $360 a year each for Critical Care and FP-C, and frozen longevity ($100 per year of service as of 2019-01-01, paid bi-weekly). The pay engine has multipliers only.
7. **Trades** (CBA 21.5): trade hours are not overtime hours, and the absent member is credited as if they worked. Eligibility needs 48 h of sick and/or personal accrued. Trades must be paid back within 90 days, both dates are recorded, the cap is 48 continuous hours, and nobody drives after 24 h continuous. Same-day "unforeseen" trades are limited to two per 6 months. A no-show is charged to the absent-for member's sick bank unpaid, and a pattern of no-shows bars trading for a year. Check each rule against Phase 1c.
8. **Leave types visible by audience**: crew members should see only crew leave. `leave_types` has no visibility column. The proposed crew list is `DELCO_CREW_LEAVE_KEYS`.

**Scheduling and staffing**
9. **Minimum staffing as a department-wide count plus a per-unit rule**: at least **25 ALS providers on duty** (Paramedic and AEMT count as ALS) and **2 ALS per ambulance**. EMTs normally fill the third seat, and a unit may run 3 ALS. Any provider may pick up a Lieutenant open shift, and an EMT may take an open seat if the unit already has 2 ALS.
10. **Temporary transfer (TT) suggestions**: when a unit is short of ALS and the department is at or above 25 ALS, suggest moving an ALS provider from a unit that has 3 ALS.
11. **Mandate list** (owner's request): an easy-to-edit rotation list used when staffing drops below 25 ALS. It suggests the next member up for each hole and records who was mandated. CBA 21.4 says overtime rotates "in accordance with the applicable SOGs" (SOG 130 Mandatory Overtime).
12. **Out-of-class eligibility lists**: Paramedics acting as Lieutenant (in-charge pay), and members on the yearly Captain promotional list acting as Captain.
13. **More than one shift pattern per department** (medic units 06:00 vs captains 07:30). The template carries a single `schedulePattern`.
14. **Split seats** (06–12/12–06, 06–18/18–06) and the open-shift rule "full-time members may claim only half of a 24 h open seat".

**Inventory, training, other**
15. **Multiple-choice checklist items** with per-choice pass/fail and "No requires a comment". Checklist item kinds are pass_fail / number / text, so the draft flattens them.
16. **Cabinet PAR per unit, kits and supply-room reorder levels.** Operative IQ has cabinet types, kit types with seal/inspect flags, and supply-room reorder calculations (service level, order frequency, lead time, minimum supply days, demand weeks, seasonality). The inventory template has no PAR, cabinet or kit fields.
17. **Asset preventive-maintenance schedules** by asset class (e.g. Zoll monitor PM due dates) and maintenance types (Cleaning, Documentation, Incident, Monitor Battery Replacement, Preventative Maintenance, Purchase, Repair, Upgrade). Check against Phase 3a.
18. **CE tracking against Ohio and NREMT requirements, applied automatically from completed classes, with an audit view** (owner's request). Training requirements today are category hours in a window. They have no NCCP national/local/individual components and no per-certification renewal profile. The Ohio hour figures still need a primary source (research 04 C2).
19. **Training sessions targeted at units and platoons** (SCE delivery) and **assignment audiences** by position, platoon or group.
20. **Payroll verification**: the member attests each time record per period, then supervisor and chief approve.
21. **Credential validity "issue + N years − 1 day"** and **"end of month"** expiries. `months` lands a day late or early.

---

## 6. Export formats found (for importer planning)

| Source | What exists | Format |
|---|---|---|
| Aladtec | Reports → Individual Member (Day/Week/Custom/Month range; default range is a pay period); Share My Schedule (calendar feed); Print | Report output and export formats not opened **[U]**. Aladtec admin reports and exports need the owner's admin. |
| NinthBrain | Reports: My Reports (custom report builder, e.g. "VR 3/4"), Scheduled Reports, Predefined Reports (Calendar Attendance, Attendance Summary, Registration, Forms…); "Generate PDF of Attached Documents" on credentials; iCal subscription for the calendar; File Cabinet documents downloadable one by one | Report file formats not opened **[U]**; credentials → PDF bundle [O]; calendar → iCal [O] |
| Operative IQ (Front Line + back office) | Report Library by category (Asset Management, Fleet, Narcotics, Parts and Suppliers, Purchasing, Service Desk, Supply Room Management, Unit Inventory and Inspections…). Includes "Book of Bar Codes - Supply Parts", "Inventory - Total Count by Location", "Asset List by Category", "Preventative Maintenance Planning", "Unit Type Asset Class Requirements". Parts & Assets grid: 2,109 records (732 supply parts, 1,362 fixed assets, 14 catalog assets, 1 fleet part) | Report export format not opened **[U]**. The owner will pull the master supply list. |
| NEOGOV | Org chart with an Export button | Not used. Gives the position hierarchy. |
| CentralSquare | Check stubs and leave ledgers on screen; W-2 / 1095-C pages | No bulk export for members. Payroll export layout must come from county payroll. |

Importer stub: `docs/superpowers/plans/2026-11-27-current-systems-importers.md`.

---

## 7. Questions for the owner

The first round (10 questions) is answered in §8. Still open:

1. **The CBA ran November 1, 2023 – October 31, 2026.** Is a successor agreement signed or in negotiation? Every number in §8 must be re-checked against it.
2. Which day and hour does the overtime week start (assumed Saturday 06:00, with the pay period)?
3. Full payroll earnings and leave code list with definitions (EMSSTKNO, STKNOVT especially).
4. Ohio EMT / AEMT / Paramedic renewal hours and any department CE requirement beyond Ohio and NREMT.
5. Mandate list rules: order (seniority, hours, rotation?), who is exempt, does a mandate reset your position, and what SOG 130 says.
6. Pay rules for Captains and above (group 330, outside the CBA) and for part-time (PTIN, group 320).
7. Confirm the crew-visible leave list (`DELCO_CREW_LEAVE_KEYS`) and which admin-only types can be retired (Admin Leave - Covid, Tardy, DTU / MTU).

---

## 8. Owner answers and the CBA (added 2026-11-27)

Sources: the owner's answers in chat; the 2023–2026 agreement between Delaware County and IAEP Local R7-11 (NAGE-SEIU), SERB case 2023-MED-07-0542; the county 2027 holiday schedule; Operative IQ back office and NEOGOV org chart (read-only). Appendix A of the CBA lists hourly wages by employee number and was **not** copied.

### 8.1 Bargaining unit and ranks
- The bargaining unit is full-time EMT, Advanced-EMT, Paramedic and Lieutenant (CBA 2.2). **Captains and above are not covered.**
- Rank order (owner, NEOGOV): **Chief (Director of Emergency Services) → Assistant Chief → Captain → Lieutenant → Paramedic → AEMT → EMT.**
- Positions within ranks (NEOGOV): Assistant Chief of Administration (over Captain of Clinical Quality & Compliance, Training Captain, Captain of Education & Development); Assistant Chief of Operations (over the 6 shift Captains and the EMS Logistics Coordinator); a Fiscal Administrative Coordinator; full-time and part-time (PTIN) Paramedic and EMT. FTO and SCE are assignments for members below Lieutenant.
- Probation: 365 days for new hires, 180 days on promotion (CBA 7.1). Classification seniority (time in grade) decides station transfers (15.4). Lieutenant lists last 12 months (10.2).

### 8.2 Work week, overtime, comp, trades
- **24 on / 48 off** (21.1). Overtime is paid for **hours over 40 in a week**. That gives built-in overtime of 8 h in 48 h weeks and 32 h in 72 h weeks, so each cycle has **"long" pays (5 shifts) and "short" pays (4 shifts)** (owner).
- Base pay for 24/48 staff is set on 2,080 straight hours plus 832 built-in overtime hours at 1.5× (the yearly figures in CBA 26.3 equal hourly × 3,328).
- **Sick, funeral and vacation count as hours worked** for the built-in overtime only. **Personal, comp used and jury duty do not** (20.1–20.5, 21.2, 22.3).
- **Comp** is elected in lieu of overtime pay (the member classifies it at clock-in). It accrues 1:1, is paid at 1.5× when used, caps at **160 h**, and must be used **within 180 days**. The Director may deny a use that disrupts operations (21.2).
- **Call-back** not abutting the shift is paid at least **2 h** (21.3). Overtime rotates per SOG (21.4).
- **Trades**: see §5 item 7 (21.5).
- **Mileage** is reimbursed for mandated station-to-station travel, floaters and staffing moves, but not for trades or voluntary overtime (17.3).

### 8.3 Leave (CBA 20, 22, 23)
| Bank | Rule |
|---|---|
| Sick | **0.0656 h per hour of regular work**, no cap. Report 1 h before shift. At separation with 10+ years: ¼ paid out. At death: 1 h pay per 2 h (1:1 if line of duty). Transfers in from Ohio public employers within 10 years carry their balance. |
| Funeral | Up to **two 24 h tours** charged to sick, for immediate family plus grandparents-in-law, aunts and uncles. |
| Vacation (24/48) | **120 h/yr (1–7 yrs), 168 (8–14), 216 (15–24), 264 (25+)**, pro rata over 26 pays (4.62 / 6.46 / 8.31 / 10.15 h per pay). Two weeks after the first full year. None accrues on unpaid leave. Carryover for 3 years with Director approval. |
| Personal | **Two uses a year** when scheduled, 2 h minimum each, no carryover, not charged to sick (payroll grants 48 h). |
| Union | 150 h per contract for the president or designees. |
| Court / jury | Court on a subpoena from on-duty work is paid. Jury duty is paid at regular rate (fee turned in) and is not hours worked. |
| FMLA, military | Per law (19.2, 19.3). Unpaid disability leave up to 6 months after sick, comp and vacation are exhausted (19.1). |

**Holidays (23.1–23.2)**: 11 eight-hour holidays and 2 four-hour holidays (Little Brown Jug Day, Christmas Eve). Each pays 8 h (or 4 h) straight time, or banks **5.34 h (2.67 h) of comp**. Comp is the default. The owner says Captains and crews follow the same list. The 2027 dates use the county's observed dates (e.g. Juneteenth observed Friday June 18; Christmas observed Friday December 24).

### 8.4 Wages and supplements (CBA 26), structure only
- Classification minimums are set for EMT, AEMT, Paramedic and Lieutenant for 2024–2026, with 4% across-the-board raises in the first full pay of 2025 and 2026. No raise follows an unacceptable evaluation (26.4).
- Promotion pays +7.5% or the entry rate, whichever is greater (26.5).
- Annual evaluations: **Core Competency** skills, **written protocol exam** (fail → remediation → FTO time → possible de-credentialing by the Medical Director) and a **Physical Abilities Test** (26.5). An EMT who becomes a Paramedic must pass the department list test and FTO before working as one.
- Adders: acting Lieutenant +$2.00/h (6+ consecutive hours, pre-approved), FTO +$2.00/h (Paramedics, not Lieutenants), SCE +$1.50/h on all hours (Paramedics only; no FTO or instructor pay), instructor +$3.00/h, $360 a year each for Critical Care and FP-C certification, frozen longevity (26.6–26.9).
- Required certifications (8.10): Ohio EMT, AEMT or Paramedic; BLS; a valid Ohio driver's license; insurability under the county policy.

### 8.5 Staffing (owner)
- **Minimum 25 ALS providers on duty.** AEMTs count as ALS. **2 ALS per ambulance at every station and shift.** EMTs are usually the third seat, and crews may run 3 ALS. The aim is 5–6 EMTs per unit day, but that is not a requirement.
- An open seat that sign-ups don't fill is covered first by a **temporary transfer (TT)** of an ALS provider from a station with 3 ALS, if the department is at or above 25 ALS. Below 25, Captains use the **mandate list**.
- Any provider may pick up a Lieutenant open shift. An EMT may take an open seat if the unit already has 2 ALS. ALS members riding in charge or out of class get the in-charge pay. Captain out-of-class is limited to members on the yearly Captain promotional list.

### 8.6 Owner requests for SomaOS
- An **easy-to-edit mandate list** that suggests the next member up for each hole (§5 item 11).
- **Crew members see only the leave types available to them** (§5 item 8).
- **CE tracking** against Ohio and NREMT, applied automatically from completed classes, with a visual audit trail for renewals (§5 item 18). The department does much more CE than required.
- The captain/approval side was never visible to the owner. Design it fresh and keep it simple.

### 8.7 Operative IQ back office (read-only)
- **Unit types** (from questionnaire assignment): Ambulance - Diesel, Ambulance - Gas, Ambulance - Stocked Spare ONLY, Stocked Spare Equipment, Captain 461/462, Chief 460/461/462, EMS 461/462, F250, Kubota, Malibu, Minivan, MCI Trailer, Bike Team, Events, Utility.
- **Questionnaires (19)**, with schedule: Daily PRIMARY Rear Check and Daily Vehicle Driver Inspection (Gas / Diesel) daily; Captain Daily Check daily; Stocked Spare Monday Truck Check daily (reserve status only); weekly Monday inspections for Chief 460/461/462, EMS 461/462, F250, Kubota (daily during the fair), Malibu, Van, Utility; on demand: Captain Monthly Drug Expiration Form, Drug Expiration Form, Truck Switch Form, Variance Report (all unit types).
- **Asset classes** (fixed / catalog counts): Cardiac Equipment 118, Patient Movement 163/1, Fit Testing 4, Employee Gear 735/10, Training Equipment 68, Truck Medical Equipment 94/1, Station Equipment 53, MCI Trailer 3, Truck Equipment (not medical) 16, Logistics Equipment 2. Most are verified daily on Front Line.
- **Maintenance types**: Cleaning, Documentation, Incident, Monitor Battery Replacement, Preventative Maintenance, Purchase, Repair, Upgrade. Zoll monitors carry PM due dates. A Service Desk department "Critical Equipment Failure Report (Monitor, Cot, Load system, Suction Unit, Autopulse, Batteries)" tracks tickets against units.
- **Kit types (17)** with Track ID / Require Seal / Inspect flags: Airway Bag-Green, Avulsion Kit, Bed Bug Kit/Bag, Bike Drug Kit (seal + inspect), C-Spine Bag, Drug Drawer Medical Supply Kit, Drug Drawer- Medications (seal), Eye Care Kit, Fire Rehab Bag, First In Bag-RED, Handtevy Bag-BLUE, IV Roll, Narc Kit-A Safe, OPA Kit, RTF Bag, Zenix Monitor, Zoll AutoPulse NXT.
- **Cabinet types (24)**: Monitor Inventory, First In Bag Red, Advanced Airway Bag, Green Airway Bag, Handtevy Bag (outside / main compartment), RTF Bags, Interior Cabinets, Fridge/Cooler, Outside Cabinets, Narcs, UCapIt, Drug Drawer - Sealed, Support Vehicle Equipment, Captain Stat Pack, Fair/Special Events Items, MCI Trailer Shelving 1–6 and Walls, Bed Bug Kit.
- **Supply rooms**: main medical and cleaning supply, misc, employee gear, uniforms, PR events, training, truck equipment, P-Card purchases. Each station has a medical equipment supply cabinet and a station/cleaning/truck cabinet. Medical cabinets serve two medic groups, **(1, 2, 3, 6, 7, 11)** and **(4, 5, 8, 9, 10)**. UcapIt medication machines (Stations 1, 2, 7 and "Medication Cabinet @ Medic 2") raise their own supply requests.
- **Part categories**: Class A Uniforms, Cleaning/Station Supplies, Fixed Assets, Fleet, Gear Assets, Medical Supplies, Medication, PR Supplies, Saline, Shop Supplies, Training Equipment, Uniforms, Uncategorized (plus one personal-name category). Part types: Supply Part, Fleet Part, Catalog Asset, Fixed Asset.
