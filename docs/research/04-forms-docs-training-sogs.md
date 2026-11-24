# SomaOS Research 04: Forms and Signatures, Documents, Training, SOGs and Protocols

Research date: 2026-11-24.

**Method and limits.** These findings come from web search result summaries. Direct page fetches were blocked by the session network (nremt.org, capce.org and support.nremt.org did not resolve). The shared web-search budget ran out before I could search legal hold, FOIA/public records, the HIPAA hybrid-entity model, OCR and QR/geofence attendance. Those sections are labelled **[UNVERIFIED – background knowledge]** and need confirmation before anyone relies on them. Vendor claims are labelled as vendor marketing. None of this is legal advice. Agency counsel and the state records authority should confirm anything jurisdiction-specific.

Confidence tags: **[V]** confirmed by a primary or official source in the search results · **[S]** secondary source only (vendor, trade press, or a state or county document used as an example) · **[U]** unverified or inferred.

---

## A. Forms builder, signature capture and digital signatures

### A1. Legal validity of electronic signatures (US)

**ESIGN Act (15 U.S.C. §7001 et seq.)**
- **[V]** A signature, contract or record may not be denied legal effect solely because it is electronic. Where a law requires information to be given to a *consumer* in writing, electronic delivery satisfies that requirement only if the consumer affirmatively consents. Before consenting, the consumer must be told the hardware and software needed, and must show electronically that they can open the format being used. Consent can be withdrawn. If a hardware or software change creates a material risk that the consumer can no longer access the records, the provider must give notice and get consent again. Sources: https://www.law.cornell.edu/uscode/15/7001.html, https://www.govinfo.gov/content/pkg/USCODE-2024-title15/html/USCODE-2024-title15-chap96-subchapI-sec7001.htm, FDIC summary https://www.fdic.gov/regulations/compliance/manual/10/x-3.1.pdf
- **[V]** Retention (§7001(d)): when a law requires a record to be retained, an electronic record satisfies it only if it *accurately reflects* the information and *remains accessible* to everyone entitled to it, in a form that can be accurately reproduced.
- **[V]** Exclusions (§7003): court orders and notices, official court documents, utility shutoff notices, default/foreclosure/eviction notices on a primary residence, cancellation of health or life insurance, product recall notices, documents required to accompany hazardous materials, and wills, codicils and testamentary trusts. https://uscode.house.gov/us/usc/119-120/t15/s7003/ , NTIA review https://www.ntia.gov/report/2003/electronic-signatures-review-exceptions-electronic-signatures-global-and-national
- **[S]** Depending on the state, some documents may still need a wet signature: DNR orders, powers of attorney and health care proxies (Adobe/LegalZoom summaries: https://help.legalzoom.com/docs/documents-where-an-electronic-signature-is-not-valid). This matters for EMS, because DNR/POLST forms are usually *viewed* by crews, not signed by them.

**UETA (adopted by 49 states plus DC/territories; New York uses its own statute, ESRA)**
- **[V]** §9 Attribution: an electronic signature is attributable to a person "if it was the act of the person." That act "may be shown in any manner, including a showing of the efficacy of any security procedure applied." Its effect is "determined from the context and surrounding circumstances at the time of its creation, execution, or adoption." Examples: MA c.110G §9 https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXV/Chapter110G/Section9 ; MN 325L.09 https://www.revisor.mn.gov/statutes/2007/cite/325L.09
- **[V]** §18 (government agencies): each state governmental agency decides whether, and to what extent, it will send and accept electronic records and signatures, and it may specify format, signing method and security requirements. The act does not require an agency to accept them. In some states a central body decides, for example Tennessee's Information Systems Council or New Hampshire's DoIT. MN 325L.18 https://www.revisor.mn.gov/statutes/2006/cite/325L.18 ; NH RSA 294-E:18 https://gc.nh.gov/rsa/html/XXVII/294-E/294-E-18.htm ; TN CTAS https://ctas.tennessee.edu/node/1208/printable/print
  - **Implication:** most SomaOS customers are government agencies, so their own city, county or state IT policy may set the rules for e-signatures on internal records. SomaOS needs signing methods that each tenant can configure.
- **[S]** UETA exclusions vary by state. Some states added family law documents, court orders and utility or insurance cancellations (Wikipedia/UETA summaries).

**Four elements an e-signature system should evidence** (the legal elements come from ESIGN/UETA; the "audit trail" framing is practitioner guidance):
1. **Intent to sign.** The user takes a deliberate signing action, such as "I agree" text beside the signature.
2. **Consent to do business electronically.** This is legally required only for *consumer* disclosures under ESIGN. It applies to patient refusals, ride-along waivers and public-facing forms, not to most internal employee forms. **[V for the consumer rule; U for how it maps onto employee forms]**
3. **Attribution.** Authenticated identity: SSO/MFA, PIN re-entry, device, IP address and timestamp. Under UETA §9, the "efficacy of any security procedure" is how attribution is proven.
4. **Record integrity and retention.** The record must "accurately reflect" the original and stay accessible (§7001(d)).
- **[S]** Admissibility: FRE 901 requires only evidence "sufficient to support a finding that the item is what the proponent claims." Doubts about strength go to *weight*, not admissibility. A detailed audit trail (signed record, certificate, signature image, timestamp, IP address) strengthens weight. Fenwick: https://fenwick.com/insights/publications/using-e-signatures-in-court-the-value-of-an-audit-trail ; DocuSign: https://docusign.com/blog/are-electronic-signatures-admissible-in-court ; Dropbox Sign audit trail: https://sign.dropbox.com/blog/electronic-signature-audit-trail ; OneSpan white paper: https://www.onespan.com/sites/default/files/2018-10/OneSpan-WhitePaper-LT-E-Sign-Not-Enough-08282018.pdf
- **[U]** These search results did not discuss hashing of document content. It is standard practice (an SHA-256 hash of the canonical record plus the rendered PDF, sealed with a platform key) and is the main way to show nothing was altered after signing.

### A2. Drawn signature capture vs. cryptographic digital signatures

| | Drawn or typed e-signature ("signature capture") | Cryptographic digital signature (PKI) |
|---|---|---|
| What it is | Image or vector of a handwritten stroke, typed name, or click-to-sign, plus an audit trail | Hash of the document signed with a private key bound to an X.509 certificate |
| Legal basis (US) | ESIGN/UETA. Valid if intent, attribution and integrity can be shown | Also valid under ESIGN/UETA, and provides tamper evidence *inside* the file |
| Tamper evidence | None on its own. Depends on platform logs and hashes | Built in. Any change to the bytes invalidates the signature |
| Long-term verification | Depends on the platform's audit database surviving | PAdES-LTV/LTA embeds OCSP/CRL data and timestamps so the signature can be verified decades later |

- **[V]** PAdES (ETSI TS 102 778, now EN 319 142) defines how PDFs are signed. Part 4 (LTV) specifies how to embed validation information and protect the document with timestamps: https://www.etsi.org/deliver/etsi_TS/102700_102799/10277804/01.01.02_60/ts_10277804v010102p.pdf
- **[S]** Certificates expire or are revoked, so without LTV a signature can later fail validation. LTV data is best added at signing time. Data added later only proves the signature was valid at some later point. Entrust: https://www.entrust.com/resources/learn/what-is-long-term-validation ; PDF Association: https://pdfa.org/long-term-validation-of-signatures/
- **[S]** EU eIDAS qualified signatures must use PAdES with LTV or LTA profiles (Entrust). This applies only to non-US customers.
- **[V]** DEA electronic records (21 CFR Part 1311, EPCS) require FIPS 186-compliant digital signatures, records migrated together with their signatures, an internal audit trail with defined auditable events, and 2-year retention of archived signed records. The eCFR cites FIPS 186-2 in §1311.55 and FIPS 186-3 in §1311.210, so check the current text. https://www.ecfr.gov/current/title-21/chapter-II/part-1311/subpart-B/section-1311.55 , https://www.law.cornell.edu/cfr/text/21/1311.305 . **[U]** It is not established that Part 1311 applies to EMS controlled-substance *administration or waste logs*, as opposed to prescriptions. See A4.

**Recommended SomaOS approach [inference]:**
1. Use drawn, typed or click signatures with strong attribution (SSO session, PIN or biometric step-up on the device) plus a server-side audit event (user ID, device ID, IP address, geolocation if permitted, timestamps, form version, SHA-256 of the canonical JSON submission).
2. On finalization, render a PDF/A and apply a **platform document seal**: a PAdES-B-LT signature using an organization certificate held in an HSM/KMS, plus an RFC 3161 timestamp. This makes every exported PDF tamper-evident without issuing personal certificates to every firefighter.
3. Add an optional per-user PKI tier for agencies that require it, such as state DoD/PIV-style environments.
4. Make signature policy configurable per form template (signature type, step-up authentication, witness required, countersign order).

### A3. Dynamic form builder patterns

**Required capabilities** (drawn from the fire/EMS form list below and industry practice; **[U]** as a feature list, not taken from a single source):
- **Field types:** text, number, date/time, select, multi-select, radio, checkbox, signature, initials, photo/file attachment, GPS location, barcode/QR scan (asset tags, drug box seals), personnel picker, apparatus/station picker, incident lookup, body diagram (injury and exposure location), rich text, rating grids, table/matrix, and computed/read-only fields.
- **Logic:** conditional show/hide/require, validation rules, calculations (for example hours, dosages and totals), repeating sections (witnesses, involved vehicles, drugs wasted), and prefill from master data (roster, apparatus, incident).
- **Workflow:** multi-step routing (submitter → officer → battalion chief → safety officer/HR), parallel approvals, return-for-correction, SLA timers, notifications, and witness or countersign steps.
- **Versioning:** template versions are immutable once published. Each submission is pinned to its template version, and migrations are explicit. A submission must always render against the version it was filled on (this is the "accurately reflects" requirement).
- **Offline mobile fill:** local draft storage, queued sync, conflict handling, and signature capture offline with the server sealing the record at sync. The audit trail must record both device time and server time.
- **Output:** PDF rendering (pixel-faithful mapping to official forms such as OSHA 301), CSV/JSON exports, and an API.

**Open-source engines:**

| Engine | License | Notes |
|---|---|---|
| Form.io formio.js (builder + renderer) | **MIT** [S] | Server ("formio") is **OSL-3.0** (copyleft, since a March 2020 change). PDF import/export and some advanced modules are Enterprise-only. Check the LICENSE files. https://github.com/formio/formio , https://www.github.com/formio/formio.js/blob/4.19.x/LICENSE.txt , https://choosealicense.com/licenses/osl-3.0 |
| SurveyJS Form Library | **MIT** [V] | The **Survey Creator** (drag-drop builder), PDF Generator and Dashboard need a **commercial per-developer license**. Licensees may not redistribute them as part of another product or library. Pricing figures vary ($2,359 on the official page versus a reseller listing), so confirm with the vendor. https://surveyjs.io/Licenses |
| JSON Forms (EclipseSource) | **MIT** [S] | JSON Schema + UI Schema; React, Angular and Vue renderers. https://cdn.jsdelivr.net/npm/@jsonforms/react@3.8.0/README.md |
| react-jsonschema-form (rjsf) | **Apache-2.0** [S, from forks and mirrors; confirm the rjsf-team LICENSE] | JSON Schema driven; no visual builder. |

**Recommendation [inference]:** own the form *definition schema* (a JSON Schema superset with logic, workflow and PDF-mapping extensions) instead of locking into one vendor's format. A permissive renderer (JSON Forms, rjsf or the SurveyJS library) works under MIT/Apache. The visual builder is the main build-vs-license decision: SurveyJS Creator's redistribution clause may conflict with a multi-tenant SaaS builder exposed to customers, so get a vendor ruling. Avoid embedding the OSL-3.0 Form.io server unless you accept its copyleft terms.

### A4. Common fire/EMS forms and the regulatory hooks

| Form | Regulatory driver | Notes |
|---|---|---|
| **Infectious disease exposure report** | **Ryan White HIV/AIDS Treatment Extension Act of 2009, Part G** (42 U.S.C. §300ff-131 et seq.) [V]: medical facilities notify the agency **Designated Officer** "as soon as practicable, but not later than 48 hours" after determining a transported victim had a listed airborne or aerosolized disease. Employees can also start a request themselves. NIOSH maintains the disease list. https://www.cdc.gov/niosh/ryan-white/php/notification-process/index.html , https://www.federalregister.gov/documents/2011/11/02/2011-28234/... | Needs a *Designated Officer* role, a confidential workflow, and links to OSHA BBP and 1910.1020 records. |
| **Bloodborne pathogen exposure / sharps injury log** | **29 CFR 1910.1030(h)(5)** [V]: a sharps injury log for employers who keep 1904 logs. It records the device, the department or work area, and how the incident happened, and must protect the injured employee's confidentiality. It is kept for the 1904.33 period (5 years). https://www.osha.gov/laws-regs/interlinking/standards/1910.1030(h)(5)/all | Exposure *medical* records fall under 1910.1020 (employment plus 30 years). |
| **Injury/illness (OSHA 300, 300A, 301)** | **29 CFR 1904.33** [V]: 300 Log, privacy case list, 300A and 301 kept 5 years after the end of the calendar year. The 300 Log must be updated during retention. https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1904/subpart-D/section-1904.33 . Public-sector employees are covered only in **State Plan states**, which may be stricter [V]: OSHA CPL 2-00-135 https://www.osha.gov/enforcement%2Fdirectives%2Fcpl-02-00-135 | Privacy-concern cases (1904.29) need a name-masked log plus a separate confidential list. Jems: https://www.jems.com/exclusives/hipaa-osha-reporting-public-sector-emergency-services/ |
| **Vehicle accident report** | State DMV, risk pool and insurer forms [U] | Photos, diagram, repeating parties and witnesses, link to apparatus record. |
| **Apparatus/equipment checks, SCBA** | NFPA 1910/1911 (apparatus), NFPA 1852 (SCBA) [U; not searched] | High frequency, offline, barcode or QR driven; defects create work orders. |
| **Inspections (fire prevention)** | Local fire code [U] | Likely belongs in a separate inspections module, but the same form engine can be reused. |
| **Incident commander worksheets / tactical worksheets** | NIMS/ICS [U] | Needs real-time, timer-driven entry. Probably a specialized UI rather than a generic form. |
| **Patient refusal / AMA** | Local EMS agency (LEMSA) policy [S]: capacity assessment, risks explained, patient or representative signature, witness (family, crew or police), and documentation of a refusal to sign. Some policies explicitly accept an "electronic equivalent." San Diego S-412 https://www.sandiegocounty.gov/content/dam/sdc/ems/Policies_Protocols/2025/400/CoSD%20EMS%20S-412%202025.pdf ; SF EMSA 4040 https://media.api.sf.gov/documents/EMSA-Policy-4040-Procedures-Documentation-Non-Transported-Patients-Final-4-1-26.pdf ; Sacramento PP-2101 https://dhs.saccounty.gov/PUB/EMS/Documents/PoliciesProceduresProtocols/2000/2101.20-Patient%20Initiated%20Refusal%20of%20Service%20and-or%20Transport.pdf | This is normally part of the **ePCR**. If SomaOS has no ePCR, integrate with one instead of duplicating it. A patient is a "consumer," so ESIGN consent rules may apply to electronic *delivery* of disclosures [U]. |
| **Controlled substance administration/waste** | **DEA final rule, 91 FR 5216 (Feb 5, 2026), effective Mar 9, 2026** [V]. It implements PPAEMA: EMS agencies not owned or operated by a hospital need DEA registration (a new registrant category, $888 for three years). Each location in a state needs its own registration. The rule also covers standing/verbal orders, storage and recordkeeping. https://www.federalregister.gov/documents/2026/02/05/2026-02288/registering-emergency-medical-services-agencies-under-the-protecting-patient-access-to-emergency ; IAFC https://www.iafc.org/blogs/blog/iafc/2026/02/20/ppaema-is-official-what-dea-s-final-rule-means-for-fire-based-ems . State examples [S]: Iowa requires signatures or unique identifiers of both the waster and the witness, plus drug, strength, quantity, date and manner (IAC 481-555.7 https://www.legis.iowa.gov/docs/iac/rule/08-20-2025.481.555.7.pdf ). The witness cannot be the waster (ICEMA). Records are kept 2 years (Missouri BNDD https://health.mo.gov/safety/bndd/pdf/emsguidelines.pdf ). | **[U]** I did not read the rule's exact recordkeeping text. Read the FR document before designing this. Need a dual-signature workflow, an immutable ledger and inventory reconciliation. |
| **Ride-along / observer waivers** | Contract law plus ESIGN consumer consent (the signer is a member of the public) [U] | Needs a public link or kiosk signing, identity capture, minor or guardian handling, and ESIGN consent screens. |
| **HR forms** (leave, PPE issue, policy acknowledgments, evaluations) | Employer policy and state law [U] | Personnel records are often exempt from public records requests, so they need access-restricted folders. |

---

## B. Document storage and management

### B1. Retention

**Federal floors (OSHA):**
- **[V]** **29 CFR 1910.1020(d)**: employee **exposure records are kept 30 years**. **Medical records** are kept for the **duration of employment plus 30 years**. Exceptions: certain first-aid records, records of employees who worked under 1 year (if given to the employee), and some background monitoring data. OSHA interpretations: https://www.osha.gov/laws-regs/interlinking/standards/1910.1020(d)(1)/all , https://www.law.cornell.edu/cfr/text/29/1910.1020 , Seyfarth summary https://www.seyfarth.com/news-insights/employee-exposure-records-and-medical-records-avoiding-osha-citations-and-defending-against-future-workers-compensation-tort-and-ada-claims.html . (Firefighter cancer presumption laws and PFAS/smoke exposure tracking make the 30-year horizon very relevant.)
- **[V]** OSHA 300/301/300A and the sharps log: 5 years (above).
- **[S]** DEA controlled-substance records: 2 years (state guidance citing federal law; confirm against the 2026 rule).

**State and local schedules** vary widely. Examples for **EMS patient care reports** [S]:
- NY DOH: 6 years, or 3 years past the patient's 18th birthday, whichever is longer. https://Health.NY.Gov/professionals/ems/pdf/08-03.pdf
- NJ municipal fire schedule: 10 years, or until the patient turns 23. https://nj.gov/treasury/revenue/rms/pdf/m180000.pdf
- NH municipal schedule (Dover): 10 years; PDF/A allowed for electronic storage.
- Colorado municipal schedule 100: 5 years. https://archives.colorado.gov/sites/archives/files/documents/Schedule%20100.pdf
- San Jose: 7 years.
- Washington has a dedicated **Fire and Emergency Medical Records Retention Schedule** plus the CORE local-government schedule: https://www.sos.wa.gov/sites/default/files/2025-06/fire-and-emergency-medical-records-retention-schedule.PDF
- Others: Florida GS8 (fire), https://files.floridados.gov/media/706724/gs8-june-2023.pdf ; Missouri emergency services schedule, https://www.sos.mo.gov/CMSImages/LocalRecords/EmergencyServices.pdf ; Tennessee MTAS fire records, https://www.mtas.tennessee.edu/reference/fire-records ; Ohio RIMS.

**Architecture implications [inference]:**
- Retention is a **policy object** made of a record series code, trigger event (creation, separation of employment, patient age 18, incident closed), duration, and disposition action (destroy, transfer to archives, review). Tenants load their **state schedule** from a library that SomaOS curates, then apply local overrides.
- Every document and form submission carries a record series. "Employment + 30 years" requires an *event-based trigger* tied to HR separation dates, not just creation date.
- Disposition must be **certifiable**: a destruction log with approver, date, series and count, because most state schedules require it. **[U; common in state schedules but not quoted here]**
- PDF/A is the safe long-term rendition format (explicitly referenced in the NH schedule).
- Storage must be WORM/immutable (for example S3 Object Lock in governance or compliance mode), with **legal hold** overriding disposition.

### B2. Legal hold **[UNVERIFIED – background knowledge; search budget exhausted]**
- Under US civil procedure (FRCP 37(e) for ESI, and state equivalents), the duty to preserve starts when litigation is reasonably anticipated. A hold must suspend scheduled destruction for the relevant records and custodians. Needed features: hold objects (matter, custodians, date range, record series, query), automatic suspension of disposition, notices to custodians with acknowledgment, and release workflow plus audit.

### B3. Public records / FOIA **[UNVERIFIED – background knowledge]**
- Local fire and EMS agencies are subject to **state** public records acts. Federal FOIA applies only to federal agencies. Exemptions vary by state and commonly include patient medical information (also protected by HIPAA where the agency is a covered entity), personnel and medical files, security-sensitive pre-plans and critical infrastructure, and active investigations.
- Fire departments that bill for EMS are typically HIPAA covered entities, often structured as **hybrid entities**. Employment records held as employer are excluded from the PHI definition. Exposure and medical records still need confidentiality under OSHA 1910.1020/1030.
- Needed features: a records-request intake and tracking log with statutory deadlines, a search across modules, **redaction** tooling (PDF redaction that actually removes content, not overlays), an export package with an index, and an audit of what was released.

### B4. Folder/permission model, versioning, search, OCR, attestation [inference + U]
- **Permissions:** RBAC (rank/role) plus ABAC (station, shift, division, certification level) plus explicit sensitivity labels (Medical-Confidential, HR, CJIS-adjacent, Public). Folder inheritance with break-inheritance overrides. Never rely on folder ACLs alone for PHI or medical data; use record-level labels.
- **Versioning:** immutable versions, major/minor numbering, check-out/check-in or draft/publish, and diffs for text documents (key for SOGs).
- **Full-text search plus OCR:** OCR scanned PDFs and images on ingest (Tesseract, or cloud OCR such as AWS Textract or Google Document AI). Index permission-aware, so search results are filtered by ACL at query time. Content containing PHI must stay in HIPAA-eligible services under a BAA.
- **Read acknowledgment / attestation:** assignment (to roles, stations or individuals), due dates, reminders, an "I have read and understand" e-signature event tied to a *specific document version*, optional quiz, and escalation reports. Re-attestation is triggered when a new major version is published. PowerDMS and Lexipol implement this pattern (see D1).

---

## C. Training suite

### C1. Content standards
- **[S]** **SCORM** (1.2/2004) packages content and defines launch and a fixed data model. Any SCORM-conformant LMS plays any SCORM package. Its last release was in 2009. **xAPI** is a tracking/statement spec sent to a Learning Record Store (LRS); it does not define launch or course structure. **cmi5** is an xAPI profile that adds SCORM-like launch, AU hierarchy and completion rules, but it **requires an LRS** and fewer authoring tools support it. ADL: https://adlnet.gov/news/2016/01/08/cmi5-and-the-xapi-scorm-profile ; Rustici comparison: https://xapi.com/cmi5/comparison-of-scorm-xapi-and-cmi5/ ; cmi5 spec: https://aicc.github.io/CMI-5_Spec_Current/SCORM
- **Implication:** support SCORM 1.2/2004 import (most existing fire and EMS courseware), embed an xAPI LRS (it also captures drills, simulations and VR from other systems), and add cmi5 as a later phase. Running SCORM through an existing engine (Rustici SCORM Engine is commercial; open-source options such as scorm-again exist **[U]**) is faster than building one.

### C2. EMS CE: NREMT NCCP
- **[S, several state documents]** Paramedic recertification requires **60 hours: 30 National / 15 Local-State / 15 Individual** over a 2-year cycle. WA DOH https://www.doh.wa.gov/sites/default/files/legacy/Documents/Pubs/530206.pdf ; WV https://dhhr.wv.gov/oems/about/Documents/certification%20pathways-8%20new%20policy%20from%20nremt%207.9.20.pdf ; NREMT paramedic page https://nremt.org/paramedic/recertification (could not fetch).
- **[S]** **There is no longer a distributive education (DE) limit** for NREMT recertification. WA DOH says "as of 2022, there are no distributive education (DE) limits," and Massachusetts says the same: https://www.mass.gov/doc/emt-paramedic-recertification-instructions/download . The older one-third/two-thirds/full fractional caps are outdated. **States may still impose their own limits**, so the rule engine must be per-state.
- **[S]** A **2025 NCCP model** took effect **April 1, 2025** for EMT, AEMT and Paramedic. Hour totals and component splits may have changed under it. Virginia implementation notes: https://www.vdh.virginia.gov/emergency-medical-services/education-certification/educator-resources/continuing-education-program-guidance/implementation-of-the-national-continued-competency-program-nccp-in-virginia/ ; UMBC NCCP memo https://edhs.umbc.edu/wp-content/uploads/sites/104/2026/03/NCCP_Explanation_Memo.pdf ; Utah guide https://ems.utah.gov/wp-content/uploads/sites/34/2023/03/NREMT-Recertification-Guide-v4.pdf . **[U]** I could not verify the exact 2025 EMT/AEMT hour splits or topic hours. Get these from nremt.org before modelling them.
- **[S]** NCCP national-component hours map to **topic domains**: Airway/Respiration/Ventilation, Cardiovascular, Trauma, Medical, Operations. When a CAPCE course is imported, NREMT auto-assigns its NCCP domains. https://nremt.org/News/new-web-tool-capce
- **[S]** NREMT does not accept course cards as proof; a completion certificate is required. https://nremt.org/getmedia/eb36a456-bc96-4908-bb6f-0ec3b436bcbe/82-07-Accepted-Education-Documentation-Policy.pdf

**Implication:** model CE as `credit_entry {hours, component(national|local|individual), nccp_topic, capce_course_id?, delivery_format(F1/F2/F3/F5), state_approval_ids[], evidence}`. Requirement profiles (NREMT 2025 Paramedic, a state paramedic, ACLS, and so on) are versioned rule sets evaluated against those entries, producing a gap analysis per member.

### C3. CAPCE accreditation
- **[V/S]** CAPCE (formerly CECBEMS) accredits EMS CE. Manuals are at capce.org: 2025 Combined Accreditation Manual https://capce.org/docs/ManualVersions/2025/CAPCE_Combined_Accreditation_Manual.pdf ; Organizational manual https://capce.org/docs/ManualVersions/2025/CAPCE_Organizational_Accreditation_Manual.pdf ; Combined Application Manual https://capce.org/docs/ManualVersions/2025/2025CombinedApplicationManual_05_21_2025.pdf
- **[S]** Course formats: **F1** live in-person, **F2** (live/blended; I could not confirm the exact definition), **F3 = distributive, self-paced online (asynchronous)**, **F5 = Virtual Instructor-Led Training (VILT)**, meaning real-time interaction while geographically separated. NREMT treats F1, F2 and F5 as instructor-based and **F3 as distributive**. Ref: https://www.nremt.org/Document/Frequently-Asked-Questions , https://www.emtfiretraining.com/amember4/page/capce_codes
- **[S]** Provider requirements, from summaries of the manuals: a **physician medical director**, a program committee that reviews and approves activities, medically accurate and referenced content, **post-tests**, evaluations, **attendance verification**, record keeping, and **reporting completions to CAPCE's Accreditation Management System (AMS)**, which feeds NREMT. Providers submit through **XML upload or real-time reporting**. https://www.hmpgloballearningnetwork.com/site/emsworld/company/capce-commission-accreditation-pre-hospital-continuing-education , https://emt-ce.com/info/accreditation , https://nremt.org/News/new-web-tool-capce
- **[U]** CAPCE's record-retention period, F3 seat-time validation rules (for example minimum time-on-page or anti-skip) and the AMS API/XML schema were not retrievable. Get them from the CAPCE manuals or by contacting CAPCE.
- **What this means for SomaOS:** the *platform* is not accredited; *course providers* are. A department can become a CAPCE **Organizational** accredited provider (CAPCE has an organizational track; ASM Road Guardians is an example: https://roadguardians.org/asm-road-guardians-achieves-capce-organizational-accreditation-through-capce/ ). To support customers who are providers, SomaOS should store medical director approval per course, learning objectives, post-test with pass threshold, course evaluation, verified attendance (live/VILT) or completion (F3), and NREMT ID per learner. It also needs **CAPCE AMS reporting** (XML export first, real-time API later if CAPCE provides one).
- A vendor example of the end-to-end flow: Prodigy EMS says completions of its CAPCE-accredited classes are sent to CAPCE and NREMT, and it offers both F5 live and F3 on-demand formats. https://www.prodigyems.com/features (vendor marketing)

### C4. Fire training records: NFPA 1401, ISO PPC, task books, Pro Board
- **[S]** **NFPA 1401** (*Recommended Practice for Fire Service Training Reports and Records*) is a separate document. A 2026 edition is listed at ANSI (https://webstore.ansi.org/standards/nfpa/nfpa14012026); the 2017 edition shows as superseded 2025-12-23. Its content covers training schedules, reports, records, state certification records, computerization of records, and the legal aspects of recordkeeping. **The 2026 NFPA 1400 consolidated 1402, 1403 and 1404, not 1401** [S]. NFPA 1400 2025 cycle docs: https://docinfofiles.nfpa.org/files/AboutTheCodes/1400/1400_CustF2025_FIY_AAA_FD_FRreport.pdf ; Emergency Reporting on 1401-compliant records: https://emergencyreporting.com/blog/how-to-build-nfpa-1401-compliant-training-records . **[U]** I did not read the 1401 text, which is paywalled.
- **[S, figures vary by source]** **ISO Fire Suppression Rating Schedule (FSRS) training credit:**
  - Company training: **16 hrs per member per month (192 per year)**
  - Training facility: **18 hrs per year per member**
  - Officers: **12 hrs per year**
  - New drivers/operators: **60 hrs**; existing drivers/operators: **12 hrs per year**
  - Hazmat: **6 hrs per year**
  - Also recruit training and pre-fire planning
  - Sources: ISO Mitigation https://isomitigation.com/ppc/technical/training ; Vector Solutions ISO tracker https://www.vectorsolutions.com/resources/blogs/iso-training-starter-kit-built-to-meet-iso-standards/ ; CT State Fire Administrator https://portal.ct.gov/CFPC/_old/State-Fire-Administrator/General/ISOs-Fire-Suppression-Rating-Schedule-Reinvented-and-Revised . Confirm against the current FSRS before hard-coding. The rule engine must categorize every training session into ISO buckets (company, facility, officer, driver, hazmat, recruit, pre-plan) and require facility/location metadata.
- **[S]** **Task books (NFPA 1001 FF I/II, NFPA 1021 Fire Officer, NFPA 1002 driver/operator):** these are JPR-by-JPR sign-offs by qualified evaluators, approved by the Agency Head or Training Officer. **Pennsylvania's Fire Officer II candidate handbook explicitly rejects digital signatures and requires wet ink.** https://www.pa.gov/content/dam/copapwp-pagov/en/osfc/documents/certification-document-library/fire%20officer%20ii%20candidate%20handbook1.pdf . Digital task books therefore need a **printable, JPR-labelled export** for wet-ink jurisdictions. Utah form-field version: https://www.uvu.edu/ufra/docs/certification/standards/fire_officer_jan2026c_formfields.pdf
- **[S]** **Pro Board** (National Board on Fire Service Professional Qualifications) accredits *certifying entities* (state fire academies) and runs a public certification registry. It does not appear to set rules for local LMS platforms. https://www.dhses.ny.gov/national-certifications . **[U]** No evidence found of a Pro Board data interface.
- **[S]** **EMS FTO / field training (paramedic precepting):** phased programs (orientation → observation → instruction → evaluation/indirect precepting) with **Daily Observation Reports (DORs)** scored against standardized evaluation guidelines. The FTO coordinator and medical director sign off before release. National framework: **NEMSMA EMS-FTEP**. https://www.jems.com/training/nemsma-recommends-ftep-ems/ ; WI DHS https://dhs.wisconsin.gov/publications/p03058.pdf ; Orange County NC FTEP policy https://www.orangecountync.gov/DocumentCenter/View/8544/EMS-FTEP-Policy-PDF ; SLO County 343 https://slocounty.ca.gov/departments/health-agency/public-health/emergency-medical-services/emergency-medical-services-agency/forms-documents/policies,-procedures,-and-protocols-(includes-form/340-349-paramedic/343-field-training-officer-program-4-1-2024

**Architecture implications:** one **"Competency Program" engine** can cover fire task books, FTO/FTEP, probationary programs and officer development. It needs: phases, competencies/JPRs, required evidence (observed, performed N times, quiz), evaluator qualification rules (who may sign), DOR-style daily scoring with a rating scale, remediation loops, final multi-party sign-off, and a print/export path for wet-ink jurisdictions.

### C5. Drills, in-house training and attendance
- **[U – not searched]** QR-code sign-in (rotating or time-limited code shown by the instructor), optional geofence check (location within X meters of the training site, with an offline-tolerant fallback), instructor attestation, roster bulk-add for company drills, and roll-up of hours into ISO, NFPA 1401, NCCP local, and state categories. Anti-fraud: one-time tokens, device binding, instructor approval of the roster.
- Instructor management: instructor qualifications (Fire Instructor I/II per NFPA 1041, EMS instructor/coordinator), expiry tracking, assignment to sessions, and evaluation of instructors.

### C6. Competitors

| Product | Positioning | Praise | Complaints / gaps |
|---|---|---|---|
| **Vector Solutions (formerly TargetSolutions; also owns CentreLearn and CrewSense scheduling)** | Market-leading fire/EMS LMS with a large NFPA-based course library (marketed as "450+ hours"), ISO training tracker, digital task books, CAPCE EMS CE. https://www.vectorsolutions.com/solutions/vector-lms/fire/fire-department-training-records-software/ | G2 4.5 average (only 12 reviews); "easy to run reports." | Capterra/Software Advice reviews (many from non-fire verticals): **outdated videos**, rewatching the **same annual video**, "had to start over 3 times," cumbersome training plan editing, CEUs not kept current with state boards, and one 1-star "Vector Headaches" review. https://www.capterra.com/p/178441/School-Safety-and-Compliance-Training/reviews/ ; https://www.softwareadvice.com/product/461895-School-Safety-and-Compliance-Training/reviews/ . Firehouse notes online courses are often used to "check boxes." https://www.firehouse.com/tech-comm/learning-management-systems/blog/12174856/supplementing-handson-firefighter-training-with-targetsolutions-firehouse |
| **CentreLearn** | EMS/fire online training; course builder. **Acquired by Vector Solutions in 2014.** https://www.vectorsolutions.com/about-us/acquisitions/centrelearn/ | Custom course builder (Mid Georgia Ambulance case study) | No independent reviews found |
| **Relias** | Healthcare-centric LMS (Bertelsmann subsidiary) with a public-safety offering. **Not related to CentreLearn** (the brief's "Relias/CentreLearn" pairing appears mistaken). https://www.relias.com/industry/public-safety | n/a | Fire-specific content not verified |
| **First Due** (Training module + newer **First Due LMS**) | Training records inside a full fire RMS suite; LMS handles course delivery, cert tracking, ISO and CAPCE compliance; ATS video partnership. https://www.firstdue.com/products/training , https://www.firstdue.com/news/first-due-lms-transforming-training-management-for-fire-ems-agencies | Capterra 58 reviews, 93% positive; G2 4.5 average (44 reviews). Integrated suite. | Slow support tickets, a rollout rated 1/5 by one reviewer, cross-module consistency "still in progress," long setup, rising price. https://www.capterra.com/p/179338/First-Due/reviews/ |
| **ESO** (Fire RMS, Scheduling, plus a **partnership resale of EMS1 & FireRescue1 Academy**) | ESO offers training management in RMS and resells Lexipol academy content. https://www.eso.com/ems/academy/ | n/a | Detail not found |
| **FireRescue1 Academy / EMS1 Academy (Lexipol)** | 900+ courses combined; FF I/II, Officer, Pump Ops; **EMS courses CAPCE-accredited**; assignment by individual, shift or station; external training entry. https://www.lexipol.com/wp-content/uploads/2025/09/FireRescue1_Academy___Course_Catalog.pdf | n/a | Independent reviews not found |
| **Prodigy EMS** | CAPCE-accredited EMS CE; F5 live plus F3 on-demand; reports completions to CAPCE/NREMT; department training plans; ~$140/yr individual plan (vendor). https://www.prodigyems.com/features , https://www.prodigyems.com/pricing | Real patient-encounter video (ReelDX) | Fire content via ATS partnership per vendor; a competitor says EMS-only (conflicting) |
| **24-7 EMS (HSI)** | Video-based EMS CE, 100+ topics, agency admin (scheduling, tracking, testing), CAPCE-accredited VILT. https://24-7ems.hsi.com | n/a | Vendor claims only |
| **PowerDMS (now with PowerReady/PowerRecall)** | Policy plus training documentation: FTO/probationary (PowerReady) and spaced-repetition reinforcement (PowerRecall). https://www.powerdms.com/why-powerdms/fire-home | n/a | n/a |
| **Acadis Readiness Suite (Vector)** | Skill sheets, task books, succession progress; also used by state academies. | n/a | n/a |
| **"Crew Scores"** | **Not found.** The closest match is "CrewSense" (Vector scheduling). Possibly a misremembered name; ask the requester. | | |

**Differentiation opportunities [inference]:** (1) a single competency engine that unifies FTO, task books and CE rules across NREMT, state and ISO; (2) high-quality offline mobile drill logging with QR sign-in, instead of "click-through videos"; (3) policy, training and quiz linkage (see D); (4) honest import/export of CAPCE and NREMT data.

---

## D. SOGs/SOPs and medical protocol management

### D1. Policy management prior art
- **[S]** **Lexipol (Fire)** sells state-specific policy manuals vetted by fire service professionals and public safety attorneys, updated in response to legislation, case law and best practice. Delivery is through **Daily Training Bulletins (DTBs)**: short scenario-based lessons with a test question that prompt review of a newly published policy. Completing one counts as acknowledgment, with an optional quiz. Acknowledgment and training reporting are included. Content is **copyright-licensed** to the agency and cannot be sold. One-sheet: https://www.lexipol.com/wp-content/uploads/2024/05/Lexipol___Fire_Policies___One_Sheet.pdf ; Greenwood IN rollout: https://www.greenwood.in.gov/egov/documents/1631551761_03528.pdf ; Terms: https://jsis.washington.edu/wordpress/wp-content/uploads/sites/22/2024/07/Lexipol-Agreement-Terms-and-Conditions.pdf . Lexipol merged with FireRescue1 (https://www.fireengineering.com/firefighting/lexipol-fr1/).
  - **Implication:** SomaOS will often co-exist with Lexipol content. Customers may need to **import Lexipol manuals** (licensing permitting) or link to them. The *content-subscription-with-upstream-updates* model (vendor master → agency fork with local edits → merge upstream changes) is the same inheritance problem as state→region→agency protocols. Build it once.
- **[S]** **PowerDMS** offers a single published version per SOP, version control, approval workflows, automated reviews, acknowledgment tracking and attestation. https://www.powerdms.com/policy-learning-center/policy-procedure-management-fire ; https://slashdot.org/software/p/PowerDMS/

**Required feature set [inference from the above]:** document lifecycle (Draft → Review → Approved → Published → Superseded/Archived); a configurable approval chain (author → training/safety → chief, and for medical documents → medical director); review cycle (for example annual) with owner reminders; redline/diff between versions; required read-and-sign per version (assigned by role, station or rank) with due dates and escalation; linked quiz/DTB; links to training courses and competencies; an effective date distinct from the publish date; and a public portal option (some agencies publish SOGs).

### D2. Medical protocols
- **[S] Hierarchy varies by state.** Examples:
  - **WA:** state BLS/ILS guidance is a foundation that county MPDs modify within scope. https://doh.wa.gov/sites/default/files/2024-08/530-281-BLS-ILSProtocolGuidance.pdf
  - **NV:** state protocols are a standard agencies may adopt or adapt. https://www.dpbh.nv.gov/contentassets/ce0f830281ac4916bb3f23d561887bab/protocols-nv-ems-2-10-2026.pdf
  - **OK:** agency special protocols require state EMS Division approval.
  - **CT:** sponsor hospitals petition for changes.
  - **KY:** statewide protocols by state medical advisor. https://kbems.ky.gov/Medical-Direction/Documents/KY_State_Protocols_2025_1.162.25.pdf
  - **ME:** statewide protocols on a 2-year cycle, plus regional medical directors. https://www.maine.gov/ems/protocols-resources/pre-hospital-care-protocols
  - **MI:** Medical Control Authority (MCA) regional protocols. https://www.michigan.gov/documents/mdhhs/2017_MCA_Handbook_FINAL_579399_7.pdf
  - **TX:** delegated practice; the local medical director has broad authority (Fort Worth regional system). https://www.fortworthtexas.gov/files/assets/public/v/2/omd/documents/fw-regional-ems-system-protocol-10.1.26.v1.pdf
- **[S]** **NASEMSO National Model EMS Clinical Guidelines v3.0 (March 2022)** are a common baseline from which states build protocols. Only PDF/web versions were found, **no machine-readable format.** https://hhs.iowa.gov/media/198/download , https://asprtracie.hhs.gov/technical-resources/resource/11939/national-model-ems-clinical-guidelines
- **Protocol apps:**
  - **[S]** **Acid Remap** ("Paramedic Protocol Provider") publishes many agency- and region-branded offline protocol apps (Houston Fire, Austin-Travis County, Washtenaw/Livingston MCA, MEP Madison, and others). Some include medication-calculator integration. There was an announced pairing with Pedi STAT for pediatric dosing using agency concentrations, but it is unclear whether it shipped. https://apps.apple.com/us/app/mep-ems-guidelines-protocols/id1659507741 , https://ems1.com/pediatric-care/expanded-capabilities-bolster-popular-pediatric-care-app
  - **[S]** **OneDose (Hinckley Medical)** provides clinical decision support and dosing, and **integrates with ImageTrend Elite**. It pushes structured, NEMSIS-compliant weight, meds, doses, interventions, protocol references and timestamps into the ePCR. https://www.firehouse.com/ems/news/55375493/onedose-imagetrend-partnership-to-streamline-ems-documentation
  - **[S]** **Handtevy** is a pediatric dosing system. The Rochester/MLREMS study reported correct pediatric dosing rising from ~51% to 89.4% after adoption; the JEMS reporting contains inconsistent figures. https://www.jems.com/patient-care/rochester-ems-medication-dosing-accuracy-handtevy/ . Not all dosing-support tools reduce errors: MI-PEERS found a multi-component system did **not** improve error rates (PubMed https://pubmed.ncbi.nlm.nih.gov/41563894/ , per search summary).
  - Check The Dose is another subscription dosing guide.
  - **[U]** I found no evidence of a native ImageTrend protocol *authoring* module.
- **[S] Broselow length-based color zones:** gray 3–5 kg, pink 6–7, red 8–9, purple 10–11, yellow 12–14, white 15–18, blue 19–23, orange 24–29, green 30–36 kg (Frontiers in Pediatrics 2022, https://frontiersin.org/articles/10.3389/fped.2022.969016/full ). The zones derive from 1963–75 NCHS data. Accuracy is population-dependent: it overestimates in Indian children, underestimates in Peruvian children (62.8% within 10%), loses accuracy above ~18 kg, and in a US rural study 53% fell outside the predicted zone. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8294604/ , https://pmc.ncbi.nlm.nih.gov/articles/PMC4786497 . **Broselow is a trademarked commercial product; reproducing its exact zone/dose charts may need licensing [U].** Handtevy uses age-based dosing.
- **[S] ePCR validation linkage:** NEMSIS v3 uses **Schematron (ISO/IEC 19757-3)** rules in layers: national, then state (which may refine or add rules, for example Georgia requires its state Schematron before submission), then optional **agency-private Schematron** rules. AngelTrack notes agency rules do not apply to state uploads. NEMSIS Schematron guide https://nemsis.org/media/nemsis_v3/release-3.4.0/Schematron/documentation/NEMSIS_V3_Schematron_Guide.pdf ; Georgia https://dph.georgia.gov/media/92451/download ; Montana https://dphhs.mt.gov/assets/publichealth/EMSTS/EMS/Third_Party_ePCR_Requirements.pdf ; AngelTrack https://support.angeltrack.com/help/supervisor/CustomEMSPcrValidationRules.htm
  - **Implication:** protocol-driven ePCR checks (for example, "if 12-lead STEMI then a cath-lab alert time is required," or "max fentanyl dose by weight") can be **emitted as agency Schematron** (or an equivalent JSON rule format) from structured protocol data, which keeps protocols and documentation rules in sync.

### D3. Protocol data model and inheritance [inference]
- Store protocols as **structured content**, not just PDF: a protocol contains sections; sections hold steps or decision nodes with scope-of-practice tags (EMR/EMT/AEMT/Paramedic/CCP), **medication references** and **procedure references**.
- A **medication formulary** per agency defines drug, concentrations *actually carried*, routes, and the dose rule (mg/kg, max dose, min dose, rounding increment, volume calculation from concentration). Dosing calculators must use the **agency's carried concentrations**, as both the Pedi STAT/Acid Remap pairing and OneDose emphasize.
- **Inheritance:** State (or NASEMSO baseline) → Region/MCA/County → Agency. Overrides are applied as typed patches, such as `replace step`, `add step`, `restrict scope`, `change dose`, or `disable protocol`. Each override carries an **approval record from the medical director at the overriding level**, and higher levels may allow or prohibit specific changes. When an upstream version changes, generate a merge/conflict report for the downstream medical director to re-approve.
- **Medical director e-approval** must be a strong signature: identity-verified, ideally a PKI/sealed PDF of the approved protocol set with an effective date. State submission packages (OK, CT) need exportable redlines.
- **Offline-first mobile:** the full protocol set plus formulary is cached on device, versioned, with a forced-update or "stale" banner. Calculators must work fully offline. Every dosing output displays its source protocol version.
- **Safety and regulation [U]:** a weight-based dosing calculator may fall within FDA's clinical decision support / software-as-a-medical-device considerations. Transparency of the dosing basis (showing the rule and source protocol) matters to the CDS criteria. Get a regulatory review before shipping calculators.
- Link protocols to training: a protocol update triggers a required-read assignment, a quiz, and CE credit (local/state component), closing the loop between D, C and B.

---

## Cross-cutting architecture implications (summary)

1. **Unified records core:** every artifact (form submission, document, training record, protocol version, signature) is an immutable, versioned record with a record series, sensitivity label, retention policy and legal-hold flag, all on WORM storage.
2. **Signature service:** e-signature events (intent, attribution, step-up authentication, hashes), with PAdES platform sealing plus RFC 3161 timestamps on finalized PDFs, an optional user-PKI tier, and wet-ink print paths (PA task books).
3. **Policy-as-data engines:** (a) a retention schedule library per state; (b) CE/certification requirement rule sets (NREMT 2025 NCCP, state, ISO FSRS, NFPA); (c) a protocol inheritance and override engine. All three are versioned, tenant-overridable rule sets curated by SomaOS.
4. **One content-inheritance mechanism** (upstream master → downstream fork with typed patches and re-approval) serves state→region→agency protocols, Lexipol-style policy subscriptions, and form template libraries.
5. **Offline-first mobile** for forms, drills/attendance, and protocols/calculators, with queued sync, device and server time in the audit trail, and server-side sealing.
6. **Sensitive-data segregation:** exposure and medical records (30-year retention, OSHA confidentiality), PHI (HIPAA), and controlled-substance logs (DEA 2026 rule) need dedicated access-controlled stores and audit trails.
7. **Integrations:** CAPCE AMS (XML/real-time), NREMT (indirect via CAPCE), ePCR (NEMSIS Schematron rules export, refusal/controlled-substance data), and SCORM/xAPI LRS.

## Open questions and unverified items to resolve
- Exact NREMT **2025 NCCP** hour splits for EMT, AEMT and Paramedic (nremt.org was unreachable).
- CAPCE manual specifics: F2 definition, F3 time-validation rules, record retention, AMS XML schema/API.
- The DEA 2026 EMS rule's **exact recordkeeping and waste-witness provisions** (read 91 FR 5216 in full).
- Current ISO FSRS training-credit values (vendor figures may lag).
- State-specific e-signature acceptance for task books and certification paperwork, beyond Pennsylvania.
- Legal hold, public records/redaction and HIPAA hybrid-entity details (not researched; search budget exhausted).
- SurveyJS Creator licensing for a multi-tenant SaaS builder; Form.io OSL-3.0 implications.
- "Crew Scores" product identity.
- Broselow licensing for color-zone charts.
- FDA CDS/SaMD position on in-app dosing calculators.
