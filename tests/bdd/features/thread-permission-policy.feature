Feature: Thread permission and live-event policy
  Pure rules map permission prompts and live bridge events onto chat task state,
  decide whether a response is echoed, detect structured permission prompts, and
  decide which live events survive a run transition.

  Scenario Outline: task state after a typing-stop settles
    When the task state after typing stop is derived for "<state>"
    Then the resulting task state is "<taskState>"

    Examples:
      | state               | taskState            |
      | awaiting_permission | awaiting_permission  |
      | running             | idle                 |
      | permission_submitted | idle                |

  Scenario Outline: bridge buttons map to a task state and a reason
    When the bridge-button task state is derived for "<present>" "<interactive>"
    Then the resulting task state is "<taskState>"
    And the reason is "<reason>"

    Examples:
      | present | interactive | taskState            | reason                              |
      | present | interactive | awaiting_permission  | bridge-buttons-awaiting-permission  |
      | present | passive     | awaiting_input       | bridge-buttons-awaiting-input       |
      | absent  | passive     | idle                 | bridge-buttons-idle                 |

  Scenario Outline: interactive permission responses are not echoed as chat
    When the echo policy is evaluated for a "<mode>" "<interactive>" action
    Then the response is "<echoed>"

    Examples:
      | mode       | interactive | echoed     |
      | permission | interactive | not echoed |
      | generic    | interactive | echoed     |
      | permission | passive     | echoed     |

  Scenario: a permission prompt with action metadata is structured
    When structured permission detection runs on a message with action mode "permission" and interactive "true"
    Then the prompt is structured

  Scenario: a text-only permission prompt is not treated as structured
    When structured permission detection runs on a text-only message "Please choose: allow or deny"
    Then the prompt is not structured

  Scenario: live events from a superseded run are dropped while a new turn is pending
    Given the active run is "run-old" with a pending turn superseding "run-old" in session "session-1"
    When a live event arrives from run "run-old" in session "session-1"
    Then it is rejected
    When a live event arrives from run "run-new" in session "session-1"
    Then it is rejected

  Scenario: live events are pinned to the current run once known
    Given the active run is "run-current" with no pending turn
    When a live event arrives from run "run-current" in session "session-1"
    Then it is accepted
    When a live event arrives from run "run-stale" in session "session-1"
    Then it is rejected
