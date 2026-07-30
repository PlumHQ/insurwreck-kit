import { participantEmail } from "./_lib.js";
import {
  EMPLOYEES_PATH,
  KekaNotConnected,
  ROUTES,
  kekaConfigured,
  kekaFetch,
  resolveSelf,
} from "./_keka.js";

// The participant's own Keka data, as an MCP server. Sibling of /api/mcp
// (read-only Plum warehouse data); this one is HR and lives on its own route.
//
// The boundary here is KEKA'S OWN PERMISSION MODEL, not this file. The desk
// holds no tenant-wide Keka key: every call carries an access token the
// participant minted by logging into Keka themselves through the OAuth
// authorization-code flow, so Keka decides what they may read or write and this
// server can grant no reach they don't already have in the Keka UI.
//
// What that buys us over the alternative: a tenant API key from Global admin
// settings is admin-scoped and org-wide, which would make THIS FILE the only
// thing standing between a prompt injection and 850 employees' payroll. Per-user
// OAuth moves that decision back to Keka, where it belongs.

const PROTOCOL_VERSION = "2025-06-18";
const SELF_TTL_MS = 300000;

const dateArg = (description) => ({ type: "string", description });

const TOOLS = [
  {
    name: "keka_whoami",
    description:
      "Resolve the Keka employee record for the connected account. Returns employee id, name, work email, department and job title. Start here.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "keka_get_my_profile",
    description: "Get the full Keka profile for the connected employee.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "keka_list_leave_types",
    description: "List the leave types configured for the organisation, with their ids.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "keka_get_my_leave_balance",
    description: "Get the connected employee's leave balances, by leave type.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "keka_list_my_leave_requests",
    description:
      "List the connected employee's leave requests, optionally narrowed to a date range.",
    inputSchema: {
      type: "object",
      properties: { from: dateArg("Start of range, YYYY-MM-DD"), to: dateArg("End of range, YYYY-MM-DD") },
      additionalProperties: false,
    },
  },
  {
    name: "keka_get_my_attendance",
    description: "Get the connected employee's attendance records for a date range.",
    inputSchema: {
      type: "object",
      properties: { from: dateArg("Start of range, YYYY-MM-DD"), to: dateArg("End of range, YYYY-MM-DD") },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "keka_list_holidays",
    description: "List the organisation's holiday calendar.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "keka_apply_leave",
    description:
      "Apply for leave for the connected employee. This WRITES to Keka and a real approver will see it - confirm the dates with the participant before calling.",
    inputSchema: {
      type: "object",
      properties: {
        from: dateArg("First day of leave, YYYY-MM-DD"),
        to: dateArg("Last day of leave, YYYY-MM-DD"),
        leave_type_id: { type: "string", description: "Leave type id from keka_list_leave_types" },
        reason: { type: "string", description: "Reason shown to the approver" },
      },
      required: ["from", "to", "leave_type_id", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "keka_raw_get",
    description:
      "Escape hatch: GET any Keka path under /api/v1 with arbitrary query params, using the connected employee's own token. Use when a typed tool above rejects a filter name.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path starting with /api/v1, e.g. /api/v1/time/leavetypes" },
        query: { type: "object", description: "Query parameters as a flat object" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
];

// Lambdas get reused, so cache the employee lookup rather than re-listing
// employees on every tool call.
const selfCache = new Map();

async function self(email) {
  const hit = selfCache.get(email);
  if (hit && hit.at > Date.now() - SELF_TTL_MS) return hit.value;
  const value = await resolveSelf(email);
  selfCache.set(email, { value, at: Date.now() });
  return value;
}

const employeeId = (record) => record.id || record.employeeId || record.employeeNumber;

const dateRange = (args) => {
  const query = {};
  if (args.from) query.from = String(args.from);
  if (args.to) query.to = String(args.to);
  return query;
};

async function callTool(name, args, email) {
  switch (name) {
    case "keka_whoami": {
      const me = await self(email);
      return {
        id: employeeId(me),
        name: me.displayName || me.fullName || me.firstName,
        email: me.email || me.workEmail || me.officialEmail,
        department: me.department?.title || me.department,
        jobTitle: me.jobTitle?.title || me.jobTitle,
      };
    }
    case "keka_get_my_profile":
      return kekaFetch(email, `${EMPLOYEES_PATH}/${encodeURIComponent(employeeId(await self(email)))}`);
    case "keka_list_leave_types":
      return kekaFetch(email, ROUTES.leave_types.path);
    case "keka_get_my_leave_balance":
      return kekaFetch(email, ROUTES.leave_balance.path, {
        query: { employeeIds: employeeId(await self(email)) },
      });
    case "keka_list_my_leave_requests":
      return kekaFetch(email, ROUTES.leave_requests.path, {
        query: { employeeIds: employeeId(await self(email)), ...dateRange(args) },
      });
    case "keka_get_my_attendance":
      return kekaFetch(email, ROUTES.attendance.path, {
        query: { employeeIds: employeeId(await self(email)), ...dateRange(args) },
      });
    case "keka_list_holidays":
      return kekaFetch(email, ROUTES.holidays.path);
    case "keka_apply_leave":
      return kekaFetch(email, ROUTES.leave_requests.path, {
        method: "POST",
        body: {
          employeeId: employeeId(await self(email)),
          fromDate: String(args.from),
          toDate: String(args.to),
          leaveTypeId: String(args.leave_type_id),
          reason: String(args.reason),
        },
      });
    case "keka_raw_get": {
      const path = String(args.path || "");
      // Their own token or not, keep this pinned to the Keka API surface.
      if (!path.startsWith("/api/v1/") || path.includes("..")) {
        throw new Error("path must start with /api/v1/ and contain no traversal");
      }
      return kekaFetch(email, path, {
        query: args.query && typeof args.query === "object" ? args.query : undefined,
      });
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, server: "insurwreck-keka", protocol: PROTOCOL_VERSION });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let email;
  try {
    email = await participantEmail(req);
  } catch (error) {
    return res.status(500).json(rpcError(null, -32603, String(error.message || error)));
  }
  if (!email) return res.status(401).json(rpcError(null, -32001, "Invalid or missing token."));

  const message = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  const { id = null, method, params } = message || {};

  if (method && method.startsWith("notifications/")) return res.status(202).end();

  try {
    switch (method) {
      case "initialize":
        return res.status(200).json(
          rpcOk(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "insurwreck-keka", version: "1.0.0" },
            instructions:
              "The participant's OWN Keka HR record - profile, leave, attendance, holidays. Call keka_whoami first. " +
              "Keka enforces their permissions, so anything refused here is refused in Keka too. " +
              "keka_apply_leave writes a real request a real approver will see: confirm dates before calling.",
          })
        );

      case "tools/list":
        return res.status(200).json(rpcOk(id, { tools: TOOLS }));

      case "tools/call": {
        if (!kekaConfigured()) {
          return res.status(200).json(
            rpcOk(id, {
              content: [
                {
                  type: "text",
                  text: "Keka isn't switched on yet. Tell an organizer that KEKA_CLIENT_ID, KEKA_CLIENT_SECRET and KEKA_API_BASE are unset on the desk.",
                },
              ],
              isError: true,
            })
          );
        }
        const data = await callTool(params?.name, params?.arguments || {}, email);
        return res
          .status(200)
          .json(rpcOk(id, { content: [{ type: "text", text: JSON.stringify(data ?? null, null, 2) }] }));
      }

      case "ping":
        return res.status(200).json(rpcOk(id, {}));

      default:
        return res.status(200).json(rpcError(id, -32601, `Method not found: ${method}`));
    }
  } catch (error) {
    if (method === "tools/call") {
      const text =
        error instanceof KekaNotConnected
          ? error.message
          : `Error: ${error.message || error}`;
      return res.status(200).json(rpcOk(id, { content: [{ type: "text", text }], isError: true }));
    }
    return res.status(200).json(rpcError(id, -32603, String(error.message || error)));
  }
}
