-- Older templates used standard SQL strings containing literal backslash-n
-- sequences. Normalize those stored values into real line breaks.

update message_templates
set body = replace(
  replace(body, E'\\r\\n', E'\n'),
  E'\\n',
  E'\n'
)
where body like E'%\\n%';
