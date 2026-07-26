Feature: Cron and activation scheduling
  Activation engines compute the next firing instant for cron, once, and interval
  activations, honoring IANA timezones and DST, and rejecting malformed input.

  Scenario: every-15-minutes cron in UTC lands on the next quarter hour
    Given a "cron" activation with expression "*/15 * * * *" and timezone "UTC"
    When the next activation after "2026-07-05T10:07:31.000Z" is computed
    Then the next activation is "2026-07-05T10:15:00.000Z"

  Scenario: a cron activation is due exactly at its scheduled boundary
    Given a "cron" activation with expression "*/15 * * * *" and timezone "UTC"
    When checking if it is due at "2026-07-05T10:15:00.000Z" with next check at "2026-07-05T10:15:00.000Z"
    Then it is due

  Scenario: a cron activation is not due a millisecond before its boundary
    Given a "cron" activation with expression "*/15 * * * *" and timezone "UTC"
    When checking if it is due at "2026-07-05T10:14:59.999Z" with next check at "2026-07-05T10:15:00.000Z"
    Then it is not due

  Scenario: Shanghai wall-clock cron resolves in the target timezone
    Given a "cron" activation with expression "0 1 * * *" and timezone "Asia/Shanghai"
    When the next activation after "2026-07-15T00:00:00.000Z" is computed
    Then the next activation is "2026-07-15T17:00:00.000Z"

  Scenario: New York spring-forward skips the DST gap to the next valid wall clock
    Given a "cron" activation with expression "0 2 * * *" and timezone "America/New_York"
    When the next activation after "2026-03-07T07:00:00.000Z" is computed
    Then the next activation is "2026-03-09T06:00:00.000Z"

  Scenario: a once activation does not repeat once its runAt has passed
    Given a "once" activation with runAt "2026-07-05T11:00:00.000Z"
    When the next activation after "2026-07-05T11:00:00.000Z" is computed
    Then there is no next activation

  Scenario: an interval activation stays anchored to the Unix epoch
    Given an "interval" activation every 60000 ms
    When the next activation after "2026-07-05T10:00:30.000Z" is computed
    Then the next activation is "2026-07-05T10:01:00.000Z"

  Scenario Outline: invalid cron expressions are rejected
    Given a "cron" activation with expression "<expression>" and timezone "UTC"
    When the next activation after "2026-07-05T10:00:00.000Z" is computed
    Then the activation is rejected with "invalid cron"

    Examples:
      | expression    |
      | */0 * * * *   |
      | 60 * * * *    |
      | * 24 * * *    |
      | bogus * * * * |

  Scenario: an unknown timezone is rejected
    Given a "cron" activation with expression "0 9 * * *" and timezone "Not/AZone"
    When the next activation after "2026-07-05T00:00:00.000Z" is computed
    Then the activation is rejected with "unsupported timezone"

  Scenario: restart recovery returns the most recent missed cron activation
    Given a "cron" activation with expression "* * * * *" and timezone "UTC"
    When restart recovery checks from "2026-07-05T10:00:30.000Z" at "2026-07-05T10:05:30.000Z"
    Then the most recent missed activation is "2026-07-05T10:05:00.000Z"

  Scenario: restart recovery returns the most recent missed once activation
    Given a "once" activation with runAt "2026-07-05T10:02:00.000Z"
    When restart recovery checks from "2026-07-05T10:00:30.000Z" at "2026-07-05T10:05:30.000Z"
    Then the most recent missed activation is "2026-07-05T10:02:00.000Z"

  Scenario: restart recovery returns the most recent missed interval activation
    Given an "interval" activation every 60000 ms
    When restart recovery checks from "2026-07-05T10:00:30.000Z" at "2026-07-05T10:05:30.000Z"
    Then the most recent missed activation is "2026-07-05T10:05:00.000Z"

  Scenario: restart recovery finds nothing before the first check
    Given a "once" activation with runAt "2026-07-05T10:02:00.000Z"
    When restart recovery checks with no prior check at "2026-07-05T10:05:30.000Z"
    Then there is no missed activation

  Scenario: an ambiguous DST fall-back resolves to exactly one instant
    Given a "cron" activation with expression "0 1 * * *" and timezone "America/New_York"
    When the next activation after "2026-10-31T05:00:00.000Z" is computed
    Then the next activation is one of "2026-11-01T05:00:00.000Z" or "2026-11-01T06:00:00.000Z"

  Scenario: the day after a DST fall-back still triggers exactly once
    Given a "cron" activation with expression "0 1 * * *" and timezone "America/New_York"
    When the next activation after "2026-11-01T06:00:00.000Z" is computed
    Then the next activation is "2026-11-02T06:00:00.000Z"
