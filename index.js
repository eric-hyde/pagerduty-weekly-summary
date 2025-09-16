#!/usr/bin/env node
/**
 * // ---------- Helpers ----------
function mondayRangeFor(date = new Date()) {
  // Find the current week's Monday 00:00 in local tz, and previous Monday
  // date-fns startOfWeek with weekStartsOn:1 = Monday
  const weekStartLocal = startOfWeek(date, { weekStartsOn: 1 });
  // We want the window [prevMonday 00:00, thisMonday 00:00)
  const thisMonday = new Date(
    weekStartLocal.getFullYear(),
    weekStartLocal.getMonth(),
    weekStartLocal.getDate(), 0, 0, 0, 0
  );
  const prevMonday = subWeeks(thisMonday, 1);
  const prevPrevMonday = subWeeks(thisMonday, 2);uty summary:
 * - Time window: last Monday 00:00 (local tz) to this Monday 00:00
 * - Pull Analytics (interruptions, etc.) & Incidents (raw)
 * - Compare vs prior week
 * - Summarize with local Ollama
 * - Post to Slack
 */
const axios = require("axios");
const dotenv = require("dotenv");
const { formatISO, subWeeks, startOfWeek, addWeeks } = require("date-fns");
const tzOffset = require("tz-offset");

dotenv.config();

// ---------- Config ----------
const PD_API_TOKEN = process.env.PD_API_TOKEN;
const PD_TEAM_IDS = (process.env.PD_TEAM_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const PD_SCHEDULES = (process.env.PD_SCHEDULES || "").split(",").map(s => s.trim()).filter(Boolean);
const PD_TEAM_NAME = process.env.PD_TEAM_NAME || "Observability";
const PD_TIMEZONE = process.env.PD_TIMEZONE || "America/Chicago";
const SLACK_WORKFLOW_WEBHOOK_URL = process.env.SLACK_WORKFLOW_WEBHOOK_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const ENABLE_CRON = (process.env.ENABLE_CRON || "false").toLowerCase() === "true";
const CRON_EXPR = process.env.CRON_EXPR || "0 9 * * 1";
const CRON_TZ = process.env.CRON_TZ || PD_TIMEZONE;
const DEBUG = (process.env.DEBUG || "false").toLowerCase() === "true";

// ---------- Helpers ----------
function mondayRangeFor(date = new Date()) {
  // Find the current week’s Monday 00:00 in local tz, and previous Monday
  // date-fns startOfWeek with weekStartsOn:1 = Monday
  const weekStartLocal = startOfWeek(date, { weekStartsOn: 1 });
  // We want the window [prevMonday 00:00, thisMonday 00:00)
  const thisMonday = new Date(
    weekStartLocal.getFullYear(),
    weekStartLocal.getMonth(),
    weekStartLocal.getDate(), 0, 0, 0, 0
  );
  const prevMonday = subWeeks(thisMonday, 1);
  const prevPrevMonday = subWeeks(thisMonday, 2);

  // Convert these local times to ISO with offset (keep wall clock intent)
  function toLocalISO(d) {
    // tz-offset helps produce a fixed offset string for the desired timezone
    const offsetMinutes = tzOffset.offsetOf(PD_TIMEZONE, d);
    const withOffset = new Date(d.getTime() - (d.getTimezoneOffset() - offsetMinutes) * 60000);
    return formatISO(withOffset); // keeps offset
  }

  return {
    // current period
    startISO: toLocalISO(prevMonday),
    endISO: toLocalISO(thisMonday),
    // comparison period (previous week)
    cmpStartISO: toLocalISO(prevPrevMonday),
    cmpEndISO: toLocalISO(prevMonday)
  };
}

function mondayRangeForWeeksAgo(weeksAgo = 1) {
  // Get the report for N weeks ago (1 = last week, 2 = two weeks ago, etc.)
  const baseDate = subWeeks(new Date(), weeksAgo);
  return mondayRangeFor(baseDate);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    weeksAgo: null,
    help: false,
    debug: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--weeks-ago' || arg === '-w') {
      const weeksAgo = parseInt(args[i + 1]);
      if (isNaN(weeksAgo) || weeksAgo < 1) {
        console.error('Error: --weeks-ago must be a positive integer');
        process.exit(1);
      }
      options.weeksAgo = weeksAgo;
      i++; // skip the next argument
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--last-week' || arg === '-l') {
      options.weeksAgo = 1;
    } else if (arg === '--debug' || arg === '-d') {
      options.debug = true;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
PagerDuty Weekly Report Generator

Usage: node index.js [options]

Options:
  --weeks-ago, -w <N>    Generate report for N weeks ago (1 = last week, 2 = two weeks ago, etc.)
  --last-week, -l        Shortcut for --weeks-ago 1 (last Monday to previous Monday)
  --debug, -d            Enable debug logging for Slack webhook payload
  --help, -h             Show this help message

Examples:
  node index.js                    # Current week report (default)
  node index.js --last-week        # Last week's report
  node index.js --weeks-ago 2      # Report from 2 weeks ago
  node index.js -w 3               # Report from 3 weeks ago

Environment Variables:
  PD_API_TOKEN                     # Required: PagerDuty API token
  PD_TEAM_IDS                      # Required: Comma-separated team IDs
  SLACK_WORKFLOW_WEBHOOK_URL       # Required: Slack workflow webhook URL
  PD_TIMEZONE                      # Optional: Timezone (default: America/Chicago)
  OLLAMA_MODEL                     # Optional: Ollama model (default: llama3.1:8b)
  OLLAMA_BASE_URL                  # Optional: Ollama base URL (default: http://localhost:11434)
`);
}

function pctDelta(curr, prev) {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return ((curr - prev) / prev) * 100;
}

// ---------- PagerDuty API ----------
const pd = axios.create({
  baseURL: "https://api.pagerduty.com",
  headers: {
    "Authorization": `Token token=${PD_API_TOKEN}`,
    "Accept": "application/vnd.pagerduty+json;version=2",
    "Content-Type": "application/json"
  },
  timeout: 30000
});

// Analytics: incidents aggregated by team for a time range
async function fetchTeamAnalytics(startISO, endISO) {
  const body = {
    filters: {
      created_at_start: startISO,
      created_at_end: endISO,
      team_ids: PD_TEAM_IDS
      // add more filters if you want, e.g. urgency: "high"
    },
    // Valid: "day"|"week"|"month" (omit for totals)
    aggregate_unit: "week",
    time_zone: "UTC"
  };

  const { data } = await pd.post("/analytics/metrics/incidents/teams", body);
  // Expect something like { data: [ { team_id, metrics... }, ... ] }
  return data?.data || [];
}

// Incidents list for the period (helps give concrete examples / links)
async function fetchIncidents(startISO, endISO) {
  // Paginate just in case; filter by team_ids[]
  const incidents = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const params = {
      since: startISO,
      until: endISO,
      time_zone: "UTC",
      limit,
      offset,
      team_ids: PD_TEAM_IDS, // PD allows repeated query params: team_ids[]=...
      sort_by: "created_at:asc"
    };

    // Axios sends arrays as repeated params by default, but we’ll ensure bracket format:
    const { data } = await pd.get("/incidents", {
      params,
      paramsSerializer: { serialize: p =>
        Object.entries(p).flatMap(([k, v]) => {
          if (Array.isArray(v)) return v.map(val => `${encodeURIComponent(k)}[]=${encodeURIComponent(val)}`);
          return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
        }).join("&")
      }
    });

    incidents.push(...(data?.incidents || []));
    if (!data?.more) break;
    offset += limit;
  }
  return incidents;
}

// Fetch on-call users for the period
async function fetchOnCallUsers(startISO, endISO) {
  const onCallUsers = [];

  if (PD_SCHEDULES.length === 0) {
    console.log("No PD_SCHEDULES configured, skipping on-call user fetch");
    return onCallUsers;
  }

  try {
    const { data } = await pd.get("/oncalls", {
      params: {
        schedule_ids: PD_SCHEDULES,
        since: startISO,
        until: endISO,
        time_zone: "UTC"
      },
      paramsSerializer: { serialize: p =>
        Object.entries(p).flatMap(([k, v]) => {
          if (Array.isArray(v)) return v.map(val => `${encodeURIComponent(k)}[]=${encodeURIComponent(val)}`);
          return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
        }).join("&")
      }
    });

    if (data?.oncalls) {
      for (const oncall of data.oncalls) {
        if (oncall.user) {
          onCallUsers.push({
            name: oncall.user.summary,  // API returns 'summary' not 'name'
            email: oncall.user.email || oncall.user.id,  // Fallback to ID if no email
            schedule: oncall.schedule?.summary || "Unknown Schedule",  // API returns 'summary'
            start: oncall.start,
            end: oncall.end
          });
        }
      }
    }
  } catch (error) {
    console.error(`Failed to fetch on-call users:`, error.message);
    if (DEBUG && error.response) {
      console.error("On-call API error:", error.response.status, error.response.data);
    }
  }
  
  // Deduplicate by user email and merge schedules
  const userMap = new Map();
  for (const user of onCallUsers) {
    const key = user.email;
    if (userMap.has(key)) {
      const existing = userMap.get(key);
      if (!existing.schedules.includes(user.schedule)) {
        existing.schedules.push(user.schedule);
      }
    } else {
      userMap.set(key, {
        name: user.name,
        email: user.email,
        schedules: [user.schedule]
      });
    }
  }
  
  return Array.from(userMap.values());
}

// Fetch detailed incident information including log entries (pages/alerts)
async function fetchIncidentDetails(incidents) {
  const detailedIncidents = [];
  
  for (const incident of incidents.slice(0, 10)) { // Limit to avoid rate limits
    try {
      const { data } = await pd.get(`/incidents/${incident.id}/log_entries`, {
        params: {
          include: ["channels"],
          time_zone: "UTC"
        }
      });
      
      const logEntries = data?.log_entries || [];
      const notifications = logEntries.filter(entry => 
        entry.type === "notify_log_entry" || entry.type === "trigger_log_entry"
      );
      
      detailedIncidents.push({
        ...incident,
        notification_count: notifications.length,
        notification_channels: [...new Set(notifications.map(n => n.channel?.type).filter(Boolean))],
        first_notification: notifications[0]?.created_at,
        pages_sent: notifications.filter(n => n.channel?.type === "push_notification" || n.channel?.type === "sms").length
      });
    } catch (error) {
      console.error(`Failed to fetch details for incident ${incident.id}:`, error.message);
      detailedIncidents.push({
        ...incident,
        notification_count: 0,
        notification_channels: [],
        pages_sent: 0
      });
    }
  }
  
  return detailedIncidents;
}

// ---------- Ollama (local) ----------
async function ollamaSummarize(payload) {
  // Calculate percentage changes for the prompt
  const currTotals = payload.currentWeek.totals;
  const prevTotals = payload.previousWeek.totals;
  
  const calcChange = (current, previous) => {
    if (previous === 0) return current > 0 ? "+∞%" : "unchanged";
    const change = ((current - previous) / previous * 100).toFixed(0);
    return change > 0 ? `+${change}%` : `${change}%`;
  };

  const prompt = `
You are an SRE program assistant. Summarize the ${payload.team} Team's PagerDuty activity for the week.

CURRENT WEEK DATA:
- Incidents: ${currTotals.total_incidents} 
- SEVs: ${payload.currentWeek.sev_count}
- Interruptions: ${currTotals.total_interruptions}
- Sleep-hour interruptions: ${currTotals.total_sleep_hour_interruptions}
- Major incidents: ${currTotals.total_major_incidents}

PREVIOUS WEEK DATA:
- Incidents: ${prevTotals.total_incidents}
- Interruptions: ${prevTotals.total_interruptions} 
- Sleep-hour interruptions: ${prevTotals.total_sleep_hour_interruptions}
- Major incidents: ${prevTotals.total_major_incidents}

CALCULATED CHANGES:
- Incidents: ${calcChange(currTotals.total_incidents, prevTotals.total_incidents)}
- Interruptions: ${calcChange(currTotals.total_interruptions, prevTotals.total_interruptions)}
- Sleep-hour interruptions: ${calcChange(currTotals.total_sleep_hour_interruptions, prevTotals.total_sleep_hour_interruptions)}

ON-CALL USERS: ${payload.onCallUsers.map(u => u.name).join(", ")}

INCIDENT EXAMPLES: ${payload.currentWeek.examples.slice(0, 5).map(i => `"${i.title}" (${i.service || "Unknown service"})`).join(", ")}

Requirements:
- Start with 1-2 sentence executive summary mentioning the team and week's key metrics
- List on-call users for this period
- Report trends using the CALCULATED CHANGES above (do not recalculate percentages)
- Use "SEV" instead of "major incident"
- If there were notable incidents, mention 2-3 key incident titles and affected services
- End with a brief assessment of notable improvements or concerns
- Keep it concise and factual

Use the exact numbers and percentages provided above. Do not perform your own calculations.
`;

  // Use Chat API for better formatting
  const { data } = await axios.post(
    `${OLLAMA_BASE_URL}/api/chat`,
    {
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: "You are a concise SRE program assistant." },
        { role: "user", content: prompt }
      ],
      stream: false
    },
    { timeout: 120000 }
  );

  // Ollama returns { message: { role, content }, ... } for chat endpoint
  return data?.message?.content || "No summary generated.";
}

// ---------- Slack Workflow ----------
async function postToSlackWorkflow(text, blocks, data) {
  if (global.DEBUG || DEBUG) {
    console.log("=== Slack Workflow Debug ===");
    console.log("Input parameters:");
    console.log("- text:", text);
    console.log("- blocks:", JSON.stringify(blocks, null, 2));
    console.log("- data:", JSON.stringify(data, null, 2));
  }
  
  // Slack workflows only support text, slack_channel_id, slack_user_id, slack_user_email
  // So we need to flatten everything to text fields
  const payload = {
    // Test field to verify workflow is receiving data
    test_message: `Workflow test - ${new Date().toISOString()}`,
    
    // Main message content
    message_text: text,
    message_blocks: JSON.stringify(blocks),
    
    // Period information
    period_label: data.periodLabel,
    
    // Current week metrics (as text)
    current_incidents: data.currTotals.total_incidents.toString(),
    current_interruptions: data.currTotals.total_interruptions.toString(),
    current_sleep_interruptions: data.currTotals.total_sleep_hour_interruptions.toString(),
    current_major_incidents: data.currTotals.total_major_incidents.toString(),
    
    // Previous week metrics (as text)
    previous_incidents: data.prevTotals.total_incidents.toString(),
    previous_interruptions: data.prevTotals.total_interruptions.toString(),
    previous_sleep_interruptions: data.prevTotals.total_sleep_hour_interruptions.toString(),
    previous_major_incidents: data.prevTotals.total_major_incidents.toString(),
    
    // Quick facts
    sev_count: data.facts.sevs.toString(),
    total_pages_sent: data.facts.totalPages.toString(),
    top_services: data.facts.topServices.map(([service, count]) => `${service}(${count})`).join(", "),
    on_call_users: data.onCallUsers ? data.onCallUsers.map(u => u.name).join(", ") : "",
    
    // Recent incidents
    recent_incidents: data.facts.incidentTitles ? data.facts.incidentTitles.map(inc => 
      `${inc.title} (${inc.service})`
    ).join(" | ") : "",
    
    // AI summary
    ai_summary: data.summary,
    
    // Calculated deltas (as text with arrows)
    incidents_trend: fmtDelta(data.currTotals.total_incidents, data.prevTotals.total_incidents),
    interruptions_trend: fmtDelta(data.currTotals.total_interruptions, data.prevTotals.total_interruptions),
    sleep_interruptions_trend: fmtDelta(data.currTotals.total_sleep_hour_interruptions, data.prevTotals.total_sleep_hour_interruptions),
    sevs_trend: fmtDelta(data.currTotals.total_major_incidents, data.prevTotals.total_major_incidents)
  };

  if (global.DEBUG || DEBUG) {
    console.log("=== Payload to send ===");
    console.log("Full payload:", JSON.stringify(payload, null, 2));
    console.log("Payload size:", JSON.stringify(payload).length, "bytes");
    console.log("Webhook URL:", SLACK_WORKFLOW_WEBHOOK_URL ? "SET" : "NOT SET");
  }
  
  try {
    const response = await axios.post(SLACK_WORKFLOW_WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    if (global.DEBUG || DEBUG) {
      console.log("=== Response ===");
      console.log("Status:", response.status);
      console.log("Status Text:", response.statusText);
      console.log("Response headers:", JSON.stringify(response.headers, null, 2));
      console.log("Response data:", JSON.stringify(response.data, null, 2));
    }

    return response;
  } catch (error) {
    if (global.DEBUG || DEBUG) {
      console.error("=== Error posting to Slack workflow ===");
      console.error("Error message:", error.message);
      if (error.response) {
        console.error("Error status:", error.response.status);
        console.error("Error data:", JSON.stringify(error.response.data, null, 2));
        console.error("Error headers:", JSON.stringify(error.response.headers, null, 2));
      }
    }
    throw error;
  }
}

// ---------- Report builder ----------
function extractTotals(rows) {
  // Rows are per-aggregate-unit (week) or per-team depending on PD response;
  // We’ll sum common fields if present.
  const metrics = {
    total_incidents: 0,
    total_interruptions: 0,
    total_sleep_hour_interruptions: 0,
    total_major_incidents: 0
  };

  for (const r of rows) {
    // Common metric field names seen in Analytics responses:
    metrics.total_incidents += (r.total_incidents || 0);
    metrics.total_interruptions += (r.total_interruptions || 0);
    metrics.total_sleep_hour_interruptions += (r.total_sleep_hour_interruptions || 0);
    metrics.total_major_incidents += (r.total_major_incidents || 0);
  }
  return metrics;
}

function fmtDelta(curr, prev) {
  const d = pctDelta(curr, prev);
  const arrow = d > 0 ? "▲" : (d < 0 ? "▼" : "—");
  return `${curr} (${arrow} ${Math.round(d)}%)`;
}

function incidentQuickFacts(incidents, detailedIncidents = []) {
  // Use "SEV" terminology instead of "major incidents"
  const sevs = incidents.filter(i => 
    i?.severity === "critical" || 
    i?.priority?.name?.toLowerCase()?.includes("sev") ||
    i?.major_incident === true
  ).length;
  
  const byService = {};
  const totalPages = detailedIncidents.reduce((sum, i) => sum + (i.pages_sent || 0), 0);
  
  for (const i of incidents) {
    const s = i?.service?.summary || i?.service?.name || "Unknown Service";
    byService[s] = (byService[s] || 0) + 1;
  }
  
  const topServices = Object.entries(byService).sort((a, b) => b[1] - a[1]).slice(0, 5);
  
  // Get incident titles for summary
  const incidentTitles = incidents.slice(0, 5).map(i => ({
    title: i.title,
    service: i?.service?.summary || "Unknown",
    severity: i?.severity || i?.priority?.name || "Unknown",
    pages_sent: detailedIncidents.find(d => d.id === i.id)?.pages_sent || 0
  }));
  
  return { 
    sevs, 
    topServices, 
    totalPages,
    incidentTitles,
    totalIncidents: incidents.length
  };
}

function slackBlocks({ periodLabel, currTotals, prevTotals, facts, ollamaText, onCallUsers = [] }) {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `PagerDuty Weekly – ${periodLabel}` } },
    { type: "section", text: { type: "mrkdwn", text: ollamaText } },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Incidents:*\n${fmtDelta(currTotals.total_incidents, prevTotals.total_incidents)}` },
        { type: "mrkdwn", text: `*SEVs:*\n${fmtDelta(currTotals.total_major_incidents, prevTotals.total_major_incidents)}` },
        { type: "mrkdwn", text: `*Interruptions:*\n${fmtDelta(currTotals.total_interruptions, prevTotals.total_interruptions)}` },
        { type: "mrkdwn", text: `*Sleep-Hour Interruptions:*\n${fmtDelta(currTotals.total_sleep_hour_interruptions, prevTotals.total_sleep_hour_interruptions)}` }
      ]
    }
  ];

  // Add on-call information section
  if (onCallUsers && onCallUsers.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*On-call during this period:*\n${onCallUsers.map(user => 
          `• ${user.name} (${user.schedules ? user.schedules.join(", ") : user.schedule || "Unknown Schedule"})`
        ).join("\n")}`
      }
    });
  }

  // Add incident details if any
  if (facts.incidentTitles && facts.incidentTitles.length > 0) {
    const incidentText = facts.incidentTitles.map(inc => 
      `• ${inc.title} (${inc.service})${inc.pages_sent > 0 ? ` - ${inc.pages_sent} pages sent` : ""}`
    ).join("\n");
    
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Recent Incidents:*\n${incidentText}`
      }
    });
  }

  // Add context section
  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `*Top services:* ${facts.topServices.map(([s, n]) => `\`${s}\`(${n})`).join(", ") || "—"}` },
      { type: "mrkdwn", text: `*Total pages sent:* ${facts.totalPages || 0}` }
    ]
  });

  return blocks;
}

// ---------- Main ----------
async function run(weeksAgo = null) {
  if (!PD_API_TOKEN || PD_TEAM_IDS.length === 0 || !SLACK_WORKFLOW_WEBHOOK_URL) {
    console.error("Missing required env vars. Check PD_API_TOKEN, PD_TEAM_IDS, SLACK_WORKFLOW_WEBHOOK_URL.");
    process.exit(1);
  }

  // Get date range based on weeksAgo parameter
  const { startISO, endISO, cmpStartISO, cmpEndISO } = weeksAgo !== null 
    ? mondayRangeForWeeksAgo(weeksAgo) 
    : mondayRangeFor(new Date());

  if (weeksAgo !== null) {
    console.log(`Generating report for ${weeksAgo} week(s) ago: ${startISO.substring(0,10)} → ${endISO.substring(0,10)}`);
  }

  // Current period - fetch all data in parallel
  const [currAnalytics, currIncidents, onCallUsers] = await Promise.all([
    fetchTeamAnalytics(startISO, endISO),
    fetchIncidents(startISO, endISO),
    fetchOnCallUsers(startISO, endISO)
  ]);

  if (DEBUG) {
    console.log("Fetched on-call users:", JSON.stringify(onCallUsers, null, 2));
  }

  // Previous period
  const [prevAnalytics, prevIncidents] = await Promise.all([
    fetchTeamAnalytics(cmpStartISO, cmpEndISO),
    fetchIncidents(cmpStartISO, cmpEndISO)
  ]);

  // Get detailed incident information (with page counts)
  const detailedIncidents = await fetchIncidentDetails(currIncidents);

  const currTotals = extractTotals(currAnalytics);
  const prevTotals = extractTotals(prevAnalytics);

  const facts = incidentQuickFacts(currIncidents, detailedIncidents);

  // Build payload for Ollama
  const ollamaInput = {
    team: PD_TEAM_NAME,
    period: { startISO, endISO },
    compareTo: { startISO: cmpStartISO, endISO: cmpEndISO },
    teams: PD_TEAM_IDS,
    onCallUsers: onCallUsers.map(user => ({
      name: user.name,
      schedules: user.schedules
    })),
    currentWeek: {
      totals: currTotals,
      incidents_count: currIncidents.length,
      sev_count: facts.sevs,
      total_pages_sent: facts.totalPages,
      examples: detailedIncidents.map(i => ({
        id: i.id,
        title: i.title,
        status: i.status,
        service: i?.service?.summary,
        created_at: i.created_at,
        html_url: i.html_url,
        severity: i.severity || i?.priority?.name || null,
        is_sev: i.major_incident || i?.severity === "critical" || i?.priority?.name?.toLowerCase()?.includes("sev"),
        pages_sent: i.pages_sent || 0,
        notification_count: i.notification_count || 0
      }))
    },
    previousWeek: {
      totals: prevTotals,
      incidents_count: prevIncidents.length
    }
  };

  const summary = await ollamaSummarize(ollamaInput);

  const periodLabel = `${startISO.substring(0,10)} → ${endISO.substring(0,10)} (vs ${cmpStartISO.substring(0,10)} → ${cmpEndISO.substring(0,10)})`;
  const blocks = slackBlocks({ periodLabel, currTotals, prevTotals, facts, ollamaText: summary, onCallUsers });

  const workflowData = {
    periodLabel,
    currTotals,
    prevTotals,
    facts,
    summary,
    onCallUsers
  };

  await postToSlackWorkflow(`PagerDuty Weekly – ${periodLabel}`, blocks, workflowData);
  console.log("Posted weekly PagerDuty summary to Slack workflow.");
}

// ---------- CLI Entry Point ----------
const options = parseArgs();

if (options.help) {
  showHelp();
  process.exit(0);
}

// Override DEBUG flag if command line argument is provided
if (options.debug) {
  global.DEBUG = true;
} else {
  global.DEBUG = DEBUG;
}

// Optional: cron scheduling (every Monday)
if (ENABLE_CRON && options.weeksAgo === null) {
  // Use node's built-in scheduler via setInterval would drift; instead keep it simple:
  // If you want robust cron, use 'node-cron' pkg; but we avoid an extra dep.
  const cron = require("node:timers");
  console.log(`Cron enabled. Will run per CRON_EXPR (${CRON_EXPR}) in ${CRON_TZ}.`);
  // Minimal cron support: recommend running via OS scheduler (cron, systemd timer, GitHub Actions) at your desired time.
  // For portability, we also run immediately when launched:
  run().catch(e => console.error(e));
} else {
  // One-shot run (either current week or specific weeks ago)
  run(options.weeksAgo).catch(e => {
    console.error("Run failed:", e?.response?.data || e);
    process.exit(1);
  });
}