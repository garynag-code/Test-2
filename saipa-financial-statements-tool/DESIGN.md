# SAIPA Working Papers & Annual Financial Statements Tool — Design Specification

**Audience:** Accounting professionals preparing compliant working papers and annual financial statements (AFS) for South African SMMEs.
**Positioning:** A privacy-first, locally installed desktop application that drafts SAIPA-aligned working papers and AFS, keeps pace with evolving financial reporting standards, and turns an Excel trial balance into a review-ready statement set with minimal manual re-keying.

---

## 1. Purpose & Scope

The tool exists to compress the repetitive, error-prone parts of the SMME reporting cycle — mapping a trial balance, building supporting schedules, and assembling a compliant statement set — while leaving professional judgement firmly with the practitioner. It targets SMMEs reporting under **IFRS for SMEs** (and, where relevant, the simpler frameworks SMMEs may elect), producing the working-paper file and the annual financial statements as a linked, defensible package. It is a drafting and review accelerator, not an auto-signer: every output is a draft the practitioner reviews, adjusts, and approves before release. Scope covers trial-balance import and mapping, working-paper generation, statement assembly, disclosure management, and export; it deliberately excludes bookkeeping, tax return submission, and audit sign-off, integrating with those adjacent systems rather than replacing them.

## 2. Standards Compliance & Update Mechanism

Compliance is treated as versioned data, not hard-coded logic. A **Standards Engine** holds each reporting framework (IFRS for SMEs and applicable local frameworks) as a dated ruleset: the chart-of-accounts taxonomy, statement line structures, mandatory disclosures, and validation rules that flag when a required item is missing or inconsistent. Because these are data packages rather than baked-in code, a new or amended standard ships as a signed, versioned standards pack that the practitioner reviews and applies, with a plain-language changelog describing what changed and which engagements are affected. Each engagement records the exact standards-pack version used to prepare it, so a prior year can always be reproduced faithfully even after standards move on. An in-app **compliance alerts** panel surfaces pending standards updates, effective dates, and any open engagements those changes touch, so the practitioner is prompted rather than caught out. Update checks are opt-in and transparent — only version metadata is exchanged, never client data — preserving the privacy posture described below.

## 3. Local-First Installation & Data Protection

The application installs and runs entirely on the practitioner's own machine (Windows/macOS/Linux desktop), with **no client financial data leaving the device by default**. All engagement data lives in a local, encrypted store (encryption at rest with a practitioner-controlled passphrase), and the only outbound network traffic is the optional, metadata-only standards-update check. This local-first posture directly serves the confidentiality obligations practitioners carry for client information and materially reduces breach surface compared with cloud tenancy. Data protection is layered: encrypted storage, an immutable audit trail of who changed what and when, role-appropriate access if multiple staff share a workstation, and built-in **encrypted backup/restore** so a device failure never means lost work. Because the practitioner owns the datastore outright, data residency and POPIA-aligned handling are satisfied by construction rather than by a third-party processing agreement.

## 4. User Interface & Experience

The interface is a clean, modern desktop UI organised around a **dashboard** that gives one-click access to the current engagement, recent files, outstanding review points, and any compliance alerts. Navigation is intuitive and shallow: a persistent sidebar moves the practitioner through the natural workflow — Import → Map → Working Papers → Statements → Review → Export — while a global search bar jumps directly to any account, schedule, or disclosure. Working papers and statements are driven by **customisable templates** so a firm can encode its house style once and reuse it across clients, and **context-sensitive help** explains each disclosure and validation rule inline, lowering the learning curve for junior staff. Clear iconography, sensible defaults, keyboard-friendly data entry, and a consistent review-note mechanism (raise, clear, and track queries against any line) keep the experience efficient for daily professional use rather than merely attractive.

## 5. Excel Trial-Balance Import & Mapping

Import is delivered as a guided **wizard** that removes the friction of getting data in cleanly. The practitioner selects an Excel file (`.xlsx`/`.xls`); the tool detects the header row and proposes a **column mapping** (account code, account name, debit, credit or net movement, prior-year balance), which the practitioner confirms or corrects. The system then **validates** the data — checking that debits equal credits, flagging blank or duplicate account codes, and warning on unmapped or ambiguous rows — and presents a **preview** of the parsed trial balance for explicit confirmation before anything is committed. Accounts are then mapped to the Standards Engine taxonomy through an assisted mapping screen that **remembers prior mappings per client**, so a returning engagement maps in seconds and only genuinely new accounts need attention. Saved, reusable **mapping profiles** let a firm apply a consistent structure across similar clients, and the whole import is reversible until confirmed, so a mis-mapped file is corrected, not inherited.

## 6. Architecture (High Level)

A modular desktop architecture keeps compliance logic, data, and presentation cleanly separated so each can evolve independently:

- **Presentation layer** — the modern desktop UI (dashboard, wizards, review workspace, export).
- **Application/services layer** — import parsing, mapping engine, working-paper and statement generators, validation, review-note tracking.
- **Standards Engine** — versioned, data-driven rulesets and disclosure libraries; the single source of compliance truth, updated via signed standards packs.
- **Local data layer** — encrypted engagement store, mapping profiles, templates, audit trail, and encrypted backups; all on-device.
- **Export layer** — statement sets and working-paper files to PDF and Excel, with the standards-pack version stamped on the output for traceability.

This separation is what makes the "supports future standards" requirement real: a new standard changes data in the Standards Engine, not code across the app, so updates are low-risk, reviewable, and reproducible.

## 7. Suggested Delivery Phases

1. **Foundation** — local encrypted store, engagement model, dashboard shell, Excel import wizard with validation and preview.
2. **Mapping & working papers** — taxonomy mapping with per-client memory, mapping profiles, working-paper generation, review notes.
3. **Statements & compliance** — IFRS-for-SMEs statement assembly, disclosure library, validation rules, compliance-alerts panel, PDF/Excel export.
4. **Standards lifecycle** — signed standards-pack update mechanism, version stamping, prior-year reproducibility, changelog surfacing.
5. **Firm-scale polish** — customisable templates, multi-staff access controls, encrypted backup/restore, refinement from practitioner feedback.

---

*This document is a design specification. All generated working papers and financial statements are drafts intended for review and approval by a qualified practitioner; the tool accelerates preparation and compliance checking but does not replace professional judgement or sign-off.*
