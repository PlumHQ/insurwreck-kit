---
description: Publish a new Plum data slice to hackathon participants. Use when a participant needs data the existing slices don't cover - "can I get claims joined to endorsements", "I need renewal dates by org", "there's no table with X". Organizer-only; needs the Metabase admin key and the desk ADMIN_KEY.
---

# Publish a data slice

A participant needs data no current slice returns. You are going to write one SQL
query, prove it is safe, save it as a Metabase question, and publish it. Target
is about five minutes. No deploy, and participants don't restart anything.

## 0. What they actually need

Ask once, then stop asking: **which columns, at what grain, filtered by what.**
"Claims joined to endorsements" is not a spec. "One row per org per month with
endorsement premium added and claims paid" is.

Check `list_datasets` first - the answer is often a join the participant can do
themselves across two existing slices, which costs nothing.

## 1. Write it

Warehouse is Postgres, database id **2** in Metabase. Table and column names are
camelCase and **must be double-quoted**: `"Claim"`, `c."claimedAmount"`.

Facts already established - don't re-derive them:

- **There is no `Policy` table.** The policy schedule is `OrganisationBenefit`
  (72 cols) joined to `OrganisationBenefitGrade`.
- `Claim` has 329 columns and its status column is **`"stage"`**, not `status`.
  `tatRevision0Days` is mostly NULL - compute TAT from dates.
- Benefit type comes from `Benefit."type"`: gmc, health-expenses,
  gmc-parent-only, gpa, covid19, voluntary-topup, gtl, hospicash, opd, dental.
  GPA+GTL together are only ~1,800 claims.
- `Organisation` has `brandName`, `legalName`, `status`, `activeEmployees`,
  `location`, `serviceTier`, `accountHealthScore`, `endorsementHealthScore`.
- `EndorsementBatch` breaks convention with **all-lowercase** columns:
  `premiumadd`, `premiumdel`, `lastcdbgbal`, `orgpolicyno`, `createtimeutc`.
- `ClaimMis` has no ICD column and no usable key to `IcdCode`. Diagnosis codes
  live on `InsurerClaim."icd10_code"`; match `upper(left(icd10_code,3))` to
  `IcdCode."id"`.
- NPS score is **`question2`** in both `CashlessNPS` and `ReimbursementNPS`.
  Every other question column is verbatim text or dead.
- **Avoid**: `ClaimAudits` (57.5M), `ClaimComment` (6.3M), `AccountHealthMetric`
  (88.5M - use `Organisation`'s own score columns instead).

Always bound the query in time, e.g. `where "createdAt" >= now() - interval '18 months'`.
An unbounded card on a 712k-row table punishes everyone in the room.

## 2. Run it before you trust it

```bash
cd <scratch dir>
cat > q.sql <<'SQL'
<your query>
limit 5
SQL
python3 run.py q.sql
```

If you don't have `run.py`, POST to `https://stats2.plumhq.com/api/dataset` with
`x-api-key: <metabase admin key>` and a body of
`{"type":"native","database":2,"native":{"query":"..."}}`.

Iterate until it returns real rows. Never publish SQL you haven't seen return data.

## 3. The PII gate - do not skip this

This is where a slice goes wrong. A previous card cleared human review and still
had a leak in it: `ClaimSettlementItemDeductions."description"` looks like a tidy
enum in its top 40 values, but its tail is 460 free-text notes written by ops
containing invoice numbers, clinic names, and patient references.

Rules:

- **Never select**: `memberName`, `patientName`, `phoneNumber`,
  `alternatePhoneNumber`, member email, `dateOfBirth`, `ZendeskTicket."description"`,
  Zendesk comment bodies, `ClaimMis."diagnosis"`, NPS verbatim columns.
- Member identifiers must be hashed: `md5(c."memberId")`.
- Ages must be banded: `width_bucket(extract(year from age(now(), "dateOfBirth")), 0, 100, 10)`.
- Diagnosis must be bucketed to ICD chapter/section.
- Org names (`brandName`) are fine - participants are Plum leadership.

**For every free-text-looking column you plan to expose, check the tail, not the head:**

```sql
select "<col>", count(*) n from "<Table>" group by 1 having count(*) = 1
order by random() limit 10
```

If those singletons read like sentences, drop the column. If they read like
`COVERAGE_GROUP_NOT_FOUND`, keep it.

## 4. Save it as a Metabase question

Collection **968** ("Insurwreck 4.0"). Strip any `limit` you used for testing.

```bash
curl -s -X POST https://stats2.plumhq.com/api/card \
  -H "x-api-key: $MB_ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"name":"<slice_name>","description":"<one line, plus any caveat>",
       "collection_id":968,"display":"table","visualization_settings":{},
       "dataset_query":{"type":"native","database":2,"native":{"query":"<sql>"}}}'
```

Name it in `snake_case` to match the existing slices. The response `id` is the
card id.

## 5. Publish it

```bash
curl -s -X POST https://insurwreck-desk.preview.plumhq.com/api/slices \
  -H "x-admin-key: $DESK_ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"card_id":<id>,"note":"<who asked and why>"}'
```

The desk verifies the hackathon key can actually read the card before it
publishes - a 400 here usually means the card landed outside collection 968.

Or use the page: `https://insurwreck-desk.preview.plumhq.com/slices.html`.

It is live immediately. Tell the participant to call `list_datasets` again -
no restart, no reinstall.

## 6. If it turns out to leak

Withdraw first, ask questions after. One click on `slices.html`, or:

```bash
curl -s -X DELETE https://insurwreck-desk.preview.plumhq.com/api/slices \
  -H "x-admin-key: $DESK_ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"card_id":<id>}'
```

That flips `enabled` to false and it disappears from `list_datasets` on the next
call. The card stays in Metabase so you can fix and re-publish.

## What you cannot fix this way

If the data isn't in the warehouse at all, no slice will conjure it. Known
absences: a wellness calendar, a renewal calendar as such (derive it from
`OrganisationBenefit."expirationDate"`), and anything from Salesforce, Kula,
Keka, Google Sheets or Slack. Those need the relevant MCP server, not a slice -
point the participant at the `connect-a-tool` skill instead.
