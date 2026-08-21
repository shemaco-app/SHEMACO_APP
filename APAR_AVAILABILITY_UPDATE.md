# APAR Availability Update

New first question in normal inspection flow:

**Apakah APAR tersedia di lokasi/unit?**

- **Ya**: the existing 10-condition checklist appears and must be completed.
- **Tidak**: the 10-condition checklist is hidden/skipped, result becomes `apar_tidak_tersedia`, and a photo is required as evidence before continuing.
- The PWA sends `apar_available` (`ya` / `tidak`) to Apps Script.
- Existing historical records without this field are treated as `ya` for backward compatibility.

## Backend update required
Replace the current Apps Script backend code with the supplied `SPARTA_MACO_Backend-apar-availability.js`, then deploy a new Web App version. The script automatically appends the new `apar_available` header to `Inspection_Logs` via the existing `ensureHeaders_()` logic.

The dashboard code does not need to be changed for the PWA to work.
