# SomaOS Research 05: Platform Architecture, Access Control, Compliance, Market, Adjacent Modules

*Research date: 2026-11-24. Prepared for SomaOS, an all-in-one Fire/EMS SaaS platform.*

## How to read this document (method and limits)

- **[S]** marks a claim backed by a source found in this session (URL given).
- **[K]** marks a claim from the researcher's prior knowledge that **could not be re-verified in this session**. Verify these before you rely on them.
- **[R]** marks a recommendation or opinion. These are design judgment, not fact.
- **Limits.** The shared web-search budget ran out partway through. Direct page fetches were blocked by the sandbox network policy for federalregister.gov, hhs.gov, ecfr.gov, g2.com, pstrax.com and nfpd.specialdistrict.org. As a result:
  - **Reddit could not be searched directly.** User sentiment below comes from review aggregators (Capterra, G2, Software Advice), which quote review text, and from trade press. Treat it as a small, possibly biased sample.
  - Access-control best practice (section 2), the content of the HIPAA NPRM, and parts of the architecture patterns (section 4) rely more on [K] than the other sections.

---

## 1. Competitive landscape (as of late 2026)

### 1.1 Market structure summary

The market is consolidating around three "suite" vendors: **First Due**, **ESO** and **ImageTrend**. **Vector Solutions** is a large training and workforce roll-up. Around them sits a long tail of point solutions for scheduling, apparatus checks, inventory and low-cost all-in-ones. Private-equity money continues to flow into the space:

- First Due: $355M minority growth investment led by JMI Equity, August 2025 [S].
- PSTrax: Level Equity investment, August 2025 [S].
- Vector Solutions: acquired Frontline Public Safety Solutions in 2025 [S].

The NFIRS→NERIS cutover (NFIRS retired January–February 2026) forced most departments to re-evaluate their RMS in 2025–2026. That makes this a genuine buying window [S].

### 1.2 Vendor-by-vendor

| Vendor | Ownership / recent events | Coverage | Pricing (public info) | Reported weaknesses |
|---|---|---|---|---|
| **First Due** | Founded 2016. Serent Capital minority stake (2021); JMI-led $355M minority growth round (Aug 2025); claims more than 3,000 customers across fire, EMS and law enforcement [S]. Acquired Data Chief (pre-plans; date not confirmed) [S]. CAD partnership with CentralSquare [S]. FDNY selected First Due for citywide NERIS incident reporting (announced Jan 6, 2026; vendor-sourced) [S]. | Broadest "all-in-one" positioning: NFIRS/NERIS RMS, ePCR, pre-incident planning, inspections/CRR, scheduling, inventory/assets, training, and law enforcement modules [S, partly K]. | Not published; Capterra lists it as "per feature" [S]. **Public-record data point:** North Greece Fire District (NY), first-year subscription $35,033 plus $7,800 one-time installation, contract dated June 9, 2026 [S]. | Fire-chief reviewer: "great product just over priced"; setup is "quite lengthy" [S]. Browser cache problem making the web app lag [S]. Ratings are otherwise high (G2 4.5/5 from 39 reviews) [S]. |
| **ESO** | Acquired FIREHOUSE Software from Conduent (2017), Emergency Reporting (2021; ER had more than 7,500 agencies and 170+ DoD installations), plus Logis Solutions (CAD/logistics/billing), d2i (hospital performance) and eCore [S]. ER customers are being migrated to ESO Fire RMS [S]. | ePCR/EHR (strongest asset), Fire RMS, Properties & Inspections, Scheduling, Asset Management/Inventory, Health Data Exchange (HDE) with hospitals [S]. NERIS vendor compatibility badge [S]. | Not public [S]. | Capterra 2.7/5 from 18 reviews (Customer Service 2.2, Ease of Use 2.3); G2 3.6/5 [S]. Quotes: support "practically non-responsive," escalations "never heard back," legacy code ("FoxPro," presumably the FIREHOUSE lineage), "mobile products are horrible," inspections side "extremely poor" [S]. One reviewer who left for EPR FireWorks: "moving from ESO was the best thing we did" [S]. |
| **ImageTrend** | Acquired FlowMSP (pre-plans, about 500 customers; Aug 2024) and biospatial (EMS analytics; 2025, exact date unconfirmed) [S]. Claims more than 3,000 customers and 20,000 agencies [S]. Large state-repository footprint (state EMS/NEMSIS repositories) [K]. | Elite EMS (ePCR), Elite Fire (RMS: occupancies, inspections, hydrants, inventory, checklists, training, maintenance), Elite Rescue (combined fire+EMS), Fire Investigations, Visual Pre-Plans, Staffing/Scheduling, Continuum analytics, CQI, Report Writer [S]. | Not public; "à la carte" option mentioned [S]. | G2 reviewers: "clunky" user module; busy layout; workflows that take several screens; "Highly customizable but steep learning curve" [S]. ImageTrend's own blog acknowledges "clunky interfaces, multiple redundant clicks" across the industry [S]. |
| **Vector Solutions** | Roll-up: TargetSolutions (training LMS), CrewSense (now Vector Scheduling), Halligan (now Vector Check It: apparatus, inventory and assets), Envisage (2021), Frontline Public Safety Solutions (2025) [S]. | Training/LMS and compliance, scheduling and staffing, checks/inventory/fleet, exposure tracking via "Guardian Tracking" [S]. Not a full RMS/ePCR (Frontline adds some RMS-like capability) [S, partly K]. | Not public [K]. | Capterra: training platform "went straight down hill after the first year," boring lessons, "confusing logins post Target Solutions takeover" [S]. Integration seams across acquired products [R/inference]. |
| **ZOLL Data Systems** | Division of ZOLL Medical (Asahi Kasei Group) [S]. | EMS-centric: emsCharts/ZOLL ePCR, RescueNet (billing, CaseReview, dispatch/CAD), Pulsara integration (2025) [S]. NEMSIS v3.5 and NFIRS export from emsCharts [S]. | Not public. | Little fire-RMS momentum found. Strength lies in monitor-to-ePCR and billing [S/K]. |
| **Aladtec** | Made by TCP Software [S]. | Scheduling and workforce management for EMS, fire, law enforcement and dispatch [S]. | Per-user annual subscription; a "$29/month" starting figure appears on aggregators but is unverified [S]. | About 4.6/5 from about 17 reviews; no specific cons found [S]. Single-purpose product [R]. |
| **PSTrax** | Founded 2009, Littleton CO. Level Equity investment Aug 2025 (Growth Street remains minority) [S]. Published a statement that it is "not open to purchase or acquisition" (undated) [S]. | Apparatus and equipment checks, inventory, station and facility checks, PPE, controlled substances [S/K]. | Module-based quotes, per-user per aggregators; no figures [S]. | Capterra 5.0/5 (20 reviews); the main stated con is "better integration with other software" [S]. |
| **Operative IQ** | Published by EMS Technology Solutions LLC, Austell GA; founded 2007 as "Ambutrak"; no acquisition found [S]. | EMS inventory, assets, fleet maintenance, narcotics; Signifi smart-locker integration [S]. | Not public. | Not researched in depth (search budget). |
| **Station Boss** | Small vendor; web app plus iOS [S]. | Claims NERIS reporting, dispatch, scheduling, personnel, training, preplans, inspections, equipment [S]. | Vendor-claimed: **all modules from $150/month, no long-term contract** (unverified) [S]. | Few independent reviews [S]. Represents the low-cost, small-department disruptor tier. |
| **Others to track** | Emergent (NERIS-certified Oct 28, 2025) [S]; EPR FireWorks [S]; D4H, Tyler Enterprise Public Safety, IamResponding (G2 lists these as ESO alternatives) [S]; Lexipol (policy; GTCR-owned; acquired LEFTA in 2024) [S]; CentralSquare (CAD) [S]. | | | |

### 1.3 Common complaint themes (synthesized from the reviews above; small samples)

1. **Support quality falls after acquisition.** Strongest signal is for ESO, also seen with Vector/TargetSolutions [S].
2. **Clunky, click-heavy UX and steep learning curves**, especially in highly configurable products (ImageTrend) [S].
3. **Poor mobile and tablet experience**: tiny touch targets in moving rigs, lag on poor cellular coverage, crashes [S, opinion pieces].
4. **Lengthy implementations** [S].
5. **Price and opaque pricing.** No major vendor publishes prices [S].
6. **Integration gaps between point solutions**, e.g. PSTrax users asking for better integration [S].
7. **Forced migrations after M&A**: Emergency Reporting customers pushed to ESO Fire RMS; North Dakota districts told to transition [S].

### 1.4 Differentiation opportunities for SomaOS [R]

1. **Transparent, published pricing** that scales by station or apparatus count, with a usable tier for volunteer departments. Station Boss shows the demand at $150/month; First Due runs about $35K/year for a district.
2. **Offline-first rig and tablet UX as a core competency, not an afterthought.** Large touch targets, glove-friendly design, and sync that works with zero signal.
3. **Configurability without consultants.** A no-code form/field/workflow builder with sane defaults ("opinionated templates by department type"). This addresses the "highly customizable but steep learning curve" complaint.
4. **Multi-agency/regional tenancy as a first-class feature.** County consortia, automatic- and mutual-aid data sharing, and joint training records. Incumbents are built mostly around single agencies [K/R; verify against competitor demos].
5. **Fast onboarding and migration tooling.** Importers for ESO/ER/FIREHOUSE/ImageTrend/First Due exports. FDNY's two-month cutover is now the benchmark First Due advertises [S].
6. **Firefighter health and exposure as a member-owned record**, portable across departments, with export to the National Firefighter Registry (see section 5).
7. **Open API and webhooks by default.** This counters the integration complaint.
8. **Support SLAs published in the contract.** This targets ESO's weakest point.

---

## 2. Access control

### 2.1 Typical role hierarchy (needs to be configurable, not hard-coded) [K/R]

Ranks vary widely: career, volunteer, combination, private EMS, county. Model **rank/title** (display) separately from **role** (permission bundle) and from **assignment** (station/shift/unit/battalion/agency).

| Role family | Examples | Typical permission needs |
|---|---|---|
| Executive | Fire Chief, Deputy/Assistant Chief, EMS Chief, Board/Commissioner (volunteer districts) | Department-wide read; configuration; approvals; analytics |
| Command | Battalion/District Chief, Shift Commander | Scope = battalion/shift; approve reports, staffing, time-off |
| Company officer | Captain, Lieutenant, Station Officer | Scope = station/unit/shift; review and approve incidents, daily logs, checks |
| Line | Firefighter, FF/Paramedic, AEMT/EMT, Engineer/Driver-Operator | Create and own incident/ePCR records; complete checks; view own records |
| Volunteer / Paid-on-call | Volunteer FF, Junior/Explorer | Like line, with response tracking and possibly restricted PHI access |
| Probationary | Probie, Recruit | Restricted: can draft, needs co-signature; time-bound role |
| Clinical oversight | Medical Director, EMS Coordinator, QA/QI Reviewer | PHI read across department for QA; protocol management; flags; no edit of locked charts except addenda |
| Specialist officers | Training Officer, Logistics/Inventory/Quartermaster, Fleet/Apparatus Officer, Fire Marshal/Inspector, Investigator, Safety Officer, PIO, Health/Wellness/Exposure officer | Module-scoped admin |
| Administration | Admin/HR, Payroll, Billing (EMS revenue cycle), IT admin | HR fields (salary, discipline, medical) siloed; billing needs PHI minimum necessary |
| Oversight | Read-only auditor, City/County IT security, Records custodian (FOIA/public records) | Read and export logs; no PHI unless granted |
| External | Mutual-aid partner, Regional/County admin, State reporting liaison, Hospital (handoff), Vendor support (impersonation with consent) | Cross-tenant, time-bound, purpose-limited grants |

### 2.2 Recommended authorization model [R, based on K]

- **Hybrid RBAC + ABAC (+ relationship-based for multi-agency).**
  - **RBAC** gives admins understandable permission bundles. Tenants can clone and edit system roles.
  - **ABAC conditions** cover:
    - scope (`record.station_id IN user.assigned_stations`, `shift`, `battalion`);
    - ownership (`record.author = user`);
    - record state (draft/locked/submitted);
    - time (active assignment, probation end date);
    - device posture (managed tablet);
    - purpose of use.
  - **ReBAC** (Zanzibar-style relations such as `agency#member`, `consortium#shared_with`) for cross-agency sharing.
- **Policy engine candidates:** OpenFGA (Zanzibar model; CNCF project), AWS Cedar (open-source policy language with an analyzable policy model), Oso, Permit.io, or an in-house policy table evaluated in the app plus Postgres RLS as a backstop [K; maturity not re-verified this session].
- **Field-level PHI restrictions.** Tag fields with sensitivity classes: PHI, HR-confidential, CJI, investigative, juvenile. Grant access by class.
  - Enforce in the API serializer layer and in exports, reports and search indexes. Search indexes are the most common leak path.
  - Mask by default: show "Patient: J. D., 40s M" to non-clinical roles.
- **HIPAA "minimum necessary"** principle applies to non-treatment uses [K].
- **Break-the-glass.** HIPAA requires an "emergency access procedure" under 45 CFR 164.312(a)(2)(ii) [K]. Implement it as:
  1. The user selects a reason (from a list plus free text).
  2. Time-boxed elevated access (for example 60 minutes).
  3. Prominent banner during the session.
  4. Immutable audit record.
  5. Real-time notification to the privacy officer or QA.
  6. Mandatory post-hoc review queue.
- **Separation of duties.** For example, a QA reviewer cannot approve their own chart, and an inventory officer who adjusts narcotics counts needs a witness/co-sign (DEA controlled-substance practice [K]).
- **Delegation and acting roles.** "Acting Captain" for one shift is very common in fire departments. Support time-bound role assumption, driven by the schedule.

### 2.3 Multi-agency / regional tenancy [R]

Hierarchy: `Platform → Organization (e.g., County consortium / private EMS company) → Agency (department) → Division/Battalion → Station → Unit/Apparatus`.

- **Data ownership stays with the agency.** Sharing is explicit, via **data-sharing agreements modeled as objects**: which datasets, which fields, read or write, purpose, expiry. Examples: county-wide hydrants, shared pre-plans along borders, joint training records, regional CQI with PHI limited to the medical director.
- **Users can belong to several agencies.** This is common for volunteers and for career staff who volunteer elsewhere. Use one identity, with per-agency memberships and roles, and an explicit context switch in the UI.
- **Regional rollups:** aggregated or de-identified analytics across agencies, without row-level PHI.
- **Private EMS with multiple contracts:** one company, many service areas or contracts, with segregated reporting.

### 2.4 SSO and MFA

- **SSO.** Support SAML 2.0 and OIDC. Microsoft Entra ID is extremely common in municipal IT (Microsoft 365 Government) [K]; also support Okta, Google Workspace and ADFS. Add **SCIM 2.0** provisioning and deprovisioning, which matters for terminations. Allow per-tenant IdP configuration, with several IdPs per consortium.
- **Volunteers without municipal accounts.** Provide native login with passkeys/WebAuthn, plus TOTP. Avoid SMS where possible.
- **Shared station tablets.** Use quick user switching (PIN or badge/NFC) on a device enrolled with MDM, with short auto-lock. Shared generic accounts break audit trails and HIPAA unique user identification [K].
- **MFA drivers:**
  - CJIS Security Policy v6.0 (Dec 27, 2024) makes MFA a key requirement for CJI access. Audit/sanction dates vary by control; sources cite Oct 1, 2025 audits (California) and Oct 1, 2027 full compliance [S]. A v6.1 was reportedly published June 25, 2026 (single source; verify) [S].
  - The HIPAA NPRM proposes mandatory MFA (see section 3) [K].
  - Cyber-insurance underwriting commonly requires MFA [K].
  - **Recommendation [R]:** MFA mandatory for all admin, PHI and export roles; tenant-configurable for others; phishing-resistant options available (FIDO2).

---

## 3. Compliance

### 3.1 HIPAA applicability

- A fire/EMS agency that **bills electronically for EMS** (for example Medicare claims) is generally a **covered entity**. A fire-only department that does not bill likely is not [S].
- The county or city is often the legal covered entity, sometimes as a **hybrid entity**. Fairfax County's hybrid entity includes its Fire and Rescue Department [S].
- One secondary source says fire departments generally *cannot* self-designate as hybrid entities because fire and EMS functions overlap. This is contested; verify with counsel [S].
- A billing vendor or SaaS platform holding PHI is a **business associate** and must sign a **BAA** [S].
- **Implication [R]:** SomaOS must be built and contracted as a HIPAA business associate from day one, even for customers that are not covered entities. Many will be covered entities, and private EMS always is.

### 3.2 HIPAA Security Rule: current technical safeguards (45 CFR 164.312) [K; eCFR fetch blocked]

- **Access control (required):** unique user identification; emergency access procedure.
- **Access control (addressable):** automatic logoff; encryption/decryption.
- **Audit controls (required).**
- **Integrity:** mechanism to authenticate ePHI (addressable).
- **Person or entity authentication (required).**
- **Transmission security:** integrity controls and encryption (addressable).

### 3.3 HIPAA Security Rule NPRM: status

- NPRM published January 2025 [K: Federal Register Jan 6, 2025].
- **Status as of mid-2026:**
  - HHS moved the projected final rule from **May 2026 to July 2027**.
  - The rulemaking was moved from the "final rule stage" to "long-term actions."
  - One source reports the rule was sent to OMB on April 4, 2026; this is unconfirmed.
  - **The current Security Rule remains in force** [S: Fierce Healthcare, Holland & Knight, DWT, HIPAA Journal].
  - No newer status was found after July 2026; check reginfo.gov.
- **Key proposed changes [K; verify against the Federal Register]:**
  - Remove the "addressable" distinction, making most specifications required.
  - Mandatory encryption of ePHI at rest and in transit, with limited exceptions.
  - Mandatory MFA.
  - Written technology asset inventory and network map.
  - Vulnerability scanning at least every 6 months; penetration testing at least annually.
  - Ability to restore relevant systems within **72 hours**.
  - Annual compliance audit.
  - Business associates verify their safeguards annually; BAs notify covered entities of contingency-plan activation within 24 hours.
- **Recommendation [R]:** build to the NPRM now. It aligns with SOC 2 and GovRAMP anyway, and buyers' security questionnaires already ask for these controls.

### 3.4 CJIS

- **When CJIS applies [K/R]:** only if SomaOS stores or transmits **Criminal Justice Information**. Examples: NCIC/III query results, criminal histories, or certain law-enforcement CAD data in a shared PSAP or consolidated CAD. Fire and EMS CAD feeds are normally not CJI, but consolidated public-safety CAD interfaces sometimes carry law-enforcement narratives.
- **Recommendation [R]:** filter law-enforcement-only fields at the CAD interface, and contractually exclude CJI. If a law-enforcement module is ever added (First Due has one [S]), plan a CJIS-aligned enclave:
  - personnel background checks;
  - CJIS Security Addendum;
  - FIPS 140-validated encryption;
  - US-only, CJIS-attested hosting (AWS GovCloud or Azure Government) [K].
- CJIS policy versions: v6.0 dated Dec 27, 2024; v6.1 reported June 2026 [S].

### 3.5 SOC 2, GovRAMP (formerly StateRAMP), FedRAMP

- **SOC 2 Type II [R/K]** is the de facto baseline for municipal SaaS security reviews. Plan for a Type I within about 6 months of launch and a Type II after a 6–12 month observation window.
- **GovRAMP:** StateRAMP rebranded to GovRAMP in 2025 (legally still StateRAMP, operating as GovRAMP) [S]. Reported in use in about 27 states for authorizing cloud services (2025) [S]. Not all states accept it; some require state-specific programs such as TX-RAMP and AZ-RAMP [S/K]. Arizona example: renewals from July 1, 2026 must align with GovRAMP or FedRAMP [S].
  - **Recommendation [R]:** pursue GovRAMP "Progressing/Ready" early, because state-level and large-city procurements increasingly ask for it. Building on NIST 800-53 Moderate controls serves GovRAMP, TX-RAMP and future FedRAMP alike.
- **FedRAMP:** relevant only for federal customers. Examples: DoD/federal fire departments (Emergency Reporting had 170+ DoD installations [S]), USFA/FEMA, federal land-management fire.
  - FedRAMP 20x pilots: Low authorizations completed; Moderate pilot authorizations from March 2026.
  - Phase 3 / "Consolidated Rules for 2026" planned to open submissions FY26 Q4, with classes A–D replacing Low/Moderate/High.
  - Whether these paths are live as of Nov 2026 is unconfirmed [S].
  - **Recommendation [R]:** defer FedRAMP; design so that a GovCloud deployment is possible later.

### 3.6 Data residency, encryption, audit, backup/DR [K/R]

- **Residency:** US-only hosting and US-only support personnel with PHI access. Canada needs in-country hosting if marketed there (provincial health-privacy laws [K]). Use a per-region tenant placement model.
- **Encryption:**
  - TLS 1.2+ (prefer 1.3).
  - AES-256 at rest with KMS.
  - Optional per-tenant keys (BYOK/CMK) for large city/county customers.
  - FIPS 140-validated modules for CJIS or federal work.
  - Encrypted local databases on devices (for example SQLCipher) and MDM-enforced device encryption.
- **Audit logs:**
  - Append-only (WORM/object-lock) storage of who, what, when, where (device/IP), before and after values, and the reason for break-glass.
  - Log reads of PHI, not just writes.
  - Retention of at least **6 years** for HIPAA documentation [K: 164.316(b)(2)]. State public-records retention schedules for incident and ePCR records are often longer (state-specific).
  - Customer-facing audit viewer and export (SIEM integration via syslog/webhook).
- **Backup/DR:**
  - Point-in-time recovery, cross-region replicas, quarterly restore tests.
  - Targets: **RTO at most 72 hours** (NPRM-aligned), and RTO 4h / RPO 15 min or better as a commercial target [R].
  - Status page; contractually defined SLA (99.9%+).
  - Mobile offline capability doubles as continuity of operations during outages.

### 3.7 Accessibility (Section 508 / WCAG 2.1 AA / ADA Title II)

- **Rule:** the DOJ 2024 ADA Title II rule adopts **WCAG 2.1 Level AA** for state and local government web content **and mobile apps**, including content provided "through contractual, licensing, or other arrangements" [S/K]. That covers vendor SaaS used to deliver services. Staff-only internal tools are debated, but public-facing portals are clearly in scope [R].
- **New dates (Interim Final Rule, Apr 20, 2026)** [S: govinfo FR 2026-07663]:
  - Entities with population **50,000+**: **April 26, 2027** (was April 24, 2026).
  - Entities **under 50,000 and special district governments**: **April 26, 2028** (was April 26, 2027).
  - Many fire districts are special districts, so they fall on the 2028 date.
- **Further possible changes:** DOJ signaled possible further rulemaking on substance. SBA Advocacy recommended withdrawing the rule for small governments (June 2026). Underlying ADA obligations continue in the meantime [S]. HHS issued a parallel extension for its Section 504 web rule (May 11, 2027 / May 11, 2028) [S].
- **Recommendation [R]:**
  - Build to WCAG 2.1 AA (aim for 2.2 AA) in both web and mobile apps.
  - Publish a **VPAT/ACR**, which procurement asks for.
  - Pay special attention to public-facing components: inspection scheduling portals, permit payments, records requests, community risk reduction sign-ups, and public dashboards.

---

## 4. Customizability architecture for multi-tenant SaaS [mostly K/R]

### 4.1 Custom fields and entities

- **Recommendation:** use **typed core columns plus a JSONB `custom` column** per extensible entity, driven by a per-tenant **field-definition registry** (type, validation, options, visibility/sensitivity class, required-by-workflow, NERIS/NEMSIS mapping).
  - Use GIN or expression indexes on hot custom keys.
  - Prefer JSONB over EAV. EAV makes reporting joins painful and validation weak; JSONB keeps a record in one row and is query-able in Postgres.
- **Custom entities** (for example "SCBA bottles," "Grant applications"): use a generic `custom_records` table (tenant_id, entity_type_id, JSONB data, standard metadata), with the same permission and audit machinery as built-in entities.
- **Regulatory fields stay locked.** NERIS and NEMSIS mandatory elements remain first-class typed columns that tenants cannot delete. Tenants may add, hide (if optional) or relabel them. State-specific NEMSIS extensions come from state data dictionaries and schematrons [K].
- **Form/layout builder:** tenant-defined layouts and sections, conditional visibility, and versioned form definitions. Each record stores the form version it was completed with, which matters for legal records.

### 4.2 Configurable workflows and rules

- **State machines per record type** (draft → submitted → officer review → QA → locked → exported to NERIS/state). Tenants configure states, transitions, required approvers (role or scope), and SLAs.
- **Rules engine.** Use JSON-logic or CEL-style expressions for validation ("if patient refused transport, require refusal form"), auto-assignment, notifications (exposure logged → notify health officer; inspection overdue → notify inspector), and computed fields.
- **Durable workflow runtime** for long-running processes such as inspection re-inspection cycles, credential expiry reminders and NERIS submission retries. Candidates: Temporal, or a Postgres-backed queue such as pg-boss or graphile-worker [K].
- **Department-type templates:** career, volunteer, combination, private EMS, county/consortium, industrial/airport (ARFF). Each seeds roles, forms, workflows and terminology.

### 4.3 Per-tenant terminology and labels

- An i18n layer with **tenant overrides** on top of locale strings. Examples: "Truck" vs "Ladder," "Medic" vs "Rescue," "Battalion" vs "District," "Shift A/B/C" vs "Red/Blue/Green," "Member" vs "Employee." Also supports Spanish and French (Canada).
- Store canonical codes internally (NERIS/NEMSIS value sets); show tenant labels.

### 4.4 Modules and feature flags

- **Entitlements service:** plan → modules → feature limits (seats, stations, storage). Checked server-side and reflected in the client.
- **Feature flags** (OpenFeature-compatible provider, or a self-hosted tool such as Unleash/Flagsmith) for progressive rollout, separate from commercial entitlements.
- **Module boundaries** in code (modular monolith) so modules can be licensed independently.

### 4.5 White-label and branding

- Per-tenant logo, colors (checked against WCAG contrast), custom domain/subdomain, email sender domain (SPF/DKIM per tenant), branded PDFs (incident reports, inspection reports, invoices).
- Full white-label for resellers or regional consortia [R: optional, enterprise tier].

### 4.6 Extensibility

- **Public REST/OpenAPI** (or GraphQL) API with OAuth2 client credentials, per-tenant API keys, scopes mirroring RBAC, and rate limits.
- **Outbound webhooks**: signed (HMAC), with retries, a dead-letter queue and replay. Events such as `incident.locked`, `exposure.created`, `inspection.failed`, `apparatus.out_of_service`.
- **Inbound integrations:**
  - CAD: vendor APIs; NENA standards; often a CAD-to-RMS XML/JSON feed or polling [K].
  - Monitors: ZOLL/Stryker/Philips data import into ePCR [K].
  - HIEs: HL7 FHIR for hospital outcome data (ESO HDE is the incumbent example [S]).
  - Payroll and HR systems; GIS (Esri ArcGIS).
- **Data export:** tenant-owned bulk export and a read replica or warehouse share (Parquet/S3, or an Snowflake/BigQuery connector). This reduces lock-in fears.

---

## 5. Adjacent modules commonly expected

| Module | Notes and requirements |
|---|---|
| **NERIS incident reporting** | NFIRS retired; NERIS is the only national fire incident data system from Feb 1, 2026 (USFA: NFIRS decommissioned Jan–Feb 2026) [S]. NERIS data is hosted outside the federal government via the Fire Safety Research Institute (FSRI) infrastructure [S]. Vendors must earn a **NERIS compatibility/certification badge** (ESO, Emergent and First Due claim it; First Due claims v1.5 support) [S]. NERIS is all-hazards and API-based, including real-time-ish submission [K]. **Must-have for launch.** |
| **ePCR / NEMSIS** | NEMSIS v3.5.1 transition is ongoing. California accepts only v3.5.1 from **Nov 1, 2026** [S]. State schematron validation; state repository submission (many states use ImageTrend repositories [K]). Needed for EMS-transporting customers and private EMS. |
| **CAD integration** | Auto-create incidents, times, units and addresses from CAD; live incident board; unit status. Vendors: CentralSquare, Tyler, Hexagon, Motorola, Zoll RescueNet, Logis (ESO) [S/K]. Build a CAD adapter framework. |
| **Pre-incident planning** | Floor plans, hazards, Knox box, utilities, hydrant proximity, photos; offline on rigs. Market evidence: ImageTrend bought FlowMSP, First Due bought Data Chief [S]. |
| **Inspections / CRR / occupancies** | Occupancy database, inspection scheduling by risk, violations, re-inspections, permits, fees, public portal. NFPA 1730 requires the AHJ to set inspection frequency via community risk assessment, with a minimum frequency table (Table 6.7, mirrored in NFPA 1 Table 10.2.7.1) [S]. **Uncertain:** NFPA has been consolidating standards (e.g., NFPA 1660 for emergency/continuity planning); whether NFPA 1730 is folded into a consolidated standard was **not confirmed** [needs verification]. Make frequency rules configurable per tenant. |
| **Hydrants** | Inventory, flow tests, NFPA 291 color coding, out-of-service status, GIS sync, shared county-wide [K]. |
| **Personnel / HR** | Rank, certifications/licenses with expiry (EMT/paramedic, state FF certs), training hours (ISO/insurance rating training requirements), discipline (restricted), awards, emergency contacts, documents. |
| **Training / LMS** | Training records, ISO credit hours, course catalog, sign-in via QR, skills sign-offs. Vector Solutions/TargetSolutions is the incumbent [S]. |
| **Scheduling / staffing** | Shift patterns (24/48, Kelly days), callbacks/overtime rotation, minimum staffing, trades, leave; volunteer availability and response. Incumbents: Aladtec, Vector Scheduling (CrewSense), ESO Scheduling, TeleStaff [S/K]. |
| **Health and exposure tracking** | Per-member exposure log: incident, hazmat/smoke/carcinogen/PFAS, PPE used, decon, duration, follow-up. Health screening thresholds and alerts (Vector's Guardian Tracking does this) [S]. The IAFF/IPSDI **NFORS Exposure Tracker** is a free incumbent that members carry with them [S]. **National Firefighter Registry for Cancer:** more than 40,000 enrolled (Feb 2026); reauthorized Dec 2024 at $5.5M/yr through 2028; enrollment portal briefly shut in April 2025 amid NIOSH layoffs, then restored [S]. **Opportunity [R]:** help members enroll in the NFR and export their exposure history (no API is known; do not assume one). Also track PPE contamination/cleaning (NFPA 1851 lineage; edition details unverified). |
| **Inventory / assets / apparatus checks** | Daily/weekly rig checks, SCBA, PPE, med supplies with expiry/lot, controlled substances with dual sign-off, fleet maintenance, work orders. Incumbents: PSTrax, Operative IQ, Vector Check It [S]. |
| **Station logbook / daily journal** | Shift journal, company activities, visitor log, station duties. Feeds ISO/training documentation [K]. |
| **Apparatus status board** | Real-time in/out of service, staffing per unit, move-ups; TV dashboard mode for the station. |
| **Member messaging / notifications** | Push/SMS/email/voice; recall/callback; acknowledgements; volunteer response ("responding/not responding"; IamResponding is the incumbent [S]). Note TCPA/10DLC registration for SMS [K]. |
| **Analytics dashboards** | NFPA 1710/1720 response-time compliance (turnout, travel, ERF), CQI dashboards, accreditation (CFAI) metrics. ImageTrend Continuum is the incumbent pattern [S/K]. |
| **Payroll export** | Time/attendance to Tyler Munis, Workday, ADP, Paylocity, etc.; FLSA 7(k) work periods for fire [K]. |
| **EMS billing** | Either integrate (third-party billing companies) or build later; BAA chain; 837 claims [K]. |
| **Mobile apps** | iOS/Android/Windows tablets in rigs (Windows rugged tablets and Toughbooks are common [K]), offline-first; iPad is common for ePCR. |

---

## 6. Tech stack options (maturity as of late 2026)

### 6.1 Requirements recap

- Offline-first tablets in rigs: hours without signal; conflict handling; large local datasets such as pre-plans and hydrants.
- Real-time sync for status boards.
- Web admin with complex forms.
- Postgres multi-tenancy with RLS; file storage (photos, PDFs, ECG strips); search.
- HIPAA BAA available from every subprocessor.

### 6.2 Option A (recommended): TypeScript end-to-end + Postgres + Expo + PowerSync

- **Web:** Next.js (React) or a Vite SPA for the admin app. The admin is heavily authenticated, so SSR adds little [R].
- **API:** NestJS or Fastify + tRPC/oRPC (internal), plus an OpenAPI REST surface (public API).
- **DB:** PostgreSQL 16/17 (AWS RDS/Aurora under a BAA) in a pooled model with **RLS**:
  - AWS guidance treats RLS as required for pooled isolation [S].
  - Use `FORCE ROW LEVEL SECURITY` and a non-owner app role [S].
  - Set tenant context transaction-locally (`SET LOCAL app.tenant_id`) and reset it on pooled connections [S].
  - Treat RLS as a safety net behind app-level authorization [S].
  - Index tenant columns; benchmark [S].
  - Escape hatch: schema-per-tenant or a dedicated database for very large or residency-sensitive tenants [S].
- **Mobile:** **Expo SDK 55+ / React Native 0.83+**.
  - SDK 55 was released Feb 26, 2026; New Architecture only; Legacy removed [S].
  - React Native for Windows is a possible path for Windows tablets (maturity not verified) [K].
- **Offline sync: PowerSync.**
  - Postgres → SQLite sync with an official React Native SDK [S].
  - **Sync Streams GA** (May 2026) [S].
  - **PowerSync Cloud HIPAA-compliant since Dec 2025** (with conditions, e.g. a HIPAA-compliant MongoDB Atlas bucket store) [S].
  - SOC 2 Type 2 reports for Team/Enterprise [S].
  - Self-hostable Open Edition (docs inconsistent on beta vs GA) [S].
  - Writes go through your own API (upload queue), which preserves server-side validation and authorization. Important for ePCR integrity [K/R].
- **Files:** S3 with object lock for audit, presigned URLs, client-side queue for offline photo capture, malware scanning.
- **Search:** start with Postgres FTS + pg_trgm. Move to OpenSearch (AWS, BAA-eligible [K]) when needed, with **per-tenant and per-sensitivity filtering in the index**.
- **Auth:** an established IdP broker that supports per-tenant SAML/OIDC + SCIM. Options: Keycloak (self-host), WorkOS, Auth0/Okta CIC, AWS Cognito [K; BAA availability varies by vendor, verify each].
- **Authorization:** in-app policy layer (OpenFGA or Cedar) + RLS backstop [R].
- **Pros:** one language; huge hiring pool; PowerSync is the most clearly supported RN + Postgres offline path in this research [S].
- **Cons:** PowerSync is a dependency and its pricing scales with usage. Sync rules must mirror authorization rules (dual maintenance) [R].

### 6.3 Option B: same TS stack with ElectricSQL + TanStack DB (or Zero)

- **ElectricSQL 1.0 GA** (Mar 17, 2025): read-path sync of Postgres "shapes"; writes go through your API [S].
- **TanStack DB:** 0.6 adds persistence; the README still says alpha/preview, and no 1.0 was found [S].
- React Native support is described as "community" in a (PowerSync-authored) comparison [S].
- **Zero (Rocicorp) 1.0** (GA by Mar–Jun 2026; now about v1.10) is web-first. Its maintainers previously said offline is out of scope, so it is a **poor fit for rigs** [S].
- **Verdict [R]:** good for the real-time web admin and status boards. Less proven than PowerSync for long-offline mobile ePCR as of 2026.

### 6.4 Option C: Supabase-based (faster MVP)

- Supabase (Postgres + Auth + Storage + Realtime + RLS-native) offers a **BAA on Team plan+ with a HIPAA add-on**, "High Compliance" projects, and SOC 2 Type 2 [S]. Add-on price unverified (one source says $350/mo) [S].
- Pairs with PowerSync, which has an official Supabase integration [S].
- **Pros:** very fast to build; RLS-first fits multi-tenancy.
- **Cons [R]:**
  - Supabase Auth enterprise SSO per tenant and SCIM depth need verification.
  - Vendor concentration.
  - GovRAMP/data-residency stories are weaker than raw AWS or Azure.
  - Migrating off later is feasible because it is "just Postgres."

### 6.5 Option D (alternative): .NET/Azure stack [K/R]

- ASP.NET Core + Azure Database for PostgreSQL + .NET MAUI (or native) + Entra ID.
- **Pros:** municipal IT familiarity with Microsoft; Azure Government path for CJIS/FedRAMP.
- **Cons:** weaker offline-sync ecosystem than PowerSync (you would build sync yourself or use Ditto/Couchbase Lite); MAUI's maturity and community are smaller than React Native's.
- **Use when:** the team is .NET-native or the go-to-market is heavily CJIS/law-enforcement.

### 6.6 Avoid or caution

- **WatermelonDB:**
  - Last release 0.28 (Apr 2025).
  - Sporadic maintenance (a competitor reports the last commit was Aug 2025).
  - Needs workarounds on Expo SDK 54 New Architecture.
  - The community Expo plugin lags.
  - Not recommended for a new 2026 build [S].
- **Generic CRDT sync** is overkill for structured records. It fits only collaborative rich text (e.g., narratives co-edited) [S/R].

### 6.7 Cross-cutting recommendations [R]

- **Modular monolith first** (clear module boundaries per licensed module). Split services later.
- **Conflict policy:**
  - ePCR/incident records are **single-author with officer/QA amendments recorded as addenda**. Avoid silent last-write-wins on clinical data.
  - Checklists and inventory use field-level merge.
  - Counts (controlled substances) are event-sourced.
- **Infrastructure as code** with region-per-deployment.
- **Observability with PHI scrubbing.**
- **CI tests that assert tenant isolation** for every table [S: recommended in RLS guides].

---

## Key open questions / items to verify

1. Reddit sentiment on First Due/ESO/ImageTrend. Not accessible this session; do a manual review of r/Firefighting, r/ems, r/NewToEMS.
2. Exact NERIS vendor certification process and the list of certified vendors (USFA/FSRI).
3. HIPAA NPRM final content and timing after July 2026 (reginfo.gov Fall 2026 agenda).
4. CJIS v6.1 details and audit dates for MFA (FBI CJIS site).
5. Whether NFPA 1730 has been consolidated into a newer standard; NFPA 1851 current-edition contamination requirements.
6. FedRAMP 20x Phase 3 live status; current GovRAMP state-adoption list.
7. Competitor multi-agency/consortium features. Verify via demos; this research found no evidence either way.
8. Authorization-engine maturity (OpenFGA, Cedar) and IdP broker BAA availability. The search budget ran out before these were checked.

---

## Sources

**Competitive landscape**
- ESO/Emergency Reporting: https://www.businesswire.com/news/home/20210625005026/en/ESO-Signs-Definitive-Agreement-to-Acquire-Emergency-Reporting-Leading-Fire-Records-Management-System-RMS ; https://www.firemarshal.nd.gov/news/data-reporting-option-north-dakota-fire-districts ; https://eso.com/er-upgrade
- ESO other acquisitions: https://www.ems1.com/fire-products/emergency-response-software/from-call-to-care-eso-acquires-logis-solutions-reinventing-emergency-response ; https://www.jems.com/industry-news/eso-acquires-healthcare-performance-improvement-company-d2i/ ; https://www.firehouse.com/technology/billing/press-release/12372459/eso-solutions-eso-solutions-acquires-conduent-incorporateds-firehouse-software
- ESO modules: https://www.eso.com/My-Fire-RMS/ ; https://www.eso.com/news/press-releases/eso-announces-eso-fire-rms-the-next-generation-fire-record-management-system-rms-for-fire-departments-of-all-sizes/ ; https://www.eso.com/neris/
- ESO reviews: https://www.capterra.com/p/121521/FIREHOUSE-Software/reviews/ ; https://www.g2.com/products/eso-fire-rms/reviews ; https://www.softwareadvice.com/fleet-management/eso-fire-rms-profile/ ; https://www.capterra.com/p/162019/EPR-Fireworks/?page=2
- First Due: https://www.businesswire.com/news/home/20250805965636/en/First-Due-Secures-$355-Million-Strategic-Investment-to-Accelerate-Innovation-in-Public-Safety-Software ; https://www.firstdue.com/news/firstdueacquiresdatachief ; https://www.centralsquare.com/news-and-events/press/centralsquare-firstdue-partnership-announcement ; https://www.firstdue.com/news/the-fdnys-adoption-of-first-due-sets-a-national-example-in-neris-compliance ; https://www.firstdue.com/customer-success-stories/fdny-transitions-citywide-incident-reporting-to-first-due-at-unmatched-scale ; https://www.fireengineering.com/industry-news/first-due-delivers-neris-v1-5-reporting-capabilities-from-day-1/
- First Due pricing/reviews: https://civiciq.com/public-contract/e7192092-841e-4ef1-8c00-423bff0212b0 ; https://g2.com/products/first-due/pricing ; https://www.capterra.com/p/179338/First-Due/reviews/ ; https://g2.com/compare/eso-fire-rms-vs-first-due
- ImageTrend: https://www.imagetrend.com/news/posts/imagetrend-acquires-flowmsp/ ; https://www.ems1.com/ems-products/epcr-electronic-patient-care-reporting/imagetrend-acquires-biospatial ; https://www.imagetrend.com/press-releases/growth-acquisitions-brand-evolution/ ; https://www.imagetrend.com/wp-content/uploads/2023/06/ImageTrend_EliteRescue_2026.pdf ; https://www.imagetrend.com/wp-content/uploads/2023/06/ImageTrend_EliteFire_2026.pdf ; https://www.g2.com/products/imagetrend/reviews_and_filters ; https://www.imagetrend.com/blog/ems-software-implementation-crew-adoption/
- Vector Solutions: https://www.vectorsolutions.com/resources/newsroom/vector-solutions-acquires-frontline-public-safety-solutions-to-expand-critical-agency-software/ ; https://www.vectorsolutions.com/news-media/press-releases/mobile-workforce-management-halligan-acquisition/ ; https://www.vectorsolutions.com/about-us/acquisitions/ ; https://www.capterra.com/p/178441/School-Safety-and-Compliance-Training/reviews/
- ZOLL: https://www.zolldata.com/ems-software/epcr ; https://yespress.io/zoll-data
- Aladtec: https://capterra.com/p/248403/Aladtec/ ; https://www.softwareadvice.com/hr/aladtec-profile/
- PSTrax: https://www.privsource.com/acquisitions/deal/krSw4p ; https://pstrax.com/pstrax-comments-on-recent-market-acquisitions/ ; https://capterra.com/p/210778/PSTrax/reviews/
- Operative IQ: https://www.capterra.com/p/252311/Operative-IQ/ ; https://www.ems1.com/ems-products/software/operative-iq-and-signifi-partner-to-bring-intelligent-resource-management-to-ems-agencies
- Station Boss: https://stationboss-website.pages.dev/ ; https://apps.apple.com/us/app/station-boss/id1632754563
- Emergent NERIS: https://emergent.freshdesk.com/support/solutions/articles/150000215344-neris-certification-annoucnement
- ePCR UX commentary: https://august.mataroa.blog/blog/first-responders-deserve-better/ ; https://medium.com/beyond-lucid-technologies/why-badly-designed-ipad-apps-put-patients-at-risk-ems-and-epcr-8f89d51f0c4a

**Compliance**
- HIPAA NPRM delay: https://www.fiercehealthcare.com/health-tech/feds-push-back-hipaa-security-rule-overhaul-july-2027 ; https://hklaw.com/en/insights/publications/2026/07/hipaa-security-rule-amendments-now-projected-for-july-2027 ; https://www.dwt.com/blogs/privacy--security-law-blog/2026/07/hhs-updates-rulemaking-timeframes ; https://hipaajournal.com/hipaa-security-rule-update-postponed ; https://www.hhs.gov/hipaa/for-professionals/regulatory-initiatives
- HIPAA applicability to fire/EMS: https://www.fairfaxcounty.gov/HIPAA/Pages/CoveredEntity.aspx ; https://www.paubox.com/blog/does-hipaa-apply-to-first-responders ; https://www.hipaajournal.com/hipaa-training-for-fire-department-staff/ ; https://sog.unc.edu/node/95391 ; https://www.fireengineering.com/firefighting/hipaa-focus-business-associates/
- CJIS: https://www.fdle.state.fl.us/CJJIS/CJIS_Security_Policy_v6-0_20241227-(2).aspx ; https://www.dps.texas.gov/sites/default/files/documents/securityreview/documents/RequirementCompanionDoc_v6-1.pdf ; https://www.oag.ca.gov/system/files/media/2025-isrs-001.pdf ; https://bleepingcomputer.com/news/security/fbis-cjis-v61-what-security-teams-need-to-know ; https://www.naco.org/news/new-fbi-criminal-justice-information-services-cjis-security-rule-requirements
- GovRAMP: https://govtech.com/news/stateramp-is-now-govramp-reflecting-broader-participation ; https://govramp.org/blog/stateramp-announces-rebrand-to-govramp-reflecting-mission-to-unite-public-and-private-sectors-in-advancing-cybersecurity/ ; https://route-fifty.com/cybersecurity/2025/02/exclusive-stateramp-rebrand-later-year/403026 ; https://statetechmagazine.com/article/2025/04/stateramp-rebrands-to-govramp-perfcon
- FedRAMP 20x: https://www.fedramp.gov/20x/phases/2/ ; https://fedramp.gov/20x/phases/3/ ; https://fedramp.gov/20x/timeline/ ; https://www.a-lign.com/articles/fedramp-20x-what-it-is-and-where-it-stands-today
- ADA Title II: https://www.govinfo.gov/content/pkg/FR-2026-04-20/html/2026-07663.htm ; https://www.ada.gov/title-ii-web-rule/ ; https://www.sog.unc.edu/blogs/coates-canons/deadlines-comply-ada-web-accessibility-requirements-extended-one-year ; https://advocacy.sba.gov/2026/06/23/advocacy-recommends-that-doj-withdraw-ada-accessibility-rule-for-small-governments/ ; https://er.educause.edu/articles/2026/6/doj-and-hhs-extend-web-accessibility-deadlines-to-2027-2028 ; https://www.duanemorris.com/alerts/doj_extends_ada_title_ii_digital_accessibility_deadlines_one_year_0426.html

**Adjacent modules**
- NERIS/NFIRS: https://www.usfa.fema.gov/nfirs/sunset/ ; https://www.usfa.fema.gov/nfirs/neris/faq ; https://www.hstoday.us/subject-matter-areas/emergency-preparedness/nfirs-retired-as-fire-administrations-new-neris-platform-becomes-the-nations-only-fire-incident-data-system/ ; https://tdi.texas.gov/Fire/neris.html ; https://www.nvfc.org/important-reminder-about-nfirs
- NEMSIS: https://www.ochealthinfo.com/sites/healthcare/files/2025-10/%235648%20OC-MEDS%20PCRS%20Update%20-Transition%20to%20NEMSIS%20v3.5.1.pdf ; https://nemsis.org/wp-content/uploads/2026/03/NEMSIS-Activity-Report-February-2026.pdf
- NFR: https://www.cdc.gov/media/releases/2026/2026-cdcs-national-firefighter-registry-for-cancer-is-now-the-largest-in-the-nation.html ; https://www.kjzz.org/politics/2025-05-15/after-being-shut-down-by-federal-layoffs-registration-for-firefighter-cancer-study-is-back-open ; https://cdc.gov/niosh/firefighters/registry/newsletter.html
- Exposure tracking: https://www.iaff.org/wp-content/uploads/NFORS-iPSDI-App-18x24-Poster-2020.pdf ; https://www.vectorsolutions.com/resources/blogs/the-importance-of-firefighter-cancer-awareness-prevention-and-early-detection-on-and-off-the-fireground/ ; https://www.nist.gov/node/1679636
- NFPA 1730: https://docinfofiles.nfpa.org/files/AboutTheCodes/1730/1730_A2018_FID_AAA_SD_PCresponses.pdf ; https://floridabuilding.org/fbc/commission/FBC_1023/EBIWG/Attachment_5-NFPA_1730_References.pdf

**Tech stack**
- RLS: https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html ; https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security ; https://clickhouse.com/resources/engineering/multi-tenant-saas-postgres-architecture ; https://dev.to/canu/why-we-stopped-using-row-level-security-after-1m-rows-4dpb
- PowerSync: https://powersync.com/blog/powersync-changelog-may-2026 ; https://docs.powersync.com/resources/feature-status ; https://docs.powersync.com/resources/hipaa ; https://powersync.com/blog/powersync-cloud-is-now-hipaa-compliant.md ; https://docs.powersync.com/resources/security ; https://docs.powersync.com/self-hosting
- Electric/TanStack DB: https://electric-sql.com/blog/2025/03/17/electricsql-1.0-released ; https://tanstack.com/blog/electric-partnership ; https://github.com/TanStack/db
- Zero: https://infoq.com/news/2026/06/zero-version-1 ; https://zero.rocicorp.dev/docs/release-notes/1.0
- Comparisons: https://powersync.com/blog/electricsql-vs-powersync ; https://www.pistack.xyz/posts/2026-10-21-local-first-sync-engines-electricsql-powersync-triplit/ ; https://telemetry-landing.pages.dev/blog/electricsql-vs-powersync-vs-replicache/
- WatermelonDB: https://watermelondb.dev/docs/CHANGELOG ; https://rxdb.info/articles/alternatives/watermelondb-alternative.html ; https://dev.to/fasthedeveloper/watermelondb-expo-sdk-54-the-complete-mobile-offline-first-setup-guide-that-actually-works-5he5
- Expo: https://expo.dev/changelog/sdk-55 ; https://docs.expo.dev/guides/new-architecture ; https://expo.dev/blog/upgrading-to-sdk-55
- Supabase: https://supabase.com/docs/guides/security/hipaa-compliance ; https://supabase.com/docs/guides/platform/hipaa-projects.md ; https://supabase.com/docs/guides/security/soc-2-compliance ; https://supabase.com/docs/guides/deployment/shared-responsibility-model
