Feature: Automation trigger rising-edge state machine
  The trigger engine decides whether a matched condition fires an action based on
  the previous match, cooldown, and whether an action is already running. A rising
  edge (false-or-unknown → true) fires; a sustained true does not.

  Scenario Outline: rising-edge decision for a given prior state and condition
    Given the previous match was <previous>
    And the condition <matched>
    And cooldown is <coolingDown>
    And an action is <actionRunning>
    When the engine decides the trigger
    Then the condition outcome is "<outcome>"
    And the trigger decision is "<decision>"
    And the next match flag is <nextMatch>

    Examples:
      | previous | matched      | coolingDown | actionRunning | outcome     | decision               | nextMatch |
      | unknown  | matches      | inactive    | inactive      | matched     | triggered              | true      |
      | false    | matches      | inactive    | inactive      | matched     | triggered              | true      |
      | true     | matches      | inactive    | inactive      | matched     | not_rising             | true      |
      | true     | does not match | inactive  | inactive      | not_matched | not_rising             | false     |
      | false    | matches      | active      | inactive      | matched     | skipped_cooldown       | true      |
      | false    | matches      | inactive    | active        | matched     | skipped_action_running | true      |
