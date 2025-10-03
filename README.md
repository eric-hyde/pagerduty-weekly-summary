# PagerDuty Weekly Report

Automated weekly PagerDuty analytics reports sent to Slack workflows, with AI-powered summaries.

Prerequisites:

**Get the pager duty API token by following instruction [here](https://support.pagerduty.com/main/docs/api-access-keys). Copy the generated token** and add it to your `.env` file:
   ```bash
   PD_API_TOKEN=your_token_here
   ```
> **Note:** The API token only needs **read** permissions. The script does not modify any PagerDuty data.s and on-call user tracking.

## Features

- 📊 **Weekly Analytics**: Incidents, interruptions, sleep-hour interruptions, and SEVs
- 🔄 **Trend Analysis**: Compare current week vs previous week with percentage changes
- 👥 **On-Call Tracking**: Shows who was on-call during the reporting period
- 🤖 **AI Summaries**: Uses Ollama for intelligent report summarization
- 📅 **Flexible Scheduling**: Built-in cron support or ad-hoc historical reports
- 🐳 **Docker Ready**: Containerized for easy deployment
- 🔍 **Debug Mode**: Comprehensive logging for troubleshooting

## Quick Start

### Automated Setup (Recommended)

1. Checkout the repository locally

2. **Run the setup script**
   ```bash
   ./scripts/setup.sh
   ```
   
   This will:
   - Check Node.js version
   - Install npm dependencies
   - Install and configure Ollama (if needed)
   - Set up environment configuration
   - Test the installation

3. **Edit your configuration**
   ```bash
   # Edit .env with your actual credentials
   nano .env
   ```

4. **Run reports**
   ```bash
   # Test with debug mode
   npm run dev
   
   # Current week
   npm start
   
   # Previous week  
   npm run last-week
   ```

### Manual Setup

If you prefer to set up manually:

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Install Ollama**
   ```bash
   # macOS
   brew install ollama
   # or
   curl -fsSL https://ollama.ai/install.sh | sh
   
   # Start Ollama server
   ollama serve
   
   # Pull a model
   ollama pull llama3.2:3b
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

## Setup

### 1. Environment Configuration
Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

#### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PD_API_TOKEN` | PagerDuty API token | `u+YrzuXhx2s2kxzzeuGg` |
| `PD_TEAM_IDS` | Comma-separated team IDs | `TEAM_ID_1,TEAM_ID_2` |
| `PD_TEAM_NAME` | Team name for AI summaries | `Observability` |
| `PD_SCHEDULES` | Comma-separated schedule IDs | `SCHEDULE_ID_1,SCHEDULE_ID_2` |
| `SLACK_WORKFLOW_WEBHOOK_URL` | Slack workflow webhook URL | `https://hooks.slack.com/triggers/...` |
| `OLLAMA_MODEL` | Ollama model to use | `llama3.2:3b` |

#### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PD_TIMEZONE` | Timezone for reports | `America/Chicago` |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` |
| `ENABLE_CRON` | Enable automatic scheduling | `false` |
| `CRON_EXPR` | Cron expression | `0 9 * * 1` (9am Mondays) |
| `CRON_TZ` | Cron timezone | Same as `PD_TIMEZONE` |
| `DEBUG` | Enable debug logging | `false` |

### 2. PagerDuty API Setup

#### Getting Your API Token

1. **Log in to PagerDuty** for your organization
2. **Click on "My Profile"** (usually in the top-right menu)
3. **Click on the "User Settings" tab**
4. **Click "Create API User Token"** button
5. **Give it a description** (e.g., "Weekly Reports Script")
6. **Copy the generated token** and add it to your `.env` file:
   ```bash
   PD_API_TOKEN=your_token_here
   ```

#### Finding Team and Schedule IDs

**Team IDs:**
1. Go to **People → Teams** in PagerDuty
2. Click on your team name
3. The team ID is in the URL: `https://yourorg.pagerduty.com/teams/PXXXXXX`
4. Use `PXXXXXX` as your team ID

**Schedule IDs:**  
1. Go to **People → On-Call Schedules**
2. Click on your schedule name
3. The schedule ID is in the URL: `https://yourorg.pagerduty.com/schedules/PXXXXXX`
4. Use `PXXXXXX` as your schedule ID

### 3. Slack Workflow Setup

#### Option A: Use the Included Template (Recommended)

1. **Import the pre-configured workflow**:
   - Open Slack Workflow Builder in your browser (only browser/desktop, not mobile supported)
   - Click "Create" → "Import"  
   - Select `slack-workflow-template.json` from this repository
   - Configure the message recipients (channels/users)
   - Publish the workflow and copy the webhook URL

2. **Detailed setup guide**: See [SLACK_SETUP.md](./SLACK_SETUP.md) for complete instructions

#### Option B: Create from Scratch

1. **Open Slack Workflow Builder**
   - Go to your Slack workspace → "Tools" → "Workflow Builder"

2. **Create New Workflow**
   - Click "Create Workflow" → "Webhook" trigger
   - Configure webhook parameters: `ai_summary`, `period_label`

3. **Add Message Steps**
   - Add "Send a message to a channel" steps
   - Use webhook data to format messages
   - Copy the webhook URL to your `.env` file
   - You can use variables like `{{text}}` for the message text
   - Use `{{blocks}}` to include the rich formatting

5. **Publish Workflow**
   - Test the workflow
   - Publish it when ready

### 4. Install Dependencies

```bash
npm install
```

### 5. Run the Report

```bash
# Current week report (default behavior)
node index.js

# Generate report for last week (last Monday to previous Monday)
node index.js --last-week
# or
node index.js -l

# Generate report for N weeks ago
node index.js --weeks-ago 2    # 2 weeks ago
node index.js -w 3             # 3 weeks ago

# Show help
node index.js --help
```

## Workflow Data Structure

The webhook receives structured data that can be used in your workflow:
### Workflow Data Structure

The webhook receives structured data that can be used in your Slack workflow. Below are the inputs and their descriptions:

- **`period_label`**: A string representing the reporting period (e.g., "Last Week", "Current Week").
- **`current_incidents`**: The total number of incidents that occurred during the reporting period.
- **`incident_trend`**: A comparison of incidents between the current and previous reporting periods (e.g., "up 10%", "down 5%").
- **`current_interruptions`**: The total number of interruptions during the reporting period.
- **`interruptions_trend`**: A comparison of interruptions between the current and previous reporting periods.
- **`current_sleep_interruptions`**: The total number of sleep-hour interruptions during the reporting period.
- **`sleep_interruptions_trend`**: A comparison of sleep-hour interruptions between the current and previous reporting periods.
- **`previous_interruptions`**: The total number of interruptions in the previous reporting period.
- **`previous_sleep_interruptions`**: The total number of sleep-hour interruptions in the previous reporting period.
- **`ai_summary`**: An AI-generated summary of the report, providing key insights and highlights.
- **`message_text`**: A plain-text version of the report, suitable for simple Slack messages.
- **`message_blocks`**: A rich-text formatted version of the report, designed for Slack's block kit.

These inputs can be used to dynamically populate your Slack messages with relevant data and formatting.

## Troubleshooting

1. **Webhook URL**: Make sure your `SLACK_WORKFLOW_WEBHOOK_URL` is correct and the workflow is published
2. **Permissions**: Ensure the workflow has permission to post to your target channel
3. **Testing**: Use Slack's workflow test feature to verify the webhook integration works

## Command Line Options

The tool supports several command-line options for ad-hoc report generation:

### Generate Reports for Previous Weeks

```bash
# Last week's report (most common ad-hoc use case)
node index.js --last-week

# Report from 2 weeks ago
node index.js --weeks-ago 2

# Report from any number of weeks ago
node index.js -w 5
```

### Date Range Logic

- **Current week** (default): Previous Monday 00:00 to this Monday 00:00
- **Last week** (`--last-week`): Two Mondays ago to last Monday
- **N weeks ago** (`--weeks-ago N`): Reports for the Monday-to-Monday period N weeks in the past

This is particularly useful for:
- Generating missed reports
- Historical analysis
- Backfilling data
- Testing with known data ranges

## Slack Workflow Template

The included `slack-workflow-template.json` file is a pre-configured Slack workflow that you can import directly into your Slack workspace. This template:

- ✅ **Ready to use**: No need to build workflow from scratch
- 🔧 **Customizable**: Easy to modify recipients and formatting  
- 📊 **Formatted**: Proper rich text formatting for reports
- 🚀 **Quick setup**: Import, configure recipients, get webhook URL

**To use**: See the detailed guide in [SLACK_SETUP.md](./SLACK_SETUP.md)
