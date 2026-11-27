# Current-systems importers (stub, not scheduled)

Source research: `docs/research/06-current-systems.md` §6. This file only records what exists to import from, so a real plan can be written once admin exports are in hand. No code yet.

| Importer | Source | Input (known / needed) | Lands in |
|---|---|---|---|
| Schedule and time off history | Aladtec | Needed: admin export of schedules, positions, time-off types and history. Member-side reports exist but the format is unverified. | scheduling, leave |
| Credentials | NinthBrain | Needed: admin credential report (type, issue, expiry, number, document). Member side gives a PDF of attachments only. | credentials |
| Course catalog and completions | NinthBrain | Needed: course list (title, category, credit, status) and completion report. The predefined Calendar Attendance report exists. | training |
| Training calendar | NinthBrain | iCal subscription feed (confirmed) | training sessions (read-only sync) |
| Documents / SOGs | NinthBrain File Cabinet, Aladtec Storage | Files downloadable one at a time; folder tree in research §2.3. Titles need clean-up (residue, duplicates). | documents |
| Parts, PAR, cabinets, kits | Front Line Back Office | Needed: part master and PAR-by-cabinet export (Back Office access). | inventory |
| Payroll code map | County (CentralSquare) | Needed: full earnings and leave code list from county payroll. | pay export codes |

Open engine gaps that block a faithful import are listed in research §5.
