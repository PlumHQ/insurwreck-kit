// node desk/api/mask.test.mjs
//
// Masking is the only thing between a participant and the name, phone number and
// email address of a real Plum member, and unlike a published slice it runs
// against a schema we do not own - `ClaimSerializer` is `fields = '__all__'`, so
// upstream can add a column and it lands in our output the same day. The check
// that matters most is therefore the last one: an unknown key holding a
// PII-shaped value must come out masked without anyone having listed it here.
import assert from "node:assert";

process.env.CLAIMS_MASK_SALT = "test-salt-not-a-real-one";
const { maskClaim, unmaskEmailFor } = await import("./_claims.js");

let checks = 0;
const check = (label, actual, expected) => {
  assert.deepStrictEqual(actual, expected, label);
  checks += 1;
};
const ok = (label, condition) => {
  assert.ok(condition, label);
  checks += 1;
};

const CLAIM = {
  plumClaimId: "CL7005",
  memberId: "mem_abc123",
  memberName: "Rajesh Kumar",
  patientName: "Priya Kumar",
  whatIsPatientName: "Priya Kumar",
  organisationName: "Chargebee",
  tpaName: "Medi Assist",
  assignedTo: "ops@plumhq.com",
  userIPAddress: "49.207.183.22",
  claimedAmount: 45000,
  isClosed: false,
  closedAt: null,
  unFormattedDeductionReasons: "Called 9876543210, mailed ops@plumhq.com for the bill",
  insurerRejectionReason: "Patient Priya Kumar was not covered; spoke to Rajesh on 9876543210",
  communicationPreference: {
    email: "rajesh@example.com",
    alternateEmail: "rajesh.k@work.example.com",
    phoneNumber: "9876543210",
    alternatePhoneNumber: "+91 98765 43211",
  },
  hospital: { hospitalname: "Kumar Memorial Hospital", email: "billing@kumar.example.com" },
  emailAddress: "rajesh@example.com",
  courierDetailsList: [
    {
      courier: "Bluedart",
      recipientName: "Rajesh Kumar",
      address: "42 Residency Road, Bengaluru 560025",
      courierAddressMultiLine: "42 Residency Road\nBengaluru 560025",
    },
  ],
  userInputFields: {
    city: { value: "Bengaluru" },
    panCard: { value: "ABCDE1234F" },
    bankDetailsAccountNo: { value: "50100234567890" },
    bankDetailsIFSC: { value: "HDFC0001234" },
    pinCode: { value: "560025" },
  },
  documents: [
    {
      name: "discharge_summary.pdf",
      displayName: { name: "Discharge Summary" },
      sectionTag: "discharge",
      url: "https://storage.googleapis.com/claims/CL7005/d1/summary.pdf?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=86400&X-Goog-Signature=deadbeef",
      previewUrl: { 64: "https://storage.googleapis.com/t/x.png?X-Goog-Signature=beef" },
    },
    { name: "RAJESH 9876543210 bill.pdf", sectionTag: "bills" },
  ],
};

const masked = maskClaim(CLAIM, { unmaskEmail: false });

// People are replaced.
ok("memberName is masked", /^Member [0-9a-f]{8}$/.test(masked.memberName));
ok("patientName is masked", /^Member [0-9a-f]{8}$/.test(masked.patientName));
ok("phoneNumber is masked", /^phone_[0-9a-f]{8}$/.test(masked.communicationPreference.phoneNumber));
ok("email is masked", /^[0-9a-f]{8}@masked\.invalid$/.test(masked.communicationPreference.email));

// Organisations are not people. Participants are Plum leadership and every
// claims view is unusable without the org and the hospital.
check("organisationName survives", masked.organisationName, "Chargebee");
check("tpaName survives", masked.tpaName, "Medi Assist");
// An institution named after a person keeps its name: replacing a surname inside
// "Kumar Memorial Hospital" corrupts real signal and protects nobody.
check("hospital name survives", masked.hospital.hospitalname, "Kumar Memorial Hospital");

// Nested and repeated values.
check(
  "the same person gets the same token in different fields",
  masked.patientName,
  masked.whatIsPatientName
);
ok(
  "a second call returns the same token",
  maskClaim(CLAIM, { unmaskEmail: false }).memberName === masked.memberName
);
ok(
  "alternate contact fields are masked too",
  /^[0-9a-f]{8}@masked\.invalid$/.test(masked.communicationPreference.alternateEmail) &&
    /^phone_[0-9a-f]{8}$/.test(masked.communicationPreference.alternatePhoneNumber)
);
ok(
  "+91 and bare forms of one number collapse to one token",
  maskClaim({ a: "+919876543210" }).a === maskClaim({ a: "9876543210" }).a
);

// Free text. The organizer slice guide documents a column whose head looked like
// an enum and whose tail was ops notes with patient references in it.
ok(
  "a phone number inside free text is scrubbed",
  /phone_[0-9a-f]{8}/.test(masked.unFormattedDeductionReasons)
);
ok(
  "an email inside free text is scrubbed",
  /[0-9a-f]{8}@masked\.invalid/.test(masked.unFormattedDeductionReasons)
);
ok(
  "the rest of the sentence survives",
  masked.unFormattedDeductionReasons.startsWith("Called ") &&
    masked.unFormattedDeductionReasons.endsWith(" for the bill")
);

// The half that matters most: a name we learned from one field, removed from the
// free text of another. Masking memberName and shipping the note that spells it
// out would be theatre.
ok(
  "a name written out in free text is replaced",
  masked.insurerRejectionReason.startsWith("Patient Member ") &&
    !/Priya|Kumar|Rajesh/i.test(masked.insurerRejectionReason)
);
check(
  "a name in free text gets the same token as the field it came from",
  masked.insurerRejectionReason.includes(masked.patientName),
  true
);

// Filenames. Masking one to "Member 3f9a" destroys it, but ops name files after
// patients often enough that they still go through the scrubber.
check("a filename is not replaced wholesale", masked.documents[0].name, "discharge_summary.pdf");
check("displayName.name survives", masked.documents[0].displayName.name, "Discharge Summary");
ok(
  "a name in a filename is replaced, in caps, next to digits",
  masked.documents[1].name === `${masked.memberName} phone_${masked.communicationPreference.phoneNumber.slice(6)} bill.pdf`
);
check("sectionTag is untouched", masked.documents[1].sectionTag, "bills");

// A signed object-store URL is a download link to the member's actual discharge
// summary, valid for 24 hours. It is returned whole and unscrubbed on purpose:
// projects need the document, and the object path is inside what the signature
// covers, so any edit to the string yields a link that looks right and 403s.
check(
  "a signed document url is returned intact",
  masked.documents[0].url,
  "https://storage.googleapis.com/claims/CL7005/d1/summary.pdf?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=86400&X-Goog-Signature=deadbeef"
);
check(
  "including nested preview urls",
  masked.documents[0].previewUrl["64"],
  "https://storage.googleapis.com/t/x.png?X-Goog-Signature=beef"
);
ok("but the document is still visibly there", masked.documents[0].documentId === undefined && masked.documents[0].sectionTag === "discharge");

// Bank and government-ID fields, which no name pattern would have touched.
ok("panCard is gone", !("panCard" in masked.userInputFields));
ok("the account number is gone", !("bankDetailsAccountNo" in masked.userInputFields));
ok("the IFSC is gone", !("bankDetailsIFSC" in masked.userInputFields));
ok("the pin code is gone", !("pinCode" in masked.userInputFields));
check("but the city stays", masked.userInputFields.city.value, "Bengaluru");

// Caught by the value's shape, not by its key - nobody listed `assignedTo`.
ok("an ops email is masked", /^[0-9a-f]{8}@masked\.invalid$/.test(masked.assignedTo));

// Dropped outright. A member's postal address rides along on every detail read
// inside courierDetailsList, and it is not a name, a phone number or an email.
ok("userIPAddress is gone", !("userIPAddress" in masked));
ok("a postal address is gone", !("address" in masked.courierDetailsList[0]));
ok("so is the multi-line form", !("courierAddressMultiLine" in masked.courierDetailsList[0]));
ok("but the courier itself survives", masked.courierDetailsList[0].courier === "Bluedart");
ok("and a name inside it is masked, not dropped", /^Member [0-9a-f]{8}$/.test(masked.courierDetailsList[0].recipientName));
check("emailAddress is masked rather than dropped", typeof masked.emailAddress, "string");
ok("and masked properly", /^[0-9a-f]{8}@masked\.invalid$/.test(masked.emailAddress));

// Non-strings pass through, structure is preserved.
check("numbers survive", masked.claimedAmount, 45000);
check("booleans survive", masked.isClosed, false);
check("nulls survive", masked.closedAt, null);
check("ids survive", masked.memberId, "mem_abc123");
check("arrays stay arrays", masked.documents.length, 2);

// Nothing real leaks anywhere in the tree. Signed URLs are deliberately NOT in this
// list any more - they are returned whole so projects can open the documents - so
// the check below asserts the exception is confined to them rather than absent.
const dump = JSON.stringify(masked);
for (const secret of ["Rajesh Kumar", "Priya", "9876543210", "rajesh@example.com", "ops@plumhq.com", "49.207.183.22", "ABCDE1234F", "50100234567890", "Residency Road"]) {
  ok(`"${secret}" is absent from the output`, !dump.includes(secret));
}
// The signed-URL exception is exactly that: an exception, not a hole. A member name
// sitting in a NON-signed url still gets scrubbed.
ok(
  "an unsigned url carrying a name is still scrubbed",
  !maskClaim({ memberName: "Rajesh Kumar", link: "https://x.test/Rajesh_Kumar/report.pdf" })
    .link.includes("Rajesh")
);
ok(
  "a signed url carrying a name is left whole, so it still verifies",
  maskClaim({ memberName: "Rajesh Kumar", url: "https://x.test/Rajesh_Kumar/r.pdf?X-Goog-Signature=ab" })
    .url === "https://x.test/Rajesh_Kumar/r.pdf?X-Goog-Signature=ab"
);

// The one project that may see email addresses sees ONLY email addresses.
const unmasked = maskClaim(CLAIM, { unmaskEmail: true });
check("email is real for the exempt project", unmasked.communicationPreference.email, "rajesh@example.com");
check("an email in free text is left alone too", unmasked.unFormattedDeductionReasons.includes("ops@plumhq.com"), true);
ok("names are still masked for the exempt project", /^Member [0-9a-f]{8}$/.test(unmasked.memberName));
ok(
  "phone numbers are still masked for the exempt project",
  /^phone_[0-9a-f]{8}$/.test(unmasked.communicationPreference.phoneNumber)
);

// A column added upstream tomorrow, that nobody here has heard of.
const surprise = maskClaim({ someFieldAddedNextWeek: "newperson@example.com", anotherOne: "9812345678" });
ok("an unknown key holding an email is masked", /^[0-9a-f]{8}@masked\.invalid$/.test(surprise.someFieldAddedNextWeek));
ok("an unknown key holding a phone number is masked", /^phone_[0-9a-f]{8}$/.test(surprise.anotherOne));

// The exception is resolved in one place, and env is the same-minute override.
check("no flag, no env: masked", unmaskEmailFor({ email: "someone@plumhq.com" }), false);
check("credential flag grants it", unmaskEmailFor({ email: "a@plumhq.com", unmaskEmail: true }), true);
process.env.CLAIMS_UNMASK_EMAILS = "Winner@plumhq.com, other@plumhq.com";
check("env list grants it, case-insensitively", unmaskEmailFor({ email: "winner@plumhq.com" }), true);
check("and nobody else", unmaskEmailFor({ email: "someone@plumhq.com" }), false);
delete process.env.CLAIMS_UNMASK_EMAILS;

console.log(`maskClaim: ${checks} cases pass`);
