alter table businesses
  add column if not exists agent_published_at timestamptz;

create index if not exists businesses_agent_published_idx
  on businesses (agent_published_at)
  where agent_published_at is not null;

alter table agent_configs
  add column if not exists published_config jsonb,
  add column if not exists published_config_hash text;

-- Configurations created before explicit publishing existed were already being
-- served by the widget, so preserve that behavior as a legacy published state.
update agent_configs
set published_config = jsonb_build_object(
      'assistantName', assistant_name,
      'welcomeMessage', welcome_message,
      'tone', tone,
      'customToneInstructions', coalesce(tone_instructions, ''),
      'primaryLanguage', primary_language,
      'fallbackBehavior', fallback_behavior,
      'humanHandoffEnabled', human_handoff_enabled,
      'widgetColor', widget_color,
      'collectLeads', collect_leads,
      'showBookingAction', show_booking_action,
      'fallbackMessage', fallback_message,
      'widgetDefaultMode', widget_default_mode,
      'widgetAllowExpand', widget_allow_expand,
      'widgetQuickActions', widget_quick_actions,
      'widgetLogoUrl', widget_logo_url,
      'widgetTheme', widget_theme,
      'widgetPosition', widget_position,
      'proactiveEnabled', proactive_enabled,
      'proactiveDelaySeconds', proactive_delay_seconds,
      'proactiveMessage', proactive_message,
      'proactiveTriggers', proactive_triggers,
      'proactiveBehavior', proactive_behavior,
      'proactiveFrequency', proactive_frequency,
      'requireLeadConsent', require_lead_consent,
      'privacyNoticeUrl', privacy_notice_url,
      'retentionDays', retention_days,
      'showAiDisclosure', show_ai_disclosure
    )
where published_config is null;

update businesses b
set agent_published_at = coalesce(b.agent_published_at, ac.updated_at)
from agent_configs ac
where ac.business_id = b.id
  and ac.published_config is not null
  and b.agent_published_at is null;
