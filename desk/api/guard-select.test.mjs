// node desk/api/guard-select.test.mjs
//
// The SQL guard is the only thing between a full-access participant and a write
// against the warehouse, so it gets a check. Both directions matter: refusing a
// real write, and not refusing a legitimate SELECT that merely mentions one.
import assert from "node:assert";
import { guardSelect } from "./mcp.js";

const allows = (sql) => { guardSelect(sql); };
const refuses = (sql, why) => assert.throws(() => guardSelect(sql), new RegExp(why, "i"), sql);

// Writes stay refused.
refuses(`select 1; drop table "Claim"`, "one statement at a time");
refuses(`update "Claim" set "stage" = 'x'`, "only SELECT or WITH");
refuses(`select 1 from "Claim" where id in (delete from x returning id)`, "read-only");
refuses(`with t as (insert into x values (1) returning *) select * from t`, "read-only");
refuses(``, "empty query");
refuses(`explain select 1`, "only SELECT or WITH");

// Legitimate queries that merely contain a keyword as data. Every one of these
// was refused before, and the last is the exact query that surfaced the bug.
allows(`select 'create' as verb`);
allows(`select count(*) filter (where a."verb" = 'create') from "ClaimAudits" a`);
allows(`select * from "Claim" where "stage" = 'update-pending'`);
allows(`select "createdAt", "updatedAt" from "Claim"`);
allows(`select 'a;b' as s`);
allows(`with recent as (select 1) select * from recent`);
allows(`select 'it''s a drop' as note`);

console.log("guardSelect: 13 cases pass");
