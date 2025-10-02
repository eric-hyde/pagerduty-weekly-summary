# Slack Workflow Setup Guide

This guide explains how to import and configure the included Slack workflow template for PagerDuty weekly reports.

## Overview

The `slack-workflow-template.json` file contains a pre-configured Slack workflow that can be imported into your Slack workspace. This workflow:

- Accepts webhook data from the PagerDuty report tool
- Formats and posts the report to specified Slack channels
- Includes rich formatting with the AI summary and period information

## Import Instructions

### 1. Import the Workflow

1. **Open Slack** (workflow import only works in web/desktop, not mobile)
2. **Navigate to your Slack workspace**
3. **Go to Automations > Add New Workflow**:
   - In the left panel, click the 3 dots
   - Select Automations
   - Click the + button

4. **Import the workflow**:
   - In the top right corner click the 3 horizontal dots
   - select "Import Workflow"
   - Select the `slack-workflow-template.json` file from this repository
   - Click "Import"

### 2. Configure Recipients

After importing, you need to update where the messages are sent:

1. **Open the imported workflow** ("Monday Pagerduty summary")
2. **Edit the workflow**
3. **Update message destinations**:
   
   The template has two message steps that you need to configure:
   
   - **Step 1**: Send to a user (currently set to a placeholder)
   - **Step 2**: Send to a channel (currently set to channel ID `C072HRV54N9`)

4. **For each message step**:
   - Click on the message step
   - Update the "Send this message to" field
   - Choose your desired channel or user
   - Save the changes

### 3. Get the Webhook URL

After configuring the recipients:

1. **Publish the workflow** by clicking "Publish"
2. **Copy the webhook URL** from the workflow's trigger section by clicking it and going to end of the section to get webhook URL.
3. **Add the URL to your `.env` file**:
   ```bash
   SLACK_WORKFLOW_WEBHOOK_URL=https://hooks.slack.com/triggers/YOUR_WORKSPACE/YOUR_TRIGGER_ID/YOUR_TOKEN
   ```

## Workflow Parameters

The workflow expects these input parameters from the webhook:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `ai_summary` | AI-generated summary of the week's activity | "The Observability Team's PagerDuty activity..." |
| `period_label` | Date range for the report | "2025-09-08 → 2025-09-15 (vs 2025-09-01 → 2025-09-08)" |

## Customization Options

### Modify Message Format

You can customize how the messages appear by:

1. **Editing the message text** in each step
2. **Adding or removing formatting** (bold, italic, etc.)
3. **Including additional workflow tokens** if you want to use more data from the webhook

### Add More Recipients

To send reports to multiple channels or users:

1. **Add new "Send a message" steps** to the workflow
2. **Configure each step** with different recipients
3. **Use the same input parameters** for consistent messaging

### Add Conditional Logic

You can add conditions to send different messages based on the data:

1. **Add a "Condition" step** after the webhook trigger
2. **Set conditions** based on the input parameters
3. **Route to different message steps** based on the conditions

## Testing the Workflow

1. **Test with the report tool**:
   ```bash
   node index.js --debug
   ```

2. **Check the Slack channel** for the formatted message

3. **Verify formatting** and adjust the workflow if needed

## Troubleshooting

### Common Issues

1. **Workflow not receiving data**:
   - Check that the webhook URL in `.env` matches the workflow trigger URL
   - Ensure the workflow is published, not just saved as draft

2. **Messages not appearing**:
   - Verify the bot has permission to post in the target channels
   - Check that channel IDs are correct (not channel names)

3. **Formatting issues**:
   - The workflow uses rich text formatting
   - Plain text from the webhook is automatically converted
   - Complex formatting may need adjustment in the workflow steps

### Getting Channel IDs

If you need to find a channel ID:

1. **Right-click on the channel** in Slack
2. **Select "Copy link"**
3. **Extract the ID** from the URL: `https://workspace.slack.com/archives/CHANNEL_ID`
4. **Use the CHANNEL_ID** in the workflow configuration

## Advanced Configuration

### Multiple Workflows

You can create different workflows for different types of reports:

1. **Duplicate the imported workflow**
2. **Modify the message format** for each use case
3. **Use different webhook URLs** in your `.env` file based on the report type

### Integration with Other Tools

The webhook format is flexible and can be adapted for other reporting tools:

- Modify the input parameters as needed
- Adjust the message formatting
- Add or remove workflow steps

## Support

If you have issues with the Slack workflow:

1. Check the [Slack Workflow Builder documentation](https://slack.com/help/articles/360035692513-Guide-to-Workflow-Builder)
2. Verify your workspace has Workflow Builder enabled
3. Ensure you have the necessary permissions to create and publish workflows
