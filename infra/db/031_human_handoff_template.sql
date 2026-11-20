-- Keep handoff alerts actionable and deep-linked to the exact Inbox thread.

update message_templates
set subject = 'Customer waiting for help — FrontDeskWise',
    preview_text = '{{visitor_name}} is waiting for help with {{visitor_intent}}.',
    heading = 'Customer waiting for help',
    body = 'Business: {{business_name}}\nVisitor: {{visitor_name}}\nIntent: {{visitor_intent}}\nWaiting since: {{waiting_since}}\nLast message: “{{last_message}}”\nStatus: {{handoff_status}}\nReason: {{handoff_reason}}',
    cta_label = 'Open conversation',
    cta_url = '{{inbox_url}}',
    footer = 'FrontDeskWise operational notification. Email routing is controlled in Settings → Notifications.',
    variables = '["business_name", "visitor_name", "visitor_intent", "waiting_since", "last_message", "handoff_status", "handoff_reason", "inbox_url"]'::jsonb,
    version = version + 1,
    updated_at = now()
where template_key = 'human_handoff';
