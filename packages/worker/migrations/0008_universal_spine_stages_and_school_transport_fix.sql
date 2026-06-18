UPDATE ideas
SET stage = CASE stage
  WHEN 'critique' THEN 'shaping'
  WHEN 'researched' THEN 'researching'
  WHEN 'prototype' THEN 'prototyping'
  WHEN 'built' THEN 'launched'
  ELSE stage
END
WHERE stage IN ('critique', 'researched', 'prototype', 'built');

UPDATE ideas
SET body_md = replace(
  body_md,
  'The current option map should be presented by suburb and school, not as one national answer. **School-managed transport.*[StudentRide](https://studentride.com.au/) can be relevant',
  'The current option map should be presented by suburb and school, not as one national answer.' || char(10) || char(10) || '**School-managed transport.**' || char(10) || char(10) || '[StudentRide](https://studentride.com.au/) can be relevant'
)
WHERE id = 'school-transport-options';
