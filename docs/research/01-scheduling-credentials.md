# SomaOS Research 01: Workforce Scheduling (Shifts + Training) and Credential Tracking

Researched 2026-11-24. Method: web search (about 45 queries). Direct page fetches of primary sources (nremt.org, isomitigation.com, law.cornell.edu) were **blocked by the session's network allowlist**, so many figures come from search-result excerpts of primary sources or from state/secondary sources that quote them. The shared web-search budget ran out before every sub-topic was covered; the gaps are listed in Section 9.

**Confidence legend:** [V] = confirmed by a primary or official source excerpt. [S] = from a secondary, vendor or single source. [U] = unverified, from general domain knowledge; check before building on it.

---

## PART A: WORKFORCE SCHEDULING

### 1. Shift patterns

| Pattern | Definition | Avg hrs/wk | Notes |
|---|---|---|---|
| **24/48** | 24 on, 48 off; 3 platoons (A/B/C) on a 3-day rotation | ~56 | Most common in US career fire [S] |
| **48/96** | Two consecutive 24s, then 96 off; 3 platoons on a 6-day cycle | ~56 | Growing in West and South. Credited to Kern County FD (commute and housing). Fatigue concerns at busy stations [S] |
| **California swing** | 9-day cycle: 24 on/24 off/24 on/24 off/24 on, then 96 off | ~56 | Sources disagree on the exact cycle; some label this the "Kelly schedule" [S] |
| **Kelly schedule / Kelly day** | Term is ambiguous. (a) A periodic extra 24 hrs off, roughly every 9th shift (or once per FLSA period), that cuts scheduled hours and FLSA overtime. (b) Some sources use it as another name for the swing pattern | ~52-53 with Kelly days [U] | The FLSA neither requires nor prohibits Kelly days. Cancelling one does not avoid the overtime it creates [S, firelawblog] |
| **24/72** | 24 on, 72 off; **4 platoons** (A/B/C/D) | ~42 | Fast-growing. Florida HB 929 caps standard firefighter shifts at 42 hrs/wk. Adopted by Plano TX, Pasco and Lake County FL. Alexandria VA runs a 24/72 D-shift with "debit days" (~49 hrs) [S] |
| **"Spartan" 24/96/24/48** | 4-platoon variant of the 42-hr model | 42 | FireRescue1 [S] |
| **10/14** | Two 10-hr days, then two 14-hr nights, then 4 off (4 platoons) | ~42 | Found no source in this search [U] |
| **12-hr Pitman (2-2-3) / DuPont** | 12-hr shifts with 4 teams; common in EMS and dispatch | 40-42 | West Des Moines EMS uses a "modified Pitman" with 4 divisions of 12-hr shifts (40-42 hrs avg). A 2013 JEMS survey found 24-hr shifts at 58% and 12-hr shifts at 36% for paramedics and EMTs. No source found for the DuPont detail [S/U] |
| **Hybrid** | e.g., Austin-Travis County EMS "2x12 + 1x24" | varies | [S] |
| **Volunteer duty crews / duty nights** | Members sign up for on-call day, night or 24-hr blocks, or a station duty night | n/a | Firehouse247 has a volunteer sign-up form for day, night and 24-hr on-call. iFire shows crew availability and alerts on low crew. Some departments use SignUpGenius [S] |

**Platoon rotation model:** A pattern is a repeating sequence of on/off blocks with an anchor date. Each platoon is the same pattern with an offset: for 24/48, A is offset 0, B is 1 day and C is 2 days. 24/72 adds a D platoon. Day-of-week drift is inherent. The platform must generate the rotation calendar years ahead so leave bids can be made.

Sources: https://tcpsoftware.com/articles/firefighter-work-schedule ; https://firefighternow.com/firefighter-shift-schedules-and-working-hours-explained/ ; https://intime.com/resources/blog/what-does-a-firefighters-schedule-look-like/ ; https://www.fdle.state.fl.us/FCJEI/Programs/SLP/Documents/Full-Text/Webster,-Cory-final ; https://www.firehouse.com/stations/blog/55344411/is-your-fire-station-ready-for-the-fourth-shift-with-the-24-72-schedule ; https://www.firerescue1.com/fire-department-management/introducing-the-spartan-schedule-to-the-south ; https://communityimpact.com/plano-south/government/plano-firefighters-to-transition-to-2472-shift-schedule/ ; https://www.firerescue1.com/labor-and-union-issues/va-fd-sees-staffing-gains-after-switch-to-49-hour-workweek ; https://www.firerescue1.com/labor-and-union-issues/fla-fd-shifts-to-24-72-schedule-for-paramedics-and-emts ; https://www.wdm.iowa.gov/government/emergency-medical-services/about-us/what-s-new-at-wdm-ems ; https://austintexas.gov/emsrecruiting/field-shift-schedules ; https://www.jems.com/ems-training/2013-jems-salary-workplace-survey-2/ ; https://firehouse247.freshdesk.com/support/solutions/articles/19000168110-how-to-use-the-volunteer-signup-form-vol-combo-depts- ; https://apps.apple.com/gb/app/ifire/id1171368453 ; https://www.signupgenius.com/case-studies/keeping-volunteer-firefighters-coordinated-maple-grove

### 2. FLSA Section 7(k), overtime, Kelly days, sleep and meal time, comp time

**Work periods and thresholds (29 CFR 553.230) [V]:**
- A 7(k) work period can be 7 to 28 consecutive days.
- Fire protection: **212 hrs / 28 days**. Law enforcement: **171 hrs / 28 days**. Both scale proportionally:

| Days | Fire | Law enforcement |
|---|---|---|
| 28 | 212 | 171 |
| 27 | 204 | 165 |
| 26 | 197 | 159 |
| 21 | 159 | — |
| 14 | 106 | — |
| 7 | 53 | — |

- Worked example (553.231): a 14-day period with 160 hrs worked means 54 hrs of overtime (160 − 106).
- **Implementation note:** store the full 553.230 table, or compute it with the same rounding the regulation uses. Do not rely on a naive 212/28×N calculation without checking it against the table [U on rounding].

**Kelly-day mechanics [S]:** On a 24/48 schedule with a 28-day period, every third period has 240 scheduled hours. One 24-hr Kelly day brings that to 216, leaving 4 FLSA OT hours. Without it, 28 OT hours are owed. Annual scheduled hours on 24/48 are about 2,912. Whether Kelly days are paid or unpaid changes the regular-rate divisor (example: $52,000/2,912 vs $52,000/2,792). State law governs whether a Kelly day can be cancelled.

**Two separate overtime layers:** FLSA overtime is the legal floor. Many CBAs also pay "contract overtime" on a different basis (e.g., any hour beyond the scheduled shift, or callback). The engine has to compute **both** and pay the greater, or follow whatever the CBA says. [U: general practice; confirm per CBA]

**Sleep and meal time [S, via Tennessee CTAS and DOL opinion letters]:**
- Tours of 24 hrs or less: all time is hours worked. No sleep exclusion.
- Tours over 24 hrs: up to 8 hrs of sleep can be excluded, and only by agreement. If sleep is interrupted so that the employee cannot get a reasonable night's sleep, the whole period counts. Meal periods can be excluded only by agreement for 7(k) fire tours over 24 hrs. A 1987 DOL letter caps exclusions at 3 hrs meal plus 8 hrs sleep.
- 48/96 schedules raise this question because consecutive tours can run longer than 24 hrs. [U on how agencies treat it]

**Compensatory time (29 CFR 553.24 / FLSA 7(o)) [V/S]:** Fire, police and emergency-response employees may accrue up to **480 hrs** of comp time (equal to 320 OT hrs at 1.5x). Other public employees are capped at 240. Above the cap, overtime must be paid in cash.

**Trades and substitution (FLSA 7(p)(3), 29 CFR 553.31) [V]:** Two employees of the same agency may voluntarily trade with agency approval. "Each employee will be credited as if he or she had worked his or her normal work schedule for that shift." The substitute's hours are therefore not counted toward the substitute's FLSA hours, and the original employee is credited as if they worked. A 2005 DOL brief says employers must still pay overtime the original employee would have earned. [U, needs full-text check: 553.31 also has provisions on payback, recordkeeping, and payback not being required within any set period.]

**FMLA on 24-hr schedules [S]:** The entitlement is 12 workweeks converted to the employee's actual schedule. Mandatory scheduled overtime is included; voluntary extra hours are not. Irregular schedules use the 12-week average. My arithmetic, not sourced: 24/48 averages 56 hrs/wk, about 672 hrs of FMLA. Eligibility is 1,250 hrs worked in 12 months [U: general knowledge, 29 CFR 825.110]. DOL Opinion Letter FMLA2025-02-A covers the calculation.

Sources: https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-A/part-553/subpart-C ; https://codes.findlaw.com/cfr/title-29-labor/cfr-sect-29-553-230/ ; https://www.dol.gov/agencies/whd/fact-sheets/8-flsa-police-firefighters ; https://www.sog.unc.edu/resources/faqs/how-does-flsa%E2%80%99s-207k-exemption-law-enforcement-and-firefighters-work ; https://www.firelawblog.com/?p=13610 ; https://dol.gov/sites/dolgov/files/WHD/opinion-letters/legacy/ol_1995-03-13_a.pdf ; https://www.ctas.tennessee.edu/eli/sleep-time-under-ss-7k ; https://www.dol.gov/sites/dolgov/files/WHD/opinion-letters/legacy/ol_1987-09-11_a.pdf ; https://www.dol.gov/sites/dolgov/files/WHD/opinion-letters/legacy/ol_1988-05-18_b.pdf ; https://govinfo.gov/content/pkg/CFR-2022-title29-vol3/pdf/CFR-2022-title29-vol3-sec553-24.pdf ; https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-A/part-553/subpart-A/subject-group-ECFRfe000b1fafbd7ca/section-553.31 ; https://webarchive.library.unt.edu/web/20090508123735/https://www.dol.gov/sol/media/briefs/senger-01-11-2005.htm ; https://www.iaff.org/wp-content/uploads/FLSA-Manual-2022-Edition_FINAL.22Aug01.pdf ; https://www.jacksonlewis.com/sites/default/files/2025-10/DOL-OpLtr-FMLA-2025-02-A.pdf ; https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V/subchapter-C/part-825/subpart-B/section-825.205

### 3. Holdover, mandatory overtime, callback, acting pay

- **Holdover and forced hire:** Policies set the order for mandatory OT and limit it. Ocala FD forces from a rotating list, newest hires first. Unified Fire (UT) uses a revolving list and has proposed reverse seniority until a set number of mandatory hours accumulate. Common caps: no more than 3 of 4 consecutive shifts, or no more than 48 consecutive hours. [S] First Due has "Mandatory Settings" for holdovers and forced OT. [S]
- **Callback pay:** Amarillo: 2-hr minimum at 1.5x, partial hours rounded up. Another contract: 4-hr minimum at the regular rate, with holdover past shift end as an exception. Portland: callback hours count double on the rotating list, up to 24 per callback. [S]
- **Acting / out-of-class pay:** Varies by contract. Options include hour-for-hour at the higher class rate; pay only after a threshold (e.g., 40 hrs in a pay period); higher class at the same step; eligibility limited to one rank up. The supervisor decides whether to assign. [S]

Sources: https://www.ocalagazette.com/?p=84430 ; https://unifiedfireut.gov/wp-content/uploads/Mandatory-Options-Revision-1-003.pdf ; https://austintexas.gov/sites/default/files/files/Auditor/Audit_Reports/Austin%20Fire%20Department%20Overtime%20Audit%20-%20APRIL_2023.pdf ; https://www.a2gov.org:443/departments/fire/Documents/Standard%20Operating%20Procedures/1.15%20Administration%20of%20Equalized%20Overtime.pdf ; https://amarillo.gov/wp-content/uploads/2024/12/703Firefighters.pdf ; https://www.gvsu.edu/cms4/asset/8DD00028-AF18-F3F0-12E24896B420A011/mccormick6.pdf ; https://efiles.portlandoregon.gov/record/16069368/file/document ; https://ucnet.universityofcalifornia.edu/wp-content/uploads/labor/bargaining-units/f3/docs/f3_2016-2020_24_out-of-class-pay-temporary-assignment.pdf ; https://www.lawinsider.com:443/clause/out-of-class ; https://support.firstduesizeup.com/portal/en/kb/first-due-community-connect-support/scheduling-module/shift-board

### 4. Minimum staffing and seat qualifications

- **NFPA 1710 (career departments) [S, IAFF summary]:** minimum of 4 on-duty members per engine and per truck company. 5 under high volume or geographic restrictions; 6 for engines in tactical-hazard or dense urban areas. Section 5.2.2.2.1 requires the AHJ to set minimum company staffing. NFPA 1720 covers volunteer and combination departments [U: no source fetched].
- **Many departments staff below 1710.** Montgomery County MD says so openly. Minimums are therefore **per-agency configuration, not hard-coded**.
- **Seat qualifications:** Positions such as Officer, Driver/Engineer, Paramedic and FF each require credentials and/or rank. Example: Unified Fire requires a driver's license plus EMT/AEMT/Paramedic licensure for all specialties, and Engineer and Paramedic seats are filled from people who hold that specialty. Phoenix limits paramedics to vacation slots allotted to paramedics so ALS staffing stays above critical levels. [S]

Sources: https://www.iaff.org/wp-content/uploads/English_Version_-_NFPA_1710_standards_DFSR_Summary_2022_new.pdf ; https://www.newberlinwi.gov/DocumentCenter/View/25409/NBFD-Fact-Sheet ; https://www.montgomerycountymd.gov/frs-ql/resources/files/swsj/policyprocedures/ops/Apparatus%20Staffing%20Policy%2025-08AMII%20031616.pdf ; https://public.powerdms.com/unifiedfire/documents/1817546 ; https://pilot.phoenix.gov/firesite/Documents/fire_mp_10301.pdf

### 5. Trades, pickups, OT lists, leave, bidding

- **OT list types seen in the sources [S]:**
  - Rotating: assigned member drops to the bottom (UKG TeleStaff at Farmington FD).
  - Hours-based or equalized: lowest accumulated OT goes first (Ann Arbor "Equalized Overtime").
  - Pay-rate ranked plus OT-hours (Austin).
  - Kelly-day volunteers get priority (Austin CBA).
  - Reverse-seniority forced list.
  - Separate voluntary and mandatory lists.
  - Pick lists with a cutoff (Glendale CA: full and partial pick lists until 1600 the day before).
- **Leave and vacation bids [S]:** Seniority-based picks (Vallejo; San Diego ties broken by academy rank, then lottery). Max off per day (Vallejo: 4). Per-company and per-rank limits (Ames: 1 member per company and 1 Lt per shift). Seasonal limits (Loveland: 2 off, max 2 officers, June-August). Qualification-specific slots (Phoenix paramedic slots). One partial-shift leave per employee per shift (Phoenix). Shift bids every 2 years (Payson). TeleStaff customers say PTO bidding saves a lot of time (Fishers).
- **Trades:** FLSA 7(p)(3) as covered above. Agency policies typically limit trade counts or hours and track owed and payback hours, and require the substitute to be equally qualified [U: SOP-level detail was not searched before the budget ran out].
- **Leave types to model:** vacation, sick, FMLA (concurrent designation), comp time (480 cap), holiday, Kelly, bereavement, military, injury/workers' comp, admin. Blackout dates. Accrual by hours worked or per pay period, with caps and carryover [U: general practice].

Sources: https://www.ukg.com/for-llms/customers/farmington-fire-department ; https://a2gov.org/media/c3dp12lv/115-administration-of-equalized-overtime.pdf ; https://glendaleca.gov/Home/ShowDocument?id=13852 ; https://vallejoca.hosted.civiclive.com//Userfiles/DBFiles/server_16925367/202109/17988724/1_1_15_vacation_selection.pdf ; https://www.cityofames.org/files/assets/city/v/1/fire/documents/sog-ada/1.5.5-vacation-holiday-picks-requests.pdf ; https://lovelandpolice.prod.govaccess.org/home/showpublisheddocument/32323/636167848308330000 ; https://webdocs.sandiego.gov/sdfd-training/study-guides/battalion-chief/manuals/Staffing_Manual/staffing-manual-section-05-bid-system.pdf ; https://paysonaz.gov/home/showpublisheddocument/912/637874527803130000 ; https://www.ukg.com/for-llms/customers/fishers-fire-department

### 6. Configurable CBA rules engines: what vendors claim

- **InTime:** posted OT is auto-assigned to qualified people under "union and department rules". CAL FIRE sign-ups are filtered against its collective agreement. 100+ reports, including union OT rule compliance. Audit trails on leave. New Britain FD cut scheduling time from 9 hrs to 20 min. [S, vendor]
- **Vector Scheduling (formerly CrewSense):** rules-based "hiring assistant" that hires back only qualified people. Callbacks can be automatic or manual and fill multiple vacancies at once. FLSA/OT settings and work limits. [S, vendor]
- **UKG TeleStaff:** built-in OT rules rotate assignees to the bottom of the list. Interface tools for "virtually any HR, payroll, CAD, RMS and timekeeping system". Predefined import/export fields for employee, accrual and roster data. SFTP for people, payroll, accruals, schedules and punches. People export via API. [S, vendor]
- **First Due:** shift board (1/3/7-day views), roster count by hour, "Scheduling Deputy" vacancy recommendations, rotations, mandatory/forced OT settings, off-roster entries (class, gear inspection), time cards, AI staffing claims, integration with its own ePCR, assets and mobile responder. [S, vendor]
- **ESO Scheduling:** matches credentials to shifts. A 2020 blog says time clocks can block punch-in when a required certification is missing. Expiring-cert notifications. Shift swaps. Third-party payroll integration claims conflict. [S, vendor]
- **Aladtec (TCP Software):** 24/7 rotational schedules, self-service swaps, giveaways, bidding, leave requests, mobile app. Integrations with ESO Firehouse, Emergency Reporting, First Arriving, and ESO Fire Incidents (roughly 15-minute sync of schedule changes). [S]
- **Design takeaway [analysis]:** vendors expose rules as parameterised policy objects (list type, ordering key, eligibility filters, caps, tie-breakers), not as free-form code. Implementing contract-specific behaviour still tends to need vendor help (see TeleStaff complaints below).

Sources: https://intime.com/fire/ ; https://intime.com/case-studies/cal-fire/ ; https://intime.com/?p=29398 ; https://info.vectorsolutions.com/hubfs/PS%20Resource%20Center/Brochure/Fire-EMS/Scheduling%20Brochure%20for%20Fire-EMS.pdf?hsLang=en ; https://www.ukg.com/sites/default/files/2023-11/PS0052-v5-UKG-TeleStaff-Cloud-for-Fire-Rescue-EMS-SG.pdf ; https://dcus11-hlp01.gss.mykronos.com/help/HCM/administration/Application_Setup/Integrations/telestaff_integrations_208940.html ; https://firstdue.com/products/schedulingpersonnel ; https://support.firstduesizeup.com/portal/en/kb/first-due-community-connect-support/scheduling-module/set-up ; https://www.eso.com/scheduling-software/ ; https://www.eso.com/blog/7-scheduling-must-haves-for-ems-fire-departments ; https://tcpsoftware.com/products/aladtec/ ; https://aladtec.tcpsoftware.com/2021/08/aladtec-integrations-with-eso-fire-incidents/ ; https://www.prweb.com/releases/aladtec_announces_new_integration_with_eso_firehouse_software/prweb16413943.htm

### 7. User sentiment (thin evidence)

- No Reddit threads came back in search (blocked or unindexed). Independent reviews are few.
- **TeleStaff:** Capterra rates it 4.0 from only 2 reviews. Cons: "Admin set up is not very user friendly and requires extra knowledge"; support scored 3.5/5. Forum users are mixed ("weren't impressed" vs "works well"). Many departments underuse it and handle tasks by hand. Unified Fire issued a memo about a UKG glitch that hid calendars and dashboards for some users.
- **Aladtec:** Capterra 4.6 (17 reviews); ease of use 4.2. Praised as simple and time-saving. Complaints centre on mobile-app limits (no full team schedule view) and older remarks about weak timekeeping.
- **Vector Scheduling:** an App Store complaint said callback alert tones did not play the chosen sound. This matters because OT callbacks rely on noticeable alerts, and a later version added more sound options. SourceForge shows no reviews.
- **eSchedule:** no mobile app; crowded schedule layout.
- **ESO:** SelectHub has conflicting statements on payroll integration.

Sources: https://www.capterra.com/p/276928/UKG-TeleStaff/ ; https://community.fireengineering.com/xn/detail/1219672:Comment:70198 ; https://unifiedfireut.gov/wp-content/uploads/Memo-25-146-Telestaff-Issue.pdf ; https://capterra.com/p/248403/Aladtec/reviews/ ; https://emtlife.com/threads/scheduling-software.48244/ ; https://apps.apple.com/us/app/vector-scheduling/id1561651852 ; https://capterra.com/p/142521/eSchedule/reviews/ ; https://www.selecthub.com/p/hr-management-software/eso-scheduling/

### 8. Training scheduling, time and attendance, integrations

- **Training scheduling features found in market products [S]:**
  - Vector Acadis: automatic assignment of rooms, equipment and instructors; class availability; waitlists; hour calculations; course templates.
  - TargetSolutions: tracks training, EMS recerts, skills evaluations and ISO hours; recurring events.
  - First Due Training: progress against required hours and certs; training events tied to the schedule.
  - iOps360: timestamped sign-ups and cancellations; instructor rosters with pass/fail sent to a coordinator for approval.
  - First Due off-roster entries cover people who come in for class (off-duty training means paid time or OT).
- **On-duty vs off-duty training:** on-duty training must not drop a unit below minimum staffing, or the unit goes out of service for training. Off-duty training is compensable hours worked under FLSA (counts toward 7(k)) unless it meets the voluntary-training exclusions in 29 CFR 553.226 [U: regulation not fetched].
- **Payroll and HR:** TeleStaff exports roster, accrual and employee data through predefined fields, SFTP and API. Common municipal payroll targets probably include Tyler Munis/ExecuTime, Workday, ADP, Paylocity, Caselle, CentralSquare and Oracle PeopleSoft (Oracle documents FLSA public-safety handling). **The list is [U]: the search budget ran out before vendor-specific payroll connectors could be verified.**
- **CAD and RMS:** TeleStaff markets direct CAD/RMS/payroll connections without naming CAD vendors. Aladtec pushes rosters to ESO. The usual pattern is that the scheduler pushes the unit roster (who is on which apparatus) to CAD and RMS/ePCR so crews pre-populate. [S/U]

Sources: https://info.vectorsolutions.com/hubfs/PS%20Resource%20Center/Overview/The%20Only%20Purpose-Built%20Academy%20Automation%20Software%20for%20the%20Fire%20Service.pdf?hsLang=en ; https://www.vectorsolutions.com/resources/blogs/a-smarter-simpler-way-to-manage-training-recurring-events-in-targetsolutions-fire-ems/ ; https://www.firstdue.com/learnmore/fire/training ; https://iops360.com/class-scheduling-and-rosters/ ; https://docs.oracle.com/cd/F88037_01/hcm92pbr48/eng/hcm/hpay/FLSARequirementsforPublicSafetyEmployees-3e3dc9.html ; https://www.ukg.com/industry-solutions/public-sector/fire-and-ems

---

## PART B: CREDENTIAL AND CERTIFICATION TRACKING

### 9. EMS certifications: NREMT and the NCCP

- **Levels:** EMR, EMT, AEMT, Paramedic (NRP). The national certification is **separate from state licensure**. NREMT itself says its certification is not a license to practice, and that licenses must be verified with the state EMS office. [V]
- **Cycle:** 2 years. EMT, AEMT and Paramedic expire **March 31**; EMR expires **September 30**. [V, NREMT handbook excerpt]
- **2025 NCCP model:** starts April 1, 2025 for EMT, AEMT and Paramedic, and October 1, 2025 for EMR. It puts more emphasis on evidence-based guidelines in the National component. Kentucky accepts only the 2025 model from January 1, 2026. [V/S]
- **Hours (the total is split about 50% National, 25% Local/State, 25% Individual):**

| Level | Total | National | Local/State | Individual | Confidence |
|---|---|---|---|---|---|
| EMR | 16 | 8 | 4 | 4 | 2016-model split [S]; 2025 EMR split not confirmed |
| EMT | 40 | 20 | 10 | 10 | Total [V]; split [U] by the 50/25/25 rule |
| AEMT | 50 | 25 | 12.5 | 12.5 | Total [V]; split [U]. North Carolina's state AEMT total is 100 |
| Paramedic | 60 | 30 | 15 | 15 | [V/S] NREMT page excerpt plus Virginia OEMS |

- **Other routes and rules:**
  - Recertification by cognitive exam is allowed.
  - Inactive status for people not providing patient care (can stay inactive indefinitely; an Inactive-to-Active form returns them to active).
  - Reinstatement period with a $50 late fee (not available for recert by exam).
  - Lapse: 0-24 months versus more than 2 years leads to different re-entry requirements.
  - CE must be state-approved **or** CAPCE-accredited. [V/S]
- **CAPCE delivery formats:**
  - F1 and F2: live classroom.
  - F3: distributive/online, self-paced.
  - F5: virtual instructor-led (VILT, synchronous), which counts as live.
  - NREMT voted in 2022 to remove the distributive cap, effective 4/1/2023 [S, Maine EMS]. NREMT's support page still mentions limits, so this is **conflicting**; verify. States may set their own caps.
- **State overlays:** states add requirements on top (e.g., Massachusetts, Virginia and North Carolina CE rules). **The CE requirement model must be per jurisdiction and per level, with a versioned rule set.**
- **EMS Compact:** Privilege to Practice is verified with a **12-digit National EMS ID** through the National EMS Coordinated Database (NEMSCD). This is an official primary-source lookup. [V]
- **No public NREMT API was found.** Verification is through the web lookup (name, level, registry number). [S]

Sources: https://www.nremt.org/EMT/Recertification ; https://nremt.org/paramedic/recertification ; https://nremt.org/EMR/Recertification ; https://nremt.org/Handbooks/Recertification/Important-Dates-Time-Periods ; https://nremt.org/Handbooks/Recertification/Active-And-Inactive-Status ; https://nremt.org/Handbooks/Recertification/Policies-Procedures ; https://www.vdh.virginia.gov/emergency-medical-services/education-certification/educator-resources/continuing-education-program-guidance/changes-to-virginias-recertification-requirements/ ; https://ems.utah.gov/wp-content/uploads/sites/34/2024/07/NCCP-Model-2025_National-Component.pdf ; https://ems.utah.gov/wp-content/uploads/sites/34/2023/03/NREMT-Recertification-Guide-v4.pdf ; https://kbems.ky.gov/Certification-And-Licensure/Documents/2025_EMS_Clinician_Continuing_Education_Requirements_2025-08-05.pdf ; https://www.hhs.nd.gov/health/epr/ems-personnel-renewal-requirements ; https://oems.nc.gov/wp-content/uploads/2022/11/AEMT-CONTINUINGEDUCATION-REQUIREMENTS.pdf ; https://www.maine.gov/ems/index.php/node/1285 ; https://WWW.NREMT.ORG/Document/Support-Center-Recertification ; https://nremt.org/getmedia/eb36a456-bc96-4908-bb6f-0ec3b436bcbe/82-07-Accepted-Education-Documentation-Policy.pdf ; https://nremt.org/verify-credentials ; https://emscompact.gov/employers/verify-my-status

### 10. Course cards

| Card | Issuer | Validity | Confidence |
|---|---|---|---|
| BLS, ACLS, PALS, Heartsaver | AHA | 24 months from issue date; no AHA grace period | [S] (training vendors, consistent with each other) |
| PHTLS (and PHTLS for First Responders) | NAEMT | 4-year wallet card | [V] NAEMT catalogs |
| AMLS, EPC, other NAEMT courses | NAEMT | Probably 4 years | [U]: not confirmed |
| ITLS provider | ITLS | Mostly 3 years; chapters may allow a grace period | [V] itrauma.org |
| PEPP | AAP/Jones & Bartlett | Not found | [U] |
| NRP (neonatal) / PEARS / others | various | Not researched | [U] |

**Design implication:** store validity per course type, with an override per issuer or tenant. Expiration rules differ: end of the month printed on the card vs. the exact issue date + N months [U: AHA eCards say "Recommended Renewal" by month].

Sources: https://www.naemt.org/docs/default-source/education-documents/education-catalog-2020-web-09-20-2019.pdf ; https://www.naemt.org/docs/default-source/about-ems/education-catalog-2026-final.pdf ; https://www.itrauma.org/students/recertification/ ; https://practicetestgeeks.com/cpr/cpr-certification-expiration ; https://ctcce.vcu.edu/courses/courses/advanced-cardiac-life-support-acls/

### 11. Fire certifications (Pro Board / IFSAC / NFPA)

- **Accreditors:** Pro Board and IFSAC accredit state and provincial certifying entities. A person gets a Pro Board certificate only if tested through a Pro Board-accredited agency. [S]
- **Verification:**
  - IFSAC: a seal registry (request form to the IFSAC Admin Office, or the certifying entity's own lookup).
  - Pro Board: an online Certification Registry. One source says lookup uses a 4-digit PIN; another says last name plus SSN last 4. **Conflicting**.
  - State lookups also exist (e.g., TCFP Texas verify). [V/S]
- **Expiry:** most Pro Board/IFSAC certifications do not expire on their own, but some states require recertification or CE (e.g., Texas TCFP CE) [U: not confirmed in search]. **Model expiration as optional, set per certifying body.**
- **NFPA standard consolidation, which affects credential naming:**
  - **NFPA 1010** (2024) consolidates 1001 (FF I/II), 1002 (Driver/Operator), 1003 (ARFF) and 1005 (Marine). [S]
  - **NFPA 1020** consolidates 1021 (Fire Officer) and 1041 (Instructor), target 2025. Publication was **not confirmed**. Some states still cite NFPA 1021-2020. [S]
  - **Design takeaway:** the credential catalog must map legacy standard numbers to current ones (e.g., "FF II per NFPA 1001-2019" is equivalent to "FF II per NFPA 1010-2024").
- **Other fire credentials to catalog [U, not individually researched]:** Inspector (NFPA 1031, possibly consolidated), Investigator (1033), Plans Examiner, HazMat Awareness/Operations/Technician (NFPA 470, which consolidated 472/1072), Technical Rescue (1006), Wildland (NWCG red card; annual refresher plus pack test), Incident Command (NIMS ICS-100/200/300/400/700/800; these do not expire).
- **Driver's license:** class and endorsements (many states exempt fire apparatus drivers from a CDL; an "F" endorsement exists in some states) [U]. Track number, class, state, expiry and restrictions. Some agencies run periodic MVR checks [U].

Sources: https://ifsac.org/ifsac-seal-verification ; https://pre2.fsi.illinois.edu/documents/brochures/proboard_faq.pdf ; https://www.uvu.edu/ufra/docs/certification/cert_forms/proboard_app_for_certificate_5.2020.pdf ; https://www.tcfp.texas.gov/verify ; https://www.iafc.org/topics-and-tools/resources/resource/nfpa-1010-leading-the-charge-toward-standardized-all-hazards-firefighter-training ; https://www.psglearning.com/blog/psg/2024/02/12/nfpa-1010-what-fire-instructors-need-to-know ; https://sfm.illinois.gov/content/dam/soi/en/web/sfm/documents/reference/approved-certification-reference-material-list.pdf

### 12. Medical clearance and respiratory fit testing

- **NFPA 1582 has been consolidated into NFPA 1580 (2025)**, "Standard for Emergency Responder Occupational Health and Wellness". It merges 1581, 1582, 1583 and 1584 and has errata for Tables 13.5-13.10. NFPA 1582-2022 was the last standalone edition. [V/S] Annual medical evaluation frequency under 1580 was **not confirmed** in search (1582 historically required annual evaluations [U]).
- **OSHA 29 CFR 1910.134:**
  - Medical evaluation before fit testing or first use.
  - Fit test (QLFT or QNFT) before first use, whenever the facepiece changes, and **at least annually** after that.
  - Re-evaluation on triggers such as a health-care professional's recommendation or observations during fit testing.
  - Some states run their own plans (e.g., NJ PEOSH has firefighter-specific forms). [V]
- **Data model:** fit test records hold respirator make, model and size, test method, pass/fail, tester and date. Medical clearance holds cleared/restricted/not cleared and a restrictions text. **Store only the clearance status, not PHI detail; HIPAA and ADA confidentiality apply [U].**

Sources: https://www.fire-police-ems.com/NFPA1580-2025.shtml ; https://docinfofiles.nfpa.org/files/AboutTheCodes/1580/Errata_1580_25_1.pdf ; https://webstore.ansi.org/standards/nfpa/nfpa15822022 ; https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.134 ; https://www.osha.gov/sites/default/files/training-library_major_requirements.pdf ; https://mtas.tennessee.edu/system/files/mrln/mknowledge/main/Respiratory%20Protection%20Program%20template%20for%2029%20CFR%201910_134.pdf ; https://www.nj.gov/health/workplacehealthandsafety/peosh/peosh-health-standards/resprotection.shtml

### 13. ISO FSRS training (Public Protection Classification)

Current FSRS training items (post-2013 revision). Figures are from search excerpts of isomitigation.com plus vendor summaries. **The ISO page could not be fetched directly.**

| Item | Requirement for maximum credit | Confidence |
|---|---|---|
| Company training | **16 hrs per member per month** (192 per year) | [V-excerpt] ISO plus Vector |
| Training facility use | **18 hrs per member per year** at a facility | [V-excerpt] |
| Officer training | **12 hrs per officer per year** of CE | [V-excerpt] |
| New driver/operator | **60 hrs** one-time | [S] Vector (cites NFPA 1002/1451) |
| Existing driver/operator | **12 hrs per year** | [S] |
| Hazardous materials | **6 hrs per member per year** | [S] |
| Recruit training | **240 hrs** per recruit in the first year (one vendor blog says 24; probably an error) | [S, conflicting] |
| Pre-fire planning inspections | Not obtained (believed to be twice a year per commercial/industrial occupancy) | [U] |

**Design implication:** training records must tag each session with ISO categories and hours, both on and off duty, and roll them up per member per month and year. Reports must be per member, not per class.

Sources: https://isomitigation.com/ppc/technical/training ; https://www.vectorsolutions.com/resources/subject-matter-experts/updates-to-isos-training-requirements-impact-clients-using-targetsolutions-iso-training-trackerall/ ; https://info.vectorsolutions.com/hubfs/PS%20Resource%20Center/Overview/ISO%20Training%20Tracker%20_Starter%20Kit_%20Built%20to%20Meet%20ISO%20Standards.pdf?hsLang=en ; https://www.vectorsolutions.com/resources/blogs/fire-department-iso-training-requirements/ ; https://portal.ct.gov/CFPC/_old/State-Fire-Administrator/General/ISOs-Fire-Suppression-Rating-Schedule-Reinvented-and-Revised

### 14. How credentials gate scheduling (market practice)

- ESO: matches credentials to shifts. Time clock can block punch-in when a required cert is missing. Expiry notifications. [S]
- Vector Scheduling: hires back only qualified personnel; certification logs. [S]
- InTime: assigns OT to "qualified" firefighters. [S]
- Phoenix policy: qualification-restricted leave slots, so paramedic staffing is protected through leave limits as well as assignment. [S]

**Recommended behaviour [analysis]:**
- Hard block (or a block an authorised user can override with a reason and an audit record) when a person would fill a seat whose required credential will be expired **at any point during the shift**. Evaluate against shift start and end, not today's date.
- Soft warnings at 90/60/30/7-day thresholds.
- When a credential expires, re-evaluate future assignments automatically and flag the vacancies it creates.

---

## 15. Data model and configuration implications for SomaOS

1. **Shift patterns as data.** `RotationPattern` holds an ordered list of on/off segments, a cycle length and an anchor date. `Platoon` holds a pattern and an offset. Support 3- and 4-platoon models, 12/24/48-hr tours, hybrid cycles and Kelly-day overlays (a Kelly sequence per member, e.g., every Nth tour, or one per FLSA period). Pattern changes (24/48 to 24/72) need effective-dated versions.
2. **Pay/FLSA engine.**
   - Per-employee-group `WorkPeriod`: 7-28 days, with the 553.230 threshold table and fire, LE or standard 40-hr category.
   - Sleep and meal exclusion flags, used only for tours over 24 hrs and only by agreement.
   - Comp-time cap: 480 for public safety, 240 for other employees.
   - Trades credited to the original employee (7(p)(3)).
   - Compute FLSA OT and contract OT separately and apply the CBA's precedence.
   - Configurable regular-rate divisor (paid vs unpaid Kelly days).
3. **Rules engine (CBA policies as parameterised objects, versioned and effective-dated per bargaining unit):**
   - OT lists: rotating, hours-equalized, seniority, reverse-seniority, or pay-rate based; voluntary vs mandatory; reset rules; what counts (refusals and callbacks, sometimes weighted 2x); Kelly-day priority.
   - Fatigue caps: max consecutive hours, X of Y shifts.
   - Callback minimum hours, rate and rounding.
   - Acting pay: first-hour vs threshold, step rule, max ranks up.
   - Leave: slots per day, company, rank or qualification, seasonal; pick-round order (seniority with tie-breakers); partial-shift limits; blackout dates.
   - Trades: limits, payback window, qualification match.
   - Every decision should be explainable ("why was X hired?") with an audit log. Users complain about TeleStaff's complex admin setup, so ship templates with sensible defaults.
4. **Staffing model.** `Station` → `Apparatus/Unit` → `Seat` (role + required qualification set + rank floor). Store per-unit minimums by time of day, and let a unit go out of service. NFPA 1710/1720 values are defaults only.
5. **Credential model.** `CredentialType` holds issuer, level, category (EMS cert, state license, course card, fire cert, medical, fit test, driver's license), validity rule (N months / fixed date / never / jurisdiction cycle like NREMT 3/31 or 9/30), renewal requirements (CE hour buckets by component, CAPCE formats, distributive caps), legacy-standard mapping, and the verification source. `Credential` (per person) holds number, jurisdiction, issue and expiry dates, status (active / inactive / lapsed / reinstatement / pending verification), document attachments, verifier, timestamp and method. Seat requirements reference credential types, including equivalents and "any of" logic.
6. **CE and training ledger.** Each training record carries hours, CAPCE course ID and format, NCCP component and topic, ISO category tags, on/off duty (pay impact), instructor, and location/props. Rollups cover NREMT progress, state CE, ISO monthly hours per member (16/mo company; 12/yr officer; 12/yr driver; 6/yr hazmat; 18/yr facility) and NFPA 1580 medical currency.
7. **Training scheduling.** Class templates, sessions, instructors (with instructor credentials), rooms, props and apparatus as resources, capacity and waitlists, and sign-up and cancellation timestamps. On-duty training checks staffing minimums; off-duty training creates paid time or OT entries.
8. **Integrations.** Payroll export with configurable pay-code mapping (fixed-width, CSV or SFTP; API where offered). Roster push to CAD and ePCR/RMS. NREMT, state and EMS Compact lookups are manual or semi-automated (no public NREMT API found).

## 16. Known gaps (search budget exhausted / network blocked)

- Full text of 29 CFR 553.31 (trade payback provisions), 553.226 (training time) and 553.222/223. Fetches of law.cornell.edu were blocked.
- Exact 2025 NCCP hour splits for EMR, EMT and AEMT; the current NREMT distributive-education policy.
- ISO FSRS page text (isomitigation.com blocked); pre-fire planning credit details.
- NAEMT AMLS/EPC and PEPP card validity; how AHA eCard expiry is calculated.
- Pro Board and IFSAC recertification or expiry policy; NFPA 1020 publication status; annual medical frequency under NFPA 1580.
- Vendor-specific payroll connectors (Tyler Munis, Workday, ADP and others); named CAD integrations; "Crew Scheduler" and "ESO EMS Manager" products (not researched); 10/14 and DuPont schedule specifics; Reddit sentiment (no threads returned).
