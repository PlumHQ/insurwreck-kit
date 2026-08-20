// Tabular masking for the Metabase slices. Run: node mask-rows.test.mjs
process.env.CLAIMS_MASK_SALT = "test-salt-not-a-real-one";
const { maskRows, maskClaim } = await import("./_claims.js");

let pass = 0, fail = 0;
const ok = (label, cond) => { cond ? pass++ : (fail++, console.log(`FAIL ${label}`)); };
const eq = (label, a, b) => ok(`${label} (got ${JSON.stringify(a)})`, a === b);

// --- the join key must survive, even when it looks exactly like a mobile ---
{
  const cols = ["member_id", "patient_id", "membership_id", "policy_number", "claim_id", "org_id"];
  const row  = ["9876543210", "8123456789", "7000111222", "P/9012345678", "CL7005", "6001234567"];
  const { rows, join_keys } = maskRows(cols, [row]);
  cols.forEach((c, i) => eq(`${c} passes through untouched`, rows[0][i], row[i]));
  ok("join_keys names every id column", join_keys.length === 6);
}

// --- proof the naive approach would have destroyed it ---
{
  const naive = maskClaim({ member_id: "9876543210" });
  ok("maskClaim WOULD have mangled a numeric member_id", naive.member_id !== "9876543210");
}

// --- people get masked ---
{
  const cols = ["member_name", "patient_name", "employee_email", "member_phone", "policy_holder_name"];
  const row  = ["Rajesh Kumar", "Priya Nair", "rajesh@example.com", "9876543210", "Anil Mehta"];
  const { rows } = maskRows(cols, [row]);
  row.forEach((v, i) => ok(`${cols[i]} is masked`, rows[0][i] !== v));
  ok("member_name becomes a pseudonym", /^Member [0-9a-f]{8}$/.test(rows[0][0]));
  ok("employee_email lands on .invalid", rows[0][2].endsWith("@masked.invalid"));
  ok("member_phone becomes a token", /^phone_[0-9a-f]{8}$/.test(rows[0][3]));
  ok("policy_holder_name is a person, not a policy", /^Member /.test(rows[0][4]));
}

// --- institutions are NOT people: the snake_case gap ---
{
  const cols = ["org_name", "organisation_name", "hospital_name", "insurer_name", "provider_name",
                "tpa_name", "Org Name", "company_name", "network_name", "plan_name", "benefit_name"];
  const row  = ["Acme Technologies", "Acme Technologies", "Manipal Hospital", "Niva Bupa",
                "Star Health", "MediAssist", "Acme Technologies", "Acme Technologies",
                "PPN", "Gold Plan", "Maternity"];
  const { rows } = maskRows(cols, [row]);
  cols.forEach((c, i) => eq(`${c} survives`, rows[0][i], row[i]));
}
{
  // the specific regression: maskClaim gets org_name wrong, maskRows must not
  const before = maskClaim({ org_name: "Acme Technologies" }).org_name;
  ok("maskClaim WOULD have masked org_name", before !== "Acme Technologies");
}

// --- stability across the two sides of the MCP ---
{
  const viaRows  = maskRows(["member_name"], [["Rajesh Kumar"]]).rows[0][0];
  const viaClaim = maskClaim({ memberName: "Rajesh Kumar" }).memberName;
  eq("same person, same pseudonym in cards and claims", viaRows, viaClaim);
  const email1 = maskRows(["member_email"], [["a@b.com"]]).rows[0][0];
  const email2 = maskClaim({ emailId: "a@b.com" }).emailId;
  eq("same email, same pseudonym on both sides", email1, email2);
}

// --- free text: claim_comment carries names in prose ---
{
  const cols = ["claim_id", "member_id", "member_name", "comment_body"];
  const rows = [
    ["CL7005", "9876543210", "Rajesh Kumar",
     "Called Rajesh Kumar on 9876543210, mailed rajesh@example.com. Rajesh will resend."],
  ];
  const out = maskRows(cols, rows).rows[0];
  eq("claim_id untouched", out[0], "CL7005");
  eq("member_id untouched", out[1], "9876543210");
  const body = out[3];
  ok("name gone from prose", !/Rajesh/i.test(body));
  ok("surname gone from prose", !/Kumar/i.test(body));
  ok("phone gone from prose", !body.includes("9876543210"));
  ok("email gone from prose", !body.includes("rajesh@example.com"));
  ok("bare first-name mention also caught", (body.match(/Member [0-9a-f]{8}/g) || []).length >= 2);
  ok("both mentions collapse to one pseudonym", new Set(body.match(/Member [0-9a-f]{8}/g)).size === 1);
}

// --- unknown PII-shaped column fails closed ---
{
  const { rows } = maskRows(["contact_name", "mobile", "email"], [["Sunita", "9812345678", "s@x.com"]]);
  ok("unrecognised contact_name masked", rows[0][0] !== "Sunita");
  ok("bare mobile masked", rows[0][1] !== "9812345678");
  ok("bare email masked", rows[0][2] !== "s@x.com");
}

// --- non-strings and nulls survive ---
{
  const { rows } = maskRows(["amount", "settled_on", "is_vip", "member_name"],
                            [[50000, "2026-08-01", true, null]]);
  eq("number passes", rows[0][0], 50000);
  eq("date passes", rows[0][1], "2026-08-01");
  eq("bool passes", rows[0][2], true);
  eq("null passes", rows[0][3], null);
}

// --- the email exception relaxes email only ---
{
  const cols = ["member_name", "member_email", "member_phone"];
  const row  = ["Rajesh Kumar", "rajesh@example.com", "9876543210"];
  const { rows, masked } = maskRows(cols, [row], { unmaskEmail: true });
  eq("email survives for the exempt project", rows[0][1], "rajesh@example.com");
  ok("name still masked", rows[0][0] !== row[0]);
  ok("phone still masked", rows[0][2] !== row[2]);
  eq("payload says what was masked", masked, "names and phone numbers");
}

// --- Metabase column objects, not bare strings ---
{
  const cols = [{ display_name: "Member Name", name: "member_name" }, { name: "member_id" }];
  const { rows } = maskRows(cols, [["Rajesh Kumar", "9876543210"]]);
  ok("display_name form is classified", rows[0][0] !== "Rajesh Kumar");
  eq("id still survives via object form", rows[0][1], "9876543210");
}

// --- a whole dump must not contain the originals ---
{
  const cols = ["member_id", "member_name", "member_email", "member_phone", "org_name", "comment_body"];
  const rows = Array.from({ length: 50 }, (_, i) => [
    `90000000${String(i).padStart(2, "0")}`, "Rajesh Kumar", "rajesh@example.com",
    "9876543210", "Acme Technologies", "Spoke to Rajesh Kumar re: 9876543210",
  ]);
  const dump = JSON.stringify(maskRows(cols, rows).rows);
  for (const leak of ["Rajesh", "Kumar", "rajesh@example.com", "9876543210"]) {
    ok(`no "${leak}" anywhere in 50 masked rows`, !dump.includes(leak));
  }
  ok("org name still present in the dump", dump.includes("Acme Technologies"));
  ok("member ids still present in the dump", dump.includes("9000000049"));
}

// --- degrades loudly, never silently ---
{
  const rows = Array.from({ length: 900 }, (_, i) => [`Person Number${i}`, "note"]);
  const out = maskRows(["member_name", "note"], rows);
  ok("over the cap, a note is returned", Boolean(out.masking_note));
  ok("name columns are still masked over the cap", out.rows[0][0] !== "Person Number0");
}
{
  const out = maskRows(["member_name"], [["Rajesh Kumar"]]);
  ok("under the cap, no note", !out.masking_note);
}

// --- parity with the claims side: dropped, not merely masked ---
{
  const cols = ["member_id","member_name","pan_card","bank_account_no","bank_details_ifsc",
                "address","pin_code","user_ip_address","aadhaar_no","email_address"];
  const row  = ["7000111222","Rajesh Kumar","ABCDE1234F","50100234567890","HDFC0001234",
                "12 Residency Road","560025","49.207.183.22","1234 5678 9012","r@x.com"];
  const out = maskRows(cols, [row]);
  for (const gone of ["pan_card","bank_account_no","bank_details_ifsc","address","pin_code","user_ip_address","aadhaar_no"])
    ok(`${gone} is dropped`, !out.columns.includes(gone));
  ok("email_address is masked, not dropped", out.columns.includes("email_address"));
  ok("email_address actually masked", out.rows[0][out.columns.indexOf("email_address")] !== "r@x.com");
  ok("member_id kept", out.columns.includes("member_id"));
  ok("dropped columns are named, not silent", (out.dropped_columns || []).length === 7);
  const dump = JSON.stringify(out.rows);
  for (const leak of ["ABCDE1234F","50100234567890","HDFC0001234","Residency","560025","49.207.183.22"])
    ok(`no "${leak}" survives`, !dump.includes(leak));
  ok("row width matches column width", out.rows[0].length === out.columns.length);
}

// --- an institution's address is not a member's ---
{
  const cols = ["hospital_name","hospital_address","hospital_pincode","city","state"];
  const row  = ["Manipal Hospital","98 Old Airport Road","560017","Bengaluru","KA"];
  const out = maskRows(cols, [row]);
  cols.forEach((c) => ok(`${c} survives on a hospital row`, out.columns.includes(c)));
  ok("hospital address value intact", out.rows[0][1] === "98 Old Airport Road");
}
{
  // unscoped columns on the one slice whose addresses are business addresses
  const cols = ["name","address","pincode","city"];
  const row  = ["Manipal Hospital","98 Old Airport Road","560017","Bengaluru"];
  const kept = maskRows(cols, [row], { dataset: "hospital_lookup" });
  ok("hospital_lookup keeps pincode - the PIN search depends on it", kept.columns.includes("pincode"));
  ok("hospital_lookup keeps address", kept.columns.includes("address"));
  const other = maskRows(cols, [row], { dataset: "iw_lives_base" });
  ok("the same columns drop on a member slice", !other.columns.includes("pincode") && !other.columns.includes("address"));
}

// --- signed object-store URLs go, on the same terms as claims ---
{
  const cols = ["claim_id","doc_url","preview_url","public_url"];
  const row  = ["CL7005",
    "https://storage.googleapis.com/b/discharge.pdf?X-Goog-Signature=deadbeef&Expires=1",
    "https://s3.amazonaws.com/b/bill.pdf?X-Amz-Signature=cafe",
    "https://plumhq.com/help/claims"];
  const { rows, columns } = maskRows(cols, [row]);
  ok("gcs signed url kept intact", rows[0][columns.indexOf("doc_url")] === row[1]);
  ok("s3 signed url kept intact", rows[0][columns.indexOf("preview_url")] === row[2]);
  ok("ordinary url survives", rows[0][columns.indexOf("public_url")] === "https://plumhq.com/help/claims");
}

// --- a signed url whose path carries the member name must not be rewritten ---
{
  const cols = ["member_name", "doc_url"];
  const signed = "https://storage.googleapis.com/b/RAJESH_KUMAR_discharge.pdf?X-Goog-Signature=deadbeef";
  const { rows } = maskRows(cols, [["Rajesh Kumar", signed]]);
  ok("name column still masked", rows[0][0] !== "Rajesh Kumar");
  ok("signed url byte-identical, so the signature still verifies", rows[0][1] === signed);
  ok("name NOT rewritten inside the signed path", rows[0][1].includes("RAJESH_KUMAR"));
}

// --- real column names from the published slices, mixed conventions in one row ---
// claim_deductions alone carries org, org_id, organisationId and organisationName.
{
  const cols = ["memberId","employeeId","organisationId","emp_name","nominee_name",
                "organisationName","org","typeOfBenefit","claim_ref","member_ref_hash"];
  const row  = ["9876543210","7000111222","12345","Rajesh Kumar","Priya Nair",
                "Acme Technologies","Acme Technologies","GMC","CL7005","a1b2c3d4"];
  const out = maskRows(cols, [row]);
  const at = (c) => out.rows[0][out.columns.indexOf(c)];
  eq("camelCase memberId is an identifier, not a phone", at("memberId"), "9876543210");
  eq("camelCase employeeId survives", at("employeeId"), "7000111222");
  eq("camelCase organisationId survives", at("organisationId"), "12345");
  ok("memberId is advertised as a join key", out.join_keys.includes("memberId"));
  ok("emp_name is masked despite the abbreviation", /^Member /.test(at("emp_name")));
  ok("nominee_name is masked", /^Member /.test(at("nominee_name")));
  eq("camelCase organisationName is an org, not a person", at("organisationName"), "Acme Technologies");
  eq("and the bare org column is not swept either", at("org"), "Acme Technologies");
  eq("typeOfBenefit untouched", at("typeOfBenefit"), "GMC");
  eq("claim_ref untouched", at("claim_ref"), "CL7005");
}

// --- PII columns that end in an identifier suffix must not read as identifiers ---
// id / no / number are all identifier suffixes, and Plum's API calls the address
// emailId. Testing identifiers first let every one of these through untouched.
{
  const cols = ["emailId","phone_number","contact_no","mobile_no","phoneNumber",
                "member_id","org_id","claim_ref","policy_number","hospital_phone"];
  const row  = ["rajesh@example.com","9876543210","9812345678","9811111111","9822222222",
                "7000111222","12345","CL7005","P/900123","08041234567"];
  const out = maskRows(cols, [row]);
  const at = (c) => out.rows[0][out.columns.indexOf(c)];
  ok("emailId is an address, not an id", at("emailId").endsWith("@masked.invalid"));
  for (const c of ["phone_number","contact_no","mobile_no","phoneNumber"])
    ok(`${c} is masked despite the id-ish suffix`, /^phone_[0-9a-f]{8}$/.test(at(c)));
  for (const c of ["member_id","org_id","claim_ref","policy_number"])
    eq(`${c} still passes through`, at(c), row[cols.indexOf(c)]);
  eq("a hospital switchboard is not a member phone", at("hospital_phone"), "08041234567");
  ok("join_keys excludes the PII columns", !out.join_keys.some((k) => /phone|email|contact|mobile/i.test(k)));
  ok("join_keys still lists the real keys", out.join_keys.length === 4);
}

// --- real columns from the published slices, taken from Metabase card metadata ---
{
  // 19646 endorsement batch dump: institution words arrive with no separator at all
  const cols = ["batchid","orgplumid","orgname","assigneduser","providername",
                "currentstatus","Status Name","currentAccountManagerEmail"];
  const row  = ["B1","O1","Acme Technologies","ops@plumhq.com","Niva Bupa",
                "PENDING","Awaiting insurer","am@plumhq.com"];
  const out = maskRows(cols, [row]);
  const at = (c) => out.rows[0][out.columns.indexOf(c)];
  eq("orgname is an org even with no separator", at("orgname"), "Acme Technologies");
  eq("providername is an insurer, not a person", at("providername"), "Niva Bupa");
  // Status Name IS over-masked, and that is the accepted trade. Passing it through
  // needed label words (status/type/source/file/document) in INSTITUTION_COL, which
  // let document_signer_name and report_author_name through as well. A mangled
  // caption is cheaper than a leaked name.
  ok("Status Name is over-masked, deliberately", /^Member [0-9a-f]{8}$/.test(at("Status Name")));
  ok("currentAccountManagerEmail is masked", at("currentAccountManagerEmail").endsWith("@masked.invalid"));
}
{
  // 19647 hospital lookup: bare phone/email/pincode are the hospital's own, and
  // Metabase titles the card with a space while data_slices uses an underscore.
  const cols = ["hospital_name","hospital_address","phone","email","pincode","city",
                "hospital_phone","hospital_email"];
  const row  = ["Manipal Hospital","98 Old Airport Road","08041234567","desk@manipal.test",
                "560017","Bengaluru","08041234500","ops@manipal.test"];
  for (const label of ["hospital_lookup", "hospital lookup", "Hospital Lookup"]) {
    const out = maskRows(cols, [row], { dataset: label });
    ok(`"${label}": pincode survives — the PIN search depends on it`, out.columns.includes("pincode"));
    cols.forEach((c, i) => eq(`"${label}": ${c} intact`, out.rows[0][out.columns.indexOf(c)], row[i]));
  }
  // the same column names on a member slice are still member PII
  const member = maskRows(["phone","email","pincode"], [["9876543210","r@x.com","560017"]],
                          { dataset: "iw_lives_base" });
  ok("bare phone still masked on a member slice", member.rows[0][0] !== "9876543210");
  ok("bare email still masked on a member slice", member.rows[0][1] !== "r@x.com");
  ok("pincode still dropped on a member slice", !member.columns.includes("pincode"));
}
{
  // 19645 telehealth consultation dump: display names with spaces are still ids
  const cols = ["Appointment Id","Member ID","Employee ID","Curable Patient No"];
  const row  = ["A1","7000111222","9876543210","8123456789"];
  const out = maskRows(cols, [row]);
  cols.forEach((c, i) => eq(`${c} survives as a join key`, out.rows[0][i], row[i]));
  ok("all four advertised as join keys", out.join_keys.length === 4);
}

// --- the label-word experiment must not come back ---
// These all start with a word that looks like a category but carry a person's name.
{
  const cols = ["file_uploaded_by_name","document_signer_name","report_author_name",
                "source_contact_email","type_of_contact","status_name"];
  const out = maskRows(cols, [cols.map(() => "Rajesh Kumar")]);
  cols.forEach((c, i) =>
    ok(`${c} is masked, not treated as a category`, out.rows[0][i] !== "Rajesh Kumar"));
}

console.log(`maskRows: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
